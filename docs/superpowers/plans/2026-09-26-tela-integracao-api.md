# Tela de Integração + API por loja — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir a tela "Integração" (abas Produtos · Campos da API · API · Manual da API · Log), o banco que a sustenta
(retrato, estados, trava, mão dupla, chaves, acessos, log) e a API de leitura `GET /api/integracao/v1/produtos` do próprio
site — tudo aprovado no spec v4.4 e no mockup v4 (P-84 A) — para o 2º deploy (P-68 B).

**Architecture:**
- **Banco (F1):** 6 migrations aditivas `20261007100000…150000` (tabelas → retrato/leitura → estados/log → trava →
  salvar/mão dupla → API), cada uma com inverso em `supabase/rollback/`. As 7 tabelas novas têm RLS ligada SEM policy +
  `REVOKE ALL` (padrão `kanban_snapshot`): toda leitura/escrita é por RPC `SECURITY DEFINER`, que confere a permissão
  `integracao` e mascara o custo. O retrato é calculado SÓ no banco (`_integracao_retrato_core`) e assinado por HMAC. A
  trava é por gatilhos `trg_zz_*` (últimos da ordem alfabética) e por um CONSTRAINT TRIGGER adiado nas variantes do
  espelho. 4 funções existentes são redefinidas com diff mínimo (`_seed_tenant_defaults`, `_pa_recomputar_precos_modelo`,
  `_imp_recomputar_precos_modelo`, `_salvar_produto_importado_core`). Produção só pelo DONO (RODAR, com `pg_dump` antes).
- **Tela (F2):** rota `/integracao` (permissão nova `integracao`, `ModuleDef` próprio, fora dos interruptores de
  contratação), abas por papel, staging por produto (só o Salvar grava, em 3 passos: fotos → `integracao_salvar` → SKUs),
  merge 3-vias com `rev`/P0409, diálogos do mockup. Só tela larga: no celular, aviso "A Integração é usada no computador"
  (P-87).
- **API (F3):** rota de servidor TanStack Start no Worker (molde `src/routes/sitemap[.]xml.ts`), handler PURO com
  dependências injetadas (testável), 2 fases (`_integracao_ler` → assina fotos → `_integracao_confirmar`), teto por IP no
  binding `ratelimits` do Workers. Antes do RODAR, a rota REAL roda contra a CÓPIA num vite próprio na `:5199` e o CPU é
  medido com páginas grandes (Task 20b).
- **F4:** selo "Integrável/Integrado em dd/mm — travado" + SÓ os campos marcados travados nas outras telas (atacado livre);
  preço do importado = preço FIXO (tela Importado no Salvar; Sheet/card pelo gravador novo — n1/n2). **F5:** QA na cópia
  (:5188, com os 5 casos do R7) + celular (aviso + selos) + docs + G-deploy.

**Tech Stack:** PostgreSQL 17.6 (Supabase próprio `ruinwcuabilumcspeyjk`; cópia local Docker `supabase_db_banco-local`
em `127.0.0.1:54422`), plpgsql/sql, pgcrypto (`extensions.hmac`/`digest`/`gen_random_bytes`), Vite + React 19 +
TypeScript + TanStack Router/Start 1.16x + TanStack Query v5 + supabase-js 2.108, Tailwind v4 + shadcn, Cloudflare Workers
(wrangler 4.105, `ratelimits`), Vitest 4 (unit `node` + integração `BEGIN…ROLLBACK` SÓ na cópia), Playwright (QA no
`:5188`, cópia), bash (scripts de produção no molde da frente SKU em prévia).

**Spec:** `docs/superpowers/specs/2026-09-26-tela-integracao-api-design.md` (v4.4 — P-89 A; até a v4.3 na branch
`integracao/desenho`, hoje congelada; desde a T0 — `dbcd5911` — spec e plano vivem SÓ na worktree `integracao-impl`, branch
`integracao/impl`) — AUTORIDADE. Pareceres com notas
para o plano (na worktree `.claude/worktrees/integracao`, a do desenho): `.superpowers/g-plano-integracao-guardiao.md`
(v1/v2), `.superpowers/g-plano-integracao-guardiao-v4.md` (v4 + re-conferência v4.1: V1–V5, n1–n6),
`.superpowers/g-mockup-integracao-guardiao*.md` (nota 14; REF/foto) e `.superpowers/g-plano-integracao-guardiao-plano.md`
(G-plano DESTE plano @ b0c22294: R1–R9 + N1–N8 — incorporados nesta revisão, com P-87 e P-88 A do dono). Mockup aprovado (P-84 A):
`/private/tmp/claude-501/-Users-sunglee-PLM---Cria--o/f73c31ec-0c58-49a9-b65c-05edfa4258fc/scratchpad/mockup-integracao.html`
(textos da tela copiados deste arquivo). Moldes de processo: `docs/superpowers/plans/2026-09-22-kanban-automatico-f1-banco.md`
e `docs/superpowers/plans/2026-09-25-sku-previa-regerar.md` (checkout principal).

## Global Constraints

**Repositório**
- Worktree NOVA `/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/integracao-impl`, branch NOVA `integracao/impl`
  criada a partir da linha principal ATUAL `feature/plan-tecido-a1` @ `338d5433` (inclui o fix "salvar rápido" P-57, que a
  `integracao/desenho` — nascida de `e6bdfdde` — não tem); spec + plano trazidos da `integracao/desenho` num commit de docs
  (Task 0). `node_modules` = SYMLINK para o do checkout principal (padrão das outras worktrees; o `package.json` da principal
  é o mais novo). Todo comando roda DE DENTRO dela e imprime alvo + `HEAD`. Caminhos relativos = raiz da worktree.
  Âncoras de código deste plano conferidas em `338d5433` (o que mudou desde `e6bdfdde` fica em §1).
- `.superpowers/` é gitignored: regras, gates, scripts, logs e evidências em `.superpowers/integracao/` (não versionados).
- Commit: `git add -- <paths exatos>` + `git commit --only -m "<msg>" -- <paths>` + `git show --stat HEAD` (só os paths da
  task). A mensagem termina com `Co-Authored-By: Claude <modelo real> <noreply@anthropic.com>`.
- ⛔ PROIBIDO: `git stash` (para comparar com a base use `git show <sha>:<arquivo> > .superpowers/integracao/logs/<x>` ou
  `git worktree add` temporário), `git add .`/`-A`, `git commit -a`, `push`, `pkill`/`killall`, editar
  `src/integrations/supabase/types.ts` (RPC nova via `as any`), editar `src/components/ui/**`, despachar subagentes,
  imprimir senha/URL com senha/`.env`.
- Só mudam os arquivos de `.superpowers/integracao/permitidos.txt` (o `gates.sh` confere).
- **Sheet do Dev intocado** (decisão 8 da campanha): `git diff --name-only savepoint-pre-unificacao-2026-09-22 --
  src/components/desenvolvimento/ src/components/producao/cad/CadTecidosSection.tsx` VAZIO em todo commit. O Dev só
  recebe a recusa do banco, traduzida em `src/lib/erro-mensagem.ts` (compartilhado).
- Aposentar = ocultar primeiro: o card oculto "Integração com ERP" (`admin/configuracoes.tsx`) e o doc local
  `docs/api-integracao-erp.md` ficam COMO ESTÃO (nada apagado).

**Banco**
- ⛔ PRODUÇÃO: nenhum agente toca — nem `SELECT`, nem `/tmp/dburl.txt`. Produção só pelo DONO, no Terminal dele, pelos
  scripts da Task 8 (RODAR), com `pg_dump` completo ANTES (plano Supabase SEM PITR). Se o controlador precisar LER
  produção: `psql "$(cat /tmp/dburl.txt)" -X -c "begin transaction read only" -c "<select>" -c "rollback"` (o PGOPTIONS
  só-leitura NÃO vale no Supavisor).
- Cópia `postgresql://postgres:postgres@127.0.0.1:54422/postgres` (também o app de teste `:5188`):
  - leitura: `PGOPTIONS='-c default_transaction_read_only=on' psql …`;
  - DDL SÓ (a) na txn revertida das suítes desta frente (`INTEGRACAO_MIG_TXN=1`) ou (b) pelos scripts
    `.superpowers/integracao/{copia.sh,mig/ensaio-local.sh}`;
  - TODA rodada com DDL (inclusive toda suíte de integração desta frente — elas aplicam SQL) roda na JANELA N3: o
    controlador publica o aviso no painel (P-30 B, sem esperar OK) e roda
    `INTEG_DONO_AVISADO=sim bash .superpowers/integracao/n3.sh antes <passo>`; depois `bash .superpowers/integracao/n3.sh
    depois <passo>`. Esta frente CRIA tabelas e gatilhos em `modelos`/`produtos_*`: na suíte, a trava da DDL dura a
    TRANSAÇÃO INTEIRA do teste (N1 do G-plano do plano) — o `:5188` pode travar em telas que leem `modelos` pelo tempo da
    suíte (dezenas de segundos), não só ~3 s; na produção cada arquivo segura a trava < 1 s (500 ms/3 s). Gatilhos comuns
    usam `CREATE OR REPLACE TRIGGER` (sem `DROP` antes; não vale p/ CONSTRAINT TRIGGER). Nada de probe fora disso.
- ⛔ NUNCA `\i` de migration em transação de teste (incidente 15/set). ⛔ NUNCA DDL em transação de teste contra produção
  (incidente 23/set). O harness (`tests/integration/integracao-helpers.ts`) chama `exigeBancoLocal()` antes de qualquer SQL.
- TODO vitest: `export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres` EXPLÍCITO (o fallback de
  `tests/integration/db.ts` é PRODUÇÃO — incidente 24/set), caminhos de arquivo LITERAIS na linha de comando (lista vazia =
  suíte inteira — incidente 25/set), `--no-file-parallelism`, e antes `ps -Ao pid,command | grep -E "[v]itest|[p]laywright"`
  vazio (a cópia é compartilhada: um por vez). PROIBIDO rodar `tests/integration` inteiro.
- Migrations `supabase/migrations/20261007{10,11,12,13,14,15}0000_integracao_{1_tabelas,2_retrato,3_estados,4_trava,
  5_salvar,6_api}.sql` e inversos `supabase/rollback/<mesmo nome>_down.sql`. Cada arquivo:
  `SET client_encoding = 'UTF8';` antes do `BEGIN;` → 1 `BEGIN;` e 1 `COMMIT;` em linha própria →
  `SET LOCAL lock_timeout = '500ms';` e `SET LOCAL transaction_timeout = '3s';` logo depois do `BEGIN;` → `DO $guarda$`
  → corpo idempotente (`IF NOT EXISTS`, `CREATE OR REPLACE`, `CREATE OR REPLACE TRIGGER` p/ gatilho comum — N1: sem o
  `DROP` que pega trava exclusiva —; `DROP TRIGGER IF EXISTS` + `CREATE CONSTRAINT TRIGGER` só p/ os CONSTRAINT) →
  `DO $pos$` → `NOTIFY pgrst, 'reload schema';` → `COMMIT;`. NENHUMA DDL de policy (as tabelas novas não têm policy).
- Função EXISTENTE redefinida (4): `pg_get_functiondef` antes/depois diff-validado (o depois = o antes + SÓ os trechos
  deste plano, conferido por teste); guarda de md5 do "antes" na ida; o inverso recoloca o texto do "antes" GERADO do banco
  (`.superpowers/integracao/mig/dump_antes.sh`), nunca redigitado.
- Invariante #9: todo `_integracao_*`/`_salvar_precos_fixo_produto_importado_core` com
  `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated` (o `pg_default_acl` de `public` concede EXECUTE a anon/authenticated
  em função nova); as 3 da rota (`_integracao_ler`, `_integracao_confirmar`, `_integracao_limpar`) com
  `GRANT EXECUTE … TO service_role`; RPC pública com `REVOKE … FROM PUBLIC, anon` + `GRANT … TO authenticated`. Prova com
  `has_function_privilege`. Gatilhos `fn_*` seguem a convenção vigente (sem REVOKE).
- Mensagens: todo `RAISE … USING ERRCODE = 'P0409'` desta frente é SÓ ASCII (`integracao_mudou: …`,
  `conflito_versao: …`, `keywords_mudou: …`); a trava é `42501` com `integracao_travado: <campo>` (ASCII); validações
  `P0001` em PT. Nunca `P0002`. Teste por COMANDO com regex do Postgres usando `\y` (nunca `\b`).
- Contagens funções|gatilhos: NADA cravado — os scripts conferem o DELTA lido na hora: ida completa = **+46 funções |
  +14 gatilhos** (cópia hoje: 495|277; por migration: +1|+1, +15|0, +6|0, +6|+10, +5|+3, +13|0). [G-migration fix 2, 27/set:
  +1 gatilho `trg_pi_modelo_tenant` na m4 — os scripts reais da Task 8 já usam +46|+14; os blocos de código da Task 8 abaixo
  mostram o valor antigo e ficam como histórico.]

**Tela**
- Gates de todo commit: `bash .superpowers/integracao/gates.sh` → `GATES INTEGRACAO: ok` (tsc — o build NÃO checa tipos —,
  build, unit sem falha nova vs. linha de base — inclui o anti-drift de UI —, lista permitida, Dev intocado, sem
  `type="date"`, sem toast cru, `mig-txn.ts` intocado, nenhuma migration de outra frente).
- Padrões: editar = tela inteira com `<PageActionBar>` (Voltar · Salvar) + `useUnsavedGuard`/`UnsavedChangesGuard` +
  `<UnsavedIndicator>`; novo/config = Dialog; ação sensível = AlertDialog; erro = `mensagemErro`; cor só por
  token/primitivo (`StatusBadge`, `text-muted-foreground`, `text-destructive`, `bg-[var(--tone-warning-bg)]`); informação
  de campo = `InfoHover`; ícone lucide `className="h-4 w-4"`; ação em linha `size="iconSm"` (+ `max-sm:h-11 max-sm:w-11`);
  datas `dd/MM HH:mm` pelo fuso da loja (`useStoreTimezone`). Tema claro por padrão.
- Textos da tela: os do mockup aprovado, VERBATIM onde o plano os cita (ex.: "Você tem certeza? Se estiver errado, você
  poderá ser demitido").
- Celular (P-87, dono 27/set: "celular não vai ter essa tela"): em tela estreita (< 768 px, `useIsMobile`) o item
  "Integração" some do menu e a rota mostra só "A Integração é usada no computador" (sem dados, sem ações). Os selos/travas
  das OUTRAS telas valem no celular (360/390 sem rolagem horizontal da página).
- Nada grava antes do Salvar (staging), exceto: diálogos com botão próprio de gravar (Keywords, Campos da API,
  Configurações da API, chaves) e as ações de estado (integrar/voltar/desfazer), todos com confirmação.

**QA** — Playwright SÓ contra a CÓPIA: `E2E_BASE_URL=http://localhost:5199` no ensaio da rota real (Task 20b, ANTES do
RODAR) e `E2E_BASE_URL=http://localhost:5188` na QA (Task 25, DEPOIS da produção (dono) + merge + `copia.sh ida`, ANTES do
deploy); rodado do checkout principal com `--config` da worktree (o `.env` com `E2E_EMAIL`/`E2E_PASSWORD` é lido pelo
`playwright.config.ts` do cwd — ninguém abre o arquivo). Nunca `selectStore`; nunca matar/subir `:5173`/`:5188`. Dados de QA na CÓPIA pelo
CONTROLADOR pela tela do `:5188`, listados antes no painel ("QA não semeia banco"). ANTES do RODAR, a rota REAL da API roda
contra a CÓPIA num vite PRÓPRIO na `:5199` servindo esta worktree (Task 20b — só o próprio PID é derrubado).

**Processo** — SDD: implementador Sonnet por task (não despacha subagente), revisor Opus por task + `code-reviewer`;
portões G-migration (2 Opus INDEPENDENTES + guardião `guardiao-unificacao`), G-scripts, G-commit, G-deploy; avisos e
perguntas ao dono pelo PAINEL (P-xx com Copiar), nunca `ExitPlanMode`. SQL/TS/bash deste plano NÃO foi executado pelo
planejador: erro de sintaxe/formato ⇒ corrigir o MÍNIMO e registrar em `.superpowers/integracao/desvios.md` (erro literal,
causa, correção); diferença de RESULTADO ou de regra de negócio ⇒ PARE e chame o controlador.

---

## 1. Fatos verificados (26/set, só leitura — worktree, checkout principal e cópia `:54422`)

- Última migration aplicada: `20261006120000_sku_previa_mensagens_ascii.sql` (a `20261001100000_aviso_global.sql` da
  frente em STANDBY é mais antiga e não é tocada). Nomes `integracao*` livres (`pg_class`/`pg_proc` = 0). Cópia: 495|277.
- `modelos`: `nome varchar NOT NULL`, `ref varchar`, `ref_auto`, `preco_anterior`, `preco_venda`, `preco_atacado`,
  `peso_kg`, `ncm text`, `titulo_pagina`, `descricao_produto`, `comprimento_cm`/`largura_cm`/`altura_cm` (CHECK ≥ 0),
  `fotos_modelo text[]`, `tamanho_tipo text DEFAULT 'letra'` (CHECK letra|numero), `origem` (interno|revenda|importado),
  `status_planejamento`, `status_desenvolvimento`, `ordem_criacao_enviada`, `enviado_cad`, `lancado`, `colecao`,
  `colecao_id → colecoes(nome)`, `rev int`. Cópia: interno 214 · revenda 57 · importado 1.
- Gatilhos BEFORE UPDATE de `modelos` (ordem alfabética): `trg_colab_rev`, `trg_kanban_status_guard`,
  `trg_modelo_markup_congela`, `trg_modelo_mo_flag`, `trg_modelo_preco_venda_gate`, `trg_modelo_ref_auto` → o novo
  `trg_zz_integracao_trava` fica por ÚLTIMO. Não há BEFORE DELETE em `modelos`. `modelo_skus` tem só
  `trg_modelo_skus_unico`; RLS de `modelo_skus` só tem SELECT por loja + modgate RESTRICTIVE (escrita só por RPC).
- `modelo_skus(modelo_id, variante_key uuid, tamanho_key text, sku, manual, rev)` UNIQUE (modelo_id, variante_key,
  tamanho_key); FK `modelo_id` ON DELETE CASCADE; `variante_key` = `_sku_variante_key(cor_id, cor_apelido_id)` (md5, sem FK).
- Sublinhas: `_skus_calc_ref_tipo(_modelo_id, _ref, _tipo)` (STABLE DEFINER) devolve 1 linha por variante × tamanho com
  grade > 0 (`variante_key, variante_ordem, cor_nome, apelido_nome, tamanho_key, tamanho_ordem, sku(previsto), faltas,
  avisos`) nas 3 origens (Tecido 1 no interno; `produto_*_variantes` no comprado; grade em `modelo_grades` por
  `variante_numero = ordem`); com `sku_config` NULL devolve as linhas com `sku` NULL (sem erro). Rótulo do tamanho =
  `_sku_tamanho_lado(tamanho_key, tipo)` ("38|P" → "P" em letra, "38" em número).
- Custo: `_custo_unitario_modelos_core(uuid[])` (DEFINER, usa `get_user_tenant_id()`) → `{previsto, real, confirmado,
  mao_obra_*}` por modelo; o Sheet usa `confirmado ? real : previsto>0 ? previsto : estimado`
  (`custo-base.ts:14-20`). `_pode_ver_custos()` = qualquer seção de custo ou admin.
- `user_can_view/edit(p)` já dão passe a super/admin/tenant_admin. `is_tenant_admin()` = role `tenant_admin`.
  `tenant_module_enabled(m)`: chave ausente = ligado, exceto a lista opt-in (`otb, produto_acabado, produto_importado,
  distribuicao`) — `integracao` NÃO entra nela (não é contratável).
- Preço de revenda/importado: `_pa_recomputar_precos_modelo` (md5 `72c96c624de8f4530c862d8abb6a1283`) e
  `_imp_recomputar_precos_modelo` (md5 `5baca24d0de45b8c5f291fef39472238`) gravam `modelos.preco_atacado`/`preco_venda` =
  fixo ?? base × markup ?? NULL. O gravador do fixo da revenda (`_salvar_precos_fixo_produto_acabado_core`, wrapper sem
  gate extra) zera o markup do canal e recalcula. `produtos_importados.preco_*_fixo` existem e ninguém os grava;
  `_salvar_produto_importado_core` (md5 `47584858f55524d18d326dfff00139e6`) grava o markup SEM limpar o fixo e NÃO toca
  `modelos`; `_salvar_produto_acabado_core` limpa o fixo com markup (:170-171) e copia nome/categorias para `modelos`
  (:179-186); os dois apagam e recriam as variantes em todo save.
- Fotos: `modelos.fotos_modelo` = caminhos `<tenant>/<pasta>/<uuid>-<nome>` no bucket `modelos` (upload por
  `uploadFile` de `src/components/planejamento/modelo-shared.ts:36`). `trg_sync_foto_modelo_acabado`/`_importado` =
  `AFTER INSERT OR UPDATE OF foto_url, modelo_id` → `_sync_foto_modelo_do_produto()` põe `foto_url` como capa
  (`_foto_modelo_com_capa`) — sem `WHEN`, roda em todo save do PA/PI.
- Exclusão do espelho: `_excluir_produto_acabado_core`/`_importado_core` apagam só o produto (FK `modelo_id` ON DELETE SET
  NULL). Sem unicidade nem formato em `produtos_*.ref` (réplicas dividem a REF por desenho).
- `_seed_tenant_defaults(uuid)` (md5 `01bd241680e24fdb665ca8ae81a6a1a3`) é chamada por `reset_loja` (depois do
  `_wipe_tenant_core`, que apaga TODA tabela com coluna `tenant_id` sob `session_replication_role=replica`, exceto
  `tenant_config/users/user_permissions`) e pela criação de loja.
- `tenant_config.keywords text` existe (0 lojas preenchidas na cópia); UPDATE só `is_tenant_admin()` da loja ou super.
- REF: `refEditavel = isEdit && !devBloqueado && kanbanCard.refVisivel` (`PlanejamentoDetail.tsx:748`); `refVisivel` =
  `ordem_criacao_enviada` E `_ref_exibir_gate(tenant, _kanban_status_gate(tenant, id, status_desenvolvimento))`
  (`useFichaKanban.ts:85-95`, espelho SQL). Rótulo da etapa: `_kanban_status_rows(tenant)` (`ord, key, lbl`).
- `pgcrypto` em `extensions` (`hmac`, `digest`, `gen_random_bytes` ok na cópia).
- Rota de servidor: molde `src/routes/sitemap[.]xml.ts` (`server.handlers.GET`, handler `({ request }) => Response`);
  service role em `src/integrations/supabase/client.server.ts` (import dinâmico dentro do handler).
  `wrangler.jsonc` sem binding; o schema do wrangler 4.105 aceita `ratelimits: [{name, namespace_id, simple:{limit,
  period: 10|60}}]` (não herdado por `env.staging`).
- `tests/integration/mig-txn.ts` (compartilhado, NÃO editar): `aplicarSql(c, sql, nome)` (exige a cópia; tira
  `BEGIN;`/`COMMIT;`; SAVEPOINT), `exigeBancoLocal()`. `tests/integration/db.ts`: `withTx`, `comoUsuario`, `um`,
  `TENANT_TESTE` (Loja Teste `37889b78-…`, 17 modelos, `sku_config` configurado, 12 variantes de tecido com cor),
  `USER_TESTE` (super admin), `ehBancoLocal`. Ave Rara `20c84a36-…` tem 250 modelos (medição de desempenho).
- Sidebar: itens de módulo = `PAGES_CATALOG` filtrado; módulo sem `PAGE_URLS` vira link direto; "Admin Mestre" só
  `isSuperAdmin` (`app-sidebar.tsx:298-321`); `admin/lojas.tsx:56-58` exclui `importar` dos toggles.
- Deep link do card: `/criacao/planejamento?modelo=<id>` (`criacao.planejamento.tsx:74`, `:166-168`).
- `:5188` (app de teste) serve o CHECKOUT PRINCIPAL (`banco-local/app-teste/subir-app-5188.sh`, `REPO=…/plm-pcp`) com o
  `wrangler.jsonc` próprio da pasta app-teste (sem o binding novo — o código tolera a ausência). A config
  `banco-local/app-teste/vite.config.local-copia.mjs` fixa `REPO`/`PORTA 5188` e tem a guarda anti-produção (aborta se alguma
  URL do Supabase não for local) — a Task 20b usa uma cópia dela com `REPO`=esta worktree e `PORTA 5199`.
- **Base nova (27/set):** a implementação nasce de `feature/plan-tecido-a1` @ `338d5433`. De `e6bdfdde` (base da
  `integracao/desenho`) até ela mudaram 8 arquivos de `src/` (fix "salvar rápido" P-57): `PlanejamentoDetail.tsx`,
  `CqPosView.tsx`, `kanban-auto-config.ts`, `admin/configuracoes.tsx`, `expedicao.cq.$modeloId.tsx`,
  `expedicao.direcionamento.$modeloId.tsx`, `pcp.oficina.$modeloId.tsx`, `pcp.servicos.$modeloId.tsx`. Deles, o plano só
  edita `PlanejamentoDetail.tsx` (Task 21) — todas as âncoras dele (e dos demais arquivos tocados: `usePlanejamentoSave.ts`,
  `admin/lojas.tsx`, `app-sidebar.tsx`, `criacao.planejamento.tsx`, `InfoGeraisSecao.tsx`, `PrecoTabela.tsx`,
  `RevendaSetores.tsx`, telas PA/PI, Plan. Tecido, `erro-mensagem.ts`, `permissions-catalog.ts`, `nav.ts`) foram conferidas em
  `338d5433` (`PlanejamentoDetail.tsx:748` segue `const refEditavel = …`; `lojas.tsx:58` segue `if (key === "importar")
  continue;`; Admin Mestre em `app-sidebar.tsx:301`). `configuracoes.tsx`, CQ, PCP e Direcionamento não são tocados.
- `salvar_produto_importado(_id, _dados, _variantes, _etapas, _rev_base)` confere o `rev` (`FOR UPDATE`, P0409) e chama o
  `_salvar_produto_importado_core` na MESMA transação; `trg_colab_rev_prod_importado` (BEFORE UPDATE) sobe o `rev` a cada
  UPDATE; `_limpar_produto_importado_core` zera os markups mas NÃO o preço fixo (cópia, só leitura).
- Molde `sku-previa/.superpowers/sku-previa/mig/aplica.sh`: linha 49 = `}` (fim do `aplica_v2`), 50 = comentário da frente
  SKU; 63 `DBURL_FILE…`, 67 `confere_url_producao() {`, 84 `le() `, 158 `backup_banco() `, 219 `}`, 220 `confere_base() `.

## 2. Decisões do plano (o spec não fixava; registradas com o porquê)

| # | Decisão | Por quê | O dono precisa saber? |
|---|---|---|---|
| D1 | Branch `integracao/impl` numa worktree NOVA `integracao-impl`, a partir de `feature/plan-tecido-a1` @ `338d5433` (linha principal atual) + commit com spec e plano trazidos da `integracao/desenho`; `node_modules` por symlink ao checkout principal | A `integracao/desenho` nasceu de `e6bdfdde`, 19 commits atrás (sem o fix P-57 que a F4 toca); o desenho só tem docs | não |
| D2 | 6 migrations (tabelas · retrato/leitura · estados/log · trava · salvar/mão dupla · API) aplicadas JUNTAS em produção pelo dono, ANTES de juntar a tela | Cada uma revisável sozinha; a tela chama RPCs novas | não |
| D3 | Espelho e registros usam a coluna `tenant_id` (= `loja_id` da API) | `_wipe_tenant_core`/reset dependem do nome `tenant_id` | não |
| D4 | Valores do retrato = TEXTO: preços 2 casas com ponto ("179.90"), peso 3 casas ("0.310"), medidas sem zeros à direita ("68"), ≤ 0 ou vazio = `null`; `tipo` = `"produto"`/`"variante"` | Formato estável p/ o parser do dev; "0" nunca conta como preenchido | não |
| D5 | Coluna "Foto" = UMA coluna em `colunas`; na linha do produto o valor é a LISTA de links na ordem do card (Foto 1..N); nas sublinhas `[]`; arquivo ausente ou de outra loja = `null` na posição | Concilia P-67 A ("Foto 1..N no fim") com o mockup aprovado (1 coluna "Foto", 18 colunas) | **sim** |
| D6 | `colunas` de uma página = UNIÃO dos campos dos retratos dela, na ordem fixa; produto cujo retrato não tem o campo manda `null` | Mudar os campos vale só p/ as próximas integrações (retrato antigo não muda) | **sim** |
| D7 | Sublinhas = matriz variante × tamanho com grade > 0 (a mesma do SKU) + o SKU GRAVADO (nunca o previsto); SKU órfão fica fora | Fonte única com a seção Códigos; o previsto não foi conferido por ninguém | não |
| D8 | Custo = `confirmado ? real : previsto` de `_custo_unitario_modelos_core`; ≤ 0 = falta ("o estimado não conta") | Mesmo número do Sheet sem a estimativa (spec §3 #7) | não |
| D9 | Reprovado = `status_planejamento='reprovado'` OU `status_desenvolvimento='reprovado'` (some da lista, salvo integrado; marcar recusa) | P-61 A / P-74 A sem definição de campo | **sim** |
| D10 | Assinatura = HMAC-SHA256 do `retrato::text` com segredo global (`integracao_segredo`, 1 linha, sem policy); marcar NÃO compara `modelos.rev` | A assinatura cobre os campos; o `rev` muda com BOM/CAD e daria falso conflito | não |
| D11 | Variantes do espelho (nota 14): CONSTRAINT TRIGGER adiado ao COMMIT compara o CONJUNTO de cores (cor+apelido) com o gravado no marcar — apagar/recriar igual passa, qtd/peso livres; nenhum gravador existente muda | Recusa só mudança REAL sem mexer nos saves do PA/PI | não |
| D12 | Preço fixo explícito recusado por gatilho em `produtos_*.preco_varejo_fixo` (só quando DEFINE um valor novo); limpar o fixo (markup editado) passa e o preço de venda segue congelado. `_salvar_precos_fixo_produto_acabado_core` NÃO é redefinida | V1 (gravador compartilhado intacto) + delta item 4 (recusa explícita) | não |
| D13 | Mão dupla de nome/REF por GATILHOS: `modelos → produtos_*` e `produtos_* → modelos` (AFTER UPDATE OF nome, ref; só quando mudou; REF só valor não vazio). A REF que vem do ESPELHO para o card só é copiada enquanto o card deixaria mudar a REF — mesma régua do `refEditavel`: ANTES do envio à Explosão (`NOT modelos.enviado_cad`); depois não propaga (os SKUs guardam a REF do card — R2 do G-plano do plano). **P-88 A:** sem interruptor — vale a partir da IDA ao banco (o RODAR avisa: efeito no app já no ar) | Um só mecanismo p/ todos os editores; sem loop (guarda "mudou") | **sim** (P-88 A respondida): renomear no Sheet/Integração um comprado COM OC renomeia também na tela PA/PI, já depois da IDA |
| D14 | Preço do importado = preço FIXO exato ("última edição manda"), em 3 caminhos, todos no SALVAR de quem edita: (a) tela Importado → `_salvar_produto_importado_core` aceita `preco_atacado_fixo`/`preco_varejo_fixo` no `_dados` (fixo zera o markup do canal; markup sem fixo limpa o fixo; sem os dois, o fixo fica), na MESMA transação do `_rev_base` do wrapper (R1 do G-plano do plano — nada grava no blur); (b) Sheet (n1) e (c) `integracao_salvar` → gravador novo `salvar_precos_fixo_produto_importado` (espelha o da revenda: auth + loja + módulo `produto_importado`; sem checagem de `:preco_venda` — V1/D1) dentro do Salvar deles; o card do Plan. Produto (n2) grava na hora, como já faz com a revenda (N8: vai para o inventário da Camada intermediária) | B1a/n1/n2/N13 + regra do dono "nada grava antes do Salvar" | **sim**: na tela Importado o preço digitado vira preço exato (sem "298→297,84") e só grava no Salvar. **Diferença do Produto Acabado (n-a do r2):** no Importado, APAGAR o Valor com o markup também vazio NÃO apaga o preço — o fixo fica e volta a aparecer depois do Salvar (no PA, apagar limpa o fixo na hora); para voltar ao cálculo pelo markup, digite o markup. Se o dono quiser o comportamento do PA, o `_dados ? 'preco_varejo_fixo'` (chave presente com vazio) passa a limpar o fixo — mudança pequena na Task 5, antes do G-migration |
| D15 | SKU na Integração = só SKU à mão (sem Regerar, sempre modo `manuais`); a prévia `skus_previa` roda ao digitar e mostra conflito/erro na célula; o Salvar (passo 3, DEPOIS de gravar a REF no passo 2) refaz a prévia da MESMA entrada e aplica com a assinatura dela — com erro/conflito, os SKUs daquele produto não gravam (o resto do Salvar fica) e a célula mostra o motivo | Mesmo caminho da seção Códigos; Regerar fica no card | não |
| D16 | Keywords grava pelo "Salvar" do próprio diálogo (mockup 6c), por `integracao_salvar(_keywords)` com conferência do valor carregado | É um diálogo de gravação explícita; muda TODOS os produtos | não |
| D17 | Chave = `wish_live_` + 32 caracteres base64url gerados no banco (`gen_random_bytes(24)`); só o SHA-256 (hex) é guardado; mostrada 1× | Spec §5 (devolve 1×); o Worker compara só o hash | não |
| D18 | O bloqueio por IP vale SÓ para chave errada/revogada: N tentativas erradas do mesmo IP em 10 min (N = o MENOR `bloqueio_tentativas` entre as lojas, padrão 10 — a loja é desconhecida) ⇒ 429 para chaves erradas desse IP; a chave VÁLIDA nunca é bloqueada por IP (192 bits tornam força bruta inviável; um IP compartilhado não derruba o ERP de outra loja — revisto no G-plano do plano) | Único limite possível sem loja; protege sem efeito colateral | **sim** |
| D19 | Registros agregados (chave errada, IP bloqueado, 429, loja inativa) = 1 linha por (tipo+IP/chave, minuto) com contador (`agregado`+`minuto`, índice único parcial); não contam no limite | R11/R7 sem crescer 1 linha por tentativa | não |
| D20 | Limpeza de 90 dias em `_integracao_limpar(tenant)` chamada pela rota DEPOIS de montar a resposta (`waitUntil` do Workers quando disponível), ≤ 500 linhas, só da loja da chave (ou das linhas sem loja quando a chave é inválida) | n4: fora do caminho crítico e com escopo | não |
| D21 | Cursor = base64 de JSON (`{"depois":"<id>"}`; teste `{"exemplo":2}`), paginação por `integracao_produtos.id` | Estável enquanto produtos viram integrados | não |
| D22 | Modo teste: 4 produtos fictícios em 2 páginas; foto = arquivo PÚBLICO do site `/integracao/exemplo-produto.svg` (n3); "Ver resposta de exemplo" usa a mesma função com foto `null` | P-82 A + N12 | não |
| D23 | Teto do Workers = binding `ratelimits` `INTEGRACAO_TETO_IP` 600/60 s por IP (produção e staging); ausente = sem teto | R7 (≥ 600) sem config na tela | não |
| D24 | Gates por campo numa função SQL (`_integracao_gates`) usada pela lista (célula só leitura + motivo) e pelo `integracao_salvar` (recusa): nome/fotos = Planejamento OU Dev antes da Explosão; descrição/peso/NCM/título/medidas = Planejamento (descrição: decisão do dono 27/set — igual ao card; G-migration fix 5, 0ba6487b); preço de venda/anterior = Planejamento + `:preco_venda`; REF = Dev + revelada + não enviada à Explosão (sem o "Editar" do Sheet); SKU = Planejamento; Keywords = admin da loja/super; sempre `integracao` editar + módulo `criacao` + módulo da origem | R2/V1/n5 sem espelho TS (sem deriva) | não |
| D25 | `integracao_config` semeada nas lojas atuais (migration 1) e por `_seed_tenant_defaults` (redefinida: +1 INSERT); a leitura tolera linha ausente (= padrão) | N9/n6 literal + defesa | não |
| D26 | `reset_loja` apaga toda a integração da loja (config volta ao padrão; chaves, acessos e log somem); o segredo HMAC é global e fica. Opção A do guardião + AVISO no diálogo de Reset de Gerenciar Lojas ("Apaga também a Integração da loja…") | É o reset da loja inteira; preservar log/acessos redefiniria `_wipe_tenant_core` (mais risco) | **sim** (opção A) |
| D27 | Desfazer só de produto INTEGRADO (integrável volta pelo toggle); motivo ≥ 3 caracteres | P-63 A / spec §4 | não |
| D28 | "Voltar" não pede motivo (o diálogo aprovado não tem campo); o Log registra "Voltou para não integrável" | Mockup 3b aprovado | **sim** |
| D29 | Spec do E2E NÃO versionado (como a frente SKU); a QA roda no `:5188` depois de produção + merge + `copia.sh ida` | `:5188` serve o checkout principal | não |
| D30 | Rota `src/routes/api.integracao.v1.produtos.ts`; o handler vem de `src/lib/integracao/api/rota.server.ts` por import dinâmico | O bundle do navegador não leva o service role | não |
| D31 | `integracao` = `ModuleDef` próprio no FIM do catálogo (item logo depois do Dashboard), fora dos toggles de Gerenciar Lojas; super admin tem também o item em "Admin Mestre" | P-65 A / P-74 A / nota 12 | não |
| D32 | Acesso do log de acesso (`integracao_acessos`) e das chaves nunca expõe o hash; o detalhe de `chave_*` leva só nome + final | N11 | não |
| D33 | **P-87 (dono 27/set):** o celular NÃO tem a tela Integração — em tela estreita (< 768 px) o item some do menu (loja e Admin Mestre) e a rota mostra só "A Integração é usada no computador"; os selos/travas das outras telas valem no celular | Decisão do dono | **sim** (respondida) |
| D34 | As outras telas espelham a trava do banco SÓ nos campos MARCADOS (P-62 A): Sheet interno/importado trava Preço de venda e Preço anterior um a um; na revenda trava Preço varejo + Markup varejo (quando Preço de venda está marcado) e Preço anterior; ATACADO e markup atacado ficam LIVRES (R8 do G-plano do plano); "Limpar slot" do Plan. Tecido travado (limparia nome/REF/preço); card do Plan. Produto só trava o preço | O banco trava por campo; a tela nunca libera o que o banco recusaria nem trava além | não |
| D35 | Importado: "Limpar card" também zera os preços fixos (os 2 canais) | Senão o preço fixo sobreviveria ao card limpo | não |
| D36 | Aba Produtos com rascunho aberto: filtros, Situação e página ficam travados ("Salve ou descarte…"); trocar de ABA pede "Descartar alterações?" (1 guarda só na página — `useBlocker` único) | Nenhum rascunho fica escondido em outra página; 2 guardas brigariam pelo mesmo `useBlocker` | não |
| D37 | Selos/travas das outras telas: UMA consulta por loja (`integracao_estado_modelos(NULL)` = só integráveis/integrados, TETO de 5000 — os mais recentes; N5), cache compartilhado `["integracao-estado", loja]`, sem retry (antes da ida em produção cai em "sem trava") | Evita N consultas por card; nada de retrato/custo sai para quem não tem a permissão | não |
| D38 | **RESOLVIDA pela P-89 A (dono 27/set: "A — padrão 50, máximo 100 (plano gratuito)").** CPU do Worker (R4 + R4-r2): o plano gratuito do Cloudflare dá **10 ms de CPU por consulta**; a medição mínima do guardião (r2) deu p95 ≈ 4,5 ms (50), 13,8 ms (200) e 42,8 ms (500). Aplicado: "Máximo de produtos por página" com **padrão/semente/recomendado 50** (`DEFAULT` da migration 1, `_integracao_cfg`, `CONFIG_API` da Task 9); a **faixa do banco continua 1–500** (`integracao_config_pagina_chk` e a validação da migration 6 NÃO baixam) — aumentar depois é só mudar a configuração da loja na aba API, sem migration nem deploy; acima de **100** a tela mostra, além do "fora do recomendado", o alerta "Acima de 100 pode passar do limite de processamento do plano gratuito do Cloudflare (10 ms por consulta). Só use com o plano pago (Workers Paid)." (Tasks 9/15). A Task 20b mede 50/100/200/500 (fora do gate, só imprime) e o G-deploy (Task 25) confere o CPU REAL com a página padrão 50. Se no futuro o dono subir acima de 100: é a regra do alerta (só com Workers Paid) — e medir de novo. O G-deploy também confere que a conta aceita `ratelimits` (senão o binding sai — D23) | Um estouro de CPU derruba a página inteira da API | **respondida** (P-89 A) |
| D39 | A resposta da API traz `pagina: {limite, maximo}` (entre `gerado_em` e `linhas`): `limite` = quantos produtos por página ESTA resposta usou (o `limite` pedido cortado no máximo; sem `limite` = o máximo; no modo teste = 2, o tamanho das páginas de exemplo) e `maximo` = o "Máximo de produtos por página" da loja HOJE. Vem do `_integracao_ler`/`integracao_exemplo` (Task 6) e passa pelo `montarResposta` (Task 16; ausente = `null`); o Manual ensina a seguir o `proximo_cursor` e a ler `pagina.maximo` (Task 16) | P-89 A — "isso pode mudar depois … tem como já preparar isso?": o programa do dev se ajusta sozinho quando a loja mudar o máximo, sem versão nova da API | não (formato decidido no plano; vai no Manual) |
| D40 | Todo inverso que restaura uma função EXISTENTE (não criada por esta frente) a partir do dump "antes" leva um `$guarda$` que RECUSA (RAISE P0001 ASCII) a menos que a função ainda seja exatamente a versão instalada pela migration desta frente (md5 = "antes" OU "antes" + o TRECHO desta frente removido) — nunca sobrescreve em silêncio uma mudança feita por outra frente depois desta. Vale para as 3 funções: `_seed_tenant_defaults` (Task 1), `_pa_recomputar_precos_modelo`/`_imp_recomputar_precos_modelo` (Task 4) e `_salvar_produto_importado_core` (Task 5); cada inverso ganha um teste que simula a mudança alheia e confere a recusa | Revisão T1 #1 (Important #1, `.superpowers/sdd/2026-09-26-tela-integracao-api/task-1-review.md`): sem o guarda, um rollback de emergência rodado depois de outra frente mudar a mesma função apagaria essa mudança sem avisar — o `$pos$` só conferia o md5 FINAL, não se havia algo a mais gravado no meio | não |

## 3. Mapa de arquivos

| Arquivo | Responsabilidade | Task |
|---|---|---|
| `.superpowers/integracao/**` (não versionado) | `regras.md`, `permitidos.txt`, `desvios.md`, `gates.sh`, `n3.sh`, `copia.sh`, `unit-fail-base.txt`, `molde/`, `mig/{dump_antes.sh,antes/,aplica.sh,extra.sh,monta-aplica.sh,ensaio-local.sh,ida-producao.sh,volta-producao.sh,ref-volta-f1.sh,prova-scripts.sh}`, `vite.config.copia-5199.mjs`, `rota-real.sh`, `copia-estado.md`, logs | 0, 1, 8, 20b, 25 |
| `supabase/migrations/20261007100000_integracao_1_tabelas.sql` + `supabase/rollback/…_down.sql` | 7 tabelas, `_integracao_layout`, semente da config, `_seed_tenant_defaults` (+1 INSERT) | 1 |
| `supabase/migrations/20261007110000_integracao_2_retrato.sql` + inverso | retrato, HMAC, máscara, gates, base da lista, `integracao_previa/listar/estado_modelos/config_ler` | 2 |
| `supabase/migrations/20261007120000_integracao_3_estados.sql` + inverso | log, `integracao_marcar/voltar/desfazer/log_listar` | 3 |
| `supabase/migrations/20261007130000_integracao_4_trava.sql` + inverso | gatilhos de trava, foto com `WHEN`, recálculos B1 | 4 |
| `supabase/migrations/20261007140000_integracao_5_salvar.sql` + inverso | mão dupla nome/REF, fixo do importado, `_salvar_produto_importado_core`, `integracao_salvar` | 5 |
| `supabase/migrations/20261007150000_integracao_6_api.sql` + inverso | config/chaves/acessos/exemplo, `_integracao_ler/_confirmar/_limpar` | 6 |
| `tests/integration/integracao-helpers.ts`, `tests/integration/integracao-{1..7}-*.test.ts` | harness (aplica na txn, só cópia) + suítes por migration + ACL/ASCII/voltas | 1–7 |
| `src/lib/integracao/campos.ts`, `src/lib/integracao/abas.ts` | catálogo dos 18 campos + config da API (faixa/recomendado) + seleção da aba Campos; abas por papel | 9, 14 |
| `src/lib/erro-mensagem.ts` | tradução das recusas (`integracao_*` por `code`/prefixo ASCII) | 9 |
| `src/lib/permissions-catalog.ts`, `src/lib/nav.ts`, `src/components/app-sidebar.tsx`, `src/routes/_authenticated/admin/lojas.tsx` | permissão/menu (Admin Mestre), fora dos interruptores | 9 |
| `src/routes/_authenticated/integracao.tsx`, `src/components/integracao/IntegracaoPage.tsx`, `src/components/integracao/guard.ts` | rota, abas por papel, guarda única de "não salvo" | 9, 11–17 |
| `src/lib/integracao/produtos.ts`, `src/lib/integracao/rascunho.ts`, `src/lib/integracao/celula.ts` | leitura da lista (retrato × vivo, motivos), rascunho por produto (merge 3-vias, payload), decisão editar × ler | 10, 12a |
| `src/components/integracao/{salvar-integracao.ts,useIntegracao.ts}` | Salvar em 3 passos (puro); hooks de dados, Realtime, dependências reais | 11 |
| `src/components/integracao/{CelulaCampo,ProdutosTabela}.tsx` | células (editar × ler, SKU, conflito) e tabela com sublinhas | 12a |
| `src/components/integracao/{ProdutosAba,FotosDialog,KeywordsDialog}.tsx` | aba Produtos (filtros, paginação, staging, merge, Salvar, fotos, Keywords) | 12b |
| `src/lib/integracao/resumo.ts`, `src/components/integracao/{EstadoLinha,IntegrarDialog,VoltarDialog,DesfazerDialog}.tsx` | estados (resumo do dado salvo, integrar/voltar/desfazer, massa) | 13 |
| `src/components/integracao/CamposAba.tsx` | Campos da API (super admin) | 14 |
| `src/lib/integracao/api-tela.ts`, `src/components/integracao/{ApiAba,NovaChaveDialog}.tsx` | Chaves, Acessos, Configurações da API | 15 |
| `src/lib/integracao/api/resposta.ts`, `src/components/integracao/{manual-conteudo.ts,ManualAba.tsx,ExemploDialog.tsx}` | contrato + montagem da resposta; Manual + exemplo | 16 |
| `src/lib/integracao/log.ts`, `src/components/integracao/LogAba.tsx` | Log por papel | 17 |
| `src/routes/_authenticated/integracao.tsx`, `src/components/integracao/AvisoComputador.tsx`, `src/components/app-sidebar.tsx` | P-87: sem tela no celular (aviso + item escondido) | 18 |
| `src/lib/integracao/api/{parametros,rota}.ts` | handler PURO da API | 19 |
| `src/lib/integracao/api/rota.server.ts`, `src/routes/api.integracao.v1.produtos.ts`, `public/integracao/exemplo-produto.svg`, `wrangler.jsonc`, `src/routeTree.gen.ts` | rota real + teto por IP | 20 (routeTree também 9) |
| `tests/carga/integracao-api-carga.test.ts` (fora do gate, só imprime) + `.superpowers/integracao/{vite.config.copia-5199.mjs,rota-real.sh}` + `tests/e2e/integracao-rota-real.spec.ts` (NÃO versionar) | CPU da rota por tamanho de página (R4/R4-r2/R10) e ensaio da rota REAL contra a cópia (R3) | 20b |
| `src/lib/integracao/trava.ts`, `src/hooks/useIntegracaoEstado.ts`, `src/components/integracao/SeloIntegracao.tsx` | selo + colunas travadas (F4) | 21 |
| `src/components/planejamento/PlanejamentoDetail.tsx`, `src/components/planejamento/planejamento-detail/{InfoGeraisSecao,PrecoTabela,RevendaSetores}.tsx` | Sheet do Planejamento espelha a trava (só campos marcados — D34) | 21 |
| `tests/unit/{planejamento-codigos,planejamento-permissao-secao-fonte}.test.ts` (EXISTENTES — 1 linha cada) | testes de fonte que citam o texto antigo de `podeEditarSkus` e do `disabled={planBloqueado}` da revenda | 21 |
| `src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts`, `src/routes/_authenticated/criacao.planejamento.tsx` | n1 / n2 + trava do preço no card | 22 |
| `src/components/produto-acabado/ProdutoCard.tsx`, `src/components/produto-importado/{ProdutoImportadoCard.tsx,shared.ts,ProdutoImportadoSheet.tsx}` | telas PA/PI (selo, trava, preço fixo do importado NO SALVAR — D14/D35) | 23 |
| `src/components/plan-tecido/{ModelCard,CustoSection}.tsx` | selo e trava no Plan. Tecido | 24 |
| `CLAUDE.md` | invariante #14 | 25 |
| `tests/unit/integracao-*.test.ts`, `tests/unit/erro-mensagem-integracao.test.ts` | unit por task (anti-drift de campos, fonte das telas) | 9–24 |
| `tests/e2e/integracao-qa.spec.ts` (NÃO versionar; em `permitidos.txt`) | QA na cópia | 25 |

## 4. Portões e ordem

| Momento | Portão |
|---|---|
| Antes da Task 0 | **G-plano** (guardião) sobre este plano |
| Antes da Task 1 | ~~P-xx da D38 ao dono~~ — **RESOLVIDO pela P-89 A** (padrão 50; alerta acima de 100; faixa 1–500): já aplicado nas Tasks 1, 2, 6, 9, 15, 16 e 19 antes do G-migration |
| Tasks 1–6 | revisão Opus por task (banco) |
| Task 7 | **G-migration**: 2 revisões Opus INDEPENDENTES (cada uma recebe spec + plano + 12 SQL + suítes; não vê a outra) + guardião. Checklist no Step 6 da Task 7 |
| Task 8 | **G-scripts** (Opus + guardião: ensaio real, provas com `psql`/`pg_dump` falsos, RODAR). Depois o DONO roda produção |
| Tasks 9–20 | revisão Opus por task + `code-reviewer` (Tasks 11, 12a, 12b, 13, 19, 20: revisão individual — colaboração/segurança) |
| Task 20b | rota REAL contra a CÓPIA + CPU (R3/R4) — defeito ⇒ reabre o G-migration ANTES do RODAR; resultado da CPU ⇒ D38 |
| RODAR | o DONO roda produção (Task 8 Step 8) — só depois do G-scripts E da Task 20b verde |
| Tasks 21–24 | revisão Opus por task + `code-reviewer` (21, 22, 23: revisão individual — dinheiro/trava); não esperam o RODAR |
| Task 25 | **G-commit** (antes do merge), QA, **G-deploy** (guardião) → 2º deploy (dono) |

BLOQUEIA ⇒ parar. APROVA COM RESSALVAS ⇒ resolver/registrar antes do passo seguinte.
Ordem: G-plano → T0 → (P-89 A já aplicada no plano) → T1…T6 (série, mesma worktree) → T7 (G-migration) → T8 (scripts + ensaio + G-scripts) → T9 … T20
(tela e API, em série na worktree) → T20b (rota real contra a CÓPIA + CPU) → só então o RODAR vai ao dono (produção, no
horário dele). T21 … T24 seguem na worktree sem esperar o RODAR; a T25 (juntar, QA, deploy) exige o "== IDA OK". Nada é
JUNTADO na linha principal antes do "== IDA OK" (a tela chama RPCs novas e o `:5173` do dono grava em produção).
Os números seguem os do plano b0c22294 (a T12 virou T12a/T12b; a antiga T18 de celular virou a T18 da P-87; a T20b é nova).

## 5. Regras normativas (valem para o SQL e para o TS — o anti-drift compara)

**Campos (ordem fixa, P-60 B).** `key → rótulo (API e tela)`:
`nome` Nome · `ref_sku` REF / SKU · `preco_anterior` Preço anterior · `preco_venda` Preço de venda · `peso` Peso ·
`ncm` NCM · `preco_custo` Preço de custo · `cor_base` Cor base · `cor_apelido` Cor apelido · `tamanho` Tamanho ·
`titulo` Título para a página · `descricao` Descrição · `keywords` Keywords · `metatag` Metatag Description ·
`comprimento` Comprimento · `largura` Largura · `altura` Altura · `foto` Foto.
Padrão da loja = os 17 primeiros (layout); `foto` nasce desmarcada (P-83 A). Desmarcar um dos 17 = alerta do layout.

**Fonte por campo** (linha do produto | sublinha): nome = `btrim(modelos.nome)` | nome + " " + rótulo do tamanho;
ref_sku = `btrim(modelos.ref)` | SKU GRAVADO; preco_anterior/preco_venda = `modelos.*` 2 casas | idem produto; peso =
`peso_kg` 3 casas | idem; ncm = `btrim(ncm)` | idem; preco_custo = D8 2 casas | idem; cor_base/cor_apelido/tamanho = `null`
| `cores.nome` / `cores_apelido.nome` (sem apelido = `null`, NÃO é falta — P-74 A) / `_sku_tamanho_lado`; titulo =
`titulo_pagina`; descricao e metatag = `descricao_produto`; keywords = `tenant_config.keywords`; medidas = `*_cm` sem
zeros à direita; foto = `fotos_modelo` (só na linha do produto; sublinha `[]`).

**Faltas (marcado = obrigatório).** Campo de produto marcado com valor `null` ⇒ falta (texto = rótulo; `ref_sku` = "REF";
`preco_custo` = "Preço de custo (o estimado não conta)"). Sublinhas: com `ref_sku`/`cor_base`/`cor_apelido`/`tamanho`
marcado e 0 sublinhas ⇒ "variantes cor × tamanho"; SKU marcado e sublinha sem SKU ⇒ "1 variante sem SKU (<cor>, tam.
<tam>)" ou "N variantes sem SKU (ex.: <cor>, tam. <tam>)"; cor base marcada e sublinha sem cor ⇒ "N variante(s) sem cor
base"; tamanho marcado e rótulo vazio ⇒ "N variante(s) sem tamanho". Foto marcada: 0 fotos ⇒ "Foto do Modelo"; caminho
fora de `<tenant_id>/` ⇒ "foto de outra loja".

**Retrato (jsonb canônico).** `{"v":1,"campos":[…ordem fixa],"linhas":[{"tipo":"produto","ordem":0,"valores":{…},
"fotos":[…]}, {"tipo":"variante","ordem":1..N,"variante_key":…,"tamanho_key":…,"valores":{…},"fotos":[]}]}` — `valores`
tem TODAS as chaves marcadas exceto `foto`. Máscara de custo = `valores.preco_custo := null` em todas as linhas.

**Estados** `nao_integravel` (sem linha ou linha com esse estado) → `integravel` (marcar) → `integrado` (API confirmou) →
`nao_integravel` (voltar, só de integrável; desfazer, só super admin e só de integrado).

**Trava (§8).** Com o produto `integravel`/`integrado`: `modelos.tamanho_tipo` SEMPRE; e por campo marcado —
nome→`nome`; ref_sku→`ref`; preco_anterior; preco_venda; peso→`peso_kg`; ncm; titulo→`titulo_pagina`;
descricao/metatag→`descricao_produto`; comprimento/largura/altura→`*_cm`; foto→`fotos_modelo`. `modelo_skus` do produto:
SEMPRE (INSERT/DELETE e UPDATE com mudança real). `produtos_*`: DELETE e desvincular sempre; `nome` (nome), `ref`
(ref_sku), `foto_url` (foto), `preco_varejo_fixo` definido com valor novo (preco_venda). Variantes do espelho: conjunto
de chaves cor+apelido (D11). `modelos` DELETE sempre. Mensagem `integracao_travado: <campo>` (42501).

**Mensagens (texto da tela, `src/lib/erro-mensagem.ts`)**
- 42501 `integracao_travado: excluir` → "Produto travado pela Integração (integrável ou integrado). Volte para não
  integrável na tela Integração antes de excluir."
- 42501 `integracao_travado: <campo>` → `Produto travado pela Integração (integrável ou integrado): "<rótulo>" não pode
  mudar. Volte para não integrável na tela Integração (ou, se já integrado, peça ao super admin para desfazer).` —
  rótulos: os do catálogo + `tamanho_tipo` "Tamanho em", `sku` "SKUs", `variantes` "cores/variantes", `vinculo` "vínculo
  do produto", `produto` "produto".
- 42501 `integracao_sem_permissao: <campo>` → "Você não tem permissão para editar este campo (mesma regra do card do
  produto)."
- 42501 `integracao_sem_custo: …` → "Com \"Preço de custo\" marcado, só integra quem pode ver custos."
- P0409 `integracao_mudou: …` → "O produto mudou desde o resumo (outra pessoa editou, integrou ou voltou). Confira o
  resumo novo e confirme de novo."
- P0409 `keywords_mudou: …` → "Outra pessoa mudou as Keywords da loja enquanto você editava. O texto foi recarregado —
  confira e salve de novo."
- 42501 próprios (lista fechada `MENSAGENS_42501_PROPRIAS`): "Sem permissão para ver a Integração.", "Sem permissão
  para editar a Integração.", "Só o super admin pode fazer isto.", "Loja inativa ou sem loja — operação não permitida."

---

# FASE 0 — Trilhos

### Task 0: Worktree/branch de implementação, regras, lista permitida, gates e N3 (1 commit: spec + plano)

**Files:** versionados só o spec e o plano (trazidos da `integracao/desenho`); não versionados
`.superpowers/integracao/{regras.md,permitidos.txt,desvios.md,gates.sh,n3.sh,unit-fail-base.txt}`,
`.superpowers/integracao/{logs,molde,mig/antes}/` e o symlink `node_modules`.

**Interfaces:**
- Produces: worktree `.claude/worktrees/integracao-impl` + branch `integracao/impl` (base `338d5433`);
  `bash .superpowers/integracao/gates.sh` → `GATES INTEGRACAO: ok`;
  `bash .superpowers/integracao/n3.sh antes|depois <passo>`; `ROTA_NOVA=1` (env) faz o `gates.sh` manter o
  `src/routeTree.gen.ts` regerado (Tasks 9 e 20).

- [ ] **Step 1: Worktree e branch de IMPLEMENTAÇÃO a partir da linha principal atual; spec + plano; `node_modules` por symlink**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp"                                  # checkout principal (NÃO mexe no working tree dele)
git worktree add -b integracao/impl ".claude/worktrees/integracao-impl" 338d5433
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/integracao-impl"
git branch --show-current                                                  # integracao/impl
git checkout integracao/desenho -- docs/superpowers/specs/2026-09-26-tela-integracao-api-design.md \
  docs/superpowers/plans/2026-09-26-tela-integracao-api.md
git commit --only -m "docs(integracao): spec v4.3 e plano de implementação (trazidos da integracao/desenho)

Co-Authored-By: Claude <modelo real> <noreply@anthropic.com>" -- docs/superpowers/specs/2026-09-26-tela-integracao-api-design.md \
  docs/superpowers/plans/2026-09-26-tela-integracao-api.md
ln -s "/Users/sunglee/PLM + Criação/plm-pcp/node_modules" node_modules      # .gitignore tem `node_modules` (sem barra) — casa o symlink
git status --short                                                         # vazio
git merge-base --is-ancestor 338d5433 HEAD && echo "base atual ok"
git log --oneline -2
```
Expected: `base atual ok`; o topo é o commit de docs sobre `338d5433`. `git worktree add` recusar (pasta ou branch já
existe) ⇒ PARE e chame o controlador (não apague nada).

- [ ] **Step 2: Pastas e molde (cópia só-leitura dos scripts da frente SKU em prévia, que já passaram pelo G-scripts)**

```bash
S=.superpowers/integracao
mkdir -p "$S/logs" "$S/molde" "$S/mig/antes"
R="/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/sku-previa/.superpowers/sku-previa"
cp -p "$R/gates.sh" "$R/n3.sh" "$R/copia.sh" "$S/molde/"
cp -p "$R/mig/aplica.sh" "$R/mig/extra.sh" "$R/mig/monta-aplica.sh" "$R/mig/ensaio-local.sh" "$R/mig/ida-producao.sh" \
      "$R/mig/volta-producao.sh" "$R/mig/ref-volta-f1.sh" "$R/mig/prova-scripts.sh" "$S/molde/"
( cd "$S/molde" && shasum -a 256 * > SHA256SUMS ) && wc -l "$S/molde/SHA256SUMS"   # 11 linhas (11 arquivos)
```

- [ ] **Step 3: `regras.md`, `permitidos.txt`, `desvios.md`**

`.superpowers/integracao/regras.md`:

```markdown
# Regras da Integração + API — TODO executor lê antes de CADA task
1. Só na worktree `.claude/worktrees/integracao-impl` (branch `integracao/impl`); todo comando DE DENTRO dela.
2. Commit: `git add -- <arquivos exatos>` + `git commit --only -m "…" -- <arquivos>` + `git show --stat HEAD`. PROIBIDO
   `git add .`/`-A`/`commit -a`, `git stash` (base: `git show <sha>:<arquivo> > .superpowers/integracao/logs/<x>`), push,
   `pkill`/`killall`. Mensagem termina com `Co-Authored-By: Claude <modelo real> <noreply@anthropic.com>`.
3. Antes de TODO commit: `bash .superpowers/integracao/gates.sh` → `GATES INTEGRACAO: ok`. Falhou = PARE.
4. PRODUÇÃO: nada (nem SELECT, nem `/tmp/dburl.txt`). Só o DONO, pelos scripts da Task 8.
5. Cópia: DDL SÓ pelas suítes desta frente com `INTEGRACAO_MIG_TXN=1` ou pelos scripts de `.superpowers/integracao/`,
   SEMPRE entre `n3.sh antes` e `n3.sh depois` (o controlador publica o aviso no painel antes — P-30 B). NUNCA `\i`;
   nada de probe.
6. Todo vitest com `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres` explícito + caminho LITERAL +
   `--no-file-parallelism`; antes, `ps -Ao pid,command | grep -E "[v]itest|[p]laywright"` vazio. NUNCA `tests/integration`
   inteiro.
7. Leitura na cópia: `PGOPTIONS='-c default_transaction_read_only=on' psql …`.
8. Inverso de função EXISTENTE: o texto do "antes" vem de `.superpowers/integracao/mig/antes/` (gerado por `dump_antes.sh`),
   nunca redigitado.
9. Dev intocado (`src/components/desenvolvimento/**`, `src/components/producao/cad/CadTecidosSection.tsx`).
10. Tela: textos do plano verbatim, `mensagemErro`, cor só por token, `size="iconSm"` + 44px no mobile, `InfoHover` p/ "i".
11. Não subir/derrubar servidor — ÚNICA exceção: o vite próprio da Task 20b na `:5199` (sobe e mata SÓ o PID que ele mesmo
    gravou); nunca matar `:5173`/`:5188`. Não despachar subagentes. Nunca abrir/imprimir senha, `.env`, `.dev.vars`.
12. Erro de sintaxe/formato do código do plano: corrigir o MÍNIMO e registrar em `desvios.md`. Diferença de RESULTADO ou
    dúvida de regra: PARE e chame o controlador.
```

`.superpowers/integracao/permitidos.txt` (uma linha por caminho, sem comentário):

```
docs/superpowers/specs/2026-09-26-tela-integracao-api-design.md
docs/superpowers/plans/2026-09-26-tela-integracao-api.md
CLAUDE.md
supabase/migrations/20261007100000_integracao_1_tabelas.sql
supabase/migrations/20261007110000_integracao_2_retrato.sql
supabase/migrations/20261007120000_integracao_3_estados.sql
supabase/migrations/20261007130000_integracao_4_trava.sql
supabase/migrations/20261007140000_integracao_5_salvar.sql
supabase/migrations/20261007150000_integracao_6_api.sql
supabase/rollback/20261007100000_integracao_1_tabelas_down.sql
supabase/rollback/20261007110000_integracao_2_retrato_down.sql
supabase/rollback/20261007120000_integracao_3_estados_down.sql
supabase/rollback/20261007130000_integracao_4_trava_down.sql
supabase/rollback/20261007140000_integracao_5_salvar_down.sql
supabase/rollback/20261007150000_integracao_6_api_down.sql
tests/integration/integracao-helpers.ts
tests/integration/integracao-1-tabelas.test.ts
tests/integration/integracao-2-retrato.test.ts
tests/integration/integracao-3-estados.test.ts
tests/integration/integracao-4-trava.test.ts
tests/integration/integracao-5-salvar.test.ts
tests/integration/integracao-6-api.test.ts
tests/integration/integracao-7-acl-voltas.test.ts
tests/unit/integracao-campos.test.ts
tests/unit/integracao-campos-config.test.ts
tests/unit/erro-mensagem-integracao.test.ts
tests/unit/integracao-tela-fonte.test.ts
tests/unit/integracao-produtos.test.ts
tests/unit/integracao-rascunho.test.ts
tests/unit/integracao-salvar.test.ts
tests/unit/integracao-celula.test.ts
tests/unit/integracao-resumo.test.ts
tests/unit/integracao-api-tela.test.ts
tests/unit/integracao-resposta.test.ts
tests/unit/integracao-log.test.ts
tests/unit/integracao-api.test.ts
tests/carga/integracao-api-carga.test.ts
tests/unit/integracao-trava-tela.test.ts
tests/e2e/integracao-qa.spec.ts
tests/e2e/integracao-rota-real.spec.ts
src/lib/integracao/campos.ts
src/lib/integracao/abas.ts
src/lib/integracao/produtos.ts
src/lib/integracao/rascunho.ts
src/lib/integracao/celula.ts
src/lib/integracao/resumo.ts
src/lib/integracao/api-tela.ts
src/lib/integracao/log.ts
src/lib/integracao/trava.ts
src/lib/integracao/api/resposta.ts
src/lib/integracao/api/parametros.ts
src/lib/integracao/api/rota.ts
src/lib/integracao/api/rota.server.ts
src/lib/erro-mensagem.ts
src/lib/permissions-catalog.ts
src/lib/nav.ts
src/components/app-sidebar.tsx
src/routes/_authenticated/admin/lojas.tsx
src/routes/_authenticated/integracao.tsx
src/routes/api.integracao.v1.produtos.ts
src/routeTree.gen.ts
src/components/integracao/IntegracaoPage.tsx
src/components/integracao/guard.ts
src/components/integracao/useIntegracao.ts
src/components/integracao/salvar-integracao.ts
src/components/integracao/ProdutosAba.tsx
src/components/integracao/ProdutosTabela.tsx
src/components/integracao/CelulaCampo.tsx
src/components/integracao/FotosDialog.tsx
src/components/integracao/KeywordsDialog.tsx
src/components/integracao/EstadoLinha.tsx
src/components/integracao/IntegrarDialog.tsx
src/components/integracao/VoltarDialog.tsx
src/components/integracao/DesfazerDialog.tsx
src/components/integracao/CamposAba.tsx
src/components/integracao/ApiAba.tsx
src/components/integracao/NovaChaveDialog.tsx
src/components/integracao/ManualAba.tsx
src/components/integracao/manual-conteudo.ts
src/components/integracao/ExemploDialog.tsx
src/components/integracao/LogAba.tsx
src/components/integracao/AvisoComputador.tsx
src/components/integracao/SeloIntegracao.tsx
src/hooks/useIntegracaoEstado.ts
src/components/planejamento/PlanejamentoDetail.tsx
src/components/planejamento/planejamento-detail/InfoGeraisSecao.tsx
src/components/planejamento/planejamento-detail/PrecoTabela.tsx
src/components/planejamento/planejamento-detail/RevendaSetores.tsx
tests/unit/planejamento-codigos.test.ts
tests/unit/planejamento-permissao-secao-fonte.test.ts
src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts
src/routes/_authenticated/criacao.planejamento.tsx
src/components/produto-acabado/ProdutoCard.tsx
src/components/produto-importado/ProdutoImportadoCard.tsx
src/components/produto-importado/shared.ts
src/components/produto-importado/ProdutoImportadoSheet.tsx
src/components/plan-tecido/ModelCard.tsx
src/components/plan-tecido/CustoSection.tsx
public/integracao/exemplo-produto.svg
wrangler.jsonc
```
(`tests/e2e/integracao-qa.spec.ts` e `tests/e2e/integracao-rota-real.spec.ts` NÃO se versionam — nunca `git add` —; estão aqui
só para o `gates.sh` não barrar o arquivo solto numa correção pós-QA/pós-ensaio.)

`.superpowers/integracao/desvios.md`: `# Desvios do plano (Integração + API)` + uma linha
"formato: data · task · erro literal · causa · correção".

- [ ] **Step 4: `gates.sh`**

```bash
#!/usr/bin/env bash
# Gates de TODO commit da Integração + API. Uso (DE DENTRO da worktree): bash .superpowers/integracao/gates.sh → "GATES INTEGRACAO: ok".
# NÃO roda tests/integration (cada task de banco roda a sua suíte, entre n3 antes/depois). ROTA_NOVA=1 mantém o routeTree regerado.
set -uo pipefail
TOP="$(git rev-parse --show-toplevel)" || exit 1
case "$TOP" in */.claude/worktrees/integracao-impl) ;; *) echo "GATE FALHOU: rode de dentro da worktree integracao-impl (achei $TOP)"; exit 1;; esac
cd "$TOP"
S=.superpowers/integracao
echo "== gates integracao · alvo: $TOP · HEAD $(git rev-parse --short HEAD) ($(git branch --show-current))"
falha() { echo "GATE FALHOU: $1"; exit 1; }
[ "$(git branch --show-current)" = integracao/impl ] || falha "branch errada (esperado integracao/impl)"
BASE="$(git merge-base feature/plan-tecido-a1 HEAD)"
mkdir -p "$S/logs"
if ps -Ao command | grep -E "[v]itest|[p]laywright" > /dev/null; then falha "vitest/playwright rodando (a cópia é compartilhada — um por vez)"; fi
npx tsc --noEmit > "$S/logs/tsc.log" 2>&1 || { tail -20 "$S/logs/tsc.log"; falha "tsc (o build NÃO faz type-check)"; }
npm run build > "$S/logs/build.log" 2>&1 || { tail -20 "$S/logs/build.log"; falha "build"; }
[ "${ROTA_NOVA:-}" = 1 ] || git checkout -- src/routeTree.gen.ts 2>/dev/null || true
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres npx vitest run --no-file-parallelism tests/unit > "$S/logs/unit.log" 2>&1
grep -qE "Test Files .*passed" "$S/logs/unit.log" || { tail -20 "$S/logs/unit.log"; falha "unit (sem resumo)"; }
grep -E "^ FAIL " "$S/logs/unit.log" | sed -E 's/ +[0-9]+ms$//' | sort -u > "$S/logs/unit-fail-agora.txt"
diff -q "$S/unit-fail-base.txt" "$S/logs/unit-fail-agora.txt" > /dev/null \
  || { diff "$S/unit-fail-base.txt" "$S/logs/unit-fail-agora.txt"; falha "unit (falhas ≠ linha de base — inclui o anti-drift de UI)"; }
FORA="$( { git diff --name-only "$BASE" HEAD; git diff --name-only; git diff --name-only --cached; \
           git ls-files --others --exclude-standard; } | sort -u | grep -vxF -f "$S/permitidos.txt" || true)"
[ -z "$FORA" ] || { echo "$FORA"; falha "arquivo fora da lista permitida ($S/permitidos.txt)"; }
[ -z "$(git diff --name-only savepoint-pre-unificacao-2026-09-22 -- src/components/desenvolvimento/ src/components/producao/cad/CadTecidosSection.tsx)" ] \
  || falha "Sheet do Dev mudou desde o save point (decisão travada 8)"
for f in $(grep '^src/' "$S/permitidos.txt"); do
  [ -f "$f" ] || continue
  if grep -n 'type="date"' "$f"; then falha "<input type=\"date\"> em $f — use <DateField>"; fi
  if grep -nE 'toast\.error\((e|err|error)\.message' "$f"; then falha "toast de erro sem mensagemErro em $f"; fi
done
[ "$(git show feature/plan-tecido-a1:tests/integration/mig-txn.ts)" = "$(cat tests/integration/mig-txn.ts)" ] \
  || falha "tests/integration/mig-txn.ts mudou (é compartilhado — não editar)"
OUTRA="$(git diff --name-only "$BASE" HEAD -- supabase/migrations/ supabase/rollback/ | grep -vE '/20261007[0-9]{6}_integracao_[1-6]_' || true)"
[ -z "$OUTRA" ] || { echo "$OUTRA"; falha "migration de OUTRA frente mudou"; }
echo "GATES INTEGRACAO: ok"
```

- [ ] **Step 5: `n3.sh`**

```bash
#!/usr/bin/env bash
# N3 — a cópia (:54422) é também o APP DE TESTE do dono (:5188). Toda rodada com DDL na cópia (suíte com INTEGRACAO_MIG_TXN=1,
# ensaio, copia.sh ida|volta) passa por aqui. Esta frente CRIA tabelas e gatilhos em modelos/produtos_*: numa suíte a trava da
# DDL dura a transação INTEIRA do teste (N1) — o :5188 pode travar pelo tempo da suíte. P-30 B do dono: o controlador publica o
# AVISO no painel ANTES (sem esperar OK). SÓ LEITURA. Uso:
#   INTEG_DONO_AVISADO=sim bash .superpowers/integracao/n3.sh antes <passo>      ex.: t1, t4, ensaio, copia-ida
#   bash .superpowers/integracao/n3.sh depois <passo>
set -uo pipefail
TOP="$(git rev-parse --show-toplevel)" || exit 1
case "$TOP" in */.claude/worktrees/integracao-impl) ;; *) echo "PARE: rode de dentro da worktree integracao-impl"; exit 1;; esac
cd "$TOP"
LOCAL="postgresql://postgres:postgres@127.0.0.1:54422/postgres"
QUANDO="${1:-}"; PASSO="${2:-}"
case "$QUANDO" in antes|depois) ;; *) echo "uso: n3.sh antes|depois <passo>"; exit 2 ;; esac
[ -n "$PASSO" ] || { echo "uso: n3.sh antes|depois <passo>"; exit 2; }
mkdir -p .superpowers/integracao/logs
docker ps --filter name=supabase_db_banco-local --format '{{.Status}}' | grep -q '^Up' \
  || { echo "PARE: cópia fora do ar (não subir/recriar por conta própria)"; exit 1; }
if [ "$QUANDO" = antes ]; then
  if ps -Ao command | grep -E "[v]itest|[p]laywright" > /dev/null; then
    ps -Ao pid,command | grep -E "[v]itest|[p]laywright"; echo "PARE: vitest/playwright rodando (um por vez na cópia)"; exit 1
  fi
  N=$(PGCONNECT_TIMEOUT=5 psql "$LOCAL" -X -A -t -v ON_ERROR_STOP=1 -c "select count(*) from pg_stat_activity where datname = current_database() and backend_type = 'client backend' and pid <> pg_backend_pid() and state <> 'idle'") \
    || { echo "PARE: não conectei na cópia"; exit 1; }
  [ "$N" = 0 ] || { echo "PARE: $N sessão(ões) ativa(s) na cópia — outra frente usando; esperar"; exit 1; }
  if [ "${INTEG_DONO_AVISADO:-}" != sim ]; then
    cat <<'MSG'
PARE: publique o AVISO no painel ANTES (P-30 B) e rode de novo com INTEG_DONO_AVISADO=sim:
  "Vou rodar <passo> da Integração na cópia local agora (~<N> min). A migration cria tabelas e gatilhos: enquanto a suíte
   roda, telas do :5188 que leem produtos podem ficar paradas (a trava dura a transação do teste); os testes criam dados
   numa transação desfeita no fim."
MSG
    exit 1
  fi
fi
E=$(PGOPTIONS='-c default_transaction_read_only=on' psql "$LOCAL" -X -A -t -c "select (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public') || '|' || (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and not t.tgisinternal) || '|' || (to_regclass('public.integracao_produtos') is not null)") \
  || { echo "PARE: não li o estado da cópia"; exit 1; }
P=$(lsof -nP -iTCP:5188 -sTCP:LISTEN -t 2>/dev/null | head -1)
AV=""; [ "$QUANDO" = antes ] && AV=" · aviso no painel"
echo "$(date '+%F %T') $QUANDO $PASSO: funções|gatilhos|integracao = $E · :5188 $([ -n "$P" ] && echo "no ar (PID $P)" || echo "fora do ar")$AV" \
  | tee -a .superpowers/integracao/logs/n3.log
[ "$QUANDO" = antes ] && echo "OK (N3): pode rodar $PASSO"
exit 0
```

- [ ] **Step 6: Linha de base das falhas unit + primeira rodada dos gates**

```bash
chmod +x .superpowers/integracao/gates.sh .superpowers/integracao/n3.sh
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres
npx vitest run --no-file-parallelism tests/unit > .superpowers/integracao/logs/unit-base.log 2>&1
grep -E "^ FAIL " .superpowers/integracao/logs/unit-base.log | sed -E 's/ +[0-9]+ms$//' | sort -u > .superpowers/integracao/unit-fail-base.txt
wc -l .superpowers/integracao/unit-fail-base.txt
bash .superpowers/integracao/gates.sh
```
Expected: `GATES INTEGRACAO: ok`. (Falha pré-existente de unit fica na linha de base e é informada ao controlador.)

---

# FASE 1 — Banco

### Task 1: Harness + migration 1 (tabelas) + inverso 1

**Files:**
- Create: `.superpowers/integracao/mig/dump_antes.sh` (não versionado) e `.superpowers/integracao/mig/antes/*.sql` (gerados)
- Create: `tests/integration/integracao-helpers.ts`
- Create: `supabase/migrations/20261007100000_integracao_1_tabelas.sql`
- Create: `supabase/rollback/20261007100000_integracao_1_tabelas_down.sql` (montado por script)
- Test: `tests/integration/integracao-1-tabelas.test.ts`

**Interfaces:**
- Consumes: `aplicarSql`, `exigeBancoLocal` (`tests/integration/mig-txn.ts`); `hasDb`, `ehBancoLocal`, `withTx`,
  `comoUsuario`, `um`, `TENANT_TESTE`, `USER_TESTE` (`tests/integration/db.ts`).
- Produces (SQL): tabelas `integracao_config(tenant_id PK, campos text[], limite_por_minuto, max_por_pagina,
  validade_foto_dias, bloqueio_tentativas, rev, atualizado_por, atualizado_em)`, `integracao_segredo(id=1, segredo bytea)`,
  `integracao_produtos(id, tenant_id, modelo_id, estado, campos, retrato, assinatura, variantes_chaves uuid[], marcado_por,
  marcado_em, integrado_em, integrado_chave_id, desfeito_por, desfeito_em, desfeito_motivo, rev, atualizado_em)`,
  `integracao_linhas(id, tenant_id, loja_nome, modelo_id, tipo, ordem, nome, ref_sku, preco_anterior, preco_venda, peso,
  ncm, preco_custo, cor_base, cor_apelido, tamanho, titulo, descricao, keywords, metatag, comprimento, largura, altura,
  fotos text[], integrado_em, criado_em)`, `integracao_chaves(id, tenant_id, nome, hash, final, criada_por, criada_em,
  revogada_por, revogada_em, ultimo_uso_em)`, `integracao_acessos(id, tenant_id, chave_id, ip, modo, status, agregado,
  minuto, tentativas, produtos_entregues, linhas, detalhe, criado_em, concluido_em)`, `integracao_log(id, tenant_id, acao,
  usuario_id, quem, modelo_id, modelo_nome, detalhe, criado_em)`; função `_integracao_layout() → text[]` (18 chaves).
- Produces (TS, `integracao-helpers.ts`): `MIG_TXN`, `LOCAL`, `T`, `U`, `MIGRACOES`, `INVERSOS`, `semTravas(sql, nome)`,
  `ler(rel)`, `aplica(c, rel)`, `type Ate = 1|2|3|4|5|6`, `prepara(c, ate)`, `imediato(c)`, `type Perm`,
  `comoUsuarioCom(c, uid, perms, o?)`, `cor(c, nome, sigla)`, `apelido(c, corId, nome, sigla)`,
  `modeloInterno(c, o?)`, `revenda(c, o?)`, `importado(c, o?)`, `keywordsLoja(c, texto)`, `camposLoja(c, campos)`,
  `CAMPOS_PADRAO` (17), `LAYOUT` (18), `type Fixture = { id: string; ref: string; corId: string; apelidoId: string | null;
  produtoId: string | null }`, `DEF(c, sig)` (pg_get_functiondef), `MD5_ANTES` (4 md5).

- [ ] **Step 1: `dump_antes.sh` — texto do "antes" das 4 funções existentes que a frente redefine (só leitura)**

```bash
#!/usr/bin/env bash
# Gera .superpowers/integracao/mig/antes/<nome>.sql = pg_get_functiondef (SÓ LEITURA na cópia) das 4 funções EXISTENTES que a
# frente Integração redefine. Os inversos recolocam ESTE texto (nunca redigitado). Recusa se o md5 não for o de antes.
set -euo pipefail
TOP="$(git rev-parse --show-toplevel)"; cd "$TOP"
case "$TOP" in */.claude/worktrees/integracao-impl) ;; *) echo "PARE: rode de dentro da worktree integracao-impl"; exit 1;; esac
LOCAL="postgresql://postgres:postgres@127.0.0.1:54422/postgres"
A=.superpowers/integracao/mig/antes
mkdir -p "$A"
md5_txt() { printf %s "$(cat "$1")" | { md5 -q 2>/dev/null || md5sum | cut -d' ' -f1; }; }
while read -r SIG ESPERADO; do
  NOME="${SIG%%(*}"
  V=$(PGOPTIONS='-c default_transaction_read_only=on' psql "$LOCAL" -X -A -t -v ON_ERROR_STOP=1 \
        -c "select md5(pg_get_functiondef('public.$SIG'::regprocedure))")
  [ "$V" = "$ESPERADO" ] || { echo "PARE: $SIG na cópia tem md5 $V (esperado $ESPERADO) — a cópia já tem a frente ou a função mudou"; exit 1; }
  PGOPTIONS='-c default_transaction_read_only=on' psql "$LOCAL" -X -A -t -v ON_ERROR_STOP=1 \
        -c "select pg_get_functiondef('public.$SIG'::regprocedure)" > "$A/$NOME.sql"
  [ "$(md5_txt "$A/$NOME.sql")" = "$ESPERADO" ] || { echo "PARE: $A/$NOME.sql não reproduz o md5"; exit 1; }
  echo "OK $SIG → $A/$NOME.sql ($(wc -l < "$A/$NOME.sql" | tr -d ' ') linhas)"
done <<'LISTA'
_seed_tenant_defaults(uuid) 01bd241680e24fdb665ca8ae81a6a1a3
_pa_recomputar_precos_modelo(uuid) 72c96c624de8f4530c862d8abb6a1283
_imp_recomputar_precos_modelo(uuid) 5baca24d0de45b8c5f291fef39472238
_salvar_produto_importado_core(uuid,jsonb,jsonb,jsonb) 47584858f55524d18d326dfff00139e6
LISTA
```

Run: `chmod +x .superpowers/integracao/mig/dump_antes.sh && bash .superpowers/integracao/mig/dump_antes.sh`
Expected: 4 linhas `OK …` (53, 62, 50 e 126 linhas). `PARE` ⇒ chame o controlador (não siga).

- [ ] **Step 2: Harness e fixtures — `tests/integration/integracao-helpers.ts`**

```ts
/**
 * INTEGRAÇÃO + API — harness e fixtures das suítes de integração (Tasks 1–7 do plano
 * docs/superpowers/plans/2026-09-26-tela-integracao-api.md). Tudo em BEGIN…ROLLBACK (withTx): NADA é gravado.
 * Com INTEGRACAO_MIG_TXN=1, `prepara(c, n)` aplica as migrations 1..n DENTRO da txn (sem BEGIN/COMMIT e sem as 2 travas
 * SET LOCAL do arquivo — o transaction_timeout de 3 s limitaria o teste todo) — NUNCA `\i` (incidente 15/set). Sem a
 * variável, as migrations precisam JÁ estar aplicadas na CÓPIA (ensaio / copia.sh ida) e `prepara` só confere.
 * ⚠️ SÓ NA CÓPIA LOCAL (exigeBancoLocal): DDL em txn contra produção trava o app de todas as lojas (incidente 23/set).
 * Toda rodada destas suítes é janela N3 (o controlador avisa no painel; `n3.sh antes|depois`).
 */
import type { Client } from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { aplicarSql, exigeBancoLocal } from "./mig-txn";
import { ehBancoLocal, um, TENANT_TESTE, USER_TESTE } from "./db";

export const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const MIG_TXN = process.env.INTEGRACAO_MIG_TXN === "1";
export const LOCAL = ehBancoLocal();
export const T = TENANT_TESTE;
export const U = USER_TESTE;
export const MIGRACOES = [
  "supabase/migrations/20261007100000_integracao_1_tabelas.sql",
  "supabase/migrations/20261007110000_integracao_2_retrato.sql",
  "supabase/migrations/20261007120000_integracao_3_estados.sql",
  "supabase/migrations/20261007130000_integracao_4_trava.sql",
  "supabase/migrations/20261007140000_integracao_5_salvar.sql",
  "supabase/migrations/20261007150000_integracao_6_api.sql",
] as const;
export const INVERSOS = [
  "supabase/rollback/20261007100000_integracao_1_tabelas_down.sql",
  "supabase/rollback/20261007110000_integracao_2_retrato_down.sql",
  "supabase/rollback/20261007120000_integracao_3_estados_down.sql",
  "supabase/rollback/20261007130000_integracao_4_trava_down.sql",
  "supabase/rollback/20261007140000_integracao_5_salvar_down.sql",
  "supabase/rollback/20261007150000_integracao_6_api_down.sql",
] as const;
/** Objeto-marca de cada migration (existe ⇔ aplicada). */
export const MARCAS = [
  "to_regclass('public.integracao_produtos') IS NOT NULL",
  "to_regprocedure('public._integracao_retrato_core(uuid,text[],jsonb)') IS NOT NULL",
  "to_regprocedure('public.integracao_marcar(jsonb)') IS NOT NULL",
  "to_regprocedure('public.fn_integracao_trava_modelos()') IS NOT NULL",
  "to_regprocedure('public.integracao_salvar(jsonb,jsonb)') IS NOT NULL",
  "to_regprocedure('public._integracao_ler(text,boolean,text,integer,text,text)') IS NOT NULL",
] as const;
export const LAYOUT = [
  "nome", "ref_sku", "preco_anterior", "preco_venda", "peso", "ncm", "preco_custo", "cor_base", "cor_apelido",
  "tamanho", "titulo", "descricao", "keywords", "metatag", "comprimento", "largura", "altura", "foto",
] as const;
export const CAMPOS_PADRAO = LAYOUT.slice(0, 17);
export const MD5_ANTES = {
  seed: "01bd241680e24fdb665ca8ae81a6a1a3",
  pa: "72c96c624de8f4530c862d8abb6a1283",
  imp: "5baca24d0de45b8c5f291fef39472238",
  impCore: "47584858f55524d18d326dfff00139e6",
} as const;

const RE_TRAVAS = /^SET LOCAL (lock_timeout|transaction_timeout) = '[^']*';$/gm;
/** As 2 travas do arquivo (logo depois do BEGIN) saem da txn do teste. */
export function semTravas(sql: string, nome: string): string {
  const n = (sql.match(RE_TRAVAS) ?? []).length;
  if (n !== 2) throw new Error(`${nome}: esperado as 2 travas SET LOCAL (lock_timeout + transaction_timeout); achei ${n}`);
  return sql.replace(RE_TRAVAS, "-- [teste] trava do arquivo removida (a txn do teste tem as suas)");
}
export const ler = (rel: string): string => readFileSync(ROOT + rel, "utf8");
export async function aplica(c: Client, rel: string): Promise<void> {
  await aplicarSql(c, semTravas(ler(rel), rel), rel);
}
export type Ate = 1 | 2 | 3 | 4 | 5 | 6;
/** Só na cópia; timeouts; com MIG_TXN aplica 1..ate na txn; sempre confere as marcas 1..ate. */
export async function prepara(c: Client, ate: Ate): Promise<void> {
  exigeBancoLocal();
  await c.query("SET LOCAL lock_timeout = '3s'");
  await c.query("SET LOCAL statement_timeout = '120s'");
  if (MIG_TXN) for (const rel of MIGRACOES.slice(0, ate)) await aplica(c, rel);
  for (let i = 0; i < ate; i++) {
    const r = await um<{ ok: boolean }>(c, `SELECT ${MARCAS[i]} AS ok`);
    if (!r.ok) throw new Error(`migration ${i + 1} ausente — rode com INTEGRACAO_MIG_TXN=1 (janela N3) ou aplique na cópia`);
  }
}
/** Dispara os gatilhos ADIADOS (a txn do teste nunca faz COMMIT) e volta ao modo adiado. */
export async function imediato(c: Client): Promise<void> {
  await c.query("SET CONSTRAINTS ALL IMMEDIATE");
  await c.query("SET CONSTRAINTS ALL DEFERRED");
}
export async function DEF(c: Client, sig: string): Promise<string> {
  return (await um<{ d: string }>(c, `SELECT pg_get_functiondef('public.${sig}'::regprocedure) AS d`)).d;
}

// ─────────────────────────── usuários ───────────────────────────
export type Perm = [pagina: string, ver: boolean, editar: boolean];
/** Usuário novo da Loja Teste (txn), com as permissões dadas; vira o JWT da txn. */
export async function comoUsuarioCom(c: Client, uid: string, perms: Perm[], o: { tenantAdmin?: boolean } = {}): Promise<void> {
  await c.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [uid, `${uid}@teste`]);
  await c.query(
    `INSERT INTO public.users (id, tenant_id, email, nome) VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET tenant_id = excluded.tenant_id`,
    [uid, T, `${uid}@teste`, `Teste ${uid.slice(-4)}`],
  );
  if (o.tenantAdmin) await c.query(`INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'tenant_admin')`, [uid]);
  for (const [pagina, ver, editar] of perms) {
    await c.query(
      `INSERT INTO public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar) VALUES ($1, $2, $3, $4, $5)`,
      [uid, T, pagina, ver, editar],
    );
  }
  await c.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: "authenticated" })]);
}

// ─────────────────────────── fixtures (Loja Teste, dentro da txn) ───────────────────────────
let seq = 0;
const sufixo = (): string => `${Date.now().toString(36)}${(seq++).toString(36)}`.toUpperCase();
export async function cor(c: Client, nome: string, sigla: string): Promise<string> {
  return (await um<{ id: string }>(c,
    `INSERT INTO public.cores (tenant_id, nome, sigla_sku) VALUES ($1, $2, $3) RETURNING id`, [T, nome, sigla])).id;
}
export async function apelido(c: Client, corId: string, nome: string, sigla: string): Promise<string> {
  return (await um<{ id: string }>(c,
    `INSERT INTO public.cores_apelido (tenant_id, nome, cor_base_id, sigla_sku) VALUES ($1, $2, $3, $4) RETURNING id`,
    [T, nome, corId, sigla])).id;
}
export async function keywordsLoja(c: Client, texto: string | null): Promise<void> {
  await c.query(`UPDATE public.tenant_config SET keywords = $1 WHERE tenant_id = $2`, [texto, T]);
}
export async function camposLoja(c: Client, campos: readonly string[]): Promise<void> {
  await c.query(`UPDATE public.integracao_config SET campos = $1::text[] WHERE tenant_id = $2`, [campos, T]);
}
export type Fixture = { id: string; ref: string; corId: string; apelidoId: string | null; produtoId: string | null };
export type ModeloOpts = { nome?: string; semApelido?: boolean; semSku?: boolean; fotos?: string[]; origem?: "interno" | "revenda" | "importado" };

async function colunasCompletas(c: Client, id: string, o: ModeloOpts): Promise<void> {
  await c.query(
    `UPDATE public.modelos SET preco_anterior = 179.90, preco_venda = 159.90, peso_kg = 0.220, ncm = '6109.10.00',
            titulo_pagina = 'Blusa Brisa Manga Longa', descricao_produto = 'Blusa em viscose, manga longa.',
            comprimento_cm = 68, largura_cm = 42, altura_cm = 2, custo_peca_previsto = 62.10, tamanho_tipo = 'letra',
            status_planejamento = 'planejado', fotos_modelo = $2::text[]
      WHERE id = $1`,
    [id, o.fotos ?? [`${T}/fotos_modelo/integracao-teste.jpg`]],
  );
}
async function gradeESkus(c: Client, id: string, ref: string, corId: string, apelidoId: string | null, o: ModeloOpts): Promise<void> {
  await c.query(`INSERT INTO public.modelo_grades (modelo_id, variante_numero, grades, grade_total) VALUES ($1, 1, '{"38|P": 2, "40|M": 3}', 5)`, [id]);
  if (o.semSku) return;
  for (const tam of ["38|P", "40|M"]) {
    await c.query(
      `INSERT INTO public.modelo_skus (tenant_id, modelo_id, variante_key, tamanho_key, sku, manual)
       VALUES ($1, $2, public._sku_variante_key($3, $4), $5, $6, true)`,
      [T, id, corId, apelidoId, tam, `${ref}-${tam.split("|")[1]}`],
    );
  }
}
/** Produto INTERNO completo nos 17 campos (Tecido 1 com 1 variante cor+apelido; grade P/M; 2 SKUs gravados). */
export async function modeloInterno(c: Client, o: ModeloOpts = {}): Promise<Fixture> {
  const s = sufixo();
  const ref = `ITG${s}`;
  const corId = await cor(c, `Branco ${s}`, `B${s.slice(-2)}`);
  const apelidoId = o.semApelido ? null : await apelido(c, corId, `Off-white ${s}`, `O${s.slice(-2)}`);
  const id = (await um<{ id: string }>(c,
    `INSERT INTO public.modelos (tenant_id, nome, ref, origem) VALUES ($1, $2, $3, 'interno') RETURNING id`,
    [T, o.nome ?? `Blusa Brisa ${s}`, ref])).id;
  await colunasCompletas(c, id, o);
  const artigo = (await um<{ id: string }>(c, `SELECT id FROM public.artigos WHERE tenant_id = $1 ORDER BY id LIMIT 1`, [T])).id;
  const vt = (await um<{ id: string }>(c,
    `INSERT INTO public.variantes_tecido (tenant_id, artigo_id, cor_id, cor_apelido_id, nome_variante) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [T, artigo, corId, apelidoId, `Var ${s}`])).id;
  const mt = (await um<{ id: string }>(c,
    `INSERT INTO public.modelo_tecidos (modelo_id, artigo_id, numero, tipo) VALUES ($1, $2, 1, 'tecido') RETURNING id`, [id, artigo])).id;
  await c.query(`INSERT INTO public.modelo_tecido_variantes (modelo_tecido_id, variante_tecido_id, ordem) VALUES ($1, $2, 1)`, [mt, vt]);
  await gradeESkus(c, id, ref, corId, apelidoId, o);
  return { id, ref, corId, apelidoId, produtoId: null };
}
/** REVENDA completa: produtos_acabados (ref própria, valor 40) + variante + card espelho + grade + SKUs. */
export async function revenda(c: Client, o: ModeloOpts = {}): Promise<Fixture> {
  const s = sufixo();
  const ref = `RVD${s}`;
  const nome = o.nome ?? `Bolsa Areia ${s}`;
  const corId = await cor(c, `Bege ${s}`, `G${s.slice(-2)}`);
  const apelidoId = o.semApelido ? null : await apelido(c, corId, `Areia ${s}`, `A${s.slice(-2)}`);
  const produtoId = (await um<{ id: string }>(c,
    `INSERT INTO public.produtos_acabados (tenant_id, nome, ref, valor_unitario, desconto_pct, qtd_total, markup_varejo)
     VALUES ($1, $2, $3, 40, 0, 5, 3) RETURNING id`, [T, nome, ref])).id;
  const id = (await um<{ id: string }>(c,
    `INSERT INTO public.modelos (tenant_id, nome, ref, origem) VALUES ($1, $2, $3, 'revenda') RETURNING id`, [T, nome, ref])).id;
  await colunasCompletas(c, id, o);
  await c.query(`UPDATE public.produtos_acabados SET modelo_id = $2 WHERE id = $1`, [produtoId, id]);
  await c.query(
    `INSERT INTO public.produto_acabado_variantes (tenant_id, produto_acabado_id, ordem, cor_id, cor_apelido_id, peso, qtd)
     VALUES ($1, $2, 1, $3, $4, 1, 5)`, [T, produtoId, corId, apelidoId]);
  await gradeESkus(c, id, ref, corId, apelidoId, o);
  return { id, ref, corId, apelidoId, produtoId };
}
/** IMPORTADO completo (o custo landed depende das cotações — as suítes que olham custo usam interno/revenda). */
export async function importado(c: Client, o: ModeloOpts = {}): Promise<Fixture> {
  const s = sufixo();
  const ref = `IMP${s}`;
  const nome = o.nome ?? `Macacão Tramonto ${s}`;
  const corId = await cor(c, `Azul ${s}`, `Z${s.slice(-2)}`);
  const apelidoId = o.semApelido ? null : await apelido(c, corId, `Cobalto ${s}`, `C${s.slice(-2)}`);
  const produtoId = (await um<{ id: string }>(c,
    `INSERT INTO public.produtos_importados (tenant_id, nome, ref, moeda_compra, valor_unitario_m1, cotacao_ref, cotacao_final, qtd_total, markup_varejo)
     VALUES ($1, $2, $3, 'USD', 10, 1, 5, 5, 3) RETURNING id`, [T, nome, ref])).id;
  const id = (await um<{ id: string }>(c,
    `INSERT INTO public.modelos (tenant_id, nome, ref, origem) VALUES ($1, $2, $3, 'importado') RETURNING id`, [T, nome, ref])).id;
  await colunasCompletas(c, id, o);
  await c.query(`UPDATE public.produtos_importados SET modelo_id = $2 WHERE id = $1`, [produtoId, id]);
  await c.query(
    `INSERT INTO public.produto_importado_variantes (tenant_id, produto_importado_id, ordem, cor_id, cor_apelido_id, peso, qtd)
     VALUES ($1, $2, 1, $3, $4, 1, 5)`, [T, produtoId, corId, apelidoId]);
  await gradeESkus(c, id, ref, corId, apelidoId, o);
  return { id, ref, corId, apelidoId, produtoId };
}
```

- [ ] **Step 3: Escrever o teste da migration 1 (vai falhar: o arquivo ainda não existe)**

`tests/integration/integracao-1-tabelas.test.ts`:

```ts
/**
 * Integração + API — migration 1 (tabelas). Plano: docs/superpowers/plans/2026-09-26-tela-integracao-api.md, Task 1.
 * Integração em BEGIN…ROLLBACK SÓ na cópia (janela N3). Estático (formato dos arquivos) roda sem banco.
 */
import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { hasDb, withTx, comoUsuario, um } from "./db";
import { CAMPOS_PADRAO, DEF, INVERSOS, LAYOUT, LOCAL, MD5_ANTES, MIGRACOES, MIG_TXN, ROOT, T, U, aplica, ler, prepara } from "./integracao-helpers";

const TABELAS = ["integracao_config", "integracao_segredo", "integracao_produtos", "integracao_linhas",
  "integracao_chaves", "integracao_acessos", "integracao_log"] as const;
/** Trecho inserido em _seed_tenant_defaults (diff mínimo — o "depois" menos ISTO é o "antes"). */
export const TRECHO_SEED =
  "\n  -- [integracao v1] Integração + API (set/2026): a config nasce com o padrão (campos do layout #1-#17 marcados, Foto\n" +
  "  -- desmarcada — P-83 A). reset_loja e a criação de loja passam por aqui (N9/n6).\n" +
  "  INSERT INTO public.integracao_config (tenant_id) VALUES (_tid)\n" +
  "  ON CONFLICT (tenant_id) DO NOTHING;\n";

describe("integracao — formato de TODOS os arquivos .sql já escritos (estático)", () => {
  const arquivos = [...MIGRACOES, ...INVERSOS].filter((rel) => existsSync(ROOT + rel));
  it("há pelo menos a migration 1", () => expect(arquivos).toContain(MIGRACOES[0]));
  for (const rel of arquivos) {
    it(`${rel}: encoding → BEGIN → 2 travas; $guarda$/$pos$; NOTIFY antes do COMMIT; sem policy`, () => {
      const t = ler(rel);
      const linhas = t.split("\n");
      const primeira = linhas.find((l) => l.trim() !== "" && !l.startsWith("--"));
      expect(primeira, rel).toBe("SET client_encoding = 'UTF8';");
      const b = linhas.indexOf("BEGIN;");
      expect(b, rel).toBeGreaterThan(0);
      expect(linhas[b - 1], rel).toBe("SET client_encoding = 'UTF8';");
      expect(linhas.slice(b + 1, b + 3), rel).toEqual(["SET LOCAL lock_timeout = '500ms';", "SET LOCAL transaction_timeout = '3s';"]);
      expect(linhas.filter((l) => l === "BEGIN;").length, rel).toBe(1);
      expect(linhas.filter((l) => l === "COMMIT;").length, rel).toBe(1);
      expect(t, rel).toContain("DO $guarda$");
      expect(t, rel).toContain("DO $pos$");
      expect(t.indexOf("NOTIFY pgrst, 'reload schema';"), rel).toBeGreaterThan(t.indexOf("DO $pos$"));
      expect(t.indexOf("NOTIFY pgrst, 'reload schema';"), rel).toBeLessThan(t.indexOf("\nCOMMIT;"));
      expect(t, rel).not.toMatch(/CREATE\s+POLICY|DROP\s+POLICY|ENABLE\s+ALWAYS|\\i\s/i);
      // N1: na IDA, gatilho comum = CREATE OR REPLACE TRIGGER (o DROP antes pegaria trava exclusiva da tabela)
      if (rel.startsWith("supabase/migrations/")) expect(t, rel).not.toMatch(/^CREATE TRIGGER /m);
    });
  }
});

describe.skipIf(!hasDb || !LOCAL)("integracao — migration 1 (cópia, txn revertida)", () => {
  it("7 tabelas: RLS ligada, 0 policy, sem SELECT p/ anon/authenticated", async () => {
    await withTx(async (c) => {
      await prepara(c, 1);
      for (const t of TABELAS) {
        const r = await um<{ rls: boolean; pol: string; sa: boolean; sn: boolean }>(c,
          `SELECT k.relrowsecurity AS rls, (SELECT count(*) FROM pg_policy p WHERE p.polrelid = k.oid) AS pol,
                  has_table_privilege('authenticated', k.oid, 'SELECT') AS sa, has_table_privilege('anon', k.oid, 'SELECT') AS sn
             FROM pg_class k WHERE k.oid = ('public.' || $1)::regclass`, [t]);
        expect(r, t).toEqual({ rls: true, pol: "0", sa: false, sn: false });
      }
    });
  });

  it("leitura direta como authenticated é negada (REST)", async () => {
    await withTx(async (c) => {
      await prepara(c, 1);
      await comoUsuario(c, U);
      await c.query("SAVEPOINT a");
      await c.query("SET LOCAL ROLE authenticated");
      await expect(c.query("SELECT * FROM public.integracao_linhas LIMIT 1")).rejects.toThrow(/permission denied/);
      await c.query("ROLLBACK TO SAVEPOINT a");
    });
  });

  it("layout = 18 chaves na ordem; config de TODAS as lojas nasce com os 17 do layout e 60/50/7/10 (P-89 A)", async () => {
    await withTx(async (c) => {
      await prepara(c, 1);
      expect((await um<{ l: string[] }>(c, "SELECT public._integracao_layout() AS l")).l).toEqual([...LAYOUT]);
      const r = await um<{ faltam: string; campos: string[]; lim: number; pag: number; foto: number; blq: number; rev: number }>(c,
        `SELECT (SELECT count(*) FROM public.tenants t WHERE NOT EXISTS (SELECT 1 FROM public.integracao_config x WHERE x.tenant_id = t.id)) AS faltam,
                c.campos, c.limite_por_minuto AS lim, c.max_por_pagina AS pag, c.validade_foto_dias AS foto, c.bloqueio_tentativas AS blq, c.rev
           FROM public.integracao_config c WHERE c.tenant_id = $1`, [T]);
      expect(r).toEqual({ faltam: "0", campos: [...CAMPOS_PADRAO], lim: 60, pag: 50, foto: 7, blq: 10, rev: 1 });
      await expect(c.query(`UPDATE public.integracao_config SET limite_por_minuto = 601 WHERE tenant_id = $1`, [T]))
        .rejects.toThrow(/integracao_config_limite_chk/);
    });
  });

  it("segredo HMAC: 1 linha, 32 bytes; _integracao_layout sem EXECUTE p/ PUBLIC/anon/authenticated", async () => {
    await withTx(async (c) => {
      await prepara(c, 1);
      expect((await um<{ n: string; b: number }>(c, "SELECT count(*) AS n, max(octet_length(segredo)) AS b FROM public.integracao_segredo")))
        .toEqual({ n: "1", b: 32 });
      const acl = await um<{ a: boolean; n: boolean; p: boolean }>(c,
        `SELECT has_function_privilege('authenticated', 'public._integracao_layout()', 'EXECUTE') AS a,
                has_function_privilege('anon', 'public._integracao_layout()', 'EXECUTE') AS n,
                has_function_privilege('public', 'public._integracao_layout()', 'EXECUTE') AS p`);
      expect(acl).toEqual({ a: false, n: false, p: false });
    });
  });

  it("integracao_produtos é 1:1 com modelos por TRIGGER (não UNIQUE) + índice plano", async () => {
    await withTx(async (c) => {
      await prepara(c, 1);
      const m = (await um<{ id: string }>(c, `SELECT id FROM public.modelos WHERE tenant_id = $1 LIMIT 1`, [T])).id;
      await c.query(`INSERT INTO public.integracao_produtos (tenant_id, modelo_id) VALUES ($1, $2)`, [T, m]);
      await c.query("SAVEPOINT a");
      await expect(c.query(`INSERT INTO public.integracao_produtos (tenant_id, modelo_id) VALUES ($1, $2)`, [T, m]))
        .rejects.toThrow(/invariante 1:1/);
      await c.query("ROLLBACK TO SAVEPOINT a");
      const idx = await um<{ n: string }>(c,
        `SELECT count(*) AS n FROM pg_indexes WHERE tablename = 'integracao_produtos' AND indexdef LIKE '%(modelo_id)%' AND indexdef NOT LIKE '%UNIQUE%'`);
      expect(idx.n).toBe("1");
    });
  });

  it.skipIf(!MIG_TXN)("_seed_tenant_defaults: depois = antes + SÓ o INSERT da config (diff mínimo)", async () => {
    await withTx(async (c) => {
      const antes = await DEF(c, "_seed_tenant_defaults(uuid)");
      expect((await um<{ m: string }>(c, "SELECT md5($1) AS m", [antes])).m).toBe(MD5_ANTES.seed);
      await prepara(c, 1);
      const depois = await DEF(c, "_seed_tenant_defaults(uuid)");
      expect(depois).toContain(TRECHO_SEED);
      expect(depois.replace(TRECHO_SEED, "")).toBe(antes);
    });
  });

  it("loja NOVA e reset_loja semeiam a config padrão (N9/n6)", async () => {
    await withTx(async (c) => {
      await prepara(c, 1);
      await comoUsuario(c, U);
      const nova = (await um<{ id: string }>(c, `INSERT INTO public.tenants (nome) VALUES ('Loja Integracao Teste') RETURNING id`)).id;
      expect((await um<{ campos: string[] }>(c, `SELECT campos FROM public.integracao_config WHERE tenant_id = $1`, [nova])).campos)
        .toEqual([...CAMPOS_PADRAO]);
      await c.query(`UPDATE public.integracao_config SET campos = '{nome}' WHERE tenant_id = $1`, [nova]);
      await c.query(`SELECT public.reset_loja($1)`, [nova]);
      expect((await um<{ campos: string[] }>(c, `SELECT campos FROM public.integracao_config WHERE tenant_id = $1`, [nova])).campos)
        .toEqual([...CAMPOS_PADRAO]);
    });
  });

  it.skipIf(!MIG_TXN)("inverso 1 desfaz a 1 (as 7 tabelas e a função somem; _seed volta ao md5 de antes)", async () => {
    await withTx(async (c) => {
      await prepara(c, 1);
      await aplica(c, INVERSOS[0]);
      // D40/revisão T1 #1 (Minor #5): confere as 7 tabelas (não só integracao_produtos).
      for (const t of TABELAS) {
        const r = await um<{ ok: boolean }>(c, `SELECT to_regclass('public.' || $1) IS NULL AS ok`, [t]);
        expect(r.ok, t).toBe(true);
      }
      const r = await um<{ f: boolean; m: string }>(c,
        `SELECT to_regprocedure('public._integracao_layout()') IS NULL AS f,
                md5(pg_get_functiondef('public._seed_tenant_defaults(uuid)'::regprocedure)) AS m`);
      expect(r).toEqual({ f: true, m: MD5_ANTES.seed });
    });
  });

  it.skipIf(!MIG_TXN)("inverso 1 recusa se _seed_tenant_defaults mudou por outra frente depois da migration 1", async () => {
    // D40/revisão T1 #1 (Important #1): simula outra frente redefinindo _seed_tenant_defaults DEPOIS da migration 1
    // (corpo diferente, sem o TRECHO_SEED e sem bater com o "antes") — o inverso deve RECUSAR (RAISE P0001 ASCII) em
    // vez de sobrescrever essa mudança em silêncio.
    await withTx(async (c) => {
      await prepara(c, 1);
      await c.query(`
        CREATE OR REPLACE FUNCTION public._seed_tenant_defaults(_tid uuid)
         RETURNS void
         LANGUAGE plpgsql
         SECURITY DEFINER
         SET search_path TO 'public'
        AS $function$
        BEGIN
          -- [outra frente] corpo diferente, sem relação com o texto de antes nem com o TRECHO_SEED.
          INSERT INTO public.tenant_config (tenant_id) VALUES (_tid) ON CONFLICT (tenant_id) DO NOTHING;
        END;
        $function$;
      `);
      await expect(aplica(c, INVERSOS[0])).rejects.toThrow(
        /integracao_1_down: _seed_tenant_defaults mudou depois da migration 1 - refazer o inverso/,
      );
      // ASCII-only, como toda mensagem desta frente (regra global).
      const msg = await um<{ m: string }>(c,
        `SELECT 'integracao_1_down: _seed_tenant_defaults mudou depois da migration 1 - refazer o inverso' AS m`);
      expect(/^[\x00-\x7F]*$/.test(msg.m)).toBe(true);
      // as tabelas continuam existindo (a recusa aconteceu no $guarda$, antes de qualquer DROP).
      const r = await um<{ ok: boolean }>(c, `SELECT to_regclass('public.integracao_produtos') IS NOT NULL AS ok`);
      expect(r.ok).toBe(true);
    });
  });
});
```

- [ ] **Step 4: Rodar e ver falhar (N3)**

```bash
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres
INTEG_DONO_AVISADO=sim bash .superpowers/integracao/n3.sh antes t1
INTEGRACAO_MIG_TXN=1 npx vitest run --no-file-parallelism tests/integration/integracao-1-tabelas.test.ts
bash .superpowers/integracao/n3.sh depois t1
```
Expected: FAIL — `ENOENT … 20261007100000_integracao_1_tabelas.sql` (e o estático "há pelo menos a migration 1").

- [ ] **Step 5: Escrever a migration 1 — `supabase/migrations/20261007100000_integracao_1_tabelas.sql`**

```sql
-- Integração + API por loja (spec docs/superpowers/specs/2026-09-26-tela-integracao-api-design.md) — 1/6: TABELAS.
-- 7 tabelas novas, TODAS com RLS LIGADA e NENHUMA policy + REVOKE ALL de PUBLIC/anon/authenticated (padrão
-- kanban_snapshot): leitura/escrita SÓ por RPC SECURITY DEFINER (migrations 2–6), que confere a permissão `integracao`
-- e mascara o custo (inv. #12). service_role fica com os grants padrão (a rota da API usa só as funções _integracao_*).
--   integracao_config   1 linha/loja; semeada p/ as lojas atuais aqui e p/ loja nova/reset por _seed_tenant_defaults (N9/n6)
--   integracao_segredo  segredo do HMAC da assinatura (nota 6) — global, 1 linha
--   integracao_produtos estado + retrato; 1:1 com modelos por TRIGGER enforce_unique_fk + índice plano (nunca UNIQUE)
--   integracao_linhas   a TABELA ESPELHO lida pela API (1 linha do produto + N sublinhas)
--   integracao_chaves   só o SHA-256 da chave + os 4 últimos caracteres
--   integracao_acessos  reserva do acesso (V4) + agregados por (tipo+IP/chave, minuto) (R11/D19)
--   integracao_log      log da tela, SEM FK p/ modelos (a prova não some — delta nota 8)
-- Redefine _seed_tenant_defaults (+1 INSERT, texto marcado [integracao v1]; diff mínimo conferido pela suíte).
-- Contagens: +1 função (_integracao_layout) | +1 gatilho (trg_integracao_produtos_unico).
-- Inverso: supabase/rollback/20261007100000_integracao_1_tabelas_down.sql (SÓ depois dos inversos 6..2).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '3s';

DO $guarda$
DECLARE
  v_def text := pg_get_functiondef('public._seed_tenant_defaults(uuid)'::regprocedure);
BEGIN
  IF md5(v_def) <> '01bd241680e24fdb665ca8ae81a6a1a3' AND position('[integracao v1]' IN v_def) = 0 THEN
    RAISE EXCEPTION 'integracao_1: _seed_tenant_defaults com texto inesperado (md5 %) - refazer o diff', md5(v_def)
      USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public.enforce_unique_fk()') IS NULL THEN
    RAISE EXCEPTION 'integracao_1: enforce_unique_fk ausente' USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

CREATE OR REPLACE FUNCTION public._integracao_layout()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  -- Ordem FIXA do layout do pedido (P-60 B). 1-17 = layout (padrão marcado); 18 = Foto (opcional, P-83 A).
  SELECT ARRAY['nome', 'ref_sku', 'preco_anterior', 'preco_venda', 'peso', 'ncm', 'preco_custo', 'cor_base',
               'cor_apelido', 'tamanho', 'titulo', 'descricao', 'keywords', 'metatag', 'comprimento', 'largura',
               'altura', 'foto']::text[]
$function$;
REVOKE EXECUTE ON FUNCTION public._integracao_layout() FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.integracao_config (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id),
  campos text[] NOT NULL DEFAULT (public._integracao_layout())[1:17],
  limite_por_minuto integer NOT NULL DEFAULT 60
    CONSTRAINT integracao_config_limite_chk CHECK (limite_por_minuto BETWEEN 1 AND 600),
  -- P-89 A (plano gratuito do Cloudflare): padrão 50; a FAIXA segue 1–500 (aumentar depois = aba API, sem migration)
  max_por_pagina integer NOT NULL DEFAULT 50
    CONSTRAINT integracao_config_pagina_chk CHECK (max_por_pagina BETWEEN 1 AND 500),
  validade_foto_dias integer NOT NULL DEFAULT 7
    CONSTRAINT integracao_config_foto_chk CHECK (validade_foto_dias BETWEEN 1 AND 30),
  bloqueio_tentativas integer NOT NULL DEFAULT 10
    CONSTRAINT integracao_config_bloqueio_chk CHECK (bloqueio_tentativas BETWEEN 3 AND 100),
  rev integer NOT NULL DEFAULT 1,
  atualizado_por uuid,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT integracao_config_campos_chk CHECK (campos <@ public._integracao_layout())
);

CREATE TABLE IF NOT EXISTS public.integracao_segredo (
  id smallint PRIMARY KEY DEFAULT 1 CONSTRAINT integracao_segredo_um CHECK (id = 1),
  segredo bytea NOT NULL DEFAULT extensions.gen_random_bytes(32),
  criado_em timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.integracao_segredo (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.integracao_produtos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  modelo_id uuid NOT NULL REFERENCES public.modelos(id) ON DELETE CASCADE,
  estado text NOT NULL DEFAULT 'nao_integravel'
    CONSTRAINT integracao_produtos_estado_chk CHECK (estado IN ('nao_integravel', 'integravel', 'integrado')),
  campos text[] NOT NULL DEFAULT '{}'::text[],
  retrato jsonb,
  assinatura text,
  variantes_chaves uuid[],
  marcado_por uuid,
  marcado_em timestamptz,
  integrado_em timestamptz,
  integrado_chave_id uuid,
  desfeito_por uuid,
  desfeito_em timestamptz,
  desfeito_motivo text,
  rev integer NOT NULL DEFAULT 1,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_integracao_produtos_modelo ON public.integracao_produtos (modelo_id);
CREATE INDEX IF NOT EXISTS idx_integracao_produtos_tenant ON public.integracao_produtos (tenant_id, estado, id);
CREATE OR REPLACE TRIGGER trg_integracao_produtos_unico BEFORE INSERT OR UPDATE OF modelo_id ON public.integracao_produtos
  FOR EACH ROW EXECUTE FUNCTION public.enforce_unique_fk('modelo_id');

CREATE TABLE IF NOT EXISTS public.integracao_linhas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  loja_nome text NOT NULL,
  modelo_id uuid NOT NULL REFERENCES public.modelos(id) ON DELETE CASCADE,
  tipo text NOT NULL CONSTRAINT integracao_linhas_tipo_chk CHECK (tipo IN ('produto', 'variante')),
  ordem integer NOT NULL,
  nome text, ref_sku text, preco_anterior text, preco_venda text, peso text, ncm text, preco_custo text,
  cor_base text, cor_apelido text, tamanho text, titulo text, descricao text, keywords text, metatag text,
  comprimento text, largura text, altura text,
  fotos text[] NOT NULL DEFAULT '{}'::text[],
  integrado_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT integracao_linhas_modelo_ordem_key UNIQUE (modelo_id, ordem)
);
CREATE INDEX IF NOT EXISTS idx_integracao_linhas_tenant ON public.integracao_linhas (tenant_id, modelo_id);

CREATE TABLE IF NOT EXISTS public.integracao_chaves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  nome text NOT NULL CONSTRAINT integracao_chaves_nome_chk CHECK (length(btrim(nome)) BETWEEN 1 AND 60),
  hash text NOT NULL CONSTRAINT integracao_chaves_hash_chk CHECK (hash ~ '^[0-9a-f]{64}$'),
  final text NOT NULL,
  criada_por uuid,
  criada_em timestamptz NOT NULL DEFAULT now(),
  revogada_por uuid,
  revogada_em timestamptz,
  ultimo_uso_em timestamptz,
  CONSTRAINT integracao_chaves_hash_key UNIQUE (hash)
);
CREATE INDEX IF NOT EXISTS idx_integracao_chaves_tenant ON public.integracao_chaves (tenant_id, criada_em DESC);

CREATE TABLE IF NOT EXISTS public.integracao_acessos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id),
  chave_id uuid REFERENCES public.integracao_chaves(id) ON DELETE SET NULL,
  ip text,
  modo text NOT NULL DEFAULT 'normal' CONSTRAINT integracao_acessos_modo_chk CHECK (modo IN ('normal', 'teste')),
  status text NOT NULL CONSTRAINT integracao_acessos_status_chk
    CHECK (status IN ('reservado', 'ok', 'teste', 'chave_invalida', 'loja_inativa', 'ip_bloqueado', 'limite_excedido')),
  agregado text,
  minuto timestamptz,
  tentativas integer NOT NULL DEFAULT 1,
  produtos_entregues integer NOT NULL DEFAULT 0,
  linhas integer NOT NULL DEFAULT 0,
  detalhe jsonb NOT NULL DEFAULT '{}'::jsonb,
  criado_em timestamptz NOT NULL DEFAULT now(),
  concluido_em timestamptz
);
CREATE INDEX IF NOT EXISTS idx_integracao_acessos_chave ON public.integracao_acessos (chave_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_integracao_acessos_ip ON public.integracao_acessos (ip, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_integracao_acessos_tenant ON public.integracao_acessos (tenant_id, criado_em DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_integracao_acessos_agregado ON public.integracao_acessos (agregado, minuto)
  WHERE agregado IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.integracao_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  acao text NOT NULL CONSTRAINT integracao_log_acao_chk CHECK (acao IN ('campos', 'editar', 'integrar', 'voltar',
    'desfazer', 'integrado', 'chave_criar', 'chave_revogar', 'config_api')),
  usuario_id uuid,
  quem text NOT NULL,
  modelo_id uuid,
  modelo_nome text,
  detalhe jsonb NOT NULL DEFAULT '{}'::jsonb,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_integracao_log_tenant ON public.integracao_log (tenant_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_integracao_log_modelo ON public.integracao_log (modelo_id);

ALTER TABLE public.integracao_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integracao_segredo ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integracao_produtos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integracao_linhas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integracao_chaves ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integracao_acessos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integracao_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.integracao_config FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.integracao_segredo FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.integracao_produtos FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.integracao_linhas FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.integracao_chaves FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.integracao_acessos FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.integracao_log FROM PUBLIC, anon, authenticated;

-- Semente das lojas atuais (N9): campos do layout marcados, Foto desmarcada (P-83 A).
INSERT INTO public.integracao_config (tenant_id) SELECT t.id FROM public.tenants t ON CONFLICT (tenant_id) DO NOTHING;

-- Loja nova e reset_loja (n6): _seed_tenant_defaults ganha 1 INSERT (resto BYTE A BYTE igual — diff na suíte).
CREATE OR REPLACE FUNCTION public._seed_tenant_defaults(_tid uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.tenant_config (tenant_id) VALUES (_tid)
  ON CONFLICT (tenant_id) DO NOTHING;

  INSERT INTO public.categorias_terceirizado (tenant_id, nome, ordem) VALUES
    (_tid, 'Corte', 0), (_tid, 'Oficina', 1), (_tid, 'PL', 2)
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

  -- Categorias de fornecedor fixas (Aviamento/Insumo/Produto Acabado/Tecido/Produto Importado).
  INSERT INTO public.categorias_fornecedor (tenant_id, nome, fixa) VALUES
    (_tid, 'Aviamento', true),
    (_tid, 'Insumo', true),
    (_tid, 'Produto Acabado', true),
    (_tid, 'Tecido', true),
    (_tid, 'Produto Importado', true)
  ON CONFLICT (tenant_id, nome) DO NOTHING;

  -- 7º BLOCO (D2): tipos de insumo iniciais — Cartão/Croqui/Etiqueta (protegido: não excluíveis).
  INSERT INTO public.tipos_insumo (tenant_id, nome, protegido) VALUES
    (_tid, 'Cartão', true),
    (_tid, 'Croqui', true),
    (_tid, 'Etiqueta', true)
  ON CONFLICT (tenant_id, nome) DO NOTHING;

  -- [integracao v1] Integração + API (set/2026): a config nasce com o padrão (campos do layout #1-#17 marcados, Foto
  -- desmarcada — P-83 A). reset_loja e a criação de loja passam por aqui (N9/n6).
  INSERT INTO public.integracao_config (tenant_id) VALUES (_tid)
  ON CONFLICT (tenant_id) DO NOTHING;
END;
$function$;

DO $pos$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['integracao_config', 'integracao_segredo', 'integracao_produtos', 'integracao_linhas',
                            'integracao_chaves', 'integracao_acessos', 'integracao_log'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE EXCEPTION 'integracao_1: tabela % ausente', t USING ERRCODE = 'P0001';
    END IF;
    IF NOT (SELECT k.relrowsecurity FROM pg_class k WHERE k.oid = ('public.' || t)::regclass) THEN
      RAISE EXCEPTION 'integracao_1: RLS desligada em %', t USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = ('public.' || t)::regclass) THEN
      RAISE EXCEPTION 'integracao_1: % tem policy', t USING ERRCODE = 'P0001';
    END IF;
    IF has_table_privilege('authenticated', 'public.' || t, 'SELECT') OR has_table_privilege('anon', 'public.' || t, 'SELECT') THEN
      RAISE EXCEPTION 'integracao_1: % legivel por anon/authenticated', t USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF position('[integracao v1]' IN pg_get_functiondef('public._seed_tenant_defaults(uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'integracao_1: _seed_tenant_defaults sem o trecho novo' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tenants t2 WHERE NOT EXISTS (SELECT 1 FROM public.integracao_config c WHERE c.tenant_id = t2.id)) THEN
    RAISE EXCEPTION 'integracao_1: loja sem integracao_config' USING ERRCODE = 'P0001';
  END IF;
  IF has_function_privilege('authenticated', 'public._integracao_layout()', 'EXECUTE') THEN
    RAISE EXCEPTION 'integracao_1: _integracao_layout executavel por authenticated' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
```

- [ ] **Step 6: Montar o inverso 1 por script (o "antes" de `_seed_tenant_defaults` vem do dump — nunca redigitado; o
      `$guarda$` recusa se a função mudou por outra frente depois desta migration — D40/revisão T1 #1)**

O `$guarda$` do inverso NÃO pode só checar, no `$pos$` final, se `_seed_tenant_defaults` voltou ao md5 de "antes" —
isso confere o resultado depois do `CREATE OR REPLACE`, não se havia uma mudança ALHEIA no meio. Sem checar ANTES de
sobrescrever, um rollback de emergência rodado depois de outra frente redefinir essa função (ex.: um fix futuro nela)
apagaria essa mudança em silêncio. O gerador (`montar_inverso_1.sh`, criado nesta Task — não versionado, igual
`dump_antes.sh`) escreve um `DO $guarda$` que só deixa passar quando `_seed_tenant_defaults` ainda é EXATAMENTE: o
"antes" (md5 `01bd241680e24fdb665ca8ae81a6a1a3`, já sem o INSERT desta frente) OU "antes" + o `TRECHO_SEED` desta
frente (mesmo texto de `tests/integration/integracao-1-tabelas.test.ts`, removido antes do md5); qualquer outro texto
(mudança de outra frente) dispara `RAISE EXCEPTION 'integracao_1_down: _seed_tenant_defaults mudou depois da
migration 1 - refazer o inverso' USING ERRCODE = 'P0001'` (ASCII) sem tocar em nenhum DROP. O `$pos$` final confere
as 7 tabelas (não só `integracao_produtos`) + `_integracao_layout`.

```bash
cat > .superpowers/integracao/mig/montar_inverso_1.sh <<'BASH'
#!/usr/bin/env bash
# Monta supabase/rollback/20261007100000_integracao_1_tabelas_down.sql. O bloco de _seed_tenant_defaults é o texto de
# ANTES (.superpowers/integracao/mig/antes/_seed_tenant_defaults.sql, de dump_antes.sh) — nunca editar à mão. Rodar de
# novo sempre que o "antes" mudar. O $guarda$ RECUSA (RAISE P0001 ASCII) a menos que _seed_tenant_defaults ainda seja a
# versão instalada pela migration 1: md5 = "antes" OU ("antes" + TRECHO_SEED removido) — D40/revisão T1 #1.
set -euo pipefail
TOP="$(git rev-parse --show-toplevel)"; cd "$TOP"
case "$TOP" in */.claude/worktrees/integracao-impl) ;; *) echo "PARE: rode de dentro da worktree integracao-impl"; exit 1;; esac
A=.superpowers/integracao/mig/antes
OUT=supabase/rollback/20261007100000_integracao_1_tabelas_down.sql
[ -f "$A/_seed_tenant_defaults.sql" ] || { echo "PARE: rode dump_antes.sh primeiro"; exit 1; }

# TRECHO_SEED literal (idêntico a tests/integration/integracao-1-tabelas.test.ts TRECHO_SEED).
TRECHO=$'\n  -- [integracao v1] Integração + API (set/2026): a config nasce com o padrão (campos do layout #1-#17 marcados, Foto\n  -- desmarcada — P-83 A). reset_loja e a criação de loja passam por aqui (N9/n6).\n  INSERT INTO public.integracao_config (tenant_id) VALUES (_tid)\n  ON CONFLICT (tenant_id) DO NOTHING;\n'

{
cat <<'SQL'
-- Inverso de 20261007100000_integracao_1_tabelas.sql — MONTADO pela Task 1 (o bloco de _seed_tenant_defaults é o texto de
-- ANTES, gerado por .superpowers/integracao/mig/dump_antes.sh a partir da cópia — nunca editar à mão). Rodar SÓ depois
-- dos inversos 6..2 (guarda LIFO). APAGA as 7 tabelas da integração (config, chaves, acessos, log, espelho) e o que houver nelas.
-- D40/revisão T1 #1: o $guarda$ recusa se _seed_tenant_defaults mudou depois da migration 1 (aceita só o "antes"
-- exato ou "antes"+TRECHO_SEED — nunca sobrescreve uma mudança de outra frente em silêncio).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '3s';

DO $guarda$
DECLARE
  v_def text;
BEGIN
  IF to_regprocedure('public._integracao_retrato_core(uuid,text[],jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'integracao_1_down: volte a migration 2 antes (LIFO)' USING ERRCODE = 'P0001';
  END IF;
  v_def := pg_get_functiondef('public._seed_tenant_defaults(uuid)'::regprocedure);
  IF md5(v_def) <> '01bd241680e24fdb665ca8ae81a6a1a3'
     AND NOT (position('[integracao v1]' IN v_def) > 0
              AND md5(replace(v_def, '
SQL
printf '%s' "$TRECHO" | tail -c +2
cat <<'SQL'
', '')) = '01bd241680e24fdb665ca8ae81a6a1a3') THEN
    RAISE EXCEPTION 'integracao_1_down: _seed_tenant_defaults mudou depois da migration 1 - refazer o inverso' USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

DROP TABLE IF EXISTS public.integracao_log;
DROP TABLE IF EXISTS public.integracao_acessos;
DROP TABLE IF EXISTS public.integracao_chaves;
DROP TABLE IF EXISTS public.integracao_linhas;
DROP TABLE IF EXISTS public.integracao_produtos;
DROP TABLE IF EXISTS public.integracao_config;
DROP TABLE IF EXISTS public.integracao_segredo;
DROP FUNCTION IF EXISTS public._integracao_layout();

SQL
printf '%s\n;\n' "$(cat "$A/_seed_tenant_defaults.sql")"
cat <<'SQL'

DO $pos$
DECLARE
  t text;
BEGIN
  IF md5(pg_get_functiondef('public._seed_tenant_defaults(uuid)'::regprocedure)) <> '01bd241680e24fdb665ca8ae81a6a1a3' THEN
    RAISE EXCEPTION 'integracao_1_down: _seed_tenant_defaults nao voltou ao texto de antes' USING ERRCODE = 'P0001';
  END IF;
  FOREACH t IN ARRAY ARRAY['integracao_config', 'integracao_segredo', 'integracao_produtos', 'integracao_linhas',
                            'integracao_chaves', 'integracao_acessos', 'integracao_log'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      RAISE EXCEPTION 'integracao_1_down: tabela % ainda existe', t USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF to_regprocedure('public._integracao_layout()') IS NOT NULL THEN
    RAISE EXCEPTION 'integracao_1_down: _integracao_layout ainda existe' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
SQL
} > "$OUT"
echo "escrito: $OUT ($(wc -l < "$OUT" | tr -d ' ') linhas)"
grep -c 'CREATE OR REPLACE FUNCTION public._seed_tenant_defaults' "$OUT"
grep -c "RAISE EXCEPTION 'integracao_1_down: _seed_tenant_defaults mudou depois da migration 1" "$OUT"
BASH
chmod +x .superpowers/integracao/mig/montar_inverso_1.sh
bash .superpowers/integracao/mig/montar_inverso_1.sh
```

- [ ] **Step 7: Rodar e ver passar (N3)**

```bash
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres
INTEG_DONO_AVISADO=sim bash .superpowers/integracao/n3.sh antes t1
INTEGRACAO_MIG_TXN=1 npx vitest run --no-file-parallelism tests/integration/integracao-1-tabelas.test.ts
bash .superpowers/integracao/n3.sh depois t1
```
Expected: PASS (estático 3 + banco 8). O `n3.sh depois` mostra a MESMA contagem de antes (495|277|false — nada vazou).

- [ ] **Step 8: Gates + commit**

```bash
bash .superpowers/integracao/gates.sh
git add -- tests/integration/integracao-helpers.ts tests/integration/integracao-1-tabelas.test.ts \
  supabase/migrations/20261007100000_integracao_1_tabelas.sql supabase/rollback/20261007100000_integracao_1_tabelas_down.sql
git commit --only -m "feat(integracao): migration 1 — 7 tabelas sem policy (RLS + REVOKE), config por loja semeada, _seed_tenant_defaults +1 INSERT, harness da suíte

Co-Authored-By: Claude <modelo real> <noreply@anthropic.com>" -- tests/integration/integracao-helpers.ts tests/integration/integracao-1-tabelas.test.ts \
  supabase/migrations/20261007100000_integracao_1_tabelas.sql supabase/rollback/20261007100000_integracao_1_tabelas_down.sql
git show --stat HEAD | tail -n +7
```

---

### Task 2: Migration 2 — retrato, HMAC, gates e leituras (`integracao_previa/listar/estado_modelos/config_ler`) + inverso 2

**Files:**
- Create: `supabase/migrations/20261007110000_integracao_2_retrato.sql`
- Create: `supabase/rollback/20261007110000_integracao_2_retrato_down.sql`
- Test: `tests/integration/integracao-2-retrato.test.ts`

**Interfaces:**
- Consumes: Task 1 (tabelas, `_integracao_layout()`, helpers); `_skus_calc_ref_tipo(uuid,text,text)`,
  `_sku_tamanho_lado(text,text)`, `_sku_variante_key(uuid,uuid)`, `_custo_unitario_modelos_core(uuid[])`,
  `_pode_ver_custos()`, `_kanban_status_gate(uuid,uuid,text)`, `_ref_exibir_gate(uuid,text)`,
  `_kanban_status_rows(uuid)`, `user_can_view/edit`, `tenant_module_enabled`, `is_tenant_admin`, `is_super_admin`.
- Produces (internas, EXECUTE revogado dos 3): `_integracao_rotulos() → jsonb` (chave→rótulo);
  `_integracao_cfg(uuid) → integracao_config` (linha ausente = padrão, `rev` 0); `_integracao_num(numeric,integer) → text`
  (≤0/NULL → NULL; casas NULL = `trim_scale`); `_integracao_mascarar(jsonb) → jsonb`;
  `_integracao_retrato_core(_modelo_id uuid, _campos text[], _custo jsonb) → jsonb {retrato, faltas[{campo,texto}],
  completo, variantes_chaves, meta[{variante_key, tamanho_key, variante_ordem, tamanho_ordem, cor_nome, apelido_nome,
  tamanho, sku_id, sku, sku_rev, manual}]}`; `_integracao_assinar(jsonb) → text` (hex 64);
  `_integracao_gate(boolean,text,boolean,text) → jsonb {ok, motivo}`; `_integracao_gates(uuid) → jsonb {estado, origem,
  compartilhado, planejamento, preco, ref, sku, keywords}`; `_integracao_base(uuid) → TABLE(id, nome, ref, origem, colecao,
  etapa, estado, marcado_em, integrado_em)`; `_integracao_exige(_editar boolean) → uuid` (tenant); `_integracao_exige_super()
  → uuid`.
- Produces (RPC, `authenticated`): `integracao_previa(_modelo_ids uuid[]) → jsonb {campos, rotulos, precisa_ver_custos,
  pode_ver_custos, produtos[{modelo_id, nome, ref, origem, estado, reprovado, completo, faltas, retrato, assinatura}]}`;
  `integracao_listar(_situacao text, _filtros jsonb, _pagina integer) → jsonb {pagina, por_pagina, total, contagens{
  nao_integrados, integrados, todos}, campos, rotulos, opcoes{colecoes[], etapas[{key,label}]}, pode{editar, ver_custos,
  super, keywords}, keywords, produtos[{modelo_id, origem, colecao, etapa, estado, marcado_em, integrado_em, rev, raw{nome,
  ref, preco_anterior, preco_venda, peso_kg, ncm, titulo_pagina, descricao_produto, comprimento_cm, largura_cm, altura_cm,
  fotos_modelo, tamanho_tipo}, vivo, faltas, completo, sublinhas, retrato, retrato_difere[], gates}]}`;
  `integracao_estado_modelos(_ids uuid[]) → jsonb {<modelo_id>: {estado, campos, marcado_em, integrado_em}}` (só
  integrável/integrado; qualquer usuário da loja; `_ids` NULL = todos da loja, TETO 5000 — N5); `integracao_config_ler() → jsonb {campos, layout, rotulos, rev, api|null}`.

- [ ] **Step 1: Escrever o teste (falha: migration 2 ausente)**

`tests/integration/integracao-2-retrato.test.ts`:

```ts
/** Integração + API — migration 2 (retrato/leituras). Plano Task 2. Só na cópia (N3), txn revertida. */
import { describe, it, expect } from "vitest";
import { hasDb, withTx, comoUsuario, um } from "./db";
import {
  CAMPOS_PADRAO, INVERSOS, LAYOUT, LOCAL, MIG_TXN, T, U, aplica, camposLoja, comoUsuarioCom, keywordsLoja, modeloInterno, prepara, revenda,
} from "./integracao-helpers";

const AVE_RARA = "20c84a36-b7a0-4c26-ac59-52cb11e9d979"; // loja com mais modelos na cópia (medição)
type Ret = { retrato: { v: number; campos: string[]; linhas: Array<{ tipo: string; ordem: number; valores: Record<string, string | null>; fotos: string[] }> };
  faltas: Array<{ campo: string; texto: string }>; completo: boolean; meta: unknown[]; variantes_chaves: string[] | null };
async function retrato(c: any, id: string, campos: readonly string[] = CAMPOS_PADRAO): Promise<Ret> {
  return (await um<{ r: Ret }>(c,
    `SELECT public._integracao_retrato_core($1, $2::text[], (public._custo_unitario_modelos_core(ARRAY[$1::uuid]) -> $1::text)) AS r`,
    [id, campos])).r;
}

describe.skipIf(!hasDb || !LOCAL)("integracao — migration 2: retrato", () => {
  it("interno completo: ordem fixa, formatos (D4), sublinhas P/M com SKU gravado, custo previsto, metatag = descrição", async () => {
    await withTx(async (c) => {
      await prepara(c, 2);
      await comoUsuario(c, U);
      await keywordsLoja(c, "moda feminina, roupas");
      const m = await modeloInterno(c);
      const r = await retrato(c, m.id);
      expect(r.completo).toBe(true);
      expect(r.faltas).toEqual([]);
      expect(r.retrato.campos).toEqual([...CAMPOS_PADRAO]);
      expect(r.retrato.linhas.map((l) => l.tipo)).toEqual(["produto", "variante", "variante"]);
      const p = r.retrato.linhas[0].valores;
      expect(Object.keys(p)).toEqual(expect.arrayContaining([...CAMPOS_PADRAO]));
      expect(p).toMatchObject({
        ref_sku: m.ref, preco_anterior: "179.90", preco_venda: "159.90", peso: "0.220", ncm: "6109.10.00", preco_custo: "62.10",
        cor_base: null, cor_apelido: null, tamanho: null, titulo: "Blusa Brisa Manga Longa",
        descricao: "Blusa em viscose, manga longa.", metatag: "Blusa em viscose, manga longa.", keywords: "moda feminina, roupas",
        comprimento: "68", largura: "42", altura: "2",
      });
      const [s1, s2] = r.retrato.linhas.slice(1);
      expect(s1.valores.nome).toBe(`${p.nome} P`);
      expect(s1.valores.ref_sku).toBe(`${m.ref}-P`);
      expect(s1.valores.tamanho).toBe("P");
      expect(s1.valores.cor_base).toMatch(/^Branco /);
      expect(s1.valores.cor_apelido).toMatch(/^Off-white /);
      expect(s1.valores.preco_venda).toBe("159.90");
      expect(s2.valores.tamanho).toBe("M");
      expect(r.retrato.linhas[0].fotos).toEqual([]); // foto não marcada no padrão
      expect(r.variantes_chaves).toBeNull(); // interno
    });
  });

  it("faltas: marcado vazio vira falta com o rótulo; 0 não conta; estimado não conta (D8)", async () => {
    await withTx(async (c) => {
      await prepara(c, 2);
      await comoUsuario(c, U);
      await keywordsLoja(c, null);
      const m = await modeloInterno(c);
      await c.query(`UPDATE public.modelos SET ncm = '  ', peso_kg = 0, custo_peca_previsto = 0 WHERE id = $1`, [m.id]);
      const r = await retrato(c, m.id);
      expect(r.completo).toBe(false);
      expect(r.faltas).toEqual(expect.arrayContaining([
        { campo: "ncm", texto: "NCM" }, { campo: "peso", texto: "Peso" }, { campo: "keywords", texto: "Keywords" },
        { campo: "preco_custo", texto: "Preço de custo (o estimado não conta)" },
      ]));
    });
  });

  it("cor sem apelido = VAZIO e NÃO é falta (P-74 A); SKU faltando e 0 sublinhas são faltas", async () => {
    await withTx(async (c) => {
      await prepara(c, 2);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const a = await modeloInterno(c, { semApelido: true });
      const ra = await retrato(c, a.id);
      expect(ra.retrato.linhas[1].valores.cor_apelido).toBeNull();
      expect(ra.completo).toBe(true);
      const b = await modeloInterno(c, { semSku: true });
      const rb = await retrato(c, b.id);
      expect(rb.faltas.find((f) => f.campo === "ref_sku")?.texto).toMatch(/^2 variantes sem SKU \(ex\.: Branco .+, tam\. P\)$/);
      await c.query(`DELETE FROM public.modelo_grades WHERE modelo_id = $1`, [b.id]);
      const rc = await retrato(c, b.id);
      expect(rc.faltas).toEqual(expect.arrayContaining([{ campo: "variantes", texto: "variantes cor × tamanho" }]));
      expect(rc.retrato.linhas).toHaveLength(1);
    });
  });

  it("Foto marcada: fotos só na linha do produto; caminho fora de <tenant>/ = 'foto de outra loja' (nota 7)", async () => {
    await withTx(async (c) => {
      await prepara(c, 2);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await modeloInterno(c, { fotos: [`${T}/fotos_modelo/a.jpg`, `${T}/fotos_modelo/b.jpg`] });
      const r = await retrato(c, m.id, LAYOUT);
      expect(r.retrato.linhas[0].fotos).toEqual([`${T}/fotos_modelo/a.jpg`, `${T}/fotos_modelo/b.jpg`]);
      expect(r.retrato.linhas[1].fotos).toEqual([]);
      expect("foto" in r.retrato.linhas[0].valores).toBe(false);
      await c.query(`UPDATE public.modelos SET fotos_modelo = ARRAY['00000000-0000-0000-0000-000000000001/x.jpg'] WHERE id = $1`, [m.id]);
      expect((await retrato(c, m.id, LAYOUT)).faltas).toEqual(expect.arrayContaining([{ campo: "foto", texto: "foto de outra loja" }]));
      await c.query(`UPDATE public.modelos SET fotos_modelo = '{}' WHERE id = $1`, [m.id]);
      expect((await retrato(c, m.id, LAYOUT)).faltas).toEqual(expect.arrayContaining([{ campo: "foto", texto: "Foto do Modelo" }]));
    });
  });

  it("revenda: custo = unitário da OC/cadastro (40.00); variantes_chaves = conjunto cor+apelido do espelho", async () => {
    await withTx(async (c) => {
      await prepara(c, 2);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await revenda(c);
      const r = await retrato(c, m.id);
      expect(r.retrato.linhas[0].valores.preco_custo).toBe("40.00");
      const k = await um<{ k: string }>(c, `SELECT public._sku_variante_key($1, $2)::text AS k`, [m.corId, m.apelidoId]);
      expect(r.variantes_chaves).toEqual([k.k]);
    });
  });

  it("assinatura = HMAC (64 hex), estável, muda com o dado e ≠ sha256 simples do retrato (nota 6)", async () => {
    await withTx(async (c) => {
      await prepara(c, 2);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await modeloInterno(c);
      const q = `SELECT public._integracao_assinar(public._integracao_retrato_core($1, $2::text[],
                   public._custo_unitario_modelos_core(ARRAY[$1::uuid]) -> $1::text) -> 'retrato') AS a,
                 encode(extensions.digest((public._integracao_retrato_core($1, $2::text[],
                   public._custo_unitario_modelos_core(ARRAY[$1::uuid]) -> $1::text) -> 'retrato')::text, 'sha256'), 'hex') AS h`;
      const a1 = await um<{ a: string; h: string }>(c, q, [m.id, CAMPOS_PADRAO]);
      expect(a1.a).toMatch(/^[0-9a-f]{64}$/);
      expect(a1.a).not.toBe(a1.h);
      expect((await um<{ a: string }>(c, q, [m.id, CAMPOS_PADRAO])).a).toBe(a1.a);
      await c.query(`UPDATE public.modelos SET ncm = '6109.90.00' WHERE id = $1`, [m.id]);
      expect((await um<{ a: string }>(c, q, [m.id, CAMPOS_PADRAO])).a).not.toBe(a1.a);
    });
  });
});

describe.skipIf(!hasDb || !LOCAL)("integracao — migration 2: RPCs de leitura", () => {
  it("previa: sem permissão = 42501; com ver e sem custos = custo mascarado e MESMA assinatura do super", async () => {
    await withTx(async (c) => {
      await prepara(c, 2);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await modeloInterno(c);
      const sup = await um<{ r: any }>(c, `SELECT public.integracao_previa(ARRAY[$1::uuid]) AS r`, [m.id]);
      expect(sup.r.produtos[0].retrato.linhas[0].valores.preco_custo).toBe("62.10");
      await comoUsuarioCom(c, "00000000-0000-4000-8000-00000000ce01", []);
      await c.query("SAVEPOINT a");
      await expect(c.query(`SELECT public.integracao_previa(ARRAY[$1::uuid])`, [m.id])).rejects.toThrow(/Sem permissão para ver a Integração/);
      await c.query("ROLLBACK TO SAVEPOINT a");
      await comoUsuarioCom(c, "00000000-0000-4000-8000-00000000ce02", [["integracao", true, false]]);
      const v = await um<{ r: any }>(c, `SELECT public.integracao_previa(ARRAY[$1::uuid]) AS r`, [m.id]);
      for (const l of v.r.produtos[0].retrato.linhas) expect(l.valores.preco_custo).toBeNull();
      expect(v.r.produtos[0].assinatura).toBe(sup.r.produtos[0].assinatura);
      expect(v.r.pode_ver_custos).toBe(false);
      expect(v.r.precisa_ver_custos).toBe(true);
    });
  });

  it("listar: Não integrados por padrão; reprovado some; busca por REF; gates do card campo a campo (D24)", async () => {
    await withTx(async (c) => {
      await prepara(c, 2);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await modeloInterno(c);
      const rep = await modeloInterno(c);
      await c.query(`UPDATE public.modelos SET status_planejamento = 'reprovado' WHERE id = $1`, [rep.id]);
      const l = await um<{ r: any }>(c, `SELECT public.integracao_listar(NULL, jsonb_build_object('busca', $1::text), 1) AS r`, [m.ref]);
      expect(l.r.total).toBe(1);
      expect(l.r.produtos[0]).toMatchObject({ modelo_id: m.id, estado: "nao_integravel", completo: true, origem: "interno" });
      expect(l.r.produtos[0].raw).toMatchObject({ ref: m.ref, preco_venda: 159.9, ncm: "6109.10.00", tamanho_tipo: "letra" });
      expect(l.r.pode).toMatchObject({ editar: true, super: true, keywords: true });
      const lr = await um<{ r: any }>(c, `SELECT public.integracao_listar('todos', jsonb_build_object('busca', $1::text), 1) AS r`, [rep.ref]);
      expect(lr.r.total).toBe(0);
      await comoUsuarioCom(c, "00000000-0000-4000-8000-00000000ce03", [["integracao", true, true]]);
      const g = (await um<{ r: any }>(c, `SELECT public.integracao_listar(NULL, jsonb_build_object('busca', $1::text), 1) AS r`, [m.ref])).r.produtos[0].gates;
      expect(g.compartilhado).toEqual({ ok: false, motivo: "Precisa da permissão de editar o Planejamento (ou o Desenvolvimento antes do envio à Explosão)." });
      expect(g.planejamento).toEqual({ ok: false, motivo: "Precisa da permissão de editar o Planejamento." });
      expect(g.preco).toEqual({ ok: false, motivo: "Precisa da permissão de preço de venda." });
      expect(g.ref).toEqual({ ok: false, motivo: "Precisa da permissão de editar o Desenvolvimento." });
      expect(g.keywords).toEqual({ ok: false, motivo: "Só o admin da loja muda as Keywords." });
      await comoUsuarioCom(c, "00000000-0000-4000-8000-00000000ce04", [["integracao", true, true], ["criacao_planejamento", true, true],
        ["criacao_planejamento:preco_venda", true, true], ["criacao_desenvolvimento", true, true]]);
      const g2 = (await um<{ r: any }>(c, `SELECT public.integracao_listar(NULL, jsonb_build_object('busca', $1::text), 1) AS r`, [m.ref])).r.produtos[0].gates;
      expect(g2.compartilhado.ok && g2.planejamento.ok && g2.preco.ok && g2.sku.ok).toBe(true);
      expect(g2.ref.ok).toBe(false);
      expect(g2.ref.motivo).toMatch(/^A REF aparece a partir da etapa ".+" do kanban\.$/);
    });
  });

  it("config_ler: campos para quem vê; bloco api SÓ para super admin", async () => {
    await withTx(async (c) => {
      await prepara(c, 2);
      await comoUsuario(c, U);
      const s = (await um<{ r: any }>(c, `SELECT public.integracao_config_ler() AS r`)).r;
      expect(s.campos).toEqual([...CAMPOS_PADRAO]);
      expect(s.layout).toEqual([...LAYOUT]);
      expect(s.api).toEqual({ limite_por_minuto: 60, max_por_pagina: 50, validade_foto_dias: 7, bloqueio_tentativas: 10 });
      await comoUsuarioCom(c, "00000000-0000-4000-8000-00000000ce05", [["integracao", true, false]]);
      expect((await um<{ r: any }>(c, `SELECT public.integracao_config_ler() AS r`)).r.api).toBeNull();
      expect((await um<{ r: any }>(c, `SELECT public.integracao_estado_modelos(ARRAY[]::uuid[]) AS r`)).r).toEqual({});
    });
  });

  it("desempenho: listar (página de 50) e previa (50) na maior loja da cópia em < 3 s cada", async () => {
    await withTx(async (c) => {
      await prepara(c, 2);
      await comoUsuario(c, U);
      await c.query(`UPDATE public.users SET tenant_id = $1 WHERE id = $2`, [AVE_RARA, U]);
      let t0 = Date.now();
      const l = await um<{ r: any }>(c, `SELECT public.integracao_listar('todos', '{}'::jsonb, 1) AS r`);
      const tl = Date.now() - t0;
      const ids = l.r.produtos.map((p: any) => p.modelo_id);
      t0 = Date.now();
      await c.query(`SELECT public.integracao_previa($1::uuid[])`, [ids]);
      const tp = Date.now() - t0;
      console.log(`[medição] integracao_listar 50 = ${tl} ms · integracao_previa ${ids.length} = ${tp} ms`);
      expect(ids.length).toBe(50);
      expect(tl).toBeLessThan(3000);
      expect(tp).toBeLessThan(3000);
    });
  });

  it.skipIf(!MIG_TXN)("inverso 2 desfaz a 2 (as 15 funções somem; tabelas da 1 ficam)", async () => {
    await withTx(async (c) => {
      await prepara(c, 2);
      await aplica(c, INVERSOS[1]);
      const r = await um<{ n: string; t: boolean }>(c,
        `SELECT (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace
                  AND proname IN ('_integracao_rotulos','_integracao_cfg','_integracao_num','_integracao_mascarar',
                    '_integracao_retrato_core','_integracao_assinar','_integracao_gate','_integracao_gates','_integracao_base',
                    '_integracao_exige','_integracao_exige_super','integracao_previa','integracao_listar',
                    'integracao_estado_modelos','integracao_config_ler')) AS n,
                to_regclass('public.integracao_produtos') IS NOT NULL AS t`);
      expect(r).toEqual({ n: "0", t: true });
    });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar (N3)**

```bash
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres
INTEG_DONO_AVISADO=sim bash .superpowers/integracao/n3.sh antes t2
INTEGRACAO_MIG_TXN=1 npx vitest run --no-file-parallelism tests/integration/integracao-2-retrato.test.ts
bash .superpowers/integracao/n3.sh depois t2
```
Expected: FAIL — `ENOENT … 20261007110000_integracao_2_retrato.sql`.

- [ ] **Step 3: Escrever a migration 2 — `supabase/migrations/20261007110000_integracao_2_retrato.sql`**

```sql
-- Integração + API — 2/6: RETRATO e LEITURAS (spec §3, §5, §6). Só funções (nenhuma tabela/policy/gatilho).
-- _integracao_retrato_core calcula o RETRATO no BANCO (fonte única; tela e API nunca recalculam): campos na ordem fixa
-- (P-60 B), linha do produto + sublinhas variante × tamanho (a MESMA matriz do SKU, com o SKU GRAVADO — D7), faltas
-- (marcado = obrigatório; apelido vazio NÃO é falta — P-74 A), custo = confirmado ? real : previsto (D8), fotos só na
-- linha do produto e fora de <tenant>/ = falta (nota 7). _integracao_assinar = HMAC-SHA256 com o segredo da migration 1
-- (nota 6). _integracao_gates = gates do CARD campo a campo (R2/V1/n5 — D24). RPCs: integracao_previa (resumo do
-- "Tenho certeza"; custo mascarado p/ quem não vê, assinatura do retrato COMPLETO), integracao_listar (aba Produtos),
-- integracao_estado_modelos (selos das outras telas), integracao_config_ler (config da API só p/ super admin).
-- ACL (#9): internas REVOKE dos 3; RPCs REVOKE PUBLIC/anon + GRANT authenticated. Contagens: +15 funções | +0 gatilhos.
-- Inverso: supabase/rollback/20261007110000_integracao_2_retrato_down.sql (SÓ depois do inverso 3).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '3s';

DO $guarda$
BEGIN
  IF to_regclass('public.integracao_produtos') IS NULL THEN
    RAISE EXCEPTION 'integracao_2: aplique a migration 1 antes' USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._skus_calc_ref_tipo(uuid,text,text)') IS NULL
     OR to_regprocedure('public._custo_unitario_modelos_core(uuid[])') IS NULL
     OR to_regprocedure('public._kanban_status_gate(uuid,uuid,text)') IS NULL
     OR to_regprocedure('public._ref_exibir_gate(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'integracao_2: dependencia ausente (SKU previa / custo / kanban)' USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

CREATE OR REPLACE FUNCTION public._integracao_rotulos()
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'nome', 'Nome', 'ref_sku', 'REF / SKU', 'preco_anterior', 'Preço anterior', 'preco_venda', 'Preço de venda',
    'peso', 'Peso', 'ncm', 'NCM', 'preco_custo', 'Preço de custo', 'cor_base', 'Cor base', 'cor_apelido', 'Cor apelido',
    'tamanho', 'Tamanho', 'titulo', 'Título para a página', 'descricao', 'Descrição', 'keywords', 'Keywords',
    'metatag', 'Metatag Description', 'comprimento', 'Comprimento', 'largura', 'Largura', 'altura', 'Altura',
    'foto', 'Foto')
$function$;

CREATE OR REPLACE FUNCTION public._integracao_cfg(_tenant uuid)
 RETURNS public.integracao_config
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c public.integracao_config;
BEGIN
  SELECT * INTO c FROM public.integracao_config WHERE tenant_id = _tenant;
  IF NOT FOUND THEN
    -- linha ausente = padrão (D25): layout 1-17 marcado, Foto desmarcada, 60/50/7/10 (P-89 A); rev 0 = "nunca salva"
    c.tenant_id := _tenant;
    c.campos := (public._integracao_layout())[1:17];
    c.limite_por_minuto := 60;
    c.max_por_pagina := 50;
    c.validade_foto_dias := 7;
    c.bloqueio_tentativas := 10;
    c.rev := 0;
    c.atualizado_em := now();
  END IF;
  RETURN c;
END
$function$;

CREATE OR REPLACE FUNCTION public._integracao_num(_v numeric, _casas integer)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  -- D4: texto com ponto; ≤ 0 ou NULL = NULL (0 nunca conta como preenchido); _casas NULL = sem zeros à direita.
  SELECT CASE WHEN _v IS NULL OR _v <= 0 THEN NULL
              WHEN _casas IS NULL THEN trim_scale(_v)::text
              ELSE round(_v, _casas)::text END
$function$;

CREATE OR REPLACE FUNCTION public._integracao_mascarar(_retrato jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  -- inv. #12: preco_custo := null em TODAS as linhas (a assinatura continua sendo a do retrato completo).
  SELECT CASE WHEN _retrato IS NULL OR jsonb_typeof(_retrato -> 'linhas') <> 'array' THEN _retrato
    ELSE jsonb_set(_retrato, '{linhas}', coalesce((
      SELECT jsonb_agg(CASE WHEN (x.l -> 'valores') ? 'preco_custo'
                            THEN jsonb_set(x.l, '{valores,preco_custo}', 'null'::jsonb) ELSE x.l END ORDER BY x.n)
        FROM jsonb_array_elements(_retrato -> 'linhas') WITH ORDINALITY AS x(l, n)), '[]'::jsonb)) END
$function$;

CREATE OR REPLACE FUNCTION public._integracao_retrato_core(_modelo_id uuid, _campos text[], _custo jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  m public.modelos%ROWTYPE;
  v_campos text[];
  v_rot jsonb := public._integracao_rotulos();
  v_kw text;
  v_tipo text;
  v_custo numeric;
  c text;
  v_val jsonb;
  v_prod jsonb := '{}'::jsonb;
  v_fotos text[] := '{}'::text[];
  v_linhas jsonb := '[]'::jsonb;
  v_meta jsonb := '[]'::jsonb;
  v_faltas jsonb := '[]'::jsonb;
  v_n integer := 0;
  v_sem_sku integer := 0;
  v_ex_sku text;
  v_sem_cor integer := 0;
  v_sem_tam integer := 0;
  v_tam text;
  v_linha jsonb;
  v_chaves uuid[];
  s record;
BEGIN
  SELECT * INTO m FROM public.modelos WHERE id = _modelo_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  -- só chaves conhecidas, na ORDEM FIXA do layout (P-60 B)
  v_campos := ARRAY(SELECT u.x FROM unnest(public._integracao_layout()) WITH ORDINALITY AS u(x, n)
                     WHERE u.x = ANY(coalesce(_campos, '{}'::text[])) ORDER BY u.n);
  SELECT tc.keywords INTO v_kw FROM public.tenant_config tc WHERE tc.tenant_id = m.tenant_id;
  v_tipo := coalesce(m.tamanho_tipo, 'letra');
  v_custo := CASE WHEN coalesce((_custo ->> 'confirmado')::boolean, false) THEN (_custo ->> 'real')::numeric
                  ELSE (_custo ->> 'previsto')::numeric END;

  -- linha do PRODUTO
  FOREACH c IN ARRAY v_campos LOOP
    CONTINUE WHEN c = 'foto';
    IF c IN ('cor_base', 'cor_apelido', 'tamanho') THEN
      v_prod := v_prod || jsonb_build_object(c, NULL::text);  -- "só variante": vazia na linha do produto
      CONTINUE;
    END IF;
    v_val := CASE c
      WHEN 'nome' THEN to_jsonb(nullif(btrim(m.nome), ''))
      WHEN 'ref_sku' THEN to_jsonb(nullif(btrim(coalesce(m.ref, '')), ''))
      WHEN 'preco_anterior' THEN to_jsonb(public._integracao_num(m.preco_anterior, 2))
      WHEN 'preco_venda' THEN to_jsonb(public._integracao_num(m.preco_venda, 2))
      WHEN 'peso' THEN to_jsonb(public._integracao_num(m.peso_kg, 3))
      WHEN 'ncm' THEN to_jsonb(nullif(btrim(coalesce(m.ncm, '')), ''))
      WHEN 'preco_custo' THEN to_jsonb(public._integracao_num(v_custo, 2))
      WHEN 'titulo' THEN to_jsonb(nullif(btrim(coalesce(m.titulo_pagina, '')), ''))
      WHEN 'descricao' THEN to_jsonb(nullif(btrim(coalesce(m.descricao_produto, '')), ''))
      WHEN 'keywords' THEN to_jsonb(nullif(btrim(coalesce(v_kw, '')), ''))
      WHEN 'metatag' THEN to_jsonb(nullif(btrim(coalesce(m.descricao_produto, '')), ''))
      WHEN 'comprimento' THEN to_jsonb(public._integracao_num(m.comprimento_cm, NULL))
      WHEN 'largura' THEN to_jsonb(public._integracao_num(m.largura_cm, NULL))
      WHEN 'altura' THEN to_jsonb(public._integracao_num(m.altura_cm, NULL))
    END;
    v_prod := v_prod || jsonb_build_object(c, coalesce(v_val, 'null'::jsonb));
    IF v_val IS NULL THEN
      v_faltas := v_faltas || jsonb_build_array(jsonb_build_object('campo', c, 'texto',
        CASE c WHEN 'ref_sku' THEN 'REF' WHEN 'preco_custo' THEN 'Preço de custo (o estimado não conta)'
               ELSE v_rot ->> c END));
    END IF;
  END LOOP;

  -- SUBLINHAS: variante × tamanho com grade > 0 (mesma matriz do SKU) + o SKU GRAVADO (D7)
  FOR s IN
    SELECT k.variante_key, k.variante_ordem, k.cor_nome, k.apelido_nome, k.tamanho_key, k.tamanho_ordem,
           sk.id AS sku_id, sk.sku AS sku, sk.rev AS sku_rev, sk.manual AS manual
      FROM public._skus_calc_ref_tipo(m.id, m.ref, v_tipo) k
      LEFT JOIN public.modelo_skus sk
        ON sk.modelo_id = m.id AND sk.variante_key = k.variante_key AND sk.tamanho_key = k.tamanho_key
     ORDER BY k.variante_ordem NULLS LAST, k.tamanho_ordem NULLS LAST, k.tamanho_key
  LOOP
    v_n := v_n + 1;
    v_tam := nullif(coalesce(public._sku_tamanho_lado(s.tamanho_key, v_tipo), s.tamanho_key), '');
    v_linha := '{}'::jsonb;
    FOREACH c IN ARRAY v_campos LOOP
      CONTINUE WHEN c = 'foto';
      v_linha := v_linha || jsonb_build_object(c, CASE c
        WHEN 'nome' THEN coalesce(to_jsonb(nullif(btrim(m.nome), '') || ' ' || coalesce(v_tam, '')), 'null'::jsonb)
        WHEN 'ref_sku' THEN coalesce(to_jsonb(nullif(btrim(coalesce(s.sku, '')), '')), 'null'::jsonb)
        WHEN 'cor_base' THEN coalesce(to_jsonb(s.cor_nome), 'null'::jsonb)
        WHEN 'cor_apelido' THEN coalesce(to_jsonb(s.apelido_nome), 'null'::jsonb)
        WHEN 'tamanho' THEN coalesce(to_jsonb(v_tam), 'null'::jsonb)
        ELSE coalesce(v_prod -> c, 'null'::jsonb)
      END);
    END LOOP;
    IF 'ref_sku' = ANY(v_campos) AND nullif(btrim(coalesce(s.sku, '')), '') IS NULL THEN
      v_sem_sku := v_sem_sku + 1;
      IF v_ex_sku IS NULL THEN
        v_ex_sku := coalesce(s.cor_nome, 'sem cor') || ', tam. ' || coalesce(v_tam, s.tamanho_key);
      END IF;
    END IF;
    IF 'cor_base' = ANY(v_campos) AND s.cor_nome IS NULL THEN
      v_sem_cor := v_sem_cor + 1;
    END IF;
    IF 'tamanho' = ANY(v_campos) AND v_tam IS NULL THEN
      v_sem_tam := v_sem_tam + 1;
    END IF;
    v_linhas := v_linhas || jsonb_build_array(jsonb_build_object(
      'tipo', 'variante', 'ordem', v_n, 'variante_key', s.variante_key, 'tamanho_key', s.tamanho_key,
      'valores', v_linha, 'fotos', '[]'::jsonb));
    v_meta := v_meta || jsonb_build_array(jsonb_build_object(
      'variante_key', s.variante_key, 'tamanho_key', s.tamanho_key, 'variante_ordem', s.variante_ordem,
      'tamanho_ordem', s.tamanho_ordem, 'cor_nome', s.cor_nome, 'apelido_nome', s.apelido_nome, 'tamanho', v_tam,
      'sku_id', s.sku_id, 'sku', s.sku, 'sku_rev', s.sku_rev, 'manual', coalesce(s.manual, false)));
  END LOOP;

  IF v_n = 0 AND v_campos && ARRAY['ref_sku', 'cor_base', 'cor_apelido', 'tamanho']::text[] THEN
    v_faltas := v_faltas || jsonb_build_array(jsonb_build_object('campo', 'variantes', 'texto', 'variantes cor × tamanho'));
  END IF;
  IF v_sem_sku = 1 THEN
    v_faltas := v_faltas || jsonb_build_array(jsonb_build_object('campo', 'ref_sku', 'texto', '1 variante sem SKU (' || v_ex_sku || ')'));
  ELSIF v_sem_sku > 1 THEN
    v_faltas := v_faltas || jsonb_build_array(jsonb_build_object('campo', 'ref_sku', 'texto',
      v_sem_sku || ' variantes sem SKU (ex.: ' || v_ex_sku || ')'));
  END IF;
  IF v_sem_cor > 0 THEN
    v_faltas := v_faltas || jsonb_build_array(jsonb_build_object('campo', 'cor_base', 'texto', v_sem_cor || ' variante(s) sem cor base'));
  END IF;
  IF v_sem_tam > 0 THEN
    v_faltas := v_faltas || jsonb_build_array(jsonb_build_object('campo', 'tamanho', 'texto', v_sem_tam || ' variante(s) sem tamanho'));
  END IF;

  -- FOTOS (só se "Foto do Modelo" marcado): modelos.fotos_modelo nas 3 origens (B1b)
  IF 'foto' = ANY(v_campos) THEN
    v_fotos := coalesce(m.fotos_modelo, '{}'::text[]);
    IF cardinality(v_fotos) = 0 THEN
      v_faltas := v_faltas || jsonb_build_array(jsonb_build_object('campo', 'foto', 'texto', 'Foto do Modelo'));
    ELSIF EXISTS (SELECT 1 FROM unnest(v_fotos) AS p(x) WHERE p.x IS NULL OR NOT starts_with(p.x, m.tenant_id::text || '/')) THEN
      v_faltas := v_faltas || jsonb_build_array(jsonb_build_object('campo', 'foto', 'texto', 'foto de outra loja'));
    END IF;
  END IF;

  -- conjunto de cores do ESPELHO do comprado (trava das variantes — D11)
  IF m.origem = 'revenda' THEN
    v_chaves := ARRAY(SELECT DISTINCT public._sku_variante_key(pv.cor_id, pv.cor_apelido_id)
                        FROM public.produtos_acabados pa
                        JOIN public.produto_acabado_variantes pv ON pv.produto_acabado_id = pa.id
                       WHERE pa.modelo_id = m.id ORDER BY 1);
  ELSIF m.origem = 'importado' THEN
    v_chaves := ARRAY(SELECT DISTINCT public._sku_variante_key(iv.cor_id, iv.cor_apelido_id)
                        FROM public.produtos_importados pi
                        JOIN public.produto_importado_variantes iv ON iv.produto_importado_id = pi.id
                       WHERE pi.modelo_id = m.id ORDER BY 1);
  END IF;

  RETURN jsonb_build_object(
    'retrato', jsonb_build_object('v', 1, 'campos', to_jsonb(v_campos),
      'linhas', jsonb_build_array(jsonb_build_object('tipo', 'produto', 'ordem', 0, 'valores', v_prod,
                                                      'fotos', to_jsonb(v_fotos))) || v_linhas),
    'faltas', v_faltas,
    'completo', jsonb_array_length(v_faltas) = 0,
    'variantes_chaves', to_jsonb(v_chaves),
    'meta', v_meta);
END
$function$;

CREATE OR REPLACE FUNCTION public._integracao_assinar(_retrato jsonb)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT encode(extensions.hmac(convert_to(_retrato::text, 'UTF8'), s.segredo, 'sha256'), 'hex')
    FROM public.integracao_segredo s
   WHERE s.id = 1
$function$;

CREATE OR REPLACE FUNCTION public._integracao_gate(_base_ok boolean, _base_motivo text, _ok boolean, _motivo text)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'ok', coalesce(_base_ok, false) AND coalesce(_ok, false),
    'motivo', CASE WHEN NOT coalesce(_base_ok, false) THEN _base_motivo WHEN NOT coalesce(_ok, false) THEN _motivo END)
$function$;

CREATE OR REPLACE FUNCTION public._integracao_gates(_modelo_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  m public.modelos%ROWTYPE;
  v_int boolean := public.user_can_edit('integracao');
  v_plan boolean := public.user_can_edit('criacao_planejamento');
  v_dev boolean := public.user_can_edit('criacao_desenvolvimento');
  v_preco boolean;
  v_criacao boolean := public.tenant_module_enabled('criacao');
  v_mod_origem boolean;
  v_kw boolean := public.is_tenant_admin() OR public.is_super_admin();
  v_estado text;
  v_base_motivo text;
  v_base_ok boolean;
  v_enviado boolean;
  v_revelada boolean;
  v_etapa text;
BEGIN
  SELECT * INTO m FROM public.modelos WHERE id = _modelo_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  v_preco := v_plan AND public.user_can_edit('criacao_planejamento:preco_venda');
  v_mod_origem := CASE coalesce(m.origem, 'interno')
                    WHEN 'revenda' THEN public.tenant_module_enabled('produto_acabado')
                    WHEN 'importado' THEN public.tenant_module_enabled('produto_importado')
                    ELSE true END;
  SELECT ip.estado INTO v_estado FROM public.integracao_produtos ip WHERE ip.modelo_id = m.id;
  v_estado := coalesce(v_estado, 'nao_integravel');
  v_base_motivo := CASE
    WHEN v_estado <> 'nao_integravel' THEN 'Travado pela integração.'
    WHEN NOT v_int THEN 'Precisa da permissão de editar a Integração.'
    WHEN NOT v_criacao THEN 'O módulo Estilo & Engenharia está desligado nesta loja.'
    WHEN NOT v_mod_origem THEN 'O módulo da origem deste produto (Produto Acabado/Importado) está desligado nesta loja.'
  END;
  v_base_ok := v_base_motivo IS NULL;
  v_enviado := coalesce(m.enviado_cad, false);
  v_revelada := coalesce(m.ordem_criacao_enviada, false)
    AND coalesce(public._ref_exibir_gate(m.tenant_id, public._kanban_status_gate(m.tenant_id, m.id, m.status_desenvolvimento)), false);
  SELECT r.lbl INTO v_etapa
    FROM public._kanban_status_rows(m.tenant_id) r
   WHERE r.key = coalesce(nullif(btrim((SELECT tc.ref_exibir_status FROM public.tenant_config tc WHERE tc.tenant_id = m.tenant_id)), ''), 'aprovado')
   ORDER BY r.ord
   LIMIT 1;
  RETURN jsonb_build_object(
    'estado', v_estado,
    'origem', coalesce(m.origem, 'interno'),
    'compartilhado', public._integracao_gate(v_base_ok, v_base_motivo, v_plan OR (v_dev AND NOT v_enviado),
      'Precisa da permissão de editar o Planejamento (ou o Desenvolvimento antes do envio à Explosão).'),
    'planejamento', public._integracao_gate(v_base_ok, v_base_motivo, v_plan, 'Precisa da permissão de editar o Planejamento.'),
    'preco', public._integracao_gate(v_base_ok, v_base_motivo, v_preco, 'Precisa da permissão de preço de venda.'),
    'ref', public._integracao_gate(v_base_ok, v_base_motivo, v_dev AND v_revelada AND NOT v_enviado,
      CASE WHEN NOT v_dev THEN 'Precisa da permissão de editar o Desenvolvimento.'
           WHEN NOT v_revelada THEN format('A REF aparece a partir da etapa "%s" do kanban.', coalesce(v_etapa, 'Aprovado'))
           ELSE 'REF travada pelo envio à Explosão — não pode mudar depois desse ponto.' END),
    'sku', public._integracao_gate(v_base_ok, v_base_motivo, v_plan, 'Precisa da permissão de editar o Planejamento.'),
    'keywords', public._integracao_gate(v_int, 'Precisa da permissão de editar a Integração.', v_kw,
      'Só o admin da loja muda as Keywords.'));
END
$function$;

CREATE OR REPLACE FUNCTION public._integracao_base(_tenant uuid)
 RETURNS TABLE(id uuid, nome text, ref text, origem text, colecao text, etapa text, estado text,
               marcado_em timestamptz, integrado_em timestamptz)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- P-61 A: 3 origens, qualquer etapa, SEM reprovados (D9) — exceto integrado (P-74 A: segue visível).
  WITH b AS (SELECT r.key, r.ord FROM public._kanban_status_rows(_tenant) r),
       primeira AS (SELECT b.key FROM b ORDER BY b.ord LIMIT 1)
  SELECT m.id, m.nome::text, m.ref::text, coalesce(m.origem, 'interno'),
         coalesce(co.nome::text, nullif(btrim(coalesce(m.colecao::text, '')), '')),
         CASE WHEN m.lancado THEN 'lancado'
              WHEN NOT coalesce(m.ordem_criacao_enviada, false) THEN 'planejamento'
              WHEN EXISTS (SELECT 1 FROM b WHERE b.key = lower(btrim(coalesce(m.status_desenvolvimento, ''))))
                THEN lower(btrim(m.status_desenvolvimento))
              ELSE (SELECT primeira.key FROM primeira) END,
         coalesce(ip.estado, 'nao_integravel'), ip.marcado_em, ip.integrado_em
    FROM public.modelos m
    LEFT JOIN public.colecoes co ON co.id = m.colecao_id
    LEFT JOIN public.integracao_produtos ip ON ip.modelo_id = m.id
   WHERE m.tenant_id = _tenant
     AND (coalesce(ip.estado, 'nao_integravel') = 'integrado'
          OR NOT (coalesce(m.status_planejamento, '') = 'reprovado'
                  OR lower(btrim(coalesce(m.status_desenvolvimento, ''))) = 'reprovado'))
$function$;

CREATE OR REPLACE FUNCTION public._integracao_exige(_editar boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.' USING ERRCODE = '42501';
  END IF;
  v_tenant := public.get_user_tenant_id();
  IF v_tenant IS NULL OR v_tenant = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'Loja inativa ou sem loja — operação não permitida.' USING ERRCODE = '42501';
  END IF;
  IF _editar AND NOT public.user_can_edit('integracao') THEN
    RAISE EXCEPTION 'Sem permissão para editar a Integração.' USING ERRCODE = '42501';
  END IF;
  IF NOT _editar AND NOT public.user_can_view('integracao') THEN
    RAISE EXCEPTION 'Sem permissão para ver a Integração.' USING ERRCODE = '42501';
  END IF;
  RETURN v_tenant;
END
$function$;

CREATE OR REPLACE FUNCTION public._integracao_exige_super()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Só o super admin pode fazer isto.' USING ERRCODE = '42501';
  END IF;
  v_tenant := public.get_user_tenant_id();
  IF v_tenant IS NULL OR v_tenant = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'Loja inativa ou sem loja — operação não permitida.' USING ERRCODE = '42501';
  END IF;
  RETURN v_tenant;
END
$function$;

CREATE OR REPLACE FUNCTION public.integracao_previa(_modelo_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public._integracao_exige(false);
  v_cfg public.integracao_config;
  v_ver boolean := public._pode_ver_custos();
  v_custos jsonb;
  v_ret jsonb;
  v_out jsonb := '[]'::jsonb;
  r record;
BEGIN
  IF coalesce(cardinality(_modelo_ids), 0) = 0 OR cardinality(_modelo_ids) > 200 THEN
    RAISE EXCEPTION 'Selecione de 1 a 200 produtos.' USING ERRCODE = 'P0001';
  END IF;
  v_cfg := public._integracao_cfg(v_tenant);
  v_custos := coalesce(public._custo_unitario_modelos_core(_modelo_ids), '{}'::jsonb);
  FOR r IN
    SELECT m.id, m.nome, m.ref, coalesce(m.origem, 'interno') AS origem, coalesce(ip.estado, 'nao_integravel') AS estado,
           (coalesce(m.status_planejamento, '') = 'reprovado'
            OR lower(btrim(coalesce(m.status_desenvolvimento, ''))) = 'reprovado') AS reprovado
      FROM public.modelos m
      LEFT JOIN public.integracao_produtos ip ON ip.modelo_id = m.id
     WHERE m.id = ANY(_modelo_ids) AND m.tenant_id = v_tenant
     ORDER BY m.nome, m.id
  LOOP
    v_ret := public._integracao_retrato_core(r.id, v_cfg.campos, v_custos -> r.id::text);
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'modelo_id', r.id, 'nome', r.nome, 'ref', r.ref, 'origem', r.origem, 'estado', r.estado, 'reprovado', r.reprovado,
      'completo', (v_ret ->> 'completo')::boolean, 'faltas', v_ret -> 'faltas',
      'retrato', CASE WHEN v_ver THEN v_ret -> 'retrato' ELSE public._integracao_mascarar(v_ret -> 'retrato') END,
      'assinatura', public._integracao_assinar(v_ret -> 'retrato')));
  END LOOP;
  RETURN jsonb_build_object('campos', to_jsonb(v_cfg.campos), 'rotulos', public._integracao_rotulos(),
    'precisa_ver_custos', 'preco_custo' = ANY(v_cfg.campos), 'pode_ver_custos', v_ver, 'produtos', v_out);
END
$function$;

CREATE OR REPLACE FUNCTION public.integracao_listar(_situacao text, _filtros jsonb, _pagina integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public._integracao_exige(false);
  v_cfg public.integracao_config;
  v_ver boolean := public._pode_ver_custos();
  v_sit text := coalesce(nullif(btrim(coalesce(_situacao, '')), ''), 'nao_integrados');
  v_f jsonb := coalesce(_filtros, '{}'::jsonb);
  v_busca text := nullif(btrim(coalesce(_filtros ->> 'busca', '')), '');
  v_pag integer := greatest(coalesce(_pagina, 1), 1);
  v_total integer;
  v_cont jsonb;
  v_pagina jsonb;
  v_colecoes jsonb;
  v_ids uuid[];
  v_custos jsonb := '{}'::jsonb;
  v_prod jsonb := '[]'::jsonb;
  v_ret jsonb;
  v_gravado jsonb;
  v_difere jsonb;
  v_kw text;
  v_etapas jsonb;
  r record;
BEGIN
  IF v_sit NOT IN ('nao_integrados', 'integrados', 'todos') THEN
    RAISE EXCEPTION 'Situação inválida.' USING ERRCODE = 'P0001';
  END IF;
  v_cfg := public._integracao_cfg(v_tenant);

  WITH b AS (SELECT * FROM public._integracao_base(v_tenant)),
       f AS (
         SELECT b.* FROM b
          WHERE (v_sit = 'todos' OR (v_sit = 'integrados' AND b.estado = 'integrado')
                 OR (v_sit = 'nao_integrados' AND b.estado <> 'integrado'))
            AND (v_f ->> 'colecao' IS NULL OR b.colecao = v_f ->> 'colecao')
            AND (v_f ->> 'etapa' IS NULL OR b.etapa = v_f ->> 'etapa')
            AND (v_f ->> 'origem' IS NULL OR b.origem = v_f ->> 'origem')
            AND (v_f ->> 'estado' IS NULL OR b.estado = v_f ->> 'estado')
            AND (v_busca IS NULL OR b.nome ILIKE '%' || v_busca || '%' OR coalesce(b.ref, '') ILIKE '%' || v_busca || '%'))
  SELECT jsonb_build_object(
           'nao_integrados', (SELECT count(*) FROM b WHERE b.estado <> 'integrado'),
           'integrados', (SELECT count(*) FROM b WHERE b.estado = 'integrado'),
           'todos', (SELECT count(*) FROM b)),
         (SELECT count(*) FROM f),
         coalesce((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'colecao', p.colecao, 'etapa', p.etapa, 'estado', p.estado,
                                                        'marcado_em', p.marcado_em, 'integrado_em', p.integrado_em)
                                    ORDER BY p.nome, p.id)
                     FROM (SELECT f.* FROM f ORDER BY f.nome, f.id OFFSET (v_pag - 1) * 50 LIMIT 50) p), '[]'::jsonb),
         coalesce((SELECT jsonb_agg(DISTINCT b.colecao ORDER BY b.colecao) FROM b WHERE b.colecao IS NOT NULL), '[]'::jsonb)
    INTO v_cont, v_total, v_pagina, v_colecoes;

  v_ids := ARRAY(SELECT (x.p ->> 'id')::uuid FROM jsonb_array_elements(v_pagina) AS x(p));
  IF cardinality(v_ids) > 0 THEN
    v_custos := coalesce(public._custo_unitario_modelos_core(v_ids), '{}'::jsonb);
  END IF;
  FOR r IN
    SELECT m.*, e.p ->> 'colecao' AS b_colecao, e.p ->> 'etapa' AS b_etapa, e.p ->> 'estado' AS b_estado,
           e.p -> 'marcado_em' AS b_marcado, e.p -> 'integrado_em' AS b_integrado, ip.retrato AS ip_retrato, e.n AS b_n
      FROM jsonb_array_elements(v_pagina) WITH ORDINALITY AS e(p, n)
      JOIN public.modelos m ON m.id = (e.p ->> 'id')::uuid
      LEFT JOIN public.integracao_produtos ip ON ip.modelo_id = m.id
     ORDER BY e.n
  LOOP
    v_ret := public._integracao_retrato_core(r.id, v_cfg.campos, v_custos -> r.id::text);
    v_gravado := CASE WHEN r.ip_retrato IS NULL THEN NULL WHEN v_ver THEN r.ip_retrato
                      ELSE public._integracao_mascarar(r.ip_retrato) END;
    -- N10: linha integrável/integrada mostra o RETRATO; o "i" avisa quais campos do produto mudaram depois dele
    v_difere := CASE WHEN r.ip_retrato IS NULL THEN '[]'::jsonb ELSE coalesce((
      SELECT jsonb_agg(k.k ORDER BY k.k)
        FROM jsonb_object_keys(r.ip_retrato -> 'linhas' -> 0 -> 'valores') AS k(k)
       WHERE (v_ver OR k.k <> 'preco_custo')
         AND (r.ip_retrato -> 'linhas' -> 0 -> 'valores' -> k.k)
             IS DISTINCT FROM (v_ret -> 'retrato' -> 'linhas' -> 0 -> 'valores' -> k.k)), '[]'::jsonb) END;
    v_prod := v_prod || jsonb_build_array(jsonb_build_object(
      'modelo_id', r.id, 'origem', coalesce(r.origem, 'interno'), 'colecao', r.b_colecao, 'etapa', r.b_etapa,
      'estado', r.b_estado, 'marcado_em', r.b_marcado, 'integrado_em', r.b_integrado, 'rev', r.rev,
      'raw', jsonb_build_object(
        'nome', r.nome, 'ref', r.ref, 'preco_anterior', r.preco_anterior, 'preco_venda', r.preco_venda,
        'peso_kg', r.peso_kg, 'ncm', r.ncm, 'titulo_pagina', r.titulo_pagina, 'descricao_produto', r.descricao_produto,
        'comprimento_cm', r.comprimento_cm, 'largura_cm', r.largura_cm, 'altura_cm', r.altura_cm,
        'fotos_modelo', to_jsonb(coalesce(r.fotos_modelo, '{}'::text[])), 'tamanho_tipo', r.tamanho_tipo),
      'vivo', CASE WHEN v_ver THEN v_ret -> 'retrato' ELSE public._integracao_mascarar(v_ret -> 'retrato') END,
      'faltas', v_ret -> 'faltas', 'completo', (v_ret ->> 'completo')::boolean, 'sublinhas', v_ret -> 'meta',
      'retrato', v_gravado, 'retrato_difere', v_difere, 'gates', public._integracao_gates(r.id)));
  END LOOP;

  SELECT tc.keywords INTO v_kw FROM public.tenant_config tc WHERE tc.tenant_id = v_tenant;
  v_etapas := jsonb_build_array(jsonb_build_object('key', 'planejamento', 'label', 'Planejamento'))
    || coalesce((SELECT jsonb_agg(jsonb_build_object('key', s.key, 'label', s.lbl) ORDER BY s.ord)
                   FROM public._kanban_status_rows(v_tenant) s), '[]'::jsonb)
    || jsonb_build_array(jsonb_build_object('key', 'lancado', 'label', 'Lançado'));
  RETURN jsonb_build_object(
    'pagina', v_pag, 'por_pagina', 50, 'total', v_total, 'contagens', v_cont,
    'campos', to_jsonb(v_cfg.campos), 'rotulos', public._integracao_rotulos(),
    'opcoes', jsonb_build_object('colecoes', v_colecoes, 'etapas', v_etapas),
    'pode', jsonb_build_object('editar', public.user_can_edit('integracao'), 'ver_custos', v_ver,
                               'super', public.is_super_admin(), 'keywords', public.is_tenant_admin() OR public.is_super_admin()),
    'keywords', v_kw,
    'produtos', v_prod);
END
$function$;

CREATE OR REPLACE FUNCTION public.integracao_estado_modelos(_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
BEGIN
  -- Selos das outras telas (F4): qualquer usuário da loja lê SÓ estado/campos/datas (nada de retrato ou custo).
  -- _ids NULL = TODOS os integráveis/integrados da loja (1 consulta por loja, compartilhada pelas telas — Task 21).
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.' USING ERRCODE = '42501';
  END IF;
  IF coalesce(cardinality(_ids), 0) > 2000 THEN
    RAISE EXCEPTION 'No máximo 2000 produtos por consulta.' USING ERRCODE = 'P0001';
  END IF;
  -- N5 (G-plano do plano): teto de 5000 linhas (as marcadas mais recentemente) — a consulta dos selos é por loja inteira
  RETURN coalesce((
    SELECT jsonb_object_agg(x.modelo_id::text, jsonb_build_object('estado', x.estado, 'campos', to_jsonb(x.campos),
                                                                   'marcado_em', x.marcado_em, 'integrado_em', x.integrado_em))
      FROM (SELECT ip.modelo_id, ip.estado, ip.campos, ip.marcado_em, ip.integrado_em
              FROM public.integracao_produtos ip
             WHERE (_ids IS NULL OR ip.modelo_id = ANY(_ids)) AND ip.tenant_id = v_tenant
               AND ip.estado IN ('integravel', 'integrado')
             ORDER BY ip.marcado_em DESC NULLS LAST, ip.modelo_id
             LIMIT 5000) x), '{}'::jsonb);
END
$function$;

CREATE OR REPLACE FUNCTION public.integracao_config_ler()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public._integracao_exige(false);
  v_cfg public.integracao_config;
BEGIN
  v_cfg := public._integracao_cfg(v_tenant);
  -- LER os campos = quem vê a tela (a aba Produtos monta as colunas); config da API = SÓ super admin (v4)
  RETURN jsonb_build_object('campos', to_jsonb(v_cfg.campos), 'layout', to_jsonb(public._integracao_layout()),
    'rotulos', public._integracao_rotulos(), 'rev', v_cfg.rev,
    'api', CASE WHEN public.is_super_admin() THEN jsonb_build_object(
      'limite_por_minuto', v_cfg.limite_por_minuto, 'max_por_pagina', v_cfg.max_por_pagina,
      'validade_foto_dias', v_cfg.validade_foto_dias, 'bloqueio_tentativas', v_cfg.bloqueio_tentativas) END);
END
$function$;

REVOKE EXECUTE ON FUNCTION public._integracao_rotulos() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._integracao_cfg(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._integracao_num(numeric, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._integracao_mascarar(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._integracao_retrato_core(uuid, text[], jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._integracao_assinar(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._integracao_gate(boolean, text, boolean, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._integracao_gates(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._integracao_base(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._integracao_exige(boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._integracao_exige_super() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.integracao_previa(uuid[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.integracao_listar(text, jsonb, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.integracao_estado_modelos(uuid[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.integracao_config_ler() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.integracao_previa(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.integracao_listar(text, jsonb, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.integracao_estado_modelos(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.integracao_config_ler() TO authenticated;

DO $pos$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['public._integracao_rotulos()', 'public._integracao_cfg(uuid)', 'public._integracao_num(numeric,integer)',
    'public._integracao_mascarar(jsonb)', 'public._integracao_retrato_core(uuid,text[],jsonb)', 'public._integracao_assinar(jsonb)',
    'public._integracao_gate(boolean,text,boolean,text)', 'public._integracao_gates(uuid)', 'public._integracao_base(uuid)',
    'public._integracao_exige(boolean)', 'public._integracao_exige_super()'] LOOP
    IF has_function_privilege('authenticated', f, 'EXECUTE') OR has_function_privilege('anon', f, 'EXECUTE')
       OR has_function_privilege('public', f, 'EXECUTE') THEN
      RAISE EXCEPTION 'integracao_2: % executavel por PUBLIC/anon/authenticated (inv. 9)', f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY['public.integracao_previa(uuid[])', 'public.integracao_listar(text,jsonb,integer)',
    'public.integracao_estado_modelos(uuid[])', 'public.integracao_config_ler()'] LOOP
    IF NOT has_function_privilege('authenticated', f, 'EXECUTE') OR has_function_privilege('anon', f, 'EXECUTE') THEN
      RAISE EXCEPTION 'integracao_2: ACL errada em %', f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
```

- [ ] **Step 4: Escrever o inverso 2 — `supabase/rollback/20261007110000_integracao_2_retrato_down.sql`**

```sql
-- Inverso de 20261007110000_integracao_2_retrato.sql — só DROP das 15 funções novas (nenhuma função existente foi
-- redefinida pela 2). Rodar SÓ depois do inverso 3 (guarda LIFO). Não apaga dado.
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '3s';

DO $guarda$
BEGIN
  IF to_regprocedure('public.integracao_marcar(jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'integracao_2_down: volte a migration 3 antes (LIFO)' USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

DROP FUNCTION IF EXISTS public.integracao_config_ler();
DROP FUNCTION IF EXISTS public.integracao_estado_modelos(uuid[]);
DROP FUNCTION IF EXISTS public.integracao_listar(text, jsonb, integer);
DROP FUNCTION IF EXISTS public.integracao_previa(uuid[]);
DROP FUNCTION IF EXISTS public._integracao_exige_super();
DROP FUNCTION IF EXISTS public._integracao_exige(boolean);
DROP FUNCTION IF EXISTS public._integracao_base(uuid);
DROP FUNCTION IF EXISTS public._integracao_gates(uuid);
DROP FUNCTION IF EXISTS public._integracao_gate(boolean, text, boolean, text);
DROP FUNCTION IF EXISTS public._integracao_assinar(jsonb);
DROP FUNCTION IF EXISTS public._integracao_retrato_core(uuid, text[], jsonb);
DROP FUNCTION IF EXISTS public._integracao_mascarar(jsonb);
DROP FUNCTION IF EXISTS public._integracao_num(numeric, integer);
DROP FUNCTION IF EXISTS public._integracao_cfg(uuid);
DROP FUNCTION IF EXISTS public._integracao_rotulos();

DO $pos$
BEGIN
  IF to_regprocedure('public._integracao_retrato_core(uuid,text[],jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'integracao_2_down: funcoes da migration 2 ainda existem' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
```

- [ ] **Step 5: Rodar e ver passar (N3)**

```bash
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres
INTEG_DONO_AVISADO=sim bash .superpowers/integracao/n3.sh antes t2
INTEGRACAO_MIG_TXN=1 npx vitest run --no-file-parallelism tests/integration/integracao-1-tabelas.test.ts tests/integration/integracao-2-retrato.test.ts
bash .superpowers/integracao/n3.sh depois t2
```
Expected: PASS em tudo; a linha `[medição] integracao_listar 50 = … ms · integracao_previa 50 = … ms` vai para o log da
task (entra no pacote do G-migration). Acima de 3 s ⇒ PARE e chame o controlador (não "otimize" sem ruling).

- [ ] **Step 6: Gates + commit**

```bash
bash .superpowers/integracao/gates.sh
git add -- supabase/migrations/20261007110000_integracao_2_retrato.sql supabase/rollback/20261007110000_integracao_2_retrato_down.sql \
  tests/integration/integracao-2-retrato.test.ts
git commit --only -m "feat(integracao): migration 2 — retrato no banco (ordem fixa, faltas, custo real>previsto, fotos por loja), HMAC, gates do card e leituras

Co-Authored-By: Claude <modelo real> <noreply@anthropic.com>" -- supabase/migrations/20261007110000_integracao_2_retrato.sql \
  supabase/rollback/20261007110000_integracao_2_retrato_down.sql tests/integration/integracao-2-retrato.test.ts
git show --stat HEAD | tail -n +7
```

---

### Task 3: Migration 3 — estados (marcar/voltar/desfazer) e log + inverso 3

**Files:**
- Create: `supabase/migrations/20261007120000_integracao_3_estados.sql`
- Create: `supabase/rollback/20261007120000_integracao_3_estados_down.sql`
- Test: `tests/integration/integracao-3-estados.test.ts`

**Interfaces:**
- Consumes: Tasks 1–2 (`_integracao_exige`, `_integracao_exige_super`, `_integracao_cfg`, `_integracao_retrato_core`,
  `_integracao_assinar`, `_integracao_mascarar`, `_custo_unitario_modelos_core`, `_pode_ver_custos`).
- Produces (internas, REVOKE dos 3): `_integracao_quem() → text` ("Nome" ou "Nome (super admin)");
  `_integracao_logar(_tenant uuid, _acao text, _modelo_id uuid, _detalhe jsonb, _quem text) → void` (`_quem` NULL = usuário
  atual).
- Produces (RPC `authenticated`): `integracao_marcar(_itens jsonb [{modelo_id, assinatura}]) → {marcados}` (P0409
  `integracao_mudou: …`; 42501 `integracao_sem_custo: …`; P0001 incompleto/reprovado); `integracao_voltar(_modelo_ids
  uuid[]) → {voltaram}` (só `integravel`, atômico); `integracao_desfazer(_modelo_id uuid, _motivo text) → {ok}` (SÓ super
  admin, só `integrado`, motivo ≥ 3); `integracao_log_listar(_pagina integer) → {pagina, por_pagina, total, super,
  linhas[{id, acao, quem, quando, modelo_id, modelo_nome, detalhe}]}` (não-super vê só editar/integrar/voltar/desfazer/
  integrado; retrato do log mascarado sem custos).

- [ ] **Step 1: Escrever o teste (falha: migration 3 ausente)**

`tests/integration/integracao-3-estados.test.ts`:

```ts
/** Integração + API — migration 3 (estados + log). Plano Task 3. Só na cópia (N3), txn revertida. */
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, withTx, comoUsuario, um } from "./db";
import { CAMPOS_PADRAO, INVERSOS, LOCAL, MIG_TXN, T, U, aplica, camposLoja, comoUsuarioCom, keywordsLoja, modeloInterno, prepara } from "./integracao-helpers";

async function assinatura(c: Client, id: string): Promise<string> {
  return (await um<{ r: any }>(c, `SELECT public.integracao_previa(ARRAY[$1::uuid]) AS r`, [id])).r.produtos[0].assinatura;
}
async function marcar(c: Client, id: string, ass?: string): Promise<any> {
  const a = ass ?? (await assinatura(c, id));
  return (await um<{ r: any }>(c, `SELECT public.integracao_marcar(jsonb_build_array(jsonb_build_object('modelo_id', $1::uuid, 'assinatura', $2::text))) AS r`, [id, a])).r;
}
async function erro(c: Client, sql: string, params: unknown[]): Promise<{ code: string; message: string }> {
  await c.query("SAVEPOINT e");
  try {
    await c.query(sql, params);
    throw new Error("esperava erro");
  } catch (e: any) {
    await c.query("ROLLBACK TO SAVEPOINT e");
    return { code: e.code, message: e.message };
  }
}

describe.skipIf(!hasDb || !LOCAL)("integracao — migration 3: estados", () => {
  it("marcar: integrável + retrato + espelho (1 produto + 2 sublinhas) + log 'integrar'; estado_modelos enxerga", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await modeloInterno(c);
      expect(await marcar(c, m.id)).toEqual({ marcados: 1 });
      const ip = await um<{ estado: string; campos: string[]; ass: string; marcado: boolean }>(c,
        `SELECT estado, campos, assinatura AS ass, marcado_em IS NOT NULL AS marcado FROM public.integracao_produtos WHERE modelo_id = $1`, [m.id]);
      expect(ip).toMatchObject({ estado: "integravel", campos: [...CAMPOS_PADRAO], marcado: true });
      const esp = await c.query(`SELECT tipo, ordem, ref_sku, tamanho, preco_venda, integrado_em FROM public.integracao_linhas WHERE modelo_id = $1 ORDER BY ordem`, [m.id]);
      expect(esp.rows.map((r) => [r.tipo, r.ordem, r.tamanho])).toEqual([["produto", 0, null], ["variante", 1, "P"], ["variante", 2, "M"]]);
      expect(esp.rows[1].ref_sku).toBe(`${m.ref}-P`);
      expect(esp.rows[0].preco_venda).toBe("159.90");
      const log = await um<{ acao: string; quem: string; d: any }>(c,
        `SELECT acao, quem, detalhe AS d FROM public.integracao_log WHERE modelo_id = $1`, [m.id]);
      expect(log).toMatchObject({ acao: "integrar", d: { campos: 17, sublinhas: 2 } });
      expect(log.quem).toMatch(/\(super admin\)$/);
      const est = (await um<{ r: any }>(c, `SELECT public.integracao_estado_modelos(ARRAY[$1::uuid]) AS r`, [m.id])).r;
      expect(est[m.id]).toMatchObject({ estado: "integravel", campos: [...CAMPOS_PADRAO] });
      const todos = (await um<{ r: any }>(c, `SELECT public.integracao_estado_modelos(NULL) AS r`)).r;
      expect(todos[m.id]).toMatchObject({ estado: "integravel" });
      expect(Object.values(todos).every((x: any) => ["integravel", "integrado"].includes(x.estado))).toBe(true);
    });
  });

  it("assinatura velha = P0409 integracao_mudou (ASCII); marcar de novo = P0409", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await modeloInterno(c);
      const a = await assinatura(c, m.id);
      await c.query(`UPDATE public.modelos SET ncm = '6109.90.00' WHERE id = $1`, [m.id]);
      const e = await erro(c, `SELECT public.integracao_marcar(jsonb_build_array(jsonb_build_object('modelo_id', $1::uuid, 'assinatura', $2::text)))`, [m.id, a]);
      expect(e.code).toBe("P0409");
      expect(e.message).toMatch(/^integracao_mudou: /);
      expect(/^[\x20-\x7E]*$/.test(e.message)).toBe(true);
      await marcar(c, m.id);
      const e2 = await erro(c, `SELECT public.integracao_marcar(jsonb_build_array(jsonb_build_object('modelo_id', $1::uuid, 'assinatura', 'x')))`, [m.id]);
      expect(e2.code).toBe("P0409");
    });
  });

  it("incompleto e reprovado = P0001 (nada marcado)", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await comoUsuario(c, U);
      await keywordsLoja(c, null);
      const m = await modeloInterno(c);
      const e = await erro(c, `SELECT public.integracao_marcar(jsonb_build_array(jsonb_build_object('modelo_id', $1::uuid, 'assinatura', $2::text)))`,
        [m.id, await assinatura(c, m.id)]);
      expect(e).toMatchObject({ code: "P0001" });
      expect(e.message).toMatch(/incompleto — faltam: Keywords/);
      await keywordsLoja(c, "k");
      await c.query(`UPDATE public.modelos SET status_desenvolvimento = 'reprovado' WHERE id = $1`, [m.id]);
      const e2 = await erro(c, `SELECT public.integracao_marcar(jsonb_build_array(jsonb_build_object('modelo_id', $1::uuid, 'assinatura', $2::text)))`,
        [m.id, await assinatura(c, m.id)]);
      expect(e2.message).toMatch(/reprovado/);
    });
  });

  it("P-75 A: com Preço de custo marcado só integra quem VÊ custos; sem custo marcado, integra", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await modeloInterno(c);
      await comoUsuarioCom(c, "00000000-0000-4000-8000-00000000ce11", [["integracao", true, true]]);
      const a = await assinatura(c, m.id);
      const e = await erro(c, `SELECT public.integracao_marcar(jsonb_build_array(jsonb_build_object('modelo_id', $1::uuid, 'assinatura', $2::text)))`, [m.id, a]);
      expect(e).toMatchObject({ code: "42501" });
      expect(e.message).toMatch(/^integracao_sem_custo: /);
      await camposLoja(c, CAMPOS_PADRAO.filter((k) => k !== "preco_custo"));
      expect(await marcar(c, m.id)).toEqual({ marcados: 1 });
      await comoUsuarioCom(c, "00000000-0000-4000-8000-00000000ce12", [["integracao", true, false]]);
      const e2 = await erro(c, `SELECT public.integracao_voltar(ARRAY[$1::uuid])`, [m.id]);
      expect(e2.message).toBe("Sem permissão para editar a Integração.");
    });
  });

  it("voltar: só de integrável (P-63 A), apaga o espelho, loga; em massa é atômico", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const a = await modeloInterno(c);
      const b = await modeloInterno(c);
      await marcar(c, a.id);
      const e = await erro(c, `SELECT public.integracao_voltar(ARRAY[$1::uuid, $2::uuid])`, [a.id, b.id]);
      expect(e.code).toBe("P0409");
      expect((await um<{ e: string }>(c, `SELECT estado AS e FROM public.integracao_produtos WHERE modelo_id = $1`, [a.id])).e).toBe("integravel");
      expect((await um<{ r: any }>(c, `SELECT public.integracao_voltar(ARRAY[$1::uuid]) AS r`, [a.id])).r).toEqual({ voltaram: 1 });
      expect((await um<{ n: string }>(c, `SELECT count(*) AS n FROM public.integracao_linhas WHERE modelo_id = $1`, [a.id])).n).toBe("0");
      expect((await um<{ e: string; r: unknown }>(c, `SELECT estado AS e, retrato AS r FROM public.integracao_produtos WHERE modelo_id = $1`, [a.id])))
        .toEqual({ e: "nao_integravel", r: null });
      await c.query(`UPDATE public.integracao_produtos SET estado = 'integrado' WHERE modelo_id = $1`, [a.id]);
      expect((await erro(c, `SELECT public.integracao_voltar(ARRAY[$1::uuid])`, [a.id])).message).toMatch(/^integracao_mudou: .* esta integrado$/);
    });
  });

  it("desfazer: SÓ super admin, só integrado, motivo obrigatório; log leva o retrato antigo", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await modeloInterno(c);
      await marcar(c, m.id);
      expect((await erro(c, `SELECT public.integracao_desfazer($1, 'motivo ok')`, [m.id])).message).toMatch(/Só um produto integrado/);
      await c.query(`UPDATE public.integracao_produtos SET estado = 'integrado', integrado_em = now() WHERE modelo_id = $1`, [m.id]);
      expect((await erro(c, `SELECT public.integracao_desfazer($1, ' x ')`, [m.id])).message).toBe("Informe o motivo (obrigatório).");
      await comoUsuarioCom(c, "00000000-0000-4000-8000-00000000ce13", [["integracao", true, true]], { tenantAdmin: true });
      expect((await erro(c, `SELECT public.integracao_desfazer($1, 'NCM errado enviado')`, [m.id])).message).toBe("Só o super admin pode fazer isto.");
      await comoUsuario(c, U);
      expect((await um<{ r: any }>(c, `SELECT public.integracao_desfazer($1, 'NCM errado enviado') AS r`, [m.id])).r).toEqual({ ok: true });
      const ip = await um<{ e: string; mot: string; integ: unknown }>(c,
        `SELECT estado AS e, desfeito_motivo AS mot, integrado_em AS integ FROM public.integracao_produtos WHERE modelo_id = $1`, [m.id]);
      expect(ip).toEqual({ e: "nao_integravel", mot: "NCM errado enviado", integ: null });
      const log = await um<{ d: any }>(c, `SELECT detalhe AS d FROM public.integracao_log WHERE modelo_id = $1 AND acao = 'desfazer'`, [m.id]);
      expect(log.d.motivo).toBe("NCM errado enviado");
      expect(log.d.retrato.linhas[0].valores.preco_custo).toBe("62.10");
    });
  });

  it("log por papel (N11): não-super não vê campos/chaves/config; retrato do log sem custo p/ quem não vê custos", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await modeloInterno(c);
      await marcar(c, m.id);
      await c.query(`UPDATE public.integracao_produtos SET estado = 'integrado', integrado_em = now() WHERE modelo_id = $1`, [m.id]);
      await c.query(`SELECT public.integracao_desfazer($1, 'motivo do teste')`, [m.id]);
      await c.query(`INSERT INTO public.integracao_log (tenant_id, acao, quem, detalhe) VALUES ($1, 'campos', 'x', '{}')`, [T]);
      const sup = (await um<{ r: any }>(c, `SELECT public.integracao_log_listar(1) AS r`)).r;
      expect(sup.linhas.map((l: any) => l.acao)).toEqual(expect.arrayContaining(["campos", "desfazer", "integrar"]));
      await comoUsuarioCom(c, "00000000-0000-4000-8000-00000000ce14", [["integracao", true, false]]);
      const v = (await um<{ r: any }>(c, `SELECT public.integracao_log_listar(1) AS r`)).r;
      expect(v.linhas.map((l: any) => l.acao)).not.toContain("campos");
      const d = v.linhas.find((l: any) => l.acao === "desfazer");
      for (const l of d.detalhe.retrato.linhas) expect(l.valores.preco_custo).toBeNull();
    });
  });

  it.skipIf(!MIG_TXN)("inverso 3 desfaz a 3 (6 funções somem)", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await aplica(c, INVERSOS[2]);
      const r = await um<{ n: string }>(c, `SELECT count(*) AS n FROM pg_proc WHERE pronamespace = 'public'::regnamespace
        AND proname IN ('_integracao_quem','_integracao_logar','integracao_marcar','integracao_voltar','integracao_desfazer','integracao_log_listar')`);
      expect(r.n).toBe("0");
    });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar (N3)**

```bash
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres
INTEG_DONO_AVISADO=sim bash .superpowers/integracao/n3.sh antes t3
INTEGRACAO_MIG_TXN=1 npx vitest run --no-file-parallelism tests/integration/integracao-3-estados.test.ts
bash .superpowers/integracao/n3.sh depois t3
```
Expected: FAIL — `ENOENT … 20261007120000_integracao_3_estados.sql`.

- [ ] **Step 3: Escrever a migration 3 — `supabase/migrations/20261007120000_integracao_3_estados.sql`**

```sql
-- Integração + API — 3/6: ESTADOS e LOG (spec §4, §5, §9). Só funções.
-- integracao_marcar: recalcula o retrato com trava de linha (modelos FOR NO KEY UPDATE + integracao_produtos FOR UPDATE, ordem estável), compara a
-- assinatura HMAC do resumo (diferente = P0409 integracao_mudou, ASCII), exige completo e não reprovado (D9), P-75 A
-- (Preço de custo marcado ⇒ só quem vê custos), grava estado + retrato + ESPELHO + log 'integrar', atômico. NÃO compara
-- modelos.rev (D10). integracao_voltar: só de integrável (P-63 A), individual ou em massa, atômico, apaga o espelho.
-- integracao_desfazer: SÓ super admin, só integrado (D27), motivo obrigatório, log com o retrato antigo inteiro.
-- integracao_log_listar: Log por papel (N11) + custo mascarado no retrato do log (inv. #12).
-- Contagens: +6 funções | +0 gatilhos. Inverso: supabase/rollback/20261007120000_integracao_3_estados_down.sql.
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '3s';

DO $guarda$
BEGIN
  IF to_regprocedure('public._integracao_retrato_core(uuid,text[],jsonb)') IS NULL THEN
    RAISE EXCEPTION 'integracao_3: aplique a migration 2 antes' USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

CREATE OR REPLACE FUNCTION public._integracao_quem()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT coalesce(nullif(btrim(u.nome::text), ''), u.email::text, 'usuário')
         || CASE WHEN public.is_super_admin() THEN ' (super admin)' ELSE '' END
    FROM public.users u
   WHERE u.id = auth.uid()
$function$;

CREATE OR REPLACE FUNCTION public._integracao_logar(_tenant uuid, _acao text, _modelo_id uuid, _detalhe jsonb, _quem text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  INSERT INTO public.integracao_log (tenant_id, acao, usuario_id, quem, modelo_id, modelo_nome, detalhe)
  VALUES (_tenant, _acao, auth.uid(), coalesce(_quem, public._integracao_quem(), 'sistema'), _modelo_id,
          (SELECT m.nome::text FROM public.modelos m WHERE m.id = _modelo_id), coalesce(_detalhe, '{}'::jsonb))
$function$;

CREATE OR REPLACE FUNCTION public.integracao_marcar(_itens jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public._integracao_exige(true);
  v_cfg public.integracao_config;
  v_ids uuid[];
  v_custos jsonb;
  v_loja text;
  v_ret jsonb;
  v_ass text;
  v_chaves uuid[];
  v_n integer := 0;
  r record;
BEGIN
  IF jsonb_typeof(_itens) IS DISTINCT FROM 'array' OR jsonb_array_length(_itens) = 0 OR jsonb_array_length(_itens) > 200 THEN
    RAISE EXCEPTION 'Envie de 1 a 200 produtos para integrar.' USING ERRCODE = 'P0001';
  END IF;
  v_cfg := public._integracao_cfg(v_tenant);
  -- P-75 A: com "Preço de custo" marcado, só integra quem pode VER custos
  IF 'preco_custo' = ANY(v_cfg.campos) AND NOT public._pode_ver_custos() THEN
    RAISE EXCEPTION 'integracao_sem_custo: preco de custo marcado exige ver custos' USING ERRCODE = '42501';
  END IF;
  v_ids := ARRAY(SELECT DISTINCT (e.x ->> 'modelo_id')::uuid FROM jsonb_array_elements(_itens) AS e(x) ORDER BY 1);
  IF (SELECT count(*) FROM public.modelos m WHERE m.id = ANY(v_ids) AND m.tenant_id = v_tenant) <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'Produto não encontrado nesta loja.' USING ERRCODE = 'P0001';
  END IF;
  -- trava em ordem estável (2 integrações em massa não se travam mutuamente) e serializa com a edição do card (§9)
  -- N3 (G-plano do plano): FOR NO KEY UPDATE basta (não bloqueia FKs que apontam para modelos)
  PERFORM 1 FROM public.modelos m WHERE m.id = ANY(v_ids) ORDER BY m.id FOR NO KEY UPDATE;
  PERFORM 1 FROM public.integracao_produtos ip WHERE ip.modelo_id = ANY(v_ids) ORDER BY ip.modelo_id FOR UPDATE;
  v_custos := coalesce(public._custo_unitario_modelos_core(v_ids), '{}'::jsonb);
  SELECT t.nome INTO v_loja FROM public.tenants t WHERE t.id = v_tenant;
  FOR r IN
    SELECT DISTINCT ON (m.id) m.id AS modelo_id, e.x ->> 'assinatura' AS assinatura, m.nome AS nome,
           coalesce(ip.estado, 'nao_integravel') AS estado, ip.id AS ip_id,
           (coalesce(m.status_planejamento, '') = 'reprovado'
            OR lower(btrim(coalesce(m.status_desenvolvimento, ''))) = 'reprovado') AS reprovado
      FROM jsonb_array_elements(_itens) AS e(x)
      JOIN public.modelos m ON m.id = (e.x ->> 'modelo_id')::uuid
      LEFT JOIN public.integracao_produtos ip ON ip.modelo_id = m.id
     ORDER BY m.id
  LOOP
    IF r.estado <> 'nao_integravel' THEN
      RAISE EXCEPTION 'integracao_mudou: produto % ja esta %', r.modelo_id, r.estado USING ERRCODE = 'P0409';
    END IF;
    IF r.reprovado THEN
      RAISE EXCEPTION 'O produto "%" está reprovado e não pode ser integrado.', r.nome USING ERRCODE = 'P0001';
    END IF;
    v_ret := public._integracao_retrato_core(r.modelo_id, v_cfg.campos, v_custos -> r.modelo_id::text);
    v_ass := public._integracao_assinar(v_ret -> 'retrato');
    IF v_ass IS DISTINCT FROM r.assinatura THEN
      RAISE EXCEPTION 'integracao_mudou: produto % mudou desde o resumo', r.modelo_id USING ERRCODE = 'P0409';
    END IF;
    IF NOT (v_ret ->> 'completo')::boolean THEN
      RAISE EXCEPTION 'O produto "%" está incompleto — faltam: %.', r.nome,
        (SELECT string_agg(f.x ->> 'texto', ', ') FROM jsonb_array_elements(v_ret -> 'faltas') AS f(x))
        USING ERRCODE = 'P0001';
    END IF;
    v_chaves := CASE WHEN jsonb_typeof(v_ret -> 'variantes_chaves') = 'array'
                     THEN ARRAY(SELECT k.x::uuid FROM jsonb_array_elements_text(v_ret -> 'variantes_chaves') AS k(x)) END;
    IF r.ip_id IS NULL THEN
      INSERT INTO public.integracao_produtos (tenant_id, modelo_id, estado, campos, retrato, assinatura, variantes_chaves,
                                              marcado_por, marcado_em)
      VALUES (v_tenant, r.modelo_id, 'integravel', v_cfg.campos, v_ret -> 'retrato', v_ass, v_chaves, auth.uid(), now());
    ELSE
      UPDATE public.integracao_produtos
         SET estado = 'integravel', campos = v_cfg.campos, retrato = v_ret -> 'retrato', assinatura = v_ass,
             variantes_chaves = v_chaves, marcado_por = auth.uid(), marcado_em = now(), integrado_em = NULL,
             integrado_chave_id = NULL, rev = rev + 1, atualizado_em = now()
       WHERE id = r.ip_id;
    END IF;
    DELETE FROM public.integracao_linhas WHERE modelo_id = r.modelo_id;
    INSERT INTO public.integracao_linhas (tenant_id, loja_nome, modelo_id, tipo, ordem, nome, ref_sku, preco_anterior,
      preco_venda, peso, ncm, preco_custo, cor_base, cor_apelido, tamanho, titulo, descricao, keywords, metatag,
      comprimento, largura, altura, fotos)
    SELECT v_tenant, coalesce(v_loja, ''), r.modelo_id, l.x ->> 'tipo', (l.x ->> 'ordem')::integer,
           l.x -> 'valores' ->> 'nome', l.x -> 'valores' ->> 'ref_sku', l.x -> 'valores' ->> 'preco_anterior',
           l.x -> 'valores' ->> 'preco_venda', l.x -> 'valores' ->> 'peso', l.x -> 'valores' ->> 'ncm',
           l.x -> 'valores' ->> 'preco_custo', l.x -> 'valores' ->> 'cor_base', l.x -> 'valores' ->> 'cor_apelido',
           l.x -> 'valores' ->> 'tamanho', l.x -> 'valores' ->> 'titulo', l.x -> 'valores' ->> 'descricao',
           l.x -> 'valores' ->> 'keywords', l.x -> 'valores' ->> 'metatag', l.x -> 'valores' ->> 'comprimento',
           l.x -> 'valores' ->> 'largura', l.x -> 'valores' ->> 'altura',
           ARRAY(SELECT fo.x FROM jsonb_array_elements_text(coalesce(l.x -> 'fotos', '[]'::jsonb)) AS fo(x))
      FROM jsonb_array_elements(v_ret -> 'retrato' -> 'linhas') AS l(x);
    PERFORM public._integracao_logar(v_tenant, 'integrar', r.modelo_id,
      jsonb_build_object('campos', cardinality(v_cfg.campos),
                         'sublinhas', jsonb_array_length(v_ret -> 'retrato' -> 'linhas') - 1), NULL);
    v_n := v_n + 1;
  END LOOP;
  RETURN jsonb_build_object('marcados', v_n);
END
$function$;

CREATE OR REPLACE FUNCTION public.integracao_voltar(_modelo_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public._integracao_exige(true);
  v_ids uuid[];
  v_n integer := 0;
  r record;
BEGIN
  IF coalesce(cardinality(_modelo_ids), 0) = 0 OR cardinality(_modelo_ids) > 200 THEN
    RAISE EXCEPTION 'Selecione de 1 a 200 produtos.' USING ERRCODE = 'P0001';
  END IF;
  v_ids := ARRAY(SELECT DISTINCT u.x FROM unnest(_modelo_ids) AS u(x) ORDER BY 1);
  -- FOR UPDATE: corrida voltar × entregar (§9) — quem trava primeiro vence; o outro relê o estado
  PERFORM 1 FROM public.integracao_produtos ip
   WHERE ip.modelo_id = ANY(v_ids) AND ip.tenant_id = v_tenant ORDER BY ip.modelo_id FOR UPDATE;
  FOR r IN
    SELECT u.x AS modelo_id, ip.id AS ip_id, coalesce(ip.estado, 'nao_integravel') AS estado
      FROM unnest(v_ids) AS u(x)
      LEFT JOIN public.integracao_produtos ip ON ip.modelo_id = u.x AND ip.tenant_id = v_tenant
     ORDER BY u.x
  LOOP
    IF r.estado <> 'integravel' THEN
      -- P-63 A: o toggle só volta ANTES de a API levar; integrado = só super admin desfaz
      RAISE EXCEPTION 'integracao_mudou: produto % esta %', r.modelo_id, r.estado USING ERRCODE = 'P0409';
    END IF;
    UPDATE public.integracao_produtos
       SET estado = 'nao_integravel', retrato = NULL, assinatura = NULL, variantes_chaves = NULL,
           rev = rev + 1, atualizado_em = now()
     WHERE id = r.ip_id;
    DELETE FROM public.integracao_linhas WHERE modelo_id = r.modelo_id;
    PERFORM public._integracao_logar(v_tenant, 'voltar', r.modelo_id, '{}'::jsonb, NULL);
    v_n := v_n + 1;
  END LOOP;
  RETURN jsonb_build_object('voltaram', v_n);
END
$function$;

CREATE OR REPLACE FUNCTION public.integracao_desfazer(_modelo_id uuid, _motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public._integracao_exige_super();
  v_motivo text := btrim(coalesce(_motivo, ''));
  v_ip public.integracao_produtos%ROWTYPE;
BEGIN
  IF length(v_motivo) < 3 THEN
    RAISE EXCEPTION 'Informe o motivo (obrigatório).' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_ip FROM public.integracao_produtos x WHERE x.modelo_id = _modelo_id AND x.tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND OR v_ip.estado <> 'integrado' THEN
    RAISE EXCEPTION 'Só um produto integrado pode ter a integração desfeita (integrável volta pelo botão Integrável).'
      USING ERRCODE = 'P0001';
  END IF;
  PERFORM public._integracao_logar(v_tenant, 'desfazer', _modelo_id,
    jsonb_build_object('motivo', v_motivo, 'integrado_em', v_ip.integrado_em, 'retrato', v_ip.retrato), NULL);
  UPDATE public.integracao_produtos
     SET estado = 'nao_integravel', retrato = NULL, assinatura = NULL, variantes_chaves = NULL, integrado_em = NULL,
         integrado_chave_id = NULL, desfeito_por = auth.uid(), desfeito_em = now(), desfeito_motivo = v_motivo,
         rev = rev + 1, atualizado_em = now()
   WHERE id = v_ip.id;
  DELETE FROM public.integracao_linhas WHERE modelo_id = _modelo_id;
  RETURN jsonb_build_object('ok', true);
END
$function$;

CREATE OR REPLACE FUNCTION public.integracao_log_listar(_pagina integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public._integracao_exige(false);
  v_super boolean := public.is_super_admin();
  v_ver boolean := public._pode_ver_custos();
  v_pag integer := greatest(coalesce(_pagina, 1), 1);
  v_total integer;
  v_linhas jsonb;
BEGIN
  -- N11: admin da loja / permissão veem só ações de PRODUTO; campos/chaves/config = só super admin
  SELECT count(*) INTO v_total FROM public.integracao_log l
   WHERE l.tenant_id = v_tenant AND (v_super OR l.acao IN ('editar', 'integrar', 'voltar', 'desfazer', 'integrado'));
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', l.id, 'acao', l.acao, 'quem', l.quem, 'quando', l.criado_em, 'modelo_id', l.modelo_id,
           'modelo_nome', l.modelo_nome,
           'detalhe', CASE WHEN v_ver OR NOT (l.detalhe ? 'retrato') THEN l.detalhe
                           ELSE jsonb_set(l.detalhe, '{retrato}',
                                          coalesce(public._integracao_mascarar(l.detalhe -> 'retrato'), 'null'::jsonb)) END)
           ORDER BY l.criado_em DESC, l.id), '[]'::jsonb)
    INTO v_linhas
    FROM (SELECT x.* FROM public.integracao_log x
           WHERE x.tenant_id = v_tenant AND (v_super OR x.acao IN ('editar', 'integrar', 'voltar', 'desfazer', 'integrado'))
           ORDER BY x.criado_em DESC, x.id OFFSET (v_pag - 1) * 50 LIMIT 50) l;
  RETURN jsonb_build_object('pagina', v_pag, 'por_pagina', 50, 'total', v_total, 'super', v_super, 'linhas', v_linhas);
END
$function$;

REVOKE EXECUTE ON FUNCTION public._integracao_quem() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._integracao_logar(uuid, text, uuid, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.integracao_marcar(jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.integracao_voltar(uuid[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.integracao_desfazer(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.integracao_log_listar(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.integracao_marcar(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.integracao_voltar(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.integracao_desfazer(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.integracao_log_listar(integer) TO authenticated;

DO $pos$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['public._integracao_quem()', 'public._integracao_logar(uuid,text,uuid,jsonb,text)'] LOOP
    IF has_function_privilege('authenticated', f, 'EXECUTE') OR has_function_privilege('anon', f, 'EXECUTE')
       OR has_function_privilege('public', f, 'EXECUTE') THEN
      RAISE EXCEPTION 'integracao_3: % executavel por PUBLIC/anon/authenticated (inv. 9)', f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY['public.integracao_marcar(jsonb)', 'public.integracao_voltar(uuid[])',
                            'public.integracao_desfazer(uuid,text)', 'public.integracao_log_listar(integer)'] LOOP
    IF NOT has_function_privilege('authenticated', f, 'EXECUTE') OR has_function_privilege('anon', f, 'EXECUTE') THEN
      RAISE EXCEPTION 'integracao_3: ACL errada em %', f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
```

- [ ] **Step 4: Escrever o inverso 3 — `supabase/rollback/20261007120000_integracao_3_estados_down.sql`**

```sql
-- Inverso de 20261007120000_integracao_3_estados.sql — só DROP das 6 funções novas. Rodar SÓ depois do inverso 4 (LIFO).
-- Não apaga dado (integracao_produtos/linhas/log ficam até o inverso 1).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '3s';

DO $guarda$
BEGIN
  IF to_regprocedure('public.fn_integracao_trava_modelos()') IS NOT NULL THEN
    RAISE EXCEPTION 'integracao_3_down: volte a migration 4 antes (LIFO)' USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

DROP FUNCTION IF EXISTS public.integracao_log_listar(integer);
DROP FUNCTION IF EXISTS public.integracao_desfazer(uuid, text);
DROP FUNCTION IF EXISTS public.integracao_voltar(uuid[]);
DROP FUNCTION IF EXISTS public.integracao_marcar(jsonb);
DROP FUNCTION IF EXISTS public._integracao_logar(uuid, text, uuid, jsonb, text);
DROP FUNCTION IF EXISTS public._integracao_quem();

DO $pos$
BEGIN
  IF to_regprocedure('public.integracao_marcar(jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'integracao_3_down: funcoes da migration 3 ainda existem' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
```

- [ ] **Step 5: Rodar e ver passar (N3)**

```bash
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres
INTEG_DONO_AVISADO=sim bash .superpowers/integracao/n3.sh antes t3
INTEGRACAO_MIG_TXN=1 npx vitest run --no-file-parallelism tests/integration/integracao-2-retrato.test.ts tests/integration/integracao-3-estados.test.ts
bash .superpowers/integracao/n3.sh depois t3
```
Expected: PASS (2: 10 · 3: 8).

- [ ] **Step 6: Gates + commit**

```bash
bash .superpowers/integracao/gates.sh
git add -- supabase/migrations/20261007120000_integracao_3_estados.sql supabase/rollback/20261007120000_integracao_3_estados_down.sql \
  tests/integration/integracao-3-estados.test.ts
git commit --only -m "feat(integracao): migration 3 — marcar (HMAC + FOR UPDATE + P-75), voltar, desfazer (super admin) e log por papel

Co-Authored-By: Claude <modelo real> <noreply@anthropic.com>" -- supabase/migrations/20261007120000_integracao_3_estados.sql \
  supabase/rollback/20261007120000_integracao_3_estados_down.sql tests/integration/integracao-3-estados.test.ts
git show --stat HEAD | tail -n +7
```

---

### Task 4: Migration 4 — trava no banco (§8), foto com `WHEN` (V2), recálculos B1 + inverso 4

**Files:**
- Create: `supabase/migrations/20261007130000_integracao_4_trava.sql`
- Create: `supabase/rollback/20261007130000_integracao_4_trava_down.sql` (montado por script — o "antes" dos 2 recálculos vem do dump)
- Test: `tests/integration/integracao-4-trava.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3 (`integracao_produtos.estado/campos/variantes_chaves`, `integracao_marcar/voltar`), fixtures.
- Produces: `_integracao_campo_travado(_modelo_id uuid, _campo text) → boolean` (REVOKE dos 3); gatilhos
  `trg_zz_integracao_trava` (BEFORE UPDATE em `modelos`, `modelo_skus` [+INSERT/DELETE], `produtos_acabados`,
  `produtos_importados` [+DELETE]), `trg_zz_integracao_trava_del` (BEFORE DELETE em `modelos`),
  `trg_zz_integracao_trava_var` (CONSTRAINT TRIGGER adiado em `produto_acabado_variantes`/`produto_importado_variantes`),
  `trg_sync_foto_modelo_{acabado,importado}` (AFTER INSERT) + `…_upd` (AFTER UPDATE com `WHEN`); `_pa_recomputar_precos_modelo`
  e `_imp_recomputar_precos_modelo` = antes + `TRECHO_B1` (congelam `preco_venda` do travado). Recusa: 42501
  `integracao_travado: <campo>` com `<campo>` ∈ {nome, ref_sku, preco_anterior, preco_venda, peso, ncm, titulo, descricao,
  comprimento, largura, altura, foto, tamanho_tipo, sku, excluir, vinculo, variantes}.

- [ ] **Step 1: Escrever o teste (falha: migration 4 ausente)**

`tests/integration/integracao-4-trava.test.ts`:

```ts
/** Integração + API — migration 4 (trava §8, foto WHEN, B1). Plano Task 4. Só na cópia (N3), txn revertida. */
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, withTx, comoUsuario, um } from "./db";
import {
  CAMPOS_PADRAO, DEF, INVERSOS, LAYOUT, LOCAL, MD5_ANTES, MIG_TXN, T, U, aplica, camposLoja, imediato, keywordsLoja,
  modeloInterno, prepara, revenda,
} from "./integracao-helpers";

/** Trecho inserido nos 2 recálculos (diff mínimo — o "depois" menos ISTO é o "antes"). */
export const TRECHO_B1 =
  "  -- [integracao v1] B1: produto travado pela Integração com \"Preço de venda\" marcado — o recálculo automático (OC, MO,\n" +
  "  -- markup, preço fixo) NÃO mexe no preco_venda: fica congelado (o retrato já tem o valor enviado). O atacado segue.\n" +
  "  if public._integracao_campo_travado(v_modelo_id, 'preco_venda') then\n" +
  "    v_preco_venda := v_venda_atual;\n" +
  "  end if;\n" +
  "\n";

async function marcar(c: Client, id: string): Promise<void> {
  const a = (await um<{ r: any }>(c, `SELECT public.integracao_previa(ARRAY[$1::uuid]) AS r`, [id])).r.produtos[0].assinatura;
  await c.query(`SELECT public.integracao_marcar(jsonb_build_array(jsonb_build_object('modelo_id', $1::uuid, 'assinatura', $2::text)))`, [id, a]);
}
async function falha(c: Client, sql: string, params: unknown[] = []): Promise<string> {
  await c.query("SAVEPOINT f");
  try {
    await c.query(sql, params);
    await c.query("RELEASE SAVEPOINT f");
    return "PASSOU";
  } catch (e: any) {
    await c.query("ROLLBACK TO SAVEPOINT f");
    return `${e.code} ${e.message}`;
  }
}
const CASOS: Array<[campo: string, set: string]> = [
  ["nome", "nome = nome || ' X'"], ["ref_sku", "ref = ref || 'X'"], ["preco_anterior", "preco_anterior = 1"],
  ["preco_venda", "preco_venda = 1"], ["peso", "peso_kg = 1"], ["ncm", "ncm = '0000.00.00'"], ["titulo", "titulo_pagina = 'x'"],
  ["descricao", "descricao_produto = 'x'"], ["comprimento", "comprimento_cm = 1"], ["largura", "largura_cm = 1"],
  ["altura", "altura_cm = 1"],
];

describe.skipIf(!hasDb || !LOCAL)("integracao — migration 4: trava", () => {
  it("cada campo MARCADO trava (42501 integracao_travado: <campo>); Tamanho em e SKUs SEMPRE; não marcado fica livre", async () => {
    await withTx(async (c) => {
      await prepara(c, 4);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      await camposLoja(c, LAYOUT);
      const m = await modeloInterno(c);
      await marcar(c, m.id);
      for (const [campo, set] of CASOS) {
        expect(await falha(c, `UPDATE public.modelos SET ${set} WHERE id = $1`, [m.id]), campo).toBe(`42501 integracao_travado: ${campo}`);
      }
      expect(await falha(c, `UPDATE public.modelos SET fotos_modelo = '{}' WHERE id = $1`, [m.id])).toBe("42501 integracao_travado: foto");
      expect(await falha(c, `UPDATE public.modelos SET tamanho_tipo = 'numero' WHERE id = $1`, [m.id])).toBe("42501 integracao_travado: tamanho_tipo");
      expect(await falha(c, `UPDATE public.modelo_skus SET sku = sku || 'X' WHERE modelo_id = $1`, [m.id])).toBe("42501 integracao_travado: sku");
      expect(await falha(c, `DELETE FROM public.modelo_skus WHERE modelo_id = $1`, [m.id])).toBe("42501 integracao_travado: sku");
      expect(await falha(c, `UPDATE public.modelo_skus SET sku = sku WHERE modelo_id = $1`, [m.id])).toBe("PASSOU");
      // não marcado: volta, desmarca NCM, marca de novo — NCM fica livre, nome não
      await c.query(`SELECT public.integracao_voltar(ARRAY[$1::uuid])`, [m.id]);
      await camposLoja(c, CAMPOS_PADRAO.filter((k) => k !== "ncm"));
      await marcar(c, m.id);
      expect(await falha(c, `UPDATE public.modelos SET ncm = '0000.00.00' WHERE id = $1`, [m.id])).toBe("PASSOU");
      expect(await falha(c, `UPDATE public.modelos SET fotos_modelo = '{}' WHERE id = $1`, [m.id])).toBe("PASSOU"); // Foto não marcada
    });
  });

  it("save do Sheet do Dev SEM mudança passa (R9); BOM, grade, CAD e produção seguem livres (P-62 A)", async () => {
    await withTx(async (c) => {
      await prepara(c, 4);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await modeloInterno(c);
      await marcar(c, m.id);
      expect(await falha(c, `UPDATE public.modelos SET nome = nome, ref = ref, fotos_modelo = fotos_modelo, tamanho_tipo = tamanho_tipo,
        observacoes_tecnicas = 'obs nova', status_desenvolvimento = status_desenvolvimento WHERE id = $1`, [m.id])).toBe("PASSOU");
      expect(await falha(c, `UPDATE public.modelo_tecidos SET consumo = 1.5 WHERE modelo_id = $1`, [m.id])).toBe("PASSOU");
      expect(await falha(c, `UPDATE public.modelo_grades SET grades = '{"38|P": 9, "40|M": 3}' WHERE modelo_id = $1`, [m.id])).toBe("PASSOU");
      expect(await falha(c, `UPDATE public.modelos SET custo_peca_previsto = 99 WHERE id = $1`, [m.id])).toBe("PASSOU");
    });
  });

  it("UPDATE direto via REST (authenticated), até de super admin, é recusado; DELETE do produto travado é recusado", async () => {
    await withTx(async (c) => {
      await prepara(c, 4);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await modeloInterno(c);
      await marcar(c, m.id);
      await c.query("SAVEPOINT r");
      await c.query("SET LOCAL ROLE authenticated");
      await expect(c.query(`UPDATE public.modelos SET nome = 'hack' WHERE id = $1`, [m.id])).rejects.toThrow(/integracao_travado: nome/);
      await c.query("ROLLBACK TO SAVEPOINT r");
      expect(await falha(c, `DELETE FROM public.modelos WHERE id = $1`, [m.id])).toBe("42501 integracao_travado: excluir");
      await c.query(`SELECT public.integracao_voltar(ARRAY[$1::uuid])`, [m.id]);
      expect(await falha(c, `DELETE FROM public.modelos WHERE id = $1`, [m.id])).toBe("PASSOU");
    });
  });

  it("revenda travada: excluir produto espelho recusado; nome/REF/preço fixo explícito recusados; limpar o fixo passa (D12)", async () => {
    await withTx(async (c) => {
      await prepara(c, 4);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await revenda(c);
      await marcar(c, m.id);
      expect(await falha(c, `SELECT public.excluir_produto_acabado($1)`, [m.produtoId])).toBe("42501 integracao_travado: excluir");
      expect(await falha(c, `UPDATE public.produtos_acabados SET nome = nome || ' X' WHERE id = $1`, [m.produtoId])).toBe("42501 integracao_travado: nome");
      expect(await falha(c, `UPDATE public.produtos_acabados SET ref = ref || 'X' WHERE id = $1`, [m.produtoId])).toBe("42501 integracao_travado: ref_sku");
      expect(await falha(c, `UPDATE public.produtos_acabados SET modelo_id = NULL WHERE id = $1`, [m.produtoId])).toBe("42501 integracao_travado: vinculo");
      expect(await falha(c, `SELECT public.salvar_precos_fixo_produto_acabado($1, false, NULL, true, 199)`, [m.produtoId]))
        .toBe("42501 integracao_travado: preco_venda");
      expect(await falha(c, `SELECT public.salvar_markups_produto_acabado($1, NULL, 4)`, [m.produtoId])).toBe("PASSOU");
      expect((await um<{ p: string }>(c, `SELECT preco_venda::text AS p FROM public.modelos WHERE id = $1`, [m.id])).p).toBe("159.90");
    });
  });

  it("B1: recálculo automático (markup, MO, receber OC) NÃO mexe no preço de venda travado; o atacado segue", async () => {
    await withTx(async (c) => {
      await prepara(c, 4);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await revenda(c);
      await marcar(c, m.id);
      await c.query(`UPDATE public.produtos_acabados SET markup_atacado = 2 WHERE id = $1`, [m.produtoId]);
      expect(await falha(c, `SELECT public._pa_recomputar_precos_modelo($1)`, [m.produtoId])).toBe("PASSOU");
      expect(await um(c, `SELECT preco_venda::text AS v, preco_atacado::text AS a FROM public.modelos WHERE id = $1`, [m.id]))
        .toEqual({ v: "159.90", a: "80.00" });
      expect(await falha(c, `INSERT INTO public.modelo_servico_mo (tenant_id, modelo_id, valor) VALUES ($1, $2, 5)`, [T, m.id])).toBe("PASSOU");
      expect((await um<{ v: string }>(c, `SELECT preco_venda::text AS v FROM public.modelos WHERE id = $1`, [m.id])).v).toBe("159.90");
      const oc = (await um<{ id: string }>(c,
        `INSERT INTO public.ocs_p_acabado (tenant_id, nome_produto, produto_acabado_id, qtd_total, valor_unitario, valor_unitario_real,
                grade_detalhe) VALUES ($1, 'OC teste', $2, 5, 45, 45, '{"1": {"38|P": {"pedida": 2, "recebida": 2, "defeito": 0}}}')
         RETURNING id`, [T, m.produtoId])).id;
      expect(await falha(c, `SELECT public.receber_oc_p_acabado($1, '{}'::jsonb, NULL)`, [oc])).toBe("PASSOU");
      expect((await um<{ v: string }>(c, `SELECT preco_venda::text AS v FROM public.modelos WHERE id = $1`, [m.id])).v).toBe("159.90");
    });
  });

  it("nota 14 (D11): save do Produto Acabado com o MESMO conjunto de cores passa (apaga/recria); trocar a cor é recusado no COMMIT", async () => {
    await withTx(async (c) => {
      await prepara(c, 4);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await revenda(c);
      await marcar(c, m.id);
      const nome = (await um<{ n: string }>(c, `SELECT nome AS n FROM public.produtos_acabados WHERE id = $1`, [m.produtoId])).n;
      const dados = { nome, qtd_total: 7, valor_unitario: 40, desconto_pct: 0, markup_varejo: 3 };
      const mesmas = [{ ordem: 1, cor_id: m.corId, cor_apelido_id: m.apelidoId, peso: 1, qtd: 7 }];
      expect(await falha(c, `SELECT public.salvar_produto_acabado($1, $2::jsonb, $3::jsonb, NULL)`, [m.produtoId, dados, JSON.stringify(mesmas)])).toBe("PASSOU");
      await imediato(c);
      const outra = (await um<{ id: string }>(c, `INSERT INTO public.cores (tenant_id, nome) VALUES ($1, 'Outra cor teste') RETURNING id`, [T])).id;
      await c.query(`UPDATE public.produto_acabado_variantes SET cor_id = $2 WHERE produto_acabado_id = $1`, [m.produtoId, outra]);
      await expect(imediato(c)).rejects.toThrow(/integracao_travado: variantes/);
    });
  });

  it("V2: foto do produto só sincroniza quando MUDA (WHEN) — reordenar no card não é desfeito pelo save do PA", async () => {
    await withTx(async (c) => {
      await prepara(c, 4);
      await comoUsuario(c, U);
      const m = await revenda(c, { fotos: [`${T}/fotos_modelo/card.jpg`] });
      await c.query(`UPDATE public.produtos_acabados SET foto_url = $2 WHERE id = $1`, [m.produtoId, `${T}/fotos_modelo/capa.jpg`]);
      expect((await um<{ f: string[] }>(c, `SELECT fotos_modelo AS f FROM public.modelos WHERE id = $1`, [m.id])).f)
        .toEqual([`${T}/fotos_modelo/capa.jpg`, `${T}/fotos_modelo/card.jpg`]);
      await c.query(`UPDATE public.modelos SET fotos_modelo = ARRAY[$2::text] WHERE id = $1`, [m.id, `${T}/fotos_modelo/card.jpg`]);
      await c.query(`UPDATE public.produtos_acabados SET foto_url = foto_url, qtd_total = qtd_total WHERE id = $1`, [m.produtoId]);
      expect((await um<{ f: string[] }>(c, `SELECT fotos_modelo AS f FROM public.modelos WHERE id = $1`, [m.id])).f)
        .toEqual([`${T}/fotos_modelo/card.jpg`]);
    });
  });

  it("gerar SKU que falta em produto travado é recusado (a tela pula — nota 11)", async () => {
    await withTx(async (c) => {
      await prepara(c, 4);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      await camposLoja(c, CAMPOS_PADRAO.filter((k) => k !== "ref_sku"));
      const m = await modeloInterno(c, { semSku: true });
      await marcar(c, m.id);
      expect(await falha(c, `SELECT public.gerar_skus_modelo($1, false)`, [m.id])).toMatch(/^42501 integracao_travado: sku$/);
    });
  });

  it("reset_loja apaga produto integrado (gatilhos não são ENABLE ALWAYS — replica pula)", async () => {
    await withTx(async (c) => {
      await prepara(c, 4);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await modeloInterno(c);
      await marcar(c, m.id);
      await c.query(`UPDATE public.integracao_produtos SET estado = 'integrado' WHERE modelo_id = $1`, [m.id]);
      const alw = await um<{ n: string }>(c, `SELECT count(*) AS n FROM pg_trigger WHERE tgname LIKE 'trg_zz_integracao%' AND tgenabled <> 'O'`);
      expect(alw.n).toBe("0");
      await c.query(`SELECT public.reset_loja($1)`, [T]);
      expect((await um<{ n: string }>(c, `SELECT count(*) AS n FROM public.modelos WHERE tenant_id = $1`, [T])).n).toBe("0");
    });
  });

  it.skipIf(!MIG_TXN)("recálculos: depois = antes + SÓ o TRECHO_B1 (diff mínimo, pg_get_functiondef)", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      const aPa = await DEF(c, "_pa_recomputar_precos_modelo(uuid)");
      const aImp = await DEF(c, "_imp_recomputar_precos_modelo(uuid)");
      expect((await um<{ a: string; b: string }>(c, "SELECT md5($1) AS a, md5($2) AS b", [aPa, aImp]))).toEqual({ a: MD5_ANTES.pa, b: MD5_ANTES.imp });
      await aplica(c, "supabase/migrations/20261007130000_integracao_4_trava.sql");
      const dPa = await DEF(c, "_pa_recomputar_precos_modelo(uuid)");
      const dImp = await DEF(c, "_imp_recomputar_precos_modelo(uuid)");
      expect(dPa.replace(TRECHO_B1, "")).toBe(aPa);
      expect(dImp.replace(TRECHO_B1, "")).toBe(aImp);
    });
  });

  it.skipIf(!MIG_TXN)("inverso 4 desfaz a 4 (gatilhos novos somem, foto volta ao gatilho original, recálculos voltam ao md5 de antes)", async () => {
    await withTx(async (c) => {
      await prepara(c, 4);
      await aplica(c, INVERSOS[3]);
      const r = await um<{ n: string; f: string; fi: string; pa: string; imp: string }>(c,
        `SELECT (SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'trg_zz_integracao%' OR tgname LIKE 'trg_sync_foto_modelo_%_upd') AS n,
                (SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname = 'trg_sync_foto_modelo_acabado') AS f,
                (SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname = 'trg_sync_foto_modelo_importado') AS fi,
                md5(pg_get_functiondef('public._pa_recomputar_precos_modelo(uuid)'::regprocedure)) AS pa,
                md5(pg_get_functiondef('public._imp_recomputar_precos_modelo(uuid)'::regprocedure)) AS imp`);
      // N4 (G-plano do plano): o gatilho de foto do IMPORTADO também volta ao original
      expect(r).toEqual({ n: "0", pa: MD5_ANTES.pa, imp: MD5_ANTES.imp,
        f: "CREATE TRIGGER trg_sync_foto_modelo_acabado AFTER INSERT OR UPDATE OF foto_url, modelo_id ON public.produtos_acabados FOR EACH ROW EXECUTE FUNCTION _sync_foto_modelo_do_produto()",
        fi: "CREATE TRIGGER trg_sync_foto_modelo_importado AFTER INSERT OR UPDATE OF foto_url, modelo_id ON public.produtos_importados FOR EACH ROW EXECUTE FUNCTION _sync_foto_modelo_do_produto()" });
    });
  });

  it.skipIf(!MIG_TXN)("inverso 4 recusa se um dos 2 recálculos mudou por outra frente depois da migration 4", async () => {
    // D40/revisão T1 #1 (Important #1, mesmo padrão do inverso 1): simula outra frente redefinindo
    // _pa_recomputar_precos_modelo DEPOIS da migration 4 (corpo diferente, sem TRECHO_B1 e sem bater com o "antes") —
    // o inverso deve RECUSAR (RAISE P0001 ASCII) sem tocar em nenhum DROP/gatilho.
    await withTx(async (c) => {
      await prepara(c, 4);
      await c.query(`
        CREATE OR REPLACE FUNCTION public._pa_recomputar_precos_modelo(_produto_id uuid)
         RETURNS void LANGUAGE plpgsql AS $function$
        BEGIN
          -- [outra frente] corpo diferente, sem relação com o texto de antes nem com o TRECHO_B1.
          PERFORM 1;
        END; $function$;
      `);
      await expect(aplica(c, INVERSOS[3])).rejects.toThrow(
        /integracao_4_down: _pa_recomputar_precos_modelo mudou depois da migration 4 - refazer o inverso/,
      );
      // as travas continuam existindo e o recálculo NÃO voltou ao "antes" (a recusa aconteceu no $guarda$, antes de qualquer DROP).
      const r = await um<{ n: string; pa: string }>(c,
        `SELECT (SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'trg_zz_integracao%') AS n,
                md5(pg_get_functiondef('public._pa_recomputar_precos_modelo(uuid)'::regprocedure)) AS pa`);
      expect(r.n).not.toBe("0");
      expect(r.pa).not.toBe(MD5_ANTES.pa);
    });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar (N3)**

```bash
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres
INTEG_DONO_AVISADO=sim bash .superpowers/integracao/n3.sh antes t4
INTEGRACAO_MIG_TXN=1 npx vitest run --no-file-parallelism tests/integration/integracao-4-trava.test.ts
bash .superpowers/integracao/n3.sh depois t4
```
Expected: FAIL — `ENOENT … 20261007130000_integracao_4_trava.sql`.

- [ ] **Step 3: Escrever a migration 4 — `supabase/migrations/20261007130000_integracao_4_trava.sql`**

```sql
-- Integração + API — 4/6: TRAVA NO BANCO (spec §8; P-62 A, P-73 A, B1, B2, R8, R9, V2, nota 14).
-- Com o produto integrável/integrado, gatilhos BEFORE `trg_zz_integracao_trava` (ÚLTIMOS na ordem alfabética, depois de
-- ref_auto/markup/mo_flag/preco_venda_gate/kanban_status_guard; SECURITY DEFINER; nunca ENABLE ALWAYS — o reset_loja roda
-- em replica) recusam MUDANÇA REAL (IS DISTINCT FROM, o Sheet do Dev manda nome/ref/fotos em todo save e passa — R9):
--   modelos: tamanho_tipo SEMPRE + as colunas dos campos marcados no retrato; DELETE sempre (R8);
--   modelo_skus: INSERT/DELETE e UPDATE com mudança, SEMPRE (B2);
--   produtos_acabados/importados: DELETE e desvincular sempre; nome/ref/foto_url conforme marcado; preco_varejo_fixo
--   DEFINIDO com valor novo quando "Preço de venda" marcado (D12 — limpar via markup passa);
--   variantes do espelho: CONSTRAINT TRIGGER ADIADO p/ o COMMIT compara o CONJUNTO de cores (D11 — o save do PA/PI
--   apaga e recria as variantes: o mesmo conjunto regravado passa; qtd/peso livres).
-- Mensagem: 42501 'integracao_travado: <campo>' (ASCII). Destravar = só integracao_voltar/desfazer (mudam o ESTADO; sem GUC).
-- V2: a sincronização da foto do PA/PI p/ o card ganha WHEN (só quando foto_url ou o vínculo MUDA).
-- B1: _pa_recomputar_precos_modelo e _imp_recomputar_precos_modelo NÃO gravam preco_venda do travado com "Preço de venda"
-- marcado (receber OC / salvar OC / markup / preço fixo / MO seguem funcionando). Diff mínimo (TRECHO_B1) na suíte.
-- Contagens: +6 funções (2 redefinidas não contam) | +9 gatilhos (7 novos + foto: -2 +4).
-- Inverso: supabase/rollback/20261007130000_integracao_4_trava_down.sql (SÓ depois do inverso 5).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '3s';

DO $guarda$
DECLARE
  v_pa text := pg_get_functiondef('public._pa_recomputar_precos_modelo(uuid)'::regprocedure);
  v_imp text := pg_get_functiondef('public._imp_recomputar_precos_modelo(uuid)'::regprocedure);
BEGIN
  IF to_regprocedure('public.integracao_marcar(jsonb)') IS NULL THEN
    RAISE EXCEPTION 'integracao_4: aplique a migration 3 antes' USING ERRCODE = 'P0001';
  END IF;
  IF md5(v_pa) <> '72c96c624de8f4530c862d8abb6a1283' AND position('[integracao v1]' IN v_pa) = 0 THEN
    RAISE EXCEPTION 'integracao_4: _pa_recomputar_precos_modelo com texto inesperado (md5 %)', md5(v_pa) USING ERRCODE = 'P0001';
  END IF;
  IF md5(v_imp) <> '5baca24d0de45b8c5f291fef39472238' AND position('[integracao v1]' IN v_imp) = 0 THEN
    RAISE EXCEPTION 'integracao_4: _imp_recomputar_precos_modelo com texto inesperado (md5 %)', md5(v_imp) USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._sync_foto_modelo_do_produto()') IS NULL THEN
    RAISE EXCEPTION 'integracao_4: _sync_foto_modelo_do_produto ausente' USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

CREATE OR REPLACE FUNCTION public._integracao_campo_travado(_modelo_id uuid, _campo text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.integracao_produtos ip
                  WHERE ip.modelo_id = _modelo_id AND ip.estado IN ('integravel', 'integrado') AND _campo = ANY(ip.campos))
$function$;
REVOKE EXECUTE ON FUNCTION public._integracao_campo_travado(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_integracao_trava_modelos()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_campos text[];
BEGIN
  SELECT ip.campos INTO v_campos FROM public.integracao_produtos ip
   WHERE ip.modelo_id = OLD.id AND ip.estado IN ('integravel', 'integrado');
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  -- B2 / m085: o "Tamanho em" forma as sublinhas — trava SEMPRE
  IF NEW.tamanho_tipo IS DISTINCT FROM OLD.tamanho_tipo THEN
    RAISE EXCEPTION 'integracao_travado: tamanho_tipo' USING ERRCODE = '42501';
  END IF;
  IF 'nome' = ANY(v_campos) AND NEW.nome IS DISTINCT FROM OLD.nome THEN
    RAISE EXCEPTION 'integracao_travado: nome' USING ERRCODE = '42501';
  END IF;
  IF 'ref_sku' = ANY(v_campos) AND NEW.ref IS DISTINCT FROM OLD.ref THEN
    RAISE EXCEPTION 'integracao_travado: ref_sku' USING ERRCODE = '42501';
  END IF;
  IF 'preco_anterior' = ANY(v_campos) AND NEW.preco_anterior IS DISTINCT FROM OLD.preco_anterior THEN
    RAISE EXCEPTION 'integracao_travado: preco_anterior' USING ERRCODE = '42501';
  END IF;
  IF 'preco_venda' = ANY(v_campos) AND NEW.preco_venda IS DISTINCT FROM OLD.preco_venda THEN
    RAISE EXCEPTION 'integracao_travado: preco_venda' USING ERRCODE = '42501';
  END IF;
  IF 'peso' = ANY(v_campos) AND NEW.peso_kg IS DISTINCT FROM OLD.peso_kg THEN
    RAISE EXCEPTION 'integracao_travado: peso' USING ERRCODE = '42501';
  END IF;
  IF 'ncm' = ANY(v_campos) AND NEW.ncm IS DISTINCT FROM OLD.ncm THEN
    RAISE EXCEPTION 'integracao_travado: ncm' USING ERRCODE = '42501';
  END IF;
  IF 'titulo' = ANY(v_campos) AND NEW.titulo_pagina IS DISTINCT FROM OLD.titulo_pagina THEN
    RAISE EXCEPTION 'integracao_travado: titulo' USING ERRCODE = '42501';
  END IF;
  IF ('descricao' = ANY(v_campos) OR 'metatag' = ANY(v_campos)) AND NEW.descricao_produto IS DISTINCT FROM OLD.descricao_produto THEN
    RAISE EXCEPTION 'integracao_travado: descricao' USING ERRCODE = '42501';
  END IF;
  IF 'comprimento' = ANY(v_campos) AND NEW.comprimento_cm IS DISTINCT FROM OLD.comprimento_cm THEN
    RAISE EXCEPTION 'integracao_travado: comprimento' USING ERRCODE = '42501';
  END IF;
  IF 'largura' = ANY(v_campos) AND NEW.largura_cm IS DISTINCT FROM OLD.largura_cm THEN
    RAISE EXCEPTION 'integracao_travado: largura' USING ERRCODE = '42501';
  END IF;
  IF 'altura' = ANY(v_campos) AND NEW.altura_cm IS DISTINCT FROM OLD.altura_cm THEN
    RAISE EXCEPTION 'integracao_travado: altura' USING ERRCODE = '42501';
  END IF;
  IF 'foto' = ANY(v_campos) AND NEW.fotos_modelo IS DISTINCT FROM OLD.fotos_modelo THEN
    RAISE EXCEPTION 'integracao_travado: foto' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.fn_integracao_trava_modelos_del()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- R8: excluir produto integrável/integrado é recusado até voltar/desfazer (o CASCADE de modelo_skus nunca chega a rodar)
  IF EXISTS (SELECT 1 FROM public.integracao_produtos ip
              WHERE ip.modelo_id = OLD.id AND ip.estado IN ('integravel', 'integrado')) THEN
    RAISE EXCEPTION 'integracao_travado: excluir' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END
$function$;

CREATE OR REPLACE FUNCTION public.fn_integracao_trava_skus()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ids uuid[];
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.modelo_id IS NOT DISTINCT FROM OLD.modelo_id AND NEW.variante_key IS NOT DISTINCT FROM OLD.variante_key
       AND NEW.tamanho_key IS NOT DISTINCT FROM OLD.tamanho_key AND NEW.sku IS NOT DISTINCT FROM OLD.sku
       AND NEW.manual IS NOT DISTINCT FROM OLD.manual THEN
      RETURN NEW;  -- R9: regravar igual passa
    END IF;
    v_ids := ARRAY[OLD.modelo_id, NEW.modelo_id];
  ELSIF TG_OP = 'INSERT' THEN
    v_ids := ARRAY[NEW.modelo_id];
  ELSE
    v_ids := ARRAY[OLD.modelo_id];
  END IF;
  -- B2: as linhas de SKU travam SEMPRE (marcado ou não)
  IF EXISTS (SELECT 1 FROM public.integracao_produtos ip
              WHERE ip.modelo_id = ANY(v_ids) AND ip.estado IN ('integravel', 'integrado')) THEN
    RAISE EXCEPTION 'integracao_travado: sku' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.fn_integracao_trava_espelho()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_campos text[];
BEGIN
  IF OLD.modelo_id IS NULL THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  SELECT ip.campos INTO v_campos FROM public.integracao_produtos ip
   WHERE ip.modelo_id = OLD.modelo_id AND ip.estado IN ('integravel', 'integrado');
  IF NOT FOUND THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    -- delta item 3: _excluir_produto_*_core apagaria foto e cores travadas (FK SET NULL)
    RAISE EXCEPTION 'integracao_travado: excluir' USING ERRCODE = '42501';
  END IF;
  IF NEW.modelo_id IS DISTINCT FROM OLD.modelo_id THEN
    RAISE EXCEPTION 'integracao_travado: vinculo' USING ERRCODE = '42501';
  END IF;
  IF 'nome' = ANY(v_campos) AND NEW.nome IS DISTINCT FROM OLD.nome THEN
    RAISE EXCEPTION 'integracao_travado: nome' USING ERRCODE = '42501';
  END IF;
  IF 'ref_sku' = ANY(v_campos) AND NEW.ref IS DISTINCT FROM OLD.ref THEN
    RAISE EXCEPTION 'integracao_travado: ref_sku' USING ERRCODE = '42501';
  END IF;
  IF 'foto' = ANY(v_campos) AND NEW.foto_url IS DISTINCT FROM OLD.foto_url THEN
    RAISE EXCEPTION 'integracao_travado: foto' USING ERRCODE = '42501';
  END IF;
  -- delta item 4 / D12: DEFINIR preço fixo novo = edição explícita do preço → recusa; limpar (markup) passa
  IF 'preco_venda' = ANY(v_campos) AND NEW.preco_varejo_fixo IS NOT NULL
     AND NEW.preco_varejo_fixo IS DISTINCT FROM OLD.preco_varejo_fixo THEN
    RAISE EXCEPTION 'integracao_travado: preco_venda' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.fn_integracao_trava_variantes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  -- TG_ARGV: [0] tabela do produto, [1] coluna FK nas variantes, [2] tabela das variantes
  v_prod uuid;
  v_modelo uuid;
  v_esperado uuid[];
  v_atual uuid[];
BEGIN
  v_prod := (to_jsonb(CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END) ->> TG_ARGV[1])::uuid;
  EXECUTE format('SELECT p.modelo_id FROM public.%I p WHERE p.id = $1', TG_ARGV[0]) INTO v_modelo USING v_prod;
  IF v_modelo IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT ip.variantes_chaves INTO v_esperado FROM public.integracao_produtos ip
   WHERE ip.modelo_id = v_modelo AND ip.estado IN ('integravel', 'integrado');
  IF NOT FOUND OR v_esperado IS NULL THEN
    RETURN NULL;
  END IF;
  EXECUTE format('SELECT ARRAY(SELECT DISTINCT public._sku_variante_key(v.cor_id, v.cor_apelido_id) FROM public.%I v WHERE v.%I = $1 ORDER BY 1)',
                 TG_ARGV[2], TG_ARGV[1]) INTO v_atual USING v_prod;
  IF v_atual IS DISTINCT FROM v_esperado THEN
    RAISE EXCEPTION 'integracao_travado: variantes' USING ERRCODE = '42501';
  END IF;
  RETURN NULL;
END
$function$;

CREATE OR REPLACE TRIGGER trg_zz_integracao_trava BEFORE UPDATE ON public.modelos
  FOR EACH ROW EXECUTE FUNCTION public.fn_integracao_trava_modelos();
CREATE OR REPLACE TRIGGER trg_zz_integracao_trava_del BEFORE DELETE ON public.modelos
  FOR EACH ROW EXECUTE FUNCTION public.fn_integracao_trava_modelos_del();
CREATE OR REPLACE TRIGGER trg_zz_integracao_trava BEFORE INSERT OR UPDATE OR DELETE ON public.modelo_skus
  FOR EACH ROW EXECUTE FUNCTION public.fn_integracao_trava_skus();
CREATE OR REPLACE TRIGGER trg_zz_integracao_trava BEFORE UPDATE OR DELETE ON public.produtos_acabados
  FOR EACH ROW EXECUTE FUNCTION public.fn_integracao_trava_espelho();
CREATE OR REPLACE TRIGGER trg_zz_integracao_trava BEFORE UPDATE OR DELETE ON public.produtos_importados
  FOR EACH ROW EXECUTE FUNCTION public.fn_integracao_trava_espelho();
DROP TRIGGER IF EXISTS trg_zz_integracao_trava_var ON public.produto_acabado_variantes;
CREATE CONSTRAINT TRIGGER trg_zz_integracao_trava_var AFTER INSERT OR UPDATE OR DELETE ON public.produto_acabado_variantes
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION public.fn_integracao_trava_variantes('produtos_acabados', 'produto_acabado_id', 'produto_acabado_variantes');
DROP TRIGGER IF EXISTS trg_zz_integracao_trava_var ON public.produto_importado_variantes;
CREATE CONSTRAINT TRIGGER trg_zz_integracao_trava_var AFTER INSERT OR UPDATE OR DELETE ON public.produto_importado_variantes
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION public.fn_integracao_trava_variantes('produtos_importados', 'produto_importado_id', 'produto_importado_variantes');

-- V2: a foto do PA/PI só vira capa do card quando MUDA (ou quando o card é vinculado) — o save que regrava a mesma
-- foto_url não desfaz mais a remoção/reordenação feita no card ou na Integração.
CREATE OR REPLACE TRIGGER trg_sync_foto_modelo_acabado AFTER INSERT ON public.produtos_acabados
  FOR EACH ROW EXECUTE FUNCTION public._sync_foto_modelo_do_produto();
CREATE OR REPLACE TRIGGER trg_sync_foto_modelo_acabado_upd AFTER UPDATE OF foto_url, modelo_id ON public.produtos_acabados
  FOR EACH ROW WHEN (OLD.foto_url IS DISTINCT FROM NEW.foto_url OR OLD.modelo_id IS DISTINCT FROM NEW.modelo_id)
  EXECUTE FUNCTION public._sync_foto_modelo_do_produto();
CREATE OR REPLACE TRIGGER trg_sync_foto_modelo_importado AFTER INSERT ON public.produtos_importados
  FOR EACH ROW EXECUTE FUNCTION public._sync_foto_modelo_do_produto();
CREATE OR REPLACE TRIGGER trg_sync_foto_modelo_importado_upd AFTER UPDATE OF foto_url, modelo_id ON public.produtos_importados
  FOR EACH ROW WHEN (OLD.foto_url IS DISTINCT FROM NEW.foto_url OR OLD.modelo_id IS DISTINCT FROM NEW.modelo_id)
  EXECUTE FUNCTION public._sync_foto_modelo_do_produto();

-- B1 — revenda (antes = md5 72c96c62…; depois = antes + TRECHO_B1)
CREATE OR REPLACE FUNCTION public._pa_recomputar_precos_modelo(_produto_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_modelo_id uuid;
  v_valor_unitario numeric;
  v_desconto_pct numeric;
  v_markup_atacado numeric;
  v_markup_varejo numeric;
  v_preco_atacado_fixo numeric;
  v_preco_varejo_fixo numeric;
  v_insumos numeric := 0;
  v_mao_obra numeric := 0;
  v_custo numeric;
  v_atacado_atual numeric;
  v_venda_atual numeric;
  v_preco_atacado numeric;
  v_preco_venda numeric;
begin
  select p.modelo_id, p.valor_unitario, p.desconto_pct, p.markup_atacado, p.markup_varejo,
         p.preco_atacado_fixo, p.preco_varejo_fixo
    into v_modelo_id, v_valor_unitario, v_desconto_pct, v_markup_atacado, v_markup_varejo,
         v_preco_atacado_fixo, v_preco_varejo_fixo
    from public.produtos_acabados p where p.id = _produto_id;

  if v_modelo_id is null then
    return; -- sem espelho no Planejamento ainda — nada a recomputar
  end if;

  select coalesce(sum(me.consumo * me.custo_previsto), 0) into v_insumos
    from public.modelo_etiquetas me where me.modelo_id = v_modelo_id;

  -- MO na base (mesma fonte modelo_servico_mo do card do Planejamento; BRL por peça).
  select coalesce(sum(s.valor), 0) into v_mao_obra
    from public.modelo_servico_mo s where s.modelo_id = v_modelo_id;

  v_custo := coalesce(v_valor_unitario, 0) * (1 - coalesce(v_desconto_pct, 0) / 100.0) + v_insumos + v_mao_obra;

  select m.preco_atacado, m.preco_venda into v_atacado_atual, v_venda_atual
    from public.modelos m where m.id = v_modelo_id;

  -- Preço FIXO manda; senão deriva do markup (base × markup); senão NULL (sem markup nem fixo = não há
  -- preço — NÃO manter o valor antigo, que vira lixo exibido como "fixado" que o usuário nunca digitou).
  v_preco_atacado := case
    when v_preco_atacado_fixo is not null then v_preco_atacado_fixo
    when v_markup_atacado is not null then round(v_custo * v_markup_atacado, 2)
    else null end;
  -- VAREJO INDEPENDENTE: base(custo) × markup_varejo, NÃO preço_atacado × markup_varejo.
  v_preco_venda := case
    when v_preco_varejo_fixo is not null then v_preco_varejo_fixo
    when v_markup_varejo is not null then round(v_custo * v_markup_varejo, 2)
    else null end;

  -- [integracao v1] B1: produto travado pela Integração com "Preço de venda" marcado — o recálculo automático (OC, MO,
  -- markup, preço fixo) NÃO mexe no preco_venda: fica congelado (o retrato já tem o valor enviado). O atacado segue.
  if public._integracao_campo_travado(v_modelo_id, 'preco_venda') then
    v_preco_venda := v_venda_atual;
  end if;

  update public.modelos set preco_atacado = v_preco_atacado, preco_venda = v_preco_venda
    where id = v_modelo_id
      and (preco_atacado is distinct from v_preco_atacado or preco_venda is distinct from v_preco_venda);
end;
$function$;

-- B1 — importado (antes = md5 5baca24d…; depois = antes + TRECHO_B1)
CREATE OR REPLACE FUNCTION public._imp_recomputar_precos_modelo(_produto_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_modelo_id uuid;
  v_markup_atacado numeric;
  v_markup_varejo numeric;
  v_preco_atacado_fixo numeric;
  v_preco_varejo_fixo numeric;
  v_mao_obra numeric := 0;
  v_custo numeric;
  v_atacado_atual numeric;
  v_venda_atual numeric;
  v_preco_atacado numeric;
  v_preco_venda numeric;
begin
  select p.modelo_id, p.markup_atacado, p.markup_varejo, p.preco_atacado_fixo, p.preco_varejo_fixo
    into v_modelo_id, v_markup_atacado, v_markup_varejo, v_preco_atacado_fixo, v_preco_varejo_fixo
    from public.produtos_importados p where p.id = _produto_id;
  if v_modelo_id is null then
    return; -- sem espelho ainda
  end if;

  -- MO na base (mesma fonte modelo_servico_mo; BRL por peça — soma limpa ao landed, já em BRL).
  select coalesce(sum(s.valor), 0) into v_mao_obra
    from public.modelo_servico_mo s where s.modelo_id = v_modelo_id;

  v_custo := public._imp_custo_landed(_produto_id) + v_mao_obra;

  select m.preco_atacado, m.preco_venda into v_atacado_atual, v_venda_atual
    from public.modelos m where m.id = v_modelo_id;

  v_preco_atacado := case
    when v_preco_atacado_fixo is not null then v_preco_atacado_fixo
    when v_markup_atacado is not null and v_markup_atacado > 0 then round(v_custo * v_markup_atacado, 2)
    else null end;
  -- VAREJO INDEPENDENTE: custo landed × markup_varejo, NÃO preço_atacado × markup_varejo.
  v_preco_venda := case
    when v_preco_varejo_fixo is not null then v_preco_varejo_fixo
    when v_markup_varejo is not null and v_markup_varejo > 0 then round(v_custo * v_markup_varejo, 2)
    else null end;

  -- [integracao v1] B1: produto travado pela Integração com "Preço de venda" marcado — o recálculo automático (OC, MO,
  -- markup, preço fixo) NÃO mexe no preco_venda: fica congelado (o retrato já tem o valor enviado). O atacado segue.
  if public._integracao_campo_travado(v_modelo_id, 'preco_venda') then
    v_preco_venda := v_venda_atual;
  end if;

  update public.modelos set preco_atacado = v_preco_atacado, preco_venda = v_preco_venda
    where id = v_modelo_id
      and (preco_atacado is distinct from v_preco_atacado or preco_venda is distinct from v_preco_venda);
end $function$;

DO $pos$
BEGIN
  IF (SELECT count(*) FROM pg_trigger WHERE tgname IN ('trg_zz_integracao_trava', 'trg_zz_integracao_trava_del',
        'trg_zz_integracao_trava_var', 'trg_sync_foto_modelo_acabado_upd', 'trg_sync_foto_modelo_importado_upd')) <> 9 THEN
    RAISE EXCEPTION 'integracao_4: gatilhos da trava incompletos' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname LIKE 'trg_zz_integracao%' AND tgenabled <> 'O') THEN
    RAISE EXCEPTION 'integracao_4: gatilho de trava fora do modo padrao (nunca ENABLE ALWAYS)' USING ERRCODE = 'P0001';
  END IF;
  IF position('[integracao v1]' IN pg_get_functiondef('public._pa_recomputar_precos_modelo(uuid)'::regprocedure)) = 0
     OR position('[integracao v1]' IN pg_get_functiondef('public._imp_recomputar_precos_modelo(uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'integracao_4: recalculos sem o trecho B1' USING ERRCODE = 'P0001';
  END IF;
  IF has_function_privilege('authenticated', 'public._integracao_campo_travado(uuid,text)', 'EXECUTE')
     OR has_function_privilege('public', 'public._integracao_campo_travado(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'integracao_4: _integracao_campo_travado executavel (inv. 9)' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
```

- [ ] **Step 4: Montar o inverso 4 por script (o "antes" dos 2 recálculos vem do dump da Task 1 — nunca redigitado; o
      `$guarda$` recusa se QUALQUER um dos 2 mudou por outra frente depois desta migration — D40/revisão T1 #1, MESMO
      padrão do inverso 1)**

```bash
cat > .superpowers/integracao/mig/montar_inverso_4.sh <<'BASH'
#!/usr/bin/env bash
# Monta supabase/rollback/20261007130000_integracao_4_trava_down.sql. Os 2 recálculos voltam ao texto de ANTES
# (.superpowers/integracao/mig/antes/{_pa,_imp}_recomputar_precos_modelo.sql, de dump_antes.sh) — nunca editar à mão.
# O $guarda$ RECUSA (RAISE P0001 ASCII) a menos que os 2 ainda sejam a versão instalada pela migration 4: md5 = "antes"
# OU ("antes" + TRECHO_B1 removido), CADA UM checado independente — D40/revisão T1 #1 (mesmo padrão do inverso 1).
set -euo pipefail
TOP="$(git rev-parse --show-toplevel)"; cd "$TOP"
case "$TOP" in */.claude/worktrees/integracao-impl) ;; *) echo "PARE: rode de dentro da worktree integracao-impl"; exit 1;; esac
A=.superpowers/integracao/mig/antes
OUT=supabase/rollback/20261007130000_integracao_4_trava_down.sql
[ -f "$A/_pa_recomputar_precos_modelo.sql" ] && [ -f "$A/_imp_recomputar_precos_modelo.sql" ] || { echo "PARE: rode dump_antes.sh primeiro"; exit 1; }

# TRECHO_B1 literal (idêntico a tests/integration/integracao-4-trava.test.ts TRECHO_B1).
TRECHO=$'  -- [integracao v1] B1: produto travado pela Integração com "Preço de venda" marcado — o recálculo automático (OC, MO,\n  -- markup, preço fixo) NÃO mexe no preco_venda: fica congelado (o retrato já tem o valor enviado). O atacado segue.\n  if public._integracao_campo_travado(v_modelo_id, \'preco_venda\') then\n    v_preco_venda := v_venda_atual;\n  end if;\n\n'

{
cat <<'SQL'
-- Inverso de 20261007130000_integracao_4_trava.sql — MONTADO pela Task 4 (os 2 recálculos voltam ao texto de ANTES,
-- gerado por .superpowers/integracao/mig/dump_antes.sh — nunca editar à mão). Rodar SÓ depois do inverso 5 (LIFO).
-- Tira TODA a trava (produtos integráveis/integrados ficam editáveis) e devolve a foto ao gatilho original (sem WHEN).
-- D40/revisão T1 #1: o $guarda$ recusa se QUALQUER um dos 2 recálculos mudou depois da migration 4 (aceita só o
-- "antes" exato ou "antes"+TRECHO_B1 de CADA UM — nunca sobrescreve uma mudança de outra frente em silêncio).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '3s';

DO $guarda$
DECLARE
  v_pa text;
  v_imp text;
BEGIN
  IF to_regprocedure('public.integracao_salvar(jsonb,jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'integracao_4_down: volte a migration 5 antes (LIFO)' USING ERRCODE = 'P0001';
  END IF;
  v_pa := pg_get_functiondef('public._pa_recomputar_precos_modelo(uuid)'::regprocedure);
  v_imp := pg_get_functiondef('public._imp_recomputar_precos_modelo(uuid)'::regprocedure);
  IF md5(v_pa) <> '72c96c624de8f4530c862d8abb6a1283'
     AND NOT (position('[integracao v1]' IN v_pa) > 0
              AND md5(replace(v_pa, '
SQL
printf '%s' "$TRECHO" | tail -c +1
cat <<'SQL'
', '')) = '72c96c624de8f4530c862d8abb6a1283') THEN
    RAISE EXCEPTION 'integracao_4_down: _pa_recomputar_precos_modelo mudou depois da migration 4 - refazer o inverso' USING ERRCODE = 'P0001';
  END IF;
  IF md5(v_imp) <> '5baca24d0de45b8c5f291fef39472238'
     AND NOT (position('[integracao v1]' IN v_imp) > 0
              AND md5(replace(v_imp, '
SQL
printf '%s' "$TRECHO" | tail -c +1
cat <<'SQL'
', '')) = '5baca24d0de45b8c5f291fef39472238') THEN
    RAISE EXCEPTION 'integracao_4_down: _imp_recomputar_precos_modelo mudou depois da migration 4 - refazer o inverso' USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

DROP TRIGGER IF EXISTS trg_zz_integracao_trava ON public.modelos;
DROP TRIGGER IF EXISTS trg_zz_integracao_trava_del ON public.modelos;
DROP TRIGGER IF EXISTS trg_zz_integracao_trava ON public.modelo_skus;
DROP TRIGGER IF EXISTS trg_zz_integracao_trava ON public.produtos_acabados;
DROP TRIGGER IF EXISTS trg_zz_integracao_trava ON public.produtos_importados;
DROP TRIGGER IF EXISTS trg_zz_integracao_trava_var ON public.produto_acabado_variantes;
DROP TRIGGER IF EXISTS trg_zz_integracao_trava_var ON public.produto_importado_variantes;
DROP TRIGGER IF EXISTS trg_sync_foto_modelo_acabado_upd ON public.produtos_acabados;
CREATE OR REPLACE TRIGGER trg_sync_foto_modelo_acabado AFTER INSERT OR UPDATE OF foto_url, modelo_id ON public.produtos_acabados
  FOR EACH ROW EXECUTE FUNCTION public._sync_foto_modelo_do_produto();
DROP TRIGGER IF EXISTS trg_sync_foto_modelo_importado_upd ON public.produtos_importados;
CREATE OR REPLACE TRIGGER trg_sync_foto_modelo_importado AFTER INSERT OR UPDATE OF foto_url, modelo_id ON public.produtos_importados
  FOR EACH ROW EXECUTE FUNCTION public._sync_foto_modelo_do_produto();
DROP FUNCTION IF EXISTS public.fn_integracao_trava_variantes();
DROP FUNCTION IF EXISTS public.fn_integracao_trava_espelho();
DROP FUNCTION IF EXISTS public.fn_integracao_trava_skus();
DROP FUNCTION IF EXISTS public.fn_integracao_trava_modelos_del();
DROP FUNCTION IF EXISTS public.fn_integracao_trava_modelos();

SQL
printf '%s\n;\n\n' "$(cat "$A/_pa_recomputar_precos_modelo.sql")"
printf '%s\n;\n' "$(cat "$A/_imp_recomputar_precos_modelo.sql")"
cat <<'SQL'

DROP FUNCTION IF EXISTS public._integracao_campo_travado(uuid, text);

DO $pos$
BEGIN
  IF md5(pg_get_functiondef('public._pa_recomputar_precos_modelo(uuid)'::regprocedure)) <> '72c96c624de8f4530c862d8abb6a1283'
     OR md5(pg_get_functiondef('public._imp_recomputar_precos_modelo(uuid)'::regprocedure)) <> '5baca24d0de45b8c5f291fef39472238' THEN
    RAISE EXCEPTION 'integracao_4_down: recalculos nao voltaram ao texto de antes' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname LIKE 'trg_zz_integracao%' OR tgname LIKE 'trg_sync_foto_modelo_%_upd') THEN
    RAISE EXCEPTION 'integracao_4_down: gatilhos da trava ainda existem' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
SQL
} > "$OUT"
echo "escrito: $OUT ($(wc -l < "$OUT" | tr -d ' ') linhas)"
grep -c 'CREATE OR REPLACE FUNCTION public._[pi][am][p]*_recomputar_precos_modelo' "$OUT"   # 2
grep -c "RAISE EXCEPTION 'integracao_4_down: _.*_recomputar_precos_modelo mudou depois da migration 4" "$OUT"   # 2
BASH
chmod +x .superpowers/integracao/mig/montar_inverso_4.sh
bash .superpowers/integracao/mig/montar_inverso_4.sh
```

- [ ] **Step 5: Rodar e ver passar (N3)**

```bash
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres
INTEG_DONO_AVISADO=sim bash .superpowers/integracao/n3.sh antes t4
INTEGRACAO_MIG_TXN=1 npx vitest run --no-file-parallelism tests/integration/integracao-3-estados.test.ts tests/integration/integracao-4-trava.test.ts
bash .superpowers/integracao/n3.sh depois t4
```
Expected: PASS (3: 8 · 4: 11). Se o INSERT da OC do teste B1 exigir coluna NOT NULL a mais (gatilho de número/parcela),
acrescente o MÍNIMO no INSERT e registre em `desvios.md` (o que se prova é o recálculo, não a OC).

- [ ] **Step 6: Gates + commit**

```bash
bash .superpowers/integracao/gates.sh
git add -- supabase/migrations/20261007130000_integracao_4_trava.sql supabase/rollback/20261007130000_integracao_4_trava_down.sql \
  tests/integration/integracao-4-trava.test.ts
git commit --only -m "feat(integracao): migration 4 — trava no banco (campos marcados, SKUs e Tamanho em sempre, espelho, variantes no COMMIT), foto com WHEN, recálculos B1

Co-Authored-By: Claude <modelo real> <noreply@anthropic.com>" -- supabase/migrations/20261007130000_integracao_4_trava.sql \
  supabase/rollback/20261007130000_integracao_4_trava_down.sql tests/integration/integracao-4-trava.test.ts
git show --stat HEAD | tail -n +7
```

---

### Task 5: Migration 5 — mão dupla (nome/REF por gatilho, preço fixo do importado) e `integracao_salvar` + inverso 5

**Files:**
- Create: `supabase/migrations/20261007140000_integracao_5_salvar.sql`
- Create: `supabase/rollback/20261007140000_integracao_5_salvar_down.sql` (montado — "antes" de `_salvar_produto_importado_core` do dump)
- Test: `tests/integration/integracao-5-salvar.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4 (`_integracao_exige`, `_integracao_gates`, `_integracao_logar`, trava), `salvar_precos_fixo_produto_acabado`
  (wrapper existente, SEM mudança — V1), `_imp_recomputar_precos_modelo` (B1).
- Produces: gatilhos `trg_modelo_espelho_nome_ref` (AFTER UPDATE OF nome, ref em `modelos`) e `trg_espelho_modelo_nome_ref`
  (AFTER UPDATE OF nome, ref em `produtos_acabados`/`produtos_importados`) — D13; `_salvar_precos_fixo_produto_importado_core(
  _produto_id uuid, _tocar_atacado boolean, _preco_atacado_fixo numeric, _tocar_varejo boolean, _preco_varejo_fixo numeric)`
  (REVOKE dos 3) + wrapper `salvar_precos_fixo_produto_importado(mesma assinatura) → void` (`authenticated`; módulo
  `produto_importado`) — D14 (Sheet n1, card n2, `integracao_salvar`); `_salvar_produto_importado_core` = antes +
  `TRECHO_IMP_FIXO` (bloco antes das variantes: `_dados.preco_*_fixo` grava o preço EXATO e zera o markup do canal; markup
  sem fixo limpa o fixo; nenhum dos dois mantém — R1: a tela Importado grava o preço no SALVAR, com o `_rev_base`);
  `integracao_salvar(_itens jsonb, _keywords jsonb DEFAULT NULL) → jsonb {salvos, revs{<modelo_id>: rev}}` com
  `_itens = [{modelo_id, rev, campos: {nome?, ref?, preco_anterior?, preco_venda?, peso_kg?, ncm?, titulo_pagina?,
  descricao_produto?, comprimento_cm?, largura_cm?, altura_cm?, fotos_modelo?}}]` (≤ 50; só as chaves PRESENTES gravam)
  e `_keywords = {valor, esperado}`. Recusas: P0409 `conflito_versao: …` (rev), 42501 `integracao_travado: produto`,
  42501 `integracao_sem_permissao: <chave>`, P0409 `keywords_mudou: …`, P0001 validações.

- [ ] **Step 1: Escrever o teste (falha: migration 5 ausente)**

`tests/integration/integracao-5-salvar.test.ts`:

```ts
/** Integração + API — migration 5 (mão dupla + integracao_salvar). Plano Task 5. Só na cópia (N3), txn revertida. */
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, withTx, comoUsuario, um } from "./db";
import { DEF, INVERSOS, LOCAL, MD5_ANTES, MIG_TXN, T, U, aplica, comoUsuarioCom, importado, keywordsLoja, modeloInterno, prepara, revenda } from "./integracao-helpers";

// D14/R1 (G-plano do plano): bloco inserido ANTES de "-- Variantes" (vale p/ INSERT e UPDATE), na transação do _rev_base.
export const TRECHO_IMP_FIXO =
  "  -- [integracao v1] D14/R1: o preço do Importado grava no SALVAR da tela, NESTA transação (a do _rev_base do wrapper).\n" +
  "  -- Preço FIXO no _dados = preço exato do canal e ZERA o markup dele; sem fixo, markup não-nulo LIMPA o fixo (\"última\n" +
  "  -- edição manda\", como a revenda — fix 2efa2ba); sem nenhum dos dois, o fixo fica (outros gravadores não mandam as chaves).\n" +
  "  if coalesce(nullif(_dados->>'preco_atacado_fixo','')::numeric, 1) <= 0\n" +
  "     or coalesce(nullif(_dados->>'preco_varejo_fixo','')::numeric, 1) <= 0 then\n" +
  "    raise exception 'O preço precisa ser maior que zero.' using errcode = 'P0001';\n" +
  "  end if;\n" +
  "  update public.produtos_importados p\n" +
  "     set preco_atacado_fixo = n.af, markup_atacado = n.am, preco_varejo_fixo = n.vf, markup_varejo = n.vm\n" +
  "    from (select\n" +
  "            case when nullif(_dados->>'preco_atacado_fixo','') is not null then (_dados->>'preco_atacado_fixo')::numeric\n" +
  "                 when nullif(_dados->>'markup_atacado','') is not null then null else x.preco_atacado_fixo end as af,\n" +
  "            case when nullif(_dados->>'preco_atacado_fixo','') is not null then null else x.markup_atacado end as am,\n" +
  "            case when nullif(_dados->>'preco_varejo_fixo','') is not null then (_dados->>'preco_varejo_fixo')::numeric\n" +
  "                 when nullif(_dados->>'markup_varejo','') is not null then null else x.preco_varejo_fixo end as vf,\n" +
  "            case when nullif(_dados->>'preco_varejo_fixo','') is not null then null else x.markup_varejo end as vm\n" +
  "            from public.produtos_importados x where x.id = v_id) n\n" +
  "   where p.id = v_id\n" +
  "     and (p.preco_atacado_fixo, p.markup_atacado, p.preco_varejo_fixo, p.markup_varejo) is distinct from (n.af, n.am, n.vf, n.vm);\n\n";

async function rev(c: Client, id: string): Promise<number> {
  return (await um<{ r: number }>(c, `SELECT rev AS r FROM public.modelos WHERE id = $1`, [id])).r;
}
async function salvar(c: Client, itens: unknown[], kw: unknown = null): Promise<any> {
  return (await um<{ r: any }>(c, `SELECT public.integracao_salvar($1::jsonb, $2::jsonb) AS r`, [JSON.stringify(itens), kw === null ? null : JSON.stringify(kw)])).r;
}
async function erro(c: Client, fn: () => Promise<unknown>): Promise<{ code: string; message: string }> {
  await c.query("SAVEPOINT e");
  try {
    await fn();
    throw new Error("esperava erro");
  } catch (e: any) {
    await c.query("ROLLBACK TO SAVEPOINT e");
    return { code: e.code, message: e.message };
  }
}
const PERM_TUDO: Array<[string, boolean, boolean]> = [["integracao", true, true], ["criacao_planejamento", true, true],
  ["criacao_planejamento:preco_venda", true, true], ["criacao_desenvolvimento", true, true]];

describe.skipIf(!hasDb || !LOCAL)("integracao — migration 5: integracao_salvar e mão dupla", () => {
  it("interno: grava SÓ as chaves enviadas no MESMO campo do card, com rev (P0409 ASCII), log 'editar' antes/depois", async () => {
    await withTx(async (c) => {
      await prepara(c, 5);
      await comoUsuario(c, U);
      const m = await modeloInterno(c);
      const r0 = await rev(c, m.id);
      const out = await salvar(c, [{ modelo_id: m.id, rev: r0, campos: { ncm: "6109.90.00", peso_kg: 0.25, titulo_pagina: " Novo título " } }]);
      expect(out.salvos).toBe(1);
      const row = await um<any>(c, `SELECT ncm, peso_kg::text AS peso, titulo_pagina AS t, nome, rev FROM public.modelos WHERE id = $1`, [m.id]);
      expect(row).toMatchObject({ ncm: "6109.90.00", peso: "0.25", t: "Novo título" });
      expect(out.revs[m.id]).toBe(row.rev);
      const log = await um<{ d: any }>(c, `SELECT detalhe AS d FROM public.integracao_log WHERE modelo_id = $1 AND acao = 'editar'`, [m.id]);
      expect(log.d.campos.ncm).toEqual({ antes: "6109.10.00", depois: "6109.90.00" });
      const e = await erro(c, () => salvar(c, [{ modelo_id: m.id, rev: r0, campos: { ncm: "1" } }]));
      expect(e.code).toBe("P0409");
      expect(e.message).toBe("conflito_versao: o produto foi salvo por outra pessoa");
    });
  });

  it("travado (integrável) = 42501 integracao_travado: produto; campo desconhecido = P0001; foto de outra loja = P0001", async () => {
    await withTx(async (c) => {
      await prepara(c, 5);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await modeloInterno(c);
      const bad = await erro(c, () => salvar(c, [{ modelo_id: m.id, rev: 1, campos: { custo_peca_previsto: 1 } }]));
      expect(bad.code).toBe("P0001");
      const r0 = await rev(c, m.id);
      const foto = await erro(c, () => salvar(c, [{ modelo_id: m.id, rev: r0, campos: { fotos_modelo: ["00000000-0000-0000-0000-000000000009/x.jpg"] } }]));
      expect(foto.message).toBe("Foto inválida (de outra loja).");
      const a = (await um<{ r: any }>(c, `SELECT public.integracao_previa(ARRAY[$1::uuid]) AS r`, [m.id])).r.produtos[0].assinatura;
      await c.query(`SELECT public.integracao_marcar(jsonb_build_array(jsonb_build_object('modelo_id', $1::uuid, 'assinatura', $2::text)))`, [m.id, a]);
      const e = await erro(c, () => salvar(c, [{ modelo_id: m.id, rev: await rev(c, m.id), campos: { nome: "x" } }]));
      expect(e).toEqual({ code: "42501", message: "integracao_travado: produto" });
    });
  });

  it("gates do card no servidor (R2/V1): só Integração editar não grava nome; sem :preco_venda não grava preço; REF só revelada e antes da Explosão", async () => {
    await withTx(async (c) => {
      await prepara(c, 5);
      await comoUsuario(c, U);
      const m = await modeloInterno(c);
      await comoUsuarioCom(c, "00000000-0000-4000-8000-00000000ce21", [["integracao", true, true]]);
      expect((await erro(c, async () => salvar(c, [{ modelo_id: m.id, rev: await rev(c, m.id), campos: { nome: "x" } }]))).message)
        .toBe("integracao_sem_permissao: nome");
      await comoUsuarioCom(c, "00000000-0000-4000-8000-00000000ce22", [["integracao", true, true], ["criacao_planejamento", true, true]]);
      expect((await erro(c, async () => salvar(c, [{ modelo_id: m.id, rev: await rev(c, m.id), campos: { preco_venda: 10 } }]))).message)
        .toBe("integracao_sem_permissao: preco_venda");
      expect((await salvar(c, [{ modelo_id: m.id, rev: await rev(c, m.id), campos: { nome: "Nome novo" } }])).salvos).toBe(1);
      await comoUsuarioCom(c, "00000000-0000-4000-8000-00000000ce23", PERM_TUDO);
      expect((await erro(c, async () => salvar(c, [{ modelo_id: m.id, rev: await rev(c, m.id), campos: { ref: "REFNOVA1" } }]))).message)
        .toBe("integracao_sem_permissao: ref");
      // a Loja Teste da cópia tem o Kanban automático LIGADO: desliga na txn (só pela GUC da RPC — decisão 16) p/ a etapa gravada valer
      await c.query(`SELECT set_config('app.kanban_chave', 'rpc', true)`);
      await c.query(`UPDATE public.tenant_config SET kanban_automatico = false WHERE tenant_id = $1`, [T]);
      await c.query(`UPDATE public.modelos SET ordem_criacao_enviada = true, status_desenvolvimento = 'aprovado' WHERE id = $1`, [m.id]);
      await salvar(c, [{ modelo_id: m.id, rev: await rev(c, m.id), campos: { ref: "REFNOVA1" } }]);
      expect((await um<{ r: string }>(c, `SELECT ref AS r FROM public.modelos WHERE id = $1`, [m.id])).r).toBe("REFNOVA1");
      await c.query(`UPDATE public.modelos SET enviado_cad = true WHERE id = $1`, [m.id]);
      expect((await erro(c, async () => salvar(c, [{ modelo_id: m.id, rev: await rev(c, m.id), campos: { ref: "REFNOVA2" } }]))).message)
        .toBe("integracao_sem_permissao: ref");
    });
  });

  it("revenda: preço de venda vira preço FIXO (última edição manda); nome e REF gravam nos DOIS lados (D13); REF do espelho só antes da Explosão (R2)", async () => {
    await withTx(async (c) => {
      await prepara(c, 5);
      await comoUsuario(c, U);
      const m = await revenda(c);
      await salvar(c, [{ modelo_id: m.id, rev: await rev(c, m.id), campos: { preco_venda: 199, nome: "Bolsa Nova" } }]);
      // REF: o card (Sheet/Integração com a REF revelada) grava modelos.ref — o gatilho leva ao espelho na mesma txn
      await c.query(`UPDATE public.modelos SET ref = 'RVDNOVA1' WHERE id = $1`, [m.id]);
      const pa = await um<any>(c, `SELECT nome, ref, preco_varejo_fixo::text AS fixo, markup_varejo FROM public.produtos_acabados WHERE id = $1`, [m.produtoId]);
      expect(pa).toEqual({ nome: "Bolsa Nova", ref: "RVDNOVA1", fixo: "199", markup_varejo: null });
      expect(await um(c, `SELECT preco_venda::text AS v, nome, ref FROM public.modelos WHERE id = $1`, [m.id]))
        .toEqual({ v: "199", nome: "Bolsa Nova", ref: "RVDNOVA1" });
      // vice-versa: o save do Produto Acabado com OUTRO nome chega ao card
      await c.query(`UPDATE public.produtos_acabados SET nome = 'Bolsa da tela PA' WHERE id = $1`, [m.produtoId]);
      expect((await um<{ n: string }>(c, `SELECT nome AS n FROM public.modelos WHERE id = $1`, [m.id])).n).toBe("Bolsa da tela PA");
      // R2: depois do envio à Explosão, a REF do espelho NÃO chega ao card (o nome continua chegando)
      await c.query(`UPDATE public.modelos SET enviado_cad = true WHERE id = $1`, [m.id]);
      await c.query(`UPDATE public.produtos_acabados SET ref = 'RVDDEPOIS', nome = 'Bolsa pós-Explosão' WHERE id = $1`, [m.produtoId]);
      expect(await um(c, `SELECT ref, nome FROM public.modelos WHERE id = $1`, [m.id])).toEqual({ ref: "RVDNOVA1", nome: "Bolsa pós-Explosão" });
    });
  });

  it("importado: gravador de preço FIXO novo (paridade com a revenda); o SALVAR da tela grava o fixo com _rev_base (R1); nome no card (V3); markup sem fixo limpa", async () => {
    await withTx(async (c) => {
      await prepara(c, 5);
      await comoUsuario(c, U);
      const m = await importado(c);
      await salvar(c, [{ modelo_id: m.id, rev: await rev(c, m.id), campos: { preco_venda: 249.9 } }]);
      expect(await um(c, `SELECT preco_varejo_fixo::text AS f, markup_varejo AS mk FROM public.produtos_importados WHERE id = $1`, [m.produtoId]))
        .toEqual({ f: "249.9", mk: null });
      expect((await um<{ v: string }>(c, `SELECT preco_venda::text AS v FROM public.modelos WHERE id = $1`, [m.id])).v).toBe("249.9");
      const vars = JSON.stringify([{ ordem: 1, cor_id: m.corId, cor_apelido_id: m.apelidoId, peso: 1, qtd: 5 }]);
      await c.query(`SELECT public.salvar_produto_importado($1, $2::jsonb, $3::jsonb, '[]'::jsonb, NULL)`,
        [m.produtoId, JSON.stringify({ nome: "Macacão Renomeado", markup_varejo: "" }), vars]);
      expect((await um<{ n: string }>(c, `SELECT nome AS n FROM public.modelos WHERE id = $1`, [m.id])).n).toBe("Macacão Renomeado");
      expect((await um<{ f: string }>(c, `SELECT preco_varejo_fixo::text AS f FROM public.produtos_importados WHERE id = $1`, [m.produtoId])).f).toBe("249.9");
      await c.query(`SELECT public.salvar_produto_importado($1, $2::jsonb, $3::jsonb, '[]'::jsonb, NULL)`,
        [m.produtoId, JSON.stringify({ nome: "Macacão Renomeado", markup_varejo: 3 }), vars]);
      expect((await um<{ f: string | null }>(c, `SELECT preco_varejo_fixo::text AS f FROM public.produtos_importados WHERE id = $1`, [m.produtoId])).f).toBeNull();
      // R1: o SALVAR da tela Importado grava o preço FIXO exato e zera o markup do canal, na transação do _rev_base
      const rv = (await um<{ r: number }>(c, `SELECT rev AS r FROM public.produtos_importados WHERE id = $1`, [m.produtoId])).r;
      await c.query(`SELECT public.salvar_produto_importado($1, $2::jsonb, $3::jsonb, '[]'::jsonb, $4)`,
        [m.produtoId, JSON.stringify({ nome: "Macacão Renomeado", markup_varejo: 3, preco_varejo_fixo: 259.9 }), vars, rv]);
      expect(await um(c, `SELECT preco_varejo_fixo::text AS f, markup_varejo AS mk FROM public.produtos_importados WHERE id = $1`, [m.produtoId]))
        .toEqual({ f: "259.9", mk: null });
      expect((await um<{ v: string }>(c, `SELECT preco_venda::text AS v FROM public.modelos WHERE id = $1`, [m.id])).v).toBe("259.9");
      const velho = await erro(c, () => c.query(`SELECT public.salvar_produto_importado($1, $2::jsonb, $3::jsonb, '[]'::jsonb, $4)`,
        [m.produtoId, JSON.stringify({ nome: "Outro", preco_varejo_fixo: 1 }), vars, rv]));
      expect(velho.code).toBe("P0409"); // _rev_base velho: nada grava
      expect((await um<{ f: string }>(c, `SELECT preco_varejo_fixo::text AS f FROM public.produtos_importados WHERE id = $1`, [m.produtoId])).f).toBe("259.9");
      const zero = await erro(c, () => c.query(`SELECT public.salvar_produto_importado($1, $2::jsonb, $3::jsonb, '[]'::jsonb, NULL)`,
        [m.produtoId, JSON.stringify({ nome: "Macacão Renomeado", preco_varejo_fixo: 0 }), vars]));
      expect(zero).toEqual({ code: "P0001", message: "O preço precisa ser maior que zero." });
      // Sheet (UPDATE direto de modelos.nome) chega ao importado
      await c.query(`UPDATE public.modelos SET nome = 'Nome do Sheet' WHERE id = $1`, [m.id]);
      expect((await um<{ n: string }>(c, `SELECT nome AS n FROM public.produtos_importados WHERE id = $1`, [m.produtoId])).n).toBe("Nome do Sheet");
    });
  });

  it("n5: módulo da origem desligado = gate recusa; Keywords: só admin, conferência do valor carregado (P0409 keywords_mudou)", async () => {
    await withTx(async (c) => {
      await prepara(c, 5);
      await comoUsuario(c, U);
      await keywordsLoja(c, "antes");
      const m = await revenda(c);
      await comoUsuarioCom(c, "00000000-0000-4000-8000-00000000ce24", PERM_TUDO);
      await c.query(`UPDATE public.tenant_config SET modules = modules || '{"produto_acabado": false}'::jsonb WHERE tenant_id = $1`, [T]);
      expect((await erro(c, async () => salvar(c, [{ modelo_id: m.id, rev: await rev(c, m.id), campos: { nome: "x" } }]))).message)
        .toBe("integracao_sem_permissao: nome");
      expect((await erro(c, () => salvar(c, [], { valor: "novo", esperado: "antes" }))).message).toBe("integracao_sem_permissao: keywords");
      await comoUsuario(c, U);
      const e = await erro(c, () => salvar(c, [], { valor: "novo", esperado: "velho" }));
      expect(e).toEqual({ code: "P0409", message: "keywords_mudou: as keywords da loja mudaram" });
      await salvar(c, [], { valor: " moda, verão ", esperado: "antes" });
      expect((await um<{ k: string }>(c, `SELECT keywords AS k FROM public.tenant_config WHERE tenant_id = $1`, [T])).k).toBe("moda, verão");
    });
  });

  it.skipIf(!MIG_TXN)("_salvar_produto_importado_core: depois = antes + SÓ o TRECHO_IMP_FIXO", async () => {
    await withTx(async (c) => {
      await prepara(c, 4);
      const antes = await DEF(c, "_salvar_produto_importado_core(uuid,jsonb,jsonb,jsonb)");
      expect((await um<{ m: string }>(c, "SELECT md5($1) AS m", [antes])).m).toBe(MD5_ANTES.impCore);
      await aplica(c, "supabase/migrations/20261007140000_integracao_5_salvar.sql");
      const depois = await DEF(c, "_salvar_produto_importado_core(uuid,jsonb,jsonb,jsonb)");
      expect(depois.replace(TRECHO_IMP_FIXO, "")).toBe(antes);
    });
  });

  it.skipIf(!MIG_TXN)("inverso 5 desfaz a 5 (gatilhos/funções somem; o save do importado volta ao md5 de antes)", async () => {
    await withTx(async (c) => {
      await prepara(c, 5);
      await aplica(c, INVERSOS[4]);
      const r = await um<{ n: string; g: string; m: string }>(c,
        `SELECT (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ('integracao_salvar',
                   'fn_modelo_espelho_nome_ref','fn_espelho_modelo_nome_ref','salvar_precos_fixo_produto_importado',
                   '_salvar_precos_fixo_produto_importado_core')) AS n,
                (SELECT count(*) FROM pg_trigger WHERE tgname IN ('trg_modelo_espelho_nome_ref','trg_espelho_modelo_nome_ref')) AS g,
                md5(pg_get_functiondef('public._salvar_produto_importado_core(uuid,jsonb,jsonb,jsonb)'::regprocedure)) AS m`);
      expect(r).toEqual({ n: "0", g: "0", m: MD5_ANTES.impCore });
    });
  });

  it.skipIf(!MIG_TXN)("inverso 5 recusa se _salvar_produto_importado_core mudou por outra frente depois da migration 5", async () => {
    // D40/revisão T1 #1 (Important #1, mesmo padrão dos inversos 1/4): simula outra frente redefinindo
    // _salvar_produto_importado_core DEPOIS da migration 5 (corpo diferente, sem TRECHO_IMP_FIXO e sem bater com o
    // "antes") — o inverso deve RECUSAR (RAISE P0001 ASCII) sem tocar em nenhum DROP/gatilho.
    await withTx(async (c) => {
      await prepara(c, 5);
      await c.query(`
        CREATE OR REPLACE FUNCTION public._salvar_produto_importado_core(_id uuid, _dados jsonb, _variantes jsonb, _etapas jsonb)
         RETURNS uuid LANGUAGE plpgsql AS $function$
        BEGIN
          -- [outra frente] corpo diferente, sem relação com o texto de antes nem com o TRECHO_IMP_FIXO.
          RETURN _id;
        END; $function$;
      `);
      await expect(aplica(c, INVERSOS[4])).rejects.toThrow(
        /integracao_5_down: _salvar_produto_importado_core mudou depois da migration 5 - refazer o inverso/,
      );
      // as funções/gatilhos da migration 5 continuam existindo (a recusa aconteceu no $guarda$, antes de qualquer DROP).
      const r = await um<{ n: boolean }>(c, `SELECT to_regprocedure('public.integracao_salvar(jsonb,jsonb)') IS NOT NULL AS n`);
      expect(r.n).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar (N3)**

```bash
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres
INTEG_DONO_AVISADO=sim bash .superpowers/integracao/n3.sh antes t5
INTEGRACAO_MIG_TXN=1 npx vitest run --no-file-parallelism tests/integration/integracao-5-salvar.test.ts
bash .superpowers/integracao/n3.sh depois t5
```
Expected: FAIL — `ENOENT … 20261007140000_integracao_5_salvar.sql`.

- [ ] **Step 3: Escrever a migration 5 — `supabase/migrations/20261007140000_integracao_5_salvar.sql`**

```sql
-- Integração + API — 5/6: MÃO DUPLA e integracao_salvar (spec §5 "Regra da mão dupla por origem", R4, R5, V1, V3, n1, n5).
-- D13: nome e REF de revenda/importado ficam IGUAIS nos 2 registros por gatilhos AFTER UPDATE OF nome, ref (modelos →
-- produtos_* e produtos_* → modelos, só quando MUDOU; REF só valor não vazio): o Sheet, a Integração, o Dev e as telas
-- PA/PI passam a gravar os dois lados na mesma transação sem mudar nenhum gravador (fecha V3). A REF do espelho só chega
-- ao card ANTES do envio à Explosão (R2). P-88 A: vale já a partir desta migration (efeito no app no ar — o RODAR avisa).
-- D14: gravador NOVO do preço fixo do importado (espelha o da revenda: auth + loja + módulo produto_importado; sem checagem de
-- :preco_venda — V1/D1) p/ o Sheet (n1), o card (n2) e a integracao_salvar; e o _salvar_produto_importado_core (o SALVAR da
-- tela Importado, na transação do _rev_base do wrapper — R1) passa a aceitar o preço FIXO no _dados (fixo zera o markup do
-- canal; markup sem fixo limpa o fixo; nenhum dos dois mantém; diff mínimo TRECHO_IMP_FIXO na suíte).
-- integracao_salvar: as edições da tela, ATÔMICAS (passo 2 do Salvar — R4): só em produto não integrável, rev por produto
-- (P0409 ASCII), gates do CARD reconferidos no servidor (_integracao_gates — R2/n5), cada campo no MESMO lugar que o card
-- grava (preço do comprado pelo preço FIXO via os WRAPPERS; nome/REF do comprado pelos gatilhos), Keywords = UPDATE SÓ da
-- coluna com conferência do valor carregado (R5, P0409 keywords_mudou), log 'editar' com antes/depois.
-- Contagens: +5 funções (1 redefinida não conta) | +3 gatilhos. Inverso: supabase/rollback/20261007140000_integracao_5_salvar_down.sql.
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '3s';

DO $guarda$
DECLARE
  v_def text := pg_get_functiondef('public._salvar_produto_importado_core(uuid,jsonb,jsonb,jsonb)'::regprocedure);
BEGIN
  IF to_regprocedure('public.fn_integracao_trava_modelos()') IS NULL THEN
    RAISE EXCEPTION 'integracao_5: aplique a migration 4 antes' USING ERRCODE = 'P0001';
  END IF;
  IF md5(v_def) <> '47584858f55524d18d326dfff00139e6' AND position('[integracao v1]' IN v_def) = 0 THEN
    RAISE EXCEPTION 'integracao_5: _salvar_produto_importado_core com texto inesperado (md5 %)', md5(v_def) USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public.salvar_precos_fixo_produto_acabado(uuid,boolean,numeric,boolean,numeric)') IS NULL THEN
    RAISE EXCEPTION 'integracao_5: salvar_precos_fixo_produto_acabado ausente' USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

CREATE OR REPLACE FUNCTION public.fn_modelo_espelho_nome_ref()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ref text := nullif(btrim(coalesce(NEW.ref::text, '')), '');
BEGIN
  IF NEW.origem = 'revenda' THEN
    UPDATE public.produtos_acabados pa
       SET nome = NEW.nome, ref = coalesce(v_ref, pa.ref)
     WHERE pa.modelo_id = NEW.id
       AND (pa.nome IS DISTINCT FROM NEW.nome OR (v_ref IS NOT NULL AND pa.ref IS DISTINCT FROM v_ref));
  ELSIF NEW.origem = 'importado' THEN
    UPDATE public.produtos_importados pi
       SET nome = NEW.nome, ref = coalesce(v_ref, pi.ref)
     WHERE pi.modelo_id = NEW.id
       AND (pi.nome IS DISTINCT FROM NEW.nome OR (v_ref IS NOT NULL AND pi.ref IS DISTINCT FROM v_ref));
  END IF;
  RETURN NULL;
END
$function$;

CREATE OR REPLACE FUNCTION public.fn_espelho_modelo_nome_ref()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ref text := nullif(btrim(coalesce(NEW.ref, '')), '');
BEGIN
  IF NEW.modelo_id IS NULL THEN
    RETURN NULL;
  END IF;
  -- R2 (G-plano do plano): a REF do espelho só chega ao card enquanto o card deixaria mudar a REF (a régua do refEditavel:
  -- ANTES do envio à Explosão); depois disso não propaga (os SKUs guardam a REF do card). O nome vale sempre.
  UPDATE public.modelos m
     SET nome = NEW.nome,
         ref = CASE WHEN v_ref IS NOT NULL AND NOT coalesce(m.enviado_cad, false) THEN v_ref ELSE m.ref END
   WHERE m.id = NEW.modelo_id
     AND (m.nome IS DISTINCT FROM NEW.nome
          OR (v_ref IS NOT NULL AND NOT coalesce(m.enviado_cad, false) AND m.ref::text IS DISTINCT FROM v_ref));
  RETURN NULL;
END
$function$;

CREATE OR REPLACE TRIGGER trg_modelo_espelho_nome_ref AFTER UPDATE OF nome, ref ON public.modelos
  FOR EACH ROW WHEN (NEW.origem IN ('revenda', 'importado') AND (OLD.nome IS DISTINCT FROM NEW.nome OR OLD.ref IS DISTINCT FROM NEW.ref))
  EXECUTE FUNCTION public.fn_modelo_espelho_nome_ref();
CREATE OR REPLACE TRIGGER trg_espelho_modelo_nome_ref AFTER UPDATE OF nome, ref ON public.produtos_acabados
  FOR EACH ROW WHEN (OLD.nome IS DISTINCT FROM NEW.nome OR OLD.ref IS DISTINCT FROM NEW.ref)
  EXECUTE FUNCTION public.fn_espelho_modelo_nome_ref();
CREATE OR REPLACE TRIGGER trg_espelho_modelo_nome_ref AFTER UPDATE OF nome, ref ON public.produtos_importados
  FOR EACH ROW WHEN (OLD.nome IS DISTINCT FROM NEW.nome OR OLD.ref IS DISTINCT FROM NEW.ref)
  EXECUTE FUNCTION public.fn_espelho_modelo_nome_ref();

CREATE OR REPLACE FUNCTION public._salvar_precos_fixo_produto_importado_core(_produto_id uuid, _tocar_atacado boolean,
  _preco_atacado_fixo numeric, _tocar_varejo boolean, _preco_varejo_fixo numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid;
begin
  -- D14: espelho de _salvar_precos_fixo_produto_acabado_core — preço EXATO; fixar um canal LIMPA o markup dele.
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;
  v_tenant := public.get_user_tenant_id();
  if v_tenant = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Loja inativa ou sem tenant — operação não permitida' using errcode = '42501';
  end if;
  if (_tocar_atacado and _preco_atacado_fixo is not null and _preco_atacado_fixo <= 0)
     or (_tocar_varejo and _preco_varejo_fixo is not null and _preco_varejo_fixo <= 0) then
    raise exception 'O preço precisa ser maior que zero.' using errcode = 'P0001';
  end if;
  update public.produtos_importados
    set preco_atacado_fixo = case when _tocar_atacado then _preco_atacado_fixo else preco_atacado_fixo end,
        markup_atacado = case when _tocar_atacado and _preco_atacado_fixo is not null then null else markup_atacado end,
        preco_varejo_fixo = case when _tocar_varejo then _preco_varejo_fixo else preco_varejo_fixo end,
        markup_varejo = case when _tocar_varejo and _preco_varejo_fixo is not null then null else markup_varejo end,
        updated_at = now()
    where id = _produto_id and tenant_id = v_tenant;
  if not found then
    raise exception 'Produto não encontrado' using errcode = 'P0001';
  end if;
  perform public._imp_recomputar_precos_modelo(_produto_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.salvar_precos_fixo_produto_importado(_produto_id uuid, _tocar_atacado boolean,
  _preco_atacado_fixo numeric, _tocar_varejo boolean, _preco_varejo_fixo numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.tenant_module_enabled('produto_importado') then
    raise exception 'Módulo Produto Importado não habilitado para esta loja' using errcode = '42501';
  end if;
  perform public._salvar_precos_fixo_produto_importado_core(
    _produto_id, _tocar_atacado, _preco_atacado_fixo, _tocar_varejo, _preco_varejo_fixo);
end;
$function$;

-- D14/R1 — save do importado (antes = md5 47584858…; depois = antes + TRECHO_IMP_FIXO antes das variantes)
CREATE OR REPLACE FUNCTION public._salvar_produto_importado_core(_id uuid, _dados jsonb, _variantes jsonb, _etapas jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid;
  v_id uuid;
  v_nome text;
  v_grupo_id uuid;
  v_categoria_id uuid;
  v_soma_merc numeric;
  v_soma_frete numeric;
  rec jsonb;
  v_ord int;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  v_tenant := public.get_user_tenant_id();
  if v_tenant = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Loja inativa ou sem tenant — operação não permitida' using errcode = '42501';
  end if;

  v_nome := nullif(_dados->>'nome','');
  v_grupo_id := nullif(_dados->>'grupo_id','')::uuid;
  v_categoria_id := nullif(_dados->>'categoria_id','')::uuid;

  -- Validação Σ% por base = 100 (só quando há etapas da base).
  select coalesce(sum((e->>'percentual')::numeric),0) into v_soma_merc
    from jsonb_array_elements(coalesce(_etapas,'[]'::jsonb)) e where e->>'base' = 'mercadoria';
  select coalesce(sum((e->>'percentual')::numeric),0) into v_soma_frete
    from jsonb_array_elements(coalesce(_etapas,'[]'::jsonb)) e where e->>'base' = 'frete';
  if exists(select 1 from jsonb_array_elements(coalesce(_etapas,'[]'::jsonb)) e where e->>'base'='mercadoria') and round(v_soma_merc,2) <> 100 then
    raise exception 'A soma das etapas de mercadoria (%) precisa fechar 100%%.', round(v_soma_merc,2) using errcode = 'P0001';
  end if;
  if exists(select 1 from jsonb_array_elements(coalesce(_etapas,'[]'::jsonb)) e where e->>'base'='frete') and round(v_soma_frete,2) <> 100 then
    raise exception 'A soma das etapas de frete (%) precisa fechar 100%%.', round(v_soma_frete,2) using errcode = 'P0001';
  end if;

  if _id is null then
    if v_grupo_id is null or v_categoria_id is null then
      raise exception 'Informe grupo e categoria do produto.' using errcode = 'P0001';
    end if;
    if v_nome is null then
      raise exception 'Informe o nome do produto.' using errcode = 'P0001';
    end if;
    insert into public.produtos_importados (
      tenant_id, nome, ref, grupo_id, categoria_id, subcategoria1_id, subcategoria2_id,
      colecao_id, subcolecao, semana, empresa_id, representante_id, ref_fornecedor,
      composicao, grade_proporcao, qtd_total, foto_url, data_pedido, data_prevista, data_entrega,
      moeda_compra, moeda_intermediaria, valor_unitario_m1, cotacao_ref, peso_kg, transporte_m2,
      desconto_pct, cotacao_final, markup_atacado, markup_varejo
    ) values (
      -- ref: se o usuário digitou uma REF manual, ela é gravada e o trigger fn_produto_importado_ref
      -- NÃO a sobrescreve (ele só gera quando new.ref é vazio). Senão null → trigger gera a automática.
      v_tenant, v_nome, nullif(_dados->>'ref',''), v_grupo_id, v_categoria_id,
      nullif(_dados->>'subcategoria1_id','')::uuid, nullif(_dados->>'subcategoria2_id','')::uuid,
      nullif(_dados->>'colecao_id','')::uuid, nullif(_dados->>'subcolecao',''), nullif(_dados->>'semana',''),
      nullif(_dados->>'empresa_id','')::uuid, nullif(_dados->>'representante_id','')::uuid, nullif(_dados->>'ref_fornecedor',''),
      nullif(_dados->>'composicao',''), coalesce(_dados->'grade_proporcao','{}'::jsonb), coalesce((_dados->>'qtd_total')::int,0),
      nullif(_dados->>'foto_url',''), nullif(_dados->>'data_pedido','')::date, nullif(_dados->>'data_prevista','')::date, nullif(_dados->>'data_entrega','')::date,
      coalesce(nullif(_dados->>'moeda_compra',''),'RMB'), nullif(_dados->>'moeda_intermediaria',''),
      coalesce((_dados->>'valor_unitario_m1')::numeric,0), coalesce((_dados->>'cotacao_ref')::numeric,0),
      coalesce((_dados->>'peso_kg')::numeric,0), coalesce((_dados->>'transporte_m2')::numeric,0),
      coalesce((_dados->>'desconto_pct')::numeric,0), coalesce((_dados->>'cotacao_final')::numeric,0),
      nullif(_dados->>'markup_atacado','')::numeric, nullif(_dados->>'markup_varejo','')::numeric
    ) returning id into v_id;
  else
    update public.produtos_importados set
      nome = coalesce(v_nome, nome),
      -- ref: grava a manual digitada; se vier vazia, mantém a atual (não zera a REF existente).
      ref = coalesce(nullif(_dados->>'ref',''), ref),
      grupo_id = coalesce(v_grupo_id, grupo_id),
      categoria_id = coalesce(v_categoria_id, categoria_id),
      subcategoria1_id = nullif(_dados->>'subcategoria1_id','')::uuid,
      subcategoria2_id = nullif(_dados->>'subcategoria2_id','')::uuid,
      subcolecao = nullif(_dados->>'subcolecao',''),
      semana = nullif(_dados->>'semana',''),
      empresa_id = nullif(_dados->>'empresa_id','')::uuid,
      representante_id = nullif(_dados->>'representante_id','')::uuid,
      ref_fornecedor = nullif(_dados->>'ref_fornecedor',''),
      composicao = nullif(_dados->>'composicao',''),
      grade_proporcao = coalesce(_dados->'grade_proporcao', grade_proporcao),
      qtd_total = coalesce((_dados->>'qtd_total')::int, qtd_total),
      foto_url = nullif(_dados->>'foto_url',''),
      data_pedido = nullif(_dados->>'data_pedido','')::date,
      data_prevista = nullif(_dados->>'data_prevista','')::date,
      data_entrega = nullif(_dados->>'data_entrega','')::date,
      moeda_compra = coalesce(nullif(_dados->>'moeda_compra',''), moeda_compra),
      moeda_intermediaria = nullif(_dados->>'moeda_intermediaria',''),
      valor_unitario_m1 = coalesce((_dados->>'valor_unitario_m1')::numeric, valor_unitario_m1),
      cotacao_ref = coalesce((_dados->>'cotacao_ref')::numeric, cotacao_ref),
      peso_kg = coalesce((_dados->>'peso_kg')::numeric, peso_kg),
      transporte_m2 = coalesce((_dados->>'transporte_m2')::numeric, transporte_m2),
      desconto_pct = coalesce((_dados->>'desconto_pct')::numeric, desconto_pct),
      cotacao_final = coalesce((_dados->>'cotacao_final')::numeric, cotacao_final),
      markup_atacado = nullif(_dados->>'markup_atacado','')::numeric,
      markup_varejo = nullif(_dados->>'markup_varejo','')::numeric,
      updated_at = now()
    where id = _id and tenant_id = v_tenant
    returning id into v_id;
    if v_id is null then raise exception 'Produto não encontrado'; end if;
  end if;

  -- [integracao v1] D14/R1: o preço do Importado grava no SALVAR da tela, NESTA transação (a do _rev_base do wrapper).
  -- Preço FIXO no _dados = preço exato do canal e ZERA o markup dele; sem fixo, markup não-nulo LIMPA o fixo ("última
  -- edição manda", como a revenda — fix 2efa2ba); sem nenhum dos dois, o fixo fica (outros gravadores não mandam as chaves).
  if coalesce(nullif(_dados->>'preco_atacado_fixo','')::numeric, 1) <= 0
     or coalesce(nullif(_dados->>'preco_varejo_fixo','')::numeric, 1) <= 0 then
    raise exception 'O preço precisa ser maior que zero.' using errcode = 'P0001';
  end if;
  update public.produtos_importados p
     set preco_atacado_fixo = n.af, markup_atacado = n.am, preco_varejo_fixo = n.vf, markup_varejo = n.vm
    from (select
            case when nullif(_dados->>'preco_atacado_fixo','') is not null then (_dados->>'preco_atacado_fixo')::numeric
                 when nullif(_dados->>'markup_atacado','') is not null then null else x.preco_atacado_fixo end as af,
            case when nullif(_dados->>'preco_atacado_fixo','') is not null then null else x.markup_atacado end as am,
            case when nullif(_dados->>'preco_varejo_fixo','') is not null then (_dados->>'preco_varejo_fixo')::numeric
                 when nullif(_dados->>'markup_varejo','') is not null then null else x.preco_varejo_fixo end as vf,
            case when nullif(_dados->>'preco_varejo_fixo','') is not null then null else x.markup_varejo end as vm
            from public.produtos_importados x where x.id = v_id) n
   where p.id = v_id
     and (p.preco_atacado_fixo, p.markup_atacado, p.preco_varejo_fixo, p.markup_varejo) is distinct from (n.af, n.am, n.vf, n.vm);

  -- Variantes: estado completo (apaga e reinsere pela ordem recebida).
  delete from public.produto_importado_variantes where produto_importado_id = v_id;
  for rec in select * from jsonb_array_elements(coalesce(_variantes,'[]'::jsonb)) loop
    insert into public.produto_importado_variantes (tenant_id, produto_importado_id, ordem, cor_id, cor_apelido_id, peso, qtd)
    values (v_tenant, v_id, coalesce((rec->>'ordem')::int, 0),
      nullif(rec->>'cor_id','')::uuid, nullif(rec->>'cor_apelido_id','')::uuid,
      coalesce((rec->>'peso')::numeric,0), coalesce((rec->>'qtd')::int,0));
  end loop;

  -- Etapas: estado completo.
  delete from public.produto_importado_etapas where produto_importado_id = v_id;
  for rec in select * from jsonb_array_elements(coalesce(_etapas,'[]'::jsonb)) loop
    insert into public.produto_importado_etapas (tenant_id, produto_importado_id, ordem, rotulo, base, percentual, data_vencimento, cotacao)
    values (v_tenant, v_id, coalesce((rec->>'ordem')::int,0), nullif(rec->>'rotulo',''),
      coalesce(nullif(rec->>'base',''),'mercadoria'), coalesce((rec->>'percentual')::numeric,0),
      nullif(rec->>'data_vencimento','')::date, coalesce((rec->>'cotacao')::numeric,0));
  end loop;

  perform public._imp_recomputar_precos_modelo(v_id);
  return v_id;
end $function$;

CREATE OR REPLACE FUNCTION public.integracao_salvar(_itens jsonb, _keywords jsonb DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public._integracao_exige(true);
  v_itens jsonb := coalesce(_itens, '[]'::jsonb);
  v_chaves_ok text[] := ARRAY['nome', 'ref', 'preco_anterior', 'preco_venda', 'peso_kg', 'ncm', 'titulo_pagina',
                              'descricao_produto', 'comprimento_cm', 'largura_cm', 'altura_cm', 'fotos_modelo'];
  v_num text[] := ARRAY['preco_anterior', 'preco_venda', 'peso_kg', 'comprimento_cm', 'largura_cm', 'altura_cm'];
  m public.modelos%ROWTYPE;
  r record;
  v_c jsonb;
  v_g jsonb;
  v_k text;
  v_gate text;
  v_antes jsonb;
  v_depois jsonb;
  v_prod uuid;
  v_revs jsonb := '{}'::jsonb;
  v_n integer := 0;
  v_kw_atual text;
  v_kw_novo text;
BEGIN
  IF jsonb_typeof(v_itens) <> 'array' OR jsonb_array_length(v_itens) > 50 THEN
    RAISE EXCEPTION 'Envie no máximo 50 produtos por vez.' USING ERRCODE = 'P0001';
  END IF;
  FOR r IN
    SELECT DISTINCT ON ((e.x ->> 'modelo_id')::uuid) (e.x ->> 'modelo_id')::uuid AS modelo_id,
           (e.x ->> 'rev')::integer AS rev_base, coalesce(e.x -> 'campos', '{}'::jsonb) AS campos
      FROM jsonb_array_elements(v_itens) AS e(x)
     ORDER BY (e.x ->> 'modelo_id')::uuid
  LOOP
    SELECT * INTO m FROM public.modelos x WHERE x.id = r.modelo_id AND x.tenant_id = v_tenant FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Produto não encontrado nesta loja.' USING ERRCODE = 'P0001';
    END IF;
    v_c := r.campos;
    IF jsonb_typeof(v_c) <> 'object' OR EXISTS (SELECT 1 FROM jsonb_object_keys(v_c) AS k(k) WHERE k.k <> ALL(v_chaves_ok)) THEN
      RAISE EXCEPTION 'Campo desconhecido na gravação da Integração.' USING ERRCODE = 'P0001';
    END IF;
    IF m.rev IS DISTINCT FROM r.rev_base THEN
      RAISE EXCEPTION 'conflito_versao: o produto foi salvo por outra pessoa' USING ERRCODE = 'P0409';
    END IF;
    v_g := public._integracao_gates(r.modelo_id);
    IF v_g ->> 'estado' <> 'nao_integravel' THEN
      RAISE EXCEPTION 'integracao_travado: produto' USING ERRCODE = '42501';
    END IF;
    -- R2/V1/n5: a MESMA regra do card, campo a campo, reconferida no servidor (inclui módulo da origem)
    FOR v_k IN SELECT k.k FROM jsonb_object_keys(v_c) AS k(k) ORDER BY 1 LOOP
      -- (G-migration fix 5, 27/set: o braço descricao_produto → compartilhado SAIU — Descrição cai no ELSE 'planejamento')
      v_gate := CASE v_k WHEN 'nome' THEN 'compartilhado' WHEN 'descricao_produto' THEN 'compartilhado'
                         WHEN 'fotos_modelo' THEN 'compartilhado' WHEN 'ref' THEN 'ref'
                         WHEN 'preco_venda' THEN 'preco' WHEN 'preco_anterior' THEN 'preco' ELSE 'planejamento' END;
      IF NOT coalesce((v_g -> v_gate ->> 'ok')::boolean, false) THEN
        RAISE EXCEPTION 'integracao_sem_permissao: %', v_k USING ERRCODE = '42501';
      END IF;
    END LOOP;
    IF v_c ? 'nome' AND nullif(btrim(coalesce(v_c ->> 'nome', '')), '') IS NULL THEN
      RAISE EXCEPTION 'O nome não pode ficar vazio.' USING ERRCODE = 'P0001';
    END IF;
    IF v_c ? 'ref' AND nullif(btrim(coalesce(v_c ->> 'ref', '')), '') IS NULL THEN
      RAISE EXCEPTION 'A REF não pode ficar vazia.' USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_each(v_c) AS e(key, value) WHERE e.key = ANY(v_num)
                AND NOT CASE WHEN jsonb_typeof(e.value) = 'null' THEN true
                             WHEN jsonb_typeof(e.value) = 'number' THEN (e.value #>> '{}')::numeric >= 0
                             ELSE false END) THEN
      RAISE EXCEPTION 'Valor numérico inválido (use número maior ou igual a zero).' USING ERRCODE = 'P0001';
    END IF;
    IF v_c ? 'fotos_modelo' THEN
      IF jsonb_typeof(v_c -> 'fotos_modelo') <> 'array'
         OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_c -> 'fotos_modelo') AS p(x)
                     WHERE NOT starts_with(p.x, v_tenant::text || '/')) THEN
        RAISE EXCEPTION 'Foto inválida (de outra loja).' USING ERRCODE = 'P0001';
      END IF;
    END IF;
    v_antes := to_jsonb(m);
    UPDATE public.modelos SET
      nome = CASE WHEN v_c ? 'nome' THEN btrim(v_c ->> 'nome') ELSE nome END,
      ref = CASE WHEN v_c ? 'ref' THEN btrim(v_c ->> 'ref') ELSE ref END,
      preco_anterior = CASE WHEN v_c ? 'preco_anterior' THEN (v_c ->> 'preco_anterior')::numeric ELSE preco_anterior END,
      preco_venda = CASE WHEN v_c ? 'preco_venda' AND coalesce(m.origem, 'interno') NOT IN ('revenda', 'importado')
                         THEN (v_c ->> 'preco_venda')::numeric ELSE preco_venda END,
      peso_kg = CASE WHEN v_c ? 'peso_kg' THEN (v_c ->> 'peso_kg')::numeric ELSE peso_kg END,
      ncm = CASE WHEN v_c ? 'ncm' THEN nullif(btrim(coalesce(v_c ->> 'ncm', '')), '') ELSE ncm END,
      titulo_pagina = CASE WHEN v_c ? 'titulo_pagina' THEN nullif(btrim(coalesce(v_c ->> 'titulo_pagina', '')), '') ELSE titulo_pagina END,
      descricao_produto = CASE WHEN v_c ? 'descricao_produto' THEN nullif(btrim(coalesce(v_c ->> 'descricao_produto', '')), '') ELSE descricao_produto END,
      comprimento_cm = CASE WHEN v_c ? 'comprimento_cm' THEN (v_c ->> 'comprimento_cm')::numeric ELSE comprimento_cm END,
      largura_cm = CASE WHEN v_c ? 'largura_cm' THEN (v_c ->> 'largura_cm')::numeric ELSE largura_cm END,
      altura_cm = CASE WHEN v_c ? 'altura_cm' THEN (v_c ->> 'altura_cm')::numeric ELSE altura_cm END,
      fotos_modelo = CASE WHEN v_c ? 'fotos_modelo'
                          THEN ARRAY(SELECT p.x FROM jsonb_array_elements_text(v_c -> 'fotos_modelo') AS p(x)) ELSE fotos_modelo END
    WHERE id = r.modelo_id;
    -- preço de venda do COMPRADO = preço FIXO pelo gravador de cada origem (os WRAPPERS — R4; V1: sem checagem nova neles)
    IF v_c ? 'preco_venda' AND m.origem IN ('revenda', 'importado') THEN
      IF m.origem = 'revenda' THEN
        SELECT pa.id INTO v_prod FROM public.produtos_acabados pa WHERE pa.modelo_id = r.modelo_id;
        IF v_prod IS NULL THEN
          RAISE EXCEPTION 'Produto de revenda sem cadastro no Produto Acabado.' USING ERRCODE = 'P0001';
        END IF;
        PERFORM public.salvar_precos_fixo_produto_acabado(v_prod, false, NULL, true, (v_c ->> 'preco_venda')::numeric);
      ELSE
        SELECT pi.id INTO v_prod FROM public.produtos_importados pi WHERE pi.modelo_id = r.modelo_id;
        IF v_prod IS NULL THEN
          RAISE EXCEPTION 'Produto importado sem cadastro no Produto Importado.' USING ERRCODE = 'P0001';
        END IF;
        PERFORM public.salvar_precos_fixo_produto_importado(v_prod, false, NULL, true, (v_c ->> 'preco_venda')::numeric);
      END IF;
    END IF;
    SELECT to_jsonb(x) INTO v_depois FROM public.modelos x WHERE x.id = r.modelo_id;
    PERFORM public._integracao_logar(v_tenant, 'editar', r.modelo_id, jsonb_build_object('campos',
      (SELECT jsonb_object_agg(k.k, jsonb_build_object('antes', v_antes -> k.k, 'depois', v_depois -> k.k))
         FROM jsonb_object_keys(v_c) AS k(k))), NULL);
    v_revs := v_revs || jsonb_build_object(r.modelo_id::text, (v_depois ->> 'rev')::integer);
    v_n := v_n + 1;
  END LOOP;

  IF _keywords IS NOT NULL THEN
    -- R5: SÓ a coluna keywords, com conferência do valor carregado (nunca o upsert da linha da Config)
    IF NOT (public.is_tenant_admin() OR public.is_super_admin()) THEN
      RAISE EXCEPTION 'integracao_sem_permissao: keywords' USING ERRCODE = '42501';
    END IF;
    SELECT tc.keywords INTO v_kw_atual FROM public.tenant_config tc WHERE tc.tenant_id = v_tenant FOR UPDATE;
    IF coalesce(v_kw_atual, '') IS DISTINCT FROM coalesce(_keywords ->> 'esperado', '') THEN
      RAISE EXCEPTION 'keywords_mudou: as keywords da loja mudaram' USING ERRCODE = 'P0409';
    END IF;
    v_kw_novo := nullif(btrim(coalesce(_keywords ->> 'valor', '')), '');
    UPDATE public.tenant_config SET keywords = v_kw_novo WHERE tenant_id = v_tenant;
    PERFORM public._integracao_logar(v_tenant, 'editar', NULL,
      jsonb_build_object('keywords', jsonb_build_object('antes', v_kw_atual, 'depois', v_kw_novo)), NULL);
  END IF;
  RETURN jsonb_build_object('salvos', v_n, 'revs', v_revs);
END
$function$;

REVOKE EXECUTE ON FUNCTION public._salvar_precos_fixo_produto_importado_core(uuid, boolean, numeric, boolean, numeric) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.salvar_precos_fixo_produto_importado(uuid, boolean, numeric, boolean, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.salvar_precos_fixo_produto_importado(uuid, boolean, numeric, boolean, numeric) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.integracao_salvar(jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.integracao_salvar(jsonb, jsonb) TO authenticated;

DO $pos$
BEGIN
  IF position('[integracao v1]' IN pg_get_functiondef('public._salvar_produto_importado_core(uuid,jsonb,jsonb,jsonb)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'integracao_5: save do importado sem o trecho novo' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE tgname IN ('trg_modelo_espelho_nome_ref', 'trg_espelho_modelo_nome_ref')) <> 3 THEN
    RAISE EXCEPTION 'integracao_5: gatilhos da mao dupla incompletos' USING ERRCODE = 'P0001';
  END IF;
  IF has_function_privilege('authenticated', 'public._salvar_precos_fixo_produto_importado_core(uuid,boolean,numeric,boolean,numeric)', 'EXECUTE')
     OR has_function_privilege('public', 'public._salvar_precos_fixo_produto_importado_core(uuid,boolean,numeric,boolean,numeric)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.integracao_salvar(jsonb,jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.integracao_salvar(jsonb,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'integracao_5: ACL errada (inv. 9)' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
```

- [ ] **Step 4: Montar o inverso 5 por script (o "antes" do save do importado vem do dump; o `$guarda$` recusa se
      `_salvar_produto_importado_core` mudou por outra frente depois desta migration — D40/revisão T1 #1, MESMO
      padrão dos inversos 1 e 4)**

```bash
cat > .superpowers/integracao/mig/montar_inverso_5.sh <<'BASH'
#!/usr/bin/env bash
# Monta supabase/rollback/20261007140000_integracao_5_salvar_down.sql. O save do importado volta ao texto de ANTES
# (.superpowers/integracao/mig/antes/_salvar_produto_importado_core.sql, de dump_antes.sh) — nunca editar à mão. O
# $guarda$ RECUSA (RAISE P0001 ASCII) a menos que _salvar_produto_importado_core ainda seja a versão instalada pela
# migration 5: md5 = "antes" OU ("antes" + TRECHO_IMP_FIXO removido) — D40/revisão T1 #1 (mesmo padrão dos inversos 1/4).
set -euo pipefail
TOP="$(git rev-parse --show-toplevel)"; cd "$TOP"
case "$TOP" in */.claude/worktrees/integracao-impl) ;; *) echo "PARE: rode de dentro da worktree integracao-impl"; exit 1;; esac
A=.superpowers/integracao/mig/antes
OUT=supabase/rollback/20261007140000_integracao_5_salvar_down.sql
[ -f "$A/_salvar_produto_importado_core.sql" ] || { echo "PARE: rode dump_antes.sh primeiro"; exit 1; }

# TRECHO_IMP_FIXO literal (idêntico a tests/integration/integracao-5-salvar.test.ts TRECHO_IMP_FIXO); aspas simples
# do SQL escapadas ('\''), porque este bloco entra dentro de um literal SQL '...' no replace() do $guarda$.
TRECHO=$'  -- [integracao v1] D14/R1: o preço do Importado grava no SALVAR da tela, NESTA transação (a do _rev_base do wrapper).\n  -- Preço FIXO no _dados = preço exato do canal e ZERA o markup dele; sem fixo, markup não-nulo LIMPA o fixo ("última\n  -- edição manda", como a revenda — fix 2efa2ba); sem nenhum dos dois, o fixo fica (outros gravadores não mandam as chaves).\n  if coalesce(nullif(_dados->>\'\'preco_atacado_fixo\'\',\'\'\'\')::numeric, 1) <= 0\n     or coalesce(nullif(_dados->>\'\'preco_varejo_fixo\'\',\'\'\'\')::numeric, 1) <= 0 then\n    raise exception \'\'O preço precisa ser maior que zero.\'\' using errcode = \'\'P0001\'\';\n  end if;\n  update public.produtos_importados p\n     set preco_atacado_fixo = n.af, markup_atacado = n.am, preco_varejo_fixo = n.vf, markup_varejo = n.vm\n    from (select\n            case when nullif(_dados->>\'\'preco_atacado_fixo\'\',\'\'\'\') is not null then (_dados->>\'\'preco_atacado_fixo\'\')::numeric\n                 when nullif(_dados->>\'\'markup_atacado\'\',\'\'\'\') is not null then null else x.preco_atacado_fixo end as af,\n            case when nullif(_dados->>\'\'preco_atacado_fixo\'\',\'\'\'\') is not null then null else x.markup_atacado end as am,\n            case when nullif(_dados->>\'\'preco_varejo_fixo\'\',\'\'\'\') is not null then (_dados->>\'\'preco_varejo_fixo\'\')::numeric\n                 when nullif(_dados->>\'\'markup_varejo\'\',\'\'\'\') is not null then null else x.preco_varejo_fixo end as vf,\n            case when nullif(_dados->>\'\'preco_varejo_fixo\'\',\'\'\'\') is not null then null else x.markup_varejo end as vm\n            from public.produtos_importados x where x.id = v_id) n\n   where p.id = v_id\n     and (p.preco_atacado_fixo, p.markup_atacado, p.preco_varejo_fixo, p.markup_varejo) is distinct from (n.af, n.am, n.vf, n.vm);\n\n'

{
cat <<'SQL'
-- Inverso de 20261007140000_integracao_5_salvar.sql — MONTADO pela Task 5 (o save do importado volta ao texto de ANTES,
-- gerado por .superpowers/integracao/mig/dump_antes.sh — nunca editar à mão). Rodar SÓ depois do inverso 6 (LIFO).
-- Preços fixos de importado já gravados FICAM (a coluna já existia; o recálculo continua lendo); a mão dupla por gatilho sai.
-- D40/revisão T1 #1: o $guarda$ recusa se _salvar_produto_importado_core mudou depois da migration 5 (aceita só o
-- "antes" exato ou "antes"+TRECHO_IMP_FIXO — nunca sobrescreve uma mudança de outra frente em silêncio).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '3s';

DO $guarda$
DECLARE
  v_def text;
BEGIN
  IF to_regprocedure('public._integracao_ler(text,boolean,text,integer,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'integracao_5_down: volte a migration 6 antes (LIFO)' USING ERRCODE = 'P0001';
  END IF;
  v_def := pg_get_functiondef('public._salvar_produto_importado_core(uuid,jsonb,jsonb,jsonb)'::regprocedure);
  IF md5(v_def) <> '47584858f55524d18d326dfff00139e6'
     AND NOT (position('[integracao v1]' IN v_def) > 0
              AND md5(replace(v_def, '
SQL
printf '%s' "$TRECHO" | tail -c +1
cat <<'SQL'
', '')) = '47584858f55524d18d326dfff00139e6') THEN
    RAISE EXCEPTION 'integracao_5_down: _salvar_produto_importado_core mudou depois da migration 5 - refazer o inverso' USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

DROP TRIGGER IF EXISTS trg_modelo_espelho_nome_ref ON public.modelos;
DROP TRIGGER IF EXISTS trg_espelho_modelo_nome_ref ON public.produtos_acabados;
DROP TRIGGER IF EXISTS trg_espelho_modelo_nome_ref ON public.produtos_importados;
DROP FUNCTION IF EXISTS public.fn_modelo_espelho_nome_ref();
DROP FUNCTION IF EXISTS public.fn_espelho_modelo_nome_ref();
DROP FUNCTION IF EXISTS public.integracao_salvar(jsonb, jsonb);
DROP FUNCTION IF EXISTS public.salvar_precos_fixo_produto_importado(uuid, boolean, numeric, boolean, numeric);
DROP FUNCTION IF EXISTS public._salvar_precos_fixo_produto_importado_core(uuid, boolean, numeric, boolean, numeric);

SQL
printf '%s\n;\n' "$(cat "$A/_salvar_produto_importado_core.sql")"
cat <<'SQL'

DO $pos$
BEGIN
  IF md5(pg_get_functiondef('public._salvar_produto_importado_core(uuid,jsonb,jsonb,jsonb)'::regprocedure)) <> '47584858f55524d18d326dfff00139e6' THEN
    RAISE EXCEPTION 'integracao_5_down: save do importado nao voltou ao texto de antes' USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public.integracao_salvar(jsonb,jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'integracao_5_down: funcoes da migration 5 ainda existem' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
SQL
} > "$OUT"
echo "escrito: $OUT ($(wc -l < "$OUT" | tr -d ' ') linhas)"
grep -c 'CREATE OR REPLACE FUNCTION public._salvar_produto_importado_core' "$OUT"   # 1
grep -c "RAISE EXCEPTION 'integracao_5_down: _salvar_produto_importado_core mudou depois da migration 5" "$OUT"   # 1
BASH
chmod +x .superpowers/integracao/mig/montar_inverso_5.sh
bash .superpowers/integracao/mig/montar_inverso_5.sh
```

- [ ] **Step 5: Rodar e ver passar (N3)**

```bash
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres
INTEG_DONO_AVISADO=sim bash .superpowers/integracao/n3.sh antes t5
INTEGRACAO_MIG_TXN=1 npx vitest run --no-file-parallelism tests/integration/integracao-4-trava.test.ts tests/integration/integracao-5-salvar.test.ts
bash .superpowers/integracao/n3.sh depois t5
```
Expected: PASS (4: 11 · 5: 8). Obs.: a suíte 4 roda com `prepara(c, 4)`; os gatilhos de mão dupla da 5 não interferem.

- [ ] **Step 6: Gates + commit**

```bash
bash .superpowers/integracao/gates.sh
git add -- supabase/migrations/20261007140000_integracao_5_salvar.sql supabase/rollback/20261007140000_integracao_5_salvar_down.sql \
  tests/integration/integracao-5-salvar.test.ts
git commit --only -m "feat(integracao): migration 5 — mão dupla nome/REF por gatilho, preço fixo do importado, integracao_salvar com gates do card e Keywords conferidas

Co-Authored-By: Claude <modelo real> <noreply@anthropic.com>" -- supabase/migrations/20261007140000_integracao_5_salvar.sql \
  supabase/rollback/20261007140000_integracao_5_salvar_down.sql tests/integration/integracao-5-salvar.test.ts
git show --stat HEAD | tail -n +7
```

---

### Task 6: Migration 6 — configurações, chaves, acessos, exemplo e as 2 fases da API (`_integracao_ler/_confirmar`) + inverso 6

**Files:**
- Create: `supabase/migrations/20261007150000_integracao_6_api.sql`
- Create: `supabase/rollback/20261007150000_integracao_6_api_down.sql`
- Test: `tests/integration/integracao-6-api.test.ts`

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces (RPC `authenticated`, SÓ super admin — v4/P-81 A): `integracao_salvar_config(_campos text[], _rev integer) →
  config_ler`; `integracao_salvar_config_api(_valores jsonb {limite_por_minuto?, max_por_pagina?, validade_foto_dias?,
  bloqueio_tentativas?}, _rev integer) → config_ler`; `integracao_chaves_listar() → jsonb[{id, nome, final, criada_por,
  criada_em, revogada_em, ultimo_uso_em}]`; `integracao_chave_criar(_nome text) → {id, nome, chave, final}` (a chave SÓ
  aqui, 1×); `integracao_chave_revogar(_id uuid) → {ok}`; `integracao_acessos_listar(_limite integer) → jsonb[{id, chave,
  final, ip, modo, status, tentativas, produtos, exemplos, linhas, quando}]`; `integracao_exemplo() → RespostaLer` (modo teste, N12:
  não registra acesso).
- Produces (internas, REVOKE dos 3): `_integracao_colunas(text[]) → {chaves[], rotulos[]}`; `_integracao_exemplo(_campos
  text[], _pagina integer) → {produtos[], proximo_cursor}` (P-82 A; foto = `["exemplo"]`); `_integracao_valores(
  integracao_linhas, _chaves text[], _campos_produto text[]) → jsonb` (valores na ordem; foto = lista de caminhos).
- Produces (SÓ `service_role` — a rota): `_integracao_ler(_chave_hash text, _incluir_integrados boolean, _cursor text,
  _limite integer, _modo text, _ip text) → RespostaLer`; `_integracao_confirmar(_chave_id uuid, _acesso_id uuid, _entrega
  jsonb {produtos[{modelo_id, assinatura}], fotos_descartadas, fotos_ausentes}) → {status, confirmados[{modelo_id,
  integrado_em}]}`; `_integracao_limpar(_tenant uuid) → integer`.
- `RespostaLer` (contrato com as Tasks 16 e 19): `{status: 'ok'|'parametro_invalido'|'chave_invalida'|'loja_inativa'|
  'ip_bloqueado'|'limite_excedido', retry_after?, tenant_id?, modo?, acesso_id?, chave_id?, loja?{id,nome}, colunas?[rótulos],
  chaves_colunas?[chaves], produtos?[{modelo_id, estado, assinatura, integrado_em, linhas[{tipo, loja_nome?, valores[]}]}],
  proximo_cursor?, validade_foto_dias?, pagina?{limite, maximo}}` (`pagina` — D39/P-89 A: no normal `limite` = o `v_lim`
  aplicado; no teste e no `integracao_exemplo` = 2; `maximo` = `max_por_pagina` da loja).

- [ ] **Step 1: Escrever o teste (falha: migration 6 ausente)**

`tests/integration/integracao-6-api.test.ts`:

```ts
/** Integração + API — migration 6 (config, chaves, acessos, _integracao_ler/_confirmar). Plano Task 6. Só na cópia (N3). */
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { createHash } from "node:crypto";
import { hasDb, withTx, comoUsuario, um } from "./db";
import { CAMPOS_PADRAO, INVERSOS, LAYOUT, LOCAL, MIG_TXN, T, U, aplica, comoUsuarioCom, keywordsLoja, modeloInterno, prepara } from "./integracao-helpers";

const sha = (s: string): string => createHash("sha256").update(s).digest("hex");
async function marcar(c: Client, id: string): Promise<void> {
  const a = (await um<{ r: any }>(c, `SELECT public.integracao_previa(ARRAY[$1::uuid]) AS r`, [id])).r.produtos[0].assinatura;
  await c.query(`SELECT public.integracao_marcar(jsonb_build_array(jsonb_build_object('modelo_id', $1::uuid, 'assinatura', $2::text)))`, [id, a]);
}
async function chave(c: Client, nome = "ERP Teste"): Promise<{ id: string; chave: string; final: string }> {
  return (await um<{ r: any }>(c, `SELECT public.integracao_chave_criar($1) AS r`, [nome])).r;
}
async function ler(c: Client, k: string, o: { incluir?: boolean; cursor?: string | null; limite?: number | null; modo?: string; ip?: string } = {}): Promise<any> {
  return (await um<{ r: any }>(c, `SELECT public._integracao_ler($1, $2, $3, $4, $5, $6) AS r`,
    [sha(k), o.incluir ?? false, o.cursor ?? null, o.limite ?? null, o.modo ?? "normal", o.ip ?? "203.0.113.10"])).r;
}
async function confirmar(c: Client, r: any): Promise<any> {
  const entrega = { produtos: r.produtos.map((p: any) => ({ modelo_id: p.modelo_id, assinatura: p.assinatura })), fotos_descartadas: 0, fotos_ausentes: 0 };
  return (await um<{ r: any }>(c, `SELECT public._integracao_confirmar($1, $2, $3::jsonb) AS r`, [r.chave_id, r.acesso_id, JSON.stringify(entrega)])).r;
}
async function msg(c: Client, sql: string, params: unknown[]): Promise<string> {
  await c.query("SAVEPOINT m");
  try { await c.query(sql, params); await c.query("RELEASE SAVEPOINT m"); return "PASSOU"; }
  catch (e: any) { await c.query("ROLLBACK TO SAVEPOINT m"); return `${e.code} ${e.message}`; }
}

describe.skipIf(!hasDb || !LOCAL)("integracao — migration 6: configurações e chaves (SÓ super admin)", () => {
  it("campos: só super admin; ordem normalizada; rev (P0409 ASCII); desconhecido/vazio = P0001; log 'campos'", async () => {
    await withTx(async (c) => {
      await prepara(c, 6);
      await comoUsuarioCom(c, "00000000-0000-4000-8000-00000000ce31", [["integracao", true, true]], { tenantAdmin: true });
      expect(await msg(c, `SELECT public.integracao_salvar_config($1::text[], 1)`, [["nome"]])).toBe("42501 Só o super admin pode fazer isto.");
      await comoUsuario(c, U);
      const r = (await um<{ r: any }>(c, `SELECT public.integracao_salvar_config($1::text[], 1) AS r`, [["foto", "nome", "ref_sku"]])).r;
      expect(r.campos).toEqual(["nome", "ref_sku", "foto"]);
      expect(r.rev).toBe(2);
      expect(await msg(c, `SELECT public.integracao_salvar_config($1::text[], 1)`, [["nome"]])).toBe("P0409 conflito_versao: a configuracao foi salva por outra pessoa");
      expect(await msg(c, `SELECT public.integracao_salvar_config($1::text[], 2)`, [["xyz"]])).toMatch(/^P0001 /);
      expect(await msg(c, `SELECT public.integracao_salvar_config($1::text[], 2)`, [[]])).toMatch(/^P0001 /);
      const log = await um<{ d: any }>(c, `SELECT detalhe AS d FROM public.integracao_log WHERE tenant_id = $1 AND acao = 'campos' ORDER BY criado_em DESC LIMIT 1`, [T]);
      expect(log.d).toEqual({ antes: [...CAMPOS_PADRAO], depois: ["nome", "ref_sku", "foto"] });
    });
  });

  it("configurações da API: faixas (fora = P0001), log config_api antes/depois", async () => {
    await withTx(async (c) => {
      await prepara(c, 6);
      await comoUsuario(c, U);
      expect(await msg(c, `SELECT public.integracao_salvar_config_api('{"limite_por_minuto": 601}'::jsonb, 1)`, [])).toMatch(/^P0001 .*1–600/);
      const r = (await um<{ r: any }>(c, `SELECT public.integracao_salvar_config_api('{"limite_por_minuto": 300, "validade_foto_dias": 30}'::jsonb, 1) AS r`)).r;
      expect(r.api).toEqual({ limite_por_minuto: 300, max_por_pagina: 50, validade_foto_dias: 30, bloqueio_tentativas: 10 });
      const log = await um<{ d: any }>(c, `SELECT detalhe AS d FROM public.integracao_log WHERE tenant_id = $1 AND acao = 'config_api'`, [T]);
      expect(log.d.antes.limite_por_minuto).toBe(60);
      expect(log.d.depois.limite_por_minuto).toBe(300);
    });
  });

  it("chave: 'wish_live_' + 32, SÓ o SHA-256 guardado, log sem hash (N11/D32); revogar = chave passa a ser inválida", async () => {
    await withTx(async (c) => {
      await prepara(c, 6);
      await comoUsuario(c, U);
      const k = await chave(c, "ERP Principal");
      expect(k.chave).toMatch(/^wish_live_[A-Za-z0-9_-]{32}$/);
      expect(k.final).toBe(k.chave.slice(-4));
      const db = await um<{ hash: string; final: string }>(c, `SELECT hash, final FROM public.integracao_chaves WHERE id = $1`, [k.id]);
      expect(db).toEqual({ hash: sha(k.chave), final: k.final });
      const log = await um<{ d: any }>(c, `SELECT detalhe AS d FROM public.integracao_log WHERE acao = 'chave_criar' AND tenant_id = $1`, [T]);
      expect(log.d).toEqual({ nome: "ERP Principal", final: k.final });
      expect(JSON.stringify((await um<{ r: any }>(c, `SELECT public.integracao_chaves_listar() AS r`)).r)).not.toContain(db.hash);
      await c.query(`SELECT public.integracao_chave_revogar($1)`, [k.id]);
      expect((await ler(c, k.chave)).status).toBe("chave_invalida");
    });
  });
});

describe.skipIf(!hasDb || !LOCAL)("integracao — migration 6: as 2 fases da API", () => {
  it("ler → confirmar: entrega só integráveis, marca integrado (log 'integrado' com a chave); reler com incluir_integrados", async () => {
    await withTx(async (c) => {
      await prepara(c, 6);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await modeloInterno(c);
      await marcar(c, m.id);
      const k = await chave(c);
      const r1 = await ler(c, k.chave);
      expect(r1).toMatchObject({ status: "ok", modo: "normal", loja: { id: T }, proximo_cursor: null, validade_foto_dias: 7 });
      expect(r1.chaves_colunas).toEqual([...CAMPOS_PADRAO]);
      expect(r1.colunas[0]).toBe("Nome");
      const p = r1.produtos.find((x: any) => x.modelo_id === m.id);
      expect(p.linhas.map((l: any) => l.tipo)).toEqual(["produto", "variante", "variante"]);
      expect(p.linhas[0].valores).toHaveLength(17);
      expect(p.linhas[1].valores[1]).toBe(`${m.ref}-P`);
      expect((await um<{ s: string }>(c, `SELECT status AS s FROM public.integracao_acessos WHERE id = $1`, [r1.acesso_id])).s).toBe("reservado");
      const cf = await confirmar(c, r1);
      expect(cf.status).toBe("ok");
      expect(cf.confirmados.map((x: any) => x.modelo_id)).toContain(m.id);
      expect((await um<{ e: string }>(c, `SELECT estado AS e FROM public.integracao_produtos WHERE modelo_id = $1`, [m.id])).e).toBe("integrado");
      expect((await um<{ n: string }>(c, `SELECT count(*) AS n FROM public.integracao_linhas WHERE modelo_id = $1 AND integrado_em IS NULL`, [m.id])).n).toBe("0");
      const log = await um<{ quem: string }>(c, `SELECT quem FROM public.integracao_log WHERE modelo_id = $1 AND acao = 'integrado'`, [m.id]);
      expect(log.quem).toBe(`Chave "ERP Teste" ····${k.final}`);
      const acc = await um<{ s: string; n: number }>(c, `SELECT status AS s, produtos_entregues AS n FROM public.integracao_acessos WHERE id = $1`, [r1.acesso_id]);
      expect(acc.s).toBe("ok");
      expect(acc.n).toBeGreaterThanOrEqual(1);
      expect((await ler(c, k.chave)).produtos.find((x: any) => x.modelo_id === m.id)).toBeUndefined();
      const r3 = await ler(c, k.chave, { incluir: true });
      const p3 = r3.produtos.find((x: any) => x.modelo_id === m.id);
      expect(p3.estado).toBe("integrado");
      expect(p3.integrado_em).not.toBeNull();
    });
  });

  it("paginação por PRODUTO (nunca parte um produto) e max_por_pagina respeitado", async () => {
    await withTx(async (c) => {
      await prepara(c, 6);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      await c.query(`UPDATE public.integracao_produtos SET estado = 'nao_integravel' WHERE tenant_id = $1`, [T]); // isola a loja de teste
      for (let i = 0; i < 3; i++) await marcar(c, (await modeloInterno(c)).id);
      const k = await chave(c);
      const a = await ler(c, k.chave, { limite: 2 });
      expect(a.produtos).toHaveLength(2);
      expect(a.pagina).toEqual({ limite: 2, maximo: 50 }); // D39 (P-89 A): tamanho usado + máximo da loja hoje
      expect(a.proximo_cursor).toEqual(expect.any(String));
      for (const p of a.produtos) expect(p.linhas).toHaveLength(3);
      const b = await ler(c, k.chave, { limite: 2, cursor: a.proximo_cursor });
      expect(b.produtos).toHaveLength(1);
      expect(b.proximo_cursor).toBeNull();
      await c.query(`UPDATE public.integracao_config SET max_por_pagina = 1 WHERE tenant_id = $1`, [T]);
      const d = await ler(c, k.chave, { limite: 50 });
      expect(d.produtos).toHaveLength(1);
      expect(d.pagina).toEqual({ limite: 1, maximo: 1 }); // pedido 50, cortado no máximo da loja
      expect((await ler(c, k.chave, { cursor: "%%%" })).status).toBe("parametro_invalido");
    });
  });

  it("limite POR CHAVE: N consultas em 60 s passam, a N+1 = limite_excedido (retry_after); o 429 não conta (V4/R7)", async () => {
    await withTx(async (c) => {
      await prepara(c, 6);
      await comoUsuario(c, U);
      await c.query(`UPDATE public.integracao_config SET limite_por_minuto = 3 WHERE tenant_id = $1`, [T]);
      const k = await chave(c);
      for (let i = 0; i < 3; i++) expect((await ler(c, k.chave)).status).toBe("ok");
      const x = await ler(c, k.chave);
      expect(x.status).toBe("limite_excedido");
      expect(x.retry_after).toBeGreaterThan(0);
      expect((await ler(c, k.chave)).status).toBe("limite_excedido");
      const n = await um<{ a: string; g: string }>(c,
        `SELECT count(*) FILTER (WHERE agregado IS NULL) AS a, max(tentativas) FILTER (WHERE agregado IS NOT NULL) AS g
           FROM public.integracao_acessos WHERE chave_id = $1`, [k.id]);
      expect(n).toEqual({ a: "3", g: 2 });
    });
  });

  it("chave errada agrega por IP/minuto e BLOQUEIA chaves ERRADAS desse IP após N (D18/D19); a chave VÁLIDA do mesmo IP segue ok", async () => {
    await withTx(async (c) => {
      await prepara(c, 6);
      await comoUsuario(c, U);
      await c.query(`UPDATE public.integracao_config SET bloqueio_tentativas = 3 WHERE tenant_id = $1`, [T]);
      const k = await chave(c);
      for (let i = 0; i < 3; i++) expect((await ler(c, `errada${i}`, { ip: "198.51.100.7" })).status).toBe("chave_invalida");
      const agg = await um<{ n: string; t: number }>(c,
        `SELECT count(*) AS n, max(tentativas) AS t FROM public.integracao_acessos WHERE agregado = 'inv:198.51.100.7'`);
      expect(agg).toEqual({ n: "1", t: 3 });
      const b = await ler(c, "errada9", { ip: "198.51.100.7" });
      expect(b.status).toBe("ip_bloqueado");
      expect(b.retry_after).toBeGreaterThan(0);
      expect((await ler(c, k.chave, { ip: "198.51.100.7" })).status).toBe("ok"); // D18: chave válida não é bloqueada por IP
      expect((await ler(c, "errada10", { ip: "198.51.100.8" })).status).toBe("chave_invalida");
    });
  });

  it("modo teste (P-82 A): só EXEMPLOS (nenhum modelo real), 2 páginas, registrado como teste e conta no limite; nada vira integrado", async () => {
    await withTx(async (c) => {
      await prepara(c, 6);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      await c.query(`UPDATE public.integracao_config SET campos = $2::text[] WHERE tenant_id = $1`, [T, LAYOUT]);
      const m = await modeloInterno(c);
      await marcar(c, m.id);
      const k = await chave(c);
      const t1 = await ler(c, k.chave, { modo: "teste" });
      expect(t1.modo).toBe("teste");
      expect(t1.pagina).toEqual({ limite: 2, maximo: 50 }); // D39: no teste, páginas de exemplo de 2
      expect(t1.produtos.map((p: any) => p.modelo_id)).toEqual(["exemplo-0001", "exemplo-0002"]);
      expect(JSON.stringify(t1)).not.toContain(m.id);
      expect(t1.produtos[0].linhas[0].valores.at(-1)).toEqual(["exemplo"]);
      expect(t1.produtos[0].linhas[1].valores.at(-1)).toEqual([]);
      const t2 = await ler(c, k.chave, { modo: "teste", cursor: t1.proximo_cursor });
      expect(t2.produtos.map((p: any) => p.modelo_id)).toEqual(["exemplo-0003", "exemplo-0004"]);
      expect(t2.proximo_cursor).toBeNull();
      expect((await um<{ s: string }>(c, `SELECT status AS s FROM public.integracao_acessos WHERE id = $1`, [t1.acesso_id])).s).toBe("teste");
      const ac = (await um<{ r: any[] }>(c, `SELECT public.integracao_acessos_listar(10) AS r`)).r;
      expect(ac.find((a) => a.id === t1.acesso_id)).toMatchObject({ status: "teste", modo: "teste", exemplos: 2, chave: "ERP Teste" });
      expect((await um<{ e: string }>(c, `SELECT estado AS e FROM public.integracao_produtos WHERE modelo_id = $1`, [m.id])).e).toBe("integravel");
      expect((await um<{ r: any }>(c, `SELECT public.integracao_exemplo() AS r`)).r.produtos[0].modelo_id).toBe("exemplo-0001");
      const antes = (await um<{ n: string }>(c, `SELECT count(*) AS n FROM public.integracao_acessos WHERE chave_id = $1`, [k.id])).n;
      await c.query(`SELECT public.integracao_exemplo()`);
      expect((await um<{ n: string }>(c, `SELECT count(*) AS n FROM public.integracao_acessos WHERE chave_id = $1`, [k.id])).n).toBe(antes);
    });
  });

  it("corrida voltar × entregar (§9): se o voltar vence, o confirmar NÃO marca; loja inativa = loja_inativa nas 2 fases", async () => {
    await withTx(async (c) => {
      await prepara(c, 6);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await modeloInterno(c);
      await marcar(c, m.id);
      const k = await chave(c);
      const r = await ler(c, k.chave);
      await c.query(`SELECT public.integracao_voltar(ARRAY[$1::uuid])`, [m.id]);
      const cf = await confirmar(c, r);
      expect(cf.confirmados.map((x: any) => x.modelo_id)).not.toContain(m.id);
      expect((await um<{ e: string }>(c, `SELECT estado AS e FROM public.integracao_produtos WHERE modelo_id = $1`, [m.id])).e).toBe("nao_integravel");
      await c.query(`UPDATE public.tenants SET ativo = false WHERE id = $1`, [T]);
      expect((await ler(c, k.chave)).status).toBe("loja_inativa");
      expect((await confirmar(c, r)).status).toBe("loja_inativa");
    });
  });

  it("limpeza de 90 dias: só da loja pedida, só quem NÃO entregou (acessos que entregaram são permanentes — P-64 A)", async () => {
    await withTx(async (c) => {
      await prepara(c, 6);
      await c.query(`INSERT INTO public.integracao_acessos (tenant_id, ip, status, criado_em, produtos_entregues)
                     VALUES ($1, 'x', 'ok', now() - interval '100 days', 0), ($1, 'x', 'ok', now() - interval '100 days', 5),
                            ($1, 'x', 'ok', now() - interval '10 days', 0)`, [T]);
      expect((await um<{ n: number }>(c, `SELECT public._integracao_limpar($1) AS n`, [T])).n).toBe(1);
      expect((await um<{ n: string }>(c, `SELECT count(*) AS n FROM public.integracao_acessos WHERE tenant_id = $1 AND ip = 'x'`, [T])).n).toBe("2");
    });
  });

  it("ACL: as 3 da rota só p/ service_role; acessos/chaves/exemplo recusam não-super", async () => {
    await withTx(async (c) => {
      await prepara(c, 6);
      for (const f of ["_integracao_ler(text,boolean,text,integer,text,text)", "_integracao_confirmar(uuid,uuid,jsonb)", "_integracao_limpar(uuid)"]) {
        const a = await um<any>(c, `SELECT has_function_privilege('service_role', 'public.${f}', 'EXECUTE') AS s,
          has_function_privilege('authenticated', 'public.${f}', 'EXECUTE') AS au, has_function_privilege('anon', 'public.${f}', 'EXECUTE') AS an,
          has_function_privilege('public', 'public.${f}', 'EXECUTE') AS p`);
        expect(a, f).toEqual({ s: true, au: false, an: false, p: false });
      }
      await comoUsuarioCom(c, "00000000-0000-4000-8000-00000000ce32", [["integracao", true, true]], { tenantAdmin: true });
      for (const sql of ["SELECT public.integracao_acessos_listar(10)", "SELECT public.integracao_chaves_listar()", "SELECT public.integracao_exemplo()",
        "SELECT public.integracao_chave_criar('x')"]) {
        expect(await msg(c, sql, [])).toBe("42501 Só o super admin pode fazer isto.");
      }
    });
  });

  it.skipIf(!MIG_TXN)("inverso 6 desfaz a 6 (13 funções somem)", async () => {
    await withTx(async (c) => {
      await prepara(c, 6);
      await aplica(c, INVERSOS[5]);
      const r = await um<{ n: string }>(c, `SELECT count(*) AS n FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN (
        'integracao_salvar_config','integracao_salvar_config_api','integracao_chaves_listar','integracao_chave_criar','integracao_chave_revogar',
        'integracao_acessos_listar','integracao_exemplo','_integracao_exemplo','_integracao_colunas','_integracao_valores','_integracao_ler',
        '_integracao_confirmar','_integracao_limpar')`);
      expect(r.n).toBe("0");
    });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar (N3)**

```bash
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres
INTEG_DONO_AVISADO=sim bash .superpowers/integracao/n3.sh antes t6
INTEGRACAO_MIG_TXN=1 npx vitest run --no-file-parallelism tests/integration/integracao-6-api.test.ts
bash .superpowers/integracao/n3.sh depois t6
```
Expected: FAIL — `ENOENT … 20261007150000_integracao_6_api.sql`.

- [ ] **Step 3: Escrever a migration 6 — `supabase/migrations/20261007150000_integracao_6_api.sql`**

```sql
-- Integração + API — 6/6: CONFIGURAÇÕES, CHAVES, ACESSOS e as 2 FASES DA API (spec §5, §7; P-64 A, P-66 A, P-67 A,
-- P-69 A, P-81 A, P-82 A; R7, R11, V4, n3, n4, N11, N12). Só funções.
-- Super admin (v4 — "campos API e chaves e acessos, somente super admin"; substitui a P-66 A nesse ponto): salvar campos
-- (rev + log 'campos'), salvar config da API (faixas; log 'config_api'), chaves (SHA-256; a chave aparece 1× — D17),
-- acessos, "Ver resposta de exemplo" (N12: não registra acesso nem conta no limite).
-- Rota da API (SÓ service_role): _integracao_ler (transação 1: chave por HASH, loja ativa, bloqueio por IP (D18), limite
-- por chave sob pg_advisory_xact_lock + RESERVA do acesso (V4), página por PRODUTO com cursor (D21), colunas = união
-- dos retratos (D6), modo teste = só exemplos (P-82 A)); _integracao_confirmar (transação 2: reconfere chave/loja,
-- FOR UPDATE, marca integrado SÓ o que ainda está integrável com a MESMA assinatura, log 'integrado' com a chave);
-- _integracao_limpar (≤ 500 linhas de 90+ dias da loja, só quem não entregou — n4/D20). Chave errada NUNCA dá RAISE
-- (nota 9): devolve status e registra AGREGADO por IP/minuto (D19).
-- Contagens: +13 funções | +0 gatilhos. Inverso: supabase/rollback/20261007150000_integracao_6_api_down.sql.
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '3s';

DO $guarda$
BEGIN
  IF to_regprocedure('public.integracao_salvar(jsonb,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'integracao_6: aplique a migration 5 antes' USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

CREATE OR REPLACE FUNCTION public._integracao_colunas(_campos text[])
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'chaves', coalesce(jsonb_agg(u.x ORDER BY u.n), '[]'::jsonb),
    'rotulos', coalesce(jsonb_agg(public._integracao_rotulos() ->> u.x ORDER BY u.n), '[]'::jsonb))
    FROM unnest(public._integracao_layout()) WITH ORDINALITY AS u(x, n)
   WHERE u.x = ANY(coalesce(_campos, '{}'::text[]))
$function$;

CREATE OR REPLACE FUNCTION public._integracao_exemplo(_campos text[], _pagina integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_campos text[] := ARRAY(SELECT u.x FROM unnest(public._integracao_layout()) WITH ORDINALITY AS u(x, n)
                            WHERE u.x = ANY(coalesce(_campos, '{}'::text[])) ORDER BY u.n);
  v_pag integer := least(greatest(coalesce(_pagina, 1), 1), 2);
  v_out jsonb := '[]'::jsonb;
  v_i integer;
  v_ref text;
  v_nome text;
  v_desc text;
  v_base jsonb;
  v_linha jsonb;
  v_linhas jsonb;
  v_tam text;
BEGIN
  -- P-82 A: produtos FICTÍCIOS no formato real (mesmas colunas marcadas da loja), 2 por página, 2 páginas. NUNCA lê produto.
  FOR v_i IN ((v_pag - 1) * 2 + 1)..((v_pag - 1) * 2 + 2) LOOP
    v_ref := 'EXPL' || lpad(v_i::text, 4, '0');
    v_nome := 'Produto Exemplo ' || v_i;
    v_desc := 'Descrição de exemplo do produto ' || v_i || '.';
    v_base := jsonb_build_object('nome', v_nome, 'ref_sku', v_ref, 'preco_anterior', '109.90', 'preco_venda', '99.90',
      'peso', '0.300', 'ncm', '6109.10.00', 'preco_custo', '42.00', 'cor_base', NULL, 'cor_apelido', NULL, 'tamanho', NULL,
      'titulo', v_nome || ' - exemplo', 'descricao', v_desc, 'keywords', 'exemplo, teste', 'metatag', v_desc,
      'comprimento', '60', 'largura', '40', 'altura', '2');
    v_linhas := jsonb_build_array(jsonb_build_object('tipo', 'produto', 'valores',
      (SELECT coalesce(jsonb_agg(CASE WHEN u.x = 'foto' THEN '["exemplo"]'::jsonb ELSE coalesce(v_base -> u.x, 'null'::jsonb) END
                                 ORDER BY u.n), '[]'::jsonb)
         FROM unnest(v_campos) WITH ORDINALITY AS u(x, n))));
    FOREACH v_tam IN ARRAY ARRAY['P', 'M'] LOOP
      v_linha := v_base || jsonb_build_object('nome', v_nome || ' ' || v_tam, 'ref_sku', v_ref || '-COR-' || v_tam,
        'cor_base', 'Cor Exemplo', 'cor_apelido', 'Apelido Exemplo', 'tamanho', v_tam);
      v_linhas := v_linhas || jsonb_build_array(jsonb_build_object('tipo', 'variante', 'valores',
        (SELECT coalesce(jsonb_agg(CASE WHEN u.x = 'foto' THEN '[]'::jsonb ELSE coalesce(v_linha -> u.x, 'null'::jsonb) END
                                   ORDER BY u.n), '[]'::jsonb)
           FROM unnest(v_campos) WITH ORDINALITY AS u(x, n))));
    END LOOP;
    v_out := v_out || jsonb_build_array(jsonb_build_object('modelo_id', 'exemplo-' || lpad(v_i::text, 4, '0'),
      'estado', 'teste', 'assinatura', NULL, 'integrado_em', NULL, 'linhas', v_linhas));
  END LOOP;
  RETURN jsonb_build_object('produtos', v_out, 'proximo_cursor',
    CASE WHEN v_pag = 1 THEN to_jsonb(encode(convert_to('{"exemplo": 2}', 'UTF8'), 'base64')) ELSE 'null'::jsonb END);
END
$function$;

CREATE OR REPLACE FUNCTION public._integracao_valores(_l public.integracao_linhas, _chaves text[], _campos_produto text[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- valores na ordem de _chaves; campo fora do retrato DESTE produto = null (D6); foto = lista de caminhos (D5)
  SELECT coalesce(jsonb_agg(CASE WHEN NOT (u.k = ANY(coalesce(_campos_produto, '{}'::text[]))) THEN 'null'::jsonb
    ELSE coalesce(CASE u.k
      WHEN 'nome' THEN to_jsonb(_l.nome) WHEN 'ref_sku' THEN to_jsonb(_l.ref_sku)
      WHEN 'preco_anterior' THEN to_jsonb(_l.preco_anterior) WHEN 'preco_venda' THEN to_jsonb(_l.preco_venda)
      WHEN 'peso' THEN to_jsonb(_l.peso) WHEN 'ncm' THEN to_jsonb(_l.ncm) WHEN 'preco_custo' THEN to_jsonb(_l.preco_custo)
      WHEN 'cor_base' THEN to_jsonb(_l.cor_base) WHEN 'cor_apelido' THEN to_jsonb(_l.cor_apelido)
      WHEN 'tamanho' THEN to_jsonb(_l.tamanho) WHEN 'titulo' THEN to_jsonb(_l.titulo)
      WHEN 'descricao' THEN to_jsonb(_l.descricao) WHEN 'keywords' THEN to_jsonb(_l.keywords)
      WHEN 'metatag' THEN to_jsonb(_l.metatag) WHEN 'comprimento' THEN to_jsonb(_l.comprimento)
      WHEN 'largura' THEN to_jsonb(_l.largura) WHEN 'altura' THEN to_jsonb(_l.altura)
      WHEN 'foto' THEN to_jsonb(coalesce(_l.fotos, '{}'::text[]))
    END, 'null'::jsonb) END ORDER BY u.n), '[]'::jsonb)
    FROM unnest(_chaves) WITH ORDINALITY AS u(k, n)
$function$;

CREATE OR REPLACE FUNCTION public.integracao_salvar_config(_campos text[], _rev integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public._integracao_exige_super();
  v_cfg public.integracao_config;
  v_novos text[];
BEGIN
  IF EXISTS (SELECT 1 FROM unnest(coalesce(_campos, '{}'::text[])) AS k(x) WHERE k.x <> ALL(public._integracao_layout())) THEN
    RAISE EXCEPTION 'Campo desconhecido na seleção.' USING ERRCODE = 'P0001';
  END IF;
  v_novos := ARRAY(SELECT u.x FROM unnest(public._integracao_layout()) WITH ORDINALITY AS u(x, n)
                    WHERE u.x = ANY(coalesce(_campos, '{}'::text[])) ORDER BY u.n);
  IF cardinality(v_novos) = 0 THEN
    RAISE EXCEPTION 'Marque pelo menos um campo.' USING ERRCODE = 'P0001';
  END IF;
  PERFORM 1 FROM public.integracao_config c WHERE c.tenant_id = v_tenant FOR UPDATE;
  v_cfg := public._integracao_cfg(v_tenant);
  IF v_cfg.rev IS DISTINCT FROM _rev THEN
    RAISE EXCEPTION 'conflito_versao: a configuracao foi salva por outra pessoa' USING ERRCODE = 'P0409';
  END IF;
  INSERT INTO public.integracao_config AS c (tenant_id, campos, rev, atualizado_por, atualizado_em)
  VALUES (v_tenant, v_novos, 1, auth.uid(), now())
  ON CONFLICT (tenant_id) DO UPDATE SET campos = excluded.campos, rev = c.rev + 1,
                                        atualizado_por = excluded.atualizado_por, atualizado_em = now();
  PERFORM public._integracao_logar(v_tenant, 'campos', NULL,
    jsonb_build_object('antes', to_jsonb(v_cfg.campos), 'depois', to_jsonb(v_novos)), NULL);
  RETURN public.integracao_config_ler();
END
$function$;

CREATE OR REPLACE FUNCTION public.integracao_salvar_config_api(_valores jsonb, _rev integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public._integracao_exige_super();
  v_cfg public.integracao_config;
  v_v jsonb := coalesce(_valores, '{}'::jsonb);
  v_lim integer;
  v_pag integer;
  v_foto integer;
  v_blq integer;
BEGIN
  PERFORM 1 FROM public.integracao_config c WHERE c.tenant_id = v_tenant FOR UPDATE;
  v_cfg := public._integracao_cfg(v_tenant);
  IF v_cfg.rev IS DISTINCT FROM _rev THEN
    RAISE EXCEPTION 'conflito_versao: a configuracao foi salva por outra pessoa' USING ERRCODE = 'P0409';
  END IF;
  v_lim := coalesce((v_v ->> 'limite_por_minuto')::integer, v_cfg.limite_por_minuto);
  v_pag := coalesce((v_v ->> 'max_por_pagina')::integer, v_cfg.max_por_pagina);
  v_foto := coalesce((v_v ->> 'validade_foto_dias')::integer, v_cfg.validade_foto_dias);
  v_blq := coalesce((v_v ->> 'bloqueio_tentativas')::integer, v_cfg.bloqueio_tentativas);
  -- faixa = recusa; fora do RECOMENDADO a tela alerta antes e o servidor aceita (v4)
  IF v_lim NOT BETWEEN 1 AND 600 THEN
    RAISE EXCEPTION 'Limite de consultas por minuto fora da faixa permitida (1–600).' USING ERRCODE = 'P0001';
  END IF;
  IF v_pag NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Máximo de produtos por página fora da faixa permitida (1–500).' USING ERRCODE = 'P0001';
  END IF;
  IF v_foto NOT BETWEEN 1 AND 30 THEN
    RAISE EXCEPTION 'Validade dos links das fotos fora da faixa permitida (1–30 dias).' USING ERRCODE = 'P0001';
  END IF;
  IF v_blq NOT BETWEEN 3 AND 100 THEN
    RAISE EXCEPTION 'Bloqueio de IP fora da faixa permitida (3–100 tentativas).' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.integracao_config AS c (tenant_id, limite_por_minuto, max_por_pagina, validade_foto_dias,
                                             bloqueio_tentativas, rev, atualizado_por, atualizado_em)
  VALUES (v_tenant, v_lim, v_pag, v_foto, v_blq, 1, auth.uid(), now())
  ON CONFLICT (tenant_id) DO UPDATE SET limite_por_minuto = excluded.limite_por_minuto, max_por_pagina = excluded.max_por_pagina,
    validade_foto_dias = excluded.validade_foto_dias, bloqueio_tentativas = excluded.bloqueio_tentativas, rev = c.rev + 1,
    atualizado_por = excluded.atualizado_por, atualizado_em = now();
  PERFORM public._integracao_logar(v_tenant, 'config_api', NULL, jsonb_build_object(
    'antes', jsonb_build_object('limite_por_minuto', v_cfg.limite_por_minuto, 'max_por_pagina', v_cfg.max_por_pagina,
                                'validade_foto_dias', v_cfg.validade_foto_dias, 'bloqueio_tentativas', v_cfg.bloqueio_tentativas),
    'depois', jsonb_build_object('limite_por_minuto', v_lim, 'max_por_pagina', v_pag, 'validade_foto_dias', v_foto,
                                 'bloqueio_tentativas', v_blq)), NULL);
  RETURN public.integracao_config_ler();
END
$function$;

CREATE OR REPLACE FUNCTION public.integracao_chaves_listar()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public._integracao_exige_super();
BEGIN
  -- N11/D32: nunca devolve o hash
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object('id', k.id, 'nome', k.nome, 'final', k.final,
             'criada_por', coalesce((SELECT coalesce(nullif(btrim(u.nome::text), ''), u.email::text) FROM public.users u WHERE u.id = k.criada_por), '—'),
             'criada_em', k.criada_em, 'revogada_em', k.revogada_em, 'ultimo_uso_em', k.ultimo_uso_em)
             ORDER BY (k.revogada_em IS NOT NULL), k.criada_em DESC)
      FROM public.integracao_chaves k
     WHERE k.tenant_id = v_tenant), '[]'::jsonb);
END
$function$;

CREATE OR REPLACE FUNCTION public.integracao_chave_criar(_nome text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public._integracao_exige_super();
  v_nome text := btrim(coalesce(_nome, ''));
  v_chave text;
  v_final text;
  v_id uuid;
BEGIN
  IF length(v_nome) < 1 OR length(v_nome) > 60 THEN
    RAISE EXCEPTION 'Dê um nome à chave (até 60 caracteres).' USING ERRCODE = 'P0001';
  END IF;
  -- D17: 24 bytes aleatórios em base64url = 32 caracteres; só o SHA-256 é guardado
  v_chave := 'wish_live_' || translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_');
  v_final := right(v_chave, 4);
  INSERT INTO public.integracao_chaves (tenant_id, nome, hash, final, criada_por)
  VALUES (v_tenant, v_nome, encode(extensions.digest(v_chave, 'sha256'), 'hex'), v_final, auth.uid())
  RETURNING id INTO v_id;
  PERFORM public._integracao_logar(v_tenant, 'chave_criar', NULL, jsonb_build_object('nome', v_nome, 'final', v_final), NULL);
  RETURN jsonb_build_object('id', v_id, 'nome', v_nome, 'chave', v_chave, 'final', v_final);
END
$function$;

CREATE OR REPLACE FUNCTION public.integracao_chave_revogar(_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public._integracao_exige_super();
  v_nome text;
  v_final text;
BEGIN
  UPDATE public.integracao_chaves SET revogada_em = now(), revogada_por = auth.uid()
   WHERE id = _id AND tenant_id = v_tenant AND revogada_em IS NULL
  RETURNING nome, final INTO v_nome, v_final;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Chave não encontrada ou já revogada.' USING ERRCODE = 'P0001';
  END IF;
  PERFORM public._integracao_logar(v_tenant, 'chave_revogar', NULL, jsonb_build_object('nome', v_nome, 'final', v_final), NULL);
  RETURN jsonb_build_object('ok', true);
END
$function$;

CREATE OR REPLACE FUNCTION public.integracao_acessos_listar(_limite integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public._integracao_exige_super();
  v_lim integer := least(greatest(coalesce(_limite, 50), 1), 200);
BEGIN
  RETURN coalesce((
    SELECT jsonb_agg(s.x ORDER BY s.q DESC)
      FROM (SELECT jsonb_build_object('id', a.id, 'chave', k.nome, 'final', k.final,
                     'ip', CASE WHEN a.status IN ('chave_invalida', 'ip_bloqueado') THEN a.ip END,
                     'modo', a.modo, 'status', a.status, 'tentativas', a.tentativas, 'produtos', a.produtos_entregues,
                     'exemplos', (a.detalhe ->> 'exemplos')::integer,
                     'linhas', a.linhas, 'quando', coalesce(a.minuto, a.criado_em)) AS x,
                   coalesce(a.minuto, a.criado_em) AS q
              FROM public.integracao_acessos a
              LEFT JOIN public.integracao_chaves k ON k.id = a.chave_id
             WHERE a.tenant_id = v_tenant OR (a.tenant_id IS NULL AND a.status IN ('chave_invalida', 'ip_bloqueado'))
             ORDER BY coalesce(a.minuto, a.criado_em) DESC
             LIMIT v_lim) s), '[]'::jsonb);
END
$function$;

CREATE OR REPLACE FUNCTION public.integracao_exemplo()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public._integracao_exige_super();
  v_cfg public.integracao_config;
  v_ex jsonb;
  v_cols jsonb;
BEGIN
  -- N12: SÓ super admin, da loja atual, NÃO registra acesso e NÃO conta no limite; a tela mostra a foto como null
  v_cfg := public._integracao_cfg(v_tenant);
  v_ex := public._integracao_exemplo(v_cfg.campos, 1);
  v_cols := public._integracao_colunas(v_cfg.campos);
  RETURN jsonb_build_object('status', 'ok', 'modo', 'teste', 'tenant_id', v_tenant,
    'loja', jsonb_build_object('id', v_tenant, 'nome', (SELECT t.nome FROM public.tenants t WHERE t.id = v_tenant)),
    'colunas', v_cols -> 'rotulos', 'chaves_colunas', v_cols -> 'chaves', 'produtos', v_ex -> 'produtos',
    'proximo_cursor', v_ex -> 'proximo_cursor', 'validade_foto_dias', v_cfg.validade_foto_dias,
    'pagina', jsonb_build_object('limite', 2, 'maximo', v_cfg.max_por_pagina));
END
$function$;

CREATE OR REPLACE FUNCTION public._integracao_ler(_chave_hash text, _incluir_integrados boolean, _cursor text,
  _limite integer, _modo text, _ip text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ip text := left(coalesce(nullif(btrim(coalesce(_ip, '')), ''), 'desconhecido'), 64);
  v_min timestamptz := date_trunc('minute', now());
  k public.integracao_chaves%ROWTYPE;
  v_achou boolean;
  v_cfg public.integracao_config;
  v_ativo boolean;
  v_loja text;
  v_limiar integer;
  v_erradas integer;
  v_usadas integer;
  v_mais_velho timestamptz;
  v_retry integer;
  v_acesso uuid;
  v_cur jsonb := '{}'::jsonb;
  v_depois uuid;
  v_pag integer;
  v_lim integer;
  v_sel jsonb;
  v_mais boolean;
  v_campos text[];
  v_cols jsonb;
  v_prods jsonb := '[]'::jsonb;
  v_ex jsonb;
  v_linhas integer;
  r record;
BEGIN
  IF _modo IS NULL OR _modo NOT IN ('normal', 'teste') THEN
    RETURN jsonb_build_object('status', 'parametro_invalido');
  END IF;
  IF nullif(btrim(coalesce(_cursor, '')), '') IS NOT NULL THEN
    BEGIN
      v_cur := convert_from(decode(_cursor, 'base64'), 'UTF8')::jsonb;
      v_depois := (v_cur ->> 'depois')::uuid;
      v_pag := (v_cur ->> 'exemplo')::integer;
    EXCEPTION WHEN others THEN
      RETURN jsonb_build_object('status', 'parametro_invalido');
    END;
  END IF;
  SELECT * INTO k FROM public.integracao_chaves WHERE hash = lower(coalesce(_chave_hash, '')) AND revogada_em IS NULL;
  v_achou := FOUND;
  -- D18 (revisto no G-plano do plano): o bloqueio por IP vale SÓ para chave ERRADA/revogada — a chave válida nunca é bloqueada
  -- por IP (192 bits: força bruta inviável; um IP compartilhado não derruba o ERP de outra loja). Limiar = o MENOR
  -- bloqueio_tentativas entre as lojas (padrão 10), porque a loja de uma chave errada é desconhecida.
  IF NOT v_achou THEN
    SELECT coalesce(min(c.bloqueio_tentativas), 10) INTO v_limiar FROM public.integracao_config c;
    SELECT coalesce(sum(a.tentativas), 0), min(a.minuto) INTO v_erradas, v_mais_velho FROM public.integracao_acessos a
     WHERE a.agregado = 'inv:' || v_ip AND a.minuto > now() - interval '10 minutes';
    IF v_erradas >= v_limiar THEN
      INSERT INTO public.integracao_acessos AS a (tenant_id, chave_id, ip, modo, status, agregado, minuto, tentativas)
      VALUES (NULL, NULL, v_ip, _modo, 'ip_bloqueado', 'blq:' || v_ip, v_min, 1)
      ON CONFLICT (agregado, minuto) WHERE agregado IS NOT NULL DO UPDATE SET tentativas = a.tentativas + 1;
      v_retry := greatest(1, ceil(extract(epoch FROM (v_mais_velho + interval '10 minutes' - now())))::integer);
      RETURN jsonb_build_object('status', 'ip_bloqueado', 'retry_after', v_retry);
    END IF;
  END IF;
  IF NOT v_achou THEN
    -- nota 9: NUNCA RAISE aqui — o registro agregado tem de ficar (D19)
    INSERT INTO public.integracao_acessos AS a (tenant_id, chave_id, ip, modo, status, agregado, minuto, tentativas)
    VALUES (NULL, NULL, v_ip, _modo, 'chave_invalida', 'inv:' || v_ip, v_min, 1)
    ON CONFLICT (agregado, minuto) WHERE agregado IS NOT NULL DO UPDATE SET tentativas = a.tentativas + 1;
    RETURN jsonb_build_object('status', 'chave_invalida');
  END IF;
  v_cfg := public._integracao_cfg(k.tenant_id);
  SELECT t.ativo, t.nome INTO v_ativo, v_loja FROM public.tenants t WHERE t.id = k.tenant_id;
  IF NOT coalesce(v_ativo, false) THEN
    INSERT INTO public.integracao_acessos AS a (tenant_id, chave_id, ip, modo, status, agregado, minuto, tentativas)
    VALUES (k.tenant_id, k.id, v_ip, _modo, 'loja_inativa', 'ina:' || k.id::text, v_min, 1)
    ON CONFLICT (agregado, minuto) WHERE agregado IS NOT NULL DO UPDATE SET tentativas = a.tentativas + 1;
    RETURN jsonb_build_object('status', 'loja_inativa', 'tenant_id', k.tenant_id);
  END IF;
  -- R7/V4: limite POR CHAVE contado e RESERVADO sob a trava da chave (rajada paralela não fura); 429 não conta
  PERFORM pg_advisory_xact_lock(hashtext('integracao_chave:' || k.id::text));
  SELECT count(*), min(a.criado_em) INTO v_usadas, v_mais_velho FROM public.integracao_acessos a
   WHERE a.chave_id = k.id AND a.agregado IS NULL AND a.criado_em > now() - interval '60 seconds';
  IF v_usadas >= v_cfg.limite_por_minuto THEN
    INSERT INTO public.integracao_acessos AS a (tenant_id, chave_id, ip, modo, status, agregado, minuto, tentativas)
    VALUES (k.tenant_id, k.id, v_ip, _modo, 'limite_excedido', 'lim:' || k.id::text, v_min, 1)
    ON CONFLICT (agregado, minuto) WHERE agregado IS NOT NULL DO UPDATE SET tentativas = a.tentativas + 1;
    v_retry := greatest(1, ceil(extract(epoch FROM (v_mais_velho + interval '60 seconds' - now())))::integer);
    RETURN jsonb_build_object('status', 'limite_excedido', 'retry_after', v_retry, 'tenant_id', k.tenant_id);
  END IF;
  INSERT INTO public.integracao_acessos (tenant_id, chave_id, ip, modo, status)
  VALUES (k.tenant_id, k.id, v_ip, _modo, 'reservado') RETURNING id INTO v_acesso;
  UPDATE public.integracao_chaves SET ultimo_uso_em = now() WHERE id = k.id;

  IF _modo = 'teste' THEN
    -- P-82 A: só EXEMPLOS; não chama _integracao_confirmar; registrado como teste e contou no limite
    v_ex := public._integracao_exemplo(v_cfg.campos, coalesce(v_pag, 1));
    v_cols := public._integracao_colunas(v_cfg.campos);
    SELECT coalesce(sum(jsonb_array_length(p.x -> 'linhas')), 0) INTO v_linhas FROM jsonb_array_elements(v_ex -> 'produtos') AS p(x);
    UPDATE public.integracao_acessos
       SET status = 'teste', linhas = v_linhas, detalhe = jsonb_build_object('exemplos', jsonb_array_length(v_ex -> 'produtos')),
           concluido_em = now()
     WHERE id = v_acesso;
    RETURN jsonb_build_object('status', 'ok', 'modo', 'teste', 'acesso_id', v_acesso, 'chave_id', k.id, 'tenant_id', k.tenant_id,
      'loja', jsonb_build_object('id', k.tenant_id, 'nome', v_loja), 'colunas', v_cols -> 'rotulos',
      'chaves_colunas', v_cols -> 'chaves', 'produtos', v_ex -> 'produtos', 'proximo_cursor', v_ex -> 'proximo_cursor',
      'validade_foto_dias', v_cfg.validade_foto_dias,
      -- D39 (P-89 A): tamanho desta página (exemplo = 2 por página) + o máximo da loja HOJE
      'pagina', jsonb_build_object('limite', 2, 'maximo', v_cfg.max_por_pagina));
  END IF;

  -- D21: página por PRODUTO (um produto nunca é partido), keyset por integracao_produtos.id
  v_lim := least(greatest(coalesce(_limite, v_cfg.max_por_pagina), 1), v_cfg.max_por_pagina);
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'modelo_id', s.modelo_id, 'estado', s.estado,
                                               'assinatura', s.assinatura, 'integrado_em', s.integrado_em,
                                               'campos', to_jsonb(s.campos)) ORDER BY s.id), '[]'::jsonb)
    INTO v_sel
    FROM (SELECT ip.* FROM public.integracao_produtos ip
           WHERE ip.tenant_id = k.tenant_id
             AND (ip.estado = 'integravel' OR (coalesce(_incluir_integrados, false) AND ip.estado = 'integrado'))
             AND (v_depois IS NULL OR ip.id > v_depois)
           ORDER BY ip.id
           LIMIT v_lim + 1) s;
  v_mais := jsonb_array_length(v_sel) > v_lim;
  IF v_mais THEN
    v_sel := v_sel - v_lim;
  END IF;
  -- D6: colunas = UNIÃO dos campos dos retratos da página, na ordem fixa
  v_campos := ARRAY(SELECT u.x FROM unnest(public._integracao_layout()) WITH ORDINALITY AS u(x, n)
                     WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(v_sel) AS p(x) WHERE (p.x -> 'campos') ? u.x)
                     ORDER BY u.n);
  v_cols := public._integracao_colunas(v_campos);
  FOR r IN SELECT p.x AS p FROM jsonb_array_elements(v_sel) AS p(x) LOOP
    v_prods := v_prods || jsonb_build_array(jsonb_build_object(
      'modelo_id', r.p ->> 'modelo_id', 'estado', r.p ->> 'estado', 'assinatura', r.p ->> 'assinatura',
      'integrado_em', r.p -> 'integrado_em',
      'linhas', coalesce((
        SELECT jsonb_agg(jsonb_build_object('tipo', l.tipo, 'loja_nome', l.loja_nome,
                 'valores', public._integracao_valores(l, v_campos,
                   ARRAY(SELECT c.x FROM jsonb_array_elements_text(r.p -> 'campos') AS c(x)))) ORDER BY l.ordem)
          FROM public.integracao_linhas l
         WHERE l.modelo_id = (r.p ->> 'modelo_id')::uuid), '[]'::jsonb)));
  END LOOP;
  UPDATE public.integracao_acessos SET detalhe = jsonb_build_object('pedidos', jsonb_array_length(v_sel)) WHERE id = v_acesso;
  RETURN jsonb_build_object('status', 'ok', 'modo', 'normal', 'acesso_id', v_acesso, 'chave_id', k.id, 'tenant_id', k.tenant_id,
    'loja', jsonb_build_object('id', k.tenant_id, 'nome', v_loja), 'colunas', v_cols -> 'rotulos',
    'chaves_colunas', v_cols -> 'chaves', 'produtos', v_prods,
    'proximo_cursor', CASE WHEN v_mais
      THEN to_jsonb(encode(convert_to(jsonb_build_object('depois', v_sel -> (jsonb_array_length(v_sel) - 1) ->> 'id')::text, 'UTF8'), 'base64'))
      ELSE 'null'::jsonb END,
    'validade_foto_dias', v_cfg.validade_foto_dias,
    -- D39 (P-89 A): o programa do dev se ajusta sozinho se a loja mudar o "Máximo de produtos por página"
    'pagina', jsonb_build_object('limite', v_lim, 'maximo', v_cfg.max_por_pagina));
END
$function$;

CREATE OR REPLACE FUNCTION public._integracao_confirmar(_chave_id uuid, _acesso_id uuid, _entrega jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  k public.integracao_chaves%ROWTYPE;
  v_ativo boolean;
  v_ids uuid[];
  v_conf jsonb := '[]'::jsonb;
  v_conf_ids uuid[] := '{}'::uuid[];
  v_novos integer := 0;
  v_relidos integer := 0;
  v_agora timestamptz := now();
  r record;
BEGIN
  -- nota 9: reconfere a chave e a loja de cada produto (a entrega é a 2ª fase INTERNA da rota, não um ack do ERP)
  SELECT * INTO k FROM public.integracao_chaves WHERE id = _chave_id;
  IF NOT FOUND OR k.revogada_em IS NOT NULL THEN
    UPDATE public.integracao_acessos SET status = 'chave_invalida', concluido_em = now() WHERE id = _acesso_id;
    RETURN jsonb_build_object('status', 'chave_invalida', 'confirmados', '[]'::jsonb);
  END IF;
  SELECT t.ativo INTO v_ativo FROM public.tenants t WHERE t.id = k.tenant_id;
  IF NOT coalesce(v_ativo, false) THEN
    UPDATE public.integracao_acessos SET status = 'loja_inativa', concluido_em = now() WHERE id = _acesso_id AND chave_id = k.id;
    RETURN jsonb_build_object('status', 'loja_inativa', 'confirmados', '[]'::jsonb);
  END IF;
  v_ids := ARRAY(SELECT DISTINCT (e.x ->> 'modelo_id')::uuid
                   FROM jsonb_array_elements(coalesce(_entrega -> 'produtos', '[]'::jsonb)) AS e(x) ORDER BY 1);
  PERFORM 1 FROM public.integracao_produtos ip
   WHERE ip.modelo_id = ANY(v_ids) AND ip.tenant_id = k.tenant_id ORDER BY ip.modelo_id FOR UPDATE;
  FOR r IN
    SELECT DISTINCT ON (ip.modelo_id) ip.id, ip.modelo_id, ip.estado, ip.assinatura, ip.integrado_em, e.x ->> 'assinatura' AS ass
      FROM jsonb_array_elements(coalesce(_entrega -> 'produtos', '[]'::jsonb)) AS e(x)
      JOIN public.integracao_produtos ip ON ip.modelo_id = (e.x ->> 'modelo_id')::uuid AND ip.tenant_id = k.tenant_id
     ORDER BY ip.modelo_id
  LOOP
    IF r.estado = 'integravel' AND r.assinatura = r.ass THEN
      UPDATE public.integracao_produtos
         SET estado = 'integrado', integrado_em = v_agora, integrado_chave_id = k.id, rev = rev + 1, atualizado_em = now()
       WHERE id = r.id;
      UPDATE public.integracao_linhas SET integrado_em = v_agora WHERE modelo_id = r.modelo_id;
      PERFORM public._integracao_logar(k.tenant_id, 'integrado', r.modelo_id,
        jsonb_build_object('chave', k.nome, 'final', k.final, 'acesso_id', _acesso_id),
        format('Chave "%s" ····%s', k.nome, k.final));
      v_conf := v_conf || jsonb_build_array(jsonb_build_object('modelo_id', r.modelo_id, 'integrado_em', v_agora));
      v_conf_ids := v_conf_ids || r.modelo_id;
      v_novos := v_novos + 1;
    ELSIF r.estado = 'integrado' AND r.assinatura = r.ass THEN
      v_conf := v_conf || jsonb_build_array(jsonb_build_object('modelo_id', r.modelo_id, 'integrado_em', r.integrado_em));
      v_conf_ids := v_conf_ids || r.modelo_id;
      v_relidos := v_relidos + 1;
    END IF;
  END LOOP;
  UPDATE public.integracao_acessos
     SET status = 'ok', produtos_entregues = v_novos + v_relidos,
         linhas = (SELECT count(*) FROM public.integracao_linhas l WHERE l.modelo_id = ANY(v_conf_ids)),
         detalhe = detalhe || jsonb_build_object('novos', v_novos, 'relidos', v_relidos,
                     'fotos_descartadas', coalesce((_entrega ->> 'fotos_descartadas')::integer, 0),
                     'fotos_ausentes', coalesce((_entrega ->> 'fotos_ausentes')::integer, 0)),
         concluido_em = now()
   WHERE id = _acesso_id AND chave_id = k.id;
  RETURN jsonb_build_object('status', 'ok', 'confirmados', v_conf);
END
$function$;

CREATE OR REPLACE FUNCTION public._integracao_limpar(_tenant uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_n integer;
BEGIN
  -- n4/D20: ≤ 500 linhas por chamada, SÓ da loja pedida (NULL = as agregadas sem loja), SÓ quem NÃO entregou produto
  WITH alvo AS (
    SELECT a.id FROM public.integracao_acessos a
     WHERE a.tenant_id IS NOT DISTINCT FROM _tenant AND a.criado_em < now() - interval '90 days' AND a.produtos_entregues = 0
     ORDER BY a.criado_em
     LIMIT 500)
  DELETE FROM public.integracao_acessos a USING alvo WHERE a.id = alvo.id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END
$function$;

REVOKE EXECUTE ON FUNCTION public._integracao_colunas(text[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._integracao_exemplo(text[], integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._integracao_valores(public.integracao_linhas, text[], text[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._integracao_ler(text, boolean, text, integer, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._integracao_confirmar(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._integracao_limpar(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._integracao_ler(text, boolean, text, integer, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public._integracao_confirmar(uuid, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public._integracao_limpar(uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.integracao_salvar_config(text[], integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.integracao_salvar_config_api(jsonb, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.integracao_chaves_listar() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.integracao_chave_criar(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.integracao_chave_revogar(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.integracao_acessos_listar(integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.integracao_exemplo() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.integracao_salvar_config(text[], integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.integracao_salvar_config_api(jsonb, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.integracao_chaves_listar() TO authenticated;
GRANT EXECUTE ON FUNCTION public.integracao_chave_criar(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.integracao_chave_revogar(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.integracao_acessos_listar(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.integracao_exemplo() TO authenticated;

DO $pos$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['public._integracao_ler(text,boolean,text,integer,text,text)', 'public._integracao_confirmar(uuid,uuid,jsonb)',
                            'public._integracao_limpar(uuid)'] LOOP
    IF NOT has_function_privilege('service_role', f, 'EXECUTE') OR has_function_privilege('authenticated', f, 'EXECUTE')
       OR has_function_privilege('anon', f, 'EXECUTE') OR has_function_privilege('public', f, 'EXECUTE') THEN
      RAISE EXCEPTION 'integracao_6: ACL da rota errada em %', f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY['public._integracao_colunas(text[])', 'public._integracao_exemplo(text[],integer)',
                            'public._integracao_valores(public.integracao_linhas,text[],text[])'] LOOP
    IF has_function_privilege('authenticated', f, 'EXECUTE') OR has_function_privilege('public', f, 'EXECUTE') THEN
      RAISE EXCEPTION 'integracao_6: % executavel (inv. 9)', f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
```

- [ ] **Step 4: Escrever o inverso 6 — `supabase/rollback/20261007150000_integracao_6_api_down.sql`**

```sql
-- Inverso de 20261007150000_integracao_6_api.sql — só DROP das 13 funções novas. Rodar PRIMEIRO na volta (LIFO).
-- Não apaga dado (chaves/acessos/log ficam até o inverso 1). A API passa a responder 500 (a rota chama função ausente).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '3s';

DO $guarda$
BEGIN
  IF to_regprocedure('public.integracao_salvar(jsonb,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'integracao_6_down: a migration 5 nao esta aplicada - estado inesperado' USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

DROP FUNCTION IF EXISTS public._integracao_limpar(uuid);
DROP FUNCTION IF EXISTS public._integracao_confirmar(uuid, uuid, jsonb);
DROP FUNCTION IF EXISTS public._integracao_ler(text, boolean, text, integer, text, text);
DROP FUNCTION IF EXISTS public.integracao_exemplo();
DROP FUNCTION IF EXISTS public.integracao_acessos_listar(integer);
DROP FUNCTION IF EXISTS public.integracao_chave_revogar(uuid);
DROP FUNCTION IF EXISTS public.integracao_chave_criar(text);
DROP FUNCTION IF EXISTS public.integracao_chaves_listar();
DROP FUNCTION IF EXISTS public.integracao_salvar_config_api(jsonb, integer);
DROP FUNCTION IF EXISTS public.integracao_salvar_config(text[], integer);
DROP FUNCTION IF EXISTS public._integracao_valores(public.integracao_linhas, text[], text[]);
DROP FUNCTION IF EXISTS public._integracao_exemplo(text[], integer);
DROP FUNCTION IF EXISTS public._integracao_colunas(text[]);

DO $pos$
BEGIN
  IF to_regprocedure('public._integracao_ler(text,boolean,text,integer,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'integracao_6_down: funcoes da migration 6 ainda existem' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
```

- [ ] **Step 5: Rodar e ver passar (N3)**

```bash
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres
INTEG_DONO_AVISADO=sim bash .superpowers/integracao/n3.sh antes t6
INTEGRACAO_MIG_TXN=1 npx vitest run --no-file-parallelism tests/integration/integracao-5-salvar.test.ts tests/integration/integracao-6-api.test.ts
bash .superpowers/integracao/n3.sh depois t6
```
Expected: PASS (5: 8 · 6: 12).

- [ ] **Step 6: Gates + commit**

```bash
bash .superpowers/integracao/gates.sh
git add -- supabase/migrations/20261007150000_integracao_6_api.sql supabase/rollback/20261007150000_integracao_6_api_down.sql \
  tests/integration/integracao-6-api.test.ts
git commit --only -m "feat(integracao): migration 6 — campos/config/chaves só super admin, API em 2 fases (ler reserva + limite por chave e IP; confirmar marca integrado), modo teste com exemplos

Co-Authored-By: Claude <modelo real> <noreply@anthropic.com>" -- supabase/migrations/20261007150000_integracao_6_api.sql \
  supabase/rollback/20261007150000_integracao_6_api_down.sql tests/integration/integracao-6-api.test.ts
git show --stat HEAD | tail -n +7
```

---

### Task 7: ACL, mensagens ASCII por comando, ida/volta idempotentes (round-trip) + portão G-migration

**Files:**
- Test: `tests/integration/integracao-7-acl-voltas.test.ts`
- Create (não versionado): `.superpowers/integracao/mig/md5-sql-congelado.txt` (Step 6, depois do G-migration aprovar)

**Interfaces:**
- Consumes: Tasks 1–6 (as 12 SQL, `MIGRACOES`, `INVERSOS`, `aplica`, `prepara`, `MD5_ANTES`).
- Produces: prova de (a) ACL #9 de TODAS as 46 funções; (b) TODO `RAISE … P0409` desta frente com mensagem ASCII e nenhum
  `P0002`; (c) ida 1→6 idempotente (2×) e volta 6→1 (2×) devolvendo a cópia ao retrato de antes (contagens, md5 das 4
  redefinidas, 0 tabelas `integracao_*`); (d) as 7 tabelas negam leitura a `authenticated` e `anon`. `md5-sql-congelado.txt`
  (md5 dos 12 SQL aprovados) — o pré-voo de produção compara com ele.

- [ ] **Step 1: Escrever o teste**

`tests/integration/integracao-7-acl-voltas.test.ts`:

```ts
/** Integração + API — ACL, ASCII por comando e round-trip ida/volta. Plano Task 7. Só na cópia (N3), txn revertida. */
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, withTx, comoUsuario, um } from "./db";
import { INVERSOS, LOCAL, MD5_ANTES, MIGRACOES, MIG_TXN, U, aplica, prepara } from "./integracao-helpers";

const INTERNAS_PREFIXO = "_integracao_";
const RPCS = ["integracao_previa", "integracao_listar", "integracao_estado_modelos", "integracao_config_ler", "integracao_marcar",
  "integracao_voltar", "integracao_desfazer", "integracao_log_listar", "salvar_precos_fixo_produto_importado", "integracao_salvar",
  "integracao_salvar_config", "integracao_salvar_config_api", "integracao_chaves_listar", "integracao_chave_criar",
  "integracao_chave_revogar", "integracao_acessos_listar", "integracao_exemplo"];
const ROTA = ["_integracao_ler", "_integracao_confirmar", "_integracao_limpar"];
async function retratoBanco(c: Client) {
  return um<{ f: string; g: string; t: string; md5: string }>(c,
    `SELECT (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace) AS f,
            (SELECT count(*) FROM pg_trigger t JOIN pg_class k ON k.oid = t.tgrelid WHERE k.relnamespace = 'public'::regnamespace AND NOT t.tgisinternal) AS g,
            (SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname LIKE 'integracao\\_%' AND relkind = 'r') AS t,
            (SELECT string_agg(md5(pg_get_functiondef(p.oid)), '|' ORDER BY p.proname) FROM pg_proc p
              WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('_imp_recomputar_precos_modelo','_pa_recomputar_precos_modelo',
                '_salvar_produto_importado_core','_seed_tenant_defaults')) AS md5`);
}
const MD5_4_ANTES = [MD5_ANTES.imp, MD5_ANTES.pa, MD5_ANTES.impCore, MD5_ANTES.seed].join("|");

describe.skipIf(!hasDb || !LOCAL)("integracao — ACL, ASCII e voltas", () => {
  it("ACL #9: internas fechadas p/ PUBLIC/anon/authenticated; RPCs só authenticated; rota só service_role", async () => {
    await withTx(async (c) => {
      await prepara(c, 6);
      const r = await um<{ internas: string; rpc_anon: string; rpc_auth: string; rota: string; total: string }>(c,
        `SELECT
           (SELECT count(*) FROM pg_proc p CROSS JOIN (VALUES ('public'), ('anon'), ('authenticated')) r(y)
             WHERE p.pronamespace = 'public'::regnamespace AND (p.proname LIKE '\\_integracao\\_%' OR p.proname = '_salvar_precos_fixo_produto_importado_core')
               AND has_function_privilege(r.y, p.oid, 'EXECUTE')) AS internas,
           (SELECT count(*) FROM pg_proc p CROSS JOIN (VALUES ('public'), ('anon')) r(y)
             WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY($1::text[]) AND has_function_privilege(r.y, p.oid, 'EXECUTE')) AS rpc_anon,
           (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY($1::text[])
               AND has_function_privilege('authenticated', p.oid, 'EXECUTE')) AS rpc_auth,
           (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY($2::text[])
               AND has_function_privilege('service_role', p.oid, 'EXECUTE')) AS rota,
           (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND (p.proname LIKE '\\_integracao\\_%'
               OR p.proname LIKE 'integracao\\_%' OR p.proname LIKE 'fn\\_integracao\\_%' OR p.proname IN ('fn_modelo_espelho_nome_ref',
               'fn_espelho_modelo_nome_ref', 'salvar_precos_fixo_produto_importado', '_salvar_precos_fixo_produto_importado_core'))) AS total`,
        [RPCS, ROTA]);
      expect(r).toEqual({ internas: "0", rpc_anon: "0", rpc_auth: String(RPCS.length), rota: "3", total: "46" });
    });
  });

  it("toda mensagem de RAISE … P0409 desta frente é ASCII (por COMANDO, regex com \\y); nenhum P0002", async () => {
    await withTx(async (c) => {
      await prepara(c, 6);
      const r = await c.query(
        `SELECT p.proname, m[1] AS msg
           FROM pg_proc p, regexp_matches(pg_get_functiondef(p.oid), 'RAISE\\s+EXCEPTION\\s+''([^'']*)''[^;]*\\yP0409\\y', 'gi') AS m
          WHERE p.pronamespace = 'public'::regnamespace AND (p.proname LIKE '%integracao%')`);
      expect(r.rows.length).toBeGreaterThanOrEqual(7);
      for (const row of r.rows) expect(/^[\x20-\x7E]*$/.test(row.msg), `${row.proname}: ${row.msg}`).toBe(true);
      const p2 = await um<{ n: string }>(c,
        `SELECT count(*) AS n FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE '%integracao%'
            AND pg_get_functiondef(p.oid) ~* '\\yP0002\\y'`);
      expect(p2.n).toBe("0");
    });
  });

  it("as 7 tabelas negam leitura a authenticated (mesmo com permissão integracao) e a anon", async () => {
    await withTx(async (c) => {
      await prepara(c, 6);
      await comoUsuario(c, U);
      for (const t of ["integracao_config", "integracao_segredo", "integracao_produtos", "integracao_linhas", "integracao_chaves",
        "integracao_acessos", "integracao_log"]) {
        for (const role of ["authenticated", "anon"]) {
          await c.query("SAVEPOINT r");
          await c.query(`SET LOCAL ROLE ${role}`);
          await expect(c.query(`SELECT 1 FROM public.${t} LIMIT 1`), `${role} ${t}`).rejects.toThrow(/permission denied/);
          await c.query("ROLLBACK TO SAVEPOINT r");
        }
      }
    });
  });

  it.skipIf(!MIG_TXN)("round-trip: ida 1→6 (2×, idempotente) e volta 6→1 (2×) devolvem a cópia ao retrato de ANTES", async () => {
    await withTx(async (c) => {
      // o retrato "antes" é lido ANTES de aplicar; `aplica` chama exigeBancoLocal() (só a cópia)
      await c.query("SET LOCAL lock_timeout = '3s'");
      await c.query("SET LOCAL statement_timeout = '180s'");
      const antes = await retratoBanco(c);
      expect(antes.t).toBe("0");
      expect(antes.md5).toBe(MD5_4_ANTES);
      for (const rel of MIGRACOES) await aplica(c, rel);
      const ida1 = await retratoBanco(c);
      expect(Number(ida1.f) - Number(antes.f)).toBe(46);
      expect(Number(ida1.g) - Number(antes.g)).toBe(13);
      expect(ida1.t).toBe("7");
      for (const rel of MIGRACOES) await aplica(c, rel); // 2ª ida: idempotente (guardas aceitam o texto novo)
      expect(await retratoBanco(c)).toEqual(ida1);
      for (const rel of [...INVERSOS].reverse()) await aplica(c, rel);
      expect(await retratoBanco(c)).toEqual(antes);
      for (const rel of MIGRACOES) await aplica(c, rel);
      expect(await retratoBanco(c)).toEqual(ida1);
      for (const rel of [...INVERSOS].reverse()) await aplica(c, rel);
      expect(await retratoBanco(c)).toEqual(antes);
    });
  });
});
```

- [ ] **Step 2: Rodar (N3) — a suíte inteira da frente, com as migrations na txn**

```bash
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres
INTEG_DONO_AVISADO=sim bash .superpowers/integracao/n3.sh antes t7
INTEGRACAO_MIG_TXN=1 npx vitest run --no-file-parallelism tests/integration/integracao-1-tabelas.test.ts \
  tests/integration/integracao-2-retrato.test.ts tests/integration/integracao-3-estados.test.ts \
  tests/integration/integracao-4-trava.test.ts tests/integration/integracao-5-salvar.test.ts \
  tests/integration/integracao-6-api.test.ts tests/integration/integracao-7-acl-voltas.test.ts \
  2>&1 | tee .superpowers/integracao/logs/t7-suite.log | tail -15
bash .superpowers/integracao/n3.sh depois t7
```
Expected: PASS em todas (≈ 69 testes, 0 pulados com `INTEGRACAO_MIG_TXN=1`); `n3.sh depois` = mesma contagem do `antes`
(495|277|false — nada vazou). Rode também as suítes vizinhas que a frente pode afetar (o banco da cópia SEM a frente — elas
não aplicam as nossas migrations, então só provam que nada vazou): `tests/integration/sku-previa.test.ts` e
`tests/integration/kanban-auto.test.ts` sem variáveis de migração — mesmo resultado da linha de base registrada no Task 0.

- [ ] **Step 3: Gates + commit**

```bash
bash .superpowers/integracao/gates.sh
git add -- tests/integration/integracao-7-acl-voltas.test.ts
git commit --only -m "test(integracao): ACL #9 das 46 funções, P0409 ASCII por comando, tabelas sem leitura REST e round-trip ida/volta 2×

Co-Authored-By: Claude <modelo real> <noreply@anthropic.com>" -- tests/integration/integracao-7-acl-voltas.test.ts
git show --stat HEAD | tail -n +7
```

- [ ] **Step 4: Pacote do G-migration** (o controlador monta em `.superpowers/integracao/g-migration-pacote/`, não versionado)

```bash
P=.superpowers/integracao/g-migration-pacote; mkdir -p "$P"
git diff "$(git merge-base feature/plan-tecido-a1 HEAD)" HEAD -- supabase/ tests/integration/integracao-* > "$P/banco.diff"
cp .superpowers/integracao/logs/t7-suite.log "$P/"
grep -h "\[medição\]" .superpowers/integracao/logs/*.log > "$P/medicao.txt" || true
for f in .superpowers/integracao/mig/antes/*.sql; do md5 -q "$f" 2>/dev/null || md5sum "$f"; done > "$P/antes-md5.txt"
ls -la "$P"
```

- [ ] **Step 5: G-migration — 2 revisões Opus INDEPENDENTES + guardião `guardiao-unificacao`**

Cada Opus recebe SÓ: o spec, este plano (§1–§5 + Tasks 1–7), os 12 SQL, `integracao-helpers.ts`, as 7 suítes e o pacote do
Step 4 — e NÃO vê o parecer da outra. Checklist (com evidência `arquivo:linha` ou comando+saída):
1. cada migration: encoding → 1 BEGIN/COMMIT → travas 500ms/3s → `$guarda$` → idempotente → `$pos$` → NOTIFY; número >
   `20261006120000`; inverso pareado testado (suítes 1–6 "inverso N" + round-trip da 7);
2. as 4 redefinidas: diff mínimo provado (TRECHO_SEED, TRECHO_B1 ×2, TRECHO_IMP_FIXO) e inverso = texto do dump (md5 de antes);
3. ACL #9 das 46 funções (Task 7) e as 7 tabelas sem policy/sem leitura REST (inv. #12 — custo);
4. trava §8 completa: campos marcados, SKU e "Tamanho em" SEMPRE (B2), exclusão (R8), espelho (delta item 3), variantes no
   COMMIT (nota 14/D11), preço fixo explícito (delta item 4/D12), gatilhos `trg_zz_*` últimos e nunca `ENABLE ALWAYS`,
   `reset_loja` ok; Dev sem mudança passa (R9); BOM/CAD/produção livres; B1 (receber OC/MO/markup) sem erro e preço congelado;
5. V1 (gravador da revenda intocado; checagem só na `integracao_salvar`), V2 (foto com WHEN), V3 (nome do importado),
   V4 (reserva sob a trava), n1–n6 cobertos no banco (n1/n2 são tela — Task 22);
6. mensagens P0409 ASCII por comando (Task 7) e mapeadas na tela (Task 9); nenhum P0002;
7. retrato: ordem P-60 B, faltas, apelido vazio (P-74 A), custo real>previsto sem estimado (D8), fotos por loja (nota 7),
   HMAC (nota 6), máscara de custo (previa/listar/log), medição de desempenho < 3 s;
8. API em 2 fases: chave por hash, nunca RAISE p/ chave errada (nota 9), limite por chave e por IP (R7/R11/D18/D19),
   `modo=teste` só exemplos (P-82 A), paginação por produto (D21), corrida voltar×entregar, limpeza escopada (n4);
9. decisões D1–D39 (§2, a lista COMPLETA — R6) — o guardião diz quais precisam de OK explícito do dono antes da produção.

O guardião acrescenta o veredito ao diário `.superpowers/sdd/2026-09-22-unificacao-kanban-auto/guardiao.md` (checkout
principal). **BLOQUEIA ⇒ parar.** APROVA COM RESSALVAS ⇒ corrigir (volta à task do arquivo, com teste) e repetir os Steps
2–5 no delta.

- [ ] **Step 6: Congelar os 12 SQL aprovados (só depois do veredito APROVA)**

```bash
M=.superpowers/integracao/mig
for f in $(ls supabase/migrations/20261007*_integracao_*.sql supabase/rollback/20261007*_integracao_*_down.sql | LC_ALL=C sort); do
  printf '%s  %s\n' "$(md5 -q "$f" 2>/dev/null || md5sum "$f" | cut -d' ' -f1)" "$f"
done > "$M/md5-sql-congelado.txt"
wc -l "$M/md5-sql-congelado.txt"   # 12 (mesmo formato de md5_sql_agora, Task 8)
```
A partir daqui, mudar qualquer um dos 12 SQL reabre o G-migration (o `ida-producao.sh` recusa md5 diferente).

---

### Task 8: Scripts de produção (molde SKU em prévia), ensaio geral na cópia, G-scripts e RODAR do dono (NÃO é código do app)

> ⛔ Produção NÃO recebe nada antes dos Steps 1–8 (ensaio na cópia → provas → G-scripts → OK do dono). Quem roda a produção
> é o DONO, pelo RODAR (Step 8), com `pg_dump` completo ANTES (sem PITR). A tela (Tasks 9–24) só é juntada depois do "== IDA OK".

**Files (não versionados):** `.superpowers/integracao/mig/{monta-aplica.sh,extra.sh,aplica.sh (gerado),ensaio-local.sh,
ida-producao.sh,ref-volta-f1.sh,volta-producao.sh,prova-scripts.sh,md5-redef-depois.txt,md5-novas-depois.txt,
md5-sql-ensaiado.txt}`, `.superpowers/integracao/copia.sh`, `/Users/sunglee/PLM + Criação/savepoints/pre-apply-integracao/`
(pasta 700: `RODAR-integracao.md`, backups, retratos, contagens).

**Interfaces:**
- Consumes: molde `.superpowers/integracao/molde/aplica.sh` (Task 0; linhas 8–49 = bloco LITERAL da F1 `ATIV/espera/
  ativ_vazio/com_travas/aplica_v2`; 63–84 = `DBURL_FILE/REGEX_URL_PROD/confere_url_producao/previa_proibidas/le`; 158–219 =
  `backup_banco/backup_copia/ref_mais_nova/chaves_f1/fora_f1_e_previa/retrato_producao/confere_cadeia_ref`), a cadeia da
  volta da F1 em `/Users/sunglee/PLM + Criação/savepoints/pre-apply-f1-kanban-auto/` (`bloco_apoio_v2.sh`,
  `fidelidade_ref_volta_f1_*_detalhe.txt`), os 12 SQL congelados (Task 7).
- Produces: `source .superpowers/integracao/mig/aplica.sh` define `MIGS[6]`, `INVS[6]` (6→1), `MARCAS[6]`, `CONT`, `OBJ_INTEG`
  (0|46), `TAB_INTEG` (0|7), `MD5_REDEF`, `MD5_REDEF_ANTES`, `MD5_NOVAS`, `FN_PRE`, `ACL_INTEG` ("0|0|17|3" depois da ida),
  `SEM_POLICY` ("0|7"), `F1_OK`, `SKU_OK`, `PGCRYPTO_OK`, `PAT_INTEG`, `nivel_aplicado`, `prevoo_integ`, `confere_ida_integ`,
  `confere_volta_integ`, `confere_lifo_frentes`, `guarda_scripts_volta` + as genéricas do molde.

- [ ] **Step 1: `monta-aplica.sh` — junta o bloco literal da F1 + genéricas do molde (nomes trocados) + `extra.sh`**

```bash
#!/usr/bin/env bash
# Gera .superpowers/integracao/mig/aplica.sh = bloco LITERAL da F1 (molde 8–49) + genéricas do molde (63–84 e 158–219, com os
# nomes da frente) + extra.sh. Confere o molde (SHA256SUMS da Task 0) e as âncoras das linhas antes de copiar.
set -euo pipefail
TOP="$(git rev-parse --show-toplevel)"; cd "$TOP"
case "$TOP" in */.claude/worktrees/integracao-impl) ;; *) echo "PARE: rode de dentro da worktree integracao-impl"; exit 1;; esac
S=.superpowers/integracao; M=$S/mig; MOL=$S/molde/aplica.sh
( cd "$S/molde" && shasum -a 256 -c SHA256SUMS --quiet ) || { echo "PARE: o molde mudou desde a Task 0"; exit 1; }
[ "$(sed -n '9p' "$MOL" | cut -c1-9)" = "espera() " ] && [ "$(sed -n '49p' "$MOL")" = "}" ] \
  && [ "$(sed -n '67p' "$MOL" | cut -c1-24)" = "confere_url_producao() {" ] && [ "$(sed -n '84p' "$MOL" | cut -c1-5)" = "le() " ] \
  && [ "$(sed -n '158p' "$MOL" | cut -c1-15)" = "backup_banco() " ] && [ "$(sed -n '220p' "$MOL" | cut -c1-15)" = "confere_base() " ] \
  || { echo "PARE: as âncoras de linha do molde não batem (8–49 / 63–84 / 158–219)"; exit 1; }
{
  echo '#!/usr/bin/env bash'
  echo '# GERADO por .superpowers/integracao/mig/monta-aplica.sh — NÃO editar (editar extra.sh e regerar). Uso: source (só define).'
  echo '[ -n "${BASH_VERSION:-}" ] || { echo "ERRO: use bash"; return 1 2>/dev/null || exit 1; }'
  echo 'LOCAL="postgresql://postgres:postgres@127.0.0.1:54422/postgres"'
  sed -n '8,49p' "$MOL"
  sed -n '63,84p' "$MOL" | sed -e 's/PREVIA_/INTEG_/g'
  sed -n '158,219p' "$MOL" | sed -e 's/PAT_PREVIA/PAT_INTEG/g' -e 's/fora_f1_e_previa/fora_f1_e_integ/g' \
    -e 's/previa-kf1/integ-kf1/g' -e 's/pre-sku-previa/pre-integracao/g'
  cat "$M/extra.sh"
} > "$M/aplica.sh"
bash -n "$M/aplica.sh" && echo "OK: $M/aplica.sh ($(wc -l < "$M/aplica.sh" | tr -d ' ') linhas)"
```

- [ ] **Step 2: `extra.sh` — o trecho desta frente**

```bash
# ── Integração + API — trecho DESTA frente do aplica.sh. 6 migrations 20261007100000..150000: +46 funções | +13 gatilhos |
# +7 tabelas; 4 funções EXISTENTES redefinidas. Só DEFINE variáveis e funções (nada roda sozinho).
M=.superpowers/integracao/mig
DS="${INTEG_DS:-/Users/sunglee/PLM + Criação/savepoints/pre-apply-integracao}"
BF1="${INTEG_BF1:-/Users/sunglee/PLM + Criação/savepoints/pre-apply-f1-kanban-auto}"
RB="${INTEG_RB:-/Users/sunglee/PLM + Criação/plm-pcp/.superpowers/sdd/2026-09-22-kanban-automatico-f1-banco}"
BK="/Users/sunglee/PLM + Criação/banco-local/backups"
CONTAINER=supabase_db_banco-local
export PGCLIENTENCODING=UTF8
MIGS=(
  supabase/migrations/20261007100000_integracao_1_tabelas.sql
  supabase/migrations/20261007110000_integracao_2_retrato.sql
  supabase/migrations/20261007120000_integracao_3_estados.sql
  supabase/migrations/20261007130000_integracao_4_trava.sql
  supabase/migrations/20261007140000_integracao_5_salvar.sql
  supabase/migrations/20261007150000_integracao_6_api.sql
)
INVS=(  # ordem da VOLTA: 6 → 1
  supabase/rollback/20261007150000_integracao_6_api_down.sql
  supabase/rollback/20261007140000_integracao_5_salvar_down.sql
  supabase/rollback/20261007130000_integracao_4_trava_down.sql
  supabase/rollback/20261007120000_integracao_3_estados_down.sql
  supabase/rollback/20261007110000_integracao_2_retrato_down.sql
  supabase/rollback/20261007100000_integracao_1_tabelas_down.sql
)
MARCAS=(
  "select to_regclass('public.integracao_produtos') is not null"
  "select exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = '_integracao_retrato_core')"
  "select exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'integracao_marcar')"
  "select exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'fn_integracao_trava_modelos')"
  "select exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'integracao_salvar')"
  "select exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = '_integracao_ler')"
)
NOMES_REDEF="'_imp_recomputar_precos_modelo','_pa_recomputar_precos_modelo','_salvar_produto_importado_core','_seed_tenant_defaults'"
MD5_REDEF_ANTES="5baca24d0de45b8c5f291fef39472238|72c96c624de8f4530c862d8abb6a1283|47584858f55524d18d326dfff00139e6|01bd241680e24fdb665ca8ae81a6a1a3"
NOMES_NOVOS="'_integracao_layout','_integracao_rotulos','_integracao_cfg','_integracao_num','_integracao_mascarar','_integracao_retrato_core','_integracao_assinar','_integracao_gate','_integracao_gates','_integracao_base','_integracao_exige','_integracao_exige_super','integracao_previa','integracao_listar','integracao_estado_modelos','integracao_config_ler','_integracao_quem','_integracao_logar','integracao_marcar','integracao_voltar','integracao_desfazer','integracao_log_listar','_integracao_campo_travado','fn_integracao_trava_modelos','fn_integracao_trava_modelos_del','fn_integracao_trava_skus','fn_integracao_trava_espelho','fn_integracao_trava_variantes','fn_modelo_espelho_nome_ref','fn_espelho_modelo_nome_ref','_salvar_precos_fixo_produto_importado_core','salvar_precos_fixo_produto_importado','integracao_salvar','_integracao_colunas','_integracao_exemplo','_integracao_valores','_integracao_ler','_integracao_confirmar','_integracao_limpar','integracao_salvar_config','integracao_salvar_config_api','integracao_chaves_listar','integracao_chave_criar','integracao_chave_revogar','integracao_acessos_listar','integracao_exemplo'"
CONT="select (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public') || '|' || (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal)"
OBJ_INTEG="select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any(array[$NOMES_NOVOS])"
TAB_INTEG="select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname = any(array['integracao_config','integracao_segredo','integracao_produtos','integracao_linhas','integracao_chaves','integracao_acessos','integracao_log'])"
MD5_REDEF="select string_agg(md5(pg_get_functiondef(p.oid)), '|' order by p.proname) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any(array[$NOMES_REDEF])"
MD5_NOVAS="select md5(string_agg(p.proname || '=' || md5(pg_get_functiondef(p.oid)), E'\n' order by p.proname collate \"C\")) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any(array[$NOMES_NOVOS])"
FN_PRE="select md5(string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')=' || md5(pg_get_functiondef(p.oid)), E'\n' order by p.proname collate \"C\", pg_get_function_identity_arguments(p.oid) collate \"C\")) || '|' || count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f','p') and not (p.proname = any(array[$NOMES_REDEF,$NOMES_NOVOS]))"
ACL_INTEG="select (select count(*) from pg_proc p cross join (values ('public'),('anon'),('authenticated')) r(y) where p.pronamespace = 'public'::regnamespace and (p.proname like '\_integracao\_%' or p.proname = '_salvar_precos_fixo_produto_importado_core') and has_function_privilege(r.y, p.oid, 'EXECUTE')) || '|' || (select count(*) from pg_proc p cross join (values ('public'),('anon')) r(y) where p.pronamespace = 'public'::regnamespace and (p.proname like 'integracao\_%' or p.proname = 'salvar_precos_fixo_produto_importado') and has_function_privilege(r.y, p.oid, 'EXECUTE')) || '|' || (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and (p.proname like 'integracao\_%' or p.proname = 'salvar_precos_fixo_produto_importado') and has_function_privilege('authenticated', p.oid, 'EXECUTE')) || '|' || (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('_integracao_ler','_integracao_confirmar','_integracao_limpar') and has_function_privilege('service_role', p.oid, 'EXECUTE'))"
SEM_POLICY="select (select count(*) from pg_policy p join pg_class c on c.oid = p.polrelid where c.relnamespace = 'public'::regnamespace and c.relname like 'integracao\_%') || '|' || (select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname like 'integracao\_%' and c.relrowsecurity)"
F1_OK="select to_regprocedure('public.kanban_mover(uuid,text)') is not null"
SKU_OK="select to_regprocedure('public._skus_calc_ref_tipo(uuid,text,text)') is not null and to_regprocedure('public.aplicar_skus_modelo(uuid,jsonb,text,text)') is not null"
PGCRYPTO_OK="select to_regprocedure('extensions.hmac(bytea,bytea,text)') is not null and to_regprocedure('extensions.digest(text,text)') is not null and to_regprocedure('extensions.gen_random_bytes(integer)') is not null"
REF_DESTA="fidelidade_ref_volta_f1_pos_integracao_detalhe.txt"
CONT_DESTA="cont_volta_f1_pos_integracao.txt"
EXCL_DESTA='_pos_integracao_detalhe[.]txt$'
# Chaves (categoria:objeto) que ESTA frente cria/muda no retrato de fidelidade da volta da F1 (FIDEL_DET do bloco_apoio_v2)
PAT_INTEG='^(funcoes:public[.](_integracao_[a-z_]+|integracao_[a-z_]+|fn_integracao_trava_[a-z_]+|fn_modelo_espelho_nome_ref|fn_espelho_modelo_nome_ref|_salvar_precos_fixo_produto_importado_core|salvar_precos_fixo_produto_importado|_seed_tenant_defaults|_pa_recomputar_precos_modelo|_imp_recomputar_precos_modelo|_salvar_produto_importado_core)[(]|gatilhos:public[.][a-z_]+[.](trg_zz_integracao_[a-z_]+|trg_integracao_produtos_unico|trg_modelo_espelho_nome_ref|trg_espelho_modelo_nome_ref|trg_sync_foto_modelo_(acabado|importado)(_upd)?)$|colunas:public[.]integracao_[a-z_]+[.]|indices:public[.](idx_integracao_|uq_integracao_|integracao_)|policies:public[.]integracao_[a-z_]+[.])'

md5_arquivo() { md5 -q "$1" 2>/dev/null || md5sum "$1" | cut -d' ' -f1; }
md5_de() { tr -d '[:space:]' < "$1"; }
md5_sql_agora() { local f; for f in $(printf '%s\n' "${MIGS[@]}" "${INVS[@]}" | LC_ALL=C sort); do printf '%s  %s\n' "$(md5_arquivo "$f")" "$f"; done; }
nivel_aplicado() {  # uso: nivel_aplicado URL → N (0..6) = quantas migrations desta frente estão no banco, em sequência
  local n=0 i r
  for i in 0 1 2 3 4 5; do
    r=$(le "$1" "${MARCAS[$i]}") || return 1
    [ "$r" = t ] || break
    n=$((i + 1))
  done
  printf '%s\n' "$n"
}
confere_md5_sql_congelado() {
  [ -s "$M/md5-sql-congelado.txt" ] || { echo "FALHOU (pré-voo): falta $M/md5-sql-congelado.txt (Task 7 Step 6)"; return 1; }
  [ -s "$M/md5-sql-ensaiado.txt" ] || { echo "FALHOU (pré-voo): falta $M/md5-sql-ensaiado.txt (ensaio da Task 8)"; return 1; }
  diff -q <(LC_ALL=C sort -k2 "$M/md5-sql-congelado.txt") <(LC_ALL=C sort -k2 "$M/md5-sql-ensaiado.txt") > /dev/null \
    || { echo "FALHOU (pré-voo): o SQL ensaiado ≠ o congelado pelo G-migration"; return 1; }
  diff -q <(LC_ALL=C sort -k2 "$M/md5-sql-congelado.txt") <(md5_sql_agora | LC_ALL=C sort -k2) > /dev/null \
    || { diff <(LC_ALL=C sort -k2 "$M/md5-sql-congelado.txt") <(md5_sql_agora | LC_ALL=C sort -k2); echo "FALHOU (pré-voo): SQL no disco ≠ o congelado"; return 1; }
  [ "$(wc -l < "$M/md5-sql-congelado.txt" | tr -d ' ')" = 12 ] || { echo "FALHOU (pré-voo): o congelado não tem 12 arquivos"; return 1; }
  echo "OK (pré-voo): os 12 SQL no disco = o congelado = o ensaiado"
}
confere_arquivos_integ() {
  local f lp ln lc
  for f in "${MIGS[@]}" "${INVS[@]}"; do
    [ "$(grep -m1 -vE '^--|^$' "$f")" = "SET client_encoding = 'UTF8';" ] || { echo "FALHOU (pré-voo): $f — a 1ª instrução tem de ser SET client_encoding = 'UTF8';"; return 1; }
    [ "$(grep -B1 -x 'BEGIN;' "$f" | head -1)" = "SET client_encoding = 'UTF8';" ] || { echo "FALHOU (pré-voo): $f sem SET client_encoding logo antes do BEGIN;"; return 1; }
    [ "$(grep -c '^BEGIN;$' "$f")" = 1 ] && [ "$(grep -c '^COMMIT;$' "$f")" = 1 ] || { echo "FALHOU (pré-voo): $f precisa de 1 'BEGIN;' e 1 'COMMIT;'"; return 1; }
    [ "$(grep -A2 -x 'BEGIN;' "$f")" = "$(printf '%s\n' 'BEGIN;' "SET LOCAL lock_timeout = '500ms';" "SET LOCAL transaction_timeout = '3s';")" ] \
      || { echo "FALHOU (pré-voo): $f sem as 2 travas (500ms/3s) logo depois do BEGIN;"; return 1; }
    lp="$(grep -nxF 'DO $pos$' "$f" | head -1 | cut -d: -f1)"
    ln="$(grep -nxF "NOTIFY pgrst, 'reload schema';" "$f" | head -1 | cut -d: -f1)"
    lc="$(grep -nx 'COMMIT;' "$f" | head -1 | cut -d: -f1)"
    [ -n "$lp" ] && [ -n "$ln" ] && [ -n "$lc" ] && [ "$lp" -lt "$ln" ] && [ "$ln" -lt "$lc" ] \
      || { echo "FALHOU (pré-voo): $f sem a ordem DO \$pos\$ → NOTIFY → COMMIT"; return 1; }
    if grep -Eiq '(create|drop)[[:space:]]+policy|enable[[:space:]]+always' "$f"; then
      echo "FALHOU (pré-voo): $f tem DDL de policy ou ENABLE ALWAYS"; return 1
    fi
  done
  echo "OK (pré-voo): formato dos 12 SQL (encoding, travas, \$pos\$ → NOTIFY → COMMIT, sem policy/ENABLE ALWAYS)"
}
prevoo_integ() {  # uso: prevoo_integ URL RETRATO_ATUAL — SÓ LEITURA
  echo "== pré-voo da Integração — só leitura $(date '+%F %T')"
  local f
  for f in "${MIGS[@]}" "${INVS[@]}"; do
    git ls-files --error-unmatch "$f" > /dev/null 2>&1 || { echo "FALHOU (arquivos): $f não commitado"; return 1; }
  done
  git diff --quiet HEAD -- "${MIGS[@]}" "${INVS[@]}" || { echo "FALHOU (arquivos): alteração não commitada no SQL"; return 1; }
  confere_md5_sql_congelado || return 1
  confere_arquivos_integ || return 1
  [ ! -e "$BF1/$REF_DESTA" ] && [ ! -e "$BF1/$CONT_DESTA" ] \
    || { echo "FALHOU (pré-voo): $REF_DESTA / $CONT_DESTA já existe em $BF1 (ida anterior?) — avisar o controlador"; return 1; }
  espera "$1" "select current_setting('server_version_num')::int >= 170000 and exists (select 1 from pg_settings where name = 'transaction_timeout')" "t" "PG >= 17 com transaction_timeout" &&
  espera "$1" "$F1_OK" "t" "F1 (kanban automático) no banco" &&
  espera "$1" "$SKU_OK" "t" "SKU em prévia (20261005110000) no banco" &&
  espera "$1" "$PGCRYPTO_OK" "t" "pgcrypto em extensions (hmac/digest/gen_random_bytes)" &&
  espera "$1" "$OBJ_INTEG" "0" "funções desta frente ainda NÃO existem" &&
  espera "$1" "$TAB_INTEG" "0" "tabelas integracao_* ainda NÃO existem" &&
  espera "$1" "$MD5_REDEF" "$MD5_REDEF_ANTES" "as 4 funções redefinidas no texto de ANTES (a guarda da migration exige)" &&
  confere_cadeia_ref "$2" &&
  ativ_vazio "$1" &&
  echo "== PRÉ-VOO OK $(date '+%T')"
}
confere_ida_integ() {  # uso: confere_ida_integ URL CONT_ANTES FN_PRE_ANTES
  local f="${2%|*}" g="${2#*|}"
  espera "$1" "$OBJ_INTEG" "46" "IDA: as 46 funções novas" &&
  espera "$1" "$TAB_INTEG" "7" "IDA: as 7 tabelas" &&
  espera "$1" "$SEM_POLICY" "0|7" "IDA: 7 tabelas com RLS e 0 policy" &&
  espera "$1" "$MD5_REDEF" "$(md5_de "$M/md5-redef-depois.txt")" "IDA: as 4 redefinidas no texto ensaiado" &&
  espera "$1" "$MD5_NOVAS" "$(md5_de "$M/md5-novas-depois.txt")" "IDA: as 46 novas no texto ensaiado" &&
  espera "$1" "$ACL_INTEG" "0|0|17|3" "IDA: ACL (#9) — internas fechadas; 17 RPCs só authenticated; 3 da rota com service_role" &&
  espera "$1" "$FN_PRE" "$3" "IDA: nenhuma outra função mudou" &&
  espera "$1" "$CONT" "$((f + 46))|$((g + 13))" "IDA: contagens = antes + 46 funções, + 13 gatilhos"
}
confere_volta_integ() {  # uso: confere_volta_integ URL CONT_ANTES_DA_VOLTA FN_PRE_ANTES_DA_VOLTA NIVEL_ANTES
  local f="${2%|*}" g="${2#*|}"
  espera "$1" "$OBJ_INTEG" "0" "VOLTA: as funções desta frente saíram" &&
  espera "$1" "$TAB_INTEG" "0" "VOLTA: as 7 tabelas saíram" &&
  espera "$1" "$MD5_REDEF" "$MD5_REDEF_ANTES" "VOLTA: as 4 redefinidas de volta ao texto de antes" &&
  espera "$1" "$FN_PRE" "$3" "VOLTA: nenhuma outra função mudou" &&
  { [ "$4" != 6 ] || espera "$1" "$CONT" "$((f - 46))|$((g - 13))" "VOLTA: contagens = antes − 46 funções, − 13 gatilhos"; }
}
confere_lifo_frentes() {  # VOLTA: LIFO entre frentes — a referência desta frente tem de ser a MAIS NOVA da cadeia da volta da F1
  local r t novas
  r=$(ls -t "$BF1"/fidelidade_ref_volta_f1_*_detalhe.txt 2>/dev/null | head -1)
  if [ -e "$BF1/$REF_DESTA" ]; then
    [ "$(basename "$r")" = "$REF_DESTA" ] || { echo "PARE: a referência mais nova da volta da F1 é $(basename "$r") — outra frente entrou DEPOIS desta; volte antes a mais nova (LIFO) — nada foi feito"; return 1; }
    echo "OK (LIFO entre frentes): a referência mais nova da volta da F1 é a desta frente"; return 0
  fi
  t="$DS/cont-depois-integracao.txt"
  [ -e "$t" ] || t="$DS/fidelidade_prod_pre_integracao_detalhe.txt"
  [ -e "$t" ] || { echo "PARE: sem a referência desta frente nem os marcos da ida em $DS — avisar o controlador; nada foi feito"; return 1; }
  novas=$(find "$BF1" -maxdepth 1 -name 'fidelidade_ref_volta_f1_*_detalhe.txt' -newer "$t" 2>/dev/null | head -3)
  [ -z "$novas" ] || { echo "PARE: há referência de outra frente mais nova que a ida desta — LIFO; avisar o controlador — nada foi feito"; return 1; }
  echo "OK (LIFO entre frentes): a referência desta frente não existe, e nenhuma outra é mais nova que a ida desta"
}
guarda_scripts_volta() {  # LOGO DEPOIS DO BACKUP e ANTES do apply: cópia dos scripts da VOLTA na pasta 700 + como recriar a worktree
  local d f h lista
  d="$DS/scripts-volta-$(date +%F-%H%M%S)"; h="$(git rev-parse HEAD 2>/dev/null)"
  ( umask 077; mkdir -p "$d" ) && chmod 700 "$d" \
    && cp "$M/aplica.sh" "$M/extra.sh" "$M/monta-aplica.sh" "$M/volta-producao.sh" "$M/ref-volta-f1.sh" \
          "$M/md5-sql-congelado.txt" "$M/md5-sql-ensaiado.txt" "$M/md5-redef-depois.txt" "$M/md5-novas-depois.txt" "$d/" \
    || { echo "FALHOU (cópia da volta): não copiei os scripts da volta para $d"; return 1; }
  chmod 600 "$d"/* 2>/dev/null
  lista="$(for f in "$d"/*; do printf '#   %s  %s\n' "$(shasum -a 256 "$f" | cut -c1-16)" "$(basename "$f")"; done)"
  {
    echo "# Cópia dos scripts da VOLTA da Integração (20261007100000..150000) — gravada pela ida em $(date '+%F %T'), antes do apply"
    echo "# A volta SÓ roda de DENTRO da worktree .claude/worktrees/integracao-impl (confere o git e os inversos commitados). HEAD na ida: $h"
    echo "# Se a worktree NÃO existir mais — SÓ com o OK do dono, num Terminal NOVO:"
    echo "#   cd \"/Users/sunglee/PLM + Criação/plm-pcp\" && git worktree add --detach \".claude/worktrees/integracao-impl\" $h"
    echo "#   cd \"/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/integracao-impl\" && mkdir -p .superpowers/integracao/mig .superpowers/integracao/logs && cp \"$d\"/*.sh \"$d\"/*.txt .superpowers/integracao/mig/ && rm -f .superpowers/integracao/mig/LEIA-COMO-VOLTAR.txt"
    echo "#   cd \"/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/integracao-impl\" && VOLTA_CONFIRMO=apagar-integracao /bin/bash --noprofile --norc .superpowers/integracao/mig/volta-producao.sh 2>&1 | tee -a .superpowers/integracao/logs/prod-volta.log"
    echo "# sha256 (16) dos arquivos desta cópia:"
    printf '%s\n' "$lista"
  } > "$d/LEIA-COMO-VOLTAR.txt" && chmod 600 "$d/LEIA-COMO-VOLTAR.txt" && [ -s "$d/LEIA-COMO-VOLTAR.txt" ] \
    || { echo "FALHOU (cópia da volta): não gravei $d/LEIA-COMO-VOLTAR.txt"; return 1; }
  echo "OK (cópia da volta): $d (+ LEIA-COMO-VOLTAR.txt)"
}
```

Run: `chmod +x .superpowers/integracao/mig/monta-aplica.sh && bash .superpowers/integracao/mig/monta-aplica.sh`
Expected: `OK: .superpowers/integracao/mig/aplica.sh (… linhas)`.

- [ ] **Step 3: `ensaio-local.sh` — ENSAIO GERAL na cópia (ida real → suítes → volta → reaplica → volta; cópia termina LIMPA)**

```bash
#!/usr/bin/env bash
# ENSAIO GERAL da Integração na CÓPIA (127.0.0.1:54422). NUNCA produção. Uso (de dentro da worktree, depois do aviso N3 no painel):
#   INTEG_DONO_AVISADO=sim bash .superpowers/integracao/mig/ensaio-local.sh 2>&1 | tee .superpowers/integracao/logs/ensaio.log
set -uo pipefail
TOP="$(git rev-parse --show-toplevel)" || exit 1
case "$TOP" in */.claude/worktrees/integracao-impl) ;; *) echo "PARE: rode de dentro da worktree integracao-impl"; exit 1;; esac
cd "$TOP"
source .superpowers/integracao/mig/aplica.sh || { echo "PARE: não carreguei aplica.sh"; exit 1; }
bash .superpowers/integracao/n3.sh antes ensaio || exit 1
fim() { bash .superpowers/integracao/n3.sh depois "ensaio-$1"; }
pare_estado() {  # diz o estado REAL da cópia e para
  local n; n=$(nivel_aplicado "$LOCAL" 2>/dev/null) || n="?"
  echo "PARE ($1): a cópia está com $n de 6 migrations desta frente — NÃO siga; com n>0, volte com 'bash .superpowers/integracao/copia.sh volta' (com OK do controlador)"
  fim parou; exit 1
}
backup_copia ensaio || { fim parou; exit 1; }
[ "$(nivel_aplicado "$LOCAL")" = 0 ] || pare_estado "a cópia já tem a frente"
A_CONT=$(le "$LOCAL" "$CONT") && A_FN=$(le "$LOCAL" "$FN_PRE") && A_RED=$(le "$LOCAL" "$MD5_REDEF") || pare_estado "leitura antes"
[ "$A_RED" = "$MD5_REDEF_ANTES" ] || pare_estado "as 4 funções da cópia não estão no texto de antes"
echo "antes: $A_CONT"
echo "== IDA 1 $(date '+%T')"; T0=$(date +%s)
aplica_v2 "$LOCAL" "${MIGS[@]}" || pare_estado "ida 1"
echo "tempo da ida 1: $(( $(date +%s) - T0 )) s" | tee .superpowers/integracao/logs/ensaio-tempos.txt
le "$LOCAL" "$MD5_REDEF" > "$M/md5-redef-depois.txt" && le "$LOCAL" "$MD5_NOVAS" > "$M/md5-novas-depois.txt" || pare_estado "md5 depois"
confere_ida_integ "$LOCAL" "$A_CONT" "$A_FN" || pare_estado "conferência da ida 1"
echo "== SUÍTES contra o APLICADO (sem INTEGRACAO_MIG_TXN)"
DATABASE_URL="$LOCAL" npx vitest run --no-file-parallelism tests/integration/integracao-1-tabelas.test.ts \
  tests/integration/integracao-2-retrato.test.ts tests/integration/integracao-3-estados.test.ts \
  tests/integration/integracao-4-trava.test.ts tests/integration/integracao-5-salvar.test.ts \
  tests/integration/integracao-6-api.test.ts tests/integration/integracao-7-acl-voltas.test.ts > .superpowers/integracao/logs/ensaio-suites.log 2>&1
tail -8 .superpowers/integracao/logs/ensaio-suites.log
grep -qE "Tests +[0-9]+ passed" .superpowers/integracao/logs/ensaio-suites.log && ! grep -qE "[0-9]+ failed" .superpowers/integracao/logs/ensaio-suites.log \
  || pare_estado "suítes contra o aplicado"
echo "== VOLTA 1 $(date '+%T')"; T0=$(date +%s)
aplica_v2 "$LOCAL" "${INVS[@]}" || pare_estado "volta 1"
echo "tempo da volta 1: $(( $(date +%s) - T0 )) s" | tee -a .superpowers/integracao/logs/ensaio-tempos.txt
confere_volta_integ "$LOCAL" "$(( ${A_CONT%|*} + 46 ))|$(( ${A_CONT#*|} + 13 ))" "$A_FN" 6 || pare_estado "conferência da volta 1"
espera "$LOCAL" "$CONT" "$A_CONT" "cópia = antes (contagens)" || pare_estado "contagens depois da volta 1"
echo "== IDA 2 (reaplicar depois de desfazer)"
aplica_v2 "$LOCAL" "${MIGS[@]}" || pare_estado "ida 2"
espera "$LOCAL" "$MD5_NOVAS" "$(md5_de "$M/md5-novas-depois.txt")" "ida 2 = mesmo texto da ida 1" || pare_estado "ida 2 texto"
echo "== VOLTA 2 (a cópia termina LIMPA)"
aplica_v2 "$LOCAL" "${INVS[@]}" || pare_estado "volta 2"
espera "$LOCAL" "$CONT" "$A_CONT" "cópia LIMPA (contagens)" && espera "$LOCAL" "$MD5_REDEF" "$MD5_REDEF_ANTES" "cópia LIMPA (4 funções)" \
  && espera "$LOCAL" "$FN_PRE" "$A_FN" "cópia LIMPA (demais funções)" || pare_estado "cópia não voltou igual"
md5_sql_agora > "$M/md5-sql-ensaiado.txt"
diff -q <(LC_ALL=C sort -k2 "$M/md5-sql-congelado.txt") <(LC_ALL=C sort -k2 "$M/md5-sql-ensaiado.txt") > /dev/null \
  || { echo "PARE: o SQL ensaiado ≠ o congelado pelo G-migration — reabrir o portão"; fim parou; exit 1; }
fim ok
echo "== ENSAIO OK $(date '+%T') — cópia limpa ($A_CONT); md5 ensaiados em $M/md5-sql-ensaiado.txt"
```

Run (N3 — o controlador publica o aviso antes):
```bash
chmod +x .superpowers/integracao/mig/*.sh
INTEG_DONO_AVISADO=sim bash .superpowers/integracao/mig/ensaio-local.sh 2>&1 | tee .superpowers/integracao/logs/ensaio.log | tail -30
```
Expected: `== ENSAIO OK`; tempos de ida/volta registrados (cada arquivo < 1 s na cópia — é o teto do lock em produção);
suítes contra o aplicado: todos os testes PASS exceto os `skipIf(!MIG_TXN)` (inversos por migration, diffs mínimos e o
round-trip), que pulam. Qualquer `PARE` ⇒ chamar o controlador com o log.

- [ ] **Step 4: `ida-producao.sh` (o DONO roda) — guardas → pré-voo SÓ LEITURA → BACKUP → cópia da volta → apply → conferências**

```bash
#!/usr/bin/env bash
# IDA em PRODUÇÃO da Integração + API (6 migrations 20261007100000..150000: +46 funções | +13 gatilhos | +7 tabelas). Quem roda é o
# DONO, num Terminal NOVO, numa linha só:
#   cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/integracao-impl" && /bin/bash --noprofile --norc .superpowers/integracao/mig/ida-producao.sh 2>&1 | tee -a .superpowers/integracao/logs/prod-ida.log
# Ordem: INTEG_* proibidas → guarda de URL (antes de qualquer psql) → pasta 700 → estado lido na hora → pré-voo SÓ LEITURA (SQL = congelado
# = ensaiado; formato; PG 17; F1/SKU/pgcrypto; frente ausente; 4 funções no texto de antes; cadeia da volta da F1; sem transação longa)
# → BACKUP public + auth → cópia dos scripts da volta → aplica_v2 (erro ⇒ relê o estado REAL) → conferências → reload → "IDA OK".
set -uo pipefail
umask 077
unset EXTRA_SQL
export PGCLIENTENCODING=UTF8
TOP="$(git rev-parse --show-toplevel)" || { echo "PARE: não achei a raiz do git — nada foi aplicado"; exit 1; }
case "$TOP" in */.claude/worktrees/integracao-impl) ;; *) echo "PARE: rode de dentro da worktree integracao-impl (achei $TOP) — nada foi aplicado"; exit 1;; esac
cd "$TOP" || { echo "PARE: não entrei em $TOP — nada foi aplicado"; exit 1; }
source .superpowers/integracao/mig/aplica.sh || { echo "PARE: não carreguei aplica.sh — nada foi aplicado"; exit 1; }
previa_proibidas || exit 1
confere_url_producao || exit 1
mkdir -p .superpowers/integracao/logs "$DS" && chmod 700 "$DS" || { echo "PARE: não criei $DS (700) — nada foi aplicado"; exit 1; }
PROD="$(cat "$DBURL_FILE")"
echo "== IDA da Integração (20261007100000..150000) em PRODUÇÃO $(date '+%F %T') · HEAD $(git rev-parse --short HEAD)"
N=$(nivel_aplicado "$PROD") || { echo "FALHOU: não conectou em produção — nada foi aplicado"; exit 1; }
[ "$N" = 0 ] || { echo "PARE: $N de 6 migrations desta frente JÁ no banco — ida anterior? avisar o controlador (nada foi feito)"; exit 1; }
CONT_ANTES=$(le "$PROD" "$CONT") && FN_ANTES=$(le "$PROD" "$FN_PRE") || { echo "PARE: não li o estado antes — nada foi aplicado"; exit 1; }
printf '%s\n' "$CONT_ANTES" > "$DS/cont-antes-integracao.txt" && printf '%s\n' "$FN_ANTES" > "$DS/fn-pre-antes-integracao.txt" \
  || { echo "PARE: não gravei o estado antes em $DS — nada foi aplicado"; exit 1; }
echo "contagens antes (funções|gatilhos): $CONT_ANTES"
retrato_producao "$PROD" "$DS/fidelidade_prod_pre_integracao_detalhe.txt" || { echo "PARE: não li o retrato de fidelidade — nada foi aplicado"; exit 1; }
prevoo_integ "$PROD" "$DS/fidelidade_prod_pre_integracao_detalhe.txt" || { echo "== PAROU no pré-voo — nada foi aplicado"; exit 1; }
backup_banco "$PROD" "$DS" producao-pre-integracao || { echo "== PAROU no backup — nada foi aplicado"; exit 1; }
guarda_scripts_volta || { echo "== PAROU na cópia dos scripts da volta — nada foi aplicado"; exit 1; }
if ativ_vazio "$PROD" && espera "$PROD" "$OBJ_INTEG" "0" "ainda ausente logo antes do apply" && aplica_v2 "$PROD" "${MIGS[@]}"; then :; else
  N2=$(nivel_aplicado "$PROD" 2>/dev/null) || N2="?"
  case "$N2" in
    0) echo "== IDA NÃO CONCLUÍDA (nada desta frente ficou no banco — estado conferido agora) — avisar o controlador" ;;
    6) echo "== FALHOU NA CONFERÊNCIA DEPOIS DO APPLY — as 6 migrations ESTÃO no banco; NÃO rode de novo nem a volta sem o controlador; mande o log" ;;
    *) echo "== IDA NÃO CONCLUÍDA — PELA METADE: $N2 de 6 migrations no banco (cada uma é atômica; as seguintes não entraram). NÃO rode de novo; mande o log ao controlador (a volta desfaz só o que entrou)" ;;
  esac
  exit 1
fi
confere_ida_integ "$PROD" "$CONT_ANTES" "$FN_ANTES" \
  || { echo "== FALHOU NA CONFERÊNCIA DEPOIS DO APPLY — as migrations FORAM aplicadas; NÃO rode de novo nem a volta sem o controlador; mande o log"; exit 1; }
le "$PROD" "$CONT" > "$DS/cont-depois-integracao.txt" && [ -s "$DS/cont-depois-integracao.txt" ] \
  || { echo "== FALHOU NA CONFERÊNCIA — aplicada, mas não gravei cont-depois-integracao.txt; mande o log"; exit 1; }
psql "$PROD" -X -q -v ON_ERROR_STOP=1 -c "NOTIFY pgrst, 'reload schema'" \
  || { echo "== APLICADA, mas o reload do PostgREST falhou — rodar NOTIFY pgrst, 'reload schema' e avisar o controlador"; exit 1; }
echo "== IDA OK $(date '+%T') — contagens $CONT_ANTES → $(cat "$DS/cont-depois-integracao.txt"). Agora o Passo 3 do RODAR (ref-volta-f1.sh)."
```

- [ ] **Step 5: `ref-volta-f1.sh` (o DONO roda depois do "IDA OK") e `volta-producao.sh` (emergência)**

`ref-volta-f1.sh`:

```bash
#!/usr/bin/env bash
# Integração (20261007100000..150000) — GRAVA a referência da VOLTA DE EMERGÊNCIA da F1 logo DEPOIS do "== IDA OK" (a volta da F1
# compara TODO o public com uma referência; cada frente posterior à F1 grava a sua). Base = a referência MAIS NOVA; prova antes de
# gravar: (1) desde o pré-voo SÓ esta frente mudou o schema; (2) a base bate com a produção fora da F1 e desta frente; (3) a F1 não
# mexe nas chaves desta frente. Nova = base SEM as chaves desta frente + as ATUAIS delas; CONT = base + delta medido (+46|+13).
# SÓ LEITURA no banco. O DONO roda, numa linha só:
#   cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/integracao-impl" && /bin/bash --noprofile --norc .superpowers/integracao/mig/ref-volta-f1.sh 2>&1 | tee -a .superpowers/integracao/logs/prod-ref-volta-f1.log
set -uo pipefail
umask 077
[ $# = 0 ] || { echo "uso: ref-volta-f1.sh (sem argumentos)"; exit 2; }
TOP="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)" || { echo "PARE: não achei a raiz do git — nada foi gravado"; exit 1; }
case "$TOP" in */.claude/worktrees/integracao-impl) ;; *) echo "PARE: script fora da worktree integracao-impl — nada foi gravado"; exit 1;; esac
cd "$TOP" || exit 1
source .superpowers/integracao/mig/aplica.sh || { echo "PARE: não carreguei aplica.sh — nada foi gravado"; exit 1; }
previa_proibidas || exit 1
confere_url_producao || exit 1
PROD="$(cat "$DBURL_FILE")"
REF_NOVA="$BF1/$REF_DESTA"
echo "== referência da volta da F1 (pós-Integração) $(date '+%F %T') · HEAD $(git rev-parse --short HEAD)"
[ ! -e "$REF_NOVA" ] || { echo "PARE: $REF_NOVA já existe — rodou 2×? (nada foi gravado)"; exit 1; }
[ "$(le "$PROD" "$F1_OK")" = t ] || { echo "PARE: a F1 não está em produção (nada foi gravado)"; exit 1; }
[ "$(nivel_aplicado "$PROD")" = 6 ] || { echo "PARE: esta frente não está inteira em produção — rode DEPOIS do '== IDA OK' (nada foi gravado)"; exit 1; }
for f in cont-antes-integracao.txt cont-depois-integracao.txt fidelidade_prod_pre_integracao_detalhe.txt; do
  [ -s "$DS/$f" ] || { echo "PARE: falta $DS/$f (gravado pelo ida-producao.sh) — nada foi gravado"; exit 1; }
done
R=$(ref_mais_nova) || { echo "PARE: sem referência base — nada foi gravado"; exit 1; }
echo "base = referência mais nova: $(basename "$R")"
if grep -qE '^funcoes:public[.](_integracao_retrato_core|integracao_marcar|_integracao_ler)[(]' "$R"; then
  echo "PARE: a base já tem funções desta frente — ordem trocada ou rodou 2× (nada foi gravado)"; exit 1
fi
POS="$DS/fidelidade_prod_pos_integracao_detalhe.txt"
retrato_producao "$PROD" "$POS" || { echo "PARE: não li o retrato de agora — nada foi gravado"; exit 1; }
OUTRAS=$(diff <(awk -F'=' -v pat="$PAT_INTEG" '!($1 ~ pat)' "$DS/fidelidade_prod_pre_integracao_detalhe.txt" | LC_ALL=C sort) \
              <(awk -F'=' -v pat="$PAT_INTEG" '!($1 ~ pat)' "$POS" | LC_ALL=C sort) | grep -E '^[<>]' || true)
[ -z "$OUTRAS" ] || { printf '%s\n' "$OUTRAS" | cut -c1-160 | head -20; echo "PARE: desde o pré-voo o schema mudou FORA desta frente (nada foi gravado)"; exit 1; }
confere_cadeia_ref "$POS" || { echo "PARE: cadeia da volta da F1 — nada foi gravado"; exit 1; }
KF1="$(mktemp -t integ-kf1.XXXXXX)" || exit 1
chaves_f1 "$KF1" || { rm -f "$KF1"; echo "PARE: chaves da F1 — nada foi gravado"; exit 1; }
CRUZ=$(grep -E "$PAT_INTEG" "$KF1" || true); rm -f "$KF1"
[ -z "$CRUZ" ] || { echo "$CRUZ"; echo "PARE: chaves desta frente também mudadas pela F1 — avisar o controlador (nada foi gravado)"; exit 1; }
N=$(awk -F'=' -v pat="$PAT_INTEG" '$1 ~ pat' "$POS" | grep -c . || true)
[ "$N" -gt 50 ] || { echo "PARE: esperava > 50 chaves desta frente no retrato (46+4 funções, gatilhos, colunas, índices, RLS), achei $N — nada foi gravado"; exit 1; }
{ awk -F'=' -v pat="$PAT_INTEG" '!($1 ~ pat)' "$R"; awk -F'=' -v pat="$PAT_INTEG" '$1 ~ pat' "$POS"; } | LC_ALL=C sort > "$REF_NOVA" \
  || { rm -f "$REF_NOVA"; echo "PARE: não gravei $REF_NOVA"; exit 1; }
CR="$(grep -c '^funcoes:' "$R")|$(grep -c '^gatilhos:' "$R")"
A=$(tr -d '[:space:]' < "$DS/cont-antes-integracao.txt"); P=$(tr -d '[:space:]' < "$DS/cont-depois-integracao.txt")
ESP="$(( ${CR%|*} + ${P%|*} - ${A%|*} ))|$(( ${CR#*|} + ${P#*|} - ${A#*|} ))"
CV="$(grep -c '^funcoes:' "$REF_NOVA")|$(grep -c '^gatilhos:' "$REF_NOVA")"
[ "$CV" = "$ESP" ] || { rm -f "$REF_NOVA"; echo "PARE: CONT da referência nova ($CV) ≠ base ($CR) + delta medido ($A → $P) = $ESP — nada foi gravado"; exit 1; }
[ "$(( ${P%|*} - ${A%|*} ))|$(( ${P#*|} - ${A#*|} ))" = "46|13" ] || { rm -f "$REF_NOVA"; echo "PARE: delta da ida ≠ +46|+13 — nada foi gravado"; exit 1; }
printf '%s\n' "$CV" > "$BF1/$CONT_DESTA" || { rm -f "$REF_NOVA"; echo "PARE: não gravei $BF1/$CONT_DESTA (referência apagada)"; exit 1; }
{
  echo "# Volta de emergência da F1 DEPOIS da Integração (20261007100000..150000) — $(date '+%F %T')"
  echo "# Base: $(basename "$R"). No runbook v2 §9.2 trocar as 2 conferências finais por:"
  echo "espera \"\$PROD\" \"\$CONT\" \"$CV\" \"contagens pós-volta (com as frentes até a Integração)\" &&"
  echo "fidelidade \"\$PROD\" \"\$D/fidelidade_prod_pos_volta.txt\" \"\$D/fidelidade_prod_pos_volta_detalhe.txt\" > /dev/null &&"
  echo "diff \"\$D/$REF_DESTA\" <(LC_ALL=C sort \"\$D/fidelidade_prod_pos_volta_detalhe.txt\") && echo \"== VOLTA OK (com a Integração)\""
  echo "# Se a Integração for DESFEITA (volta-producao.sh), os 2 arquivos pos_integracao são renomeados e a referência volta a ser $(basename "$R")."
} | tee "$DS/LEIA-volta-f1-pos-integracao.txt" > "$RB/VOLTA-F1-POS-INTEGRACAO.md" \
  || echo "AVISO: não gravei o LEIA (a referência e o CONT ESTÃO gravados)"
echo "OK (referência nova p/ a volta da F1): $REF_NOVA — base $(basename "$R"); CONT esperado da volta: $CV"
```

`volta-producao.sh`:

```bash
#!/usr/bin/env bash
# VOLTA de EMERGÊNCIA da Integração em PRODUÇÃO — desfaz o que entrou (6 → 1). APAGA as 7 tabelas (config, chaves, acessos, log,
# espelho): produtos "integrados" deixam de existir como tal. SÓ com OK do dono e do controlador. Numa linha só:
#   cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/integracao-impl" && VOLTA_CONFIRMO=apagar-integracao /bin/bash --noprofile --norc .superpowers/integracao/mig/volta-producao.sh 2>&1 | tee -a .superpowers/integracao/logs/prod-volta.log
set -uo pipefail
umask 077
unset EXTRA_SQL
export PGCLIENTENCODING=UTF8
[ "${VOLTA_CONFIRMO:-}" = apagar-integracao ] || { echo "PARE: a volta APAGA os dados da Integração. Para confirmar, rode com VOLTA_CONFIRMO=apagar-integracao (nada foi feito)"; exit 1; }
TOP="$(git rev-parse --show-toplevel)" || { echo "PARE: não achei a raiz do git — nada foi feito"; exit 1; }
case "$TOP" in */.claude/worktrees/integracao-impl) ;; *) echo "PARE: rode de dentro da worktree integracao-impl — nada foi feito"; exit 1;; esac
cd "$TOP" || exit 1
source .superpowers/integracao/mig/aplica.sh || { echo "PARE: não carreguei aplica.sh — nada foi feito"; exit 1; }
previa_proibidas || exit 1
confere_url_producao || exit 1
for f in "${INVS[@]}"; do git ls-files --error-unmatch "$f" > /dev/null 2>&1 || { echo "PARE: $f não commitado — nada foi feito"; exit 1; }; done
confere_md5_sql_congelado || { echo "PARE: os inversos no disco ≠ os congelados/ensaiados — nada foi feito"; exit 1; }
PROD="$(cat "$DBURL_FILE")"
N=$(nivel_aplicado "$PROD") || { echo "FALHOU: não conectou — nada foi feito"; exit 1; }
[ "$N" != 0 ] || { echo "== NADA A VOLTAR: nenhuma migration desta frente no banco"; exit 0; }
echo "== VOLTA da Integração em PRODUÇÃO $(date '+%F %T') — $N de 6 migrations no banco"
confere_lifo_frentes "$PROD" || exit 1
CONT_ANTES=$(le "$PROD" "$CONT") && FN_ANTES=$(le "$PROD" "$FN_PRE") || { echo "PARE: não li o estado — nada foi feito"; exit 1; }
backup_banco "$PROD" "$DS" producao-pre-volta-integracao || { echo "== PAROU no backup — nada foi feito"; exit 1; }
ALVO=("${INVS[@]:$((6 - N))}")   # só os inversos das migrations que ESTÃO no banco (N..1)
if ativ_vazio "$PROD" && aplica_v2 "$PROD" "${ALVO[@]}"; then :; else
  echo "== VOLTA NÃO CONCLUÍDA — agora: $(nivel_aplicado "$PROD" 2>/dev/null || echo '?') de 6 no banco; NÃO repita sem o controlador; mande o log"; exit 1
fi
confere_volta_integ "$PROD" "$CONT_ANTES" "$FN_ANTES" "$N" || { echo "== FALHOU NA CONFERÊNCIA DA VOLTA — mande o log ao controlador"; exit 1; }
for f in "$REF_DESTA" "$CONT_DESTA"; do
  [ -e "$BF1/$f" ] && mv "$BF1/$f" "$BF1/$f.desfeita-$(date +%F-%H%M%S)"
done
psql "$PROD" -X -q -v ON_ERROR_STOP=1 -c "NOTIFY pgrst, 'reload schema'" || echo "AVISO: rodar NOTIFY pgrst, 'reload schema'"
echo "== VOLTA OK $(date '+%T') — a referência da volta da F1 voltou a ser a anterior (arquivos pos_integracao renomeados)"
```

- [ ] **Step 6: `copia.sh` — aplicar/desfazer DE VERDADE na cópia (p/ a QA no :5188), sempre em janela N3**

`.superpowers/integracao/copia.sh`:

```bash
#!/usr/bin/env bash
# Aplica (ida) ou desfaz (volta) a Integração na CÓPIA LOCAL (127.0.0.1:54422) — p/ a QA no :5188. NUNCA produção.
# Uso (de dentro da worktree, depois do aviso N3 no painel): INTEG_DONO_AVISADO=sim bash .superpowers/integracao/copia.sh ida|volta
set -uo pipefail
TOP="$(git rev-parse --show-toplevel)" || exit 1
case "$TOP" in */.claude/worktrees/integracao-impl) ;; *) echo "PARE: rode de dentro da worktree integracao-impl"; exit 1;; esac
cd "$TOP"
case "${1:-}" in ida|volta) ;; *) echo "uso: copia.sh ida|volta"; exit 2 ;; esac
source .superpowers/integracao/mig/aplica.sh || exit 1
bash .superpowers/integracao/n3.sh antes "copia-$1" || exit 1
N=$(nivel_aplicado "$LOCAL") || { bash .superpowers/integracao/n3.sh depois "copia-$1"; exit 1; }
backup_copia "copia-$1" || { bash .superpowers/integracao/n3.sh depois "copia-$1"; exit 1; }
if [ "$1" = ida ]; then
  [ "$N" = 0 ] || { echo "a cópia JÁ tem $N de 6 — nada a fazer"; bash .superpowers/integracao/n3.sh depois "copia-$1"; exit 0; }
  A=$(le "$LOCAL" "$CONT"); F=$(le "$LOCAL" "$FN_PRE")
  aplica_v2 "$LOCAL" "${MIGS[@]}" && confere_ida_integ "$LOCAL" "$A" "$F" || { echo "PARE: ida na cópia falhou — estado: $(nivel_aplicado "$LOCAL") de 6"; bash .superpowers/integracao/n3.sh depois "copia-$1"; exit 1; }
else
  [ "$N" != 0 ] || { echo "a cópia não tem a frente — nada a fazer"; bash .superpowers/integracao/n3.sh depois "copia-$1"; exit 0; }
  A=$(le "$LOCAL" "$CONT"); F=$(le "$LOCAL" "$FN_PRE")
  aplica_v2 "$LOCAL" "${INVS[@]:$((6 - N))}" && confere_volta_integ "$LOCAL" "$A" "$F" "$N" || { echo "PARE: volta na cópia falhou"; bash .superpowers/integracao/n3.sh depois "copia-$1"; exit 1; }
fi
bash .superpowers/integracao/n3.sh depois "copia-$1"
echo "== COPIA $1 OK — $(le "$LOCAL" "$CONT")"
```

- [ ] **Step 7: `prova-scripts.sh` — provas das guardas com `psql`/`docker` FALSOS (nunca o host real; nenhuma conexão)**

```bash
#!/usr/bin/env bash
# PROVAS dos scripts de produção com FALSOS no PATH (psql, docker) e URL SINTÉTICA — nenhuma conexão acontece (lição 25/set: prova
# nunca aponta p/ o host real, nem com senha falsa). Uso (de dentro da worktree): bash .superpowers/integracao/mig/prova-scripts.sh
set -uo pipefail
TOP="$(git rev-parse --show-toplevel)" || exit 1; cd "$TOP"
M=.superpowers/integracao/mig
SC="$(mktemp -d -t integ-prova.XXXXXX)" || exit 1
export INTEG_PROVA_SC="$SC"
mkdir -p "$SC/bin" "$SC/ds" "$SC/bf1"
ok=0; falhou=0
prova() { if eval "$2"; then echo "OK (prova): $1"; ok=$((ok + 1)); else echo "FALHOU (prova): $1"; falhou=$((falhou + 1)); fi; }
# psql FALSO: registra a chamada e responde pelo conteúdo da consulta; estado "aplicado" depois de um -c com BEGIN;
cat > "$SC/bin/psql" <<'FAKE'
#!/usr/bin/env bash
SC="${INTEG_PROVA_SC:?}"; echo "psql $*" | cut -c1-200 >> "$SC/chamadas.log"
todos="$*"
if printf '%s' "$todos" | grep -q "^.*BEGIN;"; then touch "$SC/aplicado"; exit 0; fi
aplic=0; [ -e "$SC/aplicado" ] && aplic=1
r() { printf '%s\n' "$1"; exit 0; }
case "$todos" in
  *"to_regclass('public.integracao_produtos')"*) [ $aplic = 1 ] && r t || r f ;;
  *"proname = '_integracao_retrato_core'"*|*"proname = 'integracao_marcar'"*|*"proname = 'fn_integracao_trava_modelos'"*|*"proname = 'integracao_salvar'"*|*"proname = '_integracao_ler'"*) [ $aplic = 1 ] && r t || r f ;;
  *"server_version_num"*|*"kanban_mover"*|*"_skus_calc_ref_tipo"*|*"extensions.hmac"*) r t ;;
  *"from pg_stat_activity"*) r 0 ;;
  *"relname = any(array['integracao_config'"*) [ $aplic = 1 ] && r 7 || r 0 ;;
  *"proname = any(array['_integracao_layout'"*) [ $aplic = 1 ] && r 46 || r 0 ;;
  *"string_agg(md5(pg_get_functiondef(p.oid)), '|' order by p.proname)"*) [ $aplic = 1 ] && r "$(cat "$SC/md5-redef-depois" 2>/dev/null)" || r "5baca24d0de45b8c5f291fef39472238|72c96c624de8f4530c862d8abb6a1283|47584858f55524d18d326dfff00139e6|01bd241680e24fdb665ca8ae81a6a1a3" ;;
  *"collate \"C\")) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any"*) r "$(cat "$SC/md5-novas-depois" 2>/dev/null)" ;;
  *"not (p.proname = any"*) r "fnpre|400" ;;
  *"has_function_privilege"*) r "0|0|17|3" ;;
  *"from pg_policy p join pg_class"*) r "0|7" ;;
  *"select (select count(*) from pg_proc p join pg_namespace"*) [ $aplic = 1 ] && r "541|290" || r "495|277" ;;
  *"FIDEL"*|*"BEGIN READ ONLY"*) r "funcoes:public.x()=1" ;;
  *"NOTIFY"*) exit 0 ;;
  *) exit 0 ;;
esac
FAKE
cat > "$SC/bin/docker" <<'FAKE'
#!/usr/bin/env bash
SC="${INTEG_PROVA_SC:?}"; echo "docker $*" | cut -c1-120 >> "$SC/chamadas.log"
case "$*" in
  ps*) echo supabase_db_banco-local ;;
  *pg_restore*) echo "; TABLE DATA public x"; echo "; TABLE DATA auth y" ;;
  *pg_dump*) cat > /dev/null; echo "DUMP-FALSO" ;;
esac
FAKE
chmod +x "$SC/bin/psql" "$SC/bin/docker"
# (1) URL de outro banco = PARE antes de qualquer psql
printf '%s\n' "postgresql://u:x@example.com:5432/postgres" > "$SC/dburl-errada.txt"
out=$(PATH="$SC/bin:$PATH" INTEG_DBURL_FILE="$SC/dburl-errada.txt" INTEG_DS="$SC/ds" INTEG_BF1="$SC/bf1" /bin/bash --noprofile --norc "$M/ida-producao.sh" 2>&1)
prova "URL de outro banco é recusada" 'printf "%s" "$out" | grep -q "não aponta p/ o banco sisTrama" && [ ! -s "$SC/chamadas.log" ]'
# (2) arquivo da URL com 2 linhas = PARE
printf '%s\n%s\n' "postgresql://postgres.ruinwcuabilumcspeyjk:x@invalid.pooler.supabase.com:5432/postgres" "extra" > "$SC/dburl-2l.txt"
out=$(PATH="$SC/bin:$PATH" INTEG_DBURL_FILE="$SC/dburl-2l.txt" INTEG_DS="$SC/ds" INTEG_BF1="$SC/bf1" /bin/bash --noprofile --norc "$M/ida-producao.sh" 2>&1)
prova "arquivo da URL com 2 linhas é recusado" 'printf "%s" "$out" | grep -q "exatamente 1 linha"'
# (3) frente JÁ aplicada = PARE antes do backup e do apply
printf '%s\n' "postgresql://postgres.ruinwcuabilumcspeyjk:x@invalid.pooler.supabase.com:5432/postgres" > "$SC/dburl.txt"
: > "$SC/chamadas.log"; touch "$SC/aplicado"
out=$(PATH="$SC/bin:$PATH" INTEG_DBURL_FILE="$SC/dburl.txt" INTEG_DS="$SC/ds" INTEG_BF1="$SC/bf1" /bin/bash --noprofile --norc "$M/ida-producao.sh" 2>&1)
prova "frente já no banco = PARE sem backup nem apply" 'printf "%s" "$out" | grep -q "JÁ no banco" && ! grep -q "pg_dump" "$SC/chamadas.log"'
rm -f "$SC/aplicado"
# (4) variável INTEG_* esquecida no Terminal (fora da prova) = PARE
out=$(env -u INTEG_PROVA_SC PATH="$SC/bin:$PATH" INTEG_DS="/tmp/x" /bin/bash --noprofile --norc "$M/ida-producao.sh" 2>&1)
prova "INTEG_* fora da prova = PARE" 'printf "%s" "$out" | grep -q "variável(is) INTEG_"'
# (5) volta sem a confirmação = PARE sem psql
: > "$SC/chamadas.log"
out=$(PATH="$SC/bin:$PATH" INTEG_DBURL_FILE="$SC/dburl.txt" /bin/bash --noprofile --norc "$M/volta-producao.sh" 2>&1)
prova "volta sem VOLTA_CONFIRMO = PARE" 'printf "%s" "$out" | grep -q "VOLTA_CONFIRMO=apagar-integracao" && [ ! -s "$SC/chamadas.log" ]'
echo "== PROVAS: $ok ok, $falhou falharam"
rm -rf "$SC"
[ "$falhou" = 0 ] && echo "== PROVAS OK"
```

Run: `bash .superpowers/integracao/mig/prova-scripts.sh 2>&1 | tee .superpowers/integracao/logs/prova-scripts.log`
Expected: `== PROVAS OK` (5 ok). `FALHOU (prova)` ⇒ corrigir o SCRIPT (nunca a prova) e registrar em `desvios.md`.

- [ ] **Step 8: `RODAR-integracao.md` (roteiro do dono) + G-scripts**

```bash
D="/Users/sunglee/PLM + Criação/savepoints/pre-apply-integracao"; mkdir -p "$D" && chmod 700 "$D"
cat > "$D/RODAR-integracao.md" <<'RODAR'
# RODAR — Integração + API (6 migrations 20261007100000..150000) em PRODUÇÃO

**Quando:** horário calmo (sem ninguém salvando). **Onde:** Terminal NOVO (sem variáveis de outras frentes). **Quem:** você (dono).
O script faz ANTES o backup completo (public + auth) nesta pasta — o plano do Supabase não tem PITR.

**Efeito já na IDA, no app que está no ar (P-88 A):** a partir da ida, o nome (e a REF, enquanto o card não foi enviado à
Explosão) de produtos de revenda/importado passa a valer nos DOIS sentidos — renomear no Sheet do Planejamento muda também na
tela Produto Acabado/Importado e vice-versa —, antes mesmo do deploy da tela Integração. Sem interruptor. Também já na ida
(V2): salvar o Produto Acabado/Importado deixa de recolocar a foto dele como capa do card a cada save — a foto só vai para o
card quando MUDA (ou quando o card é vinculado); reordenar/remover a foto no Sheet deixa de ser desfeito pelo save do PA/PI.
O resto da Integração (tela, API, travas) só aparece depois do deploy.

## Passo 1 — conferir que é a worktree certa
    cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/integracao-impl" && git log --oneline -1 && ls .superpowers/integracao/mig/aplica.sh

## Passo 2 — IDA (uma linha só)
    cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/integracao-impl" && /bin/bash --noprofile --norc .superpowers/integracao/mig/ida-producao.sh 2>&1 | tee -a .superpowers/integracao/logs/prod-ida.log
Esperado no fim: `== IDA OK …`. Qualquer PARE/FALHOU/NÃO CONCLUÍDA: NÃO repita — cole o log no chat.

## Passo 3 — referência da volta de emergência da F1 (uma linha só; só leitura)
    cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/integracao-impl" && /bin/bash --noprofile --norc .superpowers/integracao/mig/ref-volta-f1.sh 2>&1 | tee -a .superpowers/integracao/logs/prod-ref-volta-f1.log
Esperado: `OK (referência nova p/ a volta da F1): …`.

## Passo 4 — avisar no chat "IDA OK + ref OK" (o controlador junta a tela, aplica na cópia e faz a QA no :5188)

## Emergência — desfazer (SÓ com o controlador; APAGA config, chaves, acessos, log e espelho da integração)
    cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/integracao-impl" && VOLTA_CONFIRMO=apagar-integracao /bin/bash --noprofile --norc .superpowers/integracao/mig/volta-producao.sh 2>&1 | tee -a .superpowers/integracao/logs/prod-volta.log
RODAR
chmod 600 "$D/RODAR-integracao.md"
```

G-scripts: Opus + guardião recebem os scripts (`aplica.sh` gerado, `extra.sh`, `ida/volta/ref-volta-f1/copia/prova`), o
`ensaio.log`, `ensaio-tempos.txt`, `prova-scripts.log` e o RODAR. Checklist: guardas antes de qualquer `psql` (URL ancorada,
1 linha, `INTEG_*` proibidas), pré-voo só leitura, backup ANTES do apply, cópia da volta ANTES do apply, apply com
`lock_timeout`/`transaction_timeout` e nova tentativa só em 55P03/40P01/25P04, estado REAL relido em erro (inclusive "pela
metade"), conferências por DELTA (+46|+13), ACL, md5 congelado = ensaiado = disco, volta LIFO com confirmação explícita, prova
sem conexão real. **BLOQUEIA ⇒ parar.** Depois: publicar no painel a pergunta ao dono (P-xx) com o resumo do ensaio, as
decisões D1–D39 marcadas pelo guardião (a lista COMPLETA — R6), o resultado da Task 20b (rota real + CPU; D38) e o RODAR — o
RODAR só vai ao dono DEPOIS da Task 20b verde; só com o "sim" do dono ele roda os Passos 2–3. O controlador registra os
logs do dono no diário do guardião (**G-produção**).

---

# FASE 2 — Tela

> A tela é construída na worktree logo depois da Task 7 (em série com a Task 8), mas só é JUNTADA na linha principal depois do
> "== IDA OK" do dono (Task 25): ela chama RPCs novas e o `:5173` do dono grava em produção.

### Task 9: Catálogo dos campos, mensagens de erro, permissão/menu, rota e abas por papel

**Files:**
- Create: `src/lib/integracao/campos.ts`
- Modify: `src/lib/erro-mensagem.ts` (após `if (code === "P0001" && msg) return msg;`; e a lista `MENSAGENS_42501_PROPRIAS`)
- Modify: `src/lib/permissions-catalog.ts` (novo `ModuleDef` no FIM de `PAGES_CATALOG`)
- Modify: `src/lib/nav.ts` (`MODULE_META.integracao`)
- Modify: `src/routes/_authenticated/admin/lojas.tsx:58` (`MODULE_TOGGLES` exclui `integracao`) e o diálogo de Reset (aviso D26)
- Modify: `src/components/app-sidebar.tsx` (item "Integração" no grupo Admin Mestre; import `Plug`)
- Create: `src/lib/integracao/abas.ts` (abas por papel — PURO, testável sem montar a tela)
- Create: `src/routes/_authenticated/integracao.tsx`, `src/components/integracao/IntegracaoPage.tsx`
- Modify: `src/routeTree.gen.ts` (regerado pelo build — commitar com `ROTA_NOVA=1`)
- Test: `tests/unit/integracao-campos.test.ts`, `tests/unit/erro-mensagem-integracao.test.ts`, `tests/unit/integracao-tela-fonte.test.ts`

**Interfaces:**
- Produces (`campos.ts`): `type CampoKey`, `type ColunaEditavel`, `type GateKey`, `type TipoCampo`, `type CampoDef`,
  `CAMPOS: readonly CampoDef[]` (18, ordem fixa), `CAMPO_BY_KEY: Map<CampoKey, CampoDef>`, `LAYOUT_KEYS`, `CAMPOS_PADRAO`
  (17), `ordenarCampos(keys: string[]): CampoKey[]`, `rotuloDoCampoTravado(campo: string): string`, `infoCusto(origem: string):
  string`, `type ChaveConfigApi`, `CONFIG_API: Record<ChaveConfigApi, {rotulo; rotuloCurto; recomendado; min; max; unidade}>`,
  `validarConfigApi(v): { erros: Partial<Record<ChaveConfigApi, string>>; foraRecomendado: ChaveConfigApi[] }`,
  `PAGINA_MAX_PLANO_GRATUITO = 100`, `TEXTO_ALERTA_PAGINA_PLANO_GRATUITO`, `alertaPaginaPlanoGratuito(n): string | null`
  (P-89 A), `TEXTO_ALERTA_INTEGRAR`, `TEXTO_ALERTA_LAYOUT`, `TEXTO_MAO_DUPLA`.
- Produces (`abas.ts`): `type Aba = "produtos" | "campos" | "api" | "manual" | "log"`, `abasVisiveis(superAdmin: boolean):
  Aba[]`, `ROTULO_ABA: Record<Aba, string>`.
- Produces (`IntegracaoPage.tsx`): `export function IntegracaoPage()` e o mapa `CONTEUDO_ABA: Record<Aba, ComponentType>`
  que as Tasks 12b (produtos), 14 (campos), 15 (api), 16 (manual) e 17 (log) preenchem (até lá cada aba mostra
  `AbaPendente`).

- [ ] **Step 1: Escrever os testes (falham: arquivos ausentes)**

`tests/unit/integracao-campos.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  CAMPOS, CAMPOS_PADRAO, CAMPO_BY_KEY, CONFIG_API, LAYOUT_KEYS, TEXTO_ALERTA_INTEGRAR, TEXTO_ALERTA_PAGINA_PLANO_GRATUITO,
  alertaPaginaPlanoGratuito, infoCusto, ordenarCampos, rotuloDoCampoTravado, validarConfigApi,
} from "@/lib/integracao/campos";

const SQL1 = readFileSync("supabase/migrations/20261007100000_integracao_1_tabelas.sql", "utf8");
const SQL2 = readFileSync("supabase/migrations/20261007110000_integracao_2_retrato.sql", "utf8");

describe("integracao/campos — catálogo × SQL (anti-drift)", () => {
  it("as 18 chaves na MESMA ordem do _integracao_layout() da migration 1", () => {
    const arr = SQL1.match(/SELECT ARRAY\[([\s\S]*?)\]::text\[\]/)![1];
    const sql = [...arr.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(LAYOUT_KEYS).toEqual(sql);
    expect(CAMPOS_PADRAO).toEqual(sql.slice(0, 17));
  });
  it("os rótulos = _integracao_rotulos() da migration 2", () => {
    const ini = SQL2.indexOf("FUNCTION public._integracao_rotulos()");
    expect(ini).toBeGreaterThan(-1);
    const bloco = SQL2.slice(ini, SQL2.indexOf("$function$;", ini));
    const pares = Object.fromEntries([...bloco.matchAll(/'([a-z_]+)', '([^']+)'/g)].map((m) => [m[1], m[2]]));
    for (const c of CAMPOS) expect(pares[c.key], c.key).toBe(c.rotulo);
  });
});

describe("integracao/campos — regras", () => {
  it("Foto fora do layout (P-83 A); cor/tamanho só variante; custo/cor/tamanho só leitura (P-80 A)", () => {
    expect(CAMPO_BY_KEY.get("foto")!.layout).toBe(false);
    expect(CAMPOS.filter((c) => c.soVariante).map((c) => c.key)).toEqual(["cor_base", "cor_apelido", "tamanho"]);
    expect(CAMPOS.filter((c) => c.tipo === "somente_leitura").map((c) => c.key)).toEqual(["preco_custo", "cor_base", "cor_apelido", "tamanho"]);
    expect(CAMPO_BY_KEY.get("metatag")!.coluna).toBe("descricao_produto"); // Metatag = Descrição
  });
  it("ordenarCampos: ordem fixa, descarta desconhecidos", () => {
    expect(ordenarCampos(["foto", "xyz", "nome", "ncm"])).toEqual(["nome", "ncm", "foto"]);
  });
  it("rótulo do campo travado (mensagem do banco)", () => {
    expect(rotuloDoCampoTravado("peso")).toBe("Peso");
    expect(rotuloDoCampoTravado("tamanho_tipo")).toBe("Tamanho em");
    expect(rotuloDoCampoTravado("sku")).toBe("SKUs");
    expect(rotuloDoCampoTravado("variantes")).toBe("cores/variantes");
  });
  it("info do custo por origem", () => {
    expect(infoCusto("interno")).toBe("Só leitura — soma da ficha: tecido + aviamentos + insumos + mão de obra.");
    expect(infoCusto("revenda")).toBe("Só leitura — revenda: valor da OC (bruto − desconto) + insumos.");
  });
  it("configurações da API: faixa = erro; fora do recomendado = alerta (não erro)", () => {
    expect(CONFIG_API.limite_por_minuto).toMatchObject({ recomendado: 60, min: 1, max: 600 });
    expect(CONFIG_API.max_por_pagina).toMatchObject({ recomendado: 50, min: 1, max: 500 }); // P-89 A: faixa do banco segue 1–500
    const a = validarConfigApi({ limite_por_minuto: 300, max_por_pagina: 200, validade_foto_dias: 7, bloqueio_tentativas: 150 });
    expect(a.erros.bloqueio_tentativas).toBe("Bloqueio de IP: 150 está fora da faixa permitida (3–100). Corrija para salvar.");
    // (fora da faixa é ERRO, não "fora do recomendado" — corrigido o esperado do plano b0c22294)
    expect(a.foraRecomendado).toEqual(["limite_por_minuto", "max_por_pagina"]);
    expect(validarConfigApi({ limite_por_minuto: 60, max_por_pagina: 50, validade_foto_dias: 7, bloqueio_tentativas: 10 }))
      .toEqual({ erros: {}, foraRecomendado: [] });
  });
  it("P-89 A: acima de 100 por página, alerta do plano gratuito (além do 'fora do recomendado')", () => {
    expect(alertaPaginaPlanoGratuito(100)).toBeNull();
    expect(alertaPaginaPlanoGratuito(101)).toBe(TEXTO_ALERTA_PAGINA_PLANO_GRATUITO);
    expect(TEXTO_ALERTA_PAGINA_PLANO_GRATUITO).toBe(
      "Acima de 100 pode passar do limite de processamento do plano gratuito do Cloudflare (10 ms por consulta). Só use com o plano pago (Workers Paid).");
  });
  it("texto do alerta do dono, verbatim", () => {
    expect(TEXTO_ALERTA_INTEGRAR).toBe("Você tem certeza? Se estiver errado, você poderá ser demitido");
  });
});
```

`tests/unit/erro-mensagem-integracao.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mensagemErro } from "@/lib/erro-mensagem";

describe("mensagemErro — recusas da Integração (traduz pelo code + prefixo ASCII)", () => {
  it("trava de campo", () => {
    expect(mensagemErro({ code: "42501", message: "integracao_travado: nome" })).toBe(
      'Produto travado pela Integração (integrável ou integrado): "Nome" não pode mudar. Volte para não integrável na tela Integração (ou, se já integrado, peça ao super admin para desfazer).');
    expect(mensagemErro({ code: "42501", message: "integracao_travado: tamanho_tipo" })).toMatch(/"Tamanho em" não pode mudar/);
  });
  it("trava de exclusão", () => {
    expect(mensagemErro({ code: "42501", message: "integracao_travado: excluir" })).toBe(
      "Produto travado pela Integração (integrável ou integrado). Volte para não integrável na tela Integração antes de excluir.");
  });
  it("permissão de campo, custo, conflitos", () => {
    expect(mensagemErro({ code: "42501", message: "integracao_sem_permissao: preco_venda" }))
      .toBe("Você não tem permissão para editar este campo (mesma regra do card do produto).");
    expect(mensagemErro({ code: "42501", message: "integracao_sem_custo: x" })).toBe('Com "Preço de custo" marcado, só integra quem pode ver custos.');
    expect(mensagemErro({ code: "P0409", message: "integracao_mudou: produto x mudou desde o resumo" }))
      .toBe("O produto mudou desde o resumo (outra pessoa editou, integrou ou voltou). Confira o resumo novo e confirme de novo.");
    expect(mensagemErro({ code: "P0409", message: "keywords_mudou: as keywords da loja mudaram" }))
      .toBe("Outra pessoa mudou as Keywords da loja enquanto você editava. O texto foi recarregado — confira e salve de novo.");
    expect(mensagemErro({ code: "P0409", message: "conflito_versao: o produto foi salvo por outra pessoa" })).toMatch(/Outra pessoa salvou/);
  });
  it("42501 próprios da Integração mostram o motivo real", () => {
    expect(mensagemErro({ code: "42501", message: "Só o super admin pode fazer isto." })).toBe("Só o super admin pode fazer isto.");
    expect(mensagemErro({ code: "42501", message: "Sem permissão para editar a Integração." })).toBe("Sem permissão para editar a Integração.");
  });
});
```

`tests/unit/integracao-tela-fonte.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { PAGES_CATALOG } from "@/lib/permissions-catalog";
import { abasVisiveis } from "@/lib/integracao/abas";

const ler = (p: string) => readFileSync(p, "utf8");

describe("Integração — permissão, menu e abas por papel (P-65 A, P-74 A, P-81 A, v4)", () => {
  it("ModuleDef próprio 'integracao' no FIM do catálogo, página única (link direto)", () => {
    const ult = PAGES_CATALOG[PAGES_CATALOG.length - 1];
    expect(ult).toMatchObject({ module: "integracao", label: "Integração", basePath: "/integracao" });
    expect(ult.pages.map((p) => p.key)).toEqual(["integracao"]);
  });
  it("fora dos interruptores de contratação (como o importar — nota 12)", () => {
    expect(ler("src/routes/_authenticated/admin/lojas.tsx")).toMatch(/key === "importar" \|\| key === "integracao"/);
  });
  it("D26 (opção A): o diálogo de Reset avisa que apaga a Integração da loja", () => {
    expect(ler("src/routes/_authenticated/admin/lojas.tsx")).toMatch(/Apaga também a Integração da loja/);
  });
  it("super admin tem o item também no Admin Mestre", () => {
    const s = ler("src/components/app-sidebar.tsx");
    const i = s.indexOf("Admin Mestre");
    expect(s.indexOf('to="/integracao"', i)).toBeGreaterThan(i);
  });
  it("abas: super admin vê as 5; admin/permissão só Produtos e Log", () => {
    expect(abasVisiveis(true)).toEqual(["produtos", "campos", "api", "manual", "log"]);
    expect(abasVisiveis(false)).toEqual(["produtos", "log"]);
  });
  it("rota protegida pela permissão 'integracao'", () => {
    expect(ler("src/routes/_authenticated/integracao.tsx")).toMatch(/<RequirePermission page="integracao">/);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres
npx vitest run --no-file-parallelism tests/unit/integracao-campos.test.ts tests/unit/erro-mensagem-integracao.test.ts tests/unit/integracao-tela-fonte.test.ts
```
Expected: FAIL — `Failed to resolve import "@/lib/integracao/campos"` (e `@/lib/integracao/abas`).

- [ ] **Step 3: `src/lib/integracao/campos.ts`**

```ts
// Integração + API — catálogo dos 18 campos da API (ordem FIXA do layout do pedido — P-60 B) e das configurações da API.
// Fonte do banco: _integracao_layout() (migration 1) e _integracao_rotulos() (migration 2); o teste anti-drift compara os dois.
// "coluna" = onde o CARD grava o campo (mão dupla — a tela nunca tem cópia própria); "gate" = a regra do card (servidor:
// _integracao_gates — D24). Custo, cor base, cor apelido e tamanho = só leitura com "i" + "abrir card" (P-80 A).
export type CampoKey =
  | "nome" | "ref_sku" | "preco_anterior" | "preco_venda" | "peso" | "ncm" | "preco_custo" | "cor_base" | "cor_apelido"
  | "tamanho" | "titulo" | "descricao" | "keywords" | "metatag" | "comprimento" | "largura" | "altura" | "foto";
export type ColunaEditavel =
  | "nome" | "ref" | "preco_anterior" | "preco_venda" | "peso_kg" | "ncm" | "titulo_pagina" | "descricao_produto"
  | "comprimento_cm" | "largura_cm" | "altura_cm" | "fotos_modelo";
export type GateKey = "compartilhado" | "planejamento" | "preco" | "ref" | "sku" | "keywords";
export type TipoCampo = "texto" | "texto_longo" | "dinheiro" | "peso" | "medida" | "fotos" | "keywords" | "somente_leitura";
export type CampoDef = {
  key: CampoKey; rotulo: string; rotuloCurto: string; layout: boolean; soVariante: boolean; tipo: TipoCampo;
  coluna: ColunaEditavel | null; gate: GateKey | null; info?: string;
};

const INFO_COR = "Só leitura — vem da cor do tecido/variante, usada por outros produtos.";
export const CAMPOS: readonly CampoDef[] = [
  { key: "nome", rotulo: "Nome", rotuloCurto: "Nome", layout: true, soVariante: false, tipo: "texto", coluna: "nome", gate: "compartilhado" },
  { key: "ref_sku", rotulo: "REF / SKU", rotuloCurto: "REF / SKU", layout: true, soVariante: false, tipo: "texto", coluna: "ref", gate: "ref" },
  { key: "preco_anterior", rotulo: "Preço anterior", rotuloCurto: "Preço anterior", layout: true, soVariante: false, tipo: "dinheiro", coluna: "preco_anterior", gate: "preco" },
  { key: "preco_venda", rotulo: "Preço de venda", rotuloCurto: "Preço de venda", layout: true, soVariante: false, tipo: "dinheiro", coluna: "preco_venda", gate: "preco" },
  { key: "peso", rotulo: "Peso", rotuloCurto: "Peso", layout: true, soVariante: false, tipo: "peso", coluna: "peso_kg", gate: "planejamento" },
  { key: "ncm", rotulo: "NCM", rotuloCurto: "NCM", layout: true, soVariante: false, tipo: "texto", coluna: "ncm", gate: "planejamento" },
  { key: "preco_custo", rotulo: "Preço de custo", rotuloCurto: "Preço de custo", layout: true, soVariante: false, tipo: "somente_leitura", coluna: null, gate: null },
  { key: "cor_base", rotulo: "Cor base", rotuloCurto: "Cor base", layout: true, soVariante: true, tipo: "somente_leitura", coluna: null, gate: null, info: INFO_COR },
  { key: "cor_apelido", rotulo: "Cor apelido", rotuloCurto: "Cor apelido", layout: true, soVariante: true, tipo: "somente_leitura", coluna: null, gate: null, info: INFO_COR },
  { key: "tamanho", rotulo: "Tamanho", rotuloCurto: "Tamanho", layout: true, soVariante: true, tipo: "somente_leitura", coluna: null, gate: null, info: "Só leitura — vem da grade." },
  { key: "titulo", rotulo: "Título para a página", rotuloCurto: "Título", layout: true, soVariante: false, tipo: "texto", coluna: "titulo_pagina", gate: "planejamento" },
  { key: "descricao", rotulo: "Descrição", rotuloCurto: "Descrição", layout: true, soVariante: false, tipo: "texto_longo", coluna: "descricao_produto", gate: "compartilhado" },
  { key: "keywords", rotulo: "Keywords", rotuloCurto: "Keywords", layout: true, soVariante: false, tipo: "keywords", coluna: null, gate: "keywords" },
  { key: "metatag", rotulo: "Metatag Description", rotuloCurto: "Metatag Description", layout: true, soVariante: false, tipo: "texto_longo", coluna: "descricao_produto", gate: "compartilhado", info: "= Descrição (é o mesmo texto)." },
  { key: "comprimento", rotulo: "Comprimento", rotuloCurto: "Compr.", layout: true, soVariante: false, tipo: "medida", coluna: "comprimento_cm", gate: "planejamento" },
  { key: "largura", rotulo: "Largura", rotuloCurto: "Larg.", layout: true, soVariante: false, tipo: "medida", coluna: "largura_cm", gate: "planejamento" },
  { key: "altura", rotulo: "Altura", rotuloCurto: "Alt.", layout: true, soVariante: false, tipo: "medida", coluna: "altura_cm", gate: "planejamento" },
  { key: "foto", rotulo: "Foto", rotuloCurto: "Foto", layout: false, soVariante: false, tipo: "fotos", coluna: "fotos_modelo", gate: "compartilhado" },
];
export const CAMPO_BY_KEY: Map<CampoKey, CampoDef> = new Map(CAMPOS.map((c) => [c.key, c]));
export const LAYOUT_KEYS: CampoKey[] = CAMPOS.map((c) => c.key);
export const CAMPOS_PADRAO: CampoKey[] = CAMPOS.filter((c) => c.layout).map((c) => c.key);
export function ordenarCampos(keys: readonly string[]): CampoKey[] {
  const set = new Set(keys);
  return LAYOUT_KEYS.filter((k) => set.has(k));
}
const EXTRA_TRAVA: Record<string, string> = {
  tamanho_tipo: "Tamanho em", sku: "SKUs", variantes: "cores/variantes", vinculo: "vínculo do produto", produto: "produto",
};
export function rotuloDoCampoTravado(campo: string): string {
  return EXTRA_TRAVA[campo] ?? CAMPO_BY_KEY.get(campo as CampoKey)?.rotulo ?? campo;
}
export function infoCusto(origem: string): string {
  if (origem === "revenda") return "Só leitura — revenda: valor da OC (bruto − desconto) + insumos.";
  if (origem === "importado") return "Só leitura — importado: custo de chegada (câmbio + frete) + insumos.";
  return "Só leitura — soma da ficha: tecido + aviamentos + insumos + mão de obra.";
}

export type ChaveConfigApi = "limite_por_minuto" | "max_por_pagina" | "validade_foto_dias" | "bloqueio_tentativas";
export const CONFIG_API: Record<ChaveConfigApi, { rotulo: string; rotuloCurto: string; recomendado: number; min: number; max: number; unidade: string }> = {
  limite_por_minuto: { rotulo: "Limite de consultas por minuto, por chave", rotuloCurto: "Limite por minuto", recomendado: 60, min: 1, max: 600, unidade: "consultas/min" },
  max_por_pagina: { rotulo: "Máximo de produtos por página", rotuloCurto: "Máximo por página", recomendado: 50, min: 1, max: 500, unidade: "produtos" },
  validade_foto_dias: { rotulo: "Validade dos links das fotos (dias)", rotuloCurto: "Validade das fotos", recomendado: 7, min: 1, max: 30, unidade: "dias" },
  bloqueio_tentativas: { rotulo: "Bloqueio de IP após N chaves erradas em 10 min", rotuloCurto: "Bloqueio de IP", recomendado: 10, min: 3, max: 100, unidade: "tentativas" },
};
export const CHAVES_CONFIG_API = Object.keys(CONFIG_API) as ChaveConfigApi[];
export function validarConfigApi(v: Record<ChaveConfigApi, number>): { erros: Partial<Record<ChaveConfigApi, string>>; foraRecomendado: ChaveConfigApi[] } {
  const erros: Partial<Record<ChaveConfigApi, string>> = {};
  const foraRecomendado: ChaveConfigApi[] = [];
  for (const k of CHAVES_CONFIG_API) {
    const c = CONFIG_API[k];
    const n = v[k];
    if (!Number.isInteger(n) || n < c.min || n > c.max) {
      erros[k] = `${c.rotuloCurto}: ${Number.isFinite(n) ? n : "valor"} está fora da faixa permitida (${c.min}–${c.max}). Corrija para salvar.`;
    } else if (n !== c.recomendado) {
      foraRecomendado.push(k);
    }
  }
  return { erros, foraRecomendado };
}
// P-89 A (dono 27/set): plano GRATUITO do Cloudflare = 10 ms de CPU por consulta. Padrão/recomendado 50; a faixa segue 1–500
// (aumentar depois = mudar aqui na aba API, sem migration nem deploy); ACIMA de 100, alerta próprio além do "fora do recomendado".
export const PAGINA_MAX_PLANO_GRATUITO = 100;
export const TEXTO_ALERTA_PAGINA_PLANO_GRATUITO =
  "Acima de 100 pode passar do limite de processamento do plano gratuito do Cloudflare (10 ms por consulta). Só use com o plano pago (Workers Paid).";
export function alertaPaginaPlanoGratuito(maxPorPagina: number): string | null {
  return Number.isInteger(maxPorPagina) && maxPorPagina > PAGINA_MAX_PLANO_GRATUITO ? TEXTO_ALERTA_PAGINA_PLANO_GRATUITO : null;
}
export const TEXTO_ALERTA_INTEGRAR = "Você tem certeza? Se estiver errado, você poderá ser demitido";
export const TEXTO_ALERTA_LAYOUT =
  "Este campo faz parte do layout obrigatório da API. Se ele sair, o programa do dev pode deixar de funcionar. Tem certeza?";
export const TEXTO_MAO_DUPLA =
  "Os campos editados aqui são os MESMOS do card do produto — mudou aqui, muda lá (e vice-versa), enquanto não estiver integrável.";
```

- [ ] **Step 4: `src/lib/erro-mensagem.ts` — tradução das recusas (arquivo COMPARTILHADO; vale também p/ o Sheet do Dev)**

Acrescentar o import no topo, os 4 textos em `MENSAGENS_42501_PROPRIAS`, a função `mensagemIntegracao` e a chamada logo
depois de `if (code === "P0001" && msg) return msg;`:

```ts
import { rotuloDoCampoTravado } from "@/lib/integracao/campos";
```
```ts
const MENSAGENS_42501_PROPRIAS = new Set([
  "Apenas o administrador da loja pode ver a prévia do Kanban automático.",
  "Apenas o administrador da loja pode ligar ou desligar o Kanban automático.",
  "Apenas o administrador da loja pode restaurar as colunas do Kanban.",
  "Sem permissão para mover cards do Desenvolvimento.",
  // Integração + API (motivo real, não o genérico)
  "Sem permissão para ver a Integração.",
  "Sem permissão para editar a Integração.",
  "Só o super admin pode fazer isto.",
  "Loja inativa ou sem loja — operação não permitida.",
]);

// Integração + API: as recusas do banco chegam em ASCII com prefixo (lição P-58/P-59 — 5xx só ASCII); a tela traduz aqui.
function mensagemIntegracao(code: string, msg: string): string | null {
  if (code === "42501" && msg.startsWith("integracao_travado:")) {
    const campo = msg.slice("integracao_travado:".length).trim();
    if (campo === "excluir") {
      return "Produto travado pela Integração (integrável ou integrado). Volte para não integrável na tela Integração antes de excluir.";
    }
    return `Produto travado pela Integração (integrável ou integrado): "${rotuloDoCampoTravado(campo)}" não pode mudar. Volte para não integrável na tela Integração (ou, se já integrado, peça ao super admin para desfazer).`;
  }
  if (code === "42501" && msg.startsWith("integracao_sem_permissao:")) {
    return "Você não tem permissão para editar este campo (mesma regra do card do produto).";
  }
  if (code === "42501" && msg.startsWith("integracao_sem_custo:")) return 'Com "Preço de custo" marcado, só integra quem pode ver custos.';
  if (code === "P0409" && msg.startsWith("integracao_mudou:")) {
    return "O produto mudou desde o resumo (outra pessoa editou, integrou ou voltou). Confira o resumo novo e confirme de novo.";
  }
  if (code === "P0409" && msg.startsWith("keywords_mudou:")) {
    return "Outra pessoa mudou as Keywords da loja enquanto você editava. O texto foi recarregado — confira e salve de novo.";
  }
  return null;
}
```
e, em `mensagemErro`, logo após a linha do P0001:
```ts
  const integracao = mensagemIntegracao(code, msg);
  if (integracao) return integracao;
```

- [ ] **Step 5: Permissão, menu e toggles**

`src/lib/permissions-catalog.ts` — acrescentar como ÚLTIMO item de `PAGES_CATALOG` (depois do `dashboard`):

```ts
  {
    // Integração + API (set/2026, P-65 A): página única, link direto no menu da loja (sem hub); NÃO é módulo contratável —
    // fica fora dos interruptores de Gerenciar Lojas (como o `importar`) e `tenant_module_enabled('integracao')` = ligado.
    // Super admin também a vê em "Admin Mestre" (app-sidebar). Editar = integrar/voltar/editar campos (o servidor confere).
    module: "integracao",
    label: "Integração",
    basePath: "/integracao",
    pages: [
      { key: "integracao", label: "Integração", description: "Organiza os produtos que o programa externo (ERP/e-commerce) lê pela API.", modes: ["full"] },
    ],
  },
```

`src/lib/nav.ts` — no `import` do lucide acrescentar `Plug`, e em `MODULE_META`:
```ts
  integracao: { title: "Integração", icon: Plug },
```

`src/routes/_authenticated/admin/lojas.tsx:58` — trocar
```ts
    if (key === "importar") continue;
```
por
```ts
    if (key === "importar" || key === "integracao") continue; // infra/tela, não módulo contratável (nota 12 do G-plano)
```

e, no diálogo de Reset do mesmo arquivo (D26, opção A — o `reset_loja` apaga a integração da loja), trocar
```tsx
              recria as categorias fixas (Corte/Oficina) e os 12 meses.
              <strong> Não pode ser desfeito.</strong> Para confirmar, digite o nome da loja:
```
por
```tsx
              recria as categorias fixas (Corte/Oficina) e os 12 meses. Apaga também a Integração da loja (Campos da API
              voltam ao padrão; chaves, acessos e log somem — o ERP perde o acesso).
              <strong> Não pode ser desfeito.</strong> Para confirmar, digite o nome da loja:
```

`src/components/app-sidebar.tsx` — acrescentar `Plug,` ao `import { … } from "lucide-react"` e, dentro do grupo "Admin Mestre",
logo depois do item "Gerenciar Usuários":
```tsx
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={isActive("/integracao")} tooltip="Integração">
                    <Link to="/integracao">
                      <Plug className="h-4 w-4" />
                      <span>Integração</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
```

- [ ] **Step 6: Rota e casca da página com as abas por papel**

`src/lib/integracao/abas.ts`:

```ts
// Integração + API — abas por papel (v4, dono 26/set 20h4x): Produtos e Log = admin da loja + permissão "Integração";
// Campos da API, API e Manual da API = SÓ super admin (as abas nem aparecem; o servidor recusa as RPCs delas).
export type Aba = "produtos" | "campos" | "api" | "manual" | "log";
export const ROTULO_ABA: Record<Aba, string> = {
  produtos: "Produtos", campos: "Campos da API", api: "API", manual: "Manual da API", log: "Log",
};
export function abasVisiveis(superAdmin: boolean): Aba[] {
  return superAdmin ? ["produtos", "campos", "api", "manual", "log"] : ["produtos", "log"];
}
```

`src/routes/_authenticated/integracao.tsx`:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { RequirePermission } from "@/components/RequirePermission";
import { IntegracaoPage } from "@/components/integracao/IntegracaoPage";

export const Route = createFileRoute("/_authenticated/integracao")({
  component: () => (
    <RequirePermission page="integracao">
      <IntegracaoPage />
    </RequirePermission>
  ),
});
```

`src/components/integracao/IntegracaoPage.tsx`:

```tsx
// Integração + API — tela (spec §6). Abas por papel: src/lib/integracao/abas.ts.
import { useState, type ComponentType } from "react";
import { Construction } from "lucide-react";
import { Breadcrumb } from "@/components/shared/Breadcrumb";
import { EmptyState } from "@/components/shared/EmptyState";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/useAuth";
import { ROTULO_ABA, abasVisiveis, type Aba } from "@/lib/integracao/abas";

function AbaPendente() {
  return <EmptyState icon={Construction} title="Em construção" description="Esta aba chega nas próximas tasks do plano da Integração." />;
}
// Cada task da tela troca a sua entrada (Tasks 12b, 14, 15, 16 e 17).
const CONTEUDO_ABA: Record<Aba, ComponentType> = {
  produtos: AbaPendente,
  campos: AbaPendente,
  api: AbaPendente,
  manual: AbaPendente,
  log: AbaPendente,
};

export function IntegracaoPage() {
  const { isSuperAdmin } = useAuth();
  const abas = abasVisiveis(isSuperAdmin);
  const [aba, setAba] = useState<Aba>("produtos");
  const atual = abas.includes(aba) ? aba : "produtos";
  return (
    <div className="space-y-4 p-4 pb-24 md:p-6">
      <Breadcrumb items={[{ label: "Sistema" }, { label: "Integração" }]} />
      <h1 className="font-display text-2xl font-semibold">Integração</h1>
      <Tabs value={atual} onValueChange={(v) => setAba(v as Aba)}>
        <TabsList className="max-w-full overflow-x-auto">
          {abas.map((a) => (
            <TabsTrigger key={a} value={a}>{ROTULO_ABA[a]}</TabsTrigger>
          ))}
        </TabsList>
        {abas.map((a) => {
          const C = CONTEUDO_ABA[a];
          return (
            <TabsContent key={a} value={a} className="mt-4">
              <C />
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}
```

- [ ] **Step 7: Rodar os testes (PASS), gates com o routeTree novo e commit**

```bash
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres
npx vitest run --no-file-parallelism tests/unit/integracao-campos.test.ts tests/unit/erro-mensagem-integracao.test.ts \
  tests/unit/integracao-tela-fonte.test.ts tests/unit/erro-mensagem.test.ts
ROTA_NOVA=1 bash .superpowers/integracao/gates.sh
git diff --stat -- src/routeTree.gen.ts          # só a rota /_authenticated/integracao entra
git add -- src/lib/integracao/campos.ts src/lib/integracao/abas.ts src/lib/erro-mensagem.ts src/lib/permissions-catalog.ts src/lib/nav.ts \
  src/routes/_authenticated/admin/lojas.tsx src/components/app-sidebar.tsx src/routes/_authenticated/integracao.tsx \
  src/components/integracao/IntegracaoPage.tsx src/routeTree.gen.ts tests/unit/integracao-campos.test.ts \
  tests/unit/erro-mensagem-integracao.test.ts tests/unit/integracao-tela-fonte.test.ts
git commit --only -m "feat(integracao): catálogo dos campos, mensagens da trava, permissão/menu (Admin Mestre) e casca da tela com abas por papel

Co-Authored-By: Claude <modelo real> <noreply@anthropic.com>" -- src/lib/integracao/campos.ts src/lib/integracao/abas.ts \
  src/lib/erro-mensagem.ts src/lib/permissions-catalog.ts src/lib/nav.ts src/routes/_authenticated/admin/lojas.tsx src/components/app-sidebar.tsx \
  src/routes/_authenticated/integracao.tsx src/components/integracao/IntegracaoPage.tsx src/routeTree.gen.ts \
  tests/unit/integracao-campos.test.ts tests/unit/erro-mensagem-integracao.test.ts tests/unit/integracao-tela-fonte.test.ts
git show --stat HEAD | tail -n +7
```
Expected: PASS (campos 9 · erro 4 · fonte 6 + a suíte antiga de erro-mensagem intacta); `GATES INTEGRACAO: ok`.

---

### Task 10: Leitura da lista e rascunho por produto (puros): `produtos.ts` + `rascunho.ts`

**Files:**
- Create: `src/lib/integracao/produtos.ts`, `src/lib/integracao/rascunho.ts`
- Test: `tests/unit/integracao-produtos.test.ts`, `tests/unit/integracao-rascunho.test.ts`

**Interfaces:**
- Consumes: Task 9 (`CampoKey`, `GateKey`, `ColunaEditavel`, `CAMPO_BY_KEY`, `ordenarCampos`); contrato de `integracao_listar`
  (Task 2: `{pagina, por_pagina, total, contagens, campos, rotulos, opcoes{colecoes, etapas[{key,label}]}, pode{editar,
  ver_custos, super, keywords}, keywords, produtos[{modelo_id, origem, colecao, etapa, estado, marcado_em, integrado_em, rev,
  raw{…12 colunas + tamanho_tipo}, vivo, faltas[{campo,texto}], completo, sublinhas[meta], retrato, retrato_difere, gates}]}`);
  `mergeDraft`/`igual`/`Conflito` (`@/lib/colab/merge`); `SkusAGravar`/`SKUS_A_GRAVAR_VAZIO`/`nadaAGravar`
  (`…/codigos/sku-previa`), `LinhaSku` (`…/codigos/sku-card`); `brl` (`@/lib/format`).
- Produces (`produtos.ts`): tipos `Situacao`, `EstadoIntegracao`, `Filtros`, `Gate`, `Gates`, `Falta`, `LinhaRetrato`,
  `Retrato`, `Sublinha`, `RawProduto`, `ProdutoLista`, `ListaIntegracao`; `FILTROS_VAZIOS`, `ROTULO_ORIGEM`,
  `TEXTO_PRECISA_CUSTO`, `lerLista(raw)`, `filtrosParaRpc(f)`, `formatarValor(campo, v)`, `textoFotos(n)`, `usaRetrato(p)`,
  `fonteExibida(p)`, `linhasVariante(p)`, `valorCelula(p, campo, indice)`, `avisoRetrato(p, campo)`, `fmtDataHora(iso, tz,
  comAno?)`, `rotuloEstado(p, tz)`, `tomEstado(estado)`, `textoFaltas(faltas)`, `motivoIntegrar(p, ctx)`,
  `motivoVoltar(p, podeEditar)`, `acoesEmMassa(sel, ctx)`, `faixaPagina(l)`, `totalPaginas(l)`.
- Produces (`rascunho.ts`): `type Valores`, `COLUNAS`, `PREFIXO_FOTO_NOVA`, `type FotoNova`, `type Rascunho`,
  `type ItemSalvar`, `valoresDoRaw`, `novoRascunho`, `editar`, `adicionarFotos`, `removerFoto`, `colunasAlteradas`,
  `temAlteracao`, `comSkus`, `mesclar`, `manterMeu`, `usarNovo`, `payloadItem`, `aposSalvar`, `linhaSkuDaSublinha`.

- [ ] **Step 1: Escrever os testes (falham: arquivos ausentes)**

`tests/unit/integracao-produtos.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { brl } from "@/lib/format";
import {
  TEXTO_PRECISA_CUSTO, acoesEmMassa, avisoRetrato, faixaPagina, filtrosParaRpc, fmtDataHora, formatarValor, lerLista,
  motivoIntegrar, motivoVoltar, rotuloEstado, textoFaltas, valorCelula, type ProdutoLista,
} from "@/lib/integracao/produtos";

const gate = (ok: boolean, motivo: string | null = null) => ({ ok, motivo });
const G = { compartilhado: gate(true), planejamento: gate(true), preco: gate(false, "Precisa da permissão de preço de venda."),
  ref: gate(false, 'A REF aparece a partir da etapa "Aprovado" do kanban.'), sku: gate(true), keywords: gate(true) };
const linha = (valores: Record<string, string | null>, fotos: string[] = []) => ({ tipo: "produto", ordem: 0, valores, fotos });
const cru = (o: Record<string, unknown> = {}) => ({
  modelo_id: "m1", origem: "interno", colecao: "Verão 27", etapa: "aprovado", estado: "nao_integravel", marcado_em: null,
  integrado_em: null, rev: 7,
  raw: { nome: "Blusa Brisa", ref: "BLBR0087", preco_anterior: 179.9, preco_venda: 159.9, peso_kg: 0.22, ncm: "6109.10.00",
    titulo_pagina: null, descricao_produto: null, comprimento_cm: 68, largura_cm: 42, altura_cm: 2, fotos_modelo: ["t/fotos_modelo/a.jpg"],
    tamanho_tipo: "letra" },
  vivo: { v: 1, campos: ["nome", "preco_custo", "peso", "foto"], linhas: [
    linha({ nome: "Blusa Brisa", preco_custo: "62.10", peso: "0.220" }, ["t/fotos_modelo/a.jpg"]),
    { tipo: "variante", ordem: 1, variante_key: "v1", tamanho_key: "38|P", valores: { nome: "Blusa Brisa P", preco_custo: "62.10" }, fotos: [] }] },
  faltas: [{ campo: "titulo", texto: "Título para a página" }, { campo: "ref_sku", texto: "1 variante sem SKU (Branco, tam. M)" }],
  completo: false,
  sublinhas: [{ variante_key: "v1", tamanho_key: "38|P", variante_ordem: 1, tamanho_ordem: 1, cor_nome: "Branco", apelido_nome: "Off-white",
    tamanho: "P", sku_id: "s1", sku: "BLBR0087-BCO-P", sku_rev: 2, manual: false }],
  retrato: null, retrato_difere: [], gates: G, ...o,
});
const lista = (produtos: unknown[]) => lerLista({
  pagina: 1, por_pagina: 50, total: produtos.length, contagens: { nao_integrados: 5, integrados: 1, todos: 6 },
  campos: ["foto", "nome", "preco_custo", "peso", "xyz"], rotulos: {}, opcoes: { colecoes: ["Verão 27"], etapas: [{ key: "aprovado", label: "Aprovado" }] },
  pode: { editar: true, ver_custos: true, super: false, keywords: true }, keywords: "moda feminina, roupas", produtos,
});

describe("lerLista — tolerante, gates fail-closed", () => {
  it("lê a página, ordena os campos na ordem fixa e descarta desconhecidos", () => {
    const l = lista([cru()]);
    expect(l.campos).toEqual(["nome", "peso", "preco_custo", "foto"]);
    expect(l.contagens).toEqual({ nao_integrados: 5, integrados: 1, todos: 6 });
    const p = l.produtos[0];
    expect(p.raw.preco_venda).toBe(159.9);
    expect(p.sublinhas[0]).toMatchObject({ varianteKey: "v1", tamanhoKey: "38|P", sku: "BLBR0087-BCO-P", skuRev: 2, corNome: "Branco" });
    expect(p.gates.preco).toEqual({ ok: false, motivo: "Precisa da permissão de preço de venda." });
  });
  it("gate ausente/estranho = fechado (nunca libera edição por engano)", () => {
    const p = lista([cru({ gates: { compartilhado: "sim" } })]).produtos[0];
    expect(p.gates.compartilhado.ok).toBe(false);
    expect(p.gates.planejamento.ok).toBe(false);
  });
  it("estado desconhecido = não integrável", () => {
    expect(lista([cru({ estado: "???" })]).produtos[0].estado).toBe("nao_integravel");
  });
});

describe("formatação e retrato (N10)", () => {
  it("formata o texto canônico do retrato em BR", () => {
    expect(formatarValor("preco_venda", "179.90")).toBe(brl(179.9));
    expect(formatarValor("peso", "0.310")).toBe("0,310 kg");
    expect(formatarValor("comprimento", "68")).toBe("68 cm");
    expect(formatarValor("ncm", null)).toBe("—");
  });
  it("não integrável mostra o VIVO; foto = contagem", () => {
    const p = lista([cru()]).produtos[0];
    expect(valorCelula(p, "preco_custo", null)).toBe(brl(62.1));
    expect(valorCelula(p, "foto", null)).toBe("1 foto");
    expect(valorCelula(p, "nome", 0)).toBe("Blusa Brisa P");
    expect(valorCelula(p, "foto", 0)).toBe("—");
  });
  it("integrável mostra o RETRATO e avisa quando o vivo difere", () => {
    const p = lista([cru({ estado: "integravel", retrato: { v: 1, campos: ["preco_custo"], linhas: [linha({ preco_custo: "97.00" })] },
      vivo: { v: 1, campos: ["preco_custo"], linhas: [linha({ preco_custo: "101.20" })] }, retrato_difere: ["preco_custo"] })]).produtos[0];
    expect(valorCelula(p, "preco_custo", null)).toBe(brl(97));
    expect(avisoRetrato(p, "preco_custo")).toBe(`O custo mudou depois do retrato (hoje ${brl(101.2)}) — a API recebe o valor do retrato (${brl(97)}).`);
    expect(avisoRetrato(p, "nome")).toBeNull();
  });
  it("estado com data no fuso da loja", () => {
    expect(fmtDataHora("2026-09-26T17:35:00Z", "America/Sao_Paulo")).toBe("26/09 14:35");
    expect(fmtDataHora("2026-09-26T17:35:00Z", "America/Sao_Paulo", true)).toBe("26/09/2026 14:35");
    expect(rotuloEstado({ estado: "integrado", integradoEm: "2026-09-26T17:35:00Z" }, "America/Sao_Paulo")).toBe("Integrado em 26/09 14:35");
    expect(rotuloEstado({ estado: "integravel", integradoEm: null }, "America/Sao_Paulo")).toBe("Integrável");
  });
  it("faltas e faixa da página", () => {
    expect(textoFaltas(lista([cru()]).produtos[0].faltas)).toBe("Faltam: Título para a página · 1 variante sem SKU (Branco, tam. M)");
    expect(faixaPagina(lista([cru(), cru({ modelo_id: "m2" })]))).toBe("Mostrando 1–2 de 2 produtos");
  });
  it("filtros vazios não vão para a RPC", () => {
    expect(filtrosParaRpc({ colecao: null, etapa: "aprovado", origem: null, estado: null, busca: "  duna " })).toEqual({ etapa: "aprovado", busca: "duna" });
  });
});

describe("motivos de integrar/voltar (P-75 A, mockup 2 e 4)", () => {
  const ctx = { podeEditar: true, precisaVerCustos: true, podeVerCustos: true, temRascunho: false };
  const completo = (o: Record<string, unknown> = {}) => lista([cru({ completo: true, faltas: [], ...o })]).produtos[0];
  it("ordem: permissão → estado → rascunho → custos → faltas", () => {
    expect(motivoIntegrar(completo(), { ...ctx, podeEditar: false })).toBe("Precisa da permissão de editar a Integração.");
    expect(motivoIntegrar(completo({ estado: "integravel" }), ctx)).toBe("Já está integrável.");
    expect(motivoIntegrar(completo(), { ...ctx, temRascunho: true })).toBe("Salve as alterações antes de integrar.");
    expect(motivoIntegrar(completo(), { ...ctx, podeVerCustos: false })).toBe(TEXTO_PRECISA_CUSTO);
    expect(motivoIntegrar(lista([cru()]).produtos[0], ctx)).toMatch(/^Faltam: /);
    expect(motivoIntegrar(completo(), ctx)).toBeNull();
    expect(TEXTO_PRECISA_CUSTO).toBe("Precisa poder ver custos (Preço de custo está marcado)");
  });
  it("voltar só de integrável", () => {
    expect(motivoVoltar(completo({ estado: "integravel" }), true)).toBeNull();
    expect(motivoVoltar(completo({ estado: "integrado" }), true)).toBe("Voltar só se aplica a produtos integráveis.");
  });
  it("em massa: rascunho pendente trava integrar com o nome (texto do mockup)", () => {
    const a: ProdutoLista = completo({ modelo_id: "a", raw: { ...cru().raw, nome: "Macacão Tramonto" } });
    const b: ProdutoLista = completo({ modelo_id: "b" });
    const m = acoesEmMassa([a, b], { ...ctx, rascunhos: new Set(["a"]) });
    expect(m.motivoIntegrar).toBe("Salve as alterações antes de integrar — Macacão Tramonto tem edição pendente.");
    expect(m.integrar).toEqual([]);
    expect(m.motivoVoltar).toBe('Nenhum selecionado está "Integrável" — Voltar só se aplica a produtos integráveis.');
    const ok = acoesEmMassa([b, completo({ modelo_id: "c", estado: "integravel" })], { ...ctx, rascunhos: new Set() });
    expect(ok).toMatchObject({ integrar: ["b"], voltar: ["c"], motivoIntegrar: null, motivoVoltar: null });
  });
});
```

`tests/unit/integracao-rascunho.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { lerLista } from "@/lib/integracao/produtos";
import {
  PREFIXO_FOTO_NOVA, adicionarFotos, aposSalvar, colunasAlteradas, comSkus, editar, linhaSkuDaSublinha, manterMeu, mesclar,
  novoRascunho, payloadItem, removerFoto, temAlteracao, usarNovo,
} from "@/lib/integracao/rascunho";

const raw = { nome: "Blusa Brisa", ref: "BLBR0087", preco_anterior: 179.9, preco_venda: 159.9, peso_kg: 0.22, ncm: "6109.10.00",
  titulo_pagina: null, descricao_produto: "Blusa.", comprimento_cm: 68, largura_cm: 42, altura_cm: 2,
  fotos_modelo: ["t/fotos_modelo/a.jpg", "t/fotos_modelo/b.jpg"], tamanho_tipo: "letra" };
const produto = (rev: number, r: Record<string, unknown> = {}) => lerLista({ campos: [], produtos: [{
  modelo_id: "m1", origem: "interno", estado: "nao_integravel", rev, raw: { ...raw, ...r }, faltas: [], completo: true,
  sublinhas: [{ variante_key: "v1", tamanho_key: "38|P", variante_ordem: 1, tamanho_ordem: 1, cor_nome: "Branco", apelido_nome: null,
    tamanho: "P", sku_id: "s1", sku: "BLBR0087-BCO-P", sku_rev: 2, manual: false }], retrato_difere: [], gates: {} }] }).produtos[0];
const arquivo = (nome: string) => new File(["x"], nome, { type: "image/jpeg" });

describe("rascunho por produto (staging)", () => {
  it("nasce igual ao servidor; editar marca a coluna e o alterado", () => {
    const r0 = novoRascunho(produto(7));
    expect(temAlteracao(r0)).toBe(false);
    const r1 = editar(r0, "peso_kg", 0.25);
    expect(colunasAlteradas(r1)).toEqual(["peso_kg"]);
    expect(colunasAlteradas(editar(r1, "peso_kg", 0.22))).toEqual([]); // voltou ao valor do servidor = não alterado
  });
  it("fotos: nova entra como marcador na ordem; remover some do rascunho e da fila de upload", () => {
    const r = adicionarFotos(novoRascunho(produto(7)), [{ id: "u1", file: arquivo("c.jpg") }]);
    expect(r.valores.fotos_modelo).toEqual(["t/fotos_modelo/a.jpg", "t/fotos_modelo/b.jpg", `${PREFIXO_FOTO_NOVA}u1`]);
    const r2 = removerFoto(removerFoto(r, `${PREFIXO_FOTO_NOVA}u1`), "t/fotos_modelo/a.jpg");
    expect(r2.fotosNovas).toEqual([]);
    expect(r2.valores.fotos_modelo).toEqual(["t/fotos_modelo/b.jpg"]);
  });
  it("payload: só as colunas alteradas; textos aparados; vazio = null (exceto nome/REF, que o servidor recusa)", () => {
    let r = novoRascunho(produto(7));
    r = editar(r, "ncm", "  ");
    r = editar(r, "nome", "  Blusa Brisa Nova ");
    r = editar(r, "comprimento_cm", null);
    expect(payloadItem(r)).toEqual({ modelo_id: "m1", rev: 7, campos: { nome: "Blusa Brisa Nova", ncm: null, comprimento_cm: null } });
    expect(payloadItem(novoRascunho(produto(7)))).toBeNull();
    const f = adicionarFotos(novoRascunho(produto(7)), [{ id: "u1", file: arquivo("c.jpg") }]);
    expect(payloadItem(f, ["t/fotos_modelo/a.jpg", "t/fotos_modelo/b.jpg", "t/fotos_modelo/c.jpg"])?.campos)
      .toEqual({ fotos_modelo: ["t/fotos_modelo/a.jpg", "t/fotos_modelo/b.jpg", "t/fotos_modelo/c.jpg"] });
  });
  it("merge 3-vias: campo NÃO tocado segue o servidor; tocado e mudado lá = conflito", () => {
    let r = editar(novoRascunho(produto(7)), "peso_kg", 0.3);
    r = mesclar(r, produto(8, { peso_kg: 0.28, ncm: "6204.52.00" }));
    expect(r.rev).toBe(8);
    expect(r.valores.ncm).toBe("6204.52.00");
    expect(r.valores.peso_kg).toBe(0.3);
    expect(r.conflitos).toEqual([{ path: "peso_kg", meu: 0.3, dele: 0.28 }]);
    expect(manterMeu(r, "peso_kg").conflitos).toEqual([]);
    const u = usarNovo(r, "peso_kg");
    expect(u.valores.peso_kg).toBe(0.28);
    expect(colunasAlteradas(u)).toEqual([]);
    expect(mesclar(r, produto(8))).toBe(r); // mesmo rev = nada muda
  });
  it("SKU à mão: a sublinha vira LinhaSku; SKUs a gravar contam como alteração", () => {
    const p = produto(7);
    const l = linhaSkuDaSublinha(p.sublinhas[0]);
    expect(l).toMatchObject({ variante_key: "v1", tamanho_key: "38|P", id: "s1", rev: 2, sku: "BLBR0087-BCO-P", estado: "ok" });
    const r = comSkus(novoRascunho(p), { regerar: false, manuais: { "v1|38|P": { varianteKey: "v1", tamanhoKey: "38|P", sku: "X-1", id: "s1", rev: 2 } } });
    expect(temAlteracao(r)).toBe(true);
    expect(payloadItem(r)).toBeNull(); // SKU não vai no integracao_salvar (vai no passo 3)
  });
  it("depois do Salvar: some o rascunho; sobra só SKU que não gravou", () => {
    const r = editar(novoRascunho(produto(7)), "peso_kg", 0.3);
    expect(aposSalvar(r, { rev: 8, skusGravados: false })).toBeNull();
    const s = comSkus(r, { regerar: false, manuais: { "v1|38|P": { varianteKey: "v1", tamanhoKey: "38|P", sku: "X-1", id: "s1", rev: 2 } } });
    const sobra = aposSalvar(s, { rev: 8, fotos: ["t/fotos_modelo/a.jpg"], skusGravados: false })!;
    expect(sobra.rev).toBe(8);
    expect(colunasAlteradas(sobra)).toEqual([]);
    expect(sobra.valores.fotos_modelo).toEqual(["t/fotos_modelo/a.jpg"]);
    expect(temAlteracao(sobra)).toBe(true);
    expect(aposSalvar(s, { rev: 8, skusGravados: true })).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres
npx vitest run --no-file-parallelism tests/unit/integracao-produtos.test.ts tests/unit/integracao-rascunho.test.ts
```
Expected: FAIL — `Failed to resolve import "@/lib/integracao/produtos"`.

- [ ] **Step 3: `src/lib/integracao/produtos.ts`**

```ts
// Integração — aba Produtos (spec §6): leitura TOLERANTE do jsonb de `integracao_listar`, formatação do texto canônico do
// retrato (D4) em BR, qual fonte a linha mostra (N10: integrável/integrado = RETRATO; não integrável = VIVO) e os motivos
// que travam integrar/voltar. PURO (sem I/O). Os gates por campo vêm PRONTOS do servidor (_integracao_gates — D24): aqui só
// se lê, e o que não se consegue ler fica FECHADO (nunca libera edição por engano).
import { brl } from "@/lib/format";
import { CAMPO_BY_KEY, ordenarCampos, type CampoKey, type GateKey } from "@/lib/integracao/campos";

export type Situacao = "nao_integrados" | "integrados" | "todos";
export type EstadoIntegracao = "nao_integravel" | "integravel" | "integrado";
export type Filtros = { colecao: string | null; etapa: string | null; origem: string | null; estado: EstadoIntegracao | null; busca: string };
export const FILTROS_VAZIOS: Filtros = { colecao: null, etapa: null, origem: null, estado: null, busca: "" };
export type Gate = { ok: boolean; motivo: string | null };
export type Gates = Record<GateKey, Gate>;
export type Falta = { campo: string; texto: string };
export type LinhaRetrato = {
  tipo: "produto" | "variante"; ordem: number; varianteKey: string | null; tamanhoKey: string | null;
  valores: Partial<Record<string, string | null>>; fotos: string[];
};
export type Retrato = { campos: CampoKey[]; linhas: LinhaRetrato[] };
export type Sublinha = {
  varianteKey: string; tamanhoKey: string; varianteOrdem: number | null; tamanhoOrdem: number | null; corNome: string | null;
  apelidoNome: string | null; tamanho: string | null; skuId: string | null; sku: string | null; skuRev: number | null; manual: boolean;
};
export type RawProduto = {
  nome: string; ref: string | null; preco_anterior: number | null; preco_venda: number | null; peso_kg: number | null;
  ncm: string | null; titulo_pagina: string | null; descricao_produto: string | null; comprimento_cm: number | null;
  largura_cm: number | null; altura_cm: number | null; fotos_modelo: string[]; tamanho_tipo: "letra" | "numero";
};
export type ProdutoLista = {
  modeloId: string; origem: "interno" | "revenda" | "importado"; colecao: string | null; etapa: string | null;
  estado: EstadoIntegracao; marcadoEm: string | null; integradoEm: string | null; rev: number; raw: RawProduto;
  vivo: Retrato | null; faltas: Falta[]; completo: boolean; sublinhas: Sublinha[]; retrato: Retrato | null;
  retratoDifere: CampoKey[]; gates: Gates;
};
export type ListaIntegracao = {
  pagina: number; porPagina: number; total: number; contagens: Record<Situacao, number>; campos: CampoKey[];
  opcoes: { colecoes: string[]; etapas: { key: string; label: string }[] };
  pode: { editar: boolean; verCustos: boolean; super: boolean; keywords: boolean }; keywords: string | null;
  produtos: ProdutoLista[];
};

export const ROTULO_ORIGEM: Record<ProdutoLista["origem"], string> = { interno: "Interno", revenda: "Revenda", importado: "Importado" };
export const ROTULO_ESTADO: Record<EstadoIntegracao, string> = {
  nao_integravel: "Não integrável", integravel: "Integrável", integrado: "Integrado",
};
export const TEXTO_PRECISA_CUSTO = "Precisa poder ver custos (Preço de custo está marcado)";

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const txt = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
};
const strs = (v: unknown): string[] => arr(v).filter((x): x is string => typeof x === "string");
const ESTADOS: readonly EstadoIntegracao[] = ["nao_integravel", "integravel", "integrado"];
const estadoDe = (v: unknown): EstadoIntegracao => (ESTADOS.includes(v as EstadoIntegracao) ? (v as EstadoIntegracao) : "nao_integravel");
const GATE_KEYS: readonly GateKey[] = ["compartilhado", "planejamento", "preco", "ref", "sku", "keywords"];
const GATE_ILEGIVEL: Gate = { ok: false, motivo: "Não foi possível ler a permissão deste campo — recarregue a página." };
function gateDe(v: unknown): Gate {
  const o = obj(v);
  return typeof o.ok === "boolean" ? { ok: o.ok, motivo: txt(o.motivo) } : GATE_ILEGIVEL;
}
function retratoDe(v: unknown): Retrato | null {
  if (v === null || v === undefined || typeof v !== "object") return null;
  const o = obj(v);
  return {
    campos: ordenarCampos(strs(o.campos)),
    linhas: arr(o.linhas).map(obj).map((l): LinhaRetrato => ({
      tipo: l.tipo === "variante" ? "variante" : "produto",
      ordem: num(l.ordem) ?? 0,
      varianteKey: txt(l.variante_key),
      tamanhoKey: txt(l.tamanho_key),
      valores: Object.fromEntries(Object.entries(obj(l.valores)).map(([k, x]) => [k, x === null || x === undefined ? null : String(x)])),
      fotos: strs(l.fotos),
    })),
  };
}
function rawDe(v: unknown): RawProduto {
  const o = obj(v);
  return {
    nome: txt(o.nome) ?? "", ref: txt(o.ref), preco_anterior: num(o.preco_anterior), preco_venda: num(o.preco_venda),
    peso_kg: num(o.peso_kg), ncm: txt(o.ncm), titulo_pagina: txt(o.titulo_pagina), descricao_produto: txt(o.descricao_produto),
    comprimento_cm: num(o.comprimento_cm), largura_cm: num(o.largura_cm), altura_cm: num(o.altura_cm),
    fotos_modelo: strs(o.fotos_modelo), tamanho_tipo: o.tamanho_tipo === "numero" ? "numero" : "letra",
  };
}
function produtoDe(v: unknown): ProdutoLista {
  const o = obj(v);
  const origem = o.origem === "revenda" || o.origem === "importado" ? o.origem : "interno";
  const g = obj(o.gates);
  return {
    modeloId: txt(o.modelo_id) ?? "", origem, colecao: txt(o.colecao), etapa: txt(o.etapa), estado: estadoDe(o.estado),
    marcadoEm: txt(o.marcado_em), integradoEm: txt(o.integrado_em), rev: num(o.rev) ?? 0, raw: rawDe(o.raw),
    vivo: retratoDe(o.vivo), faltas: arr(o.faltas).map(obj).map((f) => ({ campo: txt(f.campo) ?? "", texto: txt(f.texto) ?? "" })),
    completo: o.completo === true,
    sublinhas: arr(o.sublinhas).map(obj).map((s): Sublinha => ({
      varianteKey: txt(s.variante_key) ?? "", tamanhoKey: txt(s.tamanho_key) ?? "", varianteOrdem: num(s.variante_ordem),
      tamanhoOrdem: num(s.tamanho_ordem), corNome: txt(s.cor_nome), apelidoNome: txt(s.apelido_nome), tamanho: txt(s.tamanho),
      skuId: txt(s.sku_id), sku: txt(s.sku), skuRev: num(s.sku_rev), manual: s.manual === true,
    })),
    retrato: retratoDe(o.retrato), retratoDifere: ordenarCampos(strs(o.retrato_difere)),
    gates: Object.fromEntries(GATE_KEYS.map((k) => [k, gateDe(g[k])])) as Gates,
  };
}
export function lerLista(raw: unknown): ListaIntegracao {
  const o = obj(raw);
  const c = obj(o.contagens);
  const op = obj(o.opcoes);
  const pd = obj(o.pode);
  return {
    pagina: num(o.pagina) ?? 1, porPagina: num(o.por_pagina) ?? 50, total: num(o.total) ?? 0,
    contagens: { nao_integrados: num(c.nao_integrados) ?? 0, integrados: num(c.integrados) ?? 0, todos: num(c.todos) ?? 0 },
    campos: ordenarCampos(strs(o.campos)),
    opcoes: {
      colecoes: strs(op.colecoes),
      etapas: arr(op.etapas).map(obj).map((e) => ({ key: txt(e.key) ?? "", label: txt(e.label) ?? "" })).filter((e) => e.key !== ""),
    },
    pode: { editar: pd.editar === true, verCustos: pd.ver_custos === true, super: pd.super === true, keywords: pd.keywords === true },
    keywords: txt(o.keywords),
    produtos: arr(o.produtos).map(produtoDe).filter((p) => p.modeloId !== ""),
  };
}
export function filtrosParaRpc(f: Filtros): Record<string, string> {
  const r: Record<string, string> = {};
  if (f.colecao) r.colecao = f.colecao;
  if (f.etapa) r.etapa = f.etapa;
  if (f.origem) r.origem = f.origem;
  if (f.estado) r.estado = f.estado;
  const b = f.busca.trim();
  if (b) r.busca = b;
  return r;
}

const MOEDA: ReadonlySet<string> = new Set(["preco_anterior", "preco_venda", "preco_custo"]);
const MEDIDA: ReadonlySet<string> = new Set(["comprimento", "largura", "altura"]);
/** Texto canônico do retrato (D4: "179.90", "0.310", "68") → exibição BR. */
export function formatarValor(campo: CampoKey, v: string | null | undefined): string {
  if (v === null || v === undefined || v.trim() === "") return "—";
  if (MOEDA.has(campo)) return brl(Number(v));
  if (campo === "peso") return `${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} kg`;
  if (MEDIDA.has(campo)) return `${Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} cm`;
  return v;
}
export const textoFotos = (n: number): string => (n <= 0 ? "—" : n === 1 ? "1 foto" : `${n} fotos`);
export const usaRetrato = (p: ProdutoLista): boolean => p.estado !== "nao_integravel" && p.retrato !== null;
export const fonteExibida = (p: ProdutoLista): Retrato | null => (usaRetrato(p) ? p.retrato : p.vivo);
export const linhasVariante = (p: ProdutoLista): LinhaRetrato[] => (fonteExibida(p)?.linhas ?? []).filter((l) => l.tipo === "variante");
function textoDaLinha(l: LinhaRetrato | undefined, campo: CampoKey, produto: boolean): string {
  if (!l) return "—";
  if (campo === "foto") return produto ? textoFotos(l.fotos.length) : "—";
  return formatarValor(campo, l.valores[campo] ?? null);
}
/** Texto da célula. `indice` null = linha do produto; n = n-ésima sublinha (variante × tamanho) da fonte exibida. */
export function valorCelula(p: ProdutoLista, campo: CampoKey, indice: number | null): string {
  const f = fonteExibida(p);
  return indice === null
    ? textoDaLinha(f?.linhas.find((l) => l.tipo === "produto"), campo, true)
    : textoDaLinha(linhasVariante(p)[indice], campo, false);
}
/** N10: o "i" âmbar quando o valor VIVO difere do retrato gravado (a API recebe o retrato). */
export function avisoRetrato(p: ProdutoLista, campo: CampoKey): string | null {
  if (!usaRetrato(p) || !p.retratoDifere.includes(campo)) return null;
  const hoje = textoDaLinha(p.vivo?.linhas.find((l) => l.tipo === "produto"), campo, true);
  const ret = valorCelula(p, campo, null);
  if (campo === "preco_custo") return `O custo mudou depois do retrato (hoje ${hoje}) — a API recebe o valor do retrato (${ret}).`;
  return `"${CAMPO_BY_KEY.get(campo)?.rotulo ?? campo}" mudou depois do retrato (hoje ${hoje}) — a API recebe o valor do retrato (${ret}).`;
}

export function fmtDataHora(iso: string | null, tz: string, comAno = false): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const partes = new Intl.DateTimeFormat("pt-BR", {
    timeZone: tz, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(d);
  const v = (t: Intl.DateTimeFormatPartTypes) => partes.find((x) => x.type === t)?.value ?? "";
  return `${v("day")}/${v("month")}${comAno ? `/${v("year")}` : ""} ${v("hour")}:${v("minute")}`;
}
export function rotuloEstado(p: Pick<ProdutoLista, "estado" | "integradoEm">, tz: string): string {
  return p.estado === "integrado" ? `Integrado em ${fmtDataHora(p.integradoEm, tz)}` : ROTULO_ESTADO[p.estado];
}
export const tomEstado = (e: EstadoIntegracao): "danger" | "warning" | "success" =>
  e === "integrado" ? "success" : e === "integravel" ? "warning" : "danger";
export const textoFaltas = (faltas: Falta[]): string => (faltas.length ? `Faltam: ${faltas.map((f) => f.texto).join(" · ")}` : "");

export type CtxIntegrar = { podeEditar: boolean; precisaVerCustos: boolean; podeVerCustos: boolean; temRascunho: boolean };
/** null = pode integrar. A ordem espelha a do servidor (integracao_marcar) — o servidor confere de novo. */
export function motivoIntegrar(p: ProdutoLista, c: CtxIntegrar): string | null {
  if (!c.podeEditar) return "Precisa da permissão de editar a Integração.";
  if (p.estado !== "nao_integravel") return p.estado === "integrado" ? "Já integrado." : "Já está integrável.";
  if (c.temRascunho) return "Salve as alterações antes de integrar.";
  if (c.precisaVerCustos && !c.podeVerCustos) return TEXTO_PRECISA_CUSTO;
  if (!p.completo) return textoFaltas(p.faltas) || "Produto incompleto.";
  return null;
}
export function motivoVoltar(p: ProdutoLista, podeEditar: boolean): string | null {
  if (!podeEditar) return "Precisa da permissão de editar a Integração.";
  if (p.estado !== "integravel") return "Voltar só se aplica a produtos integráveis.";
  return null;
}
export type CtxMassa = Omit<CtxIntegrar, "temRascunho"> & { rascunhos: ReadonlySet<string> };
export type AcoesMassa = { integrar: string[]; voltar: string[]; motivoIntegrar: string | null; motivoVoltar: string | null };
export function acoesEmMassa(sel: ProdutoLista[], c: CtxMassa): AcoesMassa {
  const pendentes = sel.filter((p) => c.rascunhos.has(p.modeloId));
  const integrar = sel.filter((p) => motivoIntegrar(p, { ...c, temRascunho: false }) === null).map((p) => p.modeloId);
  const voltar = sel.filter((p) => motivoVoltar(p, c.podeEditar) === null).map((p) => p.modeloId);
  let mi: string | null = null;
  if (sel.length === 0) mi = "Selecione produtos.";
  else if (!c.podeEditar) mi = "Precisa da permissão de editar a Integração.";
  else if (pendentes.length === 1) mi = `Salve as alterações antes de integrar — ${pendentes[0].raw.nome} tem edição pendente.`;
  else if (pendentes.length > 1) mi = `Salve as alterações antes de integrar — ${pendentes.length} produtos têm edição pendente.`;
  else if (c.precisaVerCustos && !c.podeVerCustos) mi = TEXTO_PRECISA_CUSTO;
  else if (integrar.length === 0) mi = "Nenhum selecionado pode ser integrado (incompleto, já integrável ou integrado).";
  const mv = sel.length === 0 ? "Selecione produtos."
    : voltar.length === 0 ? 'Nenhum selecionado está "Integrável" — Voltar só se aplica a produtos integráveis.' : null;
  return { integrar: mi ? [] : integrar, voltar: mv ? [] : voltar, motivoIntegrar: mi, motivoVoltar: mv };
}
export const totalPaginas = (l: Pick<ListaIntegracao, "total" | "porPagina">): number => Math.max(1, Math.ceil(l.total / l.porPagina));
export function faixaPagina(l: Pick<ListaIntegracao, "pagina" | "porPagina" | "total" | "produtos">): string {
  if (l.total === 0) return "Nenhum produto";
  const ini = (l.pagina - 1) * l.porPagina + 1;
  return `Mostrando ${ini}–${ini + l.produtos.length - 1} de ${l.total} produtos`;
}
```

- [ ] **Step 4: `src/lib/integracao/rascunho.ts`**

```ts
// Integração — rascunho POR PRODUTO da aba Produtos (staging: nada grava antes do Salvar). PURO. As 12 colunas são as do
// CARD (mão dupla — a tela nunca tem cópia própria); o merge com o servidor é o 3-vias do sistema (base/draft/fresh/tocados,
// @/lib/colab/merge). Foto nova = marcador "novo:<id>" na posição dela (o upload só acontece no Salvar — Task 11). SKU à mão
// = o MESMO "a gravar" da seção Códigos (sku-previa.ts), gravado no passo 3 do Salvar.
import { igual, mergeDraft, type Conflito } from "@/lib/colab/merge";
import type { ColunaEditavel } from "@/lib/integracao/campos";
import type { ProdutoLista, RawProduto, Sublinha } from "@/lib/integracao/produtos";
import {
  SKUS_A_GRAVAR_VAZIO, nadaAGravar, type SkusAGravar,
} from "@/components/planejamento/planejamento-detail/codigos/sku-previa";
import type { LinhaSku } from "@/components/planejamento/planejamento-detail/codigos/sku-card";

export type Valores = Omit<RawProduto, "tamanho_tipo">;
export const COLUNAS: readonly ColunaEditavel[] = [
  "nome", "ref", "preco_anterior", "preco_venda", "peso_kg", "ncm", "titulo_pagina", "descricao_produto",
  "comprimento_cm", "largura_cm", "altura_cm", "fotos_modelo",
];
export const PREFIXO_FOTO_NOVA = "novo:";
export type FotoNova = { id: string; file: File };
export type Rascunho = {
  modeloId: string; nome: string; rev: number; tamanhoTipo: "letra" | "numero";
  base: Valores; valores: Valores; tocados: ReadonlySet<ColunaEditavel>;
  fotosNovas: FotoNova[]; skus: SkusAGravar; conflitos: Conflito[];
};
export type ItemSalvar = {
  modelo_id: string; rev: number; campos: Partial<Record<ColunaEditavel, string | number | string[] | null>>;
};

export function valoresDoRaw(raw: RawProduto): Valores {
  return {
    nome: raw.nome, ref: raw.ref, preco_anterior: raw.preco_anterior, preco_venda: raw.preco_venda, peso_kg: raw.peso_kg,
    ncm: raw.ncm, titulo_pagina: raw.titulo_pagina, descricao_produto: raw.descricao_produto, comprimento_cm: raw.comprimento_cm,
    largura_cm: raw.largura_cm, altura_cm: raw.altura_cm, fotos_modelo: [...raw.fotos_modelo],
  };
}
export function novoRascunho(p: ProdutoLista): Rascunho {
  const v = valoresDoRaw(p.raw);
  return {
    modeloId: p.modeloId, nome: p.raw.nome, rev: p.rev, tamanhoTipo: p.raw.tamanho_tipo, base: v,
    valores: { ...v, fotos_modelo: [...v.fotos_modelo] }, tocados: new Set(), fotosNovas: [], skus: SKUS_A_GRAVAR_VAZIO,
    conflitos: [],
  };
}
export function editar<K extends ColunaEditavel>(r: Rascunho, coluna: K, valor: Valores[K]): Rascunho {
  const tocados = new Set(r.tocados);
  tocados.add(coluna);
  return { ...r, valores: { ...r.valores, [coluna]: valor }, tocados, conflitos: r.conflitos.filter((c) => c.path !== coluna) };
}
export function adicionarFotos(r: Rascunho, novas: FotoNova[]): Rascunho {
  if (novas.length === 0) return r;
  return editar({ ...r, fotosNovas: [...r.fotosNovas, ...novas] }, "fotos_modelo",
    [...r.valores.fotos_modelo, ...novas.map((n) => PREFIXO_FOTO_NOVA + n.id)]);
}
export function removerFoto(r: Rascunho, item: string): Rascunho {
  const fotosNovas = r.fotosNovas.filter((n) => PREFIXO_FOTO_NOVA + n.id !== item);
  return editar({ ...r, fotosNovas }, "fotos_modelo", r.valores.fotos_modelo.filter((f) => f !== item));
}
export const colunasAlteradas = (r: Rascunho): ColunaEditavel[] => COLUNAS.filter((c) => !igual(r.valores[c], r.base[c]));
export const temAlteracao = (r: Rascunho): boolean => colunasAlteradas(r).length > 0 || !nadaAGravar(r.skus);
export const comSkus = (r: Rascunho, skus: SkusAGravar): Rascunho => ({ ...r, skus });

/** Chegou versão nova do servidor (rev diferente): merge 3-vias — não tocado segue o servidor; tocado e mudado lá = conflito. */
export function mesclar(r: Rascunho, p: ProdutoLista): Rascunho {
  if (p.rev === r.rev) return r;
  const fresh = valoresDoRaw(p.raw);
  const m = mergeDraft({ base: r.base, draft: r.valores, fresh, touched: r.tocados as ReadonlySet<string> });
  const conflitos = [...r.conflitos.filter((c) => !m.conflitos.some((n) => n.path === c.path)), ...m.conflitos];
  return { ...r, rev: p.rev, nome: p.raw.nome, tamanhoTipo: p.raw.tamanho_tipo, base: fresh, valores: m.valor, conflitos };
}
export const manterMeu = (r: Rascunho, path: string): Rascunho => ({ ...r, conflitos: r.conflitos.filter((c) => c.path !== path) });
export function usarNovo(r: Rascunho, path: string): Rascunho {
  const k = path as ColunaEditavel;
  const tocados = new Set(r.tocados);
  tocados.delete(k);
  return {
    ...r, valores: { ...r.valores, [k]: r.base[k] }, tocados, fotosNovas: k === "fotos_modelo" ? [] : r.fotosNovas,
    conflitos: r.conflitos.filter((c) => c.path !== path),
  };
}

const TEXTO_OU_NULL: ReadonlySet<ColunaEditavel> = new Set(["ncm", "titulo_pagina", "descricao_produto"]);
/** Item do `integracao_salvar`: só as colunas alteradas (as ausentes não gravam). SKU NÃO vai aqui (passo 3). */
export function payloadItem(r: Rascunho, fotosFinais?: string[]): ItemSalvar | null {
  const cols = colunasAlteradas(r);
  if (cols.length === 0) return null;
  const campos: ItemSalvar["campos"] = {};
  for (const c of cols) {
    const v = r.valores[c];
    if (c === "fotos_modelo") campos.fotos_modelo = fotosFinais ?? r.valores.fotos_modelo.filter((f) => !f.startsWith(PREFIXO_FOTO_NOVA));
    else if (c === "nome" || c === "ref") campos[c] = String(v ?? "").trim();
    else if (TEXTO_OU_NULL.has(c)) campos[c] = String(v ?? "").trim() || null;
    else campos[c] = typeof v === "number" && Number.isFinite(v) ? v : null;
  }
  return { modelo_id: r.modeloId, rev: r.rev, campos };
}
/** Depois do Salvar: o que gravou vira a base; sobra rascunho SÓ se os SKUs "a gravar" não gravaram (passo 3). */
export function aposSalvar(r: Rascunho, o: { rev?: number; fotos?: string[]; skusGravados: boolean }): Rascunho | null {
  if (o.skusGravados || nadaAGravar(r.skus)) return null;
  const valores: Valores = { ...r.valores, fotos_modelo: o.fotos ?? r.valores.fotos_modelo.filter((f) => !f.startsWith(PREFIXO_FOTO_NOVA)) };
  return { ...r, rev: o.rev ?? r.rev, base: valores, valores: { ...valores }, tocados: new Set(), fotosNovas: [], conflitos: [] };
}
/** A sublinha da lista no formato da seção Códigos (digitarSku/skuExibido/situacaoPrevia leem este shape). */
export function linhaSkuDaSublinha(s: Sublinha): LinhaSku {
  return {
    variante_key: s.varianteKey, variante_ordem: s.varianteOrdem, cor_nome: s.corNome, apelido_nome: s.apelidoNome,
    tamanho_key: s.tamanhoKey, tamanho_ordem: s.tamanhoOrdem, id: s.skuId, sku: s.sku, manual: s.manual, rev: s.skuRev,
    sku_previsto: null, faltas: [], avisos: [], conflito_com: null, estado: s.sku ? (s.manual ? "manual" : "ok") : "vazio",
  };
}
```

- [ ] **Step 5: Rodar (PASS), gates e commit**

```bash
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres
npx vitest run --no-file-parallelism tests/unit/integracao-produtos.test.ts tests/unit/integracao-rascunho.test.ts
bash .superpowers/integracao/gates.sh
git add -- src/lib/integracao/produtos.ts src/lib/integracao/rascunho.ts tests/unit/integracao-produtos.test.ts tests/unit/integracao-rascunho.test.ts
git commit --only -m "feat(integracao): leitura da lista (retrato × vivo, motivos) e rascunho por produto com merge 3-vias

Co-Authored-By: Claude <modelo real> <noreply@anthropic.com>" -- src/lib/integracao/produtos.ts src/lib/integracao/rascunho.ts \
  tests/unit/integracao-produtos.test.ts tests/unit/integracao-rascunho.test.ts
git show --stat HEAD | tail -n +7
```
Expected: PASS (produtos 11 · rascunho 6); `GATES INTEGRACAO: ok`. Se `fmtDataHora` divergir por ICU do Node (ex.: `24:35`),
o `hourCycle: "h23"` é a correção — registrar em `desvios.md` qualquer ajuste.

---

### Task 11: O Salvar em 3 passos, hooks de dados e a guarda única da página

**Files:**
- Create: `src/components/integracao/salvar-integracao.ts` (orquestração PURA, dependências injetadas)
- Create: `src/components/integracao/useIntegracao.ts` (TanStack Query + Realtime + dependências reais)
- Create: `src/components/integracao/guard.ts` (contexto: cada aba informa se está suja)
- Modify: `src/components/integracao/IntegracaoPage.tsx` (1 `useUnsavedGuard` com `blockNav`; troca de aba confirmada)
- Test: `tests/unit/integracao-salvar.test.ts`; acrescenta um bloco em `tests/unit/integracao-tela-fonte.test.ts`

**Interfaces:**
- Consumes: Task 10 (`Rascunho`, `ItemSalvar`, `PREFIXO_FOTO_NOVA`, `colunasAlteradas`, `payloadItem`, `lerLista`,
  `filtrosParaRpc`); `sku-previa.ts` (`manuaisParaRpc`, `chaveEntradaPrevia`, `lerPrevia`, `resumoAplicacao`,
  `mensagemAplicarSkus`, `mensagemErroPrevia`, `MSG_PREVIA_DESCONHECIDA`, `nadaAGravar`, `ManualRpc`, `PreviaSkus`);
  `uploadFile`/`BUCKET` (`@/components/planejamento/modelo-shared`); RPCs `integracao_listar`, `integracao_config_ler`,
  `integracao_salvar`, `skus_previa`, `aplicar_skus_modelo`.
- Produces (`salvar-integracao.ts`): `type EntradaSkus`, `type DepsSalvar`, `type FalhaSku`, `type ResultadoSalvar
  {salvos, revs, fotos: Record<modeloId, string[]>, skusOk: string[], skusFalhas: FalhaSku[]}`, `entradaSkus(r)`,
  `salvarIntegracao(rascunhos, deps)`.
- Produces (`useIntegracao.ts`): `chaveLista(t)`, `chaveConfig(t)`, `chaveEstado(t)`, `chaveLog(t)`, `useIntegracaoLista(
  situacao, filtros, pagina)`, `useIntegracaoAoVivo(ids: string[])` (Realtime só dos produtos da página — N2), `useIntegracaoConfig()`, `usePreviasSkus(rascunhos, ativo)`,
  `depsSupabase`, `invalidarIntegracao(qc, tenantId, ids)`, `useSalvarIntegracao()`.
- Produces (`guard.ts`): `GuardaIntegracaoContext`, `useAbaSuja(aba, sujo)`.

- [ ] **Step 1: Escrever os testes (falham: arquivo ausente)**

`tests/unit/integracao-salvar.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { lerLista } from "@/lib/integracao/produtos";
import { adicionarFotos, comSkus, editar, novoRascunho } from "@/lib/integracao/rascunho";
import { salvarIntegracao, type DepsSalvar } from "@/components/integracao/salvar-integracao";
import {
  MSG_PREVIA_DESATUALIZADA, MSG_PREVIA_DESCONHECIDA,
} from "@/components/planejamento/planejamento-detail/codigos/sku-previa";

const produto = (id: string) => lerLista({ campos: [], produtos: [{ modelo_id: id, estado: "nao_integravel", rev: 3,
  raw: { nome: `Produto ${id}`, ref: "REF1", fotos_modelo: ["t/fotos_modelo/a.jpg"], tamanho_tipo: "letra" }, gates: {} }] }).produtos[0];
const SKUS = { regerar: false, manuais: { "v1|38|P": { varianteKey: "v1", tamanhoKey: "38|P", sku: "REF1-X", id: "s1", rev: 2 } } };
const ASS = "0123456789abcdef0123456789abcdef";
const previaOk = { matriz: { status: "ok", tamanho_tipo: "letra", tamanho_tipo_card: "letra", linhas: [], faltas: [], avisos: [] },
  assinatura: ASS, erros: [], nConflitos: 0, entrada: "x", desconhecida: false };
function falsos(o: Partial<DepsSalvar> = {}) {
  const chamadas: string[] = [];
  const d: DepsSalvar = {
    subirFoto: vi.fn(async (f: File) => { chamadas.push(`subir:${f.name}`); return `t/fotos_modelo/${f.name}`; }),
    apagarFotos: vi.fn(async (c: string[]) => { chamadas.push(`apagar:${c.join(",")}`); }),
    salvar: vi.fn(async (itens) => {
      chamadas.push(`salvar:${itens.map((i) => i.modelo_id).join(",")}`);
      return { salvos: itens.length, revs: Object.fromEntries(itens.map((i) => [i.modelo_id, i.rev + 1])) };
    }),
    previaSkus: vi.fn(async (id: string) => { chamadas.push(`previa:${id}`); return previaOk as never; }),
    aplicarSkus: vi.fn(async (id: string, a) => {
      chamadas.push(`aplicar:${id}:${a.modo}:${a.assinatura}`);
      return { criados: 0, atualizados: 0, removidos: 0, manuais: 1, conflitos: [] };
    }),
    ...o,
  };
  return { d, chamadas };
}
const comFoto = () => adicionarFotos(editar(novoRascunho(produto("m1")), "peso_kg", 0.3), [{ id: "u1", file: new File(["x"], "c.jpg") }]);

describe("salvarIntegracao — fotos → integracao_salvar → SKUs", () => {
  it("ordem certa; 1 chamada ao servidor com todos; marcador vira caminho na MESMA posição", async () => {
    const { d, chamadas } = falsos();
    const r = await salvarIntegracao([comFoto(), comSkus(novoRascunho(produto("m2")), SKUS)], d);
    expect(chamadas).toEqual(["subir:c.jpg", "salvar:m1", "previa:m2", `aplicar:m2:manuais:${ASS}`]);
    expect(vi.mocked(d.salvar).mock.calls[0][0][0]).toEqual({ modelo_id: "m1", rev: 3,
      campos: { peso_kg: 0.3, fotos_modelo: ["t/fotos_modelo/a.jpg", "t/fotos_modelo/c.jpg"] } });
    expect(r).toMatchObject({ salvos: 1, revs: { m1: 4 }, fotos: { m1: ["t/fotos_modelo/a.jpg", "t/fotos_modelo/c.jpg"] }, skusOk: ["m2"], skusFalhas: [] });
  });
  it("falha no integracao_salvar: apaga as fotos que ESTE Salvar subiu, repassa o erro e não mexe nos SKUs", async () => {
    const { d, chamadas } = falsos({ salvar: vi.fn(async () => { throw Object.assign(new Error("x"), { code: "P0409" }); }) });
    await expect(salvarIntegracao([comFoto(), comSkus(novoRascunho(produto("m2")), SKUS)], d)).rejects.toMatchObject({ code: "P0409" });
    expect(chamadas).toEqual(["subir:c.jpg", "apagar:t/fotos_modelo/c.jpg"]);
    expect(d.previaSkus).not.toHaveBeenCalled();
  });
  it("prévia com erro: os SKUs daquele produto não gravam (o resto fica) e o texto é o da seção Códigos", async () => {
    const { d } = falsos({ previaSkus: vi.fn(async () => ({ ...previaOk,
      erros: [{ variante_key: "v1", tamanho_key: "38|P", code: "P0001", mensagem: "SKU já usado por outro produto." }] }) as never) });
    const r = await salvarIntegracao([comSkus(novoRascunho(produto("m2")), SKUS)], d);
    expect(d.aplicarSkus).not.toHaveBeenCalled();
    expect(d.salvar).not.toHaveBeenCalled();
    expect(r.skusFalhas).toEqual([{ modeloId: "m2", nome: "Produto m2",
      texto: "O card foi salvo, mas os SKUs não foram gravados: SKU já usado por outro produto." }]);
  });
  it("prévia ilegível = não aplica; aplicar com P0409 = prévia desatualizada", async () => {
    const a = falsos({ previaSkus: vi.fn(async () => ({ ...previaOk, assinatura: null, desconhecida: true }) as never) });
    expect((await salvarIntegracao([comSkus(novoRascunho(produto("m2")), SKUS)], a.d)).skusFalhas[0].texto).toBe(MSG_PREVIA_DESCONHECIDA);
    const b = falsos({ aplicarSkus: vi.fn(async () => { throw Object.assign(new Error("x"), { code: "P0409" }); }) });
    expect((await salvarIntegracao([comSkus(novoRascunho(produto("m2")), SKUS)], b.d)).skusFalhas[0].texto).toBe(MSG_PREVIA_DESATUALIZADA);
  });
});
```

Acrescentar ao FIM de `tests/unit/integracao-tela-fonte.test.ts`:

```ts
describe("Integração — guarda única de alterações não salvas", () => {
  it("1 useUnsavedGuard na página (blockNav) e trocar de aba passa pela confirmação", () => {
    const s = ler("src/components/integracao/IntegracaoPage.tsx");
    expect(s.match(/useUnsavedGuard\(/g)?.length).toBe(1);
    expect(s).toMatch(/blockNav: true/);
    expect(s).toMatch(/requestAction\(\(\) => setAba\(/);
    expect(s).toMatch(/<UnsavedChangesGuard confirm=\{confirm\} \/>/);
  });
  it("nenhuma aba cria a própria guarda (2 useBlocker brigariam)", () => {
    for (const f of ["ProdutosAba", "CamposAba", "ApiAba", "ManualAba", "LogAba"]) {
      const p = `src/components/integracao/${f}.tsx`;
      if (!existsSync(p)) continue;
      expect(ler(p), f).not.toMatch(/useUnsavedGuard\(/);
    }
  });
});
```
e trocar o import do topo desse arquivo de `import { readFileSync } from "node:fs";` para
`import { existsSync, readFileSync } from "node:fs";`.

- [ ] **Step 2: Rodar e ver falhar**

```bash
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres
npx vitest run --no-file-parallelism tests/unit/integracao-salvar.test.ts tests/unit/integracao-tela-fonte.test.ts
```
Expected: FAIL — `Failed to resolve import "@/components/integracao/salvar-integracao"` e o bloco novo da tela-fonte
(`useUnsavedGuard` não existe na página).

- [ ] **Step 3: `src/components/integracao/salvar-integracao.ts`**

```ts
// Integração — o Salvar da aba Produtos em 3 passos (spec §6, D15): (1) sobe as fotos novas (bucket "modelos", prefixo da
// loja — inv. #2); (2) integracao_salvar com TODOS os produtos alterados numa chamada (atômica; P0409 = rev velho) — se
// falhar, apaga as fotos que ESTE Salvar subiu (nada órfão); (3) SKUs digitados, produto a produto: prévia da MESMA entrada
// (REF já gravada no passo 2) → aplicar com a assinatura dela (modo "manuais"). Falha no passo 3 não desfaz o 2 (o produto
// já foi salvo — mesmo contrato da seção Códigos). Dependências injetadas: testável sem banco.
import {
  MSG_PREVIA_DESCONHECIDA, manuaisParaRpc, mensagemAplicarSkus, mensagemErroPrevia, nadaAGravar, resumoAplicacao,
  type ManualRpc, type PreviaSkus,
} from "@/components/planejamento/planejamento-detail/codigos/sku-previa";
import { PREFIXO_FOTO_NOVA, colunasAlteradas, payloadItem, type ItemSalvar, type Rascunho } from "@/lib/integracao/rascunho";

export type EntradaSkus = { ref: string; tamanhoTipo: "letra" | "numero"; manuais: ManualRpc[]; modo: "manuais" };
export type DepsSalvar = {
  subirFoto: (file: File) => Promise<string>;
  apagarFotos: (caminhos: string[]) => Promise<void>;
  salvar: (itens: ItemSalvar[]) => Promise<{ salvos: number; revs: Record<string, number> }>;
  previaSkus: (modeloId: string, e: EntradaSkus) => Promise<PreviaSkus>;
  aplicarSkus: (modeloId: string, a: { manuais: ManualRpc[]; modo: "manuais"; assinatura: string }) => Promise<unknown>;
};
export type FalhaSku = { modeloId: string; nome: string; texto: string };
export type ResultadoSalvar = {
  salvos: number; revs: Record<string, number>; fotos: Record<string, string[]>; skusOk: string[]; skusFalhas: FalhaSku[];
};

/** Entrada da prévia/gravação dos SKUs: a REF do rascunho (= a gravada depois do passo 2) e sempre o modo "manuais" (D15). */
export const entradaSkus = (r: Rascunho): EntradaSkus => ({
  ref: String(r.valores.ref ?? "").trim(), tamanhoTipo: r.tamanhoTipo, manuais: manuaisParaRpc(r.skus), modo: "manuais",
});

export async function salvarIntegracao(rascunhos: Rascunho[], deps: DepsSalvar): Promise<ResultadoSalvar> {
  const subidos: string[] = [];
  const fotos: Record<string, string[]> = {};
  let res: { salvos: number; revs: Record<string, number> } = { salvos: 0, revs: {} };
  try {
    const itens: ItemSalvar[] = [];
    for (const r of rascunhos) {
      const cols = colunasAlteradas(r);
      if (cols.length === 0) continue;
      let finais: string[] | undefined;
      if (cols.includes("fotos_modelo")) {
        const caminho: Record<string, string> = {};
        for (const n of r.fotosNovas) {
          if (!r.valores.fotos_modelo.includes(PREFIXO_FOTO_NOVA + n.id)) continue;
          const c = await deps.subirFoto(n.file);
          subidos.push(c);
          caminho[n.id] = c;
        }
        finais = r.valores.fotos_modelo
          .map((f) => (f.startsWith(PREFIXO_FOTO_NOVA) ? caminho[f.slice(PREFIXO_FOTO_NOVA.length)] : f))
          .filter((f): f is string => typeof f === "string" && f !== "");
        fotos[r.modeloId] = finais;
      }
      const item = payloadItem(r, finais);
      if (item) itens.push(item);
    }
    if (itens.length > 0) res = await deps.salvar(itens);
  } catch (e) {
    if (subidos.length > 0) await deps.apagarFotos(subidos).catch(() => undefined);
    throw e;
  }
  const skusOk: string[] = [];
  const skusFalhas: FalhaSku[] = [];
  for (const r of rascunhos) {
    if (nadaAGravar(r.skus)) continue;
    const e = entradaSkus(r);
    try {
      const p = await deps.previaSkus(r.modeloId, e);
      if (p.desconhecida || !p.assinatura) {
        skusFalhas.push({ modeloId: r.modeloId, nome: r.nome, texto: MSG_PREVIA_DESCONHECIDA });
        continue;
      }
      if (p.erros.length > 0) {
        skusFalhas.push({ modeloId: r.modeloId, nome: r.nome, texto: mensagemErroPrevia(p.erros[0]) });
        continue;
      }
      const out = await deps.aplicarSkus(r.modeloId, { manuais: e.manuais, modo: "manuais", assinatura: p.assinatura });
      const resumo = resumoAplicacao(out);
      if (resumo.erro) skusFalhas.push({ modeloId: r.modeloId, nome: r.nome, texto: resumo.texto });
      else skusOk.push(r.modeloId);
    } catch (err) {
      skusFalhas.push({ modeloId: r.modeloId, nome: r.nome, texto: mensagemAplicarSkus(err) });
    }
  }
  return { ...res, fotos, skusOk, skusFalhas };
}
```

- [ ] **Step 4: `src/components/integracao/useIntegracao.ts`**

```ts
// Integração — dados da tela (TanStack Query) e o Salvar com as dependências REAIS. RPCs novas por `as any` (types.ts não é
// regerado nesta frente). queryKeys POR LOJA (trocar de loja não reaproveita cache — lição P-57).
import { useEffect } from "react";
import { keepPreviousData, useMutation, useQueries, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { BUCKET, uploadFile } from "@/components/planejamento/modelo-shared";
import { chaveEntradaPrevia, lerPrevia, type PreviaSkus } from "@/components/planejamento/planejamento-detail/codigos/sku-previa";
import { filtrosParaRpc, lerLista, type Filtros, type ListaIntegracao, type Situacao } from "@/lib/integracao/produtos";
import type { Rascunho } from "@/lib/integracao/rascunho";
import { entradaSkus, salvarIntegracao, type DepsSalvar, type ResultadoSalvar } from "./salvar-integracao";

export const chaveLista = (tenantId: string) => ["integracao-lista", tenantId] as const;
export const chaveConfig = (tenantId: string) => ["integracao-config", tenantId] as const;
export const chaveEstado = (tenantId: string) => ["integracao-estado", tenantId] as const;
export const chaveLog = (tenantId: string) => ["integracao-log", tenantId] as const;

export function useIntegracaoLista(situacao: Situacao, filtros: Filtros, pagina: number) {
  const tenantId = useActiveTenantId();
  const f = filtrosParaRpc(filtros);
  return useQuery({
    queryKey: [...chaveLista(tenantId), situacao, f, pagina],
    enabled: !!tenantId,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<ListaIntegracao> => {
      const { data, error } = await supabase.rpc("integracao_listar" as any, { _situacao: situacao, _filtros: f, _pagina: pagina });
      if (error) throw error;
      return lerLista(data);
    },
  });
}

/** Edição alheia (card, Dev, outra aba) nos produtos DA PÁGINA chega por Realtime em `modelos` → a lista relê e o merge
 *  3-vias roda na aba. Filtra pelos ids da página (N2 do G-plano do plano: `integracao_listar` pode levar ~segundos — não
 *  reler a cada save de qualquer produto da loja). Página = 50 ids (o filtro `in` do Realtime aceita até 100). */
export function useIntegracaoAoVivo(ids: string[]): void {
  const tenantId = useActiveTenantId();
  const qc = useQueryClient();
  const chaveIds = [...ids].sort().join(",");
  useEffect(() => {
    if (!tenantId || chaveIds === "") return;
    let h = 0;
    for (let i = 0; i < chaveIds.length; i++) h = (h * 31 + chaveIds.charCodeAt(i)) | 0;
    const topico = `integracao-lista:${tenantId}:${(h >>> 0).toString(36)}`;
    const velho = supabase.getChannels().find((c) => c.topic === `realtime:${topico}`);
    if (velho) void supabase.removeChannel(velho);
    let t: ReturnType<typeof setTimeout> | null = null;
    const ch = supabase.channel(topico);
    ch.on("postgres_changes", { event: "UPDATE", schema: "public", table: "modelos", filter: `id=in.(${chaveIds})` }, () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => void qc.invalidateQueries({ queryKey: chaveLista(tenantId) }), 800);
    });
    ch.subscribe();
    return () => {
      if (t) clearTimeout(t);
      void supabase.removeChannel(ch);
    };
  }, [tenantId, chaveIds, qc]);
}

export type ConfigIntegracao = {
  campos: string[]; layout: string[]; rev: number;
  api: { limite_por_minuto: number; max_por_pagina: number; validade_foto_dias: number; bloqueio_tentativas: number } | null;
};
export function useIntegracaoConfig() {
  const tenantId = useActiveTenantId();
  return useQuery({
    queryKey: chaveConfig(tenantId),
    enabled: !!tenantId,
    queryFn: async (): Promise<ConfigIntegracao> => {
      const { data, error } = await supabase.rpc("integracao_config_ler" as any);
      if (error) throw error;
      const o = (data ?? {}) as Partial<ConfigIntegracao>;
      return { campos: o.campos ?? [], layout: o.layout ?? [], rev: Number(o.rev ?? 0), api: o.api ?? null };
    },
  });
}

/** Prévia dos SKUs digitados (a MESMA RPC da seção Códigos, só leitura) — 1 consulta por produto com SKU "a gravar". */
export function usePreviasSkus(rascunhos: Rascunho[], ativo: boolean): Record<string, PreviaSkus | undefined> {
  const comSku = rascunhos.filter((r) => Object.keys(r.skus.manuais).length > 0);
  const qs = useQueries({
    queries: comSku.map((r) => {
      const e = entradaSkus(r);
      const chave = chaveEntradaPrevia({ ref: e.ref, tamanhoTipo: e.tamanhoTipo, aGravar: r.skus, virgem: false });
      return {
        queryKey: ["integracao-sku-previa", r.modeloId, chave],
        enabled: ativo,
        placeholderData: keepPreviousData,
        queryFn: async (): Promise<PreviaSkus> => {
          const { data, error } = await supabase.rpc("skus_previa" as any, {
            _modelo_id: r.modeloId, _ref: e.ref, _tamanho_tipo: e.tamanhoTipo, _manuais: e.manuais, _modo: e.modo,
          });
          if (error) throw error;
          return lerPrevia(data, chave);
        },
      };
    }),
  });
  return Object.fromEntries(comSku.map((r, i) => [r.modeloId, qs[i]?.data]));
}

export const depsSupabase: DepsSalvar = {
  subirFoto: (file) => uploadFile(file, "fotos_modelo"),
  apagarFotos: async (caminhos) => {
    await supabase.storage.from(BUCKET).remove(caminhos);
  },
  salvar: async (itens) => {
    const { data, error } = await supabase.rpc("integracao_salvar" as any, { _itens: itens });
    if (error) throw error;
    const o = (data ?? {}) as { salvos?: number; revs?: Record<string, number> };
    return { salvos: Number(o.salvos ?? 0), revs: o.revs ?? {} };
  },
  previaSkus: async (modeloId, e) => {
    const { data, error } = await supabase.rpc("skus_previa" as any, {
      _modelo_id: modeloId, _ref: e.ref, _tamanho_tipo: e.tamanhoTipo, _manuais: e.manuais, _modo: e.modo,
    });
    if (error) throw error;
    return lerPrevia(data, "salvar");
  },
  aplicarSkus: async (modeloId, a) => {
    const { data, error } = await supabase.rpc("aplicar_skus_modelo" as any, {
      _modelo_id: modeloId, _manuais: a.manuais, _modo: a.modo, _assinatura: a.assinatura,
    });
    if (error) throw error;
    return data;
  },
};

/** Tudo que mostra dado do produto relê (mão dupla: card, Dev, PA/PI, selos). */
export function invalidarIntegracao(qc: QueryClient, tenantId: string, ids: string[] = []): void {
  for (const k of [chaveLista(tenantId), chaveEstado(tenantId), chaveLog(tenantId)]) void qc.invalidateQueries({ queryKey: k });
  for (const k of ["modelos-planejamento", "modelos-desenvolvimento", "produtos-acabados", "plan-custo-unit"]) {
    void qc.invalidateQueries({ queryKey: [k] });
  }
  for (const id of ids) {
    void qc.invalidateQueries({ queryKey: ["modelo", id] });
    void qc.invalidateQueries({ queryKey: ["plan-skus", id] });
    void qc.invalidateQueries({ queryKey: ["integracao-sku-previa", id] });
  }
}

export function useSalvarIntegracao() {
  const tenantId = useActiveTenantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rascunhos: Rascunho[]): Promise<ResultadoSalvar> => salvarIntegracao(rascunhos, depsSupabase),
    onSettled: (_d, _e, rascunhos) => invalidarIntegracao(qc, tenantId, rascunhos.map((r) => r.modeloId)),
  });
}
```

- [ ] **Step 5: `src/components/integracao/guard.ts` e a guarda na página**

```ts
// Integração — guarda de "alterações não salvas" ÚNICA da página: 1 useUnsavedGuard com blockNav em IntegracaoPage (2 guardas
// brigariam pelo mesmo useBlocker do router). Cada aba informa aqui se está suja; trocar de aba com algo sujo pede
// "Descartar alterações?" (a aba que sai desmonta e o rascunho dela some).
import { createContext, useContext, useEffect } from "react";
import type { Aba } from "@/lib/integracao/abas";

export type GuardaIntegracao = { informarSujo: (aba: Aba, sujo: boolean) => void };
export const GuardaIntegracaoContext = createContext<GuardaIntegracao | null>(null);
export function useAbaSuja(aba: Aba, sujo: boolean): void {
  const ctx = useContext(GuardaIntegracaoContext);
  useEffect(() => {
    ctx?.informarSujo(aba, sujo);
  }, [ctx, aba, sujo]);
  useEffect(() => () => ctx?.informarSujo(aba, false), [ctx, aba]);
}
```

Em `src/components/integracao/IntegracaoPage.tsx`, trocar os imports de React/shared e a função `IntegracaoPage` inteira por:

```tsx
import { useCallback, useMemo, useState, type ComponentType } from "react";
```
(no lugar de `import { useState, type ComponentType } from "react";`), acrescentar

```tsx
import { UnsavedChangesGuard, useUnsavedGuard } from "@/components/shared/UnsavedChangesGuard";
import { UnsavedIndicator } from "@/components/shared/UnsavedIndicator";
import { GuardaIntegracaoContext } from "./guard";
```
e:

```tsx
export function IntegracaoPage() {
  const { isSuperAdmin } = useAuth();
  const abas = abasVisiveis(isSuperAdmin);
  const [aba, setAba] = useState<Aba>("produtos");
  const [sujas, setSujas] = useState<Partial<Record<Aba, boolean>>>({});
  const informarSujo = useCallback(
    (a: Aba, s: boolean) => setSujas((x) => (Boolean(x[a]) === s ? x : { ...x, [a]: s })),
    [],
  );
  const guarda = useMemo(() => ({ informarSujo }), [informarSujo]);
  const dirty = Object.values(sujas).some(Boolean);
  const { requestAction, confirm } = useUnsavedGuard({ dirty, blockNav: true });
  const atual = abas.includes(aba) ? aba : "produtos";
  return (
    <GuardaIntegracaoContext.Provider value={guarda}>
      <div className="space-y-4 p-4 pb-24 md:p-6">
        <Breadcrumb items={[{ label: "Sistema" }, { label: "Integração" }]} />
        <div className="flex items-center gap-3">
          <h1 className="font-display text-2xl font-semibold">Integração</h1>
          <UnsavedIndicator show={dirty} />
        </div>
        <Tabs value={atual} onValueChange={(v) => { if (v !== atual) requestAction(() => setAba(v as Aba)); }}>
          <TabsList className="max-w-full overflow-x-auto">
            {abas.map((a) => (
              <TabsTrigger key={a} value={a}>{ROTULO_ABA[a]}</TabsTrigger>
            ))}
          </TabsList>
          {abas.map((a) => {
            const C = CONTEUDO_ABA[a];
            return (
              <TabsContent key={a} value={a} className="mt-4">
                <C />
              </TabsContent>
            );
          })}
        </Tabs>
      </div>
      <UnsavedChangesGuard confirm={confirm} />
    </GuardaIntegracaoContext.Provider>
  );
}
```

- [ ] **Step 6: Rodar (PASS), gates e commit**

```bash
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres
npx vitest run --no-file-parallelism tests/unit/integracao-salvar.test.ts tests/unit/integracao-tela-fonte.test.ts
bash .superpowers/integracao/gates.sh
git add -- src/components/integracao/salvar-integracao.ts src/components/integracao/useIntegracao.ts src/components/integracao/guard.ts \
  src/components/integracao/IntegracaoPage.tsx tests/unit/integracao-salvar.test.ts tests/unit/integracao-tela-fonte.test.ts
git commit --only -m "feat(integracao): Salvar em 3 passos (fotos, integracao_salvar, SKUs), hooks de dados e guarda única da página

Co-Authored-By: Claude <modelo real> <noreply@anthropic.com>" -- src/components/integracao/salvar-integracao.ts \
  src/components/integracao/useIntegracao.ts src/components/integracao/guard.ts src/components/integracao/IntegracaoPage.tsx \
  tests/unit/integracao-salvar.test.ts tests/unit/integracao-tela-fonte.test.ts
git show --stat HEAD | tail -n +7
```
Expected: PASS (salvar 4 · tela-fonte 8); `GATES INTEGRACAO: ok`. Revisão individual (Opus + `code-reviewer`): ordem dos
passos, fotos órfãs, contrato do P0409.

---

### Task 12a: Aba Produtos (1/2) — decisão editar × ler, células e tabela com sublinhas

**Files:**
- Create: `src/lib/integracao/celula.ts` (decisão PURA editar × ler de cada célula)
- Create: `src/components/integracao/CelulaCampo.tsx`, `src/components/integracao/ProdutosTabela.tsx`
- Test: `tests/unit/integracao-celula.test.ts`

**Interfaces:**
- Consumes: Tasks 9–11 (`CAMPO_BY_KEY`, `CampoDef`, `infoCusto`; `produtos.ts`; `rascunho.ts`); `sku-previa.ts` (`digitarSku`,
  `skuExibido`, `situacaoPrevia`, `chaveLinhaSku`); `useAuth` (`canView` — N6).
- Produces: `modoCelula(campo, p, salvando): {tipo:"editar"} | {tipo:"leitura", motivo, travado}`, `infoEdicao(campo, p)`,
  `TEXTO_TRAVADO_INTEGRAVEL`, `TEXTO_TRAVADO_INTEGRADO`; `<CelulaCampo campo produto indice rascunho previa salvando
  onAtualizar onKeywords onFotos/>` ("abrir card" só para quem vê o Planejamento — N6); `<ProdutosTabela lista rascunhoDe
  previas salvando onAtualizar onKeywords onFotos estadoCelula integravelCelula? selecao?/>` (`type SelecaoTabela = {todos,
  alguns, onTodos, marcado, onMarcar}` — a Task 13 liga seleção e a coluna "Integrável"). Os componentes ficam prontos mas
  ainda NÃO ligados na página (a Task 12b liga).

- [ ] **Step 1: Escrever o teste (falha: arquivo ausente)**

`tests/unit/integracao-celula.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { CAMPO_BY_KEY } from "@/lib/integracao/campos";
import { lerLista } from "@/lib/integracao/produtos";
import { TEXTO_TRAVADO_INTEGRADO, TEXTO_TRAVADO_INTEGRAVEL, infoEdicao, modoCelula } from "@/lib/integracao/celula";

const g = (ok: boolean, motivo: string | null = null) => ({ ok, motivo });
const p = (o: Record<string, unknown> = {}) => lerLista({ campos: [], produtos: [{ modelo_id: "m1", origem: "interno",
  estado: "nao_integravel", rev: 1, raw: { nome: "X", tamanho_tipo: "letra" },
  gates: { compartilhado: g(true), planejamento: g(true), preco: g(false, "Precisa da permissão de preço de venda."),
    ref: g(false, "REF travada pelo envio à Explosão — não pode mudar depois desse ponto."), sku: g(true), keywords: g(true) }, ...o }] }).produtos[0];
const c = (k: string) => CAMPO_BY_KEY.get(k as never)!;

describe("modoCelula — quem decide editar × ler", () => {
  it("gate do servidor aberto = edita; fechado = lê com o motivo do card", () => {
    expect(modoCelula(c("peso"), p(), false)).toEqual({ tipo: "editar" });
    expect(modoCelula(c("preco_venda"), p(), false)).toEqual({ tipo: "leitura", motivo: "Precisa da permissão de preço de venda.", travado: false });
    expect(modoCelula(c("ref_sku"), p(), false)).toMatchObject({ tipo: "leitura", motivo: "REF travada pelo envio à Explosão — não pode mudar depois desse ponto." });
  });
  it("custo/cor/tamanho, metatag e keywords nunca editam na célula (P-80 A; Keywords = diálogo)", () => {
    for (const k of ["preco_custo", "cor_base", "cor_apelido", "tamanho", "metatag", "keywords"]) {
      expect(modoCelula(c(k), p(), false).tipo, k).toBe("leitura");
    }
  });
  it("integrável/integrado = travado (cadeado), qualquer campo", () => {
    expect(modoCelula(c("nome"), p({ estado: "integravel" }), false)).toEqual({ tipo: "leitura", motivo: TEXTO_TRAVADO_INTEGRAVEL, travado: true });
    expect(modoCelula(c("nome"), p({ estado: "integrado" }), false)).toEqual({ tipo: "leitura", motivo: TEXTO_TRAVADO_INTEGRADO, travado: true });
  });
  it("salvando = nada edita", () => {
    expect(modoCelula(c("peso"), p(), true)).toEqual({ tipo: "leitura", motivo: "Salvando…", travado: false });
  });
  it("informação de quem edita (textos do mockup)", () => {
    expect(infoEdicao(c("ref_sku"), p({ origem: "revenda" }))).toBe("REF da revenda: nasce no cadastro do Produto Acabado; editar aqui muda nos dois lugares (mão dupla).");
    expect(infoEdicao(c("preco_venda"), p({ origem: "revenda" }))).toBe('Grava como preço FIXO de revenda (mesma regra do card — "última edição manda").');
    expect(infoEdicao(c("ref_sku"), p())).toBe("REF manual liberada (etapa já revela a REF neste card) — editar aqui edita o card também.");
    expect(infoEdicao(c("peso"), p())).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres
npx vitest run --no-file-parallelism tests/unit/integracao-celula.test.ts
```
Expected: FAIL — `Failed to resolve import "@/lib/integracao/celula"`.

- [ ] **Step 3: `src/lib/integracao/celula.ts`**

```ts
// Integração — decisão PURA de cada célula da aba Produtos: editar ou só ler (e por quê) + o "i" de quem edita. Os gates
// vêm do servidor (D24); aqui só a ordem: estado (trava) → só leitura por natureza (P-80 A) → gate → salvando.
import type { CampoDef } from "@/lib/integracao/campos";
import type { ProdutoLista } from "@/lib/integracao/produtos";

export type ModoCelula = { tipo: "editar" } | { tipo: "leitura"; motivo: string | null; travado: boolean };
export const TEXTO_TRAVADO_INTEGRAVEL = "Integrável — travado. Volte para não integrável para editar.";
export const TEXTO_TRAVADO_INTEGRADO = "Integrado — travado. Só o super admin desfaz a integração.";

export function modoCelula(campo: CampoDef, p: ProdutoLista, salvando: boolean): ModoCelula {
  if (p.estado !== "nao_integravel") {
    return { tipo: "leitura", motivo: p.estado === "integrado" ? TEXTO_TRAVADO_INTEGRADO : TEXTO_TRAVADO_INTEGRAVEL, travado: true };
  }
  if (campo.tipo === "somente_leitura" || campo.key === "metatag" || campo.key === "keywords" || !campo.gate) {
    return { tipo: "leitura", motivo: null, travado: false };
  }
  const g = p.gates[campo.gate];
  if (!g.ok) return { tipo: "leitura", motivo: g.motivo, travado: false };
  if (salvando) return { tipo: "leitura", motivo: "Salvando…", travado: false };
  return { tipo: "editar" };
}

export function infoEdicao(campo: CampoDef, p: ProdutoLista): string | null {
  if (campo.key === "ref_sku") {
    if (p.origem === "revenda") return "REF da revenda: nasce no cadastro do Produto Acabado; editar aqui muda nos dois lugares (mão dupla).";
    if (p.origem === "importado") return "REF do importado: nasce no cadastro do Produto Importado; editar aqui muda nos dois lugares (mão dupla).";
    return "REF manual liberada (etapa já revela a REF neste card) — editar aqui edita o card também.";
  }
  if (campo.key === "preco_venda" && p.origem === "revenda") return 'Grava como preço FIXO de revenda (mesma regra do card — "última edição manda").';
  if (campo.key === "preco_venda" && p.origem === "importado") return 'Grava como preço FIXO do importado (mesma regra do card — "última edição manda").';
  if (campo.key === "foto") return "As fotos novas só sobem no Salvar da página.";
  return null;
}
```

- [ ] **Step 4: `src/components/integracao/CelulaCampo.tsx`**

```tsx
// Integração — uma célula da aba Produtos (linha do produto ou sublinha variante × tamanho). Edita SÓ o rascunho (staging);
// `modoCelula` decide editar × ler. Custo, cor, apelido e tamanho: só leitura com "i" + "abrir card" (P-80 A). Linha
// integrável/integrada: RETRATO + cadeado; "i" âmbar quando o vivo difere (N10). SKU da sublinha: digitado vira "a gravar"
// (mesmas regras da seção Códigos) e a prévia do servidor diz a situação.
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { InfoHover } from "@/components/shared/InfoHover";
import { MoneyInput } from "@/components/shared/MoneyInput";
import { NumberInput } from "@/components/shared/NumberInput";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { infoCusto, type CampoDef, type ColunaEditavel } from "@/lib/integracao/campos";
import { infoEdicao, modoCelula } from "@/lib/integracao/celula";
import {
  avisoRetrato, linhasVariante, textoFotos, usaRetrato, valorCelula, type ProdutoLista, type Sublinha,
} from "@/lib/integracao/produtos";
import {
  colunasAlteradas, comSkus, editar, linhaSkuDaSublinha, manterMeu, usarNovo, type Rascunho,
} from "@/lib/integracao/rascunho";
import {
  chaveLinhaSku, digitarSku, situacaoPrevia, skuExibido, type PreviaSkus,
} from "@/components/planejamento/planejamento-detail/codigos/sku-previa";

type Props = {
  campo: CampoDef; produto: ProdutoLista; indice: number | null; rascunho: Rascunho; previa: PreviaSkus | undefined;
  salvando: boolean; onAtualizar: (f: (r: Rascunho) => Rascunho) => void; onKeywords: () => void; onFotos: () => void;
};

function AbrirCard({ id }: { id: string }) {
  // N6 (G-plano do plano): quem só tem a permissão "Integração" não abre o Planejamento — o link some
  const { canView } = useAuth();
  if (!canView("criacao_planejamento")) return null;
  return (
    <Link to="/criacao/planejamento" search={{ modelo: id }} className="shrink-0 text-xs text-primary underline-offset-2 hover:underline">
      abrir card
    </Link>
  );
}
function Leitura({ texto, info, aviso, travado, cardId, selo }: {
  texto: string; info?: string | null; aviso?: string | null; travado?: boolean; cardId?: string; selo?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-1">
      {travado && <Lock className="h-4 w-4 shrink-0 text-muted-foreground" aria-label="Travado" />}
      <span className={cn("max-w-[16rem] truncate", texto === "—" && "text-muted-foreground")} title={texto}>{texto}</span>
      {selo}
      {info && <InfoHover ariaLabel="Informação do campo">{info}</InfoHover>}
      {aviso && <InfoHover ariaLabel="Mudou depois do retrato" className="text-[var(--tone-warning-fg)]">{aviso}</InfoHover>}
      {cardId && <AbrirCard id={cardId} />}
    </div>
  );
}
function sublinhaDe(p: ProdutoLista, indice: number): Sublinha | undefined {
  const l = linhasVariante(p)[indice];
  return l ? p.sublinhas.find((s) => s.varianteKey === l.varianteKey && s.tamanhoKey === l.tamanhoKey) : undefined;
}

function SkuCelula({ p, indice, r, previa, salvando, onAtualizar }: {
  p: ProdutoLista; indice: number; r: Rascunho; previa: PreviaSkus | undefined; salvando: boolean;
  onAtualizar: (f: (r: Rascunho) => Rascunho) => void;
}) {
  const sub = sublinhaDe(p, indice);
  const editavel = p.estado === "nao_integravel" && p.gates.sku.ok && !salvando && !!sub;
  if (!editavel || !sub) {
    return (
      <Leitura texto={valorCelula(p, "ref_sku", indice)} travado={p.estado !== "nao_integravel"}
        info={p.estado === "nao_integravel" && !p.gates.sku.ok ? p.gates.sku.motivo : null} />
    );
  }
  const linha = linhaSkuDaSublinha(sub);
  const exibido = skuExibido(linha, r.skus);
  const digitado = r.skus.manuais[chaveLinhaSku(sub.varianteKey, sub.tamanhoKey)];
  const lp = previa?.matriz.linhas.find((x) => x.variante_key === sub.varianteKey && x.tamanho_key === sub.tamanhoKey);
  const sit = digitado && lp ? situacaoPrevia(lp, previa?.erros ?? []) : null;
  return (
    <div className="flex min-w-[10rem] flex-col gap-1">
      <Input
        key={exibido}
        defaultValue={exibido}
        aria-label="SKU"
        className={cn("h-8", digitado && "bg-[var(--tone-warning-bg)]")}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        onBlur={(e) => {
          const out = digitarSku(r.skus, linha, e.target.value);
          if (out.erro) {
            toast.error(out.erro);
            e.target.value = out.valor;
            return;
          }
          if (out.aGravar !== r.skus) onAtualizar((x) => comSkus(x, out.aGravar));
        }}
      />
      {sit && <StatusBadge tone={sit.tom} className="w-fit normal-case tracking-normal">{sit.texto}</StatusBadge>}
    </div>
  );
}

function CelulaSublinha({ campo, p, indice, r, previa, salvando, onAtualizar }: {
  campo: CampoDef; p: ProdutoLista; indice: number; r: Rascunho; previa: PreviaSkus | undefined; salvando: boolean;
  onAtualizar: (f: (r: Rascunho) => Rascunho) => void;
}) {
  if (campo.key === "ref_sku") return <SkuCelula p={p} indice={indice} r={r} previa={previa} salvando={salvando} onAtualizar={onAtualizar} />;
  const texto = valorCelula(p, campo.key, indice);
  if (campo.soVariante) {
    const sub = sublinhaDe(p, indice);
    const semApelido = campo.key === "cor_apelido" && !sub?.apelidoNome && !!sub?.corNome;
    return <Leitura texto={texto} info={semApelido ? "sem apelido — não bloqueia" : (campo.info ?? null)} cardId={p.modeloId} />;
  }
  return <span className="text-muted-foreground">{texto}</span>;
}

export function CelulaCampo({ campo, produto: p, indice, rascunho: r, previa, salvando, onAtualizar, onKeywords, onFotos }: Props) {
  if (indice !== null) {
    return <CelulaSublinha campo={campo} p={p} indice={indice} r={r} previa={previa} salvando={salvando} onAtualizar={onAtualizar} />;
  }
  const modo = modoCelula(campo, p, salvando);
  const travado = modo.tipo === "leitura" && modo.travado;
  const aviso = avisoRetrato(p, campo.key);
  const selo = campo.key === "nome" && usaRetrato(p) ? <StatusBadge tone="neutral">retrato</StatusBadge> : null;
  if (campo.tipo === "somente_leitura") {
    const info = campo.key === "preco_custo" ? infoCusto(p.origem) : (campo.info ?? null);
    return <Leitura texto={valorCelula(p, campo.key, null)} info={info} aviso={aviso} travado={travado} cardId={p.modeloId} />;
  }
  if (campo.key === "metatag") {
    const texto = p.estado === "nao_integravel" ? (String(r.valores.descricao_produto ?? "").trim() || "—") : valorCelula(p, "metatag", null);
    return <Leitura texto={texto} info={campo.info ?? null} aviso={aviso} travado={travado} />;
  }
  if (campo.key === "keywords") {
    const g = p.gates.keywords;
    const pode = p.estado === "nao_integravel" && g.ok && !salvando;
    return (
      <div className="flex min-w-0 items-center gap-1">
        {travado && <Lock className="h-4 w-4 shrink-0 text-muted-foreground" aria-label="Travado" />}
        <span className="max-w-[14rem] truncate">{valorCelula(p, "keywords", null)}</span>
        {pode ? (
          <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={onKeywords}>editar</Button>
        ) : p.estado === "nao_integravel" && g.motivo ? (
          <InfoHover ariaLabel="Por que não edita">{g.motivo}</InfoHover>
        ) : null}
        {aviso && <InfoHover ariaLabel="Mudou depois do retrato" className="text-[var(--tone-warning-fg)]">{aviso}</InfoHover>}
      </div>
    );
  }
  if (modo.tipo === "leitura") {
    return <Leitura texto={valorCelula(p, campo.key, null)} info={modo.motivo} aviso={aviso} travado={modo.travado} selo={selo} />;
  }
  const col = campo.coluna as ColunaEditavel;
  const alterada = colunasAlteradas(r).includes(col);
  const conflito = r.conflitos.find((c) => c.path === col);
  const info = infoEdicao(campo, p);
  const set = (v: string | number | null) => onAtualizar((x) => editar(x, col, v as never));
  const numero = (s: string): number | null => (s.trim() === "" ? null : Number(s));
  const realce = cn(alterada && "bg-[var(--tone-warning-bg)]", conflito && "ring-2 ring-[var(--tone-warning-fg)]");
  let controle: ReactNode;
  if (campo.tipo === "fotos") {
    controle = (
      <Button type="button" variant="outline" size="sm" className={realce} onClick={onFotos}>
        {textoFotos(r.valores.fotos_modelo.length)} · trocar/adicionar/remover
      </Button>
    );
  } else if (campo.tipo === "dinheiro") {
    controle = (
      <MoneyInput fixedDecimals aria-label={campo.rotulo} placeholder="0,00" className={cn("h-8 w-28 text-right tabular-nums", realce)}
        value={(r.valores[col] as number | null) ?? ""} onChange={(e) => set(numero(e.target.value))} />
    );
  } else if (campo.tipo === "peso" || campo.tipo === "medida") {
    controle = (
      <NumberInput aria-label={campo.rotulo} className={cn("h-8 w-24 text-right tabular-nums", realce)}
        value={(r.valores[col] as number | null) ?? ""} onChange={(e) => set(numero(e.target.value))} />
    );
  } else if (campo.tipo === "texto_longo") {
    controle = (
      <Textarea aria-label={campo.rotulo} rows={2} className={cn("min-h-8 min-w-[14rem] text-xs", realce)}
        value={String(r.valores[col] ?? "")} onChange={(e) => set(e.target.value)} />
    );
  } else {
    controle = (
      <Input aria-label={campo.rotulo} className={cn("h-8 min-w-[9rem]", realce)}
        value={String(r.valores[col] ?? "")} onChange={(e) => set(e.target.value)} />
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex items-center gap-1">
        {controle}
        {info && <InfoHover ariaLabel="Sobre este campo">{info}</InfoHover>}
      </div>
      {conflito && (
        <div className="flex flex-wrap items-center gap-1 text-xs">
          <span className="text-[var(--tone-warning-fg)]">Outra pessoa mudou este campo.</span>
          <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => onAtualizar((x) => manterMeu(x, col))}>
            manter o meu
          </Button>
          <span aria-hidden>·</span>
          <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => onAtualizar((x) => usarNovo(x, col))}>
            usar o novo
          </Button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: `src/components/integracao/ProdutosTabela.tsx`**

```tsx
// Integração — tabela da aba Produtos. Colunas: [seleção] · seta · Estado · [Integrável] · campos marcados (ordem fixa —
// "Colunas exibidas = campos marcados em Campos da API"). A seta abre as sublinhas (variante × tamanho). A tabela rola
// DENTRO do container; a página não rola na horizontal. Seleção e "Integrável" chegam na Task 13 (props opcionais).
import { Fragment, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { CAMPO_BY_KEY, type CampoDef } from "@/lib/integracao/campos";
import { ROTULO_ORIGEM, linhasVariante, type ListaIntegracao, type ProdutoLista } from "@/lib/integracao/produtos";
import type { Rascunho } from "@/lib/integracao/rascunho";
import type { PreviaSkus } from "@/components/planejamento/planejamento-detail/codigos/sku-previa";
import { CelulaCampo } from "./CelulaCampo";

export type SelecaoTabela = {
  todos: boolean; alguns: boolean; onTodos: (v: boolean) => void; marcado: (id: string) => boolean;
  onMarcar: (id: string, v: boolean) => void;
};
type Props = {
  lista: ListaIntegracao; rascunhoDe: (p: ProdutoLista) => Rascunho; previas: Record<string, PreviaSkus | undefined>;
  salvando: boolean; onAtualizar: (p: ProdutoLista, f: (r: Rascunho) => Rascunho) => void; onKeywords: () => void;
  onFotos: (p: ProdutoLista) => void; estadoCelula: (p: ProdutoLista) => ReactNode;
  integravelCelula?: (p: ProdutoLista) => ReactNode; selecao?: SelecaoTabela;
};

export function ProdutosTabela({
  lista, rascunhoDe, previas, salvando, onAtualizar, onKeywords, onFotos, estadoCelula, integravelCelula, selecao,
}: Props) {
  const [abertos, setAbertos] = useState<ReadonlySet<string>>(new Set());
  const alternar = (id: string) => setAbertos((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  const campos = lista.campos.map((k) => CAMPO_BY_KEY.get(k)).filter((c): c is CampoDef => !!c);
  return (
    <div className="max-w-full overflow-x-auto rounded-md border">
      <table className="w-full min-w-max border-collapse text-sm">
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>
            {selecao && (
              <th className="w-10 px-2 py-2">
                <Checkbox aria-label="Selecionar todos da página" checked={selecao.todos ? true : selecao.alguns ? "indeterminate" : false}
                  onCheckedChange={(v) => selecao.onTodos(v === true)} />
              </th>
            )}
            <th className="w-10 px-1 py-2"><span className="sr-only">Sublinhas</span></th>
            <th className="px-2 py-2">Estado</th>
            {integravelCelula && <th className="px-2 py-2">Integrável</th>}
            {campos.map((c) => <th key={c.key} className="whitespace-nowrap px-2 py-2 font-medium">{c.rotuloCurto}</th>)}
          </tr>
        </thead>
        <tbody>
          {lista.produtos.map((p) => {
            const r = rascunhoDe(p);
            const subs = linhasVariante(p);
            const aberto = abertos.has(p.modeloId);
            const celula = (c: CampoDef, indice: number | null) => (
              <CelulaCampo campo={c} produto={p} indice={indice} rascunho={r} previa={previas[p.modeloId]} salvando={salvando}
                onAtualizar={(f) => onAtualizar(p, f)} onKeywords={onKeywords} onFotos={() => onFotos(p)} />
            );
            return (
              <Fragment key={p.modeloId}>
                <tr className="border-t align-top">
                  {selecao && (
                    <td className="px-2 py-2">
                      <Checkbox aria-label={`Selecionar ${p.raw.nome}`} checked={selecao.marcado(p.modeloId)}
                        onCheckedChange={(v) => selecao.onMarcar(p.modeloId, v === true)} />
                    </td>
                  )}
                  <td className="px-1 py-2">
                    <Button type="button" variant="ghost" size="iconSm" disabled={subs.length === 0}
                      aria-label={aberto ? "Fechar sublinhas" : "Abrir sublinhas"} onClick={() => alternar(p.modeloId)}>
                      {aberto ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </Button>
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex flex-col gap-1">
                      {estadoCelula(p)}
                      {p.origem !== "interno" && <StatusBadge tone="info" className="w-fit">{ROTULO_ORIGEM[p.origem]}</StatusBadge>}
                    </div>
                  </td>
                  {integravelCelula && <td className="px-2 py-2">{integravelCelula(p)}</td>}
                  {campos.map((c) => <td key={c.key} className="px-2 py-2">{celula(c, null)}</td>)}
                </tr>
                {aberto && subs.map((_, i) => (
                  <tr key={`${p.modeloId}:${i}`} className="border-t border-dashed bg-muted/20 align-top text-xs">
                    {selecao && <td />}
                    <td />
                    <td className="px-2 py-2 text-muted-foreground">sublinha</td>
                    {integravelCelula && <td />}
                    {campos.map((c) => <td key={c.key} className="px-2 py-2">{celula(c, i)}</td>)}
                  </tr>
                ))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 6: Rodar (PASS), gates e commit**

```bash
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres
npx vitest run --no-file-parallelism tests/unit/integracao-celula.test.ts
bash .superpowers/integracao/gates.sh
git add -- src/lib/integracao/celula.ts src/components/integracao/CelulaCampo.tsx src/components/integracao/ProdutosTabela.tsx \
  tests/unit/integracao-celula.test.ts
git commit --only -m "feat(integracao): aba Produtos (1/2) — decisão editar × ler, células (SKU, conflito, retrato) e tabela com sublinhas

Co-Authored-By: Claude <modelo real> <noreply@anthropic.com>" -- src/lib/integracao/celula.ts src/components/integracao/CelulaCampo.tsx \
  src/components/integracao/ProdutosTabela.tsx tests/unit/integracao-celula.test.ts
git show --stat HEAD | tail -n +7
```
Expected: PASS (celula 5); `GATES INTEGRACAO: ok` (tsc compila os 2 componentes ainda sem uso). Revisão individual (Opus +
`code-reviewer`): regra editar × ler, SKU "a gravar", conflito "manter o meu · usar o novo".

---

### Task 12b: Aba Produtos (2/2) — filtros, paginação, staging/merge, Salvar, fotos e Keywords

**Files:**
- Create: `src/components/integracao/ProdutosAba.tsx`, `src/components/integracao/FotosDialog.tsx`,
  `src/components/integracao/KeywordsDialog.tsx`
- Modify: `src/components/integracao/IntegracaoPage.tsx` (`CONTEUDO_ABA.produtos = ProdutosAba`)
- Test: bloco novo em `tests/unit/integracao-tela-fonte.test.ts`

**Interfaces:**
- Consumes: Task 12a (`ProdutosTabela`, `CelulaCampo`); Tasks 9–11 (`TEXTO_MAO_DUPLA`; `produtos.ts`; `rascunho.ts`;
  `useIntegracaoLista`, `useIntegracaoAoVivo(ids)`, `usePreviasSkus`, `useSalvarIntegracao`, `invalidarIntegracao`;
  `useAbaSuja`); `useSignedUrlBucket` (`@/components/planejamento/modelo-shared`); RPC `integracao_salvar(_itens [],
  _keywords {valor, esperado})`.
- Produces: `<ProdutosAba/>`; `<FotosDialog produto rascunho onAtualizar onFechar/>`; `<KeywordsDialog atual onFechar/>`.

- [ ] **Step 1: Escrever o teste (falha: arquivos ausentes)**

Acrescentar ao FIM de `tests/unit/integracao-tela-fonte.test.ts`:

```ts
describe("Integração — aba Produtos", () => {
  it("é a aba ligada no mapa da página e abre em 'Não integrados'", () => {
    expect(ler("src/components/integracao/IntegracaoPage.tsx")).toMatch(/produtos: ProdutosAba/);
    const s = ler("src/components/integracao/ProdutosAba.tsx");
    expect(s).toMatch(/useState<Situacao>\("nao_integrados"\)/);
    expect(s).toMatch(/useAbaSuja\("produtos", sujo\)/);
    expect(s).toMatch(/50 por página/);
  });
  it("upload de foto só no Salvar (o diálogo de fotos não sobe arquivo)", () => {
    const f = ler("src/components/integracao/FotosDialog.tsx");
    expect(f).not.toMatch(/uploadFile|storage\.from/);
  });
  it("Keywords grava SÓ a coluna da loja, com o valor carregado (R5)", () => {
    const k = ler("src/components/integracao/KeywordsDialog.tsx");
    expect(k).toMatch(/_keywords: \{ valor: texto, esperado: base \}/);
    expect(k).not.toMatch(/from\("tenant_config"\)/);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres
npx vitest run --no-file-parallelism tests/unit/integracao-tela-fonte.test.ts
```
Expected: FAIL — `ENOENT … ProdutosAba.tsx`.

- [ ] **Step 3: `src/components/integracao/FotosDialog.tsx` e `src/components/integracao/KeywordsDialog.tsx`**

```tsx
// Integração — fotos do produto (a MESMA lista do card: modelos.fotos_modelo). Trocar/adicionar/remover mexe SÓ no rascunho;
// as fotos novas sobem no Salvar da página (salvar-integracao.ts). Ordem = a do card (Foto 1..N).
import { useEffect, useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSignedUrlBucket } from "@/components/planejamento/modelo-shared";
import type { ProdutoLista } from "@/lib/integracao/produtos";
import { PREFIXO_FOTO_NOVA, adicionarFotos, removerFoto, type FotoNova, type Rascunho } from "@/lib/integracao/rascunho";

function Miniatura({ item, fotosNovas }: { item: string; fotosNovas: FotoNova[] }) {
  const nova = item.startsWith(PREFIXO_FOTO_NOVA) ? fotosNovas.find((n) => PREFIXO_FOTO_NOVA + n.id === item) : undefined;
  const assinada = useSignedUrlBucket(nova ? null : item);
  const [local, setLocal] = useState<string | null>(null);
  useEffect(() => {
    if (!nova) return;
    const u = URL.createObjectURL(nova.file);
    setLocal(u);
    return () => URL.revokeObjectURL(u);
  }, [nova]);
  const src = nova ? local : assinada;
  return src
    ? <img src={src} alt="" className="h-24 w-24 rounded-md border object-cover" />
    : <div className="h-24 w-24 rounded-md border bg-muted" />;
}

export function FotosDialog({ produto, rascunho, onAtualizar, onFechar }: {
  produto: ProdutoLista; rascunho: Rascunho; onAtualizar: (f: (r: Rascunho) => Rascunho) => void; onFechar: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const itens = rascunho.valores.fotos_modelo;
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onFechar(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Fotos — {produto.raw.nome}</DialogTitle>
          <DialogDescription>As mesmas fotos do card do produto. As novas só sobem quando você clicar em Salvar na página.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-3">
          {itens.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma foto.</p>}
          {itens.map((item, i) => (
            <div key={item} className="relative">
              <Miniatura item={item} fotosNovas={rascunho.fotosNovas} />
              <span className="absolute left-1 top-1 rounded bg-background/90 px-1 text-xs tabular-nums">Foto {i + 1}</span>
              <Button type="button" variant="outline" size="iconSm" className="absolute -right-2 -top-2 bg-background max-sm:h-11 max-sm:w-11"
                aria-label={`Remover foto ${i + 1}`} onClick={() => onAtualizar((r) => removerFoto(r, item))}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
        <input ref={input} type="file" accept="image/*" multiple className="hidden"
          onChange={(e) => {
            const arquivos = Array.from(e.target.files ?? []);
            e.target.value = "";
            onAtualizar((r) => adicionarFotos(r, arquivos.map((file) => ({ id: crypto.randomUUID(), file }))));
          }} />
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => input.current?.click()}>
            <ImagePlus className="h-4 w-4" />Adicionar fotos
          </Button>
          <Button type="button" onClick={onFechar}>Concluído</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

```tsx
// Integração — Keywords da LOJA (texto único, vale para TODOS os produtos — mockup 6c). Grava SÓ a coluna
// tenant_config.keywords por integracao_salvar(_keywords) com o valor carregado (R5: nunca o upsert da linha da Config);
// se alguém mudou no meio, P0409 keywords_mudou → a lista relê e o texto recarrega.
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { InfoHover } from "@/components/shared/InfoHover";
import { UnsavedChangesGuard, useUnsavedGuard } from "@/components/shared/UnsavedChangesGuard";
import { supabase } from "@/integrations/supabase/client";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { mensagemErro } from "@/lib/erro-mensagem";
import { invalidarIntegracao } from "./useIntegracao";

export function KeywordsDialog({ atual, onFechar }: { atual: string | null; onFechar: () => void }) {
  const tenantId = useActiveTenantId();
  const qc = useQueryClient();
  const [texto, setTexto] = useState(atual ?? "");
  const [base, setBase] = useState(atual ?? "");
  const [salvando, setSalvando] = useState(false);
  const [recarregar, setRecarregar] = useState(false);
  useEffect(() => {
    if (!recarregar) return;
    setTexto(atual ?? "");
    setBase(atual ?? "");
    setRecarregar(false);
  }, [atual, recarregar]);
  const dirty = texto !== base;
  const { requestClose, confirm } = useUnsavedGuard({ dirty, onClose: onFechar });
  const salvar = async () => {
    setSalvando(true);
    try {
      // `base` = o texto que ESTE diálogo carregou (não o `atual` da lista, que pode ter relido no meio) — R5.
      const { error } = await supabase.rpc("integracao_salvar" as any, { _itens: [], _keywords: { valor: texto, esperado: base } });
      if (error) throw error;
      toast.success("Keywords da loja salvas.");
      invalidarIntegracao(qc, tenantId);
      onFechar();
    } catch (e) {
      toast.error(mensagemErro(e, "Não foi possível salvar as Keywords."));
      if ((e as { code?: string })?.code === "P0409") {
        setRecarregar(true);
        invalidarIntegracao(qc, tenantId);
      }
    } finally {
      setSalvando(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) requestClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Keywords da loja</DialogTitle>
          <DialogDescription>Muda para TODOS os produtos da loja.</DialogDescription>
        </DialogHeader>
        <div className="rounded-md bg-[var(--tone-warning-bg)] p-3 text-sm text-[var(--tone-warning-fg)]">
          Muda para TODOS os produtos da loja (os já integráveis/integrados mantêm o retrato).
        </div>
        <div className="grid gap-1">
          <div className="flex items-center gap-1">
            <Label htmlFor="integracao-keywords">Texto (separado por vírgula)</Label>
            <InfoHover ariaLabel="Como grava">Grava só o texto das Keywords da loja; se alguém mudou enquanto você editava, a tela avisa.</InfoHover>
          </div>
          <Textarea id="integracao-keywords" rows={3} value={texto} onChange={(e) => setTexto(e.target.value)} />
        </div>
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={requestClose}>Cancelar</Button>
          <Button type="button" disabled={!dirty || salvando} onClick={() => void salvar()}>{salvando ? "Salvando…" : "Salvar"}</Button>
        </DialogFooter>
      </DialogContent>
      <UnsavedChangesGuard confirm={confirm} />
    </Dialog>
  );
}
```

- [ ] **Step 4: `src/components/integracao/ProdutosAba.tsx` e ligar no mapa da página**

```tsx
// Integração — aba Produtos (spec §6, mockup 2). Situação (padrão "Não integrados") + coleção/etapa/origem/estado + busca;
// páginas de 50; células editáveis enquanto "não integrável" (rascunho por produto — só o Salvar grava; rev/P0409 + merge
// 3-vias com o que chega do servidor). Estados (integrar/voltar/desfazer): Task 13. Celular: sem esta tela (P-87 — Task 18).
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { ArrowLeft, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/shared/EmptyState";
import { InfoHover } from "@/components/shared/InfoHover";
import { PageActionBar } from "@/components/shared/PageActionBar";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { useStoreTimezone } from "@/hooks/useStoreTimezone";
import { mensagemErro } from "@/lib/erro-mensagem";
import { TEXTO_MAO_DUPLA } from "@/lib/integracao/campos";
import {
  FILTROS_VAZIOS, ROTULO_ESTADO, ROTULO_ORIGEM, faixaPagina, rotuloEstado, textoFaltas, tomEstado, totalPaginas,
  type EstadoIntegracao, type Filtros, type ProdutoLista, type Situacao,
} from "@/lib/integracao/produtos";
import { aposSalvar, mesclar, novoRascunho, temAlteracao, type Rascunho } from "@/lib/integracao/rascunho";
import { useAbaSuja } from "./guard";
import { useIntegracaoAoVivo, useIntegracaoLista, usePreviasSkus, useSalvarIntegracao } from "./useIntegracao";
import { ProdutosTabela } from "./ProdutosTabela";
import { FotosDialog } from "./FotosDialog";
import { KeywordsDialog } from "./KeywordsDialog";

const TODOS = "__todos__";
const SITUACOES: { key: Situacao; rotulo: string }[] = [
  { key: "nao_integrados", rotulo: "Não integrados" },
  { key: "integrados", rotulo: "Integrados" },
  { key: "todos", rotulo: "Todos" },
];
const TEXTO_ESTADO_DENTRO =
  'Estado filtra DENTRO da Situação escolhida acima (ex.: Situação "Não integrados" + Estado "Integrável" mostra só quem já está integrável, ainda não integrado).';
const TEXTO_TRAVA_FILTRO = "Salve ou descarte as alterações antes de trocar de filtro ou de página.";

function FiltroSelect({ id, rotulo, valor, opcoes, desabilitado, info, onMudar }: {
  id: string; rotulo: string; valor: string | null; opcoes: { key: string; label: string }[]; desabilitado: boolean;
  info?: string; onMudar: (v: string | null) => void;
}) {
  return (
    <div className="grid gap-1">
      <div className="flex items-center gap-1">
        <Label htmlFor={id}>{rotulo}</Label>
        {info && <InfoHover ariaLabel={`Sobre o filtro ${rotulo}`}>{info}</InfoHover>}
      </div>
      <Select value={valor ?? TODOS} disabled={desabilitado} onValueChange={(v) => onMudar(v === TODOS ? null : v)}>
        <SelectTrigger id={id} title={desabilitado ? TEXTO_TRAVA_FILTRO : undefined}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={TODOS}>Todos</SelectItem>
          {opcoes.map((o) => <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

export function ProdutosAba() {
  const router = useRouter();
  const tz = useStoreTimezone();
  const [situacao, setSituacao] = useState<Situacao>("nao_integrados");
  const [filtros, setFiltros] = useState<Filtros>(FILTROS_VAZIOS);
  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState(1);
  const [rascunhos, setRascunhos] = useState<Record<string, Rascunho>>({});
  const rascunhosRef = useRef(rascunhos);
  rascunhosRef.current = rascunhos;
  const [fotosDe, setFotosDe] = useState<ProdutoLista | null>(null);
  const [keywordsAberto, setKeywordsAberto] = useState(false);
  const q = useIntegracaoLista(situacao, filtros, pagina);
  useIntegracaoAoVivo((q.data?.produtos ?? []).map((p) => p.modeloId));
  const salvar = useSalvarIntegracao();
  const lista = q.data;
  const sujos = useMemo(() => Object.values(rascunhos).filter(temAlteracao), [rascunhos]);
  const sujo = sujos.length > 0;
  useAbaSuja("produtos", sujo);
  const previas = usePreviasSkus(sujos, lista?.pode.editar ?? false);
  const travaFiltro = sujo || salvar.isPending;

  useEffect(() => {
    const t = setTimeout(() => {
      setFiltros((f) => (f.busca === busca ? f : { ...f, busca }));
      setPagina(1);
    }, 400);
    return () => clearTimeout(t);
  }, [busca]);

  // Chegou versão nova do servidor: merge 3-vias por produto; quem virou integrável por outra pessoa perde o rascunho (avisa).
  useEffect(() => {
    if (!lista) return;
    const prox: Record<string, Rascunho> = {};
    const descartados: string[] = [];
    let mudou = false;
    for (const [id, r] of Object.entries(rascunhosRef.current)) {
      const p = lista.produtos.find((x) => x.modeloId === id);
      if (!p) { prox[id] = r; continue; }
      if (p.estado !== "nao_integravel") {
        mudou = true;
        if (temAlteracao(r)) descartados.push(r.nome);
        continue;
      }
      const m = mesclar(r, p);
      if (m !== r) mudou = true;
      prox[id] = m;
    }
    if (mudou) setRascunhos(prox);
    for (const nome of descartados) {
      toast.warning(`As alterações de "${nome}" foram descartadas: outra pessoa deixou o produto integrável.`);
    }
  }, [lista]);

  const rascunhoDe = (p: ProdutoLista): Rascunho => rascunhos[p.modeloId] ?? novoRascunho(p);
  const atualizar = (p: ProdutoLista, f: (r: Rascunho) => Rascunho) =>
    setRascunhos((rs) => ({ ...rs, [p.modeloId]: f(rs[p.modeloId] ?? novoRascunho(p)) }));

  const onSalvar = () => {
    if (sujos.some((r) => r.conflitos.length > 0)) {
      toast.error("Resolva os conflitos (manter o meu · usar o novo) antes de salvar.");
      return;
    }
    const enviados = sujos;
    salvar.mutate(enviados, {
      onSuccess: (res) => {
        setRascunhos((rs) => {
          const prox = { ...rs };
          for (const r of enviados) {
            const sobra = aposSalvar(r, { rev: res.revs[r.modeloId], fotos: res.fotos[r.modeloId], skusGravados: res.skusOk.includes(r.modeloId) });
            if (sobra) prox[r.modeloId] = sobra;
            else delete prox[r.modeloId];
          }
          return prox;
        });
        if (res.salvos > 0) toast.success(res.salvos === 1 ? "1 produto salvo." : `${res.salvos} produtos salvos.`);
        if (res.skusOk.length > 0) toast.success(`SKUs gravados em ${res.skusOk.length} produto(s).`);
        for (const f of res.skusFalhas) toast.error(`${f.nome}: ${f.texto}`);
      },
      onError: (e) => toast.error(mensagemErro(e, "Não foi possível salvar as alterações.")),
    });
  };

  const estadoCelula = (p: ProdutoLista) => (
    <div className="flex items-center gap-1">
      <StatusBadge tone={tomEstado(p.estado)} className="whitespace-nowrap normal-case tracking-normal">{rotuloEstado(p, tz)}</StatusBadge>
      {p.estado === "nao_integravel" && !p.completo && <InfoHover ariaLabel="O que falta">{textoFaltas(p.faltas)}</InfoHover>}
    </div>
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{TEXTO_MAO_DUPLA}</p>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Situação">
        {SITUACOES.map((s) => (
          <Button key={s.key} type="button" size="sm" variant={situacao === s.key ? "default" : "outline"} disabled={travaFiltro}
            aria-pressed={situacao === s.key}
            title={travaFiltro ? TEXTO_TRAVA_FILTRO : undefined} onClick={() => { setSituacao(s.key); setPagina(1); }}>
            {s.rotulo} <span className="tabular-nums">{lista?.contagens[s.key] ?? "—"}</span>
          </Button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <FiltroSelect id="f-colecao" rotulo="Coleção" valor={filtros.colecao} desabilitado={travaFiltro}
          opcoes={(lista?.opcoes.colecoes ?? []).map((c) => ({ key: c, label: c }))}
          onMudar={(v) => { setFiltros((f) => ({ ...f, colecao: v })); setPagina(1); }} />
        <FiltroSelect id="f-etapa" rotulo="Etapa" valor={filtros.etapa} desabilitado={travaFiltro} opcoes={lista?.opcoes.etapas ?? []}
          onMudar={(v) => { setFiltros((f) => ({ ...f, etapa: v })); setPagina(1); }} />
        <FiltroSelect id="f-origem" rotulo="Origem" valor={filtros.origem} desabilitado={travaFiltro}
          opcoes={Object.entries(ROTULO_ORIGEM).map(([key, label]) => ({ key, label }))}
          onMudar={(v) => { setFiltros((f) => ({ ...f, origem: v })); setPagina(1); }} />
        <FiltroSelect id="f-estado" rotulo="Estado" valor={filtros.estado} desabilitado={travaFiltro} info={TEXTO_ESTADO_DENTRO}
          opcoes={(Object.keys(ROTULO_ESTADO) as EstadoIntegracao[]).map((key) => ({ key, label: ROTULO_ESTADO[key] }))}
          onMudar={(v) => { setFiltros((f) => ({ ...f, estado: v as EstadoIntegracao | null })); setPagina(1); }} />
        <div className="grid gap-1">
          <Label htmlFor="f-busca">Buscar</Label>
          <Input id="f-busca" value={busca} placeholder="Nome ou REF" disabled={travaFiltro}
            title={travaFiltro ? TEXTO_TRAVA_FILTRO : undefined} onChange={(e) => setBusca(e.target.value)} />
        </div>
      </div>
      {q.isError ? (
        <EmptyState title="Não foi possível carregar os produtos" description={mensagemErro(q.error, "Erro ao carregar.")}
          action={<Button type="button" variant="outline" onClick={() => void q.refetch()}>Tentar de novo</Button>} />
      ) : !lista ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : lista.produtos.length === 0 ? (
        <EmptyState title="Nenhum produto" description="Nenhum produto nesta situação e filtros." />
      ) : (
        <>
          <ProdutosTabela lista={lista} rascunhoDe={rascunhoDe} previas={previas} salvando={salvar.isPending}
            onAtualizar={atualizar} onKeywords={() => setKeywordsAberto(true)} onFotos={setFotosDe} estadoCelula={estadoCelula} />
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground">{faixaPagina(lista)}</span>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" disabled={travaFiltro || lista.pagina <= 1}
                onClick={() => setPagina((n) => n - 1)}>Anterior</Button>
              <span className="text-muted-foreground">Página {lista.pagina} de {totalPaginas(lista)} (50 por página)</span>
              <Button type="button" variant="outline" size="sm" disabled={travaFiltro || lista.pagina >= totalPaginas(lista)}
                onClick={() => setPagina((n) => n + 1)}>Próxima</Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Colunas exibidas = campos marcados em "Campos da API" (ordem fixa; Estado e Integrável sempre antes delas).
          </p>
        </>
      )}
      {fotosDe && (
        <FotosDialog produto={fotosDe} rascunho={rascunhoDe(fotosDe)} onAtualizar={(f) => atualizar(fotosDe, f)} onFechar={() => setFotosDe(null)} />
      )}
      {keywordsAberto && lista && <KeywordsDialog atual={lista.keywords} onFechar={() => setKeywordsAberto(false)} />}
      <PageActionBar>
        <Button type="button" variant="outline" onClick={() => router.history.back()}>
          <ArrowLeft className="h-4 w-4" />Voltar
        </Button>
        <Button type="button" className="ml-auto" disabled={!sujo || salvar.isPending} onClick={onSalvar}>
          <Save className="h-4 w-4" />{salvar.isPending ? "Salvando…" : "Salvar"}
        </Button>
      </PageActionBar>
    </div>
  );
}
```

Em `src/components/integracao/IntegracaoPage.tsx`: acrescentar `import { ProdutosAba } from "./ProdutosAba";` e trocar
`  produtos: AbaPendente,` por `  produtos: ProdutosAba,`.

- [ ] **Step 5: Rodar (PASS), gates, conferência visual e commit**

```bash
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres
npx vitest run --no-file-parallelism tests/unit/integracao-celula.test.ts tests/unit/integracao-tela-fonte.test.ts
bash .superpowers/integracao/gates.sh
git add -- src/components/integracao/ProdutosAba.tsx src/components/integracao/FotosDialog.tsx \
  src/components/integracao/KeywordsDialog.tsx src/components/integracao/IntegracaoPage.tsx tests/unit/integracao-tela-fonte.test.ts
git commit --only -m "feat(integracao): aba Produtos (2/2) — filtros, paginação, staging com merge 3-vias, Salvar, fotos e Keywords

Co-Authored-By: Claude <modelo real> <noreply@anthropic.com>" -- src/components/integracao/ProdutosAba.tsx \
  src/components/integracao/FotosDialog.tsx src/components/integracao/KeywordsDialog.tsx src/components/integracao/IntegracaoPage.tsx \
  tests/unit/integracao-tela-fonte.test.ts
git show --stat HEAD | tail -n +7
```
Expected: PASS (celula 5 · tela-fonte 11); `GATES INTEGRACAO: ok`. A conferência VISUAL contra o mockup 2 fica para a QA
(Task 25 — a tela só funciona com as RPCs, que só existem na cópia depois do `copia.sh ida`). Revisão individual (Opus +
`code-reviewer`): merge 3-vias, staging, textos.

---

### Task 13: Estados — Integrar (com o resumo), Voltar, Desfazer (super admin) e ações em massa

**Files:**
- Create: `src/lib/integracao/resumo.ts` (resumo do "Tenho certeza" e textos — PURO)
- Create: `src/components/integracao/EstadoLinha.tsx` (`EstadoCelula` + `IntegravelCelula`),
  `src/components/integracao/IntegrarDialog.tsx`, `src/components/integracao/VoltarDialog.tsx`,
  `src/components/integracao/DesfazerDialog.tsx`
- Modify: `src/components/integracao/ProdutosAba.tsx` (seleção, barra de massa, coluna Integrável, diálogos)
- Test: `tests/unit/integracao-resumo.test.ts`

**Interfaces:**
- Consumes: Task 10 (`motivoIntegrar`, `motivoVoltar`, `acoesEmMassa`, `rotuloEstado`, `tomEstado`, `textoFaltas`,
  `formatarValor`, `textoFotos`, `TEXTO_PRECISA_CUSTO`), Task 9 (`TEXTO_ALERTA_INTEGRAR`, `CAMPO_BY_KEY`), Task 11
  (`invalidarIntegracao`); RPCs `integracao_previa(_modelo_ids)`, `integracao_marcar(_itens [{modelo_id, assinatura}])`,
  `integracao_voltar(_modelo_ids)`, `integracao_desfazer(_modelo_id, _motivo)`.
- Produces (`resumo.ts`): `type ProdutoPrevia`, `type ResumoIntegrar {campos, precisaVerCustos, podeVerCustos, entram,
  fora[{nome, motivo}], sublinhas, bloqueio}`, `lerResumo(raw)`, `itensMarcar(r)`, `celulaResumo(campo, linha, produto)`,
  `listaNomes(nomes)`, `textoVoltar(nomes)`, `textoDesfazer(nome, ref)`, `MOTIVO_MIN = 3`.
- Produces (componentes): `<EstadoCelula p tz superAdmin onDesfazer/>`, `<IntegravelCelula p motivoIntegrar motivoVoltar
  onIntegrar onVoltar/>`, `<IntegrarDialog ids onFechar onFeito/>`, `<VoltarDialog produtos onFechar onFeito/>`,
  `<DesfazerDialog produto onFechar onFeito/>`.

- [ ] **Step 1: Escrever o teste (falha: arquivo ausente)**

`tests/unit/integracao-resumo.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { brl } from "@/lib/format";
import { TEXTO_PRECISA_CUSTO } from "@/lib/integracao/produtos";
import { celulaResumo, itensMarcar, lerResumo, listaNomes, textoDesfazer, textoVoltar } from "@/lib/integracao/resumo";

const ASS = "a".repeat(64);
const prod = (o: Record<string, unknown>) => ({ modelo_id: "m1", nome: "Blusa Brisa", ref: "BLBR0087", origem: "interno",
  estado: "nao_integravel", reprovado: false, completo: true, faltas: [], assinatura: ASS,
  retrato: { v: 1, campos: ["nome", "preco_venda", "foto"], linhas: [
    { tipo: "produto", ordem: 0, valores: { nome: "Blusa Brisa", preco_venda: "159.90" }, fotos: ["t/f/a.jpg", "t/f/b.jpg", "t/f/c.jpg"] },
    { tipo: "variante", ordem: 1, valores: { nome: "Blusa Brisa P", preco_venda: "159.90" }, fotos: [] },
    { tipo: "variante", ordem: 2, valores: { nome: "Blusa Brisa M", preco_venda: "159.90" }, fotos: [] }] }, ...o });

describe("resumo do Integrar (integracao_previa — sempre o dado SALVO)", () => {
  it("entram os completos não integráveis; sublinhas contadas; itens = assinaturas do resumo", () => {
    const r = lerResumo({ campos: ["foto", "nome", "preco_venda"], precisa_ver_custos: false, pode_ver_custos: true,
      produtos: [prod({}), prod({ modelo_id: "m2", nome: "Macacão", completo: false, faltas: [{ campo: "peso", texto: "Peso" }] })] });
    expect(r.campos).toEqual(["nome", "preco_venda", "foto"]);
    expect(r.entram.map((p) => p.modeloId)).toEqual(["m1"]);
    expect(r.sublinhas).toBe(2);
    expect(r.fora).toEqual([{ nome: "Macacão", motivo: "Faltam: Peso" }]);
    expect(r.bloqueio).toBeNull();
    expect(itensMarcar(r)).toEqual([{ modelo_id: "m1", assinatura: ASS }]);
  });
  it("Preço de custo marcado e sem ver custos = bloqueio (P-75 A); ninguém entra = bloqueio", () => {
    expect(lerResumo({ campos: ["preco_custo"], precisa_ver_custos: true, pode_ver_custos: false, produtos: [prod({})] }).bloqueio)
      .toBe(TEXTO_PRECISA_CUSTO);
    expect(lerResumo({ campos: ["nome"], produtos: [prod({ estado: "integravel" })] }).bloqueio).toBe("Nenhum produto selecionado pode ser integrado.");
    expect(lerResumo({ campos: ["nome"], produtos: [prod({ reprovado: true })] }).fora[0].motivo).toBe("Produto reprovado.");
  });
  it("células do resumo", () => {
    const r = lerResumo({ campos: ["nome", "preco_venda", "foto"], produtos: [prod({})] });
    const [pl, vl] = r.entram[0].linhas;
    expect(celulaResumo("preco_venda", pl, true)).toBe(brl(159.9));
    expect(celulaResumo("foto", pl, true)).toBe("3 fotos");
    expect(celulaResumo("foto", vl, false)).toBe("—");
  });
  it("textos de Voltar e Desfazer (mockup 3b e 5)", () => {
    expect(listaNomes(["A", "B", "C"])).toBe("A, B e C");
    expect(textoVoltar(["Calça Duna"])).toBe("Calça Duna volta para Não integrável e é destravado. Fica registrado no Log. Só é possível porque a API ainda não levou este produto.");
    expect(textoVoltar(["A", "B"])).toBe("A e B voltam para Não integrável e são destravados. Fica registrado no Log. Só é possível porque a API ainda não levou estes produtos.");
    expect(textoDesfazer("Saia Marola", "SAMA0019")).toBe("Saia Marola (SAMA0019) volta para Não integrável. Os campos travados são destravados. Esta ação é registrada no Log.");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres
npx vitest run --no-file-parallelism tests/unit/integracao-resumo.test.ts
```
Expected: FAIL — `Failed to resolve import "@/lib/integracao/resumo"`.

- [ ] **Step 3: `src/lib/integracao/resumo.ts`**

```ts
// Integração — o resumo do "Tenho certeza — integrar" (mockup 3): vem de integracao_previa = o dado SALVO no banco, nunca o
// rascunho da tela. Quem entra (completo, não integrável, não reprovado, com assinatura), quem fica fora e por quê, e as
// assinaturas que o integracao_marcar confere (P0409 integracao_mudou se o produto mudou no meio). PURO.
import { ordenarCampos, type CampoKey } from "@/lib/integracao/campos";
import { TEXTO_PRECISA_CUSTO, formatarValor, textoFaltas, textoFotos, type Falta } from "@/lib/integracao/produtos";

export type LinhaPrevia = { tipo: "produto" | "variante"; valores: Partial<Record<string, string | null>>; fotos: string[] };
export type ProdutoPrevia = {
  modeloId: string; nome: string; ref: string | null; estado: string; reprovado: boolean; completo: boolean; faltas: Falta[];
  linhas: LinhaPrevia[]; assinatura: string | null;
};
export type ResumoIntegrar = {
  campos: CampoKey[]; precisaVerCustos: boolean; podeVerCustos: boolean; entram: ProdutoPrevia[];
  fora: { nome: string; motivo: string }[]; sublinhas: number; bloqueio: string | null;
};
export const MOTIVO_MIN = 3;

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const txt = (v: unknown): string | null => (typeof v === "string" ? v : null);

function produtoDe(v: unknown): ProdutoPrevia {
  const o = obj(v);
  const ass = txt(o.assinatura);
  return {
    modeloId: txt(o.modelo_id) ?? "", nome: txt(o.nome) ?? "", ref: txt(o.ref), estado: txt(o.estado) ?? "nao_integravel",
    reprovado: o.reprovado === true, completo: o.completo === true,
    faltas: arr(o.faltas).map(obj).map((f) => ({ campo: txt(f.campo) ?? "", texto: txt(f.texto) ?? "" })),
    linhas: arr(obj(o.retrato).linhas).map(obj).map((l): LinhaPrevia => ({
      tipo: l.tipo === "variante" ? "variante" : "produto",
      valores: Object.fromEntries(Object.entries(obj(l.valores)).map(([k, x]) => [k, x === null || x === undefined ? null : String(x)])),
      fotos: arr(l.fotos).filter((f): f is string => typeof f === "string"),
    })),
    assinatura: ass && /^[0-9a-f]{64}$/.test(ass) ? ass : null,
  };
}
function motivoFora(p: ProdutoPrevia): string | null {
  if (p.estado === "integravel") return "Já está integrável.";
  if (p.estado === "integrado") return "Já integrado.";
  if (p.reprovado) return "Produto reprovado.";
  if (!p.completo) return textoFaltas(p.faltas) || "Produto incompleto.";
  if (!p.assinatura) return "Não foi possível conferir o produto — recarregue a página.";
  return null;
}
export function lerResumo(raw: unknown): ResumoIntegrar {
  const o = obj(raw);
  const produtos = arr(o.produtos).map(produtoDe).filter((p) => p.modeloId !== "");
  const entram = produtos.filter((p) => motivoFora(p) === null);
  const fora = produtos.filter((p) => motivoFora(p) !== null).map((p) => ({ nome: p.nome, motivo: motivoFora(p) as string }));
  const precisaVerCustos = o.precisa_ver_custos === true;
  const podeVerCustos = o.pode_ver_custos !== false;
  const bloqueio = precisaVerCustos && !podeVerCustos ? TEXTO_PRECISA_CUSTO
    : entram.length === 0 ? "Nenhum produto selecionado pode ser integrado." : null;
  return {
    campos: ordenarCampos(arr(o.campos).filter((c): c is string => typeof c === "string")), precisaVerCustos, podeVerCustos,
    entram, fora, sublinhas: entram.reduce((s, p) => s + p.linhas.filter((l) => l.tipo === "variante").length, 0), bloqueio,
  };
}
export const itensMarcar = (r: ResumoIntegrar): { modelo_id: string; assinatura: string }[] =>
  r.entram.map((p) => ({ modelo_id: p.modeloId, assinatura: p.assinatura as string }));
export function celulaResumo(campo: CampoKey, linha: LinhaPrevia, produto: boolean): string {
  if (campo === "foto") return produto ? textoFotos(linha.fotos.length) : "—";
  return formatarValor(campo, linha.valores[campo] ?? null);
}
export function listaNomes(nomes: string[]): string {
  return nomes.length <= 1 ? (nomes[0] ?? "") : `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}
export function textoVoltar(nomes: string[]): string {
  return nomes.length === 1
    ? `${nomes[0]} volta para Não integrável e é destravado. Fica registrado no Log. Só é possível porque a API ainda não levou este produto.`
    : `${listaNomes(nomes)} voltam para Não integrável e são destravados. Fica registrado no Log. Só é possível porque a API ainda não levou estes produtos.`;
}
export function textoDesfazer(nome: string, ref: string | null): string {
  return `${nome}${ref ? ` (${ref})` : ""} volta para Não integrável. Os campos travados são destravados. Esta ação é registrada no Log.`;
}
```

- [ ] **Step 4: Rodar o teste (PASS)**

```bash
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres
npx vitest run --no-file-parallelism tests/unit/integracao-resumo.test.ts
```
Expected: PASS (4).

- [ ] **Step 5: `src/components/integracao/EstadoLinha.tsx`**

```tsx
// Integração — colunas Estado e Integrável de uma linha da tabela. Estado: selo (vermelho/âmbar/verde) + "i" com o
// que falta + "⋯" SÓ do super admin no integrado (única ação: Desfazer integração). Integrável: toggle — ligar abre o
// Integrar (resumo + "Tenho certeza"), desligar abre o Voltar; travado mostra o motivo no "i".
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { InfoHover } from "@/components/shared/InfoHover";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { rotuloEstado, textoFaltas, tomEstado, type ProdutoLista } from "@/lib/integracao/produtos";

export function EstadoCelula({ p, tz, superAdmin, onDesfazer }: {
  p: ProdutoLista; tz: string; superAdmin: boolean; onDesfazer: () => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <StatusBadge tone={tomEstado(p.estado)} className="whitespace-nowrap normal-case tracking-normal">{rotuloEstado(p, tz)}</StatusBadge>
      {p.estado === "nao_integravel" && !p.completo && <InfoHover ariaLabel="O que falta">{textoFaltas(p.faltas)}</InfoHover>}
      {p.estado === "integrado" && superAdmin && (
        <Popover>
          <PopoverTrigger asChild>
            <Button type="button" variant="ghost" size="iconSm" className="max-sm:h-11 max-sm:w-11" aria-label="Mais ações (só super admin)">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-56 p-1">
            <Button type="button" variant="ghost" className="w-full justify-start text-destructive" onClick={onDesfazer}>
              Desfazer integração
            </Button>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

export function IntegravelCelula({ p, motivoIntegrar, motivoVoltar, onIntegrar, onVoltar }: {
  p: ProdutoLista; motivoIntegrar: string | null; motivoVoltar: string | null; onIntegrar: () => void; onVoltar: () => void;
}) {
  const ligado = p.estado !== "nao_integravel";
  const motivo = p.estado === "nao_integravel" ? motivoIntegrar
    : p.estado === "integravel" ? motivoVoltar
      : "Integrado — a API já levou. Só o super admin desfaz (⋯ no Estado).";
  return (
    <div className="flex items-center gap-1">
      <Switch checked={ligado} disabled={motivo !== null} aria-label={`Integrável: ${p.raw.nome}`}
        onCheckedChange={(v) => (v ? onIntegrar() : onVoltar())} />
      {motivo && <InfoHover ariaLabel="Por que não muda">{motivo}</InfoHover>}
    </div>
  );
}
```

- [ ] **Step 6: Os 3 diálogos**

`src/components/integracao/IntegrarDialog.tsx`:

```tsx
// Integração — "Tenho certeza" (mockup 3). Texto do dono VERBATIM + o resumo de integracao_previa (o dado SALVO). Confirmar
// = integracao_marcar com as assinaturas DESTE resumo; P0409 integracao_mudou = o produto mudou no meio → relê o resumo.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment } from "react";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { mensagemErro } from "@/lib/erro-mensagem";
import { CAMPO_BY_KEY, TEXTO_ALERTA_INTEGRAR } from "@/lib/integracao/campos";
import { celulaResumo, itensMarcar, lerResumo, type ResumoIntegrar } from "@/lib/integracao/resumo";
import { invalidarIntegracao } from "./useIntegracao";

export function IntegrarDialog({ ids, onFechar, onFeito }: { ids: string[]; onFechar: () => void; onFeito: () => void }) {
  const tenantId = useActiveTenantId();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["integracao-previa", tenantId, ids],
    staleTime: 0,
    queryFn: async (): Promise<ResumoIntegrar> => {
      const { data, error } = await supabase.rpc("integracao_previa" as any, { _modelo_ids: ids });
      if (error) throw error;
      return lerResumo(data);
    },
  });
  const marcar = useMutation({
    mutationFn: async (itens: { modelo_id: string; assinatura: string }[]) => {
      const { data, error } = await supabase.rpc("integracao_marcar" as any, { _itens: itens });
      if (error) throw error;
      return Number((data as { marcados?: number } | null)?.marcados ?? 0);
    },
    onSuccess: (n) => {
      toast.success(n === 1 ? "1 produto integrável." : `${n} produtos integráveis.`);
      invalidarIntegracao(qc, tenantId, ids);
      onFeito();
    },
    onError: (e) => {
      toast.error(mensagemErro(e, "Não foi possível integrar."));
      if ((e as { code?: string })?.code === "P0409") void q.refetch();
    },
  });
  const r = q.data;
  const campos = (r?.campos ?? []).map((k) => CAMPO_BY_KEY.get(k)!).filter(Boolean);
  return (
    <AlertDialog open onOpenChange={(o) => { if (!o && !marcar.isPending) onFechar(); }}>
      <AlertDialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle>Integrar produtos</AlertDialogTitle>
          <AlertDialogDescription className="text-base font-semibold text-destructive">{TEXTO_ALERTA_INTEGRAR}</AlertDialogDescription>
        </AlertDialogHeader>
        {q.isError ? (
          <p className="text-sm text-destructive">{mensagemErro(q.error, "Não foi possível montar o resumo.")}</p>
        ) : !r ? (
          <p className="text-sm text-muted-foreground">Montando o resumo…</p>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-4">
              <span>Produtos <strong className="tabular-nums">{r.entram.length}</strong></span>
              <span>Sublinhas (variante × tamanho) <strong className="tabular-nums">{r.sublinhas}</strong></span>
            </div>
            <p className="text-muted-foreground">Valores que vão na API (dado salvo, {r.campos.length} campos marcados)</p>
            <div className="max-w-full overflow-x-auto rounded-md border">
              <table className="w-full min-w-max border-collapse text-xs">
                <thead className="bg-muted/50 text-left text-muted-foreground">
                  <tr>{campos.map((c) => <th key={c.key} className="whitespace-nowrap px-2 py-2">{c.rotuloCurto}</th>)}</tr>
                </thead>
                <tbody>
                  {r.entram.map((p) => (
                    <Fragment key={p.modeloId}>
                      {p.linhas.map((l, i) => (
                        <tr key={`${p.modeloId}:${i}`} className={l.tipo === "produto" ? "border-t font-medium" : "border-t border-dashed text-muted-foreground"}>
                          {campos.map((c) => <td key={c.key} className="whitespace-nowrap px-2 py-2">{celulaResumo(c.key, l, l.tipo === "produto")}</td>)}
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            {r.fora.length > 0 && (
              <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                {r.fora.map((f) => <li key={f.nome}>Não entra: {f.nome} — {f.motivo}</li>)}
              </ul>
            )}
            {r.bloqueio && <p className="font-medium text-destructive">{r.bloqueio}</p>}
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={marcar.isPending}>Cancelar</AlertDialogCancel>
          <Button type="button" disabled={!r || !!r.bloqueio || marcar.isPending || q.isFetching}
            onClick={() => r && marcar.mutate(itensMarcar(r))}>
            {marcar.isPending ? "Integrando…" : "Tenho certeza — integrar"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

`src/components/integracao/VoltarDialog.tsx`:

```tsx
// Integração — "Voltar para não integrável?" (mockup 3b; D28: sem campo de motivo). Só integrável (o servidor confere).
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { mensagemErro } from "@/lib/erro-mensagem";
import { textoVoltar } from "@/lib/integracao/resumo";
import { invalidarIntegracao } from "./useIntegracao";

export function VoltarDialog({ produtos, onFechar, onFeito }: {
  produtos: { id: string; nome: string }[]; onFechar: () => void; onFeito: () => void;
}) {
  const tenantId = useActiveTenantId();
  const qc = useQueryClient();
  const ids = produtos.map((p) => p.id);
  const voltar = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("integracao_voltar" as any, { _modelo_ids: ids });
      if (error) throw error;
      return Number((data as { voltaram?: number } | null)?.voltaram ?? 0);
    },
    onSuccess: (n) => {
      toast.success(n === 1 ? "1 produto voltou para não integrável." : `${n} produtos voltaram para não integrável.`);
      invalidarIntegracao(qc, tenantId, ids);
      onFeito();
    },
    onError: (e) => {
      toast.error(mensagemErro(e, "Não foi possível voltar."));
      invalidarIntegracao(qc, tenantId, ids);
    },
  });
  return (
    <AlertDialog open onOpenChange={(o) => { if (!o && !voltar.isPending) onFechar(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Voltar para não integrável?</AlertDialogTitle>
          <AlertDialogDescription>{textoVoltar(produtos.map((p) => p.nome))}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={voltar.isPending}>Cancelar</AlertDialogCancel>
          <Button type="button" disabled={voltar.isPending} onClick={() => voltar.mutate()}>
            {voltar.isPending ? "Voltando…" : "Voltar para não integrável"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

`src/components/integracao/DesfazerDialog.tsx`:

```tsx
// Integração — "Desfazer integração" (mockup 5): SÓ super admin (o servidor confere), só integrado, motivo obrigatório (≥ 3).
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { mensagemErro } from "@/lib/erro-mensagem";
import type { ProdutoLista } from "@/lib/integracao/produtos";
import { MOTIVO_MIN, textoDesfazer } from "@/lib/integracao/resumo";
import { invalidarIntegracao } from "./useIntegracao";

export function DesfazerDialog({ produto, onFechar, onFeito }: { produto: ProdutoLista; onFechar: () => void; onFeito: () => void }) {
  const tenantId = useActiveTenantId();
  const qc = useQueryClient();
  const [motivo, setMotivo] = useState("");
  const desfazer = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("integracao_desfazer" as any, { _modelo_id: produto.modeloId, _motivo: motivo.trim() });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(`Integração de "${produto.raw.nome}" desfeita.`);
      invalidarIntegracao(qc, tenantId, [produto.modeloId]);
      onFeito();
    },
    onError: (e) => toast.error(mensagemErro(e, "Não foi possível desfazer a integração.")),
  });
  const ok = motivo.trim().length >= MOTIVO_MIN;
  return (
    <AlertDialog open onOpenChange={(o) => { if (!o && !desfazer.isPending) onFechar(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Desfazer integração</AlertDialogTitle>
          <AlertDialogDescription>{textoDesfazer(produto.raw.nome, produto.raw.ref)}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="grid gap-1">
          <Label htmlFor="integracao-motivo">Motivo (obrigatório)</Label>
          <Textarea id="integracao-motivo" rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={desfazer.isPending}>Cancelar</AlertDialogCancel>
          <Button type="button" variant="destructive" disabled={!ok || desfazer.isPending} onClick={() => desfazer.mutate()}>
            {desfazer.isPending ? "Desfazendo…" : "Desfazer integração"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

- [ ] **Step 7: Ligar na `ProdutosAba.tsx` (seleção, massa, coluna Integrável, diálogos)**

Trocar o bloco de import de `@/lib/integracao/produtos` por:

```tsx
import {
  FILTROS_VAZIOS, ROTULO_ESTADO, ROTULO_ORIGEM, acoesEmMassa, faixaPagina, motivoIntegrar, motivoVoltar, totalPaginas,
  type EstadoIntegracao, type Filtros, type ProdutoLista, type Situacao,
} from "@/lib/integracao/produtos";
```
remover `import { StatusBadge } from "@/components/shared/StatusBadge";` e, depois de
`import { KeywordsDialog } from "./KeywordsDialog";`, acrescentar:

```tsx
import { EstadoCelula, IntegravelCelula } from "./EstadoLinha";
import { IntegrarDialog } from "./IntegrarDialog";
import { VoltarDialog } from "./VoltarDialog";
import { DesfazerDialog } from "./DesfazerDialog";
```

Depois de `const [keywordsAberto, setKeywordsAberto] = useState(false);`, acrescentar:

```tsx
  const [selecionados, setSelecionados] = useState<ReadonlySet<string>>(new Set());
  const [integrarIds, setIntegrarIds] = useState<string[] | null>(null);
  const [voltarProdutos, setVoltarProdutos] = useState<{ id: string; nome: string }[] | null>(null);
  const [desfazerDe, setDesfazerDe] = useState<ProdutoLista | null>(null);
```

Depois de `const travaFiltro = sujo || salvar.isPending;`, acrescentar:

```tsx
  useEffect(() => { setSelecionados(new Set()); }, [situacao, filtros, pagina]);
```

Trocar o bloco inteiro `const estadoCelula = (p: ProdutoLista) => ( … );` por:

```tsx
  const ctxIntegrar = {
    podeEditar: lista?.pode.editar ?? false,
    precisaVerCustos: lista?.campos.includes("preco_custo") ?? false,
    podeVerCustos: lista?.pode.verCustos ?? false,
  };
  const idsSujos = new Set(sujos.map((r) => r.modeloId));
  const estadoCelula = (p: ProdutoLista) => (
    <EstadoCelula p={p} tz={tz} superAdmin={lista?.pode.super ?? false} onDesfazer={() => setDesfazerDe(p)} />
  );
  const integravelCelula = (p: ProdutoLista) => (
    <IntegravelCelula p={p}
      motivoIntegrar={motivoIntegrar(p, { ...ctxIntegrar, temRascunho: idsSujos.has(p.modeloId) })}
      motivoVoltar={motivoVoltar(p, ctxIntegrar.podeEditar)}
      onIntegrar={() => setIntegrarIds([p.modeloId])}
      onVoltar={() => setVoltarProdutos([{ id: p.modeloId, nome: p.raw.nome }])} />
  );
  const selecionadosLista = (lista?.produtos ?? []).filter((p) => selecionados.has(p.modeloId));
  const massa = acoesEmMassa(selecionadosLista, { ...ctxIntegrar, rascunhos: idsSujos });
  const selecao = {
    todos: !!lista && lista.produtos.length > 0 && selecionadosLista.length === lista.produtos.length,
    alguns: selecionadosLista.length > 0,
    onTodos: (v: boolean) => setSelecionados(v ? new Set((lista?.produtos ?? []).map((p) => p.modeloId)) : new Set()),
    marcado: (id: string) => selecionados.has(id),
    onMarcar: (id: string, v: boolean) => setSelecionados((s) => {
      const n = new Set(s);
      if (v) n.add(id);
      else n.delete(id);
      return n;
    }),
  };
  const aposEstado = () => {
    setIntegrarIds(null);
    setVoltarProdutos(null);
    setDesfazerDe(null);
    setSelecionados(new Set());
  };
  const barraMassa = lista && lista.pode.editar && (
    <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-2 text-sm">
      <span className="tabular-nums">{selecionados.size} selecionado(s)</span>
      <Button type="button" size="sm" disabled={massa.integrar.length === 0} onClick={() => setIntegrarIds(massa.integrar)}>
        Integrar selecionados
      </Button>
      {selecionados.size > 0 && massa.motivoIntegrar && <span className="text-xs text-muted-foreground">{massa.motivoIntegrar}</span>}
      <Button type="button" size="sm" variant="outline" disabled={massa.voltar.length === 0}
        onClick={() => setVoltarProdutos(selecionadosLista.filter((p) => massa.voltar.includes(p.modeloId)).map((p) => ({ id: p.modeloId, nome: p.raw.nome })))}>
        Voltar selecionados
      </Button>
      {selecionados.size > 0 && massa.motivoVoltar && <span className="text-xs text-muted-foreground">{massa.motivoVoltar}</span>}
    </div>
  );
```

Trocar `      {q.isError ? (` (a 1ª ocorrência, logo depois da grade de filtros) por:

```tsx
      {barraMassa}
      {q.isError ? (
```

Trocar
`            onAtualizar={atualizar} onKeywords={() => setKeywordsAberto(true)} onFotos={setFotosDe} estadoCelula={estadoCelula} />`
por
```tsx
            onAtualizar={atualizar} onKeywords={() => setKeywordsAberto(true)} onFotos={setFotosDe} estadoCelula={estadoCelula}
            integravelCelula={integravelCelula} selecao={lista.pode.editar ? selecao : undefined} />
```

Depois de `{keywordsAberto && lista && <KeywordsDialog atual={lista.keywords} onFechar={() => setKeywordsAberto(false)} />}`,
acrescentar:

```tsx
      {integrarIds && <IntegrarDialog ids={integrarIds} onFechar={() => setIntegrarIds(null)} onFeito={aposEstado} />}
      {voltarProdutos && <VoltarDialog produtos={voltarProdutos} onFechar={() => setVoltarProdutos(null)} onFeito={aposEstado} />}
      {desfazerDe && <DesfazerDialog produto={desfazerDe} onFechar={() => setDesfazerDe(null)} onFeito={aposEstado} />}
```

- [ ] **Step 8: Gates e commit**

```bash
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres
npx vitest run --no-file-parallelism tests/unit/integracao-resumo.test.ts tests/unit/integracao-tela-fonte.test.ts
bash .superpowers/integracao/gates.sh
git add -- src/lib/integracao/resumo.ts src/components/integracao/EstadoLinha.tsx src/components/integracao/IntegrarDialog.tsx \
  src/components/integracao/VoltarDialog.tsx src/components/integracao/DesfazerDialog.tsx src/components/integracao/ProdutosAba.tsx \
  tests/unit/integracao-resumo.test.ts
git commit --only -m "feat(integracao): integrar com o resumo do dado salvo, voltar, desfazer (super admin) e ações em massa

Co-Authored-By: Claude <modelo real> <noreply@anthropic.com>" -- src/lib/integracao/resumo.ts src/components/integracao/EstadoLinha.tsx \
  src/components/integracao/IntegrarDialog.tsx src/components/integracao/VoltarDialog.tsx src/components/integracao/DesfazerDialog.tsx \
  src/components/integracao/ProdutosAba.tsx tests/unit/integracao-resumo.test.ts
git show --stat HEAD | tail -n +7
```
Expected: PASS (resumo 4 · tela-fonte 11); `GATES INTEGRACAO: ok`. Revisão individual (Opus + `code-reviewer`): o dialog
nunca integra com assinatura velha; o "⋯" só aparece ao super admin (e o servidor recusa os outros).

---

### Task 14: Aba Campos da API (só super admin) — seleção na ordem fixa, alerta do layout, confirmação

**Files:**
- Modify: `src/lib/integracao/campos.ts` (acrescenta helpers de seleção no FIM)
- Create: `src/components/integracao/CamposAba.tsx`
- Modify: `src/components/integracao/IntegracaoPage.tsx` (`CONTEUDO_ABA.campos = CamposAba`)
- Test: `tests/unit/integracao-campos-config.test.ts`

**Interfaces:**
- Consumes: Task 9 (`CAMPOS`, `CAMPO_BY_KEY`, `ordenarCampos`, `TEXTO_ALERTA_LAYOUT`), Task 11 (`useIntegracaoConfig`,
  `chaveConfig`, `invalidarIntegracao`, `useAbaSuja`); RPC `integracao_salvar_config(_campos text[], _rev integer)`
  (SÓ super admin; P0409 `conflito_versao` se outra pessoa salvou a config).
- Produces: `alternarCampo(sel, key, marcar)`, `precisaAlertaLayout(key, marcar)`, `rotuloNaLista(key)`,
  `mesmaSelecao(a, b)`, `TEXTO_CAMPOS_REGRA`, `TEXTO_TRAVA_SEMPRE`, `TEXTO_SO_SUPER`, `TEXTO_CONFIRMAR_CAMPOS`; `<CamposAba/>`.

- [ ] **Step 1: Escrever o teste (falha: nomes ausentes)**

`tests/unit/integracao-campos-config.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { alternarCampo, mesmaSelecao, precisaAlertaLayout, rotuloNaLista } from "@/lib/integracao/campos";

describe("Campos da API — seleção (P-60 B, P-83 A)", () => {
  it("marcar/desmarcar mantém a ordem fixa do layout", () => {
    expect(alternarCampo(["peso", "nome"], "ncm", true)).toEqual(["nome", "peso", "ncm"]);
    expect(alternarCampo(["nome", "peso"], "nome", false)).toEqual(["peso"]);
    expect(alternarCampo(["nome"], "nome", true)).toEqual(["nome"]);
  });
  it("alerta só ao DESMARCAR campo do layout (1–17); Foto é opcional e não alerta", () => {
    expect(precisaAlertaLayout("nome", false)).toBe(true);
    expect(precisaAlertaLayout("nome", true)).toBe(false);
    expect(precisaAlertaLayout("foto", false)).toBe(false);
  });
  it("rótulo na lista: 'Foto do Modelo' (a coluna da API continua 'Foto')", () => {
    expect(rotuloNaLista("foto")).toBe("Foto do Modelo");
    expect(rotuloNaLista("titulo")).toBe("Título para a página");
  });
  it("mesmaSelecao ignora a ordem", () => {
    expect(mesmaSelecao(["nome", "peso"], ["peso", "nome"])).toBe(true);
    expect(mesmaSelecao(["nome"], ["nome", "peso"])).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres
npx vitest run --no-file-parallelism tests/unit/integracao-campos-config.test.ts
```
Expected: FAIL — `alternarCampo is not a function` (ou `does not provide an export named`).

- [ ] **Step 3: Helpers no FIM de `src/lib/integracao/campos.ts`**

```ts
// ── Aba "Campos da API" (Task 14) ──────────────────────────────────────────────────────────────────────────────────────
export const TEXTO_SO_SUPER = "Esta aba é só do super admin. Admin da loja e usuários com permissão veem só Produtos e Log.";
export const TEXTO_CAMPOS_REGRA =
  'Marcado = entra na API e é obrigatório para integrar. A ordem é sempre esta (layout fixo do pedido). Os campos do layout (1–17) vêm marcados por padrão numa loja NOVA; "Foto do Modelo" nasce DESMARCADA (opcional). Mudar a seleção vale só para as PRÓXIMAS integrações — retratos já gravados não mudam.';
export const TEXTO_TRAVA_SEMPRE = 'Travam sempre, marcados ou não: SKUs, cores e tamanhos das sublinhas e o "Tamanho em".';
export const TEXTO_CONFIRMAR_CAMPOS =
  "Esta mudança vale para as próximas integrações. Produtos já integrados mantêm o retrato gravado no momento da integração deles.";
export function alternarCampo(sel: readonly string[], key: CampoKey, marcar: boolean): CampoKey[] {
  const s = new Set(sel);
  if (marcar) s.add(key);
  else s.delete(key);
  return ordenarCampos([...s]);
}
export const precisaAlertaLayout = (key: CampoKey, marcar: boolean): boolean => !marcar && (CAMPO_BY_KEY.get(key)?.layout ?? false);
export const rotuloNaLista = (key: CampoKey): string => (key === "foto" ? "Foto do Modelo" : (CAMPO_BY_KEY.get(key)?.rotulo ?? key));
export function mesmaSelecao(a: readonly string[], b: readonly string[]): boolean {
  const x = ordenarCampos(a);
  const y = ordenarCampos(b);
  return x.length === y.length && x.every((k, i) => k === y[i]);
}
```

- [ ] **Step 4: `src/components/integracao/CamposAba.tsx`**

```tsx
// Integração — aba "Campos da API" (mockup 6/6b/6-confirm; SÓ super admin — v4/P-81 A: o servidor recusa os outros).
// Lista os 18 campos na ordem FIXA; desmarcar um do layout (1–17) pede "Tem certeza?"; Salvar pede "Confirmar mudança de
// campos". Grava por integracao_salvar_config com o rev lido (P0409 se outra pessoa salvou).
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { ArrowLeft, Save } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { PageActionBar } from "@/components/shared/PageActionBar";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { supabase } from "@/integrations/supabase/client";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { mensagemErro } from "@/lib/erro-mensagem";
import {
  CAMPOS, TEXTO_ALERTA_LAYOUT, TEXTO_CAMPOS_REGRA, TEXTO_CONFIRMAR_CAMPOS, TEXTO_SO_SUPER, TEXTO_TRAVA_SEMPRE, alternarCampo,
  mesmaSelecao, ordenarCampos, precisaAlertaLayout, rotuloNaLista, type CampoKey,
} from "@/lib/integracao/campos";
import { useAbaSuja } from "./guard";
import { chaveConfig, invalidarIntegracao, useIntegracaoConfig } from "./useIntegracao";

export function CamposAba() {
  const router = useRouter();
  const tenantId = useActiveTenantId();
  const qc = useQueryClient();
  const q = useIntegracaoConfig();
  const [sel, setSel] = useState<CampoKey[] | null>(null);
  const [alerta, setAlerta] = useState<CampoKey | null>(null);
  const [confirmar, setConfirmar] = useState(false);
  const servidor = ordenarCampos(q.data?.campos ?? []);
  const atual = sel ?? servidor;
  const sujo = sel !== null && !mesmaSelecao(sel, servidor);
  useAbaSuja("campos", sujo);
  const salvar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("integracao_salvar_config" as any, { _campos: atual, _rev: q.data?.rev ?? 0 });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Campos da API salvos. Valem para as próximas integrações.");
      setSel(null);
      setConfirmar(false);
      void qc.invalidateQueries({ queryKey: chaveConfig(tenantId) });
      invalidarIntegracao(qc, tenantId);
    },
    onError: (e) => {
      setConfirmar(false);
      toast.error(mensagemErro(e, "Não foi possível salvar os campos."));
      if ((e as { code?: string })?.code === "P0409") void q.refetch();
    },
  });
  const alternar = (key: CampoKey, marcar: boolean) => {
    if (precisaAlertaLayout(key, marcar)) setAlerta(key);
    else setSel(alternarCampo(atual, key, marcar));
  };
  return (
    <div className="space-y-4">
      <p className="rounded-md bg-[var(--tone-info-bg)] p-3 text-sm text-[var(--tone-info-fg)]">{TEXTO_SO_SUPER}</p>
      <p className="text-sm text-muted-foreground">{TEXTO_CAMPOS_REGRA}</p>
      {q.isError ? (
        <p className="text-sm text-destructive">{mensagemErro(q.error, "Não foi possível carregar os campos.")}</p>
      ) : !q.data ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : (
        <div className="max-w-xl rounded-md border">
          <p className="border-b px-3 py-2 text-sm font-medium">Ordem fixa dos campos</p>
          <ol>
            {CAMPOS.map((c, i) => {
              const marcado = atual.includes(c.key);
              return (
                <li key={c.key} className="flex items-center gap-3 border-b px-3 py-2 last:border-b-0">
                  <span className="w-6 text-right text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                  <Checkbox id={`campo-${c.key}`} checked={marcado} onCheckedChange={(v) => alternar(c.key, v === true)} />
                  <label htmlFor={`campo-${c.key}`} className="flex-1 text-sm">{rotuloNaLista(c.key)}</label>
                  <StatusBadge tone={c.layout ? "neutral" : "info"}>{c.layout ? "layout" : "opcional"}</StatusBadge>
                </li>
              );
            })}
          </ol>
        </div>
      )}
      <p className="text-xs text-muted-foreground">{TEXTO_TRAVA_SEMPRE}</p>

      <AlertDialog open={alerta !== null} onOpenChange={(o) => { if (!o) setAlerta(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Tem certeza?</AlertDialogTitle>
            <AlertDialogDescription>{TEXTO_ALERTA_LAYOUT}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Manter marcado</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => { if (alerta) setSel(alternarCampo(atual, alerta, false)); setAlerta(null); }}>
              Desmarcar mesmo assim
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmar} onOpenChange={(o) => { if (!o && !salvar.isPending) setConfirmar(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar mudança de campos</AlertDialogTitle>
            <AlertDialogDescription>{TEXTO_CONFIRMAR_CAMPOS}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={salvar.isPending}>Voltar</AlertDialogCancel>
            <Button type="button" disabled={salvar.isPending} onClick={() => salvar.mutate()}>
              {salvar.isPending ? "Salvando…" : "Confirmar e salvar"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <PageActionBar>
        <Button type="button" variant="outline" onClick={() => router.history.back()}>
          <ArrowLeft className="h-4 w-4" />Voltar
        </Button>
        <Button type="button" className="ml-auto" disabled={!sujo || salvar.isPending} onClick={() => setConfirmar(true)}>
          <Save className="h-4 w-4" />Salvar
        </Button>
      </PageActionBar>
    </div>
  );
}
```

Em `src/components/integracao/IntegracaoPage.tsx`: acrescentar `import { CamposAba } from "./CamposAba";` e trocar
`  campos: AbaPendente,` por `  campos: CamposAba,`.

- [ ] **Step 5: Rodar (PASS), gates e commit**

```bash
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres
npx vitest run --no-file-parallelism tests/unit/integracao-campos-config.test.ts tests/unit/integracao-campos.test.ts tests/unit/integracao-tela-fonte.test.ts
bash .superpowers/integracao/gates.sh
git add -- src/lib/integracao/campos.ts src/components/integracao/CamposAba.tsx src/components/integracao/IntegracaoPage.tsx \
  tests/unit/integracao-campos-config.test.ts
git commit --only -m "feat(integracao): aba Campos da API (super admin) — ordem fixa, alerta do layout e confirmação

Co-Authored-By: Claude <modelo real> <noreply@anthropic.com>" -- src/lib/integracao/campos.ts src/components/integracao/CamposAba.tsx \
  src/components/integracao/IntegracaoPage.tsx tests/unit/integracao-campos-config.test.ts
git show --stat HEAD | tail -n +7
```
Expected: PASS (campos-config 4 · campos 9 · tela-fonte 11); `GATES INTEGRACAO: ok`.

---

### Task 15: Aba API (só super admin) — Chaves, Acessos recentes e Configurações da API

**Files:**
- Create: `src/lib/integracao/api-tela.ts` (leitura e textos — PURO)
- Create: `src/components/integracao/ApiAba.tsx`, `src/components/integracao/NovaChaveDialog.tsx`
- Modify: `src/components/integracao/IntegracaoPage.tsx` (`CONTEUDO_ABA.api = ApiAba`)
- Test: `tests/unit/integracao-api-tela.test.ts`

**Interfaces:**
- Consumes: Task 9 (`CONFIG_API`, `CHAVES_CONFIG_API`, `validarConfigApi`, `ChaveConfigApi`, `TEXTO_SO_SUPER` da Task 14),
  Task 10 (`fmtDataHora`), Task 11 (`useIntegracaoConfig`, `chaveConfig`, `invalidarIntegracao`, `useAbaSuja`); RPCs
  `integracao_chaves_listar()`, `integracao_chave_criar(_nome)` → `{id, nome, chave, final}` (a chave SÓ aqui, 1×),
  `integracao_chave_revogar(_id)`, `integracao_acessos_listar(_limite)`, `integracao_salvar_config_api(_valores, _rev)`.
- Produces (`api-tela.ts`): `type Chave`, `type Acesso`, `lerChaves(raw)`, `lerAcessos(raw)`, `fmtData(iso, tz)`,
  `rotuloChaveAcesso(a)`, `statusAcesso(a) → {texto, tom}`, `entregaAcesso(a) → {produtos, linhas}`,
  `textoForaRecomendado(k)`, `TEXTO_NOVA_CHAVE_GUARDE`, `TEXTO_REVOGAR`; `<ApiAba/>`, `<NovaChaveDialog onFechar/>`.

- [ ] **Step 1: Escrever o teste (falha: arquivo ausente)**

`tests/unit/integracao-api-tela.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  TEXTO_REVOGAR, entregaAcesso, fmtData, lerAcessos, lerChaves, rotuloChaveAcesso, statusAcesso, textoForaRecomendado,
} from "@/lib/integracao/api-tela";

const acesso = (o: Record<string, unknown>) => lerAcessos([{ id: "a1", chave: "ERP Principal", final: "a1b2", ip: null, modo: "normal",
  status: "ok", tentativas: 1, produtos: 42, exemplos: null, linhas: 118, quando: "2026-09-26T12:14:00Z", ...o }])[0];

describe("aba API — leitura e textos (mockup 7)", () => {
  it("chaves: nunca há hash; revogada e 'Nunca usada'", () => {
    const [k] = lerChaves([{ id: "k1", nome: "Loja Virtual (teste)", final: "7f3d", criada_por: "Ana Torres", criada_em: "2026-08-02T12:00:00Z",
      revogada_em: null, ultimo_uso_em: null, hash: "NAO-PODE" }]);
    expect(k).toEqual({ id: "k1", nome: "Loja Virtual (teste)", final: "7f3d", criadaPor: "Ana Torres", criadaEm: "2026-08-02T12:00:00Z",
      revogadaEm: null, ultimoUsoEm: null });
    expect(fmtData("2026-08-02T12:00:00Z", "America/Sao_Paulo")).toBe("02/08/2026");
  });
  it("acessos: rótulos da chave, status e entrega", () => {
    expect(rotuloChaveAcesso(acesso({}))).toBe("ERP Principal");
    expect(rotuloChaveAcesso(acesso({ modo: "teste", status: "teste" }))).toBe("ERP Principal (modo teste)");
    expect(rotuloChaveAcesso(acesso({ chave: null, final: null, status: "chave_invalida", ip: "203.0.113.9" }))).toBe("Chave inválida (IP 203.0.113.9)");
    expect(statusAcesso(acesso({}))).toEqual({ texto: "OK", tom: "success" });
    expect(statusAcesso(acesso({ status: "chave_invalida", tentativas: 4 }))).toEqual({ texto: "Rejeitada ×4", tom: "danger" });
    expect(statusAcesso(acesso({ status: "limite_excedido", tentativas: 2 }))).toEqual({ texto: "Limite excedido ×2", tom: "warning" });
    expect(statusAcesso(acesso({ status: "teste" }))).toEqual({ texto: "Teste", tom: "info" });
    expect(entregaAcesso(acesso({}))).toEqual({ produtos: "42", linhas: "118" });
    expect(entregaAcesso(acesso({ status: "teste", modo: "teste", produtos: 0, exemplos: 2, linhas: 6 }))).toEqual({ produtos: "2 exemplos", linhas: "6" });
    expect(entregaAcesso(acesso({ status: "chave_invalida", produtos: 0, linhas: null }))).toEqual({ produtos: "—", linhas: "—" });
  });
  it("fora do recomendado e revogar (textos do mockup)", () => {
    expect(textoForaRecomendado("limite_por_minuto"))
      .toBe("Recomendado: 60. Acima disso o ERP pode sobrecarregar o site / abaixo, o programa do dev pode ficar lento.");
    expect(TEXTO_REVOGAR).toBe("O ERP perde o acesso na hora. Esta ação não pode ser desfeita — para usar de novo, é preciso criar outra chave.");
  });
  it("P-89 A: 'Máximo por página' recomendado 50 e, acima de 100, o alerta do plano gratuito no campo E no diálogo", () => {
    expect(textoForaRecomendado("max_por_pagina")).toMatch(/^Recomendado: 50\. /);
    const s = readFileSync("src/components/integracao/ApiAba.tsx", "utf8"); // passa depois do Step 6 (ApiAba)
    expect(s.match(/alertaPaginaPlanoGratuito\(vals\.max_por_pagina\)/g)?.length).toBe(2);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres
npx vitest run --no-file-parallelism tests/unit/integracao-api-tela.test.ts
```
Expected: FAIL — `Failed to resolve import "@/lib/integracao/api-tela"`.

- [ ] **Step 3: `src/lib/integracao/api-tela.ts`**

```ts
// Integração — aba API (mockup 7/7b/7c/7d/7e/5b): leitura tolerante das chaves (NUNCA o hash — D32) e dos acessos (agregados
// por IP/minuto — D19), e os textos. PURO.
import type { StatusTone } from "@/components/shared/StatusBadge";
import { CONFIG_API, type ChaveConfigApi } from "@/lib/integracao/campos";

export type Chave = {
  id: string; nome: string; final: string; criadaPor: string; criadaEm: string | null; revogadaEm: string | null; ultimoUsoEm: string | null;
};
export type Acesso = {
  id: string; chave: string | null; final: string | null; ip: string | null; modo: string; status: string; tentativas: number;
  produtos: number | null; exemplos: number | null; linhas: number | null; quando: string | null;
};
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const txt = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export const lerChaves = (raw: unknown): Chave[] => arr(raw).map(obj).map((k) => ({
  id: txt(k.id) ?? "", nome: txt(k.nome) ?? "", final: txt(k.final) ?? "", criadaPor: txt(k.criada_por) ?? "—",
  criadaEm: txt(k.criada_em), revogadaEm: txt(k.revogada_em), ultimoUsoEm: txt(k.ultimo_uso_em),
}));
export const lerAcessos = (raw: unknown): Acesso[] => arr(raw).map(obj).map((a) => ({
  id: txt(a.id) ?? "", chave: txt(a.chave), final: txt(a.final), ip: txt(a.ip), modo: txt(a.modo) ?? "normal",
  status: txt(a.status) ?? "", tentativas: num(a.tentativas) ?? 1, produtos: num(a.produtos), exemplos: num(a.exemplos),
  linhas: num(a.linhas), quando: txt(a.quando),
}));
export function fmtData(iso: string | null, tz: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = new Intl.DateTimeFormat("pt-BR", { timeZone: tz, day: "2-digit", month: "2-digit", year: "numeric" }).formatToParts(d);
  const v = (t: Intl.DateTimeFormatPartTypes) => p.find((x) => x.type === t)?.value ?? "";
  return `${v("day")}/${v("month")}/${v("year")}`;
}
export function rotuloChaveAcesso(a: Acesso): string {
  if (a.status === "chave_invalida") return `Chave inválida (IP ${a.ip ?? "desconhecido"})`;
  if (a.status === "ip_bloqueado") return `IP bloqueado (${a.ip ?? "desconhecido"})`;
  const nome = a.chave ? a.chave : "—";
  return a.modo === "teste" ? `${nome} (modo teste)` : nome;
}
export function statusAcesso(a: Acesso): { texto: string; tom: StatusTone } {
  switch (a.status) {
    case "ok": return { texto: "OK", tom: "success" };
    case "teste": return { texto: "Teste", tom: "info" };
    case "chave_invalida": return { texto: `Rejeitada ×${a.tentativas}`, tom: "danger" };
    case "ip_bloqueado": return { texto: `IP bloqueado ×${a.tentativas}`, tom: "danger" };
    case "limite_excedido": return { texto: `Limite excedido ×${a.tentativas}`, tom: "warning" };
    case "loja_inativa": return { texto: "Loja inativa", tom: "danger" };
    case "reservado": return { texto: "Em andamento", tom: "neutral" };
    default: return { texto: a.status || "—", tom: "neutral" };
  }
}
export function entregaAcesso(a: Acesso): { produtos: string; linhas: string } {
  if (a.status === "teste") return { produtos: a.exemplos != null ? `${a.exemplos} exemplos` : "—", linhas: a.linhas != null ? String(a.linhas) : "—" };
  if (a.status !== "ok") return { produtos: "—", linhas: "—" };
  return { produtos: String(a.produtos ?? 0), linhas: String(a.linhas ?? 0) };
}
const MOTIVO_RECOMENDADO: Record<ChaveConfigApi, string> = {
  limite_por_minuto: "Acima disso o ERP pode sobrecarregar o site / abaixo, o programa do dev pode ficar lento.",
  max_por_pagina: "Páginas maiores deixam cada resposta mais pesada e lenta / menores pedem mais consultas.",
  validade_foto_dias: "Links que duram mais ficam válidos por mais tempo se vazarem / menos, o ERP precisa baixar as fotos logo.",
  bloqueio_tentativas: "Mais tentativas facilitam adivinhar uma chave / menos podem bloquear o ERP por um erro de digitação.",
};
export const textoForaRecomendado = (k: ChaveConfigApi): string => `Recomendado: ${CONFIG_API[k].recomendado}. ${MOTIVO_RECOMENDADO[k]}`;
export const TEXTO_NOVA_CHAVE_GUARDE = "Guarde esta chave agora. Por segurança, ela não pode ser mostrada de novo.";
export const TEXTO_REVOGAR = "O ERP perde o acesso na hora. Esta ação não pode ser desfeita — para usar de novo, é preciso criar outra chave.";
export const TEXTO_CONFIG_API =
  "Só o super admin edita. Valor fora da faixa permitida: erro na hora, Salvar desabilitado. Valor dentro da faixa mas fora do recomendado: alerta antes de salvar (com opção de voltar ao recomendado). Toda mudança fica no Log.";
```

- [ ] **Step 4: Rodar o teste (PASS, menos o de fonte do P-89 A)**

```bash
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres
npx vitest run --no-file-parallelism tests/unit/integracao-api-tela.test.ts
```
Expected: PASS em 3; FAIL só no "P-89 A" (`ENOENT … ApiAba.tsx` — o componente é do Step 6; passa no Step 7).

- [ ] **Step 5: `src/components/integracao/NovaChaveDialog.tsx`**

```tsx
// Integração — "Nova chave" em 2 passos (mockup 7d/7e): (1) nome → Criar; (2) a chave aparece SÓ UMA VEZ, com Copiar.
// O servidor guarda só o SHA-256 (D17); fechar o passo 2 perde a chave para sempre (o texto avisa).
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { mensagemErro } from "@/lib/erro-mensagem";
import { TEXTO_NOVA_CHAVE_GUARDE } from "@/lib/integracao/api-tela";
import { invalidarIntegracao } from "./useIntegracao";

export function NovaChaveDialog({ onFechar }: { onFechar: () => void }) {
  const tenantId = useActiveTenantId();
  const qc = useQueryClient();
  const [nome, setNome] = useState("");
  const [criada, setCriada] = useState<{ nome: string; chave: string } | null>(null);
  const [criando, setCriando] = useState(false);
  const criar = async () => {
    setCriando(true);
    try {
      const { data, error } = await supabase.rpc("integracao_chave_criar" as any, { _nome: nome.trim() });
      if (error) throw error;
      const o = data as { nome: string; chave: string };
      setCriada({ nome: o.nome, chave: o.chave });
      void qc.invalidateQueries({ queryKey: ["integracao-chaves", tenantId] });
      invalidarIntegracao(qc, tenantId);
    } catch (e) {
      toast.error(mensagemErro(e, "Não foi possível criar a chave."));
    } finally {
      setCriando(false);
    }
  };
  const copiar = async () => {
    if (!criada) return;
    try {
      await navigator.clipboard.writeText(criada.chave);
      toast.success("Chave copiada.");
    } catch {
      toast.error("Não foi possível copiar — selecione o texto e copie à mão.");
    }
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onFechar(); }}>
      <DialogContent className="max-w-md">
        {!criada ? (
          <>
            <DialogHeader>
              <DialogTitle>Nova chave</DialogTitle>
              <DialogDescription>Dê um nome que diga para que serve (ex.: ERP Principal).</DialogDescription>
            </DialogHeader>
            <div className="grid gap-1">
              <Label htmlFor="integracao-nome-chave">Nome da chave</Label>
              <Input id="integracao-nome-chave" maxLength={60} value={nome} onChange={(e) => setNome(e.target.value)} />
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={onFechar}>Cancelar</Button>
              <Button type="button" disabled={nome.trim() === "" || criando} onClick={() => void criar()}>{criando ? "Criando…" : "Criar"}</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Chave "{criada.nome}" criada</DialogTitle>
              <DialogDescription>{TEXTO_NOVA_CHAVE_GUARDE}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-1">
              <Label htmlFor="integracao-chave-gerada">Chave gerada</Label>
              <div className="flex items-center gap-2">
                <Input id="integracao-chave-gerada" readOnly value={criada.chave} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
                <Button type="button" variant="outline" onClick={() => void copiar()}><Copy className="h-4 w-4" />Copiar</Button>
              </div>
            </div>
            <p className="rounded-md bg-[var(--tone-warning-bg)] p-3 text-sm text-[var(--tone-warning-fg)]">{TEXTO_NOVA_CHAVE_GUARDE}</p>
            <DialogFooter>
              <Button type="button" onClick={onFechar}>Concluído</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 6: `src/components/integracao/ApiAba.tsx`**

```tsx
// Integração — aba API (SÓ super admin; mockup 7/7b/7c/5b): sub-abas Chaves · Acessos recentes · Configurações da API.
// Configurações: faixa = erro na hora (Salvar desabilitado); fora do recomendado = alerta antes de salvar (v4).
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { ArrowLeft, KeyRound, Save } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NumberInput } from "@/components/shared/NumberInput";
import { PageActionBar } from "@/components/shared/PageActionBar";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { supabase } from "@/integrations/supabase/client";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { useStoreTimezone } from "@/hooks/useStoreTimezone";
import { mensagemErro } from "@/lib/erro-mensagem";
import {
  TEXTO_CONFIG_API, TEXTO_REVOGAR, entregaAcesso, fmtData, lerAcessos, lerChaves, rotuloChaveAcesso, statusAcesso,
  textoForaRecomendado, type Chave,
} from "@/lib/integracao/api-tela";
import {
  CHAVES_CONFIG_API, CONFIG_API, TEXTO_ALERTA_PAGINA_PLANO_GRATUITO, TEXTO_SO_SUPER, alertaPaginaPlanoGratuito, validarConfigApi,
  type ChaveConfigApi,
} from "@/lib/integracao/campos";
import { fmtDataHora } from "@/lib/integracao/produtos";
import { useAbaSuja } from "./guard";
import { chaveConfig, invalidarIntegracao, useIntegracaoConfig } from "./useIntegracao";
import { NovaChaveDialog } from "./NovaChaveDialog";

type Valores = Record<ChaveConfigApi, number>;

function Chaves() {
  const tenantId = useActiveTenantId();
  const tz = useStoreTimezone();
  const qc = useQueryClient();
  const [nova, setNova] = useState(false);
  const [revogar, setRevogar] = useState<Chave | null>(null);
  const q = useQuery({
    queryKey: ["integracao-chaves", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("integracao_chaves_listar" as any);
      if (error) throw error;
      return lerChaves(data);
    },
  });
  const rev = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("integracao_chave_revogar" as any, { _id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Chave revogada.");
      setRevogar(null);
      void qc.invalidateQueries({ queryKey: ["integracao-chaves", tenantId] });
      invalidarIntegracao(qc, tenantId);
    },
    onError: (e) => toast.error(mensagemErro(e, "Não foi possível revogar a chave.")),
  });
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-medium">Chaves de API</h3>
        <Button type="button" size="sm" onClick={() => setNova(true)}><KeyRound className="h-4 w-4" />Nova chave</Button>
      </div>
      {q.isError ? <p className="text-sm text-destructive">{mensagemErro(q.error, "Erro ao carregar as chaves.")}</p> : (
        <div className="max-w-full overflow-x-auto rounded-md border">
          <table className="w-full min-w-max text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr><th className="px-3 py-2">Nome</th><th className="px-3 py-2">Chave</th><th className="px-3 py-2">Criada por / em</th><th className="px-3 py-2">Último uso</th><th className="px-3 py-2" /></tr>
            </thead>
            <tbody>
              {(q.data ?? []).map((k) => (
                <tr key={k.id} className="border-t">
                  <td className="px-3 py-2">{k.nome}</td>
                  <td className="px-3 py-2 font-mono text-xs">···· {k.final}</td>
                  <td className="px-3 py-2">{k.criadaPor} — {fmtData(k.criadaEm, tz)}</td>
                  <td className="px-3 py-2">{k.ultimoUsoEm ? fmtDataHora(k.ultimoUsoEm, tz, true) : "Nunca usada"}</td>
                  <td className="px-3 py-2 text-right">
                    {k.revogadaEm ? <StatusBadge tone="neutral">Revogada</StatusBadge> : (
                      <Button type="button" size="sm" variant="outline" className="text-destructive" onClick={() => setRevogar(k)}>Revogar</Button>
                    )}
                  </td>
                </tr>
              ))}
              {q.data && q.data.length === 0 && <tr><td colSpan={5} className="px-3 py-4 text-center text-muted-foreground">Nenhuma chave ainda.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">Chaves: só o super admin cria/revoga. Guia completo de uso em Manual da API.</p>
      {nova && <NovaChaveDialog onFechar={() => setNova(false)} />}
      <AlertDialog open={revogar !== null} onOpenChange={(o) => { if (!o && !rev.isPending) setRevogar(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revogar chave "{revogar?.nome}"?</AlertDialogTitle>
            <AlertDialogDescription>{TEXTO_REVOGAR}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={rev.isPending}>Cancelar</AlertDialogCancel>
            <Button type="button" variant="destructive" disabled={rev.isPending} onClick={() => revogar && rev.mutate(revogar.id)}>Revogar chave</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Acessos() {
  const tenantId = useActiveTenantId();
  const tz = useStoreTimezone();
  const q = useQuery({
    queryKey: ["integracao-acessos", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("integracao_acessos_listar" as any, { _limite: 100 });
      if (error) throw error;
      return lerAcessos(data);
    },
  });
  return (
    <div className="space-y-3">
      <h3 className="font-medium">Acessos recentes</h3>
      <p className="text-xs text-muted-foreground">Ordem decrescente (mais recente primeiro).</p>
      {q.isError ? <p className="text-sm text-destructive">{mensagemErro(q.error, "Erro ao carregar os acessos.")}</p> : (
        <div className="max-w-full overflow-x-auto rounded-md border">
          <table className="w-full min-w-max text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr><th className="px-3 py-2">Chave</th><th className="px-3 py-2">Quando</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Produtos entregues</th><th className="px-3 py-2">Linhas</th></tr>
            </thead>
            <tbody>
              {(q.data ?? []).map((a) => {
                const st = statusAcesso(a);
                const en = entregaAcesso(a);
                return (
                  <tr key={a.id} className="border-t">
                    <td className="px-3 py-2">{rotuloChaveAcesso(a)}</td>
                    <td className="px-3 py-2 tabular-nums">{fmtDataHora(a.quando, tz, true)}</td>
                    <td className="px-3 py-2"><StatusBadge tone={st.tom} className="normal-case tracking-normal">{st.texto}</StatusBadge></td>
                    <td className="px-3 py-2 tabular-nums">{en.produtos}</td>
                    <td className="px-3 py-2 tabular-nums">{en.linhas}</td>
                  </tr>
                );
              })}
              {q.data && q.data.length === 0 && <tr><td colSpan={5} className="px-3 py-4 text-center text-muted-foreground">Nenhum acesso ainda.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Configuracoes({ ativo }: { ativo: boolean }) {
  const router = useRouter();
  const tenantId = useActiveTenantId();
  const qc = useQueryClient();
  const q = useIntegracaoConfig();
  const [vals, setVals] = useState<Valores | null>(null);
  const [alerta, setAlerta] = useState<ChaveConfigApi[] | null>(null);
  useEffect(() => { if (q.data?.api && vals === null) setVals({ ...q.data.api }); }, [q.data, vals]);
  const base = q.data?.api ?? null;
  const sujo = !!vals && !!base && CHAVES_CONFIG_API.some((k) => vals[k] !== base[k]);
  useAbaSuja("api", sujo);
  const v = vals ? validarConfigApi(vals) : { erros: {}, foraRecomendado: [] as ChaveConfigApi[] };
  const temErro = Object.keys(v.erros).length > 0;
  const salvar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("integracao_salvar_config_api" as any, { _valores: vals, _rev: q.data?.rev ?? 0 });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Configurações da API salvas.");
      setAlerta(null);
      setVals(null);
      void qc.invalidateQueries({ queryKey: chaveConfig(tenantId) });
      invalidarIntegracao(qc, tenantId);
    },
    onError: (e) => {
      setAlerta(null);
      toast.error(mensagemErro(e, "Não foi possível salvar as configurações."));
      if ((e as { code?: string })?.code === "P0409") { setVals(null); void q.refetch(); }
    },
  });
  const pedirSalvar = () => {
    if (v.foraRecomendado.length > 0) setAlerta(v.foraRecomendado);
    else salvar.mutate();
  };
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{TEXTO_CONFIG_API}</p>
      {!vals ? <p className="text-sm text-muted-foreground">Carregando…</p> : (
        <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
          {CHAVES_CONFIG_API.map((k) => {
            const c = CONFIG_API[k];
            const erro = v.erros[k];
            return (
              <div key={k} className="grid gap-1">
                <Label htmlFor={`cfg-${k}`}>{c.rotulo}</Label>
                <NumberInput id={`cfg-${k}`} integer value={vals[k]} aria-invalid={!!erro}
                  onChange={(e) => setVals((x) => (x ? { ...x, [k]: Math.trunc(Number(e.target.value)) } : x))} />
                <p className="text-xs text-muted-foreground">Recomendado: {c.recomendado} · Faixa permitida: {c.min}–{c.max}</p>
                {erro && <p className="text-xs text-destructive" role="alert">{erro}</p>}
                {/* P-89 A: acima de 100 por página pode passar dos 10 ms de CPU do plano gratuito do Cloudflare */}
                {k === "max_por_pagina" && !erro && alertaPaginaPlanoGratuito(vals.max_por_pagina) && (
                  <p className="text-xs text-[var(--tone-warning-fg)]" role="alert">{TEXTO_ALERTA_PAGINA_PLANO_GRATUITO}</p>
                )}
              </div>
            );
          })}
        </div>
      )}
      <AlertDialog open={alerta !== null} onOpenChange={(o) => { if (!o && !salvar.isPending) setAlerta(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Fora do recomendado</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                {(alerta ?? []).map((k) => <p key={k}><strong>{CONFIG_API[k].rotuloCurto}:</strong> {textoForaRecomendado(k)}</p>)}
                {vals && alertaPaginaPlanoGratuito(vals.max_por_pagina) && <p><strong>Plano gratuito:</strong> {TEXTO_ALERTA_PAGINA_PLANO_GRATUITO}</p>}
                <p>Salvar mesmo assim?</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={salvar.isPending} onClick={() => {
              setVals((x) => {
                if (!x) return x;
                const n = { ...x };
                for (const k of alerta ?? []) n[k] = CONFIG_API[k].recomendado;
                return n;
              });
            }}>Voltar ao recomendado</AlertDialogCancel>
            <Button type="button" disabled={salvar.isPending} onClick={() => salvar.mutate()}>Salvar mesmo assim</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {ativo && (
        <PageActionBar>
          <Button type="button" variant="outline" onClick={() => router.history.back()}><ArrowLeft className="h-4 w-4" />Voltar</Button>
          <Button type="button" className="ml-auto" disabled={!sujo || temErro || salvar.isPending} onClick={pedirSalvar}>
            <Save className="h-4 w-4" />{salvar.isPending ? "Salvando…" : "Salvar"}
          </Button>
        </PageActionBar>
      )}
    </div>
  );
}

export function ApiAba() {
  const [sub, setSub] = useState("chaves");
  return (
    <div className="space-y-4">
      <p className="rounded-md bg-[var(--tone-info-bg)] p-3 text-sm text-[var(--tone-info-fg)]">{TEXTO_SO_SUPER}</p>
      <Tabs value={sub} onValueChange={setSub}>
        <TabsList className="max-w-full overflow-x-auto">
          <TabsTrigger value="chaves">Chaves</TabsTrigger>
          <TabsTrigger value="acessos">Acessos recentes</TabsTrigger>
          <TabsTrigger value="config">Configurações da API</TabsTrigger>
        </TabsList>
        <TabsContent value="chaves" className="mt-4"><Chaves /></TabsContent>
        <TabsContent value="acessos" className="mt-4"><Acessos /></TabsContent>
        <TabsContent value="config" className="mt-4" forceMount hidden={sub !== "config"}><Configuracoes ativo={sub === "config"} /></TabsContent>
      </Tabs>
    </div>
  );
}
```
(`forceMount` na sub-aba Configurações: trocar de sub-aba NÃO perde o rascunho — a guarda da página cobre só a troca de
ABA principal; `hidden` esconde e o `PageActionBar` só aparece com ela ativa.)

Em `src/components/integracao/IntegracaoPage.tsx`: acrescentar `import { ApiAba } from "./ApiAba";` e trocar
`  api: AbaPendente,` por `  api: ApiAba,`.

- [ ] **Step 7: Gates e commit**

```bash
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres
npx vitest run --no-file-parallelism tests/unit/integracao-api-tela.test.ts tests/unit/integracao-tela-fonte.test.ts
bash .superpowers/integracao/gates.sh
git add -- src/lib/integracao/api-tela.ts src/components/integracao/ApiAba.tsx src/components/integracao/NovaChaveDialog.tsx \
  src/components/integracao/IntegracaoPage.tsx tests/unit/integracao-api-tela.test.ts
git commit --only -m "feat(integracao): aba API (super admin) — chaves (criar 1x/revogar), acessos e configurações com faixa e recomendado

Co-Authored-By: Claude <modelo real> <noreply@anthropic.com>" -- src/lib/integracao/api-tela.ts src/components/integracao/ApiAba.tsx \
  src/components/integracao/NovaChaveDialog.tsx src/components/integracao/IntegracaoPage.tsx tests/unit/integracao-api-tela.test.ts
git show --stat HEAD | tail -n +7
```
Expected: PASS (api-tela 4 · tela-fonte 11); `GATES INTEGRACAO: ok`.

---

### Task 16: Aba Manual da API (só super admin) + montagem PURA da resposta + "Ver resposta de exemplo"

**Files:**
- Create: `src/lib/integracao/api/resposta.ts` (contrato `RespostaLer` e `montarResposta` — usados também pela rota, Task 19)
- Create: `src/components/integracao/manual-conteudo.ts` (os 9 tópicos como DADOS + JSONs de exemplo montados pela MESMA função
  da rota)
- Create: `src/components/integracao/ManualAba.tsx`, `src/components/integracao/ExemploDialog.tsx`
- Modify: `src/components/integracao/IntegracaoPage.tsx` (`CONTEUDO_ABA.manual = ManualAba`)
- Test: `tests/unit/integracao-resposta.test.ts`

**Interfaces:**
- Consumes: Task 6 (`RespostaLer` — `integracao_exemplo()` e `_integracao_ler` devolvem esse formato; a coluna `foto` vem como
  LISTA de caminhos na linha do produto e `[]` nas sublinhas; teste = `["exemplo"]`), Task 9 (`CAMPOS`), Task 14
  (`TEXTO_SO_SUPER`).
- Produces (`resposta.ts`): `type StatusLer`, `type ProdutoLer`, `type PaginaApi {limite, maximo}` (D39 — P-89 A),
  `type RespostaLer`, `type LinhaApi`, `type RespostaApi`,
  `type OpcoesMontar {geradoEm, foto(caminhos) → unknown, incluir?(modeloId), integradoEm?(modeloId)}`,
  `caminhosFoto(valores, idx)`, `montarResposta(r, o)`, `CAMINHO_FOTO_EXEMPLO = "/integracao/exemplo-produto.svg"`.
- Produces (`manual-conteudo.ts`): `type Bloco`, `type SecaoManual {id, titulo, blocos}`, `CHAVE_FICTICIA`,
  `TEXTO_PAGINA_PODE_MUDAR` (P-89 A — em Parâmetros, Boas práticas e FAQ), `montarManual(origem)`, `respostaExemplo(modo, origem)`.

- [ ] **Step 1: Escrever o teste (falha: arquivos ausentes)**

`tests/unit/integracao-resposta.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { CAMINHO_FOTO_EXEMPLO, montarResposta, type RespostaLer } from "@/lib/integracao/api/resposta";
import { CHAVE_FICTICIA, TEXTO_PAGINA_PODE_MUDAR, montarManual, respostaExemplo } from "@/components/integracao/manual-conteudo";

const R: RespostaLer = {
  status: "ok", modo: "normal", tenant_id: "t1", loja: { id: "t1", nome: "Loja X" }, colunas: ["Nome", "Foto"],
  chaves_colunas: ["nome", "foto"], proximo_cursor: null, validade_foto_dias: 7, pagina: { limite: 2, maximo: 50 },
  produtos: [
    { modelo_id: "m1", estado: "integravel", assinatura: "a", integrado_em: null, linhas: [
      { tipo: "produto", loja_nome: "Loja X", valores: ["Saia", ["t1/fotos_modelo/a.jpg", "t1/fotos_modelo/b.jpg"]] },
      { tipo: "variante", loja_nome: "Loja X", valores: ["Saia P", []] }] },
    { modelo_id: "m2", estado: "integravel", assinatura: "b", integrado_em: null, linhas: [
      { tipo: "produto", valores: ["Blusa", []] }] },
  ],
};

describe("montarResposta — formato público (spec §7, D5)", () => {
  it("só os confirmados; Foto = lista de links SÓ na linha do produto; integrado_em do confirmar", () => {
    const out = montarResposta(R, {
      geradoEm: "2026-09-26T20:48:00.000Z",
      foto: (c) => c.map((p) => `https://x/${p}`),
      incluir: (id) => id === "m1",
      integradoEm: () => "2026-09-26T17:35:00.000Z",
    });
    expect(out).toEqual({
      versao: 1, modo: "normal", loja: { id: "t1", nome: "Loja X" }, colunas: ["Nome", "Foto"], gerado_em: "2026-09-26T20:48:00.000Z",
      pagina: { limite: 2, maximo: 50 }, // D39 (P-89 A)
      proximo_cursor: null,
      linhas: [
        { tipo: "produto", produto_id: "m1", loja_id: "t1", loja_nome: "Loja X", integrado_em: "2026-09-26T17:35:00.000Z",
          valores: ["Saia", ["https://x/t1/fotos_modelo/a.jpg", "https://x/t1/fotos_modelo/b.jpg"]] },
        { tipo: "variante", produto_id: "m1", loja_id: "t1", loja_nome: "Loja X", integrado_em: "2026-09-26T17:35:00.000Z", valores: ["Saia P", []] },
      ],
    });
  });
  it("sem incluir = todos; loja_nome cai no nome da loja", () => {
    const out = montarResposta(R, { geradoEm: "g", foto: () => null });
    expect(out.linhas.map((l) => l.produto_id)).toEqual(["m1", "m1", "m2"]);
    expect(montarResposta({ ...R, pagina: undefined }, { geradoEm: "g", foto: () => null }).pagina).toBeNull();
    expect(out.linhas[2]).toMatchObject({ loja_nome: "Loja X", valores: ["Blusa", null] });
  });
});

describe("Manual da API (P-81 A) — 9 tópicos e exemplos no formato real", () => {
  it("9 tópicos na ordem do mockup; comandos com o endereço do site e a chave fictícia", () => {
    const m = montarManual("https://sistrama.sung-lee.workers.dev");
    expect(m.map((s) => s.titulo)).toEqual([
      "O que é e como funciona", "Passo a passo para integrar", "Endereço e comandos", "Parâmetros", "A resposta explicada",
      "Códigos de resposta", "Boas práticas", "Perguntas frequentes", "Checklist antes de ligar de verdade",
    ]);
    const cmds = JSON.stringify(m[2]);
    expect(cmds).toContain("https://sistrama.sung-lee.workers.dev/api/integracao/v1/produtos?limite=50");
    // P-89 A: o tamanho da página pode mudar — o texto aparece em Parâmetros, Boas práticas e FAQ
    for (const i of [3, 6, 7]) expect(JSON.stringify(m[i]), m[i].titulo).toContain(TEXTO_PAGINA_PODE_MUDAR);
    expect(JSON.stringify(m[4])).toContain("pagina.maximo");
    expect(cmds).toContain(`Bearer ${CHAVE_FICTICIA}`);
    expect(cmds).toContain("modo=teste");
  });
  it("exemplo TESTE: produtos fictícios, 18 colunas, foto pública de exemplo, cursor da 2ª página", () => {
    const t = respostaExemplo("teste", "https://site");
    expect(t.modo).toBe("teste");
    expect(t.colunas).toHaveLength(18);
    expect(t.linhas[0].produto_id).toBe("exemplo-0001");
    expect(t.linhas[0].valores[17]).toEqual([`https://site${CAMINHO_FOTO_EXEMPLO}`]);
    expect(t.linhas[1].valores[17]).toEqual([]);
    expect(t.linhas.every((l) => l.integrado_em === null)).toBe(true);
    expect(t.proximo_cursor).toBe("eyJleGVtcGxvIjogMn0=");
    expect(t.pagina).toEqual({ limite: 2, maximo: 50 });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres
npx vitest run --no-file-parallelism tests/unit/integracao-resposta.test.ts
```
Expected: FAIL — `Failed to resolve import "@/lib/integracao/api/resposta"`.

- [ ] **Step 3: `src/lib/integracao/api/resposta.ts`**

```ts
// Integração — API: o contrato com o banco (RespostaLer — _integracao_ler/integracao_exemplo, Task 6) e a montagem PURA da
// resposta pública (spec §7): {versao, modo, loja, colunas, gerado_em, pagina{limite, maximo}, linhas[{tipo, produto_id,
// loja_id, loja_nome, integrado_em, valores}], proximo_cursor}. `pagina` (D39, P-89 A): quantos produtos por página esta
// resposta usou e o máximo da loja HOJE — a loja pode mudar o máximo sem aviso; o programa do dev segue o cursor. Usada pela rota (Tasks 19/20) e pelo "Ver resposta de exemplo" do Manual. A
// coluna Foto (D5) chega do banco como LISTA de caminhos na linha do produto ([] nas sublinhas); quem chama decide o valor
// (links assinados, link público de exemplo ou null).
export type StatusLer = "ok" | "parametro_invalido" | "chave_invalida" | "loja_inativa" | "ip_bloqueado" | "limite_excedido";
export type ProdutoLer = {
  modelo_id: string; estado: string; assinatura: string | null; integrado_em: string | null;
  linhas: { tipo: "produto" | "variante"; loja_nome?: string | null; valores: unknown[] }[];
};
export type PaginaApi = { limite: number; maximo: number };
export type RespostaLer = {
  status: StatusLer; retry_after?: number | null; tenant_id?: string | null; modo?: "normal" | "teste"; acesso_id?: string;
  chave_id?: string; loja?: { id: string; nome: string }; colunas?: string[]; chaves_colunas?: string[]; produtos?: ProdutoLer[];
  proximo_cursor?: string | null; validade_foto_dias?: number; pagina?: PaginaApi;
};
export type LinhaApi = {
  tipo: "produto" | "variante"; produto_id: string; loja_id: string; loja_nome: string; integrado_em: string | null; valores: unknown[];
};
export type RespostaApi = {
  versao: 1; modo: "normal" | "teste"; loja: { id: string; nome: string }; colunas: string[]; gerado_em: string;
  pagina: PaginaApi | null; linhas: LinhaApi[]; proximo_cursor: string | null;
};
export type OpcoesMontar = {
  geradoEm: string;
  /** a LISTA de caminhos da coluna Foto de UMA linha de produto → o valor que vai na resposta */
  foto: (caminhos: string[]) => unknown;
  /** só estes produtos entram (normal: os confirmados pelo _integracao_confirmar); ausente = todos (teste/exemplo) */
  incluir?: (modeloId: string) => boolean;
  integradoEm?: (modeloId: string) => string | null;
};
export const CAMINHO_FOTO_EXEMPLO = "/integracao/exemplo-produto.svg";

export function caminhosFoto(valores: unknown[], idx: number): string[] {
  const v = valores[idx];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}
export function montarResposta(r: RespostaLer, o: OpcoesMontar): RespostaApi {
  const idxFoto = (r.chaves_colunas ?? []).indexOf("foto");
  const loja = r.loja ?? { id: r.tenant_id ?? "", nome: "" };
  const linhas: LinhaApi[] = [];
  for (const p of r.produtos ?? []) {
    if (o.incluir && !o.incluir(p.modelo_id)) continue;
    const integradoEm = o.integradoEm ? o.integradoEm(p.modelo_id) : (p.integrado_em ?? null);
    for (const l of p.linhas) {
      const valores = [...l.valores];
      if (idxFoto >= 0) valores[idxFoto] = l.tipo === "produto" ? o.foto(caminhosFoto(l.valores, idxFoto)) : [];
      linhas.push({
        tipo: l.tipo, produto_id: p.modelo_id, loja_id: loja.id, loja_nome: l.loja_nome ?? loja.nome, integrado_em: integradoEm, valores,
      });
    }
  }
  return {
    versao: 1, modo: r.modo ?? "normal", loja, colunas: r.colunas ?? [], gerado_em: o.geradoEm,
    pagina: r.pagina ? { limite: r.pagina.limite, maximo: r.pagina.maximo } : null, linhas,
    proximo_cursor: r.proximo_cursor ?? null,
  };
}
```

- [ ] **Step 4: `src/components/integracao/manual-conteudo.ts`**

```ts
// Integração — Manual da API (P-81 A; mockup 7f): os 9 tópicos como DADOS (a tela só desenha). Linguagem simples, para o
// dono E para o dev; sem segredos (chave fictícia). Os JSONs de exemplo são montados pela MESMA função da rota
// (montarResposta) — o manual nunca diverge do formato real.
import { CAMPOS } from "@/lib/integracao/campos";
import { CAMINHO_FOTO_EXEMPLO, montarResposta, type RespostaApi, type RespostaLer } from "@/lib/integracao/api/resposta";

export type Bloco =
  | { tipo: "p"; texto: string }
  | { tipo: "passos"; itens: string[] }
  | { tipo: "lista"; itens: string[] }
  | { tipo: "codigo"; titulo: string; codigo: string }
  | { tipo: "tabela"; cabecalho: string[]; linhas: string[][] }
  | { tipo: "faq"; itens: { p: string; r: string }[] }
  | { tipo: "exemplo" };
export type SecaoManual = { id: string; titulo: string; blocos: Bloco[] };
export const CHAVE_FICTICIA = "wish_live_EXEMPLO1234567890";
/** P-89 A (dono 27/set): "isso pode mudar depois … como fazer no manual/guia?" — vai em Parâmetros, Boas práticas e FAQ. */
export const TEXTO_PAGINA_PODE_MUDAR =
  "O número de produtos por página pode mudar (é uma configuração da loja). Seu programa nunca deve contar com um tamanho fixo de página: siga o proximo_cursor até ele vir vazio e, se quiser, leia pagina.maximo para pedir páginas maiores.";

const CHAVES = CAMPOS.map((c) => c.key);
const linhaDe = (tipo: "produto" | "variante", v: Record<string, unknown>) => ({ tipo, valores: CHAVES.map((k) => (k in v ? v[k] : null)) });

/** Resposta de exemplo no formato REAL (18 colunas do layout + Foto). Normal = Saia Marola (a única "Integrado em" do mockup);
 *  teste = produtos FICTÍCIOS "Produto Exemplo N" (P-82 A), foto = endereço público de exemplo (n3). */
export function respostaExemplo(modo: "normal" | "teste", origem: string): RespostaApi {
  const loja = { id: "a91f0c2d-0000-4000-8000-000000000001", nome: "WISH360 Demo" };
  const base = modo === "normal"
    ? { nome: "Saia Marola", ref_sku: "SAMA0019", preco_anterior: "199.90", preco_venda: "179.90", peso: "0.310", ncm: "6204.52.00",
        preco_custo: "71.30", titulo: "Saia Marola Godê", descricao: "Saia godê em crepe, comprimento midi.", keywords: "moda feminina, roupas",
        metatag: "Saia godê em crepe, comprimento midi.", comprimento: "90", largura: "36", altura: "2" }
    : { nome: "Produto Exemplo 1", ref_sku: "EXPL0001", preco_anterior: "109.90", preco_venda: "99.90", peso: "0.300", ncm: "6109.10.00",
        preco_custo: "42.00", titulo: "Produto Exemplo 1 - exemplo", descricao: "Descrição de exemplo do produto 1.", keywords: "exemplo, teste",
        metatag: "Descrição de exemplo do produto 1.", comprimento: "60", largura: "40", altura: "2" };
  const variante = modo === "normal"
    ? { ...base, nome: "Saia Marola P", ref_sku: "SAMA0019-PRT-P", cor_base: "Preto", cor_apelido: null, tamanho: "P", foto: [] }
    : { ...base, nome: "Produto Exemplo 1 P", ref_sku: "EXPL0001-COR-P", cor_base: "Cor Exemplo", cor_apelido: "Apelido Exemplo", tamanho: "P", foto: [] };
  const r: RespostaLer = {
    status: "ok", modo, tenant_id: loja.id, loja, colunas: CAMPOS.map((c) => c.rotulo), chaves_colunas: CHAVES,
    proximo_cursor: modo === "teste" ? "eyJleGVtcGxvIjogMn0=" : null,
    pagina: modo === "teste" ? { limite: 2, maximo: 50 } : { limite: 50, maximo: 50 },
    produtos: [{
      modelo_id: modo === "normal" ? "c3a1e2b4-0000-4000-8000-000000000001" : "exemplo-0001", estado: modo === "normal" ? "integrado" : "teste",
      assinatura: null, integrado_em: modo === "normal" ? "2026-09-26T17:35:00.000Z" : null,
      linhas: [linhaDe("produto", { ...base, foto: modo === "normal" ? ["saia-marola.jpg"] : ["exemplo"] }), linhaDe("variante", variante)],
    }],
  };
  return montarResposta(r, {
    geradoEm: "2026-09-26T23:48:00.000Z",
    foto: (c) => c.map((p) => (modo === "teste" ? `${origem}${CAMINHO_FOTO_EXEMPLO}` : `https://…/fotos/${p}?token=…`)),
  });
}

export function montarManual(origem: string): SecaoManual[] {
  const url = `${origem}/api/integracao/v1/produtos`;
  const h = `-H "Authorization: Bearer ${CHAVE_FICTICIA}"`;
  return [
    { id: "s1", titulo: "O que é e como funciona", blocos: [
      { tipo: "p", texto: "A Integração organiza os produtos da loja para serem LIDOS por um programa externo (ERP ou e-commerce) através de uma API própria do sistema. Em 3 passos:" },
      { tipo: "passos", itens: ["Integrável — produto completo, marcado à mão.", "A API leva — o dev consulta com a chave.", "Integrado — travado; só o super admin desfaz."] },
      { tipo: "p", texto: 'O que foi levado fica travado no banco (nome, preço, SKU, fotos…). Um erro depois de enviado é responsabilidade de quem confirmou — não existe "corrigir depois" pelo sistema.' },
    ] },
    { id: "s2", titulo: "Passo a passo para integrar", blocos: [
      { tipo: "passos", itens: [
        "Criar uma chave em API › Chaves (super admin).",
        "Entregar a chave ao dev por um canal SEGURO (nunca por e-mail aberto ou chat público).",
        'O dev testa em modo teste (modo=teste) — no mesmo formato, com produtos de EXEMPLO fictícios; nada vira integrado. Serve para montar o programa sem "gastar" produtos.',
        "Quando estiver funcionando, o dev liga de verdade (sem modo=teste).",
        'Conferir no Log e na aba Produtos se os produtos certos ficaram "Integrado".',
      ] },
    ] },
    { id: "s3", titulo: "Endereço e comandos", blocos: [
      { tipo: "p", texto: "Endereço: GET /api/integracao/v1/produtos — exemplos prontos (chave fictícia abaixo — troque pela sua):" },
      { tipo: "codigo", titulo: "Terminal (curl)", codigo: `# Consulta normal\ncurl "${url}?limite=50" \\\n  ${h}` },
      { tipo: "codigo", titulo: "JavaScript", codigo: `// Consulta normal\nconst r = await fetch(\n  "${url}?limite=50",\n  { headers: { Authorization: "Bearer ${CHAVE_FICTICIA}" } }\n);\nconst dados = await r.json();` },
      { tipo: "codigo", titulo: "Python", codigo: `import requests\nr = requests.get(\n    "${url}",\n    params={"limite": 50},\n    headers={"Authorization": "Bearer ${CHAVE_FICTICIA}"},\n)\ndados = r.json()` },
      { tipo: "codigo", titulo: "Modo teste — produtos de EXEMPLO (fictícios) no formato real; nada vira integrado", codigo: `curl "${url}?modo=teste&limite=20" \\\n  ${h}` },
      { tipo: "codigo", titulo: "Próxima página (cursor)", codigo: `curl "${url}?limite=50&cursor=<proximo_cursor da resposta anterior>" \\\n  ${h}` },
      { tipo: "codigo", titulo: "Reler produtos já integrados (ex.: a resposta anterior se perdeu)", codigo: `curl "${url}?incluir_integrados=1&limite=50" \\\n  ${h}` },
    ] },
    { id: "s4", titulo: "Parâmetros", blocos: [
      { tipo: "tabela", cabecalho: ["Parâmetro", "O que faz", "Padrão", "Exemplo"], linhas: [
        ["modo", "normal ou teste — teste devolve produtos de EXEMPLO fictícios no formato real, nunca dados reais; nada vira integrado", "normal", "modo=teste"],
        ["incluir_integrados", "0 = só integráveis; 1 = inclui os já integrados também", "0", "incluir_integrados=1"],
        ["limite", "nº de produtos por página, até o máximo configurado da loja (hoje, padrão 50); sem limite = o máximo; um produto nunca é partido entre páginas", "o máximo da loja", "limite=50"],
        ["cursor", "devolvido em proximo_cursor da resposta anterior — envie de volta para pedir a próxima página", "vazio (1ª página)", "cursor=…"],
      ] },
      { tipo: "p", texto: TEXTO_PAGINA_PODE_MUDAR },
    ] },
    { id: "s5", titulo: "A resposta explicada", blocos: [
      { tipo: "tabela", cabecalho: ["Campo", "O que é"], linhas: [
        ["versao", "versão do formato da resposta"],
        ["modo", '"normal" ou "teste" (espelha o parâmetro pedido)'],
        ["loja", "{id, nome} — a EMPRESA (não as lojas do Direcionamento)"],
        ["colunas", 'nomes de TODAS as colunas marcadas em "Campos da API", na mesma ordem de valores'],
        ["gerado_em", "data/hora em que esta resposta foi gerada"],
        ["pagina", "{limite, maximo} — limite = quantos produtos por página ESTA resposta usou; maximo = o máximo que a loja permite HOJE (pode mudar). Para páginas maiores, peça limite até pagina.maximo"],
        ["linhas[].tipo", '"produto" (a linha do produto) ou "variante" (uma linha cor × tamanho)'],
        ["produto_id", "id do produto (o mesmo em todas as sublinhas dele)"],
        ["loja_id / loja_nome", "a EMPRESA (não as lojas do Direcionamento)"],
        ["integrado_em", "data/hora em que a API confirmou a entrega (vazio em modo teste — nada é integrado nesse modo)"],
        ["valores", 'na ordem de "colunas"; a coluna Foto traz a LISTA de links (Foto 1..N) na linha do produto — os links expiram'],
        ["proximo_cursor", "passe em cursor na próxima chamada; vazio = não há mais páginas"],
      ] },
      { tipo: "exemplo" },
      { tipo: "codigo", titulo: "JSON de exemplo — modo NORMAL (dados reais da loja; só produtos JÁ INTEGRÁVEIS são levados)", codigo: JSON.stringify(respostaExemplo("normal", origem), null, 2) },
      { tipo: "codigo", titulo: "JSON de exemplo — modo TESTE (produtos FICTÍCIOS, no MESMO FORMATO da loja, nunca dados reais)", codigo: JSON.stringify(respostaExemplo("teste", origem), null, 2) },
      { tipo: "p", texto: 'Nunca dados reais no modo teste — nomes/REFs sempre "Exemplo"/"EXPL..." mesmo que sua loja tenha produtos de verdade. O link da foto também é de exemplo (público).' },
    ] },
    { id: "s6", titulo: "Códigos de resposta", blocos: [
      { tipo: "tabela", cabecalho: ["Código", "O que fazer"], linhas: [
        ["200", "Ok — a resposta veio normal, use os dados."],
        ["400", "Parâmetro inválido — confira modo, incluir_integrados, limite e cursor."],
        ["401", "Chave errada ou revogada — confira a chave; se foi revogada, peça uma nova ao super admin."],
        ["403", "Loja inativa — fale com o super admin."],
        ["429", "Limite excedido (ou IP bloqueado por chaves erradas) — espere o tempo indicado em Retry-After e tente de novo."],
        ["500", "Erro do site — tente de novo; se repetir, avise o suporte."],
      ] },
    ] },
    { id: "s7", titulo: "Boas práticas", blocos: [
      { tipo: "lista", itens: [
        TEXTO_PAGINA_PODE_MUDAR,
        "Guarde o produto_id no seu sistema — é a chave de ligação entre os dois lados.",
        "Se a resposta se perder no meio do caminho, releia com incluir_integrados=1.",
        "Nunca coloque a chave no código do site/app (client-side) — ela é para o servidor do ERP, nunca aparece no navegador.",
        "As fotos expiram em N dias (configuração da loja; padrão 7) — baixe/guarde a foto no seu lado, não dependa do link para sempre.",
      ] },
    ] },
    { id: "s8", titulo: "Perguntas frequentes", blocos: [
      { tipo: "faq", itens: [
        { p: "Posso testar sem afetar os produtos de verdade?", r: "Sim — use modo=teste. A resposta traz produtos de EXEMPLO (fictícios) no mesmo formato da sua loja, nunca dados reais, e nada vira integrado." },
        { p: "Um produto integrado pode ser editado depois?", r: 'Não — os campos que foram para a API ficam travados. Só o super admin pode "Desfazer integração" (com motivo), e aí o produto volta a ser editável.' },
        { p: "Perdi a resposta de uma consulta — e agora?", r: "Releia com incluir_integrados=1: os produtos já confirmados aparecem de novo, sem duplicar nada no banco." },
        { p: "Quantos produtos vêm por página?", r: 'Até o "Máximo de produtos por página" configurado da loja (hoje, padrão 50). A própria resposta diz: pagina.limite (usado nesta resposta) e pagina.maximo (o máximo de hoje). Um produto nunca é dividido entre duas páginas.' },
        { p: "O tamanho da página pode mudar?", r: TEXTO_PAGINA_PODE_MUDAR },
        { p: "O que acontece se eu errar a chave várias vezes?", r: "Depois de N tentativas erradas em 10 minutos (configurável), chaves erradas vindas desse IP ficam bloqueadas por um tempo — a chave certa continua funcionando." },
        { p: "Posso ter mais de uma chave?", r: "Sim — crie uma por integração/ambiente (ex.: uma para o ERP, outra para testes) e revogue a que não usa mais." },
      ] },
    ] },
    { id: "s9", titulo: "Checklist antes de ligar de verdade", blocos: [
      { tipo: "lista", itens: [
        "Testei em modo=teste e a resposta trouxe os campos que eu esperava.",
        "Sei paginar até proximo_cursor vazio.",
        "Guardo o produto_id no meu sistema.",
        "A chave está guardada com segurança (nunca no código do site/app).",
        "Sei o que fazer em cada código de erro (400/401/403/429/500).",
        'Combinei com o time quando os produtos vão passar de "Integrável" para "Integrado" de verdade.',
      ] },
    ] },
  ];
}
```

- [ ] **Step 5: Rodar o teste (PASS)**

```bash
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres
npx vitest run --no-file-parallelism tests/unit/integracao-resposta.test.ts
```
Expected: PASS (4).

- [ ] **Step 6: `src/components/integracao/ExemploDialog.tsx` e `src/components/integracao/ManualAba.tsx`**

```tsx
// Integração — "Ver resposta de exemplo" (N12): RPC só leitura integracao_exemplo (SÓ super admin, loja atual, produtos
// FICTÍCIOS com as colunas marcadas da loja); NÃO registra acesso nem conta no limite. Foto = null (sem link) de propósito.
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { mensagemErro } from "@/lib/erro-mensagem";
import { montarResposta, type RespostaLer } from "@/lib/integracao/api/resposta";

export function ExemploDialog({ onFechar }: { onFechar: () => void }) {
  const tenantId = useActiveTenantId();
  const q = useQuery({
    queryKey: ["integracao-exemplo", tenantId],
    enabled: !!tenantId,
    staleTime: 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("integracao_exemplo" as any);
      if (error) throw error;
      return montarResposta(data as RespostaLer, { geradoEm: new Date().toISOString(), foto: () => null });
    },
  });
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onFechar(); }}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Resposta de exemplo (modo teste)</DialogTitle>
          <DialogDescription>
            Produtos de EXEMPLO fictícios no mesmo formato da loja (nunca dados reais). Aqui a Foto vem null (sem link) de propósito.
          </DialogDescription>
        </DialogHeader>
        {q.isError ? <p className="text-sm text-destructive">{mensagemErro(q.error, "Não foi possível montar o exemplo.")}</p>
          : !q.data ? <p className="text-sm text-muted-foreground">Montando…</p>
            : <pre className="max-w-full overflow-x-auto rounded-md bg-muted p-3 text-xs">{JSON.stringify(q.data, null, 2)}</pre>}
        <DialogFooter><Button type="button" onClick={onFechar}>Fechar</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

```tsx
// Integração — aba "Manual da API" (SÓ super admin — P-81 A; mockup 7f/9b). Índice ao lado + os 9 tópicos (a tela só existe
// em tela larga — P-87). Conteúdo em manual-conteudo.ts; comandos com o endereço do PRÓPRIO site.
import { useMemo, useState } from "react";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { TEXTO_SO_SUPER } from "@/lib/integracao/campos";
import { montarManual, type Bloco, type SecaoManual } from "./manual-conteudo";
import { ExemploDialog } from "./ExemploDialog";

function Codigo({ titulo, codigo }: { titulo: string; codigo: string }) {
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(codigo);
      toast.success("Copiado.");
    } catch {
      toast.error("Não foi possível copiar — selecione o texto e copie à mão.");
    }
  };
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{titulo}</span>
        <Button type="button" variant="outline" size="sm" onClick={() => void copiar()}><Copy className="h-4 w-4" />Copiar</Button>
      </div>
      <pre className="max-w-full overflow-x-auto rounded-md bg-muted p-3 text-xs">{codigo}</pre>
    </div>
  );
}
function Blocos({ blocos, onExemplo }: { blocos: Bloco[]; onExemplo: () => void }) {
  return (
    <div className="space-y-3 text-sm">
      {blocos.map((b, i) => {
        switch (b.tipo) {
          case "p": return <p key={i}>{b.texto}</p>;
          case "passos": return <ol key={i} className="list-decimal space-y-1 pl-5">{b.itens.map((x) => <li key={x}>{x}</li>)}</ol>;
          case "lista": return <ul key={i} className="list-disc space-y-1 pl-5">{b.itens.map((x) => <li key={x}>{x}</li>)}</ul>;
          case "codigo": return <Codigo key={i} titulo={b.titulo} codigo={b.codigo} />;
          case "faq": return (
            <dl key={i} className="space-y-2">
              {b.itens.map((x) => <div key={x.p}><dt className="font-medium">{x.p}</dt><dd className="text-muted-foreground">{x.r}</dd></div>)}
            </dl>
          );
          case "tabela": return (
            <div key={i} className="max-w-full overflow-x-auto rounded-md border">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 text-left text-muted-foreground"><tr>{b.cabecalho.map((c) => <th key={c} className="px-2 py-2">{c}</th>)}</tr></thead>
                <tbody>{b.linhas.map((l) => <tr key={l[0]} className="border-t align-top">{l.map((c, j) => <td key={j} className={j === 0 ? "px-2 py-2 font-mono" : "px-2 py-2"}>{c}</td>)}</tr>)}</tbody>
              </table>
            </div>
          );
          case "exemplo": return <Button key={i} type="button" variant="outline" onClick={onExemplo}>Ver resposta de exemplo (modo teste)</Button>;
        }
      })}
    </div>
  );
}

export function ManualAba() {
  const secoes: SecaoManual[] = useMemo(() => montarManual(typeof window === "undefined" ? "" : window.location.origin), []);
  const [exemplo, setExemplo] = useState(false);
  return (
    <div className="space-y-4">
      <p className="rounded-md bg-[var(--tone-info-bg)] p-3 text-sm text-[var(--tone-info-fg)]">{TEXTO_SO_SUPER}</p>
      <p className="text-sm text-muted-foreground">Linguagem simples, para o dono E para o dev.</p>
      <div className="grid grid-cols-[14rem_1fr] gap-6">
        <nav aria-label="Índice do manual" className="sticky top-4 self-start">
          <ol className="space-y-1 text-sm">
            {secoes.map((s, i) => <li key={s.id}><a href={`#manual-${s.id}`} className="text-primary hover:underline">{i + 1}. {s.titulo}</a></li>)}
          </ol>
        </nav>
        <div className="min-w-0 space-y-8">
          {secoes.map((s, i) => (
            <section key={s.id} id={`manual-${s.id}`} className="scroll-mt-4 space-y-3">
              <h3 className="font-display text-lg font-semibold">{i + 1}. {s.titulo}</h3>
              <Blocos blocos={s.blocos} onExemplo={() => setExemplo(true)} />
            </section>
          ))}
        </div>
      </div>
      {exemplo && <ExemploDialog onFechar={() => setExemplo(false)} />}
    </div>
  );
}
```

Em `src/components/integracao/IntegracaoPage.tsx`: acrescentar `import { ManualAba } from "./ManualAba";` e trocar
`  manual: AbaPendente,` por `  manual: ManualAba,`.

- [ ] **Step 7: Gates e commit**

```bash
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres
npx vitest run --no-file-parallelism tests/unit/integracao-resposta.test.ts tests/unit/integracao-tela-fonte.test.ts
bash .superpowers/integracao/gates.sh
git add -- src/lib/integracao/api/resposta.ts src/components/integracao/manual-conteudo.ts src/components/integracao/ManualAba.tsx \
  src/components/integracao/ExemploDialog.tsx src/components/integracao/IntegracaoPage.tsx tests/unit/integracao-resposta.test.ts
git commit --only -m "feat(integracao): Manual da API (9 tópicos, exemplos no formato real) e Ver resposta de exemplo

Co-Authored-By: Claude <modelo real> <noreply@anthropic.com>" -- src/lib/integracao/api/resposta.ts \
  src/components/integracao/manual-conteudo.ts src/components/integracao/ManualAba.tsx src/components/integracao/ExemploDialog.tsx \
  src/components/integracao/IntegracaoPage.tsx tests/unit/integracao-resposta.test.ts
git show --stat HEAD | tail -n +7
```
Expected: PASS (resposta 4 · tela-fonte 11); `GATES INTEGRACAO: ok`.

---

### Task 17: Aba Log por papel (N11)

**Files:**
- Create: `src/lib/integracao/log.ts` (leitura e texto do detalhe — PURO)
- Create: `src/components/integracao/LogAba.tsx`
- Modify: `src/components/integracao/IntegracaoPage.tsx` (`CONTEUDO_ABA.log = LogAba`)
- Test: `tests/unit/integracao-log.test.ts`

**Interfaces:**
- Consumes: RPC `integracao_log_listar(_pagina)` → `{pagina, por_pagina, total, super, linhas[{id, acao, quem, quando, modelo_id,
  modelo_nome, detalhe}]}` (Task 3; não-super recebe só as ações de produto); formatos do `detalhe` gravados pelas Tasks 3,
  5 e 6: integrar `{campos, sublinhas}`, voltar `{}`, desfazer `{motivo, integrado_em, retrato}`, editar `{campos: {<coluna>:
  {antes, depois}}}` ou `{keywords: {antes, depois}}`, campos `{antes[], depois[]}`, config_api `{antes{…}, depois{…}}`,
  chave_criar/chave_revogar `{nome, final}`, integrado `{chave, final, acesso_id}`; Task 9 (`rotuloNaLista`, `CONFIG_API`,
  `CHAVES_CONFIG_API`), Task 10 (`fmtDataHora`), `brl`.
- Produces: `type LinhaLog`, `type PaginaLog`, `ROTULO_ACAO`, `lerLog(raw)`, `textoDetalhe(l)`, `TEXTO_LOG_NAO_SUPER`;
  `<LogAba/>`.

- [ ] **Step 1: Escrever o teste (falha: arquivo ausente)**

`tests/unit/integracao-log.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { brl } from "@/lib/format";
import { ROTULO_ACAO, lerLog, textoDetalhe } from "@/lib/integracao/log";

const l = (acao: string, detalhe: unknown) => lerLog({ pagina: 1, por_pagina: 50, total: 1, super: true,
  linhas: [{ id: "1", acao, quem: "Marina Alves", quando: "2026-09-26T18:10:00Z", modelo_id: "m", modelo_nome: "Calça Duna", detalhe }] }).linhas[0];

describe("Log — detalhe legível (mockup 8)", () => {
  it("ações de produto", () => {
    expect(textoDetalhe(l("integrar", { campos: 18, sublinhas: 6 }))).toBe("Retrato com 18 campos + 6 sublinhas");
    expect(textoDetalhe(l("integrado", { chave: "ERP Principal", final: "a1b2" }))).toBe("A API confirmou a entrega");
    expect(textoDetalhe(l("voltar", {}))).toBe("Voltou para não integrável");
    expect(textoDetalhe(l("desfazer", { motivo: "NCM errado" }))).toBe('Motivo: "NCM errado"');
    expect(textoDetalhe(l("editar", { campos: { peso_kg: { antes: 0.65, depois: 0.68 }, preco_venda: { antes: 100, depois: 120 } } })))
      .toBe(`Peso: 0,650 kg → 0,680 kg · Preço de venda: ${brl(100)} → ${brl(120)} (salvo)`);
    expect(textoDetalhe(l("editar", { keywords: { antes: "a", depois: "a, b" } }))).toBe('Keywords da loja: "a" → "a, b" (salvo)');
  });
  it("ações do super admin", () => {
    expect(textoDetalhe(l("campos", { antes: ["nome"], depois: ["nome", "foto"] }))).toBe('Adicionado "Foto do Modelo" à seleção');
    expect(textoDetalhe(l("campos", { antes: ["nome", "ncm"], depois: ["nome"] }))).toBe('Removido "NCM" da seleção');
    expect(textoDetalhe(l("config_api", { antes: { bloqueio_tentativas: 10, limite_por_minuto: 60 }, depois: { bloqueio_tentativas: 20, limite_por_minuto: 60 } })))
      .toBe("Bloqueio de IP: 10 → 20");
    expect(textoDetalhe(l("chave_criar", { nome: "ERP Principal", final: "a1b2" }))).toBe('Chave "ERP Principal" criada');
    expect(textoDetalhe(l("chave_revogar", { nome: "Integração antiga", final: "90ce" }))).toBe('Chave "Integração antiga" revogada');
    expect(ROTULO_ACAO.config_api).toBe("Config. API");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres
npx vitest run --no-file-parallelism tests/unit/integracao-log.test.ts
```
Expected: FAIL — `Failed to resolve import "@/lib/integracao/log"`.

- [ ] **Step 3: `src/lib/integracao/log.ts`**

```ts
// Integração — Log (N11): o que cada linha diz, em PT, a partir do `detalhe` jsonb gravado pelo banco. PURO.
import { brl } from "@/lib/format";
import { CHAVES_CONFIG_API, CONFIG_API, rotuloNaLista, type CampoKey } from "@/lib/integracao/campos";

export type LinhaLog = {
  id: string; acao: string; quem: string; quando: string | null; modeloId: string | null; modeloNome: string | null;
  detalhe: Record<string, unknown>;
};
export type PaginaLog = { pagina: number; porPagina: number; total: number; superAdmin: boolean; linhas: LinhaLog[] };
export const ROTULO_ACAO: Record<string, string> = {
  campos: "Campos", editar: "Editar", integrar: "Integrar", voltar: "Voltar", desfazer: "Desfazer", integrado: "Integrado",
  chave_criar: "Chave criar", chave_revogar: "Chave revogar", config_api: "Config. API",
};
export const TEXTO_LOG_NAO_SUPER =
  "Você vê só as ações de PRODUTO (editar, integrar, voltar, desfazer, integrado). Ações de campos, chaves e configurações da API são só do super admin.";

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const txt = (v: unknown): string | null => (typeof v === "string" ? v : null);

export function lerLog(raw: unknown): PaginaLog {
  const o = obj(raw);
  return {
    pagina: Number(o.pagina ?? 1), porPagina: Number(o.por_pagina ?? 50), total: Number(o.total ?? 0), superAdmin: o.super === true,
    linhas: arr(o.linhas).map(obj).map((x) => ({
      id: txt(x.id) ?? String(x.id ?? ""), acao: txt(x.acao) ?? "", quem: txt(x.quem) ?? "—", quando: txt(x.quando),
      modeloId: txt(x.modelo_id), modeloNome: txt(x.modelo_nome), detalhe: obj(x.detalhe),
    })),
  };
}

const ROTULO_COLUNA: Record<string, string> = {
  nome: "Nome", ref: "REF", preco_anterior: "Preço anterior", preco_venda: "Preço de venda", peso_kg: "Peso", ncm: "NCM",
  titulo_pagina: "Título para a página", descricao_produto: "Descrição", comprimento_cm: "Comprimento", largura_cm: "Largura",
  altura_cm: "Altura", fotos_modelo: "Fotos",
};
function valorColuna(col: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (col === "preco_anterior" || col === "preco_venda") return brl(Number(v));
  if (col === "peso_kg") return `${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} kg`;
  if (col.endsWith("_cm")) return `${Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} cm`;
  if (col === "fotos_modelo") return Array.isArray(v) ? `${v.length} foto(s)` : "—";
  return String(v);
}

export function textoDetalhe(l: LinhaLog): string {
  const d = l.detalhe;
  switch (l.acao) {
    case "integrar": return `Retrato com ${Number(d.campos ?? 0)} campos + ${Number(d.sublinhas ?? 0)} sublinhas`;
    case "integrado": return "A API confirmou a entrega";
    case "voltar": return "Voltou para não integrável";
    case "desfazer": return `Motivo: "${txt(d.motivo) ?? ""}"`;
    case "editar": {
      if (d.keywords) {
        const k = obj(d.keywords);
        return `Keywords da loja: "${txt(k.antes) ?? ""}" → "${txt(k.depois) ?? ""}" (salvo)`;
      }
      const partes = Object.entries(obj(d.campos)).map(([col, x]) => {
        const ad = obj(x);
        return `${ROTULO_COLUNA[col] ?? col}: ${valorColuna(col, ad.antes)} → ${valorColuna(col, ad.depois)}`;
      });
      return partes.length ? `${partes.join(" · ")} (salvo)` : "Editado (salvo)";
    }
    case "campos": {
      const antes = new Set(arr(d.antes).map(String));
      const depois = new Set(arr(d.depois).map(String));
      const add = [...depois].filter((k) => !antes.has(k)).map((k) => `Adicionado "${rotuloNaLista(k as CampoKey)}" à seleção`);
      const rem = [...antes].filter((k) => !depois.has(k)).map((k) => `Removido "${rotuloNaLista(k as CampoKey)}" da seleção`);
      return [...add, ...rem].join(" · ") || "Seleção salva sem mudança";
    }
    case "config_api": {
      const a = obj(d.antes);
      const b = obj(d.depois);
      const partes = CHAVES_CONFIG_API.filter((k) => a[k] !== b[k]).map((k) => `${CONFIG_API[k].rotuloCurto}: ${String(a[k] ?? "—")} → ${String(b[k] ?? "—")}`);
      return partes.join(" · ") || "Configurações salvas sem mudança";
    }
    case "chave_criar": return `Chave "${txt(d.nome) ?? ""}" criada`;
    case "chave_revogar": return `Chave "${txt(d.nome) ?? ""}" revogada`;
    default: return "—";
  }
}
```

- [ ] **Step 4: Rodar o teste (PASS)**

```bash
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres
npx vitest run --no-file-parallelism tests/unit/integracao-log.test.ts
```
Expected: PASS (2).

- [ ] **Step 5: `src/components/integracao/LogAba.tsx`**

```tsx
// Integração — aba Log (mockup 8; N11 por papel — o servidor já filtra: não-super recebe só ações de PRODUTO).
import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { useStoreTimezone } from "@/hooks/useStoreTimezone";
import { mensagemErro } from "@/lib/erro-mensagem";
import { ROTULO_ACAO, TEXTO_LOG_NAO_SUPER, lerLog, textoDetalhe } from "@/lib/integracao/log";
import { fmtDataHora } from "@/lib/integracao/produtos";
import { chaveLog } from "./useIntegracao";

export function LogAba() {
  const tenantId = useActiveTenantId();
  const tz = useStoreTimezone();
  const [pagina, setPagina] = useState(1);
  const q = useQuery({
    queryKey: [...chaveLog(tenantId), pagina],
    enabled: !!tenantId,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("integracao_log_listar" as any, { _pagina: pagina });
      if (error) throw error;
      return lerLog(data);
    },
  });
  const d = q.data;
  const totalPaginas = d ? Math.max(1, Math.ceil(d.total / d.porPagina)) : 1;
  return (
    <div className="space-y-3">
      {d && !d.superAdmin && <p className="text-sm text-muted-foreground">{TEXTO_LOG_NAO_SUPER}</p>}
      {q.isError ? <p className="text-sm text-destructive">{mensagemErro(q.error, "Erro ao carregar o Log.")}</p> : (
        <div className="max-w-full overflow-x-auto rounded-md border">
          <table className="w-full min-w-max text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr><th className="px-3 py-2">Ação</th><th className="px-3 py-2">Quem</th><th className="px-3 py-2">Quando</th><th className="px-3 py-2">Produto</th><th className="px-3 py-2">Detalhe</th></tr>
            </thead>
            <tbody>
              {(d?.linhas ?? []).map((l) => (
                <tr key={l.id} className="border-t align-top">
                  <td className="whitespace-nowrap px-3 py-2">{ROTULO_ACAO[l.acao] ?? l.acao}</td>
                  <td className="px-3 py-2">{l.quem}</td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">{fmtDataHora(l.quando, tz, true)}</td>
                  <td className="px-3 py-2">
                    {l.modeloId ? (
                      <Link to="/criacao/planejamento" search={{ modelo: l.modeloId }} className="text-primary hover:underline">{l.modeloNome ?? "produto"}</Link>
                    ) : "—"}
                  </td>
                  <td className="px-3 py-2">{textoDetalhe(l)}</td>
                </tr>
              ))}
              {d && d.linhas.length === 0 && <tr><td colSpan={5} className="px-3 py-4 text-center text-muted-foreground">Nada registrado ainda.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {d && d.total > d.porPagina && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button type="button" size="sm" variant="outline" disabled={pagina <= 1} onClick={() => setPagina((n) => n - 1)}>Anterior</Button>
          <span className="text-muted-foreground">Página {pagina} de {totalPaginas}</span>
          <Button type="button" size="sm" variant="outline" disabled={pagina >= totalPaginas} onClick={() => setPagina((n) => n + 1)}>Próxima</Button>
        </div>
      )}
    </div>
  );
}
```

Em `src/components/integracao/IntegracaoPage.tsx`: acrescentar `import { LogAba } from "./LogAba";`, trocar `  log: AbaPendente,` por
`  log: LogAba,` e APAGAR a função `AbaPendente` e o import de `EmptyState`/`Construction` (não sobra aba pendente).

- [ ] **Step 6: Gates e commit**

```bash
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres
npx vitest run --no-file-parallelism tests/unit/integracao-log.test.ts tests/unit/integracao-tela-fonte.test.ts
bash .superpowers/integracao/gates.sh
git add -- src/lib/integracao/log.ts src/components/integracao/LogAba.tsx src/components/integracao/IntegracaoPage.tsx tests/unit/integracao-log.test.ts
git commit --only -m "feat(integracao): aba Log por papel com o detalhe legível

Co-Authored-By: Claude <modelo real> <noreply@anthropic.com>" -- src/lib/integracao/log.ts src/components/integracao/LogAba.tsx \
  src/components/integracao/IntegracaoPage.tsx tests/unit/integracao-log.test.ts
git show --stat HEAD | tail -n +7
```
Expected: PASS (log 2 · tela-fonte 11); `GATES INTEGRACAO: ok`.

---

### Task 18: P-87 — sem tela no celular (aviso na rota + item escondido no menu)

**Files:**
- Create: `src/components/integracao/AvisoComputador.tsx`
- Modify: `src/routes/_authenticated/integracao.tsx` (tela estreita = só o aviso)
- Modify: `src/components/app-sidebar.tsx` (item "Integração" da loja e do Admin Mestre com `max-md:hidden`)
- Test: bloco novo em `tests/unit/integracao-tela-fonte.test.ts`

**Interfaces:**
- Consumes: `useIsMobile()` (`@/hooks/use-mobile` — `< 768 px`, valor inicial síncrono), `EmptyState`, Task 9 (rota, item do
  Admin Mestre).
- Produces: `TEXTO_SO_COMPUTADOR = "A Integração é usada no computador"`, `<AvisoComputador/>`. Em tela estreita a
  `IntegracaoPage` NEM MONTA (nenhuma RPC `integracao_*` roda). Os selos/travas das OUTRAS telas (Tasks 21–24) seguem no
  celular (P-87: "celular não vai ter essa tela" — dono, 27/set; D33).

- [ ] **Step 1: Escrever o teste (falha)**

Acrescentar ao FIM de `tests/unit/integracao-tela-fonte.test.ts`:

```ts
describe("Integração — P-87: sem tela no celular", () => {
  it("rota: tela estreita mostra só o aviso (a página nem monta)", () => {
    const r = ler("src/routes/_authenticated/integracao.tsx");
    expect(r).toMatch(/useIsMobile\(\)/);
    expect(r).toMatch(/estreita \? <AvisoComputador \/> : <IntegracaoPage \/>/);
    expect(ler("src/components/integracao/AvisoComputador.tsx")).toMatch(/A Integração é usada no computador/);
  });
  it("menu: o item Integração (loja e Admin Mestre) some em tela estreita", () => {
    const s = ler("src/components/app-sidebar.tsx");
    expect(s).toMatch(/item\.url === "\/integracao" \? "max-md:hidden"/);
    expect(s).toMatch(/<SidebarMenuItem className="max-md:hidden">\s*<SidebarMenuButton asChild isActive=\{isActive\("\/integracao"\)\}/);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres
npx vitest run --no-file-parallelism tests/unit/integracao-tela-fonte.test.ts
```
Expected: FAIL — `ENOENT … AvisoComputador.tsx` e as regex do menu.

- [ ] **Step 3: `src/components/integracao/AvisoComputador.tsx`**

```tsx
// Integração — P-87 (dono 27/set: "celular não vai ter essa tela"): em tela estreita a rota mostra SÓ este aviso (sem
// dados, sem ações). Os selos/travas das OUTRAS telas (Sheet do Planejamento, PA/PI, Plan. Tecido) continuam no celular.
import { Monitor } from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";

export const TEXTO_SO_COMPUTADOR = "A Integração é usada no computador";

export function AvisoComputador() {
  return (
    <div className="p-4">
      <EmptyState
        icon={Monitor}
        title={TEXTO_SO_COMPUTADOR}
        description="Abra esta tela num computador (tela larga). Os selos de integração continuam aparecendo nas telas do produto."
      />
    </div>
  );
}
```

- [ ] **Step 4: Rota e menu**

`src/routes/_authenticated/integracao.tsx` — trocar o arquivo inteiro por:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { RequirePermission } from "@/components/RequirePermission";
import { IntegracaoPage } from "@/components/integracao/IntegracaoPage";
import { AvisoComputador } from "@/components/integracao/AvisoComputador";
import { useIsMobile } from "@/hooks/use-mobile";

function PaginaIntegracao() {
  // P-87: < 768 px = só o aviso — a IntegracaoPage (e as RPCs dela) nem monta.
  const estreita = useIsMobile();
  return estreita ? <AvisoComputador /> : <IntegracaoPage />;
}

export const Route = createFileRoute("/_authenticated/integracao")({
  component: () => (
    <RequirePermission page="integracao">
      <PaginaIntegracao />
    </RequirePermission>
  ),
});
```

`src/components/app-sidebar.tsx` — no `renderItem` (item de topo sem sub-itens), trocar
```tsx
      return (
        <SidebarMenuItem key={item.url}>
          <SidebarMenuButton asChild isActive={active} tooltip={item.title}>
            <Link to={item.url} className="relative">
```
por
```tsx
      return (
        // P-87: a Integração não tem tela no celular — o item some em tela estreita
        <SidebarMenuItem key={item.url} className={item.url === "/integracao" ? "max-md:hidden" : undefined}>
          <SidebarMenuButton asChild isActive={active} tooltip={item.title}>
            <Link to={item.url} className="relative">
```
e, no item do Admin Mestre criado na Task 9, trocar
```tsx
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={isActive("/integracao")} tooltip="Integração">
```
por
```tsx
                <SidebarMenuItem className="max-md:hidden">
                  <SidebarMenuButton asChild isActive={isActive("/integracao")} tooltip="Integração">
```

- [ ] **Step 5: Rodar (PASS), gates e commit**

```bash
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres
npx vitest run --no-file-parallelism tests/unit/integracao-tela-fonte.test.ts
bash .superpowers/integracao/gates.sh
git add -- src/components/integracao/AvisoComputador.tsx src/routes/_authenticated/integracao.tsx src/components/app-sidebar.tsx \
  tests/unit/integracao-tela-fonte.test.ts
git commit --only -m "feat(integracao): P-87 — sem tela no celular (aviso na rota, item escondido no menu)

Co-Authored-By: Claude <modelo real> <noreply@anthropic.com>" -- src/components/integracao/AvisoComputador.tsx \
  src/routes/_authenticated/integracao.tsx src/components/app-sidebar.tsx tests/unit/integracao-tela-fonte.test.ts
git show --stat HEAD | tail -n +7
```
Expected: PASS (tela-fonte 13); `GATES INTEGRACAO: ok`. A conferência em 360/390 (item some, aviso sem chamar
`integracao_listar`, selos das outras telas) é da QA (Task 25).

---


# FASE 3 — API

### Task 19: Handler PURO da API (`GET /api/integracao/v1/produtos`) — parâmetros, 2 fases, fotos, códigos HTTP

**Files:**
- Create: `src/lib/integracao/api/parametros.ts`, `src/lib/integracao/api/rota.ts`
- Test: `tests/unit/integracao-api.test.ts`

**Interfaces:**
- Consumes: Task 16 (`RespostaLer`, `montarResposta`, `caminhosFoto`, `CAMINHO_FOTO_EXEMPLO`); contrato das 3 funções da rota
  (Task 6): `_integracao_ler(_chave_hash, _incluir_integrados, _cursor, _limite, _modo, _ip) → RespostaLer`,
  `_integracao_confirmar(_chave_id, _acesso_id, _entrega {produtos[{modelo_id, assinatura}], fotos_descartadas,
  fotos_ausentes}) → {status, confirmados[{modelo_id, integrado_em}]}`, `_integracao_limpar(_tenant) → integer`.
- Produces (`parametros.ts`): `type Parametros {modo, incluir, limite, cursor}`, `lerParametros(url): Parametros | null`.
- Produces (`rota.ts`): `type DepsRota`, `tratarRequisicao(req, deps): Promise<Response>`, `CABECALHOS_JSON`,
  `respostaErro(status, erro, retryAfter?)`. Corpo de erro SEMPRE ASCII mínimo `{"erro":"<codigo>"}` (401 `chave_invalida`,
  403 `loja_inativa`, 429 `limite_excedido`/`ip_bloqueado` + `Retry-After`, 400 `parametro_invalido`, 500 `erro_interno`);
  NUNCA ecoa a chave nem texto interno.

- [ ] **Step 1: Escrever o teste (falha: arquivos ausentes)**

`tests/unit/integracao-api.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { lerParametros } from "@/lib/integracao/api/parametros";
import { tratarRequisicao, type DepsRota } from "@/lib/integracao/api/rota";
import type { RespostaLer } from "@/lib/integracao/api/resposta";

const CHAVE = "wish_live_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345";
const T = "11111111-1111-4111-8111-111111111111";
const OK: RespostaLer = {
  status: "ok", modo: "normal", acesso_id: "ac1", chave_id: "k1", tenant_id: T, loja: { id: T, nome: "Loja X" },
  colunas: ["Nome", "Foto"], chaves_colunas: ["nome", "foto"], proximo_cursor: null, validade_foto_dias: 7,
  pagina: { limite: 50, maximo: 50 },
  produtos: [
    { modelo_id: "m1", estado: "integravel", assinatura: "s1", integrado_em: null, linhas: [
      { tipo: "produto", loja_nome: "Loja X", valores: ["Saia", [`${T}/fotos_modelo/a.jpg`, `outra-loja/fotos_modelo/x.jpg`, `${T}/fotos_modelo/sumiu.jpg`]] },
      { tipo: "variante", loja_nome: "Loja X", valores: ["Saia P", []] }] },
    { modelo_id: "m2", estado: "integravel", assinatura: "s2", integrado_em: null, linhas: [{ tipo: "produto", valores: ["Blusa", []] }] },
  ],
};
function deps(o: Partial<DepsRota> = {}) {
  const log: string[] = [];
  const d: DepsRota = {
    hashChave: vi.fn(async (c: string) => `h(${c.length})`),
    ler: vi.fn(async () => OK),
    assinarFotos: vi.fn(async (c: string[]) => new Map(c.map((p) => [p, p.endsWith("sumiu.jpg") ? null : `https://s/${p}?t=1`]))),
    confirmar: vi.fn(async () => ({ status: "ok", confirmados: [{ modelo_id: "m1", integrado_em: "2026-09-26T17:35:00.000Z" }] })),
    limpar: vi.fn(async () => { log.push("limpar"); }),
    depois: vi.fn((p: Promise<unknown>) => { void p; }),
    tetoIp: vi.fn(async () => true),
    agora: () => new Date("2026-09-26T20:48:00.000Z"),
    origem: "https://site",
    ...o,
  };
  return { d, log };
}
const req = (q = "", auth: string | null = `Bearer ${CHAVE}`) =>
  new Request(`https://site/api/integracao/v1/produtos${q}`, { headers: { ...(auth ? { authorization: auth } : {}), "cf-connecting-ip": "203.0.113.5" } });
const corpo = async (r: Response) => JSON.parse(await r.text());

describe("parâmetros", () => {
  it("padrões e validação", () => {
    expect(lerParametros(new URL("https://s/x"))).toEqual({ modo: "normal", incluir: false, limite: null, cursor: null });
    expect(lerParametros(new URL("https://s/x?modo=teste&incluir_integrados=1&limite=100&cursor=eyJkZXBvaXMiOiJ4In0="))).toEqual(
      { modo: "teste", incluir: true, limite: 100, cursor: "eyJkZXBvaXMiOiJ4In0=" });
    for (const q of ["modo=xpto", "incluir_integrados=talvez", "limite=0", "limite=abc", "limite=99999", "cursor=%3Cscript%3E"]) {
      expect(lerParametros(new URL(`https://s/x?${q}`)), q).toBeNull();
    }
  });
});

describe("rota — códigos HTTP e corpo mínimo ASCII", () => {
  it("sem Authorization: registra a tentativa (hash de vazio) e devolve 401", async () => {
    const { d } = deps({ ler: vi.fn(async () => ({ status: "chave_invalida" }) as RespostaLer) });
    const r = await tratarRequisicao(req("", null), d);
    expect(r.status).toBe(401);
    expect(await corpo(r)).toEqual({ erro: "chave_invalida" });
    expect(d.hashChave).toHaveBeenCalledWith("");
    expect(vi.mocked(d.ler).mock.calls[0][0]).toMatchObject({ ip: "203.0.113.5", modo: "normal" });
  });
  it("status do banco → HTTP (403, 429 + Retry-After), parâmetro inválido = 400 SEM consultar o banco", async () => {
    const a = deps({ ler: vi.fn(async () => ({ status: "loja_inativa" }) as RespostaLer) });
    expect((await tratarRequisicao(req(), a.d)).status).toBe(403);
    const b = deps({ ler: vi.fn(async () => ({ status: "limite_excedido", retry_after: 17 }) as RespostaLer) });
    const rb = await tratarRequisicao(req(), b.d);
    expect(rb.status).toBe(429);
    expect(rb.headers.get("retry-after")).toBe("17");
    expect(await corpo(rb)).toEqual({ erro: "limite_excedido" });
    const c = deps();
    expect((await tratarRequisicao(req("?limite=abc"), c.d)).status).toBe(400);
    expect(c.d.ler).not.toHaveBeenCalled();
  });
  it("teto do Workers (binding) estourado = 429 sem tocar no banco", async () => {
    const { d } = deps({ tetoIp: vi.fn(async () => false) });
    const r = await tratarRequisicao(req(), d);
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBe("60");
    expect(d.ler).not.toHaveBeenCalled();
  });
  it("erro inesperado = 500 com corpo ASCII mínimo; a chave nunca aparece", async () => {
    const { d } = deps({ ler: vi.fn(async () => { throw new Error(`boom ${CHAVE} relation "x" does not exist`); }) });
    const r = await tratarRequisicao(req(), d);
    expect(r.status).toBe(500);
    const t = await r.text();
    expect(t).toBe('{"erro":"erro_interno"}');
    expect(t).not.toContain(CHAVE);
  });
});

describe("rota — 2 fases (R7): ler → fotos → confirmar → só os confirmados", () => {
  it("normal: foto de outra loja descartada, inexistente = null, contagens vão ao confirmar; só m1 sai", async () => {
    const { d } = deps();
    const r = await tratarRequisicao(req("?limite=50"), d);
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(vi.mocked(d.assinarFotos).mock.calls[0]).toEqual([[`${T}/fotos_modelo/a.jpg`, `${T}/fotos_modelo/sumiu.jpg`], 7 * 86400]);
    expect(vi.mocked(d.confirmar).mock.calls[0]).toEqual(["k1", "ac1", {
      produtos: [{ modelo_id: "m1", assinatura: "s1" }, { modelo_id: "m2", assinatura: "s2" }], fotos_descartadas: 1, fotos_ausentes: 1 }]);
    const j = await corpo(r);
    expect(j).toMatchObject({ versao: 1, modo: "normal", loja: { id: T, nome: "Loja X" }, colunas: ["Nome", "Foto"],
      gerado_em: "2026-09-26T20:48:00.000Z", pagina: { limite: 50, maximo: 50 }, proximo_cursor: null }); // D39
    expect(j.linhas.map((l: any) => l.produto_id)).toEqual(["m1", "m1"]);
    expect(j.linhas[0].valores[1]).toEqual([`https://s/${T}/fotos_modelo/a.jpg?t=1`, null, null]);
    expect(j.linhas[0].integrado_em).toBe("2026-09-26T17:35:00.000Z");
    expect(j.linhas[1].valores[1]).toEqual([]);
    expect(d.depois).toHaveBeenCalledTimes(1);
  });
  it("teste: nunca confirma; foto = endereço público de exemplo", async () => {
    const T2: RespostaLer = { ...OK, modo: "teste", produtos: [{ modelo_id: "exemplo-0001", estado: "teste", assinatura: null, integrado_em: null,
      linhas: [{ tipo: "produto", valores: ["Produto Exemplo 1", ["exemplo"]] }] }] };
    const { d } = deps({ ler: vi.fn(async () => T2) });
    const j = await corpo(await tratarRequisicao(req("?modo=teste"), d));
    expect(d.confirmar).not.toHaveBeenCalled();
    expect(d.assinarFotos).not.toHaveBeenCalled();
    expect(j.modo).toBe("teste");
    expect(j.linhas[0].valores[1]).toEqual(["https://site/integracao/exemplo-produto.svg"]);
  });
  it("confirmar diz chave inválida (revogada no meio) = 401 e nada sai", async () => {
    const { d } = deps({ confirmar: vi.fn(async () => ({ status: "chave_invalida", confirmados: [] })) });
    const r = await tratarRequisicao(req(), d);
    expect(r.status).toBe(401);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres
npx vitest run --no-file-parallelism tests/unit/integracao-api.test.ts
```
Expected: FAIL — `Failed to resolve import "@/lib/integracao/api/parametros"`.

- [ ] **Step 3: `src/lib/integracao/api/parametros.ts`**

```ts
// Integração — API: parâmetros da consulta (spec §7). Inválido ⇒ null ⇒ 400 SEM tocar no banco. O teto real do `limite` é
// o max_por_pagina da loja (o banco aplica least()); aqui só formato. Cursor = base64 (D21), até 200 caracteres.
export type Parametros = { modo: "normal" | "teste"; incluir: boolean; limite: number | null; cursor: string | null };

export function lerParametros(url: URL): Parametros | null {
  const sp = url.searchParams;
  const modo = sp.get("modo") ?? "normal";
  if (modo !== "normal" && modo !== "teste") return null;
  const inc = sp.get("incluir_integrados") ?? "0";
  if (!["0", "1", "false", "true"].includes(inc)) return null;
  const lim = sp.get("limite");
  let limite: number | null = null;
  if (lim !== null && lim !== "") {
    if (!/^\d{1,3}$/.test(lim) || Number(lim) < 1) return null;
    limite = Number(lim);
  }
  const cur = sp.get("cursor");
  if (cur !== null && cur !== "" && (cur.length > 200 || !/^[A-Za-z0-9+/=_-]+$/.test(cur))) return null;
  return { modo, incluir: inc === "1" || inc === "true", limite, cursor: cur ? cur : null };
}
```

- [ ] **Step 4: `src/lib/integracao/api/rota.ts`**

```ts
// Integração — API `GET /api/integracao/v1/produtos` (spec §7, R7). Handler PURO com dependências injetadas (a rota real
// injeta Supabase service role + Workers — Task 20). Fluxo: teto por IP (binding) → chave (Bearer; ausente = hash de vazio,
// que registra a tentativa) → parâmetros → _integracao_ler (fase 1) → fotos: prefixo da loja (inv. #2) + links assinados
// (validade_foto_dias) → _integracao_confirmar (fase 2) → responde SÓ os confirmados → limpeza de 90 dias FORA do caminho
// (n4/D20). Erros: corpo ASCII mínimo; nunca a chave, nunca texto interno (nem em 500).
import { lerParametros } from "./parametros";
import { CAMINHO_FOTO_EXEMPLO, caminhosFoto, montarResposta, type RespostaLer } from "./resposta";

export type Confirmacao = { status: string; confirmados: { modelo_id: string; integrado_em: string }[] };
export type DepsRota = {
  hashChave: (chave: string) => Promise<string>;
  ler: (a: { hash: string; incluir: boolean; cursor: string | null; limite: number | null; modo: "normal" | "teste"; ip: string }) => Promise<RespostaLer>;
  assinarFotos: (caminhos: string[], validadeSegundos: number) => Promise<Map<string, string | null>>;
  confirmar: (chaveId: string, acessoId: string, entrega: { produtos: { modelo_id: string; assinatura: string | null }[]; fotos_descartadas: number; fotos_ausentes: number }) => Promise<Confirmacao>;
  limpar: (tenantId: string | null) => Promise<void>;
  depois: (p: Promise<unknown>) => void;
  tetoIp: (ip: string) => Promise<boolean>;
  agora: () => Date;
  origem: string;
};
export const CABECALHOS_JSON = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } as const;

export function respostaErro(status: number, erro: string, retryAfter?: number | null): Response {
  const h: Record<string, string> = { ...CABECALHOS_JSON };
  if (retryAfter != null) h["retry-after"] = String(Math.max(1, Math.ceil(retryAfter)));
  return new Response(JSON.stringify({ erro }), { status, headers: h });
}
const HTTP: Record<string, number> = {
  parametro_invalido: 400, chave_invalida: 401, loja_inativa: 403, ip_bloqueado: 429, limite_excedido: 429,
};

export async function tratarRequisicao(req: Request, deps: DepsRota): Promise<Response> {
  try {
    const ip = (req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0] ?? "desconhecido").trim().slice(0, 64);
    if (!(await deps.tetoIp(ip))) return respostaErro(429, "limite_excedido", 60);
    const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "");
    const chave = m ? m[1] : "";
    const p = lerParametros(new URL(req.url));
    if (!p) return respostaErro(400, "parametro_invalido");
    const r = await deps.ler({ hash: await deps.hashChave(chave), incluir: p.incluir, cursor: p.cursor, limite: p.limite, modo: p.modo, ip });
    if (r.status !== "ok") {
      deps.depois(deps.limpar(r.tenant_id ?? null));
      return respostaErro(HTTP[r.status] ?? 500, HTTP[r.status] ? r.status : "erro_interno", r.retry_after ?? null);
    }
    const geradoEm = deps.agora().toISOString();
    if (r.modo === "teste") {
      const corpo = montarResposta(r, { geradoEm, foto: (c) => c.map(() => `${deps.origem}${CAMINHO_FOTO_EXEMPLO}`) });
      deps.depois(deps.limpar(r.tenant_id ?? null));
      return new Response(JSON.stringify(corpo), { status: 200, headers: CABECALHOS_JSON });
    }
    // Fase 1½ — fotos: só caminhos da PRÓPRIA loja (inv. #2); o resto é descartado e contado.
    const idxFoto = (r.chaves_colunas ?? []).indexOf("foto");
    const prefixo = `${r.tenant_id}/`;
    let descartadas = 0;
    const validos: string[] = [];
    if (idxFoto >= 0) {
      for (const pr of r.produtos ?? []) {
        for (const l of pr.linhas) {
          if (l.tipo !== "produto") continue;
          for (const c of caminhosFoto(l.valores, idxFoto)) {
            if (c.startsWith(prefixo)) validos.push(c);
            else descartadas += 1;
          }
        }
      }
    }
    const unicos = [...new Set(validos)];
    const links = unicos.length > 0 ? await deps.assinarFotos(unicos, (r.validade_foto_dias ?? 7) * 86400) : new Map<string, string | null>();
    const ausentes = unicos.filter((c) => !links.get(c)).length;
    // Fase 2 — confirmar: marca integrado SÓ o que ainda está integrável com a MESMA assinatura.
    const conf = await deps.confirmar(r.chave_id ?? "", r.acesso_id ?? "", {
      produtos: (r.produtos ?? []).map((pr) => ({ modelo_id: pr.modelo_id, assinatura: pr.assinatura })),
      fotos_descartadas: descartadas, fotos_ausentes: ausentes,
    });
    if (conf.status !== "ok") return respostaErro(HTTP[conf.status] ?? 500, HTTP[conf.status] ? conf.status : "erro_interno");
    const ok = new Map(conf.confirmados.map((c) => [c.modelo_id, c.integrado_em]));
    const corpo = montarResposta(r, {
      geradoEm,
      foto: (c) => c.map((x) => (x.startsWith(prefixo) ? (links.get(x) ?? null) : null)),
      incluir: (id) => ok.has(id),
      integradoEm: (id) => ok.get(id) ?? null,
    });
    deps.depois(deps.limpar(r.tenant_id ?? null));
    return new Response(JSON.stringify(corpo), { status: 200, headers: CABECALHOS_JSON });
  } catch {
    return respostaErro(500, "erro_interno");
  }
}
```

- [ ] **Step 5: Rodar (PASS), gates e commit**

```bash
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres
npx vitest run --no-file-parallelism tests/unit/integracao-api.test.ts
bash .superpowers/integracao/gates.sh
git add -- src/lib/integracao/api/parametros.ts src/lib/integracao/api/rota.ts tests/unit/integracao-api.test.ts
git commit --only -m "feat(integracao): handler puro da API — parâmetros, 2 fases, fotos com prefixo da loja e códigos HTTP ASCII

Co-Authored-By: Claude <modelo real> <noreply@anthropic.com>" -- src/lib/integracao/api/parametros.ts src/lib/integracao/api/rota.ts \
  tests/unit/integracao-api.test.ts
git show --stat HEAD | tail -n +7
```
Expected: PASS (parâmetros 1 · rota 4 · 2 fases 3 = 8); `GATES INTEGRACAO: ok`. Revisão individual (Opus + `code-reviewer`):
nada do banco além das 3 funções; nenhuma resposta ecoa a chave; a ordem ler → fotos → confirmar.

---

### Task 20: Rota real no Worker (service role + teto por IP) e a foto pública de exemplo

**Files:**
- Create: `src/lib/integracao/api/rota.server.ts`, `src/routes/api.integracao.v1.produtos.ts`,
  `public/integracao/exemplo-produto.svg`
- Modify: `wrangler.jsonc` (binding `ratelimits` `INTEGRACAO_TETO_IP` 600/60 s, produção e staging)
- Modify: `src/routeTree.gen.ts` (regerado — `ROTA_NOVA=1`)
- Test: bloco novo em `tests/unit/integracao-tela-fonte.test.ts`

**Interfaces:**
- Consumes: Task 19 (`tratarRequisicao`, `DepsRota`, `Confirmacao`); `supabaseAdmin` (`src/integrations/supabase/client.server.ts`,
  import SÓ dentro de `.server.ts` ou dinâmico no handler); RPCs `_integracao_ler/_confirmar/_limpar` (só `service_role`);
  storage `modelos.createSignedUrls`.
- Produces: `tratarGet(request): Promise<Response>`; rota `GET /api/integracao/v1/produtos`; binding `INTEGRACAO_TETO_IP`
  (ausente — dev local, `:5188` — = sem teto, D23).

- [ ] **Step 1: Escrever o teste (falha)**

Acrescentar ao FIM de `tests/unit/integracao-tela-fonte.test.ts`:

```ts
describe("Integração — rota real da API (F3)", () => {
  it("a rota só faz import DINÂMICO do servidor (o bundle do navegador não leva o service role — D30)", () => {
    const r = ler("src/routes/api.integracao.v1.produtos.ts");
    expect(r).toMatch(/createFileRoute\("\/api\/integracao\/v1\/produtos"\)/);
    expect(r).toMatch(/await import\("@\/lib\/integracao\/api\/rota\.server"\)/);
    expect(r).not.toMatch(/^import .*client\.server/m);
  });
  it("o servidor chama SÓ as 3 funções da rota e o storage de fotos", () => {
    const s = ler("src/lib/integracao/api/rota.server.ts");
    const rpcs = [...s.matchAll(/rpc\("([a-z_]+)"/g)].map((m) => m[1]).sort();
    expect(rpcs).toEqual(["_integracao_confirmar", "_integracao_ler", "_integracao_limpar"]);
    expect(s).toMatch(/storage\.from\("modelos"\)\.createSignedUrls/);
    expect(s).not.toMatch(/console\.(log|error|warn)\(.*chave/i);
  });
  it("wrangler: teto por IP 600/60 s na produção e no staging (R7)", () => {
    const w = ler("wrangler.jsonc");
    expect(w.match(/"name": "INTEGRACAO_TETO_IP"/g)?.length).toBe(2);
    expect(w.match(/"simple": \{ "limit": 600, "period": 60 \}/g)?.length).toBe(2);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres
npx vitest run --no-file-parallelism tests/unit/integracao-tela-fonte.test.ts
```
Expected: FAIL — `ENOENT … api.integracao.v1.produtos.ts`.

- [ ] **Step 3: `src/lib/integracao/api/rota.server.ts`**

```ts
// Integração — dependências REAIS da rota da API (só no servidor/Worker). Service role SÓ para as 3 funções `_integracao_*`
// (EXECUTE só de service_role — Task 6) e para assinar as fotos do bucket "modelos". O teto por IP é o binding `ratelimits`
// do Workers (INTEGRACAO_TETO_IP, 600/60 s — D23); fora do Workers (dev local, :5188) não há binding = sem teto.
// A limpeza de 90 dias roda com waitUntil quando o runtime oferece (fora do caminho da resposta — n4/D20).
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { RespostaLer } from "./resposta";
import { tratarRequisicao, type Confirmacao, type DepsRota } from "./rota";

type Workers = {
  env?: Record<string, unknown>;
  waitUntil?: (p: Promise<unknown>) => void;
};
type Teto = { limit: (o: { key: string }) => Promise<{ success: boolean }> };

async function runtimeWorkers(): Promise<Workers | null> {
  try {
    const nome = "cloudflare:workers";
    return (await import(/* @vite-ignore */ nome)) as Workers;
  } catch {
    return null;
  }
}
const hex = (b: ArrayBuffer): string => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

export async function tratarGet(request: Request): Promise<Response> {
  const cf = await runtimeWorkers();
  const teto = cf?.env?.INTEGRACAO_TETO_IP as Teto | undefined;
  const deps: DepsRota = {
    hashChave: async (chave) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(chave))),
    ler: async (a) => {
      const { data, error } = await supabaseAdmin.rpc("_integracao_ler" as any, {
        _chave_hash: a.hash, _incluir_integrados: a.incluir, _cursor: a.cursor, _limite: a.limite, _modo: a.modo, _ip: a.ip,
      });
      if (error) throw error;
      return data as RespostaLer;
    },
    assinarFotos: async (caminhos, validade) => {
      const { data, error } = await supabaseAdmin.storage.from("modelos").createSignedUrls(caminhos, validade);
      if (error) throw error;
      return new Map((data ?? []).map((d) => [d.path ?? "", d.error ? null : (d.signedUrl ?? null)]));
    },
    confirmar: async (chaveId, acessoId, entrega) => {
      const { data, error } = await supabaseAdmin.rpc("_integracao_confirmar" as any, {
        _chave_id: chaveId, _acesso_id: acessoId, _entrega: entrega,
      });
      if (error) throw error;
      return data as Confirmacao;
    },
    limpar: async (tenant) => {
      await supabaseAdmin.rpc("_integracao_limpar" as any, { _tenant: tenant });
    },
    depois: (p) => {
      const seguro = p.catch(() => undefined);
      if (typeof cf?.waitUntil === "function") cf.waitUntil(seguro);
    },
    tetoIp: async (ip) => (teto ? (await teto.limit({ key: ip })).success : true),
    agora: () => new Date(),
    origem: new URL(request.url).origin,
  };
  return tratarRequisicao(request, deps);
}
```

- [ ] **Step 4: Rota, foto de exemplo e binding**

`src/routes/api.integracao.v1.produtos.ts`:

```ts
// Integração — API pública da loja (spec §7): GET /api/integracao/v1/produtos, Authorization: Bearer <chave>. Molde:
// src/routes/sitemap[.]xml.ts. Import DINÂMICO do servidor (D30): o bundle do navegador nunca leva o service role.
import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

export const Route = createFileRoute("/api/integracao/v1/produtos")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { tratarGet } = await import("@/lib/integracao/api/rota.server");
        return tratarGet(request);
      },
    },
  },
});
```

`public/integracao/exemplo-produto.svg` (foto PÚBLICA de exemplo do modo teste — n3; nunca um link assinado):

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800" role="img" aria-label="Foto de exemplo">
  <rect width="600" height="800" fill="#eef1f6"/>
  <rect x="150" y="160" width="300" height="420" rx="24" fill="#c9d3e3"/>
  <text x="300" y="660" font-family="Arial, sans-serif" font-size="36" text-anchor="middle" fill="#3b4a63">Produto Exemplo</text>
  <text x="300" y="705" font-family="Arial, sans-serif" font-size="22" text-anchor="middle" fill="#5b6b85">foto fictícia — modo teste</text>
</svg>
```

`wrangler.jsonc` — trocar o arquivo inteiro por:

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "sistrama",
  "compatibility_date": "2025-09-02",
  "compatibility_flags": ["nodejs_compat"],
  "main": "@tanstack/react-start/server-entry",
  // Integração + API (R7/D23): TETO fixo por IP da rota /api/integracao/v1/produtos (proteção do Worker; o limite por
  // CHAVE e o bloqueio por chave errada são do banco e configuráveis na tela). Não é herdado por env.staging.
  "ratelimits": [
    { "name": "INTEGRACAO_TETO_IP", "namespace_id": "7301", "simple": { "limit": 600, "period": 60 } }
  ],
  "env": {
    "staging": {
      "name": "sistrama-staging",
      "ratelimits": [
        { "name": "INTEGRACAO_TETO_IP", "namespace_id": "7302", "simple": { "limit": 600, "period": 60 } }
      ]
    }
  }
}
```

- [ ] **Step 5: Validar o wrangler SEM publicar e rodar os testes**

```bash
npm run build > .superpowers/integracao/logs/build-t20.log 2>&1 || tail -20 .superpowers/integracao/logs/build-t20.log
npx wrangler deploy --dry-run 2>&1 | tee .superpowers/integracao/logs/wrangler-dry.log | tail -20
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres
npx vitest run --no-file-parallelism tests/unit/integracao-tela-fonte.test.ts tests/unit/integracao-api.test.ts
```
Expected: o build do plugin do Cloudflare gera a config de saída e o `wrangler deploy --dry-run` (NENHUM upload, sem login) lista
o binding `INTEGRACAO_TETO_IP` (Rate Limit) sem erro de schema. Se o wrangler recusar a chave `ratelimits` ⇒ PARE e chame o
controlador (não inventar outro formato). Se o dry-run falhar por OUTRO motivo (ex.: pede login) ⇒ registrar em `desvios.md`
e seguir — o teste da tela-fonte confere o formato e o G-deploy confere o binding no painel do Cloudflare depois do deploy.
Testes: PASS (tela-fonte 16 · api 8).

- [ ] **Step 6: Gates com o routeTree novo e commit**

```bash
ROTA_NOVA=1 bash .superpowers/integracao/gates.sh
git diff --stat -- src/routeTree.gen.ts            # só a rota /api/integracao/v1/produtos entra
git add -- src/lib/integracao/api/rota.server.ts src/routes/api.integracao.v1.produtos.ts public/integracao/exemplo-produto.svg \
  wrangler.jsonc src/routeTree.gen.ts tests/unit/integracao-tela-fonte.test.ts
git commit --only -m "feat(integracao): rota GET /api/integracao/v1/produtos no Worker (service role só nas 3 funções) + teto por IP

Co-Authored-By: Claude <modelo real> <noreply@anthropic.com>" -- src/lib/integracao/api/rota.server.ts \
  src/routes/api.integracao.v1.produtos.ts public/integracao/exemplo-produto.svg wrangler.jsonc src/routeTree.gen.ts \
  tests/unit/integracao-tela-fonte.test.ts
git show --stat HEAD | tail -n +7
```
Expected: `GATES INTEGRACAO: ok`. Revisão individual (Opus + `code-reviewer` + ficha `security-auditor` no prompt):
service role só nas 3 funções; 5xx sem texto interno; chave nunca logada. O teste de ponta a ponta da rota REAL contra a
CÓPIA é da Task 20b (`:5199`, antes do RODAR); a Task 25 repete o essencial no `:5188` depois do merge.

---

### Task 20b: Rota REAL contra a CÓPIA (`:5199`) e CPU da rota — ANTES do RODAR *(Step 1 executor; Steps 2–5 controlador)*

**Files:**
- Create: `tests/carga/integracao-api-carga.test.ts` (versionado — medição sintética, R4/D38; FORA de `tests/unit`, então
  NÃO roda no `gates.sh` de todo commit e não tem limiar de tempo — R10 do r2)
- Create (NÃO versionar): `.superpowers/integracao/vite.config.copia-5199.mjs`, `.superpowers/integracao/rota-real.sh`,
  `tests/e2e/integracao-rota-real.spec.ts` (em `permitidos.txt` só para o `gates.sh` não barrar)

**Interfaces:**
- Consumes: Task 19 (`tratarRequisicao`, `DepsRota`), Task 16 (`RespostaLer`), Task 20 (rota + `rota.server.ts`), Task 8
  (`copia.sh ida|volta`, `n3.sh`), Tasks 13/15 (textos da tela: integrar, Nova chave, Revogar — os MESMOS da QA da Task 25);
  `banco-local/app-teste/{vite.config.local-copia.mjs,wrangler.jsonc,.env.local-copia,.dev.vars}` (LIDOS pelo vite; ninguém abre
  `.env.local-copia`/`.dev.vars`).
- Produces: `[carga-api]` p50/p95 com 50/100/200/500 produtos (confere a P-89 A — D38); ensaio verde da rota real (401 sem chave/errada,
  400, teste 200 sem integrar, normal 200 → `integrado` no banco, relê só com `incluir_integrados=1`, revogada 401); anotação
  em `copia-estado.md`. Defeito ⇒ o RODAR NÃO vai ao dono: defeito no SQL reabre o G-migration (Task 7); defeito no TS = commit
  novo na worktree + revisão individual; depois repete esta task.

- [ ] **Step 1: CPU da rota por tamanho de página (R4/R4-r2) — medição, não é TDD; só IMPRIME (R10)**

`tests/carga/integracao-api-carga.test.ts` (pasta nova, fora de `tests/unit` — o `vitest.config.ts` inclui `tests/**/*.test.ts`,
então roda pelo caminho literal; o `gates.sh` só roda `tests/unit`):

```ts
// Integração — R4/D38: CPU do código da rota (sem I/O de verdade) por tamanho de página. Sintético: a loja real não tem 500
// integráveis. Mede, por requisição: JSON.parse do retorno do banco (o que o supabase-js faz no Worker) + JSON.parse dos links
// assinados + tratarRequisicao (fotos, confirmar, montarResposta, JSON.stringify) + leitura do corpo. SÓ IMPRIME p50/p95 —
// nenhum limiar de tempo aqui (R10 do r2: tempo varia com a máquina). A régua é a da D38, lida pelo controlador. Fora de
// tests/unit de propósito: não roda no gate de todo commit.
import { describe, it, expect } from "vitest";
import { tratarRequisicao, type DepsRota } from "@/lib/integracao/api/rota";
import type { RespostaLer } from "@/lib/integracao/api/resposta";

const T = "11111111-1111-4111-8111-111111111111";
const COLS = 18; // todas as colunas do catálogo marcadas; a última é a Foto
const VARIANTES = 6; // + 1 linha de produto = 7 linhas por produto

function pagina(n: number): { banco: string; assinadas: string } {
  const chaves = Array.from({ length: COLS }, (_, i) => (i === COLS - 1 ? "foto" : `c${i}`));
  const fotos: string[] = [];
  const produtos = Array.from({ length: n }, (_, p) => {
    const f = [0, 1, 2].map((k) => `${T}/fotos_modelo/${p}-${k}.jpg`);
    fotos.push(...f);
    return {
      modelo_id: `m${p}`, estado: "integravel", assinatura: `s${p}`.padEnd(64, "0"), integrado_em: null,
      linhas: [
        { tipo: "produto", loja_nome: "Loja X",
          valores: [...Array.from({ length: COLS - 1 }, (_, i) => `Produto ${p} — campo ${i} com um texto de tamanho médio`), f] },
        ...Array.from({ length: VARIANTES }, (_, v) => ({ tipo: "variante", loja_nome: "Loja X",
          valores: [...Array.from({ length: COLS - 1 }, (_, i) => `Variante ${p}.${v} — campo ${i}`), []] })),
      ],
    };
  });
  const banco = JSON.stringify({
    status: "ok", modo: "normal", acesso_id: "ac", chave_id: "k", tenant_id: T, loja: { id: T, nome: "Loja X" },
    colunas: chaves.map((c) => c.toUpperCase()), chaves_colunas: chaves, proximo_cursor: null, validade_foto_dias: 7, produtos,
  });
  const assinadas = JSON.stringify(fotos.map((c) => ({
    path: c, error: null, signedUrl: `https://x.supabase.co/storage/v1/object/sign/modelos/${c}?token=${"t".repeat(180)}`,
  })));
  return { banco, assinadas };
}

function deps({ banco, assinadas }: { banco: string; assinadas: string }): DepsRota {
  return {
    hashChave: async () => "h",
    ler: async () => JSON.parse(banco) as RespostaLer,
    assinarFotos: async () => {
      const a = JSON.parse(assinadas) as { path: string; signedUrl: string | null; error: string | null }[];
      return new Map(a.map((d) => [d.path, d.error ? null : d.signedUrl]));
    },
    confirmar: async (_k, _a, e) => ({
      status: "ok", confirmados: e.produtos.map((p) => ({ modelo_id: p.modelo_id, integrado_em: "2026-09-27T12:00:00.000Z" })),
    }),
    limpar: async () => undefined,
    depois: () => undefined,
    tetoIp: async () => true,
    agora: () => new Date("2026-09-27T12:00:00.000Z"),
    origem: "https://site",
  };
}

async function medir(n: number) {
  const d = deps(pagina(n));
  const req = () => new Request("https://site/api/integracao/v1/produtos?limite=500", {
    headers: { authorization: "Bearer wish_live_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345", "cf-connecting-ip": "203.0.113.5" },
  });
  for (let i = 0; i < 3; i++) await (await tratarRequisicao(req(), d)).text(); // aquecimento (JIT)
  const ms: number[] = [];
  let bytes = 0;
  let linhas = 0;
  for (let i = 0; i < 20; i++) {
    const t0 = performance.now();
    const r = await tratarRequisicao(req(), d);
    const corpo = await r.text();
    ms.push(performance.now() - t0);
    expect(r.status).toBe(200);
    bytes = corpo.length;
    linhas = (JSON.parse(corpo) as { linhas: unknown[] }).linhas.length;
  }
  ms.sort((a, b) => a - b);
  const p50 = ms[9];
  const p95 = ms[18];
  console.log(`[carga-api] ${n} produtos (${linhas} linhas, ${Math.round(bytes / 1024)} KB): p50 ${p50.toFixed(2)} ms · p95 ${p95.toFixed(2)} ms`);
  return { p50, p95, linhas };
}

describe("Integração — CPU da rota por tamanho de página (R4/D38; só imprime)", () => {
  // 50 = PADRÃO (P-89 A); 100 = acima disso a tela avisa do plano gratuito; 200/500 = só com Workers Paid (registro).
  for (const n of [50, 100, 200, 500]) {
    it(`${n} produtos`, async () => {
      const r = await medir(n);
      expect(r.linhas).toBe(n * (VARIANTES + 1)); // correção da montagem — tempo NÃO é conferido aqui (R10)
    });
  }
});
```

```bash
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres
npx vitest run --no-file-parallelism tests/carga/integracao-api-carga.test.ts 2>&1 | tee .superpowers/integracao/logs/carga-api.log | grep -E "carga-api|passed|failed"
bash .superpowers/integracao/gates.sh
git add -- tests/carga/integracao-api-carga.test.ts
git commit --only -m "test(integracao): medição de CPU da rota com 50/100/200/500 produtos por página (R4/D38; fora do gate)

Co-Authored-By: Claude <modelo real> <noreply@anthropic.com>" -- tests/carga/integracao-api-carga.test.ts
git show --stat HEAD | tail -n +7
```
Expected: PASS (carga 4) com as 4 linhas `[carga-api] …` no log; o executor COPIA as 4 linhas no relatório. O p95 NÃO
reprova nada aqui (R10). **D38 — RESOLVIDA pela P-89 A** (padrão/recomendado 50; alerta na tela acima de 100; faixa do
banco 1–500). Leitura do controlador: p95 de 50 e de 100 ≤ 7 ms ⇒ segue (é o esperado — o guardião mediu ~4,5 ms com 50).
Se o p95 de 50 ou de 100 passar de 7 ms, avisar o dono no painel ANTES do RODAR (o próximo passo seria baixar o padrão ou o
alerta, ou Workers Paid). 200/500 ficam só como registro (só valem com Workers Paid). A máquina local costuma ser MAIS rápida
que o Worker — por isso 7 ms (70 % dos 10 ms do plano gratuito); quem confirma é a medição REAL no G-deploy (Task 25 Step 6).

- [ ] **Step 2: Vite PRÓPRIO da worktree na `:5199` (config não versionada, derivada da do app-teste)**

Gerar `.superpowers/integracao/vite.config.copia-5199.mjs` a partir do arquivo do app-teste, trocando SÓ 5 linhas (cada âncora
tem de casar exatamente 1 vez — a guarda anti-produção, o `.env.local-copia`, o `.dev.vars` e o `wrangler.jsonc` do app-teste
ficam os MESMOS; ninguém abre esses arquivos):

```bash
python3 - <<'PY'
import pathlib
src = pathlib.Path("/Users/sunglee/PLM + Criação/banco-local/app-teste/vite.config.local-copia.mjs").read_text()
trocas = [
    ('import base from "../../plm-pcp/vite.config.ts";', 'import base from "../../vite.config.ts";'),
    ('const REPO = nativo("/Users/sunglee/PLM + Criação/plm-pcp");',
     'const REPO = nativo("/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/integracao-impl");\n'
     'const MODS = nativo(path.join(REPO, "node_modules")); // symlink -> node_modules do checkout principal (Task 0)'),
    ('const PORTA = 5188;', 'const PORTA = 5199;'),
    ('cacheDir: path.join(REPO, "node_modules/.vite-local-copia"),', 'cacheDir: path.join(MODS, ".vite-integracao-5199"),'),
    ('server: { ...(base.server ?? {}), port: PORTA, strictPort: true },',
     'server: { ...(base.server ?? {}), port: PORTA, strictPort: true, fs: { ...(base.server?.fs ?? {}), allow: [REPO, MODS] } },'),
]
for a, b in trocas:
    assert src.count(a) == 1, f"âncora não bate (1x): {a}"
    src = src.replace(a, b)
cab = ("// [integracao Task 20b] derivado de banco-local/app-teste/vite.config.local-copia.mjs: serve a WORKTREE integracao-impl\n"
       "// na :5199 contra a CÓPIA (R3). NÃO versionado. Sem o binding INTEGRACAO_TETO_IP (wrangler do app-teste) = sem teto (D23).\n")
pathlib.Path(".superpowers/integracao/vite.config.copia-5199.mjs").write_text(cab + src)
print("ok: vite.config.copia-5199.mjs")
PY
grep -c "guarda-copia-local" .superpowers/integracao/vite.config.copia-5199.mjs      # ≥ 2 (a guarda veio junto)
```

`.superpowers/integracao/rota-real.sh`:

```bash
#!/usr/bin/env bash
# Task 20b (R3) — vite PRÓPRIO da worktree integracao-impl na :5199 contra a CÓPIA (Supabase local). NUNCA sobe/derruba
# :5173/:5188. O "descer" derruba SÓ o PID gravado em vite-5199.pid (e os filhos workerd DELE), conferindo o comando antes.
# Uso (de dentro da worktree, com a frente JÁ na cópia — copia.sh ida): bash .superpowers/integracao/rota-real.sh subir|descer
set -uo pipefail
TOP="$(git rev-parse --show-toplevel)" || exit 1
case "$TOP" in */.claude/worktrees/integracao-impl) ;; *) echo "PARE: rode de dentro da worktree integracao-impl"; exit 1;; esac
cd "$TOP"
S=.superpowers/integracao; CFG="$S/vite.config.copia-5199.mjs"; PIDF="$S/vite-5199.pid"; LOG="$S/logs/vite-5199.log"
LOCAL=postgresql://postgres:postgres@127.0.0.1:54422/postgres
case "${1:-}" in
subir)
  if [ -f "$PIDF" ] && kill -0 "$(cat "$PIDF")" 2>/dev/null; then echo "já rodando (PID $(cat "$PIDF")) -> http://localhost:5199"; exit 0; fi
  if lsof -nP -iTCP:5199 -sTCP:LISTEN >/dev/null 2>&1; then
    echo "PARE: a :5199 está ocupada por OUTRO processo (não derrubar):"; lsof -nP -iTCP:5199 -sTCP:LISTEN; exit 1
  fi
  curl -fsS -o /dev/null --max-time 5 http://127.0.0.1:54321/auth/v1/health || { echo "PARE: Supabase local (:54321) fora do ar"; exit 1; }
  t=$(PGOPTIONS='-c default_transaction_read_only=on' psql "$LOCAL" -X -At -c "SELECT to_regclass('public.integracao_produtos') IS NOT NULL")
  [ "$t" = t ] || { echo "PARE: a frente não está na cópia — antes: INTEG_DONO_AVISADO=sim bash $S/copia.sh ida"; exit 1; }
  nohup ./node_modules/.bin/vite dev --config "$CFG" --mode local-copia --port 5199 --strictPort > "$LOG" 2>&1 < /dev/null &
  PID=$!; echo "$PID" > "$PIDF"
  for _ in $(seq 1 90); do
    if curl -fsS -o /dev/null --max-time 2 http://localhost:5199/; then
      echo "OK: :5199 (PID $PID; log $LOG)"; grep -m1 "guarda-copia-local" "$LOG"; exit 0
    fi
    kill -0 "$PID" 2>/dev/null || { echo "PARE: o vite morreu ao subir:"; tail -30 "$LOG"; rm -f "$PIDF"; exit 1; }
    sleep 1
  done
  echo "PARE: a :5199 não respondeu em 90 s (PID $PID) — rode 'descer' e chame o controlador"; exit 1 ;;
descer)
  [ -f "$PIDF" ] || { echo "sem $PIDF — nada a derrubar"; exit 0; }
  PID="$(cat "$PIDF")"
  kill -0 "$PID" 2>/dev/null || { echo "PID $PID já não existe"; rm -f "$PIDF"; exit 0; }
  CMD="$(ps -p "$PID" -o command= || true)"
  case "$CMD" in *vite.config.copia-5199.mjs*) ;; *) echo "RECUSADO: o PID $PID não é o vite da :5199: $CMD"; exit 1;; esac
  FILHOS=$(pgrep -P "$PID" || true)                      # workerd do @cloudflare/vite-plugin
  kill "$PID"
  for _ in $(seq 1 15); do kill -0 "$PID" 2>/dev/null || break; sleep 1; done
  if kill -0 "$PID" 2>/dev/null; then kill -9 "$PID"; fi
  for F in $FILHOS; do kill -0 "$F" 2>/dev/null && kill "$F" 2>/dev/null; done
  rm -f "$PIDF"
  git status --short -- src/routeTree.gen.ts            # vazio (o plugin do router regera IGUAL ao commitado)
  echo "== :5199 derrubado (PID $PID)" ;;
*) echo "uso: rota-real.sh subir|descer"; exit 2 ;;
esac
```

- [ ] **Step 3: Spec do ensaio — `tests/e2e/integracao-rota-real.spec.ts` (NÃO versionar)**

```ts
import { test, expect } from "@playwright/test";
import { Client } from "pg";
import { doLogin } from "./_helpers";
// Task 20b (R3) — a rota REAL da API servida pela WORKTREE (:5199) contra a CÓPIA, ANTES do RODAR. NÃO versionar.
// Banco: SÓ LEITURA (default_transaction_read_only), sempre a cópia :54422 (nunca tests/integration/db.ts). NUNCA selectStore.
// A chave de teste só vive na memória deste teste (não vai a arquivo nem a log).
const ID = process.env.E2E_INTEG_ID ?? "";
const NOME = process.env.E2E_INTEG_NOME ?? "";
const COPIA = "postgresql://postgres:postgres@127.0.0.1:54422/postgres";
test.skip(!process.env.E2E_BASE_URL?.includes("localhost:5199") || !ID || !NOME, "só na :5199 (worktree + cópia) e com o produto combinado");

async function sql<T = Record<string, unknown>>(q: string, p: unknown[] = []): Promise<T[]> {
  const c = new Client({ connectionString: COPIA, options: "-c default_transaction_read_only=on" });
  await c.connect();
  try { return (await c.query(q, p)).rows as T[]; } finally { await c.end(); }
}
const estado = async () =>
  (await sql<{ estado: string }>(`SELECT estado FROM public.integracao_produtos WHERE modelo_id = $1`, [ID]))[0]?.estado ?? "nao_integravel";
const tem = (j: { linhas: { produto_id: string }[] }) => j.linhas.some((l) => l.produto_id === ID);

test("rota real: 401/400, teste sem integrar, normal → integrado, relê só com incluir_integrados, revogada 401", async ({ page, request }) => {
  test.setTimeout(180_000);
  const [cfg] = await sql<{ ok: boolean }>(`SELECT coalesce(min(bloqueio_tentativas), 10) >= 4 AS ok FROM public.integracao_config`);
  expect(cfg.ok, "alguma loja da cópia bloqueia IP com < 4 tentativas — os 3 casos de chave errada virariam 429").toBe(true);
  expect(await estado()).toBe("nao_integravel");
  await doLogin(page);
  // 1) produto integrável pela tela (texto do dono + resumo)
  await page.goto("/integracao");
  await page.getByLabel("Buscar").fill(NOME);
  await page.getByRole("switch", { name: `Integrável: ${NOME}` }).click();
  await page.getByRole("button", { name: "Tenho certeza — integrar" }).click();
  await expect(page.getByText("1 produto integrável.")).toBeVisible({ timeout: 15000 });
  expect(await estado()).toBe("integravel");
  // 2) chave de teste (mostrada 1×)
  await page.getByRole("tab", { name: "API" }).click();
  await page.getByRole("button", { name: "Nova chave" }).click();
  await page.getByLabel("Nome da chave").fill("Ensaio rota real");
  await page.getByRole("button", { name: "Criar" }).click();
  const chave = await page.getByLabel("Chave gerada").inputValue();
  await page.getByRole("button", { name: "Concluído" }).click();
  const url = "/api/integracao/v1/produtos";
  const auth = { authorization: `Bearer ${chave}` };
  // 3) erros: corpo ASCII mínimo, nunca a chave
  const sem = await request.get(url);
  expect(sem.status()).toBe(401);
  expect(await sem.text()).toBe('{"erro":"chave_invalida"}');
  expect((await request.get(url, { headers: { authorization: "Bearer wish_live_errada" } })).status()).toBe(401);
  const lim = await request.get(`${url}?limite=0`, { headers: auth });
  expect(lim.status()).toBe(400);
  expect(await lim.text()).toBe('{"erro":"parametro_invalido"}');
  // 4) modo teste: exemplos fictícios, nada integra
  const t = await request.get(`${url}?modo=teste&limite=2`, { headers: auth });
  expect(t.status()).toBe(200);
  const jt = await t.json();
  expect([jt.modo, jt.linhas[0].produto_id]).toEqual(["teste", "exemplo-0001"]);
  expect(await estado()).toBe("integravel");
  // 5) normal: o produto sai e vira integrado; o acesso fica no log
  const t0 = Date.now();
  const n = await request.get(`${url}?limite=500`, { headers: auth });
  const parede = Date.now() - t0;
  expect(n.status()).toBe(200);
  expect(n.headers()["cache-control"]).toBe("no-store");
  const jn = await n.json();
  expect(tem(jn)).toBe(true);
  expect(jn.pagina.limite).toBe(jn.pagina.maximo); // D39: pedido 500, cortado no máximo da loja (padrão 50 — P-89 A)
  console.log(`[rota-real] página normal: ${jn.linhas.length} linhas em ${parede} ms de parede (dev local — referência, não é o CPU do Worker)`);
  expect(await estado()).toBe("integrado");
  const [ac] = await sql<{ n: number }>(
    `SELECT count(*)::int AS n FROM public.integracao_acessos WHERE status = 'ok' AND criado_em > now() - interval '15 minutes'`);
  expect(ac.n).toBeGreaterThan(0);
  const foto = (jn.linhas as { valores: unknown[] }[]).flatMap((l) => l.valores).flat()
    .find((v): v is string => typeof v === "string" && /^https?:\/\/.+\/storage\/v1\/object\/sign\//.test(v));
  if (foto) expect((await request.get(foto)).status(), "o link assinado da foto abre").toBe(200);
  // 6) sem incluir_integrados o integrado NÃO volta; com =1 relê
  expect(tem(await (await request.get(`${url}?limite=500`, { headers: auth })).json())).toBe(false);
  expect(tem(await (await request.get(`${url}?limite=500&incluir_integrados=1`, { headers: auth })).json())).toBe(true);
  // 7) revogada = 401
  await page.getByRole("row", { name: /Ensaio rota real/ }).getByRole("button", { name: "Revogar" }).click();
  await page.getByRole("button", { name: "Revogar chave" }).click();
  await expect(page.getByText("Chave revogada.")).toBeVisible();
  expect((await request.get(url, { headers: auth })).status()).toBe(401);
});
```

- [ ] **Step 4: Ensaio (controlador) — cópia com a frente, `:5199`, produto combinado, spec**

1. Painel: aviso N3 ("Vou aplicar a Integração na CÓPIA e subir um vite próprio na :5199 para ensaiar a API de verdade; :5173 e
   :5188 não são tocados") + setup P-51 A ("vou completar na CÓPIA, só na Loja Teste, os campos do produto <nome> pela tela da
   :5199"). Esperar o OK.
2. Na worktree:
   ```bash
   INTEG_DONO_AVISADO=sim bash .superpowers/integracao/copia.sh ida
   bash .superpowers/integracao/rota-real.sh subir
   ```
   Expected: `== COPIA ida OK …`; `OK: :5199 (PID …)` + a linha `[guarda-copia-local] OK: cliente e worker -> http://127.0.0.1:…`.
   Sem essa linha ⇒ `rota-real.sh descer` e PARE.
3. Ler na cópia (SÓ LEITURA) a loja ativa do usuário E2E (tem de ser a Loja Teste — NUNCA trocar) e escolher um produto
   INTERNO dela "não integrável"; completar pela aba Produtos da `:5199` o que o resumo pedir (sem marcar); anotar em
   `copia-estado.md`.
4. Rodar o spec a partir do CHECKOUT PRINCIPAL (o `playwright.config.ts` lê o `.env` do cwd para `E2E_EMAIL`/`E2E_PASSWORD` —
   ninguém abre esse arquivo; o `E2E_BASE_URL` do shell vence o do `.env`) com a config e o spec da worktree:
   ```bash
   cd "/Users/sunglee/PLM + Criação/plm-pcp"
   E2E_BASE_URL=http://localhost:5199 E2E_INTEG_ID=<id> E2E_INTEG_NOME="<nome>" npx playwright test \
     --config ".claude/worktrees/integracao-impl/playwright.config.ts" integracao-rota-real --workers=1 --retries=0 \
     2>&1 | tee ".claude/worktrees/integracao-impl/.superpowers/integracao/logs/rota-real.log" | tail -20
   ```
   Expected: `1 passed` + a linha `[rota-real] …` (tempo de parede — referência). `test-results/`/`playwright-report/` que
   caírem no checkout principal estão no `.gitignore` (conferir `git status --short` vazio lá).

- [ ] **Step 5: Descer, cópia limpa e resultado (controlador)**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/integracao-impl"
bash .superpowers/integracao/rota-real.sh descer
INTEG_DONO_AVISADO=sim bash .superpowers/integracao/copia.sh volta
git status --short                                        # vazio (os 3 arquivos novos são não versionados e ignorados/permitidos)
```
Expected: `== :5199 derrubado`; `== COPIA volta OK — <contagem de antes>`. Anotar em `copia-estado.md`: o que ficou gravado
na cópia FORA das tabelas da frente (campos completados do produto — colunas de `modelos`/cadastros, que a volta não desfaz).
Painel: "Ensaio da rota real OK (cópia limpa); CPU: 500 produtos p95 = X ms" + a D38. Só então o RODAR (Task 8 Step 8) vai ao
dono. Defeito ⇒ ver **Produces** (G-migration de novo se for SQL).

---

# FASE 4 — Selos, trava nas outras telas e o preço fixo do importado

### Task 21: Selo + trava no Sheet do Planejamento (espelho da trava do banco)

**Files:**
- Create: `src/lib/integracao/trava.ts`, `src/hooks/useIntegracaoEstado.ts`, `src/components/integracao/SeloIntegracao.tsx`
- Modify: `src/components/planejamento/PlanejamentoDetail.tsx` (selo, REF/SKU/preço/fotos travados, Excluir travado)
- Modify: `src/components/planejamento/planejamento-detail/InfoGeraisSecao.tsx` (prop `travaIntegracao`: Nome, NCM, Título,
  Descrição, Peso e medidas)
- Modify: `src/components/planejamento/planejamento-detail/PrecoTabela.tsx` (props `travaPrecoVenda?`, `travaPrecoAnterior?`)
- Modify: `src/components/planejamento/planejamento-detail/RevendaSetores.tsx` (`PrecoRevendaBloco`: props `travaVarejo?`,
  `travaPrecoAnterior?`; atacado LIVRE — R8/D34)
- Modify (testes EXISTENTES, 1 linha cada — citam o texto que esta task muda): `tests/unit/planejamento-codigos.test.ts`
  (`podeEditarSkus`), `tests/unit/planejamento-permissao-secao-fonte.test.ts` (`disabled={planBloqueado}` da revenda)
- Test: `tests/unit/integracao-trava-tela.test.ts`

**Interfaces:**
- Consumes: RPC `integracao_estado_modelos(_ids uuid[] | NULL)` → `{<modelo_id>: {estado, campos, marcado_em, integrado_em}}`
  (Task 2; NULL = todos os integráveis/integrados da loja; qualquer usuário da loja); Task 9 (`CAMPO_BY_KEY`, `ordenarCampos`).
- Produces (`trava.ts`): `type EstadoModeloIntegracao {estado, campos, marcadoEm, integradoEm}`, `lerEstados(raw)`,
  `SEMPRE_TRAVADO`, `colunasTravadas(e) → ReadonlySet<string>` (colunas de `modelos` + `tamanho_tipo`, `sku`, `variantes`,
  `excluir`), `textoSelo(e, tz)`, `textoExcluirTravado(estado)`, `TEXTO_TRAVA_SHEET`, `TEXTO_SKU_TRAVADO`,
  `TEXTO_PRECO_TRAVADO`.
- Produces (hook/componente): `useIntegracaoEstados()` (queryKey `["integracao-estado", tenantId]` — a MESMA que
  `invalidarIntegracao` invalida), `useIntegracaoEstado(modeloId)`, `<SeloIntegracao estado className?/>`.
- Produces (props novas, opcionais, padrão `false`): `PrecoTabela` → `travaPrecoVenda`, `travaPrecoAnterior` (interno e
  importado: cada preço trava SÓ se o campo dele estiver marcado); `PrecoRevendaBloco` → `travaVarejo` (Preço de venda marcado:
  Preço varejo + Markup varejo) e `travaPrecoAnterior`. Preço atacado e Markup atacado ficam LIVRES (R8 do G-plano do plano;
  D34) — e o markup atacado, com o varejo travado, reenvia o markup varejo GRAVADO (senão o RPC limparia o preço fixo travado).
- O Sheet do Dev NÃO muda (decisão 8): lá a recusa chega pelo banco, traduzida em `erro-mensagem.ts` (Task 9).

- [ ] **Step 1: Escrever o teste (falha: arquivo ausente)**

`tests/unit/integracao-trava-tela.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { colunasTravadas, lerEstados, textoExcluirTravado, textoSelo } from "@/lib/integracao/trava";

const ler = (p: string) => readFileSync(p, "utf8");

describe("trava vista pelas outras telas (F4)", () => {
  const est = lerEstados({
    m1: { estado: "integravel", campos: ["nome", "metatag", "foto", "preco_venda", "keywords"], marcado_em: "2026-09-26T17:35:00Z", integrado_em: null },
    m2: { estado: "nao_integravel", campos: [] },
    m3: { estado: "integrado", campos: ["peso"], marcado_em: "2026-09-25T12:00:00Z", integrado_em: "2026-09-26T13:00:00Z" },
  });
  it("lê só integrável/integrado", () => {
    expect(Object.keys(est).sort()).toEqual(["m1", "m3"]);
  });
  it("campo marcado → coluna do produto; sempre: Tamanho em, SKUs, variantes e excluir", () => {
    const t = colunasTravadas(est.m1);
    for (const c of ["nome", "descricao_produto", "fotos_modelo", "preco_venda", "tamanho_tipo", "sku", "variantes", "excluir"]) expect(t.has(c), c).toBe(true);
    expect(t.has("peso_kg")).toBe(false);
    expect(colunasTravadas(null).size).toBe(0);
  });
  it("selo e Excluir (mockup 10)", () => {
    expect(textoSelo(est.m1, "America/Sao_Paulo")).toBe("Integrável em 26/09 — travado");
    expect(textoSelo(est.m3, "America/Sao_Paulo")).toBe("Integrado em 26/09 — travado");
    expect(textoExcluirTravado("integravel")).toBe("Excluir travado — produto integrável. Volte para não integrável (aba Integração) antes de excluir.");
  });
});

describe("F4 — Sheet do Planejamento espelha a trava", () => {
  const s = ler("src/components/planejamento/PlanejamentoDetail.tsx");
  it("estado do produto, REF/SKU/preço/fotos travados, selo e Excluir", () => {
    expect(s).toMatch(/const estadoIntegracao = useIntegracaoEstado\(isEdit \? modeloId : null\);/);
    expect(s).toMatch(/const refEditavel = isEdit && !devBloqueado && kanbanCard\.refVisivel && !travaIntegracao\.has\("ref"\);/);
    expect(s).toMatch(/podeEditarPlanejamento && !travaIntegracao\.has\("sku"\), \{/);
    expect(s).toMatch(/podeEditarSkus=\{podeEditarPlanejamento && !travaIntegracao\.has\("sku"\)\}/);
    expect(s).toMatch(/<fieldset disabled=\{travaIntegracao\.has\("fotos_modelo"\)\} className="contents">/);
    expect(s).toMatch(/<SeloIntegracao estado=\{estadoIntegracao\} \/>/);
    expect(s).toMatch(/variant="destructive" disabled=\{!!estadoIntegracao\}/);
    expect(s).toMatch(/travaIntegracao=\{travaIntegracao\}/);
  });
  it("D34/R8: preço trava SÓ o campo marcado — interno/importado por coluna; revenda: varejo + markup varejo; atacado livre", () => {
    expect(s).not.toMatch(/\btravaPreco\b/); // nada de travar o bloco inteiro
    expect(s).toMatch(/markupFaixaOn=\{markupFaixaOn\}\n\s+travaPrecoVenda=\{travaIntegracao\.has\("preco_venda"\)\} travaPrecoAnterior=\{travaIntegracao\.has\("preco_anterior"\)\}/);
    expect(s).toMatch(/travaVarejo=\{travaIntegracao\.has\("preco_venda"\)\} travaPrecoAnterior=\{travaIntegracao\.has\("preco_anterior"\)\}/);
    const t = ler("src/components/planejamento/planejamento-detail/PrecoTabela.tsx");
    expect(t).toMatch(/\{podeEditarPreco && !travaPrecoAnterior \? \(/);
    expect(t).toMatch(/\{podeEditarPreco && !travaPrecoVenda \? \(/);
    const r = ler("src/components/planejamento/planejamento-detail/RevendaSetores.tsx");
    expect(r.match(/disabled=\{planBloqueado \|\| travaVarejo\}/g)?.length).toBe(2); // Markup varejo + Preço varejo
    expect(r.match(/disabled=\{planBloqueado\}\n/g)?.length).toBe(2); // Markup atacado + Preço atacado: LIVRES
    expect(r).toMatch(/\{podeEditarPreco && !travaPrecoAnterior \? \(/);
    expect(r).toMatch(/markup_varejo: travaVarejo \? \(produtoRevenda\?\.markup_varejo \?\? null\) : markupVarejoInput/);
  });
  it("Info Gerais trava Nome, NCM, Título, Descrição e medidas por coluna", () => {
    const i = ler("src/components/planejamento/planejamento-detail/InfoGeraisSecao.tsx");
    for (const c of ["nome", "ncm", "titulo_pagina", "descricao_produto"]) expect(i, c).toMatch(new RegExp(`trava\\.has\\("${c}"\\)`));
    expect(i).toMatch(/disabled=\{trava\.has\(m\.key\)\}/);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres
npx vitest run --no-file-parallelism tests/unit/integracao-trava-tela.test.ts
```
Expected: FAIL — `Failed to resolve import "@/lib/integracao/trava"`.

- [ ] **Step 3: `src/lib/integracao/trava.ts`**

```ts
// Integração — a TRAVA vista pelas outras telas (F4, spec §6/§8). Estado + campos marcados no retrato → colunas travadas do
// produto. Quem garante é o BANCO (gatilhos trg_zz_integracao_trava*); aqui só o espelho da tela (selo + disabled). PURO.
import { CAMPO_BY_KEY, ordenarCampos, type CampoKey } from "@/lib/integracao/campos";

export type EstadoModeloIntegracao = {
  estado: "integravel" | "integrado"; campos: CampoKey[]; marcadoEm: string | null; integradoEm: string | null;
};
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const txt = (v: unknown): string | null => (typeof v === "string" ? v : null);

export function lerEstados(raw: unknown): Record<string, EstadoModeloIntegracao> {
  const out: Record<string, EstadoModeloIntegracao> = {};
  for (const [id, v] of Object.entries(obj(raw))) {
    const o = obj(v);
    if (o.estado !== "integravel" && o.estado !== "integrado") continue;
    out[id] = {
      estado: o.estado, campos: ordenarCampos(Array.isArray(o.campos) ? o.campos.filter((c): c is string => typeof c === "string") : []),
      marcadoEm: txt(o.marcado_em), integradoEm: txt(o.integrado_em),
    };
  }
  return out;
}
/** Travam SEMPRE (marcados ou não — spec §8, B2/m085): "Tamanho em", SKUs, variantes do espelho e a exclusão. */
export const SEMPRE_TRAVADO = ["tamanho_tipo", "sku", "variantes", "excluir"] as const;
export function colunasTravadas(e: EstadoModeloIntegracao | null | undefined): ReadonlySet<string> {
  if (!e) return new Set();
  const s = new Set<string>(SEMPRE_TRAVADO);
  for (const k of e.campos) {
    const col = CAMPO_BY_KEY.get(k)?.coluna;
    if (col) s.add(col);
  }
  return s;
}
function fmtDia(iso: string | null, tz: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = new Intl.DateTimeFormat("pt-BR", { timeZone: tz, day: "2-digit", month: "2-digit" }).formatToParts(d);
  return `${p.find((x) => x.type === "day")?.value ?? ""}/${p.find((x) => x.type === "month")?.value ?? ""}`;
}
export function textoSelo(e: EstadoModeloIntegracao, tz: string): string {
  return e.estado === "integrado" ? `Integrado em ${fmtDia(e.integradoEm, tz)} — travado` : `Integrável em ${fmtDia(e.marcadoEm, tz)} — travado`;
}
export function textoExcluirTravado(estado: EstadoModeloIntegracao["estado"]): string {
  return estado === "integrado"
    ? "Excluir travado — produto integrado. Só o super admin desfaz a integração (aba Integração)."
    : "Excluir travado — produto integrável. Volte para não integrável (aba Integração) antes de excluir.";
}
export const TEXTO_TRAVA_SHEET =
  "Campos marcados na integração ficam travados. BOM, CAD, grade de produção, custos e PCP continuam editáveis normalmente.";
export const TEXTO_SKU_TRAVADO = 'SKUs, cores, tamanhos e o "Tamanho em" travados pela Integração (integrável ou integrado).';
export const TEXTO_PRECO_TRAVADO = "Preço travado pela Integração (integrável ou integrado).";
```

- [ ] **Step 4: `src/hooks/useIntegracaoEstado.ts` e `src/components/integracao/SeloIntegracao.tsx`**

```ts
// Integração — estado de integração dos produtos da loja para os selos/travas das outras telas (F4). UMA consulta por loja
// (integracao_estado_modelos(NULL): só integráveis/integrados; nada de retrato nem custo), compartilhada por todas as telas
// (Sheet do Planejamento, card do Plan. Produto, Produto Acabado/Importado, Plan. Tecido). Antes da ida em produção a RPC não
// existe: sem retry, cai em {} (nenhuma trava na tela — o banco ainda não trava nada).
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { lerEstados, type EstadoModeloIntegracao } from "@/lib/integracao/trava";

export function useIntegracaoEstados(): Record<string, EstadoModeloIntegracao> {
  const tenantId = useActiveTenantId();
  const { data } = useQuery({
    queryKey: ["integracao-estado", tenantId],
    enabled: !!tenantId,
    staleTime: 30_000,
    retry: false,
    queryFn: async () => {
      const { data: d, error } = await supabase.rpc("integracao_estado_modelos" as any, { _ids: null });
      if (error) throw error;
      return lerEstados(d);
    },
  });
  return data ?? {};
}
export function useIntegracaoEstado(modeloId: string | null | undefined): EstadoModeloIntegracao | null {
  const estados = useIntegracaoEstados();
  return modeloId ? (estados[modeloId] ?? null) : null;
}
```

```tsx
// Integração — selo "Integrável/Integrado em dd/mm — travado" (mockup 10) nas outras telas.
import { Lock } from "lucide-react";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { useStoreTimezone } from "@/hooks/useStoreTimezone";
import { cn } from "@/lib/utils";
import { textoSelo, type EstadoModeloIntegracao } from "@/lib/integracao/trava";

export function SeloIntegracao({ estado, className }: { estado: EstadoModeloIntegracao; className?: string }) {
  const tz = useStoreTimezone();
  return (
    <StatusBadge tone={estado.estado === "integrado" ? "success" : "warning"}
      className={cn("inline-flex w-fit items-center gap-1 normal-case tracking-normal", className)}>
      <Lock className="h-4 w-4" aria-hidden />{textoSelo(estado, tz)}
    </StatusBadge>
  );
}
```

- [ ] **Step 5: `InfoGeraisSecao.tsx` — prop `travaIntegracao`**

Na assinatura, trocar
`  nomeLoja, planBloqueado, compartilhadoBloqueado,` por `  nomeLoja, planBloqueado, compartilhadoBloqueado, travaIntegracao,`
e, no tipo, trocar
```tsx
  /** P-53 A — campos que os DOIS Sheets antigos editavam: Nome, Estilista, Grupo/Categoria/Subcategorias. */
  compartilhadoBloqueado: boolean;
}) {
  const tituloCalculado = tituloPaginaCalculado(draft.nome, nomeLoja);
```
por
```tsx
  /** P-53 A — campos que os DOIS Sheets antigos editavam: Nome, Estilista, Grupo/Categoria/Subcategorias. */
  compartilhadoBloqueado: boolean;
  /** Integração (F4) — colunas travadas pelo produto integrável/integrado (o banco recusa; aqui só desabilita). */
  travaIntegracao?: ReadonlySet<string>;
}) {
  const trava = travaIntegracao ?? new Set<string>();
  const tituloCalculado = tituloPaginaCalculado(draft.nome, nomeLoja);
```

Nome — trocar
```tsx
              <fieldset disabled={compartilhadoBloqueado} className="contents">
                <FieldText
                  label="Nome do Modelo"
```
por
```tsx
              <fieldset disabled={compartilhadoBloqueado || trava.has("nome")} className="contents">
                <FieldText
                  label="Nome do Modelo"
```

NCM — trocar
```tsx
                <div className="grid gap-1">
                  <Label htmlFor="ncm-produto">NCM do Produto</Label>
```
por
```tsx
                <fieldset disabled={trava.has("ncm")} className="contents">
                <div className="grid gap-1">
                  <Label htmlFor="ncm-produto">NCM do Produto</Label>
```
e fechar o fieldset logo depois do `</div>` desse campo — trocar
```tsx
                    data-colab-path="ncm"
                  />
                </div>
```
por
```tsx
                    data-colab-path="ncm"
                  />
                </div>
                </fieldset>
```

Título — trocar
```tsx
            {/* P-53 A: Título para a página é SÓ do Planejamento. */}
            <fieldset disabled={planBloqueado} className="contents">
```
por
```tsx
            {/* P-53 A: Título para a página é SÓ do Planejamento. */}
            <fieldset disabled={planBloqueado || trava.has("titulo_pagina")} className="contents">
```

Descrição — trocar
```tsx
                esse campo (o brief da rodada 1 errou ao classificá-lo como compartilhado). */}
            <fieldset disabled={planBloqueado} className="contents">
```
por
```tsx
                esse campo (o brief da rodada 1 errou ao classificá-lo como compartilhado). */}
            <fieldset disabled={planBloqueado || trava.has("descricao_produto")} className="contents">
```

Peso e medidas — trocar
```tsx
                    data-colab-path={m.key}
                  />
```
por
```tsx
                    data-colab-path={m.key}
                    disabled={trava.has(m.key)}
                  />
```

- [ ] **Step 5b: `PrecoTabela.tsx` e `RevendaSetores.tsx` — trava por campo (D34/R8)**

`PrecoTabela.tsx` — no tipo das props, trocar
`  podeVerCustos: boolean; podeEditarCustos: boolean; podeEditarPreco: boolean; markupFaixaOn: boolean;`
por
```tsx
  podeVerCustos: boolean; podeEditarCustos: boolean; podeEditarPreco: boolean; markupFaixaOn: boolean;
  /** Integração (F4, D34) — SÓ o preço cujo campo está marcado trava (o banco recusa; aqui só desabilita). */
  travaPrecoVenda?: boolean; travaPrecoAnterior?: boolean;
```
na desestruturação, trocar
```tsx
  const { markupReal, precoSug, precoBase, precoDigitado, draftPrecoVenda, onPrecoVenda, podeEditarPreco,
    precoAnterior, onPrecoAnterior,
```
por
```tsx
  const { markupReal, precoSug, precoBase, precoDigitado, draftPrecoVenda, onPrecoVenda, podeEditarPreco,
    travaPrecoVenda = false, travaPrecoAnterior = false,
    precoAnterior, onPrecoAnterior,
```
Preço anterior — trocar
```tsx
              {podeEditarPreco ? (
                <span className="ml-auto inline-flex items-center justify-end gap-1">
```
por
```tsx
              {podeEditarPreco && !travaPrecoAnterior ? (
                <span className="ml-auto inline-flex items-center justify-end gap-1">
```
Preço de venda — trocar
```tsx
              {podeEditarPreco ? (
                <MoneyInput
                  fixedDecimals
                  aria-label="Preço de venda"
```
por
```tsx
              {podeEditarPreco && !travaPrecoVenda ? (
                <MoneyInput
                  fixedDecimals
                  aria-label="Preço de venda"
```
e, na nota da linha, trocar `{!podeEditarPreco ? " · sem permissão para editar" : ""}</td>` por
`{!podeEditarPreco ? " · sem permissão para editar" : travaPrecoVenda ? " · travado pela Integração" : ""}</td>`.

`RevendaSetores.tsx` (`PrecoRevendaBloco`) — na assinatura, trocar
`export function PrecoRevendaBloco({ rv, custoReal, piRevenda, draft, blocoMaoObra, obsMaoObra, podeEditarPreco, planBloqueado, precoAnterior, onPrecoAnterior }: {`
por
`export function PrecoRevendaBloco({ rv, custoReal, piRevenda, draft, blocoMaoObra, obsMaoObra, podeEditarPreco, planBloqueado, precoAnterior, onPrecoAnterior, travaVarejo = false, travaPrecoAnterior = false }: {`;
no tipo, trocar
```tsx
  planBloqueado: boolean;
}) {
  const {
    produtoRevenda, produtoRevendaLoading,
```
por
```tsx
  planBloqueado: boolean;
  /** Integração (F4, D34/R8) — "Preço de venda" marcado trava o VAREJO (Preço varejo + Markup varejo); "Preço anterior"
   *  marcado trava o anterior. Preço atacado e Markup atacado ficam LIVRES (não vão na API). O banco recusa; aqui só desabilita. */
  travaVarejo?: boolean; travaPrecoAnterior?: boolean;
}) {
  const {
    produtoRevenda, produtoRevendaLoading,
```
Markup atacado (LIVRE) — no `onBlur`, trocar
`salvarMarkupsRevenda.mutate({ markup_atacado: markupAtacadoInput, markup_varejo: markupVarejoInput }); }}` na linha do
`markupAtacadoInput !== markupAtacadoBaseRef.current` por
`salvarMarkupsRevenda.mutate({ markup_atacado: markupAtacadoInput, markup_varejo: travaVarejo ? (produtoRevenda?.markup_varejo ?? null) : markupVarejoInput }); }}`
(com o varejo travado, reenviar o markup varejo GRAVADO é neutro; o EFETIVO — derivado do preço fixo — faria o
`salvar_markups_produto_acabado` limpar o `preco_varejo_fixo` travado. A linha do `onBlur` do Markup VAREJO não muda — ele fica
desabilitado quando travado).
Markup varejo — trocar
```tsx
                          // P-53 A (fix 1, I-1b): mesma trava do markup atacado acima.
                          disabled={planBloqueado}
```
por
```tsx
                          // P-53 A (fix 1, I-1b): mesma trava do markup atacado acima + Integração (D34/R8).
                          disabled={planBloqueado || travaVarejo}
```
Preço anterior — trocar
```tsx
                    {podeEditarPreco ? (
                      <div className="grid gap-1 sm:col-span-2">
```
por
```tsx
                    {podeEditarPreco && !travaPrecoAnterior ? (
                      <div className="grid gap-1 sm:col-span-2">
```
Preço varejo — trocar
```tsx
                        // P-53 A (fix 1, I-1c): mesma trava do preço atacado acima.
                        disabled={planBloqueado}
```
por
```tsx
                        // P-53 A (fix 1, I-1c): mesma trava do preço atacado acima + Integração (D34/R8).
                        disabled={planBloqueado || travaVarejo}
```

- [ ] **Step 6: `PlanejamentoDetail.tsx`**

Depois de `import { ModeloResumoFoto } from "@/components/shared/ModeloResumoFoto";`, acrescentar:

```tsx
import { InfoHover } from "@/components/shared/InfoHover";
import { SeloIntegracao } from "@/components/integracao/SeloIntegracao";
import { useIntegracaoEstado } from "@/hooks/useIntegracaoEstado";
import { TEXTO_SKU_TRAVADO, TEXTO_TRAVA_SHEET, colunasTravadas, textoExcluirTravado } from "@/lib/integracao/trava";
```

Trocar
```tsx
  // REF editável = a seção "Códigos" (F3.6) mostra o campo (etapa configurada) e os campos do Dev estão livres.
  const refEditavel = isEdit && !devBloqueado && kanbanCard.refVisivel;
```
por
```tsx
  // Integração (F4, spec §6/§8): produto integrável/integrado = campos marcados travados. O BANCO recusa (gatilhos
  // trg_zz_integracao_trava); a tela só espelha — selo no cabeçalho, campos desabilitados, Excluir travado.
  const estadoIntegracao = useIntegracaoEstado(isEdit ? modeloId : null);
  const travaIntegracao = colunasTravadas(estadoIntegracao);
  // REF editável = a seção "Códigos" (F3.6) mostra o campo (etapa configurada) e os campos do Dev estão livres.
  const refEditavel = isEdit && !devBloqueado && kanbanCard.refVisivel && !travaIntegracao.has("ref");
```

Trocar
`  const skus = useSkusModelo(modeloId, isEdit && !!modeloId && podeVerPlanejamento, podeEditarPlanejamento, {`
por
`  const skus = useSkusModelo(modeloId, isEdit && !!modeloId && podeVerPlanejamento, podeEditarPlanejamento && !travaIntegracao.has("sku"), {`
(com os SKUs travados, a 1ª geração pós-Salvar — `gerarSeFaltar` — não roda: o banco recusaria).

Depois de
```tsx
              {isEdit && draft.ref && (
                <span className="text-xs font-mono text-muted-foreground">REF {draft.ref}</span>
              )}
```
acrescentar
```tsx
              {isEdit && estadoIntegracao && (
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <SeloIntegracao estado={estadoIntegracao} />
                  <InfoHover ariaLabel="O que fica travado pela Integração">{TEXTO_TRAVA_SHEET}</InfoHover>
                </div>
              )}
```

Trocar `<InfoGeraisSecao numero={numeros.info} selo={seloDe("info")}` por
`<InfoGeraisSecao numero={numeros.info} selo={seloDe("info")} travaIntegracao={travaIntegracao}`.

Trocar
```tsx
            <Secao id="codigos" titulo="Códigos" numero={numeros.codigos} selo={seloDe("codigos")} defaultOpen={false}>
              <CodigosSecao
```
por
```tsx
            <Secao id="codigos" titulo="Códigos" numero={numeros.codigos} selo={seloDe("codigos")} defaultOpen={false}>
              {travaIntegracao.has("sku") && <p className="text-xs text-muted-foreground">{TEXTO_SKU_TRAVADO}</p>}
              <CodigosSecao
```
e `                podeEditarSkus={podeEditarPlanejamento}` por
`                podeEditarSkus={podeEditarPlanejamento && !travaIntegracao.has("sku")}`.

Preço — SÓ o campo marcado trava (D34/R8). Trocar
`                podeVerCustos={veCustos} podeEditarCustos={podeEditarCustos} podeEditarPreco={podeEditarPreco} markupFaixaOn={markupFaixaOn}`
por
```tsx
                podeVerCustos={veCustos} podeEditarCustos={podeEditarCustos} podeEditarPreco={podeEditarPreco} markupFaixaOn={markupFaixaOn}
                travaPrecoVenda={travaIntegracao.has("preco_venda")} travaPrecoAnterior={travaIntegracao.has("preco_anterior")}
```
e (revenda)
```tsx
                podeEditarPreco={podeEditarPreco}
                planBloqueado={perm.planBloqueado}
                precoAnterior={draft.preco_anterior}
```
por
```tsx
                podeEditarPreco={podeEditarPreco}
                planBloqueado={perm.planBloqueado}
                travaVarejo={travaIntegracao.has("preco_venda")} travaPrecoAnterior={travaIntegracao.has("preco_anterior")}
                precoAnterior={draft.preco_anterior}
```

Trocar
```tsx
              <PhotoList label="Foto do Modelo" paths={draft.fotos_modelo}
                onAdd={(f) => uploadMutation.mutate({ file: f, key: "fotos_modelo" })}
                onRemove={(i) => setDraftTracked((d) => ({ ...d, fotos_modelo: d.fotos_modelo.filter((_, j) => j !== i) }))} />
```
por
```tsx
              <fieldset disabled={travaIntegracao.has("fotos_modelo")} className="contents">
                <PhotoList label="Foto do Modelo" paths={draft.fotos_modelo}
                  onAdd={(f) => uploadMutation.mutate({ file: f, key: "fotos_modelo" })}
                  onRemove={(i) => setDraftTracked((d) => ({ ...d, fotos_modelo: d.fotos_modelo.filter((_, j) => j !== i) }))} />
              </fieldset>
```

Trocar
```tsx
          {isEdit && perm.podeAcoesPlanejamento && (
            <Button variant="destructive" onClick={() => setConfirmDel(true)} aria-label="Excluir" className="shrink-0 max-sm:aspect-square max-sm:px-0">
              <Trash2 className="h-4 w-4 sm:mr-1" />
              <span className="max-sm:sr-only">Excluir</span>
            </Button>
          )}
```
por
```tsx
          {isEdit && perm.podeAcoesPlanejamento && (
            <Button variant="destructive" disabled={!!estadoIntegracao} onClick={() => setConfirmDel(true)} aria-label="Excluir" className="shrink-0 max-sm:aspect-square max-sm:px-0">
              <Trash2 className="h-4 w-4 sm:mr-1" />
              <span className="max-sm:sr-only">Excluir</span>
            </Button>
          )}
          {isEdit && perm.podeAcoesPlanejamento && estadoIntegracao && (
            <InfoHover ariaLabel="Por que não exclui">{textoExcluirTravado(estadoIntegracao.estado)}</InfoHover>
          )}
```

- [ ] **Step 6b: 2 testes de fonte EXISTENTES que citam o texto antigo (conferidos em `338d5433`)**

`tests/unit/planejamento-codigos.test.ts` — trocar
`    expect(s).toContain("podeEditarSkus={podeEditarPlanejamento}");` por
`    expect(s).toContain('podeEditarSkus={podeEditarPlanejamento && !travaIntegracao.has("sku")}'); // P-53 A + trava da Integração (F4)`.

`tests/unit/planejamento-permissao-secao-fonte.test.ts` — trocar
`    const usos = (REVENDA_SETORES.match(/disabled=\{planBloqueado\}/g) ?? []).length;` por
`    const usos = (REVENDA_SETORES.match(/disabled=\{planBloqueado(?: \|\| travaVarejo)?\}/g) ?? []).length; // varejo: + trava da Integração (F4)`
(os 4 inputs seguem travando com `planBloqueado`; o `expect(usos).toBeGreaterThanOrEqual(4)` não muda). Nenhum outro teste
existente cita as âncoras desta task (varredura em `tests/unit` na base).

- [ ] **Step 7: Rodar (PASS), gates (inclui "Dev intocado") e commit**

```bash
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres
npx vitest run --no-file-parallelism tests/unit/integracao-trava-tela.test.ts tests/unit/planejamento-codigos.test.ts \
  tests/unit/planejamento-permissao-secao-fonte.test.ts
bash .superpowers/integracao/gates.sh
git add -- src/lib/integracao/trava.ts src/hooks/useIntegracaoEstado.ts src/components/integracao/SeloIntegracao.tsx \
  src/components/planejamento/PlanejamentoDetail.tsx src/components/planejamento/planejamento-detail/InfoGeraisSecao.tsx \
  src/components/planejamento/planejamento-detail/PrecoTabela.tsx src/components/planejamento/planejamento-detail/RevendaSetores.tsx \
  tests/unit/integracao-trava-tela.test.ts tests/unit/planejamento-codigos.test.ts tests/unit/planejamento-permissao-secao-fonte.test.ts
git commit --only -m "feat(integracao): selo e trava no Sheet do Planejamento (REF, SKU, preço por campo, fotos, Info Gerais, Excluir)

Co-Authored-By: Claude <modelo real> <noreply@anthropic.com>" -- src/lib/integracao/trava.ts src/hooks/useIntegracaoEstado.ts \
  src/components/integracao/SeloIntegracao.tsx src/components/planejamento/PlanejamentoDetail.tsx \
  src/components/planejamento/planejamento-detail/InfoGeraisSecao.tsx \
  src/components/planejamento/planejamento-detail/PrecoTabela.tsx src/components/planejamento/planejamento-detail/RevendaSetores.tsx \
  tests/unit/integracao-trava-tela.test.ts tests/unit/planejamento-codigos.test.ts tests/unit/planejamento-permissao-secao-fonte.test.ts
git show --stat HEAD | tail -n +7
```
Expected: PASS (trava-tela 6 + as 2 suítes existentes inteiras); `GATES INTEGRACAO: ok` (o gate "Dev intocado" confirma que `src/components/desenvolvimento/`
não mudou). Revisão individual (Opus + `code-reviewer`): nenhum payload do Salvar passa a mandar coluna nova; a trava é só
`disabled` e SÓ nos campos marcados (atacado livre); o markup atacado com o varejo travado não mexe no canal varejo.

---

### Task 22: Preço do importado vira preço FIXO (n1 no Sheet, n2 no card do Plan. Produto) + trava do preço no card

**Files:**
- Modify: `src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts` (n1)
- Modify: `src/routes/_authenticated/criacao.planejamento.tsx` (n2 + trava do preço no card)
- Test: bloco novo em `tests/unit/integracao-trava-tela.test.ts`

**Interfaces:**
- Consumes: RPC `salvar_precos_fixo_produto_importado(_produto_id, _tocar_atacado, _preco_atacado_fixo, _tocar_varejo,
  _preco_varejo_fixo)` (Task 5 — D14; módulo `produto_importado`); Task 21 (`useIntegracaoEstados`, `colunasTravadas`,
  `TEXTO_PRECO_TRAVADO`).
- Produces: o Salvar do Sheet NÃO manda mais `preco_venda`/`preco_atacado` no UPDATE de NENHUM comprado (revenda E importado —
  `ehOrigemComprada(d.origem)`); o preço digitado do importado grava pelo gravador de preço fixo DEPOIS do UPDATE (e da
  auto-criação do Produto Importado); o card do Plan. Produto grava o importado pelo mesmo gravador (antes caía no da revenda
  e dava "Aguarde o produto de revenda carregar"); `ModeloCard` ganha `precoTravado?: string | null`.

- [ ] **Step 1: Escrever o teste (falha)**

Acrescentar ao FIM de `tests/unit/integracao-trava-tela.test.ts`:

```ts
describe("n1/n2 — preço do importado = preço FIXO (D14)", () => {
  it("n1: o UPDATE do Sheet não leva preço de comprado; o importado grava pelo gravador fixo", () => {
    const s = ler("src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts");
    expect(s).toMatch(/if \(ehOrigemComprada\(d\.origem\)\) \{\s*delete payload\.preco_venda;\s*delete payload\.preco_atacado;/);
    expect(s).toMatch(/rpc\("salvar_precos_fixo_produto_importado" as any/);
  });
  it("n2: o card do Plan. Produto grava importado pelo gravador do importado e trava o preço integrado", () => {
    const s = ler("src/routes/_authenticated/criacao.planejamento.tsx");
    expect(s).toMatch(/rpc\("salvar_precos_fixo_produto_importado" as any/);
    expect(s).toMatch(/m\.origem === "importado"/);
    expect(s).toMatch(/precoTravado=\{/);
    expect(s).toMatch(/podeEditarPreco && !precoTravado \?/);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres
npx vitest run --no-file-parallelism tests/unit/integracao-trava-tela.test.ts
```
Expected: FAIL nos 2 testes novos.

- [ ] **Step 3: n1 — `usePlanejamentoSave.ts`**

Trocar `      if (isRevenda) {` (o ramo que apaga `payload.preco_venda`/`payload.preco_atacado`, logo depois do comentário "Item 3 do
refino") por `      if (ehOrigemComprada(d.origem)) {` e, no comentário acima dele, acrescentar a linha
`      // n1 (Integração, D14): o IMPORTADO também — o preço dele grava como preço FIXO, mais abaixo (depois do UPDATE).`.

Logo ANTES do comentário `      // \`savedDraft\` (bug-fix): devolve o MESMO \`d\` que foi de fato enviado ao servidor —`, acrescentar:

```ts
      // n1 (Integração, D14): IMPORTADO — o preço digitado grava como preço FIXO pelo gravador salvar_precos_fixo_produto_importado
      // (espelho do da revenda; "última edição manda"), nunca pelo UPDATE (o recálculo do servidor o sobrescreveria). Só quando
      // o preço MUDOU vs a base do servidor e com a permissão de preço. Roda DEPOIS da auto-criação do Produto Importado (acima).
      if (savedId && d.origem === "importado" && piOn && podeEditarPreco) {
        const base = baseRef.current?.draft;
        const precoOuNull = (v: unknown) => (numOr0(v) > 0 ? numOr0(v) : null);
        const varejo = precoOuNull(d.preco_venda);
        const atacado = precoOuNull(d.preco_atacado);
        const tocarVarejo = varejo !== precoOuNull(base?.preco_venda);
        const tocarAtacado = atacado !== precoOuNull(base?.preco_atacado);
        if (tocarVarejo || tocarAtacado) {
          const { data: piFixo, error: piFixoErr } = await supabase
            .from("produtos_importados" as any)
            .select("id")
            .eq("modelo_id", savedId)
            .maybeSingle();
          if (piFixoErr) throw piFixoErr;
          if (!piFixo) {
            throw Object.assign(new Error("Crie o cadastro no Produto Importado antes de definir o preço."), { code: "P0001" });
          }
          const { error: fixoErr } = await supabase.rpc("salvar_precos_fixo_produto_importado" as any, {
            _produto_id: (piFixo as { id: string }).id,
            _tocar_atacado: tocarAtacado, _preco_atacado_fixo: atacado,
            _tocar_varejo: tocarVarejo, _preco_varejo_fixo: varejo,
          });
          if (fixoErr) throw fixoErr;
        }
      }
```

- [ ] **Step 4: n2 — `criacao.planejamento.tsx`**

Acrescentar os imports:
```tsx
import { useIntegracaoEstados } from "@/hooks/useIntegracaoEstado";
import { TEXTO_PRECO_TRAVADO, colunasTravadas } from "@/lib/integracao/trava";
import { InfoHover } from "@/components/shared/InfoHover";
```

Logo DEPOIS do bloco `const { data: revendaMap = {} } = useQuery({ … });` (o que lê `produtos_acabados`), acrescentar:

```tsx
  // n2 (Integração, D14): o importado grava o preço pelo gravador PRÓPRIO — mapa modelo_id → produto importado (antes o card
  // mandava o importado para o gravador da revenda e dava "Aguarde o produto de revenda carregar").
  const { data: importadoMap = {} } = useQuery({
    queryKey: ["plan-importado-produtos", modeloIdsAll],
    enabled: modeloIdsAll.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("produtos_importados" as any).select("id, modelo_id").in("modelo_id", modeloIdsAll);
      if (error) throw error;
      const map: Record<string, string> = {};
      for (const r of (data ?? []) as { id: string; modelo_id: string | null }[]) if (r.modelo_id) map[r.modelo_id] = r.id;
      return map;
    },
  });
  const estadosIntegracao = useIntegracaoEstados();
```

Logo DEPOIS da mutation `salvarPrecoVarejoRevenda` (o `useMutation({ … })` que chama `salvar_precos_fixo_produto_acabado`),
acrescentar:

```tsx
  const salvarPrecoVarejoImportado = useMutation({
    mutationFn: async ({ produtoId, precoVarejo }: { produtoId: string; precoVarejo: number | null }) => {
      const { error } = await supabase.rpc("salvar_precos_fixo_produto_importado" as any, {
        _produto_id: produtoId, _tocar_atacado: false, _preco_atacado_fixo: null,
        _tocar_varejo: true, _preco_varejo_fixo: precoVarejo,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      for (const k of ["modelos-planejamento", "modelos-desenvolvimento", "plan-custo-unit", "produtos-importados"]) {
        void qc.invalidateQueries({ queryKey: [k] });
      }
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Não foi possível salvar o preço de venda.")),
  });
```

No `onPrecoVenda` do `<ModeloCard` (a string `if (ehOrigemComprada(m.origem)) {` aparece 2× no arquivo — use as 2 linhas
abaixo como âncora), trocar
```tsx
        onPrecoVenda={(preco) => {
          if (ehOrigemComprada(m.origem)) {
```
por
```tsx
        onPrecoVenda={(preco) => {
          if (m.origem === "importado") {
            const pid = (importadoMap as Record<string, string>)[m.id];
            if (pid) salvarPrecoVarejoImportado.mutate({ produtoId: pid, precoVarejo: preco });
            else toast.error("Aguarde o produto importado carregar (ou crie o cadastro no Produto Importado) e tente de novo.");
            return;
          }
          if (ehOrigemComprada(m.origem)) {
```
e, logo depois de `        precoVenda={(m as any).preco_venda ?? null}`, acrescentar
`        precoTravado={colunasTravadas(estadosIntegracao[m.id]).has("preco_venda") ? TEXTO_PRECO_TRAVADO : null}`.

Na função `ModeloCard`: acrescentar `precoTravado` à desestruturação (logo depois de `precoVenda, onPrecoVenda,`) e ao tipo
(`precoTravado?: string | null;` logo depois de `onPrecoVenda: (preco: number | null) => void;`); trocar
`                    : podeEditarPreco ? (` por `                    : podeEditarPreco && !precoTravado ? (`; e trocar
```tsx
                      <span className="font-medium tabular-nums">{precoVenda != null && precoVenda > 0 ? brl(precoVenda) : preco != null ? brl(preco) : "—"}</span>
```
por
```tsx
                      <span className="inline-flex items-center justify-end gap-1">
                        <span className="font-medium tabular-nums">{precoVenda != null && precoVenda > 0 ? brl(precoVenda) : preco != null ? brl(preco) : "—"}</span>
                        {precoTravado && <InfoHover ariaLabel="Preço travado">{precoTravado}</InfoHover>}
                      </span>
```

- [ ] **Step 5: Rodar (PASS), gates e commit**

```bash
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres
npx vitest run --no-file-parallelism tests/unit/integracao-trava-tela.test.ts
bash .superpowers/integracao/gates.sh
git add -- src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts src/routes/_authenticated/criacao.planejamento.tsx \
  tests/unit/integracao-trava-tela.test.ts
git commit --only -m "fix(integracao): preço do importado grava como preço FIXO no Sheet (n1) e no card do Plan. Produto (n2); card trava o preço integrado

Co-Authored-By: Claude <modelo real> <noreply@anthropic.com>" -- src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts \
  src/routes/_authenticated/criacao.planejamento.tsx tests/unit/integracao-trava-tela.test.ts
git show --stat HEAD | tail -n +7
```
Expected: PASS (trava-tela 8); `GATES INTEGRACAO: ok`. Revisão individual (Opus + `code-reviewer`): o Salvar de outro campo
de um importado NÃO reenvia preço velho; o erro do gravador fixo (depois do UPDATE) mostra a mensagem certa e o retry do
P0409 continua intacto.

- [ ] **Step 6: N8 — registrar o card n2 no inventário da Camada intermediária (controlador; arquivo NÃO versionado do checkout
  principal)**

O card do Plan. Produto passa a gravar o preço do IMPORTADO na hora (como já fazia com a revenda) — é um ponto novo de gravação
fora do Salvar. O controlador acrescenta à tabela de `/Users/sunglee/PLM + Criação/plm-pcp/.superpowers/camada-intermediaria/inventario.md`
(logo abaixo da linha da revenda no mesmo card, se houver; senão no fim da tabela) a linha:

```markdown
| Plan. Produto (card do canvas) | Editar o preço de venda de um IMPORTADO (✓) | RPC `salvar_precos_fixo_produto_importado` (só varejo) | `src/routes/_authenticated/criacao.planejamento.tsx` (`salvarPrecoVarejoImportado`, Integração n2 — 27/set) | Gravação imediata de edição | Baixo (preço fixo; editar o markup na tela Importado destrava) | Prévia+Salvar junto do preço da revenda no mesmo card (Onda 1) | A |
```

---

### Task 23: Produto Acabado e Produto Importado — selo, campos travados (só os marcados) e "Valor atacado/varejo" = preço FIXO no importado, gravado no SALVAR

**Files:**
- Modify: `src/components/produto-acabado/ProdutoCard.tsx` (selo; Nome, Foto, Preço varejo + Markup varejo e Excluir travados;
  atacado LIVRE — R8/D34)
- Modify: `src/components/produto-importado/ProdutoImportadoCard.tsx` (selo; REF, Nome, Foto, Valor varejo + Markup varejo e
  Excluir travados; "Valor atacado/varejo" = rascunho do preço FIXO — grava no SALVAR da tela, D14/R1)
- Modify: `src/components/produto-importado/shared.ts` (draft ganha `preco_atacado_fixo`/`preco_varejo_fixo`, que VÃO no
  payload do `salvar_produto_importado` — `montarPayload`)
- Modify: `src/components/produto-importado/ProdutoImportadoSheet.tsx` (lê os 2 fixos da linha; rótulos do conflito; "Limpar
  card" limpa também os fixos — D35)
- Test: bloco novo em `tests/unit/integracao-trava-tela.test.ts`

**Interfaces:**
- Consumes: Task 21 (`useIntegracaoEstado`, `colunasTravadas`, `textoExcluirTravado`, `SeloIntegracao`); Task 5
  (`_salvar_produto_importado_core` aceita `preco_atacado_fixo`/`preco_varejo_fixo` no `_dados`: fixo = preço exato e ZERA o
  markup do canal; sem fixo, markup não-nulo LIMPA o fixo; sem os dois, o fixo fica; fixo ≤ 0 = P0001 — tudo na MESMA
  transação do `_rev_base` do wrapper `salvar_produto_importado`, então P0409 não grava nada; `salvar_precos_fixo_produto_importado`
  só no "Limpar card" — D35, ação confirmada e imediata).
- Produces: `ProdutoImportadoDraft.preco_atacado_fixo/preco_varejo_fixo: number | null` (entram no `chaveDirty` → dirty,
  guarda de saída e merge 3-vias por campo como os demais); a tela Importado mostra/edita o preço EXATO (fixo, senão o derivado
  do markup) e NADA grava antes do Salvar (sem RPC no blur — some o risco de rev/P0409 do Salvar seguinte). `data-colab-path`
  `card:<id>:preco-atacado-fixo` / `card:<id>:preco-varejo-fixo` (E2E da Task 25). Trava (D34): "Preço de venda" marcado trava
  Valor/Preço varejo + Markup varejo; atacado e markup atacado LIVRES. Espelho sem `modelo_id` = sem selo.

- [ ] **Step 1: Escrever o teste (falha)**

Acrescentar ao FIM de `tests/unit/integracao-trava-tela.test.ts`:

```ts
describe("F4 — Produto Acabado e Importado", () => {
  it("PA: selo + Nome/Foto/Excluir travados; do preço, SÓ o varejo (preço + markup) — atacado livre (D34/R8)", () => {
    const s = ler("src/components/produto-acabado/ProdutoCard.tsx");
    expect(s).toMatch(/const estadoIntegracao = useIntegracaoEstado\(produto\.modelo_id\);/);
    expect(s).toMatch(/disabled=\{identidadeTravada \|\| travaIntegracao\.has\("nome"\)\}/);
    expect(s).toMatch(/disabled=\{enviandoFoto \|\| travaIntegracao\.has\("fotos_modelo"\)\}/);
    expect(s.match(/disabled=\{travaIntegracao\.has\("preco_venda"\)\}/g)?.length).toBe(2); // Markup varejo + Preço varejo
    expect(s).toMatch(/data-colab-path=\{`card:\$\{produto\.id\}:markup-var`\}\n\s+disabled=\{travaIntegracao\.has\("preco_venda"\)\}/);
    expect(s).toMatch(/<SeloIntegracao estado=\{estadoIntegracao\}/);
  });
  it("PI: Valor atacado/varejo = rascunho do preço FIXO, gravado no SALVAR (D14/R1); trava só o varejo marcado (R8)", () => {
    const s = ler("src/components/produto-importado/ProdutoImportadoCard.tsx");
    expect(s).not.toMatch(/salvar_precos_fixo_produto_importado/); // nada grava no blur
    expect(s).toMatch(/data-colab-path=\{cp\("preco-varejo-fixo"\)\}/);
    expect(s).toMatch(/onChange\(n > 0 \? \{ preco_varejo_fixo: n, markup_varejo: null \} : \{ preco_varejo_fixo: null \}\)/);
    expect(s).toMatch(/\{ markup_varejo: Number\(e\.target\.value\), preco_varejo_fixo: null \}/);
    expect(s.match(/disabled=\{travaIntegracao\.has\("preco_venda"\)\}/g)?.length).toBe(2); // Markup varejo + Valor varejo
    expect(s).toMatch(/disabled=\{travaIntegracao\.has\("ref"\)\}/);
    const sh = ler("src/components/produto-importado/shared.ts");
    expect(sh).toMatch(/preco_varejo_fixo: number \| null;/);
    expect(sh.slice(sh.indexOf("export function montarPayload"))).toMatch(/preco_varejo_fixo: draft\.preco_varejo_fixo \?\? null,/);
    expect(ler("src/components/produto-importado/ProdutoImportadoSheet.tsx")).toMatch(/preco_varejo_fixo: "Valor varejo"/);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres
npx vitest run --no-file-parallelism tests/unit/integracao-trava-tela.test.ts
```
Expected: FAIL nos 2 testes novos.

- [ ] **Step 3: `src/components/produto-acabado/ProdutoCard.tsx`**

Acrescentar os imports:
```tsx
import { SeloIntegracao } from "@/components/integracao/SeloIntegracao";
import { useIntegracaoEstado } from "@/hooks/useIntegracaoEstado";
import { colunasTravadas, textoExcluirTravado } from "@/lib/integracao/trava";
```

Trocar `  const identidadeTravada = temOc;` por:
```tsx
  const identidadeTravada = temOc;
  // Integração (F4): produto integrável/integrado — Nome, Foto e o VAREJO (preço + markup) travam quando o campo está marcado,
  // e o Excluir some (o banco recusa: trg_zz_integracao_trava em produtos_acabados; a tela só espelha). Atacado fica livre
  // (D34/R8). Sem card no Planejamento = sem trava.
  const estadoIntegracao = useIntegracaoEstado(produto.modelo_id);
  const travaIntegracao = colunasTravadas(estadoIntegracao);
```

Trocar `          <div className="truncate text-[13px] font-semibold leading-tight">{produto.nome}</div>` por
```tsx
          <div className="truncate text-[13px] font-semibold leading-tight">{produto.nome}</div>
          {estadoIntegracao && <SeloIntegracao estado={estadoIntegracao} className="mt-1" />}
```

Trocar as 2 ocorrências de `disabled={enviandoFoto}` por `disabled={enviandoFoto || travaIntegracao.has("fotos_modelo")}` e
`<Button type="button" variant="ghost" size="iconSm" title="Remover foto" onClick={() => onChange({ ...produto, foto_url: null })}>`
por
`<Button type="button" variant="ghost" size="iconSm" title="Remover foto" disabled={travaIntegracao.has("fotos_modelo")} onClick={() => onChange({ ...produto, foto_url: null })}>`.

Trocar `className="flex-1" disabled={identidadeTravada} value={produto.nome}` por
`className="flex-1" disabled={identidadeTravada || travaIntegracao.has("nome")} value={produto.nome}`.

Markup varejo — trocar `                            data-colab-path={`card:${produto.id}:markup-var`}` por
```tsx
                            data-colab-path={`card:${produto.id}:markup-var`}
                            disabled={travaIntegracao.has("preco_venda")}
```
(o `onBlur` do Markup ATACADO já reenvia o markup varejo GRAVADO — `produto.markup_varejo` —, neutro para o canal travado).

Preço varejo — trocar `                            value={precoVarejoLive ?? ""}` por
```tsx
                            value={precoVarejoLive ?? ""}
                            disabled={travaIntegracao.has("preco_venda")}
```

Trocar
```tsx
              onClick={() => setConfirmExcluir(true)}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-2.5 text-left text-sm text-destructive hover:bg-destructive/10"
```
por
```tsx
              onClick={() => setConfirmExcluir(true)}
              disabled={!!estadoIntegracao}
              title={estadoIntegracao ? textoExcluirTravado(estadoIntegracao.estado) : undefined}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-2.5 text-left text-sm text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-40"
```

- [ ] **Step 4: `src/components/produto-importado/shared.ts` e `ProdutoImportadoSheet.tsx`**

`shared.ts` — trocar
```ts
  markup_varejo: number | null;
  variantes: VarianteImportadoDraft[];
```
por
```ts
  markup_varejo: number | null;
  /** D14/R1 (Integração): preço FIXO exato por canal (null = deriva do markup). VAI no payload do salvar_produto_importado
   *  (montarPayload) e grava no SALVAR da tela, na transação do _rev_base — nada grava antes do Salvar. */
  preco_atacado_fixo: number | null;
  preco_varejo_fixo: number | null;
  variantes: VarianteImportadoDraft[];
```
trocar (em `emptyDraft`)
```ts
    markup_varejo: null,
    variantes: [{ ordem: 1, cor_id: null, cor_apelido_id: null, peso: 1, qtd: 0, _touched: false }],
```
por
```ts
    markup_varejo: null,
    preco_atacado_fixo: null,
    preco_varejo_fixo: null,
    variantes: [{ ordem: 1, cor_id: null, cor_apelido_id: null, peso: 1, qtd: 0, _touched: false }],
```
(em `chaveDirty`)
```ts
    markup_varejo: d.markup_varejo,
    variantes: d.variantes,
```
por
```ts
    markup_varejo: d.markup_varejo,
    preco_atacado_fixo: d.preco_atacado_fixo,
    preco_varejo_fixo: d.preco_varejo_fixo,
    variantes: d.variantes,
```
(em `montarPayload`)
```ts
    markup_varejo: draft.markup_varejo || null,
  };
```
por
```ts
    markup_varejo: draft.markup_varejo || null,
    // D14/R1 (Integração): preço FIXO exato por canal — o _salvar_produto_importado_core grava NESTA transação (a do _rev_base):
    // fixo zera o markup do canal; sem fixo, markup não-nulo limpa o fixo; sem os dois, o fixo fica.
    preco_atacado_fixo: draft.preco_atacado_fixo ?? null,
    preco_varejo_fixo: draft.preco_varejo_fixo ?? null,
  };
```
e trocar `export function precosDoDraft(draft: ProdutoImportadoDraft, resultado?: ResultadoLanded): { atacado: number; varejo: number } {`
+ as 2 linhas do corpo por:
```ts
export function precosDoDraft(draft: ProdutoImportadoDraft, resultado?: ResultadoLanded): { atacado: number; varejo: number } {
  const unitarioBrl = (resultado ?? custoDoDraft(draft)).unitarioBrl;
  const c = cadeiaMarkup(unitarioBrl, draft.markup_atacado ?? 0, draft.markup_varejo ?? 0);
  // D14: o preço FIXO manda ("última edição manda" — mesma regra do servidor).
  return { atacado: draft.preco_atacado_fixo ?? c.atacado, varejo: draft.preco_varejo_fixo ?? c.varejo };
```

`ProdutoImportadoSheet.tsx` — no tipo `ProdutoImportadoRow`, trocar
```ts
  markup_varejo: number | null;
  variantes: (VarianteImportadoDraft & { ordem: number })[] | null;
```
por
```ts
  markup_varejo: number | null;
  preco_atacado_fixo?: number | string | null;
  preco_varejo_fixo?: number | string | null;
  variantes: (VarianteImportadoDraft & { ordem: number })[] | null;
```
em `draftDeRow`, trocar `    markup_varejo: r.markup_varejo,` por
```ts
    markup_varejo: r.markup_varejo,
    preco_atacado_fixo: r.preco_atacado_fixo != null ? Number(r.preco_atacado_fixo) : null,
    preco_varejo_fixo: r.preco_varejo_fixo != null ? Number(r.preco_varejo_fixo) : null,
```
em `ROTULO_CAMPO_PI`, trocar
`  cotacao_final: "Cotação final", markup_atacado: "Markup Atacado", markup_varejo: "Markup Varejo",` por
```ts
  cotacao_final: "Cotação final", markup_atacado: "Markup Atacado", markup_varejo: "Markup Varejo",
  preco_atacado_fixo: "Valor atacado", preco_varejo_fixo: "Valor varejo",
```
e, no `limparMut.mutationFn`, trocar
```ts
        const { error } = await supabase.rpc("limpar_produto_importado" as any, { _produto_id: d.id });
        if (error) throw error;
```
por
```ts
        const { error } = await supabase.rpc("limpar_produto_importado" as any, { _produto_id: d.id });
        if (error) throw error;
        // D35: "Limpar card" (ação confirmada, imediata) também tira o preço FIXO dos 2 canais — senão ele sobreviveria.
        const { error: fixoErr } = await supabase.rpc("salvar_precos_fixo_produto_importado" as any, {
          _produto_id: d.id, _tocar_atacado: true, _preco_atacado_fixo: null, _tocar_varejo: true, _preco_varejo_fixo: null,
        });
        if (fixoErr) throw fixoErr;
```

- [ ] **Step 5: `src/components/produto-importado/ProdutoImportadoCard.tsx`**

Acrescentar os imports:
```tsx
import { SeloIntegracao } from "@/components/integracao/SeloIntegracao";
import { useIntegracaoEstado } from "@/hooks/useIntegracaoEstado";
import { colunasTravadas, textoExcluirTravado } from "@/lib/integracao/trava";
```

Trocar
```tsx
  const precos = useMemo(
    () => cadeiaMarkup(baseImp, draft.markup_atacado ?? 0, draft.markup_varejo ?? 0),
    [baseImp, draft.markup_atacado, draft.markup_varejo],
  );
```
por
```tsx
  const precos = useMemo(() => {
    const c = cadeiaMarkup(baseImp, draft.markup_atacado ?? 0, draft.markup_varejo ?? 0);
    // D14/R1: o preço FIXO manda ("última edição manda" — mesma regra do servidor e do precosDoDraft).
    return { ...c, atacado: draft.preco_atacado_fixo ?? c.atacado, varejo: draft.preco_varejo_fixo ?? c.varejo };
  }, [baseImp, draft.markup_atacado, draft.markup_varejo, draft.preco_atacado_fixo, draft.preco_varejo_fixo]);
  // Integração (F4): REF, Nome, Foto e o VAREJO (valor + markup) travam quando o campo está marcado; atacado LIVRE (D34/R8).
  // O banco recusa (§8); a tela só espelha.
  const estadoIntegracao = useIntegracaoEstado(draft.modelo_id);
  const travaIntegracao = colunasTravadas(estadoIntegracao);
```
(o `pillValores`, logo abaixo, passa a mostrar o preço fixo sem mudança própria — lê `precos.varejo`).

Trocar `          <div className="truncate text-[13px] font-semibold leading-tight">{draft.nome || "Sem nome"}</div>` por
```tsx
          <div className="truncate text-[13px] font-semibold leading-tight">{draft.nome || "Sem nome"}</div>
          {estadoIntegracao && <SeloIntegracao estado={estadoIntegracao} className="mt-1" />}
```

Trocar as 2 ocorrências de `disabled={enviandoFoto}` por `disabled={enviandoFoto || travaIntegracao.has("fotos_modelo")}`, e
`className="text-muted-foreground hover:text-destructive" title="Remover foto" onClick={() => onChange({ foto_url: null })}>`
por
`className="text-muted-foreground hover:text-destructive" title="Remover foto" disabled={travaIntegracao.has("fotos_modelo")} onClick={() => onChange({ foto_url: null })}>`.

Trocar `                        data-colab-path={cp("ref")}` por
```tsx
                        data-colab-path={cp("ref")}
                        disabled={travaIntegracao.has("ref")}
```
e `<Input className="flex-1" data-colab-path={cp("nome")} value={draft.nome} onChange={(e) => onChange({ nome: e.target.value })} />` por
`<Input className="flex-1" data-colab-path={cp("nome")} disabled={travaIntegracao.has("nome")} value={draft.nome} onChange={(e) => onChange({ nome: e.target.value })} />`.

Markups — trocar
```tsx
                          value={draft.markup_atacado ?? 0}
                          onChange={(e) => onChange({ markup_atacado: Number(e.target.value) > 0 ? Number(e.target.value) : null })}
```
por
```tsx
                          value={draft.markup_atacado ?? 0}
                          // D14/R1: markup digitado LIMPA o preço fixo do canal ("última edição manda") — grava no Salvar.
                          onChange={(e) => onChange(Number(e.target.value) > 0 ? { markup_atacado: Number(e.target.value), preco_atacado_fixo: null } : { markup_atacado: null })}
```
e
```tsx
                          value={draft.markup_varejo ?? 0}
                          onChange={(e) => onChange({ markup_varejo: Number(e.target.value) > 0 ? Number(e.target.value) : null })}
```
por
```tsx
                          value={draft.markup_varejo ?? 0}
                          disabled={travaIntegracao.has("preco_venda")}
                          onChange={(e) => onChange(Number(e.target.value) > 0 ? { markup_varejo: Number(e.target.value), preco_varejo_fixo: null } : { markup_varejo: null })}
```

Trocar o comentário + o bloco dos 2 preços
```tsx
                  {/* Preços EDITÁVEIS (caminho inverso): digitar o preço devolve o markup
                      (markup = preço ÷ custo landed). Atacado e varejo independentes. O banco só
                      persiste markup (preço é derivado); grava o markup no draft. base=0 → não grava. */}
                  <div className="mt-2 grid grid-cols-2 gap-3">
                    <div className="flex items-center gap-3">
                      <Label className="w-[120px] shrink-0 text-sm">Valor atacado</Label>
                      <MoneyInput
                        className="flex-1"
                        value={precos.atacado > 0 ? precos.atacado : ""}
                        placeholder="0,00"
                        disabled={baseImp <= 0}
                        onChange={(e) => {
                          const mk = markupDePreco(baseImp, Number(e.target.value) || 0);
                          if (mk != null) onChange({ markup_atacado: mk });
                        }}
                      />
                    </div>
                    <div className="flex items-center gap-3">
                      <Label className="w-[120px] shrink-0 text-sm">Valor varejo</Label>
                      <MoneyInput
                        className="flex-1"
                        value={precos.varejo > 0 ? precos.varejo : ""}
                        placeholder="0,00"
                        disabled={baseImp <= 0}
                        onChange={(e) => {
                          const mk = markupDePreco(baseImp, Number(e.target.value) || 0);
                          if (mk != null) onChange({ markup_varejo: mk });
                        }}
                      />
                    </div>
                  </div>
```
por
```tsx
                  {/* Preços EDITÁVEIS = preço FIXO exato (D14/R1, espelho da revenda — fim do "298 → 297,84"): digitar vira
                      rascunho do fixo do canal e LIMPA o markup dele; grava no SALVAR da tela (salvar_produto_importado, na
                      transação do _rev_base). Vazio (e markup vazio) = nada muda no banco; para voltar ao markup, digite o
                      markup. Funciona com base 0. */}
                  <div className="mt-2 grid grid-cols-2 gap-3">
                    <div className="flex items-center gap-3">
                      <Label className="w-[120px] shrink-0 text-sm">Valor atacado</Label>
                      <MoneyInput
                        className="flex-1"
                        fixedDecimals
                        data-colab-path={cp("preco-atacado-fixo")}
                        value={precos.atacado > 0 ? precos.atacado : ""}
                        placeholder="0,00"
                        onChange={(e) => {
                          const n = Number(e.target.value) || 0;
                          onChange(n > 0 ? { preco_atacado_fixo: n, markup_atacado: null } : { preco_atacado_fixo: null });
                        }}
                      />
                    </div>
                    <div className="flex items-center gap-3">
                      <Label className="w-[120px] shrink-0 text-sm">Valor varejo</Label>
                      <MoneyInput
                        className="flex-1"
                        fixedDecimals
                        data-colab-path={cp("preco-varejo-fixo")}
                        value={precos.varejo > 0 ? precos.varejo : ""}
                        placeholder="0,00"
                        disabled={travaIntegracao.has("preco_venda")}
                        onChange={(e) => {
                          const n = Number(e.target.value) || 0;
                          onChange(n > 0 ? { preco_varejo_fixo: n, markup_varejo: null } : { preco_varejo_fixo: null });
                        }}
                      />
                    </div>
                  </div>
```
Tirar o import `import { markupDePreco } from "@/lib/preco-revenda";` (as 2 chamadas eram só nesse bloco — conferido na
base `338d5433`; sem isso o lint/tsc acusa import sem uso).

Trocar
```tsx
                onClick={() => setConfirmExcluir(true)}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-2.5 text-left text-sm text-destructive hover:bg-destructive/10"
```
por
```tsx
                onClick={() => setConfirmExcluir(true)}
                disabled={!!estadoIntegracao}
                title={estadoIntegracao ? textoExcluirTravado(estadoIntegracao.estado) : undefined}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-2.5 text-left text-sm text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-40"
```

- [ ] **Step 6: Rodar (PASS), gates e commit**

```bash
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres
npx vitest run --no-file-parallelism tests/unit/integracao-trava-tela.test.ts
bash .superpowers/integracao/gates.sh
git add -- src/components/produto-acabado/ProdutoCard.tsx src/components/produto-importado/ProdutoImportadoCard.tsx \
  src/components/produto-importado/shared.ts src/components/produto-importado/ProdutoImportadoSheet.tsx tests/unit/integracao-trava-tela.test.ts
git commit --only -m "feat(integracao): selo e trava (só campos marcados) no Produto Acabado/Importado; Valor do importado = preço fixo no Salvar (D14/R1)

Co-Authored-By: Claude <modelo real> <noreply@anthropic.com>" -- src/components/produto-acabado/ProdutoCard.tsx \
  src/components/produto-importado/ProdutoImportadoCard.tsx src/components/produto-importado/shared.ts \
  src/components/produto-importado/ProdutoImportadoSheet.tsx tests/unit/integracao-trava-tela.test.ts
git show --stat HEAD | tail -n +7
```
Expected: PASS (trava-tela 10); `GATES INTEGRACAO: ok`. Revisão individual (Opus + `code-reviewer`): o preço digitado no
Importado não vira mais "298 → 297,84"; NADA grava antes do Salvar (sem RPC no blur); o Salvar com `_rev_base` velho é P0409
sem gravar o preço; editar o markup limpa o fixo; o merge 3-vias trata os 2 fixos como campos (rótulos "Valor atacado/varejo");
atacado livre com o varejo travado.

---

### Task 24: Plan. Tecido — selo no card, Limpar e preço travados

**Files:**
- Modify: `src/components/plan-tecido/ModelCard.tsx` (selo; "Limpar slot" travado; passa a trava do preço)
- Modify: `src/components/plan-tecido/CustoSection.tsx` (prop `precoTravado`)
- Test: bloco novo em `tests/unit/integracao-trava-tela.test.ts`

**Interfaces:**
- Consumes: Task 21 (`useIntegracaoEstado`, `colunasTravadas`, `textoExcluirTravado`, `TEXTO_PRECO_TRAVADO`, `SeloIntegracao`).
- Produces: `CustoSection` aceita `precoTravado?: boolean` (NumberInput do "Preço p/ venda" desabilitado com o motivo).
  `PlanTecidoSheet.tsx` NÃO muda (o card lê o estado sozinho — consulta única por loja).

- [ ] **Step 1: Escrever o teste (falha)**

Acrescentar ao FIM de `tests/unit/integracao-trava-tela.test.ts`:

```ts
describe("F4 — Plan. Tecido", () => {
  it("card com selo; Limpar slot e preço travados no integrável/integrado", () => {
    const s = ler("src/components/plan-tecido/ModelCard.tsx");
    expect(s).toMatch(/const estadoIntegracao = useIntegracaoEstado\(slot\.modelo_id\);/);
    expect(s).toMatch(/<SeloIntegracao estado=\{estadoIntegracao\}/);
    expect(s).toMatch(/precoTravado=\{travaIntegracao\.has\("preco_venda"\)\}/);
    expect(s).toMatch(/disabled=\{!!estadoIntegracao\} onClick=\{\(\) => setConfirmLimpar\(true\)\}/);
    expect(ler("src/components/plan-tecido/CustoSection.tsx")).toMatch(/disabled=\{precoTravado\}/);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres
npx vitest run --no-file-parallelism tests/unit/integracao-trava-tela.test.ts
```
Expected: FAIL no teste novo.

- [ ] **Step 3: `ModelCard.tsx` e `CustoSection.tsx`**

`ModelCard.tsx` — acrescentar os imports:
```tsx
import { SeloIntegracao } from "@/components/integracao/SeloIntegracao";
import { useIntegracaoEstado } from "@/hooks/useIntegracaoEstado";
import { TEXTO_PRECO_TRAVADO, colunasTravadas, textoExcluirTravado } from "@/lib/integracao/trava";
```
trocar `  const borderClass = open ? "border-primary" : "";` por
```tsx
  const borderClass = open ? "border-primary" : "";
  // Integração (F4): produto integrável/integrado — selo no card; "Limpar slot" (apaga nome/REF/preço) e o preço travados.
  const estadoIntegracao = useIntegracaoEstado(slot.modelo_id);
  const travaIntegracao = colunasTravadas(estadoIntegracao);
```
trocar
```tsx
            {slot.ref && (
              <div className="w-full truncate text-[11px] leading-tight text-muted-foreground tabular-nums" title={slot.ref}>
                {slot.ref}
              </div>
            )}
```
por
```tsx
            {slot.ref && (
              <div className="w-full truncate text-[11px] leading-tight text-muted-foreground tabular-nums" title={slot.ref}>
                {slot.ref}
              </div>
            )}
            {estadoIntegracao && <SeloIntegracao estado={estadoIntegracao} />}
```
trocar
```tsx
                  <button type="button" onClick={() => setConfirmLimpar(true)}
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-2.5 text-left text-sm hover:bg-muted">
```
por
```tsx
                  <button type="button" disabled={!!estadoIntegracao} onClick={() => setConfirmLimpar(true)}
                    title={estadoIntegracao ? textoExcluirTravado(estadoIntegracao.estado).replace("Excluir", "Limpar") : undefined}
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-2.5 text-left text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40">
```
e trocar
`                  <CustoSection slot={slot} onChange={onChange} maoObraEstado={maoObraEstado} maoObraServico={maoObraServico} />`
por
```tsx
                  <CustoSection slot={slot} onChange={onChange} maoObraEstado={maoObraEstado} maoObraServico={maoObraServico}
                    precoTravado={travaIntegracao.has("preco_venda")} motivoPrecoTravado={TEXTO_PRECO_TRAVADO} />
```

`CustoSection.tsx` — trocar a assinatura
`export function CustoSection({ slot, onChange, maoObraEstado, maoObraServico }: { slot: PtSlot; onChange: (s: PtSlot) => void; maoObraEstado?: string; maoObraServico?: number | null }) {`
por
`export function CustoSection({ slot, onChange, maoObraEstado, maoObraServico, precoTravado = false, motivoPrecoTravado }: { slot: PtSlot; onChange: (s: PtSlot) => void; maoObraEstado?: string; maoObraServico?: number | null; precoTravado?: boolean; motivoPrecoTravado?: string }) {`
e, no `NumberInput` do "Preço p/ venda", trocar `className="h-7 w-full text-right" value={slot.preco_venda ?? 0}` por
`className="h-7 w-full text-right" disabled={precoTravado} title={precoTravado ? motivoPrecoTravado : undefined} value={slot.preco_venda ?? 0}`.

- [ ] **Step 4: Rodar (PASS), gates e commit**

```bash
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres
npx vitest run --no-file-parallelism tests/unit/integracao-trava-tela.test.ts
bash .superpowers/integracao/gates.sh
git add -- src/components/plan-tecido/ModelCard.tsx src/components/plan-tecido/CustoSection.tsx tests/unit/integracao-trava-tela.test.ts
git commit --only -m "feat(integracao): selo e trava (Limpar slot, preço) no card do Plan. Tecido

Co-Authored-By: Claude <modelo real> <noreply@anthropic.com>" -- src/components/plan-tecido/ModelCard.tsx \
  src/components/plan-tecido/CustoSection.tsx tests/unit/integracao-trava-tela.test.ts
git show --stat HEAD | tail -n +7
```
Expected: PASS (trava-tela 11); `GATES INTEGRACAO: ok`.

---

# FASE 5 — QA, docs e portões finais

### Task 25: G-commit, juntar + cópia, QA na CÓPIA (`:5188`) com os 5 casos do R7, P-87 no celular, CLAUDE.md, G-deploy *(controlador + guardião + dono)*

**Files:**
- Modify: `CLAUDE.md` (invariante #14 — Integração + API)
- Create (NÃO versionar; está no `permitidos.txt` só para o `gates.sh` não barrar correção pós-QA): `tests/e2e/integracao-qa.spec.ts`

**Interfaces:**
- Consumes: Tasks 1–24 + 20b commitadas; ensaio da rota real verde (Task 20b); `== IDA OK` + `ref-volta-f1` OK do dono (Task 8,
  RODAR); `copia.sh` (Task 8).
- Produces: branch `integracao/impl` juntada na `feature/plan-tecido-a1`; cópia COM a frente; QA verde NA CÓPIA (inclui os 5
  casos do R7 e o P-87); mobile medido (aviso + selos); CLAUDE.md e memória em dia; G-deploy.

- [ ] **Step 1: CLAUDE.md — invariante #14**

Em `CLAUDE.md`, depois do fim do item 13 da seção "Invariantes a preservar", acrescentar:

```markdown
14. **Integração + API por loja (set/2026, spec `docs/superpowers/specs/2026-09-26-tela-integracao-api-design.md`)** — tela
    `/integracao` (permissão `integracao`; `ModuleDef` próprio fora dos interruptores de Gerenciar Lojas; abas Produtos/Log p/
    admin da loja + permissão; Campos da API/API/Manual SÓ super admin, que também tem o item no Admin Mestre) e a API
    `GET /api/integracao/v1/produtos` (rota de servidor no Worker, `Authorization: Bearer`, 2 fases: `_integracao_ler` →
    links assinados das fotos → `_integracao_confirmar`; só as 3 `_integracao_*` da rota têm EXECUTE p/ `service_role`; teto
    por IP no binding `ratelimits` `INTEGRACAO_TETO_IP`; página padrão 50 produtos — P-89 A, faixa 1–500, acima de 100 só com
    Workers Paid; a resposta traz `pagina: {limite, maximo}`). Estados `nao_integravel → integravel` (marcar, com a assinatura
    HMAC do retrato do resumo) `→ integrado` (a API confirmou a entrega) `→ nao_integravel` (voltar SÓ de integrável;
    desfazer SÓ super admin, com motivo). **Trava no BANCO** (`trg_zz_integracao_trava*`, últimos na ordem alfabética; CONSTRAINT
    TRIGGER adiado nas variantes do espelho): produto integrável/integrado não muda os campos marcados + SEMPRE `tamanho_tipo`,
    SKUs, o conjunto de cores do espelho e a exclusão — recusa `42501 integracao_travado: <campo>` (ASCII, traduzida em
    `erro-mensagem.ts`). As telas só ESPELHAM, SÓ nos campos marcados (selo "Integrável/Integrado em dd/mm — travado" +
    disabled — Sheet do Planejamento, card do Plan. Produto, Produto Acabado/Importado, Plan. Tecido; preço: o VAREJO trava,
    o atacado fica livre; o Sheet do Dev NÃO muda, recebe a recusa). Celular: a tela Integração NÃO existe (P-87 — aviso
    "A Integração é usada no computador"; item escondido no menu); os selos das outras telas valem.
    **Mão dupla:** a aba Produtos edita as MESMAS colunas do card (staging + `integracao_salvar` com `rev`/P0409 + merge 3-vias);
    nome/REF sincronizam `modelos ↔ produtos_*` por gatilho (renomear no Sheet um comprado com OC renomeia também na tela
    PA/PI; P-88 A — a REF do espelho só chega ao card ANTES do envio à Explosão). **Preço do importado = preço FIXO**: na tela
    Importado grava no SALVAR (`_salvar_produto_importado_core` aceita `preco_*_fixo`, na transação do `_rev_base`); Sheet,
    card do Plan. Produto e `integracao_salvar` usam `salvar_precos_fixo_produto_importado` (espelho do da revenda); editar o
    markup limpa o fixo. 7 tabelas `integracao_*` com RLS SEM policy + `REVOKE ALL` (só RPC DEFINER lê). `reset_loja` apaga a integração
    da loja (o segredo HMAC é global). Volta de emergência: `.superpowers/integracao/mig/volta-producao.sh` (APAGA config, chaves,
    acessos, log e espelho).
```

```bash
bash .superpowers/integracao/gates.sh
git add -- CLAUDE.md
git commit --only -m "docs(claude): invariante #14 — Integração + API por loja

Co-Authored-By: Claude <modelo real> <noreply@anthropic.com>" -- CLAUDE.md
```

- [ ] **Step 2: G-commit (guardião) — antes de juntar**

O guardião confere: `git log feature/plan-tecido-a1..integracao/impl` só com commits desta frente; `gates.sh` verde; Dev
intocado; os 12 SQL = `md5-sql-congelado.txt` (Task 7); `== IDA OK` + `ref-volta-f1` OK no log do dono
(`.superpowers/integracao/logs/prod-ida.log`, `prod-ref-volta-f1.log`); `tests/e2e/integracao-qa.spec.ts` NÃO versionado;
nenhuma outra frente sobreposta (`git diff --name-only feature/plan-tecido-a1...integracao/impl` contra as branches
vivas das outras frentes). BLOQUEIA ⇒ parar.

- [ ] **Step 3: Juntar na principal + a frente na cópia — o MESMO passo (o dono dá o OK no painel)**

Só DEPOIS do `== IDA OK` (senão o `:5173` do dono, que grava em PRODUÇÃO, chama RPCs que não existem). O `:5173` e o `:5188`
servem o MESMO checkout principal: do merge até a QA passar, o `:5173` já mostra a tela Integração e as travas contra a
PRODUÇÃO. ANTES, o controlador publica no painel: "Vou juntar a Integração na principal. A partir daí o :5173 (produção) já
tem a tela Integração e as travas; a QA roda na cópia (:5188). Até eu avisar que a QA passou, não integre nem edite produtos
pela tela Integração no :5173. Pode juntar?" e ESPERA o "pode juntar". Depois publica o aviso N3 e:

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp"                 # checkout principal (branch feature/plan-tecido-a1)
git status --short                                         # vazio (se não estiver, PARE)
git merge --ff-only integracao/impl && git log --oneline -3
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/integracao-impl"
INTEG_DONO_AVISADO=sim bash .superpowers/integracao/copia.sh ida
```
Expected: ff sem conflito; `== COPIA ida OK — <contagem>` (= a de antes + 46|+14). Não-ff (outra frente entrou antes) ⇒ na
WORKTREE `git merge --no-ff --no-edit feature/plan-tecido-a1` (sem stash), `gates.sh`, G-commit de novo, e só então o ff.

- [ ] **Step 4: Preparação da QA NA CÓPIA (controlador — nunca o executor; "QA não semeia banco")**

- Ler na cópia, SÓ LEITURA (`PGOPTIONS='-c default_transaction_read_only=on' psql …:54422`): a loja ativa do usuário E2E
  (tem de ser a Loja Teste — trocar de loja GRAVA `users.tenant_id`; se não for, PARE); um produto INTERNO da Loja Teste
  "não integrável" e o que falta nele (`SELECT public.integracao_previa(ARRAY['<id>']::uuid[])` como o usuário E2E, dentro de
  `BEGIN READ ONLY … ROLLBACK` com `request.jwt.claims`).
- Publicar no painel o setup (gravação NA CÓPIA — P-51 A): "Vou completar na CÓPIA (:5188), só na Loja Teste, os campos do
  produto <nome> (pela aba Integração) para a QA de integrar/voltar. Produção não é tocada."; completar pela tela do `:5188`
  e anotar em `.superpowers/integracao/copia-estado.md` o que gravou.
- R7 (mesmo aviso P-51 A): escolher na Loja Teste, SÓ LEITURA, 1 IMPORTADO (com Produto Importado criado, 1 linha de M.O. NÃO
  aprovada e os campos que o resumo pede completos — completar pela tela do `:5188` se faltar) e 1 REVENDA (Produto Acabado);
  anotar nome e `modelo_id` de cada um e os preços/nome de ANTES em `copia-estado.md` (os casos gravam preço, M.O. e nome NA
  CÓPIA). Conferir que o card do importado aparece no canvas do Plan. Produto com os filtros atuais do usuário E2E (senão,
  ajustar o filtro pela tela e anotar).
- A rota da API no `:5188` usa o Supabase LOCAL (`banco-local/app-teste/.dev.vars` — o controlador NÃO abre esse arquivo).
  Se o curl do Step 5 der `{"erro":"erro_interno"}` em toda chamada, é falta de variável do servidor no app de teste: PARE e
  avise o dono no painel (não editar `subir-app-5188.sh`).

- [ ] **Step 5: QA — `tests/e2e/integracao-qa.spec.ts` (NÃO versionar) com `E2E_BASE_URL=http://localhost:5188`**

```ts
import { test, expect, type Locator, type Page } from "@playwright/test";
import { Client } from "pg";
import { doLogin } from "./_helpers";
// Integração + API — QA na CÓPIA (:5188, P-51 A). O :5173 grava em PRODUÇÃO e NÃO roda este arquivo. NUNCA selectStore.
// Banco: SÓ LEITURA (default_transaction_read_only), sempre a cópia :54422 — nunca tests/integration/db.ts.
const ID = process.env.E2E_INTEG_ID ?? "";
const NOME = process.env.E2E_INTEG_NOME ?? "";
test.skip(!process.env.E2E_BASE_URL?.includes("localhost:5188") || !ID || !NOME, "só no :5188 (cópia) e com o produto combinado");

async function abrirProdutos(page: Page, nome = NOME) {
  await page.goto("/integracao");
  await expect(page.getByRole("tab", { name: "Produtos" })).toHaveAttribute("data-state", "active");
  await page.getByLabel("Buscar").fill(nome);
  await expect(page.getByRole("switch", { name: `Integrável: ${nome}` })).toBeVisible({ timeout: 15000 });
}

test("abre em 'Não integrados'; editar em staging acende 'alterações não salvas'; Descartar não grava", async ({ page }) => {
  await doLogin(page);
  await abrirProdutos(page);
  await expect(page.getByRole("button", { name: /^Não integrados/ })).toHaveAttribute("aria-pressed", "true");
  const titulo = page.getByRole("textbox", { name: "Título para a página" }).first();
  const antes = await titulo.inputValue();
  await titulo.fill(`${antes} QA`);
  await expect(page.getByText("alterações não salvas")).toBeVisible();
  await page.getByRole("tab", { name: "Log" }).click();
  await expect(page.getByText("Descartar alterações?")).toBeVisible();
  await page.getByRole("button", { name: "Descartar" }).click();
  await page.getByRole("tab", { name: "Produtos" }).click();
  await page.getByLabel("Buscar").fill(NOME);
  await expect(page.getByRole("textbox", { name: "Título para a página" }).first()).toHaveValue(antes);
});

test("integrar (texto do dono + resumo) → selo e trava no Sheet → voltar destrava; Log registra", async ({ page }) => {
  await doLogin(page);
  await abrirProdutos(page);
  await page.getByRole("switch", { name: `Integrável: ${NOME}` }).click();
  await expect(page.getByText("Você tem certeza? Se estiver errado, você poderá ser demitido")).toBeVisible();
  await expect(page.getByText(/Valores que vão na API \(dado salvo, \d+ campos marcados\)/)).toBeVisible();
  await page.getByRole("button", { name: "Tenho certeza — integrar" }).click();
  await expect(page.getByText("1 produto integrável.")).toBeVisible({ timeout: 15000 });
  await page.goto(`/criacao/planejamento?modelo=${ID}`);
  await expect(page.getByText(/Integrável em \d\d\/\d\d — travado/)).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("button", { name: "Excluir" })).toBeDisabled();
  await abrirProdutos(page);
  await page.getByRole("switch", { name: `Integrável: ${NOME}` }).click();
  await expect(page.getByText("Voltar para não integrável?")).toBeVisible();
  await page.getByRole("button", { name: "Voltar para não integrável" }).click();
  await expect(page.getByText("1 produto voltou para não integrável.")).toBeVisible({ timeout: 15000 });
  await page.getByRole("tab", { name: "Log" }).click();
  await expect(page.getByRole("cell", { name: "Integrar" }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "Voltar" }).first()).toBeVisible();
});

test("API: chave nova (mostrada 1×) → modo teste 200 com exemplos; chave errada 401; revogada 401", async ({ page, request }) => {
  await doLogin(page);
  await page.goto("/integracao");
  await page.getByRole("tab", { name: "API" }).click();
  await page.getByRole("button", { name: "Nova chave" }).click();
  await page.getByLabel("Nome da chave").fill("QA integracao");
  await page.getByRole("button", { name: "Criar" }).click();
  const chave = await page.getByLabel("Chave gerada").inputValue();
  expect(chave).toMatch(/^wish_live_[A-Za-z0-9_-]{32}$/);
  await page.getByRole("button", { name: "Concluído" }).click();
  const url = "/api/integracao/v1/produtos";
  const t = await request.get(`${url}?modo=teste&limite=2`, { headers: { authorization: `Bearer ${chave}` } });
  expect(t.status()).toBe(200);
  const j = await t.json();
  expect(j.modo).toBe("teste");
  expect(j.linhas[0].produto_id).toBe("exemplo-0001");
  expect(JSON.stringify(j)).not.toContain(ID);
  const errada = await request.get(url, { headers: { authorization: "Bearer wish_live_errada" } });
  expect(errada.status()).toBe(401);
  expect(await errada.text()).toBe('{"erro":"chave_invalida"}');
  await page.getByRole("row", { name: /QA integracao/ }).getByRole("button", { name: "Revogar" }).click();
  await page.getByRole("button", { name: "Revogar chave" }).click();
  await expect(page.getByText("Chave revogada.")).toBeVisible();
  expect((await request.get(`${url}?modo=teste`, { headers: { authorization: `Bearer ${chave}` } })).status()).toBe(401);
});

test("P-87 — celular (360/390): item some do menu e a rota mostra só o aviso, SEM consultar a lista", async ({ page }) => {
  await doLogin(page);
  let chamouLista = false;
  page.on("request", (r) => { if (r.url().includes("/rest/v1/rpc/integracao_listar")) chamouLista = true; });
  for (const w of [360, 390]) {
    await page.setViewportSize({ width: w, height: 800 });
    await page.goto("/home");
    await page.getByRole("button", { name: /toggle sidebar/i }).first().click();
    await expect(page.locator('a[href="/integracao"]:visible'), `${w}px`).toHaveCount(0);
    await page.goto("/integracao");
    await expect(page.getByText("A Integração é usada no computador")).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole("tab", { name: "Produtos" })).toHaveCount(0);
  }
  expect(chamouLista).toBe(false);
});

test("P-87 — selo e trava nas OUTRAS telas continuam no celular (Sheet do Planejamento, 360/390, sem rolagem da página)", async ({ page }) => {
  await doLogin(page);
  await abrirProdutos(page);
  await page.getByRole("switch", { name: `Integrável: ${NOME}` }).click();
  await page.getByRole("button", { name: "Tenho certeza — integrar" }).click();
  await expect(page.getByText("1 produto integrável.")).toBeVisible({ timeout: 15000 });
  for (const w of [360, 390]) {
    await page.setViewportSize({ width: w, height: 800 });
    await page.goto(`/criacao/planejamento?modelo=${ID}`);
    await expect(page.getByText(/Integrável em \d\d\/\d\d — travado/)).toBeVisible({ timeout: 15000 });
    const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(sw, `${w}px`).toBeLessThanOrEqual(cw);
  }
  await page.setViewportSize({ width: 1366, height: 900 });
  await abrirProdutos(page);
  await page.getByRole("switch", { name: `Integrável: ${NOME}` }).click();
  await page.getByRole("button", { name: "Voltar para não integrável" }).click();
  await expect(page.getByText("1 produto voltou para não integrável.")).toBeVisible({ timeout: 15000 });
});

// ── R7 (G-plano do plano): 5 casos de ponta a ponta nas OUTRAS telas, com o banco conferido SÓ LEITURA ──
const IMP = process.env.E2E_INTEG_IMP_ID ?? ""; // modelo_id de um IMPORTADO da Loja Teste, com 1 linha de MO NÃO aprovada
const IMP_NOME = process.env.E2E_INTEG_IMP_NOME ?? "";
const PA = process.env.E2E_INTEG_PA_ID ?? ""; // modelo_id de uma REVENDA (Produto Acabado) da Loja Teste
const PA_NOME = process.env.E2E_INTEG_PA_NOME ?? "";
const COPIA = "postgresql://postgres:postgres@127.0.0.1:54422/postgres";
async function sql<T = Record<string, unknown>>(q: string, p: unknown[] = []): Promise<T[]> {
  const c = new Client({ connectionString: COPIA, options: "-c default_transaction_read_only=on" });
  await c.connect();
  try { return (await c.query(q, p)).rows as T[]; } finally { await c.end(); }
}
const num = async (q: string, p: unknown[]) => { const v = (await sql<{ v: unknown }>(q, p))[0]?.v; return v == null ? null : Number(v); };
async function espelho(tabela: "produtos_importados" | "produtos_acabados", modeloId: string) {
  return (await sql<{ id: string; colecao_id: string; subcolecao: string | null }>(
    `SELECT id, colecao_id, subcolecao FROM public.${tabela} WHERE modelo_id = $1`, [modeloId]))[0];
}
async function abrirCardEspelho(page: Page, rota: string, e: { colecao_id: string; subcolecao: string | null }, nome: string, alvo: Locator, secao?: RegExp) {
  await page.goto(`${rota}?colecao=${e.colecao_id}${e.subcolecao ? `&sub=${e.subcolecao}` : ""}`);
  await page.getByText(nome, { exact: true }).first().click();
  if (secao && !(await alvo.isVisible())) await page.getByRole("button", { name: secao }).first().click();
  await expect(alvo).toBeVisible({ timeout: 15000 });
}
const salvar = (page: Page) => page.getByRole("button", { name: "Salvar", exact: true }).first().click();

test.describe("R7 — preço fixo do importado, mão dupla e trava nas outras telas", () => {
  test.skip(!IMP || !IMP_NOME || !PA || !PA_NOME, "precisa do importado e da revenda combinados (Step 4)");

  test("(a) Sheet do Planejamento, importado: preço gravado no Salvar; salvar a MO depois NÃO muda o preço", async ({ page }) => {
    await doLogin(page);
    await page.goto(`/criacao/planejamento?modelo=${IMP}`);
    const preco = page.locator('[data-colab-path="preco_venda"]');
    await expect(preco).toBeVisible({ timeout: 15000 });
    await preco.fill("123,45");
    await salvar(page);
    await expect.poll(() => num(`SELECT preco_varejo_fixo AS v FROM public.produtos_importados WHERE modelo_id = $1`, [IMP]), { timeout: 15000 }).toBe(123.45);
    const mo = page.locator('[data-colab-path^="mo:"]').first();
    await expect(mo).toBeEnabled();
    await mo.fill("7,77");
    await salvar(page);
    await expect.poll(async () => (await sql<{ v: boolean }>(
      `SELECT coalesce(bool_or(valor = 7.77), false) AS v FROM public.modelo_servico_mo WHERE modelo_id = $1`, [IMP]))[0]?.v, { timeout: 15000 }).toBe(true);
    expect(await num(`SELECT preco_venda AS v FROM public.modelos WHERE id = $1`, [IMP])).toBe(123.45);
  });

  test("(b) Produto Acabado: renomear no card chega ao modelo (mão dupla, P-88 A)", async ({ page }) => {
    await doLogin(page);
    const e = await espelho("produtos_acabados", PA);
    const nome = page.locator(`[data-colab-path="card:${e.id}:nome"]`);
    await abrirCardEspelho(page, "/criacao/produto-acabado", e, PA_NOME, nome, /^1 ·/);
    const novo = `${PA_NOME} QA`;
    await nome.fill(novo);
    await salvar(page);
    await expect.poll(async () => (await sql<{ nome: string }>(`SELECT nome FROM public.modelos WHERE id = $1`, [PA]))[0]?.nome, { timeout: 15000 }).toBe(novo);
    await nome.fill(PA_NOME); // volta o nome (dado da cópia)
    await salvar(page);
    await expect.poll(async () => (await sql<{ nome: string }>(`SELECT nome FROM public.modelos WHERE id = $1`, [PA]))[0]?.nome, { timeout: 15000 }).toBe(PA_NOME);
  });

  test("(c) Produto Importado: Valor varejo grava o fixo no Salvar; Markup varejo depois LIMPA o fixo", async ({ page }) => {
    await doLogin(page);
    const e = await espelho("produtos_importados", IMP);
    const valor = page.locator(`[data-colab-path="card:${e.id}:preco-varejo-fixo"]`);
    await abrirCardEspelho(page, "/criacao/produto-importado", e, IMP_NOME, valor, /^7 · Valores/);
    await valor.fill("199,90");
    await salvar(page);
    await expect.poll(() => num(`SELECT preco_varejo_fixo AS v FROM public.produtos_importados WHERE id = $1`, [e.id]), { timeout: 15000 }).toBe(199.9);
    expect(await num(`SELECT markup_varejo AS v FROM public.produtos_importados WHERE id = $1`, [e.id])).toBeNull();
    await page.locator(`[data-colab-path="card:${e.id}:markup-varejo"]`).fill("2,5");
    await salvar(page);
    await expect.poll(() => num(`SELECT preco_varejo_fixo AS v FROM public.produtos_importados WHERE id = $1`, [e.id]), { timeout: 15000 }).toBeNull();
    expect(await num(`SELECT markup_varejo AS v FROM public.produtos_importados WHERE id = $1`, [e.id])).toBe(2.5);
  });

  test("(d) card do Plan. Produto, importado (n2): preço + ✓ grava o fixo", async ({ page }) => {
    await doLogin(page);
    await page.goto("/criacao/planejamento");
    // o card precisa estar no canvas com os filtros do usuário E2E NA CÓPIA (Step 4 confere antes)
    const campo = page.locator(`[data-colab-path="card-preco:${IMP}"]`);
    await campo.scrollIntoViewIfNeeded();
    await campo.fill("149,90");
    await campo.locator("xpath=..").getByRole("button", { name: "Confirmar preço" }).click();
    await expect.poll(() => num(`SELECT preco_varejo_fixo AS v FROM public.produtos_importados WHERE modelo_id = $1`, [IMP]), { timeout: 15000 }).toBe(149.9);
  });

  test("(e) importado INTEGRÁVEL: trocar a cor de uma variante é recusado (mensagem traduzida) e nada muda", async ({ page }) => {
    page.on("dialog", (d) => void d.accept()); // sair com o rascunho recusado não pode travar a navegação
    await doLogin(page);
    await abrirProdutos(page, IMP_NOME);
    await page.getByRole("switch", { name: `Integrável: ${IMP_NOME}` }).click();
    await page.getByRole("button", { name: "Tenho certeza — integrar" }).click();
    await expect(page.getByText("1 produto integrável.")).toBeVisible({ timeout: 15000 });
    const e = await espelho("produtos_importados", IMP);
    const cores = async () => JSON.stringify(await sql(
      `SELECT ordem, cor_id, cor_apelido_id FROM public.produto_importado_variantes WHERE produto_importado_id = $1 ORDER BY ordem`, [e.id]));
    const antes = await cores();
    const trig = page.locator(`[data-colab-path="card:${e.id}:var-cor:1"]`);
    await abrirCardEspelho(page, "/criacao/produto-importado", e, IMP_NOME, trig, /^3 · Variantes/);
    const atual = ((await trig.textContent()) ?? "").trim();
    await trig.click();
    const opcoes = page.getByRole("option");
    await (atual ? opcoes.filter({ hasNotText: atual }) : opcoes).first().click();
    await salvar(page);
    await expect(page.getByText(/"cores\/variantes" não pode mudar/)).toBeVisible({ timeout: 15000 });
    expect(await cores()).toBe(antes);
    // limpeza: volta a não integrável (descarta o rascunho da tela ao sair)
    await abrirProdutos(page, IMP_NOME);
    await page.getByRole("switch", { name: `Integrável: ${IMP_NOME}` }).click();
    await page.getByRole("button", { name: "Voltar para não integrável" }).click();
    await expect(page.getByText("1 produto voltou para não integrável.")).toBeVisible({ timeout: 15000 });
  });
});
```

```bash
# do CHECKOUT PRINCIPAL: o playwright.config.ts lê o `.env` do cwd (E2E_EMAIL/E2E_PASSWORD — ninguém abre o arquivo); o
# E2E_BASE_URL do shell vence o do `.env`; config e spec vêm da worktree (o spec NÃO é versionado).
cd "/Users/sunglee/PLM + Criação/plm-pcp"
E2E_BASE_URL=http://localhost:5188 E2E_INTEG_ID=<id> E2E_INTEG_NOME="<nome>" \
E2E_INTEG_IMP_ID=<modelo_id do importado> E2E_INTEG_IMP_NOME="<nome>" E2E_INTEG_PA_ID=<modelo_id da revenda> E2E_INTEG_PA_NOME="<nome>" \
  npx playwright test --config ".claude/worktrees/integracao-impl/playwright.config.ts" integracao-qa --workers=1
git status --short                                         # vazio (test-results/ e playwright-report/ estão no .gitignore)
```
Expected: 10 passed (3 da tela + 2 do P-87 + 5 do R7). Depois, o controlador roda o `mobile-ui-auditor`: em 360/390, a rota
`/integracao` (só o aviso) e os SELOS nas outras telas — Sheet do Planejamento, Produto Acabado/Importado e Plan. Tecido com
um produto integrável (0 achado de rolagem horizontal da PÁGINA); em 768 (tablet = tela larga), as abas Produtos, Manual e
Log (a tabela rola dentro do container). Achado ⇒ correção NA WORKTREE (commit
novo + gates) → novo ff (Step 3, com o aviso de novo e SEM o `copia.sh`) → QA de novo. No fim: o produto da QA volta a "não
integrável" (o teste já volta); anotar no `copia-estado.md` o que ficou gravado NA CÓPIA (chave revogada "QA integracao",
linhas do Log); avisar no painel "QA da Integração verde na cópia — pode usar a tela Integração no :5173".

- [ ] **Step 6: G-deploy (guardião) e memória (controlador)**

- O guardião confere a QA verde NA CÓPIA, o ensaio da rota real (Task 20b) e a medição de CPU (D38 — P-89 A: p95 de 50 e de
  100 ≤ 7 ms; padrão 50 nas migrations/`CONFIG_API`), o log do dono (ida + referência), o aviso publicado ANTES do merge e a ordem (banco →
  referência → ensaio → merge + cópia → QA → docs). O deploy é o 2º deploy (P-68 B), `npm run deploy` pelo dono, depois do 1º.
- Na saída do `npm run deploy` (o dono cola no chat): o binding `INTEGRACAO_TETO_IP` (Rate Limit) aparece aceito. Se a conta
  recusar `ratelimits` ⇒ tirar o binding do `wrangler.jsonc` (commit + gates; D23: sem binding = sem teto) e o dono roda de
  novo — nada mais muda.
- Depois do deploy, o controlador confere (SÓ LEITURA, sem chave real): `curl -s -o /dev/null -w "%{http_code}"
  https://sistrama.sung-lee.workers.dev/api/integracao/v1/produtos` ⇒ `401` e o corpo `{"erro":"chave_invalida"}`.
- **Medição REAL (confirma a P-89 A):** o dono gera 1 chave de teste na loja com mais integráveis e chama a API com a página
  PADRÃO (50) enquanto roda `npx wrangler tail sistrama --format json` no Terminal dele; o controlador lê (sem a chave) o
  `outcome` de cada chamada (`"ok"` × `"exceededCpu"`), o CPU time da rota no painel do Cloudflare (Workers → sistrama →
  Métricas) e o `pagina` da resposta (`{"limite":50,"maximo":50}`). `exceededCpu` ou CPU perto de 10 ms com 50 ⇒ P-xx ao dono
  (baixar o máximo da loja na aba API é imediato, sem deploy; ou Workers Paid). Se no futuro o dono subir acima de 100: a tela
  avisa (só com Workers Paid) — medir de novo do mesmo jeito. Revogar a chave no fim.
- Memória: `project_tela_integracao` (FEITO: produção + deploy; contagem = base + 46|+14; volta LIFO; D5/D6/D9/D13/D14/D18/
  D26/D28/D33/D34/D38 comunicadas), `project_preco_fixo_revenda` (o importado ganhou o gravador de preço fixo — D14) e
  `feedback_staging_nada_grava_antes_salvar` (a aba Produtos segue o padrão).

---

## 6. Riscos (e o que o plano faz)

| Risco | Onde aparece | O que o plano faz |
|---|---|---|
| Gatilho de trava bloqueia um fluxo legítimo (BOM, CAD, OC, MO, reset) | salvar/receber/produzir um produto integrado dá erro | trava só nas colunas do §8 (`IS DISTINCT FROM`); suíte 4 cobre OC recebida, MO, gerar SKU e `reset_loja` (Task 4); o `excluir_loja` usa o mesmo apagamento da loja (`_full`) e não tem teste próprio nesta frente |
| Recálculo do preço do comprado reescreve o preço integrado | preço muda depois de integrado | `TRECHO_B1` congela o `preco_venda` do travado (Task 4) + recusa explícita do fixo (D12) |
| Retrato diverge do que a tela mostrou | integrar dado diferente do resumo | assinatura HMAC do retrato do RESUMO; `integracao_marcar` recalcula e compara (P0409 `integracao_mudou`) |
| Resposta da API se perde depois de marcar integrado | ERP não recebe e o produto fica travado | reler com `incluir_integrados=1` (Manual + FAQ); só marca o que a MESMA assinatura confirmou |
| Rajada paralela fura o limite por chave | abuso | reserva do acesso sob `pg_advisory_xact_lock` (V4) + teto do Workers 600/60 (D23) |
| Foto de outra loja ou apagada | vazamento cross-tenant / link quebrado | prefixo `<tenant>/` conferido na rota (inv. #2) → `null` + contagem no acesso; `integracao_salvar` recusa caminho de outra loja |
| Dois editores do mesmo produto (Integração × Sheet) | lost update | `rev` + P0409 + merge 3-vias por campo (Tasks 10/12b); Keywords com conferência do valor carregado (R5) |
| Tela chamando RPC que não existe (merge antes da ida) | `:5173` quebra em produção | a tela só é juntada DEPOIS do "== IDA OK" (Task 25 Step 3); `useIntegracaoEstados` sem retry cai em "sem trava" |
| Volta de emergência | perda de config/chaves/log | `volta-producao.sh` exige `VOLTA_CONFIRMO=apagar-integracao` + backup antes; LIFO entre frentes |
| Dev intocado quebrado sem querer | decisão 8 da campanha | gate em TODO commit (`git diff … savepoint … desenvolvimento/` vazio) |
| A rota REAL da API só rodar de verdade depois da produção (R3) | defeito de SQL/Worker descoberto com o banco do dono já mudado | Task 20b: rota real servida pela worktree (`:5199`) contra a CÓPIA ANTES do RODAR; defeito ⇒ G-migration de novo |
| CPU do Worker estourar (R4/R4-r2) — plano gratuito = 10 ms por consulta | erro da API numa página grande | P-89 A: padrão/recomendado 50 e alerta na tela acima de 100 (faixa segue 1–500 — aumentar é só configurar); medição 50/100/200/500 fora do gate (Task 20b); CPU real com a página 50 no G-deploy (Task 25); a resposta traz `pagina.maximo` e o Manual manda seguir o cursor (D39) |
| Preço do Importado gravando fora do Salvar (R1) | P0409 falso no Salvar seguinte; preço gravado sem o usuário salvar | o preço entra no `_dados` do `salvar_produto_importado` (Task 5) e a tela só muda o rascunho (Task 23) |
| REF do espelho mudando o card depois da Explosão (R2) | SKUs com REF diferente do card | o gatilho só leva a REF ao card com `enviado_cad = false` (Task 5; D13) |
| Trava além do marcado (R8) | atacado travado sem ir na API | trava por campo; atacado e markup atacado livres (Tasks 21/23; D34); o markup atacado reenvia o varejo GRAVADO quando o varejo está travado |
| Bloqueio por IP barrar a chave certa (D18) | ERP do cliente parado por tentativas erradas de terceiros no mesmo IP | o bloqueio só vale quando a chave NÃO casa (Task 6) |
| Criar gatilhos trava tabelas da loja (N1) | `:5188`/produção lentos durante o passo | `CREATE OR REPLACE TRIGGER` nos gatilhos comuns (sem DROP); aviso N3 antes de toda suíte/ida; horário do dono |
| Latente PRÉ-EXISTENTE (fora desta frente): no Sheet do Planejamento, editar o markup ATACADO da revenda reenvia o markup varejo EFETIVO (derivado do preço fixo) e o `salvar_markups_produto_acabado` limpa o preço fixo do varejo | preço varejo fixo vira derivado (arredondado) sem o usuário mexer nele | nesta frente só o caso TRAVADO é protegido (Task 21); o caso geral vai ao dono como pendência (Camada intermediária / preço fixo) |

## 7. Rastreabilidade (requisito → task)

Rótulos por RODADA de revisão (o mesmo número aparece em rodadas diferentes — por isso o prefixo):
**v1** = G-plano do spec 2f7a9310 (`.superpowers/g-plano-integracao-guardiao.md`, 1ª parte) · **d2** = delta v2 do mesmo
arquivo (itens 1–5 e notas 6–12) · **v4** = G-plano delta v4 (`g-plano-integracao-guardiao-v4.md`, 1ª parte) · **v4.1** =
re-conferência (mesmo arquivo, V/n) · **GP** = G-plano do PLANO (`g-plano-integracao-guardiao-plano.md`, R1–R9 e N1–N8).

**Decisões do dono (painel)**

| Requisito | Onde |
|---|---|
| **P-60 B** campos = entram E obrigatórios; ordem fixa | `_integracao_layout` (T1), `_integracao_retrato_core` faltas (T2), catálogo + anti-drift (T9), Campos da API (T14) |
| **P-61 A** 3 origens, qualquer etapa, sem reprovados (D9) | `_integracao_base` (T2), filtros (T12b), `motivoFora` reprovado (T13) |
| **P-62 A** trava no banco dos campos marcados + cores/tamanhos/SKUs | gatilhos `trg_zz_integracao_trava*` (T4), espelho nas telas SÓ nos campos marcados (T21–T24; D34) |
| **P-63 A** trava ao marcar; toggle volta; integrado só super admin desfaz | `integracao_marcar/voltar/desfazer` (T3), Integrar/Voltar/Desfazer (T13) |
| **P-64 A** integrado = a API levou; log de todo acesso; relê integrados | `_integracao_confirmar` + `integracao_acessos` (T6), rota 2 fases (T19), ensaio real (T20b), Manual (T16) |
| **P-65 A** permissão nova, Admin Mestre, menu da loja | catálogo/menu/lojas/rota (T9) |
| **P-66 A** endereço único, chave por loja, mostrada 1×, revogável (v4: só super admin) | chaves (T6), aba API (T15) |
| **P-67 A** fotos por link temporário, lista no fim (D5) | `_integracao_valores` (T6), `assinarFotos` + prefixo (T19/T20) |
| **P-68 B** 2º deploy | Task 25 Step 6 |
| **P-69 A** rota do próprio site no Worker | T19/T20 (`src/routes/api.integracao.v1.produtos.ts`), ensaio contra a cópia (T20b) |
| **P-70 A / P-71 A / P-72 A / P-73 A** desenho aprovado por partes; mockup antes | F1 (T1–T8), F2 (T9–T17, textos do mockup v4; T18 = P-87), F3 (T19–T20b), F4 (T4 + T21–T24) |
| **P-74 A** reprovado integrado segue visível; menu + Admin Mestre; cor sem apelido não bloqueia | `_integracao_base` (T2), menu (T9), "sem apelido — não bloqueia" (T12a) |
| **P-75 A** custo marcado ⇒ só quem vê custos integra | `integracao_marcar` 42501 (T3), `motivoIntegrar`/`TEXTO_PRECISA_CUSTO` (T10), bloqueio do resumo (T13) |
| **P-76 / P-77 / P-78 / P-85** | não citadas no spec v4.3 (decisões de outras frentes) — nada a rastrear aqui |
| **P-79** tudo editável enquanto não integrável; filtro Situação; alerta do layout; manual; config com recomendado | T10–T12b (staging), T12b (Situação), T14 (alerta), T15 (config), T16 (manual) |
| **P-80 A** custo/cor/tamanho só leitura com "i" + abrir card | `modoCelula`/`CelulaCampo` (T12a); "abrir card" só com `canView("criacao_planejamento")` (T12b; GP N6) |
| **P-81 A** Manual (e API/Campos) só super admin | `abasVisiveis` (T9), `_integracao_exige_super` (T2/T6) |
| **P-82 A** modo teste = exemplos fictícios | `_integracao_exemplo` (T6), rota teste (T19), exemplo do Manual (T16) |
| **P-83 A** Foto desmarcada/opcional | `_integracao_layout`/padrão (T1), `CAMPOS_PADRAO` (T9), alerta não dispara p/ Foto (T14) |
| **P-84 A** mockup v4 aprovado | textos verbatim nas Tasks 9–17 e 21 |
| **P-86** ordem da Camada intermediária (depois desta frente) | o card n2 entra no inventário dela (T22 Step 6; GP N8) |
| **P-87** celular não tem a tela | T18 (item escondido em tela estreita + rota com "A Integração é usada no computador"); QA 360/390 (T25) |
| **P-89 A** página da API: padrão 50, alerta acima de 100 (plano gratuito); preparar para aumentar depois | padrão 50 no banco (T1 `DEFAULT`, T2 `_integracao_cfg`) com a faixa 1–500 intacta (T1/T6); `CONFIG_API` recomendado 50 + `alertaPaginaPlanoGratuito` (T9) e o alerta no campo e no diálogo (T15); `pagina: {limite, maximo}` na resposta (T6 SQL, T16 `montarResposta`, T19; D39); Manual em Parâmetros/Boas práticas/FAQ (T16); ensaio com `pagina` (T20b); CPU real com 50 no G-deploy (T25); D38 resolvida |
| **P-88 A** nome/REF nos dois sentidos já a partir do passo no banco | gatilhos da mão dupla (T5; D13), aviso no RODAR (T8 Step 8), E2E (b) (T25) |

**v1 — G-plano do spec (B1, B2, R3–R11, N12–N20)**

| Requisito | Onde |
|---|---|
| **v1 B1** a trava do preço não pode derrubar o recálculo do comprado | `TRECHO_B1` congela o `preco_venda` do travado (T4); recusa explícita do fixo (D12) |
| **v1 B2** SKUs/"Tamanho em"/cores travam SEMPRE | `trg_zz_integracao_trava*` (T4); `SEMPRE_TRAVADO` + SKUs travados no Sheet (T21) |
| **v1 R3** tabelas sem leitura direta | 7 tabelas RLS SEM policy + `REVOKE ALL` (T1); ACL por comando (T7) |
| **v1 R4** custo só para quem vê custos (inv. #12) | máscara no retrato/lista (T2), P-75 (T3), `infoCusto` (T9), resumo (T13) |
| **v1 R5** caminho de gravação da tela | `integracao_salvar` com os gravadores por origem (T5), `salvarIntegracao` em 3 passos (T11) |
| **v1 R6** fotos com service role respeitam a loja (inv. #2) | prefixo `<tenant>/` na rota (T19) e no `integracao_salvar` (T5) |
| **v1 R7** "integrado" só com a entrega feita | 2 fases `_integracao_ler` → `_integracao_confirmar` (T6), ordem ler → fotos → confirmar (T19) |
| **v1 R8** exclusão de produto travado | `trg_zz_integracao_trava*_del` (T4); Excluir travado nas telas (T21, T23) e "Limpar slot" travado (T24) |
| **v1 R9** Sheet do Dev (decisão 8) | Dev intocado (gate do `gates.sh`, T0); recusa traduzida em `erro-mensagem.ts` (T9) |
| **v1 R10** cor apelido × P-60 B | P-74 A (acima) |
| **v1 R11** enxurrada sem chave | registro agregado por (tipo+IP, minuto) (T1/T6; D19); bloqueio por IP só com chave errada (T6; D18) |
| **v1 N12** módulo fora dos interruptores de Gerenciar Lojas | `admin/lojas.tsx` (T9) |
| **v1 N13** gatilho em `modelos` roda por último | nomes `trg_zz_*` (T4) |
| **v1 N14** sem GUC de destravar | destravar = só mudar o ESTADO (T3/T4) |
| **v1 N15** índices | T1 |
| **v1 N16** confirmação ao mudar campos e ao voltar em massa | T14 (campos), T13 (massa) |
| **v1 N17** card "Integração com ERP" | fora do escopo: o card oculto e o doc local ficam como estão (spec §6) |
| **v1 N18** P-74 | P-74 A (acima) |
| **v1 N19** rota da API | T19/T20 (molde `sitemap[.]xml.ts`, import dinâmico do servidor — D30) |
| **v1 N20** testes da §10 | suítes 1–6 (T1–T6), unit (T9–T20b), E2E (T20b, T25) |

**d2 — delta v2 (itens 1–5, notas 6–12)**

| Requisito | Onde |
|---|---|
| **d2 item 1** custo legível direto na tabela | tabelas sem policy (T1) + leitura só por RPC com máscara (T2) |
| **d2 item 2** caminho de gravação da revenda/importado | gravadores por origem no `integracao_salvar` (T5; depois B1a da v4) |
| **d2 item 3** excluir o produto ESPELHO | `fn_integracao_trava_espelho` recusa o DELETE (T4) |
| **d2 item 4** preço fixo explícito recusado | `fn_integracao_trava_espelho` (T4; D12) |
| **d2 item 5** cor apelido (3ª leitura) | foi ao dono: P-74 A |
| **d2 nota 6** assinatura = HMAC, não hash simples | `integracao_segredo` + HMAC do retrato (T1/T2; D10) |
| **d2 nota 7** prefixo das fotos também no banco | `integracao_salvar` recusa caminho de outra loja (T5) + rota (T19) |
| **d2 nota 8** FK de `integracao_produtos`; recusa de exclusão | FK `modelo_id … ON DELETE CASCADE` (T1); a recusa é erro 42501 traduzido (T4/T9) |
| **d2 nota 9** `_integracao_confirmar` reconfere chave/loja; chave errada devolve status (sem RAISE) | T6 |
| **d2 nota 10** aviso repetido do SKU no Sheet | geração pós-Salvar desligada com SKU travado (T21) |
| **d2 nota 11** redação "a API confirmou a entrega" | spec (fora do código) |
| **d2 nota 12** Realtime | Realtime só em `modelos` filtrado pelos ids da página + recarga após cada ação (T11; GP N2) |
| **d2 nota 14** variantes do espelho (conjunto de cores) | CONSTRAINT TRIGGER adiado `trg_zz_integracao_trava_var` (T4; D11) |

**v4 — G-plano delta v4 (B1a–c, R2–R7, N8–N13)**

| Requisito | Onde |
|---|---|
| **v4 B1a** preço do importado nos 3 lugares | gravador novo + `_salvar_produto_importado_core` com o fixo no `_dados` (T5; D14), Sheet n1 + card n2 (T22), tela Importado no Salvar (T23), `integracao_salvar` (T5) |
| **v4 B1b** fotos = `fotos_modelo` | retrato/`integracao_salvar` (T2/T5), `FotosDialog` (T12b) |
| **v4 B1c** nome/REF espelho ↔ modelos | gatilhos `fn_modelo_espelho_nome_ref`/`fn_espelho_modelo_nome_ref` (T5; D13 — REF só antes da Explosão) |
| **v4 R2** gates do card campo a campo | `_integracao_gates` (T2), reconferência no `integracao_salvar` (T5), `modoCelula` (T12a) |
| **v4 R3** modo teste | P-82 A (acima) |
| **v4 R4** Salvar em 3 passos com falha parcial | `salvarIntegracao` (T11) |
| **v4 R5** Keywords só a coluna, com conferência | `integracao_salvar(_keywords)` (T5), `KeywordsDialog` (T12b) |
| **v4 R6** contradições (Manual só super; LER campos; `max_por_pagina`; `modo` na resposta) | T2 (`config_ler`), T6, T16, T19 |
| **v4 R7** limites (lock, índices, 429 não conta, retenção 90 d, teto ≥ 600) | T1 (índices), T6 (`_integracao_ler`, `_integracao_limpar`), T19/T20 (teto, `waitUntil`); CPU medido (T20b; D38 — GP R4) |
| **v4 N8** Foto | P-83 A |
| **v4 N9** padrão nas lojas atuais e no reset | semente na migration 1 + `_seed_tenant_defaults` (T1; D25) |
| **v4 N10** linha travada mostra o RETRATO + "i" | `retrato_difere` (T2), `avisoRetrato` (T10/T12a) |
| **v4 N11** Log por papel | `integracao_log_listar` (T3), `LogAba` (T17) |
| **v4 N12** "Ver resposta de exemplo" sem registrar acesso | `integracao_exemplo()` (T6), `ExemploDialog` (T16) |
| **v4 N13** preço do importado sobrescrito pelo recálculo | resolvido por B1a/D14 (T5, T22, T23) |

**v4.1 — re-conferência (V1–V5, n1–n6)**

| Requisito | Onde |
|---|---|
| **v4.1 V1** gravador da revenda intacto | D12 (T4/T5 — checagem só no `integracao_salvar`) |
| **v4.1 V2** foto com `WHEN` | `trg_sync_foto_modelo_*` (T4; inverso 4 confere os 2 — GP N4) |
| **v4.1 V3** nome do importado chega a `modelos` | gatilho de mão dupla (T5) |
| **v4.1 V4** reserva do acesso sob lock | `_integracao_ler` (T6) |
| **v4.1 V5** resíduos de texto | spec v4.2 (fora do código) |
| **v4.1 n1** Sheet não reenvia preço do importado | T22 (`ehOrigemComprada` + gravador fixo) |
| **v4.1 n2** card do Plan. Produto | T22 (`importadoMap` + gravador do importado) |
| **v4.1 n3** foto pública de exemplo | `public/integracao/exemplo-produto.svg` + `CAMINHO_FOTO_EXEMPLO` (T16/T20) |
| **v4.1 n4** limpeza com escopo, fora do caminho | `_integracao_limpar(_tenant)` (T6) + `depois()`/`waitUntil` (T19/T20) |
| **v4.1 n5** módulo reconferido no `integracao_salvar` | `_integracao_gates` (módulo `criacao` + módulo da origem) (T2/T5) |
| **v4.1 n6** seed do reset diff-validado | `_seed_tenant_defaults` + TRECHO_SEED + md5 (T1/T7/T8) |

**GP — G-plano do PLANO (R1–R9, N1–N8) + recomendações ao dono**

| Requisito | Onde |
|---|---|
| **GP R1** preço do Importado grava no SALVAR (não no blur) | bloco `TRECHO_IMP_FIXO` no `_salvar_produto_importado_core`, mesma transação do `_rev_base` + testes P0409/P0001 (T5); tela só com rascunho + `montarPayload` (T23); D14 |
| **GP R2** REF do espelho só antes da Explosão | `fn_espelho_modelo_nome_ref` com `NOT enviado_cad` + teste (T5); D13; P-88 A no RODAR (T8) |
| **GP R3** rota REAL contra a CÓPIA antes do RODAR | Task 20b (vite próprio na `:5199`, só o próprio PID; spec do ensaio) |
| **GP R4** CPU do Worker | medição 50/100/200/500 em `tests/carga/integracao-api-carga.test.ts` (T20b); D38; `ratelimits` aceito + CPU real no G-deploy (T25) |
| **GP R5** âncora do molde | linha 49 (`8–49`, `sed -n '49p'`) (T8); "11 linhas" (T0) |
| **GP R6** lista COMPLETA das decisões ao dono | D1–D39 no G-migration (T7) e no G-scripts/RODAR (T8) |
| **GP R7** QA de comportamento nas telas já no ar | 5 casos (a)–(e) com o banco conferido só leitura (T25 Step 5) |
| **GP R8** só campos MARCADOS travam | `PrecoTabela`/`PrecoRevendaBloco` por coluna (T21), PA/PI (T23); D34 |
| **GP R9** rastreabilidade por rodada | esta seção |
| **GP N1** trava de tabela ao criar gatilhos | `CREATE OR REPLACE TRIGGER` nos comuns + teste estático (T1/T4/T5); texto do aviso N3 (T0) |
| **GP N2** Realtime da lista | filtro `id=in.(<ids da página>)` (T11) |
| **GP N3** tipo de trava no marcar | `FOR NO KEY UPDATE` (T3) |
| **GP N4** inverso 4 confere a foto do importado | T4 |
| **GP N5** teto dos selos | `integracao_estado_modelos(NULL)` com `LIMIT 5000` (mais recentes) (T2) |
| **GP N6** "abrir card" com permissão | `canView("criacao_planejamento")` (T12b) |
| **GP N7** T12 grande | dividida em T12a/T12b |
| **GP N8** card n2 grava na hora | inventário da Camada intermediária (T22 Step 6) |
| **GP D18** chave válida nunca bloqueada por IP | `_integracao_ler` (T6) + teste; FAQ do Manual (T16) |
| **GP D26** reset apaga a integração, com aviso | opção A + texto no diálogo do Reset (T9) |

**GP-r2 — re-conferência do G-plano do plano (`g-plano-integracao-guardiao-plano-r2.md`)**

| Requisito | Onde |
|---|---|
| **r2 R4-r2** a régua de CPU precisa de saída e cobrir o PADRÃO | RESOLVIDA pela P-89 A (padrão 50, alerta acima de 100); antes: D38 reescrita (padrão E máximo; P-xx com A baixar página · B Workers Paid · C; recomendado ir ao dono antes da T1); medição 50/100/200/500 (T20b); medição real decide no G-deploy (T25) |
| **r2 R10** sem limiar de tempo no gate | medição em `tests/carga/` (fora do `tests/unit` que o `gates.sh` roda) e só imprime (T20b) |
| **r2 n-a** Importado: apagar o Valor com markup vazio mantém o fixo | registrado na D14 para o dono (com a alternativa `_dados ? 'preco_varejo_fixo'`) |
| **r2 n-b** foto com `WHEN` também muda o app já na ida | 1 parágrafo no aviso do RODAR (T8 Step 8) |
| **r2 n-c** `excluir_loja` sem teste | tirado da tabela de riscos (§6): mesmo apagamento do `reset_loja`, sem teste próprio |
| **r2 n-d** bug pré-existente do markup atacado da revenda no Sheet | §6 (latente, fora desta frente); registro fora do plano é do controlador |

**Revisão T1 #1 — revisão da Task 1 (`.superpowers/sdd/2026-09-26-tela-integracao-api/task-1-review.md`)**

| Requisito | Onde |
|---|---|
| **T1 #1** inverso de função EXISTENTE precisa recusar se a função mudou por outra frente depois desta migration (não só conferir o md5 final) | D40; guarda no inverso 1 (T1 Step 6, `_seed_tenant_defaults`), no inverso 4 (T4 Step 4, `_pa_recomputar_precos_modelo`/`_imp_recomputar_precos_modelo`) e no inverso 5 (T5 Step 4, `_salvar_produto_importado_core`); teste de recusa em cada suíte (T1/T4/T5) |
