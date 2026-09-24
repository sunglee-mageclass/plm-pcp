# Planejamento unificado — F3.4: produto COMPRADO (revenda/importado) no Sheet do Planejamento — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O Sheet do Planejamento passa a atender o produto COMPRADO (revenda e importado) como atende o interno: Origem ganha "Importado" (com regras de troca e auto-criação do Produto Importado), as seções vindas do Desenvolvimento aparecem pelo "Fluxo de Revenda" da loja, a grade cor × tamanho vira a ÚNICA grade do comprado (e é ela que o `salvar_modelo_bom` recebe), a mão de obra segue visível, o preço da revenda fica como hoje, o CAD do comprado nunca é gravado pelo Planejamento, os selos usam os requisitos do comprado e o "Enviar à Explosão" do comprado segue a decisão D2 — sem tocar no Sheet do Desenvolvimento e SEM migration.

**Architecture:** A regra pura mora em `planejamento-detail/comprado.ts` (testado). A grade cor × tamanho SAI de `useRevendaPlanejamento` (texto movido) para `useGradeComprado` — que lê o produto espelho POR ORIGEM (`produtos_acabados`/`produtos_importados`) e segue dono da grade (mesmos nomes/queryKey). A ficha (`useFichaTecnica`, da F3.2/F3.3) abre para o comprado com a grade PROJETADA para fora (não carrega/compara/grava a grade dela); no Salvar, `salvar_modelo_bom` recebe a grade cor × tamanho (`gradesPayload`: o rascunho se editado, senão a do SERVIDOR) — no importado a grade grava por esse caminho (não existe `salvar_grade_revenda` para importado). O orquestrador (`PlanejamentoDetail`) decide seções por origem (`secoesFicha` + `revendaCampoVisivel`), preço (tabela da F3.2 só para interno; revenda segue `PrecoRevendaBloco`) e selos por origem.

**Tech Stack:** Vite + React 19.2 + TypeScript (strict, `noUnusedLocals:false`) + TanStack Query v5 + supabase-js. Testes: Vitest (`tests/unit`, ambiente node) e Playwright (QA contra a cópia, arquivo NÃO versionado).

**Spec:** `/Users/sunglee/.claude/plans/h-uma-necessidade-de-flickering-lovelace.md` — seção **F3.4** ("Origem ganha 'Importado' no Sheet (decisão F3 #3; depende do módulo opt-in; trocar a origem muda o fluxo); visibilidade por `revendaCampoVisivel`; um único editor de grade (a grade cor×tamanho vira a fonte; `salvar_modelo_bom` recebe essa grade porque apaga todas)") e "10 decisões de F3 APROVADAS" #3, #4, #5, #6, #8. Contexto comum: `.superpowers/sdd/2026-09-22-unificacao-kanban-auto/planner-context-f3.md`. Planos anteriores (fonte das interfaces): `docs/superpowers/plans/2026-09-23-planejamento-unificado-f32-bom.md` (§2 "Pontos da F3.4: `useFichaTecnica.habilitada` … passa a consultar `revendaCampoVisivel`") e `docs/superpowers/plans/2026-09-24-planejamento-unificado-f33-cad-explosao.md` (§2 "Produzidas (F3.4 usa)", Global Constraints "Fora de escopo … = F3.4"). Mockup aprovado: `…/scratchpad/canvas-unif/gen_anotado.py:59` (Origem "muda: ganha Importado (decisão 3)"), `:124` (Grade = "produto interno (revenda usa a grade cor × tamanho, só Planejamento)"), `:183` ("Só para revenda / importado: Produto Acabado · Grade cor × tamanho · Markups e preços atacado/varejo — ficam como hoje"), `gen_prova.py:61-66` (decisões 3, 4, 5, 8). Memórias: `project_produto_acabado_revenda`, `project_produtos_importados`, `project_fluxo_revenda_config`, `project_revenda_explosao_servicos`, `project_preco_revenda_mo_multi`, `project_preco_fixo_revenda`. CLAUDE.md invariante #13 (SSOT `src/lib/revenda-config.ts`).

## Global Constraints

**Repositório, worktree e ordem das fases**
- Worktree própria: `/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f34-comprado`, branch `f34/comprado`, **criada da PONTA da F3.3** (`f33/cad-acoes`) DEPOIS do G-commit dela — ou, pelo mesmo **ruling R3a** da F3.3, da ponta ATUAL e COMMITADA de `f33/cad-acoes`, refazendo o rebase quando a F3.3 fechar (Task 0 Steps 1(b) e 5). **Nos dois casos, só com as Tasks 9 e 10 da F3.3 commitadas e a worktree da F3.3 limpa** (G-plano F3.4 R2 — Task 0 Step 1). O sha fica em `.superpowers/f34/BASE`. Caminhos relativos neste plano = raiz da worktree.
- Ordem de merge da campanha: F3.0 → F2 e F3.1 → F3.2 → F3.3 → **F3.4**. A F3.4 junta SEMPRE depois da F3.3 (`git rebase --onto feature/plan-tecido-a1 "$(cat .superpowers/f34/BASE)" f34/comprado` — Task 10 Step 5), com o dono avisado para salvar e fechar os cards do Planejamento/Desenvolvimento no `:5173` E no `:5188`. Merge só por fast-forward. Nenhum commit intermediário da F3.4 vai sozinho à branch principal (a fase junta inteira).
- `git add -- <paths>` + `git commit --only -m "…" -- <paths>` (o `git add --` antes vale para arquivo NOVO — `commit --only` sozinho falha com arquivo não rastreado); nunca `git add .`. Toda mensagem termina com `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Sem push.
- ⛔ **PROIBIDO `git stash`** (pilha COMPARTILHADA entre worktrees). Para comparar linha de base, use os números da Task 0 ou um commit WIP na SUA branch.
- `src/routeTree.gen.ts` é gerado pelo build: nunca entra em commit (`git checkout -- src/routeTree.gen.ts` depois do build).

**Intocáveis (decisão travada 8 e escopo)**
- NADA em `src/components/desenvolvimento/**` (inclui `importar/`), `src/components/producao/**` (inclui `cad/CadTecidosSection.tsx`, `PrintFicha.tsx`), `src/components/shared/ModeloObservacoes.tsx`. Importar deles (sem editar) é permitido. **Nenhuma cópia é necessária:** `ModeloAviamentosSection`/`ModeloEtiquetasSection`/`CadTecidosSection` já são só-props; a grade cor × tamanho é componente do Planejamento (`RevendaSetores.tsx`). Se, ao executar, algo exigir mudar componente do Dev: PARE, faça CÓPIA em `planejamento-detail/ficha/` e registre (decisão 8).
- NADA em `src/lib/kanban-condicoes.ts`, `src/lib/revenda-config.ts`, `src/lib/origem.ts`, `src/lib/produto-acabado.ts`, `src/lib/artigo-label.ts`, `src/components/produto-acabado/**`, `src/components/produto-importado/**`, `src/components/oc-p-acabado/**` (só importar), `supabase/**`, `tests/integration/**`, `tests/fixtures/**`.
- **Sem migration e sem DDL** (prova na §3). Leitura de banco: SELECT em `BEGIN READ ONLY` na cópia local `postgresql://postgres:postgres@127.0.0.1:54422/postgres`; produção só no snapshot só-leitura (Task 8) e no smoke (Task 10), com `default_transaction_read_only=on`.
- Fora de escopo (NÃO fazer): a função nova de banco da D3 opção (B) (grade do importado por quem edita só o Planejamento — etapa própria com G-migration); preço fixo/markup do importado no Sheet (segue a tabela de hoje — §6 R5); recálculo do preço da revenda ao mudar insumo (pré-existente — §6 R4); copiar a REF do produto para `modelos.ref` na auto-criação (pré-existente — §6 R9); apagamento dos ajustes da Explosão (decisão F3 #7, tarefa própria).

**Regras de gravação (o coração da F3.4)**
- A grade do comprado = `modelo_grades` com `variante_numero` = `ordem` da variante do produto. **Fonte ÚNICA = a grade cor × tamanho** (`useGradeComprado`, decisão F3 #4). A ficha do comprado NÃO carrega, NÃO compara e NÃO grava a grade dela (projeção `grades: []`).
- `salvar_modelo_bom` APAGA todas as `modelo_grades` (`_salvar_modelo_bom_core`: `DELETE FROM public.modelo_grades WHERE modelo_id = _modelo_id`): num comprado ele recebe **`gradesPayload`** = o rascunho da grade se ela foi EDITADA, senão a grade do SERVIDOR **LIDA NO PRÓPRIO SALVAR** (`lerGradeServidorComprado`: `rev` + grade num SELECT só; `rev` lido ≠ o do card ⇒ P0409; erro ⇒ nada grava — G-plano F3.4 R1). Nunca o cache `plan-ficha-grades` (fica VELHO entre uma mudança alheia sem toque e o refetch) nem o rascunho semeado 1× por abertura. Num comprado que grava o BOM sem essa leitura, a captura FALHA FECHADA (nunca `?? []`).
- Revenda: a grade editada grava por `salvar_grade_revenda` (rev próprio, ANTES do header — como hoje). Importado: a grade grava PELO BOM (`salvar_modelo_bom`, sob o `.eq("rev")` do header) — `salvar_grade_revenda` recusa origem ≠ revenda; por isso a grade do importado só é editável com a ficha editável (D3 (A)). Célula editada no importado marca a ficha como tocada (a conferência R5/R5a protege o Salvar); se a grade do SERVIDOR (a lida no Salvar) mudou desde a abertura, o Salvar NÃO grava (P0409 + recarga da grade — o mesmo caminho `gradeConflict` da revenda).
- O Planejamento NUNCA grava o CAD de produto comprado (`cadGravavel` e `deveGravarCad` barrados por origem): o CAD da revenda nasce no recebimento da OC com as etiquetas "a enviar" = consumo × peças REAIS (`_receber_oc_p_acabado_core`); o `salvar_cad_completo` apagaria e regravaria pelo planejado.
- Comprado não pré-preenche Tecido 1..N a partir de `tecidos_planejados` (não fabrica).
- A etapa (`status_desenvolvimento`) NUNCA vai no Salvar (decisão travada 13). Sem `canEdit("criacao_desenvolvimento")` nada do Dev grava (decisão F3 #8).
- Auto-criação ao salvar: revenda → Produto Acabado (como hoje); **importado → Produto Importado** (D1 (ii), espelho da revenda: `salvar_produto_importado` com variantes/etapas vazias + vínculo `modelo_id`; best-effort, nunca derruba o Salvar).
- **Nunca DOIS espelhos** (invariante #13; `enforce_unique_fk` é por tabela — G-plano F3.4 R3): a regra da Origem olha os DOIS produtos do card, qualquer que seja a origem (`plan-origem-espelhos`: `produtos_acabados` SEMPRE, `produtos_importados` só com `piOn`, senão INDETERMINADO); as duas auto-criações conferem o outro espelho na hora e, com erro na leitura, não criam.

**Gates (todo commit de código)** — `bash .superpowers/f34/gates.sh` (Task 0 Step 4) → `GATES F3.4: ok` e código 0. São 7: (1) `npx tsc --noEmit` (0 erro — o build NÃO faz type-check); (2) `npm run build`; (3) `env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit` (mesmas falhas herdadas da Task 0, nada novo); (4) Dev intocado + intocáveis desde o BASE; (5) **F3.1 preservada** (`gate-f31.sh`); (6) **F3.2 preservada** (`gate-f32.sh`); (7) **F3.3 preservada** (`gate-f33.sh`, novo). Gate falhou = PARE, não commitar. `tests/integration/*` PROIBIDO (cairia em `/tmp/dburl.txt` = PRODUÇÃO).

**QA — CONTRA A CÓPIA (o MESMO modo da F3.1–F3.3)**
- App de teste PRÓPRIO da worktree: variante gerada pelo `banco-local/app-teste-variantes/criar-variante.sh`, na porta **`:5183`** (a Task 9 acrescenta `5183` ao `case` do script, com backup). Supabase LOCAL `127.0.0.1:54321`. Guarda do vite da variante (aborta se qualquer URL não for local; raiz = a worktree).
- **NUNCA `:5173`, `:5184`, `:5185`, `:5186`, `:5187`, `:5188` (nem `:5198`/`:5199`)** para subir, derrubar ou testar com escrita (o `:5173` do dono só é LIDO no smoke pós-merge, sem derrubá-lo); nunca `npm run dev` + `VITE_*` (o worker leria o `.env` de PRODUÇÃO).
- **Guarda de rede INVERTIDA** no spec: gravação liberada SÓ para `127.0.0.1:54321`; QUALQUER requisição a `*.supabase.co` (GET inclusive) reprova. O automático simula as escritas (`route.fulfill`); os fluxos que GRAVAM (E1–E2) rodam na cópia, um por vez, com o OK do dono item a item. O E3 (envio real de um comprado à Explosão) está **PULADO** — G-plano F3.4 R4, motivo na Task 9 Step 1.
- `E2E_BASE_URL`, `VITE_SUPABASE_URL`, `F34_ALVO` e (na cópia) `F34_D2` SEMPRE explícitos; sem eles o spec FALHA.
- Barradas esperadas (as MESMAS das fases anteriores): `POST /rest/v1/rpc/servicos_financeiro` (NUNCA em `READ_RPCS`) e o broadcast REST do Realtime. Loja conferida pelo tenant_id `37889b78-fffb-404b-8c75-18b7e50a1d9b` (o robô NÃO troca de loja).
- Nunca rodar junto com o E2E da F2 nem com QA de outra fase (mesmo usuário; Realtime REAL na cópia).

**UI (padrões §A/§G/§K/§L/§Q)**
- Seções vindas do Dev para comprado: visíveis por `revendaCampoVisivel` (SSOT) — Tecidos = `s2`, Aviamentos = `s3`, Insumos = `s3e`, CAD = `s-cad`, Grade (cor × tamanho) = `s4`; a "Grade por variante do Tecido 1" NUNCA aparece no comprado. Default de fábrica (`REVENDA_CAMPOS_DEFAULT_OFF`): Tecidos, CAD e Prova ocultos; Aviamentos, Insumos e Grade visíveis.
- Sem hex/oklch/hsl solto, sem `.toFixed(`, moeda só por `brl()` (anti-drift). Textos PT-BR; erros por `mensagemErro()`; selo com R$ só para quem vê custos (invariante #12).

**Modelos e comunicação**
- Sonnet implementa; Opus revisa (lotes e individuais em §5). Não despachar subagentes dentro de uma task. Avisos ao dono por CHAT (sem `ExitPlanMode`). As perguntas da §8 precisam de resposta do dono: D1 (i) e (ii) e D3 ANTES da Task 1 (a regra da Origem, os textos e a auto-criação dependem delas); D2 antes da Task 7 e da Task 9 (`F34_D2`). Resposta diferente da recomendada = aplicar a variante listada na §8 ("Se a resposta for outra").

---

## 0. Ressalvas do G-plano F3.4 (guardião, 24/set) — onde entraram

O G-plano F3.4 (diário do guardião, `.superpowers/sdd/2026-09-22-unificacao-kanban-auto/guardiao.md`) APROVOU COM RESSALVAS. Ordem pedida pelo guardião: R2 antes da Task 0; R3 antes das Tasks 1/6; R1 antes das Tasks 4/5; R4 e R5 antes de levar a §8 ao dono; R6 e R7 registradas na §6.

| Ressalva | O que mudou no plano | Âncoras |
|---|---|---|
| **R1** — grade VELHA regravada pelo BOM do comprado (a captura lia o cache `plan-ficha-grades`) | Opção (a): a grade do servidor é LIDA no próprio Salvar, junto com o `rev` (`lerGradeServidorComprado`); `rev` lido ≠ o do card ⇒ P0409 (retry que já existe); a captura do comprado que grava sem essa leitura FALHA FECHADA (sem `?? []`). Por que não (b): §7 T13 | Global Constraints (Regras de gravação); Task 4 Steps 1, 2, 6 e 7; Task 5 Steps 1, 2 e 6 + revisão; Task 9 S5, S5b e S6; §6 R1; §7 T13 |
| **R2** — largada | Pré-condição: F3.3 com T9 e T10 commitadas e a worktree da F3.3 limpa; o mecanismo R3a segue; §1 e §6 R8 atualizados; as 4 âncoras do Enviar/Importar marcadas como dependentes da T9/T10 | Global Constraints; §1 (F3.3); Task 0 Steps 1, 2 e 3; §6 R8 |
| **R3** — espelho 1:1 com o módulo da origem desligado | Regra da Origem pelos DOIS espelhos (`plan-origem-espelhos`: Produto Acabado SEMPRE, sem depender do `paOn`; Produto Importado só com `piOn`, senão indeterminado ⇒ a saída do importado trava, e Revenda↔Importado fica travada); as auto-criações conferem o outro espelho | Task 1 (código + testes); Task 3 (produto só p/ a grade); Task 5 Step 4; Task 6 Step 2; Task 8; §6 R14; §7 T14 |
| **R4** — D2 | Texto ao dono diz que, na (A), o Importado também ganha o botão; variante (A2) só revenda; E3 PULADO com o motivo; snapshot com `cad_grades`/`cad_aviamentos` | §8 D2; Task 7 Step 5; Task 8 Step 1; Task 9 (Step 1, spec S7/E3, Steps 3–5); §7 T16 |
| **R5** — D1 mistura técnico com pergunta | Técnico = INFORMAR (Tecidos vazia, sem dois espelhos, produto segue vinculado ao voltar a Interno); perguntas reais = (i) volta a Interno com OC? e (ii) auto-criar o Produto Importado? | §8 D1 + "Se a resposta for outra"; Task 1 |
| **R6** — colunas derivadas num comprado | §6 R12 completa (`tecidos_planejados=[]`, custo parcial, `_dashboard_custos_core` sem origem, paridade com o Dev, 0/57 hoje) + snapshot com `custo_peca_previsto` | §6 R12; Task 8 Step 1 |
| **R7** — ficha pela origem do RASCUNHO × grade pela SALVA | A Origem não muda com edição pendente (ficha tocada OU grade cor × tamanho editada), nos dois sentidos | Task 1 (`edicaoPendente`, `MOTIVO_EDICAO_PENDENTE`, teste); Task 4 Step 6 (`tocado`); Task 6 Step 2; Task 9 S2b; §6 R15; §7 T15 |
| **D3** (informativo) | "Depois de enviado à Explosão, a grade do importado trava junto com a ficha; para mudar, usar o botão Editar" — no texto ao dono e no aviso da tela | §8 D3; Task 7 Step 4 (a) |

## 1. Fatos verificados (24/set/2026, só leitura)

**Código — ponta da F3.2 (`f32-ficha-bom` @`f19202b`; a F3.3 não mexe nestes pontos salvo onde indicado):**

| Onde | O quê | F3.4 |
|---|---|---|
| `InfoGeraisSecao.tsx:54-63` | Select "Origem" só com `interno`/`revenda` (card importado fica com o Select em branco) | ganha "Importado" + regras (Task 6) |
| `PlanejamentoDetail.tsx:231-237` | `paOn`; `isRevenda = origem==='revenda'`; `isComprado = ehOrigemComprada(origem)` | + `piOn` (Task 3) |
| `PlanejamentoDetail.tsx:428` | `previstoBase = … ficha.carregado ? previstoDaFicha(ficha.totais) : custoData.previsto` | comprado usa o do SERVIDOR (landed/unit real) (Task 7) |
| `PlanejamentoDetail.tsx:466-485` | revenda: `baseRevendaMarkup = previsto + MO ao vivo`; `piRevenda = precoInfo(base, …)` | intocado (decisão #6 "mantém") |
| `PlanejamentoDetail.tsx:501-508` | `useRevendaPlanejamento(…)` devolve a grade (`gradeRevenda*`, `buildLinhasGradeRevenda`) | a grade sai p/ `useGradeComprado` (Task 3) |
| `PlanejamentoDetail.tsx:1093-1140` | Preço: `!isRevenda ? <PrecoTabela…> : <PrecoRevendaBloco…>` (importado usa a tabela do interno) | intocado; `custosBom` só p/ interno (Task 7) |
| `PlanejamentoDetail.tsx:1126-1133` | `custosBom={ficha.habilitada && ficha.carregado && veCustos ? {…}}` | + `!isComprado` (Task 7) |
| `PlanejamentoDetail.tsx:1159` | Mão de obra: `(!isComprado ? true : isEdit) && (veCustos \|\| …)` — comprado JÁ vê a MO no Planejamento (decisão #5) | intocado (QA S3) |
| `PlanejamentoDetail.tsx:1186-1195` | "Produto Acabado" e "Grade" cor × tamanho SÓ p/ revenda (`isRevenda && paOn`) | importado também (Task 7) |
| `useRevendaPlanejamento.ts:42-57, 182-246` | estado/refs da grade, tamanhos, query `["modelo-grades-revenda", modeloId]`, seed 1× por abertura, handlers, `buildLinhasGradeRevenda` | MOVIDOS (Task 3) |
| `useRevendaPlanejamento.ts:63-80` | produto PA por `["pa-produto-modelo", modeloId]` (markups/preços fixos) | fica (preço da revenda) |
| `usePlanejamentoSave.ts:215-239` | revenda: `salvar_grade_revenda` (rev próprio) ANTES do header | intocado |
| `usePlanejamentoSave.ts:256-265` | `persistirBom` + `bomGravado` só com `bom.gravar` | + baseline da grade do importado (Task 5) |
| `usePlanejamentoSave.ts:353-397` | auto-criação do Produto Acabado (revenda, `paOn`, com grupo+categoria), best-effort | + importado (Task 5) |
| `usePlanejamentoSave.ts:569-585` | P0409 com `gradeConflict`: recarrega `["modelo-grades-revenda"]`, re-semeia, re-sincroniza o rev da grade | reusado p/ o conflito da grade do importado (Task 5) |
| `useFichaTecnica.ts:133` | `habilitada = isEdit && modeloId && !isComprado && podeVerFicha` | abre p/ comprado (Task 4) |
| `useFichaTecnica.ts:304-307` | `requeridas` por origem (comprado = `revenda_kanban_requisitos`) | + filtra `REVENDA_COND_NA` (Task 4) |
| `useFichaBom.ts:143-193` | carga: pré-preenche Tecido 1..N de `tecidos_planejados` com BOM vazio (`prefillPendenteRef`) | comprado não pré-preenche (Task 4) |
| `useFichaBom.ts:255-268, 296-316, 226-229` | troca do Tecido 1 apaga a grade; remover variante do T1 remapeia; herança de grade | desligados p/ comprado (Task 4) |
| `persistir-bom.ts:17` | `_grades: montarGradesPayload(bom.estado.grades)` | `bom.gradesPayload ?? …` (Task 4) |
| `ModeloDetailPanel.tsx:1571-1598` | Dev: comprado usa `campoVisivel` (config de comprado) nas seções e afrouxa "Para enviar, falta" (tecido só com `s2`, grade só com `s4`, datas só se visíveis); mínimos REF/Nome/Estilista/Categoria sempre | espelhado em `pendenciasEnvioExplosao` (Task 2) |
| `ModeloDetailPanel.tsx:1621-1623, 2849-2967` | ordem/visibilidade das seções do Dev: `s1 · prova · s2 · s-cad · s3 · s3e · s4 · s5 · s6` | mapa `secoesFicha` (Task 1) |
| `ModeloGradeSection.tsx:96` (Dev) | sem variante do Tecido 1 a grade do Dev não renderiza linhas — HOJE a grade do comprado só se edita no Planejamento (revenda) e a do importado em lugar nenhum depois do card criado | a do importado passa a editar no Planejamento (Task 3/7) |
| `ModeloDetailPanel.tsx:3031` | Dev esconde a MO do comprado | o Planejamento mostra (decisão #5, já hoje) |
| `revenda-config.ts:32-45, 61, 69-74` | `REVENDA_CAMPOS_DEFAULT_OFF` (9 campos + `prova`, `s2`, `s-cad`); `REVENDA_SECAO_KEYS`; `revendaCampoVisivel` | só consumido |
| `kanban-condicoes.ts:253-262` | `REVENDA_COND_NA` (tecido_planejado, tecido_com_variante, grade_todas_variantes, cad_preenchido, enviado_cad, grade_cortada_lancada) | filtro dos selos do comprado (Task 1) |
| `entrada-saida.explosao.index.tsx:75` / `expedicao.cq.index.tsx:54` | Explosão lista `enviado_cad OR origem=revenda` (sem importado); CQ/Direcionamento/Lançamentos incluem importado | contexto da D2 |

**Código — F3.3 (plano `da6bdfb`; execução em `f33/cad-acoes`, re-conferida em 24/set no G-plano F3.4: Tasks 1–8 commitadas até `6fac668` e os fixes das revisões em `8243cb6`/`67e363f` — HEAD `67e363f`; a Task 9 (Enviar à Explosão, menu ⋯) EM CURSO na worktree, SEM commit; a Task 10 (Importar dados) a seguir):** textos conferidos em `67e363f` — `useFichaTecnica.ts` já tem `const cadGravavel = podeEditar && (dados.cadExiste || a.ordemEnviada);`, o `capturarCad` com `podeEditar: podeEditarRef.current, cadHidratado: c.hidratado, …`, `capturar: (custosAdicionais, opts) =>` e o retorno `cadGravavel, cadAntesDaOrdem: !dados.cadExiste && !a.ordemEnviada,`; `useFichaBom.ts` com `aoMudarBloco` e retorno `marcarTocado, cargaSeq, aplicarConsumoDoCad,`; `envio-explosao.ts` e `selos-secoes.ts` commitados (`c280bcf`, `e24b55c`) com os textos do plano F3.3. O `ancoras-divergentes.md` da F3.3 registra: o gate da MO no JSX é `(veCustos || …)` (não `podeVerCustos`) e o `totais:` da captura usa `carregadoRef`. Da F3.3, só o que nasce nas Tasks 9 e 10 ainda é TEXTO DO PLANO F3.3 (`MenuMaisAcoes.tsx`, `useEnviarExplosao.ts`, `useImportarDados.ts`, `PedidoSecaoContext.Provider`, `mostraEnviarExplosao`/`pendenciasEnvio`/`onImportar` no orquestrador) — por isso a largada exige T9 e T10 commitadas e a worktree da F3.3 limpa (Task 0 Step 1, G-plano F3.4 R2); tudo é recontado na Task 0 Step 3 na PONTA real. (F3.3 no G-plano: `deveAplicarCargaCad` devolve false com a ficha TOCADA — a carga do CAD não se aplica e o `aoHidratar` não roda; é o que decide a opção (a) da R1 — §7 T13.)

**Banco (cópia local, `pg_get_functiondef`/SELECT só-leitura, 24/set):**
- `_salvar_modelo_bom_core` NÃO olha a origem; checa só tenant/ids aninhados; tira snapshot (`_modelo_bom_snapshot`) e APAGA `modelo_tecido_variantes`/`oc_links`/`modelo_tecidos`/`modelo_aviamentos`/**`modelo_grades`** antes de regravar do payload. Wrapper `salvar_modelo_bom` só checa o módulo `criacao`.
- `_salvar_grade_revenda_core`: trava otimista própria; **`IF v_origem IS DISTINCT FROM 'revenda' THEN RAISE … 'grade cor×tamanho não se aplica'`**; APAGA e regrava `modelo_grades`. Wrapper exige o módulo `produto_acabado`. ⇒ para importado não serve.
- `_criar_card_produto_importado_core` (e o da revenda, mesma receita): cria o espelho `modelos` e grava `modelo_grades` por `ordem` via `_pa_grade_variante(grupo, grade_proporcao, qtd)`. `_aplicar_produto_ao_modelo_core` (revenda) re-empurra só `modelo_grades`.
- `_receber_oc_p_acabado_core`: upsert do `cad` (reusa se já existe), `cad_grades`, e `DELETE`+`INSERT` de `cad_etiquetas` com "a enviar" = consumo × peças reais.
- `_enviar_modelo_para_cad_core` NÃO olha a origem: gate de etapa `_explosao_envio_gate(_kanban_status_gate(…))`; com CAD existente é idempotente; sem CAD cria o `cad` + `cad_tecidos` (do BOM) + `cad_grades` (de `modelo_grades`) + `cad_aviamentos`.
- `_custo_unitario_modelos_core`: revenda com produto ⇒ previsto = unit real + Σ(`modelo_etiquetas.consumo × custo_previsto`); importado ⇒ previsto = landed; os ramos comprados IGNORAM tecido/aviamento/custos adicionais do BOM. `_pa_recomputar_precos_modelo` soma insumos + MO na base; é chamado por salvar markups/preço fixo/produto/OC/receber/rollup de MO — NÃO por `modelo_etiquetas`. `_imp_recomputar_precos_modelo`: landed + MO; `else NULL` sem markup nem fixo.
- `_estoque_tecido_core` (reserva): `modelo_tecido_variantes × modelo_grades` de TODO modelo não reprovado e sem corte — **não filtra origem** (tecido deixado num comprado reserva).
- `salvar_produto_importado` tem 2 assinaturas (4 e 5 argumentos, a de 5 com `_rev_base`); com `_id null` exige nome, grupo e categoria; valida Σ% das etapas só se houver etapas. `produtos_importados`: RLS tenant + `modgate_pi_*` RESTRICTIVE (`produto_importado`), `trg_pi_unique_modelo` (`enforce_unique_fk`), `trg_sync_foto_modelo_importado` (foto nula = no-op). FKs únicas: `ocs_importado.produto_importado_id`, `ocs_p_acabado.produto_acabado_id`, `produto_*_variantes.produto_*_id` (embeds sem ambiguidade).
- `modelo_grades` tem `trg_colab_bump` (sobe `modelos.rev`) e os enfileiradores do kanban (F1).
- Contagens: 57 revenda (54 com Ordem, 0 `enviado_cad`, 0 com CAD, 0 com tecido/aviamento/insumo, 51 com grade, 57 com Produto Acabado); **0 cards importado**; 68 linhas de grade de revenda, **0 órfãs** (toda `variante_numero` casa uma `ordem`); `revenda_campos = {}` nas 6 lojas.
- Loja Teste (`37889b78…`): módulos `produto_acabado` e `produto_importado` LIGADOS, `kanban_automatico = true`, `revenda_*` vazios (defaults). Revenda "Vestido Teste" `9b4e079e…` (2 variantes, grade `{38|P,40|M,42|G}` 100+50, OC, sem Ordem); "Cinto Teste" `f8e77ebe…` (Ordem, `desenho_tecnico`, OC, sem grade/variante, REF vazia); Produto Importado "a" `a961ddd1…` (1 variante, sem card); internos sem tecido e sem CAD: "KA teste lock" ×2; 3 etiquetas; tamanhos `34|PPP…44|GG`.

## 2. Interfaces entre fases

**Consumidas da F3.3 (texto FINAL, conferido na Task 0 Step 3):** `useFichaTecnica({…, ordemEnviada})` → `FichaTecnica` com `cad` (`linhas`, `autoFolhas`, `faltas`, `handlers`), `seloCad`, `cadGravavel`, `cadAntesDaOrdem`, `aplicarImportacaoBom`; `FichaSave.capturar(custosAdicionais, opts?: { retry?: boolean; proporcoes?: Record<string, number> })`, `FichaSave.cadGravado(cad)`; `BomCapturado.cad: CadCapturado`; `deveGravarCad`, `CadCapturado` (`ficha-cad.ts`); `useFichaBom` devolvendo `marcarTocado`, `cargaSeq`, `aplicarConsumoDoCad`, `aplicarImportacao`; `useFichaCad`; `selos-secoes.ts`: `SecaoSheetKey` (com `produto_acabado`/`grade_revenda`), `ORDEM_SECOES_SHEET`, `numerarSecoes(visiveis, { dialogNovo })`, `selosSecoesSheet(e: EntradaSelosSheet)`, `seloCadSecao`; `selos-bom.ts`: `seloPorChaves`, `requisitosUniao`, `SeloSecao`; `envio-explosao.ts`: `gateEnvioExplosao`, `pendenciasEnvioExplosao`, `PendenciaEnvio`; `Secao({ id, titulo, numero, selo, chip })`, `SecaoBom({ …, numero })`, `SeloBadge`, `usePedidoAbertura`; no orquestrador: `fichaVisivel`, `vis: Record<SecaoSheetKey, boolean>`, `numeros`, `selos`, `seloDe`, `gateEnvio`, `mostraEnviarExplosao`, `pendenciasEnvio`; `MenuMaisAcoes({ …, onImportar })`; `useEnviarExplosao`; `usePlanejamentoSave(...)` → `{ save, handleSave, salvarAntes }`; `persistirCad`, `invalidarAposGravarCad`; `useImportarDados`.
**Consumidas da F3.2/F3.1:** `useFichaDados` (`plan-ficha-grades`, `revendaCfg`, `condicoes`), `ficha-calc` (`EstadoBom`, `GradeRowDb`, `BomCapturado`, `assinaturaBom`, `estadoBomDoServidor`), `persistirBom`, `BomSecoes`; `useFichaKanban` (`revendaCfg`, `kanbanCfg`), `campoVisivelDev`, `motivoTravaDev`, `devBloqueado`.
**Produzidas (F4/F5 usam):** `comprado.ts` (`opcoesOrigem`, `motivoTrocaOrigem`, `EspelhoProduto`, `EspelhosCard`, `SEM_ESPELHOS`, `espelhosDoCard`, `MOTIVO_EDICAO_PENDENTE`, `secoesFicha`, `SECOES_FICHA_INTERNO`, `requeridasPorOrigem`, `seloGradeComprado`, `desenvolvimentoCompleto`, `linhasGradeComprado`, `gradesParaBomComprado`, `gradeCompradoMudouNoServidor`, `normalizarGradeComprado`); `useGradeComprado` (`GradeComprado`, `ProdutoComprado`); `lerGradeServidorComprado` (`persistir-bom.ts`); `FichaTecnica.gradeExterna`/`marcarGradeExternaEditada`/`tocado`; `BomCapturado.gradesPayload`/`gradeExterna`/`gradeConflito`; `GradeExternaCaptura` (com `servidor`); no orquestrador a query `plan-origem-espelhos`; `SecaoBom({ oculta })`; `BomSecoes({ visiveis })`; `InfoGeraisSecao({ origemOpcoes })`; `GradeRevendaSecao({ gc, numero, selo, motivoSomenteLeitura })`; `ProdutoImportadoSecao`.

## 3. Prova — a F3.4 NÃO precisa de migration

Toda escrita da F3.4 usa função/tabela que JÁ existe e aceita o caso (texto das funções na cópia, 24/set, E no snapshot de PRODUÇÃO `savepoints/2026-09-22-pre-unificacao/funcoes.sql`: `_salvar_modelo_bom_core` sem nenhuma menção a `origem`; `_salvar_grade_revenda_core` com `IF v_origem IS DISTINCT FROM 'revenda'`; `_enviar_modelo_para_cad_core` pré-F1 também sem checar origem — na cópia ele é o da F1, idem):

| Escrita | Caminho | Por que serve |
|---|---|---|
| Grade da REVENDA | `salvar_grade_revenda` (como hoje) | `origem='revenda'` + módulo `produto_acabado` |
| Grade do IMPORTADO | `salvar_modelo_bom` (`_grades` = grade cor × tamanho) | `_salvar_modelo_bom_core` não olha a origem; módulo `criacao`; protegido pelo `.eq("rev")` do header + conferência com a grade do servidor LIDA no Salvar junto com o `rev` (Task 4/5 — G-plano F3.4 R1) |
| BOM do comprado (aviamentos, insumos, tecidos se `s2`) | `salvar_modelo_bom` + diff de `modelo_etiquetas` (como o interno) | idem; `_grades` = `gradesPayload` (nunca apaga a grade do comprado) |
| Auto-criar Produto Importado | `salvar_produto_importado(_id null, _dados, [], [], _rev_base null)` + `UPDATE produtos_importados SET modelo_id` | RPC aceita variantes/etapas vazias (Σ% só com etapa); RLS `tenant_update` + `modgate_pi_upd`; `enforce_unique_fk` barra 2º vínculo; foto nula não mexe no modelo |
| Enviar à Explosão do comprado (D2 = A) | `enviar_modelo_para_cad` (F3.3) | `_enviar_modelo_para_cad_core` não olha a origem; o recebimento da OC reusa o `cad` já existente (upsert) |
| Header/MO/`custo_peca_previsto`/`marcar_revisao_por_mudanca` | os mesmos da F3.2/F3.3 | inalterados |

Leituras novas: `produtos_acabados`/`produtos_importados` com embeds de variantes e OCs (FKs únicas — §1) — a grade (`plan-comprado-produto`) e os DOIS espelhos da regra da Origem (`plan-origem-espelhos`, R3); `modelo_tecidos` (existe algum?); no Salvar do comprado, `modelos?select=rev,grades:modelo_grades(…)` (a leitura fresca da R1 — embed já usado em `PlanTecidoSheet.tsx:457`). Nada toca `salvar_cad_completo` para comprado. **Único caminho que exigiria banco**: a D3 opção (B) — fora deste plano; se o dono escolher (B), vira etapa própria com G-migration, inverso e OK do dono.

## 4. Mapa de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `src/components/planejamento/planejamento-detail/comprado.ts` | criar | regras puras do comprado (origem com os dois espelhos e a edição pendente, seções, requisitos, selo da grade, completude, grade p/ o BOM, conflito da grade) |
| `src/components/planejamento/planejamento-detail/useGradeComprado.ts` | criar | grade cor × tamanho (revenda E importado) + produto espelho por origem (texto movido do `useRevendaPlanejamento`) |
| `src/components/planejamento/planejamento-detail/useRevendaPlanejamento.ts` | modificar | perde a grade (fica o preço/markup e o "criar produto acabado") |
| `src/components/planejamento/planejamento-detail/RevendaSetores.tsx` | modificar | `GradeRevendaSecao` por origem (+ selo, só-leitura) e `ProdutoImportadoSecao` |
| `src/components/planejamento/planejamento-detail/ficha/envio-explosao.ts` | modificar | "Para enviar, falta" com `campoVisivel` e `secaoGrade` |
| `src/components/planejamento/planejamento-detail/ficha/useFichaTecnica.ts` | modificar | ficha p/ comprado: habilitada, projeção sem grade, sem prefill, CAD nunca grava, requisitos filtrados, captura com a grade externa, `marcarGradeExternaEditada` |
| `src/components/planejamento/planejamento-detail/ficha/useFichaBom.ts` | modificar | `gradeExterna` desliga os acoplamentos Tecido 1 ↔ grade |
| `src/components/planejamento/planejamento-detail/ficha/ficha-calc.ts` | modificar | `GradeExternaCaptura`; `BomCapturado.gradesPayload/gradeExterna/gradeConflito` |
| `src/components/planejamento/planejamento-detail/ficha/persistir-bom.ts` | modificar | `_grades` = `gradesPayload` quando houver; `lerGradeServidorComprado` (leitura fresca `rev` + grade — R1) |
| `src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts` | modificar | captura com a grade externa, conflito da grade do importado, baseline pós-BOM, auto-criar Produto Importado, invalidações |
| `src/components/planejamento/planejamento-detail/InfoGeraisSecao.tsx` | modificar | Select "Origem" com as opções da D1 + motivo |
| `src/components/planejamento/planejamento-detail/ficha/secoes/SecaoBom.tsx` | modificar | prop `oculta` |
| `src/components/planejamento/planejamento-detail/ficha/secoes/BomSecoes.tsx` | modificar | `visiveis` (seções por origem) + nota do CAD do comprado |
| `src/components/planejamento/PlanejamentoDetail.tsx` | modificar | fiação: `piOn`, `useGradeComprado`, origem (+ `plan-origem-espelhos` e edição pendente), `vis` por origem, preço/`custosBom` só interno, selos por origem, Enviar do comprado (D2), Importar só interno, seções do produto |
| `tests/unit/planejamento-comprado.test.ts` | criar | testes puros de `comprado.ts` |
| `tests/unit/planejamento-envio-explosao.test.ts` | modificar | + describe do comprado |
| `tests/e2e/f34-qa.spec.ts` | criar (NÃO versionar) | QA na cópia (guarda invertida; S1–S9 + S2b/S5b simulado; E1–E2 reais; E3 PULADO — R4) + smoke só-leitura |
| `.superpowers/f34/{BASE,arqs-f34.txt,gates.sh,gate-f31.sh,gate-f32.sh,gate-f33.sh}` (fora do git) | criar | linha de base e gates |
| `banco-local/app-teste-variantes/criar-variante.sh` (fora do repo) | modificar (Task 9, com backup) | aceita a porta `5183` |

## 5. Revisão (política SDD)

| Task | Revisão |
|---|---|
| 1, 2 | **Lote A** — 1 revisão Opus para as 2 (puros + testes; `pendenciasEnvioExplosao` × Dev :1577-1595) |
| 3 | **Individual Opus** (GRADE: texto movido, seed/rev refs, queryKey, produto por origem) |
| 4 + 5 | **Individual Opus, juntas** (SAVE/COLAB/GRADE: projeção, captura, `gradesPayload`, conflito, P0409, CAD barrado, auto-criação) |
| 6 | **Lote B** — 1 revisão Opus (Origem: UI + regras da D1) |
| 7 | **Individual Opus** (orquestrador: seções por origem, preço, selos, Enviar do comprado, Importar) |
| 8, 9, 10 | controlador + guardião (snapshot, QA, G-commit/G-fase, merge) |

Checklist de toda revisão = `code-reviewer` + guardião (G-commit): tenant, invariantes #4/#8/#12/#13, queryKeys próprias (`plan-comprado-produto`, `plan-origem-tem-tecidos`, `plan-origem-espelhos`; `modelo-grades-revenda` com a MESMA forma), invalidações, `canEdit("criacao_desenvolvimento")`, guarda de não-salvo, rev/P0409, "a grade do comprado nunca é apagada nem regravada velha" (leitura fresca com o `rev`, falha fechada — R1), "nunca dois espelhos" (R3), "a Origem não muda com edição pendente" (R7), "CAD do comprado nunca grava", Dev intocado.

---

## Task 0: Pré-voo (sem commit)

**Files:** nenhum no git (worktree + `.superpowers/f34/`).

- [ ] **Step 1: Criar a worktree da PONTA da F3.3**

**Pré-condição de largada — OBRIGATÓRIA nos dois casos abaixo (G-plano F3.4 R2): a F3.3 com as Tasks 9 e 10 commitadas e a worktree da F3.3 limpa.**
- T9 e T10 da F3.3 commitadas em `f33/cad-acoes`: os commits `F3.3 (9)` (Enviar à Explosão, menu ⋯) e `F3.3 (10)` (Importar dados) no log da ponta, marcados DONE no ledger da F3.3 (`.superpowers/sdd/2026-09-24-planejamento-unificado-f33-cad-explosao/progress.md`).
- Worktree da F3.3 limpa: nada pendente em `src`/`supabase`/`tests`, nem arquivo novo não rastreado.
- Por quê: em 24/set a ponta era `67e363f` (T1–T8 + fixes) com a T9 em curso na worktree (4 arquivos M + 2 novos). Nascer dali deixaria de fora `MenuMaisAcoes.tsx`/`useEnviarExplosao.ts`/`useImportarDados.ts` (Step 2), 4 âncoras do Step 3 dariam 0 (as do Enviar/Importar) e o `gate-f33.sh` falharia (`<MenuMaisAcoes` 0; `PedidoSecaoContext.Provider` 0 de 2).

Cumprida a pré-condição, UMA das duas:
- (a) o diário do guardião (`.superpowers/sdd/2026-09-22-unificacao-kanban-auto/guardiao.md`) tem o **G-commit da F3.3 APROVADO** e o controlador da F3.3 passou o sha da ponta; ou
- (b) **ruling R3a** (mesmo da F3.3 — o mecanismo continua): a F3.3 ainda NÃO fechou (QA/G-commit dela em curso). A F3.4 nasce da ponta ATUAL e COMMITADA de `f33/cad-acoes`. O controlador registra em `.superpowers/f34/rebase-f33.md`: "nasceu de `<sha>` antes do G-commit da F3.3; rebase obrigatório quando ela fechar (Task 0 Step 5 — recontagem das âncoras por `git show <ponta>` + `rebase --onto`)".

Sem a pré-condição, ou sem (a) nem (b): PARE.

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp"
PONTA="<sha passado pelo controlador da F3.3 depois do G-commit dela>"   # pré-condição (a)
# PONTA="$(git rev-parse f33/cad-acoes)"                                  # pré-condição (b) — ruling R3a (usar ESTA no lugar da de cima)
git rev-parse --verify "$PONTA^{commit}" && git merge-base --is-ancestor "$PONTA" f33/cad-acoes && echo "ponta da F3.3: ok"
# R2 do G-plano F3.4 — T9 e T10 da F3.3 NA PONTA e a worktree da F3.3 LIMPA (qualquer "PARE" abaixo: não seguir).
for n in 9 10; do git log --oneline "$PONTA" | grep -qF "F3.3 ($n)" && echo "F3.3 ($n) na ponta: ok" || echo "F3.3 ($n) AUSENTE na ponta — PARE"; done
[ -z "$(git -C .claude/worktrees/f33-cad-acoes status --porcelain -- src supabase tests)" ] && echo "worktree da F3.3 limpa: ok" || echo "worktree da F3.3 com alteração pendente — PARE"
git log --oneline -30 "$PONTA" | grep -E "F3\.3 \(|f33|F3\.2 \(" | head -20
git worktree add ".claude/worktrees/f34-comprado" -b f34/comprado "$PONTA"
cd ".claude/worktrees/f34-comprado"
mkdir -p .superpowers/f34
echo "$PONTA" > .superpowers/f34/BASE
cp "/Users/sunglee/PLM + Criação/plm-pcp/.env" .env
npm ci --silent
```

Expected: `ponta da F3.3: ok`; `F3.3 (9) na ponta: ok`; `F3.3 (10) na ponta: ok`; `worktree da F3.3 limpa: ok`; os commits `F3.3 (…)` no log; `.superpowers/f34/BASE` = `$PONTA` (referência do `rebase --onto` da Task 10 — não apagar). A worktree da F3.3 só é LIDA.

- [ ] **Step 2: Conferir que a F3.3 está no HEAD e que nada da F3.4 existe**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f34-comprado"
D=src/components/planejamento/planejamento-detail
for f in $D/ficha/ficha-cad.ts $D/ficha/useFichaCad.ts $D/ficha/selos-secoes.ts $D/ficha/envio-explosao.ts $D/ficha/importar-ficha.ts \
         $D/ficha/secoes/SeloBadge.tsx $D/secoes-abertas.tsx $D/MenuMaisAcoes.tsx $D/useEnviarExplosao.ts $D/useImportarDados.ts; do
  test -f "$f" && echo "ok  $f" || echo "FALTA  $f"; done
for f in $D/comprado.ts $D/useGradeComprado.ts; do test -f "$f" && echo "JÁ EXISTE — PARE: $f"; done; echo "f34-ausente-checado"
```

Expected: 10× `ok`, nenhuma linha "JÁ EXISTE". Senão: PARE (a F3.4 nasce da ponta da F3.3). Os 3 últimos (`MenuMaisAcoes.tsx`, `useEnviarExplosao.ts`, `useImportarDados.ts`) nascem nas Tasks 9 e 10 da F3.3 — "FALTA" neles = a pré-condição do Step 1 não foi cumprida (G-plano F3.4 R2).

- [ ] **Step 3: Conferir as âncoras NA PONTA (nunca no HEAD da F3.4)**

Conta SEMPRE no commit da ponta (`git show <ponta>:<arquivo> | grep -cF`). Na 1ª vez a ponta é o `BASE`; no modo RE-CHECAGEM (Step 5 e Task 10 Step 5) é a NOVA ponta da F3.3 — a própria F3.4 muda estas âncoras de propósito. `grep -cF` (literal).

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f34-comprado"
PONTA="${PONTA:-$(cat .superpowers/f34/BASE)}"
git rev-parse --verify "$PONTA^{commit}" > /dev/null && echo "conferindo as âncoras em $PONTA"
D=src/components/planejamento/planejamento-detail; F=$D/ficha; P=src/components/planejamento/PlanejamentoDetail.tsx
conta() { printf '%s  →  %s :: %s\n' "$(git show "$PONTA:$1" | grep -cF -- "$2")" "$(basename "$1")" "$2"; }
# useRevendaPlanejamento.ts: a F3.4 o REESCREVE inteiro (Task 3) — só se estiver idêntico ao da F3.2.
git diff --quiet f19202b "$PONTA" -- $D/useRevendaPlanejamento.ts && echo "1  →  useRevendaPlanejamento.ts idêntico à F3.2 (f19202b)" || echo "0  →  useRevendaPlanejamento.ts MUDOU desde a F3.2 — PARE"
conta $F/useFichaTecnica.ts '  // Só produto interno na F3.2 (decisão F3 #4; comprado = F3.4).'
conta $F/useFichaTecnica.ts '  const habilitada = a.isEdit && !!a.modeloId && !a.isComprado && podeVerFicha;'
conta $F/useFichaTecnica.ts '    tecidosPlanejados: a.tecidosPlanejados, proporcoes: a.proporcoes, setDraftTracked: a.setDraftTracked,'
conta $F/useFichaTecnica.ts '  tecidosPlanejadosRef.current = a.tecidosPlanejados;'
conta $F/useFichaTecnica.ts '  aoRecarregarComTocadoRef.current = (servidor) => {'
conta $F/useFichaTecnica.ts '      const servidor = estadoBomDoServidor({'
conta $F/useFichaTecnica.ts '        tecidos: tec.tecidos, variantes: tec.variantes, ocLinks: oc, aviamentos: av, etiquetas: et, grades: gr,'
conta $F/useFichaTecnica.ts '    () => ({ blocks: bom.blocks, aviamentos: bom.aviamentosState, etiquetas: bom.etiquetasState, grades: bom.grades }),'
conta $F/useFichaTecnica.ts '    [bom.blocks, bom.aviamentosState, bom.etiquetasState, bom.grades],'
conta $F/useFichaTecnica.ts '  const cadGravavel = podeEditar && (dados.cadExiste || a.ordemEnviada);'
conta $F/useFichaTecnica.ts '      podeEditar: podeEditarRef.current, cadHidratado: c.hidratado, cadExiste: c.existe, ordemEnviada: c.ordemEnviada,'
conta $F/useFichaTecnica.ts '    () => requisitosUniao(a.isComprado ? dados.revendaCfg.requisitos : (dados.tenantCfg as any)?.kanban_requisitos),'
conta $F/useFichaTecnica.ts '      const e = bom.estadoRef.current;'
conta $F/useFichaTecnica.ts '      const gravar = podeEditarRef.current'
conta $F/useFichaTecnica.ts '        && ((bom.colecoesTouchadasRef.current && (base === null || snap !== base)) || bom.prefillPendenteRef.current);'
conta $F/useFichaTecnica.ts '        flags: { ...bom.flagsRef.current },'
conta $F/useFichaTecnica.ts '        cad: capturarCad(e, gravar, !!opts?.retry, opts?.proporcoes ?? a.proporcoes),'
conta $F/useFichaTecnica.ts '      const vivo = snapshotBom(bom.estadoRef.current);'
conta $F/useFichaTecnica.ts '  capturar: (custosAdicionais: unknown, opts?: { retry?: boolean; proporcoes?: Record<string, number> }) => BomCapturado;'
conta $F/useFichaTecnica.ts '    cadGravavel, cadAntesDaOrdem: !dados.cadExiste && !a.ordemEnviada,'
conta $F/useFichaTecnica.ts '  type AviamentoRowDb, type BomCapturado, type EstadoBom, type EtiquetaRowDb, type GradeRowDb, type OcLinkRowDb,'
conta $F/useFichaTecnica.ts 'import { requisitosUniao, seloSecaoBom, type SecaoBomKey, type SeloSecao } from "./selos-bom";'
conta $F/useFichaTecnica.ts 'const SEM_LABELS: Record<string, string> = {};'
conta $F/useFichaTecnica.ts '  const save: FichaSave = {'
conta $F/useFichaBom.ts 'export function useFichaBom({ modeloId, habilitada, dados, tecidosPlanejados, proporcoes, setDraftTracked, aoRecarregarComTocado, aoMudarBloco }: {'
conta $F/useFichaBom.ts '  aoMudarBloco?: (tipo: string, numero: number, patch: PatchBlocoCad) => void;'
conta $F/useFichaBom.ts '    if (!hidratado || tecido1VarianteIds.length === 0) return;'
conta $F/useFichaBom.ts '  }, [tecido1VarianteIds, hidratado, grades]);'
conta $F/useFichaBom.ts '    if (isTecido1 && patch.artigo_id !== undefined && patch.artigo_id !== target.artigo_id) {'
conta $F/useFichaBom.ts '    if (isTecido1 && !value) {'
conta $F/useFichaBom.ts '    marcarTocado, cargaSeq, aplicarConsumoDoCad,'
conta $F/ficha-calc.ts '  cad: CadCapturado;'
conta $F/ficha-calc.ts 'export type BomCapturado = {'
conta $F/persistir-bom.ts '    _grades: montarGradesPayload(bom.estado.grades) as any,'
conta $F/persistir-bom.ts '  type BomCapturado,'
conta $F/envio-explosao.ts ' * "Para enviar, falta" (Dev :1576-1595, fluxo INTERNO — o Enviar só aparece p/ interno na F3.3). Cada pendência aponta'
conta $F/envio-explosao.ts '  rotuloRef: string;'
conta $F/envio-explosao.ts '  const temTecidoComVariante = i.blocks.some((b) => b.tipo === "tecido" && !!b.artigo_id && b.variantes.some((v) => !!v));'
conta $F/envio-explosao.ts '  if (piloto3Aberto && vazio(d.data_piloto3)) out.push({ label: "Data Piloto 3", secao: "desenvolvimento" });'
conta $D/usePlanejamentoSave.ts '      const bom = fichaRef.current.capturar(d.custos_adicionais, { retry: retryRef.current, proporcoes: d.proporcoes });'
conta $D/usePlanejamentoSave.ts '          fichaRef.current.bomGravado(bom);'
conta $D/usePlanejamentoSave.ts '      let autoProduto: { criou: boolean; semColecao: boolean } | null = null;'
conta $D/usePlanejamentoSave.ts '          console.error("Auto-criação do produto acabado (revenda) falhou — save do card mantido:", autoErr);'
conta $D/usePlanejamentoSave.ts "          toast.success('Produto criado no Produto Acabado — defina a coleção do modelo pra ele aparecer no canvas.');"
conta $D/usePlanejamentoSave.ts '        qc.invalidateQueries({ queryKey: ["pa-produto-modelo", modeloId] });'
conta $D/usePlanejamentoSave.ts '  modeloId, isEdit, isRevenda, paOn, podeEditarPreco, podeVerCustos, podeEditarDev, refEditavel, categorias,'
conta $D/usePlanejamentoSave.ts '  gradeRevenda, setGradeRevenda, gradeRevendaDirty, gradeRevendaBaseRef, gradeRevendaRevRef, buildLinhasGradeRevenda,'
conta $D/usePlanejamentoSave.ts '  buildLinhasGradeRevenda: () => { variante_numero: number; grades: Record<string, number>; grade_total: number }[];'
conta $D/usePlanejamentoSave.ts '  paOn: boolean;'
conta $D/usePlanejamentoSave.ts 'import { ehOrigemComprada } from "@/lib/origem";'
conta $D/usePlanejamentoSave.ts '          if (!existente) {'
conta $D/usePlanejamentoSave.ts 'let revParaHeader = revRef.current;'
conta $D/RevendaSetores.tsx '/** Seção "Grade" cor×tamanho do card revenda (lê/grava `modelo_grades` pelo Salvar da página). */'
conta $D/RevendaSetores.tsx 'export function GradeRevendaSecao({ rv, numero }: { rv: RevendaPlanejamento; numero?: number }) {'
conta $D/RevendaSetores.tsx 'import { type RevendaPlanejamento } from "@/components/planejamento/planejamento-detail/useRevendaPlanejamento";'
conta $D/InfoGeraisSecao.tsx '  draft, setDraftTracked, grupoSel, setGrupoSel, grupos, categorias, estilistas, sub1Opts, sub2Opts, fl, numero, selo,'
conta $D/InfoGeraisSecao.tsx '  selo?: React.ReactNode;'
conta $D/InfoGeraisSecao.tsx '                    <SelectItem value="revenda">Revenda</SelectItem>'
conta $D/InfoGeraisSecao.tsx 'import { Secao, FieldText, FieldSelect } from "@/components/planejamento/planejamento-detail/campos";'
conta $F/secoes/SecaoBom.tsx 'export function SecaoBom({ id, titulo, numero, selo, origemDev = true, defaultOpen = false, open: openProp, onOpenChange, children }: {'
conta $F/secoes/SecaoBom.tsx '  onOpenChange?: (v: boolean) => void;'
conta $F/secoes/SecaoBom.tsx '    <section ref={ref} className="space-y-3" data-secao={id}>'
conta $F/secoes/BomSecoes.tsx 'import { SeloBadge } from "./SeloBadge";'
conta $F/secoes/BomSecoes.tsx 'export function BomSecoes({ ficha, modeloId, estoque, ordemEnviada, proporcoes, numeros }: {'
conta $F/secoes/BomSecoes.tsx '  numeros?: Partial<Record<SecaoSheetKey, number>>;'
conta $F/secoes/BomSecoes.tsx '  const { estado, handlers, dados } = ficha;'
conta $F/secoes/BomSecoes.tsx 'titulo="Tecidos / Forros / Entretelas" numero={numeros?.tecidos}'
conta $F/secoes/BomSecoes.tsx 'titulo="Aviamentos" numero={numeros?.aviamentos}'
conta $F/secoes/BomSecoes.tsx 'titulo="Insumos" numero={numeros?.insumos}'
conta $F/secoes/BomSecoes.tsx 'titulo="Grade" numero={numeros?.grade}'
conta $F/secoes/BomSecoes.tsx 'titulo="CAD" numero={numeros?.cad}'
conta $F/secoes/BomSecoes.tsx '              {ficha.cadAntesDaOrdem && ('
conta $P 'import { PrecoRevendaBloco, ProdutoAcabadoSecao, GradeRevendaSecao } from "@/components/planejamento/planejamento-detail/RevendaSetores";'
conta $P 'import { useRevendaPlanejamento } from "@/components/planejamento/planejamento-detail/useRevendaPlanejamento";'
conta $P 'import { revendaCampoVisivel } from "@/lib/revenda-config";'
conta $P '  const paOn = isModuleEnabled("produto_acabado");'
conta $P '  const previstoBase = !veCustos ? 0 : ficha.carregado ? previstoDaFicha(ficha.totais) : Number(custoData?.previsto) || 0;'
conta $P '    modeloId, isEdit, isRevenda, paOn, draft, baseRevendaMarkup, grupos, categorias,'
conta $P '    tenantIdAtivo, revRef, qc, navigate, contexto, onClose,'
conta $P '    produtoRevenda, buildLinhasGradeRevenda,'
conta $P '    modeloId, isEdit, isRevenda, paOn, podeEditarPreco, podeVerCustos, podeEditarDev, categorias,'
conta $P '    gradeRevenda, setGradeRevenda, gradeRevendaDirty, gradeRevendaBaseRef, gradeRevendaRevRef, buildLinhasGradeRevenda,'
conta $P '            sub1Opts={sub1Opts} sub2Opts={sub2Opts} fl={fl}'
conta $P '  const vis: Record<SecaoSheetKey, boolean> = {'
conta $P '    tecidos: fichaVisivel, aviamentos: fichaVisivel, insumos: fichaVisivel, grade: fichaVisivel, cad: fichaVisivel,'
conta $P '    produto_acabado: isEdit && isRevenda && paOn,'
conta $P '    grade_revenda: isEdit && isRevenda && paOn && !!produtoRevenda,'
conta $P '  const selos = selosSecoesSheet({'
conta $P '    requeridas: requisitosUniao(isComprado ? kanbanCard.revendaCfg.requisitos : kanbanCard.kanbanCfg.kanban_requisitos),'
conta $P '    desenvolvimentoCompleto: !!draft.modelista_id && !!draft.piloteiro1_id && !!draft.data_piloto1 && !!draft.data_desenho_tecnico,'
conta $P '    preco: isRevenda ? null : { efetivo: precoEfetivo, markup: markupReal },'
conta $P '  const seloDe = (k: SecaoSheetKey) => {'
conta $P '          {vis.tecidos && modeloId && ('
conta $P '              numeros={numeros}'
conta $P '            <ProdutoAcabadoSecao rv={revenda} contexto={contexto} modeloId={modeloId} navigate={navigate} numero={numeros.produto_acabado} />'
conta $P '            <GradeRevendaSecao rv={revenda} numero={numeros.grade_revenda} />'
conta $P '                custosBom={ficha.habilitada && ficha.carregado && veCustos ? {'
# ⚠️ G-plano F3.4 R2 — as 4 âncoras abaixo (Enviar à Explosão e Importar) nascem nas Tasks 9 e 10 da F3.3: em 6fac668/67e363f
#    contam 0. Só dão 1 com a pré-condição do Step 1 cumprida (T9 e T10 commitadas na ponta).
conta $P '  const mostraEnviarExplosao = fichaVisivel && enviada && !enviadoCad;'
conta $P '    ? pendenciasEnvioExplosao({ draft, blocks: ficha.estado.blocks, grades: ficha.estado.grades, rotuloRef: fl("ref") })'
conta $P '              onImportar={ficha.podeEditar ? () => importar.setAberto(true) : undefined}'
conta $P '                O card é salvo e vai para a Explosão (próxima etapa) com os tecidos, variantes, grade e CAD atuais. Na Explosão'
```

Expected: `conferindo as âncoras em <sha>`, a linha `useRevendaPlanejamento.ts idêntico` e TODAS as contagens = 1. Qualquer divergência: **não adaptar por conta própria** — registrar o trecho real (`git show "$PONTA:<arq>" | grep -nF -- '<pedaço>'`) em `.superpowers/sdd/2026-09-24-planejamento-unificado-f34-comprado/ancoras-divergentes.md` e reportar ao controlador; a task que usa a âncora aplica a MESMA intenção sobre o texto real, com o registro (protocolo da F3.2/F3.3).

Arquivos que a F3.4 CONSOME ou EDITA do texto da F3.3 (lista do `git diff` do modo re-checagem):

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f34-comprado"
D=src/components/planejamento/planejamento-detail; F=$D/ficha
echo "$F/useFichaTecnica.ts $F/useFichaBom.ts $F/ficha-calc.ts $F/persistir-bom.ts $F/envio-explosao.ts $F/selos-secoes.ts $F/selos-bom.ts \
  $F/secoes/BomSecoes.tsx $F/secoes/SecaoBom.tsx $D/usePlanejamentoSave.ts $D/useRevendaPlanejamento.ts $D/RevendaSetores.tsx \
  $D/InfoGeraisSecao.tsx $D/campos.tsx src/components/planejamento/PlanejamentoDetail.tsx tests/unit/planejamento-envio-explosao.test.ts" \
  > .superpowers/f34/arqs-f34.txt
```

- [ ] **Step 4: Gates de base + scripts de gate**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f34-comprado"
cp "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f33-cad-acoes/.superpowers/f33/gate-f31.sh" .superpowers/f34/gate-f31.sh
cp "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f33-cad-acoes/.superpowers/f33/gate-f32.sh" .superpowers/f34/gate-f32.sh
npx tsc --noEmit 2>&1 | tail -3
npm run build 2>&1 | tail -3; git checkout -- src/routeTree.gen.ts 2>/dev/null || true
env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit > .superpowers/f34/unit-base.log 2>&1; tail -6 .superpowers/f34/unit-base.log
grep -E "^ FAIL " .superpowers/f34/unit-base.log | sed -E 's/ +[0-9]+ms$//' | sort -u > .superpowers/f34/unit-fail-base.txt; cat .superpowers/f34/unit-fail-base.txt
```

Expected: tsc sem erro; build ok; unit com N passed e as falhas HERDADAS (hoje 2, do anti-drift — `DocPrintCasca`/`OcDocumentoPrint`) em `unit-fail-base.txt`.

Criar `.superpowers/f34/gate-f33.sh`:

```bash
#!/usr/bin/env bash
# 7º gate da F3.4 — "F3.3 preservada". Confere, no texto, o que a F3.3 garante e o tsc não pega (chamadas que podem
# sumir sem erro de tipo, a ordem da cadeia do Salvar, o atalho do Dev que saiu). SAI COM CÓDIGO 1 quando falha —
# gate falhou = PARE, não commitar.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
D=src/components/planejamento/planejamento-detail; F=$D/ficha; P=src/components/planejamento/PlanejamentoDetail.tsx
ok=1
exige() { local n; n=$(grep -cF -- "$3" "$2"); [ "$n" = "$1" ] || { echo "F3.3: esperado $1 de '$3' em $2 (achou $n)"; ok=0; }; }
exige 1 "$D/usePlanejamentoSave.ts" 'await persistirCad(modeloId, bom.cad);'
exige 1 "$F/persistir-bom.ts" 'rpc("salvar_cad_completo"'
exige 1 "$F/useFichaTecnica.ts" 'cadVelhoRef.current = true;'
exige 1 "$F/useFichaTecnica.ts" 'recarregando: c.recarregando || cadVelhoRef.current,'
exige 1 "$D/useEnviarExplosao.ts" 'rpc("enviar_modelo_para_cad"'
exige 1 "$F/secoes/BomSecoes.tsx" '<CadTecidosSection'
exige 1 "$P" '<MenuMaisAcoes'
exige 2 "$P" 'PedidoSecaoContext.Provider'
exige 1 "$P" '{ dialogNovo: !isEdit }'
exige 0 "$P" '<Secao titulo='
[ -z "$(grep -rn 'verDevModeloId\|onVerDev\|onAbrirDev\|Abrir no Desenvolvimento\|ver no Desenvolvimento' src)" ] || { echo "F3.3: atalho ao Desenvolvimento voltou"; ok=0; }
awk '/await persistirBom\(modeloId, bom\);/{a=NR} /await persistirCad\(modeloId, bom\.cad\);/{b=NR} /salvar_modelo_servico_mo/{c=NR} END{exit !(a && b && c && a<b && b<c)}' "$D/usePlanejamentoSave.ts" \
  || { echo "F3.3: ordem BOM → CAD → MO quebrada"; ok=0; }
if [ "$ok" = 1 ]; then echo "F3.3 preservada: ok"; else echo "F3.3 QUEBRADA — PARE"; exit 1; fi
```

Criar `.superpowers/f34/gates.sh`:

```bash
#!/usr/bin/env bash
# Gates de TODO commit de código da F3.4 (sem banco). Uso: bash .superpowers/f34/gates.sh → "GATES F3.4: ok" e código 0.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
falha() { echo "GATE FALHOU: $1"; exit 1; }
npx tsc --noEmit > .superpowers/f34/tsc.log 2>&1 || { tail -20 .superpowers/f34/tsc.log; falha "tsc"; }
npm run build > .superpowers/f34/build.log 2>&1 || { tail -20 .superpowers/f34/build.log; falha "build"; }
git checkout -- src/routeTree.gen.ts 2>/dev/null || true
env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit > .superpowers/f34/unit.log 2>&1
grep -qE "Test Files .*passed" .superpowers/f34/unit.log || { tail -20 .superpowers/f34/unit.log; falha "unit (sem resumo)"; }
grep -E "^ FAIL " .superpowers/f34/unit.log | sed -E 's/ +[0-9]+ms$//' | sort -u > .superpowers/f34/unit-fail-agora.txt
diff -q .superpowers/f34/unit-fail-base.txt .superpowers/f34/unit-fail-agora.txt > /dev/null \
  || { diff .superpowers/f34/unit-fail-base.txt .superpowers/f34/unit-fail-agora.txt; falha "unit (falhas ≠ linha de base)"; }
[ -z "$(git diff --name-only savepoint-pre-unificacao-2026-09-22 -- src/components/desenvolvimento/ src/components/producao/cad/CadTecidosSection.tsx)" ] \
  || falha "Dev/CadTecidosSection mudou (decisão travada 8)"
[ -z "$(git diff --name-only "$(cat .superpowers/f34/BASE)" -- src/components/producao/ src/components/shared/ModeloObservacoes.tsx \
  src/lib/kanban-condicoes.ts src/lib/revenda-config.ts src/lib/origem.ts src/lib/produto-acabado.ts src/lib/artigo-label.ts \
  src/components/produto-acabado/ src/components/produto-importado/ src/components/oc-p-acabado/ supabase tests/integration tests/fixtures)" ] \
  || falha "arquivo intocável mudou desde o BASE"
bash .superpowers/f34/gate-f31.sh || falha "F3.1 preservada"
bash .superpowers/f34/gate-f32.sh || falha "F3.2 preservada"
bash .superpowers/f34/gate-f33.sh || falha "F3.3 preservada"
echo "GATES F3.4: ok"
```

```bash
chmod +x .superpowers/f34/*.sh
bash .superpowers/f34/gates.sh; echo "código=$?"
```

Expected: `F3.1 preservada: ok`, `F3.2 preservada: ok`, `F3.3 preservada: ok`, `GATES F3.4: ok`, `código=0`. Código 1 já aqui = a F3.4 nasceu de um ponto errado: PARE e reporte.

- [ ] **Step 5: Re-checagem quando a F3.3 fechar (SÓ se a F3.4 nasceu pelo ruling R3a — Step 1 (b))**

Quando: assim que o guardião aprovar o G-commit da F3.3 (ponta FINAL), ANTES da próxima task da F3.4 — nunca no meio de uma task. Sem git stash: a worktree tem de estar limpa.

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f34-comprado"
git status --porcelain -- src tests | grep . && echo "WORKTREE SUJA — PARE (commite a task em curso; nunca stash)"
BASE_ANTERIOR="$(cat .superpowers/f34/BASE)"
export PONTA="<sha da ponta FINAL da F3.3, passado pelo controlador dela depois do G-commit>"
git merge-base --is-ancestor "$BASE_ANTERIOR" "$PONTA" && echo "a ponta nova descende do BASE: ok"
ARQS_F34="$(cat .superpowers/f34/arqs-f34.txt)"
git diff --stat "$BASE_ANTERIOR" "$PONTA" -- $ARQS_F34
git diff "$BASE_ANTERIOR" "$PONTA" -- $ARQS_F34 > .superpowers/f34/diff-f33-pos-base.patch
git log --oneline "$BASE_ANTERIOR..HEAD" | tee .superpowers/f34/commits-f34-antes-do-rebase.txt | wc -l
git rebase --onto "$PONTA" "$BASE_ANTERIOR" f34/comprado
echo "$PONTA" > .superpowers/f34/BASE
cp "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f33-cad-acoes/.superpowers/f33/gate-f31.sh" .superpowers/f34/gate-f31.sh
cp "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f33-cad-acoes/.superpowers/f33/gate-f32.sh" .superpowers/f34/gate-f32.sh
bash .superpowers/f34/gates.sh; echo "código=$?"
```

Expected: `a ponta nova descende do BASE: ok`; o Step 3 com a NOVA ponta (`PONTA` exportado) dá tudo = 1; rebase sem conflito ou com conflito resolvido PRESERVANDO o texto final da F3.3 (é contrato) e aplicando por cima a MESMA intenção da task da F3.4; `GATES F3.4: ok`. Para cada arquivo do `git diff --stat`, re-revisar (Opus) as tasks da F3.4 JÁ commitadas que o editam (mapa §4), com o `.patch` anexado. Registrar em `.superpowers/f34/rebase-f33.md`: BASE antigo → novo, arquivos mudados, conflitos e resolução, âncoras divergentes, tasks re-revisadas e o custo. Se a F3.3 ganhar commits DEPOIS disto, repetir este Step.

---

## Task 1: `comprado.ts` — regras puras do produto comprado  *(Lote A)*

**Files:**
- Create: `src/components/planejamento/planejamento-detail/comprado.ts`
- Test: `tests/unit/planejamento-comprado.test.ts`

**Interfaces:**
- Consumes: `REVENDA_COND_NA` (`@/lib/kanban-condicoes`, só importar); `normalizarOrigem`, `Origem` (`@/lib/origem`); `GradeRow` (Dev `modelo-detail/types`, só tipo); `Draft`; `seloPorChaves`, `SeloSecao` (`./ficha/selos-bom`, F3.3); `GradeRowDb` (`./ficha/ficha-calc`, só tipo).
- Produces: `OpcaoOrigem = { value: Origem; label: string; disabled: boolean; motivo: string | null }`; `EspelhoProduto = { existe: boolean; temPedido: boolean }`; `EspelhosCard = { acabado: EspelhoProduto; importado: EspelhoProduto | null }` (`importado: null` = indeterminado — R3); `SEM_ESPELHOS`; `espelhosDoCard(i: { acabados: { ocs: { id: string }[] | null }[]; importados: { ocs: { id: string }[] | null }[] | null }): EspelhosCard`; `MOTIVO_EDICAO_PENDENTE` (R7); `motivoTrocaOrigem(i: { de: Origem; para: Origem; piOn: boolean; temTecidos: boolean; espelhos: EspelhosCard | null }): string | null`; `opcoesOrigem(i: { isEdit: boolean; salva: string | null | undefined; atual: string | null | undefined; piOn: boolean; temTecidos: boolean; espelhos: EspelhosCard | null; edicaoPendente: boolean }): OpcaoOrigem[]`; `SecoesFicha = { tecidos; aviamentos; insumos; gradeTecido; cad; gradeComprado: boolean }`; `SECOES_FICHA_INTERNO`; `secoesFicha(isComprado: boolean, campoVisivel: (key: string) => boolean): SecoesFicha`; `requeridasPorOrigem(isComprado: boolean, requeridas: ReadonlySet<string>): Set<string>`; `seloGradeComprado(i: { requeridas: ReadonlySet<string>; satisfeitas: Record<string, boolean> | null; totalGeral: number; nVariantes: number }): SeloSecao`; `desenvolvimentoCompleto(d: Pick<Draft, "modelista_id" | "piloteiro1_id" | "data_piloto1" | "data_desenho_tecnico">, campoVisivel: (key: string) => boolean): boolean`; `linhasGradeComprado(g: Record<number, Record<string, number>>): GradeRow[]`; `normalizarGradeComprado(g: Record<number | string, Record<string, number>>): string`; `gradeCompradoDoServidor(rows: GradeRowDb[]): Record<number, Record<string, number>>`; `gradeCompradoMudouNoServidor(baseJson: string, servidor: GradeRowDb[]): boolean`; `gradesParaBomComprado(i: { editada: boolean; rascunho: GradeRow[]; servidor: GradeRowDb[] }): GradeRow[]`.

- [ ] **Step 1: Escrever o teste (falha: módulo inexistente)**

Criar `tests/unit/planejamento-comprado.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  opcoesOrigem, motivoTrocaOrigem, espelhosDoCard, SEM_ESPELHOS, MOTIVO_EDICAO_PENDENTE, secoesFicha, SECOES_FICHA_INTERNO,
  requeridasPorOrigem, seloGradeComprado, desenvolvimentoCompleto, normalizarGradeComprado, gradeCompradoMudouNoServidor,
  gradesParaBomComprado, linhasGradeComprado,
} from "@/components/planejamento/planejamento-detail/comprado";

// F3.4 — produto COMPRADO (revenda/importado) no Sheet unificado do Planejamento. Decisões F3 #3 (Origem "Importado"),
// #4 (a grade cor × tamanho é a fonte única), #8 (seções pelo "Fluxo de Revenda"), D1 do plano F3.4 (troca de Origem) e as
// ressalvas R3 (nunca dois espelhos — invariante #13) e R7 (edição pendente) do G-plano F3.4.
describe("opcoesOrigem / motivoTrocaOrigem (D1 + R3/R7 do G-plano F3.4)", () => {
  const nenhum = { existe: false, temPedido: false };
  const base = { isEdit: true, salva: "interno", atual: "interno", piOn: true, temTecidos: false, espelhos: SEM_ESPELHOS, edicaoPendente: false };
  it("interno sem tecido: as 3 origens liberadas", () => {
    expect(opcoesOrigem(base).map((o) => [o.value, o.disabled])).toEqual([["interno", false], ["revenda", false], ["importado", false]]);
  });
  it("interno COM tecido no BOM: Revenda e Importado travados, com o motivo", () => {
    const out = opcoesOrigem({ ...base, temTecidos: true });
    expect(out.find((o) => o.value === "revenda")?.disabled).toBe(true);
    expect(out.find((o) => o.value === "importado")?.motivo).toMatch(/^Tire os tecidos/);
    expect(out.find((o) => o.value === "interno")?.disabled).toBe(false);
  });
  it("módulo Produto Importado desligado: 'Importado' não aparece; 'Revenda' segue como hoje (sem regressão)", () => {
    expect(opcoesOrigem({ ...base, piOn: false, espelhos: { acabado: nenhum, importado: null } }).map((o) => [o.value, o.disabled]))
      .toEqual([["interno", false], ["revenda", false]]);
  });
  it("R3 — card JÁ importado com o módulo desligado: a opção aparece (é a atual) e a SAÍDA trava (produto ilegível = indeterminado)", () => {
    const out = opcoesOrigem({ ...base, piOn: false, salva: "importado", atual: "importado", espelhos: { acabado: nenhum, importado: null } });
    expect(out.map((o) => o.value)).toEqual(["interno", "revenda", "importado"]);
    expect(out.find((o) => o.value === "importado")?.disabled).toBe(false);
    expect(out.find((o) => o.value === "revenda")?.motivo).toMatch(/desligado/);
    expect(out.find((o) => o.value === "interno")?.disabled).toBe(true);
  });
  it("R3 — Revenda → Importado com o módulo desligado: travada", () => {
    expect(motivoTrocaOrigem({ de: "revenda", para: "importado", piOn: false, temTecidos: false, espelhos: { acabado: nenhum, importado: null } }))
      .toMatch(/desligado/);
  });
  it("revenda com pedido (OC): a origem não muda mais (D1 (i))", () => {
    const out = opcoesOrigem({ ...base, salva: "revenda", atual: "revenda", espelhos: { acabado: { existe: true, temPedido: true }, importado: nenhum } });
    expect(out.find((o) => o.value === "interno")?.motivo).toMatch(/pedido \(OC\)/);
    expect(out.find((o) => o.value === "revenda")?.disabled).toBe(false);
  });
  it("R3 — revenda com produto e sem pedido: volta p/ interno, mas não vira importado (dois espelhos)", () => {
    const out = opcoesOrigem({ ...base, salva: "revenda", atual: "revenda", espelhos: { acabado: { existe: true, temPedido: false }, importado: nenhum } });
    expect(out.find((o) => o.value === "interno")?.disabled).toBe(false);
    expect(out.find((o) => o.value === "importado")?.motivo).toMatch(/Produto Acabado/);
  });
  it("R3 — interno que JÁ foi comprado (o produto segue vinculado na tela dele) não vira da OUTRA família; da mesma, pode", () => {
    const soPa = { acabado: { existe: true, temPedido: false }, importado: nenhum };
    expect(motivoTrocaOrigem({ de: "interno", para: "importado", piOn: true, temTecidos: false, espelhos: soPa })).toMatch(/Produto Acabado/);
    expect(motivoTrocaOrigem({ de: "interno", para: "revenda", piOn: true, temTecidos: false, espelhos: soPa })).toBeNull();
    const soPi = { acabado: nenhum, importado: { existe: true, temPedido: false } };
    expect(motivoTrocaOrigem({ de: "interno", para: "revenda", piOn: true, temTecidos: false, espelhos: soPi })).toMatch(/Produto Importado/);
    expect(motivoTrocaOrigem({ de: "interno", para: "importado", piOn: true, temTecidos: false, espelhos: soPi })).toBeNull();
  });
  it("R3 — com o módulo desligado, a Revenda de um card interno segue livre (lojas sem Produto Importado não regridem)", () => {
    expect(motivoTrocaOrigem({ de: "interno", para: "revenda", piOn: false, temTecidos: false, espelhos: { acabado: nenhum, importado: null } })).toBeNull();
  });
  it("espelhos ainda carregando (ou com erro): nenhuma troca no escuro", () => {
    expect(motivoTrocaOrigem({ de: "revenda", para: "interno", piOn: true, temTecidos: false, espelhos: null })).toMatch(/Conferindo/);
    expect(motivoTrocaOrigem({ de: "interno", para: "revenda", piOn: true, temTecidos: false, espelhos: null })).toMatch(/Conferindo/);
  });
  it("R7 — edição pendente (ficha tocada ou grade editada): a Origem não muda, em NENHUM sentido, até salvar ou descartar", () => {
    const out = opcoesOrigem({ ...base, salva: "interno", atual: "importado", edicaoPendente: true });
    expect(out.find((o) => o.value === "interno")?.motivo).toBe(MOTIVO_EDICAO_PENDENTE);
    expect(out.find((o) => o.value === "revenda")?.disabled).toBe(true);
    expect(out.find((o) => o.value === "importado")?.disabled).toBe(false); // o valor atual nunca trava
  });
  it("card novo (Dialog): sem regra de troca", () => {
    expect(opcoesOrigem({ ...base, isEdit: false, temTecidos: true, espelhos: null, edicaoPendente: true }).every((o) => !o.disabled)).toBe(true);
  });
});

describe("espelhosDoCard (R3 — invariante #13)", () => {
  it("lê cada família; pedido = alguma OC; importados null = INDETERMINADO (módulo desligado — a RLS esconde as linhas)", () => {
    expect(espelhosDoCard({ acabados: [{ ocs: [{ id: "o" }] }], importados: [] }))
      .toEqual({ acabado: { existe: true, temPedido: true }, importado: { existe: false, temPedido: false } });
    expect(espelhosDoCard({ acabados: [], importados: null }))
      .toEqual({ acabado: { existe: false, temPedido: false }, importado: null });
    expect(espelhosDoCard({ acabados: [{ ocs: null }], importados: [{ ocs: [] }] }))
      .toEqual({ acabado: { existe: true, temPedido: false }, importado: { existe: true, temPedido: false } });
  });
});

describe("secoesFicha (decisões F3 #4/#8)", () => {
  it("interno: tudo, com a grade por variante do Tecido 1 e sem a cor × tamanho", () => {
    expect(secoesFicha(false, () => false)).toEqual(SECOES_FICHA_INTERNO);
    expect(SECOES_FICHA_INTERNO.gradeTecido).toBe(true);
    expect(SECOES_FICHA_INTERNO.gradeComprado).toBe(false);
  });
  it("comprado: pelo Fluxo de Revenda (s2/s3/s3e/s-cad/s4); NUNCA a grade do Tecido 1", () => {
    const cv = (k: string) => ["s3", "s3e", "s4"].includes(k);
    expect(secoesFicha(true, cv)).toEqual({ tecidos: false, aviamentos: true, insumos: true, gradeTecido: false, cad: false, gradeComprado: true });
  });
});

describe("requeridasPorOrigem", () => {
  it("comprado ignora as condições impossíveis p/ comprado (REVENDA_COND_NA); interno fica igual", () => {
    expect([...requeridasPorOrigem(true, new Set(["grade_preenchida", "tecido_com_variante", "cad_preenchido"]))]).toEqual(["grade_preenchida"]);
    expect([...requeridasPorOrigem(false, new Set(["tecido_com_variante"]))]).toEqual(["tecido_com_variante"]);
  });
});

describe("seloGradeComprado", () => {
  it("requisito grade_preenchida vence; sem requisito ⇒ informativo", () => {
    expect(seloGradeComprado({ requeridas: new Set(["grade_preenchida"]), satisfeitas: { grade_preenchida: true }, totalGeral: 0, nVariantes: 2 })).toEqual({ tone: "ok", texto: "ok" });
    expect(seloGradeComprado({ requeridas: new Set(["grade_preenchida"]), satisfeitas: { grade_preenchida: false }, totalGeral: 0, nVariantes: 2 }).tone).toBe("warn");
    expect(seloGradeComprado({ requeridas: new Set(), satisfeitas: null, totalGeral: 150, nVariantes: 2 })).toEqual({ tone: "ok", texto: "150 peças" });
    expect(seloGradeComprado({ requeridas: new Set(), satisfeitas: null, totalGeral: 1, nVariantes: 1 })).toEqual({ tone: "ok", texto: "1 peça" });
    expect(seloGradeComprado({ requeridas: new Set(), satisfeitas: null, totalGeral: 0, nVariantes: 2 })).toEqual({ tone: "warn", texto: "falta preencher" });
    expect(seloGradeComprado({ requeridas: new Set(), satisfeitas: null, totalGeral: 0, nVariantes: 0 })).toEqual({ tone: "muted", texto: "sem variantes" });
  });
  it("condições ainda não carregadas ⇒ só o informativo (nunca 'falta' no escuro)", () => {
    expect(seloGradeComprado({ requeridas: new Set(["grade_preenchida"]), satisfeitas: null, totalGeral: 10, nVariantes: 1 })).toEqual({ tone: "ok", texto: "10 peças" });
  });
});

describe("desenvolvimentoCompleto", () => {
  it("exige só o que está visível (interno = tudo, o mesmo de antes)", () => {
    const d = { modelista_id: null, piloteiro1_id: null, data_piloto1: "", data_desenho_tecnico: "" };
    expect(desenvolvimentoCompleto(d, () => true)).toBe(false);
    expect(desenvolvimentoCompleto(d, () => false)).toBe(true);
    expect(desenvolvimentoCompleto({ modelista_id: "m", piloteiro1_id: "p", data_piloto1: "2026-09-01", data_desenho_tecnico: "2026-09-01" }, () => true)).toBe(true);
  });
});

describe("grade cor × tamanho do comprado — o que o salvar_modelo_bom recebe (ele APAGA todas)", () => {
  const servidor = [{ variante_numero: 1, grades: { "38|P": 34, "40|M": 33 }, grade_total: 67 }];
  it("editada ⇒ o rascunho; não editada ⇒ o do SERVIDOR (o rascunho é semeado 1× e pode estar velho)", () => {
    const rascunho = [{ variante_numero: 1, grades: { "38|P": 40, "40|M": 33 }, grade_total: 73 }];
    expect(gradesParaBomComprado({ editada: true, rascunho, servidor })).toEqual(rascunho);
    expect(gradesParaBomComprado({ editada: false, rascunho, servidor })).toEqual(servidor);
  });
  it("normalizar ignora linha/célula zerada e a ordem das chaves", () => {
    expect(normalizarGradeComprado({ 2: { "40|M": 1, "38|P": 0 }, 1: { "38|P": 2 }, 3: { "38|P": 0 } }))
      .toBe(normalizarGradeComprado({ 1: { "38|P": 2 }, 2: { "40|M": 1 } }));
  });
  it("mudou no servidor? baseline semeado × linhas atuais (JSON inválido ⇒ mudou)", () => {
    const baseJson = JSON.stringify({ 1: { "38|P": 34, "40|M": 33 } });
    expect(gradeCompradoMudouNoServidor(baseJson, servidor)).toBe(false);
    expect(gradeCompradoMudouNoServidor(baseJson, [{ variante_numero: 1, grades: { "38|P": 35, "40|M": 33 }, grade_total: 68 }])).toBe(true);
    expect(gradeCompradoMudouNoServidor("não é json", servidor)).toBe(true);
  });
  it("linhas: total = soma das células (mesma conta do antigo buildLinhasGradeRevenda)", () => {
    expect(linhasGradeComprado({ 1: { "38|P": 2, "40|M": 3 } })).toEqual([{ variante_numero: 1, grades: { "38|P": 2, "40|M": 3 }, grade_total: 5 }]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit/planejamento-comprado.test.ts`
Expected: FAIL — o import não resolve.

- [ ] **Step 3: Implementar `comprado.ts`**

```ts
// F3.4 — regras PURAS do produto COMPRADO (revenda/importado) no Sheet unificado do Planejamento. Zero React, zero
// Supabase — tests/unit/planejamento-comprado.test.ts. Fontes: decisões F3 #3 (Origem "Importado"), #4 (a grade
// cor × tamanho é a fonte única do comprado), #8 (seções do Dev seguem o "Fluxo de Revenda"); invariante #13; D1 do
// plano F3.4 (troca de Origem). A visibilidade vem do SSOT `src/lib/revenda-config.ts` — aqui só chega o `campoVisivel`.
import { REVENDA_COND_NA } from "@/lib/kanban-condicoes";
import { normalizarOrigem, type Origem } from "@/lib/origem";
import type { GradeRow } from "@/components/desenvolvimento/modelo-detail/types";
import type { Draft } from "@/components/planejamento/modelo-shared";
import { seloPorChaves, type SeloSecao } from "./ficha/selos-bom";
import type { GradeRowDb } from "./ficha/ficha-calc";

// ── Origem (decisão F3 #3 + D1; R3/R7 do G-plano F3.4) ─────────────────────────────────────────────────────────────
export type OpcaoOrigem = { value: Origem; label: string; disabled: boolean; motivo: string | null };

/** Produto espelho do card numa das duas telas (invariante #13 — 1:1 POR TABELA, `enforce_unique_fk`). */
export type EspelhoProduto = { existe: boolean; temPedido: boolean };
/**
 * Os DOIS espelhos do card, qualquer que seja a origem (um card interno pode já ter sido comprado — o produto continua
 * vinculado na tela dele). `importado: null` = INDETERMINADO: com o módulo Produto Importado desligado a RLS RESTRICTIVE
 * `modgate_pi_*` esconde as linhas — "vazio" não prova nada. `produtos_acabados` não tem modgate: sempre legível.
 */
export type EspelhosCard = { acabado: EspelhoProduto; importado: EspelhoProduto | null };
export const SEM_ESPELHOS: EspelhosCard = { acabado: { existe: false, temPedido: false }, importado: { existe: false, temPedido: false } };
/** R7 — texto do Select travado por edição pendente (a ficha projeta pela origem do RASCUNHO; a grade segue a SALVA). */
export const MOTIVO_EDICAO_PENDENTE = "Salve (ou descarte) as edições de Tecidos/Aviamentos/Insumos/Grade antes de trocar a Origem.";

/** Linhas lidas de cada tela (`ocs` = pedidos do produto) → espelhos. `importados: null` = módulo desligado (indeterminado). */
export function espelhosDoCard(i: {
  acabados: { ocs: { id: string }[] | null }[];
  importados: { ocs: { id: string }[] | null }[] | null;
}): EspelhosCard {
  const um = (rows: { ocs: { id: string }[] | null }[]): EspelhoProduto =>
    ({ existe: rows.length > 0, temPedido: rows.some((r) => (r.ocs ?? []).length > 0) });
  return { acabado: um(i.acabados), importado: i.importados === null ? null : um(i.importados) };
}

/**
 * Por que o card NÃO pode ir de `de` para `para` (null = pode). Regras (plano F3.4 §8 D1 + G-plano F3.4 R3):
 *  • → Importado exige o módulo `produto_importado` ligado (logo, Revenda → Importado trava com ele desligado).
 *  • Espelhos ainda carregando ou com erro (`espelhos` null) ⇒ nenhuma troca no escuro.
 *  • NUNCA dois espelhos (invariante #13): ir p/ uma família com produto vinculado na OUTRA é barrado — vale também p/ o
 *    card interno que já foi comprado.
 *  • Interno → comprado: só com a seção Tecidos VAZIA — tecido no BOM reserva estoque (`_estoque_tecido_core` não filtra
 *    origem) e, num comprado, ficaria escondido reservando.
 *  • Saída de um comprado: o produto DELE tem de ser legível (importado com o módulo desligado ⇒ indeterminado ⇒ trava —
 *    logo, Importado → Revenda também trava); D1 (i) — com pedido (OC) do produto, a Origem não muda mais.
 */
export function motivoTrocaOrigem(i: {
  de: Origem; para: Origem; piOn: boolean; temTecidos: boolean;
  /** null = carregando ou com erro (falha fechada). */
  espelhos: EspelhosCard | null;
}): string | null {
  if (i.de === i.para) return null;
  if (i.para === "importado" && !i.piOn) return "O módulo Produto Importado está desligado nesta loja.";
  if (!i.espelhos) return "Conferindo o produto vinculado…";
  const { acabado, importado } = i.espelhos;
  if (i.para === "importado" && acabado.existe) {
    return "Este card tem produto vinculado no Produto Acabado — para virar Importado, exclua o produto na tela dele.";
  }
  if (i.para === "revenda" && importado?.existe) {
    return "Este card tem produto vinculado no Produto Importado — para virar Revenda, exclua o produto na tela dele.";
  }
  if (i.de === "interno") {
    return i.temTecidos ? "Tire os tecidos da seção Tecidos / Forros / Entretelas e salve antes — tecido no BOM reserva estoque." : null;
  }
  const meu = i.de === "revenda" ? acabado : importado;
  if (meu === null) return "O módulo Produto Importado está desligado nesta loja — sem conferir o produto vinculado, a Origem não muda.";
  // D1 (i) — recomendação: com pedido (OC) o comprado não volta a Interno (Revenda↔Importado já trava pelo espelho).
  if (meu.temPedido) return "O produto deste card já tem pedido (OC) — a Origem não muda mais.";
  return null;
}

/**
 * Opções do Select "Origem" (Informações Gerais). "Revenda" segue SEMPRE na lista, como hoje (InfoGeraisSecao.tsx:59-60 da
 * F3.2 — a auto-criação do Produto Acabado é que depende do módulo). "Importado" com o módulo ligado ou se o card JÁ é
 * importado (p/ exibir o valor). O valor ATUAL nunca trava. R7: com edição pendente (ficha tocada ou grade cor × tamanho
 * editada) NADA muda — nem de volta à salva: a referência do BOM foi calculada com a projeção de agora. Sem edição, as
 * regras de troca olham a origem SALVA (de onde o card vem; voltar a ela é livre); card novo não tem regra.
 */
export function opcoesOrigem(i: {
  isEdit: boolean; salva: string | null | undefined; atual: string | null | undefined; piOn: boolean;
  temTecidos: boolean; espelhos: EspelhosCard | null;
  /** R7 — a ficha (Tecidos/Aviamentos/Insumos) está tocada OU a grade cor × tamanho tem edição não salva. */
  edicaoPendente: boolean;
}): OpcaoOrigem[] {
  const salva = normalizarOrigem(i.salva);
  const atual = normalizarOrigem(i.atual);
  const lista: { value: Origem; label: string }[] = [
    { value: "interno", label: "Interno" },
    { value: "revenda", label: "Revenda" },
  ];
  if (i.piOn || atual === "importado" || salva === "importado") lista.push({ value: "importado", label: "Importado" });
  return lista.map((o) => {
    const motivo = !i.isEdit || o.value === atual ? null
      : i.edicaoPendente ? MOTIVO_EDICAO_PENDENTE
        : o.value === salva ? null
          : motivoTrocaOrigem({ de: salva, para: o.value, piOn: i.piOn, temTecidos: i.temTecidos, espelhos: i.espelhos });
    return { ...o, disabled: motivo !== null, motivo };
  });
}

// ── Seções da ficha por origem (decisões F3 #4/#8) ──────────────────────────────────────────────────────────────────
export type SecoesFicha = {
  tecidos: boolean; aviamentos: boolean; insumos: boolean;
  /** "Grade por variante do Tecido 1" (ModeloGradeSection) — só interno (decisão F3 #4). */
  gradeTecido: boolean;
  cad: boolean;
  /** Grade cor × tamanho do produto comprado (GradeRevendaSecao) — a fonte única do comprado. */
  gradeComprado: boolean;
};
export const SECOES_FICHA_INTERNO: SecoesFicha = {
  tecidos: true, aviamentos: true, insumos: true, gradeTecido: true, cad: true, gradeComprado: false,
};
/** Interno: tudo. Comprado: as chaves do Fluxo de Revenda (Dev ModeloDetailPanel.tsx:1621-1623) — `s2` Tecidos, `s3`
 *  Aviamentos, `s3e` Insumos, `s-cad` CAD, `s4` Grade (aqui, a cor × tamanho). */
export function secoesFicha(isComprado: boolean, campoVisivel: (key: string) => boolean): SecoesFicha {
  if (!isComprado) return SECOES_FICHA_INTERNO;
  return {
    tecidos: campoVisivel("s2"), aviamentos: campoVisivel("s3"), insumos: campoVisivel("s3e"),
    gradeTecido: false, cad: campoVisivel("s-cad"), gradeComprado: campoVisivel("s4"),
  };
}

// ── Selos por origem ───────────────────────────────────────────────────────────────────────────────────────────────
/** Requisitos configurados (união) que valem p/ o card: comprado ignora os IMPOSSÍVEIS p/ comprado (`REVENDA_COND_NA` —
 *  a Config já os esmaece; um resto antigo não pode acender "falta" p/ sempre). */
export function requeridasPorOrigem(isComprado: boolean, requeridas: ReadonlySet<string>): Set<string> {
  const out = new Set(requeridas);
  if (isComprado) for (const k of REVENDA_COND_NA) out.delete(k);
  return out;
}

/** Selo da seção "Grade" cor × tamanho: requisito `grade_preenchida` (estado SALVO) vence; senão o informativo. */
export function seloGradeComprado(i: {
  requeridas: ReadonlySet<string>; satisfeitas: Record<string, boolean> | null; totalGeral: number; nVariantes: number;
}): SeloSecao {
  const req = i.satisfeitas ? seloPorChaves(["grade_preenchida"], i.requeridas, i.satisfeitas) : null;
  if (req) return req;
  if (i.nVariantes === 0) return { tone: "muted", texto: "sem variantes" };
  if (i.totalGeral > 0) return { tone: "ok", texto: `${i.totalGeral} ${i.totalGeral === 1 ? "peça" : "peças"}` };
  return { tone: "warn", texto: "falta preencher" };
}

const CAMPOS_COMPLETUDE_DEV = ["modelista_id", "piloteiro1_id", "data_piloto1", "data_desenho_tecnico"] as const;
/** Selo informativo da seção "Desenvolvimento": completa quando os campos VISÍVEIS estão preenchidos (interno = os 4 de
 *  sempre; comprado = só os que a loja deixou visíveis — default nenhum). */
export function desenvolvimentoCompleto(
  d: Pick<Draft, "modelista_id" | "piloteiro1_id" | "data_piloto1" | "data_desenho_tecnico">,
  campoVisivel: (key: string) => boolean,
): boolean {
  return CAMPOS_COMPLETUDE_DEV.every((k) => !campoVisivel(k) || !!d[k]);
}

// ── Grade cor × tamanho (decisão F3 #4) ────────────────────────────────────────────────────────────────────────────
/** Rascunho `{ordem: {tamanho: qtd}}` → linhas (estado COMPLETO — linha ausente = apagada no servidor). */
export function linhasGradeComprado(g: Record<number, Record<string, number>>): GradeRow[] {
  return Object.entries(g).map(([ordem, grades]) => ({
    variante_numero: Number(ordem),
    grades,
    grade_total: Object.values(grades).reduce((s, v) => s + (Number(v) || 0), 0),
  }));
}

/** Forma canônica p/ comparar grades: sem célula/linha zerada (o RPC não grava linha sem valor), chaves ordenadas. */
export function normalizarGradeComprado(g: Record<number | string, Record<string, number>>): string {
  const linhas = Object.entries(g)
    .map(([k, cel]) => {
      const celulas = Object.entries(cel ?? {})
        .map(([t, v]) => [t, Number(v) || 0] as const)
        .filter(([, v]) => v > 0)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return [Number(k), Object.fromEntries(celulas)] as const;
    })
    .filter(([, cel]) => Object.keys(cel).length > 0)
    .sort(([a], [b]) => a - b);
  return JSON.stringify(linhas);
}

export function gradeCompradoDoServidor(rows: GradeRowDb[]): Record<number, Record<string, number>> {
  const out: Record<number, Record<string, number>> = {};
  for (const r of rows) out[r.variante_numero] = { ...(r.grades ?? {}) };
  return out;
}

/** A grade do SERVIDOR mudou em relação ao baseline semeado (`gradeRevendaBaseRef`)? JSON inválido ⇒ sim (na dúvida, não grava). */
export function gradeCompradoMudouNoServidor(baseJson: string, servidor: GradeRowDb[]): boolean {
  let base: Record<number, Record<string, number>>;
  try {
    base = JSON.parse(baseJson || "{}") as Record<number, Record<string, number>>;
  } catch {
    return true;
  }
  return normalizarGradeComprado(base) !== normalizarGradeComprado(gradeCompradoDoServidor(servidor));
}

/**
 * `_grades` que o `salvar_modelo_bom` recebe num card COMPRADO — ele APAGA todas as `modelo_grades`
 * (`_salvar_modelo_bom_core`), então a grade cor × tamanho TEM de ir junto. Editada ⇒ o rascunho; não editada ⇒ o que o
 * SERVIDOR tem agora (o rascunho é semeado 1× por abertura e pode estar velho — nunca regravar grade velha por cima da
 * de outra pessoa).
 */
export function gradesParaBomComprado(i: { editada: boolean; rascunho: GradeRow[]; servidor: GradeRowDb[] }): GradeRow[] {
  if (i.editada) return i.rascunho;
  return i.servidor.map((r) => ({
    variante_numero: r.variante_numero,
    grades: (r.grades ?? {}) as Record<string, number>,
    grade_total: r.grade_total ?? 0,
  }));
}
```

- [ ] **Step 4: Rodar e ver passar + gates**

Run: `env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit/planejamento-comprado.test.ts` → PASS. Depois `bash .superpowers/f34/gates.sh` → `GATES F3.4: ok`.

- [ ] **Step 5: Commit**

```bash
F="src/components/planejamento/planejamento-detail/comprado.ts tests/unit/planejamento-comprado.test.ts"
git add -- $F
git commit --only -m "feat(planejamento): F3.4 (1) — regras puras do produto comprado (Origem, seções pelo Fluxo de Revenda, requisitos, selo e grade cor × tamanho p/ o BOM)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- $F
```

---

## Task 2: "Para enviar, falta" do comprado em `envio-explosao.ts`  *(Lote A)*

**Files:**
- Modify: `src/components/planejamento/planejamento-detail/ficha/envio-explosao.ts`
- Test: `tests/unit/planejamento-envio-explosao.test.ts` (acrescenta 1 `describe`)

**Interfaces:**
- Consumes: F3.3 `pendenciasEnvioExplosao`, `PendenciaEnvio`, `SecaoSheetKey`.
- Produces: `pendenciasEnvioExplosao(i: { draft; blocks; grades; rotuloRef; campoVisivel?: (key: string) => boolean; secaoGrade?: SecaoSheetKey })` — sem os opcionais = o comportamento da F3.3 (interno).

- [ ] **Step 1: Teste (falha: os campos novos não existem)**

No FIM de `tests/unit/planejamento-envio-explosao.test.ts`, acrescentar (os imports `makeEmptyBlocks`, `emptyDraft`, `Draft`, `pendenciasEnvioExplosao` já existem no arquivo — F3.3):

```ts
describe("pendenciasEnvioExplosao — F3.4 comprado (Dev ModeloDetailPanel.tsx:1577-1595, `campoVisivel`)", () => {
  const minimos = (): Draft => ({ ...emptyDraft(), ref: "ONV0000001", nome: "Vestido", estilista_id: "e", categoria_principal_id: "c" });
  const soVisivel = (vis: string[]) => (k: string) => vis.includes(k);
  it("default do comprado (Tecidos e datas ocultos, Grade visível): só a grade cor × tamanho", () => {
    expect(pendenciasEnvioExplosao({
      draft: minimos(), blocks: makeEmptyBlocks(), grades: [], rotuloRef: "REF",
      campoVisivel: soVisivel(["s3", "s3e", "s4", "s5", "s6"]), secaoGrade: "grade_revenda",
    })).toEqual([{ label: "grade preenchida", secao: "grade_revenda" }]);
  });
  it("com a grade preenchida: nada falta", () => {
    expect(pendenciasEnvioExplosao({
      draft: minimos(), blocks: makeEmptyBlocks(), grades: [{ variante_numero: 1, grades: { "38|P": 1 }, grade_total: 1 }],
      rotuloRef: "REF", campoVisivel: soVisivel(["s4"]), secaoGrade: "grade_revenda",
    })).toEqual([]);
  });
  it("os mínimos (REF, Nome, Estilista, Categoria) valem sempre, mesmo com tudo oculto", () => {
    expect(pendenciasEnvioExplosao({
      draft: { ...minimos(), ref: "", estilista_id: null }, blocks: makeEmptyBlocks(), grades: [], rotuloRef: "REF", campoVisivel: () => false,
    })).toEqual([{ label: "REF", secao: "desenvolvimento" }, { label: "Estilista", secao: "info" }]);
  });
  it("sem `campoVisivel`: o fluxo interno de sempre (F3.3)", () => {
    expect(pendenciasEnvioExplosao({ draft: minimos(), blocks: makeEmptyBlocks(), grades: [], rotuloRef: "REF" }).map((p) => p.label))
      .toEqual(["ao menos 1 tecido com variante", "grade preenchida", "Data Desenho Técnico", "Data Piloto 1"]);
  });
});
```

Run: `env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit/planejamento-envio-explosao.test.ts` → FAIL (tsc/vitest: propriedade `campoVisivel` inexistente ou pendências a mais).

- [ ] **Step 2: Implementar**

(a) Trocar a linha do comentário:

```ts
 * "Para enviar, falta" (Dev :1576-1595, fluxo INTERNO — o Enviar só aparece p/ interno na F3.3). Cada pendência aponta
```

por:

```ts
 * "Para enviar, falta" (Dev :1576-1595). F3.4 (D2): comprado também — só exige o que a loja deixou VISÍVEL p/ comprado
 * (`campoVisivel`, Dev :1583-1595) e a grade cor × tamanho (`secaoGrade`); os mínimos valem sempre. Cada pendência aponta
```

(b) Substituir:

```ts
  rotuloRef: string;
}): PendenciaEnvio[] {
```

por:

```ts
  rotuloRef: string;
  /** F3.4 — comprado: campo/seção visível p/ comprado (`revendaCampoVisivel`); ausente = interno (tudo exigido, como antes). */
  campoVisivel?: (key: string) => boolean;
  /** F3.4 — seção onde "grade preenchida" se resolve (comprado = "grade_revenda", a grade cor × tamanho). */
  secaoGrade?: SecaoSheetKey;
}): PendenciaEnvio[] {
  const cv = i.campoVisivel ?? (() => true);
```

(c) Substituir o bloco (da linha `  const temTecidoComVariante = …` até a linha do "Data Piloto 3", inclusive):

```ts
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
```

por:

```ts
  // F3.4 — comprado afrouxa como o Dev (ModeloDetailPanel.tsx:1583-1595): tecido só com a seção "s2" visível, grade só
  // com "s4", cada data só se o campo estiver visível. No interno `cv` é sempre true (regra de antes, intocada).
  if (cv("s2")) {
    const temTecidoComVariante = i.blocks.some((b) => b.tipo === "tecido" && !!b.artigo_id && b.variantes.some((v) => !!v));
    const todosComVariante = i.blocks.filter((b) => !!b.artigo_id).every((b) => b.variantes.some((v) => !!v));
    if (!temTecidoComVariante) out.push({ label: "ao menos 1 tecido com variante", secao: "tecidos" });
    else if (!todosComVariante) out.push({ label: "1 variante em cada tecido/forro/entretela selecionado", secao: "tecidos" });
  }
  if (cv("s4") && i.grades.reduce((s, g) => s + (g.grade_total || 0), 0) <= 0) out.push({ label: "grade preenchida", secao: i.secaoGrade ?? "grade" });
  if (cv("data_desenho_tecnico") && vazio(d.data_desenho_tecnico)) out.push({ label: "Data Desenho Técnico", secao: "desenvolvimento" });
  if (cv("data_piloto1") && vazio(d.data_piloto1)) out.push({ label: "Data Piloto 1", secao: "desenvolvimento" });
  const piloto2Aberto = !!(d.piloteiro2_id || !vazio(d.data_piloto2));
  const piloto3Aberto = !!(d.piloteiro3_id || !vazio(d.data_piloto3));
  if (cv("data_piloto2") && piloto2Aberto && vazio(d.data_piloto2)) out.push({ label: "Data Piloto 2", secao: "desenvolvimento" });
  if (cv("data_piloto3") && piloto3Aberto && vazio(d.data_piloto3)) out.push({ label: "Data Piloto 3", secao: "desenvolvimento" });
```

- [ ] **Step 3: Rodar e ver passar + gates**

Run: `env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit/planejamento-envio-explosao.test.ts` → PASS (os casos da F3.3 seguem verdes). Depois `bash .superpowers/f34/gates.sh`.

- [ ] **Step 4: Commit**

```bash
F="src/components/planejamento/planejamento-detail/ficha/envio-explosao.ts tests/unit/planejamento-envio-explosao.test.ts"
git add -- $F
git commit --only -m "feat(planejamento): F3.4 (2) — 'Para enviar, falta' do comprado: só o que a loja deixou visível + grade cor × tamanho (paridade com o Dev)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- $F
```

**Revisão do Lote A (Tasks 1, 2):** `motivoTrocaOrigem` × D1 (texto do dono em §8) e as ressalvas do G-plano F3.4 — R3 (nunca dois espelhos, qualquer origem; `importado: null` = indeterminado trava a SAÍDA do importado e nunca trava a Revenda de um interno) e R7 (edição pendente trava tudo, menos o valor atual); "Revenda" continua sempre listada (não-regressão); `secoesFicha` × `revendaCampoVisivel`/Dev :1621-1623 (chaves exatas `s2`/`s3`/`s3e`/`s-cad`/`s4`); `requeridasPorOrigem` não mexe no interno; `gradesParaBomComprado` nunca devolve o rascunho não editado; `normalizarGradeComprado` casa o critério do RPC (linha sem valor não é gravada); `pendenciasEnvioExplosao` × Dev :1577-1595 linha a linha e os testes da F3.3 verdes.

---

## Task 3: `useGradeComprado` — a grade cor × tamanho de revenda E importado  *(individual Opus)*

**Files:**
- Create: `src/components/planejamento/planejamento-detail/useGradeComprado.ts`
- Modify: `src/components/planejamento/planejamento-detail/useRevendaPlanejamento.ts` (reescrito: perde a grade — texto MOVIDO)
- Modify: `src/components/planejamento/planejamento-detail/RevendaSetores.tsx` (`GradeRevendaSecao` por origem; `ProdutoImportadoSecao`)
- Modify: `src/components/planejamento/PlanejamentoDetail.tsx` (`piOn`, as 2 chamadas de hook, a chamada da `GradeRevendaSecao`)

**Interfaces:**
- Consumes: Task 1 (`linhasGradeComprado`); `ehGrupoAcessorio` (`@/lib/produto-acabado`), `DEFAULT_TAMANHOS` (`@/components/oc-p-acabado/shared`) — só importar; F3.3 `Secao({ id, titulo, numero, selo })`.
- Produces: `useGradeComprado({ modeloId, isEdit, origem, moduloOn, grupos, tenantIdAtivo, revRef, aoEditar? })` → `GradeComprado = { origem, produto: ProdutoComprado | null, produtoLoading, gradeRevenda, setGradeRevenda, gradeRevendaBaseRef, gradeRevendaRevRef, gradeRevendaDirty, variantesRevenda, tamanhosRevenda, setCelulaGradeRevenda, totalLinhaRevenda, totalColunaRevenda, totalGeralRevenda, buildLinhasGradeRevenda }`; `ProdutoComprado`; `useRevendaPlanejamento({ modeloId, isEdit, isRevenda, paOn, draft, baseRevendaMarkup, categorias, qc, navigate, contexto, onClose })` SEM a grade; `GradeRevendaSecao({ gc, numero?, selo?, motivoSomenteLeitura? })`; `ProdutoImportadoSecao({ gc, numero?, navigate })`; no orquestrador `piOn`, `origemSalva`, `gradeComprado`.

- [ ] **Step 1: Criar `useGradeComprado.ts`**

```ts
// F3.4 — grade cor × tamanho do produto COMPRADO (revenda E importado) no Sheet do Planejamento: a FONTE ÚNICA da grade
// do comprado (decisão F3 #4 — a "Grade por variante do Tecido 1" é só do interno). Texto MOVIDO de
// `useRevendaPlanejamento.ts` (a grade da revenda — Task 7 do Produto Acabado, extraída na F3.0) + o produto espelho lido
// POR ORIGEM (`produtos_acabados` na revenda, `produtos_importados` no importado — mesmo formato: variantes por `ordem`,
// `grade_proporcao`, grupo). A grade mora em `modelo_grades` com `variante_numero` = `ordem` da variante do produto
// (`_criar_card_produto_*_core` e `_aplicar_produto_ao_modelo_core` gravam assim). MESMA queryKey de antes p/ a grade
// (`["modelo-grades-revenda", modeloId]` — o Salvar invalida/recarrega por ela) e os MESMOS nomes de estado/refs (o
// `usePlanejamentoSave` os recebe sem mudar). ORDEM IMPORTA: o orquestrador chama este hook logo depois de
// `useRevendaPlanejamento` (antes dos effects de seed de MO e do merge do colab) — o seed copia `revRef.current`.
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ehGrupoAcessorio } from "@/lib/produto-acabado";
import { DEFAULT_TAMANHOS } from "@/components/oc-p-acabado/shared";
import { type Opt } from "@/components/planejamento/modelo-shared";
import { linhasGradeComprado } from "@/components/planejamento/planejamento-detail/comprado";

export type ProdutoComprado = {
  id: string;
  colecao_id: string | null;
  grupo_id: string | null;
  grade_proporcao: Record<string, number> | null;
  variantes: { ordem: number; cor: { nome: string | null } | null; apelido: { nome: string | null } | null }[] | null;
};

/**
 * Produto espelho por origem — SÓ p/ a grade (variantes, proporção, grupo) e a seção do produto. A regra da Origem NÃO lê
 * daqui (G-plano F3.4 R3: este produto só é lido com o módulo da origem SALVA ligado — "módulo off" viraria "sem produto"
 * e liberaria o 2º espelho); ela usa os DOIS espelhos de `plan-origem-espelhos` (Task 6). Embeds sem ambiguidade: exatamente
 * 1 FK em cada par (plano F3.4 §1).
 */
const PRODUTO_POR_ORIGEM: Record<"revenda" | "importado", { tabela: string; select: string }> = {
  revenda: {
    tabela: "produtos_acabados",
    select: "id, colecao_id, grupo_id, grade_proporcao, variantes:produto_acabado_variantes(ordem, cor:cor_id(nome), apelido:cor_apelido_id(nome))",
  },
  importado: {
    tabela: "produtos_importados",
    select: "id, colecao_id, grupo_id, grade_proporcao, variantes:produto_importado_variantes(ordem, cor:cor_id(nome), apelido:cor_apelido_id(nome))",
  },
};

export function useGradeComprado({ modeloId, isEdit, origem, moduloOn, grupos, tenantIdAtivo, revRef, aoEditar }: {
  modeloId: string | null;
  isEdit: boolean;
  /** Origem SALVA do card (a do servidor — a troca no Select só vale depois do Salvar). */
  origem: string;
  /** Módulo da origem ligado (`produto_acabado` p/ revenda, `produto_importado` p/ importado). */
  moduloOn: boolean;
  grupos: Opt[];
  tenantIdAtivo: string;
  /** rev otimista do header (colab) — o seed da grade copia `revRef.current`. Passar o REF, não o valor. */
  revRef: RefObject<number | null>;
  /** Chamado a cada célula editada (importado: marca a ficha — a grade grava pelo BOM, plano F3.4 §3). */
  aoEditar?: () => void;
}) {
  const cfgProduto = origem === "revenda" || origem === "importado" ? PRODUTO_POR_ORIGEM[origem] : null;
  const on = isEdit && !!modeloId && !!cfgProduto && moduloOn;
  const aoEditarRef = useRef(aoEditar);
  aoEditarRef.current = aoEditar;

  // Grade cor×tamanho — estado/refs (texto movido): o rascunho entra no `dirty` combinado do orquestrador; a query/efeito
  // de seed e os handlers ficam abaixo (closures sobre o mesmo state, ordem de hooks fixa).
  const [gradeRevenda, setGradeRevenda] = useState<Record<number, Record<string, number>>>({});
  const gradeRevendaSeededRef = useRef(false);
  const gradeRevendaBaseRef = useRef("{}");
  // Trava otimista da grade da REVENDA (`salvar_grade_revenda`): rev de `modelos` capturado no momento em que a grade foi
  // LIDA do servidor (seed inicial OU recarga após P0409) — INDEPENDENTE de `revRef` (ver o comentário no `usePlanejamentoSave`).
  // No importado não é usada: a grade grava pelo BOM, sob o `.eq("rev")` do header (plano F3.4 §3).
  const gradeRevendaRevRef = useRef<number | null>(null);
  const gradeRevendaDirty = gradeRevendaSeededRef.current && JSON.stringify(gradeRevenda) !== gradeRevendaBaseRef.current;

  const { data: produto, isLoading: produtoLoading } = useQuery({
    queryKey: ["plan-comprado-produto", modeloId, origem],
    enabled: on,
    queryFn: async () => {
      if (!cfgProduto) return null;
      const { data, error } = await (supabase.from(cfgProduto.tabela as any) as any)
        .select(cfgProduto.select)
        .eq("modelo_id", modeloId)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as ProdutoComprado | null;
    },
  });
  const grupoNome = grupos.find((g) => g.id === produto?.grupo_id)?.nome ?? null;
  const acessorio = ehGrupoAcessorio(grupoNome);
  // Tamanhos ativos do tenant (ordem canônica) — mesma fonte/fallback do planejador Produto Acabado; colunas da grade =
  // interseção com `grade_proporcao` (texto movido; o `enabled` passa a valer p/ os dois comprados).
  const { data: tenantTamanhos = DEFAULT_TAMANHOS } = useQuery({
    queryKey: ["tenant-config-tamanhos-planejamento", tenantIdAtivo],
    enabled: !!tenantIdAtivo && on,
    queryFn: async () => {
      const { data } = await supabase.from("tenant_config").select("tamanhos_grade").eq("tenant_id", tenantIdAtivo).maybeSingle();
      const raw = (data as any)?.tamanhos_grade;
      return Array.isArray(raw) && raw.length > 0 ? raw.map(String) : DEFAULT_TAMANHOS;
    },
  });
  const variantesRevenda = useMemo(
    () => [...(produto?.variantes ?? [])].sort((a, b) => a.ordem - b.ordem),
    [produto],
  );
  const tamanhosRevenda = useMemo(() => {
    if (acessorio) return ["UN"];
    const prop = produto?.grade_proporcao ?? {};
    return tenantTamanhos.filter((t) => Object.prototype.hasOwnProperty.call(prop, t));
  }, [acessorio, produto, tenantTamanhos]);

  // Grade cor×tamanho — lê `modelo_grades` (variante_numero=ordem) e semeia 1× por abertura do card (texto movido: o
  // detalhe nasce/some por inteiro a cada abrir/fechar, então um refetch em BG nunca perde edição).
  const { data: gradeModeloRows } = useQuery({
    queryKey: ["modelo-grades-revenda", modeloId],
    enabled: on,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modelo_grades")
        .select("variante_numero, grades, grade_total")
        .eq("modelo_id", modeloId as string);
      if (error) throw error;
      return (data ?? []) as { variante_numero: number; grades: Record<string, number> | null; grade_total: number }[];
    },
  });
  useEffect(() => {
    if (!gradeModeloRows || gradeRevendaSeededRef.current) return;
    const seeded: Record<number, Record<string, number>> = {};
    for (const r of gradeModeloRows) seeded[r.variante_numero] = { ...(r.grades ?? {}) };
    setGradeRevenda(seeded);
    gradeRevendaBaseRef.current = JSON.stringify(seeded);
    // Best-effort: `revRef` já deve estar semeado a essa altura (a query de `modelo` carrega
    // em paralelo, sem dependência entre as duas) — se ainda estiver null (corrida rara), o
    // 1º Salvar cai no bypass (`_rev_base: null`); qualquer conflito de verdade continua pego
    // pelo retry do header, que dispara a recarga da grade via `gradeConflict`.
    gradeRevendaRevRef.current = revRef.current;
    gradeRevendaSeededRef.current = true;
  }, [gradeModeloRows]);
  const setCelulaGradeRevenda = (ordem: number, tam: string, v: number) => {
    aoEditarRef.current?.();
    setGradeRevenda((prev) => ({ ...prev, [ordem]: { ...(prev[ordem] ?? {}), [tam]: Math.max(0, Math.trunc(v) || 0) } }));
  };
  const totalLinhaRevenda = (ordem: number) =>
    Object.values(gradeRevenda[ordem] ?? {}).reduce((s, v) => s + (Number(v) || 0), 0);
  const totalColunaRevenda = (tam: string) =>
    variantesRevenda.reduce((s, v) => s + (Number(gradeRevenda[v.ordem]?.[tam]) || 0), 0);
  const totalGeralRevenda = variantesRevenda.reduce((s, v) => s + totalLinhaRevenda(v.ordem), 0);
  // Payload da grade — estado COMPLETO (linha ausente = apagada no servidor): `salvar_grade_revenda` (revenda) e o
  // `_grades` do `salvar_modelo_bom` (comprado — plano F3.4 §3). Mesma conta de antes (`linhasGradeComprado`).
  const buildLinhasGradeRevenda = () => linhasGradeComprado(gradeRevenda);

  return {
    origem, produto: produto ?? null, produtoLoading,
    gradeRevenda, setGradeRevenda, gradeRevendaBaseRef, gradeRevendaRevRef, gradeRevendaDirty,
    variantesRevenda, tamanhosRevenda,
    setCelulaGradeRevenda, totalLinhaRevenda, totalColunaRevenda, totalGeralRevenda,
    buildLinhasGradeRevenda,
  };
}

export type GradeComprado = ReturnType<typeof useGradeComprado>;
```

- [ ] **Step 2: Reescrever `useRevendaPlanejamento.ts` sem a grade (substituir o arquivo INTEIRO)**

Pré-condição: a linha "`useRevendaPlanejamento.ts idêntico à F3.2`" do Task 0 Step 3. O arquivo novo é o de hoje (f19202b) MENOS as linhas 42-57 e 180-246 (a grade, que foi para o Step 1), com os argumentos `grupos`/`tenantIdAtivo`/`revRef` retirados (só a grade os usava) e o retorno sem os campos da grade:

```ts
// Revenda (Produto Acabado) no detalhe do Planejamento: produto vinculado, markups e preços fixos e "criar produto
// acabado". Extraído na F3.0 (set/2026) de `PlanejamentoDetail.tsx` SEM mudança de comportamento (mesmas queryKeys, mesmas
// RPCs, mesma ordem relativa de hooks). F3.4: a GRADE cor×tamanho SAIU daqui para `useGradeComprado.ts` (texto movido —
// agora vale p/ revenda E importado, decisão F3 #4); aqui ficou só o que é da REVENDA (preço atacado/varejo por
// `produtos_acabados` e criar o produto).
import { useRef, useState } from "react";
import { useMutation, useQuery, type QueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { markupDePreco } from "@/lib/preco-revenda";
import { supabase } from "@/integrations/supabase/client";
import { erroValidacao } from "@/components/produto-acabado/shared";
import { type CatOpt, type Draft } from "@/components/planejamento/modelo-shared";

export type UseRevendaPlanejamentoArgs = {
  modeloId: string | null;
  isEdit: boolean;
  isRevenda: boolean;
  paOn: boolean;
  draft: Draft;
  /** custo previsto + M.O. ao vivo (calculado no orquestrador, bloco de preço). */
  baseRevendaMarkup: number;
  categorias: CatOpt[];
  qc: QueryClient;
  navigate: ReturnType<typeof useNavigate>;
  contexto: "planejamento" | "produto-acabado";
  onClose: () => void;
};

export function useRevendaPlanejamento({
  modeloId, isEdit, isRevenda, paOn, draft, baseRevendaMarkup, categorias,
  qc, navigate, contexto, onClose,
}: UseRevendaPlanejamentoArgs) {
  // Produto Acabado vinculado a este modelo (revenda, Task 7) — embed REVERSO
  // (`produtos_acabados.modelo_id`): markups/preços fixos do produto. (F3.4: variantes/proporção/grupo da GRADE
  // passaram a ser lidos por `useGradeComprado`, por origem.)
  const { data: produtoRevenda, isLoading: produtoRevendaLoading } = useQuery({
    queryKey: ["pa-produto-modelo", modeloId],
    enabled: isEdit && !!modeloId && isRevenda && paOn,
    queryFn: async () => {
      const { data, error } = await (supabase.from("produtos_acabados" as any) as any)
        .select("id, colecao_id, categoria_id, grupo_id, grade_proporcao, markup_atacado, markup_varejo, preco_atacado_fixo, preco_varejo_fixo, variantes:produto_acabado_variantes(ordem, cor:cor_id(nome), apelido:cor_apelido_id(nome))")
        .eq("modelo_id", modeloId)
        .maybeSingle();
      if (error) throw error;
      return data as {
        id: string; colecao_id: string | null; categoria_id: string | null; grupo_id: string | null;
        grade_proporcao: Record<string, number>;
        markup_atacado: number | null; markup_varejo: number | null;
        preco_atacado_fixo: number | null; preco_varejo_fixo: number | null;
        variantes: { ordem: number; cor: { nome: string | null } | null; apelido: { nome: string | null } | null }[];
      } | null;
    },
  });
```

e, logo em seguida, o texto de HOJE das linhas 81-179 de `useRevendaPlanejamento.ts` (do comentário `  // Markups digitáveis (item 3 do refino, ago/2026) — mesma fonte de \`ProdutoCard.tsx\`` até o `  });` que fecha `const salvarPrecosFixoRevenda = useMutation({…})`, SEM mudar nada), depois o texto de HOJE das linhas 248-296 (do comentário `  // "criar produto acabado" (revenda sem produto vinculado, Task 7): INSERT em` até o `  });` que fecha `const criarProdutoAcabado = useMutation({…})`, SEM mudar nada), e fechar com:

```ts
  return {
    produtoRevenda, produtoRevendaLoading,
    markupAtacadoInput, setMarkupAtacadoInput, markupVarejoInput, setMarkupVarejoInput,
    markupAtacadoBaseRef, markupVarejoBaseRef,
    precoAtacadoDraft, setPrecoAtacadoDraft, precoVarejoDraft, setPrecoVarejoDraft,
    salvarMarkupsRevenda, salvarPrecosFixoRevenda,
    criarProdutoAcabado,
  };
}

export type RevendaPlanejamento = ReturnType<typeof useRevendaPlanejamento>;
```

(A query `pa-produto-modelo` fica BYTE A BYTE igual à de hoje — mesma key, mesmo select, mesma forma — porque outras telas a invalidam; só o comentário acima dela mudou.)

Conferência do "texto movido" (arquivos temporários SÓ na pasta `.superpowers/f34/` da worktree — nunca em `/tmp`; apagados no fim):

```bash
D=src/components/planejamento/planejamento-detail; B="$(cat .superpowers/f34/BASE)"; T=.superpowers/f34
git show "$B:$D/useRevendaPlanejamento.ts" | sed -n '63,80p'   > "$T/mv-pa.txt"
git show "$B:$D/useRevendaPlanejamento.ts" | sed -n '81,179p'  > "$T/mv-precos.txt"
git show "$B:$D/useRevendaPlanejamento.ts" | sed -n '248,296p' > "$T/mv-criar.txt"
git show "$B:$D/useRevendaPlanejamento.ts" | sed -n '219,231p' > "$T/mv-seed.txt"
for f in mv-pa mv-precos mv-criar; do
  diff <(grep -vFx -f "$D/useRevendaPlanejamento.ts" "$T/$f.txt") /dev/null > /dev/null && echo "$f: todas as linhas no useRevendaPlanejamento" || echo "$f: FALTA LINHA — PARE"
done
diff <(grep -vFx -f "$D/useGradeComprado.ts" "$T/mv-seed.txt") /dev/null > /dev/null && echo "seed da grade: todas as linhas no useGradeComprado" || echo "seed da grade: FALTA LINHA — PARE"
grep -cF 'modelo-grades-revenda' $D/useRevendaPlanejamento.ts                      # 0
grep -cF 'queryKey: ["modelo-grades-revenda", modeloId],' $D/useGradeComprado.ts   # 1
grep -cF 'gradeRevendaRevRef.current = revRef.current;' $D/useGradeComprado.ts     # 1
rm -f "$T/mv-pa.txt" "$T/mv-precos.txt" "$T/mv-criar.txt" "$T/mv-seed.txt"
```

Expected: as 4 linhas "todas as linhas…", `0`, `1`, `1`. (O `grep -vFx -f NOVO VELHO` lista as linhas do trecho VELHO que não existem, inteiras, no arquivo NOVO — vazio = texto movido sem perda.)

- [ ] **Step 3: `RevendaSetores.tsx` — grade por origem + seção do Produto Importado**

(a) Trocar o comentário de cabeçalho (as 6 primeiras linhas, de `// Blocos de REVENDA do detalhe do Planejamento (Produto Acabado): preço (markups + preços fixos),` até `// remontariam a cada render e o input perderia o foco.`) por:

```ts
// Blocos de PRODUTO COMPRADO do detalhe do Planejamento: preço da revenda (markups + preços fixos), seção "Produto
// Acabado"/"Produto Importado" (vínculo) e seção "Grade" cor×tamanho. Extraídos na F3.0 de `PlanejamentoDetail.tsx` SEM
// mudança de comportamento; F3.4: a grade passa a valer p/ revenda E importado (`useGradeComprado`, decisão F3 #4) e o
// importado ganha a seção do produto. Componentes de nível de MÓDULO de propósito — declarados dentro do orquestrador,
// eles remontariam a cada render e o input perderia o foco.
```

(b) Depois de `import { type RevendaPlanejamento } from "@/components/planejamento/planejamento-detail/useRevendaPlanejamento";`, inserir:

```ts
import { type GradeComprado } from "@/components/planejamento/planejamento-detail/useGradeComprado";
import type { ReactNode } from "react";
```

(c) Substituir do comentário `/** Seção "Grade" cor×tamanho do card revenda (lê/grava \`modelo_grades\` pelo Salvar da página). */` até o FIM do arquivo (a função `GradeRevendaSecao` inteira) por:

```tsx
/** F3.4 — Seção "Produto Importado" do card importado (espelho da "Produto Acabado"): vínculo + atalho ⧉. Sem botão de criar —
 *  o Salvar cria o produto sozinho (plano F3.4 D1). MESMA chave de seção `produto_acabado` (numeração/abertura). */
export function ProdutoImportadoSecao({ gc, numero, navigate }: {
  gc: GradeComprado; numero?: number; navigate: ReturnType<typeof useNavigate>;
}) {
  return (
            <Secao id="produto_acabado" titulo="Produto Importado" numero={numero} defaultOpen={false}>
              {gc.produtoLoading ? (
                <p className="text-sm text-muted-foreground">Carregando…</p>
              ) : gc.produto ? (
                <div className="flex flex-wrap items-center gap-3">
                  <p className="text-sm text-muted-foreground">Este modelo está vinculado a um produto importado.</p>
                  <Button
                    type="button" variant="outline" size="sm" className="ml-auto gap-1.5"
                    onClick={() => navigate({ to: "/criacao/produto-importado", search: gc.produto?.colecao_id ? ({ colecao: gc.produto.colecao_id } as any) : ({} as any) })}
                  >
                    <ExternalLink className="h-3.5 w-3.5" /> Ver no Produto Importado
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Nenhum produto importado vinculado ainda. Ao salvar (com Grupo e Categoria preenchidos), o sistema cria o produto no Produto Importado — câmbio, variantes e etapas você completa lá.
                </p>
              )}
            </Secao>
  );
}

/** Seção "Grade" cor×tamanho do card COMPRADO (revenda e importado — F3.4, decisão F3 #4: a fonte ÚNICA da grade do
 *  comprado). Edita o rascunho de `useGradeComprado`; o Salvar grava (revenda: `salvar_grade_revenda`; importado: junto
 *  com o BOM — plano F3.4 §3). `motivoSomenteLeitura`: texto do porquê de não editar (ou null = editável). */
export function GradeRevendaSecao({ gc, numero, selo, motivoSomenteLeitura = null }: {
  gc: GradeComprado; numero?: number; selo?: ReactNode; motivoSomenteLeitura?: string | null;
}) {
  const {
    origem, produto, gradeRevenda, variantesRevenda, tamanhosRevenda,
    setCelulaGradeRevenda, totalLinhaRevenda, totalColunaRevenda, totalGeralRevenda,
  } = gc;
  const tela = origem === "importado" ? "Produto Importado" : "Produto Acabado";
  return (
            <Secao id="grade_revenda" titulo="Grade" numero={numero} selo={selo} defaultOpen={false}>
              {!produto ? (
                <p className="text-sm text-muted-foreground">
                  Este card ainda não tem produto vinculado. Salve o card (com Grupo e Categoria) para o sistema criá-lo no {tela}.
                </p>
              ) : variantesRevenda.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  O produto vinculado ainda não tem variantes de cor — cadastre-as no {tela}.
                </p>
              ) : tamanhosRevenda.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Defina a proporção de tamanhos deste produto no {tela} antes de preencher a grade.
                </p>
              ) : (
                <>
                  {motivoSomenteLeitura && <p className="text-xs text-muted-foreground">{motivoSomenteLeitura}</p>}
                  <fieldset disabled={!!motivoSomenteLeitura} className="contents">
                    <div className="overflow-x-auto rounded-md border">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/50 text-left">
                          <tr>
                            <th className="px-3 py-2">Variante</th>
                            {tamanhosRevenda.map((t) => <th key={t} className="px-3 py-2 text-right">{t}</th>)}
                            <th className="px-3 py-2 text-right font-semibold">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {variantesRevenda.map((v) => (
                            <tr key={v.ordem} className="border-t">
                              <td className="px-3 py-2">{varianteLabel({ cor: v.cor?.nome, apelido: v.apelido?.nome })}</td>
                              {tamanhosRevenda.map((t) => (
                                <td key={t} className="px-3 py-1.5 text-right">
                                  <NumberInput
                                    integer
                                    blankZero
                                    placeholder="0"
                                    className="h-8 w-20 text-right ml-auto"
                                    value={gradeRevenda[v.ordem]?.[t] ?? 0}
                                    data-colab-path={`grade-revenda:${v.ordem}:${t}`}
                                    onChange={(e) => setCelulaGradeRevenda(v.ordem, t, Number(e.target.value) || 0)}
                                  />
                                </td>
                              ))}
                              <td className="px-3 py-2 text-right font-medium tabular-nums">{totalLinhaRevenda(v.ordem)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t bg-muted/30 font-medium">
                            <td className="px-3 py-2">Total</td>
                            {tamanhosRevenda.map((t) => <td key={t} className="px-3 py-2 text-right tabular-nums">{totalColunaRevenda(t)}</td>)}
                            <td className="px-3 py-2 text-right tabular-nums">{totalGeralRevenda}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </fieldset>
                </>
              )}
            </Secao>
  );
}
```

(A tabela é o texto de hoje; só ganhou o `<fieldset>`, o aviso e os textos por origem. Na revenda com produto e variantes a tela fica igual.)

- [ ] **Step 4: `PlanejamentoDetail.tsx` — `piOn`, as chamadas dos hooks e a da grade**

(a) Depois de `import { useRevendaPlanejamento } from "@/components/planejamento/planejamento-detail/useRevendaPlanejamento";`, inserir:

```ts
import { useGradeComprado } from "@/components/planejamento/planejamento-detail/useGradeComprado";
```

(b) Depois de `  const paOn = isModuleEnabled("produto_acabado");`, inserir:

```ts
  // F3.4 — Produto Importado (opt-in, `produto_importado`): Origem "Importado" no Select e a grade/seção do importado.
  const piOn = isModuleEnabled("produto_importado");
```

(c) Substituir:

```ts
  const revenda = useRevendaPlanejamento({
    modeloId, isEdit, isRevenda, paOn, draft, baseRevendaMarkup, grupos, categorias,
    tenantIdAtivo, revRef, qc, navigate, contexto, onClose,
  });
  const {
    gradeRevenda, setGradeRevenda, gradeRevendaBaseRef, gradeRevendaRevRef, gradeRevendaDirty,
    produtoRevenda, buildLinhasGradeRevenda,
  } = revenda;
```

por:

```ts
  const revenda = useRevendaPlanejamento({
    modeloId, isEdit, isRevenda, paOn, draft, baseRevendaMarkup, categorias,
    qc, navigate, contexto, onClose,
  });
  const { produtoRevenda } = revenda;
  // F3.4 — grade cor × tamanho do COMPRADO (revenda E importado), fonte ÚNICA da grade do comprado (decisão F3 #4). Lê o
  // produto da origem SALVA (a do servidor — a troca no Select só vale depois do Salvar). MESMA posição de antes (a grade
  // saiu do `useRevendaPlanejamento`): antes dos effects de seed de MO e do merge do colab (o seed copia `revRef.current`).
  const origemSalva = String((modeloData as any)?.origem ?? "interno");
  const gradeComprado = useGradeComprado({
    modeloId, isEdit, origem: origemSalva, moduloOn: origemSalva === "importado" ? piOn : paOn,
    grupos, tenantIdAtivo, revRef,
  });
  const {
    gradeRevenda, setGradeRevenda, gradeRevendaBaseRef, gradeRevendaRevRef, gradeRevendaDirty, buildLinhasGradeRevenda,
  } = gradeComprado;
```

(d) Substituir `            <GradeRevendaSecao rv={revenda} numero={numeros.grade_revenda} />` por `            <GradeRevendaSecao gc={gradeComprado} numero={numeros.grade_revenda} />`.

- [ ] **Step 5: Gates + commit**

```bash
D=src/components/planejamento/planejamento-detail; P=src/components/planejamento/PlanejamentoDetail.tsx
grep -cF "rv={revenda} numero={numeros.grade_revenda}" $P        # 0
grep -cF "useGradeComprado({" $P                                  # 1
bash .superpowers/f34/gates.sh
F="$D/useGradeComprado.ts $D/useRevendaPlanejamento.ts $D/RevendaSetores.tsx $P"
git add -- $F
git commit --only -m "refactor(planejamento): F3.4 (3) — grade cor × tamanho sai do useRevendaPlanejamento p/ useGradeComprado (revenda E importado, produto por origem); seção Produto Importado

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- $F
```

**Revisão individual (Opus):** texto movido linha a linha (seed 1×, `gradeRevendaRevRef = revRef.current`, `gradeRevendaDirty`, handlers, totais); `modelo-grades-revenda` com a MESMA key/select/forma (o `onError` do Salvar a relê); `pa-produto-modelo` intocada; `plan-comprado-produto` com key própria (forma diferente); a revenda na tela = igual a hoje (com produto e variantes); ordem de hooks estável; `produtos_importados` só com o módulo ligado (RLS RESTRICTIVE devolveria vazio); o `gc.produto` serve SÓ à grade e à seção do produto — nenhuma regra da Origem o lê (R3 do G-plano F3.4).

---

## Task 4: A ficha para o comprado — `useFichaTecnica`, `useFichaBom`, `ficha-calc`, `persistir-bom`  *(individual Opus, JUNTO com a Task 5)*

**Files:**
- Modify: `src/components/planejamento/planejamento-detail/ficha/useFichaTecnica.ts`
- Modify: `src/components/planejamento/planejamento-detail/ficha/useFichaBom.ts`
- Modify: `src/components/planejamento/planejamento-detail/ficha/ficha-calc.ts`
- Modify: `src/components/planejamento/planejamento-detail/ficha/persistir-bom.ts`

**Interfaces:**
- Consumes: Task 1 (`gradeCompradoMudouNoServidor`, `gradesParaBomComprado`, `requeridasPorOrigem`); F3.3 (`capturarCad`, `deveGravarCad`, `bom.marcarTocado`).
- Produces: `GradeExternaCaptura = { rascunho: GradeRow[]; editada: boolean; estadoJson: string; baseJson: string; gravaPeloBom: boolean; servidor: GradeRowDb[] | null }`; `BomCapturado.gradesPayload: GradeRow[] | null`, `BomCapturado.gradeExterna: { estadoJson: string } | null`, `BomCapturado.gradeConflito: boolean`; `FichaSave.capturar(custosAdicionais, opts?: { retry?; proporcoes?; gradeExterna?: GradeExternaCaptura })` (comprado que grava sem `gradeExterna.servidor` ⇒ LANÇA — R1); `lerGradeServidorComprado(modeloId: string, revDoCard: () => number | null): Promise<GradeRowDb[]>` (`persistir-bom.ts` — R1); `FichaTecnica.gradeExterna: boolean`, `FichaTecnica.marcarGradeExternaEditada: () => void`, `FichaTecnica.tocado: boolean` (R7); `useFichaBom({…, gradeExterna?: boolean})`; `useFichaTecnica.habilitada` sem `!isComprado`.

- [ ] **Step 1: `ficha-calc.ts` — o que a captura leva da grade externa**

(a) Antes de `export type BomCapturado = {`, inserir:

```ts
/** F3.4 — o que o Salvar passa à captura sobre a grade cor × tamanho do COMPRADO (fonte única — decisão F3 #4). */
export type GradeExternaCaptura = {
  /** Linhas do rascunho da grade (`linhasGradeComprado`). */
  rascunho: GradeRow[];
  /** O rascunho difere do semeado (`gradeRevendaDirty`). */
  editada: boolean;
  /** JSON do rascunho neste instante (vira o baseline se a grade gravar pelo BOM). */
  estadoJson: string;
  /** JSON do baseline semeado (`gradeRevendaBaseRef.current`) — p/ conferir se o servidor mudou (importado). */
  baseJson: string;
  /** Importado: a grade grava PELO BOM (a revenda grava por `salvar_grade_revenda`, que recusa origem ≠ revenda). */
  gravaPeloBom: boolean;
  /** R1 do G-plano F3.4 — a grade do SERVIDOR lida no PRÓPRIO Salvar (`lerGradeServidorComprado`: `rev` + grade num SELECT
   *  só). NUNCA o cache `plan-ficha-grades`. null = não lida (card novo) — num comprado que grava o BOM, a captura LANÇA. */
  servidor: GradeRowDb[] | null;
};

```

(b) Substituir, dentro de `BomCapturado`, a linha `  cad: CadCapturado;` (F3.3) por:

```ts
  cad: CadCapturado;
  /** F3.4 — comprado: o `_grades` do `salvar_modelo_bom` (a grade cor × tamanho — ele APAGA todas). null = interno (`estado.grades`). */
  gradesPayload: GradeRow[] | null;
  /** F3.4 — importado: a grade cor × tamanho grava por ESTE BOM; o JSON do rascunho enviado vira o baseline dela. */
  gradeExterna: { estadoJson: string } | null;
  /** F3.4 — importado: a grade do SERVIDOR mudou desde a abertura (outra pessoa) ⇒ o Salvar não grava (P0409 + recarga). */
  gradeConflito: boolean;
```

- [ ] **Step 2: `persistir-bom.ts` — o comprado manda a grade dele, lida no Salvar (R1)**

(a) Substituir `    _grades: montarGradesPayload(bom.estado.grades) as any,` por:

```ts
    // F3.4 — comprado: a grade cor × tamanho (a RPC apaga TODAS as grades — nunca mandar a da ficha, que é projetada fora).
    // `gradesPayload` null num comprado só existe quando o BOM NÃO grava (a captura LANÇA antes — R1 do G-plano F3.4).
    _grades: (bom.gradesPayload ?? montarGradesPayload(bom.estado.grades)) as any,
```

(b) No import de `./ficha-calc`, trocar `  type BomCapturado,` por `  type BomCapturado, type GradeRowDb,`.

(c) No FIM do arquivo, acrescentar:

```ts
/**
 * F3.4 — R1 do G-plano F3.4. A grade do SERVIDOR que o `salvar_modelo_bom` de um card COMPRADO recebe (ele APAGA todas as
 * grades) é LIDA NO PRÓPRIO Salvar — nunca o cache `plan-ficha-grades`: uma mudança alheia sem toque só INVALIDA o cache
 * (useFichaTecnica `aoMudarNoServidor`) e o merge já avançou o `revRef`; um Salvar nessa janela passaria no `.eq("rev")` do
 * header e regravaria a grade VELHA por cima da nova. `rev` e grade vêm num SELECT só (embed `modelo_grades`, o mesmo de
 * PlanTecidoSheet.tsx:457) ⇒ do mesmo instante. `rev` lido ≠ o do card AGORA (`revDoCard()` DEPOIS do await — é o valor que
 * o header confere logo em seguida, sem outro `await` no meio: `let revParaHeader = revRef.current`) ⇒ P0409: o retry que já
 * existe relê o modelo e o BOM e tenta 1×. Erro ⇒ lança: falha FECHADA (nunca devolve [] como "o servidor não tem grade").
 */
export async function lerGradeServidorComprado(modeloId: string, revDoCard: () => number | null): Promise<GradeRowDb[]> {
  const { data, error } = await (supabase.from("modelos") as any)
    .select("rev, grades:modelo_grades(variante_numero, grades, grade_total)")
    .eq("id", modeloId)
    .single();
  if (error) throw error;
  if (!data || !Array.isArray(data.grades)) {
    throw new Error("Não deu para conferir a grade deste card no servidor — nada foi salvo. Tente de novo.");
  }
  const rev = revDoCard();
  if (rev === null || data.rev !== rev) {
    const conflito: any = new Error("conflito_versao: o registro foi salvo por outra pessoa");
    conflito.code = "P0409";
    throw conflito;
  }
  return data.grades as GradeRowDb[];
}
```

- [ ] **Step 3: `useFichaBom.ts` — a grade externa desliga os acoplamentos com o Tecido 1**

(a) Trocar a assinatura `export function useFichaBom({ modeloId, habilitada, dados, tecidosPlanejados, proporcoes, setDraftTracked, aoRecarregarComTocado, aoMudarBloco }: {` por:

```ts
export function useFichaBom({ modeloId, habilitada, dados, tecidosPlanejados, proporcoes, setDraftTracked, aoRecarregarComTocado, aoMudarBloco, gradeExterna = false }: {
```

e, depois de `  aoMudarBloco?: (tipo: string, numero: number, patch: PatchBlocoCad) => void;`, inserir:

```ts
  /** F3.4 — comprado: a grade é a cor × tamanho do produto (fora da ficha) — Tecido 1 e grade não se tocam. */
  gradeExterna?: boolean;
```

(b) Herança de grade: trocar `    if (!hidratado || tecido1VarianteIds.length === 0) return;` por `    if (gradeExterna || !hidratado || tecido1VarianteIds.length === 0) return;` e `  }, [tecido1VarianteIds, hidratado, grades]);` por `  }, [tecido1VarianteIds, hidratado, grades, gradeExterna]);`.

(c) Troca do Tecido 1: trocar `    if (isTecido1 && patch.artigo_id !== undefined && patch.artigo_id !== target.artigo_id) {` por `    if (!gradeExterna && isTecido1 && patch.artigo_id !== undefined && patch.artigo_id !== target.artigo_id) {`.

(d) Remover variante do Tecido 1: trocar `    if (isTecido1 && !value) {` por `    if (!gradeExterna && isTecido1 && !value) {`.

- [ ] **Step 4: `useFichaTecnica.ts` — imports, constantes e tipo**

(a) Trocar `  type AviamentoRowDb, type BomCapturado, type EstadoBom, type EtiquetaRowDb, type GradeRowDb, type OcLinkRowDb,` por:

```ts
  type AviamentoRowDb, type BomCapturado, type EstadoBom, type EtiquetaRowDb, type GradeExternaCaptura, type GradeRowDb, type OcLinkRowDb,
```

(b) Depois de `import { requisitosUniao, seloSecaoBom, type SecaoBomKey, type SeloSecao } from "./selos-bom";`, inserir:

```ts
import { gradeCompradoMudouNoServidor, gradesParaBomComprado, requeridasPorOrigem } from "../comprado";
```

(c) Depois de `const SEM_LABELS: Record<string, string> = {};`, inserir:

```ts
// F3.4 — identidades ESTÁVEIS p/ o comprado (sem grade da ficha; sem pré-preenchimento de Tecido 1..N).
const SEM_GRADES: EstadoBom["grades"] = [];
const SEM_PLANEJADOS: string[] = [];
```

(d) Trocar `  capturar: (custosAdicionais: unknown, opts?: { retry?: boolean; proporcoes?: Record<string, number> }) => BomCapturado;` por:

```ts
  capturar: (custosAdicionais: unknown, opts?: { retry?: boolean; proporcoes?: Record<string, number>; gradeExterna?: GradeExternaCaptura }) => BomCapturado;
```

- [ ] **Step 5: `useFichaTecnica.ts` — a ficha abre p/ o comprado, sem grade e sem CAD**

(a) Substituir as 2 linhas:

```ts
  // Só produto interno na F3.2 (decisão F3 #4; comprado = F3.4).
  const habilitada = a.isEdit && !!a.modeloId && !a.isComprado && podeVerFicha;
```

por:

```ts
  // F3.4 — comprado também (decisões F3 #4/#8): QUAIS seções aparecem é do orquestrador (`vis`, pelo "Fluxo de Revenda");
  // a ficha carrega p/ quem vê o Desenvolvimento porque o Salvar do comprado também grava o BOM (aviamentos/insumos e, no
  // importado, a grade cor × tamanho — plano F3.4 §3).
  const habilitada = a.isEdit && !!a.modeloId && podeVerFicha;
  // F3.4 — comprado: a grade é EXTERNA à ficha (a cor × tamanho do produto, `useGradeComprado`) e o CAD nunca grava.
  // Espelho SÍNCRONO p/ os callbacks e a captura (rodam fora do render — mesma razão do `podeEditarRef`).
  const compradoRef = useRef(a.isComprado);
  compradoRef.current = a.isComprado;
  /** A ficha do comprado não carrega/compara/grava a grade dela: projeta `grades: []` nos DOIS lados de toda comparação
   *  (snapshot do "não salvo", assinatura/referência R5/R5a, captura) — a grade do comprado tem dono próprio. */
  const projetar = (e: EstadoBom): EstadoBom => (compradoRef.current ? { ...e, grades: SEM_GRADES } : e);
```

(b) Trocar `  tecidosPlanejadosRef.current = a.tecidosPlanejados;` por `  tecidosPlanejadosRef.current = a.isComprado ? SEM_PLANEJADOS : a.tecidosPlanejados;`.

(c) Na chamada `useFichaBom({ … })`, trocar a linha `    tecidosPlanejados: a.tecidosPlanejados, proporcoes: a.proporcoes, setDraftTracked: a.setDraftTracked,` por:

```ts
    // F3.4 — comprado não pré-preenche Tecido 1..N (não fabrica) e a grade da ficha fica de fora (a do produto manda).
    tecidosPlanejados: a.isComprado ? SEM_PLANEJADOS : a.tecidosPlanejados, proporcoes: a.proporcoes, setDraftTracked: a.setDraftTracked,
    gradeExterna: a.isComprado,
```

(d) R5a — trocar a 1ª linha do callback `  aoRecarregarComTocadoRef.current = (servidor) => {` por:

```ts
  aoRecarregarComTocadoRef.current = (servidorBruto) => {
    // F3.4 — comprado: a grade não é da ficha (projetada fora dos DOIS lados da comparação).
    const servidor = projetar(servidorBruto);
```

(e) Estado da ficha — substituir:

```ts
    () => ({ blocks: bom.blocks, aviamentos: bom.aviamentosState, etiquetas: bom.etiquetasState, grades: bom.grades }),
    [bom.blocks, bom.aviamentosState, bom.etiquetasState, bom.grades],
```

por:

```ts
    () => ({ blocks: bom.blocks, aviamentos: bom.aviamentosState, etiquetas: bom.etiquetasState, grades: a.isComprado ? SEM_GRADES : bom.grades }),
    [bom.blocks, bom.aviamentosState, bom.etiquetasState, bom.grades, a.isComprado],
```

(f) CAD — substituir `  const cadGravavel = podeEditar && (dados.cadExiste || a.ordemEnviada);` por:

```ts
  // F3.4 — comprado: o Planejamento NUNCA grava o CAD (o da revenda nasce no recebimento da OC, com as etiquetas "a
  // enviar" = consumo × peças REAIS — `_receber_oc_p_acabado_core`; o `salvar_cad_completo` as apagaria e regravaria pelo
  // planejado). Seção CAD só-leitura p/ comprado.
  const cadGravavel = !a.isComprado && podeEditar && (dados.cadExiste || a.ordemEnviada);
```

(g) Requisitos por origem — substituir `    () => requisitosUniao(a.isComprado ? dados.revendaCfg.requisitos : (dados.tenantCfg as any)?.kanban_requisitos),` por:

```ts
    () => requeridasPorOrigem(a.isComprado, requisitosUniao(a.isComprado ? dados.revendaCfg.requisitos : (dados.tenantCfg as any)?.kanban_requisitos)),
```

(h) `bomMudouNoServidor` — substituir:

```ts
      const servidor = estadoBomDoServidor({
        tecidos: tec.tecidos, variantes: tec.variantes, ocLinks: oc, aviamentos: av, etiquetas: et, grades: gr,
        planejados: tecidosPlanejadosRef.current,
      });
```

por:

```ts
      const servidor = projetar(estadoBomDoServidor({
        tecidos: tec.tecidos, variantes: tec.variantes, ocLinks: oc, aviamentos: av, etiquetas: et, grades: gr,
        planejados: tecidosPlanejadosRef.current,
      }));
```

(i) `capturarCad` — substituir `      podeEditar: podeEditarRef.current, cadHidratado: c.hidratado, cadExiste: c.existe, ordemEnviada: c.ordemEnviada,` por:

```ts
      podeEditar: podeEditarRef.current && !compradoRef.current, cadHidratado: c.hidratado, cadExiste: c.existe, ordemEnviada: c.ordemEnviada,
```

(j) Antes de `  const save: FichaSave = {`, inserir:

```ts
  /** F3.4 — importado: célula da grade cor × tamanho editada. A grade grava POR ESTE BOM (plano F3.4 §3), então a ficha fica
   *  "tocada" p/ a conferência com o servidor (R5/R5a) proteger o Salvar — o "não salvo" dela vem da própria grade. */
  const marcarGradeExternaEditada = () => {
    if (compradoRef.current && podeEditarRef.current) bom.marcarTocado();
  };

```

- [ ] **Step 6: `useFichaTecnica.ts` — captura com a grade externa, pós-save e retorno**

(a) Na `capturar`, trocar `      const e = bom.estadoRef.current;` por `      const e = projetar(bom.estadoRef.current);`.

(b) Substituir as 2 linhas:

```ts
      const gravar = podeEditarRef.current
        && ((bom.colecoesTouchadasRef.current && (base === null || snap !== base)) || bom.prefillPendenteRef.current);
```

por:

```ts
      // F3.4 — comprado: a grade cor × tamanho é a fonte (decisão F3 #4). `salvar_modelo_bom` APAGA todas as grades, então o
      // BOM do comprado leva a grade dela (`gradesPayload`: editada ⇒ o rascunho; senão a do SERVIDOR LIDA NO PRÓPRIO SALVAR
      // — `ge.servidor`, R1 do G-plano F3.4: nunca o cache `plan-ficha-grades`, que fica VELHO na janela entre uma mudança
      // alheia sem toque e o refetch). No IMPORTADO a grade grava POR AQUI (não há `salvar_grade_revenda` p/ importado),
      // então a grade editada também faz o BOM gravar; se a do servidor mudou desde a abertura ⇒ conflito.
      const ge = compradoRef.current ? opts?.gradeExterna ?? null : null;
      const servidorGrades = ge?.servidor ?? null;
      const gravaPelaGrade = ge !== null && ge.gravaPeloBom && ge.editada;
      const gravar = podeEditarRef.current
        && ((bom.colecoesTouchadasRef.current && (base === null || snap !== base)) || bom.prefillPendenteRef.current || gravaPelaGrade);
      // R1 — falha FECHADA: comprado que grava o BOM sem a grade do servidor lida AGORA não grava nada (sem `?? []`: lista
      // vazia apagaria a grade inteira; o cache poderia regravar uma grade velha por cima da de outra pessoa).
      if (compradoRef.current && gravar && servidorGrades === null) {
        throw new Error("Não deu para conferir a grade deste card no servidor — nada foi salvo. Tente de novo.");
      }
      const gradeConflito = gravar && gravaPelaGrade && ge !== null && servidorGrades !== null
        && gradeCompradoMudouNoServidor(ge.baseJson, servidorGrades);
```

(c) Trocar `        flags: { ...bom.flagsRef.current },` por `        flags: { ...bom.flagsRef.current, grade: bom.flagsRef.current.grade || gravaPelaGrade },`.

(d) Depois de `        cad: capturarCad(e, gravar, !!opts?.retry, opts?.proporcoes ?? a.proporcoes),`, inserir:

```ts
        // null num comprado só quando NÃO grava (acima, gravar sem a leitura fresca lança) — persistirBom nem roda.
        gradesPayload: compradoRef.current && servidorGrades !== null
          ? gradesParaBomComprado({ editada: !!ge?.editada, rascunho: ge?.rascunho ?? [], servidor: servidorGrades })
          : null,
        gradeExterna: gravaPelaGrade && ge !== null ? { estadoJson: ge.estadoJson } : null,
        gradeConflito,
```

(e) Em `aposSalvar`, trocar `      const vivo = snapshotBom(bom.estadoRef.current);` por `      const vivo = snapshotBom(projetar(bom.estadoRef.current));`.

(f) No `return`, depois de `    cadGravavel, cadAntesDaOrdem: !dados.cadExiste && !a.ordemEnviada,`, inserir:

```ts
    // F3.4 — comprado: a grade é a cor × tamanho do produto (fora da ficha); a célula editada no importado marca a ficha.
    gradeExterna: a.isComprado, marcarGradeExternaEditada,
    // R7 do G-plano F3.4 — a ficha foi tocada (a Origem não muda com edição pendente: a referência do BOM foi calculada com a
    // projeção desta origem). `tocado`, não `dirty`: editar e desfazer mantém a referência presa à projeção de agora.
    tocado: bom.tocado,
```

- [ ] **Step 7: Prova por texto + gates (sem commit — a Task 5 commita junto)**

```bash
F=src/components/planejamento/planejamento-detail/ficha
grep -cF "!a.isComprado && podeVerFicha" $F/useFichaTecnica.ts          # 0 (a ficha abre p/ comprado)
grep -cF "projetar(" $F/useFichaTecnica.ts                              # 4 (R5a, bomMudouNoServidor, capturar, aposSalvar)
grep -cF "podeEditar: podeEditarRef.current && !compradoRef.current," $F/useFichaTecnica.ts   # 1 (CAD barrado)
grep -cF "const cadGravavel = !a.isComprado && podeEditar" $F/useFichaTecnica.ts             # 1
grep -cF "bom.gradesPayload ??" $F/persistir-bom.ts                     # 1
grep -cF "!gradeExterna && isTecido1" $F/useFichaBom.ts                 # 2
grep -cF "const servidorGrades = ge?.servidor ?? null;" $F/useFichaTecnica.ts                  # 1 (R1: a grade vem da leitura do Salvar)
grep -cF 'getQueryData<GradeRowDb[]>(["plan-ficha-grades", a.modeloId])' $F/useFichaTecnica.ts # 0 (R1: nunca o cache na captura)
grep -cF "if (compradoRef.current && gravar && servidorGrades === null) {" $F/useFichaTecnica.ts # 1 (R1: falha fechada)
grep -cF "export async function lerGradeServidorComprado(" $F/persistir-bom.ts                # 1
grep -cF "    tocado: bom.tocado," $F/useFichaTecnica.ts                                        # 1 (R7)
bash .superpowers/f34/gates.sh
```

Expected: como nos comentários; `GATES F3.4: ok`. (A F3.4 ainda não passa `gradeExterna` no Salvar: num comprado que GRAVA o BOM a captura FALHA FECHADA — lança, nada grava — até a Task 5, commitada junto; interno igual.)

---

## Task 5: Salvar do comprado — `usePlanejamentoSave`  *(individual Opus, JUNTO com a Task 4)*

**Files:**
- Modify: `src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts`
- Modify: `src/components/planejamento/PlanejamentoDetail.tsx` (passa `piOn`, `gradeCompradoPeloBom`)

**Interfaces:**
- Consumes: Task 4 (`capturar(…, { gradeExterna })`, `BomCapturado.gradeExterna/gradeConflito`, `lerGradeServidorComprado`); Task 3 (`gradeComprado`, `origemSalva`, `piOn`).
- Produces: `usePlanejamentoSave({…, piOn: boolean, gradeCompradoPeloBom: boolean})`; leitura fresca da grade no Salvar do comprado (R1); auto-criação do Produto Importado com a conferência dos dois espelhos (R3); erro `P0409` + `gradeConflict` no conflito da grade do importado (tratado pelo `onError` que já existe); `P0409` simples quando o `rev` lido ≠ o do card (o retry que já existe).

- [ ] **Step 1: Argumentos**

(a) No tipo `UsePlanejamentoSaveArgs`, depois de `  paOn: boolean;`, inserir:

```ts
  /** F3.4 — módulo `produto_importado` ligado (auto-criação do Produto Importado ao salvar — D1). */
  piOn: boolean;
```

e depois de `  buildLinhasGradeRevenda: () => { variante_numero: number; grades: Record<string, number>; grade_total: number }[];`, inserir:

```ts
  /** F3.4 — a grade cor × tamanho deste card grava pelo BOM (`salvar_modelo_bom`)? = card IMPORTADO salvo (a revenda grava
   *  por `salvar_grade_revenda`, que recusa origem ≠ revenda — plano F3.4 §3). */
  gradeCompradoPeloBom: boolean;
```

(b) Na desestruturação, trocar `  modeloId, isEdit, isRevenda, paOn, podeEditarPreco, podeVerCustos, podeEditarDev, refEditavel, categorias,` por `  modeloId, isEdit, isRevenda, paOn, piOn, podeEditarPreco, podeVerCustos, podeEditarDev, refEditavel, categorias,` e `  gradeRevenda, setGradeRevenda, gradeRevendaDirty, gradeRevendaBaseRef, gradeRevendaRevRef, buildLinhasGradeRevenda,` por `  gradeRevenda, setGradeRevenda, gradeRevendaDirty, gradeRevendaBaseRef, gradeRevendaRevRef, buildLinhasGradeRevenda, gradeCompradoPeloBom,`.

(c) Depois de `import { ehOrigemComprada } from "@/lib/origem";`, inserir:

```ts
import { lerGradeServidorComprado } from "@/components/planejamento/planejamento-detail/ficha/persistir-bom";
```

- [ ] **Step 2: Leitura fresca da grade (R1), captura com a grade externa + conflito da grade do importado**

Substituir `      const bom = fichaRef.current.capturar(d.custos_adicionais, { retry: retryRef.current, proporcoes: d.proporcoes });` por:

```ts
      // F3.4 — R1 do G-plano F3.4: num comprado, a grade do SERVIDOR que vai no BOM é LIDA AGORA, com o `rev`, numa
      // requisição só (`lerGradeServidorComprado`) — nunca o cache `plan-ficha-grades`: uma mudança alheia sem toque só
      // INVALIDA o cache e o merge já avançou o `revRef`; um Salvar nessa janela passaria no `.eq("rev")` e o
      // `salvar_modelo_bom` (APAGA todas as grades) regravaria a grade VELHA. `rev` lido ≠ o do card ⇒ P0409 (o retry que já
      // existe, abaixo no onError, relê o modelo e o BOM); erro ⇒ lança (nada grava). O `rev` é conferido DEPOIS do await
      // (`() => revRef.current`) e daqui até o `let revParaHeader = revRef.current;` não há outro `await` — o header confere
      // o MESMO rev da leitura. Origem do RASCUNHO = a que a ficha usa p/ projetar (com a trava R7, só difere da salva com a
      // ficha intocada). `d` foi congelado antes do await: edição feita durante a leitura fica "não salva" (paridade F3.2).
      const gradeServidor = isEdit && modeloId && ehOrigemComprada(d.origem)
        ? await lerGradeServidorComprado(modeloId, () => revRef.current)
        : null;
      const bom = fichaRef.current.capturar(d.custos_adicionais, {
        retry: retryRef.current, proporcoes: d.proporcoes,
        // F3.4 — comprado: a grade cor × tamanho entra no BOM (fonte única — decisão F3 #4). A ficha só a usa num comprado.
        gradeExterna: {
          rascunho: buildLinhasGradeRevenda(),
          editada: gradeRevendaDirty,
          estadoJson: JSON.stringify(gradeRevenda),
          baseJson: gradeRevendaBaseRef.current,
          gravaPeloBom: gradeCompradoPeloBom,
          servidor: gradeServidor,
        },
      });
      // F3.4 — importado: a grade editada grava pelo BOM; se a grade do SERVIDOR mudou desde que este card abriu (outra
      // pessoa), NÃO sobrescreve — mesmo tratamento da revenda (P0409 + recarga da grade: ramo `gradeConflict` do onError).
      // Lançado ANTES de qualquer escrita.
      if (bom.gradeConflito) {
        const conflito: any = new Error("conflito_versao: a grade foi salva por outra pessoa");
        conflito.code = "P0409";
        conflito.gradeConflict = true;
        throw conflito;
      }
```

- [ ] **Step 3: A grade do importado gravou ⇒ baseline**

Substituir `          fichaRef.current.bomGravado(bom);` por:

```ts
          fichaRef.current.bomGravado(bom);
          // F3.4 — importado: a grade cor × tamanho gravou junto com o BOM ⇒ o enviado vira o baseline do rascunho da grade
          // (mesmo cuidado do caminho da revenda acima: um retry não a regrava como "editada").
          if (bom.gradeExterna) gradeRevendaBaseRef.current = bom.gradeExterna.estadoJson;
```

- [ ] **Step 4: Auto-criação do Produto Importado (D1)**

(a) Trocar `      let autoProduto: { criou: boolean; semColecao: boolean } | null = null;` por `      let autoProduto: { criou: boolean; semColecao: boolean; tela?: string } | null = null;`.

(a2) R3 do G-plano F3.4 — a auto-criação da REVENDA (texto de hoje) também confere o outro espelho. Substituir a linha `          if (!existente) {` (a do bloco do Produto Acabado) por:

```ts
          // F3.4 — R3 do G-plano F3.4 (invariante #13): nunca o 2º espelho. Com o módulo Produto Importado ligado, um produto
          // importado vinculado a este card (card que já foi importado e voltou) barra a criação — leitura com erro ⇒ lança
          // (o catch abaixo mantém o save do card e NÃO cria). Módulo desligado: a RLS esconde a tabela — resíduo na §6 R14.
          let outroImp: unknown = null;
          if (!existente && piOn) {
            const { data: impVinculado, error: outroImpErr } = await supabase
              .from("produtos_importados" as any)
              .select("id")
              .eq("modelo_id", savedId)
              .maybeSingle();
            if (outroImpErr) throw outroImpErr;
            outroImp = impVinculado;
          }
          if (!existente && !outroImp) {
```

(A chave `}` que fechava o `if (!existente) {` segue fechando o novo `if` — só a linha de abertura muda.)

(b) Substituir as 3 linhas que fecham o bloco da revenda:

```ts
          console.error("Auto-criação do produto acabado (revenda) falhou — save do card mantido:", autoErr);
        }
      }
```

por:

```ts
          console.error("Auto-criação do produto acabado (revenda) falhou — save do card mantido:", autoErr);
        }
      }
      // F3.4 — decisão F3 #3 + D1 (ii): card criado (ou editado pra) origem='importado' sem produto vinculado ganha o espelho no
      // Produto Importado AUTOMATICAMENTE — mesma receita da revenda acima (`salvar_produto_importado` com variantes e etapas
      // vazias + vínculo `modelo_id`; câmbio/etapas/variantes se completam na tela do Produto Importado). Best-effort: erro
      // aqui NUNCA quebra o save do card. `_rev_base: null` = a assinatura de 5 argumentos (há sobrecarga de 4 e 5 — mesma
      // chamada da tela do Produto Importado, ProdutoImportadoSheet.tsx:641-647).
      // R3 do G-plano F3.4 (invariante #13): confere os DOIS espelhos NA HORA — leitura com erro ⇒ lança ⇒ o catch mantém o
      // save do card e NÃO cria; produto acabado vinculado (card que já foi revenda) ⇒ não cria o 2º espelho.
      if (savedId && d.origem === "importado" && piOn) {
        try {
          const { data: existenteImp, error: existenteImpErr } = await supabase
            .from("produtos_importados" as any)
            .select("id")
            .eq("modelo_id", savedId)
            .maybeSingle();
          if (existenteImpErr) throw existenteImpErr;
          const { data: outroPa, error: outroPaErr } = await supabase
            .from("produtos_acabados" as any)
            .select("id")
            .eq("modelo_id", savedId)
            .maybeSingle();
          if (outroPaErr) throw outroPaErr;
          if (!existenteImp && !outroPa) {
            const catImp = categorias.find((c) => c.id === d.categoria_principal_id);
            const grupoImp = catImp?.grupo_id ?? null;
            if (grupoImp && d.categoria_principal_id && d.nome.trim()) {
              const { data: novoImpId, error: piErr } = await supabase.rpc("salvar_produto_importado" as any, {
                _id: null,
                _dados: {
                  nome: d.nome,
                  grupo_id: grupoImp,
                  categoria_id: d.categoria_principal_id,
                  subcategoria1_id: d.subcategoria1_id,
                  subcategoria2_id: d.subcategoria2_id,
                  colecao_id: d.colecao_id,
                  subcolecao: d.subcolecao || null,
                  semana: d.semana || null,
                },
                _variantes: [],
                _etapas: [],
                _rev_base: null,
              });
              if (piErr) throw piErr;
              const { error: linkImpErr } = await (supabase.from("produtos_importados" as any) as any)
                .update({ modelo_id: savedId }).eq("id", novoImpId);
              if (linkImpErr) throw linkImpErr;
              autoProduto = { criou: true, semColecao: !d.colecao_id, tela: "Produto Importado" };
            }
          }
        } catch (autoErr) {
          console.error("Auto-criação do produto importado falhou — save do card mantido:", autoErr);
        }
      }
```

(c) Substituir o bloco dos toasts:

```ts
      if (result?.autoProduto?.criou) {
        if (result.autoProduto.semColecao) {
          toast.success('Produto criado no Produto Acabado — defina a coleção do modelo pra ele aparecer no canvas.');
        } else {
          toast.success("Produto criado no Produto Acabado.");
        }
      }
```

por:

```ts
      if (result?.autoProduto?.criou) {
        const tela = result.autoProduto.tela ?? "Produto Acabado";
        if (result.autoProduto.semColecao) {
          toast.success(`Produto criado no ${tela} — defina a coleção do modelo pra ele aparecer no canvas.`);
        } else {
          toast.success(`Produto criado no ${tela}.`);
        }
      }
```

(d) Depois das 2 linhas `        qc.invalidateQueries({ queryKey: ["pa-produto-modelo", modeloId] });` + `      }` (fim do `if (savedDraft.origem === "revenda")` do onSuccess), inserir:

```ts
      // F3.4 — o comprado lê o produto (vínculo, variantes) e a troca de Origem olha os tecidos e os DOIS espelhos (R3) do
      // servidor (`plan-origem-espelhos` tem `piOn` na key — prefixo).
      qc.invalidateQueries({ queryKey: ["plan-comprado-produto", modeloId] });
      qc.invalidateQueries({ queryKey: ["plan-origem-tem-tecidos", modeloId] });
      qc.invalidateQueries({ queryKey: ["plan-origem-espelhos", modeloId] });
      if (savedDraft.origem === "importado") {
        qc.invalidateQueries({ predicate: (q) => typeof q.queryKey?.[0] === "string"
          && ((q.queryKey[0] as string).startsWith("produtos-importados") || q.queryKey[0] === "produto-importado-contagem-por-colecao") });
      }
```

- [ ] **Step 5: `PlanejamentoDetail.tsx` — passa os argumentos novos**

(a) Na chamada `usePlanejamentoSave({ … })`, trocar `    modeloId, isEdit, isRevenda, paOn, podeEditarPreco, podeVerCustos, podeEditarDev, categorias,` por `    modeloId, isEdit, isRevenda, paOn, piOn, podeEditarPreco, podeVerCustos, podeEditarDev, categorias,`.

(b) Trocar `    gradeRevenda, setGradeRevenda, gradeRevendaDirty, gradeRevendaBaseRef, gradeRevendaRevRef, buildLinhasGradeRevenda,` (a linha da chamada) por:

```ts
    gradeRevenda, setGradeRevenda, gradeRevendaDirty, gradeRevendaBaseRef, gradeRevendaRevRef, buildLinhasGradeRevenda,
    // F3.4 — a grade do IMPORTADO grava pelo BOM (a da revenda por `salvar_grade_revenda`). Origem SALVA (a da grade).
    gradeCompradoPeloBom: origemSalva === "importado",
```

- [ ] **Step 6: Prova por texto + gates**

```bash
D=src/components/planejamento/planejamento-detail
grep -cF "gradeExterna: {" $D/usePlanejamentoSave.ts                                   # 1
grep -cF "conflito.gradeConflict = true;" $D/usePlanejamentoSave.ts                   # 1
grep -cF 'rpc("salvar_produto_importado"' $D/usePlanejamentoSave.ts                    # 1
grep -cF "if (bom.gradeExterna) gradeRevendaBaseRef.current = bom.gradeExterna.estadoJson;" $D/usePlanejamentoSave.ts   # 1
grep -cF "? await lerGradeServidorComprado(modeloId, () => revRef.current)" $D/usePlanejamentoSave.ts                  # 1 (R1)
grep -cF "if (!existente && !outroImp) {" $D/usePlanejamentoSave.ts                                                     # 1 (R3, revenda)
grep -cF "if (!existenteImp && !outroPa) {" $D/usePlanejamentoSave.ts                                                   # 1 (R3, importado)
grep -cF '"plan-origem-espelhos"' $D/usePlanejamentoSave.ts                                                             # 1
awk '/if \(bom\.gradeConflito\)/{a=NR} /\.update\(payload\)\.eq\("id", modeloId\)\.eq\("rev", revParaHeader\)/{b=NR} END{print (a && b && a<b) ? "conflito da grade ANTES do header: ok" : "ORDEM ERRADA"}' $D/usePlanejamentoSave.ts
# R1 — a leitura fresca vem ANTES da captura, e da captura até o `let revParaHeader` NENHUM await (o header confere o rev lido).
awk '/await lerGradeServidorComprado\(/{l=NR} /fichaRef\.current\.capturar\(d\.custos_adicionais/{a=NR} /let revParaHeader = revRef\.current;/{b=NR} a && !b && /^[^\/]*await /{n++} END{print (l && a && b && l<a && a<b && n==0) ? "leitura fresca → captura → rev do header, sem await no meio: ok" : "ORDEM/AWAIT ERRADO — PARE"}' $D/usePlanejamentoSave.ts
bash .superpowers/f34/gates.sh
```

Expected: `1` ×8; `conflito da grade ANTES do header: ok`; `leitura fresca → captura → rev do header, sem await no meio: ok`; `GATES F3.4: ok`.

- [ ] **Step 7: Commit (Tasks 4 + 5)**

```bash
D=src/components/planejamento/planejamento-detail; F=$D/ficha
FS="$F/useFichaTecnica.ts $F/useFichaBom.ts $F/ficha-calc.ts $F/persistir-bom.ts $D/usePlanejamentoSave.ts src/components/planejamento/PlanejamentoDetail.tsx"
git add -- $FS
git commit --only -m "feat(planejamento): F3.4 (4/5) — a ficha abre p/ o comprado sem grade própria e sem CAD; o BOM do comprado leva a grade cor × tamanho lida no Salvar junto com o rev (importado grava por ela); conflito da grade; auto-criação do Produto Importado sem 2º espelho

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- $FS
```

**Revisão individual (Opus) das Tasks 4+5 juntas:** (1) `projetar` nos DOIS lados de TODA comparação (snapshot/guarda, referência do `useEffect` via `estado`, `bomGravado`/`aposSalvar` via `bomEnviado.estado`, R5a, `bomMudouNoServidor`) — nenhum "não salvo" preso nem "Tecidos & BOM" falso por causa da grade; (2) R1 do G-plano F3.4 — `gradesPayload` num comprado vem da grade LIDA no Salvar (`lerGradeServidorComprado`: `rev` + grade num SELECT só), nunca do cache `plan-ficha-grades`; o `rev` é conferido DEPOIS do await (`() => revRef.current`) e não há `await` entre a captura e o `let revParaHeader` (awk do Step 6) — o header confere o MESMO rev da leitura; `rev` diferente ⇒ P0409 no retry que já existe; comprado que grava sem a leitura ⇒ lança (nunca `[]` por engano); o cenário do cache velho está no QA S5 e o do rev à frente no S5b; (3) revenda: grade editada → `salvar_grade_revenda` (antes do header) e, se o BOM gravar, o MESMO rascunho vai no `_grades`; grade não editada → a do servidor; (4) importado: grade editada sem permissão de ficha não é possível (UI só-leitura — Task 7) e, se fosse, `gravar` exige `podeEditar`; conflito lança ANTES de qualquer escrita e cai no ramo `gradeConflict` (recarrega a grade e o rev); (5) `cadGravavel`/`deveGravarCad` barrados p/ comprado — nenhum caminho chama `salvar_cad_completo` num comprado; (6) comprado sem pré-preenchimento de Tecido 1..N (`prefillPendenteRef` nunca liga: `planejados = []`); (7) auto-criação do importado: só com módulo, grupo, categoria e nome; `_rev_base: null` (5 argumentos); erro não derruba; invalidações (inclusive `plan-origem-espelhos`); R3 — as DUAS auto-criações conferem o outro espelho na hora e, com erro na leitura, não criam; (8) F3.2/F3.3 intactas (gates 6 e 7) e o interno byte a byte igual no caminho de gravação (`gradesPayload = null` ⇒ `montarGradesPayload(bom.estado.grades)`).

---

## Task 6: Origem ganha "Importado" com as regras da D1  *(Lote B)*

**Files:**
- Modify: `src/components/planejamento/planejamento-detail/InfoGeraisSecao.tsx`
- Modify: `src/components/planejamento/PlanejamentoDetail.tsx`

**Interfaces:**
- Consumes: Task 1 (`opcoesOrigem`, `OpcaoOrigem`, `espelhosDoCard`, `EspelhosCard`); Task 3 (`gradeComprado.gradeRevendaDirty`, `origemSalva`, `piOn`); Task 4 (`ficha.tocado`).
- Produces: `InfoGeraisSecao({…, origemOpcoes: OpcaoOrigem[]})`; no orquestrador `temTecidosServidor` (query `["plan-origem-tem-tecidos", modeloId]`), `qEspelhos` (query `["plan-origem-espelhos", modeloId, piOn]` — R3) e `origemOpcoesLista`.

- [ ] **Step 1: `InfoGeraisSecao.tsx`**

(a) Depois de `import { Secao, FieldText, FieldSelect } from "@/components/planejamento/planejamento-detail/campos";`, inserir:

```ts
import type { OpcaoOrigem } from "@/components/planejamento/planejamento-detail/comprado";
```

(b) Trocar `  draft, setDraftTracked, grupoSel, setGrupoSel, grupos, categorias, estilistas, sub1Opts, sub2Opts, fl, numero, selo,` por `  draft, setDraftTracked, grupoSel, setGrupoSel, grupos, categorias, estilistas, sub1Opts, sub2Opts, fl, numero, selo, origemOpcoes,` e, depois de `  selo?: React.ReactNode;`, inserir:

```ts
  /** F3.4 — opções do Select "Origem" (com "Importado" pelo módulo; troca travada pelas regras da D1 — `opcoesOrigem`). */
  origemOpcoes: OpcaoOrigem[];
```

(c) Substituir:

```tsx
                <Select value={draft.origem} onValueChange={(v) => setDraftTracked((d) => ({ ...d, origem: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="interno">Interno</SelectItem>
                    <SelectItem value="revenda">Revenda</SelectItem>
                  </SelectContent>
                </Select>
```

por:

```tsx
                <Select value={draft.origem} onValueChange={(v) => setDraftTracked((d) => ({ ...d, origem: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {origemOpcoes.map((o) => (
                      <SelectItem key={o.value} value={o.value} disabled={o.disabled}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {/* F3.4 — D1: por que a troca está travada (item desabilitado do Radix não mostra `title`). */}
                {origemOpcoes.some((o) => o.disabled && o.motivo) && (
                  <p className="text-xs text-muted-foreground">{origemOpcoes.find((o) => o.disabled && o.motivo)?.motivo}</p>
                )}
```

- [ ] **Step 2: `PlanejamentoDetail.tsx`**

(a) Depois de `import { revendaCampoVisivel } from "@/lib/revenda-config";`, inserir:

```ts
import { espelhosDoCard, opcoesOrigem, type EspelhosCard } from "@/components/planejamento/planejamento-detail/comprado";
```

(b) Depois de `  } = gradeComprado;` (Task 3), inserir:

```ts
  // ── F3.4 — Origem (decisão F3 #3 + D1; R3/R7 do G-plano F3.4): "Importado" com o módulo; a troca olha o que o card JÁ
  // TEM no servidor. Tecido no BOM (servidor OU já na ficha carregada): tecido reserva estoque — num comprado ficaria
  // escondido reservando.
  const { data: temTecidosServidor = false } = useQuery({
    queryKey: ["plan-origem-tem-tecidos", modeloId],
    enabled: isEdit && !!modeloId,
    queryFn: async () => {
      const { data, error } = await supabase.from("modelo_tecidos").select("id").eq("modelo_id", modeloId as string).limit(1);
      if (error) throw error;
      return (data ?? []).length > 0;
    },
  });
  // R3 — os DOIS espelhos do card (invariante #13), QUALQUER que seja a origem (um card interno pode já ter sido comprado —
  // o produto continua vinculado na tela dele). `produtos_acabados` não tem modgate: lido SEMPRE (não depende do `paOn`).
  // `produtos_importados` tem `modgate_pi_*` RESTRICTIVE: com o módulo desligado as linhas SOMEM ⇒ INDETERMINADO (null),
  // nunca "não tem". Key própria (forma diferente de `plan-comprado-produto`/`pa-produto-modelo`); `piOn` na key.
  const qEspelhos = useQuery({
    queryKey: ["plan-origem-espelhos", modeloId, piOn],
    enabled: isEdit && !!modeloId,
    queryFn: async (): Promise<EspelhosCard> => {
      const pa = await (supabase.from("produtos_acabados" as any) as any)
        .select("id, ocs:ocs_p_acabado(id)")
        .eq("modelo_id", modeloId);
      if (pa.error) throw pa.error;
      let pi: { ocs: { id: string }[] | null }[] | null = null;
      if (piOn) {
        const r = await (supabase.from("produtos_importados" as any) as any)
          .select("id, ocs:ocs_importado(id)")
          .eq("modelo_id", modeloId);
        if (r.error) throw r.error;
        pi = r.data ?? [];
      }
      return espelhosDoCard({ acabados: pa.data ?? [], importados: pi });
    },
  });
  const origemOpcoesLista = opcoesOrigem({
    isEdit, salva: origemSalva, atual: draft.origem, piOn,
    temTecidos: temTecidosServidor || (ficha.carregado && ficha.estado.blocks.some((b) => !!b.artigo_id)),
    // Carregando ou com erro ⇒ null ⇒ nenhuma troca no escuro (falha fechada).
    espelhos: qEspelhos.data ?? null,
    // R7 — a ficha projeta pela origem do RASCUNHO e a grade segue a SALVA: trocar com edição pendente deixaria a referência
    // do BOM calculada com a OUTRA projeção ("Tecidos & BOM" falso). Sem edição, a referência re-baseia sozinha.
    edicaoPendente: ficha.tocado || gradeComprado.gradeRevendaDirty,
  });
```

(c) Na chamada `<InfoGeraisSecao …>`, trocar `            sub1Opts={sub1Opts} sub2Opts={sub2Opts} fl={fl}` por `            sub1Opts={sub1Opts} sub2Opts={sub2Opts} fl={fl} origemOpcoes={origemOpcoesLista}`.

- [ ] **Step 3: Gates + commit**

```bash
D=src/components/planejamento/planejamento-detail; P=src/components/planejamento/PlanejamentoDetail.tsx
grep -cF '<SelectItem value="revenda">Revenda</SelectItem>' $D/InfoGeraisSecao.tsx     # 0
grep -cF "origemOpcoes={origemOpcoesLista}" $P                                          # 1
grep -cF 'queryKey: ["plan-origem-espelhos", modeloId, piOn],' $P                        # 1 (R3)
grep -cF "edicaoPendente: ficha.tocado || gradeComprado.gradeRevendaDirty," $P           # 1 (R7)
bash .superpowers/f34/gates.sh
F="$D/InfoGeraisSecao.tsx $P"
git add -- $F
git commit --only -m "feat(planejamento): F3.4 (6) — Origem ganha 'Importado' (módulo opt-in) com a troca guardada: tecido no BOM, produto com pedido, nunca dois espelhos (qualquer origem), edição pendente

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- $F
```

**Revisão do Lote B (Task 6):** Select mostra o valor de TODO card (interno/revenda/importado); "Revenda" sempre listada (como hoje); Dialog "Novo Modelo" sem regras; motivo visível abaixo do Select; `plan-origem-tem-tecidos` e `plan-origem-espelhos` com keys próprias e invalidadas no Salvar (Task 5); a regra usa a origem SALVA; R3 — `produtos_acabados` lido SEM `paOn`, `produtos_importados` só com `piOn` (senão `null` = indeterminado), erro/carregando ⇒ `espelhos: null` (trava); nenhuma regra lê `gradeComprado.produto`; R7 — `edicaoPendente` = `ficha.tocado || gradeRevendaDirty`; 360px sem estouro (texto quebra).

---

## Task 7: Orquestrador — seções, preço, selos, Enviar e Importar por origem  *(individual Opus)*

**Files:**
- Modify: `src/components/planejamento/planejamento-detail/ficha/secoes/SecaoBom.tsx` (`oculta`)
- Modify: `src/components/planejamento/planejamento-detail/ficha/secoes/BomSecoes.tsx` (`visiveis`; nota do CAD do comprado)
- Modify: `src/components/planejamento/PlanejamentoDetail.tsx`

**Interfaces:**
- Consumes: Task 1 (`secoesFicha`, `SECOES_FICHA_INTERNO`, `SecoesFicha`, `requeridasPorOrigem`, `seloGradeComprado`, `desenvolvimentoCompleto`); Task 2 (`pendenciasEnvioExplosao({…, campoVisivel, secaoGrade})`); Task 3 (`GradeRevendaSecao({ gc, selo, motivoSomenteLeitura })`, `ProdutoImportadoSecao`); Task 4 (`ficha.gradeExterna`, `ficha.marcarGradeExternaEditada`); F3.3 (`vis`, `numeros`, `selos`, `seloDe`, `fichaVisivel`, `mostraEnviarExplosao`, `pendenciasEnvio`, `MenuMaisAcoes.onImportar`).
- Produces: `SecaoBom({…, oculta?})`; `BomSecoes({…, visiveis?: SecoesFicha})`; no orquestrador `secFicha`, `requeridasCard`, `motivoGradeSomenteLeitura`.

- [ ] **Step 1: `SecaoBom.tsx` — seção oculta sem quebrar a ordem dos hooks**

(a) Trocar `export function SecaoBom({ id, titulo, numero, selo, origemDev = true, defaultOpen = false, open: openProp, onOpenChange, children }: {` por:

```tsx
export function SecaoBom({ id, titulo, numero, selo, origemDev = true, defaultOpen = false, open: openProp, onOpenChange, oculta = false, children }: {
```

e, depois de `  onOpenChange?: (v: boolean) => void;`, inserir:

```tsx
  /** F3.4 — seção fora do fluxo desta origem (comprado: "Fluxo de Revenda"). Os hooks rodam antes do retorno. */
  oculta?: boolean;
```

(b) Substituir as 2 linhas:

```tsx
  return (
    <section ref={ref} className="space-y-3" data-secao={id}>
```

por:

```tsx
  // F3.4 — depois dos hooks (regra dos hooks): a seção some sem mudar a ordem deles.
  if (oculta) return null;
  return (
    <section ref={ref} className="space-y-3" data-secao={id}>
```

- [ ] **Step 2: `BomSecoes.tsx` — seções por origem**

(a) Depois de `import { SeloBadge } from "./SeloBadge";`, inserir:

```tsx
import { SECOES_FICHA_INTERNO, type SecoesFicha } from "@/components/planejamento/planejamento-detail/comprado";
```

(b) Trocar `export function BomSecoes({ ficha, modeloId, estoque, ordemEnviada, proporcoes, numeros }: {` por `export function BomSecoes({ ficha, modeloId, estoque, ordemEnviada, proporcoes, numeros, visiveis }: {` e, depois de `  numeros?: Partial<Record<SecaoSheetKey, number>>;`, inserir:

```tsx
  /** F3.4 — seções desta origem (`secoesFicha`): comprado segue o "Fluxo de Revenda" e nunca tem a grade do Tecido 1. */
  visiveis?: SecoesFicha;
```

(c) Depois de `  const { estado, handlers, dados } = ficha;`, inserir:

```tsx
  const vv = visiveis ?? SECOES_FICHA_INTERNO;
```

(d) Nas 5 `<SecaoBom …>`, acrescentar `oculta` logo depois do número:
- `titulo="Tecidos / Forros / Entretelas" numero={numeros?.tecidos}` → `titulo="Tecidos / Forros / Entretelas" numero={numeros?.tecidos} oculta={!vv.tecidos}`
- `titulo="Aviamentos" numero={numeros?.aviamentos}` → `titulo="Aviamentos" numero={numeros?.aviamentos} oculta={!vv.aviamentos}`
- `titulo="Insumos" numero={numeros?.insumos}` → `titulo="Insumos" numero={numeros?.insumos} oculta={!vv.insumos}`
- `titulo="Grade" numero={numeros?.grade}` → `titulo="Grade" numero={numeros?.grade} oculta={!vv.gradeTecido}`
- `titulo="CAD" numero={numeros?.cad}` → `titulo="CAD" numero={numeros?.cad} oculta={!vv.cad}`

(e) Antes de `              {ficha.cadAntesDaOrdem && (`, inserir:

```tsx
              {ficha.gradeExterna && (
                <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Produto comprado: o CAD nasce no recebimento do pedido (OC) — aqui ele é só leitura.
                </p>
              )}
```

- [ ] **Step 3: `PlanejamentoDetail.tsx` — imports, preço e o `aoEditar` da grade**

(a) Trocar `import { espelhosDoCard, opcoesOrigem, type EspelhosCard } from "@/components/planejamento/planejamento-detail/comprado";` (Task 6) por:

```ts
import {
  desenvolvimentoCompleto, espelhosDoCard, opcoesOrigem, requeridasPorOrigem, secoesFicha, seloGradeComprado, type EspelhosCard,
} from "@/components/planejamento/planejamento-detail/comprado";
```

e `import { PrecoRevendaBloco, ProdutoAcabadoSecao, GradeRevendaSecao } from "@/components/planejamento/planejamento-detail/RevendaSetores";` por:

```ts
import { PrecoRevendaBloco, ProdutoAcabadoSecao, GradeRevendaSecao, ProdutoImportadoSecao } from "@/components/planejamento/planejamento-detail/RevendaSetores";
```

(b) Substituir `  const previstoBase = !veCustos ? 0 : ficha.carregado ? previstoDaFicha(ficha.totais) : Number(custoData?.previsto) || 0;` por:

```ts
  // F3.4 — comprado: o previsto é o do SERVIDOR (revenda = unit real + insumos; importado = landed —
  // `_custo_unitario_modelos_core`), nunca o total do BOM da ficha (que agora carrega também p/ comprado).
  const previstoBase = !veCustos ? 0 : ficha.carregado && !isComprado ? previstoDaFicha(ficha.totais) : Number(custoData?.previsto) || 0;
```

(c) Na chamada `useGradeComprado({ … })` (Task 3), trocar `    grupos, tenantIdAtivo, revRef,` por:

```ts
    grupos, tenantIdAtivo, revRef,
    // Importado: a célula editada marca a ficha (a grade grava pelo BOM — conferência R5/R5a protege o Salvar).
    aoEditar: origemSalva === "importado" ? () => ficha.marcarGradeExternaEditada() : undefined,
```

(d) Trocar `                custosBom={ficha.habilitada && ficha.carregado && veCustos ? {` por:

```tsx
                // F3.4 — linhas "Custos do BOM" e custos adicionais só no INTERNO: no comprado não entram no custo
                // (`_custo_unitario_modelos_core` ramos revenda/importado) — mostrar confundiria a tabela do importado.
                custosBom={!isComprado && ficha.habilitada && ficha.carregado && veCustos ? {
```

- [ ] **Step 4: `PlanejamentoDetail.tsx` — `vis`, selos e seções do produto/grade**

(a) Antes de `  const vis: Record<SecaoSheetKey, boolean> = {`, inserir:

```ts
  // ── F3.4 — seções da ficha por ORIGEM (decisões F3 #4/#8): comprado pelo "Fluxo de Revenda"; grade do Tecido 1 só interno.
  const secFicha = secoesFicha(isComprado, campoVisivelDev);
  // Grade cor × tamanho: a da origem SALVA. Só-leitura com a troca de Origem ainda não salva, ou no importado sem a ficha
  // editável (a grade dele grava pelo BOM — D3 (A)). Revenda: editável como hoje.
  const motivoGradeSomenteLeitura: string | null = draft.origem !== origemSalva
    ? "Salve a troca de Origem antes de editar a grade."
    : origemSalva === "importado" && !ficha.podeEditar
      ? ficha.motivoSomenteLeitura === "enviado"
        // D3 (informado ao dono): depois de enviado à Explosão, a grade do importado trava JUNTO com a ficha.
        ? "Card enviado à Explosão: a grade do importado trava junto com a ficha — para mudar, use o botão Editar."
        : "A grade do importado grava junto com a ficha do Desenvolvimento — só quem edita o Desenvolvimento a altera aqui (com a ficha carregada)."
      : null;
```

(b) Trocar `    tecidos: fichaVisivel, aviamentos: fichaVisivel, insumos: fichaVisivel, grade: fichaVisivel, cad: fichaVisivel,` por:

```ts
    tecidos: fichaVisivel && secFicha.tecidos, aviamentos: fichaVisivel && secFicha.aviamentos,
    insumos: fichaVisivel && secFicha.insumos, grade: fichaVisivel && secFicha.gradeTecido, cad: fichaVisivel && secFicha.cad,
```

(c) Trocar `    produto_acabado: isEdit && isRevenda && paOn,` por:

```ts
    // F3.4 — a mesma chave serve à seção do produto do IMPORTADO ("Produto Importado").
    produto_acabado: isEdit && ((isRevenda && paOn) || (draft.origem === "importado" && piOn)),
```

(d) Trocar `    grade_revenda: isEdit && isRevenda && paOn && !!produtoRevenda,` por:

```ts
    // F3.4 — decisão F3 #4: a grade cor × tamanho é A grade do comprado (revenda E importado), pela seção "s4".
    grade_revenda: isEdit && !!modeloId && isComprado && (isRevenda ? paOn : piOn) && secFicha.gradeComprado,
```

(e) Antes de `  const selos = selosSecoesSheet({`, inserir:

```ts
  // F3.4 — requisitos POR ORIGEM nos selos (comprado = `revenda_kanban_requisitos`, sem os impossíveis p/ comprado).
  const requeridasCard = requeridasPorOrigem(
    isComprado,
    requisitosUniao(isComprado ? kanbanCard.revendaCfg.requisitos : kanbanCard.kanbanCfg.kanban_requisitos),
  );
```

(f) Dentro do `selosSecoesSheet({ … })`:
- trocar `    requeridas: requisitosUniao(isComprado ? kanbanCard.revendaCfg.requisitos : kanbanCard.kanbanCfg.kanban_requisitos),` por `    requeridas: requeridasCard,`;
- trocar `    desenvolvimentoCompleto: !!draft.modelista_id && !!draft.piloteiro1_id && !!draft.data_piloto1 && !!draft.data_desenho_tecnico,` por `    desenvolvimentoCompleto: desenvolvimentoCompleto(draft, campoVisivelDev),`;
- trocar `    preco: isRevenda ? null : { efetivo: precoEfetivo, markup: markupReal },` por `    preco: isRevenda ? { efetivo: piRevenda.efetivo, markup: piRevenda.markupReal } : { efetivo: precoEfetivo, markup: markupReal },`.

(g) Antes de `  const seloDe = (k: SecaoSheetKey) => {`, inserir:

```ts
  // F3.4 — selo da grade cor × tamanho (comprado): requisito `grade_preenchida` do fluxo de comprado, senão informativo.
  selos.grade_revenda = seloGradeComprado({
    requeridas: requeridasCard,
    satisfeitas: ficha.habilitada && ficha.dados.condicoesProntas ? ficha.dados.condicoes : null,
    totalGeral: gradeComprado.totalGeralRevenda,
    nVariantes: gradeComprado.variantesRevenda.length,
  });
```

(h) BOM — trocar `          {vis.tecidos && modeloId && (` por `          {fichaVisivel && modeloId && (` e, dentro da chamada, trocar `              numeros={numeros}` por:

```tsx
              numeros={numeros}
              visiveis={secFicha}
```

(i) Substituir as 3 linhas:

```tsx
          {vis.produto_acabado && (
            <ProdutoAcabadoSecao rv={revenda} contexto={contexto} modeloId={modeloId} navigate={navigate} numero={numeros.produto_acabado} />
          )}
```

por:

```tsx
          {vis.produto_acabado && (isRevenda ? (
            <ProdutoAcabadoSecao rv={revenda} contexto={contexto} modeloId={modeloId} navigate={navigate} numero={numeros.produto_acabado} />
          ) : (
            <ProdutoImportadoSecao gc={gradeComprado} navigate={navigate} numero={numeros.produto_acabado} />
          ))}
```

(j) Trocar `            <GradeRevendaSecao gc={gradeComprado} numero={numeros.grade_revenda} />` (Task 3) por:

```tsx
            <GradeRevendaSecao gc={gradeComprado} numero={numeros.grade_revenda} selo={seloDe("grade_revenda")} motivoSomenteLeitura={motivoGradeSomenteLeitura} />
```

- [ ] **Step 5: `PlanejamentoDetail.tsx` — Enviar à Explosão do comprado (D2) e Importar só interno**

**Se o dono respondeu D2 = (A) (recomendado — revenda E importado, como o Dev hoje):** substituir:

```ts
  const mostraEnviarExplosao = fichaVisivel && enviada && !enviadoCad;
  const pendenciasEnvio = mostraEnviarExplosao && gateEnvio.ok
    ? pendenciasEnvioExplosao({ draft, blocks: ficha.estado.blocks, grades: ficha.estado.grades, rotuloRef: fl("ref") })
    : [];
```

por:

```ts
  // F3.4 — D2 (A): comprado também envia à Explosão, como no Desenvolvimento (ModeloDetailPanel.tsx:1577-1598): a lista
  // "Para enviar, falta" só exige o que a loja deixou VISÍVEL p/ comprado, e a grade é a cor × tamanho.
  const mostraEnviarExplosao = fichaVisivel && enviada && !enviadoCad;
  const pendenciasEnvio = mostraEnviarExplosao && gateEnvio.ok
    ? pendenciasEnvioExplosao({
      draft, blocks: ficha.estado.blocks,
      grades: isComprado ? buildLinhasGradeRevenda() : ficha.estado.grades,
      rotuloRef: fl("ref"),
      campoVisivel: campoVisivelDev,
      secaoGrade: isComprado ? "grade_revenda" : "grade",
    })
    : [];
```

e trocar a linha do texto da confirmação:

```tsx
                O card é salvo e vai para a Explosão (próxima etapa) com os tecidos, variantes, grade e CAD atuais. Na Explosão
```

por:

```tsx
                {isComprado
                  ? "O card é salvo e vai para a Explosão (próxima etapa) com a grade e os insumos atuais."
                  : "O card é salvo e vai para a Explosão (próxima etapa) com os tecidos, variantes, grade e CAD atuais."} Na Explosão
```

**Se o dono respondeu D2 = (A2) (só revenda):** aplicar TUDO do (A) acima e, depois, trocar `  const mostraEnviarExplosao = fichaVisivel && enviada && !enviadoCad;` por:

```ts
  // F3.4 — D2 (A2): só a revenda envia pelo Planejamento; o importado não passa pela Explosão (G-plano F3.4 R4).
  const mostraEnviarExplosao = fichaVisivel && enviada && !enviadoCad && draft.origem !== "importado";
```

**Se o dono respondeu D2 = (B):** trocar SÓ `  const mostraEnviarExplosao = fichaVisivel && enviada && !enviadoCad;` por:

```ts
  // F3.4 — D2 (B): o comprado NÃO envia à Explosão pelo Planejamento (a revenda entra sozinha ao receber a OC).
  const mostraEnviarExplosao = fichaVisivel && enviada && !enviadoCad && !isComprado;
```

**Nos dois casos**, trocar `              onImportar={ficha.podeEditar ? () => importar.setAberto(true) : undefined}` por:

```tsx
              // F3.4 — só interno: o diálogo do Dev copia a grade por variante do Tecido 1, que o comprado não tem.
              onImportar={ficha.podeEditar && !isComprado ? () => importar.setAberto(true) : undefined}
```

- [ ] **Step 6: Conferência + gates + commit**

```bash
P=src/components/planejamento/PlanejamentoDetail.tsx; F=src/components/planejamento/planejamento-detail/ficha/secoes
grep -cF "visiveis={secFicha}" $P                          # 1
grep -cF "oculta={!vv." $F/BomSecoes.tsx                    # 5
grep -cF "!isComprado && ficha.habilitada && ficha.carregado && veCustos" $P    # 1
grep -cF "ficha.carregado && !isComprado ? previstoDaFicha" $P                  # 1
grep -cF "selos.grade_revenda = seloGradeComprado(" $P                          # 1
grep -cF "ficha.podeEditar && !isComprado ? () => importar.setAberto(true)" $P  # 1
grep -cF "<ProdutoImportadoSecao" $P                                            # 1
grep -cF "Card enviado à Explosão: a grade do importado trava junto com a ficha" $P   # 1 (D3)
bash .superpowers/f34/gates.sh
FS="$F/SecaoBom.tsx $F/BomSecoes.tsx $P"
git add -- $FS
git commit --only -m "feat(planejamento): F3.4 (7) — Sheet por origem: seções do comprado pelo Fluxo de Revenda, grade cor × tamanho numerada com selo, preço/custos do BOM só no interno, selos com requisitos do comprado, Enviar à Explosão do comprado (D2), Importar só interno

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- $FS
```

**Revisão individual (Opus):** `vis` = fonte única (nenhuma condição duplicada no JSX; a numeração segue a tela — interno igual a antes); `SecaoBom.oculta` depois dos hooks; comprado: nunca "Grade" do Tecido 1, Tecidos/CAD pelo `s2`/`s-cad`, grade cor × tamanho pelo `s4`; preço do comprado com o previsto do SERVIDOR e sem "Custos do BOM" (revenda = `PrecoRevendaBloco` igual a hoje; importado = tabela de hoje); selos com `requeridasCard` (comprado filtrado) e o da grade; D2 aplicada exatamente como respondida ((A), (A2) ou (B)); aviso da grade do importado enviado à Explosão = texto do D3 ("use o botão Editar"); Importar some p/ comprado; MO do comprado continua visível (`vis.mao_obra` intocado — decisão #5); invariante #12 nos selos com R$.

---

## Task 8: Snapshot só-leitura de PRODUÇÃO antes do merge  *(controlador — pré-condição da Task 10)*

**Files:** nenhum no repo. Saída em `/Users/sunglee/PLM + Criação/savepoints/<data>-pre-f34-comprado/` (FORA do repo; contém dado de loja; nunca commitar).

Por quê: a F3.4 passa a GRAVAR, a partir do Planejamento, o BOM de cards comprados (`salvar_modelo_bom` apaga e regrava tecidos/aviamentos/**grades**), `modelo_etiquetas` do comprado, as colunas derivadas do comprado (`tecidos_planejados`, `custo_peca_previsto` — §6 R12), produtos importados (auto-criação) e, com a D2 (A)/(A2), o envio do comprado à Explosão cria `cad`/`cad_grades`/`cad_aviamentos` (`_enviar_modelo_para_cad_core` — G-plano F3.4 R4) — o vite do dono (`:5173`) grava em PRODUÇÃO assim que o código chega à branch dele. Quando: (1) ANTES do fast-forward da Task 10 e (2) de novo ANTES do deploy Cloudflare da F3.

- [ ] **Step 1: Exportar**

```bash
DEST="/Users/sunglee/PLM + Criação/savepoints/$(date +%F)-pre-f34-comprado"
mkdir -p "$DEST"
URL="$(cat /tmp/dburl.txt)"
# R4 do G-plano F3.4: + cad_grades e cad_aviamentos (a D2 (A)/(A2) os cria no envio do comprado à Explosão).
for T in modelo_grades modelo_etiquetas modelo_aviamentos modelo_tecidos produtos_acabados produto_acabado_variantes \
         produtos_importados produto_importado_variantes cad cad_etiquetas cad_grades cad_aviamentos; do
  PGOPTIONS='-c default_transaction_read_only=on' psql "$URL" -v ON_ERROR_STOP=1 -q \
    -c "\copy (SELECT * FROM public.$T ORDER BY id) TO '$DEST/$T.csv' CSV HEADER"
done
# R6 do G-plano F3.4: + custo_peca_previsto (o Salvar do comprado com a ficha editável passa a gravá-lo — §6 R12).
PGOPTIONS='-c default_transaction_read_only=on' psql "$URL" -v ON_ERROR_STOP=1 -q \
  -c "\copy (SELECT id, tenant_id, rev, origem, ref, preco_venda, preco_atacado, ordem_criacao_enviada, enviado_cad, status_desenvolvimento, tecidos_planejados, custo_peca_previsto FROM public.modelos ORDER BY id) TO '$DEST/modelos_colunas_f34.csv' CSV HEADER"
PGOPTIONS='-c default_transaction_read_only=on' psql "$URL" -v ON_ERROR_STOP=1 -q \
  -c "\copy (SELECT tenant_id, modules, revenda_campos, revenda_kanban_colunas, revenda_kanban_requisitos FROM public.tenant_config ORDER BY tenant_id) TO '$DEST/tenant_config_revenda.csv' CSV HEADER"
# R3 do G-plano F3.4: card com os DOIS espelhos (Produto Acabado E Produto Importado) — esperado 0 linhas.
PGOPTIONS='-c default_transaction_read_only=on' psql "$URL" -v ON_ERROR_STOP=1 -q \
  -c "\copy (SELECT m.id, m.tenant_id, m.origem FROM public.modelos m WHERE EXISTS (SELECT 1 FROM public.produtos_acabados p WHERE p.modelo_id = m.id) AND EXISTS (SELECT 1 FROM public.produtos_importados i WHERE i.modelo_id = m.id) ORDER BY m.id) TO '$DEST/espelhos_conferencia.csv' CSV HEADER"
(cd "$DEST" && for f in *.csv; do printf '%s\t%s linhas\t%s\n' "$f" "$(($(wc -l < "$f") - 1))" "$(shasum -a 256 "$f" | cut -c1-16)"; done) > "$DEST/INDICE.tsv"
cat "$DEST/INDICE.tsv"
```

Expected: 15 CSVs com contagem e hash. Conferir no `tenant_config_revenda.csv` que nenhuma loja tem `revenda_campos` com `s4:false` (senão a grade cor × tamanho SOME do Planejamento dessa loja com a F3.4 — avisar o dono antes do merge). Conferir `espelhos_conferencia.csv` com **0 linhas** (R3 — nenhum card com os dois espelhos; se houver, avise o dono antes do merge: é dado pré-existente que a F3.4 não cria, e a Origem desse card fica travada fora da origem atual). Escrever `$DEST/LEIA-ME.md` com: data/hora, commit do código (`git -C "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f34-comprado" rev-parse HEAD`), "restaurar só com OK do dono", "contém dados de lojas — não commitar".

- [ ] **Step 2: Registrar** — o guardião anota o caminho e o `INDICE.tsv` no diário (G-fase). Sem commit.

---

## Task 9: QA contra a CÓPIA — app de teste da worktree (`:5183`), guarda invertida, fluxos que gravam na cópia  *(controlador; relatório ao guardião)*

> Mesmo modo da F3.1–F3.3: o app de teste da worktree fala só com a CÓPIA LOCAL. Automático S1–S9 (+ S2b e S5b do G-plano F3.4) com escritas SIMULADAS; E1–E2 gravam de verdade na cópia, um por vez, com o OK do dono; o E3 está PULADO (R4 — motivo no Step 1). Produção: snapshot (Task 8) + smoke só-leitura (Task 10 Step 6).

**Files:**
- Create (NÃO versionar): `tests/e2e/f34-qa.spec.ts`; evidência em `.superpowers/f34/qa/` (fluxos que gravam: `.superpowers/f34/qa/escrita/`).
- Modify (fora do repo, com backup): `/Users/sunglee/PLM + Criação/banco-local/app-teste-variantes/criar-variante.sh` — aceita a porta `5183`.

Regras (as MESMAS das fases anteriores): barradas esperadas seguem barradas e não reprovam; `servicos_financeiro` NUNCA em `READ_RPCS`; loja pelo tenant_id; na cópia, qualquer requisição a `*.supabase.co` reprova; `:5183` ocupada ⇒ PARE; derrubar SÓ pelo `descer.sh` da variante; nunca `:5173`/`:5184`/`:5185`/`:5186`/`:5187`/`:5188` (nem `:5198`/`:5199`); nunca junto com outro QA. RPC de leitura nova barrada = o controlador confere no `funcoes.sql` do snapshot que é `STABLE` e sem escrita ANTES de pôr em `READ_RPCS` (e registra).

- [ ] **Step 1: Pré-condições, a porta 5183 no script e a variante**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f34-comprado"
ps -Ao pid,command | grep -E "[v]itest|playwright|f3[0-9]-qa" | grep -v grep; echo "testes-checados"
lsof -nP -iTCP:5183 -sTCP:LISTEN; echo "porta-checada"
curl -s -o /dev/null -w 'Supabase local http=%{http_code}\n' http://127.0.0.1:54321/auth/v1/health
curl -s -o /dev/null -w 'app de teste do dono :5188 http=%{http_code} (só observado)\n' http://localhost:5188/
```

Expected: só `testes-checados` e `porta-checada`; `Supabase local http=200`.

Acrescentar a porta 5183 ao script (backup antes; casa o texto EXATO da linha do `case` — a versão com a F3.3 (`5184`) ou, se o QA da F3.3 não a tiver gravado, a da F3.2; qualquer outra coisa ⇒ PARE):

```bash
VAR="/Users/sunglee/PLM + Criação/banco-local/app-teste-variantes"
cp -p "$VAR/criar-variante.sh" "$VAR/criar-variante.sh.bak-pre-f34"
L33='case "$PORTA" in 5184|5185|5186|5187) ;; *) echo "RECUSADO: porta $PORTA (variantes: F2=5185, F3.1=5187, F3.2=5186, F3.3=5184)"; exit 1;; esac'
L32='case "$PORTA" in 5185|5186|5187) ;; *) echo "RECUSADO: porta $PORTA (variantes: F2=5185, F3.1=5187, F3.2=5186)"; exit 1;; esac'
NOVA='case "$PORTA" in 5183|5184|5185|5186|5187) ;; *) echo "RECUSADO: porta $PORTA (variantes: F2=5185, F3.1=5187, F3.2=5186, F3.3=5184, F3.4=5183)"; exit 1;; esac'
python3 - "$VAR/criar-variante.sh" "$L33" "$L32" "$NOVA" <<'PY'
import re, sys
arq, l33, l32, nova = sys.argv[1:5]
txt = open(arq, encoding="utf-8").read()
n33, n32 = txt.count(l33), txt.count(l32)
if n33 + n32 != 1:
    sys.exit(f"PARE: esperado 1 linha do case (achou versão F3.3={n33}, versão F3.2={n32})")
txt = txt.replace(l33 if n33 else l32, nova)
def comentario(m):
    return m.group(0) if "5183" in m.group(1) else "# Portas: " + m.group(1) + ", F3.4 = 5183. NUNCA"
txt, k = re.subn(r"^# Portas: (.*)\. NUNCA", comentario, txt, count=1, flags=re.M)
open(arq, "w", encoding="utf-8").write(txt)
print(f"case atualizado; comentário das portas: {k}")
PY
diff "$VAR/criar-variante.sh.bak-pre-f34" "$VAR/criar-variante.sh"   # só a linha do case e a do comentário
bash -n "$VAR/criar-variante.sh" && echo "sintaxe ok"
grep -cF "$NOVA" "$VAR/criar-variante.sh"                             # 1
bash "$VAR/criar-variante.sh" f34 "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f34-comprado" 5183
"$VAR/f34/subir.sh"
lsof -nP -iTCP:5188 -sTCP:LISTEN -t | sed 's/^/:5188 do dono intacto, PID /'
```

Expected: `case atualizado; comentário das portas: 1`; o `diff` mostra SÓ as 2 linhas; `sintaxe ok`; `1`; `variante f34 pronta …`; `OK: variante f34 em http://localhost:5183 (PID …)` + a linha da guarda `[guarda-copia-local] OK: variante f34 (:5183, raiz …/f34-comprado) — cliente e worker -> http://127.0.0.1:54321 (cópia local)`; o `:5188` com o mesmo PID de antes. `RECUSADO`/`ABORTADO`/`ERRO`/`PARE`: pare e reporte (nunca contornar a guarda; nunca `npm run dev` + `VITE_*`).

Escolher os cards (SELECT só-leitura na cópia) e exportar:

```bash
Q() { PGCONNECT_TIMEOUT=5 psql "postgresql://postgres:postgres@127.0.0.1:54422/postgres" -X -A -t -q -v ON_ERROR_STOP=1 -c "BEGIN READ ONLY; $1; COMMIT;"; }
T="'37889b78-fffb-404b-8c75-18b7e50a1d9b'"
export F34_CARD_REV="$(Q "select m.id from modelos m join produtos_acabados p on p.modelo_id = m.id where m.tenant_id = $T and m.origem = 'revenda' and not coalesce(m.enviado_cad,false) and exists(select 1 from produto_acabado_variantes v where v.produto_acabado_id = p.id) and exists(select 1 from modelo_grades g where g.modelo_id = m.id) and exists(select 1 from ocs_p_acabado o where o.produto_acabado_id = p.id) order by m.nome, m.id limit 1")"
export F34_CARD_REV_ORDEM="$(Q "select m.id from modelos m where m.tenant_id = $T and m.origem = 'revenda' and m.ordem_criacao_enviada and not coalesce(m.enviado_cad,false) and not coalesce(m.lancado,false) order by m.nome, m.id limit 1")"
export F34_CARD_INT_TEC="$(Q "select m.id from modelos m where m.tenant_id = $T and coalesce(m.origem,'interno') = 'interno' and not coalesce(m.enviado_cad,false) and exists(select 1 from modelo_tecidos t where t.modelo_id = m.id and t.artigo_id is not null) order by m.nome, m.id limit 1")"
export F34_CARD_INT_SEM="$(Q "select m.id from modelos m where m.tenant_id = $T and coalesce(m.origem,'interno') = 'interno' and not coalesce(m.enviado_cad,false) and not coalesce(m.lancado,false) and not exists(select 1 from modelo_tecidos t where t.modelo_id = m.id) and not exists(select 1 from cad c where c.modelo_id = m.id) order by m.nome, m.id limit 1")"
export F34_CARD_INT_CAD="$(Q "select m.id from modelos m where m.tenant_id = $T and coalesce(m.origem,'interno') = 'interno' and exists(select 1 from cad c where c.modelo_id = m.id) and exists(select 1 from modelo_tecidos t where t.modelo_id = m.id and t.tipo = 'tecido' and t.numero = 1 and t.artigo_id is not null) order by m.nome, m.id limit 1")"
export F34_CARD_COMPRADO_GATE="$(Q "select m.id from modelos m where m.tenant_id = $T and m.origem in ('revenda','importado') and m.ordem_criacao_enviada and not coalesce(m.enviado_cad,false) and not coalesce(m.lancado,false) and (public._explosao_envio_gate(m.tenant_id, public._kanban_status_gate(m.tenant_id, m.id, m.status_desenvolvimento))).ok and coalesce(trim(m.ref),'') <> '' and coalesce(trim(m.nome),'') <> '' and m.estilista_id is not null and m.categoria_principal_id is not null and (select coalesce(sum(grade_total),0) from modelo_grades g where g.modelo_id = m.id) > 0 order by m.nome, m.id limit 1")"
env | grep '^F34_CARD_' | sort
env | grep '^F34_CARD_' | sort > .superpowers/f34/qa-cards.env
```

Expected (24/set na cópia): REV = "Vestido Teste" `9b4e079e…`; REV_ORDEM = "Cinto Teste" `f8e77ebe…`; INT_TEC = um interno com tecido; INT_SEM = "KA teste lock"; INT_CAD = interno com CAD; COMPRADO_GATE VAZIO. Algum dos 5 primeiros vazio ⇒ PARE e reporte (o dono decide completar um card pela tela na cópia — nada de INSERT/UPDATE à mão).

**E3 = PULADO (G-plano F3.4 R4) — registrar no relatório com este motivo:** o E3 era o único teste que GRAVA o envio de um comprado à Explosão (D2 (A)/(A2)), e não há onde rodá-lo: nenhum comprado da cópia está elegível (COMPRADO_GATE vazio — Ordem + gate de etapa + REF/nome/estilista/categoria + grade) e nenhum comprado, na cópia NEM em produção, tem `enviado_cad` (o envio do comprado nunca foi usado — nada existente regride). Preparar um card elegível exigiria editar dados da cópia pela tela, fora do QA automático. O que cobre a D2: o S7 (botão e "Para enviar, falta" do comprado, sem gravar), a Task 2 (pendências, testes unitários) e a §3 (`_enviar_modelo_para_cad_core` não olha a origem — a mesma RPC que o Dev já usa p/ comprado). O código do E3 fica no spec e só roda com `F34_E3=1`, se o dono autorizar preparar um card pela tela na cópia (§8 D2).

- [ ] **Step 2: Escrever o spec `tests/e2e/f34-qa.spec.ts`**

```ts
// tests/e2e/f34-qa.spec.ts — QA da F3.4 (produto COMPRADO no Sheet do Planejamento: Origem "Importado", seções pelo Fluxo de
// Revenda, grade cor × tamanho como fonte única, BOM do comprado, MO, preço, Enviar à Explosão do comprado). NÃO COMMITAR
// (apoio da worktree; apagado na Task 10).
// DOIS ALVOS — F34_ALVO obrigatório:
//  • "copia"    — Task 9: app de teste DA WORKTREE (http://localhost:5183) sobre a CÓPIA LOCAL (http://127.0.0.1:54321).
//                 Guarda INVERTIDA: QUALQUER requisição a *.supabase.co (GET inclusive) é violação. O automático (S1–S9,
//                 + S2b e S5b do G-plano F3.4) SIMULA as escritas (route.fulfill); E1–E2 (F34_ESCRITA=1) GRAVAM de
//                 verdade — só na cópia, um por vez. E3 PULADO (G-plano F3.4 R4) — só roda com F34_E3=1 e o OK do dono.
//  • "producao" — smoke SÓ-LEITURA pós-merge no :5173 do dono (Task 10 Step 6): só o "S0".
// Barradas ESPERADAS (as MESMAS da F3.1–F3.3): `rpc/servicos_financeiro` (NUNCA liberar) e o broadcast REST do Realtime.
// O robô NÃO troca de loja. F34_D2 = "A" | "A2" | "B" — a resposta do dono à §8 D2.
// Rodar (cópia): set -a; . .superpowers/f34/qa-cards.env; set +a; E2E_BASE_URL=http://localhost:5183 \
//   VITE_SUPABASE_URL=http://127.0.0.1:54321 F34_ALVO=copia F34_D2=A npx playwright test tests/e2e/f34-qa.spec.ts --workers=1 --retries=0 -g "F3.4 — "
import { test, expect, type Browser, type BrowserContext, type Page, type Request, type Route } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { Client as PgClient } from "pg";
import { doLogin } from "./_helpers";

const BASE = process.env.E2E_BASE_URL ?? "";
if (!/^http:\/\/localhost:\d+$/.test(BASE)) throw new Error(`E2E_BASE_URL precisa ser o vite LOCAL — recebido "${BASE}". Sem isso o QA NÃO foi feito.`);
const ALVO = process.env.F34_ALVO ?? "";
if (ALVO !== "copia" && ALVO !== "producao") throw new Error(`F34_ALVO obrigatório: "copia" ou "producao" (recebi "${ALVO}").`);
if (!process.env.VITE_SUPABASE_URL) throw new Error("VITE_SUPABASE_URL ausente: a guarda de rede não sabe o host do Supabase. PARE.");
const SUPA_HOST = new URL(process.env.VITE_SUPABASE_URL).host;
if (ALVO === "copia" && (SUPA_HOST !== "127.0.0.1:54321" || BASE !== "http://localhost:5183")) {
  throw new Error(`F34_ALVO=copia exige VITE_SUPABASE_URL=http://127.0.0.1:54321 e E2E_BASE_URL=http://localhost:5183 (recebi ${SUPA_HOST} · ${BASE}).`);
}
if (ALVO === "producao" && (!/\.supabase\.co$/.test(SUPA_HOST) || BASE !== "http://localhost:5173")) {
  throw new Error(`F34_ALVO=producao é o smoke no :5173 do dono (Supabase de produção) — recebi ${SUPA_HOST} · ${BASE}.`);
}
const D2 = process.env.F34_D2 ?? "";
if (ALVO === "copia" && D2 !== "A" && D2 !== "A2" && D2 !== "B") throw new Error('F34_D2 obrigatório na cópia: "A", "A2" ou "B" (resposta do dono à §8 D2).');
const ehSupabaseProducao = (u: URL) => /(^|\.)supabase\.co$/i.test(u.hostname);
const ESCRITA = process.env.F34_ESCRITA === "1";
const LOJA_TESTE = "37889b78-fffb-404b-8c75-18b7e50a1d9b";
const ENV_CARDS = {
  rev: "F34_CARD_REV", revOrdem: "F34_CARD_REV_ORDEM", intTec: "F34_CARD_INT_TEC", intSem: "F34_CARD_INT_SEM", intCad: "F34_CARD_INT_CAD",
} as const;
const CARD = Object.fromEntries(Object.entries(ENV_CARDS).map(([k, e]) => [k, process.env[e] ?? ""])) as Record<keyof typeof ENV_CARDS, string>;
if (ALVO === "copia") {
  for (const [k, e] of Object.entries(ENV_CARDS)) {
    if (!/^[0-9a-f-]{36}$/.test(CARD[k as keyof typeof ENV_CARDS])) throw new Error(`${e} ausente/inválido — rode o Step 1 da Task 9.`);
  }
}
const SEL_TECIDOS = "id,modelo_id,artigo_id,numero,tipo,consumo,loss_percent,custo_previsto";
const SEL_CAD_PREFIXO = "id,cad_tecidos(";
const LOCAL_PG = "postgresql://postgres:postgres@127.0.0.1:54422/postgres";
// RPCs de LEITURA (STABLE — conferidas no snapshot funcoes.sql de 22/set; as mesmas da F3.3). Outra RPC = violação.
// ⚠️ NUNCA `servicos_financeiro` (DEFINER VOLATILE que sincroniza `parcelas_servico` na leitura — invariante #1).
const READ_RPCS = new Set([
  "custo_unitario_modelos", "modelo_mo_resumo", "estoque_tecido_por_artigo", "otb_orcamento",
  "sidebar_badges", "minhas_permissoes_efetivas", "get_user_tenant_id", "meu_tenant_ativo",
  "modelos_mo_a_aprovar_count",
  "avaliar_condicoes_kanban", "precos_tecido_congelado", "ocs_disponiveis_variante", "modelo_etapas_afetadas",
]);
if (READ_RPCS.has("servicos_financeiro")) throw new Error("servicos_financeiro é PROIBIDO em READ_RPCS.");
const BARRADAS_ESPERADAS = [/^POST \/rest\/v1\/rpc\/servicos_financeiro$/, /^POST \/realtime\/v1\/api\/broadcast/];
const OUT = path.resolve(".superpowers/f34/qa");

type Gravada = { metodo: string; caminho: string; corpo: any };
type Fake = { casa: (m: string, u: URL) => boolean; responde: (r: Route, req: Request) => Promise<void> };
type Card = { id: string; tecidos: unknown; cad: unknown; modeloRow: any };
const g = { gravadas: [] as Gravada[], violacoes: [] as string[], barradasEsperadas: [] as string[], tenants: new Set<string>(), fakes: [] as Fake[] };
const json = (r: Route, status: number, body: unknown) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const corpoDe = (req: Request) => { try { return req.postDataJSON(); } catch { return req.postData(); } };
const limpar = () => { g.fakes = []; g.gravadas = []; };
const chamou = (rpc: string) => g.gravadas.some((x) => x.caminho.startsWith(`/rest/v1/rpc/${rpc}`));
const idxRpc = (rpc: string) => g.gravadas.findIndex((x) => x.caminho.startsWith(`/rest/v1/rpc/${rpc}`));
const idxPatchModelos = () => g.gravadas.findIndex((x) => x.metodo === "PATCH" && x.caminho.startsWith("/rest/v1/modelos?"));
const lojaOk = () => g.tenants.size > 0 && [...g.tenants].every((t) => t === LOJA_TESTE);
const normGrades = (gs: any[]) => JSON.stringify((gs ?? [])
  .map((x: any) => [Number(x.variante_numero), Object.fromEntries(Object.entries(x.grades ?? {}).filter(([, v]) => Number(v) > 0).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))] as const)
  .filter(([, c]) => Object.keys(c).length > 0)
  .sort((a, b) => a[0] - b[0]));

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

const fakeGet = (pathname: string, pred: (u: URL) => boolean, corpo: unknown): Fake =>
  ({ casa: (m, u) => m === "GET" && u.pathname === pathname && pred(u), responde: (r) => json(r, 200, corpo) });
const fakeModeloGet = (id: string, corpo: unknown) =>
  fakeGet("/rest/v1/modelos", (u) => u.searchParams.get("select") === "*" && u.searchParams.get("id") === `eq.${id}`, corpo);
/** `plan-ficha-grades` (a ficha — ordenada) × `modelo-grades-revenda` (a grade cor × tamanho — sem `order`). */
const fakeGradesFicha = (id: string, rows: unknown[]) =>
  fakeGet("/rest/v1/modelo_grades", (u) => u.searchParams.get("modelo_id") === `eq.${id}` && u.searchParams.get("order") === "variante_numero.asc", rows);
const fakeGradesRevenda = (id: string, rows: unknown[]) =>
  fakeGet("/rest/v1/modelo_grades", (u) => u.searchParams.get("modelo_id") === `eq.${id}` && !u.searchParams.get("order"), rows);
const fakeProdutoImportado = (id: string, produto: unknown) =>
  fakeGet("/rest/v1/produtos_importados", (u) => u.searchParams.get("modelo_id") === `eq.${id}`, [produto]);
/** R1 do G-plano F3.4 — a leitura FRESCA do Salvar do comprado (`lerGradeServidorComprado`: `rev` + grade num GET só). */
const ehLeituraFresca = (id: string) => (m: string, u: URL) => m === "GET" && u.pathname === "/rest/v1/modelos"
  && u.searchParams.get("id") === `eq.${id}` && (u.searchParams.get("select") ?? "").startsWith("rev,grades:modelo_grades(");
const fakeLeituraFresca = (id: string, corpo: { rev: number | null; grades: unknown[] }): Fake =>
  ({ casa: ehLeituraFresca(id), responde: (r) => json(r, 200, corpo) });
/** `rev` da linha de `modelos` como o app a recebeu (PostgREST: número). */
const revDaLinha = (row: any): number | null => {
  const r = (Array.isArray(row) ? row[0] : row)?.rev;
  return typeof r === "number" ? r : null;
};
const fakeRpc = (nome: string, body: unknown = null) => g.fakes.push({ casa: (m, u) => m === "POST" && u.pathname === `/rest/v1/rpc/${nome}`, responde: (r) => json(r, 200, body) });
const fakeTabela = (tabela: string) => g.fakes.push({ casa: (m, u) => ["PATCH", "POST", "DELETE"].includes(m) && u.pathname === `/rest/v1/${tabela}`, responde: (r) => r.fulfill({ status: 204, body: "" }) });
/** O Salvar do Planejamento SIMULADO: header OK, grade/BOM/MO/CAD OK, etiquetas OK, marcar_revisao {}. */
function fakesDoSalvar() {
  g.fakes.push({
    casa: (m, u) => m === "PATCH" && u.pathname === "/rest/v1/modelos",
    responde: async (r, req) => json(r, 200, [{ id: (new URL(req.url()).searchParams.get("id") ?? "").replace(/^eq\./, "") }]),
  });
  for (const rpc of ["salvar_grade_revenda", "salvar_modelo_bom", "salvar_modelo_servico_mo", "salvar_cad_completo"]) fakeRpc(rpc);
  fakeRpc("marcar_revisao_por_mudanca", {});
  fakeTabela("modelo_etiquetas");
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
const titulosSecoes = (p: Page) => p.locator("[data-secao] > div > button span.truncate").allInnerTexts();
const numerosDosTitulos = (titulos: string[]) => titulos.map((t) => Number(/^(\d+)\. /.exec(t)?.[1] ?? Number.NaN));
const comboDoCampo = (p: Page, rotulo: string) =>
  p.getByRole("dialog").first().locator("div.grid.gap-1").filter({ has: p.getByText(rotulo, { exact: true }) }).getByRole("combobox").first();
const opcao = (p: Page, nome: string) => p.getByRole("option", { name: nome, exact: true });
async function salvarEEsperar(page: Page, rpc: string) {
  await page.getByRole("dialog").first().getByRole("button", { name: "Salvar" }).click();
  await expect.poll(() => chamou(rpc), { timeout: 20_000 }).toBe(true);
  await page.waitForTimeout(1000);
}
/** "+ Adicionar insumo" (vazio) ou "Adicionar Etiqueta"; escolhe a 1ª etiqueta e consumo 1. */
async function adicionarInsumo(page: Page) {
  await expandir(page, "insumos");
  const sec = page.locator('[data-secao="insumos"]');
  const n = await sec.getByRole("combobox").count();
  const vazio = sec.getByRole("button", { name: "+ Adicionar insumo" });
  if (await vazio.count()) await vazio.click();
  else await sec.getByRole("button", { name: /Adicionar Etiqueta/ }).click();
  await sec.getByRole("combobox").nth(n).click();
  await page.getByRole("option").filter({ hasNotText: "— Nenhum —" }).first().click();
  await sec.locator('input[placeholder="0,000"]').last().fill("1");
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

test("F3.4 — comprado no Sheet: Origem, seções, grade cor × tamanho, BOM do comprado, preço, Enviar (só leitura; escritas simuladas)", async ({ browser }) => {
  test.skip(ALVO !== "copia", "o automático é só na cópia");
  test.setTimeout(20 * 60_000);
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
  await guardar(ctx);
  const page = await ctx.newPage();
  const errosPagina: string[] = [];
  page.on("pageerror", (e) => errosPagina.push(String(e?.message ?? e)));
  page.on("dialog", (d) => d.accept());
  await doLogin(page);
  await page.goto("/criacao/planejamento", { waitUntil: "networkidle" });
  await expect.poll(() => g.tenants.size, { timeout: 15_000 }).toBeGreaterThan(0);
  expect(lojaOk(), `Loja ativa ≠ Loja Teste (${[...g.tenants].join(",")}). PARE: o robô NÃO troca de loja.`).toBe(true);

  await test.step("S1 — Origem: interno COM tecido ⇒ Revenda e Importado travados, com o motivo (D1)", async () => {
    limpar();
    await abrirCard(page, CARD.intTec);
    await comboDoCampo(page, "Origem").click();
    await expect(opcao(page, "Importado")).toHaveAttribute("aria-disabled", "true");
    await expect(opcao(page, "Revenda")).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Escape");
    await expect(page.getByText(/^Tire os tecidos da seção Tecidos/).first()).toBeVisible();
    expect(g.gravadas).toEqual([]);
  });

  await test.step("S2 — interno SEM tecido → Importado (sem salvar): somem Tecidos/Grade do Tecido 1/CAD; aparecem Produto Importado e a Grade cor × tamanho", async () => {
    limpar();
    await abrirCard(page, CARD.intSem);
    await expect(page.locator('[data-secao="grade"]')).toHaveCount(1);
    await comboDoCampo(page, "Origem").click();
    // R3 — a opção só libera depois de os DOIS espelhos carregarem (`plan-origem-espelhos`; carregando = travada).
    await expect(opcao(page, "Importado")).not.toHaveAttribute("aria-disabled", "true");
    await opcao(page, "Importado").click();
    for (const s of ["tecidos", "grade", "cad"]) await expect(page.locator(`[data-secao="${s}"]`)).toHaveCount(0);
    await expect(page.locator('[data-secao="produto_acabado"]')).toContainText("Produto Importado");
    await expandir(page, "grade_revenda");
    await expect(page.locator('[data-secao="grade_revenda"]')).toContainText("ainda não tem produto vinculado");
    const nums = numerosDosTitulos(await titulosSecoes(page));
    expect(nums).toEqual(nums.map((_, i) => i + 1));
    await comboDoCampo(page, "Origem").click();
    await opcao(page, "Interno").click();
    await expect(page.locator('[data-secao="grade"]')).toHaveCount(1);
    expect(g.gravadas).toEqual([]);
  });

  await test.step("S2b — R7: ficha TOCADA (insumo adicionado, sem salvar) ⇒ a Origem não muda; o motivo aparece", async () => {
    limpar();
    await abrirCard(page, CARD.intSem);
    await adicionarInsumo(page);
    await comboDoCampo(page, "Origem").click();
    await expect(opcao(page, "Importado")).toHaveAttribute("aria-disabled", "true");
    await expect(opcao(page, "Revenda")).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Escape");
    await expect(page.getByText(/^Salve \(ou descarte\) as edições de Tecidos\/Aviamentos\/Insumos\/Grade/).first()).toBeVisible();
    expect(g.gravadas).toEqual([]);
  });

  await test.step("S3 — revenda: seções pelo Fluxo de Revenda, Grade cor × tamanho numerada, MO visível (#5), preço da revenda como hoje, Origem travada (pedido)", async () => {
    limpar();
    await abrirCard(page, CARD.rev);
    const titulos = await titulosSecoes(page);
    expect(titulos.some((t) => /Tecidos \/ Forros/.test(t)), titulos.join(" | ")).toBe(false);
    expect(titulos.some((t) => /^\d+\. CAD$/.test(t))).toBe(false);
    for (const re of [/^\d+\. Aviamentos$/, /^\d+\. Insumos$/, /^\d+\. Mão de obra$/, /^\d+\. Produto Acabado$/, /^\d+\. Grade$/]) {
      expect(titulos.some((t) => re.test(t)), `${re} em ${titulos.join(" | ")}`).toBe(true);
    }
    await expect(page.locator('[data-secao="grade"]')).toHaveCount(0);
    await expect(page.locator('[data-secao="grade_revenda"]')).toHaveCount(1);
    const nums = numerosDosTitulos(titulos);
    expect(nums).toEqual(nums.map((_, i) => i + 1));
    await expandir(page, "grade_revenda");
    await expect(page.locator('[data-secao="grade_revenda"] input[data-colab-path^="grade-revenda:"]').first()).toBeEditable();
    await expandir(page, "preco");
    await expect(page.locator('[data-secao="preco"]').getByText("Markup atacado")).toBeVisible();
    await expect(page.locator('[data-secao="preco"]').getByText("Custos do BOM")).toHaveCount(0);
    await comboDoCampo(page, "Origem").click();
    await expect(opcao(page, "Interno")).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Escape");
    expect(g.gravadas).toEqual([]);
  });

  await test.step("S4 — revenda: grade + insumo ⇒ salvar_grade_revenda → PATCH → salvar_modelo_bom com a MESMA grade; sem tecido e sem CAD", async () => {
    limpar();
    fakesDoSalvar();
    await abrirCard(page, CARD.rev);
    await expandir(page, "grade_revenda");
    const cel = page.locator('[data-secao="grade_revenda"] input[data-colab-path^="grade-revenda:"]').first();
    const v = Number(await cel.inputValue()) || 0;
    await cel.fill(String(v + 1));
    await adicionarInsumo(page);
    await salvarEEsperar(page, "salvar_modelo_bom");
    const iG = idxRpc("salvar_grade_revenda");
    const iP = idxPatchModelos();
    const iB = idxRpc("salvar_modelo_bom");
    expect(iG >= 0 && iP > iG && iB > iP, `ordem: grade ${iG} · PATCH ${iP} · BOM ${iB}`).toBe(true);
    expect(normGrades(g.gravadas[iB].corpo._grades)).toBe(normGrades(g.gravadas[iG].corpo._grades));
    expect(g.gravadas[iB].corpo._tecidos).toEqual([]);
    expect(chamou("salvar_cad_completo")).toBe(false);
    expect(g.gravadas.some((x) => x.metodo === "POST" && x.caminho.startsWith("/rest/v1/modelo_etiquetas"))).toBe(true);
  });

  await test.step("S5 — R1: revenda, só insumo; o CACHE da grade está velho e o servidor tem outra ⇒ o BOM leva a LIDA no Salvar (nunca o cache nem a semeada)", async () => {
    limpar();
    const real = await sqlCopia<{ variante_numero: number; grades: Record<string, number>; grade_total: number }>(
      "select variante_numero, grades, grade_total from modelo_grades where modelo_id = $1 order by variante_numero", [CARD.rev]);
    expect(real.length).toBeGreaterThan(0);
    const [{ rev }] = await sqlCopia<{ rev: string }>("select rev::text as rev from modelos where id = $1", [CARD.rev]);
    const t0 = Object.keys(real[0].grades)[0];
    const outra = real.map((r, i) => (i === 0 ? { ...r, grades: { ...r.grades, [t0]: 999 }, grade_total: r.grade_total - (r.grades[t0] ?? 0) + 999 } : r));
    // Os caches (`plan-ficha-grades`, `modelo-grades-revenda`) ficam com a grade REAL = a "velha" (a outra pessoa salvou e a
    // recarga ainda não chegou); só a leitura fresca do Salvar vê a nova — com o MESMO rev do card (o merge já avançou).
    g.fakes.push(fakeLeituraFresca(CARD.rev, { rev: Number(rev), grades: outra }));
    fakesDoSalvar();
    await abrirCard(page, CARD.rev);
    await adicionarInsumo(page);
    await salvarEEsperar(page, "salvar_modelo_bom");
    expect(chamou("salvar_grade_revenda")).toBe(false);
    expect(normGrades(g.gravadas[idxRpc("salvar_modelo_bom")].corpo._grades)).toBe(normGrades(outra));
  });

  await test.step("S5b — R1: o servidor está num rev À FRENTE do card (salvo por outra pessoa; a recarga não chegou) ⇒ P0409 ANTES de gravar; nada do header nem do BOM grava", async () => {
    limpar();
    const real = await sqlCopia<{ variante_numero: number; grades: Record<string, number>; grade_total: number }>(
      "select variante_numero, grades, grade_total from modelo_grades where modelo_id = $1 order by variante_numero", [CARD.rev]);
    const [{ rev }] = await sqlCopia<{ rev: string }>("select rev::text as rev from modelos where id = $1", [CARD.rev]);
    let leituras = 0;
    g.fakes.push({
      casa: ehLeituraFresca(CARD.rev),
      responde: (r) => { leituras += 1; return json(r, 200, { rev: Number(rev) + 1, grades: real }); },
    });
    fakesDoSalvar();
    await abrirCard(page, CARD.rev);
    await adicionarInsumo(page);
    await page.getByRole("dialog").first().getByRole("button", { name: "Salvar" }).click();
    // 1ª tentativa + o retry automático do P0409 (o onError relê o modelo real e tenta 1×) — as duas param na leitura fresca.
    await expect.poll(() => leituras, { timeout: 20_000 }).toBeGreaterThanOrEqual(2);
    await page.waitForTimeout(1500);
    expect(chamou("salvar_modelo_bom")).toBe(false);
    expect(idxPatchModelos()).toBe(-1);
  });

  await test.step("S6 — importado (simulado): a grade cor × tamanho grava PELO BOM, sem salvar_grade_revenda nem CAD", async () => {
    limpar();
    const c0 = await abrirCard(page, CARD.intSem);
    const comoImportado = Array.isArray(c0.modeloRow)
      ? c0.modeloRow.map((r: any) => ({ ...r, origem: "importado" }))
      : { ...c0.modeloRow, origem: "importado" };
    g.fakes.push(fakeModeloGet(CARD.intSem, comoImportado));
    g.fakes.push(fakeGradesFicha(CARD.intSem, []));
    g.fakes.push(fakeGradesRevenda(CARD.intSem, []));
    // R1 — a leitura fresca do Salvar (o card simulado como importado): mesmo rev do card, servidor sem grade.
    g.fakes.push(fakeLeituraFresca(CARD.intSem, { rev: revDaLinha(c0.modeloRow), grades: [] }));
    g.fakes.push(fakeProdutoImportado(CARD.intSem, {
      id: "00000000-0000-4000-8000-000000000f34", colecao_id: null, grupo_id: null,
      grade_proporcao: { "38|P": 1, "40|M": 1 }, variantes: [{ ordem: 1, cor: { nome: "Preto" }, apelido: null }], ocs: [],
    }));
    fakesDoSalvar();
    await abrirCard(page, CARD.intSem);
    await expect(page.locator('[data-secao="produto_acabado"]')).toContainText("Produto Importado");
    await expandir(page, "grade_revenda");
    const cel = page.locator('[data-secao="grade_revenda"] input[data-colab-path="grade-revenda:1:38|P"]');
    await expect(cel).toBeEditable({ timeout: 30_000 });
    await cel.fill("7");
    await salvarEEsperar(page, "salvar_modelo_bom");
    expect(chamou("salvar_grade_revenda")).toBe(false);
    expect(chamou("salvar_cad_completo")).toBe(false);
    expect(normGrades(g.gravadas[idxRpc("salvar_modelo_bom")].corpo._grades)).toBe(normGrades([{ variante_numero: 1, grades: { "38|P": 7 }, grade_total: 7 }]));
  });

  await test.step(`S7 — Enviar à Explosão do comprado (D2 = ${D2})`, async () => {
    limpar();
    await abrirCard(page, CARD.revOrdem);
    const botao = page.getByRole("dialog").first().getByRole("button", { name: "Enviar à Explosão" });
    // REV_ORDEM é revenda: (A) e (A2) mostram o botão (o (A2) só o tira do importado); (B) não.
    if (D2 === "A" || D2 === "A2") {
      await expect(botao).toBeVisible();
      await expect(botao).toBeDisabled();
    } else {
      await expect(botao).toHaveCount(0);
    }
    expect(g.gravadas).toEqual([]);
  });

  await test.step("S8 — interno (regressão): Tecidos, Grade do Tecido 1 e CAD seguem; sem Grade cor × tamanho; 'Custos do BOM' no Preço", async () => {
    limpar();
    await abrirCard(page, CARD.intCad);
    const titulos = await titulosSecoes(page);
    for (const re of [/^\d+\. Tecidos \/ Forros \/ Entretelas$/, /^\d+\. Grade$/, /^\d+\. CAD$/]) {
      expect(titulos.some((t) => re.test(t)), `${re} em ${titulos.join(" | ")}`).toBe(true);
    }
    await expect(page.locator('[data-secao="grade_revenda"]')).toHaveCount(0);
    await expandir(page, "preco");
    await expect(page.locator('[data-secao="preco"]').getByText("Custos do BOM")).toBeVisible({ timeout: 30_000 });
  });

  await test.step("S9 — 360px (revenda): sem rolagem horizontal; Salvar visível", async () => {
    await page.setViewportSize({ width: 360, height: 780 });
    await abrirCard(page, CARD.rev);
    const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(sw).toBeLessThanOrEqual(cw);
    await expect(page.getByRole("dialog").first().getByRole("button", { name: "Salvar" })).toBeVisible();
    fs.mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: path.join(OUT, "S9-360.png"), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "automatico.json"), JSON.stringify({ violacoes: g.violacoes, barradasEsperadas: g.barradasEsperadas, errosPagina, tenants: [...g.tenants] }, null, 2));
  expect(g.violacoes, "requisições barradas fora das esperadas").toEqual([]);
  expect(errosPagina, "erro de JS na página").toEqual([]);
  expect(lojaOk()).toBe(true);
});

test("S0 — smoke SÓ-LEITURA (produção pós-merge, :5173): card de revenda sem Tecidos/CAD, com a Grade cor × tamanho", async ({ browser }) => {
  test.skip(ALVO !== "producao", "smoke só no alvo produção");
  const id = process.env.F34_SMOKE_CARD ?? "";
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("F34_SMOKE_CARD ausente (Task 10 Step 6 escolhe por SELECT só-leitura).");
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
  await guardar(ctx);
  const page = await ctx.newPage();
  await doLogin(page);
  await page.goto("/criacao/planejamento", { waitUntil: "networkidle" });
  await expect.poll(() => g.tenants.size, { timeout: 15_000 }).toBeGreaterThan(0);
  expect(lojaOk(), "o smoke roda SÓ na Loja Teste (o robô não troca de loja)").toBe(true);
  await abrirCard(page, id);
  const titulos = await titulosSecoes(page);
  expect(titulos.some((t) => /Tecidos \/ Forros/.test(t)), titulos.join(" | ")).toBe(false);
  expect(titulos.some((t) => /^\d+\. CAD$/.test(t))).toBe(false);
  await expect(page.locator('[data-secao="grade_revenda"]')).toHaveCount(1);
  expect(g.gravadas, "o smoke não grava nada").toEqual([]);
  expect(g.violacoes).toEqual([]);
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// FLUXOS QUE GRAVAM NA CÓPIA — E1…E3. GRAVAM DE VERDADE, SÓ na cópia (127.0.0.1:54321): F34_ALVO=copia + F34_ESCRITA=1,
// UM por vez (-g "E1 —"), dono avisado ANTES de cada um. PNG de cada passo em .superpowers/f34/qa/escrita/. Guarda
// INVERTIDA: escrita liberada SÓ para o Supabase local; qualquer requisição não-local reprova. Conferência por SELECT
// só-leitura. Ficam NA CÓPIA por natureza: a grade/insumo do E1, o card + Produto Importado do E2, o envio do E3.
// E3 = PULADO (G-plano F3.4 R4 — motivo na Task 9 Step 1): só roda com F34_E3=1, se o dono autorizar preparar um card
// comprado elegível PELA TELA na cópia.
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
const OUT_E = path.resolve(".superpowers/f34/qa/escrita");
const HOSTS_LOCAIS = new Set(["localhost", "127.0.0.1", "fonts.googleapis.com", "fonts.gstatic.com"]);
type EstadoEscrita = { gravadas: Gravada[]; violacoes: string[]; errosPagina: string[]; tenants: Set<string> };
const estadoEscrita = (): EstadoEscrita => ({ gravadas: [], violacoes: [], errosPagina: [], tenants: new Set() });
function exigeEscrita() {
  test.skip(!ESCRITA, "fluxos que gravam: só com F34_ESCRITA=1, um por vez, dono avisado");
  if (ALVO !== "copia") throw new Error("fluxos que GRAVAM: só com F34_ALVO=copia (nunca em produção)");
}
async function paginaEscrita(browser: Browser, st: EstadoEscrita): Promise<{ ctx: BrowserContext; page: Page }> {
  if (ALVO !== "copia" || !ESCRITA) throw new Error("fluxo que GRAVA só com F34_ALVO=copia e F34_ESCRITA=1");
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
  console.log(`[f34-escrita] ${fluxo} passo ${n} (${nome}) → ${arq}`);
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
async function estadoComprado(id: string) {
  const linhas = await sqlCopia<{ variante_numero: number; grades: Record<string, number> }>(
    "select variante_numero, grades from modelo_grades where modelo_id = $1", [id]);
  const [c] = await sqlCopia<{ etiquetas: number; cad: number; tecidos: number }>(
    `select (select count(*)::int from modelo_etiquetas where modelo_id = $1) etiquetas,
            (select count(*)::int from cad where modelo_id = $1) cad,
            (select count(*)::int from modelo_tecidos where modelo_id = $1) tecidos`, [id]);
  return { grades: Object.fromEntries(linhas.map((r) => [r.variante_numero, r.grades])) as Record<number, Record<string, number>>, ...c };
}

test("E1 — revenda: grade + insumo gravam de verdade (grade por salvar_grade_revenda; insumo pelo BOM com a MESMA grade); sem CAD nem tecido", async ({ browser }) => {
  exigeEscrita();
  test.setTimeout(8 * 60_000);
  const st = estadoEscrita();
  const { ctx, page } = await paginaEscrita(browser, st);
  const antes = await estadoComprado(CARD.rev);
  await page.goto(`/criacao/planejamento?modelo=${CARD.rev}`, { waitUntil: "networkidle" });
  await expect(page.getByRole("dialog").first()).toBeVisible({ timeout: 30_000 });
  await passo(page, "E1", 1, "aberto");
  await expandir(page, "grade_revenda");
  const cel = page.locator('[data-secao="grade_revenda"] input[data-colab-path^="grade-revenda:"]').first();
  const chave = (await cel.getAttribute("data-colab-path")) ?? "";
  const v = Number(await cel.inputValue()) || 0;
  await cel.fill(String(v + 1));
  await adicionarInsumo(page);
  await passo(page, "E1", 2, "editado");
  await salvarReal(page);
  await passo(page, "E1", 3, "salvo");
  const depois = await estadoComprado(CARD.rev);
  const [, ordem, tam] = chave.split(":");
  expect(depois.grades[Number(ordem)]?.[tam]).toBe(v + 1);
  expect(depois.etiquetas).toBe(antes.etiquetas + 1);
  expect(depois.cad).toBe(antes.cad);
  expect(depois.tecidos).toBe(0);
  conferirEscrita(st, "E1");
  await ctx.close();
});

test("E2 — card NOVO com Origem Importado: o Salvar cria o card E o produto no Produto Importado (D1)", async ({ browser }) => {
  exigeEscrita();
  test.setTimeout(8 * 60_000);
  const st = estadoEscrita();
  const { ctx, page } = await paginaEscrita(browser, st);
  const nome = `QA F3.4 importado ${Date.now()}`;
  await page.goto("/criacao/planejamento", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Novo Modelo" }).first().click();
  const dlg = page.getByRole("dialog").first();
  await dlg.locator("div.grid.gap-1").filter({ has: page.getByText("Nome do Modelo", { exact: true }) }).locator("input").fill(nome);
  await comboDoCampo(page, "Origem").click();
  await opcao(page, "Importado").click();
  await comboDoCampo(page, "Grupo").click();
  await page.getByRole("option").first().click();
  await comboDoCampo(page, "Categoria").click();
  await page.getByRole("option").first().click();
  await passo(page, "E2", 1, "preenchido");
  await dlg.getByRole("button", { name: "Salvar" }).click();
  await expect.poll(async () => (await sqlCopia<{ n: number }>(
    "select count(*)::int n from produtos_importados p join modelos m on m.id = p.modelo_id where m.nome = $1 and m.origem = 'importado'", [nome]))[0].n,
  { timeout: 30_000 }).toBe(1);
  await passo(page, "E2", 2, "salvo");
  conferirEscrita(st, "E2");
  await ctx.close();
});

test("E3 — (PULADO — R4) Enviar à Explosão de um COMPRADO elegível (só com D2 = A/A2 e F34_E3=1)", async ({ browser }) => {
  exigeEscrita();
  test.skip(process.env.F34_E3 !== "1",
    "PULADO (G-plano F3.4 R4): nenhum comprado elegível na cópia e nenhum comprado com enviado_cad na cópia nem em produção — registrar e seguir");
  test.skip(D2 === "B", "D2 = B: o comprado não envia pelo Planejamento");
  const id = process.env.F34_CARD_COMPRADO_GATE ?? "";
  test.skip(!/^[0-9a-f-]{36}$/.test(id), "sem comprado elegível na cópia (Task 9 Step 1) — registrar e seguir");
  test.setTimeout(8 * 60_000);
  const st = estadoEscrita();
  const { ctx, page } = await paginaEscrita(browser, st);
  await page.goto(`/criacao/planejamento?modelo=${id}`, { waitUntil: "networkidle" });
  await expect(page.getByRole("dialog").first()).toBeVisible({ timeout: 30_000 });
  await passo(page, "E3", 1, "aberto");
  const botao = page.getByRole("dialog").first().getByRole("button", { name: "Enviar à Explosão" });
  await expect(botao).toBeEnabled({ timeout: 30_000 });
  await botao.click();
  await page.getByRole("button", { name: "Sim, enviar" }).click();
  await expect.poll(async () => (await sqlCopia<{ e: boolean }>("select coalesce(enviado_cad,false) e from modelos where id = $1", [id]))[0].e, { timeout: 30_000 }).toBe(true);
  await passo(page, "E3", 2, "enviado");
  conferirEscrita(st, "E3");
  await ctx.close();
});
```

- [ ] **Step 3: Rodar o automático (só leitura; escritas simuladas)**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f34-comprado"
set -a; . .superpowers/f34/qa-cards.env; set +a
E2E_BASE_URL=http://localhost:5183 VITE_SUPABASE_URL=http://127.0.0.1:54321 F34_ALVO=copia F34_D2=<A|A2|B conforme o dono> \
  npx playwright test tests/e2e/f34-qa.spec.ts --workers=1 --retries=0 -g "F3.4 — " 2>&1 | tail -30
cat .superpowers/f34/qa/automatico.json
```

Expected: 1 passed; `violacoes: []`, `errosPagina: []`; `barradasEsperadas` só com `servicos_financeiro`/broadcast. Falha: o controlador reporta com o passo, o print e o trecho — seletor que não casa com a tela REAL é ajustado SÓ no spec (registrado); comportamento errado volta para a task dona.

- [ ] **Step 4: Fluxos que gravam (E1–E2; o E3 está PULADO — R4) — UM por vez, com o OK do dono a cada um**

Antes de cada um, avisar o dono por chat ("vou gravar na cópia: E<n> — <título>; o card <nome> fica <efeito>") e esperar o OK. No aviso, dizer também: a Loja Teste está com a chave `kanban_automatico` LIGADA na cópia — o Salvar real pode MOVER o card de coluna e gravar histórico na cópia (E1: "Vestido Teste" não tem Ordem ⇒ não está no kanban; E2 cria um card novo sem Ordem). Depois:

```bash
set -a; . .superpowers/f34/qa-cards.env; set +a
E2E_BASE_URL=http://localhost:5183 VITE_SUPABASE_URL=http://127.0.0.1:54321 F34_ALVO=copia F34_D2=<A|A2|B> F34_ESCRITA=1 \
  npx playwright test tests/e2e/f34-qa.spec.ts --workers=1 --retries=0 -g "E1 —" 2>&1 | tail -20
```

(idem `-g "E2 —"`). Expected: cada um passa; os PNG e o `.json` em `.superpowers/f34/qa/escrita/`. O E3 NÃO roda: registrar no relatório "E3 PULADO" com o motivo da Step 1 (G-plano F3.4 R4). Só se o dono autorizar preparar um comprado elegível PELA TELA na cópia (e ele passar a aparecer no `F34_CARD_COMPRADO_GATE` do Step 1): avisar "vou gravar na cópia: E3 — envia <card> à Explosão (efeito que fica)" e rodar com `F34_E3=1 -g "E3 —"`.

- [ ] **Step 5: Relatório e derrubar a variante**

Relatório curto ao guardião (S1–S9 com S2b e S5b + E1–E2: passou/falhou, com os caminhos dos PNG/JSON; E3: PULADO com o motivo — R4). Depois:

```bash
"/Users/sunglee/PLM + Criação/banco-local/app-teste-variantes/f34/descer.sh"
lsof -nP -iTCP:5183 -sTCP:LISTEN; echo "5183 livre"
lsof -nP -iTCP:5188 -sTCP:LISTEN -t | sed 's/^/:5188 do dono intacto, PID /'
```

---

## Task 10: Revisões, portões do guardião e merge  *(controlador)*

- [ ] **Step 1: Revisões Opus pendentes** — conforme §5 (Lote A; individual 3; 4+5 juntas; Lote B; individual 7). Cada achado corrigido volta aos gates (`bash .superpowers/f34/gates.sh`).

- [ ] **Step 2: Conferências finais**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f34-comprado"
git diff --name-only savepoint-pre-unificacao-2026-09-22 -- src/components/desenvolvimento/ src/components/producao/cad/CadTecidosSection.tsx   # vazio (decisão 8)
git diff --name-only "$(cat .superpowers/f34/BASE)" -- src/components/producao/ src/lib/kanban-condicoes.ts src/lib/revenda-config.ts src/lib/origem.ts src/components/produto-acabado/ src/components/produto-importado/ supabase tests/integration tests/fixtures   # vazio
git diff --name-only "$(cat .superpowers/f34/BASE)" -- supabase/migrations | wc -l                                  # 0 (sem migration — §3)
grep -rn 'rpc("salvar_grade_revenda"' src/components/planejamento | cut -d: -f1 | sort -u                          # só usePlanejamentoSave.ts
grep -rn 'rpc("salvar_produto_importado"' src/components/planejamento | cut -d: -f1 | sort -u                      # só usePlanejamentoSave.ts
grep -rn '"plan-comprado-produto"\|"plan-origem-tem-tecidos"\|"plan-origem-espelhos"' src | cut -d: -f1 | sort -u   # useGradeComprado, PlanejamentoDetail, usePlanejamentoSave
grep -rn "lerGradeServidorComprado(" src | cut -d: -f1 | sort -u                                                     # persistir-bom.ts (definição) e usePlanejamentoSave.ts (R1)
bash .superpowers/f34/gate-f31.sh; bash .superpowers/f34/gate-f32.sh; bash .superpowers/f34/gate-f33.sh              # "preservada: ok" ×3
```

- [ ] **Step 3: G-commit + G-fase F3.4 (guardião)** — anexar: saída de `gates.sh`, o relatório do QA (`automatico.json` com "1 passed" e as barradas esperadas; `escrita/` E1–E2; o registro do E3 PULADO com o motivo — R4), os greps do Step 2, o `INDICE.tsv` do snapshot (Task 8), a conferência de `revenda_campos` (nenhuma loja com `s4:false`, ou o aviso ao dono) e a do `espelhos_conferencia.csv` (0 linhas — R3), as decisões do dono respondidas (§8), as técnicas (§7), a prova da §3, o registro de âncoras divergentes (se houver) e, se a F3.4 nasceu pelo ruling R3a, o `.superpowers/f34/rebase-f33.md`.

- [ ] **Step 4: Pré-merge — a F3.3 JÁ juntada, snapshot de HOJE e aviso ao dono**

```bash
MAIN="/Users/sunglee/PLM + Criação/plm-pcp"
git -C "$MAIN" merge-base --is-ancestor "$(git -C "$MAIN" rev-parse f33/cad-acoes)" feature/plan-tecido-a1 && echo "F3.3 juntada: ok" || echo "F3.3 NÃO juntada — PARE (a F3.4 espera)"
```

Com `F3.3 juntada: ok` (ou o controlador confirma o commit equivalente se a F3.3 juntou por rebase): pedir ao dono, por chat, para salvar e fechar os cards abertos do Planejamento/Desenvolvimento no `:5173` E no `:5188`; pausar executores de outras fases durante o merge. Snapshot da Task 8 feito HOJE.

- [ ] **Step 5: Rebase `--onto` sobre a branch principal e fast-forward**

```bash
MAIN="/Users/sunglee/PLM + Criação/plm-pcp"; WT="$MAIN/.claude/worktrees/f34-comprado"
BASE34="$(cat "$WT/.superpowers/f34/BASE")"
git -C "$WT" log --oneline "$BASE34..HEAD" | tee "$WT/.superpowers/f34/commits-f34.txt" | wc -l   # os commits F3.4 (1)…(7)
git -C "$WT" rebase --onto feature/plan-tecido-a1 "$BASE34" f34/comprado
git -C "$WT" merge-base --is-ancestor feature/plan-tecido-a1 HEAD && echo "F3.4 sobre a branch principal: ok"
```

Conflito no rebase: resolver preservando o texto FINAL da F3.3 (é contrato) e registrar. Depois do rebase — mesmo sem conflito — refazer a recontagem das âncoras (Task 0 Step 3) com `export PONTA="$(git rev-parse feature/plan-tecido-a1)"` (NUNCA no HEAD, que já tem a F3.4); `git diff --stat "$BASE34" "$PONTA" -- $(cat .superpowers/f34/arqs-f34.txt)` e re-revisar as tasks da F3.4 afetadas; `bash .superpowers/f34/gates.sh`; o automático da Task 9 (Step 3) e o E1 de novo (re-escolher os cards pelo Step 1 da Task 9). Então:

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp"
git status --porcelain | grep -v '^??' && echo "HÁ ALTERAÇÃO NÃO COMMITADA NO CHECKOUT PRINCIPAL — PARE" || true
git merge --ff-only f34/comprado
```

Se não for ff (a branch principal andou): repetir este Step com `BASE34="$(git -C "$WT" merge-base HEAD feature/plan-tecido-a1)"`.

- [ ] **Step 6: Smoke pós-merge (SÓ LEITURA, produção, guarda de sempre)**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f34-comprado"
PGOPTIONS='-c default_transaction_read_only=on' psql "$(cat /tmp/dburl.txt)" -X -A -t -q -c \
  "select coalesce(revenda_campos::text,'{}') from tenant_config where tenant_id = '37889b78-fffb-404b-8c75-18b7e50a1d9b'"
export F34_SMOKE_CARD="$(PGOPTIONS='-c default_transaction_read_only=on' psql "$(cat /tmp/dburl.txt)" -X -A -t -q -c \
  "select m.id from modelos m join produtos_acabados p on p.modelo_id = m.id where m.tenant_id = '37889b78-fffb-404b-8c75-18b7e50a1d9b' and m.origem = 'revenda' order by m.nome, m.id limit 1")"
echo "smoke: $F34_SMOKE_CARD"
E2E_BASE_URL=http://localhost:5173 VITE_SUPABASE_URL="$(grep '^VITE_SUPABASE_URL=' .env | cut -d= -f2- | tr -d '"')" F34_ALVO=producao \
  npx playwright test tests/e2e/f34-qa.spec.ts --workers=1 --retries=0 -g "S0 —" 2>&1 | tail -8
```

Expected: `revenda_campos` = `{}` (defaults — senão ajustar SÓ as expectativas do S0 à config e registrar); `smoke: <uuid>`; "1 passed" (nenhum Salvar é clicado; toda escrita seria barrada).

- [ ] **Step 7: Limpeza** — `rm tests/e2e/f34-qa.spec.ts` (arquivo próprio, não versionado); a worktree pode ser removida depois do merge (`git worktree remove`); a variante `banco-local/app-teste-variantes/f34/` e o backup `criar-variante.sh.bak-pre-f34` ficam (fora do repo). Memória/docs: F4 (docs-keeper) — invariante #13 ganha "grade cor × tamanho = fonte única do comprado no Planejamento; importado grava pelo BOM; Origem Importado com auto-criação".

---

## 6. Riscos (com evidência) e o que o plano faz

| # | Risco | Evidência | O que o plano faz |
|---|---|---|---|
| R1 | Grade VELHA do comprado regravada por cima da de outra pessoa | o rascunho da grade é semeado 1× por abertura (`useRevendaPlanejamento.ts:219-231`); `salvar_modelo_bom` apaga todas as grades (funcoes.sql:7610); G-plano F3.4 R1: o cache `plan-ficha-grades` também fica VELHO — sem toque, uma mudança alheia só INVALIDA (useFichaTecnica.ts:444-450 @6fac668) e o merge já avançou o `revRef`; até o refetch chegar, um Salvar (revenda: insumo tocado; importado: célula editada) passaria no `.eq("rev")` com a grade antiga (e o `gradeConflito` comparava com o mesmo cache velho) | `gradesParaBomComprado`: não editada ⇒ a do SERVIDOR **lida no próprio Salvar** junto com o `rev` (`lerGradeServidorComprado`, §7 T13); `rev` lido ≠ o do card ⇒ P0409 (retry que já existe); erro ⇒ nada grava; comprado que grava sem a leitura ⇒ a captura LANÇA (nunca `?? []`); editada na revenda ⇒ `salvar_grade_revenda` com rev próprio (conflito ⇒ recarga); editada no importado ⇒ conferência com a grade LIDA antes de gravar (`gradeConflito` ⇒ P0409 + recarga) e a ficha fica tocada (R5/R5a). QA S4/S5 (cache velho × servidor novo)/S5b (rev à frente ⇒ nada grava)/S6 |
| R2 | Tecido deixado num comprado segue RESERVANDO estoque | `_estoque_tecido_core` não filtra origem | D1: Interno → comprado só com Tecidos vazia (`plan-origem-tem-tecidos` + ficha); QA S1 |
| R3 | CAD do comprado apagando as etiquetas "a enviar" do recebimento | `_salvar_cad_completo_core` apaga e re-insere `cad_etiquetas`; `_receber_oc_p_acabado_core` as materializa com peças reais | `cadGravavel`/`deveGravarCad` barrados por origem; seção CAD só-leitura com aviso; QA S4/S6 (`salvar_cad_completo` não chamado) |
| R4 | Preço da revenda não recalcula ao mudar INSUMO (pré-existente) | `_pa_recomputar_precos_modelo` não é chamado por `modelo_etiquetas`; o Dev já edita insumos da revenda hoje | Paridade (não piora); o `plan-custo-unit` é invalidado no Salvar (o custo aparece novo); o preço derivado do markup só muda no próximo gatilho (markup/MO/OC). Registrado p/ tarefa de banco |
| R5 | Preço digitado do IMPORTADO no Planejamento é recalculado (pré-existente) | importado usa a tabela do interno (`!isRevenda`); `_imp_recomputar_precos_modelo` escreve `else NULL` no próximo gatilho | Fica como hoje (decisão #6 "mantém"); a F3.4 só corrige o previsto (landed, não o BOM) e tira as linhas do BOM da tabela do importado. Registrado |
| R6 | Loja com `s4:false` p/ revenda perde a grade cor × tamanho no Planejamento | a grade passa a seguir a seção "s4" (decisão #8) | Hoje nenhuma loja (cópia: `revenda_campos = {}` nas 6); Task 8 confere em produção e avisa o dono antes do merge |
| R7 | Duas telas na mesma grade até a F5 (Dev × Planejamento) | o Dev regrava `modelo_grades` no Salvar dele (grade por variante do Tecido 1; p/ comprado sem variante ele reenvia as linhas carregadas) | Proteção por `modelos.rev` (a escrita em `modelo_grades` sobe o rev — `trg_colab_bump`): o Salvar do Planejamento recebe P0409 e recarrega/merge. Mesma classe já aceita na F3.2 |
| R8 | Âncoras da F3.3 ainda mudando (Tasks 9–10 dela por fazer) | F3.3 em execução (24/set): T1–T8 + fixes commitados até `67e363f`; a T9 em curso na worktree (sem commit) e a T10 a seguir; em `6fac668`/`67e363f` faltam `MenuMaisAcoes.tsx`/`useEnviarExplosao.ts`/`useImportarDados.ts`, 4 âncoras do Step 3 dão 0 e o `gate-f33.sh` falha (G-plano F3.4 R2) | Largada SÓ com T9 e T10 da F3.3 commitadas e a worktree da F3.3 limpa (Task 0 Step 1); Task 0 Step 3 conta TODAS as âncoras NA PONTA (as 4 do Enviar/Importar marcadas); ruling R3a + Task 0 Step 5; Task 10 Step 5; 7º gate `gate-f33.sh` |
| R9 | REF vazia no card comprado criado pelo Planejamento (pré-existente) | a auto-criação da revenda não copia a REF do produto p/ `modelos.ref` ("Cinto Teste" REF vazia na cópia) | Fora de escopo (igual à revenda); com D2 (A) o "Para enviar, falta" mostra "REF" — igual ao Dev. Registrado |
| R10 | Auto-criação do importado gera produto com câmbio zerado | `salvar_produto_importado` com etapas/variantes vazias | Esperado (espelho da revenda): a tela do Produto Importado completa; toast diz onde. Best-effort |
| R11 | `salvar_produto_importado` ambíguo (sobrecarga 4/5 argumentos) | 2 assinaturas na cópia | Chamada com os 5 argumentos (`_rev_base: null`), igual à tela do Produto Importado |
| R12 | Colunas derivadas do BOM passam a ser gravadas p/ comprado com a ficha editável (G-plano F3.4 R6) | `aplicarColunasFicha` (F3.2) roda com `podeGravarColunasDev`. Num comprado, o Salvar que grava o BOM escreve `tecidos_planejados = []` (derivado do BOM sem tecido — save-ficha.ts:40) e `custo_*` / `custo_peca_previsto` = insumos + MO (usePlanejamentoSave.ts:351-356), **sem o custo do produto** — valores PARCIAIS. Leitores: `_custo_unitario_modelos_core` as IGNORA no ramo revenda/importado; mas `_dashboard_custos_core` lê `custo_peca_previsto` de TODO modelo, **sem ramo de origem** | Paridade com o Dev, que já grava essas colunas p/ comprado (MDP:1913/1930) — a F3.4 não cria o caminho, só o abre no Planejamento. Efeito visível: no Dashboard Custos, um comprado salvo com a ficha editável sai de 0 para um valor parcial (insumos + MO). Hoje nenhuma das 57 revendas de produção é afetada (0/57 com `tecidos_planejados` ou `custo_peca_previsto`). O snapshot da Task 8 guarda `custo_peca_previsto` e `tecidos_planejados`. O ramo de origem no `_dashboard_custos_core` fica registrado p/ tarefa própria de banco (fora da F3.4 — sem migration) |
| R13 | QA do importado só simulado no automático | 0 cards importados na cópia | S6 simula o card/produto por `route.fulfill`; E2 cria um importado de verdade na cópia (grava card + Produto Importado) |
| R14 | Card com DOIS espelhos — Produto Acabado E Produto Importado (invariante #13; G-plano F3.4 R3) | `enforce_unique_fk` é POR TABELA; a regra da Origem lia só o produto da origem SALVA e só com o módulo dela ligado (`useGradeComprado`, P:955-956/:1328 da versão anterior) ⇒ módulo desligado = "sem produto" ⇒ Revenda↔Importado liberada e o Salvar auto-criaria o OUTRO espelho; produção: 2 de 6 lojas com `produto_importado` | Regra da Origem pelos DOIS espelhos, qualquer que seja a origem (`plan-origem-espelhos`, Task 6): `produtos_acabados` lido SEMPRE (sem modgate — não depende do `paOn`); `produtos_importados` só com `piOn`, senão INDETERMINADO ⇒ a saída de um card importado trava (e Revenda → Importado já trava pelo módulo); ir p/ uma família com produto vinculado na OUTRA é barrado — inclusive o card interno que já foi comprado; as duas auto-criações conferem o outro espelho NA HORA (erro na leitura ⇒ não cria — Task 5 Step 4). Testes: Task 1 (`motivoTrocaOrigem`/`espelhosDoCard`); Task 8 confere 0 card com os dois em produção. **Resíduo documentado:** com o módulo Produto Importado DESLIGADO, o produto importado de um card que já foi importado e voltou a Interno fica invisível (RLS) — virar Revenda criaria o 2º espelho. Exige ligar o módulo, virar Importado, voltar a Interno e desligar o módulo; fechar exigiria função nova no banco (fora — sem migration) |
| R15 | Ficha pela origem do RASCUNHO × grade pela origem SALVA (G-plano F3.4 R7) | a ficha projeta pela origem do rascunho (`isComprado = ehOrigemComprada(draft.origem)`, PD:248 @67e363f → `useFichaTecnica`) e a grade cor × tamanho segue a salva (`useGradeComprado({ origem: origemSalva })`); trocar a Origem com a ficha JÁ tocada deixaria a referência do BOM (R5) calculada com a OUTRA projeção ⇒ "Tecidos & BOM" falso; o QA S2 só cobria a troca sem toque | Mitigação: a Origem NÃO muda com edição pendente — ficha tocada (`ficha.tocado`, não `dirty`: editar e desfazer mantém a referência presa) OU grade cor × tamanho editada — nos DOIS sentidos, inclusive de volta à salva; motivo `MOTIVO_EDICAO_PENDENTE` abaixo do Select (Task 1 + Task 6). Sem toque, a referência re-baseia sozinha (efeito `!bom.tocado` do useFichaTecnica; `estado` depende de `a.isComprado` — Task 4 Step 5 (e)). QA S2 (sem toque) + S2b (com toque ⇒ travada) |

## 7. Decisões técnicas (o controlador decide)

- **T1** — A grade SAI de `useRevendaPlanejamento` para `useGradeComprado` (texto movido), com os MESMOS nomes de estado/refs e a MESMA queryKey `["modelo-grades-revenda", modeloId]` (o `onError` do Salvar a relê) — o `usePlanejamentoSave` não muda nessa parte. O produto é lido por origem em key própria (`plan-comprado-produto`, forma diferente da `pa-produto-modelo`, que fica p/ o preço).
- **T2** — A ficha do comprado PROJETA a grade para fora (`grades: []`) nos dois lados de toda comparação, em vez de ter dois estados de grade; a grade entra só no `gradesPayload` do Salvar.
- **T3** — Grade do importado grava pelo BOM (`salvar_modelo_bom`), sem migration; por isso exige a ficha editável (D3 (A)). A revenda segue por `salvar_grade_revenda` (sem mudança).
- **T4** — Conflito da grade do importado = o MESMO tratamento da revenda (P0409 + `gradeConflict` ⇒ recarga da grade e do rev), lançado antes de qualquer escrita.
- **T5** — CAD do comprado nunca grava pelo Planejamento; a seção (se a loja ligar `s-cad`) é só-leitura com aviso.
- **T6** — "Importar dados" só p/ interno (o diálogo do Dev copia a grade por variante do Tecido 1, que o comprado não tem; reabrir se o dono pedir).
- **T7** — Preço: a tabela da F3.2 (`PrecoTabela` com custo-base real › previsto › estimativa) e o `PrecoRevendaBloco`/`piRevenda` FICAM SEPARADOS: a revenda tem 2 canais (atacado/varejo), preço fixo por canal via RPC do produto e base = previsto + MO — outro modelo de dados; o mockup marca "ficam como hoje". A F3.4 só impede que o BOM contamine o comprado (previsto do servidor; sem "Custos do BOM"), e o selo "Preço" da revenda passa a usar `piRevenda`.
- **T8** — Chaves de seção reaproveitadas: `produto_acabado` = "Produto Acabado" OU "Produto Importado"; `grade_revenda` = a grade cor × tamanho dos dois (nenhuma mudança em `selos-secoes.ts`/testes da F3.3).
- **T9** — Selos do comprado com `revenda_kanban_requisitos` SEM `REVENDA_COND_NA` (a Config já os esmaece; um resto antigo não acende "falta" p/ sempre).
- **T10** — A grade cor × tamanho segue a seção "s4" do Fluxo de Revenda (decisão #8); prova de impacto zero hoje (§6 R6).
- **T11** — "Revenda" continua sempre no Select (como hoje); "Importado" só com o módulo (ou se o card já é importado).
- **T12** — `SecaoBom.oculta` (retorno depois dos hooks) em vez de embrulhar cada seção em JSX condicional — âncoras únicas por título e numeração pelo `vis`.
- **T13 — R1 do G-plano F3.4: opção (a), leitura FRESCA da grade no Salvar, junto com o `rev`.** `lerGradeServidorComprado` (`persistir-bom.ts`) lê `modelos?select=rev,grades:modelo_grades(…)` — um SELECT só no servidor, então `rev` e grade são do mesmo instante (embed já usado em `PlanTecidoSheet.tsx:457`). O `rev` lido é comparado com o `revRef` DEPOIS do await e, da captura até o `let revParaHeader = revRef.current`, não há outro `await`: o `.eq("rev")` do header confere exatamente o rev da leitura — se alguém salvar depois dela, o header falha (P0409). `rev` diferente já na leitura ⇒ P0409 ⇒ o retry que já existe relê o modelo e o BOM e tenta 1×. Erro ⇒ lança; comprado que grava sem a leitura ⇒ a captura lança (nunca `?? []`). **Por que não (b)** (P0409 local quando `cadVelhoRef`/`recarregando`): esses sinais são do CAD e só baixam quando o CAD re-hidrata (`aoHidratar`) — e com a ficha TOCADA a carga do CAD não se aplica (`deveAplicarCargaCad` → false, fix I1 da F3.3). No cenário da R1 (a mudança alheia chega sem toque e o usuário toca antes de salvar) o `cadVelhoRef` ficaria preso em true: o retry lançaria de novo e todo Salvar seguinte cairia no mesmo P0409 até descartar as edições — uma trava. Além disso, (b) só cobre a janela que o cliente JÁ SOUBE (o Realtime chegou); (a) lê o servidor e amarra a leitura ao `.eq("rev")`, cobrindo também o Realtime que chega DURANTE o Salvar. Custo de (a): 1 GET a mais por Salvar de card comprado.
- **T14 — R3: os dois espelhos numa query própria (`plan-origem-espelhos`), fora do `useGradeComprado`.** A grade continua lendo o produto da origem SALVA só com o módulo dela ligado (é o que ela precisa); a regra da Origem ganhou a sua fonte, que lê `produtos_acabados` SEMPRE (sem modgate) e `produtos_importados` só com `piOn` — sem o módulo, `null` = INDETERMINADO (a RLS esconderia as linhas e "vazio" liberaria o 2º espelho). Indeterminado trava só a SAÍDA de um card importado: a Revenda de um card interno segue livre (4 de 6 lojas em produção não têm o módulo — não regridem). As auto-criações conferem de novo na hora (a query da tela pode estar velha). Resíduo na §6 R14.
- **T15 — R7: trava da Origem com edição pendente, em vez de reprojetar a referência.** Guardar a referência do BOM sem projeção e projetar na hora de comparar mexeria no miolo da F3.3 (R5/R5a, `assinaturaBom`); travar a troca enquanto `ficha.tocado || gradeRevendaDirty` resolve com uma regra pura (`opcoesOrigem({ edicaoPendente })`) e um motivo na tela. Sem toque, o efeito de referência (`!bom.tocado`) já re-baseia na projeção nova.
- **T16 — R4: E3 PULADO.** Único teste que GRAVA o envio de um comprado à Explosão; sem card elegível na cópia (COMPRADO_GATE vazio) e sem nenhum comprado com `enviado_cad` na cópia nem em produção (nada existente regride). A D2 fica coberta pelo S7, pela Task 2 e pela §3; o E3 só roda com `F34_E3=1` se o dono autorizar preparar um card pela tela na cópia (Task 9 Steps 1 e 4).

## 8. Decisões para o dono

Texto para levar ao dono, em linguagem simples (G-plano F3.4 R4/R5: o que é regra técnica só se INFORMA; pergunta só o que é escolha dele). Respostas ANTES da Task 1 (D1, D3) e da Task 7 / Task 9 (D2).

**D1 — Trocar a Origem (Interno / Revenda / Importado) de um card que já tem coisas**

INFORMAR (regra técnica, já decidida):
- Um card Interno só vira Revenda ou Importado com a seção Tecidos vazia. Tecido no card reserva estoque; num produto comprado ele ficaria escondido e reservando à toa. Aviamentos, insumos e mão de obra continuam; a grade por cor do tecido sai de cena e vale a grade cor × tamanho do produto.
- Um card nunca fica com dois produtos ao mesmo tempo (um no Produto Acabado e outro no Produto Importado). Por isso, trocar entre Revenda e Importado só dá quando não há produto vinculado.
- Se um card Revenda ou Importado voltar a Interno, o produto dele continua vinculado na tela do Produto Acabado / Produto Importado (não é apagado).
- Enquanto houver edição não salva em Tecidos, Aviamentos, Insumos ou na Grade, a Origem fica travada: salve (ou descarte) antes de trocar.

PERGUNTAS:
- **(i)** "Um card Revenda ou Importado cujo produto já tem pedido de compra (OC) pode voltar a ser Interno?" — **Recomendo não**: com pedido, o produto já está sendo comprado; voltar a Interno deixaria esse pedido ligado a uma peça que passaria a ser fabricada. (Hoje a troca é livre.)
- **(ii)** "Ao salvar um card como Importado, o sistema cria o produto no Produto Importado sozinho, como já faz com a Revenda no Produto Acabado?" — **Recomendo sim**: câmbio, variantes e etapas você completa lá.

**D2 — "Enviar à Explosão" para Revenda e Importado no Planejamento**
- **(A, recomendado)** Igual ao Desenvolvimento de hoje, **para Revenda e também para Importado**: o botão aparece a partir da etapa configurada, com a lista do que falta (só o que a loja deixou visível para produto comprado — grade, REF, nome, estilista, categoria). Atenção: o Importado normalmente não passa pela Explosão, mas com (A) ele ganha o botão mesmo assim — como já acontece no Desenvolvimento. Sem o botão, quando o Desenvolvimento for aposentado, o comprado perde esse envio.
- **(A2)** Só para Revenda: o Importado fica sem o botão.
- **(B)** Não mostrar para produto comprado (a Revenda já entra na Explosão sozinha quando a OC é recebida).
- Obs.: não há na cópia nenhum card comprado pronto para testar esse envio gravando de verdade, e nenhum comprado — na cópia ou em produção — foi enviado à Explosão até hoje. Esse teste fica pulado; o botão e a lista do que falta são testados sem gravar. Se quiser o teste gravando, dá para preparar um card pela tela na cópia, com o seu OK.

**D3 — Quem edita a grade cor × tamanho do IMPORTADO no Planejamento**
- **(A, recomendado agora)** Quem edita o Desenvolvimento — a grade do importado grava junto com a ficha, sem mexer no banco.
- **(B)** Quem edita o Planejamento, igual à revenda — precisa de uma função nova no banco (etapa própria, com o portão do banco e o seu OK).
- INFORMAR: a revenda não muda — segue editável por quem edita o Planejamento. **Depois de enviado à Explosão, a grade do importado trava junto com a ficha; para mudar, usar o botão Editar.**

**(INFORMADO)** Mão de obra continua aparecendo para revenda/importado (já aparece hoje — decisão #5). O preço da revenda fica exatamente como hoje (markups, preço fixo, mão de obra na base); o importado segue a tabela de hoje. O Planejamento nunca grava o CAD de produto comprado. "Importar dados" fica só para produto interno.

**Se a resposta for outra (variantes do plano):**
- D1 (i) = **sim** (pode voltar a Interno com OC): na Task 1, apagar em `motivoTrocaOrigem` o comentário `// D1 (i) — recomendação…` e o `if (meu.temPedido) …` logo abaixo (Revenda↔Importado segue travada pelo espelho — R3); no teste, o caso "revenda com pedido (OC)" passa a esperar `out.find((o) => o.value === "interno")?.disabled` = `false`; no QA S3, a expectativa "Interno travado (pedido)" vira `not.toHaveAttribute("aria-disabled", "true")`.
- D1 (ii) = **não** (não auto-criar o Produto Importado): pular a Task 5 Step 4 (b) e (c) (a revenda segue como hoje; o (a2) fica); na Task 3 Step 3, a `ProdutoImportadoSecao` sem produto passa a dizer "Nenhum produto importado vinculado ainda — cadastre o produto no Produto Importado." e a `GradeRevendaSecao` sem produto, no importado, "Este card ainda não tem produto vinculado — cadastre-o no Produto Importado."; o E2 passa a conferir só o card (0 Produto Importado criado).
- D2 = (A2) ou (B): a Task 7 Step 5 tem o texto de cada uma; `F34_D2=A2` ou `F34_D2=B` no QA.
- D3 = (B): fora deste plano — etapa própria com G-migration (§3; Global Constraints "Fora de escopo").
- A "alternativa" da versão anterior do D1 (deixar trocar sempre, só com aviso) NÃO é mais oferecida: as regras técnicas (Tecidos vazia, nunca dois espelhos) protegem o estoque e a invariante #13 (G-plano F3.4 R5).

## 9. Autorrevisão (cobertura do pedido F3.4)

| Pedido | Onde |
|---|---|
| Origem ganha "Importado" (módulo opt-in, `ehOrigemComprada` + `produto_importado`); trocar muda o fluxo; auto-criação | Task 1 (`opcoesOrigem`/`motivoTrocaOrigem`/`espelhosDoCard`), Task 6 (Select + motivo + `plan-origem-espelhos`), Task 5 (auto-criar Produto Importado sem 2º espelho), D1; QA S1/S2/S2b/E2 |
| Troca interno ↔ comprado com BOM/CAD existentes (o que acontece com o BOM interno) | D1 (tecido bloqueia; aviamentos/insumos/MO ficam; grade do tecido sai de cena; nunca dois espelhos; comprado com pedido não volta — D1 (i); edição pendente trava); §6 R2/R14/R15; ficha sem prefill p/ comprado (Task 4) |
| Visibilidade por `revendaCampoVisivel`/"Fluxo de Revenda" (seções e campos de Info Básicas, `REVENDA_CAMPOS_DEFAULT_OFF`) | Task 1 (`secoesFicha`), Task 7 (`vis`, `SecaoBom.oculta`); campos de Info Básicas já pela F3.1 (`campoVisivelDev`); QA S3 |
| Um único editor de grade; `salvar_modelo_bom` recebe a grade cor × tamanho; onde vive a grade e como vira `modelo_grades` sem perder dado | §1 (produto → `_pa_grade_variante` → `modelo_grades` por `ordem`; OC `grade_detalhe` é outra coisa — vira `cad_grades` no recebimento; 0 órfãs); Task 3 (`useGradeComprado`), Task 4 (projeção + `gradesPayload` + `lerGradeServidorComprado`), Task 5 (leitura fresca/captura/baseline/conflito); QA S4/S5/S5b/S6/E1 |
| MO visível p/ revenda/importado (#5) | já hoje (`PlanejamentoDetail.tsx:1159`); `vis.mao_obra` intocado; QA S3 |
| Markup/preço da revenda mantidos; convivência com a tabela da F3.2 | §7 T7 (separados, justificado); Task 7 (previsto do servidor, sem "Custos do BOM" no comprado, selo da revenda por `piRevenda`); QA S3 |
| BOM/Insumos de revenda; seções; o que grava; gate de Enviar à Explosão de comprado | Task 4/5 (o que grava), Task 7 (seções/Enviar — D2 (A)/(A2)/(B)), Task 2 (pendências), D2; §3; QA S4/S7 (E3 PULADO — §7 T16) |
| Kanban de revenda: colunas/requisitos próprios nos selos por seção, requisitos POR ORIGEM | Task 1 (`requeridasPorOrigem`, `seloGradeComprado`, `desenvolvimentoCompleto`), Task 4 (ficha), Task 7 (`requeridasCard`, selos); Enviar pelo gate de etapa (F3.3) |
| QA contra a CÓPIA, variante `:5183` no `case` do `criar-variante.sh` com backup, smoke só-leitura, guarda invertida, nunca 5173/5184–5188 | Task 9 (Step 1: 5183 com backup; spec com guarda invertida), Task 10 Step 6 |
| Decisão 8: Dev intocado (cópia se precisar) | Global Constraints; nenhuma cópia necessária; gate 4 em todo commit |
| Banco: migration? | NÃO — prova na §3; D3 (B) seria a única e fica fora |
| Gates com 7º "F3.3 preservada" | Task 0 Step 4 (`gate-f33.sh`, `gates.sh`) |
| Revisão lote/individual (save, colab e grade = individual) | §5 (3, 4+5, 7 individuais; 1+2 e 6 em lote) |
| Ressalvas R1–R7 do G-plano F3.4 (e o informativo do D3) | §0 (mapa ressalva → âncoras) |

Checagens desta autorrevisão (refeita após as ressalvas do G-plano F3.4): (1) sem "TBD"/"implementar depois" — as bifurcações são as respostas do dono: D2 (A)/(A2)/(B) escritas na Task 7 Step 5, e D1 (i)/(ii) e D3 com as variantes em "Se a resposta for outra" (§8); (2) nomes entre tasks conferidos — `linhasGradeComprado` (Task 1 → Task 3), `useGradeComprado`/`GradeComprado`/`gradeComprado`/`origemSalva`/`piOn` (Task 3 → 5/6/7), `GradeExternaCaptura` (com `servidor`)/`gradesPayload`/`gradeExterna`/`gradeConflito` (Task 4 → 5), `lerGradeServidorComprado` (Task 4 `persistir-bom.ts` → Task 5), `marcarGradeExternaEditada`/`FichaTecnica.gradeExterna` (Task 4 → 7), `FichaTecnica.tocado` (Task 4 → 6), `opcoesOrigem`/`espelhosDoCard`/`EspelhosCard`/`SEM_ESPELHOS`/`MOTIVO_EDICAO_PENDENTE` (Task 1 → 6; teste S2b usa o texto do motivo), `plan-origem-espelhos` (Task 6 → 5 invalidação → 10 grep), `F34_D2 = A|A2|B` e `F34_E3` (Task 9 spec ↔ Steps 3–4), `secoesFicha`/`SECOES_FICHA_INTERNO`/`SecoesFicha` (Task 1 → 7), `requeridasPorOrigem` (Task 1 → 4/7), `seloGradeComprado`/`desenvolvimentoCompleto` (Task 1 → 7), `pendenciasEnvioExplosao({ campoVisivel, secaoGrade })` (Task 2 → 7), `SecaoBom({ oculta })`/`BomSecoes({ visiveis })` (Task 7), `GradeRevendaSecao({ gc, selo, motivoSomenteLeitura })`/`ProdutoImportadoSecao` (Task 3 → 7); (3) blocos TS/TSX novos passados por verificação SINTÁTICA (TypeScript `transpileModule`, sem escrever arquivo) na autoria deste plano e de novo depois das ressalvas do G-plano F3.4 (24/set): todos os blocos completos e todos os trechos novos (comprado.ts e testes, `lerGradeServidorComprado`, captura, Salvar, auto-criações, `plan-origem-espelhos`, motivo do D3, spec do QA) parseiam; os 16 que não parseiam sozinhos são fragmentos de propósito (âncora "trocar X por Y": linha de tipo, argumento de `useMemo`, fechamento de bloco); tipos e testes só rodam na execução (gates); (4) cada ressalva R1–R7 do G-plano F3.4 tem âncora no plano (§0).
