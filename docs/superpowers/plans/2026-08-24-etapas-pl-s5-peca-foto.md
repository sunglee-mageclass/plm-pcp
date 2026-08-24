# Etapas PL — S5 (Peça de foto) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Toggle "Peça de foto" + data no bloco PL, e ícone de câmera na lista de produtos do PCP (célula REF, junto do MoDot) quando a data está preenchida. ÚLTIMO sub-projeto da campanha Etapas PL.

**Architecture:** 2 colunas novas em `producao_terceirizados` (`peca_foto boolean default false`, `peca_foto_data date`); `salvar_terceirizados` grava (diff-validado); no bloco PL, checkbox+DateField condicional sob a guarda Etapas PL; na lista PCP, embed do `peca_foto_data` já existente + derivar `temFotoPeca` + ícone `Camera` do lucide.

**Tech Stack:** Vite+React+TS, TanStack, Supabase, Tailwind+shadcn, Vitest.

## Global Constraints

- Migrations via `psql "$(cat /tmp/dburl.txt)" -f`; se faltar, OBTER do dono. `BEGIN;…COMMIT;`.
- Editar função = diff-validar (`pg_get_functiondef` antes/depois, só o delta), `CREATE OR REPLACE` (nunca DROP). Manter REVOKE restatement se existir.
- `salvar_terceirizados` recebe estado COMPLETO do bloco → `peca_foto`/`peca_foto_data` DEVEM ir no payload (senão zeram). `interno` zera (false/null).
- Coluna nova fora do `types.ts` → `as any` na leitura. Antes de commit front: `tsc --noEmit | grep TS2304`, `npm run build`, anti-drift.
- UI do toggle/data + ícone da lista gated por `!b.interno && isServicoPL(catNome) && isModuleEnabled("etapas_pl")` (bloco) / `isModuleEnabled("etapas_pl")` (lista). Persistência no banco NÃO é gated.
- Datas via `<DateField>` (nunca `<input type=date>`). Ícone via `Camera` do `lucide-react`.
- `peca_foto` NOT NULL default false; front manda false, RPC COALESCE como cinto.

---

### Task 1: Migration — colunas `peca_foto` + `peca_foto_data`

**Files:**
- Create: `supabase/migrations/20260824180000_pcp_peca_foto.sql`

**Interfaces:**
- Produces: `producao_terceirizados.peca_foto boolean NOT NULL DEFAULT false`, `peca_foto_data date` (nullable).

- [ ] **Step 1:** Escrever:
  ```sql
  BEGIN;
  ALTER TABLE public.producao_terceirizados
    ADD COLUMN IF NOT EXISTS peca_foto boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS peca_foto_data date;
  COMMIT;
  ```
- [ ] **Step 2:** Aplicar `psql -f`. Confirmar: `select column_name, data_type, is_nullable, column_default from information_schema.columns where table_name='producao_terceirizados' and column_name in ('peca_foto','peca_foto_data');` → peca_foto boolean NOT NULL default false; peca_foto_data date nullable.
- [ ] **Step 3: Commit** `git commit -m "feat(pcp): colunas peca_foto + peca_foto_data em producao_terceirizados"`

---

### Task 2: Migration — `salvar_terceirizados` grava peca_foto/peca_foto_data

**Files:**
- Create: `supabase/migrations/20260824190000_salvar_terceirizados_peca_foto.sql`

**Interfaces:**
- Consumes: colunas da Task 1.
- Produces: `salvar_terceirizados` persiste `peca_foto`/`peca_foto_data` do payload no UPDATE e INSERT.

- [ ] **Step 1:** Dump do def VIVO: `psql "$(cat /tmp/dburl.txt)" -c "select pg_get_functiondef('public.salvar_terceirizados'::regprocedure);" > /tmp/st5_before.sql`. (Assinatura real via `\df salvar_terceirizados` se tiver args.) A migration mais nova é `20260824170000_salvar_terceirizados_nf.sql`; o tail do UPDATE tem `nf_saida = COALESCE(...)/nf_entrada = COALESCE(...)` antes do `WHERE`; o INSERT termina em `..., nf_saida, nf_entrada` (colunas) e `..., COALESCE(b->'nf_saida','[]'::jsonb), COALESCE(b->'nf_entrada','[]'::jsonb)` (values).
- [ ] **Step 2:** `BEGIN;` + `CREATE OR REPLACE FUNCTION public.salvar_terceirizados(...)` com o corpo VIVO + SÓ este delta:
  - UPDATE SET, após `nf_entrada = COALESCE(...)`, adicionar:
    `, peca_foto = COALESCE((b->>'peca_foto')::boolean, false), peca_foto_data = NULLIF(b->>'peca_foto_data','')::date`
  - INSERT: adicionar `peca_foto, peca_foto_data` ao fim da lista de colunas e `COALESCE((b->>'peca_foto')::boolean, false), NULLIF(b->>'peca_foto_data','')::date` ao fim dos VALUES.
  - Nada mais. Manter REVOKE se existir. `COMMIT;`.
- [ ] **Step 3:** Aplicar + diff-validar: dump AFTER; `diff /tmp/st5_before.sql /tmp/st5_after.sql` → só as 2 adições no SET e as 2 (col+value) no INSERT. Confirmar ACL: `has_function_privilege('anon','public.salvar_terceirizados(...)','EXECUTE')` = f; authenticated mantém t.
- [ ] **Step 4:** QA SQL (transacional/rollback): chamar `salvar_terceirizados` com um bloco `"peca_foto": true, "peca_foto_data": "2026-09-01"`; reler → persistiu; bloco sem as chaves → peca_foto=false, peca_foto_data=null. ROLLBACK.
- [ ] **Step 5: Commit** `git commit -m "feat(pcp): salvar_terceirizados grava peca_foto/peca_foto_data (diff-validado)"`

---

### Task 3: Front bloco — toggle "Peça de foto" + DateField

**Files:**
- Modify: `src/routes/_authenticated/pcp.servicos.$modeloId.tsx`

**Interfaces:**
- Consumes: colunas (via RPC).
- Produces: bloco PL mostra checkbox "Peça de foto" + DateField condicional (sob guarda Etapas PL); round-trip completo.

- [ ] **Step 1:** `Bloco` type (~:153-158, junto de pt_/nf_): `+ peca_foto: boolean; peca_foto_data: string | null;`.
- [ ] **Step 2:** `blocosFromRows` (~:688-692): `peca_foto: Boolean((r as any).peca_foto), peca_foto_data: (r as any).peca_foto_data ?? null,`.
- [ ] **Step 3:** novo bloco default (~:821-825, junto de `pt_data_saida: null`): `peca_foto: false, peca_foto_data: null,`.
- [ ] **Step 4:** payload `blocos.map` (~:932-936): `peca_foto: b.interno ? false : b.peca_foto, peca_foto_data: b.interno ? null : b.peca_foto_data,`.
- [ ] **Step 5:** UI no corpo do card — dentro da guarda `!b.interno && isServicoPL(catNome) && isModuleEnabled("etapas_pl")` (as mesmas usadas pelo EtapasPlPanel/NF; localizar o ponto certo no grid do corpo, perto dos campos PL). Idioma do checkbox = igual ao `detalhado` (~:1197-1211):
  ```tsx
  {!b.interno && isServicoPL(catNome) && isModuleEnabled("etapas_pl") && (
    <div className="col-span-full space-y-2">
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={b.peca_foto}
          onChange={(e) => updateBloco(idx, { peca_foto: e.target.checked, ...(e.target.checked ? {} : { peca_foto_data: null }) })} />
        <span>Peça de foto</span>
      </label>
      {b.peca_foto && (
        <div className="max-w-[220px]">
          <Label className="text-xs">Data de entrega da peça de foto</Label>
          <DateField value={b.peca_foto_data ?? ""} onChange={(e) => updateBloco(idx, { peca_foto_data: e.target.value || null })} disabled={readOnly} />
        </div>
      )}
    </div>
  )}
  ```
  (Desmarcar o checkbox limpa a data. Se `isServicoPL`/`catNome`/`isModuleEnabled` não estiverem no escopo do render do bloco, verificar como o EtapasPlPanel os obtém — estão, pois o painel usa a mesma guarda ~:1491/1512.)
- [ ] **Step 6:** Gates: `npx tsc --noEmit | grep -E 'TS2304|servicos'`; `npm run build`; anti-drift. QA :5173 (reusar server; não matar o vite): bloco PL mostra "Peça de foto"; marcar → aparece a data; salvar; reabrir → persistiu; bloco interno não mostra; módulo off não mostra.
- [ ] **Step 7: Commit** `git commit -m "feat(pcp): toggle Peça de foto + data no bloco PL"`

---

### Task 4: Front lista — ícone de câmera na célula REF

**Files:**
- Modify: `src/routes/_authenticated/pcp.servicos.index.tsx`

**Interfaces:**
- Consumes: `peca_foto_data` dos blocos embedados.
- Produces: ícone `Camera` na célula REF (após `MoDot`) quando algum bloco PL do modelo tem `peca_foto_data`.

- [ ] **Step 1:** Import: adicionar `Camera` ao import de `lucide-react` (~:5, hoje `{ Users, Search, Printer }`). Adicionar `import { useTenantModules } from "@/hooks/useTenantModules";` e, dentro do componente da lista, `const { isModuleEnabled } = useTenantModules();` (CONFIRMADO: mesma assinatura usada no sheet — `useTenantModules()` retorna `{ isModuleEnabled }`).
- [ ] **Step 2:** Query embed (~:57): no select do `producao_terceirizados(...)`, adicionar `, peca_foto_data`. (Fica `producao_terceirizados(data_enviado, data_entregue, quantidade_enviada, quantidade_recebida, quantidade_defeito, ativo, interno, peca_foto_data, categorias_terceirizado(etapa))`.)
- [ ] **Step 3:** No `.map` (~:62-100), onde já lê `m.cad?.[0]?.producao_terceirizados` p/ o statusGeral, derivar antes do `return`:
  `const tercs = m.cad?.[0]?.producao_terceirizados ?? []; const temFotoPeca = tercs.some((t: any) => !t.interno && !!t.peca_foto_data);`
  (se já existir uma var `tercs`/similar no map, reusar). Incluir `temFotoPeca,` no objeto retornado (~:88-98).
- [ ] **Step 4:** Na célula REF (~:208-215), a var do row no render é **`r`** (`sorted.map((r: any) => ...)`, o `<MoDot>` está na linha ~:210). Após `<MoDot .../>`, adicionar:
  `{isModuleEnabled("etapas_pl") && r.temFotoPeca && <Camera className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-label="Peça de foto" />}`
- [ ] **Step 5:** Gates: `npx tsc --noEmit | grep -E 'TS2304|servicos'`; `npm run build`; anti-drift. QA :5173: um modelo com bloco PL + peça de foto com data → ícone de câmera aparece junto da REF na lista; sem data → sem ícone; módulo off → sem ícone.
- [ ] **Step 6: Commit** `git commit -m "feat(pcp): ícone de câmera na lista quando peça de foto tem data"`

---

## Self-Review

**Spec coverage:** colunas → T1; persistência → T2; toggle+data no bloco → T3; ícone na lista → T4. Fora de escopo: upload da foto real, ícone no Planejamento.

**Placeholder scan:** T1/T2 SQL completo + método diff; T3/T4 com os pontos de round-trip + JSX + âncoras. Confirmar em runtime: nome real da var do row no render da lista (Step T4.4) e a forma de obter `isModuleEnabled` na lista (Step T4.1).

**Type consistency:** `peca_foto: boolean`/`peca_foto_data: string|null` idêntico em type/load/default/payload; coluna `peca_foto`/`peca_foto_data` idêntica em T1/T2; `temFotoPeca` derivado na lista.

**Riscos:** (a) a lista descarta os blocos no map — derivar `temFotoPeca` ANTES do return (T4.3 destaca); (b) diff-validação do salvar_terceirizados; (c) `isModuleEnabled` na lista — obter do hook certo, não inventar; (d) desmarcar o toggle limpa a data (evita data órfã de peça-foto desligada).
