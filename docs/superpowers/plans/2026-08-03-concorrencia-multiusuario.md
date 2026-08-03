# Concorrência Multi-usuário (anti lost-update) — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Impedir que o save de um usuário apague em silêncio o save de outro: trava otimista (`rev`) no servidor + merge por campo ao vivo (Realtime) + presença de tela/campo — infra completa + tela piloto (OC Tecido).

**Architecture:** Coluna `rev` nos agregados-raiz com triggers de bump (filhas tocam a raiz — 1 listener Realtime cobre tudo); RPCs de salvar ganham `_rev_base` (≠ atual → `P0409`); no front, um hook (`useColabRegistro`) escuta a linha-raiz e um helper puro (`mergeDraft`) re-semeia campos não-tocados/aponta conflitos. Adoção tela a tela; este plano cobre infra + piloto OC Tecido. Spec: `docs/superpowers/specs/2026-08-03-concorrencia-multiusuario-design.md`.

**Tech Stack:** Postgres (Supabase próprio, ref `ruinwcuabilumcspeyjk`) · Supabase Realtime (postgres_changes + presence) · React + TanStack Query · Vitest (unit + integração transacional).

## Global Constraints

- Migrações aplicadas com `psql "$(cat /tmp/dburl.txt)" -f <arquivo>`; migração com DROP envolta em `BEGIN; … COMMIT;`; idempotente (`IF EXISTS`/`IF NOT EXISTS`).
- Ao alterar função existente: **dump antes** (`pg_get_functiondef`) e diff-validar depois. Wrappers/`_core` novos: **REVOKE EXECUTE do `_core` de PUBLIC, anon E authenticated** (invariante #9 — assinatura nova = ACL nova!).
- `modelos.versao` é conceito de NEGÓCIO (v1/v2/v3) — a coluna nova chama-se `rev` (e `plan_rev` em colecoes). NUNCA misturar.
- Erros em PT-BR via `mensagemErro` (`@/lib/erro-mensagem`). Errcode do conflito: **`P0409`**, mensagem `conflito_versao`.
- Antes de cada commit: `npm run build` + `npx tsc --noEmit` (build não roda tsc). Testes: `npx vitest run tests/...`.
- Branch: `feature/plan-tecido-a1`. Commits terminam com `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Compat: `_rev_base` tem `default null` = comportamento atual → NENHUMA tela não-migrada pode quebrar.

---

### Task 1: Migração A — `rev` + triggers de bump + publicação Realtime

**Files:**
- Create: `supabase/migrations/20260803180000_colab_rev_infra.sql`
- Test: `tests/integration/colab-rev.test.ts`

**Interfaces:**
- Produces: colunas `modelos.rev`, `ocs_tecido.rev`, `colecoes.plan_rev` (int, default 1, server-owned); garantia "qualquer save no agregado incrementa o rev da raiz e emite UPDATE na linha-raiz"; as 3 raízes na publicação `supabase_realtime`.

- [ ] **Step 1: Escrever o teste de integração (falhando)**

```ts
// tests/integration/colab-rev.test.ts
import { describe, it, expect } from "vitest";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE } from "./db";

describe.skipIf(!hasDb)("colab — rev bump (raiz + filhas)", () => {
  it("update na raiz incrementa rev; update em filha dá bump na raiz", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const art = await um<{ id: string }>(
        c, `insert into artigos (tenant_id, nome) values ($1, 'COLAB TESTE') returning id`, [TENANT_TESTE]);
      const oc = await um<{ id: string; rev: number }>(
        c, `insert into ocs_tecido (tenant_id, numero_pedido) values ($1, 'COLAB-REV') returning id, rev`, [TENANT_TESTE]);
      expect(oc.rev).toBe(1);
      // update direto na raiz → rev+1 (BEFORE UPDATE)
      const r1 = await um<{ rev: number }>(
        c, `update ocs_tecido set observacoes_entrega = 'x' where id = $1 returning rev`, [oc.id]);
      expect(r1.rev).toBe(2);
      // insert de FILHA → bump na raiz (AFTER trigger)
      await um(c, `insert into ocs_tecido_itens (oc_tecido_id, artigo_id, quantidade_pedida) values ($1,$2,10) returning id`, [oc.id, art.id]);
      const r2 = await um<{ rev: number }>(c, `select rev from ocs_tecido where id = $1`, [oc.id]);
      expect(r2.rev).toBeGreaterThan(2);
      // rev é do SERVIDOR: tentar gravar rev manualmente não rebaixa
      const r3 = await um<{ rev: number }>(
        c, `update ocs_tecido set rev = 1 where id = $1 returning rev`, [oc.id]);
      expect(r3.rev).toBe(r2.rev + 1);
    });
  });

  it("publicação supabase_realtime contém as 3 raízes", async () => {
    await withTx(async (c) => {
      const rows = await um<{ n: string }>(
        c, `select count(*)::int as n from pg_publication_tables where pubname='supabase_realtime'
            and tablename in ('modelos','ocs_tecido','colecoes')`, []);
      expect(Number(rows.n)).toBe(3);
    });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/integration/colab-rev.test.ts`
Expected: FAIL — `column "rev" does not exist`.

- [ ] **Step 3: Escrever a migração**

```sql
-- 20260803180000_colab_rev_infra.sql
-- Concorrência multi-usuário (spec 2026-08-03): rev nos agregados-raiz + bump por filhas.
-- rev é DO SERVIDOR (BEFORE UPDATE sempre incrementa; valor do cliente é ignorado).
-- O bump da filha é um UPDATE no-op na raiz → o BEFORE converte em rev+1 E emite o
-- evento UPDATE que o Realtime entrega (1 listener na raiz cobre o agregado inteiro).
alter table public.modelos    add column if not exists rev int not null default 1;
alter table public.ocs_tecido add column if not exists rev int not null default 1;
alter table public.colecoes   add column if not exists plan_rev int not null default 1;

create or replace function public.fn_colab_touch_rev() returns trigger
language plpgsql as $$ begin new.rev := old.rev + 1; return new; end $$;
create or replace function public.fn_colab_touch_plan_rev() returns trigger
language plpgsql as $$ begin new.plan_rev := old.plan_rev + 1; return new; end $$;

drop trigger if exists trg_colab_rev on public.modelos;
create trigger trg_colab_rev before update on public.modelos
  for each row execute function public.fn_colab_touch_rev();
drop trigger if exists trg_colab_rev on public.ocs_tecido;
create trigger trg_colab_rev before update on public.ocs_tecido
  for each row execute function public.fn_colab_touch_rev();
drop trigger if exists trg_colab_plan_rev on public.colecoes;
create trigger trg_colab_plan_rev before update on public.colecoes
  for each row execute function public.fn_colab_touch_plan_rev();

-- Bumps (SECURITY DEFINER: o UPDATE na raiz não pode esbarrar em RLS de fluxos DEFINER)
create or replace function public.fn_colab_bump_oc() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid := coalesce(new.oc_tecido_id, old.oc_tecido_id);
begin update public.ocs_tecido set id = id where id = v_id; return coalesce(new, old); end $$;

create or replace function public.fn_colab_bump_modelo() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid := coalesce(new.modelo_id, old.modelo_id);
begin update public.modelos set id = id where id = v_id; return coalesce(new, old); end $$;

create or replace function public.fn_colab_bump_modelo_via_tecido() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid;
begin
  select mt.modelo_id into v_id from public.modelo_tecidos mt
   where mt.id = coalesce(new.modelo_tecido_id, old.modelo_tecido_id);
  if v_id is not null then update public.modelos set id = id where id = v_id; end if;
  return coalesce(new, old);
end $$;

create or replace function public.fn_colab_bump_plan() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid := coalesce(new.colecao_id, old.colecao_id);
begin update public.colecoes set id = id where id = v_id; return coalesce(new, old); end $$;

-- OC: itens
drop trigger if exists trg_colab_bump on public.ocs_tecido_itens;
create trigger trg_colab_bump after insert or update or delete on public.ocs_tecido_itens
  for each row execute function public.fn_colab_bump_oc();

-- Modelo: filhas com modelo_id direto
do $$ declare t text;
begin
  foreach t in array array['modelo_tecidos','modelo_grades','modelo_aviamentos',
                           'modelo_etiquetas','modelo_observacoes','modelo_prova_comentarios',
                           'modelo_tecido_oc_links']
  loop
    execute format('drop trigger if exists trg_colab_bump on public.%I', t);
    execute format('create trigger trg_colab_bump after insert or update or delete on public.%I
                    for each row execute function public.fn_colab_bump_modelo()', t);
  end loop;
end $$;
-- Modelo: variantes (via modelo_tecidos)
drop trigger if exists trg_colab_bump on public.modelo_tecido_variantes;
create trigger trg_colab_bump after insert or update or delete on public.modelo_tecido_variantes
  for each row execute function public.fn_colab_bump_modelo_via_tecido();

-- Plan. Tecido: tabelas com colecao_id direto. A ÁRVORE (subcolecoes/linhas/slots/materiais)
-- tem UM único escritor (salvar_plan_tecido) — o bump dela é feito DENTRO da RPC (Task 2),
-- não por trigger multi-nível (decisão de simplificação; mesma garantia).
do $$ declare t text;
begin
  foreach t in array array['plan_tecido','plan_tecido_oc_aplicada','plan_tecido_slot_oc']
  loop
    execute format('drop trigger if exists trg_colab_bump on public.%I', t);
    execute format('create trigger trg_colab_bump after insert or update or delete on public.%I
                    for each row execute function public.fn_colab_bump_plan()', t);
  end loop;
end $$;

-- Publicação Realtime (VERIFICADO vazia hoje) — sem isto o postgres_changes não dispara.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='modelos')
    then alter publication supabase_realtime add table public.modelos; end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='ocs_tecido')
    then alter publication supabase_realtime add table public.ocs_tecido; end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='colecoes')
    then alter publication supabase_realtime add table public.colecoes; end if;
end $$;
```

- [ ] **Step 4: Aplicar e rodar o teste**

Run: `psql "$(cat /tmp/dburl.txt)" -f supabase/migrations/20260803180000_colab_rev_infra.sql` e depois `npx vitest run tests/integration/colab-rev.test.ts`
Expected: PASS (2 testes).

- [ ] **Step 5: Sanidade de regressão** — rodar a suíte de integração existente (`npx vitest run tests/integration/`). Os triggers de bump NÃO podem quebrar RPCs existentes (salvar_cq, direcionamento etc.). Expected: mesmos resultados de antes (3 falhas pré-existentes conhecidas: oc-tecido-preco ×2, estoque-reserva-zerado ×1 — nada NOVO falhando).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260803180000_colab_rev_infra.sql tests/integration/colab-rev.test.ts
git commit -m "Colab: rev nos agregados-raiz + bump por filhas + publicação Realtime"
```

---

### Task 2: Migração B — trava otimista (`_rev_base` → `P0409`) nas 3 RPCs

**Files:**
- Create: `supabase/migrations/20260803190000_colab_trava_rev.sql`
- Test: `tests/integration/colab-trava.test.ts`

**Interfaces:**
- Consumes: colunas `rev`/`plan_rev` (Task 1).
- Produces: `salvar_oc_tecido(_oc_id, _oc, _itens, _rev_base int default null)`, `salvar_modelo_bom(_modelo_id, _tecidos, _aviamentos, _grades, _rev_base int default null)`, `salvar_plan_tecido(_colecao_id, _arvore, _rev_base int default null)` — `_rev_base` errado ⇒ `RAISE ... ERRCODE 'P0409'`, mensagem começando com `conflito_versao`. `_salvar_plan_tecido_core` passa a dar bump em `colecoes.plan_rev` no fim.

- [ ] **Step 1: Dump das definições atuais (OBRIGATÓRIO — as bodies não podem ser recriadas de memória)**

```bash
for f in salvar_oc_tecido _salvar_oc_tecido_core salvar_modelo_bom _salvar_modelo_bom_core salvar_plan_tecido _salvar_plan_tecido_core; do
  psql "$(cat /tmp/dburl.txt)" -tAc "select pg_get_functiondef(('public.'||'$f')::regproc)" > "/tmp/def_$f.sql"; done
wc -l /tmp/def_*.sql   # todas > 0
```

- [ ] **Step 2: Teste de integração (falhando)**

```ts
// tests/integration/colab-trava.test.ts
import { describe, it, expect } from "vitest";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE } from "./db";

describe.skipIf(!hasDb)("colab — trava otimista (P0409)", () => {
  it("salvar_oc_tecido: _rev_base errado recusa com P0409; null passa da checagem", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const oc = await um<{ id: string; rev: number }>(
        c, `insert into ocs_tecido (tenant_id, numero_pedido) values ($1,'TRAVA') returning id, rev`, [TENANT_TESTE]);
      // rev errado → P0409 (a checagem vem ANTES do payload; payload mínimo serve)
      await expect(
        um(c, `select salvar_oc_tecido($1, '{}'::jsonb, '[]'::jsonb, $2)`, [oc.id, oc.rev + 99]),
      ).rejects.toMatchObject({ code: "P0409" });
    });
  });
  it("salvar_oc_tecido: _rev_base CORRETO passa e o save bumpa o rev", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const oc = await um<{ id: string; rev: number }>(
        c, `insert into ocs_tecido (tenant_id, numero_pedido) values ($1,'TRAVA2') returning id, rev`, [TENANT_TESTE]);
      // payload mínimo VÁLIDO: derive as chaves lendo /tmp/def__salvar_oc_tecido_core.sql
      // (o core lê _oc->>'numero_pedido' etc.; itens vazio = sem mudanças de item)
      await um(c, `select salvar_oc_tecido($1, jsonb_build_object('numero_pedido','TRAVA2'), '[]'::jsonb, $2)`, [oc.id, oc.rev]);
      const r = await um<{ rev: number }>(c, `select rev from ocs_tecido where id=$1`, [oc.id]);
      expect(r.rev).toBeGreaterThan(oc.rev);
    });
  });
  it("salvar_modelo_bom e salvar_plan_tecido: rev errado → P0409", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const m = await um<{ id: string; rev: number }>(
        c, `insert into modelos (tenant_id, nome) values ($1,'TRAVA M') returning id, rev`, [TENANT_TESTE]);
      await expect(
        um(c, `select salvar_modelo_bom($1,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,$2)`, [m.id, m.rev + 99]),
      ).rejects.toMatchObject({ code: "P0409" });
      const col = await um<{ id: string; plan_rev: number }>(
        c, `insert into colecoes (tenant_id, nome) values ($1,'TRAVA C') returning id, plan_rev`, [TENANT_TESTE]);
      await expect(
        um(c, `select salvar_plan_tecido($1,'{}'::jsonb,$2)`, [col.id, col.plan_rev + 99]),
      ).rejects.toMatchObject({ code: "P0409" });
    });
  });
});
```

Run: `npx vitest run tests/integration/colab-trava.test.ts` → Expected: FAIL (função de 4/5 args não existe).

- [ ] **Step 3: Escrever a migração** — para CADA par wrapper/`_core`, partir do dump de `/tmp/def_*.sql` e:
  1. Envolver TUDO em `BEGIN; … COMMIT;` (há DROPs).
  2. `DROP FUNCTION` da assinatura ANTIGA (wrapper e core) — CREATE OR REPLACE com args diferentes criaria OVERLOAD duplicado.
  3. Recriar o `_core` com o parâmetro extra `_rev_base int default null` e, como PRIMEIRO bloco do corpo:

```sql
  -- trava otimista (spec 2026-08-03)
  if _rev_base is not null then
    declare v_rev int;
    begin
      select rev into v_rev from public.ocs_tecido where id = _oc_id for update;  -- (modelos.rev / colecoes.plan_rev nos outros)
      if v_rev is distinct from _rev_base then
        raise exception 'conflito_versao: o registro foi salvo por outra pessoa'
          using errcode = 'P0409';
      end if;
    end;
  end if;
```

  4. `_salvar_plan_tecido_core`: acrescentar como ÚLTIMA linha antes do retorno: `update public.colecoes set id = id where id = _colecao_id;` (bump da árvore — decisão da Task 1).
  5. Recriar o wrapper repassando `_rev_base` ao core.
  6. **ACL (invariante #9):** para cada `_core` novo: `revoke execute on function public._x_core(<assinatura nova completa>) from public, anon, authenticated;` e para cada wrapper: `grant execute ... to authenticated;`.

- [ ] **Step 4: Aplicar + diff-validar + testar**

```bash
psql "$(cat /tmp/dburl.txt)" -f supabase/migrations/20260803190000_colab_trava_rev.sql
# diff: só o bloco da trava + assinatura devem ter mudado
for f in _salvar_oc_tecido_core _salvar_modelo_bom_core _salvar_plan_tecido_core; do
  psql "$(cat /tmp/dburl.txt)" -tAc "select pg_get_functiondef(('public.'||'$f')::regproc)" > "/tmp/def_${f}_novo.sql"
  diff "/tmp/def_$f.sql" "/tmp/def_${f}_novo.sql" | head -40; done
# ACL: has_function_privilege deve ser FALSE p/ anon e authenticated nos 3 cores
psql "$(cat /tmp/dburl.txt)" -tAc "select has_function_privilege('anon', p.oid, 'EXECUTE') from pg_proc p where proname='_salvar_oc_tecido_core'"
npx vitest run tests/integration/colab-trava.test.ts
```
Expected: diffs mínimos; privilégios false; testes PASS.

- [ ] **Step 5: Regressão** — `npx vitest run tests/integration/` (nada NOVO falhando; as telas chamam com 3/4 args e caem no default null).

- [ ] **Step 6: Commit** — `git add supabase/migrations/20260803190000_colab_trava_rev.sql tests/integration/colab-trava.test.ts && git commit -m "Colab: trava otimista _rev_base (P0409) em salvar_oc_tecido/modelo_bom/plan_tecido"`

---

### Task 3: `mensagemErro` traduz `P0409`

**Files:**
- Modify: `src/lib/erro-mensagem.ts` (mapa `POR_CODIGO`)
- Test: `tests/unit/erro-mensagem.test.ts` (novo)

**Interfaces:**
- Produces: `mensagemErro({ code: 'P0409', … })` → `"Outra pessoa salvou este registro agora há pouco. A tela foi atualizada — confira suas alterações e salve de novo."`

- [ ] **Step 1: Teste (falhando)**

```ts
// tests/unit/erro-mensagem.test.ts
import { describe, it, expect } from "vitest";
import { mensagemErro } from "../../src/lib/erro-mensagem";

describe("mensagemErro", () => {
  it("P0409 (conflito de versão) vira mensagem PT amigável", () => {
    expect(mensagemErro({ code: "P0409", message: "conflito_versao: x" }, "fallback"))
      .toMatch(/Outra pessoa salvou/);
  });
  it("P0001 continua passando a mensagem da RPC", () => {
    expect(mensagemErro({ code: "P0001", message: "Coleção de outra loja." }, "fb"))
      .toBe("Coleção de outra loja.");
  });
});
```

Run: `npx vitest run tests/unit/erro-mensagem.test.ts` → FAIL.

- [ ] **Step 2: Implementar** — em `POR_CODIGO`, acima de `P0001`:

```ts
  P0409: "Outra pessoa salvou este registro agora há pouco. A tela foi atualizada — confira suas alterações e salve de novo.",
```

- [ ] **Step 3: Rodar** → PASS. **Step 4: Commit** — `git add src/lib/erro-mensagem.ts tests/unit/erro-mensagem.test.ts && git commit -m "Colab: mensagem PT para conflito de versão (P0409)"`

---

### Task 4: `mergeDraft` + `mergeLinhas` (puros)

**Files:**
- Create: `src/lib/colab/merge.ts`
- Test: `tests/unit/colab-merge.test.ts`

**Interfaces:**
- Produces (exato — Task 6 consome):

```ts
export type Conflito = { path: string; meu: unknown; dele: unknown };
export type MergeResult<T> = { valor: T; conflitos: Conflito[]; atualizados: string[] };
export function mergeDraft<T extends Record<string, any>>(o: {
  base: T; draft: T; fresh: T; touched: ReadonlySet<string>;
}): MergeResult<T>;

export type LinhaId = { id?: string | null };
export function mergeLinhas<R extends LinhaId>(o: {
  base: R[]; draft: R[]; fresh: R[]; touchedIds: ReadonlySet<string>;
}): { linhas: R[]; conflitos: Conflito[]; atualizadas: string[] };
```

- [ ] **Step 1: Testes (falhando) — os 7 casos da spec**

```ts
// tests/unit/colab-merge.test.ts
import { describe, it, expect } from "vitest";
import { mergeDraft, mergeLinhas } from "../../src/lib/colab/merge";

describe("mergeDraft (escalar)", () => {
  const base = { a: 1, b: "x", c: null as string | null };
  it("campo NÃO tocado assume o fresh", () => {
    const r = mergeDraft({ base, draft: { ...base }, fresh: { ...base, a: 2 }, touched: new Set() });
    expect(r.valor.a).toBe(2); expect(r.conflitos).toEqual([]); expect(r.atualizados).toEqual(["a"]);
  });
  it("tocado e servidor NÃO mudou → mantém o meu", () => {
    const r = mergeDraft({ base, draft: { ...base, b: "meu" }, fresh: { ...base }, touched: new Set(["b"]) });
    expect(r.valor.b).toBe("meu"); expect(r.conflitos).toEqual([]);
  });
  it("tocado E servidor mudou → conflito (mantém o meu no valor)", () => {
    const r = mergeDraft({ base, draft: { ...base, b: "meu" }, fresh: { ...base, b: "dele" }, touched: new Set(["b"]) });
    expect(r.valor.b).toBe("meu");
    expect(r.conflitos).toEqual([{ path: "b", meu: "meu", dele: "dele" }]);
  });
});

describe("mergeLinhas (coleções por id)", () => {
  const L = (id: string, v: number) => ({ id, v });
  it("linha mudada só pelo servidor → resolve sozinha", () => {
    const r = mergeLinhas({ base: [L("1", 1)], draft: [L("1", 1)], fresh: [L("1", 9)], touchedIds: new Set() });
    expect(r.linhas).toEqual([L("1", 9)]); expect(r.conflitos).toEqual([]);
  });
  it("linha tocada pelos dois → conflito de LINHA (mantém a minha)", () => {
    const r = mergeLinhas({ base: [L("1", 1)], draft: [L("1", 5)], fresh: [L("1", 9)], touchedIds: new Set(["1"]) });
    expect(r.linhas).toEqual([L("1", 5)]);
    expect(r.conflitos).toHaveLength(1);
    expect(r.conflitos[0]).toMatchObject({ path: "linha:1" });
  });
  it("adições dos dois lados → união (minha sem id preservada; a dele entra)", () => {
    const minhaNova = { id: null, v: 7 };
    const r = mergeLinhas({ base: [], draft: [minhaNova], fresh: [L("9", 3)], touchedIds: new Set() });
    expect(r.linhas).toEqual(expect.arrayContaining([minhaNova, L("9", 3)]));
  });
  it("removida no servidor + tocada por mim → conflito (dele: null)", () => {
    const r = mergeLinhas({ base: [L("1", 1)], draft: [L("1", 5)], fresh: [], touchedIds: new Set(["1"]) });
    expect(r.conflitos[0]).toMatchObject({ path: "linha:1", dele: null });
    expect(r.linhas).toEqual([L("1", 5)]); // mantém a minha até resolver
  });
  it("removida no servidor e NÃO tocada → some", () => {
    const r = mergeLinhas({ base: [L("1", 1)], draft: [L("1", 1)], fresh: [], touchedIds: new Set() });
    expect(r.linhas).toEqual([]);
  });
});
```

Run: `npx vitest run tests/unit/colab-merge.test.ts` → FAIL (módulo não existe).

- [ ] **Step 2: Implementar**

```ts
// src/lib/colab/merge.ts
// Merge 3-vias do rascunho colaborativo (spec 2026-08-03). PURO e sem dependências:
// base = o que a tela carregou/último merge · draft = o que estou vendo ·
// fresh = o que chegou do servidor · touched = campos que EU editei.
export type Conflito = { path: string; meu: unknown; dele: unknown };
export type MergeResult<T> = { valor: T; conflitos: Conflito[]; atualizados: string[] };

export function mergeDraft<T extends Record<string, any>>(o: {
  base: T; draft: T; fresh: T; touched: ReadonlySet<string>;
}): MergeResult<T> {
  const valor: Record<string, any> = { ...o.draft };
  const conflitos: Conflito[] = [];
  const atualizados: string[] = [];
  for (const k of Object.keys(o.fresh)) {
    const mudouNoServidor = !igual(o.base[k], o.fresh[k]);
    if (!o.touched.has(k)) {
      if (mudouNoServidor) { valor[k] = o.fresh[k]; atualizados.push(k); }
    } else if (mudouNoServidor && !igual(o.draft[k], o.fresh[k])) {
      conflitos.push({ path: k, meu: o.draft[k], dele: o.fresh[k] }); // mantém o meu no valor
    }
  }
  return { valor: valor as T, conflitos, atualizados };
}

export type LinhaId = { id?: string | null };
export function mergeLinhas<R extends LinhaId>(o: {
  base: R[]; draft: R[]; fresh: R[]; touchedIds: ReadonlySet<string>;
}): { linhas: R[]; conflitos: Conflito[]; atualizadas: string[] } {
  const byId = (rs: R[]) => new Map(rs.filter((r) => r.id).map((r) => [r.id as string, r]));
  const bBase = byId(o.base), bFresh = byId(o.fresh);
  const conflitos: Conflito[] = [];
  const atualizadas: string[] = [];
  const out: R[] = [];
  for (const d of o.draft) {
    if (!d.id) { out.push(d); continue; }               // minha linha nova (sem id) sempre fica
    const f = bFresh.get(d.id), b = bBase.get(d.id);
    const tocada = o.touchedIds.has(d.id);
    if (!f) {                                            // sumiu no servidor
      if (tocada) { conflitos.push({ path: `linha:${d.id}`, meu: d, dele: null }); out.push(d); }
      continue;                                          // não tocada → some
    }
    const mudouNoServidor = !igual(b, f);
    if (!tocada) { out.push(mudouNoServidor ? f : d); if (mudouNoServidor) atualizadas.push(d.id); }
    else if (mudouNoServidor && !igual(d, f)) { conflitos.push({ path: `linha:${d.id}`, meu: d, dele: f }); out.push(d); }
    else out.push(d);
  }
  for (const f of o.fresh) {                             // linhas novas do servidor
    if (f.id && !o.draft.some((d) => d.id === f.id)) { out.push(f); atualizadas.push(f.id); }
  }
  return { linhas: out, conflitos, atualizadas };
}

function igual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}
```

- [ ] **Step 3: Rodar** → PASS (8 testes). **Step 4: Commit** — `git add src/lib/colab/ tests/unit/colab-merge.test.ts && git commit -m "Colab: mergeDraft/mergeLinhas (merge 3-vias puro)"`

---

### Task 5: Hook `useColabRegistro` (Realtime + presença)

**Files:**
- Create: `src/hooks/useColabRegistro.ts`

**Interfaces:**
- Consumes: `supabase` (`@/integrations/supabase/client`), `useAuth` (`@/hooks/useAuth`).
- Produces (exato — Task 6 consome):

```ts
export type PresencaColab = { userId: string; nome: string; campoFocado: string | null };
export function useColabRegistro(o: {
  canal: string | null;                    // ex.: `colab:oc:${ocId}`; null = desligado
  tabela: "ocs_tecido" | "modelos" | "colecoes";
  registroId: string | null;
  onMudancaServidor: () => void;           // disparado ao chegar UPDATE da linha-raiz
  campoFocado?: string | null;             // path do campo que EU estou editando (presença de campo)
}): { presentes: PresencaColab[] };
```

- [ ] **Step 1: Implementar** (sem unit — é cola de infra; a verificação é o QA da Task 7)

```ts
// src/hooks/useColabRegistro.ts
// Canal colaborativo por registro-agregado (spec 2026-08-03):
// 1) postgres_changes (UPDATE na linha-RAIZ — os bumps de filha garantem o evento)
//    → onMudancaServidor() (a tela re-busca e faz o merge; o próprio eco do meu save
//    é inofensivo: o merge vira no-op).
// 2) presence: quem está na tela + qual campo está focando (SEM conteúdo do rascunho).
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type PresencaColab = { userId: string; nome: string; campoFocado: string | null };

export function useColabRegistro(o: {
  canal: string | null;
  tabela: "ocs_tecido" | "modelos" | "colecoes";
  registroId: string | null;
  onMudancaServidor: () => void;
  campoFocado?: string | null;
}): { presentes: PresencaColab[] } {
  const { user } = useAuth();
  const [presentes, setPresentes] = useState<PresencaColab[]>([]);
  const onMudancaRef = useRef(o.onMudancaServidor);
  onMudancaRef.current = o.onMudancaServidor;

  // nome de exibição (public.users.nome; cai no e-mail se não achar)
  const { data: meuNome } = useQuery({
    queryKey: ["colab-meu-nome", user?.id],
    enabled: !!user,
    staleTime: Infinity,
    queryFn: async () =>
      (await supabase.from("users").select("nome").eq("id", user!.id).maybeSingle()).data?.nome
      ?? user!.email ?? "Alguém",
  });

  const chave = useMemo(() => (o.canal && o.registroId && user ? o.canal : null), [o.canal, o.registroId, user]);

  useEffect(() => {
    if (!chave || !meuNome) return;
    const ch = supabase.channel(chave, { config: { presence: { key: user!.id } } });
    ch.on("postgres_changes",
      { event: "UPDATE", schema: "public", table: o.tabela, filter: `id=eq.${o.registroId}` },
      () => onMudancaRef.current());
    ch.on("presence", { event: "sync" }, () => {
      const state = ch.presenceState<{ nome: string; campoFocado: string | null }>();
      setPresentes(
        Object.entries(state)
          .filter(([uid]) => uid !== user!.id)
          .map(([uid, metas]) => ({ userId: uid, nome: metas[0]?.nome ?? "Alguém", campoFocado: metas[0]?.campoFocado ?? null })),
      );
    });
    ch.subscribe((status) => {
      if (status === "SUBSCRIBED") void ch.track({ nome: meuNome, campoFocado: o.campoFocado ?? null });
    });
    return () => { void supabase.removeChannel(ch); setPresentes([]); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave, meuNome]);

  // atualiza o campo focado sem recriar o canal
  useEffect(() => {
    if (!chave || !meuNome) return;
    const ch = supabase.getChannels().find((c) => c.topic === `realtime:${chave}`);
    if (ch) void ch.track({ nome: meuNome, campoFocado: o.campoFocado ?? null });
  }, [o.campoFocado, chave, meuNome]);

  return { presentes };
}
```

- [ ] **Step 2: Gate** — `npx tsc --noEmit` limpo + `npm run build` ✓.
- [ ] **Step 3: Commit** — `git add src/hooks/useColabRegistro.ts && git commit -m "Colab: hook useColabRegistro (Realtime raiz + presença tela/campo)"`

---

### Task 6: Piloto — OC Tecido

**Files:**
- Modify: `src/routes/_authenticated/entrada-saida.oc-tecido.tsx` (componente de detalhe: seed em `:378-430`, `saveMutation` em `:660`, header do Sheet)
- Create: `src/components/shared/ColabBanner.tsx` (banner + chips de presença — reutilizável pelas telas seguintes)

**Interfaces:**
- Consumes: `mergeDraft`/`mergeLinhas` (Task 4), `useColabRegistro` (Task 5), `salvar_oc_tecido(..., _rev_base)` (Task 2), `mensagemErro` P0409 (Task 3).
- Produces: padrão de adoção para as próximas telas (touched-tracking por diff no setState; merge no refetch; save protegido com re-tentativa 1×).

**Passos:**

- [ ] **Step 1: `ColabBanner` (novo, compartilhado)**

```tsx
// src/components/shared/ColabBanner.tsx
// Banner de colaboração: presença ("Fulano também está aqui") + resultado de merge
// ("Fulano salvou agora — N campos atualizados · M em conflito"). Sem bloquear o trabalho.
import { Users } from "lucide-react";
import type { Conflito } from "@/lib/colab/merge";
import type { PresencaColab } from "@/hooks/useColabRegistro";

export function ColabBanner({ presentes, ultimoMerge }: {
  presentes: PresencaColab[];
  ultimoMerge: { atualizados: number; conflitos: Conflito[] } | null;
}) {
  if (presentes.length === 0 && !ultimoMerge) return null;
  return (
    <div className="space-y-1">
      {presentes.length > 0 && (
        <div className="flex items-center gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300">
          <Users className="h-3.5 w-3.5 shrink-0" />
          {presentes.map((p) => p.nome).join(", ")} também {presentes.length > 1 ? "estão" : "está"} nesta tela
        </div>
      )}
      {ultimoMerge && (ultimoMerge.atualizados > 0 || ultimoMerge.conflitos.length > 0) && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          Alguém salvou agora — {ultimoMerge.atualizados} campo(s) atualizado(s)
          {ultimoMerge.conflitos.length > 0 && <> · <b>{ultimoMerge.conflitos.length} em conflito</b> (escolha manter ou usar o novo em cada campo destacado)</>}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Rastreio de `touched` SEM tocar nos filhos** — no componente de detalhe da OC, substituir o repasse direto de `setDraft`/`setItems` por wrappers que DIFEREM prev→next e marcam o que mudou (os filhos continuam recebendo a mesma assinatura — zero mudança neles):

```tsx
const touchedRef = useRef<Set<string>>(new Set());
const touchedItemIdsRef = useRef<Set<string>>(new Set());
const setDraftTracked: typeof setDraft = (upd) =>
  setDraft((prev) => {
    const next = typeof upd === "function" ? (upd as (p: Draft) => Draft)(prev) : upd;
    for (const k of Object.keys(next) as (keyof Draft)[])
      if (next[k] !== prev[k]) touchedRef.current.add(String(k));
    return next;
  });
const setItemsTracked: typeof setItems = (upd) =>
  setItems((prev) => {
    const next = typeof upd === "function" ? (upd as (p: ItemDraft[]) => ItemDraft[])(prev) : upd;
    for (const n of next) {
      const p = prev.find((x) => x.id && x.id === n.id);
      if (n.id && (!p || JSON.stringify(p) !== JSON.stringify(n))) touchedItemIdsRef.current.add(n.id);
    }
    return next;
  });
```
Trocar TODOS os usos internos e repasses (`setDraft={setDraft}` → `setDraft={setDraftTracked}`, linhas ~993/1018 e demais; idem items). Limpar os dois Sets no seed inicial e após salvar (`markClean`).

- [ ] **Step 3: Seed → merge no refetch** — hoje o `queryFn` (`:381-430`) re-semeia o rascunho ÀS CEGAS a cada refetch (um refetch por foco de janela JÁ descarta edição do usuário — bug latente que este passo conserta). Refatorar: `queryFn` passa a SÓ retornar `{ oc, its }`; a semeadura vai para um `useEffect` sobre `data`:

```tsx
const baseRef = useRef<{ draft: Draft; items: ItemDraft[] } | null>(null);
const revRef = useRef<number | null>(null);
const [ultimoMerge, setUltimoMerge] = useState<{ atualizados: number; conflitos: Conflito[] } | null>(null);
const [conflitos, setConflitos] = useState<Conflito[]>([]);

useEffect(() => {
  if (!data?.oc) return;
  const freshDraft = draftFromOc(data.oc);        // extrair o mapeamento atual (:389-409) p/ função pura
  const freshItems = itemsFromRows(data.its);     // extrair o mapeamento atual (:413-424)
  revRef.current = (data.oc as any).rev ?? null;  // rev vem no select("*")
  if (!baseRef.current) {                          // 1ª carga: seed normal
    baseRef.current = { draft: freshDraft, items: freshItems };
    setDraft(freshDraft); setItems(freshItems); /* … status/tecido2Aberto como hoje … */
    return;
  }
  // refetch (Realtime/foco): MERGE em vez de sobrescrever
  const md = mergeDraft({ base: baseRef.current.draft, draft, fresh: freshDraft, touched: touchedRef.current });
  const ml = mergeLinhas({ base: baseRef.current.items, draft: items, fresh: freshItems, touchedIds: touchedItemIdsRef.current });
  setDraft(md.valor); setItems(ml.linhas);
  setConflitos([...md.conflitos, ...ml.conflitos]);
  setUltimoMerge({ atualizados: md.atualizados.length + ml.atualizadas.length, conflitos: [...md.conflitos, ...ml.conflitos] });
  baseRef.current = { draft: freshDraft, items: freshItems };
}, [data]);
```

- [ ] **Step 4: Ligar o hook + banner + conflito por campo**

```tsx
const { presentes } = useColabRegistro({
  canal: ocId ? `colab:oc:${ocId}` : null,
  tabela: "ocs_tecido", registroId: ocId ?? null,
  onMudancaServidor: () => qc.invalidateQueries({ queryKey: ["oc-tecido", ocId] }),
});
```
`<ColabBanner presentes={presentes} ultimoMerge={ultimoMerge} />` no topo do Sheet de detalhe. Campo em conflito: helper `emConflito(path) => conflitos.some(c => c.path === path)` → borda âmbar (`ring-1 ring-amber-500`) + botõezinhos "manter meu · usar o novo" (usar o novo = aplica `dele` no draft, tira do set e remove de `touched`); aplicar nos campos do CABEÇALHO da OC (numero_pedido, datas, prazo, valores) e no realce da LINHA de item em conflito.

**Presença de CAMPO (spec):** os inputs do cabeçalho ganham `data-colab-path="numero_pedido"` (etc.); um `onFocusCapture`/`onBlurCapture` no container do form alimenta `const [campoFocado, setCampoFocado] = useState<string|null>(null)` lendo `(e.target as HTMLElement).dataset?.colabPath ?? null`, e `campoFocado` é passado ao `useColabRegistro`. No sentido inverso, o campo cujo path casa com `presentes[i].campoFocado` ganha `ring-1 ring-sky-400` + `title={`${nome} está neste campo`}` (helper `focadoPor(path) => presentes.find(p => p.campoFocado === path)?.nome`).

- [ ] **Step 5: Save protegido + re-tentativa 1×** — no `saveMutation` (`:660`): incluir `_rev_base: revRef.current` na chamada `rpc("salvar_oc_tecido", …)`; no `onError`, se `e.code === "P0409"`: `await qc.invalidateQueries(["oc-tecido", ocId])` (o merge roda), e se `conflitos.length === 0` re-disparar o save UMA vez (flag `retryRef` pra não loopar); senão, toast `mensagemErro(e, …)` e o usuário resolve os campos destacados. Após save OK: limpar touched/conflitos + `markClean()` (o próprio eco do Realtime atualiza `baseRef`/`revRef`).

- [ ] **Step 6: Gates + QA rápido** — `npx tsc --noEmit` + `npm run build` + abrir a OC no dev server e salvar normalmente (fluxo de sempre intacto; canal aparece no Network/WS).

- [ ] **Step 7: Commit** — `git add -A && git commit -m "Colab piloto OC Tecido: merge no refetch, conflitos por campo, presença e save protegido (_rev_base)"`

---

### Task 7: QA ao vivo (2 sessões) + documentação

**Files:**
- Create: script QA no scratchpad (2 contexts Playwright) — não commitado
- Modify: `CLAUDE.md` (bloco Convenções: padrão colab/rev) · memória (`project_colab_concorrencia.md` + linha no `MEMORY.md`)

**Passos:**

- [ ] **Step 1: QA merge/trava (2 abas, mesmo usuário serve)** — Playwright com 2 contexts logados na MESMA OC: na aba A editar `numero_pedido` e salvar → na aba B (sem tocar nesse campo) o valor troca sozinho em <2s + banner aparece; na aba B editar o MESMO campo antes do save de A → vira conflito destacado com as duas opções; escolher "usar o novo" limpa. Derrubar o WS (devtools offline) na B, salvar em A, salvar em B → P0409 + mensagem PT + re-busca (trava segura sem Realtime).
- [ ] **Step 2: QA presença (2 usuários)** — presença exclui o próprio userId, então 2 abas do mesmo usuário NÃO se veem (correto). Validar com uma 2ª conta da mesma loja se existir; senão, deixar anotado para o dono validar com um colega (limitação honesta do ambiente de teste).
- [ ] **Step 3: Regressão final** — `npm run build` + `npx tsc --noEmit` + `npx vitest run tests/unit tests/integration` (nada novo quebrando).
- [ ] **Step 4: Docs** — CLAUDE.md: parágrafo curto em Convenções ("telas colaborativas usam rev/_rev_base + useColabRegistro + mergeDraft; adotar nas telas quentes; spec em docs/superpowers/specs/…"). Memória: arquivo novo `project_colab_concorrencia.md` (o quê/por quê/como aplicar + estado da adoção) + linha no `MEMORY.md`.
- [ ] **Step 5: Commit + push** — `git add -A && git commit -m "Colab: QA 2 sessões + docs do padrão" && git push origin feature/plan-tecido-a1`

---

## Fora deste plano (planos seguintes, um por tela)

Adoção nas 3 telas restantes — cada uma é um plano curto repetindo o padrão da Task 6:
1. **Desenvolvimento (Sheet)** — canal `colab:modelo:{id}`; save `salvar_modelo_bom(_rev_base)`; touched já parcialmente existente (`camposCopiados`).
2. **Plan. Produto** — save por UPDATE direto: `.update(...).eq('id', id).eq('rev', revBase).select()` → 0 linhas = conflito (contrato da spec).
3. **Plan. Tecido** — canal `colab:plan:{colecaoId}` (escuta `colecoes`); save `salvar_plan_tecido(_rev_base)`; merge por slot (`mergeLinhas` com id do slot).
