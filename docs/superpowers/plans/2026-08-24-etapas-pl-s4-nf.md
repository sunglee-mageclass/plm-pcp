# Etapas PL — S4 (Notas Fiscais no bloco PL) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Anexar listas de NF de Saída e de Entrada a um bloco de serviço PL, num painel "Notas Fiscais" no bloco do sheet PCP, com upload/preview via bucket privado tenant-scoped `pcp-servicos`.

**Architecture:** 2 colunas jsonb (`nf_saida`, `nf_entrada`, default `[]`) em `producao_terceirizados`; bucket novo `pcp-servicos` + 4 policies tenant-scoped; `salvar_terceirizados` grava as 2 colunas (diff-validado); front reusa o componente existente `NfList`+`FileField` (rotulado "Notas Fiscais", genérico por `bucket`/`uploadFn`) num painel único no bloco PL, com um `uploadFn` local apontando ao bucket novo.

**Tech Stack:** Vite+React+TS, TanStack, Supabase (Postgres+Storage), Tailwind+shadcn, Vitest.

## Global Constraints

- Migrations via `psql "$(cat /tmp/dburl.txt)" -f <arq>`; se faltar, OBTER do dono. `BEGIN;…COMMIT;`.
- Editar função = diff-validar (`pg_get_functiondef` antes/depois, só o delta), `CREATE OR REPLACE` (nunca DROP).
- **Bucket privado tenant-scoped** (invariante #2): toda policy de storage usa `(storage.foldername(name))[1] = get_user_tenant_id()::text`. 4 policies (select/insert/update/delete) TO authenticated.
- Coluna nova fora do `types.ts` → `as any` no ponto de leitura. Antes de cada commit front: `tsc --noEmit | grep TS2304`, `npm run build`, anti-drift.
- `salvar_terceirizados` recebe estado COMPLETO do bloco: nf_saida/nf_entrada DEVEM ir no payload sempre (senão zeram). Interno/não-PL manda `[]`.
- NÃO usar o `uploadFile` de `oc-tecido/shared.ts` direto (bucket fixo `oc-tecido`) — criar `uploadFn` com bucket `pcp-servicos`.
- NfList props reais: `{value, onChange, uploadFn, bucket, readOnly}` (SEM prop `label` — título vem do painel). NfItem = `{url: string, data?: string}`.

---

### Task 1: Migration — colunas nf_ + bucket `pcp-servicos` + policies

**Files:**
- Create: `supabase/migrations/20260824160000_pcp_servicos_nf.sql`

**Interfaces:**
- Produces: `producao_terceirizados.nf_saida jsonb`, `nf_entrada jsonb` (NOT NULL DEFAULT '[]'); bucket `pcp-servicos` privado + 4 policies tenant.

- [ ] **Step 1:** Escrever a migration:
  ```sql
  BEGIN;
  ALTER TABLE public.producao_terceirizados
    ADD COLUMN IF NOT EXISTS nf_saida jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS nf_entrada jsonb NOT NULL DEFAULT '[]'::jsonb;

  INSERT INTO storage.buckets (id, name, public)
  VALUES ('pcp-servicos', 'pcp-servicos', false)
  ON CONFLICT (id) DO NOTHING;

  -- 4 policies tenant-scoped (espelham 'comprovantes'/'oc-tecido')
  CREATE POLICY "pcp-servicos tenant select" ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'pcp-servicos' AND (storage.foldername(name))[1] = get_user_tenant_id()::text);
  CREATE POLICY "pcp-servicos tenant insert" ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'pcp-servicos' AND (storage.foldername(name))[1] = get_user_tenant_id()::text);
  CREATE POLICY "pcp-servicos tenant update" ON storage.objects FOR UPDATE TO authenticated
    USING (bucket_id = 'pcp-servicos' AND (storage.foldername(name))[1] = get_user_tenant_id()::text);
  CREATE POLICY "pcp-servicos tenant delete" ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'pcp-servicos' AND (storage.foldername(name))[1] = get_user_tenant_id()::text);
  COMMIT;
  ```
  ⚠️ Se as policies já existirem (re-run), `CREATE POLICY` falha — proteger com `DROP POLICY IF EXISTS "<nome>" ON storage.objects;` antes de cada `CREATE POLICY`, ou checar `pg_policies`. Preferir os `DROP ... IF EXISTS` para idempotência.
- [ ] **Step 2:** Aplicar via `psql -f`. Confirmar: colunas (`select column_name, data_type from information_schema.columns where table_name='producao_terceirizados' and column_name in ('nf_saida','nf_entrada');` → 2 linhas jsonb); bucket (`select id, public from storage.buckets where id='pcp-servicos';` → public=false); policies (`select policyname from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'pcp-servicos%';` → 4).
- [ ] **Step 3:** Smoke de RLS (opcional, transacional/rollback): como um user autenticado do tenant, um INSERT em storage.objects com path `{tenant}/x` passa e com outro tenant falha — OU deixar para o QA de front (upload real). Documentar no report o que foi verificado.
- [ ] **Step 4: Commit** `git commit -m "feat(pcp): colunas nf_saida/nf_entrada + bucket pcp-servicos tenant-scoped"`

---

### Task 2: Migration — `salvar_terceirizados` grava nf_saida/nf_entrada

**Files:**
- Create: `supabase/migrations/20260824170000_salvar_terceirizados_nf.sql`

**Interfaces:**
- Consumes: colunas da Task 1.
- Produces: `salvar_terceirizados` persiste `nf_saida`/`nf_entrada` do payload jsonb no UPDATE e no INSERT.

- [ ] **Step 1:** Dump do def VIVO: `psql "$(cat /tmp/dburl.txt)" -c "select pg_get_functiondef('public.salvar_terceirizados'::regprocedure);" > /tmp/st_before.sql`. (Se a assinatura tiver args, descobrir com `\df salvar_terceirizados`.) Localizar o UPDATE (SET col-a-col, ~linha 54-79 da migration `20260821130000`) e o INSERT (col list + VALUES, ~82-100).
- [ ] **Step 2:** Escrever a migration `BEGIN;` + `CREATE OR REPLACE FUNCTION public.salvar_terceirizados(...)` = corpo VIVO com SÓ este delta:
  - No SET do UPDATE, após `pt_aprovacao = ...`, adicionar:
    `nf_saida = COALESCE(b->'nf_saida','[]'::jsonb), nf_entrada = COALESCE(b->'nf_entrada','[]'::jsonb)`.
  - No INSERT: adicionar `nf_saida, nf_entrada` à lista de colunas e `COALESCE(b->'nf_saida','[]'::jsonb), COALESCE(b->'nf_entrada','[]'::jsonb)` aos VALUES.
  - Nada mais. Se a função tiver REVOKE restatement no fim, manter. `COMMIT;`.
- [ ] **Step 3:** Aplicar + diff-validar: dump AFTER; `diff /tmp/st_before.sql /tmp/st_after.sql` → só as adições nf_ no SET e no INSERT (col+value). Confirmar ACL preservada (`has_function_privilege('anon','public.salvar_terceirizados(...)','EXECUTE')` = f; a função é escrita por authenticated — confirmar que authenticated mantém).
- [ ] **Step 4:** QA SQL (transacional/rollback): chamar `salvar_terceirizados` com um bloco cujo jsonb tem `nf_saida: [{"url":"t/x/a.pdf","data":"2026-08-24"}]`; reler a linha e conferir que nf_saida persistiu; um bloco sem nf_ → colunas ficam `[]`. ROLLBACK.
- [ ] **Step 5: Commit** `git commit -m "feat(pcp): salvar_terceirizados grava nf_saida/nf_entrada (diff-validado)"`

---

### Task 3: Front — painel "Notas Fiscais" no bloco PL

**Files:**
- Modify: `src/routes/_authenticated/pcp.servicos.$modeloId.tsx`

**Interfaces:**
- Consumes: colunas nf_ (via `salvar_terceirizados`), componente `NfList`/`NfItem`.
- Produces: bloco PL mostra um painel "Notas Fiscais" com 2 listas (Saída/Entrada), upload/preview no bucket `pcp-servicos`, respeitando `readOnly`.

- [ ] **Step 1:** Imports: `import { NfList, type NfItem } from "@/components/oc-tecido/NfList";` e `import { tenantPrefix, sanitizeStorageName } from "@/lib/storage-tenant";` (se ainda não importados).
- [ ] **Step 2:** `Bloco` type (~:121-154): adicionar `nf_saida: NfItem[]; nf_entrada: NfItem[];`.
- [ ] **Step 3:** `blocosFromRows` (~:683-685, junto dos `pt_`): `nf_saida: Array.isArray((r as any).nf_saida) ? (r as any).nf_saida : []`, idem `nf_entrada`. Novo bloco default: no `setBlocosTracked((bs) => [ ...bs, {...} ])` (~:787-816, onde já tem `pt_data_saida: null` etc.), adicionar `nf_saida: [], nf_entrada: []`.
- [ ] **Step 4:** payload `_blocos.map()` (~:886-916, perto de `pt_data_saida`): `nf_saida: b.interno ? [] : b.nf_saida, nf_entrada: b.interno ? [] : b.nf_entrada`.
- [ ] **Step 5:** `uploadFn` local (perto dos outros helpers do componente):
  ```tsx
  async function uploadNfServico(blocoId: string, file: File): Promise<string> {
    const tenant = await tenantPrefix();
    const path = `${tenant}/${blocoId}/${crypto.randomUUID()}-${sanitizeStorageName(file.name)}`;
    const { error } = await supabase.storage.from("pcp-servicos").upload(path, file, { upsert: false });
    if (error) throw error;
    return path;
  }
  ```
- [ ] **Step 6:** Painel no bloco PL — logo após o `</EtapasPlPanel>`/fechamento do bloco `{!b.interno && isServicoPL(catNome) && isModuleEnabled("etapas_pl") && (...)}` (~:1491-1506), adicionar um SEGUNDO bloco com a MESMA guarda (o painel de NF só faz sentido p/ PL com o módulo ligado, igual ao EtapasPlPanel). O helper de update REAL é `updateBloco(idx, patch)` (definido ~:822, assinatura `(idx: number, patch: Partial<Bloco>)`) e o loop usa `.map((b, idx) => ...)` (~:1045) — usar `idx`, NÃO `b.id`:
  ```tsx
  {!b.interno && isServicoPL(catNome) && isModuleEnabled("etapas_pl") && (
    <div className="col-span-full rounded-md border border-primary/30 bg-primary/5 p-3 space-y-3">
      <div className="text-sm font-medium">Notas Fiscais</div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <div className="text-xs text-muted-foreground mb-1">NF de Saída</div>
          <NfList value={b.nf_saida} onChange={(nfs) => updateBloco(idx, { nf_saida: nfs })}
            uploadFn={(f) => uploadNfServico(b.id, f)} bucket="pcp-servicos" readOnly={readOnly} />
        </div>
        <div>
          <div className="text-xs text-muted-foreground mb-1">NF de Entrada</div>
          <NfList value={b.nf_entrada} onChange={(nfs) => updateBloco(idx, { nf_entrada: nfs })}
            uploadFn={(f) => uploadNfServico(b.id, f)} bucket="pcp-servicos" readOnly={readOnly} />
        </div>
      </div>
    </div>
  )}
  ```
  Nota: `uploadNfServico(b.id, f)` usa `b.id` (o UUID do bloco, p/ o PATH no storage) — correto; o `updateBloco(idx, ...)` usa o índice do map (p/ o estado). Não confundir os dois.
- [ ] **Step 7:** Gates: `npx tsc --noEmit | grep -E 'TS2304|servicos'`; `npm run build`; `npx vitest run tests/unit/ui-padroes-antidrift.test.ts`. QA :5173 (reusar server rodando; NÃO matar o vite do dono): abrir um modelo com bloco PL → painel "Notas Fiscais" aparece; anexar um PDF em Saída → badge aparece, clicar abre preview; salvar; reabrir → NF persistiu; bloco interno NÃO mostra o painel.
- [ ] **Step 8: Commit** `git commit -m "feat(pcp): painel Notas Fiscais (Saída/Entrada) no bloco PL"`

---

## Self-Review

**Spec coverage:** colunas+bucket+policies → T1; persistência → T2; painel único com 2 listas + upload/preview no bucket novo → T3. Fora de escopo: extração de dados da NF, vínculo NF↔parcela.

**Placeholder scan:** T1/T2 têm SQL completo + método diff; T3 tem os 3 pontos de estado (type/load/payload) com âncoras + o JSX do painel. Ponto a confirmar em runtime: o nome real do helper de atualização de bloco (Step 6 destaca) e a existência de um "novo bloco" default (Step 3).

**Type consistency:** `NfItem[]` idêntico em type/load/payload/props; `nf_saida`/`nf_entrada` jsonb idêntico em T1/T2/T3; bucket string `pcp-servicos` idêntico em T1 (policy) e T3 (upload/NfList).

**Riscos:** (a) idempotência das policies (DROP IF EXISTS antes de CREATE); (b) bucket fixo do `uploadFile` legado — usar o `uploadNfServico` local; (c) COALESCE '[]' na RPC como cinto contra null; (d) diff-validação do salvar_terceirizados; (e) helper de update de bloco com nome real — não inventar.
