# Kanban PL configurável — Onda 1 (banco base) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Pôr no banco a fundação do kanban PL configurável (estado persistido + configs por loja + catálogo/avaliador de condições PL + seed das 5 etapas), SEM mudar nada na tela — a chave fica desligada e a tela do PL continua a de hoje.

**Architecture:** Espelha o kanban do Desenvolvimento, mas num "board PL" próprio. Esta onda só cria as estruturas de dados e o avaliador; o motor (fila/trigger/mover), o front e a migração vêm nas ondas 2-4. Tudo aditivo e inerte até a Onda 3 ligar a tela.

**Tech Stack:** Postgres 17 (migrations aditivas + `salvar_config_loja` CAS por coluna), React+TS (catálogo puro + anti-drift Vitest).

**Spec:** `docs/superpowers/specs/2026-11-12-kanban-pl-configuravel-design.md`

## Global Constraints

- **Branch ATIVA:** `feature/plan-tecido-a1` (não criar branch nova).
- **Onda 1 é SÓ BANCO + libs puras:** nenhuma mudança na tela do PL. `etapas_pl_automatico` default `false` → nada deriva, nada move. Inerte até a Onda 3.
- **Migrations aditivas, idempotentes:** `ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE`. Guarda md5 ANTES/DEPOIS das funções redefinidas (`salvar_config_loja`). Pós-condições de ACL.
- **`_core` DEFINER com REVOKE dos 3** (`REVOKE EXECUTE … FROM PUBLIC, anon, authenticated`); confere com `has_function_privilege(...)=false`.
- **RAISE 5xx só ASCII** (prefixos técnicos ASCII; P0001 = 400).
- **Testes DDL só na CÓPIA LOCAL** (`/tmp/dburl-local.txt`, porta 54422), txn revertida; NUNCA DDL em produção; NUNCA `\i` migration em txn de teste; subagente usa `DATABASE_URL` LOCAL SEMPRE.
- **Banco ANTES do site** (não há site nesta onda, mas a migration vai sozinha ao ar; é inofensiva com a chave desligada).
- **Reuso, não motor novo:** avaliador PL reusa `_peca_teste_aprovada`, `_cq_liberado`, `cad.enviado_corte`, `modelos.lancado`, e os blocos `producao_terceirizados`.

## Review Focus

- **Config vazia / loja sem `etapas_pl_kanban`:** o avaliador e o seed devem tratar ausência como "usa o padrão das 5 etapas", nunca quebrar. Pinado no teste da Task 4 (seed) e Task 3 (avaliador com loja sem config).
- **Consolidação "menos avançada" com 0 blocos:** um modelo sem nenhum bloco de serviço relevante — as condições de bloco (`materiais_separados` etc.) devem ter um valor definido (vacuosamente true ou false, decidido na Task 3), não `null`/erro. Pinado no teste da Task 3.
- **`salvar_config_loja` com as 4 colunas novas:** gravar uma só não apaga as outras; valor de tipo errado recusa P0001; CAS detecta conflito. Pinado no teste da Task 2.
- **Catálogo PL ↔ avaliador SQL divergentes:** uma key no TS sem branch no SQL (ou vice-versa) quebraria o board na Onda 3. Pinado no anti-drift da Task 3.
- **Migração não sobrescreve customização:** loja que já renomeou/desativou uma `pcp_etapas` não perde isso no seed de `etapas_pl_kanban`. Pinado no teste da Task 4.

---

## File Structure

- **`supabase/migrations/20261126100000_kanban_pl_onda1.sql`** (criar) — bloco A (estado) + bloco B (4 configs + `salvar_config_loja`) + bloco D (seed das 5 etapas). Uma migration (as 3 são aditivas e coesas: estado + config + seed).
- **`supabase/migrations/20261126110000_kanban_pl_avaliador.sql`** (criar) — bloco C SQL (catálogo→avaliador `avaliar_condicoes_etapas_pl` + `_core`). Arquivo próprio (depende das colunas da 100000; e é a peça "lógica" revisável à parte).
- **`supabase/rollback/20261126100000_kanban_pl_onda1_down.sql`** + **`_down_drop.sql`** (criar).
- **`supabase/rollback/20261126110000_kanban_pl_avaliador_down.sql`** (criar).
- **`src/lib/etapas-pl-condicoes.ts`** (criar) — catálogo TS `CONDICOES_PL` + `requisitosOkPL` + `CONDICAO_PL_BY_KEY`.
- **`src/lib/config-loja-colab.ts`** (modificar) — 4 colunas novas em `COLUNAS_PAGINA`/type/`ROTULOS`.
- **`tests/integration/kanban-pl-onda1.test.ts`** (criar) — salvar_config_loja + avaliador + seed.
- **`tests/integration/kanban-pl-condicoes.test.ts`** (criar) — anti-drift catálogo↔RPC.
- **`tests/unit/etapas-pl-condicoes.test.ts`** (criar) — `requisitosOkPL`.

---

## Task 1: Estado persistido — coluna + histórico (bloco A)

**Files:**
- Create: `supabase/migrations/20261126100000_kanban_pl_onda1.sql` (parte A; B e D nas Tasks 2 e 4, MESMO arquivo)
- Create: `supabase/rollback/20261126100000_kanban_pl_onda1_down.sql` (parte A)
- Test: `tests/integration/kanban-pl-onda1.test.ts` (parte A)

**Interfaces:**
- Produces: `modelos.status_etapa_pl text` (NULL = fora do PL); tabela `modelo_etapa_pl_historico (id, tenant_id, modelo_id FK modelos ON DELETE CASCADE, status text, entrou_at timestamptz, created_at timestamptz, origem text, lote_id uuid)` com RLS (SELECT por tenant) + índices.

- [ ] **Step 1: Teste — a coluna e a tabela existem após a migration (falha: não existem)**

```ts
// tests/integration/kanban-pl-onda1.test.ts
import { describe, it, expect } from "vitest";
import { withTx } from "./db"; // usar o helper REAL da suíte (ver tests/integration/db.ts)

describe("Kanban PL Onda 1 — estado (bloco A)", () => {
  it("modelos.status_etapa_pl existe (text, nullable)", async () => {
    await withTx(async (sql) => {
      const r = await sql`select data_type, is_nullable from information_schema.columns
        where table_name='modelos' and column_name='status_etapa_pl'`;
      expect(r[0]?.data_type).toBe("text");
      expect(r[0]?.is_nullable).toBe("YES");
    });
  });
  it("modelo_etapa_pl_historico existe com RLS ligada", async () => {
    await withTx(async (sql) => {
      const c = await sql`select count(*)::int n from information_schema.tables where table_name='modelo_etapa_pl_historico'`;
      expect(c[0].n).toBe(1);
      const rls = await sql`select relrowsecurity from pg_class where relname='modelo_etapa_pl_historico'`;
      expect(rls[0].relrowsecurity).toBe(true);
    });
  });
});
```

> Nota ao implementador: use o helper REAL da suíte (leia `tests/integration/db.ts` e um teste vizinho; o esqueleto chama `withTx` genericamente — adapte ao nome real sem mudar as asserções).

- [ ] **Step 2: Rodar e ver falhar**

Run: `DATABASE_URL="$(cat /tmp/dburl-local.txt)" npx vitest run tests/integration/kanban-pl-onda1.test.ts --no-file-parallelism`
Expected: FAIL (coluna/tabela não existem).

- [ ] **Step 3: Escrever o bloco A da migration**

`supabase/migrations/20261126100000_kanban_pl_onda1.sql`, dentro de `BEGIN; … COMMIT;`:
```sql
ALTER TABLE public.modelos ADD COLUMN IF NOT EXISTS status_etapa_pl text;
COMMENT ON COLUMN public.modelos.status_etapa_pl IS 'Kanban PL (campanha nov/2026): key da etapa PL atual do modelo; NULL = fora do PL. Inerte ate a Onda 3.';

CREATE TABLE IF NOT EXISTS public.modelo_etapa_pl_historico (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  modelo_id uuid NOT NULL REFERENCES public.modelos(id) ON DELETE CASCADE,
  status text NOT NULL,
  entrou_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  origem text NOT NULL DEFAULT 'manual',
  lote_id uuid
);
CREATE INDEX IF NOT EXISTS idx_mepl_modelo ON public.modelo_etapa_pl_historico(modelo_id, entrou_at);
CREATE INDEX IF NOT EXISTS idx_mepl_tenant ON public.modelo_etapa_pl_historico(tenant_id);
ALTER TABLE public.modelo_etapa_pl_historico ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mepl_tenant_select ON public.modelo_etapa_pl_historico;
CREATE POLICY mepl_tenant_select ON public.modelo_etapa_pl_historico FOR SELECT
  USING (tenant_id = public.get_user_tenant_id());
-- Escrita só por trigger/RPC DEFINER (owner postgres bypassa RLS) — sem policy de INSERT p/ cliente.
```

- [ ] **Step 4: Aplicar na cópia local e rodar (passa)**

Run:
```bash
psql "$(cat /tmp/dburl-local.txt)" -v ON_ERROR_STOP=1 -f supabase/migrations/20261126100000_kanban_pl_onda1.sql
DATABASE_URL="$(cat /tmp/dburl-local.txt)" npx vitest run tests/integration/kanban-pl-onda1.test.ts --no-file-parallelism
```
Expected: os 2 testes do bloco A PASSAM.

- [ ] **Step 5: Rollback do bloco A**

`…_down.sql`: `DROP TABLE IF EXISTS public.modelo_etapa_pl_historico;` + `ALTER TABLE public.modelos DROP COLUMN IF EXISTS status_etapa_pl;` (comentar: AccessExclusive em `modelos` → `_down_drop`, horário calmo; o `_down` principal da Onda deixa isso no `_down_drop` separado se preferir — para a Task 1 basta este DROP num `_down_drop` próprio). Nesta onda, como são objetos NOVOS sem dado de produção ainda, o `_down` pode dropar direto; documente a trava.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261126100000_kanban_pl_onda1.sql supabase/rollback/20261126100000_kanban_pl_onda1_down.sql tests/integration/kanban-pl-onda1.test.ts
git commit -m "feat(kanban-pl): estado persistido status_etapa_pl + historico (Onda 1 A)"
```

---

## Task 2: Configs por loja + salvar_config_loja (bloco B)

**Files:**
- Modify: `supabase/migrations/20261126100000_kanban_pl_onda1.sql` (acrescenta bloco B — MESMO arquivo da Task 1)
- Modify: `supabase/rollback/20261126100000_kanban_pl_onda1_down.sql` (acrescenta a reversão do salvar_config_loja)
- Modify: `src/lib/config-loja-colab.ts`
- Test: `tests/integration/kanban-pl-onda1.test.ts` (parte B)

**Interfaces:**
- Consumes: `salvar_config_loja(_tenant_id uuid, _mudancas jsonb, _base jsonb, _chave_kanban_esperada boolean)` VIVA (a mais recente é `20261112110000`). ⚠️ O 4º arg é **boolean**.
- Produces: 4 colunas novas em `tenant_config`: `etapas_pl_kanban jsonb NOT NULL DEFAULT '[]'`, `etapas_pl_requisitos jsonb NOT NULL DEFAULT '{}'`, `etapas_pl_automatico boolean NOT NULL DEFAULT false`, `etapas_pl_aba_peca_teste_status text`. Todas na lista branca do `salvar_config_loja`. `config-loja-colab.ts` com as 4 em `COLUNAS_PAGINA`/type/`ROTULOS`.

- [ ] **Step 1: Teste — gravar as 4 colunas via salvar_config_loja (falha: colunas/whitelist não existem)**

```ts
// acrescentar a tests/integration/kanban-pl-onda1.test.ts
import { comoUsuario, TENANT_TESTE, USER_ADMIN_TESTE } from "./db"; // helpers reais

describe("Kanban PL Onda 1 — configs (bloco B)", () => {
  it("grava etapas_pl_kanban/_requisitos/_automatico/_aba via salvar_config_loja", async () => {
    await withTx(async (sql) => {
      await comoUsuario(sql, USER_ADMIN_TESTE);
      const mud = {
        etapas_pl_kanban: ["Peça Teste", "Separação de Materiais"],
        etapas_pl_requisitos: { separacao: ["peca_teste_aprovada"] },
        etapas_pl_automatico: true,
        etapas_pl_aba_peca_teste_status: "peca_teste",
      };
      await sql`select salvar_config_loja(${TENANT_TESTE}, ${JSON.stringify(mud)}::jsonb, '{}'::jsonb, null)`;
      const r = await sql`select etapas_pl_kanban, etapas_pl_requisitos, etapas_pl_automatico, etapas_pl_aba_peca_teste_status
        from tenant_config where tenant_id = ${TENANT_TESTE}`;
      expect(r[0].etapas_pl_kanban).toEqual(["Peça Teste", "Separação de Materiais"]);
      expect(r[0].etapas_pl_automatico).toBe(true);
      expect(r[0].etapas_pl_aba_peca_teste_status).toBe("peca_teste");
    });
  });
  it("recusa etapas_pl_kanban não-array (P0001)", async () => {
    await withTx(async (sql) => {
      await comoUsuario(sql, USER_ADMIN_TESTE);
      await expect(sql`select salvar_config_loja(${TENANT_TESTE}, '{"etapas_pl_kanban":"x"}'::jsonb, '{}'::jsonb, null)`)
        .rejects.toThrow(/Formato inv|P0001/);
    });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `DATABASE_URL="$(cat /tmp/dburl-local.txt)" npx vitest run tests/integration/kanban-pl-onda1.test.ts --no-file-parallelism`
Expected: FAIL (colunas não existem / não na whitelist).

- [ ] **Step 3: Migration bloco B**

Acrescentar ao `20261126100000_kanban_pl_onda1.sql`:
1. Colunas:
```sql
ALTER TABLE public.tenant_config ADD COLUMN IF NOT EXISTS etapas_pl_kanban jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.tenant_config ADD COLUMN IF NOT EXISTS etapas_pl_requisitos jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.tenant_config ADD COLUMN IF NOT EXISTS etapas_pl_automatico boolean NOT NULL DEFAULT false;
ALTER TABLE public.tenant_config ADD COLUMN IF NOT EXISTS etapas_pl_aba_peca_teste_status text;
```
2. Redefinir `salvar_config_loja` (gerar do `pg_get_functiondef` VIVO; guardar md5 ANTES). Editar 3 pontos, espelhando o template `insumos_padrao`/`revenda_kanban_colunas` (migration `20261103174000`):
   - `c_permitidas` += `'etapas_pl_kanban','etapas_pl_requisitos','etapas_pl_automatico','etapas_pl_aba_peca_teste_status'`. (NÃO em `c_kanban` — a chave automático do PL tem porta própria na Onda 2; por ora grava como coluna normal.)
   - Validação no `CASE v_k` (passo 3):
```sql
      WHEN 'etapas_pl_kanban' THEN
        IF v_t = 'null' THEN RAISE EXCEPTION 'O campo "%" nao pode ficar vazio.', v_k USING ERRCODE='P0001';
        ELSIF v_t <> 'array' THEN RAISE EXCEPTION 'Formato invalido para o campo "%".', v_k USING ERRCODE='P0001'; END IF;
      WHEN 'etapas_pl_requisitos' THEN
        IF v_t NOT IN ('object') THEN RAISE EXCEPTION 'Formato invalido para o campo "%".', v_k USING ERRCODE='P0001'; END IF;
      WHEN 'etapas_pl_automatico' THEN
        IF v_t NOT IN ('boolean') THEN RAISE EXCEPTION 'Formato invalido para o campo "%".', v_k USING ERRCODE='P0001'; END IF;
      WHEN 'etapas_pl_aba_peca_teste_status' THEN
        IF v_t NOT IN ('string','null') THEN RAISE EXCEPTION 'Formato invalido para o campo "%".', v_k USING ERRCODE='P0001'; END IF;
```
   - UPDATE estático (passo 6), uma linha CASE por coluna (como `kanban_requisitos`):
```sql
    etapas_pl_kanban = CASE WHEN v_m ? 'etapas_pl_kanban' THEN v_m -> 'etapas_pl_kanban' ELSE etapas_pl_kanban END,
    etapas_pl_requisitos = CASE WHEN v_m ? 'etapas_pl_requisitos' THEN v_m -> 'etapas_pl_requisitos' ELSE etapas_pl_requisitos END,
    etapas_pl_automatico = CASE WHEN v_m ? 'etapas_pl_automatico' THEN (v_m ->> 'etapas_pl_automatico')::boolean ELSE etapas_pl_automatico END,
    etapas_pl_aba_peca_teste_status = CASE WHEN v_m ? 'etapas_pl_aba_peca_teste_status' THEN nullif(v_m ->> 'etapas_pl_aba_peca_teste_status','') ELSE etapas_pl_aba_peca_teste_status END,
```
   - Pós-condição: md5 do `salvar_config_loja` MUDOU; ACL inalterada.

- [ ] **Step 4: Front — config-loja-colab.ts**

- `COLUNAS_PAGINA` += `"etapas_pl_kanban","etapas_pl_requisitos","etapas_pl_automatico","etapas_pl_aba_peca_teste_status"`.
- Type `ConfigLojaColab` += `etapas_pl_kanban: string[]; etapas_pl_requisitos: Record<string,string[]>; etapas_pl_automatico: boolean; etapas_pl_aba_peca_teste_status: string | null;`.
- `ROTULOS` += `etapas_pl_kanban: "Etapas do PL (colunas)", etapas_pl_requisitos: "Requisitos das Etapas PL", etapas_pl_automatico: "Kanban PL automático", etapas_pl_aba_peca_teste_status: "Aba Peça Teste a partir de"`.
- (São colunas normais, não-kanban → vão pelo diff padrão, não `diffKanban`.)

- [ ] **Step 5: Aplicar + tsc + testes**

Run:
```bash
psql "$(cat /tmp/dburl-local.txt)" -v ON_ERROR_STOP=1 -f supabase/migrations/20261126100000_kanban_pl_onda1.sql
DATABASE_URL="$(cat /tmp/dburl-local.txt)" npx vitest run tests/integration/kanban-pl-onda1.test.ts --no-file-parallelism
npx tsc --noEmit 2>&1 | grep -E "config-loja-colab" | head
```
Expected: testos B PASSAM; tsc sem erro.

- [ ] **Step 6: Rollback bloco B + commit**

`…_down.sql`: `CREATE OR REPLACE` de `salvar_config_loja` com o corpo ANTERIOR (sem as 4 colunas); as colunas ficam (vão no `_down_drop`). Guarda md5.
```bash
git add supabase/migrations/20261126100000_kanban_pl_onda1.sql supabase/rollback/20261126100000_kanban_pl_onda1_down.sql src/lib/config-loja-colab.ts tests/integration/kanban-pl-onda1.test.ts
git commit -m "feat(kanban-pl): 4 configs por loja + salvar_config_loja (Onda 1 B)"
```

---

## Task 3: Catálogo PL + avaliador SQL (bloco C)

**Files:**
- Create: `src/lib/etapas-pl-condicoes.ts`
- Create: `supabase/migrations/20261126110000_kanban_pl_avaliador.sql`
- Create: `supabase/rollback/20261126110000_kanban_pl_avaliador_down.sql`
- Test: `tests/unit/etapas-pl-condicoes.test.ts`, `tests/integration/kanban-pl-condicoes.test.ts`

**Interfaces:**
- Consumes: `_peca_teste_aprovada(uuid,uuid,uuid)`, `_cq_liberado(uuid)`, `cad.enviado_corte`, `modelos.lancado`, `producao_terceirizados`.
- Produces: `CONDICOES_PL: CondicaoPL[]` (type `{ key, label, descricao? }`), `CONDICAO_PL_BY_KEY`, `requisitosOkPL(requisitos, satisfeitas)`; RPC `avaliar_condicoes_etapas_pl(_ids uuid[]) RETURNS jsonb` + `_core(_tenant,_ids)` (mapa `{modelo_id:{cond_key:bool}}`), DEFINER + REVOKE dos 3, gate `producao`+`etapas_pl`.

- [ ] **Step 1: Catálogo TS + teste unit do requisitosOkPL**

`src/lib/etapas-pl-condicoes.ts`:
```ts
// Catálogo PRÓPRIO do kanban PL (condições de produção). Espelho do shape de kanban-condicoes.ts,
// mas enxuto. O avaliador SQL (avaliar_condicoes_etapas_pl) tem um branch por key — anti-drift em
// tests/integration/kanban-pl-condicoes.test.ts.
export type CondicaoPL = { key: string; label: string; descricao?: string };
export const CONDICOES_PL: CondicaoPL[] = [
  { key: "peca_teste_aprovada", label: "Peça teste aprovada", descricao: "Toda linha que exige peça teste está aprovada (M.O. + peça teste)." },
  { key: "enviado_a_servicos", label: "Enviado a Serviços", descricao: "O modelo saiu da Explosão (cad.enviado_corte)." },
  { key: "materiais_separados", label: "Materiais separados", descricao: "TODOS os blocos de serviço do modelo têm a data de envio preenchida." },
  { key: "grade_cortada_retornou", label: "Grade cortada retornou", descricao: "TODOS os blocos relevantes têm alguma peça cortada retornada." },
  { key: "oficina_entregue", label: "Oficina entregue", descricao: "TODOS os blocos de oficina entregaram (data entregue + recebido)." },
  { key: "cq_liberado", label: "CQ liberado", descricao: "CQ Pré (e Pós, quando há) confirmado." },
  { key: "lancado", label: "Lançado", descricao: "O modelo foi lançado." },
];
export const CONDICAO_PL_BY_KEY = new Map(CONDICOES_PL.map((c) => [c.key, c]));
/** Requisitos satisfeitos? (todos em E). `satisfeitas` = mapa {key:bool} da RPC. */
export function requisitosOkPL(requisitos: string[] | undefined, satisfeitas: Record<string, boolean>): { ok: boolean; faltando: CondicaoPL[] } {
  const reqs = requisitos ?? [];
  const faltando = reqs.filter((k) => !satisfeitas[k]).map((k) => CONDICAO_PL_BY_KEY.get(k)).filter(Boolean) as CondicaoPL[];
  return { ok: faltando.length === 0, faltando };
}
```
`tests/unit/etapas-pl-condicoes.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { requisitosOkPL, CONDICAO_PL_BY_KEY } from "@/lib/etapas-pl-condicoes";
describe("requisitosOkPL", () => {
  it("vazio = ok", () => expect(requisitosOkPL([], {}).ok).toBe(true));
  it("falta uma = não ok, lista o label", () => {
    const r = requisitosOkPL(["peca_teste_aprovada"], { peca_teste_aprovada: false });
    expect(r.ok).toBe(false);
    expect(r.faltando[0].label).toBe("Peça teste aprovada");
  });
  it("key desconhecida é ignorada", () => expect(requisitosOkPL(["xxx"], {}).faltando).toEqual([]));
});
```

- [ ] **Step 2: Rodar unit (passa) e escrever o teste de integração do avaliador (falha)**

Run: `npx vitest run tests/unit/etapas-pl-condicoes.test.ts` → PASS.
`tests/integration/kanban-pl-condicoes.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { withTx, comoUsuario, TENANT_TESTE, USER_COMUM_TESTE } from "./db";
import { CONDICOES_PL } from "@/lib/etapas-pl-condicoes";

describe("Kanban PL — avaliador (bloco C)", () => {
  it("avaliar_condicoes_etapas_pl devolve mapa com TODAS as keys do catálogo por modelo", async () => {
    await withTx(async (sql) => {
      await comoUsuario(sql, USER_COMUM_TESTE);
      // use um modelo_id real da loja de teste (padrão dos testes vizinhos de kanban/peça teste)
      const m = await sql`select id from modelos where tenant_id=${TENANT_TESTE} limit 1`;
      const r = await sql`select avaliar_condicoes_etapas_pl(array[${m[0].id}]::uuid[]) as mapa`;
      const mapa = r[0].mapa as Record<string, Record<string, boolean>>;
      const doModelo = mapa[m[0].id] ?? {};
      for (const c of CONDICOES_PL) expect(doModelo).toHaveProperty(c.key);
    });
  });
  it("anti-drift: toda key do catálogo TS tem branch no SQL e vice-versa", async () => {
    await withTx(async (sql) => {
      await comoUsuario(sql, USER_COMUM_TESTE);
      const m = await sql`select id from modelos where tenant_id=${TENANT_TESTE} limit 1`;
      const r = await sql`select avaliar_condicoes_etapas_pl(array[${m[0].id}]::uuid[]) as mapa`;
      const keysSql = Object.keys((r[0].mapa as any)[m[0].id] ?? {}).sort();
      const keysTs = CONDICOES_PL.map((c) => c.key).sort();
      expect(keysSql).toEqual(keysTs);
    });
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `DATABASE_URL="$(cat /tmp/dburl-local.txt)" npx vitest run tests/integration/kanban-pl-condicoes.test.ts --no-file-parallelism`
Expected: FAIL (RPC não existe).

- [ ] **Step 4: Migration do avaliador**

`supabase/migrations/20261126110000_kanban_pl_avaliador.sql`:
- `_avaliar_condicoes_etapas_pl_core(_tenant uuid, _ids uuid[]) RETURNS jsonb` (STABLE SECURITY DEFINER, search_path public, REVOKE dos 3). Para cada modelo em `_ids` da loja, monta `jsonb_build_object` com as 7 keys:
  - `peca_teste_aprovada`: `NOT EXISTS` linha de M.O. que exige e não está aprovada (reusa `_peca_teste_aprovada(s.id, s.categoria_terceirizado_id, s.empresa_id)` + `s.aprovado IS TRUE`; vacuoso true sem linha) — MESMA lógica da condição homônima do Dev (`_avaliar_condicoes_kanban_core` 194000, copie o predicado).
  - `enviado_a_servicos`: `EXISTS (select 1 from cad c where c.modelo_id=m.id and c.enviado_corte)`.
  - `materiais_separados`: há ≥1 bloco `producao_terceirizados` ativo do CAD do modelo E TODOS têm `data_enviado IS NOT NULL` (consolidação "menos avançada": `NOT EXISTS` bloco ativo sem `data_enviado`; com 0 blocos = **false**, decisão: sem material para separar ainda não "separou" — documentar).
  - `grade_cortada_retornou`: TODOS os blocos ativos têm alguma célula de `grade_detalhe` com `cortada>0` (reusa a mesma expressão de `cortadaRetornou`/`etapaDoBloco` do `pcp-etapas.ts`, portada para SQL; 0 blocos = false).
  - `oficina_entregue`: TODOS os blocos ativos têm `data_entregue IS NOT NULL AND quantidade_recebida>0` (0 blocos = false).
  - `cq_liberado`: `_cq_liberado(c.id)` do CAD do modelo (false sem CAD).
  - `lancado`: `m.lancado IS TRUE`.
  - `WHERE m.tenant_id=_tenant AND m.id = ANY(_ids)`; `jsonb_object_agg(m.id::text, ...)`, `'{}'::jsonb` default.
- Wrapper `avaliar_condicoes_etapas_pl(_ids uuid[])`: gate login + `_exige_modulos('producao','etapas_pl')` (etapas_pl é opt-in) → senão `{}`; chama `_core` com `get_user_tenant_id()`. GRANT authenticated; REVOKE PUBLIC/anon.
- Pós-condição: md5 do `_core`; ACL REVOKE dos 3 no `_core` + authenticated no wrapper; guarda md5 das dependências `_peca_teste_aprovada`/`_cq_liberado` (aborta se divergirem).
- RAISE ASCII.

- [ ] **Step 5: Aplicar + rodar (passa)**

Run:
```bash
psql "$(cat /tmp/dburl-local.txt)" -v ON_ERROR_STOP=1 -f supabase/migrations/20261126110000_kanban_pl_avaliador.sql
DATABASE_URL="$(cat /tmp/dburl-local.txt)" npx vitest run tests/integration/kanban-pl-condicoes.test.ts --no-file-parallelism
```
Expected: PASS (mapa com as 7 keys; anti-drift bate).

- [ ] **Step 6: Rollback + commit**

`…_avaliador_down.sql`: `DROP FUNCTION IF EXISTS avaliar_condicoes_etapas_pl(uuid[]); DROP FUNCTION IF EXISTS _avaliar_condicoes_etapas_pl_core(uuid,uuid[]);`
```bash
git add src/lib/etapas-pl-condicoes.ts supabase/migrations/20261126110000_kanban_pl_avaliador.sql supabase/rollback/20261126110000_kanban_pl_avaliador_down.sql tests/unit/etapas-pl-condicoes.test.ts tests/integration/kanban-pl-condicoes.test.ts
git commit -m "feat(kanban-pl): catalogo PL + avaliador avaliar_condicoes_etapas_pl (Onda 1 C)"
```

---

## Task 4: Seed das 5 etapas (bloco D)

**Files:**
- Modify: `supabase/migrations/20261126100000_kanban_pl_onda1.sql` (acrescenta o seed — MESMO arquivo)
- Test: `tests/integration/kanban-pl-onda1.test.ts` (parte D)

**Interfaces:**
- Consumes: `tenant_config.pcp_etapas` (array `{key,label,ativa}` atual); `etapas_pl_kanban` (Task 2).
- Produces: `etapas_pl_kanban` semeado com os LABELS das etapas atuais da loja (preservando renomeações), em ordem; só quando `etapas_pl_kanban` está vazio (`'[]'`).

- [ ] **Step 1: Teste — seed preserva label customizado e não sobrescreve config já preenchida**

```ts
describe("Kanban PL Onda 1 — seed (bloco D)", () => {
  it("loja com pcp_etapas customizado: etapas_pl_kanban nasce com os labels na ordem", async () => {
    await withTx(async (sql) => {
      // prepara uma loja com pcp_etapas renomeado e etapas_pl_kanban vazio, roda o seed, confere
      await sql`update tenant_config set pcp_etapas='[{"key":"peca_teste","label":"Prova","ativa":true},{"key":"oficina","label":"Costura","ativa":true}]'::jsonb, etapas_pl_kanban='[]'::jsonb where tenant_id=${TENANT_TESTE}`;
      await sql`select _kanban_pl_seed_etapas(${TENANT_TESTE})`; // helper do seed (idempotente)
      const r = await sql`select etapas_pl_kanban from tenant_config where tenant_id=${TENANT_TESTE}`;
      expect(r[0].etapas_pl_kanban).toEqual(["Prova", "Costura"]);
    });
  });
  it("loja com etapas_pl_kanban já preenchido: seed NÃO sobrescreve", async () => {
    await withTx(async (sql) => {
      await sql`update tenant_config set etapas_pl_kanban='["X"]'::jsonb where tenant_id=${TENANT_TESTE}`;
      await sql`select _kanban_pl_seed_etapas(${TENANT_TESTE})`;
      const r = await sql`select etapas_pl_kanban from tenant_config where tenant_id=${TENANT_TESTE}`;
      expect(r[0].etapas_pl_kanban).toEqual(["X"]);
    });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: idem → FAIL (`_kanban_pl_seed_etapas` não existe).

- [ ] **Step 3: Migration bloco D**

Acrescentar ao `20261126100000_kanban_pl_onda1.sql`:
```sql
-- Seed idempotente: etapas_pl_kanban (vazio) recebe os LABELS das etapas atuais da loja (pcp_etapas,
-- preservando renomeacoes) na ordem; ausencia de pcp_etapas => os 5 labels default.
CREATE OR REPLACE FUNCTION public._kanban_pl_seed_etapas(_tenant uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_labels jsonb;
BEGIN
  IF (SELECT jsonb_array_length(coalesce(etapas_pl_kanban,'[]'::jsonb)) FROM tenant_config WHERE tenant_id=_tenant) > 0 THEN
    RETURN; -- ja preenchido: nao sobrescreve
  END IF;
  SELECT coalesce(
    (SELECT jsonb_agg(e->>'label' ORDER BY ord) FROM tenant_config tc, jsonb_array_elements(tc.pcp_etapas) WITH ORDINALITY AS t(e,ord) WHERE tc.tenant_id=_tenant AND tc.pcp_etapas IS NOT NULL AND jsonb_typeof(tc.pcp_etapas)='array'),
    '["Peça Teste","Separação de Materiais","Retorno de Grade de Corte","Oficina","Finalização"]'::jsonb
  ) INTO v_labels;
  UPDATE tenant_config SET etapas_pl_kanban = v_labels WHERE tenant_id=_tenant;
END $$;
REVOKE EXECUTE ON FUNCTION public._kanban_pl_seed_etapas(uuid) FROM PUBLIC, anon, authenticated;
-- Roda o seed para TODAS as lojas existentes (idempotente):
DO $$ DECLARE t uuid; BEGIN FOR t IN SELECT tenant_id FROM tenant_config LOOP PERFORM public._kanban_pl_seed_etapas(t); END LOOP; END $$;
```

- [ ] **Step 4: Aplicar + rodar (passa)**

Run: idem → os 2 testes do seed PASSAM.

- [ ] **Step 5: Rollback (seed) + commit**

O seed é idempotente e só preenche coluna nova vazia; o `_down` já dropa `etapas_pl_kanban` no `_down_drop`. Acrescentar ao `…_down.sql`: `DROP FUNCTION IF EXISTS public._kanban_pl_seed_etapas(uuid);`
```bash
git add supabase/migrations/20261126100000_kanban_pl_onda1.sql supabase/rollback/20261126100000_kanban_pl_onda1_down.sql tests/integration/kanban-pl-onda1.test.ts
git commit -m "feat(kanban-pl): seed das 5 etapas em etapas_pl_kanban (Onda 1 D)"
```

---

## Self-Review

**1. Spec coverage:** bloco A (estado) → Task 1; bloco B (4 configs + salvar) → Task 2; bloco C (catálogo + avaliador) → Task 3; bloco D (seed) → Task 4. As ondas 2-4 (motor/front/migração) estão fora desta onda, declarado no header. ✓

**2. Placeholder scan:** os helpers de teste (`withTx`/`comoUsuario`/constantes) são marcados "adaptar ao real da suíte" — ganchos de fixture, não lógica de produto. O predicado `peca_teste_aprovada`/`grade_cortada_retornou` aponta a fonte exata a copiar (`_avaliar_condicoes_kanban_core`/`etapaDoBloco`). Sem TBD de lógica. ✓

**3. Type consistency:** `CondicaoPL {key,label,descricao?}`, `requisitosOkPL`, `CONDICAO_PL_BY_KEY` iguais nas Tasks 3; as 4 colunas (`etapas_pl_kanban`/`_requisitos`/`_automatico`/`_aba_peca_teste_status`) com os mesmos nomes/tipos nas Tasks 2 e 4; o avaliador devolve `{modelo_id:{key:bool}}` consumido pelo anti-drift. ✓

**4. Review Focus:** config vazia (Task 3/4 testes), consolidação 0 blocos (Task 3 — decisão false documentada), salvar 4 colunas (Task 2 testes), anti-drift catálogo↔SQL (Task 3), migração não sobrescreve (Task 4 teste). ✓

**Deploy:** Onda 1 vai ao ar sozinha (banco), inofensiva (chave desligada, sem front). Ordem de ida: `20261126100000` (estado+config+seed; ADD COLUMN pega AccessExclusive por instante em `modelos` e `tenant_config` → `lock_timeout`, horário calmo) → `20261126110000` (avaliador, só catálogo). Volta LIFO: `110000_down` → `100000_down` (neutraliza salvar_config_loja) → `_down_drop` (DROP das colunas/tabela, horário calmo).
