# Kanban PL configurável — Onda 2 (motor) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps usam checkbox (`- [ ]`).

**Goal:** Duplicar a camada SQL do motor do kanban automático do Desenvolvimento para um "board PL" próprio (fila + processador no COMMIT + aplicador/derivação + mover + guard + chave automático + snapshot), mais o gatilho de ENTRADA/SAÍDA do card no PL pela peça teste. Ainda SEM front (a tela do PL continua a de hoje); com a chave `etapas_pl_automatico` desligada, nada se move.

**Architecture:** Espelha fielmente o motor do Dev (migrations `20260930{12,13,14,15}0000_kanban_auto_*` + patches `20261027100000`/`20261027140000`), trocando `status_desenvolvimento`→`status_etapa_pl`, `kanban_requisitos`→`etapas_pl_requisitos`, `kanban_automatico`→`etapas_pl_automatico`, `status_kanban`→`etapas_pl_kanban`, `_avaliar_condicoes_kanban_core`→`_avaliar_condicoes_etapas_pl_core` (Onda 1), `modelo_kanban_historico`→`modelo_etapa_pl_historico` (Onda 1). As funções PURAS de derivação (`_kanban_derivar_puro`/`_kanban_destino_drop_puro`/helpers) são GENÉRICAS (recebem fluxo/reqs/cond como jsonb) e são **reusadas tal qual** — não se duplica a lógica de derivação, só a camada de orquestração acoplada à coluna de status.

**Tech Stack:** Postgres 17 (migrations + CONSTRAINT TRIGGER DEFERRABLE + GUCs transação-locais).

**Spec:** `docs/superpowers/specs/2026-11-12-kanban-pl-configuravel-design.md` (Onda 2 = motor).

## Global Constraints

- **Branch ATIVA:** `feature/plan-tecido-a1`. Onda 2 = SÓ BANCO; sem front. `etapas_pl_automatico` default false ⇒ nada se move até a Onda 3 ligar numa loja.
- **Reusar as PURAS do Dev:** `_kanban_derivar_puro`, `_kanban_destino_drop_puro`, `_kanban_norm`, `_kanban_lista`, `_kanban_coluna_manual`, `_kanban_req_efetivos`, `_kanban_fluxo`, `_kanban_faltando_para` (`20260930130000`) são IMMUTABLE e parametrizadas — o PL as chama passando os jsonbs de `_etapas_pl_cfg`. NÃO duplicar.
- **Nomes PL próprios** (evitar colisão): `_etapas_pl_cfg`, `_etapas_pl_ligado`, `_etapas_pl_derivar_lote`, `_etapas_pl_aplicar`, `_etapas_pl_enfileirar`/`_tenant`, `etapas_pl_recalculo_fila`, `fn_etapas_pl_processar_fila`/`trg_etapas_pl_processar_fila`, `fn_etapas_pl_fila_*`, `fn_etapas_pl_status_guard`/`trg_etapas_pl_status_guard`, `fn_etapas_pl_historico`/`trg_etapas_pl_historico`, `etapas_pl_mover`, `etapas_pl_definir_automatico`, `fn_etapas_pl_chave_protegida`/`trg_etapas_pl_chave_protegida` (⚠️ NÃO reusar o nome `fn_kanban_chave_protegida` — já há DUAS, a do kanban e a do MOD-1), `etapas_pl_snapshot`, `fn_etapas_pl_config`/`trg_etapas_pl_config`, `etapas_pl_previa_restauracao`/`etapas_pl_restaurar`. GUCs PL: `app.etapas_pl_sistema`, `app.etapas_pl_lote`, `app.etapas_pl_chave`, `app.etapas_pl_fila_feita`.
- **DEFINER + REVOKE dos 3** nas internas; RPCs públicas REVOKE PUBLIC/anon + GRANT authenticated; `SET search_path TO 'public'`; RAISE 5xx só ASCII; GUC sempre restaurada ao valor anterior.
- **CONSTRAINT TRIGGER processa no COMMIT; erro vira WARNING, nunca derruba o COMMIT.** Guarda de recursão: toda enfileiradora sai se `app.etapas_pl_sistema <> ''`; o aplicador seta essa GUC em volta.
- **Migrations aditivas idempotentes**, md5 ANTES/DEPOIS das redefinidas, pós-condição ACL/md5 (padrão de `20261027100000`). Rollback `_down` (neutraliza/DROP) + `_down_drop` separado onde há trigger que trava auth/storage.
- **Testes DDL só na CÓPIA LOCAL** (`/tmp/dburl-local.txt`, 54422), txn revertida; subagente usa `DATABASE_URL` LOCAL SEMPRE; NUNCA DDL em produção; NUNCA `\i` migration em txn de teste; teste de CONSTRAINT TRIGGER adiado exige `SET CONSTRAINTS ALL IMMEDIATE` dentro da txn revertida (senão não dispara).
- **Entrada/saída pela peça teste** (decisões 2, 5): card entra na 1ª etapa do `etapas_pl_kanban` ao ganhar trilha de peça teste (≥1 `modelo_servico_mo` com tipo `exige_peca_teste`); sai (→ NULL) quando perde a última trilha E está pré-Explosão (nenhum `cad.enviado_corte`). Pós-Explosão não sai (decisão 12).

## Review Focus

- **Recursão do motor:** o aplicador grava `status_etapa_pl` → NÃO pode re-enfileirar/re-disparar (loop). Pinado no teste da Task 5 (aplicar não gera fila nova; GUC `etapas_pl_sistema` guarda).
- **CONSTRAINT TRIGGER não derruba o COMMIT:** erro na derivação vira WARNING; o save do usuário conclui. Pinado no teste da Task 4 (forçar erro → COMMIT sobrevive, fila preservada).
- **Chave desligada = inércia total:** com `etapas_pl_automatico=false`, nenhum enfileirador insere, o guard sai cedo, `status_etapa_pl` não muda. Pinado no teste da Task 6 (guard) e Task 3 (fila vazia com chave off).
- **Entrada duplicada / saída indevida:** card que já tem `status_etapa_pl` não é "re-entrado"; card pós-Explosão não sai ao perder peça teste. Pinado no teste da Task 7.
- **Colisão de nome `fn_kanban_chave_protegida`:** a trava PL tem nome próprio e protege só `etapas_pl_automatico`, sem afetar a trava de `modules`/`kanban_automatico`. Pinado no teste da Task 8 (gravar modules/kanban_automatico direto não é afetado; etapas_pl_automatico só muda pela RPC PL).

---

## File Structure

Uma migration por sub-bloco coeso (cada uma testável e revisável à parte), todas `20261127*`:
- **`20261127100000_etapas_pl_cfg.sql`** — `_etapas_pl_cfg` + `_etapas_pl_ligado` + `_etapas_pl_derivar_lote` (reusa as puras do Dev) (Task 1).
- **`20261127110000_etapas_pl_fila.sql`** — tabela `etapas_pl_recalculo_fila` + `_etapas_pl_enfileirar`/`_tenant` + gatilhos-fonte (Task 2) + CONSTRAINT TRIGGER + `fn_etapas_pl_processar_fila` (Task 3) + `_etapas_pl_aplicar` + `fn_etapas_pl_historico`/trigger (Task 4/5).
- **`20261127120000_etapas_pl_guard_mover.sql`** — `fn_etapas_pl_status_guard`/trigger (Task 6) + `etapas_pl_mover` (RPC) (Task 6).
- **`20261127130000_etapas_pl_chave.sql`** — `fn_etapas_pl_chave_protegida`/trigger + `etapas_pl_definir_automatico` + snapshot (`etapas_pl_snapshot` + `fn_etapas_pl_config`/trigger + `etapas_pl_previa_restauracao`/`etapas_pl_restaurar`) (Task 8).
- **`20261127140000_etapas_pl_entrada.sql`** — gatilho de ENTRADA/SAÍDA pela peça teste (Task 7).
- Rollbacks `_down`/`_down_drop` por migration em `supabase/rollback/`.
- Testes em `tests/integration/kanban-pl-onda2-*.test.ts` por sub-bloco.

> Nota de ordem: as Tasks compartilham arquivos de migration por sub-bloco; executar SEQUENCIAL (nunca 2 subagentes no mesmo .sql). Ordem: Task 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8.

---

## Task 1: `_etapas_pl_cfg` + `_etapas_pl_ligado` + `_etapas_pl_derivar_lote`

**Files:** Create `supabase/migrations/20261127100000_etapas_pl_cfg.sql` + `supabase/rollback/20261127100000_etapas_pl_cfg_down.sql` + `tests/integration/kanban-pl-onda2-cfg.test.ts`.

**Interfaces:**
- Consumes: as puras do Dev (`_kanban_fluxo`, `_kanban_derivar_puro`, `_kanban_coluna_manual`, `_kanban_req_efetivos`, `_kanban_lista`, `_kanban_norm`) de `20260930130000`; `_avaliar_condicoes_etapas_pl_core(_tenant,_ids)` (Onda 1); configs `etapas_pl_*` (Onda 1).
- Produces: `_etapas_pl_cfg(_tenant uuid) RETURNS jsonb` (chaves: `etapas_pl_automatico` bool, `etapas_pl_kanban` board, `etapas_pl_requisitos`; o PL NÃO tem revenda/exceções separados — board único, requisitos por etapa); `_etapas_pl_ligado(_tenant uuid) RETURNS boolean` (lê `etapas_pl_automatico`); `_etapas_pl_derivar_lote(_tenant uuid, _ids uuid[], _cfg jsonb DEFAULT NULL) RETURNS TABLE(...)` (espelho de `_kanban_derivar_lote` mas usando `status_etapa_pl`, `_avaliar_condicoes_etapas_pl_core`, fluxo = `_kanban_fluxo(cfg_pl)` com o board PL; elegível = tem `status_etapa_pl IS NOT NULL` — está no PL). Todas DEFINER + REVOKE dos 3.

- [ ] **Step 1: Teste — `_etapas_pl_cfg` devolve as chaves PL; `_etapas_pl_ligado` lê a chave**

```ts
// tests/integration/kanban-pl-onda2-cfg.test.ts (helpers reais da suíte; ver db.ts)
describe("Kanban PL Onda 2 — cfg/derivar", () => {
  it("_etapas_pl_cfg traz etapas_pl_automatico/kanban/requisitos", async () => {
    await withTx(async (c) => {
      await c.query(`update tenant_config set etapas_pl_automatico=true, etapas_pl_kanban='["Peça Teste","Oficina"]'::jsonb, etapas_pl_requisitos='{"oficina":["peca_teste_aprovada"]}'::jsonb where tenant_id=$1`, [T]);
      const r = (await um<{ cfg: any }>(c, `select _etapas_pl_cfg($1) cfg`, [T])).cfg;
      expect(r.etapas_pl_automatico).toBe(true);
      expect(r.etapas_pl_kanban).toEqual(["Peça Teste","Oficina"]);
    });
  });
  it("_etapas_pl_ligado = etapas_pl_automatico", async () => {
    await withTx(async (c) => {
      await c.query(`update tenant_config set etapas_pl_automatico=false where tenant_id=$1`, [T]);
      expect((await um<{ l: boolean }>(c, `select _etapas_pl_ligado($1) l`, [T])).l).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — `DATABASE_URL="$(cat /tmp/dburl-local.txt)" npx vitest run tests/integration/kanban-pl-onda2-cfg.test.ts --no-file-parallelism` → FAIL.

- [ ] **Step 3: Migration** — gere `_etapas_pl_cfg`/`_etapas_pl_ligado` espelhando `_kanban_cfg`/`_kanban_ligado` (`20260930130000:359,379`) com as colunas PL; `_etapas_pl_derivar_lote` espelhando `_kanban_derivar_lote` (`20260930130000:394`) trocando: `status_desenvolvimento`→`status_etapa_pl`, `_avaliar_condicoes_kanban_core`→`_avaliar_condicoes_etapas_pl_core`, fluxo = `_kanban_fluxo(_cfg->'etapas_pl_kanban', ...)` (board PL; sem revenda — reqs sempre `etapas_pl_requisitos`, exceções `{}`), elegível = `status_etapa_pl IS NOT NULL` (está no PL). REVOKE dos 3 + pós-condição ACL.

- [ ] **Step 4: Aplicar + rodar (passa).** **Step 5: rollback (DROP das 3 funções novas). Step 6: commit** `feat(kanban-pl): _etapas_pl_cfg/_ligado/_derivar_lote (Onda 2 cfg)`.

---

## Task 2: Fila `etapas_pl_recalculo_fila` + enfileiradores + gatilhos-fonte

**Files:** Modify `20261127110000_etapas_pl_fila.sql` (parte fila) + rollback + `tests/integration/kanban-pl-onda2-fila.test.ts`.

**Interfaces:**
- Produces: tabela `etapas_pl_recalculo_fila (modelo_id uuid PK REFERENCES modelos ON DELETE CASCADE, tenant_id uuid NOT NULL, criado_at timestamptz DEFAULT now())` RLS+REVOKE ALL; `_etapas_pl_enfileirar(_ids uuid[])` (sai se `app.etapas_pl_sistema<>''`; INSERT de modelo de loja com `etapas_pl_automatico` E `status_etapa_pl IS NOT NULL` — está no PL; ON CONFLICT rearma por xmin); `_etapas_pl_enfileirar_tenant(_tenant)`; gatilhos-fonte nas tabelas das condições PL: `modelos` (por linha, WHEN em lancado/status_etapa_pl-não/ordem…), `cad`/`producao_terceirizados`/`controle_qualidade` (statement-level via cad_id), `modelo_servico_mo` (via modelo_id), `modelo_peca_teste_tentativas` (via modelo_id), `categorias_terceirizado` (loja inteira). Espelha `fn_kanban_fila_*` (`20260930140000:264-491`) com nomes PL.

- [ ] **Step 1: Teste — editar um bloco de serviço de um modelo NO PL (status_etapa_pl set) com chave ligada enfileira; chave desligada NÃO enfileira.**

```ts
it("chave ligada + modelo no PL: editar producao_terceirizados enfileira", async () => {
  await withTx(async (c) => {
    await c.query(`update tenant_config set etapas_pl_automatico=true where tenant_id=$1`, [T]);
    // põe um modelo no PL e edita um bloco dele → conta linhas na fila
    // (montar fixture com helpers reais; assert etapas_pl_recalculo_fila tem o modelo)
  });
});
it("chave desligada: nada enfileira", async () => { /* etapas_pl_automatico=false → fila vazia */ });
```

- [ ] **Steps 2-6:** rodar/falhar → migration (espelhar os gatilhos-fonte do Dev com nomes PL; guarda de recursão `app.etapas_pl_sistema`) → aplicar/passar → rollback (`_down` DROP triggers+funções+tabela; `_down_drop` separado porque DROP TRIGGER em auth/storage trava — mas aqui os triggers são em tabelas de negócio; confirmar) → commit `feat(kanban-pl): fila + enfileiradores + gatilhos-fonte (Onda 2 fila)`.

---

## Task 3: CONSTRAINT TRIGGER + `fn_etapas_pl_processar_fila`

**Files:** Modify `20261127110000_etapas_pl_fila.sql` + teste.

**Interfaces:**
- Produces: `fn_etapas_pl_processar_fila() RETURNS trigger` (espelho de `fn_kanban_processar_fila` `20261027100000:103`: orçamento 3s, marca `app.etapas_pl_fila_feita`, DELETE…RETURNING dentro do bloco protegido, `_etapas_pl_aplicar(tenant,ids,'auto',NULL)`, EXCEPTION→WARNING card-a-card); CONSTRAINT TRIGGER `trg_etapas_pl_processar_fila` AFTER INSERT + `_upd` AFTER UPDATE OF criado_at, ambos DEFERRABLE INITIALLY DEFERRED.

- [ ] **Step 1: Teste — processa no COMMIT; erro não derruba o COMMIT.**

```ts
it("fila processa no COMMIT (SET CONSTRAINTS ALL IMMEDIATE no teste)", async () => {
  await withTx(async (c) => {
    await c.query(`set constraints all immediate`); // dispara o adiado dentro da txn revertida
    // enfileira um modelo e confere que status_etapa_pl foi derivado (ou mantido) sem erro
  });
});
```

- [ ] **Steps 2-6:** idem; `_etapas_pl_aplicar` vem na Task 4 (ordem: criar aplicador antes do processador, ou criar o processador chamando uma função que a Task 4 define — fazer a Task 4 ANTES do CONSTRAINT TRIGGER). **Ruling:** reordenar — Task 4 (`_etapas_pl_aplicar` + histórico) ANTES da Task 3 (processador que o chama). Commit `feat(kanban-pl): processador da fila no COMMIT (Onda 2)`.

---

## Task 4: `_etapas_pl_aplicar` + `fn_etapas_pl_historico`/trigger

**Files:** Modify `20261127110000_etapas_pl_fila.sql` + teste.

**Interfaces:**
- Produces: `_etapas_pl_aplicar(_tenant,_ids,_origem,_lote) RETURNS integer` (espelho de `_kanban_aplicar` `20261027140000:121`: `_origem IN ('auto','config')`; `app.etapas_pl_sistema:=_origem`+`app.etapas_pl_lote:=_lote` em volta; CTE deriva via `_etapas_pl_derivar_lote`, UPDATE `modelos SET status_etapa_pl = CASE WHEN muda THEN resultado ELSE atual END` só onde muda; retorna count de mudanças. **PL NÃO revela REF** — sem a cláusula de `ref_auto` do Dev); `fn_etapas_pl_historico()`/`trg_etapas_pl_historico` (AFTER ins/upd de `status_etapa_pl` em `modelos`, espelho de `fn_kanban_historico` `20260930140000:40` escrevendo em `modelo_etapa_pl_historico`, colapso 10s para 'auto'/'restauracao', lê `app.etapas_pl_sistema`/`_lote`).

- [ ] **Step 1: Teste — aplicar deriva e grava histórico; não re-enfileira (recursão).**
- [ ] **Steps 2-6:** migration + aplicar/passar + rollback + commit `feat(kanban-pl): aplicador + historico PL (Onda 2)`. (Esta task roda ANTES da Task 3 — ver Ruling.)

---

## Task 5: (integração fila↔aplicador — teste de ponta a ponta)

**Files:** Modify `tests/integration/kanban-pl-onda2-fila.test.ts`.
- [ ] Teste e2e: chave ligada + modelo no PL + editar bloco → `SET CONSTRAINTS ALL IMMEDIATE` → `status_etapa_pl` deriva pelo avaliador; aplicar NÃO gera fila nova (recursão cortada). Commit `test(kanban-pl): e2e fila→processador→aplicador (Onda 2)`.

---

## Task 6: `fn_etapas_pl_status_guard` + `etapas_pl_mover`

**Files:** Create `20261127120000_etapas_pl_guard_mover.sql` + rollback + teste.

**Interfaces:**
- Produces: `fn_etapas_pl_status_guard()`/`trg_etapas_pl_status_guard` (BEFORE UPDATE OF `status_etapa_pl` ON modelos; espelho de `fn_kanban_status_guard` `20260930140000:592`: sai cedo se status igual / `app.etapas_pl_sistema<>''` / `NOT _etapas_pl_ligado` / não está no PL / fluxo vazio; senão re-enfileira e decide manter/mover); `etapas_pl_mover(_modelo_id,_para) RETURNS jsonb` (espelho de `kanban_mover` `20260930150000:36`: gate login+`_exige_modulos('producao','etapas_pl')`+`user_can_edit('producao_etapas')`; `NOT _etapas_pl_ligado`→P0001 ASCII; `_etapas_pl_derivar_lote`+`_kanban_destino_drop_puro`; ações fixar/soltar/nada com `app.etapas_pl_sistema='manual'`).

- [ ] **Step 1: Teste — chave desligada: mover dá P0001; guard sai cedo no modo manual. Chave ligada: mover fixa/solta.**
- [ ] **Steps 2-6:** migration + aplicar/passar + rollback (`_down` neutraliza funções; `_down_drop` DROP trigger, horário calmo) + commit `feat(kanban-pl): status guard + etapas_pl_mover (Onda 2)`.

---

## Task 7: Gatilho de ENTRADA/SAÍDA pela peça teste

**Files:** Create `20261127140000_etapas_pl_entrada.sql` + rollback + teste.

**Interfaces:**
- Produces: `fn_etapas_pl_entrada()` + gatilhos em `modelo_servico_mo` (AFTER ins/upd/del, via modelo_id) e `categorias_terceirizado` (AFTER upd de exige_peca_teste, loja). Regra: `v_tem_pt := EXISTS(modelo_servico_mo s JOIN categorias_terceirizado ct ON ct.id=s.categoria_terceirizado_id AND ct.exige_peca_teste WHERE s.modelo_id=X)`; `v_pos_explosao := EXISTS(cad c WHERE c.modelo_id=X AND coalesce(c.enviado_corte,false))`. **ENTRADA:** se `v_tem_pt` E `status_etapa_pl IS NULL` E loja tem `etapas_pl` → `UPDATE modelos SET status_etapa_pl = <1ª etapa de etapas_pl_kanban>` (com `app.etapas_pl_sistema='auto'` + enfileira). **SAÍDA:** se `NOT v_tem_pt` E `status_etapa_pl IS NOT NULL` E `NOT v_pos_explosao` → `status_etapa_pl = NULL` (sai do PL). Pós-Explosão (`v_pos_explosao`) nunca sai. Também um gatilho em `cad` (enviado_corte) não é saída — pós-Explosão fica. 1ª etapa = `etapas_pl_kanban->>0` (key derivada via `_kanban_norm`? ou o label?); **Ruling:** `status_etapa_pl` guarda a KEY da etapa; a 1ª etapa = `resolveStatusKey(etapas_pl_kanban[0])` — precisa do helper de key; usar `_kanban_norm`/`slugify` como o board do Dev (confirmar como a key é derivada do label no PL; alinhar com a Onda 3). DEFINER, GUC.

- [ ] **Step 1: Teste — ganhar trilha de peça teste (sem card) põe status_etapa_pl na 1ª etapa; remover a última pré-Explosão tira (NULL); pós-Explosão NÃO tira.**
- [ ] **Steps 2-6:** migration + aplicar/passar + rollback + commit `feat(kanban-pl): entrada/saida do card pela peca teste (Onda 2)`.

---

## Task 8: Chave automático PL + snapshot/restaurar

**Files:** Create `20261127130000_etapas_pl_chave.sql` + rollback + teste.

**Interfaces:**
- Produces: `fn_etapas_pl_chave_protegida()`/`trg_etapas_pl_chave_protegida` (BEFORE INS/UPD tenant_config; só deixa mudar `etapas_pl_automatico` com `app.etapas_pl_chave='rpc'`; ⚠️ NOME PRÓPRIO — não colide com `fn_kanban_chave_protegida` do kanban nem do MOD-1; o gatilho NOVO só mexe em `NEW.etapas_pl_automatico`, deixa as outras colunas intactas); `etapas_pl_definir_automatico(_ligar boolean) RETURNS jsonb` (espelho de `kanban_definir_automatico`: admin-only, `app.etapas_pl_chave='rpc'` em volta do UPDATE, retorna `{ligado,mudou,lote_id,snapshot,cards_movidos}`); tabela `etapas_pl_snapshot` (espelho de `kanban_snapshot`); `fn_etapas_pl_config`/`trg_etapas_pl_config` (AFTER UPDATE de tenant_config WHEN etapas_pl_automatico/kanban/requisitos muda → snapshot + `_etapas_pl_aplicar(...,'config',lote)`); `etapas_pl_previa_restauracao`/`etapas_pl_restaurar` (espelhos).

- [ ] **Step 1: Teste — etapas_pl_automatico só muda pela RPC; gravar tenant_config direto não muda; ligar snapshota e recalcula; restaurar volta (exige chave desligada). E gravar `modules`/`kanban_automatico` direto NÃO é afetado pela trava PL (não colide).**
- [ ] **Steps 2-6:** migration + aplicar/passar + rollback (`_down` neutraliza; `_down_drop` DROP triggers/tabela, horário calmo) + commit `feat(kanban-pl): chave automatico + snapshot/restaurar PL (Onda 2)`.

---

## Self-Review

**1. Spec coverage (Onda 2 = motor):** cfg/derivação → Task 1; fila+enfileiradores+gatilhos → Task 2; processador no COMMIT → Task 3; aplicador+histórico → Task 4; e2e → Task 5; guard+mover → Task 6; entrada/saída peça teste → Task 7; chave+snapshot → Task 8. ✓ (Ordem real de execução: 1→2→4→3→5→6→7→8, pois o processador da Task 3 chama o aplicador da Task 4.)

**2. Placeholder scan:** cada task aponta a função-fonte do Dev (arquivo:linha) a espelhar e a troca de dependência exata. Os helpers de teste são "adaptar ao real da suíte". A derivação da KEY da 1ª etapa (Task 7) é marcada como Ruling a alinhar com a Onda 3 — é a única decisão fina aberta; resolver no começo da Task 7 lendo como o board deriva key do label. ✓

**3. Type consistency:** nomes PL próprios listados nas Global Constraints, usados iguais em todas as tasks; GUCs `app.etapas_pl_*` consistentes; `status_etapa_pl` (coluna) e `etapas_pl_*` (configs) da Onda 1. ✓

**4. Review Focus:** recursão (Task 5), COMMIT sobrevive a erro (Task 3), inércia com chave off (Task 2/6), entrada/saída (Task 7), colisão de nome da trava (Task 8). ✓

**Deploy:** Onda 2 é banco; com `etapas_pl_automatico=false` em todas as lojas, inerte (nada move, guard sai cedo, fila vazia). Pode ir ao ar acumulada com a Onda 1. Ordem de ida crescente `20261127100000..140000`; volta LIFO; `_down_drop` (DROP de triggers/tabelas) em horário calmo. QA real só na Onda 3 (quando a tela ligar a chave numa loja de teste).
