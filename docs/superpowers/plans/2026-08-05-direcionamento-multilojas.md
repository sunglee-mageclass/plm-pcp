# Direcionamento Multi-lojas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O Direcionamento deixa de ser o par fixo E-commerce (digitado) + Loja Física (derivada) e vira N linhas digitáveis, uma por loja cadastrada, com o Confirmar garantindo no servidor que Σ direcionado por tamanho = grade real.

**Architecture:** Duas tabelas novas (`lojas_direcionamento` = cadastro por tenant; `direcionamento_lojas` = linhas por cad × loja × variante), RPC core v2 com o mesmo desenho wrapper+core de hoje (rascunho tolerante / confirmar estrito e atômico), backfill do legado (tabela `direcionamento` fica inerte), cadastro novo em `/cadastro/lojas` e reescrita da grade da tela de Direcionamento com rodapé vivo de falta/sobra.

**Tech Stack:** Postgres/Supabase (plpgsql, RLS, SECURITY DEFINER), migrations via `psql`, React + TanStack Router/Query, Vitest (unit + integração transacional).

## Global Constraints

- **Branch:** `feature/plan-tecido-a1` — commits vão para ela, NUNCA para `main`.
- **Migração:** escrever em `supabase/migrations/` e aplicar com `psql "$(cat /tmp/dburl.txt)" -f <arquivo>`. Todo arquivo de migração deste plano é envolvido em `BEGIN; … COMMIT;` e escrito idempotente (`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`, `DROP TRIGGER/POLICY IF EXISTS`).
- **Invariante #9:** função `_core` tem `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated` (os TRÊS — revogar só de anon/authenticated é inócuo porque herdam de PUBLIC). Conferir com `has_function_privilege(...)  = false`.
- **Invariante #10 (preservar):** split validado e travado no SERVIDOR; grade real autoritativa = `cad_grades.grades_reais` (ignora totais do cliente); Confirmar atômico (save estrito + `cad.direcionamento_status='separado'` numa txn); Confirmar exige `_cq_liberado(_cad_id)` no servidor.
- **NUNCA** `UNIQUE`/FK em coluna única embedada — aqui só há UNIQUE **compostas** (`(tenant_id, nome)` e `(cad_id, loja_id, variante_numero)`), que são seguras. FK `direcionamento_lojas.loja_id` é **NO ACTION** (não CASCADE — não apagar histórico em silêncio) e ganha índice plano próprio.
- **Erros em PT** via `RAISE EXCEPTION`; no front, `mensagemErro(e, fallback)` de `@/lib/erro-mensagem`.
- **Front:** queryKey própria por tela; tabelas/RPCs fora do `types.ts` acessadas com `as any` (types.ts pendente de regen — padrão do projeto); inputs numéricos = `NumberInput` de `@/components/shared/NumberInput`.
- **Ao alterar função existente, diff-validar:** `pg_get_functiondef` antes/depois.
- **Testes de integração:** padrão `tests/README.md` — `withTx` (BEGIN…ROLLBACK), `comoUsuario` (`set_config('request.jwt.claims', …)`), auto-skip quando não há fixture. NADA é gravado.
- **Build gate:** `npm run build` NÃO roda tsc → depois de mexer em imports rodar `npx tsc --noEmit` (TS2304 = ReferenceError em runtime).
- **Fora de escopo (YAGNI):** romaneio/impressão POR loja, metas por loja, integração com Ordem de Saída, DROP das estruturas legadas (rodada destrutiva futura).

## Descobertas do código (divergências da spec — já incorporadas nas tasks)

1. **O split legado NÃO mora em `cad_grades`.** A spec supôs colunas `cad_grades.grades_ecommerce`/`grades_loja_fisica`; na verdade existe uma **tabela** `public.direcionamento` (`cad_id`, `variante_numero`, `ecommerce jsonb`, `ecommerce_total`, `loja_fisica jsonb`, `loja_fisica_total`, `real jsonb`, `grade_real_total`, UNIQUE `(cad_id, variante_numero)`). É ELA que fica inerte; `cad_grades` não muda.
2. **Direcionamento é POR VARIANTE.** A UNIQUE da spec `(cad_id, loja_id)` é insuficiente — a nova tabela precisa de `variante_numero` e UNIQUE `(cad_id, loja_id, variante_numero)`.
3. **O trigger `fn_rebaixa_direcionamento_grade` NÃO pode ficar "como está".** Ele condiciona o rebaixe a `EXISTS (SELECT 1 FROM direcionamento …)` — cads salvos só no modelo novo não seriam rebaixados. O gate passa a olhar as DUAS tabelas (Task 2). O bloco de re-derivação do snapshot legado permanece intocado (age só sobre linhas legadas).
4. **Assinatura atual do core:** `_salvar_direcionamento_core(_cad_id uuid, _rows jsonb, _strict boolean, _confirmar boolean)`; wrappers `salvar_direcionamento(_cad_id, _rows)` e `confirmar_direcionamento(_cad_id, _rows)` — assinaturas mantidas, muda só o SHAPE de `_rows`.
5. O banner `realDivergente` da tela (comparava snapshot `direcionamento.real` vs grade real atual) fica **obsoleto**: no modelo novo o rodapé vivo compara sempre contra `cad_grades.grades_reais` fresco — o banner é removido (o rebaixe por trigger continua cobrindo o caso confirmado).

## File Structure

| Arquivo | Papel |
|---|---|
| `supabase/migrations/20260805100000_lojas_direcionamento.sql` | Tabela `lojas_direcionamento` + RLS + seed (tenants existentes + `_seed_tenant_defaults` v2) + backfill de permissão `cadastro_lojas` |
| `supabase/migrations/20260805110000_direcionamento_lojas_tabela.sql` | Tabela `direcionamento_lojas` + RLS + backfill do legado + trigger rebaixa v2 + RPC `excluir_loja_direcionamento` |
| `supabase/migrations/20260805120000_direcionamento_multilojas_rpcs.sql` | `_salvar_direcionamento_core` v2 + REVOKEs |
| `tests/integration/direcionamento-multilojas.test.ts` | Testes de integração transacionais (cresce a cada task de banco) |
| `src/lib/direcionamento-diff.ts` + `tests/unit/direcionamento-diff.test.ts` | Helper puro de falta/sobra por tamanho (rodapé + motivo do Confirmar) |
| `src/routes/_authenticated/cadastro.lojas.tsx` | Página "Lojas" (lista + novo Dialog + editar Sheet) |
| `src/lib/permissions-catalog.ts`, `src/lib/nav.ts` | Registro da permissão/rota/ícone `cadastro_lojas` |
| `src/routes/_authenticated/expedicao.direcionamento.$modeloId.tsx` | Grade multi-lojas + rodapé vivo |
| `src/components/producao/RomaneioDirecionamento.tsx` | Impresso com uma linha por loja |
| `src/routes/_authenticated/expedicao.direcionamento.index.tsx` | Só o subtítulo |

---

### Task 1: Banco — cadastro `lojas_direcionamento` (tabela + seed + permissão)

**Files:**
- Create: `tests/integration/direcionamento-multilojas.test.ts`
- Create: `supabase/migrations/20260805100000_lojas_direcionamento.sql`

**Interfaces:**
- Consumes: `public.tenants`, `public._seed_tenant_defaults(uuid)` (corpo atual reproduzido abaixo), `public.set_tenant_id()`, `public.fn_audit()`, `public.get_user_tenant_id()`.
- Produces: tabela `public.lojas_direcionamento (id uuid pk, tenant_id uuid, nome text, ativo boolean, is_default boolean, ordem int, created_at timestamptz, UNIQUE (tenant_id, nome))`, semeada com "E-commerce" (`is_default=true, ordem=1`) e "Loja Física" (`ordem=2`) em TODO tenant; permissão `cadastro_lojas` backfillada. Tasks 2/3/5/6 dependem desses nomes exatos.

- [ ] **Step 1: Escrever o teste de integração que falha**

Criar `tests/integration/direcionamento-multilojas.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE } from "./db";

// Direcionamento multi-lojas — tudo em txn revertida (BEGIN…ROLLBACK): nada é gravado.
describe.skipIf(!hasDb)("Multi-lojas fase 1 — cadastro lojas_direcionamento", () => {
  it("todo tenant tem E-commerce (default, ordem 1) e Loja Física (ordem 2) semeadas", async () => {
    await withTx(async (c) => {
      const faltando = await um<{ n: string }>(
        c,
        `select count(*) as n from tenants t
          where not exists (select 1 from lojas_direcionamento l
                             where l.tenant_id = t.id and l.is_default and l.nome = 'E-commerce')
             or not exists (select 1 from lojas_direcionamento l
                             where l.tenant_id = t.id and l.nome = 'Loja Física')`,
      );
      expect(Number(faltando.n)).toBe(0);
      const seeds = await c.query(
        `select nome, ativo, is_default, ordem from lojas_direcionamento
          where tenant_id = $1 order by ordem`,
        [TENANT_TESTE],
      );
      expect(seeds.rows[0]).toMatchObject({ nome: "E-commerce", ativo: true, is_default: true, ordem: 1 });
      expect(seeds.rows[1]).toMatchObject({ nome: "Loja Física", ativo: true, is_default: false, ordem: 2 });
    });
  });

  it("_seed_tenant_defaults passou a semear lojas (loja nova/reset nasce com as 2)", async () => {
    await withTx(async (c) => {
      const r = await um<{ tem: boolean }>(
        c,
        `select position('lojas_direcionamento' in pg_get_functiondef('public._seed_tenant_defaults(uuid)'::regprocedure)) > 0 as tem`,
      );
      expect(r.tem).toBe(true);
    });
  });

  it("UNIQUE (tenant_id, nome) barra loja duplicada", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await expect(
        c.query(`insert into lojas_direcionamento (tenant_id, nome) values ($1, 'E-commerce')`, [TENANT_TESTE]),
      ).rejects.toThrow(/duplicate key|lojas_direcionamento_tenant_nome/);
    });
  });
});
```

- [ ] **Step 2: Rodar o teste para vê-lo falhar**

Run: `npx vitest run tests/integration/direcionamento-multilojas.test.ts`
Expected: FAIL com `relation "lojas_direcionamento" does not exist`

- [ ] **Step 3: Escrever a migração**

Criar `supabase/migrations/20260805100000_lojas_direcionamento.sql`:

```sql
-- Direcionamento multi-lojas — fase 1/3: cadastro de lojas.
-- Tabela lojas_direcionamento + RLS + seed p/ tenants EXISTENTES + _seed_tenant_defaults v2
-- (loja nova/reset nasce com E-commerce default + Loja Física) + backfill da permissão
-- cadastro_lojas (quem já vê Atributos passa a ver Lojas — rollout não-quebra).
BEGIN;

CREATE TABLE IF NOT EXISTS public.lojas_direcionamento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  nome text NOT NULL,
  ativo boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  ordem int,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lojas_direcionamento_tenant_nome_uk UNIQUE (tenant_id, nome)
);

CREATE INDEX IF NOT EXISTS idx_lojas_dir_tenant ON public.lojas_direcionamento(tenant_id);

ALTER TABLE public.lojas_direcionamento ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lojas_dir_sel ON public.lojas_direcionamento;
DROP POLICY IF EXISTS lojas_dir_ins ON public.lojas_direcionamento;
DROP POLICY IF EXISTS lojas_dir_upd ON public.lojas_direcionamento;
DROP POLICY IF EXISTS lojas_dir_del ON public.lojas_direcionamento;
CREATE POLICY lojas_dir_sel ON public.lojas_direcionamento FOR SELECT
  USING (tenant_id = get_user_tenant_id());
CREATE POLICY lojas_dir_ins ON public.lojas_direcionamento FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id());
CREATE POLICY lojas_dir_upd ON public.lojas_direcionamento FOR UPDATE
  USING (tenant_id = get_user_tenant_id()) WITH CHECK (tenant_id = get_user_tenant_id());
CREATE POLICY lojas_dir_del ON public.lojas_direcionamento FOR DELETE
  USING (tenant_id = get_user_tenant_id());

DROP TRIGGER IF EXISTS set_tenant_id_trg ON public.lojas_direcionamento;
CREATE TRIGGER set_tenant_id_trg BEFORE INSERT ON public.lojas_direcionamento
  FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id();
DROP TRIGGER IF EXISTS audit_lojas_direcionamento ON public.lojas_direcionamento;
CREATE TRIGGER audit_lojas_direcionamento AFTER INSERT OR DELETE OR UPDATE ON public.lojas_direcionamento
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lojas_direcionamento TO authenticated;

-- Seed p/ tenants EXISTENTES (idempotente).
INSERT INTO public.lojas_direcionamento (tenant_id, nome, ativo, is_default, ordem)
SELECT t.id, 'E-commerce', true, true, 1 FROM public.tenants t
ON CONFLICT (tenant_id, nome) DO NOTHING;
INSERT INTO public.lojas_direcionamento (tenant_id, nome, ativo, is_default, ordem)
SELECT t.id, 'Loja Física', true, false, 2 FROM public.tenants t
ON CONFLICT (tenant_id, nome) DO NOTHING;

-- _seed_tenant_defaults v2: corpo ATUAL (config + Corte/Oficina + 12 meses + anos) + lojas.
-- (Reproduz o corpo vivo verificado via pg_get_functiondef em 05/08/2026 — não remover blocos.)
CREATE OR REPLACE FUNCTION public._seed_tenant_defaults(_tid uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.tenant_config (tenant_id) VALUES (_tid)
  ON CONFLICT (tenant_id) DO NOTHING;

  INSERT INTO public.categorias_terceirizado (tenant_id, nome, ordem)
  VALUES (_tid, 'Corte', 0), (_tid, 'Oficina', 1)
  ON CONFLICT (tenant_id, nome) DO NOTHING;

  -- 12 meses FIXOS (ordem 1..12) — a UI não deixa criar (atributo `fixed`), então precisam
  -- existir sempre; senão o dropdown de Mês (Planejamento/CAD/CQ/OTB/Lançamentos) fica vazio.
  INSERT INTO public.meses (tenant_id, mes, ordem) VALUES
    (_tid, 'Janeiro', 1), (_tid, 'Fevereiro', 2), (_tid, 'Março', 3),
    (_tid, 'Abril', 4), (_tid, 'Maio', 5), (_tid, 'Junho', 6),
    (_tid, 'Julho', 7), (_tid, 'Agosto', 8), (_tid, 'Setembro', 9),
    (_tid, 'Outubro', 10), (_tid, 'Novembro', 11), (_tid, 'Dezembro', 12)
  ON CONFLICT (tenant_id, mes) DO NOTHING;

  -- Ano corrente + próximo, p/ a loja já posicionar modelos no calendário ao abrir/resetar.
  INSERT INTO public.anos (tenant_id, ano) VALUES
    (_tid, EXTRACT(YEAR FROM CURRENT_DATE)::int::text),
    (_tid, (EXTRACT(YEAR FROM CURRENT_DATE)::int + 1)::text)
  ON CONFLICT (tenant_id, ano) DO NOTHING;

  -- Lojas do Direcionamento: E-commerce (padrão) + Loja Física — renomeáveis depois.
  INSERT INTO public.lojas_direcionamento (tenant_id, nome, ativo, is_default, ordem) VALUES
    (_tid, 'E-commerce', true, true, 1),
    (_tid, 'Loja Física', true, false, 2)
  ON CONFLICT (tenant_id, nome) DO NOTHING;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public._seed_tenant_defaults(uuid) FROM PUBLIC, anon, authenticated;

-- Permissão nova cadastro_lojas: backfill não-quebra (espelha quem já vê/edita Atributos).
INSERT INTO public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar)
SELECT up.user_id, up.tenant_id, 'cadastro_lojas', up.pode_ver, up.pode_editar
FROM public.user_permissions up
WHERE up.pagina = 'cadastro_atributos'
ON CONFLICT (user_id, pagina) DO NOTHING;

COMMIT;
SELECT pg_notify('pgrst', 'reload schema');
```

- [ ] **Step 4: Diff-validar `_seed_tenant_defaults` antes de aplicar**

Run: `psql "$(cat /tmp/dburl.txt)" -c "select pg_get_functiondef('public._seed_tenant_defaults(uuid)'::regprocedure);"`
Expected: corpo atual SEM o bloco de lojas — confirma que a v2 acima só ADICIONA o bloco final (se o corpo vivo divergir do reproduzido acima, atualizar a migração antes de aplicar).

- [ ] **Step 5: Aplicar a migração**

Run: `psql "$(cat /tmp/dburl.txt)" -f "supabase/migrations/20260805100000_lojas_direcionamento.sql"`
Expected: `COMMIT` sem erros. Depois: `psql "$(cat /tmp/dburl.txt)" -c "select pg_get_functiondef('public._seed_tenant_defaults(uuid)'::regprocedure);"` mostra o bloco de lojas.

- [ ] **Step 6: Rodar o teste para vê-lo passar**

Run: `npx vitest run tests/integration/direcionamento-multilojas.test.ts`
Expected: PASS (3 testes)

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260805100000_lojas_direcionamento.sql tests/integration/direcionamento-multilojas.test.ts
git commit -m "feat(direcionamento): cadastro lojas_direcionamento + seed + permissao cadastro_lojas"
```

---

### Task 2: Banco — `direcionamento_lojas` + backfill + trigger rebaixa v2 + RPC excluir

**Files:**
- Modify: `tests/integration/direcionamento-multilojas.test.ts` (novo describe no fim)
- Create: `supabase/migrations/20260805110000_direcionamento_lojas_tabela.sql`

**Interfaces:**
- Consumes: `lojas_direcionamento` (Task 1), tabela legada `public.direcionamento` (colunas `cad_id, tenant_id, variante_numero, ecommerce, loja_fisica`), trigger `fn_rebaixa_direcionamento_grade()` (corpo vivo reproduzido abaixo).
- Produces: tabela `public.direcionamento_lojas (id, tenant_id, cad_id, loja_id, variante_numero int, grades jsonb, created_at, updated_at, UNIQUE (cad_id, loja_id, variante_numero))` backfillada do legado; RPC `public.excluir_loja_direcionamento(_loja_id uuid) RETURNS void` (guarda: default não-excluível; em uso não-excluível); `fn_rebaixa_direcionamento_grade` v2 cujo gate olha as duas tabelas. Task 3 (core v2) e Task 6 (UI) dependem desses nomes.

- [ ] **Step 1: Escrever os testes que falham**

Adicionar ao FIM de `tests/integration/direcionamento-multilojas.test.ts`:

```ts
describe.skipIf(!hasDb)("Multi-lojas fase 2 — direcionamento_lojas + backfill + excluir", () => {
  it("backfill: linha E-commerce migrada é idêntica ao jsonb legado (e Loja Física idem)", async () => {
    await withTx(async (c) => {
      const leg = await um<{ cad_id: string; variante_numero: number; ecommerce: any; loja_fisica: any } | undefined>(
        c,
        `select cad_id, variante_numero, coalesce(ecommerce, '{}'::jsonb) as ecommerce,
                coalesce(loja_fisica, '{}'::jsonb) as loja_fisica
           from direcionamento limit 1`,
      );
      if (!leg) return; // sem legado → nada a migrar
      const ec = await um<{ grades: any }>(
        c,
        `select dl.grades from direcionamento_lojas dl
           join lojas_direcionamento l on l.id = dl.loja_id
          where dl.cad_id = $1 and dl.variante_numero = $2 and l.is_default`,
        [leg.cad_id, leg.variante_numero],
      );
      expect(ec.grades).toEqual(leg.ecommerce);
      const lf = await um<{ grades: any }>(
        c,
        `select dl.grades from direcionamento_lojas dl
           join lojas_direcionamento l on l.id = dl.loja_id
          where dl.cad_id = $1 and dl.variante_numero = $2 and l.nome = 'Loja Física'`,
        [leg.cad_id, leg.variante_numero],
      );
      expect(lf.grades).toEqual(leg.loja_fisica);
    });
  });

  it("trigger de rebaixe passou a olhar também direcionamento_lojas", async () => {
    await withTx(async (c) => {
      const r = await um<{ tem: boolean }>(
        c,
        `select position('direcionamento_lojas' in pg_get_functiondef('public.fn_rebaixa_direcionamento_grade()'::regprocedure)) > 0 as tem`,
      );
      expect(r.tem).toBe(true);
    });
  });

  it("excluir_loja_direcionamento: loja padrão dá RAISE", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const padrao = await um<{ id: string }>(
        c,
        `select id from lojas_direcionamento where tenant_id = $1 and is_default limit 1`,
        [TENANT_TESTE],
      );
      await expect(
        c.query(`select excluir_loja_direcionamento($1)`, [padrao.id]),
      ).rejects.toThrow(/padrão/);
    });
  });

  it("excluir_loja_direcionamento: loja com linhas de direcionamento dá RAISE", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const cad = await um<{ id: string } | undefined>(
        c, `select id from cad where tenant_id = $1 limit 1`, [TENANT_TESTE],
      );
      if (!cad) return;
      const loja = await um<{ id: string }>(
        c,
        `insert into lojas_direcionamento (tenant_id, nome, ordem) values ($1, 'Atacado Teste', 9) returning id`,
        [TENANT_TESTE],
      );
      await c.query(
        `insert into direcionamento_lojas (tenant_id, cad_id, loja_id, variante_numero, grades)
         values ($1, $2, $3, 1, '{}'::jsonb)`,
        [TENANT_TESTE, cad.id, loja.id],
      );
      await expect(
        c.query(`select excluir_loja_direcionamento($1)`, [loja.id]),
      ).rejects.toThrow(/linha\(s\) de direcionamento/);
    });
  });

  it("excluir_loja_direcionamento: loja livre (sem uso, não-default) é excluída", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const loja = await um<{ id: string }>(
        c,
        `insert into lojas_direcionamento (tenant_id, nome, ordem) values ($1, 'Outlet Teste', 8) returning id`,
        [TENANT_TESTE],
      );
      await c.query(`select excluir_loja_direcionamento($1)`, [loja.id]);
      const n = await um<{ n: string }>(
        c, `select count(*) as n from lojas_direcionamento where id = $1`, [loja.id],
      );
      expect(Number(n.n)).toBe(0);
    });
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `npx vitest run tests/integration/direcionamento-multilojas.test.ts`
Expected: os testes novos FALHAM (`relation "direcionamento_lojas" does not exist` / `function excluir_loja_direcionamento(uuid) does not exist`); os da Task 1 seguem passando.

- [ ] **Step 3: Escrever a migração**

Criar `supabase/migrations/20260805110000_direcionamento_lojas_tabela.sql`:

```sql
-- Direcionamento multi-lojas — fase 2/3: a tabela de linhas + backfill do legado.
-- A tabela `direcionamento` (ecommerce/loja_fisica por variante) fica INERTE (não dropar —
-- rodada destrutiva futura). Backfill: E-commerce ← ecommerce, Loja Física ← loja_fisica.
-- Trigger fn_rebaixa_direcionamento_grade v2: o gate do rebaixe passa a olhar as 2 tabelas.
BEGIN;

CREATE TABLE IF NOT EXISTS public.direcionamento_lojas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  cad_id uuid NOT NULL REFERENCES public.cad(id) ON DELETE CASCADE,
  -- NO ACTION de propósito: excluir loja com histórico deve FALHAR (RPC dá a mensagem PT).
  loja_id uuid NOT NULL REFERENCES public.lojas_direcionamento(id),
  variante_numero int NOT NULL,
  grades jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT direcionamento_lojas_cad_loja_var_uk UNIQUE (cad_id, loja_id, variante_numero)
);

CREATE INDEX IF NOT EXISTS idx_dir_lojas_cad    ON public.direcionamento_lojas(cad_id);
CREATE INDEX IF NOT EXISTS idx_dir_lojas_loja   ON public.direcionamento_lojas(loja_id);
CREATE INDEX IF NOT EXISTS idx_dir_lojas_tenant ON public.direcionamento_lojas(tenant_id);

ALTER TABLE public.direcionamento_lojas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dirlojas_sel ON public.direcionamento_lojas;
DROP POLICY IF EXISTS dirlojas_ins ON public.direcionamento_lojas;
DROP POLICY IF EXISTS dirlojas_upd ON public.direcionamento_lojas;
DROP POLICY IF EXISTS dirlojas_del ON public.direcionamento_lojas;
CREATE POLICY dirlojas_sel ON public.direcionamento_lojas FOR SELECT
  USING (tenant_id = get_user_tenant_id());
CREATE POLICY dirlojas_ins ON public.direcionamento_lojas FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id());
CREATE POLICY dirlojas_upd ON public.direcionamento_lojas FOR UPDATE
  USING (tenant_id = get_user_tenant_id()) WITH CHECK (tenant_id = get_user_tenant_id());
CREATE POLICY dirlojas_del ON public.direcionamento_lojas FOR DELETE
  USING (tenant_id = get_user_tenant_id());

-- Modgate do módulo producao (espelha a tabela legada `direcionamento`).
DROP POLICY IF EXISTS modgate_ins ON public.direcionamento_lojas;
DROP POLICY IF EXISTS modgate_upd ON public.direcionamento_lojas;
DROP POLICY IF EXISTS modgate_del ON public.direcionamento_lojas;
CREATE POLICY modgate_ins ON public.direcionamento_lojas AS RESTRICTIVE FOR INSERT
  WITH CHECK (tenant_module_enabled('producao'::text));
CREATE POLICY modgate_upd ON public.direcionamento_lojas AS RESTRICTIVE FOR UPDATE
  USING (tenant_module_enabled('producao'::text));
CREATE POLICY modgate_del ON public.direcionamento_lojas AS RESTRICTIVE FOR DELETE
  USING (tenant_module_enabled('producao'::text));

DROP TRIGGER IF EXISTS set_tenant_id_trg ON public.direcionamento_lojas;
CREATE TRIGGER set_tenant_id_trg BEFORE INSERT ON public.direcionamento_lojas
  FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id();
DROP TRIGGER IF EXISTS audit_direcionamento_lojas ON public.direcionamento_lojas;
CREATE TRIGGER audit_direcionamento_lojas AFTER INSERT OR DELETE OR UPDATE ON public.direcionamento_lojas
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.direcionamento_lojas TO authenticated;

-- Backfill do legado (idempotente). E-commerce = a loja default do tenant (acabou de ser
-- semeada na fase 1 — nomes ainda intocados); Loja Física = por nome semeado.
INSERT INTO public.direcionamento_lojas (tenant_id, cad_id, loja_id, variante_numero, grades)
SELECT d.tenant_id, d.cad_id, l.id, d.variante_numero, COALESCE(d.ecommerce, '{}'::jsonb)
FROM public.direcionamento d
JOIN public.lojas_direcionamento l ON l.tenant_id = d.tenant_id AND l.is_default
ON CONFLICT (cad_id, loja_id, variante_numero) DO NOTHING;

INSERT INTO public.direcionamento_lojas (tenant_id, cad_id, loja_id, variante_numero, grades)
SELECT d.tenant_id, d.cad_id, l.id, d.variante_numero, COALESCE(d.loja_fisica, '{}'::jsonb)
FROM public.direcionamento d
JOIN public.lojas_direcionamento l ON l.tenant_id = d.tenant_id AND l.nome = 'Loja Física'
ON CONFLICT (cad_id, loja_id, variante_numero) DO NOTHING;

-- fn_rebaixa_direcionamento_grade v2: idêntico ao corpo vivo, MUDANDO SÓ o gate do rebaixe
-- (EXISTS legado OU EXISTS direcionamento_lojas) — sem isso, cads salvos só no modelo novo
-- não seriam rebaixados quando a grade real muda. O bloco de re-derivação do snapshot legado
-- permanece (age só sobre linhas legadas; no modelo novo o rodapé vivo cobre a divergência).
CREATE OR REPLACE FUNCTION public.fn_rebaixa_direcionamento_grade()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_real jsonb;
  v_ec_old jsonb;
  v_ec jsonb := '{}'::jsonb;
  v_lf jsonb := '{}'::jsonb;
  v_ec_t int := 0; v_lf_t int := 0; v_r_t int := 0;
  t text; v_rt int; v_et int; v_ecv int;
BEGIN
  -- Só age em mudança REAL da grade real (UPDATE). Re-inserção (DELETE+INSERT do
  -- salvar_cad_completo) não é mudança de grade → não rebaixa nem re-deriva.
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;
  IF NEW.grades_reais IS NOT DISTINCT FROM OLD.grades_reais THEN
    RETURN NEW;
  END IF;

  -- Rebaixa o status quando estava 'separado' (grade real mudou → split defasado).
  -- v2: o gate olha o modelo NOVO (direcionamento_lojas) E o legado (direcionamento).
  IF EXISTS (
    SELECT 1 FROM public.cad c
     WHERE c.id = NEW.cad_id
       AND c.direcionamento_status = 'separado'
       AND (
         EXISTS (SELECT 1 FROM public.direcionamento d WHERE d.cad_id = NEW.cad_id)
         OR EXISTS (SELECT 1 FROM public.direcionamento_lojas dl WHERE dl.cad_id = NEW.cad_id)
       )
  ) THEN
    UPDATE public.cad
       SET direcionamento_status = 'pendente', direcionamento_confirmado_at = NULL
     WHERE id = NEW.cad_id AND direcionamento_status = 'separado';
    UPDATE public.modelos
       SET revisao_pendente = COALESCE(revisao_pendente, '{}'::jsonb) || '{"direcionamento": true}'::jsonb
     WHERE id = (SELECT modelo_id FROM public.cad WHERE id = NEW.cad_id);
  END IF;

  -- Re-deriva o SNAPSHOT armazenado desta variante a partir da grade real nova (clampa ec ≤ real).
  IF EXISTS (SELECT 1 FROM public.direcionamento d
              WHERE d.cad_id = NEW.cad_id AND d.variante_numero = NEW.variante_numero) THEN
    v_real := COALESCE(NEW.grades_reais, '{}'::jsonb);
    SELECT COALESCE(ecommerce, '{}'::jsonb) INTO v_ec_old
      FROM public.direcionamento
     WHERE cad_id = NEW.cad_id AND variante_numero = NEW.variante_numero;
    v_ec_old := COALESCE(v_ec_old, '{}'::jsonb);

    FOR t IN SELECT jsonb_object_keys(v_real) LOOP
      v_rt := COALESCE((v_real->>t)::int, 0);
      v_et := COALESCE((v_ec_old->>t)::int, 0);
      IF v_et < 0 THEN v_et := 0; END IF;
      v_ecv := LEAST(v_et, v_rt);
      v_ec := v_ec || jsonb_build_object(t, v_ecv);
      v_lf := v_lf || jsonb_build_object(t, v_rt - v_ecv);
      v_ec_t := v_ec_t + v_ecv;
      v_lf_t := v_lf_t + (v_rt - v_ecv);
      v_r_t := v_r_t + v_rt;
    END LOOP;

    UPDATE public.direcionamento
       SET real = v_real, grade_real_total = v_r_t,
           ecommerce = v_ec, ecommerce_total = v_ec_t,
           loja_fisica = v_lf, loja_fisica_total = v_lf_t
     WHERE cad_id = NEW.cad_id AND variante_numero = NEW.variante_numero;
  END IF;

  RETURN NEW;
END;
$function$;

-- Excluir loja com guarda (padrão excluir_tecido): default não sai; com histórico não sai
-- (desativar é o caminho); livre sai.
CREATE OR REPLACE FUNCTION public.excluir_loja_direcionamento(_loja_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_nome text; v_default boolean; v_n int;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem tenant'; END IF;
  SELECT nome, is_default INTO v_nome, v_default
    FROM public.lojas_direcionamento WHERE id = _loja_id AND tenant_id = v_tenant;
  IF v_nome IS NULL THEN RAISE EXCEPTION 'Loja não encontrada'; END IF;
  IF v_default THEN
    RAISE EXCEPTION 'A loja padrão ("%") não pode ser excluída — renomeie ou desative-a.', v_nome;
  END IF;
  SELECT count(*) INTO v_n FROM public.direcionamento_lojas WHERE loja_id = _loja_id;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'Não é possível excluir a loja "%": ela tem % linha(s) de direcionamento. Desative-a para escondê-la de novos direcionamentos.', v_nome, v_n;
  END IF;
  DELETE FROM public.lojas_direcionamento WHERE id = _loja_id AND tenant_id = v_tenant;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.excluir_loja_direcionamento(uuid) FROM anon;

COMMIT;
SELECT pg_notify('pgrst', 'reload schema');
```

- [ ] **Step 4: Diff-validar o trigger antes de aplicar**

Run: `psql "$(cat /tmp/dburl.txt)" -c "select pg_get_functiondef('public.fn_rebaixa_direcionamento_grade()'::regprocedure);"`
Expected: corpo atual SEM `direcionamento_lojas` — a v2 acima muda SÓ o gate (se o corpo vivo divergir do reproduzido, atualizar a migração antes de aplicar).

- [ ] **Step 5: Aplicar a migração**

Run: `psql "$(cat /tmp/dburl.txt)" -f "supabase/migrations/20260805110000_direcionamento_lojas_tabela.sql"`
Expected: `COMMIT` sem erros; `psql "$(cat /tmp/dburl.txt)" -c "select count(*) from direcionamento_lojas"` ≥ 2× o nº de linhas de `direcionamento`.

- [ ] **Step 6: Rodar os testes para vê-los passar**

Run: `npx vitest run tests/integration/direcionamento-multilojas.test.ts`
Expected: PASS (Tasks 1 + 2)

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260805110000_direcionamento_lojas_tabela.sql tests/integration/direcionamento-multilojas.test.ts
git commit -m "feat(direcionamento): tabela direcionamento_lojas + backfill do legado + trigger rebaixe v2 + excluir_loja_direcionamento"
```

---

### Task 3: Banco — `_salvar_direcionamento_core` v2 (payload por loja, confirmar estrito)

**Files:**
- Modify: `tests/integration/direcionamento-multilojas.test.ts` (novo describe no fim)
- Create: `supabase/migrations/20260805120000_direcionamento_multilojas_rpcs.sql`

**Interfaces:**
- Consumes: `direcionamento_lojas`/`lojas_direcionamento` (Tasks 1–2); wrappers vivos `salvar_direcionamento(_cad_id uuid, _rows jsonb)` (chama core `_strict=false,_confirmar=false`) e `confirmar_direcionamento(_cad_id uuid, _rows jsonb)` (gate `_cq_liberado` + core `true,true`) — **assinaturas e corpos dos wrappers NÃO mudam**.
- Produces: `_salvar_direcionamento_core(_cad_id uuid, _rows jsonb, _strict boolean, _confirmar boolean)` v2, onde `_rows` = `[{ "loja_id": "<uuid>", "variante_numero": 1, "grades": {"P": 2, "M": 3} }, …]` (payload é o estado COMPLETO: linhas fora dele são apagadas — diff igual ao legado). Task 6 (front) monta exatamente esse shape.

- [ ] **Step 1: Escrever os testes que falham**

Adicionar ao FIM de `tests/integration/direcionamento-multilojas.test.ts`:

```ts
describe.skipIf(!hasDb)("Multi-lojas fase 3 — RPC core v2", () => {
  // Fixture comum: 1 cad da Loja Teste com PELO MENOS 1 tamanho de grade real > 0
  // (grade toda zerada tornaria os testes de falta/sobra vácuos) + a loja default.
  async function fixture(c: any) {
    const cad = await um<{ id: string } | undefined>(
      c,
      `select c2.id from cad c2
        where c2.tenant_id = $1
          and exists (select 1 from cad_grades g
                        cross join lateral jsonb_each_text(coalesce(g.grades_reais, '{}'::jsonb)) t
                       where g.cad_id = c2.id and (t.value)::int > 0)
        limit 1`,
      [TENANT_TESTE],
    );
    if (!cad) return null;
    const loja = await um<{ id: string }>(
      c, `select id from lojas_direcionamento where tenant_id = $1 and is_default limit 1`, [TENANT_TESTE],
    );
    const grades = await c.query(
      `select variante_numero, coalesce(grades_reais, '{}'::jsonb) as g
         from cad_grades where cad_id = $1 order by variante_numero`,
      [cad.id],
    );
    return { cadId: cad.id, lojaId: loja.id, grades: grades.rows as { variante_numero: number; g: Record<string, number> }[] };
  }

  it("rascunho parcial grava (soma menor que a grade real é aceita)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const f = await fixture(c);
      if (!f) return;
      const rows = [{ loja_id: f.lojaId, variante_numero: f.grades[0].variante_numero, grades: {} }];
      await c.query(`select salvar_direcionamento($1, $2::jsonb)`, [f.cadId, JSON.stringify(rows)]);
      const n = await um<{ n: string }>(
        c,
        `select count(*) as n from direcionamento_lojas where cad_id = $1 and loja_id = $2`,
        [f.cadId, f.lojaId],
      );
      expect(Number(n.n)).toBe(1);
    });
  });

  it("confirmar (core estrito) com soma exata passa e marca 'separado' na MESMA txn", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const f = await fixture(c);
      if (!f) return;
      // Direciona TUDO pra loja default: Σ por tamanho = grade real em toda variante.
      const rows = f.grades.map((r) => ({ loja_id: f.lojaId, variante_numero: r.variante_numero, grades: r.g }));
      // Core direto (conexão postgres ignora ACL) — o gate de CQ do wrapper é testado à parte.
      await c.query(`select _salvar_direcionamento_core($1, $2::jsonb, true, true)`, [f.cadId, JSON.stringify(rows)]);
      const st = await um<{ s: string }>(c, `select direcionamento_status as s from cad where id = $1`, [f.cadId]);
      expect(st.s).toBe("separado");
    });
  });

  it("confirmar com FALTA num tamanho dá RAISE em PT com o tamanho e a diferença", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const f = await fixture(c);
      if (!f) return;
      const rows = f.grades.map((r) => {
        const g = { ...r.g };
        const tam = Object.keys(g).find((t) => Number(g[t]) > 0);
        if (tam) g[tam] = Number(g[tam]) - 1; // 1 peça a menos num tamanho com real > 0
        return { loja_id: f.lojaId, variante_numero: r.variante_numero, grades: g };
      });
      await expect(
        c.query(`select _salvar_direcionamento_core($1, $2::jsonb, true, false)`, [f.cadId, JSON.stringify(rows)]),
      ).rejects.toThrow(/Falta direcionar/);
    });
  });

  it("confirmar com SOBRA num tamanho dá RAISE", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const f = await fixture(c);
      if (!f) return;
      const rows = f.grades.map((r) => {
        const g = { ...r.g };
        const tam = Object.keys(g)[0];
        if (tam) g[tam] = Number(g[tam] ?? 0) + 1; // 1 peça a mais
        return { loja_id: f.lojaId, variante_numero: r.variante_numero, grades: g };
      });
      await expect(
        c.query(`select _salvar_direcionamento_core($1, $2::jsonb, true, false)`, [f.cadId, JSON.stringify(rows)]),
      ).rejects.toThrow(/a mais/);
    });
  });

  it("loja de OUTRO tenant no payload dá RAISE", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const f = await fixture(c);
      if (!f) return;
      const outra = await um<{ id: string } | undefined>(
        c, `select id from lojas_direcionamento where tenant_id <> $1 limit 1`, [TENANT_TESTE],
      );
      if (!outra) return;
      const rows = [{ loja_id: outra.id, variante_numero: f.grades[0].variante_numero, grades: {} }];
      await expect(
        c.query(`select salvar_direcionamento($1, $2::jsonb)`, [f.cadId, JSON.stringify(rows)]),
      ).rejects.toThrow(/não encontrada nesta conta/);
    });
  });

  it("linha NOVA de loja desativada dá RAISE", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const f = await fixture(c);
      if (!f) return;
      const inativa = await um<{ id: string }>(
        c,
        `insert into lojas_direcionamento (tenant_id, nome, ativo, ordem) values ($1, 'Inativa Teste', false, 7) returning id`,
        [TENANT_TESTE],
      );
      const rows = [{ loja_id: inativa.id, variante_numero: f.grades[0].variante_numero, grades: {} }];
      await expect(
        c.query(`select salvar_direcionamento($1, $2::jsonb)`, [f.cadId, JSON.stringify(rows)]),
      ).rejects.toThrow(/desativada/);
    });
  });

  it("core tem EXECUTE revogado de anon e authenticated (invariante #9)", async () => {
    await withTx(async (c) => {
      const r = await um<{ a: boolean; b: boolean }>(
        c,
        `select has_function_privilege('anon', 'public._salvar_direcionamento_core(uuid,jsonb,boolean,boolean)', 'EXECUTE') as a,
                has_function_privilege('authenticated', 'public._salvar_direcionamento_core(uuid,jsonb,boolean,boolean)', 'EXECUTE') as b`,
      );
      expect(r.a).toBe(false);
      expect(r.b).toBe(false);
    });
  });

  it("confirmar_direcionamento mantém o gate de CQ no servidor (_cq_liberado)", async () => {
    await withTx(async (c) => {
      const r = await um<{ tem: boolean }>(
        c,
        `select position('_cq_liberado' in pg_get_functiondef('public.confirmar_direcionamento(uuid,jsonb)'::regprocedure)) > 0 as tem`,
      );
      expect(r.tem).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `npx vitest run tests/integration/direcionamento-multilojas.test.ts`
Expected: os testes novos FALHAM (o core atual espera `{variante_numero, ecommerce}` — rascunho não grava em `direcionamento_lojas`, estrito não conhece as mensagens novas). Os das Tasks 1–2 passam.

- [ ] **Step 3: Escrever a migração**

Criar `supabase/migrations/20260805120000_direcionamento_multilojas_rpcs.sql`:

```sql
-- Direcionamento multi-lojas — fase 3/3: core v2.
-- _rows v2 = [{loja_id, variante_numero, grades:{tamanho:qtd}}] — estado COMPLETO (diff:
-- linhas fora do payload são apagadas). Grade real AUTORITATIVA segue cad_grades.grades_reais.
-- Rascunho (_strict=false): aceita qualquer soma (≤/≥). Confirmar (_strict=true): RAISE em PT
-- se Σ lojas ≠ real em algum tamanho de alguma variante; _confirmar=true marca 'separado'
-- na MESMA txn (atômico — invariante #10). Wrappers salvar/confirmar_direcionamento não mudam
-- (o gate _cq_liberado do confirmar segue no wrapper).
BEGIN;

CREATE OR REPLACE FUNCTION public._salvar_direcionamento_core(_cad_id uuid, _rows jsonb, _strict boolean, _confirmar boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  r jsonb; t text;
  v_keep uuid[] := '{}';
  v_loja uuid; v_num int;
  v_loja_tenant uuid; v_ativa boolean; v_nome text;
  v_real jsonb; v_grades jsonb;
  v_q int; v_row_id uuid;
  v_rt int; v_dir int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  SELECT tenant_id INTO v_tenant FROM public.cad WHERE id = _cad_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'CAD não encontrado'; END IF;
  IF v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para este CAD';
  END IF;
  IF NOT public.tenant_module_enabled('producao') THEN
    RAISE EXCEPTION 'Módulo producao não habilitado para esta loja' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(_rows) <> 'array' THEN
    RAISE EXCEPTION 'Formato inválido: as linhas do direcionamento devem ser uma lista';
  END IF;

  FOR r IN SELECT value FROM jsonb_array_elements(_rows) LOOP
    v_loja := (r->>'loja_id')::uuid;
    v_num  := (r->>'variante_numero')::int;
    IF v_loja IS NULL OR v_num IS NULL THEN
      RAISE EXCEPTION 'Linha inválida: cada linha precisa de loja_id e variante_numero';
    END IF;

    SELECT tenant_id, ativo, nome INTO v_loja_tenant, v_ativa, v_nome
      FROM public.lojas_direcionamento WHERE id = v_loja;
    IF v_loja_tenant IS NULL OR v_loja_tenant <> v_tenant THEN
      RAISE EXCEPTION 'Loja não encontrada nesta conta';
    END IF;

    -- Real AUTORITATIVO da variante (ignora totais do cliente).
    SELECT COALESCE(grades_reais, '{}'::jsonb) INTO v_real
      FROM public.cad_grades WHERE cad_id = _cad_id AND variante_numero = v_num;
    v_real := COALESCE(v_real, '{}'::jsonb);

    -- Sanitiza: só tamanhos presentes na grade real; inteiro ≥ 0.
    v_grades := '{}'::jsonb;
    FOR t IN SELECT jsonb_object_keys(v_real) LOOP
      v_q := GREATEST(COALESCE((r->'grades'->>t)::int, 0), 0);
      v_grades := v_grades || jsonb_build_object(t, v_q);
    END LOOP;

    SELECT id INTO v_row_id FROM public.direcionamento_lojas
     WHERE cad_id = _cad_id AND loja_id = v_loja AND variante_numero = v_num;
    IF v_row_id IS NULL THEN
      -- Linha NOVA: só loja ativa (linhas históricas de loja desativada seguem editáveis).
      IF NOT v_ativa THEN
        RAISE EXCEPTION 'A loja "%" está desativada — reative-a no Cadastro > Lojas ou remova a linha', v_nome;
      END IF;
      INSERT INTO public.direcionamento_lojas (tenant_id, cad_id, loja_id, variante_numero, grades)
      VALUES (v_tenant, _cad_id, v_loja, v_num, v_grades)
      RETURNING id INTO v_row_id;
    ELSE
      UPDATE public.direcionamento_lojas
         SET grades = v_grades, updated_at = now()
       WHERE id = v_row_id;
    END IF;
    v_keep := array_append(v_keep, v_row_id);
  END LOOP;

  -- Payload é o estado completo: o que ficou de fora sai (diff, como no legado).
  DELETE FROM public.direcionamento_lojas
   WHERE cad_id = _cad_id AND NOT (id = ANY(v_keep));

  IF _strict THEN
    -- Confirmar: Σ lojas = grade real POR TAMANHO em TODA variante com grade real.
    FOR v_num, v_real IN
      SELECT g.variante_numero, COALESCE(g.grades_reais, '{}'::jsonb)
        FROM public.cad_grades g WHERE g.cad_id = _cad_id
    LOOP
      FOR t IN SELECT jsonb_object_keys(v_real) LOOP
        v_rt := COALESCE((v_real->>t)::int, 0);
        SELECT COALESCE(SUM(COALESCE((dl.grades->>t)::int, 0)), 0) INTO v_dir
          FROM public.direcionamento_lojas dl
         WHERE dl.cad_id = _cad_id AND dl.variante_numero = v_num;
        IF v_dir < v_rt THEN
          RAISE EXCEPTION 'Falta direcionar % peça(s) no tamanho % (variante %) — direcionado %, grade real %.',
            v_rt - v_dir, t, v_num, v_dir, v_rt USING ERRCODE = '23514';
        ELSIF v_dir > v_rt THEN
          RAISE EXCEPTION 'Direcionado % peça(s) a mais no tamanho % (variante %) — direcionado %, grade real %.',
            v_dir - v_rt, t, v_num, v_dir, v_rt USING ERRCODE = '23514';
        END IF;
      END LOOP;
    END LOOP;
  END IF;

  IF _confirmar THEN
    UPDATE public.cad
       SET direcionamento_status = 'separado', direcionamento_confirmado_at = now()
     WHERE id = _cad_id;
  END IF;
END;
$function$;

-- Invariante #9: revogar o core dos TRÊS (anon/authenticated herdam de PUBLIC).
REVOKE EXECUTE ON FUNCTION public._salvar_direcionamento_core(uuid, jsonb, boolean, boolean) FROM PUBLIC, anon, authenticated;

-- Wrappers: re-assert idempotente do ACL de escrita (padrão 20260623290000).
GRANT EXECUTE ON FUNCTION public.salvar_direcionamento(uuid, jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.salvar_direcionamento(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.confirmar_direcionamento(uuid, jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.confirmar_direcionamento(uuid, jsonb) FROM anon;

COMMIT;
SELECT pg_notify('pgrst', 'reload schema');
```

- [ ] **Step 4: Diff-validar o core antes de aplicar**

Run: `psql "$(cat /tmp/dburl.txt)" -c "select pg_get_functiondef('public._salvar_direcionamento_core(uuid,jsonb,boolean,boolean)'::regprocedure);" > /tmp/core_antes.txt && head -20 /tmp/core_antes.txt`
Expected: corpo v1 (com `UPDATE public.direcionamento SET ecommerce…`). Guardar p/ comparação pós-aplicação.

- [ ] **Step 5: Aplicar a migração**

Run: `psql "$(cat /tmp/dburl.txt)" -f "supabase/migrations/20260805120000_direcionamento_multilojas_rpcs.sql"`
Expected: `COMMIT` sem erros; `pg_get_functiondef` do core agora contém `direcionamento_lojas` e as duas mensagens (`Falta direcionar` / `a mais`); `has_function_privilege('authenticated', 'public._salvar_direcionamento_core(uuid,jsonb,boolean,boolean)', 'EXECUTE')` = `f`.

- [ ] **Step 6: Rodar TODOS os testes de integração**

Run: `npx vitest run tests/integration/direcionamento-multilojas.test.ts && npm run test:int`
Expected: arquivo novo 100% PASS; suíte de integração inteira sem regressão.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260805120000_direcionamento_multilojas_rpcs.sql tests/integration/direcionamento-multilojas.test.ts
git commit -m "feat(direcionamento): _salvar_direcionamento_core v2 — linhas por loja, confirmar estrito por tamanho"
```

---

### Task 4: Helper puro `direcionamento-diff` (falta/sobra por tamanho)

**Files:**
- Create: `tests/unit/direcionamento-diff.test.ts`
- Create: `src/lib/direcionamento-diff.ts`

**Interfaces:**
- Consumes: nada (puro).
- Produces: `diffPorTamanho(real: Record<string, number>, linhas: Array<Record<string, number>>, tamanhos: string[]): DiffTamanho[]` e `motivoNaoConfere(diffs: DiffTamanho[]): string | null` com `type DiffTamanho = { tamanho: string; real: number; direcionado: number; delta: number }`. A Task 6 usa os DOIS no rodapé vivo e no motivo do botão Confirmar.

- [ ] **Step 1: Escrever o teste que falha**

Criar `tests/unit/direcionamento-diff.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { diffPorTamanho, motivoNaoConfere } from "@/lib/direcionamento-diff";

describe("diffPorTamanho", () => {
  it("soma as linhas por tamanho e calcula o delta contra a grade real", () => {
    const diffs = diffPorTamanho(
      { P: 4, M: 6, G: 2 },
      [{ P: 2, M: 6 }, { P: 2, G: 3 }],
      ["P", "M", "G"],
    );
    expect(diffs).toEqual([
      { tamanho: "P", real: 4, direcionado: 4, delta: 0 },
      { tamanho: "M", real: 6, direcionado: 6, delta: 0 },
      { tamanho: "G", real: 2, direcionado: 3, delta: 1 },
    ]);
  });

  it("trata linhas/valores ausentes como 0", () => {
    const diffs = diffPorTamanho({ M: 5 }, [], ["M"]);
    expect(diffs).toEqual([{ tamanho: "M", real: 5, direcionado: 0, delta: -5 }]);
  });
});

describe("motivoNaoConfere", () => {
  it("null quando tudo bate", () => {
    expect(motivoNaoConfere([{ tamanho: "P", real: 2, direcionado: 2, delta: 0 }])).toBeNull();
  });

  it("falta em PT com quantidade e tamanho", () => {
    expect(
      motivoNaoConfere([
        { tamanho: "P", real: 2, direcionado: 2, delta: 0 },
        { tamanho: "M", real: 6, direcionado: 2, delta: -4 },
      ]),
    ).toBe("Falta direcionar 4 peça(s) no tamanho M.");
  });

  it("sobra em PT", () => {
    expect(motivoNaoConfere([{ tamanho: "G", real: 1, direcionado: 3, delta: 2 }])).toBe(
      "2 peça(s) a mais no tamanho G.",
    );
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `npx vitest run tests/unit/direcionamento-diff.test.ts`
Expected: FAIL — `Cannot find module '@/lib/direcionamento-diff'`

- [ ] **Step 3: Implementar o helper**

Criar `src/lib/direcionamento-diff.ts`:

```ts
// Direcionamento multi-lojas: diferença por tamanho entre a grade real e a soma das
// linhas por loja. Puro (testado em tests/unit) — alimenta o rodapé vivo e o motivo
// do botão Confirmar. A validação de VERDADE é do servidor (_salvar_direcionamento_core
// estrito); aqui é só o feedback antes de tentar.

export type DiffTamanho = { tamanho: string; real: number; direcionado: number; delta: number };

export function diffPorTamanho(
  real: Record<string, number>,
  linhas: Array<Record<string, number>>,
  tamanhos: string[],
): DiffTamanho[] {
  return tamanhos.map((t) => {
    const r = Number(real?.[t] ?? 0);
    const d = linhas.reduce((s, l) => s + Number(l?.[t] ?? 0), 0);
    return { tamanho: t, real: r, direcionado: d, delta: d - r };
  });
}

/** Primeiro problema encontrado, em PT — null quando toda a grade bate. */
export function motivoNaoConfere(diffs: DiffTamanho[]): string | null {
  for (const d of diffs) {
    if (d.delta < 0) return `Falta direcionar ${-d.delta} peça(s) no tamanho ${d.tamanho}.`;
    if (d.delta > 0) return `${d.delta} peça(s) a mais no tamanho ${d.tamanho}.`;
  }
  return null;
}
```

- [ ] **Step 4: Rodar para ver passar**

Run: `npx vitest run tests/unit/direcionamento-diff.test.ts`
Expected: PASS (5 testes)

- [ ] **Step 5: Commit**

```bash
git add src/lib/direcionamento-diff.ts tests/unit/direcionamento-diff.test.ts
git commit -m "feat(direcionamento): helper puro de falta/sobra por tamanho"
```

---

### Task 5: UI — Cadastro "Lojas" (`/cadastro/lojas`) + permissão + nav

**Files:**
- Create: `src/routes/_authenticated/cadastro.lojas.tsx`
- Modify: `src/lib/permissions-catalog.ts` (bloco `module: "cadastro"`, após a linha de `cadastro_destinos`)
- Modify: `src/lib/nav.ts` (import lucide + `PAGE_URLS` + `PAGE_ICONS`)

**Interfaces:**
- Consumes: tabela `lojas_direcionamento` e RPC `excluir_loja_direcionamento(_loja_id uuid)` (Tasks 1–2); componentes existentes `RequirePermission`, `useReadOnly`, `MobileActionBar`, `useSort`/`SortHead`, `useUnsavedGuard`/`UnsavedChangesGuard`/`UnsavedIndicator`, `mensagemErro`.
- Produces: página gated por `cadastro_lojas`; nada consumido por outras tasks.

- [ ] **Step 1: Registrar a permissão no catálogo**

Em `src/lib/permissions-catalog.ts`, dentro de `pages` do módulo `cadastro`, logo APÓS a linha de `cadastro_destinos`, adicionar:

```ts
      { key: "cadastro_lojas", label: "Lojas", description: "Lojas do Direcionamento (E-commerce, Loja Física, …).", modes: ["full"] },
```

(`modes: ["full"]` — o Direcionamento só existe no PLM completo, como as demais páginas de produção. A key entra automaticamente em `ALL_PAGE_KEYS` e no `PermissoesModal`.)

- [ ] **Step 2: Registrar rota e ícone na navegação**

Em `src/lib/nav.ts`:
1. Adicionar `Store` ao import existente de `lucide-react` (mesma linha dos demais ícones).
2. Em `PAGE_URLS`, após `cadastro_destinos: "/cadastro/destinos",` adicionar:

```ts
  cadastro_lojas: "/cadastro/lojas",
```

3. Em `PAGE_ICONS`, após `cadastro_destinos: MapPin,` adicionar:

```ts
  cadastro_lojas: Store,
```

- [ ] **Step 3: Criar a página**

Criar `src/routes/_authenticated/cadastro.lojas.tsx` (padrão do sistema: lista + **novo = Dialog** + **editar = Sheet**, modelado em `cadastro.destinos.tsx`):

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Store, Plus, Pencil, Trash2, Search, Loader2, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { supabase } from "@/integrations/supabase/client";
import { MobileActionBar } from "@/components/shared/MobileActionBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useSort, SortHead } from "@/components/shared/sort";
import { RequirePermission, useReadOnly } from "@/components/RequirePermission";
import { UnsavedChangesGuard, useUnsavedGuard } from "@/components/shared/UnsavedChangesGuard";
import { UnsavedIndicator } from "@/components/shared/UnsavedIndicator";

export const Route = createFileRoute("/_authenticated/cadastro/lojas")({
  component: () => (
    <RequirePermission page="cadastro_lojas">
      <LojasPage />
    </RequirePermission>
  ),
});

type Loja = { id: string; nome: string; ativo: boolean; is_default: boolean; ordem: number | null };

function LojasPage() {
  const qc = useQueryClient();
  const readOnly = useReadOnly();
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Loja | null>(null);
  const [formNome, setFormNome] = useState("");
  const [formOrdem, setFormOrdem] = useState("");
  const [formAtivo, setFormAtivo] = useState(true);
  const [deleteRow, setDeleteRow] = useState<Loja | null>(null);

  const createDirty = createOpen && (formNome !== "" || formOrdem !== "");
  const editDirty =
    !!editing &&
    (formNome !== editing.nome ||
      formOrdem !== String(editing.ordem ?? "") ||
      formAtivo !== editing.ativo);
  const dirty = createDirty || editDirty;
  const { requestClose, confirm } = useUnsavedGuard({
    dirty,
    onClose: () => { setCreateOpen(false); setEditing(null); },
  });

  const { data: lojas = [], isLoading } = useQuery({
    queryKey: ["lojas-direcionamento"],
    queryFn: async () => {
      const { data, error } = await (supabase.from("lojas_direcionamento" as any) as any)
        .select("id, nome, ativo, is_default, ordem")
        .order("is_default", { ascending: false })
        .order("ordem", { ascending: true, nullsFirst: false })
        .order("nome");
      if (error) throw error;
      return ((data ?? []) as unknown) as Loja[];
    },
  });

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return lojas;
    return lojas.filter((l) => l.nome.toLowerCase().includes(s));
  }, [lojas, search]);

  const { sorted, sortKey, sortDir, toggle } = useSort(filtered, { key: "ordem" });
  const sortState = { sortKey, sortDir, toggle };

  const invalidate = () => qc.invalidateQueries({ queryKey: ["lojas-direcionamento"] });

  const openCreate = () => {
    setEditing(null); setFormNome(""); setFormOrdem(""); setFormAtivo(true); setCreateOpen(true);
  };
  const openEdit = (l: Loja) => {
    setCreateOpen(false); setEditing(l);
    setFormNome(l.nome); setFormOrdem(String(l.ordem ?? "")); setFormAtivo(l.ativo);
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      const nome = formNome.trim();
      if (!nome) throw new Error("Informe o nome da loja.");
      const ordem = formOrdem.trim() === "" ? null : Math.max(0, parseInt(formOrdem, 10) || 0);
      if (editing) {
        const { error } = await (supabase.from("lojas_direcionamento" as any) as any)
          .update({ nome, ordem, ativo: formAtivo })
          .eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase.from("lojas_direcionamento" as any) as any)
          .insert({ nome, ordem, ativo: formAtivo });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Loja atualizada." : "Loja criada.");
      setCreateOpen(false); setEditing(null);
      invalidate();
    },
    onError: (e: any) =>
      toast.error(e?.code === "23505" ? "Já existe uma loja com esse nome." : mensagemErro(e, "Erro ao salvar.")),
  });

  const delMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("excluir_loja_direcionamento" as any, { _loja_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Loja excluída.");
      setDeleteRow(null); setEditing(null);
      invalidate();
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao excluir.")),
  });

  const formFields = (
    <div className="space-y-3 py-2">
      <div className="space-y-1.5">
        <Label>Nome</Label>
        <Input
          autoFocus
          value={formNome}
          onChange={(e) => setFormNome(e.target.value)}
          placeholder="Ex: Franquia Sul"
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); saveMut.mutate(); } }}
          disabled={readOnly}
        />
      </div>
      <div className="space-y-1.5">
        <Label>Ordem</Label>
        <Input
          inputMode="numeric"
          value={formOrdem}
          onChange={(e) => setFormOrdem(e.target.value.replace(/\D/g, ""))}
          placeholder="Posição na lista (ex: 3)"
          disabled={readOnly}
        />
      </div>
      <div className="flex items-center justify-between rounded-lg border p-3">
        <div>
          <Label>Ativa</Label>
          <p className="text-xs text-muted-foreground">
            Desativada some de direcionamentos novos; linhas já digitadas continuam visíveis.
          </p>
        </div>
        <Switch checked={formAtivo} onCheckedChange={setFormAtivo} disabled={readOnly} />
      </div>
    </div>
  );

  return (
    <div className="container mx-auto p-3 sm:p-6 space-y-6 max-sm:pb-24">
      <header className="flex items-start gap-3">
        <Store className="h-7 w-7 text-primary mt-0.5 shrink-0" />
        <div>
          <h1 className="text-2xl font-bold">Lojas</h1>
          <p className="text-sm text-muted-foreground">
            Destinos do Direcionamento (ex.: E-commerce, Loja Física, franquias).
          </p>
        </div>
      </header>

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar lojas…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button onClick={openCreate} className="max-sm:hidden" disabled={readOnly}>
          <Plus className="h-4 w-4 mr-1" /> Nova
        </Button>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <SortHead label="Nome" sortKey="nome" sortState={sortState} />
              <SortHead label="Ordem" sortKey="ordem" sortState={sortState} />
              <TableHead>Status</TableHead>
              <TableHead className="w-32 text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Carregando…
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                  Nenhuma loja cadastrada.
                </TableCell>
              </TableRow>
            ) : (
              sorted.map((l) => (
                <TableRow key={l.id} className={l.ativo ? "" : "opacity-60"}>
                  <TableCell>
                    <button type="button" className="text-left hover:underline" onClick={() => openEdit(l)}>
                      {l.nome}
                    </button>
                    {l.is_default && <Badge variant="secondary" className="ml-2 text-[10px]">Padrão</Badge>}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{l.ordem ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={l.ativo ? "default" : "outline"}>{l.ativo ? "Ativa" : "Desativada"}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="icon" variant="ghost" onClick={() => openEdit(l)} aria-label="Editar">
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon" variant="ghost"
                      onClick={() => setDeleteRow(l)}
                      disabled={readOnly || l.is_default}
                      aria-label="Excluir"
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="text-xs text-muted-foreground">
        <Badge variant="secondary">{filtered.length}</Badge> loja(s)
      </div>

      {/* Novo = Dialog central (padrão do sistema) */}
      <Dialog open={createOpen} onOpenChange={(o) => { if (!o) requestClose(); }}>
        <DialogContent>
          <DialogHeader>
            <div className="flex items-center gap-2">
              <DialogTitle>Nova loja</DialogTitle>
              <UnsavedIndicator show={createDirty} className="ml-auto shrink-0" />
            </div>
          </DialogHeader>
          {formFields}
          <DialogFooter>
            <Button variant="outline" onClick={requestClose}>Cancelar</Button>
            {!readOnly && (
              <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
                {saveMut.isPending ? "Salvando…" : "Salvar"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Editar = Sheet lateral com barra de ações no rodapé (padrão do sistema) */}
      <Sheet open={!!editing} onOpenChange={(o) => { if (!o) requestClose(); }}>
        <SheetContent side="right" className="w-full sm:w-[480px] sm:max-w-[480px] flex flex-col p-0">
          <div className="flex-1 overflow-y-auto p-6">
            <SheetHeader>
              <div className="flex items-center gap-2">
                <SheetTitle>Editar loja</SheetTitle>
                {editing?.is_default && <Badge variant="secondary" className="text-[10px]">Padrão</Badge>}
                <UnsavedIndicator show={editDirty} className="ml-auto shrink-0" />
              </div>
            </SheetHeader>
            {formFields}
          </div>
          <div className="shrink-0 border-t bg-background p-3 flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" onClick={requestClose} aria-label="Voltar">
              <ArrowLeft className="h-4 w-4 mr-1" />Voltar
            </Button>
            {!readOnly && editing && !editing.is_default && (
              <Button variant="destructive" onClick={() => setDeleteRow(editing)}>
                <Trash2 className="h-4 w-4 mr-1" /> Excluir
              </Button>
            )}
            {!readOnly && (
              <Button className="ml-auto" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
                {saveMut.isPending ? "Salvando…" : "Salvar"}
              </Button>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <UnsavedChangesGuard confirm={confirm} />

      <AlertDialog open={!!deleteRow} onOpenChange={(o) => !o && setDeleteRow(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir loja?</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir <strong>{deleteRow?.nome}</strong>? Lojas com linhas de
              direcionamento não podem ser excluídas — nesse caso, desative-a.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); if (deleteRow) delMut.mutate(deleteRow.id); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <MobileActionBar>
        <Button onClick={openCreate} className="ml-auto" disabled={readOnly}>
          <Plus className="h-4 w-4 mr-1" /> Nova
        </Button>
      </MobileActionBar>
    </div>
  );
}
```

- [ ] **Step 4: Build + typecheck**

Run: `npm run build && npx tsc --noEmit 2>&1 | grep TS2304; true`
Expected: build OK; nenhum TS2304.

- [ ] **Step 5: Commit**

```bash
git add src/routes/_authenticated/cadastro.lojas.tsx src/lib/permissions-catalog.ts src/lib/nav.ts
git commit -m "feat(cadastro): pagina Lojas do Direcionamento + permissao cadastro_lojas"
```

---

### Task 6: UI — Direcionamento multi-lojas (detalhe + romaneio + lista)

**Files:**
- Modify: `src/routes/_authenticated/expedicao.direcionamento.$modeloId.tsx`
- Modify: `src/components/producao/RomaneioDirecionamento.tsx` (reescrita completa abaixo)
- Modify: `src/routes/_authenticated/expedicao.direcionamento.index.tsx` (só o subtítulo)

**Interfaces:**
- Consumes: `salvar_direcionamento`/`confirmar_direcionamento` com `_rows` v2 `[{loja_id, variante_numero, grades}]` (Task 3); `diffPorTamanho`/`motivoNaoConfere` (Task 4); tabelas `lojas_direcionamento`/`direcionamento_lojas`.
- Produces: nada consumido por outras tasks.

As edições no detalhe são por SUBSTITUIÇÃO de trecho (o texto "antigo" abaixo existe hoje no arquivo — usar como âncora, não nº de linha).

- [ ] **Step 1: Tipos e imports do detalhe**

Em `expedicao.direcionamento.$modeloId.tsx`:

1a. Adicionar aos imports (junto dos demais de `@/lib`):

```tsx
import { diffPorTamanho, motivoNaoConfere } from "@/lib/direcionamento-diff";
```

1b. Substituir o tipo `VarState`:

```tsx
type VarState = {
  variante_numero: number;
  real: Record<string, number>;
  ecommerce: Record<string, number>;
};
```

por:

```tsx
type Loja = { id: string; nome: string; ativo: boolean; is_default: boolean; ordem: number | null };
type VarState = {
  variante_numero: number;
  real: Record<string, number>;
  // loja_id -> { tamanho: qtd } — uma linha digitável por loja
  linhas: Record<string, Record<string, number>>;
};
```

- [ ] **Step 2: Query de lojas + troca da query de linhas**

2a. Logo APÓS a query `tenantCfg` (âncora: o bloco `queryKey: ["tenant_config", "tamanhos", tenantId]`), adicionar:

```tsx
  // Lojas do tenant (ativas E desativadas — as desativadas só aparecem quando têm linha
  // histórica). E-commerce (default) primeiro, depois ordem.
  const { data: lojas = [] } = useQuery({
    queryKey: ["dir-lojas", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("lojas_direcionamento" as any) as any)
        .select("id, nome, ativo, is_default, ordem")
        .order("is_default", { ascending: false })
        .order("ordem", { ascending: true, nullsFirst: false })
        .order("nome");
      if (error) throw error;
      return ((data ?? []) as unknown) as Loja[];
    },
  });
```

2b. Substituir a query `existing` inteira:

```tsx
  const { data: existing = [], refetch, isFetched: existingFetched, isFetching: existingFetching } = useQuery({
    queryKey: ["direcionamento", cad?.id],
    enabled: !!cad?.id,
    queryFn: async () => {
      const { data } = await supabase.from("direcionamento").select("*").eq("cad_id", cad!.id);
      return data ?? [];
    },
  });
```

por:

```tsx
  const { data: existing = [], refetch, isFetched: existingFetched, isFetching: existingFetching } = useQuery({
    queryKey: ["direcionamento-lojas", cad?.id],
    enabled: !!cad?.id,
    queryFn: async () => {
      const { data, error } = await (supabase.from("direcionamento_lojas" as any) as any)
        .select("loja_id, variante_numero, grades")
        .eq("cad_id", cad!.id);
      if (error) throw error;
      return ((data ?? []) as unknown) as { loja_id: string; variante_numero: number; grades: Record<string, number> }[];
    },
  });

  // Lojas visíveis na grade: ativas sempre; desativadas só se têm linha salva (esmaecidas).
  const lojasComLinha = useMemo(() => new Set((existing as any[]).map((d) => d.loja_id)), [existing]);
  const lojasVisiveis = useMemo(
    () => (lojas as Loja[]).filter((l) => l.ativo || lojasComLinha.has(l.id)),
    [lojas, lojasComLinha],
  );
```

- [ ] **Step 3: Remover o banner de divergência (obsoleto no modelo novo)**

3a. Apagar o memo `realDivergente` inteiro (âncora: `const realDivergente = useMemo(() => {` … `}, [existing, cadGrades]);` com o comentário "Divergência: a grade real salva…").

3b. Apagar o JSX do banner (âncora: `{realDivergente && (` … `)}` com o texto "A grade real mudou desde o último direcionamento salvo").

(O rodapé vivo compara sempre contra a grade real FRESCA de `cad_grades`; o caso confirmado é rebaixado pelo trigger — o banner não tem mais o que dizer.)

- [ ] **Step 4: Hidratação, setter e payload**

4a. Na hidratação (dentro do `useEffect` com `if (hydrated || !cad?.id) return;`), substituir:

```tsx
    (cadGrades as any[]).forEach((g) => {
      obj[g.variante_numero] = {
        variante_numero: g.variante_numero,
        real: g.grades_reais ?? {},
        ecommerce: {},
      };
    });
    (existing as any[]).forEach((d) => {
      if (!obj[d.variante_numero]) {
        obj[d.variante_numero] = { variante_numero: d.variante_numero, real: {}, ecommerce: {} };
      }
      obj[d.variante_numero].ecommerce = d.ecommerce ?? {};
    });
```

por:

```tsx
    (cadGrades as any[]).forEach((g) => {
      obj[g.variante_numero] = {
        variante_numero: g.variante_numero,
        real: g.grades_reais ?? {},
        linhas: {},
      };
    });
    (existing as any[]).forEach((d) => {
      if (!obj[d.variante_numero]) {
        obj[d.variante_numero] = { variante_numero: d.variante_numero, real: {}, linhas: {} };
      }
      obj[d.variante_numero].linhas[d.loja_id] = d.grades ?? {};
    });
```

4b. Substituir o setter `setEcommerce`:

```tsx
  const setEcommerce = (num: number, tam: string, qtd: number) => {
    setState((s) => ({
      ...s,
      [num]: { ...(s[num] ?? { variante_numero: num, real: {}, ecommerce: {} }),
        ecommerce: { ...(s[num]?.ecommerce ?? {}), [tam]: qtd } },
    }));
  };
```

por:

```tsx
  const setQtd = (num: number, lojaId: string, tam: string, qtd: number) => {
    setState((s) => {
      const v = s[num] ?? { variante_numero: num, real: {}, linhas: {} };
      return {
        ...s,
        [num]: { ...v, linhas: { ...v.linhas, [lojaId]: { ...(v.linhas[lojaId] ?? {}), [tam]: qtd } } },
      };
    });
  };
```

4c. Substituir `buildRows` (e o comentário acima dele):

```tsx
  // O servidor deriva loja_fisica/totais da Grade Real (cad_grades) e trava ec≤real;
  // o front só manda variante + ecommerce (o resto é ignorado/recomputado no banco).
  const buildRows = () =>
    Object.values(state).map((v) => ({ variante_numero: v.variante_numero, ecommerce: v.ecommerce }));
```

por:

```tsx
  // Payload v2 = estado COMPLETO: uma linha por loja×variante tocada; o servidor sanitiza
  // pelos tamanhos da grade real e faz o diff (linhas fora do payload são apagadas).
  const buildRows = () => {
    const rows: { loja_id: string; variante_numero: number; grades: Record<string, number> }[] = [];
    Object.values(state).forEach((v) => {
      lojasVisiveis.forEach((l) => {
        const grades = v.linhas[l.id];
        if (grades && Object.keys(grades).length > 0) {
          rows.push({ loja_id: l.id, variante_numero: v.variante_numero, grades });
        }
      });
    });
    return rows;
  };
```

- [ ] **Step 5: Motivo do Confirmar (substitui `hasOver`) e invalidações**

5a. Substituir:

```tsx
  // Algum tamanho com e-commerce acima da Grade Real? O servidor trava no Confirmar
  // (RAISE); aqui desabilita o botão p/ dar o feedback antes de tentar.
  const hasOver = variantes.some((v) => tamanhos.some((t) => Number(v.ecommerce?.[t] ?? 0) > Number(v.real?.[t] ?? 0)));
```

por:

```tsx
  // Motivo de bloqueio do Confirmar: primeiro tamanho com falta/sobra (o servidor RAISE
  // igual — aqui é o feedback antes de tentar). null = tudo bate.
  const motivo = useMemo(() => {
    for (const v of variantes) {
      const m = motivoNaoConfere(diffPorTamanho(v.real, Object.values(v.linhas), tamanhos));
      if (m) return `${labelByNumero[v.variante_numero] ?? `Variante ${v.variante_numero}`}: ${m}`;
    }
    return null;
  }, [variantes, tamanhos, labelByNumero]);
```

5b. No botão Confirmar, trocar `hasOver` por `!!motivo` e dar o motivo como tooltip — substituir:

```tsx
          <Button onClick={() => confirmMut.mutate()} disabled={confirmMut.isPending || saveMut.isPending || readOnly || !cad?.id || hasOver}>
            <CheckCircle2 className="h-4 w-4 mr-2" /> Confirmar Direcionamento
          </Button>
```

por:

```tsx
          <Button
            title={motivo ?? undefined}
            onClick={() => confirmMut.mutate()}
            disabled={confirmMut.isPending || saveMut.isPending || readOnly || !cad?.id || !!motivo}
          >
            <CheckCircle2 className="h-4 w-4 mr-2" /> Confirmar Direcionamento
          </Button>
```

5c. No `actionButtons`, logo ANTES do primeiro `{!confirmado ? (`, adicionar o motivo visível (aparece só quando bloqueia):

```tsx
      {!confirmado && motivo && (
        <span className="hidden sm:inline text-xs text-amber-600 dark:text-amber-400 max-w-[46ch] truncate" title={motivo}>
          {motivo}
        </span>
      )}
```

5d. Nas mutations, trocar TODAS as invalidações `queryKey: ["direcionamento", cad?.id]` por `queryKey: ["direcionamento-lojas", cad?.id]` (ocorre no `saveMut.onSuccess` e no `confirmMut.onSuccess`).

- [ ] **Step 6: Grade desktop multi-lojas**

Dentro de `variantes.map((v) => {`, substituir o cálculo e a tabela. Trocar:

```tsx
        const realTotal = tamanhos.reduce((s, t) => s + Number(v.real?.[t] ?? 0), 0);
        const ecTotal = tamanhos.reduce((s, t) => s + Number(v.ecommerce?.[t] ?? 0), 0);
        const overSizes = tamanhos.filter((t) => Number(v.ecommerce?.[t] ?? 0) > Number(v.real?.[t] ?? 0));
```

por:

```tsx
        const diffs = diffPorTamanho(v.real, Object.values(v.linhas), tamanhos);
        const realTotal = diffs.reduce((s, d) => s + d.real, 0);
        const dirTotal = diffs.reduce((s, d) => s + d.direcionado, 0);
```

Apagar o bloco `{overSizes.length > 0 && (…)}` (o rodapé vivo assume o papel).

Substituir o `<tbody>` inteiro da tabela desktop (da linha "Grade Real" até a linha "Loja Física") por:

```tsx
                <tbody>
                  <tr>
                    <td className="border px-2 py-1 font-medium">Grade Real</td>
                    {tamanhos.map((t) => (
                      <td key={t} className="border px-2 py-1 text-center bg-muted/30">{Number(v.real?.[t] ?? 0)}</td>
                    ))}
                    <td className="border px-2 py-1 text-center font-semibold">{realTotal}</td>
                  </tr>
                  {lojasVisiveis.map((l) => {
                    const grades = v.linhas[l.id] ?? {};
                    const lojaTotal = tamanhos.reduce((s, t) => s + Number(grades[t] ?? 0), 0);
                    return (
                      <tr key={l.id} className={l.ativo ? "" : "opacity-60"}>
                        <td className="border px-2 py-1 font-medium">
                          {l.nome}
                          {!l.ativo && <Badge variant="secondary" className="ml-2 text-[10px]">Desativada</Badge>}
                        </td>
                        {tamanhos.map((t) => (
                          <td key={t} className="border p-0">
                            <NumberInput
                              integer min={0}
                              className="h-8 max-md:h-11 border-0 bg-transparent text-center"
                              value={grades[t] ?? ""}
                              onChange={(e) => setQtd(v.variante_numero, l.id, t, Math.max(0, Number(e.target.value) || 0))}
                            />
                          </td>
                        ))}
                        <td className="border px-2 py-1 text-center font-semibold">{lojaTotal}</td>
                      </tr>
                    );
                  })}
                  {/* Rodapé vivo: Σ direcionado vs grade real por tamanho (verde = bate). */}
                  <tr className="bg-muted/40">
                    <td className="border px-2 py-1 font-medium">Σ Direcionado</td>
                    {diffs.map((d) => (
                      <td
                        key={d.tamanho}
                        className={`border px-2 py-1 text-center font-semibold ${d.delta === 0 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}
                      >
                        {d.direcionado}
                        {d.delta !== 0 && (
                          <span className="block text-[10px] font-normal">({d.delta > 0 ? `+${d.delta}` : d.delta})</span>
                        )}
                      </td>
                    ))}
                    <td className={`border px-2 py-1 text-center font-semibold ${dirTotal === realTotal ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
                      {dirTotal} / {realTotal}
                    </td>
                  </tr>
                </tbody>
```

- [ ] **Step 7: Grade mobile multi-lojas**

Substituir o bloco mobile inteiro (âncora: `{/* Mobile: empilhado por tamanho (some o scroll horizontal ilegível) */}` até o `</div>` do resumo `Real:/E-com:/Loja:`) por:

```tsx
            {/* Mobile: empilhado por tamanho — real, uma entrada por loja e o Σ vivo. */}
            <div className="md:hidden grid grid-cols-2 gap-2">
              {diffs.map((d) => {
                const t = d.tamanho;
                return (
                  <div key={t} className={`rounded-lg border p-2 ${d.delta !== 0 ? "border-amber-400/60" : ""}`}>
                    <div className="mb-1 border-b pb-1 text-center text-xs font-semibold">{t}</div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Grade Real</span>
                      <span className="font-medium">{d.real}</span>
                    </div>
                    {lojasVisiveis.map((l) => (
                      <div key={l.id} className={`mt-1 ${l.ativo ? "" : "opacity-60"}`}>
                        <span className="text-xs text-muted-foreground">{l.nome}</span>
                        <NumberInput
                          integer min={0}
                          className="h-9 max-md:h-11 text-center"
                          value={v.linhas[l.id]?.[t] ?? ""}
                          onChange={(e) => setQtd(v.variante_numero, l.id, t, Math.max(0, Number(e.target.value) || 0))}
                        />
                      </div>
                    ))}
                    <div className="mt-1 flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Σ Direcionado</span>
                      <span className={`font-medium ${d.delta === 0 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
                        {d.direcionado}{d.delta !== 0 ? ` (${d.delta > 0 ? "+" : ""}${d.delta})` : ""}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="md:hidden flex justify-between border-t pt-2 text-xs text-muted-foreground">
              <span>Real: <b className="text-foreground">{realTotal}</b></span>
              <span className={dirTotal === realTotal ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}>
                Direcionado: <b>{dirTotal}</b>
              </span>
            </div>
```

- [ ] **Step 8: Romaneio multi-lojas**

8a. No detalhe, substituir a invocação:

```tsx
      <RomaneioDirecionamento
        modelo={modelo}
        tamanhos={tamanhos}
        variantes={variantes}
        confirmado={confirmado}
```

por:

```tsx
      <RomaneioDirecionamento
        modelo={modelo}
        tamanhos={tamanhos}
        variantes={variantes}
        lojas={lojasVisiveis}
        confirmado={confirmado}
```

8b. Reescrever `src/components/producao/RomaneioDirecionamento.tsx` (conteúdo COMPLETO do arquivo):

```tsx
import { cell, cellH } from "@/components/producao/cad/types";
import { PrintArea } from "@/components/shared/PrintArea";

type Loja = { id: string; nome: string };
type VarState = {
  variante_numero: number;
  real?: Record<string, number>;
  linhas?: Record<string, Record<string, number>>;
};

const cellC: React.CSSProperties = { ...cell, textAlign: "center" };

function fmtTam(t: string) {
  const [num, sig] = t.split("|");
  return sig ? `${sig} · ${num}` : t;
}

/**
 * Romaneio de Direcionamento (impresso): por variante, Grade Real + uma linha POR LOJA
 * + Σ Direcionado por tamanho, mais o total geral (todas as variantes).
 */
export function RomaneioDirecionamento({
  modelo,
  tamanhos,
  variantes,
  lojas,
  confirmado,
  dataStr,
  labelByNumero,
}: {
  modelo: any;
  tamanhos: string[];
  variantes: VarState[];
  lojas: Loja[];
  confirmado: boolean;
  dataStr: string;
  labelByNumero?: Record<number, string>;
}) {
  const num = (o: Record<string, number> | undefined, t: string) => Number(o?.[t] ?? 0);
  const sum = (o: Record<string, number>) => tamanhos.reduce((s, t) => s + (o[t] ?? 0), 0);

  // Linhas de uma variante: real + uma por loja + Σ direcionado.
  const linhasVariante = (v: VarState) => {
    const real: Record<string, number> = {};
    const porLoja = lojas.map((l) => ({ loja: l, vals: {} as Record<string, number> }));
    const dir: Record<string, number> = {};
    tamanhos.forEach((t) => {
      real[t] = num(v.real, t);
      let d = 0;
      porLoja.forEach((pl) => {
        const q = num(v.linhas?.[pl.loja.id], t);
        pl.vals[t] = q;
        d += q;
      });
      dir[t] = d;
    });
    return { real, porLoja, dir };
  };

  // Totais gerais por tamanho (todas as variantes).
  const gReal: Record<string, number> = {};
  const gPorLoja = lojas.map((l) => ({ loja: l, vals: {} as Record<string, number> }));
  const gDir: Record<string, number> = {};
  tamanhos.forEach((t) => {
    let r = 0, d = 0;
    const porLojaT = lojas.map(() => 0);
    variantes.forEach((v) => {
      r += num(v.real, t);
      lojas.forEach((l, i) => {
        const q = num(v.linhas?.[l.id], t);
        porLojaT[i] += q;
        d += q;
      });
    });
    gReal[t] = r; gDir[t] = d;
    gPorLoja.forEach((pl, i) => { pl.vals[t] = porLojaT[i]; });
  });

  const renderRow = (label: string, vals: Record<string, number>) => (
    <tr key={label}>
      <td style={{ ...cell, fontWeight: 600 }}>{label}</td>
      {tamanhos.map((t) => <td key={t} style={cellC}>{vals[t] ?? 0}</td>)}
      <td style={{ ...cellC, fontWeight: 700 }}>{sum(vals)}</td>
    </tr>
  );

  const tabela = (vals: { real: Record<string, number>; porLoja: { loja: Loja; vals: Record<string, number> }[]; dir: Record<string, number> }) => (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, tableLayout: "fixed" }}>
      <thead>
        <tr>
          <th style={cellH}>Destino</th>
          {tamanhos.map((t) => <th key={t} style={cellH}>{fmtTam(t)}</th>)}
          <th style={cellH}>Total</th>
        </tr>
      </thead>
      <tbody>
        {renderRow("Grade Real", vals.real)}
        {vals.porLoja.map((pl) => renderRow(pl.loja.nome, pl.vals))}
        {renderRow("Σ Direcionado", vals.dir)}
      </tbody>
    </table>
  );

  return (
    <PrintArea>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", borderBottom: "2px solid #000", paddingBottom: 6, marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>ROMANEIO DE DIRECIONAMENTO</div>
          <div style={{ fontSize: 13 }}>{modelo?.ref ?? "—"} — {modelo?.nome ?? ""}{modelo?.colecao ? ` · ${modelo.colecao}` : ""}</div>
        </div>
        <div style={{ fontSize: 11, textAlign: "right" }}>{confirmado ? "Separado" : "Pendente"}<br />{dataStr}</div>
      </div>

      {variantes.map((v) => (
        <div key={v.variante_numero} className="print-section" style={{ marginBottom: 14 }}>
          <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 4 }}>{labelByNumero?.[v.variante_numero] ?? `Variante ${v.variante_numero}`}</div>
          {tabela(linhasVariante(v))}
        </div>
      ))}

      {variantes.length > 1 && (
        <div className="print-section" style={{ marginTop: 10 }}>
          <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 4 }}>Total geral (todas as variantes)</div>
          {tabela({ real: gReal, porLoja: gPorLoja, dir: gDir })}
        </div>
      )}
    </PrintArea>
  );
}
```

- [ ] **Step 9: Subtítulo da lista**

Em `expedicao.direcionamento.index.tsx`, substituir:

```tsx
            <p className="text-sm text-muted-foreground">Distribuição entre E-commerce e Loja Física.</p>
```

por:

```tsx
            <p className="text-sm text-muted-foreground">Distribuição entre as lojas cadastradas.</p>
```

- [ ] **Step 10: Build + typecheck + suíte**

Run: `npm run build && npx tsc --noEmit && npm test`
Expected: build OK, tsc limpo, unit + integração PASS (o detalhe agora só compila se todos os usos de `ecommerce` viraram `linhas` — sobrou algum, o tsc acusa).

- [ ] **Step 11: Verificação manual (dev)**

Run: `npm run dev` e abrir `/expedicao/direcionamento` → abrir um modelo:
- Grade mostra Grade Real + 2 linhas (E-commerce, Loja Física) digitáveis + rodapé Σ.
- Digitar quantidades: rodapé fica âmbar com (−n)/(+n) e verde quando bate; Confirmar desabilitado com motivo no tooltip enquanto não bate; Salvar sempre disponível.
- Modelo com direcionamento legado confirmado: linhas migradas aparecem preenchidas.
- `/cadastro/lojas`: criar loja nova → ela aparece como 3ª linha num direcionamento aberto.

- [ ] **Step 12: Commit**

```bash
git add src/routes/_authenticated/expedicao.direcionamento.\$modeloId.tsx src/components/producao/RomaneioDirecionamento.tsx src/routes/_authenticated/expedicao.direcionamento.index.tsx
git commit -m "feat(direcionamento): grade multi-lojas com rodape vivo de falta/sobra + romaneio por loja"
```

---

### Task 7: Docs + verificação final

**Files:**
- Modify: `CLAUDE.md` (invariante #10)
- Modify: `docs/mapeamento-campos-calculos.md` (local/gitignored — seção do Direcionamento)

**Interfaces:**
- Consumes: tudo acima.
- Produces: documentação em dia (papel do docs-keeper).

- [ ] **Step 1: Atualizar o invariante #10 do CLAUDE.md**

Substituir o item 10 inteiro da seção "Invariantes a preservar" por:

```markdown
10. **Direcionamento (multi-lojas, ago/2026)** — split da Grade Real em N linhas digitáveis,
    uma por loja cadastrada (`lojas_direcionamento`; seed "E-commerce" default + "Loja Física",
    renomeáveis; default não-excluível; com histórico só desativa — RPC
    `excluir_loja_direcionamento` com guarda). As linhas vivem em `direcionamento_lojas`
    (UNIQUE (cad_id, loja_id, variante_numero); FK de loja NO ACTION + índice plano). A
    validação é do SERVIDOR (`_salvar_direcionamento_core` v2, `_rows` =
    [{loja_id, variante_numero, grades}]): grade real autoritativa de `cad_grades.grades_reais`
    (ignora totais do cliente); **rascunho** (`salvar_direcionamento`) aceita qualquer soma;
    **Confirmar** (`confirmar_direcionamento`) RAISE em PT se Σ lojas ≠ real em algum tamanho —
    invariante `Σ lojas = Σ real` POR TAMANHO ao confirmar, atômico com
    `cad.direcionamento_status='separado'` na MESMA txn e exigindo CQ liberado no SERVIDOR
    (`_cq_liberado(_cad_id)`). Loja do payload pertence ao tenant; linha NOVA só de loja ativa.
    **Grade real defasada rebaixa**: `trg_rebaixa_direcionamento_grade` — o gate olha
    `direcionamento` (legada) OU `direcionamento_lojas`. A tabela `direcionamento`
    (ecommerce/loja_fisica por variante) é LEGADA e inerte — backfillada para
    `direcionamento_lojas` (E-commerce ← ecommerce, Loja Física ← loja_fisica); DROP fica p/ a
    rodada destrutiva futura. 2º lote NÃO entra no split (a grade real já o desconta). ⚠️ A
    queryKey `["cad-grades", cad?.id]` segue compartilhada com sufixo por consumidor
    (Direcionamento `"reais"`, Oficina `"full"`); as linhas do split usam
    `["direcionamento-lojas", cad.id]` e o cadastro `["lojas-direcionamento"]`/`["dir-lojas"]`.
```

- [ ] **Step 2: Atualizar o doc de mapeamento local**

Em `docs/mapeamento-campos-calculos.md`, na seção do Direcionamento, substituir a descrição do par fixo por este parágrafo (adaptar a âncora ao texto existente da seção):

```markdown
**Direcionamento multi-lojas (ago/2026):** as linhas moram em `direcionamento_lojas`
(cad × loja × variante, `grades` jsonb {tamanho: qtd}); o cadastro de lojas é
`lojas_direcionamento` (seed E-commerce default + Loja Física, renomeáveis/desativáveis).
Rascunho aceita qualquer soma; Confirmar exige Σ lojas = grade real POR TAMANHO
(RAISE PT com tamanho e diferença) e marca `cad.direcionamento_status='separado'`
atomicamente (gate de CQ no servidor). A tabela `direcionamento` (ecommerce/loja_fisica)
ficou LEGADA/inerte após backfill — não ler dela em código novo.
```

- [ ] **Step 3: Verificação final completa**

Run: `npm run build && npx tsc --noEmit && npm test`
Expected: tudo verde.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: invariante 10 atualizado para direcionamento multi-lojas"
```

(`docs/mapeamento-campos-calculos.md` é gitignored — atualizar o arquivo, sem commit.)

---

## Self-Review (feito na escrita do plano)

- **Cobertura da spec:** §1 cadastro → Tasks 1/2/5; §2 modelo de dados → Task 2 (com a correção: legado é a TABELA `direcionamento`, e a chave nova inclui `variante_numero`); §3 RPCs → Task 3 (+ trigger na Task 2, divergência documentada); §4 UI → Task 6 (linhas por loja ativa, rodapé vivo, Confirmar bloqueado com motivo, históricos migrados legíveis, 2º lote intocado — a grade real já o desconta, nenhum código muda); §5 testes → Tasks 1–4. Fora de escopo respeitado (nenhuma task de romaneio POR loja, metas, Ordem de Saída ou DROP).
- **Placeholders:** nenhum "TBD/TODO/similar à task N"; todo step de código tem o código; corpos vivos de `_seed_tenant_defaults` e `fn_rebaixa_direcionamento_grade` reproduzidos por inteiro (com step de diff-validação antes de aplicar, caso o banco tenha mudado).
- **Consistência de nomes/tipos:** `lojas_direcionamento` / `direcionamento_lojas` / `excluir_loja_direcionamento` / `_salvar_direcionamento_core(uuid,jsonb,boolean,boolean)` / payload `{loja_id, variante_numero, grades}` / `diffPorTamanho`/`motivoNaoConfere`/`DiffTamanho` / queryKeys `["lojas-direcionamento"]`, `["dir-lojas", tenantId]`, `["direcionamento-lojas", cad?.id]` — idênticos em todas as tasks que os usam. Mensagens de RAISE usadas nos testes (`/Falta direcionar/`, `/a mais/`, `/não encontrada nesta conta/`, `/desativada/`, `/padrão/`, `/linha\(s\) de direcionamento/`) batem com os `RAISE EXCEPTION` das migrações.
