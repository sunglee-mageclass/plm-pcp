# Subcategoria de tecido — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar subcategoria de tecido hierárquica (pertence a uma categoria de tecido), cadastrada em Atributos, escolhida por categoria no Sheet do tecido, e exibida (leitura) no Desenvolvimento e na Ficha.

**Architecture:** Replica o molde existente da subcategoria de AVIAMENTO. Banco: tabela `subcategorias_tecido` (FK → `categorias_tecido`) + coluna `artigo_categorias_tecido.subcategoria_tecido_id` (a sub por par tecido×categoria) + gatilho que valida a sub na mesma categoria do par + `set_artigo_categorias` estendido (atômico) para gravar a sub por par. UI: atributo `sub_tecido` no cadastro de atributos, select por categoria no Sheet do tecido, exibição só-leitura no Dev/Ficha.

**Tech Stack:** Postgres (migration via psql na cópia local p/ teste, produção pelo dono) + React/TS + Vitest (integração txn-revertida).

**Spec:** `docs/superpowers/specs/2026-11-19-subcategoria-tecido-design.md`

## Global Constraints

- **Banco ANTES do site.** Deploy PRÓPRIO (site novo + banco velho = coluna/tabela inexistente).
- Migration testada só na CÓPIA LOCAL (Docker PG, `/tmp/dburl.txt` local). NUNCA DDL em txn de teste em produção; produção é o dono quem aplica.
- Molde = `subcategorias_aviamento` (`20260611162249`): id uuid pk, tenant_id, nome, FK categoria, created_at, UNIQUE(tenant_id,nome), GRANT authenticated+service_role, RLS tenant. Replicar.
- `set_tenant_id_trg` before insert (padrão do projeto) OU `tenant_id` via `get_user_tenant_id()` — seguir o que as tabelas de atributo usam.
- Coluna `artigo_categorias_tecido.subcategoria_tecido_id`: FK → `subcategorias_tecido(id)` **ON DELETE SET NULL**; índice parcial WHERE NOT NULL.
- Gatilho BEFORE INSERT/UPDATE em `artigo_categorias_tecido`: se `subcategoria_tecido_id` não-nula, sua `categoria_tecido_id` (da `subcategorias_tecido`) deve == a `categoria_tecido_id` da linha; senão `RAISE P0001 'subcategoria_categoria_diferente'` (ASCII; PT no front).
- `set_artigo_categorias` estendido de forma ATÔMICA, diff-validado (`pg_get_functiondef` antes/depois); REVOKE de anon mantido.
- RLS tenant em tudo. RAISE 5xx só ASCII.
- NÃO alterar `varianteLabel` global sem necessidade; exibição no Dev/Ficha é acréscimo.
- Gates: `npm run build` + `npx tsc --noEmit | grep TS2304`; testes `--no-file-parallelism`.

## Review Focus

- **Sub de categoria que o tecido não tem / de outra categoria:** o gatilho recusa; a UI nunca oferece. Testado no Task 1.
- **Desmarcar a categoria no Sheet:** a sub daquela categoria é limpa (não fica órfã no payload). Testado no Task 4.
- **Excluir subcategoria em uso:** bloqueada pelo `usage` do cadastro de atributos (padrão). Testado no Task 3 (confere o `usage`).
- **Categoria sem nenhuma subcategoria:** o select some/"sem subcategorias"; salvar não quebra. Testado no Task 4.
- **`set_artigo_categorias` perder a atomicidade / deixar o tecido sem categoria:** a extensão mantém a transação única (delete-all + reinsert). Testado no Task 2.

---

### Task 1: Migration — tabela `subcategorias_tecido` + coluna + gatilho de validação

**Files:**
- Create: `supabase/migrations/20261210100000_subcategoria_tecido.sql`
- Create: `supabase/rollback/20261210100000_subcategoria_tecido_down.sql`
- Test: `tests/integration/subcategoria-tecido.test.ts`

**Interfaces:**
- Produces: tabela `subcategorias_tecido(id, tenant_id, nome, categoria_tecido_id, ativo, created_at)`; coluna `artigo_categorias_tecido.subcategoria_tecido_id`; gatilho `trg_act_sub_mesma_categoria` / fn `fn_act_sub_mesma_categoria`.

- [ ] **Step 1: Escrever a migration** (`20261210100000_subcategoria_tecido.sql`)

```sql
BEGIN;

-- Subcategoria de tecido (molde de subcategorias_aviamento). Pertence a uma categoria de tecido.
CREATE TABLE IF NOT EXISTS public.subcategorias_tecido (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id),
  nome VARCHAR(255) NOT NULL,
  categoria_tecido_id UUID NOT NULL REFERENCES public.categorias_tecido(id) ON DELETE CASCADE,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, categoria_tecido_id, nome)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.subcategorias_tecido TO authenticated;
GRANT ALL ON public.subcategorias_tecido TO service_role;
ALTER TABLE public.subcategorias_tecido ENABLE ROW LEVEL SECURITY;

-- set_tenant_id ao inserir (mesmo gatilho genérico que as outras tabelas de atributo usam).
CREATE OR REPLACE TRIGGER set_tenant_id_trg BEFORE INSERT ON public.subcategorias_tecido
  FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id();

-- RLS tenant (select/insert/update/delete), padrão das tabelas de atributo.
CREATE POLICY "tenant select subtec" ON public.subcategorias_tecido FOR SELECT USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "tenant insert subtec" ON public.subcategorias_tecido FOR INSERT WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "tenant update subtec" ON public.subcategorias_tecido FOR UPDATE USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "tenant delete subtec" ON public.subcategorias_tecido FOR DELETE USING (tenant_id = public.get_user_tenant_id());

CREATE INDEX IF NOT EXISTS idx_subtec_tenant ON public.subcategorias_tecido(tenant_id);
CREATE INDEX IF NOT EXISTS idx_subtec_categoria ON public.subcategorias_tecido(categoria_tecido_id);

-- A sub escolhida para o par (tecido, categoria). ON DELETE SET NULL: apagar a sub não apaga o vínculo.
ALTER TABLE public.artigo_categorias_tecido
  ADD COLUMN IF NOT EXISTS subcategoria_tecido_id UUID REFERENCES public.subcategorias_tecido(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_act_subtec ON public.artigo_categorias_tecido(subcategoria_tecido_id) WHERE subcategoria_tecido_id IS NOT NULL;

-- A sub (se houver) tem de pertencer à MESMA categoria do par. Fecha o furo de sub de outra categoria por API.
CREATE OR REPLACE FUNCTION public.fn_act_sub_mesma_categoria() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_cat uuid;
BEGIN
  IF NEW.subcategoria_tecido_id IS NULL THEN RETURN NEW; END IF;
  SELECT categoria_tecido_id INTO v_cat FROM public.subcategorias_tecido WHERE id = NEW.subcategoria_tecido_id;
  IF v_cat IS DISTINCT FROM NEW.categoria_tecido_id THEN
    RAISE EXCEPTION 'subcategoria_categoria_diferente' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.fn_act_sub_mesma_categoria() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_act_sub_mesma_categoria BEFORE INSERT OR UPDATE OF subcategoria_tecido_id, categoria_tecido_id
  ON public.artigo_categorias_tecido FOR EACH ROW EXECUTE FUNCTION public.fn_act_sub_mesma_categoria();

COMMIT;
```

⚠️ Antes de escrever: confirme na cópia local o nome real do gatilho genérico de tenant (`set_tenant_id` / `set_tenant_id_trg`) e o helper RLS (`get_user_tenant_id`) olhando como `subcategorias_aviamento`/`subcategorias1_produto` fazem. Use os nomes REAIS.

- [ ] **Step 2: Escrever o inverso** (`supabase/rollback/20261210100000_subcategoria_tecido_down.sql`)

```sql
BEGIN;
DROP TRIGGER IF EXISTS trg_act_sub_mesma_categoria ON public.artigo_categorias_tecido;
DROP FUNCTION IF EXISTS public.fn_act_sub_mesma_categoria();
ALTER TABLE public.artigo_categorias_tecido DROP COLUMN IF EXISTS subcategoria_tecido_id;
DROP TABLE IF EXISTS public.subcategorias_tecido;
COMMIT;
```

- [ ] **Step 3: Teste de integração (cópia local, txn revertida)** (`tests/integration/subcategoria-tecido.test.ts`)

Seguir o padrão do projeto (`tests/integration/*`, `DATABASE_URL` LOCAL obrigatório, `BEGIN … ROLLBACK`). Casos:
1. inserir `subcategorias_tecido` para uma categoria → ok.
2. vincular `artigo_categorias_tecido` com `subcategoria_tecido_id` da MESMA categoria → ok.
3. vincular com sub de OUTRA categoria → `P0001 subcategoria_categoria_diferente`.
4. apagar a `subcategorias_tecido` → o par fica (ON DELETE SET NULL zera a sub, não apaga o vínculo).
5. apagar a `categorias_tecido` → cascateia a sub e o par (ON DELETE CASCADE).

```ts
// esqueleto — seguir o helper de conexão/txn do projeto (tests/integration/db.ts)
import { describe, it, expect } from "vitest";
import { comTxn } from "./db"; // confirmar o helper real do projeto

describe("subcategorias_tecido", () => {
  it("sub de outra categoria é recusada (P0001)", async () => {
    await comTxn(async (sql) => {
      // semear tenant/categoria A e B, sub de A, artigo com categoria A
      // tentar vincular artigo_categorias_tecido(categoria=A, sub=subDeB) → espera P0001
      await expect(/* insert com sub de B */).rejects.toThrow(/subcategoria_categoria_diferente/);
    });
  });
  // + casos 1,2,4,5 análogos
});
```

(O implementador materializa os INSERTs reais a partir do schema; `DATABASE_URL` LOCAL no brief.)

- [ ] **Step 4: Aplicar na cópia local + rodar o teste**

Run (cópia local): `psql "$(cat /tmp/dburl-local.txt)" -f supabase/migrations/20261210100000_subcategoria_tecido.sql` (ou o fluxo de teste txn-revertido do projeto).
Run: `npx vitest run tests/integration/subcategoria-tecido.test.ts --no-file-parallelism`
Expected: PASS. Diff-validar que nenhuma função existente mudou (só objetos novos).

- [ ] **Step 5: Commit**

```bash
git commit --only supabase/migrations/20261210100000_subcategoria_tecido.sql supabase/rollback/20261210100000_subcategoria_tecido_down.sql tests/integration/subcategoria-tecido.test.ts -m "feat(db): subcategorias_tecido + coluna em artigo_categorias_tecido + gatilho mesma-categoria"
```

---

### Task 2: Estender `set_artigo_categorias` (grava a sub por par, atômico)

**Files:**
- Create: `supabase/migrations/20261210110000_set_artigo_categorias_sub.sql` (+ inverso)
- Test: `tests/integration/set-artigo-categorias-sub.test.ts`

**Interfaces:**
- Consumes: tabela/coluna/gatilho do Task 1.
- Produces: `set_artigo_categorias(_artigo_id uuid, _pares jsonb)` — `_pares` = `[{"categoria_tecido_id": "...", "subcategoria_tecido_id": "..."|null}, ...]`. Delete-all + reinsert atômico, agora gravando a sub por par. Mantém o REVOKE de anon.

- [ ] **Step 1: Ver a assinatura atual**

`set_artigo_categorias(_artigo_id uuid, _cat_ids uuid[])` (migration que a define; chamada em `cadastro.tecidos.$artigoId.tsx:475` e `tecido.descriptor.ts`). Hoje: `delete from artigo_categorias_tecido where artigo_id=_artigo_id; insert (artigo_id, categoria_tecido_id) select …`.

- [ ] **Step 2: Escrever a nova versão** (migration `20261210110000`)

`CREATE OR REPLACE FUNCTION public.set_artigo_categorias(_artigo_id uuid, _pares jsonb)` que faz, numa transação: `delete from artigo_categorias_tecido where artigo_id=_artigo_id;` e `insert into artigo_categorias_tecido (artigo_id, categoria_tecido_id, subcategoria_tecido_id) select _artigo_id, (p->>'categoria_tecido_id')::uuid, nullif(p->>'subcategoria_tecido_id','')::uuid from jsonb_array_elements(_pares) p;`. `REVOKE EXECUTE … FROM anon`. ⚠️ A assinatura MUDA (`uuid[]` → `jsonb`): DROPar a versão antiga `set_artigo_categorias(uuid, uuid[])` OU manter as duas (overload) — decidir no implementador; o front (Task 4) passa a chamar a jsonb. Diff-validar.

(Arquivo real com `pg_get_functiondef` antes/depois, guarda md5 — padrão do projeto.)

- [ ] **Step 3: Inverso** (`supabase/rollback/…_down.sql`) — devolve a versão `uuid[]` e dropa a jsonb (ou vice-versa, conforme a decisão do step 2).

- [ ] **Step 4: Teste de integração**

Casos: gravar pares com e sem sub → lê certo; par com sub de outra categoria → P0001 (do gatilho do Task 1); o delete-all + reinsert é atômico (um par inválido não deixa o tecido sem categoria — a txn inteira falha).

- [ ] **Step 5: Aplicar na cópia local + rodar o teste + commit**

```bash
git commit --only supabase/migrations/20261210110000_set_artigo_categorias_sub.sql supabase/rollback/20261210110000_set_artigo_categorias_sub_down.sql tests/integration/set-artigo-categorias-sub.test.ts -m "feat(db): set_artigo_categorias grava a subcategoria por par (jsonb, atômico)"
```

---

### Task 3: Cadastro de atributos — atributo `sub_tecido`

**Files:**
- Modify: `src/routes/_authenticated/cadastro.atributos.tsx`
- Test: `tests/unit/cadastro-atributos-sub-tecido.test.ts` (shape do catálogo)

**Interfaces:**
- Consumes: tabela `subcategorias_tecido` (Task 1).

- [ ] **Step 1: Adicionar o atributo (molde do `sub_aviamento`)**

No array de atributos de `cadastro.atributos.tsx`, acrescentar uma entrada `sub_tecido` espelhando o `sub_aviamento` (que já existe): `group: "TECIDO"`, `config: { table: "subcategorias_tecido", nameField: "nome", singular: "Subcategoria de Tecido", plural: "Subcategorias de Tecido", categoriaField: "categoria_tecido_id" (o campo que amarra à categoria — confirmar como o sub_aviamento/sub_produto nomeiam isso no catálogo), usage: [{ table: "artigo_categorias_tecido", column: "subcategoria_tecido_id" }] }`. Reusar o mecanismo de "sub filtrada pela categoria" que o cadastro JÁ tem para produto/aviamento (ver linhas ~283-320 do arquivo). Respeitar o gate `!isStockOnly` se as outras subs respeitam.

- [ ] **Step 2: Teste de shape**

```ts
// confirma que o catálogo tem o atributo sub_tecido com a table e o usage corretos
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
const SRC = readFileSync("src/routes/_authenticated/cadastro.atributos.tsx", "utf8");
describe("atributo sub_tecido", () => {
  it("existe com table subcategorias_tecido e usage em artigo_categorias_tecido.subcategoria_tecido_id", () => {
    expect(SRC).toContain("subcategorias_tecido");
    expect(SRC).toMatch(/subcategoria_tecido_id/);
  });
});
```

- [ ] **Step 3: tsc + build + commit**

```bash
npx tsc --noEmit 2>&1 | grep TS2304 || echo "sem TS2304"; npm run build
git commit --only src/routes/_authenticated/cadastro.atributos.tsx tests/unit/cadastro-atributos-sub-tecido.test.ts -m "feat(cadastro): atributo Subcategoria de Tecido em Atributos (molde da sub de aviamento)"
```

- [ ] **Step 4: QA (prévia)** — Cadastro > Atributos: a Subcategoria de Tecido aparece, aninhada/filtrada pela categoria de tecido; adicionar/editar/remover funciona; não dá p/ excluir sub em uso.

---

### Task 4: Sheet do tecido — select de subcategoria por categoria marcada

**Files:**
- Modify: `src/routes/_authenticated/cadastro.tecidos.$artigoId.tsx`
- Test: `tests/unit/tecido-subcategoria-por-cat.test.ts` (estado `subPorCat`)

**Interfaces:**
- Consumes: `set_artigo_categorias(_artigo_id, _pares jsonb)` (Task 2); tabela `subcategorias_tecido` (Task 1).

- [ ] **Step 1: Carregar a sub por categoria na leitura**

A query que hoje lê `artigo_categorias_tecido.categoria_tecido_id` (linha ~265) passa a ler também `subcategoria_tecido_id`. O estado `catIds: string[]` ganha um companheiro `subPorCat: Record<categoriaId, subId|null>` (semeado do servidor; entra no `formSnapshot`/baseline p/ o dirty-guard).

- [ ] **Step 2: Query das subcategorias por categoria**

Uma query `subcategorias_tecido` (todas as do tenant, ou por categoria sob demanda) p/ montar o select de cada categoria marcada. Options = subs daquela `categoria_tecido_id` (+ "nenhuma").

- [ ] **Step 3: UI — select ao lado de cada categoria marcada**

Onde as categorias são checkboxes (`catIds`), para cada categoria MARCADA renderizar um `Select` da sub (value = `subPorCat[catId] ?? ""`, onChange atualiza `subPorCat`). Categoria desmarcada: esconder o select e LIMPAR `subPorCat[catId]`. Categoria sem subcategorias cadastradas: o select some ou mostra "sem subcategorias".

- [ ] **Step 4: Salvar — montar os pares**

Na chamada `set_artigo_categorias` (linha ~475), trocar `_cat_ids: catIds` por `_pares: catIds.map(c => ({ categoria_tecido_id: c, subcategoria_tecido_id: subPorCat[c] ?? null }))`.

- [ ] **Step 5: Teste do estado**

Função pura (ou helper extraído) `paresParaSalvar(catIds, subPorCat)` → `[{categoria_tecido_id, subcategoria_tecido_id}]`; desmarcar categoria remove do payload; sub de categoria desmarcada não vaza. Teste unit.

- [ ] **Step 6: tsc + build + commit**

```bash
npx tsc --noEmit 2>&1 | grep TS2304 || echo "sem TS2304"; npm run build
git commit --only "src/routes/_authenticated/cadastro.tecidos.\$artigoId.tsx" tests/unit/tecido-subcategoria-por-cat.test.ts -m "feat(cadastro): subcategoria por categoria no Sheet do tecido (grava via set_artigo_categorias jsonb)"
```

- [ ] **Step 7: QA (prévia)** — Sheet do tecido: marcar uma categoria mostra o select da sub (só as daquela categoria); escolher + salvar grava; reabrir mostra a sub salva; desmarcar a categoria limpa a sub; tecido com 2 categorias → 2 selects independentes.

---

### Task 5: Exibição só-leitura no Desenvolvimento e na Ficha

**Files:**
- Modify: os pontos onde a categoria do tecido é exibida (A CONFIRMAR — ver Step 1)

**Interfaces:**
- Consumes: `artigo_categorias_tecido.subcategoria_tecido_id` + `subcategorias_tecido.nome` (Task 1).

- [ ] **Step 1: Mapear os pontos de exibição**

`grep -rn "categoria.*tecido\|categoria_tecido\|artigo_categorias_tecido" src/components/planejamento/planejamento-detail/ficha src/components/desenvolvimento` para achar onde a categoria do tecido já aparece na Ficha e no Dev (o tecido escolhido / a ficha impressa). A subcategoria entra AO LADO da categoria, mesmo embed.

- [ ] **Step 2: Trazer a sub no embed e exibir**

Onde a categoria do tecido é lida, acrescentar `subcategorias_tecido(nome)` ao embed (via `subcategoria_tecido_id`) e exibir "Categoria › Subcategoria" (ou o formato que a tela usa). SÓ leitura — nenhuma edição. Se a sub é null, mostra só a categoria.

- [ ] **Step 3: tsc + build + commit**

```bash
npx tsc --noEmit 2>&1 | grep TS2304 || echo "sem TS2304"; npm run build
git commit --only <arquivos tocados> -m "feat(dev/ficha): exibe a subcategoria do tecido (só leitura)"
```

- [ ] **Step 4: QA (prévia)** — no Desenvolvimento e na Ficha, o tecido mostra a subcategoria junto da categoria; sem sub → só a categoria; nada editável ali.

---

## Notas de execução (subagentes)

- **Ordem OBRIGATÓRIA:** Task 1 (tabela/coluna/gatilho) → Task 2 (RPC) → Task 3 (atributo) → Task 4 (Sheet) → Task 5 (Dev/Ficha). Task 2 depende de 1; 4 depende de 1+2; 5 depende de 1. Nunca paralelo.
- **Banco (Tasks 1-2):** testar SÓ na cópia local (Docker PG, `DATABASE_URL` LOCAL no brief — incidente 24/set: fallback é PRODUÇÃO). NUNCA DDL em txn de teste em produção. Diff-validar funções (`pg_get_functiondef`).
- **Modelo:** Tasks 1-2 (banco, cuidado) → Sonnet, revisão Opus. Tasks 3-5 (UI, molde claro) → Sonnet. **Haiku proibido.**
- **Revisão final (whole-branch):** Opus — focada em: atomicidade do `set_artigo_categorias`; o gatilho de validação não tem furo; RLS tenant; sub não vaza de categoria desmarcada; exibição não editável no Dev/Ficha.
- **Deploy:** banco ANTES do site; produção pelo dono (roteiro no painel). Volta: inversos LIFO (Task 2 antes do Task 1).
- Commit paralelo: `git commit --only`.
