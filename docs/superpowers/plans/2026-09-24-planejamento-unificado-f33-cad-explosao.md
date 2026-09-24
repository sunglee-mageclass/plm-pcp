# Planejamento unificado — F3.3: CAD, Enviar à Explosão, Ficha Técnica, Importar dados, menu ⋯ e numeração/selos no Sheet do Planejamento — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O Sheet do Planejamento de Produto passa a ter a seção **CAD** do Desenvolvimento (folhas/metragem, consumo espelhando o BOM, cálculo automático) gravada no MESMO Salvar do BOM (decisão F3 #7 — o que tira a trava interina "BOM só-leitura em card com CAD" da F3.2), o botão **Enviar à Explosão** (gate pela posição DERIVADA com a chave ligada + lista "Para enviar, falta" com links), a **Ficha Técnica**, o **Importar dados** e o **menu ⋯** do mockup, a **numeração "N." e os selos de completude** em todas as seções, e perde o atalho "Ver no Desenvolvimento" (2º editor do mesmo BOM) — sem tocar no Sheet do Desenvolvimento nem no `CadTecidosSection`.

**Architecture:** A orquestração do CAD do `PanelContent` do Dev é PORTADA (cópia, Dev intocado) para `src/components/planejamento/planejamento-detail/ficha/`: `ficha-cad.ts` (puro, testado) + `useFichaCad` (estado/carga/sincronia/folhas automáticas), plugado no `useFichaTecnica` da F3.2 (a carga do CAD segue a do BOM; "não salvo", conferência com o servidor e conflito "Tecidos & BOM" passam a cobrir o CAD). O Salvar (`usePlanejamentoSave`) ganha `salvar_cad_completo` entre as etiquetas e a MO, com regra própria (`deveGravarCad`) que evita regravar CAD velho. As ações do rodapé (Enviar à Explosão, ⋯ com Duplicar/Importar/Ficha Técnica/Cancelar Ordem) e a numeração/selos são UI do orquestrador, com regras puras em `envio-explosao.ts`, `importar-ficha.ts` e `selos-secoes.ts`. `CadTecidosSection`, `ImportarDadosDialog` e `PrintFicha` são reusados SEM modificação.

**Tech Stack:** Vite + React 19.2 + TypeScript (strict, `noUnusedLocals:false`) + TanStack Query v5 + supabase-js. Testes: Vitest (`tests/unit`, ambiente node) e Playwright (QA contra a cópia, arquivo NÃO versionado).

**Spec:** `/Users/sunglee/.claude/plans/h-uma-necessidade-de-flickering-lovelace.md` — seção **F3.3** ("`useFichaCad` (sync BOM↔CAD, folhas automáticas), `CadTecidosSection`, Enviar à Explosão (`enviar_modelo_para_cad`), Ficha Técnica (`PrintFicha`), Importar dados, trava `enviado_cad` só nas seções vindas do Dev. Menu ⋯ p/ Duplicar/Importar/Ficha (§L). Remover o atalho 'Ver no Desenvolvimento'"), "10 decisões de F3 APROVADAS" (#1, #7, #8 aqui), regra de derivação "gates por posição … usam a posição DERIVADA" (decisão travada 10), "Comportamentos do Dev a portar" (sync BOM↔CAD + folhas, destaque do Importar, pós-envio). Contexto comum: `.superpowers/sdd/2026-09-22-unificacao-kanban-auto/planner-context-f3.md`. Planos das fases anteriores (fonte das interfaces): `docs/superpowers/plans/2026-09-23-planejamento-unificado-f31-campos.md` (§5 "Todas" e §7 T2 adiaram numeração/selos para cá) e `…-f32-bom.md` (§2 "Pontos que a F3.3 edita", §5 R1, §7 D2). Mockup aprovado: `…/scratchpad/canvas-unif/gen_main.py:31-124` (seções 1–15 numeradas, selos, rodapé com ⋯), `gen_anotado.py:130-203` (CAD, rodapé), `gen_prova.py:27-50` (decisão 7 e comportamentos), `gen_rest.py:9-49` (mobile).

## Global Constraints

**Repositório, worktree e ordem das fases**
- Worktree própria: `/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f33-cad-acoes`, branch `f33/cad-acoes`, **criada da PONTA de `f32/ficha-bom` DEPOIS do G-commit da F3.2** (sha passado pelo controlador da F3.2; fica em `.superpowers/f33/BASE`). A F3.3 escreve por cima do texto FINAL da F3.2 (âncoras conferidas na Task 0 Step 3). Caminhos relativos neste plano = raiz da worktree.
- **Ruling (R3a do G-plano F3.3, 24/set) — nascer ANTES do G-commit da F3.2:** permitido. A F3.3 nasce da ponta ATUAL de `f32/ficha-bom` (commitada; `BASE` = esse sha) e **refaz o rebase quando a F3.2 fechar** (`git rebase --onto <ponta final da F3.2> <BASE> f33/cad-acoes`, novo `BASE`, Task 0 Step 3 em modo re-checagem, gates e re-revisão das tasks afetadas — procedimento na Task 0 Step 5). Custo registrado: 1 rebase a mais com conflito provável nos 7 arquivos que a F3.2 ainda mexe (`ficha/useFichaTecnica.ts`, `ficha/useFichaBom.ts`, `usePlanejamentoSave.ts`, `save-ficha.ts`, `ficha/ficha-calc.ts`, `PlanejamentoDetail.tsx`, `PrecoTabela.tsx` — os mesmos que a F3.3 edita), recontagem das âncoras, gates completos e re-revisão Opus das tasks já feitas cujo arquivo mudou; o controlador anota tudo em `.superpowers/f33/rebase-f32.md`. Ponta da F3.2 em 24/set, ao aplicar estas ressalvas: `ebb371d` (T13 + fix round 3); ainda virão commits (fix round 4 e as tasks finais).
- Ordem de merge da campanha: F3.0 → F2 e F3.1 → F3.2 → **F3.3** → F3.4. A F3.3 junta SEMPRE depois da F3.2 (carrega os commits dela, que carregam os da F3.1 — `descricao_produto` precisa estar em produção antes), com `git rebase --onto feature/plan-tecido-a1 "$(cat .superpowers/f33/BASE)" f33/cad-acoes` (Task 13 Step 5).
- Merge só por fast-forward, com o dono avisado para salvar e fechar os cards do Planejamento/Desenvolvimento no `:5173` E no app de teste `:5188`.
- `git add -- <paths>` + `git commit --only -m "…" -- <paths>`; nunca `git add .`. Toda mensagem termina com `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Sem push.
- ⛔ **PROIBIDO `git stash`** (a pilha é COMPARTILHADA entre as worktrees — já aconteceu 2×). Para comparar linha de base, use os números da Task 0 ou um commit WIP na SUA branch.
- `src/routeTree.gen.ts` é gerado pelo build: nunca entra em commit (`git checkout -- src/routeTree.gen.ts` depois do build).

**Intocáveis (decisão travada 8 e escopo)**
- NADA em `src/components/desenvolvimento/**` (inclui `importar/`) nem em `src/components/producao/**` (inclui `cad/CadTecidosSection.tsx`, `cad/types.ts`, `PrintFicha.tsx`) nem em `src/components/shared/ModeloObservacoes.tsx`. Importar deles (sem editar) é permitido. **Nenhuma cópia foi necessária:** `CadTecidosSection` já tem `readOnly`/`hideSeparar` (`CadTecidosSection.tsx:17-24`), `ImportarDadosDialog` e `PrintFicha` são só-props (`ImportarDadosDialog.tsx:21-24`, `PrintFicha.tsx:16-24`). Se, ao executar, algo exigir mudar componente do Dev: PARE, faça CÓPIA em `planejamento-detail/ficha/` e registre (decisão 8).
- NADA em `src/lib/kanban-condicoes.ts` (catálogo/`CondicaoSecao`), `src/lib/artigo-label.ts`, `supabase/**`, `tests/integration/**`, `tests/fixtures/**`.
- Sem migration e sem DDL. Leitura de banco só: SELECT em `BEGIN READ ONLY` na cópia local `postgresql://postgres:postgres@127.0.0.1:54422/postgres` e o snapshot só-leitura da Task 11 (produção, `default_transaction_read_only=on`).
- Fora de escopo (NÃO fazer): revenda/importado (Origem "Importado", grade única, `revendaCampoVisivel` nas seções do BOM/CAD, Enviar à Explosão de comprado) = F3.4; o apagamento dos ajustes da Explosão pelo `salvar_cad_completo` (decisão F3 #7: tarefa própria, SÓ no banco ou depois da F5); selo da etapa no header / "Mover para…" (F3.1b); o `salvar_cad_completo` não gravar `cad_tecido_variantes.complementa_variante_ids` (bug PRÉ-EXISTENTE, também no Dev — §6 R12; candidato à tarefa de banco da F3 #7).

**Regras de gravação (o coração da F3.3)**
- CAD só por `salvar_cad_completo` (a mesma RPC do Dev, `ModeloDetailPanel.tsx:2092-2118`), SEMPRE depois de `salvar_modelo_bom` e das etiquetas e antes da MO, no MESMO Salvar.
- **Quando gravar o CAD = `deveGravarCad` (ficha-cad.ts):** ficha editável (carregada, com permissão, sem trava pós-Explosão) E o CAD carregado E há linha a gravar E (o CAD já existe OU a Ordem de Criação já foi enviada — D2) E (o BOM/CAD foi tocado OU é a 1ª tentativa sem recarga em curso). Paridade com o Dev ("todo Salvar regrava") com a guarda contra estado velho.
- `salvar_cad_completo` APAGA e re-insere `cad_tecidos`/variantes/aviamentos/etiquetas e, com grade, `cad_grades` E `modelo_grades` (funcoes.sql:6779-6810): nunca gravar com o CAD não carregado nem com lista vazia.
- Toda edição de consumo/%loss/artigo no Sheet leva o valor ao BOM E ao CAD em memória (Tecidos → CAD; CAD → Tecidos; Importar → os dois) — é o que sustenta a retirada da trava (§3).
- A etapa (`status_desenvolvimento`) NUNCA vai no Salvar (decisão travada 13). Sem `canEdit("criacao_desenvolvimento")` nada do Dev grava (decisão F3 #8) — as RPCs `salvar_cad_completo`/`enviar_modelo_para_cad` só checam o módulo `criacao` (funcoes.sql:15224, :11262): o front é quem barra.

**Gates (todo commit de código)** — `bash .superpowers/f33/gates.sh` (criado na Task 0 Step 4) → `GATES F3.3: ok` e código 0. Ele roda: `npx tsc --noEmit` (0 erro — o build NÃO faz type-check); `npm run build`; `env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit` (mesmas falhas herdadas da Task 0, nada novo); Dev intocado (`git diff --name-only savepoint-pre-unificacao-2026-09-22 -- src/components/desenvolvimento/ src/components/producao/cad/CadTecidosSection.tsx` VAZIO) e intocáveis desde o BASE; o 5º gate **F3.1 preservada** (`gate-f31.sh`, herdado da F3.2) e o 6º gate **F3.2 preservada** (`gate-f32.sh`, novo). Gate falhou = PARE, não commitar. `tests/integration/*` PROIBIDO aqui (cairia em `/tmp/dburl.txt` = PRODUÇÃO).

**QA — CONTRA A CÓPIA (o MESMO modo da F3.1/F3.2)**
- App de teste PRÓPRIO da worktree: variante do `banco-local/app-teste` gerada pelo `criar-variante.sh`, na porta **`:5184`** (a Task 12 acrescenta `5184` ao `case` do script, com backup). Supabase LOCAL `127.0.0.1:54321`. Guarda do vite (aborta se qualquer URL não for local; raiz = a worktree). **NUNCA `:5173`, `:5185`, `:5186`, `:5187`, `:5188` (nem `:5198`/`:5199`)** para subir, derrubar ou testar com escrita (o `:5173` do dono só é LIDO no smoke pós-merge — Task 13 Step 6 —, sem derrubá-lo); nunca `npm run dev` + `VITE_*` (o worker leria o `.env` de PRODUÇÃO).
- **Guarda de rede INVERTIDA** no spec: gravação liberada SÓ para `127.0.0.1:54321`; QUALQUER requisição a `*.supabase.co` (GET inclusive) reprova. O teste automático simula as escritas (`route.fulfill`); os fluxos que GRAVAM (E1–E4) rodam na cópia, um por vez, com o OK do dono item a item.
- `E2E_BASE_URL`, `VITE_SUPABASE_URL` e `F33_ALVO` (`copia` → `http://localhost:5184` + `http://127.0.0.1:54321`; `producao` → `http://localhost:5173` + `*.supabase.co`) SEMPRE explícitos; sem eles o spec FALHA (sem fallback de host).
- Barradas esperadas (as MESMAS da F3.1/F3.2): `POST /rest/v1/rpc/servicos_financeiro` (NUNCA em `READ_RPCS`) e o broadcast REST do Realtime. Loja conferida pelo tenant_id `37889b78-fffb-404b-8c75-18b7e50a1d9b` (o robô NÃO troca de loja).
- Produção: só o snapshot só-leitura (Task 11) e o smoke SÓ-LEITURA pós-merge no `:5173` (Task 13 Step 6).
- Nunca rodar junto com o E2E da F2 nem com QA de outra fase (mesmo usuário; Realtime REAL na cópia).

**UI (padrões §A/§G/§L/§Q)**
- Seções vindas do Dev: SEMPRE visíveis (independente da etapa) p/ `canView("criacao_desenvolvimento")`, recolhidas, editáveis com `canEdit(...)`; travadas pós-Explosão até "Editar" (decisões F3 #1/#8). Só produto interno (comprado = F3.4).
- Rodapé (mockup `gen_main.py:118-124`): Voltar · Excluir · [Para enviar, falta…] · ⋯ · [Enviar Ordem de Criação | Enviar à Explosão] · [Editar] · Salvar. Menu ⋯ = `Popover` (precedente `ProdutoCard.tsx:505-560`): Duplicar · Importar dados · Ficha Técnica ("após Enviar") · ── · Cancelar Ordem de Criação.
- Componentes novos no nível do MÓDULO; sem hex/oklch/hsl solto, sem `.toFixed(`, moeda só por `brl()` (anti-drift `tests/unit/ui-padroes-antidrift.test.ts`). Textos PT-BR; erros por `mensagemErro()`; ação sensível com AlertDialog.
- Selo com valor em R$ (Preço, Mão de obra) só p/ quem vê custos (invariante #12 — o selo aparece com a seção fechada).

**Modelos e comunicação**
- Sonnet implementa; Opus revisa (lotes e individuais em §5). Não despachar subagentes dentro de uma task. Avisos ao dono por CHAT (sem `ExitPlanMode`).

---

## 1. Fatos verificados (24/set/2026, só leitura)

**Dev e componentes reusados (blobs iguais no checkout principal e na worktree f32):** `ModeloDetailPanel.tsx` = `fb5c34b3…` (3300 l.); `CadTecidosSection.tsx` = `d791e8ad…` (160 l.); `producao/cad/types.ts` = `2ce6c86b…`.

| Faixa do Dev (`ModeloDetailPanel.tsx`) | O quê | F3.3 |
|---|---|---|
| 516-546 | queries do CAD (`dev-cad-row`, `dev-cad-tecidos` c/ embed de artigo e rótulos, preço congelado) | porta: 1 query embutida `plan-ficha-cad` |
| 567-570, 675 | estado do CAD (`cadTecidosState`, `autoFolhas`, `cadSeeded`), reset por modelo | porta (`useFichaCad`) |
| 1040-1174 | carga do CAD: do `cad_*` + mescla blocos/variantes do BOM que o CAD não tem; sem CAD, semeia do BOM | porta (`hidratarCad`) |
| 1176-1211 / 1212-1220 | `updateCadTec` (CAD→BOM de consumo/%loss) / `updateCadVar` | porta (+T5, T6) |
| 1222-1269 | folhas/metragem automáticas (`gradeEfetivaPar`) | porta (`calcularFolhasAuto`) |
| 1271-1312 | rótulos de TODAS as variantes dos blocos | porta (`plan-ficha-cad-rotulos`) |
| 1280-1295 | `cadFalta` (consumo / largura / metragem planejada) | porta (`faltasCad`) |
| 1314-1386 | sincronia BOM→CAD das variantes | porta (+T4) |
| 1405-1413, 1576-1598 | gate de envio por etapa + "Para enviar, falta" + `canEnviarCad` | porta (`envio-explosao.ts`) |
| 1600, 2273, 3191-3194 | `locked`, Salvar re-trava, "Editar" | já na F3.1 (trava única) |
| 2062-2119 | Salvar grava o CAD (`salvar_cad_completo`, qtd = consumo × grade total, `enviar_por_tamanho: {}`, `_observacoes_molde: null`) sempre que `cadTecidosState.length > 0` | porta (`montarCadPayload` + `deveGravarCad`) |
| 2248-2272 | invalidações pós-save do CAD/Explosão/Ficha | porta (`invalidarAposGravarCad`) |
| 2328-2350 / 2357-2377 / 2379-2400 | Importar: `aplicarPatch` / `overwritesDoPatch` / `onCopiar` (obs. bloco grava na hora) | porta (`importar-ficha.ts`, `useImportarDados`) |
| 2402-2433 | `enviarCad` = `persistModelo()` + `enviar_modelo_para_cad` + pós-envio | porta (`useEnviarExplosao`) |
| 2441-2456 | propagação BOM→CAD no `updateBlock` | porta (em `useFichaBom`, +artigo — T4) |
| 2732-2736, 3107-3119, 3125-3200, 3202-3219, 3239-3259, 3261-3265 | botão Importar, pendências mobile, rodapé, confirmação do envio, diálogos do Importar, `PrintFicha` | porta (UI do orquestrador) |

**Banco** (snapshot `savepoints/2026-09-22-pre-unificacao/funcoes.sql`; F1 em `supabase/migrations/202609301{3,4}0000_*`):
- `_salvar_cad_completo_core` (funcoes.sql:6702-6883): cria o `cad` se não existe (:6772-6777); APAGA `cad_tecidos` (cascata variantes)/`cad_aviamentos`/`cad_etiquetas` (:6779-6781); com grade, APAGA e regrava `cad_grades` **e `modelo_grades`** (:6797-6810), preservando a grade real se o CQ está confirmado; poda variantes (:6851); grava `modelos.proporcoes` (:6853); `observacoes_molde = _observacoes_molde` sem COALESCE (:6874); **devolve consumo/%loss do CAD ao BOM** (`UPDATE modelo_tecidos … = ct.consumo_cad`, :6878-6881). Wrapper `salvar_cad_completo` só checa o módulo `criacao` (:15217-15226).
- `enviar_modelo_para_cad` (funcoes.sql:11255-11264) só checa o módulo; o core foi redefinido pela F1 (`20260930140000_kanban_auto_3_motor.sql:806-904`) com o gate de etapa sobre `_kanban_status_gate` (:842 — posição DERIVADA com a chave ligada, decisão 10; `20260930130000_kanban_auto_2_derivacao.sql:453-481`). Com o CAD já existente é idempotente: só grava Obs. Técnicas/Ficha de Medida (COALESCE) e `enviado_cad = true`.
- `cad.modelo_id` → `modelos` é **NO ACTION** (`confdeltype = 'a'`) e `modelos` não tem gatilho de DELETE além da auditoria: **modelo com CAD não se exclui** (23503 → "este registro está em uso…", `erro-mensagem.ts:12/:40`). Hoje há **0 modelos com CAD e sem Ordem de Criação** (SELECT na cópia) — base da D2.
- **Produção ainda SEM a F1** (conferido pelo guardião no G-plano F3.3, 24/set): lá existem `enviar_modelo_para_cad`, `salvar_cad_completo` e `_explosao_envio_gate`, mas NÃO `_kanban_status_gate` (F1 em "AINDA NÃO"); `_salvar_cad_completo_core` tem o mesmo md5 na cópia e em produção (`8f1455c3`). O plano trata a ausência sem nada novo: `useFichaKanban` lê `tenant_config` com `select("*")` ⇒ sem a F1 a coluna `kanban_automatico` vem ausente ⇒ chave DESLIGADA (`useFichaKanban.ts:4`; `lerKanbanAutoConfig` = `tc?.kanban_automatico === true`, `kanban-auto.ts:75`) ⇒ `gateEnvioExplosao` não entra no "carregando" e `statusParaGate(false, …)` devolve o status GRAVADO (`kanban-auto.ts:226-229`) — o mesmo que o `enviar_modelo_para_cad` pré-F1 de produção confere. O front da F3.3 NUNCA chama `_kanban_status_gate` (só o SELECT de escolha de cards da Task 12, na CÓPIA, onde a F1 está aplicada; o SELECT do smoke da Task 13 Step 6 não o usa).

**Cópia local (SELECT só-leitura, 24/set):**
- F1 aplicada (`_kanban_status_gate` existe); coluna `modelos.descricao_produto` presente; Loja Teste com **`kanban_automatico = true`**, requisitos `{aprovado:[servico_aprovado], em_negociacao:[linha_definida], desenho_tecnico:[ordem_criacao_enviada]}`, `explosao_envio_status` vazio (⇒ "aprovado").
- Loja Teste, internos com Ordem: **"Blusa Teste" (em_ajuste, com CAD, não enviado) tem o gate DERIVADO = aprovado ⇒ pode enviar** (fixado em coluna manual, decisão 10) — único candidato real para o envio; com CAD e não enviados: "Novo modelo (Plan. Tecido) QA" (em_modelagem), "Winter Blusa Teste" (corte_piloto_2); sem CAD e com Ordem: "Blusa Teste" (prova_roupa_1), "Vestido Teste"; sem Ordem: "Vestal", "Blusa Teste"; enviados: 5.
- Cards para o QA (SELECT só-leitura, 24/set — o Step 1 da Task 12 recalcula): COM CAD, Ordem, não enviado, etapa antes da de envio = "Novo modelo (Plan. Tecido) QA" `9b360f73…`, "Winter Blusa Teste" `ad461143…`; gate derivado ok = "Blusa Teste" `f68de1f4…` (REF `BL0001`, datas, grade 350); sem Ordem e sem CAD = "Blusa Teste" `ec2713ae…`, "Vestal" `fed14751…`; enviados = "Blusa do Teste 1" `28072185…`, "Vestal" `1494e80b…`; Ordem sem CAD = "Vestido Teste" `dcb5f6f9…`.
- Embed do CAD sem ambiguidade: exatamente 1 FK em `cad_tecidos → cad`, `cad_tecidos → artigos`, `cad_tecido_variantes → cad_tecidos`, `cad_tecido_variantes → variantes_tecido`. Escalas: `quantidade_folhas` INTEGER; `metragem_planejada`/`metragem_enviada`/`tamanho_folha`/`custo_cad` NUMERIC(10,2); `consumo_cad` NUMERIC(10,4); `loss_percent_cad` NUMERIC(5,2); `multiplicador` NUMERIC.
- Colab: `salvar_cad_completo` faz `UPDATE modelos SET proporcoes` (funcoes.sql:6853) ⇒ sobe o `rev` do modelo (`trg_colab_rev` em `modelos`); edições da Explosão em `cad_*` sobem só o `rev` do `cad` (`trg_colab_rev_cad`, `trg_colab_bump_cad_*`) — o canal do Sheet (em `modelos`) não as ouve (§6 R2).
- Deriva já existente: 1 linha (1 modelo) com consumo/%loss do CAD ≠ BOM; **24 linhas de `cad_tecidos` sem par no BOM** (tecido tirado do BOM depois do CAD); 3 modelos com tecido do BOM sem linha no CAD e 17 variantes do BOM sem variante no CAD (o Dev só leva ao CAD na carga seguinte); 9 `cad_grades` ≠ `modelo_grades`; 57 de 214 internos enviados.

**F3.2 (worktree `f32-ficha-bom` @`b6ee068`: Tasks 1–11 feitas, T7/T9/T10/T11 com fix rounds; 12–16 pelo plano `b86461f`. Atualização 24/set, R3 do G-plano F3.3: ponta = `ebb371d` — T12 `b18a2f1`, T13 `083ad1f`, fix round 3 `ebb371d`; o guardião conferiu 23 âncoras em `b18a2f1`; a recontagem da Task 0 Step 3 em `ebb371d` deu tudo = 1 exceto `saveEmVooRef`, que o fix round 3 trocou pelo CONTADOR `saveEmVooContadorRef` — âncora e código da Task 5 já trocados aqui. As linhas `:N` abaixo são de `b6ee068` — valem as âncoras de TEXTO, recontadas na hora de começar):** fix round 2 trouxe `saveEmVooRef`/`marcarSaveEmVoo` (o eco do PRÓPRIO save não confere; fix round 3: contador `saveEmVooContadorRef`, "em voo" = `> 0`), `prefillPendenteRef` (BOM vazio pré-preenchido grava sem toque), `enviadoNaCaptura`/`retryBloqueadoPorEnvio`, `invalidarBom` no `FichaSave` e o arredondamento pelo expoente; `useFichaDados.ts` — `qCad` só lê o id (`:235-243`), `bomFetching` cobre 5 queries e é declarado ANTES de `qCondicoes`/`qCad` (`:222-223`), `chavesBomServidor` = as 5 keys (teste da F3.2 exige exatamente 5); `ficha-calc.ts` — `deveHidratarCarga` (`:59-73`), `BomCapturado` (`:363-374`), `assinaturaBom` na escala do banco (`roundNumeric` privado, `:405-413`); `useFichaBom.ts` — `updateBlock` tem o marcador `// (Dev :2441-2456 — propagação BOM→CAD — entra na F3.3 junto com o CAD.)` (`:213`), `cargaSeq` é interno (`:60`), `marcarTocado` não é exportado (`:71-75`); `useFichaTecnica.ts` — `HANDLERS_NOOP` (`:40-54`), `podeEditarRef` (`:177-178`), `bomGravado` (fix T10 m1: referência do BOM = enviado logo após o `persistirBom`), trava "cad" em `:166-171`; `usePlanejamentoSave.ts` — `fichaRef` (`:83-84`), `capturar` em `:104`, `persistirBom` + `bomGravado` em `:216-223`, MO em `:263`; `BomSecoes` recebe `proporcoes` e `onAbrirDev` (`PlanejamentoDetail.tsx:986-993`). Plano F3.2 §2 "Pontos que a F3.3 edita": `updateBlock`, `motivoSomenteLeitura` (tira "cad"), `usePlanejamentoSave` (CAD entre etiquetas e MO). Plano F3.2 Task 9/11/12: `BomSecoes(…onAbrirDev)` com "Abrir no Desenvolvimento", `PrecoTabela(onVerDev)` com "ver no Desenvolvimento ⧉".

**F3.1 (worktree `f31-planejamento-campos` @`c601ce0`):** trava única `enviadoCad`/`editandoDev`/`devBloqueado`/`motivoTravaDev` (`PlanejamentoDetail.tsx:156-159`), "Editar" no rodapé (`:1228-1239`), `aoSalvar` re-trava (`:649`); `useFichaKanban` lê `tenant_config` com `select("*")` (tem `explosao_envio_status`) e expõe `derivacao`/`condProntas`/`statusSalvo` (`useFichaKanban.ts:43-93`); **numeração "N." e selos de todas as seções adiados para a F3.3** (plano F3.1 §5 linha "Todas" e §7 T2). "Ver no Desenvolvimento" = `verDevModeloId` (`PlanejamentoDetail.tsx:219-221`, `:1287-1304`, import `:54`) + `PrecoTabela` `onVerDev` (`PrecoTabela.tsx:34, :39, :123`). Rodapé atual: `:1175-1244` (Duplicar `:1189-1194`, Ordem/Cancelar Envio `:1195-1226`).

**Mockup:** rodapé Voltar · Excluir · ⋯ · Enviar à Explosão · Salvar (`gen_main.py:118-124`); ⋯ = Duplicar · Importar dados · Ficha Técnica "após Enviar" · ── · Cancelar Ordem de Criação (`gen_main.py:108-116`); "Enviar Ordem de Criação (antes de enviar)" (`gen_anotado.py:200`); seções 1–15 numeradas com selo à direita e chip "do Desenvolvimento" (`gen_main.py:31-106`; mobile `gen_rest.py:9-26`); o Dialog "Novo Modelo" numera só "1."/"2." (`gen_novo.py:13-20` — ver T17).

## 2. Interfaces entre fases

**Consumidas da F3.2 (texto FINAL, conferido na Task 0 Step 3):** `useFichaTecnica(...)` → `FichaTecnica` (`habilitada`, `carregado`, `podeEditar`, `motivoSomenteLeitura`, `dados`, `estado`, `handlers`, `selos`, `camposCopiados`/`onCampoEditado`/`marcarCopiados`, `colab`, `dirty`, `save: FichaSave` com `capturar`/`bomGravado`/`aposSalvar`/`bomMudouNoServidor`); `useFichaBom` (`blocks`, `grades`, `colecoesTouchadasRef`, `estadoRef`, `descartarEdicoes`, `aoRecarregarComTocado`, `cargaSeq` interno); `useFichaDados` (`chavesBomServidor` = 5 keys, `chavesFichaBom` = 5 + 3 com `plan-ficha-cad`, `cadExiste`, `cadFetched`, `cadErro`, `bomFetching`, `artigoMap`, `frozenPrecos`, `tecidosData`); `useFichaGuarda`; `ficha-calc` (`BomCapturado`, `EstadoBom`, `snapshotBom`, `assinaturaBom`, `montarAviamentosPayload`, `montarGradesPayload`, `deveHidratarCarga`); `persistir-bom` (`persistirBom`); `SecaoBom`, `BomSecoes` (`proporcoes`, `onAbrirDev`), `selos-bom` (`SeloSecao`, `requisitosUniao`); na cadeia do Salvar (`usePlanejamentoSave`, via `fichaRef`): `const bom = fichaRef.current.capturar(d.custos_adicionais);` e `await persistirBom(modeloId, bom);` + `fichaRef.current.bomGravado(bom);`.
**Consumidas da F3.1:** `enviadoCad`, `editandoDev`/`setEditandoDev`, `devBloqueado`, `motivoTravaDev`, `aoSalvar`, `useFichaKanban` (`kanbanCfg`, `revendaCfg`, `derivacao`, `condProntas`, `statusSalvo`), `DevEquipeSection`, `AvisoCamposDev`.
**Produzidas (F3.4 usa):** `FichaTecnica` ganha `cad`, `seloCad`, `cadGravavel`, `cadAntesDaOrdem`, `aplicarImportacaoBom`; `useFichaTecnica` ganha o argumento `ordemEnviada`; `numerarSecoes`/`selosSecoesSheet` (`selos-secoes.ts`) com as chaves `produto_acabado`/`grade_revenda` já previstas; `Secao` ganha `id`/`numero`/`selo`/`chip`. A F3.4 decide Enviar à Explosão/CAD para comprado (hoje: não aparecem — `ficha.habilitada` exige interno).

## 3. Prova — a trava interina "tem CAD" pode sair com a F3.3

**P0 (por que existia — F3.2 §5 R1).** `_salvar_cad_completo_core` termina com `UPDATE modelo_tecidos SET consumo = ct.consumo_cad, loss_percent = ct.loss_percent_cad` (funcoes.sql:6878-6881) e o Dev regrava o CAD em TODO Salvar (`ModeloDetailPanel.tsx:2067-2118`) com o CAD semeado de `cad_*` (`:1079-1109`). Um consumo gravado no BOM pelo Planejamento SEM regravar o CAD voltava ao valor do CAD no próximo Salvar do Dev, e a Explosão (que lê `cad_tecidos`) ficava desalinhada.

**P1 (em memória, BOM e CAD sempre com o mesmo consumo/%loss/artigo).** Toda edição no Sheet passa por um de 3 caminhos, e os 3 levam o valor às duas estruturas: (a) seção Tecidos → `useFichaBom.updateBlock` → `aoMudarBloco` → `propagarBlocoParaCad` (porta Dev :2441-2456; + artigo, T4); (b) seção CAD → `useFichaCad.updateTec` → `atualizarLinhaCad` + `useFichaBom.aplicarConsumoDoCad` (porta :1187-1210); (c) Importar → `aplicarImportacaoBom` → `propagarBlocoParaCad` por bloco (T3 — o Dev não faz e tem esse buraco). Provas: `tests/unit/ficha-cad.test.ts` ("propagação"), QA S2. **Limite (R2 do G-plano F3.3):** P1 vale a partir de uma EDIÇÃO feita no Sheet. Não cobre (a) a deriva BOM × CAD que JÁ vem do servidor (na cópia: MACACÃO CONSUELO, BOM 0 × CAD 3 — a "1 linha" do §1) nem (b) o "Descartar" depois de uma falha do CAD (P6). Nos dois, o próximo Salvar SEM toque — no Planejamento ou no Dev — regrava o CAD com o consumo DO CAD e o `salvar_cad_completo` o devolve ao BOM em silêncio (funcoes.sql:6878-6881). É paridade com o Dev (§6 R11); QA S7(b).

**P2 (mesmo Salvar: se o BOM grava, o CAD grava).** O BOM grava quando tocado e sujo, ou com o pré-preenchimento pendente (F3.2, fix round 2); a captura do CAD passa `tocado = ficha tocada OU o BOM grava` e `deveGravarCad` devolve `true` sempre que `tocado` (com a ficha editável, o CAD carregado e linha a gravar). As exceções não têm o que desfazer: `linhas = 0` ⇒ o servidor não tem `cad_tecidos` (linha com `id` nunca sai da lista — T4); "antes da Ordem e sem CAD" (D2) ⇒ não existe CAD. Prova: tabela de `deveGravarCad` + teste "bom.gravar ⇒ gravarCad" em `ficha-cad.test.ts`.

**P3 (ordem da cadeia).** UPDATE `modelos` (`.eq("rev")`) → `salvar_modelo_bom` → etiquetas → **`salvar_cad_completo`** → MO → `marcar_revisao_por_mudanca`. O CAD roda DEPOIS do BOM: grava `cad_tecidos.consumo_cad` = consumo novo, e o `UPDATE modelo_tecidos … = ct.consumo_cad` escreve no BOM o MESMO valor (no-op). Provas: QA S3 (ordem e corpo das chamadas) e E1 (SELECT: `modelo_tecidos.consumo = cad_tecidos.consumo_cad = novo`).

**P4 (o Dev depois não desfaz).** O Dev relê `cad_*` ao abrir (`:1079-1109`) → `consumo_cad` = novo → o Salvar dele grava o novo. Prova: QA E1 parte 2 (Salvar no Desenvolvimento sem mexer → SELECT: consumo segue o novo).

**P5 (retry do P0409).** Tocado + BOM/CAD do servidor iguais (R5/R5a da F3.2 + a referência do CAD — `cadDivergeDaReferencia`, §7 T7) ⇒ o retry grava BOM e CAD juntos (P2); tocado + servidor mudado ⇒ conflito "Tecidos & BOM", nada grava; sem toque ⇒ nem BOM nem CAD no retry (nada a desfazer). Prova: QA S6. **Rev novo SEM toque, antes da recarga (R1 do G-plano F3.3):** o merge avança o `revRef` (PlanejamentoDetail.tsx:625) e só depois chama `aoMudarNoServidor` (:636), que invalida o BOM (useFichaTecnica.ts:361); o `bomFetching` só vira true no render SEGUINTE, e o CAD só re-hidrata um render depois de a carga do BOM subir o `cargaSeq`. Nessa janela um Salvar passaria no `.eq("rev")` e regravaria CAD/consumo/grade VELHOS por cima dos de outra pessoa. Fecha com o `cadVelhoRef` SÍNCRONO (marcado no `aoMudarNoServidor` sem toque, zerado no `aoHidratar` do CAD): enquanto true, a captura trata como "recarga em curso" e o Salvar sem toque NÃO grava o CAD (Task 5 Steps 4–5; §7 T22). Prova: QA S5b.

**P6 (falha no meio).** CAD falhou depois do BOM ⇒ erro específico, condicionado a `bom.gravar` (R2 do G-plano F3.3): se ESTE Salvar gravou o BOM, "Os tecidos foram salvos, mas o CAD não — salve de novo antes de fechar."; se não gravou (Salvar sem toque, só o CAD regravado por paridade), "O CAD não foi salvo — salve de novo antes de fechar.". O selo "não salvo" segue aceso (o `onSuccess` não roda) e o próximo Salvar regrava os dois. Se o usuário FECHA e descarta em vez de salvar de novo, sobra a deriva BOM (novo) × CAD (velho) — ver o limite de P1 e §6 R11. Mesma classe do Dev (cadeia não atômica, G-inicial #5) — §6 R3; QA S7.

**P7 (pós-Explosão).** Card enviado sem "Editar": a ficha está travada, nem BOM nem CAD gravam (F3.1). Com "Editar": gravam os dois — e o `salvar_cad_completo` apaga os ajustes da Explosão exatamente como no Dev (decisão F3 #7 (a); §6 R5, D4).

**Conclusão:** P1–P3 fazem o consumo editado no Planejamento chegar ao CAD no mesmo Salvar; P4 mostra que o Dev não o desfaz; P5–P7 cobrem as bordas. A trava "cad" sai (Task 5) e o "Editar" da F3.1 passa a destravar BOM e CAD junto com os demais campos do Dev.

## 4. Mapa de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `src/components/planejamento/planejamento-detail/ficha/ficha-cad.ts` | criar | contas puras do CAD: carga, sincronia, propagação, folhas automáticas, faltas, payload, snapshot/assinatura, `deveGravarCad`, `linhasParaGravar` |
| `src/components/planejamento/planejamento-detail/ficha/envio-explosao.ts` | criar | gate de envio (posição derivada) + "Para enviar, falta" |
| `src/components/planejamento/planejamento-detail/ficha/importar-ficha.ts` | criar | o que o Importar sobrescreve + campos do Draft |
| `src/components/planejamento/planejamento-detail/ficha/selos-secoes.ts` | criar | numeração dinâmica + selos de todas as seções (mapa próprio) |
| `src/components/planejamento/planejamento-detail/ficha/useFichaCad.ts` | criar | estado/carga/sincronia/folhas do CAD |
| `src/components/planejamento/planejamento-detail/ficha/selos-bom.ts` | modificar | exporta `seloPorChaves` (regra do `reqBadge` genérica) |
| `src/components/planejamento/planejamento-detail/ficha/ficha-calc.ts` | modificar | `deveHidratarCarga` com `cadPronto`; `BomCapturado.cad` |
| `src/components/planejamento/planejamento-detail/ficha/useFichaDados.ts` | modificar | `plan-ficha-cad` com o CAD embutido; `bomFetching` inclui o CAD; `condicoesProntas` |
| `src/components/planejamento/planejamento-detail/ficha/useFichaBom.ts` | modificar | propagação BOM→CAD, handlers vindos do CAD, `aplicarImportacao`, exporta `marcarTocado`/`cargaSeq`, carga espera o CAD |
| `src/components/planejamento/planejamento-detail/ficha/useFichaTecnica.ts` | modificar | compõe o CAD; sem a trava "cad"; guarda/assinatura/conferência com CAD; `capturar` com CAD; `aposSalvar`; selo do CAD; `aplicarImportacaoBom` |
| `src/components/planejamento/planejamento-detail/ficha/persistir-bom.ts` | modificar | `persistirCad`, `invalidarAposGravarCad`, `substituirObservacoesDoBloco` |
| `src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts` | modificar | CAD na cadeia + erro específico |
| `src/components/planejamento/planejamento-detail/ficha/useFichaKanban.ts` | modificar | expõe `explosaoEnvioStatus` |
| `src/components/planejamento/planejamento-detail/secoes-abertas.tsx` | criar | pedido "abrir a seção X" (links "Para enviar, falta") |
| `src/components/planejamento/planejamento-detail/ficha/secoes/SeloBadge.tsx` | criar | selo compartilhado (sai do `BomSecoes`) |
| `src/components/planejamento/planejamento-detail/SelosAuxiliares.tsx` | criar | selos de Prova/Observações/Produto Relacionado (mesmas keys dos componentes) |
| `src/components/planejamento/planejamento-detail/MenuMaisAcoes.tsx` | criar | menu ⋯ do rodapé |
| `src/components/planejamento/planejamento-detail/useEnviarExplosao.ts` | criar | Salvar + `enviar_modelo_para_cad` + pós-envio |
| `src/components/planejamento/planejamento-detail/useImportarDados.ts` | criar | diálogo do Importar, sobrescrita, obs. bloco |
| `src/components/planejamento/planejamento-detail/campos.tsx` | modificar | `Secao` com `id`/`numero`/`selo`/`chip`/abrir por pedido |
| `src/components/planejamento/planejamento-detail/ficha/secoes/SecaoBom.tsx` | modificar | `numero` + abrir por pedido |
| `src/components/planejamento/planejamento-detail/ficha/secoes/BomSecoes.tsx` | modificar | seção CAD; avisos iguais aos da F3.1; sem "Abrir no Desenvolvimento"; numeração |
| `src/components/planejamento/planejamento-detail/ficha/secoes/DevEquipeSection.tsx` | modificar | destaque do Importar na Obs. Técnicas |
| `src/components/planejamento/planejamento-detail/InfoGeraisSecao.tsx`, `RevendaSetores.tsx` | modificar | `numero`/`selo` repassados à `Secao` |
| `src/components/planejamento/planejamento-detail/PrecoTabela.tsx` | modificar | sai `onVerDev` ("ver no Desenvolvimento ⧉") |
| `src/components/planejamento/PlanejamentoDetail.tsx` | modificar | fiação: provider de seções, numeração/selos, rodapé do mockup, Enviar à Explosão, ⋯, Importar, Ficha Técnica; sai o Sheet do Dev inline |
| `tests/unit/ficha-cad.test.ts`, `planejamento-envio-explosao.test.ts`, `planejamento-importar-ficha.test.ts`, `planejamento-selos-secoes.test.ts`, `planejamento-secoes-abertas.test.ts` | criar | testes puros |
| `tests/unit/ficha-calc.test.ts` | NÃO muda | os testes da F3.2 seguem verdes (o `cadPronto` é opcional); o caso novo vai em `ficha-cad.test.ts` (Task 4) |
| `tests/e2e/f33-qa.spec.ts` | criar (NÃO versionar) | QA na cópia (guarda invertida; simulado S1–S14; E1–E4 reais) + smoke só-leitura |
| `.superpowers/f33/{BASE,gates.sh,gate-f31.sh,gate-f32.sh}` (fora do git) | criar | linha de base e gates |
| `banco-local/app-teste-variantes/criar-variante.sh` (fora do repo) | modificar (Task 12, com backup) | aceita a porta `5184` |

## 5. Revisão (política SDD)

| Task | Revisão |
|---|---|
| 1, 2, 3 | **Lote A** — 1 revisão Opus para as 3 (puros + testes; fidelidade a cada faixa do Dev citada) |
| 4 | **Individual Opus** (carga do CAD, sincronia, estado — colab e dados) |
| 5 + 6 | **Individual Opus, juntas** (save/CAD/colab: trava, assinatura, `capturar`, cadeia, retry) |
| 7, 8 | **Lote B** — 1 revisão Opus para as 2 (UI: seção CAD, avisos, numeração/selos) |
| 9 | **Individual Opus** (Enviar à Explosão: Salvar + RPC + gate derivado + pós-envio) |
| 10 | **Individual Opus** (Importar mexe no BOM em staging + grava obs. bloco na hora; menu; remoção do 2º editor) |
| 11, 12, 13 | controlador + guardião (snapshot, QA, G-commit/G-fase, merge) |

Cada revisão usa o checklist do `code-reviewer` + o do guardião (G-commit): tenant, invariantes, queryKeys próprias (`plan-ficha-*`), invalidações, `canEdit("criacao_desenvolvimento")`, guarda de não-salvo, rev/P0409, "BOM só grava carregado E sujo", "CAD nunca grava vazio nem velho", Dev intocado.

---

## Task 0: Pré-voo (sem commit)

**Files:** nenhum no git (worktree + `.superpowers/f33/`).

- [ ] **Step 1: Criar a worktree da PONTA de `f32/ficha-bom` (depois do G-commit da F3.2 — ou antes, pelo ruling R3a)**

Pré-condição — UMA das duas:
- (a) o diário do guardião (`.superpowers/sdd/2026-09-22-unificacao-kanban-auto/guardiao.md`) tem o **G-commit da F3.2 APROVADO** e o controlador da F3.2 passou o sha da ponta; ou
- (b) **ruling R3a** (Global Constraints): a F3.2 ainda NÃO fechou. A F3.3 nasce da ponta ATUAL e COMMITADA de `f32/ficha-bom` (`git rev-parse f32/ficha-bom`; a worktree da F3.2 sem alteração pendente em `src`). O controlador registra em `.superpowers/f33/rebase-f32.md`: "nasceu de `<sha>` antes do G-commit da F3.2; rebase obrigatório quando ela fechar (Task 0 Step 5)". A F3.2 ainda recebe o fix round 4 e as tasks finais, nos arquivos que a F3.3 edita — por isso as âncoras são recontadas AGORA (Step 3) e de novo no rebase.

Sem (a) nem (b): PARE.

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp"
PONTA="<sha passado pelo controlador da F3.2 depois do G-commit dela>"   # pré-condição (a)
# PONTA="$(git rev-parse f32/ficha-bom)"                                  # pré-condição (b) — ruling R3a (usar ESTA linha no lugar da de cima)
git rev-parse --verify "$PONTA^{commit}" && git merge-base --is-ancestor "$PONTA" f32/ficha-bom && echo "ponta da F3.2: ok"
git -C .claude/worktrees/f32-ficha-bom status --porcelain -- src supabase tests/unit tests/integration; echo "f32-limpa-checada"
git log --oneline -25 "$PONTA"
git worktree add ".claude/worktrees/f33-cad-acoes" -b f33/cad-acoes "$PONTA"
cd ".claude/worktrees/f33-cad-acoes"
mkdir -p .superpowers/f33
echo "$PONTA" > .superpowers/f33/BASE
cp "/Users/sunglee/PLM + Criação/plm-pcp/.env" .env
npm ci --silent
```

Expected: `ponta da F3.2: ok`; só `f32-limpa-checada`; os commits `F3.2 (…)` e `F3.1 (…)` no log; `.superpowers/f33/BASE` = `$PONTA` (referência do `rebase --onto` da Task 13 — não apagar). A worktree da F3.2 só é LIDA.

- [ ] **Step 2: Conferir que a F3.2 está no HEAD**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f33-cad-acoes"
D=src/components/planejamento/planejamento-detail
for f in $D/ficha/useFichaTecnica.ts $D/ficha/persistir-bom.ts $D/ficha/useFichaBom.ts $D/ficha/useFichaDados.ts \
         $D/ficha/secoes/BomSecoes.tsx $D/ficha/secoes/SecaoBom.tsx $D/ficha/TecidosBomSecao.tsx $D/save-ficha.ts; do
  test -f "$f" && echo "ok  $f" || echo "FALTA  $f"; done
test ! -f $D/sync-tecidos.ts && echo "sync-tecidos removido: ok"
ls src/components/planejamento/planejamento-detail/ficha/ficha-cad.ts 2>/dev/null && echo "ficha-cad JÁ EXISTE — PARE"
```

Expected: 8× `ok`, `sync-tecidos removido: ok`, nenhuma linha "JÁ EXISTE". Senão: PARE (a F3.3 nasce da ponta da F3.2 — Step 1).

- [ ] **Step 3: Conferir as âncoras (texto FINAL da F3.2/F3.1) usadas nas Tasks 4–10 — NA PONTA da F3.2, nunca no HEAD da F3.3**

Conta SEMPRE no commit da ponta da F3.2 (`git show <ponta>:<arquivo> | grep -cF`), não no arquivo da worktree: na 1ª vez a ponta é o `BASE` (= o HEAD recém-criado, sem nada da F3.3); no modo RE-CHECAGEM (Step 5 e Task 13 Step 5) é a NOVA ponta da F3.2 — o HEAD da F3.3 não serve, porque a própria F3.3 muda várias destas âncoras de propósito (ex.: `: dados.cadExiste ? "cad"` passa a contar 0 depois da Task 6). `grep -cF` (literal): em BRE o `$` no meio do padrão vira âncora e a contagem dá 0 à toa (R6).

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f33-cad-acoes"
PONTA="${PONTA:-$(cat .superpowers/f33/BASE)}"   # re-checagem: exportar PONTA=<nova ponta da F3.2> antes
git rev-parse --verify "$PONTA^{commit}" > /dev/null && echo "conferindo as âncoras em $PONTA"
D=src/components/planejamento/planejamento-detail; F=$D/ficha
conta() { printf '%s  →  %s :: %s\n' "$(git show "$PONTA:$1" | grep -cF -- "$2")" "$(basename "$1")" "$2"; }
conta $F/useFichaDados.ts '  // CAD existe? Trava interina da F3.2 (sem sync BOM↔CAD até a F3.3 — ver motivoSomenteLeitura).'
conta $F/useFichaDados.ts 'const { data, error } = await (supabase as any).from("cad").select("id").eq("modelo_id", modeloId).maybeSingle();'
conta $F/useFichaDados.ts '  const bomFetching = qTecidos.isFetching || qOcLinks.isFetching || qAviamentosModelo.isFetching'
conta $F/useFichaDados.ts '    cadExiste: !!qCad.data?.id,'
conta $F/useFichaDados.ts '    condicoes: qCondicoes.data ?? SEM_CONDICOES,'
conta $F/useFichaDados.ts '    || qEtiquetasModelo.isFetching || qGrades.isFetching;'
conta $F/useFichaDados.ts '      return (data ?? null) as { id: string } | null;'
conta $F/useFichaDados.ts '    cadErro: qCad.isError,'
conta $F/useFichaDados.ts '    etiquetasDataRef,'
conta $F/useFichaDados.ts 'import type { AviamentoRowDb, EtiquetaRowDb, GradeRowDb, OcLinkRowDb, TecidoRowDb, VarianteRowDb } from "./ficha-calc";'
conta $F/ficha-calc.ts '  if (i.bomFetching) return false;'
conta $F/ficha-calc.ts '  gradesData: unknown;'
conta $F/ficha-calc.ts '  totais: TotaisBom | null;'
conta $F/ficha-calc.ts 'import type { GradeVarianteInfo } from "@/components/desenvolvimento/modelo-detail/ModeloGradeSection";'
conta $F/useFichaBom.ts '  const [cargaSeq, setCargaSeq] = useState(0);'
conta $F/useFichaBom.ts '  const onCampoEditado = (chave: string) => setCamposCopiados((prev) => {'
conta $F/useFichaTecnica.ts '  toggleGradeAuto: () => undefined,'
conta $F/useFichaTecnica.ts '  /** habilitada E carregada E sem trava (permissão / enviado / tem CAD) ⇒ colunas do Dev vão no UPDATE. */'
conta $F/useFichaTecnica.ts '    () => (podeEditar ? bom.handlers : HANDLERS_NOOP),'
conta $F/useFichaTecnica.ts '    ultimaAssinaturaServidorRef.current = null;'
conta $F/useFichaTecnica.ts '    aposSalvar: ({ bomEnviado }) => {'
conta $F/useFichaTecnica.ts '      // R5 — o servidor passa a ter o que foi ENVIADO: é a nova referência (o eco do meu save não acende conflito).'
conta $F/useFichaTecnica.ts '    colab: { conflitoBom, verificandoBom, aoMudarNoServidor, resolverConflitoBom },'
conta $F/ficha-calc.ts '  /** Totais SEM mão de obra (a MO entra no Salvar). null = ficha não carregada / sem permissão / somente leitura. */'
conta $F/useFichaBom.ts 'export function useFichaBom({ modeloId, habilitada, dados, tecidosPlanejados, proporcoes, setDraftTracked, aoRecarregarComTocado }: {'
conta $F/useFichaBom.ts '  aoRecarregarComTocado?: (servidor: EstadoBom) => void;'
conta $F/useFichaBom.ts '  aoRecarregarRef.current = aoRecarregarComTocado;'
conta $F/useFichaBom.ts '    if (!deveHidratarCarga({ habilitada, bomFetching: dados.bomFetching, tecidosData, ocLinksData, aviamentosData, etiquetasData, gradesData })) return;'
conta $F/useFichaBom.ts '  }, [habilitada, dados.bomFetching, dados.tecidosData, dados.ocLinksData, dados.aviamentosData, dados.etiquetasData, dados.gradesData, planejadosKey, hidratarTick]);'
conta $F/useFichaBom.ts '    // (Dev :2441-2456 — propagação BOM→CAD — entra na F3.3 junto com o CAD.)'
conta $F/useFichaBom.ts '        return recomputeBlock(merged, dados.artigoMap, varianteArtigoMap, frozen);'
conta $F/useFichaBom.ts '  const onCampoEditado = (chave: string) => setCamposCopiados((prev) => {'
conta $F/useFichaBom.ts '    limparTocado, limparFlags, descartarEdicoes,'
conta $F/useFichaTecnica.ts 'export type MotivoSomenteLeitura = "permissao" | "enviado" | "carregando" | "cad" | null;'
conta $F/useFichaTecnica.ts '          : dados.cadExiste ? "cad"'
conta $F/useFichaTecnica.ts '  const carregado = habilitada && bom.hidratado && dados.catalogosProntos && bom.varianteArtigoMapPronto;'
conta $F/useFichaTecnica.ts '  const snapshot = useMemo(() => snapshotBom(estado), [estado]);'
conta $F/useFichaTecnica.ts '    if (bom.hidratado && !bom.tocado) referenciaRef.current = assinaturaBom(estado);'
conta $F/useFichaTecnica.ts '  }, [estado, bom.hidratado, bom.tocado]);'
conta $F/useFichaTecnica.ts '      const chaves = chavesBomServidor(id);'
conta $F/useFichaTecnica.ts '      await Promise.all(chaves.map((k) => qc.refetchQueries({ queryKey: k, exact: true })));'
conta $F/useFichaTecnica.ts '      if (!tec || !oc || !av || !et || !gr) return true;'
conta $F/useFichaTecnica.ts '      return bomDivergeDaReferencia(referenciaRef.current, servidor);'
conta $F/useFichaTecnica.ts '    if (bom.colecoesTouchadasRef.current && bomDivergeDaReferencia(referenciaRef.current, servidor)) {'
conta $F/useFichaTecnica.ts '  const aoRecarregarComTocadoRef = useRef<(servidor: EstadoBom) => void>(() => undefined);'
conta $F/useFichaTecnica.ts '    aoRecarregarComTocado: (servidor) => aoRecarregarComTocadoRef.current(servidor),'
conta $F/useFichaTecnica.ts '  const estado: EstadoBom = useMemo('
conta $F/useFichaTecnica.ts '  const guarda = useFichaGuarda({ modeloId: a.modeloId, snapshot, tocado: bom.tocado, hidratado: bom.hidratado });'
conta $F/useFichaTecnica.ts '  travaDev: MotivoTravaDev;'
conta $F/useFichaTecnica.ts '    capturar: (custosAdicionais) => {'
conta $F/useFichaTecnica.ts '      const snap = snapshotBom(e);'
conta $F/useFichaTecnica.ts '        && ((bom.colecoesTouchadasRef.current && (base === null || snap !== base)) || bom.prefillPendenteRef.current);'
conta $F/useFichaTecnica.ts '  const saveEmVooContadorRef = useRef(0);'
conta $F/useFichaTecnica.ts '    if (!bom.colecoesTouchadasRef.current) { invalidarBom(); return; }'
conta $F/useFichaTecnica.ts '    if (saveEmVooContadorRef.current > 0) { invalidarBom(); return; }'
conta $D/usePlanejamentoSave.ts '  const enviadoRef = useRef<{'
conta $F/useFichaTecnica.ts '        enviadoNaCaptura: motivoSomenteLeituraRef.current === "enviado",'
conta $F/useFichaTecnica.ts '        totais: podeEditarRef.current ? totaisBom({ blocks: e.blocks, aviamentos: e.aviamentos, etiquetas: e.etiquetas, custosAdicionais, maoObra: 0 }) : null,'
conta $F/useFichaTecnica.ts '  capturar: (custosAdicionais: unknown) => BomCapturado;'
conta $F/useFichaTecnica.ts '      const vivo = snapshotBom(bom.estadoRef.current);'
conta $F/useFichaTecnica.ts '      if (bomMudouEmVoo) guarda.rebasear(bomEnviado.snapshot);'
conta $F/useFichaTecnica.ts '      if (bomEnviado.gravar) referenciaRef.current = assinaturaBom(bomEnviado.estado);'
conta $F/useFichaTecnica.ts '      if (ultimaAssinaturaServidorRef.current) referenciaRef.current = ultimaAssinaturaServidorRef.current;'
conta $F/useFichaTecnica.ts '    referenciaRef.current = null;'
conta $F/useFichaTecnica.ts '    grade: seloSecaoBom("grade", requeridas, dados.condicoes, resumo),'
conta $F/useFichaTecnica.ts '    dados, estado, handlers, gradeAuto: bom.gradeAuto,'
conta $F/useFichaTecnica.ts '    tecido1Info, totais, selos,'
conta $F/useFichaTecnica.ts '    dirty: guarda.dirty,'
conta $F/useFichaTecnica.ts 'import { requisitosUniao, seloSecaoBom, type SecaoBomKey, type SeloSecao } from "./selos-bom";'
printf '%s  →  useFichaTecnica.ts :: ultimaAssinaturaServidorRef.current = assinaturaBom(servidor); (esperado 2)\n' "$(git show "$PONTA:$F/useFichaTecnica.ts" | grep -cF 'ultimaAssinaturaServidorRef.current = assinaturaBom(servidor);')"
conta $D/usePlanejamentoSave.ts '.capturar(d.custos_adicionais);'
conta $D/usePlanejamentoSave.ts 'await persistirBom(modeloId, bom);'
conta $D/usePlanejamentoSave.ts '      // MO por serviço (spec 2026-08-06): persiste os VALORES das linhas (estado COMPLETO;'
conta $D/usePlanejamentoSave.ts '      if (enviadoRef.current?.bom.gravar) {'
conta $D/usePlanejamentoSave.ts '        } else if (e?.etapaFalha === "grade") {'
conta $D/usePlanejamentoSave.ts '      toast.error(mensagemErro(e, "Erro"));'
conta $D/usePlanejamentoSave.ts 'import { gravarTecidosIniciais, persistirBom } from "@/components/planejamento/planejamento-detail/ficha/persistir-bom";'
conta $D/usePlanejamentoSave.ts '  const handleSave = () => {'
conta $D/usePlanejamentoSave.ts '  return { save, handleSave };'
conta $F/persistir-bom.ts 'export async function gravarTecidosIniciais(modeloIdRecemCriado: string, artigoIds: string[]): Promise<void> {'
conta $F/secoes/BomSecoes.tsx 'const TEXTO_AVISO_BOM: Record<"enviado" | "cad", string> = {'
conta $F/secoes/BomSecoes.tsx 'export function BomSecoes({ ficha, modeloId, estoque, ordemEnviada, proporcoes, onAbrirDev }: {'
conta $F/secoes/BomSecoes.tsx '      <AvisoSomenteLeitura motivo={ficha.motivoSomenteLeitura} cadErro={dados.cadErro} onAbrirDev={onAbrirDev} />'
conta $F/secoes/BomSecoes.tsx 'function SeloBadge({ selo }: { selo: SeloSecao }) {'
conta $F/secoes/BomSecoes.tsx '      <SecaoBom id="grade" titulo="Grade" selo={<SeloBadge selo={ficha.selos.grade} />}>'
conta $F/secoes/BomSecoes.tsx '      <AlertDialog open={!!ficha.confirmGrade} onOpenChange={(o) => { if (!o) ficha.setConfirmGrade(null); }}>'
printf '%s  →  BomSecoes.tsx :: onAbrirDev?: () => void; (esperado 2)\n' "$(git show "$PONTA:$F/secoes/BomSecoes.tsx" | grep -cF 'onAbrirDev?: () => void;')"
conta $F/secoes/SecaoBom.tsx 'export function SecaoBom({ id, titulo, selo, origemDev = true, defaultOpen = false, open: openProp, onOpenChange, children }: {'
conta $F/secoes/SecaoBom.tsx '          <span className="truncate">{titulo}</span>'
conta $F/secoes/SecaoBom.tsx '  const open = openProp ?? openLocal;'
conta $F/secoes/SecaoBom.tsx '          aria-expanded={open}'
conta $D/campos.tsx 'export function Secao({ titulo, children, defaultOpen = true }: { titulo: string; children: React.ReactNode; defaultOpen?: boolean }) {'
conta $D/PrecoTabela.tsx '  onVerDev?: () => void;'
conta $D/PrecoTabela.tsx 'markupFaixaOn, onVerDev } = props;'
conta $D/PrecoTabela.tsx '<button type="button" onClick={onVerDev} className="text-primary hover:underline">ver no Desenvolvimento ⧉</button> : "do BOM"}'
conta $F/useFichaKanban.ts '  refExibirStatus: string | null;'
conta $F/useFichaKanban.ts '  const refExibirStatus = (cfgRow?.ref_exibir_status as string | null | undefined) ?? null;'
conta $F/useFichaKanban.ts '    kanbanCfg, revendaCfg, refExibirStatus, cond, cfgPronta, condProntas, modeloKanban, statusSalvo, statusEfetivo, derivacao,'
conta $F/secoes/DevEquipeSection.tsx 'export function DevEquipeSection({ draft, setDraftTracked, refVisivel, campoVisivel, bloqueado }: {'
conta $F/secoes/DevEquipeSection.tsx '  bloqueado: boolean;'
conta $F/secoes/DevEquipeSection.tsx '<Textarea rows={3} value={draft.observacoes_tecnicas} onChange={(e) => set({ observacoes_tecnicas: e.target.value })} data-colab-path="observacoes_tecnicas" />'
P=src/components/planejamento/PlanejamentoDetail.tsx
conta $P 'onAbrirDev={() => setVerDevModeloId(modeloId)}'
conta $P '              ficha={ficha}'
conta $P 'const [verDevModeloId, setVerDevModeloId] = useState<string | null>(null);'
conta $P '  // "Ver no Desenvolvimento" (setor Preço, §K) — abre o ModeloDetailPanel INLINE por cima'
conta $P 'import { ModeloDetailPanel } from "@/components/desenvolvimento/ModeloDetailPanel";'
conta $P 'onVerDev={modeloId ? () => setVerDevModeloId(modeloId) : undefined}'
conta $P '      {verDevModeloId && ('
conta $P '    travaDev: motivoTravaDev,'
conta $P '  const { save, handleSave } = usePlanejamentoSave({'
conta $P '  const [enviada, setEnviada] = useState(false);'
conta $P '  const enviarBloqueios: string[] = [];'
conta $P '  const lancarBloqueios: string[] = [];'
conta $P '  // Conteúdo interno idêntico p/ os dois containers (header / corpo rolável / rodapé'
conta $P '  const conteudo = ('
conta $P '          <InfoGeraisSecao'
conta $P '          <Secao titulo="Coleção" defaultOpen={false}>'
conta $P '          {isEdit && podeVerDev && ('
conta $P '            <Secao titulo="Desenvolvimento — equipe e cronograma" defaultOpen={false}>'
conta $P '                <DevEquipeSection'
conta $P '          {isEdit && modeloId && podeVerDev && campoVisivelDev("prova") && ('
conta $P '            <Secao titulo="Ajustes na Prova" defaultOpen={false}>'
conta $P '          {!isEdit && !isComprado && ('
conta $P '          <Secao titulo="Tecidos" defaultOpen>'
conta $P '          <Secao titulo="Preço e Custos" defaultOpen={false}>'
conta $P '          {(!isComprado ? true : isEdit) && (podeVerCustos || (isEdit && podeAprovarMaoObra)) && ('
conta $P '            <Secao titulo="Mão de obra" defaultOpen={false}>'
conta $P '          {isEdit && isRevenda && paOn && ('
conta $P '            <ProdutoAcabadoSecao rv={revenda} contexto={contexto} modeloId={modeloId} navigate={navigate} />'
conta $P '          {isEdit && isRevenda && paOn && produtoRevenda && ('
conta $P '            <GradeRevendaSecao rv={revenda} />'
conta $P '          <Secao titulo="Anexos" defaultOpen={false}>'
conta $P '          {isEdit && modeloId && podeVerDev && ('
conta $P '            <Secao titulo="Observações" defaultOpen={false}>'
conta $P '            <Secao titulo="Lançamento" defaultOpen={false}>'
conta $P '            <Secao titulo="Produto Relacionado" defaultOpen={false}>'
conta $P '                  bloqueado={devBloqueado}'
conta $P '    qc, onSaved: aoSalvar, onCreated, ficha: ficha.save, resetDraftBaseline,'
conta $P '              <ProdutoRelacionadoSetor modeloId={modeloId} />'
conta $P '        <UnsavedChangesGuard confirm={confirm} message="Há alterações não salvas neste card." />'
conta $P '                onVerDev={modeloId ? () => setVerDevModeloId(modeloId) : undefined}'
conta $P 'import { Trash2, Copy, ArrowLeft, Save, Pencil } from "lucide-react";'
conta $P '        <div className="shrink-0 border-t bg-background px-4 py-3 flex flex-wrap items-center gap-2">'
conta $P '        <AlertDialog open={confirmDel} onOpenChange={setConfirmDel}>'
conta $P '        <ColabPresenceOverlay presentes={presentes} scopeRef={colabScopeRef} />'
conta $D/InfoGeraisSecao.tsx '          <Secao titulo="Informações Gerais do Produto">'
conta $D/InfoGeraisSecao.tsx '  draft, setDraftTracked, grupoSel, setGrupoSel, grupos, categorias, estilistas, sub1Opts, sub2Opts, fl,'
conta $D/InfoGeraisSecao.tsx '  fl: ReturnType<typeof useFieldLabels>;'
conta $D/RevendaSetores.tsx 'export function ProdutoAcabadoSecao({ rv, contexto, modeloId, navigate }: {'
conta $D/RevendaSetores.tsx '            <Secao titulo="Produto Acabado" defaultOpen={false}>'
conta $D/RevendaSetores.tsx 'export function GradeRevendaSecao({ rv }: { rv: RevendaPlanejamento }) {'
conta $D/RevendaSetores.tsx '            <Secao titulo="Grade" defaultOpen={false}>'
conta $D/campos.tsx 'import { useState } from "react";'
```

Expected: `conferindo as âncoras em <sha>`; TODAS as contagens = 1, exceto as 2 linhas marcadas "(esperado 2)". (Recontagem de 24/set em `ebb371d`: tudo bate — a única divergência, `saveEmVooRef` → `saveEmVooContadorRef` do fix round 3, já foi trocada neste plano.) Qualquer divergência: **não adaptar por conta própria** — registrar o trecho real (`git show "$PONTA:<arq>" | grep -nF -- '<pedaço>'`) em `.superpowers/sdd/<pasta da F3.3>/ancoras-divergentes.md` (mesmo protocolo da F3.2) e reportar ao controlador; a task que usa a âncora aplica a MESMA intenção sobre o texto real, com o registro.

Arquivos que a F3.3 CONSOME ou EDITA do texto da F3.2/F3.1 — a lista do `git diff` do modo re-checagem (Step 5; Task 13 Step 5):

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f33-cad-acoes"
D=src/components/planejamento/planejamento-detail; F=$D/ficha
ARQS_F33="$F/useFichaTecnica.ts $F/useFichaBom.ts $F/useFichaDados.ts $F/ficha-calc.ts $F/persistir-bom.ts $F/useFichaKanban.ts $F/selos-bom.ts \
  $F/secoes/BomSecoes.tsx $F/secoes/SecaoBom.tsx $F/secoes/DevEquipeSection.tsx $D/usePlanejamentoSave.ts $D/save-ficha.ts \
  $D/campos.tsx $D/InfoGeraisSecao.tsx $D/RevendaSetores.tsx $D/PrecoTabela.tsx src/components/planejamento/PlanejamentoDetail.tsx \
  tests/unit/ficha-calc.test.ts tests/unit/planejamento-save-ficha.test.ts"
echo "$ARQS_F33" > .superpowers/f33/arqs-f33.txt   # lido pelo Step 5 e pela Task 13 Step 5
```

- [ ] **Step 4: Gates de base + scripts de gate**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f33-cad-acoes"
cp "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f32-ficha-bom/.superpowers/f32/gate-f31.sh" .superpowers/f33/gate-f31.sh
npx tsc --noEmit 2>&1 | tail -3
npm run build 2>&1 | tail -3; git checkout -- src/routeTree.gen.ts 2>/dev/null || true
env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit > .superpowers/f33/unit-base.log 2>&1; tail -6 .superpowers/f33/unit-base.log
grep -E "^ FAIL " .superpowers/f33/unit-base.log | sed -E 's/ +[0-9]+ms$//' | sort -u > .superpowers/f33/unit-fail-base.txt; cat .superpowers/f33/unit-fail-base.txt
```

Expected: tsc sem erro; build ok; unit com N passed e as falhas HERDADAS (hoje 2, do anti-drift — `DocPrintCasca`/`OcDocumentoPrint`) listadas em `unit-fail-base.txt`.

Criar `.superpowers/f33/gate-f32.sh`:

```bash
#!/usr/bin/env bash
# 6º gate da F3.3 — "F3.2 preservada". Confere, no texto, o que a F3.2 garante e o tsc não pega (refs/funções opcionais,
# chamadas que podem sumir sem erro de tipo). SAI COM CÓDIGO 1 quando falha — gate falhou = PARE, não commitar.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
D=src/components/planejamento/planejamento-detail; F=$D/ficha; P=src/components/planejamento/PlanejamentoDetail.tsx
ok=1
exige() { local n; n=$(grep -cF -- "$3" "$2"); if [ "$1" = "ge2" ]; then [ "$n" -ge 2 ] || { echo "F3.2: esperado ≥2 de '$3' em $2 (achou $n)"; ok=0; }; else [ "$n" = "$1" ] || { echo "F3.2: esperado $1 de '$3' em $2 (achou $n)"; ok=0; }; fi; }
exige 1   "$P" 'travaDev: motivoTravaDev,'
exige ge2 "$F/useFichaBom.ts" 'aoRecarregarComTocado'
exige 2   "$F/useFichaTecnica.ts" 'geracaoRef.current += 1;'
exige 2   "$F/persistir-bom.ts" 'rpc("salvar_modelo_bom"'
exige 1   "$D/usePlanejamentoSave.ts" 'verificandoBomRef.current)'
exige 1   "$D/usePlanejamentoSave.ts" 'bomMudouNoServidor()'
exige 1   "$D/usePlanejamentoSave.ts" 'await persistirBom(modeloId, bom);'
exige 1   "$F/useFichaTecnica.ts" 'podeEditarRef.current = podeEditar;'
exige 1   "$F/useFichaTecnica.ts" '() => (podeEditar ? bom.handlers : HANDLERS_NOOP),'
[ -z "$(grep -rn "syncTecidosToDesenvolvimento" src)" ] || { echo "F3.2: syncTecidosToDesenvolvimento voltou"; ok=0; }
if [ "$ok" = 1 ]; then echo "F3.2 preservada: ok"; else echo "F3.2 QUEBRADA — PARE"; exit 1; fi
```

Criar `.superpowers/f33/gates.sh`:

```bash
#!/usr/bin/env bash
# Gates de TODO commit de código da F3.3 (sem banco). Uso: bash .superpowers/f33/gates.sh → "GATES F3.3: ok" e código 0.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
falha() { echo "GATE FALHOU: $1"; exit 1; }
npx tsc --noEmit > .superpowers/f33/tsc.log 2>&1 || { tail -20 .superpowers/f33/tsc.log; falha "tsc"; }
npm run build > .superpowers/f33/build.log 2>&1 || { tail -20 .superpowers/f33/build.log; falha "build"; }
git checkout -- src/routeTree.gen.ts 2>/dev/null || true
env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit > .superpowers/f33/unit.log 2>&1
grep -qE "Test Files .*passed" .superpowers/f33/unit.log || { tail -20 .superpowers/f33/unit.log; falha "unit (sem resumo)"; }
grep -E "^ FAIL " .superpowers/f33/unit.log | sed -E 's/ +[0-9]+ms$//' | sort -u > .superpowers/f33/unit-fail-agora.txt
diff -q .superpowers/f33/unit-fail-base.txt .superpowers/f33/unit-fail-agora.txt > /dev/null \
  || { diff .superpowers/f33/unit-fail-base.txt .superpowers/f33/unit-fail-agora.txt; falha "unit (falhas ≠ linha de base)"; }
[ -z "$(git diff --name-only savepoint-pre-unificacao-2026-09-22 -- src/components/desenvolvimento/ src/components/producao/cad/CadTecidosSection.tsx)" ] \
  || falha "Dev/CadTecidosSection mudou (decisão travada 8)"
[ -z "$(git diff --name-only "$(cat .superpowers/f33/BASE)" -- src/components/producao/ src/components/shared/ModeloObservacoes.tsx src/lib/kanban-condicoes.ts src/lib/artigo-label.ts supabase tests/integration tests/fixtures)" ] \
  || falha "arquivo intocável mudou desde o BASE"
bash .superpowers/f33/gate-f31.sh || falha "F3.1 preservada"
bash .superpowers/f33/gate-f32.sh || falha "F3.2 preservada"
echo "GATES F3.3: ok"
```

```bash
chmod +x .superpowers/f33/*.sh
bash .superpowers/f33/gates.sh; echo "código=$?"
```

Expected: `F3.1 preservada: ok`, `F3.2 preservada: ok`, `GATES F3.3: ok`, `código=0`. Código 1 já aqui = a F3.3 nasceu de um ponto errado: PARE e reporte.

- [ ] **Step 5: Re-checagem quando a F3.2 fechar (SÓ se a F3.3 nasceu pelo ruling R3a — Step 1 (b))**

Quando: assim que o guardião aprovar o G-commit da F3.2 (ponta FINAL, com o fix round 4), ANTES da próxima task da F3.3 — nunca no meio de uma task. Sem git stash: a worktree tem de estar limpa (tudo da F3.3 já commitado); se não estiver, termine/commite a task em curso primeiro.

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f33-cad-acoes"
git status --porcelain -- src tests | grep . && echo "WORKTREE SUJA — PARE (commite a task em curso; nunca stash)"
BASE_ANTERIOR="$(cat .superpowers/f33/BASE)"
export PONTA="<sha da ponta FINAL da F3.2, passado pelo controlador dela depois do G-commit>"
git merge-base --is-ancestor "$BASE_ANTERIOR" "$PONTA" && echo "a ponta nova descende do BASE: ok"
# (1) Âncoras na NOVA ponta (Step 3 com PONTA exportado) — nunca no HEAD da F3.3.
# (2) O que a F3.2 mudou desde o BASE nos arquivos que a F3.3 consome/edita (ARQS_F33 do Step 3):
ARQS_F33="$(cat .superpowers/f33/arqs-f33.txt)"
git diff --stat "$BASE_ANTERIOR" "$PONTA" -- $ARQS_F33
git diff "$BASE_ANTERIOR" "$PONTA" -- $ARQS_F33 > .superpowers/f33/diff-f32-pos-base.patch
# (3) Rebase da F3.3 para a ponta nova e troca do BASE (referência do rebase --onto da Task 13).
git log --oneline "$BASE_ANTERIOR..HEAD" | tee .superpowers/f33/commits-f33-antes-do-rebase.txt | wc -l
git rebase --onto "$PONTA" "$BASE_ANTERIOR" f33/cad-acoes
echo "$PONTA" > .superpowers/f33/BASE
cp "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f32-ficha-bom/.superpowers/f32/gate-f31.sh" .superpowers/f33/gate-f31.sh
bash .superpowers/f33/gates.sh; echo "código=$?"
```

Expected: `a ponta nova descende do BASE: ok`; o Step 3 com a NOVA ponta dá tudo = 1 (divergência ⇒ protocolo do Step 3 + a task afetada é refeita sobre o texto real); rebase sem conflito ou com conflito resolvido PRESERVANDO o texto final da F3.2 (é contrato) e aplicando por cima a MESMA intenção da task da F3.3; `GATES F3.3: ok`. Para cada arquivo listado no `git diff --stat`, re-revisar (Opus) as tasks da F3.3 JÁ commitadas que o editam (mapa §4), com o `.patch` anexado. Registrar em `.superpowers/f33/rebase-f32.md`: BASE antigo → novo, arquivos mudados, conflitos e como foram resolvidos, âncoras divergentes, tasks re-revisadas e o custo (tempo gasto) — é o custo do ruling R3a. Se a F3.2 ainda ganhar commits DEPOIS disto, repetir este Step.

---

## Task 1: `ficha-cad.ts` — contas puras do CAD  *(Lote A)*

**Files:**
- Create: `src/components/planejamento/planejamento-detail/ficha/ficha-cad.ts`
- Test: `tests/unit/ficha-cad.test.ts`

**Interfaces:**
- Consumes: `calcCusto`, `TecidoRow`, `VarianteRow`, `TipoTec` (`@/components/producao/cad/types`, só importar); `gradeEfetivaPar` (`@/lib/casar-variantes-grade`); da F3.2 (`./ficha-calc`): `montarAviamentosPayload`, `montarGradesPayload`, `TecidoRowDb`, `VarianteRowDb`.
- Produces: tipos `CadTecidoRow`, `CadVarianteRow`, `TipoTec` (re-export), `CadRowDb`, `CadTecidoRowDb`, `CadVarianteRowDb`, `ArtigoCad`, `RotulosVariante`, `PatchBlocoCad = { consumo?: number; loss_percent?: number; artigo_id?: string | null }`, `CadPayload`, `CadCapturado = { estado: CadTecidoRow[]; linhas: CadTecidoRow[]; snapshot: string; gravar: boolean; payload: CadPayload | null }`; funções `hidratarCad`, `idsVariantesDosBlocos`, `sincronizarCadComBlocos`, `propagarBlocoParaCad`, `atualizarLinhaCad`, `atualizarVarianteCad`, `calcularFolhasAuto`, `faltasCad`, `linhasParaGravar`, `montarCadPayload`, `snapshotCad`, `assinaturaCad`, `assinaturaCadServidor(cad: CadRowDb | null): string`, `cadDivergeDaReferencia(referencia: string | null, cad: CadRowDb | null): boolean`, `deveGravarCad` (assinaturas no código).
- Por que a referência do CAD é SEPARADA da do BOM (e não uma assinatura "ficha" única): a F3.2 atualiza a referência do BOM em pontos próprios (carga, `aposSalvar`, "manter meu" e — fix T10 m1 — logo depois do `persistirBom`); o CAD grava num passo SEGUINTE que pode falhar sozinho (§3 P6). Com duas referências cada uma vira o "enviado" só quando a SUA gravação deu certo, e o código da F3.2 fica intocado (§7 T7).

- [ ] **Step 1: Escrever o teste (falha: módulo inexistente)**

Criar `tests/unit/ficha-cad.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { calcCusto } from "@/components/producao/cad/types";
import { makeEmptyBlocks, type TecidoBlock } from "@/components/desenvolvimento/modelo-detail/types";
import {
  assinaturaCad, assinaturaCadServidor, atualizarLinhaCad, atualizarVarianteCad, cadDivergeDaReferencia, calcularFolhasAuto,
  deveGravarCad, faltasCad, hidratarCad, idsVariantesDosBlocos, linhasParaGravar, montarCadPayload, propagarBlocoParaCad,
  sincronizarCadComBlocos, snapshotCad, type CadRowDb, type CadTecidoRow,
} from "@/components/planejamento/planejamento-detail/ficha/ficha-cad";
import type { TecidoRowDb, VarianteRowDb } from "@/components/planejamento/planejamento-detail/ficha/ficha-calc";

// F3.3 — trava as contas PORTADAS da seção "CAD" do Desenvolvimento (ModeloDetailPanel.tsx:1040-1386, :2062-2119,
// :2441-2456) + as melhorias locais do plano (§7 T3–T6) + a regra de quando o Salvar grava o CAD (§3 P2).
const A = "art-a", F = "art-forro";
const V1 = "v-a-1", V2 = "v-a-2", VF = "v-forro-1";
const artigoMap = {
  [A]: { nome: "Linho", preco_por_metro: 30, largura_estimada: 1.4 },
  [F]: { nome: "Viscose", preco_por_metro: 18, largura_estimada: 1.5 },
};
const ctx = { artigoMap, frozen: {} as Record<string, number> };

function bloco(tipo: TecidoBlock["tipo"], numero: number, patch: Partial<TecidoBlock> = {}): TecidoBlock {
  const base = makeEmptyBlocks().find((b) => b.tipo === tipo && b.numero === numero)!;
  return { ...base, ...patch };
}
function blocos(...bs: TecidoBlock[]): TecidoBlock[] {
  return makeEmptyBlocks().map((e) => bs.find((b) => b.tipo === e.tipo && b.numero === e.numero) ?? e);
}
const vars = (...ids: (string | null)[]) => [...ids, ...Array(10 - ids.length).fill(null)] as (string | null)[];

const bomT1: TecidoRowDb = { id: "mt1", tipo: "tecido", numero: 1, artigo_id: A, consumo: 1.85, loss_percent: 3, custo_previsto: 57.17 };
const bomF1: TecidoRowDb = { id: "mf1", tipo: "forro", numero: 1, artigo_id: F, consumo: 0.9, loss_percent: 2, custo_previsto: 16.52 };
const bomVars: VarianteRowDb[] = [
  { modelo_tecido_id: "mt1", variante_tecido_id: V1, ordem: 1, multiplicador: 1, complementa_variante_ids: null },
  { modelo_tecido_id: "mt1", variante_tecido_id: V2, ordem: 2, multiplicador: 1, complementa_variante_ids: null },
  { modelo_tecido_id: "mf1", variante_tecido_id: VF, ordem: 1, multiplicador: 1, complementa_variante_ids: [V1, V2] },
];
const cadServidor: CadRowDb = {
  id: "cad-1",
  cad_tecidos: [{
    id: "ct1", numero: 1, tipo: "tecido", artigo_id: A, consumo_cad: 1.85, loss_percent_cad: 3, custo_cad: 57.17, tamanho_folha: 1.2,
    artigos: { nome: "Linho", preco_por_metro: 30, unidade_medida: "metro", etiqueta_lavagem_urls: [], largura_estimada: 1.4 },
    cad_tecido_variantes: [{
      id: "cv1", variante_tecido_id: V1, ordem: 1, multiplicador: 1, quantidade_folhas: 4, metragem_planejada: 45.73,
      metragem_enviada: 0, complementa_variante_ids: null,
      variantes_tecido: { nome_variante: "Areia", codigo_variante: "AR", cor: { nome: "Bege" }, apelido: null },
    }],
  }],
};
const hidratadoComCad = () => hidratarCad({ cad: cadServidor, bomTecidos: [bomT1, bomF1], bomVariantes: bomVars, artigoMap, frozen: {} });

describe("hidratarCad — carga (Dev :1040-1174)", () => {
  it("sem CAD: semeia do BOM, folhas/metragem zeradas, Tecido antes do Forro", () => {
    const out = hidratarCad({ cad: null, bomTecidos: [bomF1, bomT1], bomVariantes: bomVars, artigoMap, frozen: {} });
    expect(out.map((t) => `${t.tipo}${t.numero}`)).toEqual(["tecido1", "forro1"]);
    const t1 = out[0];
    expect(t1.id).toBeUndefined();
    expect(t1).toMatchObject({ artigo_id: A, consumo_cad: 1.85, loss_percent_cad: 3, tamanho_folha: 0, preco: 30, largura: 1.4, artigo_nome: "Linho" });
    expect(t1.custo_cad).toBe(calcCusto(1.85, 3, 30));
    expect(t1.variantes.map((v) => [v.variante_tecido_id, v.ordem, v.quantidade_folhas, v.metragem_planejada])).toEqual([[V1, 1, 0, 0], [V2, 2, 0, 0]]);
    expect(out[1].variantes[0].complementa_variante_ids).toEqual([V1, V2]);
  });
  it("com CAD: do servidor (valores e rótulos) + mescla a variante e o bloco do BOM que o CAD ainda não tem", () => {
    const out = hidratadoComCad();
    expect(out.map((t) => `${t.tipo}${t.numero}:${t.id ?? "-"}`)).toEqual(["tecido1:ct1", "forro1:-"]);
    const t1 = out[0];
    expect(t1.tamanho_folha).toBe(1.2);
    expect(t1.artigo_nome).toBe("Linho [metro]");
    expect(t1.variantes.map((v) => [v.variante_tecido_id, v.quantidade_folhas, v.variante_nome, v.variante_cor])).toEqual([
      [V1, 4, "Areia", "Bege"], [V2, 0, null, null],
    ]);
  });
  it("preço congelado pela OC vinculada (tipo|numero) vence o do artigo", () => {
    const out = hidratarCad({ cad: cadServidor, bomTecidos: [bomT1], bomVariantes: bomVars, artigoMap, frozen: { "tecido|1": 25 } });
    expect(out[0].preco).toBe(25);
  });
});

describe("sincronizarCadComBlocos — BOM → CAD (Dev :1314-1386 + T4)", () => {
  it("variantes seguem o bloco: remove a que saiu, mantém o digitado, leva multiplicador e casamento", () => {
    const b = blocos(
      bloco("tecido", 1, { artigo_id: A, variantes: vars(V1) }),
      bloco("forro", 1, { artigo_id: F, variantes: vars(VF), multiplicadores: [2, ...Array(9).fill(1)], complementas: [[V1], ...Array(9).fill(null)] }),
    );
    const out = sincronizarCadComBlocos(hidratadoComCad(), b, {}, ctx);
    expect(out[0].variantes.map((v) => [v.variante_tecido_id, v.quantidade_folhas])).toEqual([[V1, 4]]);
    expect(out[1].variantes[0]).toMatchObject({ variante_tecido_id: VF, multiplicador: 2, complementa_variante_ids: [V1] });
  });
  it("nada mudou ⇒ devolve a MESMA referência (sem laço de efeito)", () => {
    const b = blocos(bloco("tecido", 1, { artigo_id: A, variantes: vars(V1, V2) }), bloco("forro", 1, { artigo_id: F, variantes: vars(VF), complementas: [[V1, V2], ...Array(9).fill(null)] }));
    const uma = sincronizarCadComBlocos(hidratadoComCad(), b, {}, ctx);
    expect(sincronizarCadComBlocos(uma, b, {}, ctx)).toBe(uma);
  });
  it("variante nova entra zerada e já com o rótulo", () => {
    const b = blocos(bloco("tecido", 1, { artigo_id: A, variantes: vars(V1, V2) }), bloco("forro", 1, { artigo_id: F, variantes: vars(VF), complementas: [[V1, V2], ...Array(9).fill(null)] }));
    const out = sincronizarCadComBlocos(hidratadoComCad(), b, { [V2]: { nome: "Oliva", cor: "Verde", apelido: null } }, ctx);
    expect(out[0].variantes[1]).toMatchObject({ variante_tecido_id: V2, variante_nome: "Oliva", quantidade_folhas: 0, metragem_planejada: 0 });
  });
  it("T4: bloco com artigo sem linha no CAD ganha a linha (sem id); linha SEM id sai quando o bloco perde o artigo; linha do servidor fica", () => {
    const b = blocos(
      bloco("tecido", 1, { artigo_id: null, variantes: vars() }),
      bloco("tecido", 2, { artigo_id: A, consumo: 1.1, loss_percent: 0, variantes: vars(V1) }),
      bloco("forro", 1, { artigo_id: null, variantes: vars() }),
    );
    const out = sincronizarCadComBlocos(hidratadoComCad(), b, {}, ctx);
    expect(out.map((t) => `${t.tipo}${t.numero}:${t.id ?? "-"}`)).toEqual(["tecido1:ct1", "tecido2:-"]);
    expect(out[0].variantes).toEqual([]);
    expect(out[1]).toMatchObject({ artigo_id: A, consumo_cad: 1.1, preco: 30, largura: 1.4, artigo_nome: "Linho" });
  });
});

describe("propagarBlocoParaCad — Dev :2441-2456 (+ artigo, T4)", () => {
  it("consumo/%loss do bloco vão para a linha do mesmo tipo+número, com o custo recalculado", () => {
    const out = propagarBlocoParaCad(hidratadoComCad(), "tecido", 1, { consumo: 2 }, ctx);
    expect(out[0].consumo_cad).toBe(2);
    expect(out[0].custo_cad).toBe(calcCusto(2, 3, 30));
    expect(out[1].consumo_cad).toBe(0.9);
  });
  it("trocar o artigo do bloco leva artigo, preço, largura e nome à linha", () => {
    const out = propagarBlocoParaCad(hidratadoComCad(), "tecido", 1, { artigo_id: F }, ctx);
    expect(out[0]).toMatchObject({ artigo_id: F, preco: 18, largura: 1.5, artigo_nome: "Viscose" });
    expect(out[0].custo_cad).toBe(calcCusto(1.85, 3, 18));
  });
  it("mesmo valor ⇒ mesma referência", () => {
    const linhas = hidratadoComCad();
    expect(propagarBlocoParaCad(linhas, "tecido", 1, { consumo: 1.85, loss_percent: 3, artigo_id: A }, ctx)).toBe(linhas);
  });
});

describe("edição direta na seção CAD (Dev :1176-1220)", () => {
  it("atualizarLinhaCad recalcula o custo", () => {
    const out = atualizarLinhaCad(hidratadoComCad(), 0, { consumo_cad: 1 });
    expect(out[0].custo_cad).toBe(calcCusto(1, 3, 30));
  });
  it("atualizarVarianteCad muda só a variante apontada", () => {
    const out = atualizarVarianteCad(hidratadoComCad(), 0, 0, { quantidade_folhas: 9 });
    expect(out[0].variantes.map((v) => v.quantidade_folhas)).toEqual([9, 0]);
  });
});

describe("calcularFolhasAuto — Dev :1222-1269 (grade × proporção × consumo × largura; casamento)", () => {
  const linhas = hidratarCad({ cad: null, bomTecidos: [bomT1, bomF1], bomVariantes: bomVars, artigoMap, frozen: {} });
  const grades = [{ variante_numero: 1, grades: {}, grade_total: 24 }, { variante_numero: 2, grades: {}, grade_total: 12 }];
  const prop = { P: 1, M: 2, G: 2, GG: 1 };
  it("Tecido 1: folhas = peças ÷ Σproporção; metragem = peças × consumo × (1+loss); folha = base ÷ folhas ÷ largura", () => {
    const [t1] = calcularFolhasAuto(linhas, grades, prop);
    expect(t1.variantes.map((v) => v.quantidade_folhas)).toEqual([4, 2]);
    expect(t1.variantes[0].metragem_planejada).toBeCloseTo(45.73, 2);
    expect(t1.variantes[1].metragem_planejada).toBeCloseTo(22.87, 2);
    expect(t1.tamanho_folha).toBeCloseTo(7.93, 2);
  });
  it("Forro casado com as 2 cores do Tecido 1 consome a Σ das grades delas", () => {
    const [, f1] = calcularFolhasAuto(linhas, grades, prop);
    expect(f1.variantes[0].quantidade_folhas).toBe(6);
    expect(f1.variantes[0].metragem_planejada).toBeCloseTo(33.05, 2);
    expect(f1.tamanho_folha).toBeCloseTo(3.6, 2);
  });
  it("idempotente ⇒ mesma referência na 2ª passada", () => {
    const uma = calcularFolhasAuto(linhas, grades, prop);
    expect(calcularFolhasAuto(uma, grades, prop)).toBe(uma);
  });
});

describe("faltasCad — Dev :1280-1295", () => {
  it("lista consumo / largura / metragem planejada que faltam; vazio sem linha", () => {
    expect(faltasCad([])).toEqual([]);
    const semLargura = { ...hidratadoComCad()[0], largura: 0 };
    expect(faltasCad([semLargura])).toEqual(["largura do tecido", "metragem planejada"]);
  });
});

describe("montarCadPayload — Dev :2062-2119", () => {
  const estado = hidratadoComCad();
  const p = montarCadPayload({
    cad: estado,
    grades: [{ variante_numero: 1, grades: { P: 4, M: 8, G: 8, GG: 4 }, grade_total: 24 }, { variante_numero: 2, grades: {}, grade_total: 0 }],
    aviamentos: [
      { aviamento_id: "av1", variante_aviamento_id: null, consumo: 2, loss_percent: 0, custo_previsto: 0 },
      { aviamento_id: null, variante_aviamento_id: null, consumo: 9, loss_percent: 0, custo_previsto: 0 },
    ],
    etiquetas: [
      { etiqueta_id: "e1", cor_id: null, consumo: 1, loss_percent: 0, custo_previsto: 0 },
      { etiqueta_id: null, cor_id: null, consumo: 5, loss_percent: 0, custo_previsto: 0 },
    ],
    proporcoes: { P: 1, M: 2, G: 2, GG: 1 },
  });
  it("grade só com valor; aviamentos/etiquetas = consumo × grade total geral; obs. do molde e envio por tamanho zerados (paridade)", () => {
    expect(p._grades.map((g) => g.variante_numero)).toEqual([1]);
    expect(p._aviamentos).toEqual([{ aviamento_id: "av1", variante_aviamento_id: null, numero: 1, consumo: 2, quantidade_enviar: 48, quantidade_separar: 48 }]);
    expect(p._etiquetas).toEqual([{ etiqueta_id: "e1", cor_id: null, consumo: 1, quantidade_planejada: 24, quantidade_enviar: 24, enviar_por_tamanho: {} }]);
    expect(p._observacoes_molde).toBeNull();
    expect(p._data_previsao_corte).toBeNull();
    expect(p._proporcoes).toEqual({ P: 1, M: 2, G: 2, GG: 1 });
  });
  it("tecidos levam consumo/%loss/folha e as variantes (ordem, multiplicador, folhas, metragens)", () => {
    expect(p._tecidos[0]).toMatchObject({ artigo_id: A, numero: 1, tipo: "tecido", consumo_cad: 1.85, loss_percent_cad: 3, tamanho_folha: 1.2 });
    expect(p._tecidos[0].variantes[0]).toEqual({ variante_tecido_id: V1, ordem: 1, multiplicador: 1, quantidade_folhas: 4, metragem_planejada: 45.73, metragem_enviada: 0 });
  });
});

describe("linhasParaGravar — linha que o servidor não tem só vai quando o BOM também grava", () => {
  const nova: CadTecidoRow = { ...hidratadoComCad()[0], id: undefined, tipo: "tecido", numero: 2 };
  const linhas = [...hidratadoComCad(), nova];
  const servidor = new Set(["tecido|1", "forro|1"]);
  it("BOM não grava ⇒ só linhas com id ou que o BOM do servidor tem", () => {
    expect(linhasParaGravar(linhas, { bomGravado: false, chavesBomServidor: servidor }).map((t) => `${t.tipo}${t.numero}`)).toEqual(["tecido1", "forro1"]);
  });
  it("BOM grava ⇒ todas", () => {
    expect(linhasParaGravar(linhas, { bomGravado: true, chavesBomServidor: servidor })).toHaveLength(3);
  });
});

describe("snapshot e assinatura do CAD", () => {
  const base = hidratadoComCad();
  it("snapshot ignora rótulos/preço/custo e muda com a folha", () => {
    const rotulo = base.map((t) => ({ ...t, artigo_nome: "outro", preco: 99, custo_cad: 1, variantes: t.variantes.map((v) => ({ ...v, variante_nome: "x" })) }));
    expect(snapshotCad(rotulo)).toBe(snapshotCad(base));
    expect(snapshotCad(atualizarVarianteCad(base, 0, 0, { quantidade_folhas: 5 }))).not.toBe(snapshotCad(base));
  });
  it("assinatura: só o que é DO CAD e ≠ 0 (consumo é do BOM; linha zerada = ausente)", () => {
    const semZeros = base.map((t) => ({ ...t, variantes: t.variantes.filter((v) => v.quantidade_folhas > 0) }));
    expect(assinaturaCad(semZeros)).toBe(assinaturaCad(base));
    expect(assinaturaCad(propagarBlocoParaCad(base, "tecido", 1, { consumo: 3 }, ctx))).toBe(assinaturaCad(base));
    expect(assinaturaCad([...base].reverse())).toBe(assinaturaCad(base));
    expect(assinaturaCad(atualizarLinhaCad(base, 0, { tamanho_folha: 2 }))).not.toBe(assinaturaCad(base));
  });
  it("escala do BANCO: qtd de folhas INTEGER, metragens e folha NUMERIC(10,2) — meio p/ longe do zero (sem conflito falso no eco)", () => {
    // O eco do servidor de 4,17 folhas / 45,734 m é 4 / 45,73 (salvar_cad_completo: ::numeric num INTEGER e num (10,2)).
    const local = atualizarVarianteCad(base, 0, 0, { quantidade_folhas: 4.17, metragem_planejada: 45.734 });
    expect(assinaturaCad(local)).toBe(assinaturaCad(base));
    expect(assinaturaCad(atualizarVarianteCad(base, 0, 0, { quantidade_folhas: 4.5 }))).not.toBe(assinaturaCad(base));
    expect(assinaturaCad(atualizarLinhaCad(base, 0, { tamanho_folha: 1.3 }))).not.toBe(assinaturaCad(base));
    // Empate decimal como o numeric (pelo expoente — mesmo método da assinaturaBom da F3.2): 1,205 → 1,21.
    expect(assinaturaCad(atualizarLinhaCad(base, 0, { tamanho_folha: 1.205 }))).toBe(assinaturaCad(atualizarLinhaCad(base, 0, { tamanho_folha: 1.21 })));
  });
  it("servidor × referência: a assinatura do servidor é a do estado hidratado; só o que é DO CAD acende", () => {
    const ref = assinaturaCad(base);
    expect(assinaturaCadServidor(cadServidor)).toBe(ref);
    expect(assinaturaCadServidor(null)).toBe("");
    expect(cadDivergeDaReferencia(ref, cadServidor)).toBe(false);
    expect(cadDivergeDaReferencia(null, cadServidor)).toBe(true);
    const outro: CadRowDb = { ...cadServidor, cad_tecidos: [{ ...cadServidor.cad_tecidos![0], tamanho_folha: 2 }] };
    expect(cadDivergeDaReferencia(ref, outro)).toBe(true);
    const soConsumo: CadRowDb = { ...cadServidor, cad_tecidos: [{ ...cadServidor.cad_tecidos![0], consumo_cad: 9 }] };
    expect(cadDivergeDaReferencia(ref, soConsumo)).toBe(false); // consumo é do BOM (já na assinaturaBom)
  });
});

describe("deveGravarCad — quando o Salvar grava o CAD (§3 P2, D2)", () => {
  const ok = { podeEditar: true, cadHidratado: true, cadExiste: true, ordemEnviada: true, linhas: 2, tocado: false, retry: false, recarregando: false };
  it("paridade com o Dev: todo Salvar regrava (1ª tentativa, sem recarga em curso)", () => {
    expect(deveGravarCad(ok)).toBe(true);
  });
  it("nunca sem editar / sem carregar / sem linha", () => {
    expect(deveGravarCad({ ...ok, podeEditar: false })).toBe(false);
    expect(deveGravarCad({ ...ok, cadHidratado: false })).toBe(false);
    expect(deveGravarCad({ ...ok, linhas: 0 })).toBe(false);
  });
  it("D2: antes da Ordem de Criação e sem CAD, não cria o CAD", () => {
    expect(deveGravarCad({ ...ok, cadExiste: false, ordemEnviada: false, tocado: true })).toBe(false);
    expect(deveGravarCad({ ...ok, cadExiste: false, ordemEnviada: true })).toBe(true);
  });
  it("sem toque, estado possivelmente velho (retry do P0409 ou recarga em curso) ⇒ não grava", () => {
    expect(deveGravarCad({ ...ok, retry: true })).toBe(false);
    expect(deveGravarCad({ ...ok, recarregando: true })).toBe(false);
  });
  it("P2: tocado ⇒ grava (o BOM grava junto), mesmo no retry e com recarga", () => {
    expect(deveGravarCad({ ...ok, tocado: true, retry: true, recarregando: true })).toBe(true);
  });
});

describe("idsVariantesDosBlocos — Dev :1274-1278", () => {
  it("todas as variantes de todos os blocos, sem repetição, ordenadas", () => {
    expect(idsVariantesDosBlocos(blocos(bloco("tecido", 1, { variantes: vars(V2, V1) }), bloco("forro", 1, { variantes: vars(V1, VF) })))).toEqual([V1, V2, VF].sort());
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit/ficha-cad.test.ts`
Expected: FAIL — o import de `ficha-cad` não resolve.

- [ ] **Step 3: Implementar `ficha-cad.ts`**

Criar `src/components/planejamento/planejamento-detail/ficha/ficha-cad.ts`:

```ts
// F3.3 (Planejamento unificado) — contas PURAS da seção "CAD" do Sheet do Planejamento de Produto. PORTADAS (cópia) do
// `PanelContent` do Desenvolvimento (src/components/desenvolvimento/ModeloDetailPanel.tsx), que fica INTOCADO até a F5
// (decisão travada 8). Cada função cita a faixa de origem; as diferenças deliberadas estão marcadas "F3.3 (T…)" e
// registradas no plano F3.3 (§7). Sem React e sem Supabase — testadas em tests/unit/ficha-cad.test.ts. Tipos e
// `calcCusto` vêm de src/components/producao/cad/types.ts (só importados).
import { gradeEfetivaPar } from "@/lib/casar-variantes-grade";
import {
  calcCusto,
  type TecidoRow as CadTecidoRow,
  type VarianteRow as CadVarianteRow,
  type TipoTec,
} from "@/components/producao/cad/types";
import type { AviamentoRow, GradeRow, ModeloEtiquetaRow, TecidoBlock } from "@/components/desenvolvimento/modelo-detail/types";
import { montarAviamentosPayload, montarGradesPayload, type TecidoRowDb, type VarianteRowDb } from "./ficha-calc";

export type { CadTecidoRow, CadVarianteRow, TipoTec };

// Linhas cruas do CAD — o MESMO select do Dev (ModeloDetailPanel.tsx:529-532), embutido a partir de `cad`.
export type CadVarianteRowDb = {
  id: string; variante_tecido_id: string | null; ordem: number | null; multiplicador: number | null;
  quantidade_folhas: number | null; metragem_planejada: number | null; metragem_enviada: number | null;
  complementa_variante_ids: string[] | null;
  variantes_tecido?: {
    nome_variante: string | null; codigo_variante: string | null;
    cor?: { nome: string | null } | null; apelido?: { nome: string | null } | null;
  } | null;
};
export type CadTecidoRowDb = {
  id: string; numero: number; tipo: string; artigo_id: string | null;
  consumo_cad: number | null; loss_percent_cad: number | null; custo_cad: number | null; tamanho_folha: number | null;
  artigos?: {
    nome: string | null; preco_por_metro: number | null; unidade_medida: string | null;
    etiqueta_lavagem_urls: string[] | null; largura_estimada: number | null;
  } | null;
  cad_tecido_variantes?: CadVarianteRowDb[] | null;
};
export type CadRowDb = { id: string; cad_tecidos?: CadTecidoRowDb[] | null };
/** O que a carga precisa do cadastro de artigos (subconjunto de `ArtigoFicha`, useFichaDados). */
export type ArtigoCad = { nome: string; preco_por_metro: number | null; largura_estimada: number | null };
export type RotulosVariante = Record<string, { nome: string | null; cor: string | null; apelido: string | null }>;
/** O que muda no bloco e precisa ir à linha do CAD (propagação BOM → CAD). */
export type PatchBlocoCad = { consumo?: number; loss_percent?: number; artigo_id?: string | null };
type CtxCad = { artigoMap: Record<string, ArtigoCad>; frozen: Record<string, number> };

const TIPO_ORDEM: Record<string, number> = { tecido: 0, forro: 1, entretela: 2 };
const ordenar = (rows: CadTecidoRow[]) =>
  [...rows].sort((a, b) => (TIPO_ORDEM[a.tipo] ?? 9) - (TIPO_ORDEM[b.tipo] ?? 9) || a.numero - b.numero);
/** Preço/m da linha: o congelado pela OC vinculada (`tipo|numero`, Dev :1059-1060) ou o do artigo. */
const precoTec = (frozen: Record<string, number>, tipo: string, numero: number, artigoPpm: number) =>
  Number(frozen[`${tipo}|${numero}`] ?? artigoPpm);

function varianteDoBom(v: VarianteRowDb): CadVarianteRow {
  return {
    variante_tecido_id: v.variante_tecido_id,
    variante_nome: null, variante_cor: null, variante_apelido: null,
    multiplicador: Number(v.multiplicador ?? 1) || 1,
    ordem: v.ordem ?? 0,
    quantidade_folhas: 0, metragem_planejada: 0, metragem_enviada: 0,
    complementa_variante_ids: v.complementa_variante_ids ?? null,
  };
}

function linhaDoBom(mt: TecidoRowDb, variantes: VarianteRowDb[], ctx: CtxCad): CadTecidoRow {
  const art = mt.artigo_id ? ctx.artigoMap[mt.artigo_id] : undefined;
  const preco = precoTec(ctx.frozen, mt.tipo, mt.numero, Number(art?.preco_por_metro ?? 0));
  const consumo = Number(mt.consumo ?? 0);
  const loss = Number(mt.loss_percent ?? 0);
  return {
    numero: mt.numero, tipo: mt.tipo as TipoTec, artigo_id: mt.artigo_id,
    consumo_cad: consumo, loss_percent_cad: loss, custo_cad: calcCusto(consumo, loss, preco),
    tamanho_folha: 0, preco, largura: Number(art?.largura_estimada ?? 0),
    artigo_nome: art?.nome ?? null, etiqueta_lavagem_urls: [],
    variantes: variantes.filter((v) => v.modelo_tecido_id === mt.id).map(varianteDoBom),
  };
}

/**
 * Carga do CAD (Dev :1040-1174). Com CAD no servidor: as linhas dele (valores e rótulos) + os blocos/variantes do BOM
 * que o CAD ainda não tem (zerados — Dev :1110-1145). Sem CAD: semeia do BOM, folhas/metragem zeradas (:1146-1168).
 * Ordem: Tecido → Forro → Entretela, por número (:1170-1171).
 */
export function hidratarCad(i: {
  cad: CadRowDb | null;
  bomTecidos: TecidoRowDb[];
  bomVariantes: VarianteRowDb[];
  artigoMap: Record<string, ArtigoCad>;
  frozen: Record<string, number>;
}): CadTecidoRow[] {
  const ctx: CtxCad = { artigoMap: i.artigoMap, frozen: i.frozen };
  const doServidor = i.cad?.cad_tecidos ?? [];
  if (doServidor.length === 0) return ordenar(i.bomTecidos.map((mt) => linhaDoBom(mt, i.bomVariantes, ctx)));
  const linhas: CadTecidoRow[] = doServidor.map((t) => ({
    id: t.id, numero: t.numero, tipo: t.tipo as TipoTec, artigo_id: t.artigo_id,
    consumo_cad: Number(t.consumo_cad ?? 0), loss_percent_cad: Number(t.loss_percent_cad ?? 0),
    custo_cad: Number(t.custo_cad ?? 0), tamanho_folha: Number(t.tamanho_folha ?? 0),
    preco: precoTec(i.frozen, t.tipo, t.numero, Number(t.artigos?.preco_por_metro ?? 0)),
    largura: Number(t.artigos?.largura_estimada ?? 0),
    artigo_nome: t.artigos?.nome
      ? (t.artigos.unidade_medida ? `${t.artigos.nome} [${t.artigos.unidade_medida}]` : t.artigos.nome)
      : null,
    etiqueta_lavagem_urls: (t.artigos?.etiqueta_lavagem_urls ?? []) as string[],
    variantes: (t.cad_tecido_variantes ?? []).map((v): CadVarianteRow => ({
      id: v.id,
      variante_tecido_id: v.variante_tecido_id,
      variante_nome: v.variantes_tecido?.nome_variante ?? v.variantes_tecido?.codigo_variante ?? null,
      variante_cor: v.variantes_tecido?.cor?.nome ?? null,
      variante_apelido: v.variantes_tecido?.apelido?.nome ?? null,
      multiplicador: Number(v.multiplicador ?? 1) || 1,
      ordem: v.ordem ?? 0,
      quantidade_folhas: Number(v.quantidade_folhas ?? 0),
      metragem_planejada: Number(v.metragem_planejada ?? 0),
      metragem_enviada: Number(v.metragem_enviada ?? 0),
      complementa_variante_ids: v.complementa_variante_ids ?? null,
    })),
  }));
  for (const mt of i.bomTecidos) {
    const existente = linhas.find((t) => t.tipo === mt.tipo && t.numero === mt.numero);
    if (!existente) { linhas.push(linhaDoBom(mt, i.bomVariantes, ctx)); continue; }
    const tem = new Set(existente.variantes.map((v) => v.variante_tecido_id).filter(Boolean));
    let acrescentou = false;
    for (const v of i.bomVariantes.filter((x) => x.modelo_tecido_id === mt.id)) {
      if (v.variante_tecido_id && !tem.has(v.variante_tecido_id)) { existente.variantes.push(varianteDoBom(v)); acrescentou = true; }
    }
    if (acrescentou) existente.variantes.sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
  }
  return ordenar(linhas);
}

/** Todas as variantes de todos os blocos, sem repetição, ordenadas (Dev :1274-1278) — rótulos da seção CAD. */
export function idsVariantesDosBlocos(blocks: TecidoBlock[]): string[] {
  const s = new Set<string>();
  blocks.forEach((b) => b.variantes.forEach((v) => { if (v) s.add(v); }));
  return Array.from(s).sort();
}

function variantesDoBloco(b: TecidoBlock): { variante_tecido_id: string; ordem: number; multiplicador: number; complementa_variante_ids: string[] | null }[] {
  const out: { variante_tecido_id: string; ordem: number; multiplicador: number; complementa_variante_ids: string[] | null }[] = [];
  b.variantes.forEach((vid, i) => {
    if (vid) out.push({
      variante_tecido_id: vid,
      ordem: i + 1,
      multiplicador: Number(b.multiplicadores?.[i] ?? 1) || 1,
      complementa_variante_ids: (b.complementas?.[i] as string[] | null) ?? null,
    });
  });
  return out;
}

/**
 * Sincronia BOM → CAD depois da carga (Dev :1314-1386): as variantes de cada linha seguem as do bloco do mesmo
 * tipo+número (ordem, multiplicador, casamento e rótulo; nova entra zerada; removida sai; o digitado das que ficam é
 * preservado). F3.3 (T4): bloco COM artigo sem linha no CAD ganha a linha já (a MESMA que a carga criaria — Dev
 * :1116-1133); linha SEM `id` (ainda não gravada) sai quando o bloco perde o artigo; linha com `id` (do servidor)
 * nunca sai — paridade. Devolve `prev` (mesma referência) quando nada muda — sem laço de efeito.
 */
export function sincronizarCadComBlocos(prev: CadTecidoRow[], blocks: TecidoBlock[], rotulos: RotulosVariante, ctx: CtxCad): CadTecidoRow[] {
  let changed = false;
  const next: CadTecidoRow[] = [];
  for (const cadTec of prev) {
    const block = blocks.find((b) => b.tipo === cadTec.tipo && b.numero === cadTec.numero);
    if (!block) { next.push(cadTec); continue; }
    if (!cadTec.id && !block.artigo_id) { changed = true; continue; }
    const have = new Map(cadTec.variantes.map((v) => [v.variante_tecido_id, v]));
    let mudou = false;
    const nextVariantes = variantesDoBloco(block).map(({ variante_tecido_id, ordem, multiplicador, complementa_variante_ids }) => {
      const existing = have.get(variante_tecido_id);
      const info = rotulos[variante_tecido_id];
      const nome = info?.nome ?? existing?.variante_nome ?? null;
      const cor = info?.cor ?? existing?.variante_cor ?? null;
      const apelido = info?.apelido ?? existing?.variante_apelido ?? null;
      if (existing) {
        const compChanged = JSON.stringify(existing.complementa_variante_ids ?? null) !== JSON.stringify(complementa_variante_ids);
        if (existing.ordem !== ordem || existing.multiplicador !== multiplicador || compChanged
          || existing.variante_nome !== nome || existing.variante_cor !== cor || existing.variante_apelido !== apelido) {
          mudou = true;
          return { ...existing, ordem, multiplicador, complementa_variante_ids, variante_nome: nome, variante_cor: cor, variante_apelido: apelido };
        }
        return existing;
      }
      mudou = true;
      return {
        variante_tecido_id, variante_nome: nome, variante_cor: cor, variante_apelido: apelido,
        multiplicador, ordem, quantidade_folhas: 0, metragem_planejada: 0, metragem_enviada: 0, complementa_variante_ids,
      } as CadVarianteRow;
    });
    if (nextVariantes.length !== cadTec.variantes.length) mudou = true;
    if (!mudou && nextVariantes.every((v, k) => v === cadTec.variantes[k])) { next.push(cadTec); continue; }
    changed = true;
    next.push({ ...cadTec, variantes: nextVariantes });
  }
  for (const b of blocks) {
    if (!b.artigo_id || next.some((t) => t.tipo === b.tipo && t.numero === b.numero)) continue;
    changed = true;
    const art = ctx.artigoMap[b.artigo_id];
    const preco = precoTec(ctx.frozen, b.tipo, b.numero, Number(art?.preco_por_metro ?? 0));
    const consumo = b.consumo || 0;
    const loss = b.loss_percent || 0;
    next.push({
      numero: b.numero, tipo: b.tipo, artigo_id: b.artigo_id,
      consumo_cad: consumo, loss_percent_cad: loss, custo_cad: calcCusto(consumo, loss, preco),
      tamanho_folha: 0, preco, largura: Number(art?.largura_estimada ?? 0),
      artigo_nome: art?.nome ?? null, etiqueta_lavagem_urls: [],
      variantes: variantesDoBloco(b).map((v) => ({
        ...v,
        variante_nome: rotulos[v.variante_tecido_id]?.nome ?? null,
        variante_cor: rotulos[v.variante_tecido_id]?.cor ?? null,
        variante_apelido: rotulos[v.variante_tecido_id]?.apelido ?? null,
        quantidade_folhas: 0, metragem_planejada: 0, metragem_enviada: 0,
      })),
    });
  }
  return changed ? ordenar(next) : prev;
}

/**
 * Propagação BOM → CAD (Dev :2441-2456): consumo/%loss do bloco vão para a linha do mesmo tipo+número, com o custo
 * recalculado. F3.3 (T4): trocar o artigo do bloco leva artigo/preço/largura/nome à linha (no Dev a linha ficava com o
 * artigo antigo e as variantes do novo). Só roda por AÇÃO do usuário (handlers/Importar) — nunca muda o CAD sozinho.
 */
export function propagarBlocoParaCad(prev: CadTecidoRow[], tipo: string, numero: number, patch: PatchBlocoCad, ctx: CtxCad): CadTecidoRow[] {
  let changed = false;
  const next = prev.map((t) => {
    if (t.tipo !== tipo || t.numero !== numero) return t;
    let linha = t;
    if (patch.artigo_id && patch.artigo_id !== t.artigo_id) {
      const art = ctx.artigoMap[patch.artigo_id];
      linha = {
        ...linha, artigo_id: patch.artigo_id, artigo_nome: art?.nome ?? null, etiqueta_lavagem_urls: [],
        preco: precoTec(ctx.frozen, t.tipo, t.numero, Number(art?.preco_por_metro ?? 0)),
        largura: Number(art?.largura_estimada ?? 0),
      };
    }
    if (patch.consumo !== undefined && patch.consumo !== linha.consumo_cad) linha = { ...linha, consumo_cad: patch.consumo };
    if (patch.loss_percent !== undefined && patch.loss_percent !== linha.loss_percent_cad) linha = { ...linha, loss_percent_cad: patch.loss_percent };
    if (linha === t) return t;
    changed = true;
    return { ...linha, custo_cad: calcCusto(linha.consumo_cad, linha.loss_percent_cad, linha.preco) };
  });
  return changed ? next : prev;
}

/** Edição da linha na seção CAD (Dev :1180-1186): recalcula o custo. */
export function atualizarLinhaCad(prev: CadTecidoRow[], i: number, patch: Partial<CadTecidoRow>): CadTecidoRow[] {
  const next = [...prev];
  const merged = { ...next[i], ...patch };
  merged.custo_cad = calcCusto(merged.consumo_cad, merged.loss_percent_cad, merged.preco);
  next[i] = merged;
  return next;
}

/** Edição da variante na seção CAD (Dev :1212-1220). */
export function atualizarVarianteCad(prev: CadTecidoRow[], i: number, j: number, patch: Partial<CadVarianteRow>): CadTecidoRow[] {
  const next = [...prev];
  const variantes = [...next[i].variantes];
  variantes[j] = { ...variantes[j], ...patch };
  next[i] = { ...next[i], variantes };
  return next;
}

/**
 * Folhas/metragem automáticas (Dev :1222-1269, idêntico ao CadEditor): peças da variante = grade da posição (ou, na
 * complementar casada, a Σ das grades das cores do Tecido 1 — `gradeEfetivaPar`) × multiplicador; folhas = peças ÷
 * Σproporção; metragem = peças × consumo × (1 + %loss); folha = (Σ peças × consumo ÷ Σ folhas) ÷ largura.
 */
export function calcularFolhasAuto(prev: CadTecidoRow[], grades: GradeRow[], proporcoes: Record<string, number>): CadTecidoRow[] {
  const somaProp = Object.values(proporcoes ?? {}).reduce((a: number, b) => a + (Number(b) || 0), 0);
  const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
  const gradeDe = (n: number) => grades.find((g) => g.variante_numero === n)?.grade_total ?? 0;
  const porVarianteT1 = new Map<string, number>();
  prev.find((b) => b.tipo === "tecido" && b.numero === 1)?.variantes.forEach((v) => {
    if (v.variante_tecido_id) porVarianteT1.set(v.variante_tecido_id, gradeDe(v.ordem));
  });
  let changed = false;
  const next = prev.map((t) => {
    const lossFactor = 1 + (Number(t.loss_percent_cad) || 0) / 100;
    let baseMetragem = 0;
    const isTecido1 = t.tipo === "tecido" && t.numero === 1;
    const variantes = t.variantes.map((v) => {
      const mult = Number(v.multiplicador ?? 1) || 1;
      const pecas = gradeEfetivaPar({ isTecido1, complementaIds: v.complementa_variante_ids, gradePosicao: gradeDe(v.ordem), gradePorVarianteTecido1: porVarianteT1 }) * mult;
      const quantidade_folhas = somaProp > 0 ? round2(pecas / somaProp) : 0;
      const base = pecas * (t.consumo_cad || 0);
      baseMetragem += base;
      const metragem_planejada = round2(base * lossFactor);
      if (v.quantidade_folhas !== quantidade_folhas || v.metragem_planejada !== metragem_planejada) changed = true;
      return { ...v, quantidade_folhas, metragem_planejada };
    });
    const totalFolhas = variantes.reduce((a, v) => a + v.quantidade_folhas, 0);
    const media = totalFolhas > 0 ? baseMetragem / totalFolhas : 0;
    const largura = Number(t.largura || 0);
    const tamanho_folha = largura > 0 ? round2(media / largura) : 0;
    if (t.tamanho_folha !== tamanho_folha) changed = true;
    return { ...t, variantes, tamanho_folha };
  });
  return changed ? next : prev;
}

/** Selo da seção CAD (Dev :1280-1295): o que falta para o CAD ser usável. Vazio sem linha. */
export function faltasCad(cad: CadTecidoRow[]): string[] {
  if (cad.length === 0) return [];
  const faltas = new Set<string>();
  for (const t of cad) {
    if (Number(t.consumo_cad ?? 0) <= 0) faltas.add("consumo");
    if (Number(t.largura ?? 0) <= 0) faltas.add("largura do tecido");
    for (const v of t.variantes) if (Number(v.metragem_planejada ?? 0) <= 0) faltas.add("metragem planejada");
  }
  return Array.from(faltas);
}

/**
 * F3.3 — linhas que ESTE Salvar pode gravar. Linha que o servidor não tem (sem `id` e fora do BOM do servidor — ex.:
 * Tecido 1 pré-preenchido pela lista num card sem BOM) só vai quando o BOM também grava; senão o CAD ganharia um tecido
 * que o BOM não tem.
 */
export function linhasParaGravar(cad: CadTecidoRow[], o: { bomGravado: boolean; chavesBomServidor: ReadonlySet<string> }): CadTecidoRow[] {
  return cad.filter((t) => !!t.id || o.bomGravado || o.chavesBomServidor.has(`${t.tipo}|${t.numero}`));
}

export type CadPayload = {
  _tecidos: {
    artigo_id: string | null; numero: number; tipo: TipoTec;
    consumo_cad: number; loss_percent_cad: number; custo_cad: number; tamanho_folha: number;
    variantes: { variante_tecido_id: string | null; ordem: number; multiplicador: number; quantidade_folhas: number; metragem_planejada: number; metragem_enviada: number }[];
  }[];
  _grades: GradeRow[];
  _aviamentos: { aviamento_id: string; variante_aviamento_id: string | null; numero: number; consumo: number; quantidade_enviar: number; quantidade_separar: number }[];
  _etiquetas: { etiqueta_id: string; cor_id: string | null; consumo: number; quantidade_planejada: number; quantidade_enviar: number; enviar_por_tamanho: Record<string, number> }[];
  _proporcoes: Record<string, number>;
  _observacoes_molde: null;
  _data_previsao_corte: null;
};
/**
 * O CAD capturado no início do Salvar (vai no `BomCapturado.cad` — ficha-calc.ts). `estado` = todas as linhas da tela
 * (re-base do "não salvo"); `linhas` = as que ESTE Salvar grava (`linhasParaGravar` — referência do conflito depois de
 * gravar); `payload` só quando `gravar`.
 */
export type CadCapturado = { estado: CadTecidoRow[]; linhas: CadTecidoRow[]; snapshot: string; gravar: boolean; payload: CadPayload | null };

/**
 * Argumentos do `salvar_cad_completo` (Dev :2067-2117): grade só das variantes com valor; aviamentos e etiquetas com a
 * quantidade = consumo × grade total geral (fórmula do `_enviar_modelo_para_cad_core`); `enviar_por_tamanho: {}` e
 * `_observacoes_molde: null` — paridade (o apagamento desses ajustes da Explosão é tarefa própria — decisão F3 #7).
 */
export function montarCadPayload(i: {
  cad: CadTecidoRow[]; grades: GradeRow[]; aviamentos: AviamentoRow[]; etiquetas: ModeloEtiquetaRow[]; proporcoes: Record<string, number>;
}): CadPayload {
  const round4 = (n: number) => Math.round(n * 10000) / 10000;
  const gradeTotalGeral = i.grades.reduce((s, g) => s + (g.grade_total || 0), 0);
  return {
    _tecidos: i.cad.map((t) => ({
      artigo_id: t.artigo_id, numero: t.numero, tipo: t.tipo,
      consumo_cad: t.consumo_cad, loss_percent_cad: t.loss_percent_cad, custo_cad: t.custo_cad, tamanho_folha: t.tamanho_folha,
      variantes: t.variantes.map((v) => ({
        variante_tecido_id: v.variante_tecido_id, ordem: v.ordem, multiplicador: Number(v.multiplicador ?? 1) || 1,
        quantidade_folhas: v.quantidade_folhas, metragem_planejada: v.metragem_planejada, metragem_enviada: v.metragem_enviada,
      })),
    })),
    _grades: montarGradesPayload(i.grades).filter(
      (g) => (g.grade_total || 0) > 0 || Object.values(g.grades || {}).some((v) => (Number(v) || 0) > 0),
    ),
    _aviamentos: montarAviamentosPayload(i.aviamentos).map((a, k) => ({
      aviamento_id: a.aviamento_id, variante_aviamento_id: a.variante_aviamento_id || null, numero: k + 1, consumo: a.consumo || 0,
      quantidade_enviar: round4((a.consumo || 0) * gradeTotalGeral), quantidade_separar: round4((a.consumo || 0) * gradeTotalGeral),
    })),
    _etiquetas: i.etiquetas.filter((e) => e.etiqueta_id).map((e) => ({
      etiqueta_id: e.etiqueta_id as string, cor_id: e.cor_id ?? null, consumo: Number(e.consumo ?? 0),
      quantidade_planejada: round4(Number(e.consumo ?? 0) * gradeTotalGeral),
      quantidade_enviar: round4(Number(e.consumo ?? 0) * gradeTotalGeral),
      enviar_por_tamanho: {},
    })),
    _proporcoes: i.proporcoes ?? {},
    _observacoes_molde: null,
    _data_previsao_corte: null,
  };
}

/** "Não salvo" do CAD: o que o usuário edita e o Salvar grava — sem ids, rótulos, preço, largura e custo (derivados). */
export function snapshotCad(cad: CadTecidoRow[]): string {
  return JSON.stringify(cad.map((t) => ({
    tipo: t.tipo, numero: t.numero, artigo_id: t.artigo_id,
    consumo_cad: t.consumo_cad, loss_percent_cad: t.loss_percent_cad, tamanho_folha: t.tamanho_folha,
    variantes: t.variantes.map((v) => ({
      variante_tecido_id: v.variante_tecido_id, ordem: v.ordem, multiplicador: v.multiplicador,
      quantidade_folhas: v.quantidade_folhas, metragem_planejada: v.metragem_planejada, metragem_enviada: v.metragem_enviada,
      complementa_variante_ids: v.complementa_variante_ids ?? null,
    })),
  })));
}

/**
 * Arredonda como o `numeric`/`integer` do Postgres guarda (meio p/ longe do zero), pelo EXPOENTE em string — o MESMO
 * método do `roundNumeric` da assinatura do BOM (ficha-calc.ts, fix round 2 da F3.2; privado lá): `abs * 10**n` erra
 * empates decimais no float (1,005 × 100 ≠ 100,5), o parser decimal de `"1.005e2"` não. Escalas do banco (cópia, 24/set):
 * `cad_tecido_variantes.quantidade_folhas` INTEGER (o `salvar_cad_completo` faz `::numeric` e o INSERT arredonda);
 * `metragem_planejada`/`metragem_enviada` e `cad_tecidos.tamanho_folha` NUMERIC(10,2).
 */
function arredBanco(x: unknown, casas: number): number {
  const n = Number(x) || 0;
  if (n === 0) return 0;
  const abs = Math.abs(n);
  return Math.sign(n) * Number(Math.round(Number(abs + "e" + casas)) + "e-" + casas);
}

/**
 * Assinatura do que é DO CAD (folha, qtd de folhas, metragens) e ≠ 0, por tipo+número+variante, em ordem estável e na
 * escala do BANCO (o cálculo automático gera 4,17 folhas; o servidor devolve 4 — sem isso o eco do próprio Salvar
 * acenderia "Tecidos & BOM"). Consumo/%loss/artigo/variantes/multiplicador são do BOM (já na `assinaturaBom`); linha/
 * variante zerada = ausente (a carga cria zeradas as que o CAD não tem — sem isso toda carga "divergiria").
 */
export function assinaturaCad(cad: CadTecidoRow[]): string {
  const partes: string[] = [];
  for (const t of cad) {
    const folha = arredBanco(t.tamanho_folha, 2);
    if (folha > 0) partes.push(`t|${t.tipo}|${t.numero}|${folha}`);
    for (const v of t.variantes) {
      const qf = arredBanco(v.quantidade_folhas, 0), mp = arredBanco(v.metragem_planejada, 2), me = arredBanco(v.metragem_enviada, 2);
      if (qf > 0 || mp > 0 || me > 0) partes.push(`v|${t.tipo}|${t.numero}|${v.variante_tecido_id ?? ""}|${qf}|${mp}|${me}`);
    }
  }
  return partes.sort().join(";");
}

/** Assinatura do CAD do SERVIDOR (linha crua de `plan-ficha-cad`); sem CAD = "". */
export function assinaturaCadServidor(cad: CadRowDb | null): string {
  return assinaturaCad(hidratarCad({ cad, bomTecidos: [], bomVariantes: [], artigoMap: {}, frozen: {} }));
}

/** O CAD do servidor diverge da referência (o que o usuário tinha do servidor ao editar)? Sem referência = diverge. */
export function cadDivergeDaReferencia(referencia: string | null, cad: CadRowDb | null): boolean {
  return referencia === null || assinaturaCadServidor(cad) !== referencia;
}

/**
 * O Salvar grava o CAD? Paridade com o Dev (decisão F3 #7: "todo Salvar regrava", ModeloDetailPanel.tsx:2067) com
 * guardas: (1) ficha editável (carregada, com permissão, sem trava pós-Explosão) e CAD carregado; (2) há linha a
 * gravar — `salvar_cad_completo` com lista vazia apagaria o CAD (funcoes.sql:6779); (3) D2: antes da Ordem de Criação o
 * Planejamento NÃO cria o CAD (FK `cad.modelo_id` NO ACTION — o card não se excluiria mais); (4) sem toque, só na 1ª
 * tentativa e sem recarga em curso: o estado local pode estar VELHO (o `.eq("rev")` passou, mas a recarga pedida pelo
 * Realtime ainda não chegou) e o CAD regravaria grade e consumo velhos no BOM (funcoes.sql:6797-6810, :6878-6881). Com
 * toque, a conferência com o servidor (R5/R5a da F3.2, agora com o CAD) já protege — e o BOM grava junto (§3 P2).
 * `tocado` = a ficha foi tocada OU o BOM grava neste Salvar (quem chama — `capturarCad`, useFichaTecnica — junta os dois).
 * `recarregando` = recarga EM CURSO (`bomFetching`) OU pedida e ainda não aplicada ao CAD (`cadVelhoRef`, R1 do G-plano
 * F3.3 — quem chama junta os dois; §7 T22).
 */
export function deveGravarCad(i: {
  podeEditar: boolean; cadHidratado: boolean; cadExiste: boolean; ordemEnviada: boolean;
  linhas: number; tocado: boolean; retry: boolean; recarregando: boolean;
}): boolean {
  if (!i.podeEditar || !i.cadHidratado || i.linhas === 0) return false;
  if (!i.cadExiste && !i.ordemEnviada) return false;
  if (i.tocado) return true;
  return !i.retry && !i.recarregando;
}
```

- [ ] **Step 4: Rodar e ver passar + gates**

Run: `env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit/ficha-cad.test.ts` → PASS. Depois `bash .superpowers/f33/gates.sh` → `GATES F3.3: ok`.
Se algum número de `calcularFolhasAuto` divergir, conferir linha a linha contra `ModeloDetailPanel.tsx:1229-1269` (a fonte é o Dev, não o teste) e reportar.

- [ ] **Step 5: Commit**

```bash
git add -- src/components/planejamento/planejamento-detail/ficha/ficha-cad.ts tests/unit/ficha-cad.test.ts
git commit --only -m "feat(planejamento): F3.3 (1) — ficha-cad.ts: contas puras do CAD portadas do Dev (carga, sincronia, propagação, folhas automáticas, payload) + regra de quando o Salvar grava o CAD

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- src/components/planejamento/planejamento-detail/ficha/ficha-cad.ts tests/unit/ficha-cad.test.ts
```

---

## Task 2: `envio-explosao.ts` + `importar-ficha.ts` — regras puras do envio e do Importar  *(Lote A)*

**Files:**
- Create: `src/components/planejamento/planejamento-detail/ficha/envio-explosao.ts`
- Create: `src/components/planejamento/planejamento-detail/ficha/importar-ficha.ts`
- Test: `tests/unit/planejamento-envio-explosao.test.ts`, `tests/unit/planejamento-importar-ficha.test.ts`

**Interfaces:**
- Consumes: `podeEnviarExplosao` (`@/lib/kanban-status`); `statusParaGate`, `Derivacao`, `KanbanAutoConfig` (`@/lib/kanban-auto`); `Draft`; `PatchCopia` (`@/components/desenvolvimento/importar/importar-copia`, só o tipo); `SecaoSheetKey` (Task 3 — import de TIPO; a Task 3 cria o arquivo, então este teste roda depois dela no mesmo lote: ordem de execução 1 → 3 → 2).
- Produces: `GateEnvio = { ok: boolean; carregando: boolean; reqLabel: string }`; `gateEnvioExplosao(i)`; `PendenciaEnvio = { label: string; secao: SecaoSheetKey }`; `pendenciasEnvioExplosao(i)`; `camposDoPatchNoDraft(p)`; `itensSobrescritos(p, atual, obsBloco)`.

> **Ordem no Lote A:** Task 1 → **Task 3** → Task 2 (o `envio-explosao.ts` importa o TIPO `SecaoSheetKey` de `selos-secoes.ts`).

- [ ] **Step 1: Escrever os testes (falham: módulos inexistentes)**

Criar `tests/unit/planejamento-envio-explosao.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { makeEmptyBlocks } from "@/components/desenvolvimento/modelo-detail/types";
import { emptyDraft, type Draft } from "@/components/planejamento/modelo-shared";
import type { Derivacao, KanbanAutoConfig } from "@/lib/kanban-auto";
import { gateEnvioExplosao, pendenciasEnvioExplosao } from "@/components/planejamento/planejamento-detail/ficha/envio-explosao";

// F3.3 — "Enviar à Explosão" no Sheet unificado: gate por etapa com a posição DERIVADA quando a chave está ligada
// (decisão travada 10; SQL `_explosao_envio_gate(_kanban_status_gate(...))`, F1 20260930140000:842) e a lista
// "Para enviar, falta" (Dev ModeloDetailPanel.tsx:1576-1595) com as seções do Sheet do Planejamento.
const board = [
  { key: "desenho_tecnico", label: "Desenho Técnico" }, { key: "em_modelagem", label: "Em Modelagem" },
  { key: "em_ajuste", label: "Em Ajuste" }, { key: "aprovado", label: "Aprovado" },
];
const cfg = (ligado: boolean): KanbanAutoConfig => ({
  kanban_automatico: ligado, status_kanban: board, kanban_requisitos: {}, kanban_requisitos_excecoes: {},
  revenda_kanban_colunas: [], revenda_kanban_requisitos: {},
});
const deriv = (alvo: string | null, derivavel = true): Derivacao => ({
  derivavel, entrada: "desenho_tecnico", alvo, resultado: "em_ajuste", fixado: true, primeiraFalha: null, faltando: [],
});

describe("gateEnvioExplosao", () => {
  it("chave desligada: status gravado antes da etapa exigida (padrão Aprovado) ⇒ bloqueia e diz a etapa", () => {
    expect(gateEnvioExplosao({ cfg: cfg(false), explosaoEnvioStatus: null, statusCru: "em_ajuste", derivacao: null, condProntas: true }))
      .toEqual({ ok: false, carregando: false, reqLabel: "Aprovado" });
  });
  it("chave desligada: na etapa ⇒ libera", () => {
    expect(gateEnvioExplosao({ cfg: cfg(false), explosaoEnvioStatus: null, statusCru: "aprovado", derivacao: null, condProntas: true }).ok).toBe(true);
  });
  it("chave LIGADA: card fixado em coluna manual antes da etapa, mas DERIVADO em Aprovado ⇒ libera (decisão 10)", () => {
    expect(gateEnvioExplosao({ cfg: cfg(true), explosaoEnvioStatus: null, statusCru: "em_ajuste", derivacao: deriv("aprovado"), condProntas: true }).ok).toBe(true);
  });
  it("chave LIGADA: gravado em Aprovado mas DERIVADO antes ⇒ bloqueia", () => {
    expect(gateEnvioExplosao({ cfg: cfg(true), explosaoEnvioStatus: null, statusCru: "aprovado", derivacao: deriv("em_modelagem"), condProntas: true }).ok).toBe(false);
  });
  it("chave LIGADA e condições ainda não carregadas ⇒ 'carregando' (não libera no escuro)", () => {
    expect(gateEnvioExplosao({ cfg: cfg(true), explosaoEnvioStatus: null, statusCru: "aprovado", derivacao: null, condProntas: false }))
      .toEqual({ ok: false, carregando: true, reqLabel: "" });
  });
  it("antes da Ordem de Criação (sem status) ⇒ bloqueia", () => {
    expect(gateEnvioExplosao({ cfg: cfg(false), explosaoEnvioStatus: null, statusCru: null, derivacao: null, condProntas: true }).ok).toBe(false);
  });
  it("etapa configurada pela loja (explosao_envio_status) vale", () => {
    expect(gateEnvioExplosao({ cfg: cfg(false), explosaoEnvioStatus: "em_modelagem", statusCru: "em_ajuste", derivacao: null, condProntas: true }).ok).toBe(true);
  });
});

describe("pendenciasEnvioExplosao", () => {
  const completo = (): Draft => ({
    ...emptyDraft(), ref: "VEMD0142", nome: "Vestido", estilista_id: "e", categoria_principal_id: "c",
    data_desenho_tecnico: "2026-09-01", data_piloto1: "2026-09-02",
  });
  const blocosOk = () => makeEmptyBlocks().map((b) => (b.tipo === "tecido" && b.numero === 1 ? { ...b, artigo_id: "a", variantes: ["v1", ...Array(9).fill(null)] } : b));
  const gradesOk = [{ variante_numero: 1, grades: { P: 1 }, grade_total: 1 }];
  it("tudo preenchido ⇒ nada falta", () => {
    expect(pendenciasEnvioExplosao({ draft: completo(), blocks: blocosOk(), grades: gradesOk, rotuloRef: "REF" })).toEqual([]);
  });
  it("cada pendência aponta a seção onde se resolve", () => {
    const d = { ...completo(), ref: "", nome: "", data_piloto1: "", piloteiro2_id: "p2" };
    const out = pendenciasEnvioExplosao({ draft: d, blocks: makeEmptyBlocks(), grades: [], rotuloRef: "REF" });
    expect(out).toEqual([
      { label: "REF", secao: "desenvolvimento" },
      { label: "Nome", secao: "info" },
      { label: "ao menos 1 tecido com variante", secao: "tecidos" },
      { label: "grade preenchida", secao: "grade" },
      { label: "Data Piloto 1", secao: "desenvolvimento" },
      { label: "Data Piloto 2", secao: "desenvolvimento" },
    ]);
  });
  it("tecido selecionado sem variante ⇒ '1 variante em cada tecido/forro/entretela selecionado'", () => {
    const b = blocosOk().map((x) => (x.tipo === "forro" && x.numero === 1 ? { ...x, artigo_id: "f" } : x));
    expect(pendenciasEnvioExplosao({ draft: completo(), blocks: b, grades: gradesOk, rotuloRef: "REF" }))
      .toEqual([{ label: "1 variante em cada tecido/forro/entretela selecionado", secao: "tecidos" }]);
  });
});
```

Criar `tests/unit/planejamento-importar-ficha.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { makeEmptyBlocks } from "@/components/desenvolvimento/modelo-detail/types";
import { camposDoPatchNoDraft, itensSobrescritos } from "@/components/planejamento/planejamento-detail/ficha/importar-ficha";

// F3.3 — Importar dados no Sheet unificado: o que vai para o Draft e o que o AlertDialog avisa que será substituído
// (porta de ModeloDetailPanel.tsx:2329-2332 e :2357-2377).
const vazio = { observacoesTecnicas: "", custosAdicionais: [], proporcoes: {}, blocks: makeEmptyBlocks(), aviamentos: [], etiquetas: [], grades: [] };

describe("camposDoPatchNoDraft", () => {
  it("só as 3 colunas do modelo que o Importar traz", () => {
    expect(camposDoPatchNoDraft({ observacoes_tecnicas: "x", proporcoes: { P: 1 }, aviamentos: [] })).toEqual({ observacoes_tecnicas: "x", proporcoes: { P: 1 } });
  });
});

describe("itensSobrescritos", () => {
  it("destino vazio ⇒ nada a confirmar", () => {
    expect(itensSobrescritos({ observacoes_tecnicas: "x", grades: [], aviamentos: [] }, vazio, false)).toEqual([]);
  });
  it("lista o que já tem valor e será substituído (+ Observações do bloco)", () => {
    const blocks = makeEmptyBlocks().map((b) => (b.tipo === "tecido" && b.numero === 1 ? { ...b, artigo_id: "a", consumo: 1, variantes: ["v", ...Array(9).fill(null)] } : b));
    const atual = {
      ...vazio, observacoesTecnicas: "tem", custosAdicionais: [{ descricao: "x", valor: 1 }], proporcoes: { P: 1 }, blocks,
      aviamentos: [{ aviamento_id: "av", variante_aviamento_id: null, consumo: 1, loss_percent: 0, custo_previsto: 0 }],
      etiquetas: [{ etiqueta_id: "e", cor_id: null, consumo: 1, loss_percent: 0, custo_previsto: 0 }],
      grades: [{ variante_numero: 1, grades: {}, grade_total: 5 }],
    };
    const novos = makeEmptyBlocks().map((b) => (b.tipo === "tecido" && b.numero === 1 ? { ...b, artigo_id: "b" } : b));
    expect(itensSobrescritos({
      observacoes_tecnicas: "n", custos_adicionais: [], proporcoes: {}, grades: [], aviamentos: [], etiquetas: [], blocks: novos,
    }, atual, true)).toEqual(["Observações técnicas", "Custos adicionais", "Proporções", "Grade", "Aviamentos", "Insumos/Etiquetas", "Tecido 1", "Observações (bloco)"]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit/planejamento-envio-explosao.test.ts tests/unit/planejamento-importar-ficha.test.ts`
Expected: FAIL — imports não resolvem.

- [ ] **Step 3: Implementar `envio-explosao.ts`**

```ts
// F3.3 — "Enviar à Explosão" no Sheet unificado do Planejamento: o gate por etapa e a lista "Para enviar, falta".
// PORTA de ModeloDetailPanel.tsx:1405-1413 (gate), :1576-1598 (pendências/canEnviarCad), com as seções do Sheet do
// Planejamento no lugar das do acordeão do Dev. Decisão travada 10: com a chave LIGADA o gate usa a posição DERIVADA
// do card (`statusParaGate`), espelho do SQL `_explosao_envio_gate(_kanban_status_gate(...))` (F1
// 20260930140000_kanban_auto_3_motor.sql:842). Puro — tests/unit/planejamento-envio-explosao.test.ts.
import { podeEnviarExplosao } from "@/lib/kanban-status";
import { statusParaGate, type Derivacao, type KanbanAutoConfig } from "@/lib/kanban-auto";
import type { GradeRow, TecidoBlock } from "@/components/desenvolvimento/modelo-detail/types";
import type { Draft } from "@/components/planejamento/modelo-shared";
import type { SecaoSheetKey } from "./selos-secoes";

export type GateEnvio = { ok: boolean; carregando: boolean; reqLabel: string };

/** Pode enviar pela ETAPA? `statusCru` = status gravado com a Ordem de Criação enviada (null antes dela). */
export function gateEnvioExplosao(i: {
  cfg: KanbanAutoConfig;
  explosaoEnvioStatus: string | null | undefined;
  statusCru: string | null;
  derivacao: Derivacao | null;
  /** Condições do card E config da loja carregadas (`useFichaKanban.condProntas`). */
  condProntas: boolean;
}): GateEnvio {
  // Chave ligada sem as condições: a posição derivada ainda não é conhecida — não libera "no escuro" (o servidor
  // recusaria, mas o botão não pode prometer).
  if (i.cfg.kanban_automatico && !i.condProntas) return { ok: false, carregando: true, reqLabel: "" };
  const g = podeEnviarExplosao(i.cfg.status_kanban, i.explosaoEnvioStatus, i.statusCru, {
    statusGate: statusParaGate(i.cfg.kanban_automatico, i.derivacao, i.statusCru),
  });
  return { ok: g.ok, carregando: false, reqLabel: g.reqLabel };
}

export type PendenciaEnvio = { label: string; secao: SecaoSheetKey };

/**
 * "Para enviar, falta" (Dev :1576-1595, fluxo INTERNO — o Enviar só aparece p/ interno na F3.3). Cada pendência aponta
 * a seção do Sheet onde se resolve (o link abre a seção). `rotuloRef` = `useFieldLabels()("ref")`, como o Dev.
 */
export function pendenciasEnvioExplosao(i: {
  draft: Pick<Draft, "ref" | "nome" | "estilista_id" | "categoria_principal_id" | "data_desenho_tecnico" | "data_piloto1" | "data_piloto2" | "data_piloto3" | "piloteiro2_id" | "piloteiro3_id">;
  blocks: TecidoBlock[];
  grades: GradeRow[];
  rotuloRef: string;
}): PendenciaEnvio[] {
  const out: PendenciaEnvio[] = [];
  const d = i.draft;
  const vazio = (s: string | null | undefined) => (s ?? "").trim() === "";
  if (vazio(d.ref)) out.push({ label: i.rotuloRef, secao: "desenvolvimento" });
  if (vazio(d.nome)) out.push({ label: "Nome", secao: "info" });
  if (!d.estilista_id) out.push({ label: "Estilista", secao: "info" });
  if (!d.categoria_principal_id) out.push({ label: "Categoria", secao: "info" });
  const temTecidoComVariante = i.blocks.some((b) => b.tipo === "tecido" && !!b.artigo_id && b.variantes.some((v) => !!v));
  const todosComVariante = i.blocks.filter((b) => !!b.artigo_id).every((b) => b.variantes.some((v) => !!v));
  if (!temTecidoComVariante) out.push({ label: "ao menos 1 tecido com variante", secao: "tecidos" });
  else if (!todosComVariante) out.push({ label: "1 variante em cada tecido/forro/entretela selecionado", secao: "tecidos" });
  if (i.grades.reduce((s, g) => s + (g.grade_total || 0), 0) <= 0) out.push({ label: "grade preenchida", secao: "grade" });
  if (vazio(d.data_desenho_tecnico)) out.push({ label: "Data Desenho Técnico", secao: "desenvolvimento" });
  if (vazio(d.data_piloto1)) out.push({ label: "Data Piloto 1", secao: "desenvolvimento" });
  const piloto2Aberto = !!(d.piloteiro2_id || !vazio(d.data_piloto2));
  const piloto3Aberto = !!(d.piloteiro3_id || !vazio(d.data_piloto3));
  if (piloto2Aberto && vazio(d.data_piloto2)) out.push({ label: "Data Piloto 2", secao: "desenvolvimento" });
  if (piloto3Aberto && vazio(d.data_piloto3)) out.push({ label: "Data Piloto 3", secao: "desenvolvimento" });
  return out;
}
```

- [ ] **Step 4: Implementar `importar-ficha.ts`**

```ts
// F3.3 — "Importar dados" no Sheet unificado: regras puras portadas do Dev (ModeloDetailPanel.tsx:2329-2332 — colunas
// do modelo; :2357-2377 — o que o AlertDialog avisa que será substituído). O diálogo em si é o do Dev, reusado sem
// modificar (src/components/desenvolvimento/importar/ImportarDadosDialog.tsx). Puro — planejamento-importar-ficha.test.ts.
import type { PatchCopia } from "@/components/desenvolvimento/importar/importar-copia";
import type { AviamentoRow, GradeRow, ModeloEtiquetaRow, TecidoBlock } from "@/components/desenvolvimento/modelo-detail/types";
import type { Draft } from "@/components/planejamento/modelo-shared";

/** Colunas de `modelos` que o Importar traz para o Draft (staging — o Salvar grava). */
export function camposDoPatchNoDraft(p: PatchCopia): Partial<Pick<Draft, "observacoes_tecnicas" | "custos_adicionais" | "proporcoes">> {
  const out: Partial<Pick<Draft, "observacoes_tecnicas" | "custos_adicionais" | "proporcoes">> = {};
  if (p.observacoes_tecnicas !== undefined) out.observacoes_tecnicas = p.observacoes_tecnicas;
  if (p.custos_adicionais !== undefined) out.custos_adicionais = p.custos_adicionais;
  if (p.proporcoes !== undefined) out.proporcoes = p.proporcoes;
  return out;
}

/** O que já tem valor e será substituído (lista do AlertDialog "Sobrescrever dados existentes?"). */
export function itensSobrescritos(p: PatchCopia, atual: {
  observacoesTecnicas: string; custosAdicionais: unknown[]; proporcoes: Record<string, number>;
  blocks: TecidoBlock[]; aviamentos: AviamentoRow[]; etiquetas: ModeloEtiquetaRow[]; grades: GradeRow[];
}, obsBloco: boolean): string[] {
  const out: string[] = [];
  if (p.observacoes_tecnicas !== undefined && (atual.observacoesTecnicas ?? "").trim()) out.push("Observações técnicas");
  if (p.custos_adicionais !== undefined && (atual.custosAdicionais ?? []).length) out.push("Custos adicionais");
  if (p.proporcoes !== undefined && Object.keys(atual.proporcoes ?? {}).length > 0) out.push("Proporções");
  if (p.grades !== undefined && atual.grades.some((g) => (g.grade_total ?? 0) > 0)) out.push("Grade");
  if (p.aviamentos !== undefined && atual.aviamentos.some((a) => a.aviamento_id)) out.push("Aviamentos");
  if (p.etiquetas !== undefined && atual.etiquetas.some((e) => e.etiqueta_id)) out.push("Insumos/Etiquetas");
  if (p.blocks !== undefined) {
    for (const nb of p.blocks) {
      const old = atual.blocks.find((b) => b.tipo === nb.tipo && b.numero === nb.numero);
      if (!old) continue;
      const mudouArtigo = !!old.artigo_id && nb.artigo_id !== old.artigo_id;
      const mudouConsumo = (old.consumo ?? 0) > 0 && nb.consumo !== old.consumo;
      const mudouVar = old.variantes.some((v) => v) && JSON.stringify(nb.variantes) !== JSON.stringify(old.variantes);
      if (mudouArtigo || mudouConsumo || mudouVar) out.push(`${nb.tipo === "tecido" ? "Tecido" : nb.tipo === "forro" ? "Forro" : "Entretela"} ${nb.numero}`);
    }
  }
  if (obsBloco) out.push("Observações (bloco)");
  return out;
}
```

- [ ] **Step 5: Rodar e ver passar + gates**

Run: `env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit/planejamento-envio-explosao.test.ts tests/unit/planejamento-importar-ficha.test.ts` → PASS. Depois `bash .superpowers/f33/gates.sh`.

- [ ] **Step 6: Commit**

```bash
F="src/components/planejamento/planejamento-detail/ficha/envio-explosao.ts src/components/planejamento/planejamento-detail/ficha/importar-ficha.ts tests/unit/planejamento-envio-explosao.test.ts tests/unit/planejamento-importar-ficha.test.ts"
git add -- $F
git commit --only -m "feat(planejamento): F3.3 (2) — regras puras do Enviar à Explosão (gate pela posição derivada + 'Para enviar, falta') e do Importar dados

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- $F
```

---

## Task 3: `selos-secoes.ts` — numeração dinâmica e selos de todas as seções  *(Lote A)*

**Files:**
- Create: `src/components/planejamento/planejamento-detail/ficha/selos-secoes.ts`
- Modify: `src/components/planejamento/planejamento-detail/ficha/selos-bom.ts` (exporta `seloPorChaves`)
- Test: `tests/unit/planejamento-selos-secoes.test.ts`

**Interfaces:**
- Consumes: `CONDICAO_BY_KEY` (catálogo, só leitura), `SeloSecao` (`selos-bom.ts`), `brl`/`fmtNum`/`mesLimpo` (`@/lib/format`), `EstadoMO` (`@/lib/mao-obra`).
- Produces: `SecaoSheetKey`; `ORDEM_SECOES_SHEET`; `numerarSecoes(visiveis, opts?: { dialogNovo?: boolean }): Partial<Record<SecaoSheetKey, number>>` (no Dialog "Novo Modelo" só Info e Coleção levam número — mockup, R7); `CONDICOES_SECAO_SHEET`; `dataBR(iso)`; `resumoColecao(i)`; `EntradaSelosSheet`; `selosSecoesSheet(e): Partial<Record<SecaoSheetKey, SeloSecao>>`; `seloCadSecao(i)`; `seloProva(n)`, `seloObservacoes(n)`, `seloRelacionado(b)`; em `selos-bom.ts`: `seloPorChaves(chaves, requeridas, satisfeitas): SeloSecao | null`.

- [ ] **Step 1: Escrever o teste (falha: módulo inexistente)**

Criar `tests/unit/planejamento-selos-secoes.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { seloPorChaves, seloSecaoBom } from "@/components/planejamento/planejamento-detail/ficha/selos-bom";
import {
  dataBR, numerarSecoes, resumoColecao, seloCadSecao, seloObservacoes, seloProva, seloRelacionado, selosSecoesSheet,
  type EntradaSelosSheet, type SecaoSheetKey,
} from "@/components/planejamento/planejamento-detail/ficha/selos-secoes";

// F3.3 — numeração "N." e selos de TODAS as seções do Sheet unificado (adiados da F3.1, §7 T2), por MAPA PRÓPRIO
// (decisão travada 8 — o catálogo e `CondicaoSecao` não mudam). Regras do `reqBadge` e dos selos informativos do Dev.
describe("numerarSecoes", () => {
  it("1..N contínuo na ordem do mockup, pulando as ocultas", () => {
    const v = new Set<SecaoSheetKey>(["info", "colecao", "tecidos", "cad", "preco", "anexos", "relacionado"]);
    expect(numerarSecoes(v)).toEqual({ info: 1, colecao: 2, tecidos: 3, cad: 4, preco: 5, anexos: 6, relacionado: 7 });
  });
  it("Dialog 'Novo Modelo' (mockup gen_novo.py:13-20, R7): só '1. Informações' e '2. Coleção'; Tecidos/Mão de obra/Anexos sem número", () => {
    const v = new Set<SecaoSheetKey>(["info", "colecao", "tecidos_novo", "mao_obra", "anexos"]);
    expect(numerarSecoes(v, { dialogNovo: true })).toEqual({ info: 1, colecao: 2 });
  });
});

describe("seloPorChaves (selos-bom) — regra do reqBadge do Dev para qualquer lista", () => {
  it("sem requisito configurado ⇒ null; todos ok ⇒ 'ok'; falta 1 ⇒ 'falta x' com a condição", () => {
    expect(seloPorChaves(["modelista_definido"], new Set(), {})).toBeNull();
    expect(seloPorChaves(["modelista_definido"], new Set(["modelista_definido"]), { modelista_definido: true })).toEqual({ tone: "ok", texto: "ok" });
    const s = seloPorChaves(["modelista_definido", "data_piloto1"], new Set(["modelista_definido", "data_piloto1"]), { modelista_definido: true });
    expect(s?.texto).toBe("falta data de piloto i preenchida");
    expect(s?.condicaoUnica?.key).toBe("data_piloto1");
  });
  it("seloSecaoBom (F3.2) segue igual", () => {
    expect(seloSecaoBom("grade", new Set(["grade_preenchida"]), { grade_preenchida: true }, { nTecidos: 0, todosBlocosComArtigoTemVariante: true, nAviamentos: 0, nInsumos: 0, gradeTotalGeral: 0 })).toEqual({ tone: "ok", texto: "ok" });
  });
});

describe("selosSecoesSheet", () => {
  const base: EntradaSelosSheet = {
    requeridas: new Set(), satisfeitas: null, podeVerCustos: true,
    infoCompleta: true, colecaoResumo: "Verão 2027 · Casual · lanç. 2 · mar/2027", desenvolvimentoCompleto: false,
    preco: { efetivo: 289.9, markup: 2.91 }, maoObra: { estado: "aprovada", total: 35 },
    anexos: { fotoModelo: true, desenho: true, croqui: true }, lancamento: { lancado: false, data: "2027-03-15" },
  };
  it("informativos (sem requisito da loja) — mockup gen_main.py", () => {
    const s = selosSecoesSheet(base);
    expect(s.info).toEqual({ tone: "ok", texto: "completa" });
    expect(s.colecao).toEqual({ tone: "muted", texto: "Verão 2027 · Casual · lanç. 2 · mar/2027" });
    expect(s.desenvolvimento).toEqual({ tone: "muted", texto: "faltam dados" });
    expect(s.preco?.texto).toMatch(/^Preço de venda R\$\s?289,90 · markup 2,91×$/);
    expect(s.mao_obra?.texto.startsWith("aprovada · ")).toBe(true);
    expect(s.anexos).toEqual({ tone: "ok", texto: "anexos ok" });
    expect(s.lancamento).toEqual({ tone: "muted", texto: "15/03/2027" });
  });
  it("requisito da loja numa seção vence o informativo (estado SALVO)", () => {
    const s = selosSecoesSheet({ ...base, requeridas: new Set(["data_piloto1"]), satisfeitas: { data_piloto1: false } });
    expect(s.desenvolvimento?.tone).toBe("warn");
    expect(s.desenvolvimento?.texto).toBe("falta data de piloto i preenchida");
  });
  it("condições ainda não carregadas ⇒ só o informativo (nunca 'falta' no escuro)", () => {
    expect(selosSecoesSheet({ ...base, requeridas: new Set(["data_piloto1"]), satisfeitas: null }).desenvolvimento).toEqual({ tone: "muted", texto: "faltam dados" });
  });
  it("invariante #12: sem ver custos, nada em R$ nos selos de Preço e Mão de obra", () => {
    const s = selosSecoesSheet({ ...base, podeVerCustos: false });
    expect(s.preco).toBeUndefined();
    expect(s.mao_obra).toEqual({ tone: "ok", texto: "aprovada" });
  });
  it("estados da mão de obra e do lançamento", () => {
    expect(selosSecoesSheet({ ...base, maoObra: { estado: "sem_servico", total: 0 } }).mao_obra).toEqual({ tone: "muted", texto: "sem serviço" });
    expect(selosSecoesSheet({ ...base, maoObra: { estado: "pendente", total: 10 } }).mao_obra).toEqual({ tone: "warn", texto: "pendente" });
    expect(selosSecoesSheet({ ...base, lancamento: { lancado: true, data: "2027-03-15" } }).lancamento).toEqual({ tone: "ok", texto: "lançado" });
    expect(selosSecoesSheet({ ...base, anexos: { fotoModelo: false, desenho: true, croqui: false } }).anexos).toEqual({ tone: "info", texto: "desenho técnico" });
  });
});

describe("selos auxiliares", () => {
  it("CAD: vazio / antes da Ordem / falta X / ok; requisito cad_preenchido vence", () => {
    expect(seloCadSecao({ requeridas: new Set(), satisfeitas: null, linhas: 0, faltas: [], antesDaOrdem: false })).toEqual({ tone: "muted", texto: "vazio" });
    expect(seloCadSecao({ requeridas: new Set(), satisfeitas: null, linhas: 2, faltas: [], antesDaOrdem: true })).toEqual({ tone: "muted", texto: "após a Ordem de Criação" });
    expect(seloCadSecao({ requeridas: new Set(), satisfeitas: null, linhas: 2, faltas: ["metragem planejada"], antesDaOrdem: false }).texto).toBe("falta metragem planejada");
    expect(seloCadSecao({ requeridas: new Set(), satisfeitas: null, linhas: 2, faltas: [], antesDaOrdem: false })).toEqual({ tone: "ok", texto: "ok" });
    expect(seloCadSecao({ requeridas: new Set(["cad_preenchido"]), satisfeitas: { cad_preenchido: true }, linhas: 2, faltas: ["consumo"], antesDaOrdem: false })).toEqual({ tone: "ok", texto: "ok" });
  });
  it("Prova, Observações, Produto Relacionado", () => {
    expect(seloProva(0)).toEqual({ tone: "muted", texto: "sem ajustes" });
    expect(seloProva(2)).toEqual({ tone: "info", texto: "2 abertos" });
    expect(seloObservacoes(1)).toEqual({ tone: "muted", texto: "1 observação" });
    expect(seloObservacoes(0)).toEqual({ tone: "muted", texto: "nenhuma" });
    expect(seloRelacionado(false)).toEqual({ tone: "muted", texto: "nenhum" });
  });
  it("datas e resumo da coleção", () => {
    expect(dataBR("2027-03-15")).toBe("15/03/2027");
    expect(dataBR(null)).toBe("");
    expect(resumoColecao({ colecao: "Verão 2027", subcolecao: null, linha: "Casual", semana: "2", mes: "Março", ano: "2027" })).toBe("Verão 2027 · Casual · lanç. 2 · mar/2027");
    expect(resumoColecao({ colecao: null, subcolecao: null, linha: null, semana: null, mes: null, ano: null })).toBe("");
  });
});
```

(O `\s?` do teste de preço aceita o espaço não-quebrável que o `Intl` põe depois de "R$" no `brl`.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit/planejamento-selos-secoes.test.ts`
Expected: FAIL — import não resolve / `seloPorChaves` não exportado.

- [ ] **Step 3: `selos-bom.ts` — exportar a regra genérica**

Em `src/components/planejamento/planejamento-detail/ficha/selos-bom.ts`, substituir a função inteira:

```ts
function seloPorRequisito(secao: SecaoBomKey, requeridas: ReadonlySet<string>, satisfeitas: Record<string, boolean>): SeloSecao | null {
```

(e o corpo dela, até o `}` que a fecha) por:

```ts
/** F3.3 — a regra do `reqBadge` do Dev (ModeloDetailPanel.tsx:1658-1677) para QUALQUER lista de chaves: sem requisito da
 *  loja nas chaves ⇒ null (cai no informativo); todos satisfeitos ⇒ "ok"; senão "falta x"/"faltam N" com a condição. */
export function seloPorChaves(chaves: readonly string[], requeridas: ReadonlySet<string>, satisfeitas: Record<string, boolean>): SeloSecao | null {
  const conds = chaves
    .map((k) => CONDICAO_BY_KEY.get(k))
    .filter((c): c is Condicao => !!c && requeridas.has(c.key));
  if (conds.length === 0) return null;
  const faltam = conds.filter((c) => !satisfeitas[c.key]);
  if (faltam.length === 0) return { tone: "ok", texto: "ok" };
  const labels = faltam.map((c) => c.label.replace(/^Anexo: /, ""));
  return {
    tone: "warn",
    texto: faltam.length === 1 ? `falta ${labels[0].toLowerCase()}` : `faltam ${faltam.length}`,
    title: `Falta: ${labels.join(", ")}`,
    condicaoUnica: faltam.length === 1 ? faltam[0] : undefined,
  };
}

function seloPorRequisito(secao: SecaoBomKey, requeridas: ReadonlySet<string>, satisfeitas: Record<string, boolean>): SeloSecao | null {
  return seloPorChaves(CONDICOES_SECAO_BOM[secao], requeridas, satisfeitas);
}
```

(Conferir antes que o corpo real de `seloPorRequisito` é o mesmo de `seloPorChaves` acima — `selos-bom.ts:38-52` no BASE; se divergir, `seloPorChaves` recebe o corpo REAL.)

- [ ] **Step 4: Implementar `selos-secoes.ts`**

```ts
// F3.3 — numeração "N." e selos de completude de TODAS as seções do Sheet unificado (mockup gen_main.py:31-106 e
// gen_rest.py:9-26; adiados da F3.1 — plano F3.1 §7 T2). MAPA PRÓPRIO seção→condições (decisão travada 8: o catálogo
// `kanban-condicoes.ts` e o `CondicaoSecao` seguem as chaves do acordeão do Dev e NÃO mudam). As 4 seções do BOM seguem
// com `selos-bom.ts` (F3.2). Regras do Dev: `reqBadge` (ModeloDetailPanel.tsx:1644-1677) e os selos informativos
// (:2793-2795 Informações, :2837-2838 Prova, :2886-2890 CAD, :3068-3072 Anexos). Puro — planejamento-selos-secoes.test.ts.
import { brl, fmtNum, mesLimpo } from "@/lib/format";
import type { EstadoMO } from "@/lib/mao-obra";
import { seloPorChaves, type SeloSecao } from "./selos-bom";

export type SecaoSheetKey =
  | "info" | "colecao" | "desenvolvimento" | "prova"
  | "tecidos" | "aviamentos" | "insumos" | "grade" | "cad"
  | "tecidos_novo" | "preco" | "mao_obra" | "produto_acabado" | "grade_revenda"
  | "anexos" | "observacoes" | "lancamento" | "relacionado";

/** Ordem do mockup aprovado (gen_main.py:106) + "Tecidos" do Dialog e as 2 seções da revenda onde o JSX as põe. */
export const ORDEM_SECOES_SHEET: readonly SecaoSheetKey[] = [
  "info", "colecao", "desenvolvimento", "prova", "tecidos", "aviamentos", "insumos", "grade", "cad",
  "tecidos_novo", "preco", "mao_obra", "produto_acabado", "grade_revenda", "anexos", "observacoes", "lancamento", "relacionado",
];

/** Dialog "Novo Modelo": o mockup aprovado numera SÓ "1. Informações Gerais do Produto" e "2. Coleção"; Tecidos, Mão de
 *  obra e Anexos aparecem SEM número (gen_novo.py:13-20 — ruling R7 do G-plano F3.3: seguir o mockup). */
const SECOES_NUMERADAS_DIALOG_NOVO: ReadonlySet<SecaoSheetKey> = new Set<SecaoSheetKey>(["info", "colecao"]);

/** Numeração DINÂMICA: 1..N só nas seções visíveis (mesma regra do `secNum` do Dev, :1620-1629). No Dialog "Novo Modelo"
 *  (`dialogNovo`), só as do mockup (acima) — as demais ficam sem número (`undefined` ⇒ a `Secao` não mostra "N."). */
export function numerarSecoes(
  visiveis: ReadonlySet<SecaoSheetKey>,
  opts?: { dialogNovo?: boolean },
): Partial<Record<SecaoSheetKey, number>> {
  const out: Partial<Record<SecaoSheetKey, number>> = {};
  let n = 0;
  for (const k of ORDEM_SECOES_SHEET) {
    if (!visiveis.has(k)) continue;
    if (opts?.dialogNovo && !SECOES_NUMERADAS_DIALOG_NOVO.has(k)) continue;
    out[k] = ++n;
  }
  return out;
}

/** Seção do Sheet → condições do catálogo cujo requisito vira o selo (as do Dev "s1" se dividem em Informações/Coleção/
 *  Desenvolvimento; as do BOM ficam em `CONDICOES_SECAO_BOM`). `lancado` fica fora (o próprio catálogo desaconselha). */
export const CONDICOES_SECAO_SHEET: Partial<Record<SecaoSheetKey, readonly string[]>> = {
  info: ["categoria_definida", "subcategoria1_definida", "subcategoria2_definida", "estilista_definido"],
  colecao: ["linha_definida", "colecao_preenchida"],
  desenvolvimento: ["modelista_definido", "piloteiro_definido", "data_desenho_tecnico", "data_piloto1", "data_piloto2", "data_piloto3", "data_aprovacao"],
  cad: ["cad_preenchido"],
  preco: ["preco_venda_preenchido"],
  mao_obra: ["servico_aprovado", "servico_mo_decidido", "servico_mo_preenchido"],
  anexos: ["anexo_croqui", "desenho_tecnico_anexado", "anexo_modelo", "ficha_medida_anexada"],
  lancamento: ["data_lancamento_preenchida"],
};

function seloRequisito(secao: SecaoSheetKey, requeridas: ReadonlySet<string>, satisfeitas: Record<string, boolean> | null): SeloSecao | null {
  const chaves = CONDICOES_SECAO_SHEET[secao];
  if (!chaves || !satisfeitas) return null;
  return seloPorChaves(chaves, requeridas, satisfeitas);
}

/** "2027-03-15" → "15/03/2027" (vazio se não é data ISO). */
export function dataBR(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

/** Resumo da seção Coleção no cabeçalho (mockup: "Verão 2027 · Casual · lanç. 2 · mar/2027"). */
export function resumoColecao(i: { colecao: string | null; subcolecao: string | null; linha: string | null; semana: string | null; mes: string | null; ano: string | null }): string {
  const mes = i.mes ? mesLimpo(i.mes).slice(0, 3).toLowerCase() : "";
  const mesAno = mes && i.ano ? `${mes}/${i.ano}` : mes || i.ano || "";
  return [i.colecao, i.subcolecao, i.linha, i.semana ? `lanç. ${i.semana}` : null, mesAno || null]
    .filter((x): x is string => !!x && x.trim() !== "")
    .join(" · ");
}

export type EntradaSelosSheet = {
  /** União dos requisitos configurados (por origem — `requisitosUniao`). */
  requeridas: ReadonlySet<string>;
  /** Condições do card no estado SALVO; null = ainda não carregadas (só o informativo). */
  satisfeitas: Record<string, boolean> | null;
  podeVerCustos: boolean;
  infoCompleta: boolean;
  colecaoResumo: string;
  desenvolvimentoCompleto: boolean;
  /** null = revenda (a tabela de preço é outra) → sem selo. */
  preco: { efetivo: number; markup: number } | null;
  maoObra: { estado: EstadoMO; total: number };
  anexos: { fotoModelo: boolean; desenho: boolean; croqui: boolean };
  lancamento: { lancado: boolean; data: string | null };
};

/** Selos das seções do Planejamento + as simples do Dev. BOM/CAD/Prova/Observações/Relacionado: funções próprias. */
export function selosSecoesSheet(e: EntradaSelosSheet): Partial<Record<SecaoSheetKey, SeloSecao>> {
  const r = (k: SecaoSheetKey) => seloRequisito(k, e.requeridas, e.satisfeitas);
  const out: Partial<Record<SecaoSheetKey, SeloSecao>> = {};
  out.info = r("info") ?? (e.infoCompleta ? { tone: "ok", texto: "completa" } : { tone: "muted", texto: "faltam dados" });
  out.colecao = r("colecao") ?? { tone: "muted", texto: e.colecaoResumo || "vazio" };
  out.desenvolvimento = r("desenvolvimento") ?? (e.desenvolvimentoCompleto ? { tone: "ok", texto: "completa" } : { tone: "muted", texto: "faltam dados" });
  // Invariante #12: valor em R$ só p/ quem vê custos (o selo aparece com a seção FECHADA).
  const precoReq = r("preco");
  if (precoReq) out.preco = precoReq;
  else if (e.podeVerCustos && e.preco && e.preco.efetivo > 0) {
    out.preco = { tone: "muted", texto: `Preço de venda ${brl(e.preco.efetivo)}${e.preco.markup > 0 ? ` · markup ${fmtNum(e.preco.markup)}×` : ""}` };
  }
  const mo = e.maoObra;
  out.mao_obra = r("mao_obra") ?? (
    mo.estado === "sem_servico" ? { tone: "muted", texto: "sem serviço" }
      : mo.estado === "aprovada" ? { tone: "ok", texto: e.podeVerCustos ? `aprovada · ${brl(mo.total)}` : "aprovada" }
        : mo.estado === "reprovada" ? { tone: "warn", texto: "reprovada" }
          : { tone: "warn", texto: "pendente" });
  const a = e.anexos;
  out.anexos = r("anexos") ?? (
    a.fotoModelo && a.desenho && a.croqui ? { tone: "ok", texto: "anexos ok" }
      : a.fotoModelo ? { tone: "info", texto: "foto do modelo" }
        : a.desenho ? { tone: "info", texto: "desenho técnico" }
          : a.croqui ? { tone: "info", texto: "croqui" }
            : { tone: "muted", texto: "vazio" });
  out.lancamento = r("lancamento") ?? (
    e.lancamento.lancado ? { tone: "ok", texto: "lançado" }
      : e.lancamento.data ? { tone: "muted", texto: dataBR(e.lancamento.data) }
        : { tone: "muted", texto: "sem data" });
  return out;
}

/** Selo da seção CAD (Dev :2886-2890 + requisito `cad_preenchido`). */
export function seloCadSecao(i: {
  requeridas: ReadonlySet<string>; satisfeitas: Record<string, boolean> | null;
  linhas: number; faltas: string[]; antesDaOrdem: boolean;
}): SeloSecao {
  const req = seloRequisito("cad", i.requeridas, i.satisfeitas);
  if (req) return req;
  if (i.linhas === 0) return { tone: "muted", texto: "vazio" };
  if (i.antesDaOrdem) return { tone: "muted", texto: "após a Ordem de Criação" };
  if (i.faltas.length > 0) return { tone: "warn", texto: `falta ${i.faltas.join(", ")}`, title: `Falta: ${i.faltas.join(", ")}` };
  return { tone: "ok", texto: "ok" };
}

/** Prova (Dev :2836-2838). */
export function seloProva(abertos: number): SeloSecao {
  return abertos > 0 ? { tone: "info", texto: `${abertos} aberto${abertos > 1 ? "s" : ""}` } : { tone: "muted", texto: "sem ajustes" };
}
/** Observações (mockup: "1 observação"). A Composição automática não é linha da tabela. */
export function seloObservacoes(n: number): SeloSecao {
  return n > 0 ? { tone: "muted", texto: `${n} ${n > 1 ? "observações" : "observação"}` } : { tone: "muted", texto: "nenhuma" };
}
/** Produto Relacionado (mockup: "nenhum"). */
export function seloRelacionado(emConjunto: boolean): SeloSecao {
  return emConjunto ? { tone: "info", texto: "em conjunto" } : { tone: "muted", texto: "nenhum" };
}
```

- [ ] **Step 5: Rodar e ver passar + gates**

Run: `env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit/planejamento-selos-secoes.test.ts tests/unit/ficha-selos-bom.test.ts` → PASS (o teste da F3.2 segue verde). Depois `bash .superpowers/f33/gates.sh`.

- [ ] **Step 6: Commit**

```bash
F="src/components/planejamento/planejamento-detail/ficha/selos-secoes.ts src/components/planejamento/planejamento-detail/ficha/selos-bom.ts tests/unit/planejamento-selos-secoes.test.ts"
git add -- $F
git commit --only -m "feat(planejamento): F3.3 (3) — numeração dinâmica e selos de todas as seções por mapa próprio (catálogo intocado)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- $F
```

**Revisão do Lote A (Tasks 1, 3, 2):** cada função de `ficha-cad.ts` × a faixa citada do Dev, linha a linha (atenção a `hidratarCad` × :1079-1171, `sincronizarCadComBlocos` × :1319-1386, `calcularFolhasAuto` × :1229-1269, `montarCadPayload` × :2067-2117); as melhorias T4 só por ação do usuário (artigo) ou só para linha sem `id`; `linhasParaGravar` impede CAD com tecido que o BOM do servidor não tem; `deveGravarCad` × §3 P2 e a regra D2; `assinaturaCad` ignora o que é do BOM e o que é zero; `gateEnvioExplosao` × `_explosao_envio_gate(_kanban_status_gate)` (decisão 10); `selos-secoes` NÃO toca o catálogo; `seloPorChaves` com o corpo real da F3.2.

---
## Task 4: CAD nos dados e na carga — `useFichaDados`, `deveHidratarCarga`, `useFichaBom` (carga) e `useFichaCad`  *(individual Opus)*

**Files:**
- Modify: `src/components/planejamento/planejamento-detail/ficha/useFichaDados.ts` (`qCad` com o CAD embutido; `bomFetching` inclui o CAD; `cadData`, `condicoesProntas`)
- Modify: `src/components/planejamento/planejamento-detail/ficha/ficha-calc.ts` (`deveHidratarCarga` com `cadPronto` opcional)
- Modify: `src/components/planejamento/planejamento-detail/ficha/useFichaBom.ts` (carga espera o CAD; exporta `marcarTocado`/`cargaSeq`)
- Create: `src/components/planejamento/planejamento-detail/ficha/useFichaCad.ts`
- Test: `tests/unit/ficha-cad.test.ts` (acrescenta 1 `describe`)

**Interfaces:**
- Consumes: Task 1 (`hidratarCad`, `sincronizarCadComBlocos`, `propagarBlocoParaCad`, `atualizarLinhaCad`, `atualizarVarianteCad`, `calcularFolhasAuto`, `faltasCad`, `idsVariantesDosBlocos`, `assinaturaCadServidor`, tipos); F3.2 `FichaDados`, `deveHidratarCarga`.
- Produces: `FichaDados.cadData: CadRowDb | null | undefined` (undefined = não chegou; null = sem CAD); `FichaDados.condicoesProntas: boolean`; `bomFetching` passa a incluir o CAD; `deveHidratarCarga({…, cadPronto?: boolean})`; `useFichaBom(...)` devolve também `marcarTocado: () => void` e `cargaSeq: number`; `useFichaCad({ modeloId, habilitada, dados, cargaSeq, blocks, grades, proporcoes, marcarTocado, aplicarConsumoNoBom, aoHidratar })` → `{ linhas, linhasRef, hidratado, autoFolhas, setAutoFolhas, faltas, updateTec, updateVar, propagarDoBloco }`.
- Fato (cópia, SELECT só-leitura 24/set): exatamente 1 FK em cada par do embed — `cad_tecidos → cad`, `cad_tecidos → artigos`, `cad_tecido_variantes → cad_tecidos`, `cad_tecido_variantes → variantes_tecido` (embed sem ambiguidade).

- [ ] **Step 1: Teste da carga que espera o CAD (falha)**

Em `tests/unit/ficha-cad.test.ts`, trocar a linha de import da F3.2:

```ts
import type { TecidoRowDb, VarianteRowDb } from "@/components/planejamento/planejamento-detail/ficha/ficha-calc";
```

por:

```ts
import { deveHidratarCarga, type TecidoRowDb, type VarianteRowDb } from "@/components/planejamento/planejamento-detail/ficha/ficha-calc";
```

e acrescentar no FIM do arquivo:

```ts
describe("deveHidratarCarga — F3.3: a carga espera o CAD (Task 4)", () => {
  const prontas = { habilitada: true, bomFetching: false, tecidosData: {}, ocLinksData: [], aviamentosData: [], etiquetasData: [], gradesData: [] };
  it("CAD ainda não chegou ⇒ espera; chegou (inclusive 'sem CAD') ⇒ hidrata; sem o campo ⇒ comportamento da F3.2", () => {
    expect(deveHidratarCarga({ ...prontas, cadPronto: false })).toBe(false);
    expect(deveHidratarCarga({ ...prontas, cadPronto: true })).toBe(true);
    expect(deveHidratarCarga(prontas)).toBe(true);
  });
});
```

Run: `env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit/ficha-cad.test.ts` → Expected: FAIL só no caso `cadPronto: false` (o campo ainda é ignorado).

- [ ] **Step 2: `deveHidratarCarga` com `cadPronto`**

Em `ficha-calc.ts`, substituir:

```ts
  gradesData: unknown;
}): boolean {
```

por:

```ts
  gradesData: unknown;
  /** F3.3 — o CAD do modelo já chegou (`plan-ficha-cad`; `null` = "sem CAD" também é chegou). Ausente = não espera. */
  cadPronto?: boolean;
}): boolean {
```

e substituir:

```ts
  if (!i.tecidosData || !i.ocLinksData || !i.aviamentosData || !i.etiquetasData || !i.gradesData) return false;
```

por:

```ts
  if (!i.tecidosData || !i.ocLinksData || !i.aviamentosData || !i.etiquetasData || !i.gradesData) return false;
  // F3.3 — a carga do CAD vai JUNTO com a do BOM (useFichaCad segue `cargaSeq`): sem o CAD, nenhum dos dois hidrata.
  if (i.cadPronto === false) return false;
```

Run o teste do Step 1 → PASS; `env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit/ficha-calc.test.ts` → PASS (os casos da F3.2 não passam `cadPronto`).

- [ ] **Step 3: `useFichaDados` — o CAD embutido e dentro do `bomFetching`**

(a) Depois de `import type { AviamentoRowDb, EtiquetaRowDb, GradeRowDb, OcLinkRowDb, TecidoRowDb, VarianteRowDb } from "./ficha-calc";`, inserir:

```ts
import type { CadRowDb } from "./ficha-cad";
```

(b) Depois da linha `const TAMANHOS_PADRAO = ["34|PPP", "36|PP", "38|P", "40|M", "42|G", "44|GG"];`, inserir:

```ts
/** F3.3 — `cad` + `cad_tecidos` (com o artigo) + `cad_tecido_variantes` (com os rótulos): os MESMOS campos do Dev
 *  (ModeloDetailPanel.tsx:520, :531), numa query só. Sem espaços (o supabase-js os tira da URL — o QA casa por isto). */
const SELECT_CAD_FICHA =
  "id,cad_tecidos(id,numero,tipo,artigo_id,consumo_cad,loss_percent_cad,custo_cad,tamanho_folha," +
  "artigos:artigo_id(nome,preco_por_metro,unidade_medida,etiqueta_lavagem_urls,largura_estimada)," +
  "cad_tecido_variantes(id,variante_tecido_id,ordem,multiplicador,quantidade_folhas,metragem_planejada,metragem_enviada,complementa_variante_ids," +
  "variantes_tecido:variante_tecido_id(nome_variante,codigo_variante,cor:cor_id(nome),apelido:cor_apelido_id(nome))))";
```

(c) Substituir as 2 linhas da declaração antiga:

```ts
  const bomFetching = qTecidos.isFetching || qOcLinks.isFetching || qAviamentosModelo.isFetching
    || qEtiquetasModelo.isFetching || qGrades.isFetching;
```

por:

```ts
  // (F3.3: `bomFetching` desceu para depois do `qCad` — o CAD entra nele; aqui ficaria em TDZ.)
```

(d) Substituir o bloco do `qCad`:

```ts
  // CAD existe? Trava interina da F3.2 (sem sync BOM↔CAD até a F3.3 — ver motivoSomenteLeitura).
  const qCad = useQuery({
    queryKey: ["plan-ficha-cad", modeloId],
    enabled: on,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("cad").select("id").eq("modelo_id", modeloId).maybeSingle();
      if (error) throw error;
      return (data ?? null) as { id: string } | null;
    },
  });
```

por:

```ts
  // F3.3 — o CAD do modelo EMBUTIDO numa query só (Dev :516-534 — `dev-cad-row` + `dev-cad-tecidos`): alimenta a seção
  // CAD (useFichaCad) e segue decidindo o "carregando"/erro (cadFetched/cadErro). Key PRÓPRIA, já em `chavesFichaBom`.
  const qCad = useQuery({
    queryKey: ["plan-ficha-cad", modeloId],
    enabled: on,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("cad").select(SELECT_CAD_FICHA).eq("modelo_id", modeloId).maybeSingle();
      if (error) throw error;
      return (data ?? null) as CadRowDb | null;
    },
  });
  // I2 (F3.2) + F3.3 — a carga só mexe no estado com as 6 queries ESTÁVEIS: as 5 do BOM e a do CAD.
  const bomFetching = qTecidos.isFetching || qOcLinks.isFetching || qAviamentosModelo.isFetching
    || qEtiquetasModelo.isFetching || qGrades.isFetching || qCad.isFetching;
```

(e) No `return`, depois de `    cadErro: qCad.isError,`, inserir:

```ts
    /** F3.3 — o CAD cru (undefined = ainda não chegou; null = o modelo não tem CAD). */
    cadData: qCad.data,
    /** F3.3 — condições do kanban carregadas (selos: sem isto só o informativo — nunca "falta" no escuro). */
    condicoesProntas: qCondicoes.isSuccess,
```

`chavesBomServidor`/`chavesFichaBom` NÃO mudam (o teste da F3.2 exige as 5 + 3; `plan-ficha-cad` já está em `chavesFichaBom`).

- [ ] **Step 4: `useFichaBom` — a carga espera o CAD e o "tocado" fica exportado**

(a) Substituir:

```ts
    if (!deveHidratarCarga({ habilitada, bomFetching: dados.bomFetching, tecidosData, ocLinksData, aviamentosData, etiquetasData, gradesData })) return;
```

por:

```ts
    // F3.3 — `cadPronto`: o CAD hidrata no MESMO instante (useFichaCad segue `cargaSeq`); com a ficha tocada, o CAD
    // do servidor vai junto na comparação (`aoRecarregarComTocado` — o orquestrador lê `dados.cadData`).
    if (!deveHidratarCarga({ habilitada, bomFetching: dados.bomFetching, tecidosData, ocLinksData, aviamentosData, etiquetasData, gradesData, cadPronto: dados.cadData !== undefined })) return;
```

(b) Substituir:

```ts
  }, [habilitada, dados.bomFetching, dados.tecidosData, dados.ocLinksData, dados.aviamentosData, dados.etiquetasData, dados.gradesData, planejadosKey, hidratarTick]);
```

por:

```ts
  }, [habilitada, dados.bomFetching, dados.tecidosData, dados.ocLinksData, dados.aviamentosData, dados.etiquetasData, dados.gradesData, dados.cadData, planejadosKey, hidratarTick]);
```

(c) No `return`, substituir `    limparTocado, limparFlags, descartarEdicoes,` por:

```ts
    limparTocado, limparFlags, descartarEdicoes,
    // F3.3 — o CAD (useFichaCad) hidrata junto com esta carga (`cargaSeq`) e marca o MESMO "tocado".
    marcarTocado, cargaSeq,
```

- [ ] **Step 5: Criar `useFichaCad.ts`**

```ts
// F3.3 — estado EDITÁVEL da seção "CAD" no Sheet do Planejamento. PORTA (cópia) do PanelContent do Desenvolvimento
// (ModeloDetailPanel.tsx — estado :567-570, carga :1040-1174, handlers :1176-1220, folhas automáticas :1222-1269,
// rótulos :1271-1312, sincronia :1314-1386), que fica INTOCADO até a F5 (decisão travada 8). Diferenças DELIBERADAS
// (plano F3.3 §7):
//  • T1 — a carga é AMARRADA à do BOM (`cargaSeq` do useFichaBom): mesmos dados estáveis (o CAD entra no
//    `bomFetching`), nunca com a ficha tocada, e reaplica no "usar o novo" (hidratarTick → nova carga); espera os
//    catálogos (preço/largura/nome das linhas semeadas do BOM — no Dev a semeadura podia sair com preço 0);
//  • T2 — toda edição do CAD marca o "tocado" da ficha (no Dev só consumo/%loss marcavam);
//  • T4 — a sincronia cria a linha de um tecido novo na hora e tira a linha ainda não gravada de um bloco esvaziado;
//  • T7 — ao hidratar, entrega a assinatura do CAD do SERVIDOR (a referência do conflito "Tecidos & BOM").
import { useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { GradeRow, TecidoBlock } from "@/components/desenvolvimento/modelo-detail/types";
import {
  assinaturaCadServidor, atualizarLinhaCad, atualizarVarianteCad, calcularFolhasAuto, faltasCad, hidratarCad,
  idsVariantesDosBlocos, propagarBlocoParaCad, sincronizarCadComBlocos,
  type CadTecidoRow, type CadVarianteRow, type PatchBlocoCad, type RotulosVariante,
} from "./ficha-cad";
import type { FichaDados } from "./useFichaDados";

const SEM_LINHAS: CadTecidoRow[] = [];
const SEM_ROTULOS: RotulosVariante = {};

export function useFichaCad({
  modeloId, habilitada, dados, cargaSeq, blocks, grades, proporcoes, marcarTocado, aplicarConsumoNoBom, aoHidratar,
}: {
  modeloId: string | null;
  habilitada: boolean;
  dados: FichaDados;
  /** `useFichaBom.cargaSeq` — sobe a cada carga do BOM (sem toque, com as 6 queries estáveis). */
  cargaSeq: number;
  blocks: TecidoBlock[];
  grades: GradeRow[];
  proporcoes: Record<string, number>;
  marcarTocado: () => void;
  /** CAD → BOM (Dev :1187-1210): consumo/%loss editados no CAD vão ao bloco do mesmo tipo+número. */
  aplicarConsumoNoBom: (tipo: string, numero: number, patch: { consumo?: number; loss_percent?: number }) => void;
  /** Chamado a cada hidratação com a assinatura do CAD do SERVIDOR (referência do conflito). */
  aoHidratar: (assinaturaServidor: string) => void;
}) {
  const [linhas, setLinhas] = useState<CadTecidoRow[]>(SEM_LINHAS);
  // Folhas/metragem automáticas DESLIGADAS por padrão (Dev :569).
  const [autoFolhas, setAutoFolhasState] = useState(false);
  const [hidratado, setHidratado] = useState(false);
  const linhasRef = useRef(linhas);
  linhasRef.current = linhas;
  const aplicadaRef = useRef(0);
  const aoHidratarRef = useRef(aoHidratar);
  aoHidratarRef.current = aoHidratar;

  // Trocar de card na MESMA instância zera tudo (Dev :675).
  useEffect(() => {
    setLinhas(SEM_LINHAS);
    setAutoFolhasState(false);
    setHidratado(false);
    aplicadaRef.current = 0;
  }, [modeloId]);

  const ctx = useMemo(() => ({ artigoMap: dados.artigoMap, frozen: dados.frozenPrecos }), [dados.artigoMap, dados.frozenPrecos]);

  // Carga (Dev :1040-1174): 1× por carga do BOM (`cargaSeq`), com os catálogos prontos e nada recarregando.
  useEffect(() => {
    if (!habilitada || cargaSeq === 0 || cargaSeq === aplicadaRef.current) return;
    if (!dados.catalogosProntos || dados.bomFetching) return;
    const tec = dados.tecidosData;
    if (!tec || dados.cadData === undefined) return;
    aplicadaRef.current = cargaSeq;
    setLinhas(hidratarCad({ cad: dados.cadData, bomTecidos: tec.tecidos, bomVariantes: tec.variantes, artigoMap: ctx.artigoMap, frozen: ctx.frozen }));
    setHidratado(true);
    aoHidratarRef.current(assinaturaCadServidor(dados.cadData));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [habilitada, cargaSeq, dados.catalogosProntos, dados.bomFetching]);

  // Rótulos de TODAS as variantes dos blocos (Dev :1271-1312) — variante nova aparece com nome na hora.
  const idsVariantes = useMemo(() => idsVariantesDosBlocos(blocks), [blocks]);
  const qRotulos = useQuery({
    queryKey: ["plan-ficha-cad-rotulos", idsVariantes.join(",")],
    enabled: habilitada && idsVariantes.length > 0,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("variantes_tecido")
        .select("id, nome_variante, codigo_variante, cor:cor_id(nome), apelido:cor_apelido_id(nome)")
        .in("id", idsVariantes);
      if (error) throw error;
      const map: RotulosVariante = {};
      (data ?? []).forEach((v: any) => {
        map[v.id] = { nome: v.nome_variante ?? v.codigo_variante ?? null, cor: v.cor?.nome ?? null, apelido: v.apelido?.nome ?? null };
      });
      return map;
    },
  });
  const rotulos = qRotulos.data ?? SEM_ROTULOS;

  // Sincronia BOM → CAD depois da carga (Dev :1314-1386 + T4). Devolve a MESMA referência quando nada muda.
  useEffect(() => {
    if (!hidratado) return;
    setLinhas((prev) => sincronizarCadComBlocos(prev, blocks, rotulos, ctx));
  }, [hidratado, blocks, rotulos, ctx]);

  // Folhas/metragem automáticas (Dev :1222-1269). Idempotente (mesma referência quando nada muda) — sem laço.
  useEffect(() => {
    if (!autoFolhas) return;
    setLinhas((prev) => calcularFolhasAuto(prev, grades, proporcoes));
  }, [autoFolhas, grades, proporcoes, linhas]);

  // Handlers da seção (Dev :1176-1220) — T2: TODA edição marca o "tocado" da ficha.
  const updateTec = (i: number, patch: Partial<CadTecidoRow>) => {
    marcarTocado();
    setLinhas((prev) => atualizarLinhaCad(prev, i, patch));
    if (patch.consumo_cad !== undefined || patch.loss_percent_cad !== undefined) {
      const t = linhasRef.current[i];
      if (t) aplicarConsumoNoBom(t.tipo, t.numero, { consumo: patch.consumo_cad, loss_percent: patch.loss_percent_cad });
    }
  };
  const updateVar = (i: number, j: number, patch: Partial<CadVarianteRow>) => {
    marcarTocado();
    setLinhas((prev) => atualizarVarianteCad(prev, i, j, patch));
  };
  // Ligar o automático recalcula folhas/metragem (edição); desligar não muda valor.
  const setAutoFolhas = (v: boolean) => {
    if (v) marcarTocado();
    setAutoFolhasState(v);
  };
  /** BOM → CAD (Dev :2441-2456 + artigo, T4) — chamado pelo `updateBlock`/Importar do useFichaBom. */
  const propagarDoBloco = (tipo: string, numero: number, patch: PatchBlocoCad) => {
    setLinhas((prev) => propagarBlocoParaCad(prev, tipo, numero, patch, ctx));
  };

  const faltas = useMemo(() => faltasCad(linhas), [linhas]);

  return { linhas, linhasRef, hidratado, autoFolhas, setAutoFolhas, faltas, updateTec, updateVar, propagarDoBloco };
}
```

- [ ] **Step 6: Gates + commit**

`bash .superpowers/f33/gates.sh` → `GATES F3.3: ok` (o `useFichaCad` ainda não é usado — entra na Task 5; nada muda na tela).

```bash
F="src/components/planejamento/planejamento-detail/ficha/useFichaDados.ts src/components/planejamento/planejamento-detail/ficha/ficha-calc.ts src/components/planejamento/planejamento-detail/ficha/useFichaBom.ts src/components/planejamento/planejamento-detail/ficha/useFichaCad.ts tests/unit/ficha-cad.test.ts"
git add -- $F
git commit --only -m "feat(planejamento): F3.3 (4) — CAD embutido nos dados da ficha, carga do BOM espera o CAD e useFichaCad (carga/sincronia/folhas automáticas portadas do Dev)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- $F
```

**Revisão individual (Opus):** o `select` embutido × os campos do Dev (`:520`, `:531`); `bomFetching` depois do `qCad` (sem TDZ) e com o CAD; a carga do BOM não hidrata sem o CAD e compara com o CAD quando tocada; a carga do CAD roda 1× por `cargaSeq`, só com catálogos prontos e nada recarregando, e entrega a assinatura do SERVIDOR; a sincronia e o automático devolvem a mesma referência quando nada muda (sem laço); `SEM_*` estáveis; queryKeys `plan-ficha-*` próprias; nada do Dev/`CadTecidosSection` alterado.

---

## Task 5: Orquestração — propagação BOM↔CAD, `useFichaTecnica` com o CAD (guarda, referência, conferência, captura, selo)  *(individual Opus, JUNTO com a Task 6)*

> A trava interina "tem CAD" **continua** neste commit (sai na Task 6, no MESMO commit que passa a gravar o CAD — assim nenhum commit da branch deixa editar o BOM de um card com CAD sem regravar o CAD). Não rodar QA entre a Task 5 e a Task 6.

**Files:**
- Modify: `src/components/planejamento/planejamento-detail/ficha/useFichaBom.ts` (propagação BOM→CAD no `updateBlock`; `aplicarConsumoDoCad`)
- Modify: `src/components/planejamento/planejamento-detail/ficha/ficha-calc.ts` (`BomCapturado.cad`)
- Modify: `src/components/planejamento/planejamento-detail/ficha/useFichaTecnica.ts`
- Modify: `src/components/planejamento/PlanejamentoDetail.tsx` (1 linha: `ordemEnviada`)

**Interfaces:**
- Consumes: Task 1 (`assinaturaCad`, `assinaturaCadServidor`, `cadDivergeDaReferencia`, `deveGravarCad`, `linhasParaGravar`, `montarCadPayload`, `snapshotCad`, `CadCapturado`, `CadRowDb`, `CadTecidoRow`, `CadVarianteRow`, `PatchBlocoCad`); Task 3 (`seloCadSecao`); Task 4 (`useFichaCad`, `dados.cadData`, `dados.condicoesProntas`, `bom.marcarTocado`, `bom.cargaSeq`).
- Produces: `useFichaBom({…, aoMudarBloco?})` e `aplicarConsumoDoCad(tipo, numero, { consumo?, loss_percent? })`; `BomCapturado.cad: CadCapturado`; `useFichaTecnica({…, ordemEnviada: boolean})`; `FichaSave.capturar(custosAdicionais, opts?: { retry?: boolean; proporcoes?: Record<string, number> })`; `FichaSave.cadGravado(cad: CadCapturado)`; `FichaTecnica.cad = { linhas, autoFolhas, faltas, handlers: { updateTec, updateVar, setAutoFolhas } }`, `FichaTecnica.seloCad: SeloSecao`, `FichaTecnica.cadGravavel: boolean`, `FichaTecnica.cadAntesDaOrdem: boolean`; `ficha.dirty` passa a incluir o CAD.

- [ ] **Step 1: `useFichaBom` — propagação BOM → CAD e CAD → BOM**

(a) Depois de `import type { FichaDados } from "./useFichaDados";`, inserir:

```ts
import type { PatchBlocoCad } from "./ficha-cad";
```

(b) Trocar a linha do cabeçalho `//  • CAD fora (F3.3): sem cadTecidosState e sem a propagação BOM→CAD de updateBlock (Dev :2441-2456).` por:

```ts
//  • CAD (F3.3): o estado mora no useFichaCad; aqui ficam a propagação BOM→CAD do updateBlock (Dev :2441-2456, + artigo)
//    e o CAD→BOM (`aplicarConsumoDoCad`, Dev :1187-1210).
```

(c) Substituir a assinatura:

```ts
export function useFichaBom({ modeloId, habilitada, dados, tecidosPlanejados, proporcoes, setDraftTracked, aoRecarregarComTocado }: {
```

por:

```ts
export function useFichaBom({ modeloId, habilitada, dados, tecidosPlanejados, proporcoes, setDraftTracked, aoRecarregarComTocado, aoMudarBloco }: {
```

e, depois de `  aoRecarregarComTocado?: (servidor: EstadoBom) => void;`, inserir:

```ts
  /** F3.3 — consumo/%loss/artigo de um bloco mudaram por AÇÃO do usuário: leva à linha do CAD (useFichaCad). */
  aoMudarBloco?: (tipo: string, numero: number, patch: PatchBlocoCad) => void;
```

(d) Depois de `  aoRecarregarRef.current = aoRecarregarComTocado;`, inserir:

```ts
  const aoMudarBlocoRef = useRef(aoMudarBloco);
  aoMudarBlocoRef.current = aoMudarBloco;
```

(e) Trocar a linha-marcador `    // (Dev :2441-2456 — propagação BOM→CAD — entra na F3.3 junto com o CAD.)` por:

```ts
    // (Dev :2441-2456 — propagação BOM→CAD: no fim do `applyPatch`, abaixo — F3.3.)
```

(f) Substituir (fim do `applyPatch` do `updateBlock`):

```ts
        return recomputeBlock(merged, dados.artigoMap, varianteArtigoMap, frozen);
      }));
    };
```

por:

```ts
        return recomputeBlock(merged, dados.artigoMap, varianteArtigoMap, frozen);
      }));
      // F3.3 — propagação BOM → CAD (Dev :2441-2456) + artigo (T4): consumo/%loss/artigo do bloco vão à linha do CAD do
      // mesmo tipo+número. Aqui dentro p/ valer também depois do "Apagar grade preenchida?" (troca do Tecido 1).
      if (target && (patch.consumo !== undefined || patch.loss_percent !== undefined || patch.artigo_id !== undefined)) {
        aoMudarBlocoRef.current?.(target.tipo, target.numero, { consumo: patch.consumo, loss_percent: patch.loss_percent, artigo_id: patch.artigo_id });
      }
    };
```

(g) Antes de `  const onCampoEditado = (chave: string) => setCamposCopiados((prev) => {`, inserir:

```ts
  /** F3.3 — CAD → BOM (Dev :1187-1210): consumo/%loss editados na seção CAD vão ao bloco do mesmo tipo+número. */
  const aplicarConsumoDoCad = (tipo: string, numero: number, patch: { consumo?: number; loss_percent?: number }) => {
    marcarTocado();
    marcarFlag("consumo");
    setBlocks((bs) => bs.map((b) => {
      if (b.tipo !== tipo || b.numero !== numero) return b;
      const bomPatch: Partial<TecidoBlock> = {};
      if (patch.consumo !== undefined && b.consumo !== patch.consumo) bomPatch.consumo = patch.consumo;
      if (patch.loss_percent !== undefined && b.loss_percent !== patch.loss_percent) bomPatch.loss_percent = patch.loss_percent;
      if (bomPatch.consumo === undefined && bomPatch.loss_percent === undefined) return b;
      return recomputeBlock({ ...b, ...bomPatch }, dados.artigoMap, varianteArtigoMap, frozen);
    }));
  };

```

(h) No `return`, trocar `    marcarTocado, cargaSeq,` (Task 4) por `    marcarTocado, cargaSeq, aplicarConsumoDoCad,`.

- [ ] **Step 2: `BomCapturado` leva o CAD**

Em `ficha-calc.ts`, depois de `import type { GradeVarianteInfo } from "@/components/desenvolvimento/modelo-detail/ModeloGradeSection";`, inserir:

```ts
// Só TIPO (apagado no build): ficha-cad importa FUNÇÕES daqui — sem ciclo em tempo de execução.
import type { CadCapturado } from "./ficha-cad";
```

e substituir `  totais: TotaisBom | null;` (dentro de `BomCapturado`) por:

```ts
  totais: TotaisBom | null;
  /** F3.3 — o CAD que este Salvar grava (`deveGravarCad`; decisão F3 #7 "todo Salvar regrava", com guardas). */
  cad: CadCapturado;
```

- [ ] **Step 3: `useFichaTecnica` — imports, NO-OP do CAD e o tipo `FichaSave`**

(a) Depois de `import { requisitosUniao, seloSecaoBom, type SecaoBomKey, type SeloSecao } from "./selos-bom";`, inserir:

```ts
import { useFichaCad } from "./useFichaCad";
import {
  assinaturaCad, assinaturaCadServidor, cadDivergeDaReferencia, deveGravarCad, linhasParaGravar, montarCadPayload,
  snapshotCad, type CadCapturado, type CadRowDb, type CadTecidoRow, type CadVarianteRow, type PatchBlocoCad,
} from "./ficha-cad";
import { seloCadSecao } from "./selos-secoes";
```

(b) Substituir o fim do `HANDLERS_NOOP`:

```ts
  toggleGradeAuto: () => undefined,
};
```

por:

```ts
  toggleGradeAuto: () => undefined,
};
/** F3.3 — mesma receita p/ a seção CAD: sem permissão, travada, ou antes da Ordem sem CAD (D2) ⇒ nada muda com o mouse. */
const CAD_NOOP = {
  updateTec: (_i: number, _p: Partial<CadTecidoRow>) => undefined,
  updateVar: (_i: number, _j: number, _p: Partial<CadVarianteRow>) => undefined,
  setAutoFolhas: (_v: boolean) => undefined,
};
```

(c) Em `FichaSave`, trocar `  /** habilitada E carregada E sem trava (permissão / enviado / tem CAD) ⇒ colunas do Dev vão no UPDATE. */` por `  /** habilitada E carregada E sem trava (permissão / enviado) ⇒ colunas do Dev vão no UPDATE. */` e substituir:

```ts
  capturar: (custosAdicionais: unknown) => BomCapturado;
```

por:

```ts
  capturar: (custosAdicionais: unknown, opts?: { retry?: boolean; proporcoes?: Record<string, number> }) => BomCapturado;
  /** F3.3 — o CAD foi gravado: a referência do CAD vira o ENVIADO já (mesma ideia do `bomGravado`). */
  cadGravado: (cad: CadCapturado) => void;
```

(d) Nos argumentos de `useFichaTecnica`, depois de `  travaDev: MotivoTravaDev;`, inserir:

```ts
  /** F3.3 — `modelos.ordem_criacao_enviada` do SERVIDOR (D2: antes dela o Planejamento não cria o CAD). */
  ordemEnviada: boolean;
```

- [ ] **Step 4: `useFichaTecnica` — o CAD entra no orquestrador**

(a) Depois de `  const aoRecarregarComTocadoRef = useRef<(servidor: EstadoBom) => void>(() => undefined);`, inserir:

```ts
  // F3.3 — referência do CAD, SEPARADA da do BOM (o CAD grava num passo seguinte que pode falhar sozinho — §3 P6): o que
  // é DO CAD (folhas/metragens) no servidor sobre o qual o usuário edita. Nasce na HIDRATAÇÃO (a do servidor, não a local
  // — o cálculo automático de folhas mexe no local sem ser edição), vira o ENVIADO quando o CAD grava e o do servidor
  // no "manter meu".
  const referenciaCadRef = useRef<string | null>(null);
  const ultimaAssinaturaCadServidorRef = useRef<string | null>(null);
  // R1 do G-plano F3.3 — "o CAD local pode estar VELHO". Marcado SÍNCRONO no `aoMudarNoServidor` sem toque (Step 4 (k)):
  // o merge já avançou o `revRef` (PlanejamentoDetail.tsx:625, antes do :636), mas o `bomFetching` só vira true no
  // PRÓXIMO render e o CAD só re-hidrata um render DEPOIS de a carga do BOM subir o `cargaSeq`. Zerado no `aoHidratar`
  // (o CAD do servidor acabou de entrar no estado) e na troca de card. Enquanto true, a captura trata como "recarga em
  // curso": sem toque o Salvar NÃO grava o CAD (Step 5 (a); §7 T22). Não prende: sem toque, toda recarga pedida termina
  // numa carga (o `bomFetching` volta a false ⇒ o efeito de carga do useFichaBom roda ⇒ `cargaSeq` sobe ⇒ `aoHidratar`);
  // com toque, o `deveGravarCad` nem olha isto (grava pelo `tocado`, protegido pela conferência R5/R5a).
  const cadVelhoRef = useRef(false);
  // Propagação BOM → CAD: o useFichaBom chama isto; a função real vem do useFichaCad, criado DEPOIS dele.
  const aoMudarBlocoRef = useRef<(tipo: string, numero: number, patch: PatchBlocoCad) => void>(() => undefined);
```

(b) Na chamada `useFichaBom({ … })`, depois da linha `    aoRecarregarComTocado: (servidor) => aoRecarregarComTocadoRef.current(servidor),`, inserir:

```ts
    aoMudarBloco: (tipo, numero, patch) => aoMudarBlocoRef.current(tipo, numero, patch),
```

(c) Substituir o bloco do R5a:

```ts
  aoRecarregarComTocadoRef.current = (servidor) => {
    ultimaAssinaturaServidorRef.current = assinaturaBom(servidor);
    if (bom.colecoesTouchadasRef.current && bomDivergeDaReferencia(referenciaRef.current, servidor)) {
      setConflitoBomBoth(true);
    }
  };
```

por:

```ts
  aoRecarregarComTocadoRef.current = (servidor) => {
    ultimaAssinaturaServidorRef.current = assinaturaBom(servidor);
    // F3.3 — o CAD do servidor chega junto (a carga espera as 6 queries estáveis — `bomFetching` inclui o CAD).
    const cadServidor = dados.cadData ?? null;
    ultimaAssinaturaCadServidorRef.current = assinaturaCadServidor(cadServidor);
    // Durante o PRÓPRIO save (`saveEmVooContadorRef > 0`, item G da F3.2 — contador desde o fix round 3) o CAD do
    // servidor pode já ser o ENVIADO antes de o `cadGravado` mover a referência (o `bomGravado` invalida tudo no meio da
    // cadeia): o CAD não é comparado aqui — o `aposSalvar` recarrega e a carga seguinte compara com a referência já nova.
    const cadDiverge = saveEmVooContadorRef.current === 0 && cadDivergeDaReferencia(referenciaCadRef.current, cadServidor);
    if (bom.colecoesTouchadasRef.current && (bomDivergeDaReferencia(referenciaRef.current, servidor) || cadDiverge)) {
      setConflitoBomBoth(true);
    }
  };
  // F3.3 — a seção CAD (porta do Dev): carga amarrada à do BOM, mesmo "tocado", propagação nos dois sentidos.
  const cad = useFichaCad({
    modeloId: a.modeloId, habilitada, dados, cargaSeq: bom.cargaSeq,
    blocks: bom.blocks, grades: bom.grades, proporcoes: a.proporcoes,
    marcarTocado: bom.marcarTocado, aplicarConsumoNoBom: bom.aplicarConsumoDoCad,
    // R1 — o CAD do servidor entrou no estado: some o "CAD velho" (Step 4 (a)).
    aoHidratar: (assinatura) => { referenciaCadRef.current = assinatura; cadVelhoRef.current = false; },
  });
  aoMudarBlocoRef.current = cad.propagarDoBloco;
```

(d) Depois de `  const guarda = useFichaGuarda({ modeloId: a.modeloId, snapshot, tocado: bom.tocado, hidratado: bom.hidratado });`, inserir:

```ts
  // F3.3 — "não salvo" do CAD: 2ª guarda com o MESMO "tocado" da ficha (a do BOM segue a da F3.2).
  const snapshotCadAtual = useMemo(() => snapshotCad(cad.linhas), [cad.linhas]);
  const guardaCad = useFichaGuarda({ modeloId: a.modeloId, snapshot: snapshotCadAtual, tocado: bom.tocado, hidratado: cad.hidratado });
```

(e) Substituir `  const carregado = habilitada && bom.hidratado && dados.catalogosProntos && bom.varianteArtigoMapPronto;` por:

```ts
  const carregado = habilitada && bom.hidratado && dados.catalogosProntos && bom.varianteArtigoMapPronto && cad.hidratado;
```

(f) Substituir:

```ts
  const handlers = useMemo(
    () => (podeEditar ? bom.handlers : HANDLERS_NOOP),
    [podeEditar, bom.handlers],
  );
```

por:

```ts
  const handlers = useMemo(
    () => (podeEditar ? bom.handlers : HANDLERS_NOOP),
    [podeEditar, bom.handlers],
  );
  // F3.3 — D2: antes da Ordem de Criação o Planejamento NÃO cria o CAD (FK `cad.modelo_id` NO ACTION: o card não se
  // excluiria mais). Sem CAD e sem Ordem, a seção CAD é só-leitura (o que se digitasse não seria gravado).
  const cadGravavel = podeEditar && (dados.cadExiste || a.ordemEnviada);
  const cadHandlers = cadGravavel ? { updateTec: cad.updateTec, updateVar: cad.updateVar, setAutoFolhas: cad.setAutoFolhas } : CAD_NOOP;
  // Espelho SÍNCRONO do que a captura do CAD precisa (mesma razão do `podeEditarRef`: o retry do P0409 roda fora do
  // ciclo de render).
  const cadCapturaRef = useRef({ hidratado: false, existe: false, ordemEnviada: false, recarregando: false, chavesBom: new Set<string>() as ReadonlySet<string> });
  cadCapturaRef.current = {
    hidratado: cad.hidratado, existe: dados.cadExiste, ordemEnviada: a.ordemEnviada, recarregando: dados.bomFetching,
    chavesBom: new Set((dados.tecidosData?.tecidos ?? []).map((t) => `${t.tipo}|${t.numero}`)),
  };
```

(g) Substituir:

```ts
    grade: seloSecaoBom("grade", requeridas, dados.condicoes, resumo),
  };
```

por:

```ts
    grade: seloSecaoBom("grade", requeridas, dados.condicoes, resumo),
  };
  // F3.3 — selo da seção CAD (Dev :2886-2890 + requisito `cad_preenchido`, no estado SALVO).
  const seloCad = seloCadSecao({
    requeridas, satisfeitas: dados.condicoesProntas ? dados.condicoes : null,
    linhas: cad.linhas.length, faltas: cad.faltas, antesDaOrdem: !dados.cadExiste && !a.ordemEnviada,
  });
```

(h) No efeito de reset por modelo, depois de `    ultimaAssinaturaServidorRef.current = null;`, inserir:

```ts
    referenciaCadRef.current = null;
    ultimaAssinaturaCadServidorRef.current = null;
    cadVelhoRef.current = false;
```

(i) Em `bomMudouNoServidor`, substituir:

```ts
      const chaves = chavesBomServidor(id);
```

por:

```ts
      // F3.3 — o CAD entra na conferência (a referência do CAD cobre folhas/metragens).
      const chaves = [...chavesBomServidor(id), ["plan-ficha-cad", id]];
```

substituir:

```ts
      if (!tec || !oc || !av || !et || !gr) return true;
```

por:

```ts
      const cadSrv = qc.getQueryData<CadRowDb | null>(["plan-ficha-cad", id]);
      if (!tec || !oc || !av || !et || !gr || cadSrv === undefined) return true;
```

e substituir:

```ts
      return bomDivergeDaReferencia(referenciaRef.current, servidor);
```

por:

```ts
      ultimaAssinaturaCadServidorRef.current = assinaturaCadServidor(cadSrv);
      return bomDivergeDaReferencia(referenciaRef.current, servidor) || cadDivergeDaReferencia(referenciaCadRef.current, cadSrv);
```

(j) Em `resolverConflitoBom`, depois de `      if (ultimaAssinaturaServidorRef.current) referenciaRef.current = ultimaAssinaturaServidorRef.current;`, inserir:

```ts
      if (ultimaAssinaturaCadServidorRef.current !== null) referenciaCadRef.current = ultimaAssinaturaCadServidorRef.current;
```

(k) **R1 do G-plano F3.3** — em `aoMudarNoServidor`, substituir o ramo SEM toque (âncora da Task 0 Step 3):

```ts
    if (!bom.colecoesTouchadasRef.current) { invalidarBom(); return; }
```

por:

```ts
    if (!bom.colecoesTouchadasRef.current) {
      // F3.3 — R1 (G-plano): SÍNCRONO e ANTES do invalidar. O `revRef` já avançou (merge) e o `bomFetching` só vira true
      // no próximo render: sem isto, um Salvar nessa janela passaria no `.eq("rev")` e o `salvar_cad_completo` regravaria
      // CAD, consumo e grade VELHOS por cima da edição de outra pessoa. Zerado no `aoHidratar` do CAD.
      cadVelhoRef.current = true;
      invalidarBom();
      return;
    }
```

(O ramo do save em voo — `saveEmVooContadorRef.current > 0` — e o ramo com toque NÃO mudam: com toque o `deveGravarCad` grava pelo `tocado`, e o Salvar já espera a conferência síncrona do `verificandoBomRef`.)

- [ ] **Step 5: `useFichaTecnica` — captura, pós-save e retorno**

(a) Antes de `  const save: FichaSave = {`, inserir:

```ts
  /**
   * F3.3 — o CAD que ESTE Salvar grava (Dev :2062-2119; decisão F3 #7 "todo Salvar regrava" com as guardas de
   * `deveGravarCad` — plano F3.3 §3 P2). Lê refs (vale no retry). `linhasParaGravar`: linha que o servidor não tem só vai
   * quando o BOM grava junto (senão o CAD ganharia um tecido que o BOM do servidor não tem).
   */
  const capturarCad = (e: EstadoBom, bomGravado: boolean, retry: boolean, proporcoes: Record<string, number>): CadCapturado => {
    const c = cadCapturaRef.current;
    const estadoCad = cad.linhasRef.current;
    const linhas = linhasParaGravar(estadoCad, { bomGravado, chavesBomServidor: c.chavesBom });
    // `tocado` = a ficha foi tocada OU o BOM grava neste Salvar (inclui o pré-preenchimento pendente da F3.2 — item E):
    // §3 P2 — se o BOM grava, o CAD grava junto. `recarregando` = recarga em curso (`bomFetching`, espelho do render)
    // OU pedida e ainda não aplicada ao CAD (`cadVelhoRef`, SÍNCRONO — R1 do G-plano F3.3): sem toque, não grava o CAD.
    const gravar = deveGravarCad({
      podeEditar: podeEditarRef.current, cadHidratado: c.hidratado, cadExiste: c.existe, ordemEnviada: c.ordemEnviada,
      linhas: linhas.length, tocado: bom.colecoesTouchadasRef.current || bomGravado, retry,
      recarregando: c.recarregando || cadVelhoRef.current,
    });
    return {
      estado: estadoCad, linhas, snapshot: snapshotCad(estadoCad), gravar,
      payload: gravar ? montarCadPayload({ cad: linhas, grades: e.grades, aviamentos: e.aviamentos, etiquetas: e.etiquetas, proporcoes }) : null,
    };
  };
```

(b) Trocar `    capturar: (custosAdicionais) => {` por `    capturar: (custosAdicionais, opts) => {` e substituir:

```ts
        totais: podeEditarRef.current ? totaisBom({ blocks: e.blocks, aviamentos: e.aviamentos, etiquetas: e.etiquetas, custosAdicionais, maoObra: 0 }) : null,
```

por:

```ts
        totais: podeEditarRef.current ? totaisBom({ blocks: e.blocks, aviamentos: e.aviamentos, etiquetas: e.etiquetas, custosAdicionais, maoObra: 0 }) : null,
        cad: capturarCad(e, gravar, !!opts?.retry, opts?.proporcoes ?? a.proporcoes),
```

(c) Antes de `    aposSalvar: ({ bomEnviado }) => {`, inserir:

```ts
    // F3.3 — a referência do CAD vira o ENVIADO assim que o servidor o tem (mesmo que um passo seguinte falhe).
    cadGravado: (c) => { referenciaCadRef.current = assinaturaCad(c.linhas); },
```

(d) Substituir:

```ts
      const vivo = snapshotBom(bom.estadoRef.current);
      const bomMudouEmVoo = bom.colecoesTouchadasRef.current && vivo !== bomEnviado.snapshot;
      if (bomMudouEmVoo) guarda.rebasear(bomEnviado.snapshot);
      else bom.limparTocado();
```

por:

```ts
      const vivo = snapshotBom(bom.estadoRef.current);
      // F3.3 — o CAD entra na MESMA regra: edição em voo no CAD também segue "não salva" (as DUAS guardas re-baseiam no
      // ENVIADO; sem edição em voo, o "tocado" da ficha inteira solta).
      const cadMudouEmVoo = snapshotCad(cad.linhasRef.current) !== bomEnviado.cad.snapshot;
      const bomMudouEmVoo = bom.colecoesTouchadasRef.current && (vivo !== bomEnviado.snapshot || cadMudouEmVoo);
      if (bomMudouEmVoo) { guarda.rebasear(bomEnviado.snapshot); guardaCad.rebasear(bomEnviado.cad.snapshot); }
      else bom.limparTocado();
```

e, depois de `      if (bomEnviado.gravar) referenciaRef.current = assinaturaBom(bomEnviado.estado);`, inserir:

```ts
      if (bomEnviado.cad.gravar) referenciaCadRef.current = assinaturaCad(bomEnviado.cad.linhas);
```

(e) No `return`, trocar `    tecido1Info, totais, selos,` por:

```ts
    tecido1Info, totais, selos, seloCad,
    // F3.3 — seção CAD (render em BomSecoes) e as regras dela.
    cad: { linhas: cad.linhas, autoFolhas: cad.autoFolhas, faltas: cad.faltas, handlers: cadHandlers },
    cadGravavel, cadAntesDaOrdem: !dados.cadExiste && !a.ordemEnviada,
```

e trocar `    dirty: guarda.dirty,` por `    dirty: guarda.dirty || guardaCad.dirty,`.

- [ ] **Step 6: `PlanejamentoDetail` — passa `ordemEnviada`**

Depois da linha `    travaDev: motivoTravaDev,` (chamada `useFichaTecnica`), inserir:

```ts
    // F3.3 — D2: o CAD só nasce depois da Ordem de Criação. Lê o SERVIDOR (o `enviada` local é declarado mais abaixo).
    ordemEnviada: !!(modeloData as any)?.ordem_criacao_enviada,
```

- [ ] **Step 7: Gates + commit**

`bash .superpowers/f33/gates.sh` → ok. Conferências de texto (literais ⇒ `-cF`, R6): `grep -cF "cad: capturarCad(" src/components/planejamento/planejamento-detail/ficha/useFichaTecnica.ts` = 1; `grep -cF '? "cad"' …/useFichaTecnica.ts` = 1 (a trava AINDA está — sai na Task 6); R1: `grep -cF "cadVelhoRef.current = true;" …/useFichaTecnica.ts` = 1 (só no ramo sem toque do `aoMudarNoServidor`), `grep -cF "cadVelhoRef.current = false;" …/useFichaTecnica.ts` = 2 (`aoHidratar` e reset por modelo), `grep -cF "recarregando: c.recarregando || cadVelhoRef.current," …/useFichaTecnica.ts` = 1.

```bash
F="src/components/planejamento/planejamento-detail/ficha/useFichaBom.ts src/components/planejamento/planejamento-detail/ficha/ficha-calc.ts src/components/planejamento/planejamento-detail/ficha/useFichaTecnica.ts src/components/planejamento/PlanejamentoDetail.tsx"
git add -- $F
git commit --only -m "feat(planejamento): F3.3 (5) — ficha com o CAD: propagação BOM↔CAD, 'não salvo', referência e conferência do CAD, captura do CAD no Salvar e selo

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- $F
```

---

## Task 6: Salvar grava o CAD (`salvar_cad_completo`) e a trava "tem CAD" sai  *(individual Opus, JUNTO com a Task 5)*

**Files:**
- Modify: `src/components/planejamento/planejamento-detail/ficha/persistir-bom.ts` (`persistirCad`, `invalidarAposGravarCad`)
- Modify: `src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts` (CAD na cadeia, erro específico, invalidações)
- Modify: `src/components/planejamento/planejamento-detail/ficha/useFichaTecnica.ts` (tira o motivo "cad")

**Interfaces:**
- Consumes: Task 5 (`BomCapturado.cad`, `FichaSave.capturar(…, opts)`, `FichaSave.cadGravado`).
- Produces: `persistirCad(modeloId: string, cad: CadCapturado): Promise<void>`; `invalidarAposGravarCad(qc: QueryClient, modeloId: string | null): void`; cadeia do Salvar = UPDATE `modelos` (`.eq("rev")`) → `salvar_modelo_bom` → etiquetas → **`salvar_cad_completo`** → MO → `custo_peca_previsto` → `marcar_revisao_por_mudanca`; `e.etapaFalha = "cad"`.

- [ ] **Step 1: `persistir-bom.ts` — gravar o CAD e invalidar quem o lê**

(a) Substituir o bloco de imports:

```ts
import { supabase } from "@/integrations/supabase/client";
import {
  blocosTecidosIniciais, montarAviamentosPayload, montarGradesPayload, montarTecidosPayload, planoEtiquetas,
  type BomCapturado,
} from "./ficha-calc";
```

por:

```ts
import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  blocosTecidosIniciais, montarAviamentosPayload, montarGradesPayload, montarTecidosPayload, planoEtiquetas,
  type BomCapturado,
} from "./ficha-calc";
import type { CadCapturado } from "./ficha-cad";
```

(b) Antes de `export async function gravarTecidosIniciais(modeloIdRecemCriado: string, artigoIds: string[]): Promise<void> {` (e do comentário `/**` logo acima dela), inserir:

```ts
/**
 * F3.3 — grava o CAD pela MESMA RPC do Dev (`salvar_cad_completo`, ModeloDetailPanel.tsx:2092-2118). A RPC APAGA e
 * re-insere tecidos/variantes/aviamentos/etiquetas do CAD e, com grade, `cad_grades` e `modelo_grades` (preservando a
 * grade real com CQ confirmado — funcoes.sql:6779-6810), grava `modelos.proporcoes` e devolve consumo/%loss ao BOM
 * (:6878-6881 — aqui os MESMOS valores que o `salvar_modelo_bom` acabou de gravar: plano F3.3 §3 P3). `_observacoes_molde:
 * null`, `enviar_por_tamanho: {}` e as quantidades recalculadas (consumo × grade) = paridade com o Dev: num card JÁ enviado
 * (com "Editar") isso apaga os ajustes da Explosão — obs. do molde, envio por tamanho, "a separar" dos aviamentos
 * (`cad_aviamentos.quantidade_separar`, ExplosaoDetail.tsx:699/:783) e "a enviar" dos insumos
 * (`cad_etiquetas.quantidade_enviar`, ExplosaoInsumosSection.tsx:7) voltam ao cálculo —, igual ao Dev (decisão F3 #7 (a);
 * D4; correção = tarefa própria). Só com `cad.gravar` — nunca vazio (`deveGravarCad`).
 */
export async function persistirCad(modeloId: string, cad: CadCapturado): Promise<void> {
  if (!cad.gravar || !cad.payload) return;
  const { error } = await supabase.rpc("salvar_cad_completo" as any, { _modelo_id: modeloId, ...cad.payload } as any);
  if (error) throw error;
}

/** F3.3 — quem lê o CAD relê depois de o Salvar gravá-lo (Dev :2244-2266 + o CQ/Lançar do Planejamento, `plan-cq`). */
export function invalidarAposGravarCad(qc: QueryClient, modeloId: string | null): void {
  for (const k of ["dev-cad-row", "explosao-cad-row", "modelo-cad-calc", "plan-cq"]) qc.invalidateQueries({ queryKey: [k, modeloId] });
  for (const k of ["dev-cad-tecidos", "dev-cad-aviamentos", "dev-cad-etiquetas", "explosao-cad-tecidos", "explosao-cad-grades"]) {
    qc.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === k });
  }
  qc.invalidateQueries({ queryKey: ["producao-explosao-list"] });
  qc.invalidateQueries({ predicate: (q) => typeof q.queryKey?.[0] === "string" && (q.queryKey[0] as string).startsWith("ft-") });
}

```

- [ ] **Step 2: `usePlanejamentoSave` — o CAD na cadeia**

(a) Substituir o import:

```ts
import { gravarTecidosIniciais, persistirBom } from "@/components/planejamento/planejamento-detail/ficha/persistir-bom";
```

por:

```ts
import { gravarTecidosIniciais, invalidarAposGravarCad, persistirBom, persistirCad } from "@/components/planejamento/planejamento-detail/ficha/persistir-bom";
```

(b) Substituir:

```ts
      const bom = fichaRef.current.capturar(d.custos_adicionais);
```

por:

```ts
      // F3.3 — a captura do CAD precisa saber se é o retry do P0409 (sem toque, o CAD local pode estar velho) e das
      // proporções ENVIADAS (o `salvar_cad_completo` grava `modelos.proporcoes`).
      const bom = fichaRef.current.capturar(d.custos_adicionais, { retry: retryRef.current, proporcoes: d.proporcoes });
```

(c) Antes da linha `      // MO por serviço (spec 2026-08-06): persiste os VALORES das linhas (estado COMPLETO;`, inserir:

```ts
      // F3.3 — CAD no MESMO Salvar (decisão F3 #7; Dev :2062-2119): DEPOIS do BOM e das etiquetas (a RPC devolve
      // consumo/%loss do CAD ao BOM — funcoes.sql:6878-6881 — e aqui são os MESMOS valores: plano F3.3 §3 P1–P3) e ANTES
      // da MO. Só card existente; `bom.cad.gravar` já decidiu tudo (`deveGravarCad`). Falha aqui = o BOM já gravou e o CAD
      // não (cadeia não atômica, como no Dev): etapa marcada p/ a mensagem própria no onError.
      if (isEdit && modeloId && bom.cad.gravar) {
        try {
          await persistirCad(modeloId, bom.cad);
        } catch (eCad) {
          (eCad as any).etapaFalha = "cad";
          throw eCad;
        }
        fichaRef.current.cadGravado(bom.cad);
      }
```

(d) Antes da linha `      if (enviadoRef.current?.bom.gravar) {` (onSuccess), inserir:

```ts
      // F3.3 — o CAD gravado: Explosão, Ficha Técnica, Sheet do Dev e o CQ/Lançar deste card relêem.
      if (enviadoRef.current?.bom.cad.gravar) invalidarAposGravarCad(qc, modeloId);
```

(e) Substituir a ÚLTIMA linha do `onError`:

```ts
      toast.error(mensagemErro(e, "Erro"));
```

por:

```ts
      // F3.3 — o CAD falhou (passo DEPOIS do BOM e das etiquetas). O selo "não salvo" segue aceso (o onSuccess não rodou)
      // e o próximo Salvar grava os dois (plano F3.3 §3 P6). R2 do G-plano F3.3: "os tecidos foram salvos" SÓ quando ESTE
      // Salvar gravou o BOM (`bom.gravar`) — num Salvar sem toque o BOM não grava e só o CAD (regravado por paridade)
      // falhou. As duas pedem "salve de novo antes de fechar": fechar e DESCARTAR deixa a deriva BOM × CAD, e o próximo
      // Salvar sem toque (aqui ou no Dev) devolve ao BOM o consumo do CAD em silêncio (paridade com o Dev — §6 R11).
      if (e?.etapaFalha === "cad") {
        const detalhe = mensagemErro(e, "erro desconhecido");
        toast.error(enviadoRef.current?.bom.gravar
          ? `Os tecidos foram salvos, mas o CAD não — salve de novo antes de fechar. (${detalhe})`
          : `O CAD não foi salvo — salve de novo antes de fechar. (${detalhe})`);
        return;
      }
      toast.error(mensagemErro(e, "Erro"));
```

- [ ] **Step 3: `useFichaTecnica` — a trava interina "tem CAD" sai (§3)**

(a) Trocar a linha do cabeçalho:

```ts
// Trava ÚNICA (R2 do G-plano conjunto): deriva da trava da F3.1 (`travaDev`) + a trava interina "tem CAD".
```

por:

```ts
// Trava ÚNICA (R2 do G-plano conjunto): deriva da trava da F3.1 (`travaDev`). F3.3: a trava interina "tem CAD" saiu.
```

(b) Substituir o comentário da trava e o fim do `motivoSomenteLeitura`:

```ts
  // Trava ÚNICA (R2 do G-plano conjunto): DERIVA da trava da F3.1 e soma a trava INTERINA "tem CAD" (até a F3.3):
  // sem regravar o CAD, um consumo editado aqui seria DEVOLVIDO pelo próximo Salvar do Dev (salvar_cad_completo copia
  // consumo_cad → BOM, funcoes.sql:6878-6881) e a Explosão ficaria desalinhada. Card enviado ⇒ tem CAD (0 exceções na
  // cópia local): o "Editar" da F3.1 destrava os campos simples do Dev, mas aqui o motivo só passa de "enviado" a "cad".
```

por:

```ts
  // Trava ÚNICA (R2 do G-plano conjunto): DERIVA da trava da F3.1. F3.3 — a trava interina "tem CAD" da F3.2 SAIU: o
  // Salvar grava o CAD junto com o BOM (`deveGravarCad` + usePlanejamentoSave) e toda edição leva consumo/%loss/artigo às
  // DUAS estruturas, então o próximo Salvar do Dev não desfaz nada (prova: plano F3.3 §3). O "Editar" da F3.1 destrava
  // BOM e CAD junto com os demais campos do Dev.
```

e substituir:

```ts
          : dados.cadExiste ? "cad"
            : null;
```

por:

```ts
          : null;
```

(O `"cad"` segue no TIPO `MotivoSomenteLeitura` até a Task 7 — o `BomSecoes` ainda o compara; nenhum valor o produz mais.)

- [ ] **Step 4: Prova no código (conferência de texto) + gates**

```bash
D=src/components/planejamento/planejamento-detail
grep -n 'bom.cad.gravar\|persistirCad(modeloId' $D/usePlanejamentoSave.ts        # 2 linhas: o if e a chamada
awk '/await persistirBom\(modeloId, bom\);/{a=NR} /await persistirCad\(modeloId, bom.cad\);/{b=NR} /salvar_modelo_servico_mo/{c=NR} END{print (a<b && b<c) ? "ordem BOM → CAD → MO: ok" : "ORDEM ERRADA"}' $D/usePlanejamentoSave.ts
grep -cF '? "cad"' $D/ficha/useFichaTecnica.ts                                   # 0
grep -nF 'rpc("salvar_cad_completo"' $D/ficha/persistir-bom.ts                   # 1
grep -cF 'salve de novo antes de fechar' $D/usePlanejamentoSave.ts                # 2 (R2: com e sem `bom.gravar`)
grep -cF 'enviadoRef.current?.bom.gravar' $D/usePlanejamentoSave.ts               # 3 (F3.2: onSuccess e retry do P0409 = 2 em ebb371d; + a mensagem do CAD)
```

Expected: como nos comentários; `ordem BOM → CAD → MO: ok`. Depois `bash .superpowers/f33/gates.sh` → ok.

- [ ] **Step 5: Commit**

```bash
F="src/components/planejamento/planejamento-detail/ficha/persistir-bom.ts src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts src/components/planejamento/planejamento-detail/ficha/useFichaTecnica.ts"
git add -- $F
git commit --only -m "feat(planejamento): F3.3 (6) — Salvar grava o CAD (salvar_cad_completo depois do BOM, antes da MO) e a trava interina 'tem CAD' sai (decisão F3 #7)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- $F
```

**Revisão individual (Opus) das Tasks 5+6 juntas:** (1) §3 P1–P7 contra o código: propagação nos 3 caminhos (Tecidos, CAD, Importar — este na Task 10), `deveGravarCad` na captura com refs, ordem da cadeia, `cadGravado` só depois do sucesso; (2) retry do P0409: sem toque ⇒ nem BOM nem CAD; com toque e servidor igual ⇒ os dois; com toque e servidor mudado (BOM **ou** CAD) ⇒ "Tecidos & BOM" e nada grava; (3) save-em-voo: edição no CAD durante o voo segue "não salva" e o eco não a reverte; (4) D2: sem CAD e sem Ordem, nada cria o CAD e a seção CAD é só-leitura; (5) `referenciaCadRef` nasce do SERVIDOR (não do local recalculado pelo automático); (6) nenhuma chave `plan-ficha-*` compartilhada com outra forma; (7) a F3.2 segue verde (6º gate) e o Dev intocado; (8) R1 do G-plano: `cadVelhoRef` marcado SÍNCRONO só no ramo sem toque do `aoMudarNoServidor`, ANTES do `invalidarBom`, zerado no `aoHidratar` e no reset por modelo, e somado ao `recarregando` da captura — sem toque, um Salvar na janela "rev novo, CAD ainda velho" não grava o CAD, e o ref não prende (toda recarga sem toque termina num `aoHidratar`); (9) R2: a mensagem de falha do CAD depende de `bom.gravar` e pede "salve de novo antes de fechar".

---

## Task 7: UI — seção CAD, avisos iguais aos da F3.1, `Secao`/`SecaoBom` com número/selo/chip e abertura por pedido  *(Lote B)*

**Files:**
- Create: `src/components/planejamento/planejamento-detail/ficha/secoes/SeloBadge.tsx` (sai do `BomSecoes`)
- Create: `src/components/planejamento/planejamento-detail/secoes-abertas.tsx`
- Modify: `src/components/planejamento/planejamento-detail/campos.tsx` (`Secao`)
- Modify: `src/components/planejamento/planejamento-detail/ficha/secoes/SecaoBom.tsx`
- Modify: `src/components/planejamento/planejamento-detail/ficha/secoes/BomSecoes.tsx`
- Modify: `src/components/planejamento/planejamento-detail/ficha/useFichaTecnica.ts` (tipo `MotivoSomenteLeitura` sem "cad")
- Modify: `src/components/planejamento/PlanejamentoDetail.tsx` (sai o `onAbrirDev` da chamada do `BomSecoes`)
- Test: `tests/unit/planejamento-secoes-abertas.test.ts`

**Interfaces:**
- Consumes: Task 5/6 (`ficha.cad`, `ficha.seloCad`, `ficha.cadGravavel`, `ficha.cadAntesDaOrdem`); `CadTecidosSection` (props `tecidos/updateTec/updateVar/autoFolhas/onToggleAutoFolhas/readOnly/hideSeparar`, `CadTecidosSection.tsx:12-24` — SEM modificar).
- Produces: `SeloBadge({ selo })`; `PedidoSecao`, `PedidoSecaoContext`, `proximoPedido(atual, chave)`, `usePedidoAbertura(id, abrir, ref)`; `Secao({ id?, titulo, numero?, selo?, chip?, children, defaultOpen? })`; `SecaoBom({ …, numero? })`; `BomSecoes` sem `onAbrirDev`; `MotivoSomenteLeitura = "permissao" | "enviado" | "carregando" | null`.

- [ ] **Step 1: Teste do pedido de abertura (falha)**

Criar `tests/unit/planejamento-secoes-abertas.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { proximoPedido } from "@/components/planejamento/planejamento-detail/secoes-abertas";

// F3.3 — links do "Para enviar, falta…" (Dev ModeloDetailPanel.tsx:3107-3147): cada clique é um pedido NOVO, mesmo para
// a mesma seção (o usuário fecha a seção e clica de novo ⇒ ela reabre e rola).
describe("proximoPedido", () => {
  it("numera cada pedido e guarda a seção pedida", () => {
    const a = proximoPedido(null, "grade");
    const b = proximoPedido(a, "grade");
    const c = proximoPedido(b, "desenvolvimento");
    expect(a).toEqual({ chave: "grade", n: 1 });
    expect(b).toEqual({ chave: "grade", n: 2 });
    expect(c).toEqual({ chave: "desenvolvimento", n: 3 });
    expect(b).not.toBe(a);
  });
});
```

Run: `env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit/planejamento-secoes-abertas.test.ts` → FAIL (módulo inexistente).

- [ ] **Step 2: `secoes-abertas.tsx`**

```tsx
// F3.3 — "abrir a seção X" por pedido (links do "Para enviar, falta…" do rodapé — porta do `irParaSecao` do Dev,
// ModeloDetailPanel.tsx:3107-3147). O orquestrador guarda o ÚLTIMO pedido e o provê; a `Secao`/`SecaoBom` com o MESMO
// `id` abre e rola até si. Um contador faz o mesmo link funcionar de novo.
import { createContext, useContext, useEffect, useRef, type RefObject } from "react";

export type PedidoSecao = { chave: string; n: number } | null;

export const PedidoSecaoContext = createContext<PedidoSecao>(null);

export function proximoPedido(atual: PedidoSecao, chave: string): PedidoSecao {
  return { chave, n: (atual?.n ?? 0) + 1 };
}

/** Abre (`abrir`) e rola até a seção quando chega um pedido NOVO para ela (o pedido que já existia ao montar não conta). */
export function usePedidoAbertura(id: string | undefined, abrir: () => void, ref: RefObject<HTMLElement | null>) {
  const pedido = useContext(PedidoSecaoContext);
  const inicialRef = useRef(pedido);
  useEffect(() => {
    if (!id || !pedido || pedido === inicialRef.current || pedido.chave !== id) return;
    abrir();
    const el = ref.current;
    if (el) requestAnimationFrame(() => el.scrollIntoView({ behavior: "smooth", block: "start" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedido]);
}
```

Run o teste → PASS.

- [ ] **Step 3: `SeloBadge.tsx` (sai do `BomSecoes`, igual)**

```tsx
// F3.2/F3.3 — selo de completude de seção (StatusBadge §Q + "i" da condição quando falta UM requisito). Saiu do
// BomSecoes na F3.3 p/ servir TODAS as seções do Sheet (numeração/selos — Task 8).
import { AlertTriangle, Check } from "lucide-react";
import { StatusBadge, type StatusTone } from "@/components/shared/StatusBadge";
import { CondicaoInfo } from "@/components/shared/CondicaoInfo";
import type { SeloSecao } from "../selos-bom";

const TOM: Record<SeloSecao["tone"], StatusTone> = { ok: "success", info: "info", warn: "warning", muted: "neutral" };

export function SeloBadge({ selo }: { selo: SeloSecao }) {
  return (
    <span className="inline-flex items-center gap-1">
      <StatusBadge tone={TOM[selo.tone]} title={selo.title} className="gap-1 rounded-full px-2 py-0.5 text-[11px] normal-case tracking-normal">
        {selo.tone === "ok" ? <Check className="h-3 w-3" /> : selo.tone === "warn" ? <AlertTriangle className="h-3 w-3" /> : null}
        {selo.texto}
      </StatusBadge>
      {selo.condicaoUnica && <CondicaoInfo descricao={selo.condicaoUnica.descricao} aviso={selo.condicaoUnica.aviso} />}
    </span>
  );
}
```

(Conferir antes que o `SeloBadge`/`TOM` do `BomSecoes.tsx` no BASE é EXATAMENTE este corpo; se divergir, o arquivo novo recebe o corpo REAL.)

- [ ] **Step 4: `Secao` (campos.tsx) com id/número/selo/chip**

(a) Trocar `import { useState } from "react";` por:

```ts
import { useRef, useState } from "react";
import { usePedidoAbertura } from "@/components/planejamento/planejamento-detail/secoes-abertas";
```

(b) Substituir a função inteira:

```tsx
export function Secao({ titulo, children, defaultOpen = true }: { titulo: string; children: React.ReactNode; defaultOpen?: boolean }) {
  // Sheet abre com as seções RECOLHIDAS por padrão (exceto "Informações Gerais do Produto",
  // que passa defaultOpen); reduz o scroll inicial. O usuário expande o que precisa.
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="space-y-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-1.5 text-sm font-semibold text-foreground border-b pb-1.5 text-left"
      >
        {open ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
        <span>{titulo}</span>
      </button>
      {open && children}
    </section>
  );
}
```

por:

```tsx
export function Secao({ id, titulo, numero, selo, chip, children, defaultOpen = true }: {
  /** F3.3 — chave da seção (`data-secao` + abertura por pedido — links "Para enviar, falta…"). */
  id?: string;
  titulo: string;
  /** F3.3 — numeração dinâmica "N." (selos-secoes.ts `numerarSecoes`). */
  numero?: number;
  /** F3.3 — selo de completude à direita (IRMÃO do botão: o "i" do selo é um <button>). */
  selo?: React.ReactNode;
  /** F3.3 — chip "do Desenvolvimento" (mockup) nas seções vindas do Dev. */
  chip?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  // Sheet abre com as seções RECOLHIDAS por padrão (exceto "Informações Gerais do Produto",
  // que passa defaultOpen); reduz o scroll inicial. O usuário expande o que precisa.
  const [open, setOpen] = useState(defaultOpen);
  const ref = useRef<HTMLElement>(null);
  usePedidoAbertura(id, () => setOpen(true), ref);
  return (
    <section ref={ref} className="space-y-3" data-secao={id}>
      <div className="flex items-center gap-2 border-b pb-1.5">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-sm font-semibold text-foreground"
        >
          {open ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
          <span className="truncate">{numero ? `${numero}. ` : ""}{titulo}</span>
          {chip && <span className="shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-normal text-muted-foreground max-sm:hidden">{chip}</span>}
        </button>
        {selo && <span className="ml-auto inline-flex shrink-0 items-center gap-1">{selo}</span>}
      </div>
      {open && children}
    </section>
  );
}
```

(Sem `id`/`numero`/`selo`/`chip` o visual é o de hoje: mesma borda e mesmo título — só a borda passou do botão para a linha.)

- [ ] **Step 5: `SecaoBom` com número e abertura por pedido**

(a) Trocar `import { useState, type ReactNode } from "react";` por:

```ts
import { useRef, useState, type ReactNode } from "react";
import { usePedidoAbertura } from "@/components/planejamento/planejamento-detail/secoes-abertas";
```

(b) Trocar a assinatura `export function SecaoBom({ id, titulo, selo, origemDev = true, defaultOpen = false, open: openProp, onOpenChange, children }: {` por:

```tsx
export function SecaoBom({ id, titulo, numero, selo, origemDev = true, defaultOpen = false, open: openProp, onOpenChange, children }: {
```

e, depois da linha `  titulo: string;` (a do tipo das props), inserir:

```tsx
  /** F3.3 — numeração dinâmica "N." (selos-secoes.ts `numerarSecoes`). */
  numero?: number;
```

(c) Depois do bloco `const alternar = () => { … };`, inserir:

```tsx
  // F3.3 — link "Para enviar, falta…" pede esta seção: abre e rola até ela.
  const ref = useRef<HTMLElement>(null);
  usePedidoAbertura(id, () => {
    if (openProp === undefined) setOpenLocal(true);
    onOpenChange?.(true);
  }, ref);
```

(d) Trocar `    <section className="space-y-3" data-secao={id}>` por `    <section ref={ref} className="space-y-3" data-secao={id}>` e `          <span className="truncate">{titulo}</span>` por:

```tsx
          <span className="truncate">{numero ? `${numero}. ` : ""}{titulo}</span>
```

- [ ] **Step 6: `BomSecoes` — seção CAD, avisos da F3.1, sem "Abrir no Desenvolvimento"**

(a) Trocar o comentário de cabeçalho (as 5 primeiras linhas do arquivo: de `// F3.2 — seções 5-8 do Sheet unificado` até a linha que termina em `portado do Dev (:3221-3237).`) por:

```ts
// F3.2/F3.3 — seções vindas do Desenvolvimento no Sheet unificado (Tecidos/Forros/Entretelas · Aviamentos · Insumos ·
// Grade · CAD), na ordem do mockup aprovado. Reusa os componentes só-props do Dev SEM modificá-los (Tecidos = cópia local
// TecidosBomSecao, decisão F3 #10; CAD = CadTecidosSection da Produção). Somente-leitura pela trava ÚNICA (R2): sem
// permissão ou enviado à Explosão (F3.1 — o "Editar" destrava BOM e CAD). Avisos = os da F3.1 (`AvisoCamposDev`).
// "Apagar grade preenchida?" portado do Dev (:3221-3237).
```

(b) Imports: trocar `import { AlertTriangle, Check, ExternalLink, Info, Loader2 } from "lucide-react";` por `import { AlertTriangle, Info, Loader2 } from "lucide-react";`; APAGAR as linhas `import { Button } from "@/components/ui/button";`, `import { StatusBadge, type StatusTone } from "@/components/shared/StatusBadge";`, `import { CondicaoInfo } from "@/components/shared/CondicaoInfo";` e `import type { SeloSecao } from "../selos-bom";`; depois de `import { ModeloGradeSection } from "@/components/desenvolvimento/modelo-detail/ModeloGradeSection";` inserir `import { CadTecidosSection } from "@/components/producao/cad/CadTecidosSection";`; depois de `import { SecaoBom } from "./SecaoBom";` inserir `import { SeloBadge } from "./SeloBadge";`.

(c) APAGAR o `const TOM …` e a função `SeloBadge` locais (foram para `SeloBadge.tsx`).

(d) Substituir do comentário `// Avisos da trava ÚNICA (R2 do G-plano conjunto), alinhados aos da F3.1 …` até o `}` que fecha `function AvisoSomenteLeitura(…) { … }` (o `TEXTO_AVISO_BOM` e o `AvisoSomenteLeitura` inteiros) por:

```tsx
// Avisos da trava ÚNICA (R2), IGUAIS aos da F3.1 (`AvisoCamposDev`): sem a trava interina "tem CAD", o "Editar" destrava
// BOM e CAD como os demais campos do Dev (F3.3) — "enviado" usa a MESMA frase.
function AvisoSomenteLeitura({ motivo }: { motivo: FichaTecnica["motivoSomenteLeitura"] }) {
  if (motivo === "permissao") return <AvisoCamposDev motivo="sem_permissao" />;
  if (motivo === "enviado") return <AvisoCamposDev motivo="enviado" />;
  return null;
}

// Ficha ainda não carregada; se a query do CAD falhou, diz (a carga espera o CAD — Task 4 — e não pode ficar muda).
function Carregando({ erro }: { erro: boolean }) {
  return erro ? (
    <p className="flex items-center gap-1.5 py-2 text-xs text-destructive">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />Não foi possível carregar o CAD — recarregue o card.
    </p>
  ) : (
    <p className="flex items-center gap-2 py-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Carregando…</p>
  );
}
```

(e) Trocar `export function BomSecoes({ ficha, modeloId, estoque, ordemEnviada, proporcoes, onAbrirDev }: {` por `export function BomSecoes({ ficha, modeloId, estoque, ordemEnviada, proporcoes }: {` e APAGAR, no tipo das props, a linha `  onAbrirDev?: () => void;` (logo depois de `  proporcoes: Record<string, number>;`).

(f) Substituir o `corpo`:

```tsx
  const corpo = (node: ReactNode) => (carregando ? (
    <p className="flex items-center gap-2 py-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Carregando…</p>
  ) : (
    <>
      <AvisoSomenteLeitura motivo={ficha.motivoSomenteLeitura} cadErro={dados.cadErro} onAbrirDev={onAbrirDev} />
      <fieldset disabled={!ficha.podeEditar} className="contents">{node}</fieldset>
    </>
  ));
```

por:

```tsx
  const corpo = (node: ReactNode) => (carregando ? <Carregando erro={dados.cadErro} /> : (
    <>
      <AvisoSomenteLeitura motivo={ficha.motivoSomenteLeitura} />
      <fieldset disabled={!ficha.podeEditar} className="contents">{node}</fieldset>
    </>
  ));
```

(g) Antes de `      <AlertDialog open={!!ficha.confirmGrade} onOpenChange={(o) => { if (!o) ficha.setConfirmGrade(null); }}>`, inserir a seção CAD:

```tsx
      {/* F3.3 — seção CAD (Dev :2881-2912): o MESMO `CadTecidosSection` (reusado SEM modificar — decisão 8), sem a coluna
          "a Separar/Enviar" (é da Explosão). Grava no MESMO Salvar do BOM (decisão F3 #7). Antes da Ordem de Criação e
          sem CAD fica só-leitura (D2 — o Planejamento não cria o CAD antes da Ordem). */}
      <SecaoBom id="cad" titulo="CAD" selo={<SeloBadge selo={ficha.seloCad} />}>
        {corpo(
          ficha.cad.linhas.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">Nenhum tecido/variante planejado neste modelo. Adicione tecidos na seção Tecidos / Forros / Entretelas.</p>
          ) : (
            <>
              {ficha.cadAntesDaOrdem && (
                <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  O CAD é criado depois da Ordem de Criação — até lá esta seção só mostra o que os tecidos vão levar.
                </p>
              )}
              <CadTecidosSection
                tecidos={ficha.cad.linhas}
                updateTec={ficha.cad.handlers.updateTec}
                updateVar={ficha.cad.handlers.updateVar}
                autoFolhas={ficha.cad.autoFolhas}
                onToggleAutoFolhas={ficha.cad.handlers.setAutoFolhas}
                readOnly={!ficha.cadGravavel}
                hideSeparar
              />
            </>
          ),
        )}
      </SecaoBom>

```

- [ ] **Step 7: `useFichaTecnica` — o tipo perde "cad"**

Substituir:

```ts
/**
 * Por que o BOM está só-leitura. Trava ÚNICA (R2): "permissao" e "enviado" vêm da trava da F3.1 (`motivoTravaDev`, com o
 * "Editar" já considerado); "cad" = trava INTERINA da F3.2 (a F3.3 tira: grava o CAD no Salvar e o "Editar" passa a
 * destravar o BOM também).
 */
export type MotivoSomenteLeitura = "permissao" | "enviado" | "carregando" | "cad" | null;
```

por:

```ts
/**
 * Por que a ficha (BOM + CAD) está só-leitura. Trava ÚNICA (R2): "permissao" e "enviado" vêm da trava da F3.1
 * (`motivoTravaDev`, com o "Editar" já considerado). A trava interina "cad" da F3.2 saiu na F3.3 (o Salvar grava o CAD —
 * plano F3.3 §3).
 */
export type MotivoSomenteLeitura = "permissao" | "enviado" | "carregando" | null;
```

- [ ] **Step 8: `PlanejamentoDetail` — sai o atalho do `BomSecoes`**

Na chamada `<BomSecoes …>`, APAGAR a linha `              onAbrirDev={() => setVerDevModeloId(modeloId)}` (o `verDevModeloId` restante sai na Task 9).

- [ ] **Step 9: Gates + commit**

```bash
D=src/components/planejamento/planejamento-detail
grep -rn "onAbrirDev\|TEXTO_AVISO_BOM\|Abrir no Desenvolvimento" src/components/planejamento   # vazio
grep -cF "<CadTecidosSection" $D/ficha/secoes/BomSecoes.tsx                                       # 1
git diff --stat "$(cat .superpowers/f33/BASE)" -- src/components/producao/cad/CadTecidosSection.tsx   # vazio
bash .superpowers/f33/gates.sh
F="$D/ficha/secoes/SeloBadge.tsx $D/secoes-abertas.tsx $D/campos.tsx $D/ficha/secoes/SecaoBom.tsx $D/ficha/secoes/BomSecoes.tsx $D/ficha/useFichaTecnica.ts src/components/planejamento/PlanejamentoDetail.tsx tests/unit/planejamento-secoes-abertas.test.ts"
git add -- $F
git commit --only -m "feat(planejamento): F3.3 (7) — seção CAD no Sheet (CadTecidosSection reusado), avisos iguais aos da F3.1, Secao com número/selo/chip e abertura por pedido

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- $F
```

---

## Task 8: Numeração "N." e selos em TODAS as seções (adiados da F3.1)  *(Lote B)*

**Files:**
- Create: `src/components/planejamento/planejamento-detail/SelosAuxiliares.tsx`
- Modify: `src/components/planejamento/planejamento-detail/InfoGeraisSecao.tsx`, `src/components/planejamento/planejamento-detail/RevendaSetores.tsx` (`numero`/`selo` repassados à `Secao`)
- Modify: `src/components/planejamento/planejamento-detail/ficha/secoes/BomSecoes.tsx` (`numeros`)
- Modify: `src/components/planejamento/PlanejamentoDetail.tsx` (mapa `vis`, `numeros`, `selos`; cada seção recebe `id`/`numero`/`selo`/`chip`)

**Interfaces:**
- Consumes: Task 3 (`numerarSecoes`, `selosSecoesSheet`, `resumoColecao`, `seloProva`, `seloObservacoes`, `seloRelacionado`, `SecaoSheetKey`); `requisitosUniao` (F3.2); Task 7 (`Secao`, `SecaoBom`, `SeloBadge`); `useProvaAbertosCount` (`ModeloAjustesProvaSection.tsx:149`, só importar); `ficha.dados.condicoesProntas` (Task 4).
- Produces: `SeloProvaBadge`, `SeloObservacoesBadge`, `SeloRelacionadoBadge` (`{ modeloId: string }`); `InfoGeraisSecao({…, numero?, selo?})`; `ProdutoAcabadoSecao({…, numero?})`; `GradeRevendaSecao({…, numero?})`; `BomSecoes({…, numeros?})`; no orquestrador, `vis: Record<SecaoSheetKey, boolean>` é a fonte ÚNICA de "a seção aparece?" (o JSX passa a usar esses booleanos — a numeração nunca descola da tela).

- [ ] **Step 1: `SelosAuxiliares.tsx`**

```tsx
// F3.3 — selos das seções cujo dado mora num componente do Dev reusado SEM modificar (decisão 8): Ajustes na Prova,
// Observações e Produto Relacionado. MESMAS queryKeys e MESMO queryFn dos componentes (cache compartilhado com a MESMA
// forma — a regra "queryKey única por tela" do CLAUDE.md é contra forma diferente na mesma key).
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useProvaAbertosCount } from "@/components/desenvolvimento/modelo-detail/ModeloAjustesProvaSection";
import { SeloBadge } from "@/components/planejamento/planejamento-detail/ficha/secoes/SeloBadge";
import { seloObservacoes, seloProva, seloRelacionado } from "@/components/planejamento/planejamento-detail/ficha/selos-secoes";

/** Ajustes na Prova (Dev :2836-2838) — nº de comentários abertos. */
export function SeloProvaBadge({ modeloId }: { modeloId: string }) {
  return <SeloBadge selo={seloProva(useProvaAbertosCount(modeloId))} />;
}

/** Observações — `ModeloObservacoes.tsx:52-65` (key + select + ordem idênticos). */
export function SeloObservacoesBadge({ modeloId }: { modeloId: string }) {
  const { data = [] } = useQuery({
    queryKey: ["modelo-observacoes", modeloId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modelo_observacoes" as any)
        .select("id, ordem, descricao, observacao")
        .eq("modelo_id", modeloId)
        .order("ordem")
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as unknown[];
    },
  });
  return <SeloBadge selo={seloObservacoes(data.length)} />;
}

/** Produto Relacionado — `ProdutoRelacionadoSetor.tsx:37-43` (key + select idênticos). */
export function SeloRelacionadoBadge({ modeloId }: { modeloId: string }) {
  const { data: conjuntoId = null } = useQuery({
    queryKey: ["modelo-conjunto", modeloId],
    queryFn: async () => {
      const { data, error } = await (supabase.from("modelos") as any).select("conjunto_id").eq("id", modeloId).maybeSingle();
      if (error) throw error;
      return ((data as { conjunto_id?: string | null } | null)?.conjunto_id) ?? null;
    },
  });
  return <SeloBadge selo={seloRelacionado(!!conjuntoId)} />;
}
```

Conferir que os 2 `queryFn` batem com os componentes do BASE: `sed -n 52,66p src/components/shared/ModeloObservacoes.tsx` e `sed -n 37,44p src/components/planejamento/ProdutoRelacionadoSetor.tsx` — se divergirem, copiar o texto REAL (mesma key ⇒ mesma forma).

- [ ] **Step 2: `InfoGeraisSecao` e `RevendaSetores` repassam número/selo**

(a) `InfoGeraisSecao.tsx`: trocar `  draft, setDraftTracked, grupoSel, setGrupoSel, grupos, categorias, estilistas, sub1Opts, sub2Opts, fl,` por `  draft, setDraftTracked, grupoSel, setGrupoSel, grupos, categorias, estilistas, sub1Opts, sub2Opts, fl, numero, selo,`; depois de `  fl: ReturnType<typeof useFieldLabels>;` inserir:

```ts
  /** F3.3 — numeração e selo da seção (orquestrador). */
  numero?: number;
  selo?: React.ReactNode;
```

e trocar `          <Secao titulo="Informações Gerais do Produto">` por `          <Secao id="info" titulo="Informações Gerais do Produto" numero={numero} selo={selo}>`.

(b) `RevendaSetores.tsx`: trocar `export function ProdutoAcabadoSecao({ rv, contexto, modeloId, navigate }: {` por `export function ProdutoAcabadoSecao({ rv, contexto, modeloId, navigate, numero }: {`; na linha seguinte (`  rv: RevendaPlanejamento; contexto: "planejamento" | "produto-acabado"; modeloId: string | null;`) acrescentar ao fim ` numero?: number;`; trocar `            <Secao titulo="Produto Acabado" defaultOpen={false}>` por `            <Secao id="produto_acabado" titulo="Produto Acabado" numero={numero} defaultOpen={false}>`. Trocar `export function GradeRevendaSecao({ rv }: { rv: RevendaPlanejamento }) {` por `export function GradeRevendaSecao({ rv, numero }: { rv: RevendaPlanejamento; numero?: number }) {` e `            <Secao titulo="Grade" defaultOpen={false}>` por `            <Secao id="grade_revenda" titulo="Grade" numero={numero} defaultOpen={false}>`.

- [ ] **Step 3: `BomSecoes` numera as 5 seções**

(a) Depois de `import { SeloBadge } from "./SeloBadge";`, inserir `import type { SecaoSheetKey } from "../selos-secoes";`.

(b) Trocar `export function BomSecoes({ ficha, modeloId, estoque, ordemEnviada, proporcoes }: {` por `export function BomSecoes({ ficha, modeloId, estoque, ordemEnviada, proporcoes, numeros }: {` e, depois de `  proporcoes: Record<string, number>;` (tipo das props), inserir:

```ts
  /** F3.3 — numeração dinâmica do Sheet (selos-secoes.ts `numerarSecoes`). */
  numeros?: Partial<Record<SecaoSheetKey, number>>;
```

(c) Nas 5 `<SecaoBom id="…"`, acrescentar o número logo depois do `titulo`:
- `titulo="Tecidos / Forros / Entretelas"` → `titulo="Tecidos / Forros / Entretelas" numero={numeros?.tecidos}`
- `titulo="Aviamentos"` → `titulo="Aviamentos" numero={numeros?.aviamentos}`
- `titulo="Insumos"` → `titulo="Insumos" numero={numeros?.insumos}`
- `titulo="Grade"` → `titulo="Grade" numero={numeros?.grade}`
- `titulo="CAD"` → `titulo="CAD" numero={numeros?.cad}`

- [ ] **Step 4: `PlanejamentoDetail` — `vis`, `numeros`, `selos`**

(a) Depois de `import { useFichaKanban } from "@/components/planejamento/planejamento-detail/ficha/useFichaKanban";`, inserir:

```ts
import { numerarSecoes, resumoColecao, selosSecoesSheet, type SecaoSheetKey } from "@/components/planejamento/planejamento-detail/ficha/selos-secoes";
import { requisitosUniao } from "@/components/planejamento/planejamento-detail/ficha/selos-bom";
import { SeloBadge } from "@/components/planejamento/planejamento-detail/ficha/secoes/SeloBadge";
import { SeloObservacoesBadge, SeloProvaBadge, SeloRelacionadoBadge } from "@/components/planejamento/planejamento-detail/SelosAuxiliares";
```

(b) Antes de `  // Conteúdo interno idêntico p/ os dois containers (header / corpo rolável / rodapé`, inserir:

```tsx
  // ── F3.3 — numeração "N." e selos de TODAS as seções (adiados da F3.1 — plano F3.1 §7 T2) ─────────────────────────
  // `vis` é a fonte ÚNICA de "a seção aparece?": o JSX abaixo usa ESTES booleanos, então a numeração nunca descola do
  // que está na tela. Ordem/numeração: selos-secoes.ts (mockup gen_main.py:31-106; Dialog "Novo Modelo": gen_novo.py).
  const fichaVisivel = isEdit && !!modeloId && ficha.habilitada;
  const vis: Record<SecaoSheetKey, boolean> = {
    info: true,
    colecao: true,
    desenvolvimento: isEdit && podeVerDev,
    prova: isEdit && !!modeloId && podeVerDev && campoVisivelDev("prova"),
    tecidos: fichaVisivel, aviamentos: fichaVisivel, insumos: fichaVisivel, grade: fichaVisivel, cad: fichaVisivel,
    tecidos_novo: !isEdit && !isComprado,
    preco: isEdit,
    mao_obra: (!isComprado ? true : isEdit) && (podeVerCustos || (isEdit && podeAprovarMaoObra)),
    produto_acabado: isEdit && isRevenda && paOn,
    grade_revenda: isEdit && isRevenda && paOn && !!produtoRevenda,
    anexos: true,
    observacoes: isEdit && !!modeloId && podeVerDev,
    lancamento: isEdit,
    relacionado: isEdit && !!modeloId,
  };
  // R7 do G-plano F3.3 — segue o mockup: no Dialog "Novo Modelo" só "1. Informações" e "2. Coleção" (gen_novo.py:13-20).
  const numeros = numerarSecoes(new Set((Object.keys(vis) as SecaoSheetKey[]).filter((k) => vis[k])), { dialogNovo: !isEdit });
  const selos = selosSecoesSheet({
    requeridas: requisitosUniao(isComprado ? kanbanCard.revendaCfg.requisitos : kanbanCard.kanbanCfg.kanban_requisitos),
    satisfeitas: ficha.habilitada && ficha.dados.condicoesProntas ? ficha.dados.condicoes : null,
    podeVerCustos,
    infoCompleta: !!draft.nome.trim() && !!draft.estilista_id && !!draft.categoria_principal_id,
    colecaoResumo: resumoColecao({
      colecao: draft.colecao || null,
      subcolecao: draft.subcolecao || null,
      linha: linhas.find((l) => l.id === draft.linha_id)?.nome ?? null,
      semana: draft.semana || null,
      mes: meses.find((m) => m.id === draft.mes_id)?.nome ?? null,
      ano: anos.find((x) => x.id === draft.ano_id)?.nome ?? null,
    }),
    desenvolvimentoCompleto: !!draft.modelista_id && !!draft.piloteiro1_id && !!draft.data_piloto1 && !!draft.data_desenho_tecnico,
    preco: isRevenda ? null : { efetivo: precoEfetivo, markup: markupReal },
    maoObra: { estado: moEstadoLocal, total: maoObraDevLive },
    anexos: { fotoModelo: draft.fotos_modelo.length > 0, desenho: !!draft.desenho_tecnico_url, croqui: !!draft.croqui_url },
    lancamento: { lancado, data: draft.data_lancamento },
  });
  const seloDe = (k: SecaoSheetKey) => {
    const s = selos[k];
    return s ? <SeloBadge selo={s} /> : undefined;
  };
```

(c) Seções (cada troca é do texto EXATO, na ordem do arquivo):

1. `          <InfoGeraisSecao` → `          <InfoGeraisSecao numero={numeros.info} selo={seloDe("info")}`
2. `          <Secao titulo="Coleção" defaultOpen={false}>` → `          <Secao id="colecao" titulo="Coleção" numero={numeros.colecao} selo={seloDe("colecao")} defaultOpen={false}>`
3. As 2 linhas

```tsx
          {isEdit && podeVerDev && (
            <Secao titulo="Desenvolvimento — equipe e cronograma" defaultOpen={false}>
```

→

```tsx
          {vis.desenvolvimento && (
            <Secao id="desenvolvimento" titulo="Desenvolvimento — equipe e cronograma" numero={numeros.desenvolvimento} selo={seloDe("desenvolvimento")} chip="do Desenvolvimento" defaultOpen={false}>
```

4. As 2 linhas

```tsx
          {isEdit && modeloId && podeVerDev && campoVisivelDev("prova") && (
            <Secao titulo="Ajustes na Prova" defaultOpen={false}>
```

→

```tsx
          {vis.prova && modeloId && (
            <Secao id="prova" titulo="Ajustes na Prova" numero={numeros.prova} selo={<SeloProvaBadge modeloId={modeloId} />} chip="do Desenvolvimento" defaultOpen={false}>
```

5. As 2 linhas `          {isEdit && modeloId && (` + `            <BomSecoes` (a chamada do BOM) → `          {vis.tecidos && modeloId && (` + `            <BomSecoes`; e, dentro da chamada, trocar `              ficha={ficha}` por:

```tsx
              ficha={ficha}
              numeros={numeros}
```

6. As 2 linhas

```tsx
          {!isEdit && !isComprado && (
          <Secao titulo="Tecidos" defaultOpen>
```

→

```tsx
          {vis.tecidos_novo && (
          <Secao id="tecidos_novo" titulo="Tecidos" numero={numeros.tecidos_novo} defaultOpen>
```

7. As 2 linhas `          {isEdit && (` + `          <Secao titulo="Preço e Custos" defaultOpen={false}>` →

```tsx
          {vis.preco && (
          <Secao id="preco" titulo="Preço e Custos" numero={numeros.preco} selo={seloDe("preco")} defaultOpen={false}>
```

8. As 2 linhas

```tsx
          {(!isComprado ? true : isEdit) && (podeVerCustos || (isEdit && podeAprovarMaoObra)) && (
            <Secao titulo="Mão de obra" defaultOpen={false}>
```

→

```tsx
          {vis.mao_obra && (
            <Secao id="mao_obra" titulo="Mão de obra" numero={numeros.mao_obra} selo={seloDe("mao_obra")} defaultOpen={false}>
```

9. As 2 linhas

```tsx
          {isEdit && isRevenda && paOn && (
            <ProdutoAcabadoSecao rv={revenda} contexto={contexto} modeloId={modeloId} navigate={navigate} />
```

→

```tsx
          {vis.produto_acabado && (
            <ProdutoAcabadoSecao rv={revenda} contexto={contexto} modeloId={modeloId} navigate={navigate} numero={numeros.produto_acabado} />
```

10. As 2 linhas

```tsx
          {isEdit && isRevenda && paOn && produtoRevenda && (
            <GradeRevendaSecao rv={revenda} />
```

→

```tsx
          {vis.grade_revenda && (
            <GradeRevendaSecao rv={revenda} numero={numeros.grade_revenda} />
```

11. `          <Secao titulo="Anexos" defaultOpen={false}>` → `          <Secao id="anexos" titulo="Anexos" numero={numeros.anexos} selo={seloDe("anexos")} defaultOpen={false}>`
12. As 2 linhas

```tsx
          {isEdit && modeloId && podeVerDev && (
            <Secao titulo="Observações" defaultOpen={false}>
```

→

```tsx
          {vis.observacoes && modeloId && (
            <Secao id="observacoes" titulo="Observações" numero={numeros.observacoes} selo={<SeloObservacoesBadge modeloId={modeloId} />} chip="do Desenvolvimento" defaultOpen={false}>
```

13. As 2 linhas `          {isEdit && (` + `            <Secao titulo="Lançamento" defaultOpen={false}>` →

```tsx
          {vis.lancamento && (
            <Secao id="lancamento" titulo="Lançamento" numero={numeros.lancamento} selo={seloDe("lancamento")} defaultOpen={false}>
```

14. As 2 linhas `          {isEdit && modeloId && (` + `            <Secao titulo="Produto Relacionado" defaultOpen={false}>` →

```tsx
          {vis.relacionado && modeloId && (
            <Secao id="relacionado" titulo="Produto Relacionado" numero={numeros.relacionado} selo={<SeloRelacionadoBadge modeloId={modeloId} />} defaultOpen={false}>
```

- [ ] **Step 5: Conferência + gates + commit**

```bash
P=src/components/planejamento/PlanejamentoDetail.tsx
grep -cF "numero={numeros." $P                  # 13 (Info, Coleção, Desenvolvimento, Prova, Tecidos-Dialog, Preço, MO, PA, Grade revenda, Anexos, Observações, Lançamento, Relacionado — no Dialog só Info/Coleção recebem número ≠ undefined: R7)
grep -cF "{ dialogNovo: !isEdit }" $P            # 1 (R7)
grep -cF "numeros={numeros}" $P                  # 1 (BomSecoes: Tecidos, Aviamentos, Insumos, Grade, CAD)
grep -nF "<Secao titulo=" $P src/components/planejamento/planejamento-detail/InfoGeraisSecao.tsx src/components/planejamento/planejamento-detail/RevendaSetores.tsx   # vazio (toda Secao tem id)
bash .superpowers/f33/gates.sh
D=src/components/planejamento/planejamento-detail
F="$D/SelosAuxiliares.tsx $D/InfoGeraisSecao.tsx $D/RevendaSetores.tsx $D/ficha/secoes/BomSecoes.tsx $P"
git add -- $F
git commit --only -m "feat(planejamento): F3.3 (8) — numeração dinâmica e selos de completude em todas as seções do Sheet (mapa próprio; catálogo intocado)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- $F
```

**Revisão do Lote B (Tasks 7+8):** o `CadTecidosSection` é o da Produção sem mudança (props só-leitura/`hideSeparar`); avisos = os da F3.1; nenhum "Abrir no Desenvolvimento"; `Secao` sem props novas = visual de hoje; números 1..N contínuos no Sheet (interno e revenda com a chave); no Dialog "Novo Modelo" só "1. Informações Gerais do Produto" e "2. Coleção", Tecidos/Mão de obra/Anexos sem número (mockup gen_novo.py — T17, R7); os JSX de cada seção usam `vis.*` (nenhuma condição duplicada); selo com R$ (Preço, MO) só com `podeVerCustos` (invariante #12); selos por requisito só com `condicoesProntas`; `SelosAuxiliares` com key+queryFn idênticos aos componentes; 360px: título trunca, selo não quebra a linha, chip some no mobile.

---

## Task 9: Enviar à Explosão, rodapé do mockup, menu ⋯, Ficha Técnica; sai o "Ver no Desenvolvimento"  *(individual Opus)*

**Files:**
- Modify: `src/components/planejamento/planejamento-detail/ficha/useFichaKanban.ts` (`explosaoEnvioStatus`)
- Modify: `src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts` (`salvarAntes`)
- Create: `src/components/planejamento/planejamento-detail/useEnviarExplosao.ts`
- Create: `src/components/planejamento/planejamento-detail/MenuMaisAcoes.tsx`
- Modify: `src/components/planejamento/planejamento-detail/PrecoTabela.tsx` (sai `onVerDev`)
- Modify: `src/components/planejamento/PlanejamentoDetail.tsx`

**Interfaces:**
- Consumes: Task 2 (`gateEnvioExplosao`, `pendenciasEnvioExplosao`); Task 7 (`PedidoSecaoContext`, `proximoPedido`, `PedidoSecao`); `PrintFicha({ modeloId, kind: "tecnica", token })` (`producao/PrintFicha.tsx:16-24`, só importar — dispara a impressão quando `token` muda e os dados estão prontos).
- Produces: `FichaKanban.explosaoEnvioStatus: string | null`; `usePlanejamentoSave(...)` devolve também `salvarAntes: () => Promise<void>`; `useEnviarExplosao({ modeloId, qc, salvarAntes, draftLiveRef, onEnviado })` (mutation); `MenuMaisAcoes({ className?, onDuplicar, duplicando, onImportar?, onFichaTecnica?, onCancelarOrdem?, cancelandoOrdem? })`.

- [ ] **Step 1: `useFichaKanban` expõe a etapa de envio da loja**

(a) Depois de `  refExibirStatus: string | null;` (tipo `FichaKanban`), inserir:

```ts
  /** F3.3 — `tenant_config.explosao_envio_status` (etapa a partir da qual se envia à Explosão; ausente ⇒ "aprovado"). */
  explosaoEnvioStatus: string | null;
```

(b) Depois de `  const refExibirStatus = (cfgRow?.ref_exibir_status as string | null | undefined) ?? null;`, inserir:

```ts
  const explosaoEnvioStatus = (cfgRow?.explosao_envio_status as string | null | undefined) ?? null;
```

(c) Trocar `    kanbanCfg, revendaCfg, refExibirStatus, cond, cfgPronta, condProntas, modeloKanban, statusSalvo, statusEfetivo, derivacao,` por:

```ts
    kanbanCfg, revendaCfg, refExibirStatus, explosaoEnvioStatus, cond, cfgPronta, condProntas, modeloKanban, statusSalvo, statusEfetivo, derivacao,
```

- [ ] **Step 2: `usePlanejamentoSave` — Salvar "por dentro" do envio**

Substituir `  return { save, handleSave };` por:

```ts
  /**
   * F3.3 — Salvar "por dentro" do Enviar à Explosão (Dev :2404-2405 `persistModelo()`): mesma guarda anti-duplo-clique do
   * `handleSave`. Rejeita (marcando `salvarFalhou`) se já há Salvar em voo ou se o Salvar falhar; no P0409 o retry
   * automático segue sozinho (onError) e quem chamou aborta.
   */
  const salvarAntes = async (): Promise<void> => {
    if (savingRef.current || save.isPending) throw new Error("Aguarde o salvamento em andamento terminar.");
    savingRef.current = true;
    try {
      await save.mutateAsync(undefined);
    } catch (e) {
      if (e && typeof e === "object") (e as any).salvarFalhou = true;
      throw e;
    } finally {
      // No P0409 o onError já disparou o retry, que segura `savingRef` até o fim dele.
      if (!retryRef.current) savingRef.current = false;
    }
  };

  return { save, handleSave, salvarAntes };
```

- [ ] **Step 3: `useEnviarExplosao.ts`**

```ts
// F3.3 — "Enviar à Explosão" no Sheet do Planejamento. PORTA de ModeloDetailPanel.tsx:2402-2433 (`enviarCad`): salva o
// card (BOM + CAD — Tasks 5/6) e chama `enviar_modelo_para_cad` (com CAD já existente é idempotente: grava Obs. Técnicas/
// Ficha de Medida e `enviado_cad`; o gate de etapa do SERVIDOR usa a posição DERIVADA com a chave ligada — F1
// 20260930140000:842). Pós-envio: a trava da F3.1 (lê `enviado_cad`) fecha as seções do Dev, "Enviar" some, "Editar"
// aparece.
import type { RefObject } from "react";
import { useMutation, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { mensagemErro } from "@/lib/erro-mensagem";
import type { Draft } from "@/components/planejamento/modelo-shared";

export function useEnviarExplosao({ modeloId, qc, salvarAntes, draftLiveRef, onEnviado }: {
  modeloId: string | null;
  qc: QueryClient;
  salvarAntes: () => Promise<void>;
  draftLiveRef: RefObject<Draft>;
  onEnviado: () => void;
}) {
  return useMutation({
    mutationFn: async () => {
      if (!modeloId) throw new Error("Salve o modelo primeiro.");
      // Salva o card antes de enviar (consumos/variantes/CAD corretos) — Dev :2404-2405.
      await salvarAntes();
      const d = draftLiveRef.current;
      const { error } = await supabase.rpc("enviar_modelo_para_cad" as any, {
        _modelo_id: modeloId,
        _observacoes_tecnicas: d.observacoes_tecnicas || null,
        _ficha_medida_url: d.ficha_medida_url || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Enviado para a Explosão");
      // Trava na hora, sem esperar o refetch: `enviado_cad` no cache com o MESMO rev (o merge do colab ignora rev igual);
      // o refetch abaixo/Realtime traz a linha real (rev novo) e o merge segue normal.
      qc.setQueryData(["modelo", modeloId], (old: any) => (old ? { ...old, enviado_cad: true } : old));
      for (const k of ["modelo", "modelo-detail", "modelo-condicoes-kanban", "modelo-cad-calc", "explosao-cad-row", "plan-kanban-cond", "plan-ficha-condicoes", "plan-ficha-cad", "plan-cq"]) {
        qc.invalidateQueries({ queryKey: [k, modeloId] });
      }
      qc.invalidateQueries({ predicate: (q) => typeof q.queryKey?.[0] === "string" && (q.queryKey[0] as string).startsWith("ft-") });
      qc.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && (q.queryKey[0] === "explosao-cad-tecidos" || q.queryKey[0] === "explosao-cad-grades") });
      for (const k of ["producao-explosao-list", "modelos-desenvolvimento", "modelos-planejamento"]) qc.invalidateQueries({ queryKey: [k] });
      onEnviado();
    },
    onError: (e: any) => {
      if (e?.salvarFalhou) {
        // O Salvar já avisou (toast próprio) ou, no P0409, está refazendo sozinho: o envio só aborta.
        if (e?.code === "P0409") toast.info("Outra pessoa salvou este card agora — confira e clique em Enviar à Explosão de novo.");
        return;
      }
      toast.error(mensagemErro(e, "Erro ao enviar"));
    },
  });
}
```

- [ ] **Step 4: `MenuMaisAcoes.tsx`**

```tsx
// F3.3 — menu ⋯ do rodapé do Sheet do Planejamento (mockup gen_main.py:108-116; ui-padroes §L "ações de ciclo na tela
// + ⋯ no card"): Duplicar · Importar dados · Ficha Técnica ("após Enviar") · ── · Cancelar Ordem de Criação. Mesmo
// Popover do precedente ProdutoCard.tsx:505-560. Item sem handler: Importar/Cancelar somem; Ficha Técnica fica
// desabilitada com a dica.
import { Copy, Download, MoreHorizontal, Printer, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const ITEM = "flex w-full items-center gap-2 rounded-sm px-2 py-2.5 text-left text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40";

export function MenuMaisAcoes({ className, onDuplicar, duplicando, onImportar, onFichaTecnica, onCancelarOrdem, cancelandoOrdem }: {
  className?: string;
  onDuplicar: () => void;
  duplicando: boolean;
  /** Ausente = ficha não editável (o item some — Dev :2732-2736 só com o card editável). */
  onImportar?: () => void;
  /** Ausente = ainda não enviado à Explosão (item desabilitado — "após Enviar"). */
  onFichaTecnica?: () => void;
  /** Ausente = Ordem de Criação ainda não enviada (o item some). */
  onCancelarOrdem?: () => void;
  cancelandoOrdem?: boolean;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" aria-label="Mais ações" title="Mais ações" className={`shrink-0 max-sm:aspect-square max-sm:px-0 ${className ?? ""}`}>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" side="top" className="w-60 p-1">
        <PopoverClose asChild>
          <button type="button" className={ITEM} onClick={onDuplicar} disabled={duplicando}>
            <Copy className="h-4 w-4 shrink-0" /> Duplicar
          </button>
        </PopoverClose>
        {onImportar && (
          <PopoverClose asChild>
            <button type="button" className={ITEM} onClick={onImportar}>
              <Download className="h-4 w-4 shrink-0" /> Importar dados
            </button>
          </PopoverClose>
        )}
        <PopoverClose asChild>
          <button
            type="button"
            className={ITEM}
            onClick={onFichaTecnica}
            disabled={!onFichaTecnica}
            title={onFichaTecnica ? undefined : "Disponível após Enviar à Explosão"}
          >
            <Printer className="h-4 w-4 shrink-0" /> Ficha Técnica
            {!onFichaTecnica && <span className="ml-auto text-xs text-muted-foreground">após Enviar</span>}
          </button>
        </PopoverClose>
        {onCancelarOrdem && (
          <>
            <div className="my-1 border-t" />
            {/* NEUTRO como os demais itens — o mockup aprovado o pinta com `color: var(--fg)` (gen_main.py:115); ruling R7
                do G-plano F3.3: seguir o mockup (vermelho fica só no Excluir do rodapé). */}
            <PopoverClose asChild>
              <button type="button" className={ITEM} onClick={onCancelarOrdem} disabled={cancelandoOrdem}>
                <Undo2 className="h-4 w-4 shrink-0" /> Cancelar Ordem de Criação
              </button>
            </PopoverClose>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 5: `PrecoTabela` — sai o "ver no Desenvolvimento ⧉"**

Apagar a linha `  onVerDev?: () => void;` (tipo das props); trocar `markupFaixaOn, onVerDev } = props;` por `markupFaixaOn } = props;`; trocar `{onVerDev ? <button type="button" onClick={onVerDev} className="text-primary hover:underline">ver no Desenvolvimento ⧉</button> : "do BOM"}` por `do BOM`. Conferir: `grep -c "onVerDev" src/components/planejamento/planejamento-detail/PrecoTabela.tsx` = 0.

- [ ] **Step 6: `PlanejamentoDetail` — imports, estado e o envio**

(a) Trocar `import { Trash2, Copy, ArrowLeft, Save, Pencil } from "lucide-react";` por `import { Trash2, ArrowLeft, Save, Pencil, Send, Loader2 } from "lucide-react";` e APAGAR `import { ModeloDetailPanel } from "@/components/desenvolvimento/ModeloDetailPanel";`. Depois de `import { useFichaKanban } from "@/components/planejamento/planejamento-detail/ficha/useFichaKanban";`, inserir:

```ts
import { PrintFicha } from "@/components/producao/PrintFicha";
import { gateEnvioExplosao, pendenciasEnvioExplosao } from "@/components/planejamento/planejamento-detail/ficha/envio-explosao";
import { PedidoSecaoContext, proximoPedido, type PedidoSecao } from "@/components/planejamento/planejamento-detail/secoes-abertas";
import { MenuMaisAcoes } from "@/components/planejamento/planejamento-detail/MenuMaisAcoes";
import { useEnviarExplosao } from "@/components/planejamento/planejamento-detail/useEnviarExplosao";
```

(b) Substituir:

```ts
  // "Ver no Desenvolvimento" (setor Preço, §K) — abre o ModeloDetailPanel INLINE por cima
  // deste card (sem navegar), mesmo padrão sheet-sobre-sheet do ProdutoAcabadoSheet.
  const [verDevModeloId, setVerDevModeloId] = useState<string | null>(null);
```

por:

```ts
  // F3.3 — o "Ver no Desenvolvimento" SAIU (abria um 2º editor do mesmo BOM por cima do card; o Sheet já tem as seções do
  // Dev). Estado dos links "Para enviar, falta…", da impressão da Ficha Técnica e da confirmação do envio.
  const [pedidoSecao, setPedidoSecao] = useState<PedidoSecao>(null);
  const abrirSecao = (chave: string) => setPedidoSecao((p) => proximoPedido(p, chave));
  const [printTecnicaToken, setPrintTecnicaToken] = useState(0);
  const [confirmEnviarExplosao, setConfirmEnviarExplosao] = useState(false);
```

(c) Trocar `  const { save, handleSave } = usePlanejamentoSave({` por `  const { save, handleSave, salvarAntes } = usePlanejamentoSave({` e, logo DEPOIS do `  });` que fecha essa chamada (a linha anterior é `    qc, onSaved: aoSalvar, onCreated, ficha: ficha.save, resetDraftBaseline,`), inserir:

```ts
  // F3.3 — Enviar à Explosão (Dev :2402-2433): Salvar + `enviar_modelo_para_cad`; pós-envio re-trava e avisa a lista.
  const enviarExplosao = useEnviarExplosao({
    modeloId, qc, salvarAntes, draftLiveRef,
    onEnviado: () => { setEditandoDev(false); onSaved(); },
  });
```

(d) Antes de `  // Conteúdo interno idêntico p/ os dois containers (header / corpo rolável / rodapé` (depois do bloco da Task 8), inserir:

```tsx
  // ── F3.3 — Enviar à Explosão: gate pela ETAPA (posição DERIVADA com a chave ligada — decisão 10; Dev :1405-1413) +
  // "Para enviar, falta" (Dev :1576-1598). Só produto interno com a ficha (comprado = F3.4), Ordem enviada, não enviado.
  const gateEnvio = gateEnvioExplosao({
    cfg: kanbanCard.kanbanCfg, explosaoEnvioStatus: kanbanCard.explosaoEnvioStatus,
    statusCru: enviada ? kanbanCard.statusSalvo : null, derivacao: kanbanCard.derivacao, condProntas: kanbanCard.condProntas,
  });
  const mostraEnviarExplosao = fichaVisivel && enviada && !enviadoCad;
  const pendenciasEnvio = mostraEnviarExplosao && gateEnvio.ok
    ? pendenciasEnvioExplosao({ draft, blocks: ficha.estado.blocks, grades: ficha.estado.grades, rotuloRef: fl("ref") })
    : [];
  const mostraFaltas = pendenciasEnvio.length > 0;
  const motivoEnvioBloqueado: string | null = !mostraEnviarExplosao ? null
    : !ficha.carregado ? "Carregando a ficha…"
      : !podeEditarDev ? "Sem permissão para editar o Desenvolvimento."
        : gateEnvio.carregando ? "Conferindo a etapa do card…"
          : !gateEnvio.ok ? `Disponível a partir da etapa "${gateEnvio.reqLabel}".`
            : mostraFaltas ? "Preencha os itens pendentes para enviar."
              : null;
  const podeEnviarExplosaoAgora = mostraEnviarExplosao && motivoEnvioBloqueado === null && ficha.podeEditar
    && !enviarExplosao.isPending && !save.isPending;
```

- [ ] **Step 7: `PlanejamentoDetail` — provedor dos pedidos, rodapé, diálogo, impressão; sai o Sheet do Dev**

(a) Trocar as 2 linhas

```tsx
  const conteudo = (
    <>
```

por

```tsx
  const conteudo = (
    <PedidoSecaoContext.Provider value={pedidoSecao}>
```

e as 2 linhas

```tsx
        <ColabPresenceOverlay presentes={presentes} scopeRef={colabScopeRef} />
    </>
```

por

```tsx
        <ColabPresenceOverlay presentes={presentes} scopeRef={colabScopeRef} />
    </PedidoSecaoContext.Provider>
```

(b) Na chamada `<PrecoTabela …>`, APAGAR a linha `                onVerDev={modeloId ? () => setVerDevModeloId(modeloId) : undefined}`.

(c) No FIM do corpo rolável — trocar as 4 linhas

```tsx
              <ProdutoRelacionadoSetor modeloId={modeloId} />
            </Secao>
          )}
        </div>
```

por

```tsx
              <ProdutoRelacionadoSetor modeloId={modeloId} />
            </Secao>
          )}

          {/* F3.3 — "Para enviar, falta…" no MOBILE (Dev :3107-3119); no desktop fica no rodapé. */}
          {mostraFaltas && (
            <p className="sm:hidden text-xs text-amber-700 dark:text-amber-300">
              Para enviar, falta:{" "}
              {pendenciasEnvio.map((p, i) => (
                <span key={p.label}>
                  {i > 0 && " · "}
                  <button type="button" className="font-medium underline underline-offset-2" onClick={() => abrirSecao(p.secao)}>{p.label}</button>
                </span>
              ))}
            </p>
          )}
        </div>
```

(d) Substituir o RODAPÉ inteiro — da linha `        <div className="shrink-0 border-t bg-background px-4 py-3 flex flex-wrap items-center gap-2">` até o `        </div>` imediatamente ANTES de `        <AlertDialog open={confirmDel} onOpenChange={setConfirmDel}>` — por:

```tsx
        {/* F3.3 — rodapé do mockup (gen_main.py:118-124): Voltar · Excluir · [Para enviar, falta…] · ⋯ · [Enviar Ordem de
            Criação | Enviar à Explosão] · [Editar] · Salvar. Duplicar / Importar dados / Ficha Técnica / Cancelar Ordem de
            Criação moram no ⋯ (§L). */}
        <div className="shrink-0 border-t bg-background px-4 py-3 flex flex-wrap items-center gap-2">
          {/* Voltar: ESQUERDA — ícone no mobile, texto no desktop. */}
          <Button variant="outline" onClick={requestClose} aria-label="Voltar" className="shrink-0 max-sm:aspect-square max-sm:px-0">
            <ArrowLeft className="h-4 w-4 mr-1 max-sm:mr-0" />
            <span className="max-sm:sr-only">Voltar</span>
          </Button>
          {/* Excluir: logo ao lado do Voltar (só no modo edição). */}
          {isEdit && (
            <Button variant="destructive" onClick={() => setConfirmDel(true)} aria-label="Excluir" className="shrink-0 max-sm:aspect-square max-sm:px-0">
              <Trash2 className="h-4 w-4 sm:mr-1" />
              <span className="max-sm:sr-only">Excluir</span>
            </Button>
          )}
          {/* "Para enviar, falta…" (Dev :3136-3147): cada item abre a seção onde se resolve. Trunca (1 linha). */}
          {mostraFaltas && (
            <span className="ml-auto min-w-0 truncate text-xs text-muted-foreground max-sm:hidden" data-testid="para-enviar-falta">
              Para enviar, falta:{" "}
              {pendenciasEnvio.map((p, i) => (
                <span key={p.label}>
                  {i > 0 && ", "}
                  <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => abrirSecao(p.secao)}>{p.label}</button>
                </span>
              ))}
            </span>
          )}
          {isEdit && (
            <MenuMaisAcoes
              className={mostraFaltas ? "max-sm:ml-auto" : "ml-auto"}
              onDuplicar={handleDuplicate}
              duplicando={duplicate.isPending}
              onFichaTecnica={enviadoCad ? () => setPrintTecnicaToken((t) => t + 1) : undefined}
              onCancelarOrdem={enviada ? () => enviar.mutate(false) : undefined}
              cancelandoOrdem={enviar.isPending}
            />
          )}
          {isEdit && !enviada && (
            <TooltipProvider>
              <Tooltip>
                {/* Botão desabilitado não dispara title nativo — o span recebe o hover e o tooltip lista o que falta. */}
                <TooltipTrigger asChild>
                  <span className="inline-flex shrink-0">
                    <Button variant="secondary" onClick={() => enviar.mutate(true)} disabled={enviar.isPending || enviarBloqueios.length > 0}>
                      <span className="sm:hidden">Enviar Ordem</span>
                      <span className="hidden sm:inline">Enviar Ordem de Criação</span>
                    </Button>
                  </span>
                </TooltipTrigger>
                {enviarBloqueios.length > 0 && (
                  <TooltipContent className="max-w-[260px]">
                    <p className="font-medium">Para enviar a Ordem de Criação, falta:</p>
                    <ul className="mt-1 list-disc pl-4">
                      {enviarBloqueios.map((b) => <li key={b}>{b}</li>)}
                    </ul>
                  </TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>
          )}
          {mostraEnviarExplosao && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex shrink-0">
                    <Button
                      variant="secondary"
                      onClick={() => setConfirmEnviarExplosao(true)}
                      disabled={!podeEnviarExplosaoAgora}
                      aria-label="Enviar à Explosão"
                      className="max-sm:aspect-square max-sm:px-0"
                    >
                      {enviarExplosao.isPending ? <Loader2 className="h-4 w-4 animate-spin sm:mr-1" /> : <Send className="h-4 w-4 sm:mr-1" />}
                      <span className="max-sm:sr-only">Enviar à Explosão</span>
                    </Button>
                  </span>
                </TooltipTrigger>
                {motivoEnvioBloqueado && <TooltipContent className="max-w-[260px]">{motivoEnvioBloqueado}</TooltipContent>}
              </Tooltip>
            </TooltipProvider>
          )}
          {/* Trava pós-Explosão (decisão F3 #1): "Editar" destrava os campos vindos do Dev (BOM e CAD incluídos); o Salvar re-trava. */}
          {isEdit && enviadoCad && !editandoDev && podeEditarDev && (
            <Button
              variant="secondary"
              onClick={() => setEditandoDev(true)}
              aria-label="Editar"
              title="Enviado à Explosão — destrava os campos vindos do Desenvolvimento"
              className="shrink-0 max-sm:aspect-square max-sm:px-0"
            >
              <Pencil className="h-4 w-4 sm:mr-1" />
              <span className="max-sm:sr-only">Editar</span>
            </Button>
          )}
          <Button className={`shrink-0 max-sm:aspect-square max-sm:px-0${!isEdit ? " ml-auto" : ""}`} aria-label="Salvar" onClick={handleSave} disabled={save.isPending || enviarExplosao.isPending}>
            <Save className="h-4 w-4 sm:mr-1" />
            <span className="max-sm:sr-only">Salvar</span>
          </Button>
        </div>
```

(e) Antes de `        <UnsavedChangesGuard confirm={confirm} message="Há alterações não salvas neste card." />`, inserir:

```tsx
        {/* F3.3 — confirmação do envio (Dev :3202-3219). */}
        <AlertDialog open={confirmEnviarExplosao} onOpenChange={setConfirmEnviarExplosao}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Enviar modelo para a Explosão?</AlertDialogTitle>
              <AlertDialogDescription>
                O card é salvo e vai para a Explosão (próxima etapa) com os tecidos, variantes, grade e CAD atuais. Na Explosão
                você define a quantidade a enviar e autoriza a baixa do estoque. Depois de enviado, os campos vindos do
                Desenvolvimento ficam travados — use “Editar” para alterá-los.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Não, quero revisar antes</AlertDialogCancel>
              <AlertDialogAction onClick={() => { setConfirmEnviarExplosao(false); enviarExplosao.mutate(); }}>Sim, enviar</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
```

e, logo DEPOIS dessa mesma linha do `UnsavedChangesGuard`, inserir:

```tsx
        {/* F3.3 — Ficha Técnica (menu ⋯, "após Enviar"): a MESMA do Dev (PrintFicha — PrintArea em portal), montada oculta
            e disparada pelo token (Dev :3261-3265). */}
        {isEdit && modeloId && enviadoCad && <PrintFicha modeloId={modeloId} kind="tecnica" token={printTecnicaToken} />}
```

(f) APAGAR o bloco do Sheet do Dev por cima do card — do comentário `      {/* "Ver no Desenvolvimento" (setor Preço, §K) → ModeloDetailPanel INLINE por cima deste` até o `      )}` que fecha `{verDevModeloId && ( <ModeloDetailPanel … /> )}` (inclusive).

- [ ] **Step 8: Conferência + gates + commit**

```bash
P=src/components/planejamento/PlanejamentoDetail.tsx
grep -rn "verDevModeloId\|ModeloDetailPanel\b\|onVerDev\|ver no Desenvolvimento" src/components/planejamento | grep -v "ModeloDetailPanel.tsx:" # só comentários com "ModeloDetailPanel.tsx:NNN" (citação de linha)
grep -cF 'rpc("enviar_modelo_para_cad"' src/components/planejamento/planejamento-detail/useEnviarExplosao.ts   # 1
grep -cF "<MenuMaisAcoes" $P; grep -cF "PedidoSecaoContext.Provider" $P    # 1 / 2
grep -cF "text-destructive" src/components/planejamento/planejamento-detail/MenuMaisAcoes.tsx   # 0 (R7: "Cancelar Ordem" neutro, como no mockup)
bash .superpowers/f33/gates.sh
D=src/components/planejamento/planejamento-detail
F="$D/ficha/useFichaKanban.ts $D/usePlanejamentoSave.ts $D/useEnviarExplosao.ts $D/MenuMaisAcoes.tsx $D/PrecoTabela.tsx $P"
git add -- $F
git commit --only -m "feat(planejamento): F3.3 (9) — Enviar à Explosão (gate pela posição derivada + 'Para enviar, falta'), rodapé do mockup com menu ⋯ e Ficha Técnica; sai o 'Ver no Desenvolvimento'

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- $F
```

**Revisão individual (Opus):** o gate do botão = o do servidor (`podeEnviarExplosao` + `statusParaGate`; carregando ⇒ bloqueia); `salvarAntes` × P0409 (retry segue, envio aborta com aviso; `savingRef` coerente); só envia com `ficha.podeEditar` (carregada, com permissão); pós-envio: `enviado_cad` no cache sem mexer no `rev` (merge não se confunde), trava volta, "Editar" aparece, invalidações da Explosão/Ficha; o rodapé segue §A (Voltar esq · Excluir · … · Salvar dir) e o mobile não estoura em 360px; menu ⋯ = Popover do precedente; Ficha Técnica só com `enviado_cad`; nenhum resto do "Ver no Desenvolvimento" (import, estado, Sheet por cima, `onVerDev`).

---

## Task 10: Importar dados (menu ⋯) — staging no BOM/CAD/rascunho, destaque, Observações do bloco na hora  *(individual Opus)*

**Files:**
- Modify: `src/components/planejamento/planejamento-detail/ficha/useFichaBom.ts` (`aplicarImportacao`)
- Modify: `src/components/planejamento/planejamento-detail/ficha/useFichaTecnica.ts` (`aplicarImportacaoBom`)
- Modify: `src/components/planejamento/planejamento-detail/ficha/persistir-bom.ts` (`substituirObservacoesDoBloco`)
- Create: `src/components/planejamento/planejamento-detail/useImportarDados.ts`
- Modify: `src/components/planejamento/planejamento-detail/ficha/secoes/DevEquipeSection.tsx` (destaque da Obs. Técnicas)
- Modify: `src/components/planejamento/PlanejamentoDetail.tsx`

**Interfaces:**
- Consumes: Task 2 (`camposDoPatchNoDraft`, `itensSobrescritos`); `ImportarDadosDialog` (`{ open, onOpenChange, modeloDestinoId, destinoBlocks, onCopiar(r, origem, sel) }`, `importar/ImportarDadosDialog.tsx:21-24`), `PatchCopia`/`ResultadoCopia`/`ModeloParaCopia`/`Selecao` (`importar-copia.ts`), `classeCopiado` (`importar/highlight.ts`) — só importar; Task 9 (`MenuMaisAcoes.onImportar`).
- Produces: `useFichaBom().aplicarImportacao(patch: PatchCopia, campos: Set<string>)`; `FichaTecnica.aplicarImportacaoBom` (no-op sem `podeEditar`); `substituirObservacoesDoBloco(modeloId, linhas)`; `useImportarDados({ modeloId, ficha, draft, setDraftTracked, qc })` → `{ aberto, setAberto, confirmacao, setConfirmacao, onCopiar }`; `DevEquipeSection({…, camposCopiados?, onCampoEditado?})`.

- [ ] **Step 1: `useFichaBom.aplicarImportacao`**

(a) Depois de `import type { PatchBlocoCad } from "./ficha-cad";` (Task 5), inserir:

```ts
import type { PatchCopia } from "@/components/desenvolvimento/importar/importar-copia";
```

(b) Antes de `  const onCampoEditado = (chave: string) => setCamposCopiados((prev) => {`, inserir:

```ts
  /**
   * F3.3 — Importar dados (Dev :2328-2350): aplica o patch no BOM em STAGING (só o Salvar grava), recalcula os custos com
   * o preço ATUAL (a cópia traz o custo do modelo de origem) e marca o destaque. T3: leva consumo/%loss/artigo de cada
   * bloco ao CAD (o Dev não leva — o CAD dele ficava com o consumo antigo até a próxima carga).
   */
  const aplicarImportacao = (patch: PatchCopia, campos: Set<string>) => {
    if (patch.blocks || patch.aviamentos || patch.etiquetas || patch.grades) marcarTocado();
    if (patch.blocks !== undefined) {
      const novos = patch.blocks.map((b) => recomputeBlock(b, dados.artigoMap, varianteArtigoMap, frozen));
      setBlocks(novos);
      for (const b of novos) aoMudarBlocoRef.current?.(b.tipo, b.numero, { consumo: b.consumo, loss_percent: b.loss_percent, artigo_id: b.artigo_id });
      marcarFlag("consumo");
    }
    if (patch.aviamentos !== undefined) {
      setAviamentosState(patch.aviamentos.map((r) => recomputeAviamento(r, dados.aviamentoMap)));
      marcarFlag("aviamentos");
    }
    if (patch.etiquetas !== undefined) setEtiquetasState(patch.etiquetas.map((r) => recomputeEtiqueta(r, dados.etiquetaMap)));
    if (patch.grades !== undefined) {
      setGrades(patch.grades);
      marcarFlag("grade");
    }
    setCamposCopiados((prev) => new Set([...prev, ...campos]));
  };

```

(c) No `return`, trocar `    marcarTocado, cargaSeq, aplicarConsumoDoCad,` por `    marcarTocado, cargaSeq, aplicarConsumoDoCad, aplicarImportacao,`.

- [ ] **Step 2: `useFichaTecnica.aplicarImportacaoBom`**

(a) Depois de `import { seloCadSecao } from "./selos-secoes";` (Task 5), inserir:

```ts
import type { PatchCopia } from "@/components/desenvolvimento/importar/importar-copia";
```

(b) No `return`, trocar `    cadGravavel, cadAntesDaOrdem: !dados.cadExiste && !a.ordemEnviada,` por:

```ts
    cadGravavel, cadAntesDaOrdem: !dados.cadExiste && !a.ordemEnviada,
    // F3.3 — Importar dados: só com a ficha editável (o item do menu nem aparece sem isso).
    aplicarImportacaoBom: podeEditar ? bom.aplicarImportacao : (_p: PatchCopia, _c: Set<string>) => undefined,
```

- [ ] **Step 3: `persistir-bom.substituirObservacoesDoBloco`**

No FIM de `persistir-bom.ts`, acrescentar:

```ts
/**
 * F3.3 — Importar dados, "Observações (bloco)": SUBSTITUI na hora (Dev :2383-2394 — o bloco `ModeloObservacoes` é
 * auto-save, fora do Salvar). Apaga SEMPRE (origem vazia limpa o destino) e insere as linhas da origem.
 */
export async function substituirObservacoesDoBloco(
  modeloId: string,
  linhas: { ordem: number | null; descricao: string | null; observacao: string | null }[],
): Promise<void> {
  const { error: eDel } = await supabase.from("modelo_observacoes" as any).delete().eq("modelo_id", modeloId);
  if (eDel) throw eDel;
  const rows = linhas.map((o) => ({ modelo_id: modeloId, ordem: o.ordem, descricao: o.descricao, observacao: o.observacao }));
  if (rows.length === 0) return;
  const { error: eIns } = await supabase.from("modelo_observacoes" as any).insert(rows);
  if (eIns) throw eIns;
}
```

- [ ] **Step 4: `useImportarDados.ts`**

```ts
// F3.3 — "Importar dados" no Sheet do Planejamento. PORTA de ModeloDetailPanel.tsx:2328-2400 (aplicarPatch /
// overwritesDoPatch / onCopiar) + :3239-3259 (diálogos). O diálogo é o do Dev (ImportarDadosDialog), reusado SEM
// modificar. Staging: tudo vai para o rascunho/BOM/CAD (realce amarelo que some ao editar) e só o Salvar grava — EXCETO
// as Observações (bloco), que gravam NA HORA (substitui; o bloco é auto-save — CLAUDE.md, "criacao").
import { useState, type Dispatch, type SetStateAction } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import type { ModeloParaCopia, ResultadoCopia, Selecao } from "@/components/desenvolvimento/importar/importar-copia";
import type { Draft } from "@/components/planejamento/modelo-shared";
import { camposDoPatchNoDraft, itensSobrescritos } from "./ficha/importar-ficha";
import { substituirObservacoesDoBloco } from "./ficha/persistir-bom";
import type { FichaTecnica } from "./ficha/useFichaTecnica";

export function useImportarDados({ modeloId, ficha, draft, setDraftTracked, qc }: {
  modeloId: string | null;
  ficha: FichaTecnica;
  draft: Draft;
  setDraftTracked: Dispatch<SetStateAction<Draft>>;
  qc: QueryClient;
}) {
  const [aberto, setAberto] = useState(false);
  const [confirmacao, setConfirmacao] = useState<{ itens: string[]; aplicar: () => void } | null>(null);

  const onCopiar = (r: ResultadoCopia, origem?: ModeloParaCopia, sel?: Selecao) => {
    const aplicar = async () => {
      const campos = camposDoPatchNoDraft(r.patch);
      if (Object.keys(campos).length > 0) setDraftTracked((d) => ({ ...d, ...campos }));
      ficha.aplicarImportacaoBom(r.patch, r.campos);
      if (sel?.obsBloco && origem && modeloId) {
        try {
          await substituirObservacoesDoBloco(modeloId, origem.obsBlocoLinhas ?? []);
          qc.invalidateQueries({ queryKey: ["modelo-observacoes", modeloId] });
          toast.info("Observações copiadas.");
        } catch (e) {
          toast.error(mensagemErro(e, "Erro ao copiar as observações"));
        }
      }
    };
    const itens = itensSobrescritos(r.patch, {
      observacoesTecnicas: draft.observacoes_tecnicas, custosAdicionais: draft.custos_adicionais, proporcoes: draft.proporcoes,
      blocks: ficha.estado.blocks, aviamentos: ficha.estado.aviamentos, etiquetas: ficha.estado.etiquetas, grades: ficha.estado.grades,
    }, !!sel?.obsBloco);
    if (itens.length === 0) { void aplicar(); return; }
    setConfirmacao({ itens, aplicar: () => { void aplicar(); setConfirmacao(null); } });
  };

  return { aberto, setAberto, confirmacao, setConfirmacao, onCopiar };
}
```

- [ ] **Step 5: `DevEquipeSection` — destaque da Obs. Técnicas importada**

(a) Depois de `import { FieldSelect } from "@/components/planejamento/planejamento-detail/campos";`, inserir:

```ts
import { classeCopiado } from "@/components/desenvolvimento/importar/highlight";

const SEM_COPIADOS: Set<string> = new Set();
```

(b) Trocar `export function DevEquipeSection({ draft, setDraftTracked, refVisivel, campoVisivel, bloqueado }: {` por `export function DevEquipeSection({ draft, setDraftTracked, refVisivel, campoVisivel, bloqueado, camposCopiados, onCampoEditado }: {` e, depois de `  bloqueado: boolean;`, inserir:

```ts
  /** F3.3 — destaque do "Importar dados" (realce amarelo que some ao editar — ModeloInfoSection.tsx:361-363). */
  camposCopiados?: Set<string>;
  onCampoEditado?: (chave: string) => void;
```

(c) Substituir:

```tsx
        <Textarea rows={3} value={draft.observacoes_tecnicas} onChange={(e) => set({ observacoes_tecnicas: e.target.value })} data-colab-path="observacoes_tecnicas" />
```

por:

```tsx
        <Textarea
          rows={3}
          value={draft.observacoes_tecnicas}
          className={classeCopiado(camposCopiados ?? SEM_COPIADOS, "obs_tecnicas")}
          onChange={(e) => { set({ observacoes_tecnicas: e.target.value }); onCampoEditado?.("obs_tecnicas"); }}
          data-colab-path="observacoes_tecnicas"
        />
```

- [ ] **Step 6: `PlanejamentoDetail` — fiação**

(a) Depois de `import { useEnviarExplosao } from "@/components/planejamento/planejamento-detail/useEnviarExplosao";` (Task 9), inserir:

```ts
import { useImportarDados } from "@/components/planejamento/planejamento-detail/useImportarDados";
import { ImportarDadosDialog } from "@/components/desenvolvimento/importar/ImportarDadosDialog";
```

(b) Depois do bloco `const enviarExplosao = useEnviarExplosao({ … });` (Task 9), inserir:

```ts
  // F3.3 — Importar dados (Dev :2328-2400): staging no rascunho/BOM/CAD (só o Salvar grava); obs. do bloco grava na hora.
  const importar = useImportarDados({ modeloId, ficha, draft, setDraftTracked, qc });
```

(c) Na chamada `<MenuMaisAcoes …>`, depois de `              duplicando={duplicate.isPending}`, inserir:

```tsx
              onImportar={ficha.podeEditar ? () => importar.setAberto(true) : undefined}
```

(d) Na chamada `<DevEquipeSection …>`, depois de `                  bloqueado={devBloqueado}`, inserir:

```tsx
                  camposCopiados={ficha.camposCopiados}
                  onCampoEditado={ficha.onCampoEditado}
```

(e) Antes de `        <UnsavedChangesGuard confirm={confirm} message="Há alterações não salvas neste card." />`, inserir:

```tsx
        {/* F3.3 — Importar dados (Dev :3239-3259): o diálogo do Dev SEM modificar; só existe aberto (nasce limpo). */}
        {isEdit && modeloId && importar.aberto && (
          <ImportarDadosDialog
            open={importar.aberto}
            onOpenChange={importar.setAberto}
            modeloDestinoId={modeloId}
            destinoBlocks={ficha.estado.blocks}
            onCopiar={(r, origem, sel) => importar.onCopiar(r, origem, sel)}
          />
        )}
        <AlertDialog open={!!importar.confirmacao} onOpenChange={(o) => { if (!o) importar.setConfirmacao(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Sobrescrever dados existentes?</AlertDialogTitle>
              <AlertDialogDescription>
                A importação vai substituir: {importar.confirmacao?.itens.join(" · ")}. Os campos entram para revisão (só o
                Salvar grava); as Observações (bloco), se marcadas, são aplicadas na hora.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={() => importar.confirmacao?.aplicar()}>Substituir</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
```

- [ ] **Step 7: Conferência + gates + commit**

```bash
grep -rn "ImportarDadosDialog" src/components/planejamento                            # 2 (import + uso)
git diff --stat "$(cat .superpowers/f33/BASE)" -- src/components/desenvolvimento/     # vazio
bash .superpowers/f33/gates.sh
D=src/components/planejamento/planejamento-detail
F="$D/ficha/useFichaBom.ts $D/ficha/useFichaTecnica.ts $D/ficha/persistir-bom.ts $D/useImportarDados.ts $D/ficha/secoes/DevEquipeSection.tsx src/components/planejamento/PlanejamentoDetail.tsx"
git add -- $F
git commit --only -m "feat(planejamento): F3.3 (10) — Importar dados no menu ⋯ (staging no BOM/CAD/rascunho com destaque; Observações do bloco na hora)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- $F
```

**Revisão individual (Opus):** paridade com o Dev (:2328-2400) + T3 (a propagação ao CAD do que o Importar mudou); nada grava além das Observações do bloco (e só depois de confirmar a sobrescrita); o destaque some ao editar (Obs. Técnicas, custos adicionais, tecidos, aviamentos, insumos, grade — os componentes já leem `camposCopiados`); o item só aparece com a ficha editável; o diálogo monta só aberto; o diálogo e o `importar-copia` do Dev intocados.

---

## Task 11: Snapshot só-leitura do BOM/CAD de PRODUÇÃO antes do merge  *(controlador — pré-condição da Task 13)*

**Files:** nenhum no repo. Saída em `/Users/sunglee/PLM + Criação/savepoints/<data>-pre-f33-cad/` (FORA do repo; contém dado de loja; nunca commitar).

Por quê: a F3.3 passa a GRAVAR `cad_*` (e, pelo `salvar_cad_completo`, `cad_grades`/`modelo_grades`) a partir do Planejamento — o vite do dono (`:5173`) grava em PRODUÇÃO assim que o código chega à branch dele. Quando: (1) ANTES do fast-forward da Task 13 e (2) de novo ANTES do deploy Cloudflare da F3. Só leitura (`default_transaction_read_only=on`).

- [ ] **Step 1: Exportar**

```bash
DEST="/Users/sunglee/PLM + Criação/savepoints/$(date +%F)-pre-f33-cad"
mkdir -p "$DEST"
URL="$(cat /tmp/dburl.txt)"
for T in cad cad_tecidos cad_tecido_variantes cad_grades cad_aviamentos cad_etiquetas \
         modelo_tecidos modelo_tecido_variantes modelo_grades modelo_observacoes; do
  PGOPTIONS='-c default_transaction_read_only=on' psql "$URL" -v ON_ERROR_STOP=1 -q \
    -c "\copy (SELECT * FROM public.$T ORDER BY id) TO '$DEST/$T.csv' CSV HEADER"
done
PGOPTIONS='-c default_transaction_read_only=on' psql "$URL" -v ON_ERROR_STOP=1 -q \
  -c "\copy (SELECT id, tenant_id, rev, proporcoes, observacoes_tecnicas, ficha_medida_url, enviado_cad, ordem_criacao_enviada, status_desenvolvimento FROM public.modelos ORDER BY id) TO '$DEST/modelos_colunas_cad.csv' CSV HEADER"
(cd "$DEST" && for f in *.csv; do printf '%s\t%s linhas\t%s\n' "$f" "$(($(wc -l < "$f") - 1))" "$(shasum -a 256 "$f" | cut -c1-16)"; done) > "$DEST/INDICE.tsv"
cat "$DEST/INDICE.tsv"
```

Expected: 11 CSVs com contagem e hash. Escrever `$DEST/LEIA-ME.md` com: data/hora, commit do código (`git -C "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f33-cad-acoes" rev-parse HEAD`), "restaurar só com OK do dono", "contém dados de lojas — não commitar".

- [ ] **Step 2: Registrar** — o guardião anota o caminho e o `INDICE.tsv` no diário (G-fase). Sem commit.

---

## Task 12: QA contra a CÓPIA — app de teste da worktree (`:5184`), guarda invertida, fluxos que gravam na cópia  *(controlador; relatório ao guardião)*

> Mesmo modo da F3.1/F3.2: o app de teste da worktree fala só com a CÓPIA LOCAL, então os caminhos de escrita da F3.3 (`salvar_cad_completo` real, envio à Explosão real, Importar com Observações do bloco, Dev ↔ Planejamento) são provados sem tocar produção. Produção: snapshot (Task 11) + smoke só-leitura (Task 13 Step 6).

**Files:**
- Create (NÃO versionar): `tests/e2e/f33-qa.spec.ts`; evidência em `.superpowers/f33/qa/` (fluxos que gravam: `.superpowers/f33/qa/escrita/`).
- Modify (fora do repo, com backup): `/Users/sunglee/PLM + Criação/banco-local/app-teste-variantes/criar-variante.sh` — aceita a porta `5184`.

Regras (as MESMAS da F3.1/F3.2): barradas esperadas (`rpc/servicos_financeiro` e o broadcast REST do Realtime) seguem barradas e não reprovam; `servicos_financeiro` NUNCA em `READ_RPCS`; loja pelo tenant_id `37889b78-fffb-404b-8c75-18b7e50a1d9b`; na cópia, qualquer requisição a `*.supabase.co` reprova; `:5184` ocupada ⇒ PARE; derrubar SÓ pelo `descer.sh` da variante; nunca `:5173`/`:5185`/`:5186`/`:5187`/`:5188` (nem `:5198`/`:5199`); nunca junto com o E2E da F2 nem com QA de outra fase. RPC de leitura nova barrada (ex.: da Ficha Técnica) = o controlador confere no snapshot `funcoes.sql` que é `STABLE` e sem escrita ANTES de pôr em `READ_RPCS` (e registra); nunca libera por tentativa.

- [ ] **Step 1: Pré-condições, a porta 5184 no script e a variante**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f33-cad-acoes"
ps -Ao pid,command | grep -E "[v]itest|playwright|kanban-auto.spec|f3[0-9]-qa" | grep -v grep; echo "testes-checados"
lsof -nP -iTCP:5184 -sTCP:LISTEN; echo "porta-checada"
curl -s -o /dev/null -w 'Supabase local http=%{http_code}\n' http://127.0.0.1:54321/auth/v1/health
curl -s -o /dev/null -w 'app de teste do dono :5188 http=%{http_code} (só observado)\n' http://localhost:5188/
PGCONNECT_TIMEOUT=5 psql "postgresql://postgres:postgres@127.0.0.1:54422/postgres" -X -A -t -q \
  -c "select count(*) from information_schema.columns where table_schema='public' and table_name='modelos' and column_name='descricao_produto'" | sed 's/^/descricao_produto na cópia = /'
```

Expected: só `testes-checados` e `porta-checada`; `Supabase local http=200`; `descricao_produto na cópia = 1` (a F3.1 já está na cópia — senão PARE e avise o controlador; a F3.3 não põe coluna).

Acrescentar a porta 5184 ao script (backup antes; edição por `sed` casando o texto EXATO — nada mais muda):

```bash
VAR="/Users/sunglee/PLM + Criação/banco-local/app-teste-variantes"
cp -p "$VAR/criar-variante.sh" "$VAR/criar-variante.sh.bak-pre-f33"
# R6 — LITERAL (-F, com o `*` SEM escape): em BRE o `$` de `$PORTA` no meio do padrão vira âncora e a contagem dá 0
# no macOS (testado: BRE=0, -F=1) — o executor pararia por falso alarme. O `sed` abaixo segue em BRE (certo como está).
grep -cF 'case "$PORTA" in 5185|5186|5187) ;; *) echo "RECUSADO: porta $PORTA (variantes: F2=5185, F3.1=5187, F3.2=5186)"; exit 1;; esac' "$VAR/criar-variante.sh"   # 1
sed -i '' \
  -e 's/case "$PORTA" in 5185|5186|5187) ;; \*) echo "RECUSADO: porta $PORTA (variantes: F2=5185, F3.1=5187, F3.2=5186)"; exit 1;; esac/case "$PORTA" in 5184|5185|5186|5187) ;; *) echo "RECUSADO: porta $PORTA (variantes: F2=5185, F3.1=5187, F3.2=5186, F3.3=5184)"; exit 1;; esac/' \
  -e 's/^# Portas: F2 = 5185, F3.1 = 5187, F3.2 = 5186\./# Portas: F2 = 5185, F3.1 = 5187, F3.2 = 5186, F3.3 = 5184./' \
  "$VAR/criar-variante.sh"
diff "$VAR/criar-variante.sh.bak-pre-f33" "$VAR/criar-variante.sh"   # só as 2 linhas (porta 5184 e o comentário)
bash -n "$VAR/criar-variante.sh" && echo "sintaxe ok"
bash "$VAR/criar-variante.sh" f33 "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f33-cad-acoes" 5184
"$VAR/f33/subir.sh"
lsof -nP -iTCP:5188 -sTCP:LISTEN -t | sed 's/^/:5188 do dono intacto, PID /'
```

Expected: `1`; o `diff` mostra SÓ as 2 linhas; `sintaxe ok`; `variante f33 pronta …`; `OK: variante f33 em http://localhost:5184 (PID …)` + `[guarda-copia-local] OK: variante f33 (:5184, raiz …/f33-cad-acoes) — cliente e worker -> http://127.0.0.1:54321 (cópia local)`; o `:5188` com o mesmo PID de antes. `RECUSADO`/`ABORTADO`/`ERRO`: PARE e reporte (nunca contornar a guarda; nunca `npm run dev` + `VITE_*`).

Escolher os cards (SELECT só-leitura na cópia) e exportar:

```bash
Q() { PGCONNECT_TIMEOUT=5 psql "postgresql://postgres:postgres@127.0.0.1:54422/postgres" -X -A -t -q -v ON_ERROR_STOP=1 -c "BEGIN READ ONLY; $1; COMMIT;"; }
BASE_SQL="with base as (select m.*, exists(select 1 from cad c where c.modelo_id=m.id) tem_cad,
  exists(select 1 from modelo_tecidos t where t.modelo_id=m.id and t.tipo='tecido' and t.numero=1 and t.artigo_id is not null) t1,
  case when m.ordem_criacao_enviada then (public._explosao_envio_gate(m.tenant_id, public._kanban_status_gate(m.tenant_id, m.id, m.status_desenvolvimento))).ok else false end gate_ok
  from modelos m where m.tenant_id='37889b78-fffb-404b-8c75-18b7e50a1d9b' and coalesce(m.origem,'interno')='interno' and not coalesce(m.lancado,false))"
SEM_PENDENCIA="coalesce(trim(ref),'')<>'' and coalesce(trim(nome),'')<>'' and estilista_id is not null and categoria_principal_id is not null
  and data_desenho_tecnico is not null and data_piloto1 is not null
  and ((piloteiro2_id is null and data_piloto2 is null) or data_piloto2 is not null) and ((piloteiro3_id is null and data_piloto3 is null) or data_piloto3 is not null)
  and (select coalesce(sum(grade_total),0) from modelo_grades g where g.modelo_id=base.id) > 0
  and exists(select 1 from modelo_tecidos t join modelo_tecido_variantes v on v.modelo_tecido_id=t.id where t.modelo_id=base.id and t.tipo='tecido' and t.artigo_id is not null and v.variante_tecido_id is not null)
  and not exists(select 1 from modelo_tecidos t where t.modelo_id=base.id and t.artigo_id is not null and not exists(select 1 from modelo_tecido_variantes v where v.modelo_tecido_id=t.id and v.variante_tecido_id is not null))"
export F33_CARD_CAD="$(Q "$BASE_SQL select id from base where ordem_criacao_enviada and tem_cad and not coalesce(enviado_cad,false) and not gate_ok and t1 order by nome, id limit 1")"
export F33_CARD_GATE="$(Q "$BASE_SQL select id from base where ordem_criacao_enviada and tem_cad and not coalesce(enviado_cad,false) and gate_ok and t1 and $SEM_PENDENCIA order by nome, id limit 1")"
export F33_CARD_PRE="$(Q "$BASE_SQL select id from base where not ordem_criacao_enviada and not tem_cad and t1 order by nome, id limit 1")"
export F33_CARD_ENVIADO="$(Q "$BASE_SQL select id from base where coalesce(enviado_cad,false) and tem_cad and t1 order by nome, id limit 1")"
export F33_CARD_ORIGEM="$(Q "$BASE_SQL select b.id from base b join modelo_tecidos t on t.modelo_id=b.id and t.tipo='tecido' and t.numero=1 and coalesce(t.consumo,0)>0 where b.id::text not in ('$F33_CARD_CAD','$F33_CARD_GATE','$F33_CARD_PRE','$F33_CARD_ENVIADO') order by b.nome, b.id limit 1")"
env | grep '^F33_CARD_' | sort
env | grep '^F33_CARD_' | sort > .superpowers/f33/qa-cards.env
```

Expected: 5 uuids (24/set na cópia: CAD = "Novo modelo (Plan. Tecido) QA" `9b360f73…`, GATE = "Blusa Teste" `f68de1f4…` se estiver sem pendência, PRE = "Blusa Teste"/"Vestal" sem Ordem, ENVIADO = "Blusa do Teste 1"/"Vestal" aprovado, ORIGEM = outro com Tecido 1 e consumo). Algum vazio ⇒ PARE e reporte (o dono decide completar um card pela tela na cópia — nada de INSERT/UPDATE à mão).

- [ ] **Step 2: Escrever o spec `tests/e2e/f33-qa.spec.ts`**

```ts
// tests/e2e/f33-qa.spec.ts — QA da F3.3 (CAD, Enviar à Explosão, ⋯, Ficha Técnica, Importar dados, numeração/selos no
// Sheet do Planejamento). NÃO COMMITAR (apoio da worktree; apagado na Task 13).
// DOIS ALVOS — F33_ALVO obrigatório:
//  • "copia"    — Task 12: app de teste DA WORKTREE (http://localhost:5184) sobre a CÓPIA LOCAL (http://127.0.0.1:54321).
//                 Guarda INVERTIDA: QUALQUER requisição a *.supabase.co (GET inclusive) é violação. O teste automático
//                 (S1–S14) SIMULA as escritas (route.fulfill); E1–E4 (F33_ESCRITA=1) GRAVAM de verdade — só na cópia,
//                 um por vez (-g "E1 —"), com o OK do dono antes de cada um.
//  • "producao" — smoke SÓ-LEITURA pós-merge no :5173 do dono (Task 13 Step 6): só o "S0". Nenhuma escrita chega ao banco.
// Barradas ESPERADAS (seguem barradas, não reprovam — as MESMAS da F3.1/F3.2): `rpc/servicos_financeiro` da Home (NUNCA
// liberar) e o broadcast REST do Realtime. Qualquer outra barrada = violação. O robô NÃO troca de loja.
// Cards: ids escolhidos por SELECT só-leitura (Task 12 Step 1) → env F33_CARD_*.
// Rodar (cópia): set -a; . .superpowers/f33/qa-cards.env; set +a; E2E_BASE_URL=http://localhost:5184 \
//   VITE_SUPABASE_URL=http://127.0.0.1:54321 F33_ALVO=copia npx playwright test tests/e2e/f33-qa.spec.ts --workers=1 --retries=0 -g "F3.3 — "
import { test, expect, type Browser, type BrowserContext, type Page, type Request, type Route } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { Client as PgClient } from "pg";
import { doLogin } from "./_helpers";

const BASE = process.env.E2E_BASE_URL ?? "";
if (!/^http:\/\/localhost:\d+$/.test(BASE)) throw new Error(`E2E_BASE_URL precisa ser o vite LOCAL — recebido "${BASE}". Sem isso o QA NÃO foi feito.`);
const ALVO = process.env.F33_ALVO ?? "";
if (ALVO !== "copia" && ALVO !== "producao") throw new Error(`F33_ALVO obrigatório: "copia" ou "producao" (recebi "${ALVO}").`);
if (!process.env.VITE_SUPABASE_URL) throw new Error("VITE_SUPABASE_URL ausente: a guarda de rede não sabe o host do Supabase. PARE.");
const SUPA_HOST = new URL(process.env.VITE_SUPABASE_URL).host;
if (ALVO === "copia" && (SUPA_HOST !== "127.0.0.1:54321" || BASE !== "http://localhost:5184")) {
  throw new Error(`F33_ALVO=copia exige VITE_SUPABASE_URL=http://127.0.0.1:54321 e E2E_BASE_URL=http://localhost:5184 (recebi ${SUPA_HOST} · ${BASE}).`);
}
if (ALVO === "producao" && (!/\.supabase\.co$/.test(SUPA_HOST) || BASE !== "http://localhost:5173")) {
  throw new Error(`F33_ALVO=producao é o smoke no :5173 do dono (Supabase de produção) — recebi ${SUPA_HOST} · ${BASE}.`);
}
const ehSupabaseProducao = (u: URL) => /(^|\.)supabase\.co$/i.test(u.hostname);
const ESCRITA = process.env.F33_ESCRITA === "1";
const LOJA_TESTE = "37889b78-fffb-404b-8c75-18b7e50a1d9b";
const CARD = {
  cad: process.env.F33_CARD_CAD ?? "",          // interno, Ordem enviada, COM CAD, não enviado, etapa ANTES da de envio
  gate: process.env.F33_CARD_GATE ?? "",        // idem, mas com o gate DERIVADO ok e sem pendência
  pre: process.env.F33_CARD_PRE ?? "",          // interno SEM Ordem e SEM CAD, com Tecido 1
  enviado: process.env.F33_CARD_ENVIADO ?? "",  // interno enviado à Explosão
  origem: process.env.F33_CARD_ORIGEM ?? "",    // origem do Importar (Tecido 1 com consumo)
};
if (ALVO === "copia") {
  for (const [k, v] of Object.entries(CARD)) {
    // GATE pode faltar só numa REPETIÇÃO depois do E3 (que envia o card de gate): o S9(b) anota e segue; o E3 recusa.
    if (k === "gate" && v === "") continue;
    if (!/^[0-9a-f-]{36}$/.test(v)) throw new Error(`F33_CARD_${k.toUpperCase()} ausente/inválido — rode o Step 1 da Task 12.`);
  }
}
const OBS_OUTRO = "Alterado por outra pessoa (QA F3.3)";
const SEL_TECIDOS = "id,modelo_id,artigo_id,numero,tipo,consumo,loss_percent,custo_previsto";
const SEL_CAD_PREFIXO = "id,cad_tecidos(";   // SELECT_CAD_FICHA (useFichaDados.ts) começa assim
const LOCAL_PG = "postgresql://postgres:postgres@127.0.0.1:54422/postgres";
// RPCs de LEITURA (STABLE — conferidas no snapshot funcoes.sql de 22/set). Outra RPC = violação.
// ⚠️ NUNCA `servicos_financeiro` (DEFINER VOLATILE que sincroniza `parcelas_servico` na leitura — invariante #1).
const READ_RPCS = new Set([
  "custo_unitario_modelos", "modelo_mo_resumo", "estoque_tecido_por_artigo", "otb_orcamento",
  "sidebar_badges", "minhas_permissoes_efetivas", "get_user_tenant_id", "meu_tenant_ativo",
  "modelos_mo_a_aprovar_count",
  "avaliar_condicoes_kanban", "precos_tecido_congelado", "ocs_disponiveis_variante", "modelo_etapas_afetadas",
]);
if (READ_RPCS.has("servicos_financeiro")) throw new Error("servicos_financeiro é PROIBIDO em READ_RPCS.");
const BARRADAS_ESPERADAS = [/^POST \/rest\/v1\/rpc\/servicos_financeiro$/, /^POST \/realtime\/v1\/api\/broadcast/];
const OUT = path.resolve(".superpowers/f33/qa");

type Gravada = { metodo: string; caminho: string; corpo: any };
type Fake = { casa: (m: string, u: URL) => boolean; responde: (r: Route, req: Request) => Promise<void> };
type Card = { id: string; tecidos: { tipo: string; numero: number; artigo_id: string | null; consumo: number | null }[]; cad: any | null; modeloRow: any };
const g = { gravadas: [] as Gravada[], violacoes: [] as string[], barradasEsperadas: [] as string[], tenants: new Set<string>(), fakes: [] as Fake[] };
const json = (r: Route, status: number, body: unknown) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const corpoDe = (req: Request) => { try { return req.postDataJSON(); } catch { return req.postData(); } };
const limpar = () => { g.fakes = []; g.gravadas = []; };
const patchesModelos = () => g.gravadas.filter((x) => x.metodo === "PATCH" && x.caminho.startsWith("/rest/v1/modelos?"));
const chamou = (rpc: string) => g.gravadas.some((x) => x.caminho.startsWith(`/rest/v1/rpc/${rpc}`));
const idxRpc = (rpc: string) => g.gravadas.findIndex((x) => x.caminho.startsWith(`/rest/v1/rpc/${rpc}`));
const idxPatchModelos = () => g.gravadas.findIndex((x) => x.metodo === "PATCH" && x.caminho.startsWith("/rest/v1/modelos?"));
const t1 = (t: any) => t.tipo === "tecido" && t.numero === 1;
const num = (s: string) => Number(s.replace(/\./g, "").replace(",", ".")) || 0;
const bump = (s: string) => String(Math.round((num(s) + 0.111) * 1000) / 1000).replace(".", ",");
const lojaOk = () => g.tenants.size > 0 && [...g.tenants].every((t) => t === LOJA_TESTE);
const comRev = (row: any, delta: number, patch: Record<string, unknown> = {}) => {
  const mudar = (x: any) => ({ ...x, rev: Number(x?.rev ?? 0) + delta, ...patch });
  return Array.isArray(row) ? row.map(mudar) : mudar(row);
};

async function guardar(ctx: BrowserContext) {
  if (ALVO === "copia") {
    await ctx.route((u) => ehSupabaseProducao(u), async (route) => {
      g.violacoes.push(`PRODUÇÃO ${route.request().method()} ${route.request().url()}`);
      return route.abort("blockedbyclient");
    });
  }
  await ctx.route((u) => u.host === SUPA_HOST, async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const m = req.method();
    const p = u.pathname;
    if (p.startsWith("/auth/v1/") || p.startsWith("/storage/v1/object/sign/")) return route.continue();
    if (p === "/rest/v1/tenant_config") {
      const t = u.searchParams.get("tenant_id");
      if (t) g.tenants.add(t.replace(/^eq\./, ""));
    }
    const fake = g.fakes.find((f) => f.casa(m, u));
    if (p.startsWith("/rest/v1/rpc/")) {
      if (!fake && READ_RPCS.has(p.slice("/rest/v1/rpc/".length))) return route.continue();
    } else if (m === "GET" || m === "HEAD") {
      return fake ? fake.responde(route, req) : route.continue();
    }
    if (fake) {
      g.gravadas.push({ metodo: m, caminho: `${p}${u.search}`, corpo: corpoDe(req) });
      return fake.responde(route, req);
    }
    if (BARRADAS_ESPERADAS.some((re) => re.test(`${m} ${p}`))) g.barradasEsperadas.push(`${m} ${p}${u.search}`);
    else g.violacoes.push(`${m} ${p}${u.search}`);
    return route.abort("blockedbyclient");
  });
  const origem = new URL(BASE).origin;
  await ctx.route((u) => u.origin === origem, async (route) => {
    const m = route.request().method();
    if (m === "GET" || m === "HEAD") return route.continue();
    g.violacoes.push(`APP ${m} ${new URL(route.request().url()).pathname}`);
    return route.abort("blockedbyclient");
  });
}

function fakeModeloGet(id: string, corpo: unknown): Fake {
  return {
    casa: (m, u) => m === "GET" && u.pathname === "/rest/v1/modelos" && u.searchParams.get("select") === "*" && u.searchParams.get("id") === `eq.${id}`,
    responde: (r) => json(r, 200, corpo),
  };
}
/** GET do CAD embutido (`plan-ficha-cad`) com a folha do Tecido 1 trocada ("outra pessoa mudou o CAD"). */
function fakeCadAlterado(id: string, folha: number): Fake {
  return {
    casa: (m, u) => m === "GET" && u.pathname === "/rest/v1/cad" && (u.searchParams.get("select") ?? "").startsWith(SEL_CAD_PREFIXO) && u.searchParams.get("modelo_id") === `eq.${id}`,
    responde: async (r) => {
      const resp = await r.fetch();
      const corpo = await resp.json();
      const mudar = (c: any) => (c ? { ...c, cad_tecidos: (c.cad_tecidos ?? []).map((t: any) => (t1(t) ? { ...t, tamanho_folha: folha } : t)) } : c);
      await r.fulfill({ response: resp, json: Array.isArray(corpo) ? corpo.map(mudar) : mudar(corpo) });
    },
  };
}
/** GET do BOM (`plan-ficha-tecidos`) com o consumo do Tecido 1 trocado ("o salvar_modelo_bom já gravou o novo" — S7(b)). */
function fakeBomConsumo(id: string, consumo: number): Fake {
  return {
    casa: (m, u) => m === "GET" && u.pathname === "/rest/v1/modelo_tecidos" && u.searchParams.get("select") === SEL_TECIDOS && u.searchParams.get("modelo_id") === `eq.${id}`,
    responde: async (r) => {
      const resp = await r.fetch();
      const corpo = await resp.json();
      await r.fulfill({ response: resp, json: (Array.isArray(corpo) ? corpo : []).map((t: any) => (t1(t) ? { ...t, consumo } : t)) });
    },
  };
}
/** `salvar_cad_completo` FALHA (erro do servidor simulado) — S7. */
const fakeFalhaCad = () => g.fakes.push({ casa: (m, u) => m === "POST" && u.pathname === "/rest/v1/rpc/salvar_cad_completo", responde: (r) => json(r, 400, { code: "P0001", message: "falha simulada do CAD (QA F3.3)" }) });
/** PATCH em `modelos` OK; com `conflito`, o 1º dá 0 linhas (P0409 sintético) e o GET do modelo passa a vir com rev+1 e
 *  `observacoes_gerais` de outra pessoa — com `cadOutro`, o CAD do servidor também mudado. */
function fakePatchModelos(conflito?: { id: string; corpoReal: any; cadOutro?: number }) {
  let n = 0;
  g.fakes.push({
    casa: (m, u) => m === "PATCH" && u.pathname === "/rest/v1/modelos",
    responde: async (r, req) => {
      n += 1;
      const id = (new URL(req.url()).searchParams.get("id") ?? "").replace(/^eq\./, "");
      if (conflito && n === 1) {
        g.fakes.unshift(fakeModeloGet(conflito.id, comRev(conflito.corpoReal, 1, { observacoes_gerais: OBS_OUTRO })));
        if (conflito.cadOutro !== undefined) g.fakes.unshift(fakeCadAlterado(conflito.id, conflito.cadOutro));
        return json(r, 200, []);
      }
      return json(r, 200, [{ id }]);
    },
  });
}
const fakeRpc = (nome: string, body: unknown = null) => g.fakes.push({ casa: (m, u) => m === "POST" && u.pathname === `/rest/v1/rpc/${nome}`, responde: (r) => json(r, 200, body) });
const fakeTabela = (tabela: string) => g.fakes.push({ casa: (m, u) => ["PATCH", "POST", "DELETE"].includes(m) && u.pathname === `/rest/v1/${tabela}`, responde: (r) => r.fulfill({ status: 204, body: "" }) });
/** `enviar_modelo_para_cad` OK; a partir daí o GET do modelo vem com `enviado_cad = true` (o que o servidor faria). */
function fakeEnviar(c: Card) {
  g.fakes.push({
    casa: (m, u) => m === "POST" && u.pathname === "/rest/v1/rpc/enviar_modelo_para_cad",
    responde: async (r) => {
      g.fakes.unshift(fakeModeloGet(c.id, comRev(c.modeloRow, 2, { enviado_cad: true })));
      await json(r, 200, c.cad?.id ?? null);
    },
  });
}

function resposta(page: Page, pred: (u: URL, r: import("@playwright/test").Response) => boolean) {
  return page.waitForResponse((r) => { const u = new URL(r.url()); return u.host === SUPA_HOST && pred(u, r); }, { timeout: 60_000 });
}
const primeiro = (j: any) => (Array.isArray(j) ? j[0] ?? null : j ?? null);
async function abrirCard(page: Page, id: string): Promise<Card> {
  const pT = resposta(page, (u) => u.pathname === "/rest/v1/modelo_tecidos" && u.searchParams.get("select") === SEL_TECIDOS && u.searchParams.get("modelo_id") === `eq.${id}`);
  const pC = resposta(page, (u) => u.pathname === "/rest/v1/cad" && (u.searchParams.get("select") ?? "").startsWith(SEL_CAD_PREFIXO) && u.searchParams.get("modelo_id") === `eq.${id}`);
  const pM = resposta(page, (u, r) => u.pathname === "/rest/v1/modelos" && r.request().method() === "GET" && u.searchParams.get("select") === "*" && u.searchParams.get("id") === `eq.${id}`);
  await page.goto(`/criacao/planejamento?modelo=${id}`, { waitUntil: "networkidle" });
  await expect(page.getByRole("dialog").first()).toBeVisible({ timeout: 30_000 });
  const [rT, rC, rM] = await Promise.all([pT, pC, pM]);
  return { id, tecidos: await rT.json(), cad: primeiro(await rC.json()), modeloRow: await rM.json() };
}
async function expandir(page: Page, secao: string) {
  const b = page.locator(`[data-secao="${secao}"] > div > button`).first();
  if ((await b.getAttribute("aria-expanded")) === "false") await b.click();
}
const voltarParaAba = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
const consumoT1 = (p: Page) => p.locator('[data-secao="tecidos"] input[placeholder="0,000"]').first();
// Seção CAD (CadTecidosSection): 1ª linha = Tecido 1 (ordenado). NumberInputs com "0,00": Consumo, % Loss, Folha.
const cadConsumoT1 = (p: Page) => p.locator('[data-secao="cad"] input[placeholder="0,00"]').nth(0);
const cadFolhaT1 = (p: Page) => p.locator('[data-secao="cad"] input[placeholder="0,00"]').nth(2);
const avisoBom = (p: Page) => p.locator("li").filter({ hasText: "Tecidos & BOM" });
const popover = (p: Page) => p.locator("[data-radix-popper-content-wrapper]").last();
const titulosSecoes = (p: Page) => p.locator("[data-secao] > div > button span.truncate").allInnerTexts();
async function salvarEEsperar(page: Page, rpc: string) {
  await page.getByRole("dialog").first().getByRole("button", { name: "Salvar" }).click();
  await expect.poll(() => chamou(rpc), { timeout: 20_000 }).toBe(true);
  await page.waitForTimeout(1000);
}
/** SELECT só-leitura na CÓPIA. Nunca escreve. */
async function sqlCopia<T>(q: string, params: unknown[] = []): Promise<T[]> {
  if (ALVO !== "copia") throw new Error("SQL só na cópia");
  const c = new PgClient({ connectionString: LOCAL_PG, ssl: false });
  await c.connect();
  try {
    await c.query("BEGIN READ ONLY");
    return (await c.query(q, params)).rows as T[];
  } finally {
    await c.query("ROLLBACK").catch(() => undefined);
    await c.end();
  }
}

test("F3.3 — CAD, Enviar à Explosão, ⋯, Importar e numeração no Sheet (só leitura; escritas simuladas)", async ({ browser }) => {
  test.skip(ALVO !== "copia", "o automático é só na cópia");
  test.setTimeout(25 * 60_000);
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
  await guardar(ctx);
  // Ficha Técnica: conta as impressões em vez de abrir o diálogo do navegador.
  await ctx.addInitScript(() => { (window as any).__prints = 0; window.print = () => { (window as any).__prints += 1; }; });
  const page = await ctx.newPage();
  const errosPagina: string[] = [];
  page.on("pageerror", (e) => errosPagina.push(String(e?.message ?? e)));
  page.on("dialog", (d) => d.accept());
  await doLogin(page);
  await page.goto("/criacao/planejamento", { waitUntil: "networkidle" });
  await expect.poll(() => g.tenants.size, { timeout: 15_000 }).toBeGreaterThan(0);
  expect(lojaOk(), `Loja ativa ≠ Loja Teste (${[...g.tenants].join(",")}). PARE: o robô NÃO troca de loja.`).toBe(true);

  await test.step("S1 — card COM CAD: BOM editável (sem a trava 'tem CAD'), seção CAD numerada e editável, sem atalho ao Dev", async () => {
    limpar();
    const c = await abrirCard(page, CARD.cad);
    expect(c.cad, "F33_CARD_CAD precisa ter CAD").toBeTruthy();
    await expandir(page, "tecidos");
    await expect(consumoT1(page)).toBeEditable();
    await expect(page.getByText(/Este modelo já tem CAD|Abrir no Desenvolvimento|ver no Desenvolvimento/)).toHaveCount(0);
    const titulos = await titulosSecoes(page);
    const nums = titulos.map((t) => Number(/^(\d+)\. /.exec(t)?.[1] ?? Number.NaN));
    expect(nums, `títulos: ${titulos.join(" | ")}`).toEqual(nums.map((_, i) => i + 1));
    expect(titulos.some((t) => /^\d+\. CAD$/.test(t))).toBe(true);
    await expect(page.locator('[data-secao="desenvolvimento"]').getByText("do Desenvolvimento")).toBeVisible();
    await expandir(page, "cad");
    await expect(cadConsumoT1(page)).toBeEditable();
  });

  await test.step("S2 — propagação: Tecidos → CAD e CAD → Tecidos (o mesmo consumo nas duas; 'não salvo' aceso)", async () => {
    await abrirCard(page, CARD.cad);
    await expandir(page, "tecidos");
    await expandir(page, "cad");
    const a = bump(await consumoT1(page).inputValue());
    await consumoT1(page).fill(a);
    await expect.poll(async () => num(await cadConsumoT1(page).inputValue()), { timeout: 10_000 }).toBeCloseTo(num(a), 3);
    const b = bump(a);
    await cadConsumoT1(page).fill(b);
    await expect.poll(async () => num(await consumoT1(page).inputValue()), { timeout: 10_000 }).toBeCloseTo(num(b), 3);
    await expect(page.getByTitle("Há alterações não salvas")).toBeVisible();
  });

  await test.step("S3 — Salvar com consumo editado: PATCH → salvar_modelo_bom → salvar_cad_completo, o MESMO consumo nos dois", async () => {
    limpar(); fakePatchModelos(); fakeRpc("salvar_modelo_bom"); fakeRpc("salvar_cad_completo", CARD.cad); fakeRpc("marcar_revisao_por_mudanca", {}); fakeTabela("modelo_etiquetas");
    await abrirCard(page, CARD.cad);
    await expandir(page, "tecidos");
    const novo = bump(await consumoT1(page).inputValue());
    await consumoT1(page).fill(novo);
    await salvarEEsperar(page, "salvar_cad_completo");
    const iPatch = idxPatchModelos(), iBom = idxRpc("salvar_modelo_bom"), iCad = idxRpc("salvar_cad_completo");
    expect(iPatch).toBeGreaterThanOrEqual(0);
    expect(iBom).toBeGreaterThan(iPatch);
    expect(iCad).toBeGreaterThan(iBom);
    const bom = g.gravadas[iBom].corpo, cad = g.gravadas[iCad].corpo;
    expect(bom._tecidos.find(t1).consumo).toBeCloseTo(num(novo), 3);
    expect(cad._tecidos.find(t1).consumo_cad).toBeCloseTo(num(novo), 3);
    expect(cad._observacoes_molde).toBeNull();
    expect(cad._data_previsao_corte).toBeNull();
    (cad._etiquetas ?? []).forEach((e: any) => expect(e.enviar_por_tamanho).toEqual({}));
  });

  await test.step("S4 — Salvar sem mexer na ficha (1ª tentativa): o CAD é regravado (decisão F3 #7), o BOM não", async () => {
    limpar(); fakePatchModelos(); fakeRpc("salvar_cad_completo", CARD.cad);
    await abrirCard(page, CARD.cad);
    await expandir(page, "tecidos");
    await expect(consumoT1(page)).toBeEditable();
    const nome = page.locator('[data-colab-path="nome"]');
    await nome.fill(`${await nome.inputValue()} ·QA4`);
    await salvarEEsperar(page, "salvar_cad_completo");
    expect(chamou("salvar_modelo_bom")).toBe(false);
    expect(idxRpc("salvar_cad_completo")).toBeGreaterThan(idxPatchModelos());
  });

  await test.step("S5 — P0409 sem toque na ficha: o retry NÃO regrava o CAD nem o BOM (§3 P5)", async () => {
    limpar();
    const c = await abrirCard(page, CARD.cad);
    fakePatchModelos({ id: c.id, corpoReal: c.modeloRow }); fakeRpc("salvar_cad_completo", CARD.cad);
    await expandir(page, "tecidos");
    await expect(consumoT1(page)).toBeEditable();
    const nome = page.locator('[data-colab-path="nome"]');
    await nome.fill(`${await nome.inputValue()} ·QA5`);
    await page.getByRole("dialog").first().getByRole("button", { name: "Salvar" }).click();
    await expect.poll(() => patchesModelos().length, { timeout: 20_000 }).toBeGreaterThanOrEqual(2);
    await page.waitForTimeout(1500);
    expect(patchesModelos()[1].corpo.observacoes_gerais).toBe(OBS_OUTRO);
    expect(chamou("salvar_cad_completo")).toBe(false);
    expect(chamou("salvar_modelo_bom")).toBe(false);
  });

  await test.step("S5b — rev novo SEM toque na ficha e Salvar NA HORA (R1 do G-plano): o CAD VELHO nunca é regravado por cima do de outra pessoa", async () => {
    limpar();
    const c = await abrirCard(page, CARD.cad);
    const revNovo = Number(primeiro(c.modeloRow)?.rev ?? 0) + 1;
    // O servidor de verdade: PATCH com o rev VELHO ⇒ 0 linhas (P0409); só o rev NOVO passa.
    g.fakes.push({
      casa: (m, u) => m === "PATCH" && u.pathname === "/rest/v1/modelos",
      responde: async (r, req) => {
        const u = new URL(req.url());
        const id = (u.searchParams.get("id") ?? "").replace(/^eq\./, "");
        return json(r, 200, u.searchParams.get("rev") === `eq.${revNovo}` ? [{ id }] : []);
      },
    });
    fakeRpc("salvar_cad_completo", CARD.cad);
    await expandir(page, "cad");
    await expect(cadFolhaT1(page)).toBeEditable();
    const nome = page.locator('[data-colab-path="nome"]');
    await nome.fill(`${await nome.inputValue()} ·QA5b`);   // só o cabeçalho — a ficha (BOM/CAD) fica SEM toque
    // Outra pessoa salvou: rev+1 e a folha do Tecido 1 = 9,87 no CAD do servidor.
    g.fakes.unshift(fakeCadAlterado(c.id, 9.87));
    g.fakes.unshift(fakeModeloGet(c.id, comRev(c.modeloRow, 1, { observacoes_gerais: OBS_OUTRO })));
    const pModelo = resposta(page, (u, r) => u.pathname === "/rest/v1/modelos" && r.request().method() === "GET" && u.searchParams.get("id") === `eq.${c.id}`);
    await voltarParaAba(page);
    await pModelo;
    // Salvar NA HORA, pelo DOM (sem a espera de "ação" do Playwright) — tenta cair na janela "rev novo, CAD ainda velho".
    await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      const b = Array.from(dlg?.querySelectorAll("button") ?? []).find((x) => x.textContent?.trim() === "Salvar") as HTMLButtonElement | undefined;
      b?.click();
    });
    await expect.poll(() => patchesModelos().length, { timeout: 20_000 }).toBeGreaterThanOrEqual(1);
    await expect.poll(async () => num(await cadFolhaT1(page).inputValue()), { timeout: 20_000 }).toBeCloseTo(9.87, 2);
    await page.waitForTimeout(1500);
    // A propriedade (vale em qualquer ordem de chegada): OU o CAD não foi gravado (Salvar na janela — `cadVelhoRef`, ou o
    // retry do P0409 sem toque), OU foi gravado JÁ com o CAD NOVO (Salvar depois da recarga — paridade). Nunca o velho.
    const iCad = idxRpc("salvar_cad_completo");
    if (iCad >= 0) {
      expect(Number(g.gravadas[iCad].corpo._tecidos.find(t1)?.tamanho_folha ?? 0), "regravou o CAD VELHO por cima do de outra pessoa (R1)").toBeCloseTo(9.87, 2);
    }
    expect(chamou("salvar_modelo_bom")).toBe(false);
    test.info().annotations.push({ type: "S5b", description: iCad >= 0 ? "o Salvar caiu DEPOIS da recarga: regravou o CAD NOVO (paridade)" : "o Salvar caiu na janela: o CAD não foi gravado (R1)" });
  });

  await test.step("S6 — P0409 com a ficha tocada e o CAD do servidor mudado por outra pessoa: 'Tecidos & BOM', nada grava", async () => {
    limpar();
    const c = await abrirCard(page, CARD.cad);
    fakePatchModelos({ id: c.id, corpoReal: c.modeloRow, cadOutro: 9.87 });
    fakeRpc("salvar_modelo_bom"); fakeRpc("salvar_cad_completo", CARD.cad);
    await expandir(page, "cad");
    await cadFolhaT1(page).fill(bump(await cadFolhaT1(page).inputValue()));
    await page.getByRole("dialog").first().getByRole("button", { name: "Salvar" }).click();
    await expect(avisoBom(page)).toBeVisible({ timeout: 20_000 });
    expect(patchesModelos()).toHaveLength(1);
    expect(chamou("salvar_modelo_bom")).toBe(false);
    expect(chamou("salvar_cad_completo")).toBe(false);
  });

  await test.step("S6b — rev novo com a ficha tocada: eco (CAD igual) não acende; CAD de outra pessoa acende; 'usar o novo' traz o dela", async () => {
    limpar();
    const c = await abrirCard(page, CARD.cad);
    await expandir(page, "cad");
    const meu = bump(await cadFolhaT1(page).inputValue());
    await cadFolhaT1(page).fill(meu);
    g.fakes.unshift(fakeModeloGet(c.id, comRev(c.modeloRow, 1, { status_desenvolvimento: "stand_by" })));
    const pCad = resposta(page, (u) => u.pathname === "/rest/v1/cad" && (u.searchParams.get("select") ?? "").startsWith(SEL_CAD_PREFIXO));
    await voltarParaAba(page);
    await pCad;
    await page.waitForTimeout(2000);
    await expect(avisoBom(page)).toHaveCount(0);
    await expect(cadFolhaT1(page)).toHaveValue(meu);
    g.fakes.unshift(fakeCadAlterado(c.id, 9.87));
    g.fakes.unshift(fakeModeloGet(c.id, comRev(c.modeloRow, 2, { status_desenvolvimento: "stand_by" })));
    await voltarParaAba(page);
    await expect(avisoBom(page)).toBeVisible({ timeout: 20_000 });
    await avisoBom(page).getByRole("button", { name: "usar o novo" }).click();
    await expect.poll(async () => num(await cadFolhaT1(page).inputValue()), { timeout: 20_000 }).toBeCloseTo(9.87, 2);
  });

  await test.step("S7 — o CAD falha: mensagem por `bom.gravar` ('salve de novo antes de fechar') e 'não salvo' aceso (§3 P6); 'descartar' deixa a deriva e o próximo Salvar sem toque devolve ao BOM o consumo do CAD (paridade com o Dev — §6 R11)", async () => {
    // (a) BOM tocado: o BOM grava, o CAD falha.
    limpar(); fakePatchModelos(); fakeRpc("salvar_modelo_bom"); fakeRpc("marcar_revisao_por_mudanca", {}); fakeTabela("modelo_etiquetas"); fakeFalhaCad();
    const c = await abrirCard(page, CARD.cad);
    const cadConsumoServidor = Number(c.cad?.cad_tecidos?.find(t1)?.consumo_cad ?? 0);
    await expandir(page, "tecidos");
    const novo = bump(await consumoT1(page).inputValue());
    await consumoT1(page).fill(novo);
    await page.getByRole("dialog").first().getByRole("button", { name: "Salvar" }).click();
    await expect(page.getByText(/Os tecidos foram salvos, mas o CAD não — salve de novo antes de fechar/).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTitle("Há alterações não salvas")).toBeVisible();
    expect(chamou("salvar_modelo_bom")).toBe(true);
    // (b) R2 — "descartar": fechar SEM salvar de novo ⇒ a guarda avisa; descartado, sobra a deriva BOM (novo) × CAD (velho).
    await page.getByRole("dialog").first().getByRole("button", { name: "Voltar" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Descartar" }).click();
    // Reabre com o servidor "como ficou" (simulado): o BOM com o consumo NOVO (o salvar_modelo_bom gravou), o CAD com o VELHO.
    limpar(); fakePatchModelos(); fakeRpc("salvar_cad_completo", CARD.cad);
    g.fakes.push(fakeBomConsumo(c.id, num(novo)));
    await abrirCard(page, CARD.cad);
    await expandir(page, "tecidos");
    await expect.poll(async () => num(await consumoT1(page).inputValue()), { timeout: 10_000 }).toBeCloseTo(num(novo), 3);
    const nome = page.locator('[data-colab-path="nome"]');
    await nome.fill(`${await nome.inputValue()} ·QA7`);   // só o cabeçalho — a ficha SEM toque
    await salvarEEsperar(page, "salvar_cad_completo");
    expect(chamou("salvar_modelo_bom")).toBe(false);
    // O CAD é regravado com o consumo DO CAD (o velho) e o servidor o devolve ao BOM (funcoes.sql:6878-6881) — em silêncio,
    // IGUAL ao Dev. Registrado (§3 P1 "Limite", §6 R11); correção = tarefa de banco da F3 #7. Não é regressão da F3.3.
    expect(g.gravadas[idxRpc("salvar_cad_completo")].corpo._tecidos.find(t1).consumo_cad).toBeCloseTo(cadConsumoServidor, 3);
    // (c) Salvar SEM toque com o CAD falhando: o BOM não gravou ⇒ a mensagem NÃO diz "os tecidos foram salvos" (R2).
    limpar(); fakePatchModelos(); fakeFalhaCad();
    await abrirCard(page, CARD.cad);
    await expandir(page, "tecidos");
    await expect(consumoT1(page)).toBeEditable();
    const nome2 = page.locator('[data-colab-path="nome"]');
    await nome2.fill(`${await nome2.inputValue()} ·QA7c`);
    await page.getByRole("dialog").first().getByRole("button", { name: "Salvar" }).click();
    await expect(page.getByText(/O CAD não foi salvo — salve de novo antes de fechar/).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Os tecidos foram salvos/)).toHaveCount(0);
    expect(chamou("salvar_modelo_bom")).toBe(false);
  });

  await test.step("S8 — antes da Ordem (sem CAD): seção CAD só-leitura com a nota; Salvar grava o BOM e NÃO cria o CAD (D2)", async () => {
    limpar(); fakePatchModelos(); fakeRpc("salvar_modelo_bom"); fakeRpc("salvar_cad_completo", CARD.pre); fakeRpc("marcar_revisao_por_mudanca", {}); fakeTabela("modelo_etiquetas");
    const c = await abrirCard(page, CARD.pre);
    expect(c.cad).toBeNull();
    await expandir(page, "cad");
    await expect(page.locator('[data-secao="cad"]').getByText(/O CAD é criado depois da Ordem de Criação/)).toBeVisible();
    await expect(page.locator('[data-secao="cad"] input[placeholder="0,00"]')).toHaveCount(0);
    await expect(page.locator('[data-secao="cad"]').getByText("Calcular folhas / metragem automaticamente")).toHaveCount(0);
    await expandir(page, "tecidos");
    await consumoT1(page).fill(bump(await consumoT1(page).inputValue()));
    await salvarEEsperar(page, "salvar_modelo_bom");
    expect(chamou("salvar_cad_completo")).toBe(false);
  });

  await test.step("S9 — Enviar à Explosão: etapa antes da exigida ⇒ desabilitado com a etapa; gate derivado ok ⇒ Salvar → CAD → enviar_modelo_para_cad; depois trava e 'Editar'", async () => {
    // (a) etapa antes da de envio
    await abrirCard(page, CARD.cad);
    const enviarBtn = page.getByRole("button", { name: "Enviar à Explosão" });
    await expect(enviarBtn).toBeVisible();
    await expect(enviarBtn).toBeDisabled();
    await enviarBtn.locator("xpath=..").hover();
    await expect(page.getByText(/Disponível a partir da etapa/).first()).toBeVisible();
    // (b) gate derivado ok, sem pendência (card escolhido no Step 1)
    if (!CARD.gate) {
      test.info().annotations.push({ type: "S9", description: "sem F33_CARD_GATE (repetição depois do E3) — envio coberto pelo E3" });
      return;
    }
    limpar();
    const c = await abrirCard(page, CARD.gate);
    fakePatchModelos(); fakeRpc("salvar_cad_completo", CARD.gate); fakeEnviar(c);
    await expect(page.getByTestId("para-enviar-falta")).toHaveCount(0);
    await expect(enviarBtn).toBeEnabled({ timeout: 20_000 });
    await enviarBtn.click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Sim, enviar" }).click();
    await expect(page.getByText("Enviado para a Explosão").first()).toBeVisible({ timeout: 30_000 });
    const iPatch = idxPatchModelos(), iCad = idxRpc("salvar_cad_completo"), iEnv = idxRpc("enviar_modelo_para_cad");
    expect(iPatch).toBeGreaterThanOrEqual(0);
    expect(iCad).toBeGreaterThan(iPatch);
    expect(iEnv).toBeGreaterThan(iCad);
    expect(g.gravadas[iEnv].corpo._modelo_id).toBe(c.id);
    await expect(enviarBtn).toHaveCount(0);
    await expect(page.getByRole("dialog").first().getByRole("button", { name: "Editar" })).toBeVisible();
  });

  await test.step("S9b — 'Para enviar, falta…': cada item abre a seção onde se resolve", async () => {
    if (!CARD.gate) return; // repetição depois do E3 (anotado no S9)
    await abrirCard(page, CARD.gate);
    const ref = page.locator('[data-colab-path="ref"]');
    await expandir(page, "desenvolvimento");
    if (!(await ref.isVisible())) {
      // Sem REF editável nesta etapa não há como provocar a pendência sem gravar: registra e segue (os outros passos continuam).
      test.info().annotations.push({ type: "S9b", description: "REF não editável nesta etapa — link coberto pelo relatório manual" });
      return;
    }
    await ref.fill("");
    await page.locator('[data-secao="desenvolvimento"] > div > button').click(); // fecha a seção
    const falta = page.getByTestId("para-enviar-falta");
    await expect(falta).toBeVisible();
    await falta.getByRole("button").first().click();
    await expect(page.locator('[data-secao="desenvolvimento"] > div > button')).toHaveAttribute("aria-expanded", "true");
  });

  await test.step("S10 — menu ⋯ e Ficha Técnica: antes do envio desabilitada ('após Enviar'); enviado imprime", async () => {
    await abrirCard(page, CARD.cad);
    await page.getByRole("button", { name: "Mais ações" }).click();
    const m = popover(page);
    await expect(m.getByRole("button", { name: "Duplicar" })).toBeVisible();
    await expect(m.getByRole("button", { name: "Importar dados" })).toBeVisible();
    await expect(m.getByRole("button", { name: /Ficha Técnica/ })).toBeDisabled();
    await expect(m.getByText("após Enviar")).toBeVisible();
    await expect(m.getByRole("button", { name: "Cancelar Ordem de Criação" })).toBeVisible();
    await page.keyboard.press("Escape");
    await abrirCard(page, CARD.enviado);
    await page.getByRole("button", { name: "Mais ações" }).click();
    await expect(popover(page).getByRole("button", { name: "Importar dados" })).toHaveCount(0); // travado ⇒ sem Importar
    await popover(page).getByRole("button", { name: /Ficha Técnica/ }).click();
    await expect.poll(() => page.evaluate(() => (window as any).__prints), { timeout: 20_000 }).toBe(1);
  });

  await test.step("S11 — Importar dados: staging (nada grava), consumo vai aos Tecidos E ao CAD com destaque; Salvar leva aos dois", async () => {
    const [orig] = await sqlCopia<{ nome: string; consumo: string }>(
      `select m.nome, t.consumo::text consumo from modelos m join modelo_tecidos t on t.modelo_id = m.id and t.tipo = 'tecido' and t.numero = 1 where m.id = $1`, [CARD.origem]);
    limpar(); fakePatchModelos(); fakeRpc("salvar_modelo_bom"); fakeRpc("salvar_cad_completo", CARD.cad); fakeRpc("marcar_revisao_por_mudanca", {}); fakeTabela("modelo_etiquetas");
    await abrirCard(page, CARD.cad);
    await expandir(page, "tecidos");
    await expandir(page, "cad");
    await page.getByRole("button", { name: "Mais ações" }).click();
    await popover(page).getByRole("button", { name: "Importar dados" }).click();
    const dlg = page.getByRole("dialog", { name: "Importar dados de outro modelo" });
    await dlg.getByRole("combobox").click();
    await page.getByPlaceholder("buscar por nome / ref…").fill(orig.nome);
    await popover(page).getByText(orig.nome).first().click();
    await dlg.locator("div.text-sm", { has: page.locator("div.font-medium", { hasText: /^Tecido$/ }) }).locator("label", { hasText: "Consumo" }).click();
    await dlg.getByRole("button", { name: "Copiar" }).click();
    const sobrescrever = page.getByRole("alertdialog").filter({ hasText: "Sobrescrever dados existentes?" });
    // Só aparece quando o destino já tem valor a substituir (itensSobrescritos) — espera um pouco antes de decidir.
    if (await sobrescrever.waitFor({ state: "visible", timeout: 3000 }).then(() => true, () => false)) {
      await sobrescrever.getByRole("button", { name: "Substituir" }).click();
    }
    await expect.poll(async () => num(await consumoT1(page).inputValue()), { timeout: 10_000 }).toBeCloseTo(Number(orig.consumo), 3);
    await expect.poll(async () => num(await cadConsumoT1(page).inputValue()), { timeout: 10_000 }).toBeCloseTo(Number(orig.consumo), 3);
    expect(g.gravadas, "o Importar é staging — nada grava antes do Salvar").toEqual([]);
    await salvarEEsperar(page, "salvar_cad_completo");
    expect(g.gravadas[idxRpc("salvar_modelo_bom")].corpo._tecidos.find(t1).consumo).toBeCloseTo(Number(orig.consumo), 3);
    expect(g.gravadas[idxRpc("salvar_cad_completo")].corpo._tecidos.find(t1).consumo_cad).toBeCloseTo(Number(orig.consumo), 3);
  });

  await test.step("S12 — card enviado: aviso da F3.1; 'Editar' destrava BOM e CAD; Salvar grava os dois e re-trava", async () => {
    limpar(); fakePatchModelos(); fakeRpc("salvar_modelo_bom"); fakeRpc("salvar_cad_completo", CARD.enviado); fakeRpc("marcar_revisao_por_mudanca", {}); fakeTabela("modelo_etiquetas");
    await abrirCard(page, CARD.enviado);
    await expandir(page, "tecidos");
    await expect(page.locator('[data-secao="tecidos"] [data-testid="aviso-campos-dev"]')).toContainText("Enviado à Explosão");
    await expect(page.getByRole("button", { name: "Enviar à Explosão" })).toHaveCount(0);
    await page.getByRole("dialog").first().getByRole("button", { name: "Editar" }).click();
    await expect(consumoT1(page)).toBeEditable();
    await consumoT1(page).fill(bump(await consumoT1(page).inputValue()));
    await salvarEEsperar(page, "salvar_cad_completo");
    expect(idxRpc("salvar_cad_completo")).toBeGreaterThan(idxRpc("salvar_modelo_bom"));
    await expect(page.getByRole("dialog").first().getByRole("button", { name: "Editar" })).toBeVisible({ timeout: 10_000 });
  });

  await test.step("S13 — Dialog 'Novo Modelo' como o mockup (gen_novo.py, R7): '1. Informações' · '2. Coleção' · Tecidos · Mão de obra · Anexos (sem número)", async () => {
    await page.goto("/criacao/planejamento", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /Novo (Modelo|card)/i }).first().click();
    await expect(page.getByRole("dialog").first()).toBeVisible();
    expect(await titulosSecoes(page)).toEqual(["1. Informações Gerais do Produto", "2. Coleção", "Tecidos", "Mão de obra", "Anexos"]);
    await page.keyboard.press("Escape");
  });

  await test.step("S14 — 360px: sem rolagem horizontal; ⋯ e Salvar visíveis no rodapé", async () => {
    await page.setViewportSize({ width: 360, height: 780 });
    await abrirCard(page, CARD.cad);
    const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(sw).toBeLessThanOrEqual(cw);
    await expect(page.getByRole("button", { name: "Mais ações" })).toBeVisible();
    await expect(page.getByRole("dialog").first().getByRole("button", { name: "Salvar" })).toBeVisible();
    await page.screenshot({ path: path.join(OUT, "S14-360.png"), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "automatico.json"), JSON.stringify({ violacoes: g.violacoes, barradasEsperadas: g.barradasEsperadas, errosPagina, tenants: [...g.tenants] }, null, 2));
  expect(g.violacoes, "requisições barradas fora das esperadas").toEqual([]);
  expect(errosPagina, "erro de JS na página").toEqual([]);
  expect(lojaOk()).toBe(true);
});

test("S0 — smoke SÓ-LEITURA (produção pós-merge, :5173): card com CAD abre numerado, com a seção CAD e o rodapé novo", async ({ browser }) => {
  test.skip(ALVO !== "producao", "smoke só no alvo produção");
  const id = process.env.F33_SMOKE_CARD ?? "";
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("F33_SMOKE_CARD ausente (Task 13 Step 6 escolhe por SELECT só-leitura).");
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
  await guardar(ctx);
  const page = await ctx.newPage();
  await doLogin(page);
  await page.goto("/criacao/planejamento", { waitUntil: "networkidle" });
  await expect.poll(() => g.tenants.size, { timeout: 15_000 }).toBeGreaterThan(0);
  expect(lojaOk(), "o smoke roda SÓ na Loja Teste (o robô não troca de loja)").toBe(true);
  await abrirCard(page, id);
  const titulos = await titulosSecoes(page);
  expect(titulos.some((t) => /^\d+\. CAD$/.test(t))).toBe(true);
  await expect(page.getByRole("button", { name: "Mais ações" })).toBeVisible();
  await expect(page.getByText(/ver no Desenvolvimento|Abrir no Desenvolvimento/)).toHaveCount(0);
  expect(g.gravadas, "o smoke não grava nada").toEqual([]);
  expect(g.violacoes).toEqual([]);
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// FLUXOS QUE GRAVAM NA CÓPIA — E1…E4. GRAVAM DE VERDADE, SÓ na cópia (127.0.0.1:54321): F33_ALVO=copia + F33_ESCRITA=1,
// UM por vez (-g "E2 —"), dono avisado ANTES de cada um. PNG de cada passo em .superpowers/f33/qa/escrita/. Guarda
// INVERTIDA: escrita liberada SÓ para o Supabase local; qualquer requisição não-local reprova. Conferência por SELECT
// só-leitura. Ficam NA CÓPIA por natureza: snapshots do BOM, o CAD regravado (E1), o card enviado (E3) e as Observações
// importadas (E4). Seletores do Desenvolvimento (E1 parte 2: board/busca) não são da F3.3: se não casarem, o controlador
// ajusta SÓ o seletor (nunca a guarda) e registra.
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
const OUT_E = path.resolve(".superpowers/f33/qa/escrita");
const HOSTS_LOCAIS = new Set(["localhost", "127.0.0.1", "fonts.googleapis.com", "fonts.gstatic.com"]);
type EstadoEscrita = { gravadas: Gravada[]; violacoes: string[]; errosPagina: string[]; tenants: Set<string> };
const estadoEscrita = (): EstadoEscrita => ({ gravadas: [], violacoes: [], errosPagina: [], tenants: new Set() });
function exigeEscrita() {
  test.skip(!ESCRITA, "fluxos que gravam: só com F33_ESCRITA=1, um por vez, dono avisado");
  if (ALVO !== "copia") throw new Error("fluxos que GRAVAM: só com F33_ALVO=copia (nunca em produção)");
}
async function paginaEscrita(browser: Browser, st: EstadoEscrita): Promise<{ ctx: BrowserContext; page: Page }> {
  if (ALVO !== "copia" || !ESCRITA) throw new Error("fluxo que GRAVA só com F33_ALVO=copia e F33_ESCRITA=1");
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
  await ctx.route((u) => !HOSTS_LOCAIS.has(u.hostname), async (route) => {
    st.violacoes.push(`FORA DA CÓPIA ${route.request().method()} ${route.request().url()}`);
    return route.abort("blockedbyclient");
  });
  await ctx.route((u) => u.host === SUPA_HOST, async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    if (u.pathname === "/rest/v1/tenant_config") {
      const t = u.searchParams.get("tenant_id");
      if (t) st.tenants.add(t.replace(/^eq\./, ""));
    }
    if (req.method() !== "GET" && req.method() !== "HEAD" && !u.pathname.startsWith("/auth/v1/")) {
      st.gravadas.push({ metodo: req.method(), caminho: `${u.pathname}${u.search}`, corpo: corpoDe(req) });
    }
    return route.continue();
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => st.errosPagina.push(String(e?.message ?? e)));
  page.on("dialog", (d) => d.accept());
  await doLogin(page);
  return { ctx, page };
}
async function passo(page: Page, fluxo: string, n: number, nome: string) {
  fs.mkdirSync(OUT_E, { recursive: true });
  const arq = path.join(OUT_E, `${fluxo}-${n}-${nome}.png`);
  await page.screenshot({ path: arq, fullPage: true });
  console.log(`[f33-escrita] ${fluxo} passo ${n} (${nome}) → ${arq}`);
}
function conferirEscrita(st: EstadoEscrita, nome: string) {
  fs.mkdirSync(OUT_E, { recursive: true });
  fs.writeFileSync(path.join(OUT_E, `${nome}.json`), JSON.stringify({ ...st, tenants: [...st.tenants] }, null, 2));
  expect(st.violacoes, "requisição fora da cópia").toEqual([]);
  expect(st.errosPagina, "erro de JS na página").toEqual([]);
  expect(st.tenants.size > 0 && [...st.tenants].every((t) => t === LOJA_TESTE), "loja ≠ Loja Teste").toBe(true);
}
async function salvarReal(page: Page) {
  await page.getByRole("dialog").first().getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText(/Modelo salvo|^Salvo\./).first()).toBeVisible({ timeout: 30_000 });
}
const consumosT1 = async (id: string) => (await sqlCopia<{ bom: string | null; cad: string | null }>(
  `select mt.consumo::text bom, ct.consumo_cad::text cad from modelo_tecidos mt
     left join cad c on c.modelo_id = mt.modelo_id
     left join cad_tecidos ct on ct.cad_id = c.id and ct.tipo = mt.tipo and ct.numero = mt.numero
    where mt.modelo_id = $1 and mt.tipo = 'tecido' and mt.numero = 1`, [id]))[0];

test("E1 — consumo editado no Planejamento chega ao BOM E ao CAD no mesmo Salvar (P3); o Salvar do Desenvolvimento não desfaz (P4)", async ({ browser }) => {
  exigeEscrita();
  test.setTimeout(8 * 60_000);
  const st = estadoEscrita();
  const { ctx, page } = await paginaEscrita(browser, st);
  const antes = await consumosT1(CARD.cad);
  await abrirCard(page, CARD.cad);
  await expandir(page, "tecidos");
  const novo = bump(await consumoT1(page).inputValue());
  await consumoT1(page).fill(novo);
  await passo(page, "E1", 1, "consumo-editado");
  await salvarReal(page);
  await expect.poll(async () => (await consumosT1(CARD.cad)).cad, { timeout: 20_000 }).not.toBe(antes.cad);
  const depois = await consumosT1(CARD.cad);
  expect(Number(depois.bom)).toBeCloseTo(num(novo), 3);
  expect(Number(depois.cad)).toBeCloseTo(num(novo), 3);
  // Parte 2 (P4): Salvar no Desenvolvimento SEM mexer ⇒ o consumo segue o novo.
  const [{ nome }] = await sqlCopia<{ nome: string }>(`select nome from modelos where id = $1`, [CARD.cad]);
  await page.goto("/criacao/desenvolvimento", { waitUntil: "networkidle" });
  const busca = page.getByPlaceholder("Pesquisar por nome ou REF…");
  if (!(await busca.isVisible().catch(() => false))) await page.getByRole("button", { name: /Pesquisar/i }).first().click();
  await busca.fill(nome);
  await page.getByText(nome, { exact: true }).first().click();
  await expect(page.getByRole("dialog").first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(3000); // semeadura do CAD no Dev (espera os refetch)
  await passo(page, "E1", 2, "dev-aberto");
  await page.getByRole("dialog").first().getByRole("button", { name: "Salvar" }).click();
  await page.waitForTimeout(4000);
  const aposDev = await consumosT1(CARD.cad);
  expect(Number(aposDev.bom)).toBeCloseTo(num(novo), 3);
  expect(Number(aposDev.cad)).toBeCloseTo(num(novo), 3);
  // Desfaz: volta o consumo de antes pelo Planejamento.
  await abrirCard(page, CARD.cad);
  await expandir(page, "tecidos");
  await consumoT1(page).fill(String(antes.bom ?? "0").replace(".", ","));
  await salvarReal(page);
  await passo(page, "E1", 3, "desfeito");
  conferirEscrita(st, "E1");
  await ctx.close();
});

test("E2 — antes da Ordem de Criação o Salvar grava o BOM e NÃO cria o CAD (D2)", async ({ browser }) => {
  exigeEscrita();
  test.setTimeout(6 * 60_000);
  const st = estadoEscrita();
  const { ctx, page } = await paginaEscrita(browser, st);
  const antes = await consumosT1(CARD.pre);
  await abrirCard(page, CARD.pre);
  await expandir(page, "tecidos");
  const novo = bump(await consumoT1(page).inputValue());
  await consumoT1(page).fill(novo);
  await salvarReal(page);
  await passo(page, "E2", 1, "salvo");
  expect(Number((await consumosT1(CARD.pre)).bom)).toBeCloseTo(num(novo), 3);
  expect((await sqlCopia(`select 1 from cad where modelo_id = $1`, [CARD.pre])).length).toBe(0);
  expect(st.gravadas.some((x) => x.caminho.startsWith("/rest/v1/rpc/salvar_cad_completo"))).toBe(false);
  await abrirCard(page, CARD.pre);
  await expandir(page, "tecidos");
  await consumoT1(page).fill(String(antes.bom ?? "0").replace(".", ","));
  await salvarReal(page);
  conferirEscrita(st, "E2");
  await ctx.close();
});

test("E3 — Enviar à Explosão de verdade: salva, envia, trava; a Explosão passa a listar o modelo", async ({ browser }) => {
  exigeEscrita();
  if (!CARD.gate) throw new Error("E3 precisa de F33_CARD_GATE (Task 12 Step 1) — sem card de gate na cópia, o dono completa um pela tela.");
  test.setTimeout(6 * 60_000);
  const st = estadoEscrita();
  const { ctx, page } = await paginaEscrita(browser, st);
  await abrirCard(page, CARD.gate);
  const enviarBtn = page.getByRole("button", { name: "Enviar à Explosão" });
  await expect(enviarBtn).toBeEnabled({ timeout: 30_000 });
  await passo(page, "E3", 1, "antes");
  await enviarBtn.click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Sim, enviar" }).click();
  await expect(page.getByText("Enviado para a Explosão").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("dialog").first().getByRole("button", { name: "Editar" })).toBeVisible();
  await passo(page, "E3", 2, "enviado");
  const [m] = await sqlCopia<{ enviado_cad: boolean }>(`select enviado_cad from modelos where id = $1`, [CARD.gate]);
  expect(m.enviado_cad).toBe(true);
  expect((await sqlCopia(`select 1 from cad where modelo_id = $1`, [CARD.gate])).length).toBe(1);
  const iCad = st.gravadas.findIndex((x) => x.caminho.startsWith("/rest/v1/rpc/salvar_cad_completo"));
  const iEnv = st.gravadas.findIndex((x) => x.caminho.startsWith("/rest/v1/rpc/enviar_modelo_para_cad"));
  expect(iEnv).toBeGreaterThan(iCad);
  conferirEscrita(st, "E3");
  await ctx.close();
});

test("E4 — Importar com Observações (bloco): as observações gravam NA HORA; o BOM só no Salvar (descartado ⇒ não grava)", async ({ browser }) => {
  exigeEscrita();
  test.setTimeout(6 * 60_000);
  const st = estadoEscrita();
  const { ctx, page } = await paginaEscrita(browser, st);
  const antes = await consumosT1(CARD.cad);
  const [orig] = await sqlCopia<{ nome: string }>(`select nome from modelos where id = $1`, [CARD.origem]);
  const obsOrigem = await sqlCopia<{ n: string }>(`select count(*)::text n from modelo_observacoes where modelo_id = $1`, [CARD.origem]);
  await abrirCard(page, CARD.cad);
  await page.getByRole("button", { name: "Mais ações" }).click();
  await popover(page).getByRole("button", { name: "Importar dados" }).click();
  const dlg = page.getByRole("dialog", { name: "Importar dados de outro modelo" });
  await dlg.getByRole("combobox").click();
  await page.getByPlaceholder("buscar por nome / ref…").fill(orig.nome);
  await popover(page).getByText(orig.nome).first().click();
  await dlg.locator("div.text-sm", { has: page.locator("div.font-medium", { hasText: /^Tecido$/ }) }).locator("label", { hasText: "Consumo" }).click();
  await dlg.locator("label", { hasText: "Observações (bloco)" }).click();
  await dlg.getByRole("button", { name: "Copiar" }).click();
  await page.getByRole("alertdialog").filter({ hasText: "Sobrescrever dados existentes?" }).getByRole("button", { name: "Substituir" }).click();
  await expect(page.getByText("Observações copiadas.").first()).toBeVisible({ timeout: 20_000 });
  await passo(page, "E4", 1, "importado");
  const obsDestino = await sqlCopia<{ n: string }>(`select count(*)::text n from modelo_observacoes where modelo_id = $1`, [CARD.cad]);
  expect(obsDestino[0].n).toBe(obsOrigem[0].n);
  // BOM: staging — Voltar + "Descartar" ⇒ nada gravou no BOM/CAD.
  await page.getByRole("dialog").first().getByRole("button", { name: "Voltar" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Descartar" }).click();
  const depois = await consumosT1(CARD.cad);
  expect(depois.bom).toBe(antes.bom);
  expect(depois.cad).toBe(antes.cad);
  expect(st.gravadas.some((x) => /salvar_modelo_bom|salvar_cad_completo/.test(x.caminho))).toBe(false);
  conferirEscrita(st, "E4");
  await ctx.close();
});
```

- [ ] **Step 3: Rodar o automático (só leitura; escritas simuladas)**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f33-cad-acoes"
set -a; . .superpowers/f33/qa-cards.env; set +a
E2E_BASE_URL=http://localhost:5184 VITE_SUPABASE_URL=http://127.0.0.1:54321 F33_ALVO=copia \
  npx playwright test tests/e2e/f33-qa.spec.ts --workers=1 --retries=0 -g "F3.3 — " 2>&1 | tail -30
cat .superpowers/f33/qa/automatico.json
```

Expected: 1 passed (o S9b pode sair com a anotação "REF não editável nesta etapa" — registrar; o S5b sai com a anotação do ramo que ocorreu — "caiu na janela" ou "depois da recarga": os dois passam, registrar qual); `violacoes: []`, `errosPagina: []`; `barradasEsperadas` só com `servicos_financeiro`/broadcast. Falha: o controlador reporta com o passo, o print e o trecho — seletor que não casa com a tela REAL é ajustado SÓ no spec (registrado); comportamento errado volta para a task dona.

- [ ] **Step 4: Fluxos que gravam (E1–E4) — UM por vez, com o OK do dono a cada um**

Antes de cada um, avisar o dono por chat ("vou gravar na cópia: E<n> — <título>; o card <nome> fica <efeito>") e esperar o OK. **No aviso do E1 e do E2, dizer também** (nota do G-plano F3.3): a Loja Teste está com a chave `kanban_automatico` LIGADA na cópia, então o Salvar real desses fluxos pode MOVER o card de coluna (posição derivada) e gravar histórico (`modelo_kanban_historico`) na cópia — efeito que fica, como o do E3/E4. Depois:

```bash
set -a; . .superpowers/f33/qa-cards.env; set +a
E2E_BASE_URL=http://localhost:5184 VITE_SUPABASE_URL=http://127.0.0.1:54321 F33_ALVO=copia F33_ESCRITA=1 \
  npx playwright test tests/e2e/f33-qa.spec.ts --workers=1 --retries=0 -g "E1 —" 2>&1 | tail -20
```

(idem `-g "E2 —"`, `-g "E3 —"`, `-g "E4 —"`). Expected: cada um passa; os PNG e o `.json` do fluxo em `.superpowers/f33/qa/escrita/`. O E3 deixa o card ENVIADO na cópia e o E4 troca as Observações do card — avisar o dono ANTES (efeito que fica).

- [ ] **Step 5: Relatório e derrubar a variante**

Relatório curto ao guardião (S1–S14 + E1–E4: passou/falhou/registrado, com os caminhos dos PNG/JSON). Depois:

```bash
"/Users/sunglee/PLM + Criação/banco-local/app-teste-variantes/f33/descer.sh"
lsof -nP -iTCP:5184 -sTCP:LISTEN; echo "5184 livre"
lsof -nP -iTCP:5188 -sTCP:LISTEN -t | sed 's/^/:5188 do dono intacto, PID /'
```

---

## Task 13: Revisões, portões do guardião e merge  *(controlador)*

- [ ] **Step 1: Revisões Opus pendentes** — conforme §5 (Lote A; individual 4; 5+6 juntas; Lote B; individuais 9 e 10). Cada achado corrigido volta aos gates (`bash .superpowers/f33/gates.sh`).

- [ ] **Step 2: Conferências finais**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f33-cad-acoes"
git diff --name-only savepoint-pre-unificacao-2026-09-22 -- src/components/desenvolvimento/ src/components/producao/cad/CadTecidosSection.tsx   # vazio (decisão 8)
git diff --name-only "$(cat .superpowers/f33/BASE)" -- src/components/producao/ src/components/shared/ModeloObservacoes.tsx src/lib/kanban-condicoes.ts src/lib/artigo-label.ts supabase tests/integration tests/fixtures   # vazio
grep -rn 'rpc("salvar_cad_completo"' src | grep -v "src/components/desenvolvimento/\|src/components/producao/"   # só ficha/persistir-bom.ts (1): toda escrita de CAD do Planejamento passa por lá
grep -rn 'rpc("enviar_modelo_para_cad"' src | grep -v "src/components/desenvolvimento/"                          # só useEnviarExplosao.ts (1)
grep -rn '"cad"' src/components/planejamento/planejamento-detail/ficha/useFichaTecnica.ts | grep -i motivo       # vazio (a trava interina saiu)
grep -rn "verDevModeloId\|onVerDev\|onAbrirDev\|Abrir no Desenvolvimento\|ver no Desenvolvimento" src           # vazio
grep -rn '"plan-ficha-' src | cut -d: -f1 | sort -u                                                              # só planejamento-detail/ficha/
grep -cF "<Secao titulo=" src/components/planejamento/PlanejamentoDetail.tsx                                       # 0 (toda seção com id/número)
bash .superpowers/f33/gate-f31.sh; bash .superpowers/f33/gate-f32.sh                                              # "preservada: ok" ×2, código 0
```

- [ ] **Step 3: G-commit + G-fase F3.3 (guardião)** — anexar: saída de `gates.sh`, o relatório do QA (Task 12: `automatico.json` com "1 passed" e as barradas esperadas; `escrita/` E1–E4 com JSON/PNG), os greps do Step 2, o `INDICE.tsv` do snapshot (Task 11), as decisões do dono respondidas (§8) e as técnicas (§7), a prova da §3 com a indicação de onde cada P é testado, o registro de âncoras divergentes (se houver) e, se a F3.3 nasceu pelo ruling R3a, o `.superpowers/f33/rebase-f32.md` (rebase, conflitos, re-revisões e custo).

- [ ] **Step 4: Pré-merge — a F3.2 JÁ juntada, snapshot de HOJE e aviso ao dono**

```bash
MAIN="/Users/sunglee/PLM + Criação/plm-pcp"
git -C "$MAIN" merge-base --is-ancestor "$(git -C "$MAIN" rev-parse f32/ficha-bom)" feature/plan-tecido-a1 && echo "F3.2 juntada: ok" || echo "F3.2 NÃO juntada — PARE (a F3.3 espera)"
```

Com `F3.2 juntada: ok` (ou o controlador confirma que a F3.2 juntou por rebase — shas novos — e aponta o commit equivalente): pedir ao dono, por chat, para salvar e fechar os cards abertos do Planejamento/Desenvolvimento no `:5173` E no `:5188`; pausar executores de outras fases durante o merge. Snapshot da Task 11 feito HOJE.

- [ ] **Step 5: Rebase `--onto` sobre a branch principal e fast-forward**

```bash
MAIN="/Users/sunglee/PLM + Criação/plm-pcp"; WT="$MAIN/.claude/worktrees/f33-cad-acoes"
BASE33="$(cat "$WT/.superpowers/f33/BASE")"
git -C "$WT" log --oneline "$BASE33..HEAD" | tee "$WT/.superpowers/f33/commits-f33.txt" | wc -l   # os commits F3.3 (1)…(10)
git -C "$WT" rebase --onto feature/plan-tecido-a1 "$BASE33" f33/cad-acoes
git -C "$WT" merge-base --is-ancestor feature/plan-tecido-a1 HEAD && echo "F3.3 sobre a branch principal: ok"
```

Conflito no rebase (fix da F3.2 depois do BASE): resolver preservando o texto FINAL da F3.2 (é contrato) e registrar. Depois do rebase — mesmo sem conflito — refazer (R3b do G-plano F3.3: as âncoras NÃO se recontam no HEAD pós-rebase — a F3.3 já mudou várias delas de propósito, ex.: `: dados.cadExiste ? "cad"` conta 0 depois da Task 6):

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f33-cad-acoes"
BASE33="$(cat .superpowers/f33/BASE)"
# A NOVA base da F3.3 depois do rebase = a ponta da branch principal (com a F3.2 já juntada) — é nela que se recontam
# as âncoras, nunca no HEAD (que já tem a F3.3).
export PONTA="$(git rev-parse feature/plan-tecido-a1)"
git merge-base --is-ancestor "$PONTA" HEAD && echo "F3.3 sobre $PONTA: ok"
ARQS_F33="$(cat .superpowers/f33/arqs-f33.txt)"
git diff --stat "$BASE33" "$PONTA" -- $ARQS_F33    # o que a F3.2 mudou desde o BASE nos arquivos que a F3.3 consome/edita
```

e então: Task 0 Step 3 com esse `PONTA` exportado (`git show "$PONTA:<arq>" | grep -cF`); para cada arquivo do `git diff --stat`, re-revisar a task da F3.3 que o edita (mapa §4) e registrar; `bash .superpowers/f33/gates.sh`; a escolha dos cards (Task 12 Step 1 — o E3 já enviou o card de gate; sem outro, `F33_CARD_GATE` fica vazio e o S9(b) só anota); o automático da Task 12 (Step 3) e o E1. Então:

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp"
git status --porcelain | grep -v '^??' && echo "HÁ ALTERAÇÃO NÃO COMMITADA NO CHECKOUT PRINCIPAL — PARE" || true
git merge --ff-only f33/cad-acoes
```

Se não for ff (a branch principal andou): repetir este Step com `BASE33="$(git -C "$WT" merge-base HEAD feature/plan-tecido-a1)"`.

- [ ] **Step 6: Smoke pós-merge (SÓ LEITURA, produção, guarda de sempre)**

Escolher o card do smoke por SELECT só-leitura em produção (interno da Loja Teste com CAD) e rodar o S0 contra o vite do dono SEM derrubá-lo:

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f33-cad-acoes"
export F33_SMOKE_CARD="$(PGOPTIONS='-c default_transaction_read_only=on' psql "$(cat /tmp/dburl.txt)" -X -A -t -q -c \
  "select m.id from modelos m join cad c on c.modelo_id = m.id where m.tenant_id = '37889b78-fffb-404b-8c75-18b7e50a1d9b' and coalesce(m.origem,'interno') = 'interno' order by m.nome, m.id limit 1")"
echo "smoke: $F33_SMOKE_CARD"
E2E_BASE_URL=http://localhost:5173 VITE_SUPABASE_URL="$(grep '^VITE_SUPABASE_URL=' .env | cut -d= -f2- | tr -d '"')" F33_ALVO=producao \
  npx playwright test tests/e2e/f33-qa.spec.ts --workers=1 --retries=0 -g "S0 —" 2>&1 | tail -8
```

Expected: `smoke: <uuid>` e "1 passed" (o spec recusa se o host não for `*.supabase.co`; nenhum Salvar é clicado; toda escrita seria barrada).

- [ ] **Step 7: Limpeza** — `rm tests/e2e/f33-qa.spec.ts` (arquivo próprio, não versionado); a worktree fica até a F3.4 nascer (ela parte do mesmo HEAD); a variante `banco-local/app-teste-variantes/f33/` e o backup `criar-variante.sh.bak-pre-f33` ficam (fora do repo). Memória/docs: F4 (docs-keeper).

---

## 6. Riscos (com evidência) e o que o plano faz

| # | Risco | Evidência | O que o plano faz |
|---|---|---|---|
| R1 | Com "Editar" depois do envio, o Salvar apaga ajustes da Explosão: obs. do molde, envio por tamanho, "a separar" dos aviamentos e "a enviar" dos insumos (os dois últimos voltam a consumo × grade) | `salvar_cad_completo`: `observacoes_molde = _observacoes_molde` sem COALESCE (funcoes.sql:6870-6876); apaga e re-insere `cad_aviamentos`/`cad_etiquetas` (:6779-6781); o Dev manda `null`/`{}` e as quantidades recalculadas (ModeloDetailPanel.tsx:2076-2118); a Explosão grava o "a separar" em `cad_aviamentos.quantidade_separar` (ExplosaoDetail.tsx:699/:783) e o "a enviar" em `cad_etiquetas.quantidade_enviar` (ExplosaoInsumosSection.tsx:7); o `montarCadPayload` recalcula os dois (consumo × grade total) | Paridade com o Dev (decisão F3 #7 (a)); só acontece com "Editar" (trava da F3.1); comentado em `persistirCad`; correção = tarefa própria (D4) |
| R2 | "Todo Salvar regrava o CAD" com o CAD local velho | Edição da Explosão em `cad_*` sobe só o `rev` do `cad` (`trg_colab_rev_cad`, `trg_colab_bump_cad_*`), não o de `modelos` — o canal do Sheet (em `modelos`) não a ouve | Antes do envio não há Explosão; `deveGravarCad` não grava sem toque em retry nem com recarga em curso — nem na janela "rev novo, CAD ainda velho" (`cadVelhoRef` síncrono, R1 do G-plano F3.3; §3 P5; QA S5b); com toque, a referência do CAD (inclui `metragem_enviada`) acende "Tecidos & BOM" se a recarga trouxer mudança. Depois do envio, só com "Editar" — igual ao Dev (D4). A janela que sobra é MENOR que a do Dev, que nunca ressemeia o CAD quando só o BOM muda (ModeloDetailPanel.tsx:853 antes de :865) |
| R3 | Cadeia não atômica: BOM grava e o CAD falha | UPDATE → RPC → etiquetas → RPC (usePlanejamentoSave.ts:206-223 + Task 6) | Mensagem própria condicionada a `bom.gravar` ("Os tecidos foram salvos, mas o CAD não — salve de novo antes de fechar." / "O CAD não foi salvo — salve de novo antes de fechar."), "não salvo" aceso, próximo Salvar grava os dois (§3 P6); QA S7 (a)/(c). Fechar e descartar = R11 |
| R4 | Card com CAD não se exclui | `cad.modelo_id` NO ACTION (`confdeltype='a'`, §1) + delete cru `supabase.from("modelos").delete()` (PlanejamentoDetail.tsx:870) → 23503 "em uso" (`erro-mensagem.ts:12/:40`) | D2 DECIDIDA pelo dono em 24/set ("Igual ao Dev"): nada cria CAD antes da Ordem (seção só-leitura); DEPOIS da Ordem, QUALQUER Salvar de quem edita o Desenvolvimento cria o CAD (card com ≥1 tecido no BOM) — inclusive um Salvar só de preço —, igual ao Dev (ModeloDetailPanel.tsx:2067); a partir daí o card não se exclui mais. Alcance na cópia: 13 internos têm Ordem e ainda não têm CAD |
| R5 | Linhas de CAD sem par no BOM (24 na cópia) | SELECT §1 | Regravadas como estão (paridade: linha com `id` nunca sai — `linhasParaGravar`/T4); o `UPDATE modelo_tecidos … = consumo_cad` não acha par (no-op) |
| R6 | Conflito falso por arredondamento (eco do servidor ≠ local) | folhas INTEGER e metragens NUMERIC(10,2) × o cálculo automático (4,17 folhas) | `assinaturaCad` arredonda como o banco, pelo expoente (mesmo método da F3.2 fix round 2); testes de escala e de empate em `ficha-cad.test.ts` |
| R7 | Âncoras da F3.2 ainda mudando (fix round 4 e tasks finais dela por vir) | `f32-ficha-bom` @`ebb371d` em 24/set (T12 `b18a2f1`, T13 `083ad1f`, fix round 3 `ebb371d`); o guardião conferiu 23 âncoras em `b18a2f1`; a recontagem em `ebb371d` só divergiu em `saveEmVooRef` → `saveEmVooContadorRef` (já trocado aqui). A F3.2 ainda mexe em `ficha/useFichaTecnica.ts`, `ficha/useFichaBom.ts`, `usePlanejamentoSave.ts`, `save-ficha.ts`, `ficha/ficha-calc.ts`, `PlanejamentoDetail.tsx` e `PrecoTabela.tsx` | Task 0 Step 3 conta TODAS as âncoras NA PONTA (`git show <ponta>:<arq> \| grep -cF`) na hora de começar; ruling R3a + Task 0 Step 5 (rebase quando a F3.2 fechar, com `git diff BASE <ponta>` nos arquivos da F3.3 e re-revisão); Task 13 Step 5 idem na branch principal; 6º gate `gate-f32.sh` |
| R8 | RPC de leitura nova (Ficha Técnica/Importar) barrada no QA | `PrintFicha` → `useFichaData`; `ImportarDadosDialog` → `useModeloParaCopia` | O controlador confere no `funcoes.sql` (`STABLE`, sem escrita) antes de liberar em `READ_RPCS`; nunca `servicos_financeiro` |
| R9 | Enviar à Explosão num card sem carregar / sem permissão / etapa ainda sendo calculada | gate do servidor (F1 `20260930140000:842`); em PRODUÇÃO a F1 ainda não foi aplicada — `_kanban_status_gate` não existe lá (§1 Banco) | Botão exige `ficha.podeEditar` e `gateEnvio.ok` (chave ligada sem condições ⇒ "carregando", nunca libera no escuro); tooltip diz o motivo. Sem a F1: `kanban_automatico` ausente ⇒ chave desligada ⇒ gate pelo status GRAVADO (`statusParaGate`, kanban-auto.ts:226-229), o mesmo do `enviar_modelo_para_cad` pré-F1; o front nunca chama `_kanban_status_gate` |
| R10 | Dois toasts no envio ("Modelo salvo" + "Enviado para a Explosão") | `salvarAntes` usa o `save` normal | Cosmético, aceito (T13) |
| R11 | Deriva BOM × CAD fora do alcance do P1: (a) a que JÁ vem do servidor; (b) "Descartar" depois de uma falha do CAD (BOM novo gravado, CAD velho) | Na cópia: MACACÃO CONSUELO com BOM 0 × CAD 3 (a "1 linha" do §1); `hidratarCad` semeia o CAD de `cad_*` (Dev :1079-1109) e o `salvar_cad_completo` devolve `consumo_cad` ao BOM (funcoes.sql:6878-6881) | Paridade com o Dev: o próximo Salvar SEM toque (Planejamento OU Dev) devolve ao BOM, em silêncio, o consumo do CAD. A F3.3 não piora nem corrige: (b) é mitigado pela mensagem "salve de novo antes de fechar" + a guarda de "não salvo" ao fechar; QA S7(b) documenta o comportamento. Correção = junto da tarefa de banco da F3 #7 (D4) |
| R12 | `cad_tecido_variantes.complementa_variante_ids` nunca é gravado (bug PRÉ-EXISTENTE, também no Dev) | `salvar_cad_completo` não grava o campo: 0 de 628 linhas na cópia o têm; a Explosão e a Ficha de Corte o leem (ExplosaoDetail.tsx:397, useFichaData.ts:169) | FORA do escopo da F3.3 (o `montarCadPayload` segue o payload do Dev; o `SELECT_CAD_FICHA` só lê o campo). Registrado como candidato à tarefa de banco da F3 #7 |

## 7. Decisões técnicas (o controlador decide)

- **T1** — Carga do CAD AMARRADA à do BOM (`cargaSeq`, CAD dentro do `bomFetching`, `deveHidratarCarga({cadPronto})`), em vez do efeito próprio do Dev com gates de `isFetching` (:1040-1054). Mesma proteção contra cache velho, uma regra só.
- **T2** — Toda edição do CAD marca o "tocado" da ficha (no Dev só consumo/%loss). Sem isso uma folha editada não entraria no "não salvo" nem na conferência de conflito.
- **T3** — O Importar leva consumo/%loss/artigo ao CAD (o Dev não leva: o CAD dele fica com o consumo antigo até a próxima carga e o próximo Salvar devolve o antigo ao BOM — é o mesmo buraco do P0).
- **T4** — A sincronia cria a linha do CAD de um tecido novo na hora e a propagação leva o ARTIGO (no Dev a linha ficava com o artigo antigo e as variantes do novo); linha com `id` (do servidor) nunca sai — paridade.
- **T5** — `linhasParaGravar`: linha que o servidor não tem só vai quando o BOM também grava (evita CAD com tecido que o BOM do servidor não tem — ex.: Tecido 1 pré-preenchido pela lista num card sem BOM).
- **T6** — `deveGravarCad`: "todo Salvar regrava" (decisão F3 #7), exceto: sem permissão/trava, CAD não carregado, lista vazia, D2, e — sem toque — retry do P0409 ou recarga em curso/pedida (estado possivelmente velho; "pedida" = `cadVelhoRef`, T22).
- **T7** — Referência do CAD SEPARADA da do BOM (`referenciaCadRef`), nascida da hidratação com a assinatura do SERVIDOR, "enviado" logo após o `persistirCad` (`cadGravado`) e no `aposSalvar`. Mantém o código da F3.2 intocado e cobre a falha no passo do CAD (§3 P6).
- **T8** — 2ª guarda de "não salvo" (`guardaCad`) com o MESMO "tocado"; `ficha.dirty` = BOM ou CAD; save-em-voo re-baseia as duas.
- **T9** — `assinaturaCad` na escala do banco (folhas INTEGER; metragens/folha NUMERIC(10,2); meio p/ longe do zero) e sem o que é do BOM nem o que é zero.
- **T10** — A trava interina "tem CAD" sai no MESMO commit que passa a gravar o CAD (Task 6); nenhum commit intermediário deixa editar o BOM de um card com CAD sem regravar o CAD.
- **T11** — Enviar à Explosão = `salvarAntes()` (o Salvar normal, com a guarda anti-duplo-clique) + RPC; `enviado_cad` no cache sem mexer no `rev` (o merge do colab ignora) para travar na hora.
- **T12** — Gate do botão = `gateEnvioExplosao` (espelho do SQL com a posição derivada — decisão 10); "Para enviar, falta" = pendências do Dev (fluxo interno), cada uma apontando a seção do Sheet.
- **T13** — Aceitos 2 toasts no envio (R10).
- **T14** — Menu ⋯ = `Popover` (precedente `ProdutoCard`), com "Cancelar Ordem de Criação" NEUTRO, como os demais itens, e sem confirmação (hoje é botão direto no rodapé — comportamento mantido). **Ruling R7 do G-plano F3.3 (24/set): seguir o mockup** — `gen_main.py:115` pinta o item com `color: var(--fg)`; o vermelho do plano original era desvio sem registro. Vermelho fica só no Excluir do rodapé.
- **T15** — Ficha Técnica = `PrintFicha` do Dev montado oculto, só com `enviado_cad` (Dev :3261-3265).
- **T16** — Numeração por um mapa `vis` único no orquestrador (o JSX usa os mesmos booleanos), em vez de contador CSS (não testável por texto, invisível ao leitor de tela).
- **T17** — **Ruling R7 do G-plano F3.3 (24/set): seguir o mockup.** O Dialog "Novo Modelo" numera SÓ "1. Informações Gerais do Produto" e "2. Coleção"; Tecidos, Mão de obra e Anexos ficam sem número (`gen_novo.py:13-20`; o §1 já dizia isso). O "1–5" do plano original era desvio sem registro. Regra num lugar só: `numerarSecoes(visiveis, { dialogNovo: !isEdit })` (Task 3; Task 8 Step 4). No Sheet, o mockup Main numera até 15 e a numeração é SEMPRE contínua sobre o que aparece (como o `secNum` do Dev).
- **T18** — Selos das seções do Dev reusadas (Prova, Observações, Relacionado) por componentes com a MESMA key/queryFn dos componentes (cache compartilhado sem colisão de forma).
- **T19** — "Ver no Desenvolvimento" e "Abrir no Desenvolvimento" saem (2º editor do mesmo BOM por cima do card — risco de colab consigo mesmo).
- **T20** — `salvar_cad_completo` recebe as proporções do DRAFT ENVIADO (`d.proporcoes`), não as da tela.
- **T21** — QA na cópia com a variante `:5184` (porta nova no `criar-variante.sh`, com backup) e cards escolhidos por SELECT só-leitura (ids por env) — nunca por nome (há nomes repetidos na cópia).
- **T22** — **R1 do G-plano F3.3 — `cadVelhoRef` e a escolha "NÃO grava o CAD" (em vez de "o Salvar espera").** O ref é marcado SÍNCRONO no ramo sem toque do `aoMudarNoServidor`, antes do `invalidarBom`, e zerado no `aoHidratar` do CAD e na troca de card. Enquanto está true, a captura soma o ref ao `recarregando` e o `deveGravarCad` sem toque devolve false: o Salvar segue normal e grava cabeçalho/MO, mas não regrava o CAD. Por que não "esperar com mensagem PT": (1) é a MESMA semântica já aceita para a recarga em curso (T6) — sem toque não há edição do usuário no CAD a perder, e o CAD do servidor é justamente o mais novo (o de outra pessoa); o "regravar" sem toque só serve à paridade, e o próximo Salvar a faz; (2) esperar exigiria uma espera assíncrona com prazo dentro do `mutationFn` e um estado novo de UI; (3) se o usuário tocar antes de a recarga chegar, a carga vai para o ramo R5a e o `aoHidratar` só vem depois do Salvar — o "espera" poderia prender o botão; com "não grava", o toque leva à gravação pelo `tocado`, protegida pela conferência. Código: Task 5 Step 4 (a)/(c)/(h)/(k) e Step 5 (a); prova: §3 P5; QA S5b.
- **T23** — **R2 do G-plano F3.3 — mensagem de falha do CAD condicionada a `bom.gravar`** (`enviadoRef.current?.bom.gravar` no `onError`): "Os tecidos foram salvos, mas o CAD não — salve de novo antes de fechar." só quando ESTE Salvar gravou o BOM; senão "O CAD não foi salvo — salve de novo antes de fechar.". A deriva que vem do servidor e o "Descartar" depois da falha ficam em paridade com o Dev (§3 P1 "Limite", §6 R11). Código: Task 6 Step 2(e); QA S7.
- **T24** — **R3a do G-plano F3.3 — ruling de sequência:** a F3.3 pode nascer ANTES do G-commit da F3.2, da ponta atual e commitada dela, e refaz o rebase quando a F3.2 fechar (Global Constraints; Task 0 Steps 1(b) e 5). Custo aceito e registrado em `.superpowers/f33/rebase-f32.md`: 1 rebase a mais, com conflito provável nos 7 arquivos que a F3.2 ainda mexe; recontagem das âncoras NA PONTA; gates; re-revisão das tasks já feitas cujo arquivo mudou.

## 8. Decisões para o dono (poucas)

- **D1 — (INFORMADO) O Salvar do Planejamento passa a regravar o CAD sempre que a ficha está editável** (paridade com o Desenvolvimento — decisão F3 #7). Nada muda para quem não edita o Desenvolvimento.
- **D2 — DECIDIDA pelo dono em 24/set/2026: "Igual ao Dev (Recomendado)".** Antes da Ordem de Criação o Planejamento NÃO cria o CAD (seção CAD só-leitura com o aviso). Motivo: modelo com CAD não pode mais ser excluído (FK `cad.modelo_id` NO ACTION + delete cru em PlanejamentoDetail.tsx:870; hoje 0 CAD sem Ordem). **Depois da Ordem**, o Salvar cria o CAD — igual ao Desenvolvimento hoje (ModeloDetailPanel.tsx:2067) — e a partir daí o card não se exclui mais (nem "Cancelar Ordem" desfaz). (Alternativa descartada: só criar o CAD no "Enviar à Explosão".)
  - **(INFORMADO)** QUALQUER Salvar feito depois da Ordem por quem edita o Desenvolvimento cria o CAD (card com ao menos 1 tecido no BOM), **inclusive um Salvar só de preço** — é o "todo Salvar regrava" do Dev (decisão F3 #7). Alcance: na cópia, 13 internos têm Ordem e ainda não têm CAD; o 1º Salvar de cada um no Planejamento cria o CAD dele.
- **D3 — (INFORMADO) "Ver no Desenvolvimento" some do Planejamento** (card e tabela de Preço): as seções do Desenvolvimento já estão no próprio card; abrir o outro Sheet por cima era um 2º editor do mesmo BOM. **Some também dos importados até a F3.4:** a tabela de Preço aparece para todo card que não é revenda (`!isRevenda`, PlanejamentoDetail.tsx:1066), mas o importado só ganha as seções do Desenvolvimento no próprio Sheet na F3.4 (`ficha.habilitada` exige interno) — até lá, o importado fica sem o atalho e sem as seções.
- **D4 — (INFORMADO, já decidido na F3 #7 (a)) Com "Editar" depois do envio, salvar no Planejamento desfaz os ajustes feitos na Explosão** — exatamente como o Desenvolvimento faz hoje (mesma RPC e mesmo payload, ModeloDetailPanel.tsx:2076-2118). Lista completa do que se perde ou volta ao cálculo consumo × grade:
  - a obs. do molde (apagada);
  - o envio por tamanho (volta a `{}`);
  - o "a separar" dos aviamentos (`cad_aviamentos.quantidade_separar`, gravado pela Explosão em ExplosaoDetail.tsx:699/:783);
  - o "a enviar" dos insumos (`cad_etiquetas.quantidade_enviar`, ExplosaoInsumosSection.tsx:7).

  A correção é tarefa própria (no banco, ou depois da F5).

## 9. Autorrevisão (cobertura do spec F3.3)

| Pedido | Onde |
|---|---|
| `useFichaCad` (sync BOM↔CAD, folhas automáticas) — carga :1040-1174 e propagação :2441-2456 | Task 1 (puro), Task 4 (hook), Task 5 (propagação nos 2 sentidos) |
| `CadTecidosSection` reusado SEM modificar | Task 7 Step 6(g); gate "Dev intocado" |
| Paridade do Salvar (decisão F3 #7 "CAD no Salvar regrava sempre") | Task 1 `deveGravarCad`, Task 6; QA S3/S4/E1 |
| Tirar a trava interina "BOM só-leitura em card com CAD" e PROVAR | §3 P0–P7; Task 6 Step 3; QA S1/S3/E1 |
| Enviar à Explosão com gate pela posição derivada + "Para enviar, falta" | Task 2 (`gateEnvioExplosao`, `pendenciasEnvioExplosao`), Task 9; QA S9/S9b/E3 |
| Ficha Técnica (`PrintFicha`) | Task 9 Step 7(e); QA S10 |
| Importar dados reusando `desenvolvimento/importar/` | Task 2 (`importar-ficha.ts`), Task 10; QA S11/E4 |
| Menu ⋯ (Duplicar/Importar/Ficha) §L | Task 9 (`MenuMaisAcoes`), Task 10 (Importar); QA S10 |
| Trava `enviado_cad` só nas seções do Dev (F3.1) | mantida; "Editar" destrava BOM+CAD (Task 6/7); QA S12 |
| Remover "Ver no Desenvolvimento" | Task 7 Step 8 (BomSecoes), Task 9 Steps 5/6/7(f); greps da Task 13 |
| Pós-envio: Enviar some, Salvar re-trava, "Editar" aparece | Task 9 (`onEnviado`, cache `enviado_cad`), F3.1 `aoSalvar`; QA S9/S12/E3 |
| Numeração e selos por seção (adiados da F3.1) | Task 3, Task 8; QA S1/S13 |
| QA contra a CÓPIA, variante `:5184` (case do `criar-variante.sh`), smoke só-leitura, guarda invertida | Task 12 (Step 1: 5184 com backup; spec com guarda invertida), Task 13 Step 6 |
| Decisão 8: Dev e `CadTecidosSection` intocados (cópia se precisar) | Global Constraints; nenhuma cópia necessária (componentes só-props); gate em todo commit |
| Fora de escopo: revenda/importado (F3.4), apagamento dos ajustes da Explosão | Global Constraints; D4; `ficha.habilitada` exige interno |

Checagens desta autorrevisão: (1) sem "TBD"/"implementar depois"; (2) nomes usados entre tasks conferidos — `cargaSeq`/`marcarTocado`/`aplicarConsumoDoCad`/`aplicarImportacao` (useFichaBom), `cad.linhasRef`/`propagarDoBloco`/`updateTec`/`updateVar`/`setAutoFolhas` (useFichaCad), `ficha.cad.handlers`/`seloCad`/`cadGravavel`/`cadAntesDaOrdem`/`aplicarImportacaoBom` (useFichaTecnica), `FichaSave.capturar(…, opts)`/`cadGravado`, `BomCapturado.cad` (`estado`/`linhas`/`snapshot`/`gravar`/`payload`), `salvarAntes`, `kanbanCard.explosaoEnvioStatus`, `fichaVisivel` (Task 8, usado na Task 9), `numeros`/`vis`/`seloDe`; (3) a ordem de execução do Lote A é 1 → 3 → 2 (tipo `SecaoSheetKey`).

**Ressalvas do G-plano F3.3 (guardião, 24/set) — onde cada uma entrou:**

| Ressalva | Onde no plano |
|---|---|
| R1 — janela de CAD velho (`cadVelhoRef`) | §3 P5; Task 1 (JSDoc do `deveGravarCad`, `recarregando`); Task 5 Step 4 (a)/(c)/(h)/(k) + Step 5 (a) + conferências do Step 7 + revisão (8); §6 R2; §7 T6/T22; QA S5b (Task 12) |
| R2 — falha parcial / "descartar" | §3 P1 ("Limite") e P6; Task 6 Step 2(e) (mensagem por `bom.gravar`, "salve de novo antes de fechar") + greps do Step 4 + revisão (9); §6 R3/R11; §7 T23; QA S7 (a)/(b)/(c) + helpers `fakeBomConsumo`/`fakeFalhaCad` |
| R3 — rebase e âncoras | (a) Global Constraints (ruling), Task 0 Step 1 (b), §7 T24; (b) Task 0 Step 3 (contagem na PONTA por `git show … \| grep -cF`, `ARQS_F33`/`arqs-f33.txt`), Task 0 Step 5 (re-checagem + rebase), Task 13 Step 5 (sem recontar no HEAD); (c) §1 (F3.2 @`ebb371d`), §6 R7, âncora `saveEmVooContadorRef` + código da Task 5 Step 4(c) |
| R4 — D2 | §8 D2 (DECIDIDA 24/set + INFORMADO "qualquer Salvar, inclusive só de preço"); §6 R4 |
| R5 — D4 | §8 D4 (lista completa com ExplosaoDetail.tsx:699/:783 e ExplosaoInsumosSection.tsx:7); §6 R1; comentário do `persistirCad` (Task 6 Step 1) |
| R6 — `grep -c` em BRE | Task 12 Step 1 (`grep -cF`, `*` sem escape); varredura: o único com `$` no meio do padrão era esse; os demais `grep -c` de padrão literal passaram a `-cF` por uniformidade (Tasks 5, 6, 7, 8, 9, 13 — nenhum tinha `$`/`^` no meio); os `grep -rn`/`-n` com alternância `\|` ficam em BRE de propósito (precisam dela; sem `$`/`^` no meio) |
| R7 — mockup | Task 3 (`numerarSecoes(…, { dialogNovo })` + teste); Task 8 Step 4(b)/Step 5 + revisão do Lote B; Task 9 Step 4 (`MenuMaisAcoes`: "Cancelar Ordem" neutro) + grep; §7 T14/T17; QA S13 |
| Notas | Produção sem F1 (`_kanban_status_gate` ausente ⇒ gate pelo status gravado): §1 Banco, §6 R9. D3 também tira o atalho dos importados até a F3.4: §8 D3. `complementa_variante_ids`: Global Constraints (fora de escopo), §6 R12. E1/E2 podem mover cards e gravar histórico na cópia: Task 12 Step 4 |

Nomes novos conferidos entre as tasks: `cadVelhoRef` (declarado na Task 5 Step 4(a); usado em (c), (h), (k) e Step 5(a)), `saveEmVooContadorRef` (F3.2 fix round 3; Task 0 Step 3 e Task 5 Step 4(c)), `SECOES_NUMERADAS_DIALOG_NOVO`/`{ dialogNovo }` (Task 3 → Task 8), `fakeBomConsumo`/`fakeFalhaCad` (declarados junto dos fakes da Task 12 e usados só no S7), `ARQS_F33`/`.superpowers/f33/arqs-f33.txt` (Task 0 Step 3 → Step 5 e Task 13 Step 5), `.superpowers/f33/rebase-f32.md` (Global Constraints, Task 0 Steps 1/5, §7 T24).
