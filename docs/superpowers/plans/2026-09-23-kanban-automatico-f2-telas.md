# Kanban automático — F2 (telas: board do Dev + Config da Loja + selo no card) — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Levar o Kanban automático da F1 (banco) para as telas — board do Desenvolvimento com arraste/"Mover para…" pela tabela única de arraste + RPC `kanban_mover`, Config da Loja com a chave (prévia ao ligar, restaurar ao desligar, "Salvar e mover N cards", etiquetas por coluna, colunas de kanban FORA do upsert genérico — RP3) e o selo de etapa no card do Planejamento — sem mudar nada com a chave desligada.

**Architecture:** Toda regra de negócio continua em `src/lib/kanban-auto.ts` (espelho do SQL, F1 — NÃO editar) e, no fim, no servidor (RPCs da F1). A F2 soma 2 módulos PUROS (`kanban-auto-ui.ts` = modo da coluna, textos, selo, tipos das RPCs; `kanban-auto-config.ts` = diff/conflito das colunas de kanban e agrupamento das prévias), 1 módulo fino de RPC (`kanban-auto-rpc.ts`), 1 hook (`useKanbanConfig`, `select("*")` p/ tolerar o banco sem a F1) e componentes de apresentação. Em cada tela o ramo novo só roda com `kanban_automatico === true`; o ramo de hoje fica literal.

**Tech Stack:** React 18 + TypeScript, TanStack Query/Router, Supabase JS (PostgREST RPC), Radix/shadcn (`Dialog fixedFooter mobileFull`, `Switch`, `Checkbox`, `Select`), lucide-react, sonner, Vitest (unit, `environment: node`), Playwright 1.61 (E2E só-leitura).

**Spec:** `/Users/sunglee/.claude/plans/h-uma-necessidade-de-flickering-lovelace.md` (seções "F2 — Kanban no front + Config + selo no card", "Regras de derivação", "Decisões do dono (travadas)", decisões de 22–23/set). Contratos do banco: `docs/superpowers/plans/2026-09-22-kanban-automatico-f1-banco.md` (§3 regras normativas + mensagens + GUCs + gates; Tasks 15–16 = RPCs públicas; Task 18 Step 8 = lista da G-chave). Ressalvas: diário `/.superpowers/sdd/2026-09-22-unificacao-kanban-auto/guardiao.md` (RP3, R8, D19 "a garantia de prévia antes de confirmar fica com o front da F2"). Mockup APROVADO (F0): `/private/tmp/claude-501/-Users-sunglee-PLM---Cria--o/f73c31ec-0c58-49a9-b65c-05edfa4258fc/scratchpad/canvas-unif/gen_rest.py` + `gen_cfg.py` (PNGs em `qa-shots/`) — textos/rótulos do mockup são a referência de UI.

## Global Constraints

- Repo `/Users/sunglee/PLM + Criação/plm-pcp`, branch `feature/plan-tecido-a1`. Caminhos abaixo relativos a essa raiz. A F1 está sendo executada EM PARALELO no mesmo repo (HEAD em 23/set: `673f419`, migration 3 em andamento) → index compartilhado: **NUNCA `git add .`**; arquivo NOVO: `git add -- <arquivo>`; commit SEMPRE `git commit --only -m "<msg>" -- <paths da task>`; conferir com `git show --stat HEAD`. Mensagem termina com `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- **Banco de PRODUÇÃO proibido** — nem leitura (`/tmp/dburl.txt` nunca é usado nesta fase). Se precisar olhar dado/esquema: SÓ `psql "postgresql://postgres:postgres@127.0.0.1:54422/postgres"` com `SELECT` (a cópia local NÃO tem os objetos da F1 aplicados; contratos da F1 = o plano da F1 + os arquivos de migration do repo).
- **Nada de migration**: nenhum arquivo em `supabase/` é criado ou editado nesta fase (a F1 entrega o banco). Nenhum arquivo em `tests/integration/` é editado.
- **Sheet do Desenvolvimento INTOCADO (decisão travada 8):** nada em `src/components/desenvolvimento/` nem em `src/components/producao/cad/CadTecidosSection.tsx`. Prova antes de cada commit: `git diff --name-only savepoint-pre-unificacao-2026-09-22 -- src/components/desenvolvimento/ src/components/producao/cad/CadTecidosSection.tsx` → vazio.
- **Espelho da F1 travado:** NÃO editar `src/lib/kanban-auto.ts`, `src/lib/kanban-status.ts`, `src/lib/kanban-condicoes.ts`, `tests/fixtures/kanban-auto-casos.ts`, `tests/unit/kanban-auto.test.ts` (anti-drift TS×SQL). A F2 só IMPORTA deles.
- **Chave desligada = caminho de hoje.** Todo comportamento novo fica atrás de `kanbanAuto`/`ligado` (= `tenant_config.kanban_automatico === true`). O código antigo (`podeEntrar`, `updateStatus` com `marcar_etapa_verificada`, faixas "Não pode entrar aqui. Faltam: …") permanece literal; só ganha um `if (kanbanAuto)` antes.
- **Sem a F1 aplicada o front novo = chave desligada:** leitores novos de `tenant_config` usam `select("*")` (pedir `kanban_automatico` pelo nome daria 42703 antes da F1). O switch da Config fica desabilitado quando a coluna não existe (`motorKanbanDisponivel`).
- **Contratos da F1 (nomes/assinaturas — não inventar outros):** `kanban_mover(_modelo_id uuid, _para text) → {acao, status, faltando[], rev}`; `kanban_previa_recalculo(_cfg jsonb) → {chave_proposta, total, mudam, fixados, cards[{modelo_id,nome,ref,origem,de,para,fixado,recua,primeira_falha,faltando}], cards_fixados[{modelo_id,nome,ref,origem,coluna,posicao_derivada}], revelam_ref, refs_reveladas[{modelo_id,nome,ref_auto,posicao_derivada}], avisos[]}`; `kanban_definir_automatico(_ligar boolean) → {ligado, mudou, lote_id, snapshot, cards_movidos}`; `kanban_previa_restauracao(_lote_id uuid DEFAULT NULL::uuid) → {lote_id, motivo, criado_at, restaurado_at, chave_ligada, total, voltam, movidos_depois, cards[{modelo_id,nome,ref,de,para,movido_manual_depois}], avisos[]}`; `kanban_restaurar(_lote_id uuid) → {lote_id, restaurados, historico_apagado}`. Coluna `tenant_config.kanban_automatico boolean NOT NULL DEFAULT false` (só muda pela RPC — decisão 16).
- **Rótulos de condição SEMPRE de `CONDICAO_BY_KEY`** (`kanban-condicoes.ts`); mensagens de arraste de `mensagemDrop` (F1), com UMA troca feita na F2 sem tocar a F1: no caso `fora_do_fluxo` a frase usa o RÓTULO da coluna (`labelDaColuna(para, cols)`), não a key técnica que a `mensagemDrop` devolve (R1 do G-plano). Textos novos em PT-BR, iguais ao mockup aprovado quando o mockup os mostra — **exceção de texto registrada** (decisão de desenho 1, §6): o toast "já cumpre" e o "tirá-lo" do toast de fixar seguem a frase da F1, não a do mockup.
- **Ícones lucide, nunca emoji:** automática = `Zap`, manual = `Hand`, fixado = `Pin`, entrada = `ArrowRight`, lançado = `Rocket`. Tamanho só por `className` (`h-3 w-3`, `h-3.5 w-3.5`, `h-4 w-4`); `size={N}` só com N ∈ {14,16,20,24} (anti-drift regra c).
- **Cor só por token** (`var(--tone-*-bg/fg)`, `var(--kanban-*)`, `var(--muted-foreground)`, classes do tema). Proibido hex, `oklch(`, `hsl(` (anti-drift a/f). Tema claro é o default.
- **Padrão UI (docs/design/ui-padroes.md §A/§G/§Q):** confirmação/config = `Dialog` (`<DialogContent fixedFooter mobileFull>` + `<DialogBody>` + rodapé `Voltar` (outline, `ArrowLeft`, esquerda) · ação primária `ml-auto`); modal montado só quando aberto (`{aberto && <X/>}`); alvos de toque 44px no mobile.
- **queryKeys:** config do kanban = `["tenant-kanban-auto", tenantId]` (contém "tenant" ⇒ casa `matchTenantConfig`, invalida no save da Config e no realtime). Prévias = `["kanban-previa-ligar"]`, `["kanban-previa-restauracao"]` (fora de qualquer matcher — os números não mudam sob os olhos do admin). `["desenv-condicoes"]` é invalidada pelo board após cada `kanban_mover` e ao fechar o Sheet (chave ligada).
- **Gates antes de cada commit:** `npm run build 2>&1 | tail -3` (sem erro) + `npx tsc --noEmit 2>&1 | grep -c "error TS"` → `0` (baseline 23/set = 0) + `npx vitest run --no-file-parallelism tests/unit` → só as **2 falhas pré-existentes** de `tests/unit/ui-padroes-antidrift.test.ts` (regras a/e, em `DocPrintCasca.tsx`/`OcDocumentoPrint.tsx` — baseline 23/set: `2 failed | 749 passed`) e NENHUM hit novo: `npx vitest run tests/unit/ui-padroes-antidrift.test.ts 2>&1 | grep -E "kanban|Kanban|Etapa|ModoColuna|configuracoes|criacao\.(desenvolvimento|planejamento)|RequisitosStatus"` → vazio. **NUNCA** `npx vitest run` sem caminho: sem `DATABASE_URL` a integração conecta em `/tmp/dburl.txt` (= produção — RP1 do guardião).
- **QA/E2E:** nunca matar o vite do dono. `E2E_BASE_URL` SEMPRE explícito e local — o default do `playwright.config.ts` é PRODUÇÃO. Se `curl -s -o /dev/null -w '%{http_code}' http://localhost:5173` der `200`, usar `E2E_BASE_URL=http://localhost:5173`; senão subir o próprio em 5199 (`node_modules/.bin/vite --port 5199 --strictPort & echo $! > /tmp/f2-vite.pid` — o binário direto, não `npx`, para o PID gravado ser o do vite) com `E2E_BASE_URL=http://localhost:5199` e matar SÓ esse PID no fim (`kill "$(cat /tmp/f2-vite.pid)"`). A spec recusa rodar sem `E2E_BASE_URL` local. O vite local fala com o Supabase de PRODUÇÃO → a spec E2E da F2 é **só leitura** (não salva, não liga chave, não solta card, não escolhe "Mover para…") e **travada na Loja Teste** (resposta do dono, 23/set, R2): NÃO troca de loja — nunca chama `selectStore`/`setActiveTenant`; se o usuário de teste não estiver na "Loja Teste" (tenant `37889b78-fffb-404b-8c75-18b7e50a1d9b`), o teste FALHA com mensagem clara (nunca cai numa loja real). Escrita aceita pelo dono: as preferências de filtro/agrupamento do PRÓPRIO usuário de teste (`user_ui_prefs`, seed idempotente no load do Desenvolvimento — `criacao.desenvolvimento.tsx:92-97`). Nenhuma outra escrita em produção no E2E antes da G-chave (a sessão de login no Auth é inerente a qualquer E2E e não é dado da loja).

---

## 1. Fatos verificados (23/set, só leitura) que o código abaixo assume

- TS da F1 já no repo (commits `18482f4` e anteriores): `src/lib/kanban-auto.ts` exporta `KanbanAutoConfig`, `DerivacaoInput`, `Derivacao`, `AcaoDrop`, `DestinoDrop`, `ModeloKanban`, `normKey`, `lerKanbanAutoConfig(tc:any)`, `boardDaLoja(cfg): KanbanStatus[]` (dedup), `fluxoDoModelo(origem,cfg): KanbanStatus[]`, `reqsDoModelo(origem,cfg)`, `colunaManual(col,reqs)`, `statusDerivado(input)`, `entradaParaDerivacao(modelo,cfg,cond)`, `derivarModelo(modelo,cfg,cond)`, `faltandoPara`, `destinoDrop(input,para)`, `mensagemDrop(d,para,fluxo)`, `statusParaGate`. `mensagemDrop` devolve `Falta 1 dado para completar: <label>` / `Faltam N dados para completar: <l1>, <l2>` / `O card já cumpre "<label de para>". Para segurá-lo numa etapa, use uma coluna manual.` / `A etapa "<para>" não faz parte do fluxo deste modelo.` (key CRUA — a F2 monta essa frase com o rótulo da coluna, R1) / `null`.
- `src/lib/kanban-status.ts`: `DEFAULT_STATUSES` (cores `var(--kanban-blue|indigo|violet|purple)`, `var(--warning)`, `var(--muted-foreground)`, `var(--destructive)`, `var(--success)`), `labelColunaKanban(status, cols)` (status fora do board/NULL ⇒ label da 1ª coluna), `normalizeKanbanStatuses`, `resolveStatusKey`.
- Migrations da F1 no repo (NÃO aplicadas em produção): `20260930120000_kanban_auto_1_schema.sql` (linha 68: `ADD COLUMN IF NOT EXISTS kanban_automatico boolean NOT NULL DEFAULT false`), `..._2_derivacao.sql`, `..._3_motor.sql` (em execução). A `..._4_rpcs.sql` (RPCs) ainda não existe — nasce na Task 15/16 da F1.
- Board `src/routes/_authenticated/criacao.desenvolvimento.tsx` (1140 l.): lê `tenant_config` em 3 queries próprias (`tenant-status-kanban`, `tenant-kanban-requisitos`, `tenant-revenda-config`); condições por `avaliar_condicoes_kanban` em `["desenv-condicoes", ids]` (NÃO invalidada pelo realtime); `podeEntrar` (cascata interno / revenda por `revenda-config`); `updateStatus` = `UPDATE modelos` + `marcar_etapa_verificada`; coluna bloqueada no arraste é `pointer-events-none`; mobile "Mover para…" em `MobileCard`; grupos por tecido nascem recolhidos.
- Config `src/routes/_authenticated/admin/configuracoes.tsx`: `select("*")` + `useEffect([data?.cfg])` que refaz `cfg` e o baseline do dirty; save = `upsert` da linha inteira (`...cfgRest`, linhas 257–279) — RP3; `SortableListCard` (l. 966) com `renderItemExtra`/`footer`; `FluxoRevendaCard` (l. 1162). `RequisitosStatusButton` em `src/components/admin/RequisitosStatusDialog.tsx` (hooks nas l. 52–53).
- Planejamento `src/routes/_authenticated/criacao.planejamento.tsx`: query `["modelos-planejamento"]` (select l. 361 sem `status_desenvolvimento`/`ordem_criacao_enviada`); `ModeloCard` (l. 1244) tem modo compacto e corpo cheio tabulado; REF na l. ~1400 (`{refModelo && <div className="px-2.5 pb-1 font-mono …">`).
- `realtime-invalidation-map.ts`: `matchTenantConfig(k)` = `k[0]` contém "tenant" (ou "tamanhos" ou 3 extras). Teste `tests/unit/realtime-invalidation-map.test.ts` l. 154 lista keys reais de config.
- `erro-mensagem.ts`: P0001 passa a mensagem; **42501 vira sempre "Você não tem permissão para esta ação."** (as RPCs da F1 dão 42501 com texto próprio, ex. "Apenas o administrador da loja pode ligar ou desligar o Kanban automático."); P0002 cai no `PARECE_PT` (passa).
- Cópia local (`127.0.0.1:54422`): é SÓ o container Postgres (`supabase_db_banco-local`), sem PostgREST/GoTrue/Realtime → o app NÃO consegue apontar para ela. Nenhuma das 6 lojas tem requisito configurado em `reprovado` (interno nem revenda); Ave Rara e French têm `revenda_kanban_colunas` preenchido.
- `tsconfig` inclui só `src/`; `vitest.config.ts` coleta `tests/**/*.test.ts`, alias `@` → `src`, `environment: node` (testes unit são de TS puro; componentes não têm teste unit).

## 2. Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/lib/kanban-auto-ui.ts` (novo, puro) | Tipos das respostas das RPCs + `RPC_KANBAN` (contrato); `motorKanbanDisponivel`, `modoColuna`, `rotuloModoColuna`, `descricaoModoColuna`, `labelsCondicoes`, `labelDaColuna`, `subtituloColuna`, `dropBloqueado`, `textoFaixaDrop`, `notaMoverPara`, `toastDoMover`, `proximaFalta`, `etapaDoModelo`, `tituloSelo`, `MOTIVO_REPROVADO_MANUAL`. |
| `src/lib/kanban-auto-config.ts` (novo, puro) | Colunas de kanban da Config (RP3): `KANBAN_COLS`, `pickKanban`, `jsonCanonico`, `diffKanban`, `conflitoKanban`, `separarPayloadKanban`, `descreverMudancasKanban`, `mensagemConflitoKanban`; prévias: `agruparMovimentos`, `resumirFixados`, `avisosRestauracaoVisiveis`, `formatarDataHora`, `nCards`. |
| `src/lib/kanban-auto-rpc.ts` (novo) | 5 chamadas tipadas às RPCs da F1 (`supabase.rpc`). |
| `src/hooks/useKanbanConfig.ts` (novo) | Config do kanban da loja ativa (`select("*")`, key `tenant-kanban-auto`). |
| `src/lib/erro-mensagem.ts` (mod.) | 42501 com mensagem PRÓPRIA do kanban passa direto. |
| `src/components/shared/EtapaKanbanBadge.tsx` (novo) | Selo da etapa + legenda (reusado na F3 no header do Sheet). |
| `src/components/admin/ModoColunaBadge.tsx` (novo) | Etiqueta Entrada/Automática/Manual/Manual (sempre). |
| `src/components/admin/KanbanAutomaticoDialog.tsx` (novo) | Bloco da chave (switch) + diálogos Ligar (prévia) / Desligar (restaurar) + "Salvar e mover N cards". |
| `src/components/admin/RequisitosStatusDialog.tsx` (mod.) | Prop `bloqueadoMotivo` (Reprovado travado). |
| `src/routes/_authenticated/criacao.desenvolvimento.tsx` (mod.) | Board: ramo da chave ligada (dica, RPC, toast, ícones, faixa, "Mover para…"). |
| `src/routes/_authenticated/admin/configuracoes.tsx` (mod.) | RP3 (kanban fora do upsert + conflito), etiquetas, Reprovado travado, chave + prévias. |
| `src/routes/_authenticated/criacao.planejamento.tsx` (mod.) | Selo no card cheio E no compacto (compacto: rótulo + no máximo o ícone — B1) + legenda. |
| `tests/unit/kanban-auto-ui.test.ts`, `tests/unit/kanban-auto-config.test.ts`, `tests/unit/kanban-auto-rpc-contrato.test.ts` (novos) | Lógica pura + contrato F1×F2 lido dos arquivos de migration. |
| `tests/unit/erro-mensagem.test.ts`, `tests/unit/realtime-invalidation-map.test.ts` (mod.) | Mensagens novas; key nova de config. |
| `tests/e2e/kanban-auto.spec.ts` (novo) | E2E só-leitura travado na Loja Teste (chave desligada; bloco "chave ligada" opt-in; selo no card compacto a 360/390 px). |

## 3. Regras de UI (fixadas aqui; o código das tasks as implementa)

- **Modo da coluna** (`modoColuna(col, fluxoKeys, reqs)`): fora do fluxo ⇒ `null`; 1ª coluna do fluxo ⇒ `entrada`; `reprovado` ⇒ `manual_sempre`; sem requisito PRÓPRIO ⇒ `manual`; senão `automatica` (≡ `colunaManual` da F1). No board o cabeçalho usa o fluxo INTERNO (board + `kanban_requisitos`); o card de revenda carrega a sua própria derivação.
- **Arraste com a chave ligada:** a dica vem de `destinoDrop` (cliente); a coluna "bloqueada" fica tracejada com a dica mas NÃO inerte; soltar (ou escolher no "Mover para…") chama SEMPRE `kanban_mover` (exceto soltar na própria coluna); o toast vem da RESPOSTA do servidor (`toastDoMover`). Otimista só para `fixar`/`soltar` previstos; o status final é o devolvido pela RPC.
- **Textos** (mockup `gen_rest.py`/`gen_cfg.py`): faixa "**Kanban automático ligado.** Colunas ⚡ andam sozinhas pelos campos salvos. Colunas ✋ são manuais: o card entra e sai delas arrastado." (ícones lucide); subtítulo de coluna "Todo card novo cai aqui. Exigido daqui em diante: X" / "Entra com: X" / "Manual — o card entra e sai arrastado" / "Manual (sempre) — o card entra e sai arrastado"; card "fixado — não anda sozinho" / "próx.: falta X"; "Mover para…" anota "fixa aqui" / "solta o card" / "já cumpre" / "falta 1 dado" / "faltam N dados" / "fora do fluxo"; toasts: fixar `Fixado em "X". O card não anda sozinho até alguém tirá-lo daqui.`; soltar `Card solto. Voltou para "X" — a etapa que os campos preenchidos indicam.`; bloqueio `Não pode entrar aqui. <mensagemDrop>` (+ `. O card continua fixado em "X".` se estava fixado); já-cumpre = `mensagemDrop` literal; fora-do-fluxo = `A etapa "<rótulo da coluna>" não faz parte do fluxo deste modelo.` (mesma frase da F1, com `labelDaColuna(para, cols)` no lugar da key — R1).
- **Selo** (`etapaDoModelo`): `lancado` ⇒ "Lançado" (Rocket, tom success); `ordem_criacao_enviada !== true` ⇒ "Planejamento" (ponto neutro); senão a coluna (`labelColunaKanban`) + com a chave ligada "automática" (Zap) ou "fixado" (Pin; ≡ `fixado` de `statusDerivado`, que não depende das condições). **Vale nos DOIS corpos do card** (resposta do dono 23/set, B1): no corpo cheio, o selo completo; no COMPACTO (< 1024 px com card < 170 px, ou desktop com muitas colunas), um selo pequeno numa linha própria logo abaixo da linha do status/REF — só o rótulo da etapa e, com a chave ligada, no máximo o ícone (Zap/Pin), SEM o texto "automática"/"fixado" (o `title` guarda a frase inteira); trunca o rótulo em vez de alargar o card (360/390 px sem estouro).
- **Config — RP3:** as 5 colunas `status_kanban, kanban_requisitos, kanban_requisitos_excecoes, revenda_kanban_colunas, revenda_kanban_requisitos` NUNCA vão no `upsert` genérico; vão SÓ as que o usuário mudou (diff canônico), num `update` próprio, depois de conferir que o valor no banco ainda é o que a tela carregou (senão: erro "Outra pessoa mudou … Recarregue a página …"). **Ordem do Salvar (R3):** 1º confere o conflito (nada gravado se houver); 2º `upsert` do geral; 3º — POR ÚLTIMO — o `update` do kanban, com `.select("tenant_id")` para exigir 1 linha gravada. Assim, se o geral falhar nada do kanban foi gravado (o retry não acusa conflito contra a própria gravação e nenhum card se move com a tela em erro); e o kanban, sendo a última escrita, só dá certo quando o Salvar inteiro deu certo. Com a chave ligada e diff ≠ ∅, a prévia (`kanban_previa_recalculo(diff)`) abre "Salvar e mover N cards" quando `mudam > 0` ou `revelam_ref > 0`; senão vale o AlertDialog de sempre.
- **Chave:** switch controlado pelo valor do BANCO; mexer abre o diálogo (nunca muda sozinho). Desabilitado se a F1 não está aplicada, se o módulo `criacao` está desligado ou se a página tem alteração não salva. Ligar = prévia (`{kanban_automatico:true}`) → "Ligar e mover N cards" → `kanban_definir_automatico(true)`. Desligar = prévia de restauração (lote `NULL` = o último `ligar`) → checkbox "Restaurar as colunas de antes de ligar" (desmarcado) → `kanban_definir_automatico(false)` e, se marcado, `kanban_restaurar(lote_id)`.

---

### Task 1: `src/lib/kanban-auto-ui.ts` — helpers puros de apresentação + tipos das RPCs

**Files:**
- Create: `src/lib/kanban-auto-ui.ts`
- Test: `tests/unit/kanban-auto-ui.test.ts`

**Interfaces:**
- Consumes (F1, já no repo): `CONDICAO_BY_KEY` (`kanban-condicoes.ts`); `DEFAULT_STATUSES`, `labelColunaKanban`, `KanbanStatus` (`kanban-status.ts`); `boardDaLoja`, `colunaManual`, `fluxoDoModelo`, `mensagemDrop`, `normKey`, `reqsDoModelo`, `statusDerivado`, `AcaoDrop`, `Derivacao`, `DestinoDrop`, `KanbanAutoConfig`, `ModeloKanban` (`kanban-auto.ts`).
- Produces:
  - `RPC_KANBAN: { mover|previaRecalculo|definirAutomatico|previaRestauracao|restaurar: { nome: string; assinatura: string; campos: readonly string[] } }`
  - tipos `ResultadoMover`, `PreviaCard`, `PreviaFixado`, `RefRevelada`, `PreviaRecalculo`, `ResultadoDefinir`, `RestauracaoCard`, `PreviaRestauracao`, `ResultadoRestaurar`, `ModoColuna = "entrada"|"automatica"|"manual"|"manual_sempre"`, `EtapaSelo = { fase: "planejamento"|"kanban"|"lancado"; key: string|null; label: string; color: string|null; modo: "off"|"automatica"|"fixado" }`, `ToastKanban = { tipo: "success"|"info"|"error"; texto: string }`
  - `motorKanbanDisponivel(row: unknown): boolean`
  - `modoColuna(col: string, fluxoKeys: string[], reqs: Record<string,string[]>): ModoColuna | null`
  - `rotuloModoColuna(m: ModoColuna): string`, `descricaoModoColuna(m: ModoColuna): string`
  - `labelsCondicoes(keys: string[]): string[]`, `labelDaColuna(key: string|null|undefined, cols: KanbanStatus[]): string`
  - `subtituloColuna(m: ModoColuna|null, reqsProprios: string[]): string`
  - `dropBloqueado(d: DestinoDrop): boolean`, `textoFaixaDrop(d: DestinoDrop, para: string, cols: KanbanStatus[]): string|null`, `notaMoverPara(d: DestinoDrop): { texto: string; bloqueada: boolean }`
  - `toastDoMover(r: Pick<ResultadoMover,"acao"|"status"|"faltando">, para: string, cols: KanbanStatus[], statusAntes: string|null, fixadoAntes: boolean): ToastKanban|null`
  - (R1) em `textoFaixaDrop` e `toastDoMover`, o caso `fora_do_fluxo` usa `labelDaColuna(para, cols)` — `A etapa "<rótulo>" não faz parte do fluxo deste modelo.` — e não a key crua da `mensagemDrop` (F1 travada, não editada).
  - `proximaFalta(d: Derivacao): string|null`
  - `etapaDoModelo(m: ModeloKanban, cfg: KanbanAutoConfig): EtapaSelo`, `tituloSelo(s: EtapaSelo): string`
  - `MOTIVO_REPROVADO_MANUAL: string`

- [ ] **Step 1: Escrever o teste que falha** — criar `tests/unit/kanban-auto-ui.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { entradaParaDerivacao, derivarModelo, destinoDrop, lerKanbanAutoConfig, boardDaLoja, type ModeloKanban } from "@/lib/kanban-auto";
import {
  RPC_KANBAN, descricaoModoColuna, dropBloqueado, etapaDoModelo, labelDaColuna, labelsCondicoes, modoColuna,
  motorKanbanDisponivel, notaMoverPara, proximaFalta, rotuloModoColuna, subtituloColuna, textoFaixaDrop,
  tituloSelo, toastDoMover, MOTIVO_REPROVADO_MANUAL,
} from "@/lib/kanban-auto-ui";

const RAW = {
  kanban_automatico: true,
  status_kanban: ["Em Modelagem", "Em Pilotagem", "Prova de Roupa I", "Stand By", "Reprovado", "Aprovado"],
  kanban_requisitos: {
    em_modelagem: ["modelista_definido"],
    em_pilotagem: ["piloteiro_definido"],
    prova_roupa_1: ["data_piloto1"],
    aprovado: ["data_aprovacao"],
    reprovado: ["grade_preenchida"], // ignorado: Reprovado é sempre manual
  },
  kanban_requisitos_excecoes: {},
  revenda_kanban_colunas: ["em_modelagem", "stand_by", "aprovado"],
  revenda_kanban_requisitos: { aprovado: ["preco_venda_preenchido"] },
};
const CFG = lerKanbanAutoConfig(RAW);
const CFG_OFF = lerKanbanAutoConfig({ ...RAW, kanban_automatico: false });
const BOARD = boardDaLoja(CFG);
const KEYS = BOARD.map((c) => c.key);
const COND = { modelista_definido: true, piloteiro_definido: true };
const INTERNO: ModeloKanban = { origem: null, status_desenvolvimento: "em_pilotagem", ordem_criacao_enviada: true, lancado: false };
const FIXADO: ModeloKanban = { ...INTERNO, status_desenvolvimento: "stand_by" };
const entrada = (m: ModeloKanban) => entradaParaDerivacao(m, CFG, COND);

describe("kanban-auto-ui — contrato das RPCs da F1", () => {
  it("5 RPCs com nome = prefixo da assinatura", () => {
    expect(Object.keys(RPC_KANBAN)).toEqual(["mover", "previaRecalculo", "definirAutomatico", "previaRestauracao", "restaurar"]);
    for (const r of Object.values(RPC_KANBAN)) expect(r.assinatura.startsWith(`${r.nome}(`)).toBe(true);
  });
});

describe("kanban-auto-ui — motorKanbanDisponivel", () => {
  it("true só quando a linha de tenant_config TEM a coluna kanban_automatico (F1 aplicada)", () => {
    expect(motorKanbanDisponivel({ kanban_automatico: false })).toBe(true);
    expect(motorKanbanDisponivel({ status_kanban: [] })).toBe(false);
    expect(motorKanbanDisponivel(null)).toBe(false);
    expect(motorKanbanDisponivel([])).toBe(false);
  });
});

describe("kanban-auto-ui — modo da coluna", () => {
  it("entrada / automática / manual / manual (sempre) / fora do fluxo", () => {
    expect(modoColuna("em_modelagem", KEYS, CFG.kanban_requisitos)).toBe("entrada");
    expect(modoColuna("em_pilotagem", KEYS, CFG.kanban_requisitos)).toBe("automatica");
    expect(modoColuna(" Stand_By ", KEYS, CFG.kanban_requisitos)).toBe("manual");
    expect(modoColuna("reprovado", KEYS, CFG.kanban_requisitos)).toBe("manual_sempre");
    expect(modoColuna("zzz", KEYS, CFG.kanban_requisitos)).toBeNull();
  });
  it("rótulos e descrições", () => {
    expect(["entrada", "automatica", "manual", "manual_sempre"].map((m) => rotuloModoColuna(m as any)))
      .toEqual(["Entrada", "Automática", "Manual", "Manual (sempre)"]);
    expect(descricaoModoColuna("manual_sempre")).toBe("Reprovado é sempre manual: o card entra e sai arrastado.");
    expect(MOTIVO_REPROVADO_MANUAL).toBe("Reprovado é sempre manual: requisitos nesta coluna não valem.");
  });
  it("subtítulo do cabeçalho (labels do catálogo)", () => {
    expect(subtituloColuna("automatica", ["piloteiro_definido"])).toBe("Entra com: Piloteiro definido (≥ 1)");
    expect(subtituloColuna("entrada", ["modelista_definido"])).toBe("Todo card novo cai aqui. Exigido daqui em diante: Modelista definido");
    expect(subtituloColuna("entrada", [])).toBe("Todo card novo cai aqui.");
    expect(subtituloColuna("manual", [])).toBe("Manual — o card entra e sai arrastado");
    expect(subtituloColuna("manual_sempre", ["grade_preenchida"])).toBe("Manual (sempre) — o card entra e sai arrastado");
    expect(subtituloColuna(null, [])).toBe("");
  });
});

describe("kanban-auto-ui — labels", () => {
  it("condições pelo catálogo (key desconhecida volta crua)", () => {
    expect(labelsCondicoes(["data_piloto1", "xyz"])).toEqual(["Data de Piloto I preenchida", "xyz"]);
  });
  it("coluna: board → DEFAULT_STATUSES → a própria key; vazio → —", () => {
    expect(labelDaColuna("prova_roupa_1", BOARD)).toBe("Prova de Roupa I");
    expect(labelDaColuna("corte_piloto_2", BOARD)).toBe("Corte de Piloto II");
    expect(labelDaColuna("zzz", BOARD)).toBe("zzz");
    expect(labelDaColuna(null, BOARD)).toBe("—");
  });
});

describe("kanban-auto-ui — dica do arraste, 'Mover para…' e toast", () => {
  const bloq = destinoDrop(entrada(INTERNO), "prova_roupa_1");
  const bloq2 = destinoDrop(entrada(INTERNO), "aprovado");
  const ja = destinoDrop(entrada(INTERNO), "em_modelagem");
  const fixa = destinoDrop(entrada(INTERNO), "stand_by");
  const solta = destinoDrop(entrada(FIXADO), "em_pilotagem");
  const fora = destinoDrop(entrada(INTERNO), "zzz");
  // R1: revenda (fluxo em_modelagem · stand_by · aprovado) arrastada p/ uma coluna REAL do board fora do fluxo dela.
  const REVENDA_FIX: ModeloKanban = { ...FIXADO, origem: "revenda" };
  const foraRev = destinoDrop(entradaParaDerivacao(REVENDA_FIX, CFG, COND), "prova_roupa_1");
  const nada = destinoDrop(entrada(INTERNO), "em_pilotagem");

  it("pré-condição: a tabela única da F1 decide cada caso", () => {
    expect([bloq.acao, bloq.faltando]).toEqual(["bloquear_faltando", ["data_piloto1"]]);
    expect([bloq2.acao, bloq2.faltando]).toEqual(["bloquear_faltando", ["data_piloto1", "data_aprovacao"]]);
    expect([ja.acao, fixa.acao, solta.acao, solta.status, fora.acao, foraRev.acao, nada.acao])
      .toEqual(["bloquear_ja_cumprida", "fixar", "soltar", "em_pilotagem", "fora_do_fluxo", "fora_do_fluxo", "nada"]);
  });
  it("dropBloqueado", () => {
    expect([bloq, ja, fora, foraRev].every(dropBloqueado)).toBe(true);
    expect([fixa, solta, nada].some(dropBloqueado)).toBe(false);
  });
  it("faixa da coluna durante o arraste", () => {
    expect(textoFaixaDrop(bloq, "prova_roupa_1", BOARD)).toBe("Não pode entrar aqui. Falta 1 dado para completar: Data de Piloto I preenchida");
    expect(textoFaixaDrop(ja, "em_modelagem", BOARD)).toBe('O card já cumpre "Em Modelagem". Para segurá-lo numa etapa, use uma coluna manual.');
    expect(textoFaixaDrop(fixa, "stand_by", BOARD)).toBe("Solte aqui para fixar o card nesta coluna");
    expect(textoFaixaDrop(solta, "em_pilotagem", BOARD)).toBe('Solte aqui para soltar o card — ele vai para "Em Pilotagem"');
    expect(textoFaixaDrop(fora, "zzz", BOARD)).toBe('A etapa "zzz" não faz parte do fluxo deste modelo.');
    // R1: coluna do board → o RÓTULO, nunca a key técnica ("prova_roupa_1").
    expect(textoFaixaDrop(foraRev, "prova_roupa_1", BOARD)).toBe('A etapa "Prova de Roupa I" não faz parte do fluxo deste modelo.');
    expect(textoFaixaDrop(nada, "em_pilotagem", BOARD)).toBeNull();
  });
  it("nota do 'Mover para…' (mobile)", () => {
    expect(notaMoverPara(bloq)).toEqual({ texto: "falta 1 dado", bloqueada: true });
    expect(notaMoverPara(bloq2)).toEqual({ texto: "faltam 2 dados", bloqueada: true });
    expect(notaMoverPara(ja)).toEqual({ texto: "já cumpre", bloqueada: true });
    expect(notaMoverPara(fixa)).toEqual({ texto: "fixa aqui", bloqueada: false });
    expect(notaMoverPara(solta)).toEqual({ texto: "solta o card", bloqueada: false });
    expect(notaMoverPara(fora)).toEqual({ texto: "fora do fluxo", bloqueada: true });
    expect(notaMoverPara(foraRev)).toEqual({ texto: "fora do fluxo", bloqueada: true });
    expect(notaMoverPara(nada)).toEqual({ texto: "", bloqueada: false });
  });
  it("toast pela RESPOSTA do servidor", () => {
    expect(toastDoMover({ acao: "fixar", status: "stand_by", faltando: [] }, "stand_by", BOARD, "em_pilotagem", false))
      .toEqual({ tipo: "info", texto: 'Fixado em "Stand By". O card não anda sozinho até alguém tirá-lo daqui.' });
    expect(toastDoMover({ acao: "soltar", status: "em_pilotagem", faltando: [] }, "em_modelagem", BOARD, "stand_by", true))
      .toEqual({ tipo: "success", texto: 'Card solto. Voltou para "Em Pilotagem" — a etapa que os campos preenchidos indicam.' });
    expect(toastDoMover({ acao: "bloquear_faltando", status: "stand_by", faltando: ["data_piloto1"] }, "prova_roupa_1", BOARD, "stand_by", true))
      .toEqual({ tipo: "error", texto: 'Não pode entrar aqui. Falta 1 dado para completar: Data de Piloto I preenchida. O card continua fixado em "Stand By".' });
    expect(toastDoMover({ acao: "bloquear_faltando", status: "em_pilotagem", faltando: ["data_piloto1"] }, "prova_roupa_1", BOARD, "em_pilotagem", false))
      .toEqual({ tipo: "error", texto: "Não pode entrar aqui. Falta 1 dado para completar: Data de Piloto I preenchida" });
    expect(toastDoMover({ acao: "bloquear_ja_cumprida", status: "em_pilotagem", faltando: [] }, "em_modelagem", BOARD, "em_pilotagem", false))
      .toEqual({ tipo: "info", texto: 'O card já cumpre "Em Modelagem". Para segurá-lo numa etapa, use uma coluna manual.' });
    expect(toastDoMover({ acao: "fora_do_fluxo", status: "em_pilotagem", faltando: [] }, "zzz", BOARD, "em_pilotagem", false))
      .toEqual({ tipo: "error", texto: 'A etapa "zzz" não faz parte do fluxo deste modelo.' });
    expect(toastDoMover({ acao: "fora_do_fluxo", status: "stand_by", faltando: [] }, "prova_roupa_1", BOARD, "stand_by", true))
      .toEqual({ tipo: "error", texto: 'A etapa "Prova de Roupa I" não faz parte do fluxo deste modelo.' });
    expect(toastDoMover({ acao: "nada", status: "em_pilotagem", faltando: [] }, "em_pilotagem", BOARD, "em_pilotagem", false)).toBeNull();
  });
});

describe("kanban-auto-ui — próxima falta do card automático", () => {
  it("1ª condição que falta (+N quando há mais); null se fixado, não derivável ou tudo cumprido", () => {
    expect(proximaFalta(derivarModelo(INTERNO, CFG, COND))).toBe("falta Data de Piloto I preenchida");
    expect(proximaFalta(derivarModelo(INTERNO, CFG, { modelista_definido: true }))).toBe("falta Piloteiro definido (≥ 1)");
    expect(proximaFalta(derivarModelo({ ...INTERNO, status_desenvolvimento: "em_modelagem" }, CFG, {}))).toBe("falta Modelista definido");
    expect(proximaFalta(derivarModelo(FIXADO, CFG, COND))).toBeNull();
    expect(proximaFalta(derivarModelo({ ...INTERNO, ordem_criacao_enviada: false }, CFG, COND))).toBeNull();
    const tudo = { modelista_definido: true, piloteiro_definido: true, data_piloto1: true, data_aprovacao: true };
    expect(proximaFalta(derivarModelo(INTERNO, CFG, tudo))).toBeNull();
  });
  it("mais de uma condição faltando na 1ª coluna que falha → '+N'", () => {
    const cfg2 = lerKanbanAutoConfig({ ...RAW, kanban_requisitos: { ...RAW.kanban_requisitos, prova_roupa_1: ["data_piloto1", "grade_preenchida"] } });
    expect(proximaFalta(derivarModelo(INTERNO, cfg2, COND))).toBe("falta Data de Piloto I preenchida +1");
  });
});

describe("kanban-auto-ui — selo da etapa", () => {
  it("lançado e antes da Ordem de Criação", () => {
    expect(etapaDoModelo({ ...INTERNO, lancado: true }, CFG)).toEqual({ fase: "lancado", key: null, label: "Lançado", color: null, modo: "off" });
    expect(etapaDoModelo({ ...INTERNO, ordem_criacao_enviada: false }, CFG)).toEqual({ fase: "planejamento", key: null, label: "Planejamento", color: null, modo: "off" });
  });
  it("chave desligada: só a etapa", () => {
    expect(etapaDoModelo(INTERNO, CFG_OFF)).toEqual({ fase: "kanban", key: "em_pilotagem", label: "Em Pilotagem", color: "var(--kanban-violet)", modo: "off" });
  });
  it("chave ligada: automática × fixado (sem depender das condições)", () => {
    expect(etapaDoModelo(INTERNO, CFG).modo).toBe("automatica");
    expect(etapaDoModelo(FIXADO, CFG)).toEqual({ fase: "kanban", key: "stand_by", label: "Stand By", color: "var(--muted-foreground)", modo: "fixado" });
    expect(etapaDoModelo({ ...INTERNO, status_desenvolvimento: "em_modelagem" }, CFG).modo).toBe("automatica"); // entrada nunca é fixado
    expect(etapaDoModelo({ ...INTERNO, status_desenvolvimento: null }, CFG)).toMatchObject({ key: "em_modelagem", label: "Em Modelagem", modo: "automatica" });
  });
  it("revenda usa o fluxo dela: Stand By (manual, não-entrada) = fixado", () => {
    expect(etapaDoModelo({ ...FIXADO, origem: "revenda" }, CFG).modo).toBe("fixado");
    expect(etapaDoModelo({ ...INTERNO, origem: "revenda", status_desenvolvimento: "em_modelagem" }, CFG).modo).toBe("automatica");
  });
  it("título (tooltip) de cada estado", () => {
    expect(tituloSelo(etapaDoModelo({ ...INTERNO, ordem_criacao_enviada: false }, CFG))).toBe("Antes da Ordem de Criação — o modelo ainda não está no Desenvolvimento.");
    expect(tituloSelo(etapaDoModelo({ ...INTERNO, lancado: true }, CFG))).toBe("Modelo lançado.");
    expect(tituloSelo(etapaDoModelo(INTERNO, CFG_OFF))).toBe("Etapa do Desenvolvimento: Em Pilotagem");
    expect(tituloSelo(etapaDoModelo(INTERNO, CFG))).toBe("Etapa do Desenvolvimento: Em Pilotagem — anda sozinho conforme os campos salvos.");
    expect(tituloSelo(etapaDoModelo(FIXADO, CFG))).toBe("Etapa do Desenvolvimento: Stand By — fixado numa coluna manual: não anda sozinho.");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd "/Users/sunglee/PLM + Criação/plm-pcp" && npx vitest run --no-file-parallelism tests/unit/kanban-auto-ui.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/kanban-auto-ui"`.

- [ ] **Step 3: Criar `src/lib/kanban-auto-ui.ts`**

```ts
/**
 * KANBAN AUTOMÁTICO — F2 (telas). Helpers PUROS de apresentação (zero React, zero Supabase).
 *
 * A REGRA mora em `kanban-auto.ts` (espelho exato do SQL, F1 — não editar) e, no fim, no servidor
 * (RPC `kanban_mover`). Aqui ficam só: modo da coluna, textos PT-BR (faixa do arraste, "Mover para…",
 * toast), a próxima falta do card, o selo da etapa e os TIPOS/contrato das RPCs públicas da F1.
 * Plano: docs/superpowers/plans/2026-09-23-kanban-automatico-f2-telas.md (§3).
 */
import { CONDICAO_BY_KEY } from "./kanban-condicoes";
import { DEFAULT_STATUSES, labelColunaKanban, type KanbanStatus } from "./kanban-status";
import {
  boardDaLoja, colunaManual, fluxoDoModelo, mensagemDrop, normKey, reqsDoModelo, statusDerivado,
  type AcaoDrop, type Derivacao, type DestinoDrop, type KanbanAutoConfig, type ModeloKanban,
} from "./kanban-auto";

// ── Contrato das RPCs públicas da F1 (supabase/migrations/20260930150000_kanban_auto_4_rpcs.sql) ──
// `tests/unit/kanban-auto-rpc-contrato.test.ts` confere assinatura, GRANT e campos contra o arquivo.
export const RPC_KANBAN = {
  mover: {
    nome: "kanban_mover",
    assinatura: "kanban_mover(_modelo_id uuid, _para text)",
    campos: ["acao", "status", "faltando", "rev"],
  },
  previaRecalculo: {
    nome: "kanban_previa_recalculo",
    assinatura: "kanban_previa_recalculo(_cfg jsonb)",
    campos: ["chave_proposta", "mudam", "fixados", "cards", "cards_fixados", "recua", "primeira_falha", "posicao_derivada", "revelam_ref", "refs_reveladas", "avisos"],
  },
  definirAutomatico: {
    nome: "kanban_definir_automatico",
    assinatura: "kanban_definir_automatico(_ligar boolean)",
    campos: ["ligado", "mudou", "lote_id", "snapshot", "cards_movidos"],
  },
  previaRestauracao: {
    nome: "kanban_previa_restauracao",
    assinatura: "kanban_previa_restauracao(_lote_id uuid DEFAULT NULL::uuid)",
    campos: ["lote_id", "criado_at", "chave_ligada", "voltam", "movidos_depois", "movido_manual_depois", "avisos"],
  },
  restaurar: {
    nome: "kanban_restaurar",
    assinatura: "kanban_restaurar(_lote_id uuid)",
    campos: ["restaurados", "historico_apagado"],
  },
} as const;

export type ResultadoMover = { acao: AcaoDrop; status: string | null; faltando: string[]; rev: number };
export type PreviaCard = {
  modelo_id: string; nome: string | null; ref: string | null; origem: string | null;
  de: string | null; para: string | null; fixado: boolean; recua: boolean;
  primeira_falha: string | null; faltando: string[];
};
export type PreviaFixado = {
  modelo_id: string; nome: string | null; ref: string | null; origem: string | null;
  coluna: string | null; posicao_derivada: string | null;
};
export type RefRevelada = { modelo_id: string; nome: string | null; ref_auto: string; posicao_derivada: string | null };
export type PreviaRecalculo = {
  chave_proposta: boolean; total: number; mudam: number; fixados: number;
  cards: PreviaCard[]; cards_fixados: PreviaFixado[];
  revelam_ref: number; refs_reveladas: RefRevelada[]; avisos: string[];
};
export type ResultadoDefinir = { ligado: boolean; mudou: boolean; lote_id: string | null; snapshot: number; cards_movidos: number };
export type RestauracaoCard = {
  modelo_id: string; nome: string | null; ref: string | null;
  de: string | null; para: string | null; movido_manual_depois: boolean;
};
export type PreviaRestauracao = {
  lote_id: string | null; motivo?: string | null; criado_at?: string | null; restaurado_at?: string | null;
  chave_ligada: boolean; total: number; voltam: number; movidos_depois: number;
  cards: RestauracaoCard[]; avisos: string[];
};
export type ResultadoRestaurar = { lote_id: string; restaurados: number; historico_apagado: number };

export type ModoColuna = "entrada" | "automatica" | "manual" | "manual_sempre";
export type EtapaSelo = {
  fase: "planejamento" | "kanban" | "lancado";
  key: string | null;
  label: string;
  color: string | null;
  modo: "off" | "automatica" | "fixado";
};
export type ToastKanban = { tipo: "success" | "info" | "error"; texto: string };

export const MOTIVO_REPROVADO_MANUAL = "Reprovado é sempre manual: requisitos nesta coluna não valem.";

/** A linha de `tenant_config` já tem a coluna da chave? (F1 aplicada). Sem ela o front age como chave desligada. */
export function motorKanbanDisponivel(row: unknown): boolean {
  return !!row && typeof row === "object" && !Array.isArray(row)
    && Object.prototype.hasOwnProperty.call(row, "kanban_automatico");
}

/** Modo da coluna no fluxo: 1ª = entrada; Reprovado = manual (sempre); sem requisito PRÓPRIO = manual; senão automática. */
export function modoColuna(col: string, fluxoKeys: string[], reqs: Record<string, string[]>): ModoColuna | null {
  const k = normKey(col);
  const i = fluxoKeys.indexOf(k);
  if (i < 0) return null;
  if (i === 0) return "entrada";
  if (k === "reprovado") return "manual_sempre";
  return colunaManual(k, reqs) ? "manual" : "automatica";
}

const ROTULO_MODO: Record<ModoColuna, string> = {
  entrada: "Entrada",
  automatica: "Automática",
  manual: "Manual",
  manual_sempre: "Manual (sempre)",
};
const DESCRICAO_MODO: Record<ModoColuna, string> = {
  entrada: "1ª coluna: todo card novo cai aqui.",
  automatica: "Com requisito: o card entra sozinho quando cumpre esta coluna e todas as anteriores.",
  manual: "Sem requisito: o card entra e sai arrastado.",
  manual_sempre: "Reprovado é sempre manual: o card entra e sai arrastado.",
};
export function rotuloModoColuna(m: ModoColuna): string { return ROTULO_MODO[m]; }
export function descricaoModoColuna(m: ModoColuna): string { return DESCRICAO_MODO[m]; }

/** Labels do catálogo (`CONDICAO_BY_KEY`); key desconhecida volta crua. */
export function labelsCondicoes(keys: string[]): string[] {
  return keys.map((k) => CONDICAO_BY_KEY.get(k)?.label ?? k);
}

/** Label de uma coluna: board da loja → DEFAULT_STATUSES → a própria key; vazio → "—". */
export function labelDaColuna(key: string | null | undefined, cols: KanbanStatus[]): string {
  const k = normKey(key);
  if (!k) return "—";
  return cols.find((c) => c.key === k)?.label ?? DEFAULT_STATUSES.find((c) => c.key === k)?.label ?? String(key);
}

/** Linha sob o cabeçalho da coluna (chave ligada) — textos do mockup aprovado. */
export function subtituloColuna(m: ModoColuna | null, reqsProprios: string[]): string {
  if (!m) return "";
  if (m === "manual") return "Manual — o card entra e sai arrastado";
  if (m === "manual_sempre") return "Manual (sempre) — o card entra e sai arrastado";
  const labels = labelsCondicoes(reqsProprios).join(", ");
  if (m === "entrada") return labels ? `Todo card novo cai aqui. Exigido daqui em diante: ${labels}` : "Todo card novo cai aqui.";
  return `Entra com: ${labels}`;
}

/** "Fora do fluxo" com o RÓTULO da coluna (R1 do G-plano). A `mensagemDrop` da F1 (travada) põe a key crua
 *  (`A etapa "em_ajuste" …`); a frase é a mesma, só troca a key pelo rótulo. Key desconhecida volta crua. */
function textoForaDoFluxo(para: string, cols: KanbanStatus[]): string {
  return `A etapa "${labelDaColuna(para, cols)}" não faz parte do fluxo deste modelo.`;
}

export function dropBloqueado(d: DestinoDrop): boolean {
  return d.acao === "bloquear_faltando" || d.acao === "bloquear_ja_cumprida" || d.acao === "fora_do_fluxo";
}

/** Faixa da coluna enquanto o card é arrastado (null = sem faixa). */
export function textoFaixaDrop(d: DestinoDrop, para: string, cols: KanbanStatus[]): string | null {
  switch (d.acao) {
    case "bloquear_faltando": return `Não pode entrar aqui. ${mensagemDrop(d, para, cols)}`;
    case "bloquear_ja_cumprida": return mensagemDrop(d, para, cols);
    case "fora_do_fluxo": return textoForaDoFluxo(para, cols);
    case "fixar": return "Solte aqui para fixar o card nesta coluna";
    case "soltar": return `Solte aqui para soltar o card — ele vai para "${labelDaColuna(d.status, cols)}"`;
    default: return null;
  }
}

/** Anotação de cada destino no "Mover para…" (mobile). */
export function notaMoverPara(d: DestinoDrop): { texto: string; bloqueada: boolean } {
  switch (d.acao) {
    case "fixar": return { texto: "fixa aqui", bloqueada: false };
    case "soltar": return { texto: "solta o card", bloqueada: false };
    case "bloquear_faltando": {
      const n = d.faltando.length;
      return { texto: n === 1 ? "falta 1 dado" : n > 1 ? `faltam ${n} dados` : "faltam dados", bloqueada: true };
    }
    case "bloquear_ja_cumprida": return { texto: "já cumpre", bloqueada: true };
    case "fora_do_fluxo": return { texto: "fora do fluxo", bloqueada: true };
    default: return { texto: "", bloqueada: false };
  }
}

/** Toast depois do `kanban_mover` — pela RESPOSTA do servidor (a autoridade), não pela previsão local. */
export function toastDoMover(
  r: Pick<ResultadoMover, "acao" | "status" | "faltando">,
  para: string,
  cols: KanbanStatus[],
  statusAntes: string | null,
  fixadoAntes: boolean,
): ToastKanban | null {
  const d: DestinoDrop = { acao: r.acao, status: r.status, faltando: r.faltando ?? [] };
  switch (r.acao) {
    case "fixar":
      return { tipo: "info", texto: `Fixado em "${labelDaColuna(r.status, cols)}". O card não anda sozinho até alguém tirá-lo daqui.` };
    case "soltar":
      return { tipo: "success", texto: `Card solto. Voltou para "${labelDaColuna(r.status, cols)}" — a etapa que os campos preenchidos indicam.` };
    case "bloquear_faltando": {
      const base = `Não pode entrar aqui. ${mensagemDrop(d, para, cols)}`;
      return { tipo: "error", texto: fixadoAntes ? `${base}. O card continua fixado em "${labelDaColuna(statusAntes, cols)}".` : base };
    }
    case "bloquear_ja_cumprida": return { tipo: "info", texto: mensagemDrop(d, para, cols) ?? "" };
    case "fora_do_fluxo": return { tipo: "error", texto: textoForaDoFluxo(para, cols) };
    default: return null;
  }
}

/** "falta X" (+N) da 1ª coluna automática que o card ainda não cumpre; null se fixado/não derivável/tudo cumprido. */
export function proximaFalta(d: Derivacao): string | null {
  if (!d.derivavel || d.fixado || !d.primeiraFalha || d.faltando.length === 0) return null;
  const labels = labelsCondicoes(d.faltando);
  return labels.length === 1 ? `falta ${labels[0]}` : `falta ${labels[0]} +${labels.length - 1}`;
}

/** Selo da etapa (card do Planejamento; header do Sheet na F3). "fixado" ≡ `statusDerivado(...).fixado`
 *  — que NÃO depende das condições (só da coluna em que o card está), então não precisa do core. */
export function etapaDoModelo(m: ModeloKanban, cfg: KanbanAutoConfig): EtapaSelo {
  if (m.lancado === true) return { fase: "lancado", key: null, label: "Lançado", color: null, modo: "off" };
  if (m.ordem_criacao_enviada !== true) return { fase: "planejamento", key: null, label: "Planejamento", color: null, modo: "off" };
  const board = boardDaLoja(cfg);
  const bruto = String(m.status_desenvolvimento ?? "").trim();
  const col = (bruto ? board.find((c) => c.key === bruto) : undefined) ?? board[0] ?? null;
  const base = { fase: "kanban" as const, key: col?.key ?? null, label: labelColunaKanban(m.status_desenvolvimento, board), color: col?.color ?? null };
  if (!cfg.kanban_automatico) return { ...base, modo: "off" };
  const { reqs, exc } = reqsDoModelo(m.origem, cfg);
  const fluxo = fluxoDoModelo(m.origem, cfg).map((c) => c.key);
  const d = statusDerivado({ fluxo, reqs, exc, cond: {}, status: m.status_desenvolvimento ?? null, derivavel: true });
  return { ...base, modo: d.fixado ? "fixado" : "automatica" };
}

export function tituloSelo(s: EtapaSelo): string {
  if (s.fase === "planejamento") return "Antes da Ordem de Criação — o modelo ainda não está no Desenvolvimento.";
  if (s.fase === "lancado") return "Modelo lançado.";
  const base = `Etapa do Desenvolvimento: ${s.label}`;
  if (s.modo === "automatica") return `${base} — anda sozinho conforme os campos salvos.`;
  if (s.modo === "fixado") return `${base} — fixado numa coluna manual: não anda sozinho.`;
  return base;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd "/Users/sunglee/PLM + Criação/plm-pcp" && npx vitest run --no-file-parallelism tests/unit/kanban-auto-ui.test.ts tests/unit/kanban-auto.test.ts`
Expected: PASS (todos). Se algum `expect` da "pré-condição" falhar, o erro é do TESTE (a tabela da F1 é a verdade) — conferir contra `destinoDrop`, nunca editar `kanban-auto.ts`.

- [ ] **Step 5: Gates + commit**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp"
npm run build 2>&1 | tail -3
npx tsc --noEmit 2>&1 | grep -c "error TS"
npx vitest run --no-file-parallelism tests/unit 2>&1 | tail -4
git diff --name-only savepoint-pre-unificacao-2026-09-22 -- src/components/desenvolvimento/ src/components/producao/cad/CadTecidosSection.tsx
git add -- src/lib/kanban-auto-ui.ts tests/unit/kanban-auto-ui.test.ts
git commit --only -m "feat(kanban-auto): F2 — helpers puros de tela (modo da coluna, textos do arraste, selo da etapa, tipos das RPCs)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- src/lib/kanban-auto-ui.ts tests/unit/kanban-auto-ui.test.ts
git show --stat HEAD | tail -n +7
```
Expected: build ok; `0`; `2 failed` (só ui-padroes-antidrift, pré-existentes); diff do Dev vazio; commit com SÓ os 2 paths.

---

### Task 2: `src/lib/kanban-auto-config.ts` — colunas de kanban fora do upsert (RP3) + agrupamento das prévias

**Files:**
- Create: `src/lib/kanban-auto-config.ts`
- Test: `tests/unit/kanban-auto-config.test.ts`

**Interfaces:**
- Consumes: tipos `PreviaCard`, `PreviaFixado` (Task 1).
- Produces:
  - `KANBAN_COLS: readonly ["status_kanban","kanban_requisitos","kanban_requisitos_excecoes","revenda_kanban_colunas","revenda_kanban_requisitos"]`, `KanbanCol`, `KanbanColsValor = Partial<Record<KanbanCol, unknown>>`
  - `pickKanban(src: unknown): Record<KanbanCol, unknown>`; `jsonCanonico(v: unknown): string`
  - `diffKanban(base: KanbanColsValor, atual: KanbanColsValor): KanbanColsValor`
  - `conflitoKanban(baseServidor: KanbanColsValor, servidorAgora: unknown): KanbanCol[]`
  - `separarPayloadKanban(payload: Record<string, unknown>): { geral: Record<string, unknown>; kanban: KanbanColsValor }`
  - `juntarLista(itens: string[]): string`, `descreverMudancasKanban(cols: readonly KanbanCol[]): string`, `mensagemConflitoKanban(cols: readonly KanbanCol[]): string`
  - `GrupoMovimento = { de: string|null; para: string|null; recua: boolean; cards: PreviaCard[] }`, `agruparMovimentos(cards: PreviaCard[], ordem: string[]): GrupoMovimento[]`
  - `resumirFixados(fixados: PreviaFixado[], ordem: string[]): { coluna: string|null; n: number }[]`
  - `avisosRestauracaoVisiveis(avisos: string[]): string[]`, `formatarDataHora(iso: string|null|undefined, tz: string): string`, `nCards(n: number): string`

- [ ] **Step 1: Escrever o teste que falha** — criar `tests/unit/kanban-auto-config.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  KANBAN_COLS, agruparMovimentos, avisosRestauracaoVisiveis, conflitoKanban, descreverMudancasKanban, diffKanban,
  formatarDataHora, jsonCanonico, juntarLista, mensagemConflitoKanban, nCards, pickKanban, resumirFixados,
  separarPayloadKanban,
} from "@/lib/kanban-auto-config";
import type { PreviaCard, PreviaFixado } from "@/lib/kanban-auto-ui";

const KEYS = ["em_modelagem", "em_pilotagem", "prova_roupa_1", "stand_by", "reprovado", "aprovado"];
const card = (id: string, de: string | null, para: string | null, recua = false): PreviaCard => ({
  modelo_id: id, nome: `M${id}`, ref: null, origem: "interno", de, para, fixado: false, recua, primeira_falha: null, faltando: [],
});
const fix = (id: string, coluna: string): PreviaFixado => ({ modelo_id: id, nome: null, ref: null, origem: null, coluna, posicao_derivada: "em_modelagem" });

describe("kanban-auto-config — JSON canônico e diff (RP3)", () => {
  it("ordem das chaves de objeto não importa; ordem de array importa; undefined ≡ null", () => {
    expect(jsonCanonico({ b: 1, a: [{ d: 1, c: 2 }] })).toBe(jsonCanonico({ a: [{ c: 2, d: 1 }], b: 1 }));
    expect(jsonCanonico([1, 2])).not.toBe(jsonCanonico([2, 1]));
    expect(jsonCanonico(undefined)).toBe(jsonCanonico(null));
  });
  it("pickKanban pega SÓ as 5 colunas (null quando faltam)", () => {
    expect(KANBAN_COLS).toEqual(["status_kanban", "kanban_requisitos", "kanban_requisitos_excecoes", "revenda_kanban_colunas", "revenda_kanban_requisitos"]);
    expect(pickKanban({ status_kanban: ["A"], timezone: "x" })).toEqual({
      status_kanban: ["A"], kanban_requisitos: null, kanban_requisitos_excecoes: null, revenda_kanban_colunas: null, revenda_kanban_requisitos: null,
    });
    expect(pickKanban(null).status_kanban).toBeNull();
  });
  it("diffKanban devolve só as colunas que mudaram (valor ATUAL)", () => {
    const base = pickKanban({ status_kanban: ["A", "B"], kanban_requisitos: { a: ["x"], b: ["y"] }, revenda_kanban_colunas: [] });
    const mesmo = pickKanban({ status_kanban: ["A", "B"], kanban_requisitos: { b: ["y"], a: ["x"] }, revenda_kanban_colunas: [] });
    expect(diffKanban(base, mesmo)).toEqual({});
    const mudou = pickKanban({ status_kanban: ["B", "A"], kanban_requisitos: { a: ["x"], b: ["y"] }, revenda_kanban_colunas: ["a"] });
    expect(diffKanban(base, mudou)).toEqual({ status_kanban: ["B", "A"], revenda_kanban_colunas: ["a"] });
  });
  it("conflitoKanban compara o CRU lido na abertura com o banco AGORA", () => {
    const aberto = pickKanban({ kanban_requisitos: { a: ["x"] }, status_kanban: ["A"] });
    expect(conflitoKanban(aberto, { kanban_requisitos: { a: ["x"] }, status_kanban: ["A"], timezone: "outro" })).toEqual([]);
    expect(conflitoKanban(aberto, { kanban_requisitos: { a: ["x", "y"] }, status_kanban: ["A"] })).toEqual(["kanban_requisitos"]);
  });
  it("separarPayloadKanban tira as 5 colunas do upsert genérico", () => {
    const { geral, kanban } = separarPayloadKanban({
      tenant_id: "t", timezone: "America/Sao_Paulo", status_kanban: ["A"], kanban_requisitos: {}, revenda_kanban_colunas: [],
    });
    expect(geral).toEqual({ tenant_id: "t", timezone: "America/Sao_Paulo" });
    expect(kanban).toEqual({ status_kanban: ["A"], kanban_requisitos: {}, revenda_kanban_colunas: [] });
  });
});

describe("kanban-auto-config — textos", () => {
  it("juntarLista e descrição das mudanças", () => {
    expect(juntarLista([])).toBe("");
    expect(juntarLista(["a"])).toBe("a");
    expect(juntarLista(["a", "b", "c"])).toBe("a, b e c");
    expect(descreverMudancasKanban(["kanban_requisitos"])).toBe("os requisitos");
    expect(descreverMudancasKanban(["status_kanban", "kanban_requisitos"])).toBe("as colunas do kanban (nomes ou ordem) e os requisitos");
    expect(descreverMudancasKanban(["kanban_requisitos_excecoes", "revenda_kanban_colunas", "revenda_kanban_requisitos"]))
      .toBe("as exceções da cascata, as colunas da revenda e os requisitos da revenda");
  });
  it("mensagem de conflito", () => {
    expect(mensagemConflitoKanban(["kanban_requisitos"])).toBe(
      "Outra pessoa mudou os requisitos depois que você abriu esta tela. Recarregue a página e refaça a sua alteração antes de salvar.",
    );
  });
  it("nCards", () => {
    expect([nCards(0), nCards(1), nCards(3)]).toEqual(["0 cards", "1 card", "3 cards"]);
  });
});

describe("kanban-auto-config — prévias", () => {
  it("agruparMovimentos por (de, para) na ordem do board", () => {
    const g = agruparMovimentos(
      [card("1", "em_modelagem", "em_pilotagem"), card("2", "aprovado", "em_pilotagem", true), card("3", "em_modelagem", "em_pilotagem"), card("4", "zzz", "em_modelagem")],
      KEYS,
    );
    expect(g.map((x) => [x.de, x.para, x.recua, x.cards.map((c) => c.modelo_id)])).toEqual([
      ["em_modelagem", "em_pilotagem", false, ["1", "3"]],
      ["aprovado", "em_pilotagem", true, ["2"]],
      ["zzz", "em_modelagem", false, ["4"]],
    ]);
  });
  it("resumirFixados conta por coluna, na ordem do board", () => {
    expect(resumirFixados([fix("1", "stand_by"), fix("2", "reprovado"), fix("3", "stand_by")], KEYS))
      .toEqual([{ coluna: "stand_by", n: 2 }, { coluna: "reprovado", n: 1 }]);
  });
  it("avisos da restauração: some o 'Desligue…' (o diálogo desliga ANTES de restaurar)", () => {
    expect(avisosRestauracaoVisiveis([
      "A REF revelada e o #Erro não voltam.",
      "Desligue o Kanban automático antes de restaurar (senão o próximo salvamento refaz as colunas).",
    ])).toEqual(["A REF revelada e o #Erro não voltam."]);
  });
  it("formatarDataHora no fuso da loja", () => {
    expect(formatarDataHora("2026-09-22T17:30:00Z", "America/Sao_Paulo")).toBe("22/09/2026 14:30");
    expect(formatarDataHora("2026-09-23T03:05:00Z", "America/Sao_Paulo")).toBe("23/09/2026 00:05");
    expect(formatarDataHora(null, "America/Sao_Paulo")).toBe("—");
    expect(formatarDataHora("lixo", "America/Sao_Paulo")).toBe("—");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd "/Users/sunglee/PLM + Criação/plm-pcp" && npx vitest run --no-file-parallelism tests/unit/kanban-auto-config.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/kanban-auto-config"`.

- [ ] **Step 3: Criar `src/lib/kanban-auto-config.ts`**

```ts
/**
 * KANBAN AUTOMÁTICO — F2, Config da Loja. PURO (zero React/Supabase).
 *
 * RP3 (guardião, G-plano F1): a Config fazia `upsert` da linha INTEIRA de `tenant_config`. Com a chave
 * ligada, uma aba aberta antes de outro admin mudar requisitos/ordem regravaria os valores velhos e o
 * gatilho da F1 recalcularia a loja SEM prévia. Por isso as 5 colunas de kanban saem do upsert genérico
 * e vão SÓ as que o usuário mudou (diff canônico), depois de conferir que o banco ainda tem o que a tela
 * carregou (`conflitoKanban`). Aqui também o agrupamento das prévias (ligar / salvar / restaurar).
 */
import type { PreviaCard, PreviaFixado } from "./kanban-auto-ui";

export const KANBAN_COLS = [
  "status_kanban",
  "kanban_requisitos",
  "kanban_requisitos_excecoes",
  "revenda_kanban_colunas",
  "revenda_kanban_requisitos",
] as const;
export type KanbanCol = (typeof KANBAN_COLS)[number];
export type KanbanColsValor = Partial<Record<KanbanCol, unknown>>;

export function pickKanban(src: unknown): Record<KanbanCol, unknown> {
  const o = (src && typeof src === "object" && !Array.isArray(src) ? src : {}) as Record<string, unknown>;
  const out = {} as Record<KanbanCol, unknown>;
  for (const c of KANBAN_COLS) out[c] = o[c] ?? null;
  return out;
}

/** JSON com chaves de objeto ordenadas (o jsonb do Postgres reordena as chaves); arrays mantêm a ordem. */
export function jsonCanonico(v: unknown): string {
  if (v === undefined || v === null) return "null";
  if (typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(jsonCanonico).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${jsonCanonico(o[k])}`)
    .join(",")}}`;
}

export function diffKanban(base: KanbanColsValor, atual: KanbanColsValor): KanbanColsValor {
  const out: KanbanColsValor = {};
  for (const c of KANBAN_COLS) {
    if (jsonCanonico(base[c]) !== jsonCanonico(atual[c])) out[c] = atual[c] ?? null;
  }
  return out;
}

export function conflitoKanban(baseServidor: KanbanColsValor, servidorAgora: unknown): KanbanCol[] {
  const agora = pickKanban(servidorAgora);
  return KANBAN_COLS.filter((c) => jsonCanonico(baseServidor[c]) !== jsonCanonico(agora[c]));
}

export function separarPayloadKanban(payload: Record<string, unknown>): { geral: Record<string, unknown>; kanban: KanbanColsValor } {
  const geral: Record<string, unknown> = {};
  const kanban: KanbanColsValor = {};
  for (const [k, v] of Object.entries(payload)) {
    if ((KANBAN_COLS as readonly string[]).includes(k)) (kanban as Record<string, unknown>)[k] = v;
    else geral[k] = v;
  }
  return { geral, kanban };
}

const DESCRICAO_COL: Record<KanbanCol, string> = {
  status_kanban: "as colunas do kanban (nomes ou ordem)",
  kanban_requisitos: "os requisitos",
  kanban_requisitos_excecoes: "as exceções da cascata",
  revenda_kanban_colunas: "as colunas da revenda",
  revenda_kanban_requisitos: "os requisitos da revenda",
};

export function juntarLista(itens: string[]): string {
  if (itens.length <= 1) return itens[0] ?? "";
  return `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;
}

export function descreverMudancasKanban(cols: readonly KanbanCol[]): string {
  return juntarLista(cols.map((c) => DESCRICAO_COL[c]));
}

export function mensagemConflitoKanban(cols: readonly KanbanCol[]): string {
  return `Outra pessoa mudou ${descreverMudancasKanban(cols)} depois que você abriu esta tela. Recarregue a página e refaça a sua alteração antes de salvar.`;
}

export function nCards(n: number): string {
  return n === 1 ? "1 card" : `${n} cards`;
}

export type GrupoMovimento = { de: string | null; para: string | null; recua: boolean; cards: PreviaCard[] };

const posicao = (ordem: string[], k: string | null) => {
  const i = k ? ordem.indexOf(k) : -1;
  return i < 0 ? Number.MAX_SAFE_INTEGER : i;
};

/** Agrupa a prévia por (de → para), na ordem do board (coluna fora do board vai para o fim). */
export function agruparMovimentos(cards: PreviaCard[], ordem: string[]): GrupoMovimento[] {
  const mapa = new Map<string, GrupoMovimento>();
  for (const c of cards) {
    const k = `${c.de ?? ""}→${c.para ?? ""}`;
    const g = mapa.get(k);
    if (g) g.cards.push(c);
    else mapa.set(k, { de: c.de, para: c.para, recua: c.recua, cards: [c] });
  }
  return [...mapa.values()].sort(
    (a, b) => posicao(ordem, a.de) - posicao(ordem, b.de) || posicao(ordem, a.para) - posicao(ordem, b.para),
  );
}

/** "N cards ficam onde estão, em colunas manuais (Em Ajuste 2 · Stand By 2 · …)". */
export function resumirFixados(fixados: PreviaFixado[], ordem: string[]): { coluna: string | null; n: number }[] {
  const mapa = new Map<string | null, number>();
  for (const f of fixados) mapa.set(f.coluna, (mapa.get(f.coluna) ?? 0) + 1);
  return [...mapa.entries()]
    .map(([coluna, n]) => ({ coluna, n }))
    .sort((a, b) => posicao(ordem, a.coluna) - posicao(ordem, b.coluna));
}

/** O diálogo de desligar DESLIGA antes de restaurar — o aviso "Desligue…" da prévia não se aplica. */
export function avisosRestauracaoVisiveis(avisos: string[]): string[] {
  return avisos.filter((a) => !a.startsWith("Desligue o Kanban automático antes de restaurar"));
}

/** "dd/mm/aaaa hh:mm" no fuso da loja (tenant_config.timezone). */
export function formatarDataHora(iso: string | null | undefined, tz: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const partes = new Intl.DateTimeFormat("pt-BR", {
    timeZone: tz, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(d);
  const v = (t: string) => partes.find((p) => p.type === t)?.value ?? "";
  return `${v("day")}/${v("month")}/${v("year")} ${v("hour")}:${v("minute")}`;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd "/Users/sunglee/PLM + Criação/plm-pcp" && npx vitest run --no-file-parallelism tests/unit/kanban-auto-config.test.ts`
Expected: PASS.

- [ ] **Step 5: Gates + commit**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp"
npm run build 2>&1 | tail -3
npx tsc --noEmit 2>&1 | grep -c "error TS"
npx vitest run --no-file-parallelism tests/unit 2>&1 | tail -4
git add -- src/lib/kanban-auto-config.ts tests/unit/kanban-auto-config.test.ts
git commit --only -m "feat(kanban-auto): F2 — colunas de kanban fora do upsert (RP3: diff + conflito) e agrupamento das prévias

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- src/lib/kanban-auto-config.ts tests/unit/kanban-auto-config.test.ts
git show --stat HEAD | tail -n +7
```

---

### Task 3: RPCs tipadas + `useKanbanConfig` + mensagens PT (42501 próprias) + contrato F1×F2

**Files:**
- Create: `src/lib/kanban-auto-rpc.ts`, `src/hooks/useKanbanConfig.ts`, `tests/unit/kanban-auto-rpc-contrato.test.ts`
- Modify: `src/lib/erro-mensagem.ts` (bloco `mensagemErro`), `tests/unit/erro-mensagem.test.ts`, `tests/unit/realtime-invalidation-map.test.ts` (lista `casa`, ~l. 158)

**Interfaces:**
- Consumes: `RPC_KANBAN`, tipos das respostas, `motorKanbanDisponivel` (Task 1); `lerKanbanAutoConfig`, `KanbanAutoConfig` (F1); `useActiveTenantId` (existente).
- Produces:
  - `kanbanMover(modeloId: string, para: string): Promise<ResultadoMover>`, `kanbanPreviaRecalculo(cfg: Record<string, unknown>): Promise<PreviaRecalculo>`, `kanbanDefinirAutomatico(ligar: boolean): Promise<ResultadoDefinir>`, `kanbanPreviaRestauracao(loteId: string | null): Promise<PreviaRestauracao>`, `kanbanRestaurar(loteId: string): Promise<ResultadoRestaurar>`
  - `useKanbanConfig(): { cfg: KanbanAutoConfig; ligado: boolean; motorDisponivel: boolean; carregando: boolean }` (queryKey `["tenant-kanban-auto", tenantId]`)
  - `mensagemErro` passa direto as mensagens 42501 PRÓPRIAS do kanban.
- **Depende da F1:** o teste de contrato roda só quando `supabase/migrations/20260930150000_kanban_auto_4_rpcs.sql` existe (F1 Tasks 15–16 commitadas); antes disso ele PULA (`skipIf`). O G-commit da F2 exige que ele RODE e PASSE.

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/unit/kanban-auto-rpc-contrato.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RPC_KANBAN } from "@/lib/kanban-auto-ui";

// Contrato F1 × F2 sem banco: as telas chamam EXATAMENTE as RPCs/colunas que as migrations da F1 criam.
// Pula enquanto a migration 4 (F1 Tasks 15–16) não existir; o G-commit da F2 exige que RODE e PASSE.
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MIG1 = path.join(ROOT, "supabase/migrations/20260930120000_kanban_auto_1_schema.sql");
const MIG4 = path.join(ROOT, "supabase/migrations/20260930150000_kanban_auto_4_rpcs.sql");
const TEM4 = fs.existsSync(MIG4);

describe("contrato F1 × F2 — coluna da chave", () => {
  it("migration 1 cria tenant_config.kanban_automatico (default false)", () => {
    expect(fs.readFileSync(MIG1, "utf8")).toContain("ADD COLUMN IF NOT EXISTS kanban_automatico boolean NOT NULL DEFAULT false");
  });
});

describe.skipIf(!TEM4)("contrato F1 × F2 — RPCs públicas que as telas chamam", () => {
  const sql = TEM4 ? fs.readFileSync(MIG4, "utf8") : "";
  for (const [nome, r] of Object.entries(RPC_KANBAN)) {
    it(`${nome}: assinatura, GRANT a authenticated e campos do retorno`, () => {
      expect(sql).toContain(`CREATE OR REPLACE FUNCTION public.${r.assinatura}`);
      expect(sql).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${r.nome}\\([^)]*\\) TO authenticated`));
      for (const campo of r.campos) expect(sql, `${r.nome} devolve '${campo}'`).toContain(`'${campo}'`);
    });
  }
});
```

Acrescentar ao FIM de `tests/unit/erro-mensagem.test.ts` (dentro do arquivo, depois do `describe("mensagemErro"…)` existente):

```ts
describe("mensagemErro — Kanban automático (RPCs da F1)", () => {
  const PROPRIAS_42501 = [
    "Apenas o administrador da loja pode ver a prévia do Kanban automático.",
    "Apenas o administrador da loja pode ligar ou desligar o Kanban automático.",
    "Apenas o administrador da loja pode restaurar as colunas do Kanban.",
    "Sem permissão para mover cards do Desenvolvimento.",
  ];
  it("42501 com mensagem PRÓPRIA do kanban passa direto (não vira a genérica)", () => {
    for (const m of PROPRIAS_42501) expect(mensagemErro({ code: "42501", message: m }, "fb")).toBe(m);
  });
  it("42501 de outra origem continua genérico", () => {
    expect(mensagemErro({ code: "42501", message: "permission denied for table modelos" }, "fb"))
      .toBe("Você não tem permissão para esta ação.");
    expect(mensagemErro({ code: "42501", message: "Loja inativa ou sem tenant — operação não permitida." }, "fb"))
      .toBe("Você não tem permissão para esta ação.");
  });
  it("P0001 e P0002 do kanban passam direto", () => {
    for (const m of [
      "O Kanban automático está desligado nesta loja.",
      "Desligue o Kanban automático antes de restaurar as colunas.",
      "Este lote já foi restaurado.",
      'A etapa "zzz" não faz parte do fluxo deste modelo.',
    ]) expect(mensagemErro({ code: "P0001", message: m }, "fb")).toBe(m);
    for (const m of ["Modelo não encontrado.", "Lote de colunas não encontrado.", "Configuração da loja não encontrada."])
      expect(mensagemErro({ code: "P0002", message: m }, "fb")).toBe(m);
  });
});
```

Em `tests/unit/realtime-invalidation-map.test.ts`, no array `casa` do teste `"tenant_config casa as queryKeys reais de config"`, logo depois da linha `["tenant-kanban-requisitos", "t1"],`, inserir:

```ts
      ["tenant-kanban-auto", "t1"],
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd "/Users/sunglee/PLM + Criação/plm-pcp" && npx vitest run --no-file-parallelism tests/unit/erro-mensagem.test.ts tests/unit/kanban-auto-rpc-contrato.test.ts tests/unit/realtime-invalidation-map.test.ts`
Expected: FAIL em "42501 com mensagem PRÓPRIA…" (volta a genérica). O contrato passa na migration 1 e PULA a 4 (se ainda não existir). O realtime já passa (a key contém "tenant") — ele trava a key para o futuro.

- [ ] **Step 3: Implementar**

Em `src/lib/erro-mensagem.ts`, logo ACIMA de `function getCode(e: any): string {`, inserir:

```ts
// 42501 com mensagem PRÓPRIA em PT (RAISE das RPCs do Kanban automático — F1): a genérica "Você não
// tem permissão" esconderia o motivo real (ex.: só o ADMIN da loja liga a chave). Lista FECHADA — não
// abrir para todo 42501 (policies/RLS mandam texto técnico em inglês).
const MENSAGENS_42501_PROPRIAS = new Set([
  "Apenas o administrador da loja pode ver a prévia do Kanban automático.",
  "Apenas o administrador da loja pode ligar ou desligar o Kanban automático.",
  "Apenas o administrador da loja pode restaurar as colunas do Kanban.",
  "Sem permissão para mover cards do Desenvolvimento.",
]);
```

e, dentro de `mensagemErro`, logo DEPOIS da linha `if (code === "P0001" && msg) return msg;`, inserir:

```ts
  // 42501 do Kanban automático com texto próprio → mostra o motivo real.
  if (code === "42501" && MENSAGENS_42501_PROPRIAS.has(msg)) return msg;
```

Criar `src/lib/kanban-auto-rpc.ts`:

```ts
/**
 * KANBAN AUTOMÁTICO — F2: chamadas às RPCs públicas da F1 (migration 20260930150000_kanban_auto_4_rpcs.sql).
 * Nomes/parâmetros = `RPC_KANBAN` (contrato travado por tests/unit/kanban-auto-rpc-contrato.test.ts).
 * `as any`: types.ts do Supabase ainda não conhece as RPCs novas (regen pendente — padrão do repo).
 * Erros sobem crus: a tela traduz com `mensagemErro` (PT-BR).
 */
import { supabase } from "@/integrations/supabase/client";
import {
  RPC_KANBAN,
  type PreviaRecalculo, type PreviaRestauracao, type ResultadoDefinir, type ResultadoMover, type ResultadoRestaurar,
} from "./kanban-auto-ui";

async function rpc<T>(nome: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(nome as any, args as any);
  if (error) throw error;
  return data as T;
}

export function kanbanMover(modeloId: string, para: string): Promise<ResultadoMover> {
  return rpc<ResultadoMover>(RPC_KANBAN.mover.nome, { _modelo_id: modeloId, _para: para });
}
export function kanbanPreviaRecalculo(cfg: Record<string, unknown>): Promise<PreviaRecalculo> {
  return rpc<PreviaRecalculo>(RPC_KANBAN.previaRecalculo.nome, { _cfg: cfg });
}
export function kanbanDefinirAutomatico(ligar: boolean): Promise<ResultadoDefinir> {
  return rpc<ResultadoDefinir>(RPC_KANBAN.definirAutomatico.nome, { _ligar: ligar });
}
export function kanbanPreviaRestauracao(loteId: string | null): Promise<PreviaRestauracao> {
  return rpc<PreviaRestauracao>(RPC_KANBAN.previaRestauracao.nome, { _lote_id: loteId });
}
export function kanbanRestaurar(loteId: string): Promise<ResultadoRestaurar> {
  return rpc<ResultadoRestaurar>(RPC_KANBAN.restaurar.nome, { _lote_id: loteId });
}
```

Criar `src/hooks/useKanbanConfig.ts`:

```ts
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { lerKanbanAutoConfig, type KanbanAutoConfig } from "@/lib/kanban-auto";
import { motorKanbanDisponivel } from "@/lib/kanban-auto-ui";

/**
 * Config do Kanban automático da loja ATIVA (F2): board, requisitos, exceções, fluxo de revenda e a chave.
 * `select("*")` DE PROPÓSITO: antes da F1 ser aplicada a coluna `kanban_automatico` não existe — pedi-la
 * pelo nome daria 42703 e quebraria a tela; com `*` ela só vem AUSENTE ⇒ `ligado=false` ⇒ a tela segue o
 * caminho de hoje. Erro de rede também degrada para desligado (o servidor ainda protege: guard da F1).
 * queryKey começa com "tenant-" ⇒ casa `matchTenantConfig` (save da Config + realtime invalidam).
 */
export function useKanbanConfig(): { cfg: KanbanAutoConfig; ligado: boolean; motorDisponivel: boolean; carregando: boolean } {
  const tenantId = useActiveTenantId();
  const q = useQuery({
    queryKey: ["tenant-kanban-auto", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.from("tenant_config").select("*").eq("tenant_id", tenantId).maybeSingle();
      if (error) throw error;
      return (data ?? null) as Record<string, unknown> | null;
    },
  });
  const cfg = useMemo(() => lerKanbanAutoConfig(q.data ?? null), [q.data]);
  return { cfg, ligado: cfg.kanban_automatico, motorDisponivel: motorKanbanDisponivel(q.data), carregando: q.isLoading };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd "/Users/sunglee/PLM + Criação/plm-pcp" && npx vitest run --no-file-parallelism tests/unit/erro-mensagem.test.ts tests/unit/kanban-auto-rpc-contrato.test.ts tests/unit/realtime-invalidation-map.test.ts`
Expected: PASS (o bloco das RPCs aparece como `skipped` enquanto a migration 4 da F1 não existir; com ela, 5 testes PASS).

- [ ] **Step 5: Gates + commit**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp"
npm run build 2>&1 | tail -3
npx tsc --noEmit 2>&1 | grep -c "error TS"
npx vitest run --no-file-parallelism tests/unit 2>&1 | tail -4
git add -- src/lib/kanban-auto-rpc.ts src/hooks/useKanbanConfig.ts tests/unit/kanban-auto-rpc-contrato.test.ts
git commit --only -m "feat(kanban-auto): F2 — RPCs tipadas, useKanbanConfig (tolera banco sem F1), 42501 próprias em PT e contrato F1×F2

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- src/lib/kanban-auto-rpc.ts src/hooks/useKanbanConfig.ts src/lib/erro-mensagem.ts tests/unit/kanban-auto-rpc-contrato.test.ts tests/unit/erro-mensagem.test.ts tests/unit/realtime-invalidation-map.test.ts
git show --stat HEAD | tail -n +7
```

---

### Task 4: `EtapaKanbanBadge` + selo e legenda no card do Planejamento (corpo cheio E compacto)

**Files:**
- Create: `src/components/shared/EtapaKanbanBadge.tsx`
- Modify: `src/routes/_authenticated/criacao.planejamento.tsx` (imports; `type Modelo` l. 81–110; select l. 361; hooks perto de `otbOn` l. ~327; `renderCard` l. ~652; `ModeloCard` l. 1244–1246; corpo COMPACTO l. ~1321–1363 (linha status/REF l. ~1354–1357); bloco da REF do corpo cheio l. ~1401; grid l. ~1128)

**Interfaces:**
- Consumes: `etapaDoModelo`, `tituloSelo`, `EtapaSelo` (Task 1); `useKanbanConfig` (Task 3).
- Produces: `EtapaKanbanBadge({ selo: EtapaSelo; className?: string; onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void; testId?: string; compacto?: boolean })` (default `data-testid="etapa-kanban-selo"`; com `onClick` vira `<button>` — a F3 usa no header do Sheet p/ o "Mover para…"; com `compacto` ganha `data-compacto="true"`, fonte/padding menores e troca o texto "automática"/"fixado" só pelo ícone); `EtapaKanbanLegenda({ ligado: boolean; className?: string })` (`data-testid="etapa-kanban-legenda"`).
- **B1 — resposta do dono (23/set): "Sim, o selo entra também no card COMPACTO"** (o que aparece < 1024 px quando o card fica com < 170 px — `src/hooks/useGridCols.ts:84-95` —, e no desktop com muitas colunas; hoje "só o essencial", `criacao.planejamento.tsx:~1321-1324`). Forma: selo pequeno com o rótulo da etapa numa linha própria logo ABAIXO da linha status/REF, sem o texto "automática"/"fixado" (no máximo o ícone), truncando o rótulo — sem alargar o card em 360/390 px.
- Sem teste unit (componente; `environment: node`). A lógica está coberta na Task 1; a tela é conferida no E2E (Task 8), inclusive o card compacto a 360 e 390 px (Step 5 desta task).

- [ ] **Step 1: Criar `src/components/shared/EtapaKanbanBadge.tsx`**

```tsx
import { Pin, Rocket, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { tituloSelo, type EtapaSelo } from "@/lib/kanban-auto-ui";

/**
 * Selo da ETAPA do kanban de Desenvolvimento (decisão 5 do dono). Reutilizável: card da lista do
 * Planejamento (F2) e header do Sheet unificado (F3 — com `onClick` abre o "Mover para…").
 * Estados vêm de `etapaDoModelo` (puro): "Planejamento" (antes da Ordem de Criação) · "Lançado" · a coluna
 * do Dev; com a chave ligada soma "automática" (anda sozinho) ou "fixado" (coluna manual).
 */
export function EtapaKanbanBadge({ selo, className, onClick, testId = "etapa-kanban-selo", compacto = false }: {
  selo: EtapaSelo;
  className?: string;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  testId?: string;
  // Card COMPACTO do Planejamento (B1, dono 23/set): menor, e "automática"/"fixado" viram só o ícone (o `title` tem a frase).
  compacto?: boolean;
}) {
  const lancado = selo.fase === "lancado";
  const cls = cn(
    "inline-flex max-w-full min-w-0 items-center rounded-full border font-medium leading-tight",
    compacto ? "gap-1 px-1.5 py-0.5 text-[10px]" : "gap-1.5 px-2 py-0.5 text-[11px]",
    lancado ? "border-transparent bg-[var(--tone-success-bg)] text-[var(--tone-success-fg)]" : "bg-card text-foreground",
    onClick && "cursor-pointer hover:bg-muted",
    className,
  );
  const conteudo = (
    <>
      {lancado ? (
        <Rocket className="h-3 w-3 shrink-0" />
      ) : (
        <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: selo.color ?? "var(--muted-foreground)" }} />
      )}
      <span className="min-w-0 truncate">{selo.label}</span>
      {selo.modo === "automatica" && (compacto ? (
        <span role="img" aria-label="automática" className="inline-flex shrink-0 text-muted-foreground"><Zap className="h-3 w-3" /></span>
      ) : (
        <span className="inline-flex shrink-0 items-center gap-0.5 font-normal text-muted-foreground"><Zap className="h-3 w-3" />automática</span>
      ))}
      {selo.modo === "fixado" && (compacto ? (
        <span role="img" aria-label="fixado" className="inline-flex shrink-0 text-muted-foreground"><Pin className="h-3 w-3" /></span>
      ) : (
        <span className="inline-flex shrink-0 items-center gap-0.5 font-normal text-muted-foreground"><Pin className="h-3 w-3" />fixado</span>
      ))}
    </>
  );
  const titulo = tituloSelo(selo);
  const dataCompacto = compacto ? "true" : undefined;
  return onClick ? (
    <button type="button" data-testid={testId} data-compacto={dataCompacto} className={cls} title={titulo} onClick={onClick}>{conteudo}</button>
  ) : (
    <span data-testid={testId} data-compacto={dataCompacto} className={cls} title={titulo}>{conteudo}</span>
  );
}

const SELO_PLANEJAMENTO: EtapaSelo = { fase: "planejamento", key: null, label: "Planejamento", color: null, modo: "off" };
const SELO_ETAPA: EtapaSelo = { fase: "kanban", key: "em_pilotagem", label: "Em Pilotagem", color: "var(--kanban-violet)", modo: "off" };
const SELO_AUTOMATICA: EtapaSelo = { ...SELO_ETAPA, modo: "automatica" };
const SELO_FIXADO: EtapaSelo = { fase: "kanban", key: "stand_by", label: "Stand By", color: "var(--muted-foreground)", modo: "fixado" };
const SELO_LANCADO: EtapaSelo = { fase: "lancado", key: null, label: "Lançado", color: null, modo: "off" };

/** Legenda dos estados do selo (mockup "Cards do Planejamento com a etapa"). */
export function EtapaKanbanLegenda({ ligado, className }: { ligado: boolean; className?: string }) {
  const itens: { id: string; selo: EtapaSelo; texto: string }[] = [
    { id: "plan", selo: SELO_PLANEJAMENTO, texto: "antes da Ordem de Criação" },
    ...(ligado
      ? [
          { id: "auto", selo: SELO_AUTOMATICA, texto: "anda sozinho pelos campos salvos" },
          { id: "fix", selo: SELO_FIXADO, texto: "fixado numa coluna manual" },
        ]
      : [{ id: "etapa", selo: SELO_ETAPA, texto: "etapa no Desenvolvimento" }]),
    { id: "lanc", selo: SELO_LANCADO, texto: "modelo lançado" },
  ];
  return (
    <div
      data-testid="etapa-kanban-legenda"
      className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground", className)}
    >
      <span className="font-semibold text-foreground">Selo da etapa</span>
      {itens.map((i) => (
        <span key={i.id} className="inline-flex items-center gap-1.5">
          <EtapaKanbanBadge selo={i.selo} testId="etapa-kanban-selo-exemplo" />
          {i.texto}
        </span>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Planejamento — dados e hook**

Em `src/routes/_authenticated/criacao.planejamento.tsx`:

(a) logo depois da linha `import { VersaoBadge } from "@/components/shared/VersaoBadge";` inserir:

```ts
import { EtapaKanbanBadge, EtapaKanbanLegenda } from "@/components/shared/EtapaKanbanBadge";
import { useKanbanConfig } from "@/hooks/useKanbanConfig";
import { etapaDoModelo, type EtapaSelo } from "@/lib/kanban-auto-ui";
```

(b) no `type Modelo` (l. 81–110), trocar a linha `  lancado: boolean | null;` por:

```ts
  lancado: boolean | null;
  // Selo da etapa do kanban (F2): a coluna do Dev só vale depois da Ordem de Criação.
  status_desenvolvimento: string | null;
  ordem_criacao_enviada: boolean | null;
```

(c) no `.select(` da query `["modelos-planejamento"]` (l. 361), trocar o final `…, observacoes_mao_obra, motivo_reprovacao_mao_obra")` por:

```ts
…, observacoes_mao_obra, motivo_reprovacao_mao_obra, status_desenvolvimento, ordem_criacao_enviada")
```
(ou seja: acrescentar `, status_desenvolvimento, ordem_criacao_enviada` antes do `"` de fechamento; o resto da string fica igual.)

(d) logo depois de `const otbOn = isModuleEnabled("otb");` inserir:

```ts
  // Selo da etapa (F2): board/requisitos/chave da loja — `select("*")`, tolera banco sem a F1 (= chave desligada).
  const { cfg: kanbanCfg, ligado: kanbanLigado } = useKanbanConfig();
```

- [ ] **Step 3: Planejamento — selo no card cheio E no compacto + legenda**

(a) em `renderCard`, logo depois da prop `        refModelo={(m as any).ref || (m as any).ref_auto || null}` inserir:

```tsx
        etapa={etapaDoModelo(m, kanbanCfg)}
```

(b) na assinatura de `ModeloCard` (l. 1244), acrescentar `etapa` à desestruturação — trocar `…, refModelo, precoVenda, …` por `…, refModelo, etapa, precoVenda, …` — e no tipo (l. 1245) trocar `refModelo: string | null;` por `refModelo: string | null; etapa: EtapaSelo;`.

(c) no corpo CHEIO, trocar:

```tsx
          {refModelo && <div className="px-2.5 pb-1 font-mono text-[11px] text-muted-foreground truncate">{refModelo}</div>}
```

por:

```tsx
          {refModelo && <div className="px-2.5 pb-1 font-mono text-[11px] text-muted-foreground truncate">{refModelo}</div>}
          {/* Selo da etapa do kanban (F2, decisão 5): Planejamento antes da Ordem de Criação; Lançado; senão a
              coluna do Dev (+ automática/fixado com a chave ligada). O compacto tem a versão pequena (B1). */}
          <div className="px-2.5 pb-1.5"><EtapaKanbanBadge selo={etapa} /></div>
```

(c2) no corpo COMPACTO (B1 — dono 23/set: "o selo entra também no card compacto"), trocar a linha status/REF:

```tsx
          <div className="flex items-center gap-1">
            <StatusBadge tone={meta.tone} className="rounded-full px-1.5 py-0.5">{meta.label}</StatusBadge>
            {refModelo && <span className="ml-auto truncate font-mono text-[10px] text-muted-foreground">{refModelo}</span>}
          </div>
```

por:

```tsx
          <div className="flex items-center gap-1">
            <StatusBadge tone={meta.tone} className="rounded-full px-1.5 py-0.5">{meta.label}</StatusBadge>
            {refModelo && <span className="ml-auto truncate font-mono text-[10px] text-muted-foreground">{refModelo}</span>}
          </div>
          {/* Selo da etapa no COMPACTO (B1, dono 23/set): linha própria abaixo do status/REF, só o rótulo (+ no máximo
              o ícone Zap/Pin com a chave ligada); trunca em vez de alargar o card (360/390 px). */}
          <div className="flex min-w-0"><EtapaKanbanBadge selo={etapa} compacto /></div>
```

(o comentário do topo do compacto, "só o essencial — nome · REF · preço de venda · markup", ganha "· etapa (selo, B1)": trocar `// venda · markup (decisão do dono set/2026). Toque abre o Sheet com o resto. Status por` por `// venda · markup (decisão do dono set/2026) · etapa (selo pequeno, B1 23/set). Toque abre o Sheet com o resto. Status por`.)

(d) logo depois do fechamento `</div>` do `<div ref={gridRef}>` (o bloco que termina com `<div className={GRID_COLS_CARROSSEL_CLASS[cols]}>{sorted.map(renderCard)}</div>\n      )}\n      </div>`), inserir:

```tsx
      {filtered.length > 0 && <EtapaKanbanLegenda ligado={kanbanLigado} />}
```

- [ ] **Step 4: Verificar**

Run:
```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp"
npm run build 2>&1 | tail -3
npx tsc --noEmit 2>&1 | grep -c "error TS"
npx vitest run --no-file-parallelism tests/unit 2>&1 | tail -4
npx vitest run tests/unit/ui-padroes-antidrift.test.ts 2>&1 | grep -E "EtapaKanban|criacao\.planejamento" ; true
grep -c "<EtapaKanbanBadge selo={etapa}" src/routes/_authenticated/criacao.planejamento.tsx
grep -n "<EtapaKanbanBadge selo={etapa} compacto />" src/routes/_authenticated/criacao.planejamento.tsx
```
Expected: build ok; `0`; só as 2 falhas pré-existentes; o grep do anti-drift vazio (`text-[10px]` do selo compacto cai só na regra h, report-only — a mesma do REF do compacto de hoje); `2` (corpo cheio + compacto); 1 linha do compacto.

- [ ] **Step 5: QA mobile do card compacto (só leitura)**

O selo do compacto é conferido pelos testes `"Planejamento no celular (360 px): selo no card compacto sem estourar a largura"` e `"Planejamento no celular (390 px): selo no card compacto sem estourar a largura"` da spec E2E (Task 8 Step 1, bloco da chave desligada; o bloco da chave ligada soma `"Planejamento no celular (360 px) com a chave ligada: compacto só com o ícone, sem estourar"`) — mede, em 360 e 390 px, que cada selo fica dentro da linha e do card (`getBoundingClientRect().right` ≤ o do pai; `scrollWidth ≤ clientWidth` da linha e do corpo do card) e que o compacto não mostra o texto "automática"/"fixado". A 360 px o card é compacto com certeza (`main` tem `p-4` ⇒ largura útil 328 ⇒ card de 156 px < 170); a 390 px o card fica no limite (~171 px — pode sair no corpo cheio) e o teste só exige que nenhum selo estoure, compacto ou cheio. Se as tasks forem executadas na ordem, rodar esse teste assim que a Task 8 Step 1 existir (antes do commit da spec) e anexar a saída ao G-commit; se o teste acusar estouro, o ajuste é nesta task (classes do selo/linha) e os gates desta task se repetem.

- [ ] **Step 6: Commit**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp"
git add -- src/components/shared/EtapaKanbanBadge.tsx
git commit --only -m "feat(kanban-auto): F2 — selo da etapa no card do Planejamento, cheio e compacto (+ legenda); EtapaKanbanBadge reutilizável

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- src/components/shared/EtapaKanbanBadge.tsx src/routes/_authenticated/criacao.planejamento.tsx
git show --stat HEAD | tail -n +7
```

---

### Task 5: Board do Desenvolvimento — ramo da chave ligada (dica, RPC, toast, ícones, faixa, "Mover para…")

**Files:**
- Modify: `src/routes/_authenticated/criacao.desenvolvimento.tsx` (imports l. 4 e 15; depois de `revendaCfg` l. 251; query de condições l. 289; depois de `podeEntrar` l. 332; `renderDesktopCard` l. 461–474; `renderMobileCard` l. 475–503; `renderGroups` l. 511; depois de `updateStatus` l. 571; `handleDrop` l. 573–591; depois do `</header>` l. 762; bloco das colunas desktop l. 768–846; cabeçalho do acordeão mobile l. 919–922; `ModeloDetailPanel` l. 977; `MobileCard` l. 1009–1065; `KanbanCard` l. 1068–1119)

**Interfaces:**
- Consumes: `useKanbanConfig` (Task 3); `kanbanMover` (Task 3); `dropBloqueado`, `modoColuna`, `notaMoverPara`, `proximaFalta`, `rotuloModoColuna`, `subtituloColuna`, `textoFaixaDrop`, `toastDoMover`, `ModoColuna` (Task 1); `boardDaLoja`, `derivarModelo`, `destinoDrop`, `entradaParaDerivacao`, `Derivacao`, `DestinoDrop`, `ModeloKanban` (F1).
- Produces: testids p/ o E2E — `kanban-auto-faixa`, `kanban-coluna-<key>`, `kanban-col-modo` (desktop), `kanban-col-modo-mobile`, `kanban-col-sub`, `kanban-drop-faixa`, `kanban-card`, `kanban-card-fixado`, `kanban-grupo-toggle`.
- **Depende da F1 em RUNTIME:** o ramo novo só executa com `kanban_automatico=true`, o que só existe depois das migrations 1–4 aplicadas em produção (F1 Task 18) e de a chave ser ligada (G-chave). Compila e roda (como chave desligada) sem a F1.

- [ ] **Step 1: Imports**

Trocar a linha 4:
```ts
import { Hammer, ImageIcon, ChevronRight, ChevronDown, ChevronsDownUp, ChevronsUpDown, Check, X, AlertTriangle, Tag } from "lucide-react";
```
por:
```ts
import { Hammer, ImageIcon, ChevronRight, ChevronDown, ChevronsDownUp, ChevronsUpDown, Check, X, AlertTriangle, Tag, Zap, Hand, Pin, ArrowRight } from "lucide-react";
```

Logo depois da linha `import { ehOrigemComprada, normalizarOrigem, rotuloOrigem, rotuloOrigemLane } from "@/lib/origem";` inserir:
```ts
import { useKanbanConfig } from "@/hooks/useKanbanConfig";
import {
  boardDaLoja, derivarModelo, destinoDrop, entradaParaDerivacao,
  type Derivacao, type DestinoDrop, type ModeloKanban,
} from "@/lib/kanban-auto";
import {
  dropBloqueado, modoColuna, notaMoverPara, proximaFalta, rotuloModoColuna, subtituloColuna, textoFaixaDrop, toastDoMover,
  type ModoColuna,
} from "@/lib/kanban-auto-ui";
import { kanbanMover } from "@/lib/kanban-auto-rpc";
```

- [ ] **Step 2: Chave + helpers da chave ligada**

Logo depois de `const revendaCfg = useMemo(() => lerRevendaConfig(revendaCfgRaw), [revendaCfgRaw]);` inserir:
```ts
  // KANBAN AUTOMÁTICO (F2). Chave por loja (`tenant_config.kanban_automatico`). DESLIGADA = todo o caminho
  // abaixo é o de hoje (podeEntrar + updateStatus). LIGADA = a tabela única de arraste (`destinoDrop`, espelho
  // do SQL) dá a DICA e a RPC `kanban_mover` DECIDE (o servidor é a autoridade: as condições aqui podem
  // estar velhas). Sem a F1 aplicada o hook devolve ligado=false.
  const { cfg: kanbanCfg, ligado: kanbanAuto } = useKanbanConfig();
```

Na query das condições, trocar `const { data: condicoesMap = {} } = useQuery({` por:
```ts
  const { data: condicoesMap = {}, isSuccess: condicoesProntas } = useQuery({
```

Logo depois do fechamento da função `podeEntrar` (a linha `  };` que segue `return requisitosOk(efetivos, (condicoesMap as any)[modeloId] ?? {});`), inserir:
```ts
  // ── Chave LIGADA (F2): helpers. Cards do board têm ordem_criacao_enviada=true (filtro da query). ──
  const kanbanBoardKeys = useMemo(() => boardDaLoja(kanbanCfg).map((c) => c.key), [kanbanCfg]);
  const modeloKanban = (m: Modelo): ModeloKanban => ({
    origem: m.origem, status_desenvolvimento: m.status_desenvolvimento, ordem_criacao_enviada: true, lancado: m.lancado,
  });
  const condDe = (id: string) => (condicoesMap as Record<string, Record<string, boolean>>)[id] ?? {};
  const derivacaoAuto = (m: Modelo): Derivacao => derivarModelo(modeloKanban(m), kanbanCfg, condDe(m.id));
  const destinoAuto = (m: Modelo, para: string): DestinoDrop =>
    destinoDrop(entradaParaDerivacao(modeloKanban(m), kanbanCfg, condDe(m.id)), para);
  // Cabeçalho mostra o modo do fluxo INTERNO (board + kanban_requisitos); o card de revenda leva a derivação dele.
  const modoDaColuna = (key: string): ModoColuna | null =>
    kanbanAuto ? modoColuna(key, kanbanBoardKeys, kanbanCfg.kanban_requisitos) : null;
  const infoAutoDoCard = (m: Modelo) => {
    if (!kanbanAuto) return undefined;
    const d = derivacaoAuto(m);
    return { fixado: d.fixado, proxima: proximaFalta(d) };
  };
  // Com a chave ligada, arrastar/"Mover para…" só depois das condições carregarem (senão a dica mentiria).
  const podeMover = editable && (!kanbanAuto || condicoesProntas);
```

- [ ] **Step 3: Cards e "Mover para…"**

Em `renderDesktopCard`, trocar `      draggable={editable}` por:
```tsx
      draggable={podeMover}
      auto={infoAutoDoCard(m)}
```

Substituir a função `renderMobileCard` inteira (de `  const renderMobileCard = (m: Modelo) => {` até o `  };` que fecha depois de `    );`) por:
```tsx
  const renderMobileCard = (m: Modelo) => {
    // "Mover para…" no mobile = o equivalente ao arraste do desktop. Já anota o que falta
    // em cada destino bloqueado (mesma regra) e o onMove reusa o gate + toast do handleDrop.
    // Coluna EFETIVA = mesma lógica do byStatus (status inválido/null cai na 1ª coluna) — assim
    // a coluna onde o card aparece nunca entra no "Mover para…".
    const effStatus = m.status_desenvolvimento && statusKeySet.has(m.status_desenvolvimento) ? m.status_desenvolvimento : firstStatusKey;
    const moverOpts = podeMover
      ? statusKanban
          .filter((s) => s.key !== effStatus)
          .map((s) => {
            if (kanbanAuto) {
              // Chave ligada: anota pela tabela única ("fixa aqui", "já cumpre", "falta N dados"…); escolher
              // um destino "bloqueado" ainda vai à RPC, que decide e responde com o toast.
              const nota = notaMoverPara(destinoAuto(m, s.key));
              return { key: s.key, label: s.label, faltando: [] as string[], nota: nota.texto, bloqueada: nota.bloqueada, modo: modoDaColuna(s.key) };
            }
            const { ok, faltando } = podeEntrar(m.id, s.key);
            return { key: s.key, label: s.label, faltando: ok ? [] : faltando.map((c) => c.label) };
          })
      : undefined;
    return (
      <MobileCard
        key={m.id}
        modelo={m}
        moEstado={moEstadoMap[m.id]}
        estilistaNome={m.estilista_id ? estMap[m.estilista_id] : null}
        categoriaNome={m.categoria_principal_id ? catMap[m.categoria_principal_id] : null}
        onOpen={() => setOpenId(m.id)}
        moverOpts={moverOpts}
        auto={infoAutoDoCard(m)}
        onMove={(statusKey) => {
          if (statusKey === effStatus) return;
          if (kanbanAuto) { moverAuto(m, statusKey); return; }
          const { ok, faltando } = podeEntrar(m.id, statusKey);
          if (!ok) { toast.error(`Não pode entrar aqui. Faltam: ${faltando.map((c) => c.label).join(", ")}`); return; }
          updateStatus.mutate({ id: m.id, status: statusKey });
        }}
      />
    );
  };
```

Em `renderGroups`, no `<button` do grupo (o que tem `onClick={() => toggleGroup(p)}`), acrescentar a prop `data-testid="kanban-grupo-toggle"` logo depois de `type="button"`.

- [ ] **Step 4: Mutation da chave ligada + drop**

Logo depois do fechamento de `const updateStatus = useMutation({ … });` inserir:
```tsx
  // Chave LIGADA (F2): o servidor aplica a tabela única de arraste (fixar/soltar/nada/bloqueios), apaga o
  // #Erro quando o usuário revisou e NÃO mexe no motivo de cancelamento (decisão 15). Otimista só p/
  // fixar/soltar PREVISTOS; o status final e o toast vêm da RESPOSTA.
  const moverAutoMut = useMutation({
    mutationFn: (v: { id: string; para: string; previsto: DestinoDrop; statusAntes: string | null; fixadoAntes: boolean }) =>
      kanbanMover(v.id, v.para),
    onMutate: async ({ id, previsto }) => {
      await qc.cancelQueries({ queryKey: ["modelos-desenvolvimento"] });
      const prev = qc.getQueryData<Modelo[]>(["modelos-desenvolvimento"]);
      if (previsto.acao === "fixar" || previsto.acao === "soltar") {
        qc.setQueryData<Modelo[]>(["modelos-desenvolvimento"], (old) =>
          (old ?? []).map((m) => (m.id === id ? { ...m, status_desenvolvimento: previsto.status } : m)),
        );
      }
      return { prev };
    },
    onSuccess: (r, { id, para, statusAntes, fixadoAntes }) => {
      qc.setQueryData<Modelo[]>(["modelos-desenvolvimento"], (old) =>
        (old ?? []).map((m) => (m.id === id ? { ...m, status_desenvolvimento: r.status } : m)),
      );
      const t = toastDoMover(r, para, statusKanban, statusAntes, fixadoAntes);
      if (t?.tipo === "error") toast.error(t.texto);
      else if (t?.tipo === "success") toast.success(t.texto);
      else if (t) toast.info(t.texto);
    },
    onError: (e: any, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["modelos-desenvolvimento"], ctx.prev);
      toast.error(mensagemErro(e, "Erro ao mover o card"));
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["modelos-desenvolvimento"] });
      qc.invalidateQueries({ queryKey: ["desenv-condicoes"] });
    },
  });
  const moverAuto = (m: Modelo, para: string) => {
    const d = derivacaoAuto(m);
    moverAutoMut.mutate({ id: m.id, para, previsto: destinoAuto(m, para), statusAntes: m.status_desenvolvimento, fixadoAntes: d.fixado });
  };
```

Em `handleDrop`, trocar:
```ts
    const cur = modelos.find((m) => m.id === id);
    if (!cur || cur.status_desenvolvimento === statusKey) return;
```
por:
```ts
    const cur = modelos.find((m) => m.id === id);
    if (!cur || cur.status_desenvolvimento === statusKey) return;
    // Chave LIGADA: sem trava local — a RPC decide (e responde com o toast). A coluna "bloqueada" só dá a dica.
    if (kanbanAuto) { moverAuto(cur, statusKey); return; }
```

- [ ] **Step 5: Faixa informativa**

Logo depois do `</header>` da página (o que fecha o header com o `FilterButton`), inserir:
```tsx
      {kanbanAuto && (
        <div
          data-testid="kanban-auto-faixa"
          className="flex items-start gap-2 rounded-md bg-[var(--tone-info-bg)] px-3 py-2 text-sm text-[var(--tone-info-fg)]"
        >
          <Zap className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <span className="font-semibold">Kanban automático ligado.</span> Colunas <Zap className="inline h-3 w-3 align-baseline" /> andam
            sozinhas pelos campos salvos. Colunas <Hand className="inline h-3 w-3 align-baseline" /> são manuais: o card entra e sai delas arrastado.
          </span>
        </div>
      )}
```

- [ ] **Step 6: Colunas do desktop**

Substituir o bloco `{statusKanban.map((s) => { … })}` do DESKTOP (começa em `        {statusKanban.map((s) => {` logo depois de `<div className="hidden md:flex gap-4 overflow-x-auto pb-4 items-stretch">` e termina no `        })}` imediatamente antes do comentário `{/* Coluna terminal sintética "Lançado" — SEMPRE por último`) por:
```tsx
        {statusKanban.map((s) => {
          const cards = byStatus.get(s.key) ?? [];
          const isOver = dragOver === s.key;
          const isCollapsed = collapsed.has(s.key);
          // Feedback de arraste (laudo das 3 lentes): ao arrastar, TODO destino válido acende
          // (não só quando há regra bloqueando); a coluna de ORIGEM fica neutra; o destino
          // bloqueado esmaece + diz o que falta. Usa o status EFETIVO (status null cai na 1ª coluna).
          const dragModel = draggingId ? modelos.find((m) => m.id === draggingId) : null;
          const dragEff = dragModel ? (dragModel.status_desenvolvimento && statusKeySet.has(dragModel.status_desenvolvimento) ? dragModel.status_desenvolvimento : firstStatusKey) : null;
          const isSelf = !!draggingId && dragEff === s.key;
          // Chave LIGADA (F2): a tabela única dá a DICA; a coluna NÃO fica inerte (sem pointer-events-none) —
          // o drop vai à RPC kanban_mover, que decide com as condições do banco.
          const destino = kanbanAuto && dragModel && !isSelf ? destinoAuto(dragModel, s.key) : null;
          const faixaAuto = destino ? textoFaixaDrop(destino, s.key, statusKanban) : null;
          const bloqueio = !kanbanAuto && !!draggingId && !isSelf ? podeEntrar(draggingId!, s.key).faltando : [];
          const blocked = kanbanAuto ? (destino ? dropBloqueado(destino) : false) : bloqueio.length > 0;
          const canDrop = !!draggingId && !isSelf && !blocked;
          const modo = modoDaColuna(s.key);
          const subtitulo = modo ? subtituloColuna(modo, kanbanCfg.kanban_requisitos[s.key] ?? []) : "";
          return (
            <div
              key={s.key}
              data-testid={`kanban-coluna-${s.key}`}
              className={`shrink-0 rounded-lg flex flex-col max-h-[calc(100vh-260px)] transition-colors ${isCollapsed ? "" : "w-80"} ${
                blocked ? `border border-dashed border-destructive/50 bg-destructive/5${kanbanAuto ? "" : " pointer-events-none"}`
                : canDrop ? "border-2 border-dashed border-primary/60 bg-primary/10"
                : "border bg-muted/30"
              } ${isOver && !isSelf ? "ring-2 ring-primary" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(s.key); }}
              onDragLeave={() => setDragOver((cur) => (cur === s.key ? null : cur))}
              onDrop={(e) => handleDrop(s.key, e)}
            >
              {isCollapsed ? (
                /* Recolhida: trilho vertical estreito (clica p/ expandir) */
                <button
                  type="button"
                  onClick={() => toggleCollapse(s.key)}
                  title={s.label}
                  className="flex-1 w-9 flex flex-col items-center gap-2 py-3 hover:bg-muted/50"
                >
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color ?? "var(--muted-foreground)" }} />
                  {modo && <ModoColunaIcone modo={modo} />}
                  <span className="text-sm font-semibold whitespace-nowrap [writing-mode:vertical-rl] rotate-180">{s.label}</span>
                  <span className="text-xs text-muted-foreground">{cards.length}</span>
                </button>
              ) : (
                <>
                  {/* Título horizontal no topo (clica p/ recolher) */}
                  <button
                    type="button"
                    onClick={() => toggleCollapse(s.key)}
                    title="Recolher coluna"
                    className="flex items-center gap-2 px-3 py-2.5 border-b hover:bg-muted/50 text-left"
                  >
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color ?? "var(--muted-foreground)" }} />
                    <span className="text-sm font-semibold truncate">{s.label}</span>
                    {modo && <ModoColunaIcone modo={modo} />}
                    {modo === "entrada" && (
                      <StatusBadge tone="neutral" className="text-[10px] normal-case tracking-normal shrink-0">entrada</StatusBadge>
                    )}
                    <span className="ml-auto text-xs text-muted-foreground tabular-nums">{cards.length}</span>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60 rotate-90" />
                  </button>
                  {/* Chave ligada: o que a coluna exige (ou que é manual) — mockup aprovado. */}
                  {modo && (
                    <div data-testid="kanban-col-sub" className="truncate border-b px-3 py-1.5 text-[11px] text-muted-foreground" title={subtitulo}>
                      {subtitulo}
                    </div>
                  )}
                  {/* Bloqueio no arraste: diz O QUE falta (não fica só apagado) */}
                  {!kanbanAuto && blocked && (
                    <div className="px-3 py-1.5 border-b border-dashed border-destructive/40 text-[11px] leading-snug text-destructive">
                      <span className="font-semibold">Não pode entrar aqui.</span> Faltam: {bloqueio.map((c) => c.label).join(" · ")}
                    </div>
                  )}
                  {kanbanAuto && blocked && faixaAuto && (
                    <div data-testid="kanban-drop-faixa" className="px-3 py-1.5 border-b border-dashed border-destructive/40 text-[11px] leading-snug text-destructive">
                      {faixaAuto}
                    </div>
                  )}
                  {/* Destino válido em foco: convite positivo (espelho da faixa de bloqueio). */}
                  {canDrop && isOver && (
                    <div className="px-3 py-1.5 border-b border-dashed border-primary/40 text-[11px] leading-snug text-primary">
                      {faixaAuto ?? "Solte aqui para mover"}
                    </div>
                  )}
                  {/* Cards empilhados */}
                  <div className={`flex-1 min-w-0 p-2 space-y-2 overflow-y-auto transition-opacity ${blocked ? "opacity-40" : ""}`}>
                    {cards.length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-6">Sem cards</p>
                    ) : splitters.length === 0 ? (
                      cards.map(renderDesktopCard)
                    ) : (
                      renderGroups(buildGroups(cards, 0), s.key, renderDesktopCard)
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}
```

- [ ] **Step 7: Acordeão mobile + Sheet**

No acordeão mobile, trocar:
```tsx
                      <span className="truncate text-sm font-semibold">{s.label}</span>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">{cards.length}</span>
```
(a ocorrência DENTRO de `{statusKanban.map((s) => {` do `<Accordion`, não a da coluna terminal) por:
```tsx
                      <span className="truncate text-sm font-semibold">{s.label}</span>
                      {modoDaColuna(s.key) && <ModoColunaIcone modo={modoDaColuna(s.key)!} testId="kanban-col-modo-mobile" />}
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">{cards.length}</span>
```

Trocar `      <ModeloDetailPanel modeloId={openId} onClose={() => setOpenId(null)} />` por:
```tsx
      <ModeloDetailPanel
        modeloId={openId}
        onClose={() => {
          setOpenId(null);
          // Chave ligada: o Sheet pode ter mudado campos que as condições leem — a dica do arraste precisa delas frescas.
          if (kanbanAuto) qc.invalidateQueries({ queryKey: ["desenv-condicoes"] });
        }}
      />
```

- [ ] **Step 8: `MobileCard`, `KanbanCard` e os 2 componentes novos**

Na assinatura de `MobileCard`, trocar:
```tsx
function MobileCard({ modelo, moEstado, estilistaNome, categoriaNome, onOpen, moverOpts, onMove }: {
  modelo: Modelo;
  moEstado?: string;
  estilistaNome: string | null;
  categoriaNome: string | null;
  onOpen: () => void;
  moverOpts?: { key: string; label: string; faltando: string[] }[];
  onMove?: (statusKey: string) => void;
}) {
```
por:
```tsx
function MobileCard({ modelo, moEstado, estilistaNome, categoriaNome, onOpen, moverOpts, onMove, auto }: {
  modelo: Modelo;
  moEstado?: string;
  estilistaNome: string | null;
  categoriaNome: string | null;
  onOpen: () => void;
  // `nota`/`bloqueada`/`modo` só com a chave LIGADA (F2); sem eles = rótulo de hoje ("· falta …").
  moverOpts?: { key: string; label: string; faltando: string[]; nota?: string; bloqueada?: boolean; modo?: ModoColuna | null }[];
  onMove?: (statusKey: string) => void;
  auto?: { fixado: boolean; proxima: string | null };
}) {
```

No corpo de `MobileCard`, trocar `          <MaoObraBadge estado={moEstado} />` por:
```tsx
          <MaoObraBadge estado={moEstado} />
          <CardAutoInfo auto={auto} />
```
e trocar o `{moverOpts.map((o) => ( … ))}` do `<SelectContent>` por:
```tsx
            {moverOpts.map((o) => (
              <SelectItem key={o.key} value={o.key} className={o.faltando.length || o.bloqueada ? "text-muted-foreground" : ""}>
                {o.label}
                {o.modo && (
                  <span className="ml-1 inline-flex align-middle text-muted-foreground">
                    {o.modo === "manual" || o.modo === "manual_sempre" ? <Hand className="h-3 w-3" /> : <Zap className="h-3 w-3" />}
                  </span>
                )}
                {o.nota !== undefined
                  ? o.nota && <span className="text-xs opacity-70"> · {o.nota}</span>
                  : o.faltando.length > 0 && <span className="text-xs opacity-70"> · falta {o.faltando.join(", ")}</span>}
              </SelectItem>
            ))}
```

Na assinatura de `KanbanCard`, trocar:
```tsx
function KanbanCard({ modelo, moEstado, estilistaNome, categoriaNome, onOpen, draggable: isDraggable, dragging, onDragStartCard, onDragEndCard }: {
  modelo: Modelo; moEstado?: string; estilistaNome: string | null; categoriaNome: string | null; onOpen: () => void; draggable: boolean;
  dragging?: boolean; onDragStartCard?: () => void; onDragEndCard?: () => void;
}) {
```
por:
```tsx
function KanbanCard({ modelo, moEstado, estilistaNome, categoriaNome, onOpen, draggable: isDraggable, dragging, onDragStartCard, onDragEndCard, auto }: {
  modelo: Modelo; moEstado?: string; estilistaNome: string | null; categoriaNome: string | null; onOpen: () => void; draggable: boolean;
  dragging?: boolean; onDragStartCard?: () => void; onDragEndCard?: () => void;
  auto?: { fixado: boolean; proxima: string | null };
}) {
```
No `<div` raiz do `KanbanCard` (o que tem `draggable={isDraggable}`), acrescentar `data-testid="kanban-card"` logo antes de `draggable={isDraggable}`; e trocar `          <MaoObraBadge estado={moEstado} />` (dentro do `KanbanCard`) por:
```tsx
          <MaoObraBadge estado={moEstado} />
          <CardAutoInfo auto={auto} />
```

Logo ANTES de `function MobileCard(`, inserir os 2 componentes:
```tsx
// Kanban automático (F2): ícone do modo da coluna (Zap = automática/entrada; Hand = manual). Nunca emoji.
function ModoColunaIcone({ modo, testId = "kanban-col-modo" }: { modo: ModoColuna; testId?: string }) {
  const manual = modo === "manual" || modo === "manual_sempre";
  const Icon = manual ? Hand : Zap;
  return (
    <span data-testid={testId} title={rotuloModoColuna(modo)} aria-label={rotuloModoColuna(modo)} className="inline-flex shrink-0 text-muted-foreground">
      <Icon className="h-3.5 w-3.5" />
    </span>
  );
}

// Kanban automático (F2): card FIXADO numa coluna manual (não anda sozinho) ou a PRÓXIMA falta do card automático.
function CardAutoInfo({ auto }: { auto?: { fixado: boolean; proxima: string | null } }) {
  if (!auto) return null;
  if (auto.fixado) {
    return (
      <StatusBadge tone="neutral" data-testid="kanban-card-fixado" className="mt-0.5 gap-1 normal-case tracking-normal">
        <Pin className="h-3 w-3" />fixado — não anda sozinho
      </StatusBadge>
    );
  }
  if (!auto.proxima) return null;
  return (
    <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-muted-foreground">
      <ArrowRight className="h-3 w-3 shrink-0" />próx.: {auto.proxima}
    </p>
  );
}
```

- [ ] **Step 9: Verificar (inclui "chave desligada = hoje")**

Run:
```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp"
npm run build 2>&1 | tail -3
npx tsc --noEmit 2>&1 | grep -c "error TS"
npx vitest run --no-file-parallelism tests/unit 2>&1 | tail -4
npx vitest run tests/unit/ui-padroes-antidrift.test.ts 2>&1 | grep "criacao.desenvolvimento" ; true
git diff -U0 -- src/routes/_authenticated/criacao.desenvolvimento.tsx | grep -E "^-" | grep -v "^---" 
```
Expected: build ok; `0`; só as 2 falhas pré-existentes; grep do anti-drift vazio. O último comando lista as linhas REMOVIDAS: devem ser só as substituídas acima (import do lucide, `condicoesMap`, `draggable={editable}`, a `renderMobileCard` antiga, o bloco das colunas, as 2 assinaturas, `MaoObraBadge` ×2, `SelectItem`, `ModeloDetailPanel`, a linha do acordeão) — e cada comportamento antigo precisa reaparecer, literal, no ramo `!kanbanAuto` (conferir à mão: faixa "Não pode entrar aqui. Faltam:", `pointer-events-none`, toast "Não pode entrar aqui. Faltam:", `updateStatus.mutate`).

- [ ] **Step 10: Commit**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp"
git diff --name-only savepoint-pre-unificacao-2026-09-22 -- src/components/desenvolvimento/ src/components/producao/cad/CadTecidosSection.tsx
git commit --only -m "feat(kanban-auto): F2 — board do Desenvolvimento com a chave ligada (tabela única de arraste, kanban_mover, ícones, faixa, Mover para…)

Chave desligada = caminho de hoje (podeEntrar + updateStatus), literal.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- src/routes/_authenticated/criacao.desenvolvimento.tsx
git show --stat HEAD | tail -n +7
```

---

### Task 6: Config — RP3 (kanban fora do upsert + conflito), etiquetas por coluna e Reprovado travado

**Files:**
- Create: `src/components/admin/ModoColunaBadge.tsx`
- Modify: `src/components/admin/RequisitosStatusDialog.tsx` (props + early return depois dos hooks l. 52–53); `src/routes/_authenticated/admin/configuracoes.tsx` (imports; estado depois de `useUnsavedGuard` l. 176; efeito l. 253–254; `save` l. 257–291; variáveis antes do `return (` l. ~309; `renderItemExtra` l. 379–436; `footer` l. 454–481; `FluxoRevendaCard` uso l. 489–499 e definição l. 1162–1266; botão Salvar l. 646–649; função auxiliar no nível do módulo)

**Interfaces:**
- Consumes: `KANBAN_COLS`, `pickKanban`, `diffKanban`, `conflitoKanban`, `separarPayloadKanban`, `mensagemConflitoKanban`, `KanbanColsValor` (Task 2); `modoColuna`, `rotuloModoColuna`, `descricaoModoColuna`, `MOTIVO_REPROVADO_MANUAL`, `ModoColuna` (Task 1); `boardDaLoja`, `fluxoDoModelo`, `lerKanbanAutoConfig` (F1).
- Produces: `ModoColunaBadge({ modo: ModoColuna | null })` (`data-testid="modo-coluna-<modo>"`); `RequisitosStatusButton` ganha `bloqueadoMotivo?: string` (`data-testid="requisitos-bloqueado"`); na Config: `prepararSalvar()` (Task 7 a substitui), `lerConfigServidor(tenantId)`, estado `kanbanBase`/`preparandoSalvar`.
- **Não depende da F1** (o `update` das colunas de kanban funciona no banco de hoje; a trava da chave da F1 já protege `kanban_automatico` — que nunca esteve no `cfg`).

- [ ] **Step 1: `ModoColunaBadge`**

Criar `src/components/admin/ModoColunaBadge.tsx`:
```tsx
import { ArrowRight, Hand, Zap } from "lucide-react";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { descricaoModoColuna, rotuloModoColuna, type ModoColuna } from "@/lib/kanban-auto-ui";

/** Etiqueta Entrada / Automática / Manual / Manual (sempre) de uma coluna do kanban (Config da Loja — F2). */
export function ModoColunaBadge({ modo }: { modo: ModoColuna | null }) {
  if (!modo) return null;
  const Icon = modo === "entrada" ? ArrowRight : modo === "automatica" ? Zap : Hand;
  return (
    <StatusBadge
      tone={modo === "entrada" || modo === "automatica" ? "info" : "neutral"}
      data-testid={`modo-coluna-${modo}`}
      title={descricaoModoColuna(modo)}
      className="shrink-0 gap-1 normal-case tracking-normal"
    >
      <Icon className="h-3 w-3" />
      {rotuloModoColuna(modo)}
    </StatusBadge>
  );
}
```

- [ ] **Step 2: Reprovado travado no `RequisitosStatusButton`**

Em `src/components/admin/RequisitosStatusDialog.tsx`:

(a) na desestruturação, trocar `  nomeEtapa,\n}: {` por:
```tsx
  nomeEtapa,
  bloqueadoMotivo,
}: {
```
e no tipo, trocar `  nomeEtapa?: (statusKey: string) => string;\n}) {` por:
```tsx
  nomeEtapa?: (statusKey: string) => string;
  // Kanban automático (F2): coluna em que requisito NÃO vale (Reprovado é sempre manual) → botão travado + motivo.
  bloqueadoMotivo?: string;
}) {
```

(b) logo DEPOIS da linha `  const [confirmarExcecao, setConfirmarExcecao] = useState<{ key: string; label: string } | null>(null);` inserir:
```tsx
  if (bloqueadoMotivo) {
    return (
      <span title={bloqueadoMotivo} className="inline-flex" data-testid="requisitos-bloqueado">
        <Button type="button" variant="outline" size="sm" disabled className="h-8 shrink-0 max-md:h-11 max-md:w-11 max-md:p-0" aria-label={`Requisitos — ${bloqueadoMotivo}`}>
          <ListChecks className="h-4 w-4 sm:mr-1" />
          <span className="max-sm:sr-only">Requisitos</span>
        </Button>
      </span>
    );
  }
```

- [ ] **Step 3: Config — imports, estado, efeito e leitura crua do banco**

Em `src/routes/_authenticated/admin/configuracoes.tsx`:

(a) trocar a linha 4 `import { Settings, Plus, GripVertical, Trash2, Save, Loader2, ArrowLeft, Send, Tag } from "lucide-react";` por:
```ts
import { Settings, Plus, GripVertical, Trash2, Save, Loader2, ArrowLeft, Send, Tag, Hand, Zap } from "lucide-react";
```
e logo depois de `import { FormatoRefCard } from "@/components/configuracoes/FormatoRefCard";` inserir:
```ts
import { ModoColunaBadge } from "@/components/admin/ModoColunaBadge";
import { boardDaLoja, fluxoDoModelo, lerKanbanAutoConfig } from "@/lib/kanban-auto";
import { modoColuna, MOTIVO_REPROVADO_MANUAL } from "@/lib/kanban-auto-ui";
import {
  conflitoKanban, diffKanban, mensagemConflitoKanban, pickKanban, separarPayloadKanban, type KanbanColsValor,
} from "@/lib/kanban-auto-config";
```

(b) no nível do MÓDULO, logo antes de `function ConfiguracoesLojaPage() {`, inserir:
```ts
// Linha CRUA de tenant_config (RP3: conferir, antes de gravar o kanban, que ninguém o mudou depois que a tela abriu).
async function lerConfigServidor(tenantId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase.from("tenant_config").select("*").eq("tenant_id", tenantId).maybeSingle();
  if (error) throw error;
  return (data ?? null) as Record<string, unknown> | null;
}
```

(c) logo depois de `  const { confirm } = useUnsavedGuard({ dirty, blockNav: true });` inserir:
```ts
  // RP3 (guardião): as 5 colunas de kanban NÃO vão no upsert genérico. `cfg` = como a TELA abriu (base do diff
  // do que o usuário mexeu); `servidor` = valor CRU lido do banco (p/ detectar outra aba/admin que mudou depois).
  const [kanbanBase, setKanbanBase] = useState<{ cfg: KanbanColsValor; servidor: KanbanColsValor }>(() => ({
    cfg: pickKanban(DEFAULTS),
    servidor: pickKanban(null),
  }));
  const [preparandoSalvar, setPreparandoSalvar] = useState(false);
```

(d) no `useEffect(() => { if (!data?.cfg) return; … }, [data?.cfg]);`, trocar:
```ts
    setCfg(next);
    resetCfgBaseline(next);
```
por:
```ts
    setCfg(next);
    resetCfgBaseline(next);
    setKanbanBase({ cfg: pickKanban(next), servidor: pickKanban(r) });
```

- [ ] **Step 4: Config — save com kanban fora do upsert**

Substituir o `mutationFn` e o `onSuccess` do `const save = useMutation({` (l. 257–289) por:
```ts
    mutationFn: async () => {
      if (!data?.tenantId) throw new Error("Loja não identificada para este usuário.");
      // campos_editaveis (janela Nomenclaturas), tamanhos_grade e etapas_acabamento
      // (agora em Cadastro > Atributos) NÃO são salvos aqui, p/ não sobrescrever o que
      // foi editado nesses outros lugares.
      const { campos_editaveis: _ce, tamanhos_grade: _tg, etapas_acabamento: _ea, ...cfgRest } = cfg;
      // ref_config "vazio" (usuário não marcou nenhuma parte da montagem) → null, mesmo
      // espírito do "" → null abaixo: sem configuração explícita, a loja usa o comportamento
      // HISTÓRICO (fallback derivado no banco), sem gravar um objeto vazio/inerte.
      const refConfigVazio = !cfg.ref_config || !Array.isArray(cfg.ref_config.partes) || cfg.ref_config.partes.length === 0;
      // "" (Aprovado / ausência) → null, p/ manter o default histórico sem gravar valor.
      const payload = {
        tenant_id: data.tenantId, ...cfgRest,
        explosao_envio_status: cfg.explosao_envio_status || null,
        ref_exibir_status: cfg.ref_exibir_status || null,
        ref_config: refConfigVazio ? null : cfg.ref_config,
      };
      // RP3: as colunas de kanban SAEM do upsert genérico (uma aba velha regravaria requisitos/ordem de outro
      // admin e, com a chave ligada, o gatilho recalcularia a loja sem prévia). Vão SÓ as que o usuário mudou,
      // num UPDATE próprio, depois de conferir que o banco ainda tem o que esta tela carregou.
      // ORDEM (R3 do G-plano): 1) conflito (nada gravado se houver) → 2) upsert do geral → 3) kanban POR ÚLTIMO.
      // Se o geral falhar, o kanban não foi gravado: o retry não acusa "Outra pessoa mudou…" contra a própria
      // gravação e, com a chave ligada, nenhum card se move com a tela mostrando erro. O upsert também garante
      // a linha de tenant_config antes do UPDATE (sem linha, o UPDATE afetaria 0 linhas calado).
      const { geral } = separarPayloadKanban(payload);
      const diff = diffKanban(kanbanBase.cfg, pickKanban(cfg));
      const temKanban = Object.keys(diff).length > 0;
      if (temKanban) {
        const conflito = conflitoKanban(kanbanBase.servidor, await lerConfigServidor(data.tenantId));
        if (conflito.length > 0) throw new Error(mensagemConflitoKanban(conflito));
      }
      const { error } = await supabase
        .from("tenant_config")
        .upsert(geral as any, { onConflict: "tenant_id" });
      if (error) throw error;
      if (temKanban) {
        const { data: gravadas, error: errKanban } = await supabase
          .from("tenant_config")
          .update(diff as any)
          .eq("tenant_id", data.tenantId)
          .select("tenant_id");
        if (errKanban) throw errKanban;
        if (!gravadas || gravadas.length === 0) {
          throw new Error("As colunas do kanban não foram gravadas (configuração da loja não encontrada). Recarregue a página e tente de novo.");
        }
      }
      return diff;
    },
    onSuccess: (diff) => {
      toast.success("Configurações salvas");
      markClean();
      // O que gravamos vira a nova base (o refetch abaixo também a refaz pelo efeito quando o dado muda). O kanban
      // é a ÚLTIMA escrita do mutationFn (R3): chegar aqui = geral E kanban gravados.
      setKanbanBase((b) => ({ cfg: pickKanban(cfg), servidor: { ...b.servidor, ...diff } }));
      // Invalida TODA leitura de config para refletir na hora. As leituras usam prefixos
      // divergentes (tenant_config, tenant-config-grade, cad-tenant-config-grade,
      // tenant-status-kanban, ft-tamanhos, confeccao-prioridade…), então casamos por
      // predicate. Fonte única = realtime-invalidation-map (mesmo predicate do hook global
      // useRealtimeInvalidation), p/ o save local e o eco Realtime baterem 1:1.
      qc.invalidateQueries({ predicate: (q) => matchesTable("tenant_config", q.queryKey) });
    },
```
(o `onError` fica como está).

Logo depois do fechamento `});` do `save`, inserir:
```ts
  // Salvar: com mudança nas colunas de kanban, confere o conflito ANTES de pedir a confirmação.
  // (A Task 7 troca esta função pela versão que abre a prévia "Salvar e mover N cards" com a chave ligada.)
  const prepararSalvar = async () => {
    const diff = diffKanban(kanbanBase.cfg, pickKanban(cfg));
    if (!data?.tenantId || Object.keys(diff).length === 0) { setConfirmSalvar(true); return; }
    setPreparandoSalvar(true);
    try {
      const conflito = conflitoKanban(kanbanBase.servidor, await lerConfigServidor(data.tenantId));
      if (conflito.length > 0) { toast.error(mensagemConflitoKanban(conflito)); return; }
      setConfirmSalvar(true);
    } catch (e) {
      toast.error(mensagemErro(e, "Erro ao preparar o salvamento"));
    } finally {
      setPreparandoSalvar(false);
    }
  };
```

No botão Salvar do `PageActionBar`, trocar:
```tsx
        <Button className="ml-auto" onClick={() => setConfirmSalvar(true)} disabled={save.isPending || isLoading}>
```
por:
```tsx
        <Button className="ml-auto" onClick={prepararSalvar} disabled={save.isPending || isLoading || preparandoSalvar}>
```

- [ ] **Step 5: Config — etiquetas por coluna, Reprovado travado, rodapés**

(a) logo depois de `  const refOrphan = !explosaoOptionKeys.has(refEffectiveKey);` inserir:
```ts
  // Etiqueta Entrada/Automática/Manual por coluna (F2) — mesma regra do motor (`colunaManual`): sem requisito
  // PRÓPRIO = manual; Reprovado sempre manual; 1ª coluna = Entrada. Reflete o que está NA TELA (não salvo ainda).
  const kanbanCfgTela = lerKanbanAutoConfig(cfg);
  const boardKeysTela = boardDaLoja(kanbanCfgTela).map((c) => c.key);
  const fluxoRevendaTela = fluxoDoModelo("revenda", kanbanCfgTela).map((c) => c.key);
```

(b) em `renderItemExtra`, trocar o início do fragmento:
```tsx
          return (
            <>
              <RequisitosStatusButton
                label={label}
                requisitos={cfg.kanban_requisitos?.[key] ?? []}
```
por:
```tsx
          return (
            <>
              <ModoColunaBadge modo={modoColuna(key, boardKeysTela, cfg.kanban_requisitos ?? {})} />
              <RequisitosStatusButton
                label={label}
                bloqueadoMotivo={key === "reprovado" ? MOTIVO_REPROVADO_MANUAL : undefined}
                requisitos={cfg.kanban_requisitos?.[key] ?? []}
```

(c) no `footer` do card "Status do Kanban", logo antes do `</div>` que fecha `<div className="space-y-1.5 border-t pt-3">`, inserir:
```tsx
            <p className="text-xs text-foreground">
              <Hand className="mr-1 inline h-3.5 w-3.5 align-text-bottom" />
              Coluna sem requisito é manual: o card só entra e sai dela arrastado. Reprovado é sempre manual.
            </p>
```

(d) no uso de `<FluxoRevendaCard`, acrescentar a prop `fluxoKeys={fluxoRevendaTela}` logo depois de `statusKanban={cfg.status_kanban}`.

(e) na definição de `FluxoRevendaCard`, trocar:
```tsx
function FluxoRevendaCard({
  statusKanban,
  colunas,
```
por:
```tsx
function FluxoRevendaCard({
  statusKanban,
  fluxoKeys,
  colunas,
```
e no tipo, trocar `  statusKanban: string[];\n  colunas: string[];` por:
```tsx
  statusKanban: string[];
  // Keys do fluxo da revenda (board ∩ colunas; [] = todas) — base da etiqueta Entrada/Automática/Manual.
  fluxoKeys: string[];
  colunas: string[];
```

(f) no `<li>` de cada coluna do `FluxoRevendaCard`, trocar:
```tsx
                    {on && (
                      <RequisitosStatusButton
                        label={label}
                        requisitos={requisitos[key] ?? []}
                        onChange={(next) => setRequisitos(key, next)}
                        condsIndisponiveis={REVENDA_COND_NA}
                      />
                    )}
```
por:
```tsx
                    {(on || semTrava) && <ModoColunaBadge modo={modoColuna(key, fluxoKeys, requisitos)} />}
                    {!on && !semTrava && <span className="shrink-0 text-xs text-muted-foreground">revenda não passa</span>}
                    {on && (
                      <RequisitosStatusButton
                        label={label}
                        requisitos={requisitos[key] ?? []}
                        onChange={(next) => setRequisitos(key, next)}
                        condsIndisponiveis={REVENDA_COND_NA}
                        bloqueadoMotivo={key === "reprovado" ? MOTIVO_REPROVADO_MANUAL : undefined}
                      />
                    )}
```

(g) logo depois do `</ul>` que fecha a lista de colunas do `FluxoRevendaCard` (o que vem depois do `{statusKanban.length === 0 && (…)}`), inserir:
```tsx
          <p className="flex gap-1.5 text-xs text-muted-foreground">
            <Zap className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Com o kanban automático ligado, a revenda anda sozinha só pelas colunas ligadas aqui, também em cascata.
          </p>
```

- [ ] **Step 6: Verificar**

Run:
```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp"
npm run build 2>&1 | tail -3
npx tsc --noEmit 2>&1 | grep -c "error TS"
npx vitest run --no-file-parallelism tests/unit 2>&1 | tail -4
npx vitest run tests/unit/ui-padroes-antidrift.test.ts 2>&1 | grep -E "configuracoes|ModoColuna|RequisitosStatus" ; true
grep -n "\.\.\.cfgRest" src/routes/_authenticated/admin/configuracoes.tsx
grep -n "upsert(" src/routes/_authenticated/admin/configuracoes.tsx
```
Expected: build ok; `0`; só as 2 falhas pré-existentes; anti-drift vazio; `...cfgRest` só dentro de `payload`; o `upsert(` do save grava `geral` (o 2º `upsert(` é o das Nomenclaturas, que não toca kanban); no `mutationFn`, o `update(diff` vem DEPOIS do `upsert(geral` (R3) — conferir com `grep -n "upsert(geral\|update(diff" src/routes/_authenticated/admin/configuracoes.tsx` (a linha do `upsert(geral` é MENOR que a do `update(diff`).

- [ ] **Step 7: Commit**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp"
git add -- src/components/admin/ModoColunaBadge.tsx
git commit --only -m "feat(kanban-auto): F2 — Config grava o kanban fora do upsert genérico (RP3: só o que mudou + conflito), etiquetas por coluna e Reprovado travado

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- src/components/admin/ModoColunaBadge.tsx src/components/admin/RequisitosStatusDialog.tsx src/routes/_authenticated/admin/configuracoes.tsx
git show --stat HEAD | tail -n +7
```

---

### Task 7: Chave "Kanban automático" — Ligar com prévia, Desligar com restaurar, "Salvar e mover N cards"

**Files:**
- Create: `src/components/admin/KanbanAutomaticoDialog.tsx`
- Modify: `src/routes/_authenticated/admin/configuracoes.tsx` (imports; estado; `prepararSalvar` da Task 6; `onSuccess` do save; `SortableListCard` (definição l. 966–1071 + uso l. 368); render do diálogo de salvar)

**Interfaces:**
- Consumes: `kanbanPreviaRecalculo`, `kanbanDefinirAutomatico`, `kanbanPreviaRestauracao`, `kanbanRestaurar` (Task 3); `labelDaColuna`, `labelsCondicoes`, `motorKanbanDisponivel`, `PreviaRecalculo`, `PreviaRestauracao` (Task 1); `agruparMovimentos`, `resumirFixados`, `avisosRestauracaoVisiveis`, `formatarDataHora`, `nCards`, `descreverMudancasKanban`, `KanbanCol` (Task 2); `mensagemErro` (Task 3).
- Produces: `KanbanAutomaticoBloco({ ligado: boolean; disponivel: boolean; travadoMotivo: string | null; cols: KanbanStatus[]; timezone: string; onMudou: () => void })` (`data-testid="kanban-auto-bloco"`, switch `data-testid="kanban-auto-switch"`); `KanbanSalvarDialog({ previa: PreviaRecalculo; cols: KanbanStatus[]; mudancas: string; salvando: boolean; onConfirmar: () => void; onClose: () => void })`.
- **Depende da F1:** migrations 1 (coluna) e 4 (RPCs) APLICADAS para o switch habilitar e os diálogos funcionarem. Antes disso o switch fica desabilitado ("aguarda a atualização do banco") e o save nunca abre a prévia (a chave lida do banco é `undefined` ⇒ desligada).

- [ ] **Step 1: Criar `src/components/admin/KanbanAutomaticoDialog.tsx`**

```tsx
import { Fragment, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, ArrowRight, Hand, Loader2, Save, Tag, Undo2, Zap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { mensagemErro } from "@/lib/erro-mensagem";
import type { KanbanStatus } from "@/lib/kanban-status";
import { labelDaColuna, labelsCondicoes, type PreviaRecalculo, type PreviaRestauracao } from "@/lib/kanban-auto-ui";
import { agruparMovimentos, avisosRestauracaoVisiveis, formatarDataHora, nCards, resumirFixados } from "@/lib/kanban-auto-config";
import { kanbanDefinirAutomatico, kanbanPreviaRecalculo, kanbanPreviaRestauracao, kanbanRestaurar } from "@/lib/kanban-auto-rpc";

/**
 * KANBAN AUTOMÁTICO — F2, Config da Loja.
 *  - `KanbanAutomaticoBloco`: o switch da chave (controlado pelo valor do BANCO; mexer abre o diálogo).
 *  - Ligar: prévia (`kanban_previa_recalculo({kanban_automatico:true})`) → "Ligar e mover N cards" →
 *    `kanban_definir_automatico(true)` (a F1 grava o lote p/ desfazer e recalcula na mesma transação).
 *  - Desligar: prévia de restauração (lote NULL = o último 'ligar') → opcional "Restaurar as colunas de antes"
 *    → `kanban_definir_automatico(false)` e, se marcado, `kanban_restaurar(lote)` (exige a chave desligada).
 *  - `KanbanSalvarDialog`: "Salvar e mover N cards" ao salvar requisitos/ordem com a chave ligada.
 * A F1 não confere se a prévia foi vista (D19): a garantia "prévia antes de confirmar" é ESTE arquivo.
 */

const RODAPE = "border-t bg-background -mx-4 sm:-mx-6 -mb-4 sm:-mb-6 px-4 sm:px-6 py-3 flex-row flex-wrap items-center gap-2";

function PreviaMovimentos({ previa, cols }: { previa: PreviaRecalculo; cols: KanbanStatus[] }) {
  const ordem = cols.map((c) => c.key);
  const grupos = agruparMovimentos(previa.cards, ordem);
  const fixados = resumirFixados(previa.cards_fixados, ordem);
  const lbl = (k: string | null) => labelDaColuna(k, cols);
  return (
    <div className="space-y-3">
      {grupos.length > 0 && (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm" data-testid="kanban-previa-tabela">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">De</th>
                <th aria-hidden className="w-6" />
                <th className="px-3 py-2 text-left font-medium">Para</th>
                <th className="px-3 py-2 text-right font-medium">Cards</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {grupos.map((g) => (
                <Fragment key={`${g.de ?? ""}→${g.para ?? ""}`}>
                  <tr className="border-t">
                    <td className="px-3 py-2">{lbl(g.de)}</td>
                    <td className="px-1 py-2 text-muted-foreground"><ArrowRight className="h-3.5 w-3.5" /></td>
                    <td className="px-3 py-2">{lbl(g.para)}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{g.cards.length}</td>
                    <td className="px-3 py-2 text-right">
                      <StatusBadge tone={g.recua ? "warning" : "success"} className="normal-case tracking-normal">{g.recua ? "voltam" : "avançam"}</StatusBadge>
                    </td>
                  </tr>
                  {g.recua && (
                    <tr className="bg-muted/40">
                      <td colSpan={5} className="px-3 py-2">
                        <ul className="space-y-0.5 text-xs">
                          {g.cards.map((c) => (
                            <li key={c.modelo_id}>
                              {c.nome ?? "Sem nome"} {c.ref && <span className="font-mono text-muted-foreground">{c.ref}</span>}
                              {c.faltando.length > 0 && <span className="text-muted-foreground"> — falta {labelsCondicoes(c.faltando).join(", ")}</span>}
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              <tr className="border-t font-semibold">
                <td colSpan={3} className="px-3 py-2">Total</td>
                <td className="px-3 py-2 text-right tabular-nums">{previa.mudam}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {fixados.length > 0 && (
        <div className="flex gap-2 rounded-md bg-[var(--tone-warning-bg)] px-3 py-2 text-sm text-[var(--tone-warning-fg)]">
          <Hand className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <span className="font-semibold">{nCards(previa.fixados)} {previa.fixados === 1 ? "fica onde está" : "ficam onde estão"}</span>, em colunas
            manuais ({fixados.map((f) => `${lbl(f.coluna)} ${f.n}`).join(" · ")}), até alguém tirar.
          </span>
        </div>
      )}
      {previa.refs_reveladas.length > 0 && (
        <div className="space-y-1 rounded-md border px-3 py-2 text-sm" data-testid="kanban-previa-refs">
          <p className="flex items-center gap-1.5 font-medium">
            <Tag className="h-4 w-4" />
            {previa.revelam_ref === 1 ? "1 REF será revelada" : `${previa.revelam_ref} REFs serão reveladas`}
          </p>
          <ul className="max-h-32 space-y-0.5 overflow-y-auto text-xs">
            {previa.refs_reveladas.map((r) => (
              <li key={r.modelo_id}>
                {r.nome ?? "Sem nome"} <span className="font-mono text-muted-foreground">{r.ref_auto}</span>
                <span className="text-muted-foreground"> — etapa {lbl(r.posicao_derivada)}</span>
              </li>
            ))}
          </ul>
          {previa.avisos.map((a) => (
            <p key={a} className="text-xs text-[var(--tone-warning-fg)]">{a}</p>
          ))}
        </div>
      )}
    </div>
  );
}

function RestaurarOpcao({ previa, cols, timezone, restaurar, onRestaurar }: {
  previa: PreviaRestauracao; cols: KanbanStatus[]; timezone: string; restaurar: boolean; onRestaurar: (v: boolean) => void;
}) {
  const [verLista, setVerLista] = useState(false);
  const avisos = avisosRestauracaoVisiveis(previa.avisos);
  if (!previa.lote_id) {
    return <p className="text-sm text-muted-foreground">{avisos[0] ?? "Não há colunas guardadas para restaurar."}</p>;
  }
  const primeira = cols[0]?.key ?? null;
  return (
    <div className="flex items-start gap-3 rounded-md border p-3">
      <Checkbox id="kanban-restaurar" data-testid="kanban-restaurar-check" checked={restaurar} onCheckedChange={(v) => onRestaurar(!!v)} className="mt-0.5" />
      <div className="min-w-0 space-y-1">
        <label htmlFor="kanban-restaurar" className="cursor-pointer text-sm font-medium">Restaurar as colunas de antes de ligar</label>
        <p className="text-xs text-muted-foreground">
          Guardadas em {formatarDataHora(previa.criado_at, timezone)} · <span className="font-medium text-foreground">{nCards(previa.voltam)}</span>{" "}
          {previa.voltam === 1 ? "voltaria" : "voltariam"} de coluna
          {previa.voltam > 0 && (
            <>
              {" · "}
              <button type="button" className="font-semibold text-primary underline-offset-2 hover:underline" onClick={() => setVerLista((v) => !v)}>
                {verLista ? "esconder lista" : "ver lista"}
              </button>
            </>
          )}
        </p>
        {avisos.map((a) => (
          <p key={a} className="text-xs text-muted-foreground">{a}</p>
        ))}
        {previa.voltam > 0 && (
          <p className="flex items-center gap-1 text-xs text-[var(--tone-warning-fg)]">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            Desfaz também os avanços feitos depois dessa data
            {previa.movidos_depois > 0
              ? ` (${nCards(previa.movidos_depois)} ${previa.movidos_depois === 1 ? "foi movido" : "foram movidos"} à mão depois).`
              : "."}
          </p>
        )}
        {verLista && (
          <ul className="max-h-40 space-y-0.5 overflow-y-auto text-xs" data-testid="kanban-restaurar-lista">
            {previa.cards.map((c) => (
              <li key={c.modelo_id}>
                {c.nome ?? "Sem nome"} {c.ref && <span className="font-mono text-muted-foreground">{c.ref}</span>}
                <span className="text-muted-foreground">
                  {" "}— {labelDaColuna(c.de ?? primeira, cols)} → {labelDaColuna(c.para ?? primeira, cols)}
                  {c.movido_manual_depois ? " (movido à mão depois)" : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function KanbanChaveDialog({ modo, cols, timezone, onClose, onMudou }: {
  modo: "ligar" | "desligar"; cols: KanbanStatus[]; timezone: string; onClose: () => void; onMudou: () => void;
}) {
  const [restaurar, setRestaurar] = useState(false);
  const prevLigar = useQuery({
    queryKey: ["kanban-previa-ligar"],
    enabled: modo === "ligar",
    staleTime: 0, gcTime: 0, retry: false, refetchOnWindowFocus: false,
    queryFn: () => kanbanPreviaRecalculo({ kanban_automatico: true }),
  });
  const prevDesligar = useQuery({
    queryKey: ["kanban-previa-restauracao"],
    enabled: modo === "desligar",
    staleTime: 0, gcTime: 0, retry: false, refetchOnWindowFocus: false,
    queryFn: () => kanbanPreviaRestauracao(null),
  });
  const ligar = useMutation({
    mutationFn: () => kanbanDefinirAutomatico(true),
    onSuccess: (r) => {
      toast.success(r.mudou
        ? `Kanban automático ligado — ${nCards(r.cards_movidos)} ${r.cards_movidos === 1 ? "mudou" : "mudaram"} de coluna.`
        : "O Kanban automático já estava ligado.");
      onMudou();
      onClose();
    },
    onError: (e) => toast.error(mensagemErro(e, "Erro ao ligar o Kanban automático.")),
  });
  const desligar = useMutation({
    mutationFn: async () => {
      await kanbanDefinirAutomatico(false);
      const lote = prevDesligar.data?.lote_id ?? null;
      if (!restaurar || !lote) return { restaurados: null as number | null, erroRestaurar: null as string | null };
      try {
        const rr = await kanbanRestaurar(lote);
        return { restaurados: rr.restaurados, erroRestaurar: null };
      } catch (e) {
        return { restaurados: null, erroRestaurar: mensagemErro(e, "Erro ao restaurar as colunas.") };
      }
    },
    onSuccess: (r) => {
      if (r.erroRestaurar) toast.error(`O Kanban automático foi desligado, mas as colunas não foram restauradas: ${r.erroRestaurar}`);
      else if (r.restaurados != null) toast.success(`Kanban automático desligado. ${nCards(r.restaurados)} ${r.restaurados === 1 ? "voltou" : "voltaram"} às colunas de antes.`);
      else toast.success("Kanban automático desligado. Os cards ficaram onde estavam.");
      onMudou();
      onClose();
    },
    onError: (e) => toast.error(mensagemErro(e, "Erro ao desligar o Kanban automático.")),
  });
  const pendente = ligar.isPending || desligar.isPending;
  const q = modo === "ligar" ? prevLigar : prevDesligar;
  const mudam = prevLigar.data?.mudam ?? 0;
  const descricao = modo === "ligar"
    ? prevLigar.data
      ? mudam > 0
        ? `Com os requisitos atuais, ${nCards(mudam)} ${mudam === 1 ? "muda" : "mudam"} de coluna agora. Depois disso, os cards andam sozinhos conforme os campos salvos.`
        : "Com os requisitos atuais, nenhum card muda de coluna agora. Depois disso, os cards andam sozinhos conforme os campos salvos."
      : "Os cards passam a andar sozinhos entre as colunas conforme os campos salvos."
    : "Os cards param onde estão e o kanban volta a funcionar como hoje: mudança de coluna à mão (arraste ou “Status no fluxo”) com a trava de requisitos, e volta automática só em alguns casos (mão de obra reprovada, CQ desmarcado, envio desfeito).";
  const rotulo = modo === "ligar"
    ? mudam > 0 ? `Ligar e mover ${nCards(mudam)}` : "Ligar"
    : restaurar && prevDesligar.data?.lote_id ? "Desligar e restaurar" : "Desligar";
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !pendente) onClose(); }}>
      <DialogContent fixedFooter mobileFull className="max-w-2xl" data-testid={`kanban-dialogo-${modo}`}>
        <DialogHeader>
          <DialogTitle>{modo === "ligar" ? "Ligar o kanban automático?" : "Desligar o kanban automático?"}</DialogTitle>
          <DialogDescription>{descricao}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          {q.isLoading && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Calculando a prévia…</p>
          )}
          {q.isError && <p className="text-sm text-destructive">{mensagemErro(q.error, "Erro ao calcular a prévia.")}</p>}
          {modo === "ligar" && prevLigar.data && (
            <>
              <PreviaMovimentos previa={prevLigar.data} cols={cols} />
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Undo2 className="h-3.5 w-3.5 shrink-0" />As colunas de hoje ficam guardadas: ao desligar, dá para voltar a elas.
              </p>
            </>
          )}
          {modo === "desligar" && prevDesligar.data && (
            <RestaurarOpcao previa={prevDesligar.data} cols={cols} timezone={timezone} restaurar={restaurar} onRestaurar={setRestaurar} />
          )}
        </DialogBody>
        <DialogFooter className={RODAPE}>
          <Button variant="outline" onClick={onClose} disabled={pendente}><ArrowLeft className="mr-1 h-4 w-4" />Voltar</Button>
          <Button
            className="ml-auto"
            data-testid="kanban-dialogo-confirmar"
            disabled={pendente || !q.isSuccess}
            onClick={() => (modo === "ligar" ? ligar.mutate() : desligar.mutate())}
          >
            {pendente ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : modo === "ligar" ? <Zap className="mr-1 h-4 w-4" /> : null}
            {rotulo}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Switch "Kanban automático" (topo do card "Status do Kanban" da Config). */
export function KanbanAutomaticoBloco({ ligado, disponivel, travadoMotivo, cols, timezone, onMudou }: {
  ligado: boolean;
  disponivel: boolean;
  travadoMotivo: string | null;
  cols: KanbanStatus[];
  timezone: string;
  onMudou: () => void;
}) {
  const [dialogo, setDialogo] = useState<null | "ligar" | "desligar">(null);
  return (
    <div data-testid="kanban-auto-bloco" className="flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
      <Switch
        data-testid="kanban-auto-switch"
        checked={ligado}
        disabled={!disponivel || !!travadoMotivo}
        onCheckedChange={(v) => setDialogo(v ? "ligar" : "desligar")}
        aria-label="Kanban automático"
        className="mt-0.5"
      />
      <div className="min-w-0 space-y-1">
        <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
          <Zap className="h-4 w-4" />Kanban automático
          <StatusBadge tone={ligado ? "info" : "neutral"} className="normal-case tracking-normal">{ligado ? "ligado" : "desligado"}</StatusBadge>
        </p>
        <p className="text-sm text-muted-foreground">
          Ligado, os cards andam sozinhos entre as colunas conforme os campos salvos. Coluna{" "}
          <span className="font-semibold text-foreground">com requisito</span> = automática (em cascata: só entra quem cumpre esta e todas as
          anteriores). Coluna <span className="font-semibold text-foreground">sem requisito</span> = manual: o card entra e sai dela arrastado.
        </p>
        <p className="text-xs text-muted-foreground">
          Desligado: funciona como hoje — o card muda de coluna arrastado ou pelo “Status no fluxo”, com a trava de requisitos, e volta sozinho só
          em alguns casos (mão de obra reprovada, CQ desmarcado, envio desfeito).
        </p>
        {!disponivel && <p className="text-xs text-[var(--tone-warning-fg)]">Ainda não disponível nesta loja — aguarda a atualização do banco.</p>}
        {disponivel && travadoMotivo && <p className="text-xs text-[var(--tone-warning-fg)]">{travadoMotivo}</p>}
      </div>
      {dialogo && (
        <KanbanChaveDialog modo={dialogo} cols={cols} timezone={timezone} onClose={() => setDialogo(null)} onMudou={onMudou} />
      )}
    </div>
  );
}

/** "Salvar e mover N cards?" — salvar requisitos/ordem com a chave ligada (mockup "Prévia", 3º diálogo). */
export function KanbanSalvarDialog({ previa, cols, mudancas, salvando, onConfirmar, onClose }: {
  previa: PreviaRecalculo; cols: KanbanStatus[]; mudancas: string; salvando: boolean; onConfirmar: () => void; onClose: () => void;
}) {
  const titulo = previa.mudam > 0 ? `Salvar e mover ${nCards(previa.mudam)}?` : "Salvar as alterações do kanban?";
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !salvando) onClose(); }}>
      <DialogContent fixedFooter mobileFull className="max-w-2xl" data-testid="kanban-dialogo-salvar">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>
            Você mudou {mudancas}. Com o kanban automático ligado, os cards abaixo mudam de coluna ao salvar.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <PreviaMovimentos previa={previa} cols={cols} />
        </DialogBody>
        <DialogFooter className={RODAPE}>
          <Button variant="outline" onClick={onClose} disabled={salvando}><ArrowLeft className="mr-1 h-4 w-4" />Voltar</Button>
          <Button className="ml-auto" onClick={onConfirmar} disabled={salvando}>
            {salvando ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
            {previa.mudam > 0 ? `Salvar e mover ${nCards(previa.mudam)}` : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: `SortableListCard` ganha `topo`**

Em `configuracoes.tsx`, na definição de `SortableListCard`:
- trocar `  footer,\n}: {` (a desestruturação) por `  footer,\n  topo,\n}: {`;
- no tipo, trocar `  footer?: React.ReactNode;\n}) {` por:
```tsx
  footer?: React.ReactNode;
  // Conteúdo no TOPO do card, antes do campo de adicionar (Status do Kanban: a chave "Kanban automático").
  topo?: React.ReactNode;
}) {
```
- trocar `      <CardContent className="space-y-3">\n        <div className="flex gap-2">` por:
```tsx
      <CardContent className="space-y-3">
        {topo}
        <div className="flex gap-2">
```

- [ ] **Step 3: Config — prévia no salvar + chave**

(a) logo depois de `import { ModoColunaBadge } from "@/components/admin/ModoColunaBadge";` inserir:
```ts
import { KanbanAutomaticoBloco, KanbanSalvarDialog } from "@/components/admin/KanbanAutomaticoDialog";
import { kanbanPreviaRecalculo } from "@/lib/kanban-auto-rpc";
import { motorKanbanDisponivel, type PreviaRecalculo } from "@/lib/kanban-auto-ui";
import { descreverMudancasKanban, type KanbanCol } from "@/lib/kanban-auto-config";
```

(b) logo depois de `  const [preparandoSalvar, setPreparandoSalvar] = useState(false);` inserir:
```ts
  // "Salvar e mover N cards" (chave ligada + requisitos/ordem mudados): prévia calculada no clique de Salvar.
  const [previaSalvar, setPreviaSalvar] = useState<{ previa: PreviaRecalculo; mudancas: string } | null>(null);
```

(c) substituir a função `prepararSalvar` inteira (criada na Task 6) por:
```ts
  // Salvar: com mudança nas colunas de kanban, confere o conflito (RP3) e, com a chave LIGADA no banco, mostra a
  // prévia (`kanban_previa_recalculo` com SÓ o que mudou) antes de confirmar. Sem cards mudando nem REF revelada
  // → o AlertDialog de sempre. A F1 não confere se a prévia foi vista (D19) — a garantia é esta função.
  const prepararSalvar = async () => {
    const diff = diffKanban(kanbanBase.cfg, pickKanban(cfg));
    if (!data?.tenantId || Object.keys(diff).length === 0) { setConfirmSalvar(true); return; }
    setPreparandoSalvar(true);
    try {
      const row = await lerConfigServidor(data.tenantId);
      const conflito = conflitoKanban(kanbanBase.servidor, row);
      if (conflito.length > 0) { toast.error(mensagemConflitoKanban(conflito)); return; }
      if (row?.kanban_automatico !== true) { setConfirmSalvar(true); return; }
      const previa = await kanbanPreviaRecalculo(diff as Record<string, unknown>);
      if (previa.mudam === 0 && previa.revelam_ref === 0) { setConfirmSalvar(true); return; }
      setPreviaSalvar({ previa, mudancas: descreverMudancasKanban(Object.keys(diff) as KanbanCol[]) });
    } catch (e) {
      toast.error(mensagemErro(e, "Erro ao preparar o salvamento"));
    } finally {
      setPreparandoSalvar(false);
    }
  };
```

(d) no `onSuccess` do `save`, logo depois de `      markClean();` inserir:
```ts
      setPreviaSalvar(null);
```

(e) no uso de `<SortableListCard` do "Status do Kanban", logo depois de `        placeholder="Ex: Em Modelagem"` inserir:
```tsx
        topo={
          <KanbanAutomaticoBloco
            ligado={(data?.cfg as any)?.kanban_automatico === true}
            disponivel={motorKanbanDisponivel(data?.cfg) && (modules as any).criacao !== false}
            travadoMotivo={dirty ? "Salve ou descarte as alterações desta página antes de ligar ou desligar o Kanban automático." : null}
            cols={boardDaLoja(kanbanCfgTela)}
            timezone={cfg.timezone}
            onMudou={() => {
              qc.invalidateQueries({ predicate: (q) => matchesTable("tenant_config", q.queryKey) });
              qc.invalidateQueries({ queryKey: ["modelos-desenvolvimento"] });
              qc.invalidateQueries({ queryKey: ["modelos-planejamento"] });
            }}
          />
        }
```

(f) logo ANTES de `      {/* Confirmação: salvar config afeta dados de toda a loja. */}` inserir:
```tsx
      {previaSalvar && (
        <KanbanSalvarDialog
          previa={previaSalvar.previa}
          cols={boardDaLoja(kanbanCfgTela)}
          mudancas={previaSalvar.mudancas}
          salvando={save.isPending}
          onConfirmar={() => save.mutate()}
          onClose={() => setPreviaSalvar(null)}
        />
      )}
```

- [ ] **Step 4: Verificar**

Run:
```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp"
npm run build 2>&1 | tail -3
npx tsc --noEmit 2>&1 | grep -c "error TS"
npx vitest run --no-file-parallelism tests/unit 2>&1 | tail -4
npx vitest run tests/unit/ui-padroes-antidrift.test.ts 2>&1 | grep -E "KanbanAutomatico|configuracoes" ; true
```
Expected: build ok; `0`; só as 2 falhas pré-existentes; anti-drift vazio.

- [ ] **Step 5: Commit**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp"
git diff --name-only savepoint-pre-unificacao-2026-09-22 -- src/components/desenvolvimento/ src/components/producao/cad/CadTecidosSection.tsx
git add -- src/components/admin/KanbanAutomaticoDialog.tsx
git commit --only -m "feat(kanban-auto): F2 — chave Kanban automático na Config (ligar com prévia + REFs reveladas, desligar com restaurar, Salvar e mover N cards)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- src/components/admin/KanbanAutomaticoDialog.tsx src/routes/_authenticated/admin/configuracoes.tsx
git show --stat HEAD | tail -n +7
```

---

### Task 8: E2E só-leitura travado na Loja Teste + revisão + portão (G-commit) — e o roteiro da G-chave

**Files:**
- Create: `tests/e2e/kanban-auto.spec.ts`

**Interfaces:**
- Consumes: `doLogin` (`tests/e2e/_helpers.ts`) — **NÃO** `selectStore` (ele chama a server fn `setActiveTenant`, que grava `users.tenant_id` com service role — `src/lib/admin.functions.ts:218-224` —, e sem a "Loja Teste" cai na 1ª loja da lista, que pode ser real — `_helpers.ts:40-44`); testids das Tasks 4–7.
- Produces: spec com 2 blocos — "chave DESLIGADA" (roda sempre; vale antes e depois da F1) e "chave LIGADA" (só com `E2E_KANBAN_LIGADO=1`, depois da G-chave) — e a trava `exigirLojaTeste`.
- **R2 — resposta do dono (23/set): "Travar na Loja Teste".** O E2E NÃO troca de loja: se o usuário de teste já está na "Loja Teste" (tenant `37889b78-fffb-404b-8c75-18b7e50a1d9b`) segue; se não, FALHA com mensagem clara (nunca chama `setActiveTenant`, nunca cai numa loja real). Escritas em produção: SÓ as preferências de filtro/agrupamento do próprio usuário de teste (`user_ui_prefs`, seed idempotente no load — `criacao.desenvolvimento.tsx:92-97`), ACEITAS pelo dono; nenhuma outra antes da G-chave (a sessão de login no Auth é inerente a qualquer E2E e não é dado da loja). `E2E_BASE_URL` explícito e local — a spec recusa rodar sem ele (o default do Playwright é produção).
- **Depende da F1:** o bloco "chave ligada" exige F1 aplicada em produção (Task 18 da F1) + a chave ligada na Loja Teste pelo dono (G-chave). O teste de contrato (Task 3) precisa estar RODANDO (migration 4 no repo) antes do G-commit.

- [ ] **Step 1: Escrever a spec** — criar `tests/e2e/kanban-auto.spec.ts`:

```ts
import { test, expect, type Browser, type Page } from "@playwright/test";
import { doLogin } from "./_helpers";

// Kanban automático — F2 (telas). SÓ LEITURA: nenhum teste salva, liga/desliga a chave, solta card ou escolhe
// uma opção do "Mover para…" — o vite local fala com o Supabase de PRODUÇÃO.
// TRAVADO NA LOJA TESTE (dono, 23/set — R2 do G-plano): NÃO troca de loja (nada de `selectStore`/`setActiveTenant`,
// que grava `users.tenant_id` e, sem a Loja Teste, cairia na 1ª loja da lista). Se o usuário de teste não estiver
// na Loja Teste, o teste FALHA. Escrita aceita pelo dono: as preferências de filtro/agrupamento do PRÓPRIO usuário
// de teste (`user_ui_prefs`, seed idempotente no load). Nenhuma outra escrita antes da G-chave.
// Rodar SEMPRE com E2E_BASE_URL=http://localhost:5173 (ou :5199 se o QA subiu o próprio vite) — o default do
// Playwright é PRODUÇÃO; sem E2E_BASE_URL local a spec nem começa.
// Bloco "chave LIGADA" só com E2E_KANBAN_LIGADO=1, DEPOIS que o dono ligar a chave na Loja Teste (G-chave).
const LIGADO = process.env.E2E_KANBAN_LIGADO === "1";
const BASE_LOCAL = /^http:\/\/(localhost|127\.0\.0\.1):\d+\/?$/.test(process.env.E2E_BASE_URL ?? "");
const LOJA_TESTE = "Loja Teste";
const TENANT_LOJA_TESTE = "37889b78-fffb-404b-8c75-18b7e50a1d9b";

// Só OBSERVA a rede: guarda o tenant_id que as telas pedem em `tenant_config` (nada é gravado).
function vigiarTenant(page: Page): Set<string> {
  const vistos = new Set<string>();
  page.on("request", (req) => {
    const url = req.url();
    if (!url.includes("/rest/v1/tenant_config")) return;
    const m = /[?&]tenant_id=eq\.([0-9a-f-]{36})/.exec(url);
    if (m) vistos.add(m[1]);
  });
  return vistos;
}

// Trava da Loja Teste: lê (sem clicar) o seletor "Loja em visualização" e confere o tenant que a Config pede.
// Qualquer divergência = FALHA com instrução; nunca troca de loja.
async function exigirLojaTeste(page: Page, vistos: Set<string>): Promise<void> {
  await page.waitForLoadState("networkidle").catch(() => {}); // a sidebar (com o seletor) assenta depois do login
  const switcher = page.locator('div:has(> div:has-text("Loja em visualização"))').getByRole("combobox").first();
  const rotulo = (await switcher.count()) ? ((await switcher.textContent()) ?? "").trim() : null;
  await page.goto("/admin/configuracoes", { waitUntil: "networkidle" });
  const outros = [...vistos].filter((t) => t !== TENANT_LOJA_TESTE);
  if ((rotulo !== null && !rotulo.includes(LOJA_TESTE)) || !vistos.has(TENANT_LOJA_TESTE) || outros.length > 0) {
    throw new Error(
      `E2E do kanban travado na "${LOJA_TESTE}" (${TENANT_LOJA_TESTE}), mas o usuário de teste está em ` +
      `"${rotulo ?? "?"}" (tenant pedido: ${[...vistos].join(", ") || "nenhum"}). Este teste NÃO troca de loja ` +
      `(decisão do dono, 23/set): coloque o usuário de teste na Loja Teste à mão e rode de novo.`,
    );
  }
}

async function abrir(browser: Browser, viewport: { width: number; height: number }): Promise<Page> {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const vistos = vigiarTenant(page);
  await doLogin(page);
  await exigirLojaTeste(page, vistos);
  return page;
}

// Selo no card COMPACTO do Planejamento (B1, dono 23/set): cada selo dentro da linha e do corpo do card; o
// compacto nunca mostra o texto "automática"/"fixado" (no máximo o ícone). Devolve quantos selos compactos viu.
async function conferirSelosSemEstouro(page: Page): Promise<number> {
  const selos = page.getByTestId("etapa-kanban-selo");
  const n = Math.min(await selos.count(), 12);
  let compactos = 0;
  for (let i = 0; i < n; i++) {
    const selo = selos.nth(i);
    const medida = await selo.evaluate((el) => {
      const linha = el.parentElement as HTMLElement;
      const corpo = linha.parentElement as HTMLElement;
      const r = el.getBoundingClientRect();
      return {
        compacto: el.getAttribute("data-compacto") === "true",
        dentroDaLinha: r.right <= linha.getBoundingClientRect().right + 1 && r.left >= linha.getBoundingClientRect().left - 1,
        dentroDaTela: r.right <= window.innerWidth + 1,
        linhaSemEstouro: linha.scrollWidth <= linha.clientWidth + 1,
        corpoSemEstouro: corpo.scrollWidth <= corpo.clientWidth + 1,
      };
    });
    expect(medida, `selo #${i}`).toMatchObject({ dentroDaLinha: true, dentroDaTela: true, linhaSemEstouro: true, corpoSemEstouro: true });
    if (medida.compacto) {
      compactos++;
      await expect(selo).not.toContainText("automática");
      await expect(selo).not.toContainText("fixado");
    }
  }
  return compactos;
}

test.skip(!BASE_LOCAL, "defina E2E_BASE_URL=http://localhost:5173 (ou :5199) — o default do Playwright é PRODUÇÃO");

test.describe.configure({ mode: "serial" });

test.describe("Kanban automático — chave DESLIGADA (padrão): telas como hoje + selo/etiquetas", () => {
  test.skip(LIGADO, "a Loja Teste está com a chave LIGADA — rode o outro bloco");
  let page: Page;
  test.beforeAll(async ({ browser }) => { page = await abrir(browser, { width: 1600, height: 900 }); });
  test.afterAll(async () => { await page.context().close(); });

  test("Desenvolvimento: sem faixa e sem ícone de modo nas colunas", async () => {
    await page.goto("/criacao/desenvolvimento", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "Desenvolvimento" })).toBeVisible();
    await expect(page.locator('[data-testid^="kanban-coluna-"]').first()).toBeVisible();
    await expect(page.getByTestId("kanban-auto-faixa")).toHaveCount(0);
    await expect(page.getByTestId("kanban-col-modo")).toHaveCount(0);
    await expect(page.getByTestId("kanban-card-fixado")).toHaveCount(0);
  });

  test("Planejamento: legenda do selo e selos sem 'automática'/'fixado'", async () => {
    await page.goto("/criacao/planejamento", { waitUntil: "networkidle" });
    const legenda = page.getByTestId("etapa-kanban-legenda");
    await expect(legenda).toBeVisible();
    await expect(legenda).not.toContainText("fixado");
    const selos = page.getByTestId("etapa-kanban-selo");
    const n = await selos.count();
    test.info().annotations.push({ type: "selos no Planejamento", description: String(n) });
    for (let i = 0; i < Math.min(n, 10); i++) {
      await expect(selos.nth(i)).not.toContainText("automática");
      await expect(selos.nth(i)).not.toContainText("fixado");
    }
  });

  test("Config da Loja: chave desligada, etiquetas por coluna, Requisitos de Reprovado travado", async () => {
    await page.goto("/admin/configuracoes", { waitUntil: "networkidle" });
    const sw = page.getByTestId("kanban-auto-switch");
    await expect(sw).toBeVisible();
    await expect(sw).toHaveAttribute("aria-checked", "false");
    await expect(page.getByTestId("modo-coluna-entrada").first()).toBeVisible();
    await expect(page.getByTestId("requisitos-bloqueado").first()).toBeVisible();
  });

  for (const largura of [360, 390]) {
    test(`Planejamento no celular (${largura} px): selo no card compacto sem estourar a largura`, async ({ browser }) => {
      const m = await abrir(browser, { width: largura, height: 800 });
      await m.goto("/criacao/planejamento", { waitUntil: "networkidle" });
      await expect(m.getByTestId("etapa-kanban-selo").first()).toBeVisible();
      const compactos = await conferirSelosSemEstouro(m);
      test.info().annotations.push({ type: `selos compactos a ${largura} px`, description: String(compactos) });
      // A 360 px o card é compacto (main p-4 ⇒ card de ~156 px < 170); a 390 px fica no limite e pode sair cheio.
      if (largura === 360) expect(compactos).toBeGreaterThan(0);
      await m.context().close();
    });
  }
});

test.describe("Kanban automático — chave LIGADA na Loja Teste (G-chave) — SÓ LEITURA", () => {
  test.skip(!LIGADO, "rode com E2E_KANBAN_LIGADO=1 depois que o dono ligar a chave na Loja Teste");
  let page: Page;
  test.beforeAll(async ({ browser }) => { page = await abrir(browser, { width: 1600, height: 900 }); });
  test.afterAll(async () => { await page.context().close(); });

  test("Desenvolvimento: faixa + ícone de modo em TODA coluna + subtítulo", async () => {
    await page.goto("/criacao/desenvolvimento", { waitUntil: "networkidle" });
    await expect(page.getByTestId("kanban-auto-faixa")).toContainText("Kanban automático ligado.");
    const nCols = await page.locator('[data-testid^="kanban-coluna-"]').count();
    expect(nCols).toBeGreaterThan(0);
    await expect(page.getByTestId("kanban-col-modo")).toHaveCount(nCols);
  });

  test("arraste simulado (sem soltar) acende os destinos com a dica e apaga no fim", async () => {
    await page.goto("/criacao/desenvolvimento", { waitUntil: "networkidle" });
    await page.getByTitle("Recolher / Expandir").click();
    const expandir = page.getByRole("button", { name: "Expandir tecidos" });
    if (await expandir.count()) await expandir.click();
    else await page.keyboard.press("Escape");
    const card = page.getByTestId("kanban-card").filter({ visible: true }).first();
    await expect(card).toBeVisible();
    const dt = await page.evaluateHandle(() => new DataTransfer());
    await card.dispatchEvent("dragstart", { dataTransfer: dt });
    await expect(page.locator('[data-testid^="kanban-coluna-"].border-dashed').first()).toBeVisible();
    await card.dispatchEvent("dragend", { dataTransfer: dt });
    await expect(page.locator('[data-testid^="kanban-coluna-"].border-dashed')).toHaveCount(0);
  });

  test("mobile: “Mover para…” anota cada destino (sem escolher)", async ({ browser }) => {
    const m = await abrir(browser, { width: 390, height: 844 });
    await m.goto("/criacao/desenvolvimento", { waitUntil: "networkidle" });
    const grupo = m.getByTestId("kanban-grupo-toggle").filter({ visible: true }).first();
    if (await grupo.count()) await grupo.click();
    const mover = m.getByRole("combobox").filter({ hasText: "Mover para…" }).first();
    await expect(mover).toBeVisible();
    await mover.click();
    await expect(m.getByRole("option").first()).toBeVisible();
    const textos = await m.getByRole("option").allTextContents();
    expect(textos.some((t) => /fixa aqui|solta o card|já cumpre|falta 1 dado|faltam \d+ dados|fora do fluxo/.test(t))).toBe(true);
    await m.keyboard.press("Escape");
    await m.context().close();
  });

  test("Config e Planejamento refletem a chave ligada", async () => {
    await page.goto("/admin/configuracoes", { waitUntil: "networkidle" });
    await expect(page.getByTestId("kanban-auto-switch")).toHaveAttribute("aria-checked", "true");
    await page.goto("/criacao/planejamento", { waitUntil: "networkidle" });
    await expect(page.getByTestId("etapa-kanban-legenda")).toContainText("fixado");
  });

  test("Planejamento no celular (360 px) com a chave ligada: compacto só com o ícone, sem estourar", async ({ browser }) => {
    const m = await abrir(browser, { width: 360, height: 800 });
    await m.goto("/criacao/planejamento", { waitUntil: "networkidle" });
    await expect(m.getByTestId("etapa-kanban-selo").first()).toBeVisible();
    expect(await conferirSelosSemEstouro(m)).toBeGreaterThan(0);
    await m.context().close();
  });
});
```

- [ ] **Step 2: Rodar o bloco "chave desligada" (vale antes e depois da F1)** — LIBERADO pela resposta do dono à R2 (23/set: "Travar na Loja Teste"), com a spec acima (sem troca de loja; só `user_ui_prefs` do usuário de teste; `E2E_BASE_URL` explícito).

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp"
if [ "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:5173)" = "200" ]; then BASE=http://localhost:5173
else node_modules/.bin/vite --port 5199 --strictPort > /tmp/f2-vite.log 2>&1 & echo $! > /tmp/f2-vite.pid; sleep 8; BASE=http://localhost:5199; fi
E2E_BASE_URL=$BASE npx playwright test tests/e2e/kanban-auto.spec.ts --reporter=list
[ -f /tmp/f2-vite.pid ] && kill "$(cat /tmp/f2-vite.pid)" && rm -f /tmp/f2-vite.pid
```
**Gate (RS1 do guardião):** a saída TEM de conter a linha literal `5 passed`. `0 passed` / `10 skipped` (E2E_BASE_URL ausente, sem porta ou não-local) = **NÃO TESTADO** — não relatar como aprovado nem levar ao G-commit; rodar de novo com `E2E_BASE_URL=http://localhost:5173`.

Expected: 5 PASS (bloco desligado: Desenvolvimento, Planejamento, Config, celular 360, celular 390) + 5 skipped (bloco ligado). Antes da F1 aplicada o switch aparece desabilitado mas `aria-checked="false"` — o teste passa igual. Se o usuário de teste NÃO estiver na Loja Teste, TODOS falham no `abrir` com a mensagem "E2E do kanban travado na \"Loja Teste\" …" — é o comportamento pedido: NÃO trocar de loja por conta própria (nem pela UI, nem por `selectStore`); relatar ao controlador/dono. Se falhar por dado (ex.: Loja Teste sem Reprovado no board), registrar como achado e NÃO semear o banco.

- [ ] **Step 3: Revisão (report-only) + portão**

1. Rodar o agente **code-reviewer** (Opus) sobre o diff `git diff savepoint-pre-unificacao-2026-09-22..HEAD -- src/lib/kanban-auto-ui.ts src/lib/kanban-auto-config.ts src/lib/kanban-auto-rpc.ts src/hooks/useKanbanConfig.ts src/lib/erro-mensagem.ts src/components/shared/EtapaKanbanBadge.tsx src/components/admin/ src/routes/_authenticated/criacao.desenvolvimento.tsx src/routes/_authenticated/admin/configuracoes.tsx src/routes/_authenticated/criacao.planejamento.tsx` com o foco: (a) chave desligada = caminho de hoje LITERAL; (b) RP3 (nenhuma coluna de kanban no `upsert`) e a ordem do Salvar (R3: conflito → `upsert` do geral → `update` do kanban por último, com `.select`); (c) queryKeys/invalidações (`tenant-kanban-auto`, `desenv-condicoes`, `modelos-*`); (d) otimista × resposta do servidor no `kanban_mover`; (e) diálogos montados só quando abertos; (f) selo do card compacto (B1) sem alargar o card; (g) a spec E2E nunca troca de loja (sem `selectStore`/`setActiveTenant`) e exige `E2E_BASE_URL` local.
2. Rodar o **guardião** (`guardiao-unificacao`, G-commit da F2) com: este plano, o diff, a saída dos gates e do E2E, e a prova `git diff --name-only savepoint-pre-unificacao-2026-09-22 -- src/components/desenvolvimento/ src/components/producao/cad/CadTecidosSection.tsx` (vazio). Exigência deste portão: a saída do E2E do Step 2 com a linha literal `5 passed` (RS1 — só `skipped` = não testado); e `npx vitest run tests/unit/kanban-auto-rpc-contrato.test.ts` com os 5 testes de RPC **rodando e PASS** (não `skipped`) — ou seja, a migration 4 da F1 já commitada.
3. Achado bloqueante → corrigir na task correspondente e repetir os gates; nada de commit com gate vermelho.

- [ ] **Step 4: Commit da spec**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp"
git add -- tests/e2e/kanban-auto.spec.ts
git commit --only -m "test(kanban-auto): F2 — E2E só-leitura (chave desligada sempre; bloco da chave ligada opt-in p/ a G-chave)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" -- tests/e2e/kanban-auto.spec.ts
git show --stat HEAD | tail -n +7
```

- [ ] **Step 5: Roteiro da G-chave (NÃO é código; só com o dono presente e OK explícito, DEPOIS da F1 Task 18 e do deploy da F2)**

Pré-requisitos: F1 aplicada em produção (Task 18); **front da F2 PUBLICADO (`npm run deploy`, MANUAL, do dono) E TODAS as abas de admin da loja recarregadas ANTES de ligar a chave** (R4 do G-plano: uma aba da Config com o bundle ANTIGO continua fazendo `upsert` da linha inteira de `tenant_config` — `configuracoes.tsx:263-277` hoje, com `cfg` montado de 6 colunas de kanban, `:197-250` —; com a chave ligada ela regravaria requisitos e ordem velhos e o gatilho recalcularia a loja SEM prévia. O vite local do dono NÃO basta: as outras abas/pessoas continuam no bundle publicado); guardião G-chave com a lista R8 (F1 Task 18 Step 8) + os itens abaixo lidos para o dono. **Registro para o controlador (este plano NÃO edita o da F1):** o item 5 do Step 8 da Task 18 da F1 (plano-F1 ~l. 5995, que hoje diz só "não liga nem desliga") precisa dizer o mesmo — "F2 publicada E todas as abas de admin da loja recarregadas ANTES de ligar". Na **Loja Teste**, nesta ordem, anotando cada resultado:
0. Confirmar com o dono: deploy da F2 feito; todas as abas de admin da Loja Teste (dele e de quem mais tiver acesso) recarregadas depois do deploy. Sem isso, NÃO ligar.
1. Config → "Status do Kanban": etiquetas conferem com os requisitos; Requisitos de Reprovado travado.
2. Ligar a chave → prévia: grupos de→para com "avançam/voltam", fixados por coluna, REFs reveladas (+ aviso "não volta"); confirmar. Toast com N cards; board mostra a faixa, ícones e "entrada".
3. Board desktop: arrastar p/ automática ALÉM da derivada → toast "Não pode entrar aqui. Falta N dado(s)…" e o card fica; p/ coluna manual → "Fixado em …" + selo "fixado"; de volta p/ automática ≤ derivada → "Card solto. Voltou para …"; p/ automática aquém com card automático → "O card já cumpre …".
4. Mobile (390 px): "Mover para…" anota os destinos; escolher um bloqueado → toast de bloqueio; escolher manual → fixa.
5. Planejamento: selo do card com "automática"/"fixado"; legenda com os 4 estados; no celular (360/390 px) o card compacto mostra o selo pequeno (rótulo + só o ícone), sem estourar a largura.
6. Config com a chave ligada: mudar um requisito → Salvar → "Salvar e mover N cards?" com a tabela; Voltar (nada gravado); Salvar de novo e confirmar.
7. RP3 com 2 abas da Config: aba A muda um requisito e salva; aba B (aberta antes) muda outro requisito e salva → erro "Outra pessoa mudou os requisitos … Recarregue a página …", nada gravado.
8. Desligar → prévia de restauração: data/hora, N que voltariam, "ver lista", avisos; marcar "Restaurar" → "Desligar e restaurar" → toast; board sem faixa (caminho de hoje).
9. Rodar `E2E_KANBAN_LIGADO=1` (Step 2 com a variável) ENTRE os passos 2 e 8 (com a chave ligada).

---

## 4. O que depende da F1 (resumo para o orquestrador)

| Task | Precisa ANTES | Por quê |
|---|---|---|
| 1, 2 | F1 Tasks 1–3 (TS) — **já no repo** | importam `kanban-auto.ts`/`kanban-status.ts` |
| 3 | idem; o teste de contrato das RPCs PULA até a **migration 4 da F1 existir no repo** (Tasks 15–16) | contrato lido do arquivo |
| 4, 5, 6, 7 | nada do banco p/ compilar/testar (unit) | `select("*")` tolera a coluna ausente ⇒ chave desligada |
| 5 (runtime ligado) | F1 **aplicada em produção** (Task 18: migrations 1–4) + chave ligada (G-chave) | `kanban_mover` só existe e só age com a chave ligada |
| 7 (runtime) | F1 aplicada (migrations 1 e 4) | switch habilita só com a coluna; diálogos chamam as RPCs |
| 8 bloco desligado | nada (vale antes e depois da F1) + usuário de teste JÁ na Loja Teste (a spec não troca de loja — R2) | só leitura (+ `user_ui_prefs` do usuário de teste, aceito pelo dono) |
| 8 G-commit | migration 4 da F1 **commitada** (contrato RODANDO) | exigência do portão |
| 8 bloco ligado / roteiro G-chave | F1 Task 18 + deploy da F2 (o vite local não basta) + todas as abas de admin da loja recarregadas (R4) + OK do dono | grava em produção |

**QA contra a cópia local:** o app NÃO pode apontar para ela — a cópia é só o Postgres (`supabase_db_banco-local`, porta 54422), sem PostgREST/GoTrue/Realtime; o vite fala com `VITE_SUPABASE_URL` (produção). Subir a API local (`supabase start` em `/Users/sunglee/PLM + Criação/banco-local/`) mudaria a infraestrutura da cópia — a regra da F1 é "não subir, recriar nem consertar a cópia por conta própria" ⇒ fica como OPÇÃO que exige OK do dono (e ainda exigiria usuários/senhas e JWT locais). Nesta fase o que roda contra a cópia local é o que já existe na F1 (suíte de integração das RPCs, com `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres KANBAN_AUTO_MIG_TXN=1`) — é ela que prova o comportamento que o front consome; o front é provado por unit (lógica pura + contrato F1×F2 lido dos arquivos) e pelo E2E só-leitura; o fluxo com gravação é o roteiro da G-chave (Step 5 da Task 8), em produção, com o dono.

## 5. Rastreabilidade (self-review contra a spec)

| Requisito (spec F2 / decisões) | Onde |
|---|---|
| `kanban-auto.ts` puro (`fluxoDoModelo`, `colunaManual`, `statusDerivado`, `destinoDrop`, `faltandoPara`) | F1 Tasks 1–3 (já no repo); F2 só consome (Global Constraints) |
| `useKanbanConfig` com queryKey contendo "tenant" | Task 3 (`["tenant-kanban-auto", tenantId]`) + teste do realtime |
| Board: desligada = hoje; ligada = `destinoDrop` + RPC `kanban_mover` + toast por ação | Task 5 Steps 2–4, 6 |
| Destaque no arraste com "Falta N dado(s) para completar: <labels>" | Task 5 Step 6 (`textoFaixaDrop`) + Task 1 testes |
| "Fora do fluxo" com o nome da coluna, não a key técnica (R1) | Task 1 (`textoForaDoFluxo` em `textoFaixaDrop`/`toastDoMover` + teste da revenda em "Prova de Roupa I") |
| Manual fixa; "já cumpre… use coluna manual"; fixado além não entra e continua fixado; tirar de manual até a derivada solta | tabela da F1 (`destinoDrop`) + `toastDoMover` (Task 1: "O card continua fixado em …") |
| Ícones automática/manual/fixado (lucide) no cabeçalho e no card | Task 5 Steps 6–8 (`ModoColunaIcone`, `CardAutoInfo`) |
| Faixa "Kanban automático ligado" | Task 5 Step 5 |
| "Mover para…" mobile com as mesmas regras | Task 5 Step 3 (`notaMoverPara` + RPC) |
| Config: switch desligado por padrão → prévia (N de→para, fixados, REFs reveladas) → `kanban_definir_automatico` | Task 7 (`KanbanChaveDialog` ligar) |
| Desligar oferece restaurar com prévia (`kanban_previa_restauracao` + `kanban_restaurar`) | Task 7 (`RestaurarOpcao`) |
| Salvar requisitos/ordem com a chave ligada → "Salvar e mover N cards" | Task 7 Step 3 (`prepararSalvar` + `KanbanSalvarDialog`) |
| Etiqueta Entrada/Automática/Manual/Manual (sempre) por coluna, também no "Fluxo de Revenda" | Task 6 Step 5 (`ModoColunaBadge`) |
| Bloquear requisito em Reprovado na UI | Task 6 Step 2 (`bloqueadoMotivo`) + Step 5 |
| RP3: colunas de kanban fora do upsert genérico, por caminho próprio com prévia | Task 2 (diff/conflito) + Task 6 Step 4 + Task 7 Step 3 |
| R3: ordem do Salvar (conflito → geral → kanban por último, com `.select`) | Task 6 Step 4 (`mutationFn`) — vale também para o "Salvar e mover" da Task 7 (mesmo `save`) |
| R4: F2 publicada + abas de admin recarregadas antes de ligar | Task 8 Step 5 (pré-requisitos + passo 0); item 5 do Step 8 da F1 = registro p/ o controlador |
| Selo de etapa no `ModeloCard` + legenda; desligada = só etapa; ligada = + automática/fixado; "Planejamento"; "Lançado" | Task 1 (`etapaDoModelo`) + Task 4 |
| Selo também no card COMPACTO (B1, dono 23/set): rótulo + no máximo o ícone, sem estourar 360/390 px | Task 4 (`compacto` + Step 3 (c2) + Step 5) + Task 8 (testes a 360/390 px) |
| `EtapaKanbanBadge` reutilizável (F3 no header) | Task 4 (prop `onClick` → botão) |
| Não tocar `src/components/desenvolvimento/*` | Global Constraints + prova em cada commit |
| Nada de migration | Global Constraints |
| Mensagens das RPCs novas em `erro-mensagem.ts` (PT-BR) | Task 3 (42501 próprias; P0001/P0002 testadas) |
| Testes unit p/ lógica pura nova | Tasks 1–3 |
| QA E2E com `E2E_BASE_URL=http://localhost:5173` explícito, travado na Loja Teste (R2); o que depende da F1 | Task 8 (`exigirLojaTeste`, `BASE_LOCAL`) + §4 |
| Commits `git add --` + `--only` + co-autoria; gates build + tsc + vitest | todas as tasks |
| R8 (efeitos no Sheet do Dev com a chave ligada) | NÃO corrigidos (Dev intocado); lembrados no roteiro da G-chave (Task 8 Step 5, pré-requisitos) |

Placeholder scan: sem TBD/TODO/"similar à task N"; toda etapa de código traz o código. Tipos conferidos entre tasks: `ModoColuna`, `EtapaSelo`, `DestinoDrop`, `ResultadoMover`, `PreviaRecalculo`, `PreviaRestauracao`, `KanbanColsValor`, `KanbanCol` — mesmos nomes na definição (Tasks 1–2) e no uso (Tasks 3–7); `kanbanMover`/`kanbanPreviaRecalculo`/`kanbanDefinirAutomatico`/`kanbanPreviaRestauracao`/`kanbanRestaurar` (Task 3) = os usados nas Tasks 5 e 7; `prepararSalvar` criado na Task 6 e substituído (inteiro) na Task 7; `textoForaDoFluxo` (interno da Task 1) é o único caminho do caso `fora_do_fluxo` em `textoFaixaDrop` e `toastDoMover` (R1); a prop `compacto` do `EtapaKanbanBadge` (Task 4) é a usada no corpo compacto (Task 4 Step 3 c2) e o `data-compacto` que ela gera é o lido por `conferirSelosSemEstouro` (Task 8); `exigirLojaTeste`/`vigiarTenant`/`BASE_LOCAL` só existem na spec da Task 8 (nenhum import de `selectStore`).

## 6. Decisões de desenho NÃO cobertas pela spec — 15 decisões (resumo ao dono)

São **15** (a lista abaixo; o relatório do autor dizia 16 por engano — R5 do G-plano). Situação depois do G-plano (23/set):
- **RESOLVIDA pelo dono:** 4 (selo também no card compacto).
- **INFORMADAS ao dono (não pendentes):** 1, 2, 5, 6 e 8 — o guardião as aceitou e exigiu que o dono fosse avisado; vão no resumo como informação, não como pergunta.
- **ACEITAS pelo guardião, sem pendência:** 3, 7, 9, 10, 11, 12, 13, 14 e 15.

1. **[INFORMADA — exceção de texto registrada] Toast "já cumpre" = texto da F1** (`O card já cumpre "<coluna de DESTINO>". Para segurá-lo numa etapa, use uma coluna manual.`). O mockup mostrava a coluna ATUAL e "(ex.: Em Ajuste)" (`gen_rest.py:196`). As duas frases são verdadeiras e o comportamento é o mesmo; fica o da F1 (já testado, compartilhado — `kanban-auto.ts` é arquivo travado da F1). Mesma diferença pequena no toast de fixar ("tirá-lo" × "tirar ele"). É exceção à regra "textos iguais ao mockup" (Global Constraints); se o dono quiser o texto do mockup, a F2 monta a frase sem tocar a F1.
2. **[INFORMADA] Com a chave ligada o board aceita o drop e o servidor decide:** a coluna "bloqueada" fica tracejada em vermelho com a dica (como no mockup), mas aceita o drop e a RPC decide (as condições no navegador podem estar velhas). A decisão 2 do dono continua cumprida: `kanban_mover` responde `bloquear_faltando`, não grava nada e o toast diz "Não pode entrar aqui. Falta N dado(s)…"; não há otimista em bloqueio. Com a chave desligada a coluna bloqueada segue inerte, como hoje.
3. **Cabeçalho da coluna mostra o modo do fluxo INTERNO**; um card de revenda na mesma coluna pode estar em outro modo (o selo/"fixado" do card é o dele).
4. **[RESOLVIDA — dono, 23/set: "Sim, o selo entra também no card COMPACTO"] Selo nos DOIS corpos do card do Planejamento.** No cheio, o selo completo; no compacto (< 1024 px com card < 170 px, ou desktop com muitas colunas), um selo pequeno numa linha própria abaixo do status/REF — só o rótulo da etapa e, com a chave ligada, no máximo o ícone (Zap/Pin), sem o texto "automática"/"fixado"; trunca o rótulo em vez de alargar o card (conferido a 360/390 px no E2E). Task 4 (c2) + Step 5; Task 8.
5. **[INFORMADA] Ligar/desligar exige a página sem alterações não salvas:** o recarregamento após a RPC refaz a config da tela e o baseline (efeito `[data?.cfg]`) e apagaria as edições caladas — por isso o switch fica travado com o aviso "Salve ou descarte as alterações…".
6. **[INFORMADA — aviso obrigatório] O Salvar da Config recusa se outra aba/admin mudou as colunas de kanban** depois que a tela abriu: "Outra pessoa mudou … Recarregue a página …", nada gravado. É o que protege a prévia (decisão 4: a prévia é calculada sobre o que está no banco). **Vale para TODAS as lojas, mesmo com a chave desligada** (a Task 6 não depende da F1) — é uma mudança visível da Config de hoje. Somada à R3: o Salvar grava o geral primeiro e o kanban por último.
7. **"Salvar e mover N cards" só aparece com a chave ligada E (≥ 1 card mudando OU REF revelada)**; senão, o AlertDialog de sempre.
8. **[INFORMADA] Restaurar só existe dentro do "Desligar"** (checkbox desmarcado por padrão, como no mockup — é a letra da decisão 4). Quem desliga sem marcar, ou vê a restauração falhar depois de desligar, **só restaura depois por psql** (a RPC aceita: `kanban_previa_restauracao(NULL)` pega o último 'ligar' não restaurado; falta só a tela). Fast-follow possível: "Restaurar colunas guardadas…" na Config com a chave desligada — é tela nova e só entra com OK do dono.
9. **"Mover para…" (mobile) com a chave ligada não esconde destinos bloqueados:** esmaece e anota; escolher um bloqueado vai à RPC e volta com o toast (paridade com hoje).
10. **Etiquetas Entrada/Automática/Manual aparecem na Config mesmo com a chave desligada** (como no mockup aprovado) — explicam o que aconteceria ao ligar.
11. **Sem a F1 aplicada o front novo = chave desligada** e o switch fica desabilitado ("aguarda a atualização do banco") — deploy da F2 antes ou depois da F1 não quebra nada. Mesmo assim, recomendo o deploy da F2 DEPOIS da F1 Task 18 — e, de todo modo, ANTES de ligar a chave, com as abas de admin recarregadas (R4, Task 8 Step 5).
12. **Linha nova "revenda não passa"** no "Fluxo de Revenda" para colunas desligadas (quando há subconjunto configurado), como no mockup.
13. **`desenv-condicoes` é recarregada após cada mover e ao fechar o Sheet (chave ligada)**; não entrou no mapa do realtime (edição de outra pessoa no Sheet só atualiza a dica no próximo foco/refetch — o servidor continua decidindo certo).
14. **Tom dos toasts:** fixar = informativo, soltar = sucesso, bloqueio/fora do fluxo = erro, "já cumpre" = informativo. "Fora do fluxo" mostra o NOME da coluna, não a key técnica (R1).
15. **QA com gravação só na G-chave, em produção, com o dono** — o app não fala com a cópia local; subir a API local é opção que depende do seu OK. O E2E só-leitura fica travado na Loja Teste (R2, resposta do dono 23/set): não troca de loja, falha se o usuário de teste não estiver nela, e a única escrita aceita são as preferências de filtro/agrupamento do próprio usuário de teste.
