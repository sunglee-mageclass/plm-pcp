# Planejamento unificado — F3.0: refatoração do Sheet do Planejamento de Produto (sem mudança de comportamento) — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quebrar `src/components/planejamento/PlanejamentoDetail.tsx` (2401 linhas) em módulos focados em `src/components/planejamento/planejamento-detail/`, deixando o `PlanejamentoDetail` como orquestrador. Nada muda: comportamento, UI, textos e queryKeys ficam iguais. As fronteiras são escolhidas para a F3.1–F3.4 (Sheet unificado) mexerem em arquivos pequenos.

**Architecture:** São oito extrações, uma por tarefa, sempre por MOVIMENTO de texto:
- O trecho sai do arquivo no commit-base (`BASE`) com `git show | sed -n 'a,bp'`. Nunca é redigitado.
- Ele entra no módulo novo.
- É removido do orquestrador por substituição EXATA (`troca.mjs`, que falha se o trecho não aparecer exatamente 1 vez).

A prova de cada tarefa (`confere.sh`) compara o multiconjunto de linhas antes × depois. A única diferença permitida são as linhas novas e as removidas que a própria tarefa declarou em `add/` e `del/`: cabeçalhos, imports, `export` e fiação.

Estado compartilhado vira hook (`useRevendaPlanejamento`, `usePlanejamentoSave`). O hook é chamado no MESMO ponto do render e recebe os mesmos refs e estados, com os mesmos nomes. O JSX vira componente de nível de módulo, recebendo props.

O trabalho corre numa worktree própria. No fim volta para `feature/plan-tecido-a1` por fast-forward.

**Tech Stack:** Vite + React 19.2 + TypeScript (strict) + TanStack Query v5 + TanStack Router/Start + supabase-js. Testes: Vitest (só `tests/unit`) e Playwright 1.61 (QA A/B com interceptação de rede). Node 24 (scripts de prova) e git worktree. Shell do executor: zsh (os scripts `.sh` rodam em bash pelo shebang).

**Spec:** `/Users/sunglee/.claude/plans/h-uma-necessidade-de-flickering-lovelace.md`. Seções usadas:
- "F3 — Sheet unificado", item **F3.0**: "quebrar `PlanejamentoDetail.tsx` (2401 l.) em `src/components/planejamento/planejamento-detail/` (`campos.tsx`, `PrecoTabela.tsx`, `RevendaSetores.tsx`, `usePlanejamentoSave.ts`); re-exportar `FieldText`/`FieldSelect`. Pode correr em paralelo à F1."
- As 10 decisões de F3 aprovadas.
- O campo "Descrição do produto".

Contexto:
- Extração anterior do mesmo arquivo ("byte a byte + QA visual"): `/Users/sunglee/.claude/projects/-Users-sunglee-PLM---Cria--o/memory/project_planejamento_detail_extraido.md`.
- Diário do guardião: `/Users/sunglee/PLM + Criação/plm-pcp/.superpowers/sdd/2026-09-22-unificacao-kanban-auto/guardiao.md`. Ele diz que a Descrição entra "antes do `</Secao>` da :1868" e que `FieldText`/`FieldSelect` são importados pela rota.

## Global Constraints

**Repositório e worktree**
- Repo principal: `/Users/sunglee/PLM + Criação/plm-pcp`, branch `feature/plan-tecido-a1`. A F1 roda nele em paralelo (e a F2 pode começar), e o dono usa o app local de lá (vite em `:5173`).
- TODO o trabalho da F3.0 roda na worktree `/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f30-planejamento-detail`, branch `f30/planejamento-detail-refactor`, criada do HEAD de `feature/plan-tecido-a1` (Task 0). Caminhos relativos neste plano são relativos à raiz da worktree.
- `BASE` = commit de onde a worktree nasceu, gravado em `.superpowers/f30/BASE`. Nele, `git rev-parse BASE:src/components/planejamento/PlanejamentoDetail.tsx` = `6e435712f4c1d50b46312ca308fe79d938f8b83f` (2401 linhas). Todos os números de linha deste plano se referem a esse blob. Se o blob for outro, PARE.

**Zero mudança**
- Comportamento, UI (DOM), textos visíveis, queryKeys, RPCs, ordem das gravações e props públicas continuam iguais.
- Único código novo permitido: cabeçalho, imports e `export` dos módulos novos, a assinatura e a desestruturação de props/args, a chamada dos hooks/componentes no orquestrador, e um teste unitário novo (Task 3).

**API pública**
- `PlanejamentoDetail.tsx` continua exportando `PlanejamentoDetail` com as mesmas props: `{ modeloId, onClose, onSaved, contexto? }`.
- `FieldText` e `FieldSelect` são RE-exportados de lá. Quem importa: `src/routes/_authenticated/criacao.planejamento.tsx:60` (`PlanejamentoDetail, FieldText, FieldSelect`) e `src/components/produto-acabado/ProdutoAcabadoSheet.tsx:22` (`PlanejamentoDetail`).
- Esses dois arquivos não mudam.

**Arquivos intocáveis**
- Sem migrations e sem conexão com banco nenhum.
- Nada em `supabase/*`, `src/components/desenvolvimento/*` (decisão travada 8), `src/lib/*` (a F1 mexe em `src/lib/kanban-*`), `tests/integration/*` e `tests/fixtures/*`.
- Único arquivo novo fora de `src/components/planejamento/`: `tests/unit/planejamento-detail-helpers.test.ts`.

**Testes**
- Só `env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit`.
- `tests/integration/*` é PROIBIDO: abre conexão com `DATABASE_URL` ou `/tmp/dburl.txt`, que é o banco de PRODUÇÃO.

**Type-check**
- `npm run build` não faz type-check. Todo gate roda `npx tsc --noEmit` (0 erro).
- O gate também roda `npx tsc --noEmit --noUnusedLocals`, filtrado nos arquivos da F3.0, que tem de listar EXATAMENTE os 4 avisos herdados (Task 0).

**QA**
- O app local aponta para PRODUÇÃO. O QA não grava NENHUM dado de loja. Toda escrita é barrada ou simulada pela guarda de rede do spec (Task 9), em DUAS frentes:
  - o host do Supabase: escrita não prevista é barrada; as previstas ("Salvar", "Conflito", markup, preço fixo, "Criar produto acabado") recebem resposta simulada e não chegam ao banco;
  - a origem do app (`F30_A`/`F30_B`): qualquer requisição NÃO-GET, por exemplo uma server fn do TanStack Start em `/_serverFn/…` (roda no vite com service role; todas as do app são `method: "POST"`), é barrada e vira violação.
- Exceção inerente, sem dado de loja (decisão do controlador, registrada): cada login grava metadado de sessão no Auth do Supabase (`last_sign_in_at` e refresh token). São 4 logins no A/B (2 contextos por lado) e 2 no smoke pós-merge.
- `E2E_BASE_URL` é sempre explícito. O default do `playwright.config.ts` é PRODUÇÃO (`https://sistrama.sung-lee.workers.dev`).
- O robô NÃO troca de loja (decisão do dono): `selectStore` grava `users.tenant_id` em produção. Se o usuário de teste não estiver na "Loja Teste", o QA FALHA e para.

**Ordem com a F2 (G-plano R1)**
- Caminhos de `src/` que a F2 mexe (lista exata dos **Files** do plano `docs/superpowers/plans/2026-09-23-kanban-automatico-f2-telas.md`):
  - `src/lib/kanban-auto-ui.ts`, `src/lib/kanban-auto-config.ts`, `src/lib/kanban-auto-rpc.ts`;
  - `src/hooks/useKanbanConfig.ts`, `src/lib/erro-mensagem.ts`;
  - `src/components/shared/EtapaKanbanBadge.tsx`;
  - `src/components/admin/ModoColunaBadge.tsx`, `src/components/admin/RequisitosStatusDialog.tsx`, `src/components/admin/KanbanAutomaticoDialog.tsx`;
  - `src/routes/_authenticated/criacao.planejamento.tsx`, `src/routes/_authenticated/criacao.desenvolvimento.tsx`, `src/routes/_authenticated/admin/configuracoes.tsx`.
  
  Fora de `src/`, a F2 mexe em `tests/unit/*` e cria `tests/e2e/kanban-auto.spec.ts`. Nenhum desses caminhos colide com os 10 arquivos da F3.0.
- (a) **Preferência:** a F3.0 chega à Task 11 (merge) ANTES do 1º commit da F2 em `src/`.
- (b) Se a F2 já tiver commitado em `src/` antes do ff (detectado na Task 9 Step 1 ou na Task 11 Step 1), a sequência é:
  1. Task 11 Steps 2-3 (rebase + gates);
  2. reiniciar o lado B (Task 9 Step 7, só o B, e depois Task 9 Step 3);
  3. Task 9 Step 1 de novo (agora limpo), e Task 9 Steps 2-6;
  4. Task 10;
  5. Task 11 Step 1 (aviso ao dono) e Step 4.
- (c) Nenhuma alteração NÃO commitada da F2 no checkout principal enquanto o lado A é fotografado. A Task 9 Step 1 confere; se houver, PARE e espere o executor da F2 commitar.
- (d) O E2E da F2 (`tests/e2e/kanban-auto.spec.ts`) NUNCA roda junto com o QA da F3.0: é o mesmo usuário, o mesmo `:5173` e a presença Realtime. A Task 9 Step 1 e a Task 11 Step 5 conferem, e o controlador não despacha o E2E da F2 enquanto o QA da F3.0 roda.

**Processos**
- Nunca matar o vite do dono (`:5173`) nem processo que não foi você que subiu.
- O vite de QA da worktree roda em `:5199` e só ele é encerrado, pelo PID que escuta `:5199` e cujo `cwd` é a worktree.
- Vite A de reserva (só se o `:5173` estiver fora do ar): roda em `:5198`, no checkout principal. O PID é anotado ao subir, em `.superpowers/f30/vite-5198.pid` da worktree, e só esse PID é encerrado, se ainda escutar `:5198`. Como o `cwd` dele é o mesmo do vite do dono, o `cwd` não serve para distinguir os dois; o que distingue é a porta mais o PID anotado (Task 9 Steps 1 e 7).

**Commits**
- `git add -- <paths>` + `git commit --only -m "…" -- <paths>`. Nunca `git add .`.
- Toda mensagem termina com `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Sem push: fica para o orquestrador ou o dono.

**Arquivos gerados e de apoio**
- `src/routeTree.gen.ts` é gerado pelo build ou pelo vite. Nunca entra em commit; o `gates.sh` o restaura.
- `.env` copiado para a worktree é gitignored, nunca commitado, e some com a worktree.
- Arquivos de apoio (`.superpowers/f30/**`, o spec do QA) são descartáveis e nunca commitados. `.superpowers/` e `test-results/` são gitignored.

**Modelos e comunicação**
- Política do dono: Sonnet executa (Tasks 1–9), Opus revisa (Task 10).
- Avisos ao dono vão por CHAT, sem popup de plano (`ExitPlanMode` proibido).

**Estilo dos módulos novos**
- Componentes e hooks novos ficam SEMPRE no nível do MÓDULO. Declarar um componente dentro de outro remonta a cada render e o input perde o foco.
- Refs passam como OBJETO `ref`, nunca `ref.current`.

---

## 1. Fatos verificados (23/set/2026, só leitura)

**O arquivo e quem o importa**
- `PlanejamentoDetail.tsx` tem 2401 linhas, blob `6e435712…`. O último commit que o tocou é `5811cea`.
- Importadores (grep): `criacao.planejamento.tsx:60` e `ProdutoAcabadoSheet.tsx:22`.
- `invalidarAposAprovarMO` do detalhe NÃO é exportada; a rota tem cópia própria em `criacao.planejamento.tsx:119`.

**Mapa do arquivo no BASE (linhas)**

| Linhas | Conteúdo |
|---|---|
| 1-10 | cabeçalho |
| 11-74 | imports |
| 76-123 | `syncTecidosToDesenvolvimento` |
| 125-142 | `ROTULO_CONFLITO_PLAN` + `rotuloConflitoPlan` |
| 144-155 | `limparCustoSim` |
| 157-178 | `Secao` |
| 180-188 | `CampoRO` |
| 190-380 | `mkFmt` + `PrecoTabela` |
| 382-383 | `EstoqueArtigo` / `fmtMetros` |
| 385-447 | `MultiArtigosField` |
| 450-481 | `FieldText` / `FieldSelect` (já `export`) |
| 482-499 | `PhotoList` |
| 500-505 | `FileThumb` |
| 507-528 | `SingleFileField` |
| 532-2382 | `PlanejamentoDetail` |
| 2384-2401 | `invalidarAposAprovarMO` |

**Dentro do `PlanejamentoDetail`**

| Linhas | Conteúdo |
|---|---|
| 574-588 | estado/refs da grade revenda |
| 589 | `useDirtySnapshot` |
| 590-595 | `dirty` combinado + `useUnsavedGuard` |
| 834-853 | base de preço da revenda + `piRevenda` |
| 855-979 | produto vinculado, markups, preços fixos, 2 mutations, grupo/acessório |
| 980-990 | `tenantIdAtivo` + query `markupFaixaOn` |
| 991-1053 | tamanhos, variantes, grade (query + seed), totais, `buildLinhasGradeRevenda` |
| 1055-1103 | `criarProdutoAcabado` |
| 1137 | seed de MO |
| 1196 | merge do colab |
| 1278-1577 | `save` |
| 1579-1583 | `handleSave` |
| 1783-1868 | seção 1 "Informações Gerais do Produto" |
| 1951-2041 | preço revenda |
| 2082-2109 | seção Produto Acabado |
| 2116-2166 | seção Grade |

**Ordem dos effects hoje**
- O 1º `useEffect` do componente é o seed da grade revenda (:1026), que lê `revRef.current`.
- Depois vêm o seed de MO (:1137) e o merge do colab (:1196), que é o que atualiza `revRef`.
- Essa ordem relativa tem de ser mantida.

**Tipos (React 19.2.17)**
- `useRef<T>(v)` devolve `RefObject<T>` com `current` mutável.
- `useActiveTenantId()` devolve `string`.
- `precoInfo` devolve `PrecoInfo`, exportado de `@/lib/preco`.

**Gates no BASE**
- `npx tsc --noEmit` → 0 erro.
- `npx tsc --noEmit --noUnusedLocals`, no `PlanejamentoDetail.tsx`, dá 4 avisos HERDADOS: `'useGridCols'` (import :52), `'podeEditarCustos'` (:220, dentro de `PrecoTabela`), `'markup'` e `'preco'` (:753). Ficam como estão.
- `tests/unit` (medido em `a8471b1`): 56 arquivos, 751 testes, **2 falham e são herdados**. Ambos são do `ui-padroes-antidrift.test.ts`: (a) cor literal e (e) fonte fracionária, em `DocPrintCasca.tsx`/`OcDocumentoPrint.tsx`, fora do escopo. A Task 0 mede de novo no BASE real.

**App local e QA**
- O vite do dono escuta `[::1]:5173` (PID 70079 visto em 23/set; não tocar) e serve o checkout PRINCIPAL, ou seja, o código ANTES.
- Deep-link `/criacao/planejamento?modelo=<id>` abre o card (`criacao.planejamento.tsx:71-72,160`).
- A query da lista começa com `select=id,nome,ref,ref_auto,` (:361) e traz `origem`.

**Gravações do Salvar hoje**
- `PATCH modelos?id=eq.X&rev=eq.N&select=id`, com 0 linhas = P0409 sintético.
- Sync de tecidos: GET `modelo_tecidos`, depois POST/PATCH/DELETE `modelo_tecidos` e `modelo_tecido_variantes`.
- `rpc/salvar_grade_revenda`, `rpc/salvar_modelo_servico_mo`, e para revenda sem produto: `rpc/salvar_produto_acabado` + `PATCH produtos_acabados`.
- No novo: `POST modelos` (`.single()`).

**RPCs de leitura liberadas no QA**
- Conferidas na migration mais recente de cada uma, sem INSERT/UPDATE/DELETE: `custo_unitario_modelos`, `modelo_mo_resumo`, `estoque_tecido_por_artigo`, `otb_orcamento`, `sidebar_badges`, `minhas_permissoes_efetivas`, `get_user_tenant_id`, `meu_tenant_ativo`, `modelos_mo_a_aprovar_count`.

**Gitignore**
- Estão ignorados: `.claude/worktrees/`, `.superpowers/`, `test-results/`, `playwright-report/`, `node_modules`, `dist`, `.wrangler/`, `.env`, `logs`, `*.log`.
- `src/routeTree.gen.ts` é versionado e gerado.

## 2. Estrutura de arquivos (de → para)

Todos os arquivos novos ficam em `src/components/planejamento/planejamento-detail/`. As linhas de origem são do BASE; os tamanhos são aproximados.

| Arquivo | Responsabilidade | Sai de (linhas do BASE) | ~linhas | Task |
|---|---|---|---|---|
| `campos.tsx` | Blocos de UI sem estado de negócio: `Secao`, `CampoRO`, `EstoqueArtigo`, `MultiArtigosField`, `FieldText`, `FieldSelect`, `PhotoList`, `FileThumb` (privado), `SingleFileField` | 157-188, 382-528 | 195 | 1 |
| `PrecoTabela.tsx` | Tabela da seção Preço (manufaturado), só props | 190-380 | 200 | 2 |
| `helpers.ts` | Puros: rótulos de conflito (`rotuloConflitoPlan`), `limparCustoSim`, `invalidarAposAprovarMO` | 125-142, 144-155, 2384-2401 | 60 | 3 |
| `sync-tecidos.ts` | `syncTecidosToDesenvolvimento` (a F3.2 apaga) | 76-123 | 55 | 4 |
| `InfoGeraisSecao.tsx` | Seção 1 "Informações Gerais do Produto" | 1783-1868 | 115 | 5 |
| `useRevendaPlanejamento.ts` | Estado/queries/mutations da revenda: produto vinculado, markups, preços fixos, grade, criar produto | 574-588, 593, 855-979, 991-1053, 1055-1103 | 300 | 6 |
| `RevendaSetores.tsx` | JSX da revenda: `PrecoRevendaBloco`, `ProdutoAcabadoSecao`, `GradeRevendaSecao` | 1951-2041, 2082-2109, 2116-2166 | 220 | 7 |
| `usePlanejamentoSave.ts` | Mutation `save` (+ retry/merge P0409) e `handleSave` | 1278-1577, 1579-1583 | 370 | 8 |
| `PlanejamentoDetail.tsx` (fica) | Orquestrador: draft, colab, queries do card, cálculo de preço, MO, lançamento, enviar, duplicar, excluir, container Sheet/Dialog, rodapé | o resto | ~1160 | 1–8 |
| `tests/unit/planejamento-detail-helpers.test.ts` (novo) | Trava o comportamento dos helpers (rótulos, limpeza da simulação, as 7 queryKeys de `invalidarAposAprovarMO`) | — | 55 | 3 |

**Por que estas fronteiras, olhando a F3.1–F3.4 do plano da campanha**

- **F3.1 — campos simples + Descrição.** O campo "Descrição do produto" entra no fim da seção 1, em `InfoGeraisSecao.tsx`. Os rótulos de conflito dos campos novos entram em `helpers.ts` (`ROTULO_CONFLITO_PLAN`). As seções novas (`DevEquipeSection`, Ajustes na Prova, Anexos + Ficha de Medida + Obs.) entram como linhas no orquestrador, que fica curto e legível. O fix "card novo → após salvar abre o Sheet com o id novo" é no `onSuccess` de `usePlanejamentoSave.ts`.
- **F3.2 — BOM.** A cadeia de gravação (UPDATE → `salvar_modelo_bom` → etiquetas → MO → `marcar_revisao_por_mudanca`) é reescrita só em `usePlanejamentoSave.ts`. `sync-tecidos.ts` é apagado inteiro. `MultiArtigosField` sai do Sheet, mas o Dialog "Novo Modelo" continua com o seletor (exceção G-mockup R3), por isso fica em `campos.tsx`.
- **F3.3 — CAD + ações + menu ⋯.** O rodapé fica no orquestrador DE PROPÓSITO: ele será redesenhado, e extraí-lo agora seria mexer duas vezes.
- **F3.4 — comprado / grade única.** A mudança fica em `useRevendaPlanejamento.ts` + `RevendaSetores.tsx`.
- **Decisões 2 e 6 (custos/markup).** A mudança fica em `PrecoTabela.tsx`.

## 3. Ferramentas de prova (criadas na Task 0, dentro da worktree, não versionadas)

| Ferramenta | O que faz |
|---|---|
| `.superpowers/f30/BASE` | sha do commit-base |
| `.superpowers/f30/anchor.txt` | linha-âncora onde os imports novos do orquestrador são inseridos (o comentário da re-exportação) |
| `.superpowers/f30/base.sh <a> <b>` | imprime as linhas a..b do `PlanejamentoDetail.tsx` no BASE; é a ÚNICA fonte do texto movido |
| `node .superpowers/f30/troca.mjs <arquivo> <texto-antigo.txt> [texto-novo.txt]` | troca o texto EXATO (tem de aparecer 1×) pelo novo, ou por nada |
| `.superpowers/f30/confere.sh <REF> <dirTarefa>` | prova de "texto movido" (multiconjunto de linhas, sem indentação e sem vazias) de `PlanejamentoDetail.tsx` + `planejamento-detail/**` em `<REF>` × árvore de trabalho; exige que só mudem as linhas de `<dirTarefa>/del/*` (saem) e `<dirTarefa>/add/*` (entram) |
| `.superpowers/f30/gates.sh <tN> <testesNovos> <unusedEsperado>` | build, `tsc` (0 erro), `tsc --noUnusedLocals` = esperado, `tests/unit` (mesmas falhas herdadas; passados = base + novos) |

Pasta de cada tarefa: `.superpowers/f30/tN/{add,del,mov,partes}`.
- `mov/`: texto movido, só para a troca; não entra na prova.
- `add/`: linhas NOVAS.
- `del/`: linhas que SAEM sem reaparecer.
- `partes/`: pedaços reaproveitados por outras tarefas, que não entram na prova.

---

### Task 0: Worktree isolada, ferramentas de prova e linha de base

**Files:**
- Já commitado, NÃO commitar de novo: `docs/superpowers/plans/2026-09-23-planejamento-unificado-f30-refactor.md` (este plano). O controlador o commitou na `feature/plan-tecido-a1` ao fechar o G-plano (decisão 6 da §5). A Task 0 só confere.
- Create (fora do git): a worktree `.claude/worktrees/f30-planejamento-detail/`, e dentro dela `.env` (cópia), `.superpowers/f30/{BASE,anchor.txt,base.sh,troca.mjs,confere.sh,gates.sh,baseline.txt,unit-fail-t0.txt,unused-esperado-A.txt,unused-esperado-B.txt}`.

**Interfaces:**
- Consumes: nada.
- Produces:
  - `WT="/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f30-planejamento-detail"`; branch `f30/planejamento-detail-refactor`.
  - As ferramentas da §3.
  - `baseline.txt` com `N_FAIL` e `N_PASS`.
  - `unused-esperado-A.txt` (Task 1) e `unused-esperado-B.txt` (Tasks 2–8).

- [ ] **Step 1: Pré-voo no checkout principal (só leitura)**

```bash
MAIN="/Users/sunglee/PLM + Criação/plm-pcp"
git -C "$MAIN" branch --show-current
git -C "$MAIN" status --porcelain -- src/components/planejamento src/routes/_authenticated/criacao.planejamento.tsx src/components/produto-acabado/ProdutoAcabadoSheet.tsx
git -C "$MAIN" rev-parse HEAD:src/components/planejamento/PlanejamentoDetail.tsx
ls "$MAIN/.git/index.lock" 2>/dev/null; echo "lock-check-fim"
```

Esperado:
- `feature/plan-tecido-a1`.
- `status` vazio.
- O blob é `6e435712f4c1d50b46312ca308fe79d938f8b83f`.
- Nenhum `index.lock`, só `lock-check-fim`.

Se o blob for outro, PARE: os números de linha do plano não valem mais. Se houver `index.lock`, a F1 está commitando: espere o executor da F1 terminar e repita. NUNCA apague o lock.

- [ ] **Step 2: Conferir que ESTE plano já está commitado na branch principal (não commitar de novo)**

```bash
MAIN="/Users/sunglee/PLM + Criação/plm-pcp"
P=docs/superpowers/plans/2026-09-23-planejamento-unificado-f30-refactor.md
git -C "$MAIN" status --porcelain -- "$P"
git -C "$MAIN" log -1 --format='%h %s' -- "$P"
git -C "$MAIN" merge-base --is-ancestor "$(git -C "$MAIN" log -1 --format=%H -- "$P")" feature/plan-tecido-a1 && echo "plano na feature/plan-tecido-a1: ok"
```

Esperado:
- `status` vazio.
- O `log` mostra `docs(plano): F3.0 refatoração do PlanejamentoDetail (G-plano: R1–R6 + decisões)`, ou um commit de doc posterior deste mesmo arquivo.
- `plano na feature/plan-tecido-a1: ok`.

Se o `status` mostrar o plano modificado ou não versionado, PARE e avise o orquestrador. A Task 0 não commita o plano. Assim a worktree nasce (Step 3) de um HEAD que já contém a versão aprovada.

- [ ] **Step 3: Criar a worktree**

Usa `git worktree` e não o `EnterWorktree` nativo. Motivo: o caminho tem de ser FIXO e compartilhado por vários subagentes e pelo vite de QA, e o `EnterWorktree` só muda a sessão que o chama.

```bash
MAIN="/Users/sunglee/PLM + Criação/plm-pcp"
WT="$MAIN/.claude/worktrees/f30-planejamento-detail"
git -C "$MAIN" check-ignore -q .claude/worktrees/qualquer && echo "pasta de worktrees ignorada: ok"
BASE=$(git -C "$MAIN" rev-parse feature/plan-tecido-a1)
git -C "$MAIN" worktree add "$WT" -b f30/planejamento-detail-refactor "$BASE"
git -C "$WT" branch --show-current
git -C "$WT" rev-parse HEAD:src/components/planejamento/PlanejamentoDetail.tsx
```

Esperado:
- `pasta de worktrees ignorada: ok`.
- `f30/planejamento-detail-refactor`.
- `6e435712f4c1d50b46312ca308fe79d938f8b83f`.

- [ ] **Step 4: Setup do projeto na worktree**

```bash
WT="/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f30-planejamento-detail"
cp "/Users/sunglee/PLM + Criação/plm-pcp/.env" "$WT/.env"
git -C "$WT" check-ignore -q .env && echo ".env ignorado: ok"
cd "$WT" && npm ci
```

Esperado: `.env ignorado: ok` e o `npm ci` termina sem erro.

- [ ] **Step 5: Criar as ferramentas de prova**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f30-planejamento-detail"
mkdir -p .superpowers/f30/logs
git check-ignore -q .superpowers/f30/x && echo ".superpowers ignorado: ok"
git rev-parse HEAD > .superpowers/f30/BASE
printf '%s\n' '// API pública mantida: a rota `criacao.planejamento.tsx` importa FieldText/FieldSelect DAQUI.' > .superpowers/f30/anchor.txt

cat > .superpowers/f30/base.sh <<'EOF'
#!/usr/bin/env bash
# uso: .superpowers/f30/base.sh <a> <b> — imprime as linhas a..b do PlanejamentoDetail.tsx no commit BASE.
# É a ÚNICA fonte do texto movido da F3.0 (nunca redigitar código).
set -euo pipefail
git show "$(cat .superpowers/f30/BASE):src/components/planejamento/PlanejamentoDetail.tsx" | sed -n "${1},${2}p"
EOF

cat > .superpowers/f30/troca.mjs <<'EOF'
// uso: node .superpowers/f30/troca.mjs <arquivo> <texto-antigo.txt> [texto-novo.txt]
// Troca o texto EXATO de <texto-antigo.txt> — que tem de aparecer EXATAMENTE 1 vez em <arquivo> —
// pelo de <texto-novo.txt> (ou por nada). Garante que só sai do arquivo o texto que a tarefa previu.
import { readFileSync, writeFileSync } from "node:fs";
const [alvo, antigoArq, novoArq] = process.argv.slice(2);
if (!alvo || !antigoArq) { console.error("uso: troca.mjs <arquivo> <antigo> [novo]"); process.exit(2); }
const atual = readFileSync(alvo, "utf8");
const antigo = readFileSync(antigoArq, "utf8");
if (antigo.length === 0) { console.error(`ERRO: ${antigoArq} está vazio`); process.exit(1); }
const n = atual.split(antigo).length - 1;
if (n !== 1) { console.error(`ERRO: ${antigoArq} aparece ${n}x em ${alvo} (esperado 1)`); process.exit(1); }
const novo = novoArq ? readFileSync(novoArq, "utf8") : "";
writeFileSync(alvo, atual.replace(antigo, () => novo));
console.log(`ok: ${antigoArq} -> ${novoArq ?? "(removido)"}`);
EOF

cat > .superpowers/f30/confere.sh <<'EOF'
#!/usr/bin/env bash
# uso: .superpowers/f30/confere.sh <REF> <dirTarefa>
# PROVA DE "TEXTO MOVIDO". Multiconjunto de linhas (sem indentação, sem linhas vazias) de
# PlanejamentoDetail.tsx + planejamento-detail/** em <REF> × árvore de trabalho. A diferença tem de
# ser EXATAMENTE a prevista: linhas de <dirTarefa>/del/* saem, linhas de <dirTarefa>/add/* entram.
# Todo o resto (o código movido) está dos dois lados. Usa comm (diferença exata de multiconjunto).
set -uo pipefail
REF="$1"; T="$2"
F=src/components/planejamento/PlanejamentoDetail.tsx
D=src/components/planejamento/planejamento-detail
W=.superpowers/f30/.confere; mkdir -p "$W"
norm() { sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' | grep -v '^$' | LC_ALL=C sort; }
antes() {
  git show "$REF:$F"; echo
  git ls-tree -r --name-only "$REF" -- "$D" | LC_ALL=C sort | while IFS= read -r p; do git show "$REF:$p"; echo; done
}
depois() {
  cat "$F"; echo
  if [ -d "$D" ]; then find "$D" -type f \( -name '*.ts' -o -name '*.tsx' \) | LC_ALL=C sort | while IFS= read -r p; do cat "$p"; echo; done; fi
}
junta() { if [ -d "$1" ]; then find "$1" -type f | LC_ALL=C sort | while IFS= read -r p; do cat "$p"; echo; done; fi; }
antes | norm > "$W/antes"; depois | norm > "$W/depois"
junta "$T/del" | norm > "$W/del"; junta "$T/add" | norm > "$W/add"
LC_ALL=C comm -23 "$W/antes" "$W/depois" > "$W/real-saiu"
LC_ALL=C comm -13 "$W/antes" "$W/depois" > "$W/real-entrou"
LC_ALL=C comm -23 "$W/del" "$W/add" > "$W/esp-saiu"
LC_ALL=C comm -13 "$W/del" "$W/add" > "$W/esp-entrou"
ok=1
if ! cmp -s "$W/esp-saiu" "$W/real-saiu"; then ok=0
  echo "DIVERGE nas linhas que SAÍRAM ('<' previsto e não saiu · '>' saiu sem estar previsto):"; diff "$W/esp-saiu" "$W/real-saiu"; fi
if ! cmp -s "$W/esp-entrou" "$W/real-entrou"; then ok=0
  echo "DIVERGE nas linhas que ENTRARAM ('<' previsto e não entrou · '>' entrou sem estar previsto):"; diff "$W/esp-entrou" "$W/real-entrou"; fi
if [ "$ok" = 1 ]; then
  echo "EQUIVALENTE — saíram $(wc -l < "$W/real-saiu" | tr -d ' ') e entraram $(wc -l < "$W/real-entrou" | tr -d ' ') linha(s), todas previstas em $T/{del,add}; o resto é texto movido."
  exit 0
fi
exit 1
EOF

cat > .superpowers/f30/gates.sh <<'EOF'
#!/usr/bin/env bash
# uso: .superpowers/f30/gates.sh <tN> <testesNovos> <arquivo-unused-esperado>
# Gates de não-regressão da F3.0: build + tsc (0 erro) + locais/imports sem uso = esperado +
# tests/unit (mesmo conjunto de falhas herdadas; passados = base + testesNovos).
# NUNCA roda tests/integration (conectam no banco de PRODUÇÃO via /tmp/dburl.txt).
set -uo pipefail
T="$1"; NOVOS="$2"; UNUSED_ESP="$3"
source .superpowers/f30/baseline.txt   # define N_FAIL e N_PASS
L=.superpowers/f30/logs; mkdir -p "$L"
npm run build > "$L/build-$T.log" 2>&1 || { echo "FALHA build — ver $L/build-$T.log"; tail -20 "$L/build-$T.log"; exit 1; }
git checkout -- src/routeTree.gen.ts 2>/dev/null || true   # arquivo gerado: nunca entra no commit
npx tsc --noEmit > "$L/tsc-$T.log" 2>&1 || { echo "FALHA tsc:"; grep "error TS" "$L/tsc-$T.log" | head -30; exit 1; }
npx tsc --noEmit --noUnusedLocals 2>&1 \
  | grep -E "components/planejamento/(PlanejamentoDetail\.tsx|planejamento-detail/)" \
  | sed -E 's/\([0-9]+,[0-9]+\)//' | LC_ALL=C sort > "$L/unused-$T.txt"
cmp -s "$UNUSED_ESP" "$L/unused-$T.txt" || { echo "FALHA sem-uso ('<' esperado · '>' real):"; diff "$UNUSED_ESP" "$L/unused-$T.txt"; exit 1; }
env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit > "$L/unit-$T.log" 2>&1
grep -E "^ FAIL " "$L/unit-$T.log" | LC_ALL=C sort -u > "$L/unit-fail-$T.txt"
cmp -s .superpowers/f30/unit-fail-t0.txt "$L/unit-fail-$T.txt" || { echo "FALHA — o conjunto de testes que falham mudou:"; diff .superpowers/f30/unit-fail-t0.txt "$L/unit-fail-$T.txt"; exit 1; }
ESP_PASS=$((N_PASS + NOVOS))
if [ "$N_FAIL" = "0" ]; then PADRAO="Tests +${ESP_PASS} passed"; else PADRAO="Tests +${N_FAIL} failed \| ${ESP_PASS} passed"; fi
grep -qE "$PADRAO" "$L/unit-$T.log" || { echo "FALHA contagem (esperado /$PADRAO/):"; grep -E "Tests " "$L/unit-$T.log"; exit 1; }
echo "GATES OK ($T): build ok · tsc 0 erro · sem-uso = esperado · unit: ${N_FAIL} falha(s) herdada(s), ${ESP_PASS} passaram"
EOF

cat > .superpowers/f30/unused-esperado-A.txt <<'EOF'
src/components/planejamento/PlanejamentoDetail.tsx: error TS6133: 'markup' is declared but its value is never read.
src/components/planejamento/PlanejamentoDetail.tsx: error TS6133: 'podeEditarCustos' is declared but its value is never read.
src/components/planejamento/PlanejamentoDetail.tsx: error TS6133: 'preco' is declared but its value is never read.
src/components/planejamento/PlanejamentoDetail.tsx: error TS6133: 'useGridCols' is declared but its value is never read.
EOF
cat > .superpowers/f30/unused-esperado-B.txt <<'EOF'
src/components/planejamento/PlanejamentoDetail.tsx: error TS6133: 'markup' is declared but its value is never read.
src/components/planejamento/PlanejamentoDetail.tsx: error TS6133: 'preco' is declared but its value is never read.
src/components/planejamento/PlanejamentoDetail.tsx: error TS6133: 'useGridCols' is declared but its value is never read.
src/components/planejamento/planejamento-detail/PrecoTabela.tsx: error TS6133: 'podeEditarCustos' is declared but its value is never read.
EOF
chmod +x .superpowers/f30/base.sh .superpowers/f30/confere.sh .superpowers/f30/gates.sh
```

Esperado: `.superpowers ignorado: ok`.

- [ ] **Step 6: Autoteste das ferramentas (arquivos próprios, apagados em seguida)**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f30-planejamento-detail"
.superpowers/f30/base.sh 532 532
.superpowers/f30/confere.sh HEAD .superpowers/f30/sem-tarefa
printf 'a\nb\nc\n' > .superpowers/f30/autoteste-x.txt; printf 'b\n' > .superpowers/f30/autoteste-old.txt
node .superpowers/f30/troca.mjs .superpowers/f30/autoteste-x.txt .superpowers/f30/autoteste-old.txt
cat .superpowers/f30/autoteste-x.txt
node .superpowers/f30/troca.mjs .superpowers/f30/autoteste-x.txt .superpowers/f30/autoteste-old.txt; echo "exit=$?"
rm -- .superpowers/f30/autoteste-x.txt .superpowers/f30/autoteste-old.txt
```

Esperado, na ordem:
- `export function PlanejamentoDetail({`.
- `EQUIVALENTE — saíram 0 e entraram 0 linha(s)…`.
- `ok: …autoteste-old.txt -> (removido)`.
- `a` e `c`.
- `ERRO: … aparece 0x … (esperado 1)` e `exit=1`.

- [ ] **Step 7: Linha de base dos gates**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f30-planejamento-detail"
env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit > .superpowers/f30/logs/unit-t0-base.log 2>&1
LINHA=$(grep -E "Tests " .superpowers/f30/logs/unit-t0-base.log); echo "$LINHA"
N_FAIL=$(printf '%s' "$LINHA" | sed -nE 's/.* ([0-9]+) failed.*/\1/p'); N_FAIL=${N_FAIL:-0}
N_PASS=$(printf '%s' "$LINHA" | sed -nE 's/.* ([0-9]+) passed.*/\1/p')
printf 'N_FAIL=%s\nN_PASS=%s\n' "$N_FAIL" "$N_PASS" > .superpowers/f30/baseline.txt
grep -E "^ FAIL " .superpowers/f30/logs/unit-t0-base.log | LC_ALL=C sort -u > .superpowers/f30/unit-fail-t0.txt
cat .superpowers/f30/baseline.txt; cat .superpowers/f30/unit-fail-t0.txt
.superpowers/f30/gates.sh t0 0 .superpowers/f30/unused-esperado-A.txt
git status --porcelain
```

Esperado:
- `baseline.txt` com `N_FAIL=2` e `N_PASS=749`. O N_PASS pode ser maior se a F1 tiver somado testes unitários antes do BASE; vale o medido.
- `unit-fail-t0.txt` com só linhas de `tests/unit/ui-padroes-antidrift.test.ts` (a) e (e). Se houver falha em qualquer outro arquivo, PARE e avise o orquestrador.
- `GATES OK (t0)`.
- `git status --porcelain` vazio.

---

### Task 1: `campos.tsx` — blocos de UI sem estado de negócio

**Files:**
- Create: `src/components/planejamento/planejamento-detail/campos.tsx`.
- Modify: `src/components/planejamento/PlanejamentoDetail.tsx`:
  - remove as linhas do BASE 157-189 e 382-529;
  - troca o import :14 (lucide), o bloco :21-25 (ui) e o bloco :69-74 (modelo-shared);
  - acrescenta o import de `campos` e a re-exportação.

**Interfaces:**
- Consumes: Task 0 (`base.sh`, `troca.mjs`, `confere.sh`, `gates.sh`, `anchor.txt`).
- Produces: `campos.tsx` exporta:
  - `Secao({ titulo: string; children: React.ReactNode; defaultOpen?: boolean })`
  - `CampoRO({ label: string; value: string })`
  - `type EstoqueArtigo = { fisico_m: number; reservado_m: number; disponivel_m: number }`
  - `MultiArtigosField({ label, value: string[], onChange: (v: string[]) => void, artigos: ArtigoOpt[], estoque: Record<string, EstoqueArtigo> })`
  - `FieldText({ label, value, onChange, colabPath? })`
  - `FieldSelect({ label, value: string | null, onChange, options: Opt[] })`
  - `PhotoList({ label, paths, onAdd, onRemove })`
  - `SingleFileField({ label, path, onUpload, onRemove })`

  `FileThumb` fica privado. `PlanejamentoDetail.tsx` passa a ter a linha-âncora (`anchor.txt`) seguida de `export { FieldText, FieldSelect } from "@/components/planejamento/planejamento-detail/campos";`.

*TDD:* é só movimento de componentes de apresentação, e o Vitest do repo roda em `node`, sem DOM. A prova é o `confere.sh` (texto idêntico) mais os gates; o comportamento é provado no QA A/B (Task 9).

- [ ] **Step 1: Partes novas da tarefa (cabeçalho, `export`, imports)**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f30-planejamento-detail"
T=.superpowers/f30/t1; mkdir -p "$T/add" "$T/del" "$T/mov"
b() { .superpowers/f30/base.sh "$@"; }
cat > "$T/add/01-cabecalho.txt" <<'EOF'
// Campos e blocos de UI do detalhe do Planejamento de Produto (Sheet/Dialog). Extraídos na F3.0
// (set/2026) de `PlanejamentoDetail.tsx` SEM mudança de comportamento: o texto abaixo foi MOVIDO
// como estava (só ganhou `export`). `FieldText`/`FieldSelect` seguem re-exportados por
// `PlanejamentoDetail.tsx` — é de lá que a rota `criacao.planejamento.tsx` os importa.
import { useState } from "react";
import { Trash2, Upload, ChevronDown, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { AnexoThumbZoom } from "@/components/shared/ImagePreview";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { brl, fmtNum } from "@/lib/format";
import { useSignedUrlBucket, type Opt, type ArtigoOpt } from "@/components/planejamento/modelo-shared";

EOF
for n in 160 181 382 385 482 508; do b "$n" "$n"; done > "$T/del/02-exports.txt"
sed -E -e 's/^function (Secao|CampoRO|MultiArtigosField|PhotoList|SingleFileField)\(/export function \1(/' \
       -e 's/^type EstoqueArtigo = /export type EstoqueArtigo = /' "$T/del/02-exports.txt" > "$T/add/02-exports.txt"
cat "$T/add/02-exports.txt"
b 14 14 > "$T/del/03-lucide.txt"
printf '%s\n' 'import { Trash2, Copy, ArrowLeft, Save, ExternalLink, PackagePlus } from "lucide-react";' > "$T/add/03-lucide.txt"
b 21 25 > "$T/del/04-ui.txt"
{ b 22 22; b 24 24; } > "$T/add/04-ui.txt"
b 69 74 > "$T/del/05-shared.txt"
cat > "$T/add/05-shared.txt" <<'EOF'
import {
  uploadFile,
  numOr0, STATUS_OPTS,
  emptyDraft, draftFromModeloRow,
  type ArtigoOpt, type SubOpt, type Draft,
} from "@/components/planejamento/modelo-shared";
import {
  Secao, CampoRO, MultiArtigosField, FieldText, FieldSelect, PhotoList, SingleFileField,
  type EstoqueArtigo,
} from "@/components/planejamento/planejamento-detail/campos";
EOF
cat .superpowers/f30/anchor.txt >> "$T/add/05-shared.txt"
printf '%s\n' 'export { FieldText, FieldSelect } from "@/components/planejamento/planejamento-detail/campos";' >> "$T/add/05-shared.txt"
cat "$T/del/04-ui.txt" "$T/add/04-ui.txt"
```

Esperado:
- `add/02-exports.txt` tem 6 linhas, todas começando com `export ` (5× `export function …(`, 1× `export type EstoqueArtigo = …`).
- `del/04-ui.txt` tem 5 imports (Input, Label, Badge, StatusBadge, AnexoThumbZoom).
- `add/04-ui.txt` tem 2 (Label, StatusBadge).

- [ ] **Step 2: Montar `campos.tsx` com o texto do BASE**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f30-planejamento-detail"
T=.superpowers/f30/t1; D=src/components/planejamento/planejamento-detail
b() { .superpowers/f30/base.sh "$@"; }
mkdir -p "$D"
{ cat "$T/add/01-cabecalho.txt"; b 157 188; echo; b 382 528; } > "$D/campos.tsx"
sed -i '' -E -e 's/^function (Secao|CampoRO|MultiArtigosField|PhotoList|SingleFileField)\(/export function \1(/' \
             -e 's/^type EstoqueArtigo = /export type EstoqueArtigo = /' "$D/campos.tsx"
grep -c '^export ' "$D/campos.tsx"
grep -n '^function ' "$D/campos.tsx"
```

Esperado: `8`, e uma só linha `function FileThumb({ path, onRemove }: { path: string; onRemove?: () => void }) {`.

- [ ] **Step 3: Tirar o texto movido do orquestrador e trocar os imports**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f30-planejamento-detail"
T=.superpowers/f30/t1; F=src/components/planejamento/PlanejamentoDetail.tsx
b() { .superpowers/f30/base.sh "$@"; }; troca() { node .superpowers/f30/troca.mjs "$@"; }
b 157 189 > "$T/mov/01-secao-camporo.txt"
b 382 529 > "$T/mov/02-campos.txt"
troca "$F" "$T/mov/01-secao-camporo.txt"
troca "$F" "$T/mov/02-campos.txt"
troca "$F" "$T/del/03-lucide.txt" "$T/add/03-lucide.txt"
troca "$F" "$T/del/04-ui.txt" "$T/add/04-ui.txt"
troca "$F" "$T/del/05-shared.txt" "$T/add/05-shared.txt"
grep -n '^export' "$F"
```

Esperado:
- 5 linhas `ok: …`.
- `export { FieldText, FieldSelect } from "@/components/planejamento/planejamento-detail/campos";` e `export function PlanejamentoDetail({`, nessa ordem.

- [ ] **Step 4: Prova de equivalência**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f30-planejamento-detail"
.superpowers/f30/confere.sh HEAD .superpowers/f30/t1
grep -c "queryKey" .superpowers/f30/t1/add/* ; git status --porcelain -- src/components/desenvolvimento src/lib supabase tests src/routes
```

Esperado:
- `EQUIVALENTE — …`.
- Todos os arquivos de `add/` com contagem `0` de `queryKey`.
- `status` vazio.

- [ ] **Step 5: Gates**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f30-planejamento-detail"
.superpowers/f30/gates.sh t1 0 .superpowers/f30/unused-esperado-A.txt
```

Esperado: `GATES OK (t1)`.

- [ ] **Step 6: Commit**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f30-planejamento-detail"
git status --porcelain
git add -- src/components/planejamento/planejamento-detail/campos.tsx src/components/planejamento/PlanejamentoDetail.tsx
git commit --only -m "$(cat <<'EOF'
refactor(planejamento): F3.0 (1/8) — campos do detalhe em planejamento-detail/campos.tsx

Secao, CampoRO, MultiArtigosField, FieldText, FieldSelect, PhotoList, FileThumb e SingleFileField
movidos de PlanejamentoDetail.tsx sem mudança (texto do commit-base; prova confere.sh). FieldText/
FieldSelect continuam re-exportados pelo PlanejamentoDetail (API pública da rota intacta).

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)" -- src/components/planejamento/planejamento-detail/campos.tsx src/components/planejamento/PlanejamentoDetail.tsx
```

Esperado: o `status` antes do commit lista só ` M src/components/planejamento/PlanejamentoDetail.tsx` e `?? src/components/planejamento/planejamento-detail/`. O commit tem 2 arquivos.

---

### Task 2: `PrecoTabela.tsx` — tabela da seção Preço (manufaturado)

**Files:**
- Create: `src/components/planejamento/planejamento-detail/PrecoTabela.tsx`.
- Modify: `PlanejamentoDetail.tsx`:
  - remove as linhas do BASE 190-381;
  - remove o import `StatusBadge` (BASE :24);
  - troca `import { brl, fmtNum }` (BASE :54) por `import { brl }`;
  - acrescenta o import de `PrecoTabela` antes da âncora.

**Interfaces:**
- Consumes: Task 0 (ferramentas, âncora criada na Task 1).
- Produces: `export function PrecoTabela(props: { markupReal; precoSug; precoBase; precoDigitado; draftPrecoVenda; onPrecoVenda; custoReal; consumo; consumoRealBOM; precoTecidoM; tecidoEstimado; aviamento; maoObraDev; custoEstimado; onConsumo; onAviamento; materiaisReal; custoRealTotal; custoPrevisto; linhaFaixas; moMin; moIdeal; moMax; moStatusFaixa; podeVerCustos; podeEditarCustos; podeEditarPreco; markupFaixaOn; onVerDev? })`. Os tipos ficam idênticos às linhas 194-216 do BASE.

- [ ] **Step 1: Partes novas**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f30-planejamento-detail"
T=.superpowers/f30/t2; mkdir -p "$T/add" "$T/del" "$T/mov"
b() { .superpowers/f30/base.sh "$@"; }
cat > "$T/add/01-cabecalho.txt" <<'EOF'
// Tabela da seção "Preço" do detalhe do Planejamento (card manufaturado). Extraída na F3.0
// (set/2026) de `PlanejamentoDetail.tsx` SEM mudança de comportamento: texto MOVIDO como estava
// (só ganhou `export`). Só props — nenhum estado, query ou chamada ao banco aqui.
import { StatusBadge } from "@/components/shared/StatusBadge";
import { NumberInput } from "@/components/shared/NumberInput";
import { MoneyInput } from "@/components/shared/MoneyInput";
import { brl, fmtNum } from "@/lib/format";

EOF
b 194 194 > "$T/del/02-export.txt"
sed -E 's/^function PrecoTabela\(/export function PrecoTabela(/' "$T/del/02-export.txt" > "$T/add/02-export.txt"
b 24 24 > "$T/del/03-statusbadge.txt"
b 54 54 > "$T/del/04-format.txt"
printf '%s\n' 'import { brl } from "@/lib/format";' > "$T/add/04-format.txt"
cp .superpowers/f30/anchor.txt "$T/del/05-anchor.txt"
{ printf '%s\n' 'import { PrecoTabela } from "@/components/planejamento/planejamento-detail/PrecoTabela";'; cat .superpowers/f30/anchor.txt; } > "$T/add/05-anchor.txt"
cat "$T/add/02-export.txt" "$T/del/03-statusbadge.txt" "$T/del/04-format.txt"
```

Esperado: `export function PrecoTabela(props: {`, `import { StatusBadge } from "@/components/shared/StatusBadge";` e `import { brl, fmtNum } from "@/lib/format";`.

- [ ] **Step 2: Montar `PrecoTabela.tsx`**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f30-planejamento-detail"
T=.superpowers/f30/t2; D=src/components/planejamento/planejamento-detail
b() { .superpowers/f30/base.sh "$@"; }
{ cat "$T/add/01-cabecalho.txt"; b 190 380; } > "$D/PrecoTabela.tsx"
sed -i '' -E 's/^function PrecoTabela\(/export function PrecoTabela(/' "$D/PrecoTabela.tsx"
grep -n '^export \|^const mkFmt' "$D/PrecoTabela.tsx"
```

Esperado: `const mkFmt = …` (privado) e `export function PrecoTabela(props: {`.

- [ ] **Step 3: Orquestrador**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f30-planejamento-detail"
T=.superpowers/f30/t2; F=src/components/planejamento/PlanejamentoDetail.tsx
b() { .superpowers/f30/base.sh "$@"; }; troca() { node .superpowers/f30/troca.mjs "$@"; }
b 190 381 > "$T/mov/01-preco-tabela.txt"
troca "$F" "$T/mov/01-preco-tabela.txt"
troca "$F" "$T/del/03-statusbadge.txt"
troca "$F" "$T/del/04-format.txt" "$T/add/04-format.txt"
troca "$F" "$T/del/05-anchor.txt" "$T/add/05-anchor.txt"
```

Esperado: 4× `ok: …`.

- [ ] **Step 4: Prova de equivalência**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f30-planejamento-detail"
.superpowers/f30/confere.sh HEAD .superpowers/f30/t2
grep -c "queryKey" .superpowers/f30/t2/add/* ; git status --porcelain -- src/components/desenvolvimento src/lib supabase tests src/routes
```

Esperado: `EQUIVALENTE — …`, contagens `0` e `status` vazio.

- [ ] **Step 5: Gates** (a partir daqui, `podeEditarCustos` aparece em `PrecoTabela.tsx`: lista B)

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f30-planejamento-detail"
.superpowers/f30/gates.sh t2 0 .superpowers/f30/unused-esperado-B.txt
```

Esperado: `GATES OK (t2)`.

- [ ] **Step 6: Commit**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f30-planejamento-detail"
git add -- src/components/planejamento/planejamento-detail/PrecoTabela.tsx src/components/planejamento/PlanejamentoDetail.tsx
git commit --only -m "$(cat <<'EOF'
refactor(planejamento): F3.0 (2/8) — tabela da seção Preço em planejamento-detail/PrecoTabela.tsx

PrecoTabela (+ mkFmt) movida de PlanejamentoDetail.tsx sem mudança (texto do commit-base; prova
confere.sh). Só props; nenhuma query/RPC.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)" -- src/components/planejamento/planejamento-detail/PrecoTabela.tsx src/components/planejamento/PlanejamentoDetail.tsx
```

---

### Task 3: `helpers.ts` — rótulos de conflito, limpeza da simulação e invalidações pós-aprovação de MO

**Files:**
- Create: `src/components/planejamento/planejamento-detail/helpers.ts`.
- Test (novo): `tests/unit/planejamento-detail-helpers.test.ts`.
- Modify: `PlanejamentoDetail.tsx`:
  - remove as linhas do BASE 125-156 e 2383-2401;
  - acrescenta o import de `helpers` antes da âncora.

**Interfaces:**
- Consumes: Task 0 (ferramentas e âncora).
- Produces:
  - `rotuloConflitoPlan(path: string): string` (o `ROTULO_CONFLITO_PLAN` fica privado no arquivo; a F3.1 o estende ali).
  - `limparCustoSim(s: CustoSimInput | null | undefined): CustoSimInput | null`.
  - `invalidarAposAprovarMO(qc: ReturnType<typeof useQueryClient>, modeloId: string): void`.
  - `partes/i-helpers.txt` (linha de import), reusado pela Task 8.

- [ ] **Step 1: Escrever o teste que trava o comportamento de hoje**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f30-planejamento-detail"
cat > tests/unit/planejamento-detail-helpers.test.ts <<'EOF'
import { describe, it, expect } from "vitest";
import {
  rotuloConflitoPlan,
  limparCustoSim,
  invalidarAposAprovarMO,
} from "@/components/planejamento/planejamento-detail/helpers";

// F3.0 (set/2026) — trava o comportamento dos helpers do detalhe do Planejamento, que saíram de
// dentro de PlanejamentoDetail.tsx. Nada aqui muda regra: é a foto do comportamento de hoje.

describe("rotuloConflitoPlan", () => {
  it("devolve o rótulo PT dos campos conhecidos do Draft", () => {
    expect(rotuloConflitoPlan("nome")).toBe("Nome do Modelo");
    expect(rotuloConflitoPlan("preco_venda")).toBe("Preço para venda");
    expect(rotuloConflitoPlan("custo_simulado")).toBe("Simulação de custo");
    expect(rotuloConflitoPlan("tecidos_planejados")).toBe("Tecido Planejado");
  });
  it("cai no próprio path quando não há rótulo", () => {
    expect(rotuloConflitoPlan("campo_inexistente")).toBe("campo_inexistente");
  });
});

describe("limparCustoSim", () => {
  it("null, undefined e objeto vazio viram null", () => {
    expect(limparCustoSim(null)).toBeNull();
    expect(limparCustoSim(undefined)).toBeNull();
    expect(limparCustoSim({})).toBeNull();
  });
  it("zero, negativo e não-número viram null (tudo null → null)", () => {
    expect(limparCustoSim({ consumo_tecido: 0, aviamento: -1, mao_obra: Number.NaN })).toBeNull();
  });
  it("mantém só valores > 0 e descarta preco_tecido_m", () => {
    expect(limparCustoSim({ consumo_tecido: 1.2, aviamento: 0, mao_obra: 10, preco_tecido_m: 30 }))
      .toEqual({ consumo_tecido: 1.2, aviamento: null, mao_obra: 10 });
  });
  it("aceita número em texto", () => {
    expect(limparCustoSim({ aviamento: "4.5" } as any))
      .toEqual({ consumo_tecido: null, aviamento: 4.5, mao_obra: null });
  });
});

describe("invalidarAposAprovarMO", () => {
  it("invalida exatamente estas 7 queryKeys, nesta ordem", () => {
    const chamadas: unknown[] = [];
    const qc = { invalidateQueries: (o: { queryKey: unknown }) => { chamadas.push(o.queryKey); } };
    invalidarAposAprovarMO(qc as any, "m1");
    expect(chamadas).toEqual([
      ["modelo", "m1"],
      ["mo-resumo", "m1"],
      ["plan-custo-unit", "m1"],
      ["modelos-planejamento"],
      ["mo-resumo-list"],
      ["modelo-mo-resumo"],
      ["modelos-desenvolvimento"],
    ]);
  });
});
EOF
```

- [ ] **Step 2: Rodar o teste e ver falhar**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f30-planejamento-detail"
env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit/planejamento-detail-helpers.test.ts 2>&1 | tail -8
```

Esperado: FAIL, porque o módulo `@/components/planejamento/planejamento-detail/helpers` não resolve (o arquivo ainda não existe).

- [ ] **Step 3: Partes novas e montagem de `helpers.ts`**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f30-planejamento-detail"
T=.superpowers/f30/t3; D=src/components/planejamento/planejamento-detail
mkdir -p "$T/add" "$T/del" "$T/mov" "$T/partes"
b() { .superpowers/f30/base.sh "$@"; }
cat > "$T/add/01-cabecalho.txt" <<'EOF'
// Helpers PUROS do detalhe do Planejamento (sem JSX e sem hooks). Extraídos na F3.0 (set/2026) de
// `PlanejamentoDetail.tsx` SEM mudança de comportamento: texto MOVIDO como estava (só ganhou
// `export`). A F3.1 acrescenta em ROTULO_CONFLITO_PLAN os rótulos dos campos novos.
import { useQueryClient } from "@tanstack/react-query";
import { type CustoSimInput } from "@/lib/preco";

EOF
for n in 140 147 2388; do b "$n" "$n"; done > "$T/del/02-exports.txt"
sed -E 's/^function (rotuloConflitoPlan|limparCustoSim|invalidarAposAprovarMO)\(/export function \1(/' "$T/del/02-exports.txt" > "$T/add/02-exports.txt"
printf '%s\n' 'import { rotuloConflitoPlan, limparCustoSim, invalidarAposAprovarMO } from "@/components/planejamento/planejamento-detail/helpers";' > "$T/partes/i-helpers.txt"
cp .superpowers/f30/anchor.txt "$T/del/03-anchor.txt"
cat "$T/partes/i-helpers.txt" .superpowers/f30/anchor.txt > "$T/add/03-anchor.txt"
{ cat "$T/add/01-cabecalho.txt"; b 125 142; echo; b 144 155; echo; b 2384 2401; } > "$D/helpers.ts"
sed -i '' -E 's/^function (rotuloConflitoPlan|limparCustoSim|invalidarAposAprovarMO)\(/export function \1(/' "$D/helpers.ts"
grep -n '^export \|^const ROTULO' "$D/helpers.ts"
```

Esperado: `const ROTULO_CONFLITO_PLAN…` e 3 linhas `export function …` (`rotuloConflitoPlan`, `limparCustoSim`, `invalidarAposAprovarMO`).

- [ ] **Step 4: Rodar o teste e ver passar**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f30-planejamento-detail"
env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit/planejamento-detail-helpers.test.ts 2>&1 | tail -5
```

Esperado: `Tests  7 passed (7)`.

- [ ] **Step 5: Orquestrador**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f30-planejamento-detail"
T=.superpowers/f30/t3; F=src/components/planejamento/PlanejamentoDetail.tsx
b() { .superpowers/f30/base.sh "$@"; }; troca() { node .superpowers/f30/troca.mjs "$@"; }
b 125 156 > "$T/mov/01-rotulo-limpar.txt"
b 2383 2401 > "$T/mov/02-invalidar.txt"
troca "$F" "$T/mov/01-rotulo-limpar.txt"
troca "$F" "$T/mov/02-invalidar.txt"
troca "$F" "$T/del/03-anchor.txt" "$T/add/03-anchor.txt"
tail -c 3 "$F" | od -c | head -1
```

Esperado: 3× `ok: …`, e o arquivo termina em `}\n`.

- [ ] **Step 6: Prova de equivalência + gates (7 testes novos)**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f30-planejamento-detail"
.superpowers/f30/confere.sh HEAD .superpowers/f30/t3
grep -c "queryKey" .superpowers/f30/t3/add/* ; git status --porcelain -- src/components/desenvolvimento src/lib supabase src/routes tests/integration tests/fixtures
.superpowers/f30/gates.sh t3 7 .superpowers/f30/unused-esperado-B.txt
```

Esperado: `EQUIVALENTE — …`, contagens `0`, `status` vazio e `GATES OK (t3)` (passados = N_PASS + 7).

- [ ] **Step 7: Commit**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f30-planejamento-detail"
git add -- src/components/planejamento/planejamento-detail/helpers.ts src/components/planejamento/PlanejamentoDetail.tsx tests/unit/planejamento-detail-helpers.test.ts
git commit --only -m "$(cat <<'EOF'
refactor(planejamento): F3.0 (3/8) — helpers puros do detalhe em planejamento-detail/helpers.ts

rotuloConflitoPlan (+ROTULO_CONFLITO_PLAN), limparCustoSim e invalidarAposAprovarMO movidos sem
mudança (texto do commit-base; prova confere.sh) + teste unitário que trava rótulos, limpeza da
simulação e as 7 queryKeys invalidadas após aprovar/reprovar MO.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)" -- src/components/planejamento/planejamento-detail/helpers.ts src/components/planejamento/PlanejamentoDetail.tsx tests/unit/planejamento-detail-helpers.test.ts
```

---

### Task 4: `sync-tecidos.ts` — sincronização Tecido Planejado → `modelo_tecidos`

**Files:**
- Create: `src/components/planejamento/planejamento-detail/sync-tecidos.ts`.
- Modify: `PlanejamentoDetail.tsx`:
  - remove as linhas do BASE 76-124;
  - acrescenta o import antes da âncora.

**Interfaces:**
- Consumes: Task 0.
- Produces:
  - `export async function syncTecidosToDesenvolvimento(modeloId: string, planejados: string[]): Promise<void>`.
  - `partes/i-sync.txt` (linha de import), reusado pela Task 8.

*TDD:* a função só conversa com o supabase-js (4 formas de chamada encadeada). Mockar o builder para travar um código que a F3.2 vai APAGAR não compensa. A prova é o movimento (`confere.sh`), e o comportamento de gravação é comparado no QA A/B (as requisições do Salvar de A e B têm de ser idênticas).

- [ ] **Step 1: Partes novas e montagem**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f30-planejamento-detail"
T=.superpowers/f30/t4; D=src/components/planejamento/planejamento-detail
mkdir -p "$T/add" "$T/del" "$T/mov" "$T/partes"
b() { .superpowers/f30/base.sh "$@"; }
cat > "$T/add/01-cabecalho.txt" <<'EOF'
// Sincroniza `tecidos_planejados` (Planejamento) → `modelo_tecidos` tipo "tecido" (Desenvolvimento).
// Extraído na F3.0 (set/2026) de `PlanejamentoDetail.tsx` SEM mudança de comportamento: texto MOVIDO
// como estava (só ganhou `export`). A F3.2 (BOM no Sheet unificado) apaga este arquivo.
import { supabase } from "@/integrations/supabase/client";

EOF
b 83 83 > "$T/del/02-export.txt"
sed -E 's/^async function syncTecidosToDesenvolvimento\(/export async function syncTecidosToDesenvolvimento(/' "$T/del/02-export.txt" > "$T/add/02-export.txt"
printf '%s\n' 'import { syncTecidosToDesenvolvimento } from "@/components/planejamento/planejamento-detail/sync-tecidos";' > "$T/partes/i-sync.txt"
cp .superpowers/f30/anchor.txt "$T/del/03-anchor.txt"
cat "$T/partes/i-sync.txt" .superpowers/f30/anchor.txt > "$T/add/03-anchor.txt"
{ cat "$T/add/01-cabecalho.txt"; b 76 123; } > "$D/sync-tecidos.ts"
sed -i '' -E 's/^async function syncTecidosToDesenvolvimento\(/export async function syncTecidosToDesenvolvimento(/' "$D/sync-tecidos.ts"
grep -n '^export ' "$D/sync-tecidos.ts"
```

Esperado: `export async function syncTecidosToDesenvolvimento(modeloId: string, planejados: string[]) {`.

- [ ] **Step 2: Orquestrador**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f30-planejamento-detail"
T=.superpowers/f30/t4; F=src/components/planejamento/PlanejamentoDetail.tsx
b() { .superpowers/f30/base.sh "$@"; }; troca() { node .superpowers/f30/troca.mjs "$@"; }
b 76 124 > "$T/mov/01-sync.txt"
troca "$F" "$T/mov/01-sync.txt"
troca "$F" "$T/del/03-anchor.txt" "$T/add/03-anchor.txt"
```

Esperado: 2× `ok: …`.

- [ ] **Step 3: Prova + gates**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f30-planejamento-detail"
.superpowers/f30/confere.sh HEAD .superpowers/f30/t4
grep -c "queryKey" .superpowers/f30/t4/add/* ; git status --porcelain -- src/components/desenvolvimento src/lib supabase src/routes tests
.superpowers/f30/gates.sh t4 7 .superpowers/f30/unused-esperado-B.txt
```

Esperado: `EQUIVALENTE — …`, contagens `0`, `status` vazio e `GATES OK (t4)`.

- [ ] **Step 4: Commit**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f30-planejamento-detail"
git add -- src/components/planejamento/planejamento-detail/sync-tecidos.ts src/components/planejamento/PlanejamentoDetail.tsx
git commit --only -m "$(cat <<'EOF'
refactor(planejamento): F3.0 (4/8) — sync Tecido Planejado → modelo_tecidos em planejamento-detail/sync-tecidos.ts

syncTecidosToDesenvolvimento movida sem mudança (texto do commit-base; prova confere.sh). A F3.2 apaga
o arquivo inteiro quando o BOM entrar no Sheet.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)" -- src/components/planejamento/planejamento-detail/sync-tecidos.ts src/components/planejamento/PlanejamentoDetail.tsx
```

---

### Task 5: `InfoGeraisSecao.tsx` — seção 1 "Informações Gerais do Produto"

**Files:**
- Create: `src/components/planejamento/planejamento-detail/InfoGeraisSecao.tsx`.
- Modify: `PlanejamentoDetail.tsx`:
  - troca as linhas do BASE 1783-1868 (o `<Secao titulo="Informações Gerais do Produto">…</Secao>`) por `<InfoGeraisSecao … />`;
  - tira `STATUS_OPTS` do import de `modelo-shared`;
  - acrescenta o import antes da âncora.

**Interfaces:**
- Consumes: Task 1 (`Secao`, `FieldText`, `FieldSelect` de `campos.tsx`).
- Produces:

```ts
export function InfoGeraisSecao(props: {
  draft: Draft;
  setDraftTracked: Dispatch<SetStateAction<Draft>>;
  grupoSel: string | null;
  setGrupoSel: Dispatch<SetStateAction<string | null>>;
  grupos: Opt[];
  categorias: CatOpt[];
  estilistas: Opt[];
  sub1Opts: SubOpt[];
  sub2Opts: SubOpt[];
  fl: ReturnType<typeof useFieldLabels>;
})
```

A F3.1 põe a "Descrição do produto" aqui, no fim, antes do `</Secao>`.

- [ ] **Step 1: Partes novas**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f30-planejamento-detail"
T=.superpowers/f30/t5; mkdir -p "$T/add" "$T/del" "$T/mov"
cat > "$T/add/01-cabecalho.txt" <<'EOF'
// Seção 1 "Informações Gerais do Produto" do detalhe do Planejamento. Extraída na F3.0 (set/2026)
// de `PlanejamentoDetail.tsx` SEM mudança de comportamento: o JSX abaixo foi MOVIDO como estava; o
// estado continua no orquestrador e chega por props com os MESMOS nomes. A F3.1 acrescenta aqui, no
// fim da seção (antes do `</Secao>`), o campo "Descrição do produto".
import type { Dispatch, SetStateAction } from "react";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/shared/NumberInput";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useFieldLabels } from "@/hooks/useFieldLabels";
import { STATUS_OPTS, type Opt, type CatOpt, type SubOpt, type Draft } from "@/components/planejamento/modelo-shared";
import { Secao, FieldText, FieldSelect } from "@/components/planejamento/planejamento-detail/campos";

export function InfoGeraisSecao({
  draft, setDraftTracked, grupoSel, setGrupoSel, grupos, categorias, estilistas, sub1Opts, sub2Opts, fl,
}: {
  draft: Draft;
  setDraftTracked: Dispatch<SetStateAction<Draft>>;
  grupoSel: string | null;
  setGrupoSel: Dispatch<SetStateAction<string | null>>;
  grupos: Opt[];
  categorias: CatOpt[];
  estilistas: Opt[];
  sub1Opts: SubOpt[];
  sub2Opts: SubOpt[];
  fl: ReturnType<typeof useFieldLabels>;
}) {
  return (
EOF
cat > "$T/add/02-rodape.txt" <<'EOF'
  );
}
EOF
cat > "$T/add/03-uso.txt" <<'EOF'
          <InfoGeraisSecao
            draft={draft} setDraftTracked={setDraftTracked}
            grupoSel={grupoSel} setGrupoSel={setGrupoSel}
            grupos={grupos} categorias={categorias} estilistas={estilistas}
            sub1Opts={sub1Opts} sub2Opts={sub2Opts} fl={fl}
          />
EOF
printf '%s\n' '  numOr0, STATUS_OPTS,' > "$T/del/04-shared.txt"
printf '%s\n' '  numOr0,' > "$T/add/04-shared.txt"
cp .superpowers/f30/anchor.txt "$T/del/05-anchor.txt"
{ printf '%s\n' 'import { InfoGeraisSecao } from "@/components/planejamento/planejamento-detail/InfoGeraisSecao";'; cat .superpowers/f30/anchor.txt; } > "$T/add/05-anchor.txt"
```

- [ ] **Step 2: Montar o componente e ligar no orquestrador**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f30-planejamento-detail"
T=.superpowers/f30/t5; D=src/components/planejamento/planejamento-detail; F=src/components/planejamento/PlanejamentoDetail.tsx
b() { .superpowers/f30/base.sh "$@"; }; troca() { node .superpowers/f30/troca.mjs "$@"; }
{ cat "$T/add/01-cabecalho.txt"; b 1783 1868; cat "$T/add/02-rodape.txt"; } > "$D/InfoGeraisSecao.tsx"
b 1783 1868 > "$T/mov/01-secao1.txt"
head -1 "$T/mov/01-secao1.txt"; tail -1 "$T/mov/01-secao1.txt"
troca "$F" "$T/mov/01-secao1.txt" "$T/add/03-uso.txt"
troca "$F" "$T/del/04-shared.txt" "$T/add/04-shared.txt"
troca "$F" "$T/del/05-anchor.txt" "$T/add/05-anchor.txt"
grep -n "SETOR 1\|<InfoGeraisSecao\|SETOR 2" "$F"
```

Esperado:
- `          <Secao titulo="Informações Gerais do Produto">` / `          </Secao>`.
- 3× `ok: …`.
- A ordem é `{/* SETOR 1 — …*/}`, depois `<InfoGeraisSecao`, depois `{/* SETOR 2 — Coleção */}`.

- [ ] **Step 3: Prova + gates**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f30-planejamento-detail"
.superpowers/f30/confere.sh HEAD .superpowers/f30/t5
grep -c "queryKey" .superpowers/f30/t5/add/* ; git status --porcelain -- src/components/desenvolvimento src/lib supabase src/routes tests
.superpowers/f30/gates.sh t5 7 .superpowers/f30/unused-esperado-B.txt
```

Esperado: `EQUIVALENTE — …`, contagens `0`, `status` vazio e `GATES OK (t5)`.

- [ ] **Step 4: Commit**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f30-planejamento-detail"
git add -- src/components/planejamento/planejamento-detail/InfoGeraisSecao.tsx src/components/planejamento/PlanejamentoDetail.tsx
git commit --only -m "$(cat <<'EOF'
refactor(planejamento): F3.0 (5/8) — seção "Informações Gerais do Produto" em planejamento-detail/InfoGeraisSecao.tsx

JSX da seção 1 movido sem mudança (texto do commit-base; prova confere.sh); estado segue no
orquestrador e chega por props com os mesmos nomes. Ponto de entrada da "Descrição do produto" (F3.1).

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)" -- src/components/planejamento/planejamento-detail/InfoGeraisSecao.tsx src/components/planejamento/PlanejamentoDetail.tsx
```

---

### Task 6: `useRevendaPlanejamento.ts` — estado, queries e mutations da revenda

**Files:**
- Create: `src/components/planejamento/planejamento-detail/useRevendaPlanejamento.ts`.
- Modify: `PlanejamentoDetail.tsx`:
  - remove as linhas do BASE 574-588, 590-595 e 855-979;
  - troca as linhas do BASE 991-1103 pela chamada do hook + desestruturação + as linhas 590-592/594-595 (`dirty` combinado e `useUnsavedGuard`, re-inseridas LOGO APÓS o hook, sem mudar o texto);
  - remove os imports `markupDePreco` (BASE :17), `ehGrupoAcessorio` (:60), `erroValidacao` + `DEFAULT_TAMANHOS` (:63-64);
  - acrescenta o import antes da âncora.

**Interfaces:**
- Consumes: nada das tasks anteriores além das ferramentas. As variáveis do orquestrador passadas ao hook (todas já existem nas linhas acima do ponto de chamada): `modeloId`, `isEdit`, `isRevenda`, `paOn`, `draft`, `baseRevendaMarkup` (:842), `grupos`, `categorias`, `tenantIdAtivo` (:980), `revRef`, `qc`, `navigate`, `contexto`, `onClose`.
- Produces:

```ts
export type UseRevendaPlanejamentoArgs = {
  modeloId: string | null; isEdit: boolean; isRevenda: boolean; paOn: boolean; draft: Draft;
  baseRevendaMarkup: number; grupos: Opt[]; categorias: CatOpt[]; tenantIdAtivo: string;
  revRef: RefObject<number | null>; qc: QueryClient; navigate: ReturnType<typeof useNavigate>;
  contexto: "planejamento" | "produto-acabado"; onClose: () => void;
};
export function useRevendaPlanejamento(args: UseRevendaPlanejamentoArgs): {
  gradeRevenda; setGradeRevenda; gradeRevendaBaseRef; gradeRevendaRevRef; gradeRevendaDirty;
  produtoRevenda; produtoRevendaLoading;
  markupAtacadoInput; setMarkupAtacadoInput; markupVarejoInput; setMarkupVarejoInput;
  markupAtacadoBaseRef; markupVarejoBaseRef;
  precoAtacadoDraft; setPrecoAtacadoDraft; precoVarejoDraft; setPrecoVarejoDraft;
  salvarMarkupsRevenda; salvarPrecosFixoRevenda;
  variantesRevenda; tamanhosRevenda;
  setCelulaGradeRevenda; totalLinhaRevenda; totalColunaRevenda; totalGeralRevenda;
  buildLinhasGradeRevenda; criarProdutoAcabado;
};
export type RevendaPlanejamento = ReturnType<typeof useRevendaPlanejamento>;
```

  No orquestrador ficam `const revenda = useRevendaPlanejamento({...})` e a desestruturação com os MESMOS nomes (`partes/03b-desestrutura.txt`, reusada pela Task 7).

**Ordem de hooks e effects:** a chamada fica EXATAMENTE onde começavam as linhas 991 (depois de `tenantIdAtivo` e da query `markupFaixaOn`). Assim o seed da grade (o 1º `useEffect` do componente, que lê `revRef.current`) continua ANTES do seed de MO (:1137) e do merge do colab (:1196). O `dirty` e o `useUnsavedGuard` só mudam de posição, e o valor é o mesmo no mesmo render.

- [ ] **Step 1: Partes novas**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f30-planejamento-detail"
T=.superpowers/f30/t6; mkdir -p "$T/add" "$T/del" "$T/mov" "$T/partes"
b() { .superpowers/f30/base.sh "$@"; }
cat > "$T/add/01-cabecalho.txt" <<'EOF'
// Revenda (Produto Acabado) no detalhe do Planejamento: produto vinculado, markups e preços fixos,
// grade cor×tamanho e "criar produto acabado". Extraído na F3.0 (set/2026) de `PlanejamentoDetail.tsx`
// SEM mudança de comportamento: o corpo abaixo é o texto MOVIDO como estava (mesmas queryKeys,
// mesmas RPCs, mesma ordem relativa de hooks). ORDEM IMPORTA: o orquestrador chama este hook ANTES
// dos effects de seed de MO e de merge do colab — o seed da grade copia `revRef.current` (igual a
// antes). A F3.4 (comprado / grade única) mexe aqui.
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useMutation, useQuery, type QueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { markupDePreco } from "@/lib/preco-revenda";
import { supabase } from "@/integrations/supabase/client";
import { ehGrupoAcessorio } from "@/lib/produto-acabado";
import { erroValidacao } from "@/components/produto-acabado/shared";
import { DEFAULT_TAMANHOS } from "@/components/oc-p-acabado/shared";
import { type Opt, type CatOpt, type Draft } from "@/components/planejamento/modelo-shared";

export type UseRevendaPlanejamentoArgs = {
  modeloId: string | null;
  isEdit: boolean;
  isRevenda: boolean;
  paOn: boolean;
  draft: Draft;
  /** custo previsto + M.O. ao vivo (calculado no orquestrador, bloco de preço). */
  baseRevendaMarkup: number;
  grupos: Opt[];
  categorias: CatOpt[];
  tenantIdAtivo: string;
  /** rev otimista do header (colab) — o seed da grade copia `revRef.current`. Passar o REF, não o valor. */
  revRef: RefObject<number | null>;
  qc: QueryClient;
  navigate: ReturnType<typeof useNavigate>;
  contexto: "planejamento" | "produto-acabado";
  onClose: () => void;
};

export function useRevendaPlanejamento({
  modeloId, isEdit, isRevenda, paOn, draft, baseRevendaMarkup, grupos, categorias,
  tenantIdAtivo, revRef, qc, navigate, contexto, onClose,
}: UseRevendaPlanejamentoArgs) {
EOF
cat > "$T/add/02-rodape.txt" <<'EOF'

  return {
    gradeRevenda, setGradeRevenda, gradeRevendaBaseRef, gradeRevendaRevRef, gradeRevendaDirty,
    produtoRevenda, produtoRevendaLoading,
    markupAtacadoInput, setMarkupAtacadoInput, markupVarejoInput, setMarkupVarejoInput,
    markupAtacadoBaseRef, markupVarejoBaseRef,
    precoAtacadoDraft, setPrecoAtacadoDraft, precoVarejoDraft, setPrecoVarejoDraft,
    salvarMarkupsRevenda, salvarPrecosFixoRevenda,
    variantesRevenda, tamanhosRevenda,
    setCelulaGradeRevenda, totalLinhaRevenda, totalColunaRevenda, totalGeralRevenda,
    buildLinhasGradeRevenda, criarProdutoAcabado,
  };
}

export type RevendaPlanejamento = ReturnType<typeof useRevendaPlanejamento>;
EOF
cat > "$T/partes/03a-chamada.txt" <<'EOF'
  // Revenda (Produto Acabado): estado, queries e mutations extraídos na F3.0 para
  // `planejamento-detail/useRevendaPlanejamento.ts` (texto movido). Chamado AQUI — antes dos effects
  // de seed de MO e de merge do colab, como antes (o seed da grade lê `revRef.current`).
  const revenda = useRevendaPlanejamento({
    modeloId, isEdit, isRevenda, paOn, draft, baseRevendaMarkup, grupos, categorias,
    tenantIdAtivo, revRef, qc, navigate, contexto, onClose,
  });
EOF
cat > "$T/partes/03b-desestrutura.txt" <<'EOF'
  const {
    gradeRevenda, setGradeRevenda, gradeRevendaBaseRef, gradeRevendaRevRef, gradeRevendaDirty,
    produtoRevenda, produtoRevendaLoading,
    markupAtacadoInput, setMarkupAtacadoInput, markupVarejoInput, setMarkupVarejoInput,
    markupAtacadoBaseRef, markupVarejoBaseRef,
    precoAtacadoDraft, setPrecoAtacadoDraft, precoVarejoDraft, setPrecoVarejoDraft,
    salvarMarkupsRevenda, salvarPrecosFixoRevenda,
    variantesRevenda, tamanhosRevenda,
    setCelulaGradeRevenda, totalLinhaRevenda, totalColunaRevenda, totalGeralRevenda,
    buildLinhasGradeRevenda, criarProdutoAcabado,
  } = revenda;
EOF
# uso = chamada + desestruturação + as MESMAS linhas 590-592 e 594-595 do BASE (dirty + guarda), só mudam de lugar
{ cat "$T/partes/03a-chamada.txt" "$T/partes/03b-desestrutura.txt"; b 590 592; b 594 595; } > "$T/add/03-uso.txt"
{ b 590 592; b 594 595; } > "$T/del/03-dirty-linhas.txt"
b 17 17 > "$T/del/04-i17.txt"
b 60 60 > "$T/del/05-i60.txt"
b 63 64 > "$T/del/06-i63-64.txt"
cp .superpowers/f30/anchor.txt "$T/del/07-anchor.txt"
{ printf '%s\n' 'import { useRevendaPlanejamento } from "@/components/planejamento/planejamento-detail/useRevendaPlanejamento";'; cat .superpowers/f30/anchor.txt; } > "$T/add/07-anchor.txt"
cat "$T/del/03-dirty-linhas.txt" "$T/del/04-i17.txt" "$T/del/05-i60.txt" "$T/del/06-i63-64.txt"
```

Esperado:
- As 3 linhas de comentário "Dirty combinado…", `const dirty = draftDirty || …` e `const { requestClose, confirm } = useUnsavedGuard({ dirty, onClose });`.
- Depois os imports `markupDePreco`, `ehGrupoAcessorio`, `erroValidacao` e `DEFAULT_TAMANHOS`.

- [ ] **Step 2: Montar o hook com o texto do BASE**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f30-planejamento-detail"
T=.superpowers/f30/t6; D=src/components/planejamento/planejamento-detail
b() { .superpowers/f30/base.sh "$@"; }
b 593 593
{ cat "$T/add/01-cabecalho.txt"; b 574 588; b 593 593; echo; b 855 979; b 991 1053; echo; b 1055 1103; cat "$T/add/02-rodape.txt"; } > "$D/useRevendaPlanejamento.ts"
grep -n "useEffect(\|useQuery({\|useMutation({\|queryKey:" "$D/useRevendaPlanejamento.ts"
```

Esperado:
- A 1ª linha é `  const gradeRevendaDirty = gradeRevendaSeededRef.current && JSON.stringify(gradeRevenda) !== gradeRevendaBaseRef.current;`.
- Os `queryKey` são EXATAMENTE `["pa-produto-modelo", modeloId]`, `["tenant-config-tamanhos-planejamento", tenantIdAtivo]` e `["modelo-grades-revenda", modeloId]`, mais os `invalidateQueries` de `salvarMarkupsRevenda`/`salvarPrecosFixoRevenda`/`criarProdutoAcabado`.
- Há 1 `useEffect(`.

- [ ] **Step 3: Orquestrador (ordem das trocas importa: removidos primeiro, chamada depois)**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f30-planejamento-detail"
T=.superpowers/f30/t6; F=src/components/planejamento/PlanejamentoDetail.tsx
b() { .superpowers/f30/base.sh "$@"; }; troca() { node .superpowers/f30/troca.mjs "$@"; }
b 574 588 > "$T/mov/01-estado-grade.txt"
b 590 595 > "$T/mov/02-dirty.txt"
b 855 979 > "$T/mov/03-revenda.txt"
b 991 1103 > "$T/mov/04-grade-criar.txt"
troca "$F" "$T/mov/01-estado-grade.txt"
troca "$F" "$T/mov/02-dirty.txt"
troca "$F" "$T/mov/03-revenda.txt"
troca "$F" "$T/mov/04-grade-criar.txt" "$T/add/03-uso.txt"
troca "$F" "$T/del/04-i17.txt"
troca "$F" "$T/del/05-i60.txt"
troca "$F" "$T/del/06-i63-64.txt"
troca "$F" "$T/del/07-anchor.txt" "$T/add/07-anchor.txt"
grep -n "const tenantIdAtivo\|markup_analise_faixa\|useRevendaPlanejamento({\|useUnsavedGuard({\|const setSim\|useEffect(" "$F"
```

Esperado: 8× `ok: …`, e o `grep` na ordem:
1. `const tenantIdAtivo = useActiveTenantId();`
2. a query `markup_analise_faixa`
3. `useRevendaPlanejamento({`
4. `useUnsavedGuard({ dirty, onClose })`
5. `const setSim`
6. os 2 `useEffect(` restantes (seed de MO e merge do colab), ambos DEPOIS do hook.

- [ ] **Step 4: Prova + gates**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f30-planejamento-detail"
.superpowers/f30/confere.sh HEAD .superpowers/f30/t6
grep -c "queryKey" .superpowers/f30/t6/add/* ; git status --porcelain -- src/components/desenvolvimento src/lib supabase src/routes tests
.superpowers/f30/gates.sh t6 7 .superpowers/f30/unused-esperado-B.txt
```

Esperado: `EQUIVALENTE — …`, contagens `0`, `status` vazio e `GATES OK (t6)`.

Se o `tsc` acusar TS2304 ou TS2552 (nome indefinido) no orquestrador, algum nome do corpo movido ficou sem entrar na desestruturação. Corrija a desestruturação (`partes/03b` + `add/03-uso`), refaça a troca a partir do HEAD (`git checkout -- src/components/planejamento/PlanejamentoDetail.tsx` e repita os Steps 3–4). Nunca edite o texto movido.

- [ ] **Step 5: Commit**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f30-planejamento-detail"
git add -- src/components/planejamento/planejamento-detail/useRevendaPlanejamento.ts src/components/planejamento/PlanejamentoDetail.tsx
git commit --only -m "$(cat <<'EOF'
refactor(planejamento): F3.0 (6/8) — estado/queries/mutations da revenda em planejamento-detail/useRevendaPlanejamento.ts

Produto vinculado, markups, preços fixos, grade cor×tamanho e "criar produto acabado" movidos sem
mudança (texto do commit-base; prova confere.sh). Hook chamado no mesmo ponto do render: o seed da
grade segue antes do seed de MO e do merge do colab; dirty/useUnsavedGuard só mudaram de posição.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)" -- src/components/planejamento/planejamento-detail/useRevendaPlanejamento.ts src/components/planejamento/PlanejamentoDetail.tsx
```

---

### Task 7: `RevendaSetores.tsx` — JSX da revenda (preço, Produto Acabado, grade)

**Files:**
- Create: `src/components/planejamento/planejamento-detail/RevendaSetores.tsx`.
- Modify: `PlanejamentoDetail.tsx`:
  - troca as linhas do BASE 1951-2041, 2082-2109 e 2116-2166 pelos 3 componentes;
  - reduz a desestruturação de `revenda`;
  - tira `CampoRO` do import de `campos`;
  - poda os imports que ficaram sem uso: `ExternalLink`/`PackagePlus`, `NumberInput`+`MoneyInput` (BASE :38-39), `brl`, `varianteLabel` (:62);
  - acrescenta o import antes da âncora.

**Interfaces:**
- Consumes:
  - Task 1 (`Secao`, `CampoRO`).
  - Task 6: `RevendaPlanejamento` e `revenda` no orquestrador. O arquivo `t6/partes/03b-desestrutura.txt` é o texto antigo da desestruturação.
  - Task 1 `add/03-lucide.txt` (import lucide atual).
  - Task 2 `add/04-format.txt` (import `brl` atual).
- Produces:

```ts
export function PrecoRevendaBloco(props: { rv: RevendaPlanejamento; custoReal: boolean; piRevenda: PrecoInfo; draft: Draft })
export function ProdutoAcabadoSecao(props: { rv: RevendaPlanejamento; contexto: "planejamento" | "produto-acabado"; modeloId: string | null; navigate: ReturnType<typeof useNavigate> })
export function GradeRevendaSecao(props: { rv: RevendaPlanejamento })
```

  Os 3 ficam no nível do MÓDULO. Os condicionais de fora (`isEdit && isRevenda && paOn …`) continuam no orquestrador.

- [ ] **Step 1: Partes novas**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f30-planejamento-detail"
T=.superpowers/f30/t7; mkdir -p "$T/add" "$T/del" "$T/mov"
b() { .superpowers/f30/base.sh "$@"; }
cat > "$T/add/01-cabecalho.txt" <<'EOF'
// Blocos de REVENDA do detalhe do Planejamento (Produto Acabado): preço (markups + preços fixos),
// seção "Produto Acabado" (vínculo / criar) e seção "Grade" cor×tamanho. Extraídos na F3.0 (set/2026)
// de `PlanejamentoDetail.tsx` SEM mudança de comportamento: o JSX de cada bloco foi MOVIDO como
// estava; o estado vem de `useRevendaPlanejamento` (prop `rv`) e é desestruturado com os MESMOS nomes
// de antes. Componentes de nível de MÓDULO de propósito — declarados dentro do orquestrador, eles
// remontariam a cada render e o input perderia o foco.
import { ExternalLink, PackagePlus } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/shared/NumberInput";
import { MoneyInput } from "@/components/shared/MoneyInput";
import { brl } from "@/lib/format";
import { varianteLabel } from "@/lib/variante";
import { type PrecoInfo } from "@/lib/preco";
import { type Draft } from "@/components/planejamento/modelo-shared";
import { Secao, CampoRO } from "@/components/planejamento/planejamento-detail/campos";
import { type RevendaPlanejamento } from "@/components/planejamento/planejamento-detail/useRevendaPlanejamento";

/** Seção "Preço" do card REVENDA (ramo `isRevenda` do orquestrador). */
export function PrecoRevendaBloco({ rv, custoReal, piRevenda, draft }: {
  rv: RevendaPlanejamento; custoReal: boolean; piRevenda: PrecoInfo; draft: Draft;
}) {
  const {
    produtoRevenda, produtoRevendaLoading,
    markupAtacadoInput, setMarkupAtacadoInput, markupVarejoInput, setMarkupVarejoInput,
    markupAtacadoBaseRef, markupVarejoBaseRef, salvarMarkupsRevenda,
    precoAtacadoDraft, setPrecoAtacadoDraft, precoVarejoDraft, setPrecoVarejoDraft, salvarPrecosFixoRevenda,
  } = rv;
  return (
EOF
cat > "$T/add/02-meio-pa.txt" <<'EOF'
  );
}

/** Seção "Produto Acabado" do card revenda: vínculo (atalho ⧉) ou "Criar produto acabado". */
export function ProdutoAcabadoSecao({ rv, contexto, modeloId, navigate }: {
  rv: RevendaPlanejamento; contexto: "planejamento" | "produto-acabado"; modeloId: string | null;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const { produtoRevenda, produtoRevendaLoading, criarProdutoAcabado } = rv;
  return (
EOF
cat > "$T/add/03-meio-grade.txt" <<'EOF'
  );
}

/** Seção "Grade" cor×tamanho do card revenda (lê/grava `modelo_grades` pelo Salvar da página). */
export function GradeRevendaSecao({ rv }: { rv: RevendaPlanejamento }) {
  const {
    gradeRevenda, variantesRevenda, tamanhosRevenda,
    setCelulaGradeRevenda, totalLinhaRevenda, totalColunaRevenda, totalGeralRevenda,
  } = rv;
  return (
EOF
cat > "$T/add/04-rodape.txt" <<'EOF'
  );
}
EOF
printf '%s\n' '              <PrecoRevendaBloco rv={revenda} custoReal={custoReal} piRevenda={piRevenda} draft={draft} />' > "$T/add/05-uso-preco.txt"
printf '%s\n' '            <ProdutoAcabadoSecao rv={revenda} contexto={contexto} modeloId={modeloId} navigate={navigate} />' > "$T/add/06-uso-pa.txt"
printf '%s\n' '            <GradeRevendaSecao rv={revenda} />' > "$T/add/07-uso-grade.txt"
cp .superpowers/f30/t1/add/03-lucide.txt "$T/del/08-lucide.txt"
printf '%s\n' 'import { Trash2, Copy, ArrowLeft, Save } from "lucide-react";' > "$T/add/08-lucide.txt"
printf '%s\n' '  Secao, CampoRO, MultiArtigosField, FieldText, FieldSelect, PhotoList, SingleFileField,' > "$T/del/09-campos.txt"
printf '%s\n' '  Secao, MultiArtigosField, FieldText, FieldSelect, PhotoList, SingleFileField,' > "$T/add/09-campos.txt"
cp .superpowers/f30/t6/partes/03b-desestrutura.txt "$T/del/10-desestrutura.txt"
cat > "$T/add/10-desestrutura.txt" <<'EOF'
  const {
    gradeRevenda, setGradeRevenda, gradeRevendaBaseRef, gradeRevendaRevRef, gradeRevendaDirty,
    produtoRevenda, buildLinhasGradeRevenda,
  } = revenda;
EOF
cp .superpowers/f30/anchor.txt "$T/del/11-anchor.txt"
{ printf '%s\n' 'import { PrecoRevendaBloco, ProdutoAcabadoSecao, GradeRevendaSecao } from "@/components/planejamento/planejamento-detail/RevendaSetores";'; cat .superpowers/f30/anchor.txt; } > "$T/add/11-anchor.txt"
b 38 39 > "$T/del/12-i38-39.txt"
cp .superpowers/f30/t2/add/04-format.txt "$T/del/13-format.txt"
b 62 62 > "$T/del/14-i62.txt"
cat "$T/del/12-i38-39.txt" "$T/del/13-format.txt" "$T/del/14-i62.txt"
```

Esperado: os imports `NumberInput`, `MoneyInput`, `import { brl } from "@/lib/format";` e `varianteLabel`.

- [ ] **Step 2: Montar `RevendaSetores.tsx` e ligar no orquestrador**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f30-planejamento-detail"
T=.superpowers/f30/t7; D=src/components/planejamento/planejamento-detail; F=src/components/planejamento/PlanejamentoDetail.tsx
b() { .superpowers/f30/base.sh "$@"; }; troca() { node .superpowers/f30/troca.mjs "$@"; }
{ cat "$T/add/01-cabecalho.txt"; b 1951 2041; cat "$T/add/02-meio-pa.txt"; b 2082 2109; cat "$T/add/03-meio-grade.txt"; b 2116 2166; cat "$T/add/04-rodape.txt"; } > "$D/RevendaSetores.tsx"
b 1951 2041 > "$T/mov/01-preco.txt"
b 2082 2109 > "$T/mov/02-pa.txt"
b 2116 2166 > "$T/mov/03-grade.txt"
troca "$F" "$T/mov/01-preco.txt" "$T/add/05-uso-preco.txt"
troca "$F" "$T/mov/02-pa.txt" "$T/add/06-uso-pa.txt"
troca "$F" "$T/mov/03-grade.txt" "$T/add/07-uso-grade.txt"
troca "$F" "$T/del/08-lucide.txt" "$T/add/08-lucide.txt"
troca "$F" "$T/del/09-campos.txt" "$T/add/09-campos.txt"
troca "$F" "$T/del/10-desestrutura.txt" "$T/add/10-desestrutura.txt"
troca "$F" "$T/del/11-anchor.txt" "$T/add/11-anchor.txt"
troca "$F" "$T/del/12-i38-39.txt"
troca "$F" "$T/del/13-format.txt"
troca "$F" "$T/del/14-i62.txt"
grep -n "<PrecoRevendaBloco\|<ProdutoAcabadoSecao\|<GradeRevendaSecao" "$F"
grep -n "^export function" "$D/RevendaSetores.tsx"
```

Esperado:
- 10× `ok: …`.
- 3 usos no orquestrador, na ordem Preço → Produto Acabado → Grade.
- 3 `export function` no arquivo novo.

- [ ] **Step 3: Prova + gates**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f30-planejamento-detail"
.superpowers/f30/confere.sh HEAD .superpowers/f30/t7
grep -c "queryKey" .superpowers/f30/t7/add/* ; git status --porcelain -- src/components/desenvolvimento src/lib supabase src/routes tests
.superpowers/f30/gates.sh t7 7 .superpowers/f30/unused-esperado-B.txt
```

Esperado: `EQUIVALENTE — …`, contagens `0`, `status` vazio e `GATES OK (t7)`.

- [ ] **Step 4: Commit**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f30-planejamento-detail"
git add -- src/components/planejamento/planejamento-detail/RevendaSetores.tsx src/components/planejamento/PlanejamentoDetail.tsx
git commit --only -m "$(cat <<'EOF'
refactor(planejamento): F3.0 (7/8) — JSX da revenda em planejamento-detail/RevendaSetores.tsx

Preço revenda (markups + preços fixos), seção Produto Acabado e grade cor×tamanho movidos sem
mudança (texto do commit-base; prova confere.sh) para 3 componentes de nível de módulo que recebem
`rv` (useRevendaPlanejamento) e desestruturam com os mesmos nomes.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)" -- src/components/planejamento/planejamento-detail/RevendaSetores.tsx src/components/planejamento/PlanejamentoDetail.tsx
```

---

### Task 8: `usePlanejamentoSave.ts` — o Salvar e o retry/merge do P0409

**Files:**
- Create: `src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts`.
- Modify: `PlanejamentoDetail.tsx`:
  - troca as linhas do BASE 1278-1583 (`save` + linha vazia + `handleSave`) pela chamada do hook;
  - tira `limparCustoSim` do import de `helpers`;
  - remove o import de `sync-tecidos`;
  - acrescenta o import antes da âncora.

**Interfaces:**
- Consumes:
  - Task 3: `limparCustoSim` e `t3/partes/i-helpers.txt`.
  - Task 4: `syncTecidosToDesenvolvimento` e `t4/partes/i-sync.txt`.
  - Task 6/7: no orquestrador, `gradeRevenda`, `setGradeRevenda`, `gradeRevendaDirty`, `gradeRevendaBaseRef`, `gradeRevendaRevRef` e `buildLinhasGradeRevenda`.
  - Refs e estados do colab/MO que já existem no orquestrador (:557-621, :1112-1114).
- Produces:

```ts
export type UsePlanejamentoSaveArgs = {
  modeloId: string | null; isEdit: boolean; isRevenda: boolean; paOn: boolean;
  podeEditarPreco: boolean; podeVerCustos: boolean; categorias: CatOpt[];
  draft: Draft; setDraft: Dispatch<SetStateAction<Draft>>; draftLiveRef: RefObject<Draft>;
  touchedRef: RefObject<Set<string>>; baseRef: RefObject<{ draft: Draft } | null>;
  revRef: RefObject<number | null>; retryRef: RefObject<boolean>; savingRef: RefObject<boolean>;
  conflitosRef: RefObject<Conflito[]>; setConflitos: Dispatch<SetStateAction<Conflito[]>>;
  setUltimoMerge: Dispatch<SetStateAction<{ atualizados: number; conflitos: Conflito[] } | null>>;
  setEnviada: Dispatch<SetStateAction<boolean>>; setLancado: Dispatch<SetStateAction<boolean>>;
  markClean: () => void;
  moLinhas: MaoObraEditorLinha[]; moLinhasRef: RefObject<MaoObraEditorLinha[]>;
  moBaseRef: RefObject<MaoObraEditorLinha[]>; setMoLinhasBase: Dispatch<SetStateAction<MaoObraEditorLinha[]>>;
  gradeRevenda: Record<number, Record<string, number>>;
  setGradeRevenda: Dispatch<SetStateAction<Record<number, Record<string, number>>>>;
  gradeRevendaDirty: boolean; gradeRevendaBaseRef: RefObject<string>; gradeRevendaRevRef: RefObject<number | null>;
  buildLinhasGradeRevenda: () => { variante_numero: number; grades: Record<string, number>; grade_total: number }[];
  qc: QueryClient; onSaved: () => void;
};
export function usePlanejamentoSave(args: UsePlanejamentoSaveArgs): { save: UseMutationResult<…>; handleSave: () => void };
```

  O retry do P0409 continua chamando `save.mutate` de dentro do próprio `onError` (mesma closure de antes).

- [ ] **Step 1: Partes novas**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f30-planejamento-detail"
T=.superpowers/f30/t8; mkdir -p "$T/add" "$T/del" "$T/mov"
cat > "$T/add/01-cabecalho.txt" <<'EOF'
// Salvar do detalhe do Planejamento (header `modelos` com rev otimista + grade de revenda + MO por
// serviço + auto-criação do Produto Acabado) e o retry/merge do P0409. Extraído na F3.0 (set/2026) de
// `PlanejamentoDetail.tsx` SEM mudança de comportamento: o corpo abaixo é o texto MOVIDO como estava
// (mesmas chamadas, mesma ordem, mesmas queryKeys). Refs e estados continuam sendo do orquestrador e
// chegam por argumento com os MESMOS nomes (refs como OBJETO — o retry lê `.current` na hora). A F3.2
// reescreve aqui a cadeia de gravação (UPDATE → salvar_modelo_bom → etiquetas → MO → marcar_revisao).
import type { Dispatch, RefObject, SetStateAction } from "react";
import { useMutation, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { supabase } from "@/integrations/supabase/client";
import { mergeDraft, type Conflito } from "@/lib/colab/merge";
import { moLinhasEqual } from "@/lib/mao-obra";
import { type MaoObraEditorLinha } from "@/components/planejamento/MaoObraEditor";
import { numOr0, draftFromModeloRow, type CatOpt, type Draft } from "@/components/planejamento/modelo-shared";
import { limparCustoSim } from "@/components/planejamento/planejamento-detail/helpers";
import { syncTecidosToDesenvolvimento } from "@/components/planejamento/planejamento-detail/sync-tecidos";

export type UsePlanejamentoSaveArgs = {
  modeloId: string | null;
  isEdit: boolean;
  isRevenda: boolean;
  paOn: boolean;
  podeEditarPreco: boolean;
  podeVerCustos: boolean;
  categorias: CatOpt[];
  draft: Draft;
  setDraft: Dispatch<SetStateAction<Draft>>;
  draftLiveRef: RefObject<Draft>;
  touchedRef: RefObject<Set<string>>;
  baseRef: RefObject<{ draft: Draft } | null>;
  revRef: RefObject<number | null>;
  retryRef: RefObject<boolean>;
  savingRef: RefObject<boolean>;
  conflitosRef: RefObject<Conflito[]>;
  setConflitos: Dispatch<SetStateAction<Conflito[]>>;
  setUltimoMerge: Dispatch<SetStateAction<{ atualizados: number; conflitos: Conflito[] } | null>>;
  setEnviada: Dispatch<SetStateAction<boolean>>;
  setLancado: Dispatch<SetStateAction<boolean>>;
  markClean: () => void;
  moLinhas: MaoObraEditorLinha[];
  moLinhasRef: RefObject<MaoObraEditorLinha[]>;
  moBaseRef: RefObject<MaoObraEditorLinha[]>;
  setMoLinhasBase: Dispatch<SetStateAction<MaoObraEditorLinha[]>>;
  gradeRevenda: Record<number, Record<string, number>>;
  setGradeRevenda: Dispatch<SetStateAction<Record<number, Record<string, number>>>>;
  gradeRevendaDirty: boolean;
  gradeRevendaBaseRef: RefObject<string>;
  gradeRevendaRevRef: RefObject<number | null>;
  buildLinhasGradeRevenda: () => { variante_numero: number; grades: Record<string, number>; grade_total: number }[];
  qc: QueryClient;
  onSaved: () => void;
};

export function usePlanejamentoSave({
  modeloId, isEdit, isRevenda, paOn, podeEditarPreco, podeVerCustos, categorias,
  draft, setDraft, draftLiveRef,
  touchedRef, baseRef, revRef, retryRef, savingRef, conflitosRef, setConflitos, setUltimoMerge,
  setEnviada, setLancado, markClean,
  moLinhas, moLinhasRef, moBaseRef, setMoLinhasBase,
  gradeRevenda, setGradeRevenda, gradeRevendaDirty, gradeRevendaBaseRef, gradeRevendaRevRef, buildLinhasGradeRevenda,
  qc, onSaved,
}: UsePlanejamentoSaveArgs) {
EOF
cat > "$T/add/02-rodape.txt" <<'EOF'

  return { save, handleSave };
}
EOF
cat > "$T/add/03-uso.txt" <<'EOF'
  // Salvar (+ retry/merge do P0409) — extraído na F3.0 para `planejamento-detail/usePlanejamentoSave.ts`
  // (texto movido; os refs/estados abaixo continuam daqui e vão com os MESMOS nomes).
  const { save, handleSave } = usePlanejamentoSave({
    modeloId, isEdit, isRevenda, paOn, podeEditarPreco, podeVerCustos, categorias,
    draft, setDraft, draftLiveRef,
    touchedRef, baseRef, revRef, retryRef, savingRef, conflitosRef, setConflitos, setUltimoMerge,
    setEnviada, setLancado, markClean,
    moLinhas, moLinhasRef, moBaseRef, setMoLinhasBase,
    gradeRevenda, setGradeRevenda, gradeRevendaDirty, gradeRevendaBaseRef, gradeRevendaRevRef, buildLinhasGradeRevenda,
    qc, onSaved,
  });
EOF
cp .superpowers/f30/t3/partes/i-helpers.txt "$T/del/04-helpers.txt"
printf '%s\n' 'import { rotuloConflitoPlan, invalidarAposAprovarMO } from "@/components/planejamento/planejamento-detail/helpers";' > "$T/add/04-helpers.txt"
cp .superpowers/f30/t4/partes/i-sync.txt "$T/del/05-sync.txt"
cp .superpowers/f30/anchor.txt "$T/del/06-anchor.txt"
{ printf '%s\n' 'import { usePlanejamentoSave } from "@/components/planejamento/planejamento-detail/usePlanejamentoSave";'; cat .superpowers/f30/anchor.txt; } > "$T/add/06-anchor.txt"
```

- [ ] **Step 2: Montar o hook e ligar no orquestrador**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f30-planejamento-detail"
T=.superpowers/f30/t8; D=src/components/planejamento/planejamento-detail; F=src/components/planejamento/PlanejamentoDetail.tsx
b() { .superpowers/f30/base.sh "$@"; }; troca() { node .superpowers/f30/troca.mjs "$@"; }
{ cat "$T/add/01-cabecalho.txt"; b 1278 1577; echo; b 1579 1583; cat "$T/add/02-rodape.txt"; } > "$D/usePlanejamentoSave.ts"
b 1278 1583 > "$T/mov/01-save.txt"
head -1 "$T/mov/01-save.txt"; tail -1 "$T/mov/01-save.txt"
troca "$F" "$T/mov/01-save.txt" "$T/add/03-uso.txt"
troca "$F" "$T/del/04-helpers.txt" "$T/add/04-helpers.txt"
troca "$F" "$T/del/05-sync.txt"
troca "$F" "$T/del/06-anchor.txt" "$T/add/06-anchor.txt"
grep -n "usePlanejamentoSave({\|save.isPending\|handleSave" "$F"
```

Esperado:
- `  const save = useMutation({` / `  };` (o fim de `handleSave`).
- 4× `ok: …`.
- `usePlanejamentoSave({` aparece 1×, e `onClick={handleSave} disabled={save.isPending}` continua no rodapé.

- [ ] **Step 3: Prova + gates**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f30-planejamento-detail"
.superpowers/f30/confere.sh HEAD .superpowers/f30/t8
grep -c "queryKey" .superpowers/f30/t8/add/* ; git status --porcelain -- src/components/desenvolvimento src/lib supabase src/routes tests
.superpowers/f30/gates.sh t8 7 .superpowers/f30/unused-esperado-B.txt
```

Esperado: `EQUIVALENTE — …`, contagens `0`, `status` vazio e `GATES OK (t8)`.

- [ ] **Step 4: Commit**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f30-planejamento-detail"
git add -- src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts src/components/planejamento/PlanejamentoDetail.tsx
git commit --only -m "$(cat <<'EOF'
refactor(planejamento): F3.0 (8/8) — Salvar + retry/merge P0409 em planejamento-detail/usePlanejamentoSave.ts

Mutation `save` e `handleSave` movidos sem mudança (texto do commit-base; prova confere.sh). Refs e
estados do colab/MO/grade continuam do orquestrador e chegam por argumento com os mesmos nomes; o
hook é chamado no mesmo ponto do render. Ponto de entrada do save unificado da F3.2.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
)" -- src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts src/components/planejamento/PlanejamentoDetail.tsx
```

---

### Task 9: Prova final de equivalência + QA A/B no navegador (só leitura)

**Files:**
- Create (NÃO commitar; apagar na Task 11): `tests/e2e/f30-qa.spec.ts`.
- Saídas (ignoradas): `.superpowers/f30/qa/pre/{A.json,B.json,A-*.html,B-*.html,*.png}`, `.superpowers/f30/total/`.

**Interfaces:**
- Consumes: Tasks 0–8 (8 commits na worktree).
- Produces:
  - Veredito objetivo: `confere` total EQUIVALENTE; DOM do Sheet A ≡ B em até 7 telas (`interno`, `revenda`, `novo`, `conflito`, `revenda-cascata`, `interno-390`, `revenda-390`); requisições de escrita (simuladas, com o corpo) A ≡ B; 0 violação (nenhuma escrita real, nem no Supabase nem na origem do app).
  - `A.json`, que é a referência do smoke pós-merge da Task 11.

**Por que A/B e por que `:5199`:** o `:5173` do dono serve o checkout PRINCIPAL, isto é, o código ANTES. Os caminhos da F1 e da F2 não chegam ao Sheet:
- a F1 só mexe em `src/lib/kanban-*`, `tests/*` e `supabase/*`;
- a F2 mexe nos caminhos listados em Global Constraints → "Ordem com a F2". Mesmo assim, um commit dela muda o código "antes" e exige a sequência (b).

O código DEPOIS só existe na worktree, então sobe um 2º vite nela, em `:5199`. Os dois apontam para o mesmo banco e a mesma loja, então tudo o que o Sheet mostra e tenta gravar tem de ser idêntico. `E2E_BASE_URL` fica explícito (o default é PRODUÇÃO); o spec usa URLs absolutas por lado.

- [ ] **Step 1: Pré-condição do A/B — o código "antes" do `:5173` difere da base da worktree só fora do Sheet; sem WIP da F2; sem E2E da F2 rodando**

```bash
MAIN="/Users/sunglee/PLM + Criação/plm-pcp"
WT="$MAIN/.claude/worktrees/f30-planejamento-detail"
MB=$(git -C "$WT" merge-base HEAD feature/plan-tecido-a1)
echo "-- (1) commits em src desde a base da worktree, fora do que a F1 mexe:"
git -C "$MAIN" diff --stat "$MB" HEAD -- src ':(exclude)src/lib/kanban-*'
echo "-- (2) commits da F2 em src/lib/kanban-auto-*:"
git -C "$MAIN" diff --stat "$MB" HEAD -- 'src/lib/kanban-auto-*'
echo "-- (3) WIP em src fora do que a F1 mexe:"
git -C "$MAIN" status --porcelain -- src ':(exclude)src/lib/kanban-*'
echo "-- (4) WIP da F2 em src/lib/kanban-auto-*:"
git -C "$MAIN" status --porcelain -- 'src/lib/kanban-auto-*'
echo "-- (5) E2E da F2 rodando:"
ps -Ao pid,command | grep -F "kanban-auto.spec" | grep -v grep
echo "checagem-f2-fim"
curl -s -o /dev/null -w 'A(:5173) http=%{http_code}\n' http://localhost:5173/
```

Esperado: nada abaixo dos 5 cabeçalhos, `checagem-f2-fim` e `http=` diferente de `000`.

Conforme o que aparecer (Global Constraints → "Ordem com a F2"):
- **(3) ou (4) com saída:** há alteração não commitada no checkout principal (R1c). PARE: o A não é fotografado assim. Avise o orquestrador e espere o executor commitar; depois repita este Step.
- **(5) com saída:** o E2E da F2 está rodando (R1d). Espere ele terminar, sem matar nada, e repita este Step.
- **(1) ou (2) com saída:** a F2 (ou outra mudança) já commitou em `src/` (R1b). Siga a sequência (b):
  1. Task 11 Steps 2-3;
  2. se o vite B já estiver no ar, reinicie-o (Step 7, só a parte do B, e depois Step 3);
  3. volte a ESTE Step, que agora tem de sair limpo, e siga com os Steps 2-6;
  4. Task 10;
  5. Task 11 Step 1 e Step 4.

**Vite A de reserva em `:5198`.** Só se `:5173` estiver fora do ar (`http=000`). Não suba nada no lugar do vite do dono, nem na porta dele.

Primeiro confira a porta:

```bash
lsof -nP -iTCP:5198 -sTCP:LISTEN; echo "porta-5198-checada"
```

Esperado: só `porta-5198-checada`. Se a porta estiver ocupada, PARE: não mate nada.

Depois rode com `run_in_background: true`. O `cwd` é o checkout PRINCIPAL, porque o lado A é o código ANTES:

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp" && npx vite dev --port 5198 --strictPort > "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f30-planejamento-detail/.superpowers/f30/logs/vite-5198.log" 2>&1
```

Então anote o PID. Ele é o ÚNICO processo que o Step 7 pode encerrar na `:5198`:

```bash
WT="/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f30-planejamento-detail"
curl -s -o /dev/null --retry 40 --retry-connrefused --retry-delay 2 -w 'A-reserva(:5198) http=%{http_code}\n' http://localhost:5198/
PID_A=$(lsof -nP -iTCP:5198 -sTCP:LISTEN -t | head -1)
lsof -a -p "$PID_A" -d cwd -Fn | grep '^n' | grep -v worktrees | grep -q 'plm-pcp$' \
  && echo "$PID_A" > "$WT/.superpowers/f30/vite-5198.pid" \
  && echo "vite A reserva: PID $PID_A (cwd = checkout principal) anotado em .superpowers/f30/vite-5198.pid"
```

Esperado: `http=` diferente de `000` e a linha `anotado`. Se o PID não for anotado, PARE: não sabemos quem escuta a `:5198`.

Com a reserva, use `F30_A=http://localhost:5198` no Step 5, no lugar de `F30_A=http://localhost:5173`.

- [ ] **Step 2: Prova final contra o BASE (as 8 tarefas somadas)**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f30-planejamento-detail"
BASE=$(cat .superpowers/f30/BASE)
# MB = ponto onde os 8 commits da F3.0 se apoiam: = BASE antes de rebase; = ponta da branch depois
# do rebase da sequência (b). Assim o diff de arquivos não conta os commits da F1/F2 trazidos pelo rebase.
MB=$(git merge-base HEAD feature/plan-tecido-a1)
mkdir -p .superpowers/f30/total/add .superpowers/f30/total/del
for t in t1 t2 t3 t4 t5 t6 t7 t8; do for k in add del; do
  find ".superpowers/f30/$t/$k" -type f | while IFS= read -r f; do cp "$f" ".superpowers/f30/total/$k/$t-$(basename "$f")"; done
done; done
.superpowers/f30/confere.sh "$BASE" .superpowers/f30/total
git diff --name-only "$MB" HEAD | LC_ALL=C sort
grep -n "^export" src/components/planejamento/PlanejamentoDetail.tsx
git diff --stat "$MB" HEAD -- src/routes src/components/produto-acabado src/components/desenvolvimento src/lib src/hooks supabase tests/integration tests/fixtures
diff <(git show "$BASE:src/components/planejamento/PlanejamentoDetail.tsx" | grep -o 'queryKey: \[[^]]*\]' | LC_ALL=C sort) \
     <(cat src/components/planejamento/PlanejamentoDetail.tsx src/components/planejamento/planejamento-detail/* | grep -o 'queryKey: \[[^]]*\]' | LC_ALL=C sort) && echo "queryKeys idênticas"
wc -l src/components/planejamento/PlanejamentoDetail.tsx src/components/planejamento/planejamento-detail/*
```

Esperado:
- `EQUIVALENTE — …`.
- `diff --name-only` com EXATAMENTE 10 arquivos:
  - `src/components/planejamento/PlanejamentoDetail.tsx`
  - os 8 de `planejamento-detail/`: `InfoGeraisSecao.tsx`, `PrecoTabela.tsx`, `RevendaSetores.tsx`, `campos.tsx`, `helpers.ts`, `sync-tecidos.ts`, `usePlanejamentoSave.ts`, `useRevendaPlanejamento.ts`
  - `tests/unit/planejamento-detail-helpers.test.ts`
- 2 linhas de `export` (a re-exportação e `export function PlanejamentoDetail({`).
- `diff --stat` vazio.
- `queryKeys idênticas`.
- O orquestrador com cerca de 1150–1200 linhas.

- [ ] **Step 3: Subir o vite B (código DEPOIS) em `:5199`, na worktree**

```bash
lsof -nP -iTCP:5199 -sTCP:LISTEN; echo "porta-5199-checada"
```

Esperado: só `porta-5199-checada`. Se a porta estiver ocupada, PARE: não mate nada.

Depois rode com `run_in_background: true` (é ele que você vai encerrar no Step 7):

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f30-planejamento-detail" && npx vite dev --port 5199 --strictPort > .superpowers/f30/logs/vite-5199.log 2>&1
```

E confira (sem `sleep`: o `curl` tenta sozinho):

```bash
curl -s -o /dev/null --retry 40 --retry-connrefused --retry-delay 2 -w 'B(:5199) http=%{http_code}\n' http://localhost:5199/
tail -5 "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f30-planejamento-detail/.superpowers/f30/logs/vite-5199.log"
```

Esperado: `http=` diferente de `000`.

Se o vite B não subir, por exemplo por conflito de porta do inspector do `@cloudflare/vite-plugin` com o vite do dono, registre o erro do log e use o **plano B em dois tempos**:
- agora, rode o Step 5 só com `F30_LADOS=A` (fotografa o código ANTES no `:5173`);
- depois do merge (Task 11, Step 5), rode com `F30_LADOS=B` no `:5173`, comparando com esse `A.json`.

- [ ] **Step 4: Escrever o spec do QA A/B (arquivo NÃO versionado)**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f30-planejamento-detail"
cat > tests/e2e/f30-qa.spec.ts <<'EOF'
// tests/e2e/f30-qa.spec.ts — QA A/B da F3.0 (refactor do PlanejamentoDetail).
// NÃO COMMITAR: existe só na worktree da F3.0 e é apagado na Task 11 do plano
// docs/superpowers/plans/2026-09-23-planejamento-unificado-f30-refactor.md.
//
// A = código ANTES da F3.0 · B = código DEPOIS. Mesmo banco (o app local aponta para PRODUÇÃO), mesma
// loja, mesmos cards ⇒ o DOM do Sheet, as flags e as requisições de escrita têm de ser IDÊNTICOS.
// SÓ LEITURA: toda escrita no Supabase é BARRADA (vira violação e o teste falha) ou SIMULADA aqui
// (respondida pelo próprio teste com `route.fulfill` — nunca chega ao banco). Passam: login
// (/auth/v1), URL assinada de imagem (/storage/v1/object/sign), GETs e as RPCs de LEITURA abaixo.
// Na ORIGEM DO APP (o próprio vite), toda requisição NÃO-GET é BARRADA e vira violação: as server
// fns do TanStack Start (`/_serverFn/…`, todas `method: "POST"`) rodam com service role e gravariam
// em PRODUÇÃO por fora do supabase-js.
// Único efeito inerente, sem dado de loja: cada login grava `last_sign_in_at` e refresh token no Auth.
//
// Variáveis: F30_LADOS = "AB" (padrão) | "A" | "B" · F30_A / F30_B = URLs dos dois apps ·
// F30_OUT = pasta de saída · F30_REF_DIR = pasta com o A.json de uma rodada anterior (F30_LADOS="B").
import { test, expect, type Browser, type Locator, type Page, type Request, type Route } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { doLogin } from "./_helpers";

const LADOS = process.env.F30_LADOS ?? "AB";
const URL_A = process.env.F30_A ?? "http://localhost:5173";
const URL_B = process.env.F30_B ?? "http://localhost:5199";
const OUT = path.resolve(process.env.F30_OUT ?? ".superpowers/f30/qa/pre");
const REF_DIR = path.resolve(process.env.F30_REF_DIR ?? OUT);
const LOJA = "Loja Teste";
const SUPA_HOST = new URL(process.env.VITE_SUPABASE_URL ?? "https://sem-supabase.invalid").host;
const FAKE_ID = "00000000-0000-4000-8000-00000000f300";
const FAKE_PA_ID = "00000000-0000-4000-8000-00000000f301";
const NOME_OUTRO = "Alterado por outra pessoa (QA F3.0)";
const AVISO_PA_CRIADO = "Produto acabado criado e vinculado.";

// RPCs de LEITURA liberadas (conferidas nas migrations em 23/set: sem INSERT/UPDATE/DELETE). Qualquer
// outra RPC é BARRADA e vira violação. Para liberar uma nova, confirme ANTES que é só leitura:
//   grep -l -E "FUNCTION (public\.)?<nome>\(" supabase/migrations/*.sql | sort | tail -1   → ler o corpo
const READ_RPCS = new Set([
  "custo_unitario_modelos", "modelo_mo_resumo", "estoque_tecido_por_artigo", "otb_orcamento",
  "sidebar_badges", "minhas_permissoes_efetivas", "get_user_tenant_id", "meu_tenant_ativo",
  "modelos_mo_a_aprovar_count",
]);

type Ids = { interno: string; revenda: string | null };
type Gravada = { metodo: string; caminho: string; corpo: unknown };
type Fake = { casa: (metodo: string, u: URL) => boolean; responde: (route: Route) => Promise<void> };
type Resultado = {
  lado: string; ids: Ids; dumps: Record<string, string>; flags: Record<string, unknown>;
  gravadas: Gravada[]; violacoes: string[]; errosPagina: string[]; rpcsLidas: string[];
};

class Lado {
  nome: string;
  base: string;
  gravadas: Gravada[] = [];
  violacoes: string[] = [];
  errosPagina: string[] = [];
  rpcsLidas = new Set<string>();
  fakes: Fake[] = [];
  dumps: Record<string, string> = {};
  flags: Record<string, unknown> = {};
  constructor(nome: string, base: string) { this.nome = nome; this.base = base; }
}

function caminho(u: URL): string {
  const q = [...u.searchParams.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`).join("&");
  return q ? `${u.pathname}?${q}` : u.pathname;
}
function corpo(req: Request): unknown {
  try { return req.postDataJSON(); } catch { return req.postData(); }
}
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function novaPagina(browser: Browser, lado: Lado, viewport: { width: number; height: number }, conferirLoja: boolean) {
  const ctx = await browser.newContext({ baseURL: lado.base, viewport });
  // GUARDA DE ESCRITA — tudo que vai ao Supabase passa por aqui.
  await ctx.route((u) => u.host === SUPA_HOST, async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const metodo = req.method();
    const p = u.pathname;
    if (p.startsWith("/auth/v1/") || p.startsWith("/storage/v1/object/sign/")) return route.continue();
    const fake = lado.fakes.find((f) => f.casa(metodo, u));
    if (p.startsWith("/rest/v1/rpc/")) {
      const nome = p.slice("/rest/v1/rpc/".length);
      if (READ_RPCS.has(nome)) { lado.rpcsLidas.add(nome); return route.continue(); }
    } else if (metodo === "GET" || metodo === "HEAD") {
      return fake ? fake.responde(route) : route.continue();
    }
    if (fake) {
      lado.gravadas.push({ metodo, caminho: caminho(u), corpo: corpo(req) });
      return fake.responde(route);
    }
    lado.violacoes.push(`${metodo} ${caminho(u)}`);
    return route.abort("blockedbyclient");
  });
  // GUARDA DA ORIGEM DO APP (G-plano R4) — GET/HEAD (páginas, módulos do vite, o submit nativo do
  // login antes da hidratação, que é GET porque o <form> não tem `method`) passam; qualquer outro
  // método (ex.: POST /_serverFn/… — setActiveTenant e afins, service role) é BARRADO e vira violação.
  const origemApp = new URL(lado.base).origin;
  await ctx.route((u) => u.origin === origemApp, async (route) => {
    const req = route.request();
    const metodo = req.method();
    if (metodo === "GET" || metodo === "HEAD") return route.continue();
    lado.violacoes.push(`APP ${metodo} ${caminho(new URL(req.url()))}`);
    return route.abort("blockedbyclient");
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => lado.errosPagina.push(String(e?.message ?? e)));
  await doLogin(page);
  if (conferirLoja) {
    const loja = page.locator('div:has(> div:has-text("Loja em visualização"))').getByRole("combobox").first();
    await expect(loja, `Loja ativa do usuário E2E ≠ "${LOJA}". PARE: o robô NÃO troca de loja (grava users.tenant_id em PRODUÇÃO) — peça ao dono.`)
      .toContainText(LOJA, { timeout: 15_000 });
  }
  return { ctx, page };
}

async function idsDaLista(page: Page): Promise<Ids> {
  const resp = page.waitForResponse((r) => {
    const u = new URL(r.url());
    return u.host === SUPA_HOST && u.pathname === "/rest/v1/modelos" && r.request().method() === "GET"
      && (u.searchParams.get("select") ?? "").startsWith("id,nome,ref,ref_auto,");
  }, { timeout: 60_000 });
  await page.goto("/criacao/planejamento", { waitUntil: "networkidle" });
  const linhas = (await (await resp).json()) as { id: string; nome: string | null; origem: string | null }[];
  const ordenadas = [...linhas].sort((a, b) => (a.nome ?? "").localeCompare(b.nome ?? "") || a.id.localeCompare(b.id));
  const interno = ordenadas.find((m) => (m.origem ?? "interno") === "interno");
  const revenda = ordenadas.find((m) => m.origem === "revenda");
  if (!interno) throw new Error(`"${LOJA}" não tem card interno na lista do Planejamento — nada a comparar.`);
  return { interno: interno.id, revenda: revenda?.id ?? null };
}

async function abrirCard(page: Page, id: string) {
  await page.goto(`/criacao/planejamento?modelo=${id}`, { waitUntil: "networkidle" });
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState("networkidle").catch(() => {});
}
async function abrirNovo(page: Page) {
  await page.goto("/criacao/planejamento", { waitUntil: "networkidle" });
  await page.locator("button:visible", { hasText: "Novo Modelo" }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 15_000 });
}
async function expandirTudo(page: Page) {
  const dlg = page.getByRole("dialog");
  for (let i = 0; i < 40; i++) {
    const fechada = dlg.locator('section > button[aria-expanded="false"]').first();
    if ((await fechada.count()) === 0) return;
    await fechada.click();
    await page.waitForLoadState("networkidle").catch(() => {});
  }
  throw new Error("mais de 40 seções recolhidas — algo está errado");
}
// Fotografa o DOM do Sheet (normaliza ids gerados e query de URL assinada), exige 2 leituras iguais.
async function dump(page: Page, lado: Lado, nome: string) {
  let anterior = "";
  for (let i = 0; i < 8; i++) {
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(800);
    const atual = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      if (!dlg) return "";
      const c = dlg.cloneNode(true) as Element;
      const ID = /«[^»]*»|:r[0-9a-z]+:|_r_[0-9a-z]+_|radix-[A-Za-z0-9_:«»-]+/g;
      c.querySelectorAll("*").forEach((n) => {
        for (const a of Array.from(n.attributes)) {
          const v = a.name === "src" || a.name === "href" ? a.value.split("?")[0] : a.value.replace(ID, "ID");
          if (v !== a.value) n.setAttribute(a.name, v);
        }
      });
      return c.outerHTML.replace(ID, "ID").replace(/></g, ">\n<");
    });
    if (atual && atual === anterior) {
      fs.writeFileSync(path.join(OUT, `${lado.nome}-${nome}.html`), atual);
      await page.screenshot({ path: path.join(OUT, `${lado.nome}-${nome}.png`), fullPage: true });
      lado.dumps[nome] = atual;
      return;
    }
    anterior = atual;
  }
  throw new Error(`DOM do Sheet não estabilizou (${lado.nome}-${nome})`);
}
// Fecha pelo Voltar; se aparecer "Descartar alterações?", descarta. Devolve se o diálogo apareceu.
async function fechar(page: Page): Promise<boolean> {
  await page.getByRole("dialog").getByRole("button", { name: "Voltar" }).click();
  const alerta = page.getByRole("alertdialog");
  const pediu = await alerta.waitFor({ state: "visible", timeout: 1500 }).then(() => true, () => false);
  if (pediu) await alerta.getByRole("button", { name: "Descartar" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 10_000 });
  return pediu;
}
async function editarNome(page: Page) {
  const nome = page.getByRole("dialog").locator('input[data-colab-path="nome"]');
  await nome.fill(`${await nome.inputValue()} QA`);
}
async function salvar(page: Page) {
  await page.getByRole("dialog").getByRole("button", { name: "Salvar" }).click();
}
// Campo do Sheet pelo rótulo: o `<Label>` e o controle ficam no mesmo `<div className="grid gap-1">`
// (FieldSelect, markup, preço). `.first()` = a 1ª ocorrência no DOM (a seção 1 vem primeiro).
function comboPorRotulo(page: Page, rotulo: string): Locator {
  return page.getByRole("dialog").locator(`xpath=.//div[label[normalize-space(.)="${rotulo}"]]//*[@role="combobox"]`).first();
}
function campoPorRotulo(page: Page, rotulo: string): Locator {
  return page.getByRole("dialog").locator(`xpath=.//div[label[normalize-space(.)="${rotulo}"]]//input`).first();
}
async function textoCombo(page: Page, rotulo: string): Promise<string> {
  return ((await comboPorRotulo(page, rotulo).textContent()) ?? "").trim();
}
// Abre o Select e escolhe a 1ª opção cujo texto ≠ `evitar` (mesma ordem de lista em A e B ⇒ mesma
// escolha). Devolve o texto escolhido, ou "sem opção" (fecha com Escape, nada muda).
async function escolherOpcao(page: Page, rotulo: string, evitar: string): Promise<string> {
  await comboPorRotulo(page, rotulo).click();
  await page.getByRole("listbox").waitFor({ state: "visible", timeout: 5_000 });
  const textos = (await page.getByRole("option").allTextContents()).map((t) => t.trim());
  const alvo = textos.find((t) => t !== evitar);
  if (alvo === undefined) {
    await page.keyboard.press("Escape");
    return "sem opção";
  }
  await page.getByRole("option", { name: alvo, exact: true }).first().click();
  await expect(page.getByRole("listbox")).toHaveCount(0, { timeout: 5_000 });
  return alvo;
}
// Seção 1 — cascata Grupo → Categoria (o onChange do Grupo limpa Categoria/Subs se a categoria não
// pertence ao novo grupo; o da Categoria realinha o Grupo e zera as Subs). Devolve o que se viu.
async function trocarGrupoECategoria(page: Page): Promise<Record<string, string>> {
  const grupoAntes = await textoCombo(page, "Grupo");
  const grupo = await escolherOpcao(page, "Grupo", grupoAntes);
  const categoriaAposGrupo = await textoCombo(page, "Categoria");
  const categoria = await escolherOpcao(page, "Categoria", categoriaAposGrupo);
  return {
    grupoAntes, grupo, categoriaAposGrupo, categoria,
    grupoFinal: await textoCombo(page, "Grupo"),
    sub1Final: await textoCombo(page, "Subcategoria 1"),
    sub2Final: await textoCombo(page, "Subcategoria 2"),
  };
}
// Digita no campo e confirma com Enter (o onKeyDown faz blur → o onBlur grava). Devolve se a RPC saiu.
async function digitarEConfirmar(page: Page, campo: Locator, valor: string, rpc: string): Promise<boolean> {
  const saiu = page
    .waitForRequest((r) => new URL(r.url()).pathname === `/rest/v1/rpc/${rpc}`, { timeout: 5_000 })
    .then(() => true, () => false);
  await campo.click();
  await campo.fill(valor);
  await campo.press("Enter");
  const enviou = await saiu;
  await page.waitForTimeout(1_500); // deixa o onSuccess (invalidações → refetch) assentar
  return enviou;
}

// ---- respostas SIMULADAS (nada chega ao banco) ----
function fakeFilhas(): Fake {
  return {
    casa: (m, u) => m !== "GET" && m !== "HEAD" && (u.pathname === "/rest/v1/modelo_tecidos" || u.pathname === "/rest/v1/modelo_tecido_variantes"),
    responde: (r) => r.request().method() === "DELETE"
      ? r.fulfill({ status: 204, body: "" })
      : r.fulfill({ status: 201, contentType: "application/json", body: "[]" }),
  };
}
function fakePatchModelo(id: string, conflitoNaPrimeira: boolean, cont: { n: number }): Fake {
  return {
    casa: (m, u) => m === "PATCH" && u.pathname === "/rest/v1/modelos" && u.searchParams.get("id") === `eq.${id}`,
    responde: (r) => {
      cont.n += 1;
      const vazio = conflitoNaPrimeira && cont.n === 1; // 0 linhas = P0409 sintético do Planejamento
      return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(vazio ? [] : [{ id }]) });
    },
  };
}
function fakeRpcOk(nome: string): Fake {
  return {
    casa: (m, u) => m === "POST" && u.pathname === `/rest/v1/rpc/${nome}`,
    responde: (r) => r.fulfill({ status: 200, contentType: "application/json", body: "null" }),
  };
}
function fakeRpcValor(nome: string, valor: unknown): Fake {
  return {
    casa: (m, u) => m === "POST" && u.pathname === `/rest/v1/rpc/${nome}`,
    responde: (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(valor) }),
  };
}
// Leitura SIMULADA: "este modelo não tem produto acabado vinculado" (query ["pa-produto-modelo", id],
// `.maybeSingle()` sobre `[]` = null) — faz o botão "Criar produto acabado" aparecer mesmo quando o
// card revenda real tem produto. GET simulado não entra em `gravadas`.
function fakeSemProdutoVinculado(modeloId: string): Fake {
  return {
    casa: (m, u) => m === "GET" && u.pathname === "/rest/v1/produtos_acabados"
      && u.searchParams.get("modelo_id") === `eq.${modeloId}`,
    responde: (r) => r.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  };
}
// O vínculo produto←modelo do "Criar produto acabado" (`.update({ modelo_id }).eq("id", novoId)`).
function fakeVinculoProdutoAcabado(produtoId: string): Fake {
  return {
    casa: (m, u) => m === "PATCH" && u.pathname === "/rest/v1/produtos_acabados"
      && u.searchParams.get("id") === `eq.${produtoId}`,
    responde: (r) => r.fulfill({ status: 204, body: "" }),
  };
}
function fakeRecargaAlterada(id: string, cont: { n: number }): Fake {
  return {
    casa: (m, u) => m === "GET" && cont.n >= 1 && u.pathname === "/rest/v1/modelos"
      && u.searchParams.get("select") === "*" && u.searchParams.get("id") === `eq.${id}`,
    responde: async (r) => {
      const resp = await r.fetch();
      const dado = await resp.json();
      const alt = (x: any) => ({ ...x, nome: NOME_OUTRO, rev: (Number(x?.rev) || 0) + 1 });
      await r.fulfill({ response: resp, json: Array.isArray(dado) ? dado.map(alt) : alt(dado) });
    },
  };
}

async function rodarLado(browser: Browser, lado: Lado, idsDados: Ids | null): Promise<Resultado> {
  let { ctx, page } = await novaPagina(browser, lado, { width: 1366, height: 900 }, true);
  const ids = idsDados ?? (await idsDaLista(page));

  // D1–D3: só leitura — abrir, expandir todas as seções, fotografar o DOM, fechar.
  lado.fakes = [];
  await abrirCard(page, ids.interno);
  await expandirTudo(page);
  await dump(page, lado, "interno");
  lado.flags["interno:pediu-descartar"] = await fechar(page);
  if (ids.revenda) {
    await abrirCard(page, ids.revenda);
    await expandirTudo(page);
    await dump(page, lado, "revenda");
    lado.flags["revenda:pediu-descartar"] = await fechar(page);
  }
  await abrirNovo(page);
  await expandirTudo(page);
  await dump(page, lado, "novo");
  lado.flags["novo:pediu-descartar"] = await fechar(page);

  // S1: Salvar edição de card interno — UPDATE simulado com sucesso.
  const c1 = { n: 0 };
  lado.fakes = [fakePatchModelo(ids.interno, false, c1), fakeFilhas(), fakeRpcOk("salvar_modelo_servico_mo")];
  await abrirCard(page, ids.interno);
  await editarNome(page);
  await salvar(page);
  await expect(page.getByText("Modelo salvo").first()).toBeVisible({ timeout: 20_000 });
  lado.flags["salvar:patches"] = c1.n;
  lado.flags["salvar:pediu-descartar"] = await fechar(page);

  // S2: Conflito — 1º UPDATE volta 0 linhas (P0409) e a recarga traz o nome mudado por "outra pessoa".
  const c2 = { n: 0 };
  lado.fakes = [fakePatchModelo(ids.interno, true, c2), fakeRecargaAlterada(ids.interno, c2), fakeFilhas()];
  await abrirCard(page, ids.interno);
  await editarNome(page);
  await salvar(page);
  await expect(page.getByRole("dialog").getByText("usar o novo").first()).toBeVisible({ timeout: 20_000 });
  await dump(page, lado, "conflito");
  lado.flags["conflito:patches"] = c2.n;
  await page.getByRole("dialog").getByText("usar o novo").first().click();
  lado.flags["conflito:nome-apos-usar-o-novo"] = await page.getByRole("dialog").locator('input[data-colab-path="nome"]').inputValue();
  lado.flags["conflito:pediu-descartar"] = await fechar(page);

  // S3: Novo modelo — INSERT simulado.
  lado.fakes = [
    { casa: (m, u) => m === "POST" && u.pathname === "/rest/v1/modelos",
      responde: (r) => r.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: FAKE_ID }) }) },
    fakeFilhas(), fakeRpcOk("salvar_modelo_servico_mo"),
  ];
  await abrirNovo(page);
  await page.getByRole("dialog").locator('input[data-colab-path="nome"]').fill("QA F3.0 — não salvo");
  await salvar(page);
  await expect(page.getByText("Modelo salvo").first()).toBeVisible({ timeout: 20_000 });
  lado.flags["novo-salvar:pediu-descartar"] = await fechar(page);

  // S4: Revenda — grade + Salvar (só se o produto vinculado tiver variantes e tamanhos).
  if (ids.revenda) {
    const c4 = { n: 0 };
    lado.fakes = [fakeRpcOk("salvar_grade_revenda"), fakePatchModelo(ids.revenda, false, c4), fakeFilhas(), fakeRpcOk("salvar_modelo_servico_mo")];
    await abrirCard(page, ids.revenda);
    await expandirTudo(page);
    const cel = page.getByRole("dialog").locator('input[data-colab-path^="grade-revenda:"]').first();
    if ((await cel.count()) > 0) {
      await cel.fill("1");
      await salvar(page);
      await expect(page.getByText("Modelo salvo").first()).toBeVisible({ timeout: 20_000 });
      lado.flags["revenda-grade"] = `salvo (${c4.n} UPDATE)`;
    } else {
      lado.flags["revenda-grade"] = "pulado: produto sem variantes/tamanhos";
    }
    lado.flags["revenda-grade:pediu-descartar"] = await fechar(page);
  }

  // S5 (G-plano R3): revenda — código que MUDA DE LUGAR nas Tasks 5–7 e que S1–S4 não exercitam.
  // Tudo SIMULADO; o CORPO de cada requisição entra em `gravadas` e é comparado A≡B em `comparar`.
  if (ids.revenda) {
    // S5a: onBlur do markup (salvar_markups_produto_acabado) e preço FIXO (salvar_precos_fixo_produto_acabado).
    // Os campos só existem com produto vinculado; sem ele, registra "pulado" (igual em A e B).
    lado.fakes = [fakeRpcOk("salvar_markups_produto_acabado"), fakeRpcOk("salvar_precos_fixo_produto_acabado")];
    await abrirCard(page, ids.revenda);
    await expandirTudo(page);
    const markupAtacado = campoPorRotulo(page, "Markup atacado");
    if ((await markupAtacado.count()) > 0) {
      lado.flags["revenda-markup:enviou"] = await digitarEConfirmar(page, markupAtacado, "7,77", "salvar_markups_produto_acabado");
      lado.flags["revenda-preco-fixo:enviou"] = await digitarEConfirmar(page, campoPorRotulo(page, "Preço atacado"), "123,45", "salvar_precos_fixo_produto_acabado");
    } else {
      lado.flags["revenda-markup"] = "pulado: card revenda sem produto vinculado";
    }
    lado.flags["revenda-markup:pediu-descartar"] = await fechar(page);

    // S5b: seção 1 — troca Grupo → Categoria (cascata) e "Criar produto acabado"
    // (rpc/salvar_produto_acabado + PATCH produtos_acabados?id=eq.<novo>), com a leitura do produto
    // vinculado simulada como "nenhum". O onSuccess navega para /criacao/produto-acabado (contexto
    // "planejamento"); as leituras daquela tela passam pela mesma guarda (RPC fora de READ_RPCS = violação,
    // tratada como no Step 5). Se o grupo escolhido não tiver categoria, o aviso é o de validação
    // ("Defina Grupo e Categoria…"), sem requisição nenhuma — também igual em A e B.
    lado.fakes = [
      fakeSemProdutoVinculado(ids.revenda),
      fakeRpcValor("salvar_produto_acabado", FAKE_PA_ID),
      fakeVinculoProdutoAcabado(FAKE_PA_ID),
    ];
    await abrirCard(page, ids.revenda);
    await expandirTudo(page);
    lado.flags["cascata"] = await trocarGrupoECategoria(page);
    await dump(page, lado, "revenda-cascata");
    const criar = page.getByRole("dialog").getByRole("button", { name: "Criar produto acabado" });
    if ((await criar.count()) > 0) {
      await criar.click();
      const aviso = page.getByText(/Produto acabado criado e vinculado\.|Defina Grupo e Categoria/).first();
      await expect(aviso).toBeVisible({ timeout: 20_000 });
      lado.flags["criar-pa:aviso"] = ((await aviso.textContent()) ?? "").trim();
      if (lado.flags["criar-pa:aviso"] === AVISO_PA_CRIADO) {
        await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 15_000 });
        await page.waitForLoadState("networkidle").catch(() => {});
        lado.flags["criar-pa:rota"] = caminho(new URL(page.url()));
      } else {
        lado.flags["criar-pa:pediu-descartar"] = await fechar(page);
      }
    } else {
      lado.flags["criar-pa"] = "pulado: seção Produto Acabado ausente (módulo produto_acabado desligado)";
      lado.flags["criar-pa:pediu-descartar"] = await fechar(page);
    }
  }
  await ctx.close();
  await esperar(5_000); // a presença Realtime deste contexto sai antes do próximo

  // Mobile 390 px — só leitura.
  ({ ctx, page } = await novaPagina(browser, lado, { width: 390, height: 844 }, false));
  lado.fakes = [];
  await abrirCard(page, ids.interno);
  await expandirTudo(page);
  await dump(page, lado, "interno-390");
  lado.flags["interno-390:pediu-descartar"] = await fechar(page);
  if (ids.revenda) {
    await abrirCard(page, ids.revenda);
    await expandirTudo(page);
    await dump(page, lado, "revenda-390");
    lado.flags["revenda-390:pediu-descartar"] = await fechar(page);
  }
  await ctx.close();
  await esperar(5_000);

  return {
    lado: lado.nome, ids, dumps: lado.dumps, flags: lado.flags, gravadas: lado.gravadas,
    violacoes: lado.violacoes, errosPagina: lado.errosPagina, rpcsLidas: [...lado.rpcsLidas].sort(),
  };
}

function comparar(a: Resultado, b: Resultado) {
  console.log("[F3.0 QA] ids:", JSON.stringify(a.ids));
  console.log("[F3.0 QA] flags A:", JSON.stringify(a.flags));
  console.log("[F3.0 QA] flags B:", JSON.stringify(b.flags));
  console.log("[F3.0 QA] escritas simuladas A:", JSON.stringify(a.gravadas.map((g) => `${g.metodo} ${g.caminho}`)));
  console.log("[F3.0 QA] RPCs de leitura vistas A/B:", JSON.stringify(a.rpcsLidas), JSON.stringify(b.rpcsLidas));
  expect.soft(a.violacoes, "A tentou gravar algo NÃO previsto (foi barrado — nada chegou ao banco)").toEqual([]);
  expect.soft(b.violacoes, "B tentou gravar algo NÃO previsto (foi barrado — nada chegou ao banco)").toEqual([]);
  expect.soft(b.gravadas, "as escritas (simuladas) de B diferem das de A").toEqual(a.gravadas);
  expect.soft(b.flags, "flags de comportamento diferem").toEqual(a.flags);
  expect.soft(Object.keys(b.dumps).sort(), "conjunto de telas fotografadas difere").toEqual(Object.keys(a.dumps).sort());
  for (const k of Object.keys(a.dumps)) {
    expect.soft(b.dumps[k] === a.dumps[k], `DOM do Sheet difere em "${k}" — compare ${REF_DIR}/A-${k}.html com ${OUT}/B-${k}.html`).toBe(true);
  }
  expect.soft(b.errosPagina.filter((e) => !a.errosPagina.includes(e)), "erros de página que só B teve").toEqual([]);
  expect.soft(a.flags["salvar:patches"], "S1 deveria mandar 1 UPDATE").toBe(1);
  expect.soft(a.flags["conflito:patches"], "S2 não pode re-tentar com conflito pendente").toBe(1);
  expect.soft(a.flags["conflito:nome-apos-usar-o-novo"], "S2: 'usar o novo' deveria trazer o nome do servidor").toBe(NOME_OUTRO);
  if (a.ids.revenda) {
    console.log("[F3.0 QA] S5 A:", JSON.stringify({
      markup: a.flags["revenda-markup:enviou"] ?? a.flags["revenda-markup"],
      precoFixo: a.flags["revenda-preco-fixo:enviou"] ?? null,
      cascata: a.flags["cascata"], criar: a.flags["criar-pa:aviso"] ?? a.flags["criar-pa"],
      rota: a.flags["criar-pa:rota"] ?? null,
    }));
    const corposS5 = (r: Resultado) => r.gravadas.filter((g) =>
      /\/rpc\/salvar_(markups|precos_fixo)_produto_acabado$|\/rpc\/salvar_produto_acabado$|^\/rest\/v1\/produtos_acabados\?/.test(g.caminho));
    expect.soft(corposS5(b), "S5: corpo das escritas de revenda (markup/preço fixo/criar produto) difere A×B").toEqual(corposS5(a));
  }
}

test("F3.0 — Sheet do Planejamento: A (antes) × B (depois), só leitura", async ({ browser }) => {
  test.setTimeout(25 * 60_000);
  expect(SUPA_HOST, "VITE_SUPABASE_URL ausente — copie o .env do checkout principal para a worktree").not.toBe("sem-supabase.invalid");
  fs.mkdirSync(OUT, { recursive: true });
  let a: Resultado | null = null;
  if (LADOS.includes("A")) {
    a = await rodarLado(browser, new Lado("A", URL_A), null);
    fs.writeFileSync(path.join(OUT, "A.json"), JSON.stringify(a, null, 2));
    expect.soft(a.violacoes, "A tentou gravar algo NÃO previsto (barrado)").toEqual([]);
  }
  if (LADOS.includes("B")) {
    const ref: Resultado = a ?? JSON.parse(fs.readFileSync(path.join(REF_DIR, "A.json"), "utf8"));
    const b = await rodarLado(browser, new Lado("B", URL_B), ref.ids);
    fs.writeFileSync(path.join(OUT, "B.json"), JSON.stringify(b, null, 2));
    comparar(ref, b);
  }
});
EOF
git status --porcelain
```

Esperado: `?? tests/e2e/f30-qa.spec.ts` (e mais nada).

- [ ] **Step 5: Rodar o QA A/B**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f30-planejamento-detail"
E2E_BASE_URL=http://localhost:5199 F30_LADOS=AB F30_A=http://localhost:5173 F30_B=http://localhost:5199 \
F30_OUT=.superpowers/f30/qa/pre npx playwright test tests/e2e/f30-qa.spec.ts --retries=0 --reporter=list 2>&1 | tail -40
```

Com o vite A de reserva (Step 1), troque `F30_A=http://localhost:5173` por `F30_A=http://localhost:5198`.

Antes de rodar, repita a checagem (5) do Step 1: nenhum `kanban-auto.spec` rodando (R1d).

Esperado: `1 passed`.

Se falhar em "Loja ativa…", PARE e avise o dono: o usuário E2E tem de estar na "Loja Teste". O robô não troca de loja e o QA não segue.

Se falhar em `violacoes` com uma RPC de nome de leitura, confira na migration mais recente dela (o comando está no comentário do `READ_RPCS`):
- se for só leitura, acrescente em `READ_RPCS` e rode de novo;
- se gravar, deixe barrada, registre e PARE (o app tentou gravar ao só abrir o card, o que tem de ser igual em A e B e vai para o relatório).

Se falhar com uma violação `APP <método> …` (escrita na origem do app, por exemplo `/_serverFn/…`), NÃO libere. Ela foi barrada, então nada gravou. Registre qual tela e qual cenário a dispararam e PARE, avisando o orquestrador.

- [ ] **Step 6: Conferir os artefatos**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f30-planejamento-detail"
Q=.superpowers/f30/qa/pre
for f in "$Q"/A-*.html; do k=${f##*/A-}; cmp -s "$f" "$Q/B-$k" && echo "igual: $k" || echo "DIFERENTE: $k"; done
node -e 'const a=require(process.argv[1]),b=require(process.argv[2]);console.log(JSON.stringify({ids:a.ids,flagsIguais:JSON.stringify(a.flags)===JSON.stringify(b.flags),flags:a.flags,violA:a.violacoes,violB:b.violacoes,escritasA:a.gravadas.map(g=>g.metodo+" "+g.caminho),escritasIguais:JSON.stringify(a.gravadas)===JSON.stringify(b.gravadas),errosA:a.errosPagina,errosB:b.errosPagina},null,2))' "$PWD/$Q/A.json" "$PWD/$Q/B.json"
```

Esperado:
- `igual:` para `interno`, `novo`, `conflito`, `interno-390` e, se a loja tiver card revenda, `revenda`, `revenda-cascata`, `revenda-390`.
- `flagsIguais: true` e `escritasIguais: true`. O `escritasIguais` inclui o corpo das escritas de S5.
- `violA` e `violB` vazios, tanto no Supabase quanto `APP …`.
- Valores de referência das flags, iguais em A e B:
  - `salvar:patches = 1`, `conflito:patches = 1`;
  - `conflito:nome-apos-usar-o-novo = "Alterado por outra pessoa (QA F3.0)"`;
  - `conflito:pediu-descartar = true`;
  - S5 com produto vinculado: `revenda-markup:enviou = true` e `revenda-preco-fixo:enviou = true`. As escritas incluem `POST /rest/v1/rpc/salvar_markups_produto_acabado` (`_markup_atacado: 7.77`) e `POST /rest/v1/rpc/salvar_precos_fixo_produto_acabado` (`_tocar_atacado: true`, `_preco_atacado_fixo: 123.45`);
  - S5b: `cascata.grupo` ≠ `cascata.grupoAntes`, `cascata.sub1Final = cascata.sub2Final = "Selecione…"`. Com categoria escolhida: `criar-pa:aviso = "Produto acabado criado e vinculado."`, `criar-pa:rota` começando por `/criacao/produto-acabado`, e as escritas incluem `POST /rest/v1/rpc/salvar_produto_acabado` e `PATCH /rest/v1/produtos_acabados?id=eq.00000000-0000-4000-8000-00000000f301`;
  - `cascata:…`/`criar-pa:…` com "sem opção"/"pulado"/aviso de validação é aceitável se for IGUAL em A e B (loja sem grupo com categoria, ou módulo desligado); registre no relatório que aquele trecho não foi exercido;
  - os demais `pediu-descartar = false`, exceto `criar-pa:pediu-descartar = true` quando a criação cai no aviso de validação (a cascata deixou o rascunho sujo).

  Se alguma flag de referência diferir mas for IGUAL em A e B, é comportamento de hoje: registre, não é regressão.
- Olhe também 2–3 PNGs lado a lado (`A-revenda.png` × `B-revenda.png`, `A-revenda-cascata.png` × `B-revenda-cascata.png`).

- [ ] **Step 7: Encerrar SÓ o vite B (e o A de reserva em `:5198`, pelo PID anotado, se tiver sido usado)**

```bash
PID=$(lsof -nP -iTCP:5199 -sTCP:LISTEN -t | head -1)
lsof -a -p "$PID" -d cwd -Fn | grep -q "f30-planejamento-detail" && kill "$PID" && echo "vite 5199 (PID $PID, cwd = worktree) encerrado"
lsof -nP -iTCP:5199 -sTCP:LISTEN; lsof -nP -iTCP:5173 -sTCP:LISTEN -t
```

Esperado: `encerrado`, nada em `:5199`, e o PID do dono em `:5173` continua lá.

Se sobrar um processo `workerd` cujo `cwd` seja a worktree, encerre-o do mesmo jeito, conferindo o `cwd`. Nunca mate por nome.

**Só se o vite A de reserva (`:5198`) tiver sido usado.** Encerre SÓ o PID anotado no Step 1, e só se ele ainda for quem escuta `:5198`. O `cwd` dele é o mesmo do vite do dono (checkout principal), então aqui o `cwd` não distingue nada. Os filhos (por exemplo `workerd`) são listados pelo PID-pai ANTES do kill e encerrados só se continuarem vivos:

```bash
WT="/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f30-planejamento-detail"
F="$WT/.superpowers/f30/vite-5198.pid"
DONO=$(lsof -nP -iTCP:5173 -sTCP:LISTEN -t | head -1)
if [ -f "$F" ]; then
  PID_A=$(cat "$F")
  if [ "$PID_A" != "$DONO" ] && lsof -nP -iTCP:5198 -sTCP:LISTEN -t | grep -qx "$PID_A"; then
    FILHOS=$(pgrep -P "$PID_A" || true)
    kill "$PID_A" && echo "vite A reserva 5198 (PID $PID_A) encerrado"
    printf '%s\n' "$FILHOS" | while IFS= read -r c; do
      [ -n "$c" ] && kill -0 "$c" 2>/dev/null && kill "$c" && echo "filho $c do vite A reserva encerrado"
    done
  else
    echo "PID anotado ($PID_A) não escuta mais :5198 ou é o do dono — NÃO mato nada; avise o orquestrador"
  fi
  rm -- "$F"
fi
lsof -nP -iTCP:5198 -sTCP:LISTEN; echo "5198-checada"
lsof -nP -iTCP:5173 -sTCP:LISTEN -t
```

Esperado: `encerrado` (ou nenhuma saída, se a reserva não foi usada), nada em `:5198` antes de `5198-checada`, e o `:5173` como estava. NUNCA encerre por nome e nunca encerre nada na `:5173`.

---

### Task 10: Revisões (code-reviewer Opus + guardião da campanha), antes do merge

**Files:** nenhum (report-only).

**Interfaces:**
- Consumes: os 8 commits, `.superpowers/f30/{t1..t8,total,logs,qa/pre}` e este plano.
- Produces: 2 vereditos. Achado real vira commit de correção na worktree, no mesmo molde (pasta `.superpowers/f30/t9-fix/`, `confere.sh` + `gates.sh` + QA A/B de novo).

- [ ] **Step 1: Despachar o `code-reviewer` (modelo Opus) com este prompt**

```text
Revise, SEM editar nada, o diff `git -C "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f30-planejamento-detail" diff "$(git -C "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f30-planejamento-detail" merge-base HEAD feature/plan-tecido-a1)"..HEAD` (só os 8 commits da F3.0, mesmo depois de um rebase da sequência (b)) — refactor F3.0 do PlanejamentoDetail (src/components/planejamento/), que NÃO pode mudar comportamento, UI, textos nem queryKeys. Plano: docs/superpowers/plans/2026-09-23-planejamento-unificado-f30-refactor.md.
Evidências na worktree: .superpowers/f30/total (confere.sh BASE → EQUIVALENTE), .superpowers/f30/logs/* (gates), .superpowers/f30/qa/pre/{A,B}.json e A-*/B-*.html (QA A/B com guarda de escrita).
Foque em:
(1) ordem de hooks/effects — o seed da grade (dentro de useRevendaPlanejamento) continua ANTES do seed de MO e do merge do colab; dirty/useUnsavedGuard só mudaram de posição;
(2) closures do save e do retry P0409 (TanStack Query v5) — mesmos valores por render;
(3) refs passados como OBJETO (nunca .current) — markupAtacadoBaseRef/markupVarejoBaseRef no onBlur, savingRef/retryRef/revRef no retry;
(4) componentes de nível de módulo (sem remontagem/perda de foco);
(5) API pública — FieldText/FieldSelect re-exportados; criacao.planejamento.tsx e ProdutoAcabadoSheet.tsx intocados;
(6) nenhuma queryKey/RPC/texto mudou;
(7) nada em src/components/desenvolvimento, src/lib, supabase.
Achado só com arquivo:linha + evidência; sem achado = "sem achados".
```

- [ ] **Step 2: Despachar o `guardiao-unificacao` com este prompt**

```text
PORTÃO: G-fase F3.0 (antes do merge na feature/plan-tecido-a1) · FASE: F3.0.
Confira com evidência:
(a) decisões travadas — Dev intocado (decisão 8), F3.0 sem schema/migration, nada em src/lib/kanban-*, tests/integration, supabase;
(b) escopo = só refactor (diff restrito aos 10 arquivos da Task 9 Step 2);
(c) QA sem escrita em produção (violacoes=[] em .superpowers/f30/qa/pre/{A,B}.json, inclusive as "APP …" da origem do app; guarda de rede no spec nas duas frentes; loja não trocada; único efeito = metadado de login no Auth, aceito); S5 exercido (ou "pulado" igual em A e B, registrado);
(d) fronteiras coerentes com F3.1–F3.4 do plano da campanha (/Users/sunglee/.claude/plans/h-uma-necessidade-de-flickering-lovelace.md). As 4 fronteiras além das pedidas (helpers.ts, sync-tecidos.ts, InfoGeraisSecao.tsx, useRevendaPlanejamento.ts) foram APROVADAS pelo controlador no G-plano: registre-as como deriva pequena e justificada;
(e) ordem × F2 (R1): o A foi fotografado sem WIP da F2 e sem o E2E da F2 rodando; se a F2 commitou em src antes do ff, a sequência (b) foi seguida;
(f) save point íntegro.
Worktree: /Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f30-planejamento-detail. Registre no diário do guardião.
```

- [ ] **Step 3: Tratar os vereditos.** Só segue para a Task 11 com os dois sem BLOQUEIA. Ressalva real vira correção, com nova prova e novo QA. Registre no relatório final.

---

### Task 11: Integração na `feature/plan-tecido-a1`, smoke pós-merge e limpeza

**Files:**
- Modify (checkout principal, por fast-forward): os 10 arquivos da F3.0.
- Delete (não versionados): `tests/e2e/f30-qa.spec.ts`, a worktree.

**Interfaces:**
- Consumes: Tasks 9–10 aprovadas e `A.json` de referência.
- Produces: `feature/plan-tecido-a1` contendo os 8 commits da F3.0, a evidência copiada para `.superpowers/sdd/2026-09-23-f30/` do checkout principal, a worktree e a branch temporária removidas.

- [ ] **Step 1: Checar a F2, avisar o dono no chat, pausar os executores e combinar a janela**

Primeiro, a ordem × F2 (Global Constraints → "Ordem com a F2"). Rode a checagem da Task 9 Step 1, só as partes (1)–(5), sem o `curl`:
- (1) ou (2) com saída quer dizer que a F2 (ou outra mudança) commitou em `src/` depois que o A foi fotografado, e a worktree ainda não tem esses commits. Siga a sequência (b): Steps 2-3 → reiniciar o B → Task 9 Steps 1-6 → Task 10 → volte a ESTE Step;
- WIP ou E2E da F2 rodando: espere, como lá.

O caminho preferido (a) é chegar aqui antes do 1º commit da F2 em `src/`.

Depois, o orquestrador manda no chat (sem popup) e ESPERA a resposta do dono:

"Vou fundir a F3.0 (só refatoração do Sheet do Planejamento, sem mudança visível) na feature/plan-tecido-a1. Antes: SALVE e FECHE qualquer card do Planejamento aberto no app local (:5173). A troca de código muda a ordem interna dos hooks do card, e aí o recarregamento automático remonta o card aberto: o que foi digitado e não salvo se perde. Me avise quando estiver tudo salvo e fechado."

Com o OK do dono, o controlador PAUSA os executores da F1 e da F2 durante os Steps 2-4: não despacha nenhum novo, e os que estão rodando terminam o commit em curso e param. O `index.lock` só protege o instante do commit, não a janela entre o rebase e o ff.

Confirme que nenhum commit está em curso (`ls "/Users/sunglee/PLM + Criação/plm-pcp/.git/index.lock"` não existe). Nunca apague o lock.

No caminho (b), os Steps 2-3 rodam cedo, antes da Task 9. O rebase mexe só na worktree, então o aviso ao dono vai logo antes do Step 4, que é o ff que troca o código servido pelo `:5173`. A pausa dos executores vale nos Steps 2-3 e de novo do Step 4 em diante. Se a branch andar no intervalo, o ff falha e se volta ao Step 2. Se os commits novos tocarem `src/`, a Task 9 Steps 1-6 roda de novo.

- [ ] **Step 2: Rebase da F3.0 sobre a ponta atual da branch (a F1 pode ter commitado)**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f30-planejamento-detail"
git status --porcelain
git rebase feature/plan-tecido-a1
git log --oneline feature/plan-tecido-a1..HEAD
git diff --quiet "$(cat .superpowers/f30/BASE)" feature/plan-tecido-a1 -- package.json package-lock.json || npm ci
```

Esperado:
- `status` mostra só `?? tests/e2e/f30-qa.spec.ts`.
- O rebase termina sem conflito. Os caminhos são disjuntos dos 10 arquivos da F3.0:
  - a F1 toca só `src/lib/kanban-*`, `tests/*` e `supabase/*`;
  - a F2 toca os caminhos listados em Global Constraints → "Ordem com a F2": `src/lib/kanban-auto-*`, `src/lib/erro-mensagem.ts`, `src/hooks/useKanbanConfig.ts`, `src/components/shared/EtapaKanbanBadge.tsx`, `src/components/admin/*`, `src/routes/_authenticated/criacao.planejamento.tsx`, `criacao.desenvolvimento.tsx`, `admin/configuracoes.tsx`, mais `tests/unit/*` e `tests/e2e/kanban-auto.spec.ts`.
- Há exatamente 8 commits `refactor(planejamento): F3.0 (n/8) …`.

Se houver conflito: `git rebase --abort` e PARE, avisando o orquestrador.

- [ ] **Step 3: Gates pós-rebase contra a nova base**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f30-planejamento-detail"
L=.superpowers/f30/logs
git checkout --detach feature/plan-tecido-a1
env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit > "$L/unit-pos-base.log" 2>&1
grep -E "^ FAIL " "$L/unit-pos-base.log" | LC_ALL=C sort -u > "$L/unit-fail-pos-base.txt"; grep -E "Tests " "$L/unit-pos-base.log"
git checkout f30/planejamento-detail-refactor
env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit > "$L/unit-pos-f30.log" 2>&1
grep -E "^ FAIL " "$L/unit-pos-f30.log" | LC_ALL=C sort -u > "$L/unit-fail-pos-f30.txt"; grep -E "Tests " "$L/unit-pos-f30.log"
diff "$L/unit-fail-pos-base.txt" "$L/unit-fail-pos-f30.txt" && echo "mesmas falhas herdadas"
npm run build > "$L/build-pos.log" 2>&1; echo "build exit=$?"; git checkout -- src/routeTree.gen.ts 2>/dev/null
npx tsc --noEmit > "$L/tsc-pos.log" 2>&1; echo "tsc exit=$?"; grep -c "error TS" "$L/tsc-pos.log"
git status --porcelain
```

Esperado:
- `mesmas falhas herdadas`.
- Passados em `unit-pos-f30` = passados em `unit-pos-base` + 7.
- `build exit=0` e `tsc exit=0` com `0`.
- `status` mostra só `?? tests/e2e/f30-qa.spec.ts`.

- [ ] **Step 4: Fast-forward na branch do checkout principal**

```bash
MAIN="/Users/sunglee/PLM + Criação/plm-pcp"
ls "$MAIN/.git/index.lock" 2>/dev/null; echo "lock-check-fim"
git -C "$MAIN" status --porcelain -- src/components/planejamento tests/unit/planejamento-detail-helpers.test.ts
git -C "$MAIN" merge --ff-only f30/planejamento-detail-refactor
git -C "$MAIN" log --oneline -9
```

Esperado:
- Nenhum lock.
- `status` vazio.
- `Fast-forward` com os 10 arquivos.
- O topo do log mostra os 8 commits da F3.0.

Se o ff falhar porque a branch andou, volte ao Step 2.

Não faça push.

- [ ] **Step 5: Smoke pós-merge no app do dono (`:5173`, agora com o código novo), comparando com o A de antes**

```bash
ps -Ao pid,command | grep -F "kanban-auto.spec" | grep -v grep; echo "e2e-f2-checado"
curl -s -o /dev/null --retry 20 --retry-connrefused --retry-delay 2 -w 'A/B(:5173) http=%{http_code}\n' http://localhost:5173/
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f30-planejamento-detail"
E2E_BASE_URL=http://localhost:5173 F30_LADOS=B F30_B=http://localhost:5173 F30_REF_DIR=.superpowers/f30/qa/pre \
F30_OUT=.superpowers/f30/qa/pos npx playwright test tests/e2e/f30-qa.spec.ts --retries=0 --reporter=list 2>&1 | tail -30
```

Esperado: só `e2e-f2-checado` antes do `http=` (se aparecer um `kanban-auto.spec`, espere ele terminar e rode de novo, R1d), depois `1 passed`. O código fundido, servido pelo vite do dono, reproduz o mesmo DOM e as mesmas escritas simuladas do código ANTES (`qa/pre/A.json`), inclusive S5.

No plano B em dois tempos da Task 9 Step 3, ESTE passo é a comparação A/B principal.

- [ ] **Step 6: Guardar a evidência e limpar (só arquivos próprios)**

```bash
MAIN="/Users/sunglee/PLM + Criação/plm-pcp"
WT="$MAIN/.claude/worktrees/f30-planejamento-detail"
mkdir -p "$MAIN/.superpowers/sdd/2026-09-23-f30"
cp -R "$WT/.superpowers/f30/qa" "$WT/.superpowers/f30/logs" "$WT/.superpowers/f30/total" "$MAIN/.superpowers/sdd/2026-09-23-f30/"
rm -- "$WT/tests/e2e/f30-qa.spec.ts"
git -C "$WT" status --porcelain
git -C "$MAIN" worktree remove "$WT"
git -C "$MAIN" branch -d f30/planejamento-detail-refactor
git -C "$MAIN" worktree list
lsof -nP -iTCP:5199 -sTCP:LISTEN; echo "5199-livre"
```

Esperado:
- `status` da worktree vazio.
- A worktree some da lista.
- `Deleted branch f30/planejamento-detail-refactor`.
- `5199-livre`.

A pasta ignorada da worktree (`node_modules`, `.env`, `.superpowers`) é apagada junto pelo `git worktree remove`. A evidência já foi copiada.

- [ ] **Step 7: Fechar (orquestrador)**

- Relatório no chat:
  - os 8 commits;
  - `confere` total EQUIVALENTE;
  - QA A/B e pós-merge `1 passed`, com as flags;
  - vereditos do code-reviewer e do guardião;
  - onde está a evidência (`.superpowers/sdd/2026-09-23-f30/`).
- Atualizar a memória `project_planejamento_detail_extraido.md` com a estrutura nova de `planejamento-detail/`.
- Marcar F3.0 como feita no plano da campanha.
- Push fica para o dono decidir.

**Como desfazer (só com OK do dono):** `git -C "/Users/sunglee/PLM + Criação/plm-pcp" revert --no-edit <8 commits da F3.0, do mais novo ao mais velho>`. Não há banco envolvido.

---

## 4. Riscos de regressão e como o plano os cobre

| # | Risco | Cobertura |
|---|---|---|
| R1 | Ordem dos effects: o seed da grade revenda lê `revRef.current` e tinha de rodar antes do merge do colab | Hook chamado no ponto exato da :991 (Task 6 Step 3 confere a ordem com `grep`); comentário no hook e no orquestrador; QA S4 (grade + Salvar) A≡B; revisão (1) |
| R2 | Componente declarado dentro do orquestrador remonta a cada render e perde o foco | Todos os componentes novos no nível do módulo (Global Constraints); QA digita em campos (nome, grade) e compara DOM e escritas |
| R3 | Passar `ref.current` em vez do ref (onBlur do markup e retry do P0409 leem `.current` NA HORA) | Args tipados `RefObject<…>`; a desestruturação passa o objeto; QA S5a (onBlur do markup e preço fixo com o corpo A≡B); revisão (3) |
| R4 | Closures do `save`/retry (TanStack v5 atualiza options por render) | Hook recebe os mesmos valores do mesmo render; QA S1/S2 compara as requisições (corpo inclusive) A≡B e o nº de UPDATEs |
| R5 | `useUnsavedGuard` e `dirty` mudaram de posição | Mesmo texto e valor no mesmo render; QA registra "pediu descartar" em todos os cenários, A≡B |
| R6 | Deriva de texto ao "redigitar" código | Texto sempre do BASE (`base.sh`), remoção exata (`troca.mjs`) e `confere.sh` por tarefa e no total |
| R7 | Import podado errado vira ReferenceError só em runtime (o build não faz type-check) | `tsc --noEmit` 0 erro + `--noUnusedLocals` igual ao esperado em TODA tarefa (`gates.sh`) |
| R8 | QA gravar em PRODUÇÃO (o app local aponta para lá) | Guarda de rede em duas frentes: no Supabase, escrita barrada ou simulada; na origem do app, todo NÃO-GET (`/_serverFn/…`) barrado. `violacoes = []` obrigatório; sem `selectStore`; spec não versionado. Único efeito inerente: metadado de login no Auth (`last_sign_in_at`/refresh token), sem dado de loja |
| R9 | A/B contaminado por outra mudança no checkout principal (F1 ou F2 em andamento) | Pré-condição da Task 9 Step 1: sem commit em `src` desde a base da worktree fora de `src/lib/kanban-*`, nem em `src/lib/kanban-auto-*`; sem WIP nesses caminhos. Os caminhos da F2 são `src/lib/kanban-auto-*`, `src/lib/erro-mensagem.ts`, `src/hooks/useKanbanConfig.ts`, `src/components/shared/EtapaKanbanBadge.tsx`, `src/components/admin/*`, `criacao.planejamento.tsx`, `criacao.desenvolvimento.tsx` e `admin/configuracoes.tsx`. Se a F2 já commitou: sequência (b) (G-plano R1) |
| R10 | Merge durante a F1/F2 | ff-only numa janela sem lock; executores da F1/F2 PAUSADOS nos Steps 2-4 da Task 11; caminhos disjuntos (F1: `src/lib/kanban-*`, `tests/*`, `supabase/*`; F2: os de R9 + `tests/unit/*`, `tests/e2e/kanban-auto.spec.ts`); rebase antes; preferência (a) = merge antes do 1º commit da F2 em `src/`; dono avisado; sem push |
| R11 | 2º vite (`@cloudflare/vite-plugin`) não sobe ao lado do vite do dono | Plano B em dois tempos (A antes, B pós-merge no `:5173`) |
| R12 | `.env` com segredos copiado para a worktree | Gitignored; nunca vai para o `add`; apagado com a worktree |
| R13 | `src/routeTree.gen.ts` regenerado pelo build/vite | `gates.sh` restaura; `git status` checado antes de cada commit |
| R14 | Presença Realtime aparecer no DOM (outra aba ou o dono no mesmo card) | Contextos fechados + 5 s entre lados; se o diff do DOM for só o banner de presença, repita o QA |
| R15 | Bug conhecido: 2º "Salvar" no Dialog novo duplica o card | Preservado de propósito (a F3.1 corrige); o QA S3 salva 1× |
| R16 | Falhas herdadas de `tests/unit` (anti-drift a/e) | Linha de base: o gate compara o CONJUNTO de falhas, não "0 falhas" |
| R17 | Requisição feita pelo SSR do vite não passa pela guarda do navegador | O SSR não autentica nem grava hoje; se aparecer escrita no log do vite, registrar e PARAR |
| R18 | Merge com o app do dono aberto: a ordem dos hooks muda (Task 6), o Fast Refresh remonta o Sheet aberto e o que ele não salvou se perde | Aviso da Task 11 Step 1: o dono SALVA e FECHA os cards do Planejamento antes do ff, e só então se segue (G-plano R2) |
| R19 | QA da F3.0 e E2E da F2 ao mesmo tempo (mesmo usuário, mesmo `:5173`, presença Realtime) | Checagem (5) da Task 9 Step 1, repetida antes do Step 5 e na Task 11 Step 5; o controlador não despacha os dois juntos (G-plano R1d) |
| R20 | Vite A de reserva (`:5198`) roda no mesmo `cwd` do vite do dono, então encerrar pelo `cwd` mataria o errado | PID anotado ao subir (Task 9 Step 1); o Step 7 encerra só esse PID e os filhos dele, e só se ainda escutar `:5198` (G-plano R6) |

## 5. Decisões (DECIDIDAS — 23/set/2026)

Todas são técnicas. O controlador as decidiu e o guardião as confirmou no G-plano F3.0. Nenhuma espera o dono; a 2 ele mesmo já tinha respondido. As que o afetam (1 e 3) são só informadas a ele no chat.

1. **Lado B do QA num 2º vite da worktree em `:5199` — DECIDIDO: sim.** O `:5173` serve o checkout principal, ou seja, o código antes. A = `:5173`; pós-merge, o smoke roda no `:5173` comparando com o A. É o combinado da memória ("se subir um, porta 5199"). `E2E_BASE_URL` é SEMPRE explícito em toda chamada do Playwright (o default é produção). O vite A de reserva, se preciso, vai em `:5198`, com PID anotado (R6).
2. **Usuário E2E na "Loja Teste" — DECIDIDO pelo dono: o robô NÃO troca de loja.** Trocar grava `users.tenant_id` em produção. Se o usuário de teste não estiver na "Loja Teste", o QA falha e para (a trava do spec).
3. **Momento do merge — DECIDIDO: conforme R1(a).** A preferência é fundir antes do 1º commit da F2 em `src/`; senão vale a sequência (b) (Global Constraints → "Ordem com a F2"). O dono recebe o aviso da Task 11 Step 1 (R2: salvar e fechar os cards do Planejamento antes do ff), e os executores da F1/F2 ficam pausados nos Steps 2-4. Push fica com o dono.
4. **Spec do QA A/B — DECIDIDO: descartado no fim, não commitado.** Ele é apagado na Task 11 Step 6; a evidência (`qa/`, `logs/`, `total/`) é copiada para `.superpowers/sdd/2026-09-23-f30/`.
5. **Fronteiras além das 4 pedidas — DECIDIDO: aprovadas.** São `helpers.ts`, `sync-tecidos.ts`, `InfoGeraisSecao.tsx` e `useRevendaPlanejamento.ts`, e servem à F3.1/F3.2/F3.4. O rodapé fica no orquestrador porque a F3.3 vai redesenhá-lo. O guardião as registra na G-fase (Task 10 Step 2, item d) como deriva pequena e justificada.
6. **Commit deste plano na `feature/plan-tecido-a1` — DECIDIDO e FEITO.** O controlador commitou o plano com `git commit --only` ao fechar o G-plano (`docs(plano): F3.0 refatoração do PlanejamentoDetail (G-plano: R1–R6 + decisões)`). A Task 0 Step 2 só confere; não commita de novo.

## 6. Self-review (feito ao escrever)

- **Cobertura da spec:**
  - `campos.tsx` → T1; `PrecoTabela.tsx` → T2; `RevendaSetores.tsx` → T6+T7; `usePlanejamentoSave.ts` → T8.
  - Re-export de `FieldText`/`FieldSelect` → T1, conferido na T9.
  - Orquestrador mantido → T1–T8.
  - Zero comportamento/UI/queryKey/texto → `confere.sh` por tarefa, total na T9, checagem de queryKey na T9 e QA A/B.
  - Worktree + retorno sem conflito → T0 e T11.
  - Gates por tarefa → `gates.sh`.
  - QA Playwright com `E2E_BASE_URL` explícito, sem escrita (guarda no Supabase e na origem do app), cobrindo abrir existente, novo, revenda, salvar, conflito, markup/preço fixo, cascata Grupo→Categoria e "Criar produto acabado" → T9 S1–S5, D1–D3 e 390 px.
  - Ressalvas do G-plano F3.0: R1 (ordem × F2) → Global Constraints + T9 Step 1 + T11 Steps 1-2 + riscos R9/R10/R19; R2 (merge com o app aberto) → T11 Step 1 + risco R18; R3 (cobertura) → S5; R4 (guarda da origem do app + metadado de login) → Global Constraints + spec + risco R8; R5 → §5 item 2; R6 (vite A de reserva) → T9 Steps 1 e 7 + risco R20.
  - Sem migrations nem Dev → Global Constraints + `git status` por tarefa.
  - Commits `--only` com co-autoria → todas as tarefas.
- **Placeholders:** nenhum "TBD/TODO/similar a". O código novo está por extenso nos heredocs; o código movido sai do BASE por `base.sh` com a faixa exata.
- **Consistência de nomes:** `useRevendaPlanejamento`/`RevendaPlanejamento`/`UseRevendaPlanejamentoArgs`, `usePlanejamentoSave`/`UsePlanejamentoSaveArgs`, `PrecoRevendaBloco`/`ProdutoAcabadoSecao`/`GradeRevendaSecao`, `InfoGeraisSecao`, `rotuloConflitoPlan`/`limparCustoSim`/`invalidarAposAprovarMO`, `syncTecidosToDesenvolvimento`, `EstoqueArtigo` e `revenda` (variável do orquestrador). Os mesmos nomes valem nas Tasks 6, 7, 8 e 9.
- **Execução recomendada:** superpowers:subagent-driven-development. As tarefas são ESTRITAMENTE sequenciais (todas mexem em `PlanejamentoDetail.tsx`), com um subagente Sonnet por tarefa, sempre na MESMA worktree (caminho absoluto no prompt), e revisão Opus na Task 10.
