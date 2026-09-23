# Planejamento unificado — F3.1: campos simples vindos do Desenvolvimento + Descrição do produto + selo da etapa — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trazer para o Sheet do Planejamento de Produto as seções/campos SIMPLES do Desenvolvimento (equipe e cronograma, REF editável, Motivo do Cancelamento, Ajustes na Prova, Ficha de Medida + Obs. Gerais, Observações), criar o campo NOVO "Descrição do produto" (coluna `modelos.descricao_produto`, levada pelo "Replicar card(s)"), pôr o selo da etapa do kanban no header com "Mover para…" (etapa FORA do Salvar) e corrigir o bug do card novo que duplica no 2º Salvar — sem tocar no Sheet do Desenvolvimento.

**Architecture:**
- Tudo fica no Planejamento: o orquestrador `PlanejamentoDetail.tsx` (pós-F3.0) ganha as seções; o que é novo mora em `src/components/planejamento/planejamento-detail/ficha/` (lógica pura testável + hooks + seções). Do Dev só se REUSA, sem modificar, `ModeloAjustesProvaSection` e `ModeloObservacoes`; o cluster "Desenvolvimento + Cronograma & pilotos + Obs. Técnicas" do `ModeloInfoSection` vira CÓPIA adaptada (`DevEquipeSection`).
- O `Draft` do Planejamento ganha os 12 campos do Dev + a Descrição; um helper puro (`aplicarRegrasCamposDev`) decide o que vai no payload (datas vazias → NULL, sem permissão do Dev → omite, REF só quando editável). A etapa (`status_desenvolvimento`) continua FORA do Draft: muda só pelo "Mover para…" do selo (RPC `kanban_mover` com a chave ligada; com ela desligada, as regras do board de hoje).
- Banco: UMA migration aditiva própria (`20260930180000_modelo_descricao_produto.sql`) com a coluna + a redefinição de `_replicar_cards_plan_tecido_core` (só 2 linhas do INSERT mudam), inverso com guarda, e teste de integração que roda SÓ na cópia local.

**Tech Stack:** Vite + React 19.2 + TypeScript (strict) + TanStack Query v5 + TanStack Router/Start + supabase-js + Radix/shadcn (`Popover`, `Select`, `Textarea`) + lucide-react + sonner. Testes: Vitest (`tests/unit`, `environment: node`) + integração `pg` em BEGIN…ROLLBACK na cópia local + Playwright 1.61 (QA com guarda de rede, só leitura). Node 24. Shell zsh (scripts `.sh` com shebang bash).

**Spec:** `/Users/sunglee/.claude/plans/h-uma-necessidade-de-flickering-lovelace.md` — seções "F3 — Sheet unificado" (item **F3.1**), "Etapa FORA do Salvar", "Campo NOVO 'Descrição do produto'", "10 decisões de F3 APROVADAS", "Decisões do dono (travadas)", "Regras de derivação". Contexto comum: `/Users/sunglee/PLM + Criação/plm-pcp/.superpowers/sdd/2026-09-22-unificacao-kanban-auto/planner-context-f3.md`. Guardião: `/Users/sunglee/PLM + Criação/.claude/agents/guardiao-unificacao.md` + diário `…/2026-09-22-unificacao-kanban-auto/guardiao.md`. Mockup APROVADO (fonte de verdade visual e do mapa campo-a-campo): `/private/tmp/claude-501/-Users-sunglee-PLM---Cria--o/f73c31ec-0c58-49a9-b65c-05edfa4258fc/scratchpad/canvas-unif/{gen_main.py,gen_anotado.py,gen_prova.py,gen_novo.py}`. Estrutura-base: plano F3.0 `docs/superpowers/plans/2026-09-23-planejamento-unificado-f30-refactor.md`. Dependência de UI: plano F2 `docs/superpowers/plans/2026-09-23-kanban-automatico-f2-telas.md` (Tasks 1, 3 e 4).

## Global Constraints

**Requisitos da spec (texto literal)**
- Campo NOVO: rótulo **"Descrição do produto"**, placeholder **"Descreva o produto…"**, "texto longo, largura total, no fim da seção 1 'Informações Gerais do Produto' (Sheet e Dialog de novo)". Coluna `modelos.descricao_produto text`, "migration aditiva PRÓPRIA … FORA das `kanban_auto_*` e do `_kanban_auto_down.sql` … `ADD COLUMN IF NOT EXISTS` … inverso próprio avisando que o DROP apaga o digitado". Número fixado aqui: **`20260930180000`** (a F3.2, se precisar de migration, usa ≥ `20260930190000`).
- "'Replicar card(s)' LEVA a descrição — redefinir `_replicar_cards_plan_tecido_core` (lista fixa de colunas) na MESMA migration própria da coluna, com diff `pg_get_functiondef` e inverso (G-migration)". "Duplicar copia (via `...draft`)". "'Importar dados' (Dev) não copia". "Ficha Técnica não imprime (não pedido)". "`types.ts` sem a coluna até regenerar (cast)". `data-colab-path="descricao_produto"`.
- **ORDEM OBRIGATÓRIA:** a coluna é aplicada em PRODUÇÃO (Task 9) ANTES de qualquer QA e ANTES do merge — o vite local do dono (`:5173`) grava em produção e o payload do Salvar passa a levar `descricao_produto` (sem a coluna, TODO Salvar do Planejamento cai com PGRST204).
- "Etapa FORA do Salvar: o Draft unificado NÃO carrega `status_desenvolvimento` … A etapa muda só pelo selo 'Mover para…' (regras do QUADRO: cascata + limpa `#Erro` kanban; com a chave desligada = comportamento de hoje), sem apagar `motivo_cancelamento` ao sair de Reprovado (dono, 23/set: o motivo fica guardado)."
- Selo da etapa no **header do Sheet (Nome → REF → selo)** (decisão travada 5), consumindo `EtapaKanbanBadge` da F2.
- Decisão F3 #8: seções do Dev **sempre visíveis (independente da etapa)** p/ quem tem `canView("criacao_desenvolvimento")`, **editáveis com `canEdit("criacao_desenvolvimento")`**; "sem permissão o Salvar omite esses campos"; revenda/comprado segue "Fluxo de Revenda" (`revendaCampoVisivel`). Decisão travada 6: recolhidas.
- Decisão F3 #1: "trava pós-Explosão só no que veio do Dev … + botão 'Editar'; Info Gerais/Coleção/Preço/MO/Lançamento livres". Nesta fase: aplicada às seções que a F3.1 traz (ver §7-T1).
- Decisão F3 #9: Duplicar "herda o de hoje (Planejamento + tecidos só o artigo); o resto do Dev nasce vazio".
- Fix: "card novo → após salvar, fechar o Dialog e abrir o Sheet com o id novo (`onCreated(id)`) — hoje um 2º Salvar DUPLICA o card".

**Repositório, worktree, merge**
- Repo principal `/Users/sunglee/PLM + Criação/plm-pcp`, branch `feature/plan-tecido-a1`. Worktree da F3.1: `/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f31-planejamento-campos`, branch `f31/planejamento-campos`, criada do HEAD da `feature/plan-tecido-a1` **depois** de a F3.0 estar juntada nela (Task 0). `WT` = esse caminho; `MAIN` = o repo principal.
- Merge SÓ por fast-forward (`git merge --ff-only`), com o dono avisado para SALVAR e FECHAR os cards do Planejamento antes (a ordem dos hooks muda → o Fast Refresh remonta o Sheet aberto; lição R18 da F3.0) e com os executores de F1/F2/F3.2 pausados durante o ff. Sem push (fica com o dono).
- Commits: `git add -- <arquivos novos>` + `git commit --only -m "…" -- <paths da task>`. Nunca `git add .`. Toda mensagem termina com `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. `src/routeTree.gen.ts` nunca entra em commit (o `gates.sh` o restaura).

**Intocáveis**
- Sheet do Desenvolvimento (decisão travada 8): nada em `src/components/desenvolvimento/**`, `src/components/producao/cad/CadTecidosSection.tsx` nem `src/components/shared/ModeloObservacoes.tsx` (reuso DIRETO). Prova em todo gate: `git diff --name-only savepoint-pre-unificacao-2026-09-22 -- <esses 3>` vazio.
- Espelho da F1 e arquivos da F2: NÃO editar `src/lib/kanban-auto.ts`, `src/lib/kanban-status.ts`, `src/lib/kanban-condicoes.ts`, `src/lib/kanban-auto-ui.ts`, `src/lib/kanban-auto-rpc.ts`, `src/lib/kanban-auto-config.ts`, `src/hooks/useKanbanConfig.ts`, `src/components/shared/EtapaKanbanBadge.tsx`, `src/lib/erro-mensagem.ts`, nem nenhuma rota (`src/routes/**` — `criacao.planejamento.tsx` é arquivo da F2). A F3.1 só IMPORTA deles.
- Caminhos permitidos na F3.1 (o `gates.sh` confere): `src/components/planejamento/PlanejamentoDetail.tsx`, `src/components/planejamento/modelo-shared.ts`, `src/components/planejamento/planejamento-detail/**`, `supabase/migrations/20260930180000_modelo_descricao_produto.sql`, `supabase/rollback/20260930180000_modelo_descricao_produto_down.sql`, `tests/integration/mig-txn.ts`, `tests/integration/modelo-descricao-produto.test.ts`, `tests/unit/planejamento-*.test.ts`.

**Banco**
- NUNCA teste de integração contra produção (`/tmp/dburl.txt` = PRODUÇÃO; `tests/integration/db.ts:18-26` cai nele sem `DATABASE_URL`). DDL/migration SÓ na cópia local `postgresql://postgres:postgres@127.0.0.1:54422/postgres`, dentro do harness (`exigeBancoLocal`). PROIBIDO `psql -f`/`\i` de migration (incidentes 15/set e 23/set). A cópia local é compartilhada com a F1: o controlador NÃO roda a integração da F3.1 junto com a suíte `kanban-auto` (DDL em `modelos` segura lock até o ROLLBACK).
- **Receita de travas (R7 do G-plano conjunto = G-migration da F1, R1):** a migration e o inverso só vão a um banco FORA do harness pelo `aplica_v2` de `.superpowers/f31/mig/aplica.sh` (Task 1 — cópia fiel do bloco do runbook `.superpowers/sdd/2026-09-22-kanban-automatico-f1-banco/task-18-runbook-v2.md` §2-§3): o arquivo INTEIRO numa mensagem (`psql -X -v ON_ERROR_STOP=1 -c "…"`, sem `-f`/`-1`), `SET LOCAL lock_timeout = '500ms'` + `SET LOCAL transaction_timeout = '3s'` injetados logo depois do `BEGIN;`, nova tentativa SÓ em 55P03/40P01/25P04 (máx. 5, com o ATIV antes), qualquer outro erro PARA. Dentro do arquivo: `CREATE FUNCTION` antes e o `ALTER TABLE modelos` POR ÚLTIMO. Só dois usos: o ensaio na cópia local (Task 1 Step 8) e a produção (Task 9).
- Produção só na Task 9: G-migration do guardião APROVA + OK explícito do dono. Leitura em produção antes disso: proibida nesta fase.

**Gates (toda task de código)** — `.superpowers/f31/gates.sh` (Task 0): `npm run build` ok · `npx tsc --noEmit` = 0 erro (build NÃO faz type-check) · `env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit` com o MESMO conjunto de falhas da linha de base (hoje: 2, ambas do `ui-padroes-antidrift`, fora do escopo) · nenhum hit do anti-drift em arquivo da F3.1 · Dev intocado · diff só nos caminhos permitidos. NUNCA `npx vitest run` sem caminho. **Suíte INTEIRA (R10 do G-plano):** 1× na linha de base (Task 0 Step 5) e 1× no G-commit (Task 11 Step 2), sempre com `DATABASE_URL` = cópia local e SEM sobrepor a nenhum teste da F1 na cópia (o controlador confere que nenhum `vitest` está rodando); se não der, o desvio é registrado no relato do G-commit.

**QA de navegador**
- `E2E_BASE_URL` SEMPRE explícito e local (o default do `playwright.config.ts:26` é PRODUÇÃO); o spec LANÇA erro sem ele (não "pula calado" — RS1 da F2). Guarda de rede fail-closed em 2 frentes (Supabase: escrita simulada ou barrada; origem do app: todo NÃO-GET barrado). Barradas "esperadas" (continuam barradas, não reprovam): `rpc/servicos_financeiro` da Home (NUNCA liberar — sincroniza `parcelas_servico` em produção) e o broadcast REST do Realtime (lição da G-fase F3.0). O robô NÃO troca de loja: toda leitura de `tenant_config` tem de ser da Loja Teste (`37889b78-fffb-404b-8c75-18b7e50a1d9b`), senão o teste falha. Único efeito inerente: metadado de login no Auth.
- 2º vite na worktree em `:5199` (checar porta livre; se ocupada, PARAR — nunca matar nada); encerrar SÓ o PID que escuta `:5199` com `cwd` = worktree. NUNCA tocar no vite do dono (`:5173`). Nunca rodar junto com o E2E da F2 nem com QA da F3.2 (mesmo usuário, presença Realtime).

**UI (docs/design/ui-padroes.md §A/§G/§Q)** — editar = Sheet, novo = Dialog; datas `<DateField>` (nunca `<input type="date">`); erros `mensagemErro()`; ações no rodapé sticky; cor só por token; ícones lucide com tamanho por `className`; fonte ≥ `text-[11px]`; componentes SEMPRE no nível do módulo (nunca declarados dentro de outro); alvos de toque 44px no mobile (`max-sm:min-h-11`).

**Modelos e comunicação** — Sonnet executa (Tasks 0–10), Opus revisa (ver §4); sem Fable. Avisos ao dono por CHAT, sem popup de plano (`ExitPlanMode` proibido).

---

## 1. Fatos verificados (23/set/2026, só leitura)

**Estrutura pós-F3.0** (worktree `.claude/worktrees/f30-planejamento-detail`, HEAD `7f6b871`, ainda NÃO juntada — a Task 0 exige que esteja). Linhas abaixo = blob desse HEAD; ancorar SEMPRE pelo texto, não pelo número.
- `PlanejamentoDetail.tsx` (1143 l.): props `{ modeloId, onClose, onSaved, contexto? }` (:78-85); permissões (:96-102); `enviada`/`lancado` (:415-417); query `["modelo", modeloId]` com `select("*")` (:485-494); merge colab (:499-558) — avança `baseRef`/`revRef` ANTES do `if (!draftMudou) return` (:532-540), então um UPDATE que não mexe em campo do Draft só re-sincroniza o rev; uploads (:560-579); `usePlanejamentoSave` (:583-591); `duplicate` com `const { versao: _v, modelo_base_id: _b, ref: _ref, ...rest } = draft` (:702); header com REF read-only (:765-769); seções: Info Gerais (:791), Coleção (:799-840), Preço (:843-882), MO (:894-916), PA/Grade revenda (:919-928), Tecido Planejado (:931-941), Anexos (:944-967), Lançamento (:970-1016), Produto Relacionado (:1017-1021); rodapé (:1024-1080); Sheet×Dialog por `isEdit` (:1105-1121).
- `usePlanejamentoSave.ts`: payload = `{ ...draft, … }` (:72-79) + `delete payload.ref` (:83); UPDATE com `.eq("rev")` (:154-161); card novo = `insert(...).select("id").single()` SEM guarda de 2º insert (:163-168); `onSaved()` sem fechar (:297-301); retry P0409 (:331-360).
- `modelo-shared.ts`: `Draft` (:76-106) SEM `status_desenvolvimento`; `emptyDraft` (:107-117); `draftFromModeloRow` (:124-156). Importadores: só `PlanejamentoDetail.tsx` e `usePlanejamentoSave.ts` usam `Draft`/`emptyDraft`/`draftFromModeloRow` (grep).
- `helpers.ts`: `ROTULO_CONFLITO_PLAN` (:10-21, privado; "A F3.1 acrescenta… os rótulos dos campos novos"). `InfoGeraisSecao.tsx`: Estilista (:46), fim da seção (:112-113). `campos.tsx`: `Secao` renderiza `{open && children}` (:18-36); `FieldSelect` sem "— Nenhum —" (:133-147).
- Ordem das seções × mockup (G-plano conjunto R9b/R9c): no F3.0 o `SETOR 4 — Tecido Planejado` (:930-941) vem DEPOIS da Mão de obra (:894-916) e da PA/Grade de revenda — no Dialog "Novo Modelo" a ordem sai Info → Coleção → Mão de obra → Tecido Planejado → Anexos, e o mockup aprovado pede Info → Coleção → **Tecidos → Mão de obra** → Anexos (`gen_novo.py:15-17`); no Sheet o mockup põe os Tecidos na seção 5, antes de "Preço e Custos" (`gen_anotado.py`). O `<ObsMaoObraField>` da seção Mão de obra (:909-912) está SEM rótulo; o Dev passa `label="Obs. Mão de Obra"` (`ModeloDetailPanel.tsx:3051-3055`) e o mockup pede o rótulo também aqui (`gen_anotado.py`, seção 11: "no Dev tem rótulo; aqui passa a ter também"). A query `["modelo", modeloId]` (:485-494) não é usada antes da linha 500 — pode subir sem mudar nada além da ordem dos hooks.
- Rota `criacao.planejamento.tsx:1134-1143` monta `<PlanejamentoDetail modeloId={openId} …>` SEM `key` → hoje, depois do 1º Salvar do Dialog o componente segue com `modeloId=null` (isEdit=false) e o 2º Salvar faz outro INSERT (R15 da F3.0).

**Desenvolvimento (fonte do que é portado; NÃO muda)**
- `ModeloDetailPanel.tsx`: `draftFromModelo` (:102-142, datas como `""`); rótulos de conflito (:145-160); payload do Salvar com `ref: d.ref || null`, datas `|| null`, `motivo_cancelamento: reprovadoAtual ? d.motivo_cancelamento : null` (:1877-1898 — o Dev APAGA o motivo ao salvar fora de Reprovado); `campoVisivel = (key) => !isComprado || revendaCampoVisivel(revendaCfg, key)` (:1574); `locked = !!draft?.enviado_cad && !editing` (:1600); trava por `<fieldset disabled={locked} className="contents">` DENTRO do conteúdo de cada seção (:2799…:3101); "Editar" no rodapé (:3191-3194); `setEditing(false)` no Salvar (:2273); Prova = `<ModeloAjustesProvaSection modeloId />` (:2843); Anexos = `ModeloAnexosSection` com Ficha de Medida + Obs. Gerais (:3077-3094); `ModeloObservacoes` fora do acordeão (:3103); upload da ficha em `<tenant>/fichas/<modeloId>/<uuid>-<nome>` (:2654-2659); `useColabs(tipo)` com key `["colab", tipo]` (:3290-3299).
- `ModeloInfoSection.tsx`: REF só com `refVisivel` (:224-228); Piloto 2/3 em estado inicial calculado UMA vez do draft (:94-101 — não vê piloto 2 que chega depois por merge); remover o 2 limpa o 3 (:107-120).
- `ModeloAjustesProvaSection.tsx:157`: props `{ modeloId }`, sem título próprio. `ModeloObservacoes.tsx:50`: props `{ modeloId, readOnly? }`, renderiza um `Card` com título "Observações" (:126-128) — dentro da nossa `Secao` o título aparece 2× (aceito: o componente é compartilhado com o Dev e não pode mudar).
- Board `criacao.desenvolvimento.tsx`: `editable = canEdit("criacao_desenvolvimento")` (:129); `podeEntrar` (:322-332) = cascata `requisitosEfetivos` (interno) ou `revendaColunaPermitida`/`revendaRequisitos` (comprado, falta "fora do fluxo de comprado"); `updateStatus` = `UPDATE modelos SET status_desenvolvimento` + `rpc marcar_etapa_verificada(_modelo_id,'kanban')` (:547-557) — NÃO toca `motivo_cancelamento`; toast de bloqueio `Não pode entrar aqui. Faltam: …` (:585-590).

**Kanban (F1 TS no branch; F1 SQL não aplicada em produção; F2 ainda sem commit em `src/`)**
- `src/lib/kanban-auto.ts` (commits da F1): `lerKanbanAutoConfig`, `boardDaLoja`, `derivarModelo`, `entradaParaDerivacao`, `destinoDrop`, `statusParaGate` (:226-229), `normKey`, tipos `KanbanAutoConfig`/`Derivacao`/`ModeloKanban`.
- `src/lib/kanban-status.ts`: `refCampoVisivel(statusKanban, refExibirStatus, status, { statusGate })` (:114-121) — com `statusGate` preenchido usa a posição DERIVADA (decisão 10); `DEFAULT_STATUSES` (keys `em_modelagem … aprovado`, :16-31).
- RPC `kanban_mover(_modelo_id, _para)` (`20260930150000_kanban_auto_4_rpcs.sql:26-98`): exige `user_can_edit('criacao_desenvolvimento')` (:49-51), dá P0001 "O Kanban automático está desligado nesta loja." com a chave desligada (:66-68), limpa `revisao_pendente->'kanban'`, NÃO toca o motivo.
- `avaliar_condicoes_kanban(_ids)` é `STABLE` (snapshot `funcoes.sql:9851-9858`) — leitura; `marcar_etapa_verificada` é tipada no `types.ts` (:7986) e usada sem cast pelo board.
- F2 (plano, Tasks 1/3/4) cria `kanban-auto-ui.ts` (`etapaDoModelo`, `EtapaSelo`, `notaMoverPara`, `toastDoMover`, `labelDaColuna`, `labelsCondicoes`, `ResultadoMover`), `kanban-auto-rpc.ts` (`kanbanMover`), `EtapaKanbanBadge({ selo, className?, onClick?, testId?, compacto? })`. Nenhum desses arquivos existe ainda no branch (conferido 23/set).

**Banco (Replicar)**
- `_replicar_cards_plan_tecido_core` VIVO = corpo de `supabase/migrations/20260908240000_plan_tecido_replicar_ref.sql:16-195` = snapshot `savepoints/2026-09-22-pre-unificacao/funcoes.sql:6140-6319` = cópia local (diff feito 23/set; `md5(pg_get_functiondef)` na cópia local = `e0393c79fb962a068fd7a3e4636acbe6`). Linhas-âncora únicas: `:96` `      versao, modelo_base_id, mix_id, ref, ref_auto` e `:107` `      v_versao, v_root, o.mix_id, o.ref, o.ref_auto`; fecha em `:195` `end $function$;`. ACL na cópia local: `{postgres=X/postgres,service_role=X/postgres}` (REVOKE dos 3 em `20260903140000:191`).
- Cópia local: `modelos` com 66 colunas, sem `descricao_produto`; Loja Teste + usuário de teste presentes; `set_tenant_id_trg` em `modelos`/`colecoes`/`plan_tecido*`. `_replicar_produtos_acabados_core` insere em `modelos` só identidade (funcoes.sql:6391-6397) — não copia textos do card (ver Decisão do dono D2).

**Testes**
- `tests/integration/db.ts`: `ehBancoLocal()` (:44-53), `withTx` (:63-77), `comoUsuario` (:80-92), `um` (:100-103). O harness de migration da F1 é local ao arquivo `kanban-auto.test.ts` (:56-128) — a F3.1 copia o essencial para `tests/integration/mig-txn.ts` (não mexe no arquivo da F1).
- `useAuth.tsx:111-118`: admin/super/tenant_admin furam `canView/canEdit`; perfis vêm de `user_roles` (GET) + `rpc/minhas_permissoes_efetivas` (:40-43) — o QA simula um usuário comum respondendo essas 2 leituras.

## 2. Estrutura de arquivos (de → para)

| Arquivo | Responsabilidade | Task |
|---|---|---|
| `supabase/migrations/20260930180000_modelo_descricao_produto.sql` (novo) | coluna `descricao_produto` + `_replicar_cards_plan_tecido_core` com 2 linhas a mais | 1 |
| `supabase/rollback/20260930180000_modelo_descricao_produto_down.sql` (novo) | inverso com guarda (não apaga descrição sem confirmação na sessão) | 1 |
| `tests/integration/mig-txn.ts` (novo) | harness mínimo: aplica arquivo SQL DENTRO da txn, só na cópia local | 1 |
| `tests/integration/modelo-descricao-produto.test.ts` (novo) | estático (arquivos, ALTER por último) + DB (coluna, diff da função, ACL, Replicar, inverso, desistência em 55P03 com `modelos` ocupada) | 1 |
| `.superpowers/f31/mig/{aplica.sh,ensaio-local.sh,ida-producao.sh,volta-producao.sh}` (fora do git) | receita de travas do G-migration F1 (`aplica_v2`) + ensaio local + produção + volta de emergência | 1, 9 |
| `src/components/planejamento/modelo-shared.ts` (mod.) | `Draft` +13 campos, `emptyDraft`, `draftFromModeloRow` | 2 |
| `planejamento-detail/helpers.ts` (mod.) | rótulos de conflito; `CAMPOS_DEV_DRAFT`, `textoOuNull`, `aplicarRegrasCamposDev`, `camposParaDuplicar` | 2 |
| `planejamento-detail/usePlanejamentoSave.ts` (mod.) | payload pelas regras (T2); invalida condições (T5) e composição (T6); card novo: insert-uma-vez + `onCreated` (T7) | 2, 5, 6, 7 |
| `planejamento-detail/InfoGeraisSecao.tsx` (mod.) | Descrição do produto (fim da seção 1) + Estilista "— Nenhum —" | 3 |
| `planejamento-detail/campos.tsx` (mod.) | `FieldSelect` com `onLimpar?` opcional ("— Nenhum —") | 3 |
| `planejamento-detail/ficha/etapa-kanban.ts` (novo, puro) | coluna efetiva, gate do campo REF, `podeEntrarHoje` (espelho do board), opções do "Mover para…" com a chave desligada | 4 |
| `planejamento-detail/ficha/useFichaKanban.ts` (novo) | config da loja (`tenant_config` `select("*")`) + condições do card + derivados | 4 |
| `planejamento-detail/ficha/secoes/DevEquipeSection.tsx` (novo) | seção "Desenvolvimento — equipe e cronograma" (cópia adaptada do Dev) | 5 |
| `planejamento-detail/ficha/secoes/MotivoCancelamento.tsx` (novo) | Motivo do Cancelamento no topo, só em Reprovado | 5 |
| `planejamento-detail/ficha/secoes/AvisoCamposDev.tsx` (novo) | aviso "travado / somente leitura" nas seções do Dev | 5 |
| `planejamento-detail/ficha/secoes/AnexosDevCampos.tsx` (novo) | Ficha de Medida + Observações Gerais dentro de Anexos | 6 |
| `planejamento-detail/ficha/etapa-mover.ts` (novo, puro; consome F2) | opções do "Mover para…" com a chave ligada + "Próxima: X — falta: Y" | 8 |
| `planejamento-detail/ficha/useMoverEtapa.ts` (novo; consome F2) | mutation do "Mover para…" (RPC `kanban_mover` ou regras de hoje) | 8 |
| `planejamento-detail/ficha/EtapaHeader.tsx` (novo; consome F2) | selo + Popover "Mover para…" + "Próxima" | 8 |
| `PlanejamentoDetail.tsx` (mod.) | fiação: permissões + query do modelo e trava logo depois delas (T2, T5), seções (T5, T6), ordem do mockup — "Tecido Planejado" antes do Preço/MO — e rótulo "Obs. Mão de Obra" (T6), wrapper que remonta o card novo (T7), selo (T8) | 2, 5, 6, 7, 8 |
| `tests/unit/planejamento-draft.test.ts` (novo) | Draft/emptyDraft/draftFromModeloRow | 2 |
| `tests/unit/planejamento-detail-helpers.test.ts` (mod.) | rótulos novos + regras de payload + Duplicar | 2 |
| `tests/unit/planejamento-ficha-etapa.test.ts` (novo) | `etapa-kanban.ts` | 4 |
| `tests/unit/planejamento-ficha-mover.test.ts` (novo) | `etapa-mover.ts` | 8 |
| `tests/e2e/f31-qa.spec.ts` (novo, NUNCA commitado) | QA só-leitura com guarda de rede | 10 |

**Fronteiras e o que NÃO entra (vai p/ outra subfase)**
- BOM/tecidos/aviamentos/insumos/grade/custos adicionais/`custo_peca_previsto` → **F3.2** (o `MultiArtigosField` e o `sync-tecidos.ts` continuam como estão aqui).
- CAD, Enviar à Explosão, Ficha Técnica, Importar dados, menu ⋯, remoção do "Ver no Desenvolvimento", **numeração "N." e selos de completude por seção** (mapa próprio seção→condições) → **F3.3** (quando todas as seções existirem; a F3.1 não mexe no `Secao`).
- Origem "Importado" (decisão F3 #3) e grade única de comprado → **F3.4** (muda fluxo de comprado).
- NCM → fora (em discussão).

## 3. Dependências e ordem de merge

**Pré-requisito duro:** F3.0 juntada na `feature/plan-tecido-a1` (a worktree da F3.1 nasce desse HEAD). Task 0 Step 1 confere.

**F3.1 × F2 (em paralelo, outra worktree):**
- Arquivos DISJUNTOS: a F3.1 não toca em nenhum arquivo da F2 (lista nas Global Constraints) — o fix do card novo foi desenhado DENTRO do `PlanejamentoDetail` para não mexer em `criacao.planejamento.tsx`. Não há conflito textual em nenhuma ordem de merge.
- Dependência de API só na **Task 8** (selo + "Mover para…"): precisa das Tasks 1, 3 e 4 da F2 no branch (`src/lib/kanban-auto-ui.ts`, `src/lib/kanban-auto-rpc.ts`, `src/components/shared/EtapaKanbanBadge.tsx`). As Tasks 1–7 só usam a F1-TS que já está no branch.
- Em RUNTIME: com a chave desligada (o normal até a G-chave), o "Mover para…" usa o caminho de hoje (UPDATE + `marcar_etapa_verificada`) e funciona sem a F1 aplicada no banco; o ramo "chave ligada" (`kanban_mover`) só age depois da F1 em produção + G-chave. `useFichaKanban` lê `tenant_config` com `select("*")` → sem a F1, `kanban_automatico` vem ausente = desligada.
- **Ordem (R8 do G-plano conjunto):** F3.0 → (F3.1 Tasks 0–7 ∥ F2) → merge da F3.1 (ou da F3.1a) → **só então nasce a F3.2** (worktree criada do HEAD com a F3.1/F3.1a juntada; a F3.2 escreve por cima do texto FINAL da F3.1 — não roda em paralelo às Tasks 0–7 nem faz rebase sobre elas). Se, ao terminar a Task 7, as Tasks 1/3/4 da F2 JÁ estiverem no branch: rebase, Task 8, QA completo (`F31_SELO=1`), um merge só. **Se a F2 ainda NÃO estiver juntada:** a F3.1 vai em 2 partes — **F3.1a** = Tasks 0–7 + 9 + 10 (QA sem `F31_SELO`) + 11 (merge); a worktree fica; quando as 3 peças da F2 entrarem no branch, **F3.1b** = rebase + Task 8 + QA com `F31_SELO=1` (só o teste desktop e o mobile) + revisão da Task 8 + guardião G-commit + merge. O dono é avisado de que o selo no header chega no 2º merge. Nada da F3.1a depende da F2 nem quebra sem ela.
- **F3.1b × F3.2:** podem correr ao mesmo tempo (a F3.2 não depende da Task 8). As duas mexem no `PlanejamentoDetail.tsx` em pontos DIFERENTES (F3.1b: imports do selo, o bloco logo depois de `const campoVisivelDev = …` e o `<EtapaHeader>` no header) — quem juntar por ÚLTIMO faz rebase, roda os gates e o próprio QA antes do ff.

**F3.1 × F3.2 (em sequência — R8):** mexem nos MESMOS arquivos (`PlanejamentoDetail.tsx`, `usePlanejamentoSave.ts`, `modelo-shared.ts`, `helpers.ts`). **Ordem: F3.1 (ou F3.1a) juntada primeiro; a F3.2 nasce do HEAD com ela** e acrescenta os blocos dela por cima do texto final (blocos novos no `Draft`, no `ROTULO`, na lista `CAMPOS_DEV_DRAFT` e seções no JSX). Interfaces que a F3.2 consome da F3.1:
1. `Draft` (modelo-shared.ts) ganha, depois de `custo_simulado`: `modelista_id`, `piloteiro1_id`, `piloteiro2_id`, `piloteiro3_id` (`string | null`); `data_piloto1`, `data_piloto2`, `data_piloto3`, `data_desenho_tecnico`, `data_aprovacao`, `observacoes_tecnicas`, `motivo_cancelamento`, `ficha_medida_url`, `descricao_produto` (`string`, vazio = `""`). A F3.2 acrescenta os dela (ex.: `proporcoes`, `custos_adicionais`) DEPOIS desse bloco e não os repete.
2. `helpers.ts`: `CAMPOS_DEV_DRAFT` (lista `as const` de chaves do Draft que são do Dev — **a lista ÚNICA da campanha**), `aplicarRegrasCamposDev(payload, draft, { podeEditarDev, refEditavel })` (normaliza vazios → NULL; sem permissão OMITE a lista; REF só quando editável), `camposParaDuplicar(draft)` (tira REF/versão/base e a lista, MENOS `observacoes_gerais`), `textoOuNull(s)`. **A F3.2 acrescenta à `CAMPOS_DEV_DRAFT` os escalares do Dev que ela passar a gravar** (`proporcoes`, `custos_adicionais` — objeto/array, sem normalização) e CONSOME a lista (não cria outra: o Duplicar dela usa o `camposParaDuplicar` da F3.1) — assim somem do payload sem permissão e do Duplicar (decisão 9) sem código novo.
3. Orquestrador: `podeVerDev`, `podeEditarDev`, `campoVisivelDev(key)`, `enviadoCad`, `editandoDev`/`setEditandoDev`, `devBloqueado` (`!podeEditarDev || (enviadoCad && !editandoDev)`), `motivoTravaDev` (`MotivoTravaDev`), `kanbanCard` (`FichaKanban`, de `useFichaKanban`). **A query `["modelo", modeloId]` e a trava (`enviadoCad`, `editandoDev`, `devBloqueado`, `motivoTravaDev`) ficam logo DEPOIS de `const podeVerDev = …`** (antes do cálculo de preço), porque a F3.2 passa `motivoTravaDev` ao `useFichaTecnica`, chamado logo depois de `const maoObraPlanejada = maoObraDevLive;` e antes do `const dirty = …`. **O nome `ficha` fica LIVRE para a F3.2** (o plano dela declara `const ficha = useFichaTecnica(...)` no orquestrador). A trava do BOM da F3.2 (`motivoSomenteLeitura`) DERIVA de `motivoTravaDev` (uma trava só, um "Editar" só — R2 do G-plano): soma "enviado à Explosão"/"sem permissão" daqui à trava interina "tem CAD" dela; os avisos dela reusam `AvisoCamposDev` (sem permissão) e seguem o texto daqui (enviado).
7. **Âncoras de texto que a F3.1 deixa (texto FINAL — a Task 0 da F3.2 confere por texto):** em `usePlanejamentoSave.ts`: `import { useRef, type Dispatch, type RefObject, type SetStateAction } from "react";`; a desestruturação termina em `  qc, onSaved, onCreated,`; `return { autoProduto, savedId };`; o INSERT do card novo fica `if (criadoIdRef.current) { savedId = criadoIdRef.current; } else { … criadoIdRef.current = savedId; }` seguido da linha IGUAL `if (savedId) await syncTecidosToDesenvolvimento(savedId, draft.tecidos_planejados);` (a F3.2 põe o `gravarTecidosIniciais` DENTRO do `else`, logo depois de `criadoIdRef.current = savedId;`, e apaga essa linha); o payload vira `aplicarRegrasCamposDev({ ...draft, … }, draft, { podeEditarDev, refEditavel })` e sai o `delete payload.ref;`; a última invalidação do `onSuccess` é `qc.invalidateQueries({ queryKey: ["modelo-composicao", modeloId] });`; o `onSuccess` termina em `if (!isEdit && result?.savedId) onCreated?.(result.savedId);` e o `onError` começa pelo ramo `if (!isEdit && criadoIdRef.current) { … onCreated?.(criadoIdRef.current); return; }`. Em `PlanejamentoDetail.tsx`: `export function PlanejamentoDetail(props: {` (wrapper) + `function PlanejamentoDetailConteudo({`; o `duplicate` usa `...camposParaDuplicar(draft),` (a linha `const { error } = await supabase.from("modelos").insert(payload);` fica IGUAL — âncora da Task 13 da F3.2); a chamada do save termina em `    qc, onSaved: aoSalvar, onCreated,` (**`onCreated` e `aoSalvar` são opcionais/funções — o `tsc` NÃO acusa se sumirem; a F3.2 tem gate de grep para eles**); `const dirty = …` e `{/* SETOR 3 — Preço …` continuam com 1 ocorrência; `<ObsMaoObraField` ganha `label="Obs. Mão de Obra"`.
4. JSX: comentário-âncora `{/* ↓ F3.2: as seções do BOM … entram AQUI … */}` (2 linhas) entre "Ajustes na Prova" e "Preço"; LOGO DEPOIS dele vem o comentário `{/* F3.1 — "Tecido Planejado" SUBIU para cá …` + o bloco `{/* SETOR 4 — Tecido Planejado …` (movido na Task 6 — ordem do mockup) e só então o `{/* SETOR 3 — Preço …`. A F3.2 troca o comentário-âncora pelas seções do BOM e o bloco do "Tecido Planejado" (com o comentário da F3.1) pela seção "Tecidos" só do Dialog, no MESMO lugar — assim o Dialog fica Info → Coleção → Tecidos → Mão de obra → Anexos (mockup).
5. `usePlanejamentoSave`: args novos `podeEditarDev`, `refEditavel`, `onCreated?`; `mutationFn` devolve `{ autoProduto, savedId }`; `criadoIdRef` (insert UMA vez; no card novo, gravações seguintes que falham abrem o Sheet do id criado). A reescrita da cadeia na F3.2 PRESERVA: `aplicarRegrasCamposDev` no payload, a guarda `criadoIdRef`, o `onCreated` no fim do `onSuccess` e o ramo "card criado mas algo falhou" no começo do `onError`, o `onSaved: aoSalvar` (re-trava) e as invalidações `["plan-kanban-cond", modeloId]` e `["modelo-composicao", modeloId]`.
6. O Dialog "Novo Modelo" continua sem as seções do Dev (elas exigem o card criado); a gravação do BOM Tecido 1..N no Dialog (G-mockup R3) é da F3.2, **DENTRO do `else` do INSERT real, logo depois de `criadoIdRef.current = savedId;`** — nunca no caminho em que `criadoIdRef.current` já estava preenchido (lá o card já existe e pode ter BOM; `salvar_modelo_bom` APAGA tudo antes de inserir — "só com modelo recém-criado", regra da F3.2).

**F3.1 × F1:** a F1 não mexe no Planejamento nem no Replicar. A migration da F3.1 é independente das `kanban_auto_*` (pode ir a produção antes ou depois delas) e o inverso da F1 não a desfaz.

## 4. Revisão e gates por task

| Task | Revisão | Motivo |
|---|---|---|
| 1 (migration) | **individual Opus** + guardião **G-migration** (com o ensaio da receita de travas na cópia local, Step 8) | banco, função redefinida, inverso, travas |
| 2 (Draft + payload) | **individual Opus** | Salvar, colab/merge, permissão |
| 3 (Descrição UI) + 4 (etapa pura) | **lote A** (1 Opus p/ as 2) | UI pequena + lógica pura com testes |
| 5 (seção 3 + trava + motivo) | **individual Opus** | permissão, trava, REF no payload |
| 6 (Prova + Anexos + Observações) | **lote B** (junto do lote A se este ainda não tiver rodado) | reuso de componentes, sem regra nova |
| 7 (card novo → Sheet) | **individual Opus** | Salvar/criação (bug de duplicar) |
| 8 (selo + Mover para…) | **individual Opus** | etapa fora do Salvar, RPC, colab rev |
| 9 (produção) | guardião G-migration já aprovado + OK do dono | aplicação final |
| 10 (QA) | — | evidência p/ a Task 11 |
| 11 (final) | **code-reviewer Opus no diff inteiro** + suíte INTEIRA 1× na cópia local (R10) + guardião **G-commit** e **G-fase F3.1** | portões da campanha |

O revisor recebe: o diff da(s) task(s) (`git diff <antes>..<depois>`), este plano (seção da task + §3 + §6), e a instrução de conferir arquivo:linha contra o código real. Achado BLOQUEANTE volta para o implementador na mesma worktree; a task só fecha com o revisor OK.

---

### Task 0: Worktree, ferramentas e linha de base

**Files:**
- Create (fora do git): a worktree `$WT`, `$WT/.env` (cópia), `$WT/.superpowers/f31/{gates.sh,unit-fail-t0.txt,suite-fail-t0.txt,logs/}`.

**Interfaces:**
- Consumes: nada.
- Produces: `WT="/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f31-planejamento-campos"`; branch `f31/planejamento-campos`; `.superpowers/f31/gates.sh`; `.superpowers/f31/unit-fail-t0.txt`; `.superpowers/f31/suite-fail-t0.txt` (linha de base da suíte inteira — R10).

- [ ] **Step 1: Pré-voo no checkout principal (só leitura)**

```bash
MAIN="/Users/sunglee/PLM + Criação/plm-pcp"
git -C "$MAIN" branch --show-current
git -C "$MAIN" cat-file -e feature/plan-tecido-a1:src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts && echo "F3.0 juntada: ok"
git -C "$MAIN" diff --name-only savepoint-pre-unificacao-2026-09-22 feature/plan-tecido-a1 -- src/components/desenvolvimento/ src/components/producao/cad/CadTecidosSection.tsx src/components/shared/ModeloObservacoes.tsx; echo "dev-check-fim"
P=docs/superpowers/plans/2026-09-23-planejamento-unificado-f31-campos.md
git -C "$MAIN" status --porcelain -- "$P"; git -C "$MAIN" log -1 --format='%h %s' -- "$P"
ls "$MAIN/.git/index.lock" 2>/dev/null; echo "lock-check-fim"
for f in src/lib/kanban-auto-ui.ts src/lib/kanban-auto-rpc.ts src/components/shared/EtapaKanbanBadge.tsx; do git -C "$MAIN" cat-file -e "feature/plan-tecido-a1:$f" 2>/dev/null && echo "F2 no branch: $f" || echo "F2 AUSENTE: $f"; done
```

Esperado: `feature/plan-tecido-a1`; `F3.0 juntada: ok`; só `dev-check-fim` (nada do Dev mudou); o plano limpo e com um commit `docs(plano): F3.1 …` (o controlador o commita após o G-plano — a Task 0 NÃO commita o plano); só `lock-check-fim`. As 3 linhas da F2 só informam (decidem F3.1 em 1 ou 2 partes — §3).
Se a F3.0 não estiver juntada ou o plano não estiver commitado: PARE e avise o controlador. Se houver `index.lock`: espere; NUNCA apague.

- [ ] **Step 2: Criar a worktree e preparar o projeto**

```bash
MAIN="/Users/sunglee/PLM + Criação/plm-pcp"
WT="$MAIN/.claude/worktrees/f31-planejamento-campos"
git -C "$MAIN" check-ignore -q .claude/worktrees/qualquer && echo "worktrees ignoradas: ok"
git -C "$MAIN" worktree add "$WT" -b f31/planejamento-campos "$(git -C "$MAIN" rev-parse feature/plan-tecido-a1)"
cp "$MAIN/.env" "$WT/.env"
git -C "$WT" check-ignore -q .env && echo ".env ignorado: ok"
cd "$WT" && npm ci
mkdir -p "$WT/.superpowers/f31/logs" && git -C "$WT" check-ignore -q .superpowers/f31/x && echo ".superpowers ignorado: ok"
```

Esperado: as 3 linhas "ok"; `npm ci` sem erro.

- [ ] **Step 3: Criar `.superpowers/f31/gates.sh`**

Criar `$WT/.superpowers/f31/gates.sh` com:

```bash
#!/usr/bin/env bash
# Gates de TODA task de código da F3.1 (sem banco). Uso: .superpowers/f31/gates.sh
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
L=.superpowers/f31/logs; mkdir -p "$L"
echo "== build"
npm run build > "$L/build.log" 2>&1 || { tail -30 "$L/build.log"; echo "BUILD FALHOU"; exit 1; }
git checkout -- src/routeTree.gen.ts 2>/dev/null || true
echo "build ok"
echo "== tsc"
N=$(npx tsc --noEmit 2>&1 | tee "$L/tsc.log" | grep -c "error TS")
echo "tsc erros: $N"; [ "$N" = "0" ] || { grep "error TS" "$L/tsc.log" | head -20; exit 1; }
echo "== unit"
env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit > "$L/unit.log" 2>&1
grep -E "Test Files|Tests " "$L/unit.log" | tail -2
grep -E "^ *FAIL " "$L/unit.log" | sed -E 's/ +[0-9]+ms$//' | sort -u > "$L/unit-fail.txt"
diff -u .superpowers/f31/unit-fail-t0.txt "$L/unit-fail.txt" > /dev/null && echo "falhas = linha de base" || { diff -u .superpowers/f31/unit-fail-t0.txt "$L/unit-fail.txt"; echo "FALHAS MUDARAM"; exit 1; }
echo "== anti-drift nos arquivos da F3.1"
if grep -E "src/components/planejamento/" "$L/unit.log" | grep -iE "antidrift|:[0-9]+" ; then echo "HIT NOVO DO ANTI-DRIFT"; exit 1; else echo "sem hit novo"; fi
echo "== Dev intocado"
D=$(git diff --name-only savepoint-pre-unificacao-2026-09-22 -- src/components/desenvolvimento/ src/components/producao/cad/CadTecidosSection.tsx src/components/shared/ModeloObservacoes.tsx)
[ -z "$D" ] && echo "Dev intocado: ok" || { echo "$D"; echo "DEV MEXIDO — BLOQUEIA"; exit 1; }
echo "== só caminhos da F3.1"
MB=$(git merge-base HEAD feature/plan-tecido-a1)
FORA=$( { git diff --name-only "$MB"; git diff --name-only; git ls-files --others --exclude-standard; } | sort -u \
  | grep -v -E '^(src/components/planejamento/(PlanejamentoDetail\.tsx|modelo-shared\.ts|planejamento-detail/)|supabase/(migrations|rollback)/20260930180000_modelo_descricao_produto|tests/integration/(mig-txn\.ts|modelo-descricao-produto\.test\.ts)|tests/unit/planejamento-|tests/e2e/f31-qa\.spec\.ts)' )
[ -z "$FORA" ] && echo "caminhos: ok" || { echo "$FORA"; echo "ARQUIVO FORA DA F3.1"; exit 1; }
echo "GATES OK"
```

```bash
chmod +x "$WT/.superpowers/f31/gates.sh"
```

- [ ] **Step 4: Linha de base**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f31-planejamento-campos"
npm run build > .superpowers/f31/logs/build-t0.log 2>&1 && echo "build ok"; git checkout -- src/routeTree.gen.ts 2>/dev/null || true
npx tsc --noEmit 2>&1 | grep -c "error TS"
env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit > .superpowers/f31/logs/unit-t0.log 2>&1
grep -E "Test Files|Tests " .superpowers/f31/logs/unit-t0.log | tail -2
grep -E "^ *FAIL " .superpowers/f31/logs/unit-t0.log | sed -E 's/ +[0-9]+ms$//' | sort -u > .superpowers/f31/unit-fail-t0.txt
cat .superpowers/f31/unit-fail-t0.txt
.superpowers/f31/gates.sh
```

Esperado: `build ok`; `0`; as falhas listadas são SÓ do `tests/unit/ui-padroes-antidrift.test.ts` (regras a/e, `DocPrintCasca.tsx`/`OcDocumentoPrint.tsx`); `gates.sh` termina em `GATES OK`. Se aparecer outra falha na linha de base, PARE e reporte (não é da F3.1, mas muda o gate).

- [ ] **Step 5: Linha de base da suíte INTEIRA na cópia local (1×; R10 do G-plano conjunto)**

Só quando NENHUM teste da F1 (nem de outra fase) estiver rodando na cópia local — hoje a F1 não roda testes; se estiver rodando, espere (não mate nada).

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f31-planejamento-campos"
ps -Ao pid,command | grep -E "[v]itest" ; echo "vitest-checado"
PGCONNECT_TIMEOUT=5 psql "postgresql://postgres:postgres@127.0.0.1:54422/postgres" -X -Atc "select 1" && echo "cópia local no ar"
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres npx vitest run --no-file-parallelism tests/unit tests/integration > .superpowers/f31/logs/suite-t0.log 2>&1
grep -E "Test Files|Tests " .superpowers/f31/logs/suite-t0.log | tail -2
grep -E "^ *FAIL " .superpowers/f31/logs/suite-t0.log | sed -E 's/ +[0-9]+ms$//' | sort -u > .superpowers/f31/suite-fail-t0.txt
wc -l < .superpowers/f31/suite-fail-t0.txt
```

Esperado: só `vitest-checado` na 1ª linha (nenhum vitest rodando); `1` + `cópia local no ar`; as contagens registradas. As falhas da linha de base são HERDADAS (não se corrigem aqui) — a Task 11 Step 2 compara contra este arquivo. Se a cópia local estiver fora do ar ou ocupada pela F1: pular este Step, anotar "R10: linha de base da suíte inteira não rodou (<motivo>)" em `.superpowers/f31/logs/r10-desvio.txt` e seguir (o G-commit registra o desvio).

---

### Task 1: Migration `modelos.descricao_produto` + Replicar leva a descrição + inverso + teste na cópia local

**Files:**
- Create: `supabase/migrations/20260930180000_modelo_descricao_produto.sql`, `supabase/rollback/20260930180000_modelo_descricao_produto_down.sql`, `tests/integration/mig-txn.ts`, `tests/integration/modelo-descricao-produto.test.ts`
- Create (fora do git, apoio): `.superpowers/f31/mig/{cabecalho.sql,rodape.sql,inv-cabecalho.sql,inv-rodape.sql,monta.mjs}` e a receita de travas `.superpowers/f31/mig/{aplica.sh,ensaio-local.sh,ida-producao.sh,volta-producao.sh}` (R7 do G-plano conjunto)

**Interfaces:**
- Consumes: `supabase/migrations/20260908240000_plan_tecido_replicar_ref.sql` (corpo vivo, linhas 16–195); `tests/integration/db.ts` (`hasDb`, `withTx`, `comoUsuario`, `um`, `ehBancoLocal`).
- Produces: coluna `public.modelos.descricao_produto text` (nullable, sem default); `_replicar_cards_plan_tecido_core` copiando `o.descricao_produto`; `tests/integration/mig-txn.ts` exporta `exigeBancoLocal(): void`, `semTransacao(sql: string, nome: string): string`, `aplicarSql(c: Client, sql: string, nome: string): Promise<void>`, `aplicarArquivo(c: Client, rel: string): Promise<void>`.

- [ ] **Step 1: Harness mínimo `tests/integration/mig-txn.ts`**

Criar `tests/integration/mig-txn.ts`:

```ts
/**
 * Harness mínimo p/ aplicar um arquivo de migration/inverso DENTRO da transação do `withTx`
 * (F3.1 — `modelos.descricao_produto`). Mesmas travas do harness da F1 (tests/integration/kanban-auto.test.ts:56-128,
 * que é local àquele arquivo e não é mexido aqui):
 *   • SÓ na cópia local (decisão 17 do dono; incidente 23/set: DDL em txn contra produção trava o app
 *     de todas as lojas mesmo com ROLLBACK) — `exigeBancoLocal()` é a 1ª linha de `aplicarSql`;
 *   • exatamente 1 `BEGIN;` e 1 `COMMIT;` em linha própria, que são removidos; nenhum outro controle de
 *     transação fora de corpo `$…$`; nenhum meta-comando psql. NUNCA `\i` (o COMMIT do arquivo fecharia a
 *     txn e VAZARIA — incidente 15/set).
 *   • SAVEPOINT em volta: se o SQL falhar, volta ao savepoint e relança (a txn do teste segue usável).
 */
import type { Client } from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ehBancoLocal } from "./db";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const RE_BEGIN = /^[ \t]*BEGIN[ \t]*;[ \t]*$/im;
const RE_COMMIT = /^[ \t]*COMMIT[ \t]*;[ \t]*$/im;
const todas = (re: RegExp) => new RegExp(re.source, "gim");
const RE_COMENTARIO_LINHA = /--[^\n]*/g;
const RE_COMENTARIO_BLOCO = /\/\*[\s\S]*?\*\//g;
const RE_TXN_CTRL_SOLTA =
  /(^|;)[ \t]*(BEGIN|COMMIT|ROLLBACK|ABORT|START[ \t]+TRANSACTION|SAVEPOINT|RELEASE|END(?!\s*(IF|LOOP|CASE|WHILE)\b))\b[^\n]*;/im;

export function exigeBancoLocal(): void {
  if (!ehBancoLocal()) {
    throw new Error(
      "DDL/migration só na cópia local (DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres). " +
        "DDL em transação contra produção trava o app de todas as lojas mesmo com ROLLBACK (incidente 23/set).",
    );
  }
}

export function semTransacao(sql: string, nome: string): string {
  const nb = (sql.match(todas(RE_BEGIN)) ?? []).length;
  const nc = (sql.match(todas(RE_COMMIT)) ?? []).length;
  if (nb !== 1 || nc !== 1) {
    throw new Error(`${nome}: esperado 1 "BEGIN;" e 1 "COMMIT;" em linha própria (achei ${nb}/${nc})`);
  }
  const out = sql
    .replace(todas(RE_BEGIN), "-- [harness] BEGIN removido")
    .replace(todas(RE_COMMIT), "-- [harness] COMMIT removido");
  const foraDeCorpos = out
    .replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, "")
    .replace(RE_COMENTARIO_BLOCO, "")
    .replace(RE_COMENTARIO_LINHA, "");
  if (RE_TXN_CTRL_SOLTA.test(foraDeCorpos)) {
    throw new Error(`${nome}: controle de transação fora de corpo de função — recusado`);
  }
  if (/^[ \t]*\\/m.test(foraDeCorpos)) throw new Error(`${nome}: meta-comando psql (\\i, \\set…) — recusado`);
  return out;
}

export async function aplicarSql(c: Client, sql: string, nome: string): Promise<void> {
  exigeBancoLocal();
  await c.query("SAVEPOINT f31_mig");
  try {
    await c.query(semTransacao(sql, nome));
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT f31_mig");
    throw e;
  }
  await c.query("RELEASE SAVEPOINT f31_mig");
}

export async function aplicarArquivo(c: Client, rel: string): Promise<void> {
  await aplicarSql(c, readFileSync(ROOT + rel, "utf8"), rel);
}
```

- [ ] **Step 2: Escrever o teste (vai falhar: os arquivos da migration não existem)**

Criar `tests/integration/modelo-descricao-produto.test.ts`:

```ts
/**
 * F3.1 — coluna `modelos.descricao_produto` + "Replicar card(s)" leva a descrição.
 * Migration supabase/migrations/20260930180000_modelo_descricao_produto.sql e inverso
 * supabase/rollback/20260930180000_modelo_descricao_produto_down.sql.
 *  • Bloco ESTÁTICO (sem banco): os arquivos reproduzem o corpo vivo com SÓ as 2 linhas trocadas, e o ALTER
 *    em `modelos` é o ÚLTIMO comando antes do COMMIT (receita do G-migration da F1 — R7 do G-plano conjunto).
 *  • Bloco DB: aplica DENTRO de BEGIN…ROLLBACK (withTx) — NADA é gravado. ⚠️ DDL SÓ NA CÓPIA LOCAL: o
 *    bloco PULA se DATABASE_URL não for 127.0.0.1:54422 e `aplicarArquivo` recusa (exigeBancoLocal). Inclui a
 *    prova da trava: com `modelos` ocupada por outra conexão, a migration desiste em 55P03 (lock_timeout 500ms)
 *    e NADA fica (nem a função trocada).
 * Rodar: DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres npx vitest run --no-file-parallelism tests/integration/modelo-descricao-produto.test.ts
 */
import { describe, it, expect } from "vitest";
import { Client } from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE, ehBancoLocal, dbUrl } from "./db";
import { aplicarArquivo, exigeBancoLocal, semTransacao } from "./mig-txn";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const LOCAL = ehBancoLocal();
const VIVO = "supabase/migrations/20260908240000_plan_tecido_replicar_ref.sql";
const MIG = "supabase/migrations/20260930180000_modelo_descricao_produto.sql";
const INV = "supabase/rollback/20260930180000_modelo_descricao_produto_down.sql";
const FN = "public._replicar_cards_plan_tecido_core(uuid,uuid,uuid,uuid[],integer)";
const COL_ANTES = "      versao, modelo_base_id, mix_id, ref, ref_auto\n";
const COL_DEPOIS = "      versao, modelo_base_id, mix_id, ref, ref_auto, descricao_produto\n";
const VAL_ANTES = "      v_versao, v_root, o.mix_id, o.ref, o.ref_auto\n";
const VAL_DEPOIS = "      v_versao, v_root, o.mix_id, o.ref, o.ref_auto, o.descricao_produto\n";
const TEXTO = "Vestido midi em linho misto, decote V (ITEST F3.1)";

function corpoDoArquivo(rel: string): string {
  const t = readFileSync(ROOT + rel, "utf8");
  const i = t.indexOf("CREATE OR REPLACE FUNCTION public._replicar_cards_plan_tecido_core(");
  const f = t.indexOf("end $function$;", i);
  if (i < 0 || f < 0) throw new Error(`${rel}: corpo da função não achado`);
  return t.slice(i, f + "end $function$;".length);
}

describe("F3.1 — arquivos da migration (estático, sem banco)", () => {
  it("migration = corpo vivo (20260908240000) com SÓ as 2 linhas do INSERT trocadas", () => {
    const antes = corpoDoArquivo(VIVO);
    expect(antes.split(COL_ANTES).length - 1).toBe(1);
    expect(antes.split(VAL_ANTES).length - 1).toBe(1);
    expect(corpoDoArquivo(MIG)).toBe(antes.replace(COL_ANTES, COL_DEPOIS).replace(VAL_ANTES, VAL_DEPOIS));
  });
  it("inverso restaura o corpo vivo byte a byte e só dropa a coluna POR ÚLTIMO (depois da função e da ACL)", () => {
    const inv = readFileSync(ROOT + INV, "utf8");
    expect(corpoDoArquivo(INV)).toBe(corpoDoArquivo(VIVO));
    const iDrop = inv.indexOf("ALTER TABLE public.modelos DROP COLUMN IF EXISTS descricao_produto;");
    expect(iDrop).toBeGreaterThan(inv.indexOf("end $function$;"));
    expect(iDrop).toBeGreaterThan(inv.lastIndexOf("END $$;"));
    expect(inv.slice(iDrop).replace(/--[^\n]*/g, "").match(/;/g)).toHaveLength(2); // DROP; COMMIT;
    expect(inv).toContain("app.confirmo_apagar_descricao_produto");
  });
  it("migration: aditiva, idempotente, CREATE FUNCTION antes e ALTER POR ÚLTIMO, sem timeout embutido (receita G-migration F1)", () => {
    const m = readFileSync(ROOT + MIG, "utf8");
    const iAlter = m.indexOf("ALTER TABLE public.modelos ADD COLUMN IF NOT EXISTS descricao_produto text;");
    expect(iAlter).toBeGreaterThan(m.indexOf("end $function$;"));
    expect(iAlter).toBeGreaterThan(m.indexOf("REVOKE EXECUTE ON FUNCTION"));
    expect(iAlter).toBeGreaterThan(m.lastIndexOf("END $$;"));
    const depois = m.slice(iAlter).replace(/--[^\n]*/g, "");
    expect(depois.match(/;/g)).toHaveLength(3); // ALTER; COMMENT; COMMIT; — nada mais segura a trava de `modelos`
    expect(depois).toContain("COMMENT ON COLUMN public.modelos.descricao_produto IS");
    expect(depois.trim().endsWith("COMMIT;")).toBe(true);
    // Antes da função: só o BEGIN (as travas SET LOCAL são injetadas pelo aplica_v2, como na F1).
    expect(m.slice(0, m.indexOf("CREATE OR REPLACE FUNCTION")).replace(/--[^\n]*/g, "").trim()).toBe("BEGIN;");
    expect(m).not.toMatch(/DROP\s+COLUMN/i);
    expect(() => semTransacao(m, MIG)).not.toThrow();
    expect(() => semTransacao(readFileSync(ROOT + INV, "utf8"), INV)).not.toThrow();
  });
});

describe("mig-txn — travas do harness (sem banco)", () => {
  it("tira 1 BEGIN;/1 COMMIT; e recusa controle de transação solto", () => {
    expect(semTransacao("BEGIN;\nSELECT 1;\nCOMMIT;\n", "ok")).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/m);
    expect(() => semTransacao("BEGIN;\nSELECT 1; COMMIT;\nCOMMIT;\n", "x")).toThrow(/controle de transação/);
    expect(() => semTransacao("SELECT 1;\n", "x")).toThrow(/1 "BEGIN;"/);
  });
  it("recusa meta-comando psql", () => {
    expect(() => semTransacao("BEGIN;\n\\i outro.sql\nCOMMIT;\n", "x")).toThrow(/meta-comando/);
  });
  it("aceita BEGIN/END de plpgsql dentro de $$", () => {
    expect(() => semTransacao("BEGIN;\nDO $$ BEGIN PERFORM 1; END $$;\nCOMMIT;\n", "ok")).not.toThrow();
  });
});

async function prepara(c: Client) {
  exigeBancoLocal();
  // Mesmo lock_timeout que o aplica_v2 injeta em produção (receita G-migration F1). O transaction_timeout de 3 s
  // NÃO entra aqui: derrubaria a conexão do teste (FATAL 25P04) se a txn do teste passar de 3 s depois do SET —
  // ele é provado no ensaio da cópia local (Step 8) e foi confirmado no PG 17.6 pelo runbook da F1.
  await c.query("SET LOCAL lock_timeout = '500ms'");
  await c.query("SET LOCAL statement_timeout = '60s'");
}
async function def(c: Client): Promise<string> {
  return (await um<{ d: string }>(c, `select pg_get_functiondef($1::regprocedure) d`, [FN])).d;
}
async function acl(c: Client): Promise<string | null> {
  return (await um<{ a: string | null }>(c, `select proacl::text a from pg_proc where oid = $1::regprocedure`, [FN])).a;
}
async function coluna(c: Client) {
  return um<{ data_type: string; is_nullable: string; column_default: string | null } | undefined>(
    c,
    `select data_type, is_nullable, column_default from information_schema.columns
      where table_schema = 'public' and table_name = 'modelos' and column_name = 'descricao_produto'`,
  );
}
async function privs(c: Client) {
  return um<{ anon: boolean; auth: boolean }>(
    c,
    `select has_function_privilege('anon', $1, 'EXECUTE') anon, has_function_privilege('authenticated', $1, 'EXECUTE') auth`,
    [FN],
  );
}

describe.skipIf(!hasDb || !LOCAL)("F3.1 — modelos.descricao_produto (cópia local, txn revertida)", () => {
  it("base: sem a coluna; função = corpo vivo (âncoras 1× cada); ACL fechada", async () => {
    await withTx(async (c) => {
      await prepara(c);
      expect(await coluna(c)).toBeUndefined();
      const d = await def(c);
      expect(d.split(COL_ANTES).length - 1).toBe(1);
      expect(d.split(VAL_ANTES).length - 1).toBe(1);
      const p = await privs(c);
      expect(p.anon).toBe(false);
      expect(p.auth).toBe(false);
    });
  });

  it("migration: coluna text/nullable/sem default; função = antes com SÓ 2 linhas trocadas; ACL igual e fechada", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const antes = await def(c);
      const aclAntes = await acl(c);
      await aplicarArquivo(c, MIG);
      expect(await coluna(c)).toEqual({ data_type: "text", is_nullable: "YES", column_default: null });
      expect(await def(c)).toBe(antes.replace(COL_ANTES, COL_DEPOIS).replace(VAL_ANTES, VAL_DEPOIS));
      expect(await acl(c)).toBe(aclAntes);
      const p = await privs(c);
      expect(p.anon).toBe(false);
      expect(p.auth).toBe(false);
      const cm = await um<{ c: string | null }>(
        c,
        `select col_description('public.modelos'::regclass,
                (select attnum from pg_attribute where attrelid = 'public.modelos'::regclass and attname = 'descricao_produto')) c`,
      );
      expect(cm.c).toMatch(/Descrição do produto/);
    });
  });

  it("receita de travas: com `modelos` ocupada por outra conexão, desiste em 55P03 (lock_timeout 500ms) e NADA fica", async () => {
    exigeBancoLocal();
    // Outra sessão lendo `modelos` numa txn aberta (AccessShare — o que qualquer SELECT do app segura). O ALTER, que
    // é o ÚLTIMO comando, pede ACCESS EXCLUSIVE e espera; em 500 ms desiste. A função (trocada ANTES) volta junto.
    const outra = new Client({ connectionString: dbUrl()!, ssl: false });
    await outra.connect();
    try {
      await outra.query("BEGIN");
      await outra.query("SELECT 1 FROM public.modelos LIMIT 1");
      await withTx(async (c) => {
        await prepara(c);
        const antes = await def(c);
        const t0 = Date.now();
        let codigo: string | undefined;
        try {
          await aplicarArquivo(c, MIG);
        } catch (e) {
          codigo = (e as { code?: string }).code;
        }
        expect(codigo).toBe("55P03");
        expect(Date.now() - t0).toBeLessThan(3000);
        expect(await coluna(c)).toBeUndefined();
        expect(await def(c)).toBe(antes);
      });
    } finally {
      await outra.query("ROLLBACK").catch(() => undefined);
      await outra.end();
    }
  });

  it("migration é idempotente (2× na mesma txn)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await aplicarArquivo(c, MIG);
      const d1 = await def(c);
      await aplicarArquivo(c, MIG);
      expect(await def(c)).toBe(d1);
      expect(await coluna(c)).toBeTruthy();
    });
  });

  it("Replicar card(s) leva a descrição (vazia continua NULL)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await aplicarArquivo(c, MIG);
      await comoUsuario(c);
      await c.query(
        `insert into tenant_config (tenant_id, modules) values ($1, '{"criacao":true,"otb":true}'::jsonb)
         on conflict (tenant_id) do update set modules = tenant_config.modules || '{"criacao":true,"otb":true}'::jsonb`,
        [TENANT_TESTE],
      );
      const col = await um<{ id: string }>(c, `insert into colecoes (nome, status) values ('ITEST-F31-DESC','rascunho') returning id`);
      const com = await um<{ id: string }>(c, `insert into modelos (nome, descricao_produto) values ('ITEST-F31-COM', $1) returning id`, [TEXTO]);
      const sem = await um<{ id: string }>(c, `insert into modelos (nome) values ('ITEST-F31-SEM') returning id`);
      const r = await um<{ out: { origem_modelo_id: string; novo_modelo_id: string }[] }>(
        c,
        `select public.replicar_cards_plan_tecido($1::uuid, null::uuid, array[$2::uuid, $3::uuid], null::integer) out`,
        [col.id, com.id, sem.id],
      );
      expect(r.out).toHaveLength(2);
      const novoCom = r.out.find((x) => x.origem_modelo_id === com.id)!.novo_modelo_id;
      const novoSem = r.out.find((x) => x.origem_modelo_id === sem.id)!.novo_modelo_id;
      const a = await um<{ d: string | null; b: string }>(c, `select descricao_produto d, modelo_base_id b from modelos where id = $1`, [novoCom]);
      expect(a.d).toBe(TEXTO);
      expect(a.b).toBe(com.id);
      const b = await um<{ d: string | null }>(c, `select descricao_produto d from modelos where id = $1`, [novoSem]);
      expect(b.d).toBeNull();
    });
  });

  it("inverso: recusa apagar descrições sem a confirmação; com 'sim' volta a função byte a byte e some a coluna", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const antes = await def(c);
      const aclAntes = await acl(c);
      await aplicarArquivo(c, MIG);
      await comoUsuario(c);
      await c.query(`insert into modelos (nome, descricao_produto) values ('ITEST-F31-INV', 'texto que o DROP apagaria')`);
      await expect(aplicarArquivo(c, INV)).rejects.toThrow(/Descrição do produto/);
      expect(await coluna(c)).toBeTruthy(); // o SAVEPOINT desfez só o inverso
      await c.query("SET LOCAL app.confirmo_apagar_descricao_produto = 'sim'");
      await aplicarArquivo(c, INV);
      expect(await coluna(c)).toBeUndefined();
      expect(await def(c)).toBe(antes);
      expect(await acl(c)).toBe(aclAntes);
      const p = await privs(c);
      expect(p.anon).toBe(false);
      expect(p.auth).toBe(false);
    });
  });

  it("inverso com a coluna só com espaços passa SEM confirmação (não há texto a perder)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const antes = await def(c);
      await aplicarArquivo(c, MIG);
      await comoUsuario(c);
      await c.query(`insert into modelos (nome, descricao_produto) values ('ITEST-F31-ESP', '   ')`);
      await aplicarArquivo(c, INV);
      expect(await coluna(c)).toBeUndefined();
      expect(await def(c)).toBe(antes);
    });
  });

  it("inverso sem a coluna: só recria a função (idempotente)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const antes = await def(c);
      await aplicarArquivo(c, INV);
      expect(await def(c)).toBe(antes);
      expect(await coluna(c)).toBeUndefined();
      await aplicarArquivo(c, INV);
      expect(await def(c)).toBe(antes);
    });
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `cd "$WT" && DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres npx vitest run --no-file-parallelism tests/integration/modelo-descricao-produto.test.ts`
Expected: FAIL nos testes que leem `MIG`/`INV` (ENOENT) — inclusive o da receita de travas; os 3 do `mig-txn` e o "base" PASSAM. Antes de rodar, o controlador confirma que a suíte `kanban-auto` da F1 NÃO está rodando na cópia local.

- [ ] **Step 4: Escrever as partes fixas da migration e do inverso**

Criar `.superpowers/f31/mig/cabecalho.sql`:

```sql
-- F3.1 (Planejamento unificado) — campo NOVO "Descrição do produto" (dono, 22/set/2026) +
-- "Replicar card(s)" do Plan. Tecido LEVA a descrição (dono, 23/set/2026).
--
-- 1) _replicar_cards_plan_tecido_core — reproduz o corpo VIVO (20260908240000 = snapshot
--    savepoints/2026-09-22-pre-unificacao/funcoes.sql:6140-6319) byte a byte, mudando SÓ o INSERT em
--    `modelos`: + coluna `descricao_produto` / + valor `o.descricao_produto`. Diff pg_get_functiondef
--    antes/depois = exatamente essas 2 linhas (tests/integration/modelo-descricao-produto.test.ts).
--    Vem ANTES do ALTER: o plpgsql não resolve coluna na criação (só ao executar), e a função nova só roda
--    depois do COMMIT, com a coluna já criada.
--    ACL: CREATE OR REPLACE preserva o proacl; o REVOKE abaixo só reafirma (invariante #9) e o DO prova com
--    has_function_privilege.
-- 2) modelos.descricao_produto text — ADITIVA: nullable, sem default, sem backfill. POR ÚLTIMO (receita do
--    G-migration da F1, R1): o ALTER pede ACCESS EXCLUSIVE em `modelos` (a tabela mais usada do app), então fica
--    no FIM da transação — a trava dura só o resto do arquivo, não o arquivo inteiro. Nenhum gatilho, condição do
--    kanban ou RPC lê a coluna. Migration PRÓPRIA, fora das kanban_auto_* e do inverso delas: desfazer o kanban
--    nunca apaga descrições.
-- TRAVAS (receita do G-migration da F1): o arquivo NÃO traz timeout. Ele só vai a um banco pelo `aplica_v2` de
-- .superpowers/f31/mig/aplica.sh (plano F3.1, Tasks 1 e 9 — mesmo bloco do runbook da F1, task-18-runbook-v2.md
-- §2-§3): arquivo INTEIRO numa mensagem (psql -X -v ON_ERROR_STOP=1 -c, sem -f), com SET LOCAL lock_timeout de
-- 500 ms e SET LOCAL transaction_timeout de 3 s injetados logo depois do BEGIN; nova tentativa SÓ em
-- 55P03/40P01/25P04. Nunca pelo psql com -f nem por \i (incidentes 15/set e 23/set).
-- ORDEM OBRIGATÓRIA: aplicar em PRODUÇÃO ANTES de qualquer front que grave a coluna (o vite local do dono
-- grava em produção) — pré-condição do QA e do merge da F3.1.
-- Inverso: supabase/rollback/20260930180000_modelo_descricao_produto_down.sql (APAGA as descrições; tem guarda).
BEGIN;
```

Criar `.superpowers/f31/mig/rodape.sql`:

```sql
REVOKE EXECUTE ON FUNCTION public._replicar_cards_plan_tecido_core(uuid, uuid, uuid, uuid[], integer) FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public._replicar_cards_plan_tecido_core(uuid,uuid,uuid,uuid[],integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public._replicar_cards_plan_tecido_core(uuid,uuid,uuid,uuid[],integer)', 'EXECUTE') THEN
    RAISE EXCEPTION '_replicar_cards_plan_tecido_core ficou executável por anon/authenticated (invariante #9)';
  END IF;
END $$;

-- POR ÚLTIMO: ACCESS EXCLUSIVE em `modelos` só daqui até o COMMIT.
ALTER TABLE public.modelos ADD COLUMN IF NOT EXISTS descricao_produto text;
COMMENT ON COLUMN public.modelos.descricao_produto IS
  'Descrição do produto (texto livre do Planejamento — fim da seção 1). F3.1, set/2026.';

COMMIT;
```

Criar `.superpowers/f31/mig/inv-cabecalho.sql`:

```sql
-- INVERSO da 20260930180000_modelo_descricao_produto.sql (F3.1).
-- ⚠️ APAGA TODAS AS DESCRIÇÕES DIGITADAS (DROP COLUMN modelos.descricao_produto). Só rodar com OK do dono e
-- DEPOIS de tirar do ar o front que grava a coluna (senão todo Salvar do Planejamento cai com PGRST204).
-- GUARDA: se existir QUALQUER descrição preenchida, o script ABORTA — a menos que a MESMA TRANSAÇÃO tenha
--   SET LOCAL app.confirmo_apagar_descricao_produto = 'sim'
-- (no aplica_v2: EXTRA_SQL; o volta-producao.sh do plano F3.1, Task 9 Step 4, faz o export e injeta a linha).
-- Antes, EXPORTE o que foi digitado (fora do repo — contém dado de loja):
--   psql "$(cat /tmp/dburl.txt)" -X -c "\copy (SELECT id, tenant_id, nome, ref, descricao_produto FROM public.modelos WHERE length(btrim(descricao_produto)) > 0 ORDER BY tenant_id, nome) TO '/Users/sunglee/PLM + Criação/savepoints/pre-apply-f31-descricao/descricao_produto_backup.csv' CSV HEADER"
-- TRAVAS (receita do G-migration da F1): o arquivo NÃO traz timeout; só vai a um banco pelo `aplica_v2`
-- (arquivo inteiro numa mensagem; lock_timeout de 500 ms e transaction_timeout de 3 s injetados após o BEGIN;
-- nova tentativa só em 55P03/40P01/25P04).
-- Ordem: guarda → restaura _replicar_cards_plan_tecido_core (corpo de 20260908240000 = snapshot, byte a byte)
-- → REVOKE/ACL → DROP COLUMN POR ÚLTIMO. A função volta ANTES do DROP (a versão nova cita o.descricao_produto e
-- quebraria o Replicar). Idempotente: sem a coluna, só recria a função.
BEGIN;

DO $$
DECLARE
  v_n bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'modelos' AND column_name = 'descricao_produto') THEN
    EXECUTE 'SELECT count(*) FROM public.modelos WHERE length(btrim(descricao_produto)) > 0' INTO v_n;
    IF v_n > 0 AND coalesce(current_setting('app.confirmo_apagar_descricao_produto', true), '') <> 'sim' THEN
      RAISE EXCEPTION 'Há % modelo(s) com "Descrição do produto" preenchida — o DROP COLUMN apaga esse texto. Exporte antes (ver o cabeçalho deste arquivo) e rode de novo com SET LOCAL app.confirmo_apagar_descricao_produto = ''sim'' na MESMA transação (EXTRA_SQL do aplica_v2).', v_n
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
END $$;
```

Criar `.superpowers/f31/mig/inv-rodape.sql`:

```sql
REVOKE EXECUTE ON FUNCTION public._replicar_cards_plan_tecido_core(uuid, uuid, uuid, uuid[], integer) FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public._replicar_cards_plan_tecido_core(uuid,uuid,uuid,uuid[],integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public._replicar_cards_plan_tecido_core(uuid,uuid,uuid,uuid[],integer)', 'EXECUTE') THEN
    RAISE EXCEPTION '_replicar_cards_plan_tecido_core ficou executável por anon/authenticated (invariante #9)';
  END IF;
END $$;

-- POR ÚLTIMO (receita do G-migration da F1): ACCESS EXCLUSIVE em `modelos` só daqui até o COMMIT.
ALTER TABLE public.modelos DROP COLUMN IF EXISTS descricao_produto;

COMMIT;
```

Criar `.superpowers/f31/mig/aplica.sh` (receita de travas — as funções `espera`, `ativ_vazio`, `com_travas` e `aplica_v2` são CÓPIA LITERAL do bloco de apoio v2 do runbook da F1, `task-18-runbook-v2.md` §3; só as variáveis e o pré-voo são da F3.1):

```bash
#!/usr/bin/env bash
# Receita de travas da F3.1 (R7 do G-plano conjunto) = o MESMO modelo do runbook da F1
# (.superpowers/sdd/2026-09-22-kanban-automatico-f1-banco/task-18-runbook-v2.md §2-§3; G-migration F1 R1):
#   • o arquivo vai INTEIRO numa mensagem (psql -X -v ON_ERROR_STOP=1 -c, sem -f/-1): sem idas e voltas entre comandos;
#   • SET LOCAL lock_timeout = '500ms' (< deadlock_timeout de 1 s) e SET LOCAL transaction_timeout = '3s' (PG 17)
#     injetados logo depois do `BEGIN;` do próprio arquivo (SET LOCAL morre no COMMIT/ROLLBACK — nada vaza p/ o pooler);
#   • nova tentativa SÓ em 55P03 (lock timeout), 40P01 (deadlock) ou 25P04 (transaction timeout): nada do arquivo
#     fica, mostra o ATIV, espera ESPERA s (padrão 60) e repete; na MAX_FALHAS-ésima (padrão 5) PARA. Outro erro: PARA.
# Uso: SEMPRE num bash, a partir da raiz da worktree — `source .superpowers/f31/mig/aplica.sh` (só define coisas).
[ -n "$BASH_VERSION" ] || { echo 'ERRO: use bash (as funções são de bash)'; return 1 2>/dev/null || exit 1; }
LOCAL="postgresql://postgres:postgres@127.0.0.1:54422/postgres"
MIG=supabase/migrations/20260930180000_modelo_descricao_produto.sql
INV=supabase/rollback/20260930180000_modelo_descricao_produto_down.sql
FN="public._replicar_cards_plan_tecido_core(uuid,uuid,uuid,uuid[],integer)"
MD5_VIVO=e0393c79fb962a068fd7a3e4636acbe6
D="/Users/sunglee/PLM + Criação/savepoints/pre-apply-f31-descricao"
ATIV="select pid, usename, application_name, state, now() - xact_start as idade_txn, left(query, 60) as consulta from pg_stat_activity where datname = current_database() and backend_type = 'client backend' and pid <> pg_backend_pid() and state <> 'idle' and xact_start < now() - interval '5 seconds' order by xact_start"
ESTADO="select (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'modelos' and column_name = 'descricao_produto'), md5(pg_get_functiondef('$FN'::regprocedure))"

# Confere uma consulta de 1 linha contra o valor esperado (sai ≠ 0 e mostra o obtido se diverge)
espera() {  # uso: espera URL "SQL" "valor esperado" "rótulo"
  local v; v=$(psql "$1" -X -q -A -t -F'|' -v ON_ERROR_STOP=1 -c "$2") || { echo "FALHOU ($4): erro de consulta"; return 1; }
  if [ "$v" = "$3" ]; then echo "OK ($4): $v"; else echo "FALHOU ($4): esperado [$3], obtido [$v]"; return 1; fi
}
# Nenhuma transação de cliente ativa há mais de 5 s (mostra quais, se houver)
ativ_vazio() {
  local n; n=$(psql "$1" -X -q -A -t -v ON_ERROR_STOP=1 -c "select count(*) from ($ATIV) a") || return 1
  if [ "$n" = 0 ]; then echo "OK (ATIV): nenhuma transação longa"; return 0; fi
  psql "$1" -X -A -F' | ' -c "$ATIV"; echo "FALHOU (ATIV): $n transação(ões) longa(s) — NÃO aplicar; esperar e repetir; não matar sessão"; return 1
}
# O arquivo com SET LOCAL lock_timeout/transaction_timeout injetados logo depois do `BEGIN;` ($2 = SQL extra na mesma posição).
com_travas() {
  local nb nc
  nb=$(grep -c '^BEGIN;$' "$1"); nc=$(grep -c '^COMMIT;$' "$1")
  if [ "$nb" != 1 ] || [ "$nc" != 1 ]; then echo "ERRO: $1 precisa de exatamente 1 'BEGIN;' e 1 'COMMIT;' em linha própria (achei $nb/$nc)" >&2; return 1; fi
  awk -v extra="${2:-}" '{ print } $0 == "BEGIN;" { print "SET LOCAL lock_timeout = '\''500ms'\'';"; print "SET LOCAL transaction_timeout = '\''3s'\'';"; if (extra != "") print extra }' "$1"
}
# Aplica os arquivos NA ORDEM, cada um numa mensagem. Nova tentativa SÓ em 55P03/40P01/25P04.
aplica_v2() {
  local url="$1"; shift
  local f sql log rc falhas=0
  for f in "$@"; do
    while :; do
      echo "== $f  (início $(date '+%H:%M:%S'))"
      sql="$(com_travas "$f" "${EXTRA_SQL:-}")" || return 1
      log="$(mktemp -t aplica_v2.XXXXXX)"
      /usr/bin/time -p psql "$url" -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -c "$sql" 2>"$log"
      rc=$?
      cat "$log"
      if [ "$rc" = 0 ]; then rm -f "$log"; break; fi
      if grep -Eq '(ERROR|FATAL): +(55P03|40P01|25P04):' "$log"; then
        rm -f "$log"; falhas=$((falhas + 1))
        if [ "$falhas" -ge "${MAX_FALHAS:-5}" ]; then
          echo "PAROU em $f: $falhas falhas de trava/tempo — falar com o dono (não matar sessão)"; return 1
        fi
        echo "-- espera de trava/tempo (falha $falhas de ${MAX_FALHAS:-5}); nada de $f ficou. Transações longas agora:"
        psql "$url" -X -A -F' | ' -c "$ATIV"
        echo "-- nova tentativa de $f em ${ESPERA:-60} s"; sleep "${ESPERA:-60}"
        continue
      fi
      rm -f "$log"; echo "PAROU em $f: erro que NÃO é de trava/tempo (rc=$rc) — PARAR, não repetir"; return 1
    done
  done
}
# Pré-voo (só leitura): arquivos commitados, PG ≥ 17 com transaction_timeout, coluna ausente + função = corpo vivo, ATIV vazio.
prevoo_f31() {
  echo "== pré-voo F3.1 (só leitura) $(date '+%F %T')"
  git diff --quiet HEAD -- "$MIG" "$INV" || { echo "FALHOU (arquivos): alteração não commitada no SQL da F3.1"; return 1; }
  espera "$1" "select current_setting('server_version_num')::int >= 170000 and exists (select 1 from pg_settings where name = 'transaction_timeout')" "t" "PG >= 17 com transaction_timeout" &&
  espera "$1" "$ESTADO" "0|$MD5_VIVO" "coluna ausente + função = corpo vivo (20260908240000)" &&
  psql "$1" -X -A -t -c "show deadlock_timeout" | sed 's/^/INFO deadlock_timeout = /' &&
  ativ_vazio "$1" &&
  echo "== PRÉ-VOO OK $(date '+%T')"
}
# Retrato "antes" (só leitura): definição e ACL da função, fora do repo.
retrato_f31() {
  mkdir -p "$D" &&
  psql "$1" -X -q -A -t -v ON_ERROR_STOP=1 -c "select pg_get_functiondef('$FN'::regprocedure)" > "$D/replicar_core_antes.sql" &&
  psql "$1" -X -q -A -t -v ON_ERROR_STOP=1 -c "select proacl::text from pg_proc where oid = '$FN'::regprocedure" > "$D/replicar_core_acl_antes.txt" &&
  echo "OK (retrato): $D"
}
# Conferência pós-ida (só leitura): coluna, diff da função (só as 2 linhas do INSERT), ACL igual, invariante #9.
confere_ida_f31() {
  espera "$1" "select data_type || '|' || is_nullable || '|' || coalesce(column_default, '-') from information_schema.columns where table_schema = 'public' and table_name = 'modelos' and column_name = 'descricao_produto'" "text|YES|-" "coluna criada" || return 1
  psql "$1" -X -q -A -t -v ON_ERROR_STOP=1 -c "select pg_get_functiondef('$FN'::regprocedure)" > "$D/replicar_core_depois.sql" || return 1
  diff "$D/replicar_core_antes.sql" "$D/replicar_core_depois.sql" > "$D/replicar_core_diff.txt"; cat "$D/replicar_core_diff.txt"
  [ "$(grep -c '^[<>]' "$D/replicar_core_diff.txt")" = 4 ] && grep -q 'o.ref_auto, o.descricao_produto' "$D/replicar_core_diff.txt" \
    && echo "OK (função): só as 2 linhas do INSERT mudaram" || { echo "FALHOU (função): diff inesperado"; return 1; }
  espera "$1" "select proacl::text from pg_proc where oid = '$FN'::regprocedure" "$(cat "$D/replicar_core_acl_antes.txt")" "ACL igual à de antes" &&
  espera "$1" "select has_function_privilege('anon', '$FN', 'EXECUTE'), has_function_privilege('authenticated', '$FN', 'EXECUTE')" "f|f" "invariante #9"
}
```

Criar `.superpowers/f31/mig/ensaio-local.sh` (G-migration F1 R1(f): ensaiar a receita na cópia local — ida → confere → volta → estado inicial):

```bash
#!/usr/bin/env bash
# Ensaio da receita de travas da F3.1 na CÓPIA LOCAL (127.0.0.1:54422). Só com a suíte da F1 PARADA na cópia.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
source .superpowers/f31/mig/aplica.sh || exit 1
ESPERA=3
MAX_FALHAS=3
echo "== ENSAIO F3.1 na cópia local $(date '+%F %T')"
prevoo_f31 "$LOCAL" || exit 1
aplica_v2 "$LOCAL" "$MIG" || exit 1
espera "$LOCAL" "select data_type || '|' || is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'modelos' and column_name = 'descricao_produto'" "text|YES" "ida: coluna criada" || exit 1
espera "$LOCAL" "select md5(pg_get_functiondef('$FN'::regprocedure)) <> '$MD5_VIVO'" "t" "ida: função trocada" || exit 1
ativ_vazio "$LOCAL" || exit 1
aplica_v2 "$LOCAL" "$INV" || exit 1
espera "$LOCAL" "$ESTADO" "0|$MD5_VIVO" "volta: coluna fora + função = corpo vivo" || exit 1
echo "== ENSAIO OK $(date '+%T')"
```

Criar `.superpowers/f31/mig/ida-producao.sh` (usado SÓ na Task 9):

```bash
#!/usr/bin/env bash
# Task 9 — IDA em PRODUÇÃO da migration da F3.1. Só com o G-migration APROVA + o OK explícito do dono (no diário).
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
source .superpowers/f31/mig/aplica.sh || exit 1
PROD="$(cat /tmp/dburl.txt)"
echo "== IDA F3.1 em PRODUÇÃO $(date '+%F %T')"
# Pré-voo e apply num comando só: nenhum intervalo entre conferir e aplicar (runbook F1 §1).
prevoo_f31 "$PROD" && retrato_f31 "$PROD" && aplica_v2 "$PROD" "$MIG" && echo "== IDA OK $(date '+%T')" \
  || { echo "== IDA NÃO CONCLUÍDA (nada do arquivo ficou se o erro foi no apply) — avisar o controlador"; exit 1; }
confere_ida_f31 "$PROD" \
  || { echo "== CONFERÊNCIA FALHOU — avisar o controlador/dono (coluna aditiva; NÃO rodar o inverso sem OK)"; exit 1; }
psql "$PROD" -X -q -v ON_ERROR_STOP=1 -c "NOTIFY pgrst, 'reload schema'" && echo "== PostgREST recarregado"
```

Criar `.superpowers/f31/mig/volta-producao.sh` (NÃO faz parte do fluxo — só emergência, com OK do dono):

```bash
#!/usr/bin/env bash
# VOLTA em PRODUÇÃO — SÓ em emergência, com OK explícito do dono, DEPOIS de tirar do ar o front que grava
# `descricao_produto` (senão todo Salvar do Planejamento cai com PGRST204). Exporta as descrições ANTES.
# Uso: bash .superpowers/f31/mig/volta-producao.sh [--confirmo-apagar-descricoes]
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
source .superpowers/f31/mig/aplica.sh || exit 1
PROD="$(cat /tmp/dburl.txt)"
mkdir -p "$D"
psql "$PROD" -X -q -v ON_ERROR_STOP=1 -c "\copy (SELECT id, tenant_id, nome, ref, descricao_produto FROM public.modelos WHERE length(btrim(descricao_produto)) > 0 ORDER BY tenant_id, nome) TO '$D/descricao_produto_backup.csv' CSV HEADER" \
  || { echo "FALHOU o export — PARE"; exit 1; }
echo "export: $(($(wc -l < "$D/descricao_produto_backup.csv") - 1)) descrição(ões) em $D/descricao_produto_backup.csv"
EXTRA_SQL=""
[ "${1:-}" = "--confirmo-apagar-descricoes" ] && EXTRA_SQL="SET LOCAL app.confirmo_apagar_descricao_produto = 'sim';"
ativ_vazio "$PROD" && aplica_v2 "$PROD" "$INV" \
  && espera "$PROD" "$ESTADO" "0|$MD5_VIVO" "volta: coluna fora + função = corpo vivo" \
  && psql "$PROD" -X -q -c "NOTIFY pgrst, 'reload schema'" && echo "== VOLTA OK"
```

```bash
chmod +x "$WT"/.superpowers/f31/mig/*.sh
```

- [ ] **Step 5: Montar os 2 arquivos a partir do corpo VIVO (nunca redigitar a função)**

Criar `.superpowers/f31/mig/monta.mjs`:

```js
// Monta a migration e o inverso da F3.1 a partir do corpo VIVO de _replicar_cards_plan_tecido_core
// (20260908240000, linhas 16–195 = snapshot de produção). A função NUNCA é redigitada: só 2 trocas exatas.
import fs from "node:fs";
const ORIG = "supabase/migrations/20260908240000_plan_tecido_replicar_ref.sql";
const MIG = "supabase/migrations/20260930180000_modelo_descricao_produto.sql";
const INV = "supabase/rollback/20260930180000_modelo_descricao_produto_down.sql";
const P = ".superpowers/f31/mig/";
const linhas = fs.readFileSync(ORIG, "utf8").split("\n");
const ini = linhas.findIndex((l) => l.startsWith("CREATE OR REPLACE FUNCTION public._replicar_cards_plan_tecido_core("));
const fim = linhas.findIndex((l, i) => i > ini && l === "end $function$;");
if (ini !== 15 || fim !== 194) throw new Error(`âncoras inesperadas: ini=${ini} fim=${fim} (esperado 15/194 = linhas 16/195)`);
const corpoAntes = linhas.slice(ini, fim + 1).join("\n");
const trocas = [
  ["      versao, modelo_base_id, mix_id, ref, ref_auto\n", "      versao, modelo_base_id, mix_id, ref, ref_auto, descricao_produto\n"],
  ["      v_versao, v_root, o.mix_id, o.ref, o.ref_auto\n", "      v_versao, v_root, o.mix_id, o.ref, o.ref_auto, o.descricao_produto\n"],
];
let corpoDepois = corpoAntes;
for (const [de, para] of trocas) {
  const n = corpoDepois.split(de).length - 1;
  if (n !== 1) throw new Error(`troca achou ${n}× (esperado 1): ${de.trim()}`);
  corpoDepois = corpoDepois.replace(de, para);
}
const ler = (f) => fs.readFileSync(P + f, "utf8");
const junta = (cab, corpo, rod) => cab.replace(/\n*$/, "\n\n") + corpo + "\n\n" + rod.replace(/^\n*/, "");
fs.mkdirSync("supabase/rollback", { recursive: true });
fs.writeFileSync(MIG, junta(ler("cabecalho.sql"), corpoDepois, ler("rodape.sql")));
fs.writeFileSync(INV, junta(ler("inv-cabecalho.sql"), corpoAntes, ler("inv-rodape.sql")));
console.log("migration e inverso montados");
```

Run:
```bash
cd "$WT" && node .superpowers/f31/mig/monta.mjs
diff <(sed -n '16,195p' supabase/migrations/20260908240000_plan_tecido_replicar_ref.sql) \
     <(sed -n '/^CREATE OR REPLACE FUNCTION public._replicar_cards_plan_tecido_core/,/^end \$function\$;/p' supabase/migrations/20260930180000_modelo_descricao_produto.sql)
diff <(sed -n '16,195p' supabase/migrations/20260908240000_plan_tecido_replicar_ref.sql) \
     <(sed -n '/^CREATE OR REPLACE FUNCTION public._replicar_cards_plan_tecido_core/,/^end \$function\$;/p' supabase/rollback/20260930180000_modelo_descricao_produto_down.sql) && echo "inverso = vivo"
```
Expected: `migration e inverso montados`; o 1º diff mostra EXATAMENTE 2 linhas trocadas (`81c81`/`92c92` ou equivalente: `ref_auto` → `ref_auto, descricao_produto` e `o.ref_auto` → `o.ref_auto, o.descricao_produto`); `inverso = vivo`. Salvar a saída em `.superpowers/f31/logs/t1-diff-funcao.txt` (evidência do G-migration).

- [ ] **Step 6: Rodar e ver passar**

Run: `cd "$WT" && DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres npx vitest run --no-file-parallelism tests/integration/modelo-descricao-produto.test.ts 2>&1 | tee .superpowers/f31/logs/t1-integracao.log | tail -6`
Expected: `14 passed` (3 estáticos + 3 do harness + 8 no banco, inclusive a desistência em 55P03). Se sair `6 passed | 8 skipped`, o banco NÃO é a cópia local: não conta como teste — corrija o `DATABASE_URL` e rode de novo. Depois conferir que a cópia local ficou como estava: `PGCONNECT_TIMEOUT=5 psql "postgresql://postgres:postgres@127.0.0.1:54422/postgres" -Atc "select count(*) from information_schema.columns where table_schema='public' and table_name='modelos' and column_name='descricao_produto'; select md5(pg_get_functiondef('public._replicar_cards_plan_tecido_core(uuid,uuid,uuid,uuid[],integer)'::regprocedure))"` → `0` e `e0393c79fb962a068fd7a3e4636acbe6`.

- [ ] **Step 7: Gates + commit**

```bash
cd "$WT" && .superpowers/f31/gates.sh
git add -- supabase/migrations/20260930180000_modelo_descricao_produto.sql supabase/rollback/20260930180000_modelo_descricao_produto_down.sql tests/integration/mig-txn.ts tests/integration/modelo-descricao-produto.test.ts
git commit --only -m "feat(planejamento): F3.1 (1) — coluna modelos.descricao_produto + Replicar card(s) leva a descrição (migration própria, inverso com guarda, teste na cópia local)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- supabase/migrations/20260930180000_modelo_descricao_produto.sql supabase/rollback/20260930180000_modelo_descricao_produto_down.sql tests/integration/mig-txn.ts tests/integration/modelo-descricao-produto.test.ts
git show --stat HEAD | tail -n +7
```
Expected: `GATES OK`; commit com SÓ os 4 arquivos. A aplicação em produção é a Task 9.

- [ ] **Step 8: Ensaio da receita de travas na cópia LOCAL (G-migration F1 R1(f))**

É o único apply fora do harness antes da produção — o mesmo ensaio que a F1 fez no Step 1 do runbook. O controlador confirma antes que NENHUM teste (F1 ou F3.1) está rodando na cópia local.

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f31-planejamento-campos"
ps -Ao pid,command | grep -E "[v]itest"; echo "vitest-checado"
bash .superpowers/f31/mig/ensaio-local.sh 2>&1 | tee .superpowers/f31/logs/t1-ensaio-local.log | tail -25
```

Expected: só `vitest-checado` na 1ª consulta; no log, na ordem: `== PRÉ-VOO OK`, os 2 arquivos aplicados (cada um com o `real … s` do `/usr/bin/time`, décimos de segundo), `OK (ida: coluna criada): text|YES`, `OK (ida: função trocada): t`, `OK (volta: coluna fora + função = corpo vivo): 0|e0393c79fb962a068fd7a3e4636acbe6` e `== ENSAIO OK`. Qualquer `FALHOU`/`PAROU`: PARE e reporte (a cópia local pode ter ficado com a coluna — o controlador decide; nunca apagar à mão). Depois: revisão individual Opus + guardião **G-migration** (evidências: `t1-diff-funcao.txt`, `t1-integracao.log`, `t1-ensaio-local.log`, o md5 da cópia local).

---

### Task 2: `Draft` + rótulos + regras do payload (Salvar e Duplicar)

**Files:**
- Modify: `src/components/planejamento/modelo-shared.ts` (Draft :76-106, emptyDraft :107-117, draftFromModeloRow :124-156)
- Modify: `src/components/planejamento/planejamento-detail/helpers.ts` (ROTULO :10-21 + funções novas)
- Modify: `src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts` (import :16, args :19-53, destructure :55-63, payload :72-83)
- Modify: `src/components/planejamento/PlanejamentoDetail.tsx` (import de helpers :68, permissões :102, chamada do save :583-591, duplicate :700-709)
- Test: `tests/unit/planejamento-draft.test.ts` (novo), `tests/unit/planejamento-detail-helpers.test.ts` (mod.)

**Interfaces:**
- Consumes: nada novo.
- Produces:
  - `Draft` com os 13 campos da §3 item 1.
  - `helpers.ts`: `CAMPOS_DEV_DRAFT` (`readonly` de 13 chaves, inclui `observacoes_gerais`), `type CampoDevDraft`, `textoOuNull(s: string | null | undefined): string | null`, `aplicarRegrasCamposDev(payload: Record<string, unknown>, draft: Draft, o: { podeEditarDev: boolean; refEditavel: boolean }): Record<string, unknown>`, `camposParaDuplicar(draft: Draft): Record<string, unknown>`.
  - `UsePlanejamentoSaveArgs` ganha `podeEditarDev: boolean; refEditavel: boolean`.
  - Orquestrador: `const podeEditarDev = canEdit("criacao_desenvolvimento")`.

- [ ] **Step 1: Testes que falham**

Criar `tests/unit/planejamento-draft.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { emptyDraft, draftFromModeloRow } from "@/components/planejamento/modelo-shared";

// F3.1 — o Draft do Planejamento ganha os campos simples vindos do Desenvolvimento + a Descrição do produto.
// A etapa (`status_desenvolvimento`) continua FORA do Draft (muda só pelo "Mover para…" do selo).
const UUIDS = ["modelista_id", "piloteiro1_id", "piloteiro2_id", "piloteiro3_id"] as const;
const TEXTOS = [
  "data_piloto1", "data_piloto2", "data_piloto3", "data_desenho_tecnico", "data_aprovacao",
  "observacoes_tecnicas", "motivo_cancelamento", "ficha_medida_url", "descricao_produto",
] as const;

describe("Draft F3.1", () => {
  it("emptyDraft: uuids null, datas/textos vazios e SEM status_desenvolvimento", () => {
    const d = emptyDraft();
    for (const k of UUIDS) expect(d[k]).toBeNull();
    for (const k of TEXTOS) expect(d[k]).toBe("");
    expect(d).not.toHaveProperty("status_desenvolvimento");
  });
  it("draftFromModeloRow lê as colunas e normaliza null → '' (datas/textos) e ausente → null (uuids)", () => {
    const d = draftFromModeloRow({
      nome: "X", modelista_id: "m1", piloteiro2_id: null, data_piloto1: "2026-09-12", data_piloto2: null,
      observacoes_tecnicas: null, motivo_cancelamento: "Tecido esgotado", ficha_medida_url: "t/fichas/a.pdf",
      descricao_produto: "Vestido midi", status_desenvolvimento: "reprovado",
    });
    expect(d.modelista_id).toBe("m1");
    expect(d.piloteiro2_id).toBeNull();
    expect(d.piloteiro3_id).toBeNull();
    expect(d.data_piloto1).toBe("2026-09-12");
    expect(d.data_piloto2).toBe("");
    expect(d.observacoes_tecnicas).toBe("");
    expect(d.motivo_cancelamento).toBe("Tecido esgotado");
    expect(d.ficha_medida_url).toBe("t/fichas/a.pdf");
    expect(d.descricao_produto).toBe("Vestido midi");
    expect(d).not.toHaveProperty("status_desenvolvimento");
  });
  it("linha vazia ≡ emptyDraft nos campos novos (senão o card abriria 'não salvo' à toa)", () => {
    const a = draftFromModeloRow({});
    const b = emptyDraft();
    for (const k of [...UUIDS, ...TEXTOS]) expect(a[k]).toEqual(b[k]);
  });
});
```

Em `tests/unit/planejamento-detail-helpers.test.ts`, trocar o bloco de imports:

```ts
import {
  rotuloConflitoPlan,
  limparCustoSim,
  invalidarAposAprovarMO,
} from "@/components/planejamento/planejamento-detail/helpers";
```

por:

```ts
import {
  rotuloConflitoPlan,
  limparCustoSim,
  invalidarAposAprovarMO,
  CAMPOS_DEV_DRAFT,
  textoOuNull,
  aplicarRegrasCamposDev,
  camposParaDuplicar,
} from "@/components/planejamento/planejamento-detail/helpers";
import { emptyDraft, type Draft } from "@/components/planejamento/modelo-shared";
```

e acrescentar ao FIM do arquivo:

```ts
// F3.1 — campos vindos do Desenvolvimento + Descrição do produto.
describe("rotuloConflitoPlan — campos da F3.1", () => {
  it("rótulos PT iguais aos do Dev e do mockup", () => {
    expect(rotuloConflitoPlan("ref")).toBe("REF");
    expect(rotuloConflitoPlan("modelista_id")).toBe("Modelista");
    expect(rotuloConflitoPlan("piloteiro1_id")).toBe("Piloteiro 1");
    expect(rotuloConflitoPlan("data_piloto3")).toBe("Data Piloto 3");
    expect(rotuloConflitoPlan("data_desenho_tecnico")).toBe("Data Desenho Técnico");
    expect(rotuloConflitoPlan("data_aprovacao")).toBe("Data Aprovação");
    expect(rotuloConflitoPlan("observacoes_tecnicas")).toBe("Observações Técnicas");
    expect(rotuloConflitoPlan("motivo_cancelamento")).toBe("Motivo do cancelamento");
    expect(rotuloConflitoPlan("ficha_medida_url")).toBe("Ficha de Medida");
    expect(rotuloConflitoPlan("descricao_produto")).toBe("Descrição do produto");
  });
});

describe("CAMPOS_DEV_DRAFT", () => {
  it("toda chave existe no Draft e a etapa NÃO está na lista", () => {
    const d = emptyDraft();
    for (const k of CAMPOS_DEV_DRAFT) expect(d).toHaveProperty(k);
    expect(CAMPOS_DEV_DRAFT).not.toContain("status_desenvolvimento" as never);
    expect(CAMPOS_DEV_DRAFT).toContain("observacoes_gerais");
  });
});

describe("textoOuNull", () => {
  it("vazio/só-espaço/null/undefined → null; texto passa como está", () => {
    expect(textoOuNull("")).toBeNull();
    expect(textoOuNull("   ")).toBeNull();
    expect(textoOuNull(null)).toBeNull();
    expect(textoOuNull(undefined)).toBeNull();
    expect(textoOuNull(" a b ")).toBe(" a b ");
  });
});

describe("aplicarRegrasCamposDev", () => {
  const base = (): Draft => ({
    ...emptyDraft(), nome: "M", ref: " QA1234 ", modelista_id: "m1", data_piloto1: "2026-09-12", data_piloto2: "",
    observacoes_tecnicas: "", motivo_cancelamento: "Motivo", observacoes_gerais: "", ficha_medida_url: "",
  });
  it("com permissão: vazios viram NULL (data vazia daria 22007) e os preenchidos passam", () => {
    const d = base();
    const p = aplicarRegrasCamposDev({ ...d }, d, { podeEditarDev: true, refEditavel: false });
    expect(p.modelista_id).toBe("m1");
    expect(p.piloteiro1_id).toBeNull();
    expect(p.data_piloto1).toBe("2026-09-12");
    expect(p.data_piloto2).toBeNull();
    expect(p.data_desenho_tecnico).toBeNull();
    expect(p.observacoes_tecnicas).toBeNull();
    expect(p.observacoes_gerais).toBeNull();
    expect(p.ficha_medida_url).toBeNull();
    expect(p.motivo_cancelamento).toBe("Motivo"); // nunca apagado por causa da etapa (dono, 23/set)
  });
  it("sem permissão de editar o Dev: nenhum campo do Dev (nem a REF) vai no payload", () => {
    const d = base();
    const p = aplicarRegrasCamposDev({ ...d }, d, { podeEditarDev: false, refEditavel: true });
    for (const k of CAMPOS_DEV_DRAFT) expect(p).not.toHaveProperty(k);
    expect(p).not.toHaveProperty("ref");
    expect(p.nome).toBe("M");
  });
  it("REF só vai quando editável (aparada); vazia vira NULL", () => {
    const d = base();
    expect(aplicarRegrasCamposDev({ ...d }, d, { podeEditarDev: true, refEditavel: true }).ref).toBe("QA1234");
    expect(aplicarRegrasCamposDev({ ...d }, d, { podeEditarDev: true, refEditavel: false })).not.toHaveProperty("ref");
    const v = { ...d, ref: "   " };
    expect(aplicarRegrasCamposDev({ ...v }, v, { podeEditarDev: true, refEditavel: true }).ref).toBeNull();
  });
  it("nunca põe a etapa no payload e não muta a entrada", () => {
    const d = base();
    const entrada: Record<string, unknown> = { ...d };
    const p = aplicarRegrasCamposDev(entrada, d, { podeEditarDev: false, refEditavel: false });
    expect(p).not.toHaveProperty("status_desenvolvimento");
    expect(entrada).toHaveProperty("modelista_id");
    expect(entrada).toHaveProperty("ref");
  });
});

describe("camposParaDuplicar (decisão F3 #9)", () => {
  it("leva Planejamento + tecidos + Obs. Gerais + Descrição; tira REF/versão/base e o resto do Dev", () => {
    const d: Draft = {
      ...emptyDraft(), nome: "M", ref: "QA1", versao: 3, modelo_base_id: "b", tecidos_planejados: ["a1"],
      observacoes_gerais: "og", descricao_produto: "desc", modelista_id: "m1", data_piloto1: "2026-09-12",
      motivo_cancelamento: "x", ficha_medida_url: "f.pdf", observacoes_tecnicas: "ot",
    };
    const p = camposParaDuplicar(d);
    expect(p.nome).toBe("M");
    expect(p.tecidos_planejados).toEqual(["a1"]);
    expect(p.observacoes_gerais).toBe("og");
    expect(p.descricao_produto).toBe("desc");
    for (const k of [
      "ref", "versao", "modelo_base_id", "modelista_id", "piloteiro1_id", "piloteiro2_id", "piloteiro3_id",
      "data_piloto1", "data_piloto2", "data_piloto3", "data_desenho_tecnico", "data_aprovacao",
      "observacoes_tecnicas", "motivo_cancelamento", "ficha_medida_url",
    ]) expect(p).not.toHaveProperty(k);
  });
  it("Descrição só-espaço vira NULL na cópia", () => {
    expect(camposParaDuplicar({ ...emptyDraft(), descricao_produto: "  " }).descricao_produto).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd "$WT" && env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit/planejamento-draft.test.ts tests/unit/planejamento-detail-helpers.test.ts`
Expected: FAIL (exports inexistentes / campos `undefined`).

- [ ] **Step 3: `modelo-shared.ts`**

(a) Trocar a linha

```ts
  ref: string;          // REF do modelo — READ-ONLY no Planejamento (gerada no Desenvolvimento, inv. #11)
```
por
```ts
  ref: string;          // REF do modelo — editável na seção "Desenvolvimento" a partir da etapa configurada (refCampoVisivel); fora disso só exibida (inv. #11)
```

(b) Trocar

```ts
  modelo_base_id: string | null;
  custo_simulado: CustoSimInput;
};
```
por
```ts
  modelo_base_id: string | null;
  custo_simulado: CustoSimInput;
  // ── F3.1 — campos vindos do Desenvolvimento (as MESMAS colunas de `modelos` que o Sheet do Dev grava).
  // Aqui: VER com canView("criacao_desenvolvimento"), EDITAR com canEdit (decisão F3 #8) e travados após
  // Enviar à Explosão (decisão F3 #1). Datas/textos vazios = "" (o Salvar manda NULL — aplicarRegrasCamposDev).
  // A etapa (`status_desenvolvimento`) NÃO entra no Draft: muda só pelo "Mover para…" do selo.
  modelista_id: string | null;
  piloteiro1_id: string | null;
  piloteiro2_id: string | null;
  piloteiro3_id: string | null;
  data_piloto1: string;
  data_piloto2: string;
  data_piloto3: string;
  data_desenho_tecnico: string;
  data_aprovacao: string;
  observacoes_tecnicas: string;
  motivo_cancelamento: string;
  ficha_medida_url: string;
  // Campo NOVO (dono, 22/set): texto longo no fim da seção 1. Coluna `modelos.descricao_produto`
  // (migration 20260930180000) — fora do types.ts até regenerar; o Draft é tipo próprio.
  descricao_produto: string;
};
```

(c) Trocar

```ts
  versao: 1, modelo_base_id: null,
  custo_simulado: {},
});
```
por
```ts
  versao: 1, modelo_base_id: null,
  custo_simulado: {},
  modelista_id: null, piloteiro1_id: null, piloteiro2_id: null, piloteiro3_id: null,
  data_piloto1: "", data_piloto2: "", data_piloto3: "", data_desenho_tecnico: "", data_aprovacao: "",
  observacoes_tecnicas: "", motivo_cancelamento: "", ficha_medida_url: "",
  descricao_produto: "",
});
```

(d) Trocar

```ts
    custo_simulado: (data.custo_simulado ?? {}) as CustoSimInput,
  };
}
```
por
```ts
    custo_simulado: (data.custo_simulado ?? {}) as CustoSimInput,
    modelista_id: data.modelista_id ?? null,
    piloteiro1_id: data.piloteiro1_id ?? null,
    piloteiro2_id: data.piloteiro2_id ?? null,
    piloteiro3_id: data.piloteiro3_id ?? null,
    data_piloto1: data.data_piloto1 ?? "",
    data_piloto2: data.data_piloto2 ?? "",
    data_piloto3: data.data_piloto3 ?? "",
    data_desenho_tecnico: data.data_desenho_tecnico ?? "",
    data_aprovacao: data.data_aprovacao ?? "",
    observacoes_tecnicas: data.observacoes_tecnicas ?? "",
    motivo_cancelamento: data.motivo_cancelamento ?? "",
    ficha_medida_url: data.ficha_medida_url ?? "",
    descricao_produto: data.descricao_produto ?? "",
  };
}
```

- [ ] **Step 4: `helpers.ts`**

(a) Trocar o cabeçalho de imports

```ts
import { useQueryClient } from "@tanstack/react-query";
import { type CustoSimInput } from "@/lib/preco";
```
por
```ts
import { useQueryClient } from "@tanstack/react-query";
import { type CustoSimInput } from "@/lib/preco";
import type { Draft } from "@/components/planejamento/modelo-shared";
```

(b) Trocar

```ts
  versao: "Versão", modelo_base_id: "Modelo base", custo_simulado: "Simulação de custo",
};
```
por
```ts
  versao: "Versão", modelo_base_id: "Modelo base", custo_simulado: "Simulação de custo",
  // F3.1 — campos vindos do Desenvolvimento + Descrição do produto (rótulos do Dev,
  // ModeloDetailPanel.tsx:145-160, e do mockup aprovado).
  ref: "REF", modelista_id: "Modelista",
  piloteiro1_id: "Piloteiro 1", piloteiro2_id: "Piloteiro 2", piloteiro3_id: "Piloteiro 3",
  data_piloto1: "Data Piloto 1", data_piloto2: "Data Piloto 2", data_piloto3: "Data Piloto 3",
  data_desenho_tecnico: "Data Desenho Técnico", data_aprovacao: "Data Aprovação",
  observacoes_tecnicas: "Observações Técnicas", motivo_cancelamento: "Motivo do cancelamento",
  ficha_medida_url: "Ficha de Medida", descricao_produto: "Descrição do produto",
};
```

(c) Acrescentar ao FIM do arquivo:

```ts
// ── F3.1 — regras dos campos vindos do Desenvolvimento no payload do Salvar/Duplicar ──────────────
// Chaves do Draft que são do Desenvolvimento. SEM permissão de editar o Dev, o Salvar as OMITE
// (decisão F3 #8); o Duplicar não as leva, menos Obs. Gerais, que já era copiada (decisão F3 #9).
// A F3.2 acrescenta aqui os escalares do Dev que ela passar a gravar (ex.: proporcoes, custos_adicionais).
export const CAMPOS_DEV_DRAFT = [
  "modelista_id", "piloteiro1_id", "piloteiro2_id", "piloteiro3_id",
  "data_piloto1", "data_piloto2", "data_piloto3", "data_desenho_tecnico", "data_aprovacao",
  "observacoes_tecnicas", "motivo_cancelamento", "ficha_medida_url", "observacoes_gerais",
] as const satisfies readonly (keyof Draft)[];
export type CampoDevDraft = (typeof CAMPOS_DEV_DRAFT)[number];

/** Texto vazio/só-espaço (ou ausente) → NULL; senão o texto como está. */
export function textoOuNull(s: string | null | undefined): string | null {
  return s != null && s.trim() !== "" ? s : null;
}

/**
 * Aplica ao payload (UPDATE ou INSERT de `modelos`) as regras dos campos vindos do Dev. PURO: devolve cópia.
 *  • podeEditarDev → normaliza vazios para NULL (paridade com o Dev, ModeloDetailPanel.tsx:1877-1898 —
 *    data "" daria 22007 no PostgREST). `motivo_cancelamento` vai como está no Draft: a etapa NUNCA o apaga
 *    aqui (dono, 23/set — ao contrário do Dev, que zera fora de Reprovado).
 *  • sem podeEditarDev → as chaves de `CAMPOS_DEV_DRAFT` SAEM do payload (o banco fica com o que tinha).
 *  • REF: só vai quando `refEditavel` (campo visível a partir da etapa configurada E Dev editável, sem
 *    trava), aparada, vazia → NULL; senão SAI do payload, como antes (a REF é do trigger fn_modelo_ref_auto,
 *    invariante #11).
 *  • A etapa (`status_desenvolvimento`) não existe no Draft e nunca é posta aqui.
 */
export function aplicarRegrasCamposDev(
  payload: Record<string, unknown>,
  draft: Draft,
  o: { podeEditarDev: boolean; refEditavel: boolean },
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...payload };
  if (o.podeEditarDev) {
    out.modelista_id = draft.modelista_id || null;
    out.piloteiro1_id = draft.piloteiro1_id || null;
    out.piloteiro2_id = draft.piloteiro2_id || null;
    out.piloteiro3_id = draft.piloteiro3_id || null;
    out.data_piloto1 = draft.data_piloto1 || null;
    out.data_piloto2 = draft.data_piloto2 || null;
    out.data_piloto3 = draft.data_piloto3 || null;
    out.data_desenho_tecnico = draft.data_desenho_tecnico || null;
    out.data_aprovacao = draft.data_aprovacao || null;
    out.observacoes_tecnicas = draft.observacoes_tecnicas || null;
    out.motivo_cancelamento = draft.motivo_cancelamento || null;
    out.ficha_medida_url = draft.ficha_medida_url || null;
    out.observacoes_gerais = draft.observacoes_gerais || null;
  } else {
    for (const k of CAMPOS_DEV_DRAFT) delete out[k];
  }
  const ref = (draft.ref ?? "").trim();
  if (o.podeEditarDev && o.refEditavel) out.ref = ref || null;
  else delete out.ref;
  return out;
}

/**
 * Duplicar (decisão F3 #9): a nova versão herda o de HOJE — Planejamento + tecidos (só o artigo) + Obs. Gerais —
 * e o resto do Desenvolvimento nasce vazio. Tira REF (a nova versão gera a própria), versão e base (o chamador
 * recalcula) e os campos do Dev. A Descrição do produto VAI (é do Planejamento).
 */
export function camposParaDuplicar(draft: Draft): Record<string, unknown> {
  const { versao: _v, modelo_base_id: _b, ref: _r, ...rest } = draft;
  const out: Record<string, unknown> = { ...rest };
  for (const k of CAMPOS_DEV_DRAFT) if (k !== "observacoes_gerais") delete out[k];
  out.descricao_produto = textoOuNull(draft.descricao_produto);
  return out;
}
```

- [ ] **Step 5: `usePlanejamentoSave.ts`**

(a) Trocar
```ts
import { limparCustoSim } from "@/components/planejamento/planejamento-detail/helpers";
```
por
```ts
import { limparCustoSim, aplicarRegrasCamposDev, textoOuNull } from "@/components/planejamento/planejamento-detail/helpers";
```

(b) Trocar
```ts
  podeVerCustos: boolean;
  categorias: CatOpt[];
```
por
```ts
  podeVerCustos: boolean;
  /** F3.1: pode editar o Desenvolvimento? Sem isso os campos do Dev saem do payload (decisão F3 #8). */
  podeEditarDev: boolean;
  /** F3.1: o campo REF está editável na seção "Desenvolvimento"? Só então a REF vai no payload. */
  refEditavel: boolean;
  categorias: CatOpt[];
```

(c) Trocar
```ts
  modeloId, isEdit, isRevenda, paOn, podeEditarPreco, podeVerCustos, categorias,
  draft, setDraft, draftLiveRef,
```
por
```ts
  modeloId, isEdit, isRevenda, paOn, podeEditarPreco, podeVerCustos, podeEditarDev, refEditavel, categorias,
  draft, setDraft, draftLiveRef,
```

(d) Trocar
```ts
      const payload: any = {
        ...draft,
        croqui_url: draft.croqui_url || null,
        desenho_tecnico_url: draft.desenho_tecnico_url || null,
        data_lancamento: draft.data_lancamento || null,
        observacoes_mao_obra: draft.observacoes_mao_obra || null,
        custo_simulado: limparCustoSim(draft.custo_simulado),
      };
      // REF é READ-ONLY no Planejamento (só EXIBIDA) — gerada/gerida no fluxo do Desenvolvimento
      // (ref_auto→ref, invariante #11). Herdada do `...draft` só p/ mostrar; nunca reenviar no save,
      // senão um Salvar disparado por outro campo sobrescreveria a REF que o trigger controla.
      delete payload.ref;
```
por
```ts
      // F3.1: os campos vindos do Dev e a REF passam por `aplicarRegrasCamposDev` (helpers.ts): vazios → NULL,
      // sem permissão do Dev → saem do payload, REF só quando editável (senão sai, como antes — a REF é do
      // trigger fn_modelo_ref_auto, invariante #11). A etapa (`status_desenvolvimento`) não está no Draft.
      const payload: any = aplicarRegrasCamposDev({
        ...draft,
        croqui_url: draft.croqui_url || null,
        desenho_tecnico_url: draft.desenho_tecnico_url || null,
        data_lancamento: draft.data_lancamento || null,
        observacoes_mao_obra: draft.observacoes_mao_obra || null,
        custo_simulado: limparCustoSim(draft.custo_simulado),
        // Campo NOVO (F3.1): vazio/só-espaço vira NULL.
        descricao_produto: textoOuNull(draft.descricao_produto),
      }, draft, { podeEditarDev, refEditavel });
```

- [ ] **Step 6: `PlanejamentoDetail.tsx`**

(a) Trocar
```ts
import { rotuloConflitoPlan, invalidarAposAprovarMO } from "@/components/planejamento/planejamento-detail/helpers";
```
por
```ts
import { rotuloConflitoPlan, invalidarAposAprovarMO, camposParaDuplicar } from "@/components/planejamento/planejamento-detail/helpers";
```

(b) Trocar
```ts
  const podeAprovarMaoObra = canEdit("producao_servico_aprovacao");
```
por
```ts
  const podeAprovarMaoObra = canEdit("producao_servico_aprovacao");
  // F3.1 — campos vindos do Desenvolvimento (decisão F3 #8): EDITAR exige canEdit da página do Dev; sem ela o
  // Salvar OMITE esses campos (`aplicarRegrasCamposDev`). VER (canView) entra com as seções (Task 5).
  const podeEditarDev = canEdit("criacao_desenvolvimento");
```

(c) Trocar
```ts
    modeloId, isEdit, isRevenda, paOn, podeEditarPreco, podeVerCustos, categorias,
    draft, setDraft, draftLiveRef,
```
por
```ts
    modeloId, isEdit, isRevenda, paOn, podeEditarPreco, podeVerCustos, podeEditarDev, categorias,
    // REF segue só-leitura até a seção "Desenvolvimento" existir (a Task 5 passa a calcular `refEditavel`).
    refEditavel: false,
    draft, setDraft, draftLiveRef,
```

(d) Trocar
```ts
      // A cópia mantém o nome do original; a versão é que diferencia.
      // Exclui `ref` do spread: a nova versão NÃO herda a REF do original — nasce sem REF e gera a
      // própria quando chegar ao Desenvolvimento (fluxo ref_auto, invariante #11). REF é read-only aqui.
      const { versao: _v, modelo_base_id: _b, ref: _ref, ...rest } = draft;
      const payload: any = {
        ...rest,
```
por
```ts
      // A cópia mantém o nome do original; a versão é que diferencia. `camposParaDuplicar` (helpers.ts,
      // decisão F3 #9): herda o de hoje (Planejamento + tecidos + Obs. Gerais + Descrição); NÃO herda a REF
      // (a nova versão gera a própria ao chegar ao Desenvolvimento — ref_auto, invariante #11) nem os demais
      // campos do Desenvolvimento (nascem vazios).
      const payload: any = {
        ...camposParaDuplicar(draft),
```

- [ ] **Step 7: Rodar e ver passar**

Run: `cd "$WT" && env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit/planejamento-draft.test.ts tests/unit/planejamento-detail-helpers.test.ts`
Expected: PASS (todos).

- [ ] **Step 8: Gates + commit**

```bash
cd "$WT" && .superpowers/f31/gates.sh
git add -- tests/unit/planejamento-draft.test.ts
git commit --only -m "feat(planejamento): F3.1 (2) — Draft com os campos do Desenvolvimento + Descrição; regras do payload (vazios→NULL, sem permissão omite, REF só editável) e Duplicar (decisão F3 #9)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- src/components/planejamento/modelo-shared.ts src/components/planejamento/planejamento-detail/helpers.ts src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts src/components/planejamento/PlanejamentoDetail.tsx tests/unit/planejamento-draft.test.ts tests/unit/planejamento-detail-helpers.test.ts
git show --stat HEAD | tail -n +7
```
Expected: `GATES OK`; 6 arquivos. Revisão individual Opus (foco: nenhuma data `""` sai no payload; sem permissão nada do Dev sai; REF igual a hoje; Duplicar igual a hoje + Descrição; merge colab estável com os campos novos).

---

### Task 3: "Descrição do produto" na seção 1 + "— Nenhum —" no Estilista

**Files:**
- Modify: `src/components/planejamento/planejamento-detail/campos.tsx` (`FieldSelect` :133-147)
- Modify: `src/components/planejamento/planejamento-detail/InfoGeraisSecao.tsx` (imports, Estilista :46, fim da seção :108-113)

**Interfaces:**
- Consumes: `Draft.descricao_produto` (Task 2).
- Produces: `FieldSelect({ label, value, onChange, options, onLimpar? })` — com `onLimpar` a lista ganha "— Nenhum —" no topo; sem ele, comportamento de hoje (a rota `criacao.planejamento.tsx` continua igual).

- [ ] **Step 1: `campos.tsx` — trocar o `FieldSelect` inteiro**

Trocar
```tsx
export function FieldSelect({ label, value, onChange, options }: {
  label: string; value: string | null; onChange: (v: string) => void; options: Opt[];
}) {
  return (
    <div className="grid gap-1">
      <Label>{label}</Label>
      <Select value={value ?? ""} onValueChange={onChange}>
        <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
        <SelectContent>
          {options.map((o) => <SelectItem key={o.id} value={o.id}>{o.nome}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}
```
por
```tsx
// Valor-sentinela da opção "— Nenhum —" (o Radix Select não aceita item com value "").
const OPCAO_NENHUM = "__nenhum__";
export function FieldSelect({ label, value, onChange, options, onLimpar }: {
  label: string; value: string | null; onChange: (v: string) => void; options: Opt[];
  // F3.1 (opcional): com `onLimpar`, a lista ganha "— Nenhum —" no topo, que ZERA o campo (mockup: Estilista
  // "ganha '— Nenhum —' p/ limpar"; Modelista/Piloteiros idem). Sem ele, igual a antes.
  onLimpar?: () => void;
}) {
  return (
    <div className="grid gap-1">
      <Label>{label}</Label>
      <Select value={value ?? ""} onValueChange={(v) => (v === OPCAO_NENHUM ? onLimpar?.() : onChange(v))}>
        <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
        <SelectContent>
          {onLimpar && <SelectItem value={OPCAO_NENHUM}>— Nenhum —</SelectItem>}
          {options.map((o) => <SelectItem key={o.id} value={o.id}>{o.nome}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}
```

- [ ] **Step 2: `InfoGeraisSecao.tsx`**

(a) Trocar as linhas 3–4 do cabeçalho
```ts
// estado continua no orquestrador e chega por props com os MESMOS nomes. A F3.1 acrescenta aqui, no
// fim da seção (antes do `</Secao>`), o campo "Descrição do produto".
```
por
```ts
// estado continua no orquestrador e chega por props com os MESMOS nomes. F3.1: "Descrição do produto" no
// fim da seção (último campo, largura total) e "— Nenhum —" no Estilista.
```

(b) Trocar
```ts
import { NumberInput } from "@/components/shared/NumberInput";
```
por
```ts
import { NumberInput } from "@/components/shared/NumberInput";
import { Textarea } from "@/components/ui/textarea";
```

(c) Trocar
```tsx
              <FieldSelect label={fl("estilista")} value={draft.estilista_id} onChange={(v) => setDraftTracked((d) => ({ ...d, estilista_id: v }))} options={estilistas} />
```
por
```tsx
              <FieldSelect
                label={fl("estilista")}
                value={draft.estilista_id}
                onChange={(v) => setDraftTracked((d) => ({ ...d, estilista_id: v }))}
                onLimpar={() => setDraftTracked((d) => ({ ...d, estilista_id: null }))}
                options={estilistas}
              />
```

(d) Trocar
```tsx
                options={sub2Opts.filter((s) => s.categoria_id === draft.categoria_principal_id)}
              />
            </div>
          </Secao>
```
por
```tsx
                options={sub2Opts.filter((s) => s.categoria_id === draft.categoria_principal_id)}
              />
            </div>

            {/* Campo NOVO "Descrição do produto" (dono, 22/set): texto longo, largura total, ÚLTIMO campo da
                seção 1 — no Sheet e no Dialog de card novo. Coluna `modelos.descricao_produto` (migration
                20260930180000); o Salvar manda NULL quando vazio. Não vai para a Ficha Técnica (não pedido). */}
            <div className="grid gap-1">
              <Label>Descrição do produto</Label>
              <Textarea
                rows={3}
                placeholder="Descreva o produto…"
                value={draft.descricao_produto}
                onChange={(e) => setDraftTracked((d) => ({ ...d, descricao_produto: e.target.value }))}
                data-colab-path="descricao_produto"
              />
            </div>
          </Secao>
```

- [ ] **Step 3: Gates + commit**

```bash
cd "$WT" && .superpowers/f31/gates.sh
git commit --only -m "feat(planejamento): F3.1 (3) — Descrição do produto no fim da seção 1 (Sheet e Dialog) + '— Nenhum —' no Estilista

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- src/components/planejamento/planejamento-detail/campos.tsx src/components/planejamento/planejamento-detail/InfoGeraisSecao.tsx
git show --stat HEAD | tail -n +7
```
Expected: `GATES OK`; 2 arquivos. (Revisão no lote A, com a Task 4. Conferência visual na Task 10.)

---

### Task 4: Etapa do card — lógica pura + hook de config/condições (sem UI)

**Files:**
- Create: `src/components/planejamento/planejamento-detail/ficha/etapa-kanban.ts`, `src/components/planejamento/planejamento-detail/ficha/useFichaKanban.ts`
- Test: `tests/unit/planejamento-ficha-etapa.test.ts`

**Interfaces:**
- Consumes (F1-TS no branch): `boardDaLoja`, `derivarModelo`, `lerKanbanAutoConfig`, `normKey`, `statusParaGate`, tipos `Derivacao`/`KanbanAutoConfig`/`ModeloKanban` (`@/lib/kanban-auto`); `refCampoVisivel`, `normalizeKanbanStatuses` (`@/lib/kanban-status`); `requisitosEfetivos`, `requisitosOk`, `Condicao` (`@/lib/kanban-condicoes`); `revendaColunaPermitida`, `revendaRequisitos`, `lerRevendaConfig`, `RevendaConfig` (`@/lib/revenda-config`); `ehOrigemComprada` (`@/lib/origem`); `useActiveTenantId`.
- Produces:
  - `type OpcaoMover = { key: string; label: string; nota: string; bloqueada: boolean }`
  - `statusEfetivoFicha(statusSalvo: string | null | undefined, enviada: boolean, cfg: KanbanAutoConfig): string | null`
  - `refVisivelFicha(o: { cfg: KanbanAutoConfig; refExibirStatus: string | null | undefined; statusEfetivo: string | null; derivacao: Derivacao | null }): boolean`
  - `podeEntrarHoje(o: { origem: string | null | undefined; para: string; cfg: KanbanAutoConfig; cond: Record<string, boolean> }): { ok: boolean; faltando: Condicao[] }`
  - `opcoesMoverHoje(o: { origem: string | null | undefined; statusEfetivo: string | null; cfg: KanbanAutoConfig; cond: Record<string, boolean> }): OpcaoMover[]`
  - `mensagemBloqueioHoje(faltando: { label: string }[]): string`
  - `type FichaKanban = { kanbanCfg; revendaCfg; refExibirStatus: string | null; cond: Record<string, boolean>; condProntas: boolean; modeloKanban: ModeloKanban; statusSalvo: string | null; statusEfetivo: string | null; derivacao: Derivacao | null; refVisivel: boolean; isReprovado: boolean }`
  - `useFichaKanban({ modeloId, modeloData, enviada, lancado }): FichaKanban` — queryKeys `["tenant-plan-ficha-config", tenantId]` (contém "tenant" ⇒ casa `matchTenantConfig`) e `["plan-kanban-cond", modeloId]`.

- [ ] **Step 1: Teste que falha**

Criar `tests/unit/planejamento-ficha-etapa.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Derivacao, KanbanAutoConfig } from "@/lib/kanban-auto";
import {
  mensagemBloqueioHoje, opcoesMoverHoje, podeEntrarHoje, refVisivelFicha, statusEfetivoFicha,
} from "@/components/planejamento/planejamento-detail/ficha/etapa-kanban";

// F3.1 — etapa do card no Sheet unificado. `podeEntrarHoje` é o espelho do `podeEntrar` do board
// (criacao.desenvolvimento.tsx:322-332) — o caminho de HOJE (chave desligada).
const cfg = (over: Partial<KanbanAutoConfig> = {}): KanbanAutoConfig => ({
  kanban_automatico: false, status_kanban: null, kanban_requisitos: {}, kanban_requisitos_excecoes: {},
  revenda_kanban_colunas: [], revenda_kanban_requisitos: {}, ...over,
});

describe("statusEfetivoFicha (≡ coluna onde o board mostra o card)", () => {
  it("antes da Ordem de Criação não há etapa", () => {
    expect(statusEfetivoFicha("em_pilotagem", false, cfg())).toBeNull();
  });
  it("status nulo, órfão ou vazio cai na 1ª coluna; válido fica; normaliza caixa/espaço", () => {
    expect(statusEfetivoFicha(null, true, cfg())).toBe("em_modelagem");
    expect(statusEfetivoFicha("coluna_removida", true, cfg())).toBe("em_modelagem");
    expect(statusEfetivoFicha("stand_by", true, cfg())).toBe("stand_by");
    expect(statusEfetivoFicha(" Stand_By ", true, cfg())).toBe("stand_by");
  });
  it("board customizado (labels) → 1ª coluna dele", () => {
    expect(statusEfetivoFicha(null, true, cfg({ status_kanban: ["Cadastro", "Aprovado"] }))).toBe("cadastro");
  });
});

describe("refVisivelFicha (campo REF da seção 'Desenvolvimento')", () => {
  it("sem etapa (antes da Ordem de Criação) = escondido", () => {
    expect(refVisivelFicha({ cfg: cfg(), refExibirStatus: null, statusEfetivo: null, derivacao: null })).toBe(false);
  });
  it("sem config = a partir de Aprovado (histórico)", () => {
    expect(refVisivelFicha({ cfg: cfg(), refExibirStatus: null, statusEfetivo: "em_modelagem", derivacao: null })).toBe(false);
    expect(refVisivelFicha({ cfg: cfg(), refExibirStatus: null, statusEfetivo: "aprovado", derivacao: null })).toBe(true);
  });
  it("etapa configurada: na etapa ou depois", () => {
    expect(refVisivelFicha({ cfg: cfg(), refExibirStatus: "em_pilotagem", statusEfetivo: "prova_roupa_1", derivacao: null })).toBe(true);
    expect(refVisivelFicha({ cfg: cfg(), refExibirStatus: "em_pilotagem", statusEfetivo: "corte_piloto_3", derivacao: null })).toBe(false);
  });
  it("decisão 10: com a chave LIGADA usa a posição DERIVADA (card fixado em coluna manual)", () => {
    const d: Derivacao = { derivavel: true, entrada: "em_modelagem", alvo: "aprovado", resultado: "stand_by", fixado: true, primeiraFalha: null, faltando: [] };
    expect(refVisivelFicha({ cfg: cfg({ kanban_automatico: true }), refExibirStatus: null, statusEfetivo: "stand_by", derivacao: d })).toBe(true);
    expect(refVisivelFicha({ cfg: cfg({ kanban_automatico: false }), refExibirStatus: null, statusEfetivo: "stand_by", derivacao: d })).toBe(false);
  });
});

describe("podeEntrarHoje (≡ board, chave desligada)", () => {
  const reqs = { em_pilotagem: ["data_piloto1"], prova_roupa_1: ["data_desenho_tecnico"] };
  it("interno: CASCATA — entrar numa etapa exige as anteriores", () => {
    const c = cfg({ kanban_requisitos: reqs });
    expect(podeEntrarHoje({ origem: "interno", para: "corte_piloto_1", cfg: c, cond: {} }).ok).toBe(true);
    const r = podeEntrarHoje({ origem: "interno", para: "prova_roupa_1", cfg: c, cond: {} });
    expect(r.ok).toBe(false);
    expect(r.faltando.map((f) => f.label)).toEqual(["Data de Piloto I preenchida", "Data do Desenho Técnico preenchida"]);
    // Stand By (depois na ordem) herda os requisitos anteriores — é assim no board hoje
    expect(podeEntrarHoje({ origem: "interno", para: "stand_by", cfg: c, cond: {} }).ok).toBe(false);
    expect(podeEntrarHoje({ origem: "interno", para: "prova_roupa_1", cfg: c, cond: { data_piloto1: true, data_desenho_tecnico: true } }).ok).toBe(true);
  });
  it("interno: exceção da etapa libera o herdado", () => {
    const c = cfg({ kanban_requisitos: reqs, kanban_requisitos_excecoes: { stand_by: ["data_piloto1", "data_desenho_tecnico"] } });
    expect(podeEntrarHoje({ origem: "interno", para: "stand_by", cfg: c, cond: {} }).ok).toBe(true);
  });
  it("chave fora do catálogo nunca trava (paridade com requisitosOk)", () => {
    expect(podeEntrarHoje({ origem: "interno", para: "em_pilotagem", cfg: cfg({ kanban_requisitos: { em_pilotagem: ["zzz"] } }), cond: {} }).ok).toBe(true);
  });
  it("comprado (revenda/importado): fluxo próprio, sem cascata", () => {
    const c = cfg({ revenda_kanban_colunas: ["em_modelagem", "aprovado"], revenda_kanban_requisitos: { aprovado: ["preco_venda_preenchido"] } });
    for (const origem of ["revenda", "importado"]) {
      const fora = podeEntrarHoje({ origem, para: "em_pilotagem", cfg: c, cond: {} });
      expect(fora.ok).toBe(false);
      expect(fora.faltando[0].label).toBe("fora do fluxo de comprado");
      expect(podeEntrarHoje({ origem, para: "aprovado", cfg: c, cond: {} }).faltando.map((f) => f.label)).toEqual(["Preço para venda preenchido"]);
      expect(podeEntrarHoje({ origem, para: "aprovado", cfg: c, cond: { preco_venda_preenchido: true } }).ok).toBe(true);
    }
  });
});

describe("opcoesMoverHoje + mensagemBloqueioHoje", () => {
  it("lista o board menos a coluna atual; anota o que falta e marca bloqueada", () => {
    const ops = opcoesMoverHoje({ origem: "interno", statusEfetivo: "em_modelagem", cfg: cfg({ kanban_requisitos: { em_pilotagem: ["data_piloto1"] } }), cond: {} });
    expect(ops.map((o) => o.key)).not.toContain("em_modelagem");
    expect(ops).toHaveLength(13);
    expect(ops.find((o) => o.key === "em_pilotagem")).toEqual({ key: "em_pilotagem", label: "Em Pilotagem", nota: "falta Data de Piloto I preenchida", bloqueada: true });
    expect(ops.find((o) => o.key === "corte_piloto_1")).toEqual({ key: "corte_piloto_1", label: "Corte de Piloto I", nota: "", bloqueada: false });
  });
  it("texto do bloqueio = o do board", () => {
    expect(mensagemBloqueioHoje([{ label: "A" }, { label: "B" }])).toBe("Não pode entrar aqui. Faltam: A, B");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd "$WT" && env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit/planejamento-ficha-etapa.test.ts`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Criar `ficha/etapa-kanban.ts`**

```ts
/**
 * Etapa do kanban no Sheet unificado do Planejamento (F3.1) — funções PURAS (zero React, zero Supabase).
 * A regra do kanban mora em `src/lib/kanban-auto.ts` (espelho do SQL, F1 — NÃO editar) e no board do
 * Desenvolvimento. Aqui só:
 *  • a coluna EFETIVA do card (≡ board: status fora do board/nulo cai na 1ª coluna);
 *  • o gate do campo REF (≡ Dev, `refCampoVisivel`), com a posição DERIVADA quando a chave está ligada
 *    (decisão 10 — `statusParaGate`);
 *  • o "podeEntrar" de HOJE (chave desligada): espelho LITERAL de `criacao.desenvolvimento.tsx:322-332`
 *    (o board não exporta a função) — cascata p/ interno; fluxo de comprado sem cascata.
 */
import { requisitosEfetivos, requisitosOk, type Condicao } from "@/lib/kanban-condicoes";
import { normalizeKanbanStatuses, refCampoVisivel } from "@/lib/kanban-status";
import { boardDaLoja, normKey, statusParaGate, type Derivacao, type KanbanAutoConfig } from "@/lib/kanban-auto";
import { ehOrigemComprada } from "@/lib/origem";
import { revendaColunaPermitida, revendaRequisitos, type RevendaConfig } from "@/lib/revenda-config";

export type OpcaoMover = { key: string; label: string; nota: string; bloqueada: boolean };

/** Coluna onde o board mostra o card (null antes da Ordem de Criação). */
export function statusEfetivoFicha(statusSalvo: string | null | undefined, enviada: boolean, cfg: KanbanAutoConfig): string | null {
  if (!enviada) return null;
  const board = boardDaLoja(cfg);
  const s = normKey(statusSalvo);
  return board.some((c) => c.key === s) ? s : (board[0]?.key ?? null);
}

/** Campo REF visível na seção "Desenvolvimento"? Mesma régua do Dev (`refCampoVisivel`), com a posição
 *  DERIVADA quando a chave está ligada (decisão 10). Sem etapa (antes da Ordem de Criação) = escondido. */
export function refVisivelFicha(o: {
  cfg: KanbanAutoConfig;
  refExibirStatus: string | null | undefined;
  statusEfetivo: string | null;
  derivacao: Derivacao | null;
}): boolean {
  if (!o.statusEfetivo) return false;
  return refCampoVisivel(o.cfg.status_kanban, o.refExibirStatus, o.statusEfetivo, {
    statusGate: statusParaGate(o.cfg.kanban_automatico, o.derivacao, o.statusEfetivo),
  });
}

function revendaDaCfg(cfg: KanbanAutoConfig): RevendaConfig {
  return { colunas: cfg.revenda_kanban_colunas, requisitos: cfg.revenda_kanban_requisitos, campos: {} };
}

/** ≡ `podeEntrar` do board (chave desligada). Condições = estado SALVO (RPC avaliar_condicoes_kanban). */
export function podeEntrarHoje(o: {
  origem: string | null | undefined;
  para: string;
  cfg: KanbanAutoConfig;
  cond: Record<string, boolean>;
}): { ok: boolean; faltando: Condicao[] } {
  if (ehOrigemComprada(o.origem)) {
    const rc = revendaDaCfg(o.cfg);
    if (!revendaColunaPermitida(rc, o.para)) {
      return { ok: false, faltando: [{ key: "__revenda_coluna", label: "fora do fluxo de comprado", modulo: "desenvolvimento" }] };
    }
    return requisitosOk(revendaRequisitos(rc, o.para), o.cond);
  }
  const ordem = normalizeKanbanStatuses(o.cfg.status_kanban).map((s) => s.key);
  return requisitosOk(requisitosEfetivos(o.para, ordem, o.cfg.kanban_requisitos, o.cfg.kanban_requisitos_excecoes), o.cond);
}

/** "Mover para…" com a chave DESLIGADA: todas as colunas do board menos a atual, anotando o que falta. */
export function opcoesMoverHoje(o: {
  origem: string | null | undefined;
  statusEfetivo: string | null;
  cfg: KanbanAutoConfig;
  cond: Record<string, boolean>;
}): OpcaoMover[] {
  return boardDaLoja(o.cfg)
    .filter((c) => c.key !== o.statusEfetivo)
    .map((c) => {
      const { ok, faltando } = podeEntrarHoje({ origem: o.origem, para: c.key, cfg: o.cfg, cond: o.cond });
      return { key: c.key, label: c.label, nota: ok ? "" : `falta ${faltando.map((f) => f.label).join(", ")}`, bloqueada: !ok };
    });
}

/** Mesmo texto do board (criacao.desenvolvimento.tsx:585-590). */
export function mensagemBloqueioHoje(faltando: { label: string }[]): string {
  return `Não pode entrar aqui. Faltam: ${faltando.map((f) => f.label).join(", ")}`;
}
```

- [ ] **Step 4: Criar `ficha/useFichaKanban.ts`**

```ts
/**
 * F3.1 — etapa do card no Sheet unificado: config do kanban da loja + condições do card (estado SALVO) +
 * derivados (coluna efetiva, gate do campo REF, Reprovado). Independe da F2: lê `tenant_config` com
 * `select("*")` (sem a F1 aplicada, `kanban_automatico` vem ausente ⇒ chave desligada — mesmo padrão do
 * useKanbanConfig da F2) sob key PRÓPRIA (contém "tenant" ⇒ o save da Config e o realtime invalidam).
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import {
  derivarModelo, lerKanbanAutoConfig, type Derivacao, type KanbanAutoConfig, type ModeloKanban,
} from "@/lib/kanban-auto";
import { lerRevendaConfig, type RevendaConfig } from "@/lib/revenda-config";
import { refVisivelFicha, statusEfetivoFicha } from "./etapa-kanban";

export type FichaKanban = {
  kanbanCfg: KanbanAutoConfig;
  revendaCfg: RevendaConfig;
  refExibirStatus: string | null;
  /** Condições do card (RPC avaliar_condicoes_kanban) — {} enquanto não carregou ou fora do kanban. */
  cond: Record<string, boolean>;
  /** Condições carregadas (e o card está no kanban). O "Mover para…" só abre com isto. */
  condProntas: boolean;
  modeloKanban: ModeloKanban;
  statusSalvo: string | null;
  statusEfetivo: string | null;
  /** Só com a chave ligada e as condições carregadas; senão null. */
  derivacao: Derivacao | null;
  refVisivel: boolean;
  isReprovado: boolean;
};

export function useFichaKanban({ modeloId, modeloData, enviada, lancado }: {
  modeloId: string | null;
  modeloData: unknown;
  enviada: boolean;
  lancado: boolean;
}): FichaKanban {
  const tenantId = useActiveTenantId();
  const { data: cfgRow } = useQuery({
    queryKey: ["tenant-plan-ficha-config", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.from("tenant_config").select("*").eq("tenant_id", tenantId).maybeSingle();
      if (error) throw error;
      return (data ?? null) as Record<string, unknown> | null;
    },
  });
  const kanbanCfg = useMemo(() => lerKanbanAutoConfig(cfgRow ?? null), [cfgRow]);
  const revendaCfg = useMemo(() => lerRevendaConfig(cfgRow ?? null), [cfgRow]);
  const refExibirStatus = (cfgRow?.ref_exibir_status as string | null | undefined) ?? null;

  const noKanban = !!modeloId && enviada && !lancado;
  const { data: condData, isSuccess } = useQuery({
    queryKey: ["plan-kanban-cond", modeloId],
    enabled: noKanban,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("avaliar_condicoes_kanban" as any, { _ids: [modeloId] });
      if (error) throw error;
      return (((data ?? {}) as Record<string, Record<string, boolean>>)[modeloId as string] ?? {}) as Record<string, boolean>;
    },
  });
  const cond = condData ?? {};
  const condProntas = noKanban && isSuccess;

  const row = (modeloData ?? null) as { origem?: string | null; status_desenvolvimento?: string | null } | null;
  const statusSalvo = row?.status_desenvolvimento ?? null;
  const modeloKanban: ModeloKanban = { origem: row?.origem ?? null, status_desenvolvimento: statusSalvo, ordem_criacao_enviada: enviada, lancado };
  const derivacao = kanbanCfg.kanban_automatico && condProntas ? derivarModelo(modeloKanban, kanbanCfg, cond) : null;
  const statusEfetivo = statusEfetivoFicha(statusSalvo, enviada, kanbanCfg);
  return {
    kanbanCfg, revendaCfg, refExibirStatus, cond, condProntas, modeloKanban, statusSalvo, statusEfetivo, derivacao,
    refVisivel: refVisivelFicha({ cfg: kanbanCfg, refExibirStatus, statusEfetivo, derivacao }),
    isReprovado: statusEfetivo === "reprovado",
  };
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `cd "$WT" && env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit/planejamento-ficha-etapa.test.ts`
Expected: PASS (todos). Se um `expect` do `podeEntrarHoje` divergir, a verdade é o board (`criacao.desenvolvimento.tsx:322-332`) + `kanban-condicoes.ts` — corrigir o TESTE só se o board de fato der outro resultado, nunca editar `src/lib/*`.

- [ ] **Step 6: Gates + commit**

```bash
cd "$WT" && .superpowers/f31/gates.sh
git add -- src/components/planejamento/planejamento-detail/ficha/etapa-kanban.ts src/components/planejamento/planejamento-detail/ficha/useFichaKanban.ts tests/unit/planejamento-ficha-etapa.test.ts
git commit --only -m "feat(planejamento): F3.1 (4) — etapa do card no Sheet: coluna efetiva, gate da REF (posição derivada c/ a chave ligada) e podeEntrar de hoje (puro) + useFichaKanban

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- src/components/planejamento/planejamento-detail/ficha/etapa-kanban.ts src/components/planejamento/planejamento-detail/ficha/useFichaKanban.ts tests/unit/planejamento-ficha-etapa.test.ts
git show --stat HEAD | tail -n +7
```
Expected: `GATES OK`; 3 arquivos. Agora: **revisão do lote A** (Tasks 3 + 4) por 1 Opus.

---

### Task 5: Seção "Desenvolvimento — equipe e cronograma" + Motivo do Cancelamento + permissão + trava pós-Explosão + "Editar"

**Files:**
- Create: `src/components/planejamento/planejamento-detail/ficha/secoes/DevEquipeSection.tsx`, `…/ficha/secoes/MotivoCancelamento.tsx`, `…/ficha/secoes/AvisoCamposDev.tsx`
- Modify: `src/components/planejamento/PlanejamentoDetail.tsx`, `src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts` (onSuccess)

**Interfaces:**
- Consumes: `Draft` (Task 2); `FieldSelect` com `onLimpar` (Task 3); `useFichaKanban` (Task 4).
- Produces:
  - `DevEquipeSection({ draft, setDraftTracked, refVisivel, campoVisivel })`
  - `MotivoCancelamento({ value, onChange })`
  - `type MotivoTravaDev = "enviado" | "sem_permissao" | null`; `AvisoCamposDev({ motivo })` (`data-testid="aviso-campos-dev"`)
  - Orquestrador: `podeVerDev`, a query `["modelo", modeloId]` + `enviadoCad`, `editandoDev`/`setEditandoDev`, `devBloqueado`, `motivoTravaDev` logo depois das permissões (antes de `const maoObraPlanejada` — a F3.2 passa `motivoTravaDev` ao `useFichaTecnica`), `kanbanCard` (NÃO `ficha` — nome reservado à F3.2), `refEditavel`, `campoVisivelDev(key)` antes do merge, `aoSalvar` (re-trava + `onSaved`).

- [ ] **Step 1: Criar `ficha/secoes/AvisoCamposDev.tsx`**

```tsx
// Aviso nas seções vindas do Desenvolvimento quando elas estão SÓ-LEITURA (F3.1): card já enviado à Explosão
// (trava da decisão F3 #1 — "Editar" no rodapé destrava) ou usuário sem permissão de editar o Dev (decisão
// F3 #8). Sem motivo, não renderiza nada.
export type MotivoTravaDev = "enviado" | "sem_permissao" | null;

export function AvisoCamposDev({ motivo }: { motivo: MotivoTravaDev }) {
  if (!motivo) return null;
  return (
    <p data-testid="aviso-campos-dev" className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
      {motivo === "enviado"
        ? "Enviado à Explosão: os campos vindos do Desenvolvimento ficam travados. Use “Editar” no rodapé para alterá-los."
        : "Somente leitura: você não tem permissão para editar o Desenvolvimento."}
    </p>
  );
}
```

- [ ] **Step 2: Criar `ficha/secoes/MotivoCancelamento.tsx`**

```tsx
// Motivo do Cancelamento (veio do Dev — `modelos.motivo_cancelamento`). No TOPO do Sheet (Anotado/Prova do
// mockup: "Topo · aparece quando a etapa é Reprovado"), SÓ com a etapa do kanban em Reprovado. Sair de
// Reprovado NÃO apaga o texto (dono, 23/set): ele fica guardado e só some da tela. A trava/permissão é o
// <fieldset> em volta, no orquestrador.
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function MotivoCancelamento({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div data-testid="motivo-cancelamento" className="mt-2 grid gap-1 rounded-md border border-dashed p-2">
      <Label>Motivo do Cancelamento</Label>
      <Textarea rows={2} value={value} onChange={(e) => onChange(e.target.value)} data-colab-path="motivo_cancelamento" />
    </div>
  );
}
```

- [ ] **Step 3: Criar `ficha/secoes/DevEquipeSection.tsx`**

```tsx
// Seção "Desenvolvimento — equipe e cronograma" do Sheet unificado do Planejamento (F3.1). CÓPIA ADAPTADA do
// cluster "Desenvolvimento" + "Cronograma & pilotos" + "Observações Técnicas" do `ModeloInfoSection` do Dev
// (src/components/desenvolvimento/modelo-detail/ModeloInfoSection.tsx:214-365), que fica INTOCADO (decisão 8).
// Diferenças deliberadas:
//  • estilo de campo do Planejamento (FieldSelect/Label; "— Nenhum —" p/ limpar Modelista/Piloteiros);
//  • Piloto 2/3 visíveis DERIVADOS do draft (o Dev guarda num estado calculado 1× na montagem e não vê um
//    piloto 2 que chega depois por merge do colab — ModeloInfoSection.tsx:94-101);
//  • o cluster "Cronograma & pilotos" some quando a config de revenda esconde todos os campos dele (no Dev
//    vira caixa vazia — fast-follow conhecido) e o "Adicionar Piloto N" só aparece se os campos dele aparecem;
//  • `data-colab-path` em todo input de texto/data (anel de presença + merge por campo).
// O estado mora no orquestrador (`draft`/`setDraftTracked`); a trava (enviado à Explosão / sem permissão) é o
// <fieldset disabled> em volta, no orquestrador.
import { useState, type Dispatch, type SetStateAction } from "react";
import { Plus, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DateField } from "@/components/shared/DateField";
import { useFieldLabels } from "@/hooks/useFieldLabels";
import { type Draft, type Opt } from "@/components/planejamento/modelo-shared";
import { FieldSelect } from "@/components/planejamento/planejamento-detail/campos";

// MESMA queryKey e MESMO shape (Opt[]) do Dev (`useColabs`, ModeloDetailPanel.tsx:3290-3299): cache compartilhado
// sem colisão de forma.
function useColaboradoresTipo(tipo: "modelista" | "piloteiro") {
  return useQuery({
    queryKey: ["colab", tipo],
    queryFn: async () => {
      const { data, error } = await supabase.from("colaboradores").select("id, nome").eq("tipo", tipo).order("nome");
      if (error) throw error;
      return (data ?? []) as Opt[];
    },
  });
}

function CampoData({ label, value, onChange, path }: { label: string; value: string; onChange: (v: string) => void; path: string }) {
  return (
    <div className="grid gap-1">
      <Label>{label}</Label>
      <DateField value={value ?? ""} onChange={(e) => onChange(e.target.value)} data-colab-path={path} />
    </div>
  );
}

const CAMPOS_CRONOGRAMA = [
  "piloteiro1_id", "data_piloto1", "piloteiro2_id", "data_piloto2", "piloteiro3_id", "data_piloto3",
  "data_desenho_tecnico", "data_aprovacao",
] as const;

export function DevEquipeSection({ draft, setDraftTracked, refVisivel, campoVisivel }: {
  draft: Draft;
  setDraftTracked: Dispatch<SetStateAction<Draft>>;
  /** Campo REF a partir da etapa configurada (refCampoVisivel; posição derivada c/ a chave ligada). */
  refVisivel: boolean;
  /** Interno: sempre true. Comprado: config "Fluxo de Revenda" (revendaCampoVisivel). */
  campoVisivel: (key: string) => boolean;
}) {
  const fl = useFieldLabels();
  const { data: modelistas = [] } = useColaboradoresTipo("modelista");
  const { data: piloteiros = [] } = useColaboradoresTipo("piloteiro");
  const [abertos, setAbertos] = useState<Set<2 | 3>>(new Set());
  const set = (patch: Partial<Draft>) => setDraftTracked((d) => ({ ...d, ...patch }));

  const tem2 = !!(draft.piloteiro2_id || draft.data_piloto2);
  const tem3 = !!(draft.piloteiro3_id || draft.data_piloto3);
  const mostra3 = abertos.has(3) || tem3;
  const mostra2 = abertos.has(2) || tem2 || mostra3;
  const ver2 = campoVisivel("piloteiro2_id") || campoVisivel("data_piloto2");
  const ver3 = campoVisivel("piloteiro3_id") || campoVisivel("data_piloto3");
  const remover = (n: 2 | 3) => {
    // Remover o Piloto 2 limpa também o 3 (paridade com o Dev, ModeloInfoSection.tsx:107-120).
    set(n === 2
      ? { piloteiro2_id: null, data_piloto2: "", piloteiro3_id: null, data_piloto3: "" }
      : { piloteiro3_id: null, data_piloto3: "" });
    setAbertos((prev) => {
      const s = new Set(prev);
      s.delete(n);
      if (n === 2) s.delete(3);
      return s;
    });
  };

  const verModelista = campoVisivel("modelista_id");
  const verCronograma = CAMPOS_CRONOGRAMA.some((k) => campoVisivel(k));

  return (
    <div className="space-y-3">
      {(refVisivel || verModelista) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {refVisivel && (
            <div className="grid gap-1">
              <Label>{fl("ref")}</Label>
              <Input className="font-mono" value={draft.ref} onChange={(e) => set({ ref: e.target.value })} data-colab-path="ref" />
            </div>
          )}
          {verModelista && (
            <FieldSelect
              label={fl("modelista")}
              value={draft.modelista_id}
              onChange={(v) => set({ modelista_id: v })}
              onLimpar={() => set({ modelista_id: null })}
              options={modelistas}
            />
          )}
        </div>
      )}

      {verCronograma && (
        <div className="rounded-md border border-dashed p-3 space-y-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Cronograma &amp; pilotos</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {campoVisivel("piloteiro1_id") && (
              <FieldSelect label={`${fl("piloteiro")} 1`} value={draft.piloteiro1_id} onChange={(v) => set({ piloteiro1_id: v })} onLimpar={() => set({ piloteiro1_id: null })} options={piloteiros} />
            )}
            {campoVisivel("data_piloto1") && (
              <CampoData label="Data Piloto 1" value={draft.data_piloto1} onChange={(v) => set({ data_piloto1: v })} path="data_piloto1" />
            )}
            {campoVisivel("data_desenho_tecnico") && (
              <CampoData label="Data Desenho Técnico" value={draft.data_desenho_tecnico} onChange={(v) => set({ data_desenho_tecnico: v })} path="data_desenho_tecnico" />
            )}
            {campoVisivel("data_aprovacao") && (
              <CampoData label="Data Aprovação" value={draft.data_aprovacao} onChange={(v) => set({ data_aprovacao: v })} path="data_aprovacao" />
            )}
          </div>

          {ver2 && mostra2 && (
            <div className="space-y-2 border-t border-dashed pt-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Piloto 2</span>
                <Button type="button" variant="ghost" size="iconSm" aria-label="Remover piloto 2" onClick={() => remover(2)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {campoVisivel("piloteiro2_id") && (
                  <FieldSelect label={`${fl("piloteiro")} 2`} value={draft.piloteiro2_id} onChange={(v) => set({ piloteiro2_id: v })} onLimpar={() => set({ piloteiro2_id: null })} options={piloteiros} />
                )}
                {campoVisivel("data_piloto2") && (
                  <CampoData label="Data Piloto 2" value={draft.data_piloto2} onChange={(v) => set({ data_piloto2: v })} path="data_piloto2" />
                )}
              </div>
            </div>
          )}

          {ver3 && mostra3 && (
            <div className="space-y-2 border-t border-dashed pt-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Piloto 3</span>
                <Button type="button" variant="ghost" size="iconSm" aria-label="Remover piloto 3" onClick={() => remover(3)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {campoVisivel("piloteiro3_id") && (
                  <FieldSelect label={`${fl("piloteiro")} 3`} value={draft.piloteiro3_id} onChange={(v) => set({ piloteiro3_id: v })} onLimpar={() => set({ piloteiro3_id: null })} options={piloteiros} />
                )}
                {campoVisivel("data_piloto3") && (
                  <CampoData label="Data Piloto 3" value={draft.data_piloto3} onChange={(v) => set({ data_piloto3: v })} path="data_piloto3" />
                )}
              </div>
            </div>
          )}

          {((ver2 && !mostra2) || (ver3 && mostra2 && !mostra3)) && (
            <div className="flex gap-2">
              {ver2 && !mostra2 && (
                <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setAbertos((p) => new Set(p).add(2))}>
                  <Plus className="h-4 w-4 mr-1" /> Adicionar Piloto 2
                </Button>
              )}
              {ver3 && mostra2 && !mostra3 && (
                <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setAbertos((p) => new Set(p).add(3))}>
                  <Plus className="h-4 w-4 mr-1" /> Adicionar Piloto 3
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      <div className="grid gap-1">
        <Label>Observações Técnicas</Label>
        <Textarea rows={3} value={draft.observacoes_tecnicas} onChange={(e) => set({ observacoes_tecnicas: e.target.value })} data-colab-path="observacoes_tecnicas" />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Fiação no `PlanejamentoDetail.tsx`**

(a) Trocar
```ts
import { Trash2, Copy, ArrowLeft, Save } from "lucide-react";
```
por
```ts
import { Trash2, Copy, ArrowLeft, Save, Pencil } from "lucide-react";
```

(b) Trocar
```ts
import { usePlanejamentoSave } from "@/components/planejamento/planejamento-detail/usePlanejamentoSave";
```
por
```ts
import { usePlanejamentoSave } from "@/components/planejamento/planejamento-detail/usePlanejamentoSave";
import { useFichaKanban } from "@/components/planejamento/planejamento-detail/ficha/useFichaKanban";
import { DevEquipeSection } from "@/components/planejamento/planejamento-detail/ficha/secoes/DevEquipeSection";
import { MotivoCancelamento } from "@/components/planejamento/planejamento-detail/ficha/secoes/MotivoCancelamento";
import { AvisoCamposDev, type MotivoTravaDev } from "@/components/planejamento/planejamento-detail/ficha/secoes/AvisoCamposDev";
import { revendaCampoVisivel } from "@/lib/revenda-config";
```

(c) A query do modelo SOBE (mesma queryKey, mesmo queryFn — só a posição muda; ela não é lida antes do merge, F3.0 :500). Trocar
```ts
  // Colab (spec 2026-08-03, Task 2): o queryFn agora só BUSCA (sem side-effects de setState —
  // roda em TODO refetch, não só na 1ª carga). Seed/merge acontecem no useEffect abaixo.
  const { data: modeloData } = useQuery({
    queryKey: ["modelo", modeloId],
    enabled: !!modeloId,
    queryFn: async () => {
      if (!modeloId) return null;
      const { data, error } = await supabase.from("modelos").select("*").eq("id", modeloId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // Colab (spec 2026-08-03, Task 2): 1ª carga semeia como sempre; refetch (Realtime/foco de
```
por
```ts
  // Colab (spec 2026-08-03, Task 2): 1ª carga semeia como sempre; refetch (Realtime/foco de
```

(d) Trocar
```ts
  const podeEditarDev = canEdit("criacao_desenvolvimento");
```
por
```ts
  const podeEditarDev = canEdit("criacao_desenvolvimento");
  const podeVerDev = canView("criacao_desenvolvimento");

  // Colab (spec 2026-08-03, Task 2): o queryFn agora só BUSCA (sem side-effects de setState —
  // roda em TODO refetch, não só na 1ª carga). Seed/merge acontecem no useEffect mais abaixo.
  // F3.1: SUBIU para cá (antes vinha logo antes do merge) — a trava dos campos do Dev, logo abaixo, lê
  // `enviado_cad`, e a F3.2 passa essa trava ao `useFichaTecnica`, chamado ANTES do cálculo de preço e do
  // "não salvo". Mesma queryKey, mesmo queryFn; só a posição (e a ordem dos hooks) mudou.
  const { data: modeloData } = useQuery({
    queryKey: ["modelo", modeloId],
    enabled: !!modeloId,
    queryFn: async () => {
      if (!modeloId) return null;
      const { data, error } = await supabase.from("modelos").select("*").eq("id", modeloId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  // ── F3.1 — trava dos campos vindos do Desenvolvimento ──────────────────────────────────────────────
  // Pós-Explosão (decisão F3 #1): SÓ nas seções vindas do Dev (Info Gerais/Coleção/Preço/MO/Lançamento seguem
  // livres). "Editar" destrava; Salvar re-trava (paridade com o Dev, ModeloDetailPanel.tsx:1600, :2273,
  // :3191-3194). Sem canEdit do Dev = sempre só-leitura (decisão F3 #8). É a trava ÚNICA da campanha: a F3.2
  // deriva dela a trava do BOM (`motivoTravaDev` → `useFichaTecnica`).
  const enviadoCad = !!(modeloData as any)?.enviado_cad;
  const [editandoDev, setEditandoDev] = useState(false);
  const devBloqueado = !podeEditarDev || (enviadoCad && !editandoDev);
  const motivoTravaDev: MotivoTravaDev = !podeEditarDev ? "sem_permissao" : enviadoCad && !editandoDev ? "enviado" : null;
```

(e) Inserir IMEDIATAMENTE ANTES da linha
```ts
  // Colab (spec 2026-08-03, Task 2): 1ª carga semeia como sempre; refetch (Realtime/foco de
```
o bloco:
```ts
  // ── F3.1 — etapa do kanban + campos vindos do Desenvolvimento ──────────────────────────────────────
  // Etapa do kanban (estado SALVO) + config da loja: coluna efetiva, gate do campo REF (refCampoVisivel, com
  // a posição DERIVADA quando a chave está ligada — decisão 10) e Reprovado (Motivo do Cancelamento).
  const kanbanCard = useFichaKanban({ modeloId, modeloData, enviada, lancado });
  // REF editável = a seção "Desenvolvimento" mostra o campo (etapa configurada) e os campos do Dev estão livres.
  const refEditavel = isEdit && !devBloqueado && kanbanCard.refVisivel;
  // Comprado (revenda/importado) segue a config "Fluxo de Revenda" da loja (decisão F3 #8; paridade com
  // ModeloDetailPanel.tsx:1574). Interno vê tudo.
  const campoVisivelDev = (key: string) => !isComprado || revendaCampoVisivel(kanbanCard.revendaCfg, key);

```

(f) Trocar
```ts
  // Salvar (+ retry/merge do P0409) — extraído na F3.0 para `planejamento-detail/usePlanejamentoSave.ts`
```
por
```ts
  // Salvar re-trava os campos do Dev quando o card já foi enviado à Explosão (paridade com o Dev,
  // ModeloDetailPanel.tsx:2273) e avisa o container (lista por baixo).
  const aoSalvar = () => { setEditandoDev(false); onSaved(); };

  // Salvar (+ retry/merge do P0409) — extraído na F3.0 para `planejamento-detail/usePlanejamentoSave.ts`
```

(g) Trocar
```ts
    // REF segue só-leitura até a seção "Desenvolvimento" existir (a Task 5 passa a calcular `refEditavel`).
    refEditavel: false,
```
por
```ts
    refEditavel,
```
e trocar
```ts
    qc, onSaved,
  });
```
por
```ts
    qc, onSaved: aoSalvar,
  });
```

(h) Header — trocar
```tsx
              {isEdit && draft.ref && (
                <span className="text-xs font-mono text-muted-foreground">REF {draft.ref}</span>
              )}
```
por
```tsx
              {isEdit && draft.ref && (
                <span className="text-xs font-mono text-muted-foreground">REF {draft.ref}</span>
              )}
              {/* Motivo do Cancelamento (veio do Dev — F3.1): só com a etapa em Reprovado. Sair de Reprovado NÃO
                  apaga o motivo (dono, 23/set) — ele só some da tela. Trava/permissão = fieldset. */}
              {isEdit && podeVerDev && kanbanCard.isReprovado && (
                <fieldset disabled={devBloqueado} className="contents">
                  <MotivoCancelamento
                    value={draft.motivo_cancelamento}
                    onChange={(v) => setDraftTracked((d) => ({ ...d, motivo_cancelamento: v }))}
                  />
                </fieldset>
              )}
```

(i) Seção 3 — trocar
```tsx
          </Secao>

          {/* SETOR 3 — Preço (só na edição; na criação o custo vem do BOM depois) */}
```
por
```tsx
          </Secao>

          {/* Desenvolvimento — equipe e cronograma (veio do Dev, F3.1). Sempre visível — independe da etapa —
              p/ quem vê o Desenvolvimento (decisão F3 #8); recolhida (decisão 6); só no card existente. O
              <fieldset> fica DENTRO da seção (o cabeçalho continua abrindo/fechando com o card travado). */}
          {isEdit && podeVerDev && (
            <Secao titulo="Desenvolvimento — equipe e cronograma" defaultOpen={false}>
              <AvisoCamposDev motivo={motivoTravaDev} />
              <fieldset disabled={devBloqueado} className="contents">
                <DevEquipeSection
                  draft={draft}
                  setDraftTracked={setDraftTracked}
                  refVisivel={kanbanCard.refVisivel}
                  campoVisivel={campoVisivelDev}
                />
              </fieldset>
            </Secao>
          )}

          {/* SETOR 3 — Preço (só na edição; na criação o custo vem do BOM depois) */}
```

(j) Rodapé — inserir IMEDIATAMENTE ANTES da linha
```tsx
          <Button className={`shrink-0 max-sm:aspect-square max-sm:px-0${!isEdit ? " ml-auto" : ""}`} aria-label="Salvar" onClick={handleSave} disabled={save.isPending}>
```
o bloco:
```tsx
          {/* Trava pós-Explosão (decisão F3 #1): "Editar" destrava SÓ os campos vindos do Dev; o Salvar re-trava. */}
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
```

- [ ] **Step 5: `usePlanejamentoSave.ts` — invalidar as condições do card**

Trocar
```ts
      qc.invalidateQueries({ queryKey: ["modelo-grades-revenda", modeloId] });
```
por
```ts
      qc.invalidateQueries({ queryKey: ["modelo-grades-revenda", modeloId] });
      // F3.1: o save muda as condições do kanban (datas/pilotos/anexos…) — refresca o gate da REF com a chave
      // ligada e a dica do "Mover para…".
      qc.invalidateQueries({ queryKey: ["plan-kanban-cond", modeloId] });
```
(Só a 1ª ocorrência — a do `onSuccess`. Conferir com `grep -n 'modelo-grades-revenda' src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts` que a troca caiu no `onSuccess`, não no `onError`.)

- [ ] **Step 6: Gates + commit**

```bash
cd "$WT" && .superpowers/f31/gates.sh
git add -- src/components/planejamento/planejamento-detail/ficha/secoes/DevEquipeSection.tsx src/components/planejamento/planejamento-detail/ficha/secoes/MotivoCancelamento.tsx src/components/planejamento/planejamento-detail/ficha/secoes/AvisoCamposDev.tsx
git commit --only -m "feat(planejamento): F3.1 (5) — seção Desenvolvimento (equipe e cronograma, REF editável pela etapa), Motivo do Cancelamento, permissão do Dev e trava pós-Explosão com Editar

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- src/components/planejamento/planejamento-detail/ficha/secoes/DevEquipeSection.tsx src/components/planejamento/planejamento-detail/ficha/secoes/MotivoCancelamento.tsx src/components/planejamento/planejamento-detail/ficha/secoes/AvisoCamposDev.tsx src/components/planejamento/PlanejamentoDetail.tsx src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts
git show --stat HEAD | tail -n +7
```
Expected: `GATES OK`; 5 arquivos. Revisão individual Opus (foco: fieldset dentro da `Secao`; `devBloqueado`/`refEditavel`; `campoVisivelDev` = Dev; hooks sem condicional; a query `["modelo", modeloId]` só MUDOU DE LUGAR (mesma key/queryFn; `grep -c 'const { data: modeloData } = useQuery' src/components/planejamento/PlanejamentoDetail.tsx` = 1) e a trava fica ANTES de `const maoObraPlanejada` (a F3.2 depende disso); re-trava só no sucesso; motivo nunca zerado).

---

### Task 6: Ajustes na Prova + Ficha de Medida/Obs. Gerais em Anexos + Observações + ordem do mockup ("Tecido Planejado" antes do Preço/MO) + rótulo "Obs. Mão de Obra"

**Files:**
- Create: `src/components/planejamento/planejamento-detail/ficha/secoes/AnexosDevCampos.tsx`
- Modify: `src/components/planejamento/PlanejamentoDetail.tsx`, `src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts` (onSuccess)

**Interfaces:**
- Consumes: `podeVerDev`, `devBloqueado`, `motivoTravaDev`, `campoVisivelDev`, `AvisoCamposDev` (Task 5); `SingleFileField` (`campos.tsx`); `ModeloAjustesProvaSection` (Dev, sem modificar); `ModeloObservacoes` e `ObsMaoObraField` (shared, sem modificar); `uploadFile` (`modelo-shared.ts`).
- Produces: `AnexosDevCampos({ fichaMedidaUrl, onUploadFicha, onRemoverFicha, observacoesGerais, onObservacoesGerais })`; comentário-âncora da F3.2 no JSX seguido do bloco "Tecido Planejado" (movido — §3 item 4); `<ObsMaoObraField label="Obs. Mão de Obra">`.
- Ordem final (mockup aprovado, R9c do G-plano conjunto): Sheet = Info → Coleção → Desenvolvimento → Ajustes na Prova → [âncora F3.2] → Tecido Planejado → Preço → Mão de obra → (PA/Grade revenda) → Anexos → Observações → Lançamento → Produto Relacionado; Dialog "Novo Modelo" = Info → Coleção → Tecido Planejado → Mão de obra → Anexos (`gen_novo.py`: Tecidos antes da Mão de obra).

- [ ] **Step 1: Criar `ficha/secoes/AnexosDevCampos.tsx`**

```tsx
// Ficha de Medida + Observações Gerais (vieram do Desenvolvimento — F3.1), DENTRO da seção Anexos do Planejamento
// (mockup: "Anexos ganha 2 campos do Dev"). Croqui/Desenho/Fotos seguem os campos de sempre do Planejamento
// (espelho — livres, decisão F3 #1); estes dois travam junto com as seções do Dev (fieldset no orquestrador).
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SingleFileField } from "@/components/planejamento/planejamento-detail/campos";

export function AnexosDevCampos({ fichaMedidaUrl, onUploadFicha, onRemoverFicha, observacoesGerais, onObservacoesGerais }: {
  fichaMedidaUrl: string;
  onUploadFicha: (f: File) => void;
  onRemoverFicha: () => void;
  observacoesGerais: string;
  onObservacoesGerais: (v: string) => void;
}) {
  return (
    <>
      <div className="grid sm:grid-cols-2 gap-4">
        <SingleFileField label="Ficha de Medida" path={fichaMedidaUrl} onUpload={onUploadFicha} onRemove={onRemoverFicha} />
      </div>
      <div className="grid gap-1">
        <Label>Observações Gerais</Label>
        <Textarea rows={3} value={observacoesGerais} onChange={(e) => onObservacoesGerais(e.target.value)} data-colab-path="observacoes_gerais" />
      </div>
    </>
  );
}
```

- [ ] **Step 2: Fiação no `PlanejamentoDetail.tsx`**

(a) Trocar
```ts
import { revendaCampoVisivel } from "@/lib/revenda-config";
```
por
```ts
import { revendaCampoVisivel } from "@/lib/revenda-config";
import { AnexosDevCampos } from "@/components/planejamento/planejamento-detail/ficha/secoes/AnexosDevCampos";
// Reuso DIRETO (sem modificar — decisão travada 8): fio de comentários da Prova e bloco de Observações do Dev.
import { ModeloAjustesProvaSection } from "@/components/desenvolvimento/modelo-detail/ModeloAjustesProvaSection";
import { ModeloObservacoes } from "@/components/shared/ModeloObservacoes";
```

(b) Trocar
```ts
  const uploadCroqui = useMutation({
    mutationFn: async (file: File) => uploadFile(file, "croqui"),
    onSuccess: (path) => setDraftTracked((d) => ({ ...d, croqui_url: path })),
    onError: (e: any) => toast.error(mensagemErro(e)),
  });
```
por
```ts
  const uploadCroqui = useMutation({
    mutationFn: async (file: File) => uploadFile(file, "croqui"),
    onSuccess: (path) => setDraftTracked((d) => ({ ...d, croqui_url: path })),
    onError: (e: any) => toast.error(mensagemErro(e)),
  });

  // Ficha de Medida (veio do Dev — F3.1): MESMO caminho do Dev, `<tenant>/fichas/<modeloId>/<uuid>-<nome>`
  // (ModeloDetailPanel.tsx:2654-2659). Só no card existente (a seção só aparece com isEdit).
  const uploadFicha = useMutation({
    mutationFn: async (file: File) => uploadFile(file, `fichas/${modeloId}`),
    onSuccess: (path) => { setDraftTracked((d) => ({ ...d, ficha_medida_url: path })); toast.success("Ficha enviada"); },
    onError: (e: any) => toast.error(mensagemErro(e)),
  });
```

(c) "Tecido Planejado" sai do lugar antigo (depois da Mão de obra e da PA/Grade de revenda) — ele SOBE no passo (d), ordem do mockup (R9c do G-plano conjunto). Trocar
```tsx
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

          {/* SETOR 5 — Anexos */}
```
por
```tsx
          {/* SETOR 5 — Anexos */}
```

(d) Trocar
```tsx
          {/* SETOR 3 — Preço (só na edição; na criação o custo vem do BOM depois) */}
```
por
```tsx
          {/* Ajustes na Prova (veio do Dev — F3.1): fio de comentários que grava NA HORA (fora do Salvar). Comprado
              segue a seção "prova" do Fluxo de Revenda (default: escondida). Trava = fieldset, como no Dev. */}
          {isEdit && modeloId && podeVerDev && campoVisivelDev("prova") && (
            <Secao titulo="Ajustes na Prova" defaultOpen={false}>
              <AvisoCamposDev motivo={motivoTravaDev} />
              <fieldset disabled={devBloqueado} className="contents">
                <ModeloAjustesProvaSection modeloId={modeloId} />
              </fieldset>
            </Secao>
          )}

          {/* ↓ F3.2: as seções do BOM (Tecidos/Forros/Entretelas · Aviamentos · Insumos · Grade) entram AQUI,
              entre "Ajustes na Prova" e "Preço" (ordem do mockup aprovado). */}

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

          {/* SETOR 3 — Preço (só na edição; na criação o custo vem do BOM depois) */}
```

(e) Trocar
```tsx
              <PhotoList label="Foto de Referência" paths={draft.fotos_referencia}
                onAdd={(f) => uploadMutation.mutate({ file: f, key: "fotos_referencia" })}
                onRemove={(i) => setDraftTracked((d) => ({ ...d, fotos_referencia: d.fotos_referencia.filter((_, j) => j !== i) }))} />
            </div>
          </Secao>
```
por
```tsx
              <PhotoList label="Foto de Referência" paths={draft.fotos_referencia}
                onAdd={(f) => uploadMutation.mutate({ file: f, key: "fotos_referencia" })}
                onRemove={(i) => setDraftTracked((d) => ({ ...d, fotos_referencia: d.fotos_referencia.filter((_, j) => j !== i) }))} />
            </div>
            {/* Ficha de Medida + Observações Gerais (vieram do Dev — F3.1): card existente, quem vê o Dev e (comprado)
                seção "s6" ligada no Fluxo de Revenda. Travam com as seções do Dev; o resto de Anexos segue livre. */}
            {isEdit && modeloId && podeVerDev && campoVisivelDev("s6") && (
              <>
                <AvisoCamposDev motivo={motivoTravaDev} />
                <fieldset disabled={devBloqueado} className="contents">
                  <AnexosDevCampos
                    fichaMedidaUrl={draft.ficha_medida_url}
                    onUploadFicha={(f) => uploadFicha.mutate(f)}
                    onRemoverFicha={() => setDraftTracked((d) => ({ ...d, ficha_medida_url: "" }))}
                    observacoesGerais={draft.observacoes_gerais}
                    onObservacoesGerais={(v) => setDraftTracked((d) => ({ ...d, observacoes_gerais: v }))}
                  />
                </fieldset>
              </>
            )}
          </Secao>
```

(f) Trocar
```tsx
          {/* SETOR 6 — Lançamento (gate: CAD + CQ liberado + valor de serviços aprovado) */}
```
por
```tsx
          {/* Observações (veio do Dev — F3.1): blocos com a Composição automática, gravam NA HORA (fora do Salvar).
              Reuso DIRETO de `ModeloObservacoes` (o card dele tem título próprio "Observações" — aceito: o
              componente é compartilhado com o Sheet do Dev e não muda até a F5). */}
          {isEdit && modeloId && podeVerDev && (
            <Secao titulo="Observações" defaultOpen={false}>
              <AvisoCamposDev motivo={motivoTravaDev} />
              <fieldset disabled={devBloqueado} className="contents">
                <ModeloObservacoes modeloId={modeloId} readOnly={devBloqueado} />
              </fieldset>
            </Secao>
          )}

          {/* SETOR 6 — Lançamento (gate: CAD + CQ liberado + valor de serviços aprovado) */}
```

(g) Rótulo "Obs. Mão de Obra" (R9b do G-plano conjunto; mockup Anotado, seção 11: "no Dev tem rótulo; aqui passa a ter também"). O componente compartilhado já aceita `label` (`src/components/shared/ObsMaoObraField.tsx`, não muda); o Dev passa o MESMO texto (`ModeloDetailPanel.tsx:3051-3055`). Trocar
```tsx
                  <ObsMaoObraField
                    value={draft.observacoes_mao_obra}
                    onChange={(v) => setDraftTracked({ ...draft, observacoes_mao_obra: v })}
                  />
```
por
```tsx
                  {/* F3.1 (mockup aprovado): rótulo "Obs. Mão de Obra", igual ao do Dev (ModeloDetailPanel.tsx:3051-3055). */}
                  <ObsMaoObraField
                    label="Obs. Mão de Obra"
                    value={draft.observacoes_mao_obra}
                    onChange={(v) => setDraftTracked({ ...draft, observacoes_mao_obra: v })}
                  />
```

- [ ] **Step 3: `usePlanejamentoSave.ts` — composição**

Trocar
```ts
      qc.invalidateQueries({ queryKey: ["plan-kanban-cond", modeloId] });
```
por
```ts
      qc.invalidateQueries({ queryKey: ["plan-kanban-cond", modeloId] });
      // F3.1: a "Composição" das Observações lê `modelo_tecidos`, que o Salvar grava.
      qc.invalidateQueries({ queryKey: ["modelo-composicao", modeloId] });
```

- [ ] **Step 4: Gates + commit**

```bash
cd "$WT" && .superpowers/f31/gates.sh
git add -- src/components/planejamento/planejamento-detail/ficha/secoes/AnexosDevCampos.tsx
git commit --only -m "feat(planejamento): F3.1 (6) — Ajustes na Prova, Ficha de Medida + Obs. Gerais em Anexos e Observações no Sheet (reuso direto do Dev, com trava); Tecido Planejado antes do Preço/MO e rótulo Obs. Mão de Obra (mockup)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- src/components/planejamento/planejamento-detail/ficha/secoes/AnexosDevCampos.tsx src/components/planejamento/PlanejamentoDetail.tsx src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts
git show --stat HEAD | tail -n +7
git diff --name-only savepoint-pre-unificacao-2026-09-22 -- src/components/desenvolvimento/ src/components/shared/ModeloObservacoes.tsx src/components/shared/ObsMaoObraField.tsx
grep -c '<Secao titulo="Tecido Planejado"' src/components/planejamento/PlanejamentoDetail.tsx
grep -n '↓ F3.2: as seções do BOM\|SUBIU para cá\|SETOR 4 — Tecido Planejado\|SETOR 3 — Preço\|label="Obs. Mão de Obra"' src/components/planejamento/PlanejamentoDetail.tsx
```
Expected: `GATES OK`; 3 arquivos; o `git diff` vazio; `1`; as linhas do último grep na ordem âncora F3.2 → "SUBIU para cá" → SETOR 4 → SETOR 3 → `label="Obs. Mão de Obra"`. Revisão: **lote B** (Task 6; juntar com o lote A se ele ainda não tiver rodado).

---

### Task 7: Card novo → Sheet do id criado (fim do 2º INSERT)

**Files:**
- Modify: `src/components/planejamento/PlanejamentoDetail.tsx` (declaração do componente :76-85 e chamada do save)
- Modify: `src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts` (import react, args, destructure, ramo do card novo :163-181, retorno :245, fim do `onSuccess`, começo do `onError`)

**Interfaces:**
- Consumes: `aoSalvar` (Task 5).
- Produces: `PlanejamentoDetail` (API pública inalterada: `{ modeloId, onClose, onSaved, contexto? }`) vira um wrapper que remonta `PlanejamentoDetailConteudo` com `key = modeloId ?? idCriado ?? "novo"`; `UsePlanejamentoSaveArgs.onCreated?: (id: string) => void`; `mutationFn` → `{ autoProduto, savedId }`; guarda `criadoIdRef` (INSERT uma vez).

- [ ] **Step 1: `usePlanejamentoSave.ts`**

(a) Trocar
```ts
import type { Dispatch, RefObject, SetStateAction } from "react";
```
por
```ts
import { useRef, type Dispatch, type RefObject, type SetStateAction } from "react";
```

(b) Trocar
```ts
  qc: QueryClient;
  onSaved: () => void;
};
```
por
```ts
  qc: QueryClient;
  onSaved: () => void;
  /** F3.1 — card NOVO: chamado com o id depois do INSERT (o `PlanejamentoDetail` remonta como Sheet dele). */
  onCreated?: (id: string) => void;
};
```

(c) Trocar
```ts
  qc, onSaved,
}: UsePlanejamentoSaveArgs) {
```
por
```ts
  qc, onSaved, onCreated,
}: UsePlanejamentoSaveArgs) {
  // F3.1 — card NOVO: id do INSERT já feito neste detalhe. Um 2º Salvar (ou o retry depois de um erro nas
  // gravações seguintes) NUNCA insere de novo; o detalhe vira o Sheet desse id (`onCreated`).
  const criadoIdRef = useRef<string | null>(null);
```

(d) Trocar
```ts
        // Card novo: sem concorrência possível (linha ainda não existe) — insert direto.
        const { data: inserted, error } = await supabase.from("modelos").insert(payload).select("id").single();
        if (error) throw error;
        savedId = inserted?.id ?? null;
        if (savedId) await syncTecidosToDesenvolvimento(savedId, draft.tecidos_planejados);
```
por
```ts
        // Card novo: sem concorrência possível (linha ainda não existe) — insert direto, UMA vez só (F3.1).
        if (criadoIdRef.current) {
          savedId = criadoIdRef.current;
        } else {
          const { data: inserted, error } = await supabase.from("modelos").insert(payload).select("id").single();
          if (error) throw error;
          savedId = inserted?.id ?? null;
          criadoIdRef.current = savedId;
        }
        if (savedId) await syncTecidosToDesenvolvimento(savedId, draft.tecidos_planejados);
```

(e) Trocar
```ts
      return { autoProduto };
```
por
```ts
      return { autoProduto, savedId };
```

(f) Trocar
```ts
      onSaved();
    },
    onError: async (e: any) => {
```
por
```ts
      onSaved();
      // F3.1 — card NOVO: vira o Sheet do id criado (o `PlanejamentoDetail` remonta com a key nova).
      if (!isEdit && result?.savedId) onCreated?.(result.savedId);
    },
    onError: async (e: any) => {
      // F3.1 — card NOVO já INSERIDO que falhou numa gravação seguinte (tecidos/grade/MO): mostra o erro, atualiza
      // a lista e abre o Sheet do card criado — o usuário confere e salva de lá (UPDATE). Nunca um 2º INSERT.
      if (!isEdit && criadoIdRef.current) {
        toast.error(`O card foi criado, mas algo não foi salvo: ${mensagemErro(e, "erro desconhecido")}`);
        onSaved();
        onCreated?.(criadoIdRef.current);
        return;
      }
```

- [ ] **Step 2: `PlanejamentoDetail.tsx`**

(a) Trocar
```tsx
/* ============ DETALHE (Sheet/Dialog) ============ */

export function PlanejamentoDetail({
  modeloId, onClose, onSaved, contexto = "planejamento",
}: {
  modeloId: string | null;
  onClose: () => void;
  onSaved: () => void;
  contexto?: "planejamento" | "produto-acabado";
}) {
```
por
```tsx
/* ============ DETALHE (Sheet/Dialog) ============ */

// API pública INALTERADA: `{ modeloId, onClose, onSaved, contexto? }`. Fix do bug do card NOVO (F3.1; R15 da
// F3.0): no 1º Salvar do Dialog "Novo Modelo" o card ganha id e o detalhe REMONTA (key nova) como o Sheet desse
// id — estado limpo, semeado do servidor como qualquer card existente, já com as seções do Dev. Antes o Dialog
// ficava aberto sem id e um 2º Salvar INSERIA de novo (card duplicado). Fica AQUI, não na rota, p/ valer em
// todo caller sem mexer em `criacao.planejamento.tsx` (arquivo da F2). Bônus: se o caller trocar `modeloId`
// sem desmontar, o detalhe remonta em vez de mesclar o card novo no rascunho do anterior.
export function PlanejamentoDetail(props: {
  modeloId: string | null;
  onClose: () => void;
  onSaved: () => void;
  contexto?: "planejamento" | "produto-acabado";
}) {
  const [idCriado, setIdCriado] = useState<string | null>(null);
  const id = props.modeloId ?? idCriado;
  return <PlanejamentoDetailConteudo key={id ?? "novo"} {...props} modeloId={id} onCreated={setIdCriado} />;
}

function PlanejamentoDetailConteudo({
  modeloId, onClose, onSaved, contexto = "planejamento", onCreated,
}: {
  modeloId: string | null;
  onClose: () => void;
  onSaved: () => void;
  contexto?: "planejamento" | "produto-acabado";
  /** Card NOVO: chamado com o id depois do INSERT (o wrapper remonta como Sheet desse id). */
  onCreated?: (id: string) => void;
}) {
```

(b) Trocar
```ts
    qc, onSaved: aoSalvar,
  });
```
por
```ts
    qc, onSaved: aoSalvar, onCreated,
  });
```

- [ ] **Step 3: Gates + commit**

```bash
cd "$WT" && .superpowers/f31/gates.sh
grep -n "export function PlanejamentoDetail\|function PlanejamentoDetailConteudo\|export { FieldText, FieldSelect }" src/components/planejamento/PlanejamentoDetail.tsx
git commit --only -m "fix(planejamento): F3.1 (7) — card novo vira o Sheet do id criado após o 1º Salvar; INSERT uma vez só (fim do card duplicado no 2º Salvar)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- src/components/planejamento/PlanejamentoDetail.tsx src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts
git show --stat HEAD | tail -n +7
```
Expected: `GATES OK`; o grep mostra as 3 linhas (wrapper exportado, conteúdo não exportado, re-export mantido); 2 arquivos. Revisão individual Opus (foco: `key` remonta; nenhum caminho faz 2º INSERT — sucesso, erro depois do insert, clique duplo; `onSaved`/lista; re-export; `ProdutoAcabadoSheet` e rota sem mudança).

---

### Task 8: Selo da etapa no header + "Mover para…" (consome a F2)

**Files:**
- Create: `src/components/planejamento/planejamento-detail/ficha/etapa-mover.ts`, `…/ficha/useMoverEtapa.ts`, `…/ficha/EtapaHeader.tsx`
- Modify: `src/components/planejamento/PlanejamentoDetail.tsx`
- Test: `tests/unit/planejamento-ficha-mover.test.ts`

**Interfaces:**
- Consumes (F2): `etapaDoModelo`, `labelDaColuna`, `labelsCondicoes`, `notaMoverPara`, `toastDoMover`, `type EtapaSelo`, `type ResultadoMover` (`@/lib/kanban-auto-ui`); `kanbanMover` (`@/lib/kanban-auto-rpc`); `EtapaKanbanBadge` (`@/components/shared/EtapaKanbanBadge`). (F1) `boardDaLoja`, `destinoDrop`, `entradaParaDerivacao`. (F3.1) `OpcaoMover`, `opcoesMoverHoje`, `podeEntrarHoje`, `mensagemBloqueioHoje`, `FichaKanban`.
- Produces:
  - `opcoesMoverAuto(o: { modelo: ModeloKanban; statusEfetivo: string | null; cfg: KanbanAutoConfig; cond: Record<string, boolean> }): OpcaoMover[]`
  - `proximaEtapa(d: Derivacao | null, cfg: KanbanAutoConfig): { coluna: string; falta: string } | null`
  - `type MoverEtapaVars = { para: string; origem: string | null; statusAntes: string | null; fixadoAntes: boolean; cfg: KanbanAutoConfig; cond: Record<string, boolean> }`; `useMoverEtapa(modeloId: string | null)` (mutation)
  - `EtapaHeader({ selo, podeMover, opcoes, onMover, movendo, proxima, sujo })` — testids `etapa-header`, `etapa-kanban-selo-header`, `etapa-mover-gatilho`, `etapa-mover-menu`, `etapa-mover-<key>`, `etapa-proxima`.

- [ ] **Step 1: Pré-condição — a F2 no branch + rebase**

```bash
MAIN="/Users/sunglee/PLM + Criação/plm-pcp"; WT="$MAIN/.claude/worktrees/f31-planejamento-campos"
for f in src/lib/kanban-auto-ui.ts src/lib/kanban-auto-rpc.ts src/components/shared/EtapaKanbanBadge.tsx; do git -C "$MAIN" cat-file -e "feature/plan-tecido-a1:$f" && echo "ok $f" || echo "FALTA $f"; done
git -C "$WT" status --porcelain
git -C "$WT" rebase feature/plan-tecido-a1
cd "$WT" && npm ci --silent
grep -nE "export function (etapaDoModelo|labelDaColuna|labelsCondicoes|notaMoverPara|toastDoMover)|export type (EtapaSelo|ResultadoMover)" src/lib/kanban-auto-ui.ts
grep -n "export function kanbanMover" src/lib/kanban-auto-rpc.ts
grep -n "export function EtapaKanbanBadge\|testId" src/components/shared/EtapaKanbanBadge.tsx | head -3
.superpowers/f31/gates.sh
```
Expected: 3× `ok`; worktree limpa; rebase sem conflito (a F3.1 não toca em arquivo da F2); os 7 exports, `kanbanMover` e o `testId` existem; `GATES OK` (a linha de base de falhas continua a mesma — testes novos da F2 só somam "passed"). Se faltar arquivo da F2: PARE — a F3.1 segue o caminho "em 2 partes" da §3. Se um export tiver outro nome/assinatura: PARE e reporte (não adaptar a F2).

- [ ] **Step 2: Teste que falha**

Criar `tests/unit/planejamento-ficha-mover.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { derivarModelo, type KanbanAutoConfig, type ModeloKanban } from "@/lib/kanban-auto";
import { opcoesMoverAuto, proximaEtapa } from "@/components/planejamento/planejamento-detail/ficha/etapa-mover";

// F3.1 — "Mover para…" do selo com a chave LIGADA: a tabela única de arraste da F1 (destinoDrop) + os textos da
// F2 (notaMoverPara). O servidor (kanban_mover) é quem decide; isto é só a dica no menu.
const cfg = (over: Partial<KanbanAutoConfig> = {}): KanbanAutoConfig => ({
  kanban_automatico: true, status_kanban: null,
  kanban_requisitos: { em_pilotagem: ["data_piloto1"], aprovado: ["data_aprovacao"] },
  kanban_requisitos_excecoes: {}, revenda_kanban_colunas: [], revenda_kanban_requisitos: {}, ...over,
});
const m = (status: string, origem = "interno"): ModeloKanban => ({ origem, status_desenvolvimento: status, ordem_criacao_enviada: true, lancado: false });
const por = (ops: ReturnType<typeof opcoesMoverAuto>, k: string) => ops.find((o) => o.key === k);

describe("opcoesMoverAuto", () => {
  it("card automático na entrada: manual fixa; automática além da derivada bloqueia com N dados", () => {
    const ops = opcoesMoverAuto({ modelo: m("em_modelagem"), statusEfetivo: "em_modelagem", cfg: cfg(), cond: {} });
    expect(por(ops, "em_modelagem")).toBeUndefined();
    expect(por(ops, "stand_by")).toMatchObject({ nota: "fixa aqui", bloqueada: false });
    expect(por(ops, "reprovado")).toMatchObject({ nota: "fixa aqui", bloqueada: false });
    expect(por(ops, "em_pilotagem")).toMatchObject({ nota: "falta 1 dado", bloqueada: true });
    expect(por(ops, "aprovado")).toMatchObject({ nota: "faltam 2 dados", bloqueada: true });
  });
  it("card fixado em coluna manual: a entrada solta o card", () => {
    const ops = opcoesMoverAuto({ modelo: m("stand_by"), statusEfetivo: "stand_by", cfg: cfg(), cond: {} });
    expect(por(ops, "stand_by")).toBeUndefined();
    expect(por(ops, "em_modelagem")).toMatchObject({ nota: "solta o card", bloqueada: false });
  });
  it("comprado: coluna fora do fluxo dele fica bloqueada", () => {
    const ops = opcoesMoverAuto({ modelo: m("em_modelagem", "revenda"), statusEfetivo: "em_modelagem", cfg: cfg({ revenda_kanban_colunas: ["em_modelagem", "aprovado"] }), cond: {} });
    expect(por(ops, "stand_by")).toMatchObject({ nota: "fora do fluxo", bloqueada: true });
  });
});

describe("proximaEtapa (\"Próxima: X — falta: Y\")", () => {
  it("1ª coluna automática que falha + os dados que faltam", () => {
    expect(proximaEtapa(derivarModelo(m("em_modelagem"), cfg(), {}), cfg())).toEqual({ coluna: "Em Pilotagem", falta: "Data de Piloto I preenchida" });
    expect(proximaEtapa(derivarModelo(m("em_pilotagem"), cfg(), { data_piloto1: true }), cfg())).toEqual({ coluna: "Aprovado", falta: "Data de Aprovação preenchida" });
  });
  it("nada quando fixado, sem derivação ou tudo cumprido", () => {
    expect(proximaEtapa(derivarModelo(m("stand_by"), cfg(), {}), cfg())).toBeNull();
    expect(proximaEtapa(null, cfg())).toBeNull();
    expect(proximaEtapa(derivarModelo(m("aprovado"), cfg(), { data_piloto1: true, data_aprovacao: true }), cfg())).toBeNull();
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `cd "$WT" && env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit/planejamento-ficha-mover.test.ts`
Expected: FAIL (módulo inexistente).

- [ ] **Step 4: Criar `ficha/etapa-mover.ts`**

```ts
/**
 * "Mover para…" do selo da etapa no header do Sheet unificado (F3.1) com a chave LIGADA — funções PURAS.
 * Consome a F1 (`kanban-auto.ts`: tabela única de arraste) e a F2 (`kanban-auto-ui.ts`: textos). Com a chave
 * DESLIGADA vale `opcoesMoverHoje` (etapa-kanban.ts, regras do board de hoje).
 */
import {
  boardDaLoja, destinoDrop, entradaParaDerivacao, type Derivacao, type KanbanAutoConfig, type ModeloKanban,
} from "@/lib/kanban-auto";
import { labelDaColuna, labelsCondicoes, notaMoverPara } from "@/lib/kanban-auto-ui";
import type { OpcaoMover } from "./etapa-kanban";

export function opcoesMoverAuto(o: {
  modelo: ModeloKanban;
  statusEfetivo: string | null;
  cfg: KanbanAutoConfig;
  cond: Record<string, boolean>;
}): OpcaoMover[] {
  const entrada = entradaParaDerivacao(o.modelo, o.cfg, o.cond);
  return boardDaLoja(o.cfg)
    .filter((c) => c.key !== o.statusEfetivo)
    .map((c) => {
      const n = notaMoverPara(destinoDrop(entrada, c.key));
      return { key: c.key, label: c.label, nota: n.texto, bloqueada: n.bloqueada };
    });
}

/** Mockup: "→ Próxima: Prova de Roupa I — falta: Data de Piloto I preenchida". Só p/ card automático. */
export function proximaEtapa(d: Derivacao | null, cfg: KanbanAutoConfig): { coluna: string; falta: string } | null {
  if (!d || !d.derivavel || d.fixado || !d.primeiraFalha || d.faltando.length === 0) return null;
  return { coluna: labelDaColuna(d.primeiraFalha, boardDaLoja(cfg)), falta: labelsCondicoes(d.faltando).join(", ") };
}
```

- [ ] **Step 5: Criar `ficha/useMoverEtapa.ts`**

```ts
/**
 * F3.1 — "Mover para…" do selo da etapa (a etapa fica FORA do Salvar — decisão 13).
 *  • Chave LIGADA: RPC `kanban_mover` (F1) decide pela tabela única; toast pela RESPOSTA (`toastDoMover`, F2).
 *  • Chave DESLIGADA: comportamento de HOJE = board (criacao.desenvolvimento.tsx:322-332, :547-557): gate
 *    `podeEntrarHoje` (cascata) → UPDATE só de `status_desenvolvimento` + `marcar_etapa_verificada('kanban')`
 *    (limpa o #Erro de regressão).
 *  Nenhum dos dois toca `motivo_cancelamento` (dono, 23/set). O status novo entra no cache do card na hora e
 *  o refetch (rev novo) é absorvido pelo merge do colab sem mexer no rascunho (a etapa não está no Draft).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { mensagemErro } from "@/lib/erro-mensagem";
import { boardDaLoja, type KanbanAutoConfig } from "@/lib/kanban-auto";
import { labelDaColuna, toastDoMover, type ResultadoMover } from "@/lib/kanban-auto-ui";
import { kanbanMover } from "@/lib/kanban-auto-rpc";
import { mensagemBloqueioHoje, podeEntrarHoje } from "./etapa-kanban";

export type MoverEtapaVars = {
  para: string;
  origem: string | null;
  statusAntes: string | null;
  fixadoAntes: boolean;
  cfg: KanbanAutoConfig;
  cond: Record<string, boolean>;
};
type ResultadoEtapa =
  | { tipo: "auto"; r: ResultadoMover }
  | { tipo: "bloqueado"; faltando: { label: string }[] }
  | { tipo: "hoje"; status: string };

export function useMoverEtapa(modeloId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: MoverEtapaVars): Promise<ResultadoEtapa> => {
      if (!modeloId) throw new Error("Salve o modelo primeiro.");
      if (v.cfg.kanban_automatico) return { tipo: "auto", r: await kanbanMover(modeloId, v.para) };
      const chk = podeEntrarHoje({ origem: v.origem, para: v.para, cfg: v.cfg, cond: v.cond });
      if (!chk.ok) return { tipo: "bloqueado", faltando: chk.faltando };
      const { error } = await supabase.from("modelos").update({ status_desenvolvimento: v.para }).eq("id", modeloId);
      if (error) throw error;
      await supabase.rpc("marcar_etapa_verificada", { _modelo_id: modeloId, _etapa: "kanban" });
      return { tipo: "hoje", status: v.para };
    },
    onSuccess: (res, v) => {
      const board = boardDaLoja(v.cfg);
      if (res.tipo === "bloqueado") {
        toast.error(mensagemBloqueioHoje(res.faltando));
        return;
      }
      let novo: string | null;
      if (res.tipo === "auto") {
        novo = res.r.status;
        const t = toastDoMover(res.r, v.para, board, v.statusAntes, v.fixadoAntes);
        if (t?.tipo === "error") toast.error(t.texto);
        else if (t?.tipo === "success") toast.success(t.texto);
        else if (t) toast.info(t.texto);
      } else {
        novo = res.status;
        toast.success(`Card movido para "${labelDaColuna(novo, board)}".`);
      }
      qc.setQueryData(["modelo", modeloId], (old: any) => (old ? { ...old, status_desenvolvimento: novo } : old));
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao mover o card")),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["modelo", modeloId] });
      qc.invalidateQueries({ queryKey: ["plan-kanban-cond", modeloId] });
      qc.invalidateQueries({ queryKey: ["modelos-planejamento"] });
      qc.invalidateQueries({ queryKey: ["modelos-desenvolvimento"] });
      qc.invalidateQueries({ queryKey: ["desenv-condicoes"] });
    },
  });
}
```

- [ ] **Step 6: Criar `ficha/EtapaHeader.tsx`**

```tsx
// Selo da etapa no HEADER do Sheet unificado (decisão travada 5: Nome → REF → selo) + "Mover para…" + a linha
// "Próxima: X — falta: Y" (chave ligada). Reusa `EtapaKanbanBadge` da F2 em modo visual dentro de um botão
// gatilho do Popover (o Radix cuida de abrir/fechar e do foco). Destinos bloqueados ficam esmaecidos e
// anotados, mas clicáveis: com a chave ligada o servidor decide e responde com o toast (paridade com o board).
import { useState } from "react";
import { ArrowRight, ChevronDown, Loader2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { EtapaKanbanBadge } from "@/components/shared/EtapaKanbanBadge";
import { cn } from "@/lib/utils";
import type { EtapaSelo } from "@/lib/kanban-auto-ui";
import type { OpcaoMover } from "./etapa-kanban";

export function EtapaHeader({ selo, podeMover, opcoes, onMover, movendo, proxima, sujo }: {
  selo: EtapaSelo;
  podeMover: boolean;
  opcoes: OpcaoMover[];
  onMover: (para: string) => void;
  movendo: boolean;
  proxima: { coluna: string; falta: string } | null;
  /** Há alteração não salva — as regras olham o estado SALVO. */
  sujo: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  return (
    <div data-testid="etapa-header" className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
      {podeMover ? (
        <Popover open={aberto} onOpenChange={setAberto}>
          <PopoverTrigger asChild>
            <button
              type="button"
              data-testid="etapa-mover-gatilho"
              aria-label={`Mover para… (etapa: ${selo.label})`}
              disabled={movendo}
              className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:min-h-11"
            >
              <EtapaKanbanBadge selo={selo} testId="etapa-kanban-selo-header" className="cursor-pointer hover:bg-muted" />
              {movendo
                ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
                : <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 max-w-[calc(100vw-2rem)] p-1" data-testid="etapa-mover-menu">
            <p className="px-2 pt-1 pb-1 text-xs font-semibold text-muted-foreground">Mover para…</p>
            {sujo && (
              <p className="px-2 pb-1 text-[11px] text-muted-foreground">As regras olham o que já está salvo — salve antes de mover.</p>
            )}
            <div className="max-h-72 overflow-y-auto">
              {opcoes.map((o) => (
                <button
                  key={o.key}
                  type="button"
                  data-testid={`etapa-mover-${o.key}`}
                  disabled={movendo}
                  onClick={() => { setAberto(false); onMover(o.key); }}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted disabled:opacity-50 max-sm:min-h-11",
                    o.bloqueada && "text-muted-foreground",
                  )}
                >
                  <span className="min-w-0 truncate">{o.label}</span>
                  {o.nota && <span className="shrink-0 text-xs opacity-80">{o.nota}</span>}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      ) : (
        <EtapaKanbanBadge selo={selo} testId="etapa-kanban-selo-header" />
      )}
      {proxima && (
        <span data-testid="etapa-proxima" className="inline-flex min-w-0 flex-wrap items-center gap-1 text-xs text-muted-foreground">
          <ArrowRight className="h-3 w-3 shrink-0" aria-hidden />
          Próxima: <b className="font-semibold text-foreground">{proxima.coluna}</b> — falta:{" "}
          <b className="font-semibold text-[var(--tone-warning-fg)]">{proxima.falta}</b>
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Fiação no `PlanejamentoDetail.tsx`**

(a) Trocar
```ts
import { useFichaKanban } from "@/components/planejamento/planejamento-detail/ficha/useFichaKanban";
```
por
```ts
import { useFichaKanban } from "@/components/planejamento/planejamento-detail/ficha/useFichaKanban";
import { opcoesMoverHoje } from "@/components/planejamento/planejamento-detail/ficha/etapa-kanban";
import { opcoesMoverAuto, proximaEtapa } from "@/components/planejamento/planejamento-detail/ficha/etapa-mover";
import { useMoverEtapa } from "@/components/planejamento/planejamento-detail/ficha/useMoverEtapa";
import { EtapaHeader } from "@/components/planejamento/planejamento-detail/ficha/EtapaHeader";
import { etapaDoModelo } from "@/lib/kanban-auto-ui";
```

(b) Trocar
```ts
  const campoVisivelDev = (key: string) => !isComprado || revendaCampoVisivel(kanbanCard.revendaCfg, key);
```
por
```ts
  const campoVisivelDev = (key: string) => !isComprado || revendaCampoVisivel(kanbanCard.revendaCfg, key);
  // "Mover para…" do selo (a etapa fica FORA do Salvar — decisão 13).
  const moverEtapa = useMoverEtapa(modeloId);
```

(c) Inserir IMEDIATAMENTE ANTES da linha
```ts
  // Conteúdo interno idêntico p/ os dois containers (header / corpo rolável / rodapé
```
o bloco:
```ts
  // Selo da etapa no HEADER (decisão 5: Nome → REF → selo). "Planejamento" antes da Ordem de Criação, "Lançado"
  // depois de lançar, senão a coluna (+ automática/fixado c/ a chave ligada). Mover exige editar o Dev (a RPC
  // também exige — kanban_auto_4_rpcs.sql:49-51) e as condições carregadas (a dica não pode mentir).
  const selo = etapaDoModelo(kanbanCard.modeloKanban, kanbanCard.kanbanCfg);
  const podeMover = isEdit && !!modeloId && podeEditarDev && selo.fase === "kanban" && kanbanCard.condProntas;
  const origemSalva = kanbanCard.modeloKanban.origem ?? null;
  const opcoesMover = !podeMover
    ? []
    : kanbanCard.kanbanCfg.kanban_automatico
      ? opcoesMoverAuto({ modelo: kanbanCard.modeloKanban, statusEfetivo: kanbanCard.statusEfetivo, cfg: kanbanCard.kanbanCfg, cond: kanbanCard.cond })
      : opcoesMoverHoje({ origem: origemSalva, statusEfetivo: kanbanCard.statusEfetivo, cfg: kanbanCard.kanbanCfg, cond: kanbanCard.cond });
  // "Próxima: X — falta: Y" só com a chave ligada (card automático) — igual ao "próx.: falta X" do board da F2.
  const proxima = kanbanCard.kanbanCfg.kanban_automatico ? proximaEtapa(kanbanCard.derivacao, kanbanCard.kanbanCfg) : null;
  const moverPara = (para: string) => moverEtapa.mutate({
    para, origem: origemSalva, statusAntes: kanbanCard.statusSalvo, fixadoAntes: !!kanbanCard.derivacao?.fixado,
    cfg: kanbanCard.kanbanCfg, cond: kanbanCard.cond,
  });

```

(d) Trocar
```tsx
              {/* Motivo do Cancelamento (veio do Dev — F3.1): só com a etapa em Reprovado. Sair de Reprovado NÃO
```
por
```tsx
              {isEdit && (
                <EtapaHeader
                  selo={selo}
                  podeMover={podeMover}
                  opcoes={opcoesMover}
                  onMover={moverPara}
                  movendo={moverEtapa.isPending}
                  proxima={proxima}
                  sujo={dirty}
                />
              )}
              {/* Motivo do Cancelamento (veio do Dev — F3.1): só com a etapa em Reprovado. Sair de Reprovado NÃO
```

- [ ] **Step 8: Rodar e ver passar + gates + commit**

```bash
cd "$WT" && env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit/planejamento-ficha-mover.test.ts tests/unit/planejamento-ficha-etapa.test.ts
.superpowers/f31/gates.sh
git add -- src/components/planejamento/planejamento-detail/ficha/etapa-mover.ts src/components/planejamento/planejamento-detail/ficha/useMoverEtapa.ts src/components/planejamento/planejamento-detail/ficha/EtapaHeader.tsx tests/unit/planejamento-ficha-mover.test.ts
git commit --only -m "feat(planejamento): F3.1 (8) — selo da etapa no header do Sheet (Nome → REF → selo) + Mover para… (kanban_mover c/ a chave ligada; regras do board c/ ela desligada; motivo nunca apagado)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- src/components/planejamento/planejamento-detail/ficha/etapa-mover.ts src/components/planejamento/planejamento-detail/ficha/useMoverEtapa.ts src/components/planejamento/planejamento-detail/ficha/EtapaHeader.tsx src/components/planejamento/PlanejamentoDetail.tsx tests/unit/planejamento-ficha-mover.test.ts
git show --stat HEAD | tail -n +7
```
Expected: PASS; `GATES OK`; 5 arquivos. Revisão individual Opus (foco: chave desligada = board literal; UPDATE só do status; nada toca o motivo; toast pela resposta; `setQueryData` + merge colab não mexem no rascunho; `podeMover` só com permissão + condições).

---

### Task 9: Aplicar a migration em PRODUÇÃO (G-migration aprovado + OK do dono)

**Files:** nenhum no repo. Evidência fora do repo em `/Users/sunglee/PLM + Criação/savepoints/pre-apply-f31-descricao/` (`replicar_core_{antes,depois}.sql`, `replicar_core_acl_antes.txt`, `replicar_core_diff.txt`) e `$WT/.superpowers/f31/logs/prod-apply.log`.

**Interfaces:**
- Consumes: Task 1 commitada e revisada, com o ensaio da cópia local OK (Step 8); guardião G-migration APROVA; OK explícito do dono registrado no diário; `.superpowers/f31/mig/{aplica.sh,ida-producao.sh,volta-producao.sh}` (Task 1 Step 4).
- Produces: coluna existente em produção (pré-condição das Tasks 10 e 11); `== IDA OK` no `prod-apply.log`.

Executada pelo CONTROLADOR (ou subagente com o comando exato), nunca por iniciativa própria de um executor. Pode ocorrer logo depois do G-migration (em paralelo às Tasks 2–8); tem de ocorrer ANTES da Task 10. **Receita de travas (R7 do G-plano conjunto = G-migration F1 R1):** `CREATE FUNCTION` antes e `ALTER` por último (no arquivo); arquivo INTEIRO numa mensagem com `SET LOCAL lock_timeout = '500ms'` + `SET LOCAL transaction_timeout = '3s'` injetados após o `BEGIN;` (`aplica_v2`); nova tentativa SÓ em 55P03/40P01/25P04 (ATIV + 60 s, até 5); qualquer outro erro PARA. NUNCA `psql -f`.

- [ ] **Step 1: Pré-condições**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f31-planejamento-campos"
git log -1 --format='%h %s' -- supabase/migrations/20260930180000_modelo_descricao_produto.sql
git diff --quiet HEAD -- supabase/migrations/20260930180000_modelo_descricao_produto.sql supabase/rollback/20260930180000_modelo_descricao_produto_down.sql && echo "SQL commitado e sem alteração"
grep -c "== ENSAIO OK" .superpowers/f31/logs/t1-ensaio-local.log
```

Expected: o commit `F3.1 (1)`; `SQL commitado e sem alteração`; `1` (ensaio da Task 1 Step 8 aprovado). O controlador confirma no diário do guardião o G-migration APROVA e o OK do dono. Janela: fora do horário de uso das lojas, se o dono indicar (o ALTER segura `modelos` por milissegundos; com fila, desiste em 500 ms e nada fica).

- [ ] **Step 2: Ida (pré-voo + retrato + apply + conferência num comando só)**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f31-planejamento-campos"
bash .superpowers/f31/mig/ida-producao.sh 2>&1 | tee .superpowers/f31/logs/prod-apply.log | tail -30
```

Expected, na ordem: `OK (PG >= 17 com transaction_timeout): t`; `OK (coluna ausente + função = corpo vivo (20260908240000)): 0|e0393c79fb962a068fd7a3e4636acbe6`; `INFO deadlock_timeout = …` (esperado `1s`; se < 500 ms, avisar o guardião); `OK (ATIV): nenhuma transação longa`; `== PRÉ-VOO OK`; `OK (retrato): …`; a migration aplicada (sem erro; `real …` do `/usr/bin/time`); `== IDA OK`; `OK (coluna criada): text|YES|-`; o diff com SÓ as 2 linhas do INSERT (`ref_auto` → `ref_auto, descricao_produto` e `o.ref_auto` → `o.ref_auto, o.descricao_produto`) + `OK (função): …`; `OK (ACL igual à de antes)`; `OK (invariante #9): f|f`; `== PostgREST recarregado`.
Desvios: md5 ≠ `e0393c79…` → PARE (alguém mudou a função — refazer a Task 1 sobre o vivo); coluna já existe → PARE e reporte (descobrir quem aplicou); `FALHOU (ATIV)` → esperar e repetir o MESMO comando (nunca matar sessão); `-- espera de trava/tempo` = 55P03/40P01/25P04: o próprio `aplica_v2` repete (nada do arquivo ficou); `PAROU …` → falar com o dono; `CONFERÊNCIA FALHOU` → a coluna já está lá (aditiva): avisar o controlador/dono, NÃO rodar o inverso sem OK.

- [ ] **Step 3: Registro**

O controlador registra no diário do guardião: horário, o `prod-apply.log` e os 4 arquivos de `/Users/sunglee/PLM + Criação/savepoints/pre-apply-f31-descricao/`.

- [ ] **Step 4: (Só se o dono pedir) volta de emergência**

NÃO faz parte do fluxo. Ordem obrigatória: (1) tirar do ar o front que grava `descricao_produto` (reverter a F3.1 no branch/deploy) — senão todo Salvar do Planejamento cai com PGRST204; (2) OK explícito do dono para APAGAR as descrições; (3):

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f31-planejamento-campos"
bash .superpowers/f31/mig/volta-producao.sh 2>&1 | tee .superpowers/f31/logs/prod-volta.log | tail -20
```

Sem descrição preenchida, volta direto (`== VOLTA OK`). Com descrições, a guarda do inverso recusa (`P0001 … Descrição do produto`, `PAROU … erro que NÃO é de trava/tempo`) — o export já ficou em `…/pre-apply-f31-descricao/descricao_produto_backup.csv`; só com o OK do dono para apagar, rodar de novo com `--confirmo-apagar-descricoes` (o script injeta `SET LOCAL app.confirmo_apagar_descricao_produto = 'sim'` na MESMA transação pelo `EXTRA_SQL` do `aplica_v2`).

---

### Task 10: QA no navegador (só leitura, guarda de rede)

**Files:**
- Create (NUNCA commitado): `tests/e2e/f31-qa.spec.ts`; evidência em `.superpowers/f31/qa/`.

**Interfaces:**
- Consumes: Tasks 2–7 (e 8 se `F31_SELO=1`); coluna em produção (Task 9).
- Produces: `.superpowers/f31/qa/{desktop,permissoes-*,mobile}.json` + PNGs; log com `3 passed`.

- [ ] **Step 1: Pré-condições**

```bash
grep -c "== IDA OK" "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f31-planejamento-campos/.superpowers/f31/logs/prod-apply.log"
lsof -nP -iTCP:5199 -sTCP:LISTEN; echo "porta-5199-checada"
ps -Ao pid,command | grep -E "playwright|kanban-auto.spec|f3[02]-qa" | grep -v grep; echo "e2e-checado"
curl -s -o /dev/null -w 'dono :5173 http=%{http_code}\n' http://localhost:5173/
```
Expected: `1` (a ida da Task 9 concluiu — `== IDA OK`); só `porta-5199-checada` (porta livre — se ocupada, PARE, não mate nada); nenhum Playwright rodando (E2E da F2/QA da F3.2 NÃO rodam junto); o `:5173` do dono só é observado.

- [ ] **Step 2: Subir o vite da worktree em `:5199` (em background)**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f31-planejamento-campos" && node_modules/.bin/vite dev --port 5199 --strictPort > .superpowers/f31/logs/vite-5199.log 2>&1
```
(rodar com `run_in_background`). Depois:
```bash
curl -s -o /dev/null --retry 40 --retry-connrefused --retry-delay 2 -w 'F3.1(:5199) http=%{http_code}\n' http://localhost:5199/
PID=$(lsof -nP -iTCP:5199 -sTCP:LISTEN -t | head -1); lsof -a -p "$PID" -d cwd -Fn | grep '^n'; echo "$PID" > .superpowers/f31/vite-5199.pid
```
Expected: `http=200`; o `cwd` do PID é a worktree da F3.1.

- [ ] **Step 3: Criar `tests/e2e/f31-qa.spec.ts`**

```ts
// tests/e2e/f31-qa.spec.ts — QA da F3.1 (Sheet unificado do Planejamento: campos do Dev, Descrição do produto,
// trava pós-Explosão, permissões, card novo → Sheet, selo da etapa + "Mover para…").
// NÃO COMMITAR: existe só na worktree da F3.1 e é apagado na Task 11 do plano
// docs/superpowers/plans/2026-09-23-planejamento-unificado-f31-campos.md (evidência → .superpowers/sdd/2026-09-23-f31/).
//
// SÓ LEITURA. O app local fala com o Supabase de PRODUÇÃO, então:
//  • toda ESCRITA no Supabase é SIMULADA aqui (route.fulfill — nunca chega ao banco) ou BARRADA (violação ⇒ falha);
//  • GETs passam; alguns são "patchados" no caminho p/ montar o cenário (card enviado à Explosão, Reprovado,
//    chave ligada, permissões) — o banco não muda;
//  • na ORIGEM DO APP (o vite), qualquer requisição NÃO-GET é barrada (server fns rodam com service role);
//  • o robô NÃO troca de loja: toda leitura de tenant_config tem de ser da Loja Teste, senão falha.
// Único efeito inerente, sem dado de loja: cada login grava last_sign_in_at/refresh token no Auth (4 logins).
// Variáveis: E2E_BASE_URL (obrigatória, local) · F31_SELO=1 (selo/"Mover para…", exige a F2 juntada) · F31_OUT.
import { test, expect, type Browser, type BrowserContext, type Page, type Request, type Route } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { doLogin } from "./_helpers";

const BASE = process.env.E2E_BASE_URL ?? "";
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(BASE)) {
  throw new Error(`E2E_BASE_URL local obrigatória (recebi "${BASE}"). O default do playwright.config é PRODUÇÃO.`);
}
const SELO = process.env.F31_SELO === "1";
const OUT = path.resolve(process.env.F31_OUT ?? ".superpowers/f31/qa");
const LOJA_TESTE = "37889b78-fffb-404b-8c75-18b7e50a1d9b";
const SUPA_HOST = new URL(process.env.VITE_SUPABASE_URL ?? "https://sem-supabase.invalid").host;
const FAKE_ID = "00000000-0000-4000-8000-00000000f310";
const SECAO_DEV = "Desenvolvimento — equipe e cronograma";
// RPCs de LEITURA liberadas (conferidas nas migrations: sem INSERT/UPDATE/DELETE; avaliar_condicoes_kanban é
// STABLE — funcoes.sql:9851-9858). Qualquer outra RPC sem simulação é BARRADA e vira violação.
const READ_RPCS = new Set([
  "custo_unitario_modelos", "modelo_mo_resumo", "estoque_tecido_por_artigo", "otb_orcamento",
  "sidebar_badges", "minhas_permissoes_efetivas", "get_user_tenant_id", "meu_tenant_ativo",
  "modelos_mo_a_aprovar_count", "avaliar_condicoes_kanban",
]);
const CAMPOS_DEV = [
  "modelista_id", "piloteiro1_id", "piloteiro2_id", "piloteiro3_id", "data_piloto1", "data_piloto2", "data_piloto3",
  "data_desenho_tecnico", "data_aprovacao", "observacoes_tecnicas", "motivo_cancelamento", "ficha_medida_url", "observacoes_gerais",
];
const DATAS = ["data_piloto1", "data_piloto2", "data_piloto3", "data_desenho_tecnico", "data_aprovacao"];
// Config do kanban "de fábrica" p/ cenários determinísticos: board padrão, REF revelada em Aprovado, sem
// requisitos, chave desligada. Aplicada por cima do tenant_config REAL da Loja Teste (só na resposta).
const CFG_BASE = {
  kanban_automatico: false, status_kanban: null, ref_exibir_status: null, kanban_requisitos: {},
  kanban_requisitos_excecoes: {}, revenda_kanban_colunas: [], revenda_kanban_requisitos: {},
};
const PERMS_BASE = [
  { pagina: "criacao_planejamento", pode_ver: true, pode_editar: true },
  { pagina: "criacao_planejamento:custos", pode_ver: true, pode_editar: true },
  { pagina: "criacao_planejamento:preco_venda", pode_ver: true, pode_editar: true },
];

// Barradas ESPERADAS: continuam BARRADAS (route.abort), mas não reprovam o teste — lição do QA da F3.0
// (diário do guardião, G-fase F3.0 R1/R3): a Home chama `servicos_financeiro` ao logar (DEFINER que sincroniza
// parcelas_servico em PRODUÇÃO — HomeLogado.tsx:135; NUNCA liberar) e o Realtime manda presença pelo REST
// quando o canal ainda não entrou (`/realtime/v1/api/broadcast`, sem dado de loja).
const BARRADAS_ESPERADAS = [/^POST \/rest\/v1\/rpc\/servicos_financeiro$/, /^POST \/realtime\/v1\/api\/broadcast/];

type Gravada = { metodo: string; caminho: string; corpo: unknown };
type Fake = { casa: (m: string, u: URL) => boolean; responde: (r: Route) => Promise<void>; leitura?: boolean };
type Estado = {
  gravadas: Gravada[]; violacoes: string[]; barradasEsperadas: string[]; errosPagina: string[];
  tenants: Set<string>; fakes: Fake[];
};
const novoEstado = (): Estado => ({ gravadas: [], violacoes: [], barradasEsperadas: [], errosPagina: [], tenants: new Set(), fakes: [] });

function caminho(u: URL): string {
  const q = [...u.searchParams.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join("&");
  return q ? `${u.pathname}?${q}` : u.pathname;
}
function corpo(req: Request): unknown {
  try { return req.postDataJSON(); } catch { return req.postData(); }
}

async function novaPagina(browser: Browser, st: Estado, viewport = { width: 1366, height: 900 }): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ baseURL: BASE, viewport });
  await ctx.route((u) => u.host === SUPA_HOST, async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const m = req.method();
    const p = u.pathname;
    if (p.startsWith("/auth/v1/") || p.startsWith("/storage/v1/object/sign/")) return route.continue();
    if (p === "/rest/v1/tenant_config") {
      const t = u.searchParams.get("tenant_id");
      if (t) st.tenants.add(t.replace(/^eq\./, ""));
    }
    const fake = st.fakes.find((f) => f.casa(m, u));
    if (fake) {
      if (!fake.leitura) st.gravadas.push({ metodo: m, caminho: caminho(u), corpo: corpo(req) });
      return fake.responde(route);
    }
    if (p.startsWith("/rest/v1/rpc/") && READ_RPCS.has(p.slice("/rest/v1/rpc/".length))) return route.continue();
    if (m === "GET" || m === "HEAD") return route.continue();
    const linha = `${m} ${caminho(u)}`;
    if (BARRADAS_ESPERADAS.some((re) => re.test(linha))) st.barradasEsperadas.push(linha);
    else st.violacoes.push(linha);
    return route.abort("blockedbyclient");
  });
  const origem = new URL(BASE).origin;
  await ctx.route((u) => u.origin === origem, async (route) => {
    const m = route.request().method();
    if (m === "GET" || m === "HEAD") return route.continue();
    st.violacoes.push(`APP ${m} ${caminho(new URL(route.request().url()))}`);
    return route.abort("blockedbyclient");
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => st.errosPagina.push(String(e?.message ?? e)));
  await doLogin(page);
  return { ctx, page };
}

// ---- respostas simuladas / leituras "patchadas" (o banco não muda) ----
async function responderLinhas(r: Route, linhas: unknown[]) {
  const objeto = (r.request().headers()["accept"] ?? "").includes("vnd.pgrst.object");
  await r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(objeto ? (linhas[0] ?? null) : linhas) });
}
async function patchResposta(r: Route, patch: () => Record<string, unknown>) {
  const resp = await r.fetch();
  const dado = await resp.json();
  const alt = (x: any) => (x && typeof x === "object" ? { ...x, ...patch() } : x);
  await r.fulfill({ response: resp, json: Array.isArray(dado) ? dado.map(alt) : alt(dado) });
}
function fakeModelo(id: string, estado: Record<string, unknown>): Fake {
  return {
    leitura: true,
    casa: (m, u) => m === "GET" && u.pathname === "/rest/v1/modelos" && u.searchParams.get("select") === "*" && u.searchParams.get("id") === `eq.${id}`,
    responde: (r) => patchResposta(r, () => estado),
  };
}
function fakeTenantConfig(cfg: Record<string, unknown>): Fake {
  return {
    leitura: true,
    casa: (m, u) => m === "GET" && u.pathname === "/rest/v1/tenant_config" && u.searchParams.get("select") === "*",
    responde: (r) => patchResposta(r, () => cfg),
  };
}
function fakeCond(id: string, cond: Record<string, boolean>): Fake {
  return {
    leitura: true,
    casa: (m, u) => m === "POST" && u.pathname === "/rest/v1/rpc/avaliar_condicoes_kanban",
    responde: async (r) => {
      const ids = ((corpo(r.request()) as any)?._ids ?? []) as string[];
      const out: Record<string, Record<string, boolean>> = {};
      for (const x of ids) out[x] = x === id ? cond : {};
      await r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(out) });
    },
  };
}
function fakePatchModelo(id: string, estado?: Record<string, unknown>): Fake {
  return {
    casa: (m, u) => m === "PATCH" && u.pathname === "/rest/v1/modelos" && u.searchParams.get("id") === `eq.${id}`,
    responde: async (r) => {
      const b = corpo(r.request()) as Record<string, unknown> | null;
      if (estado && b && "status_desenvolvimento" in b) estado.status_desenvolvimento = b.status_desenvolvimento;
      if (new URL(r.request().url()).searchParams.has("select")) {
        await r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ id }]) });
      } else {
        await r.fulfill({ status: 204, body: "" });
      }
    },
  };
}
function fakeFilhas(): Fake {
  return {
    casa: (m, u) => m !== "GET" && m !== "HEAD" && (u.pathname === "/rest/v1/modelo_tecidos" || u.pathname === "/rest/v1/modelo_tecido_variantes"),
    responde: (r) => (r.request().method() === "DELETE"
      ? r.fulfill({ status: 204, body: "" })
      : r.fulfill({ status: 201, contentType: "application/json", body: "[]" })),
  };
}
function fakeRpc(nome: string, valor: unknown, aoChamar?: (b: unknown) => void): Fake {
  return {
    casa: (m, u) => m === "POST" && u.pathname === `/rest/v1/rpc/${nome}`,
    responde: async (r) => {
      aoChamar?.(corpo(r.request()));
      await r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(valor) });
    },
  };
}
function fakePermissoes(perms: unknown[]): Fake[] {
  return [
    { leitura: true, casa: (m, u) => m === "GET" && u.pathname === "/rest/v1/user_roles", responde: (r) => r.fulfill({ status: 200, contentType: "application/json", body: "[]" }) },
    { leitura: true, casa: (m, u) => m === "POST" && u.pathname === "/rest/v1/rpc/minhas_permissoes_efetivas", responde: (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(perms) }) },
  ];
}

// ---- navegação ----
const dlg = (page: Page) => page.getByRole("dialog").first();
async function idInterno(page: Page): Promise<string> {
  const resp = page.waitForResponse((r) => {
    const u = new URL(r.url());
    return u.host === SUPA_HOST && u.pathname === "/rest/v1/modelos" && r.request().method() === "GET"
      && (u.searchParams.get("select") ?? "").startsWith("id,nome,ref,ref_auto,");
  }, { timeout: 60_000 });
  await page.goto("/criacao/planejamento", { waitUntil: "networkidle" });
  const linhas = (await (await resp).json()) as { id: string; nome: string | null; origem: string | null }[];
  const interno = [...linhas].sort((a, b) => (a.nome ?? "").localeCompare(b.nome ?? "") || a.id.localeCompare(b.id))
    .find((m) => (m.origem ?? "interno") === "interno");
  if (!interno) throw new Error("A Loja Teste não tem card interno no Planejamento.");
  return interno.id;
}
async function abrirCard(page: Page, id: string) {
  await page.goto(`/criacao/planejamento?modelo=${id}`, { waitUntil: "networkidle" });
  await expect(dlg(page)).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState("networkidle").catch(() => {});
}
function botaoSecao(page: Page, titulo: string) {
  const re = new RegExp(`^\\s*${titulo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`);
  return dlg(page).locator("section > button").filter({ hasText: re });
}
async function abrirSecao(page: Page, titulo: string) {
  const b = botaoSecao(page, titulo).first();
  await expect(b).toBeVisible();
  if ((await b.getAttribute("aria-expanded")) === "false") await b.click();
}
async function temSecao(page: Page, titulo: string): Promise<boolean> {
  return (await botaoSecao(page, titulo).count()) > 0;
}
function patches(st: Estado, id: string) {
  return st.gravadas.filter((g) => g.metodo === "PATCH" && g.caminho.startsWith("/rest/v1/modelos?") && g.caminho.includes(`id=eq.${id}`));
}
async function salvar(page: Page, st: Estado, id: string): Promise<Record<string, unknown>> {
  const antes = patches(st, id).length;
  await dlg(page).getByRole("button", { name: "Salvar", exact: true }).click();
  await expect.poll(() => patches(st, id).length, { timeout: 20_000 }).toBeGreaterThan(antes);
  await expect(page.getByText("Modelo salvo").first()).toBeVisible({ timeout: 20_000 });
  return patches(st, id).at(-1)!.corpo as Record<string, unknown>;
}
async function fechar(page: Page) {
  await dlg(page).getByRole("button", { name: "Voltar", exact: true }).click();
  const alerta = page.getByRole("alertdialog");
  if (await alerta.waitFor({ state: "visible", timeout: 1500 }).then(() => true, () => false)) {
    await alerta.getByRole("button", { name: "Descartar" }).click();
  }
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 10_000 });
}
async function reabrir(page: Page, id: string) {
  if ((await page.getByRole("dialog").count()) > 0) await fechar(page);
  await abrirCard(page, id);
}
function conferirLimpo(st: Estado, nome: string) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `${nome}.json`), JSON.stringify({
    gravadas: st.gravadas, violacoes: st.violacoes, barradasEsperadas: st.barradasEsperadas,
    errosPagina: st.errosPagina, tenants: [...st.tenants],
  }, null, 2));
  expect(st.violacoes, "escrita/RPC não prevista chegou à guarda").toEqual([]);
  expect(st.errosPagina, "erro de JS na página").toEqual([]);
  expect(st.tenants.size > 0 && [...st.tenants].every((t) => t === LOJA_TESTE),
    `loja ≠ Loja Teste (${[...st.tenants].join(",")}) — o robô NÃO troca de loja; peça ao dono`).toBe(true);
}

test.describe.configure({ mode: "serial" });

test("desktop — Descrição, seção Desenvolvimento, REF, trava, Motivo, card novo (e selo com F31_SELO=1)", async ({ browser }) => {
  test.setTimeout(10 * 60_000);
  fs.mkdirSync(OUT, { recursive: true });
  const st = novoEstado();
  const { ctx, page } = await novaPagina(browser, st);
  const id = await idInterno(page);
  const estado: Record<string, unknown> = {
    enviado_cad: false, ordem_criacao_enviada: false, lancado: false, status_desenvolvimento: null,
    piloteiro2_id: null, data_piloto2: null, piloteiro3_id: null, data_piloto3: null,
  };
  st.fakes = [fakeModelo(id, estado), fakeTenantConfig(CFG_BASE), fakePatchModelo(id, estado), fakeFilhas(), fakeRpc("salvar_modelo_servico_mo", null)];

  // S1 — ordem das seções; Descrição = último campo da seção 1, largura total; payload
  await abrirCard(page, id);
  const tit = (await dlg(page).locator("section > button").allTextContents()).map((t) => t.trim());
  const pos = (t: string) => tit.indexOf(t);
  for (const t of ["Informações Gerais do Produto", "Coleção", SECAO_DEV, "Ajustes na Prova", "Tecido Planejado", "Preço", "Anexos", "Observações", "Lançamento"]) {
    expect(pos(t), `seção "${t}"`).toBeGreaterThanOrEqual(0);
  }
  expect(pos("Coleção")).toBeLessThan(pos(SECAO_DEV));
  expect(pos(SECAO_DEV)).toBeLessThan(pos("Ajustes na Prova"));
  // Mockup aprovado (R9c): os tecidos ficam no lugar da seção 5 — depois da Prova, ANTES do Preço e da Mão de obra.
  expect(pos("Ajustes na Prova")).toBeLessThan(pos("Tecido Planejado"));
  expect(pos("Tecido Planejado")).toBeLessThan(pos("Preço"));
  if (pos("Mão de obra") >= 0) expect(pos("Tecido Planejado")).toBeLessThan(pos("Mão de obra"));
  expect(pos("Anexos")).toBeLessThan(pos("Observações"));
  expect(pos("Observações")).toBeLessThan(pos("Lançamento"));
  // R9b: com o campo de observação da M.O. na tela (quem vê custos), o rótulo é "Obs. Mão de Obra" (igual ao Dev).
  if (pos("Mão de obra") >= 0) {
    await abrirSecao(page, "Mão de obra");
    if ((await dlg(page).locator("#obs-mao-obra").count()) > 0) {
      await expect(dlg(page).locator('label[for="obs-mao-obra"]')).toHaveText("Obs. Mão de Obra");
    }
  }
  const desc = dlg(page).locator('textarea[data-colab-path="descricao_produto"]');
  await expect(desc).toHaveAttribute("placeholder", "Descreva o produto…");
  const geo = await desc.evaluate((el) => {
    const sec = el.closest("section")!;
    const grade = sec.querySelector(":scope div.grid") as HTMLElement;
    const campos = Array.from(sec.querySelectorAll("input, textarea, [role=combobox]"));
    return { campo: el.getBoundingClientRect().width, grade: grade.getBoundingClientRect().width, ultimo: campos[campos.length - 1] === el };
  });
  expect(Math.abs(geo.campo - geo.grade)).toBeLessThanOrEqual(2);
  expect(geo.ultimo).toBe(true);
  // Estilista ganha "— Nenhum —" (2º combobox da seção 1: Status, Estilista, Origem, Grupo…)
  await dlg(page).locator("section").first().getByRole("combobox").nth(1).click();
  await expect(page.getByRole("option", { name: "— Nenhum —" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.screenshot({ path: path.join(OUT, "S1-sheet.png"), fullPage: true });
  await desc.fill("Vestido midi QA F3.1 — não salvo");
  const p1 = await salvar(page, st, id);
  expect(p1.descricao_produto).toBe("Vestido midi QA F3.1 — não salvo");
  expect(p1).not.toHaveProperty("status_desenvolvimento");
  expect(p1).not.toHaveProperty("ref");
  for (const k of DATAS) expect(p1[k] === null || /^\d{4}-\d{2}-\d{2}$/.test(String(p1[k])), `${k}=${String(p1[k])}`).toBe(true);

  // S2 — seção "Desenvolvimento — equipe e cronograma"
  await abrirSecao(page, SECAO_DEV);
  for (const p of ["data_piloto1", "data_desenho_tecnico", "data_aprovacao"]) await expect(dlg(page).locator(`input[data-colab-path="${p}"]`)).toBeVisible();
  await expect(dlg(page).locator('input[data-colab-path="ref"]')).toHaveCount(0);
  await dlg(page).locator('input[data-colab-path="data_piloto1"]').fill("12/09/2026");
  await dlg(page).locator('textarea[data-colab-path="observacoes_tecnicas"]').fill("Pence frontal (QA F3.1)");
  await dlg(page).getByRole("button", { name: "Adicionar Piloto 2" }).click();
  await expect(dlg(page).locator('input[data-colab-path="data_piloto2"]')).toBeVisible();
  await page.screenshot({ path: path.join(OUT, "S2-secao-dev.png"), fullPage: true });
  const p2 = await salvar(page, st, id);
  expect(p2.data_piloto1).toBe("2026-09-12");
  expect(p2.observacoes_tecnicas).toBe("Pence frontal (QA F3.1)");
  expect(p2.data_piloto2).toBeNull();

  // S3 — REF editável a partir da etapa de revelação (Aprovado na config de fábrica)
  Object.assign(estado, { ordem_criacao_enviada: true, status_desenvolvimento: "aprovado", ref: "QAREF0001" });
  await reabrir(page, id);
  await expect(dlg(page).getByText("REF QAREF0001")).toBeVisible();
  await abrirSecao(page, SECAO_DEV);
  const ref = dlg(page).locator('input[data-colab-path="ref"]');
  await expect(ref).toHaveValue("QAREF0001");
  await ref.fill("QAREF0002");
  expect((await salvar(page, st, id)).ref).toBe("QAREF0002");
  Object.assign(estado, { status_desenvolvimento: "em_modelagem" });
  await reabrir(page, id);
  await abrirSecao(page, SECAO_DEV);
  await expect(ref).toHaveCount(0);
  await desc.fill("Descrição (QA) — REF escondida");
  expect(await salvar(page, st, id)).not.toHaveProperty("ref");

  // S4 — trava pós-Explosão só nas seções do Dev + "Editar" + Salvar re-trava
  Object.assign(estado, { status_desenvolvimento: "aprovado", enviado_cad: true });
  await reabrir(page, id);
  await abrirSecao(page, SECAO_DEV);
  const obs = dlg(page).locator('textarea[data-colab-path="observacoes_tecnicas"]');
  await expect(obs).toBeDisabled();
  await expect(dlg(page).getByTestId("aviso-campos-dev").first()).toContainText("Enviado à Explosão");
  await expect(dlg(page).locator('input[data-colab-path="nome"]')).toBeEnabled();
  await abrirSecao(page, "Anexos");
  await expect(dlg(page).locator('textarea[data-colab-path="observacoes_gerais"]')).toBeDisabled();
  await abrirSecao(page, "Ajustes na Prova");
  await expect(dlg(page).getByPlaceholder("Escreva um ajuste…")).toBeDisabled();
  await page.screenshot({ path: path.join(OUT, "S4-travado.png"), fullPage: true });
  const editar = dlg(page).getByRole("button", { name: "Editar", exact: true });
  await editar.click();
  await expect(obs).toBeEnabled();
  await obs.fill("Ajuste pós-Explosão (QA F3.1)");
  expect((await salvar(page, st, id)).observacoes_tecnicas).toBe("Ajuste pós-Explosão (QA F3.1)");
  await expect(obs).toBeDisabled();
  await expect(editar).toBeVisible();

  // S5 — Motivo do Cancelamento: só em Reprovado; sair de Reprovado NÃO apaga
  Object.assign(estado, { enviado_cad: false, status_desenvolvimento: "reprovado", motivo_cancelamento: "Tecido esgotado (QA F3.1)" });
  await reabrir(page, id);
  const mot = dlg(page).locator('textarea[data-colab-path="motivo_cancelamento"]');
  await expect(mot).toHaveValue("Tecido esgotado (QA F3.1)");
  await desc.fill("Descrição (QA) — Reprovado");
  expect((await salvar(page, st, id)).motivo_cancelamento).toBe("Tecido esgotado (QA F3.1)");
  Object.assign(estado, { status_desenvolvimento: "aprovado" });
  await reabrir(page, id);
  await expect(mot).toHaveCount(0);
  await desc.fill("Descrição (QA) — saiu de Reprovado");
  expect((await salvar(page, st, id)).motivo_cancelamento).toBe("Tecido esgotado (QA F3.1)");

  // S8 — selo no header + "Mover para…" (só com a F2 juntada)
  if (SELO) {
    Object.assign(estado, { ordem_criacao_enviada: false, status_desenvolvimento: null, enviado_cad: false, lancado: false });
    await reabrir(page, id);
    const selo = dlg(page).getByTestId("etapa-kanban-selo-header");
    await expect(selo).toContainText("Planejamento");
    await expect(dlg(page).getByTestId("etapa-mover-gatilho")).toHaveCount(0);

    // (b) chave DESLIGADA — regras do board de hoje (cascata); PATCH só do status + marcar_etapa_verificada
    const verificada: unknown[] = [];
    st.fakes = [
      fakeModelo(id, estado), fakeTenantConfig({ ...CFG_BASE, kanban_requisitos: { em_pilotagem: ["data_piloto1"] } }),
      fakeCond(id, {}), fakePatchModelo(id, estado), fakeRpc("marcar_etapa_verificada", null, (b) => verificada.push(b)),
      fakeFilhas(), fakeRpc("salvar_modelo_servico_mo", null),
    ];
    Object.assign(estado, { ordem_criacao_enviada: true, status_desenvolvimento: "em_modelagem" });
    await reabrir(page, id);
    await expect(selo).toContainText("Em Modelagem");
    await dlg(page).getByTestId("etapa-mover-gatilho").click();
    const menu = page.getByTestId("etapa-mover-menu");
    await expect(menu.getByTestId("etapa-mover-em_pilotagem")).toContainText("falta Data de Piloto I preenchida");
    await page.screenshot({ path: path.join(OUT, "S8-menu-desligada.png") });
    const n0 = patches(st, id).length;
    await menu.getByTestId("etapa-mover-em_pilotagem").click();
    await expect(page.getByText("Não pode entrar aqui. Faltam: Data de Piloto I preenchida").first()).toBeVisible();
    expect(patches(st, id).length).toBe(n0);
    await dlg(page).getByTestId("etapa-mover-gatilho").click();
    await page.getByTestId("etapa-mover-menu").getByTestId("etapa-mover-corte_piloto_1").click();
    await expect.poll(() => patches(st, id).length).toBe(n0 + 1);
    expect(patches(st, id).at(-1)!.corpo).toEqual({ status_desenvolvimento: "corte_piloto_1" });
    await expect.poll(() => verificada.length).toBe(1);
    expect(verificada[0]).toEqual({ _modelo_id: id, _etapa: "kanban" });
    await expect(selo).toContainText("Corte de Piloto I");

    // (c) chave LIGADA — kanban_mover decide; "Próxima: … — falta: …"
    const mover: unknown[] = [];
    st.fakes = [
      fakeModelo(id, estado),
      fakeTenantConfig({ ...CFG_BASE, kanban_automatico: true, kanban_requisitos: { em_pilotagem: ["data_piloto1"] } }),
      fakeCond(id, {}), fakePatchModelo(id, estado),
      {
        casa: (m, u) => m === "POST" && u.pathname === "/rest/v1/rpc/kanban_mover",
        responde: async (r) => {
          mover.push(corpo(r.request()));
          estado.status_desenvolvimento = "stand_by";
          await r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ acao: "fixar", status: "stand_by", faltando: [], rev: 999 }) });
        },
      },
      fakeFilhas(), fakeRpc("salvar_modelo_servico_mo", null),
    ];
    Object.assign(estado, { status_desenvolvimento: "em_modelagem" });
    await reabrir(page, id);
    await expect(selo).toContainText("automática");
    await expect(dlg(page).getByTestId("etapa-proxima")).toContainText("Em Pilotagem");
    await expect(dlg(page).getByTestId("etapa-proxima")).toContainText("Data de Piloto I preenchida");
    await dlg(page).getByTestId("etapa-mover-gatilho").click();
    const menu2 = page.getByTestId("etapa-mover-menu");
    await expect(menu2.getByTestId("etapa-mover-stand_by")).toContainText("fixa aqui");
    await expect(menu2.getByTestId("etapa-mover-em_pilotagem")).toContainText("falta 1 dado");
    await page.screenshot({ path: path.join(OUT, "S8-menu-ligada.png") });
    await menu2.getByTestId("etapa-mover-stand_by").click();
    await expect(page.getByText('Fixado em "Stand By"').first()).toBeVisible();
    expect(mover).toEqual([{ _modelo_id: id, _para: "stand_by" }]);
    await expect(selo).toContainText("fixado");
  }

  // S7 — card novo: Dialog → Sheet do id criado; 2º Salvar = UPDATE (nunca 2º INSERT)
  const post = { n: 0 };
  const linhaNova: Record<string, unknown> = {};
  st.fakes = [
    {
      casa: (m, u) => m === "POST" && u.pathname === "/rest/v1/modelos",
      responde: async (r) => {
        post.n += 1;
        Object.assign(linhaNova, corpo(r.request()) as object, { id: FAKE_ID, rev: 1, tenant_id: LOJA_TESTE });
        await r.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: FAKE_ID }) });
      },
    },
    {
      leitura: true,
      casa: (m, u) => m === "GET" && u.pathname === "/rest/v1/modelos" && u.searchParams.get("id") === `eq.${FAKE_ID}`,
      responde: (r) => responderLinhas(r, post.n > 0 ? [linhaNova] : []),
    },
    fakePatchModelo(FAKE_ID), fakeFilhas(), fakeRpc("salvar_modelo_servico_mo", null), fakeTenantConfig(CFG_BASE),
  ];
  if ((await page.getByRole("dialog").count()) > 0) await fechar(page);
  await page.goto("/criacao/planejamento", { waitUntil: "networkidle" });
  await page.locator("button:visible", { hasText: "Novo Modelo" }).first().click();
  await expect(dlg(page)).toContainText("Novo Modelo");
  expect(await temSecao(page, SECAO_DEV)).toBe(false);
  // Mockup aprovado (gen_novo.py, R9c): Info → Coleção → Tecidos → Mão de obra → Anexos.
  const titNovo = (await dlg(page).locator("section > button").allTextContents()).map((t) => t.trim());
  const pN = (t: string) => titNovo.indexOf(t);
  expect(pN("Coleção")).toBeLessThan(pN("Tecido Planejado"));
  expect(pN("Tecido Planejado")).toBeLessThan(pN("Anexos"));
  if (pN("Mão de obra") >= 0) expect(pN("Tecido Planejado")).toBeLessThan(pN("Mão de obra"));
  const descNovo = dlg(page).locator('textarea[data-colab-path="descricao_produto"]');
  await expect(descNovo).toHaveAttribute("placeholder", "Descreva o produto…");
  await page.screenshot({ path: path.join(OUT, "S7-dialog-novo.png"), fullPage: true });
  await dlg(page).locator('input[data-colab-path="nome"]').fill("QA F3.1 — card novo (não salvo)");
  await descNovo.fill("Descrição do card novo (QA)");
  await dlg(page).getByRole("button", { name: "Salvar", exact: true }).click();
  await expect.poll(() => post.n, { timeout: 20_000 }).toBe(1);
  await expect.poll(() => temSecao(page, SECAO_DEV), { timeout: 20_000 }).toBe(true);
  await expect(dlg(page).locator("h2").first()).toContainText("QA F3.1 — card novo");
  await expect(dlg(page).getByRole("button", { name: "Excluir", exact: true })).toBeVisible();
  await expect(dlg(page).locator('textarea[data-colab-path="descricao_produto"]')).toHaveValue("Descrição do card novo (QA)");
  await dlg(page).locator('textarea[data-colab-path="descricao_produto"]').fill("Descrição editada (QA)");
  const pNovo = await salvar(page, st, FAKE_ID);
  expect(pNovo.descricao_produto).toBe("Descrição editada (QA)");
  expect(post.n).toBe(1);
  await fechar(page);

  conferirLimpo(st, "desktop");
  await ctx.close();
});

test("permissões — sem ver o Dev / ver sem editar", async ({ browser }) => {
  test.setTimeout(6 * 60_000);
  const casos = [
    { nome: "sem-ver-dev", perms: PERMS_BASE },
    { nome: "ver-sem-editar-dev", perms: [...PERMS_BASE, { pagina: "criacao_desenvolvimento", pode_ver: true, pode_editar: false }] },
  ];
  for (const caso of casos) {
    const st = novoEstado();
    st.fakes = [...fakePermissoes(caso.perms), fakeTenantConfig(CFG_BASE)];
    const { ctx, page } = await novaPagina(browser, st);
    const id = await idInterno(page);
    const estado = { enviado_cad: false, ordem_criacao_enviada: false, lancado: false };
    st.fakes.push(fakeModelo(id, estado), fakePatchModelo(id), fakeFilhas(), fakeRpc("salvar_modelo_servico_mo", null));
    await abrirCard(page, id);
    if (caso.nome === "sem-ver-dev") {
      for (const t of [SECAO_DEV, "Ajustes na Prova", "Observações"]) expect(await temSecao(page, t), t).toBe(false);
      await abrirSecao(page, "Anexos");
      await expect(dlg(page).locator('textarea[data-colab-path="observacoes_gerais"]')).toHaveCount(0);
    } else {
      await abrirSecao(page, SECAO_DEV);
      await expect(dlg(page).locator('textarea[data-colab-path="observacoes_tecnicas"]')).toBeDisabled();
      await expect(dlg(page).getByTestId("aviso-campos-dev").first()).toContainText("Somente leitura");
      await expect(dlg(page).getByRole("button", { name: "Editar", exact: true })).toHaveCount(0);
    }
    await page.screenshot({ path: path.join(OUT, `perm-${caso.nome}.png`), fullPage: true });
    await dlg(page).locator('textarea[data-colab-path="descricao_produto"]').fill(`Descrição (QA ${caso.nome})`);
    const p = await salvar(page, st, id);
    for (const k of CAMPOS_DEV) expect(p, `${caso.nome}: ${k}`).not.toHaveProperty(k);
    expect(p).not.toHaveProperty("ref");
    expect(p.descricao_produto).toBe(`Descrição (QA ${caso.nome})`);
    await fechar(page);
    conferirLimpo(st, `permissoes-${caso.nome}`);
    await ctx.close();
  }
});

test("mobile 390 — Sheet sem estouro (seção Desenvolvimento aberta; selo/menu com F31_SELO=1)", async ({ browser }) => {
  test.setTimeout(4 * 60_000);
  const st = novoEstado();
  const { ctx, page } = await novaPagina(browser, st, { width: 390, height: 844 });
  const id = await idInterno(page);
  const estado = { enviado_cad: false, ordem_criacao_enviada: true, status_desenvolvimento: "em_modelagem", lancado: false };
  st.fakes = [fakeModelo(id, estado), fakeTenantConfig(CFG_BASE), fakeCond(id, {})];
  await abrirCard(page, id);
  await abrirSecao(page, SECAO_DEV);
  const sheet = await dlg(page).evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth, dir: el.getBoundingClientRect().right }));
  expect(sheet.sw).toBeLessThanOrEqual(sheet.cw + 1);
  expect(sheet.dir).toBeLessThanOrEqual(391);
  const corpoRolavel = await dlg(page).locator("div.overflow-y-auto").first().evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
  expect(corpoRolavel.sw).toBeLessThanOrEqual(corpoRolavel.cw + 1);
  if (SELO) {
    await dlg(page).getByTestId("etapa-mover-gatilho").click();
    const box = await page.getByTestId("etapa-mover-menu").boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    await page.keyboard.press("Escape");
  }
  await page.screenshot({ path: path.join(OUT, "mobile-390.png"), fullPage: true });
  await fechar(page);
  conferirLimpo(st, "mobile");
  await ctx.close();
});
```

- [ ] **Step 4: Rodar**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f31-planejamento-campos"
E2E_BASE_URL=http://localhost:5199 F31_SELO=<0 ou 1> npx playwright test tests/e2e/f31-qa.spec.ts --workers=1 --retries=0 2>&1 | tee .superpowers/f31/logs/qa.log | tail -15
```
`F31_SELO=1` só se a Task 8 foi feita (F2 juntada). Expected: a linha literal `3 passed`. `0 passed`/erro de `E2E_BASE_URL` = NÃO TESTADO. Falha de asserção: diagnosticar (screenshot/trace em `test-results/`); se for bug do código, voltar à task dona e refazer o QA; se for o spec, corrigir o spec e registrar o porquê. `violacoes`/`errosPagina`/loja ≠ Loja Teste = falha dura (nunca relaxar a guarda).

- [ ] **Step 5: Encerrar o vite `:5199` (só o nosso)**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f31-planejamento-campos"
PID=$(cat .superpowers/f31/vite-5199.pid)
lsof -nP -iTCP:5199 -sTCP:LISTEN -t | grep -qx "$PID" && lsof -a -p "$PID" -d cwd -Fn | grep -q "f31-planejamento-campos" && kill "$PID" && echo "vite 5199 (PID $PID) encerrado"
lsof -nP -iTCP:5199 -sTCP:LISTEN; lsof -nP -iTCP:5173 -sTCP:LISTEN -t
```
Expected: `encerrado`; nada em `:5199`; o PID do dono em `:5173` segue lá.

- [ ] **Step 6: Evidência**

```bash
mkdir -p "/Users/sunglee/PLM + Criação/plm-pcp/.superpowers/sdd/2026-09-23-f31/qa"
cp -R .superpowers/f31/qa/. "/Users/sunglee/PLM + Criação/plm-pcp/.superpowers/sdd/2026-09-23-f31/qa/"
cp .superpowers/f31/logs/qa.log .superpowers/f31/logs/t1-*.txt .superpowers/f31/logs/t1-*.log "/Users/sunglee/PLM + Criação/plm-pcp/.superpowers/sdd/2026-09-23-f31/" 2>/dev/null; echo "evidência copiada"
```
O spec fica na worktree até o smoke da Task 11 (não commitar).

---

### Task 11: Revisão final, portões do guardião, merge e smoke

**Files:** nenhum código novo. Apaga `tests/e2e/f31-qa.spec.ts` no fim.

**Interfaces:**
- Consumes: Tasks 0–10 commitadas/revisadas; coluna em produção (Task 9); QA `3 passed` (Task 10).
- Produces: `feature/plan-tecido-a1` com os commits da F3.1 (ff); evidência no diário.

- [ ] **Step 1: code-reviewer (Opus) no diff inteiro**

Diff: `git -C "$WT" diff "$(git -C "$WT" merge-base HEAD feature/plan-tecido-a1)"..HEAD`. Foco: (a) Dev intocado (decisão 8) e nenhum arquivo da F2/F1-TS/rotas mexido; (b) etapa FORA do Salvar — nenhum payload do Sheet leva `status_desenvolvimento`; "Mover para…" com a chave desligada = board literal (UPDATE só do status + `marcar_etapa_verificada`), ligada = `kanban_mover`; nada apaga `motivo_cancelamento`; (c) permissão: sem `canEdit("criacao_desenvolvimento")` nada do Dev nem a REF sai no payload e as seções ficam só-leitura; sem `canView` elas somem; (d) trava pós-Explosão só nas seções do Dev + "Editar" + re-trava; (e) card novo nunca faz 2º INSERT (sucesso, erro após o insert, clique duplo) e remonta como Sheet; (f) colab: rótulos novos, merge por campo, rev após "Mover para…"; (g) queryKeys (`tenant-plan-ficha-config`, `plan-kanban-cond`, `["colab", tipo]` com o mesmo shape do Dev) e invalidações; (h) migration/inverso (já passaram no G-migration). Achado bloqueante volta à task dona.

- [ ] **Step 2: Suíte INTEIRA 1× na cópia local (R10 do G-plano conjunto)**

Como a F3.1 tem SQL, o G-commit não fica só com `tests/unit` + o teste próprio. Só com NENHUM teste da F1 (ou de outra fase) rodando na cópia local — o controlador confere; se estiver ocupada, espera (não mata nada).

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f31-planejamento-campos"
ps -Ao pid,command | grep -E "[v]itest"; echo "vitest-checado"
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres npx vitest run --no-file-parallelism tests/unit tests/integration > .superpowers/f31/logs/suite-final.log 2>&1
grep -E "Test Files|Tests " .superpowers/f31/logs/suite-final.log | tail -2
grep -E "^ *FAIL " .superpowers/f31/logs/suite-final.log | sed -E 's/ +[0-9]+ms$//' | sort -u > .superpowers/f31/logs/suite-fail-final.txt
comm -13 .superpowers/f31/suite-fail-t0.txt .superpowers/f31/logs/suite-fail-final.txt > .superpowers/f31/logs/suite-fail-novas.txt
[ -s .superpowers/f31/logs/suite-fail-novas.txt ] && { cat .superpowers/f31/logs/suite-fail-novas.txt; echo "FALHA NOVA NA SUÍTE INTEIRA"; } || echo "suíte inteira: nenhuma falha nova"
grep -c "modelo-descricao-produto.test.ts" .superpowers/f31/logs/suite-fail-final.txt
PGCONNECT_TIMEOUT=5 psql "postgresql://postgres:postgres@127.0.0.1:54422/postgres" -X -Atc "select count(*) from information_schema.columns where table_schema='public' and table_name='modelos' and column_name='descricao_produto'; select md5(pg_get_functiondef('public._replicar_cards_plan_tecido_core(uuid,uuid,uuid,uuid[],integer)'::regprocedure))"
```

Expected: só `vitest-checado`; `suíte inteira: nenhuma falha nova`; `0` (o teste da F3.1 passa); a cópia local intacta (`0` e `e0393c79fb962a068fd7a3e4636acbe6`). Falha nova num arquivo da F3.1 = BLOQUEIA (volta à task dona). Falha nova em arquivo de OUTRA fase trazido pelo rebase (ex.: testes novos da F1): classificar no relato (não é da F3.1). **Se não der para rodar** (cópia local fora do ar/ocupada, ou sem a linha de base do Task 0 Step 5): registrar o desvio em `.superpowers/f31/logs/r10-desvio.txt` e no relato do G-commit — o portão decide.

- [ ] **Step 3: Guardião — G-commit + G-fase F3.1**

Pedir ao `guardiao-unificacao` (report-only) os portões G-commit e G-fase da F3.1 com: este plano, o diff, os logs (`gates`, `t1-*` — inclusive o `t1-ensaio-local.log` —, `prod-apply.log`, `suite-final.log` + `suite-fail-novas.txt` ou `r10-desvio.txt`, `qa.log`, JSONs do QA), e a lista de decisões técnicas da §7 (para registrar deriva de escopo: trava na F3.1, selos/numeração → F3.3, Origem Importado → F3.4, hook próprio de config, fix sem tocar a rota, aviso nas seções do Dev, query do modelo subiu, ordem do mockup, receita de travas). BLOQUEIA = parar e corrigir.

- [ ] **Step 4: Pré-merge**

```bash
MAIN="/Users/sunglee/PLM + Criação/plm-pcp"; WT="$MAIN/.claude/worktrees/f31-planejamento-campos"
git -C "$WT" rebase feature/plan-tecido-a1 && (cd "$WT" && .superpowers/f31/gates.sh)
git -C "$MAIN" branch --show-current; git -C "$MAIN" status --porcelain -- src/components/planejamento
ls "$MAIN/.git/index.lock" 2>/dev/null; echo "lock-check-fim"
```
Expected: rebase limpo + `GATES OK`; `feature/plan-tecido-a1`; nada pendente em `src/components/planejamento` no principal; `lock-check-fim`. O controlador: (1) confirma a coluna em produção (`== IDA OK` e as conferências no `prod-apply.log` da Task 9); (2) AVISA o dono por chat para SALVAR e FECHAR os cards abertos do Planejamento (a ordem dos hooks muda → o Fast Refresh remonta o Sheet); (3) pausa os executores de F1/F2/F3.2 durante o ff.

- [ ] **Step 5: Merge (fast-forward)**

```bash
git -C "/Users/sunglee/PLM + Criação/plm-pcp" merge --ff-only f31/planejamento-campos
git -C "/Users/sunglee/PLM + Criação/plm-pcp" log --oneline -12
```
Expected: `Fast-forward`; os commits `F3.1 (1)…(8)` no topo. Sem push.

- [ ] **Step 6: Smoke pós-merge no `:5173` do dono (só leitura)**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f31-planejamento-campos"
E2E_BASE_URL=http://localhost:5173 F31_SELO=<o mesmo da Task 10> npx playwright test tests/e2e/f31-qa.spec.ts -g "desktop" --workers=1 --retries=0 2>&1 | tail -6
```
Expected: `1 passed` (o `:5173` agora serve o código novo). Se o `:5173` estiver fora do ar, NÃO subir nada no lugar: reportar e o controlador decide.

- [ ] **Step 7: Limpeza e relato**

```bash
rm "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f31-planejamento-campos/tests/e2e/f31-qa.spec.ts"
git -C "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/f31-planejamento-campos" status --porcelain
```
Expected: status vazio. Se a F3.1 foi em 2 partes, a worktree FICA para a F3.1b; senão o controlador a remove (`git worktree remove` + `git branch -d f31/planejamento-campos`). Relato ao dono: o que entrou, o que ficou para F3.2/F3.3/F3.4, que a F3.2 pode começar agora (R8), e a lista de testes manuais da §5 **com o aviso de que cada item grava em PRODUÇÃO e só roda com o OK dele, item a item** (R11). CLAUDE.md/memória = F4 (docs-keeper).

---

## 5. Critérios de aceite por seção (mockup aprovado × F3.1)

| Onde | Critério (mockup `gen_main.py`/`gen_anotado.py`/`gen_novo.py`) | Na F3.1? | Como se prova |
|---|---|---|---|
| Header | Nome · REF (read-only, só quando existe) · selo âmbar "não salvo" | já existia | S1 (screenshot) |
| Header | Selo da etapa abaixo da REF: "Planejamento" antes da Ordem de Criação; coluna do board; "automática"/"fixado" c/ a chave ligada; "Lançado" | sim (T8) | S8a/S8b/S8c |
| Header | Selo clicável abre "Mover para…" (anota "falta X"/"fixa aqui"/…); bloqueado não move | sim (T8) | S8b/S8c |
| Header | "→ Próxima: X — falta: Y" (chave ligada, card automático) | sim (T8) | S8c |
| Topo | Motivo do Cancelamento só em Reprovado; sair não apaga | sim (T5) | S5 |
| Seção 1 | "Descrição do produto" = último campo, largura total; placeholder "Descreva o produto…" (Dialog); Estilista "— Nenhum —" | sim (T3) | S1, S7 |
| Seção 1 | Origem "Importado" (decisão F3 #3) | **F3.4** | — |
| Seção 2 Coleção | sem mudança | — | S1 (ordem) |
| Seção 3 "Desenvolvimento — equipe e cronograma" | REF editável a partir da etapa; Modelista; Cronograma & pilotos (Piloteiro 1, Data Piloto 1, Data Desenho Técnico, Data Aprovação); Adicionar/remover Piloto 2/3; Observações Técnicas; recolhida; só no Sheet; comprado segue Fluxo de Revenda | sim (T5) | S2, S3, S6 |
| Seção 4 Ajustes na Prova | fio de comentários do Dev, grava na hora; trava c/ o card enviado | sim (T6) | S4 |
| Seção 5 (lugar dos Tecidos) | "Tecido Planejado" sobe para depois da Prova e ANTES do Preço/Mão de obra (posição da seção 5 do mockup; a F3.2 troca pelo BOM) | sim (T6) | S1 (ordem) |
| Seções 5–9 (Tecidos, Aviamentos, Insumos, Grade, CAD) como BOM | — | **F3.2 / F3.3** | — |
| Seção 10 Preço e Custos | sem mudança (custos adicionais, base do markup → F3.2) | — | — |
| Seção 11 Mão de obra | campo de observação ganha o rótulo "Obs. Mão de Obra" (igual ao Dev; R9b) | sim (T6) | S1 |
| Seção 12 Anexos | + Ficha de Medida + Observações Gerais (só Sheet; travam com o Dev) | sim (T6) | S4, S6 |
| Seção 13 Observações | bloco do Dev (Composição), grava na hora | sim (T6) | S1 (ordem), visual |
| 14–15 Lançamento / Produto Relacionado | sem mudança | — | S1 (ordem) |
| Rodapé | "Editar" com o card enviado à Explosão; Salvar re-trava | sim (T5) | S4 |
| Rodapé | Enviar à Explosão, menu ⋯ (Duplicar/Importar/Ficha Técnica/Cancelar OC) | **F3.3** | — |
| Todas | Numeração "N." e selos de completude por seção ("completa", "falta X", "anexos ok"…) | **F3.3** | — |
| Novo Modelo (Dialog) | Descrição com placeholder; sem seções do Dev; ao Salvar vira o Sheet do card; 2º Salvar não duplica | sim (T3, T7) | S7 |
| Novo Modelo (Dialog) | ordem Info → Coleção → Tecidos → Mão de obra → Anexos (`gen_novo.py`; o título vira "Tecidos" na F3.2) | sim (T6) | S7 (ordem) |
| Novo Modelo (Dialog) | seletor de tecidos grava o BOM Tecido 1..N | **F3.2** | — |
| Permissão | sem ver o Dev: seções somem; ver sem editar: só-leitura + aviso; payload sem campos do Dev | sim (T2, T5) | P1, P2 |
| Mobile 390 | Sheet e menu "Mover para…" sem estouro horizontal | sim | teste mobile |

**Testes manuais (R11 do G-plano conjunto) — ⚠️ GRAVAM EM PRODUÇÃO (Loja Teste).** Cada item só roda com o OK explícito do dono **ITEM A ITEM** (o OK de um não vale para o outro), depois da Task 9 e do merge; quem executa (o dono, ou o controlador com o usuário de teste) é a decisão D3. Registrar no diário do guardião o item, o card e o horário. Efeitos permanentes marcados em cada item.
1. Digitar a Descrição num card → Salvar → reabrir: o texto volta. Idem Modelista/datas/Obs. Técnicas. *Grava no card (reversível à mão).*
2. Enviar uma Ficha de Medida (PDF/imagem) na seção Anexos → Salvar → reabrir: miniatura aparece; conferir que o Dev mostra a mesma ficha. *Grava um ARQUIVO no Storage de produção (`<tenant>/fichas/<modeloId>/…`) — remover da ficha não apaga o arquivo.*
3. Plan. Tecido → "Replicar card(s)" de um card com Descrição → a réplica tem a Descrição. *CRIA um card (a réplica) — apagar depois, com o OK do dono.*
4. Card novo: 1º Salvar abre o Sheet; 2º Salvar não cria outro card (conferir a lista). *CRIA um card — apagar depois, com o OK do dono.*
5. Card enviado à Explosão: seções do Dev travadas → "Editar" → mudar Obs. Técnicas → Salvar re-trava. *Grava no card.*
6. "Mover para…" com a chave desligada: mover um card de teste para uma coluna sem requisito; conferir no board do Desenvolvimento e que o #Erro (se houver) sumiu; mover para Reprovado, escrever o motivo, Salvar, tirar de Reprovado → o motivo continua no banco (voltar para Reprovado mostra o texto). *IRREVERSÍVEL: chegar à etapa de revelação da REF (`ref_exibir_status`, padrão Aprovado) copia `ref_auto → ref` e a REF NÃO volta (invariante #11) — escolher um card e uma coluna ANTES dessa etapa, ou ter o OK do dono para revelar; cada movimento grava histórico do Leadtime (`modelo_kanban_historico`).* **Durante o item 6, NÃO salvar o card no Sheet do Desenvolvimento:** o Salvar do Dev apaga o motivo fora de Reprovado (`ModeloDetailPanel.tsx:1882`) e o teste passaria a medir o Dev, não a F3.1.
7. Colaboração: o mesmo card aberto no Desenvolvimento (outra aba) e no Planejamento; mudar a Modelista nos dois e salvar → banner de conflito "Modelista" com "manter meu · usar o novo". *Grava no card pelos DOIS lados.*
8. (Só depois da G-chave, com a chave ligada na Loja Teste) "Mover para…" automático: fixar em Stand By, soltar, tentar pular etapa. *Mesmos efeitos do item 6 (REF e histórico).*

## 6. Riscos (verificados) e cobertura

| # | Risco | Evidência | Cobertura |
|---|---|---|---|
| R1 | Data vazia no payload → 22007 em TODO Salvar | Draft guarda datas como `""` (padrão do Dev, ModeloDetailPanel.tsx:114-118); payload = `...draft` (usePlanejamentoSave.ts:72-79) | `aplicarRegrasCamposDev` no MESMO commit que cria os campos (T2); teste unit; QA S1 confere datas `null`/ISO |
| R2 | Coluna ausente em produção → PGRST204 em todo Salvar (o vite do dono grava em produção) | payload leva `descricao_produto` a partir da T2 | T9 antes do QA e do merge; pré-condição no T10 Step 1 (`== IDA OK`) e T11 Step 4 |
| R3 | O Sheet do Dev (intocado) ainda APAGA o motivo ao salvar fora de Reprovado | ModeloDetailPanel.tsx:1882 | aceito (decisão 8); o Sheet unificado e o "Mover para…" nunca apagam; registrado p/ a F5 |
| R4 | Duplicar passaria a copiar equipe/datas do Dev | `...rest` (PlanejamentoDetail.tsx:702) | `camposParaDuplicar` (T2) + teste |
| R5 | 2º Salvar do card novo duplica | usePlanejamentoSave.ts:163-168; rota sem `key` (criacao.planejamento.tsx:1134-1136) | wrapper com `key` + `criadoIdRef` + ramo de erro (T7); QA S7 |
| R6 | "Porta lateral": editar campos do Dev de card já explodido pelo Planejamento | Dev trava tudo (ModeloDetailPanel.tsx:1600); Planejamento não trava nada | trava nas seções da F3.1 (T5/T6); `devBloqueado` exposto p/ F3.2/F3.3 |
| R7 | `<fieldset disabled>` em volta da `Secao` travaria o botão de abrir/fechar | `Secao` = `<section><button>…{open && children}` (campos.tsx:18-36) | fieldset SEMPRE dentro dos children (T5/T6) |
| R8 | Ordem dos hooks muda → Fast Refresh remonta o Sheet aberto do dono no merge | lição R18 da F3.0 | aviso "salvar e fechar" no T11 Step 4 (a query do modelo que subiu na T5 também muda a ordem) |
| R9 | Conflito de merge com a F3.2 (mesmos 4 arquivos) | §3 | F3.1 (ou F3.1a) juntada primeiro; a F3.2 NASCE dela (R8) e escreve sobre o texto final; interfaces e âncoras finais declaradas (§3 itens 1-7); comentário-âncora no JSX |
| R10 | F2 não juntada quando a T8 chega | F2 sem commit em `src/` (23/set) | F3.1 em 2 partes (§3); F3.1a não depende da F2 |
| R11 | QA gravar em produção | app local → produção; `playwright.config.ts:26` default = produção | guarda 2 frentes, fakes, `E2E_BASE_URL` obrigatório (throw), trava de loja por `tenant_id`, `--retries=0` |
| R12 | Integração, ensaio e suíte inteira da F3.1 disputarem a cópia local com a F1 (lock em `modelos`) | cópia local compartilhada; F1 com testes em andamento | controlador serializa (T0 Step 5, T1 Steps 3/6/8, T11 Step 2 — `ps … [v]itest` antes) |
| R13 | "Mover para…" (chave desligada) revela a REF ao chegar na etapa configurada — não volta | fn_modelo_ref_auto (inv. #11) | mesmo efeito do board de hoje; nada novo — citar no relato |
| R14 | Dica do "Mover para…" velha (outro usuário mudou filhas do BOM) | `plan-kanban-cond` fora do realtime | invalidação no save/mover; com a chave ligada o servidor decide (toast pela resposta) |
| R15 | Título "Observações" duplicado (Secao + Card do componente) | ModeloObservacoes.tsx:126-128 | aceito (componente compartilhado com o Dev; F5 limpa) |
| R16 | Upload da Ficha grava no Storage de produção quando usado | uploadFile (modelo-shared.ts:36-43) | só em uso real; QA não faz upload |
| R17 | `modelos.rev` muda pelo "Mover para…" enquanto há rascunho | merge re-sincroniza rev sem mexer no Draft (PlanejamentoDetail.tsx:532-540) | `setQueryData` + invalidação; P0409 do Salvar segue tratado pelo retry |
| R18 | Popover dentro do Sheet (foco/portal) | Radix | QA desktop + mobile abrem o menu |
| R19 | Anti-drift | tests/unit/ui-padroes-antidrift.test.ts | sem hex/oklch/hsl/toFixed/size={N}/`text-[<11px]`; `gates.sh` confere |
| R20 | O ALTER em `modelos` pede ACCESS EXCLUSIVE — com `psql -f` e lock_timeout de 3 s ele segurava a tabela mais usada do app por ~6 idas e voltas e podia esperar 3 s (G-plano conjunto R7) | G-migration da F1 R1 (diário 813-828) | ALTER POR ÚLTIMO no arquivo; `aplica_v2`: arquivo numa mensagem, lock_timeout 500 ms + transaction_timeout 3 s, retry só 55P03/40P01/25P04; teste da desistência em 55P03 (T1) + ensaio local (T1 Step 8) |
| R21 | Testes manuais gravam em PRODUÇÃO (REF revelada não volta; cards criados; arquivo no Storage; o Salvar do Dev apaga o motivo) | §5; `ModeloDetailPanel.tsx:1882`; inv. #11 | OK do dono ITEM A ITEM + efeitos por item na §5 (R11 do G-plano conjunto); decisão D3 |
| R22 | `onCreated`/`aoSalvar` são opcionais/funções: se a F3.2 os perder, o `tsc` NÃO acusa (card duplicado volta; Salvar deixa de re-travar) | §3 item 7 | a F3.2 tem gate de grep "F3.1 preservada" em todo commit e o QA S6 dela prova Dialog → Sheet com 1 POST (R1 do G-plano conjunto) |

## 7. Decisões técnicas (o controlador decide; o guardião registra)

- **T1 Trava pós-Explosão entra JÁ na F3.1** para as seções que ela traz (seção Desenvolvimento, Prova, Ficha/Obs. Gerais, Observações, Motivo) + "Editar" + re-trava. Sem isso, a partir do merge o Planejamento viraria porta lateral para editar cards já explodidos. A F3.2/F3.3 estendem com `devBloqueado`; "Enviar à Explosão" e o pós-envio pelo botão ficam na F3.3.
- **T2 Numeração "N." + selos de completude por seção → F3.3** (quando todas as seções existirem). A F3.1 não mexe no `Secao` — evita conflito com as seções da F3.2 (que nasce depois — R8).
- **T3 Origem "Importado" (decisão F3 #3) → F3.4** (muda o fluxo de comprado), embora a G-fase da F3.0 a tenha rabiscado para a F3.1.
- **T4 Config própria** (`useFichaKanban`, key `tenant-plan-ficha-config`, `select("*")`) em vez do `useKanbanConfig` da F2 → as Tasks 1–7 independem da F2; o custo é 1 leitura a mais de `tenant_config` por Sheet (F5 consolida).
- **T5 Fix do card novo dentro do `PlanejamentoDetail`** (wrapper + `key`), sem tocar em `criacao.planejamento.tsx` (arquivo da F2) — zero conflito.
- **T6 Motivo do Cancelamento no topo (header)**, como o Anotado/Prova ("Topo · aparece quando a etapa é Reprovado"), `rows={2}`.
- **T7 Aviso "Enviado à Explosão…/Somente leitura…"** no topo de cada seção vinda do Dev (não está no mockup; no card misto sem ele o usuário não entende por que só parte trava).
- **T8 "Próxima: X — falta: Y" só com a chave ligada** (o mockup é da chave ligada; o card da F2 faz igual).
- **T9 Toast "Card movido para …"** no "Mover para…" com a chave desligada (o board não tem toast porque o card se move na tela; no Sheet o toast confirma).
- **T10 "— Nenhum —"** no Estilista (o mockup marca "muda") e em Modelista/Piloteiros, via `FieldSelect.onLimpar` opcional (rota não muda).
- **T11 REF aparada** e só no payload quando editável; vazia → NULL (o trigger volta a preencher com `ref_auto` quando a etapa permitir — igual ao Dev).
- **T12 Obs. Gerais tratada como campo do Dev** (trava e omissão sem permissão), mas o Duplicar continua copiando (o de hoje — decisão 9).
- **T13 Inverso com guarda de confirmação** (`SET LOCAL app.confirmo_apagar_descricao_produto = 'sim'` na MESMA transação — injetado pelo `EXTRA_SQL` do `aplica_v2`, `volta-producao.sh --confirmo-apagar-descricoes`) além do aviso no cabeçalho e do export automático antes.
- **T14 Piloto 2/3 visíveis derivados do draft** (cópia adaptada; o original do Dev não vê piloto 2 que chega por merge).
- **T15 Merge em 2 partes** se a F2 atrasar (§3). A F3.2 só nasce depois do merge da F3.1/F3.1a (R8); a F3.1b pode correr junto com a F3.2 (quem juntar por último faz rebase).
- **T16 A query `["modelo", modeloId]` e a trava (`enviadoCad`/`editandoDev`/`devBloqueado`/`motivoTravaDev`) sobem para logo depois das permissões (T5).** Mesma key e queryFn; só muda a ordem dos hooks (já coberta pelo aviso de "salvar e fechar" do merge). Motivo: a F3.2 deriva a trava do BOM desta (R2 — uma trava só) e chama o `useFichaTecnica` antes do cálculo de preço/"não salvo"; sem subir, `motivoTravaDev` seria usado antes de declarado.
- **T17 Ordem do mockup (R9c):** o "Tecido Planejado" sobe para depois da Prova e antes do Preço/Mão de obra (T6). No Dialog fica Info → Coleção → Tecido(s) → Mão de obra → Anexos, como o `gen_novo.py`; no Sheet ocupa o lugar da seção 5, que a F3.2 troca pelo BOM. Sem impedimento técnico (só JSX; nenhum estado muda).
- **T18 Rótulo "Obs. Mão de Obra" (R9b):** a F3.1 assume (T6) — pós-F3.0 o campo estava sem rótulo (`PlanejamentoDetail.tsx:909`); o componente compartilhado já tinha a prop `label` (não muda).
- **T19 Receita de travas (R7):** o arquivo NÃO carrega timeout (igual à F1: o `aplica_v2` injeta os `SET LOCAL` depois do `BEGIN;`). No harness o teste usa só `lock_timeout = '500ms'` — o `transaction_timeout` derrubaria a conexão do teste; ele é exercido no ensaio da cópia local (T1 Step 8), o mesmo que a F1 fez no runbook. `aplica.sh` copia literalmente `espera`/`ativ_vazio`/`com_travas`/`aplica_v2` do runbook v2 da F1.
- **T20 Suíte inteira (R10):** linha de base no T0 Step 5 e comparação no T11 Step 2 (falha nova em arquivo da F3.1 bloqueia; de outra fase, classifica); sem cópia local disponível, o desvio é registrado.

## 8. Decisões para o dono

- **D1 (autorização obrigatória)** — OK para aplicar a migration da coluna `modelos.descricao_produto` em produção (Task 9), depois do G-migration do guardião e ANTES do QA/merge da F3.1. É aditiva (não mexe em dado); vai pela receita de travas da F1 (um comando só, desiste em meio segundo se a tabela estiver ocupada e tenta de novo). O inverso apaga as descrições digitadas e só roda com confirmação explícita.
- **D2** — "Replicar" do **Produto Acabado/Importado** também deve levar a Descrição? Hoje ele copia só a identidade do produto para o card (nome, categoria, coleção, REF). A decisão de 23/set cobriu o "Replicar card(s)" do Plan. Tecido. **Recomendo: não agora** (exigiria redefinir mais 2 funções; dá para fazer depois se fizer falta).
- **D3** — Os 8 testes manuais da §5 gravam na Loja Teste em PRODUÇÃO: cada um só com o seu OK, item a item. Efeitos que ficam: o item 6 (e o 8) pode revelar a REF do card — ela não volta — e grava histórico do Leadtime; os itens 3 e 4 criam cards (apagamos depois, com o seu OK); o item 2 grava um arquivo no Storage. Durante o item 6 ninguém salva o card no Desenvolvimento (o Salvar de lá apaga o motivo). Você faz, ou autoriza o controlador com o usuário de teste?

## 9. Self-review (feito ao escrever)

- **Cobertura do escopo F3.1:** `DevEquipeSection` (REF editável por `refCampoVisivel`/posição derivada, modelista, pilotos 1–3 + datas, desenho técnico, aprovação, obs. técnicas) → T5; motivo de cancelamento → T5 (topo); Anexos + Ficha de Medida + Obs. Gerais → T6; Prova e Observações por reuso direto → T6; `Draft`/`emptyDraft`/`draftFromModeloRow` + rótulos de conflito → T2; `data-colab-path` → T3/T5/T6; `canView`/`canEdit("criacao_desenvolvimento")` + `revendaCampoVisivel` → T5/T6; trava pós-Explosão + "Editar" → T5/T6 (§7-T1); selo no header + "Mover para…" (etapa fora do Salvar, chave desligada = hoje, motivo não apagado) → T4/T8; fix do card novo → T7; ordem do mockup + rótulo Obs. Mão de Obra → T6 (R9b/R9c); query do modelo + trava antes do preço → T5 (interface da F3.2, R2); receita de travas + ensaio → T1/T9 (R7); suíte inteira → T0/T11 (R10); testes manuais item a item → §5/§8 (R11); F3.2 só depois do merge → §3 (R8); Descrição (coluna, migration própria > 20260930150000, inverso avisando, Replicar com diff, teste na cópia local, Duplicar copia, Importar não, placeholder, Ficha não imprime, sem `types.ts`) → T1/T2/T3; ordem obrigatória → T9 antes de T10/T11; QA sem escrita + manual do dono → T10/§5; dependência da F2 e ordem de merge → §3; interfaces p/ a F3.2 → §3; lote × individual → §4; riscos → §6; decisões → §7/§8.
- **Placeholders:** nenhum "TBD/TODO/similar a". `refEditavel: false` na T2 é valor real daquele commit (a REF só fica editável quando a seção existir, T5), trocado por texto exato na T5. Código novo por extenso; código MOVIDO: a query `["modelo", modeloId]` (T5, texto idêntico, só a posição) e o bloco "Tecido Planejado" (T6, texto idêntico + 1 comentário); a função SQL é montada do corpo vivo por script com 2 trocas conferidas.
- **Consistência de nomes:** `aplicarRegrasCamposDev`/`camposParaDuplicar`/`textoOuNull`/`CAMPOS_DEV_DRAFT` (T2, usados em T2/T10); `useFichaKanban`/`FichaKanban` (variável `kanbanCard` no orquestrador — `ficha` é da F3.2)/`statusEfetivoFicha`/`refVisivelFicha`/`podeEntrarHoje`/`opcoesMoverHoje`/`mensagemBloqueioHoje`/`OpcaoMover` (T4, usados em T5/T8); `devBloqueado`/`motivoTravaDev`/`MotivoTravaDev`/`campoVisivelDev`/`refEditavel`/`aoSalvar`/`editandoDev` (T5, usados em T6/T7/T8); `opcoesMoverAuto`/`proximaEtapa`/`useMoverEtapa`/`MoverEtapaVars`/`EtapaHeader` (T8); testids `aviso-campos-dev`, `motivo-cancelamento`, `etapa-header`, `etapa-kanban-selo-header`, `etapa-mover-gatilho`, `etapa-mover-menu`, `etapa-mover-<key>`, `etapa-proxima` = os usados no spec (T10). queryKeys: `tenant-plan-ficha-config`, `plan-kanban-cond`, `["colab", tipo]`, `modelo-composicao`.
- **Execução recomendada:** superpowers:subagent-driven-development, tasks ESTRITAMENTE sequenciais na MESMA worktree (caminho absoluto no prompt), 1 subagente Sonnet por task; revisão conforme §4; a Task 9 é do controlador com o dono.
