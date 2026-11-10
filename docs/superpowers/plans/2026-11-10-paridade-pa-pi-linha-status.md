# Paridade PA/PI — seletor de Linha + status Pendente/Reprovado — Plano

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O card de Produto Acabado (PA) e Produto Importado (PI) ganha paridade com o Plan. Tecido: um seletor de Linha (reflexivo, grava `modelos.linha_id`, só com card) e um seletor Pendente/Reprovado (só sem card, exclusivo com o selo do kanban), com o "Criar card" recusando produto reprovado.

**Architecture:** Banco: coluna `status` nova em `produtos_acabados`/`produtos_importados`; as RPCs de salvar (`_salvar_produto_acabado_core`/`_salvar_produto_importado_core`) passam a aceitar `linha_id` e `status` em `_dados` pelo padrão `_dados ? 'chave'` (presente grava, ausente mantém), espelhando o modelo via o UPDATE do produto + o mesmo gatilho-handover do `tamanho_tipo`; as RPCs de criar card (`_criar_card_produto_acabado_core`/`_importado_core`) recusam produto `status='reprovado'`. Front: o card de PA/PI mostra o seletor de Linha com card e o Select Pendente/Reprovado sem card (exclusivo com o selo do kanban da F4a), e o filtro de status já existente passa a considerar o status do produto sem card.

**Tech Stack:** Postgres 17 (migrations via `psql -f`, guarda md5), TypeScript/React, TanStack Query, Vitest (unit + integração txn revertida na cópia local 54422).

**Spec:** `docs/superpowers/specs/2026-11-10-paridade-pa-pi-linha-status-design.md`

## Global Constraints

- **Padrão `_dados ? 'chave'`:** chave presente em `_dados` grava; ausente = mantém (igual ao `tamanho_tipo`: `linha_id = case when _dados ? 'linha_id' then v_linha else linha_id end`). Site antigo que não manda a chave não apaga nada.
- **Migrations aditivas com guarda md5.** md5 vivos: `_salvar_produto_acabado_core(uuid,jsonb,jsonb)` = `43a9ec5e03ddd9d85e016cb1ca516843`; `_criar_card_produto_acabado_core(uuid)` = `0241f96d9261bbaab4de9ebd34941831`. O importado: `_salvar_produto_importado_core(uuid,jsonb,jsonb,jsonb)` (4 args, tem `_etapas`) e `_criar_card_produto_importado_core(uuid)` — capturar o md5 vivo deles na Task antes de redefinir.
- **Status só vale sem card:** a coluna `status` do produto só é lida quando `modelo_id IS NULL`. Com card, o status é o do kanban (F4a).
- **Exclusividade no front:** `{kanban && produto.modelo_id ? <selo kanban> : <Select Pendente/Reprovado>}`. Linha: só com `produto.modelo_id`.
- **Reprovado bloqueia criar card:** `_criar_card_*_core` recusa `status='reprovado'` com `RAISE P0001` ASCII (`produto_reprovado_sem_card:`). Front pula/avisa.
- **RAISE 5xx só ASCII.** Linha reflexiva = `modelos.linha_id` (mesmo campo do Dev/Planejamento/Plan. Tecido).
- **DATABASE_URL = cópia local 54422 SEMPRE** nos testes. `_core` com EXECUTE revogado de PUBLIC/anon/authenticated (invariante #9).
- **NÃO tocar o Plan. Tecido** (é a referência). NÃO tocar a F4a (selo do kanban com card).

## Review Focus

- **Site antigo (sem a chave `linha_id`/`status`) não apaga:** o padrão `_dados ? 'chave'` protege; testado na Task 1/4 (salvar sem a chave mantém o valor).
- **Status de produto COM card é ignorado:** se um produto com `modelo_id` tiver `status='reprovado'` na coluna (legado/engano), ele NÃO deve ocultar o card nem bloquear nada — com card manda o kanban. Testado na Task 5 (filtro) e Task 3 (gate só sem card não se aplica — produto com card nem passa por criar_card).
- **Reprovado volta a Pendente libera o card:** o gate recusa reprovado mas aceita pendente/null; testado na Task 3.
- **Linha de outra loja:** gravar `linha_id` de outra loja deve ser recusado (as linhas são por tenant); testado na Task 1.
- **Exclusividade visual:** card com kanban nunca mostra o Select Pendente/Reprovado e vice-versa; testado na Task 6 (unit de render).

---

### Task 1: RPC de salvar do PA aceita `linha_id` e `status` (SQL)

**Files:**
- Create: `supabase/migrations/20261118100000_pa_linha_status.sql`
- Create (rollback): `supabase/rollback/20261118100000_pa_linha_status_down.sql`
- Test: `tests/integration/pa-linha-status.test.ts`

**Interfaces:**
- Consumes: `_salvar_produto_acabado_core(uuid,jsonb,jsonb)` (md5 `43a9ec5e...`); a coluna `status` criada nesta mesma migration em `produtos_acabados`.
- Produces: `_salvar_produto_acabado_core` grava `produtos_acabados.linha_id`? NÃO — a linha é do MODELO. Grava `modelos.linha_id` do espelho quando `_dados ? 'linha_id'` E o produto tem `modelo_id`; e grava `produtos_acabados.status` quando `_dados ? 'status'`.

- [ ] **Step 1: Teste de integração que FALHA**

```ts
// tests/integration/pa-linha-status.test.ts
import { describe, it, expect } from "vitest";
import { comoUsuario, withTx, ehBancoLocal } from "./db";
const RODA = ehBancoLocal();
describe.skipIf(!RODA)("PA: salvar grava linha_id no modelo + status no produto", () => {
  it("linha_id com _dados ? 'linha_id' grava em modelos.linha_id do espelho", async () => {
    await withTx(async (c) => {
      // produto com card: criar produto + modelo espelho; pegar uma linha real da loja
      // chamar salvar_produto_acabado com _dados contendo linha_id; reler modelos.linha_id
      // (o executor monta o fixture com os helpers reais de tests/integration/db.ts)
      expect(true).toBe(true); // placeholder do shape — o executor escreve o assert real abaixo
    });
  });
});
```
> Nota ao executor: inspecione `tests/integration/db.ts` e um teste de produto existente
> (ex.: `produto-acabado.test.ts`) para os helpers reais (`comoUsuario`, `withTx`, criar produto+modelo).
> O assert real: após `salvar_produto_acabado(_id, jsonb_build_object('linha_id', <linha>), _variantes)`,
> `select linha_id from modelos where id = <modelo_id>` = `<linha>`. E um 2º caso: `_dados` SEM `linha_id`
> mantém a linha anterior. E um 3º: `_dados` com `status='reprovado'` → `produtos_acabados.status='reprovado'`.

- [ ] **Step 2: Rodar o teste e confirmar FALHA**

Run: `DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54422/postgres" npx vitest run --no-file-parallelism tests/integration/pa-linha-status.test.ts`
Expected: FAIL (a coluna `status` não existe / a RPC não grava `linha_id`).

- [ ] **Step 3: Escrever a migration**

Gerar por troca exata sobre o `pg_get_functiondef` vivo (padrão do repo). A migration:
1. `ALTER TABLE produtos_acabados ADD COLUMN IF NOT EXISTS status text;` + `CHECK (status IS NULL OR status IN ('pendente','reprovado'))` como constraint NOT VALID + VALIDATE (ou inline se a tabela for pequena).
2. `CREATE OR REPLACE FUNCTION _salvar_produto_acabado_core(uuid,jsonb,jsonb)` idêntica ao vivo, acrescentando:
   - declarar `v_linha uuid; v_status text;`
   - ler `v_linha := nullif(_dados->>'linha_id','')::uuid;` e `v_status := nullif(_dados->>'status','');`
   - validar: `v_linha` (se presente) tem de ser uma linha da MESMA loja (senão `RAISE P0001 'Linha de outra loja' ASCII`); `v_status` (se presente) ∈ ('pendente','reprovado') senão P0001.
   - no UPDATE de `produtos_acabados`: `status = case when _dados ? 'status' then v_status else status end`.
   - quando `v_modelo_id is not null` e `_dados ? 'linha_id'`: `update modelos set linha_id = v_linha where id = v_modelo_id and tenant_id = <tenant>` (reflexivo; igual ao handover do tamanho_tipo — se houver gatilho de espelho para linha, seguir; senão o UPDATE direto do modelo dentro do core DEFINER).
   - guarda md5 aceita `43a9ec5e...`.
3. REVOKE/GRANT do `_core` (invariante #9).

Extrair o corpo vivo:
```bash
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54422 -U postgres -d postgres -tAc \
  "select pg_get_functiondef('_salvar_produto_acabado_core(uuid,jsonb,jsonb)'::regprocedure);" > /tmp/core_pa_vivo.sql
```

- [ ] **Step 4: Aplicar na cópia e rodar o teste (passa)**

Run:
```bash
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54422 -U postgres -d postgres -f supabase/migrations/20261118100000_pa_linha_status.sql
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54422/postgres" npx vitest run --no-file-parallelism tests/integration/pa-linha-status.test.ts
```
Expected: PASS.

- [ ] **Step 5: Teste — linha de outra loja recusada + site antigo não apaga**

Acrescentar casos: `_dados` com `linha_id` de outra loja → P0001; salvar sem `linha_id`/`status` mantém os valores.

- [ ] **Step 6: Rollback + commit**

```bash
# rollback: devolve o corpo vivo 43a9ec5e (sem linha_id/status) + DROP COLUMN status (guarda md5 do novo)
git add supabase/migrations/20261118100000_pa_linha_status.sql supabase/rollback/20261118100000_pa_linha_status_down.sql tests/integration/pa-linha-status.test.ts
git commit -m "feat(pa): salvar aceita linha_id (reflexivo no modelo) + coluna status no produto"
```

---

### Task 2: RPC de salvar do PI aceita `linha_id` e `status` (SQL)

**Files:**
- Create: `supabase/migrations/20261118110000_pi_linha_status.sql`
- Create (rollback): `supabase/rollback/20261118110000_pi_linha_status_down.sql`
- Test: `tests/integration/pi-linha-status.test.ts`

**Interfaces:**
- Consumes: `_salvar_produto_importado_core(uuid,jsonb,jsonb,jsonb)` (4 args — tem `_etapas`; capturar o md5 vivo na Step 1). Coluna `status` nova em `produtos_importados`.
- Produces: mesma semântica da Task 1, no importado.

- [ ] **Step 1: Capturar o md5 vivo do importado + teste que FALHA**

```bash
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54422 -U postgres -d postgres -tAc \
  "select md5(pg_get_functiondef('_salvar_produto_importado_core(uuid,jsonb,jsonb,jsonb)'::regprocedure));"
```
Teste `pi-linha-status.test.ts` espelha o da Task 1 (linha_id no modelo, status no produto, outra loja recusada, sem chave mantém), com os helpers reais.

- [ ] **Step 2: Rodar e confirmar FALHA**

Run: `DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54422/postgres" npx vitest run --no-file-parallelism tests/integration/pi-linha-status.test.ts`
Expected: FAIL.

- [ ] **Step 3: Migration (espelha a Task 1, 4 args)**

`ALTER TABLE produtos_importados ADD COLUMN status text` + CHECK. `CREATE OR REPLACE _salvar_produto_importado_core(uuid,jsonb,jsonb,jsonb)` com as mesmas adições (linha_id no modelo, status no produto, validações, `_dados ? 'chave'`). Guarda md5 do vivo capturado na Step 1. REVOKE/GRANT.

- [ ] **Step 4: Aplicar + teste passa**

Run:
```bash
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54422 -U postgres -d postgres -f supabase/migrations/20261118110000_pi_linha_status.sql
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54422/postgres" npx vitest run --no-file-parallelism tests/integration/pi-linha-status.test.ts
```
Expected: PASS.

- [ ] **Step 5: Rollback + commit**

```bash
git add supabase/migrations/20261118110000_pi_linha_status.sql supabase/rollback/20261118110000_pi_linha_status_down.sql tests/integration/pi-linha-status.test.ts
git commit -m "feat(pi): salvar aceita linha_id (reflexivo) + coluna status no produto"
```

---

### Task 3: Criar card recusa produto reprovado (SQL)

**Files:**
- Modify: `supabase/migrations/20261118120000_criar_card_gate_reprovado.sql` (criar)
- Create (rollback): `supabase/rollback/20261118120000_criar_card_gate_reprovado_down.sql`
- Test: `tests/integration/criar-card-gate-reprovado.test.ts`

**Interfaces:**
- Consumes: `_criar_card_produto_acabado_core(uuid)` (md5 `0241f96d...`) e `_criar_card_produto_importado_core(uuid)` (capturar md5); a coluna `status` das Tasks 1/2.
- Produces: ambos os `_core` recusam `status='reprovado'` com `RAISE 'produto_reprovado_sem_card: <produto>' USING ERRCODE='P0001'`.

- [ ] **Step 1: Teste que FALHA**

```ts
// tests/integration/criar-card-gate-reprovado.test.ts — shape:
// produto sem card com status='reprovado' → criar_cards_produto_acabado([id]) deve dar P0001 'produto_reprovado_sem_card'.
// produto com status='pendente' (ou null) → cria o card normalmente.
```
> O executor usa os helpers reais e um produto de teste; asserta o erro P0001 no reprovado e o sucesso no pendente.

- [ ] **Step 2: Rodar e confirmar FALHA**

Run: `DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54422/postgres" npx vitest run --no-file-parallelism tests/integration/criar-card-gate-reprovado.test.ts`
Expected: FAIL (hoje cria o card mesmo reprovado).

- [ ] **Step 3: Migration**

`CREATE OR REPLACE` dos 2 `_core` (acabado e importado), idênticos ao vivo + no início (depois de ler o produto): `if <status do produto> = 'reprovado' then raise exception 'produto_reprovado_sem_card: %', <nome/ref> using errcode='P0001'; end if;`. Guarda md5 dos 2 vivos. REVOKE/GRANT.

- [ ] **Step 4: Aplicar + teste passa**

Run:
```bash
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54422 -U postgres -d postgres -f supabase/migrations/20261118120000_criar_card_gate_reprovado.sql
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54422/postgres" npx vitest run --no-file-parallelism tests/integration/criar-card-gate-reprovado.test.ts
```
Expected: PASS.

- [ ] **Step 5: Mensagem PT no erro-mensagem.ts + commit**

Adicionar a tradução de `produto_reprovado_sem_card:` em `src/lib/erro-mensagem.ts` (ex.: "Este produto está reprovado — volte-o a Pendente para criar o card.").
```bash
git add supabase/migrations/20261118120000_criar_card_gate_reprovado.sql supabase/rollback/20261118120000_criar_card_gate_reprovado_down.sql tests/integration/criar-card-gate-reprovado.test.ts src/lib/erro-mensagem.ts
git commit -m "feat(pa/pi): criar card recusa produto reprovado (P0001 ASCII + msg PT)"
```

---

### Task 4: Front — tipo + draft + salvar de `linha_id`/`status` em PA e PI

**Files:**
- Modify: `src/components/produto-acabado/ProdutoAcabadoSheet.tsx` (embed do modelo já traz `linha_id`; draft e `salvarUmProduto` passam a mandar `linha_id`/`status` quando mudam)
- Modify: `src/components/produto-acabado/shared.ts` (tipo `ProdutoDraft` + `chaveDirty`)
- Modify: `src/components/produto-importado/ProdutoImportadoSheet.tsx` + `shared.ts` (espelho)
- Test: `tests/unit/pa-draft-linha-status.test.ts`

**Interfaces:**
- Consumes: as RPCs das Tasks 1/2 (aceitam `linha_id`/`status` em `_dados`).
- Produces: o draft do produto ganha `linhaId` (do `modelo.linha_id`) e `status` (do produto); `salvarUmProduto` inclui `linha_id`/`status` no `_dados` quando tocados.

- [ ] **Step 1: Teste unit que FALHA**

```ts
// tests/unit/pa-draft-linha-status.test.ts
import { describe, it, expect } from "vitest";
import { produtoDataParaSalvar } from "@/components/produto-acabado/shared"; // helper puro (criar se não existe)
describe("produtoDataParaSalvar", () => {
  it("inclui linha_id quando o draft tem linhaId tocado", () => {
    const d = produtoDataParaSalvar({ linhaId: "L1", statusProduto: null } as any, { linhaTocada: true });
    expect(d.linha_id).toBe("L1");
  });
  it("inclui status quando tocado", () => {
    const d = produtoDataParaSalvar({ statusProduto: "reprovado" } as any, { statusTocado: true });
    expect(d.status).toBe("reprovado");
  });
  it("NÃO inclui linha_id/status quando não tocados (site não apaga)", () => {
    const d = produtoDataParaSalvar({ linhaId: "L1", statusProduto: "reprovado" } as any, {});
    expect("linha_id" in d).toBe(false); expect("status" in d).toBe(false);
  });
});
```
> O executor ajusta ao shape real do `ProdutoDraft`/`salvarUmProduto` do repo; o essencial é: chave só vai no `_dados` quando o campo foi tocado (padrão `_dados ? 'chave'`).

- [ ] **Step 2: Rodar e confirmar FALHA**

Run: `npx vitest run --no-file-parallelism tests/unit/pa-draft-linha-status.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar no draft/salvar (PA + PI)**

Em `shared.ts`: `ProdutoDraft` ganha `linhaId: string | null` (do `modelo.linha_id`) e `statusProduto: "pendente"|"reprovado"|null` (do produto). `chaveDirty` inclui os dois. No `salvarUmProduto`, montar `_dados` incluindo `linha_id`/`status` só quando diferem da base (tocados). Espelhar em PI.

- [ ] **Step 4: Rodar e confirmar PASSA + tsc**

Run:
```bash
npx vitest run --no-file-parallelism tests/unit/pa-draft-linha-status.test.ts
npx tsc --noEmit 2>&1 | grep -E "produto-acabado|produto-importado|TS[0-9]"
```
Expected: PASS; tsc limpo.

- [ ] **Step 5: Commit**

```bash
git add src/components/produto-acabado/ src/components/produto-importado/ tests/unit/pa-draft-linha-status.test.ts
git commit -m "feat(pa/pi): draft e salvar incluem linha_id/status (so quando tocados)"
```

---

### Task 5: Front — filtro de status considera o produto sem card

**Files:**
- Modify: `src/components/produto-acabado/ProdutoAcabadoSheet.tsx` (a poda do `filtroStatus`)
- Modify: `src/components/produto-importado/ProdutoImportadoSheet.tsx`
- Test: `tests/unit/pa-filtro-status-sem-card.test.ts`

**Interfaces:**
- Consumes: `statusProduto` do draft (Task 4); `ehReprovadoStatus` (`src/lib/reprovado.ts`).
- Produces: o filtro "sem_reprovado" oculta também o produto SEM card cujo `statusProduto='reprovado'`.

- [ ] **Step 1: Teste unit que FALHA**

```ts
// tests/unit/pa-filtro-status-sem-card.test.ts
import { describe, it, expect } from "vitest";
import { produtoPassaFiltroStatus } from "@/components/produto-acabado/shared"; // helper puro (criar)
describe("produtoPassaFiltroStatus", () => {
  it("sem_reprovado oculta produto SEM card reprovado", () => {
    expect(produtoPassaFiltroStatus({ modelo_id: null, statusProduto: "reprovado" } as any, "sem_reprovado")).toBe(false);
  });
  it("sem_reprovado mostra produto sem card pendente", () => {
    expect(produtoPassaFiltroStatus({ modelo_id: null, statusProduto: "pendente" } as any, "sem_reprovado")).toBe(true);
  });
  it("com card: usa o status do modelo (kanban), ignora statusProduto", () => {
    // produto com modelo_id reprovado no modelo é ocultado; statusProduto da coluna é ignorado
    expect(produtoPassaFiltroStatus({ modelo_id: "m1", modeloStatusPlan: "reprovado", statusProduto: null } as any, "sem_reprovado")).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e confirmar FALHA**

Run: `npx vitest run --no-file-parallelism tests/unit/pa-filtro-status-sem-card.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar o helper + ligar na poda**

`produtoPassaFiltroStatus(produto, filtro)`: se `modelo_id` → usa o status do modelo (como hoje, `ehReprovadoStatus`); se `!modelo_id` → usa `statusProduto`. `filtro === "sem_reprovado"` oculta reprovado. Ligar na poda dos cards de PA e PI (onde o `filtroStatus` já poda).

- [ ] **Step 4: Rodar + tsc + commit**

Run: `npx vitest run --no-file-parallelism tests/unit/pa-filtro-status-sem-card.test.ts && npx tsc --noEmit 2>&1 | grep -E "produto-|TS[0-9]"`
Expected: PASS; tsc limpo.
```bash
git add src/components/produto-acabado/ src/components/produto-importado/ tests/unit/pa-filtro-status-sem-card.test.ts
git commit -m "feat(pa/pi): filtro de status considera o produto sem card (reprovado oculto)"
```

---

### Task 6: Front — seletores no card (Linha com card, Pendente/Reprovado sem card)

**Files:**
- Modify: `src/components/produto-acabado/ProdutoCard.tsx`
- Modify: `src/components/produto-importado/ProdutoImportadoCard.tsx`
- Test: `tests/unit/produto-card-linha-status.test.ts`

**Interfaces:**
- Consumes: `linhaId`/`statusProduto` do produto (Task 4); as linhas do cadastro (query existente de linhas); o padrão do `onStatus`/Select do `plan-tecido/ModelCard.tsx`.
- Produces: o card renderiza — seletor de Linha quando `modelo_id` existe; Select Pendente/Reprovado quando `!modelo_id`; nunca os dois. O selo do kanban (F4a) segue com card.

- [ ] **Step 1: Teste unit de render que FALHA**

```tsx
// tests/unit/produto-card-linha-status.test.ts (render com @testing-library/react)
// 1) produto COM modelo_id: aparece o seletor de Linha; NÃO aparece Pendente/Reprovado.
// 2) produto SEM modelo_id: aparece Pendente/Reprovado; NÃO aparece o seletor de Linha nem o selo do kanban.
// 3) exclusividade: nunca selo do kanban + Select Pendente/Reprovado juntos.
```
> O executor usa o padrão de render dos testes de card existentes (há testes de ProdutoCard no repo); asserta por `data-testid`/texto.

- [ ] **Step 2: Rodar e confirmar FALHA**

Run: `npx vitest run --no-file-parallelism tests/unit/produto-card-linha-status.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar os seletores no card**

- Seletor de Linha: `{produto.modelo_id && (<SelectLinha value={linhaId} onChange={(l) => onChangeLinha(l)} options={linhasOpts} />)}` — reusar o componente/Select de linha do Plan. Tecido (`plan-tecido/ModelCard.tsx` ~510) ou um equivalente local; `onChange` faz `patchProduto(id, { linhaId, linhaTocada: true })`.
- Select Pendente/Reprovado: `{!produto.modelo_id && (<SelectStatus value={statusProduto ?? "pendente"} onChange={...} />)}` — espelhar o `onStatus` do `ModelCard` do Plan. Tecido; `onChange` faz `patchProduto(id, { statusProduto, statusTocado: true })`.
- O selo do kanban (F4a) continua em `{kanban && produto.modelo_id && ...}` — confirmar que fica EXCLUSIVO com o Select de status.

- [ ] **Step 4: Rodar + tsc + build**

Run:
```bash
npx vitest run --no-file-parallelism tests/unit/produto-card-linha-status.test.ts
npx tsc --noEmit 2>&1 | grep -E "ProdutoCard|ProdutoImportadoCard|TS[0-9]"
npx vite build 2>&1 | grep -E "built in|error"
```
Expected: PASS; tsc limpo; build ok.

- [ ] **Step 5: Commit**

```bash
git add src/components/produto-acabado/ProdutoCard.tsx src/components/produto-importado/ProdutoImportadoCard.tsx tests/unit/produto-card-linha-status.test.ts
git commit -m "feat(pa/pi): seletor de Linha (com card) + Pendente/Reprovado (sem card), exclusivo com o selo do kanban"
```

---

### Task 7: Front — "Criar card" pula/avisa produto reprovado + docs

**Files:**
- Modify: `src/components/produto-acabado/ProdutoAcabadoSheet.tsx` (`criarCards`)
- Modify: `src/components/produto-importado/ProdutoImportadoSheet.tsx`
- Modify: `CLAUDE.md` + memória
- Test: `tests/unit/criar-card-pula-reprovado.test.ts`

**Interfaces:**
- Consumes: `statusProduto` do produto (Task 4); o erro `produto_reprovado_sem_card:` (Task 3).
- Produces: o front exclui produtos reprovados da seleção elegível de "Criar card" (com aviso), e trata o P0001 do servidor como rede de segurança.

- [ ] **Step 1: Teste unit que FALHA**

```ts
// tests/unit/criar-card-pula-reprovado.test.ts
import { describe, it, expect } from "vitest";
import { elegiveisParaCriarCard } from "@/components/produto-acabado/shared"; // helper puro (criar)
describe("elegiveisParaCriarCard", () => {
  it("exclui produto reprovado (sem card)", () => {
    const r = elegiveisParaCriarCard([{ id: "a", modelo_id: null, statusProduto: "reprovado" }, { id: "b", modelo_id: null, statusProduto: "pendente" }] as any);
    expect(r.elegiveis).toEqual(["b"]);
    expect(r.reprovados).toEqual(["a"]);
  });
});
```

- [ ] **Step 2: Rodar e confirmar FALHA**

Run: `npx vitest run --no-file-parallelism tests/unit/criar-card-pula-reprovado.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar o helper + ligar no criarCards (PA + PI)**

`elegiveisParaCriarCard(produtos)` → `{ elegiveis: string[], reprovados: string[] }`. No `criarCards`, usar `elegiveis` (não mandar reprovados ao servidor) e, se houver `reprovados`, `toast`/aviso "N produto(s) reprovado(s) não entram — volte a Pendente". O P0001 do servidor (Task 3) é a rede de segurança (traduzido pela Task 3).

- [ ] **Step 4: Rodar + tsc + build + suíte da área**

Run:
```bash
npx vitest run --no-file-parallelism tests/unit/criar-card-pula-reprovado.test.ts
npx tsc --noEmit 2>&1 | grep -E "TS[0-9]"
npx vite build 2>&1 | grep -E "built in|error"
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54422/postgres" npx vitest run --no-file-parallelism tests/integration/pa-linha-status.test.ts tests/integration/pi-linha-status.test.ts tests/integration/criar-card-gate-reprovado.test.ts
```
Expected: tudo verde.

- [ ] **Step 5: Docs + commit**

Documentar no CLAUDE.md (bloco Produto Acabado/Revenda + invariante 13) a paridade: Linha reflexiva via `modelos.linha_id` (RPC de salvar); coluna `status` do produto só vale sem card; reprovado bloqueia criar card. Atualizar a memória `project_status_pa_pi_sem_card`.
```bash
git add src/components/produto-acabado/ src/components/produto-importado/ tests/unit/criar-card-pula-reprovado.test.ts CLAUDE.md
git commit -m "feat(pa/pi): Criar card pula reprovado + docs da paridade"
```

---

## Ordem de deploy (para o roteiro)

Banco ANTES do site. 3 migrations aditivas (2 colunas `status` + 4 CREATE OR REPLACE, guarda md5, com rollback): `20261118100000` (PA salvar+coluna), `20261118110000` (PI salvar+coluna), `20261118120000` (gate reprovado). Nenhuma trava pesada (ADD COLUMN pega AccessExclusive por instante — horário calmo). Site novo + banco velho = o seletor de Linha/status grava chave que a RPC antiga ignora (não quebra, mas não persiste) → banco antes do site. Volta: downs LIFO (gate → PI → PA), aditivas, 0 perda. Prévia em localhost:5190 antes do deploy.
