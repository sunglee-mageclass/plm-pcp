# Kanban automático — F1 (banco + espelho TS + testes) — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Colocar no banco o motor do Kanban automático (derivação da coluna pelos campos preenchidos, em cascata, com chave por loja DESLIGADA por padrão), com espelho TS puro e testes anti-drift — sem tocar em nenhuma tela e sem aplicar nada em produção antes do portão G-migration.

**Architecture:** Quatro migrations aditivas e idempotentes (`schema` → `derivação pura` → `motor: fila + gatilhos + guard` → `RPCs públicas`), cada uma com script inverso pareado em `supabase/rollback/`. A derivação é uma função IMMUTABLE (`_kanban_derivar_puro`) espelhada 1:1 em `src/lib/kanban-auto.ts` e travada por fixtures compartilhadas. O recálculo é ADIADO para o COMMIT (fila `kanban_recalculo_fila` + CONSTRAINT TRIGGER DEFERRABLE INITIALLY DEFERRED); os enfileiradores só existem nas tabelas-fonte das condições; com a chave desligada nada é enfileirado e nenhum status muda.

**Tech Stack:** PostgreSQL 17.6 (Supabase próprio `ruinwcuabilumcspeyjk`), plpgsql/sql, TypeScript puro (sem React), Vitest (unit + integração em `BEGIN…ROLLBACK` na CÓPIA LOCAL do banco — Docker `supabase/postgres:17.6.1.134` em `127.0.0.1:54422`), `psql` de produção (`/tmp/dburl.txt`) SÓ na Task 18.

**Spec:** `/Users/sunglee/.claude/plans/h-uma-necessidade-de-flickering-lovelace.md` (seções "Regras de derivação", "F1 — Kanban automático no banco", "SAVE POINT/Como voltar", "Riscos", "Verificação"). Ressalvas que este plano endereça: diário do guardião `/Users/sunglee/PLM + Criação/plm-pcp/.superpowers/sdd/2026-09-22-unificacao-kanban-auto/guardiao.md` (G-inicial #1–#10, G-fase F0 R1/R2) e ficha `/Users/sunglee/PLM + Criação/.claude/agents/guardiao-unificacao.md` (decisões travadas 1–17, checklist G-migration). **Revisão de 23/set** (depois do G-plano F1 — BLOQUEIA parcial): decisões do dono 14–17 e ressalvas R1–R8 do guardião incorporadas no §3, §5, Tasks 4–18 e §6; o código das Tasks 4–17 foi re-validado SÓ na cópia local (§5, cabeçalho). As Tasks 1–3 não mudaram.

## Global Constraints

- Repo: `/Users/sunglee/PLM + Criação/plm-pcp`, branch `feature/plan-tecido-a1`, HEAD ≥ `9d39d3c` (23/set: `tests/integration/db.ts` ganhou `ehBancoLocal()` e desliga SSL na cópia local) (tag `savepoint-pre-unificacao-2026-09-22` → `02cb2ff`). Todo caminho abaixo é relativo a essa raiz, salvo quando absoluto.
- **Nenhuma migration é aplicada no banco de PRODUÇÃO antes do portão G-migration (Task 18).** Durante as Tasks 1–17 produção não recebe NADA — nem teste. **DDL/migration, inclusive dentro de `BEGIN…ROLLBACK`, roda SÓ na CÓPIA LOCAL** (decisão 17 do dono, 23/set). Motivo (incidente 23/set): um `ALTER TABLE tenant_config` dentro da txn de teste pegou AccessExclusive até o ROLLBACK e travou o app de TODAS as lojas — `tenant_module_enabled` lê `tenant_config` em 137 policies RLS. Os testes de integração aplicam as migrations DENTRO da transação revertida (helper `prepara`, Task 4, que LANÇA erro se o banco não for a cópia local), nunca com `\i` do arquivo (o `COMMIT;` do arquivo vaza a transação — incidente 15/set).
- **Cópia local** = `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres` (container Docker `supabase_db_banco-local`, imagem `public.ecr.aws/supabase/postgres:17.6.1.134`, restaurado de produção em 23/set a partir de `/Users/sunglee/PLM + Criação/banco-local/dump/`; fora do git). **Pré-voo** de toda task que roda integração: `docker ps --filter name=supabase_db_banco-local --format '{{.Status}}'` → `Up … (healthy)` e `psql "postgresql://postgres:postgres@127.0.0.1:54422/postgres" -X -A -t -c "select (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'), (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal)"` → `427|219`. Fora do ar ou contagem diferente ⇒ PARAR e avisar o orquestrador (não subir, recriar nem “consertar” a cópia por conta própria).
- Numeração das migrations MAIOR que a última aplicada (`20260929120000_direcionamento_resumo_subcolecao.sql`): `20260930120000`, `20260930130000`, `20260930140000`, `20260930150000`. Cada arquivo em `BEGIN; … COMMIT;` + `select pg_notify('pgrst','reload schema');` no fim, idempotente (`IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP TRIGGER IF EXISTS` antes de `CREATE TRIGGER`, `DROP POLICY IF EXISTS`).
- Script inverso pareado por migration em `supabase/rollback/<mesmo nome>_down.sql` (pasta NOVA). Ordem de desfazer: 4 → 3 → 2 → 1. Funções REDEFINIDAS voltam ao texto do snapshot `/Users/sunglee/PLM + Criação/savepoints/2026-09-22-pre-unificacao/funcoes.sql` (nunca editar/commitar o snapshot).
- Invariante #9: toda função interna (`_kanban_*`) com `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated`; RPC pública com `REVOKE … FROM PUBLIC, anon` + `GRANT EXECUTE … TO authenticated`; tudo `SECURITY DEFINER SET search_path TO 'public'` (exceto as IMMUTABLE puras, que não leem tabela). Prova com `has_function_privilege`. Funções de gatilho (`fn_*`) seguem a convenção vigente (sem REVOKE — não são expostas pelo PostgREST).
- **Chave desligada (`tenant_config.kanban_automatico=false`, default) = comportamento IDÊNTICO ao de hoje**: nenhum status muda em nenhum evento, nada entra na fila, nenhum snapshot, `_kanban_regredir_modelo` legado intacto.
- `fn_colab_touch_rev` NÃO é alterado (bump de `rev` mantido em toda escrita em `modelos`).
- Nada em `src/components/desenvolvimento/`, `src/components/producao/cad/CadTecidosSection.tsx` nem em rotas/telas (decisão travada 8; telas são F2/F3). Só `src/lib/*.ts`, `tests/*`, `supabase/migrations/*`, `supabase/rollback/*`.
- Mensagens de erro em PT-BR com `ERRCODE = 'P0001'` (nunca 23514); permissão negada = `42501`.
- Rótulos de condição SEMPRE do catálogo `CONDICOES` (`src/lib/kanban-condicoes.ts`, `label`); nunca duplicar o catálogo.
- `reprovado` é SEMPRE manual (regra fixa no SQL e no TS, mesmo com requisito configurado).
- Comandos de gate antes de cada commit: `npm run build` (não faz type-check) + `npx tsc --noEmit 2>&1 | grep -E "TS2304|error" ; true` + `npx vitest run --no-file-parallelism tests/unit/kanban-auto.test.ts tests/unit/kanban-status.test.ts` (+ integração quando a task mexe no banco, SEMPRE na cópia local: `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres KANBAN_AUTO_MIG_TXN=1 npx vitest run --no-file-parallelism tests/integration/kanban-auto.test.ts tests/integration/kanban-condicoes.test.ts`). O executor LÊ a saída do `tsc` (o `; true` só evita abortar o bloco — G-plano, nota).
- Commits isolados: `git commit --only -m "<msg>" -- <paths>`; NUNCA `git add .`. Mensagem termina com `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Não matar o vite do dono; não criar dado em PRODUÇÃO (nas Tasks 1–17 produção não é nem conectada). Na cópia local, só o ensaio da Task 18 (Step 1) aplica de verdade — e termina desfeito (volta a 427 funções / 219 gatilhos).

---

## 1. Fatos verificados (22/set, só leitura) que o código abaixo assume

- PG **17.6**. Provado em `BEGIN…ROLLBACK`: `transition tables cannot be specified for triggers with more than one event` e `…with column lists` → **3 gatilhos statement-level por tabela-filha (INSERT/UPDATE/DELETE), sem lista de colunas**. `CREATE CONSTRAINT TRIGGER … DEFERRABLE INITIALLY DEFERRED FOR EACH ROW` (com `WHEN`) funciona. GUC customizado `app.kanban_sistema` via `set_config(..., true)` funciona; `current_setting(name, true)` devolve NULL/'' quando não setado.
- `tenant_config` (6 linhas) NÃO tem `kanban_automatico`. Colunas de kanban: `status_kanban jsonb` (array de STRINGS-label em todas as 6 lojas; Ave Rara `20c84a36` tem 15 colunas incluindo `"Prova de Roupa "` com espaço final → key `prova_de_roupa`), `kanban_requisitos jsonb NOT NULL DEFAULT '{}'`, `kanban_requisitos_excecoes jsonb NOT NULL DEFAULT '{}'` (`{}` nas 6), `revenda_kanban_colunas jsonb NOT NULL DEFAULT '[]'`, `revenda_kanban_requisitos jsonb NOT NULL DEFAULT '{}'`, `confeccao_prioridade jsonb NOT NULL DEFAULT '[]'`, `explosao_envio_status text`, `ref_exibir_status text`.
- **Loja Teste** `37889b78-fffb-404b-8c75-18b7e50a1d9b` (âncora dos testes de integração): board de 16 colunas na ordem `desenho_tecnico, em_negociacao, em_modelagem, corte_piloto_1, corte_piloto_2, corte_piloto_3, em_pilotagem, prova_roupa_1, prova_roupa_2, prova_roupa_3, prova_roupa_4, prova_roupa_5, em_ajuste, stand_by, reprovado, aprovado`; `kanban_requisitos = {"aprovado":["servico_aprovado"],"em_negociacao":["linha_definida"],"desenho_tecnico":["ordem_criacao_enviada"]}`; 14 modelos (9 internos deriváveis, 2 revenda), 13 `linhas`, 5 `colaboradores`. Os testes REESCREVEM a config dentro da txn (revertida).
- `modelos` (66 colunas, 269 linhas; 258 com `ordem_criacao_enviada`, 1 `lancado`, 57 `origem='revenda'`, 0 `importado`). `origem text NOT NULL DEFAULT 'interno'` com CHECK `('interno','revenda','importado')`. `revisao_pendente jsonb NOT NULL DEFAULT '{}'` (2 linhas com `{"kanban": true}`). `rev int NOT NULL DEFAULT 1`. FKs: `modelista_id → colaboradores(id)`, `linha_id → linhas(id)`.
- Colunas de `modelos` lidas por `_avaliar_condicoes_kanban_core` (versão vigente = migration `20260909120000`, 39 chaves): `categoria_principal_id, subcategoria1_id, subcategoria2_id, estilista_id, linha_id, colecao, tecidos_planejados, ordem_criacao_enviada, preco_venda, data_lancamento, lancado, modelista_id, piloteiro1_id, piloteiro2_id, piloteiro3_id, data_desenho_tecnico, data_piloto1, data_piloto2, data_piloto3, data_aprovacao, croqui_url, desenho_tecnico_url, fotos_modelo, ficha_medida_url, enviado_cad, custo_terceirizados_aprovado` (26) + `origem` define o fluxo (G-inicial #10b). Tabelas-filhas lidas: `modelo_grades(modelo_id)`, `modelo_tecidos(modelo_id)`, `modelo_tecido_variantes(modelo_tecido_id)`, `modelo_aviamentos(modelo_id)`, `modelo_servico_mo(modelo_id)`, `cad(modelo_id)`, `cad_tecidos(cad_id)`, `cad_tecido_variantes(cad_tecido_id)`, `cad_aviamentos(cad_id)`, `cad_etiquetas(cad_id)`, `controle_qualidade(cad_id)`, `producao_terceirizados(cad_id)`; e `categorias_terceirizado(etapa, nome, ativo)` via `_cq_liberado`/`_resolver_fonte_confeccao`.
- Retorno do core: `jsonb` `{ "<modelo_id>": { "<key>": bool, … } }` (só modelos do tenant e dos ids pedidos; `'{}'` se nenhum).
- Índices que FALTAM (confirmado em `pg_indexes`): `cad_tecidos(cad_id)`, `cad_tecido_variantes(cad_tecido_id)`, `cad_aviamentos(cad_id)`, `cad_etiquetas(cad_id)`, `modelo_aviamentos(modelo_id)`. Já existem: `modelo_tecidos(modelo_id)`, `modelo_tecido_variantes(modelo_tecido_id)`, `modelo_grades(modelo_id)`, `modelo_servico_mo(modelo_id)`, `cad(modelo_id)`, `controle_qualidade(cad_id)`, `producao_terceirizados(cad_id)`.
- `modelo_kanban_historico(id, tenant_id, modelo_id, status, entrou_at, created_at)`, índices `idx_mkh_modelo(modelo_id, entrou_at)`, `idx_mkh_tenant`; RLS com policy só de SELECT por tenant; escrita só por trigger DEFINER.
- Gatilhos BEFORE UPDATE em `modelos` disparam em ordem ALFABÉTICA: `trg_colab_rev` → (**novo** `trg_kanban_status_guard`) → `trg_modelo_markup_congela` → `trg_modelo_mo_flag` (`fn_modelo_mo_flag_derivada` re-deriva `custo_terceirizados_aprovado` em TODA escrita) → `trg_modelo_preco_venda_gate` → `trg_modelo_ref_auto`. AFTER: `audit_modelos`, `trg_kanban_historico` (UPDATE OF status_desenvolvimento), `trg_kanban_regredir_modelos` (UPDATE OF custo_terceirizados_aprovado, enviado_cad).
- Regressão legada: `_kanban_regredir_modelo(uuid)` chamada por `fn_kanban_regredir_{modelos,cq,cad,cad_grades}`. Corpo do snapshot = migration `20260906120000` (diff só no `;` final).
- `_kanban_status_rows(uuid)` (plpgsql STABLE, `SET search_path`, sem DEFINER) é usada por `_explosao_envio_gate`, `_ref_exibir_gate`, `_kanban_regredir_modelo`. `_explosao_envio_gate(_tenant, _status)` só é chamada por `_enviar_modelo_para_cad_core` (funcoes.sql:2186); `_ref_exibir_gate` só por `fn_modelo_ref_auto` (:12161). Versão vigente de `fn_modelo_ref_auto` = migration `20260916210000` (usa `_ref_montar_sigla`/`_ref_juntar`/`_ref_num_fmt`).
- Front hoje (referência de paridade, NÃO alterar): board `criacao.desenvolvimento.tsx` `updateStatus` = `UPDATE modelos SET status_desenvolvimento` + RPC `marcar_etapa_verificada(_modelo_id,'kanban')` (= `revisao_pendente - 'kanban'`); Sheet do Dev manda `status_desenvolvimento` + `motivo_cancelamento: reprovadoAtual ? motivo : null` num payload de ~40 colunas; Config faz `upsert` da linha inteira de `tenant_config` (`select("*")` + `...cfgRest`, configuracoes.tsx:190-191/263-277) → depois da migration 1 a `kanban_automatico` viaja nesse upsert (aba aberta antes de alguém ligar/desligar regravaria o valor velho) — daí a trava da decisão 16 (Task 13).
- `_wipe_tenant_core` apaga TODA tabela de `public` com coluna `tenant_id` (loop em `information_schema`) → as tabelas novas (com `tenant_id`) são cobertas pelo reset/exclusão de loja sem mudança.
- `supabase_migrations.schema_migrations(version text, statements text[], name text)` tem 104 linhas e parou em `20260626250000` — as migrations de jul→set NÃO foram registradas lá. O registro fica como passo do apply (Task 18), idempotente.
- Harness de integração: `tests/integration/db.ts` (`hasDb`, `withTx` = BEGIN…ROLLBACK sempre, `comoUsuario` seta `request.jwt.claims` + fixa `users.tenant_id = TENANT_TESTE` na txn, `um`, `TENANT_TESTE`, `USER_TESTE` (= super_admin), `ehBancoLocal()` — true quando o host é localhost/127.0.0.1/::1, commit `9d39d3c`); credencial `DATABASE_URL` ou `/tmp/dburl.txt`; SSL `rejectUnauthorized:false` em produção e DESLIGADO na cópia local (o `sslDoBanco()` do helper não é exportado — quem abre `Client` próprio usa `ehBancoLocal() ? false : { rejectUnauthorized: false }`; com SSL ligado a cópia local recusa a conexão).
- `tenant_config`: UNIQUE `tenant_config_tenant_id_key (tenant_id)` (alvo do upsert da Config); gatilhos hoje = `set_tenant_id_trg` (BEFORE INSERT) e `audit_tenant_config` (AFTER); policies de INSERT/UPDATE só `is_tenant_admin()` da própria loja (ou super_admin). `tenants` tem `trg_criar_tenant_config` (AFTER INSERT → `_seed_tenant_defaults` cria a linha de `tenant_config`). Só `_kanban_regredir_modelo` escreve `revisao_pendente.kanban` (única ocorrência de `'{"kanban": true}'` no snapshot `funcoes.sql`).
- Cópia local (23/set): mesmas 427 funções (por hash), 219 gatilhos e contagens das 121 tabelas de `public` que produção; a suíte da F1 inteira (com `KANBAN_AUTO_MIG_TXN=1`) leva ~3 s nela. Loja Teste: 10 modelos deriváveis, nenhum com `data_piloto2` (o board sintético dos testes nunca leva card pré-existente a `etapa_c`). `vitest.config.ts` inclui `tests/**/*.test.ts` (fixtures em `tests/fixtures/*.ts` não são coletadas). `tsconfig.json` só inclui `src/` (tests ficam fora do `tsc`).
- `tests/unit/*` importa por alias `@/lib/...`; `tests/integration/*` importa por caminho relativo `../../src/lib/...`.

## 2. Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/lib/kanban-auto.ts` (novo, puro) | `lerKanbanAutoConfig`, `boardDaLoja`, `fluxoDoModelo`, `reqsDoModelo`, `colunaManual`, `statusDerivado`, `entradaParaDerivacao`, `derivarModelo`, `faltandoPara`, `destinoDrop`, `mensagemDrop`, `statusParaGate` — espelho exato do SQL puro. |
| `src/lib/kanban-status.ts` (modificar) | `podeEnviarExplosao`/`refCampoVisivel` ganham 4º parâmetro opcional `opts?: GateOpts` (`{ statusGate?: string \| null }`) sem quebrar chamadas atuais. |
| `tests/fixtures/kanban-auto-casos.ts` (novo) | Casos compartilhados unit × anti-drift SQL. |
| `tests/unit/kanban-auto.test.ts` (novo) | TS puro contra as fixtures + helpers de config/fluxo/mensagem. |
| `tests/unit/kanban-status.test.ts` (modificar) | 1 `describe` novo para `opts.statusGate`. |
| `tests/integration/kanban-auto.test.ts` (novo) | Harness (aplica migrations na txn com `KANBAN_AUTO_MIG_TXN=1`, SÓ na cópia local — `prepara` recusa outro banco), anti-drift SQL, motor, guard, trava da chave, RPCs, ACL, rollback round-trip, "chave desligada = nada muda". |
| `supabase/migrations/20260930120000_kanban_auto_1_schema.sql` | 5 índices, `origem`/`lote_id` no histórico, `kanban_recalculo_fila`, `kanban_snapshot` e, POR ÚLTIMO (R1), a coluna `tenant_config.kanban_automatico`. |
| `supabase/migrations/20260930130000_kanban_auto_2_derivacao.sql` | `_kanban_status_rows_raw` + wrapper, helpers puros, `_kanban_derivar_puro`, `_kanban_destino_drop_puro`, `_kanban_cfg`, `_kanban_ligado`, `_kanban_fluxo(_keys)`, `_kanban_derivar_lote`, `_kanban_status_gate`. |
| `supabase/migrations/20260930140000_kanban_auto_3_motor.sql` | Histórico com janela (+ D14), fila + constraint trigger, `_kanban_aplicar` (não mexe no `#Erro` — decisão 14), enfileiradores, trava da chave `trg_kanban_chave_protegida` (decisão 16) + gatilho de `tenant_config` (snapshot), guard, `_kanban_regredir_modelo`/`fn_modelo_ref_auto`/`_enviar_modelo_para_cad_core` redefinidas. |
| `supabase/migrations/20260930150000_kanban_auto_4_rpcs.sql` | `kanban_mover` (não mexe no motivo — decisão 15), `kanban_previa_recalculo` (+ REFs que serão reveladas — R4), `kanban_definir_automatico` (o botão da chave — decisão 16), `kanban_previa_restauracao`, `kanban_restaurar`. |
| `supabase/rollback/<ts>_kanban_auto_N_<nome>_down.sql` (4 novos) | Inversos pareados, testados em txn. |

## 3. Regras normativas (valem para o TS e para o SQL — o anti-drift compara os dois)

**Vocabulário.** `board` = colunas de `status_kanban` normalizadas (`normalizeKanbanStatuses` ≡ `_kanban_status_rows_raw`), DEDUP por key (fica a 1ª ocorrência). `fluxo` = board se origem interna; se origem COMPRADA (`ehOrigemComprada`: `revenda`/`importado`) = board ∩ `revenda_kanban_colunas` (`[]` = todas), renumerado. `reqs` = `kanban_requisitos` (interno) ou `revenda_kanban_requisitos` (comprado); `exc` = `kanban_requisitos_excecoes` (interno) ou `{}` (comprado — sem exceções, sem exceção). `cond` = mapa condição→bool do core. Chaves de status sempre `lower(btrim(...))`.

**Coluna manual/automática.** `colunaManual(col) = col === 'reprovado' || (reqs[col] ?? []).length === 0`. Os requisitos configurados em `reprovado` são IGNORADOS na cascata (regra fixa, decisão 9 + G-inicial #2).

**Derivável.** `derivavel = ordem_criacao_enviada === true && lancado !== true && fluxo.length > 0`. Não derivável ⇒ `resultado = status` (nada muda), `alvo = null`, `fixado = false`.

**Entrada** = `fluxo[0]`. Nunca conta como fixado; é o piso do alvo (mesmo que tenha requisito próprio que falhe).

**Alvo.** `alvo = entrada`; caminhar `fluxo` na ordem pulando colunas manuais; para cada automática, `efetivos = requisitosEfetivos(col, fluxo, reqsSemReprovado, exc)` (união dos próprios de `fluxo[0..i]`, dedup em ordem de aparição, menos exceções da própria coluna que não sejam próprias dela); `faltando = efetivos.filter(k => !cond[k])`; se `faltando` não vazio ⇒ `primeiraFalha = col`, PARA; senão `alvo = col`. Assim a derivação NUNCA pula coluna (G-inicial #3): com exceção em C que ignora `y`, um card com x,z sem y fica preso ANTES de B.

**Fixado.** `fixado = status ∈ fluxo && status !== entrada && colunaManual(status)`. Resultado = `fixado ? status : alvo`. Status órfão (fora do fluxo) ou NULL ⇒ não fixado ⇒ resultado = alvo.

**Arraste (`destinoDrop(input, para)`), avaliado nesta ordem:**
1. `para ∉ fluxo` ⇒ `fora_do_fluxo` (status inalterado).
2. não derivável ⇒ `para === status ? nada : fixar(para)` (gravação livre, como hoje sem motor).
3. `para === entrada` ⇒ fixado: `soltar(alvo)`; senão se `alvo === entrada`: `status === alvo ? nada : soltar(alvo)`; senão `bloquear_ja_cumprida`.
4. `colunaManual(para)` ⇒ `para === status ? nada : fixar(para)`.
5. `idx(para) > idx(alvo)` ⇒ `bloquear_faltando`, `faltando = faltandoPara(para)` (card fixado continua fixado — decisão 2).
6. `idx(para) < idx(alvo)` ⇒ fixado: `soltar(alvo)`; senão `bloquear_ja_cumprida`.
7. `idx(para) === idx(alvo)` ⇒ fixado: `soltar(alvo)`; senão `status === alvo ? nada : soltar(alvo)`.

`faltandoPara(para)` = união (dedup, em ordem) dos `efetivos` NÃO satisfeitos das colunas AUTOMÁTICAS de `primeiraFalha` até `para` (inclusive). Cobre o caso de exceção em que `para` sozinho estaria satisfeito mas uma coluna anterior não.

No servidor, `kanban_mover` aplica esta tabela (chave ligada; desligada → `P0001`, D3): fixar/soltar gravam com GUC `'manual'`; fixar/soltar/nada apagam o `#Erro`; bloqueios não gravam nada; sair de `reprovado` NÃO mexe em `motivo_cancelamento` (decisão 15 do dono, 23/set — o motivo fica guardado).

**Mensagens (TS, `mensagemDrop`)**: `bloquear_faltando` → `Falta 1 dado para completar: <label>` / `Faltam N dados para completar: <label1>, <label2>`; `bloquear_ja_cumprida` → `O card já cumpre "<label da coluna>". Para segurá-lo numa etapa, use uma coluna manual.`; `fora_do_fluxo` → `A etapa "<para>" não faz parte do fluxo deste modelo.`. Labels de condição = `CONDICAO_BY_KEY.get(k)?.label ?? k`.

**GUC de sessão `app.kanban_sistema`** (transação-local): `''`/ausente = escrita de fora do motor (Sheet do Dev, board antigo, RPC legada); `'auto'` = recálculo por evento; `'config'` = recálculo por mudança de config/ligar a chave; `'manual'` = `kanban_mover`; `'restauracao'` = `kanban_restaurar`. `app.kanban_lote` = uuid do lote (texto) ou `''`. Regras: o guard deixa passar qualquer escrita com GUC não vazio; enfileiradores NÃO enfileiram com GUC não vazio (trava de recursão — cobre `fn_modelo_mo_flag_derivada`, o `ref` revelado pelo motor e o gatilho legado); `fn_kanban_historico` grava `origem = coalesce(nullif(GUC,''),'manual')`. **`app.kanban_chave`** (transação-local): `'rpc'` SÓ dentro de `kanban_definir_automatico` (e no helper de teste `chave`); sem ele a trava `trg_kanban_chave_protegida` não deixa `kanban_automatico` mudar (decisão 16).

**Histórico (`fn_kanban_historico`)**: colapso por JANELA de 10 s só para escritas `auto` (cadeia de save com várias requisições — G-inicial #5): se a última linha do modelo tem `origem='auto'` e `entrou_at > now() - 10 s`: se a penúltima linha tem `status = novo` ⇒ APAGA a última (o recuo transitório nunca existiu); senão ATUALIZA a última (`status`, `entrou_at`, `lote_id`). Fora da janela, ou origem ≠ auto ⇒ INSERE. Colunas puladas não ganham linha (documentado — sem amostra no Leadtime). Linhas antigas ficam `origem='manual'` (inclui regressões do gatilho legado — indistinguíveis retroativamente). **Restauração (D14, dono 23/set):** escrita `'restauracao'` NÃO insere linha quando a última linha restante do modelo (depois de `kanban_restaurar` apagar as `auto`/`config` do lote) já tem o mesmo status — o Leadtime não ganha amostra repetida.

**`#Erro` (`revisao_pendente.kanban`)** — regra concreta (decisão 14 do dono, 23/set; substitui a regra de janela da 1ª versão e elimina a D13):
- Com a chave LIGADA o motor NUNCA acende nem apaga o `#Erro`: recuo automático (`auto` ou `config`) só devolve o card à coluna a que ele pertence. `_kanban_aplicar` não escreve `revisao_pendente`.
- APAGA só em `kanban_mover` com acao `fixar`/`soltar`/`nada` (o usuário revisou — paridade com o drop de hoje, que chama `marcar_etapa_verificada`). Pode existir `#Erro` LEGADO, aceso quando a chave estava desligada: ele fica até essa revisão (D20).
- `restauracao` não mexe no `#Erro`.
- Chave DESLIGADA: `#Erro` idêntico a hoje (o legado `_kanban_regredir_modelo` acende; com a chave ligada ele sai cedo).

**Gates por posição (decisão 10)**: `_kanban_status_gate(_tenant, _modelo_id, _status_atual)` devolve o status a usar em `_explosao_envio_gate`/`_ref_exibir_gate`: chave desligada ⇒ `_status_atual`; GUC ∈ (`auto`,`config`,`restauracao`) ⇒ `_status_atual` (o motor já grava a derivada); senão derivação do modelo: não derivável ⇒ `_status_atual`; derivável ⇒ `alvo` (para card automático `alvo == status`; para fixado é a posição derivada). Card FIXADO cuja posição derivada atinge `ref_exibir_status` tem a REF revelada pelo próprio `_kanban_aplicar` (o status não muda, então `fn_modelo_ref_auto` não veria). REF revelada NÃO volta (nem ao desligar, nem na restauração): a prévia de LIGAR já lista as REFs que serão reveladas (R4) e a prévia de restaurar repete o aviso. TS: `statusParaGate(ligado, derivacao, statusAtual)` + `opts.statusGate` em `podeEnviarExplosao`/`refCampoVisivel`.

**Snapshot p/ desfazer (`kanban_snapshot`)**: gravado NO SERVIDOR pelo gatilho de `tenant_config` na mesma transação do save da Config (G-fase R2), (a) ao LIGAR a chave — o que só acontece pela RPC `kanban_definir_automatico` (decisão 16) — (`motivo='ligar'`) e (b) a cada mudança de `status_kanban`/`kanban_requisitos`/`kanban_requisitos_excecoes`/`revenda_kanban_colunas`/`revenda_kanban_requisitos` com a chave ligada (`motivo='config'`): uma linha por modelo derivável com `status_anterior`. `confeccao_prioridade` só recalcula (sem snapshot). Desligar não grava nada. `kanban_restaurar(_lote_id)` exige a chave DESLIGADA (senão o próximo evento desfaria a restauração), volta `status_desenvolvimento = status_anterior` onde diferir (origem `restauracao`), apaga as linhas `auto`/`config` do histórico dos modelos do lote desde `criado_at` do lote, marca `restaurado_at`. Prévia lista quem volta e quem teve movimento MANUAL depois do lote.

**Chave protegida (decisão 16 do dono, 23/set; G-plano R3)**: `kanban_automatico` só muda pela RPC `kanban_definir_automatico(_ligar)` (admin da loja ou super; a F2 chama depois da prévia). `trg_kanban_chave_protegida` (BEFORE INSERT OR UPDATE em `tenant_config`): sem `app.kanban_chave='rpc'`, UPDATE mantém `OLD.kanban_automatico` (upsert de aba velha não liga nem desliga) e INSERT nasce `false`. Snapshot + recálculo ao ligar continuam no gatilho AFTER `trg_kanban_config` — o UPDATE da RPC o dispara na mesma txn.

**Prévia de LIGAR/mudar a config (`kanban_previa_recalculo`, R4)**: além de quem muda de coluna e dos fixados, devolve `revelam_ref` + `refs_reveladas[{modelo_id, nome, ref_auto, posicao_derivada}]` = card derivável com `ref` vazia e `ref_auto` pronta, que MUDA de coluna ou está FIXADO, cuja posição derivada atinge `ref_exibir_status` (o mesmo critério de `fn_modelo_ref_auto` + `_kanban_aplicar`, com a régua de `_ref_exibir_gate` sobre o board PROPOSTO), e `avisos: ['A REF revelada não volta ao desligar nem ao restaurar as colunas.']` quando há alguma.

**Guard (`trg_kanban_status_guard`, BEFORE UPDATE OF status_desenvolvimento)**: com chave desligada, GUC não vazio, card não derivável ou status igual ⇒ passa. Senão: destino fora do fluxo ⇒ `RAISE P0001 'A etapa "X" não faz parte do fluxo deste modelo.'`; destino manual ⇒ passa (fixa; entrada aceita — o COMMIT re-deriva); destino AUTOMÁTICO vindo de fora do motor ⇒ se o card estava FIXADO (coluna manual ≠ entrada) vai para a posição DERIVADA ("tirar de manual solta"), senão mantém o valor atual (draft velho do Sheet do Dev é ignorado). `''`/NULL ⇒ mantém o atual.

---

### Task 1: Fixtures compartilhadas + `src/lib/kanban-auto.ts` (derivação)

**Files:**
- Create: `tests/fixtures/kanban-auto-casos.ts`
- Create: `src/lib/kanban-auto.ts`
- Test: `tests/unit/kanban-auto.test.ts`

**Interfaces:**
- Consumes: `requisitosEfetivos`, `CONDICAO_BY_KEY` (`src/lib/kanban-condicoes.ts`); `normalizeKanbanStatuses`, `KanbanStatus` (`src/lib/kanban-status.ts`); `lerRevendaConfig` (`src/lib/revenda-config.ts`); `ehOrigemComprada` (`src/lib/origem.ts`).
- Produces: `type DerivacaoInput = { fluxo: string[]; reqs: Record<string,string[]>; exc: Record<string,string[]>; cond: Record<string,boolean>; status: string|null; derivavel: boolean }`; `type Derivacao = { derivavel: boolean; entrada: string|null; alvo: string|null; resultado: string|null; fixado: boolean; primeiraFalha: string|null; faltando: string[] }`; `statusDerivado(input): Derivacao`; `KanbanAutoConfig`; `lerKanbanAutoConfig(tc:any): KanbanAutoConfig`; `boardDaLoja(cfg): KanbanStatus[]`; `fluxoDoModelo(origem, cfg): KanbanStatus[]`; `reqsDoModelo(origem, cfg): {reqs, exc}`; `colunaManual(col, reqs): boolean`; `semReprovado(reqs)`; `normKey(s)`; `entradaParaDerivacao(modelo, cfg, cond): DerivacaoInput`; `derivarModelo(modelo, cfg, cond): Derivacao`. Fixtures: `CASOS: CasoKanban[]` (`{nome, input, esperado, arrastes}`), `type ArrasteEsperado = { para; acao; status; faltando }`.

- [ ] **Step 1: Criar as fixtures compartilhadas**

```ts
// tests/fixtures/kanban-auto-casos.ts
/**
 * FIXTURES COMPARTILHADAS do Kanban automático (F1). Usadas por:
 *   - tests/unit/kanban-auto.test.ts            → statusDerivado / destinoDrop (TS puro)
 *   - tests/integration/kanban-auto.test.ts     → _kanban_derivar_puro / _kanban_destino_drop_puro (SQL)
 * Os dois lados recebem o MESMO input e precisam devolver o MESMO resultado (anti-drift TS×SQL).
 * Regras normativas: docs/superpowers/plans/2026-09-22-kanban-automatico-f1-banco.md §3.
 */
import type { AcaoDrop, Derivacao, DerivacaoInput } from "@/lib/kanban-auto";

export type ArrasteEsperado = { para: string; acao: AcaoDrop; status: string | null; faltando: string[] };
export type CasoKanban = { nome: string; input: DerivacaoInput; esperado: Derivacao; arrastes: ArrasteEsperado[] };

// Board de exemplo: entrada (manual, sem requisito) · a{x} · b{y} · stand_by (manual) · c{z} · reprovado (manual) · d{w}
export const FLUXO_A = ["entrada", "a", "b", "stand_by", "c", "reprovado", "d"];
export const REQS_A: Record<string, string[]> = { a: ["x"], b: ["y"], c: ["z"], d: ["w"] };

function caso(
  nome: string,
  input: Partial<DerivacaoInput>,
  esperado: Derivacao,
  arrastes: ArrasteEsperado[] = [],
): CasoKanban {
  return {
    nome,
    input: { fluxo: FLUXO_A, reqs: REQS_A, exc: {}, cond: {}, status: null, derivavel: true, ...input },
    esperado,
    arrastes,
  };
}

export const CASOS: CasoKanban[] = [
  caso(
    "1. nada satisfeito → fica na entrada (piso)",
    { cond: {}, status: null },
    { derivavel: true, entrada: "entrada", alvo: "entrada", resultado: "entrada", fixado: false, primeiraFalha: "a", faltando: ["x"] },
    [
      { para: "entrada", acao: "soltar", status: "entrada", faltando: [] },
      { para: "a", acao: "bloquear_faltando", status: null, faltando: ["x"] },
      { para: "stand_by", acao: "fixar", status: "stand_by", faltando: [] },
      { para: "zzz", acao: "fora_do_fluxo", status: null, faltando: [] },
    ],
  ),
  caso(
    "2. x e z sem y → preso ANTES de b (decisão 1: não pula etapa)",
    { cond: { x: true, z: true }, status: "a" },
    { derivavel: true, entrada: "entrada", alvo: "a", resultado: "a", fixado: false, primeiraFalha: "b", faltando: ["y"] },
    [
      { para: "c", acao: "bloquear_faltando", status: "a", faltando: ["y"] },
      { para: "b", acao: "bloquear_faltando", status: "a", faltando: ["y"] },
      { para: "a", acao: "nada", status: "a", faltando: [] },
      { para: "entrada", acao: "bloquear_ja_cumprida", status: "a", faltando: [] },
      { para: "stand_by", acao: "fixar", status: "stand_by", faltando: [] },
    ],
  ),
  caso(
    "3. tudo satisfeito → última automática (status atrasado é normalizado)",
    { cond: { x: true, y: true, z: true, w: true }, status: "b" },
    { derivavel: true, entrada: "entrada", alvo: "d", resultado: "d", fixado: false, primeiraFalha: null, faltando: [] },
    [
      { para: "a", acao: "bloquear_ja_cumprida", status: "b", faltando: [] },
      { para: "d", acao: "soltar", status: "d", faltando: [] },
      { para: "stand_by", acao: "fixar", status: "stand_by", faltando: [] },
    ],
  ),
  caso(
    "4. coluna manual no meio é pulada na caminhada",
    { cond: { x: true, y: true, z: true }, status: "c" },
    { derivavel: true, entrada: "entrada", alvo: "c", resultado: "c", fixado: false, primeiraFalha: "d", faltando: ["w"] },
    [
      { para: "d", acao: "bloquear_faltando", status: "c", faltando: ["w"] },
      { para: "a", acao: "bloquear_ja_cumprida", status: "c", faltando: [] },
      { para: "c", acao: "nada", status: "c", faltando: [] },
      { para: "stand_by", acao: "fixar", status: "stand_by", faltando: [] },
      { para: "reprovado", acao: "fixar", status: "reprovado", faltando: [] },
      { para: "entrada", acao: "bloquear_ja_cumprida", status: "c", faltando: [] },
    ],
  ),
  caso(
    "5. fixado em stand_by: não anda sozinho; os 5 arrastes da tabela",
    { cond: { x: true, y: true, z: true }, status: "stand_by" },
    { derivavel: true, entrada: "entrada", alvo: "c", resultado: "stand_by", fixado: true, primeiraFalha: "d", faltando: ["w"] },
    [
      { para: "d", acao: "bloquear_faltando", status: "stand_by", faltando: ["w"] }, // ALÉM da derivada → continua fixado
      { para: "c", acao: "soltar", status: "c", faltando: [] }, // ATÉ a derivada → solta
      { para: "a", acao: "soltar", status: "c", faltando: [] }, // aquém, fixado → solta p/ derivada
      { para: "reprovado", acao: "fixar", status: "reprovado", faltando: [] }, // manual → fixa
      { para: "entrada", acao: "soltar", status: "c", faltando: [] }, // entrada nunca fixa
      { para: "stand_by", acao: "nada", status: "stand_by", faltando: [] },
    ],
  ),
  caso(
    "6. status na entrada NÃO é fixado (entrada é piso, não trava)",
    { cond: { x: true }, status: "entrada" },
    { derivavel: true, entrada: "entrada", alvo: "a", resultado: "a", fixado: false, primeiraFalha: "b", faltando: ["y"] },
    [{ para: "a", acao: "soltar", status: "a", faltando: [] }],
  ),
  caso(
    "7. reprovado é SEMPRE manual: requisito configurado nele é ignorado na cascata",
    { reqs: { ...REQS_A, reprovado: ["q"] }, cond: { x: true, y: true, z: true, w: true }, status: "reprovado" },
    { derivavel: true, entrada: "entrada", alvo: "d", resultado: "reprovado", fixado: true, primeiraFalha: null, faltando: [] },
    [
      { para: "d", acao: "soltar", status: "d", faltando: [] },
      { para: "c", acao: "soltar", status: "d", faltando: [] },
    ],
  ),
  caso(
    "7b. reprovado com requisito: card automático não precisa do requisito de reprovado",
    { reqs: { ...REQS_A, reprovado: ["q"] }, cond: { x: true, y: true, z: true, w: true }, status: "c" },
    { derivavel: true, entrada: "entrada", alvo: "d", resultado: "d", fixado: false, primeiraFalha: null, faltando: [] },
  ),
  caso(
    "8. não derivável (antes da Ordem de Criação): nada muda, arraste é livre",
    { derivavel: false, status: "b", cond: {} },
    { derivavel: false, entrada: "entrada", alvo: null, resultado: "b", fixado: false, primeiraFalha: null, faltando: [] },
    [
      { para: "a", acao: "fixar", status: "a", faltando: [] },
      { para: "b", acao: "nada", status: "b", faltando: [] },
      { para: "zzz", acao: "fora_do_fluxo", status: "b", faltando: [] },
    ],
  ),
  caso(
    "9. lançado (não derivável) preserva o status",
    { derivavel: false, status: "d", cond: { x: true, y: true, z: true, w: true } },
    { derivavel: false, entrada: "entrada", alvo: null, resultado: "d", fixado: false, primeiraFalha: null, faltando: [] },
  ),
  caso(
    "10. exceção não pula coluna (G-inicial #3): C ignora y, mas B ainda exige y",
    { fluxo: ["a", "b", "c"], reqs: { a: ["x"], b: ["y"], c: ["z"] }, exc: { c: ["y"] }, cond: { x: true, z: true }, status: "a" },
    { derivavel: true, entrada: "a", alvo: "a", resultado: "a", fixado: false, primeiraFalha: "b", faltando: ["y"] },
    [{ para: "c", acao: "bloquear_faltando", status: "a", faltando: ["y"] }],
  ),
  caso(
    "11. status órfão (fora do fluxo) não é fixado → vai para a derivada",
    { cond: { x: true }, status: "coluna_velha" },
    { derivavel: true, entrada: "entrada", alvo: "a", resultado: "a", fixado: false, primeiraFalha: "b", faltando: ["y"] },
    [{ para: "a", acao: "soltar", status: "a", faltando: [] }],
  ),
  caso(
    "12. status NULL (recém-chegado) → derivada",
    { cond: { x: true, y: true }, status: null },
    { derivavel: true, entrada: "entrada", alvo: "b", resultado: "b", fixado: false, primeiraFalha: "c", faltando: ["z"] },
  ),
  caso(
    "13. entrada com requisito próprio que falha: fica no piso e é a 1ª falha",
    { fluxo: ["e", "a"], reqs: { e: ["o"], a: ["x"] }, cond: { x: true }, status: null },
    { derivavel: true, entrada: "e", alvo: "e", resultado: "e", fixado: false, primeiraFalha: "e", faltando: ["o"] },
    [{ para: "a", acao: "bloquear_faltando", status: null, faltando: ["o"] }],
  ),
  caso(
    "14. fluxo vazio → não derivável",
    { fluxo: [], reqs: {}, cond: {}, status: "a" },
    { derivavel: false, entrada: null, alvo: null, resultado: "a", fixado: false, primeiraFalha: null, faltando: [] },
    [{ para: "a", acao: "fora_do_fluxo", status: "a", faltando: [] }],
  ),
  caso(
    "15. comprado: fluxo reduzido com cascata própria (sem requisito → fica na entrada)",
    { fluxo: ["em_modelagem", "stand_by", "aprovado"], reqs: { aprovado: ["data_aprovacao"] }, cond: {}, status: "em_modelagem" },
    { derivavel: true, entrada: "em_modelagem", alvo: "em_modelagem", resultado: "em_modelagem", fixado: false, primeiraFalha: "aprovado", faltando: ["data_aprovacao"] },
    [{ para: "aprovado", acao: "bloquear_faltando", status: "em_modelagem", faltando: ["data_aprovacao"] }],
  ),
  caso(
    "15b. comprado com requisito satisfeito → aprovado",
    { fluxo: ["em_modelagem", "stand_by", "aprovado"], reqs: { aprovado: ["data_aprovacao"] }, cond: { data_aprovacao: true }, status: "em_modelagem" },
    { derivavel: true, entrada: "em_modelagem", alvo: "aprovado", resultado: "aprovado", fixado: false, primeiraFalha: null, faltando: [] },
  ),
  caso(
    "16. status com maiúsculas/espaço é normalizado",
    { cond: { x: true, y: true, z: true }, status: " Stand_By " },
    { derivavel: true, entrada: "entrada", alvo: "c", resultado: "stand_by", fixado: true, primeiraFalha: "d", faltando: ["w"] },
  ),
];
```

- [ ] **Step 2: Escrever o teste unit (falhando)**

```ts
// tests/unit/kanban-auto.test.ts
import { describe, it, expect } from "vitest";
import {
  boardDaLoja, colunaManual, derivarModelo, entradaParaDerivacao, fluxoDoModelo, lerKanbanAutoConfig,
  reqsDoModelo, statusDerivado,
} from "@/lib/kanban-auto";
import { CASOS } from "../fixtures/kanban-auto-casos";

describe("kanban-auto — statusDerivado (fixtures compartilhadas com o SQL)", () => {
  for (const c of CASOS) {
    it(c.nome, () => {
      expect(statusDerivado(c.input)).toEqual(c.esperado);
    });
  }
});

describe("kanban-auto — config e fluxo", () => {
  const cfgRaw = {
    kanban_automatico: true,
    status_kanban: ["Em Modelagem", "Stand By", "Em Modelagem", { key: "aprovado", label: "Aprovado" }, 42],
    kanban_requisitos: { em_modelagem: ["modelista_definido"], lixo: "nao-e-array" },
    kanban_requisitos_excecoes: { aprovado: ["modelista_definido"] },
    revenda_kanban_colunas: ["stand_by", "aprovado", 7],
    revenda_kanban_requisitos: { aprovado: ["data_aprovacao"] },
  };

  it("lerKanbanAutoConfig é robusto a lixo e tipos errados", () => {
    const cfg = lerKanbanAutoConfig(cfgRaw);
    expect(cfg.kanban_automatico).toBe(true);
    expect(cfg.kanban_requisitos).toEqual({ em_modelagem: ["modelista_definido"] });
    expect(cfg.kanban_requisitos_excecoes).toEqual({ aprovado: ["modelista_definido"] });
    expect(cfg.revenda_kanban_colunas).toEqual(["stand_by", "aprovado"]);
    expect(lerKanbanAutoConfig(null).kanban_automatico).toBe(false);
    expect(lerKanbanAutoConfig({ kanban_automatico: "true" }).kanban_automatico).toBe(false);
  });

  it("boardDaLoja normaliza e DEDUP por key (fica a 1ª ocorrência)", () => {
    const board = boardDaLoja(lerKanbanAutoConfig(cfgRaw)).map((c) => c.key);
    expect(board).toEqual(["em_modelagem", "stand_by", "aprovado"]);
  });

  it("board vazio → DEFAULT_STATUSES (14 colunas)", () => {
    expect(boardDaLoja(lerKanbanAutoConfig({ status_kanban: [] })).length).toBe(14);
    expect(boardDaLoja(lerKanbanAutoConfig({})).length).toBe(14);
  });

  it("fluxoDoModelo: interno = board; comprado = board ∩ revenda_kanban_colunas ([] = todas)", () => {
    const cfg = lerKanbanAutoConfig(cfgRaw);
    expect(fluxoDoModelo("interno", cfg).map((c) => c.key)).toEqual(["em_modelagem", "stand_by", "aprovado"]);
    expect(fluxoDoModelo("revenda", cfg).map((c) => c.key)).toEqual(["stand_by", "aprovado"]);
    expect(fluxoDoModelo("importado", cfg).map((c) => c.key)).toEqual(["stand_by", "aprovado"]);
    const todas = lerKanbanAutoConfig({ ...cfgRaw, revenda_kanban_colunas: [] });
    expect(fluxoDoModelo("revenda", todas).map((c) => c.key)).toEqual(["em_modelagem", "stand_by", "aprovado"]);
  });

  it("reqsDoModelo: comprado usa revenda_kanban_requisitos e NÃO tem exceções", () => {
    const cfg = lerKanbanAutoConfig(cfgRaw);
    expect(reqsDoModelo("interno", cfg)).toEqual({ reqs: cfg.kanban_requisitos, exc: cfg.kanban_requisitos_excecoes });
    expect(reqsDoModelo("revenda", cfg)).toEqual({ reqs: cfg.revenda_kanban_requisitos, exc: {} });
  });

  it("colunaManual: sem requisito = manual; reprovado SEMPRE manual", () => {
    expect(colunaManual("stand_by", { a: ["x"] })).toBe(true);
    expect(colunaManual("a", { a: ["x"] })).toBe(false);
    expect(colunaManual("reprovado", { reprovado: ["x"] })).toBe(true);
    expect(colunaManual("Reprovado", { reprovado: ["x"] })).toBe(true);
  });

  it("entradaParaDerivacao + derivarModelo montam o input a partir do modelo e da config", () => {
    const cfg = lerKanbanAutoConfig(cfgRaw);
    const modelo = { origem: "revenda", status_desenvolvimento: "stand_by", ordem_criacao_enviada: true, lancado: false };
    const input = entradaParaDerivacao(modelo, cfg, { data_aprovacao: true });
    expect(input).toEqual({
      fluxo: ["stand_by", "aprovado"], reqs: { aprovado: ["data_aprovacao"] }, exc: {}, cond: { data_aprovacao: true },
      status: "stand_by", derivavel: true,
    });
    // stand_by é a ENTRADA do fluxo de comprado → não fixa → vai para aprovado
    expect(derivarModelo(modelo, cfg, { data_aprovacao: true }).resultado).toBe("aprovado");
    expect(derivarModelo({ ...modelo, lancado: true }, cfg, {}).derivavel).toBe(false);
    expect(derivarModelo({ ...modelo, ordem_criacao_enviada: false }, cfg, {}).derivavel).toBe(false);
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `cd "/Users/sunglee/PLM + Criação/plm-pcp" && npx vitest run tests/unit/kanban-auto.test.ts`
Expected: FAIL — `Cannot find module '@/lib/kanban-auto'`.

- [ ] **Step 4: Implementar `src/lib/kanban-auto.ts`**

```ts
/**
 * KANBAN AUTOMÁTICO (F1, set/2026) — espelho TS PURO do motor do banco.
 *
 * Regras normativas: docs/superpowers/plans/2026-09-22-kanban-automatico-f1-banco.md §3.
 * ⚠️ ESPELHO EXATO de `_kanban_derivar_puro` / `_kanban_destino_drop_puro` / `_kanban_fluxo` /
 * `_kanban_status_gate` (migration 20260930130000). O anti-drift (tests/integration/kanban-auto.test.ts)
 * roda as MESMAS fixtures (tests/fixtures/kanban-auto-casos.ts) nos dois lados. Ao mudar aqui, mudar lá.
 *
 * Zero React, zero Supabase. Reusa `requisitosEfetivos` (cascata) e o catálogo de `kanban-condicoes.ts`.
 */
import { CONDICAO_BY_KEY, requisitosEfetivos } from "./kanban-condicoes";
import { normalizeKanbanStatuses, type KanbanStatus } from "./kanban-status";
import { ehOrigemComprada } from "./origem";
import { lerRevendaConfig } from "./revenda-config";

export type KanbanAutoConfig = {
  kanban_automatico: boolean;
  /** `tenant_config.status_kanban` cru (jsonb) — normalizado por `boardDaLoja`. */
  status_kanban: unknown;
  kanban_requisitos: Record<string, string[]>;
  kanban_requisitos_excecoes: Record<string, string[]>;
  revenda_kanban_colunas: string[];
  revenda_kanban_requisitos: Record<string, string[]>;
};

export type DerivacaoInput = {
  /** keys do fluxo do modelo, na ordem, já DEDUP (ver fluxoDoModelo) */
  fluxo: string[];
  reqs: Record<string, string[]>;
  exc: Record<string, string[]>;
  cond: Record<string, boolean>;
  status: string | null;
  derivavel: boolean;
};

export type Derivacao = {
  derivavel: boolean;
  entrada: string | null;
  alvo: string | null;
  resultado: string | null;
  fixado: boolean;
  primeiraFalha: string | null;
  faltando: string[];
};

export type AcaoDrop = "fixar" | "soltar" | "nada" | "bloquear_faltando" | "bloquear_ja_cumprida" | "fora_do_fluxo";
export type DestinoDrop = { acao: AcaoDrop; status: string | null; faltando: string[] };

export type ModeloKanban = {
  origem?: string | null;
  status_desenvolvimento?: string | null;
  ordem_criacao_enviada?: boolean | null;
  lancado?: boolean | null;
};

/** Mesma normalização do SQL: lower(btrim(coalesce(x,''))). */
export function normKey(s: string | null | undefined): string {
  return String(s ?? "").trim().toLowerCase();
}

function mapaListas(raw: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (Array.isArray(v)) out[k] = v.filter((x): x is string => typeof x === "string");
    }
  }
  return out;
}

/** Parse robusto do `tenant_config` cru (tolera nulo, chave faltando, tipo errado). */
export function lerKanbanAutoConfig(tc: any): KanbanAutoConfig {
  const rc = lerRevendaConfig(tc);
  return {
    kanban_automatico: tc?.kanban_automatico === true,
    status_kanban: tc?.status_kanban ?? null,
    kanban_requisitos: mapaListas(tc?.kanban_requisitos),
    kanban_requisitos_excecoes: mapaListas(tc?.kanban_requisitos_excecoes),
    revenda_kanban_colunas: rc.colunas,
    revenda_kanban_requisitos: rc.requisitos,
  };
}

/** Board da loja normalizado (`normalizeKanbanStatuses`) e DEDUP por key (fica a 1ª ocorrência) — ≡ `_kanban_fluxo(cfg,false)`. */
export function boardDaLoja(cfg: KanbanAutoConfig): KanbanStatus[] {
  const vistos = new Set<string>();
  return normalizeKanbanStatuses(cfg.status_kanban).filter((c) => {
    if (vistos.has(c.key)) return false;
    vistos.add(c.key);
    return true;
  });
}

/** Fluxo do modelo: interno = board; comprado = board ∩ revenda_kanban_colunas ([] = todas) — ≡ `_kanban_fluxo(cfg, comprado)`. */
export function fluxoDoModelo(origem: string | null | undefined, cfg: KanbanAutoConfig): KanbanStatus[] {
  const board = boardDaLoja(cfg);
  if (!ehOrigemComprada(origem)) return board;
  const permitidas = cfg.revenda_kanban_colunas;
  if (permitidas.length === 0) return board;
  return board.filter((c) => permitidas.includes(c.key));
}

/** Requisitos/exceções que valem para o modelo (comprado: requisitos próprios e SEM exceções). */
export function reqsDoModelo(
  origem: string | null | undefined,
  cfg: KanbanAutoConfig,
): { reqs: Record<string, string[]>; exc: Record<string, string[]> } {
  return ehOrigemComprada(origem)
    ? { reqs: cfg.revenda_kanban_requisitos, exc: {} }
    : { reqs: cfg.kanban_requisitos, exc: cfg.kanban_requisitos_excecoes };
}

/** Coluna SEM requisito próprio = manual. `reprovado` é SEMPRE manual (regra fixa). */
export function colunaManual(col: string, reqs: Record<string, string[]>): boolean {
  const k = normKey(col);
  return k === "reprovado" || (reqs[k] ?? []).length === 0;
}

/** Requisitos configurados em `reprovado` são ignorados na cascata. */
export function semReprovado(reqs: Record<string, string[]>): Record<string, string[]> {
  const { reprovado: _r, ...resto } = reqs;
  return resto;
}

/** ≡ `_kanban_derivar_puro`. Caminha as colunas AUTOMÁTICAS na ordem e PARA na primeira que falha. */
export function statusDerivado(input: DerivacaoInput): Derivacao {
  const fluxo = input.fluxo;
  const st = normKey(input.status);
  if (fluxo.length === 0 || !input.derivavel) {
    return { derivavel: false, entrada: fluxo[0] ?? null, alvo: null, resultado: input.status ?? null, fixado: false, primeiraFalha: null, faltando: [] };
  }
  const reqs = semReprovado(input.reqs);
  const entrada = fluxo[0];
  let alvo = entrada;
  let primeiraFalha: string | null = null;
  let faltando: string[] = [];
  for (const col of fluxo) {
    if (colunaManual(col, input.reqs)) continue;
    const efetivos = requisitosEfetivos(col, fluxo, reqs, input.exc);
    faltando = efetivos.filter((k) => !input.cond[k]);
    if (faltando.length > 0) { primeiraFalha = col; break; }
    alvo = col;
  }
  if (!primeiraFalha) faltando = [];
  const fixado = st !== "" && fluxo.includes(st) && st !== entrada && colunaManual(st, input.reqs);
  return { derivavel: true, entrada, alvo, resultado: fixado ? st : alvo, fixado, primeiraFalha, faltando };
}

/** Monta o input da derivação a partir do modelo + config + mapa de condições do core. */
export function entradaParaDerivacao(modelo: ModeloKanban, cfg: KanbanAutoConfig, cond: Record<string, boolean>): DerivacaoInput {
  const { reqs, exc } = reqsDoModelo(modelo.origem, cfg);
  return {
    fluxo: fluxoDoModelo(modelo.origem, cfg).map((c) => c.key),
    reqs,
    exc,
    cond: cond ?? {},
    status: modelo.status_desenvolvimento ?? null,
    derivavel: modelo.ordem_criacao_enviada === true && modelo.lancado !== true,
  };
}

export function derivarModelo(modelo: ModeloKanban, cfg: KanbanAutoConfig, cond: Record<string, boolean>): Derivacao {
  return statusDerivado(entradaParaDerivacao(modelo, cfg, cond));
}

/** ≡ `_kanban_faltando_para`: união (dedup, em ordem) dos efetivos NÃO satisfeitos das colunas AUTOMÁTICAS
 *  de `primeiraFalha` até `para` (inclusive). Com exceção, `para` sozinho pode estar satisfeito e ainda faltar algo antes. */
export function faltandoPara(input: DerivacaoInput, para: string): string[] {
  const d = statusDerivado(input);
  if (!d.derivavel || !d.primeiraFalha) return [];
  const fluxo = input.fluxo;
  const ini = fluxo.indexOf(d.primeiraFalha);
  const fim = fluxo.indexOf(normKey(para));
  if (ini < 0 || fim < 0 || fim < ini) return [];
  const reqs = semReprovado(input.reqs);
  const out: string[] = [];
  for (let i = ini; i <= fim; i++) {
    const col = fluxo[i];
    if (colunaManual(col, input.reqs)) continue;
    for (const k of requisitosEfetivos(col, fluxo, reqs, input.exc)) {
      if (!input.cond[k] && !out.includes(k)) out.push(k);
    }
  }
  return out;
}

/** ≡ `_kanban_destino_drop_puro`. Tabela única de arraste (plano §3), na MESMA ordem de avaliação do SQL. */
export function destinoDrop(input: DerivacaoInput, para: string): DestinoDrop {
  const fluxo = input.fluxo;
  const p = normKey(para);
  const st = normKey(input.status);
  const atual = input.status ?? null;
  const idxPara = fluxo.indexOf(p);
  if (idxPara < 0) return { acao: "fora_do_fluxo", status: atual, faltando: [] };
  const d = statusDerivado(input);
  if (!d.derivavel) return p === st ? { acao: "nada", status: atual, faltando: [] } : { acao: "fixar", status: p, faltando: [] };
  const alvo = d.alvo as string;
  const idxAlvo = fluxo.indexOf(alvo);
  if (p === d.entrada) {
    if (d.fixado) return { acao: "soltar", status: alvo, faltando: [] };
    if (idxAlvo === 0) return st === alvo ? { acao: "nada", status: atual, faltando: [] } : { acao: "soltar", status: alvo, faltando: [] };
    return { acao: "bloquear_ja_cumprida", status: atual, faltando: [] };
  }
  if (colunaManual(p, input.reqs)) return p === st ? { acao: "nada", status: atual, faltando: [] } : { acao: "fixar", status: p, faltando: [] };
  if (idxPara > idxAlvo) return { acao: "bloquear_faltando", status: atual, faltando: faltandoPara(input, p) };
  if (idxPara < idxAlvo) return d.fixado ? { acao: "soltar", status: alvo, faltando: [] } : { acao: "bloquear_ja_cumprida", status: atual, faltando: [] };
  if (d.fixado) return { acao: "soltar", status: alvo, faltando: [] };
  return st === alvo ? { acao: "nada", status: atual, faltando: [] } : { acao: "soltar", status: alvo, faltando: [] };
}

/** Mensagem PT-BR para o usuário (labels do catálogo). `null` quando a ação não bloqueia. */
export function mensagemDrop(d: DestinoDrop, para: string, fluxo: KanbanStatus[]): string | null {
  const labelCol = fluxo.find((c) => c.key === normKey(para))?.label ?? para;
  if (d.acao === "bloquear_faltando") {
    const labels = d.faltando.map((k) => CONDICAO_BY_KEY.get(k)?.label ?? k);
    const n = labels.length;
    return n === 1 ? `Falta 1 dado para completar: ${labels[0]}` : `Faltam ${n} dados para completar: ${labels.join(", ")}`;
  }
  if (d.acao === "bloquear_ja_cumprida") return `O card já cumpre "${labelCol}". Para segurá-lo numa etapa, use uma coluna manual.`;
  if (d.acao === "fora_do_fluxo") return `A etapa "${para}" não faz parte do fluxo deste modelo.`;
  return null;
}

/** ≡ `_kanban_status_gate`: status a usar nos gates por posição (Enviar à Explosão, revelar REF — decisão 10).
 *  Chave desligada ou card não derivável ⇒ o status gravado; senão a posição DERIVADA (`alvo`). */
export function statusParaGate(ligado: boolean, derivacao: Derivacao | null | undefined, statusAtual: string | null | undefined): string | null {
  if (!ligado || !derivacao || !derivacao.derivavel || !derivacao.alvo) return statusAtual ?? null;
  return derivacao.alvo;
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run tests/unit/kanban-auto.test.ts`
Expected: PASS (17 casos de derivação + 7 de config/fluxo).

- [ ] **Step 6: Gates + commit**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp" && npx tsc --noEmit 2>&1 | grep -E "kanban-auto|TS2304" ; npm run build 2>&1 | tail -2
git add -- src/lib/kanban-auto.ts tests/fixtures/kanban-auto-casos.ts tests/unit/kanban-auto.test.ts
git commit --only -m "feat(kanban-auto): espelho TS puro da derivação + fixtures compartilhadas (F1)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- src/lib/kanban-auto.ts tests/fixtures/kanban-auto-casos.ts tests/unit/kanban-auto.test.ts
```

---

### Task 2: `destinoDrop`, `faltandoPara`, `mensagemDrop` — testes

**Files:**
- Modify: `tests/unit/kanban-auto.test.ts` (acrescentar)
- (código já está em `src/lib/kanban-auto.ts` — Task 1; esta task TRAVA a tabela de arraste com as fixtures)

**Interfaces:**
- Consumes: `destinoDrop(input, para): DestinoDrop`, `faltandoPara(input, para): string[]`, `mensagemDrop(d, para, fluxo): string|null`, `CASOS[].arrastes`.

- [ ] **Step 1: Acrescentar os testes (falhando só se a implementação divergir das fixtures)**

```ts
// tests/unit/kanban-auto.test.ts — APPEND
import { destinoDrop, faltandoPara, mensagemDrop } from "@/lib/kanban-auto";
import { FLUXO_A, REQS_A } from "../fixtures/kanban-auto-casos";

describe("kanban-auto — destinoDrop (tabela única de arraste, fixtures compartilhadas)", () => {
  for (const c of CASOS) {
    for (const a of c.arrastes) {
      it(`${c.nome} → arrastar para "${a.para}" = ${a.acao}`, () => {
        expect(destinoDrop(c.input, a.para)).toEqual({ acao: a.acao, status: a.status, faltando: a.faltando });
      });
    }
  }

  it("faltandoPara: com exceção, junta o que falta nas colunas anteriores (não pula etapa)", () => {
    const input = { fluxo: ["a", "b", "c"], reqs: { a: ["x"], b: ["y"], c: ["z"] }, exc: { c: ["y"] }, cond: { x: true, z: true }, status: "a", derivavel: true };
    expect(faltandoPara(input, "c")).toEqual(["y"]);
    expect(faltandoPara(input, "a")).toEqual([]); // antes da 1ª falha
    expect(faltandoPara({ ...input, cond: { x: true, y: true, z: true } }, "c")).toEqual([]); // nada falha
  });

  it("faltandoPara dedup e ordem de aparição", () => {
    const input = { fluxo: FLUXO_A, reqs: { ...REQS_A, c: ["z", "x"] }, exc: {}, cond: {}, status: null, derivavel: true };
    expect(faltandoPara(input, "c")).toEqual(["x", "y", "z"]);
  });
});

describe("kanban-auto — mensagemDrop (labels do catálogo, plural PT-BR)", () => {
  const fluxo = [{ key: "em_modelagem", label: "Em Modelagem" }, { key: "aprovado", label: "Aprovado" }];
  it("1 dado → singular com o label do catálogo", () => {
    expect(mensagemDrop({ acao: "bloquear_faltando", status: null, faltando: ["data_piloto1"] }, "aprovado", fluxo))
      .toBe("Falta 1 dado para completar: Data de Piloto I preenchida");
  });
  it("N dados → plural, labels na ordem", () => {
    expect(mensagemDrop({ acao: "bloquear_faltando", status: null, faltando: ["data_piloto1", "modelista_definido"] }, "aprovado", fluxo))
      .toBe("Faltam 2 dados para completar: Data de Piloto I preenchida, Modelista definido");
  });
  it("key desconhecida cai na própria key", () => {
    expect(mensagemDrop({ acao: "bloquear_faltando", status: null, faltando: ["xyz"] }, "aprovado", fluxo)).toBe("Falta 1 dado para completar: xyz");
  });
  it("já cumpre usa o label da coluna; fora do fluxo usa a key; demais ações → null", () => {
    expect(mensagemDrop({ acao: "bloquear_ja_cumprida", status: "x", faltando: [] }, "em_modelagem", fluxo))
      .toBe('O card já cumpre "Em Modelagem". Para segurá-lo numa etapa, use uma coluna manual.');
    expect(mensagemDrop({ acao: "fora_do_fluxo", status: "x", faltando: [] }, "zzz", fluxo)).toBe('A etapa "zzz" não faz parte do fluxo deste modelo.');
    expect(mensagemDrop({ acao: "fixar", status: "x", faltando: [] }, "em_modelagem", fluxo)).toBeNull();
    expect(mensagemDrop({ acao: "soltar", status: "x", faltando: [] }, "em_modelagem", fluxo)).toBeNull();
    expect(mensagemDrop({ acao: "nada", status: "x", faltando: [] }, "em_modelagem", fluxo)).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar**

Run: `npx vitest run tests/unit/kanban-auto.test.ts`
Expected: PASS (todos os arrastes das fixtures batem com a tabela §3). Se algum falhar, a FIXTURE é a referência normativa — corrigir `destinoDrop`, não a fixture, a menos que a fixture contradiga o §3 (aí corrigir a fixture e registrar no relatório).

- [ ] **Step 3: Commit**

```bash
git commit --only -m "test(kanban-auto): trava a tabela única de arraste e as mensagens PT-BR

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- tests/unit/kanban-auto.test.ts
```

---

### Task 3: `GateOpts` em `podeEnviarExplosao`/`refCampoVisivel` + `statusParaGate`

**Files:**
- Modify: `src/lib/kanban-status.ts:55-112`
- Modify: `tests/unit/kanban-status.test.ts` (acrescentar 1 `describe`)
- Modify: `tests/unit/kanban-auto.test.ts` (acrescentar 1 `describe`)

**Interfaces:**
- Produces: `export type GateOpts = { statusGate?: string | null }`; `podeEnviarExplosao(statusKanbanRaw, explosaoEnvioStatus, statusDesenvolvimento, opts?: GateOpts)`; `refCampoVisivel(statusKanbanRaw, refExibirStatus, statusDesenvolvimento, opts?: GateOpts)`. Chamadas atuais (3 parâmetros) continuam idênticas. F2 passa `{ statusGate: statusParaGate(cfg.kanban_automatico, derivacao, status) }`.

- [ ] **Step 1: Testes (falhando)**

```ts
// tests/unit/kanban-status.test.ts — APPEND
describe("podeEnviarExplosao/refCampoVisivel — opts.statusGate (decisão 10: posição DERIVADA com a chave ligada)", () => {
  const board = ["Desenho Técnico", "Em Negociação", "Em Modelagem", "Stand By", "Aprovado"];
  it("sem opts: régua pelo status gravado (comportamento de hoje)", () => {
    expect(podeEnviarExplosao(board, "em_modelagem", "stand_by").ok).toBe(true);
    expect(refCampoVisivel(board, "em_modelagem", "stand_by")).toBe(true);
  });
  it("com statusGate: a régua usa a posição derivada, não a coluna manual onde o card está fixado", () => {
    expect(podeEnviarExplosao(board, "em_modelagem", "stand_by", { statusGate: "em_negociacao" }).ok).toBe(false);
    expect(refCampoVisivel(board, "em_modelagem", "stand_by", { statusGate: "em_negociacao" })).toBe(false);
    expect(podeEnviarExplosao(board, "em_modelagem", "desenho_tecnico", { statusGate: "aprovado" }).ok).toBe(true);
  });
  it("statusGate nulo/vazio é ignorado", () => {
    expect(podeEnviarExplosao(board, "em_modelagem", "stand_by", { statusGate: null }).ok).toBe(true);
    expect(podeEnviarExplosao(board, "em_modelagem", "stand_by", { statusGate: "  " }).ok).toBe(true);
    expect(podeEnviarExplosao(board, "em_modelagem", "stand_by", {}).ok).toBe(true);
  });
});
```

```ts
// tests/unit/kanban-auto.test.ts — APPEND
import { statusParaGate } from "@/lib/kanban-auto";

describe("kanban-auto — statusParaGate (≡ _kanban_status_gate)", () => {
  const d = { derivavel: true, entrada: "a", alvo: "c", resultado: "stand_by", fixado: true, primeiraFalha: null, faltando: [] };
  it("chave desligada → status gravado", () => expect(statusParaGate(false, d, "stand_by")).toBe("stand_by"));
  it("chave ligada + derivável → alvo (posição derivada)", () => expect(statusParaGate(true, d, "stand_by")).toBe("c"));
  it("não derivável / sem derivação → status gravado", () => {
    expect(statusParaGate(true, { ...d, derivavel: false, alvo: null }, "stand_by")).toBe("stand_by");
    expect(statusParaGate(true, null, "stand_by")).toBe("stand_by");
    expect(statusParaGate(true, null, undefined)).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/unit/kanban-status.test.ts tests/unit/kanban-auto.test.ts`
Expected: FAIL nos 3 novos testes de `statusGate` (o 4º argumento é ignorado hoje).

- [ ] **Step 3: Implementar em `src/lib/kanban-status.ts`**

Substituir a assinatura e o cálculo de `status` em `podeEnviarExplosao` (linhas 69-96) e `refCampoVisivel` (106-112) por:

```ts
/** Opções dos gates por posição (Kanban automático, decisão 10): quando `statusGate` vem preenchido, a
 *  régua usa ELE (posição DERIVADA do card) em vez de `statusDesenvolvimento` (coluna onde está gravado).
 *  Calcule com `statusParaGate(cfg.kanban_automatico, derivacao, status)` de `kanban-auto.ts`
 *  (≡ `_kanban_status_gate` no SQL). Ausente/vazio ⇒ comportamento histórico. */
export type GateOpts = { statusGate?: string | null };

export function podeEnviarExplosao(
  statusKanbanRaw: any,
  explosaoEnvioStatus: string | null | undefined,
  statusDesenvolvimento: string | null | undefined,
  opts?: GateOpts,
): ExplosaoEnvioGate {
  const rows = normalizeKanbanStatuses(statusKanbanRaw); // {key,label}[] em ordem
  const keys = rows.map((r) => r.key);
  const labelOf = (k: string) =>
    rows.find((r) => r.key === k)?.label ??
    DEFAULT_STATUSES.find((s) => s.key === k)?.label ??
    k;

  let reqKey = String(explosaoEnvioStatus ?? "").trim() || APROVADO_KEY;
  let cfgIdx = keys.indexOf(reqKey);
  if (cfgIdx < 0 && reqKey !== APROVADO_KEY) {
    reqKey = APROVADO_KEY; // órfã → fallback 'aprovado'
    cfgIdx = keys.indexOf(APROVADO_KEY);
  }
  const reqLabel = labelOf(reqKey);
  const gate = String(opts?.statusGate ?? "").trim();
  const status = (gate !== "" ? gate : String(statusDesenvolvimento ?? "").trim()).toLowerCase();
  const curIdx = keys.indexOf(status);

  let ok: boolean;
  if (cfgIdx < 0) ok = status === reqKey; // board sem a etapa exigida nem 'aprovado'
  else if (curIdx < 0) ok = status === reqKey; // status do modelo fora do board
  else ok = curIdx >= cfgIdx;
  return { ok, reqKey, reqLabel };
}

export function refCampoVisivel(
  statusKanbanRaw: any,
  refExibirStatus: string | null | undefined,
  statusDesenvolvimento: string | null | undefined,
  opts?: GateOpts,
): boolean {
  return podeEnviarExplosao(statusKanbanRaw, refExibirStatus, statusDesenvolvimento, opts).ok;
}
```

(Manter os comentários JSDoc existentes acima de cada função; só a assinatura e as 2 linhas de `status` mudam.)

- [ ] **Step 4: Rodar e ver passar; confirmar que nenhuma chamada existente quebrou**

Run: `npx vitest run tests/unit/kanban-status.test.ts tests/unit/kanban-auto.test.ts && npx tsc --noEmit 2>&1 | grep -E "error" ; grep -rn "podeEnviarExplosao(\|refCampoVisivel(" src --include=*.ts --include=*.tsx | grep -v "src/lib/kanban-status.ts" | wc -l`
Expected: PASS; `tsc` sem erro novo; a contagem de chamadas é só informativa (todas com 3 args seguem válidas).

- [ ] **Step 5: Commit**

```bash
git commit --only -m "feat(kanban-status): opts.statusGate nos gates por posição (decisão 10) + statusParaGate

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- src/lib/kanban-status.ts tests/unit/kanban-status.test.ts tests/unit/kanban-auto.test.ts
```

---

## 4. Errata das Tasks 1–3 — ✅ JÁ APLICADA nas tasks (23/set, orquestrador); mantida só como registro

- **E1 — chaves MAIÚSCULAS em 2 testes contradizem o §3 ("chaves de status sempre `lower(btrim(...))`").** A fixture `10.` de `tests/fixtures/kanban-auto-casos.ts` e o 1º teste do `describe` de `faltandoPara` da Task 2 usam `fluxo: ["A","B","C"]` com `reqs: { A: …, B: …, C: … }`. `colunaManual` normaliza a coluna (`reqs["a"]` → `undefined` → MANUAL) e `destinoDrop` normaliza o `para` (`"c"` não está em `["A","B","C"]`), então o TS da Task 1 devolve `primeiraFalha: null` / `fora_do_fluxo` e a Task 1 Step 5 FALHA (provado 23/set rodando o TS da Task 1 contra as fixtures: só o caso 10 diverge). Pela regra da Task 2 Step 2 (a fixture contradiz o §3 → corrigir a fixture), trocar para minúsculas — no caso 10:
  ```ts
  caso(
    "10. exceção não pula coluna (G-inicial #3): C ignora y, mas B ainda exige y",
    { fluxo: ["a", "b", "c"], reqs: { a: ["x"], b: ["y"], c: ["z"] }, exc: { c: ["y"] }, cond: { x: true, z: true }, status: "a" },
    { derivavel: true, entrada: "a", alvo: "a", resultado: "a", fixado: false, primeiraFalha: "b", faltando: ["y"] },
    [{ para: "c", acao: "bloquear_faltando", status: "a", faltando: ["y"] }],
  ),
  ```
  e, no teste `faltandoPara: com exceção…` da Task 2: `const input = { fluxo: ["a", "b", "c"], reqs: { a: ["x"], b: ["y"], c: ["z"] }, exc: { c: ["y"] }, cond: { x: true, z: true }, status: "a", derivavel: true };` com `faltandoPara(input, "c")` → `["y"]`, `faltandoPara(input, "a")` → `[]` e o 3º `expect` com `"c"`. As Tasks 8/9 (anti-drift SQL) assumem as fixtures JÁ corrigidas.
- **E2 — `git commit --only -- <arquivo NOVO>` falha** (`pathspec … did not match any file(s) known to git`). Antes do commit, `git add -- <só os arquivos novos da task>` (nunca `git add .`). Vale para a Task 1 e para toda task abaixo que cria arquivo (os blocos de commit já trazem o `git add --`).
- **E3 — co-autoria.** As Tasks 4–18 foram escritas no Opus (limite do Fable; decisão do dono 23/set) e os commits delas terminam com `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. As Tasks 1–3 mantêm a linha delas.

## 5. Decisões de desenho das Tasks 4–18 que o §3 NÃO fixava — situação depois do G-plano (23/set)

A 1ª versão foi validada em `BEGIN…ROLLBACK` no banco de produção em 23/set (60 testes) — o que o dono proibiu depois do incidente do mesmo dia (decisão 17). Esta revisão foi re-validada SÓ na CÓPIA LOCAL: suíte com as decisões 14–17 e as ressalvas R1–R8 = 67 testes do kanban-auto verdes com `KANBAN_AUTO_MIG_TXN=1` (+1 do anti-drift de condições; ~3,3 s); ensaio de aplicação real (Task 18 Step 1) com a volta a 427 funções / 219 gatilhos. Situação de cada decisão: **mantida**, **alterada** (decisão do dono), **resolvida** ou **eliminada**.

- **D1 — mantida.** `kanban_snapshot` e `kanban_recalculo_fila` SEM policy nenhuma (RLS ligada + `REVOKE ALL` de PUBLIC/anon/authenticated). Toda leitura é por RPC `SECURITY DEFINER` só-admin (prévias); uma policy de SELECT sem GRANT seria código morto e, se alguém desse GRANT depois, exporia o snapshot a não-admins.
- **D2 — mantida.** `kanban_previa_restauracao(_lote_id uuid DEFAULT NULL)`: `NULL` = o lote `'ligar'` mais recente ainda não restaurado (a F2 descobre o lote sem ler a tabela). `kanban_restaurar(_lote_id)` exige o id explícito (vem da prévia).
- **D3 — mantida.** `kanban_mover` com a chave DESLIGADA → `P0001 'O Kanban automático está desligado nesta loja.'` A RPC nunca muda status com a chave desligada (o board F2 usa o caminho de hoje nesse caso).
- **D4 — ALTERADA (decisão 15 do dono, 23/set; G-plano R6): `kanban_mover` NÃO toca `motivo_cancelamento`** ao sair de `reprovado` — o motivo fica guardado e só aparece quando o card está em Reprovado. O arraste passa a ser idêntico ao de hoje nesse ponto (quem limpa o motivo continua sendo só o Salvar do Sheet do Dev). SQL e teste invertidos (Task 15).
- **D5 — mantida.** O guard SEMPRE re-enfileira o card quando age (chave ligada, GUC vazio, derivável, status mudou): sem enfileirar, nada re-derivaria (status não está no WHEN do enfileirador); o guard lê o estado ANTES do UPDATE e o COMMIT corrige com o estado final.
- **D6 — mantida** (e vale para a RPC nova): erro no gatilho da Config PROPAGA — o save da Config (ou o `kanban_definir_automatico`) falha e nada muda: nem chave, nem snapshot, nem status. Só a FILA engole o erro com `WARNING`.
- **D7 — mantida.** `modelo_kanban_historico.created_at = clock_timestamp()` nas linhas NOVAS (e na colapsada pela janela) — desempate dentro da mesma txn. A restauração e o "movido à mão depois do lote" comparam `created_at` com `kanban_snapshot.criado_at` (também relógio). O Leadtime continua ordenando por `entrou_at`.
- **D8 — mantida, simplificada:** `_kanban_aplicar(_tenant, _ids, _origem, _lote uuid DEFAULT NULL)`; `_origem` só `'auto'|'config'` (senão `P0001`); devolve quantos cards MUDARAM de coluna. Pela decisão 14 ele não lê mais o histórico nem escreve `revisao_pendente`.
- **D9 — mantida.** Enfileirador só põe na fila card DERIVÁVEL de loja com a chave ligada.
- **D10 — mantida.** `categorias_terceirizado`: 2 gatilhos POR LINHA (UPDATE com `WHEN` em etapa/nome/ativo + DELETE).
- **D11 — mantida e AMPLIADA (R4).** `kanban_previa_recalculo(_cfg)` calcula como se a chave estivesse ligada; lê de `_cfg` só as 6 chaves de kanban; população = quadro do Dev; "coluna efetiva" = a que o quadro mostra. Agora devolve também `revelam_ref`, `refs_reveladas` e `avisos` (critério no §3). Card sem `ref_auto` não entra na lista: o motor só copia `ref_auto → ref` (quem gera `ref_auto` é a chegada ao Dev, com sigla).
- **D12 — RESOLVIDA (decisão 17 do dono, 23/set; resolve o B1 do G-plano).** Testes com DDL só na cópia local: `prepara` LANÇA erro fora dela; os testes que fazem DDL por conta própria (sonda do harness — Task 4; sabotagem de função — Task 11; gatilho de log — Task 12) e o que escreve numa loja real (R7 — Task 15) usam `skipIf(!LOCAL)`; todo comando "Run" com `KANBAN_AUTO_MIG_TXN=1` leva `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres`; produção só recebe a aplicação final (Task 18), com `lock_timeout` e `pg_stat_activity` (R1).
- **D13 — ELIMINADA (decisão 14).** Sem `#Erro` automático não há ponto cego de janela.
- **D14 — RESOLVIDA (dono, 23/set): não inserir** a linha `restauracao` quando a última linha restante do modelo já tem o mesmo status (`fn_kanban_historico`, Task 10; provado nas Tasks 10 e 16).
- **D15 — mantida.** Guard + card COMPRADO com status NULL e 1ª coluna fora do fluxo de revenda → `P0001` (estado que o motor não deixa existir).
- **D16 — mantida.** `_kanban_status_rows_raw` preserva 2 divergências TS×SQL PRÉ-EXISTENTES só de LABEL; só a KEY entra na derivação.
- **D17 — mantida + R7.** Derivação da Ave Rara ~0,45 s no banco real (com `OFFSET 0`; teste < 3 s — Task 9). **R7**: LIGAR a Ave Rara pela RPC (snapshot + recálculo + gatilhos de `modelos`, 246 cards deriváveis) medido na cópia local = **218–229 ms** (5 rodadas; 102 cards mudam de coluna; snapshot de 246 linhas). A derivação sozinha levou 122–136 ms na cópia × ~450 ms no banco real (23/set), então a estimativa em produção é ~1 s — folga de ~5× sobre o critério do teste (Task 15): **< 5 s**. Passou; nenhuma otimização necessária.
- **D18 — nova (decisão 16; G-plano R3): trava da chave.** GUC `app.kanban_chave='rpc'` + `trg_kanban_chave_protegida` BEFORE INSERT OR UPDATE em `tenant_config`, sem lista de colunas e sem `WHEN` (gatilho que também é de INSERT não pode citar `OLD` no `WHEN`); ordena depois de `set_tenant_id_trg`. Mora na migration 3 (o inverso 3 a derruba) e a RPC na 4 — entre as duas aplicações ninguém liga a chave.
- **D19 — nova (decisão 16): contrato de `kanban_definir_automatico(_ligar boolean) → jsonb {ligado, mudou, lote_id, snapshot, cards_movidos}`.** Guardas iguais às das prévias (não autenticado / módulo `criacao` / não admin / loja inativa → `42501`; `_ligar` nulo → `P0001`; loja sem `tenant_config` → `P0002`); tenant = `get_user_tenant_id()`; `FOR UPDATE` na linha da config; idempotente (mesmo valor → `mudou=false`, nada grava); `lote_id`/`snapshot`/`cards_movidos` só ao LIGAR (desligar não grava nada — §3); restaura o GUC anterior.
- **D20 — nova (consequência da decisão 14): `#Erro` LEGADO com a chave ligada** não é apagado pelo motor quando o card anda; fica até alguém revisar (`kanban_mover` fixar/soltar/nada, ou o arraste/Salvar de hoje, que chamam `marcar_etapa_verificada`).
- **D21 — nova (decisão 17): em produção a verificação pós-apply é SÓ LEITURA.** A suíte de integração roda no ensaio da cópia local (Task 18 Step 1), sobre os MESMOS arquivos; em produção o Step 7 confere contagens, ACL (`has_function_privilege`), md5 das 5 funções = md5 do ensaio, chave desligada, retrato idêntico, e a prévia por loja em `BEGIN…ROLLBACK` (função STABLE, sem DDL). A 1ª versão rodava a suíte contra produção depois do apply; agora o harness nem conecta lá (`migracoesJaAplicadas` só olha a cópia local).

---

### Task 4: Harness de integração — `prepara` aplica as migrations DENTRO da txn revertida

**Files:**
- Create: `tests/integration/kanban-auto.test.ts`

**Interfaces:**
- Consumes: `hasDb`, `dbUrl`, `withTx`, `comoUsuario`, `um`, `TENANT_TESTE`, `USER_TESTE`, `ehBancoLocal` (`tests/integration/db.ts`, commit `9d39d3c`); `CASOS` (`tests/fixtures/kanban-auto-casos.ts`, Task 1, já com a errata E1); `boardDaLoja`, `derivarModelo`, `destinoDrop`, `faltandoPara`, `fluxoDoModelo`, `lerKanbanAutoConfig`, `statusDerivado` (`src/lib/kanban-auto.ts`, Task 1); `normalizeKanbanStatuses` (`src/lib/kanban-status.ts`). Os imports ficam TODOS no topo desde já (as Tasks 5–17 só acrescentam blocos no fim do arquivo).
- Produces (escopo do módulo de teste, usado pelas Tasks 5–17): `MIG_TXN: boolean` (`KANBAN_AUTO_MIG_TXN === "1"`); `LOCAL: boolean` (= `ehBancoLocal()`); `SSL` (`false` na cópia local, `{ rejectUnauthorized: false }` fora dela) p/ todo `Client` aberto fora do `withTx`; `exigeBancoLocal(local = LOCAL): void` (lança o erro "DDL/migration só na cópia local — ver banco-local …"); `MIGRACOES` (4 caminhos, na ordem); `INVERSOS: {1..4: caminho}`; `RE_BEGIN`/`RE_COMMIT`/`RE_NOTIFY` (sem flag `g`) + `todas(re)`; `semTransacao(sql: string, nome: string): string`; `aplicarSql(c: Client, sql: string, nome: string): Promise<void>`; `aplicarArquivo(c: Client, rel: string): Promise<void>`; `prepara(c: Client, ate?: 1|2|3|4): Promise<void>` (com `MIG_TXN`: `exigeBancoLocal()` ANTES de qualquer comando; depois timeouts + migrations 1..ate); `PRONTO: boolean` (= `hasDb && (MIG_TXN || kanban_mover já existe NA CÓPIA LOCAL)` — contra produção a suíte do motor nunca roda, nem depois do apply: D21).
- Regra: com `KANBAN_AUTO_MIG_TXN=1` os testes aplicam o CONTEÚDO dos arquivos (sem `BEGIN;`/`COMMIT;`/`pg_notify`) dentro do `withTx`, e SÓ na cópia local (decisão 17 — `prepara` recusa outro banco); sem a variável, só rodam onde as migrations já foram aplicadas (ensaio da Task 18 na cópia local). Teste que faz DDL fora do `prepara` ou escreve numa loja real usa `skipIf(!LOCAL)`. NUNCA `\i`.

- [ ] **Step 1: Criar o arquivo com o cabeçalho, os imports e os testes do harness (ainda sem o harness)**

```ts
/**
 * KANBAN AUTOMÁTICO — F1 (banco). Integração em BEGIN…ROLLBACK: NADA é gravado.
 * Plano: docs/superpowers/plans/2026-09-22-kanban-automatico-f1-banco.md (Tasks 4–17, §3).
 *
 * HARNESS (Task 4). Com KANBAN_AUTO_MIG_TXN=1, `prepara(c, n)` aplica as migrations
 * 20260930120000…150000 (1..n) DENTRO da transação do `withTx`, tirando as linhas `BEGIN;`/`COMMIT;`
 * e o `pg_notify` do arquivo — NUNCA `\i` (o COMMIT do arquivo fecharia a txn e VAZARIA: incidente
 * 15/set). Sem a variável, as migrations precisam já estar aplicadas (ensaio da Task 18 na cópia
 * local) e `prepara` só ajusta os timeouts. Sem banco, a suíte se auto-pula.
 *
 * ⚠️ DDL SÓ NA CÓPIA LOCAL (decisão 17 do dono, 23/set). DDL dentro da txn segura locks até o
 * ROLLBACK — ACCESS EXCLUSIVE em tenant_config, que as policies RLS de TODAS as lojas leem: o app
 * inteiro para (incidente 23/set). Com KANBAN_AUTO_MIG_TXN=1, `prepara` LANÇA erro se o banco não é
 * a cópia local (DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres); teste que faz
 * DDL por conta própria ou escreve numa loja real usa `skipIf(!LOCAL)`.
 *
 * O recálculo do motor é ADIADO para o COMMIT (constraint trigger deferred) e o COMMIT nunca
 * acontece aqui: `imediato(c)` = SET CONSTRAINTS ALL IMMEDIATE (dispara os pendentes) + DEFERRED.
 */
import { describe, it, expect } from "vitest";
import { Client } from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { hasDb, dbUrl, withTx, comoUsuario, um, TENANT_TESTE, USER_TESTE, ehBancoLocal } from "./db";
import { CASOS } from "../fixtures/kanban-auto-casos";
import {
  boardDaLoja, derivarModelo, destinoDrop, faltandoPara, fluxoDoModelo, lerKanbanAutoConfig, statusDerivado,
} from "../../src/lib/kanban-auto";
import { normalizeKanbanStatuses } from "../../src/lib/kanban-status";

describe("kanban-auto — harness: semTransacao (Task 4)", () => {
  const MIG = [
    "-- cabeçalho que cita BEGIN e COMMIT em comentário",
    "BEGIN;",
    "CREATE OR REPLACE FUNCTION public._kanban_harness_probe() RETURNS int LANGUAGE plpgsql AS $function$",
    "BEGIN",
    "  RETURN 1;",
    "END;",
    "$function$;",
    "DO $do$ BEGIN PERFORM 1; END $do$;",
    "COMMIT;",
    "",
    "select pg_notify('pgrst', 'reload schema');",
  ].join("\n");

  it("tira BEGIN;/COMMIT;/pg_notify de linha própria e preserva o BEGIN/END do plpgsql", () => {
    const out = semTransacao(MIG, "probe");
    expect(out).not.toMatch(RE_BEGIN);
    expect(out).not.toMatch(RE_COMMIT);
    expect(out).not.toMatch(RE_NOTIFY);
    expect(out).toContain("BEGIN\n  RETURN 1;\nEND;");
    expect(out).toContain("DO $do$ BEGIN PERFORM 1; END $do$;");
  });

  it("recusa arquivo sem BEGIN/COMMIT, com 2 COMMIT ou com controle de transação solto", () => {
    expect(() => semTransacao("CREATE TABLE x();", "a")).toThrow(/esperado 1/);
    expect(() => semTransacao("BEGIN;\nCOMMIT;\nCOMMIT;", "b")).toThrow(/esperado 1/);
    expect(() => semTransacao("BEGIN;\nROLLBACK;\nCOMMIT;", "c")).toThrow(/controle de transação/);
    expect(() => semTransacao("BEGIN;\n\\i outro.sql\nCOMMIT;", "d")).toThrow(/meta-comando/);
  });

  it("exigeBancoLocal: recusa, com erro claro, DDL/migration fora da cópia local (decisão 17)", () => {
    expect(() => exigeBancoLocal(false)).toThrow(/só na cópia local — ver banco-local/);
    expect(() => exigeBancoLocal(true)).not.toThrow();
  });

  it.skipIf(!hasDb || !LOCAL)("aplicarSql roda DENTRO da txn — depois do ROLLBACK nada existe no banco", async () => {
    await withTx(async (c) => {
      await aplicarSql(c, MIG, "probe");
      expect((await um<{ v: number }>(c, "SELECT public._kanban_harness_probe() AS v")).v).toBe(1);
      expect((await um<{ s: boolean }>(c, "SELECT txid_current_if_assigned() IS NOT NULL AS s")).s).toBe(true);
    });
    const c2 = new Client({ connectionString: dbUrl()!, ssl: SSL });
    await c2.connect();
    try {
      const r = await c2.query("SELECT to_regprocedure('public._kanban_harness_probe()') AS f");
      expect(r.rows[0].f).toBeNull();
    } finally {
      await c2.end();
    }
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd "/Users/sunglee/PLM + Criação/plm-pcp" && DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres KANBAN_AUTO_MIG_TXN=1 npx vitest run --no-file-parallelism tests/integration/kanban-auto.test.ts`
Expected: FAIL — `ReferenceError: … is not defined` (`LOCAL` já na coleta do arquivo; depois `semTransacao`/`aplicarSql`/`RE_BEGIN`/`exigeBancoLocal`/`SSL`).

- [ ] **Step 3: Implementar o harness — inserir o bloco abaixo ENTRE a última linha de `import` e o `describe("kanban-auto — harness…`**

Como o `BEGIN;`/`COMMIT;` sai com segurança: (1) a contagem exige EXATAMENTE 1 `BEGIN;` e 1 `COMMIT;` em linha PRÓPRIA (âncoras `^…$` multilinha) — o `BEGIN` do plpgsql nunca tem `;` e fica dentro de `$function$…$function$`; (2) depois de trocar essas 2 linhas (e o `pg_notify`) por comentários, os corpos `$tag$…$tag$` são apagados de uma CÓPIA e qualquer `BEGIN/COMMIT/ROLLBACK/END/SAVEPOINT/RELEASE…;` ou meta-comando `\…` que sobre FORA deles recusa o arquivo; (3) `aplicarSql` envolve a execução num `SAVEPOINT` e faz `RELEASE` no fim — se algo tivesse comitado, o `RELEASE` falharia alto; (4) com `KANBAN_AUTO_MIG_TXN=1`, `prepara` chama `exigeBancoLocal()` ANTES de qualquer comando — fora da cópia local o teste falha com a mensagem "DDL/migration só na cópia local — ver banco-local" e nada chega ao banco (decisão 17; o `lock_timeout = 3s` fica só como cinto de segurança na própria cópia).

```ts
// ─────────────────────────────── Harness (Task 4) ───────────────────────────────
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MIG_TXN = process.env.KANBAN_AUTO_MIG_TXN === "1";
/** Banco em uso é a CÓPIA LOCAL (Docker 127.0.0.1:54422)? DDL só nela (decisão 17 do dono, 23/set). */
const LOCAL = ehBancoLocal();
/** SSL dos `Client` abertos fora do `withTx`: a cópia local não tem SSL; o pooler de produção exige. */
const SSL = LOCAL ? false : { rejectUnauthorized: false };
const MIGRACOES = [
  "supabase/migrations/20260930120000_kanban_auto_1_schema.sql",
  "supabase/migrations/20260930130000_kanban_auto_2_derivacao.sql",
  "supabase/migrations/20260930140000_kanban_auto_3_motor.sql",
  "supabase/migrations/20260930150000_kanban_auto_4_rpcs.sql",
] as const;
const INVERSOS = {
  1: "supabase/rollback/20260930120000_kanban_auto_1_schema_down.sql",
  2: "supabase/rollback/20260930130000_kanban_auto_2_derivacao_down.sql",
  3: "supabase/rollback/20260930140000_kanban_auto_3_motor_down.sql",
  4: "supabase/rollback/20260930150000_kanban_auto_4_rpcs_down.sql",
} as const;

// Sem flag `g` nas constantes (regex global guarda lastIndex entre chamadas); `todas()` cria a versão global.
const RE_BEGIN = /^[ \t]*BEGIN[ \t]*;[ \t]*$/im;
const RE_COMMIT = /^[ \t]*COMMIT[ \t]*;[ \t]*$/im;
const RE_NOTIFY = /^[ \t]*select[ \t]+pg_notify\('pgrst',[ \t]*'reload schema'\)[ \t]*;[ \t]*$/im;
const todas = (re: RegExp) => new RegExp(re.source, "gim");

/** Conteúdo de um arquivo de migration/inverso SEM o controle de transação, p/ rodar dentro do withTx.
 *  Exige exatamente 1 `BEGIN;` e 1 `COMMIT;` em linha própria e recusa qualquer outro controle de
 *  transação fora de corpo `$…$` (a checagem roda depois de apagar os corpos dollar-quoted, onde
 *  `BEGIN`/`END;` do plpgsql são legítimos). */
function semTransacao(sql: string, nome: string): string {
  const nb = (sql.match(todas(RE_BEGIN)) ?? []).length;
  const nc = (sql.match(todas(RE_COMMIT)) ?? []).length;
  if (nb !== 1 || nc !== 1) {
    throw new Error(`${nome}: esperado 1 "BEGIN;" e 1 "COMMIT;" em linha própria (achei ${nb}/${nc})`);
  }
  const out = sql
    .replace(todas(RE_BEGIN), "-- [harness] BEGIN removido")
    .replace(todas(RE_COMMIT), "-- [harness] COMMIT removido")
    .replace(todas(RE_NOTIFY), "-- [harness] notify removido");
  const foraDeCorpos = out.replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, "");
  if (/^[ \t]*(BEGIN|COMMIT|ROLLBACK|END|ABORT|START[ \t]+TRANSACTION|SAVEPOINT|RELEASE)\b[^\n]*;/im.test(foraDeCorpos)) {
    throw new Error(`${nome}: controle de transação fora de corpo de função — recusado`);
  }
  if (/^[ \t]*\\/m.test(foraDeCorpos)) throw new Error(`${nome}: meta-comando psql (\\i, \\set…) — recusado`);
  return out;
}

/** Roda o SQL dentro da txn aberta. O SAVEPOINT prova que a txn continua aberta no fim
 *  (se algo tivesse comitado, o RELEASE falharia alto). */
async function aplicarSql(c: Client, sql: string, nome: string): Promise<void> {
  await c.query("SAVEPOINT kanban_auto_prepara");
  await c.query(semTransacao(sql, nome));
  await c.query("RELEASE SAVEPOINT kanban_auto_prepara");
}

async function aplicarArquivo(c: Client, rel: string): Promise<void> {
  await aplicarSql(c, readFileSync(ROOT + rel, "utf8"), rel);
}

/** DDL/migration SÓ na cópia local (decisão 17 do dono; incidente 23/set). */
function exigeBancoLocal(local: boolean = LOCAL): void {
  if (!local) {
    throw new Error(
      "DDL/migration só na cópia local — ver banco-local (/Users/sunglee/PLM + Criação/banco-local; " +
        "DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres). DDL em transação contra " +
        "produção trava o app de todas as lojas mesmo com ROLLBACK (incidente 23/set).",
    );
  }
}

/** (com KANBAN_AUTO_MIG_TXN=1: recusa banco que não é a cópia local) + timeouts + migrations 1..ate na txn. */
async function prepara(c: Client, ate: 1 | 2 | 3 | 4 = 4): Promise<void> {
  if (MIG_TXN) exigeBancoLocal(); // ANTES de qualquer comando: DDL nunca fora da cópia local
  await c.query("SET LOCAL lock_timeout = '3s'");
  await c.query("SET LOCAL statement_timeout = '120s'");
  if (!MIG_TXN) return;
  for (const rel of MIGRACOES.slice(0, ate)) await aplicarArquivo(c, rel);
}

async function migracoesJaAplicadas(): Promise<boolean> {
  if (!hasDb || MIG_TXN || !LOCAL) return false; // produção: a suíte não roda lá nem depois do apply (D21) — nem conecta
  const c = new Client({ connectionString: dbUrl()!, ssl: SSL });
  await c.connect();
  try {
    const r = await c.query("SELECT to_regprocedure('public.kanban_mover(uuid,text)') IS NOT NULL AS ok");
    return r.rows[0]?.ok === true;
  } finally {
    await c.end();
  }
}

/** Suíte do motor roda: com banco E (migrations na txn — `prepara` exige a cópia local — OU já aplicadas NA CÓPIA LOCAL, ensaio da Task 18). */
const PRONTO = hasDb && (MIG_TXN || (await migracoesJaAplicadas()));
```

- [ ] **Step 4: Rodar e ver passar; provar que nada vazou**

Run: `cd "/Users/sunglee/PLM + Criação/plm-pcp" && DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres KANBAN_AUTO_MIG_TXN=1 npx vitest run --no-file-parallelism tests/integration/kanban-auto.test.ts`
Expected: PASS nos 4 testes do harness (os `describe.skipIf(!PRONTO)` das próximas tasks ainda não existem). O 4º teste abre OUTRA conexão depois do ROLLBACK e prova que `public._kanban_harness_probe()` não existe.

Run: `psql "postgresql://postgres:postgres@127.0.0.1:54422/postgres" -X -A -t -c "select to_regprocedure('public._kanban_harness_probe()')"`
Expected: linha vazia (NULL). (Produção não é consultada: nenhum teste roda contra ela.)

- [ ] **Step 5: Gates + commit**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp"
npm run build 2>&1 | tail -3
npx tsc --noEmit 2>&1 | grep -E "TS2304|error" ; true
npx vitest run --no-file-parallelism tests/unit/kanban-auto.test.ts tests/unit/kanban-status.test.ts
```
```bash
git add -- tests/integration/kanban-auto.test.ts
git commit --only -m "test(kanban-auto): harness de integração que aplica as migrations DENTRO da txn revertida (F1)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- tests/integration/kanban-auto.test.ts
git show --stat HEAD | tail -n +7   # confere: SÓ os paths acima
```

---

### Task 5: Migration 1 — schema (chave, índices, origem/lote no histórico, fila, snapshot)

**Files:**
- Create: `supabase/migrations/20260930120000_kanban_auto_1_schema.sql`
- Modify: `tests/integration/kanban-auto.test.ts` (acrescentar no FIM)

**Interfaces:**
- Consumes: `prepara`, `aplicarArquivo`, `MIGRACOES`, `MIG_TXN`, `PRONTO`, `withTx`, `um` (Task 4).
- Produces (banco) — nesta ORDEM no arquivo (G-plano R1: o que trava menos primeiro; o AccessExclusive de `tenant_config` por ÚLTIMO, logo antes do COMMIT): índices `idx_cad_tecidos_cad`, `idx_cad_tecido_variantes_cad_tecido`, `idx_cad_aviamentos_cad`, `idx_cad_etiquetas_cad`, `idx_modelo_aviamentos_modelo`; `modelo_kanban_historico.origem text NOT NULL DEFAULT 'manual'` (CHECK `manual|auto|config|restauracao`, constraint `modelo_kanban_historico_origem_chk`) e `.lote_id uuid`; `kanban_recalculo_fila(modelo_id uuid PK → modelos ON DELETE CASCADE, tenant_id uuid NOT NULL, criado_at timestamptz NOT NULL DEFAULT now())` + `idx_kanban_fila_tenant`; `kanban_snapshot(id uuid PK, lote_id uuid NOT NULL, tenant_id uuid NOT NULL, modelo_id uuid NOT NULL → modelos ON DELETE CASCADE, status_anterior text, motivo text NOT NULL CHECK ligar|config, criado_at timestamptz NOT NULL DEFAULT now(), restaurado_at timestamptz, UNIQUE(lote_id, modelo_id))` + `idx_kanban_snapshot_tenant`, `idx_kanban_snapshot_modelo` (as 2 tabelas: RLS ligada, sem policy, `REVOKE ALL` de PUBLIC/anon/authenticated — D1); por último `tenant_config.kanban_automatico boolean NOT NULL DEFAULT false`.
- Produces (teste): `INDICES_NOVOS: string[]`.

- [ ] **Step 1: Acrescentar os testes no fim de `tests/integration/kanban-auto.test.ts`**

```ts
// ─────────────────────────── Migration 1 — schema (Task 5) ───────────────────────────
const INDICES_NOVOS = [
  "idx_cad_tecidos_cad",
  "idx_cad_tecido_variantes_cad_tecido",
  "idx_cad_aviamentos_cad",
  "idx_cad_etiquetas_cad",
  "idx_modelo_aviamentos_modelo",
];

describe.skipIf(!PRONTO)("kanban-auto — migration 1: schema (Task 5)", () => {
  it("tenant_config.kanban_automatico: boolean NOT NULL default false e DESLIGADA em todas as lojas", async () => {
    await withTx(async (c) => {
      await prepara(c, 1);
      const col = await um<{ data_type: string; is_nullable: string; column_default: string }>(
        c,
        `SELECT data_type, is_nullable, column_default FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'tenant_config' AND column_name = 'kanban_automatico'`,
      );
      expect(col).toEqual({ data_type: "boolean", is_nullable: "NO", column_default: "false" });
      const n = await um<{ ligadas: string; total: string }>(
        c,
        `SELECT count(*) FILTER (WHERE kanban_automatico) AS ligadas, count(*) AS total FROM public.tenant_config`,
      );
      expect(Number(n.total)).toBeGreaterThanOrEqual(6);
      if (MIG_TXN) expect(n.ligadas).toBe("0");
    });
  });

  it("os 5 índices que faltavam existem", async () => {
    await withTx(async (c) => {
      await prepara(c, 1);
      const { rows } = await c.query(
        `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = ANY($1::text[]) ORDER BY 1`,
        [INDICES_NOVOS],
      );
      expect(rows.map((r) => r.indexname)).toEqual([...INDICES_NOVOS].sort());
    });
  });

  it("histórico ganhou origem (linhas antigas = 'manual', CHECK nos 4 valores) e lote_id", async () => {
    await withTx(async (c) => {
      await prepara(c, 1);
      const r = await um<{ fora: string; sem_lote: string; total: string }>(
        c,
        `SELECT count(*) FILTER (WHERE origem <> 'manual') AS fora,
                count(*) FILTER (WHERE lote_id IS NULL) AS sem_lote, count(*) AS total
           FROM public.modelo_kanban_historico`,
      );
      if (MIG_TXN) {
        expect(r.fora).toBe("0");
        expect(r.sem_lote).toBe(r.total);
      }
      await c.query("SAVEPOINT chk");
      await expect(
        c.query(`UPDATE public.modelo_kanban_historico SET origem = 'xyz' WHERE id = (SELECT id FROM public.modelo_kanban_historico LIMIT 1)`),
      ).rejects.toMatchObject({ code: "23514" });
      await c.query("ROLLBACK TO SAVEPOINT chk");
    });
  });

  it("kanban_recalculo_fila e kanban_snapshot: RLS ligada, SEM policy, SEM grant p/ anon/authenticated", async () => {
    await withTx(async (c) => {
      await prepara(c, 1);
      for (const t of ["kanban_recalculo_fila", "kanban_snapshot"]) {
        const r = await um<{ rls: boolean; pols: string; anon: boolean; auth: boolean }>(
          c,
          `SELECT c.relrowsecurity AS rls,
                  (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS pols,
                  has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS anon,
                  has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS auth
             FROM pg_class c WHERE c.oid = ('public.' || $1)::regclass`,
          [t],
        );
        expect(r, t).toEqual({ rls: true, pols: "0", anon: false, auth: false });
      }
    });
  });

  it.skipIf(!MIG_TXN)("idempotente: aplicar a migration 1 de novo não falha nem duplica nada", async () => {
    await withTx(async (c) => {
      await prepara(c, 1);
      await aplicarArquivo(c, MIGRACOES[0]);
      const r = await um<{ n: string }>(
        c,
        `SELECT count(*) AS n FROM pg_indexes WHERE schemaname = 'public' AND indexname = ANY($1::text[])`,
        [INDICES_NOVOS],
      );
      expect(r.n).toBe("5");
    });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd "/Users/sunglee/PLM + Criação/plm-pcp" && DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres KANBAN_AUTO_MIG_TXN=1 npx vitest run --no-file-parallelism tests/integration/kanban-auto.test.ts`
Expected: FAIL nos 5 testes novos — `ENOENT … 20260930120000_kanban_auto_1_schema.sql`.

- [ ] **Step 3: Criar `supabase/migrations/20260930120000_kanban_auto_1_schema.sql`**

```sql
-- Kanban automático — F1 · migration 1/4: SCHEMA (aditiva, idempotente)
-- ============================================================================
-- Plano: docs/superpowers/plans/2026-09-22-kanban-automatico-f1-banco.md (Tasks 5–6, §3).
-- Inverso pareado: supabase/rollback/20260930120000_kanban_auto_1_schema_down.sql.
--
-- 1) 5 índices que faltavam nas tabelas-filhas lidas pelo core de condições.
-- 2) modelo_kanban_historico ganha `origem` (manual|auto|config|restauracao; linhas antigas =
--    'manual') e `lote_id` (lote do snapshot que gerou a linha) — desfazer seletivo (G-inicial #1).
-- 3) kanban_recalculo_fila — fila do recálculo ADIADO p/ o COMMIT (esvazia no próprio COMMIT).
-- 4) kanban_snapshot — colunas de ANTES de ligar/mudar a config (restaurar com prévia).
-- 5) tenant_config.kanban_automatico — a CHAVE por loja, DESLIGADA por padrão (decisão 4).
-- ORDEM (G-plano R1): o ALTER de tenant_config pega AccessExclusive numa tabela que as policies RLS
-- de TODAS as lojas leem → fica POR ÚLTIMO, logo antes do COMMIT, p/ segurar o lock o mínimo.
-- `REFERENCES public.modelos` (fila e snapshot) pega SHARE ROW EXCLUSIVE em `modelos` (barra
-- escrita, não leitura) até o COMMIT. O apply em produção roda com lock_timeout (Task 18).
-- As 2 tabelas novas: RLS LIGADA, SEM policy e REVOKE ALL de PUBLIC/anon/authenticated →
-- invisíveis ao PostgREST; só as funções SECURITY DEFINER (dono postgres) leem/escrevem.
-- Sem policy de SELECT de propósito: a prévia/restauração é via RPC DEFINER (Task 16) e uma
-- policy sem GRANT seria código morto — e exporia o snapshot a quem não é admin se alguém
-- desse GRANT depois. As duas têm `tenant_id` → `_wipe_tenant_core` já as cobre.

BEGIN;

-- 1) Índices faltantes (tabelas pequenas → CREATE INDEX comum dentro da txn)
CREATE INDEX IF NOT EXISTS idx_cad_tecidos_cad ON public.cad_tecidos (cad_id);
CREATE INDEX IF NOT EXISTS idx_cad_tecido_variantes_cad_tecido ON public.cad_tecido_variantes (cad_tecido_id);
CREATE INDEX IF NOT EXISTS idx_cad_aviamentos_cad ON public.cad_aviamentos (cad_id);
CREATE INDEX IF NOT EXISTS idx_cad_etiquetas_cad ON public.cad_etiquetas (cad_id);
CREATE INDEX IF NOT EXISTS idx_modelo_aviamentos_modelo ON public.modelo_aviamentos (modelo_id);

-- 2) Histórico: origem + lote
ALTER TABLE public.modelo_kanban_historico
  ADD COLUMN IF NOT EXISTS origem text NOT NULL DEFAULT 'manual'
    CONSTRAINT modelo_kanban_historico_origem_chk
    CHECK (origem IN ('manual', 'auto', 'config', 'restauracao'));
ALTER TABLE public.modelo_kanban_historico
  ADD COLUMN IF NOT EXISTS lote_id uuid;

-- 3) Fila do recálculo adiado
CREATE TABLE IF NOT EXISTS public.kanban_recalculo_fila (
  modelo_id uuid PRIMARY KEY REFERENCES public.modelos(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  criado_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kanban_fila_tenant ON public.kanban_recalculo_fila (tenant_id);
ALTER TABLE public.kanban_recalculo_fila ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kanban_recalculo_fila FROM PUBLIC, anon, authenticated;

-- 4) Snapshot p/ desfazer
CREATE TABLE IF NOT EXISTS public.kanban_snapshot (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lote_id         uuid NOT NULL,
  tenant_id       uuid NOT NULL,
  modelo_id       uuid NOT NULL REFERENCES public.modelos(id) ON DELETE CASCADE,
  status_anterior text,
  motivo          text NOT NULL CONSTRAINT kanban_snapshot_motivo_chk CHECK (motivo IN ('ligar', 'config')),
  criado_at       timestamptz NOT NULL DEFAULT now(),
  restaurado_at   timestamptz,
  CONSTRAINT kanban_snapshot_lote_modelo_uk UNIQUE (lote_id, modelo_id)
);
CREATE INDEX IF NOT EXISTS idx_kanban_snapshot_tenant ON public.kanban_snapshot (tenant_id, criado_at DESC);
CREATE INDEX IF NOT EXISTS idx_kanban_snapshot_modelo ON public.kanban_snapshot (modelo_id);
ALTER TABLE public.kanban_snapshot ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kanban_snapshot FROM PUBLIC, anon, authenticated;

-- 5) Chave por loja — POR ÚLTIMO (R1): AccessExclusive de tenant_config só até o COMMIT abaixo
ALTER TABLE public.tenant_config
  ADD COLUMN IF NOT EXISTS kanban_automatico boolean NOT NULL DEFAULT false;

COMMIT;

select pg_notify('pgrst', 'reload schema');
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd "/Users/sunglee/PLM + Criação/plm-pcp" && DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres KANBAN_AUTO_MIG_TXN=1 npx vitest run --no-file-parallelism tests/integration/kanban-auto.test.ts`
Expected: PASS (harness 4 + schema 5).

- [ ] **Step 5: Gates + commit**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp"
npm run build 2>&1 | tail -3
npx tsc --noEmit 2>&1 | grep -E "TS2304|error" ; true
npx vitest run --no-file-parallelism tests/unit/kanban-auto.test.ts tests/unit/kanban-status.test.ts
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres KANBAN_AUTO_MIG_TXN=1 npx vitest run --no-file-parallelism tests/integration/kanban-auto.test.ts tests/integration/kanban-condicoes.test.ts
```
```bash
git add -- supabase/migrations/20260930120000_kanban_auto_1_schema.sql
git commit --only -m "feat(kanban-auto): migration 1 — chave por loja, índices, origem/lote no histórico, fila e snapshot (F1, NÃO aplicada)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- supabase/migrations/20260930120000_kanban_auto_1_schema.sql tests/integration/kanban-auto.test.ts
git show --stat HEAD | tail -n +7   # confere: SÓ os paths acima
```

---

### Task 6: Inverso da migration 1

**Files:**
- Create: `supabase/rollback/20260930120000_kanban_auto_1_schema_down.sql` (pasta `supabase/rollback/` é nova)
- Modify: `tests/integration/kanban-auto.test.ts`

**Interfaces:**
- Consumes: `INVERSOS[1]`, `prepara`, `aplicarArquivo`, `MIG_TXN` (Task 4); objetos da Task 5.
- Produces: script inverso DESTRUTIVO (apaga a chave, a marca origem/lote_id e os lotes de snapshot), idempotente; roda POR ÚLTIMO (4 → 3 → 2 → 1). Teste `retratoSchema1(c)`.

- [ ] **Step 1: Acrescentar o teste**

```ts
// ─────────────────────────── Inverso 1 (Task 6) ───────────────────────────
async function retratoSchema1(c: Client) {
  const cols = await c.query(
    `SELECT table_name, column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name IN ('tenant_config', 'modelo_kanban_historico')
      ORDER BY table_name, column_name`,
  );
  const idx = await c.query(
    `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'
        AND tablename IN ('cad_tecidos','cad_tecido_variantes','cad_aviamentos','cad_etiquetas','modelo_aviamentos')
      ORDER BY 1`,
  );
  const tabs = await um<{ fila: string | null; snap: string | null }>(
    c,
    `SELECT to_regclass('public.kanban_recalculo_fila')::text AS fila, to_regclass('public.kanban_snapshot')::text AS snap`,
  );
  return { cols: cols.rows, idx: idx.rows, tabs };
}

describe.skipIf(!hasDb || !MIG_TXN)("kanban-auto — inverso da migration 1 (Task 6)", () => {
  it("aplica 1 e desfaz com o inverso: colunas, índices e tabelas voltam ao retrato de antes", async () => {
    await withTx(async (c) => {
      const antes = await retratoSchema1(c);
      await prepara(c, 1);
      expect((await retratoSchema1(c)).tabs.fila).toBe("kanban_recalculo_fila");
      await aplicarArquivo(c, INVERSOS[1]);
      expect(await retratoSchema1(c)).toEqual(antes);
      await aplicarArquivo(c, INVERSOS[1]); // idempotente
    });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd "/Users/sunglee/PLM + Criação/plm-pcp" && DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres KANBAN_AUTO_MIG_TXN=1 npx vitest run --no-file-parallelism tests/integration/kanban-auto.test.ts`
Expected: FAIL — `ENOENT … 20260930120000_kanban_auto_1_schema_down.sql`.

- [ ] **Step 3: Criar `supabase/rollback/20260930120000_kanban_auto_1_schema_down.sql`**

```sql
-- INVERSO de 20260930120000_kanban_auto_1_schema.sql — rodar POR ÚLTIMO (ordem 4 → 3 → 2 → 1).
-- ⚠️ DESTRUTIVO: apaga a chave `kanban_automatico` das lojas, a marca `origem`/`lote_id` do
-- histórico (as linhas continuam; só a marca some), a fila (vazia fora de uma txn) e TODOS os
-- lotes de snapshot. Antes de rodar com a chave já usada em produção: exportar
--   \copy (select * from public.kanban_snapshot) to 'kanban_snapshot.csv' csv header
--   \copy (select id, origem, lote_id from public.modelo_kanban_historico where origem <> 'manual') to 'mkh_origem.csv' csv header
-- Pré-requisito: os inversos 4, 3 e 2 já rodaram (fn_kanban_historico do snapshot não lê `origem`).

BEGIN;

DROP TABLE IF EXISTS public.kanban_snapshot;
DROP TABLE IF EXISTS public.kanban_recalculo_fila;

ALTER TABLE public.modelo_kanban_historico DROP COLUMN IF EXISTS lote_id;
ALTER TABLE public.modelo_kanban_historico DROP COLUMN IF EXISTS origem;

DROP INDEX IF EXISTS public.idx_cad_tecidos_cad;
DROP INDEX IF EXISTS public.idx_cad_tecido_variantes_cad_tecido;
DROP INDEX IF EXISTS public.idx_cad_aviamentos_cad;
DROP INDEX IF EXISTS public.idx_cad_etiquetas_cad;
DROP INDEX IF EXISTS public.idx_modelo_aviamentos_modelo;

ALTER TABLE public.tenant_config DROP COLUMN IF EXISTS kanban_automatico;

COMMIT;

select pg_notify('pgrst', 'reload schema');
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd "/Users/sunglee/PLM + Criação/plm-pcp" && DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres KANBAN_AUTO_MIG_TXN=1 npx vitest run --no-file-parallelism tests/integration/kanban-auto.test.ts`
Expected: PASS (10 testes). O inverso roda 2× seguidas sem erro.

- [ ] **Step 5: Gates + commit**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp"
npm run build 2>&1 | tail -3
npx tsc --noEmit 2>&1 | grep -E "TS2304|error" ; true
npx vitest run --no-file-parallelism tests/unit/kanban-auto.test.ts tests/unit/kanban-status.test.ts
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres KANBAN_AUTO_MIG_TXN=1 npx vitest run --no-file-parallelism tests/integration/kanban-auto.test.ts tests/integration/kanban-condicoes.test.ts
```
```bash
git add -- supabase/rollback/20260930120000_kanban_auto_1_schema_down.sql
git commit --only -m "feat(kanban-auto): inverso da migration 1 em supabase/rollback (testado em txn)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- supabase/rollback/20260930120000_kanban_auto_1_schema_down.sql tests/integration/kanban-auto.test.ts
git show --stat HEAD | tail -n +7   # confere: SÓ os paths acima
```

---

### Task 7: Migration 2 (parte A) — `_kanban_status_rows_raw(jsonb)` extraído SEM mudar a saída

**Files:**
- Create: `supabase/migrations/20260930130000_kanban_auto_2_derivacao.sql`
- Modify: `tests/integration/kanban-auto.test.ts`

**Interfaces:**
- Consumes: `public._kanban_resolve_key(text)` (existente, IMMUTABLE); `tenant_config.status_kanban`.
- Produces: `public._kanban_status_rows_raw(_raw jsonb) RETURNS TABLE(ord integer, key text, lbl text)` IMMUTABLE, EXECUTE revogado dos 3 — corpo idêntico ao de `_kanban_status_rows` (funcoes.sql:3455-3503) trocando a leitura da tabela pelo parâmetro; `public._kanban_status_rows(_tenant uuid)` passa a DELEGAR (mesma assinatura, mesmo `STABLE`/`search_path`, sem DEFINER, ACL preservado pelo `CREATE OR REPLACE`). Sem dedup aqui (a dedup por key é do `_kanban_fluxo`, Task 8). Teste: `boardSql(c, raw)`, `boardTs(raw)`, `BOARDS_SINTETICOS`.

- [ ] **Step 1: Acrescentar os testes**

```ts
// ─────────────────── Migration 2A — _kanban_status_rows_raw (Task 7) ───────────────────
type LinhaBoard = { key: string; lbl: string };

async function boardSql(c: Client, raw: unknown): Promise<LinhaBoard[]> {
  const { rows } = await c.query(
    `SELECT key, lbl FROM public._kanban_status_rows_raw($1::jsonb) ORDER BY ord`,
    [raw === undefined ? null : JSON.stringify(raw)],
  );
  return rows;
}
const boardTs = (raw: unknown): LinhaBoard[] => normalizeKanbanStatuses(raw).map((s) => ({ key: s.key, lbl: s.label }));

// Divergências CONHECIDAS e aceitas (a F1 NÃO muda a saída de hoje): (1) elemento ARRAY dentro de
// status_kanban vira {key:'',label:''} no TS (typeof [] === 'object') e é descartado no SQL;
// (2) objeto SEM label/nome/name mas com id/value/slug: o TS usa a key como label, o SQL devolve
// lbl=''. Só a KEY entra na derivação — nos sintéticos a comparação é por key; nos boards REAIS
// (todos strings) é key+label. Nenhuma loja tem (1) ou (2).
const BOARDS_SINTETICOS: unknown[] = [
  null,
  [],
  "nao-e-array",
  { a: 1 },
  ["Em Modelagem", "Stand By", "Aprovado"],
  ["Prova de Roupa ", "  Stand By  ", "Corte de Piloto II", "Coleção Verão", "Ação/Reação"],
  ["Em Modelagem", "em_modelagem", "Em Modelagem"],
  [{ key: "aprovado", label: "Aprovado" }, { label: "Em Ajuste" }, { nome: "Stand By" }, { id: "x_1", name: "X" }, { value: "v" }, { slug: "s" }],
  [42, null, true, "Aprovado"],
];

describe.skipIf(!PRONTO)("kanban-auto — migration 2A: _kanban_status_rows_raw (Task 7)", () => {
  it("_kanban_status_rows devolve EXATAMENTE o mesmo de antes nas lojas reais", async () => {
    await withTx(async (c) => {
      const { rows: lojas } = await c.query(`SELECT tenant_id, status_kanban FROM public.tenant_config ORDER BY tenant_id`);
      const antes: Record<string, unknown[]> = {};
      for (const l of lojas) antes[l.tenant_id] = (await c.query(`SELECT * FROM public._kanban_status_rows($1)`, [l.tenant_id])).rows;
      await prepara(c, 2);
      for (const l of lojas) {
        const depois = (await c.query(`SELECT * FROM public._kanban_status_rows($1)`, [l.tenant_id])).rows;
        expect(depois, l.tenant_id).toEqual(antes[l.tenant_id]);
        const raw = (await c.query(`SELECT * FROM public._kanban_status_rows_raw($1::jsonb)`, [JSON.stringify(l.status_kanban)])).rows;
        expect(raw, l.tenant_id).toEqual(depois);
      }
    });
  });

  it("anti-drift: normalizeKanbanStatuses (TS) ≡ _kanban_status_rows_raw (SQL) nos boards REAIS das lojas", async () => {
    await withTx(async (c) => {
      await prepara(c, 2);
      const { rows: lojas } = await c.query(`SELECT tenant_id, status_kanban FROM public.tenant_config ORDER BY tenant_id`);
      expect(lojas.length).toBeGreaterThanOrEqual(6);
      for (const l of lojas) expect(await boardSql(c, l.status_kanban), l.tenant_id).toEqual(boardTs(l.status_kanban));
    });
  });

  it("anti-drift: … e as KEYS em boards sintéticos (nulo, vazio, não-array, espaço final, acento, duplicado, objetos, lixo)", async () => {
    await withTx(async (c) => {
      await prepara(c, 2);
      for (const b of BOARDS_SINTETICOS) {
        expect((await boardSql(c, b)).map((x) => x.key), JSON.stringify(b)).toEqual(boardTs(b).map((x) => x.key));
      }
    });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd "/Users/sunglee/PLM + Criação/plm-pcp" && DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres KANBAN_AUTO_MIG_TXN=1 npx vitest run --no-file-parallelism tests/integration/kanban-auto.test.ts`
Expected: FAIL — `ENOENT … 20260930130000_kanban_auto_2_derivacao.sql`.

- [ ] **Step 3: Criar `supabase/migrations/20260930130000_kanban_auto_2_derivacao.sql` (parte A + fechamento)**

```sql
-- Kanban automático — F1 · migration 2/4: DERIVAÇÃO (funções puras + leitura; nenhum gatilho)
-- ============================================================================
-- Plano: docs/superpowers/plans/2026-09-22-kanban-automatico-f1-banco.md (Tasks 7–9, §3).
-- Inverso pareado: supabase/rollback/20260930130000_kanban_auto_2_derivacao_down.sql.
--
-- ⚠️ ESPELHO EXATO de src/lib/kanban-auto.ts (statusDerivado/faltandoPara/destinoDrop/
-- fluxoDoModelo/boardDaLoja/statusParaGate). O anti-drift (tests/integration/kanban-auto.test.ts)
-- roda as MESMAS fixtures (tests/fixtures/kanban-auto-casos.ts) nos dois lados. Mudou aqui → muda lá.
-- Esta migration NÃO muda comportamento: só cria funções e troca o corpo de `_kanban_status_rows`
-- por uma delegação de saída IDÊNTICA (provado no teste com os boards reais das 6 lojas).
-- Invariante #9: toda função nova com EXECUTE revogado de PUBLIC/anon/authenticated.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- A) Normalização do board: corpo de `_kanban_status_rows` (20260817120000) EXTRAÍDO p/ jsonb.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._kanban_status_rows_raw(_raw jsonb)
 RETURNS TABLE(ord integer, key text, lbl text)
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
BEGIN
  IF _raw IS NULL OR jsonb_typeof(_raw) <> 'array' OR jsonb_array_length(_raw) = 0 THEN
    RETURN QUERY SELECT g.o, g.k, g.l FROM (VALUES
      (1, 'em_modelagem', 'Em Modelagem'),
      (2, 'corte_piloto_1', 'Corte de Piloto I'),
      (3, 'corte_piloto_2', 'Corte de Piloto II'),
      (4, 'corte_piloto_3', 'Corte de Piloto III'),
      (5, 'em_pilotagem', 'Em Pilotagem'),
      (6, 'prova_roupa_1', 'Prova de Roupa I'),
      (7, 'prova_roupa_2', 'Prova de Roupa II'),
      (8, 'prova_roupa_3', 'Prova de Roupa III'),
      (9, 'prova_roupa_4', 'Prova de Roupa IV'),
      (10, 'prova_roupa_5', 'Prova de Roupa V'),
      (11, 'em_ajuste', 'Em Ajuste'),
      (12, 'stand_by', 'Stand By'),
      (13, 'reprovado', 'Reprovado'),
      (14, 'aprovado', 'Aprovado')
    ) AS g(o, k, l);
    RETURN;
  END IF;

  RETURN QUERY
  SELECT t.ord::int,
    CASE
      WHEN jsonb_typeof(t.elem) = 'string'
        THEN public._kanban_resolve_key(t.elem #>> '{}')
      ELSE COALESCE(
        t.elem->>'key', t.elem->>'id', t.elem->>'value', t.elem->>'slug',
        public._kanban_resolve_key(COALESCE(t.elem->>'label', t.elem->>'nome', t.elem->>'name', '')))
    END,
    CASE
      WHEN jsonb_typeof(t.elem) = 'string'
        THEN t.elem #>> '{}'
      ELSE COALESCE(t.elem->>'label', t.elem->>'nome', t.elem->>'name', t.elem->>'key', '')
    END
  FROM jsonb_array_elements(_raw) WITH ORDINALITY AS t(elem, ord)
  WHERE jsonb_typeof(t.elem) IN ('string', 'object');
END;
$function$;

CREATE OR REPLACE FUNCTION public._kanban_status_rows(_tenant uuid)
 RETURNS TABLE(ord integer, key text, lbl text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Delegação (kanban automático, F1): MESMA saída de antes — a normalização mora em
  -- `_kanban_status_rows_raw(jsonb)`, reusada pelo motor com a config PROPOSTA (prévia).
  RETURN QUERY
  SELECT r.ord, r.key, r.lbl
    FROM public._kanban_status_rows_raw(
      (SELECT tc.status_kanban FROM public.tenant_config tc WHERE tc.tenant_id = _tenant)) r;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public._kanban_status_rows_raw(jsonb) FROM PUBLIC, anon, authenticated;
COMMIT;

select pg_notify('pgrst', 'reload schema');
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd "/Users/sunglee/PLM + Criação/plm-pcp" && DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres KANBAN_AUTO_MIG_TXN=1 npx vitest run --no-file-parallelism tests/integration/kanban-auto.test.ts`
Expected: PASS (13 testes). "Antes" é capturado na MESMA txn antes do `prepara` — prova que `_kanban_status_rows` devolve o mesmo nas 6 lojas.

- [ ] **Step 5: Gates + commit**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp"
npm run build 2>&1 | tail -3
npx tsc --noEmit 2>&1 | grep -E "TS2304|error" ; true
npx vitest run --no-file-parallelism tests/unit/kanban-auto.test.ts tests/unit/kanban-status.test.ts
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres KANBAN_AUTO_MIG_TXN=1 npx vitest run --no-file-parallelism tests/integration/kanban-auto.test.ts tests/integration/kanban-condicoes.test.ts
```
```bash
git add -- supabase/migrations/20260930130000_kanban_auto_2_derivacao.sql
git commit --only -m "feat(kanban-auto): migration 2A — _kanban_status_rows_raw extraído, saída idêntica nas 6 lojas

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- supabase/migrations/20260930130000_kanban_auto_2_derivacao.sql tests/integration/kanban-auto.test.ts
git show --stat HEAD | tail -n +7   # confere: SÓ os paths acima
```

---

### Task 8: Migration 2 (parte B) — derivação PURA em SQL + anti-drift TS×SQL com as fixtures

**Files:**
- Modify: `supabase/migrations/20260930130000_kanban_auto_2_derivacao.sql` (inserir antes do `COMMIT;`)
- Modify: `tests/integration/kanban-auto.test.ts`

**Interfaces:**
- Consumes: `_kanban_status_rows_raw` (Task 7); `CASOS` (fixtures, com E1); `statusDerivado`, `destinoDrop`, `faltandoPara`, `fluxoDoModelo`, `boardDaLoja`, `lerKanbanAutoConfig` (Task 1).
- Produces (todas IMMUTABLE, sem tabela, sem DEFINER, EXECUTE revogado dos 3) — espelho linha a linha de `src/lib/kanban-auto.ts`:
  - `_kanban_norm(_s text) → text` ≡ `normKey`
  - `_kanban_lista(_j jsonb) → text[]` (só elementos string, na ordem; não-array → `'{}'`) ≡ `mapaListas`/`lerRevendaConfig`
  - `_kanban_coluna_manual(_col text, _reqs jsonb) → boolean` ≡ `colunaManual` (reprovado SEMPRE manual)
  - `_kanban_req_efetivos(_col text, _fluxo text[], _reqs jsonb, _exc jsonb) → text[]` ≡ `requisitosEfetivos`
  - `_kanban_derivar_puro(_fluxo text[], _reqs jsonb, _exc jsonb, _cond jsonb, _status text, _derivavel boolean) → jsonb` com as chaves EXATAS do tipo `Derivacao` (`derivavel, entrada, alvo, resultado, fixado, primeiraFalha, faltando`) ≡ `statusDerivado`
  - `_kanban_faltando_para(…mesmos 6…, _para text) → text[]` ≡ `faltandoPara`
  - `_kanban_destino_drop_puro(…mesmos 6…, _para text) → jsonb {acao, status, faltando}` ≡ `destinoDrop` (mesma ordem de avaliação do §3)
  - `_kanban_fluxo(_cfg jsonb, _comprado boolean) → text[]` (board normalizado + DEDUP por key, 1ª ocorrência; comprado = ∩ `revenda_kanban_colunas`, `[]` = todas) ≡ `fluxoDoModelo`/`boardDaLoja`
- Teste: `derivarSql`, `dropSql`, `faltandoSql`, tipo `Entrada`.

- [ ] **Step 1: Acrescentar os testes (anti-drift)**

```ts
// ─────────────── Migration 2B — derivação pura: ANTI-DRIFT TS × SQL (Task 8) ───────────────
type Entrada = { fluxo: string[]; reqs: Record<string, string[]>; exc: Record<string, string[]>; cond: Record<string, boolean>; status: string | null; derivavel: boolean };
const argsPuros = (i: Entrada) => [i.fluxo, JSON.stringify(i.reqs), JSON.stringify(i.exc), JSON.stringify(i.cond), i.status, i.derivavel];

async function derivarSql(c: Client, i: Entrada) {
  return (await um<{ d: unknown }>(c,
    `SELECT public._kanban_derivar_puro($1::text[], $2::jsonb, $3::jsonb, $4::jsonb, $5, $6) AS d`, argsPuros(i))).d;
}
async function dropSql(c: Client, i: Entrada, para: string) {
  return (await um<{ d: unknown }>(c,
    `SELECT public._kanban_destino_drop_puro($1::text[], $2::jsonb, $3::jsonb, $4::jsonb, $5, $6, $7) AS d`, [...argsPuros(i), para])).d;
}
async function faltandoSql(c: Client, i: Entrada, para: string) {
  return (await um<{ f: string[] }>(c,
    `SELECT public._kanban_faltando_para($1::text[], $2::jsonb, $3::jsonb, $4::jsonb, $5, $6, $7) AS f`, [...argsPuros(i), para])).f;
}

describe.skipIf(!PRONTO)("kanban-auto — migration 2B: anti-drift TS×SQL com as fixtures (Task 8)", () => {
  it("_kanban_derivar_puro ≡ fixture ≡ statusDerivado, e _kanban_destino_drop_puro ≡ fixture ≡ destinoDrop (TODOS os casos)", async () => {
    await withTx(async (c) => {
      await prepara(c, 2);
      for (const caso of CASOS) {
        expect(await derivarSql(c, caso.input), caso.nome).toEqual(caso.esperado);
        expect(statusDerivado(caso.input), `${caso.nome} (TS)`).toEqual(caso.esperado);
        for (const a of caso.arrastes) {
          const esperado = { acao: a.acao, status: a.status, faltando: a.faltando };
          expect(await dropSql(c, caso.input, a.para), `${caso.nome} → ${a.para}`).toEqual(esperado);
          expect(destinoDrop(caso.input, a.para), `${caso.nome} → ${a.para} (TS)`).toEqual(esperado);
        }
      }
    });
  });

  it("_kanban_faltando_para ≡ faltandoPara (exceção, dedup/ordem, nada falha, antes da 1ª falha)", async () => {
    await withTx(async (c) => {
      await prepara(c, 2);
      const exc: Entrada = { fluxo: ["a", "b", "c"], reqs: { a: ["x"], b: ["y"], c: ["z"] }, exc: { c: ["y"] }, cond: { x: true, z: true }, status: "a", derivavel: true };
      const dedup: Entrada = {
        fluxo: ["entrada", "a", "b", "stand_by", "c", "reprovado", "d"],
        reqs: { a: ["x"], b: ["y"], c: ["z", "x"], d: ["w"] }, exc: {}, cond: {}, status: null, derivavel: true,
      };
      const casos: [Entrada, string][] = [
        [exc, "c"], [exc, "a"], [{ ...exc, cond: { x: true, y: true, z: true } }, "c"], [dedup, "c"], [dedup, "d"], [dedup, "zzz"],
      ];
      for (const [i, para] of casos) {
        expect(await faltandoSql(c, i, para), `${JSON.stringify(i.cond)} → ${para}`).toEqual(faltandoPara(i, para));
      }
      expect(await faltandoSql(c, exc, "c")).toEqual(["y"]);
      expect(await faltandoSql(c, dedup, "c")).toEqual(["x", "y", "z"]);
    });
  });

  it("_kanban_fluxo ≡ boardDaLoja/fluxoDoModelo (config sintética com lixo + configs REAIS das lojas)", async () => {
    await withTx(async (c) => {
      await prepara(c, 2);
      const sintetica = {
        status_kanban: ["Em Modelagem", "Stand By", "Em Modelagem", { key: "aprovado", label: "Aprovado" }, 42],
        revenda_kanban_colunas: ["stand_by", "aprovado", 7],
      };
      const { rows: reais } = await c.query(`SELECT tenant_id, status_kanban, revenda_kanban_colunas FROM public.tenant_config`);
      for (const cfgRaw of [sintetica, ...reais, { status_kanban: [] }, {}]) {
        const cfg = lerKanbanAutoConfig(cfgRaw);
        for (const origem of ["interno", "revenda", "importado"]) {
          const sql = (await um<{ f: string[] }>(c, `SELECT public._kanban_fluxo($1::jsonb, $2) AS f`,
            [JSON.stringify(cfgRaw), origem !== "interno"])).f;
          expect(sql, `${JSON.stringify(cfgRaw).slice(0, 60)} ${origem}`).toEqual(fluxoDoModelo(origem, cfg).map((k) => k.key));
        }
        const board = (await um<{ f: string[] }>(c, `SELECT public._kanban_fluxo($1::jsonb, false) AS f`, [JSON.stringify(cfgRaw)])).f;
        expect(board).toEqual(boardDaLoja(cfg).map((k) => k.key));
      }
    });
  });

  it("puras: _kanban_norm/_kanban_lista/_kanban_coluna_manual/_kanban_req_efetivos (reprovado sempre manual)", async () => {
    await withTx(async (c) => {
      await prepara(c, 2);
      const r = await um<Record<string, unknown>>(c, `SELECT
          public._kanban_norm('  Stand_By ') AS norm,
          public._kanban_lista('["a", 1, null, "b", {"x":1}]'::jsonb) AS lista,
          public._kanban_lista('{"a":1}'::jsonb) AS lista_obj,
          public._kanban_coluna_manual('Reprovado', '{"reprovado":["x"]}'::jsonb) AS rep,
          public._kanban_coluna_manual('a', '{"a":["x"]}'::jsonb) AS auto,
          public._kanban_coluna_manual('a', '{"a":"nao-e-array"}'::jsonb) AS lixo,
          public._kanban_req_efetivos('c', ARRAY['a','b','c'], '{"a":["x"],"b":["y"],"c":["z","x"]}'::jsonb, '{"c":["y"]}'::jsonb) AS efet`);
      expect(r).toEqual({ norm: "stand_by", lista: ["a", "b"], lista_obj: [], rep: true, auto: false, lixo: true, efet: ["x", "z"] });
    });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd "/Users/sunglee/PLM + Criação/plm-pcp" && DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres KANBAN_AUTO_MIG_TXN=1 npx vitest run --no-file-parallelism tests/integration/kanban-auto.test.ts`
Expected: FAIL — `function public._kanban_derivar_puro(…) does not exist` (o 1º teste novo; os de `_kanban_fluxo`/puras idem).

- [ ] **Step 3: Implementar** — inserir o bloco abaixo IMEDIATAMENTE ANTES da linha `COMMIT;` de `supabase/migrations/20260930130000_kanban_auto_2_derivacao.sql` (o arquivo termina sempre em `COMMIT;` + linha em branco + `select pg_notify('pgrst', 'reload schema');`). Conferir depois com `grep -c '^COMMIT;$' supabase/migrations/20260930130000_kanban_auto_2_derivacao.sql` = `1` e `grep -n '^BEGIN;$' supabase/migrations/20260930130000_kanban_auto_2_derivacao.sql` = só a linha do topo.
```sql
-- ────────────────────────────────────────────────────────────────────────────
-- B) Helpers PUROS (IMMUTABLE, sem tabela) — espelho linha a linha de kanban-auto.ts
-- ────────────────────────────────────────────────────────────────────────────

-- ≡ normKey (TS): lower(btrim(coalesce(x,''))). Nota: btrim só tira ESPAÇO; o `trim()` do JS tira
-- também \t\n — divergência aceita (chaves/labels reais não têm tab/quebra).
CREATE OR REPLACE FUNCTION public._kanban_norm(_s text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT lower(btrim(coalesce(_s, '')));
$function$;

-- ≡ mapaListas/lerRevendaConfig (TS): array jsonb → text[] só com os elementos STRING, na ordem.
-- Qualquer outra coisa (null, objeto, número) → '{}'.
CREATE OR REPLACE FUNCTION public._kanban_lista(_j jsonb)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT coalesce(array_agg(t.e #>> '{}' ORDER BY t.o), '{}'::text[])
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(_j) = 'array' THEN _j ELSE '[]'::jsonb END)
         WITH ORDINALITY AS t(e, o)
   WHERE jsonb_typeof(t.e) = 'string';
$function$;

-- ≡ colunaManual (TS): sem requisito PRÓPRIO = manual; 'reprovado' SEMPRE manual (regra fixa).
CREATE OR REPLACE FUNCTION public._kanban_coluna_manual(_col text, _reqs jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT v.k = 'reprovado'
      OR cardinality(public._kanban_lista(
           CASE WHEN jsonb_typeof(_reqs) = 'object' THEN _reqs -> v.k END)) = 0
    FROM (SELECT public._kanban_norm(_col) AS k) v;
$function$;

-- ≡ requisitosEfetivos (src/lib/kanban-condicoes.ts): UNIÃO (dedup, ordem de aparição) dos
-- requisitos PRÓPRIOS de fluxo[1..idx(col)] MENOS as exceções da própria coluna que não são
-- próprias dela. `_col` fora do fluxo → só os próprios (sem exceção).
CREATE OR REPLACE FUNCTION public._kanban_req_efetivos(_col text, _fluxo text[], _reqs jsonb, _exc jsonb)
 RETURNS text[]
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  v_reqs     jsonb  := CASE WHEN jsonb_typeof(_reqs) = 'object' THEN _reqs ELSE '{}'::jsonb END;
  v_exc_obj  jsonb  := CASE WHEN jsonb_typeof(_exc) = 'object' THEN _exc ELSE '{}'::jsonb END;
  v_idx      int    := array_position(coalesce(_fluxo, '{}'::text[]), _col);
  v_proprios text[] := public._kanban_lista(v_reqs -> _col);
  v_acc      text[] := '{}'::text[];
  v_k        text;
  v_i        int;
BEGIN
  IF v_idx IS NULL THEN
    FOREACH v_k IN ARRAY v_proprios LOOP
      IF NOT (v_k = ANY (v_acc)) THEN v_acc := v_acc || v_k; END IF;
    END LOOP;
    RETURN v_acc;
  END IF;
  FOR v_i IN 1..v_idx LOOP
    FOREACH v_k IN ARRAY public._kanban_lista(v_reqs -> _fluxo[v_i]) LOOP
      IF NOT (v_k = ANY (v_acc)) THEN v_acc := v_acc || v_k; END IF;
    END LOOP;
  END LOOP;
  FOREACH v_k IN ARRAY public._kanban_lista(v_exc_obj -> _col) LOOP
    IF NOT (v_k = ANY (v_proprios)) THEN v_acc := array_remove(v_acc, v_k); END IF;
  END LOOP;
  RETURN v_acc;
END;
$function$;

-- ≡ statusDerivado (TS). Devolve jsonb com as MESMAS chaves do tipo `Derivacao`
-- ({derivavel, entrada, alvo, resultado, fixado, primeiraFalha, faltando}) → o anti-drift compara
-- com `toEqual` direto. Caminha as colunas AUTOMÁTICAS na ordem e PARA na 1ª que falha (nunca pula
-- etapa — G-inicial #3); entrada = fluxo[1] = piso; fixado = coluna manual ≠ entrada.
CREATE OR REPLACE FUNCTION public._kanban_derivar_puro(
  _fluxo text[], _reqs jsonb, _exc jsonb, _cond jsonb, _status text, _derivavel boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  v_fluxo    text[] := coalesce(_fluxo, '{}'::text[]);
  v_reqs_in  jsonb  := CASE WHEN jsonb_typeof(_reqs) = 'object' THEN _reqs ELSE '{}'::jsonb END;
  v_reqs     jsonb;
  v_st       text   := public._kanban_norm(_status);
  v_entrada  text;
  v_alvo     text;
  v_primeira text   := NULL;
  v_faltando text[] := '{}'::text[];
  v_col      text;
  v_fixado   boolean;
BEGIN
  IF cardinality(v_fluxo) = 0 OR NOT coalesce(_derivavel, false) THEN
    RETURN jsonb_build_object(
      'derivavel', false, 'entrada', v_fluxo[1], 'alvo', NULL, 'resultado', _status,
      'fixado', false, 'primeiraFalha', NULL, 'faltando', '[]'::jsonb);
  END IF;

  v_reqs    := v_reqs_in - 'reprovado';            -- semReprovado
  v_entrada := v_fluxo[1];
  v_alvo    := v_entrada;
  FOREACH v_col IN ARRAY v_fluxo LOOP
    CONTINUE WHEN public._kanban_coluna_manual(v_col, v_reqs_in);
    v_faltando := ARRAY(
      SELECT e.k
        FROM unnest(public._kanban_req_efetivos(v_col, v_fluxo, v_reqs, _exc)) WITH ORDINALITY AS e(k, o)
       WHERE NOT coalesce((_cond -> e.k) = 'true'::jsonb, false)
       ORDER BY e.o);
    IF cardinality(v_faltando) > 0 THEN
      v_primeira := v_col;
      EXIT;
    END IF;
    v_alvo := v_col;
  END LOOP;
  IF v_primeira IS NULL THEN v_faltando := '{}'::text[]; END IF;

  v_fixado := v_st <> '' AND v_st = ANY (v_fluxo) AND v_st <> v_entrada
              AND public._kanban_coluna_manual(v_st, v_reqs_in);
  RETURN jsonb_build_object(
    'derivavel', true, 'entrada', v_entrada, 'alvo', v_alvo,
    'resultado', CASE WHEN v_fixado THEN v_st ELSE v_alvo END,
    'fixado', v_fixado, 'primeiraFalha', v_primeira, 'faltando', to_jsonb(v_faltando));
END;
$function$;

-- ≡ faltandoPara (TS): união (dedup, em ordem) dos efetivos NÃO satisfeitos das colunas
-- AUTOMÁTICAS de primeiraFalha até `_para` (inclusive).
CREATE OR REPLACE FUNCTION public._kanban_faltando_para(
  _fluxo text[], _reqs jsonb, _exc jsonb, _cond jsonb, _status text, _derivavel boolean, _para text)
 RETURNS text[]
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  v_fluxo   text[] := coalesce(_fluxo, '{}'::text[]);
  v_reqs_in jsonb  := CASE WHEN jsonb_typeof(_reqs) = 'object' THEN _reqs ELSE '{}'::jsonb END;
  v_reqs    jsonb  := v_reqs_in - 'reprovado';
  v_d       jsonb  := public._kanban_derivar_puro(_fluxo, _reqs, _exc, _cond, _status, _derivavel);
  v_ini     int;
  v_fim     int;
  v_out     text[] := '{}'::text[];
  v_k       text;
  v_i       int;
BEGIN
  IF NOT (v_d ->> 'derivavel')::boolean OR (v_d ->> 'primeiraFalha') IS NULL THEN
    RETURN v_out;
  END IF;
  v_ini := array_position(v_fluxo, v_d ->> 'primeiraFalha');
  v_fim := array_position(v_fluxo, public._kanban_norm(_para));
  IF v_ini IS NULL OR v_fim IS NULL OR v_fim < v_ini THEN
    RETURN v_out;
  END IF;
  FOR v_i IN v_ini..v_fim LOOP
    CONTINUE WHEN public._kanban_coluna_manual(v_fluxo[v_i], v_reqs_in);
    FOREACH v_k IN ARRAY public._kanban_req_efetivos(v_fluxo[v_i], v_fluxo, v_reqs, _exc) LOOP
      IF NOT coalesce((_cond -> v_k) = 'true'::jsonb, false) AND NOT (v_k = ANY (v_out)) THEN
        v_out := v_out || v_k;
      END IF;
    END LOOP;
  END LOOP;
  RETURN v_out;
END;
$function$;

-- ≡ destinoDrop (TS) — tabela ÚNICA de arraste do §3, na MESMA ordem de avaliação.
-- Devolve {acao, status, faltando} com as chaves do tipo `DestinoDrop`.
CREATE OR REPLACE FUNCTION public._kanban_destino_drop_puro(
  _fluxo text[], _reqs jsonb, _exc jsonb, _cond jsonb, _status text, _derivavel boolean, _para text)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  v_fluxo    text[] := coalesce(_fluxo, '{}'::text[]);
  v_reqs_in  jsonb  := CASE WHEN jsonb_typeof(_reqs) = 'object' THEN _reqs ELSE '{}'::jsonb END;
  v_p        text   := public._kanban_norm(_para);
  v_st       text   := public._kanban_norm(_status);
  v_idx_para int    := array_position(v_fluxo, public._kanban_norm(_para));
  v_d        jsonb;
  v_alvo     text;
  v_idx_alvo int;
  v_fixado   boolean;
BEGIN
  -- 1. fora do fluxo
  IF v_idx_para IS NULL THEN
    RETURN jsonb_build_object('acao', 'fora_do_fluxo', 'status', _status, 'faltando', '[]'::jsonb);
  END IF;
  v_d := public._kanban_derivar_puro(_fluxo, _reqs, _exc, _cond, _status, _derivavel);
  -- 2. não derivável: gravação livre
  IF NOT (v_d ->> 'derivavel')::boolean THEN
    IF v_p = v_st THEN
      RETURN jsonb_build_object('acao', 'nada', 'status', _status, 'faltando', '[]'::jsonb);
    END IF;
    RETURN jsonb_build_object('acao', 'fixar', 'status', v_p, 'faltando', '[]'::jsonb);
  END IF;
  v_alvo     := v_d ->> 'alvo';
  v_idx_alvo := array_position(v_fluxo, v_alvo);
  v_fixado   := (v_d ->> 'fixado')::boolean;
  -- 3. entrada
  IF v_p = v_d ->> 'entrada' THEN
    IF v_fixado THEN
      RETURN jsonb_build_object('acao', 'soltar', 'status', v_alvo, 'faltando', '[]'::jsonb);
    END IF;
    IF v_idx_alvo = 1 THEN
      IF v_st = v_alvo THEN
        RETURN jsonb_build_object('acao', 'nada', 'status', _status, 'faltando', '[]'::jsonb);
      END IF;
      RETURN jsonb_build_object('acao', 'soltar', 'status', v_alvo, 'faltando', '[]'::jsonb);
    END IF;
    RETURN jsonb_build_object('acao', 'bloquear_ja_cumprida', 'status', _status, 'faltando', '[]'::jsonb);
  END IF;
  -- 4. coluna manual
  IF public._kanban_coluna_manual(v_p, v_reqs_in) THEN
    IF v_p = v_st THEN
      RETURN jsonb_build_object('acao', 'nada', 'status', _status, 'faltando', '[]'::jsonb);
    END IF;
    RETURN jsonb_build_object('acao', 'fixar', 'status', v_p, 'faltando', '[]'::jsonb);
  END IF;
  -- 5. além da derivada
  IF v_idx_para > v_idx_alvo THEN
    RETURN jsonb_build_object('acao', 'bloquear_faltando', 'status', _status,
      'faltando', to_jsonb(public._kanban_faltando_para(_fluxo, _reqs, _exc, _cond, _status, _derivavel, v_p)));
  END IF;
  -- 6. aquém da derivada
  IF v_idx_para < v_idx_alvo THEN
    IF v_fixado THEN
      RETURN jsonb_build_object('acao', 'soltar', 'status', v_alvo, 'faltando', '[]'::jsonb);
    END IF;
    RETURN jsonb_build_object('acao', 'bloquear_ja_cumprida', 'status', _status, 'faltando', '[]'::jsonb);
  END IF;
  -- 7. na própria derivada
  IF v_fixado THEN
    RETURN jsonb_build_object('acao', 'soltar', 'status', v_alvo, 'faltando', '[]'::jsonb);
  END IF;
  IF v_st = v_alvo THEN
    RETURN jsonb_build_object('acao', 'nada', 'status', _status, 'faltando', '[]'::jsonb);
  END IF;
  RETURN jsonb_build_object('acao', 'soltar', 'status', v_alvo, 'faltando', '[]'::jsonb);
END;
$function$;

-- ≡ fluxoDoModelo/boardDaLoja (TS): board normalizado + DEDUP por key (fica a 1ª ocorrência);
-- comprado = board ∩ revenda_kanban_colunas ([] = todas), comparação EXATA de key.
CREATE OR REPLACE FUNCTION public._kanban_fluxo(_cfg jsonb, _comprado boolean)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
AS $function$
  WITH r AS (
    SELECT x.ord, x.key FROM public._kanban_status_rows_raw(_cfg -> 'status_kanban') x
  ), d AS (
    SELECT DISTINCT ON (r.key) r.key, r.ord FROM r ORDER BY r.key, r.ord
  ), p AS (
    SELECT public._kanban_lista(_cfg -> 'revenda_kanban_colunas') AS perm
  )
  SELECT coalesce(array_agg(d.key ORDER BY d.ord), '{}'::text[])
    FROM d, p
   WHERE NOT coalesce(_comprado, false) OR cardinality(p.perm) = 0 OR d.key = ANY (p.perm);
$function$;

-- Invariante #9 — internas sem EXECUTE p/ PUBLIC/anon/authenticated.
REVOKE EXECUTE ON FUNCTION public._kanban_norm(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._kanban_lista(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._kanban_coluna_manual(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._kanban_req_efetivos(text, text[], jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._kanban_derivar_puro(text[], jsonb, jsonb, jsonb, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._kanban_faltando_para(text[], jsonb, jsonb, jsonb, text, boolean, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._kanban_destino_drop_puro(text[], jsonb, jsonb, jsonb, text, boolean, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._kanban_fluxo(jsonb, boolean) FROM PUBLIC, anon, authenticated;
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd "/Users/sunglee/PLM + Criação/plm-pcp" && DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres KANBAN_AUTO_MIG_TXN=1 npx vitest run --no-file-parallelism tests/integration/kanban-auto.test.ts`
Expected: PASS (17 testes). Se um caso divergir, a FIXTURE é a referência normativa (§3) — corrigir o SQL (ou o TS, se o TS divergir da fixture), nunca a fixture sem registrar.

- [ ] **Step 5: Gates + commit**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp"
npm run build 2>&1 | tail -3
npx tsc --noEmit 2>&1 | grep -E "TS2304|error" ; true
npx vitest run --no-file-parallelism tests/unit/kanban-auto.test.ts tests/unit/kanban-status.test.ts
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres KANBAN_AUTO_MIG_TXN=1 npx vitest run --no-file-parallelism tests/integration/kanban-auto.test.ts tests/integration/kanban-condicoes.test.ts
```
```bash
git commit --only -m "feat(kanban-auto): migration 2B — derivação pura em SQL, travada pelas MESMAS fixtures do TS (anti-drift)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- supabase/migrations/20260930130000_kanban_auto_2_derivacao.sql tests/integration/kanban-auto.test.ts
git show --stat HEAD | tail -n +7   # confere: SÓ os paths acima
```

---

### Task 9: Migration 2 (parte C) — config, chave, derivação em LOTE, gate por posição + inverso 2

**Files:**
- Modify: `supabase/migrations/20260930130000_kanban_auto_2_derivacao.sql` (inserir antes do `COMMIT;`)
- Create: `supabase/rollback/20260930130000_kanban_auto_2_derivacao_down.sql`
- Modify: `tests/integration/kanban-auto.test.ts`

**Interfaces:**
- Consumes: `_kanban_fluxo`, `_kanban_derivar_puro` (Task 8); `public._avaliar_condicoes_kanban_core(_tenant uuid, _ids uuid[]) → jsonb` (existente, 39 chaves); `tenant_config.kanban_automatico` (Task 5).
- Produces (SECURITY DEFINER, `SET search_path TO 'public'`, STABLE, EXECUTE revogado dos 3):
  - `_kanban_cfg(_tenant uuid) → jsonb` `{kanban_automatico, status_kanban, kanban_requisitos, kanban_requisitos_excecoes, revenda_kanban_colunas, revenda_kanban_requisitos, ref_exibir_status, explosao_envio_status}` (NULL se a loja não tem linha)
  - `_kanban_ligado(_tenant uuid) → boolean`
  - `_kanban_derivar_lote(_tenant uuid, _ids uuid[], _cfg jsonb DEFAULT NULL) → TABLE(modelo_id uuid, origem text, status_atual text, elegivel boolean, fluxo text[], reqs jsonb, exc jsonb, cond jsonb, derivavel boolean, entrada text, alvo text, resultado text, fixado boolean, primeira_falha text, faltando text[])` — `_ids NULL` = loja inteira; `_cfg NULL` = config gravada; UMA chamada ao core por lote; uma linha por modelo pedido
  - `_kanban_status_gate(_tenant uuid, _modelo_id uuid, _status_atual text) → text` ≡ `statusParaGate` (chave desligada / GUC `auto|config|restauracao` / não derivável → `_status_atual`; senão `alvo`)
- Teste: `AVE_RARA`, `FUNCOES_M2` (13 assinaturas), `defFuncao(c, assinatura) → string|null`.

- [ ] **Step 1: Acrescentar os testes**

```ts
// ──────────── Migration 2C — config, chave, derivação em LOTE e gate (Task 9) ────────────
const AVE_RARA = "20c84a36-b7a0-4c26-ac59-52cb11e9d979";

describe.skipIf(!PRONTO)("kanban-auto — migration 2C: _kanban_derivar_lote / _kanban_status_gate (Task 9)", () => {
  it("_kanban_cfg espelha tenant_config; _kanban_ligado = false e _kanban_status_gate = status gravado (chave desligada)", async () => {
    await withTx(async (c) => {
      await prepara(c, 2);
      const { rows: lojas } = await c.query(
        `SELECT tenant_id, kanban_automatico, status_kanban, kanban_requisitos, kanban_requisitos_excecoes,
                revenda_kanban_colunas, revenda_kanban_requisitos FROM public.tenant_config ORDER BY tenant_id`,
      );
      for (const l of lojas) {
        const cfg = (await um<{ c: any }>(c, `SELECT public._kanban_cfg($1) AS c`, [l.tenant_id])).c;
        expect(cfg.status_kanban, l.tenant_id).toEqual(l.status_kanban);
        expect(cfg.kanban_requisitos).toEqual(l.kanban_requisitos);
        expect(cfg.kanban_requisitos_excecoes).toEqual(l.kanban_requisitos_excecoes);
        expect(cfg.revenda_kanban_colunas).toEqual(l.revenda_kanban_colunas);
        expect(cfg.revenda_kanban_requisitos).toEqual(l.revenda_kanban_requisitos);
        expect((await um<{ v: boolean }>(c, `SELECT public._kanban_ligado($1) AS v`, [l.tenant_id])).v).toBe(l.kanban_automatico);
      }
      const { rows: ms } = await c.query(
        `SELECT m.id, m.tenant_id, m.status_desenvolvimento FROM public.modelos m
           JOIN public.tenant_config tc ON tc.tenant_id = m.tenant_id AND NOT tc.kanban_automatico LIMIT 50`,
      );
      for (const m of ms) {
        const g = await um<{ g: string | null }>(c, `SELECT public._kanban_status_gate($1, $2, $3) AS g`, [m.tenant_id, m.id, m.status_desenvolvimento]);
        expect(g.g).toBe(m.status_desenvolvimento);
      }
      expect((await um<{ c: unknown }>(c, `SELECT public._kanban_cfg('00000000-0000-0000-0000-000000000000') AS c`)).c).toBeNull();
    });
  });

  it("anti-drift em DADO REAL: _kanban_derivar_lote ≡ derivarModelo (TS) em TODOS os modelos de TODAS as lojas", async () => {
    await withTx(async (c) => {
      await prepara(c, 2);
      const { rows: lojas } = await c.query(`SELECT * FROM public.tenant_config ORDER BY tenant_id`);
      for (const l of lojas) {
        const cfg = lerKanbanAutoConfig(l);
        const { rows: mods } = await c.query(
          `SELECT id, origem, status_desenvolvimento, ordem_criacao_enviada, lancado FROM public.modelos WHERE tenant_id = $1`,
          [l.tenant_id],
        );
        const elegiveis = mods.filter((m) => m.ordem_criacao_enviada && !m.lancado).map((m) => m.id);
        const cond = elegiveis.length
          ? (await um<{ c: Record<string, Record<string, boolean>> }>(c,
              `SELECT public._avaliar_condicoes_kanban_core($1, $2::uuid[]) AS c`, [l.tenant_id, elegiveis])).c
          : {};
        const { rows: lote } = await c.query(`SELECT * FROM public._kanban_derivar_lote($1, NULL)`, [l.tenant_id]);
        expect(lote.length, l.tenant_id).toBe(mods.length);
        for (const m of mods) {
          const s = lote.find((x) => x.modelo_id === m.id);
          const sql = {
            derivavel: s.derivavel, entrada: s.entrada, alvo: s.alvo, resultado: s.resultado,
            fixado: s.fixado, primeiraFalha: s.primeira_falha, faltando: s.faltando,
          };
          expect(sql, `${l.tenant_id} ${m.id}`).toEqual(derivarModelo(m, cfg, cond[m.id] ?? {}));
        }
      }
    });
  });

  it("desempenho: derivação da maior loja (Ave Rara, ~250 modelos) em < 3 s — 1 chamada ao core por lote", async () => {
    await withTx(async (c) => {
      await prepara(c, 2);
      const t0 = Date.now();
      const r = await um<{ n: string }>(c, `SELECT count(*) AS n FROM public._kanban_derivar_lote($1, NULL) WHERE derivavel`, [AVE_RARA]);
      const ms = Date.now() - t0;
      console.info(`[kanban-auto] _kanban_derivar_lote Ave Rara: ${r.n} deriváveis em ${ms} ms`);
      expect(ms).toBeLessThan(3000);
    });
  });
});

// ─────────────────────────── Inverso 2 (Task 9) ───────────────────────────
const FUNCOES_M2 = [
  "_kanban_status_rows_raw(jsonb)", "_kanban_norm(text)", "_kanban_lista(jsonb)", "_kanban_coluna_manual(text,jsonb)",
  "_kanban_req_efetivos(text,text[],jsonb,jsonb)", "_kanban_derivar_puro(text[],jsonb,jsonb,jsonb,text,boolean)",
  "_kanban_faltando_para(text[],jsonb,jsonb,jsonb,text,boolean,text)",
  "_kanban_destino_drop_puro(text[],jsonb,jsonb,jsonb,text,boolean,text)", "_kanban_fluxo(jsonb,boolean)",
  "_kanban_cfg(uuid)", "_kanban_ligado(uuid)", "_kanban_derivar_lote(uuid,uuid[],jsonb)", "_kanban_status_gate(uuid,uuid,text)",
];
async function defFuncao(c: Client, assinatura: string): Promise<string | null> {
  return (await um<{ d: string | null }>(c,
    `SELECT CASE WHEN to_regprocedure($1) IS NULL THEN NULL ELSE pg_get_functiondef(to_regprocedure($1)) END AS d`,
    ["public." + assinatura])).d;
}

describe.skipIf(!hasDb || !MIG_TXN)("kanban-auto — inverso da migration 2 (Task 9)", () => {
  it("desfaz 2: _kanban_status_rows volta BYTE-A-BYTE e as 13 funções novas somem", async () => {
    await withTx(async (c) => {
      const antes = await defFuncao(c, "_kanban_status_rows(uuid)");
      await prepara(c, 2);
      expect(await defFuncao(c, "_kanban_status_rows(uuid)")).not.toBe(antes);
      await aplicarArquivo(c, INVERSOS[2]);
      expect(await defFuncao(c, "_kanban_status_rows(uuid)")).toBe(antes);
      for (const f of FUNCOES_M2) expect(await defFuncao(c, f), f).toBeNull();
      await aplicarArquivo(c, INVERSOS[1]);
    });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd "/Users/sunglee/PLM + Criação/plm-pcp" && DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres KANBAN_AUTO_MIG_TXN=1 npx vitest run --no-file-parallelism tests/integration/kanban-auto.test.ts`
Expected: FAIL — `function public._kanban_cfg(…) does not exist` (e o do inverso: `ENOENT … 20260930130000_kanban_auto_2_derivacao_down.sql`).

- [ ] **Step 3: Implementar** — inserir o bloco abaixo IMEDIATAMENTE ANTES da linha `COMMIT;` de `supabase/migrations/20260930130000_kanban_auto_2_derivacao.sql` (o arquivo termina sempre em `COMMIT;` + linha em branco + `select pg_notify('pgrst', 'reload schema');`). Conferir depois com `grep -c '^COMMIT;$' supabase/migrations/20260930130000_kanban_auto_2_derivacao.sql` = `1` e `grep -n '^BEGIN;$' supabase/migrations/20260930130000_kanban_auto_2_derivacao.sql` = só a linha do topo.
```sql
-- ────────────────────────────────────────────────────────────────────────────
-- C) Leitura (SECURITY DEFINER): config, chave, derivação em LOTE, gate por posição
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._kanban_cfg(_tenant uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'kanban_automatico',          coalesce(tc.kanban_automatico, false),
    'status_kanban',              tc.status_kanban,
    'kanban_requisitos',          coalesce(tc.kanban_requisitos, '{}'::jsonb),
    'kanban_requisitos_excecoes', coalesce(tc.kanban_requisitos_excecoes, '{}'::jsonb),
    'revenda_kanban_colunas',     coalesce(tc.revenda_kanban_colunas, '[]'::jsonb),
    'revenda_kanban_requisitos',  coalesce(tc.revenda_kanban_requisitos, '{}'::jsonb),
    'ref_exibir_status',          tc.ref_exibir_status,
    'explosao_envio_status',      tc.explosao_envio_status)
    FROM public.tenant_config tc
   WHERE tc.tenant_id = _tenant
   LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public._kanban_ligado(_tenant uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT coalesce(
    (SELECT tc.kanban_automatico FROM public.tenant_config tc WHERE tc.tenant_id = _tenant LIMIT 1),
    false);
$function$;

-- Derivação de N modelos com UMA chamada ao core de condições. `_ids` NULL = a loja inteira.
-- `_cfg` NULL = config gravada; a prévia passa a config PROPOSTA. Linha p/ CADA modelo pedido
-- (não derivável → derivavel=false, resultado=status). `reqs/exc/cond/fluxo/elegivel` = o input
-- usado (kanban_mover reusa p/ `_kanban_destino_drop_puro`).
CREATE OR REPLACE FUNCTION public._kanban_derivar_lote(_tenant uuid, _ids uuid[], _cfg jsonb DEFAULT NULL::jsonb)
 RETURNS TABLE(modelo_id uuid, origem text, status_atual text, elegivel boolean, fluxo text[],
               reqs jsonb, exc jsonb, cond jsonb, derivavel boolean, entrada text, alvo text,
               resultado text, fixado boolean, primeira_falha text, faltando text[])
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cfg       jsonb := coalesce(_cfg, public._kanban_cfg(_tenant), '{}'::jsonb);
  v_fluxo_int text[];
  v_fluxo_cmp text[];
  v_ids       uuid[];
  v_cond      jsonb;
BEGIN
  v_fluxo_int := public._kanban_fluxo(v_cfg, false);
  v_fluxo_cmp := public._kanban_fluxo(v_cfg, true);

  SELECT array_agg(m.id) INTO v_ids
    FROM public.modelos m
   WHERE m.tenant_id = _tenant
     AND (_ids IS NULL OR m.id = ANY (_ids))
     AND coalesce(m.ordem_criacao_enviada, false)
     AND NOT coalesce(m.lancado, false);
  v_cond := CASE WHEN v_ids IS NULL THEN '{}'::jsonb
                 ELSE coalesce(public._avaliar_condicoes_kanban_core(_tenant, v_ids), '{}'::jsonb) END;

  RETURN QUERY
  WITH base AS (
    SELECT m.id AS mid,
           coalesce(m.origem, 'interno') AS org,
           m.status_desenvolvimento::text AS st,
           (coalesce(m.ordem_criacao_enviada, false) AND NOT coalesce(m.lancado, false)) AS eleg,
           (coalesce(m.origem, 'interno') IN ('revenda', 'importado')) AS cmp
      FROM public.modelos m
     WHERE m.tenant_id = _tenant
       AND (_ids IS NULL OR m.id = ANY (_ids))
  ), ent AS (
    SELECT b.*,
           CASE WHEN b.cmp THEN v_fluxo_cmp ELSE v_fluxo_int END AS fl,
           CASE WHEN b.cmp THEN coalesce(v_cfg -> 'revenda_kanban_requisitos', '{}'::jsonb)
                ELSE coalesce(v_cfg -> 'kanban_requisitos', '{}'::jsonb) END AS rq,
           CASE WHEN b.cmp THEN '{}'::jsonb
                ELSE coalesce(v_cfg -> 'kanban_requisitos_excecoes', '{}'::jsonb) END AS ex,
           coalesce(v_cond -> b.mid::text, '{}'::jsonb) AS cd
      FROM base b
  )
  SELECT e.mid, e.org, e.st, e.eleg, e.fl, e.rq, e.ex, e.cd,
         (x.d ->> 'derivavel')::boolean, x.d ->> 'entrada', x.d ->> 'alvo', x.d ->> 'resultado',
         (x.d ->> 'fixado')::boolean, x.d ->> 'primeiraFalha',
         ARRAY(SELECT f.v FROM jsonb_array_elements_text(x.d -> 'faltando') WITH ORDINALITY AS f(v, o) ORDER BY f.o)
    FROM ent e
    CROSS JOIN LATERAL (SELECT public._kanban_derivar_puro(e.fl, e.rq, e.ex, e.cd, e.st, e.eleg) AS d OFFSET 0) x;  -- OFFSET 0: avalia 1× por modelo (sem isso o planner replica a chamada em cada coluna)
END;
$function$;

-- ≡ statusParaGate (TS) — decisão 10: status a usar nos gates por POSIÇÃO (Enviar à Explosão,
-- revelar REF). Chave desligada, GUC do motor (o motor já grava a derivada) ou card não
-- derivável → o status gravado; senão a posição DERIVADA (`alvo`).
CREATE OR REPLACE FUNCTION public._kanban_status_gate(_tenant uuid, _modelo_id uuid, _status_atual text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_derivavel boolean;
  v_alvo      text;
BEGIN
  IF _tenant IS NULL OR _modelo_id IS NULL OR NOT public._kanban_ligado(_tenant) THEN
    RETURN _status_atual;
  END IF;
  IF coalesce(current_setting('app.kanban_sistema', true), '') IN ('auto', 'config', 'restauracao') THEN
    RETURN _status_atual;
  END IF;
  SELECT d.derivavel, d.alvo INTO v_derivavel, v_alvo
    FROM public._kanban_derivar_lote(_tenant, ARRAY[_modelo_id]) d
   LIMIT 1;
  IF NOT FOUND OR NOT coalesce(v_derivavel, false) OR v_alvo IS NULL THEN
    RETURN _status_atual;
  END IF;
  RETURN v_alvo;
END;
$function$;

-- Invariante #9 — internas sem EXECUTE p/ PUBLIC/anon/authenticated.
REVOKE EXECUTE ON FUNCTION public._kanban_cfg(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._kanban_ligado(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._kanban_derivar_lote(uuid, uuid[], jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._kanban_status_gate(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
```

- [ ] **Step 4: Criar `supabase/rollback/20260930130000_kanban_auto_2_derivacao_down.sql`** (o `_kanban_status_rows` abaixo é o texto BYTE-A-BYTE de `funcoes.sql:3455-3503`, conferido por md5 contra o banco vivo em 23/set)

```sql
-- INVERSO de 20260930130000_kanban_auto_2_derivacao.sql — rodar depois do inverso 3 (ordem 4 → 3 → 2 → 1).
-- Recria `_kanban_status_rows` com o texto BYTE-A-BYTE do snapshot (funcoes.sql:3455-3503) ANTES de
-- derrubar `_kanban_status_rows_raw`, e derruba as funções novas de derivação. Não toca dado.
-- Pré-requisito: o inverso 3 já rodou (fn_modelo_ref_auto/_enviar_modelo_para_cad_core/
-- _kanban_regredir_modelo do snapshot não chamam `_kanban_status_gate`/`_kanban_ligado`).

BEGIN;

CREATE OR REPLACE FUNCTION public._kanban_status_rows(_tenant uuid)
 RETURNS TABLE(ord integer, key text, lbl text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_raw jsonb;
BEGIN
  SELECT status_kanban INTO v_raw FROM public.tenant_config WHERE tenant_id = _tenant;

  IF v_raw IS NULL OR jsonb_typeof(v_raw) <> 'array' OR jsonb_array_length(v_raw) = 0 THEN
    RETURN QUERY SELECT g.o, g.k, g.l FROM (VALUES
      (1, 'em_modelagem', 'Em Modelagem'),
      (2, 'corte_piloto_1', 'Corte de Piloto I'),
      (3, 'corte_piloto_2', 'Corte de Piloto II'),
      (4, 'corte_piloto_3', 'Corte de Piloto III'),
      (5, 'em_pilotagem', 'Em Pilotagem'),
      (6, 'prova_roupa_1', 'Prova de Roupa I'),
      (7, 'prova_roupa_2', 'Prova de Roupa II'),
      (8, 'prova_roupa_3', 'Prova de Roupa III'),
      (9, 'prova_roupa_4', 'Prova de Roupa IV'),
      (10, 'prova_roupa_5', 'Prova de Roupa V'),
      (11, 'em_ajuste', 'Em Ajuste'),
      (12, 'stand_by', 'Stand By'),
      (13, 'reprovado', 'Reprovado'),
      (14, 'aprovado', 'Aprovado')
    ) AS g(o, k, l);
    RETURN;
  END IF;

  RETURN QUERY
  SELECT t.ord::int,
    CASE
      WHEN jsonb_typeof(t.elem) = 'string'
        THEN public._kanban_resolve_key(t.elem #>> '{}')
      ELSE COALESCE(
        t.elem->>'key', t.elem->>'id', t.elem->>'value', t.elem->>'slug',
        public._kanban_resolve_key(COALESCE(t.elem->>'label', t.elem->>'nome', t.elem->>'name', '')))
    END,
    CASE
      WHEN jsonb_typeof(t.elem) = 'string'
        THEN t.elem #>> '{}'
      ELSE COALESCE(t.elem->>'label', t.elem->>'nome', t.elem->>'name', t.elem->>'key', '')
    END
  FROM jsonb_array_elements(v_raw) WITH ORDINALITY AS t(elem, ord)
  WHERE jsonb_typeof(t.elem) IN ('string', 'object');
END;
$function$
;

DROP FUNCTION IF EXISTS public._kanban_status_gate(uuid, uuid, text);
DROP FUNCTION IF EXISTS public._kanban_derivar_lote(uuid, uuid[], jsonb);
DROP FUNCTION IF EXISTS public._kanban_ligado(uuid);
DROP FUNCTION IF EXISTS public._kanban_cfg(uuid);
DROP FUNCTION IF EXISTS public._kanban_fluxo(jsonb, boolean);
DROP FUNCTION IF EXISTS public._kanban_destino_drop_puro(text[], jsonb, jsonb, jsonb, text, boolean, text);
DROP FUNCTION IF EXISTS public._kanban_faltando_para(text[], jsonb, jsonb, jsonb, text, boolean, text);
DROP FUNCTION IF EXISTS public._kanban_derivar_puro(text[], jsonb, jsonb, jsonb, text, boolean);
DROP FUNCTION IF EXISTS public._kanban_req_efetivos(text, text[], jsonb, jsonb);
DROP FUNCTION IF EXISTS public._kanban_coluna_manual(text, jsonb);
DROP FUNCTION IF EXISTS public._kanban_lista(jsonb);
DROP FUNCTION IF EXISTS public._kanban_norm(text);
DROP FUNCTION IF EXISTS public._kanban_status_rows_raw(jsonb);

COMMIT;

select pg_notify('pgrst', 'reload schema');
```

- [ ] **Step 5: Rodar e ver passar**

Run: `cd "/Users/sunglee/PLM + Criação/plm-pcp" && DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres KANBAN_AUTO_MIG_TXN=1 npx vitest run --no-file-parallelism tests/integration/kanban-auto.test.ts`
Expected: PASS (21 testes). O teste de desempenho imprime `[kanban-auto] _kanban_derivar_lote Ave Rara: N deriváveis em X ms` (23/set: ~450 ms no banco real; ~120–135 ms na cópia local).

- [ ] **Step 6: Gates + commit**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp"
npm run build 2>&1 | tail -3
npx tsc --noEmit 2>&1 | grep -E "TS2304|error" ; true
npx vitest run --no-file-parallelism tests/unit/kanban-auto.test.ts tests/unit/kanban-status.test.ts
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres KANBAN_AUTO_MIG_TXN=1 npx vitest run --no-file-parallelism tests/integration/kanban-auto.test.ts tests/integration/kanban-condicoes.test.ts
```
```bash
git add -- supabase/rollback/20260930130000_kanban_auto_2_derivacao_down.sql
git commit --only -m "feat(kanban-auto): migration 2C — config/chave/derivação em lote/gate por posição + inverso 2

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- supabase/rollback/20260930130000_kanban_auto_2_derivacao_down.sql supabase/migrations/20260930130000_kanban_auto_2_derivacao.sql tests/integration/kanban-auto.test.ts
git show --stat HEAD | tail -n +7   # confere: SÓ os paths acima
```

---

### Task 10: Migration 3 (parte A) — `fn_kanban_historico` com origem, lote e JANELA de 10 s

**Files:**
- Create: `supabase/migrations/20260930140000_kanban_auto_3_motor.sql`
- Modify: `tests/integration/kanban-auto.test.ts`

**Interfaces:**
- Consumes: `modelo_kanban_historico.origem/lote_id` (Task 5); gatilho existente `trg_kanban_historico AFTER INSERT OR UPDATE OF status_desenvolvimento ON modelos` (não é recriado — só a função muda).
- Produces: `public.fn_kanban_historico()` redefinida (snapshot `funcoes.sql:11976-11995`): origem = `app.kanban_sistema` (`auto|config|manual|restauracao`; vazio/outro → `manual`); `lote_id` = `app.kanban_lote` se for uuid; `created_at = clock_timestamp()` (D7); colapso por janela SÓ para `auto` (§3); `restauracao` não insere quando a última linha já tem o mesmo status (D14). Helpers de teste usados até a Task 17: `T`, `HOJE`, `BOARD`, `REQS`, `configurarBoard(c, {reqs?, exc?, ref?, explosao?})` (desliga a chave e reescreve a config da Loja Teste NA TXN), `chave(c, ligada)` (liga/desliga como a RPC `kanban_definir_automatico`: GUC `app.kanban_chave='rpc'` — sem ele a trava da decisão 16, Task 13, ignora a mudança; antes da migration 3 o GUC é inócuo), `comoSistema(c, fn)` (escritas de preparação com GUC `'teste'`: não enfileiram nem passam pelo guard), `novoModelo(c, campos) → id`, `setar(c, id, campos)`, `lerModelo(c, id) → {status, rp, erro, ref, ref_auto, rev, motivo}`, `historico(c, id) → string[] "status:origem"`, `tamanhoFila(c)`, `envelhecerHistorico(c, id)` (−1 min), `imediato(c)` (SET CONSTRAINTS ALL IMMEDIATE + DEFERRED), `comoSemPermissao(c, uid?)`, `guc(c, valor)`.
- Board sintético dos testes: `entrada(manual) · etapa_a{data_desenho_tecnico} · etapa_b{data_piloto1} · stand_by(manual) · etapa_c{data_piloto2} · reprovado(manual) · aprovado{data_aprovacao}`.

- [ ] **Step 1: Acrescentar os helpers do motor e os testes do histórico**

```ts
// ─────────────────── Helpers do motor (Tasks 10–16) ───────────────────
const T = TENANT_TESTE;
const HOJE = "2026-09-01";
// Board sintético da Loja Teste (reescrito DENTRO da txn): entrada(manual) · etapa_a{ddt} · etapa_b{p1} ·
// stand_by(manual) · etapa_c{p2} · reprovado(manual) · aprovado{dap}. Keys: normalizeKanbanStatuses.
const BOARD = ["Entrada", "Etapa A", "Etapa B", "Stand By", "Etapa C", "Reprovado", "Aprovado"];
const REQS: Record<string, string[]> = {
  etapa_a: ["data_desenho_tecnico"], etapa_b: ["data_piloto1"], etapa_c: ["data_piloto2"], aprovado: ["data_aprovacao"],
};

/** Desliga a chave e reescreve a config da Loja Teste NA TXN (ligar é sempre explícito: `chave`). */
async function configurarBoard(c: Client, opts: { reqs?: Record<string, string[]>; exc?: Record<string, string[]>; ref?: string; explosao?: string } = {}) {
  await chave(c, false); // antes do board: com a chave ligada, mudar o board gravaria um lote 'config'
  await c.query(
    `UPDATE public.tenant_config
        SET status_kanban = $2::jsonb, kanban_requisitos = $3::jsonb, kanban_requisitos_excecoes = $4::jsonb,
            revenda_kanban_colunas = '[]'::jsonb, revenda_kanban_requisitos = '{}'::jsonb,
            ref_exibir_status = $5, explosao_envio_status = $6
      WHERE tenant_id = $1`,
    [T, JSON.stringify(BOARD), JSON.stringify(opts.reqs ?? REQS), JSON.stringify(opts.exc ?? {}), opts.ref ?? "etapa_c", opts.explosao ?? "etapa_c"],
  );
}
/** Liga/desliga a chave da Loja Teste como a RPC `kanban_definir_automatico` faz: GUC transação-local
 *  `app.kanban_chave='rpc'` (sem ele, `trg_kanban_chave_protegida` mantém o valor — decisão 16). */
async function chave(c: Client, ligada: boolean) {
  await c.query(`SELECT set_config('app.kanban_chave', 'rpc', true)`);
  try {
    await c.query(`UPDATE public.tenant_config SET kanban_automatico = $2 WHERE tenant_id = $1`, [T, ligada]);
  } finally {
    await c.query(`SELECT set_config('app.kanban_chave', '', true)`);
  }
}
/** Escritas de PREPARAÇÃO do teste que não devem acionar enfileirador/guard (GUC não vazio). */
async function comoSistema<R>(c: Client, fn: () => Promise<R>): Promise<R> {
  await c.query(`SELECT set_config('app.kanban_sistema', 'teste', true)`);
  try {
    return await fn();
  } finally {
    await c.query(`SELECT set_config('app.kanban_sistema', '', true)`);
  }
}
async function novoModelo(c: Client, campos: Record<string, unknown> = {}): Promise<string> {
  const base = await um<{ c: string | null; s: string | null }>(c,
    `SELECT categoria_principal_id AS c, subcategoria1_id AS s FROM public.modelos
      WHERE tenant_id = $1 AND categoria_principal_id IS NOT NULL AND subcategoria1_id IS NOT NULL LIMIT 1`, [T]);
  const cols: Record<string, unknown> = {
    tenant_id: T, nome: "KA teste", ordem_criacao_enviada: true, status_desenvolvimento: "entrada",
    categoria_principal_id: base?.c ?? null, subcategoria1_id: base?.s ?? null, ...campos,
  };
  const nomes = Object.keys(cols);
  const r = await um<{ id: string }>(c,
    `INSERT INTO public.modelos (${nomes.join(", ")}) VALUES (${nomes.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`,
    Object.values(cols));
  return r.id;
}
async function setar(c: Client, id: string, campos: Record<string, unknown>) {
  const nomes = Object.keys(campos);
  await c.query(`UPDATE public.modelos SET ${nomes.map((n, i) => `${n} = $${i + 2}`).join(", ")} WHERE id = $1`,
    [id, ...Object.values(campos)]);
}
async function lerModelo(c: Client, id: string) {
  const r = await um<{ status: string | null; rp: Record<string, unknown>; ref: string | null; ref_auto: string | null; rev: number; motivo: string | null }>(c,
    `SELECT status_desenvolvimento AS status, revisao_pendente AS rp, ref, ref_auto, rev, motivo_cancelamento AS motivo
       FROM public.modelos WHERE id = $1`, [id]);
  return { ...r, erro: r.rp?.kanban === true };
}
async function historico(c: Client, id: string): Promise<string[]> {
  const { rows } = await c.query(
    `SELECT status, origem FROM public.modelo_kanban_historico WHERE modelo_id = $1 ORDER BY entrou_at, created_at`, [id]);
  return rows.map((r) => `${r.status}:${r.origem}`);
}
async function tamanhoFila(c: Client): Promise<number> {
  return Number((await um<{ n: string }>(c, `SELECT count(*) AS n FROM public.kanban_recalculo_fila`)).n);
}
async function envelhecerHistorico(c: Client, id: string) {
  await c.query(`UPDATE public.modelo_kanban_historico SET entrou_at = entrou_at - interval '1 minute' WHERE modelo_id = $1`, [id]);
}
/** Simula o COMMIT p/ o constraint trigger adiado e volta ao modo adiado. */
async function imediato(c: Client) {
  await c.query("SET CONSTRAINTS ALL IMMEDIATE");
  await c.query("SET CONSTRAINTS ALL DEFERRED");
}
async function comoSemPermissao(c: Client, uid = "00000000-0000-4000-8000-00000000ab01") {
  await c.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [uid, `${uid}@teste`]);
  await c.query(`INSERT INTO public.users (id, tenant_id, email, nome) VALUES ($1, $2, $3, 'KA Sem Perm')
                 ON CONFLICT (id) DO UPDATE SET tenant_id = excluded.tenant_id`, [uid, T, `${uid}@teste`]);
  await c.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: "authenticated" })]);
}
async function guc(c: Client, valor: string) {
  await c.query(`SELECT set_config('app.kanban_sistema', $1, true)`, [valor]);
}

// ─────────────────── Migration 3A — histórico com origem e janela (Task 10) ───────────────────
describe.skipIf(!PRONTO)("kanban-auto — migration 3A: fn_kanban_historico (Task 10)", () => {
  it("escrita de fora do motor SEMPRE insere, com origem 'manual' (inclusive o INSERT do modelo)", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await configurarBoard(c);
      const M = await novoModelo(c);
      await setar(c, M, { status_desenvolvimento: "stand_by" });
      await setar(c, M, { status_desenvolvimento: "entrada" });
      expect(await historico(c, M)).toEqual(["entrada:manual", "stand_by:manual", "entrada:manual"]);
    });
  });

  it("'auto' na janela de 10 s: ATUALIZA a última; voltar à penúltima APAGA; fora da janela INSERE", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await configurarBoard(c);
      const M = await novoModelo(c);
      await guc(c, "auto");
      await setar(c, M, { status_desenvolvimento: "etapa_a" });
      expect(await historico(c, M)).toEqual(["entrada:manual", "etapa_a:auto"]); // última não era auto → insere
      await setar(c, M, { status_desenvolvimento: "etapa_c" });
      expect(await historico(c, M)).toEqual(["entrada:manual", "etapa_c:auto"]); // colapsa (atualiza)
      await setar(c, M, { status_desenvolvimento: "entrada" });
      expect(await historico(c, M)).toEqual(["entrada:manual"]); // voltou à penúltima → o transitório nunca existiu
      await setar(c, M, { status_desenvolvimento: "etapa_a" });
      await envelhecerHistorico(c, M);
      await setar(c, M, { status_desenvolvimento: "etapa_b" });
      expect(await historico(c, M)).toEqual(["entrada:manual", "etapa_a:auto", "etapa_b:auto"]); // fora da janela → insere
      await guc(c, "");
    });
  });

  it("'config'/'restauracao'/'manual' nunca colapsam e gravam o lote do GUC app.kanban_lote", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await configurarBoard(c);
      const M = await novoModelo(c);
      const lote = "11111111-2222-4333-8444-555555555555";
      await c.query(`SELECT set_config('app.kanban_lote', $1, true)`, [lote]);
      await guc(c, "config");
      await setar(c, M, { status_desenvolvimento: "etapa_a" });
      await setar(c, M, { status_desenvolvimento: "etapa_b" });
      await guc(c, "restauracao");
      await setar(c, M, { status_desenvolvimento: "entrada" });
      await guc(c, "");
      await c.query(`SELECT set_config('app.kanban_lote', '', true)`);
      expect(await historico(c, M)).toEqual(["entrada:manual", "etapa_a:config", "etapa_b:config", "entrada:restauracao"]);
      const { rows } = await c.query(
        `SELECT lote_id FROM public.modelo_kanban_historico WHERE modelo_id = $1 AND origem <> 'manual'`, [M]);
      expect(rows.every((r) => r.lote_id === lote)).toBe(true);
      // D14 (dono, 23/set): 'restauracao' p/ o status que a ÚLTIMA linha restante já tem NÃO insere
      // (kanban_restaurar apaga antes as linhas auto/config do lote — simulado aqui apagando a última)
      await guc(c, "config");
      await setar(c, M, { status_desenvolvimento: "etapa_a" });
      await c.query(
        `DELETE FROM public.modelo_kanban_historico WHERE id = (SELECT id FROM public.modelo_kanban_historico
          WHERE modelo_id = $1 ORDER BY entrou_at DESC, created_at DESC LIMIT 1)`, [M]);
      await guc(c, "restauracao");
      await setar(c, M, { status_desenvolvimento: "entrada" });
      await guc(c, "");
      expect(await historico(c, M)).toEqual(["entrada:manual", "etapa_a:config", "etapa_b:config", "entrada:restauracao"]);
    });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd "/Users/sunglee/PLM + Criação/plm-pcp" && DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres KANBAN_AUTO_MIG_TXN=1 npx vitest run --no-file-parallelism tests/integration/kanban-auto.test.ts`
Expected: FAIL — `ENOENT … 20260930140000_kanban_auto_3_motor.sql`.

- [ ] **Step 3: Criar `supabase/migrations/20260930140000_kanban_auto_3_motor.sql` (cabeçalho + parte A + fechamento)**

```sql
-- Kanban automático — F1 · migration 3/4: MOTOR (histórico c/ janela, fila adiada, aplicar,
-- enfileiradores, gatilho da Config c/ snapshot, guard, gates por posição)
-- ============================================================================
-- Plano: docs/superpowers/plans/2026-09-22-kanban-automatico-f1-banco.md (Tasks 10–14, §3).
-- Inverso pareado: supabase/rollback/20260930140000_kanban_auto_3_motor_down.sql.
--
-- CHAVE DESLIGADA (tenant_config.kanban_automatico=false, default) = comportamento IDÊNTICO ao
-- de hoje: `_kanban_enfileirar` não insere nada (JOIN na chave), o guard e o gatilho da Config
-- saem cedo, `_kanban_status_gate` devolve o status gravado e `_kanban_regredir_modelo` roda o
-- legado inteiro. A única diferença observável é o histórico ganhar `origem='manual'` + created_at
-- preciso (clock_timestamp) nas linhas novas.
--
-- GUC transação-local `app.kanban_sistema` ('' | auto | config | manual | restauracao) +
-- `app.kanban_lote` (uuid|''): marca quem está escrevendo o status. Enfileiradores NÃO
-- enfileiram com GUC não vazio (trava de recursão); guard deixa passar; o histórico grava a origem.
-- Quem seta o GUC SEMPRE restaura o valor anterior antes de sair.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- A) Histórico: origem + lote + colapso por JANELA de 10 s (só escritas 'auto')
--    Redefine fn_kanban_historico (snapshot funcoes.sql:11976-11995). `created_at` passa a ser
--    clock_timestamp() (desempate dentro da MESMA txn, onde now() é constante).
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_kanban_historico()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sis    text := coalesce(current_setting('app.kanban_sistema', true), '');
  v_lote_s text := coalesce(current_setting('app.kanban_lote', true), '');
  v_origem text;
  v_lote   uuid;
  v_ult_id uuid;
  v_ult_or text;
  v_ult_em timestamptz;
  v_ult_st text;
  v_pen    text;
BEGIN
  v_origem := CASE WHEN v_sis IN ('auto', 'config', 'manual', 'restauracao') THEN v_sis ELSE 'manual' END;
  v_lote := CASE WHEN v_lote_s ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                 THEN v_lote_s::uuid END;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status_desenvolvimento IS NOT NULL THEN
      INSERT INTO public.modelo_kanban_historico(tenant_id, modelo_id, status, entrou_at, created_at, origem, lote_id)
      VALUES (NEW.tenant_id, NEW.id, NEW.status_desenvolvimento, COALESCE(NEW.created_at, now()),
              clock_timestamp(), v_origem, v_lote);
    END IF;
  ELSIF NEW.status_desenvolvimento IS DISTINCT FROM OLD.status_desenvolvimento
        AND NEW.status_desenvolvimento IS NOT NULL THEN
    IF v_origem IN ('auto', 'restauracao') THEN
      SELECT h.id, h.origem, h.entrou_at, h.status INTO v_ult_id, v_ult_or, v_ult_em, v_ult_st
        FROM public.modelo_kanban_historico h
       WHERE h.modelo_id = NEW.id
       ORDER BY h.entrou_at DESC, h.created_at DESC
       LIMIT 1;
    END IF;
    -- D14 (dono, 23/set): a restauração não repete a coluna que a última linha RESTANTE já tem
    -- (kanban_restaurar apaga antes as linhas auto/config do lote) — sem amostra extra no Leadtime.
    IF v_origem = 'restauracao' AND v_ult_id IS NOT NULL
       AND v_ult_st IS NOT DISTINCT FROM NEW.status_desenvolvimento THEN
      RETURN NEW;
    END IF;
    IF v_origem = 'auto' THEN
      IF v_ult_id IS NOT NULL AND v_ult_or = 'auto' AND v_ult_em > now() - interval '10 seconds' THEN
        SELECT h.status INTO v_pen
          FROM public.modelo_kanban_historico h
         WHERE h.modelo_id = NEW.id AND h.id <> v_ult_id
         ORDER BY h.entrou_at DESC, h.created_at DESC
         LIMIT 1;
        IF v_pen IS NOT DISTINCT FROM NEW.status_desenvolvimento THEN
          -- voltou à penúltima dentro da janela: o recuo/avanço transitório nunca existiu
          DELETE FROM public.modelo_kanban_historico WHERE id = v_ult_id;
        ELSE
          UPDATE public.modelo_kanban_historico
             SET status = NEW.status_desenvolvimento, entrou_at = now(),
                 created_at = clock_timestamp(), lote_id = v_lote
           WHERE id = v_ult_id;
        END IF;
        RETURN NEW;
      END IF;
    END IF;
    INSERT INTO public.modelo_kanban_historico(tenant_id, modelo_id, status, entrou_at, created_at, origem, lote_id)
    VALUES (NEW.tenant_id, NEW.id, NEW.status_desenvolvimento, now(), clock_timestamp(), v_origem, v_lote);
  END IF;
  RETURN NEW;
END;
$function$;
COMMIT;

select pg_notify('pgrst', 'reload schema');
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd "/Users/sunglee/PLM + Criação/plm-pcp" && DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres KANBAN_AUTO_MIG_TXN=1 npx vitest run --no-file-parallelism tests/integration/kanban-auto.test.ts`
Expected: PASS (24 testes).

- [ ] **Step 5: Gates + commit**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp"
npm run build 2>&1 | tail -3
npx tsc --noEmit 2>&1 | grep -E "TS2304|error" ; true
npx vitest run --no-file-parallelism tests/unit/kanban-auto.test.ts tests/unit/kanban-status.test.ts
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres KANBAN_AUTO_MIG_TXN=1 npx vitest run --no-file-parallelism tests/integration/kanban-auto.test.ts tests/integration/kanban-condicoes.test.ts
```
```bash
git add -- supabase/migrations/20260930140000_kanban_auto_3_motor.sql
git commit --only -m "feat(kanban-auto): migration 3A — histórico com origem/lote e colapso por janela de 10 s

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- supabase/migrations/20260930140000_kanban_auto_3_motor.sql tests/integration/kanban-auto.test.ts
git show --stat HEAD | tail -n +7   # confere: SÓ os paths acima
```

---

### Task 11: Migration 3 (parte B) — fila ADIADA p/ o COMMIT e `_kanban_aplicar` (sem `#Erro` — decisão 14)

**Files:**
- Modify: `supabase/migrations/20260930140000_kanban_auto_3_motor.sql` (inserir antes do `COMMIT;`)
- Modify: `tests/integration/kanban-auto.test.ts`

**Interfaces:**
- Consumes: `_kanban_ligado`, `_kanban_cfg`, `_kanban_fluxo`, `_kanban_norm`, `_kanban_derivar_lote` (Task 9); `public._ref_exibir_gate(_tenant uuid, _status text) → boolean` (existente); `kanban_recalculo_fila` (Task 5); `fn_kanban_historico` (Task 10).
- Produces:
  - `_kanban_enfileirar(_ids uuid[]) → void` (DEFINER, revogado): insere na fila só modelo DERIVÁVEL de loja com a chave ligada; sai cedo com GUC não vazio (trava de recursão); `ON CONFLICT DO NOTHING`
  - `_kanban_enfileirar_tenant(_tenant uuid) → void` (DEFINER, revogado): a loja inteira (categorias)
  - `_kanban_aplicar(_tenant uuid, _ids uuid[], _origem text, _lote uuid DEFAULT NULL) → integer` (DEFINER, revogado; D8): chave desligada → 0; seta `app.kanban_sistema=_origem`/`app.kanban_lote` transação-local e RESTAURA os anteriores; UM `UPDATE` só onde muda status ou revela REF de fixado; NÃO escreve `revisao_pendente` (decisão 14 — recuo automático não acende `#Erro`); devolve nº de cards que mudaram
  - `fn_kanban_processar_fila()` + `CONSTRAINT TRIGGER trg_kanban_processar_fila AFTER INSERT ON kanban_recalculo_fila DEFERRABLE INITIALLY DEFERRED FOR EACH ROW` — drena a fila da loja no COMMIT; erro vira `WARNING 'Kanban automático: recálculo ignorado (loja …, N card(s)): …'`
- Teste: `aplicar(c, ids|null, origem='auto') → number`.

- [ ] **Step 1: Acrescentar os testes**

```ts
// ─────────────── Migration 3B — fila adiada, _kanban_aplicar e #Erro (Task 11) ───────────────
async function aplicar(c: Client, ids: string[] | null, origem = "auto"): Promise<number> {
  return (await um<{ n: number }>(c, `SELECT public._kanban_aplicar($1, $2::uuid[], $3) AS n`, [T, ids, origem])).n;
}

describe.skipIf(!PRONTO)("kanban-auto — migration 3B: fila + _kanban_aplicar (Task 11)", () => {
  it("chave DESLIGADA: _kanban_aplicar devolve 0 e não muda nada; _kanban_enfileirar não insere", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await configurarBoard(c);
      const M = await comoSistema(c, () => novoModelo(c, { data_desenho_tecnico: HOJE, data_piloto1: HOJE }));
      expect(await aplicar(c, [M])).toBe(0);
      expect(await aplicar(c, null, "config")).toBe(0);
      await c.query(`SELECT public._kanban_enfileirar(ARRAY[$1]::uuid[])`, [M]);
      expect(await tamanhoFila(c)).toBe(0);
      expect((await lerModelo(c, M)).status).toBe("entrada");
    });
  });

  it("fila ADIADA: entrar na fila não muda nada até o COMMIT; no COMMIT deriva o lote e esvazia", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await configurarBoard(c);
      await chave(c, true);
      const M = await comoSistema(c, () => novoModelo(c, { data_desenho_tecnico: HOJE }));
      await c.query(`DELETE FROM public.kanban_recalculo_fila`);
      await c.query(`INSERT INTO public.kanban_recalculo_fila (modelo_id, tenant_id) VALUES ($1, $2)`, [M, T]);
      expect((await lerModelo(c, M)).status).toBe("entrada");
      await imediato(c);
      expect((await lerModelo(c, M)).status).toBe("etapa_a");
      expect(await tamanhoFila(c)).toBe(0);
      expect(await historico(c, M)).toEqual(["entrada:manual", "etapa_a:auto"]);
    });
  });

  it("cascata: avança só até a última automática satisfeita ANTES da 1ª que falha (não pula); GUC volta ao anterior", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await configurarBoard(c);
      await chave(c, true);
      const M = await comoSistema(c, () => novoModelo(c, { data_desenho_tecnico: HOJE, data_piloto2: HOJE }));
      expect(await aplicar(c, [M])).toBe(1);
      expect((await lerModelo(c, M)).status).toBe("etapa_a"); // c satisfeita, b não → preso antes de b
      await comoSistema(c, () => setar(c, M, { data_piloto1: HOJE }));
      await aplicar(c, [M]);
      expect((await lerModelo(c, M)).status).toBe("etapa_c"); // stand_by (manual) é pulada
      expect(await aplicar(c, [M])).toBe(0); // nada muda → não grava
      const g = await um<{ s: string; l: string }>(c,
        `SELECT current_setting('app.kanban_sistema', true) AS s, current_setting('app.kanban_lote', true) AS l`);
      expect(g).toEqual({ s: "", l: "" });
    });
  });

  it("exceção configurada NÃO pula coluna no motor (G-inicial #3): etapa_c ignora data_piloto1, mas etapa_b ainda exige", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await configurarBoard(c, { exc: { etapa_c: ["data_piloto1"] } });
      await chave(c, true);
      const M = await comoSistema(c, () => novoModelo(c, { data_desenho_tecnico: HOJE, data_piloto2: HOJE }));
      await aplicar(c, [M]);
      expect((await lerModelo(c, M)).status).toBe("etapa_a"); // etapa_c estaria "satisfeita", mas etapa_b falha antes
      await comoSistema(c, () => setar(c, M, { data_piloto1: HOJE }));
      await aplicar(c, [M]);
      expect((await lerModelo(c, M)).status).toBe("etapa_c");
    });
  });

  it("#Erro (decisão 14): com a chave ligada o motor NUNCA acende nem apaga — recuo só devolve o card à coluna devida", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await configurarBoard(c);
      await chave(c, true);
      const M = await comoSistema(c, () => novoModelo(c, { data_desenho_tecnico: HOJE, data_piloto1: HOJE, data_piloto2: HOJE }));
      await aplicar(c, [M]); // → etapa_c
      await envelhecerHistorico(c, M); // fora da janela de 10 s: recuo "real"
      await comoSistema(c, () => setar(c, M, { data_piloto1: null }));
      await aplicar(c, [M]);
      let m = await lerModelo(c, M);
      expect([m.status, m.erro]).toEqual(["etapa_a", false]); // volta p/ a coluna devida, SEM #Erro
      await comoSistema(c, () => setar(c, M, { data_piloto1: HOJE }));
      await aplicar(c, [M]); // → etapa_c
      await comoSistema(c, () => setar(c, M, { data_desenho_tecnico: null }));
      await aplicar(c, [M]); // recuo dentro da janela: idem
      m = await lerModelo(c, M);
      expect([m.status, m.erro]).toEqual(["entrada", false]);
      // #Erro LEGADO (aceso quando a chave estava desligada) o motor não apaga: só o kanban_mover (Task 15) — D20
      await comoSistema(c, () => c.query(`UPDATE public.modelos SET revisao_pendente = '{"kanban": true}' WHERE id = $1`, [M]));
      await comoSistema(c, () => setar(c, M, { data_desenho_tecnico: HOJE }));
      await aplicar(c, [M]); // avanço 'auto'
      m = await lerModelo(c, M);
      expect([m.status, m.erro]).toEqual(["etapa_c", true]);
      await comoSistema(c, () => setar(c, M, { data_piloto1: null }));
      await aplicar(c, [M], "config"); // recuo por 'config': também não mexe
      m = await lerModelo(c, M);
      expect([m.status, m.erro]).toEqual(["etapa_a", true]);
      expect((await historico(c, M)).at(-1)).toBe("etapa_a:config");
    });
  });

  it("fixado não anda; a REF dele é revelada quando a POSIÇÃO DERIVADA atinge ref_exibir_status", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await configurarBoard(c, { ref: "etapa_c" });
      await chave(c, true);
      const M = await comoSistema(c, () => novoModelo(c, { status_desenvolvimento: "stand_by", data_desenho_tecnico: HOJE }));
      await comoSistema(c, () => c.query(`UPDATE public.modelos SET ref = '' WHERE id = $1`, [M]));
      await aplicar(c, [M]);
      let m = await lerModelo(c, M);
      expect([m.status, m.ref ?? ""]).toEqual(["stand_by", ""]); // derivada = etapa_a < etapa_c
      expect(m.ref_auto ?? "").not.toBe("");
      await comoSistema(c, () => setar(c, M, { data_piloto1: HOJE, data_piloto2: HOJE }));
      expect(await aplicar(c, [M])).toBe(0); // status não muda…
      m = await lerModelo(c, M);
      expect(m.status).toBe("stand_by");
      expect(m.ref).toBe(m.ref_auto); // …mas a REF é revelada
    });
  });

  // DDL próprio (sabotagem com CREATE OR REPLACE FUNCTION) → SÓ na cópia local (decisão 17), mesmo sem KANBAN_AUTO_MIG_TXN
  it.skipIf(!LOCAL)("erro na derivação vira WARNING: NÃO derruba o COMMIT e a fila esvazia", async () => {
    await withTx(async (c) => {
      const avisos: string[] = [];
      const ouvir = (n: { message?: string }) => avisos.push(String(n.message));
      c.on("notice", ouvir);
      try {
        await prepara(c, 3);
        await configurarBoard(c);
        await chave(c, true);
        const M = await comoSistema(c, () => novoModelo(c, { data_desenho_tecnico: HOJE }));
        // sabotagem SÓ nesta txn (revertida): o motor passa a lançar erro
        await c.query(`CREATE OR REPLACE FUNCTION public._kanban_aplicar(_tenant uuid, _ids uuid[], _origem text, _lote uuid DEFAULT NULL)
                       RETURNS integer LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'sabotagem de teste'; END $f$`);
        await c.query(`INSERT INTO public.kanban_recalculo_fila (modelo_id, tenant_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [M, T]);
        await imediato(c); // não lança
        expect(avisos.some((a) => /recálculo ignorado/.test(a) && /sabotagem de teste/.test(a))).toBe(true);
        expect(await tamanhoFila(c)).toBe(0);
        expect((await lerModelo(c, M)).status).toBe("entrada");
      } finally {
        c.off("notice", ouvir);
      }
    });
  });

  it("origem inválida → P0001", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await expect(c.query(`SELECT public._kanban_aplicar($1, NULL, 'manual')`, [T])).rejects.toMatchObject({ code: "P0001" });
    });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd "/Users/sunglee/PLM + Criação/plm-pcp" && DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres KANBAN_AUTO_MIG_TXN=1 npx vitest run --no-file-parallelism tests/integration/kanban-auto.test.ts`
Expected: FAIL — `function public._kanban_aplicar(…) does not exist`; o teste da fila ADIADA fica em `entrada` (sem o constraint trigger a fila não drena).

- [ ] **Step 3: Implementar** — inserir o bloco abaixo IMEDIATAMENTE ANTES da linha `COMMIT;` de `supabase/migrations/20260930140000_kanban_auto_3_motor.sql` (o arquivo termina sempre em `COMMIT;` + linha em branco + `select pg_notify('pgrst', 'reload schema');`). Conferir depois com `grep -c '^COMMIT;$' supabase/migrations/20260930140000_kanban_auto_3_motor.sql` = `1` e `grep -n '^BEGIN;$' supabase/migrations/20260930140000_kanban_auto_3_motor.sql` = só a linha do topo.
```sql
-- ────────────────────────────────────────────────────────────────────────────
-- B) Enfileirar (interno). Só entra na fila modelo DERIVÁVEL de loja com a CHAVE LIGADA, e só
--    com GUC vazio (escrita do próprio motor/RPCs não re-enfileira — trava de recursão).
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._kanban_enfileirar(_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF _ids IS NULL OR cardinality(_ids) = 0 THEN RETURN; END IF;
  IF coalesce(current_setting('app.kanban_sistema', true), '') <> '' THEN RETURN; END IF;
  INSERT INTO public.kanban_recalculo_fila (modelo_id, tenant_id)
  SELECT m.id, m.tenant_id
    FROM public.modelos m
    JOIN public.tenant_config tc ON tc.tenant_id = m.tenant_id AND tc.kanban_automatico
   WHERE m.id = ANY (_ids)
     AND coalesce(m.ordem_criacao_enviada, false)
     AND NOT coalesce(m.lancado, false)
  ON CONFLICT (modelo_id) DO NOTHING;
END;
$function$;

CREATE OR REPLACE FUNCTION public._kanban_enfileirar_tenant(_tenant uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF _tenant IS NULL THEN RETURN; END IF;
  IF coalesce(current_setting('app.kanban_sistema', true), '') <> '' THEN RETURN; END IF;
  IF NOT public._kanban_ligado(_tenant) THEN RETURN; END IF;
  INSERT INTO public.kanban_recalculo_fila (modelo_id, tenant_id)
  SELECT m.id, m.tenant_id
    FROM public.modelos m
   WHERE m.tenant_id = _tenant
     AND coalesce(m.ordem_criacao_enviada, false)
     AND NOT coalesce(m.lancado, false)
  ON CONFLICT (modelo_id) DO NOTHING;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public._kanban_enfileirar(uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._kanban_enfileirar_tenant(uuid) FROM PUBLIC, anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- C) Aplicar: deriva o lote e grava SÓ onde muda (UPDATE explícito), com GUC transação-local.
--    #Erro (revisao_pendente.kanban): NÃO é escrito aqui (decisão 14 do dono, 23/set) — com a
--    chave ligada, recuo automático só devolve o card à coluna a que ele pertence; um #Erro
--    legado (de quando a chave estava desligada) fica até o kanban_mover (D20).
--    REF: card FIXADO cuja posição derivada atinge ref_exibir_status tem a REF revelada aqui
--    (o status dele não muda, então fn_modelo_ref_auto não veria).
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._kanban_aplicar(_tenant uuid, _ids uuid[], _origem text, _lote uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sis_ant  text := coalesce(current_setting('app.kanban_sistema', true), '');
  v_lote_ant text := coalesce(current_setting('app.kanban_lote', true), '');
  v_cfg      jsonb;
  v_n        integer := 0;
BEGIN
  IF _origem IS NULL OR _origem NOT IN ('auto', 'config') THEN
    RAISE EXCEPTION '_kanban_aplicar: origem inválida (%).', _origem USING ERRCODE = 'P0001';
  END IF;
  IF _tenant IS NULL OR NOT public._kanban_ligado(_tenant) THEN
    RETURN 0;
  END IF;

  v_cfg := public._kanban_cfg(_tenant);

  PERFORM set_config('app.kanban_sistema', _origem, true);
  PERFORM set_config('app.kanban_lote', coalesce(_lote::text, ''), true);

  WITH d AS (
    SELECT x.* FROM public._kanban_derivar_lote(_tenant, _ids, v_cfg) x WHERE x.derivavel
  ), calc AS (
    SELECT d.modelo_id AS mid,
           d.resultado,
           (d.resultado IS DISTINCT FROM d.status_atual) AS muda,
           (d.fixado AND public._ref_exibir_gate(_tenant, d.alvo)) AS revela_ref
      FROM d
  ), upd AS (
    UPDATE public.modelos m
       SET status_desenvolvimento = CASE WHEN c.muda THEN c.resultado ELSE m.status_desenvolvimento END,
           ref = CASE WHEN c.revela_ref AND coalesce(m.ref, '') = '' AND coalesce(m.ref_auto, '') <> ''
                      THEN m.ref_auto ELSE m.ref END
      FROM calc c
     WHERE m.id = c.mid
       AND m.tenant_id = _tenant
       AND (c.muda OR (c.revela_ref AND coalesce(m.ref, '') = '' AND coalesce(m.ref_auto, '') <> ''))
    RETURNING c.muda
  )
  SELECT count(*) FILTER (WHERE upd.muda) INTO v_n FROM upd;

  PERFORM set_config('app.kanban_sistema', v_sis_ant, true);
  PERFORM set_config('app.kanban_lote', v_lote_ant, true);
  RETURN v_n;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public._kanban_aplicar(uuid, uuid[], text, uuid) FROM PUBLIC, anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- D) Fila → processada no COMMIT (CONSTRAINT TRIGGER DEFERRABLE INITIALLY DEFERRED).
--    O 1º evento da loja drena TODAS as linhas dela (1 chamada ao core por lote); os demais
--    eventos acham a fila vazia e saem. O DELETE fica FORA do bloco de exceção (a fila esvazia
--    mesmo se a derivação falhar); a falha vira WARNING e NUNCA derruba o COMMIT do usuário.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_kanban_processar_fila()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ids uuid[];
BEGIN
  WITH d AS (
    DELETE FROM public.kanban_recalculo_fila f WHERE f.tenant_id = NEW.tenant_id RETURNING f.modelo_id
  )
  SELECT array_agg(d.modelo_id) INTO v_ids FROM d;
  IF v_ids IS NULL THEN
    RETURN NULL;
  END IF;
  BEGIN
    PERFORM public._kanban_aplicar(NEW.tenant_id, v_ids, 'auto', NULL);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Kanban automático: recálculo ignorado (loja %, % card(s)): % [%]',
      NEW.tenant_id, cardinality(v_ids), SQLERRM, SQLSTATE;
  END;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_kanban_processar_fila ON public.kanban_recalculo_fila;
CREATE CONSTRAINT TRIGGER trg_kanban_processar_fila
  AFTER INSERT ON public.kanban_recalculo_fila
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.fn_kanban_processar_fila();
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd "/Users/sunglee/PLM + Criação/plm-pcp" && DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres KANBAN_AUTO_MIG_TXN=1 npx vitest run --no-file-parallelism tests/integration/kanban-auto.test.ts`
Expected: PASS (32 testes). O teste de erro captura o `WARNING` pelo evento `notice` do `pg`.

- [ ] **Step 5: Gates + commit**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp"
npm run build 2>&1 | tail -3
npx tsc --noEmit 2>&1 | grep -E "TS2304|error" ; true
npx vitest run --no-file-parallelism tests/unit/kanban-auto.test.ts tests/unit/kanban-status.test.ts
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres KANBAN_AUTO_MIG_TXN=1 npx vitest run --no-file-parallelism tests/integration/kanban-auto.test.ts tests/integration/kanban-condicoes.test.ts
```
```bash
git commit --only -m "feat(kanban-auto): migration 3B — fila adiada p/ o COMMIT (constraint trigger) e _kanban_aplicar (motor não acende #Erro — decisão 14)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- supabase/migrations/20260930140000_kanban_auto_3_motor.sql tests/integration/kanban-auto.test.ts
git show --stat HEAD | tail -n +7   # confere: SÓ os paths acima
```

---

### Task 12: Migration 3 (parte E) — enfileiradores em TODAS as tabelas-fonte das condições

**Files:**
- Modify: `supabase/migrations/20260930140000_kanban_auto_3_motor.sql` (inserir antes do `COMMIT;`)
- Modify: `tests/integration/kanban-auto.test.ts`

**Interfaces:**
- Consumes: `_kanban_enfileirar`, `_kanban_enfileirar_tenant` (Task 11).
- Produces (funções de gatilho `fn_*`, DEFINER, sem REVOKE — convenção vigente):
  - `fn_kanban_fila_modelo()` → `trg_kanban_fila_upd` (AFTER UPDATE ON modelos FOR EACH ROW, `WHEN` com `OLD.x IS DISTINCT FROM NEW.x` nas 26 colunas lidas pelo core + `origem`) e `trg_kanban_fila_ins` (AFTER INSERT ON modelos FOR EACH ROW `WHEN (NEW.ordem_criacao_enviada)`)
  - `fn_kanban_fila_por_modelo()` (tabelas com `modelo_id`: `modelo_tecidos`, `modelo_grades`, `modelo_aviamentos`, `modelo_servico_mo`, `cad`), `fn_kanban_fila_por_cad()` (`cad_tecidos`, `cad_aviamentos`, `cad_etiquetas`, `controle_qualidade`, `producao_terceirizados` → `cad.modelo_id`), `fn_kanban_fila_por_modelo_tecido()` (`modelo_tecido_variantes` → `modelo_tecidos.modelo_id`), `fn_kanban_fila_por_cad_tecido()` (`cad_tecido_variantes` → `cad_tecidos.cad_id` → `cad.modelo_id`) — cada tabela com 3 gatilhos STATEMENT-LEVEL `trg_kanban_fila_ins|upd|del` (`REFERENCING NEW TABLE AS novas` / `OLD TABLE AS antigas NEW TABLE AS novas` / `OLD TABLE AS antigas`)
  - `fn_kanban_fila_categoria()` → `trg_kanban_fila_upd` (AFTER UPDATE FOR EACH ROW `WHEN` etapa/nome/ativo) e `trg_kanban_fila_del` (AFTER DELETE FOR EACH ROW) em `categorias_terceirizado` (D10)
- Teste: `filaIds(c)`, `eventosFonte(c, M) → [rótulo, sql, params][]` (um evento em cada tabela-fonte).

- [ ] **Step 1: Acrescentar os testes**

```ts
// ─────────────────── Migration 3E — enfileiradores (Task 12) ───────────────────
async function filaIds(c: Client): Promise<string[]> {
  return (await c.query(`SELECT modelo_id FROM public.kanban_recalculo_fila`)).rows.map((r) => r.modelo_id);
}
/** Um evento em CADA tabela-fonte das condições (13 + categorias). Cada item: [rótulo, sql, params]. */
async function eventosFonte(c: Client, M: string): Promise<[string, string, unknown[]][]> {
  const vt = await um<{ vid: string; aid: string }>(c, `SELECT id AS vid, artigo_id AS aid FROM public.variantes_tecido WHERE tenant_id = $1 LIMIT 1`, [T]);
  const av = await um<{ id: string }>(c, `SELECT id FROM public.aviamentos WHERE tenant_id = $1 LIMIT 1`, [T]);
  const cat = await um<{ id: string }>(c, `SELECT id FROM public.categorias_terceirizado WHERE tenant_id = $1 AND ativo LIMIT 1`, [T]);
  return [
    ["modelos (coluna do WHEN)", `UPDATE public.modelos SET data_piloto3 = $2 WHERE id = $1`, [M, HOJE]],
    ["modelos.origem → revenda", `UPDATE public.modelos SET origem = 'revenda' WHERE id = $1`, [M]],
    ["modelos.origem → interno", `UPDATE public.modelos SET origem = 'interno' WHERE id = $1`, [M]],
    ["modelo_tecidos INSERT", `INSERT INTO public.modelo_tecidos (modelo_id, artigo_id, numero, tipo) VALUES ($1, $2, 1, 'tecido')`, [M, vt.aid]],
    ["modelo_tecido_variantes INSERT", `INSERT INTO public.modelo_tecido_variantes (modelo_tecido_id, variante_tecido_id, ordem)
        SELECT id, $2, 1 FROM public.modelo_tecidos WHERE modelo_id = $1`, [M, vt.vid]],
    ["modelo_grades INSERT", `INSERT INTO public.modelo_grades (modelo_id, variante_numero, grades, grade_total) VALUES ($1, 1, '{"P": 2}', 2)`, [M]],
    ["modelo_grades UPDATE", `UPDATE public.modelo_grades SET grade_total = 3 WHERE modelo_id = $1`, [M]],
    ["modelo_aviamentos INSERT", `INSERT INTO public.modelo_aviamentos (modelo_id, aviamento_id, numero) VALUES ($1, $2, 1)`, [M, av.id]],
    ["modelo_aviamentos DELETE", `DELETE FROM public.modelo_aviamentos WHERE modelo_id = $1`, [M]],
    ["modelo_servico_mo INSERT", `INSERT INTO public.modelo_servico_mo (tenant_id, modelo_id, categoria_terceirizado_id, valor) VALUES ($3, $1, $2, 5)`, [M, cat.id, T]],
    ["cad INSERT", `INSERT INTO public.cad (modelo_id, tenant_id) VALUES ($1, $2)`, [M, T]],
    ["cad_tecidos INSERT", `INSERT INTO public.cad_tecidos (cad_id, artigo_id, numero, tipo) SELECT id, $2, 1, 'tecido' FROM public.cad WHERE modelo_id = $1`, [M, vt.aid]],
    ["cad_tecido_variantes INSERT", `INSERT INTO public.cad_tecido_variantes (cad_tecido_id, variante_tecido_id, ordem)
        SELECT ct.id, $2, 1 FROM public.cad_tecidos ct JOIN public.cad c ON c.id = ct.cad_id WHERE c.modelo_id = $1`, [M, vt.vid]],
    ["cad_tecido_variantes UPDATE", `UPDATE public.cad_tecido_variantes SET quantidade_folhas = 2
        WHERE cad_tecido_id IN (SELECT ct.id FROM public.cad_tecidos ct JOIN public.cad c ON c.id = ct.cad_id WHERE c.modelo_id = $1)`, [M]],
    ["cad_aviamentos INSERT", `INSERT INTO public.cad_aviamentos (cad_id, aviamento_id, numero) SELECT id, $2, 1 FROM public.cad WHERE modelo_id = $1`, [M, av.id]],
    ["cad_etiquetas INSERT", `INSERT INTO public.cad_etiquetas (cad_id) SELECT id FROM public.cad WHERE modelo_id = $1`, [M]],
    ["controle_qualidade INSERT", `INSERT INTO public.controle_qualidade (cad_id, tenant_id) SELECT id, $2 FROM public.cad WHERE modelo_id = $1`, [M, T]],
    ["controle_qualidade UPDATE", `UPDATE public.controle_qualidade SET status_pos = 'pendente' WHERE cad_id IN (SELECT id FROM public.cad WHERE modelo_id = $1)`, [M]],
    ["producao_terceirizados INSERT", `INSERT INTO public.producao_terceirizados (cad_id, tenant_id, categoria_terceirizado_id)
        SELECT id, $2, $3 FROM public.cad WHERE modelo_id = $1`, [M, T, cat.id]],
    ["cad UPDATE", `UPDATE public.cad SET enviado_corte = true WHERE modelo_id = $1`, [M]],
  ];
}

describe.skipIf(!PRONTO)("kanban-auto — migration 3E: enfileiradores (Task 12)", () => {
  it("chave DESLIGADA: NENHUM evento em nenhuma tabela-fonte enfileira (fila vazia antes e depois do COMMIT)", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await configurarBoard(c);
      const M = await comoSistema(c, () => novoModelo(c));
      for (const [nome, sql, params] of await eventosFonte(c, M)) {
        await c.query(sql, params);
        expect(await tamanhoFila(c), nome).toBe(0);
      }
      const cat = await um<{ id: string }>(c, `SELECT id FROM public.categorias_terceirizado WHERE tenant_id = $1 LIMIT 1`, [T]);
      await c.query(`UPDATE public.categorias_terceirizado SET ativo = NOT ativo WHERE id = $1`, [cat.id]);
      expect(await tamanhoFila(c)).toBe(0);
      await imediato(c);
      expect(await tamanhoFila(c)).toBe(0);
      expect((await lerModelo(c, M)).status).toBe("entrada");
    });
  });

  it("chave LIGADA: cada tabela-fonte enfileira o modelo; coluna fora do WHEN (e escrita do sistema) não enfileira", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await configurarBoard(c);
      await chave(c, true);
      const M = await comoSistema(c, () => novoModelo(c));
      for (const [nome, sql, params] of await eventosFonte(c, M)) {
        await c.query(`DELETE FROM public.kanban_recalculo_fila`);
        await c.query(sql, params);
        expect(await filaIds(c), nome).toContain(M);
      }
      await c.query(`DELETE FROM public.kanban_recalculo_fila`);
      await setar(c, M, { observacoes_gerais: "fora do WHEN", revisao_pendente: { x: true } });
      expect(await tamanhoFila(c)).toBe(0);
      await comoSistema(c, () => setar(c, M, { data_piloto3: null }));
      expect(await tamanhoFila(c)).toBe(0);
      const N = await novoModelo(c, { ordem_criacao_enviada: false });
      expect(await filaIds(c)).not.toContain(N); // INSERT sem Ordem de Criação não entra
      const O = await novoModelo(c);
      expect(await filaIds(c)).toContain(O); // INSERT com Ordem de Criação entra
      await imediato(c);
      expect(await tamanhoFila(c)).toBe(0);
    });
  });

  it("categorias_terceirizado (etapa/nome/ativo) enfileira a LOJA inteira; `ordem` não", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await configurarBoard(c);
      await chave(c, true);
      await c.query(`DELETE FROM public.kanban_recalculo_fila`);
      const cat = await um<{ id: string }>(c, `SELECT id FROM public.categorias_terceirizado WHERE tenant_id = $1 LIMIT 1`, [T]);
      await c.query(`UPDATE public.categorias_terceirizado SET ordem = ordem + 1 WHERE id = $1`, [cat.id]);
      expect(await tamanhoFila(c)).toBe(0);
      await c.query(`UPDATE public.categorias_terceirizado SET etapa = CASE WHEN etapa = 'pos_costura' THEN 'ate_costura' ELSE 'pos_costura' END WHERE id = $1`, [cat.id]);
      const elegiveis = await um<{ n: string }>(c,
        `SELECT count(*) AS n FROM public.modelos WHERE tenant_id = $1 AND ordem_criacao_enviada AND NOT lancado`, [T]);
      expect(await tamanhoFila(c)).toBe(Number(elegiveis.n));
    });
  });

  it("motor por evento: avança/regride em cascata, reprovado SEMPRE manual, fixado não anda, colunas puladas sem linha", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await configurarBoard(c, { reqs: { ...REQS, reprovado: ["data_desenho_tecnico"] } });
      await chave(c, true);
      const M = await comoSistema(c, () => novoModelo(c));
      await setar(c, M, { data_desenho_tecnico: HOJE });
      await imediato(c);
      expect((await lerModelo(c, M)).status).toBe("etapa_a");
      await setar(c, M, { data_piloto2: HOJE });
      await imediato(c);
      expect((await lerModelo(c, M)).status).toBe("etapa_a"); // c sem b: não pula
      await setar(c, M, { data_piloto1: HOJE, data_aprovacao: HOJE });
      await imediato(c);
      expect((await lerModelo(c, M)).status).toBe("aprovado"); // reprovado (c/ requisito satisfeito) NUNCA é destino
      expect(await historico(c, M)).toEqual(["entrada:manual", "aprovado:auto"]); // janela: 1 linha auto, pulos sem linha
      await setar(c, M, { data_piloto1: null });
      await imediato(c);
      expect((await lerModelo(c, M)).status).toBe("etapa_a"); // regride p/ a última satisfeita antes de b
      expect((await lerModelo(c, M)).erro).toBe(false); // decisão 14: recuo automático não acende #Erro
      await setar(c, M, { data_piloto1: HOJE });
      await imediato(c);
      await setar(c, M, { status_desenvolvimento: "stand_by" }); // fixa (coluna manual)
      await imediato(c);
      await setar(c, M, { data_aprovacao: null, data_piloto2: null });
      await imediato(c);
      expect((await lerModelo(c, M)).status).toBe("stand_by"); // fixado não anda
    });
  });

  // DDL próprio (TEMP TABLE + função pg_temp + CREATE/DROP TRIGGER na fila) → SÓ na cópia local (decisão 17)
  it.skipIf(!LOCAL)("sem recursão: o UPDATE do motor não re-enfileira (1 inserção na fila, antes e depois do COMMIT)", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await configurarBoard(c);
      await chave(c, true);
      const M = await comoSistema(c, () => novoModelo(c));
      await c.query(`CREATE TEMP TABLE _ka_fila_log (profundidade int)`);
      await c.query(`CREATE FUNCTION pg_temp.fn_ka_fila_log() RETURNS trigger LANGUAGE plpgsql AS $f$
                     BEGIN INSERT INTO _ka_fila_log VALUES (pg_trigger_depth()); RETURN NULL; END $f$`);
      await c.query(`CREATE TRIGGER zz_ka_fila_log AFTER INSERT ON public.kanban_recalculo_fila
                     FOR EACH ROW EXECUTE FUNCTION pg_temp.fn_ka_fila_log()`);
      await setar(c, M, { data_desenho_tecnico: HOJE });
      const antes = await c.query(`SELECT profundidade FROM _ka_fila_log`);
      await imediato(c);
      const depois = await c.query(`SELECT profundidade FROM _ka_fila_log`);
      expect(antes.rows.length).toBe(1);
      expect(depois.rows).toEqual(antes.rows);
      expect((await lerModelo(c, M)).status).toBe("etapa_a");
      // a trava: com GUC não vazio (escrita do motor/RPCs) o enfileirador sai cedo
      await guc(c, "auto");
      await c.query(`SELECT public._kanban_enfileirar(ARRAY[$1]::uuid[])`, [M]);
      await guc(c, "");
      expect(await tamanhoFila(c)).toBe(0);
      await c.query(`DROP TRIGGER zz_ka_fila_log ON public.kanban_recalculo_fila`);
    });
  });

  it("salvar_modelo_bom (apaga e reinsere o BOM) NÃO gera linha transitória nem muda o status", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await comoUsuario(c);
      await configurarBoard(c, { reqs: { etapa_a: ["tecido_com_variante"] } });
      await chave(c, true);
      const M = await comoSistema(c, () => novoModelo(c));
      const vt = await um<{ vid: string; aid: string }>(c, `SELECT id AS vid, artigo_id AS aid FROM public.variantes_tecido WHERE tenant_id = $1 LIMIT 1`, [T]);
      const bom = JSON.stringify([{ artigo_id: vt.aid, numero: 1, tipo: "tecido", variantes: [vt.vid] }]);
      const salvar = () => c.query(`SELECT public.salvar_modelo_bom($1, $2::jsonb, '[]'::jsonb, '[]'::jsonb)`, [M, bom]);
      await salvar();
      await imediato(c);
      expect((await lerModelo(c, M)).status).toBe("etapa_a");
      const hist = await historico(c, M);
      await salvar(); // DELETE de tudo + INSERT de novo na MESMA txn
      expect(await filaIds(c)).toContain(M);
      expect((await lerModelo(c, M)).status).toBe("etapa_a"); // nada recalculado no meio
      await imediato(c);
      expect((await lerModelo(c, M)).status).toBe("etapa_a");
      expect(await historico(c, M)).toEqual(hist);
      // o estado INTERMEDIÁRIO (sem variante) recuaria se o recálculo não fosse adiado:
      await c.query(`DELETE FROM public.modelo_tecido_variantes WHERE modelo_tecido_id IN (SELECT id FROM public.modelo_tecidos WHERE modelo_id = $1)`, [M]);
      expect((await lerModelo(c, M)).status).toBe("etapa_a");
      await salvar();
      await imediato(c);
      expect(await historico(c, M)).toEqual(hist);
    });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd "/Users/sunglee/PLM + Criação/plm-pcp" && DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres KANBAN_AUTO_MIG_TXN=1 npx vitest run --no-file-parallelism tests/integration/kanban-auto.test.ts`
Expected: FAIL — `chave LIGADA: cada tabela-fonte…` (`expected [] to contain '<uuid>'`) e o motor por evento fica em `entrada`.

- [ ] **Step 3: Implementar** — inserir o bloco abaixo IMEDIATAMENTE ANTES da linha `COMMIT;` de `supabase/migrations/20260930140000_kanban_auto_3_motor.sql` (o arquivo termina sempre em `COMMIT;` + linha em branco + `select pg_notify('pgrst', 'reload schema');`). Conferir depois com `grep -c '^COMMIT;$' supabase/migrations/20260930140000_kanban_auto_3_motor.sql` = `1` e `grep -n '^BEGIN;$' supabase/migrations/20260930140000_kanban_auto_3_motor.sql` = só a linha do topo.
```sql
-- ────────────────────────────────────────────────────────────────────────────
-- E) Enfileiradores nas tabelas-FONTE das condições (G-inicial #4/#8/#10).
--    modelos: POR LINHA, só quando muda coluna lida pelo core (26) ou `origem` (define o fluxo).
--    Sem status/rev/revisao_pendente no WHEN: o Sheet do Dev manda ~40 colunas por save.
--    Tabelas-filhas: 3 gatilhos STATEMENT-LEVEL por tabela (INSERT/UPDATE/DELETE) com
--    transition tables — no PG 17.6 transition table não aceita multi-evento nem lista de colunas.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_kanban_fila_modelo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._kanban_enfileirar(ARRAY[NEW.id]);
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_kanban_fila_upd ON public.modelos;
CREATE TRIGGER trg_kanban_fila_upd
  AFTER UPDATE ON public.modelos
  FOR EACH ROW
  WHEN (OLD.categoria_principal_id IS DISTINCT FROM NEW.categoria_principal_id
     OR OLD.subcategoria1_id IS DISTINCT FROM NEW.subcategoria1_id
     OR OLD.subcategoria2_id IS DISTINCT FROM NEW.subcategoria2_id
     OR OLD.estilista_id IS DISTINCT FROM NEW.estilista_id
     OR OLD.linha_id IS DISTINCT FROM NEW.linha_id
     OR OLD.colecao IS DISTINCT FROM NEW.colecao
     OR OLD.tecidos_planejados IS DISTINCT FROM NEW.tecidos_planejados
     OR OLD.ordem_criacao_enviada IS DISTINCT FROM NEW.ordem_criacao_enviada
     OR OLD.preco_venda IS DISTINCT FROM NEW.preco_venda
     OR OLD.data_lancamento IS DISTINCT FROM NEW.data_lancamento
     OR OLD.lancado IS DISTINCT FROM NEW.lancado
     OR OLD.modelista_id IS DISTINCT FROM NEW.modelista_id
     OR OLD.piloteiro1_id IS DISTINCT FROM NEW.piloteiro1_id
     OR OLD.piloteiro2_id IS DISTINCT FROM NEW.piloteiro2_id
     OR OLD.piloteiro3_id IS DISTINCT FROM NEW.piloteiro3_id
     OR OLD.data_desenho_tecnico IS DISTINCT FROM NEW.data_desenho_tecnico
     OR OLD.data_piloto1 IS DISTINCT FROM NEW.data_piloto1
     OR OLD.data_piloto2 IS DISTINCT FROM NEW.data_piloto2
     OR OLD.data_piloto3 IS DISTINCT FROM NEW.data_piloto3
     OR OLD.data_aprovacao IS DISTINCT FROM NEW.data_aprovacao
     OR OLD.croqui_url IS DISTINCT FROM NEW.croqui_url
     OR OLD.desenho_tecnico_url IS DISTINCT FROM NEW.desenho_tecnico_url
     OR OLD.fotos_modelo IS DISTINCT FROM NEW.fotos_modelo
     OR OLD.ficha_medida_url IS DISTINCT FROM NEW.ficha_medida_url
     OR OLD.enviado_cad IS DISTINCT FROM NEW.enviado_cad
     OR OLD.custo_terceirizados_aprovado IS DISTINCT FROM NEW.custo_terceirizados_aprovado
     OR OLD.origem IS DISTINCT FROM NEW.origem)
  EXECUTE FUNCTION public.fn_kanban_fila_modelo();

DROP TRIGGER IF EXISTS trg_kanban_fila_ins ON public.modelos;
CREATE TRIGGER trg_kanban_fila_ins
  AFTER INSERT ON public.modelos
  FOR EACH ROW
  WHEN (NEW.ordem_criacao_enviada)
  EXECUTE FUNCTION public.fn_kanban_fila_modelo();

-- Tabelas com coluna modelo_id: modelo_tecidos, modelo_grades, modelo_aviamentos, modelo_servico_mo, cad
CREATE OR REPLACE FUNCTION public.fn_kanban_fila_por_modelo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ids uuid[];
BEGIN
  IF coalesce(current_setting('app.kanban_sistema', true), '') <> '' THEN RETURN NULL; END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT array_agg(DISTINCT n.modelo_id) INTO v_ids FROM novas n WHERE n.modelo_id IS NOT NULL;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT array_agg(DISTINCT o.modelo_id) INTO v_ids FROM antigas o WHERE o.modelo_id IS NOT NULL;
  ELSE
    SELECT array_agg(DISTINCT u.modelo_id) INTO v_ids
      FROM (SELECT n.modelo_id FROM novas n UNION SELECT o.modelo_id FROM antigas o) u
     WHERE u.modelo_id IS NOT NULL;
  END IF;
  PERFORM public._kanban_enfileirar(v_ids);
  RETURN NULL;
END;
$function$;

-- Tabelas com coluna cad_id: cad_tecidos, cad_aviamentos, cad_etiquetas, controle_qualidade, producao_terceirizados
CREATE OR REPLACE FUNCTION public.fn_kanban_fila_por_cad()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ids uuid[];
BEGIN
  IF coalesce(current_setting('app.kanban_sistema', true), '') <> '' THEN RETURN NULL; END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT array_agg(DISTINCT c.modelo_id) INTO v_ids
      FROM novas n JOIN public.cad c ON c.id = n.cad_id WHERE c.modelo_id IS NOT NULL;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT array_agg(DISTINCT c.modelo_id) INTO v_ids
      FROM antigas o JOIN public.cad c ON c.id = o.cad_id WHERE c.modelo_id IS NOT NULL;
  ELSE
    SELECT array_agg(DISTINCT c.modelo_id) INTO v_ids
      FROM (SELECT n.cad_id FROM novas n UNION SELECT o.cad_id FROM antigas o) u
      JOIN public.cad c ON c.id = u.cad_id
     WHERE c.modelo_id IS NOT NULL;
  END IF;
  PERFORM public._kanban_enfileirar(v_ids);
  RETURN NULL;
END;
$function$;

-- modelo_tecido_variantes → modelo_tecidos.modelo_id
CREATE OR REPLACE FUNCTION public.fn_kanban_fila_por_modelo_tecido()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ids uuid[];
BEGIN
  IF coalesce(current_setting('app.kanban_sistema', true), '') <> '' THEN RETURN NULL; END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT array_agg(DISTINCT mt.modelo_id) INTO v_ids
      FROM novas n JOIN public.modelo_tecidos mt ON mt.id = n.modelo_tecido_id WHERE mt.modelo_id IS NOT NULL;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT array_agg(DISTINCT mt.modelo_id) INTO v_ids
      FROM antigas o JOIN public.modelo_tecidos mt ON mt.id = o.modelo_tecido_id WHERE mt.modelo_id IS NOT NULL;
  ELSE
    SELECT array_agg(DISTINCT mt.modelo_id) INTO v_ids
      FROM (SELECT n.modelo_tecido_id FROM novas n UNION SELECT o.modelo_tecido_id FROM antigas o) u
      JOIN public.modelo_tecidos mt ON mt.id = u.modelo_tecido_id
     WHERE mt.modelo_id IS NOT NULL;
  END IF;
  PERFORM public._kanban_enfileirar(v_ids);
  RETURN NULL;
END;
$function$;

-- cad_tecido_variantes → cad_tecidos.cad_id → cad.modelo_id
CREATE OR REPLACE FUNCTION public.fn_kanban_fila_por_cad_tecido()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ids uuid[];
BEGIN
  IF coalesce(current_setting('app.kanban_sistema', true), '') <> '' THEN RETURN NULL; END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT array_agg(DISTINCT c.modelo_id) INTO v_ids
      FROM novas n
      JOIN public.cad_tecidos ct ON ct.id = n.cad_tecido_id
      JOIN public.cad c ON c.id = ct.cad_id
     WHERE c.modelo_id IS NOT NULL;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT array_agg(DISTINCT c.modelo_id) INTO v_ids
      FROM antigas o
      JOIN public.cad_tecidos ct ON ct.id = o.cad_tecido_id
      JOIN public.cad c ON c.id = ct.cad_id
     WHERE c.modelo_id IS NOT NULL;
  ELSE
    SELECT array_agg(DISTINCT c.modelo_id) INTO v_ids
      FROM (SELECT n.cad_tecido_id FROM novas n UNION SELECT o.cad_tecido_id FROM antigas o) u
      JOIN public.cad_tecidos ct ON ct.id = u.cad_tecido_id
      JOIN public.cad c ON c.id = ct.cad_id
     WHERE c.modelo_id IS NOT NULL;
  END IF;
  PERFORM public._kanban_enfileirar(v_ids);
  RETURN NULL;
END;
$function$;

-- categorias_terceirizado (etapa/nome/ativo → _cq_liberado/_resolver_fonte_confeccao): a LOJA inteira.
CREATE OR REPLACE FUNCTION public.fn_kanban_fila_categoria()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._kanban_enfileirar_tenant(coalesce(NEW.tenant_id, OLD.tenant_id));
  RETURN NULL;
END;
$function$;

-- 3 gatilhos statement-level por tabela-filha (nomes iguais em todas: trg_kanban_fila_{ins,upd,del}).
DO $do$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('modelo_tecidos',          'fn_kanban_fila_por_modelo'),
      ('modelo_grades',           'fn_kanban_fila_por_modelo'),
      ('modelo_aviamentos',       'fn_kanban_fila_por_modelo'),
      ('modelo_servico_mo',       'fn_kanban_fila_por_modelo'),
      ('cad',                     'fn_kanban_fila_por_modelo'),
      ('modelo_tecido_variantes', 'fn_kanban_fila_por_modelo_tecido'),
      ('cad_tecidos',             'fn_kanban_fila_por_cad'),
      ('cad_aviamentos',          'fn_kanban_fila_por_cad'),
      ('cad_etiquetas',           'fn_kanban_fila_por_cad'),
      ('controle_qualidade',      'fn_kanban_fila_por_cad'),
      ('producao_terceirizados',  'fn_kanban_fila_por_cad'),
      ('cad_tecido_variantes',    'fn_kanban_fila_por_cad_tecido')
    ) AS t(tabela, fn)
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_kanban_fila_ins ON public.%I', r.tabela);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_kanban_fila_upd ON public.%I', r.tabela);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_kanban_fila_del ON public.%I', r.tabela);
    EXECUTE format('CREATE TRIGGER trg_kanban_fila_ins AFTER INSERT ON public.%I '
                   || 'REFERENCING NEW TABLE AS novas FOR EACH STATEMENT EXECUTE FUNCTION public.%I()', r.tabela, r.fn);
    EXECUTE format('CREATE TRIGGER trg_kanban_fila_upd AFTER UPDATE ON public.%I '
                   || 'REFERENCING OLD TABLE AS antigas NEW TABLE AS novas FOR EACH STATEMENT EXECUTE FUNCTION public.%I()', r.tabela, r.fn);
    EXECUTE format('CREATE TRIGGER trg_kanban_fila_del AFTER DELETE ON public.%I '
                   || 'REFERENCING OLD TABLE AS antigas FOR EACH STATEMENT EXECUTE FUNCTION public.%I()', r.tabela, r.fn);
  END LOOP;
END
$do$;

DROP TRIGGER IF EXISTS trg_kanban_fila_upd ON public.categorias_terceirizado;
CREATE TRIGGER trg_kanban_fila_upd
  AFTER UPDATE ON public.categorias_terceirizado
  FOR EACH ROW
  WHEN (OLD.etapa IS DISTINCT FROM NEW.etapa
     OR OLD.nome IS DISTINCT FROM NEW.nome
     OR OLD.ativo IS DISTINCT FROM NEW.ativo)
  EXECUTE FUNCTION public.fn_kanban_fila_categoria();

DROP TRIGGER IF EXISTS trg_kanban_fila_del ON public.categorias_terceirizado;
CREATE TRIGGER trg_kanban_fila_del
  AFTER DELETE ON public.categorias_terceirizado
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_kanban_fila_categoria();
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd "/Users/sunglee/PLM + Criação/plm-pcp" && DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres KANBAN_AUTO_MIG_TXN=1 npx vitest run --no-file-parallelism tests/integration/kanban-auto.test.ts`
Expected: PASS (38 testes).

- [ ] **Step 5: Gates + commit**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp"
npm run build 2>&1 | tail -3
npx tsc --noEmit 2>&1 | grep -E "TS2304|error" ; true
npx vitest run --no-file-parallelism tests/unit/kanban-auto.test.ts tests/unit/kanban-status.test.ts
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres KANBAN_AUTO_MIG_TXN=1 npx vitest run --no-file-parallelism tests/integration/kanban-auto.test.ts tests/integration/kanban-condicoes.test.ts
```
```bash
git commit --only -m "feat(kanban-auto): migration 3E — enfileiradores (modelos por linha c/ WHEN; 3 statement-level por tabela-filha; categorias)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- supabase/migrations/20260930140000_kanban_auto_3_motor.sql tests/integration/kanban-auto.test.ts
git show --stat HEAD | tail -n +7   # confere: SÓ os paths acima
```

---

### Task 13: Migration 3 (partes F e G) — trava da chave, gatilho da Config (snapshot no servidor) e guard do status

**Files:**
- Modify: `supabase/migrations/20260930140000_kanban_auto_3_motor.sql` (inserir antes do `COMMIT;`)
- Modify: `tests/integration/kanban-auto.test.ts`

**Interfaces:**
- Consumes: `_kanban_aplicar`, `_kanban_enfileirar` (Task 11); `_kanban_cfg`, `_kanban_fluxo`, `_kanban_norm`, `_kanban_coluna_manual`, `_kanban_derivar_puro`, `_kanban_ligado` (Tasks 8–9); `_avaliar_condicoes_kanban_core`; `kanban_snapshot` (Task 5).
- Produces:
  - `fn_kanban_chave_protegida()` + `trg_kanban_chave_protegida BEFORE INSERT OR UPDATE ON tenant_config FOR EACH ROW` (decisão 16; D18): sem o GUC `app.kanban_chave='rpc'`, UPDATE mantém `OLD.kanban_automatico` e INSERT grava `false` — só a RPC `kanban_definir_automatico` (Task 15) liga/desliga.
  - `fn_kanban_config()` + `trg_kanban_config AFTER UPDATE ON tenant_config FOR EACH ROW WHEN (OLD.x IS DISTINCT FROM NEW.x …)` nas colunas `kanban_automatico, status_kanban, kanban_requisitos, kanban_requisitos_excecoes, revenda_kanban_colunas, revenda_kanban_requisitos, confeccao_prioridade`. Ligar → lote `'ligar'`; mudança das 5 de kanban com a chave ligada → lote `'config'`; `confeccao_prioridade` só recalcula; desligar não grava. Snapshot = 1 linha por modelo derivável (`status_anterior`), `criado_at = clock_timestamp()` (D7). Recalcula com `_kanban_aplicar(tenant, NULL, 'config', lote)`; erro PROPAGA (D6).
  - `fn_kanban_status_guard()` + `trg_kanban_status_guard BEFORE UPDATE OF status_desenvolvimento ON modelos FOR EACH ROW` (§3 + D5).
- Teste: `lotes(c) → {lote_id, motivo, n}[]`, `lerChave(c) → {k, e}`.

- [ ] **Step 1: Acrescentar os testes**

```ts
// ─────────────── Migration 3F/3G — trava da chave, Config (snapshot no servidor) e guard (Task 13) ───────────────
async function lotes(c: Client): Promise<{ lote_id: string; motivo: string; n: number }[]> {
  // Na MESMA txn todos os lotes têm o mesmo criado_at (now()) → ordena por motivo (config < ligar).
  const { rows } = await c.query(
    `SELECT lote_id, motivo, count(*)::int AS n
       FROM public.kanban_snapshot WHERE tenant_id = $1 GROUP BY lote_id, motivo ORDER BY motivo, lote_id`, [T]);
  return rows.map((r) => ({ lote_id: r.lote_id, motivo: r.motivo, n: r.n }));
}

describe.skipIf(!PRONTO)("kanban-auto — migration 3F: gatilho da Config grava o snapshot (Task 13)", () => {
  it("LIGAR: 1 lote 'ligar' com TODOS os deriváveis (status de antes) + recálculo 'config' com o lote no histórico", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await configurarBoard(c);
      const M = await comoSistema(c, () => novoModelo(c, { data_desenho_tecnico: HOJE }));
      const elegiveis = Number((await um<{ n: string }>(c,
        `SELECT count(*) AS n FROM public.modelos WHERE tenant_id = $1 AND ordem_criacao_enviada AND NOT lancado`, [T])).n);
      await chave(c, true);
      const ls = await lotes(c);
      expect(ls.map((l) => [l.motivo, l.n])).toEqual([["ligar", elegiveis]]);
      const snapM = await um<{ s: string }>(c, `SELECT status_anterior AS s FROM public.kanban_snapshot WHERE modelo_id = $1`, [M]);
      expect(snapM.s).toBe("entrada");
      expect((await lerModelo(c, M)).status).toBe("etapa_a"); // recalculado NA MESMA txn do save
      const h = await um<{ origem: string; lote_id: string }>(c,
        `SELECT origem, lote_id FROM public.modelo_kanban_historico WHERE modelo_id = $1 ORDER BY entrou_at DESC, created_at DESC LIMIT 1`, [M]);
      expect(h).toEqual({ origem: "config", lote_id: ls[0].lote_id });
    });
  });

  it("com a chave ligada: board/requisitos/exceções/fluxo de revenda → lote 'config'; confeccao_prioridade só recalcula; upsert sem mudança e DESLIGAR não gravam nada", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await configurarBoard(c);
      await chave(c, true);
      expect((await lotes(c)).length).toBe(1);
      await c.query(`UPDATE public.tenant_config SET kanban_requisitos_excecoes = '{"etapa_c": ["data_piloto1"]}' WHERE tenant_id = $1`, [T]);
      await c.query(`UPDATE public.tenant_config SET revenda_kanban_colunas = '["entrada", "aprovado"]' WHERE tenant_id = $1`, [T]);
      expect((await lotes(c)).map((l) => l.motivo)).toEqual(["config", "config", "ligar"]);
      const cat = await um<{ id: string }>(c, `SELECT id FROM public.categorias_terceirizado WHERE tenant_id = $1 LIMIT 1`, [T]);
      await c.query(`UPDATE public.tenant_config SET confeccao_prioridade = jsonb_build_array($2::text) WHERE tenant_id = $1`, [T, cat.id]);
      // "upsert da linha inteira" como a tela de Config faz: mesmas colunas de kanban + outra coluna mudando
      await c.query(
        `UPDATE public.tenant_config SET status_kanban = status_kanban, kanban_requisitos = kanban_requisitos,
                kanban_automatico = kanban_automatico, estoque_critico_threshold = estoque_critico_threshold + 1
          WHERE tenant_id = $1`, [T]);
      expect((await lotes(c)).length).toBe(3);
      const antes = (await c.query(`SELECT id, status_desenvolvimento FROM public.modelos WHERE tenant_id = $1 ORDER BY id`, [T])).rows;
      await chave(c, false);
      expect((await lotes(c)).length).toBe(3);
      expect((await c.query(`SELECT id, status_desenvolvimento FROM public.modelos WHERE tenant_id = $1 ORDER BY id`, [T])).rows).toEqual(antes);
    });
  });
});

async function lerChave(c: Client) {
  return um<{ k: boolean; e: string }>(c,
    `SELECT kanban_automatico AS k, estoque_critico_threshold::text AS e FROM public.tenant_config WHERE tenant_id = $1`, [T]);
}

describe.skipIf(!PRONTO)("kanban-auto — migration 3F: a chave só muda pela RPC (decisão 16, Task 13)", () => {
  it("UPDATE/upsert de aba VELHA não liga nem desliga a chave (e não grava lote nem recalcula)", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await configurarBoard(c);
      const M = await comoSistema(c, () => novoModelo(c, { data_desenho_tecnico: HOJE }));
      // aba velha tentando LIGAR: UPDATE direto e upsert da linha inteira (como a Config faz)
      await c.query(`UPDATE public.tenant_config SET kanban_automatico = true WHERE tenant_id = $1`, [T]);
      await c.query(
        `INSERT INTO public.tenant_config (tenant_id, kanban_automatico, estoque_critico_threshold) VALUES ($1, true, 7)
         ON CONFLICT (tenant_id) DO UPDATE SET kanban_automatico = EXCLUDED.kanban_automatico,
                                              estoque_critico_threshold = EXCLUDED.estoque_critico_threshold`, [T]);
      expect(await lerChave(c)).toEqual({ k: false, e: "7" }); // o resto do upsert grava; a chave não
      expect(await lotes(c)).toEqual([]);
      expect((await lerModelo(c, M)).status).toBe("entrada");
      // ligada pelo caminho certo (GUC da RPC); aba velha tentando DESLIGAR calada
      await chave(c, true);
      await c.query(`UPDATE public.tenant_config SET kanban_automatico = false, estoque_critico_threshold = 8 WHERE tenant_id = $1`, [T]);
      expect(await lerChave(c)).toEqual({ k: true, e: "8" });
      expect((await lotes(c)).map((l) => l.motivo)).toEqual(["ligar"]);
      expect((await um<{ g: string }>(c, `SELECT current_setting('app.kanban_chave', true) AS g`)).g).toBe("");
    });
  });

  it("INSERT de loja nova nasce com a chave DESLIGADA mesmo pedindo true", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      const L = await um<{ id: string }>(c, `INSERT INTO public.tenants (nome) VALUES ('KA loja nova') RETURNING id`);
      // o seed da loja (trg_criar_tenant_config) já criou a linha; recria pedindo a chave LIGADA
      await c.query(`DELETE FROM public.tenant_config WHERE tenant_id = $1`, [L.id]);
      await c.query(`INSERT INTO public.tenant_config (tenant_id, kanban_automatico) VALUES ($1, true)`, [L.id]);
      const r = await um<{ k: boolean }>(c, `SELECT kanban_automatico AS k FROM public.tenant_config WHERE tenant_id = $1`, [L.id]);
      expect(r.k).toBe(false);
    });
  });
});

describe.skipIf(!PRONTO)("kanban-auto — migration 3G: guard do status (Task 13)", () => {
  async function cenario(c: Client) {
    await prepara(c, 3);
    await configurarBoard(c);
    await chave(c, true);
    const M = await comoSistema(c, () => novoModelo(c, { data_desenho_tecnico: HOJE, data_piloto1: HOJE, data_piloto2: HOJE }));
    await aplicar(c, [M]);
    expect((await lerModelo(c, M)).status).toBe("etapa_c");
    return M;
  }

  it("draft VELHO do Sheet do Dev (coluna automática) é ignorado; ''/NULL mantêm o atual", async () => {
    await withTx(async (c) => {
      const M = await cenario(c);
      await setar(c, M, { status_desenvolvimento: "etapa_a", observacoes_gerais: "salvar do Sheet do Dev" });
      expect((await lerModelo(c, M)).status).toBe("etapa_c");
      await setar(c, M, { status_desenvolvimento: "" });
      expect((await lerModelo(c, M)).status).toBe("etapa_c");
      await setar(c, M, { status_desenvolvimento: null });
      expect((await lerModelo(c, M)).status).toBe("etapa_c");
    });
  });

  it("coluna MANUAL fixa (e fica no COMMIT); tirar de manual p/ automática SOLTA na posição derivada", async () => {
    await withTx(async (c) => {
      const M = await cenario(c);
      await setar(c, M, { status_desenvolvimento: "stand_by" });
      await imediato(c);
      expect((await lerModelo(c, M)).status).toBe("stand_by");
      await setar(c, M, { status_desenvolvimento: "etapa_a" });
      expect((await lerModelo(c, M)).status).toBe("etapa_c");
    });
  });

  it("ENTRADA é aceita e o COMMIT re-deriva (entrada nunca fixa)", async () => {
    await withTx(async (c) => {
      const M = await cenario(c);
      await c.query(`DELETE FROM public.kanban_recalculo_fila`);
      await setar(c, M, { status_desenvolvimento: "entrada" });
      expect((await lerModelo(c, M)).status).toBe("entrada");
      expect(await filaIds(c)).toContain(M);
      await imediato(c);
      expect((await lerModelo(c, M)).status).toBe("etapa_c");
    });
  });

  it("destino FORA do fluxo → P0001 com a mensagem do §3", async () => {
    await withTx(async (c) => {
      const M = await cenario(c);
      await c.query("SAVEPOINT sp");
      await expect(setar(c, M, { status_desenvolvimento: "zzz" })).rejects.toMatchObject({
        code: "P0001", message: 'A etapa "zzz" não faz parte do fluxo deste modelo.',
      });
      await c.query("ROLLBACK TO SAVEPOINT sp");
    });
  });

  it("passa direto (gravação livre como hoje): chave desligada, card não derivável, escrita do sistema", async () => {
    await withTx(async (c) => {
      const M = await cenario(c);
      const N = await comoSistema(c, () => novoModelo(c, { ordem_criacao_enviada: false }));
      await setar(c, N, { status_desenvolvimento: "aprovado" });
      expect((await lerModelo(c, N)).status).toBe("aprovado");
      await guc(c, "manual");
      await setar(c, M, { status_desenvolvimento: "etapa_a" });
      await guc(c, "");
      expect((await lerModelo(c, M)).status).toBe("etapa_a");
      await chave(c, false);
      await setar(c, M, { status_desenvolvimento: "zzz" });
      expect((await lerModelo(c, M)).status).toBe("zzz");
    });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd "/Users/sunglee/PLM + Criação/plm-pcp" && DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres KANBAN_AUTO_MIG_TXN=1 npx vitest run --no-file-parallelism tests/integration/kanban-auto.test.ts`
Expected: FAIL — `LIGAR: …` (`expected [] to deeply equal [ [ 'ligar', N ] ]`), os 2 da trava (a aba velha liga a chave; a loja nova nasce ligada) e os testes do guard (o draft velho grava `etapa_a`).

- [ ] **Step 3: Implementar** — inserir o bloco abaixo IMEDIATAMENTE ANTES da linha `COMMIT;` de `supabase/migrations/20260930140000_kanban_auto_3_motor.sql` (o arquivo termina sempre em `COMMIT;` + linha em branco + `select pg_notify('pgrst', 'reload schema');`). Conferir depois com `grep -c '^COMMIT;$' supabase/migrations/20260930140000_kanban_auto_3_motor.sql` = `1` e `grep -n '^BEGIN;$' supabase/migrations/20260930140000_kanban_auto_3_motor.sql` = só a linha do topo.
```sql
-- ────────────────────────────────────────────────────────────────────────────
-- F.1) Trava da chave (decisão 16 do dono, 23/set; G-plano R3). `kanban_automatico` só muda pela
--      RPC `kanban_definir_automatico` (migration 4), que seta `app.kanban_chave='rpc'` (transação-
--      local) e restaura depois. Sem esse GUC: UPDATE mantém o valor antigo — a Config faz upsert da
--      linha INTEIRA, e uma aba aberta antes de alguém ligar/desligar regravaria o valor velho
--      (ligaria a loja SEM prévia ou desligaria calada) — e INSERT nasce DESLIGADO. BEFORE INSERT
--      OR UPDATE sem WHEN (gatilho que também é de INSERT não pode citar OLD no WHEN); ordena depois
--      de set_tenant_id_trg. O snapshot/recálculo ao ligar continua no AFTER trg_kanban_config.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_kanban_chave_protegida()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF coalesce(current_setting('app.kanban_chave', true), '') = 'rpc' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.kanban_automatico := false;
  ELSE
    NEW.kanban_automatico := OLD.kanban_automatico;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_kanban_chave_protegida ON public.tenant_config;
CREATE TRIGGER trg_kanban_chave_protegida
  BEFORE INSERT OR UPDATE ON public.tenant_config
  FOR EACH ROW EXECUTE FUNCTION public.fn_kanban_chave_protegida();

-- ────────────────────────────────────────────────────────────────────────────
-- F) Config da Loja: snapshot NO SERVIDOR + recálculo, na MESMA txn do save (G-fase R2).
--    WHEN com IS DISTINCT FROM (a Config faz upsert da linha INTEIRA — G-inicial #4): só as 5
--    colunas de kanban + a chave + confeccao_prioridade disparam. Desligar não grava nada. A chave
--    em si só chega aqui mudada pela RPC kanban_definir_automatico (trava F.1).
--    Snapshot: ao LIGAR (motivo 'ligar') e a cada mudança de board/requisitos/exceções/fluxo de
--    revenda com a chave ligada (motivo 'config'); `confeccao_prioridade` só recalcula.
--    Erro aqui PROPAGA (o admin vê a mensagem e nada muda) — não é engolido como na fila.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_kanban_config()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ligou     boolean := coalesce(NEW.kanban_automatico, false) AND NOT coalesce(OLD.kanban_automatico, false);
  v_cfg_mudou boolean;
  v_lote      uuid;
  v_agora     timestamptz := clock_timestamp();  -- relógio (não now()): separa, na MESMA txn, o antes/depois do lote
BEGIN
  IF NEW.tenant_id IS NULL OR NOT coalesce(NEW.kanban_automatico, false) THEN
    RETURN NULL;
  END IF;
  v_cfg_mudou := OLD.status_kanban IS DISTINCT FROM NEW.status_kanban
    OR OLD.kanban_requisitos IS DISTINCT FROM NEW.kanban_requisitos
    OR OLD.kanban_requisitos_excecoes IS DISTINCT FROM NEW.kanban_requisitos_excecoes
    OR OLD.revenda_kanban_colunas IS DISTINCT FROM NEW.revenda_kanban_colunas
    OR OLD.revenda_kanban_requisitos IS DISTINCT FROM NEW.revenda_kanban_requisitos;
  IF v_ligou OR v_cfg_mudou THEN
    v_lote := gen_random_uuid();
    INSERT INTO public.kanban_snapshot (lote_id, tenant_id, modelo_id, status_anterior, motivo, criado_at)
    SELECT v_lote, NEW.tenant_id, m.id, m.status_desenvolvimento,
           CASE WHEN v_ligou THEN 'ligar' ELSE 'config' END, v_agora
      FROM public.modelos m
     WHERE m.tenant_id = NEW.tenant_id
       AND coalesce(m.ordem_criacao_enviada, false)
       AND NOT coalesce(m.lancado, false);
  END IF;
  PERFORM public._kanban_aplicar(NEW.tenant_id, NULL, 'config', v_lote);
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_kanban_config ON public.tenant_config;
CREATE TRIGGER trg_kanban_config
  AFTER UPDATE ON public.tenant_config
  FOR EACH ROW
  WHEN (OLD.kanban_automatico IS DISTINCT FROM NEW.kanban_automatico
     OR OLD.status_kanban IS DISTINCT FROM NEW.status_kanban
     OR OLD.kanban_requisitos IS DISTINCT FROM NEW.kanban_requisitos
     OR OLD.kanban_requisitos_excecoes IS DISTINCT FROM NEW.kanban_requisitos_excecoes
     OR OLD.revenda_kanban_colunas IS DISTINCT FROM NEW.revenda_kanban_colunas
     OR OLD.revenda_kanban_requisitos IS DISTINCT FROM NEW.revenda_kanban_requisitos
     OR OLD.confeccao_prioridade IS DISTINCT FROM NEW.confeccao_prioridade)
  EXECUTE FUNCTION public.fn_kanban_config();

-- ────────────────────────────────────────────────────────────────────────────
-- G) Guard do status (BEFORE UPDATE OF status_desenvolvimento). Dispara em ordem alfabética
--    entre trg_colab_rev e trg_modelo_markup_congela (ANTES de trg_modelo_ref_auto).
--    Passa: chave desligada, GUC não vazio, card não derivável, status igual.
--    Senão (e sempre re-enfileira — o COMMIT re-deriva com o estado final):
--      ''/NULL → mantém o atual · fora do fluxo → P0001 · entrada ou manual → passa (fixa) ·
--      AUTOMÁTICA de fora do motor → estava FIXADO: vai p/ a posição DERIVADA ("tirar de manual
--      solta"); senão mantém o atual (draft velho do Sheet do Dev é ignorado).
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_kanban_status_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cfg      jsonb;
  v_comprado boolean;
  v_fluxo    text[];
  v_reqs     jsonb;
  v_exc      jsonb;
  v_para     text;
  v_atual    text;
  v_cond     jsonb;
BEGIN
  IF NEW.status_desenvolvimento IS NOT DISTINCT FROM OLD.status_desenvolvimento THEN RETURN NEW; END IF;
  IF coalesce(current_setting('app.kanban_sistema', true), '') <> '' THEN RETURN NEW; END IF;
  IF NOT public._kanban_ligado(NEW.tenant_id) THEN RETURN NEW; END IF;
  IF NOT (coalesce(NEW.ordem_criacao_enviada, false) AND NOT coalesce(NEW.lancado, false)) THEN RETURN NEW; END IF;

  v_cfg      := coalesce(public._kanban_cfg(NEW.tenant_id), '{}'::jsonb);
  v_comprado := coalesce(NEW.origem, 'interno') IN ('revenda', 'importado');
  v_fluxo    := public._kanban_fluxo(v_cfg, v_comprado);
  IF cardinality(v_fluxo) = 0 THEN RETURN NEW; END IF;
  v_reqs := CASE WHEN v_comprado THEN v_cfg -> 'revenda_kanban_requisitos' ELSE v_cfg -> 'kanban_requisitos' END;
  v_exc  := CASE WHEN v_comprado THEN '{}'::jsonb ELSE v_cfg -> 'kanban_requisitos_excecoes' END;

  PERFORM public._kanban_enfileirar(ARRAY[NEW.id]);

  v_para := public._kanban_norm(NEW.status_desenvolvimento);
  IF v_para = '' THEN
    NEW.status_desenvolvimento := OLD.status_desenvolvimento;
    RETURN NEW;
  END IF;
  IF NOT (v_para = ANY (v_fluxo)) THEN
    RAISE EXCEPTION 'A etapa "%" não faz parte do fluxo deste modelo.', NEW.status_desenvolvimento
      USING ERRCODE = 'P0001';
  END IF;
  IF v_para = v_fluxo[1] OR public._kanban_coluna_manual(v_para, v_reqs) THEN
    RETURN NEW;
  END IF;

  v_atual := public._kanban_norm(OLD.status_desenvolvimento);
  IF v_atual <> '' AND v_atual = ANY (v_fluxo) AND v_atual <> v_fluxo[1]
     AND public._kanban_coluna_manual(v_atual, v_reqs) THEN
    v_cond := coalesce(public._avaliar_condicoes_kanban_core(NEW.tenant_id, ARRAY[NEW.id]) -> NEW.id::text, '{}'::jsonb);
    NEW.status_desenvolvimento :=
      public._kanban_derivar_puro(v_fluxo, v_reqs, v_exc, v_cond, OLD.status_desenvolvimento, true) ->> 'alvo';
  ELSE
    NEW.status_desenvolvimento := OLD.status_desenvolvimento;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_kanban_status_guard ON public.modelos;
CREATE TRIGGER trg_kanban_status_guard
  BEFORE UPDATE OF status_desenvolvimento ON public.modelos
  FOR EACH ROW EXECUTE FUNCTION public.fn_kanban_status_guard();
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd "/Users/sunglee/PLM + Criação/plm-pcp" && DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres KANBAN_AUTO_MIG_TXN=1 npx vitest run --no-file-parallelism tests/integration/kanban-auto.test.ts`
Expected: PASS (47 testes) — inclusive os das Tasks 11–12, que já usam `comoSistema` p/ preparar dados sem passar pelo guard e `chave()` (GUC da RPC) p/ ligar/desligar.

- [ ] **Step 5: Gates + commit**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp"
npm run build 2>&1 | tail -3
npx tsc --noEmit 2>&1 | grep -E "TS2304|error" ; true
npx vitest run --no-file-parallelism tests/unit/kanban-auto.test.ts tests/unit/kanban-status.test.ts
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres KANBAN_AUTO_MIG_TXN=1 npx vitest run --no-file-parallelism tests/integration/kanban-auto.test.ts tests/integration/kanban-condicoes.test.ts
```
```bash
git commit --only -m "feat(kanban-auto): migration 3F/3G — trava da chave (só pela RPC), snapshot no servidor ao ligar/mudar a config + guard do status

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- supabase/migrations/20260930140000_kanban_auto_3_motor.sql tests/integration/kanban-auto.test.ts
git show --stat HEAD | tail -n +7   # confere: SÓ os paths acima
```

---

### Task 14: Migration 3 (parte H) — `_kanban_regredir_modelo`, `fn_modelo_ref_auto`, `_enviar_modelo_para_cad_core` com diff mínimo + inverso 3

**Files:**
- Modify: `supabase/migrations/20260930140000_kanban_auto_3_motor.sql` (inserir antes do `COMMIT;`)
- Create: `supabase/rollback/20260930140000_kanban_auto_3_motor_down.sql`
- Modify: `tests/integration/kanban-auto.test.ts`

**Interfaces:**
- Consumes: `_kanban_ligado`, `_kanban_status_gate` (Task 9); snapshot `/Users/sunglee/PLM + Criação/savepoints/2026-09-22-pre-unificacao/funcoes.sql` (NUNCA editar/commitar). Em 23/set o md5 de `pg_get_functiondef` das 5 funções redefinidas no banco vivo = md5 das linhas do snapshot (`_kanban_regredir_modelo` :3322-3403, `fn_modelo_ref_auto` :12141-12195, `_enviar_modelo_para_cad_core` :2150-2267, `fn_kanban_historico` :11976-11995, `_kanban_status_rows` :3455-3503).
- Produces: as 3 funções com UMA linha trocada/acrescentada cada (diff abaixo; o resto BYTE-A-BYTE); `_kanban_regredir_modelo` sai cedo com a chave ligada (legado INTACTO com ela desligada); gates de REF e Explosão recebem a posição de `_kanban_status_gate` (decisão 10). Inverso 3: derruba os 44 gatilhos novos e as 13 funções novas do motor (inclusive a trava da chave) e recria as 4 redefinidas pelo snapshot. Teste: `TROCAS_M3`, `REDEFINIDAS_M3`, `FUNCOES_M3`, `gatilhosNovos(c)`.

Diff mínimo (é exatamente o que o 1º teste abaixo verifica contra o `pg_get_functiondef` de ANTES, na mesma txn):

```diff
--- funcoes.sql:3322-3403  _kanban_regredir_modelo
+++ migration 3 (parte H)
@@ -3348 +3348,2 @@
   IF v_tenant IS NULL THEN RETURN; END IF;                 -- modelo sumiu (cascade delete)
+  IF public._kanban_ligado(v_tenant) THEN RETURN; END IF;  -- Kanban automático LIGADO: o motor (fila) recalcula
--- funcoes.sql:12141-12195  fn_modelo_ref_auto
@@ -12161 +12161 @@
-  v_revelar := public._ref_exibir_gate(NEW.tenant_id, NEW.status_desenvolvimento);
+  v_revelar := public._ref_exibir_gate(NEW.tenant_id, public._kanban_status_gate(NEW.tenant_id, NEW.id, NEW.status_desenvolvimento));
--- funcoes.sql:2150-2267  _enviar_modelo_para_cad_core
@@ -2186 +2186 @@
-    FROM public._explosao_envio_gate(v_tenant, (SELECT status_desenvolvimento FROM public.modelos WHERE id = _modelo_id)) AS g;
+    FROM public._explosao_envio_gate(v_tenant, public._kanban_status_gate(v_tenant, _modelo_id, (SELECT status_desenvolvimento FROM public.modelos WHERE id = _modelo_id))) AS g;
```

- [ ] **Step 1: Acrescentar os testes**

```ts
// ─────────── Migration 3H — funções redefinidas (diff mínimo) e gates por posição (Task 14) ───────────
const TROCAS_M3: { assinatura: string; de: string; para: string }[] = [
  {
    assinatura: "_kanban_regredir_modelo(uuid)",
    de: "  IF v_tenant IS NULL THEN RETURN; END IF;                 -- modelo sumiu (cascade delete)\n",
    para: "  IF v_tenant IS NULL THEN RETURN; END IF;                 -- modelo sumiu (cascade delete)\n" +
      "  IF public._kanban_ligado(v_tenant) THEN RETURN; END IF;  -- Kanban automático LIGADO: o motor (fila) recalcula\n",
  },
  {
    assinatura: "fn_modelo_ref_auto()",
    de: "  v_revelar := public._ref_exibir_gate(NEW.tenant_id, NEW.status_desenvolvimento);\n",
    para: "  v_revelar := public._ref_exibir_gate(NEW.tenant_id, public._kanban_status_gate(NEW.tenant_id, NEW.id, NEW.status_desenvolvimento));\n",
  },
  {
    assinatura: "_enviar_modelo_para_cad_core(uuid,text,text)",
    de: "    FROM public._explosao_envio_gate(v_tenant, (SELECT status_desenvolvimento FROM public.modelos WHERE id = _modelo_id)) AS g;\n",
    para: "    FROM public._explosao_envio_gate(v_tenant, public._kanban_status_gate(v_tenant, _modelo_id, (SELECT status_desenvolvimento FROM public.modelos WHERE id = _modelo_id))) AS g;\n",
  },
];

describe.skipIf(!hasDb || !MIG_TXN)("kanban-auto — migration 3H: diff mínimo das redefinidas (Task 14)", () => {
  it("pg_get_functiondef depois = antes com UMA linha trocada/acrescentada (3 funções); fn_kanban_historico mudou", async () => {
    await withTx(async (c) => {
      const antes: Record<string, string | null> = {};
      for (const t of TROCAS_M3) antes[t.assinatura] = await defFuncao(c, t.assinatura);
      const histAntes = await defFuncao(c, "fn_kanban_historico()");
      await prepara(c, 3);
      for (const t of TROCAS_M3) {
        expect(antes[t.assinatura]!.split(t.de).length - 1, t.assinatura).toBe(1);
        expect(await defFuncao(c, t.assinatura), t.assinatura).toBe(antes[t.assinatura]!.replace(t.de, t.para));
      }
      expect(await defFuncao(c, "fn_kanban_historico()")).not.toBe(histAntes);
    });
  });
});

describe.skipIf(!PRONTO)("kanban-auto — migration 3H: legado e gates por posição (Task 14)", () => {
  const REQS_MO = { etapa_a: ["data_desenho_tecnico"], etapa_c: ["servico_aprovado"], aprovado: ["data_aprovacao"] };

  it("chave DESLIGADA: _kanban_regredir_modelo legado intacto (MO reprovada → volta p/ a coluna que FALHA + #Erro)", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await configurarBoard(c, { reqs: REQS_MO });
      const M = await comoSistema(c, () => novoModelo(c, { status_desenvolvimento: "aprovado", data_desenho_tecnico: HOJE, data_aprovacao: HOJE }));
      const cat = await um<{ id: string }>(c, `SELECT id FROM public.categorias_terceirizado WHERE tenant_id = $1 AND ativo LIMIT 1`, [T]);
      await c.query(`INSERT INTO public.modelo_servico_mo (tenant_id, modelo_id, categoria_terceirizado_id, valor) VALUES ($1, $2, $3, 5)`, [T, M, cat.id]);
      await imediato(c);
      const m = await lerModelo(c, M);
      expect([m.status, m.erro]).toEqual(["etapa_c", true]);
    });
  });

  it("chave LIGADA: o legado sai cedo e o MOTOR regride p/ a última automática satisfeita ANTES da que falha (sem #Erro)", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await configurarBoard(c, { reqs: REQS_MO });
      await chave(c, true);
      const M = await comoSistema(c, () => novoModelo(c, { status_desenvolvimento: "aprovado", data_desenho_tecnico: HOJE, data_aprovacao: HOJE }));
      const cat = await um<{ id: string }>(c, `SELECT id FROM public.categorias_terceirizado WHERE tenant_id = $1 AND ativo LIMIT 1`, [T]);
      await c.query(`INSERT INTO public.modelo_servico_mo (tenant_id, modelo_id, categoria_terceirizado_id, valor) VALUES ($1, $2, $3, 5)`, [T, M, cat.id]);
      expect((await lerModelo(c, M)).status).toBe("aprovado"); // o legado NÃO agiu no statement
      await imediato(c);
      const m = await lerModelo(c, M);
      // etapa_b/stand_by são manuais (sem requisito); decisão 14: o recuo automático NÃO acende #Erro
      expect([m.status, m.erro]).toEqual(["etapa_a", false]);
    });
  });

  it("decisão 10: fixado ADIANTE da etapa não revela REF nem libera Explosão; quando a posição derivada chega, libera", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await comoUsuario(c);
      await configurarBoard(c, { ref: "etapa_c", explosao: "etapa_c" });
      await chave(c, true);
      const M = await comoSistema(c, () => novoModelo(c, { data_desenho_tecnico: HOJE }));
      await aplicar(c, [M]); // etapa_a
      await comoSistema(c, () => c.query(`UPDATE public.modelos SET ref = '' WHERE id = $1`, [M]));
      await setar(c, M, { status_desenvolvimento: "reprovado" }); // manual ADIANTE de etapa_c no board
      let m = await lerModelo(c, M);
      expect([m.status, m.ref ?? ""]).toEqual(["reprovado", ""]); // sem a decisão 10 a REF abriria aqui
      expect((await um<{ g: string }>(c, `SELECT public._kanban_status_gate($1, $2, 'reprovado') AS g`, [T, M])).g).toBe("etapa_a");
      await c.query("SAVEPOINT sp");
      await expect(c.query(`SELECT public.enviar_modelo_para_cad($1)`, [M])).rejects.toMatchObject({ code: "P0001" });
      await c.query("ROLLBACK TO SAVEPOINT sp");
      await setar(c, M, { data_piloto1: HOJE, data_piloto2: HOJE });
      await imediato(c);
      m = await lerModelo(c, M);
      expect(m.status).toBe("reprovado"); // continua fixado
      expect(m.ref).toBe(m.ref_auto); // REF revelada pelo motor (posição derivada = etapa_c)
      expect((await um<{ id: string }>(c, `SELECT public.enviar_modelo_para_cad($1) AS id`, [M])).id).toBeTruthy();
      await chave(c, false);
      expect((await um<{ g: string }>(c, `SELECT public._kanban_status_gate($1, $2, 'reprovado') AS g`, [T, M])).g).toBe("reprovado");
    });
  });
});

describe.skipIf(!hasDb || !MIG_TXN)("kanban-auto — chave DESLIGADA = idêntico a hoje (Task 14)", () => {
  async function eventos(c: Client) {
    const ms = (await c.query(
      `SELECT id FROM public.modelos WHERE tenant_id = $1 AND ordem_criacao_enviada AND NOT lancado ORDER BY id`, [T])).rows.map((r) => r.id);
    const cat = await um<{ id: string }>(c, `SELECT id FROM public.categorias_terceirizado WHERE tenant_id = $1 AND ativo LIMIT 1`, [T]);
    await c.query(`UPDATE public.modelos SET data_piloto1 = coalesce(data_piloto1, DATE '2026-01-01') + 1, linha_id = NULL WHERE id = $1`, [ms[0]]);
    await c.query(`UPDATE public.modelos SET status_desenvolvimento = 'aprovado' WHERE id = $1`, [ms[1]]);
    await c.query(`INSERT INTO public.modelo_servico_mo (tenant_id, modelo_id, categoria_terceirizado_id, valor) VALUES ($1, $2, $3, 10)`, [T, ms[2], cat.id]);
    await c.query(`UPDATE public.controle_qualidade SET status = 'pendente' WHERE cad_id IN (SELECT id FROM public.cad WHERE modelo_id = ANY($1::uuid[]))`, [ms]);
    await c.query(`UPDATE public.categorias_terceirizado SET ativo = NOT ativo WHERE id = $1`, [cat.id]);
    await c.query(`UPDATE public.cad SET enviado_corte = NOT coalesce(enviado_corte, false) WHERE modelo_id = $1`, [ms[3]]);
    await c.query(`UPDATE public.tenant_config SET kanban_requisitos = kanban_requisitos || '{"em_modelagem": ["modelista_definido"]}' WHERE tenant_id = $1`, [T]);
    await imediato(c);
    const st = (await c.query(`SELECT id, status_desenvolvimento, revisao_pendente, ref FROM public.modelos WHERE tenant_id = $1 ORDER BY id`, [T])).rows;
    const h = (await c.query(`SELECT modelo_id, status FROM public.modelo_kanban_historico WHERE tenant_id = $1 ORDER BY modelo_id, status, entrou_at`, [T])).rows;
    return { st, h };
  }

  it("os MESMOS eventos com e sem as migrations 1–3 dão os mesmos status, #Erro, REF e histórico; fila vazia", async () => {
    await withTx(async (c) => {
      exigeBancoLocal(); // só roda com KANBAN_AUTO_MIG_TXN=1; recusa ANTES até dos eventos (DML) fora da cópia local
      await comoUsuario(c);
      await c.query("SET LOCAL lock_timeout = '3s'");
      await c.query("SAVEPOINT sem_migracoes");
      const hoje = await eventos(c);
      await c.query("ROLLBACK TO SAVEPOINT sem_migracoes");
      await prepara(c, 3);
      const comF1 = await eventos(c);
      expect(comF1.st).toEqual(hoje.st);
      expect(comF1.h).toEqual(hoje.h);
      expect(await tamanhoFila(c)).toBe(0);
    });
  });
});

// ─────────────────────────── Inverso 3 (Task 14) ───────────────────────────
const REDEFINIDAS_M3 = ["fn_kanban_historico()", "_kanban_regredir_modelo(uuid)", "fn_modelo_ref_auto()", "_enviar_modelo_para_cad_core(uuid,text,text)"];
const FUNCOES_M3 = [
  "_kanban_enfileirar(uuid[])", "_kanban_enfileirar_tenant(uuid)", "_kanban_aplicar(uuid,uuid[],text,uuid)",
  "fn_kanban_processar_fila()", "fn_kanban_fila_modelo()", "fn_kanban_fila_por_modelo()", "fn_kanban_fila_por_cad()",
  "fn_kanban_fila_por_modelo_tecido()", "fn_kanban_fila_por_cad_tecido()", "fn_kanban_fila_categoria()",
  "fn_kanban_config()", "fn_kanban_status_guard()", "fn_kanban_chave_protegida()",
];
async function gatilhosNovos(c: Client): Promise<number> {
  return Number((await um<{ n: string }>(c,
    `SELECT count(*) AS n FROM pg_trigger
      WHERE NOT tgisinternal AND (tgname LIKE 'trg\\_kanban\\_fila\\_%'
         OR tgname IN ('trg_kanban_processar_fila', 'trg_kanban_config', 'trg_kanban_status_guard', 'trg_kanban_chave_protegida'))`)).n);
}

describe.skipIf(!hasDb || !MIG_TXN)("kanban-auto — inverso da migration 3 (Task 14)", () => {
  it("desfaz 3: as 4 redefinidas voltam BYTE-A-BYTE; os 44 gatilhos novos e as 13 funções novas somem", async () => {
    await withTx(async (c) => {
      const antes: Record<string, string | null> = {};
      for (const f of REDEFINIDAS_M3) antes[f] = await defFuncao(c, f);
      await prepara(c, 3);
      expect(await gatilhosNovos(c)).toBe(44); // 12 tabelas × 3 + modelos 2 + categorias 2 + fila 1 + config 1 + guard 1 + trava da chave 1
      await aplicarArquivo(c, INVERSOS[3]);
      for (const f of REDEFINIDAS_M3) expect(await defFuncao(c, f), f).toBe(antes[f]);
      for (const f of FUNCOES_M3) expect(await defFuncao(c, f), f).toBeNull();
      expect(await gatilhosNovos(c)).toBe(0);
      expect(await defFuncao(c, "_kanban_derivar_puro(text[],jsonb,jsonb,jsonb,text,boolean)")).not.toBeNull(); // a 2 fica
    });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd "/Users/sunglee/PLM + Criação/plm-pcp" && DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres KANBAN_AUTO_MIG_TXN=1 npx vitest run --no-file-parallelism tests/integration/kanban-auto.test.ts`
Expected: FAIL — diff mínimo (as 3 funções ainda iguais ao snapshot), `chave LIGADA: o legado sai cedo…` (o legado ainda regride p/ `etapa_c` no statement), decisão 10 (REF revelada ao fixar em `reprovado`) e `ENOENT … _kanban_auto_3_motor_down.sql`.

- [ ] **Step 3: Implementar** — inserir o bloco abaixo IMEDIATAMENTE ANTES da linha `COMMIT;` de `supabase/migrations/20260930140000_kanban_auto_3_motor.sql` (o arquivo termina sempre em `COMMIT;` + linha em branco + `select pg_notify('pgrst', 'reload schema');`). Conferir depois com `grep -c '^COMMIT;$' supabase/migrations/20260930140000_kanban_auto_3_motor.sql` = `1` e `grep -n '^BEGIN;$' supabase/migrations/20260930140000_kanban_auto_3_motor.sql` = só a linha do topo.

O texto é o do snapshot com as 3 linhas do diff (gerar copiando as faixas de linhas do `funcoes.sql` citadas acima e aplicando o diff — o teste do Step 1 reprova qualquer outro byte diferente).

```sql
-- ────────────────────────────────────────────────────────────────────────────
-- H) Funções REDEFINIDAS — texto BYTE-A-BYTE do snapshot
--    (/Users/sunglee/PLM + Criação/savepoints/2026-09-22-pre-unificacao/funcoes.sql) com UMA linha
--    trocada/acrescentada em cada (diff mínimo; o teste compara com o snapshot + a troca):
--    · _kanban_regredir_modelo (funcoes.sql:3322-3403): +1 linha após a :3348 — retorno antecipado
--      com a chave ligada (legado intacto com a chave desligada).
--    · fn_modelo_ref_auto (funcoes.sql:12141-12195): linha :12161 — o gate de REF recebe a posição
--      de `_kanban_status_gate` (decisão 10).
--    · _enviar_modelo_para_cad_core (funcoes.sql:2150-2267): linha :2186 — o gate de Explosão
--      recebe a posição de `_kanban_status_gate` (decisão 10).
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._kanban_regredir_modelo(_modelo_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_origem text;
  v_status text;
  v_lancado boolean;
  v_cur_idx int;
  v_reqs jsonb;      -- tenant_config.kanban_requisitos
  v_exc jsonb;       -- tenant_config.kanban_requisitos_excecoes
  v_cond jsonb;      -- mapa condição→bool do modelo
  v_col record;
  v_acc text[] := '{}';   -- requisitos efetivos acumulados (cascata) até a coluna corrente
  v_k text;
  v_exc_col text[];
  v_alvo_idx int := null;
  v_alvo_key text := null;
  v_falhou boolean;
BEGIN
  SELECT m.tenant_id, coalesce(m.origem,'interno'), m.status_desenvolvimento, coalesce(m.lancado,false)
    INTO v_tenant, v_origem, v_status, v_lancado
    FROM public.modelos m WHERE m.id = _modelo_id;
  IF v_tenant IS NULL THEN RETURN; END IF;                 -- modelo sumiu (cascade delete)
  IF public._kanban_ligado(v_tenant) THEN RETURN; END IF;  -- Kanban automático LIGADO: o motor (fila) recalcula
  IF v_origem IS DISTINCT FROM 'interno' THEN RETURN; END IF;  -- comprado: fluxo próprio, sem cascata
  IF v_lancado THEN RETURN; END IF;                        -- lançado: sai do fluxo; rebaixa é via CQ

  -- Config de requisitos por coluna (própria de cada etapa) + exceções.
  SELECT coalesce(kanban_requisitos, '{}'::jsonb), coalesce(kanban_requisitos_excecoes, '{}'::jsonb)
    INTO v_reqs, v_exc
    FROM public.tenant_config WHERE tenant_id = v_tenant;
  IF v_reqs IS NULL OR v_reqs = '{}'::jsonb THEN RETURN; END IF;  -- loja sem requisitos: nada a regredir

  -- Índice da coluna ATUAL do card na ordem do board (null → não está no board conhecido → sai).
  SELECT r.ord INTO v_cur_idx
    FROM public._kanban_status_rows(v_tenant) r
    WHERE r.key = lower(btrim(coalesce(v_status,''))) ORDER BY r.ord LIMIT 1;
  IF v_cur_idx IS NULL THEN RETURN; END IF;

  -- Mapa de condições do modelo (mesma fonte da RPC de avaliação).
  v_cond := coalesce(public._avaliar_condicoes_kanban_core(v_tenant, ARRAY[_modelo_id]) -> _modelo_id::text, '{}'::jsonb);

  -- Caminha as colunas na ORDEM do board; acumula os requisitos efetivos (cascata) e acha a
  -- PRIMEIRA coluna cujos requisitos efetivos incluem alguma condição NÃO satisfeita.
  FOR v_col IN SELECT r.ord, r.key FROM public._kanban_status_rows(v_tenant) r ORDER BY r.ord LOOP
    -- soma os requisitos PRÓPRIOS desta coluna
    FOR v_k IN SELECT jsonb_array_elements_text(coalesce(v_reqs -> v_col.key, '[]'::jsonb)) LOOP
      IF NOT (v_k = ANY(v_acc)) THEN v_acc := array_append(v_acc, v_k); END IF;
    END LOOP;
    -- subtrai as EXCEÇÕES desta coluna (herdados que o admin desligou aqui) — igual ao TS:
    -- só remove o que NÃO é próprio desta coluna.
    SELECT array_agg(x) INTO v_exc_col
      FROM jsonb_array_elements_text(coalesce(v_exc -> v_col.key, '[]'::jsonb)) x
      WHERE NOT (x IN (SELECT jsonb_array_elements_text(coalesce(v_reqs -> v_col.key, '[]'::jsonb))));
    IF v_exc_col IS NOT NULL THEN
      v_acc := ARRAY(SELECT a FROM unnest(v_acc) a WHERE NOT (a = ANY(v_exc_col)));
    END IF;

    -- esta coluna falha se algum requisito efetivo NÃO está satisfeito no mapa de condições
    v_falhou := EXISTS (
      SELECT 1 FROM unnest(v_acc) req
      WHERE coalesce((v_cond ->> req)::boolean, false) = false
    );
    IF v_falhou THEN
      v_alvo_idx := v_col.ord;
      v_alvo_key := v_col.key;
      EXIT;  -- a PRIMEIRA que falha é o alvo (a mais atrás)
    END IF;
  END LOOP;

  -- Move só se: existe coluna que falha E o card está À FRENTE dela.
  IF v_alvo_idx IS NOT NULL AND v_cur_idx > v_alvo_idx THEN
    UPDATE public.modelos
      SET status_desenvolvimento = v_alvo_key,
          revisao_pendente = coalesce(revisao_pendente, '{}'::jsonb) || '{"kanban": true}'::jsonb
      WHERE id = _modelo_id;
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_modelo_ref_auto()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sigla text; v_grupo text; v_cat text; v_sub text; v_num bigint;
  v_revelar boolean; v_relevante boolean; v_grupo_id uuid;
BEGIN
  IF NOT coalesce(NEW.ordem_criacao_enviada, false) THEN RETURN NEW; END IF;

  v_relevante := (TG_OP = 'INSERT')
    OR (NEW.ordem_criacao_enviada IS DISTINCT FROM OLD.ordem_criacao_enviada)
    OR (NEW.categoria_principal_id IS DISTINCT FROM OLD.categoria_principal_id)
    OR (NEW.subcategoria1_id IS DISTINCT FROM OLD.subcategoria1_id)
    OR (NEW.status_desenvolvimento IS DISTINCT FROM OLD.status_desenvolvimento)
    OR (coalesce(NEW.ref_auto,'') = '');
  IF NOT v_relevante THEN RETURN NEW; END IF;

  v_revelar := public._ref_exibir_gate(NEW.tenant_id, public._kanban_status_gate(NEW.tenant_id, NEW.id, NEW.status_desenvolvimento));

  SELECT c.nome, gp.nome, c.grupo_id INTO v_cat, v_grupo, v_grupo_id
    FROM public.categorias_produto c
    LEFT JOIN public.grupos_produto gp ON gp.id = c.grupo_id
    WHERE c.id = NEW.categoria_principal_id;
  SELECT s.nome INTO v_sub FROM public.subcategorias1_produto s WHERE s.id = NEW.subcategoria1_id;

  v_sigla := public._ref_montar_sigla(NEW.tenant_id, 'interno', v_grupo_id, NEW.categoria_principal_id, NEW.subcategoria1_id, NULL);
  IF v_sigla IS NULL THEN
    v_sigla := public._modelo_ref_sigla(v_grupo, v_cat, v_sub);
  END IF;

  IF NOT v_revelar THEN
    IF v_sigla <> '' THEN
      -- Número fixo na chegada: extrai o bloco final de dígitos do ref_auto atual, senão gera.
      IF coalesce(NEW.ref_auto,'') ~ '[0-9]+$' THEN
        v_num := substring(NEW.ref_auto from '([0-9]+)$')::bigint;
      ELSE
        v_num := public._modelo_ref_next_num(NEW.tenant_id);
      END IF;
      NEW.ref_auto := public._ref_juntar(NEW.tenant_id, v_sigla, public._ref_num_fmt(NEW.tenant_id, v_num));
    END IF;
  ELSE
    IF coalesce(NEW.ref_auto,'') = '' AND v_sigla <> '' THEN
      v_num := public._modelo_ref_next_num(NEW.tenant_id);
      NEW.ref_auto := public._ref_juntar(NEW.tenant_id, v_sigla, public._ref_num_fmt(NEW.tenant_id, v_num));
    END IF;
    IF coalesce(NEW.ref,'') = '' AND coalesce(NEW.ref_auto,'') <> '' THEN
      NEW.ref := NEW.ref_auto;
    END IF;
  END IF;

  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public._enviar_modelo_para_cad_core(_modelo_id uuid, _observacoes_tecnicas text DEFAULT NULL::text, _ficha_medida_url text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_user uuid := auth.uid();
  v_cad_id uuid;
  v_new_tid uuid;
  v_grade_total numeric;
  rt record;
  rg record;
  ra record;
  v_idx int := 0;
  v_gate_ok boolean;
  v_gate_label text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.modelos WHERE id = _modelo_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Modelo não encontrado';
  END IF;
  IF v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para este modelo';
  END IF;

  -- Gate de etapa (configurável por loja, tenant_config.explosao_envio_status): o modelo
  -- só é enviado à Explosão A PARTIR da etapa configurada (ou de qualquer etapa POSTERIOR
  -- na ordem do board). Ausente ⇒ 'aprovado'. Órfã ⇒ fallback 'aprovado'.
  -- ERRCODE P0001 (NÃO 23514 — senão erro-mensagem.ts engole a mensagem PT).
  SELECT g.ok, g.req_label INTO v_gate_ok, v_gate_label
    FROM public._explosao_envio_gate(v_tenant, public._kanban_status_gate(v_tenant, _modelo_id, (SELECT status_desenvolvimento FROM public.modelos WHERE id = _modelo_id))) AS g;
  IF NOT COALESCE(v_gate_ok, false) THEN
    RAISE EXCEPTION 'O modelo precisa estar na etapa "%" (ou posterior) para ser enviado à Explosão.', v_gate_label
      USING ERRCODE = 'P0001';
  END IF;

  -- IDEMPOTENTE: se o CAD já existe (o save do card cria/sincroniza), NÃO recria.
  -- Só atualiza observações/ficha (se informadas) e marca o modelo como enviado à Explosão.
  SELECT id INTO v_cad_id FROM public.cad WHERE modelo_id = _modelo_id;
  IF v_cad_id IS NOT NULL THEN
    UPDATE public.cad
       SET observacoes_tecnicas = COALESCE(_observacoes_tecnicas, observacoes_tecnicas),
           ficha_medida_url     = COALESCE(_ficha_medida_url, ficha_medida_url)
     WHERE id = v_cad_id;
    UPDATE public.modelos SET enviado_cad = true WHERE id = _modelo_id;
    RETURN v_cad_id;
  END IF;

  INSERT INTO public.cad (modelo_id, observacoes_tecnicas, ficha_medida_url, status_corte)
  VALUES (_modelo_id, _observacoes_tecnicas, _ficha_medida_url, 'pendente')
  RETURNING id INTO v_cad_id;

  -- Copia tecidos + variantes (preserva ordem e multiplicador).
  FOR rt IN
    SELECT id, artigo_id, numero, tipo, consumo, loss_percent, custo_previsto
    FROM public.modelo_tecidos WHERE modelo_id = _modelo_id ORDER BY numero
  LOOP
    INSERT INTO public.cad_tecidos
      (cad_id, artigo_id, numero, tipo, consumo_cad, loss_percent_cad, custo_cad, tamanho_folha)
    VALUES
      (v_cad_id, rt.artigo_id, rt.numero, rt.tipo,
       COALESCE(rt.consumo, 0), COALESCE(rt.loss_percent, 0), COALESCE(rt.custo_previsto, 0), 0)
    RETURNING id INTO v_new_tid;

    INSERT INTO public.cad_tecido_variantes
      (cad_tecido_id, variante_tecido_id, ordem, multiplicador,
       quantidade_folhas, metragem_planejada, metragem_enviada, complementa_variante_ids)
    SELECT v_new_tid, mtv.variante_tecido_id, mtv.ordem,
           COALESCE(mtv.multiplicador, 1), 0, 0, 0, mtv.complementa_variante_ids
    FROM public.modelo_tecido_variantes mtv
    WHERE mtv.modelo_tecido_id = rt.id;
  END LOOP;

  -- Copia grade planejada -> cad_grades (planejada = real).
  v_grade_total := 0;
  FOR rg IN
    SELECT variante_numero, grades, grade_total
    FROM public.modelo_grades WHERE modelo_id = _modelo_id
  LOOP
    INSERT INTO public.cad_grades
      (cad_id, variante_numero, grades_planejadas, grades_reais,
       grade_total_planejada, grade_total_real)
    VALUES
      (v_cad_id, rg.variante_numero,
       COALESCE(rg.grades, '{}'::jsonb), COALESCE(rg.grades, '{}'::jsonb),
       COALESCE(rg.grade_total, 0), COALESCE(rg.grade_total, 0));
    v_grade_total := v_grade_total + COALESCE(rg.grade_total, 0);
  END LOOP;

  -- Copia aviamentos (qtd = consumo * grade total geral; numero sequencial).
  -- [NOVO] leva a variante_aviamento_id do BOM p/ o CAD → cad_aviamentos vira
  -- POR aviamento×variante (base da "a separar" editável por variante na Explosão).
  FOR ra IN
    SELECT aviamento_id, consumo, variante_aviamento_id
    FROM public.modelo_aviamentos WHERE modelo_id = _modelo_id ORDER BY numero
  LOOP
    v_idx := v_idx + 1;
    INSERT INTO public.cad_aviamentos
      (cad_id, aviamento_id, numero, consumo, quantidade_enviar, quantidade_separar, variante_aviamento_id)
    VALUES
      (v_cad_id, ra.aviamento_id, v_idx,
       COALESCE(ra.consumo, 0),
       ROUND(COALESCE(ra.consumo, 0) * v_grade_total, 4),
       ROUND(COALESCE(ra.consumo, 0) * v_grade_total, 4),
       ra.variante_aviamento_id);
  END LOOP;

  UPDATE public.modelos SET enviado_cad = true WHERE id = _modelo_id;

  RETURN v_cad_id;
END;
$function$
;

-- @@FIM_H
```

- [ ] **Step 4: Criar `supabase/rollback/20260930140000_kanban_auto_3_motor_down.sql`** (as 4 funções recriadas são as faixas do `funcoes.sql` citadas no cabeçalho, com `;` no fim)

```sql
-- INVERSO de 20260930140000_kanban_auto_3_motor.sql — rodar depois do inverso 4 (ordem 4 → 3 → 2 → 1).
-- Derruba TODOS os gatilhos novos (inclusive os 3 statement-level por tabela-filha), as funções
-- novas do motor, e RECRIA as 4 funções redefinidas com o texto BYTE-A-BYTE do snapshot
-- /Users/sunglee/PLM + Criação/savepoints/2026-09-22-pre-unificacao/funcoes.sql:
--   fn_kanban_historico (:11976-11995) · _kanban_regredir_modelo (:3322-3403) ·
--   fn_modelo_ref_auto (:12141-12195) · _enviar_modelo_para_cad_core (:2150-2267).
-- Não toca dado de modelos. Se a chave foi ligada, restaurar ANTES as colunas
-- (kanban_previa_restauracao / kanban_restaurar), enquanto a migration 4 existe.

BEGIN;

-- 1) Gatilhos novos
DROP TRIGGER IF EXISTS trg_kanban_status_guard ON public.modelos;
DROP TRIGGER IF EXISTS trg_kanban_fila_upd ON public.modelos;
DROP TRIGGER IF EXISTS trg_kanban_fila_ins ON public.modelos;
DROP TRIGGER IF EXISTS trg_kanban_config ON public.tenant_config;
DROP TRIGGER IF EXISTS trg_kanban_chave_protegida ON public.tenant_config;
DROP TRIGGER IF EXISTS trg_kanban_fila_upd ON public.categorias_terceirizado;
DROP TRIGGER IF EXISTS trg_kanban_fila_del ON public.categorias_terceirizado;
DO $do$
BEGIN
  -- a tabela some no inverso 1; rodar este inverso de novo depois dele não pode falhar
  IF to_regclass('public.kanban_recalculo_fila') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_kanban_processar_fila ON public.kanban_recalculo_fila;
  END IF;
END
$do$;
DO $do$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['modelo_tecidos', 'modelo_grades', 'modelo_aviamentos', 'modelo_servico_mo', 'cad',
                           'modelo_tecido_variantes', 'cad_tecidos', 'cad_aviamentos', 'cad_etiquetas',
                           'controle_qualidade', 'producao_terceirizados', 'cad_tecido_variantes'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_kanban_fila_ins ON public.%I', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_kanban_fila_upd ON public.%I', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_kanban_fila_del ON public.%I', t);
  END LOOP;
END
$do$;

-- 2) Funções novas do motor
DROP FUNCTION IF EXISTS public.fn_kanban_chave_protegida();
DROP FUNCTION IF EXISTS public.fn_kanban_status_guard();
DROP FUNCTION IF EXISTS public.fn_kanban_config();
DROP FUNCTION IF EXISTS public.fn_kanban_fila_categoria();
DROP FUNCTION IF EXISTS public.fn_kanban_fila_por_cad_tecido();
DROP FUNCTION IF EXISTS public.fn_kanban_fila_por_modelo_tecido();
DROP FUNCTION IF EXISTS public.fn_kanban_fila_por_cad();
DROP FUNCTION IF EXISTS public.fn_kanban_fila_por_modelo();
DROP FUNCTION IF EXISTS public.fn_kanban_fila_modelo();
DROP FUNCTION IF EXISTS public.fn_kanban_processar_fila();
DROP FUNCTION IF EXISTS public._kanban_aplicar(uuid, uuid[], text, uuid);
DROP FUNCTION IF EXISTS public._kanban_enfileirar_tenant(uuid);
DROP FUNCTION IF EXISTS public._kanban_enfileirar(uuid[]);

-- 3) Funções redefinidas → texto do snapshot (CREATE OR REPLACE preserva o ACL de hoje)
CREATE OR REPLACE FUNCTION public.fn_kanban_historico()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status_desenvolvimento IS NOT NULL THEN
      INSERT INTO public.modelo_kanban_historico(tenant_id, modelo_id, status, entrou_at)
      VALUES (NEW.tenant_id, NEW.id, NEW.status_desenvolvimento, COALESCE(NEW.created_at, now()));
    END IF;
  ELSIF NEW.status_desenvolvimento IS DISTINCT FROM OLD.status_desenvolvimento
        AND NEW.status_desenvolvimento IS NOT NULL THEN
    INSERT INTO public.modelo_kanban_historico(tenant_id, modelo_id, status, entrou_at)
    VALUES (NEW.tenant_id, NEW.id, NEW.status_desenvolvimento, now());
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public._kanban_regredir_modelo(_modelo_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_origem text;
  v_status text;
  v_lancado boolean;
  v_cur_idx int;
  v_reqs jsonb;      -- tenant_config.kanban_requisitos
  v_exc jsonb;       -- tenant_config.kanban_requisitos_excecoes
  v_cond jsonb;      -- mapa condição→bool do modelo
  v_col record;
  v_acc text[] := '{}';   -- requisitos efetivos acumulados (cascata) até a coluna corrente
  v_k text;
  v_exc_col text[];
  v_alvo_idx int := null;
  v_alvo_key text := null;
  v_falhou boolean;
BEGIN
  SELECT m.tenant_id, coalesce(m.origem,'interno'), m.status_desenvolvimento, coalesce(m.lancado,false)
    INTO v_tenant, v_origem, v_status, v_lancado
    FROM public.modelos m WHERE m.id = _modelo_id;
  IF v_tenant IS NULL THEN RETURN; END IF;                 -- modelo sumiu (cascade delete)
  IF v_origem IS DISTINCT FROM 'interno' THEN RETURN; END IF;  -- comprado: fluxo próprio, sem cascata
  IF v_lancado THEN RETURN; END IF;                        -- lançado: sai do fluxo; rebaixa é via CQ

  -- Config de requisitos por coluna (própria de cada etapa) + exceções.
  SELECT coalesce(kanban_requisitos, '{}'::jsonb), coalesce(kanban_requisitos_excecoes, '{}'::jsonb)
    INTO v_reqs, v_exc
    FROM public.tenant_config WHERE tenant_id = v_tenant;
  IF v_reqs IS NULL OR v_reqs = '{}'::jsonb THEN RETURN; END IF;  -- loja sem requisitos: nada a regredir

  -- Índice da coluna ATUAL do card na ordem do board (null → não está no board conhecido → sai).
  SELECT r.ord INTO v_cur_idx
    FROM public._kanban_status_rows(v_tenant) r
    WHERE r.key = lower(btrim(coalesce(v_status,''))) ORDER BY r.ord LIMIT 1;
  IF v_cur_idx IS NULL THEN RETURN; END IF;

  -- Mapa de condições do modelo (mesma fonte da RPC de avaliação).
  v_cond := coalesce(public._avaliar_condicoes_kanban_core(v_tenant, ARRAY[_modelo_id]) -> _modelo_id::text, '{}'::jsonb);

  -- Caminha as colunas na ORDEM do board; acumula os requisitos efetivos (cascata) e acha a
  -- PRIMEIRA coluna cujos requisitos efetivos incluem alguma condição NÃO satisfeita.
  FOR v_col IN SELECT r.ord, r.key FROM public._kanban_status_rows(v_tenant) r ORDER BY r.ord LOOP
    -- soma os requisitos PRÓPRIOS desta coluna
    FOR v_k IN SELECT jsonb_array_elements_text(coalesce(v_reqs -> v_col.key, '[]'::jsonb)) LOOP
      IF NOT (v_k = ANY(v_acc)) THEN v_acc := array_append(v_acc, v_k); END IF;
    END LOOP;
    -- subtrai as EXCEÇÕES desta coluna (herdados que o admin desligou aqui) — igual ao TS:
    -- só remove o que NÃO é próprio desta coluna.
    SELECT array_agg(x) INTO v_exc_col
      FROM jsonb_array_elements_text(coalesce(v_exc -> v_col.key, '[]'::jsonb)) x
      WHERE NOT (x IN (SELECT jsonb_array_elements_text(coalesce(v_reqs -> v_col.key, '[]'::jsonb))));
    IF v_exc_col IS NOT NULL THEN
      v_acc := ARRAY(SELECT a FROM unnest(v_acc) a WHERE NOT (a = ANY(v_exc_col)));
    END IF;

    -- esta coluna falha se algum requisito efetivo NÃO está satisfeito no mapa de condições
    v_falhou := EXISTS (
      SELECT 1 FROM unnest(v_acc) req
      WHERE coalesce((v_cond ->> req)::boolean, false) = false
    );
    IF v_falhou THEN
      v_alvo_idx := v_col.ord;
      v_alvo_key := v_col.key;
      EXIT;  -- a PRIMEIRA que falha é o alvo (a mais atrás)
    END IF;
  END LOOP;

  -- Move só se: existe coluna que falha E o card está À FRENTE dela.
  IF v_alvo_idx IS NOT NULL AND v_cur_idx > v_alvo_idx THEN
    UPDATE public.modelos
      SET status_desenvolvimento = v_alvo_key,
          revisao_pendente = coalesce(revisao_pendente, '{}'::jsonb) || '{"kanban": true}'::jsonb
      WHERE id = _modelo_id;
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_modelo_ref_auto()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sigla text; v_grupo text; v_cat text; v_sub text; v_num bigint;
  v_revelar boolean; v_relevante boolean; v_grupo_id uuid;
BEGIN
  IF NOT coalesce(NEW.ordem_criacao_enviada, false) THEN RETURN NEW; END IF;

  v_relevante := (TG_OP = 'INSERT')
    OR (NEW.ordem_criacao_enviada IS DISTINCT FROM OLD.ordem_criacao_enviada)
    OR (NEW.categoria_principal_id IS DISTINCT FROM OLD.categoria_principal_id)
    OR (NEW.subcategoria1_id IS DISTINCT FROM OLD.subcategoria1_id)
    OR (NEW.status_desenvolvimento IS DISTINCT FROM OLD.status_desenvolvimento)
    OR (coalesce(NEW.ref_auto,'') = '');
  IF NOT v_relevante THEN RETURN NEW; END IF;

  v_revelar := public._ref_exibir_gate(NEW.tenant_id, NEW.status_desenvolvimento);

  SELECT c.nome, gp.nome, c.grupo_id INTO v_cat, v_grupo, v_grupo_id
    FROM public.categorias_produto c
    LEFT JOIN public.grupos_produto gp ON gp.id = c.grupo_id
    WHERE c.id = NEW.categoria_principal_id;
  SELECT s.nome INTO v_sub FROM public.subcategorias1_produto s WHERE s.id = NEW.subcategoria1_id;

  v_sigla := public._ref_montar_sigla(NEW.tenant_id, 'interno', v_grupo_id, NEW.categoria_principal_id, NEW.subcategoria1_id, NULL);
  IF v_sigla IS NULL THEN
    v_sigla := public._modelo_ref_sigla(v_grupo, v_cat, v_sub);
  END IF;

  IF NOT v_revelar THEN
    IF v_sigla <> '' THEN
      -- Número fixo na chegada: extrai o bloco final de dígitos do ref_auto atual, senão gera.
      IF coalesce(NEW.ref_auto,'') ~ '[0-9]+$' THEN
        v_num := substring(NEW.ref_auto from '([0-9]+)$')::bigint;
      ELSE
        v_num := public._modelo_ref_next_num(NEW.tenant_id);
      END IF;
      NEW.ref_auto := public._ref_juntar(NEW.tenant_id, v_sigla, public._ref_num_fmt(NEW.tenant_id, v_num));
    END IF;
  ELSE
    IF coalesce(NEW.ref_auto,'') = '' AND v_sigla <> '' THEN
      v_num := public._modelo_ref_next_num(NEW.tenant_id);
      NEW.ref_auto := public._ref_juntar(NEW.tenant_id, v_sigla, public._ref_num_fmt(NEW.tenant_id, v_num));
    END IF;
    IF coalesce(NEW.ref,'') = '' AND coalesce(NEW.ref_auto,'') <> '' THEN
      NEW.ref := NEW.ref_auto;
    END IF;
  END IF;

  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public._enviar_modelo_para_cad_core(_modelo_id uuid, _observacoes_tecnicas text DEFAULT NULL::text, _ficha_medida_url text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_user uuid := auth.uid();
  v_cad_id uuid;
  v_new_tid uuid;
  v_grade_total numeric;
  rt record;
  rg record;
  ra record;
  v_idx int := 0;
  v_gate_ok boolean;
  v_gate_label text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.modelos WHERE id = _modelo_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Modelo não encontrado';
  END IF;
  IF v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para este modelo';
  END IF;

  -- Gate de etapa (configurável por loja, tenant_config.explosao_envio_status): o modelo
  -- só é enviado à Explosão A PARTIR da etapa configurada (ou de qualquer etapa POSTERIOR
  -- na ordem do board). Ausente ⇒ 'aprovado'. Órfã ⇒ fallback 'aprovado'.
  -- ERRCODE P0001 (NÃO 23514 — senão erro-mensagem.ts engole a mensagem PT).
  SELECT g.ok, g.req_label INTO v_gate_ok, v_gate_label
    FROM public._explosao_envio_gate(v_tenant, (SELECT status_desenvolvimento FROM public.modelos WHERE id = _modelo_id)) AS g;
  IF NOT COALESCE(v_gate_ok, false) THEN
    RAISE EXCEPTION 'O modelo precisa estar na etapa "%" (ou posterior) para ser enviado à Explosão.', v_gate_label
      USING ERRCODE = 'P0001';
  END IF;

  -- IDEMPOTENTE: se o CAD já existe (o save do card cria/sincroniza), NÃO recria.
  -- Só atualiza observações/ficha (se informadas) e marca o modelo como enviado à Explosão.
  SELECT id INTO v_cad_id FROM public.cad WHERE modelo_id = _modelo_id;
  IF v_cad_id IS NOT NULL THEN
    UPDATE public.cad
       SET observacoes_tecnicas = COALESCE(_observacoes_tecnicas, observacoes_tecnicas),
           ficha_medida_url     = COALESCE(_ficha_medida_url, ficha_medida_url)
     WHERE id = v_cad_id;
    UPDATE public.modelos SET enviado_cad = true WHERE id = _modelo_id;
    RETURN v_cad_id;
  END IF;

  INSERT INTO public.cad (modelo_id, observacoes_tecnicas, ficha_medida_url, status_corte)
  VALUES (_modelo_id, _observacoes_tecnicas, _ficha_medida_url, 'pendente')
  RETURNING id INTO v_cad_id;

  -- Copia tecidos + variantes (preserva ordem e multiplicador).
  FOR rt IN
    SELECT id, artigo_id, numero, tipo, consumo, loss_percent, custo_previsto
    FROM public.modelo_tecidos WHERE modelo_id = _modelo_id ORDER BY numero
  LOOP
    INSERT INTO public.cad_tecidos
      (cad_id, artigo_id, numero, tipo, consumo_cad, loss_percent_cad, custo_cad, tamanho_folha)
    VALUES
      (v_cad_id, rt.artigo_id, rt.numero, rt.tipo,
       COALESCE(rt.consumo, 0), COALESCE(rt.loss_percent, 0), COALESCE(rt.custo_previsto, 0), 0)
    RETURNING id INTO v_new_tid;

    INSERT INTO public.cad_tecido_variantes
      (cad_tecido_id, variante_tecido_id, ordem, multiplicador,
       quantidade_folhas, metragem_planejada, metragem_enviada, complementa_variante_ids)
    SELECT v_new_tid, mtv.variante_tecido_id, mtv.ordem,
           COALESCE(mtv.multiplicador, 1), 0, 0, 0, mtv.complementa_variante_ids
    FROM public.modelo_tecido_variantes mtv
    WHERE mtv.modelo_tecido_id = rt.id;
  END LOOP;

  -- Copia grade planejada -> cad_grades (planejada = real).
  v_grade_total := 0;
  FOR rg IN
    SELECT variante_numero, grades, grade_total
    FROM public.modelo_grades WHERE modelo_id = _modelo_id
  LOOP
    INSERT INTO public.cad_grades
      (cad_id, variante_numero, grades_planejadas, grades_reais,
       grade_total_planejada, grade_total_real)
    VALUES
      (v_cad_id, rg.variante_numero,
       COALESCE(rg.grades, '{}'::jsonb), COALESCE(rg.grades, '{}'::jsonb),
       COALESCE(rg.grade_total, 0), COALESCE(rg.grade_total, 0));
    v_grade_total := v_grade_total + COALESCE(rg.grade_total, 0);
  END LOOP;

  -- Copia aviamentos (qtd = consumo * grade total geral; numero sequencial).
  -- [NOVO] leva a variante_aviamento_id do BOM p/ o CAD → cad_aviamentos vira
  -- POR aviamento×variante (base da "a separar" editável por variante na Explosão).
  FOR ra IN
    SELECT aviamento_id, consumo, variante_aviamento_id
    FROM public.modelo_aviamentos WHERE modelo_id = _modelo_id ORDER BY numero
  LOOP
    v_idx := v_idx + 1;
    INSERT INTO public.cad_aviamentos
      (cad_id, aviamento_id, numero, consumo, quantidade_enviar, quantidade_separar, variante_aviamento_id)
    VALUES
      (v_cad_id, ra.aviamento_id, v_idx,
       COALESCE(ra.consumo, 0),
       ROUND(COALESCE(ra.consumo, 0) * v_grade_total, 4),
       ROUND(COALESCE(ra.consumo, 0) * v_grade_total, 4),
       ra.variante_aviamento_id);
  END LOOP;

  UPDATE public.modelos SET enviado_cad = true WHERE id = _modelo_id;

  RETURN v_cad_id;
END;
$function$
;

COMMIT;

select pg_notify('pgrst', 'reload schema');
```

- [ ] **Step 5: Rodar e ver passar**

Run: `cd "/Users/sunglee/PLM + Criação/plm-pcp" && DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres KANBAN_AUTO_MIG_TXN=1 npx vitest run --no-file-parallelism tests/integration/kanban-auto.test.ts`
Expected: PASS (53 testes), inclusive "chave DESLIGADA = idêntico a hoje": os MESMOS eventos (Sheet do Dev, arraste antigo, MO pendente, CQ, categoria, envio ao corte, mudança de requisito) rodados SEM as migrations (savepoint) e COM as migrations 1–3 dão os mesmos status/#Erro/REF/histórico e a fila fica vazia.

- [ ] **Step 6: Conferir o arquivo final da migration 3**

Run: `grep -n "^-- [A-H])" supabase/migrations/20260930140000_kanban_auto_3_motor.sql ; grep -c '^COMMIT;$' supabase/migrations/20260930140000_kanban_auto_3_motor.sql`
Expected: seções `A) B) C) D) E) F) G) H)` nessa ordem e `1`.

- [ ] **Step 7: Gates + commit**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp"
npm run build 2>&1 | tail -3
npx tsc --noEmit 2>&1 | grep -E "TS2304|error" ; true
npx vitest run --no-file-parallelism tests/unit/kanban-auto.test.ts tests/unit/kanban-status.test.ts
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres KANBAN_AUTO_MIG_TXN=1 npx vitest run --no-file-parallelism tests/integration/kanban-auto.test.ts tests/integration/kanban-condicoes.test.ts
```
```bash
git add -- supabase/rollback/20260930140000_kanban_auto_3_motor_down.sql
git commit --only -m "feat(kanban-auto): migration 3H — legado sai cedo c/ chave ligada, gates de REF/Explosão pela posição derivada (diff mínimo) + inverso 3

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- supabase/rollback/20260930140000_kanban_auto_3_motor_down.sql supabase/migrations/20260930140000_kanban_auto_3_motor.sql tests/integration/kanban-auto.test.ts
git show --stat HEAD | tail -n +7   # confere: SÓ os paths acima
```

---

### Task 15: Migration 4 (parte A) — `kanban_mover`, `kanban_previa_recalculo` (+ REFs reveladas) e `kanban_definir_automatico`

**Files:**
- Create: `supabase/migrations/20260930150000_kanban_auto_4_rpcs.sql`
- Modify: `tests/integration/kanban-auto.test.ts`

**Interfaces:**
- Consumes: `_kanban_derivar_lote`, `_kanban_destino_drop_puro`, `_kanban_cfg`, `_kanban_fluxo`, `_kanban_ligado`, `_kanban_norm` (Tasks 8–9); `auth.uid()`, `tenant_module_enabled(text)`, `user_can_edit(text)`, `get_user_tenant_id()`, `is_tenant_admin()`, `is_super_admin()` (existentes).
- Produces (RPC pública: SECURITY DEFINER, `SET search_path TO 'public'`, `REVOKE … FROM PUBLIC, anon` + `GRANT … TO authenticated`):
  - `kanban_mover(_modelo_id uuid, _para text) → jsonb {acao: 'fixar'|'soltar'|'nada'|'bloquear_faltando'|'bloquear_ja_cumprida'|'fora_do_fluxo', status: text|null (o gravado DEPOIS), faltando: text[] (keys do catálogo), rev: int}`. Guardas: não autenticado/módulo `criacao` desligado/sem `user_can_edit('criacao_desenvolvimento')`/loja inativa → `42501`; modelo fora do tenant → `P0002 'Modelo não encontrado.'`; chave desligada → `P0001` (D3). fixar/soltar gravam com GUC `'manual'`; fixar/soltar/nada apagam o `#Erro`; NÃO mexe em `motivo_cancelamento` (decisão 15 — D4 alterada).
  - `kanban_previa_recalculo(_cfg jsonb) → jsonb {chave_proposta, total, mudam, fixados, cards: [{modelo_id, nome, ref, origem, de, para, fixado, recua, primeira_falha, faltando}], cards_fixados: [{modelo_id, nome, ref, origem, coluna, posicao_derivada}], revelam_ref, refs_reveladas: [{modelo_id, nome, ref_auto, posicao_derivada}], avisos: text[]}` — só `is_tenant_admin() OR is_super_admin()` (senão `42501`); STABLE; NÃO grava (D11 + R4: critério das REFs no §3).
  - `kanban_definir_automatico(_ligar boolean) → jsonb {ligado, mudou, lote_id, snapshot, cards_movidos}` — o BOTÃO da chave, ÚNICA porta de `kanban_automatico` (decisão 16; D19): só admin da loja/super (`42501`), `_ligar` nulo → `P0001`, loja sem config → `P0002`; seta `app.kanban_chave='rpc'` só em volta do UPDATE e restaura; ao ligar, o `trg_kanban_config` grava o lote `'ligar'` e recalcula na MESMA txn; mesmo valor → `mudou=false` e nada grava.
- Teste: `mover(c, id, para)`, `definir(c, ligar)`.

- [ ] **Step 1: Acrescentar os testes**

```ts
// ─────────────── Migration 4A — kanban_mover e prévia de recálculo (Task 15) ───────────────
async function mover(c: Client, id: string, para: string) {
  return (await um<{ r: { acao: string; status: string | null; faltando: string[]; rev: number } }>(c,
    `SELECT public.kanban_mover($1, $2) AS r`, [id, para])).r;
}
async function definir(c: Client, ligar: boolean) {
  return (await um<{ r: { ligado: boolean; mudou: boolean; lote_id: string | null; snapshot: number; cards_movidos: number } }>(c,
    `SELECT public.kanban_definir_automatico($1) AS r`, [ligar])).r;
}

describe.skipIf(!PRONTO)("kanban-auto — migration 4A: kanban_mover (Task 15)", () => {
  it("aplica a tabela ÚNICA de arraste no servidor: fixar/soltar/nada/bloqueios; limpa #Erro; devolve rev", async () => {
    await withTx(async (c) => {
      await prepara(c, 4);
      await comoUsuario(c);
      await configurarBoard(c);
      await chave(c, true);
      const M = await comoSistema(c, () => novoModelo(c, { data_desenho_tecnico: HOJE, data_piloto1: HOJE, data_piloto2: HOJE }));
      await aplicar(c, [M]); // etapa_c
      await comoSistema(c, () => c.query(`UPDATE public.modelos SET revisao_pendente = '{"kanban": true}' WHERE id = $1`, [M]));

      let r = await mover(c, M, "stand_by");
      expect([r.acao, r.status, r.faltando]).toEqual(["fixar", "stand_by", []]);
      let m = await lerModelo(c, M);
      expect([m.status, m.erro, m.rev]).toEqual(["stand_by", false, r.rev]);
      expect((await historico(c, M)).at(-1)).toBe("stand_by:manual");

      r = await mover(c, M, "etapa_a"); // aquém da derivada com card FIXADO → solta p/ a derivada
      expect([r.acao, r.status]).toEqual(["soltar", "etapa_c"]);
      const revAntes = (await lerModelo(c, M)).rev;
      r = await mover(c, M, "etapa_a"); // aquém com card AUTOMÁTICO → bloqueia, não grava
      expect([r.acao, r.status, r.rev]).toEqual(["bloquear_ja_cumprida", "etapa_c", revAntes]);
      r = await mover(c, M, "aprovado"); // além da derivada → faltando (labels vêm do catálogo no TS)
      expect([r.acao, r.status, r.faltando]).toEqual(["bloquear_faltando", "etapa_c", ["data_aprovacao"]]);
      r = await mover(c, M, "zzz");
      expect([r.acao, r.status]).toEqual(["fora_do_fluxo", "etapa_c"]);
      await comoSistema(c, () => c.query(`UPDATE public.modelos SET revisao_pendente = '{"kanban": true}' WHERE id = $1`, [M]));
      r = await mover(c, M, "etapa_c"); // mesma coluna → nada, mas o usuário revisou: apaga o #Erro
      expect(r.acao).toBe("nada");
      expect((await lerModelo(c, M)).erro).toBe(false);
    });
  });

  it("sair de Reprovado NÃO apaga motivo_cancelamento (decisão 15 do dono — o motivo fica guardado)", async () => {
    await withTx(async (c) => {
      await prepara(c, 4);
      await comoUsuario(c);
      await configurarBoard(c);
      await chave(c, true);
      const M = await comoSistema(c, () => novoModelo(c, { data_desenho_tecnico: HOJE }));
      await aplicar(c, [M]);
      expect((await mover(c, M, "reprovado")).acao).toBe("fixar");
      await comoSistema(c, () => c.query(`UPDATE public.modelos SET motivo_cancelamento = 'caro demais' WHERE id = $1`, [M]));
      expect((await mover(c, M, "stand_by")).acao).toBe("fixar"); // sai de Reprovado fixando outra manual
      expect((await lerModelo(c, M)).motivo).toBe("caro demais");
      expect((await mover(c, M, "reprovado")).acao).toBe("fixar");
      expect((await mover(c, M, "etapa_a")).acao).toBe("soltar"); // sai de Reprovado soltando p/ a derivada
      expect((await lerModelo(c, M)).motivo).toBe("caro demais");
    });
  });

  it("recusas: chave desligada (P0001), modelo de outra loja (P0002), sem permissão (42501)", async () => {
    await withTx(async (c) => {
      await prepara(c, 4);
      await comoUsuario(c);
      await configurarBoard(c);
      const M = await comoSistema(c, () => novoModelo(c));
      await c.query("SAVEPOINT sp");
      await expect(mover(c, M, "stand_by")).rejects.toMatchObject({ code: "P0001", message: "O Kanban automático está desligado nesta loja." });
      await c.query("ROLLBACK TO SAVEPOINT sp");
      await chave(c, true);
      const alheio = await um<{ id: string }>(c, `SELECT id FROM public.modelos WHERE tenant_id <> $1 LIMIT 1`, [T]);
      await c.query("SAVEPOINT sp");
      await expect(mover(c, alheio.id, "stand_by")).rejects.toMatchObject({ code: "P0002" });
      await c.query("ROLLBACK TO SAVEPOINT sp");
      await comoSemPermissao(c);
      await c.query("SAVEPOINT sp");
      await expect(mover(c, M, "stand_by")).rejects.toMatchObject({ code: "42501" });
      await c.query("ROLLBACK TO SAVEPOINT sp");
    });
  });
});

describe.skipIf(!PRONTO)("kanban-auto — migration 4A: kanban_previa_recalculo (Task 15)", () => {
  it("NÃO grava; conta pela coluna EFETIVA; lista os fixados; usa a config PROPOSTA", async () => {
    await withTx(async (c) => {
      await prepara(c, 4);
      await comoUsuario(c);
      await configurarBoard(c);
      const A = await comoSistema(c, () => novoModelo(c, { nome: "KA A", data_desenho_tecnico: HOJE }));
      const B = await comoSistema(c, () => novoModelo(c, { nome: "KA B", status_desenvolvimento: "stand_by", data_desenho_tecnico: HOJE }));
      const O = await comoSistema(c, () => novoModelo(c, { nome: "KA O", status_desenvolvimento: "coluna_velha" }));
      const retrato = async () => ({
        m: (await c.query(`SELECT id, status_desenvolvimento, revisao_pendente, rev, ref FROM public.modelos WHERE tenant_id = $1 ORDER BY id`, [T])).rows,
        s: (await um<{ n: string }>(c, `SELECT count(*) AS n FROM public.kanban_snapshot WHERE tenant_id = $1`, [T])).n,
        k: (await um<{ k: boolean }>(c, `SELECT kanban_automatico AS k FROM public.tenant_config WHERE tenant_id = $1`, [T])).k,
        h: (await um<{ n: string }>(c, `SELECT count(*) AS n FROM public.modelo_kanban_historico WHERE tenant_id = $1`, [T])).n,
      });
      const antes = await retrato();
      const p = (await um<{ p: any }>(c, `SELECT public.kanban_previa_recalculo($1::jsonb) AS p`, [JSON.stringify({ kanban_automatico: true })])).p;
      expect(await retrato()).toEqual(antes); // não grava NADA
      const card = (id: string) => p.cards.find((x: any) => x.modelo_id === id);
      expect(card(A)).toMatchObject({ de: "entrada", para: "etapa_a", fixado: false, recua: false });
      expect(card(B)).toBeUndefined(); // fixado: não muda de coluna…
      expect(p.cards_fixados.find((x: any) => x.modelo_id === B)).toMatchObject({ coluna: "stand_by", posicao_derivada: "etapa_a" });
      expect(card(O)).toBeUndefined(); // órfão sem dado: quadro já o mostra na 1ª coluna (efetiva) → não conta
      expect(p.mudam).toBe(p.cards.length);
      expect(p.fixados).toBe(p.cards_fixados.length);
      expect(p.chave_proposta).toBe(true);
      expect([p.revelam_ref, p.refs_reveladas, p.avisos]).toEqual([0, [], []]); // ninguém chega a etapa_c (ref_exibir_status)
      // config PROPOSTA sem requisito nenhum → tudo manual → A fica na entrada
      const p2 = (await um<{ p: any }>(c, `SELECT public.kanban_previa_recalculo($1::jsonb) AS p`, [JSON.stringify({ kanban_requisitos: {} })])).p;
      expect(p2.cards.find((x: any) => x.modelo_id === A)).toBeUndefined();
    });
  });

  it("R4 — lista as REFs que o LIGAR revela (= exatamente as que o LIGAR de verdade revela) + aviso", async () => {
    await withTx(async (c) => {
      await prepara(c, 4);
      await comoUsuario(c);
      await configurarBoard(c, { ref: "etapa_c" });
      const cheio = { data_desenho_tecnico: HOJE, data_piloto1: HOJE, data_piloto2: HOJE };
      const F = await comoSistema(c, () => novoModelo(c, { nome: "KA F", status_desenvolvimento: "stand_by", ...cheio })); // fixado; derivada = etapa_c
      const A = await comoSistema(c, () => novoModelo(c, { nome: "KA A", ...cheio })); // anda até etapa_c
      const B = await comoSistema(c, () => novoModelo(c, { nome: "KA B", data_desenho_tecnico: HOJE })); // anda só até etapa_a
      await comoSistema(c, () => c.query(`UPDATE public.modelos SET ref = '' WHERE id = ANY($1::uuid[])`, [[F, A, B]]));
      const semRef = async () => (await c.query(
        `SELECT id FROM public.modelos WHERE tenant_id = $1 AND coalesce(ref, '') = ''`, [T])).rows.map((r) => r.id as string);
      const antes = await semRef();
      const p = (await um<{ p: any }>(c, `SELECT public.kanban_previa_recalculo($1::jsonb) AS p`, [JSON.stringify({ kanban_automatico: true })])).p;
      const ids = p.refs_reveladas.map((x: any) => x.modelo_id as string).sort();
      expect(ids).toEqual(expect.arrayContaining([F, A]));
      expect(ids).not.toContain(B);
      expect(p.revelam_ref).toBe(p.refs_reveladas.length);
      expect(p.refs_reveladas.find((x: any) => x.modelo_id === F)).toMatchObject({ posicao_derivada: "etapa_c" });
      expect(p.refs_reveladas.every((x: any) => typeof x.ref_auto === "string" && x.ref_auto !== "")).toBe(true);
      expect(p.avisos).toEqual(["A REF revelada não volta ao desligar nem ao restaurar as colunas."]);
      // a prova: LIGAR de verdade (pela RPC) revela EXATAMENTE essas
      expect((await definir(c, true)).ligado).toBe(true);
      await imediato(c);
      const depois = await semRef();
      expect(antes.filter((id) => !depois.includes(id)).sort()).toEqual(ids);
    });
  });

  it("só admin da loja (ou super): usuário comum → 42501", async () => {
    await withTx(async (c) => {
      await prepara(c, 4);
      await comoSemPermissao(c);
      await c.query("SAVEPOINT sp");
      await expect(c.query(`SELECT public.kanban_previa_recalculo('{}'::jsonb)`)).rejects.toMatchObject({ code: "42501" });
      await c.query("ROLLBACK TO SAVEPOINT sp");
    });
  });
});

describe.skipIf(!PRONTO)("kanban-auto — migration 4A: kanban_definir_automatico, o botão da chave (decisão 16, Task 15)", () => {
  it("admin LIGA (lote 'ligar' + recálculo na mesma txn), repetir não grava, DESLIGA sem lote; GUC restaurado", async () => {
    await withTx(async (c) => {
      await prepara(c, 4);
      await comoUsuario(c);
      await configurarBoard(c);
      const M = await comoSistema(c, () => novoModelo(c, { data_desenho_tecnico: HOJE }));
      const r1 = await definir(c, true);
      expect(r1).toMatchObject({ ligado: true, mudou: true });
      expect(r1.lote_id).toBeTruthy();
      expect(r1.snapshot).toBe(Number((await um<{ n: string }>(c,
        `SELECT count(*) AS n FROM public.kanban_snapshot WHERE lote_id = $1`, [r1.lote_id])).n));
      expect(r1.cards_movidos).toBeGreaterThanOrEqual(1);
      expect((await lerModelo(c, M)).status).toBe("etapa_a");
      expect((await lotes(c)).map((l) => [l.lote_id, l.motivo])).toEqual([[r1.lote_id, "ligar"]]);
      expect(await definir(c, true)).toEqual({ ligado: true, mudou: false, lote_id: null, snapshot: 0, cards_movidos: 0 });
      expect(await definir(c, false)).toEqual({ ligado: false, mudou: true, lote_id: null, snapshot: 0, cards_movidos: 0 });
      expect((await lotes(c)).length).toBe(1);
      expect((await lerModelo(c, M)).status).toBe("etapa_a"); // desligar não mexe em status
      expect((await um<{ g: string }>(c, `SELECT current_setting('app.kanban_chave', true) AS g`)).g).toBe("");
    });
  });

  it("recusas: valor nulo → P0001; usuário comum → 42501 (e a chave não muda)", async () => {
    await withTx(async (c) => {
      await prepara(c, 4);
      await comoUsuario(c);
      await c.query("SAVEPOINT sp");
      await expect(c.query(`SELECT public.kanban_definir_automatico(NULL)`)).rejects.toMatchObject({ code: "P0001" });
      await c.query("ROLLBACK TO SAVEPOINT sp");
      await comoSemPermissao(c);
      await c.query("SAVEPOINT sp");
      await expect(definir(c, true)).rejects.toMatchObject({ code: "42501" });
      await c.query("ROLLBACK TO SAVEPOINT sp");
      expect((await lerChave(c)).k).toBe(false);
    });
  });

  // Escreve numa loja REAL (UPDATE de ~100 cards da Ave Rara, ainda que revertido) → SÓ na cópia local (decisão 17)
  it.skipIf(!LOCAL)("R7 — LIGAR a maior loja (Ave Rara) pela RPC: snapshot + recálculo + gatilhos em < 5 s", async () => {
    await withTx(async (c) => {
      await prepara(c, 4);
      await comoUsuario(c);
      await c.query(`UPDATE public.users SET tenant_id = $1 WHERE id = $2`, [AVE_RARA, USER_TESTE]); // super_admin "entra" na Ave Rara (txn)
      const t0 = Date.now();
      const r = await definir(c, true);
      await imediato(c); // a fila fica vazia: as escritas do motor não re-enfileiram
      const ms = Date.now() - t0;
      console.info(`[kanban-auto] R7 LIGAR Ave Rara: snapshot ${r.snapshot}, ${r.cards_movidos} card(s) mudaram de coluna, ${ms} ms`);
      expect(r).toMatchObject({ ligado: true, mudou: true });
      expect(r.snapshot).toBeGreaterThan(200);
      expect(await tamanhoFila(c)).toBe(0);
      expect(ms).toBeLessThan(5000);
    });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd "/Users/sunglee/PLM + Criação/plm-pcp" && DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres KANBAN_AUTO_MIG_TXN=1 npx vitest run --no-file-parallelism tests/integration/kanban-auto.test.ts`
Expected: FAIL — `ENOENT … 20260930150000_kanban_auto_4_rpcs.sql`.

- [ ] **Step 3: Criar `supabase/migrations/20260930150000_kanban_auto_4_rpcs.sql` (cabeçalho + parte A + fechamento)**

```sql
-- Kanban automático — F1 · migration 4/4: RPCs PÚBLICAS
-- ============================================================================
-- Plano: docs/superpowers/plans/2026-09-22-kanban-automatico-f1-banco.md (Tasks 15–16, §3).
-- Inverso pareado: supabase/rollback/20260930150000_kanban_auto_4_rpcs_down.sql.
--
--   kanban_mover(_modelo_id, _para)          → arraste/"Mover para…" (chave LIGADA; F2/F3)
--   kanban_previa_recalculo(_cfg)            → admin; "N cards vão mudar" (+ REFs reveladas) com a config PROPOSTA; NÃO grava
--   kanban_definir_automatico(_ligar)        → admin; o BOTÃO da chave — única porta de kanban_automatico (decisão 16)
--   kanban_previa_restauracao(_lote_id)      → admin; quem volta + movimentos manuais depois; NÃO grava
--   kanban_restaurar(_lote_id)               → admin; exige a chave DESLIGADA
-- Todas: SECURITY DEFINER + search_path; tenant = get_user_tenant_id(); módulo `criacao`;
-- permissão negada = 42501; regra de negócio = P0001; não encontrado = P0002 (mensagens PT-BR).
-- ACL: REVOKE de PUBLIC/anon + GRANT authenticated (invariante #9).

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- A) kanban_mover — aplica a tabela ÚNICA de arraste (`_kanban_destino_drop_puro`) no servidor.
--    fixar/soltar gravam o status (GUC 'manual' → histórico origem 'manual', o guard deixa passar);
--    fixar/soltar/nada apagam o #Erro de kanban (o usuário revisou — paridade com o drop de hoje,
--    que chama marcar_etapa_verificada; pode ser #Erro legado de quando a chave estava desligada).
--    Sair de 'reprovado' NÃO mexe em motivo_cancelamento (decisão 15 do dono, 23/set: o motivo
--    fica guardado e só aparece quando o card está em Reprovado). Bloqueios não gravam nada.
--    Retorno: {acao, status, faltando[], rev}.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.kanban_mover(_modelo_id uuid, _para text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant   uuid;
  v_sis_ant  text := coalesce(current_setting('app.kanban_sistema', true), '');
  v_lote_ant text := coalesce(current_setting('app.kanban_lote', true), '');
  v_status   text;
  v_d        record;
  v_drop     jsonb;
  v_acao     text;
  v_novo     text;
  v_rev      integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_module_enabled('criacao') THEN
    RAISE EXCEPTION 'Módulo Criação não habilitado para esta loja.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.user_can_edit('criacao_desenvolvimento') THEN
    RAISE EXCEPTION 'Sem permissão para mover cards do Desenvolvimento.' USING ERRCODE = '42501';
  END IF;
  v_tenant := public.get_user_tenant_id();
  IF v_tenant IS NULL OR v_tenant = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'Loja inativa ou sem tenant — operação não permitida.' USING ERRCODE = '42501';
  END IF;

  SELECT m.status_desenvolvimento INTO v_status
    FROM public.modelos m
   WHERE m.id = _modelo_id AND m.tenant_id = v_tenant
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Modelo não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public._kanban_ligado(v_tenant) THEN
    RAISE EXCEPTION 'O Kanban automático está desligado nesta loja.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_d FROM public._kanban_derivar_lote(v_tenant, ARRAY[_modelo_id]) LIMIT 1;
  v_drop := public._kanban_destino_drop_puro(v_d.fluxo, v_d.reqs, v_d.exc, v_d.cond, v_d.status_atual, v_d.elegivel, _para);
  v_acao := v_drop ->> 'acao';
  v_novo := v_drop ->> 'status';

  IF v_acao IN ('fixar', 'soltar', 'nada') THEN
    PERFORM set_config('app.kanban_sistema', 'manual', true);
    PERFORM set_config('app.kanban_lote', '', true);
    UPDATE public.modelos m
       SET status_desenvolvimento = CASE WHEN v_acao IN ('fixar', 'soltar') THEN v_novo ELSE m.status_desenvolvimento END,
           revisao_pendente = coalesce(m.revisao_pendente, '{}'::jsonb) - 'kanban'
     WHERE m.id = _modelo_id
       AND (   (v_acao IN ('fixar', 'soltar') AND m.status_desenvolvimento IS DISTINCT FROM v_novo)
            OR coalesce(m.revisao_pendente, '{}'::jsonb) ? 'kanban');
    PERFORM set_config('app.kanban_sistema', v_sis_ant, true);
    PERFORM set_config('app.kanban_lote', v_lote_ant, true);
  END IF;

  SELECT m.status_desenvolvimento, m.rev INTO v_status, v_rev FROM public.modelos m WHERE m.id = _modelo_id;
  RETURN jsonb_build_object(
    'acao', v_acao,
    'status', v_status,
    'faltando', coalesce(v_drop -> 'faltando', '[]'::jsonb),
    'rev', v_rev);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.kanban_mover(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.kanban_mover(uuid, text) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- B) kanban_previa_recalculo — admin; NÃO grava. `_cfg` = config PROPOSTA (parcial ok: só as chaves
--    status_kanban, kanban_requisitos, kanban_requisitos_excecoes, revenda_kanban_colunas,
--    revenda_kanban_requisitos, kanban_automatico são lidas; o resto vem da config gravada).
--    Calcula COMO SE a chave estivesse ligada. População = cards do quadro do Desenvolvimento
--    (ordem_criacao_enviada, não lançados). Conta pela COLUNA EFETIVA (a que o quadro mostra:
--    status se está no board, senão a 1ª coluna) antes × depois; lista os FIXADOS (não andam sozinhos).
--    R4: lista as REFs que o LIGAR revela — derivável, `ref` vazia, `ref_auto` pronta, MUDA de coluna
--    (fn_modelo_ref_auto) ou está FIXADO (_kanban_aplicar), com a posição derivada na etapa de revelar
--    ou depois: régua de _ref_exibir_gate (etapa configurada; ausente ⇒ 'aprovado'; órfã ⇒ fallback
--    'aprovado'; fora do board ⇒ só igualdade) sobre o board PROPOSTO. REF revelada não volta → aviso.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.kanban_previa_recalculo(_cfg jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant    uuid;
  v_atual     jsonb;
  v_prop      jsonb;
  v_board_at  text[];
  v_board_nv  text[];
  v_rb        text[];  -- board PROPOSTO sem dedup (≡ _kanban_status_rows: régua do _ref_exibir_gate)
  v_ref_cfg   text;
  v_ref_pos   integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_module_enabled('criacao') THEN
    RAISE EXCEPTION 'Módulo Criação não habilitado para esta loja.' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.is_tenant_admin() OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'Apenas o administrador da loja pode ver a prévia do Kanban automático.' USING ERRCODE = '42501';
  END IF;
  v_tenant := public.get_user_tenant_id();
  IF v_tenant IS NULL OR v_tenant = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'Loja inativa ou sem tenant — operação não permitida.' USING ERRCODE = '42501';
  END IF;

  v_atual := coalesce(public._kanban_cfg(v_tenant), '{}'::jsonb);
  v_prop  := v_atual || coalesce((
    SELECT jsonb_object_agg(e.k, e.v)
      FROM jsonb_each(CASE WHEN jsonb_typeof(_cfg) = 'object' THEN _cfg ELSE '{}'::jsonb END) AS e(k, v)
     WHERE e.k IN ('kanban_automatico', 'status_kanban', 'kanban_requisitos', 'kanban_requisitos_excecoes',
                   'revenda_kanban_colunas', 'revenda_kanban_requisitos')), '{}'::jsonb);
  v_board_at := public._kanban_fluxo(v_atual, false);
  v_board_nv := public._kanban_fluxo(v_prop, false);
  -- Régua da REF (≡ _ref_exibir_gate, mas sobre o board PROPOSTO; ref_exibir_status vem da config gravada)
  v_rb := ARRAY(SELECT r.key FROM public._kanban_status_rows_raw(v_prop -> 'status_kanban') r ORDER BY r.ord);
  v_ref_cfg := v_atual ->> 'ref_exibir_status';
  IF v_ref_cfg IS NULL OR btrim(v_ref_cfg) = '' THEN v_ref_cfg := 'aprovado'; END IF;
  v_ref_pos := array_position(v_rb, v_ref_cfg);
  IF v_ref_pos IS NULL AND v_ref_cfg <> 'aprovado' THEN
    v_ref_cfg := 'aprovado';
    v_ref_pos := array_position(v_rb, 'aprovado');
  END IF;

  RETURN (
    WITH d AS (
      SELECT x.*, m.nome, coalesce(nullif(m.ref, ''), m.ref_auto) AS ref_exib,
             coalesce(m.ref, '') AS ref_atual, m.ref_auto
        FROM public._kanban_derivar_lote(v_tenant, NULL, v_prop) x
        JOIN public.modelos m ON m.id = x.modelo_id
       WHERE x.elegivel
    ), c AS (
      SELECT d.*,
             CASE WHEN d.status_atual = ANY (v_board_at) THEN d.status_atual ELSE v_board_at[1] END AS de,
             CASE WHEN d.derivavel THEN d.resultado
                  WHEN d.status_atual = ANY (v_board_nv) THEN d.status_atual
                  ELSE v_board_nv[1] END AS para,
             (d.derivavel AND d.ref_atual = '' AND coalesce(d.ref_auto, '') <> ''
              AND (d.fixado OR d.resultado IS DISTINCT FROM d.status_atual)
              AND CASE WHEN v_ref_pos IS NULL OR array_position(v_rb, public._kanban_norm(d.alvo)) IS NULL
                         THEN public._kanban_norm(d.alvo) = v_ref_cfg
                       ELSE array_position(v_rb, public._kanban_norm(d.alvo)) >= v_ref_pos
                  END) AS revela_ref
        FROM d
    )
    SELECT jsonb_build_object(
      'chave_proposta', coalesce((v_prop ->> 'kanban_automatico')::boolean, false),
      'total',   (SELECT count(*) FROM c),
      'mudam',   (SELECT count(*) FROM c WHERE c.de IS DISTINCT FROM c.para),
      'fixados', (SELECT count(*) FROM c WHERE c.fixado),
      'cards', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
                 'modelo_id', c.modelo_id, 'nome', c.nome, 'ref', c.ref_exib, 'origem', c.origem,
                 'de', c.de, 'para', c.para, 'fixado', c.fixado,
                 'recua', coalesce(array_position(v_board_nv, c.para) < array_position(v_board_nv, c.de), false),
                 'primeira_falha', c.primeira_falha, 'faltando', to_jsonb(c.faltando))
               ORDER BY c.nome, c.modelo_id)
          FROM c WHERE c.de IS DISTINCT FROM c.para), '[]'::jsonb),
      'cards_fixados', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
                 'modelo_id', c.modelo_id, 'nome', c.nome, 'ref', c.ref_exib, 'origem', c.origem,
                 'coluna', c.resultado, 'posicao_derivada', c.alvo)
               ORDER BY c.nome, c.modelo_id)
          FROM c WHERE c.fixado), '[]'::jsonb),
      'revelam_ref', (SELECT count(*) FROM c WHERE c.revela_ref),
      'refs_reveladas', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
                 'modelo_id', c.modelo_id, 'nome', c.nome, 'ref_auto', c.ref_auto, 'posicao_derivada', c.alvo)
               ORDER BY c.nome, c.modelo_id)
          FROM c WHERE c.revela_ref), '[]'::jsonb),
      'avisos', CASE WHEN EXISTS (SELECT 1 FROM c WHERE c.revela_ref)
                     THEN jsonb_build_array('A REF revelada não volta ao desligar nem ao restaurar as colunas.')
                     ELSE '[]'::jsonb END)
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.kanban_previa_recalculo(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.kanban_previa_recalculo(jsonb) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- B′) kanban_definir_automatico — o BOTÃO da chave (decisão 16 do dono, 23/set; D19). É a ÚNICA
--     porta de tenant_config.kanban_automatico: seta app.kanban_chave='rpc' só em volta do UPDATE
--     (a trava trg_kanban_chave_protegida ignora qualquer outra escrita) e restaura o valor anterior.
--     Ao LIGAR, o gatilho AFTER trg_kanban_config grava o lote 'ligar' e recalcula a loja na MESMA
--     txn (erro lá PROPAGA — D6). Desligar não grava lote. Mesmo valor → mudou=false, nada grava.
--     Retorno: {ligado, mudou, lote_id, snapshot (linhas do lote), cards_movidos (mudaram de coluna)}.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.kanban_definir_automatico(_ligar boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant    uuid;
  v_chave_ant text := coalesce(current_setting('app.kanban_chave', true), '');
  v_antes     boolean;
  v_depois    boolean;
  v_inicio    timestamptz := clock_timestamp();
  v_lote      uuid;
  v_snap      integer := 0;
  v_mov       integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_module_enabled('criacao') THEN
    RAISE EXCEPTION 'Módulo Criação não habilitado para esta loja.' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.is_tenant_admin() OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'Apenas o administrador da loja pode ligar ou desligar o Kanban automático.' USING ERRCODE = '42501';
  END IF;
  v_tenant := public.get_user_tenant_id();
  IF v_tenant IS NULL OR v_tenant = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'Loja inativa ou sem tenant — operação não permitida.' USING ERRCODE = '42501';
  END IF;
  IF _ligar IS NULL THEN
    RAISE EXCEPTION 'Informe se o Kanban automático deve ser ligado ou desligado.' USING ERRCODE = 'P0001';
  END IF;

  SELECT tc.kanban_automatico INTO v_antes
    FROM public.tenant_config tc
   WHERE tc.tenant_id = v_tenant
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Configuração da loja não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  IF v_antes IS DISTINCT FROM _ligar THEN
    PERFORM set_config('app.kanban_chave', 'rpc', true);
    UPDATE public.tenant_config SET kanban_automatico = _ligar WHERE tenant_id = v_tenant;
    PERFORM set_config('app.kanban_chave', v_chave_ant, true);
  END IF;

  SELECT tc.kanban_automatico INTO v_depois FROM public.tenant_config tc WHERE tc.tenant_id = v_tenant;

  IF _ligar AND v_antes IS DISTINCT FROM _ligar THEN
    SELECT s.lote_id, count(*)::integer INTO v_lote, v_snap
      FROM public.kanban_snapshot s
     WHERE s.tenant_id = v_tenant AND s.motivo = 'ligar' AND s.criado_at >= v_inicio
     GROUP BY s.lote_id
     ORDER BY max(s.criado_at) DESC
     LIMIT 1;
    IF v_lote IS NOT NULL THEN
      SELECT count(DISTINCT h.modelo_id)::integer INTO v_mov
        FROM public.modelo_kanban_historico h
       WHERE h.tenant_id = v_tenant AND h.lote_id = v_lote AND h.origem = 'config';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ligado', v_depois,
    'mudou', v_antes IS DISTINCT FROM v_depois,
    'lote_id', v_lote,
    'snapshot', coalesce(v_snap, 0),
    'cards_movidos', coalesce(v_mov, 0));
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.kanban_definir_automatico(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.kanban_definir_automatico(boolean) TO authenticated;
COMMIT;

select pg_notify('pgrst', 'reload schema');
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd "/Users/sunglee/PLM + Criação/plm-pcp" && DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres KANBAN_AUTO_MIG_TXN=1 npx vitest run --no-file-parallelism tests/integration/kanban-auto.test.ts`
Expected: PASS (62 testes). O teste R7 imprime `[kanban-auto] R7 LIGAR Ave Rara: snapshot N, M card(s) mudaram de coluna, X ms` (critério < 5 s; revisão de 23/set na cópia local: 218–229 ms em 5 rodadas — snapshot 246, 102 cards mudam).

- [ ] **Step 5: Gates + commit**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp"
npm run build 2>&1 | tail -3
npx tsc --noEmit 2>&1 | grep -E "TS2304|error" ; true
npx vitest run --no-file-parallelism tests/unit/kanban-auto.test.ts tests/unit/kanban-status.test.ts
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres KANBAN_AUTO_MIG_TXN=1 npx vitest run --no-file-parallelism tests/integration/kanban-auto.test.ts tests/integration/kanban-condicoes.test.ts
```
```bash
git add -- supabase/migrations/20260930150000_kanban_auto_4_rpcs.sql
git commit --only -m "feat(kanban-auto): migration 4A — RPCs kanban_mover, kanban_previa_recalculo (+ REFs reveladas) e kanban_definir_automatico (botão da chave)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- supabase/migrations/20260930150000_kanban_auto_4_rpcs.sql tests/integration/kanban-auto.test.ts
git show --stat HEAD | tail -n +7   # confere: SÓ os paths acima
```

---

### Task 16: Migration 4 (parte B) — prévia de restauração, `kanban_restaurar`, ACL de tudo + inverso 4

**Files:**
- Modify: `supabase/migrations/20260930150000_kanban_auto_4_rpcs.sql` (inserir antes do `COMMIT;`)
- Create: `supabase/rollback/20260930150000_kanban_auto_4_rpcs_down.sql`
- Modify: `tests/integration/kanban-auto.test.ts`

**Interfaces:**
- Consumes: `kanban_snapshot`, `modelo_kanban_historico.origem/created_at` (Tasks 5, 10; D14 no histórico); `_kanban_ligado`; `mover` (teste, Task 15); `FUNCOES_M2` (Task 9).
- Produces (RPC pública, mesmo padrão da Task 15; ambas só admin):
  - `kanban_previa_restauracao(_lote_id uuid DEFAULT NULL) → jsonb {lote_id, motivo, criado_at, restaurado_at, chave_ligada, total, voltam, movidos_depois, cards: [{modelo_id, nome, ref, de, para, movido_manual_depois}], avisos: text[]}` — `NULL` = último lote `'ligar'` não restaurado (D2); sem lote → `{lote_id: null, …, avisos: ['Não há colunas guardadas para restaurar.']}`; STABLE, NÃO grava.
  - `kanban_restaurar(_lote_id uuid) → jsonb {lote_id, restaurados, historico_apagado}` — chave ligada → `P0001 'Desligue o Kanban automático antes de restaurar as colunas.'`; lote de outra loja/inexistente → `P0002`; já restaurado → `P0001 'Este lote já foi restaurado.'`; GUC `'restauracao'` + `app.kanban_lote`.
  - Teste: `RPCS_F1`, `INTERNAS_F1`.

- [ ] **Step 1: Acrescentar os testes**

```ts
// ─────────── Migration 4B — prévia de restauração, restaurar e ACL (Task 16) ───────────
describe.skipIf(!PRONTO)("kanban-auto — migration 4B: restauração (Task 16)", () => {
  async function cenarioLigado(c: Client) {
    await prepara(c, 4);
    await comoUsuario(c);
    await configurarBoard(c);
    const M = await comoSistema(c, () => novoModelo(c, { data_desenho_tecnico: HOJE }));
    const N = await comoSistema(c, () => novoModelo(c, { data_desenho_tecnico: HOJE, data_piloto1: HOJE }));
    await chave(c, true); // lote 'ligar': M entrada→etapa_a, N entrada→etapa_b
    const lote = (await um<{ l: string }>(c,
      `SELECT lote_id AS l FROM public.kanban_snapshot WHERE tenant_id = $1 AND motivo = 'ligar' LIMIT 1`, [T])).l;
    expect((await mover(c, N, "stand_by")).acao).toBe("fixar"); // movimento MANUAL depois do lote
    return { M, N, lote };
  }

  it("prévia (lote NULL = o 'ligar' mais recente): quem volta, quem foi movido à mão depois, avisos — e NÃO grava", async () => {
    await withTx(async (c) => {
      const { M, N, lote } = await cenarioLigado(c);
      await chave(c, false);
      const antes = (await c.query(`SELECT id, status_desenvolvimento FROM public.modelos WHERE tenant_id = $1 ORDER BY id`, [T])).rows;
      const p = (await um<{ p: any }>(c, `SELECT public.kanban_previa_restauracao(NULL) AS p`)).p;
      expect(p.lote_id).toBe(lote);
      expect(p.motivo).toBe("ligar");
      expect(p.chave_ligada).toBe(false);
      expect(p.cards.find((x: any) => x.modelo_id === M)).toMatchObject({ de: "etapa_a", para: "entrada", movido_manual_depois: false });
      expect(p.cards.find((x: any) => x.modelo_id === N)).toMatchObject({ de: "stand_by", para: "entrada", movido_manual_depois: true });
      expect(p.movidos_depois).toBeGreaterThanOrEqual(1);
      expect(p.avisos).toContain("A REF revelada e o #Erro não voltam.");
      expect((await c.query(`SELECT id, status_desenvolvimento FROM public.modelos WHERE tenant_id = $1 ORDER BY id`, [T])).rows).toEqual(antes);
      expect((await um<{ n: string }>(c, `SELECT count(*) AS n FROM public.kanban_snapshot WHERE lote_id = $1 AND restaurado_at IS NOT NULL`, [lote])).n).toBe("0");
    });
  });

  it("restaurar: exige chave DESLIGADA; volta o status, apaga linhas auto/config do lote, marca restaurado_at; não restaura 2×", async () => {
    await withTx(async (c) => {
      const { M, N, lote } = await cenarioLigado(c);
      await c.query("SAVEPOINT sp");
      await expect(c.query(`SELECT public.kanban_restaurar($1)`, [lote])).rejects.toMatchObject({
        code: "P0001", message: "Desligue o Kanban automático antes de restaurar as colunas.",
      });
      await c.query("ROLLBACK TO SAVEPOINT sp");
      await chave(c, false);
      const r = (await um<{ r: any }>(c, `SELECT public.kanban_restaurar($1) AS r`, [lote])).r;
      expect(r.restaurados).toBeGreaterThanOrEqual(2);
      expect((await lerModelo(c, M)).status).toBe("entrada");
      expect((await lerModelo(c, N)).status).toBe("entrada");
      // a linha 'config' do lote sumiu; D14: a última restante já é 'entrada' → a restauração não duplica
      expect(await historico(c, M)).toEqual(["entrada:manual"]);
      expect(await historico(c, N)).toEqual(["entrada:manual", "stand_by:manual", "entrada:restauracao"]);
      expect((await um<{ n: string }>(c, `SELECT count(*) AS n FROM public.kanban_snapshot WHERE lote_id = $1 AND restaurado_at IS NULL`, [lote])).n).toBe("0");
      await c.query("SAVEPOINT sp");
      await expect(c.query(`SELECT public.kanban_restaurar($1)`, [lote])).rejects.toMatchObject({ code: "P0001", message: "Este lote já foi restaurado." });
      await c.query("ROLLBACK TO SAVEPOINT sp");
      await c.query("SAVEPOINT sp");
      await expect(c.query(`SELECT public.kanban_restaurar(gen_random_uuid())`)).rejects.toMatchObject({ code: "P0002" });
      await c.query("ROLLBACK TO SAVEPOINT sp");
    });
  });

  it("só admin: usuário comum → 42501 nas duas RPCs", async () => {
    await withTx(async (c) => {
      await prepara(c, 4);
      await comoSemPermissao(c);
      for (const sql of [`SELECT public.kanban_previa_restauracao(NULL)`, `SELECT public.kanban_restaurar(gen_random_uuid())`]) {
        await c.query("SAVEPOINT sp");
        await expect(c.query(sql), sql).rejects.toMatchObject({ code: "42501" });
        await c.query("ROLLBACK TO SAVEPOINT sp");
      }
    });
  });
});

// ─────────────────────────── ACL de TUDO que a F1 cria (Task 16) ───────────────────────────
const RPCS_F1 = [
  "kanban_mover(uuid,text)", "kanban_previa_recalculo(jsonb)", "kanban_definir_automatico(boolean)",
  "kanban_previa_restauracao(uuid)", "kanban_restaurar(uuid)",
];
const INTERNAS_F1 = [...FUNCOES_M2, "_kanban_enfileirar(uuid[])", "_kanban_enfileirar_tenant(uuid)", "_kanban_aplicar(uuid,uuid[],text,uuid)"];

describe.skipIf(!PRONTO)("kanban-auto — ACL (invariante #9) de todas as funções/tabelas novas (Task 16)", () => {
  it("internas: sem EXECUTE p/ anon/authenticated/PUBLIC · RPCs: só authenticated · tabelas: sem GRANT", async () => {
    await withTx(async (c) => {
      await prepara(c, 4);
      for (const f of INTERNAS_F1) {
        const r = await um<{ anon: boolean; auth: boolean; publico: boolean; definer_ou_imutavel: boolean }>(c,
          `SELECT has_function_privilege('anon', $1, 'EXECUTE') AS anon,
                  has_function_privilege('authenticated', $1, 'EXECUTE') AS auth,
                  EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0) AS publico,
                  (p.prosecdef OR p.provolatile = 'i') AS definer_ou_imutavel
             FROM pg_proc p WHERE p.oid = to_regprocedure($1)`, ["public." + f]);
        expect(r, f).toEqual({ anon: false, auth: false, publico: false, definer_ou_imutavel: true });
      }
      for (const f of RPCS_F1) {
        const r = await um<{ anon: boolean; auth: boolean; definer: boolean; sp: boolean }>(c,
          `SELECT has_function_privilege('anon', $1, 'EXECUTE') AS anon,
                  has_function_privilege('authenticated', $1, 'EXECUTE') AS auth,
                  p.prosecdef AS definer,
                  coalesce(array_to_string(p.proconfig, ',') LIKE '%search_path=public%', false) AS sp
             FROM pg_proc p WHERE p.oid = to_regprocedure($1)`, ["public." + f]);
        expect(r, f).toEqual({ anon: false, auth: true, definer: true, sp: true });
      }
      for (const t of ["kanban_recalculo_fila", "kanban_snapshot"]) {
        for (const papel of ["anon", "authenticated"]) {
          const r = await um<{ ok: boolean }>(c,
            `SELECT has_table_privilege($1, $2, 'SELECT') OR has_table_privilege($1, $2, 'INSERT')
                 OR has_table_privilege($1, $2, 'UPDATE') OR has_table_privilege($1, $2, 'DELETE') AS ok`, [papel, "public." + t]);
          expect(r.ok, `${papel} ${t}`).toBe(false);
        }
      }
    });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd "/Users/sunglee/PLM + Criação/plm-pcp" && DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres KANBAN_AUTO_MIG_TXN=1 npx vitest run --no-file-parallelism tests/integration/kanban-auto.test.ts`
Expected: FAIL — `function public.kanban_previa_restauracao(…) does not exist` e o ACL (`kanban_restaurar(uuid)` inexistente).

- [ ] **Step 3: Implementar** — inserir o bloco abaixo IMEDIATAMENTE ANTES da linha `COMMIT;` de `supabase/migrations/20260930150000_kanban_auto_4_rpcs.sql` (o arquivo termina sempre em `COMMIT;` + linha em branco + `select pg_notify('pgrst', 'reload schema');`). Conferir depois com `grep -c '^COMMIT;$' supabase/migrations/20260930150000_kanban_auto_4_rpcs.sql` = `1` e `grep -n '^BEGIN;$' supabase/migrations/20260930150000_kanban_auto_4_rpcs.sql` = só a linha do topo.
```sql
-- ────────────────────────────────────────────────────────────────────────────
-- C) kanban_previa_restauracao — admin; NÃO grava. `_lote_id` NULL = o lote 'ligar' mais recente
--    ainda não restaurado da loja. Lista quem VOLTA (status atual ≠ status_anterior) e marca quem
--    teve movimento MANUAL depois do lote (a restauração desfaz esse movimento). Avisa que REF
--    revelada e #Erro NÃO voltam. "Depois" = modelo_kanban_historico.created_at (relógio, gravado
--    por fn_kanban_historico) > kanban_snapshot.criado_at (relógio, gravado por fn_kanban_config).
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.kanban_previa_restauracao(_lote_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant  uuid;
  v_lote    uuid;
  v_motivo  text;
  v_criado  timestamptz;
  v_restaur timestamptz;
  v_ligada  boolean;
  v_out     jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_module_enabled('criacao') THEN
    RAISE EXCEPTION 'Módulo Criação não habilitado para esta loja.' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.is_tenant_admin() OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'Apenas o administrador da loja pode restaurar as colunas do Kanban.' USING ERRCODE = '42501';
  END IF;
  v_tenant := public.get_user_tenant_id();
  IF v_tenant IS NULL OR v_tenant = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'Loja inativa ou sem tenant — operação não permitida.' USING ERRCODE = '42501';
  END IF;

  v_lote := coalesce(_lote_id, (
    SELECT s.lote_id FROM public.kanban_snapshot s
     WHERE s.tenant_id = v_tenant AND s.motivo = 'ligar' AND s.restaurado_at IS NULL
     ORDER BY s.criado_at DESC LIMIT 1));
  v_ligada := public._kanban_ligado(v_tenant);
  IF v_lote IS NULL THEN
    RETURN jsonb_build_object('lote_id', NULL, 'chave_ligada', v_ligada, 'total', 0, 'voltam', 0,
      'movidos_depois', 0, 'cards', '[]'::jsonb,
      'avisos', jsonb_build_array('Não há colunas guardadas para restaurar.'));
  END IF;

  SELECT min(s.motivo), min(s.criado_at), max(s.restaurado_at) INTO v_motivo, v_criado, v_restaur
    FROM public.kanban_snapshot s
   WHERE s.lote_id = v_lote AND s.tenant_id = v_tenant;
  IF v_criado IS NULL THEN
    RAISE EXCEPTION 'Lote de colunas não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  WITH s AS (
    SELECT s.modelo_id, s.status_anterior, m.nome, coalesce(nullif(m.ref, ''), m.ref_auto) AS ref_exib,
           m.status_desenvolvimento AS status_atual,
           EXISTS (SELECT 1 FROM public.modelo_kanban_historico h
                    WHERE h.modelo_id = s.modelo_id AND h.origem = 'manual' AND h.created_at > v_criado) AS manual_depois
      FROM public.kanban_snapshot s
      JOIN public.modelos m ON m.id = s.modelo_id AND m.tenant_id = v_tenant
     WHERE s.lote_id = v_lote
  )
  SELECT jsonb_build_object(
    'lote_id', v_lote, 'motivo', v_motivo, 'criado_at', v_criado, 'restaurado_at', v_restaur,
    'chave_ligada', v_ligada,
    'total', (SELECT count(*) FROM s),
    'voltam', (SELECT count(*) FROM s WHERE s.status_atual IS DISTINCT FROM s.status_anterior),
    'movidos_depois', (SELECT count(*) FROM s WHERE s.manual_depois AND s.status_atual IS DISTINCT FROM s.status_anterior),
    'cards', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'modelo_id', s.modelo_id, 'nome', s.nome, 'ref', s.ref_exib,
               'de', s.status_atual, 'para', s.status_anterior, 'movido_manual_depois', s.manual_depois)
             ORDER BY s.nome, s.modelo_id)
        FROM s WHERE s.status_atual IS DISTINCT FROM s.status_anterior), '[]'::jsonb),
    'avisos', to_jsonb(array_remove(ARRAY[
      'A REF revelada e o #Erro não voltam.',
      CASE WHEN v_ligada THEN 'Desligue o Kanban automático antes de restaurar (senão o próximo salvamento refaz as colunas).' END,
      CASE WHEN v_restaur IS NOT NULL THEN 'Este lote já foi restaurado.' END
    ], NULL)))
  INTO v_out;
  RETURN v_out;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.kanban_previa_restauracao(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.kanban_previa_restauracao(uuid) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- D) kanban_restaurar — admin; exige a chave DESLIGADA (senão o próximo evento desfaria a
--    restauração). Volta status_anterior onde difere (histórico origem 'restauracao'), apaga as
--    linhas auto/config do histórico dos modelos do lote desde criado_at (created_at do histórico,
--    relógio), marca restaurado_at. A linha 'restauracao' do histórico só entra quando a última
--    linha restante é de OUTRA coluna (D14 — fn_kanban_historico).
--    REF revelada e #Erro NÃO voltam (avisado na prévia).
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.kanban_restaurar(_lote_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant   uuid;
  v_sis_ant  text := coalesce(current_setting('app.kanban_sistema', true), '');
  v_lote_ant text := coalesce(current_setting('app.kanban_lote', true), '');
  v_criado   timestamptz;
  v_restaur  timestamptz;
  v_hist     integer := 0;
  v_n        integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_module_enabled('criacao') THEN
    RAISE EXCEPTION 'Módulo Criação não habilitado para esta loja.' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.is_tenant_admin() OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'Apenas o administrador da loja pode restaurar as colunas do Kanban.' USING ERRCODE = '42501';
  END IF;
  v_tenant := public.get_user_tenant_id();
  IF v_tenant IS NULL OR v_tenant = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'Loja inativa ou sem tenant — operação não permitida.' USING ERRCODE = '42501';
  END IF;
  IF public._kanban_ligado(v_tenant) THEN
    RAISE EXCEPTION 'Desligue o Kanban automático antes de restaurar as colunas.' USING ERRCODE = 'P0001';
  END IF;

  SELECT min(s.criado_at), max(s.restaurado_at) INTO v_criado, v_restaur
    FROM public.kanban_snapshot s
   WHERE s.lote_id = _lote_id AND s.tenant_id = v_tenant;
  IF v_criado IS NULL THEN
    RAISE EXCEPTION 'Lote de colunas não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF v_restaur IS NOT NULL THEN
    RAISE EXCEPTION 'Este lote já foi restaurado.' USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('app.kanban_sistema', 'restauracao', true);
  PERFORM set_config('app.kanban_lote', _lote_id::text, true);

  DELETE FROM public.modelo_kanban_historico h
   USING public.kanban_snapshot s
   WHERE s.lote_id = _lote_id
     AND h.modelo_id = s.modelo_id
     AND h.tenant_id = v_tenant
     AND h.origem IN ('auto', 'config')
     AND h.created_at >= v_criado;
  GET DIAGNOSTICS v_hist = ROW_COUNT;

  UPDATE public.modelos m
     SET status_desenvolvimento = s.status_anterior
    FROM public.kanban_snapshot s
   WHERE s.lote_id = _lote_id
     AND m.id = s.modelo_id
     AND m.tenant_id = v_tenant
     AND m.status_desenvolvimento IS DISTINCT FROM s.status_anterior;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  UPDATE public.kanban_snapshot SET restaurado_at = now()
   WHERE lote_id = _lote_id AND tenant_id = v_tenant;

  PERFORM set_config('app.kanban_sistema', v_sis_ant, true);
  PERFORM set_config('app.kanban_lote', v_lote_ant, true);
  RETURN jsonb_build_object('lote_id', _lote_id, 'restaurados', v_n, 'historico_apagado', v_hist);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.kanban_restaurar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.kanban_restaurar(uuid) TO authenticated;
```

- [ ] **Step 4: Criar `supabase/rollback/20260930150000_kanban_auto_4_rpcs_down.sql`**

```sql
-- INVERSO de 20260930150000_kanban_auto_4_rpcs.sql — rodar PRIMEIRO (ordem 4 → 3 → 2 → 1).
-- Só derruba as 5 RPCs novas (nenhum dado é tocado). Sem kanban_definir_automatico, ninguém liga/desliga
-- a chave enquanto a trava (migration 3) existir. Depois de rodar, o front F2/F3 que chama
-- estas RPCs quebra — reverter o front ANTES (ou junto).

BEGIN;

DROP FUNCTION IF EXISTS public.kanban_restaurar(uuid);
DROP FUNCTION IF EXISTS public.kanban_previa_restauracao(uuid);
DROP FUNCTION IF EXISTS public.kanban_definir_automatico(boolean);
DROP FUNCTION IF EXISTS public.kanban_previa_recalculo(jsonb);
DROP FUNCTION IF EXISTS public.kanban_mover(uuid, text);

COMMIT;

select pg_notify('pgrst', 'reload schema');
```

- [ ] **Step 5: Rodar e ver passar**

Run: `cd "/Users/sunglee/PLM + Criação/plm-pcp" && DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres KANBAN_AUTO_MIG_TXN=1 npx vitest run --no-file-parallelism tests/integration/kanban-auto.test.ts`
Expected: PASS (66 testes).

- [ ] **Step 6: Gates + commit**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp"
npm run build 2>&1 | tail -3
npx tsc --noEmit 2>&1 | grep -E "TS2304|error" ; true
npx vitest run --no-file-parallelism tests/unit/kanban-auto.test.ts tests/unit/kanban-status.test.ts
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres KANBAN_AUTO_MIG_TXN=1 npx vitest run --no-file-parallelism tests/integration/kanban-auto.test.ts tests/integration/kanban-condicoes.test.ts
```
```bash
git add -- supabase/rollback/20260930150000_kanban_auto_4_rpcs_down.sql
git commit --only -m "feat(kanban-auto): migration 4B — prévia de restauração, kanban_restaurar (chave desligada) + ACL + inverso 4

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- supabase/rollback/20260930150000_kanban_auto_4_rpcs_down.sql supabase/migrations/20260930150000_kanban_auto_4_rpcs.sql tests/integration/kanban-auto.test.ts
git show --stat HEAD | tail -n +7   # confere: SÓ os paths acima
```

---

### Task 17: Round-trip dos inversos em txn + gate completo

**Files:**
- Modify: `tests/integration/kanban-auto.test.ts` (último bloco)

**Interfaces:**
- Consumes: `MIGRACOES`, `INVERSOS`, `aplicarArquivo`, `prepara`, `defFuncao`, `REDEFINIDAS_M3`, `FUNCOES_M2`, `FUNCOES_M3`, `RPCS_F1` (Tasks 4–16); snapshot `funcoes.sql` (lido se existir; senão só a comparação com o "antes" da própria txn).
- Produces: prova de que ida 1→4 é idempotente (2×) e volta 4→1 (também 2×) devolve o banco ao retrato de antes: mesmas contagens de funções/gatilhos/colunas/índices/tabelas de `public`, as 5 funções tocadas (4 redefinidas pela 3 + `_kanban_status_rows`) BYTE-A-BYTE iguais ao antes e ao snapshot de 22/set. Teste: `SNAPSHOT_FUNCOES`, `blocoSnapshot(nome)`, `contagens(c)`.

- [ ] **Step 1: Acrescentar o teste de round-trip**

```ts
// ─────────────── Round-trip: ida 1→4 (2×, idempotente) e volta 4→1 (Task 17) ───────────────
const SNAPSHOT_FUNCOES = "/Users/sunglee/PLM + Criação/savepoints/2026-09-22-pre-unificacao/funcoes.sql";
/** Bloco de uma função no snapshot (texto do pg_get_functiondef + "\n;"), ou null se o arquivo não existe. */
function blocoSnapshot(nome: string): string | null {
  let txt: string;
  try {
    txt = readFileSync(SNAPSHOT_FUNCOES, "utf8");
  } catch {
    return null;
  }
  const ini = txt.indexOf(`CREATE OR REPLACE FUNCTION public.${nome}(`);
  if (ini < 0) return null;
  const fim = txt.indexOf("$function$\n;", ini);
  return txt.slice(ini, fim + "$function$\n".length);
}
async function contagens(c: Client) {
  return um<{ funcoes: string; gatilhos: string; colunas: string; indices: string; tabelas: string }>(c,
    `SELECT (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public') AS funcoes,
            (SELECT count(*) FROM pg_trigger t JOIN pg_class k ON k.oid = t.tgrelid JOIN pg_namespace n ON n.oid = k.relnamespace
              WHERE n.nspname = 'public' AND NOT t.tgisinternal) AS gatilhos,
            (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public') AS colunas,
            (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public') AS indices,
            (SELECT count(*) FROM pg_tables WHERE schemaname = 'public') AS tabelas`);
}

describe.skipIf(!hasDb || !MIG_TXN)("kanban-auto — round-trip das 4 migrations (Task 17)", () => {
  it("ida 2× (idempotente) + volta 4→1: contagens, redefinidas BYTE-A-BYTE (= snapshot) e nada sobra", async () => {
    await withTx(async (c) => {
      const antes = await contagens(c);
      const defs: Record<string, string | null> = {};
      for (const f of [...REDEFINIDAS_M3, "_kanban_status_rows(uuid)"]) defs[f] = await defFuncao(c, f);
      await prepara(c, 4);
      for (const rel of MIGRACOES) await aplicarArquivo(c, rel); // 2ª vez: idempotente
      const depois = await contagens(c);
      expect(Number(depois.funcoes) - Number(antes.funcoes)).toBe(FUNCOES_M2.length + FUNCOES_M3.length + RPCS_F1.length);
      expect(Number(depois.gatilhos) - Number(antes.gatilhos)).toBe(44);
      for (const n of [4, 3, 2, 1] as const) await aplicarArquivo(c, INVERSOS[n]);
      expect(await contagens(c)).toEqual(antes);
      for (const f of Object.keys(defs)) {
        expect(await defFuncao(c, f), f).toBe(defs[f]);
        const snap = blocoSnapshot(f.slice(0, f.indexOf("(")));
        if (snap !== null) expect(defs[f], `${f} = snapshot 22/set`).toBe(snap);
      }
      for (const n of [4, 3, 2, 1] as const) await aplicarArquivo(c, INVERSOS[n]); // inversos idempotentes
      expect(await contagens(c)).toEqual(antes);
    });
  });
});
```

- [ ] **Step 2: Rodar a suíte do kanban-auto inteira (com as migrations na txn)**

Run: `cd "/Users/sunglee/PLM + Criação/plm-pcp" && DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres KANBAN_AUTO_MIG_TXN=1 npx vitest run --no-file-parallelism tests/integration/kanban-auto.test.ts tests/integration/kanban-condicoes.test.ts`
Expected: PASS — 67 testes do kanban-auto + o anti-drift de condições (a F1 não muda o catálogo nem `_avaliar_condicoes_kanban_core`). Na cópia local a suíte leva poucos segundos (revisão de 23/set: ~3,3 s, 67 + 1 testes).

- [ ] **Step 3: Gate completo do repositório**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp"
npm run build 2>&1 | tail -3                                   # build (NÃO faz type-check)
npx tsc --noEmit 2>&1 | grep -E "TS2304|error" ; true          # type-check (tests/ ficam fora do tsconfig)
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres npx vitest run --no-file-parallelism   # suíte inteira na CÓPIA LOCAL: unit + integração (sem a env, o motor pula)
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres KANBAN_AUTO_MIG_TXN=1 npx vitest run --no-file-parallelism tests/integration/kanban-auto.test.ts tests/integration/kanban-condicoes.test.ts
git diff --name-only savepoint-pre-unificacao-2026-09-22 -- src/components/desenvolvimento/ src/components/producao/cad/CadTecidosSection.tsx
```
Expected: build e tsc sem erro novo; vitest verde (falhas pré-existentes alheias ao kanban, se houver, listadas no relatório com o nome do teste — a cópia local é de 23/set, dados posteriores de produção não estão nela); a última linha VAZIA (decisão travada 8 — nada no Sheet do Dev).

- [ ] **Step 4: Nada vazou para a cópia local (onde a suíte rodou)**

Run: `psql "postgresql://postgres:postgres@127.0.0.1:54422/postgres" -X -A -t -c "select to_regclass('public.kanban_snapshot'), to_regprocedure('public.kanban_mover(uuid,text)'), (select count(*) from information_schema.columns where table_name='tenant_config' and column_name='kanban_automatico'), (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'), (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal)"`
Expected: `||0|427|219` (nenhum objeto da F1; contagens do save point). Produção não é consultada: nenhum teste roda contra ela.

- [ ] **Step 5: Revisão de código (automática, report-only)**

Acionar o agente `code-reviewer` sobre `git diff savepoint-pre-unificacao-2026-09-22 -- supabase/ tests/integration/kanban-auto.test.ts src/lib/kanban-auto.ts src/lib/kanban-status.ts tests/fixtures tests/unit/kanban-auto.test.ts` com o foco: tenant guard e ACL das RPCs (inclusive `kanban_definir_automatico`), trava da chave contra upsert velho (decisão 16), GUCs (`app.kanban_sistema`/`app.kanban_lote`/`app.kanban_chave`) sempre restaurados, recursão, fila que nunca derruba o COMMIT, motor que não escreve `#Erro` (decisão 14), `kanban_mover` que não toca o motivo (decisão 15), "chave desligada = idêntico", idempotência dos 8 arquivos, nenhum DDL fora do `prepara`/`skipIf(!LOCAL)` (decisão 17). Achado BLOQUEANTE volta para a task de origem; o resto vai para o relatório.

- [ ] **Step 6: Commit**

```bash
git commit --only -m "test(kanban-auto): round-trip das 4 migrations e dos 4 inversos em txn (idempotência + byte-a-byte vs snapshot)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- tests/integration/kanban-auto.test.ts
git show --stat HEAD | tail -n +7   # confere: SÓ os paths acima
```

---

### Task 18: Ensaio geral na cópia local + portão G-migration + aplicar em PRODUÇÃO (NÃO é código)

> ⛔ **Nada é aplicado em produção antes dos Steps 1–3 concluídos e registrados** (ensaio completo na cópia local → guardião → OK do dono). Até lá produção não recebe NADA — nem teste (decisão 17). Com a chave desligada (default) a aplicação NÃO muda nenhum status; ligar a chave numa loja é OUTRO portão (G-chave), fora deste plano — a lista do Step 8 vai para ele.

**Files:**
- Nenhum arquivo do repo. Escritas permitidas: a CÓPIA LOCAL (só no Step 1, que termina desfeito — 427/219), o diário do guardião (append) e a pasta `/Users/sunglee/PLM + Criação/savepoints/pre-apply-f1-kanban-auto/` (NOVA, fora do repo — contém dado de loja; o snapshot de 22/set NÃO é tocado).

**Interfaces:**
- Consumes: os 4 arquivos de `supabase/migrations/20260930{12,13,14,15}0000_kanban_auto_*.sql`, os 4 inversos de `supabase/rollback/`, a suíte `tests/integration/kanban-auto.test.ts`, a ficha `/Users/sunglee/PLM + Criação/.claude/agents/guardiao-unificacao.md` (checklist G-migration, decisões 1–17), o diário `/Users/sunglee/PLM + Criação/plm-pcp/.superpowers/sdd/2026-09-22-unificacao-kanban-auto/guardiao.md` e o snapshot `/Users/sunglee/PLM + Criação/savepoints/2026-09-22-pre-unificacao/funcoes.sql`.
- Produces: ensaio registrado; F1 aplicada em produção (4 migrations, nessa ordem) + registrada em `supabase_migrations.schema_migrations`; md5 da "versão F1" das 5 funções tocadas (ensaio e produção); relatório pós-apply; prévia por loja; lista da G-chave (R8) no diário.

**Bloco de apoio** — colar no MESMO shell antes de cada Step (só define variáveis e funções; nada roda sozinho):

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp"
LOCAL="postgresql://postgres:postgres@127.0.0.1:54422/postgres"
D="/Users/sunglee/PLM + Criação/savepoints/pre-apply-f1-kanban-auto"; mkdir -p "$D"
S="/Users/sunglee/PLM + Criação/savepoints/2026-09-22-pre-unificacao"
MIGS=(supabase/migrations/20260930120000_kanban_auto_1_schema.sql supabase/migrations/20260930130000_kanban_auto_2_derivacao.sql
      supabase/migrations/20260930140000_kanban_auto_3_motor.sql supabase/migrations/20260930150000_kanban_auto_4_rpcs.sql)
INVS=(supabase/rollback/20260930150000_kanban_auto_4_rpcs_down.sql supabase/rollback/20260930140000_kanban_auto_3_motor_down.sql
      supabase/rollback/20260930130000_kanban_auto_2_derivacao_down.sql supabase/rollback/20260930120000_kanban_auto_1_schema_down.sql)
CONT="select (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'), (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal)"
MD5F="select p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid)) from pg_proc p where p.oid in ('public.fn_kanban_historico()'::regprocedure, 'public._kanban_regredir_modelo(uuid)'::regprocedure, 'public.fn_modelo_ref_auto()'::regprocedure, 'public._enviar_modelo_para_cad_core(uuid,text,text)'::regprocedure, 'public._kanban_status_rows(uuid)'::regprocedure) order by 1"
ATIV="select pid, usename, application_name, state, now() - xact_start as idade_txn, left(query, 60) as consulta from pg_stat_activity where datname = current_database() and backend_type = 'client backend' and pid <> pg_backend_pid() and state <> 'idle' and xact_start < now() - interval '5 seconds' order by xact_start"
# R1: aplica os arquivos NA ORDEM, um por vez, com lock_timeout de 5 s (PGOPTIONS e, se o pooler descartar o
# PGOPTIONS, o SET dentro da mesma txn do -1); para no 1º erro — o arquivo que falhou não deixa nada.
aplica() { local url="$1"; shift; for f in "$@"; do echo "== $f"; /usr/bin/time -p env PGOPTIONS='-c lock_timeout=5s' psql "$url" -X -q -1 -v ON_ERROR_STOP=1 -c "SET lock_timeout = '5s'" -f "$f" || { echo "PAROU em $f"; return 1; }; done; }
# R2: md5 de pg_get_functiondef VIVO × snapshot de 22/set das 5 funções que a F1 redefine (sai ≠ 0 se alguma diverge)
confere_snapshot() { python3 - "$1" "$S/funcoes.sql" <<'PY'
import hashlib, subprocess, sys
url, snap = sys.argv[1], open(sys.argv[2], encoding="utf8").read()
sigs = {"fn_kanban_historico": "fn_kanban_historico()", "_kanban_regredir_modelo": "_kanban_regredir_modelo(uuid)",
        "fn_modelo_ref_auto": "fn_modelo_ref_auto()", "_enviar_modelo_para_cad_core": "_enviar_modelo_para_cad_core(uuid,text,text)",
        "_kanban_status_rows": "_kanban_status_rows(uuid)"}
ok = True
for nome, sig in sigs.items():
    ini = snap.index(f"CREATE OR REPLACE FUNCTION public.{nome}(")
    fim = snap.index("$function$\n;", ini) + len("$function$\n")
    m_snap = hashlib.md5(snap[ini:fim].encode()).hexdigest()
    m_vivo = subprocess.run(["psql", url, "-X", "-A", "-t", "-c", f"select md5(pg_get_functiondef('public.{sig}'::regprocedure))"],
                            capture_output=True, text=True, check=True).stdout.strip()
    print(("OK      " if m_snap == m_vivo else "DIVERGE ") + f"{sig} snapshot={m_snap} vivo={m_vivo}")
    ok = ok and m_snap == m_vivo
sys.exit(0 if ok else 1)
PY
}
```

- [ ] **Step 1: ENSAIO GERAL na CÓPIA LOCAL — aplicar DE VERDADE → verificar → desfazer → reaplicar → desfazer** (decisão 17; G-plano B1/R1/R2)

```bash
# (bloco de apoio colado antes)
docker ps --filter name=supabase_db_banco-local --format '{{.Status}}'   # Up … (healthy)
psql "$LOCAL" -X -A -t -c "$CONT"                                        # 427|219 — cópia limpa
confere_snapshot "$LOCAL"                                                # 5 × OK
aplica "$LOCAL" "${MIGS[@]}"                                             # IDA (real) — anota o "real" de cada arquivo
psql "$LOCAL" -X -A -t -c "$CONT"                                        # 458|263
psql "$LOCAL" -X -A -t -F' ' -c "$MD5F" > "$D/md5_f1_ensaio.txt"; cat "$D/md5_f1_ensaio.txt"
# suíte SEM KANBAN_AUTO_MIG_TXN: roda contra os objetos APLICADOS (PRONTO = kanban_mover existe; os 7 testes só-MIG_TXN pulam)
DATABASE_URL="$LOCAL" npx vitest run --no-file-parallelism tests/integration/kanban-auto.test.ts tests/integration/kanban-condicoes.test.ts
aplica "$LOCAL" "${INVS[@]}"                                             # VOLTA 4 → 3 → 2 → 1
psql "$LOCAL" -X -A -t -c "$CONT"; confere_snapshot "$LOCAL"             # 427|219 e 5 × OK
aplica "$LOCAL" "${MIGS[@]}"                                             # REAPLICAR depois de desfazer
psql "$LOCAL" -X -A -t -F' ' -c "$MD5F" | diff - "$D/md5_f1_ensaio.txt" && echo "F1 IDÊNTICA"
aplica "$LOCAL" "${INVS[@]}"                                             # desfazer de novo: a cópia VOLTA LIMPA
psql "$LOCAL" -X -A -t -c "$CONT"; confere_snapshot "$LOCAL"             # 427|219 e 5 × OK
DATABASE_URL="$LOCAL" KANBAN_AUTO_MIG_TXN=1 npx vitest run --no-file-parallelism tests/integration/kanban-auto.test.ts tests/integration/kanban-condicoes.test.ts
```
Expected: cada `aplica` termina sem `PAROU em`, com 2 avisos inofensivos por arquivo (`WARNING: there is already a transaction in progress` e `WARNING: there is no transaction in progress` — o `-1` abre uma txn e o arquivo tem o próprio `BEGIN;…COMMIT;`) e o tempo de cada arquivo (é o teto de quanto tempo cada migration segura lock em produção — R1; revisão de 23/set na cópia local: 0,02–0,03 s por arquivo na ida e 0,01–0,03 s na volta — produção deve ficar abaixo de 1 s por arquivo); contagens `427|219` → `458|263` → `427|219` → (reaplicada) → `427|219`; `confere_snapshot` 5 × `OK` nas 3 vezes; `F1 IDÊNTICA`; suíte verde nos DOIS modos (objetos aplicados: 60 testes do kanban-auto + 7 pulados; `KANBAN_AUTO_MIG_TXN=1` na cópia limpa: 67), inclusive o R7. Registrar a saída inteira no diário do guardião (o Step 2 usa). Qualquer passo fora do esperado ⇒ PARAR (não seguir para o Step 2) e deixar a cópia limpa com `aplica "$LOCAL" "${INVS[@]}"` + `psql "$LOCAL" -X -A -t -c "$CONT"` = `427|219`.

- [ ] **Step 2: Guardião (G-migration)**

**Exigência (plano da campanha): a G-migration roda no Fable; sem o Fable, com 2 revisões Opus INDEPENDENTES (cada uma sem ver a outra) e o aviso ao dono de que o portão rodou sem o Fable — e, em QUALQUER caso, só vale junto com o OK explícito do dono (Step 3). Uma revisão Opus só NÃO basta.** Acionar o agente `guardiao-unificacao`. O prompt carrega: a ficha inteira (decisões 1–17); o plano da campanha e ESTE plano (§1–§6 + Tasks 4–18); o diário (com a saída do Step 1); e pede, com evidência (`arquivo:linha` ou comando+saída), o checklist G-migration da ficha:
  1. cada migration em `BEGIN…COMMIT`, idempotente, número > `20260929120000`; inverso pareado testado (Task 17 verde + ensaio do Step 1, com a saída);
  2. diff `pg_get_functiondef` antes/depois das 5 funções tocadas contra o snapshot (Task 14 Step 1 + Task 17 + `confere_snapshot` do Step 1);
  3. ACL: `has_function_privilege` anon/authenticated em TODAS as funções novas, inclusive `kanban_definir_automatico` (Task 16), e tabelas novas sem GRANT;
  4. chave DESLIGADA = idêntico a hoje (Task 14, teste com/sem migrations) e `_kanban_regredir_modelo` legado intacto;
  5. recálculo adiado p/ o COMMIT, erro capturado (Task 11) e testes com `SET CONSTRAINTS ALL IMMEDIATE`;
  6. `fn_colab_touch_rev` não alterado (`git diff` e `pg_get_functiondef`);
  7. anti-drift TS×SQL e `reprovado` sempre manual (Task 8);
  8. nenhum `\i` de migration em txn de teste (harness da Task 4);
  9. índices novos presentes; desempenho medido — derivação (Task 9) e LIGAR a Ave Rara pela RPC (R7, Task 15);
  10. decisões do dono 14–17 implementadas: #Erro (Task 11 + Task 14), motivo (Task 15), trava da chave + RPC (Tasks 13 e 15), testes com DDL só na cópia local (`exigeBancoLocal`, `skipIf(!LOCAL)`, todo "Run" com `DATABASE_URL` da cópia) — e nenhum teste rodou contra produção;
  11. R1/R2 prontos para o apply: ALTER de `tenant_config` no FIM da migration 1, `aplica` com `lock_timeout`, `ATIV` e `confere_snapshot` nos Steps 4 e 9;
  12. as decisões D1–D21 do §5 — o guardião diz quais precisam de OK explícito do dono (as novas: D18–D21).

O guardião ACRESCENTA o veredito ao diário. **BLOQUEIA ⇒ parar aqui.** APROVA COM RESSALVAS ⇒ resolver/registrar as ressalvas antes do Step 3.

- [ ] **Step 3: OK EXPLÍCITO do dono**

Apresentar ao dono, em PT-BR simples: o que a F1 faz (motor pronto, chave DESLIGADA em todas as lojas, só o botão novo com prévia liga, nada muda até ligar), o resultado do ensaio (Step 1), o veredito do guardião, as decisões D1–D21 (pedir sim/não nas marcadas pelo guardião), a lista da G-chave (Step 8) e o plano de volta (Step 9). Registrar a resposta literal + data no diário do guardião. Sem "sim" explícito do dono ⇒ parar aqui.

- [ ] **Step 4: Retrato pré-apply + pré-voo em PRODUÇÃO (só leitura)**

```bash
# (bloco de apoio colado antes)
PROD="$(cat /tmp/dburl.txt)"
psql "$PROD" -X -c "\copy (select id, tenant_id, status_desenvolvimento, revisao_pendente, ref, rev from public.modelos order by id) to '$D/modelos_status.csv' csv header"
psql "$PROD" -X -c "\copy (select tenant_id, status_kanban, kanban_requisitos, kanban_requisitos_excecoes, revenda_kanban_colunas, revenda_kanban_requisitos, confeccao_prioridade from public.tenant_config order by tenant_id) to '$D/tenant_config_kanban.csv' csv header"
psql "$PROD" -X -c "\copy (select * from public.modelo_kanban_historico order by id) to '$D/modelo_kanban_historico.csv' csv header"
psql "$PROD" -X -A -t -c "$CONT" | tee "$D/contagens.txt"                  # 427|219
confere_snapshot "$PROD"                                                    # R2: 5 × OK
PGOPTIONS='-c lock_timeout=5s' psql "$PROD" -X -A -t -c "show lock_timeout" # informativo: 5s = o pooler repassa o PGOPTIONS (senão o SET do `aplica` cobre)
psql "$PROD" -X -A -F' | ' -c "$ATIV"                                       # R1: nenhuma linha
```
Expected: 3 CSVs não vazios; `427|219` (se não bater, alguém mudou o schema desde o save point: PARAR — o ensaio do Step 1 rodou numa cópia que já não é fiel; refazer a cópia local a partir de produção, repetir o Step 1 e voltar ao guardião); `confere_snapshot` 5 × `OK` — qualquer `DIVERGE` ⇒ PARAR e voltar ao dono (a função foi redefinida depois de 22/set e a migration 3 a reverteria calada: refazer o diff mínimo da Task 14 contra o texto VIVO antes de qualquer apply); `ATIV` sem linhas (nenhuma transação ativa ou "idle in transaction" com mais de 5 s) — com linha: NÃO aplicar; esperar e repetir; persistindo, identificar a sessão com o dono (não matar sessão por conta própria). Aplicar FORA do horário de uso das lojas (o retrato do Step 7c compara `modelos` antes × depois).

- [ ] **Step 5: Aplicar em PRODUÇÃO, na ordem, uma por vez, com `lock_timeout`** — logo depois do Step 4 (sem janela entre o pré-voo e o apply)

```bash
# (bloco de apoio colado antes)
aplica "$(cat /tmp/dburl.txt)" "${MIGS[@]}"
```
Expected: igual ao ensaio (Step 1) — cada arquivo sem `PAROU em`, os 2 avisos de transação por arquivo, tempo da mesma ordem do ensaio. Com `ON_ERROR_STOP=1` + `-1`, erro antes do `COMMIT;` do arquivo ⇒ psql sai e a transação é desfeita (nada DAQUELE arquivo fica); os anteriores ficam (inofensivos com a chave desligada). Falha por `canceling statement due to lock timeout` (alguém segurava lock por mais de 5 s): repetir o `ATIV` do Step 4 e rodar `aplica` só com os arquivos que faltam; persistindo, parar e falar com o dono (ou Step 9). Outro erro ⇒ PARAR e ir ao Step 9 se algum arquivo já entrou.

- [ ] **Step 6: Registrar em `supabase_migrations.schema_migrations` (idempotente)**

```bash
psql "$(cat /tmp/dburl.txt)" -X -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES
  ('20260930120000', 'kanban_auto_1_schema',    '{}'::text[]),
  ('20260930130000', 'kanban_auto_2_derivacao', '{}'::text[]),
  ('20260930140000', 'kanban_auto_3_motor',     '{}'::text[]),
  ('20260930150000', 'kanban_auto_4_rpcs',      '{}'::text[])
ON CONFLICT (version) DO NOTHING;
SELECT version, name FROM supabase_migrations.schema_migrations WHERE version LIKE '20260930%' ORDER BY version;
SQL
```
Expected: 4 linhas (`statements` vazio, como as 104 linhas já registradas; `version` é PK → rodar de novo não duplica).

- [ ] **Step 7: Verificação pós-apply — SÓ LEITURA em produção (D21)**

A suíte de integração NÃO roda contra produção (o harness nem conecta: `PRONTO` só considera "já aplicadas" na cópia local): ela já rodou no Step 1 sobre os MESMOS arquivos aplicados na cópia local; aqui só SELECT (e a prévia em `BEGIN…ROLLBACK`).

```bash
# (bloco de apoio colado antes)
PROD="$(cat /tmp/dburl.txt)"
# (a) objetos + chave desligada nas 6 lojas
psql "$PROD" -X -A -F' | ' \
  -c "select (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public') funcoes,
             (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal) gatilhos,
             (select count(*) from public.tenant_config) lojas,
             (select count(*) from public.tenant_config where kanban_automatico) ligadas,
             (select count(*) from public.kanban_snapshot) snapshots,
             (select count(*) from public.kanban_recalculo_fila) fila"
# (b) R2: as 5 funções tocadas em produção = as do ensaio (mesmos arquivos) — vira a referência do Step 9
psql "$PROD" -X -A -t -F' ' -c "$MD5F" | tee "$D/md5_f1_prod.txt" | diff - "$D/md5_f1_ensaio.txt" && echo "IGUAL AO ENSAIO"
# (b2) ACL (invariante #9): internas sem EXECUTE p/ anon/authenticated; RPCs só authenticated; tabelas novas sem GRANT
psql "$PROD" -X -A -t -F'|' <<'SQL'
WITH i(f) AS (VALUES ('_kanban_status_rows_raw(jsonb)'), ('_kanban_norm(text)'), ('_kanban_lista(jsonb)'),
    ('_kanban_coluna_manual(text,jsonb)'), ('_kanban_req_efetivos(text,text[],jsonb,jsonb)'),
    ('_kanban_derivar_puro(text[],jsonb,jsonb,jsonb,text,boolean)'), ('_kanban_faltando_para(text[],jsonb,jsonb,jsonb,text,boolean,text)'),
    ('_kanban_destino_drop_puro(text[],jsonb,jsonb,jsonb,text,boolean,text)'), ('_kanban_fluxo(jsonb,boolean)'), ('_kanban_cfg(uuid)'),
    ('_kanban_ligado(uuid)'), ('_kanban_derivar_lote(uuid,uuid[],jsonb)'), ('_kanban_status_gate(uuid,uuid,text)'),
    ('_kanban_enfileirar(uuid[])'), ('_kanban_enfileirar_tenant(uuid)'), ('_kanban_aplicar(uuid,uuid[],text,uuid)')),
r(f) AS (VALUES ('kanban_mover(uuid,text)'), ('kanban_previa_recalculo(jsonb)'), ('kanban_definir_automatico(boolean)'),
    ('kanban_previa_restauracao(uuid)'), ('kanban_restaurar(uuid)'))
SELECT (SELECT count(*) FROM i WHERE has_function_privilege('anon', 'public.' || f, 'EXECUTE')
                                  OR has_function_privilege('authenticated', 'public.' || f, 'EXECUTE')) AS internas_expostas,
       (SELECT count(*) FROM r WHERE has_function_privilege('anon', 'public.' || f, 'EXECUTE')
                                  OR NOT has_function_privilege('authenticated', 'public.' || f, 'EXECUTE')) AS rpcs_erradas,
       (SELECT count(*) FROM (VALUES ('kanban_recalculo_fila'), ('kanban_snapshot')) t(n), (VALUES ('anon'), ('authenticated')) p(r)
         WHERE has_table_privilege(p.r, 'public.' || t.n, 'SELECT,INSERT,UPDATE,DELETE')) AS tabelas_expostas;
SQL
```
Expected (a): `458 | 263 | 6 | 0 | 0 | 0` (427 + 31 funções = 13 da migration 2 + 13 da 3 + 5 RPCs; 219 + 44 gatilhos). Expected (b): `IGUAL AO ENSAIO`. Expected (b2): `0|0|0`.

```bash
# (c) NENHUM status mudou: retrato pré-apply × agora (exato) e contagem por status × save point de 22/set (informativo)
psql "$PROD" -X -c "\copy (select id, tenant_id, status_desenvolvimento, revisao_pendente, ref, rev from public.modelos order by id) to '$D/modelos_status_pos.csv' csv header"
diff "$D/modelos_status.csv" "$D/modelos_status_pos.csv" && echo "IDÊNTICO"
for f in "$S/modelos_status.csv" "$D/modelos_status_pos.csv"; do
  echo "== $f"; python3 -c "import csv,sys,collections; r=csv.DictReader(open(sys.argv[1])); c=collections.Counter((x['tenant_id'][:8], x['status_desenvolvimento']) for x in r); [print(k, v) for k, v in sorted(c.items())]" "$f"
done
```
Expected (c): `IDÊNTICO` (a aplicação não escreve em `modelos` — provado no ensaio: contagens 458/263 e nenhum status tocado). Linha diferente ⇒ conferir no `audit_log` (Admin › Auditoria) se foi edição de usuário entre os dois retratos; diferença sem autoria de usuário é BLOQUEIO (ir ao Step 9). A contagem por status contra o save point de 22/set pode diferir SÓ pelo uso normal das lojas entre 22/set e o apply — listar as diferenças no relatório.

```bash
# (d) prévia por loja — o que MUDARIA se o dono ligasse a chave (só leitura, em txn revertida, como super_admin)
for L in $(psql "$PROD" -X -A -t -c "select tenant_id from public.tenant_config order by tenant_id"); do
psql "$PROD" -X -A -t <<SQL
BEGIN;
SELECT set_config('request.jwt.claims', json_build_object('sub','f1378ea4-5f6a-47ed-8ac4-95accd03326e','role','authenticated')::text, true);
UPDATE public.users SET tenant_id = '$L' WHERE id = 'f1378ea4-5f6a-47ed-8ac4-95accd03326e';
SELECT '$L' AS loja, p->>'total' AS total, p->>'mudam' AS mudam, p->>'fixados' AS fixados, p->>'revelam_ref' AS revelam_ref,
       (SELECT string_agg((c->>'de') || '→' || (c->>'para'), ', ') FROM jsonb_array_elements(p->'cards') c) AS movimentos
  FROM (SELECT public.kanban_previa_recalculo('{"kanban_automatico": true}'::jsonb) AS p) x;
ROLLBACK;
SQL
done
```
Expected (d): uma linha por loja (`loja|total|mudam|fixados|revelam_ref|movimentos`), nada gravado (ROLLBACK; o `UPDATE users` é revertido). Apresentar ao dono junto com o lembrete do guardião (G-chave): loja com requisito em poucas colunas fica com quase tudo MANUAL/fixado (caso real: Ave Rara) — configurar os requisitos de progresso ANTES de ligar; e a lista de REFs que seriam reveladas (não voltam).

Registrar (a)–(d) no diário do guardião (append) e na memória da campanha.

- [ ] **Step 8: Lista da G-chave (R8) — registrar no diário, para o portão de ligar a chave numa loja**

Efeitos ACEITOS com a chave LIGADA que o Sheet do Desenvolvimento — intocado até o fim da migração (decisão 8) — mostra diferente do servidor, e que o dono precisa conhecer antes de ligar:
1. O Select de status do Sheet deixa escolher uma coluna AUTOMÁTICA; ao salvar, o guard ignora o valor e o status "volta" para a posição derivada (efeito já previsto no plano da campanha, F2).
2. Card FIXADO numa coluna manual ADIANTE da posição derivada: o botão "Enviar à Explosão" aparece LIBERADO (o Sheet chama `podeEnviarExplosao` com 3 argumentos — `src/components/desenvolvimento/ModeloDetailPanel.tsx:1410`), mas o servidor RECUSA com P0001 "O modelo precisa estar na etapa … (ou posterior) para ser enviado à Explosão." (gate pela posição derivada — decisão 10).
3. Nesse mesmo card o campo REF aparece VAZIO: `refCampoVisivel` com 3 argumentos (`ModeloDetailPanel.tsx:1418`) mostra o campo pela coluna fixada, mas o servidor só revela a REF quando a posição DERIVADA chega a `ref_exibir_status`.
4. Enquanto o board novo (F2) não estiver no ar: arrastar no board antigo para coluna automática "volta" calado (guard); para coluna manual fixa. Com a chave ligada, recuo automático não acende `#Erro` (decisão 14) — um `#Erro` que apareça é legado, de antes de ligar (D20).
5. A Config antiga (antes do deploy da F2) não liga nem desliga a chave: o upsert dela passa pela trava (decisão 16). Só o botão novo com prévia (`kanban_definir_automatico`) muda a chave.

- [ ] **Step 9: Como voltar (só com OK do dono)**

```bash
# (bloco de apoio colado antes)
PROD="$(cat /tmp/dburl.txt)"
# 0) Se alguma loja LIGOU a chave: ANTES de tudo, desligar pelo botão (kanban_definir_automatico(false)) e restaurar
#    pela prévia (kanban_previa_restauracao → kanban_restaurar) enquanto a migration 4 existe.
psql "$PROD" -X -A -t -c "select count(*) from public.tenant_config where kanban_automatico"         # 0
psql "$PROD" -X -A -t -F' ' -c "$MD5F" | diff - "$D/md5_f1_prod.txt" && echo "VIVO = VERSÃO F1"    # R2 — divergência ⇒ PARAR e voltar ao dono
psql "$PROD" -X -A -F' | ' -c "$ATIV"                                                               # R1 — nenhuma linha
psql "$PROD" -X -c "\copy (select * from public.kanban_snapshot) to '$D/kanban_snapshot.csv' csv header"
psql "$PROD" -X -c "\copy (select id, origem, lote_id from public.modelo_kanban_historico where origem <> 'manual') to '$D/mkh_origem.csv' csv header"
aplica "$PROD" "${INVS[@]}"                                                                         # 4 → 3 → 2 → 1, com lock_timeout
psql "$PROD" -X -v ON_ERROR_STOP=1 -c "DELETE FROM supabase_migrations.schema_migrations WHERE version IN ('20260930120000','20260930130000','20260930140000','20260930150000')"
psql "$PROD" -X -A -t -c "$CONT"; confere_snapshot "$PROD"                                          # 427|219 e 5 × OK
```
Expected: `0`; `VIVO = VERSÃO F1` (se alguém redefiniu uma das 5 funções depois do apply, o inverso a reverteria calado para o texto de 22/set — PARAR); `ATIV` sem linhas; os 2 CSVs (o inverso 1 é DESTRUTIVO: apaga `kanban_automatico`, a marca origem/lote do histórico e os lotes de snapshot); inversos sem `PAROU em` (os mesmos 2 avisos por arquivo); `427|219` e 5 × `OK`. Em último caso (restauração impossível), os CSVs de `savepoints/pre-apply-f1-kanban-auto/` (Step 4) são a rede.

---

## 6. Rastreabilidade (self-review das Tasks 4–18 contra o §3, o G-inicial, o G-fase e o G-plano)

| Regra / ressalva | Onde | Prova (teste) |
|---|---|---|
| §3 Vocabulário: board = `normalizeKanbanStatuses` ≡ `_kanban_status_rows_raw`, DEDUP por key; fluxo comprado = board ∩ `revenda_kanban_colunas`; `exc={}` p/ comprado | Tasks 7, 8, 9 (`_kanban_status_rows_raw`, `_kanban_fluxo`, `_kanban_derivar_lote`) | T7 boards reais + sintéticos; T8 `_kanban_fluxo ≡ …`; T9 lote ≡ `derivarModelo` em dado real |
| §3 Coluna manual/automática; `reprovado` SEMPRE manual (G-inicial #2) | Task 8 (`_kanban_coluna_manual`, `semReprovado` ≡ `v_reqs_in - 'reprovado'`) | fixtures 7/7b; T12 "reprovado com requisito satisfeito NUNCA é destino" |
| §3 Derivável / entrada / alvo "para na 1ª que falha" (G-inicial #3) / fixado | Task 8 (`_kanban_derivar_puro`) | fixtures 1–16 (com E1); T11/T12 "c sem b → não pula"; T11 "exceção configurada NÃO pula coluna no motor" |
| §3 Arraste (7 regras) + `faltandoPara` | Task 8 (`_kanban_destino_drop_puro`, `_kanban_faltando_para`); Task 15 (`kanban_mover`) | arrastes das fixtures; T8 faltandoPara; T15 fixar/soltar/nada/bloqueios |
| §3 Mensagens PT-BR (`mensagemDrop`) | TS (Task 2); SQL devolve só `acao/faltando` com keys do catálogo | T15 `faltando = ["data_aprovacao"]` (label fica no TS) |
| §3 GUCs `app.kanban_sistema`/`app.kanban_lote`/`app.kanban_chave` (transação-local, restaurados) | Tasks 10, 11, 13, 15, 16 | T11 "GUC volta ao anterior"; T12 trava do enfileirador; T10 origem/lote no histórico; T13/T15 `app.kanban_chave` volta a `''` |
| §3 Histórico: origem + janela 10 s (G-inicial #5), colunas puladas sem linha | Task 10 (`fn_kanban_historico`) | T10 (3 testes); T12 "janela: 1 linha auto, pulos sem linha" |
| **D14 (dono, 23/set)**: `restauracao` não repete a coluna da última linha restante | Task 10 (`fn_kanban_historico`) | T10 (fim do 3º teste); T16 histórico de M = `["entrada:manual"]` |
| **Decisão 14 (dono, 23/set)**: com a chave ligada o motor NUNCA acende/apaga `#Erro`; `kanban_mover` apaga; chave desligada = legado (D13 eliminada; D20) | Tasks 11 (`_kanban_aplicar` sem `revisao_pendente`), 14 (legado sai cedo), 15 | T11 "#Erro (decisão 14)…"; T12 "motor por evento" (`erro=false`); T14 legado desligada acende × ligada não; T15 "nada … apaga o #Erro" |
| **Decisão 15 (dono, 23/set)**: sair de Reprovado NÃO apaga `motivo_cancelamento` (D4 alterada) | Task 15 (`kanban_mover`) | T15 "sair de Reprovado NÃO apaga…" (fixar e soltar) |
| **Decisão 16 (dono, 23/set) / G-plano R3**: `kanban_automatico` só muda pela RPC; upsert de aba velha não liga/desliga; INSERT nasce desligado (D18, D19) | Tasks 13 (`trg_kanban_chave_protegida`), 15 (`kanban_definir_automatico`) | T13 "3F: a chave só muda pela RPC" (2); T15 `kanban_definir_automatico` (2); T16 ACL da RPC |
| **Decisão 17 (dono, 23/set) / G-plano B1 / D12**: DDL só na cópia local; produção só na aplicação final (D21) | Global Constraints; Task 4 (`exigeBancoLocal` em `prepara`, `LOCAL`, `SSL`); `skipIf(!LOCAL)` nas Tasks 4, 11, 12, 15; todo "Run" com `DATABASE_URL` da cópia; Task 18 Steps 1 e 7 | T4 "exigeBancoLocal…"; ensaio (Task 18 Step 1) |
| §3 Gates por posição (decisão 10) + REF de fixado revelada pelo motor | Tasks 9 (`_kanban_status_gate`), 11 (`_kanban_aplicar`), 14 (`fn_modelo_ref_auto`, `_enviar_modelo_para_cad_core`) | T11 "fixado … REF revelada"; T14 "decisão 10" (REF e Explosão) |
| **G-plano R4**: a prévia de LIGAR lista as REFs que serão reveladas + aviso (D11 ampliada) | Task 15 (`kanban_previa_recalculo`) | T15 "R4 — … (= exatamente as que o LIGAR de verdade revela)"; T15 "NÃO grava" (`revelam_ref=0` sem card na etapa) |
| §3 Snapshot no servidor ao ligar (só pela RPC) e a cada mudança com a chave ligada (G-inicial #1a/c, G-fase R2); `confeccao_prioridade` só recalcula; desligar não grava | Tasks 13 (`fn_kanban_config`, `trg_kanban_config` c/ WHEN nas 7 colunas), 15 (RPC) | T13 (2 testes); T15 "admin LIGA (lote 'ligar' …)" |
| §3 Restaurar: exige chave desligada, prévia c/ movimentos manuais depois, REF/#Erro não voltam (G-inicial #1b/d) | Task 16 | T16 (3 testes) |
| §3 Guard (draft velho ignorado, manual fixa, tirar de manual solta, entrada aceita, ''/NULL mantém, fora do fluxo P0001) | Task 13 (`fn_kanban_status_guard`) | T13 guard (5 testes) |
| Chave DESLIGADA = idêntico a hoje; legado intacto | Tasks 11–14 | T12 "chave DESLIGADA: NENHUM evento…"; T14 legado + "com e sem as migrations" |
| G-inicial #4 (upsert da linha inteira → WHEN com IS DISTINCT FROM; Sheet do Dev manda ~40 colunas) | Tasks 12, 13 | T12 "coluna fora do WHEN não enfileira"; T13 "upsert sem mudança não grava"; T13 "aba VELHA não liga nem desliga" |
| G-inicial #6 (coluna manual aceita qualquer card → gates pela posição derivada) | Tasks 13, 14 | T13 manual fixa; T14 decisão 10 |
| G-inicial #8 (3 gatilhos statement-level por tabela; inverso derruba todos; trava de recursão) | Task 12; inverso 3 (Task 14) | T12 "sem recursão" (só na cópia local); T14 inverso "44 gatilhos… somem" |
| G-inicial #9 (numeração > 20260929120000; pasta `supabase/rollback/`) | Tasks 5–16 | nomes `20260930{12..15}0000`; T6/T9/T14/T17 |
| G-inicial #10 (`categorias_terceirizado`; `origem`/`lancado`/`ordem_criacao_enviada` no WHEN) | Task 12 | T12 categorias + eventos `modelos.origem` + INSERT com/sem Ordem de Criação |
| G-inicial #1e / #7 (restaurar pelos CSVs certos; BOM/CAD/etiquetas) | Task 18 Steps 4/9 (retrato `pre-apply-f1-kanban-auto`) | — (#7 é pré-requisito da F3, fora da F1) |
| **G-plano R1**: `lock_timeout` no apply e nos inversos, `pg_stat_activity` antes, ALTER de `tenant_config` no FIM da migration 1 | Task 5 (ordem do arquivo); Task 18 (`aplica`, `ATIV`, Steps 4/5/9) | ensaio (Task 18 Step 1: tempo de cada arquivo) |
| **G-plano R2**: md5 vivo × snapshot das 5 funções antes do apply; vivo × versão F1 antes dos inversos | Task 18 (`confere_snapshot`, `MD5F`, Steps 1/4/7/9) | ensaio (Task 18 Step 1: 3 × `confere_snapshot` + `F1 IDÊNTICA`) |
| Recálculo ADIADO p/ o COMMIT; `salvar_modelo_bom` sem linha transitória; erro nunca derruba o save | Task 11 (fila + constraint trigger) | T11 "fila ADIADA", "erro … WARNING" (só na cópia local); T12 `salvar_modelo_bom` |
| Invariante #9 (REVOKE dos 3; RPC só authenticated; DEFINER + search_path) | Tasks 7–16 | T5 tabelas; T16 ACL de TODAS as funções novas (inclusive `kanban_definir_automatico`); Task 18 Step 7(b2) em produção |
| `fn_colab_touch_rev` intocado; `rev` sobe em toda escrita | nenhuma migration toca a função | Task 18 Step 2 item 6; T15 `rev` devolvido = rev gravado |
| Round-trip / idempotência / byte-a-byte vs snapshot | Task 17; ensaio real (Task 18 Step 1) | T17; Step 1 (`427|219` ↔ `458|263`, `confere_snapshot`) |
| Desempenho medido (derivação + **G-plano R7**: LIGAR pela RPC) | Tasks 9, 15 | T9 "< 3 s" (23/set: ~0,45 s no banco real; ~0,12 s na cópia local); T15 "R7 … < 5 s" (cópia local: 218–229 ms) |
| **G-plano R8**: efeitos com a chave ligada no Sheet do Dev (intocado) | Task 18 Step 8 (lista da G-chave) | — (vai para o portão G-chave) |
