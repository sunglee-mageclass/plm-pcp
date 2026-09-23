# Planejamento unificado — F3.2: BOM do Desenvolvimento no Sheet do Planejamento de Produto — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O Sheet do Planejamento de Produto passa a ter o BOM do Desenvolvimento (Tecidos/Forros/Entretelas, Aviamentos, Insumos, Grade e os custos do BOM), gravando nas MESMAS tabelas do Dev pelo MESMO caminho (`salvar_modelo_bom` + `modelo_etiquetas`), com colaboração (rev + conflito de seção "Tecidos & BOM"), e o "Tecido Planejado" deixa de ser seção (a lista `tecidos_planejados` vira DERIVADA dos blocos).

**Architecture:** A orquestração do `PanelContent` do Dev é PORTADA (cópia, Dev intocado) para `src/components/planejamento/planejamento-detail/ficha/`: `ficha-calc.ts` (puro, testado) + `useFichaDados` (queries com chaves próprias `plan-ficha-*`) + `useFichaBom` (estado, carga, handlers) + `useFichaGuarda` ("não salvo" do BOM) + `useFichaTecnica` (orquestrador que expõe 3 superfícies: seções, colab e `save`). O Salvar do Planejamento (`usePlanejamentoSave.ts`) ganha a cadeia UPDATE `modelos` (rev) → `salvar_modelo_bom(_rev_base:null)` → etiquetas → MO → `marcar_revisao_por_mudanca`, grava o BOM só quando CARREGADO E SUJO, e corrige o bug do retry do P0409 (mesma receita do `2419d0f`). As seções reusam os componentes só-props do Dev sem modificá-los; o de Tecidos é uma CÓPIA local (decisão F3 #10: preço/m + estoque no seletor).

**Tech Stack:** Vite + React 19.2 + TypeScript (strict, `noUnusedLocals:false`) + TanStack Query v5 + supabase-js. Testes: Vitest (`tests/unit`, ambiente node) e Playwright (QA com guarda de rede, arquivo NÃO versionado).

**Spec:** `/Users/sunglee/.claude/plans/h-uma-necessidade-de-flickering-lovelace.md` — seção **F3.2**, "10 decisões de F3 APROVADAS" (#2, #4, #6, #7, #9, #10 aqui), "Tecidos: uma seção só = o BOM", G-mockup R3/R5, riscos ("reserva de estoque…", "`tecidos_planejados` derivado inclui substitutos…", "Duas telas no mesmo BOM…"), "ANTES da F3 ir para produção: snapshot…" (G-inicial #7). Contexto comum: `.superpowers/sdd/2026-09-22-unificacao-kanban-auto/planner-context-f3.md`. Mockup aprovado (quadros Anotado/Prova/NovoModelo): `…/scratchpad/canvas-unif/gen_anotado.py:80-201`, `gen_prova.py:26-38`, `gen_novo.py`.

## Global Constraints

**Repositório, worktree e ordem das fases**
- Worktree própria: `/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f32-ficha-bom`, branch `f32/ficha-bom`, **criada da PONTA do branch `f31/planejamento-campos` DEPOIS do G-commit da F3.1** (ou da F3.1a, se a F3.1 for em 2 partes) — N4 do re-check do guardião: NÃO do merge, que espera a Task 9 da F3.1 e, com ela, a F1 em produção. O sha de nascimento fica em `.superpowers/f32/BASE`. **A F3.2 continua escrevendo por cima do texto FINAL da F3.1 (R8 do G-plano conjunto — o intuito fica): não corre em paralelo às Tasks 0–8 da F3.1 nem faz rebase sobre elas** (âncoras na Task 0 Step 3). Caminhos relativos neste plano = raiz da worktree.
- Ordem de merge da campanha: F3.0 → F2 (telas do kanban) e F3.1 (campos simples + selo no header; a F3.1 consome `EtapaKanbanBadge`/`kanban_mover` da F2) → **F3.2** → F3.3 → F3.4. A F3.2 NÃO consome nada da F2 nem da F1. **A F3.2 junta SEMPRE depois da F3.1** (carrega os commits da F3.1, que gravam `descricao_produto` — sem a coluna em produção, PGRST204 em todo Salvar), com `git rebase --onto feature/plan-tecido-a1 "$(cat .superpowers/f32/BASE)" f32/ficha-bom` (Task 16 Step 5): reaplica SÓ os commits da F3.2 — vale se a F3.1 juntou por ff puro, se foi rebaseada antes do merge, ou se ganhou commits depois do BASE (fix do smoke, F3.1b). Se a F3.1 for em 2 partes, a F3.1b (Task 8 dela, selo) pode juntar antes ou depois da F3.2 — as duas mexem em pontos diferentes do `PlanejamentoDetail.tsx`; quem juntar por ÚLTIMO faz rebase, roda os gates e o próprio QA.
- Merge de volta só por fast-forward, com o dono avisado para salvar e fechar os cards do Planejamento/Desenvolvimento antes (o Fast Refresh remonta o Sheet aberto).
- `git add -- <paths>` + `git commit --only -m "…" -- <paths>`; nunca `git add .`. Toda mensagem termina com `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Sem push.
- `src/routeTree.gen.ts` é gerado pelo build/vite: nunca entra em commit (`git checkout -- src/routeTree.gen.ts` depois do build, se mudou).

**Intocáveis (decisão travada 8 e escopo)**
- NADA em `src/components/desenvolvimento/**` nem em `src/components/producao/cad/CadTecidosSection.tsx`. Importar deles (sem editar) é permitido.
- NADA em `src/lib/kanban-condicoes.ts` (catálogo/`CondicaoSecao` — decisão 8), `src/lib/artigo-label.ts` (afeta Dev e OC Tecido), `supabase/**`, `tests/integration/**`, `tests/fixtures/**`.
- Sem migration e sem DDL próprios. Leitura de banco só: SELECT na cópia local `postgresql://postgres:postgres@127.0.0.1:54422/postgres` (planejamento + escolha/conferência de cards no QA, sempre `BEGIN READ ONLY`) e o snapshot só-leitura da Task 14 (produção, `default_transaction_read_only=on`). A ÚNICA DDL que o QA toca é a coluna da F3.1 NA CÓPIA, pelo `copia-qa.sh` da F3.1 (Task 15 Step 1).
- Fora de escopo (NÃO fazer): campos simples do Dev, Descrição, selo da etapa (F3.1); CAD, sync BOM↔CAD, folhas automáticas, Enviar à Explosão, Ficha Técnica, botão/diálogo Importar, menu ⋯, remover "Ver no Desenvolvimento" (F3.3); revenda/importado com grade única e visibilidade por `revendaCampoVisivel` (F3.4).

**Regras de gravação (o coração da F3.2)**
- Toda escrita de BOM do Sheet novo passa por `salvar_modelo_bom` (guarda snapshot em `modelo_bom_snapshots` antes de apagar — `funcoes.sql:7603`); etiquetas por diff de id em `modelo_etiquetas` (mesmo caminho do Dev, `ModeloDetailPanel.tsx:2038-2060`).
- O BOM só é gravado quando **carregado E sujo** (tocado pelo usuário E diferente do baseline). `salvar_modelo_bom` APAGA e re-insere tudo (`funcoes.sql:7605-7609`): gravar com estado vazio/velho apagaria o BOM.
- `gravarTecidosIniciais` (salvar_modelo_bom com Tecido 1..N) só é chamado com um modelo **recém-criado** (Dialog "Novo Modelo" e Duplicar).
- A etapa (`status_desenvolvimento`) NUNCA vai no Salvar (decisão travada 13) — o Draft não tem essa chave.
- Sem `canEdit("criacao_desenvolvimento")` o Salvar omite as colunas do Dev (`proporcoes`, `custos_adicionais`, custos derivados, `tecidos_planejados`) e não grava BOM (decisão F3 #8).

**Gates (todo commit)**
- `npx tsc --noEmit` → 0 erro (o `npm run build` NÃO faz type-check).
- `npm run build` → ok (e `git checkout -- src/routeTree.gen.ts` se mudou).
- `env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit` → tudo verde, exceto as falhas HERDADAS registradas na Task 0 (mesma lista, mesma contagem).
- Dev intocado: `git diff --name-only savepoint-pre-unificacao-2026-09-22 -- src/components/desenvolvimento/ src/components/producao/cad/CadTecidosSection.tsx` → saída VAZIA.
- **F3.1 preservada** (R1 do G-plano conjunto — `onCreated` e `aoSalvar` são opcionais/funções: se sumirem, o `tsc` NÃO acusa e voltam o card duplicado e a falta de re-trava): `bash .superpowers/f32/gate-f31.sh` (criado na Task 0 Step 4b). **Sai com código 1 quando falha** (NOTA do re-check do guardião: antes só imprimia) — gate falhou = PARE, não commitar.
  Esperado: `F3.1 preservada: ok` e código 0 em TODO commit (5º gate).
- `tests/integration/*` PROIBIDO aqui (cairia em `/tmp/dburl.txt` = PRODUÇÃO).

**QA — CONTRA A CÓPIA (N2 do re-check do guardião + ruling do controlador; o MESMO modo da F3.1)**
- O QA (Task 15) roda num **app de teste PRÓPRIO da worktree**: variante do `banco-local/app-teste` gerada pelo `criar-variante.sh` que a F3.1 criou (F3.1 Task 10 Step 3), em `http://localhost:5186`, sobre a CÓPIA LOCAL (Supabase `127.0.0.1:54321`), com porta, PID, log, `cacheDir`, `envDir` e wrangler próprios e a MESMA guarda que aborta a subida se qualquer URL não for local (+ raiz = a worktree). **NUNCA o `:5188`** (serve o checkout PRINCIPAL do dono). **NUNCA `npm run dev` + `VITE_*`**: o `@cloudflare/vite-plugin` lê o `.env` da pasta do wrangler (a worktree) e as server functions iriam a PRODUÇÃO com a service role.
- **Guarda de rede INVERTIDA na cópia:** gravação liberada SÓ para `127.0.0.1:54321`; QUALQUER requisição a `*.supabase.co` (GET inclusive) reprova. O spec automático segue com as escritas simuladas (cenários determinísticos, inclusive o S5d do R5a); os fluxos que GRAVAM de verdade (BOM real por `salvar_modelo_bom`, P0409 real, Realtime "Tecidos & BOM" entre 2 abas, Dev ↔ Planejamento, card novo com Tecido 1..N, Duplicar) rodam na cópia, um por vez, pelo controlador, mostrando cada passo ao dono (dono avisado antes de cada um — a cópia é o app de teste dele).
- **A coluna `descricao_produto` tem de estar NA CÓPIA** durante o QA (a F3.2 carrega a F3.1, cujo Salvar grava a coluna): entra/sai pelo `copia-qa.sh` da F3.1 (`aplica_v2 $LOCAL`, backup `pg_dump -Fc` antes; sai antes de qualquer re-ensaio da F1 — a referência de fidelidade da F1 é da cópia sem ela). Depois do merge da F3.1 ela fica na cópia (F3.1 Task 11 Step 5b). A F1 na cópia só é aplicada pelo controlador, na hora do teste do dono.
- **Produção:** só o snapshot só-leitura (Task 14) e o smoke SÓ-LEITURA pós-merge no `:5173` (Task 16 Step 6), com a guarda de sempre: toda escrita simulada (`route.fulfill`) ou barrada (violação); exceção inerente: metadado de sessão do login.
- **Barradas esperadas (R4 do G-plano conjunto — as MESMAS da F3.1):** `POST /rest/v1/rpc/servicos_financeiro` (a Home chama no login; é DEFINER VOLATILE que sincroniza `parcelas_servico` — `funcoes.sql:16568`, `HomeLogado.tsx:135`) e o broadcast REST do Realtime (`POST /realtime/v1/api/broadcast`) seguem BARRADOS no spec automático, mas não reprovam. `servicos_financeiro` é PROIBIDO em `READ_RPCS` (liberar = gravar em PRODUÇÃO — invariante #1); o spec lança erro se alguém o puser lá.
- `E2E_BASE_URL`, `VITE_SUPABASE_URL` e `F32_ALVO` (`copia` → `http://localhost:5186` + `http://127.0.0.1:54321`; `producao` → `http://localhost:5173` + `*.supabase.co`) SEMPRE explícitos; sem eles o spec FALHA (não "pula") — sem fallback de host (NOTA do re-check: fallback = guarda aberta).
- Portas: F3.2 = `:5186` (F3.1 = `:5187`); `:5188`, `:5173`, `:5198`/`:5199` nunca. Porta ocupada ⇒ PARAR (nunca matar nada); derrubar SÓ pelo `descer.sh` da variante (confere o PID). NUNCA matar o vite do dono (`:5173`) nem o app de teste dele (`:5188`).
- Login na cópia: a senha do usuário de teste já confere (opção A de APP-TESTE-LOCAL.md §3, 23/set). Storage NÃO funciona na cópia (fotos quebradas) — a F3.2 não depende dele.
- O robô NÃO troca de loja: toda leitura de `tenant_config` tem de ser da Loja Teste — conferida pelo **tenant_id `37889b78-fffb-404b-8c75-18b7e50a1d9b`** (como a F3.1), não pelo rótulo da tela; senão o QA falha.
- Nunca rodar o QA da F3.2 junto com o E2E da F2 nem com o QA da F3.1/F3.1b (mesmo usuário; presença e Realtime agora REAIS na cópia).

**UI (padrões §A/§G/§Q)**
- Seções vindas do Dev: SEMPRE visíveis (independente da etapa) para `canView("criacao_desenvolvimento")`, recolhidas por padrão, editáveis com `canEdit("criacao_desenvolvimento")` (decisões 6 e F3 #8). Só produto interno na F3.2 (comprado = F3.4; decisão F3 #4).
- Componentes novos no nível do MÓDULO (nunca declarar componente dentro de componente). Sem hex/oklch/hsl solto, sem `.toFixed(`, moeda só por `brl()` (anti-drift `tests/unit/ui-padroes-antidrift.test.ts`).
- Textos visíveis em PT-BR; erros por `mensagemErro()`.

**Modelos e comunicação**
- Sonnet implementa; Opus revisa (lotes e individuais marcados em §4). Avisos ao dono por CHAT (sem `ExitPlanMode`).

---

## 1. Fatos verificados (23/set/2026, só leitura)

**Faixas do `PanelContent` do Dev (spec × arquivo real).** Blob `src/components/desenvolvimento/ModeloDetailPanel.tsx` = `fb5c34b3…`, 3300 linhas, IGUAL no checkout principal e na worktree da F3.0 (`git hash-object`). As faixas do spec conferem; o detalhe:

| Spec | Real | O quê | F3.2 porta? |
|---|---|---|---|
| carga ~870-1174 | 870-946 | hidratação dos blocos (Tecido/Forro/Entretela, variantes, OC-links, substitutos) + pré-preenchimento de `tecidos_planejados` em **935-944 SEM a guarda de BOM vazio** (G-mockup R5) | sim (com a guarda) |
| | 948-957 / 959-974 | aviamentos + recálculo de custo quando o preço chega | sim |
| | 976-984 / 986-1008 | etiquetas (insumos) + recálculo | sim |
| | 1010-1027 | recálculo do custo dos blocos (preços/OC congelada chegam depois) | sim |
| | 1029-1038 | grade | sim |
| | 1040-1174 | semeadura do CAD | NÃO (F3.3) |
| handlers ~2435-2652 | 2435-2492 | `updateBlock` (troca do Tecido 1 → "Apagar grade preenchida?"; substituto removido descarta variantes órfãs) — **2441-2456 = propagação BOM→CAD** | sim, sem 2441-2456 (F3.3) |
| | 2493-2547 | `updateBlockVariante` (remover variante com grade: confirma e renumera; trocar variante zera OC e casamento) | sim |
| | 2548-2581 | OC-links, aviamentos, etiquetas | sim |
| | 2583-2652 | grade total/célula, proporção, "cálculo automático" | sim (+ `marcarTocado` no toggle — lacuna do Dev) |
| totais ~1388-1401 | 1388-1401 | Custo de 1 Peça | sim (`totaisBom`) |
| herança ~1452-1468 | 1452-1468 | variante nova herda a grade da 1ª | sim (`herdarGrades`) |
| guarda ~1706-1751 | 1679-1751 (+1753-1764 `dirty`) | re-baseline do "não salvo" por `seedSettled` + estabilidade em 2 renders | substituída por regra equivalente mais simples (Task 6) |
| — | 808-868 | merge 3-vias + conflito de seção quando coleções tocadas (843) | sim (no merge do Planejamento) |
| — | 1813-1842 | resolução "Tecidos & BOM" | sim |
| — | 1848-2151 / 2153-2320 | `persistModelo` / onSuccess / onError | sim (sem CAD 2062-2119) |

**O Salvar do Planejamento hoje (worktree F3.0, HEAD `7f6b871`, `planejamento-detail/usePlanejamentoSave.ts`)**
- Bug do retry do P0409: o `mutationFn` monta o payload com `...draft` da CLOSURE (`:73`); o `onError` faz `setDraft(md.valor)` (`:341`) e chama `save.mutate()` (`:352`) sem re-render — o retry leva o draft ANTERIOR e desfaz em silêncio os campos que o outro usuário mudou. O Dev já corrigiu (`2419d0f`: payload lê `draftLiveRef` + espelho síncrono `ModeloDetailPanel.tsx:2294-2298`).
- Mesmo commit, 2º defeito ainda presente no Planejamento: o `onSuccess` faz `markClean()` do estado ao vivo (`:268`), `baseRef = { draft }` e `touchedRef = new Set()` (`:273-274`) e `setMoLinhasBase(moLinhas)` (`:280`) — tecla digitada durante o voo do save vira "salva" (selo apaga, eco reverte).
- `syncTecidosToDesenvolvimento` (`sync-tecidos.ts:13-53`) é chamado em `:162` (edição) e `:168` (card novo); cria `modelo_tecidos` numero 1..N para TODO item da lista — acima de 3 o Dev não mostra (`makeEmptyBlocks` só cria 1..3, `modelo-detail/types.ts:73-93`).

**Banco (snapshot `savepoints/2026-09-22-pre-unificacao/funcoes.sql`; cópia local :54422)**
- `salvar_modelo_bom` só checa o módulo `criacao` (`funcoes.sql:15683-15691`) — **não** checa `criacao_desenvolvimento`; o front precisa esconder/omitir.
- `_salvar_modelo_bom_core`: snapshot (`:7603`) → DELETE de variantes/OC-links/tecidos/aviamentos/grades (`:7605-7609`) → re-INSERT.
- `_salvar_cad_completo_core` devolve `cad_tecidos.consumo_cad` para `modelo_tecidos.consumo` (`:6878-6881`): editar consumo no Planejamento SEM regravar o CAD seria revertido pelo próximo Salvar do Dev (base da trava interina, Task 7).
- Reserva de estoque (`_estoque_tecido_core`, CTE `reserva_mod` `:2655-2675`): conta variantes × grade de TODO modelo não reprovado e sem corte enviado — **não olha `ordem_criacao_enviada`**.
- Leitores de `tecidos_planejados`: condição `tecido_planejado` (`:381`); `_plan_tecido_gravar_bom_core` regrava SEM substitutos (`:4605-4609`); front `criacao.planejamento.tsx:820-839` (agrupamento por tecido/categoria de tecido, multi-pertencimento) e `plan-tecido/EditarMixDialog.tsx:108` (1º tecido).
- RPCs de leitura usadas pela ficha são `STABLE`: `avaliar_condicoes_kanban`, `precos_tecido_congelado`, `ocs_disponiveis_variante`, `modelo_etapas_afetadas`.

**Quantificação na cópia local (271 modelos, criada 23/set 14:37)**
- `tecidos_planejados` × lista derivada do BOM (fórmula do Dev `ModeloDetailPanel.tsx:1937-1948`): 201 iguais; 69 sem BOM e sem lista (57 revenda); **1 muda** (Ave Rara "VESTIDO ELIANE" ganharia o substituto "TULE POLY POWER MESH"); 0 "sem BOM com lista". 16 modelos usam substituto no Tecido — 15 já têm o substituto na lista (o Dev deriva a cada save).
- R5 (Tecido N fantasma pelo pré-preenchimento sem guarda): **6 modelos** (5 Ave Rara + 1 Loja Teste) abrem hoje no Dev com um bloco fantasma. A cópia da F3.2 aplica a guarda; o Dev fica como está (decisão 8).
- Reserva antes da Ordem de Criação: 1 card interno com variantes+grade sem Ordem (Loja Teste "Vestal", dado de teste); 2 revendas com grade e sem variante (não reservam).
- CAD (SELECT só-leitura na cópia local, reconferido no G-plano conjunto R3): 214 cards internos + 57 revenda; **193 dos 214 internos (90%) têm CAD**; desses, **136 têm `enviado_cad = false`** (o CAD nasceu no Salvar do Desenvolvimento — `ModeloDetailPanel.tsx:2062-2067` cria o CAD sozinho quando há tecido com variante — e o Dev deixa editá-los: a trava do Dev é só `enviado_cad`, `:1600`) e 57 já foram enviados à Explosão; 0 enviados sem CAD (enviado ⇒ tem CAD); **21 internos sem CAD**; revenda: 0 com CAD.
- Loja Teste tem cards internos com BOM e SEM CAD ("Vestal" sem Ordem, "Vestido Teste", "Blusa Teste") e COM CAD — o QA escolhe dinamicamente.

## 2. Interfaces entre fases

**Consumidas da F3.1 (a F3.2 nasce da ponta de `f31/planejamento-campos` depois do G-commit dela — R8 + N4; a F3.1 junta ANTES; nomes e textos FINAIS exigidos, conferidos na Task 0 Step 3)**
- `Draft`/`emptyDraft`/`draftFromModeloRow` (`src/components/planejamento/modelo-shared.ts`) já com os campos simples do Dev (modelista, pilotos 1-3 + datas, desenho técnico, aprovação, obs. técnicas, motivo de cancelamento, ficha de medida) e a `descricao_produto`, nessa ordem, depois de `custo_simulado`. A F3.2 acrescenta `proporcoes`/`custos_adicionais` DEPOIS de `descricao_produto` (F3.1 §3 item 1). A F3.1 **NÃO** acrescenta essas 2 ao Draft; a Task 0 confere (se já existirem, a Task 1 pula o Step correspondente).
- `helpers.ts`: **`CAMPOS_DEV_DRAFT` é a lista ÚNICA** de chaves do Draft que são do Dev (F3.1 §3 item 2 — "Unificar" do G-plano conjunto). A F3.2 acrescenta `"proporcoes", "custos_adicionais"` a ela (Task 1) e CONSOME `aplicarRegrasCamposDev` (sem permissão do Dev, as chaves saem do payload) e `camposParaDuplicar` (Duplicar não leva o Dev, decisão F3 #9) — não cria lista própria.
- Card novo (F3.1 Task 7): depois do INSERT o detalhe REMONTA como o Sheet do id criado (`onCreated(id)` — fix da duplicação). Texto final em `usePlanejamentoSave.ts`: `if (criadoIdRef.current) { savedId = criadoIdRef.current; } else { … criadoIdRef.current = savedId; }` seguido de `if (savedId) await syncTecidosToDesenvolvimento(savedId, draft.tecidos_planejados);`. A F3.2 põe o `gravarTecidosIniciais` **DENTRO do `else`, logo depois de `criadoIdRef.current = savedId;`** (só com o id que ESTE INSERT criou) e apaga a linha do sync (Task 10 Step 7). `onCreated` (fim do `onSuccess` e ramo "card criado" no começo do `onError`) e `onSaved: aoSalvar` (re-trava) ficam — 5º gate "F3.1 preservada" + QA S6 (Dialog → Sheet com 1 POST).
- Trava ÚNICA (R2): o orquestrador da F3.1 declara, logo depois de `const podeVerDev = …`, a query `["modelo", modeloId]` e `enviadoCad`/`editandoDev`/`devBloqueado`/`motivoTravaDev` (`MotivoTravaDev` = `"enviado" | "sem_permissao" | null`, de `ficha/secoes/AvisoCamposDev.tsx`, que já considera o "Editar"). A F3.2 passa `travaDev: motivoTravaDev` ao `useFichaTecnica` e DERIVA dela o `motivoSomenteLeitura` (Task 7); o aviso "sem permissão" reusa `<AvisoCamposDev motivo="sem_permissao" />` e o "enviado" segue o texto da F3.1 (Task 9).
- JSX (F3.1 Task 6): o comentário-âncora `{/* ↓ F3.2: as seções do BOM … entram AQUI,` (2 linhas) fica entre "Ajustes na Prova" e o bloco `{/* F3.1 — "Tecido Planejado" SUBIU para cá …` + `{/* SETOR 4 — Tecido Planejado …`, que vem ANTES do `{/* SETOR 3 — Preço …` (ordem do mockup). A F3.2 troca o comentário-âncora pelas seções do BOM (Task 11 Step 6) e o bloco "Tecido Planejado" pela seção "Tecidos" do Dialog NO MESMO LUGAR (Task 11 Step 7) — o Dialog fica Info → Coleção → Tecidos → Mão de obra → Anexos (`gen_novo.py`).
- `ROTULO_CONFLITO_PLAN` (`planejamento-detail/helpers.ts`) ganhou os rótulos da F3.1 (o último par é `ficha_medida_url: "Ficha de Medida", descricao_produto: "Descrição do produto",`); a F3.2 acrescenta 1 linha depois dele e o caso `secao:bom`.
- A omissão dos campos da F3.1 sem permissão do Dev é mecanismo da F3.1; a F3.2 cuida das SUAS colunas pela MESMA lista (`CAMPOS_DEV_DRAFT`) e, para as travas que não são de permissão (ficha não carregada, "tem CAD", "enviado"), pelo `aplicarColunasFicha` (`save-ficha.ts`).
- Âncoras: a Task 0 Step 3 lista os textos FINAIS da F3.1 que precisam existir 1×; qualquer contagem ≠ 1 = PARE e reporte ao controlador (a F3.2 não adapta texto da F3.1 por conta própria).

**Produzidas para a F3.3 (CAD + ações) e F3.4 (comprado)**
- `useFichaTecnica(...)` → `FichaTecnica` com `estado` (`EstadoBom`), `handlers`, `dados` (catálogos, `tamanhos`, `tenantCfg`), `colab`, `save` (`FichaSave`), `camposCopiados`/`onCampoEditado`/`marcarCopiados` (destaque do Importar — o diálogo é da F3.3), `motivoSomenteLeitura`.
- `SecaoBom` com `data-secao={id}` e `open`/`onOpenChange` controláveis (links "Para enviar, falta" da F3.3).
- Pontos que a F3.3 edita: `useFichaBom.updateBlock` (reintroduz a propagação BOM→CAD do Dev `:2441-2456`); `useFichaTecnica.motivoSomenteLeitura` (tira a trava interina "tem CAD" — o "enviado" e o "Editar" já vêm da trava única da F3.1, decisão F3 #1); `usePlanejamentoSave` (acrescenta `salvar_cad_completo` entre etiquetas e MO — decisão F3 #7).
- Pontos da F3.4: `useFichaTecnica.habilitada` (hoje `!isComprado`) passa a consultar `revendaCampoVisivel`.

## 3. Mapa de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `src/components/planejamento/modelo-shared.ts` | modificar | Draft ganha `proporcoes`, `custos_adicionais` |
| `src/components/planejamento/planejamento-detail/helpers.ts` | modificar | rótulos `proporcoes`/`custos_adicionais`/`secao:bom`; `proporcoes`/`custos_adicionais` entram na lista ÚNICA `CAMPOS_DEV_DRAFT` (da F3.1) |
| `src/components/planejamento/planejamento-detail/ficha/ficha-calc.ts` | criar | contas puras do BOM (carga, herança, totais, payloads, etiquetas, derivação) + `estadoBomDoServidor`/`assinaturaBom`/`bomDivergeDaReferencia` (R5: o BOM do servidor mudou de verdade?) |
| `src/components/planejamento/planejamento-detail/ficha/selos-bom.ts` | criar | MAPA PRÓPRIO seção→condições + selo (decisão 8) |
| `src/components/planejamento/planejamento-detail/custo-base.ts` | criar | custo-base do markup (decisão F3 #6) |
| `src/components/planejamento/planejamento-detail/save-ficha.ts` | criar | regras puras do payload/rebase/retry do Salvar (o Duplicar usa o `camposParaDuplicar` da F3.1 — sem lista própria) |
| `src/components/planejamento/planejamento-detail/ficha/useFichaDados.ts` | criar | queries `plan-ficha-*` |
| `src/components/planejamento/planejamento-detail/ficha/useFichaGuarda.ts` | criar | "não salvo" do BOM |
| `src/components/planejamento/planejamento-detail/ficha/useFichaBom.ts` | criar | estado + carga + handlers |
| `src/components/planejamento/planejamento-detail/ficha/useFichaTecnica.ts` | criar | orquestrador (seções/colab/save); trava ÚNICA derivada da F3.1 (R2); conflito "Tecidos & BOM" só com o BOM do servidor mudado (R5) |
| `src/components/planejamento/planejamento-detail/ficha/persistir-bom.ts` | criar | gravações (`salvar_modelo_bom`, etiquetas, Tecido 1..N inicial) |
| `src/components/planejamento/planejamento-detail/ficha/TecidosBomSecao.tsx` | criar (CÓPIA) | `ModeloTecidosSection` + preço/m + estoque (decisão F3 #10) |
| `src/components/planejamento/planejamento-detail/ficha/secoes/SecaoBom.tsx` | criar | cabeçalho de seção com chip "do Desenvolvimento" + selo |
| `src/components/planejamento/planejamento-detail/ficha/secoes/BomSecoes.tsx` | criar | render das 4 seções + "Apagar grade preenchida?" + avisos alinhados à F3.1 (R2) |
| `src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts` | modificar | cadeia de gravação + fixes P0409/em-voo |
| `src/components/planejamento/planejamento-detail/PrecoTabela.tsx` | modificar | selo 3 estados + custo-base + linhas "Custos do BOM" (Tecido/Forro/Entretela/Aviamento/Insumos) e custos adicionais DENTRO da tabela (mockup, R9c) |
| `src/components/planejamento/planejamento-detail/campos.tsx` | modificar | `MultiArtigosField` ganha `max` |
| `src/components/planejamento/PlanejamentoDetail.tsx` | modificar | fiação (ficha com a trava da F3.1, merge, banner, seções no lugar da âncora, "Tecidos" do Dialog no lugar do "Tecido Planejado", Preço e Custos, Duplicar) |
| `src/components/planejamento/planejamento-detail/sync-tecidos.ts` | APAGAR | substituído pelo BOM |
| `tests/unit/ficha-calc.test.ts`, `ficha-selos-bom.test.ts`, `planejamento-save-ficha.test.ts`, `planejamento-custo-base.test.ts` | criar | testes puros |
| `tests/unit/planejamento-detail-helpers.test.ts` | modificar | rótulos novos |
| `tests/e2e/f32-qa.spec.ts` | criar (NÃO versionar) | QA na CÓPIA (guarda invertida; escritas simuladas) + fluxos que GRAVAM na cópia (E1–E6) + smoke só-leitura em produção — inclui save-em-voo com PATCH atrasado (R6), eco próprio × BOM alheio (R5), toque antes do refetch (R5a, S5d), Dialog → Sheet com 1 POST (R1) e trava única (R2) |
| `.superpowers/f32/gate-f31.sh` (fora do git) | criar | 5º gate "F3.1 preservada" — sai 1 se falhar |

## 4. Revisão (política SDD)

| Task | Revisão |
|---|---|
| 1, 2, 3 | **Lote A** — 1 revisão Opus para as 3 (Draft + puros + testes) |
| 5, 8, 9 | **Lote B** — 1 revisão Opus para as 3 (queries, cópia do componente, render) |
| 4 + 10 | **Individual Opus** (Salvar/colab: regras do payload + cadeia de gravação + fixes P0409/em-voo) |
| 6 | **Individual Opus** (estado/carga/"não salvo" — colab e estoque) |
| 7 | **Individual Opus** (orquestrador + gravações `salvar_modelo_bom`) |
| 11 | **Individual Opus** (merge colab, conflito de seção, remoção do sync) |
| 12 | **Individual Opus** (custo-base do markup/preço exibido) |
| 13 | **Individual Opus** (Duplicar grava BOM) |
| 14, 15, 16 | controlador + guardião (snapshot, QA, G-commit/G-fase, merge) |

Cada revisão usa o checklist do `code-reviewer` + o do guardião (G-commit): tenant, invariantes, queryKeys (config com "tenant"), invalidações, `canEdit("criacao_desenvolvimento")` nas seções do Dev, guarda de não-salvo, rev/P0409, "BOM só grava carregado E sujo", Dev intocado.

---

## Task 0: Pré-voo (sem commit)

**Files:** nenhum (só leitura + worktree).

- [ ] **Step 1: Criar a worktree da PONTA de `f31/planejamento-campos`, depois do G-commit da F3.1 (N4)**

Pré-condição: o diário do guardião (`.superpowers/sdd/2026-09-22-unificacao-kanban-auto/guardiao.md`) tem o **G-commit da F3.1 (ou F3.1a) APROVADO** e o controlador da F3.1 passou o sha da ponta (F3.1 Task 11 Step 3b). Sem isso: PARE. A F3.2 NÃO espera o merge da F3.1 (que espera a Task 9 dela e, com ela, a F1 em produção).

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp"
PONTA="<sha passado pelo controlador da F3.1 no Step 3b dela>"
git rev-parse --verify "$PONTA^{commit}" && git merge-base --is-ancestor "$PONTA" f31/planejamento-campos && echo "ponta da F3.1: ok"
git -C .claude/worktrees/f31-planejamento-campos status --porcelain -- src supabase tests/unit tests/integration; echo "f31-limpa-checada"
git log --oneline -12 "$PONTA"
git worktree add ".claude/worktrees/f32-ficha-bom" -b f32/ficha-bom "$PONTA"
cd ".claude/worktrees/f32-ficha-bom"
mkdir -p .superpowers/f32
git rev-parse HEAD > .superpowers/f32/BASE
cp "/Users/sunglee/PLM + Criação/plm-pcp/.env" .env
npm ci --silent
```

Expected: `ponta da F3.1: ok`; só `f31-limpa-checada` (nada fora de commit na worktree da F3.1 — o que não foi commitado não vem); os commits `F3.1 (…)` no topo do log; worktree criada; `.superpowers/f32/BASE` = `$PONTA` (é a referência do `rebase --onto` da Task 16 Step 5 — não apagar). A worktree da F3.1 NÃO é tocada (só lida).

- [ ] **Step 2: Conferir que a F3.0 e a F3.1 estão no HEAD**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f32-ficha-bom"
test -f src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts && echo "F3.0 ok"
ls src/components/planejamento/planejamento-detail/ficha/ 2>/dev/null && echo "pasta ficha/ (F3.1) presente"
grep -n "onCreated" src/components/planejamento/PlanejamentoDetail.tsx | head -3
grep -n "proporcoes\|custos_adicionais" src/components/planejamento/modelo-shared.ts
test -f supabase/migrations/20260930180000_modelo_descricao_produto.sql && echo "migration da F3.1 presente (a coluna vai para a cópia no QA — Task 15)"
```

Expected: "F3.0 ok"; `onCreated` presente (F3.1 ou F3.1a); o último grep de `proporcoes` SEM saída (se tiver saída, anotar "F3.1 já trouxe proporcoes/custos_adicionais" e pular o Step 1 da Task 1); a migration presente.
Se `usePlanejamentoSave.ts` não existir ou `onCreated` não aparecer: PARE — a F3.2 só nasce DEPOIS do G-commit da F3.1/F3.1a (R8 + N4).

- [ ] **Step 3: Conferir as âncoras de texto (texto FINAL da F3.1) usadas nas Tasks 1, 10-13**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f32-ficha-bom"
S=src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts
P=src/components/planejamento/PlanejamentoDetail.tsx
M=src/components/planejamento/modelo-shared.ts
H=src/components/planejamento/planejamento-detail/helpers.ts
for a in 'import { useRef, type Dispatch, type RefObject, type SetStateAction } from "react";' \
         'import { mergeDraft, type Conflito } from "@/lib/colab/merge";' \
         'import { syncTecidosToDesenvolvimento }' \
         'let savedId: string | null = isEdit ? modeloId : null;' \
         'await syncTecidosToDesenvolvimento(modeloId, draft.tecidos_planejados);' \
         'criadoIdRef.current = savedId;' \
         'if (savedId) await syncTecidosToDesenvolvimento(savedId, draft.tecidos_planejados);' \
         'if (moErr) throw moErr;' \
         '// FIX WAVE (B3-fix): card criado' \
         'return { autoProduto, savedId };' \
         'toast.success("Modelo salvo");' \
         'setMoLinhasBase(moLinhas);' \
         'qc.invalidateQueries({ queryKey: ["modelo-composicao", modeloId] });' \
         'if (!isEdit && result?.savedId) onCreated?.(result.savedId);' \
         'if (e?.code === "P0409" && !retryRef.current) {' \
         'if (md.atualizados.length > 0 || md.conflitos.length > 0) setDraft(md.valor);' \
         'if (md.conflitos.length === 0) {'; do
  printf '%s  →  %s\n' "$(grep -cF -- "$a" $S)" "$a"; done
printf '%s  →  %s\n' "$(grep -cxF '  qc, onSaved, onCreated,' $S)" "linha exata: '  qc, onSaved, onCreated,' (desestruturação)"
for a in 'const maoObraPlanejada = maoObraDevLive;' \
         'const motivoTravaDev: MotivoTravaDev =' \
         'const materiaisSetor = custo > 0 ? custo - maoObraSetor : 0;' \
         'const materiaisParaFaixa = custoReal ? materiaisSetor : Math.max(0, simCalc.total - maoObraDevLive);' \
         'const dirty = draftDirty || !moLinhasEqual(moLinhas, moLinhasBase) || gradeRevendaDirty' \
         'if (!draftMudou) return;' \
         'const resolverPorPath = (path: string, escolha: "meu" | "dele") => {' \
         'conflitos={conflitos}' \
         '{/* ↓ F3.2: as seções do BOM (Tecidos/Forros/Entretelas · Aviamentos · Insumos · Grade) entram AQUI,' \
         '{/* F3.1 — "Tecido Planejado" SUBIU para cá' \
         '{/* SETOR 3 — Preço' \
         '<Secao titulo="Preço" defaultOpen={false}>' \
         '<Secao titulo="Tecido Planejado" defaultOpen={false}>' \
         'onVerDev={modeloId ? () => setVerDevModeloId(modeloId) : undefined}' \
         '...camposParaDuplicar(draft),' \
         'const { error } = await supabase.from("modelos").insert(payload);' \
         'function PlanejamentoDetailConteudo({'; do
  printf '%s  →  %s\n' "$(grep -cF -- "$a" $P)" "$a"; done
printf '%s  →  %s\n' "$(grep -cxF '    qc, onSaved: aoSalvar, onCreated,' $P)" "linha exata: '    qc, onSaved: aoSalvar, onCreated,' (chamada do save)"
printf '%s  →  %s\n' "$(grep -cxF '                custoReal={custoReal}' $P)" "linha exata: '                custoReal={custoReal}' (PrecoTabela; a PrecoRevendaBloco tem o mesmo texto no MEIO da linha)"
for a in '  descricao_produto: string;' '  descricao_produto: "",' '    descricao_produto: data.descricao_produto ?? "",'; do
  printf '%s  →  %s\n' "$(grep -cxF -- "$a" $M)" "linha exata ($M): $a"; done
for a in 'ficha_medida_url: "Ficha de Medida", descricao_produto: "Descrição do produto",' \
         '"observacoes_tecnicas", "motivo_cancelamento", "ficha_medida_url", "observacoes_gerais",' \
         'export function rotuloConflitoPlan(path: string): string {'; do
  printf '%s  →  %s\n' "$(grep -cF -- "$a" $H)" "$a"; done
```

Expected: TODAS as contagens = 1. Qualquer 0 ou >1: PARE e reporte ao controlador com o trecho real (`grep -n`) — o texto final da F3.1 é contrato desta fase (R1 do G-plano conjunto); não adaptar por conta própria.

- [ ] **Step 4: Gates de base (anotar as falhas herdadas)**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f32-ficha-bom"
npx tsc --noEmit 2>&1 | tail -3
npm run build 2>&1 | tail -3; git checkout -- src/routeTree.gen.ts 2>/dev/null || true
env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit 2>&1 | tee .superpowers/f32/unit-base.txt | tail -8
git diff --name-only savepoint-pre-unificacao-2026-09-22 -- src/components/desenvolvimento/ src/components/producao/cad/CadTecidosSection.tsx
```

Expected: tsc 0; build ok; unit com N passed e as falhas herdadas listadas (anotar em `.superpowers/f32/falhas-herdadas.txt` o nome de cada teste que falha); último comando SEM saída.

- [ ] **Step 4b: Criar o 5º gate — `.superpowers/f32/gate-f31.sh` (sai 1 se falhar)**

```bash
#!/usr/bin/env bash
# 5º gate da F3.2 — "F3.1 preservada" (R1 do G-plano conjunto). `onCreated` e `aoSalvar` são opcionais/funções: se a
# F3.2 os perder, o tsc NÃO acusa (volta o card duplicado; o Salvar deixa de re-travar). NOTA do re-check do guardião:
# SAI COM CÓDIGO 1 quando falha (antes só imprimia) — gate falhou = PARE, não commitar.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
P=src/components/planejamento/PlanejamentoDetail.tsx
S=src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts
if [ "$(grep -c 'qc, onSaved: aoSalvar, onCreated' "$P")" = 1 ] && [ "$(grep -c 'onCreated?.(' "$S")" = 2 ] \
  && [ "$(grep -c 'criadoIdRef.current' "$S")" -ge 4 ] && [ "$(grep -c 'aplicarRegrasCamposDev(' "$S")" = 1 ] \
  && [ "$(grep -c '"plan-kanban-cond", modeloId' "$S")" = 1 ] && [ "$(grep -c '"modelo-composicao", modeloId' "$S")" = 1 ]; then
  echo "F3.1 preservada: ok"
else
  echo "F3.1 QUEBRADA — PARE (onCreated/aoSalvar/criadoIdRef/regras do payload)"
  exit 1
fi
```

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f32-ficha-bom"
chmod +x .superpowers/f32/gate-f31.sh
bash .superpowers/f32/gate-f31.sh; echo "código=$?"
```

Expected: `F3.1 preservada: ok` e `código=0` (o texto é o FINAL da F3.1). `código=1` já aqui = a F3.2 nasceu de um ponto errado: PARE e reporte.

---

## Task 1: Draft com `proporcoes` e `custos_adicionais` + rótulos do BOM + lista ÚNICA `CAMPOS_DEV_DRAFT`  *(Lote A)*

**Files:**
- Modify: `src/components/planejamento/modelo-shared.ts` (tipo `Draft`, `emptyDraft`, `draftFromModeloRow`)
- Modify: `src/components/planejamento/planejamento-detail/helpers.ts` (`ROTULO_CONFLITO_PLAN`, `rotuloConflitoPlan`, `CAMPOS_DEV_DRAFT` da F3.1)
- Test: `tests/unit/planejamento-detail-helpers.test.ts`

**Interfaces:**
- Consumes (F3.1): `CAMPOS_DEV_DRAFT`, `aplicarRegrasCamposDev`, `camposParaDuplicar`, `emptyDraft`, `type Draft` (já importados no teste pela F3.1).
- Produces: `Draft.proporcoes: Record<string, number>`; `Draft.custos_adicionais: { descricao: string; valor: number }[]`; `rotuloConflitoPlan("secao:bom") === "Tecidos & BOM"`; `CAMPOS_DEV_DRAFT` com `"proporcoes", "custos_adicionais"` (lista ÚNICA — "Unificar" do G-plano conjunto: sem permissão do Dev saem do payload por `aplicarRegrasCamposDev`; o Duplicar não os leva por `camposParaDuplicar`; a F3.2 não cria lista própria).

- [ ] **Step 1: Acrescentar as 2 colunas ao Draft** (pular se a Task 0 Step 2 achou as chaves) — DEPOIS do bloco da F3.1 (F3.1 §3 item 1)

Em `modelo-shared.ts`, no tipo `Draft`, logo depois da linha `  descricao_produto: string;` inserir:

```ts
  // F3.2 (BOM no Sheet unificado): colunas do Desenvolvimento editadas nas seções Grade
  // (proporções por tamanho) e Preço e Custos (custos adicionais por peça). Mesmas colunas que o
  // Dev grava (ModeloDetailPanel.tsx:1909-1931) — o merge 3-vias passa a cobri-las. Estão na lista
  // ÚNICA `CAMPOS_DEV_DRAFT` (helpers.ts).
  proporcoes: Record<string, number>;
  custos_adicionais: { descricao: string; valor: number }[];
```

Em `emptyDraft`, logo depois da linha `  descricao_produto: "",` inserir:

```ts
  proporcoes: {},
  custos_adicionais: [],
```

Em `draftFromModeloRow`, logo depois da linha `    descricao_produto: data.descricao_produto ?? "",` inserir:

```ts
    proporcoes: (data.proporcoes ?? {}) as Record<string, number>,
    custos_adicionais: (data.custos_adicionais ?? []) as { descricao: string; valor: number }[],
```

- [ ] **Step 2: Escrever os testes (falham antes dos Steps 4-5)**

Acrescentar ao FIM de `tests/unit/planejamento-detail-helpers.test.ts` (os imports já vêm da F3.1: `rotuloConflitoPlan`, `CAMPOS_DEV_DRAFT`, `aplicarRegrasCamposDev`, `camposParaDuplicar`, `emptyDraft`, `type Draft`):

```ts
describe("rotuloConflitoPlan — F3.2 (BOM no Sheet do Planejamento)", () => {
  it("rotula a seção do BOM com o MESMO texto do Desenvolvimento", () => {
    expect(rotuloConflitoPlan("secao:bom")).toBe("Tecidos & BOM");
  });
  it("rotula as 2 colunas novas do Draft", () => {
    expect(rotuloConflitoPlan("proporcoes")).toBe("Proporções da grade");
    expect(rotuloConflitoPlan("custos_adicionais")).toBe("Custos adicionais");
  });
});

describe("CAMPOS_DEV_DRAFT — F3.2 (lista ÚNICA com a F3.1)", () => {
  const d = (): Draft => ({ ...emptyDraft(), nome: "M", proporcoes: { P: 1, M: 2 }, custos_adicionais: [{ descricao: "Bordado", valor: 3.5 }] });
  it("inclui proporcoes e custos_adicionais", () => {
    expect(CAMPOS_DEV_DRAFT).toContain("proporcoes");
    expect(CAMPOS_DEV_DRAFT).toContain("custos_adicionais");
  });
  it("sem permissão do Dev: saem do payload (aplicarRegrasCamposDev)", () => {
    const x = d();
    const p = aplicarRegrasCamposDev({ ...x }, x, { podeEditarDev: false, refEditavel: false });
    expect(p).not.toHaveProperty("proporcoes");
    expect(p).not.toHaveProperty("custos_adicionais");
    expect(p.nome).toBe("M");
  });
  it("com permissão: vão como estão (objeto/array — sem normalização)", () => {
    const x = d();
    const p = aplicarRegrasCamposDev({ ...x }, x, { podeEditarDev: true, refEditavel: false });
    expect(p.proporcoes).toEqual({ P: 1, M: 2 });
    expect(p.custos_adicionais).toEqual([{ descricao: "Bordado", valor: 3.5 }]);
  });
  it("Duplicar (decisão F3 #9): a cópia NÃO leva proporções nem custos adicionais", () => {
    const p = camposParaDuplicar(d());
    expect(p).not.toHaveProperty("proporcoes");
    expect(p).not.toHaveProperty("custos_adicionais");
    expect(p.nome).toBe("M");
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit/planejamento-detail-helpers.test.ts`
Expected: FAIL em "rotula a seção do BOM…" (`secao:bom` cai no fallback) e nos testes de `CAMPOS_DEV_DRAFT — F3.2` (as chaves ainda não estão na lista).

- [ ] **Step 4: Implementar em `helpers.ts` — rótulos**

No objeto `ROTULO_CONFLITO_PLAN`, logo depois da linha `  ficha_medida_url: "Ficha de Medida", descricao_produto: "Descrição do produto",` (a última da F3.1) inserir:

```ts
  // F3.2 — colunas do Dev editadas nas seções Grade e Preço e Custos.
  proporcoes: "Proporções da grade", custos_adicionais: "Custos adicionais",
```

Substituir a função inteira:

```ts
export function rotuloConflitoPlan(path: string): string {
  return ROTULO_CONFLITO_PLAN[path] ?? path;
}
```

por:

```ts
export function rotuloConflitoPlan(path: string): string {
  // F3.2 — conflito de SEÇÃO do BOM: mesmo path e rótulo do Desenvolvimento (ModeloDetailPanel.tsx:160-163).
  if (path === "secao:bom") return "Tecidos & BOM";
  return ROTULO_CONFLITO_PLAN[path] ?? path;
}
```

- [ ] **Step 5: Implementar em `helpers.ts` — lista ÚNICA**

Substituir:

```ts
  "observacoes_tecnicas", "motivo_cancelamento", "ficha_medida_url", "observacoes_gerais",
] as const satisfies readonly (keyof Draft)[];
```

por:

```ts
  "observacoes_tecnicas", "motivo_cancelamento", "ficha_medida_url", "observacoes_gerais",
  // F3.2 — escalares do Dev que o Sheet passa a gravar (Grade e Preço e Custos). Lista ÚNICA da campanha: sem
  // permissão do Dev saem do payload (aplicarRegrasCamposDev) e o Duplicar não os leva (camposParaDuplicar, decisão
  // F3 #9). Objeto/array: vão como estão (vazio = {} / [] é valor válido — sem normalização em aplicarRegrasCamposDev).
  "proporcoes", "custos_adicionais",
] as const satisfies readonly (keyof Draft)[];
```

- [ ] **Step 6: Rodar e ver passar + gates**

Run: `env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit/planejamento-detail-helpers.test.ts tests/unit/planejamento-draft.test.ts` → PASS (inclusive os testes da F3.1 — o "sem permissão" dela varre a lista inteira e continua verde).
Rodar os 5 gates das Global Constraints. Nota: a partir daqui o UPDATE do Planejamento passa a levar `proporcoes`/`custos_adicionais` (valores iguais aos do servidor) até a Task 10 filtrar — tudo dentro da worktree, sem efeito fora dela.

- [ ] **Step 7: Commit**

```bash
git add -- src/components/planejamento/modelo-shared.ts src/components/planejamento/planejamento-detail/helpers.ts tests/unit/planejamento-detail-helpers.test.ts
git commit --only -m "feat(planejamento): F3.2 (1) — Draft ganha proporcoes/custos_adicionais (na lista única CAMPOS_DEV_DRAFT) + rótulo do conflito 'Tecidos & BOM'

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- src/components/planejamento/modelo-shared.ts src/components/planejamento/planejamento-detail/helpers.ts tests/unit/planejamento-detail-helpers.test.ts
```

---

## Task 2: `ficha-calc.ts` — contas puras do BOM  *(Lote A)*

**Files:**
- Create: `src/components/planejamento/planejamento-detail/ficha/ficha-calc.ts`
- Test: `tests/unit/ficha-calc.test.ts`

**Interfaces:**
- Consumes: `makeEmptyBlocks`, tipos `TecidoBlock`/`AviamentoRow`/`GradeRow`/`ModeloEtiquetaRow`/`OcAlloc` de `@/components/desenvolvimento/modelo-detail/types` (sem modificar); `somaCustosAdicionais` de `@/lib/custo`; tipo `GradeVarianteInfo` de `ModeloGradeSection`.
- Produces (usados nas Tasks 3-13): `EstadoBom`, `FlagsBom`, `TecidoRowDb`, `VarianteRowDb`, `OcLinkRowDb`, `AviamentoRowDb`, `EtiquetaRowDb`, `GradeRowDb`, `snapshotBom(e): string`, `hidratarBlocos({tecidos, variantes, ocLinks, planejados}): TecidoBlock[]`, `hidratarAviamentos`, `hidratarEtiquetas`, `hidratarGrades`, `tecido1VarianteIds(blocks): string[]`, `herdarGrades(prev, n): GradeRow[]`, `paresComplementares(blocks)`, `tecido1VariantesInfo(...)`, `TotaisBom`, `totaisBom(...)`, `pecaCom(t, mo)`, `tecidosPlanejadosDerivados(blocks, map)`, `TecidoPayload`, `montarTecidosPayload`, `AviamentoPayload`, `montarAviamentosPayload`, `montarGradesPayload`, `EtiquetaRowPayload`, `OpEtiqueta`, `planoEtiquetas(rows, ids, modeloId)`, `artigosTecidoPrincipais(blocks)`, `blocosTecidosIniciais(artigoIds)`, `ResumoBom`, `resumoBom(e)`, `relevantArtigoIds({planejados, extras, blocks})`, `BomCapturado`, e (R5 do G-plano conjunto) `estadoBomDoServidor({tecidos, variantes, ocLinks, aviamentos, etiquetas, grades, planejados}): EstadoBom`, `assinaturaBom(e): string`, `bomDivergeDaReferencia(referencia: string | null, servidor: EstadoBom): boolean`.

- [ ] **Step 1: Escrever o teste (falha: módulo inexistente)**

Criar `tests/unit/ficha-calc.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { makeEmptyBlocks, type TecidoBlock } from "@/components/desenvolvimento/modelo-detail/types";
import {
  artigosTecidoPrincipais, assinaturaBom, blocosTecidosIniciais, bomDivergeDaReferencia, estadoBomDoServidor,
  herdarGrades, hidratarBlocos, hidratarGrades,
  montarAviamentosPayload, montarTecidosPayload, paresComplementares, pecaCom, planoEtiquetas,
  relevantArtigoIds, resumoBom, snapshotBom, tecido1VarianteIds, tecido1VariantesInfo,
  tecidosPlanejadosDerivados, totaisBom, type EstadoBom,
} from "@/components/planejamento/planejamento-detail/ficha/ficha-calc";

// F3.2 — trava as contas PORTADAS do Desenvolvimento (ModeloDetailPanel.tsx) + a guarda R5.
const A = "art-a", B = "art-b", S = "art-sub", F = "art-forro";
const V1 = "v-a-1", V2 = "v-sub-1", VB = "v-b-1", VF = "v-forro-1";

function bloco(tipo: TecidoBlock["tipo"], numero: number, patch: Partial<TecidoBlock> = {}): TecidoBlock {
  const base = makeEmptyBlocks().find((b) => b.tipo === tipo && b.numero === numero)!;
  return { ...base, ...patch };
}
function slots<T>(vals: T[], fill: T): T[] { return [...vals, ...Array(10 - vals.length).fill(fill)]; }

describe("hidratarBlocos — carga do BOM (Dev :870-946)", () => {
  const blocos = hidratarBlocos({
    tecidos: [
      { id: "mt1", tipo: "tecido", numero: 1, artigo_id: A, consumo: 1.85, loss_percent: 3, custo_previsto: 57.17 },
      { id: "mtf", tipo: "forro", numero: 1, artigo_id: F, consumo: 0.9, loss_percent: 2, custo_previsto: 16.52 },
    ],
    variantes: [
      { modelo_tecido_id: "mt1", variante_tecido_id: V2, ordem: 2, multiplicador: null, complementa_variante_ids: null, variantes_tecido: { artigo_id: S } },
      { modelo_tecido_id: "mt1", variante_tecido_id: V1, ordem: 1, multiplicador: 1, complementa_variante_ids: [], variantes_tecido: { artigo_id: A } },
      { modelo_tecido_id: "mtf", variante_tecido_id: VF, ordem: 1, multiplicador: 2, complementa_variante_ids: [V1, V2], variantes_tecido: { artigo_id: F } },
    ],
    ocLinks: [
      { tipo: "tecido", numero: 1, ordem: 1, oc_tecido_item_id: "oc-b", quantidade_m: 10, prioridade: 2 },
      { tipo: "tecido", numero: 1, ordem: 1, oc_tecido_item_id: "oc-a", quantidade_m: 5, prioridade: 1 },
    ],
    planejados: [A, S],
  });
  const t1 = blocos.find((b) => b.tipo === "tecido" && b.numero === 1)!;
  it("mantém os 9 blocos fixos (3 por tipo)", () => expect(blocos).toHaveLength(9));
  it("variantes por ordem, multiplicador null→1, casamento vazio→null", () => {
    expect(t1.id).toBe("mt1");
    expect(t1.variantes.slice(0, 3)).toEqual([V1, V2, null]);
    expect(t1.multiplicadores[1]).toBe(1);
    expect(t1.complementas[0]).toBeNull();
  });
  it("substituto = artigo de variante ≠ principal (só tecido/forro)", () => expect(t1.artigoIdsExtra).toEqual([S]));
  it("OC-links da variante ordenados por prioridade", () => {
    expect(t1.oc_links[0].map((o) => o.oc_tecido_item_id)).toEqual(["oc-a", "oc-b"]);
    expect(t1.oc_links[1]).toEqual([]);
  });
  it("forro guarda multiplicador e casamento", () => {
    const fo = blocos.find((b) => b.tipo === "forro" && b.numero === 1)!;
    expect(fo.multiplicadores[0]).toBe(2);
    expect(fo.complementas[0]).toEqual([V1, V2]);
    expect(fo.artigoIdsExtra).toEqual([]);
  });
  it("G-mockup R5: BOM NÃO vazio ⇒ NÃO pré-preenche (sem 'Tecido 2' fantasma com o substituto)", () => {
    const t2 = blocos.find((b) => b.tipo === "tecido" && b.numero === 2)!;
    expect(t2.artigo_id).toBeNull();
  });
  it("G-mockup R5: BOM vazio ⇒ pré-preenche Tecido 1..3 com a lista (4º ignorado, como no Dev)", () => {
    const vazio = hidratarBlocos({ tecidos: [], variantes: [], ocLinks: [], planejados: [A, B, S, "art-4"] });
    expect(vazio.filter((b) => b.tipo === "tecido").map((b) => b.artigo_id)).toEqual([A, B, S]);
  });
});

describe("snapshotBom — 'não salvo' ignora id e custo derivado", () => {
  const e1: EstadoBom = {
    blocks: [bloco("tecido", 1, { id: "x", artigo_id: A, consumo: 1, custo_previsto: 10 })],
    aviamentos: [{ id: "a1", aviamento_id: "av", variante_aviamento_id: null, consumo: 1, loss_percent: 0, custo_previsto: 5 }],
    etiquetas: [], grades: [],
  };
  it("mudar só id/custo_previsto não muda o snapshot", () => {
    const e2: EstadoBom = {
      ...e1,
      blocks: [bloco("tecido", 1, { id: "y", artigo_id: A, consumo: 1, custo_previsto: 99 })],
      aviamentos: [{ id: "a2", aviamento_id: "av", variante_aviamento_id: null, consumo: 1, loss_percent: 0, custo_previsto: 7 }],
    };
    expect(snapshotBom(e2)).toBe(snapshotBom(e1));
  });
  it("mudar consumo muda o snapshot", () => {
    const e3: EstadoBom = { ...e1, aviamentos: [{ ...e1.aviamentos[0], consumo: 2 }] };
    expect(snapshotBom(e3)).not.toBe(snapshotBom(e1));
  });
});

describe("grade — herança e Tecido 1 (Dev :1430-1468)", () => {
  it("tecido1VarianteIds para no 1º buraco", () => {
    expect(tecido1VarianteIds([bloco("tecido", 1, { variantes: slots([V1, null, V2], null) })])).toEqual([V1]);
  });
  it("herdarGrades acrescenta as linhas que faltam copiando a 1ª com quantidade", () => {
    const prev = [{ variante_numero: 1, grades: { P: 0 }, grade_total: 0 }, { variante_numero: 2, grades: { P: 4, M: 8 }, grade_total: 12 }];
    const out = herdarGrades(prev, 3);
    expect(out.map((g) => g.variante_numero)).toEqual([1, 2, 3]);
    expect(out[2]).toEqual({ variante_numero: 3, grades: { P: 4, M: 8 }, grade_total: 12 });
  });
  it("herdarGrades devolve a MESMA referência quando não há o que herdar (sem loop)", () => {
    const prev = [{ variante_numero: 1, grades: { P: 1 }, grade_total: 1 }];
    expect(herdarGrades(prev, 1)).toBe(prev);
    const vazio: typeof prev = [];
    expect(herdarGrades(vazio, 3)).toBe(vazio);
  });
  it("hidratarGrades normaliza nulos", () => {
    expect(hidratarGrades([{ variante_numero: 1, grades: null, grade_total: null }])).toEqual([{ variante_numero: 1, grades: {}, grade_total: 0 }]);
  });
});

describe("casar variantes (Dev :1488-1564)", () => {
  const blocks = [
    bloco("tecido", 1, { artigo_id: A, variantes: slots([V1, V2], null) }),
    bloco("forro", 1, { artigo_id: F, variantes: slots([VF], null), complementas: slots<string[] | null>([[V1, V2]], null) }),
    bloco("tecido", 2, { artigo_id: B, variantes: slots([VB], null), complementas: slots<string[] | null>([[V1]], null) }),
  ];
  it("paresComplementares ignora o Tecido 1 e expande N-pra-N", () => {
    expect(paresComplementares(blocks)).toEqual([
      { t1id: V1, compVarId: VF }, { t1id: V2, compVarId: VF }, { t1id: V1, compVarId: VB },
    ]);
  });
  it("tecido1VariantesInfo: tecido só com pool misto; complemento sem repetir", () => {
    const info = tecido1VariantesInfo({
      ids: [V1, V2],
      labels: { [V1]: "Areia", [V2]: "Oliva" },
      varianteArtigoMap: { [V1]: A, [V2]: S, [VF]: F, [VB]: B },
      nomeArtigo: (id) => ({ [A]: "Linho", [S]: "Linho Sub", [F]: "Viscose", [B]: "Tule" } as Record<string, string>)[id ?? ""],
      pares: paresComplementares(blocks),
      compLabels: { [VF]: "Off White", [VB]: "Preto" },
    });
    expect(info[0]).toEqual({ numero: 1, label: "Areia", tecido: "Linho", complemento: "Viscose · Off White, Tule · Preto" });
    expect(info[1]).toEqual({ numero: 2, label: "Oliva", tecido: "Linho Sub", complemento: "Viscose · Off White" });
  });
});

describe("totais (Dev :1388-1401)", () => {
  const estado = {
    blocks: [bloco("tecido", 1, { custo_previsto: 57.17 }), bloco("forro", 1, { custo_previsto: 16.52 })],
    aviamentos: [{ aviamento_id: "av", consumo: 1, loss_percent: 0, custo_previsto: 4.9 }],
    etiquetas: [{ etiqueta_id: "et", cor_id: null, consumo: 1, loss_percent: 0, custo_previsto: 1.2 }],
  };
  const t = totaisBom({ ...estado, custosAdicionais: [{ descricao: "Bordado", valor: 3.5 }], maoObra: 35 });
  it("separa as linhas e soma a peça na ordem do Dev", () => {
    expect(t.tecido).toBeCloseTo(57.17); expect(t.forro).toBeCloseTo(16.52); expect(t.entretela).toBe(0);
    expect(t.aviamento).toBeCloseTo(4.9); expect(t.etiqueta).toBeCloseTo(1.2); expect(t.custosAdicionais).toBeCloseTo(3.5);
    expect(t.materiaisBom).toBeCloseTo(79.79); expect(t.terceirizados).toBe(35);
    expect(t.peca).toBeCloseTo(118.29);
  });
  it("pecaCom troca só a mão de obra", () => {
    expect(pecaCom(t, 0)).toBeCloseTo(83.29);
    expect(pecaCom(t, 40)).toBeCloseTo(123.29);
  });
});

describe("derivações do Salvar", () => {
  const blocks = [
    bloco("tecido", 2, { artigo_id: B, variantes: slots([VB], null) }),
    bloco("tecido", 1, { artigo_id: A, variantes: slots([V1, V2], null) }),
    bloco("forro", 1, { artigo_id: F, variantes: slots([VF], null) }),
  ];
  const map = { [V1]: A, [V2]: S, [VB]: B, [VF]: F };
  it("tecidosPlanejadosDerivados: principais por número + substitutos usados; forro fora (Dev :1937-1948)", () => {
    expect(tecidosPlanejadosDerivados(blocks, map)).toEqual([A, B, S]);
  });
  it("artigosTecidoPrincipais: só o artigo dos blocos Tecido, por número (decisão F3 #9)", () => {
    expect(artigosTecidoPrincipais(blocks)).toEqual([A, B]);
  });
  it("blocosTecidosIniciais: até 3, só o artigo, sem variante/consumo (G-mockup R3)", () => {
    const out = blocosTecidosIniciais([A, "", B, S, "art-4"]);
    expect(out.map((t) => [t.artigo_id, t.numero, t.tipo])).toEqual([[A, 1, "tecido"], [B, 2, "tecido"], [S, 3, "tecido"]]);
    expect(out[0]).toMatchObject({ consumo: 0, loss_percent: 0, custo_previsto: 0, variantes: [], multiplicadores: [], complementas: [], oc_links: [] });
  });
  it("montarTecidosPayload: Tecido 1 sem multiplicador/casamento; complementar leva os dois; OC-links achatados (Dev :1973-2008)", () => {
    const t1 = bloco("tecido", 1, {
      artigo_id: A, consumo: 1.85, loss_percent: 3, custo_previsto: 57.17,
      variantes: slots([V1, V2], null), multiplicadores: slots([3, 2], 1),
      complementas: slots<string[] | null>([["x"]], null),
      oc_links: [[{ oc_tecido_item_id: "oc-a", quantidade_m: 5, prioridade: 1 }, { oc_tecido_item_id: "", quantidade_m: 1, prioridade: 2 }], ...Array.from({ length: 9 }, () => [])],
    });
    const fo = bloco("forro", 1, { artigo_id: F, variantes: slots([VF], null), multiplicadores: slots([2], 1), complementas: slots<string[] | null>([[]], null) });
    const vazio = bloco("entretela", 1);
    const out = montarTecidosPayload([t1, fo, vazio]);
    expect(out).toHaveLength(2);
    expect(out[0].multiplicadores.slice(0, 2)).toEqual([1, 1]);
    expect(out[0].complementas.slice(0, 2)).toEqual([null, null]);
    expect(out[0].oc_links).toEqual([{ ordem: 1, variante_tecido_id: V1, oc_tecido_item_id: "oc-a", quantidade_m: 5, prioridade: 1 }]);
    expect(out[1].multiplicadores[0]).toBe(2);
    expect(out[1].complementas[0]).toBeNull();
  });
  it("montarAviamentosPayload numera só as linhas com aviamento", () => {
    const out = montarAviamentosPayload([
      { aviamento_id: null, consumo: 1, loss_percent: 0, custo_previsto: 0 },
      { aviamento_id: "av2", variante_aviamento_id: "va", consumo: 2, loss_percent: 1, custo_previsto: 3 },
    ]);
    expect(out).toEqual([{ aviamento_id: "av2", variante_aviamento_id: "va", numero: 1, consumo: 2, loss_percent: 1, custo_previsto: 3 }]);
  });
  it("planoEtiquetas: atualiza por id, insere sem id, apaga o que sumiu (Dev :2038-2060)", () => {
    const p = planoEtiquetas([
      { id: "e1", etiqueta_id: "et1", cor_id: null, consumo: 1, loss_percent: 0, custo_previsto: 1 },
      { etiqueta_id: null, cor_id: null, consumo: 1, loss_percent: 0, custo_previsto: 0 },
      { etiqueta_id: "et2", cor_id: "c", consumo: 2, loss_percent: 0, custo_previsto: 2 },
    ], ["e1", "e9"], "m1");
    expect(p.ops.map((o) => [o.tipo, o.row.numero, o.row.etiqueta_id])).toEqual([["atualizar", 1, "et1"], ["inserir", 2, "et2"]]);
    expect(p.ops[0]).toMatchObject({ id: "e1" });
    expect(p.apagar).toEqual(["e9"]);
  });
});

describe("resumo e pools", () => {
  it("resumoBom conta tecidos com artigo, variantes faltando, aviamentos, insumos e grade", () => {
    const r = resumoBom({
      blocks: [bloco("tecido", 1, { artigo_id: A, variantes: slots([V1], null) }), bloco("forro", 1, { artigo_id: F })],
      aviamentos: [{ aviamento_id: "av", consumo: 1, loss_percent: 0, custo_previsto: 0 }, { aviamento_id: null, consumo: 0, loss_percent: 0, custo_previsto: 0 }],
      etiquetas: [{ etiqueta_id: "et", cor_id: null, consumo: 1, loss_percent: 0, custo_previsto: 0 }],
      grades: [{ variante_numero: 1, grades: {}, grade_total: 24 }],
    });
    expect(r).toEqual({ nTecidos: 1, todosBlocosComArtigoTemVariante: false, nAviamentos: 1, nInsumos: 1, gradeTotalGeral: 24 });
  });
  it("relevantArtigoIds: união ordenada sem repetição", () => {
    expect(relevantArtigoIds({
      planejados: [B, A], extras: [F, A],
      blocks: [bloco("tecido", 1, { artigo_id: A, artigoIdsExtra: [S] })],
    })).toEqual([A, B, F, S].sort());
  });
});

// R5 (G-plano conjunto) — "Tecidos & BOM" só quando o BOM do SERVIDOR mudou de verdade: ações do próprio usuário
// que só sobem o `rev` (Mover para…, Ordem, Lançar, aprovar MO) e o eco do próprio save não acendem o aviso.
describe("R5 — o BOM do servidor mudou de verdade?", () => {
  const linhas = {
    tecidos: [{ id: "mt1", tipo: "tecido", numero: 1, artigo_id: A, consumo: 1.85, loss_percent: 3, custo_previsto: 57.17 }],
    variantes: [
      { modelo_tecido_id: "mt1", variante_tecido_id: V1, ordem: 1, multiplicador: 1, complementa_variante_ids: null, variantes_tecido: { artigo_id: A } },
      { modelo_tecido_id: "mt1", variante_tecido_id: V2, ordem: 2, multiplicador: 1, complementa_variante_ids: null, variantes_tecido: { artigo_id: S } },
    ],
    ocLinks: [],
    aviamentos: [{ id: "a1", aviamento_id: "av", variante_aviamento_id: null, consumo: 1, loss_percent: 0, custo_previsto: 4.9 }],
    etiquetas: [],
    grades: [{ variante_numero: 1, grades: { M: 8, P: 4 }, grade_total: 12 }],
    planejados: [A, S],
  };
  const servidor = estadoBomDoServidor(linhas);
  const referencia = assinaturaBom(servidor);
  it("mesmas linhas com ids e custos novos e chaves da grade em outra ordem (eco) ⇒ NÃO diverge", () => {
    const eco = estadoBomDoServidor({
      ...linhas,
      tecidos: [{ ...linhas.tecidos[0], id: "mt-novo", custo_previsto: 99 }],
      aviamentos: [{ ...linhas.aviamentos[0], id: "a-novo", custo_previsto: 1 }],
      grades: [{ variante_numero: 1, grades: { P: 4, M: 8 }, grade_total: 12 }],
    });
    expect(bomDivergeDaReferencia(referencia, eco)).toBe(false);
  });
  it("a herança de grade entra (a 2ª variante do Tecido 1 herda a da 1ª), como na carga", () => {
    expect(servidor.grades.map((g) => g.variante_numero)).toEqual([1, 2]);
  });
  it("outra pessoa mudou o consumo ⇒ diverge", () => {
    const outro = estadoBomDoServidor({ ...linhas, tecidos: [{ ...linhas.tecidos[0], consumo: 2 }] });
    expect(bomDivergeDaReferencia(referencia, outro)).toBe(true);
  });
  it("linha vazia no estado local não conta (o Salvar não a grava)", () => {
    const local: EstadoBom = {
      ...servidor,
      aviamentos: [...servidor.aviamentos, { aviamento_id: null, variante_aviamento_id: null, consumo: 0, loss_percent: 0, custo_previsto: 0 }],
    };
    expect(assinaturaBom(local)).toBe(referencia);
  });
  it("sem referência ⇒ diverge (conservador: na dúvida, avisa)", () => {
    expect(bomDivergeDaReferencia(null, servidor)).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit/ficha-calc.test.ts`
Expected: FAIL — "Failed to resolve import …/ficha/ficha-calc".

- [ ] **Step 3: Implementar `ficha-calc.ts`**

Criar `src/components/planejamento/planejamento-detail/ficha/ficha-calc.ts`:

```ts
// F3.2 (Planejamento unificado) — contas PURAS do BOM no Sheet do Planejamento de Produto.
// PORTADAS (cópia) do `PanelContent` do Desenvolvimento (src/components/desenvolvimento/
// ModeloDetailPanel.tsx), que fica INTOCADO até a F5 (decisão travada 8). Cada bloco cita a faixa
// de origem. Sem React e sem Supabase — testadas em tests/unit/ficha-calc.test.ts.
import { somaCustosAdicionais } from "@/lib/custo";
import {
  makeEmptyBlocks,
  type AviamentoRow,
  type GradeRow,
  type ModeloEtiquetaRow,
  type OcAlloc,
  type TecidoBlock,
} from "@/components/desenvolvimento/modelo-detail/types";
import type { GradeVarianteInfo } from "@/components/desenvolvimento/modelo-detail/ModeloGradeSection";

/** Estado editável do BOM (o que o Sheet mostra e o Salvar grava). */
export type EstadoBom = {
  blocks: TecidoBlock[];
  aviamentos: AviamentoRow[];
  etiquetas: ModeloEtiquetaRow[];
  grades: GradeRow[];
};

/** Marcadores do #Erro nas etapas seguintes (`marcar_revisao_por_mudanca`, Dev :2198-2204). */
export type FlagsBom = { grade: boolean; consumo: boolean; aviamentos: boolean };

// Linhas cruas do banco — MESMOS selects do Dev (ModeloDetailPanel.tsx:433-514).
export type TecidoRowDb = { id: string; tipo: string; numero: number; artigo_id: string | null; consumo: number | null; loss_percent: number | null; custo_previsto: number | null };
export type VarianteRowDb = { modelo_tecido_id: string; variante_tecido_id: string | null; ordem: number | null; multiplicador: number | null; complementa_variante_ids: string[] | null; variantes_tecido?: { artigo_id: string | null } | null };
export type OcLinkRowDb = { tipo: string; numero: number; ordem: number; oc_tecido_item_id: string; quantidade_m: number | null; prioridade: number | null };
export type AviamentoRowDb = { id: string; aviamento_id: string | null; variante_aviamento_id: string | null; consumo: number | null; loss_percent: number | null; custo_previsto: number | null };
export type EtiquetaRowDb = { id: string; etiqueta_id: string | null; cor_id: string | null; consumo: number | null; loss_percent: number | null; custo_previsto: number | null };
export type GradeRowDb = { variante_numero: number; grades: Record<string, number> | null; grade_total: number | null };

// ── "Não salvo" ──────────────────────────────────────────────────────────────────────────────
/**
 * Serializa o BOM IGNORANDO `id` (ids de LINHA voláteis: `salvar_modelo_bom` apaga e re-insere a
 * cada save — Dev :86-94) e `custo_previsto` (DERIVADO de preço × consumo × loss; os preços chegam
 * em queries próprias e recalculam o custo DEPOIS da carga — não é edição do usuário).
 */
export function snapshotBom(e: EstadoBom): string {
  try {
    return JSON.stringify(e, (k, v) => (k === "id" || k === "custo_previsto" ? undefined : v));
  } catch {
    return String(e);
  }
}

// ── Carga (Dev :870-946, :948-957, :976-984, :1029-1038) ────────────────────────────────────
export function hidratarBlocos(i: {
  tecidos: TecidoRowDb[];
  variantes: VarianteRowDb[];
  ocLinks: OcLinkRowDb[];
  planejados: string[];
}): TecidoBlock[] {
  const empty = makeEmptyBlocks();
  const linksByKey = new Map<string, OcAlloc[]>();
  for (const l of i.ocLinks) {
    const key = `${l.tipo}-${l.numero}-${l.ordem}`;
    const arr = linksByKey.get(key) ?? [];
    arr.push({ oc_tecido_item_id: l.oc_tecido_item_id, quantidade_m: Number(l.quantidade_m ?? 0), prioridade: Number(l.prioridade ?? 1) });
    linksByKey.set(key, arr);
  }
  linksByKey.forEach((arr) => arr.sort((a, b) => a.prioridade - b.prioridade));
  for (const t of i.tecidos) {
    const idx = empty.findIndex((b) => b.tipo === t.tipo && b.numero === t.numero);
    if (idx < 0) continue;
    const variantes = Array(10).fill(null) as (string | null)[];
    const multiplicadores = Array(10).fill(1) as number[];
    const oc_links = Array.from({ length: 10 }, () => [] as OcAlloc[]);
    const complementas = Array(10).fill(null) as (string[] | null)[];
    const varArtigos = new Set<string>();
    for (const v of i.variantes.filter((x) => x.modelo_tecido_id === t.id)) {
      const ord = (v.ordem ?? 1) - 1;
      if (ord >= 0 && ord < 10) {
        variantes[ord] = v.variante_tecido_id;
        multiplicadores[ord] = Number(v.multiplicador ?? 1) || 1;
        oc_links[ord] = linksByKey.get(`${t.tipo}-${t.numero}-${v.ordem ?? ord + 1}`) ?? [];
        complementas[ord] = Array.isArray(v.complementa_variante_ids) && v.complementa_variante_ids.length ? v.complementa_variante_ids : null;
      }
      const aid = v.variantes_tecido?.artigo_id;
      if (aid) varArtigos.add(aid);
    }
    // Substitutos: TODO artigo de variante salva que não é o principal (pool estrito, Dev :915-922).
    const artigoIdsExtra = t.tipo === "tecido" || t.tipo === "forro"
      ? Array.from(varArtigos).filter((aid) => aid && aid !== t.artigo_id)
      : [];
    empty[idx] = {
      id: t.id, tipo: t.tipo as TecidoBlock["tipo"], numero: t.numero,
      artigo_id: t.artigo_id, artigoIdsExtra,
      consumo: Number(t.consumo ?? 0), loss_percent: Number(t.loss_percent ?? 0), custo_previsto: Number(t.custo_previsto ?? 0),
      variantes, multiplicadores, oc_links, complementas,
    };
  }
  // G-mockup R5 — o Dev (:935-944) pré-preenche Tecido N com `tecidos_planejados[N-1]` SEMPRE que o
  // bloco está vazio; como a lista derivada inclui substitutos, um card com substituto reabria com
  // "Tecido 2" fantasma. Aqui SÓ quando o BOM está VAZIO (card do Planejamento que ainda não tem BOM).
  if (i.tecidos.length === 0) {
    i.planejados.forEach((artigoId, k) => {
      const idx = empty.findIndex((b) => b.tipo === "tecido" && b.numero === k + 1);
      if (idx >= 0 && artigoId && !empty[idx].artigo_id) empty[idx] = { ...empty[idx], artigo_id: artigoId };
    });
  }
  return empty;
}

export function hidratarAviamentos(rows: AviamentoRowDb[]): AviamentoRow[] {
  return rows.map((a) => ({
    id: a.id, aviamento_id: a.aviamento_id, variante_aviamento_id: a.variante_aviamento_id ?? null,
    consumo: Number(a.consumo ?? 0), loss_percent: Number(a.loss_percent ?? 0), custo_previsto: Number(a.custo_previsto ?? 0),
  }));
}

export function hidratarEtiquetas(rows: EtiquetaRowDb[]): ModeloEtiquetaRow[] {
  return rows.map((e) => ({
    id: e.id, etiqueta_id: e.etiqueta_id, cor_id: e.cor_id,
    consumo: Number(e.consumo ?? 0), loss_percent: Number(e.loss_percent ?? 0), custo_previsto: Number(e.custo_previsto ?? 0),
  }));
}

export function hidratarGrades(rows: GradeRowDb[]): GradeRow[] {
  return rows.map((g) => ({ variante_numero: g.variante_numero, grades: (g.grades ?? {}) as Record<string, number>, grade_total: g.grade_total ?? 0 }));
}

// ── Grade (Dev :1430-1468) ───────────────────────────────────────────────────────────────────
/** Variantes do Tecido 1 em ordem, parando no 1º buraco (Dev :1430-1439). */
export function tecido1VarianteIds(blocks: TecidoBlock[]): string[] {
  const t1 = blocks.find((b) => b.tipo === "tecido" && b.numero === 1);
  if (!t1) return [];
  const out: string[] = [];
  for (const v of t1.variantes) {
    if (!v) break;
    out.push(v);
  }
  return out;
}

/** Variante nova HERDA a grade da 1ª com quantidade; monotônica (devolve `prev` se nada muda). */
export function herdarGrades(prev: GradeRow[], nVariantesTecido1: number): GradeRow[] {
  if (nVariantesTecido1 === 0 || prev.length === 0) return prev;
  const base = prev.find((g) => (g.grade_total || 0) > 0) ?? prev[0];
  let changed = false;
  const next = [...prev];
  for (let n = 1; n <= nVariantesTecido1; n++) {
    if (!next.some((g) => g.variante_numero === n)) {
      next.push({ variante_numero: n, grades: { ...base.grades }, grade_total: base.grade_total });
      changed = true;
    }
  }
  return changed ? next.sort((a, b) => a.variante_numero - b.variante_numero) : prev;
}

// ── Casar variantes (Dev :1488-1564) ─────────────────────────────────────────────────────────
export function paresComplementares(blocks: TecidoBlock[]): { t1id: string; compVarId: string }[] {
  const out: { t1id: string; compVarId: string }[] = [];
  blocks.forEach((b) => {
    if (b.tipo === "tecido" && b.numero === 1) return;
    (b.complementas ?? []).forEach((t1ids, i) => {
      const compVarId = b.variantes[i];
      if (!compVarId || !t1ids) return;
      t1ids.forEach((t1id) => { if (t1id) out.push({ t1id, compVarId }); });
    });
  });
  return out;
}

export function tecido1VariantesInfo(i: {
  ids: string[];
  labels: Record<string, string>;
  varianteArtigoMap: Record<string, string>;
  nomeArtigo: (artigoId: string | undefined) => string | undefined;
  pares: { t1id: string; compVarId: string }[];
  compLabels: Record<string, string>;
}): GradeVarianteInfo[] {
  const artigosNoPool = new Set(i.ids.map((id) => i.varianteArtigoMap[id]).filter(Boolean));
  const multiTecido = artigosNoPool.size > 1;
  return i.ids.map((id, k) => {
    const partes = Array.from(new Set(
      i.pares
        .filter((p) => p.t1id === id)
        .map((p) => [i.nomeArtigo(i.varianteArtigoMap[p.compVarId]), i.compLabels[p.compVarId]].filter(Boolean).join(" · "))
        .filter(Boolean),
    ));
    return {
      numero: k + 1,
      label: i.labels[id] ?? "",
      tecido: multiTecido ? (i.nomeArtigo(i.varianteArtigoMap[id]) ?? undefined) : undefined,
      complemento: partes.length > 0 ? partes.join(", ") : undefined,
    };
  });
}

// ── Totais (Dev :1388-1401) ──────────────────────────────────────────────────────────────────
export type TotaisBom = {
  tecido: number; forro: number; entretela: number; aviamento: number; etiqueta: number;
  custosAdicionais: number;
  /** Materiais do BOM (tecido+forro+entretela+aviamento+etiqueta) — SEM custos adicionais e SEM M.O. */
  materiaisBom: number;
  terceirizados: number;
  /** Custo de 1 Peça (Dev): materiais + M.O. + custos adicionais. */
  peca: number;
};

export function totaisBom(i: {
  blocks: TecidoBlock[]; aviamentos: AviamentoRow[]; etiquetas: ModeloEtiquetaRow[];
  custosAdicionais: unknown; maoObra: number;
}): TotaisBom {
  const sum = (tipo: TecidoBlock["tipo"]) => i.blocks.filter((b) => b.tipo === tipo).reduce((s, b) => s + (b.custo_previsto || 0), 0);
  const tecido = sum("tecido");
  const forro = sum("forro");
  const entretela = sum("entretela");
  const aviamento = i.aviamentos.reduce((s, r) => s + (r.custo_previsto || 0), 0);
  const etiqueta = i.etiquetas.reduce((s, r) => s + (r.custo_previsto || 0), 0);
  const custosAdicionais = somaCustosAdicionais(i.custosAdicionais);
  const terceirizados = Number(i.maoObra) || 0;
  const t = { tecido, forro, entretela, aviamento, etiqueta, custosAdicionais, materiaisBom: tecido + forro + entretela + aviamento + etiqueta, terceirizados, peca: 0 };
  return { ...t, peca: pecaCom(t, terceirizados) };
}

/** Custo de 1 Peça com OUTRA mão de obra — mesma ordem de soma do Dev (:1399). */
export function pecaCom(t: Pick<TotaisBom, "tecido" | "forro" | "entretela" | "aviamento" | "etiqueta" | "custosAdicionais">, maoObra: number): number {
  return t.tecido + t.forro + t.entretela + t.aviamento + t.etiqueta + (Number(maoObra) || 0) + t.custosAdicionais;
}

// ── Derivações do Salvar (Dev :1937-1948, :1973-2025, :2038-2060) ────────────────────────────
/** `tecidos_planejados` DERIVADO: principais dos blocos Tecido (por número) + substitutos usados. */
export function tecidosPlanejadosDerivados(blocks: TecidoBlock[], varianteArtigoMap: Record<string, string>): string[] {
  const out: string[] = [];
  const push = (id?: string | null) => { if (id && !out.includes(id)) out.push(id); };
  blocks.filter((b) => b.tipo === "tecido" && !!b.artigo_id).sort((a, b) => a.numero - b.numero).forEach((b) => push(b.artigo_id));
  blocks.filter((b) => b.tipo === "tecido").sort((a, b) => a.numero - b.numero).forEach((b) => b.variantes.forEach((v) => push(v ? varianteArtigoMap[v] : null)));
  return out;
}

export type TecidoPayload = {
  artigo_id: string; numero: number; tipo: TecidoBlock["tipo"];
  consumo: number; loss_percent: number; custo_previsto: number;
  variantes: (string | null)[]; multiplicadores: number[]; complementas: (string[] | null)[];
  oc_links: { ordem: number; variante_tecido_id: string; oc_tecido_item_id: string; quantidade_m: number; prioridade: number }[];
};

export function montarTecidosPayload(blocks: TecidoBlock[]): TecidoPayload[] {
  return blocks.filter((b) => b.artigo_id).map((b) => {
    const t1 = b.tipo === "tecido" && b.numero === 1;
    return {
      artigo_id: b.artigo_id as string, numero: b.numero, tipo: b.tipo,
      consumo: b.consumo || 0, loss_percent: b.loss_percent || 0, custo_previsto: b.custo_previsto || 0,
      variantes: b.variantes,
      // Tecido 1 é sempre 1:1 (âncora) e nunca casa; complementares levam multiplicador e casamento.
      multiplicadores: t1 ? b.variantes.map(() => 1) : b.multiplicadores.map((m) => Number(m) || 1),
      complementas: t1 ? b.variantes.map(() => null) : b.variantes.map((_, i) => {
        const a = b.complementas?.[i];
        return a && a.length ? a : null;
      }),
      oc_links: b.variantes.flatMap((vid, i) => {
        const allocs = b.oc_links?.[i] ?? [];
        if (!vid) return [];
        return allocs.filter((al) => al.oc_tecido_item_id).map((al) => ({
          ordem: i + 1, variante_tecido_id: vid, oc_tecido_item_id: al.oc_tecido_item_id,
          quantidade_m: al.quantidade_m ?? 0, prioridade: al.prioridade ?? 1,
        }));
      }),
    };
  });
}

export type AviamentoPayload = { aviamento_id: string; variante_aviamento_id: string | null; numero: number; consumo: number; loss_percent: number; custo_previsto: number };

export function montarAviamentosPayload(rows: AviamentoRow[]): AviamentoPayload[] {
  return rows.filter((r) => r.aviamento_id).map((r, i) => ({
    aviamento_id: r.aviamento_id as string, variante_aviamento_id: r.variante_aviamento_id || null, numero: i + 1,
    consumo: r.consumo || 0, loss_percent: r.loss_percent || 0, custo_previsto: r.custo_previsto || 0,
  }));
}

export function montarGradesPayload(grades: GradeRow[]): GradeRow[] {
  return grades.map((g) => ({ variante_numero: g.variante_numero, grades: g.grades, grade_total: g.grade_total }));
}

export type EtiquetaRowPayload = { modelo_id: string; etiqueta_id: string; cor_id: string | null; numero: number; consumo: number; loss_percent: number; custo_previsto: number };
export type OpEtiqueta = { tipo: "atualizar"; id: string; row: EtiquetaRowPayload } | { tipo: "inserir"; row: EtiquetaRowPayload };

/** Diff por id de `modelo_etiquetas` (etiqueta não reserva estoque — fora da RPC do BOM, como no Dev). */
export function planoEtiquetas(rows: ModeloEtiquetaRow[], idsServidor: string[], modeloId: string): { ops: OpEtiqueta[]; apagar: string[] } {
  const validas = rows.filter((r) => r.etiqueta_id);
  const mantidos = new Set(validas.filter((r) => r.id).map((r) => r.id as string));
  const ops: OpEtiqueta[] = validas.map((r, i) => {
    const row: EtiquetaRowPayload = {
      modelo_id: modeloId, etiqueta_id: r.etiqueta_id as string, cor_id: r.cor_id || null, numero: i + 1,
      consumo: r.consumo || 0, loss_percent: r.loss_percent || 0, custo_previsto: r.custo_previsto || 0,
    };
    return r.id ? { tipo: "atualizar", id: r.id, row } : { tipo: "inserir", row };
  });
  return { ops, apagar: idsServidor.filter((id) => !mantidos.has(id)) };
}

// ── Card novo / Duplicar (G-mockup R3, decisão F3 #9) ────────────────────────────────────────
/** Artigo dos blocos Tecido, por número (sem substitutos, sem forro/entretela). */
export function artigosTecidoPrincipais(blocks: TecidoBlock[]): string[] {
  return blocks.filter((b) => b.tipo === "tecido" && !!b.artigo_id).sort((a, b) => a.numero - b.numero).map((b) => b.artigo_id as string);
}

/** BOM inicial = Tecido 1..3 só com o artigo (o Dev só mostra 3 blocos por tipo). */
export function blocosTecidosIniciais(artigoIds: string[]): TecidoPayload[] {
  return artigoIds.filter(Boolean).slice(0, 3).map((artigo_id, i) => ({
    artigo_id, numero: i + 1, tipo: "tecido",
    consumo: 0, loss_percent: 0, custo_previsto: 0,
    variantes: [], multiplicadores: [], complementas: [], oc_links: [],
  }));
}

// ── Selos e pools ────────────────────────────────────────────────────────────────────────────
export type ResumoBom = { nTecidos: number; todosBlocosComArtigoTemVariante: boolean; nAviamentos: number; nInsumos: number; gradeTotalGeral: number };

export function resumoBom(e: EstadoBom): ResumoBom {
  return {
    nTecidos: e.blocks.filter((b) => b.tipo === "tecido" && !!b.artigo_id).length,
    todosBlocosComArtigoTemVariante: e.blocks.filter((b) => !!b.artigo_id).every((b) => b.variantes.some((v) => !!v)),
    nAviamentos: e.aviamentos.filter((r) => !!r.aviamento_id).length,
    nInsumos: e.etiquetas.filter((x) => !!x.etiqueta_id).length,
    gradeTotalGeral: e.grades.reduce((s, g) => s + (g.grade_total || 0), 0),
  };
}

/** Artigos cujas variantes o Sheet precisa conhecer (Dev :780-790): lista + forros/entretelas + blocos. */
export function relevantArtigoIds(i: { planejados: string[]; extras: string[]; blocks: TecidoBlock[] }): string[] {
  const s = new Set<string>();
  i.planejados.forEach((id) => id && s.add(id));
  i.extras.forEach((id) => id && s.add(id));
  i.blocks.forEach((b) => {
    if (b.artigo_id) s.add(b.artigo_id);
    (b.artigoIdsExtra ?? []).forEach((x) => x && s.add(x));
  });
  return Array.from(s).sort();
}

// ── Captura do Salvar ────────────────────────────────────────────────────────────────────────
export type BomCapturado = {
  estado: EstadoBom;
  snapshot: string;
  /** Vai gravar o BOM? = pode editar E tocou E difere do baseline ("carregado E sujo"). */
  gravar: boolean;
  flags: FlagsBom;
  idsEtiquetasServidor: string[];
  tecidosPlanejados: string[];
  /** Totais SEM mão de obra (a MO entra no Salvar). null = ficha não carregada / sem permissão / somente leitura. */
  totais: TotaisBom | null;
};

// ── R5 (G-plano conjunto) — o BOM do SERVIDOR mudou de verdade? ─────────────────────────────────────
/**
 * Estado do BOM como a CARGA do Sheet o monta a partir das linhas do servidor (hidratação + herança de grade —
 * as MESMAS funções da carga), p/ comparar com o estado do servidor sobre o qual o usuário está editando.
 */
export function estadoBomDoServidor(i: {
  tecidos: TecidoRowDb[]; variantes: VarianteRowDb[]; ocLinks: OcLinkRowDb[];
  aviamentos: AviamentoRowDb[]; etiquetas: EtiquetaRowDb[]; grades: GradeRowDb[]; planejados: string[];
}): EstadoBom {
  const blocks = hidratarBlocos({ tecidos: i.tecidos, variantes: i.variantes, ocLinks: i.ocLinks, planejados: i.planejados });
  return {
    blocks,
    aviamentos: hidratarAviamentos(i.aviamentos),
    etiquetas: hidratarEtiquetas(i.etiquetas),
    grades: herdarGrades(hidratarGrades(i.grades), tecido1VarianteIds(blocks).length),
  };
}

function gradeOrdenada(g: Record<string, number> | null | undefined): Record<string, number> {
  return Object.fromEntries(Object.entries(g ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/**
 * "Assinatura" do BOM = o que `salvar_modelo_bom` + etiquetas GRAVARIAM (as MESMAS funções do Salvar), sem os custos
 * derivados e com as chaves da grade em ordem estável (o jsonb do servidor reordena). Linha vazia, casamento vazio e
 * alocação de OC sem OC somem dos dois lados — só acusa diferença que o banco de fato guarda.
 */
export function assinaturaBom(e: EstadoBom): string {
  return JSON.stringify({
    tecidos: montarTecidosPayload(e.blocks).map(({ custo_previsto: _c, ...t }) => t),
    aviamentos: montarAviamentosPayload(e.aviamentos).map(({ custo_previsto: _c, ...a }) => a),
    etiquetas: e.etiquetas.filter((r) => r.etiqueta_id).map((r) => ({
      etiqueta_id: r.etiqueta_id, cor_id: r.cor_id || null, consumo: r.consumo || 0, loss_percent: r.loss_percent || 0,
    })),
    grades: montarGradesPayload(e.grades)
      .map((g) => ({ variante_numero: g.variante_numero, grades: gradeOrdenada(g.grades), grade_total: g.grade_total }))
      .sort((a, b) => a.variante_numero - b.variante_numero),
  });
}

/** O BOM do servidor diverge da referência (o que o usuário tinha do servidor ao editar)? Sem referência = diverge. */
export function bomDivergeDaReferencia(referencia: string | null, servidor: EstadoBom): boolean {
  return referencia === null || assinaturaBom(servidor) !== referencia;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit/ficha-calc.test.ts`
Expected: PASS (todos).

- [ ] **Step 5: Gates**

Os 5 gates das Global Constraints (o anti-drift varre o arquivo novo: sem hex, sem `.toFixed(`).

- [ ] **Step 6: Commit**

```bash
git add -- src/components/planejamento/planejamento-detail/ficha/ficha-calc.ts tests/unit/ficha-calc.test.ts
git commit --only -m "feat(planejamento): F3.2 (2) — ficha-calc.ts: contas puras do BOM portadas do Dev + guarda R5

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- src/components/planejamento/planejamento-detail/ficha/ficha-calc.ts tests/unit/ficha-calc.test.ts
```

---

## Task 3: Selos por seção (mapa próprio) e custo-base do markup  *(Lote A)*

**Files:**
- Create: `src/components/planejamento/planejamento-detail/ficha/selos-bom.ts`
- Create: `src/components/planejamento/planejamento-detail/custo-base.ts`
- Test: `tests/unit/ficha-selos-bom.test.ts`, `tests/unit/planejamento-custo-base.test.ts`

**Interfaces:**
- Consumes: `CONDICAO_BY_KEY`, `Condicao` (`@/lib/kanban-condicoes`, só leitura); `ResumoBom`, `TotaisBom` (Task 2).
- Produces: `SecaoBomKey = "tecidos" | "aviamentos" | "insumos" | "grade"`; `CONDICOES_SECAO_BOM`; `SeloSecao = { tone: "ok" | "info" | "warn" | "muted"; texto: string; title?: string; condicaoUnica?: Condicao }`; `requisitosUniao(req: unknown): Set<string>`; `seloSecaoBom(secao, requeridas, satisfeitas, resumo): SeloSecao`; `SeloCusto = "estimado" | "previsto" | "real"`; `previstoDaFicha(t: TotaisBom): number`; `baseCustoPlanejamento({confirmado, realServidor, previsto, estimativa}): { valor: number; selo: SeloCusto }`.

- [ ] **Step 1: Escrever os 2 testes (falham: módulos inexistentes)**

Criar `tests/unit/ficha-selos-bom.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { CONDICAO_BY_KEY } from "@/lib/kanban-condicoes";
import {
  CONDICOES_SECAO_BOM, requisitosUniao, seloSecaoBom, type SecaoBomKey,
} from "@/components/planejamento/planejamento-detail/ficha/selos-bom";
import type { ResumoBom } from "@/components/planejamento/planejamento-detail/ficha/ficha-calc";

// F3.2 — selos de completude das seções do BOM no Sheet do Planejamento: MAPA PRÓPRIO seção→condições
// (o catálogo/`CondicaoSecao` fica intocado — decisão travada 8).
const cheio: ResumoBom = { nTecidos: 2, todosBlocosComArtigoTemVariante: true, nAviamentos: 3, nInsumos: 1, gradeTotalGeral: 24 };
const vazio: ResumoBom = { nTecidos: 0, todosBlocosComArtigoTemVariante: true, nAviamentos: 0, nInsumos: 0, gradeTotalGeral: 0 };

describe("mapa próprio seção → condições", () => {
  it("toda chave do mapa existe no catálogo (anti-drift local)", () => {
    for (const keys of Object.values(CONDICOES_SECAO_BOM)) for (const k of keys) expect(CONDICAO_BY_KEY.has(k), k).toBe(true);
  });
  it("'Tecido planejado' passa a morar na seção Tecidos (no catálogo ela não tem seção)", () => {
    expect(CONDICOES_SECAO_BOM.tecidos).toContain("tecido_planejado");
  });
});

describe("requisitosUniao", () => {
  it("une as colunas e ignora lixo", () => {
    expect([...requisitosUniao({ a: ["grade_preenchida", 3], b: ["aviamento_definido"], c: "x" })].sort()).toEqual(["aviamento_definido", "grade_preenchida"]);
    expect(requisitosUniao(null).size).toBe(0);
  });
});

describe("seloSecaoBom", () => {
  it("sem requisito configurado na seção → selo informativo (fallback do Dev)", () => {
    const f = (s: SecaoBomKey, r: ResumoBom) => seloSecaoBom(s, new Set(), {}, r);
    expect(f("tecidos", cheio)).toEqual({ tone: "ok", texto: "2 tecidos" });
    expect(f("tecidos", vazio)).toEqual({ tone: "muted", texto: "vazio" });
    expect(f("tecidos", { ...cheio, nTecidos: 1, todosBlocosComArtigoTemVariante: false })).toEqual({ tone: "warn", texto: "falta variante" });
    expect(f("aviamentos", cheio)).toEqual({ tone: "ok", texto: "3" });
    expect(f("insumos", vazio)).toEqual({ tone: "muted", texto: "vazio" });
    expect(f("grade", cheio)).toEqual({ tone: "ok", texto: "preenchida" });
    expect(f("grade", vazio)).toEqual({ tone: "warn", texto: "falta preencher" });
  });
  it("requisito configurado e satisfeito → ok", () => {
    expect(seloSecaoBom("grade", new Set(["grade_preenchida"]), { grade_preenchida: true }, vazio)).toEqual({ tone: "ok", texto: "ok" });
  });
  it("1 requisito faltando → 'falta <rótulo>' + a condição p/ o 'i'", () => {
    const s = seloSecaoBom("tecidos", new Set(["tecido_com_variante"]), {}, cheio);
    expect(s.tone).toBe("warn");
    expect(s.texto).toBe("falta tecido com variante (≥ 1)");
    expect(s.condicaoUnica?.key).toBe("tecido_com_variante");
  });
  it("2 faltando → 'faltam 2' com a lista no title", () => {
    const s = seloSecaoBom("grade", new Set(["grade_preenchida", "grade_todas_variantes"]), {}, cheio);
    expect(s.texto).toBe("faltam 2");
    expect(s.title).toBe("Falta: Grade preenchida, Grade preenchida (todas as variantes)");
    expect(s.condicaoUnica).toBeUndefined();
  });
  it("Insumos não tem condição no catálogo → sempre o selo informativo", () => {
    expect(seloSecaoBom("insumos", new Set(["grade_preenchida"]), {}, cheio)).toEqual({ tone: "ok", texto: "1" });
  });
});
```

Criar `tests/unit/planejamento-custo-base.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { baseCustoPlanejamento, previstoDaFicha } from "@/components/planejamento/planejamento-detail/custo-base";
import type { TotaisBom } from "@/components/planejamento/planejamento-detail/ficha/ficha-calc";

// F3.2 — decisão F3 #6: markup e tabela no MESMO custo-base (real › previsto do BOM › estimativa).
const tot = (p: Partial<TotaisBom>): TotaisBom => ({ tecido: 0, forro: 0, entretela: 0, aviamento: 0, etiqueta: 0, custosAdicionais: 0, materiaisBom: 0, terceirizados: 0, peca: 0, ...p });

describe("baseCustoPlanejamento", () => {
  it("confirmado (CAD enviado ao corte) → real, mesmo com previsto maior", () => {
    expect(baseCustoPlanejamento({ confirmado: true, realServidor: 100, previsto: 118.29, estimativa: 80 })).toEqual({ valor: 100, selo: "real" });
  });
  it("confirmado sem real → 0 com selo real (tabela mostra —)", () => {
    expect(baseCustoPlanejamento({ confirmado: true, realServidor: null, previsto: 118, estimativa: 80 })).toEqual({ valor: 0, selo: "real" });
  });
  it("sem corte e com previsto → previsto", () => {
    expect(baseCustoPlanejamento({ confirmado: false, realServidor: 118.29, previsto: 118.29, estimativa: 80 })).toEqual({ valor: 118.29, selo: "previsto" });
  });
  it("sem previsto → estimativa (antes ficava '—')", () => {
    expect(baseCustoPlanejamento({ confirmado: false, realServidor: 0, previsto: 0, estimativa: 80 })).toEqual({ valor: 80, selo: "estimado" });
  });
  it("nada → 0 estimado", () => {
    expect(baseCustoPlanejamento({ confirmado: false, realServidor: undefined, previsto: undefined, estimativa: 0 })).toEqual({ valor: 0, selo: "estimado" });
  });
});

describe("previstoDaFicha", () => {
  it("BOM sem material (só M.O./custos adicionais) NÃO vira previsto", () => {
    expect(previstoDaFicha(tot({ terceirizados: 35, peca: 35 }))).toBe(0);
  });
  it("BOM com material → Custo de 1 Peça", () => {
    expect(previstoDaFicha(tot({ tecido: 57.17, materiaisBom: 79.79, terceirizados: 35, custosAdicionais: 3.5, peca: 118.29 }))).toBe(118.29);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit/ficha-selos-bom.test.ts tests/unit/planejamento-custo-base.test.ts`
Expected: FAIL — imports não resolvem.

- [ ] **Step 3: Implementar `selos-bom.ts`**

Criar `src/components/planejamento/planejamento-detail/ficha/selos-bom.ts`:

```ts
// F3.2 — selos de completude das seções do BOM no Sheet do Planejamento. MAPA PRÓPRIO seção →
// condições (decisão travada 8: o catálogo `kanban-condicoes.ts` e o tipo `CondicaoSecao`, que
// seguem as chaves do accordion do Dev, NÃO mudam). Regra portada do `reqBadge` do Dev
// (ModeloDetailPanel.tsx:1644-1677) + os selos informativos das seções (:2854-2974).
import { CONDICAO_BY_KEY, type Condicao } from "@/lib/kanban-condicoes";
import type { ResumoBom } from "./ficha-calc";

export type SecaoBomKey = "tecidos" | "aviamentos" | "insumos" | "grade";

export const CONDICOES_SECAO_BOM: Record<SecaoBomKey, readonly string[]> = {
  // "Tecido planejado" não tem seção no catálogo (só kanban); no card unificado a lista é derivada
  // dos blocos desta seção — o selo passa a refletir isso.
  tecidos: ["tecido_com_variante", "tecido_planejado"],
  aviamentos: ["aviamento_definido"],
  insumos: [],
  grade: ["grade_preenchida", "grade_todas_variantes"],
};

export type SeloSecao = {
  tone: "ok" | "info" | "warn" | "muted";
  texto: string;
  title?: string;
  /** Quando falta UM requisito: a condição, p/ o "i" explicativo (CondicaoInfo). */
  condicaoUnica?: Condicao;
};

/** União das condições exigidas em QUALQUER coluna (o que a loja configurou). */
export function requisitosUniao(req: unknown): Set<string> {
  const s = new Set<string>();
  if (!req || typeof req !== "object") return s;
  for (const arr of Object.values(req as Record<string, unknown>)) {
    if (!Array.isArray(arr)) continue;
    for (const k of arr) if (typeof k === "string") s.add(k);
  }
  return s;
}

function seloPorRequisito(secao: SecaoBomKey, requeridas: ReadonlySet<string>, satisfeitas: Record<string, boolean>): SeloSecao | null {
  const conds = CONDICOES_SECAO_BOM[secao]
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

function seloInformativo(secao: SecaoBomKey, r: ResumoBom): SeloSecao {
  switch (secao) {
    case "tecidos":
      if (r.nTecidos === 0) return { tone: "muted", texto: "vazio" };
      if (!r.todosBlocosComArtigoTemVariante) return { tone: "warn", texto: "falta variante" };
      return { tone: "ok", texto: `${r.nTecidos} tecido${r.nTecidos > 1 ? "s" : ""}` };
    case "aviamentos":
      return r.nAviamentos > 0 ? { tone: "ok", texto: String(r.nAviamentos) } : { tone: "muted", texto: "vazio" };
    case "insumos":
      return r.nInsumos > 0 ? { tone: "ok", texto: String(r.nInsumos) } : { tone: "muted", texto: "vazio" };
    case "grade":
      return r.gradeTotalGeral > 0 ? { tone: "ok", texto: "preenchida" } : { tone: "warn", texto: "falta preencher" };
  }
}

/** Selo da seção: pelos requisitos da loja (estado SALVO) quando há; senão o informativo. */
export function seloSecaoBom(secao: SecaoBomKey, requeridas: ReadonlySet<string>, satisfeitas: Record<string, boolean>, resumo: ResumoBom): SeloSecao {
  return seloPorRequisito(secao, requeridas, satisfeitas) ?? seloInformativo(secao, resumo);
}
```

- [ ] **Step 4: Implementar `custo-base.ts`**

Criar `src/components/planejamento/planejamento-detail/custo-base.ts`:

```ts
// F3.2 — decisão F3 #6 (aprovada 22/set): o markup e a tabela da seção "Preço e Custos" usam o MESMO
// custo-base, com selo de 3 estados. Ordem: real (CAD enviado ao corte = `custo_unitario_modelos.
// confirmado`) › previsto do BOM › estimativa (tecido × preço/m + materiais + M.O.). Puro; testado.
import type { TotaisBom } from "./ficha/ficha-calc";

export type SeloCusto = "estimado" | "previsto" | "real";

/** Previsto AO VIVO da ficha: só vale quando o BOM tem material (M.O. sozinha não é "previsto do BOM"). */
export function previstoDaFicha(t: TotaisBom): number {
  return t.materiaisBom > 0 ? t.peca : 0;
}

export function baseCustoPlanejamento(i: { confirmado: boolean; realServidor: unknown; previsto: unknown; estimativa: unknown }): { valor: number; selo: SeloCusto } {
  if (i.confirmado) return { valor: Number(i.realServidor) || 0, selo: "real" };
  const prev = Number(i.previsto) || 0;
  if (prev > 0) return { valor: prev, selo: "previsto" };
  const est = Number(i.estimativa) || 0;
  return { valor: est > 0 ? est : 0, selo: "estimado" };
}
```

- [ ] **Step 5: Rodar e ver passar + gates**

Run: `env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit/ficha-selos-bom.test.ts tests/unit/planejamento-custo-base.test.ts` → PASS. Depois os 5 gates.

- [ ] **Step 6: Commit**

```bash
git add -- src/components/planejamento/planejamento-detail/ficha/selos-bom.ts src/components/planejamento/planejamento-detail/custo-base.ts tests/unit/ficha-selos-bom.test.ts tests/unit/planejamento-custo-base.test.ts
git commit --only -m "feat(planejamento): F3.2 (3) — selos do BOM por mapa próprio + custo-base do markup (decisão F3 #6)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- src/components/planejamento/planejamento-detail/ficha/selos-bom.ts src/components/planejamento/planejamento-detail/custo-base.ts tests/unit/ficha-selos-bom.test.ts tests/unit/planejamento-custo-base.test.ts
```

**Revisão do Lote A (Tasks 1-3):** Opus confere Draft × `draftFromModeloRow` (nulos), a fidelidade de cada função portada à faixa citada do Dev (linha a linha), a guarda R5, que o snapshot só ignora `id`/`custo_previsto`, e que `selos-bom.ts` NÃO altera o catálogo.

---

## Task 4: `save-ficha.ts` — regras puras do Salvar  *(revisada junto com a Task 10 — individual Opus)*

**Files:**
- Create: `src/components/planejamento/planejamento-detail/save-ficha.ts`
- Test: `tests/unit/planejamento-save-ficha.test.ts`

**Interfaces:**
- Consumes: `mergeDraft`, `igual`, `Conflito` (`@/lib/colab/merge`); `pecaCom`, `TotaisBom` (Task 2).
- Produces:
  - `aplicarColunasFicha(payload: Record<string, unknown>, o: OpcoesColunasFicha): Record<string, unknown>` com `OpcoesColunasFicha = { isEdit; podeGravarColunasDev; incluirDerivados; podeVerCustos; totais: TotaisBom | null; maoObraServidor: number; gravaBom: boolean; tecidosPlanejados: string[] }`.
  - `tocadosAposSalvar<T>({ touched, live, enviado }): Set<string>`.
  - `prepararRetryP0409<T>({ base, live, fresh, touched, bomConflito }): { proximoDraft: T; conflitos: Conflito[]; atualizados: number; podeRetentar: boolean }` — `bomConflito` = BOM tocado E o BOM do SERVIDOR mudou (R5; o chamador confere com `ficha.bomMudouNoServidor()`).
  - (Duplicar: NÃO há lista aqui — usa o `camposParaDuplicar` da F3.1 com a lista ÚNICA `CAMPOS_DEV_DRAFT`, que a Task 1 estendeu.)

- [ ] **Step 1: Escrever o teste (falha: módulo inexistente)**

Criar `tests/unit/planejamento-save-ficha.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  aplicarColunasFicha, prepararRetryP0409, tocadosAposSalvar,
} from "@/components/planejamento/planejamento-detail/save-ficha";
import type { TotaisBom } from "@/components/planejamento/planejamento-detail/ficha/ficha-calc";

// F3.2 — regras do Salvar unificado do Planejamento (payload do UPDATE `modelos`, rebase pós-save e
// o retry do P0409). Fixes: receita 2419d0f do Desenvolvimento.
const totais: TotaisBom = { tecido: 57.17, forro: 16.52, entretela: 0, aviamento: 4.9, etiqueta: 1.2, custosAdicionais: 3.5, materiaisBom: 79.79, terceirizados: 0, peca: 83.29 };
const base = () => ({ nome: "X", tecidos_planejados: ["a"], proporcoes: { P: 1 }, custos_adicionais: [{ descricao: "B", valor: 3.5 }] } as Record<string, unknown>);
const op = (p: Partial<Parameters<typeof aplicarColunasFicha>[1]> = {}) => ({
  isEdit: true, podeGravarColunasDev: true, incluirDerivados: true, podeVerCustos: true,
  totais, maoObraServidor: 35, gravaBom: false, tecidosPlanejados: ["a", "s"], ...p,
});

describe("aplicarColunasFicha", () => {
  it("card novo: não mexe (a lista do Dialog vai no insert)", () => {
    expect(aplicarColunasFicha(base(), op({ isEdit: false }))).toEqual(base());
  });
  it("edição SEM permissão do Dev: omite lista, proporções e custos adicionais; nenhum custo derivado (decisão F3 #8)", () => {
    const p = aplicarColunasFicha(base(), op({ podeGravarColunasDev: false }));
    expect(p).toEqual({ nome: "X" });
  });
  it("edição com permissão, 1ª tentativa, BOM não gravado: custos derivados SIM, tecidos_planejados NÃO", () => {
    const p = aplicarColunasFicha(base(), op());
    expect(p.tecidos_planejados).toBeUndefined();
    expect(p).toMatchObject({ custo_tecido_total: 57.17, custo_forro_total: 16.52, custo_entretela_total: 0, custo_aviamento_total: 4.9 });
    expect(p.custo_peca_previsto as number).toBeCloseTo(118.29);
    expect(p.proporcoes).toEqual({ P: 1 });
  });
  it("sem ver custos: não grava custo_peca_previsto (a MO vem mascarada — Dev :1914-1930)", () => {
    expect(aplicarColunasFicha(base(), op({ podeVerCustos: false })).custo_peca_previsto).toBeUndefined();
  });
  it("retry do P0409 sem gravar o BOM (incluirDerivados=false): nenhum custo derivado", () => {
    const p = aplicarColunasFicha(base(), op({ incluirDerivados: false }));
    expect(p.custo_tecido_total).toBeUndefined();
    expect(p.custo_peca_previsto).toBeUndefined();
  });
  it("BOM gravado: tecidos_planejados = lista DERIVADA", () => {
    expect(aplicarColunasFicha(base(), op({ gravaBom: true })).tecidos_planejados).toEqual(["a", "s"]);
  });
  it("ficha não carregada (totais null): sem custos derivados", () => {
    expect(aplicarColunasFicha(base(), op({ totais: null })).custo_tecido_total).toBeUndefined();
  });
});

describe("tocadosAposSalvar — fix do save-em-voo", () => {
  it("mantém tocado só o que mudou DEPOIS do envio", () => {
    const out = tocadosAposSalvar({
      touched: new Set(["nome", "semana"]),
      live: { nome: "Novo 2", semana: "2" },
      enviado: { nome: "Novo", semana: "2" },
    });
    expect([...out]).toEqual(["nome"]);
  });
});

describe("prepararRetryP0409 — fix do retry", () => {
  const b = { nome: "A", observacoes_gerais: "x", preco_venda: 10 };
  it("adota o campo do outro usuário e mantém o meu → o retry manda os DOIS", () => {
    const r = prepararRetryP0409({ base: b, live: { ...b, nome: "B" }, fresh: { ...b, observacoes_gerais: "do outro" }, touched: new Set(["nome"]), bomConflito: false });
    expect(r.proximoDraft).toEqual({ nome: "B", observacoes_gerais: "do outro", preco_venda: 10 });
    expect(r.atualizados).toBe(1);
    expect(r.podeRetentar).toBe(true);
  });
  it("conflito no MESMO campo → não retenta", () => {
    const r = prepararRetryP0409({ base: b, live: { ...b, nome: "B" }, fresh: { ...b, nome: "C" }, touched: new Set(["nome"]), bomConflito: false });
    expect(r.conflitos.map((c) => c.path)).toEqual(["nome"]);
    expect(r.podeRetentar).toBe(false);
  });
  it("BOM tocado E o BOM do servidor mudou → não retenta (vira conflito de seção 'Tecidos & BOM')", () => {
    const r = prepararRetryP0409({ base: b, live: b, fresh: { ...b, preco_venda: 12 }, touched: new Set(), bomConflito: true });
    expect(r.podeRetentar).toBe(false);
  });
  it("R5: BOM tocado mas o do servidor IGUAL (o P0409 veio de uma ação que só subiu o rev) → retenta", () => {
    const r = prepararRetryP0409({ base: b, live: b, fresh: { ...b, preco_venda: 12 }, touched: new Set(), bomConflito: false });
    expect(r.podeRetentar).toBe(true);
    expect(r.proximoDraft).toEqual({ ...b, preco_venda: 12 });
  });
  it("nada mudou → devolve o MESMO objeto ao vivo", () => {
    const live = { ...b };
    expect(prepararRetryP0409({ base: b, live, fresh: { ...b }, touched: new Set(), bomConflito: false }).proximoDraft).toBe(live);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit/planejamento-save-ficha.test.ts`
Expected: FAIL — import não resolve.

- [ ] **Step 3: Implementar `save-ficha.ts`**

Criar `src/components/planejamento/planejamento-detail/save-ficha.ts`:

```ts
// F3.2 — regras PURAS do Salvar unificado do Planejamento (usePlanejamentoSave.ts). Testadas em
// tests/unit/planejamento-save-ficha.test.ts. Os dois fixes vêm da receita do Desenvolvimento
// (commit 2419d0f): re-basear no ENVIADO (não no ao vivo) e mandar no retry o draft MESCLADO.
import { igual, mergeDraft, type Conflito } from "@/lib/colab/merge";
import { pecaCom, type TotaisBom } from "./ficha/ficha-calc";

export type OpcoesColunasFicha = {
  isEdit: boolean;
  /** habilitada (interno) E carregada E `canEdit("criacao_desenvolvimento")` E sem trava. */
  podeGravarColunasDev: boolean;
  /** true na 1ª tentativa OU quando ESTE save grava o BOM (os derivados saem do mesmo BOM gravado — R5); false no retry
   *  do P0409 SEM gravar o BOM (o BOM local, não tocado, pode estar velho frente ao do servidor). */
  incluirDerivados: boolean;
  /** `criacao_planejamento:custos` OU `criacao_desenvolvimento:custos` (decisão F3 #2). */
  podeVerCustos: boolean;
  totais: TotaisBom | null;
  /** Σ das linhas de MO do SERVIDOR (baseline) — o Dev grava custo_peca_previsto com ela e corrige depois (:1921-1930, :2140-2150). */
  maoObraServidor: number;
  gravaBom: boolean;
  tecidosPlanejados: string[];
};

/** Ajusta (in place) o payload do UPDATE `modelos` com as colunas do Desenvolvimento. */
export function aplicarColunasFicha(payload: Record<string, unknown>, o: OpcoesColunasFicha): Record<string, unknown> {
  if (!o.isEdit) return payload;
  // A lista NÃO é mais editada à mão no card existente: só vai quando o BOM grava (derivada dos blocos).
  delete payload.tecidos_planejados;
  if (!o.podeGravarColunasDev) {
    delete payload.proporcoes;
    delete payload.custos_adicionais;
    return payload;
  }
  if (o.incluirDerivados && o.totais) {
    payload.custo_tecido_total = o.totais.tecido;
    payload.custo_forro_total = o.totais.forro;
    payload.custo_entretela_total = o.totais.entretela;
    payload.custo_aviamento_total = o.totais.aviamento;
    if (o.podeVerCustos) payload.custo_peca_previsto = pecaCom(o.totais, o.maoObraServidor);
  }
  if (o.gravaBom) payload.tecidos_planejados = o.tecidosPlanejados;
  return payload;
}

/** Depois do save: segue "tocado" só o campo que mudou DEPOIS do envio (tecla digitada em voo). */
export function tocadosAposSalvar<T extends Record<string, any>>(o: { touched: ReadonlySet<string>; live: T; enviado: T }): Set<string> {
  const out = new Set<string>();
  for (const k of o.touched) if (!igual(o.live[k], o.enviado[k])) out.add(k);
  return out;
}

/**
 * Merge do P0409 + decisão de retentar. O chamador DEVE espelhar `proximoDraft` no draftLiveRef ANTES do retry.
 * `bomConflito` (R5 do G-plano conjunto) = o BOM está tocado E o BOM do SERVIDOR mudou de verdade — um P0409 que veio
 * de uma ação do próprio usuário que só subiu o `rev` (Mover para…, Ordem, Lançar, aprovar MO) retenta normalmente.
 * (O Duplicar NÃO tem lista aqui: usa o `camposParaDuplicar` da F3.1 com a lista única `CAMPOS_DEV_DRAFT`.)
 */
export function prepararRetryP0409<T extends Record<string, any>>(o: { base: T; live: T; fresh: T; touched: ReadonlySet<string>; bomConflito: boolean }): {
  proximoDraft: T; conflitos: Conflito[]; atualizados: number; podeRetentar: boolean;
} {
  const md = mergeDraft({ base: o.base, draft: o.live, fresh: o.fresh, touched: o.touched });
  const mudou = md.atualizados.length > 0 || md.conflitos.length > 0;
  return {
    proximoDraft: mudou ? md.valor : o.live,
    conflitos: md.conflitos,
    atualizados: md.atualizados.length,
    podeRetentar: md.conflitos.length === 0 && !o.bomConflito,
  };
}
```

- [ ] **Step 4: Rodar e ver passar + gates**

Run: `env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit/planejamento-save-ficha.test.ts` → PASS. Depois os 5 gates.

- [ ] **Step 5: Commit**

```bash
git add -- src/components/planejamento/planejamento-detail/save-ficha.ts tests/unit/planejamento-save-ficha.test.ts
git commit --only -m "feat(planejamento): F3.2 (4) — regras puras do Salvar unificado (colunas do Dev, rebase em voo, retry P0409 com conflito de BOM só quando o servidor mudou)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- src/components/planejamento/planejamento-detail/save-ficha.ts tests/unit/planejamento-save-ficha.test.ts
```

---

## Task 5: `useFichaDados` — queries com chaves próprias  *(Lote B)*

**Files:**
- Create: `src/components/planejamento/planejamento-detail/ficha/useFichaDados.ts`

**Interfaces:**
- Consumes: tipos `*RowDb` (Task 2); `EtiquetaInfo`, `Opt` (`modelo-detail/types`); `AviamentoVarOpt` (`modelo-detail/ModeloAviamentosSection`); `lerRevendaConfig`; `useActiveTenantId`.
- Produces: `chavesFichaBom(modeloId): QueryKey[]`; `ArtigoFicha`; `AviamentoFicha`; `useFichaDados({ modeloId, habilitada })` → `FichaDados` com `artigos, artigoMap, artigosForro, artigosEntretela, aviamentos, aviamentoMap, etiquetaOpts, etiquetaMap, tamanhos, tenantCfg, revendaCfg, tecidosData, ocLinksData, frozenPrecos, aviamentosData, etiquetasData, etiquetasDataRef, gradesData, condicoes, cadExiste, cadFetched, catalogosProntos`.

- [ ] **Step 1: Criar o hook**

Criar `src/components/planejamento/planejamento-detail/ficha/useFichaDados.ts`:

```ts
// F3.2 — dados do BOM que o Sheet do Planejamento precisa. queryKeys PRÓPRIAS ("plan-ficha-*"; CLAUDE.md:
// "queryKey única por tela" — key compartilhada já causou bug), selects IGUAIS aos do Desenvolvimento
// (ModeloDetailPanel.tsx:262-514), que fica intocado. A de tenant_config contém "tenant" no nome para o
// predicate da Config da Loja/Realtime (`matchTenantConfig`) invalidá-la.
import { useMemo, useRef } from "react";
import { useQuery, type QueryKey } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { lerRevendaConfig } from "@/lib/revenda-config";
import type { EtiquetaInfo, Opt } from "@/components/desenvolvimento/modelo-detail/types";
import type { AviamentoVarOpt } from "@/components/desenvolvimento/modelo-detail/ModeloAviamentosSection";
import type { AviamentoRowDb, EtiquetaRowDb, GradeRowDb, OcLinkRowDb, TecidoRowDb, VarianteRowDb } from "./ficha-calc";

export type ArtigoFicha = {
  id: string; nome: string; preco: number | null; preco_por_metro: number | null; unidade_medida: string | null;
  categoria_tecido_id: string | null; largura_estimada: number | null;
  empresa?: { nome_fantasia: string | null; razao_social: string | null } | null;
};
export type AviamentoFicha = { id: string; codigo_nome: string; preco: number | null; variantes?: AviamentoVarOpt[] };

// Defaults ESTÁVEIS (mesma identidade entre renders) — evita efeitos rodando à toa (Dev :751-758).
const SEM_ARTIGOS: ArtigoFicha[] = [];
const SEM_CATEGORIAS: Opt[] = [];
const SEM_LINKS_CAT: { artigo_id: string; categoria_tecido_id: string }[] = [];
const SEM_AVIAMENTOS: AviamentoFicha[] = [];
const SEM_ETIQUETAS: EtiquetaInfo[] = [];
const SEM_PRECOS: Record<string, number> = {};
const SEM_CONDICOES: Record<string, boolean> = {};
const TAMANHOS_PADRAO = ["34|PPP", "36|PP", "38|P", "40|M", "42|G", "44|GG"];

/** Chaves do BOM deste modelo — invalidadas no pós-save e quando outra pessoa salva. */
export function chavesFichaBom(modeloId: string | null): QueryKey[] {
  return [
    ["plan-ficha-tecidos", modeloId],
    ["plan-ficha-oc-links", modeloId],
    ["plan-ficha-precos-congelado", modeloId],
    ["plan-ficha-aviamentos", modeloId],
    ["plan-ficha-etiquetas", modeloId],
    ["plan-ficha-grades", modeloId],
    ["plan-ficha-condicoes", modeloId],
    ["plan-ficha-cad", modeloId],
  ];
}

export function useFichaDados({ modeloId, habilitada }: { modeloId: string | null; habilitada: boolean }) {
  const tenantId = useActiveTenantId();
  const on = habilitada && !!modeloId;

  // ── Catálogos (Dev :336-422) ──
  const qArtigos = useQuery({
    queryKey: ["plan-ficha-artigos"],
    enabled: on,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("artigos")
        .select("id, nome, preco, preco_por_metro, unidade_medida, categoria_tecido_id, largura_estimada, empresa:empresa_id(nome_fantasia, razao_social)")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as unknown as ArtigoFicha[];
    },
  });
  const qCatTecido = useQuery({
    queryKey: ["plan-ficha-cat-tecido"],
    enabled: on,
    queryFn: async () => {
      const { data, error } = await supabase.from("categorias_tecido").select("id, nome").order("nome");
      if (error) throw error;
      return (data ?? []) as Opt[];
    },
  });
  const qArtigoCats = useQuery({
    queryKey: ["plan-ficha-artigo-cats"],
    enabled: on,
    queryFn: async () => {
      const { data, error } = await supabase.from("artigo_categorias_tecido").select("artigo_id, categoria_tecido_id");
      if (error) throw error;
      return (data ?? []) as { artigo_id: string; categoria_tecido_id: string }[];
    },
  });
  const qAviamentos = useQuery({
    queryKey: ["plan-ficha-aviamentos-cat"],
    enabled: on,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("aviamentos" as any)
        .select("id, codigo_nome, preco, variantes:variantes_aviamento(id, nome_variante, codigo_variante, cor:cor_id(nome), apelido:cor_apelido_id(nome))")
        .order("codigo_nome");
      if (error) throw error;
      return (data ?? []) as unknown as AviamentoFicha[];
    },
  });
  const qEtiquetas = useQuery({
    queryKey: ["plan-ficha-etiquetas-cat"],
    enabled: on,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("etiquetas" as any)
        .select("id, nome, formato_tamanho, preco, variantes_etiqueta(cor_id, preco, cor:cor_id(nome))")
        .order("nome");
      if (error) throw error;
      return ((data ?? []) as any[]).map((e) => ({
        id: e.id, nome: e.nome, formato_tamanho: e.formato_tamanho ?? "ambos", preco: e.preco,
        variantes: (e.variantes_etiqueta ?? []).map((v: any) => ({ cor_id: v.cor_id, cor_nome: v.cor?.nome ?? null, preco: v.preco })),
      })) as EtiquetaInfo[];
    },
  });
  const qTenant = useQuery({
    queryKey: ["plan-ficha-tenant-config", tenantId],
    enabled: on && !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenant_config")
        .select("tamanhos_grade, status_kanban, kanban_requisitos, revenda_campos, revenda_kanban_colunas, revenda_kanban_requisitos")
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // ── BOM do modelo (Dev :433-514) ──
  const qTecidos = useQuery({
    queryKey: ["plan-ficha-tecidos", modeloId],
    enabled: on,
    queryFn: async () => {
      const { data: tecidos, error } = await supabase
        .from("modelo_tecidos")
        .select("id, modelo_id, artigo_id, numero, tipo, consumo, loss_percent, custo_previsto")
        .eq("modelo_id", modeloId as string);
      if (error) throw error;
      const ids = (tecidos ?? []).map((t: any) => t.id);
      let variantes: any[] = [];
      if (ids.length > 0) {
        const { data: vs, error: e2 } = await supabase
          .from("modelo_tecido_variantes")
          .select("modelo_tecido_id, variante_tecido_id, ordem, multiplicador, complementa_variante_ids, variantes_tecido:variante_tecido_id(artigo_id)")
          .in("modelo_tecido_id", ids);
        if (e2) throw e2;
        variantes = vs ?? [];
      }
      return { tecidos: (tecidos ?? []) as unknown as TecidoRowDb[], variantes: variantes as VarianteRowDb[] };
    },
  });
  const qOcLinks = useQuery({
    queryKey: ["plan-ficha-oc-links", modeloId],
    enabled: on,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modelo_tecido_oc_links" as any)
        .select("tipo, numero, ordem, oc_tecido_item_id, quantidade_m, prioridade")
        .eq("modelo_id", modeloId as string);
      if (error) throw error;
      return (data ?? []) as unknown as OcLinkRowDb[];
    },
  });
  // Preço congelado pela OC vinculada (Dev :467-477): "tipo|numero" → preço/m.
  const qFrozen = useQuery({
    queryKey: ["plan-ficha-precos-congelado", modeloId],
    enabled: on,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("precos_tecido_congelado" as any, { _modelo_id: modeloId });
      if (error) throw error;
      return (data ?? {}) as Record<string, number>;
    },
  });
  const qAviamentosModelo = useQuery({
    queryKey: ["plan-ficha-aviamentos", modeloId],
    enabled: on,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modelo_aviamentos" as any)
        .select("id, aviamento_id, variante_aviamento_id, numero, consumo, loss_percent, custo_previsto")
        .eq("modelo_id", modeloId as string)
        .order("numero");
      if (error) throw error;
      return (data ?? []) as unknown as AviamentoRowDb[];
    },
  });
  const qEtiquetasModelo = useQuery({
    queryKey: ["plan-ficha-etiquetas", modeloId],
    enabled: on,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modelo_etiquetas" as any)
        .select("id, etiqueta_id, cor_id, consumo, loss_percent, custo_previsto")
        .eq("modelo_id", modeloId as string)
        .order("numero");
      if (error) throw error;
      return (data ?? []) as unknown as EtiquetaRowDb[];
    },
  });
  const qGrades = useQuery({
    queryKey: ["plan-ficha-grades", modeloId],
    enabled: on,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modelo_grades")
        .select("variante_numero, grades, grade_total")
        .eq("modelo_id", modeloId as string)
        .order("variante_numero");
      if (error) throw error;
      return (data ?? []) as unknown as GradeRowDb[];
    },
  });
  // Condições do kanban no estado SALVO (selos por requisito — Dev :283-291).
  const qCondicoes = useQuery({
    queryKey: ["plan-ficha-condicoes", modeloId],
    enabled: on,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("avaliar_condicoes_kanban" as any, { _ids: [modeloId] });
      if (error) throw error;
      return (((data ?? {}) as any)[modeloId as string] ?? {}) as Record<string, boolean>;
    },
  });
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

  // ── Derivados (Dev :347-422, :328-334) ──
  const artigos = qArtigos.data ?? SEM_ARTIGOS;
  const categoriasTecido = qCatTecido.data ?? SEM_CATEGORIAS;
  const artigoCatLinks = qArtigoCats.data ?? SEM_LINKS_CAT;
  const artigoMap = useMemo(() => Object.fromEntries(artigos.map((a) => [a.id, a])) as Record<string, ArtigoFicha>, [artigos]);
  const catsByArtigo = useMemo(() => {
    const m = new Map<string, Set<string>>();
    artigoCatLinks.forEach((l) => {
      const s = m.get(l.artigo_id) ?? new Set<string>();
      s.add(l.categoria_tecido_id);
      m.set(l.artigo_id, s);
    });
    return m;
  }, [artigoCatLinks]);
  const artigosPorCategoriaNome = (nome: string) => {
    const cat = categoriasTecido.find((c) => c.nome.trim().toLowerCase() === nome.toLowerCase());
    if (!cat) return SEM_ARTIGOS;
    return artigos.filter((a) => catsByArtigo.get(a.id)?.has(cat.id) || artigoMap[a.id]?.categoria_tecido_id === cat.id);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const artigosForro = useMemo(() => artigosPorCategoriaNome("Forro"), [artigos, categoriasTecido, catsByArtigo]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const artigosEntretela = useMemo(() => artigosPorCategoriaNome("Entretela"), [artigos, categoriasTecido, catsByArtigo]);
  const aviamentos = qAviamentos.data ?? SEM_AVIAMENTOS;
  const aviamentoMap = useMemo(() => Object.fromEntries(aviamentos.map((a) => [a.id, a])) as Record<string, AviamentoFicha>, [aviamentos]);
  const etiquetasList = qEtiquetas.data ?? SEM_ETIQUETAS;
  const etiquetaMap = useMemo(() => Object.fromEntries(etiquetasList.map((e) => [e.id, e])) as Record<string, EtiquetaInfo>, [etiquetasList]);
  const etiquetaOpts = useMemo<Opt[]>(() => etiquetasList.map((e) => ({ id: e.id, nome: e.nome })), [etiquetasList]);
  const tenantCfg = qTenant.data ?? null;
  const tamanhos: string[] = useMemo(() => {
    const raw = (tenantCfg as any)?.tamanhos_grade;
    if (Array.isArray(raw) && raw.length > 0) return raw.map((x: any) => (typeof x === "string" ? x : (x?.nome ?? x?.label ?? String(x))));
    return TAMANHOS_PADRAO;
  }, [tenantCfg]);
  const revendaCfg = useMemo(() => lerRevendaConfig(tenantCfg), [tenantCfg]);
  // Espelho síncrono dos ids de etiqueta do SERVIDOR (lido dentro do mutationFn do Salvar).
  const etiquetasDataRef = useRef(qEtiquetasModelo.data);
  etiquetasDataRef.current = qEtiquetasModelo.data;

  return {
    artigos, artigoMap, artigosForro, artigosEntretela,
    aviamentos, aviamentoMap, etiquetaOpts, etiquetaMap,
    tamanhos, tenantCfg, revendaCfg,
    tecidosData: qTecidos.data,
    ocLinksData: qOcLinks.data,
    frozenPrecos: qFrozen.data ?? SEM_PRECOS,
    aviamentosData: qAviamentosModelo.data,
    etiquetasData: qEtiquetasModelo.data,
    etiquetasDataRef,
    gradesData: qGrades.data,
    condicoes: qCondicoes.data ?? SEM_CONDICOES,
    cadExiste: !!qCad.data?.id,
    cadFetched: qCad.isSuccess,
    catalogosProntos: qArtigos.isSuccess && qCatTecido.isSuccess && qArtigoCats.isSuccess && qAviamentos.isSuccess
      && qEtiquetas.isSuccess && qFrozen.isSuccess && qTenant.isSuccess,
  };
}

export type FichaDados = ReturnType<typeof useFichaDados>;
```

- [ ] **Step 2: Gates**

Os 5 gates. `tsc` precisa passar (o hook ainda não é usado).

- [ ] **Step 3: Commit**

```bash
git add -- src/components/planejamento/planejamento-detail/ficha/useFichaDados.ts
git commit --only -m "feat(planejamento): F3.2 (5) — useFichaDados: queries do BOM com chaves próprias plan-ficha-*

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- src/components/planejamento/planejamento-detail/ficha/useFichaDados.ts
```

---

## Task 6: `useFichaGuarda` + `useFichaBom` — estado, carga, handlers  *(individual Opus)*

**Files:**
- Create: `src/components/planejamento/planejamento-detail/ficha/useFichaGuarda.ts`
- Create: `src/components/planejamento/planejamento-detail/ficha/useFichaBom.ts`

**Interfaces:**
- Consumes: Task 2 (`hidratar*`, `herdarGrades`, `tecido1VarianteIds`, `relevantArtigoIds`, `EstadoBom`, `FlagsBom`); Task 5 (`FichaDados`); `Draft`; `recompute*`, `removerVarianteDoBloco`, `remapGradesAposRemocao`, `makeEmptyBlocks` (`modelo-detail/types`, sem modificar); `distribuiTotal`, `distribuiAncora`, `redistribuiPorEscala`, `somaGrade` (`@/lib/grade-proporcao`).
- Produces:
  - `useFichaGuarda({ modeloId, snapshot, tocado, hidratado })` → `{ dirty: boolean; baselineRef: RefObject<string | null>; rebasear: (s: string) => void }`.
  - `useFichaBom({ modeloId, habilitada, dados, tecidosPlanejados, proporcoes, setDraftTracked, aoRecarregarComTocado? })` (`aoRecarregarComTocado?: (servidor: EstadoBom) => void` — R5a do re-check do guardião: chamado pela carga quando o BOM do servidor CHEGA com o BOM local já tocado) → `{ blocks, aviamentosState, etiquetasState, grades, gradeAuto, hidratado, tocado, colecoesTouchadasRef, estadoRef, flagsRef, varianteArtigoMap, varianteArtigoMapRef, varianteArtigoMapPronto, tecido1VarianteIds, confirmGrade, setConfirmGrade, camposCopiados, onCampoEditado, marcarCopiados, limparCopiados, limparTocado, limparFlags, descartarEdicoes, handlers }` com `handlers = { updateBlock, updateBlockVariante, updateBlockOcLinks, updateAviamento, addAviamento, removeAviamento, updateEtiqueta, addEtiqueta, removeEtiqueta, updateGradeTotal, updateGradeCell, updateProporcao, toggleGradeAuto }` (mesmas assinaturas do Dev).

- [ ] **Step 1: Criar `useFichaGuarda.ts`**

```ts
// F3.2 — "alterações não salvas" do BOM. SUBSTITUI a heurística de estabilidade do Dev
// (ModeloDetailPanel.tsx:1679-1751: `seedSettled` + confirmação em 2 renders) por uma regra mais simples,
// possível aqui porque TODO handler do BOM marca "tocado" (colecoesTouchadasRef):
//   • enquanto NÃO tocado, o baseline ACOMPANHA o estado (absorve a semeadura, a herança de grade e as
//     recargas do servidor sem acusar "não salvo" — o motivo de toda a heurística do Dev);
//   • tocado ⇒ "não salvo" = snapshot atual ≠ baseline (tocar e desfazer volta a limpo).
// O snapshot ignora `id` e `custo_previsto` (ver `snapshotBom`): preço chegando depois não suja.
import { useEffect, useRef, useState } from "react";

export function useFichaGuarda({ modeloId, snapshot, tocado, hidratado }: {
  modeloId: string | null; snapshot: string; tocado: boolean; hidratado: boolean;
}) {
  const baselineRef = useRef<string | null>(null);
  const [, setTick] = useState(0);
  useEffect(() => { baselineRef.current = null; }, [modeloId]);
  useEffect(() => {
    if (hidratado && !tocado) baselineRef.current = snapshot;
  }, [snapshot, tocado, hidratado]);
  const dirty = hidratado && tocado && baselineRef.current !== null && snapshot !== baselineRef.current;
  /** Pós-save com edição EM VOO: baseline = o que foi ENVIADO (o selo segue aceso — receita 2419d0f). */
  const rebasear = (s: string) => { baselineRef.current = s; setTick((n) => n + 1); };
  return { dirty, baselineRef, rebasear };
}
```

- [ ] **Step 2: Criar `useFichaBom.ts`**

```ts
// F3.2 — estado EDITÁVEL do BOM no Sheet do Planejamento + carga + handlers. PORTA (cópia) do PanelContent
// do Desenvolvimento (ModeloDetailPanel.tsx — carga :870-1038, herança :1452-1468, handlers :2435-2652),
// que fica INTOCADO até a F5 (decisão travada 8). Diferenças DELIBERADAS (registradas no plano F3.2):
//  • G-mockup R5: o pré-preenchimento com `tecidos_planejados` só roda com o BOM VAZIO (ficha-calc).
//  • CAD fora (F3.3): sem cadTecidosState e sem a propagação BOM→CAD de updateBlock (Dev :2441-2456).
//  • Carga num efeito ÚNICO (as 5 queries juntas) + `hidratarTick`, p/ "descartar e recarregar" reaplicar
//    mesmo quando o refetch devolve dados idênticos (structural sharing do React Query não troca a ref).
//  • "Tocado" também como ESTADO (alimenta o "não salvo" — useFichaGuarda); `toggleGradeAuto` marca tocado
//    (no Dev não marca, e a redistribuição podia ser sobrescrita por uma recarga).
//  • Confirmar "Apagar grade preenchida?" (troca do Tecido 1) marca o #Erro de grade (no Dev não marca).
//  • Marcadores do #Erro em ref (só o Salvar lê).
//  • R5a (re-check do guardião): com o BOM TOCADO a carga não sobrescreve (igual ao Dev), mas COMPARA o BOM que chegou
//    com a referência do usuário (`aoRecarregarComTocado` → o orquestrador acende "Tecidos & BOM" se divergir). O Dev só
//    retorna — tem o mesmo buraco, que fica lá (decisão travada 8; aviso ao dono no plano, §7 D5).
import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { distribuiAncora, distribuiTotal, redistribuiPorEscala, somaGrade } from "@/lib/grade-proporcao";
import {
  makeEmptyBlocks, recomputeAviamento, recomputeBlock, recomputeEtiqueta,
  remapGradesAposRemocao, removerVarianteDoBloco,
  type AviamentoRow, type GradeRow, type ModeloEtiquetaRow, type OcAlloc, type TecidoBlock,
} from "@/components/desenvolvimento/modelo-detail/types";
import type { Draft } from "@/components/planejamento/modelo-shared";
import {
  estadoBomDoServidor, herdarGrades, hidratarAviamentos, hidratarBlocos, hidratarEtiquetas, hidratarGrades,
  relevantArtigoIds, tecido1VarianteIds as calcTecido1VarianteIds,
  type EstadoBom, type FlagsBom,
} from "./ficha-calc";
import type { FichaDados } from "./useFichaDados";

const MAPA_VAZIO: Record<string, string> = {};
const FLAGS_ZERO: FlagsBom = { grade: false, consumo: false, aviamentos: false };

export type ConfirmGrade = { msg: string; onConfirm: () => void } | null;

export function useFichaBom({ modeloId, habilitada, dados, tecidosPlanejados, proporcoes, setDraftTracked, aoRecarregarComTocado }: {
  modeloId: string | null;
  habilitada: boolean;
  dados: FichaDados;
  tecidosPlanejados: string[];
  proporcoes: Record<string, number>;
  setDraftTracked: Dispatch<SetStateAction<Draft>>;
  /** R5a — a carga chegou com o BOM local JÁ tocado: recebe o BOM do SERVIDOR (montado pelas MESMAS funções da carga). */
  aoRecarregarComTocado?: (servidor: EstadoBom) => void;
}) {
  // Sempre a versão atual do callback (o efeito da carga não o tem nas dependências).
  const aoRecarregarRef = useRef(aoRecarregarComTocado);
  aoRecarregarRef.current = aoRecarregarComTocado;
  const [blocks, setBlocks] = useState<TecidoBlock[]>(makeEmptyBlocks);
  const [aviamentosState, setAviamentosState] = useState<AviamentoRow[]>([]);
  const [etiquetasState, setEtiquetasState] = useState<ModeloEtiquetaRow[]>([]);
  const [grades, setGrades] = useState<GradeRow[]>([]);
  // Grade automática LIGADA por padrão (Dev :764-766).
  const [gradeAuto, setGradeAuto] = useState(true);
  const [hidratado, setHidratado] = useState(false);
  const [hidratarTick, setHidratarTick] = useState(0);
  // "Apagar grade preenchida?" — ação adiada até confirmar (Dev :659-661, :3221-3237).
  const [confirmGrade, setConfirmGrade] = useState<ConfirmGrade>(null);
  // Destaque do "Importar dados" (o diálogo é da F3.3; o estado já nasce aqui p/ as seções).
  const [camposCopiados, setCamposCopiados] = useState<Set<string>>(() => new Set());
  const [tocado, setTocado] = useState(false);
  const colecoesTouchadasRef = useRef(false);
  const flagsRef = useRef<FlagsBom>(FLAGS_ZERO);
  const estadoRef = useRef<EstadoBom>({ blocks, aviamentos: aviamentosState, etiquetas: etiquetasState, grades });
  estadoRef.current = { blocks, aviamentos: aviamentosState, etiquetas: etiquetasState, grades };

  const marcarTocado = () => {
    if (colecoesTouchadasRef.current) return;
    colecoesTouchadasRef.current = true;
    setTocado(true);
  };
  const limparTocado = () => { colecoesTouchadasRef.current = false; setTocado(false); };
  const marcarFlag = (k: keyof FlagsBom) => { flagsRef.current = { ...flagsRef.current, [k]: true }; };
  const limparFlags = () => { flagsRef.current = FLAGS_ZERO; };

  // Trocar de card na MESMA instância (ex.: Dialog → Sheet do card recém-criado) zera tudo (Dev :674-690).
  useEffect(() => {
    setBlocks(makeEmptyBlocks());
    setAviamentosState([]);
    setEtiquetasState([]);
    setGrades([]);
    setHidratado(false);
    setConfirmGrade(null);
    setCamposCopiados(new Set());
    colecoesTouchadasRef.current = false;
    setTocado(false);
    flagsRef.current = FLAGS_ZERO;
  }, [modeloId]);

  // Variante → artigo dos pools (Dev :776-803): alimenta substitutos órfãos e o custo pelo maior preço.
  const relevantes = useMemo(
    () => relevantArtigoIds({
      planejados: tecidosPlanejados ?? [],
      extras: [...dados.artigosForro.map((a) => a.id), ...dados.artigosEntretela.map((a) => a.id)],
      blocks,
    }),
    [tecidosPlanejados, dados.artigosForro, dados.artigosEntretela, blocks],
  );
  const qVarianteArtigo = useQuery({
    queryKey: ["plan-ficha-variante-artigo", relevantes.join(",")],
    enabled: habilitada && relevantes.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("variantes_tecido").select("id, artigo_id").in("artigo_id", relevantes);
      if (error) throw error;
      const m: Record<string, string> = {};
      (data ?? []).forEach((v: any) => { if (v.artigo_id) m[v.id] = v.artigo_id; });
      return m;
    },
  });
  const varianteArtigoMap = qVarianteArtigo.data ?? MAPA_VAZIO;
  const varianteArtigoMapPronto = relevantes.length === 0 || qVarianteArtigo.isSuccess;
  const varianteArtigoMapRef = useRef(varianteArtigoMap);
  varianteArtigoMapRef.current = varianteArtigoMap;

  // ── Carga (Dev :870-957, :976-984, :1029-1038) ── só com as 5 queries prontas e NADA tocado.
  const planejadosKey = JSON.stringify(tecidosPlanejados ?? []);
  useEffect(() => {
    if (!habilitada) return;
    const { tecidosData, ocLinksData, aviamentosData, etiquetasData, gradesData } = dados;
    if (!tecidosData || !ocLinksData || !aviamentosData || !etiquetasData || !gradesData) return;
    // Colab: com alguma coleção tocada NÃO sobrescreve — mas COMPARA (R5a do re-check do guardião). O `aoMudarNoServidor`
    // só confere quando o rev chega com o BOM JÁ tocado; se o rev chegou com o BOM INTOCADO (ele só invalidou) e o usuário
    // tocou ANTES de o refetch chegar, é AQUI que o BOM alheio aparece — sem comparar, o Salvar passaria o `.eq("rev")`
    // (o merge já avançou o rev) e `salvar_modelo_bom(_rev_base:null)` sobrescreveria o BOM de outra pessoa sem aviso.
    // Cobre também o refetch de foco. O orquestrador compara a assinatura × referência e acende "Tecidos & BOM".
    if (colecoesTouchadasRef.current) {
      aoRecarregarRef.current?.(estadoBomDoServidor({
        tecidos: tecidosData.tecidos, variantes: tecidosData.variantes, ocLinks: ocLinksData,
        aviamentos: aviamentosData, etiquetas: etiquetasData, grades: gradesData,
        planejados: JSON.parse(planejadosKey) as string[],
      }));
      return;
    }
    setBlocks(hidratarBlocos({ tecidos: tecidosData.tecidos, variantes: tecidosData.variantes, ocLinks: ocLinksData, planejados: JSON.parse(planejadosKey) as string[] }));
    setAviamentosState(hidratarAviamentos(aviamentosData));
    setEtiquetasState(hidratarEtiquetas(etiquetasData));
    setGrades(hidratarGrades(gradesData));
    setHidratado(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [habilitada, dados.tecidosData, dados.ocLinksData, dados.aviamentosData, dados.etiquetasData, dados.gradesData, planejadosKey, hidratarTick]);

  // Preços chegam DEPOIS da carga (Dev :959-1027): recalcula SÓ custo_previsto. Guarda de mapa vazio +
  // guarda de no-op (só troca o array se algum custo mudou) — sem ciclo.
  useEffect(() => {
    if (Object.keys(dados.aviamentoMap).length === 0) return;
    setAviamentosState((rows) => {
      if (!rows.length) return rows;
      const next = rows.map((r) => recomputeAviamento(r, dados.aviamentoMap));
      return next.some((r, i) => r.custo_previsto !== rows[i].custo_previsto) ? next : rows;
    });
  }, [dados.aviamentoMap, dados.aviamentosData, hidratarTick]);
  useEffect(() => {
    if (Object.keys(dados.etiquetaMap).length === 0) return;
    setEtiquetasState((rows) => {
      if (!rows.length) return rows;
      const next = rows.map((r) => recomputeEtiqueta(r, dados.etiquetaMap));
      return next.some((r, i) => r.custo_previsto !== rows[i].custo_previsto) ? next : rows;
    });
  }, [dados.etiquetaMap, dados.etiquetasData, hidratarTick]);
  useEffect(() => {
    if (Object.keys(dados.artigoMap).length === 0) return;
    setBlocks((bs) => {
      if (!bs.length) return bs;
      // Custo congelado pela OC vinculada (Fase B): recomputeBlock usa `frozenPrecos["tipo|numero"]`.
      const next = bs.map((b) => recomputeBlock(b, dados.artigoMap, varianteArtigoMap, dados.frozenPrecos));
      return next.some((b, i) => b.custo_previsto !== bs[i].custo_previsto) ? next : bs;
    });
  }, [dados.artigoMap, varianteArtigoMap, dados.frozenPrecos, dados.tecidosData, hidratarTick]);

  // Herança de grade (Dev :1441-1468): variante nova do Tecido 1 herda a grade da 1ª. Monotônica.
  const tecido1VarianteIds = useMemo(() => calcTecido1VarianteIds(blocks), [blocks]);
  useEffect(() => {
    if (!hidratado || tecido1VarianteIds.length === 0) return;
    setGrades((prev) => herdarGrades(prev, tecido1VarianteIds.length));
  }, [tecido1VarianteIds, hidratado, grades]);

  const tamanhos = dados.tamanhos;
  const frozen = dados.frozenPrecos;

  // ── Handlers (Dev :2435-2652) ──
  const updateBlock = (idx: number, patch: Partial<TecidoBlock>) => {
    marcarTocado();
    // Só consumo/%loss mudam a metragem (#Erro); trocar artigo/substituto não.
    if (patch.consumo !== undefined || patch.loss_percent !== undefined) marcarFlag("consumo");
    // (Dev :2441-2456 — propagação BOM→CAD — entra na F3.3 junto com o CAD.)
    const target = blocks[idx];
    const isTecido1 = target?.tipo === "tecido" && target?.numero === 1;
    const applyPatch = () => {
      setBlocks((bs) => bs.map((b, i) => {
        if (i !== idx) return b;
        let merged = { ...b, ...patch };
        // Substituto removido: descarta variantes que pertenciam a ele (ficariam órfãs fora do pool).
        if (patch.artigoIdsExtra !== undefined) {
          const pool = new Set<string>([merged.artigo_id, ...merged.artigoIdsExtra].filter(Boolean) as string[]);
          const variantes = merged.variantes.map((v) => (v && varianteArtigoMap[v] && !pool.has(varianteArtigoMap[v]) ? null : v));
          merged = { ...merged, variantes };
        }
        return recomputeBlock(merged, dados.artigoMap, varianteArtigoMap, frozen);
      }));
    };
    // Trocar o artigo do Tecido 1 zera as variantes; a grade é indexada por elas → confirma e limpa.
    if (isTecido1 && patch.artigo_id !== undefined && patch.artigo_id !== target.artigo_id) {
      const hasGrade = grades.some((g) => g.grade_total > 0 || Object.values(g.grades || {}).some((v) => (v ?? 0) > 0));
      if (hasGrade) {
        setConfirmGrade({
          msg: "Trocar o Tecido 1 vai apagar a grade preenchida. Continuar?",
          onConfirm: () => { setGrades([]); marcarFlag("grade"); applyPatch(); },
        });
        return;
      }
      setGrades([]);
    }
    applyPatch();
  };

  const updateBlockVariante = (idx: number, vIdx: number, value: string | null) => {
    marcarTocado();
    marcarFlag("consumo");
    const target = blocks[idx];
    const isTecido1 = target?.tipo === "tecido" && target?.numero === 1;
    const applyChange = () => {
      setBlocks((bs) => bs.map((b, i) => {
        if (i !== idx) return b;
        if (!value) {
          // Remove SÓ a variante alvo e desloca as seguintes (sem cascata).
          return recomputeBlock(removerVarianteDoBloco(b, vIdx), dados.artigoMap, varianteArtigoMap, frozen);
        }
        const variantes = [...b.variantes];
        const oc_links = (b.oc_links ?? []).map((a) => [...(a ?? [])]);
        while (oc_links.length < 10) oc_links.push([]);
        const complementas: (string[] | null)[] = [...(b.complementas ?? [])];
        while (complementas.length < 10) complementas.push(null);
        const prev = variantes[vIdx];
        variantes[vIdx] = value;
        // Trocou de variante: OC e casamento eram da ANTIGA — zera os dois.
        if (prev !== value) { oc_links[vIdx] = []; complementas[vIdx] = null; }
        return recomputeBlock({ ...b, variantes, oc_links, complementas }, dados.artigoMap, varianteArtigoMap, frozen);
      }));
    };
    if (isTecido1 && !value) {
      // Remover variante do Tecido 1 renumera as cores: a grade SEGUE a variante (v3 vira v2).
      const numeroRemovido = vIdx + 1;
      const remapEAplicar = () => {
        setGrades((gs) => remapGradesAposRemocao(gs, numeroRemovido));
        marcarFlag("grade");
        applyChange();
      };
      const alvo = grades.find((g) => g.variante_numero === numeroRemovido);
      const alvoTemGrade = !!alvo && (alvo.grade_total > 0 || Object.values(alvo.grades || {}).some((v) => (v ?? 0) > 0));
      if (alvoTemGrade) {
        setConfirmGrade({
          msg: `A Variante ${numeroRemovido} possui grade preenchida. Remover mesmo assim? As variantes seguintes mantêm suas grades (renumeradas).`,
          onConfirm: remapEAplicar,
        });
        return;
      }
      remapEAplicar();
      return;
    }
    applyChange();
  };

  const updateBlockOcLinks = (idx: number, vIdx: number, allocs: OcAlloc[]) => {
    marcarTocado();
    setBlocks((bs) => bs.map((b, i) => {
      if (i !== idx) return b;
      const oc_links = (b.oc_links ?? []).map((a) => [...(a ?? [])]);
      while (oc_links.length < 10) oc_links.push([]);
      oc_links[vIdx] = allocs;
      return { ...b, oc_links };
    }));
  };

  const updateAviamento = (idx: number, patch: Partial<AviamentoRow>) => {
    marcarTocado();
    marcarFlag("aviamentos");
    setAviamentosState((rows) => rows.map((r, i) => (i === idx ? recomputeAviamento({ ...r, ...patch }, dados.aviamentoMap) : r)));
  };
  const addAviamento = () => {
    marcarTocado();
    marcarFlag("aviamentos");
    if (aviamentosState.length >= 20) return;
    setAviamentosState((rows) => [...rows, { aviamento_id: null, variante_aviamento_id: null, consumo: 0, loss_percent: 0, custo_previsto: 0 }]);
  };
  const removeAviamento = (idx: number) => {
    marcarTocado();
    marcarFlag("aviamentos");
    setAviamentosState((rows) => rows.filter((_, i) => i !== idx));
  };

  const updateEtiqueta = (idx: number, patch: Partial<ModeloEtiquetaRow>) => {
    marcarTocado();
    setEtiquetasState((rows) => rows.map((r, i) => (i === idx ? recomputeEtiqueta({ ...r, ...patch }, dados.etiquetaMap) : r)));
  };
  const addEtiqueta = () => {
    marcarTocado();
    if (etiquetasState.length >= 20) return;
    setEtiquetasState((rows) => [...rows, { etiqueta_id: null, cor_id: null, consumo: 0, loss_percent: 0, custo_previsto: 0 }]);
  };
  const removeEtiqueta = (idx: number) => {
    marcarTocado();
    setEtiquetasState((rows) => rows.filter((_, i) => i !== idx));
  };

  const updateGradeTotal = (n: number, total: number) => {
    marcarTocado();
    marcarFlag("grade");
    setGrades((gs) => {
      const cur = gs.find((g) => g.variante_numero === n) ?? { variante_numero: n, grades: {}, grade_total: 0 };
      const next = { ...cur.grades, ...distribuiTotal(total, tamanhos, proporcoes ?? {}) };
      const others = gs.filter((g) => g.variante_numero !== n);
      return [...others, { variante_numero: n, grades: next, grade_total: total }].sort((a, b) => a.variante_numero - b.variante_numero);
    });
  };
  const updateGradeCell = (n: number, tam: string, qty: number) => {
    marcarTocado();
    marcarFlag("grade");
    setGrades((gs) => {
      const cur = gs.find((g) => g.variante_numero === n) ?? { variante_numero: n, grades: {}, grade_total: 0 };
      const props = proporcoes ?? {};
      const propTam = Number(props[tam]) || 0;
      // Auto: a célula digitada vira ÂNCORA e distribui pela proporção; senão só grava a célula.
      const next = gradeAuto && qty > 0 && propTam > 0 ? distribuiAncora(qty, tam, tamanhos, props) : { ...cur.grades, [tam]: qty };
      const realTotal = tamanhos.reduce((s, t) => s + (Number(next[t]) || 0), 0);
      const others = gs.filter((g) => g.variante_numero !== n);
      return [...others, { variante_numero: n, grades: next, grade_total: realTotal }].sort((a, b) => a.variante_numero - b.variante_numero);
    });
  };
  const updateProporcao = (tam: string, val: number) => {
    marcarFlag("grade");
    const oldProp = proporcoes ?? {};
    const newProp = { ...oldProp, [tam]: Math.max(0, val) };
    // Proporções são coluna de `modelos` (Draft) — o "não salvo"/merge do draft cobrem.
    setDraftTracked((d) => ({ ...d, proporcoes: newProp }));
    if (gradeAuto) {
      marcarTocado();
      const oldSum = tamanhos.reduce((s, t) => s + (Number(oldProp[t]) || 0), 0);
      if (oldSum > 0) {
        setGrades((gs) => gs.map((g) => {
          const total = g.grade_total || 0;
          if (total <= 0) return g;
          const next = redistribuiPorEscala(total / oldSum, tamanhos, newProp);
          return { ...g, grades: next, grade_total: somaGrade(next) };
        }));
      }
    }
  };
  const toggleGradeAuto = (v: boolean) => {
    setGradeAuto(v);
    if (!v) return;
    const props = proporcoes ?? {};
    const sum = tamanhos.reduce((s, t) => s + (Number(props[t]) || 0), 0);
    if (sum <= 0) return;
    marcarTocado();
    marcarFlag("grade");
    setGrades((gs) => gs.map((g) => {
      const total = g.grade_total || 0;
      if (total <= 0) return g;
      return { ...g, grades: distribuiTotal(total, tamanhos, props), grade_total: total };
    }));
  };

  const onCampoEditado = (chave: string) => setCamposCopiados((prev) => {
    if (!prev.has(chave)) return prev;
    const n = new Set(prev); n.delete(chave); return n;
  });
  const marcarCopiados = (campos: Set<string>) => setCamposCopiados((prev) => new Set([...prev, ...campos]));
  const limparCopiados = () => setCamposCopiados(new Set());

  /** "Descartar e recarregar" do conflito de seção: solta o tocado e força reaplicar o que está no cache. */
  const descartarEdicoes = () => {
    limparTocado();
    limparFlags();
    limparCopiados();
    setConfirmGrade(null);
    setHidratarTick((n) => n + 1);
  };

  return {
    blocks, aviamentosState, etiquetasState, grades, gradeAuto, hidratado, tocado,
    colecoesTouchadasRef, estadoRef, flagsRef,
    varianteArtigoMap, varianteArtigoMapRef, varianteArtigoMapPronto, tecido1VarianteIds,
    confirmGrade, setConfirmGrade,
    camposCopiados, onCampoEditado, marcarCopiados, limparCopiados,
    limparTocado, limparFlags, descartarEdicoes,
    handlers: {
      updateBlock, updateBlockVariante, updateBlockOcLinks,
      updateAviamento, addAviamento, removeAviamento,
      updateEtiqueta, addEtiqueta, removeEtiqueta,
      updateGradeTotal, updateGradeCell, updateProporcao, toggleGradeAuto,
    },
  };
}
```

- [ ] **Step 3: Gates**

Os 5 gates (`tsc` 0; o hook ainda não é usado).

- [ ] **Step 4: Commit**

```bash
git add -- src/components/planejamento/planejamento-detail/ficha/useFichaGuarda.ts src/components/planejamento/planejamento-detail/ficha/useFichaBom.ts
git commit --only -m "feat(planejamento): F3.2 (6) — useFichaBom/useFichaGuarda: estado, carga e handlers do BOM portados do Dev

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- src/components/planejamento/planejamento-detail/ficha/useFichaGuarda.ts src/components/planejamento/planejamento-detail/ficha/useFichaBom.ts
```

**Revisão individual (Opus):** paridade handler a handler com o Dev (`:2435-2652`) — atenção a `marcarTocado` em TODO caminho que muda `blocks/aviamentos/etiquetas/grades`; carga só com as 5 queries; nada tocado ⇒ hidrata; tocado ⇒ NÃO sobrescreve e chama `aoRecarregarComTocado` com o BOM do servidor montado por `estadoBomDoServidor` (R5a — mesma montagem do `bomMudouNoServidor`); `hidratarTick` nos 4 efeitos; guarda: prove com 3 cenários mentais (abrir e não mexer ⇒ nunca "não salvo"; preço chegando depois ⇒ não suja; tocar e desfazer ⇒ limpa); o reset por `modeloId`.

---

## Task 7: `useFichaTecnica` (orquestrador) + `persistir-bom.ts`  *(individual Opus)*

**Files:**
- Create: `src/components/planejamento/planejamento-detail/ficha/useFichaTecnica.ts`
- Create: `src/components/planejamento/planejamento-detail/ficha/persistir-bom.ts`

**Interfaces:**
- Consumes: Tasks 2, 3, 5, 6; `useAuth`; `useEtapasAfetadas` (`@/components/desenvolvimento/DownstreamImpactAlert`, só importar); `labelVarianteRow`; `CustoAdicional` (`ModeloCustosSection`, só o tipo); `Draft`; (F3.1) `type MotivoTravaDev` (`./secoes/AvisoCamposDev`).
- Produces:
  - `FichaSave = { podeGravarColunasDev: boolean; podeVerCustos: boolean; conflitoBomRef: RefObject<boolean>; verificandoBomRef: RefObject<boolean>; colecoesTouchadasRef: RefObject<boolean>; setConflitoBom: (v: boolean) => void; bomMudouNoServidor: () => Promise<boolean>; capturar: (custosAdicionais: unknown) => BomCapturado; aposSalvar: (a: { bomEnviado: BomCapturado }) => { bomMudouEmVoo: boolean }; etapas: { corte?: boolean; baixa_total?: number } }`.
  - `MotivoSomenteLeitura = "permissao" | "enviado" | "carregando" | "cad" | null` — trava ÚNICA (R2 do G-plano conjunto): deriva de `travaDev` (= `motivoTravaDev` da F3.1, que já considera o "Editar") + a trava interina "tem CAD".
  - `useFichaTecnica({ modeloId, isEdit, isComprado, tecidosPlanejados, proporcoes, custosAdicionais, setDraftTracked, maoObraVivo, travaDev })` → `FichaTecnica` (tipo = `ReturnType`) com `habilitada, carregado, podeEditar, podeVerCustos, motivoSomenteLeitura, dados, estado, handlers, gradeAuto, tecido1Info, totais, selos, confirmGrade, setConfirmGrade, camposCopiados, onCampoEditado, marcarCopiados, dirty, colab: { conflitoBom, verificandoBom, aoMudarNoServidor, resolverConflitoBom }, save: FichaSave`.
  - Conflito "Tecidos & BOM" (R5 do G-plano conjunto): só quando o BOM do SERVIDOR mudou de verdade em relação à REFERÊNCIA (assinatura do BOM do servidor sobre o qual o usuário editou — acompanha o estado enquanto nada foi tocado; depois de um Salvar que gravou o BOM, vira o ENVIADO). Ações do próprio usuário que só sobem o `rev` (Mover para…, Ordem de Criação, Lançar, aprovar MO) e o eco do próprio save não acendem o aviso. Dois pontos comparam: (1) `aoMudarNoServidor` — rev novo com o BOM JÁ tocado: recarrega e confere; enquanto confere, o Salvar espera (`verificandoBomRef`); (2) **R5a do re-check do guardião** — a CARGA que chega com o BOM tocado (rev que veio com o BOM intocado e toque antes do refetch, ou refetch de foco) chama `aoRecarregarComTocado`, que compara com a mesma regra. `aposSalvar` invalida a conferência em voo (`geracaoRef += 1`, NOTA do re-check) para o eco do próprio save não deixar o aviso aceso.
  - `persistirBom(modeloId: string, bom: BomCapturado): Promise<void>`; `gravarTecidosIniciais(modeloIdRecemCriado: string, artigoIds: string[]): Promise<void>`.

- [ ] **Step 1: Criar `persistir-bom.ts`**

```ts
// F3.2 — gravações do BOM feitas pelo Sheet do Planejamento (fora do React). Toda escrita de BOM passa por
// `salvar_modelo_bom` (a RPC guarda snapshot em `modelo_bom_snapshots` antes de apagar — G-inicial #7);
// etiquetas por diff de id em `modelo_etiquetas` (MESMO caminho do Dev, ModeloDetailPanel.tsx:2038-2060 —
// etiqueta não reserva estoque, fica fora da RPC).
import { supabase } from "@/integrations/supabase/client";
import {
  blocosTecidosIniciais, montarAviamentosPayload, montarGradesPayload, montarTecidosPayload, planoEtiquetas,
  type BomCapturado,
} from "./ficha-calc";

/** Grava o BOM capturado. `_rev_base: null`: a trava otimista já validou no UPDATE de `modelos` (Dev :1950-1959). */
export async function persistirBom(modeloId: string, bom: BomCapturado): Promise<void> {
  const { error: eBom } = await supabase.rpc("salvar_modelo_bom" as any, {
    _modelo_id: modeloId,
    _tecidos: montarTecidosPayload(bom.estado.blocks) as any,
    _aviamentos: montarAviamentosPayload(bom.estado.aviamentos) as any,
    _grades: montarGradesPayload(bom.estado.grades) as any,
    _rev_base: null,
  });
  if (eBom) throw eBom;
  const plano = planoEtiquetas(bom.estado.etiquetas, bom.idsEtiquetasServidor, modeloId);
  for (const op of plano.ops) {
    if (op.tipo === "atualizar") {
      const { error } = await supabase.from("modelo_etiquetas" as any).update(op.row).eq("id", op.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("modelo_etiquetas" as any).insert(op.row);
      if (error) throw error;
    }
  }
  if (plano.apagar.length > 0) {
    const { error } = await supabase.from("modelo_etiquetas" as any).delete().in("id", plano.apagar);
    if (error) throw error;
  }
}

/**
 * G-mockup R3 / decisão F3 #9 — BOM inicial = Tecido 1..3 só com o artigo. ⚠️ SÓ para modelo RECÉM-CRIADO
 * (Dialog "Novo Modelo" e Duplicar): `salvar_modelo_bom` APAGA o BOM inteiro antes de inserir.
 */
export async function gravarTecidosIniciais(modeloIdRecemCriado: string, artigoIds: string[]): Promise<void> {
  const tecidos = blocosTecidosIniciais(artigoIds);
  if (tecidos.length === 0) return;
  const { error } = await supabase.rpc("salvar_modelo_bom" as any, {
    _modelo_id: modeloIdRecemCriado,
    _tecidos: tecidos as any,
    _aviamentos: [] as any,
    _grades: [] as any,
    _rev_base: null,
  });
  if (error) throw error;
}
```

- [ ] **Step 2: Criar `useFichaTecnica.ts`**

```ts
// F3.2 — ORQUESTRADOR da ficha técnica (BOM) no Sheet do Planejamento de Produto. Compõe useFichaDados
// (queries) + useFichaBom (estado/handlers) + useFichaGuarda ("não salvo") e expõe 3 superfícies:
//  • seções (render das seções 5-8 e das linhas de custo do BOM na tabela de Preço e Custos);
//  • colab (conflito de SEÇÃO "Tecidos & BOM" — Dev :599-603, :838-843, :1813-1842 — só quando o BOM do SERVIDOR
//    mudou de verdade: R5 do G-plano conjunto);
//  • `save` (FichaSave — consumida por usePlanejamentoSave).
// Trava ÚNICA (R2 do G-plano conjunto): deriva da trava da F3.1 (`travaDev`) + a trava interina "tem CAD".
// Porta a orquestração do PanelContent do Dev (ModeloDetailPanel.tsx), que fica intocado até a F5.
import { useEffect, useMemo, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { labelVarianteRow } from "@/lib/variante";
import { useEtapasAfetadas } from "@/components/desenvolvimento/DownstreamImpactAlert";
import type { Draft } from "@/components/planejamento/modelo-shared";
import type { CustoAdicional } from "@/components/desenvolvimento/modelo-detail/ModeloCustosSection";
import type { MotivoTravaDev } from "./secoes/AvisoCamposDev";
import { chavesFichaBom, useFichaDados } from "./useFichaDados";
import { useFichaBom } from "./useFichaBom";
import { useFichaGuarda } from "./useFichaGuarda";
import {
  assinaturaBom, bomDivergeDaReferencia, estadoBomDoServidor,
  paresComplementares, resumoBom, snapshotBom, tecido1VariantesInfo, tecidosPlanejadosDerivados, totaisBom,
  type AviamentoRowDb, type BomCapturado, type EstadoBom, type EtiquetaRowDb, type GradeRowDb, type OcLinkRowDb,
  type TecidoRowDb, type VarianteRowDb,
} from "./ficha-calc";
import { requisitosUniao, seloSecaoBom, type SecaoBomKey, type SeloSecao } from "./selos-bom";

const SEM_LABELS: Record<string, string> = {};

export type FichaSave = {
  /** habilitada E carregada E sem trava (permissão / enviado / tem CAD) ⇒ colunas do Dev vão no UPDATE. */
  podeGravarColunasDev: boolean;
  /** `criacao_planejamento:custos` OU `criacao_desenvolvimento:custos` (decisão F3 #2). */
  podeVerCustos: boolean;
  conflitoBomRef: RefObject<boolean>;
  /** R5 — rev novo com o BOM tocado: conferindo se o BOM do SERVIDOR mudou. O Salvar espera (mensagem própria). */
  verificandoBomRef: RefObject<boolean>;
  colecoesTouchadasRef: RefObject<boolean>;
  setConflitoBom: (v: boolean) => void;
  /** R5 — recarrega o BOM e diz se ele mudou em relação à referência (true em erro — conservador). */
  bomMudouNoServidor: () => Promise<boolean>;
  /** Congela o BOM no início do Salvar (lê refs — vale mesmo no retry, fora do ciclo de render). */
  capturar: (custosAdicionais: unknown) => BomCapturado;
  /** Pós-save: re-baseia (edição em voo segue "não salva"), a referência vira o ENVIADO, limpa marcadores, invalida o BOM. */
  aposSalvar: (a: { bomEnviado: BomCapturado }) => { bomMudouEmVoo: boolean };
  etapas: { corte?: boolean; baixa_total?: number };
};

/**
 * Por que o BOM está só-leitura. Trava ÚNICA (R2): "permissao" e "enviado" vêm da trava da F3.1 (`motivoTravaDev`, com o
 * "Editar" já considerado); "cad" = trava INTERINA da F3.2 (a F3.3 tira: grava o CAD no Salvar e o "Editar" passa a
 * destravar o BOM também).
 */
export type MotivoSomenteLeitura = "permissao" | "enviado" | "carregando" | "cad" | null;

export function useFichaTecnica(a: {
  modeloId: string | null;
  isEdit: boolean;
  isComprado: boolean;
  tecidosPlanejados: string[];
  proporcoes: Record<string, number>;
  custosAdicionais: CustoAdicional[];
  setDraftTracked: Dispatch<SetStateAction<Draft>>;
  /** M.O. ao vivo (Σ do rascunho de MO do Planejamento) — entra no Custo de 1 Peça exibido. */
  maoObraVivo: number;
  /** F3.1 — `motivoTravaDev` do orquestrador ("sem_permissao" | "enviado" | null; o "Editar" já zera o "enviado"). */
  travaDev: MotivoTravaDev;
}) {
  const qc = useQueryClient();
  const { canView, canEdit } = useAuth();
  // Decisão F3 #8: seções do Dev visíveis p/ quem VÊ o Desenvolvimento, editáveis p/ quem o EDITA.
  const podeVerFicha = canView("criacao_desenvolvimento");
  const podeEditarFicha = canEdit("criacao_desenvolvimento");
  const podeVerCustos = canView("criacao_planejamento:custos") || canView("criacao_desenvolvimento:custos");
  // Só produto interno na F3.2 (decisão F3 #4; comprado = F3.4).
  const habilitada = a.isEdit && !!a.modeloId && !a.isComprado && podeVerFicha;

  const dados = useFichaDados({ modeloId: a.modeloId, habilitada });
  // R5a (re-check do guardião): a carga do BOM chegou com o BOM JÁ tocado — ela não sobrescreve, mas passa o BOM do
  // servidor para comparar com a referência. A função real é montada mais abaixo (usa a referência e o setter do
  // conflito, declarados depois); a carga sempre chama a versão atual, pelo ref.
  const aoRecarregarComTocadoRef = useRef<(servidor: EstadoBom) => void>(() => undefined);
  const bom = useFichaBom({
    modeloId: a.modeloId, habilitada, dados,
    tecidosPlanejados: a.tecidosPlanejados, proporcoes: a.proporcoes, setDraftTracked: a.setDraftTracked,
    aoRecarregarComTocado: (servidor) => aoRecarregarComTocadoRef.current(servidor),
  });

  const estado: EstadoBom = useMemo(
    () => ({ blocks: bom.blocks, aviamentos: bom.aviamentosState, etiquetas: bom.etiquetasState, grades: bom.grades }),
    [bom.blocks, bom.aviamentosState, bom.etiquetasState, bom.grades],
  );
  const snapshot = useMemo(() => snapshotBom(estado), [estado]);
  const guarda = useFichaGuarda({ modeloId: a.modeloId, snapshot, tocado: bom.tocado, hidratado: bom.hidratado });

  const carregado = habilitada && bom.hidratado && dados.catalogosProntos && bom.varianteArtigoMapPronto;
  // Trava ÚNICA (R2 do G-plano conjunto): DERIVA da trava da F3.1 e soma a trava INTERINA "tem CAD" (até a F3.3):
  // sem regravar o CAD, um consumo editado aqui seria DEVOLVIDO pelo próximo Salvar do Dev (salvar_cad_completo copia
  // consumo_cad → BOM, funcoes.sql:6878-6881) e a Explosão ficaria desalinhada. Card enviado ⇒ tem CAD (0 exceções na
  // cópia local): o "Editar" da F3.1 destrava os campos simples do Dev, mas aqui o motivo só passa de "enviado" a "cad".
  const motivoSomenteLeitura: MotivoSomenteLeitura =
    a.travaDev === "sem_permissao" || !podeEditarFicha ? "permissao"
      : a.travaDev === "enviado" ? "enviado"
        : !dados.cadFetched ? "carregando"
          : dados.cadExiste ? "cad"
            : null;
  const podeEditar = carregado && motivoSomenteLeitura === null;

  // Rótulos das variantes do Tecido 1 e dos pares casados (Dev :1470-1529) — só p/ o texto da Grade.
  const t1Ids = bom.tecido1VarianteIds;
  const qLabelsT1 = useQuery({
    queryKey: ["plan-ficha-variantes-labels", t1Ids.join(",")],
    enabled: habilitada && t1Ids.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("variantes_tecido")
        .select("id, nome_variante, codigo_variante, cor:cor_id(nome), apelido:cor_apelido_id(nome)")
        .in("id", t1Ids);
      if (error) throw error;
      const map: Record<string, string> = {};
      (data ?? []).forEach((v: any) => { const l = labelVarianteRow(v); map[v.id] = l !== "—" ? l : ""; });
      return map;
    },
  });
  const pares = useMemo(() => paresComplementares(bom.blocks), [bom.blocks]);
  const compVarIds = useMemo(() => Array.from(new Set(pares.map((p) => p.compVarId))), [pares]);
  const qLabelsComp = useQuery({
    queryKey: ["plan-ficha-variantes-labels-comp", compVarIds.join(",")],
    enabled: habilitada && compVarIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("variantes_tecido")
        .select("id, nome_variante, codigo_variante, cor:cor_id(nome), apelido:cor_apelido_id(nome)")
        .in("id", compVarIds);
      if (error) throw error;
      const map: Record<string, string> = {};
      (data ?? []).forEach((v: any) => { const l = labelVarianteRow(v); map[v.id] = l !== "—" ? l : ""; });
      return map;
    },
  });
  const tecido1Info = useMemo(() => tecido1VariantesInfo({
    ids: t1Ids,
    labels: qLabelsT1.data ?? SEM_LABELS,
    varianteArtigoMap: bom.varianteArtigoMap,
    nomeArtigo: (id) => (id ? dados.artigoMap[id]?.nome : undefined),
    pares,
    compLabels: qLabelsComp.data ?? SEM_LABELS,
  }), [t1Ids, qLabelsT1.data, bom.varianteArtigoMap, dados.artigoMap, pares, qLabelsComp.data]);

  // Custo de 1 Peça AO VIVO (MO do rascunho) — Dev :1388-1401.
  const totais = useMemo(
    () => totaisBom({ blocks: bom.blocks, aviamentos: bom.aviamentosState, etiquetas: bom.etiquetasState, custosAdicionais: a.custosAdicionais, maoObra: a.maoObraVivo }),
    [bom.blocks, bom.aviamentosState, bom.etiquetasState, a.custosAdicionais, a.maoObraVivo],
  );

  // Selos por seção (mapa próprio — decisão 8). Requisitos por ORIGEM (Dev :1652-1657).
  const resumo = useMemo(() => resumoBom(estado), [estado]);
  const requeridas = useMemo(
    () => requisitosUniao(a.isComprado ? dados.revendaCfg.requisitos : (dados.tenantCfg as any)?.kanban_requisitos),
    [a.isComprado, dados.revendaCfg, dados.tenantCfg],
  );
  const selos: Record<SecaoBomKey, SeloSecao> = {
    tecidos: seloSecaoBom("tecidos", requeridas, dados.condicoes, resumo),
    aviamentos: seloSecaoBom("aviamentos", requeridas, dados.condicoes, resumo),
    insumos: seloSecaoBom("insumos", requeridas, dados.condicoes, resumo),
    grade: seloSecaoBom("grade", requeridas, dados.condicoes, resumo),
  };

  // ── Colab: conflito de SEÇÃO (R5 do G-plano conjunto) ──
  const [conflitoBom, setConflitoBom] = useState(false);
  const conflitoBomRef = useRef(false);
  const setConflitoBomBoth = (v: boolean) => { conflitoBomRef.current = v; setConflitoBom(v); };
  const [verificandoBom, setVerificandoBom] = useState(false);
  const verificandoBomRef = useRef(false);
  const setVerificandoBoth = (v: boolean) => { verificandoBomRef.current = v; setVerificandoBom(v); };
  const geracaoRef = useRef(0);
  // REFERÊNCIA = assinatura do BOM do SERVIDOR sobre o qual o usuário está editando. Enquanto nada foi tocado ela
  // ACOMPANHA o estado (que é o do servidor recém-carregado); depois de um Salvar que gravou o BOM, vira o ENVIADO (o
  // servidor passa a ter exatamente isso); no "manter meu", vira o do servidor que causou o aviso (só um conflito NOVO
  // acende de novo).
  const referenciaRef = useRef<string | null>(null);
  const ultimaAssinaturaServidorRef = useRef<string | null>(null);
  const tecidosPlanejadosRef = useRef(a.tecidosPlanejados);
  tecidosPlanejadosRef.current = a.tecidosPlanejados;
  useEffect(() => {
    conflitoBomRef.current = false; setConflitoBom(false);
    verificandoBomRef.current = false; setVerificandoBom(false);
    referenciaRef.current = null;
    ultimaAssinaturaServidorRef.current = null;
    geracaoRef.current += 1;
  }, [a.modeloId]);
  useEffect(() => {
    if (bom.hidratado && !bom.tocado) referenciaRef.current = assinaturaBom(estado);
  }, [estado, bom.hidratado, bom.tocado]);
  const invalidarBom = () => { for (const k of chavesFichaBom(a.modeloId)) qc.invalidateQueries({ queryKey: k }); };

  /** R5 — recarrega as 5 queries do BOM e compara o do servidor com a referência. Erro ⇒ true (na dúvida, avisa). */
  const bomMudouNoServidor = async (): Promise<boolean> => {
    const id = a.modeloId;
    try {
      const chaves = [["plan-ficha-tecidos", id], ["plan-ficha-oc-links", id], ["plan-ficha-aviamentos", id], ["plan-ficha-etiquetas", id], ["plan-ficha-grades", id]];
      await Promise.all(chaves.map((k) => qc.refetchQueries({ queryKey: k, exact: true })));
      const tec = qc.getQueryData<{ tecidos: TecidoRowDb[]; variantes: VarianteRowDb[] }>(["plan-ficha-tecidos", id]);
      const oc = qc.getQueryData<OcLinkRowDb[]>(["plan-ficha-oc-links", id]);
      const av = qc.getQueryData<AviamentoRowDb[]>(["plan-ficha-aviamentos", id]);
      const et = qc.getQueryData<EtiquetaRowDb[]>(["plan-ficha-etiquetas", id]);
      const gr = qc.getQueryData<GradeRowDb[]>(["plan-ficha-grades", id]);
      if (!tec || !oc || !av || !et || !gr) return true;
      const servidor = estadoBomDoServidor({
        tecidos: tec.tecidos, variantes: tec.variantes, ocLinks: oc, aviamentos: av, etiquetas: et, grades: gr,
        planejados: tecidosPlanejadosRef.current,
      });
      ultimaAssinaturaServidorRef.current = assinaturaBom(servidor);
      return bomDivergeDaReferencia(referenciaRef.current, servidor);
    } catch {
      return true;
    }
  };

  /**
   * Chamar quando o `rev` do modelo mudou (save de outra pessoa, eco do meu save, ou ação MINHA que mexe em `modelos`
   * — Mover para…, Ordem de Criação, Lançar, aprovar MO). Sem BOM tocado: só recarrega (a carga reaplica e a referência
   * acompanha; se o usuário tocar ANTES de o refetch chegar, a CARGA compara — R5a, `aoRecarregarComTocadoRef`). Com BOM
   * tocado: CONFERE se o BOM do servidor mudou de verdade e só então acende "Tecidos & BOM" — o eco das ações do próprio
   * usuário (que não mexem no BOM) é ignorado. Enquanto ESTA conferência roda, o Salvar espera (`verificandoBomRef`).
   * Sobra uma janela de ~1 ida e volta (tocar E salvar antes de o refetch do caminho "sem toque" chegar) — a mesma
   * classe de janela do Dev, que nem compara (decisão 8; §5 R7/R20).
   */
  const aoMudarNoServidor = () => {
    if (!habilitada) return;
    if (!bom.colecoesTouchadasRef.current) { invalidarBom(); return; }
    const geracao = ++geracaoRef.current;
    setVerificandoBoth(true);
    void bomMudouNoServidor().then((mudou) => {
      if (geracao !== geracaoRef.current) return; // chegou outra mudança depois — a conferência dela decide
      setVerificandoBoth(false);
      if (mudou && bom.colecoesTouchadasRef.current) setConflitoBomBoth(true);
    });
  };
  /** "manter meu" → fecha o aviso (o próximo Salvar sobrescreve); "usar o novo" → descarta e recarrega. */
  const resolverConflitoBom = (manterMeu: boolean) => {
    setConflitoBomBoth(false);
    if (manterMeu) {
      // Já vi ESTA versão do servidor: só um conflito NOVO acende o aviso de novo.
      if (ultimaAssinaturaServidorRef.current) referenciaRef.current = ultimaAssinaturaServidorRef.current;
      return;
    }
    bom.descartarEdicoes();
    invalidarBom();
  };
  // R5a — a carga chegou com o BOM tocado (ver a declaração do ref, acima): MESMA regra do `bomMudouNoServidor` —
  // guarda a assinatura (p/ o "manter meu") e acende "Tecidos & BOM" se o BOM do servidor divergir da referência.
  aoRecarregarComTocadoRef.current = (servidor) => {
    ultimaAssinaturaServidorRef.current = assinaturaBom(servidor);
    if (bom.colecoesTouchadasRef.current && bomDivergeDaReferencia(referenciaRef.current, servidor)) setConflitoBomBoth(true);
  };

  const { etapas } = useEtapasAfetadas(habilitada && a.modeloId ? a.modeloId : "");

  const save: FichaSave = {
    podeGravarColunasDev: podeEditar,
    podeVerCustos,
    conflitoBomRef,
    verificandoBomRef,
    colecoesTouchadasRef: bom.colecoesTouchadasRef,
    setConflitoBom: setConflitoBomBoth,
    bomMudouNoServidor,
    capturar: (custosAdicionais) => {
      const e = bom.estadoRef.current;
      const snap = snapshotBom(e);
      const base = guarda.baselineRef.current;
      // "BOM só grava quando carregado E sujo" — `podeEditar` já exige carregado (e sem trava).
      const gravar = podeEditar && bom.colecoesTouchadasRef.current && (base === null || snap !== base);
      return {
        estado: e,
        snapshot: snap,
        gravar,
        flags: { ...bom.flagsRef.current },
        idsEtiquetasServidor: (dados.etiquetasDataRef.current ?? []).map((x) => x.id),
        tecidosPlanejados: tecidosPlanejadosDerivados(e.blocks, bom.varianteArtigoMapRef.current),
        totais: podeEditar ? totaisBom({ blocks: e.blocks, aviamentos: e.aviamentos, etiquetas: e.etiquetas, custosAdicionais, maoObra: 0 }) : null,
      };
    },
    aposSalvar: ({ bomEnviado }) => {
      const vivo = snapshotBom(bom.estadoRef.current);
      const bomMudouEmVoo = bom.colecoesTouchadasRef.current && vivo !== bomEnviado.snapshot;
      if (bomMudouEmVoo) guarda.rebasear(bomEnviado.snapshot);
      else bom.limparTocado();
      // R5 — o servidor passa a ter o que foi ENVIADO: é a nova referência (o eco do meu save não acende conflito).
      if (bomEnviado.gravar) referenciaRef.current = assinaturaBom(bomEnviado.estado);
      // NOTA do re-check do guardião — a conferência disparada pelo eco do 1º write (UPDATE) pode ter lido o BOM DEPOIS do
      // salvar_modelo_bom e comparado com a referência VELHA; se o `.then` dela resolvesse depois daqui, com edição em
      // voo, o aviso ficaria aceso. `geracaoRef += 1` a descarta; e como ela não chega a baixar o "conferindo", baixa-se
      // aqui (senão o Salvar ficaria esperando). Um BOM alheio que tenha chegado nesse meio-tempo segue coberto: o
      // `invalidarBom()` abaixo recarrega e a carga compara com a referência NOVA (R5a).
      geracaoRef.current += 1;
      setVerificandoBoth(false);
      bom.limparFlags();
      bom.limparCopiados();
      setConflitoBomBoth(false);
      invalidarBom();
      return { bomMudouEmVoo };
    },
    etapas,
  };

  return {
    habilitada, carregado, podeEditar, podeVerCustos, motivoSomenteLeitura,
    dados, estado, handlers: bom.handlers, gradeAuto: bom.gradeAuto,
    tecido1Info, totais, selos,
    confirmGrade: bom.confirmGrade, setConfirmGrade: bom.setConfirmGrade,
    camposCopiados: bom.camposCopiados, onCampoEditado: bom.onCampoEditado, marcarCopiados: bom.marcarCopiados,
    dirty: guarda.dirty,
    colab: { conflitoBom, verificandoBom, aoMudarNoServidor, resolverConflitoBom },
    save,
  };
}

export type FichaTecnica = ReturnType<typeof useFichaTecnica>;
```

- [ ] **Step 3: Gates**

Os 5 gates.

- [ ] **Step 4: Commit**

```bash
git add -- src/components/planejamento/planejamento-detail/ficha/useFichaTecnica.ts src/components/planejamento/planejamento-detail/ficha/persistir-bom.ts
git commit --only -m "feat(planejamento): F3.2 (7) — useFichaTecnica (seções/colab/save; trava única com a F3.1; conflito de BOM só com o BOM do servidor mudado) + persistir-bom (salvar_modelo_bom, etiquetas, Tecido 1..N inicial)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- src/components/planejamento/planejamento-detail/ficha/useFichaTecnica.ts src/components/planejamento/planejamento-detail/ficha/persistir-bom.ts
```

**Revisão individual (Opus):** `habilitada`/`podeEditar`/`motivoSomenteLeitura` × decisões F3 #4/#8, a trava ÚNICA (R2: "permissao"/"enviado" vêm de `travaDev`; o "Editar" leva o motivo a "cad", nunca a `null` num card enviado) e a trava interina; R5: `aoMudarNoServidor` sem toque só invalida, com toque confere o BOM do servidor × referência (a referência acompanha o estado não tocado e vira o ENVIADO no `aposSalvar`; `verificandoBomRef` segura o Salvar; `geracaoRef` descarta conferência velha — inclusive no `aposSalvar`, que também baixa o "conferindo"); R5a: a carga com o BOM tocado chama `aoRecarregarComTocadoRef` (mesma regra; guarda a assinatura p/ o "manter meu") — cenários mentais: eco de Mover para… (BOM igual) ⇒ sem aviso; outra pessoa muda o consumo ⇒ aviso; eco do meu save com BOM editado em voo ⇒ sem aviso; rev chega com o BOM intocado, usuário toca antes do refetch, refetch traz BOM alheio ⇒ aviso (R5a, QA S5d); refetch de foco com BOM alheio e BOM tocado ⇒ aviso; `capturar` só lê refs (vale no retry); `gravar` exige carregado E tocado E diferente do baseline; `totais` nulo quando não pode editar (sem custo derivado); `aoMudarNoServidor` × Dev `:838-843`; `gravarTecidosIniciais` só com modelo recém-criado (grep dos chamadores na Task 10/13).

---

## Task 8: `TecidosBomSecao` — cópia do componente de Tecidos com preço/m e estoque  *(Lote B)*

**Files:**
- Create: `src/components/planejamento/planejamento-detail/ficha/TecidosBomSecao.tsx` (CÓPIA de `src/components/desenvolvimento/modelo-detail/ModeloTecidosSection.tsx`, que NÃO muda)

**Interfaces:**
- Consumes: `EstoqueArtigo` (`planejamento-detail/campos`), `brl`/`fmtNum`, `artigoLabel`.
- Produces: `TecidosBomSecao(props)` = props do `ModeloTecidosSection` + `estoque?: Record<string, EstoqueArtigo>`; `ArtigoOpt` local ganha `preco_por_metro?: number | null`. QueryKeys internas com prefixo `plan-`.

- [ ] **Step 1: Copiar o arquivo**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f32-ficha-bom"
cp src/components/desenvolvimento/modelo-detail/ModeloTecidosSection.tsx src/components/planejamento/planejamento-detail/ficha/TecidosBomSecao.tsx
git hash-object src/components/desenvolvimento/modelo-detail/ModeloTecidosSection.tsx
```

Expected: o hash do original = `13b856678b807372e3dbaded6a79974febddfb33` (se diferente, PARE: o Dev mudou e a cópia partiria de outra base).

- [ ] **Step 2: Cabeçalho e imports da cópia** (todas as edições abaixo são no arquivo NOVO)

Substituir a 1ª linha `import { useEffect, useState } from "react";` por:

```ts
// F3.2 — CÓPIA de src/components/desenvolvimento/modelo-detail/ModeloTecidosSection.tsx (blob 13b85667,
// 23/set/2026) para o Sheet do Planejamento. Decisão F3 #10: o seletor do tecido mostra preço/m e
// estoque/disponível — o rótulo da opção é montado DENTRO do componente do Dev (:361) e mexer nele ou em
// `artigo-label.ts` alteraria o Dev e a OC Tecido (decisão travada 8). O original fica intocado; esta cópia
// vira a única na F5. Diferenças: (1) seletor principal com preço/estoque (`ArtigoComEstoqueSelect`);
// (2) queryKeys internas com prefixo "plan-" (queryKey única por tela); (3) imports absolutos.
import { useEffect, useState } from "react";
```

Substituir `import { Field, FieldSelectOpt } from "./shared";` por:

```ts
import { Field } from "@/components/desenvolvimento/modelo-detail/shared";
```

Substituir `import { TIPOS, TIPO_LABEL, type TecidoBlock, type GradeRow, type OcAlloc } from "./types";` por:

```ts
import { TIPOS, TIPO_LABEL, type TecidoBlock, type GradeRow, type OcAlloc } from "@/components/desenvolvimento/modelo-detail/types";
import type { EstoqueArtigo } from "@/components/planejamento/planejamento-detail/campos";
```

Substituir `import { fmtNum } from "@/lib/format";` por:

```ts
import { brl, fmtNum } from "@/lib/format";
```

- [ ] **Step 3: Tipo `ArtigoOpt` e default estável**

Substituir:

```ts
type ArtigoOpt = {
  id: string;
  nome: string;
  unidade_medida?: string | null;
  empresa?: { nome_fantasia: string | null; razao_social: string | null } | null;
};
```

por:

```ts
type ArtigoOpt = {
  id: string;
  nome: string;
  unidade_medida?: string | null;
  preco_por_metro?: number | null;
  empresa?: { nome_fantasia: string | null; razao_social: string | null } | null;
};

const SEM_ESTOQUE: Record<string, EstoqueArtigo> = {};
```

- [ ] **Step 4: Assinatura do componente exportado**

Substituir o bloco (do `export function ModeloTecidosSection({` até o `}) {` da assinatura):

```ts
export function ModeloTecidosSection({
  modeloId,
  blocks,
  artigos,
  artigosForro,
  artigosEntretela,
  grades,
  onChangeBlock,
  onChangeVariante,
  onChangeOcLinks,
  camposCopiados = new Set(),
  onCampoEditado,
}: {
  modeloId: string;
  blocks: TecidoBlock[];
  artigos: ArtigoOpt[];
  artigosForro: ArtigoOpt[];
  artigosEntretela: ArtigoOpt[];
  grades: GradeRow[];
  onChangeBlock: (idx: number, patch: Partial<TecidoBlock>) => void;
  onChangeVariante: (idx: number, vIdx: number, value: string | null) => void;
  onChangeOcLinks: (idx: number, vIdx: number, allocs: OcAlloc[]) => void;
  camposCopiados?: Set<string>;
  onCampoEditado?: (k: string) => void;
}) {
```

por:

```ts
export function TecidosBomSecao({
  modeloId,
  blocks,
  artigos,
  artigosForro,
  artigosEntretela,
  grades,
  onChangeBlock,
  onChangeVariante,
  onChangeOcLinks,
  camposCopiados = new Set(),
  onCampoEditado,
  estoque = SEM_ESTOQUE,
}: {
  modeloId: string;
  blocks: TecidoBlock[];
  artigos: ArtigoOpt[];
  artigosForro: ArtigoOpt[];
  artigosEntretela: ArtigoOpt[];
  grades: GradeRow[];
  onChangeBlock: (idx: number, patch: Partial<TecidoBlock>) => void;
  onChangeVariante: (idx: number, vIdx: number, value: string | null) => void;
  onChangeOcLinks: (idx: number, vIdx: number, allocs: OcAlloc[]) => void;
  camposCopiados?: Set<string>;
  onCampoEditado?: (k: string) => void;
  /** F3.2 — estoque por artigo (`estoque_tecido_por_artigo`) p/ o seletor (decisão F3 #10). */
  estoque?: Record<string, EstoqueArtigo>;
}) {
```

- [ ] **Step 5: Passar `estoque` ao editor do bloco**

Substituir:

```tsx
                  <TecidoBlockEditor
                    key={`${tipo}-${b.numero}`}
                    modeloId={modeloId}
```

por:

```tsx
                  <TecidoBlockEditor
                    key={`${tipo}-${b.numero}`}
                    modeloId={modeloId}
                    estoque={estoque}
```

Na assinatura de `function TecidoBlockEditor({`, substituir:

```ts
  camposCopiados = new Set(),
  onCampoEditado,
}: {
  modeloId: string;
  block: TecidoBlock;
```

por:

```ts
  camposCopiados = new Set(),
  onCampoEditado,
  estoque,
}: {
  modeloId: string;
  estoque: Record<string, EstoqueArtigo>;
  block: TecidoBlock;
```

- [ ] **Step 6: Trocar o seletor do artigo principal**

Substituir:

```tsx
        <div className={classeCopiado(camposCopiados, keyArtigo)}>
          <FieldSelectOpt
            label={`${TIPO_LABEL[block.tipo]} ${block.numero}`}
            value={block.artigo_id}
            onChange={(v) => { onChangeBlock({ artigo_id: v, variantes: Array(10).fill(null) }); onCampoEditado?.(keyArtigo); }}
            options={artigos.map((a) => ({ id: a.id, nome: artigoLabel(a) }))}
          />
        </div>
```

por:

```tsx
        <div className={classeCopiado(camposCopiados, keyArtigo)}>
          <ArtigoComEstoqueSelect
            label={`${TIPO_LABEL[block.tipo]} ${block.numero}`}
            value={block.artigo_id}
            onChange={(v) => { onChangeBlock({ artigo_id: v, variantes: Array(10).fill(null) }); onCampoEditado?.(keyArtigo); }}
            artigos={artigos}
            estoque={estoque}
          />
        </div>
```

- [ ] **Step 7: Renomear as queryKeys internas**

Substituir `queryKey: ["tecido1-variantes",` por `queryKey: ["plan-tecido1-variantes",`; `queryKey: ["variantes-pool",` por `queryKey: ["plan-variantes-pool",`; `queryKey: ["ocs-disponiveis-variante",` por `queryKey: ["plan-ocs-disponiveis-variante",`.

- [ ] **Step 8: Acrescentar o seletor com preço/estoque no FIM do arquivo**

```tsx
/**
 * F3.2 (decisão F3 #10) — seletor do artigo principal do bloco com preço/m e estoque/disponível, no
 * formato do antigo "Tecido Planejado" (MultiArtigosField). O TRIGGER mostra só o nome (children do
 * SelectValue); as 2 linhas extras aparecem na lista e numa legenda abaixo do campo (mockup Anotado).
 */
function ArtigoComEstoqueSelect({ label, value, onChange, artigos, estoque }: {
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
  artigos: ArtigoOpt[];
  estoque: Record<string, EstoqueArtigo>;
}) {
  const sel = value ? artigos.find((a) => a.id === value) : undefined;
  const eSel = value ? estoque[value] : undefined;
  return (
    <Field label={label}>
      <Select value={value ?? ""} onValueChange={(v) => onChange(v === "__none__" ? null : v)}>
        <SelectTrigger>
          <SelectValue placeholder="Selecione…">{sel ? artigoLabel(sel) : undefined}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">— Nenhum —</SelectItem>
          {artigos.map((a) => {
            const e = estoque[a.id];
            return (
              <SelectItem key={a.id} value={a.id}>
                <span className="flex flex-col">
                  <span>{artigoLabel(a)}</span>
                  <span className="text-xs text-muted-foreground">Preço/m: {a.preco_por_metro != null ? brl(a.preco_por_metro) : "—"}</span>
                  {e && (
                    <span className={`text-xs ${e.disponivel_m <= 0 ? "text-destructive" : "text-muted-foreground"}`}>
                      Estoque: {fmtNum(e.fisico_m)} m · disp.: {fmtNum(e.disponivel_m)} m
                    </span>
                  )}
                </span>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
      {sel && (
        <p className="text-[11px] text-muted-foreground">
          Preço/m: {sel.preco_por_metro != null ? brl(sel.preco_por_metro) : "—"}
          {eSel && (
            <>
              {" · "}Estoque: {fmtNum(eSel.fisico_m)} m{" · "}
              <span className={eSel.disponivel_m <= 0 ? "font-medium text-destructive" : ""}>disp.: {fmtNum(eSel.disponivel_m)} m</span>
            </>
          )}
        </p>
      )}
    </Field>
  );
}
```

- [ ] **Step 9: Conferir a cópia**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f32-ficha-bom"
F=src/components/planejamento/planejamento-detail/ficha/TecidosBomSecao.tsx
grep -c "FieldSelectOpt\|from \"./" $F          # 0
grep -c "plan-tecido1-variantes\|plan-variantes-pool\|plan-ocs-disponiveis-variante" $F   # 3
diff <(git show HEAD:src/components/desenvolvimento/modelo-detail/ModeloTecidosSection.tsx) $F | grep -c '^[<>]'
git diff --name-only -- src/components/desenvolvimento/   # vazio
```

Expected: 0; 3; o diff tem só as trocas dos Steps 2-8 (conferir a olho: nenhuma outra linha); último comando vazio.

- [ ] **Step 10: Gates + commit**

Os 5 gates. Depois:

```bash
git add -- src/components/planejamento/planejamento-detail/ficha/TecidosBomSecao.tsx
git commit --only -m "feat(planejamento): F3.2 (8) — TecidosBomSecao: cópia da seção de Tecidos do Dev com preço/m e estoque no seletor (decisão F3 #10)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- src/components/planejamento/planejamento-detail/ficha/TecidosBomSecao.tsx
```

---

## Task 9: `SecaoBom` + `BomSecoes` — render das seções 5-8  *(Lote B)*

**Files:**
- Create: `src/components/planejamento/planejamento-detail/ficha/secoes/SecaoBom.tsx`
- Create: `src/components/planejamento/planejamento-detail/ficha/secoes/BomSecoes.tsx`

**Interfaces:**
- Consumes: `FichaTecnica` (Task 7); `TecidosBomSecao` (Task 8); `ModeloAviamentosSection`, `ModeloEtiquetasSection`, `ModeloGradeSection` (Dev, só-props, sem modificar); `SeloSecao` (Task 3); `StatusBadge`, `CondicaoInfo`, `AlertDialog`; `AvisoCamposDev` (F3.1, `ficha/secoes/AvisoCamposDev.tsx` — aviso "sem permissão" idêntico).
- Produces: `SecaoBom({ id, titulo, selo?, origemDev?, defaultOpen?, open?, onOpenChange?, children })` com `data-secao={id}`; `BomSecoes({ ficha, modeloId, estoque, ordemEnviada, onAbrirDev? })`.

- [ ] **Step 1: Criar `SecaoBom.tsx`**

```tsx
// F3.2 — cabeçalho de seção vinda do Desenvolvimento no Sheet do Planejamento (mockup Main/Anotado:
// título + chip "do Desenvolvimento" + selo à direita). Recolhida por padrão (decisão travada 6). O botão de
// abrir e o selo são IRMÃOS (o selo pode ter o "i" do CondicaoInfo, que é um <button> — botão dentro de
// botão é HTML inválido). `open`/`onOpenChange` opcionais p/ a F3.3 abrir a seção por link.
import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

export function SecaoBom({ id, titulo, selo, origemDev = true, defaultOpen = false, open: openProp, onOpenChange, children }: {
  id: string;
  titulo: string;
  selo?: ReactNode;
  origemDev?: boolean;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
  children: ReactNode;
}) {
  const [openLocal, setOpenLocal] = useState(defaultOpen);
  const open = openProp ?? openLocal;
  const alternar = () => {
    const v = !open;
    if (openProp === undefined) setOpenLocal(v);
    onOpenChange?.(v);
  };
  return (
    <section className="space-y-3" data-secao={id}>
      <div className="flex items-center gap-2 border-b pb-1.5">
        <button
          type="button"
          onClick={alternar}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-sm font-semibold text-foreground"
        >
          {open ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
          <span className="truncate">{titulo}</span>
          {origemDev && (
            <span className="shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-normal text-muted-foreground max-sm:hidden">do Desenvolvimento</span>
          )}
        </button>
        {selo && <span className="ml-auto inline-flex shrink-0 items-center gap-1">{selo}</span>}
      </div>
      {open && children}
    </section>
  );
}
```

- [ ] **Step 2: Criar `BomSecoes.tsx`**

```tsx
// F3.2 — seções 5-8 do Sheet unificado (Tecidos/Forros/Entretelas · Aviamentos · Insumos · Grade), na ordem
// do mockup aprovado. Reusa os componentes só-props do Dev SEM modificá-los; Tecidos é a cópia local
// (TecidosBomSecao, decisão F3 #10). Somente-leitura pela trava ÚNICA (R2 do G-plano conjunto): sem permissão ou
// enviado à Explosão (vêm da F3.1) e a trava interina "tem CAD" (até a F3.3). Os avisos seguem os da F3.1
// (`AvisoCamposDev`). "Apagar grade preenchida?" portado do Dev (:3221-3237).
import type { ReactNode } from "react";
import { AlertTriangle, Check, ExternalLink, Info, Loader2 } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { StatusBadge, type StatusTone } from "@/components/shared/StatusBadge";
import { CondicaoInfo } from "@/components/shared/CondicaoInfo";
import { ModeloAviamentosSection } from "@/components/desenvolvimento/modelo-detail/ModeloAviamentosSection";
import { ModeloEtiquetasSection } from "@/components/desenvolvimento/modelo-detail/ModeloEtiquetasSection";
import { ModeloGradeSection } from "@/components/desenvolvimento/modelo-detail/ModeloGradeSection";
import type { EstoqueArtigo } from "@/components/planejamento/planejamento-detail/campos";
import { AvisoCamposDev } from "./AvisoCamposDev";
import { TecidosBomSecao } from "../TecidosBomSecao";
import type { FichaTecnica } from "../useFichaTecnica";
import type { SeloSecao } from "../selos-bom";
import { SecaoBom } from "./SecaoBom";

const TOM: Record<SeloSecao["tone"], StatusTone> = { ok: "success", info: "info", warn: "warning", muted: "neutral" };

function SeloBadge({ selo }: { selo: SeloSecao }) {
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

// Avisos da trava ÚNICA (R2 do G-plano conjunto), alinhados aos da F3.1 (`AvisoCamposDev`): "permissao" usa o MESMO
// componente/texto; "enviado" começa pela MESMA frase da F3.1, mas diz que o "Editar" não libera o BOM (a trava interina
// "tem CAD" segue até a F3.3 — card enviado sempre tem CAD); "cad" explica a trava interina. Mesmo estilo visual.
const TEXTO_AVISO_BOM: Record<"enviado" | "cad", string> = {
  enviado: "Enviado à Explosão: os campos vindos do Desenvolvimento ficam travados. Tecidos, aviamentos, insumos e grade seguem só-leitura aqui mesmo com “Editar” — altere-os no Desenvolvimento.",
  cad: "Este modelo já tem CAD: para não desalinhar o CAD e a Explosão, tecidos, aviamentos, insumos e grade ficam só-leitura aqui — altere-os no Desenvolvimento.",
};

function AvisoSomenteLeitura({ motivo, onAbrirDev }: { motivo: FichaTecnica["motivoSomenteLeitura"]; onAbrirDev?: () => void }) {
  if (motivo === "permissao") return <AvisoCamposDev motivo="sem_permissao" />;
  if (motivo !== "enviado" && motivo !== "cad") return null;
  return (
    <div data-testid="aviso-bom-somente-leitura" className="flex flex-wrap items-center gap-2 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
      <Info className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1">{TEXTO_AVISO_BOM[motivo]}</span>
      {onAbrirDev && (
        <Button type="button" variant="outline" size="sm" onClick={onAbrirDev}>
          <ExternalLink className="h-3.5 w-3.5 mr-1" />Abrir no Desenvolvimento
        </Button>
      )}
    </div>
  );
}

export function BomSecoes({ ficha, modeloId, estoque, ordemEnviada, onAbrirDev }: {
  ficha: FichaTecnica;
  modeloId: string;
  estoque: Record<string, EstoqueArtigo>;
  /** `modelos.ordem_criacao_enviada` — antes dela, avisa que cor+grade já reservam tecido. */
  ordemEnviada: boolean;
  onAbrirDev?: () => void;
}) {
  if (!ficha.habilitada) return null;
  const carregando = !ficha.carregado;
  const corpo = (node: ReactNode) => (carregando ? (
    <p className="flex items-center gap-2 py-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Carregando…</p>
  ) : (
    <>
      <AvisoSomenteLeitura motivo={ficha.motivoSomenteLeitura} onAbrirDev={onAbrirDev} />
      <fieldset disabled={!ficha.podeEditar} className="contents">{node}</fieldset>
    </>
  ));
  const { estado, handlers, dados } = ficha;

  return (
    <>
      <SecaoBom id="tecidos" titulo="Tecidos / Forros / Entretelas" selo={<SeloBadge selo={ficha.selos.tecidos} />}>
        {!carregando && !ordemEnviada && ficha.podeEditar && (
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            As cores e a grade deste modelo já reservam tecido no estoque, mesmo antes da Ordem de Criação.
          </p>
        )}
        {corpo(
          <TecidosBomSecao
            modeloId={modeloId}
            blocks={estado.blocks}
            artigos={dados.artigos}
            artigosForro={dados.artigosForro}
            artigosEntretela={dados.artigosEntretela}
            grades={estado.grades}
            onChangeBlock={handlers.updateBlock}
            onChangeVariante={handlers.updateBlockVariante}
            onChangeOcLinks={handlers.updateBlockOcLinks}
            camposCopiados={ficha.camposCopiados}
            onCampoEditado={ficha.onCampoEditado}
            estoque={estoque}
          />,
        )}
      </SecaoBom>

      <SecaoBom id="aviamentos" titulo="Aviamentos" selo={<SeloBadge selo={ficha.selos.aviamentos} />}>
        {corpo(
          <ModeloAviamentosSection
            rows={estado.aviamentos}
            aviamentos={dados.aviamentos}
            onChangeRow={handlers.updateAviamento}
            onAdd={handlers.addAviamento}
            onRemove={handlers.removeAviamento}
            camposCopiados={ficha.camposCopiados}
            onCampoEditado={ficha.onCampoEditado}
          />,
        )}
      </SecaoBom>

      <SecaoBom id="insumos" titulo="Insumos" selo={<SeloBadge selo={ficha.selos.insumos} />}>
        {corpo(
          <ModeloEtiquetasSection
            rows={estado.etiquetas}
            etiquetas={dados.etiquetaOpts}
            etiquetaMap={dados.etiquetaMap}
            onChangeRow={handlers.updateEtiqueta}
            onAdd={handlers.addEtiqueta}
            onRemove={handlers.removeEtiqueta}
            camposCopiados={ficha.camposCopiados}
            onCampoEditado={ficha.onCampoEditado}
          />,
        )}
      </SecaoBom>

      <SecaoBom id="grade" titulo="Grade" selo={<SeloBadge selo={ficha.selos.grade} />}>
        {corpo(
          <ModeloGradeSection
            tamanhos={dados.tamanhos}
            proporcoes={ficha.proporcoes}
            onChangeProporcao={handlers.updateProporcao}
            grades={estado.grades}
            onChangeGradeTotal={handlers.updateGradeTotal}
            onChangeGradeCell={handlers.updateGradeCell}
            tecido1Variantes={ficha.tecido1Info}
            gradeAuto={ficha.gradeAuto}
            onToggleGradeAuto={handlers.toggleGradeAuto}
            camposCopiados={ficha.camposCopiados}
            onCampoEditado={ficha.onCampoEditado}
          />,
        )}
      </SecaoBom>

      <AlertDialog open={!!ficha.confirmGrade} onOpenChange={(o) => { if (!o) ficha.setConfirmGrade(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar grade preenchida?</AlertDialogTitle>
            <AlertDialogDescription>{ficha.confirmGrade?.msg}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => { ficha.confirmGrade?.onConfirm(); ficha.setConfirmGrade(null); }}>
              Continuar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
```

- [ ] **Step 3: Expor `proporcoes` no retorno do orquestrador**

`ModeloGradeSection` precisa das proporções do Draft. Em `useFichaTecnica.ts`, no objeto de `return`, trocar a linha `    dados, estado, handlers: bom.handlers, gradeAuto: bom.gradeAuto,` por:

```ts
    dados, estado, handlers: bom.handlers, gradeAuto: bom.gradeAuto, proporcoes: a.proporcoes,
```

- [ ] **Step 4: Gates + commit**

Os 5 gates. Depois:

```bash
git add -- src/components/planejamento/planejamento-detail/ficha/secoes/SecaoBom.tsx src/components/planejamento/planejamento-detail/ficha/secoes/BomSecoes.tsx src/components/planejamento/planejamento-detail/ficha/useFichaTecnica.ts
git commit --only -m "feat(planejamento): F3.2 (9) — seções do BOM (Tecidos/Aviamentos/Insumos/Grade) com selos, avisos e 'Apagar grade preenchida?'

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- src/components/planejamento/planejamento-detail/ficha/secoes/SecaoBom.tsx src/components/planejamento/planejamento-detail/ficha/secoes/BomSecoes.tsx src/components/planejamento/planejamento-detail/ficha/useFichaTecnica.ts
```

**Revisão do Lote B (Tasks 5, 8, 9):** selects × Dev; chaves `plan-ficha-*` únicas (grep no `src/` inteiro); o diff da cópia (Task 8 Step 9) só com as trocas declaradas; avisos da trava única com o texto da F3.1 (R2 — "sem permissão" = `AvisoCamposDev`; "enviado" começa pela frase da F3.1 e diz que o "Editar" não libera o BOM); `fieldset disabled` envolve TODO input das seções (inclusive os botões de adicionar/remover); o aviso de somente-leitura fica FORA do fieldset (o botão "Abrir no Desenvolvimento" precisa funcionar); selo e botão irmãos; 360px sem estouro (chip some em `max-sm`).

---

## Task 10: Salvar unificado — cadeia do BOM + fixes do P0409 e do save-em-voo  *(individual Opus, junto com a Task 4)*

**Files:**
- Modify: `src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts`
- Modify: `src/components/planejamento/PlanejamentoDetail.tsx` (só: import + chamada do `useFichaTecnica` + argumentos do `usePlanejamentoSave`)

**Interfaces:**
- Consumes: `FichaSave` (Task 7), `persistirBom`/`gravarTecidosIniciais` (Task 7), `aplicarColunasFicha`/`tocadosAposSalvar`/`prepararRetryP0409` (Task 4), `pecaCom`/`BomCapturado` (Task 2), `STAGE_LABEL` (`DownstreamImpactAlert`, só importar); da F3.1 (texto final, Task 0 Step 3): `criadoIdRef`, `onCreated`, `onSaved: aoSalvar`, `aplicarRegrasCamposDev`, `motivoTravaDev`.
- Produces: `UsePlanejamentoSaveArgs` ganha `ficha: FichaSave` e `resetDraftBaseline: (next?: Draft) => void`; perde `markClean` e `moLinhas`. Em `PlanejamentoDetail`: `const ficha = useFichaTecnica({...})` (usado pelas Tasks 11-13).

A cadeia final (edição): [grade de revenda, como hoje] → **UPDATE `modelos` `.eq("rev")`** (payload do draft AO VIVO pelas regras da F3.1 `aplicarRegrasCamposDev` + colunas do Dev por `aplicarColunasFicha`) → **`salvar_modelo_bom(_rev_base:null)` + etiquetas** (só se `bom.gravar`) → [aqui a F3.3 põe `salvar_cad_completo`] → **MO** (+ update pontual de `custo_peca_previsto`) → **`marcar_revisao_por_mudanca`** (só se o BOM gravou com grade/consumo/aviamento mudados) → [auto Produto Acabado, como hoje]. Card novo (texto da F3.1 — `criadoIdRef`): INSERT **uma vez** → **`gravarTecidosIniciais`** DENTRO do `else`, logo depois de `criadoIdRef.current = savedId;` (Tecido 1..N do seletor do Dialog; nunca no caminho do `criadoIdRef` já preenchido) → MO → [auto PA] → `onCreated(id)` (o Dialog vira o Sheet — F3.1, preservado).

- [ ] **Step 1: Imports**

Em `usePlanejamentoSave.ts` (o `useRef` do React JÁ vem da F3.1: `import { useRef, type Dispatch, type RefObject, type SetStateAction } from "react";` — não mexer):
- trocar `import { mergeDraft, type Conflito } from "@/lib/colab/merge";` por `import { type Conflito } from "@/lib/colab/merge";`
- trocar `import { syncTecidosToDesenvolvimento } from "@/components/planejamento/planejamento-detail/sync-tecidos";` por:

```ts
import { STAGE_LABEL } from "@/components/desenvolvimento/DownstreamImpactAlert";
import { gravarTecidosIniciais, persistirBom } from "@/components/planejamento/planejamento-detail/ficha/persistir-bom";
import { pecaCom, type BomCapturado } from "@/components/planejamento/planejamento-detail/ficha/ficha-calc";
import type { FichaSave } from "@/components/planejamento/planejamento-detail/ficha/useFichaTecnica";
import { aplicarColunasFicha, prepararRetryP0409, tocadosAposSalvar } from "@/components/planejamento/planejamento-detail/save-ficha";
```

- [ ] **Step 2: Argumentos do hook**

Antes: `grep -n "markClean" src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts`. Se aparecer em OUTRO lugar além do tipo, da desestruturação e do `markClean();` do onSuccess (ex.: a F3.1 usou), NÃO remova `markClean` do tipo/desestruturação — só troque o uso do onSuccess (Step 10).

No tipo `UsePlanejamentoSaveArgs`, remover as 2 linhas:

```ts
  markClean: () => void;
  moLinhas: MaoObraEditorLinha[];
```

e, logo depois de `  qc: QueryClient;`, inserir:

```ts
  /** F3.2 — API de gravação do BOM (inerte quando a ficha está desligada: card novo, comprado, sem permissão). */
  ficha: FichaSave;
  /** F3.2 — re-baseia o "não salvo" do draft no valor ENVIADO (fix do save-em-voo, receita 2419d0f). */
  resetDraftBaseline: (next?: Draft) => void;
```

Na desestruturação: trocar `  setEnviada, setLancado, markClean,` por `  setEnviada, setLancado,`; trocar `  moLinhas, moLinhasRef, moBaseRef, setMoLinhasBase,` por `  moLinhasRef, moBaseRef, setMoLinhasBase,`; trocar a linha exata `  qc, onSaved, onCreated,` (texto final da F3.1) por `  qc, onSaved, onCreated, ficha, resetDraftBaseline,` — o `onCreated` FICA (R1 do G-plano conjunto; o 5º gate confere).

- [ ] **Step 3: Ref do que foi enviado**

Logo ANTES de `  const save = useMutation({`, inserir:

```ts
  // F3.2 — o que ESTE save enviou (draft + MO + BOM), congelado no início do mutationFn. O onSuccess re-baseia
  // NISTO, nunca no estado ao vivo: tecla digitada durante o voo segue "não salva" (receita 2419d0f do Dev).
  const enviadoRef = useRef<{ draft: Draft; moLinhas: MaoObraEditorLinha[]; bom: BomCapturado } | null>(null);
```

- [ ] **Step 4: Início do `mutationFn` (fix do retry + captura)**

Substituir:

```ts
    mutationFn: async () => {
      // Colab (Task 2): com conflitos pendentes na tela, o save NÃO pode passar — mesmo que
      // o rev já bata, o usuário precisa resolver ("manter meu"/"usar o novo") primeiro. Mesmo
      // guard do piloto OC Tecido/Desenvolvimento (sem isto, um 2º clique sobrescreveria a
      // versão da outra pessoa em silêncio).
      if (conflitosRef.current.length > 0)
        throw new Error("Resolva os conflitos listados no aviso no topo antes de salvar.");
```

por:

```ts
    mutationFn: async () => {
      // F3.2 — FIX do retry pós-P0409 (receita 2419d0f): a fonte do payload é o ESPELHO AO VIVO do draft, não
      // o `draft` da closure. No retry, o onError faz setDraft(merge) + draftLiveRef.current = merge e chama
      // save.mutate() ANTES de re-renderizar; a closure seria a do render ANTERIOR e desfaria em silêncio os
      // campos adotados do outro usuário. Esta `const draft` SOMBREIA o argumento do hook DE PROPÓSITO.
      const draft = draftLiveRef.current;
      // Colab: com conflitos pendentes (escalares OU a seção "Tecidos & BOM"), o save NÃO passa.
      if (conflitosRef.current.length > 0 || ficha.conflitoBomRef.current)
        throw new Error("Resolva os conflitos listados no aviso no topo antes de salvar.");
      // R5 — rev novo com o BOM tocado: a ficha está conferindo se o BOM do SERVIDOR mudou. Salvar agora poderia passar
      // o `.eq("rev")` e sobrescrever um BOM alheio ainda não detectado.
      if (ficha.verificandoBomRef.current)
        throw new Error("Conferindo se outra pessoa mudou o BOM deste card — salve de novo em instantes.");
      const bom = ficha.capturar(draft.custos_adicionais);
      // Colunas DERIVADAS do BOM: na 1ª tentativa sempre; no retry do P0409 só quando ESTE save grava o BOM (os derivados
      // saem do MESMO BOM gravado — R5). Retry sem gravar o BOM: o BOM local (não tocado) pode estar velho.
      const incluirDerivados = !retryRef.current || bom.gravar;
      const moLinhasEnviadas = moLinhasRef.current;
      enviadoRef.current = { draft, moLinhas: moLinhasEnviadas, bom };
```

- [ ] **Step 5: Colunas do Dev no payload**

Logo ANTES de `      let savedId: string | null = isEdit ? modeloId : null;`, inserir:

```ts
      // F3.2 — colunas do Desenvolvimento no UPDATE: proporções/custos adicionais (só com permissão), custos
      // derivados do BOM e `tecidos_planejados` DERIVADO (só quando o BOM grava). Regras: save-ficha.ts.
      const moServidor = moBaseRef.current.reduce((s, l) => s + (Number(l.valor) || 0), 0);
      aplicarColunasFicha(payload, {
        isEdit,
        podeGravarColunasDev: ficha.podeGravarColunasDev,
        incluirDerivados,
        podeVerCustos: ficha.podeVerCustos,
        totais: bom.totais,
        maoObraServidor: moServidor,
        gravaBom: bom.gravar,
        tecidosPlanejados: bom.tecidosPlanejados,
      });
```

- [ ] **Step 6: BOM depois do UPDATE (edição)**

Substituir `        await syncTecidosToDesenvolvimento(modeloId, draft.tecidos_planejados);` por:

```ts
        // F3.2 — BOM (substitui o sync do antigo "Tecido Planejado"): só grava quando CARREGADO E SUJO.
        // `_rev_base: null` — a trava já validou no UPDATE acima (desenho do Dev, ModeloDetailPanel.tsx:1950-1959).
        if (bom.gravar) await persistirBom(modeloId, bom);
```

- [ ] **Step 7: BOM inicial do card novo (G-mockup R3)**

No ramo do card novo (texto FINAL da F3.1 — R1 do G-plano conjunto), substituir:

```ts
          savedId = inserted?.id ?? null;
          criadoIdRef.current = savedId;
        }
        if (savedId) await syncTecidosToDesenvolvimento(savedId, draft.tecidos_planejados);
```

por:

```ts
          savedId = inserted?.id ?? null;
          criadoIdRef.current = savedId;
          // F3.2 / G-mockup R3 — o seletor "Tecidos" do Dialog grava o BOM como Tecido 1..N (só o artigo) logo após
          // o INSERT REAL. DENTRO do `else` (R1 do G-plano conjunto): só com o id que ESTE insert criou — BOM vazio,
          // salvar_modelo_bom não apaga nada. No caminho do `criadoIdRef` já preenchido (2º clique/retry) NÃO regrava.
          if (savedId) await gravarTecidosIniciais(savedId, draft.tecidos_planejados);
        }
```

(O `if (criadoIdRef.current) { savedId = criadoIdRef.current; } else {` de cima fica como a F3.1 deixou.)

- [ ] **Step 8: MO com o snapshot congelado + custo da peça**

Substituir:

```ts
      if (podeVerCustos && savedId && !moLinhasEqual(moLinhasRef.current, moBaseRef.current)) {
        const { error: moErr } = await supabase.rpc("salvar_modelo_servico_mo" as any, {
          _modelo_id: savedId,
          _linhas: moLinhasRef.current.map((l) => ({
```

por:

```ts
      if (podeVerCustos && savedId && !moLinhasEqual(moLinhasEnviadas, moBaseRef.current)) {
        const { error: moErr } = await supabase.rpc("salvar_modelo_servico_mo" as any, {
          _modelo_id: savedId,
          _linhas: moLinhasEnviadas.map((l) => ({
```

e substituir `        if (moErr) throw moErr;` por:

```ts
        if (moErr) throw moErr;
        // F3.2 — MO CONFIRMADA: só AGORA corrige custo_peca_previsto com a MO nova (update pontual, desenho do
        // Dev :2140-2150). Só quando esta tentativa já mandou as colunas derivadas.
        if (isEdit && incluirDerivados && bom.totais && ficha.podeGravarColunasDev && ficha.podeVerCustos) {
          const moSomaEnviada = moLinhasEnviadas.reduce((s, l) => s + (Number(l.valor) || 0), 0);
          const { error: pecaErr } = await (supabase.from("modelos") as any)
            .update({ custo_peca_previsto: pecaCom(bom.totais, moSomaEnviada) })
            .eq("id", savedId);
          if (pecaErr) throw pecaErr;
        }
```

- [ ] **Step 9: #Erro nas etapas seguintes + retorno**

Logo ANTES da linha `      // FIX WAVE (B3-fix): card criado (ou editado pra) origem='revenda' sem produto`, inserir:

```ts
      // F3.2 — #Erro nas etapas seguintes quando o BOM gravado mudou grade/consumo/aviamento (Dev :2198-2213).
      // A RPC só marca com CAD e etapas existentes; erro aqui NÃO derruba o save (paridade: o Dev ignora).
      let etapasMarcadas: string[] = [];
      if (isEdit && savedId && bom.gravar && (bom.flags.grade || bom.flags.consumo || bom.flags.aviamentos)) {
        const { data: marcadas } = await supabase.rpc("marcar_revisao_por_mudanca" as any, {
          _modelo_id: savedId, _grade: bom.flags.grade, _consumo: bom.flags.consumo, _aviamentos: bom.flags.aviamentos,
        });
        etapasMarcadas = marcadas && typeof marcadas === "object" ? Object.keys(marcadas as Record<string, unknown>) : [];
      }
```

e substituir `      return { autoProduto, savedId };` (texto final da F3.1 — o `savedId` alimenta o `onCreated` do `onSuccess`) por:

```ts
      return { autoProduto, savedId, etapasMarcadas, consumoOuAviamento: bom.gravar && (bom.flags.consumo || bom.flags.aviamentos) };
```

- [ ] **Step 10: `onSuccess` — toast do #Erro, rebase no ENVIADO, invalidações**

Substituir `      toast.success("Modelo salvo");` por:

```ts
      const etapasMarcadas = result?.etapasMarcadas ?? [];
      if (etapasMarcadas.length > 0) {
        const nomes = etapasMarcadas.map((k) => STAGE_LABEL[k] ?? k).join(", ");
        const corteMsg = ficha.etapas.corte && (ficha.etapas.baixa_total ?? 0) > 0 ? " O corte/baixa de estoque também foi afetado — reveja a Explosão." : "";
        toast.info(`Salvo. Etapas posteriores marcadas para verificação (#Erro): ${nomes}.${corteMsg}`);
      } else if (result?.consumoOuAviamento && ficha.etapas.corte) {
        toast.info("Salvo. A metragem/baixa do corte mudou — reveja a Explosão (reenvie se necessário).");
      } else {
        toast.success("Modelo salvo");
      }
```

Substituir:

```ts
      markClean();
      // Colab: o que acabei de salvar já É o "base" atual — evita que o eco do Realtime (meu
      // próprio UPDATE) apareça como "alguém atualizou N campos" no banner. O rev real
      // (bumpado no servidor) chega no próximo refetch — o merge effect processa em silêncio
      // (base≈fresh, sem conflitos) e avança `revRef`.
      baseRef.current = { draft };
      touchedRef.current = new Set();
```

por:

```ts
      // F3.2 — FIX do save-em-voo (receita 2419d0f): base e baseline do "não salvo" = o que FOI ENVIADO; campo
      // editado durante o voo SEGUE tocado e o selo segue aceso até o próximo Salvar (o eco do meu UPDATE não
      // reverte nem vira conflito comigo mesmo).
      const enviado = enviadoRef.current;
      const enviadoDraft = enviado?.draft ?? draftLiveRef.current;
      resetDraftBaseline(enviadoDraft);
      baseRef.current = { draft: enviadoDraft };
      touchedRef.current = tocadosAposSalvar({ touched: touchedRef.current, live: draftLiveRef.current, enviado: enviadoDraft });
      if (enviado) ficha.aposSalvar({ bomEnviado: enviado.bom });
```

Substituir `      setMoLinhasBase(moLinhas);` por:

```ts
      setMoLinhasBase(enviado?.moLinhas ?? moLinhasRef.current);
```

Logo DEPOIS de `      qc.invalidateQueries({ queryKey: ["modelo-composicao", modeloId] });` (a última invalidação da F3.1 no `onSuccess`), inserir:

```ts
      // F3.2 — o BOM é o MESMO do Desenvolvimento: refresca o Sheet do Dev (mesma aba) e quem lê o BOM.
      qc.invalidateQueries({ queryKey: ["modelo-detail", modeloId] });
      if (enviado?.bom.gravar) {
        for (const k of ["modelo-tecidos-consumo", "modelo-tecido-oc-links", "modelo-aviamentos", "modelo-etiquetas", "modelo-grades", "modelo-condicoes-kanban", "etapas-afetadas"])
          qc.invalidateQueries({ queryKey: [k, modeloId] });
        for (const k of ["estoque-tecidos", "estoque-tecido-por-artigo", "producao-terc-list", "producao-cq-list", "dir-list"])
          qc.invalidateQueries({ queryKey: [k] });
        qc.invalidateQueries({ predicate: (q) => typeof q.queryKey?.[0] === "string" && (q.queryKey[0] as string).startsWith("ft-") });
      }
```

- [ ] **Step 11: `onError` — espelho síncrono + conflito de seção só com o BOM do servidor mudado (R5)**

Substituir (o ramo do P0409 do header — o ramo da grade de revenda, acima dele, também faz `refetchQueries(["modelo"…])` e NÃO muda):

```ts
      if (e?.code === "P0409" && !retryRef.current) {
        retryRef.current = true;
        savingRef.current = true;
        await qc.refetchQueries({ queryKey: ["modelo", modeloId] });
```

por:

```ts
      if (e?.code === "P0409" && !retryRef.current) {
        retryRef.current = true;
        savingRef.current = true;
        // F3.2 / R5 — BOM tocado: só é conflito de SEÇÃO se o BOM do SERVIDOR mudou de verdade (o P0409 pode ter vindo de
        // uma ação MINHA que só subiu o `rev` — Mover para…, Ordem de Criação, Lançar, aprovar MO). Confere ANTES do
        // refetch do modelo: o trecho abaixo (merge + avanço de base/rev) continua síncrono, como antes.
        const bomConflito = ficha.colecoesTouchadasRef.current ? await ficha.bomMudouNoServidor() : false;
        await qc.refetchQueries({ queryKey: ["modelo", modeloId] });
```

Depois substituir:

```ts
          const md = mergeDraft({ base: base.draft, draft: liveDraft, fresh: freshDraft, touched: touchedRef.current });
          if (md.atualizados.length > 0 || md.conflitos.length > 0) setDraft(md.valor);
          conflitosRef.current = md.conflitos;
          setConflitos(md.conflitos);
          setUltimoMerge({ atualizados: md.atualizados.length, conflitos: md.conflitos });
```

por:

```ts
          const r = prepararRetryP0409({ base: base.draft, live: liveDraft, fresh: freshDraft, touched: touchedRef.current, bomConflito });
          setDraft(r.proximoDraft);
          // F3.2 — FIX: espelho SÍNCRONO antes do retry (o save.mutate abaixo roda ANTES do re-render e o
          // mutationFn lê draftLiveRef). Sem isto o retry reenviava o draft velho da closure.
          draftLiveRef.current = r.proximoDraft;
          conflitosRef.current = r.conflitos;
          setConflitos(r.conflitos);
          setUltimoMerge({ atualizados: r.atualizados, conflitos: r.conflitos });
          // BOM tocado E o BOM do servidor mudou ⇒ conflito de SEÇÃO (Dev :2306-2307); o retry não acontece. BOM tocado
          // com o do servidor IGUAL ⇒ retry normal (grava o BOM; os derivados vão junto — `incluirDerivados`).
          if (bomConflito) ficha.setConflitoBom(true);
```

e substituir:

```ts
          if (md.conflitos.length === 0) {
            save.mutate(undefined, { onSettled: () => { savingRef.current = false; retryRef.current = false; } });
            return;
          }
```

por:

```ts
          if (r.podeRetentar) {
            save.mutate(undefined, { onSettled: () => { savingRef.current = false; retryRef.current = false; } });
            return;
          }
```

- [ ] **Step 12: Chamar o orquestrador em `PlanejamentoDetail.tsx` e passar ao Salvar**

Depois de `import { usePlanejamentoSave } from "@/components/planejamento/planejamento-detail/usePlanejamentoSave";`, inserir:

```ts
import { useFichaTecnica } from "@/components/planejamento/planejamento-detail/ficha/useFichaTecnica";
```

Logo DEPOIS de `  const maoObraPlanejada = maoObraDevLive;`, inserir:

```ts
  // F3.2 — BOM do Desenvolvimento no Sheet (Tecidos/Aviamentos/Insumos/Grade + custos do BOM). Hook SEMPRE
  // chamado (regra dos hooks); inerte no card novo, no comprado e sem `canView("criacao_desenvolvimento")`.
  // Trava ÚNICA (R2 do G-plano conjunto): `motivoTravaDev` vem da F3.1 (declarado logo depois das permissões, antes
  // daqui — por isso a query do modelo subiu lá) e já considera o "Editar".
  const ficha = useFichaTecnica({
    modeloId, isEdit, isComprado,
    tecidosPlanejados: draft.tecidos_planejados,
    proporcoes: draft.proporcoes,
    custosAdicionais: draft.custos_adicionais,
    setDraftTracked,
    maoObraVivo: maoObraDevLive,
    travaDev: motivoTravaDev,
  });
```

Na chamada `usePlanejamentoSave({ ... })`: trocar `    setEnviada, setLancado, markClean,` por `    setEnviada, setLancado,`; trocar `    moLinhas, moLinhasRef, moBaseRef, setMoLinhasBase,` por `    moLinhasRef, moBaseRef, setMoLinhasBase,`; trocar a linha exata `    qc, onSaved: aoSalvar, onCreated,` (texto final da F3.1) por `    qc, onSaved: aoSalvar, onCreated, ficha: ficha.save, resetDraftBaseline,` — `onSaved: aoSalvar` (re-trava) e `onCreated` (Dialog → Sheet) FICAM (R1; o `tsc` não pega se sumirem — 5º gate).

Por fim: `grep -n "markClean" src/components/planejamento/PlanejamentoDetail.tsx`. Se o ÚNICO resultado for a desestruturação `const { dirty: draftDirty, markClean, reset: resetDraftBaseline } = useDirtySnapshot(draft);`, trocar por `const { dirty: draftDirty, reset: resetDraftBaseline } = useDirtySnapshot(draft);`. Se houver outro uso (F3.1), deixar como está.

- [ ] **Step 13: Conferências**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f32-ficha-bom"
S=src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts
grep -c "const draft = draftLiveRef.current;" $S            # 1
grep -c "draftLiveRef.current = r.proximoDraft;" $S        # 1
grep -c "markClean()" $S                                   # 0
grep -c "baseRef.current = { draft }" $S                   # 0
grep -c "setMoLinhasBase(moLinhas)" $S                     # 0
grep -rn "syncTecidosToDesenvolvimento" src | grep -v "planejamento-detail/sync-tecidos.ts"   # vazio
grep -rn "gravarTecidosIniciais(" src | grep -v "ficha/persistir-bom.ts"                        # só o ramo do card novo
grep -n -A2 "criadoIdRef.current = savedId;" $S                 # a linha seguinte (comentário) e o gravarTecidosIniciais DENTRO do else
grep -c "if (ficha.verificandoBomRef.current)" $S          # 1
grep -c "const bomConflito = ficha.colecoesTouchadasRef.current ? await ficha.bomMudouNoServidor() : false;" $S   # 1
grep -c "return { autoProduto, savedId, etapasMarcadas" $S # 1
grep -c "  qc, onSaved, onCreated, ficha, resetDraftBaseline," $S   # 1
grep -c "    qc, onSaved: aoSalvar, onCreated, ficha: ficha.save, resetDraftBaseline," src/components/planejamento/PlanejamentoDetail.tsx   # 1
grep -c "travaDev: motivoTravaDev," src/components/planejamento/PlanejamentoDetail.tsx         # 1
```

E o 5º gate (`bash .superpowers/f32/gate-f31.sh` → "F3.1 preservada: ok", código 0; código 1 = PARE).

- [ ] **Step 14: Gates + commit**

Os 5 gates (`tsc` pega qualquer arg a mais/a menos). Depois:

```bash
git add -- src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts src/components/planejamento/PlanejamentoDetail.tsx
git commit --only -m "feat(planejamento): F3.2 (10) — Salvar unificado: UPDATE(rev) → salvar_modelo_bom → etiquetas → MO → #Erro; fix do retry P0409 e do save-em-voo (receita 2419d0f); Tecido 1..N no card novo dentro do INSERT real

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts src/components/planejamento/PlanejamentoDetail.tsx
```

**Revisão individual (Opus) — Tasks 4 + 10:** (1) todo acesso a `draft` dentro do `mutationFn` é o sombreado (ao vivo); (2) ordem da cadeia e que a trava `.eq("rev")` continua no 1º write; (3) `bom.gravar` é o ÚNICO gatilho de `persistirBom`; `gravarTecidosIniciais` só DENTRO do `else` do INSERT real, logo depois de `criadoIdRef.current = savedId;` (R1); (4) `tecidos_planejados` nunca vai no UPDATE da edição sem o BOM gravar; `status_desenvolvimento` nunca vai; (5) retry: derivados só se o retry grava o BOM, espelho síncrono antes do `save.mutate`, BOM tocado ⇒ confere o BOM do servidor ANTES do refetch do modelo (conflito de seção só se mudou — R5); (6) onSuccess re-baseia no ENVIADO (draft, MO e BOM — `aposSalvar({ bomEnviado })`); (7) nenhuma chave de invalidação nova colide com outra tela (`plan-ficha-*`); (8) sem permissão do Dev nada do Dev vai no payload (lista única da F3.1); (9) F3.1 preservada: `onCreated` no fim do `onSuccess` e no ramo "card criado" do `onError`, `onSaved: aoSalvar`, `aplicarRegrasCamposDev`, invalidações `plan-kanban-cond`/`modelo-composicao` (5º gate); (10) `verificandoBomRef` segura o Salvar enquanto a ficha confere.

---

## Task 11: Fiação no Sheet — seções, merge colab, banner, Dialog "Tecidos"; sai o sync  *(individual Opus)*

**Files:**
- Modify: `src/components/planejamento/PlanejamentoDetail.tsx`
- Modify: `src/components/planejamento/planejamento-detail/campos.tsx` (`MultiArtigosField` ganha `max`)
- Delete: `src/components/planejamento/planejamento-detail/sync-tecidos.ts`

**Interfaces:**
- Consumes: `ficha` (Task 10 Step 12), `BomSecoes` (Task 9).
- Produces: Sheet com as seções 5-8 entre "Ajustes na Prova"/"Coleção" e "Preço e Custos"; `dirty` inclui o BOM; banner com "Tecidos & BOM"; Dialog "Novo Modelo" com a seção "Tecidos" (máx. 3).

- [ ] **Step 1: Import**

Depois da linha do import do `useFichaTecnica` (Task 10), inserir:

```ts
import { BomSecoes } from "@/components/planejamento/planejamento-detail/ficha/secoes/BomSecoes";
```

- [ ] **Step 2: "Não salvo" inclui o BOM**

Trocar `  const dirty = draftDirty || !moLinhasEqual(moLinhas, moLinhasBase) || gradeRevendaDirty;` por:

```ts
  const dirty = draftDirty || !moLinhasEqual(moLinhas, moLinhasBase) || gradeRevendaDirty || ficha.dirty;
```

(Se a F3.1 acrescentou termos a essa linha, só acrescentar `|| ficha.dirty` ao fim.)

- [ ] **Step 3: Merge colab avisa a ficha quando o `rev` mudou**

No efeito de merge (`useEffect` de `[modeloData]`), trocar a ÚNICA ocorrência de:

```ts
    if (!draftMudou) return;
```

por:

```ts
    // F3.2 — o rev mudou (save de outra pessoa, eco do meu, ou ação MINHA que mexe em `modelos` — Mover para…, Ordem,
    // Lançar, aprovar MO): sem BOM tocado ⇒ recarrega o BOM (o baseline acompanha); com BOM tocado ⇒ a ficha CONFERE se
    // o BOM do servidor mudou de verdade e só então acende "Tecidos & BOM" (R5 — o eco das próprias ações é ignorado).
    // Vale mesmo se o draft escalar não mudou (Dev :838-843).
    ficha.colab.aoMudarNoServidor();
    if (!draftMudou) return;
```

- [ ] **Step 4: Resolução do conflito de seção**

Substituir:

```ts
  const resolverPorPath = (path: string, escolha: "meu" | "dele") => {
    const c = conflitos.find((x) => x.path === path);
```

por:

```ts
  const resolverPorPath = (path: string, escolha: "meu" | "dele") => {
    // F3.2 — conflito de SEÇÃO do BOM: "manter meu" fecha o aviso (o próximo Salvar sobrescreve); "usar o novo"
    // descarta as edições do BOM e recarrega do servidor (Dev :1819-1838).
    if (path === "secao:bom") { ficha.colab.resolverConflitoBom(escolha === "meu"); return; }
    const c = conflitos.find((x) => x.path === path);
```

- [ ] **Step 5: Banner com o conflito de seção**

Trocar a linha `            conflitos={conflitos}` (props do `<ColabBanner>`) por:

```tsx
            conflitos={ficha.colab.conflitoBom ? [...conflitos, { path: "secao:bom", meu: "minhas edições não salvas", dele: "recarregar do servidor" }] : conflitos}
```

- [ ] **Step 6: Seções do BOM no Sheet (no lugar do comentário-âncora da F3.1)**

Substituir o comentário-âncora que a F3.1 deixou (2 linhas, texto final):

```tsx
          {/* ↓ F3.2: as seções do BOM (Tecidos/Forros/Entretelas · Aviamentos · Insumos · Grade) entram AQUI,
              entre "Ajustes na Prova" e "Preço" (ordem do mockup aprovado). */}
```

por:

```tsx
          {/* F3.2 — seções vindas do Desenvolvimento: Tecidos/Forros/Entretelas · Aviamentos · Insumos · Grade (ordem
              do mockup aprovado). SEMPRE visíveis (recolhidas) p/ quem vê o Desenvolvimento; editáveis p/ quem o
              edita (decisão F3 #8); só produto interno (comprado = F3.4). Substituem o "Tecido Planejado". */}
          {isEdit && modeloId && (
            <BomSecoes
              ficha={ficha}
              modeloId={modeloId}
              estoque={estoqueMap}
              ordemEnviada={enviada}
              onAbrirDev={() => setVerDevModeloId(modeloId)}
            />
          )}
```

- [ ] **Step 7: "Tecido Planejado" vira a seção "Tecidos" só do Dialog (G-mockup R3) — no MESMO lugar**

A F3.1 já pôs o bloco logo depois do comentário-âncora (antes do Preço/Mão de obra — ordem do mockup, `gen_novo.py`: Info → Coleção → Tecidos → Mão de obra → Anexos). Substituir o texto final da F3.1 (comentário da F3.1 + bloco):

```tsx
          {/* F3.1 — "Tecido Planejado" SUBIU para cá (mockup aprovado): no Dialog "Novo Modelo" fica ANTES da Mão de
              obra (gen_novo.py) e no Sheet no lugar da seção 5 "Tecidos" (gen_anotado.py), que a F3.2 troca pelo BOM. */}
          {/* SETOR 4 — Tecido Planejado (oculto p/ comprado — revenda/importado não têm tecido) */}
          {!isComprado && (
          <Secao titulo="Tecido Planejado" defaultOpen={false}>
            <MultiArtigosField
              label=""
              value={draft.tecidos_planejados}
              onChange={(v) => setDraftTracked((d) => ({ ...d, tecidos_planejados: v }))}
              artigos={artigos}
              estoque={estoqueMap}
            />
          </Secao>
          )}
```

por:

```tsx
          {/* F3.2 / G-mockup R3 — só no Dialog "Novo Modelo", ANTES da Mão de obra (gen_novo.py): o mesmo seletor do
              antigo "Tecido Planejado" (preço/m + estoque) GRAVA o BOM como Tecido 1..N (só o artigo) logo após o
              INSERT. No card existente os tecidos moram na seção "Tecidos / Forros / Entretelas" (BOM, logo acima) e a
              lista `tecidos_planejados` é derivada. */}
          {!isEdit && !isComprado && (
          <Secao titulo="Tecidos" defaultOpen>
            <MultiArtigosField
              label=""
              value={draft.tecidos_planejados}
              onChange={(v) => setDraftTracked((d) => ({ ...d, tecidos_planejados: v }))}
              artigos={artigos}
              estoque={estoqueMap}
              max={3}
            />
            <p className="text-xs text-muted-foreground">Ao salvar, cada tecido vira Tecido 1, 2 e 3 do BOM (só o tecido — cores, consumo e grade você completa no card).</p>
          </Secao>
          )}
```

- [ ] **Step 8: `MultiArtigosField` com limite**

Em `campos.tsx`, substituir:

```tsx
export function MultiArtigosField({ label, value, onChange, artigos, estoque }: {
  label: string; value: string[]; onChange: (v: string[]) => void; artigos: ArtigoOpt[];
  estoque: Record<string, EstoqueArtigo>;
}) {
  const available = artigos.filter((a) => !value.includes(a.id));
```

por:

```tsx
export function MultiArtigosField({ label, value, onChange, artigos, estoque, max }: {
  label: string; value: string[]; onChange: (v: string[]) => void; artigos: ArtigoOpt[];
  estoque: Record<string, EstoqueArtigo>;
  /** F3.2 — limite de itens (o BOM tem Tecido 1..3; o 4º nunca aparecia no Desenvolvimento). */
  max?: number;
}) {
  const available = artigos.filter((a) => !value.includes(a.id));
  const podeAdicionar = max === undefined || value.length < max;
```

e trocar `      {available.length > 0 && (` por `      {available.length > 0 && podeAdicionar && (`.

- [ ] **Step 9: Apagar o sync**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f32-ficha-bom"
grep -rn "sync-tecidos\|syncTecidosToDesenvolvimento" src tests | grep -v "planejamento-detail/sync-tecidos.ts"   # vazio
git rm -q src/components/planejamento/planejamento-detail/sync-tecidos.ts
```

- [ ] **Step 10: Gates + commit**

Os 5 gates. Depois:

```bash
git add -- src/components/planejamento/PlanejamentoDetail.tsx src/components/planejamento/planejamento-detail/campos.tsx
git commit --only -m "feat(planejamento): F3.2 (11) — seções do BOM no Sheet, conflito 'Tecidos & BOM', Dialog 'Tecidos' grava Tecido 1..3; sai o sync do Tecido Planejado

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- src/components/planejamento/PlanejamentoDetail.tsx src/components/planejamento/planejamento-detail/campos.tsx src/components/planejamento/planejamento-detail/sync-tecidos.ts
```

**Revisão individual (Opus):** `aoMudarNoServidor` ANTES do early-return (confere mesmo sem diff escalar) e sem laço (só recarrega/confere o BOM, não o `["modelo"]`); R5: o eco das ações do próprio usuário (Mover para…, Ordem, Lançar, aprovar MO) e o eco do meu save com BOM editado em voo NÃO acendem "Tecidos & BOM" (o BOM do servidor = referência); BOM mudado por outra pessoa acende; "usar o novo" recarrega mesmo com dados idênticos (`hidratarTick`); as seções do BOM entraram NO LUGAR do comentário-âncora da F3.1 e a seção "Tecidos" do Dialog no lugar do "Tecido Planejado" (Dialog: Info → Coleção → Tecidos → Mão de obra → Anexos — `gen_novo.py`); o Dialog grava no máximo 3 tecidos; a seção "Tecido Planejado" sumiu do card existente; `Secao` e o resto do Sheet intocados fora das linhas citadas.

---

## Task 12: "Preço e Custos" — custo-base único (decisão F3 #6) + custos do BOM como LINHAS da tabela (decisão F3 #2, mockup)  *(individual Opus)*

**Files:**
- Modify: `src/components/planejamento/PlanejamentoDetail.tsx` (bloco de preço e a seção Preço)
- Modify: `src/components/planejamento/planejamento-detail/PrecoTabela.tsx`

**Interfaces:**
- Consumes: `baseCustoPlanejamento`, `previstoDaFicha`, `SeloCusto` (Task 3); `ficha.totais`/`ficha.carregado`/`ficha.habilitada`/`ficha.podeEditar`/`ficha.podeVerCustos`/`ficha.camposCopiados`/`ficha.onCampoEditado` (Task 7); `type CustoAdicional` (`ModeloCustosSection` do Dev — só o TIPO; o componente NÃO é usado); `classeCopiado` (`@/components/desenvolvimento/importar/highlight`, só importar).
- Produces: `PrecoTabela` com props `seloCusto: SeloCusto; custoBase: number; materiaisBase: number; custosBom?: CustosBomTabela | null` (saem `custoReal`, `custoEstimado`, `materiaisReal`, `custoRealTotal`); `export type CustosBomTabela = { totais: { tecido; forro; entretela; aviamento; etiqueta }; custosAdicionais: CustoAdicional[]; onChange; editavel: boolean; copiados: Set<string>; onEditado: (chave: string) => void }`.
- Mockup (R9c do G-plano conjunto, `gen_anotado.py` seção 10, ~152-160): os custos do BOM são LINHAS da tabela de Preço e Custos — Tecido, Forro, Entretela, Aviamento, Etiquetas (Insumos), Custos adicionais (descrição + valor; "+ Adicionar custo") —, NÃO um bloco à parte. Sem impedimento técnico: a tabela já é do Planejamento (`PrecoTabela`, só props) e as linhas usam os MESMOS dados que o `ModeloCustosSection` do Dev mostraria (`ficha.totais`, `draft.custos_adicionais`). Detalhe: `<fieldset>` não pode ficar dentro de `<tbody>` (HTML inválido) — a trava vai por `disabled` em cada input e os botões somem sem `editavel`.

- [ ] **Step 1: Imports em `PlanejamentoDetail.tsx`**

Depois do import do `BomSecoes` (Task 11), inserir:

```ts
import { baseCustoPlanejamento, previstoDaFicha } from "@/components/planejamento/planejamento-detail/custo-base";
```

- [ ] **Step 2: Tirar o `precoInfo` antigo do topo**

Substituir:

```ts
  // Cálculo de preço (Setor "Preço") — mesma lógica usada na lista e nos Lançamentos.
  const custoReal = !!custoData?.confirmado;
  const { custo, markupLinha: markup, preco, sugerido: precoSug, efetivo: precoEfetivo, markupReal } =
    precoInfo(custoData?.real, linhas.find((l) => l.id === draft.linha_id)?.markup, draft.preco_venda, draft.markup_editado);
```

por:

```ts
  // Cálculo de preço (seção "Preço e Custos"). F3.2 (decisão F3 #6): o `precoInfo` foi para DEPOIS da estimativa
  // — o custo-base agora é real › previsto do BOM › estimativa (ver `custoBase` mais abaixo).
  const custoReal = !!custoData?.confirmado;
```

e APAGAR a linha `  const materiaisSetor = custo > 0 ? custo - maoObraSetor : 0;` (ela volta no Step 3).

- [ ] **Step 3: Custo-base depois da estimativa**

Logo DEPOIS do bloco:

```ts
  const simCalc = custoSimulado({
    consumo_tecido: consumoUsado,
    preco_tecido_m: precoTecidoM,
    aviamento: draft.custo_simulado.aviamento,
    mao_obra: maoObraUsado,
  });
```

inserir:

```ts
  // F3.2 — decisão F3 #6: o markup e a tabela usam o MESMO custo-base, com selo de 3 estados. Previsto = o do BOM
  // AO VIVO quando a ficha está carregada (e o BOM tem material); senão o salvo (custo_peca_previsto do Dev).
  const previstoBase = ficha.carregado ? previstoDaFicha(ficha.totais) : Number(custoData?.previsto) || 0;
  const custoBase = baseCustoPlanejamento({ confirmado: custoReal, realServidor: custoData?.real, previsto: previstoBase, estimativa: simCalc.total });
  const { custo, markupLinha: markup, preco, sugerido: precoSug, efetivo: precoEfetivo, markupReal } =
    precoInfo(custoBase.valor, linhas.find((l) => l.id === draft.linha_id)?.markup, draft.preco_venda, draft.markup_editado);
  // M.O. embutida no custo-base: a real (Serviços ÷ grade) quando confirmado; senão a planejada ao vivo.
  const moEmbutida = custoBase.selo === "real" ? maoObraSetor : maoObraDevLive;
  const materiaisSetor = custo > 0 ? Math.max(0, custo - moEmbutida) : 0;
```

Trocar `  const materiaisParaFaixa = custoReal ? materiaisSetor : Math.max(0, simCalc.total - maoObraDevLive);` por:

```ts
  const materiaisParaFaixa = materiaisSetor; // F3.2 #6: mesma base do markup (real / previsto / estimado)
```

Conferir que nada entre o antigo `precoInfo` e o `simCalc` usava `custo`/`markup`/`preco`/`precoSug`/`precoEfetivo`/`markupReal`: `grep -n "precoEfetivo\|markupReal\|precoSug\b" src/components/planejamento/PlanejamentoDetail.tsx` — todas as linhas devem ficar ABAIXO do bloco novo (o `tsc` também acusa "used before declaration").

- [ ] **Step 4: Props da `PrecoTabela` na chamada**

Na chamada `<PrecoTabela`: trocar a LINHA EXATA `                custoReal={custoReal}` (a `PrecoRevendaBloco` tem `custoReal={custoReal}` no MEIO da linha dela — não mexer) por `                seloCusto={custoBase.selo} custoBase={custo}`; na linha `                aviamento={draft.custo_simulado.aviamento ?? null} maoObraDev={maoObraDevLive} custoEstimado={simCalc.total}` remover ` custoEstimado={simCalc.total}`; trocar `                materiaisReal={materiaisSetor} custoRealTotal={custo} custoPrevisto={custoPrevisto}` por `                materiaisBase={materiaisSetor} custoPrevisto={custoPrevisto}`; e trocar

```tsx
                onVerDev={modeloId ? () => setVerDevModeloId(modeloId) : undefined}
              />
```

por

```tsx
                onVerDev={modeloId ? () => setVerDevModeloId(modeloId) : undefined}
                // F3.2 — decisão F3 #2 + mockup (R9c): custos do BOM como LINHAS desta tabela, p/ quem vê custos no
                // Planejamento OU no Desenvolvimento; custos adicionais editáveis só sem trava (`ficha.podeEditar`).
                custosBom={ficha.habilitada && ficha.carregado && ficha.podeVerCustos ? {
                  totais: ficha.totais,
                  custosAdicionais: draft.custos_adicionais,
                  onChange: (v) => setDraftTracked((d) => ({ ...d, custos_adicionais: v })),
                  editavel: ficha.podeEditar,
                  copiados: ficha.camposCopiados,
                  onEditado: ficha.onCampoEditado,
                } : null}
              />
```

- [ ] **Step 5: Seção "Preço e Custos"**

Trocar `          <Secao titulo="Preço" defaultOpen={false}>` por `          <Secao titulo="Preço e Custos" defaultOpen={false}>` (título do mockup; os custos do BOM ficam DENTRO da tabela — Step 6 —, sem bloco à parte).

- [ ] **Step 6: `PrecoTabela.tsx` — selo de 3 estados sobre o custo-base + linhas "Custos do BOM" (mockup)**

Depois de `import { brl, fmtNum } from "@/lib/format";`, inserir:

```ts
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SeloCusto } from "@/components/planejamento/planejamento-detail/custo-base";
import type { CustoAdicional } from "@/components/desenvolvimento/modelo-detail/ModeloCustosSection";
import { classeCopiado } from "@/components/desenvolvimento/importar/highlight";

/**
 * F3.2 (decisão F3 #2 + mockup Anotado, seção 10 — R9c do G-plano conjunto): os custos do BOM (previsto) são LINHAS
 * desta tabela — Tecido, Forro, Entretela, Aviamento, Insumos e os custos adicionais (descrição + valor por peça;
 * "Adicionar custo") —, com os MESMOS dados que o `ModeloCustosSection` do Dev mostra. null = sem ficha carregada ou
 * sem permissão de ver custos (as linhas não aparecem).
 */
export type CustosBomTabela = {
  totais: { tecido: number; forro: number; entretela: number; aviamento: number; etiqueta: number };
  custosAdicionais: CustoAdicional[];
  onChange: (v: CustoAdicional[]) => void;
  /** `ficha.podeEditar` (permissão do Dev + trava única). Sem isso: só leitura, sem adicionar/remover. */
  editavel: boolean;
  /** Destaque do "Importar dados" (o diálogo é da F3.3). */
  copiados: Set<string>;
  onEditado: (chave: string) => void;
};
```

No tipo das props, substituir:

```ts
  // custo: real (BOM confirmado) OU estimado (tecido + aviamento + M.O.). Selo previsto/real por modelo.
  custoReal: boolean;
  // estimado (editável): consumo de tecido × preço/m + aviamento manual + M.O. (dev)
  consumo: number | null; consumoRealBOM: number; precoTecidoM: number; tecidoEstimado: number;
  aviamento: number | null; maoObraDev: number; custoEstimado: number;
  onConsumo: (v: string) => void; onAviamento: (v: string) => void;
  // real (BOM): materiais reais + total real; e o previsto p/ o histórico. (A M.O. exibida é
  // SEMPRE a planejada `maoObraDev` — ver comentário na linha M.O. —, então não recebe a real.)
  materiaisReal: number; custoRealTotal: number; custoPrevisto: number;
```

por:

```ts
  // F3.2 (decisão F3 #6): custo-base ÚNICO (o MESMO que o markup usa) + selo de 3 estados —
  // real (CAD enviado ao corte) › previsto (BOM) › estimado (tecido + materiais + M.O.).
  seloCusto: SeloCusto; custoBase: number;
  // estimado (editável): consumo de tecido × preço/m + aviamento manual + M.O. (dev)
  consumo: number | null; consumoRealBOM: number; precoTecidoM: number; tecidoEstimado: number;
  aviamento: number | null; maoObraDev: number;
  onConsumo: (v: string) => void; onAviamento: (v: string) => void;
  // materiais = custo-base − M.O. embutida; `custoPrevisto` = o previsto SALVO, p/ o histórico "antes (previsto)".
  // (A M.O. exibida é SEMPRE a planejada `maoObraDev` — ver comentário na linha M.O.)
  materiaisBase: number; custoPrevisto: number;
  // F3.2 — linhas "Custos do BOM" (mockup): null/ausente = não aparecem.
  custosBom?: CustosBomTabela | null;
```

Na desestruturação, substituir:

```ts
    custoReal, consumo, consumoRealBOM, precoTecidoM, tecidoEstimado, aviamento, maoObraDev, custoEstimado,
    onConsumo, onAviamento, materiaisReal, custoRealTotal, custoPrevisto,
```

por:

```ts
    seloCusto, custoBase, consumo, consumoRealBOM, precoTecidoM, tecidoEstimado, aviamento, maoObraDev,
    onConsumo, onAviamento, materiaisBase, custoPrevisto, custosBom,
```

Substituir:

```ts
  // Quando confirmado (real), as linhas de custo mostram o REAL do BOM (leitura). Enquanto não,
  // mostram a ESTIMATIVA editável (tecido calculado + aviamento manual + M.O.). Selo por modelo.
  const custoTotal = custoReal ? custoRealTotal : custoEstimado;
  const temCusto = custoTotal > 0;
  const seloCusto = custoReal
    ? <StatusBadge tone="success">real</StatusBadge>
    : <StatusBadge tone="warning">estimado</StatusBadge>;
  // Histórico 1 nível: quando o real assume e diverge do previsto/estimado.
  const divergePrevisto = custoReal && custoPrevisto > 0 && Math.abs(custoPrevisto - custoRealTotal) >= 0.01;
```

por:

```ts
  // F3.2 (decisão F3 #6): o "Custo total" é o MESMO número que o markup usa (custo-base). Real → leitura do real;
  // previsto → materiais do BOM (leitura); estimado → a ESTIMATIVA editável de sempre.
  const custoReal = seloCusto === "real";
  const custoTotal = custoBase;
  const temCusto = custoTotal > 0;
  const seloBadge = seloCusto === "real"
    ? <StatusBadge tone="success">real</StatusBadge>
    : seloCusto === "previsto"
      ? <StatusBadge tone="info">previsto</StatusBadge>
      : <StatusBadge tone="warning">estimado</StatusBadge>;
  // Histórico 1 nível: quando o real assume e diverge do previsto salvo.
  const divergePrevisto = custoReal && custoPrevisto > 0 && Math.abs(custoPrevisto - custoBase) >= 0.01;
  // F3.2 — custos adicionais (linhas "Custos do BOM"): mesma edição do `ModeloCustosSection` do Dev (estado COMPLETO
  // do array a cada mudança; marca o campo como editado p/ o destaque do Importar).
  const linhasBom: [string, number][] = custosBom
    ? [["Tecido", custosBom.totais.tecido], ["Forro", custosBom.totais.forro], ["Entretela", custosBom.totais.entretela],
       ["Aviamento", custosBom.totais.aviamento], ["Insumos", custosBom.totais.etiqueta]]
    : [];
  const patchCusto = (i: number, p: Partial<CustoAdicional>) => {
    if (!custosBom) return;
    custosBom.onChange(custosBom.custosAdicionais.map((c, k) => (k === i ? { ...c, ...p } : c)));
    custosBom.onEditado("custos_adicionais");
  };
  const adicionarCusto = () => {
    if (!custosBom) return;
    custosBom.onChange([...custosBom.custosAdicionais, { descricao: "", valor: 0 }]);
    custosBom.onEditado("custos_adicionais");
  };
  const removerCusto = (i: number) => {
    if (!custosBom) return;
    custosBom.onChange(custosBom.custosAdicionais.filter((_, k) => k !== i));
    custosBom.onEditado("custos_adicionais");
  };
  const realceCopiado = custosBom ? classeCopiado(custosBom.copiados, "custos_adicionais") : "";
```

Na linha "Consumo de tecido", substituir:

```tsx
              {custoReal ? (
                <span className="tabular-nums">{consumoRealBOM > 0 ? `${fmtNum(consumoRealBOM)} m` : "—"}</span>
```

por:

```tsx
              {seloCusto !== "estimado" ? (
                <span className="tabular-nums">{consumoRealBOM > 0 ? `${fmtNum(consumoRealBOM)} m` : "—"}</span>
```

Na PARTE 2, substituir:

```tsx
          {custoReal ? (
            <tr className="border-t">
              <td className="py-2 pr-3 whitespace-nowrap">Materiais <span className="text-[11px] italic text-muted-foreground">tecido + aviamentos</span></td>
              <td className="py-2 px-2 text-right text-muted-foreground">—</td>
              <td className="py-2 px-2 text-right tabular-nums">{brl(materiaisReal)}</td>
              <td className="py-2 pl-2 text-xs text-muted-foreground">
                {seloCusto} {onVerDev ? <button type="button" onClick={onVerDev} className="text-primary hover:underline">ver no Desenvolvimento ⧉</button> : "do BOM"}
              </td>
            </tr>
          ) : (
```

por:

```tsx
          {seloCusto === "real" ? (
            <tr className="border-t">
              <td className="py-2 pr-3 whitespace-nowrap">Materiais <span className="text-[11px] italic text-muted-foreground">tecido + aviamentos</span></td>
              <td className="py-2 px-2 text-right text-muted-foreground">—</td>
              <td className="py-2 px-2 text-right tabular-nums">{brl(materiaisBase)}</td>
              <td className="py-2 pl-2 text-xs text-muted-foreground">
                {seloBadge} {onVerDev ? <button type="button" onClick={onVerDev} className="text-primary hover:underline">ver no Desenvolvimento ⧉</button> : "do BOM"}
              </td>
            </tr>
          ) : seloCusto === "previsto" ? (
            // Com a ficha carregada, as linhas "Custos do BOM" (abaixo) já detalham os materiais — sem linha somada aqui.
            custosBom ? null : (
            <tr className="border-t">
              <td className="py-2 pr-3 whitespace-nowrap">Materiais <span className="text-[11px] italic text-muted-foreground">do BOM + custos adicionais</span></td>
              <td className="py-2 px-2 text-right text-muted-foreground">—</td>
              <td className="py-2 px-2 text-right tabular-nums">{brl(materiaisBase)}</td>
              <td className="py-2 pl-2 text-xs text-muted-foreground">{seloBadge} do BOM (Custo de 1 Peça)</td>
            </tr>
            )
          ) : (
```

Logo ANTES da linha da Mão de obra da PARTE 2:

```tsx
          <tr className="border-t">
            <td className="py-2 pr-3">Mão de obra</td>
```

inserir as linhas do BOM (mockup: "Custos — previsto (do BOM, assim que existe)"):

```tsx
          {/* F3.2 — custos do BOM como LINHAS da tabela (decisão F3 #2 + mockup Anotado, seção 10 — R9c). A trava é por
              `disabled` em cada input (um <fieldset> não pode ficar dentro de <tbody>); sem `editavel` somem os botões. */}
          {custosBom && (
            <>
              <tr className="bg-muted/40"><td colSpan={4} className="py-1.5 px-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Custos do BOM <span className="normal-case font-normal tracking-normal">— previsto, do Desenvolvimento</span></td></tr>
              {linhasBom.map(([rotulo, valor]) => (
                <tr key={rotulo} className="border-t">
                  <td className="py-2 pr-3">{rotulo}</td>
                  <td className="py-2 px-2 text-right text-muted-foreground">—</td>
                  <td className="py-2 px-2 text-right tabular-nums">{valor > 0 ? brl(valor) : "—"}</td>
                  <td className="py-2 pl-2 text-xs text-muted-foreground">do BOM</td>
                </tr>
              ))}
              {custosBom.custosAdicionais.map((c, i) => (
                <tr key={`custo-adicional-${i}`} className={`border-t ${realceCopiado}`}>
                  <td className="py-2 pr-3">
                    <Input
                      className="h-8 w-full"
                      placeholder="Descrição do custo"
                      value={c.descricao}
                      disabled={!custosBom.editavel}
                      onChange={(e) => patchCusto(i, { descricao: e.target.value })}
                      data-colab-path={`custo-descricao:${c.descricao}`}
                    />
                  </td>
                  <td className="py-2 px-2 text-right text-muted-foreground">—</td>
                  <td className="py-2 px-2 text-right">
                    <NumberInput
                      className="ml-auto h-8 w-28 text-right tabular-nums"
                      placeholder="0,00"
                      value={c.valor || ""}
                      disabled={!custosBom.editavel}
                      onChange={(e) => patchCusto(i, { valor: Number(e.target.value) || 0 })}
                      data-colab-path={`custo-valor:${c.descricao}`}
                    />
                  </td>
                  <td className="py-2 pl-2 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      custo adicional por peça
                      {custosBom.editavel && (
                        <Button type="button" variant="ghost" size="iconSm" className="text-muted-foreground max-sm:h-11 max-sm:w-11" aria-label="Remover custo" title="Remover" onClick={() => removerCusto(i)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
              {custosBom.editavel && (
                <tr className="border-t">
                  <td colSpan={4} className="py-1.5 px-2">
                    <button type="button" onClick={adicionarCusto} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline max-sm:min-h-11">
                      <Plus className="h-3.5 w-3.5" /> Adicionar custo
                    </button>
                  </td>
                </tr>
              )}
            </>
          )}
```

Trocar as 3 ocorrências restantes de `{seloCusto}` (JSX) por `{seloBadge}`: em `{seloCusto} consumo × preço/m`, em `{seloCusto} estimativa (real vem do BOM ao cadastrar)` e em `{seloCusto}{divergePrevisto ?`.

```bash
F=src/components/planejamento/planejamento-detail/PrecoTabela.tsx
grep -c "{seloCusto}" $F; grep -c "custoReal ?" $F; grep -c "custoEstimado\|materiaisReal\|custoRealTotal" $F   # 0 / 0 / 0
grep -c "Custos do BOM" $F                                                    # 1 (linha de cabeçalho da parte)
grep -rn "ModeloCustosSection" src/components/planejamento | grep -v "import type"   # vazio (só o TIPO é usado)
```

- [ ] **Step 7: Gates + commit**

Os 5 gates. Depois:

```bash
git add -- src/components/planejamento/PlanejamentoDetail.tsx src/components/planejamento/planejamento-detail/PrecoTabela.tsx
git commit --only -m "feat(planejamento): F3.2 (12) — Preço e Custos: markup e tabela no mesmo custo-base (real/previsto/estimado) + custos do BOM e custos adicionais como linhas da tabela (decisões F3 #2 e #6, mockup)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- src/components/planejamento/PlanejamentoDetail.tsx src/components/planejamento/planejamento-detail/PrecoTabela.tsx
```

**Revisão individual (Opus):** ordem real › previsto › estimado idêntica à decisão F3 #6; sem previsto, o markup passa a usar a estimativa (antes "—") — registrar como mudança visível; "M.O. por faixa" usa os mesmos materiais do custo-base; revenda (`PrecoRevendaBloco`/`piRevenda`) intocada; linhas "Custos do BOM" DENTRO da tabela (mockup, R9c) só com ficha carregada e alguma das 2 permissões — mesmos valores que o `ModeloCustosSection` do Dev mostraria (`ficha.totais`, `draft.custos_adicionais`); custos adicionais travados sem `ficha.podeEditar` (inputs `disabled`, sem Adicionar/Remover); `data-colab-path` iguais aos do Dev; nada de `<fieldset>` dentro de `<tbody>`; 360px: a tabela já rola no `overflow-x-auto`.

---

## Task 13: Duplicar — herda o Planejamento + os tecidos (só o artigo)  *(individual Opus)*

**Files:**
- Modify: `src/components/planejamento/PlanejamentoDetail.tsx` (mutation `duplicate`)

**Interfaces:**
- Consumes: `camposParaDuplicar` (F3.1 — já no `duplicate`: `...camposParaDuplicar(draft),`; com a lista ÚNICA `CAMPOS_DEV_DRAFT`, que a Task 1 estendeu com `proporcoes`/`custos_adicionais`), `artigosTecidoPrincipais` (Task 2), `gravarTecidosIniciais` (Task 7), `ficha` (Task 10).

- [ ] **Step 1: Imports**

Depois do import do `custo-base` (Task 12), inserir:

```ts
import { artigosTecidoPrincipais } from "@/components/planejamento/planejamento-detail/ficha/ficha-calc";
import { gravarTecidosIniciais } from "@/components/planejamento/planejamento-detail/ficha/persistir-bom";
```

- [ ] **Step 2: Insert com BOM inicial**

Na mutation `duplicate`, substituir:

```ts
      const { error } = await supabase.from("modelos").insert(payload);
      if (error) throw error;
```

por:

```ts
      // F3.2 — decisão F3 #9: a nova versão herda o Planejamento + os TECIDOS (só o artigo); o resto do
      // Desenvolvimento (equipe, datas, proporções, custos adicionais…) nasce vazio — já saiu no `camposParaDuplicar`
      // da F3.1 (lista ÚNICA `CAMPOS_DEV_DRAFT`). O BOM da cópia é gravado como Tecido 1..N logo após o insert (uma
      // fonte só; a lista segue derivada): com a ficha carregada, os artigos PRINCIPAIS dos blocos Tecido (sem
      // substitutos); sem ela, a lista salva (comportamento de hoje).
      const tecidosDaCopia = ficha.carregado ? artigosTecidoPrincipais(ficha.estado.blocks) : draft.tecidos_planejados.slice(0, 3);
      payload.tecidos_planejados = tecidosDaCopia;
      const { data: novo, error } = await supabase.from("modelos").insert(payload).select("id").single();
      if (error) throw error;
      if (novo?.id) await gravarTecidosIniciais(novo.id, tecidosDaCopia);
```

- [ ] **Step 3: Gates + commit**

Os 5 gates. Depois:

```bash
git add -- src/components/planejamento/PlanejamentoDetail.tsx
git commit --only -m "feat(planejamento): F3.2 (13) — Duplicar herda Planejamento + tecidos (Tecido 1..N no BOM); resto do Dev nasce vazio (decisão F3 #9)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- src/components/planejamento/PlanejamentoDetail.tsx
```

**Revisão individual (Opus):** `gravarTecidosIniciais` só com o id do insert (nunca `modeloId`); a exclusão cobre as colunas do Dev da F3.1 e da F3.2 pela lista ÚNICA (`camposParaDuplicar` + `CAMPOS_DEV_DRAFT`; nenhuma lista paralela); `descricao_produto` e anexos seguem herdados (spec); `ref` segue fora (invariante #11).

---

## Task 14: Snapshot só-leitura do BOM/CAD antes da produção (G-inicial #7)  *(controlador — pré-condição do merge)*

**Files:** nenhum no repo. Saída em `/Users/sunglee/PLM + Criação/savepoints/<data>-pre-f3-bom/` (FORA do repo; contém dado de loja; nunca commitar).

Quando: (1) ANTES do fast-forward da F3.2 (o vite do dono grava em produção assim que o código chega à branch dele) e (2) de novo ANTES do deploy Cloudflare da F3. Só leitura (`default_transaction_read_only=on`).

- [ ] **Step 1: Exportar**

```bash
DEST="/Users/sunglee/PLM + Criação/savepoints/$(date +%F)-pre-f3-bom"
mkdir -p "$DEST"
URL="$(cat /tmp/dburl.txt)"
for T in modelo_tecidos modelo_tecido_variantes modelo_tecido_oc_links modelo_aviamentos modelo_grades modelo_etiquetas \
         cad cad_tecidos cad_tecido_variantes cad_grades cad_aviamentos cad_etiquetas; do
  PGOPTIONS='-c default_transaction_read_only=on' psql "$URL" -v ON_ERROR_STOP=1 -q \
    -c "\copy (SELECT * FROM public.$T ORDER BY id) TO '$DEST/$T.csv' CSV HEADER"
done
PGOPTIONS='-c default_transaction_read_only=on' psql "$URL" -v ON_ERROR_STOP=1 -q \
  -c "\copy (SELECT id, tenant_id, rev, tecidos_planejados, proporcoes, custos_adicionais, custo_tecido_total, custo_forro_total, custo_entretela_total, custo_aviamento_total, custo_peca_previsto, enviado_cad, ordem_criacao_enviada FROM public.modelos ORDER BY id) TO '$DEST/modelos_colunas_bom.csv' CSV HEADER"
PGOPTIONS='-c default_transaction_read_only=on' psql "$URL" -At -c "SELECT count(*) FROM public.modelo_bom_snapshots" > "$DEST/modelo_bom_snapshots_count.txt"
(cd "$DEST" && for f in *.csv; do printf '%s\t%s linhas\t%s\n' "$f" "$(($(wc -l < "$f") - 1))" "$(shasum -a 256 "$f" | cut -c1-16)"; done) > "$DEST/INDICE.tsv"
cat "$DEST/INDICE.tsv"
```

Expected: 13 CSVs com contagem e hash. Escrever `$DEST/LEIA-ME.md` com: data/hora, commit do código (`git -C <repo> rev-parse HEAD`), "restaurar só com OK do dono", e o aviso "contém dados de lojas — não commitar".

- [ ] **Step 2: Registrar**

Acrescentar 1 linha no diário do guardião (via o próprio guardião no G-fase) com o caminho e o `INDICE.tsv`. Sem commit.

---

## Task 15: QA contra a CÓPIA — app de teste da worktree (`:5186`), guarda invertida, fluxos que gravam na cópia  *(controlador; relatório ao guardião)*

> **Por que na cópia (N2 do re-check do guardião + ruling do controlador — o MESMO modo da F3.1):** o app de teste da worktree fala só com a CÓPIA LOCAL, então os caminhos de escrita da F3.2 (`salvar_modelo_bom` real, P0409 real, Realtime "Tecidos & BOM" entre abas, Dev ↔ Planejamento, card novo com Tecido 1..N, Duplicar) são provados de verdade sem tocar produção. Produção fica com o snapshot (Task 14) e o smoke só-leitura (Task 16 Step 6).

**Files:**
- Create (NÃO versionar): `tests/e2e/f32-qa.spec.ts`; evidência em `.superpowers/f32/qa/` (fluxos que gravam: `.superpowers/f32/qa/escrita/`).
- Usa (fora do repo, criados pela F3.1 — Task 10 Steps 2/3 dela): `banco-local/app-teste-variantes/criar-variante.sh` (gera a variante `f32` em `:5186`) e o `copia-qa.sh` da worktree da F3.1 (coluna na cópia).

Regras (R4 do G-plano conjunto — as MESMAS da F3.1): no automático, barradas esperadas (`rpc/servicos_financeiro` da Home e o broadcast REST do Realtime) continuam BARRADAS e não reprovam; `servicos_financeiro` NUNCA entra em `READ_RPCS` (o spec recusa); a loja é conferida pelo tenant_id `37889b78-fffb-404b-8c75-18b7e50a1d9b`; na cópia, qualquer requisição a `*.supabase.co` reprova (guarda invertida); `:5186` ocupada ⇒ PARE; derrubar SÓ pelo `descer.sh` da variante. Nunca junto com o E2E da F2 nem com o QA da F3.1/F3.1b (mesmo usuário; Realtime REAL na cópia).

- [ ] **Step 1: Pré-condições, coluna na cópia e a variante `:5186`**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f32-ficha-bom"
ps -Ao pid,command | grep -E "[v]itest|playwright|kanban-auto.spec|f3[0-9]-qa" | grep -v grep; echo "testes-checados"
lsof -nP -iTCP:5186 -sTCP:LISTEN; lsof -nP -iTCP:5187 -sTCP:LISTEN; echo "portas-checadas"
curl -s -o /dev/null -w 'Supabase local http=%{http_code}\n' http://127.0.0.1:54321/auth/v1/health
curl -s -o /dev/null -w 'app de teste do dono :5188 http=%{http_code} (só observado)\n' http://localhost:5188/
PGCONNECT_TIMEOUT=5 psql "postgresql://postgres:postgres@127.0.0.1:54422/postgres" -X -A -t \
  -c "select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'modelos' and column_name = 'descricao_produto'" \
  | sed 's/^/coluna descricao_produto na cópia = /'
git -C "/Users/sunglee/PLM + Criação/plm-pcp" cat-file -e feature/plan-tecido-a1:supabase/migrations/20260930180000_modelo_descricao_produto.sql 2>/dev/null && echo "F3.1 JÁ juntada" || echo "F3.1 ainda NÃO juntada"
```

Expected: só `testes-checados` (nenhum vitest/Playwright rodando); só `portas-checadas` (`:5186` e `:5187` livres); `Supabase local http=200` (senão: o dono sobe os serviços — APP-TESTE-LOCAL.md §1); o `:5188` só observado. Coluna:
- `= 1` → segue.
- `= 0` e **F3.1 ainda NÃO juntada** → pôr a coluna pelo script da F3.1 (backup `pg_dump -Fc` antes; mesma receita de travas; o script só LÊ a worktree da F3.1):
  ```bash
  cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f31-planejamento-campos" && bash .superpowers/f31/mig/copia-qa.sh ida 2>&1 | tail -8
  ```
  Expected: `== COLUNA NA CÓPIA` e `cópia (…): …|…|1`. (Ela sai de novo no Step 5.)
- `= 0` e **F3.1 JÁ juntada** → a F3.1 deixou a coluna na cópia (Task 11 Step 5b dela): PARE e avise o controlador (não criar por conta própria).

Depois, a variante (o `criar-variante.sh` é o da F3.1 — se não existir, PARE: a F3.2 nasce depois do QA da F3.1, então ele já devia existir):

```bash
VAR="/Users/sunglee/PLM + Criação/banco-local/app-teste-variantes"
test -x "$VAR/criar-variante.sh" && echo "criar-variante.sh ok" || echo "criar-variante.sh AUSENTE — PARE"
bash "$VAR/criar-variante.sh" f32 "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f32-ficha-bom" 5186
"$VAR/f32/subir.sh"
lsof -nP -iTCP:5188 -sTCP:LISTEN -t | sed 's/^/:5188 do dono intacto, PID /'
```

Expected: `criar-variante.sh ok`; `variante f32 pronta …`; `OK: variante f32 em http://localhost:5186 (PID …)` + `[guarda-copia-local] OK: variante f32 (:5186, raiz …/f32-ficha-bom) — cliente e worker -> http://127.0.0.1:54321 (cópia local)`; o `:5188` com o mesmo PID. `RECUSADO`/`ABORTADO`/`ERRO`: PARE e reporte (nunca contornar a guarda; nunca `npm run dev` + `VITE_*`).

- [ ] **Step 2: Escrever o spec**

```ts
// tests/e2e/f32-qa.spec.ts — QA da F3.2 (BOM no Sheet do Planejamento). NÃO COMMITAR (apoio da worktree; apagado
// na Task 16).
// DOIS ALVOS (re-check do guardião N2 + ruling do controlador) — F32_ALVO obrigatório:
//  • "copia"    — Task 15: app de teste DA WORKTREE (http://localhost:5186, variante do banco-local/app-teste) sobre a
//                 CÓPIA LOCAL (Supabase http://127.0.0.1:54321). Guarda INVERTIDA: QUALQUER requisição a *.supabase.co
//                 (GET inclusive) é violação e é barrada. O teste automático segue com as escritas SIMULADAS; os fluxos
//                 E1–E6 (fim do arquivo, F32_ESCRITA=1) GRAVAM de verdade — só na cópia, um por vez, dono avisado.
//  • "producao" — smoke SÓ-LEITURA pós-merge no :5173 do dono (Task 16 Step 6): toda escrita no Supabase é SIMULADA
//                 aqui (route.fulfill; nunca chega ao banco) ou BARRADA.
// Barradas ESPERADAS do automático (seguem barradas, não reprovam — as MESMAS da F3.1, R4 do G-plano conjunto):
// `rpc/servicos_financeiro` da Home (NUNCA liberar) e o broadcast REST do Realtime. Qualquer outra barrada = violação e
// o teste falha. Passam: /auth/v1, URL assinada, GET/HEAD e as RPCs de READ_RPCS. Na origem do app, todo NÃO-GET é
// barrado. O robô NÃO troca de loja: toda leitura de tenant_config tem de ser da Loja Teste (pelo tenant_id).
// Rodar (cópia): E2E_BASE_URL=http://localhost:5186 VITE_SUPABASE_URL=http://127.0.0.1:54321 F32_ALVO=copia \
//   npx playwright test tests/e2e/f32-qa.spec.ts --workers=1 --retries=0
import { test, expect, type Browser, type BrowserContext, type Page, type Request, type Route } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { Client as PgClient } from "pg";
import { doLogin } from "./_helpers";

const BASE = process.env.E2E_BASE_URL ?? "";
if (!/^http:\/\/localhost:\d+$/.test(BASE)) {
  throw new Error(`E2E_BASE_URL precisa ser o vite LOCAL (http://localhost:<porta>) — recebido "${BASE}". Sem isso o QA NÃO foi feito.`);
}
const ALVO = process.env.F32_ALVO ?? "";
if (ALVO !== "copia" && ALVO !== "producao") {
  throw new Error(`F32_ALVO obrigatório: "copia" (Task 15 — app de teste da worktree :5186) ou "producao" (smoke só-leitura no :5173). Recebi "${ALVO}".`);
}
// NOTA do re-check do guardião: SEM fallback de host — sem VITE_SUPABASE_URL a guarda não saberia o que vigiar (fail-open).
if (!process.env.VITE_SUPABASE_URL) {
  throw new Error("VITE_SUPABASE_URL ausente: a guarda de rede não sabe o host do Supabase. PARE (nada foi testado).");
}
const SUPA_HOST = new URL(process.env.VITE_SUPABASE_URL).host;
if (ALVO === "copia" && (SUPA_HOST !== "127.0.0.1:54321" || BASE !== "http://localhost:5186")) {
  throw new Error(`F32_ALVO=copia exige VITE_SUPABASE_URL=http://127.0.0.1:54321 e E2E_BASE_URL=http://localhost:5186 (recebi ${SUPA_HOST} · ${BASE}).`);
}
if (ALVO === "producao" && (!/\.supabase\.co$/.test(SUPA_HOST) || BASE !== "http://localhost:5173")) {
  throw new Error(`F32_ALVO=producao é o smoke no :5173 do dono (Supabase de produção) — recebi ${SUPA_HOST} · ${BASE}.`);
}
const ehSupabaseProducao = (u: URL) => /(^|\.)supabase\.co$/i.test(u.hostname);
const ESCRITA = process.env.F32_ESCRITA === "1";
const LOJA_TESTE = "37889b78-fffb-404b-8c75-18b7e50a1d9b"; // "Loja Teste" — conferida pelo tenant_id (o rótulo pode mudar)
const FAKE_NOVO = "00000000-0000-4000-8000-00000000f320";
const FAKE_DUP = "00000000-0000-4000-8000-00000000f321";
const OBS_OUTRO = "Alterado por outra pessoa (QA F3.2)";
const SEL_TECIDOS = "id,modelo_id,artigo_id,numero,tipo,consumo,loss_percent,custo_previsto";
// RPCs de LEITURA (STABLE — conferidas no snapshot funcoes.sql de 22/set). Outra RPC = violação. Para liberar
// uma nova, confirme ANTES que é só leitura (volatilidade + corpo sem INSERT/UPDATE/DELETE).
// ⚠️ NUNCA `servicos_financeiro`: é DEFINER VOLATILE que sincroniza `parcelas_servico` na leitura (funcoes.sql:16568;
// HomeLogado.tsx:135 chama no login) — liberar = gravar em PRODUÇÃO (invariante #1). Ela fica em BARRADAS_ESPERADAS.
const READ_RPCS = new Set([
  "custo_unitario_modelos", "modelo_mo_resumo", "estoque_tecido_por_artigo", "otb_orcamento",
  "sidebar_badges", "minhas_permissoes_efetivas", "get_user_tenant_id", "meu_tenant_ativo",
  "modelos_mo_a_aprovar_count",
  "avaliar_condicoes_kanban", "precos_tecido_congelado", "ocs_disponiveis_variante", "modelo_etapas_afetadas",
]);
if (READ_RPCS.has("servicos_financeiro")) {
  throw new Error("servicos_financeiro é PROIBIDO em READ_RPCS (sincroniza parcelas_servico em PRODUÇÃO).");
}
const BARRADAS_ESPERADAS = [/^POST \/rest\/v1\/rpc\/servicos_financeiro$/, /^POST \/realtime\/v1\/api\/broadcast/];

type Gravada = { metodo: string; caminho: string; corpo: any };
type Fake = { casa: (m: string, u: URL) => boolean; responde: (r: Route, req: Request) => Promise<void> };
type Card = { id: string; tecidos: { tipo: string; numero: number; artigo_id: string | null }[]; temCad: boolean; modeloRow: any };
const g = {
  gravadas: [] as Gravada[], violacoes: [] as string[], barradasEsperadas: [] as string[],
  tenants: new Set<string>(), fakes: [] as Fake[],
};
const json = (r: Route, status: number, body: unknown) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const corpoDe = (req: Request) => { try { return req.postDataJSON(); } catch { return req.postData(); } };
const limpar = () => { g.fakes = []; g.gravadas = []; };
const patchesModelos = () => g.gravadas.filter((x) => x.metodo === "PATCH" && x.caminho.startsWith("/rest/v1/modelos?"));
const postsModelos = () => g.gravadas.filter((x) => x.metodo === "POST" && x.caminho.startsWith("/rest/v1/modelos"));
const chamou = (rpc: string) => g.gravadas.some((x) => x.caminho.startsWith(`/rest/v1/rpc/${rpc}`));
const chamadas = (rpc: string) => g.gravadas.filter((x) => x.caminho.startsWith(`/rest/v1/rpc/${rpc}`)).length;
const num = (s: string) => Number(s.replace(/\./g, "").replace(",", ".")) || 0;
const bump = (s: string) => String(Math.round((num(s) + 0.111) * 1000) / 1000).replace(".", ",");
const lojaOk = () => g.tenants.size > 0 && [...g.tenants].every((t) => t === LOJA_TESTE);
/** Linha de `modelos` com rev+delta e campos trocados (serve objeto — maybeSingle — ou array). */
const comRev = (row: any, delta: number, patch: Record<string, unknown> = {}) => {
  const mudar = (x: any) => ({ ...x, rev: Number(x?.rev ?? 0) + delta, ...patch });
  return Array.isArray(row) ? row.map(mudar) : mudar(row);
};

async function guardar(ctx: BrowserContext) {
  if (ALVO === "copia") {
    // Guarda INVERTIDA (N2): no QA contra a cópia NADA vai a produção — qualquer requisição a *.supabase.co (GET
    // inclusive) é violação e é barrada. A variante já nasce toda local (guarda do vite); isto é o 2º cinto.
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

/** GET `modelos?select=*&id=eq.<id>` servido com o corpo dado (o banco não muda). */
function fakeModeloGet(id: string, corpo: unknown): Fake {
  return {
    casa: (m, u) => m === "GET" && u.pathname === "/rest/v1/modelos" && u.searchParams.get("select") === "*" && u.searchParams.get("id") === `eq.${id}`,
    responde: (r) => json(r, 200, corpo),
  };
}
/** GET das linhas de `modelo_tecidos` com o consumo do Tecido 1 trocado ("outra pessoa mudou o BOM"). */
function fakeBomAlterado(id: string, consumoT1: number): Fake {
  return {
    casa: (m, u) => m === "GET" && u.pathname === "/rest/v1/modelo_tecidos" && u.searchParams.get("select") === SEL_TECIDOS && u.searchParams.get("modelo_id") === `eq.${id}`,
    responde: async (r) => {
      const resp = await r.fetch();
      const linhas = (await resp.json()) as any[];
      await r.fulfill({ response: resp, json: linhas.map((t) => (t.tipo === "tecido" && t.numero === 1 ? { ...t, consumo: consumoT1 } : t)) });
    },
  };
}
/** R5a — o MESMO BOM alterado, mas o GET fica SEGURO pela rota até `liberar()` (a janela "toque antes do refetch");
 *  `chegou` resolve no 1º GET segurado. Pedido que o navegador já cancelou (o React Query aborta o refetch velho ao
 *  invalidar) é ignorado. */
function fakeBomAlteradoAtrasado(id: string, consumoT1: number): { fake: Fake; chegou: Promise<void>; liberar: () => void } {
  let liberar!: () => void;
  const portao = new Promise<void>((res) => { liberar = res; });
  let avisar!: () => void;
  const chegou = new Promise<void>((res) => { avisar = res; });
  const fake: Fake = {
    casa: (m, u) => m === "GET" && u.pathname === "/rest/v1/modelo_tecidos" && u.searchParams.get("select") === SEL_TECIDOS && u.searchParams.get("modelo_id") === `eq.${id}`,
    responde: async (r) => {
      avisar();
      await portao;
      try {
        const resp = await r.fetch();
        const linhas = (await resp.json()) as any[];
        await r.fulfill({ response: resp, json: linhas.map((t) => (t.tipo === "tecido" && t.numero === 1 ? { ...t, consumo: consumoT1 } : t)) });
      } catch { /* pedido cancelado pelo navegador — nada a responder */ }
    },
  };
  return { fake, chegou, liberar };
}
/** PATCH em `modelos` responde OK; com `conflito`, o 1º responde 0 linhas (P0409 sintético) e passa a servir o GET do
 *  modelo com rev+1 e `observacoes_gerais` mudado "por outra pessoa" — e, com `bomOutro`, o BOM também mudado. */
function fakePatchModelos(conflito?: { id: string; corpoReal: any; bomOutro?: number }) {
  let n = 0;
  g.fakes.push({
    casa: (m, u) => m === "PATCH" && u.pathname === "/rest/v1/modelos",
    responde: async (r, req) => {
      n += 1;
      const id = (new URL(req.url()).searchParams.get("id") ?? "").replace(/^eq\./, "");
      if (conflito && n === 1) {
        g.fakes.unshift(fakeModeloGet(conflito.id, comRev(conflito.corpoReal, 1, { observacoes_gerais: OBS_OUTRO })));
        if (conflito.bomOutro !== undefined) g.fakes.unshift(fakeBomAlterado(conflito.id, conflito.bomOutro));
        return json(r, 200, []);
      }
      return json(r, 200, [{ id }]);
    },
  });
}
/** R6 — PATCH em `modelos` SEGURO pela rota até `liberar()` (o save fica "em voo"); `chegou` resolve quando ele chega. */
function fakePatchModelosAtrasado(): { chegou: Promise<void>; liberar: () => void } {
  let liberar!: () => void;
  const portao = new Promise<void>((res) => { liberar = res; });
  let avisar!: () => void;
  const chegou = new Promise<void>((res) => { avisar = res; });
  g.fakes.push({
    casa: (m, u) => m === "PATCH" && u.pathname === "/rest/v1/modelos",
    responde: async (r, req) => {
      avisar();
      await portao;
      const id = (new URL(req.url()).searchParams.get("id") ?? "").replace(/^eq\./, "");
      await json(r, 200, [{ id }]);
    },
  });
  return { chegou, liberar };
}
const fakeRpc = (nome: string, body: unknown = null) => g.fakes.push({ casa: (m, u) => m === "POST" && u.pathname === `/rest/v1/rpc/${nome}`, responde: (r) => json(r, 200, body) });
const fakeTabela = (tabela: string) => g.fakes.push({ casa: (m, u) => ["PATCH", "POST", "DELETE"].includes(m) && u.pathname === `/rest/v1/${tabela}`, responde: (r) => r.fulfill({ status: 204, body: "" }) });
const fakeInsertModelos = (id: string) => g.fakes.push({ casa: (m, u) => m === "POST" && u.pathname === "/rest/v1/modelos", responde: (r) => json(r, 201, { id }) });

function resposta(page: Page, pred: (u: URL, r: import("@playwright/test").Response) => boolean) {
  return page.waitForResponse((r) => { const u = new URL(r.url()); return u.host === SUPA_HOST && pred(u, r); }, { timeout: 60_000 });
}
async function abrirCard(page: Page, id: string): Promise<Card> {
  const pT = resposta(page, (u) => u.pathname === "/rest/v1/modelo_tecidos" && u.searchParams.get("select") === SEL_TECIDOS && u.searchParams.get("modelo_id") === `eq.${id}`);
  const pC = resposta(page, (u) => u.pathname === "/rest/v1/cad" && u.searchParams.get("select") === "id" && u.searchParams.get("modelo_id") === `eq.${id}`);
  const pM = resposta(page, (u, r) => u.pathname === "/rest/v1/modelos" && r.request().method() === "GET" && u.searchParams.get("select") === "*" && u.searchParams.get("id") === `eq.${id}`);
  await page.goto(`/criacao/planejamento?modelo=${id}`, { waitUntil: "networkidle" });
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 30_000 });
  const [rT, rC, rM] = await Promise.all([pT, pC, pM]);
  const cad = await rC.json();
  return { id, tecidos: await rT.json(), temCad: !!(Array.isArray(cad) ? cad[0] : cad)?.id, modeloRow: await rM.json() };
}
async function expandir(page: Page, secao: string) {
  const b = page.locator(`[data-secao="${secao}"] > div > button`).first();
  if ((await b.getAttribute("aria-expanded")) === "false") await b.click();
}
const labelTecido1 = (page: Page) => page.locator('[data-secao="tecidos"] label').filter({ hasText: /^Tecido 1$/ });
/** Dispara o refetch das queries "velhas" (o TanStack Query escuta `visibilitychange` na janela) — simula voltar à aba. */
const voltarParaAba = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));

test("F3.2 — BOM no Sheet do Planejamento (só leitura; escritas simuladas)", async ({ browser }) => {
  test.setTimeout(15 * 60_000);
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
  await guardar(ctx);
  const page = await ctx.newPage();
  await doLogin(page);

  // Cards: 1 interno COM BOM e SEM CAD (editável) e 1 interno COM CAD (trava).
  const pLista = resposta(page, (u, r) => u.pathname === "/rest/v1/modelos" && r.request().method() === "GET" && (u.searchParams.get("select") ?? "").startsWith("id,nome,ref,ref_auto,"));
  await page.goto("/criacao/planejamento", { waitUntil: "networkidle" });
  // O robô NÃO troca de loja (trocar grava users.tenant_id em PRODUÇÃO): confere pelo tenant_id das leituras de
  // tenant_config (como a F3.1), não pelo rótulo da tela.
  await expect.poll(() => g.tenants.size, { timeout: 15_000 }).toBeGreaterThan(0);
  expect(lojaOk(), `Loja ativa ≠ Loja Teste (${[...g.tenants].join(",")}). PARE: o robô NÃO troca de loja; peça ao dono.`).toBe(true);
  const lista = (await (await pLista).json()) as { id: string; nome: string | null; origem: string | null }[];
  const ids = lista.filter((m) => (m.origem ?? "interno") === "interno").sort((a, b) => (a.nome ?? "").localeCompare(b.nome ?? "") || a.id.localeCompare(b.id)).map((m) => m.id);
  let semCad: Card | null = null;
  let comCad: Card | null = null;
  for (const id of ids.slice(0, 12)) {
    const c = await abrirCard(page, id);
    if (!c.temCad && !semCad && c.tecidos.some((t) => t.tipo === "tecido" && t.artigo_id)) semCad = c;
    if (c.temCad && !comCad) comCad = c;
    if (semCad && comCad) break;
  }
  if (!semCad) throw new Error(`Loja Teste sem card interno com BOM e sem CAD — nada a testar.`);
  const principais = semCad.tecidos.filter((t) => t.tipo === "tecido" && t.artigo_id).sort((a, b) => a.numero - b.numero).map((t) => t.artigo_id);
  const consumoT1 = (p: Page) => p.locator('[data-secao="tecidos"] input[placeholder="0,000"]').first();
  const avisoBom = page.locator("li").filter({ hasText: "Tecidos & BOM" });

  await test.step("S1 — carga sem Tecido fantasma (R5 do G-mockup) e seletor com preço/estoque (decisão #10)", async () => {
    await abrirCard(page, semCad!.id);
    await expandir(page, "tecidos");
    const numeros = new Set([1, ...semCad!.tecidos.filter((t) => t.tipo === "tecido").map((t) => t.numero)]);
    await expect(page.locator('[data-secao="tecidos"] label').filter({ hasText: /^Tecido \d$/ })).toHaveCount(numeros.size);
    await expect(page.locator('[data-secao="tecidos"]').getByText(/^Preço\/m:/).first()).toBeVisible();
    await expect(page.getByText("Tecido Planejado", { exact: true })).toHaveCount(0);
  });

  await test.step("S2 — Salvar sem mexer no BOM: sem salvar_modelo_bom; lista e etapa fora do UPDATE", async () => {
    limpar(); fakePatchModelos();
    await abrirCard(page, semCad!.id);
    // espera a ficha CARREGAR (senão as colunas derivadas ainda não vão — podeGravarColunasDev=false)
    await expandir(page, "tecidos");
    await expect(labelTecido1(page)).toBeVisible();
    const nome = page.locator('[data-colab-path="nome"]');
    await nome.fill(`${await nome.inputValue()} ·QA2`);
    await page.getByRole("button", { name: "Salvar" }).click();
    await expect.poll(() => patchesModelos().length, { timeout: 20_000 }).toBeGreaterThan(0);
    await page.waitForTimeout(1500);
    const corpo = patchesModelos()[0].corpo;
    expect(corpo).not.toHaveProperty("tecidos_planejados");
    expect(corpo).not.toHaveProperty("status_desenvolvimento");
    expect(corpo).toHaveProperty("custo_tecido_total");
    expect(chamou("salvar_modelo_bom")).toBe(false);
  });

  await test.step("S3 — BOM sujo: UPDATE (com lista derivada) → salvar_modelo_bom(_rev_base null)", async () => {
    limpar(); fakePatchModelos(); fakeRpc("salvar_modelo_bom"); fakeRpc("marcar_revisao_por_mudanca", {}); fakeTabela("modelo_etiquetas");
    await abrirCard(page, semCad!.id);
    await expandir(page, "tecidos");
    await expect(labelTecido1(page)).toBeVisible();
    const consumo = consumoT1(page);
    const novo = bump(await consumo.inputValue());
    await consumo.fill(novo);
    await page.getByRole("button", { name: "Salvar" }).click();
    await expect.poll(() => chamou("salvar_modelo_bom"), { timeout: 20_000 }).toBe(true);
    const iPatch = g.gravadas.findIndex((x) => x.metodo === "PATCH" && x.caminho.startsWith("/rest/v1/modelos?"));
    const iBom = g.gravadas.findIndex((x) => x.caminho.startsWith("/rest/v1/rpc/salvar_modelo_bom"));
    expect(iPatch).toBeGreaterThanOrEqual(0);
    expect(iBom).toBeGreaterThan(iPatch);
    const bom = g.gravadas[iBom].corpo;
    expect(bom._rev_base).toBeNull();
    expect(bom._tecidos.find((t: any) => t.tipo === "tecido" && t.numero === 1).consumo).toBeCloseTo(num(novo), 3);
    expect(g.gravadas[iPatch].corpo.tecidos_planejados.slice(0, principais.length)).toEqual(principais);
  });

  await test.step("S4 — P0409 com BOM intocado: o retry leva o campo do outro usuário (fix 2419d0f) e não manda derivados", async () => {
    limpar();
    const c = await abrirCard(page, semCad!.id);
    fakePatchModelos({ id: c.id, corpoReal: c.modeloRow });
    const nome = page.locator('[data-colab-path="nome"]');
    const meu = `${await nome.inputValue()} ·QA4`;
    await nome.fill(meu);
    await page.getByRole("button", { name: "Salvar" }).click();
    await expect.poll(() => patchesModelos().length, { timeout: 20_000 }).toBeGreaterThanOrEqual(2);
    const [p1, p2] = patchesModelos();
    expect(p1.corpo.nome).toBe(meu);
    expect(p2.corpo.nome).toBe(meu);
    expect(p2.corpo.observacoes_gerais).toBe(OBS_OUTRO); // antes do fix: o valor velho da closure
    expect(p2.corpo).not.toHaveProperty("custo_tecido_total");
    expect(chamou("salvar_modelo_bom")).toBe(false);
  });

  await test.step("S4b — save-em-voo (R6): PATCH ATRASADO + digitação durante o voo ⇒ o selo 'não salvo' segue aceso, o eco não reverte e o 2º Salvar leva a tecla nova", async () => {
    limpar();
    const c = await abrirCard(page, semCad!.id);
    const voo = fakePatchModelosAtrasado();
    const nome = page.locator('[data-colab-path="nome"]');
    const enviado = `${await nome.inputValue()} ·QA4b`;
    await nome.fill(enviado);
    await page.getByRole("button", { name: "Salvar" }).click();
    await voo.chegou; // a rota está SEGURANDO a resposta do PATCH: o save está em voo
    const noVoo = `${enviado}+voo`;
    await nome.fill(noVoo); // tecla digitada DURANTE o voo
    // Eco do MEU save: o servidor passa a ter o ENVIADO, com rev+1 (é o que o refetch do onSuccess traz).
    g.fakes.unshift(fakeModeloGet(c.id, comRev(c.modeloRow, 1, { nome: enviado })));
    const pEco = resposta(page, (u, r) => u.pathname === "/rest/v1/modelos" && r.request().method() === "GET" && u.searchParams.get("select") === "*" && u.searchParams.get("id") === `eq.${c.id}`);
    voo.liberar();
    await expect(page.getByText("Modelo salvo").first()).toBeVisible({ timeout: 20_000 });
    await pEco;
    await page.waitForTimeout(1000);
    expect(patchesModelos()[0].corpo.nome).toBe(enviado);
    await expect(nome).toHaveValue(noVoo); // o eco NÃO reverteu a tecla
    await expect(page.getByTitle("Há alterações não salvas")).toBeVisible(); // antes do fix: o selo apagava
    await page.getByRole("button", { name: "Salvar" }).click();
    await expect.poll(() => patchesModelos().length, { timeout: 20_000 }).toBe(2);
    expect(patchesModelos()[1].corpo.nome).toBe(noVoo);
    await expect(page.getByTitle("Há alterações não salvas")).toHaveCount(0, { timeout: 20_000 });
  });

  await test.step("S5 — P0409 com o BOM tocado E o BOM do servidor mudado por outra pessoa: 'Tecidos & BOM', sem retry; 'usar o novo' traz o dela", async () => {
    limpar();
    const c = await abrirCard(page, semCad!.id);
    const outro = 6.543;
    fakePatchModelos({ id: c.id, corpoReal: c.modeloRow, bomOutro: outro });
    fakeRpc("salvar_modelo_bom");
    await expandir(page, "tecidos");
    await expect(labelTecido1(page)).toBeVisible();
    const consumo = consumoT1(page);
    await consumo.fill(bump(await consumo.inputValue()));
    await page.getByRole("button", { name: "Salvar" }).click();
    await expect(avisoBom).toBeVisible({ timeout: 20_000 });
    expect(patchesModelos()).toHaveLength(1);
    expect(chamou("salvar_modelo_bom")).toBe(false);
    await avisoBom.getByRole("button", { name: "usar o novo" }).click();
    await expect.poll(async () => num(await consumo.inputValue()), { timeout: 20_000 }).toBeCloseTo(outro, 3);
  });

  await test.step("S5b — rev novo com o BOM tocado (R5): eco de ação PRÓPRIA (só `modelos`, BOM igual) NÃO acende 'Tecidos & BOM'; BOM de OUTRA pessoa acende", async () => {
    limpar();
    const c = await abrirCard(page, semCad!.id);
    await expandir(page, "tecidos");
    await expect(labelTecido1(page)).toBeVisible();
    const consumo = consumoT1(page);
    const meu = bump(await consumo.inputValue());
    await consumo.fill(meu);
    // (a) eco de "Mover para…"/Ordem/Lançar/aprovar MO: rev+1 e só `status_desenvolvimento` mudou — BOM do servidor igual.
    g.fakes.unshift(fakeModeloGet(c.id, comRev(c.modeloRow, 1, { status_desenvolvimento: "stand_by" })));
    const pBom1 = resposta(page, (u) => u.pathname === "/rest/v1/modelo_tecidos" && u.searchParams.get("select") === SEL_TECIDOS && u.searchParams.get("modelo_id") === `eq.${c.id}`);
    await voltarParaAba(page);
    await pBom1;
    await page.waitForTimeout(2000);
    await expect(avisoBom).toHaveCount(0);
    await expect(consumo).toHaveValue(meu);
    // (b) OUTRA pessoa mudou o BOM: rev+2 e o consumo do Tecido 1 diferente no servidor.
    const outro = 7.777;
    g.fakes.unshift(fakeBomAlterado(c.id, outro));
    g.fakes.unshift(fakeModeloGet(c.id, comRev(c.modeloRow, 2, { status_desenvolvimento: "stand_by" })));
    await voltarParaAba(page);
    await expect(avisoBom).toBeVisible({ timeout: 20_000 });
    await expect(consumo).toHaveValue(meu); // a carga não sobrescreve o que está tocado
    await avisoBom.getByRole("button", { name: "usar o novo" }).click();
    await expect.poll(async () => num(await consumo.inputValue()), { timeout: 20_000 }).toBeCloseTo(outro, 3);
  });

  await test.step("S5c — P0409 com o BOM tocado mas o BOM do servidor IGUAL (P0409 vindo de ação própria): retry grava o BOM, sem 'Tecidos & BOM' (R5)", async () => {
    limpar();
    const c = await abrirCard(page, semCad!.id);
    fakePatchModelos({ id: c.id, corpoReal: c.modeloRow });
    fakeRpc("salvar_modelo_bom"); fakeRpc("marcar_revisao_por_mudanca", {}); fakeTabela("modelo_etiquetas");
    await expandir(page, "tecidos");
    await expect(labelTecido1(page)).toBeVisible();
    const consumo = consumoT1(page);
    const novo = bump(await consumo.inputValue());
    await consumo.fill(novo);
    await page.getByRole("button", { name: "Salvar" }).click();
    await expect.poll(() => chamou("salvar_modelo_bom"), { timeout: 20_000 }).toBe(true);
    const [p1, p2] = patchesModelos();
    expect(p2, "houve o retry").toBeTruthy();
    expect(p1.corpo).toHaveProperty("custo_tecido_total");
    expect(p2.corpo.observacoes_gerais).toBe(OBS_OUTRO);
    expect(p2.corpo).toHaveProperty("custo_tecido_total"); // o retry GRAVA o BOM ⇒ os derivados do MESMO BOM vão junto
    const iBom = g.gravadas.findIndex((x) => x.caminho.startsWith("/rest/v1/rpc/salvar_modelo_bom"));
    expect(iBom).toBeGreaterThan(g.gravadas.indexOf(p2));
    expect(chamadas("salvar_modelo_bom")).toBe(1);
    expect(g.gravadas[iBom].corpo._tecidos.find((t: any) => t.tipo === "tecido" && t.numero === 1).consumo).toBeCloseTo(num(novo), 3);
    await expect(avisoBom).toHaveCount(0);
  });

  await test.step("S5d — R5a: rev chega com o BOM INTOCADO (só invalida); o usuário toca ANTES de o refetch chegar; o refetch traz o BOM de outra pessoa ⇒ a CARGA compara e acende 'Tecidos & BOM'; o Salvar não passa", async () => {
    limpar();
    const c = await abrirCard(page, semCad!.id);
    await expandir(page, "tecidos");
    await expect(labelTecido1(page)).toBeVisible();
    const consumo = consumoT1(page);
    const meu = bump(await consumo.inputValue());
    const outro = 5.432;
    // O BOM de OUTRA pessoa vem no refetch — SEGURO pela rota até liberar (é a janela do R5a).
    const bomAtrasado = fakeBomAlteradoAtrasado(c.id, outro);
    g.fakes.unshift(bomAtrasado.fake);
    // rev+1 (outra pessoa salvou): o merge vê o rev novo com o BOM ainda INTOCADO ⇒ aoMudarNoServidor só invalida.
    g.fakes.unshift(fakeModeloGet(c.id, comRev(c.modeloRow, 1)));
    const pM = resposta(page, (u, r) => u.pathname === "/rest/v1/modelos" && r.request().method() === "GET" && u.searchParams.get("select") === "*" && u.searchParams.get("id") === `eq.${c.id}`);
    await voltarParaAba(page);
    await pM;
    await bomAtrasado.chegou;          // o refetch do BOM saiu e está SEGURO
    await page.waitForTimeout(500);    // o merge (rev novo, BOM intocado) roda ANTES do toque — senão o teste mediria o R5
    await consumo.fill(meu);           // toque ANTES de o dado novo chegar
    fakePatchModelos(); fakeRpc("salvar_modelo_bom");
    bomAtrasado.liberar();             // chega o BOM alheio com o BOM já tocado ⇒ a carga COMPARA (R5a)
    await expect(avisoBom).toBeVisible({ timeout: 20_000 });
    await expect(consumo).toHaveValue(meu); // a carga não sobrescreve o que está tocado
    await page.getByRole("button", { name: "Salvar" }).click();
    await page.waitForTimeout(1500);
    expect(patchesModelos()).toHaveLength(0); // "Resolva os conflitos…": nada gravado (antes do R5a: PATCH + salvar_modelo_bom)
    expect(chamou("salvar_modelo_bom")).toBe(false);
    await avisoBom.getByRole("button", { name: "usar o novo" }).click();
    await expect.poll(async () => num(await consumo.inputValue()), { timeout: 20_000 }).toBeCloseTo(outro, 3);
  });

  await test.step("S6 — Novo Modelo: 1 POST → Tecido 1..N no BOM (R3) → o Dialog VIRA o Sheet do card criado (F3.1 preservada, R1) → 2º Salvar = PATCH", async () => {
    limpar(); fakeRpc("salvar_modelo_bom"); fakePatchModelos();
    const linhaNova: Record<string, unknown> = {};
    g.fakes.push({
      casa: (m, u) => m === "POST" && u.pathname === "/rest/v1/modelos",
      responde: async (r, req) => {
        Object.assign(linhaNova, corpoDe(req) as object, { id: FAKE_NOVO, rev: 1, tenant_id: LOJA_TESTE, ordem_criacao_enviada: false, lancado: false, enviado_cad: false });
        await json(r, 201, { id: FAKE_NOVO });
      },
    });
    g.fakes.push({
      casa: (m, u) => m === "GET" && u.pathname === "/rest/v1/modelos" && u.searchParams.get("id") === `eq.${FAKE_NOVO}`,
      responde: (r) => {
        const objeto = (r.request().headers()["accept"] ?? "").includes("vnd.pgrst.object");
        return json(r, 200, postsModelos().length > 0 ? (objeto ? linhaNova : [linhaNova]) : (objeto ? null : []));
      },
    });
    await page.goto("/criacao/planejamento", { waitUntil: "networkidle" });
    await page.locator("button:visible", { hasText: "Novo Modelo" }).first().click();
    const dlg = page.getByRole("dialog");
    await expect(dlg).toBeVisible({ timeout: 15_000 });
    // Mockup (gen_novo.py): Tecidos ANTES da Mão de obra.
    const tit = (await dlg.locator("section > button").allTextContents()).map((t) => t.trim());
    expect(tit.indexOf("Tecidos")).toBeGreaterThan(tit.indexOf("Coleção"));
    if (tit.indexOf("Mão de obra") >= 0) expect(tit.indexOf("Tecidos")).toBeLessThan(tit.indexOf("Mão de obra"));
    await dlg.locator('[data-colab-path="nome"]').fill("QA F3.2 — novo (simulado)");
    await dlg.getByRole("combobox").filter({ hasText: "Adicionar tecido…" }).click();
    const opcao = page.getByRole("option").first();
    await expect(opcao).toContainText("Preço/m:");
    await opcao.click();
    await dlg.getByRole("button", { name: "Salvar" }).click();
    await expect.poll(() => chamou("salvar_modelo_bom"), { timeout: 20_000 }).toBe(true);
    const ins = postsModelos()[0].corpo;
    const bom = g.gravadas.find((x) => x.caminho.startsWith("/rest/v1/rpc/salvar_modelo_bom"))!.corpo;
    expect(ins.tecidos_planejados).toHaveLength(1);
    expect(bom._modelo_id).toBe(FAKE_NOVO);
    expect(bom._tecidos).toEqual([expect.objectContaining({ artigo_id: ins.tecidos_planejados[0], numero: 1, tipo: "tecido", consumo: 0 })]);
    expect(bom._aviamentos).toEqual([]);
    expect(bom._grades).toEqual([]);
    // F3.1 preservada (R1): o Dialog vira o Sheet do id criado — seções do BOM e "Excluir" (só na edição) aparecem.
    await expect(page.locator('[data-secao="tecidos"]')).toBeVisible({ timeout: 20_000 });
    await expect(dlg.getByRole("button", { name: "Excluir", exact: true })).toBeVisible();
    // 2º Salvar = UPDATE do MESMO id (nunca um 2º INSERT); o BOM intocado não é regravado.
    await dlg.locator('[data-colab-path="nome"]').fill("QA F3.2 — novo (simulado) 2");
    await dlg.getByRole("button", { name: "Salvar" }).click();
    await expect.poll(() => patchesModelos().filter((x) => x.caminho.includes(`id=eq.${FAKE_NOVO}`)).length, { timeout: 20_000 }).toBe(1);
    expect(postsModelos()).toHaveLength(1);
    expect(chamadas("salvar_modelo_bom")).toBe(1);
  });

  await test.step("S7 — Duplicar: Planejamento + tecidos (só o artigo); Dev vazio (decisão #9, lista única da F3.1)", async () => {
    limpar(); fakeInsertModelos(FAKE_DUP); fakeRpc("salvar_modelo_bom");
    await abrirCard(page, semCad!.id);
    await expandir(page, "tecidos");
    await expect(labelTecido1(page)).toBeVisible();
    await page.getByRole("button", { name: "Duplicar" }).click();
    await expect.poll(() => chamou("salvar_modelo_bom"), { timeout: 20_000 }).toBe(true);
    const ins = postsModelos()[0].corpo;
    for (const k of ["proporcoes", "custos_adicionais", "modelista_id", "data_piloto1", "observacoes_tecnicas", "ficha_medida_url", "status_desenvolvimento"]) expect(ins).not.toHaveProperty(k);
    expect(ins.tecidos_planejados).toEqual(principais);
    const bom = g.gravadas.find((x) => x.caminho.startsWith("/rest/v1/rpc/salvar_modelo_bom"))!.corpo;
    expect(bom._modelo_id).toBe(FAKE_DUP);
    expect(bom._tecidos.map((t: any) => t.artigo_id)).toEqual(principais);
  });

  await test.step("S8 — card com CAD: BOM só-leitura pela trava ÚNICA (R2) — aviso alinhado à F3.1; o 'Editar' não libera o BOM", async () => {
    expect.soft(comCad, "Loja Teste sem card interno com CAD — S8 não exercitado").not.toBeNull();
    if (!comCad) return;
    await abrirCard(page, comCad.id);
    await expandir(page, "tecidos");
    const aviso = page.locator('[data-secao="tecidos"]').getByTestId("aviso-bom-somente-leitura");
    await expect(aviso).toBeVisible({ timeout: 20_000 });
    const consumo = consumoT1(page);
    await expect(consumo).toBeDisabled();
    const linha = Array.isArray(comCad.modeloRow) ? comCad.modeloRow[0] : comCad.modeloRow;
    if (linha?.enviado_cad) {
      await expect(aviso).toContainText("Enviado à Explosão"); // mesma frase de abertura do aviso da F3.1
      const editar = page.getByRole("dialog").getByRole("button", { name: "Editar", exact: true });
      if ((await editar.count()) > 0) {
        await editar.click(); // só estado local (nada é gravado)
        await expect(aviso).toContainText("já tem CAD");
        await expect(consumo).toBeDisabled();
      }
    } else {
      await expect(aviso).toContainText("já tem CAD");
    }
  });

  await test.step("S10 — 'Preço e Custos': os custos do BOM são LINHAS da tabela (mockup, R9c), com custos adicionais", async () => {
    await abrirCard(page, semCad!.id);
    await expandir(page, "tecidos"); // espera a ficha carregar (as linhas só aparecem com ela carregada)
    await expect(labelTecido1(page)).toBeVisible();
    const botao = page.getByRole("dialog").locator("section > button").filter({ hasText: /^\s*Preço e Custos\s*$/ }).first();
    if ((await botao.getAttribute("aria-expanded")) === "false") await botao.click();
    const tabela = page.getByRole("dialog").locator("section").filter({ has: botao }).locator("table").first();
    await expect(tabela.getByText("Custos do BOM")).toBeVisible();
    for (const r of ["Forro", "Entretela", "Aviamento", "Insumos"]) await expect(tabela.getByRole("cell", { name: r, exact: true })).toBeVisible();
    await expect(tabela.getByRole("button", { name: /Adicionar custo/ })).toBeVisible();
  });

  await test.step("S9 — 390px: seções do BOM sem estouro horizontal", async () => {
    const m = await browser.newContext({ baseURL: BASE, viewport: { width: 390, height: 844 } });
    await guardar(m);
    const pm = await m.newPage();
    await doLogin(pm);
    await abrirCard(pm, semCad!.id);
    for (const s of ["tecidos", "aviamentos", "insumos", "grade"]) await expandir(pm, s);
    const medida = await pm.evaluate(() => {
      const d = document.documentElement;
      const dlg = document.querySelector('[role="dialog"]') as HTMLElement | null;
      return { doc: d.scrollWidth - d.clientWidth, dlg: dlg ? dlg.scrollWidth - dlg.clientWidth : 0 };
    });
    expect(medida.doc).toBeLessThanOrEqual(0);
    expect(medida.dlg).toBeLessThanOrEqual(0);
    await m.close();
  });

  expect(g.violacoes, `Escritas NÃO previstas (barradas):\n${g.violacoes.join("\n")}`).toEqual([]);
  expect(lojaOk(), `loja ≠ Loja Teste (${[...g.tenants].join(",")}) — o robô NÃO troca de loja`).toBe(true);
  console.log(`[f32-qa] barradas esperadas (seguiram barradas, não reprovam): ${JSON.stringify(g.barradasEsperadas)}`);
  await ctx.close();
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// FLUXOS QUE GRAVAM NA CÓPIA (N2 do re-check + ruling do controlador) — E1…E6. GRAVAM DE VERDADE, SÓ na cópia local
// (127.0.0.1:54321): F32_ALVO=copia + F32_ESCRITA=1, UM por vez (-g "E3 —"), dono avisado antes de cada um (a cópia é o
// app de teste dele); o controlador mostra cada passo (PNG em .superpowers/f32/qa/escrita/<fluxo>-<n>-<passo>.png).
// Guarda INVERTIDA: escrita liberada SÓ para 127.0.0.1:54321; QUALQUER requisição que não seja local (ou às fontes do
// Google) — *.supabase.co inclusive — reprova. Loja pelo tenant_id. Cards escolhidos/conferidos por SELECT só-leitura na
// cópia (BEGIN READ ONLY). Cada fluxo DESFAZ o que fez (card criado/duplicado é excluído pela tela; consumo/nome
// voltam). Ficam NA CÓPIA, por natureza: snapshots do BOM (`modelo_bom_snapshots`) e o CAD que o Salvar do
// Desenvolvimento cria no E4. Seletores do Desenvolvimento (E4: board, busca, seção de Tecidos) não são da F3.2 e não
// foram conferidos linha a linha: se não casarem, o controlador ajusta SÓ o seletor (nunca a guarda) e registra.
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
const TAG = `QA-F32 ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
const OUT_E = path.resolve(".superpowers/f32/qa/escrita");
const LOCAL_PG = "postgresql://postgres:postgres@127.0.0.1:54422/postgres";
const HOSTS_LOCAIS = new Set(["localhost", "127.0.0.1", "fonts.googleapis.com", "fonts.gstatic.com"]);
type EstadoEscrita = { gravadas: Gravada[]; violacoes: string[]; errosPagina: string[]; tenants: Set<string> };
const estadoEscrita = (): EstadoEscrita => ({ gravadas: [], violacoes: [], errosPagina: [], tenants: new Set() });
const consumoT1De = (p: Page) => p.locator('[data-secao="tecidos"] input[placeholder="0,000"]').first();
const bomGravado = (st: EstadoEscrita) => st.gravadas.filter((x) => x.caminho.startsWith("/rest/v1/rpc/salvar_modelo_bom")).length;

function exigeEscrita() {
  test.skip(!ESCRITA, "fluxos que gravam: só com F32_ESCRITA=1, um por vez, dono avisado");
  if (ALVO !== "copia") throw new Error("fluxos que GRAVAM: só com F32_ALVO=copia (nunca em produção)");
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

/** 1º card interno da Loja Teste (cópia) com BOM (tecido com artigo) e SEM CAD — editável no Planejamento. */
async function cardSemCad(): Promise<{ id: string; nome: string }> {
  const [c] = await sqlCopia<{ id: string; nome: string }>(
    `select m.id, m.nome from modelos m
      where m.tenant_id = $1 and coalesce(m.origem, 'interno') = 'interno'
        and exists (select 1 from modelo_tecidos t where t.modelo_id = m.id and t.tipo = 'tecido' and t.artigo_id is not null)
        and not exists (select 1 from cad where cad.modelo_id = m.id)
      order by m.nome, m.id limit 1`, [LOJA_TESTE]);
  if (!c) throw new Error("Loja Teste (cópia) sem card interno com BOM e sem CAD — nada a exercitar");
  return c;
}
const consumoT1NoBanco = async (id: string) =>
  Number((await sqlCopia<{ c: string }>(`select consumo::text c from modelo_tecidos where modelo_id = $1 and tipo = 'tecido' and numero = 1`, [id]))[0]?.c);

/** Contexto que GRAVA na cópia: o que não é local reprova; o Supabase LOCAL passa e as escritas ficam registradas.
 *  `semRealtime`: o websocket do Realtime é cortado (a aba fica com o rev VELHO — P0409 real no E3). */
async function paginaEscrita(browser: Browser, st: EstadoEscrita, o: { semRealtime?: boolean } = {}): Promise<{ ctx: BrowserContext; page: Page }> {
  if (ALVO !== "copia" || !ESCRITA) throw new Error("fluxo que GRAVA só com F32_ALVO=copia e F32_ESCRITA=1");
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
  if (o.semRealtime) await ctx.routeWebSocket(/\/realtime\/v1\/websocket/, (ws) => { ws.close(); });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => st.errosPagina.push(String(e?.message ?? e)));
  await doLogin(page);
  return { ctx, page };
}

async function passo(page: Page, fluxo: string, n: number, nome: string) {
  fs.mkdirSync(OUT_E, { recursive: true });
  const arq = path.join(OUT_E, `${fluxo}-${n}-${nome}.png`);
  await page.screenshot({ path: arq, fullPage: true });
  console.log(`[f32-escrita] ${fluxo} passo ${n} (${nome}) → ${arq}`);
}

function conferirEscrita(st: EstadoEscrita, nome: string) {
  fs.mkdirSync(OUT_E, { recursive: true });
  fs.writeFileSync(path.join(OUT_E, `${nome}.json`), JSON.stringify({ gravadas: st.gravadas, violacoes: st.violacoes, errosPagina: st.errosPagina, tenants: [...st.tenants] }, null, 2));
  expect(st.violacoes, "requisição fora da cópia").toEqual([]);
  expect(st.errosPagina, "erro de JS na página").toEqual([]);
  expect(st.tenants.size > 0 && [...st.tenants].every((t) => t === LOJA_TESTE), `loja ≠ Loja Teste (${[...st.tenants].join(",")})`).toBe(true);
}

async function salvarReal(page: Page) {
  await page.getByRole("dialog").getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText("Modelo salvo").first()).toBeVisible({ timeout: 30_000 });
}

/** Exclui um card PELA TELA (Sheet do Planejamento → Excluir → confirmar) e confere na cópia que ele sumiu. */
async function excluirPelaTela(page: Page, id: string) {
  await abrirCard(page, id);
  await page.getByRole("dialog").getByRole("button", { name: "Excluir", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: /Excluir/ }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 20_000 });
  await expect.poll(async () => (await sqlCopia(`select 1 from modelos where id = $1`, [id])).length, { timeout: 20_000 }).toBe(0);
}

test("E1 — BOM gravado DE VERDADE: salvar_modelo_bom grava o consumo, guarda o snapshot e não cria CAD; reabrir mostra", async ({ browser }) => {
  exigeEscrita();
  test.setTimeout(6 * 60_000);
  const card = await cardSemCad();
  const st = estadoEscrita();
  const { ctx, page } = await paginaEscrita(browser, st);
  const [t0] = await sqlCopia<{ agora: string }>(`select now()::text agora`);
  await abrirCard(page, card.id);
  await expandir(page, "tecidos");
  await expect(labelTecido1(page)).toBeVisible();
  const original = await consumoT1De(page).inputValue();
  const novo = bump(original);
  await consumoT1De(page).fill(novo);
  await passo(page, "E1", 1, "consumo-editado");
  await salvarReal(page);
  await expect.poll(() => consumoT1NoBanco(card.id), { timeout: 20_000 }).toBeCloseTo(num(novo), 3);
  const [snap] = await sqlCopia<{ n: string }>(`select count(*)::text n from modelo_bom_snapshots where modelo_id = $1 and created_at > $2::timestamptz`, [card.id, t0.agora]);
  expect(Number(snap.n)).toBeGreaterThanOrEqual(1); // salvar_modelo_bom guardou o snapshot antes de apagar (funcoes.sql:7603)
  expect(bomGravado(st)).toBe(1);
  const [cad] = await sqlCopia<{ n: string }>(`select count(*)::text n from cad where modelo_id = $1`, [card.id]);
  expect(cad.n).toBe("0"); // o Planejamento NÃO cria CAD (F3.3)
  await abrirCard(page, card.id);
  await expandir(page, "tecidos");
  await expect.poll(async () => num(await consumoT1De(page).inputValue()), { timeout: 20_000 }).toBeCloseTo(num(novo), 3);
  await passo(page, "E1", 2, "reaberto");
  await consumoT1De(page).fill(original); // desfaz
  await salvarReal(page);
  await expect.poll(() => consumoT1NoBanco(card.id), { timeout: 20_000 }).toBeCloseTo(num(original), 3);
  await passo(page, "E1", 3, "desfeito");
  conferirEscrita(st, "E1");
  await ctx.close();
});

test("E2 — Realtime REAL entre 2 abas do Planejamento: A grava o BOM; em B (BOM tocado, não salvo) acende 'Tecidos & BOM'; 'usar o novo' traz o de A", async ({ browser }) => {
  exigeEscrita();
  test.setTimeout(8 * 60_000);
  const card = await cardSemCad();
  const stA = estadoEscrita();
  const stB = estadoEscrita();
  const a = await paginaEscrita(browser, stA);
  const b = await paginaEscrita(browser, stB);
  await abrirCard(b.page, card.id);
  await expandir(b.page, "tecidos");
  await expect(labelTecido1(b.page)).toBeVisible();
  const original = await consumoT1De(b.page).inputValue();
  await consumoT1De(b.page).fill(bump(bump(original))); // B toca o BOM e NÃO salva
  await abrirCard(a.page, card.id);
  await expandir(a.page, "tecidos");
  await expect(labelTecido1(a.page)).toBeVisible();
  const deA = bump(original);
  await consumoT1De(a.page).fill(deA);
  await salvarReal(a.page);
  await passo(a.page, "E2", 1, "A-salvou");
  const avisoB = b.page.locator("li").filter({ hasText: "Tecidos & BOM" });
  await expect(avisoB).toBeVisible({ timeout: 30_000 });
  await passo(b.page, "E2", 2, "B-tecidos-e-bom");
  await b.page.getByRole("dialog").getByRole("button", { name: "Salvar" }).click(); // com o aviso aberto, o Salvar NÃO passa
  await b.page.waitForTimeout(1500);
  expect(stB.gravadas.filter((x) => x.metodo === "PATCH" && x.caminho.includes(`id=eq.${card.id}`))).toHaveLength(0);
  expect(bomGravado(stB)).toBe(0);
  await avisoB.getByRole("button", { name: "usar o novo" }).click();
  await expect.poll(async () => num(await consumoT1De(b.page).inputValue()), { timeout: 20_000 }).toBeCloseTo(num(deA), 3);
  await passo(b.page, "E2", 3, "B-usou-o-novo");
  await abrirCard(a.page, card.id); // desfaz (pela A)
  await expandir(a.page, "tecidos");
  await consumoT1De(a.page).fill(original);
  await salvarReal(a.page);
  await expect.poll(() => consumoT1NoBanco(card.id), { timeout: 20_000 }).toBeCloseTo(num(original), 3);
  conferirEscrita(stA, "E2-A");
  conferirEscrita(stB, "E2-B");
  await a.ctx.close();
  await b.ctx.close();
});

test("E3 — P0409 REAL: B (sem Realtime, rev velho) salva o BOM depois de A salvar o nome ⇒ o servidor recusa; BOM do servidor IGUAL ⇒ o retry leva o nome de A e grava o BOM de B", async ({ browser }) => {
  exigeEscrita();
  test.setTimeout(8 * 60_000);
  const card = await cardSemCad();
  const [antes] = await sqlCopia<{ nome: string }>(`select nome from modelos where id = $1`, [card.id]);
  const consumoAntes = await consumoT1NoBanco(card.id);
  const stA = estadoEscrita();
  const stB = estadoEscrita();
  const a = await paginaEscrita(browser, stA);
  const b = await paginaEscrita(browser, stB, { semRealtime: true }); // B não recebe o UPDATE de A ⇒ fica com o rev velho
  await abrirCard(b.page, card.id);
  await expandir(b.page, "tecidos");
  await expect(labelTecido1(b.page)).toBeVisible();
  await abrirCard(a.page, card.id);
  const nomeA = `${antes.nome} ·E3`;
  await a.page.locator('[data-colab-path="nome"]').fill(nomeA);
  await salvarReal(a.page);
  await passo(a.page, "E3", 1, "A-salvou-o-nome");
  const deB = bump(await consumoT1De(b.page).inputValue());
  await consumoT1De(b.page).fill(deB);
  await salvarReal(b.page); // 1º PATCH volta 0 linhas (P0409 REAL) → merge → retry
  expect(stB.gravadas.filter((x) => x.metodo === "PATCH" && x.caminho.includes(`id=eq.${card.id}`))).toHaveLength(2);
  expect(bomGravado(stB)).toBe(1);
  const [depois] = await sqlCopia<{ nome: string }>(`select nome from modelos where id = $1`, [card.id]);
  expect(depois.nome).toBe(nomeA); // o retry NÃO desfez o campo de A (fix 2419d0f)
  expect(await consumoT1NoBanco(card.id)).toBeCloseTo(num(deB), 3); // e gravou o BOM de B (R5: BOM do servidor igual)
  await passo(b.page, "E3", 2, "B-retry-gravou");
  await abrirCard(a.page, card.id); // desfaz (pela A, que tem o Realtime)
  await a.page.locator('[data-colab-path="nome"]').fill(antes.nome);
  await expandir(a.page, "tecidos");
  await consumoT1De(a.page).fill(String(consumoAntes).replace(".", ","));
  await salvarReal(a.page);
  await expect.poll(() => consumoT1NoBanco(card.id), { timeout: 20_000 }).toBeCloseTo(consumoAntes, 3);
  conferirEscrita(stA, "E3-A");
  conferirEscrita(stB, "E3-B");
  await a.ctx.close();
  await b.ctx.close();
});

test("E4 — Card novo REAL: 1 INSERT → Tecido 1 no BOM (salvar_modelo_bom) → o Dialog vira o Sheet → 2º Salvar = PATCH", async ({ browser }) => {
  exigeEscrita();
  test.setTimeout(6 * 60_000);
  const st = estadoEscrita();
  const { ctx, page } = await paginaEscrita(browser, st);
  const nome = `${TAG} — novo (E4)`;
  await page.goto("/criacao/planejamento", { waitUntil: "networkidle" });
  await page.locator("button:visible", { hasText: "Novo Modelo" }).first().click();
  const dlg = page.getByRole("dialog");
  await expect(dlg).toBeVisible({ timeout: 15_000 });
  await dlg.locator('[data-colab-path="nome"]').fill(nome);
  await dlg.getByRole("combobox").filter({ hasText: "Adicionar tecido…" }).click();
  const opcao = page.getByRole("option").first();
  await expect(opcao).toContainText("Preço/m:");
  await opcao.click();
  await passo(page, "E4", 1, "dialog-com-tecido");
  await salvarReal(page);
  await expect(page.locator('[data-secao="tecidos"]')).toBeVisible({ timeout: 20_000 }); // virou o Sheet (F3.1 preservada)
  const criados = await sqlCopia<{ id: string; tp: string[] }>(`select id, tecidos_planejados tp from modelos where tenant_id = $1 and nome = $2`, [LOJA_TESTE, nome]);
  expect(criados).toHaveLength(1);
  const id = criados[0].id;
  const tec = await sqlCopia<{ numero: number; tipo: string; artigo_id: string }>(`select numero, tipo, artigo_id from modelo_tecidos where modelo_id = $1 order by numero`, [id]);
  expect(tec).toEqual([{ numero: 1, tipo: "tecido", artigo_id: criados[0].tp[0] }]);
  await passo(page, "E4", 2, "virou-sheet-com-bom");
  await dlg.locator('[data-colab-path="nome"]').fill(`${nome} 2`);
  await salvarReal(page);
  expect(st.gravadas.filter((x) => x.metodo === "POST" && x.caminho.startsWith("/rest/v1/modelos"))).toHaveLength(1);
  expect(st.gravadas.filter((x) => x.metodo === "PATCH" && x.caminho.includes(`id=eq.${id}`)).length).toBeGreaterThanOrEqual(1);
  expect(bomGravado(st)).toBe(1); // o 2º Salvar não regrava o BOM intocado
  await excluirPelaTela(page, id); // desfaz
  await passo(page, "E4", 3, "excluido");
  conferirEscrita(st, "E4");
  await ctx.close();
});

test("E5 — Duplicar REAL: a cópia leva o Planejamento + os tecidos (só o artigo) no BOM; o Dev nasce vazio (decisão #9)", async ({ browser }) => {
  exigeEscrita();
  test.setTimeout(6 * 60_000);
  const card = await cardSemCad();
  const st = estadoEscrita();
  const { ctx, page } = await paginaEscrita(browser, st);
  const [t0] = await sqlCopia<{ agora: string }>(`select now()::text agora`);
  const principais = (await sqlCopia<{ a: string }>(
    `select artigo_id a from modelo_tecidos where modelo_id = $1 and tipo = 'tecido' and artigo_id is not null order by numero`, [card.id])).map((r) => r.a);
  await abrirCard(page, card.id);
  await expandir(page, "tecidos");
  await expect(labelTecido1(page)).toBeVisible();
  await page.getByRole("button", { name: "Duplicar" }).click();
  await expect.poll(() => bomGravado(st), { timeout: 20_000 }).toBe(1);
  const [dup] = await sqlCopia<{ id: string; modelista_id: string | null; d1: string | null }>(
    `select id, modelista_id, data_piloto1::text d1 from modelos
      where tenant_id = $1 and id <> $2 and created_at > $3::timestamptz and nome = (select nome from modelos where id = $2)
      order by created_at desc limit 1`, [LOJA_TESTE, card.id, t0.agora]);
  expect(dup, "a cópia não apareceu na cópia do banco").toBeTruthy();
  const tecDup = (await sqlCopia<{ a: string }>(`select artigo_id a from modelo_tecidos where modelo_id = $1 and tipo = 'tecido' order by numero`, [dup.id])).map((r) => r.a);
  expect(tecDup).toEqual(principais.slice(0, 3));
  expect(dup.modelista_id).toBeNull();
  expect(dup.d1).toBeNull();
  await passo(page, "E5", 1, "duplicado");
  await excluirPelaTela(page, dup.id); // desfaz
  await passo(page, "E5", 2, "excluido");
  conferirEscrita(st, "E5");
  await ctx.close();
});

test("E6 — Dev ↔ Planejamento: o Desenvolvimento (outra aba) grava o BOM; o Planejamento com o BOM tocado acende 'Tecidos & BOM'", async ({ browser }) => {
  exigeEscrita();
  test.setTimeout(8 * 60_000);
  const card = await cardSemCad();
  const stA = estadoEscrita();
  const stB = estadoEscrita();
  const a = await paginaEscrita(browser, stA); // A = Desenvolvimento (intocado)
  const b = await paginaEscrita(browser, stB); // B = Planejamento
  await abrirCard(b.page, card.id);
  await expandir(b.page, "tecidos");
  await expect(labelTecido1(b.page)).toBeVisible();
  const original = await consumoT1De(b.page).inputValue();
  await consumoT1De(b.page).fill(bump(bump(original))); // B toca e NÃO salva
  // A: board do Desenvolvimento → busca → card → seção de Tecidos → consumo do Tecido 1 → Salvar.
  // ⚠️ O Salvar do Dev CRIA o CAD do card quando há tecido com variante (ModeloDetailPanel.tsx:2062-2067): depois
  // disso o BOM dele fica só-leitura no Planejamento até a F3.3 (esperado) — e o CAD fica NA CÓPIA. Por isso é o último.
  await a.page.goto("/criacao/desenvolvimento", { waitUntil: "networkidle" });
  const busca = a.page.getByPlaceholder(/buscar|pesquisar/i).first();
  if ((await busca.count()) > 0) await busca.fill(card.nome);
  await a.page.getByText(card.nome, { exact: true }).first().click();
  const dlgA = a.page.getByRole("dialog").first();
  await expect(dlgA).toBeVisible({ timeout: 30_000 });
  const secTecidos = dlgA.getByRole("button", { name: /Tecidos/ }).first();
  if ((await secTecidos.getAttribute("aria-expanded")) === "false") await secTecidos.click();
  const cA = dlgA.locator('input[placeholder="0,000"]').first();
  const deA = bump(original);
  await cA.fill(deA);
  await dlgA.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect.poll(() => bomGravado(stA), { timeout: 20_000 }).toBeGreaterThanOrEqual(1);
  await passo(a.page, "E6", 1, "dev-salvou");
  const avisoB = b.page.locator("li").filter({ hasText: "Tecidos & BOM" });
  await expect(avisoB).toBeVisible({ timeout: 30_000 });
  await passo(b.page, "E6", 2, "planejamento-tecidos-e-bom");
  await avisoB.getByRole("button", { name: "usar o novo" }).click();
  await expect.poll(async () => num(await consumoT1De(b.page).inputValue()), { timeout: 20_000 }).toBeCloseTo(num(deA), 3);
  const [cad] = await sqlCopia<{ n: string }>(`select count(*)::text n from cad where modelo_id = $1`, [card.id]);
  if (cad.n !== "0") {
    // Trava interina "tem CAD" (R1/D2): o BOM passa a só-leitura no Planejamento.
    await expect(b.page.locator('[data-secao="tecidos"]').getByTestId("aviso-bom-somente-leitura")).toBeVisible({ timeout: 20_000 });
  }
  await passo(b.page, "E6", 3, "planejamento-usou-o-novo");
  await cA.fill(original); // desfaz o consumo pelo Dev (o CAD criado fica na cópia)
  await dlgA.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect.poll(() => consumoT1NoBanco(card.id), { timeout: 20_000 }).toBeCloseTo(num(original), 3);
  conferirEscrita(stA, "E6-dev");
  conferirEscrita(stB, "E6-planejamento");
  await a.ctx.close();
  await b.ctx.close();
});
```

- [ ] **Step 3: Rodar o QA automático na cópia**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f32-ficha-bom"
mkdir -p .superpowers/f32/qa
E2E_BASE_URL=http://localhost:5186 VITE_SUPABASE_URL=http://127.0.0.1:54321 F32_ALVO=copia \
  npx playwright test tests/e2e/f32-qa.spec.ts --workers=1 --retries=0 2>&1 | tee .superpowers/f32/qa.txt | tail -15
```

Expected: `1 passed` e `6 skipped` (E1–E6 pulam sem `F32_ESCRITA=1`); nenhuma violação (inclusive nenhuma `PRODUÇÃO …` da guarda invertida) nem "APP"; a linha `[f32-qa] barradas esperadas …` só com `servicos_financeiro`/broadcast. "0 passed"/erro de `E2E_BASE_URL`/`VITE_SUPABASE_URL`/`F32_ALVO` = NÃO TESTADO. Se falhar por RPC de leitura nova (da F3.1/F2): confirmar que é `STABLE`/só-leitura na migration mais recente e acrescentar em `READ_RPCS` — **NUNCA `servicos_financeiro`** (o spec recusa); se for escrita, acrescentar um fake e anotar no relatório. Violação/erro de loja = falha dura (nunca relaxar a guarda). Se o S8 ficar "soft" (sem card com CAD na Loja Teste), registrar. O S5d (R5a) tem de passar: sem o R5a da Task 6/7, o Salvar do S5d gravaria (PATCH + `salvar_modelo_bom`).

- [ ] **Step 4: Fluxos que GRAVAM na cópia (E1–E6), um por vez**

Para CADA fluxo: (1) avisar o dono por chat do que ele grava na cópia (o app de teste dele — cabeçalho da seção no spec); (2) rodar SÓ ele; (3) mostrar os PNGs, na ordem, e o JSON das escritas; (4) registrar no relatório ao guardião. O E6 por ÚLTIMO (o Salvar do Desenvolvimento pode criar o CAD do card, que deixa de servir aos outros).

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f32-ficha-bom"
FLUXO="E1"   # um por vez: E1 · E2 · E3 · E4 · E5 · E6 (por último)
E2E_BASE_URL=http://localhost:5186 VITE_SUPABASE_URL=http://127.0.0.1:54321 F32_ALVO=copia F32_ESCRITA=1 \
  npx playwright test tests/e2e/f32-qa.spec.ts -g "$FLUXO —" --workers=1 --retries=0 2>&1 | tee -a .superpowers/f32/qa-escrita.txt | tail -8
ls .superpowers/f32/qa/escrita/ | grep "^$FLUXO"
```

Expected: `1 passed` por fluxo + os PNGs/JSON. Falha: diagnosticar (trace em `test-results/`); se o fluxo deixou algo pela metade (card criado/duplicado não excluído, consumo/nome não devolvido), o controlador desfaz PELA TELA da variante, com o dono avisado — nunca por SQL de escrita. Este passo substitui o antigo "cenário manual opcional em produção": nada da F3.2 grava em produção antes do merge.

- [ ] **Step 5: Derrubar SÓ a variante `:5186` e tirar a coluna da cópia (se a F3.1 ainda não juntou)**

```bash
"/Users/sunglee/PLM + Criação/banco-local/app-teste-variantes/f32/descer.sh"
lsof -nP -iTCP:5186 -sTCP:LISTEN; lsof -nP -iTCP:5188 -sTCP:LISTEN -t | sed 's/^/:5188 do dono intacto, PID /'
git -C "/Users/sunglee/PLM + Criação/plm-pcp" cat-file -e feature/plan-tecido-a1:supabase/migrations/20260930180000_modelo_descricao_produto.sql 2>/dev/null && echo "F3.1 JÁ juntada — a coluna FICA na cópia" || echo "F3.1 ainda NÃO juntada — tirar a coluna (abaixo)"
```

Se "ainda NÃO juntada" (a coluna na cópia desalinharia um re-ensaio da F1 — a referência de fidelidade é da cópia sem ela):

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f31-planejamento-campos" && bash .superpowers/f31/mig/copia-qa.sh volta 2>&1 | tail -8
```

Expected: `Variante f32 (:5186) derrubada (PID …)`; nada em `:5186`; o `:5188` com o mesmo PID; e, no 2º caso, `== COLUNA FORA DA CÓPIA` (estado `…|…|0`).

---

## Task 16: Revisões, portões do guardião e merge  *(controlador)*

- [ ] **Step 1: Revisões Opus pendentes** — conforme §4 (Lote A, Lote B, individuais 4+10, 6, 7, 11, 12, 13). Cada achado corrigido volta aos 5 gates.

- [ ] **Step 2: Conferências finais**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f32-ficha-bom"
git diff --name-only savepoint-pre-unificacao-2026-09-22 -- src/components/desenvolvimento/ src/components/producao/cad/CadTecidosSection.tsx   # vazio
git diff --name-only "$(cat .superpowers/f32/BASE)" -- src/lib/kanban-condicoes.ts src/lib/artigo-label.ts supabase tests/integration   # vazio
grep -rn 'rpc("salvar_modelo_bom"' src | grep -v "src/components/desenvolvimento/"   # só ficha/persistir-bom.ts (2 chamadas): toda escrita de BOM do Planejamento passa por lá
grep -rn "gravarTecidosIniciais(" src | grep -v "ficha/persistir-bom.ts"   # 2: card novo (DENTRO do else do INSERT) e Duplicar (id do insert)
grep -rn '"plan-ficha-' src | cut -d: -f1 | sort -u   # só arquivos de planejamento-detail/ficha/
grep -rn "CAMPOS_DEV_NAO_HERDADOS_NO_DUPLICAR\|limparPayloadDuplicar" src tests   # vazio (lista ÚNICA = CAMPOS_DEV_DRAFT da F3.1)
grep -n '"proporcoes", "custos_adicionais",' src/components/planejamento/planejamento-detail/helpers.ts   # 1 (dentro de CAMPOS_DEV_DRAFT)
grep -n "travaDev: motivoTravaDev," src/components/planejamento/PlanejamentoDetail.tsx   # 1 (trava única, R2)
grep -c "aoRecarregarComTocado" src/components/planejamento/planejamento-detail/ficha/useFichaBom.ts src/components/planejamento/planejamento-detail/ficha/useFichaTecnica.ts   # ≥ 2 e ≥ 2 (R5a: a carga compara com o BOM tocado)
grep -c "geracaoRef.current += 1;" src/components/planejamento/planejamento-detail/ficha/useFichaTecnica.ts   # 2 (reset por card + aposSalvar — NOTA do re-check)
```

E o 5º gate (`bash .superpowers/f32/gate-f31.sh` → "F3.1 preservada: ok", código 0 — `onCreated`, `onSaved: aoSalvar`, `criadoIdRef`, `aplicarRegrasCamposDev`, invalidações da F3.1).

- [ ] **Step 3: G-commit + G-fase F3.2 (guardião)** — anexar: saída dos 5 gates, `qa.txt` com "1 passed" (e a linha das barradas esperadas), `qa-escrita.txt` + os JSON/PNGs de `.superpowers/f32/qa/escrita/` (E1–E6), os greps do Step 2, o `INDICE.tsv` do snapshot (Task 14), a lista de decisões do dono respondidas (§7, com os INFORMADOS D4/D5) e as decisões técnicas da §6 (inclusive as do G-plano conjunto e do re-check: trava única, conflito de BOM só com o servidor mudado, R5a na carga, `geracaoRef` no `aposSalvar`, custos do BOM como linhas da tabela, Tecido 1..N dentro do INSERT real, QA na cópia, F3.2 nascida do G-commit da F3.1).

- [ ] **Step 4: Pré-merge — a F3.1 JÁ juntada, snapshot (Task 14) feito HOJE e aviso ao dono**

A F3.2 SEMPRE junta depois da F3.1 (ela carrega os commits da F3.1, que gravam `descricao_produto`; o merge da F3.1 espera a Task 9 dela, que espera a F1 em produção — N1/N4):

```bash
MAIN="/Users/sunglee/PLM + Criação/plm-pcp"
git -C "$MAIN" cat-file -e feature/plan-tecido-a1:supabase/migrations/20260930180000_modelo_descricao_produto.sql && echo "F3.1 juntada: ok" || echo "F3.1 NÃO juntada — PARE (a F3.2 espera)"
```

Com `F3.1 juntada: ok`: pedir ao dono, por chat, para salvar e fechar os cards abertos do Planejamento/Desenvolvimento no `:5173` E no app de teste `:5188` (os dois servem o checkout principal; o Fast Refresh remonta o Sheet); pausar executores de outras fases durante o merge.

- [ ] **Step 5: Rebase `--onto` sobre a branch principal e fast-forward (N4)**

A F3.2 nasceu da ponta de `f31/planejamento-campos` (`.superpowers/f32/BASE`). Reaplicar SÓ os commits da F3.2 sobre a `feature/plan-tecido-a1` atual — correto se a F3.1 juntou por ff puro (mesmos shas), se foi rebaseada antes do merge (shas novos) ou se ganhou commits depois do BASE (fix do smoke, F3.1b):

```bash
MAIN="/Users/sunglee/PLM + Criação/plm-pcp"; WT="$MAIN/.claude/worktrees/f32-ficha-bom"
BASE32="$(cat "$WT/.superpowers/f32/BASE")"
git -C "$WT" log --oneline "$BASE32..HEAD" | tee "$WT/.superpowers/f32/commits-f32.txt" | wc -l   # os commits F3.2 (1)…(13)
git -C "$WT" rebase --onto feature/plan-tecido-a1 "$BASE32" f32/ficha-bom
git -C "$WT" log --oneline -3 && git -C "$WT" merge-base --is-ancestor feature/plan-tecido-a1 HEAD && echo "F3.2 sobre a branch principal: ok"
```

Conflito no rebase (a F3.1b ou um fix da F3.1 mexeram no mesmo trecho): resolver preservando o texto FINAL da F3.1 (é contrato) e registrar. Depois do rebase — mesmo sem conflito —, refazer: a Task 0 Step 3 (âncoras: TODAS = 1), os 5 gates (inclusive `bash .superpowers/f32/gate-f31.sh`, código 0), a Task 15 Step 3 (QA automático na cópia; com a F3.1 já juntada a coluna está lá) e o E1 da Task 15 Step 4. Então:

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp"
git status --porcelain | grep -v '^??' && echo "HÁ ALTERAÇÃO NÃO COMMITADA NO CHECKOUT PRINCIPAL — PARE" || true
git merge --ff-only f32/ficha-bom
```

Se não for ff (a branch principal andou de novo): repetir este Step (o `--onto` usa o MESMO `BASE`; depois do 1º rebase, use o sha da `feature/plan-tecido-a1` sobre o qual a F3.2 ficou — `git -C "$WT" merge-base HEAD feature/plan-tecido-a1` — como novo `BASE32`).

- [ ] **Step 6: Smoke pós-merge (SÓ LEITURA, produção, guarda de sempre)** — rodar o mesmo spec contra o vite do dono SEM derrubá-lo, a partir da worktree (o spec não é versionado; `VITE_SUPABASE_URL` vem do `.env` da worktree = produção; o spec recusa se não for `*.supabase.co`):

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f32-ficha-bom"
env -u VITE_SUPABASE_URL E2E_BASE_URL=http://localhost:5173 F32_ALVO=producao \
  npx playwright test tests/e2e/f32-qa.spec.ts --workers=1 --retries=0 2>&1 | tail -8
```

Esperado "1 passed" e "6 skipped" (os fluxos que gravam NUNCA rodam em produção — o spec lança erro se tentarem).

- [ ] **Step 7: Limpeza** — `rm tests/e2e/f32-qa.spec.ts` na worktree (arquivo próprio, não versionado); a worktree fica até a F3.3 começar (ela parte do mesmo HEAD); a variante `banco-local/app-teste-variantes/f32/` pode ficar (fora do repo; não sobe sozinha). A coluna `descricao_produto` fica na cópia (a F3.1 já está no principal — o `:5188` a usa). Memória/docs: F4.

---

## 5. Riscos (com evidência) e o que o plano faz

| # | Risco | Evidência | O que o plano faz |
|---|---|---|---|
| R1 | Editar consumo do BOM no Planejamento sem regravar o CAD é DESFEITO pelo próximo Salvar do Dev e desalinha a Explosão | `funcoes.sql:6878-6881` (`salvar_cad_completo` copia `consumo_cad` → `modelo_tecidos`); Dev regrava o CAD a cada Salvar (`ModeloDetailPanel.tsx:2062-2119`) | Trava INTERINA: card com CAD = BOM só-leitura no Planejamento + "Abrir no Desenvolvimento" (`motivoSomenteLeitura="cad"`), somada à trava ÚNICA da F3.1 ("enviado"/"sem permissão" — R2). Números reais (R3 do G-plano conjunto): 193 dos 214 internos têm CAD, 136 deles ainda NÃO enviados (o CAD nasceu no Salvar do Dev, `ModeloDetailPanel.tsx:2062-2067`; o Dev deixa editá-los); editam aqui só os cards novos e 21 internos antigos sem CAD — e um card novo trava aqui assim que alguém salvar o BOM dele no Dev. A F3.3 tira a trava "cad" ao gravar o CAD no Salvar. Decisão D2 |
| R2 | Reserva de estoque passa a contar consumo lançado no Planejamento ANTES da Ordem de Criação | `funcoes.sql:2655-2675` (`reserva_mod` sem filtro de `ordem_criacao_enviada`) | Hoje: 1 card (teste, Loja Teste "Vestal"). Aviso na seção Tecidos quando a Ordem não foi enviada. Mudar a regra = banco, fora da F3.2. Decisão D1 |
| R3 | `tecidos_planejados` derivado inclui substitutos → agrupamento muda | Dev deriva com substitutos (`ModeloDetailPanel.tsx:1937-1948`); leitores `criacao.planejamento.tsx:820-839`, `EditarMixDialog.tsx:108`, condição `tecido_planejado` (`funcoes.sql:381`) | 1 card muda (Ave Rara "VESTIDO ELIANE" passa a aparecer também no grupo "TULE POLY POWER MESH"); 201 iguais. Lista só vai no UPDATE quando o BOM grava. Divergência PRÉ-EXISTENTE: o "Aplicar" do Plan. Tecido regrava SEM substitutos (`funcoes.sql:4605-4609`) — a lista oscila entre os dois; registrar p/ F4/F5 |
| R4 | Tecido N fantasma (R5) | Dev `ModeloDetailPanel.tsx:935-944` sem guarda; 6 modelos na cópia local (5 Ave Rara + 1 Loja Teste) | Cópia com guarda (`hidratarBlocos`, teste). Dev intocado (decisão 8) — bug latente reportado |
| R5 | Retry do P0409 sobrescrevia campos do outro usuário | `usePlanejamentoSave.ts:73` (`...draft` da closure) + `:341`/`:352` | Task 10 Steps 4 e 11 + teste puro (Task 4) + QA S4 |
| R6 | Save-em-voo apagava o "não salvo" e o eco revertia teclas | `usePlanejamentoSave.ts:268-280` | Task 10 Step 10 (`resetDraftBaseline(enviado)`, `tocadosAposSalvar`, MO enviada) |
| R7 | Duas telas no mesmo BOM (Dev + Planejamento) até a F5 | proteção = `.eq("rev")` no 1º write; BOM com `_rev_base:null` depois (`ModeloDetailPanel.tsx:1950-1959`) | Mesmo desenho do Dev + conflito de seção nos dois sentidos (merge + onError), mas só quando o BOM do SERVIDOR mudou de verdade (R5 — assinatura do que o banco guarda × referência). **Correção (re-check do guardião, R5a):** o `verificandoBomRef` NÃO "fecha a janela" sozinho — ele só segura o Salvar enquanto confere um rev que chegou com o BOM JÁ tocado. O rev que chega com o BOM INTOCADO só invalida; se o usuário toca antes de o refetch chegar, é a CARGA que compara (R5a, R20) — e isso cobre também o refetch de foco. Sobram, aceitas (a mesma classe de janela do Dev, que nem compara): tocar E salvar antes de o refetch chegar (~1 ida e volta) e a janela estreita depois do 1º write. QA S5/S5b/S5c/S5d simulados + E2/E3/E6 REAIS na cópia (Realtime, P0409, Dev ↔ Planejamento) |
| R8 | `salvar_modelo_bom` apaga e re-insere o BOM inteiro | `funcoes.sql:7605-7609` | Grava só "carregado E sujo"; `gravarTecidosIniciais` só com id recém-inserido (grep na Task 16) |
| R9 | 4º tecido do Dialog não aparece no Dev | `sync-tecidos.ts:26-43` × `modelo-detail/types.ts:73-93` | `MultiArtigosField max={3}`; `blocosTecidosIniciais` corta em 3 |
| R10 | Etiquetas e CAD sem rede de segurança | G-inicial #7 | Task 14 (snapshot só-leitura antes do merge e do deploy) |
| R11 | Markup do Sheet × card da lista divergem quando não há previsto | lista usa `custoData.real` (`criacao.planejamento.tsx`); Sheet passa a usar a estimativa | Decisão D3 |
| R12 | Grade HERDADA (variante nova) só é gravada se o BOM for tocado | Dev grava o BOM a cada Salvar | Exibição igual à do Dev; persiste no próximo Salvar com o BOM tocado ou no Dev. Registrado |
| R13 | Kanban automático (F1): Salvar do BOM enfileira recálculo | tabelas-fonte da F1 | Com a chave ligada, editar o BOM no Planejamento pode mover o card — é o comportamento desejado |
| R14 | Duplicar: falha no BOM depois do insert deixa a cópia sem tecidos | Task 13 | Toast de erro; mesmo perfil do sync de hoje (2 requisições) |
| R15 | Card de revenda dispara as leituras da ficha por 1 render (origem padrão "interno" antes da semeadura) | `emptyDraft().origem = "interno"` | Só leitura; some quando o draft semeia. Aceito |
| R16 | Falso conflito "Tecidos & BOM" pelo eco das ações do PRÓPRIO usuário (Mover para…, Ordem, Lançar, aprovar MO sobem o `rev` fora do Salvar) — "usar o novo" descartaria a edição dele (G-plano conjunto R5) | merge F3.0 `PlanejamentoDetail.tsx:522`; F3.1 `useMoverEtapa` (UPDATE + invalidate) | `aoMudarNoServidor` confere o BOM do servidor × referência e ignora o eco (BOM igual); P0409 com BOM tocado idem (retry normal se o BOM do servidor está igual). Testes: ficha-calc (assinatura) + save-ficha (`bomConflito`) + QA S5b/S5c |
| R17 | Duas travas no mesmo card (F3.1 × F3.2) com avisos contraditórios ("use Editar" × BOM travado) (G-plano conjunto R2) | F3.1 `AvisoCamposDev`; trava interina "cad" | Trava ÚNICA: `motivoSomenteLeitura` deriva de `motivoTravaDev` ("sem permissão"/"enviado", com o "Editar" já considerado) + "cad"; avisos com o texto da F3.1 (o "enviado" diz que o "Editar" não libera o BOM). QA S8 |
| R18 | A F3.2 perder o `onCreated`/`onSaved: aoSalvar` da F3.1 sem o `tsc` acusar (opcional/função) → card duplicado volta, Salvar deixa de re-travar (G-plano conjunto R1) | F3.1 §3 item 7 | Âncoras do texto FINAL da F3.1 (Task 0 Step 3), 5º gate "F3.1 preservada" em TODO commit, `gravarTecidosIniciais` DENTRO do `else` do INSERT real, QA S6 (Dialog → Sheet com 1 POST; 2º Salvar = PATCH) |
| R19 | QA reprovando por barrada inerente (Home chama `servicos_financeiro`; broadcast REST) e o remédio errado (liberar a RPC = gravar `parcelas_servico` em PRODUÇÃO) (G-plano conjunto R4) | `HomeLogado.tsx:135`; `funcoes.sql:16568` | Barradas esperadas da F3.1 (seguem barradas, não reprovam); `servicos_financeiro` proibida em `READ_RPCS` (o spec lança erro); loja pelo tenant_id; porta da variante ocupada ⇒ PARE; derrubar só pelo `descer.sh` (confere o PID) |
| R20 | **Sobrescrita silenciosa do BOM (R5a do re-check do guardião):** (1) o rev chega com o BOM intocado ⇒ `aoMudarNoServidor` só invalida; (2) o usuário toca o BOM antes de o refetch chegar; (3) a carga com o BOM tocado só retornava ⇒ o BOM novo do servidor nunca era comparado; (4) o merge já avançou o rev ⇒ o Salvar passa o `.eq("rev")`; (5) `salvar_modelo_bom(_rev_base:null)` sobrescreve o BOM alheio sem aviso | carga `useFichaBom` (ramo "tocado"); `aoMudarNoServidor` (sem toque só invalida) | No ramo "tocado" da carga, `aoRecarregarComTocado` compara `assinaturaBom(estadoBomDoServidor(dado novo))` × referência e acende "Tecidos & BOM" (Tasks 6/7); cobre o refetch de foco. QA S5d (simulado, com o GET do BOM segurado pela rota). Paridade: o Dev tem o MESMO buraco e fica como está (decisão 8) — §7 D5 |
| R21 | Eco do MEU save deixar o aviso "Tecidos & BOM" aceso: a conferência disparada pelo UPDATE (1º write) compara com a referência velha depois do `salvar_modelo_bom` e o `.then` resolve depois do `aposSalvar` (NOTA do re-check) | `aoMudarNoServidor` × `aposSalvar` | `aposSalvar` faz `geracaoRef.current += 1` (descarta a conferência em voo) e baixa o "conferindo"; um BOM alheio nesse meio-tempo segue coberto pela carga (R5a) após o `invalidarBom()` |
| R22 | QA gravar em produção / QA esperar a F1 (N2) | app local da worktree → produção (server functions com a service role — o `@cloudflare/vite-plugin` lê o `.env` da pasta do wrangler); o merge da F3.1 espera a F1 | QA na CÓPIA pela variante `:5186` (guarda do vite + guarda de rede INVERTIDA no spec; `F32_ALVO`/`VITE_SUPABASE_URL` obrigatórios, sem fallback); fluxos que gravam só na cópia; produção só snapshot + smoke só-leitura |
| R23 | F3.2 presa ao merge da F3.1 (que espera a T9 e a F1 em produção) (N4) | re-check do guardião | nasce da ponta de `f31/planejamento-campos` após o G-commit (Task 0 Step 1); junta depois da F3.1 com `rebase --onto` + âncoras + gates + QA de novo (Task 16 Steps 4–5) |

Bugs LATENTES do Dev observados (report-only; decisão 8): R5 fantasma; `["modelo-precos-congelado"]` não é invalidado no pós-save; save alheio que muda SÓ o BOM pode acender "não salvo" falso (merge retorna antes de re-armar, `:853`); `toggleGradeAuto` não marca a coleção como tocada (`:2639-2652`); **R5a — rev que chega com o BOM intocado + toque antes do refetch = BOM alheio sobrescrito sem aviso (a carga do Dev, com coleção tocada, só retorna — `:870-1038`; o merge `:808-868` só acende o conflito com coleção JÁ tocada)**: a F3.2 fecha no Planejamento (R20); no Dev fica — aviso ao dono em §7 D5, NÃO corrigir aqui.

## 6. Decisões técnicas (o controlador decide)

1. Chaves próprias `plan-ficha-*` (config com "tenant" no nome) — sem cache compartilhado com o Dev.
2. "Não salvo" do BOM = tocado E snapshot ≠ baseline; snapshot sem `id`/`custo_previsto` (substitui a heurística de 2 renders do Dev).
3. No retry do P0409, as colunas derivadas do BOM só vão quando o retry GRAVA o BOM (os derivados saem do mesmo BOM gravado); sem gravar o BOM, NÃO vão (o BOM local, não tocado, pode estar velho).
4. `tecidos_planejados` só vai no UPDATE quando o BOM grava (evita reverter a lista de outra tela).
5. Dialog "Novo Modelo": no máximo 3 tecidos.
6. **Conflito de seção "Tecidos & BOM" só quando o BOM do SERVIDOR mudou de verdade (R5 do G-plano conjunto; ruling do controlador: "ignorar o próprio eco"; R5a do re-check — a carga também compara).** A ficha compara a assinatura do BOM recarregado (o que `salvar_modelo_bom` + etiquetas gravariam, sem custos derivados, grade com chaves em ordem estável) com a REFERÊNCIA (o BOM do servidor sobre o qual o usuário editou; vira o ENVIADO depois de um Salvar que gravou o BOM). Assim o eco das ações do próprio usuário que só sobem o `rev` (Mover para…, Ordem, Lançar, aprovar MO) e o eco do próprio save com o BOM editado em voo NÃO acendem o aviso. Descartado "rastrear o rev das ações próprias": cada ação faz mais de uma escrita (`kanban_mover`/`marcar_etapa_verificada`, rollup da MO), o eco do Realtime pode chegar antes da resposta, e um rev marcado como "meu" pode englobar o save de OUTRA pessoa → BOM alheio sobrescrito sem aviso (falso negativo, o lado perigoso). O plano B do ruling (bloquear as ações com "Salve antes de …") não foi preciso. Falso positivo que sobra (seguro, sem perda): normalizações raras entre o estado local e o gravado (ex.: substituto sem variante) no eco do próprio save com edição em voo.
7. **QA contra a CÓPIA (N2 do re-check; ruling do controlador — o mesmo modo da F3.1):** variante do app de teste em `:5186` (o `criar-variante.sh` da F3.1), coluna da F3.1 na cópia pelo `copia-qa.sh` dela, guarda de rede INVERTIDA; o automático segue simulado (cenários determinísticos, inclusive S5d); os caminhos de escrita (E1–E6: BOM real, Realtime entre abas, P0409 real, card novo, Duplicar, Dev ↔ Planejamento) rodam de verdade NA CÓPIA, um por vez, dono avisado. Nada grava em produção antes do merge; depois, só o smoke só-leitura.
8. Salvar do Planejamento invalida `["modelo-detail", id]` (Sheet do Dev na mesma aba) e, com BOM gravado, as chaves de BOM/estoque/downstream do Dev.
9. `marcar_revisao_por_mudanca` roda no fim do `mutationFn` (depois da MO), com erro ignorado (paridade).
10. BOM só para produto interno (F3.4 abre para comprado).
11. Seções sem prefixo numérico (numeração global do Sheet = F3.1/F3.3).
12. Melhorias locais sobre o Dev: `toggleGradeAuto` marca tocado; confirmar "Apagar grade preenchida?" marca o #Erro de grade.
13. Snapshot só-leitura antes do merge E antes do deploy.
14. **Trava ÚNICA (R2):** `motivoSomenteLeitura` = "permissao"/"enviado" (da trava da F3.1, `motivoTravaDev`, com o "Editar" já considerado) › "carregando" › "cad" (interina). Card enviado ⇒ tem CAD (0 exceções na cópia local), então o "Editar" da F3.1 destrava os campos simples do Dev e o BOM segue só-leitura com o aviso "cad" até a F3.3. Para isso a F3.1 declara a query do modelo e a trava logo depois das permissões (F3.1 T16).
15. **Custos do BOM como LINHAS da tabela de Preço e Custos (R9c — mockup `gen_anotado.py` seção 10):** Tecido/Forro/Entretela/Aviamento/Insumos + custos adicionais editáveis dentro da `PrecoTabela`; o `ModeloCustosSection` do Dev não é usado (só o tipo `CustoAdicional`). Sem impedimento técnico; a trava vai por `disabled` em cada input (`<fieldset>` não cabe dentro de `<tbody>`).
16. **Tecido 1..N do Dialog DENTRO do `else` do INSERT real (R1):** só com o id que ESTE insert criou; o caminho do `criadoIdRef` já preenchido não regrava o BOM.
17. **Lista ÚNICA `CAMPOS_DEV_DRAFT` ("Unificar" do G-plano conjunto):** `proporcoes`/`custos_adicionais` entram nela; saíram `CAMPOS_DEV_NAO_HERDADOS_NO_DUPLICAR`/`limparPayloadDuplicar` — o Duplicar usa o `camposParaDuplicar` da F3.1. O `aplicarColunasFicha` segue omitindo as 2 colunas nas travas que não são de permissão (ficha não carregada, "enviado", "tem CAD").
18. **Salvar espera a conferência do BOM** (`verificandoBomRef`, mensagem "Conferindo se outra pessoa mudou o BOM deste card — salve de novo em instantes."): só acontece com o BOM tocado e um `rev` novo chegando; dura o refetch de 5 consultas. Não é ela que cobre o toque feito depois de um rev que chegou com o BOM intocado — isso é a carga (item 20).
19. **QA:** barradas esperadas iguais às da F3.1 (R4); save-em-voo com PATCH atrasado pela rota (R6, S4b); eco próprio × BOM alheio por `visibilitychange` + GET simulado (R5, S5b); P0409 com BOM igual (S5c); toque antes do refetch com o GET do BOM segurado pela rota (R5a, S5d); na cópia, E1–E6 reais.
20. **R5a (re-check do guardião) — a carga com o BOM tocado COMPARA:** `useFichaBom` ganha `aoRecarregarComTocado(servidor)`; no ramo "tocado" da carga ele monta o BOM do servidor com `estadoBomDoServidor` (as mesmas funções da carga) e o orquestrador compara `assinaturaBom` × referência (a mesma regra do `bomMudouNoServidor`), guardando a assinatura para o "manter meu". Não sobrescreve o que está tocado (igual ao Dev); só acende o aviso. Barato e sem estado novo; cobre o refetch de foco. Não se estende ao Dev (decisão 8).
21. **`geracaoRef += 1` no `aposSalvar` (NOTA do re-check):** descarta a conferência em voo (o eco do próprio save não deixa o aviso aceso) e baixa o "conferindo" junto (senão o Salvar esperaria para sempre). O BOM alheio que chegar nesse meio-tempo é pego pela carga (item 20).
22. **F3.2 nasce do G-commit da F3.1 (N4):** da ponta de `f31/planejamento-campos`, não do merge; junta depois da F3.1 com `git rebase --onto feature/plan-tecido-a1 <BASE> f32/ficha-bom` + âncoras (Task 0 Step 3) + 5 gates + QA na cópia de novo.
23. **5º gate como script que sai 1 (NOTA do re-check):** `.superpowers/f32/gate-f31.sh` — antes só imprimia "QUEBRADA" e o commit podia seguir.

## 7. Decisões para o dono (poucas)

- **D1 — Reserva de estoque antes da Ordem de Criação.** Com o BOM no Planejamento, cores + grade lançadas num card ainda sem Ordem de Criação já reservam tecido (hoje: 1 card de teste). (a) **Aceitar, com um aviso na seção Tecidos** — recomendado; (b) reservar só depois da Ordem enviada — mudança no banco (`_estoque_tecido_core`), entra como tarefa própria depois.
- **D2 — Entre a F3.2 e a F3.3 (trava interina do BOM).** O CAD só é regravado pelo Sheet novo na F3.3. Números reais (cópia local, 23/set — R3 do G-plano conjunto): **193 dos 214 cards internos (90%) têm CAD; 136 deles ainda NÃO foram enviados à Explosão** — o CAD nasceu sozinho no Salvar do Desenvolvimento (que cria o CAD quando há tecido com variante) e hoje o Dev deixa editá-los. Com a F3.2, esses 193 mostram o BOM **só-leitura no Planejamento** (com "Abrir no Desenvolvimento"); editam aqui só os **cards novos e os 21 internos antigos sem CAD** — e um card novo passa a só-leitura aqui assim que alguém salvar o BOM dele no Desenvolvimento (o CAD nasce nesse Salvar). **Por que travar mesmo assim:** com CAD, um consumo editado aqui seria DESFEITO pelo próximo Salvar do Desenvolvimento (ele devolve o consumo do CAD para o BOM) e a Explosão ficaria desalinhada; sem CAD não há o que desfazer (o Dev semeia o CAD a partir do BOM). (a) **Juntar a F3.2 assim** — recomendado (seguro; na F3.3 o Salvar grava o CAD e a trava sai); (b) segurar o merge da F3.2 e juntar com a F3.3.
- **D3 — Markup sem custo previsto.** Pela decisão #6, o Sheet passa a calcular markup/preço sugerido sobre a estimativa quando ainda não há previsto do BOM; o card da LISTA do Planejamento continua mostrando "—" nesse caso. (a) **Alinhar a lista numa etapa própria depois** — recomendado; (b) alinhar agora (mais uma tela na F3.2).
- **D4 — INFORMADO (re-check do guardião; sem decisão pendente):** a trava interina "tem CAD" da D2 também deixa **só-leitura os custos adicionais** da tabela "Preço e Custos" (eles só são editáveis com a ficha destravada — `editavel: ficha.podeEditar`, Task 12). A D2 que você aprovou citava só "tecidos, aviamentos, insumos e grade". O CAD não mexe em custos adicionais (ele só devolve o consumo — `funcoes.sql:6878-6881`), então o motivo técnico da trava não se aplica a eles; o plano mantém a trava por ser UMA trava só (mais simples e sem contradição entre seções) e ela sai inteira na F3.3. Se quiser os custos adicionais livres já na F3.2 nesses cards, é um ajuste pequeno — basta dizer.
- **D5 — INFORMADO, item para você (NÃO para corrigir no Desenvolvimento — decisão travada 8):** o re-check achou uma janela de **sobrescrita silenciosa do BOM** (R5a/R20): alguém salva o card, o seu Sheet recebe a atualização com o BOM ainda intocado, você mexe no BOM antes de a tela recarregar os tecidos e salva — o BOM da outra pessoa é substituído sem aviso. A F3.2 fecha isso no Planejamento (a tela passa a comparar o BOM que chega com o que você tinha e mostra "Tecidos & BOM"). **O Sheet do Desenvolvimento tem o MESMO buraco hoje** e continua com ele (a campanha não mexe no Dev); na prática exige duas pessoas no mesmo card com segundos de diferença. Fica registrado para quando o Dev for aposentado/unificado (F5).

## 8. Autorrevisão (cobertura do spec)

| Item do spec / pedido | Onde |
|---|---|
| `useFichaTecnica` + `useFichaDados`/`useFichaBom`/`useFichaGuarda` + `ficha-calc.ts` com `tests/unit/ficha-calc.test.ts` | Tasks 2, 5, 6, 7 |
| Reusar sem modificar `types.ts`, `grade-proporcao`, `casar-variantes-grade` (via `recompute*`/`ModeloGradeSection`), Aviamentos/Etiquetas/Grade (Custos: só o tipo `CustoAdicional` — as linhas moram na `PrecoTabela`, mockup R9c) | Tasks 6, 9, 12 (+ gate "Dev intocado") |
| Cópia do `ModeloTecidosSection` com preço/m + estoque (decisão #10) | Task 8 |
| Save: UPDATE (rev) → `salvar_modelo_bom(_rev_base:null)` → etiquetas → MO → `marcar_revisao_por_mudanca`; BOM só carregado E sujo; `secao:bom`; P0409 → merge/retry | Tasks 4, 7, 10, 11 |
| Fix do retry P0409 com teste | Task 4 (teste puro), Task 10 (fiação), QA S4 |
| Remover `MultiArtigosField` do Sheet e `syncTecidosToDesenvolvimento`; `tecidos_planejados` derivado | Tasks 10, 11 |
| Dialog "Novo Modelo" mantém o seletor e grava Tecido 1..N (R3) | Tasks 7, 10, 11; QA S6 |
| Pré-preenchimento só com BOM vazio (R5) | Task 2; QA S1 |
| "Apagar grade preenchida?", remover variante com grade, substituto órfão, custo congelado pela OC, herança, grade automática | Tasks 5, 6, 9 |
| #Erro downstream | Task 10 |
| Conflito "Tecidos & BOM" (só com o BOM do servidor mudado — R5; eco próprio ignorado) | Tasks 2, 4, 7, 10, 11; QA S5/S5b/S5c |
| Destaque do Importar (estado + seções) | Tasks 6, 9, 12 (diálogo = F3.3) |
| Custos adicionais (decisão #2) | Task 12 |
| Decisão #4 (grade por variante do Tecido 1 só interno) | Task 7 (`habilitada` exige interno) |
| Decisão #6 (custo-base + selo) | Tasks 3, 12 |
| Decisão #7 (CAD no Salvar) | fora — F3.3; a F3.2 deixa o slot na cadeia e a trava interina (D2) |
| Decisão #9 (Duplicar) | Tasks 4, 13; QA S7 |
| Selos por mapa próprio (decisão 8) | Tasks 3, 9 |
| Duas telas no mesmo BOM + QA com o Dev aberto | R7/R20; QA S4/S5/S5d + E2/E3/E6 reais na cópia (Task 15 Step 4) |
| Riscos reserva e agrupamento (quantificados) | §1, R2, R3 |
| Snapshot antes da produção (G-inicial #7) | Task 14 |
| Interfaces consumidas da F3.1 (texto FINAL; F3.2 nasce da ponta de `f31/planejamento-campos` depois do G-commit da F3.1/F3.1a — R8 + N4) | §2; Task 0 Steps 1 e 3; 5º gate |
| Re-check do guardião N4 — nascer do G-commit, não do merge; rebase final `--onto` | Global Constraints; Task 0 Step 1; Task 16 Steps 4–5; §6 item 22 |
| Re-check do guardião R5a — carga com o BOM tocado compara × referência; S5d; afirmação do R7 corrigida; Dev com o mesmo buraco (aviso ao dono) | Tasks 6, 7; QA S5d (Task 15); §5 R7/R20; §6 item 20; §7 D5 |
| NOTAs do re-check — `geracaoRef += 1` no `aposSalvar`; 5º gate sai 1; sem fallback de `SUPA_HOST`; custos adicionais na trava "cad" (INFORMADO) | Task 7; Task 0 Step 4b + Global Constraints; Task 15 (spec); §7 D4 |
| N2 + ruling do controlador — QA contra a CÓPIA (variante `:5186`, coluna por `copia-qa.sh`, guarda invertida, fluxos que gravam na cópia; produção só snapshot + smoke) | Global Constraints (QA); Task 15; Task 16 Step 6; §6 item 7 |
| G-plano conjunto R1 — âncoras finais da F3.1 (`qc, onSaved: aoSalvar, onCreated,`, `{ autoProduto, savedId }`), `gravarTecidosIniciais` dentro do `else`, `onCreated` provado | Task 0 Step 3; Task 10 Steps 2/7/9/12/13; 5º gate; QA S6 |
| G-plano conjunto R2 — trava única + avisos alinhados à F3.1 | Tasks 7, 9, 10 Step 12; QA S8 |
| G-plano conjunto R3 — D2 com 193/214, 136 não enviados, 21 sem CAD | §1, §5 R1, §7 D2 |
| G-plano conjunto R4 — barradas esperadas, `servicos_financeiro` proibida, loja por tenant_id, porta de QA ocupada ⇒ PARE (agora a variante `:5186`) | Global Constraints (QA); Task 15 |
| G-plano conjunto R5 — eco próprio ignorado (conflito só com o BOM do servidor mudado), código + testes | Tasks 2, 4, 7, 10, 11; QA S5b/S5c; §6 item 6 |
| G-plano conjunto R6 — save-em-voo com PATCH atrasado e digitação no voo | QA S4b (+ `tocadosAposSalvar`, Task 4) |
| G-plano conjunto R9c — custos do BOM como linhas da tabela; Dialog com Tecidos antes da Mão de obra | Task 12; Task 11 Step 7 (+ F3.1 Task 6); QA S6/S10 |
| "Unificar" — lista única `CAMPOS_DEV_DRAFT` | Tasks 1, 4, 13; Task 16 Step 2 |
