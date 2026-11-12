# Kanban das Etapas PL — Onda 3 (telas) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development para implementar task-a-task. Os passos usam checkbox (`- [ ]`).

**Goal:** Dar a carcaça (telas) ao motor das Etapas PL: um kanban configurável (board + Config da Loja) espelhando o do Desenvolvimento, com 1 card por produto que abre o Sheet de Serviços já existente — mais o ajuste no motor para a entrada virar requisito da 1ª coluna.

**Architecture:** 3 camadas. (A) Banco: condição nova `tem_peca_teste` no catálogo PL + `fn_etapas_pl_entrada` passa a avaliar o requisito da 1ª coluna configurada + seed da 1ª coluna com `["tem_peca_teste"]`. (B) Libs puras de front próprias do PL (`etapas-pl-config.ts`/`-ui.ts`/`-rpc.ts` + hook), espelho das `kanban-auto*.ts` do Dev, com anti-drift contra o SQL. (C/D/E) Config da Loja (reusa `SortableListCard`/`RequisitosStatusDialog`/`KanbanAutomaticoBloco` com catálogo/RPCs do PL) e board `/pcp/etapas` (componentizado, arraste HTML5, "Mover para…" mobile, abre `TerceirizadosDetail`).

**Tech Stack:** Postgres 17 (migration aditiva + md5 guard). Vite+React+TypeScript, TanStack Router/Query, Tailwind+Radix. Vitest (unit + integração txn revertida). HTML5 drag-and-drop nativo.

**Spec:** `docs/superpowers/specs/2026-11-12-kanban-pl-onda3-telas-design.md`

## Global Constraints

- Branch ATIVA: `feature/plan-tecido-a1`. Ondas 1+2 (motor) já no repo, inertes (`etapas_pl_automatico=false` default).
- **Banco ANTES do site** (A é banco; a condição nova e o seed precisam existir antes do front que os usa).
- **Testes com DDL SÓ na cópia local** `/tmp/dburl-local.txt` (54422); subagente usa `DATABASE_URL` LOCAL SEMPRE, NUNCA `/tmp/dburl.txt` (=PRODUÇÃO); NUNCA `\i` migration em txn de teste; NUNCA DDL em produção.
- **CREATE TRIGGER sem DROP** em tabelas de negócio (regra `reference_policy_ddl_trava_auth`): `DROP TRIGGER IF EXISTS … ON public.<tabela de negócio>` prende auth/storage até o COMMIT. Usar `DO $$ … IF NOT EXISTS (SELECT 1 FROM pg_trigger …) THEN EXECUTE 'CREATE TRIGGER …'; END IF; END $$;`. DROP só no `_down_drop`.
- **md5 ANTES/DEPOIS** de toda função SQL redefinida (guarda `$pre$` que aborta se o vivo divergir), padrão das migrations da Onda 2.
- **RAISE 5xx só ASCII** (P0001 é 400, ok; mas sem acento em prefixo de RAISE). **DEFINER + REVOKE dos 3** nas internas; RPC pública REVOKE PUBLIC/anon + GRANT authenticated; `SET search_path TO 'public'`.
- **Anti-drift TS↔SQL**: condição nova e libs puras têm fixtures compartilhadas; mudar a regra = mudar os dois lados e a fixture.
- **`git commit --only <arquivos>`** (nunca `git add .`); arquivo NOVO = `git add <caminho>` antes.
- **Build não faz tsc**: após imports/identificadores, `npx tsc --noEmit`.
- **Prévia (localhost:5190)** antes do deploy; deploy rodado pelo dono; QA Playwright com `E2E_BASE_URL=http://localhost:5173`.
- **Reaproveitar, não duplicar:** `SortableListCard`, `RequisitosStatusDialog`/`RequisitosStatusButton`, `KanbanAutomaticoBloco`/`KanbanChaveDialog`, `TerceirizadosDetail`, `ServicoAtrasoBadge`, `ModeloResumoFoto` recebem catálogo/RPCs/props do PL — sem copiar o componente.

## Review Focus

- **Entrada via 1ª coluna com board vazio/sem requisito:** 1ª coluna sem `tem_peca_teste` nem outro requisito = toda entrada manual; produto nunca entra sozinho. Teste em Task 2 (entrada só quando cumpre o requisito configurado da 1ª coluna; 1ª coluna sem requisito = ninguém entra sozinho).
- **`tem_peca_teste` vs `peca_teste_aprovada`:** a condição nova é "existe trilha" (aprovada OU não); a antiga é "trilhas existentes aprovadas" (vacuamente true sem trilha). Confundir inverte a porta de entrada. Teste em Task 1 (produto com trilha não aprovada: `tem_peca_teste=true`, `peca_teste_aprovada=false`).
- **Saída pré vs pós-Explosão:** produto que perde a trilha SAI só se pré-Explosão; pós-Explosão nunca sai. Teste em Task 2.
- **Chave off = board estático:** com `etapas_pl_automatico=false`, a entrada ainda coloca o card no board (intencional) mas nada DERIVA/move entre colunas; mover é decisão manual da pessoa. Teste em Task 2 (entrada com chave off não enfileira recálculo) e Task 8 (mover com chave off = decisão da pessoa).
- **Card órfão / status inexistente:** produto com `status_etapa_pl` que não bate nenhuma coluna cai na 1ª coluna (não some). Teste em Task 4 (lib) e Task 9 (board render).

---

## File Structure

**A — Banco (1 migration + rollback):**
- `supabase/migrations/20261128100000_etapas_pl_entrada_configuravel.sql` — condição `tem_peca_teste` em `avaliar_condicoes_etapas_pl`; `fn_etapas_pl_entrada` lê o requisito da 1ª coluna; `_kanban_pl_seed_etapas` grava `etapas_pl_requisitos[1ª]=["tem_peca_teste"]`.
- `supabase/rollback/20261128100000_etapas_pl_entrada_configuravel_down.sql` — devolve os 3 corpos de antes.

**B — Libs de front (puras + hook):**
- `src/lib/etapas-pl-condicoes.ts` (MODIFICAR) — add `tem_peca_teste` ao `CONDICOES_PL`.
- `src/lib/etapas-pl-config.ts` (CRIAR) — tipos + derivação pura (espelho do SQL PL).
- `src/lib/etapas-pl-ui.ts` (CRIAR) — UI pura (modo coluna, selo, toasts, filtro, RPC contrato).
- `src/lib/etapas-pl-rpc.ts` (CRIAR) — wrappers das RPCs.
- `src/hooks/useEtapasPlConfig.ts` (CRIAR) — leitura da config.

**C — Config da Loja:**
- `src/lib/config-loja-colab.ts` (MODIFICAR) — `etapas_pl_*` em `BLOCO_DA_COLUNA`/`BLOCO_DO_FOCO`.
- `src/components/admin/EtapasPlConfigCard.tsx` (CRIAR) — bloco de colunas+requisitos+chave do PL.
- `src/routes/_authenticated/admin/configuracoes.tsx` (MODIFICAR) — montar o card novo no lugar do `EtapasPLCard` antigo.

**D — Board:**
- `src/routes/_authenticated/pcp.etapas.tsx` (REESCREVER) — rota do board.
- `src/components/producao/etapas/EtapasPlKanban.tsx` (CRIAR) — board (colunas + arraste).
- `src/components/producao/etapas/EtapaPlCard.tsx` (CRIAR) — card do produto (desktop+mobile).

**E — Selo/filtro:** dentro de D (selo no card via `etapas-pl-ui.ts`; filtro de etapa no board).

**Testes:**
- `tests/integration/etapas-pl-entrada-configuravel.test.ts` (A)
- `tests/fixtures/etapas-pl-casos.ts` + `tests/integration/etapas-pl-derivacao-antidrift.test.ts` (B)
- `tests/unit/etapas-pl-ui.test.ts` (B)
- `tests/unit/etapas-pl-config-card.test.ts` (C, se couber render test)

---

## Task 1: Condição `tem_peca_teste` no catálogo PL (TS + SQL + anti-drift)

**Files:**
- Modify: `src/lib/etapas-pl-condicoes.ts` (add 1 entrada ao `CONDICOES_PL`)
- Create: `supabase/migrations/20261128100000_etapas_pl_entrada_configuravel.sql` (só a parte do avaliador nesta task; o resto nas Tasks 2/3 — MESMO arquivo)
- Test: `tests/integration/kanban-pl-condicoes.test.ts` (anti-drift já existe; estende para a key nova)

**Interfaces:**
- Produces: condição SQL `tem_peca_teste` dentro do jsonb de `_avaliar_condicoes_etapas_pl_core`; `CONDICOES_PL` com 8 keys (TS).

- [ ] **Step 1: Confirmar o estado vivo e pegar o md5 de `_avaliar_condicoes_etapas_pl_core`**

```bash
export DATABASE_URL="$(cat /tmp/dburl-local.txt)"
psql "$DATABASE_URL" -At -c "select md5(pg_get_functiondef('public._avaliar_condicoes_etapas_pl_core(uuid,uuid[])'::regprocedure));"
psql "$DATABASE_URL" -At -c "select pg_get_functiondef('public._avaliar_condicoes_etapas_pl_core(uuid,uuid[])'::regprocedure);" > /tmp/claude-scratch-avaliador-vivo.sql
```
Guarde o md5 (ex.: `XXXX`) — vai no guard `$pre$` da migration. Leia o corpo para saber ONDE inserir a key (dentro do `jsonb_build_object` das condições, junto de `peca_teste_aprovada`).

- [ ] **Step 2: Escrever o teste anti-drift da key nova (integração)**

Em `tests/integration/kanban-pl-condicoes.test.ts`, adicionar um caso que semeia um modelo com UMA linha `modelo_servico_mo` de categoria `exige_peca_teste=true` e `aprovado=false`, e asserta via `avaliar_condicoes_etapas_pl([id])`:

```ts
it("tem_peca_teste: trilha existe (aprovada ou nao) => true; peca_teste_aprovada => false quando nao aprovada", async () => {
  await withTx(async (c) => {
    const { tenant, modelo } = await semearModeloComTrilhaPecaTeste(c, { aprovado: false }); // helper da suite
    const r = await um<{ j: Record<string, Record<string, boolean>> }>(
      c, `select avaliar_condicoes_etapas_pl(array[$1]::uuid[]) as j`, [modelo],
    );
    expect(r.j[modelo].tem_peca_teste).toBe(true);
    expect(r.j[modelo].peca_teste_aprovada).toBe(false);
  });
});
```
Se não houver helper `semearModeloComTrilhaPecaTeste`, use o padrão de semeadura dos outros testes `kanban-pl-*` (inserir `modelos`, `cad`, `modelo_servico_mo`, `categorias_terceirizado` com `exige_peca_teste`). Reusar o helper da própria suíte de condições se existir.

- [ ] **Step 3: Rodar o teste e ver FALHAR**

```bash
export DATABASE_URL="$(cat /tmp/dburl-local.txt)"
npx vitest run --no-file-parallelism tests/integration/kanban-pl-condicoes.test.ts -t "tem_peca_teste"
```
Esperado: FALHA (`tem_peca_teste` undefined — a key não existe no avaliador ainda).

- [ ] **Step 4: Começar a migration — redefinir `_avaliar_condicoes_etapas_pl_core` com a key nova**

Criar `supabase/migrations/20261128100000_etapas_pl_entrada_configuravel.sql` com cabeçalho no padrão da Onda 2 (comentário, `BEGIN`, guard `$pre$` de md5, `SET search_path`), e redefinir `_avaliar_condicoes_etapas_pl_core` copiando o corpo vivo (de `/tmp/claude-scratch-avaliador-vivo.sql`) e adicionando no `jsonb_build_object`, junto de `peca_teste_aprovada`:

```sql
    -- tem_peca_teste: EXISTE trilha de peca teste (aprovada OU nao). Porta de entrada da 1a coluna.
    'tem_peca_teste', exists (
      select 1 from modelo_servico_mo pm
       join categorias_terceirizado pc
         on pc.id = pm.categoria_terceirizado_id and pc.tenant_id = m.tenant_id and pc.exige_peca_teste
       where pm.modelo_id = m.id),
```
Manter TODAS as outras keys byte a byte. REVOKE dos 3 ao fim (igual ao vivo). Guard `$pre$` confere o md5 do Step 1.

- [ ] **Step 5: Adicionar a entrada TS ao catálogo**

Em `src/lib/etapas-pl-condicoes.ts`, no array `CONDICOES_PL`, adicionar (a ordem não importa para o anti-drift de keys, mas ponha junto das de peça teste):

```ts
  { key: "tem_peca_teste", label: "Tem peça teste", descricao: "Existe ao menos um bloco de peça teste (aprovado ou não) — porta de entrada." },
```

- [ ] **Step 6: Aplicar a migration na cópia e rodar o teste**

```bash
export DATABASE_URL="$(cat /tmp/dburl-local.txt)"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261128100000_etapas_pl_entrada_configuravel.sql
npx vitest run --no-file-parallelism tests/integration/kanban-pl-condicoes.test.ts
npx tsc --noEmit 2>&1 | grep -E "etapas-pl-condicoes" || echo "tsc ok"
```
Esperado: PASS (anti-drift casa TS↔SQL com 8 keys; a key nova funciona).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20261128100000_etapas_pl_entrada_configuravel.sql tests/integration/kanban-pl-condicoes.test.ts
git commit --only supabase/migrations/20261128100000_etapas_pl_entrada_configuravel.sql src/lib/etapas-pl-condicoes.ts tests/integration/kanban-pl-condicoes.test.ts -m "feat(etapas-pl): condicao tem_peca_teste (porta de entrada configuravel)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `fn_etapas_pl_entrada` avalia o requisito da 1ª coluna (não mais peça teste fixo)

**Files:**
- Modify: `supabase/migrations/20261128100000_etapas_pl_entrada_configuravel.sql` (MESMO arquivo da Task 1 — acrescenta a redefinição de `fn_etapas_pl_entrada`)
- Modify: `supabase/rollback/20261128100000_etapas_pl_entrada_configuravel_down.sql`
- Test: `tests/integration/etapas-pl-entrada-configuravel.test.ts` (CRIAR)

**Interfaces:**
- Consumes: `tem_peca_teste` (Task 1); `_etapas_pl_cfg`, `_kanban_fluxo`, `avaliar_condicoes_etapas_pl`/`_core`, `_etapas_pl_enfileirar`, GUC `app.etapas_pl_sistema` (Ondas 1/2).
- Produces: `fn_etapas_pl_entrada` que entra o card na 1ª coluna quando cumpre os requisitos DELA; sai (→NULL) quando deixa de cumprir pré-Explosão; pós-Explosão nunca sai.

- [ ] **Step 1: Ler o corpo vivo de `fn_etapas_pl_entrada` e pegar md5**

```bash
export DATABASE_URL="$(cat /tmp/dburl-local.txt)"
psql "$DATABASE_URL" -At -c "select md5(pg_get_functiondef('public.fn_etapas_pl_entrada()'::regprocedure));"
psql "$DATABASE_URL" -At -c "select pg_get_functiondef('public.fn_etapas_pl_entrada()'::regprocedure);" > /tmp/claude-scratch-entrada-viva.sql
```
Hoje a entrada é: `v_tem_pt := EXISTS(trilha peça teste)`; se `v_tem_pt AND status_etapa_pl IS NULL AND módulo etapas_pl` → entra na 1ª etapa; SAÍDA se `NOT v_tem_pt AND status_etapa_pl IS NOT NULL AND NOT pos_explosao`.

- [ ] **Step 2: Escrever o teste da entrada configurável**

Criar `tests/integration/etapas-pl-entrada-configuravel.test.ts` (reusar a infra de `tests/integration/kanban-pl-onda2-entrada.test.ts`: `withTx`, `um`, semeadura de tenant/modelo/config, `semJwt`). Casos:

```ts
// 1a coluna com requisito tem_peca_teste: modelo ganha trilha => entra na 1a etapa
it("1a coluna exige tem_peca_teste: ganhar trilha coloca o card na 1a etapa", async () => { /* config board ["Peça Teste","Separação"], etapas_pl_requisitos={"peca teste":["tem_peca_teste"]}; inserir modelo_servico_mo exige_peca_teste; esperar status_etapa_pl = _kanban_fluxo(...)[1] */ });

// 1a coluna exige enviado_a_servicos (Explosao): produto SEM peca teste mas enviado entra
it("1a coluna exige enviado_a_servicos: produto sem peca teste mas enviado a Explosao entra", async () => { /* requisitos 1a=["enviado_a_servicos"]; sem trilha; setar cad.enviado_corte=true; esperar status_etapa_pl = 1a etapa */ });

// 1a coluna SEM requisito: ninguem entra sozinho (so manual)
it("1a coluna sem requisito: ganhar trilha NAO coloca no board (entrada so manual)", async () => { /* requisitos {}; trilha; esperar status_etapa_pl NULL */ });

// saida pre-Explosao
it("perder a ultima trilha PRE-Explosao tira do board (NULL)", async () => { /* ja no board pela trilha; DELETE da linha; sem cad.enviado_corte; esperar NULL */ });

// pos-Explosao NUNCA sai
it("perder a trilha POS-Explosao NAO tira", async () => { /* no board; cad.enviado_corte=true; DELETE trilha; esperar status_etapa_pl mantido */ });

// chave off: entra mas NAO enfileira recalculo
it("chave off: entrada coloca no board mas nao enfileira", async () => { /* etapas_pl_automatico=false; trilha; esperar status na 1a etapa E etapas_pl_recalculo_fila vazia para o modelo */ });

// invariante #9
it("fn_etapas_pl_entrada sem EXECUTE para authenticated/anon", async () => { /* has_function_privilege false */ });
```

- [ ] **Step 3: Rodar e ver FALHAR**

```bash
export DATABASE_URL="$(cat /tmp/dburl-local.txt)"
npx vitest run --no-file-parallelism tests/integration/etapas-pl-entrada-configuravel.test.ts
```
Esperado: FALHA (hoje a entrada é por peça teste fixo, ignora o requisito configurado da 1ª coluna; o caso "enviado_a_servicos" e "sem requisito" falham).

- [ ] **Step 4: Redefinir `fn_etapas_pl_entrada` no MESMO arquivo de migration**

Acrescentar à `20261128100000_etapas_pl_entrada_configuravel.sql` (depois do avaliador), com guard md5 do Step 1. Nova lógica (DEFINER, search_path, GUC em volta do UPDATE, RESTAURA):

```
v_cfg := _etapas_pl_cfg(tenant);
v_board := coalesce(v_cfg->'etapas_pl_kanban','[]');
-- board cru vazio/nao-array: nada a fazer (inercia; reference Onda 2 150000)
IF jsonb_typeof(v_board) <> 'array' OR jsonb_array_length(v_board)=0 THEN RETURN ...; END IF;
v_fluxo := _kanban_fluxo(jsonb_build_object('status_kanban', v_board), false);
v_primeira := NULLIF(btrim(v_fluxo[1]), '');
IF v_primeira IS NULL THEN RETURN ...; END IF;
v_reqs_primeira := _kanban_lista( (coalesce(v_cfg->'etapas_pl_requisitos','{}')) -> v_primeira );   -- requisitos da 1a coluna
v_cond := coalesce(avaliar_condicoes_etapas_pl_core(tenant, array[_modelo]) -> _modelo::text, '{}');
v_cumpre_entrada := (select bool_and(coalesce((v_cond->>k)::boolean,false)) from unnest(v_reqs_primeira) k);  -- todos os reqs da 1a => true; sem req => bool_and de conjunto vazio = NULL => tratar como FALSE (sem requisito, ninguem entra sozinho)
v_cumpre_entrada := coalesce(v_cumpre_entrada, false);
v_pos_explosao := EXISTS(select 1 from cad c where c.modelo_id=_modelo and coalesce(c.enviado_corte,false));

-- ENTRADA: status NULL E modulo etapas_pl E cumpre os requisitos da 1a coluna => entra na 1a etapa (GUC auto, enfileira)
-- SAIDA: status NOT NULL E NOT cumpre_entrada E NOT pos_explosao => NULL
```
Manter: GUC `app.etapas_pl_sistema='auto'` em volta do UPDATE + restaura; enfileira só na entrada (como hoje); `_tenant_modulo_ligado(tenant,'etapas_pl')`. Guard md5.

⚠️ Nota de design: a SAÍDA agora é "não cumpre mais o requisito da 1ª coluna" (antes era "não tem trilha"). Com a 1ª coluna = `tem_peca_teste`, é equivalente ao de hoje; com outra 1ª coluna, segue a regra dela. Se a 1ª coluna não tem requisito, `v_cumpre_entrada=false` ⇒ ninguém entra sozinho (só manual), e quem está no board pré-Explosão SAIRIA — **exceção:** se `status_etapa_pl` já está setado e a 1ª coluna não tem requisito (board todo-manual), NÃO forçar saída (senão um board manual se auto-esvaziaria). Então a SAÍDA só dispara quando a 1ª coluna TEM requisito e o produto deixou de cumpri-lo. Pinar no teste "1a coluna sem requisito não esvazia o board".

- [ ] **Step 5: Escrever o `_down`**

Gerar `supabase/rollback/20261128100000_etapas_pl_entrada_configuravel_down.sql` a partir dos corpos VIVOS (de antes da ida) de `_avaliar_condicoes_etapas_pl_core` e `fn_etapas_pl_entrada` (os dumps dos Steps 1), `BEGIN…COMMIT`, REVOKE dos 3, `pg_notify`. Padrão do `_down` da Onda 2.

```bash
export DATABASE_URL="$(cat /tmp/dburl-local.txt)"
{ echo "BEGIN;"; cat /tmp/claude-scratch-avaliador-vivo.sql; echo ";"; echo "REVOKE EXECUTE ON FUNCTION public._avaliar_condicoes_etapas_pl_core(uuid,uuid[]) FROM PUBLIC, anon, authenticated;"; cat /tmp/claude-scratch-entrada-viva.sql; echo ";"; echo "REVOKE EXECUTE ON FUNCTION public.fn_etapas_pl_entrada() FROM PUBLIC, anon, authenticated;"; echo "COMMIT;"; echo "select pg_notify('pgrst','reload schema');"; } > supabase/rollback/20261128100000_etapas_pl_entrada_configuravel_down.sql
```
(Capturar os dumps ANTES de aplicar a ida; se já aplicou, reconstruir do git/Onda 2.)

- [ ] **Step 6: Aplicar, rodar os testes, round-trip**

```bash
export DATABASE_URL="$(cat /tmp/dburl-local.txt)"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261128100000_etapas_pl_entrada_configuravel.sql
npx vitest run --no-file-parallelism tests/integration/etapas-pl-entrada-configuravel.test.ts tests/integration/kanban-pl-onda2-entrada.test.ts tests/integration/kanban-pl-condicoes.test.ts
# round-trip: down devolve md5 de antes, ida reaplica
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/rollback/20261128100000_etapas_pl_entrada_configuravel_down.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261128100000_etapas_pl_entrada_configuravel.sql
npx vitest run --no-file-parallelism tests/integration/etapas-pl-entrada-configuravel.test.ts
```
Esperado: PASS; a suíte de entrada da Onda 2 segue verde (compatível) ou é ajustada se a semântica mudou de propósito (documentar no commit).

- [ ] **Step 7: Commit**

```bash
git add supabase/rollback/20261128100000_etapas_pl_entrada_configuravel_down.sql tests/integration/etapas-pl-entrada-configuravel.test.ts
git commit --only supabase/migrations/20261128100000_etapas_pl_entrada_configuravel.sql supabase/rollback/20261128100000_etapas_pl_entrada_configuravel_down.sql tests/integration/etapas-pl-entrada-configuravel.test.ts -m "feat(etapas-pl): entrada vira requisito da 1a coluna

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Seed da 1ª coluna com requisito `tem_peca_teste`

**Files:**
- Modify: `supabase/migrations/20261128100000_etapas_pl_entrada_configuravel.sql` (MESMO arquivo — redefine `_kanban_pl_seed_etapas`)
- Modify: `supabase/rollback/20261128100000_etapas_pl_entrada_configuravel_down.sql` (add o corpo de antes do seed)
- Test: `tests/integration/etapas-pl-entrada-configuravel.test.ts` (add caso)

**Interfaces:**
- Consumes: `_kanban_pl_seed_etapas` (Onda 1).
- Produces: seed que, ao semear `etapas_pl_kanban`, grava também `etapas_pl_requisitos` da 1ª coluna com `["tem_peca_teste"]` (se `etapas_pl_requisitos` estava vazio).

- [ ] **Step 1: Ler o corpo vivo de `_kanban_pl_seed_etapas` e md5**

```bash
export DATABASE_URL="$(cat /tmp/dburl-local.txt)"
psql "$DATABASE_URL" -At -c "select md5(pg_get_functiondef('public._kanban_pl_seed_etapas(uuid)'::regprocedure));"
psql "$DATABASE_URL" -At -c "select pg_get_functiondef('public._kanban_pl_seed_etapas(uuid)'::regprocedure);" > /tmp/claude-scratch-seed-vivo.sql
```

- [ ] **Step 2: Teste do seed**

Add a `etapas-pl-entrada-configuravel.test.ts`:
```ts
it("seed: 1a coluna nasce com requisito tem_peca_teste quando etapas_pl_requisitos estava vazio", async () => {
  await withTx(async (c) => {
    const t = await semearTenantComPcpEtapas(c); // pcp_etapas default, etapas_pl_kanban/_requisitos vazios
    await semJwt(c, () => c.query(`select _kanban_pl_seed_etapas($1)`, [t]));
    const r = await um<{ k: any; rq: any }>(c, `select etapas_pl_kanban k, etapas_pl_requisitos rq from tenant_config where tenant_id=$1`, [t]);
    const primeira = _kanbanNorm(r.k[0]); // key da 1a
    expect(r.rq[primeira]).toEqual(["tem_peca_teste"]);
  });
});
it("seed: NAO sobrescreve etapas_pl_requisitos ja configurado", async () => { /* semear com requisitos nao-vazios; seed nao muda */ });
```

- [ ] **Step 3: Rodar e ver FALHAR**

```bash
export DATABASE_URL="$(cat /tmp/dburl-local.txt)"
npx vitest run --no-file-parallelism tests/integration/etapas-pl-entrada-configuravel.test.ts -t "seed"
```
Esperado: FALHA (o seed hoje só grava `etapas_pl_kanban`, não os requisitos).

- [ ] **Step 4: Redefinir `_kanban_pl_seed_etapas`**

No MESMO arquivo de migration, redefinir o seed (copiar o corpo vivo + guard md5) para, APÓS gravar `etapas_pl_kanban`, gravar `etapas_pl_requisitos` da 1ª coluna com `["tem_peca_teste"]` SÓ quando `etapas_pl_requisitos` estava vazio (`'{}'`/NULL). Usar `_kanban_norm` do primeiro label para a key. Idempotente (reaplicar não muda).

```sql
-- apos o UPDATE de etapas_pl_kanban: semear o requisito de entrada da 1a coluna se nunca configurado
UPDATE public.tenant_config tc
   SET etapas_pl_requisitos = jsonb_build_object(public._kanban_norm((public._kanban_lista(tc.etapas_pl_kanban))[1]), jsonb_build_array('tem_peca_teste'))
 WHERE tc.tenant_id = _tenant
   AND coalesce(tc.etapas_pl_requisitos, '{}'::jsonb) = '{}'::jsonb
   AND public._kanban_norm((public._kanban_lista(tc.etapas_pl_kanban))[1]) IS NOT NULL
   AND btrim(public._kanban_norm((public._kanban_lista(tc.etapas_pl_kanban))[1])) <> '';
```

- [ ] **Step 5: Add o corpo de antes do seed ao `_down`** (de `/tmp/claude-scratch-seed-vivo.sql`).

- [ ] **Step 6: Aplicar + testes + round-trip**

```bash
export DATABASE_URL="$(cat /tmp/dburl-local.txt)"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261128100000_etapas_pl_entrada_configuravel.sql
npx vitest run --no-file-parallelism tests/integration/etapas-pl-entrada-configuravel.test.ts tests/integration/kanban-pl-onda1.test.ts
```
Esperado: PASS. (A Onda 1 testa o seed — conferir que segue verde ou ajustar a asserção de propósito.)

- [ ] **Step 7: Commit**

```bash
git commit --only supabase/migrations/20261128100000_etapas_pl_entrada_configuravel.sql supabase/rollback/20261128100000_etapas_pl_entrada_configuravel_down.sql tests/integration/etapas-pl-entrada-configuravel.test.ts -m "feat(etapas-pl): seed da 1a coluna com requisito de entrada tem_peca_teste

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Lib pura `etapas-pl-config.ts` + anti-drift com o SQL

**Files:**
- Create: `src/lib/etapas-pl-config.ts`
- Create: `tests/fixtures/etapas-pl-casos.ts`
- Create: `tests/integration/etapas-pl-derivacao-antidrift.test.ts`
- Reference (ler, espelhar): `src/lib/kanban-auto.ts`, `src/lib/kanban-status.ts`, `src/lib/kanban-auto-config.ts`

**Interfaces:**
- Consumes: as puras compartilhadas já exportadas (`normalizeKanbanStatuses`, `resolveStatusKey`), o catálogo `CONDICOES_PL`/`CONDICAO_PL_BY_KEY`/`requisitosOkPL` (Task 1).
- Produces (nomes EXATOS que as Tasks 5-9 consomem):
  - `type EtapasPlConfig = { board: string[]; requisitos: Record<string,string[]>; automatico: boolean }`
  - `lerEtapasPlConfig(row: any): EtapasPlConfig`
  - `boardEtapasPl(cfg): {key:string;label:string}[]` (via `normalizeKanbanStatuses(cfg.board)`)
  - `fluxoEtapasPl(cfg): string[]` (keys na ordem)
  - `reqsDaColuna(cfg, key): string[]`
  - `colunaManualPl(cfg, key): boolean` (sem requisito = manual)
  - `type DerivacaoPl = { derivavel: boolean; alvo: string|null; resultado: string|null; fixado: boolean; faltando: string[] }`
  - `derivarEtapaPl(cfg, statusAtual: string|null, satisfeitas: Record<string,boolean>): DerivacaoPl` (espelho de `statusDerivado`/`_kanban_derivar_puro` — caminha o fluxo, para na 1ª que falha)
  - `type DestinoDropPl = { acao:"fixar"|"soltar"|"entra"|"bloqueado"|"nada"; status:string|null; faltando:string[] }`
  - `destinoDropPl(cfg, statusAtual, para, satisfeitas): DestinoDropPl` (espelho de `destinoDrop`/`_kanban_destino_drop_puro`)
  - `faltandoParaPl(cfg, key, satisfeitas): string[]`

- [ ] **Step 1: Ler `kanban-auto.ts` inteiro** para copiar a lógica de `statusDerivado`/`destinoDrop` adaptando ao PL (sem revenda/comprado, sem `exc`). Confirmar que as puras do SQL PL reusam `_kanban_derivar_puro`/`_kanban_destino_drop_puro` — a lib TS espelha ESSAS.

- [ ] **Step 2: Escrever as fixtures compartilhadas**

`tests/fixtures/etapas-pl-casos.ts`: array de casos `{ board, requisitos, status, satisfeitas, esperado: {derivavel, alvo, resultado, fixado, faltando} }` cobrindo: fluxo todo automático (avança até a 1ª falha), coluna manual (fixado), status órfão (cai na 1ª), board vazio, 1ª coluna sem requisito. ~12 casos. Exportar `CASOS_DERIVACAO_PL`.

- [ ] **Step 3: Escrever o anti-drift (integração: roda TS e SQL nas MESMAS fixtures)**

`tests/integration/etapas-pl-derivacao-antidrift.test.ts`: para cada caso, comparar `derivarEtapaPl(cfg, status, satisfeitas)` (TS) com o resultado de `_etapas_pl_derivar_lote`/`_kanban_derivar_puro` no SQL (montando o cfg e as condições). Modelo: `tests/integration/kanban-auto.test.ts`.

- [ ] **Step 4: Rodar e ver FALHAR** (lib não existe).

```bash
export DATABASE_URL="$(cat /tmp/dburl-local.txt)"
npx vitest run --no-file-parallelism tests/integration/etapas-pl-derivacao-antidrift.test.ts
```

- [ ] **Step 5: Implementar `etapas-pl-config.ts`** com as assinaturas acima, espelhando `kanban-auto.ts`.

- [ ] **Step 6: Rodar até PASS + tsc**

```bash
export DATABASE_URL="$(cat /tmp/dburl-local.txt)"
npx vitest run --no-file-parallelism tests/integration/etapas-pl-derivacao-antidrift.test.ts
npx tsc --noEmit 2>&1 | grep -E "etapas-pl-config" || echo "tsc ok"
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/etapas-pl-config.ts tests/fixtures/etapas-pl-casos.ts tests/integration/etapas-pl-derivacao-antidrift.test.ts
git commit --only src/lib/etapas-pl-config.ts tests/fixtures/etapas-pl-casos.ts tests/integration/etapas-pl-derivacao-antidrift.test.ts -m "feat(etapas-pl): lib pura de derivacao + anti-drift com o SQL

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Lib `etapas-pl-ui.ts` + `etapas-pl-rpc.ts` + hook `useEtapasPlConfig`

**Files:**
- Create: `src/lib/etapas-pl-ui.ts`, `src/lib/etapas-pl-rpc.ts`, `src/hooks/useEtapasPlConfig.ts`
- Test: `tests/unit/etapas-pl-ui.test.ts`
- Reference: `src/lib/kanban-auto-ui.ts`, `src/lib/kanban-auto-rpc.ts`, `src/hooks/useKanbanConfig.ts`

**Interfaces:**
- Consumes: `EtapasPlConfig`, `derivarEtapaPl`, `colunaManualPl` (Task 4); `CONDICAO_PL_BY_KEY` (Task 1).
- Produces:
  - `etapas-pl-ui.ts`: `modoColunaPl(cfg,key): "automatica"|"manual"`; `subtituloColunaPl(cfg,key): string`; `dropBloqueadoPl(d: DestinoDropPl): boolean`; `textoFaixaDropPl(d): string`; `notaMoverPlPara(d): string`; `toastDoMoverPl(r: ResultadoMoverPl, ...): {titulo:string;tipo:"ok"|"erro"|"info"}`; `type EtapaSeloPl={key:string;label:string;color:string;modo:"off"|"automatica"|"fixado"}`; `etapaDoProduto(cfg, statusAtual, satisfeitas, ligado): EtapaSeloPl`; `etapaPlFiltroOpts(cfg): {id:string;label:string}[]`; `motorEtapasPlDisponivel(cfg): boolean`; `RPC_ETAPAS_PL = {mover:"etapas_pl_mover", definir:"etapas_pl_definir_automatico", previaRestauracao:"etapas_pl_previa_restauracao", restaurar:"etapas_pl_restaurar"}`; `type ResultadoMoverPl = { acao:string; status:string|null; faltando:string[]; rev:number }`.
  - `etapas-pl-rpc.ts`: `etapasPlMover(modeloId:string, para:string): Promise<ResultadoMoverPl>` (`supabase.rpc("etapas_pl_mover",{_modelo_id,_para})`); `etapasPlDefinirAutomatico(ligar:boolean): Promise<{ligado:boolean;mudou:boolean;lote_id:string|null;snapshot:number;cards_movidos:number}>`; `etapasPlPreviaRestauracao(loteId:string): Promise<{lote_id:string|null;chave_ligada:boolean;total:number;voltam:number;movidos_depois:number;lotes_superados:number;cards:any[];avisos:string[]}>`; `etapasPlRestaurar(loteId:string): Promise<{lote_id:string;restaurados:number;historico_apagado:number;lotes_superados:number}>`.
  - `useEtapasPlConfig.ts`: `useEtapasPlConfig(): {cfg:EtapasPlConfig; ligado:boolean; motorDisponivel:boolean; carregando:boolean; isError:boolean}` — `useQuery(["tenant-etapas-pl", tenantId])` select "*" em `tenant_config`.

- [ ] **Step 1: Ler as 3 fontes do Dev** (`kanban-auto-ui.ts`, `kanban-auto-rpc.ts`, `useKanbanConfig.ts`) e espelhar, trocando as RPCs e o catálogo.

- [ ] **Step 2: Teste unit de `etapas-pl-ui.ts`**

`tests/unit/etapas-pl-ui.test.ts`: `modoColunaPl` (com/sem requisito), `etapaDoProduto` (off/automatica/fixado/lançado), `etapaPlFiltroOpts` (colunas + Finalizado), `toastDoMoverPl` (por ação). Dados sintéticos; sem banco.

- [ ] **Step 3: Rodar e ver FALHAR.**

```bash
npx vitest run tests/unit/etapas-pl-ui.test.ts
```

- [ ] **Step 4: Implementar os 3 arquivos.**

- [ ] **Step 5: Rodar até PASS + tsc.**

```bash
npx vitest run tests/unit/etapas-pl-ui.test.ts
npx tsc --noEmit 2>&1 | grep -E "etapas-pl-(ui|rpc)|useEtapasPlConfig" || echo "tsc ok"
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/etapas-pl-ui.ts src/lib/etapas-pl-rpc.ts src/hooks/useEtapasPlConfig.ts tests/unit/etapas-pl-ui.test.ts
git commit --only src/lib/etapas-pl-ui.ts src/lib/etapas-pl-rpc.ts src/hooks/useEtapasPlConfig.ts tests/unit/etapas-pl-ui.test.ts -m "feat(etapas-pl): libs de UI/RPC + hook de config

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Colaboração — `etapas_pl_*` em `config-loja-colab.ts`

**Files:**
- Modify: `src/lib/config-loja-colab.ts` (`BLOCO_DA_COLUNA`, `BLOCO_DO_FOCO`; as colunas já estão em `COLUNAS_PAGINA` e no tipo pela Onda 1)
- Test: `tests/unit/config-loja-colab.test.ts` (se existir; senão asserção inline no teste da Task 7)

**Interfaces:**
- Produces: as 4 colunas `etapas_pl_*` mapeadas a um bloco colaborativo `cfg:etapas_pl` (anel de presença/conflito por bloco).

- [ ] **Step 1: Ler `config-loja-colab.ts`** (`BLOCO_DA_COLUNA` mapeia coluna→bloco; `BLOCO_DO_FOCO` o inverso/foco). Ver como `status_kanban`/`kanban_requisitos` estão mapeados.

- [ ] **Step 2: Mapear as 4 colunas** `etapas_pl_kanban`, `etapas_pl_requisitos`, `etapas_pl_automatico`, `etapas_pl_aba_peca_teste_status` ao bloco `etapasPl` (ou `cfg:etapas_pl`), seguindo o padrão das do kanban do Dev.

- [ ] **Step 3: tsc + teste** (se houver teste de colab, rodar; senão validado na Task 7).

```bash
npx tsc --noEmit 2>&1 | grep -E "config-loja-colab" || echo "tsc ok"
```

- [ ] **Step 4: Commit**

```bash
git commit --only src/lib/config-loja-colab.ts -m "feat(etapas-pl): colunas etapas_pl no mapa colaborativo da Config

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Config da Loja — card "Etapas PL" (colunas + requisitos + chave)

**Files:**
- Create: `src/components/admin/EtapasPlConfigCard.tsx`
- Modify: `src/routes/_authenticated/admin/configuracoes.tsx` (substituir o `EtapasPLCard` antigo pelo novo; `DEFAULTS`/normalizador se preciso)
- Reference (reusar): `src/components/admin/{RequisitosStatusDialog,KanbanAutomaticoDialog,ModoColunaBadge}.tsx`, `SortableListCard` (em `configuracoes.tsx:2088`)

**Interfaces:**
- Consumes: `EtapasPlConfig`, `CONDICOES_PL`, `etapas-pl-rpc.ts`, `useEtapasPlConfig`; `SortableListCard`, `RequisitosStatusButton`, `KanbanAutomaticoBloco`.
- Produces: `<EtapasPlConfigCard tenantId cfg setCfg anelConflito ... />` renderizado no bloco `etapasPl` da Config.

- [ ] **Step 1: Ler o card "Status do Kanban"** em `configuracoes.tsx` (`:1236-1301`): como monta `SortableListCard` + `renderItemExtra` (requisitos + modo) + `topo` (`KanbanAutomaticoBloco`). Esse é o template.

- [ ] **Step 2: Criar `EtapasPlConfigCard.tsx`** reaproveitando:
  - `SortableListCard` com `cfg.etapas_pl_kanban` (labels), `data-colab-path="cfg:etapas_pl_kanban"`.
  - `renderItemExtra`: `RequisitosStatusButton` com catálogo PL (`CONDICOES_PL`), gravando em `cfg.etapas_pl_requisitos[key]`; `ModoColunaBadge`/selo automática vs manual. A 1ª coluna ganha rótulo "porta de entrada".
  - `topo`: `KanbanAutomaticoBloco` adaptado às RPCs PL (`etapasPlDefinirAutomatico`/`etapasPlPreviaRestauracao`/`etapasPlRestaurar`) e à prévia de ligar (do retorno de `etapas_pl_definir_automatico`). Aviso de board vazio (ligar recusado).
  - Grava via `salvar_config_loja` (fluxo da página já existe); `etapas_pl_automatico` só pela RPC.
  - Se `KanbanAutomaticoBloco`/`KanbanChaveDialog` estiverem acoplados às RPCs do Dev, extrair as RPCs para props (contrato) em vez de duplicar o componente — fazer o refactor mínimo necessário e mantê-lo funcionando para o Dev.

- [ ] **Step 3: Montar no `configuracoes.tsx`** no lugar do `EtapasPLCard` (`:1464-1471`), mesma visibilidade (`blocos.etapasPl`). Remover/aposentar o `EtapasPLCard` antigo (renomear etapas de `pcp_etapas`) — ou mantê-lo numa aba separada se ainda usado por outra coisa (checar; provavelmente substituível).

- [ ] **Step 4: Build + tsc + teste de render** (se viável)

```bash
npm run build 2>&1 | tail -3
npx tsc --noEmit 2>&1 | grep -E "EtapasPlConfigCard|configuracoes" || echo "tsc ok"
```
Teste de render leve em `tests/unit/etapas-pl-config-card.test.ts`: renderiza o card com um cfg sintético, confere que lista as colunas e abre o dialog de requisitos com as condições PL.

- [ ] **Step 5: Commit**

```bash
git add src/components/admin/EtapasPlConfigCard.tsx tests/unit/etapas-pl-config-card.test.ts
git commit --only src/components/admin/EtapasPlConfigCard.tsx src/routes/_authenticated/admin/configuracoes.tsx tests/unit/etapas-pl-config-card.test.ts -m "feat(etapas-pl): Config da Loja - colunas + requisitos + chave

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Board — componentes `EtapasPlKanban` + `EtapaPlCard` (arraste + mover + Sheet)

**Files:**
- Create: `src/components/producao/etapas/EtapasPlKanban.tsx`, `src/components/producao/etapas/EtapaPlCard.tsx`
- Reference: `src/routes/_authenticated/criacao.desenvolvimento.tsx` (arraste HTML5, colunas, "Mover para…"), `src/components/producao/etapas/{EtapasBoard,EtapaCardView}.tsx` (o atual), `src/components/shared/{EtapaKanbanBadge,ServicoAtrasoBadge}.tsx`, `ModeloResumoFoto`
- Test: `tests/unit/etapas-pl-card.test.ts`

**Interfaces:**
- Consumes: `etapas-pl-config.ts`, `etapas-pl-ui.ts`, `etapas-pl-rpc.ts`, `useEtapasPlConfig`.
- Produces: `<EtapasPlKanban produtos cfg ligado onAbrirSheet onMover ... />` (board), `<EtapaPlCard produto selo atraso onClick draggable ... />`.

- [ ] **Step 1: Ler o board do Dev** (`criacao.desenvolvimento.tsx`) — copiar o padrão de arraste HTML5 (`draggable`, `onDragStart` seta `dataTransfer`, coluna `onDrop`), o feedback de drop (válido/bloqueado com "Faltam X"), o "Mover para…" mobile (Select), a coluna terminal. Adaptar: 1 card por produto; chama `etapasPlMover`; com a chave off = mover direto (decisão da pessoa).

- [ ] **Step 2: `EtapaPlCard.tsx`** (desktop + mobile): foto (`ModeloResumoFoto`), nome+REF, selo da etapa (`EtapaKanbanBadge` com `etapaDoProduto`), `ServicoAtrasoBadge`. `onClick` → abre o Sheet (handler no board/rota). Sem campos editáveis.

- [ ] **Step 3: `EtapasPlKanban.tsx`**: colunas de `fluxoEtapasPl`/`boardEtapasPl`, 1ª e última sempre visíveis, terminal "Finalizado" (`lancado`), `byStatus` (status órfão → 1ª coluna), arraste com `destinoDropPl`, toasts com `toastDoMoverPl`. Mobile como o Dev.

- [ ] **Step 4: Teste unit do card + da distribuição por coluna**

`tests/unit/etapas-pl-card.test.ts`: `byStatus`/distribuição (status órfão cai na 1ª; lançado na terminal); `destinoDropPl` integrado ao clique de mover (mock). Render do card com selo.

- [ ] **Step 5: Build + tsc + unit**

```bash
npm run build 2>&1 | tail -3
npx vitest run tests/unit/etapas-pl-card.test.ts
npx tsc --noEmit 2>&1 | grep -E "EtapasPlKanban|EtapaPlCard" || echo "tsc ok"
```

- [ ] **Step 6: Commit**

```bash
git add src/components/producao/etapas/EtapasPlKanban.tsx src/components/producao/etapas/EtapaPlCard.tsx tests/unit/etapas-pl-card.test.ts
git commit --only src/components/producao/etapas/EtapasPlKanban.tsx src/components/producao/etapas/EtapaPlCard.tsx tests/unit/etapas-pl-card.test.ts -m "feat(etapas-pl): board (kanban + card) com arraste e selo

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: Rota `/pcp/etapas` — monta o board, filtros, abre o Sheet de Serviços

**Files:**
- Modify (reescrever): `src/routes/_authenticated/pcp.etapas.tsx`
- Reference: o `pcp.etapas.tsx` atual (filtros, busca, guarda de permissão, Sheets), `TerceirizadosDetail`
- Test: QA Playwright (manual, Task 10); unit do que for extraível

**Interfaces:**
- Consumes: `EtapasPlKanban`, `useEtapasPlConfig`, `etapas-pl-rpc.ts`; `TerceirizadosDetail` (Sheet reaproveitado), `RequirePermission page="producao_etapas"`.
- Produces: a tela `/pcp/etapas` nova.

- [ ] **Step 1: Ler o `pcp.etapas.tsx` atual** — manter: guarda de permissão, header, busca, filtros (Coleção/Fornecedor/Origem) `FilterButton screen="pcp-etapas"`, recolher colunas/cards, aviso "Tentar de novo". Trocar: a query de cards e o board.

- [ ] **Step 2: Query dos produtos do board**: `modelos` com `status_etapa_pl IS NOT NULL` (via `.not("status_etapa_pl","is",null)`) + embeds (foto, coleção via `colecoes(nome)`, atraso de serviço via `cad(producao_terceirizados(...))`), paginando com `buscarTodas` (como o atual). queryKey `["etapas-pl-cards", tenantId, filtros]`.

- [ ] **Step 3: Filtro de etapa** (`etapaPlFiltroOpts`) multi-select junto dos demais; `useFilterState`.

- [ ] **Step 4: Abrir o Sheet de Serviços**: ao clicar no card, abrir `TerceirizadosDetail` (mesmo Sheet do `pcp.servicos.$modeloId` / o que a tela atual já abre no card de bloco), com `UnsavedChangesGuard`. Ao fechar/salvar, invalidar `["etapas-pl-cards"]`.

- [ ] **Step 5: Mover**: handler `onMover` chama `etapasPlMover`; toasts; invalida a query. Chave off = mover direto.

- [ ] **Step 6: Build + tsc**

```bash
npm run build 2>&1 | tail -3
npx tsc --noEmit 2>&1 | grep -E "pcp.etapas" || echo "tsc ok"
```

- [ ] **Step 7: Commit**

```bash
git commit --only src/routes/_authenticated/pcp.etapas.tsx -m "feat(etapas-pl): rota /pcp/etapas - board novo + filtros + Sheet de Servicos

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10: QA integrado + prévia

**Files:** nenhum de produção (validação).

- [ ] **Step 1: Suíte completa na cópia local**

```bash
export DATABASE_URL="$(cat /tmp/dburl-local.txt)"
npx vitest run --no-file-parallelism tests/integration/etapas-pl-entrada-configuravel.test.ts tests/integration/etapas-pl-derivacao-antidrift.test.ts tests/integration/kanban-pl-onda1.test.ts tests/integration/kanban-pl-onda2-*.test.ts tests/integration/kanban-pl-condicoes.test.ts tests/integration/mod-antidrift.test.ts
npx vitest run tests/unit/etapas-pl-*.test.ts
npm run build && npx tsc --noEmit 2>&1 | grep -E "TS2304|TS2345" || echo "tsc ok"
```

- [ ] **Step 2: QA Playwright** (NÃO seedar o banco; `E2E_BASE_URL=http://localhost:5173`): numa loja de teste, configurar colunas + requisitos, ligar a chave (prévia aparece), ver cards entrarem, arrastar (bloqueado com "Faltam X" e permitido), "Mover para…" mobile, abrir o Sheet de Serviços e salvar, desligar a chave (restaurar). Reusar o vite local do dono (não matar; se subir, porta 5199, matar só o próprio PID).

- [ ] **Step 3: Prévia (localhost:5190)** — avisar o dono para conferir a entrega na cópia local antes do deploy. "prévia aprovada" = portão.

- [ ] **Step 4: Preparar o roteiro de deploy no painel** (banco ANTES do site; a migration A acumulada com Ondas 1+2 se ainda não foram; Passo 0 = rodar o reavaliador de entrada em lote antes de ligar a chave numa loja). NÃO rodar o deploy (é do dono).

---

## Self-Review

**1. Spec coverage:** A (motor) → Tasks 1-3; B (libs) → Tasks 4-5; C (Config) → Tasks 6-7; D (board) → Tasks 8-9; E (selo/filtro) → Tasks 8-9 (selo no card, filtro na rota); QA/deploy → Task 10. Todas as seções da spec têm task. ✓

**2. Placeholder scan:** Cada step de código tem o código real ou o comando exato. Os corpos SQL grandes (avaliador, entrada, seed) são redefinições de funções vivas — o plano manda copiar o corpo vivo (dump) e inserir o delta mostrado, o que é concreto (não "implemente a função"). Os componentes de front dizem exatamente qual reusar e o que passar por prop. ✓

**3. Type consistency:** `EtapasPlConfig`, `DerivacaoPl`, `DestinoDropPl`, `ResultadoMoverPl`, `EtapaSeloPl` definidos na Task 4/5 e consumidos com os mesmos nomes nas Tasks 7-9. RPCs com os retornos EXATOS do banco (conferidos: `etapas_pl_mover→{acao,status,faltando,rev}`, `definir→{ligado,mudou,lote_id,snapshot,cards_movidos}`, etc.). ✓

**4. Review Focus:** `tem_peca_teste` vs `peca_teste_aprovada` → Task 1 teste; entrada via 1ª coluna / board sem requisito → Task 2 testes; saída pré/pós-Explosão → Task 2; chave off não deriva → Task 2 + Task 8; card órfão → Task 4 + Task 8. Todos cobertos. ✓

**Decisões travadas (as 3 finas da spec):** A2-i (reusar o gatilho, predicado da 1ª coluna) — Task 2. Seed da 1ª coluna com `["tem_peca_teste"]` — Task 3. Saída mantém a regra, com a exceção "board todo-manual não auto-esvazia" — Task 2 Step 4.
