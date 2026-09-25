# Distribuição por produto — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar a página "Distribuição" (por subcoleção, em "modelos") por um **dialog "Distribuir por loja" por produto** no Plan. Tecido (loja × cor do Tecido 1 × tamanho, Base por loja × cor, correção à mão por quadradinho) cujo total por cor preenche o "pç" do card; dar ao forro/Tecido 2 o **"atende a"** (casar variantes) com pç derivado; mostrar o **plano do modelo** no Direcionamento com semi-preenchimento; e **apagar** a Distribuição antiga (página + tabelas + RPCs) no mesmo roteiro de produção.

**Architecture:** Dados no MESMO funil do pç: `plan_tecido_variantes.distribuicao jsonb` (Tecido 1) e `plan_tecido_variantes.atende jsonb` (demais blocos), gravados por `_salvar_plan_tecido_core`, devolvidos por `_plan_tecido_arvore_core`, guardados pela blindagem `_plan_tecido_snapshot`; o "atende a" chega ao BOM pelo casamento que já existe (`modelo_tecido_variantes.complementa_variante_ids`, agora gravado por `_plan_tecido_gravar_bom_core`, que também deixa de apagá-lo em silêncio). No front, três libs PURAS (`distribuicao-produto.ts`, `plan-tecido/atendimento.ts`, `direcionamento-plano.ts`) + uma normalização idempotente do slot aplicada no carregamento e em todo `patch`. O Direcionamento lê o plano SALVO por uma RPC nova (`direcionamento_plano_modelo`, wrapper DEFINER + `_core` revogado) e preenche só o RASCUNHO (servidor #10 intocado). Duas migrations GERADAS do texto vivo com guarda md5: `20261006100000` (aditiva) e `20261006110000` (remoção, depois do deploy).

**Tech Stack:** PostgreSQL 17.6 (Supabase próprio; cópia local Docker `supabase_db_banco-local` em `127.0.0.1:54422`), plpgsql/sql, Vite + React + TypeScript + TanStack Query v5 + supabase-js, Tailwind, Radix/shadcn (Dialog, Popover, Checkbox, AlertDialog), Vitest (unit `node` + integração `BEGIN…ROLLBACK` SÓ na cópia), Playwright (QA), Python 3 (geradores das migrations), bash (scripts de produção no molde Nota/SKU/Sheet).

**Spec:** `docs/superpowers/specs/2026-09-25-distribuicao-por-produto-design.md` (decisões do dono §2 e rulings R1–R39 §3 TRAVADOS; mockup aprovado artifact `WAQb4W8LBYgNh6cNJsEo4D`, fontes `…/scratchpad/mock-distribuicao/project/*.dc.html`). Estudo e decisões: `/Users/sunglee/PLM + Criação/plm-pcp/.superpowers/estudos/2026-09-25-distribuicao-por-produto-{pedido,estudo,decisoes}.md`. Molde de processo/scripts: `.claude/worktrees/sheet-reorg/docs/superpowers/plans/2026-09-25-sheet-planejamento-reorganizacao.md` (Tasks 0, 6, 7, 10).

## Global Constraints

**Repositório e worktree**
- Worktree: `/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/distribuicao-produto`, branch `distribuicao/por-produto` (base `13ec1dae`, ponta da `feature/plan-tecido-a1` em 25/set). Caminhos relativos = raiz da worktree. TODO comando de git/gate/script roda DE DENTRO da worktree e imprime o alvo + `HEAD`. `.superpowers/` é gitignored: regras, gates, scripts, logs e evidências ficam em `.superpowers/distribuicao/` (não versionados).
- Commits: `git add -- <paths exatos>` + `git commit --only -m "<msg>" -- <paths>` + `git show --stat HEAD`. Mensagem termina com `Co-Authored-By: Claude <seu modelo real> <noreply@anthropic.com>`.
- ⛔ PROIBIDO: `git stash`, `git add .`/`-A`/`commit -a`, `pkill`/`killall`, `push`, editar `src/integrations/supabase/types.ts` (colunas/RPCs novas via `as any`/tipo próprio), imprimir senha/URL com senha/`.env`, despachar subagentes (o executor não despacha).
- ⛔ **Arquivos da reorganização do Sheet (frente PARALELA — NÃO tocar):** `src/components/planejamento/planejamento-detail/**` (inclui `ficha/TecidosBomSecao.tsx`), `src/components/configuracoes/FormatoSkuCard.tsx`, `src/lib/sku-montar.ts`, `src/routes/_authenticated/admin/configuracoes.tsx`, `src/lib/titulo-pagina.ts`, `supabase/migrations/20261005100000_*`, `supabase/rollback/20261005100000_*` e a função `_replicar_cards_plan_tecido_core` (redefinida por ela). O `gates.sh` confere. Precisou de um deles ⇒ PARE e chame o controlador (Ruling novo + dependência explícita).
- Só os arquivos de `.superpowers/distribuicao/permitidos.txt` (Task 0) mudam — o `gates.sh` confere.
- **Dev intocado (decisão travada 8 da campanha):** `git diff --name-only savepoint-pre-unificacao-2026-09-22 -- src/components/desenvolvimento/ src/components/producao/ src/components/producao/cad/CadTecidosSection.tsx` tem de dar VAZIO. O Direcionamento mexido é a ROTA (`src/routes/_authenticated/expedicao.direcionamento.$modeloId.tsx`); `src/components/producao/RomaneioDirecionamento.tsx`/`RevisaoErro.tsx` NÃO mudam.

**Banco**
- ⛔ PRODUÇÃO: o agente NÃO toca — nem `SELECT`, nem `psql "$(cat /tmp/dburl.txt)"`. Produção só na Task 11, PELO DONO, no Terminal dele, pelos scripts da Task 10.
- Cópia local = `postgresql://postgres:postgres@127.0.0.1:54422/postgres` (também é o app de teste `:5188` do dono). DDL/migration na cópia SÓ (a) dentro da txn revertida das suítes (`DIST_MIG_TXN=1`) ou (b) pelos scripts `.superpowers/distribuicao/{copia.sh,mig/ensaio-local.sh}` e pela medição da Task 9 Step 1. Antes de cada uma: o CONTROLADOR avisa o dono no chat (texto do `n3.sh`) e, com o OK, `DIST_DONO_AVISADO=sim bash .superpowers/distribuicao/n3.sh antes <passo>`. Leitura: `PGOPTIONS='-c default_transaction_read_only=on' psql …`.
- ⛔ NUNCA `\i` de migration dentro de transação de teste (incidente 15/set). ⛔ NUNCA DDL em transação de teste contra produção (incidente 23/set).
- TODO vitest — unit (inclusive nos gates) E integração — com `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres` EXPLÍCITO (nunca `env -u DATABASE_URL`: o fallback de `tests/integration/db.ts` é `/tmp/dburl.txt` = PRODUÇÃO — incidente 24/set) e com caminhos de arquivo LITERAIS.
- Migrations: `supabase/migrations/20261006100000_distribuicao_por_produto.sql` (+ `supabase/rollback/20261006100000_distribuicao_por_produto_down.sql`) e `supabase/migrations/20261006110000_distribuicao_antiga_remover.sql` (+ `supabase/rollback/20261006110000_distribuicao_antiga_remover_down.sql`). GERADAS por `.superpowers/distribuicao/mig/gerar_sql.py` e `gerar_remocao.py` a partir do texto VIVO (dump só-leitura da cópia) — nunca editadas à mão. Cada arquivo: 1 `BEGIN;` e 1 `COMMIT;` em linha própria, com `SET LOCAL lock_timeout = '500ms';` e `SET LOCAL transaction_timeout = '3s';` logo depois do `BEGIN;`; guarda md5 EXATA (o md5 VIVO lido na cópia — o plano NÃO crava); ACL #9 (`REVOKE … FROM PUBLIC, anon, authenticated` nas internas; `tenant_module_enabled` com ACL INTOCADA); nenhuma DML/COMMENT em `tenant_config`; nenhuma DDL de policy na aditiva (a remoção não tem `CREATE/DROP POLICY` explícito; o inverso dela recria a policy POR ÚLTIMO).
- Contagens (funções|gatilhos) NUNCA cravadas: medidas antes/depois. Deltas: aditiva **+2|+0**; remoção **−4|−1**.
- ORDEM OBRIGATÓRIA (R36): (1) reorganização `20261005100000` em produção + a referência dela da volta da F1; (2) esta ADITIVA (dono) + referência nova; (3) merge do front + ida na cópia NO MESMO comando; (4) QA; (5) deploy pelo portão; (6) REMOÇÃO (dono) + referência nova; (7) remoção na cópia. A remoção NUNCA antes do deploy no ar (o front publicado usa a página/RPC antigas).

**Front**
- Gates de todo commit: `bash .superpowers/distribuicao/gates.sh` → `GATES DIST: ok` (`npx tsc --noEmit` — o build NÃO checa tipos —, `npm run build`, unit sem falha nova vs. linha de base — inclui o anti-drift `tests/unit/ui-padroes-antidrift.test.ts` —, lista permitida, arquivos da reorg intocados, Dev intocado, sem `type="date"`, sem toast cru, `mig-txn.ts`/`types.ts` intocados).
- Erro = `toast.error(mensagemErro(e, "…"))`; cor SÓ por token/primitivo/classe Tailwind (`StatusBadge`, `text-muted-foreground`, `text-amber-700`…) — nada de hex/`hsl()`/`oklch()`; ícone lucide `h-4 w-4` (ou `h-3 w-3` dentro de linha densa do card); ação em linha `size="iconSm"`/`size="sm"`.
- Dialog novo = `<DialogContent fixedFooter mobileFull>`; rodapé Voltar (esq.) · Salvar (`ml-auto`); montar `{open && <Dialog/>}` (nasce limpo); "Descartar alterações?" em AlertDialog.
- Colaboração: nenhum mecanismo novo (plan_rev/P0409 + merge por slot; Direcionamento `direcionamento_controle.rev`). `data-colab-path` NOVOS (spec §5.4): `dist:{slot}:prop:{tam}`, `dist:{slot}:{loja}:{varKey}:base`, `dist:{slot}:{loja}:{varKey}:{tam}`, `pt-atende:{material}:{varKey}`; marcador `dist:{slot}:aberto`. O dialog monta o PRÓPRIO `ColabPresenceOverlay` (R19).
- Mobile 360/390 sem estouro horizontal (medido na QA); tabelas com rolagem horizontal própria e 1ª coluna `sticky`.
- Textos EXATOS (mockup/spec §5.3): "Distribuir por loja"; "distribuído"; "Só leitura — muda pelo Distribuir por loja"; "Soma das cores do Tecido 1 que ele atende"; "atende a"; "Atende a · cores do Tecido 1"; "já atendida por: {cor}"; "padrão"; "mesma cor base (automático)"; "escolhida à mão"; "pç deste {forro|tecido}"; "Padrão: a mesma cor base. Mudar aqui só troca a amarração — a metragem segue o consumo do {forro|tecido} ({consumo} m/pç)."; "↺ padrão (mesma cor base)"; "Sem cor deste {forro|tecido}: …"; "Não atende nenhuma cor do Tecido 1"; "Loja / Cor"; "Base" + "você digita"; "Tamanhos: proporção × Base · dá para corrigir à mão"; "Total" + "da cor na loja"; "Proporção por tamanho" + "do card"; "Total {loja}"; "● editado à mão — passe o mouse para ver o calculado e voltar a ele (↺). Os totais já contam o valor editado."; "Editado à mão · calculado seria {N}"; "Voltar ao calculado"; "Total por cor × tamanho"; "Soma das lojas. É o que preenche o pç de cada cor do Tecido 1 no card."; "soma das lojas"; "= pç no card"; "sem distribuição · pç do card {N}"; "Salvar preenche o pç das {N} cores no card. Grava de vez no Salvar do plano."; "Enviado à Explosão — só leitura (ver e imprimir)."; "Por loja · deslize para o lado"; "Plano de distribuição do modelo"; "só leitura"; "do Plan. Tecido › Distribuir por loja"; "Preencher com o plano"; "Reaplica a regra: preenche onde bate com a Grade Real"; "Total do plano"; "Distribua à mão"; "faltam {N}"; "Grade Real = o que voltou da recepção dos serviços, já sem os defeitos do CQ."; "{N} modelos direcionados".

**QA**
- Gravação SÓ na cópia (`:5188`, Loja Teste, card/modelo combinados com o dono — P-35); `:5173` (PRODUÇÃO) só leitura. Playwright com `E2E_BASE_URL` explícito. Sem semear dado; nunca trocar a loja ativa do usuário compartilhado; nunca subir/matar `:5173`/`:5188`.

**Processo**
- SDD: implementador Sonnet por task (não despacha subagente); revisor Opus por task/lote (§4); o `code-reviewer` roda sem pedir. Tasks 4 e 9 (banco): **G-migration** = 2 revisões Opus INDEPENDENTES + guardião `guardiao-unificacao`. O guardião acompanha TODOS os portões (§4) e registra no diário `.superpowers/sdd/2026-09-22-unificacao-kanban-auto/guardiao.md` (checkout principal). Avisos e OKs do dono SÓ por chat (nunca `ExitPlanMode`).
- O código do plano NÃO foi executado pelo planejador: erro de sintaxe ⇒ corrigir o MÍNIMO e registrar em `.superpowers/distribuicao/desvios.md` (erro literal, causa, correção). Diferença de REGRA (TS × SQL, número do mockup) ⇒ PARE e chame o controlador.

---

## 1. Fatos que o código abaixo assume (levantados em 25/set, na worktree e na cópia — só leitura)

- Todos os fatos da spec §4 (arquivos, linhas, funções vivas, contagens). Em especial: `_plan_tecido_gravar_bom_core` vivo NÃO grava `complementa_variante_ids` e apaga o casamento a cada aplicar; `_plan_tecido_arvore_core` é `LANGUAGE sql` (valida colunas no CREATE); `tenant_module_enabled` tem EXECUTE para PUBLIC/anon/authenticated (chamada pelas policies) e não lista `'distribuicao'`.
- Âncoras conferidas 1× cada no texto vivo da cópia (25/set, só leitura), com os espaços exatos:
  - `_salvar_plan_tecido_core`: `"          insert into plan_tecido_variantes (material_id, variante_tecido_id, cor_id, cor_apelido_id, ordem, multiplicador, grades, grade_total)\n"`, `"                 w.multiplicador, w.grades, w.grade_total\n"`, `"                coalesce((e->>'grade_total')::int,0)       as grade_total,\n"`.
  - `_plan_tecido_arvore_core`: `"                        'grades', vv.grades, 'grade_total', vv.grade_total) order by vv.ordem)\n"`.
  - `_plan_tecido_snapshot`: `"                      'grade_total', pv.grade_total\n"`.
  - `_plan_tecido_gravar_bom_core`: `"declare m jsonb; v jsonb; v_mt uuid; v_num int; v_tipo text;\n"`, `"  -- limpa só tecido/forro (entretela e demais tipos ficam intactos) + a grade planejada\n"`, e o bloco de 3 linhas do `insert into modelo_tecido_variantes (modelo_tecido_id, variante_tecido_id, ordem, multiplicador)` (ver `TROCAS` da Task 4).
  - `tenant_module_enabled`: `"    _module NOT IN ('otb', 'produto_acabado', 'produto_importado')\n"` e `"  -- ATENÇÃO: toda chave opt-in-default-OFF NOVA precisa entrar nesta lista — espelha\n"`.
  - O dump do `psql -A -t` termina em `"$function$\n\n"`; o texto canônico do `pg_get_functiondef` termina em `"$function$\n"` (1 `\n` a menos).
- md5 VIVOS de referência (cópia = retrato de produção `fidelidade_prod_pos_sem_trava_detalhe.txt`, 25/set 13:08 — o gerador RELÊ, não usa estes): `_salvar_plan_tecido_core` `ddadff5e…`, `_plan_tecido_arvore_core` `d8685568…`, `_plan_tecido_gravar_bom_core` `3cc5d45c…`, `_plan_tecido_snapshot` `c9492de3…`, `tenant_module_enabled` `0b87d95b…`; a remover: `direcionamento_resumo_subcolecao` `d431e4ed…`, `distribuicao_resumo` `dc8b90c4…`, `salvar_distribuicao_tabela` `0227b0fa…`, `excluir_distribuicao_tabela` `ee38685a…`.
- Retrato de fidelidade (`FIDEL_DET` do `bloco_apoio_v2.sh` da F1) tem SÓ as categorias `colunas`, `event_triggers`, `funcoes`, `gatilhos`, `indices`, `policies` (NÃO existe `tabelas`). Chaves: `funcoes:public.<nome>(<tipos>)`, `colunas:public.<tabela>.<coluna>`, `gatilhos:public.<tabela>.<gatilho>`, `indices:public.<índice>`, `policies:public.<tabela>.<policy>` e `policies:public.<tabela>.(rls)`. A tabela antiga ocupa 17 linhas (12 colunas, 1 gatilho, 2 policies, 2 índices) + 4 funções = 21. A F1 NÃO mexeu em nenhuma chave desta frente (conferido: `comm` pré×pós F1).
- `tenant_config.tamanhos_grade` formato `"34|PPP"`; Ark Store usa itens soltos; `modelos.tamanho_tipo` NULL na cópia (a reorg põe `DEFAULT 'letra'` + backfill; o front trata NULL como Letra). `NumberInput` transforma vazio em `"0"`. `DialogBody` NÃO repassa `ref` (o dialog usa uma `<div>` com as mesmas classes `min-h-0 overflow-y-auto` para ter o `scopeRef`).
- `pathDoElemento` (`src/lib/colab/colab-field-path.ts`) só aceita `input/textarea/select/[contenteditable]` ANTES de ler `data-colab-path`; nenhum botão do repo usa `data-colab-path` (grep). Eventos React de foco atravessam portal (o `onFocusCapture` do `<main>` do Plan. Tecido recebe o foco dos campos do dialog e do popover).
- Vitest roda em `environment: "node"` (sem DOM): testes de presença são de função pura (com elemento-stub) e de FONTE.
- `src/routeTree.gen.ts` é VERSIONADO e regenerado pelo `vite build` (o plugin do TanStack Router roda no build). A worktree não tem `node_modules` (Task 0 instala).

## 2. Rulings do plano (os de desenho estão na spec §3 — R1…R39)

| # | Ruling | Por quê | Custo se errado |
|---|---|---|---|
| PR1 | Duas migrations separadas (aditiva `20261006100000` e remoção `20261006110000`), duas suítes de integração, dois geradores. | A remoção roda DEPOIS do deploy (R29) e é irreversível sem o CSV; separar mantém cada inverso simples. | Um arquivo a mais. |
| PR2 | `materiaisParaAplicar(slot, ligado)` mora em `atendimento.ts` e ENVOLVE o `buildMateriaisAplicar` de `calc.ts` (que fica intacto). | `atendimento.ts` importa `varKey` de `calc.ts`; pôr o casamento dentro do `calc.ts` criaria import circular. | Nenhum. |
| PR3 | O 1º merge do Plan. Tecido espera `tamanhos` e os módulos da loja (`isFetched`/`!isLoading`) — senão a normalização rodaria sem a grade e sem o gate. | R6. | Meio segundo a mais para abrir, só na 1ª carga. |
| PR4 | O `patch` normaliza TODOS os slots do `next` (a normalização devolve o mesmo objeto quando nada muda; o `touched` segue pelo diff JSON de hoje). | O `onChange` do card faz `structuredClone` da árvore inteira — não há identidade para filtrar; o custo é o mesmo do diff JSON que já roda. | Nenhum mensurável (medir na QA com a Ave Rara na cópia). |
| PR5 | O dialog guarda um rascunho LOCAL e, no Salvar, aplica sobre o `slot` ATUAL (prop viva): só as cores do Tecido 1 com linha no rascunho e a proporção (se mudou). | Se alguém mudou o card (ou chegou merge) com o dialog aberto, não reverte o resto do slot. | Nenhum. |
| PR6 | O plano no Direcionamento vira um componente próprio `src/components/direcionamento/PlanoDoModeloCard.tsx` (pasta nova, fora de `components/producao/**` — gate "Dev intocado"). | A rota já tem 892 linhas. | Nenhum. |
| PR7 | Suítes de integração com modo `DIST_MIG_TXN=1` (aplica o SQL dentro da txn revertida — sem as 2 travas `SET LOCAL` do arquivo) e modo "já aplicada" (depois do ensaio/cópia). | Molde da reorg. | Nenhum. |
| PR8 | A medição de travas do `DROP TABLE` (Task 9 Step 1) roda na CÓPIA numa txn REVERTIDA com o N3 (aviso ao dono) e o resultado vai para `.superpowers/distribuicao/travas-drop.txt`; se aparecer trava em `auth.*`/`storage.*`/`realtime.*` o controlador leva ao dono antes de seguir (a remoção fica em horário calmo de qualquer jeito). | Memória `reference_policy_ddl_trava_auth` (DDL de policy trava auth/storage) + o `DROP TABLE` derruba a policy e os gatilhos de FK em `tenants`/`colecoes`. | Um PARE a mais. |
| PR9 | A QA do plano de escrita usa a cópia; o QA spec NÃO é versionado (`tests/e2e/distribuicao-qa.spec.ts`, apagado na limpeza). | R35 + molde. | Nenhum. |

## 3. Mapa de arquivos

| Arquivo | Responsabilidade | Task |
|---|---|---|
| `src/lib/distribuicao-produto.ts` (novo) | Regras puras do dialog: proporção, célula calculada, manuais, normalização, totais, tamanhos por tipo, abreviação, paths de presença | 1 |
| `tests/unit/distribuicao-produto.test.ts` (novo) | Números do mockup (Letra e Número) + regras | 1 |
| `src/lib/plan-tecido/atendimento.ts` (novo) | "Atende a" (automático/manual/1 por cor), pç derivado, normalização do slot/árvore, payload do aplicar com casamento | 2 |
| `tests/unit/plan-tecido-atendimento.test.ts` (novo) | Regras do "atende a" + normalização idempotente | 2 |
| `src/lib/plan-tecido/types.ts` | `PtVariante.distribuicao/atende`, `PtSlot.tamanho_tipo` | 3 |
| `src/lib/plan-tecido/engine.ts` | `ModeloReal*` com cor/casamento/tamanho_tipo; `slotDeModeloReal`; `comDistribuicaoDoPlano`, `comAtendeDoPlano`; merge | 3 |
| `tests/unit/plan-tecido-engine.test.ts` | Casos novos do engine | 3 |
| `supabase/migrations/20261006100000_distribuicao_por_produto.sql` + `supabase/rollback/…_down.sql` (gerados) | 2 colunas + CHECKs + 5 funções redefinidas + 2 novas | 4 |
| `tests/integration/distribuicao-produto.test.ts` (novo) | Estático + banco (SÓ cópia) da aditiva | 4 |
| `src/lib/colab/colab-field-path.ts` | `data-colab-path` explícito vale em qualquer elemento (R20) | 5 |
| `tests/unit/colab-field-path-explicito.test.ts` (novo) | Stub de elemento | 5 |
| `src/components/plan-tecido/AtendeAPopover.tsx` (novo) | Gatilho + popover "Atende a" | 5 |
| `src/components/plan-tecido/MaterialBlock.tsx` | pç só leitura, selo "distribuído", "atende a", avisos, `acaoExtra` | 5 |
| `src/components/plan-tecido/ModelCard.tsx` | Botão "Distribuir por loja", props de distribuição/presença, dialog | 5, 6 |
| `src/components/plan-tecido/PlanTecidoSheet.tsx` | Query (cor/casamento/tamanho_tipo), normalização no merge e no `patch`, payload com casamento, presença do dialog | 5 |
| `tests/unit/plan-tecido-distribuicao-fonte.test.ts` (novo) | Testes de FONTE: paths, gate, botão, overlay do dialog | 5, 6 |
| `src/components/plan-tecido/DistribuicaoTabelas.tsx` (novo) | As 2 tabelas (edição e impressão), desktop e mobile | 6 |
| `src/components/plan-tecido/DistribuirPorLojaDialog.tsx` (novo) | O dialog (rascunho, lojas, presença, impressão, salvar/zerar/descartar) | 6 |
| `src/lib/direcionamento-plano.ts` (novo) | Tipos da RPC, plano por variante, colunas, regra do preenchimento, textos | 7 |
| `tests/unit/direcionamento-plano.test.ts` (novo) | Números do mockup do Direcionamento | 7 |
| `src/components/direcionamento/PlanoDoModeloCard.tsx` (novo) | Card "Plano de distribuição do modelo" | 7 |
| `src/routes/_authenticated/expedicao.direcionamento.$modeloId.tsx` | Sai a tira; entra plano, contador, preenchimento, rótulos, InfoHover | 7 |
| `tests/unit/direcionamento-plano-fonte.test.ts` (novo) | FONTE: paths `dir:` nas células, RPC nova, sem RPC antiga | 7 |
| `src/routes/_authenticated/distribuicao.index.tsx`, `src/components/distribuicao/{DistribuicaoTabela,ResumoColecao}.tsx`, `src/lib/distribuicao.ts`, `tests/unit/distribuicao.test.ts` (APAGADOS) | Página antiga | 8 |
| `src/lib/nav.ts`, `src/lib/permissions-catalog.ts`, `src/components/app-sidebar.tsx`, `src/hooks/useTenantModules.ts`, `src/routes/_authenticated/admin/lojas.tsx`, `src/routeTree.gen.ts` | Sai a página; fica o módulo | 8 |
| `tests/unit/distribuicao-remocao.test.ts` (novo) | FONTE da remoção | 8 |
| `supabase/migrations/20261006110000_distribuicao_antiga_remover.sql` + `supabase/rollback/…_down.sql` (gerados) | DROP das 4 RPCs + tabela; inverso recria | 9 |
| `tests/integration/distribuicao-antiga-remover.test.ts` (novo) | Estático + banco (SÓ cópia) da remoção | 9 |
| `tests/e2e/distribuicao-qa.spec.ts` (NÃO versionar) | QA | 11 |
| `.superpowers/distribuicao/**` (não versionado) | regras, gates, `n3.sh`, `copia.sh`, `mig/*`, md5, logs | 0, 4, 9, 10 |
| `/Users/sunglee/PLM + Criação/savepoints/pre-apply-distribuicao/` (pasta 700, fora do repo) | `RODAR-distribuicao.md`, backups, CSV, retratos | 10, 11 |
| `docs/superpowers/specs/2026-09-25-distribuicao-por-produto-design.md`, `docs/superpowers/plans/2026-09-25-distribuicao-por-produto.md` | Spec e este plano | — |

## 4. Revisão e portões

| Task | Revisão (implementador Sonnet em todas) |
|---|---|
| 1 + 2 + 3 | **Lote A** — 1 revisão Opus depois da Task 3 (números do mockup; regra do "atende a"; idempotência; merge "Dev vence" sem perda; nenhum import circular) |
| 4 | **G-migration A**: 2 revisões Opus INDEPENDENTES (cada uma recebe só o plano, a spec, os 2 SQL, o `gerar_sql.py`, o `dump_antes.sh` e a suíte; não vê o parecer da outra) + guardião. Checklist na Task 4 Step 8 |
| 5 | **Individual Opus** (colab/presença; gate do módulo; alinhamento do Modo Plano; payload com casamento só com o módulo; `colab-field-path` sem efeito fora da frente) |
| 6 | **Individual Opus** (regras × lib; salvar/zerar/descartar; presença no portal; mobile; impressão) |
| 7 | **Individual Opus** (invariante #10: servidor intocado, estado completo, loja ativa/par histórico, `touched`/merge; regra do preenchimento × lib) |
| 8 | **Individual Opus** (curta: nada órfão, módulo continua ligável, routeTree) |
| 9 | **G-migration B**: 2 Opus independentes + guardião (medição de travas anexada) |
| 10 | **Opus + guardião (G-scripts)**: ensaio real na cópia; scripts no molde; provas com `psql`/`docker` falsos |
| 11 | controlador + guardião + dono |

**Portões do guardião (report-only, diário):** G-plano (este plano, antes da Task 0) · G-migration A (fim da Task 4) · G-migration B (fim da Task 9) · G-scripts (fim da Task 10) · G-commit (Task 11 Step 2) · G-produção A (Task 11 Step 5) · G-deploy (Task 11 Step 8) · G-produção B (Task 11 Step 10). BLOQUEIA ⇒ parar; APROVA COM RESSALVAS ⇒ resolver/registrar antes do passo seguinte.

---
## Task 0: Pré-voo (sem commit)

**Files:** nenhum no git. Cria `.superpowers/distribuicao/` (não versionado).

- [ ] **Step 1: Conferir a worktree (já existe — NÃO criar outra) e a base**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/distribuicao-produto"
echo "alvo: $(git rev-parse --show-toplevel) · branch $(git branch --show-current) · HEAD $(git rev-parse --short HEAD)"
[ "$(git branch --show-current)" = distribuicao/por-produto ] || { echo "PARE: branch errada"; exit 1; }
git status --porcelain | grep . && { echo "WORKTREE SUJA — PARE e avise o controlador"; exit 1; }
git log --oneline -4
git merge-base --is-ancestor feature/plan-tecido-a1 HEAD && echo "base em dia" || echo "a principal andou — Step 1b"
```

Expected: branch `distribuicao/por-produto`, worktree limpa, os 2 commits de docs (spec e plano) no topo de `13ec1dae`, `base em dia`.

- [ ] **Step 1b (só se a principal andou): rebase**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/distribuicao-produto"
git rebase feature/plan-tecido-a1 && git log --oneline -4
```

Conflito ⇒ PARE e avise o controlador (nada de `stash`).

- [ ] **Step 2: Pastas, BASE, `.env`, dependências**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/distribuicao-produto"
mkdir -p .superpowers/distribuicao/mig/antes .superpowers/distribuicao/logs .superpowers/distribuicao/qa
git rev-parse HEAD > .superpowers/distribuicao/BASE
[ -f .env ] || cp "/Users/sunglee/PLM + Criação/plm-pcp/.env" .env   # nunca imprimir o conteúdo
[ -x node_modules/.bin/vite ] || npm ci --silent
echo "BASE $(cut -c1-8 .superpowers/distribuicao/BASE)"
```

- [ ] **Step 3: Regras da frente — `.superpowers/distribuicao/regras.md`**

```markdown
# Regras da Distribuição por produto — TODO executor lê antes de CADA task

1. Só na worktree `.claude/worktrees/distribuicao-produto` (branch `distribuicao/por-produto`); todo comando DE DENTRO dela.
   Gates e scripts imprimem o alvo + HEAD e param fora dela.
2. Commit: `git add -- <arquivos exatos da task>` + `git commit --only -m "…" -- <arquivos>` + `git show --stat HEAD`.
   PROIBIDO `git add .`/`-A`/`commit -a`, `git stash`, push, `pkill`/`killall`. Mensagem termina com
   `Co-Authored-By: Claude <seu modelo real> <noreply@anthropic.com>`.
3. Antes de TODO commit: `bash .superpowers/distribuicao/gates.sh` → `GATES DIST: ok`. Falhou = PARE.
4. PRODUÇÃO: nada (nem SELECT, nem `/tmp/dburl.txt`, nem `*.supabase.co`). Só o DONO, na Task 11, pelos scripts.
5. Cópia (127.0.0.1:54422): DDL SÓ por `DIST_MIG_TXN=1` nas suítes (txn revertida), pelos scripts `.superpowers/distribuicao/`
   ou pela medição da Task 9. Antes, o CONTROLADOR avisa o dono (texto do `n3.sh`) e, com o OK,
   `DIST_DONO_AVISADO=sim bash .superpowers/distribuicao/n3.sh antes <passo>`; depois `bash .superpowers/distribuicao/n3.sh depois <passo>`.
   NUNCA `\i` de migration; nada de probe.
6. Todo vitest (unit E integração): SEMPRE `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres` explícito
   (nunca `env -u`) + caminho LITERAL; antes, `ps -Ao pid,command | grep -E "[v]itest|[p]laywright"` vazio (um por vez na cópia).
7. Leitura na cópia: `PGOPTIONS='-c default_transaction_read_only=on' psql …`.
8. Migrations e inversos são GERADOS por `.superpowers/distribuicao/mig/gerar_sql.py` / `gerar_remocao.py` — nunca editar os .sql à mão.
9. Dev intocado (`src/components/desenvolvimento/**`, `src/components/producao/**`, `CadTecidosSection.tsx`).
   Arquivos da REORGANIZAÇÃO (frente paralela) intocados: `src/components/planejamento/planejamento-detail/**`,
   `FormatoSkuCard.tsx`, `sku-montar.ts`, `admin/configuracoes.tsx`, `titulo-pagina.ts`, migration/rollback `20261005100000`,
   função `_replicar_cards_plan_tecido_core`.
10. Tela: `mensagemErro`, cor só por token/classe, textos do plano verbatim, `data-colab-path` do plano.
11. Não subir/derrubar servidor; nunca `:5173`/`:5188`. Não despachar subagentes. Nunca imprimir senha/.env.
12. Erro de sintaxe do código do plano: corrigir o mínimo e registrar em `.superpowers/distribuicao/desvios.md`. Diferença de
    REGRA (número do mockup, TS × SQL) ou dúvida de negócio: PARE e chame o controlador (ele leva ao dono por chat).
```

- [ ] **Step 4: Lista permitida — `.superpowers/distribuicao/permitidos.txt`**

```text
docs/superpowers/specs/2026-09-25-distribuicao-por-produto-design.md
docs/superpowers/plans/2026-09-25-distribuicao-por-produto.md
src/lib/distribuicao-produto.ts
src/lib/plan-tecido/atendimento.ts
src/lib/plan-tecido/types.ts
src/lib/plan-tecido/engine.ts
src/lib/colab/colab-field-path.ts
src/lib/direcionamento-plano.ts
src/components/plan-tecido/AtendeAPopover.tsx
src/components/plan-tecido/MaterialBlock.tsx
src/components/plan-tecido/ModelCard.tsx
src/components/plan-tecido/PlanTecidoSheet.tsx
src/components/plan-tecido/DistribuicaoTabelas.tsx
src/components/plan-tecido/DistribuirPorLojaDialog.tsx
src/components/direcionamento/PlanoDoModeloCard.tsx
src/routes/_authenticated/expedicao.direcionamento.$modeloId.tsx
src/routes/_authenticated/distribuicao.index.tsx
src/components/distribuicao/DistribuicaoTabela.tsx
src/components/distribuicao/ResumoColecao.tsx
src/lib/distribuicao.ts
src/lib/nav.ts
src/lib/permissions-catalog.ts
src/components/app-sidebar.tsx
src/hooks/useTenantModules.ts
src/routes/_authenticated/admin/lojas.tsx
src/routeTree.gen.ts
supabase/migrations/20261006100000_distribuicao_por_produto.sql
supabase/rollback/20261006100000_distribuicao_por_produto_down.sql
supabase/migrations/20261006110000_distribuicao_antiga_remover.sql
supabase/rollback/20261006110000_distribuicao_antiga_remover_down.sql
tests/unit/distribuicao-produto.test.ts
tests/unit/plan-tecido-atendimento.test.ts
tests/unit/plan-tecido-engine.test.ts
tests/unit/colab-field-path-explicito.test.ts
tests/unit/plan-tecido-distribuicao-fonte.test.ts
tests/unit/direcionamento-plano.test.ts
tests/unit/direcionamento-plano-fonte.test.ts
tests/unit/distribuicao-remocao.test.ts
tests/unit/distribuicao.test.ts
tests/integration/distribuicao-produto.test.ts
tests/integration/distribuicao-antiga-remover.test.ts
tests/e2e/distribuicao-qa.spec.ts
```

(Os 5 arquivos da página antiga entram porque são APAGADOS na Task 8. `CLAUDE.md` fica FORA — o controlador o commita na principal, Task 11 Step 11, R39.)

- [ ] **Step 5: `.superpowers/distribuicao/gates.sh`**

```bash
#!/usr/bin/env bash
# Gates de TODO commit da Distribuição por produto. Uso (DE DENTRO da worktree): bash .superpowers/distribuicao/gates.sh
# → "GATES DIST: ok" (código 0). NÃO roda tests/integration (cada task de banco roda a sua suíte com DATABASE_URL local).
set -uo pipefail
TOP="$(git rev-parse --show-toplevel)" || exit 1
case "$TOP" in */.claude/worktrees/distribuicao-produto) ;; *) echo "GATE FALHOU: rode de dentro da worktree distribuicao-produto (achei $TOP)"; exit 1;; esac
cd "$TOP"
S=.superpowers/distribuicao
echo "== gates distribuicao · alvo: $TOP · HEAD $(git rev-parse --short HEAD) ($(git branch --show-current))"
falha() { echo "GATE FALHOU: $1"; exit 1; }
BASE="$(git merge-base feature/plan-tecido-a1 HEAD)"
mkdir -p "$S/logs"
npx tsc --noEmit > "$S/logs/tsc.log" 2>&1 || { tail -20 "$S/logs/tsc.log"; falha "tsc (o build NÃO faz type-check)"; }
npm run build > "$S/logs/build.log" 2>&1 || { tail -20 "$S/logs/build.log"; falha "build"; }
# O build regera o routeTree. `checkout --` volta ao que está no ÍNDICE: descarta o ruído do build e PRESERVA a versão
# nova que a Task 8 deixou no índice (git add -- src/routeTree.gen.ts ANTES dos gates).
git checkout -- src/routeTree.gen.ts 2>/dev/null || true
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres npx vitest run --no-file-parallelism tests/unit > "$S/logs/unit.log" 2>&1
grep -qE "Test Files .*passed" "$S/logs/unit.log" || { tail -20 "$S/logs/unit.log"; falha "unit (sem resumo)"; }
grep -E "^ FAIL " "$S/logs/unit.log" | sed -E 's/ +[0-9]+ms$//' | sort -u > "$S/logs/unit-fail-agora.txt"
diff -q "$S/unit-fail-base.txt" "$S/logs/unit-fail-agora.txt" > /dev/null \
  || { diff "$S/unit-fail-base.txt" "$S/logs/unit-fail-agora.txt"; falha "unit (falhas ≠ linha de base — inclui o anti-drift de UI)"; }
FORA="$( { git diff --name-only "$BASE" HEAD; git diff --name-only; git diff --name-only --cached; \
           git ls-files --others --exclude-standard; } | sort -u | grep -vxF -f "$S/permitidos.txt" || true)"
[ -z "$FORA" ] || { echo "$FORA"; falha "arquivo fora da lista permitida ($S/permitidos.txt)"; }
REORG="$( { git diff --name-only "$BASE" HEAD; git diff --name-only; git diff --name-only --cached; } \
          | grep -E '^(src/components/planejamento/planejamento-detail/|src/components/configuracoes/FormatoSkuCard\.tsx$|src/lib/sku-montar\.ts$|src/routes/_authenticated/admin/configuracoes\.tsx$|src/lib/titulo-pagina\.ts$|supabase/(migrations|rollback)/20261005100000_)' || true)"
[ -z "$REORG" ] || { echo "$REORG"; falha "arquivo da REORGANIZAÇÃO do Sheet (frente paralela) mexido"; }
if grep -l '_replicar_cards_plan_tecido_core' supabase/migrations/2026100610000*_*.sql supabase/migrations/2026100611000*_*.sql 2>/dev/null | grep .; then
  falha "migration desta frente cita _replicar_cards_plan_tecido_core (é da reorganização — R25)"
fi
[ -z "$(git diff --name-only savepoint-pre-unificacao-2026-09-22 -- src/components/desenvolvimento/ src/components/producao/ src/components/producao/cad/CadTecidosSection.tsx)" ] \
  || falha "Dev/Produção mudou desde o save point (decisão travada 8)"
for f in $(grep '^src/' "$S/permitidos.txt"); do
  [ -f "$f" ] || continue
  if grep -n 'type="date"' "$f"; then falha "<input type=\"date\"> em $f — use <DateField>"; fi
  if grep -nE 'toast\.error\((e|err|error)\.message' "$f"; then falha "toast de erro sem mensagemErro em $f"; fi
done
[ "$(git show feature/plan-tecido-a1:tests/integration/mig-txn.ts)" = "$(cat tests/integration/mig-txn.ts)" ] \
  || falha "tests/integration/mig-txn.ts mudou (é compartilhado — não editar)"
git diff --quiet "$BASE" HEAD -- src/integrations/supabase/types.ts && git diff --quiet -- src/integrations/supabase/types.ts \
  || falha "src/integrations/supabase/types.ts mudou (proibido)"
echo "GATES DIST: ok"
```

- [ ] **Step 6: `.superpowers/distribuicao/n3.sh` (aviso ao dono antes de DDL na cópia)**

```bash
#!/usr/bin/env bash
# N3 — a cópia local (:54422) é também o APP DE TESTE do dono (:5188). Toda rodada com DDL na cópia (suítes com
# DIST_MIG_TXN=1, medição da Task 9, ensaio, copia.sh) segura ACCESS EXCLUSIVE em `plan_tecido_variantes` (aditiva) ou em
# `distribuicao_tabelas`/`tenants`/`colecoes` (remoção) dentro de transação: o :5188 pode CONGELAR por alguns segundos
# (tenants é lida por get_user_tenant_id() em toda policy). SÓ LEITURA. Uso:
#   DIST_DONO_AVISADO=sim bash .superpowers/distribuicao/n3.sh antes <passo>     ex.: t4s3, t9s1, t10, t11-copia
#   bash .superpowers/distribuicao/n3.sh depois <passo>
set -uo pipefail
TOP="$(git rev-parse --show-toplevel)" || exit 1
case "$TOP" in */.claude/worktrees/distribuicao-produto) ;; *) echo "PARE: rode de dentro da worktree distribuicao-produto"; exit 1;; esac
cd "$TOP"
LOCAL="postgresql://postgres:postgres@127.0.0.1:54422/postgres"
QUANDO="${1:-}"; PASSO="${2:-}"
case "$QUANDO" in antes|depois) ;; *) echo "uso: n3.sh antes|depois <passo>"; exit 2 ;; esac
[ -n "$PASSO" ] || { echo "uso: n3.sh antes|depois <passo>"; exit 2; }
mkdir -p .superpowers/distribuicao/logs
docker ps --filter name=supabase_db_banco-local --format '{{.Status}}' | grep -q '^Up' \
  || { echo "PARE: cópia fora do ar (não subir/recriar por conta própria)"; exit 1; }
if [ "$QUANDO" = antes ]; then
  if ps -Ao command | grep -E "[v]itest|[p]laywright" > /dev/null; then
    ps -Ao pid,command | grep -E "[v]itest|[p]laywright"; echo "PARE: vitest/playwright rodando (um por vez na cópia)"; exit 1
  fi
  N=$(PGCONNECT_TIMEOUT=5 psql "$LOCAL" -X -A -t -v ON_ERROR_STOP=1 -c "select count(*) from pg_stat_activity where datname = current_database() and backend_type = 'client backend' and pid <> pg_backend_pid() and state <> 'idle'") \
    || { echo "PARE: não conectei na cópia"; exit 1; }
  [ "$N" = 0 ] || { echo "PARE: $N sessão(ões) ativa(s) na cópia — outra frente usando; esperar"; exit 1; }
  if [ "${DIST_DONO_AVISADO:-}" != sim ]; then
    cat <<'MSG'
PARE: avise o dono no chat ANTES e espere o OK (depois rode de novo com DIST_DONO_AVISADO=sim):
  "Vou rodar <passo> da Distribuição por produto na cópia local agora (~<N> min). Enquanto roda, o app de teste :5188
   pode congelar por alguns segundos de cada vez (ALTER/DROP dentro de transação). Se estiver usando o :5188, salve e me
   avise quando posso começar."
MSG
    exit 1
  fi
fi
E=$(PGOPTIONS='-c default_transaction_read_only=on' psql "$LOCAL" -X -A -t -c "select (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public') || '|' || (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and not t.tgisinternal) || '|A=' || (to_regprocedure('public.direcionamento_plano_modelo(uuid)') is not null) || '|antiga=' || (to_regclass('public.distribuicao_tabelas') is not null)") \
  || { echo "PARE: não li o estado da cópia"; exit 1; }
P=$(lsof -nP -iTCP:5188 -sTCP:LISTEN -t 2>/dev/null | head -1)
AV=""; [ "$QUANDO" = antes ] && AV=" · dono avisado"
echo "$(date '+%F %T') $QUANDO $PASSO: funções|gatilhos|aditiva|antiga = $E · :5188 $([ -n "$P" ] && echo "no ar (PID $P)" || echo "fora do ar")$AV" \
  | tee -a .superpowers/distribuicao/logs/n3.log
[ "$QUANDO" = antes ] && echo "OK (N3): pode rodar $PASSO"
exit 0
```

- [ ] **Step 7: Linha de base e gates**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/distribuicao-produto"
chmod +x .superpowers/distribuicao/gates.sh .superpowers/distribuicao/n3.sh
bash .superpowers/distribuicao/n3.sh antes t0; echo "sem-aviso=$?"     # sem DIST_DONO_AVISADO: mostra o texto e sai 1
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres npx vitest run --no-file-parallelism tests/unit > .superpowers/distribuicao/logs/unit-base.log 2>&1; tail -6 .superpowers/distribuicao/logs/unit-base.log
grep -E "^ FAIL " .superpowers/distribuicao/logs/unit-base.log | sed -E 's/ +[0-9]+ms$//' | sort -u > .superpowers/distribuicao/unit-fail-base.txt; cat .superpowers/distribuicao/unit-fail-base.txt
bash .superpowers/distribuicao/gates.sh; echo "código=$?"
```

Expected: `sem-aviso=1`; `unit-fail-base.txt` com as falhas HERDADAS (anotar); `GATES DIST: ok` e `código=0`. Código 1 aqui = base quebrada: PARE e reporte.

- [ ] **Step 8: Sobreposição com as frentes abertas (regra de rebase)**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/distribuicao-produto"
B=feature/plan-tecido-a1; P=.superpowers/distribuicao/permitidos.txt
for br in $(git branch --format='%(refname:short)' | grep -vE '^(feature/plan-tecido-a1|distribuicao/por-produto|main|bkp/|backup-)'); do
  git cherry "$B" "$br" | grep -q '^+' || continue   # branch sem commit fora da principal não conta
  git diff --name-only "$B...$br" 2>/dev/null | grep -xF -f "$P" | sed "s|^|SOBREPOE $br: |"
  git diff --name-only "$B...$br" -- supabase/migrations 2>/dev/null | while read -r f; do
    git show "$br:$f" | grep -qE "_salvar_plan_tecido_core|_plan_tecido_arvore_core|_plan_tecido_gravar_bom_core|_plan_tecido_snapshot|FUNCTION public\.tenant_module_enabled|distribuicao_tabelas|direcionamento_resumo_subcolecao|ALTER TABLE (public\.)?plan_tecido_variantes" \
      && echo "SOBREPOE-BANCO $br: $f"
  done
done
echo "sobreposicao-checada"
```

Expected (25/set): só `sobreposicao-checada` (a `sheet/reorganizacao` NÃO toca nenhum arquivo nem função desta lista — conferido no planejamento; `aviso-global` toca sidebar/rotas: se aparecer `SOBREPOE aviso-global…: src/components/app-sidebar.tsx`/`src/routeTree.gen.ts`, vale a regra). **Regra de rebase** (até o merge): `SOBREPOE <branch>: <arquivo>` ⇒ quem entra primeiro na principal ganha; esta frente faz `git rebase feature/plan-tecido-a1` (worktree limpa, sem stash), resolve PRESERVANDO o texto da outra frente e reaplicando a intenção da task daqui (o `routeTree.gen.ts` é regerado pelo build — nunca resolvido à mão), roda `gates.sh`, e a task que edita o arquivo é re-revisada (Opus) com o diff. `SOBREPOE-BANCO` ⇒ PARE: a guarda de md5 vai recusar — refazer a Task 4/9 (dump + gerar) DEPOIS que a outra migration estiver na cópia, e re-rodar as Tasks 4, 9 e 10. Repetir este Step na Task 11.

- [ ] **Step 9: Estado da cópia (SÓ LEITURA)**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/distribuicao-produto"
LOCAL="postgresql://postgres:postgres@127.0.0.1:54422/postgres"
docker ps --filter name=supabase_db_banco-local --format '{{.Status}}'
PGOPTIONS='-c default_transaction_read_only=on' psql "$LOCAL" -X -A -t -F' ' -c "
  select (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'),
         (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal),
         (select count(*) from information_schema.columns where table_schema='public' and table_name='plan_tecido_variantes' and column_name in ('distribuicao','atende')),
         to_regprocedure('public.direcionamento_plano_modelo(uuid)') is null,
         to_regclass('public.distribuicao_tabelas') is not null,
         (select count(*) from pg_proc where oid in (to_regprocedure('public.distribuicao_resumo(uuid,text)'), to_regprocedure('public.salvar_distribuicao_tabela(jsonb)'), to_regprocedure('public.excluir_distribuicao_tabela(uuid)'), to_regprocedure('public.direcionamento_resumo_subcolecao(uuid)'))),
         to_regprocedure('public._titulo_pagina_calculado(text,text)') is not null" \
  | tee .superpowers/distribuicao/copia-estado-t0.txt
```

Expected: `Up … (healthy)`; `483 277 0 t t 4 f` (a reorg já na cópia ⇒ `484 277 0 t t 4 t` — anotar; as colunas desta frente TÊM de ser `0` e a RPC nova ausente — senão alguém aplicou esta migration: PARE).

---
## Task 1: `src/lib/distribuicao-produto.ts` — regras puras do dialog  *(Lote A — revisão junto com as Tasks 2 e 3)*

**Files:**
- Create: `src/lib/distribuicao-produto.ts`
- Test: `tests/unit/distribuicao-produto.test.ts`

**Interfaces:**
- Consumes: `parseTamanho`, `ladoTamanho`, `TamanhoTipo` de `src/lib/tamanho.ts` (existentes).
- Produces (Tasks 2, 3, 5, 6, 7): `type DistLoja = { base: number; grades: Record<string, number>; manuais: string[] }`, `type Distribuicao = Record<string, DistLoja>`, `type Proporcoes = Record<string, number> | null | undefined`, `type CelulaVista = { valor: number; calculado: number; manual: boolean }`, `proporcaoDoTamanho(prop, t): number`, `celulaCalculada(prop, t, base): number`, `tamanhosDoTipo(grade: string[], tipo: TamanhoTipo): string[]`, `rotuloTamanho(t, tipo): string`, `tipoDoProduto(t: string | null | undefined): TamanhoTipo`, `recalcularLinha(l, prop, tamanhos): DistLoja`, `normalizarDistribuicao(d, prop, tamanhos): Distribuicao`, `temDistribuicao(d): boolean`, `totaisDaDistribuicao(d): { grades; total; base }`, `linhaVista(l, prop, tamanhos): { base; celulas: Record<string, CelulaVista>; total }`, `somaVistas(vistas, tamanhos): { base; grades; total }`, `definirBase(d, loja, base, prop, tamanhos)`, `definirCelula(d, loja, t, valor, prop, tamanhos)`, `voltarAoCalculado(d, loja, t, prop, tamanhos)`, `definirProporcao(prop, tamanhos, t, valor): Record<string, number>`, `abreviarNome(s): string`, `chaveSlot(slot): string`, `pathDistProp`, `pathDistBase`, `pathDistCel`, `pathDistAberto`, `pathEhDoProduto`, `TEXTO_AJUDA_DIST`.

- [ ] **Step 1: Escrever o teste (falha)** — `tests/unit/distribuicao-produto.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  abreviarNome, celulaCalculada, chaveSlot, definirBase, definirCelula, definirProporcao, linhaVista, normalizarDistribuicao,
  pathDistAberto, pathDistBase, pathDistCel, pathDistProp, pathEhDoProduto, proporcaoDoTamanho, rotuloTamanho, somaVistas,
  tamanhosDoTipo, temDistribuicao, tipoDoProduto, totaisDaDistribuicao, voltarAoCalculado, type Distribuicao,
} from "@/lib/distribuicao-produto";

const GRADE = ["34|PPP", "36|PP", "38|P", "40|M", "42|G", "44|GG"];
const PROP_LETRA = { "34|PPP": 0, "36|PP": 0, "38|P": 1, "40|M": 2, "42|G": 2, "44|GG": 1 };
const EC = "loja-ecom", LF = "loja-fisica", AT = "loja-atacado";

/** Monta a distribuição de UMA cor a partir das Bases por loja (e correções à mão). */
function cor(bases: Record<string, number>, prop: Record<string, number>, tams: string[], manuais: [string, string, number][] = []): Distribuicao {
  let d: Distribuicao = {};
  for (const [loja, b] of Object.entries(bases)) d = definirBase(d, loja, b, prop, tams);
  for (const [loja, t, v] of manuais) d = definirCelula(d, loja, t, v, prop, tams);
  return d;
}

describe("distribuicao-produto — mockup em LETRA (VESTIDO LONGO POEMA)", () => {
  const tams = tamanhosDoTipo(GRADE, "letra");
  const marrom = cor({ [EC]: 5, [LF]: 3, [AT]: 4 }, PROP_LETRA, tams, [[EC, "38|P", 4]]);
  const preto = cor({ [EC]: 6, [LF]: 4, [AT]: 5 }, PROP_LETRA, tams);
  const vinho = cor({ [EC]: 3, [LF]: 2 }, PROP_LETRA, tams);

  it("célula = round(proporção × Base); PPP/PP (proporção 0) = 0", () => {
    expect(celulaCalculada(PROP_LETRA, "40|M", 6)).toBe(12);
    expect(celulaCalculada(PROP_LETRA, "34|PPP", 6)).toBe(0);
  });
  it("E-commerce · Marrom: P corrigido à mão para 4 (calculado 5) → linha 29; a célula guarda o manual", () => {
    const v = linhaVista(marrom[EC], PROP_LETRA, tams);
    expect(v.celulas["38|P"]).toEqual({ valor: 4, calculado: 5, manual: true });
    expect(v.total).toBe(29);
    expect(marrom[EC].manuais).toEqual(["38|P"]);
  });
  it("totais por cor = pç no card: Marrom 71 · Preto 90 · Vinho 30 = 191", () => {
    expect(totaisDaDistribuicao(marrom).total).toBe(71);
    expect(totaisDaDistribuicao(preto).total).toBe(90);
    expect(totaisDaDistribuicao(vinho).total).toBe(30);
    expect(totaisDaDistribuicao(marrom).grades).toEqual({ "38|P": 11, "40|M": 24, "42|G": 24, "44|GG": 12 });
    expect(totaisDaDistribuicao(marrom).base).toBe(12);
  });
  it("subtotal por loja: E-commerce 83 (Base 14; P 13 · M 28 · G 28 · GG 14); Atacado 54 sem Vinho", () => {
    const ec = somaVistas([marrom, preto, vinho].map((d) => linhaVista(d[EC], PROP_LETRA, tams)), tams);
    expect(ec).toEqual({ base: 14, grades: { "34|PPP": 0, "36|PP": 0, "38|P": 13, "40|M": 28, "42|G": 28, "44|GG": 14 }, total: 83 });
    const at = somaVistas([marrom, preto, vinho].map((d) => linhaVista(d[AT], PROP_LETRA, tams)), tams);
    expect(at.total).toBe(54);
    expect(vinho[AT]).toBeUndefined(); // Base vazia e sem célula à mão = a linha nem existe (R8)
  });
  it("P-23 = A: mudar a Base NÃO mexe no corrigido à mão; só os calculados acompanham", () => {
    const d = definirBase(marrom, EC, 6, PROP_LETRA, tams);
    expect(linhaVista(d[EC], PROP_LETRA, tams).celulas["38|P"]).toEqual({ valor: 4, calculado: 6, manual: true });
    expect(d[EC].grades["40|M"]).toBe(12);
  });
  it("↺ voltar ao calculado tira o ponto; digitar o próprio calculado também não marca", () => {
    const d = voltarAoCalculado(marrom, EC, "38|P", PROP_LETRA, tams);
    expect(d[EC].manuais).toEqual([]);
    expect(d[EC].grades["38|P"]).toBe(5);
    const d2 = definirCelula(preto, EC, "40|M", 12, PROP_LETRA, tams);
    expect(d2[EC].manuais).toEqual([]);
  });
  it("célula à mão = 0 fica guardada (manual) e some do total", () => {
    const d = definirCelula(preto, LF, "44|GG", 0, PROP_LETRA, tams);
    expect(d[LF].grades["44|GG"]).toBe(0);
    expect(d[LF].manuais).toEqual(["44|GG"]);
    expect(totaisDaDistribuicao(d).total).toBe(86);
  });
  it("Base 0 sem célula à mão tira a linha (R8); com célula à mão a linha fica", () => {
    expect(definirBase(preto, EC, 0, PROP_LETRA, tams)[EC]).toBeUndefined();
    expect(definirBase(marrom, EC, 0, PROP_LETRA, tams)[EC]).toEqual({ base: 0, grades: { "38|P": 4 }, manuais: ["38|P"] });
  });
  it("mudar a proporção recalcula só as não-manuais (normalizarDistribuicao)", () => {
    const np = definirProporcao(PROP_LETRA, tams, "40|M", 3);
    const d = normalizarDistribuicao(marrom, np, tams);
    expect(d[EC].grades).toEqual({ "38|P": 4, "40|M": 15, "42|G": 10, "44|GG": 5 });
  });
  it("normalizar sem tamanhos (grade não carregou) mantém as células gravadas", () => {
    expect(normalizarDistribuicao(marrom, PROP_LETRA, [])).toEqual(marrom);
  });
  it("normalizar tira célula de tamanho fora da grade e é idempotente", () => {
    const sujo: Distribuicao = { [EC]: { base: 2, grades: { "38|P": 2, "99|XG": 7 }, manuais: ["99|XG"] } };
    const d = normalizarDistribuicao(sujo, PROP_LETRA, tams);
    expect(d[EC]).toEqual({ base: 2, grades: { "38|P": 2, "40|M": 4, "42|G": 4, "44|GG": 2 }, manuais: [] });
    expect(normalizarDistribuicao(d, PROP_LETRA, tams)).toEqual(d);
  });
  it("temDistribuicao", () => {
    expect(temDistribuicao(marrom)).toBe(true);
    expect(temDistribuicao({})).toBe(false);
    expect(temDistribuicao(undefined)).toBe(false);
  });
});

describe("distribuicao-produto — mockup em NÚMERO (CALÇA PANTALONA LUNA)", () => {
  const tams = tamanhosDoTipo(GRADE, "numero");
  const prop = { "34|PPP": 0, "36|PP": 1, "38|P": 1, "40|M": 1, "42|G": 1, "44|GG": 0 };
  const bege = cor({ [EC]: 14, [LF]: 6, [AT]: 10 }, prop, tams, [[EC, "36|PP", 13]]);
  const preto = cor({ [EC]: 10, [LF]: 5, [AT]: 8 }, prop, tams);
  it("rótulos em número; 36 à mão 13 → E-commerce Bege 55; Bege 119 · Preto 92 = 211; E-commerce 95", () => {
    expect(tams.map((t) => rotuloTamanho(t, "numero"))).toEqual(["34", "36", "38", "40", "42", "44"]);
    expect(linhaVista(bege[EC], prop, tams).total).toBe(55);
    expect(totaisDaDistribuicao(bege).total).toBe(119);
    expect(totaisDaDistribuicao(preto).total).toBe(92);
    expect(somaVistas([bege, preto].map((d) => linhaVista(d[EC], prop, tams)), tams).total).toBe(95);
  });
});

describe("distribuicao-produto — tamanhos, proporção legada, tipo, abreviação, paths", () => {
  it("tamanhosDoTipo: par entra sempre; solto só com o lado do tipo; nenhum com o lado ⇒ todos (R11)", () => {
    const ark = ["36", "38", "40", "42", "44", "PP", "P", "M", "G", "GG"];
    expect(tamanhosDoTipo(ark, "letra")).toEqual(["PP", "P", "M", "G", "GG"]);
    expect(tamanhosDoTipo(ark, "numero")).toEqual(["36", "38", "40", "42", "44"]);
    expect(tamanhosDoTipo(["UN"], "numero")).toEqual(["UN"]);
    expect(tamanhosDoTipo(GRADE, "letra")).toEqual(GRADE);
  });
  it("proporção com chave legada só-letra/só-número", () => {
    expect(proporcaoDoTamanho({ P: 2 }, "38|P")).toBe(2);
    expect(proporcaoDoTamanho({ "38": 3 }, "38|P")).toBe(3);
    expect(proporcaoDoTamanho({ "38|P": 1, P: 9 }, "38|P")).toBe(1);
    expect(proporcaoDoTamanho(null, "38|P")).toBe(0);
  });
  it("definirProporcao congela as chaves cheias exibidas e troca só o tamanho digitado", () => {
    expect(definirProporcao({ P: 2 }, ["38|P", "40|M"], "40|M", 3)).toEqual({ "38|P": 2, "40|M": 3 });
  });
  it("tipoDoProduto: NULL/sem modelo ⇒ Letra (P-25)", () => {
    expect(tipoDoProduto(null)).toBe("letra");
    expect(tipoDoProduto("numero")).toBe("numero");
  });
  it("abreviarNome: até antes da 2ª vogal (mockup mobile)", () => {
    expect(abreviarNome("Marrom Canela")).toBe("Marr. Can.");
    expect(abreviarNome("Preto")).toBe("Pret.");
    expect(abreviarNome("Vinho Bordô")).toBe("Vinh. Bord.");
    expect(abreviarNome("Bege")).toBe("Bege");
  });
  it("paths de presença (R19) e chave do slot", () => {
    expect(chaveSlot({ id: "s1", modelo_id: "m1" })).toBe("s1");
    expect(chaveSlot({ modelo_id: "m1" })).toBe("m1");
    expect(pathDistProp("s1", "38|P")).toBe("dist:s1:prop:38|P");
    expect(pathDistBase("s1", EC, "v1")).toBe("dist:s1:loja-ecom:v1:base");
    expect(pathDistCel("s1", EC, "plan:c|a", "38|P")).toBe("dist:s1:loja-ecom:plan:c|a:38|P");
    expect(pathDistAberto("s1")).toBe("dist:s1:aberto");
    expect(pathEhDoProduto("dist:s1:aberto", "s1")).toBe(true);
    expect(pathEhDoProduto("dist:s10:aberto", "s1")).toBe(false);
    expect(pathEhDoProduto(null, "s1")).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/distribuicao-produto"
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres npx vitest run tests/unit/distribuicao-produto.test.ts 2>&1 | tail -5
```

Expected: FAIL — `Failed to resolve import "@/lib/distribuicao-produto"`.

- [ ] **Step 3: Implementar — `src/lib/distribuicao-produto.ts`**

```ts
// Distribuição por produto — regras PURAS do dialog "Distribuir por loja" (Plan. Tecido) e da derivação do pç.
// Spec: docs/superpowers/specs/2026-09-25-distribuicao-por-produto-design.md (R1, R8–R12, R19, §5.2). Sem I/O.
//
// Formato gravado em plan_tecido_variantes.distribuicao (SÓ Tecido 1):
//   { "<loja_id>": { base: n, grades: { "<tamanho>": q }, manuais: ["<tamanho>", …] } }
// `grades` guarda as células RESOLVIDAS: a calculada (round(proporção × Base)) quando > 0 e a corrigida à mão SEMPRE
// (até 0). `manuais` = tamanhos corrigidos à mão (P-09 = D) — mudar a Base/proporção não os toca (P-23 = A).
// Linha de loja com Base 0 e sem célula à mão NÃO existe (R8: o NumberInput não distingue vazio de 0).
import { ladoTamanho, parseTamanho, type TamanhoTipo } from "@/lib/tamanho";

export type DistLoja = { base: number; grades: Record<string, number>; manuais: string[] };
export type Distribuicao = Record<string, DistLoja>;
export type Proporcoes = Record<string, number> | null | undefined;
export type CelulaVista = { valor: number; calculado: number; manual: boolean };

/** Texto de ajuda do dialog (mockup, sem o "Exemplo — …" ilustrativo — R33). */
export const TEXTO_AJUDA_DIST =
  "Digite a Base de cada loja × cor: os tamanhos saem sozinhos, proporção × Base. Qualquer quadradinho pode ser " +
  "corrigido à mão: ele ganha um ponto, e o ↺ volta ao calculado. Mudar a Base não mexe no que foi corrigido à mão. " +
  "Tamanho com proporção 0 fica esmaecido, mas dá para digitar.";

const tem = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** Inteiro ≥ 0 (arredonda; lixo/negativo = 0). */
function inteiro(v: unknown): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Proporção de UM tamanho pela chave cheia ("34|PPP"); aceita a chave legada só-letra ("PPP") ou só-número ("34"). */
export function proporcaoDoTamanho(prop: Proporcoes, t: string): number {
  if (!prop) return 0;
  if (tem(prop, t)) return Math.max(0, Number(prop[t]) || 0);
  const l = parseTamanho(t);
  for (const k of [l.letra, l.numero]) if (k && tem(prop, k)) return Math.max(0, Number(prop[k]) || 0);
  return 0;
}

/** Célula calculada = round(proporção × Base) (P-09 = D). */
export function celulaCalculada(prop: Proporcoes, t: string, base: number): number {
  return Math.max(0, Math.round(proporcaoDoTamanho(prop, t) * (Number(base) || 0)));
}

/** Tamanhos do dialog: a grade da loja no lado do "Tamanho em" (R11). Par sempre entra; item solto só com o lado do
 *  tipo; se nenhum item tiver o lado, mostra todos (nunca esconde a grade inteira). */
export function tamanhosDoTipo(grade: string[], tipo: TamanhoTipo): string[] {
  const com = grade.filter((t) => {
    const l = parseTamanho(t);
    return tipo === "numero" ? !!l.numero : !!l.letra;
  });
  return com.length > 0 ? com : grade.slice();
}

export const rotuloTamanho = (t: string, tipo: TamanhoTipo): string => ladoTamanho(t, tipo) ?? t;

/** Tipo efetivo do produto: `modelos.tamanho_tipo`; card sem modelo ou NULL legado ⇒ Letra (P-25). */
export const tipoDoProduto = (t: string | null | undefined): TamanhoTipo => (t === "numero" ? "numero" : "letra");

function linhaLimpa(l: Partial<DistLoja> | null | undefined): DistLoja {
  const grades: Record<string, number> = {};
  for (const [k, v] of Object.entries(l?.grades ?? {})) grades[k] = inteiro(v);
  const manuais = Array.from(new Set((Array.isArray(l?.manuais) ? l!.manuais : []).filter((k): k is string => typeof k === "string")));
  return { base: inteiro(l?.base), grades, manuais };
}

/** Recalcula UMA linha: não-manuais = calculado (> 0 guardado); manuais ficam. Só os tamanhos da lista (R11). */
export function recalcularLinha(l: Partial<DistLoja> | null | undefined, prop: Proporcoes, tamanhos: string[]): DistLoja {
  const x = linhaLimpa(l);
  const manuais = x.manuais.filter((t) => tamanhos.includes(t));
  const grades: Record<string, number> = {};
  for (const t of tamanhos) {
    if (manuais.includes(t)) grades[t] = x.grades[t] ?? 0;
    else {
      const c = celulaCalculada(prop, t, x.base);
      if (c > 0) grades[t] = c;
    }
  }
  return { base: x.base, grades, manuais };
}

const existe = (l: DistLoja) => l.base > 0 || l.manuais.length > 0;

/** Normaliza a distribuição de UMA cor (R6/R8): recalcula as não-manuais e tira a linha vazia. Sem `tamanhos` (grade
 *  ainda não carregou) só limpa os tipos — mantém as células gravadas. Idempotente. */
export function normalizarDistribuicao(d: Distribuicao | null | undefined, prop: Proporcoes, tamanhos: string[]): Distribuicao {
  const out: Distribuicao = {};
  for (const [loja, l] of Object.entries(d ?? {})) {
    const x = tamanhos.length ? recalcularLinha(l, prop, tamanhos) : linhaLimpa(l);
    if (existe(x)) out[loja] = x;
  }
  return out;
}

export const temDistribuicao = (d: Distribuicao | null | undefined): boolean => Object.keys(d ?? {}).length > 0;

/** Totais de UMA cor (o que vai para o card): Σ das lojas por tamanho (só > 0), total (= pç) e Σ das Bases. */
export function totaisDaDistribuicao(d: Distribuicao | null | undefined): { grades: Record<string, number>; total: number; base: number } {
  const grades: Record<string, number> = {};
  let total = 0;
  let base = 0;
  for (const l of Object.values(d ?? {})) {
    base += inteiro(l?.base);
    for (const [t, q] of Object.entries(l?.grades ?? {})) {
      const n = inteiro(q);
      if (n <= 0) continue;
      grades[t] = (grades[t] ?? 0) + n;
      total += n;
    }
  }
  return { grades, total, base };
}

/** Vista de UMA linha (loja × cor) p/ a tabela: valor (manual ou calculado), calculado e se é manual, por tamanho. */
export function linhaVista(l: DistLoja | null | undefined, prop: Proporcoes, tamanhos: string[]): { base: number; celulas: Record<string, CelulaVista>; total: number } {
  const base = inteiro(l?.base);
  const manuais = new Set(l?.manuais ?? []);
  const celulas: Record<string, CelulaVista> = {};
  let total = 0;
  for (const t of tamanhos) {
    const calculado = celulaCalculada(prop, t, base);
    const manual = manuais.has(t);
    const valor = manual ? inteiro(l?.grades?.[t]) : calculado;
    celulas[t] = { valor, calculado, manual };
    total += valor;
  }
  return { base, celulas, total };
}

/** Soma de várias vistas (subtotal da loja; total por cor): Σ Bases, Σ por tamanho (todos os tamanhos da lista) e total. */
export function somaVistas(vistas: { base: number; celulas: Record<string, CelulaVista>; total: number }[], tamanhos: string[]): { base: number; grades: Record<string, number>; total: number } {
  const grades: Record<string, number> = Object.fromEntries(tamanhos.map((t) => [t, 0]));
  let base = 0;
  let total = 0;
  for (const v of vistas) {
    base += v.base;
    total += v.total;
    for (const t of tamanhos) grades[t] += v.celulas[t]?.valor ?? 0;
  }
  return { base, grades, total };
}

function comLinha(d: Distribuicao, loja: string, l: DistLoja): Distribuicao {
  const out = { ...d };
  if (existe(l)) out[loja] = l;
  else delete out[loja];
  return out;
}

/** Base da loja × cor: recalcula as não-manuais dessa linha (P-23). */
export function definirBase(d: Distribuicao, loja: string, base: number, prop: Proporcoes, tamanhos: string[]): Distribuicao {
  const a = linhaLimpa(d[loja]);
  return comLinha(d, loja, recalcularLinha({ ...a, base: inteiro(base) }, prop, tamanhos));
}

/** Quadradinho digitado: vira "à mão" se ≠ calculado; igual ao calculado = volta a calculado (R9). */
export function definirCelula(d: Distribuicao, loja: string, t: string, valor: number, prop: Proporcoes, tamanhos: string[]): Distribuicao {
  const a = linhaLimpa(d[loja]);
  const v = inteiro(valor);
  const manuais = a.manuais.filter((x) => x !== t);
  const grades = { ...a.grades };
  if (v !== celulaCalculada(prop, t, a.base)) {
    manuais.push(t);
    grades[t] = v;
  }
  return comLinha(d, loja, recalcularLinha({ base: a.base, grades, manuais }, prop, tamanhos));
}

/** "↺ voltar ao calculado". */
export function voltarAoCalculado(d: Distribuicao, loja: string, t: string, prop: Proporcoes, tamanhos: string[]): Distribuicao {
  const a = linhaLimpa(d[loja]);
  return comLinha(d, loja, recalcularLinha({ ...a, manuais: a.manuais.filter((x) => x !== t) }, prop, tamanhos));
}

/** Proporção digitada na linha "Proporção por tamanho" do dialog: congela os tamanhos exibidos nas chaves cheias
 *  (igual ao `GradeSection.setProp`) e troca só o tamanho digitado. */
export function definirProporcao(prop: Proporcoes, tamanhos: string[], t: string, valor: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of tamanhos) out[k] = proporcaoDoTamanho(prop, k);
  out[t] = inteiro(valor);
  return out;
}

const VOGAIS = "aeiouáàâãäéèêëíìîïóòôõöúùûü";
/** Abrevia uma palavra até ANTES da 2ª vogal ("Marrom" → "Marr.", "Canela" → "Can."); ≤ 4 letras fica inteira. */
function abreviarPalavra(w: string): string {
  if (w.length <= 4) return w;
  const low = w.toLowerCase();
  let vistas = 0;
  for (let i = 0; i < low.length; i++) {
    if (!VOGAIS.includes(low[i])) continue;
    vistas++;
    if (vistas === 2) return i >= 2 ? `${w.slice(0, i)}.` : w;
  }
  return w;
}
/** Nome ABREVIADO da coluna fixa no celular (mockup: "Marr. Can."). */
export const abreviarNome = (s: string): string => s.split(/\s+/).filter(Boolean).map(abreviarPalavra).join(" ");

/** Chave do slot nos paths de presença (mesma regra do `pt-prop` do GradeSection). */
export const chaveSlot = (s: { id?: string | null; modelo_id?: string | null }): string => s.id ?? s.modelo_id ?? "x";
export const pathDistProp = (slot: string, t: string): string => `dist:${slot}:prop:${t}`;
export const pathDistBase = (slot: string, loja: string, varKey: string): string => `dist:${slot}:${loja}:${varKey}:base`;
export const pathDistCel = (slot: string, loja: string, varKey: string, t: string): string => `dist:${slot}:${loja}:${varKey}:${t}`;
/** Marcador de presença de página: o dialog está aberto e nenhum campo dele está focado (R19). Sem elemento no DOM. */
export const pathDistAberto = (slot: string): string => `dist:${slot}:aberto`;
export const pathEhDoProduto = (path: string | null | undefined, slot: string): boolean => !!path && path.startsWith(`dist:${slot}:`);
```

- [ ] **Step 4: Rodar e ver passar**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/distribuicao-produto"
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres npx vitest run tests/unit/distribuicao-produto.test.ts 2>&1 | tail -5
```

Expected: PASS (todos). Número do mockup diferente ⇒ PARE (regra, não sintaxe).

- [ ] **Step 5: Gates e commit**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/distribuicao-produto"
bash .superpowers/distribuicao/gates.sh
git add -- src/lib/distribuicao-produto.ts tests/unit/distribuicao-produto.test.ts
git commit --only -m "feat(distribuicao): regras puras do dialog Distribuir por loja (Base × proporção, correção à mão, totais, tamanhos por tipo) (T1)" \
  -m "Números do mockup em Letra (71/90/30=191) e Número (119/92=211) como teste. Plano 2026-09-25, Task 1." \
  -m "Co-Authored-By: Claude <seu modelo real> <noreply@anthropic.com>" \
  -- src/lib/distribuicao-produto.ts tests/unit/distribuicao-produto.test.ts
git show --stat HEAD
```

---
## Task 2: `src/lib/plan-tecido/atendimento.ts` — "atende a", pç derivado e normalização do slot  *(Lote A)*

**Files:**
- Create: `src/lib/plan-tecido/atendimento.ts`
- Test: `tests/unit/plan-tecido-atendimento.test.ts`

**Interfaces:**
- Consumes: `varKey`, `buildMateriaisAplicar` (`src/lib/plan-tecido/calc.ts`, existentes); da Task 1: `normalizarDistribuicao`, `tamanhosDoTipo`, `temDistribuicao`, `tipoDoProduto`, `totaisDaDistribuicao`; tipos `PtArvore`, `PtMaterial`, `PtSlot`, `PtVariante` (a Task 3 acrescenta `distribuicao`/`atende`/`tamanho_tipo` — ATÉ a Task 3, os testes desta task usam objetos com esses campos via `as` e o `tsc` dos gates PASSA porque o arquivo acessa os campos por `(v as PtVarianteDist)` — ver o tipo local abaixo).
- Produces (Tasks 3, 5, 6): `ehTecido1(m)`, `resolverChaveT1(k, t1): string | null`, `type Atendimento = { porCor: Map<string, string[]>; servidaPor: Map<string, string>; manual: Set<string> }`, `atendimentoDoBloco(t1, bloco): Atendimento`, `pcAtendido(t1, servidas)`, `alternarAtende(at, kb, kt): string[]`, `complementaReal(servidas): string[]`, `type OpcoesDist = { ligado: boolean; tamanhos: string[] }`, `normalizarSlotDistribuicao(slot, o): PtSlot`, `normalizarArvoreDistribuicao(arv, o): PtArvore`, `materiaisParaAplicar(slot, ligado)`.

- [ ] **Step 1: Escrever o teste (falha)** — `tests/unit/plan-tecido-atendimento.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  alternarAtende, atendimentoDoBloco, complementaReal, materiaisParaAplicar, normalizarArvoreDistribuicao, normalizarSlotDistribuicao,
  pcAtendido, resolverChaveT1,
} from "@/lib/plan-tecido/atendimento";
import { definirBase, definirCelula, type Distribuicao } from "@/lib/distribuicao-produto";
import type { PtArvore, PtSlot, PtVariante } from "@/lib/plan-tecido/types";

const GRADE = ["34|PPP", "36|PP", "38|P", "40|M", "42|G", "44|GG"];
const PROP = { "38|P": 1, "40|M": 2, "42|G": 2, "44|GG": 1 };
const MARROM = "cor-marrom", PRETO = "cor-preto", VINHO = "cor-vinho";
const v = (id: string | null, cor: string, pc: number, extra: Partial<PtVariante> = {}): PtVariante =>
  ({ variante_tecido_id: id, cor_id: cor, cor_apelido_id: null, ordem: 1, multiplicador: 1, grades: {}, grade_total: pc, cor_nome: cor, ...extra }) as PtVariante;
const dist = (bases: Record<string, number>, manuais: [string, string, number][] = []): Distribuicao => {
  let d: Distribuicao = {};
  for (const [l, b] of Object.entries(bases)) d = definirBase(d, l, b, PROP, GRADE);
  for (const [l, t, x] of manuais) d = definirCelula(d, l, t, x, PROP, GRADE);
  return d;
};

// Tecido 1 do mockup: Marrom·Canela (71), Preto (90), Vinho·Bordô (30) — distribuídos
const T1 = [
  v("vt-marrom", MARROM, 0, { distribuicao: dist({ ec: 5, lf: 3, at: 4 }, [["ec", "38|P", 4]]) }),
  v("vt-preto", PRETO, 0, { distribuicao: dist({ ec: 6, lf: 4, at: 5 }) }),
  v("vt-vinho", VINHO, 0, { distribuicao: dist({ ec: 3, lf: 2 }) }),
];

describe("atendimento — 'atende a' (R14/R16)", () => {
  it("automático = mesma cor base; manual vence; cada cor do T1 por UMA cor do bloco (mockup: Preto atende Preto + Vinho à mão)", () => {
    const forro = [v("fr-marrom", MARROM, 7), v("fr-preto", PRETO, 5, { atende: ["vt-preto", "vt-vinho"] })];
    const at = atendimentoDoBloco(T1, forro);
    expect(at.porCor.get("fr-marrom")).toEqual(["vt-marrom"]);
    expect(at.porCor.get("fr-preto")).toEqual(["vt-preto", "vt-vinho"]);
    expect(at.servidaPor.get("vt-vinho")).toBe("fr-preto");
    expect([...at.manual]).toEqual(["fr-preto"]);
  });
  it("manual que pega uma cor tira ela do automático de outra cor do bloco", () => {
    const forro = [v("fr-marrom", MARROM, 0), v("fr-preto", PRETO, 0, { atende: ["vt-marrom"] })];
    const at = atendimentoDoBloco(T1, forro);
    expect(at.porCor.get("fr-marrom")).toEqual([]);
    expect(at.servidaPor.get("vt-marrom")).toBe("fr-preto");
  });
  it("cor do bloco sem cor base igual e sem lista = não atende nenhuma", () => {
    const at = atendimentoDoBloco(T1, [v("fr-bege", "cor-bege", 12)]);
    expect(at.porCor.get("fr-bege")).toEqual([]);
  });
  it("re-casa a cor planejada que virou real por cor + apelido (R16)", () => {
    const t1 = [v("vt-real", MARROM, 10, { cor_apelido_id: "ap-canela" })];
    expect(resolverChaveT1(`plan:${MARROM}|ap-canela`, t1)).toBe("vt-real");
    expect(resolverChaveT1("vt-real", t1)).toBe("vt-real");
    expect(resolverChaveT1("sumiu", t1)).toBeNull();
  });
  it("pcAtendido = Σ pç e Σ por tamanho das cores atendidas; sem cor atendida = null (pç digitado)", () => {
    const t1 = [v("a", MARROM, 10, { grades: { "38|P": 4, "40|M": 6 } }), v("b", PRETO, 5, { grades: { "38|P": 5 } })];
    expect(pcAtendido(t1, ["a", "b"])).toEqual({ grade_total: 15, grades: { "38|P": 9, "40|M": 6 } });
    expect(pcAtendido(t1, [])).toBeNull();
  });
  it("alternarAtende parte do conjunto EFETIVO de hoje", () => {
    const forro = [v("fr-preto", PRETO, 0)];
    const at = atendimentoDoBloco(T1, forro);
    expect(alternarAtende(at, "fr-preto", "vt-vinho")).toEqual(["vt-preto", "vt-vinho"]);
    expect(alternarAtende(at, "fr-preto", "vt-preto")).toEqual([]);
  });
  it("complementaReal descarta cor planejada (o BOM só aceita variante real)", () => {
    expect(complementaReal(["vt-1", "plan:c|a"])).toEqual(["vt-1"]);
  });
});

const slot = (materiais: PtSlot["materiais"], extra: Partial<PtSlot> = {}): PtSlot =>
  ({ id: "s1", modelo_id: "m1", proporcoes: { "34|PPP": 0, "36|PP": 0, ...PROP }, materiais, ...extra }) as PtSlot;
const mat = (tipo: "tecido" | "forro", numero: number, variantes: PtVariante[]) =>
  ({ artigo_id: `${tipo}${numero}`, tipo, numero, consumo: tipo === "forro" ? 1.2 : 1.97, loss_percent: 0, ordem: 0, variantes });

describe("normalizarSlotDistribuicao (R6)", () => {
  const LIG = { ligado: true, tamanhos: GRADE };
  it("pç do T1 = soma da distribuição; forro amarrado = soma das cores atendidas (mockup: 71·90·30 → forro 71 e 120)", () => {
    const s = slot([mat("tecido", 1, T1), mat("forro", 1, [v("fr-marrom", MARROM, 7), v("fr-preto", PRETO, 5, { atende: ["vt-preto", "vt-vinho"] })])]);
    const n = normalizarSlotDistribuicao(s, LIG);
    expect(n.materiais[0].variantes.map((x) => x.grade_total)).toEqual([71, 90, 30]);
    expect(n.materiais[0].variantes[0].grades).toEqual({ "38|P": 11, "40|M": 24, "42|G": 24, "44|GG": 12 });
    expect(n.materiais[1].variantes.map((x) => x.grade_total)).toEqual([71, 120]);
  });
  it("Tecido 2 também é amarrado (R15); cor do bloco sem amarração mantém o pç digitado (R14)", () => {
    const s = slot([mat("tecido", 1, T1), mat("tecido", 2, [v("t2-bege", "cor-bege", 33), v("t2-preto", PRETO, 1)])]);
    const n = normalizarSlotDistribuicao(s, LIG);
    expect(n.materiais[1].variantes.map((x) => x.grade_total)).toEqual([33, 90]);
  });
  it("módulo desligado ⇒ o MESMO objeto (card como hoje — R4)", () => {
    const s = slot([mat("tecido", 1, T1), mat("forro", 1, [v("fr-marrom", MARROM, 7)])]);
    expect(normalizarSlotDistribuicao(s, { ligado: false, tamanhos: GRADE })).toBe(s);
  });
  it("idempotente: normalizar o normalizado devolve o MESMO objeto", () => {
    const s = slot([mat("tecido", 1, T1), mat("forro", 1, [v("fr-marrom", MARROM, 7)])]);
    const n = normalizarSlotDistribuicao(s, LIG);
    expect(normalizarSlotDistribuicao(n, LIG)).toBe(n);
  });
  it("cor do T1 SEM distribuição mantém o pç digitado; a distribuição que esvazia não zera o pç (só o Salvar do dialog zera — R10)", () => {
    const vazia = v("vt-x", MARROM, 40, { distribuicao: { ec: { base: 0, grades: {}, manuais: [] } } });
    const n = normalizarSlotDistribuicao(slot([mat("tecido", 1, [v("vt-y", PRETO, 25), vazia])]), LIG);
    expect(n.materiais[0].variantes.map((x) => [x.grade_total, x.distribuicao ?? null])).toEqual([[25, null], [40, {}]]);
  });
  it("tipo Número usa os tamanhos do lado número (grade solta)", () => {
    const d = { ec: { base: 2, grades: {}, manuais: [] } };
    const s = slot([mat("tecido", 1, [v("vt", MARROM, 0, { distribuicao: d })])], { tamanho_tipo: "numero", proporcoes: { "38": 1, "P": 5 } });
    const n = normalizarSlotDistribuicao(s, { ligado: true, tamanhos: ["38", "40", "P", "M"] });
    expect(n.materiais[0].variantes[0].grade_total).toBe(2);
  });
  it("normalizarArvoreDistribuicao devolve a MESMA árvore quando nada muda", () => {
    const s = normalizarSlotDistribuicao(slot([mat("tecido", 1, T1)]), LIG);
    const arv: PtArvore = { colecao_id: "c", subcolecoes: [{ subcolecao_id: null, ordem: 0, linhas: [{ linha_id: null, categoria_id: null, ordem: 0, slots: [s] }] }] };
    expect(normalizarArvoreDistribuicao(arv, LIG)).toBe(arv);
  });
});

describe("materiaisParaAplicar (R3/R4)", () => {
  const s = slot([mat("tecido", 1, [v("vt-marrom", MARROM, 71), v(null, PRETO, 90)]), mat("forro", 1, [v("fr-marrom", MARROM, 71), v("fr-preto", PRETO, 90)])]);
  it("com o módulo: o forro leva complementa_variante_ids (só ids REAIS do T1); o T1 NÃO leva a chave", () => {
    const m = materiaisParaAplicar(s, true);
    expect(m[0].variantes[0]).not.toHaveProperty("complementa_variante_ids");
    expect(m[1].variantes.map((x: any) => x.complementa_variante_ids)).toEqual([["vt-marrom"], []]);
  });
  it("sem o módulo: NENHUMA variante leva a chave (o servidor preserva o casamento do BOM)", () => {
    const m = materiaisParaAplicar(s, false);
    expect(m.flatMap((x) => x.variantes).some((x: any) => "complementa_variante_ids" in x)).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/distribuicao-produto"
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres npx vitest run tests/unit/plan-tecido-atendimento.test.ts 2>&1 | tail -5
```

Expected: FAIL — `Failed to resolve import "@/lib/plan-tecido/atendimento"`.

- [ ] **Step 3: Implementar — `src/lib/plan-tecido/atendimento.ts`**

```ts
// Distribuição por produto no Plan. Tecido — "atende a" (forro/Tecido 2… × cores do Tecido 1) e a NORMALIZAÇÃO do slot
// (spec R2, R3, R4, R6, R14–R16). PURO. A normalização é a ÚNICA porta que deriva o pç: roda no carregamento
// (computeFreshArvore) e em todo `patch` do PlanTecidoSheet; é idempotente (devolve o MESMO objeto quando nada muda).
import type { PtArvore, PtMaterial, PtSlot, PtVariante } from "./types";
import { buildMateriaisAplicar, varKey } from "./calc";
import { normalizarDistribuicao, tamanhosDoTipo, temDistribuicao, tipoDoProduto, totaisDaDistribuicao, type Distribuicao } from "@/lib/distribuicao-produto";

// Até a Task 3 acrescentar os campos em `types.ts`, o acesso passa por este tipo local (depois ele fica redundante e inofensivo).
type PtVarianteDist = PtVariante & { distribuicao?: Distribuicao; atende?: string[] | null };
type PtSlotDist = PtSlot & { tamanho_tipo?: "letra" | "numero" | null };

/** Tecido 1 = `tipo='tecido' AND numero=1` (o mesmo critério do servidor e do `_plan_tecido_gravar_bom_core`). */
export const ehTecido1 = (m: Pick<PtMaterial, "tipo" | "numero">): boolean => m.tipo === "tecido" && Number(m.numero) === 1;

/** Chave salva no "atende a" → chave ATUAL de uma cor do T1. A cor planejada (`plan:cor|apelido`) que virou variante
 *  real é re-casada por cor + apelido (R16). */
export function resolverChaveT1(k: string, t1: PtVariante[]): string | null {
  for (const v of t1) if (varKey(v) === k) return k;
  if (k.startsWith("plan:")) {
    const [cor, ap] = k.slice(5).split("|");
    const v = t1.find((x) => (x.cor_id ?? "") === (cor ?? "") && (x.cor_apelido_id ?? "") === (ap ?? ""));
    return v ? varKey(v) : null;
  }
  return null;
}

export type Atendimento = {
  /** chave da cor do bloco → chaves das cores do T1 que ela atende (na ordem do T1) */
  porCor: Map<string, string[]>;
  /** chave da cor do T1 → chave da cor do bloco que a atende */
  servidaPor: Map<string, string>;
  /** cores do bloco com lista escolhida à mão */
  manual: Set<string>;
};

/** Regra do "atende a" de UM bloco (R14): (1) listas à mão, na ordem das cores do bloco, vencem; (2) cor sem lista
 *  (automático) atende as cores do T1 de MESMA cor base ainda livres; cada cor do T1 é atendida por no máximo 1. */
export function atendimentoDoBloco(t1: PtVariante[], bloco: PtVariante[]): Atendimento {
  const servidaPor = new Map<string, string>();
  const manual = new Set<string>();
  for (const b of bloco as PtVarianteDist[]) {
    if (!Array.isArray(b.atende)) continue;
    const kb = varKey(b);
    manual.add(kb);
    for (const k of b.atende) {
      const kt = resolverChaveT1(String(k), t1);
      if (kt && !servidaPor.has(kt)) servidaPor.set(kt, kb);
    }
  }
  for (const b of bloco) {
    const kb = varKey(b);
    if (manual.has(kb) || !b.cor_id) continue;
    for (const v of t1) {
      const kt = varKey(v);
      if (!servidaPor.has(kt) && !!v.cor_id && v.cor_id === b.cor_id) servidaPor.set(kt, kb);
    }
  }
  const porCor = new Map<string, string[]>(bloco.map((b) => [varKey(b), [] as string[]]));
  for (const v of t1) {
    const kt = varKey(v);
    const kb = servidaPor.get(kt);
    if (kb) porCor.get(kb)?.push(kt);
  }
  return { porCor, servidaPor, manual };
}

/** pç de UMA cor do bloco = Σ pç (e Σ por tamanho) das cores do T1 que ela atende; null = não atende nenhuma
 *  (pç digitado como hoje — R14). */
export function pcAtendido(t1: PtVariante[], servidas: string[]): { grade_total: number; grades: Record<string, number> } | null {
  if (servidas.length === 0) return null;
  const set = new Set(servidas);
  let grade_total = 0;
  const grades: Record<string, number> = {};
  for (const v of t1) {
    if (!set.has(varKey(v))) continue;
    grade_total += Number(v.grade_total) || 0;
    for (const [t, q] of Object.entries(v.grades ?? {})) grades[t] = (grades[t] ?? 0) + (Number(q) || 0);
  }
  return { grade_total, grades };
}

/** Lista explícita depois de marcar/desmarcar uma cor do T1 no popover: parte do conjunto EFETIVO de hoje. */
export function alternarAtende(at: Atendimento, kb: string, kt: string): string[] {
  const atuais = at.porCor.get(kb) ?? [];
  return atuais.includes(kt) ? atuais.filter((x) => x !== kt) : [...atuais, kt];
}

/** Só ids de variante REAL (o BOM — `complementa_variante_ids uuid[]` — não aceita cor planejada). */
export const complementaReal = (servidas: string[]): string[] => servidas.filter((k) => !k.startsWith("plan:"));

export type OpcoesDist = { ligado: boolean; tamanhos: string[] };
const igual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Deriva o pç do slot (R6): (1) cada cor do T1 com distribuição → células não-manuais recalculadas (proporção × Base),
 *  `grades`/`grade_total` = totais; distribuição que esvazia fica `{}` SEM zerar o pç (R10); (2) cada cor de outro
 *  bloco que atende ≥ 1 cor do T1 → pç = soma. Módulo desligado ⇒ o MESMO slot. Nada mudou ⇒ o MESMO slot. */
export function normalizarSlotDistribuicao(slot: PtSlot, o: OpcoesDist): PtSlot {
  if (!o.ligado) return slot;
  const iT1 = slot.materiais.findIndex(ehTecido1);
  if (iT1 < 0) return slot;
  const tams = o.tamanhos.length ? tamanhosDoTipo(o.tamanhos, tipoDoProduto((slot as PtSlotDist).tamanho_tipo)) : [];
  const t1Vars: PtVariante[] = (slot.materiais[iT1].variantes as PtVarianteDist[]).map((v) => {
    if (!temDistribuicao(v.distribuicao)) return v;
    const d = normalizarDistribuicao(v.distribuicao, slot.proporcoes, tams);
    if (!temDistribuicao(d)) return { ...v, distribuicao: {} };
    const tot = totaisDaDistribuicao(d);
    return { ...v, distribuicao: d, grades: tot.grades, grade_total: tot.total };
  });
  const materiais = slot.materiais.map((m, i) => {
    if (i === iT1) return { ...m, variantes: t1Vars };
    const at = atendimentoDoBloco(t1Vars, m.variantes);
    return {
      ...m,
      variantes: m.variantes.map((b) => {
        const pc = pcAtendido(t1Vars, at.porCor.get(varKey(b)) ?? []);
        return pc ? { ...b, grade_total: pc.grade_total, grades: pc.grades } : b;
      }),
    };
  });
  return igual(materiais, slot.materiais) ? slot : { ...slot, materiais };
}

/** A árvore inteira (carregamento e `patch`). Devolve a MESMA árvore quando nenhum slot mudou. */
export function normalizarArvoreDistribuicao(arv: PtArvore, o: OpcoesDist): PtArvore {
  if (!o.ligado) return arv;
  let mudou = false;
  const subcolecoes = arv.subcolecoes.map((sub) => {
    let mSub = false;
    const linhas = sub.linhas.map((ln) => {
      let mLn = false;
      const slots = ln.slots.map((s) => {
        const n = normalizarSlotDistribuicao(s, o);
        if (n !== s) mLn = true;
        return n;
      });
      if (!mLn) return ln;
      mSub = true;
      return { ...ln, slots };
    });
    if (!mSub) return sub;
    mudou = true;
    return { ...sub, linhas };
  });
  return mudou ? { ...arv, subcolecoes } : arv;
}

/** Payload de `plan_tecido_aplicar_ao_modelo`/`plan_tecido_criar_card(s)` = o de sempre (`buildMateriaisAplicar`, fonte
 *  única) + `complementa_variante_ids` em cada cor de bloco que NÃO é o T1, SÓ com o módulo ligado (R3/R4). Sem o módulo a
 *  chave não vai e o servidor PRESERVA o casamento que o BOM já tinha. */
export function materiaisParaAplicar(slot: PtSlot, ligado: boolean) {
  const base = buildMateriaisAplicar(slot);
  if (!ligado) return base;
  const t1 = slot.materiais.find(ehTecido1);
  if (!t1) return base;
  return base.map((m, i) => {
    const orig = slot.materiais[i];
    if (!orig || ehTecido1(orig)) return m;
    const at = atendimentoDoBloco(t1.variantes, orig.variantes);
    return {
      ...m,
      variantes: m.variantes.map((pv, j) => ({
        ...pv,
        complementa_variante_ids: complementaReal(at.porCor.get(varKey(orig.variantes[j])) ?? []),
      })),
    };
  });
}
```

- [ ] **Step 4: Rodar e ver passar**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/distribuicao-produto"
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres npx vitest run tests/unit/plan-tecido-atendimento.test.ts tests/unit/plan-tecido-calc.test.ts 2>&1 | tail -6
```

Expected: PASS nos dois (o `plan-tecido-calc` prova que o `buildMateriaisAplicar` não mudou).

- [ ] **Step 5: Gates e commit**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/distribuicao-produto"
bash .superpowers/distribuicao/gates.sh
git add -- src/lib/plan-tecido/atendimento.ts tests/unit/plan-tecido-atendimento.test.ts
git commit --only -m "feat(plan-tecido): 'atende a' do forro/Tecido 2 e normalização da distribuição no slot (T2)" \
  -m "Automático por cor base, manual vence, 1 cor do bloco por cor do T1; pç derivado; payload do aplicar com casamento só com o módulo. Plano 2026-09-25, Task 2." \
  -m "Co-Authored-By: Claude <seu modelo real> <noreply@anthropic.com>" \
  -- src/lib/plan-tecido/atendimento.ts tests/unit/plan-tecido-atendimento.test.ts
git show --stat HEAD
```

---
## Task 3: tipos + engine — a distribuição e o "atende a" sobrevivem ao merge "Dev vence"  *(Lote A — revisão Opus ao fim desta task)*

**Files:**
- Modify: `src/lib/plan-tecido/types.ts` (linhas 6 e 26)
- Modify: `src/lib/plan-tecido/engine.ts` (`ModeloRealMaterial`/`ModeloReal` `:12-53`, `slotDeModeloReal` `:61-141`, novos helpers depois de `comGradeDoPlano` `:321`, `mergeArvore` `:464-466`)
- Test: `tests/unit/plan-tecido-engine.test.ts` (acrescentar ao fim)

**Interfaces:**
- Consumes: `varKey` (`calc.ts`); `ehTecido1` (Task 2); `Distribuicao` (Task 1).
- Produces: `PtVariante.distribuicao?: Distribuicao`, `PtVariante.atende?: string[] | null`, `PtSlot.tamanho_tipo?: "letra" | "numero" | null` (só exibição — o servidor não lê); `ModeloRealMaterial.variantes[].cor_id?`, `.complementa_variante_ids?`; `ModeloReal.tamanho_tipo?`; `comDistribuicaoDoPlano(vivos, salvos)`, `comAtendeDoPlano(vivos, salvos)`.

- [ ] **Step 1: Teste (falha)** — acrescentar ao FIM de `tests/unit/plan-tecido-engine.test.ts` (e `comDistribuicaoDoPlano, comAtendeDoPlano` no import do topo):

```ts
describe("plan-tecido/engine — Distribuição por produto (Task 3)", () => {
  const baseMr = (materiais: ModeloReal["materiais"]): ModeloReal => ({
    id: "m1", ref: "R", nome: "N", subcolecao: null, subcolecao_id: null, linha_id: null, categoria_id: null,
    proporcoes: null, materiais, grade: { 1: { grades: { "38|P": 3 }, grade_total: 3 } }, tamanho_tipo: "numero",
  });
  it("slotDeModeloReal: cor_id em todas; casamento do BOM vira 'atende' fora do T1; tamanho_tipo no slot", () => {
    const s = slotDeModeloReal(baseMr([
      { tipo: "tecido", numero: 1, artigo_id: "A", consumo: 1, loss_percent: 0, variantes: [{ variante_tecido_id: "vt1", ordem: 1, multiplicador: 1, cor_id: "c1", complementa_variante_ids: null }] },
      { tipo: "forro", numero: 1, artigo_id: "F", consumo: 1, loss_percent: 0, variantes: [
        { variante_tecido_id: "fr1", ordem: 1, multiplicador: 1, cor_id: "c1", complementa_variante_ids: ["vt1"] },
        { variante_tecido_id: "fr2", ordem: 2, multiplicador: 1, cor_id: "c2", complementa_variante_ids: null },
      ] },
    ]), 0);
    expect(s.tamanho_tipo).toBe("numero");
    expect(s.materiais[0].variantes[0]).toMatchObject({ cor_id: "c1" });
    expect(s.materiais[0].variantes[0]).not.toHaveProperty("atende");
    expect(s.materiais[1].variantes.map((v) => v.atende)).toEqual([["vt1"], null]);
  });
  it("comDistribuicaoDoPlano: leva a distribuição salva para a cor viva do T1 (por chave e, planejada→real, por cor+apelido)", () => {
    const d = { ec: { base: 1, grades: { "38|P": 1 }, manuais: [] } };
    const vivos = [{ artigo_id: "A", tipo: "tecido" as const, numero: 1, consumo: 1, loss_percent: 0, ordem: 0, variantes: [
      { variante_tecido_id: "vt1", ordem: 1, multiplicador: 1, grades: {}, grade_total: 0 },
      { variante_tecido_id: "vt2", cor_id: "c2", cor_apelido_id: "a2", ordem: 2, multiplicador: 1, grades: {}, grade_total: 0 },
    ] }];
    const salvos = [{ artigo_id: "A", tipo: "tecido" as const, numero: 1, consumo: 1, loss_percent: 0, ordem: 0, variantes: [
      { variante_tecido_id: "vt1", ordem: 1, multiplicador: 1, grades: {}, grade_total: 1, distribuicao: d },
      { variante_tecido_id: null, cor_id: "c2", cor_apelido_id: "a2", ordem: 2, multiplicador: 1, grades: {}, grade_total: 1, distribuicao: d },
    ] }];
    const r = comDistribuicaoDoPlano(vivos, salvos);
    expect(r[0].variantes.map((v) => v.distribuicao)).toEqual([d, d]);
    expect(comDistribuicaoDoPlano(vivos, [])).toBe(vivos);
  });
  it("comAtendeDoPlano: BOM com casamento vence; sem casamento no BOM vale o do plano", () => {
    const vivos = [{ artigo_id: "F", tipo: "forro" as const, numero: 1, consumo: 1, loss_percent: 0, ordem: 1, variantes: [
      { variante_tecido_id: "fr1", ordem: 1, multiplicador: 1, grades: {}, grade_total: 0, atende: ["vtA"] },
      { variante_tecido_id: "fr2", ordem: 2, multiplicador: 1, grades: {}, grade_total: 0, atende: null },
    ] }];
    const salvos = [{ artigo_id: "F", tipo: "forro" as const, numero: 1, consumo: 1, loss_percent: 0, ordem: 1, variantes: [
      { variante_tecido_id: "fr1", ordem: 1, multiplicador: 1, grades: {}, grade_total: 0, atende: ["vtB"] },
      { variante_tecido_id: "fr2", ordem: 2, multiplicador: 1, grades: {}, grade_total: 0, atende: ["vtC"] },
    ] }];
    expect(comAtendeDoPlano(vivos, salvos)[0].variantes.map((v) => v.atende)).toEqual([["vtA"], ["vtC"]]);
  });
  it("mergeArvore: card real mantém a distribuição e o 'atende' salvos depois do 'Dev vence'", () => {
    const d = { ec: { base: 1, grades: { "38|P": 1 }, manuais: [] } };
    const seed = semearComModelos({ colecao_id: "c", tipo: "poder_venda", buckets: [], modelos: [baseMr([
      { tipo: "tecido", numero: 1, artigo_id: "A", consumo: 1, loss_percent: 0, variantes: [{ variante_tecido_id: "vt1", ordem: 1, multiplicador: 1, cor_id: "c1" }] },
      { tipo: "forro", numero: 1, artigo_id: "F", consumo: 1, loss_percent: 0, variantes: [{ variante_tecido_id: "fr1", ordem: 1, multiplicador: 1, cor_id: "c9" }] },
    ])] });
    const salvo: PtArvore = { ...seed, subcolecoes: seed.subcolecoes.map((s) => ({ ...s, linhas: s.linhas.map((l) => ({ ...l, slots: l.slots.map((sl) => ({
      ...sl, materiais: [
        { ...sl.materiais[0], variantes: [{ ...sl.materiais[0].variantes[0], distribuicao: d }] },
        { ...sl.materiais[1], variantes: [{ ...sl.materiais[1].variantes[0], atende: ["vt1"] }] },
      ] })) })) })) };
    const m = mergeArvore(seed, salvo).subcolecoes[0].linhas[0].slots[0].materiais;
    expect(m[0].variantes[0].distribuicao).toEqual(d);
    expect(m[1].variantes[0].atende).toEqual(["vt1"]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/distribuicao-produto"
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres npx vitest run tests/unit/plan-tecido-engine.test.ts 2>&1 | tail -6
```

Expected: FAIL — `comDistribuicaoDoPlano is not a function` (e/ou tipos).

- [ ] **Step 3: `src/lib/plan-tecido/types.ts`**

Acrescentar no topo do arquivo:

```ts
import type { Distribuicao } from "@/lib/distribuicao-produto";
```

Na linha do `PtVariante`, trocar o fim `grades: Record<string, number>; grade_total: number };` por:

```ts
grades: Record<string, number>; grade_total: number;
  // Distribuição por produto (spec 2026-09-25, R1/R2): `distribuicao` SÓ no Tecido 1 ({loja_id: {base, grades, manuais}});
  // `atende` SÓ fora do Tecido 1 (NULL = automático pela cor base; array de chaves de cor do T1 = escolhido à mão).
  distribuicao?: Distribuicao; atende?: string[] | null };
```

No `PtSlot`, antes de `materiais: PtMaterial[] };`, acrescentar `tamanho_tipo?: "letra" | "numero" | null; ` precedido do comentário `// tamanho_tipo: "Tamanho em" do modelo (modelos.tamanho_tipo) — SÓ exibição (o servidor não lê); NULL/sem modelo ⇒ Letra.` na linha de cima.

- [ ] **Step 4: `src/lib/plan-tecido/engine.ts`**

(a) Imports no topo (depois do import de `./types`):

```ts
import { varKey } from "./calc";
import { ehTecido1 } from "./atendimento";
```

(b) `ModeloRealMaterial.variantes`: trocar a linha `variantes: { variante_tecido_id: string; ordem: number; multiplicador: number; cor_nome?: string | null; label?: string | null }[];` por:

```ts
  // cor_id (cor base) alimenta o "atende a" automático; complementa_variante_ids = casamento do BOM (casar variantes).
  variantes: { variante_tecido_id: string; ordem: number; multiplicador: number; cor_nome?: string | null; label?: string | null; cor_id?: string | null; complementa_variante_ids?: string[] | null }[];
```

(c) `ModeloReal`: antes de `// grade por variante_numero`, acrescentar:

```ts
  // "Tamanho em" do modelo (modelos.tamanho_tipo) — só exibição no Plan. Tecido (dialog Distribuir por loja).
  tamanho_tipo?: "letra" | "numero" | null;
```

(d) Em `slotDeModeloReal`, no `.map(({ v, artigo_id }, vi) => {…})`, trocar o objeto retornado por:

```ts
        return {
          variante_tecido_id: v.variante_tecido_id,
          variante_artigo_id: artigo_id ?? null, // artigo real da variante (principal ou substituto)
          ordem: vi + 1, // renumera 1..n (uq_plan_var em material_id, ordem)
          multiplicador: Number(v.multiplicador) || 1,
          grades: g2?.grades ?? {},
          grade_total: Number(g2?.grade_total) || 0,
          cor_nome: v.cor_nome ?? null,
          label: v.label ?? undefined,
          cor_id: v.cor_id ?? null,
          // Distribuição por produto (R3/R7): o casamento do BOM é o "atende a" fora do Tecido 1 (NULL = automático).
          ...(g.tipo === "tecido" && numero === 1
            ? {}
            : { atende: Array.isArray(v.complementa_variante_ids) && v.complementa_variante_ids.length ? [...v.complementa_variante_ids] : null }),
        };
```

e, no objeto do slot retornado (logo depois de `proporcoes: mr.proporcoes ?? null,`), acrescentar `tamanho_tipo: mr.tamanho_tipo ?? null,`.

(e) Depois de `comGradeDoPlano` (fim da função, antes do comentário de `artigoTecido1Do`), acrescentar:

```ts
// Distribuição por produto (spec R7) — mesmo princípio "Dev vence só se preenchido": o BOM vivo nunca tem distribuição;
// ela mora SÓ no plano. Leva a distribuição salva para a cor viva do Tecido 1 pela chave (`varKey`); a cor PLANEJADA
// salva que virou variante real no Dev é casada por cor + apelido. Sem nada a levar ⇒ o MESMO array.
export function comDistribuicaoDoPlano(vivos: PtMaterial[], salvos?: PtMaterial[] | null): PtMaterial[] {
  if (!salvos?.length) return vivos;
  const sT1 = salvos.find(ehTecido1);
  const comDist = (sT1?.variantes ?? []).filter((v) => Object.keys(v.distribuicao ?? {}).length > 0);
  if (comDist.length === 0) return vivos;
  const porKey = new Map(comDist.map((v) => [varKey(v), v.distribuicao!] as const));
  const porCombo = new Map(comDist.filter((v) => !!v.cor_id).map((v) => [`${v.cor_id}|${v.cor_apelido_id ?? ""}`, v.distribuicao!] as const));
  let mudouAlgum = false;
  const out = vivos.map((m) => {
    if (!ehTecido1(m)) return m;
    let mudou = false;
    const variantes = m.variantes.map((v) => {
      if (Object.keys(v.distribuicao ?? {}).length > 0) return v;
      const d = porKey.get(varKey(v)) ?? (v.cor_id ? porCombo.get(`${v.cor_id}|${v.cor_apelido_id ?? ""}`) : undefined);
      if (!d) return v;
      mudou = true;
      return { ...v, distribuicao: d };
    });
    if (!mudou) return m;
    mudouAlgum = true;
    return { ...m, variantes };
  });
  return mudouAlgum ? out : vivos;
}

// "Atende a" (spec R7): o casamento do BOM vivo (complementa_variante_ids) VENCE; cor sem casamento no BOM (NULL) usa a
// lista salva no plano (mesmo bloco: tipo + número + artigo). O Tecido 1 nunca casa.
export function comAtendeDoPlano(vivos: PtMaterial[], salvos?: PtMaterial[] | null): PtMaterial[] {
  if (!salvos?.length) return vivos;
  let mudouAlgum = false;
  const out = vivos.map((m) => {
    if (ehTecido1(m)) return m;
    const s = salvos.find((x) => x.tipo === m.tipo && Number(x.numero) === Number(m.numero) && (x.artigo_id ?? null) === (m.artigo_id ?? null));
    const porKey = new Map((s?.variantes ?? []).filter((v) => Array.isArray(v.atende)).map((v) => [varKey(v), v.atende!] as const));
    if (porKey.size === 0) return m;
    let mudou = false;
    const variantes = m.variantes.map((v) => {
      if (Array.isArray(v.atende)) return v;
      const a = porKey.get(varKey(v));
      if (!a) return v;
      mudou = true;
      return { ...v, atende: [...a] };
    });
    if (!mudou) return m;
    mudouAlgum = true;
    return { ...m, variantes };
  });
  return mudouAlgum ? out : vivos;
}
```

(f) Em `mergeArvore`, trocar a linha

```ts
              ? (live?.materiais?.length ? comGradeDoPlano(comVariantesDoPlano(comConsumoDoPlano(live.materiais, saved.materiais), saved.materiais), saved.materiais) : (saved.materiais ?? []))
```

por

```ts
              ? (live?.materiais?.length
                  ? comAtendeDoPlano(
                      comDistribuicaoDoPlano(
                        comGradeDoPlano(comVariantesDoPlano(comConsumoDoPlano(live.materiais, saved.materiais), saved.materiais), saved.materiais),
                        saved.materiais,
                      ),
                      saved.materiais,
                    )
                  : (saved.materiais ?? []))
```

e acrescentar ao comentário "Ordem dos fallbacks" a frase `… → pç → distribuição (Tecido 1) → "atende a" (demais blocos) — Distribuição por produto, spec R7.`

- [ ] **Step 5: Rodar (engine + atendimento + calc) e ver passar**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/distribuicao-produto"
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres npx vitest run tests/unit/plan-tecido-engine.test.ts tests/unit/plan-tecido-atendimento.test.ts tests/unit/plan-tecido-calc.test.ts tests/unit/plan-tecido-colab-merge.test.ts tests/unit/plan-tecido-replicar-variantes.test.ts 2>&1 | tail -8
```

Expected: PASS em todos (os antigos provam que nada mudou para quem não usa os campos novos).

- [ ] **Step 6: Gates e commit**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/distribuicao-produto"
bash .superpowers/distribuicao/gates.sh
git add -- src/lib/plan-tecido/types.ts src/lib/plan-tecido/engine.ts tests/unit/plan-tecido-engine.test.ts
git commit --only -m "feat(plan-tecido): distribuição e 'atende a' atravessam o merge 'Dev vence'; cor e casamento do BOM no seed (T3)" \
  -m "PtVariante.distribuicao/atende, PtSlot.tamanho_tipo; comDistribuicaoDoPlano + comAtendeDoPlano. Plano 2026-09-25, Task 3." \
  -m "Co-Authored-By: Claude <seu modelo real> <noreply@anthropic.com>" \
  -- src/lib/plan-tecido/types.ts src/lib/plan-tecido/engine.ts tests/unit/plan-tecido-engine.test.ts
git show --stat HEAD
```

- [ ] **Step 7: Revisão Lote A (Opus)** — o controlador despacha 1 revisor Opus com as Tasks 1–3 (diffs + testes + spec R1–R17): números do mockup; regra do "atende a" (manual vence, 1 por cor, sem amarração = digitado); normalização idempotente e devolvendo o mesmo objeto; merge sem perda (chave e planejada→real); nenhum import circular (`calc` NÃO importa `atendimento`); `buildMateriaisAplicar` intocado. Achados ⇒ corrigir na task de origem (novo commit), repetir os testes.

---
## Task 4: Migration aditiva `20261006100000` + inverso GERADOS do texto vivo + suíte de integração  *(G-migration A: 2 Opus independentes + guardião)*

**Files:**
- Create (não versionado): `.superpowers/distribuicao/mig/dump_antes.sh`, `.superpowers/distribuicao/mig/gerar_sql.py`
- Create (gerados): `supabase/migrations/20261006100000_distribuicao_por_produto.sql`, `supabase/rollback/20261006100000_distribuicao_por_produto_down.sql`
- Test: `tests/integration/distribuicao-produto.test.ts`

**Interfaces:**
- Consumes: `tests/integration/db.ts` (`hasDb`, `dbUrl`, `withTx`, `comoUsuario`, `um`, `TENANT_TESTE`, `USER_TESTE`, `ehBancoLocal`) e `tests/integration/mig-txn.ts` (`aplicarSql`, `exigeBancoLocal`) — NÃO modificar.
- Produces (Tasks 5–7, 10, 11): colunas `plan_tecido_variantes.distribuicao jsonb NOT NULL DEFAULT '{}'`, `plan_tecido_variantes.atende jsonb` + CHECKs `plan_tecido_variantes_distribuicao_objeto`, `plan_tecido_variantes_atende_array`; as 5 redefinidas; `public.direcionamento_plano_modelo(uuid) RETURNS jsonb` (contrato da spec §5.1) e `public._direcionamento_plano_modelo_core(uuid,uuid)`; arquivos `.superpowers/distribuicao/mig/md5-redef-antes.txt`, `md5-redef-depois.txt` (5 md5, ordem `salvar|gravar_bom|snapshot|modulo|arvore`), `md5-novas-depois.txt` (2 md5, ordem `core|wrapper`), `acl-redef-antes.txt`; variável da suíte `DIST_MIG_TXN=1`.

- [ ] **Step 1: Dump SÓ LEITURA do texto vivo — `.superpowers/distribuicao/mig/dump_antes.sh`**

```bash
#!/usr/bin/env bash
# Task 4 Step 1 — lê (SÓ LEITURA) na CÓPIA LOCAL (nunca produção) o texto VIVO das 5 funções que a aditiva redefine, os md5
# e o proacl. O gerador monta a migration e o inverso A PARTIR DESTES TEXTOS (o plano não crava md5 — R31).
set -euo pipefail
TOP="$(git rev-parse --show-toplevel)"
case "$TOP" in */.claude/worktrees/distribuicao-produto) ;; *) echo "PARE: rode de dentro da worktree distribuicao-produto"; exit 1;; esac
cd "$TOP"
LOCAL="postgresql://postgres:postgres@127.0.0.1:54422/postgres"
M=.superpowers/distribuicao/mig
mkdir -p "$M/antes"
echo "== dump SÓ LEITURA · alvo: 127.0.0.1:54422 (cópia local) · HEAD $(git rev-parse --short HEAD)"
q() { PGOPTIONS='-c default_transaction_read_only=on' psql "$LOCAL" -X -A -t -v ON_ERROR_STOP=1 -c "$1"; }
[ "$(q "select to_regprocedure('public.direcionamento_plano_modelo(uuid)') is null and to_regprocedure('public._direcionamento_plano_modelo_core(uuid,uuid)') is null")" = t ] \
  || { echo "PARE: as RPCs novas JÁ existem na cópia — alguém aplicou esta migration?"; exit 1; }
[ "$(q "select count(*) from information_schema.columns where table_schema='public' and table_name='plan_tecido_variantes' and column_name in ('distribuicao','atende')")" = 0 ] \
  || { echo "PARE: colunas desta frente JÁ existem na cópia"; exit 1; }
FNS=(salvar:'public._salvar_plan_tecido_core(uuid,jsonb,integer)' gravar_bom:'public._plan_tecido_gravar_bom_core(uuid,jsonb)'
     snapshot:'public._plan_tecido_snapshot(uuid)' modulo:'public.tenant_module_enabled(text)' arvore:'public._plan_tecido_arvore_core(uuid)')
MS=""; AC=""
for par in "${FNS[@]}"; do
  a="${par%%:*}"; f="${par#*:}"
  PGOPTIONS='-c default_transaction_read_only=on' psql "$LOCAL" -X -A -t -v ON_ERROR_STOP=1 \
    -c "select pg_get_functiondef('$f'::regprocedure)" -o "$M/antes/$a.sql"
  MS="${MS:+$MS|}$(q "select md5(pg_get_functiondef('$f'::regprocedure))")"
  AC="${AC:+$AC|}$(q "select coalesce(proacl::text, '-') from pg_proc where oid = '$f'::regprocedure")"
done
echo "$MS" > "$M/md5-redef-antes.txt"
echo "$AC" > "$M/acl-redef-antes.txt"
echo "md5 VIVOS (salvar|gravar_bom|snapshot|modulo|arvore): $MS"
echo "proacl VIVOS: $AC"
```

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/distribuicao-produto"
chmod +x .superpowers/distribuicao/mig/dump_antes.sh && bash .superpowers/distribuicao/mig/dump_antes.sh
```

Expected: `md5 VIVOS …: ddadff5e…|3cc5d45c…|c9492de3…|0b87d95b…|d8685568…` (= o retrato de produção de 25/set 13:08 — §1; outro valor ⇒ outra frente mexeu: PARE e avise o controlador) e `proacl VIVOS: {postgres=X/postgres,service_role=X/postgres}|…|{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}|…` (a 4ª é `tenant_module_enabled`, aberta a todos — a ordem exata das entradas é a que o PG imprimir; anotar).

- [ ] **Step 2: Escrever a suíte (falha — os arquivos ainda não existem)** — `tests/integration/distribuicao-produto.test.ts`:

```ts
/**
 * Distribuição por produto — migration ADITIVA 20261006100000 (spec 2026-09-25 §5.1; plano Task 4). Colunas
 * plan_tecido_variantes.distribuicao/atende, 5 funções redefinidas (_salvar_plan_tecido_core, _plan_tecido_gravar_bom_core,
 * _plan_tecido_snapshot, tenant_module_enabled, _plan_tecido_arvore_core) e a RPC nova direcionamento_plano_modelo (+ _core).
 * Arquivos GERADOS por .superpowers/distribuicao/mig/gerar_sql.py a partir do texto VIVO (não editar à mão).
 *
 * ⚠️ SÓ NA CÓPIA LOCAL (DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres). Fora dela os blocos de banco
 * PULAM; com DIST_MIG_TXN=1 fora da cópia a suíte RECUSA já na coleta. NUNCA `\i` (o COMMIT do arquivo vazaria — 15/set).
 *  • DIST_MIG_TXN=1 — a cópia SEM a migration; cada teste aplica o arquivo DENTRO da txn (mig-txn.ts; as 2 travas SET LOCAL
 *    saem antes). Segura ACCESS EXCLUSIVE em plan_tecido_variantes durante o teste (N3 — dono avisado ANTES).
 *  • sem a variável — a migration JÁ aplicada na cópia (ensaio da Task 10 / Task 11); os testes do "antes" pulam.
 * O bloco "estático" (só os arquivos) roda sempre.
 */
import { describe, it, expect } from "vitest";
import { Client } from "pg";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { hasDb, dbUrl, withTx, comoUsuario, um, TENANT_TESTE, USER_TESTE, ehBancoLocal } from "./db";
import { aplicarSql, exigeBancoLocal } from "./mig-txn";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MIG = "supabase/migrations/20261006100000_distribuicao_por_produto.sql";
const INV = "supabase/rollback/20261006100000_distribuicao_por_produto_down.sql";
// Ordem FIXA = md5-redef-*.txt = guardas do arquivo.
const REDEF = [
  { arq: "salvar", fn: "public._salvar_plan_tecido_core(uuid,jsonb,integer)", cria: "CREATE OR REPLACE FUNCTION public._salvar_plan_tecido_core(" },
  { arq: "gravar_bom", fn: "public._plan_tecido_gravar_bom_core(uuid,jsonb)", cria: "CREATE OR REPLACE FUNCTION public._plan_tecido_gravar_bom_core(" },
  { arq: "snapshot", fn: "public._plan_tecido_snapshot(uuid)", cria: "CREATE OR REPLACE FUNCTION public._plan_tecido_snapshot(" },
  { arq: "modulo", fn: "public.tenant_module_enabled(text)", cria: "CREATE OR REPLACE FUNCTION public.tenant_module_enabled(" },
  { arq: "arvore", fn: "public._plan_tecido_arvore_core(uuid)", cria: "CREATE OR REPLACE FUNCTION public._plan_tecido_arvore_core(" },
] as const;
const NOVAS = [
  { fn: "public._direcionamento_plano_modelo_core(uuid,uuid)", cria: "CREATE OR REPLACE FUNCTION public._direcionamento_plano_modelo_core(" },
  { fn: "public.direcionamento_plano_modelo(uuid)", cria: "CREATE OR REPLACE FUNCTION public.direcionamento_plano_modelo(" },
] as const;
// Trocas EXATAS (as MESMAS do gerar_sql.py — TROCAS). Cada âncora 1× no texto vivo.
const ANCORAS: Record<string, string[]> = {
  salvar: [
    "          insert into plan_tecido_variantes (material_id, variante_tecido_id, cor_id, cor_apelido_id, ordem, multiplicador, grades, grade_total)\n",
    "                 w.multiplicador, w.grades, w.grade_total\n",
    "                coalesce((e->>'grade_total')::int,0)       as grade_total,\n",
  ],
  gravar_bom: [
    "declare m jsonb; v jsonb; v_mt uuid; v_num int; v_tipo text;\n",
    "  -- limpa só tecido/forro (entretela e demais tipos ficam intactos) + a grade planejada\n",
    "      insert into modelo_tecido_variantes (modelo_tecido_id, variante_tecido_id, ordem, multiplicador)\n",
  ],
  snapshot: ["                      'grade_total', pv.grade_total\n"],
  modulo: ["    _module NOT IN ('otb', 'produto_acabado', 'produto_importado')\n"],
  arvore: ["                        'grades', vv.grades, 'grade_total', vv.grade_total) order by vv.ordem)\n"],
};
const LOCAL = ehBancoLocal();
const MIG_TXN = process.env.DIST_MIG_TXN === "1";
if (MIG_TXN && hasDb) exigeBancoLocal(); // recusa na COLETA, antes de qualquer conexão

const ler = (rel: string) => readFileSync(ROOT + rel, "utf8");
const md5 = (s: string) => createHash("md5").update(s, "utf8").digest("hex");
const RE_TRAVAS = /^SET LOCAL (lock_timeout|transaction_timeout) = '[^']*';$/gm;
function semTravas(sql: string, nome: string): string {
  const n = (sql.match(RE_TRAVAS) ?? []).length;
  if (n !== 2) throw new Error(`${nome}: esperado as 2 travas SET LOCAL; achei ${n}`);
  return sql.replace(RE_TRAVAS, "-- [teste] trava do arquivo removida (a txn do teste tem as suas)");
}
const aplica = (c: Client, rel: string) => aplicarSql(c, semTravas(ler(rel), rel), rel);
/** Texto da função no arquivo: de "CREATE OR REPLACE FUNCTION …(" até o 2º "$function$" (o 1º é o "AS $function$"). */
function corpo(rel: string, inicio: string): string {
  const t = ler(rel);
  const i = t.indexOf(inicio);
  const a = i < 0 ? -1 : t.indexOf("$function$", i);
  const f = a < 0 ? -1 : t.indexOf("$function$", a + 10);
  if (i < 0 || f < 0) throw new Error(`${rel}: corpo não achado (${inicio.slice(0, 60)}…)`);
  return t.slice(i, f + 10);
}
/** Guardas das REDEFINIDAS, na ordem: [{antes, depois}] (v_md5 NOT IN ('antes', 'depois')). */
const guardas = (rel: string) =>
  [...ler(rel).matchAll(/v_md5 NOT IN \('([0-9a-f]{32})', '([0-9a-f]{32})'\)/g)].map((r) => ({ antes: r[1], depois: r[2] }));
/** Guardas das NOVAS (só na migration): md5 do texto novo. */
const guardasNovas = (rel: string) => [...ler(rel).matchAll(/<> '([0-9a-f]{32})' THEN -- nova/g)].map((r) => r[1]);

describe("Distribuição A — arquivos (estático, sem banco)", () => {
  it("5 redefinidas: migration = inverso (texto vivo) com SÓ as trocas; âncoras 1×; guarda md5 EXATA nos 2 arquivos", () => {
    const gM = guardas(MIG), gI = guardas(INV);
    expect(gM).toHaveLength(5);
    expect(gI).toEqual(gM);
    REDEF.forEach((f, i) => {
      const antes = corpo(INV, f.cria), depois = corpo(MIG, f.cria);
      for (const a of ANCORAS[f.arq]) expect(antes.split(a).length - 1, `${f.arq}: ${a.slice(0, 50)}`).toBe(1);
      expect(depois, f.arq).not.toBe(antes);
      expect(gM[i], f.arq).toEqual({ antes: md5(antes + "\n"), depois: md5(depois + "\n") });
    });
    expect(corpo(MIG, REDEF[0].cria)).toContain("w.grade_total, w.distribuicao, w.atende");
    expect(corpo(MIG, REDEF[1].cria)).toContain("complementa_variante_ids");
    expect(corpo(MIG, REDEF[2].cria)).toContain("'distribuicao', pv.distribuicao, 'atende', pv.atende");
    expect(corpo(MIG, REDEF[3].cria)).toContain("'produto_importado', 'distribuicao')");
    expect(corpo(MIG, REDEF[4].cria)).toContain("'distribuicao', vv.distribuicao, 'atende', vv.atende");
  });
  it("2 novas: guarda = md5 do texto do arquivo; o inverso as DERRUBA", () => {
    const g = guardasNovas(MIG);
    expect(g).toEqual(NOVAS.map((n) => md5(corpo(MIG, n.cria) + "\n")));
    const v = ler(INV);
    expect(v).toContain("DROP FUNCTION IF EXISTS public.direcionamento_plano_modelo(uuid);");
    expect(v).toContain("DROP FUNCTION IF EXISTS public._direcionamento_plano_modelo_core(uuid, uuid);");
  });
  it("travas: 1 BEGIN/1 COMMIT e as 2 SET LOCAL logo depois do BEGIN; NENHUMA DDL de policy; nada em tenant_config; nada da reorg", () => {
    for (const f of [MIG, INV]) {
      const t = ler(f);
      const linhas = t.split("\n");
      const i = linhas.findIndex((l) => l === "BEGIN;");
      expect(linhas.slice(i + 1, i + 3), f).toEqual(["SET LOCAL lock_timeout = '500ms';", "SET LOCAL transaction_timeout = '3s';"]);
      expect(linhas.filter((l) => l === "BEGIN;"), f).toHaveLength(1);
      expect(linhas.filter((l) => l === "COMMIT;"), f).toHaveLength(1);
      expect(t, f).not.toMatch(/^[ \t]*(CREATE|DROP|ALTER)[ \t]+POLICY\b/im);
      expect(t, f).not.toMatch(/(UPDATE|INSERT INTO|DELETE FROM|ALTER TABLE|COMMENT ON COLUMN) public\.tenant_config/);
      expect(t, f).not.toContain("_replicar_cards_plan_tecido_core");
      expect(t, f).not.toMatch(/(REVOKE|GRANT)[^;]*tenant_module_enabled/); // ACL INTOCADA (R5)
    }
  });
  it("ordem da migration: guarda → 4 redefinidas → core → wrapper → ACL → ALTER → CHECKs → COMMENT → árvore (sql) → COMMIT", () => {
    const m = ler(MIG);
    const pos = (s: string) => m.indexOf(s);
    const ord = [
      "DO $guarda$", REDEF[0].cria, REDEF[1].cria, REDEF[2].cria, REDEF[3].cria, NOVAS[0].cria, NOVAS[1].cria,
      "REVOKE EXECUTE ON FUNCTION public._direcionamento_plano_modelo_core(uuid, uuid) FROM PUBLIC, anon, authenticated;",
      "ALTER TABLE public.plan_tecido_variantes\n  ADD COLUMN IF NOT EXISTS distribuicao jsonb NOT NULL DEFAULT '{}'::jsonb,",
      "DO $ck$", "COMMENT ON COLUMN public.plan_tecido_variantes.distribuicao", REDEF[4].cria, "COMMIT;",
    ].map(pos);
    ord.forEach((p, i) => expect(p, `item ${i}`).toBeGreaterThan(i === 0 ? m.indexOf("SET LOCAL transaction_timeout") : ord[i - 1]));
    expect(m).toContain("GRANT EXECUTE ON FUNCTION public.direcionamento_plano_modelo(uuid) TO authenticated;");
    expect(m).toContain("REVOKE ALL ON FUNCTION public.direcionamento_plano_modelo(uuid) FROM PUBLIC, anon;");
    for (const s of ["public._salvar_plan_tecido_core(uuid, jsonb, integer)", "public._plan_tecido_gravar_bom_core(uuid, jsonb)", "public._plan_tecido_snapshot(uuid)", "public._plan_tecido_arvore_core(uuid)"])
      expect(m).toContain(`REVOKE EXECUTE ON FUNCTION ${s} FROM PUBLIC, anon, authenticated;`);
    expect(m).not.toMatch(/DROP\s+(COLUMN|TABLE|FUNCTION)/i);
  });
  it("inverso: confirmação + LIFO (exige a tabela antiga) → árvore ANTES → demais → DROP das novas → DROP COLUMN POR ÚLTIMO", () => {
    const v = ler(INV);
    expect(v).toContain("app.confirmo_apagar_distribuicao_por_produto");
    expect(v).toContain("to_regclass('public.distribuicao_tabelas') IS NULL");
    const iArv = v.indexOf(REDEF[4].cria), iSalvar = v.indexOf(REDEF[0].cria), iDrop = v.indexOf("DROP FUNCTION IF EXISTS public.direcionamento_plano_modelo(uuid);");
    const iAlter = v.indexOf("ALTER TABLE public.plan_tecido_variantes");
    expect(iArv).toBeGreaterThan(v.indexOf("DO $guarda$"));
    expect(iSalvar).toBeGreaterThan(iArv);
    expect(iDrop).toBeGreaterThan(iSalvar);
    expect(iAlter).toBeGreaterThan(iDrop);
    expect(v.slice(iAlter).replace(/--[^\n]*/g, "").trim()).toBe(
      "ALTER TABLE public.plan_tecido_variantes\n  DROP CONSTRAINT IF EXISTS plan_tecido_variantes_atende_array,\n  DROP CONSTRAINT IF EXISTS plan_tecido_variantes_distribuicao_objeto,\n  DROP COLUMN IF EXISTS atende,\n  DROP COLUMN IF EXISTS distribuicao;\n\nCOMMIT;");
  });
});

async function jaAplicada(): Promise<boolean> {
  if (!hasDb || !LOCAL || MIG_TXN) return false;
  const c = new Client({ connectionString: dbUrl()!, ssl: false });
  await c.connect();
  try {
    return (await c.query("select to_regprocedure('public.direcionamento_plano_modelo(uuid)') is not null as ok")).rows[0]?.ok === true;
  } finally {
    await c.end();
  }
}
const PRONTO = hasDb && LOCAL && (MIG_TXN || (await jaAplicada()));

async function prepara(c: Client): Promise<void> {
  exigeBancoLocal();
  await c.query("SET LOCAL lock_timeout = '3s'");
  await c.query("SET LOCAL statement_timeout = '60s'");
  if (MIG_TXN) await aplica(c, MIG);
}
const def = async (c: Client, fn: string) => (await um<{ d: string | null }>(c, "select pg_get_functiondef(to_regprocedure($1)) d", [fn])).d;
const privs = (c: Client, fn: string) =>
  um<{ pub: boolean; anon: boolean; auth: boolean; srv: boolean }>(c,
    `select exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') pub,
            has_function_privilege('anon', p.oid, 'EXECUTE') anon, has_function_privilege('authenticated', p.oid, 'EXECUTE') auth,
            has_function_privilege('service_role', p.oid, 'EXECUTE') srv
       from pg_proc p where p.oid = to_regprocedure($1)`, [fn]);
async function falha(c: Client, sql: string, params: unknown[] = []): Promise<{ code: string; message: string }> {
  await c.query("SAVEPOINT dist_falha");
  try {
    await c.query(sql, params);
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT dist_falha");
    const err = e as { code?: string; message?: string };
    return { code: String(err.code ?? ""), message: String(err.message ?? "") };
  }
  await c.query("RELEASE SAVEPOINT dist_falha");
  throw new Error(`esperava erro e passou: ${sql}`);
}
/** Liga criação/PCP/distribuição da Loja Teste e REBAIXA o super_admin do usuário de teste (txn revertida) — sem isso
 *  `tenant_module_enabled` devolve sempre true (is_super_admin). */
async function lojaComModulos(c: Client, distribuicao: boolean): Promise<void> {
  await comoUsuario(c);
  await c.query("delete from public.user_roles where user_id = $1 and role = 'super_admin'", [USER_TESTE]);
  await c.query(
    `insert into tenant_config (tenant_id, modules) values ($1, $2::jsonb)
     on conflict (tenant_id) do update set modules = tenant_config.modules || $2::jsonb`,
    [TENANT_TESTE, JSON.stringify({ criacao: true, producao: true, otb: true, distribuicao })],
  );
}
type Cena = { col: string; artigo: string; vtMarrom: string; vtPreto: string; corMarrom: string; corPreto: string; corVinho: string; lojas: string[] };
async function cena(c: Client): Promise<Cena> {
  const T = TENANT_TESTE;
  const col = await um<{ id: string }>(c, "insert into colecoes (nome, status) values ('ITEST-DIST', 'rascunho') returning id");
  const artigo = await um<{ id: string }>(c, "insert into artigos (tenant_id, nome) values ($1, 'ITEST-DIST Crepe') returning id", [T]);
  const cor = async (n: string) => (await um<{ id: string }>(c, "insert into cores (tenant_id, nome) values ($1, $2) returning id", [T, n])).id;
  const corMarrom = await cor("ITEST-DIST Marrom"), corPreto = await cor("ITEST-DIST Preto"), corVinho = await cor("ITEST-DIST Vinho");
  const vt = async (corId: string) => (await um<{ id: string }>(c,
    "insert into variantes_tecido (tenant_id, artigo_id, cor_id) values ($1, $2, $3) returning id", [T, artigo.id, corId])).id;
  const lojas = (await c.query("select id from lojas_direcionamento where tenant_id = $1 and ativo order by is_default desc, ordem nulls last limit 2", [T])).rows.map((r) => r.id as string);
  if (lojas.length < 2) throw new Error("a Loja Teste precisa de 2 lojas ativas em lojas_direcionamento (cópia)");
  return { col: col.id, artigo: artigo.id, vtMarrom: await vt(corMarrom), vtPreto: await vt(corPreto), corMarrom, corPreto, corVinho, lojas };
}
const dist = (loja: string, base: number, grades: Record<string, number>, manuais: string[] = []) => ({ [loja]: { base, grades, manuais } });
const arvore = (slots: unknown[]) => ({ subcolecoes: [{ subcolecao_id: null, ordem: 0, linhas: [{ linha_id: null, categoria_id: null, ordem: 0, slots }] }] });
const ler1 = async (c: Client, col: string) => (await um<{ a: any }>(c, "select public.plan_tecido_arvore($1) a", [col])).a.subcolecoes[0].linhas[0].slots[0];

describe.skipIf(!PRONTO)("Distribuição A — banco (cópia local, txn revertida)", () => {
  it("colunas: distribuicao jsonb NOT NULL DEFAULT '{}', atende jsonb NULL; CHECKs recusam forma errada (23514)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const { rows } = await c.query(
        `select a.attname nome, format_type(a.atttypid, a.atttypmod) tipo, a.attnotnull nn, pg_get_expr(d.adbin, d.adrelid) def
           from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
          where a.attrelid = 'public.plan_tecido_variantes'::regclass and a.attname in ('distribuicao','atende') and not a.attisdropped order by 1`);
      expect(rows).toEqual([
        { nome: "atende", tipo: "jsonb", nn: false, def: null },
        { nome: "distribuicao", tipo: "jsonb", nn: true, def: "'{}'::jsonb" },
      ]);
      const pv = await um<{ id: string }>(c, "select id from plan_tecido_variantes limit 1");
      if (pv) {
        expect((await falha(c, "update plan_tecido_variantes set distribuicao = '[]'::jsonb where id = $1", [pv.id])).code).toBe("23514");
        expect((await falha(c, "update plan_tecido_variantes set atende = '{}'::jsonb where id = $1", [pv.id])).code).toBe("23514");
      }
    });
  });

  it("5 redefinidas e 2 novas: texto = o do arquivo (md5 'depois'); ACL (#9) — internas fechadas, wrapper só authenticated, tenant_module_enabled INTOCADA", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const g = guardas(MIG);
      for (const [i, f] of REDEF.entries()) {
        const d = (await def(c, f.fn))!;
        expect(d, f.arq).toBe(corpo(MIG, f.cria) + "\n");
        expect(md5(d), f.arq).toBe(g[i].depois);
      }
      for (const n of NOVAS) expect((await def(c, n.fn))!).toBe(corpo(MIG, n.cria) + "\n");
      for (const fn of ["public._salvar_plan_tecido_core(uuid,jsonb,integer)", "public._plan_tecido_gravar_bom_core(uuid,jsonb)", "public._plan_tecido_snapshot(uuid)", "public._plan_tecido_arvore_core(uuid)", "public._direcionamento_plano_modelo_core(uuid,uuid)"])
        expect(await privs(c, fn), fn).toEqual({ pub: false, anon: false, auth: false, srv: true });
      expect(await privs(c, "public.direcionamento_plano_modelo(uuid)")).toEqual({ pub: false, anon: false, auth: true, srv: true });
      expect(await privs(c, "public.tenant_module_enabled(text)")).toEqual({ pub: true, anon: true, auth: true, srv: true });
    });
  });

  it("tenant_module_enabled: 'distribuicao' ausente/false = desligado, 'true' = ligado; 'producao' ausente segue ligado; 'otb' ausente segue desligado", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await lojaComModulos(c, false);
      const ve = async (m: string) => (await um<{ v: boolean }>(c, "select public.tenant_module_enabled($1) v", [m])).v;
      expect(await ve("distribuicao")).toBe(false);
      await c.query("update tenant_config set modules = modules - 'distribuicao' - 'producao' - 'otb' where tenant_id = $1", [TENANT_TESTE]);
      expect([await ve("distribuicao"), await ve("producao"), await ve("otb")]).toEqual([false, true, false]);
      await c.query("update tenant_config set modules = modules || '{\"distribuicao\":true}'::jsonb where tenant_id = $1", [TENANT_TESTE]);
      expect(await ve("distribuicao")).toBe(true);
    });
  });

  it("salvar + árvore: distribuição SÓ no T1 (objeto), 'atende' SÓ fora do T1 (array); forma errada vira default; DEDUP leva a da linha vencedora", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await lojaComModulos(c, true);
      const k = await cena(c);
      const dA = dist(k.lojas[0], 2, { "38|P": 2 }), dB = dist(k.lojas[1], 5, { "40|M": 5 });
      await c.query("select public.salvar_plan_tecido($1, $2::jsonb)", [k.col, JSON.stringify(arvore([{ modelo_id: null, slot_index: 0, nome: "ITEST", materiais: [
        { artigo_id: k.artigo, tipo: "tecido", numero: 1, consumo: 1, loss_percent: 0, ordem: 0, variantes: [
          { variante_tecido_id: k.vtMarrom, ordem: 1, multiplicador: 1, grades: {}, grade_total: 2, distribuicao: dA, atende: [k.vtPreto] },
          { variante_tecido_id: k.vtMarrom, ordem: 2, multiplicador: 1, grades: {}, grade_total: 9, distribuicao: dB, atende: [k.vtPreto] },
          { variante_tecido_id: k.vtPreto, ordem: 3, multiplicador: 1, grades: {}, grade_total: 1, distribuicao: "lixo" },
        ] },
        { artigo_id: k.artigo, tipo: "forro", numero: 1, consumo: 1, loss_percent: 0, ordem: 1, variantes: [
          { variante_tecido_id: k.vtMarrom, ordem: 1, multiplicador: 1, grades: {}, grade_total: 9, distribuicao: dA, atende: [k.vtMarrom, `plan:${k.corVinho}|`] },
          { variante_tecido_id: k.vtPreto, ordem: 2, multiplicador: 1, grades: {}, grade_total: 1, atende: { errado: true } },
        ] },
      ] }]))]);
      const s = await ler1(c, k.col);
      const t1 = s.materiais.find((m: any) => m.tipo === "tecido").variantes;
      expect(t1.map((v: any) => [v.variante_tecido_id, v.grade_total, v.distribuicao, v.atende])).toEqual([
        [k.vtMarrom, 9, dB, null],       // DEDUP: a de MAIOR grade_total vence e leva a SUA distribuição; T1 nunca tem 'atende'
        [k.vtPreto, 1, {}, null],        // forma errada → '{}'
      ]);
      const fr = s.materiais.find((m: any) => m.tipo === "forro").variantes;
      expect(fr.map((v: any) => [v.distribuicao, v.atende])).toEqual([
        [{}, [k.vtMarrom, `plan:${k.corVinho}|`]], // fora do T1: distribuição some, 'atende' fica (inclusive chave de cor planejada)
        [{}, null],                                 // 'atende' que não é array → NULL
      ]);
    });
  });

  it("blindagem: o snapshot do Salvar guarda distribuicao e atende", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await lojaComModulos(c, true);
      const k = await cena(c);
      const d = dist(k.lojas[0], 3, { "38|P": 3 });
      const arv = arvore([{ modelo_id: null, slot_index: 0, nome: "ITEST", materiais: [
        { artigo_id: k.artigo, tipo: "tecido", numero: 1, consumo: 1, loss_percent: 0, ordem: 0, variantes: [{ variante_tecido_id: k.vtMarrom, ordem: 1, multiplicador: 1, grades: {}, grade_total: 3, distribuicao: d }] },
        { artigo_id: k.artigo, tipo: "forro", numero: 1, consumo: 1, loss_percent: 0, ordem: 1, variantes: [{ variante_tecido_id: k.vtPreto, ordem: 1, multiplicador: 1, grades: {}, grade_total: 3, atende: [k.vtMarrom] }] },
      ] }]);
      await c.query("select public.salvar_plan_tecido($1, $2::jsonb)", [k.col, JSON.stringify(arv)]);
      await c.query("select public.salvar_plan_tecido($1, $2::jsonb)", [k.col, JSON.stringify(arv)]); // 2º save snapshota o 1º
      const p = (await um<{ p: any }>(c, "select payload p from plan_tecido_snapshots where colecao_id = $1 order by created_at desc, id desc limit 1", [k.col])).p;
      const mats = p.arvore.subcolecoes[0].linhas[0].slots[0].materiais;
      expect(mats[0].variantes[0].distribuicao).toEqual(d);
      expect(mats[1].variantes[0].atende).toEqual([k.vtMarrom]);
    });
  });

  it("gravar BOM: casamento do payload (só ids REAIS do T1 do payload); T1 nunca casa; chave ausente PRESERVA; [] limpa (R3)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await lojaComModulos(c, true);
      const k = await cena(c);
      const m = await um<{ id: string }>(c, "insert into modelos (tenant_id, nome, origem) values ($1, 'ITEST-DIST BOM', 'interno') returning id", [TENANT_TESTE]);
      const outro = await um<{ id: string } | undefined>(c, "select id from variantes_tecido where tenant_id <> $1 limit 1", [TENANT_TESTE]);
      const payload = (forro: Record<string, unknown>) => JSON.stringify([
        { tipo: "tecido", numero: 1, artigo_id: k.artigo, consumo: 1, loss_percent: 0, variantes: [
          { variante_tecido_id: k.vtMarrom, ordem: 1, multiplicador: 1, grades: { "38|P": 5 }, grade_total: 5, complementa_variante_ids: [k.vtPreto] },
          { variante_tecido_id: k.vtPreto, ordem: 2, multiplicador: 1, grades: { "38|P": 7 }, grade_total: 7 },
        ] },
        { tipo: "forro", numero: 1, artigo_id: k.artigo, consumo: 1, loss_percent: 0, variantes: [{ variante_tecido_id: k.vtMarrom, ordem: 1, multiplicador: 1, ...forro }] },
      ]);
      const comp = async () => (await c.query(
        `select mt.tipo, mtv.variante_tecido_id v, mtv.complementa_variante_ids c from modelo_tecido_variantes mtv
           join modelo_tecidos mt on mt.id = mtv.modelo_tecido_id where mt.modelo_id = $1 order by mt.tipo desc, mtv.ordem`, [m.id])).rows
        .map((r) => [r.tipo, r.c ? [...r.c].sort() : null]);
      await c.query("select public._plan_tecido_gravar_bom_core($1, $2::jsonb)", [m.id,
        payload({ complementa_variante_ids: [k.vtPreto, k.vtMarrom, "lixo", ...(outro ? [outro.id] : [])] })]);
      expect(await comp()).toEqual([["tecido", null], ["tecido", null], ["forro", [k.vtMarrom, k.vtPreto].sort()]]);
      expect((await um<{ s: string }>(c, "select public._grade_soma_pares($1, $2::uuid[])::text s", [m.id, [k.vtMarrom, k.vtPreto]])).s).toBe("12");
      await c.query("select public._plan_tecido_gravar_bom_core($1, $2::jsonb)", [m.id, payload({})]); // SEM a chave
      expect((await comp())[2]).toEqual(["forro", [k.vtMarrom, k.vtPreto].sort()]);
      await c.query("select public._plan_tecido_gravar_bom_core($1, $2::jsonb)", [m.id, payload({ complementa_variante_ids: [] })]);
      expect((await comp())[2]).toEqual(["forro", null]);
    });
  });

  it("direcionamento_plano_modelo: plano do modelo (variante_numero pelo BOM), sem correspondência, direcionados; IDOR; motivos", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await lojaComModulos(c, true);
      const k = await cena(c);
      const [L1, L2] = k.lojas;
      const mo = await um<{ id: string }>(c,
        "insert into modelos (tenant_id, nome, colecao_id, colecao, subcolecao, origem) values ($1, 'ITEST-DIST Vestido', $2, 'ITEST-DIST', 'Drop 1', 'interno') returning id", [TENANT_TESTE, k.col]);
      const irmao = await um<{ id: string }>(c,
        "insert into modelos (tenant_id, nome, colecao_id, colecao, subcolecao, origem) values ($1, 'ITEST-DIST Irmão', $2, 'ITEST-DIST', 'Drop 1', 'interno') returning id", [TENANT_TESTE, k.col]);
      await c.query("insert into cad (modelo_id, direcionamento_status) values ($1, 'separado')", [irmao.id]);
      const mt = await um<{ id: string }>(c, "insert into modelo_tecidos (modelo_id, artigo_id, numero, tipo) values ($1, $2, 1, 'tecido') returning id", [mo.id, k.artigo]);
      await c.query("insert into modelo_tecido_variantes (modelo_tecido_id, variante_tecido_id, ordem) values ($1, $2, 1), ($1, $3, 2)", [mt.id, k.vtPreto, k.vtMarrom]);
      await c.query("select public.salvar_plan_tecido($1, $2::jsonb)", [k.col, JSON.stringify(arvore([{ modelo_id: mo.id, slot_index: 0, materiais: [
        { artigo_id: k.artigo, tipo: "tecido", numero: 1, consumo: 1, loss_percent: 0, ordem: 0, variantes: [
          { variante_tecido_id: k.vtMarrom, ordem: 1, multiplicador: 1, grades: {}, grade_total: 7, distribuicao: { ...dist(L1, 5, { "38|P": 4, "40|M": 10 }, ["38|P"]), ...dist(L2, 1, { "38|P": 1.6 }) } },
          { variante_tecido_id: k.vtPreto, ordem: 2, multiplicador: 1, grades: {}, grade_total: 3, distribuicao: dist(L1, 3, { "38|P": 3 }) },
          { variante_tecido_id: null, cor_id: k.corVinho, ordem: 3, multiplicador: 1, grades: {}, grade_total: 2, distribuicao: dist(L2, 2, { "40|M": 2 }) },
          { variante_tecido_id: null, cor_id: k.corPreto, cor_apelido_id: null, ordem: 4, multiplicador: 1, grades: {}, grade_total: 0 },
        ] },
      ] }]))]);
      const r = (await um<{ r: any }>(c, "select public.direcionamento_plano_modelo($1) r", [mo.id])).r;
      expect([r.subcolecao, r.direcionados, r.motivo_sem_plano]).toEqual(["Drop 1", 1, null]);
      expect(r.plano.variantes.map((v: any) => [v.variante_numero, v.cor_nome])).toEqual([[1, "ITEST-DIST Preto"], [2, "ITEST-DIST Marrom"], [null, "ITEST-DIST Vinho"]]);
      expect(r.plano.celulas).toEqual([
        { loja_id: L1, variante_numero: 1, grades: { "38|P": 3 } },
        { loja_id: L1, variante_numero: 2, grades: { "38|P": 4, "40|M": 10 } },
        { loja_id: L2, variante_numero: 2, grades: { "38|P": 2 } },            // 1.6 arredonda
      ]);
      expect(r.plano.sem_correspondencia).toEqual([{ cor_nome: "ITEST-DIST Vinho", apelido_nome: null, total: 2 }]);
      expect(r.plano.lojas.map((l: any) => l.loja_id)).toEqual([L1, L2]);
      expect(r.plano.tamanho_tipo).toBe("letra");
      // IDOR: modelo de outra loja
      const alheio = await um<{ id: string } | undefined>(c, "select id from modelos where tenant_id <> $1 limit 1", [TENANT_TESTE]);
      if (alheio) expect((await falha(c, "select public.direcionamento_plano_modelo($1)", [alheio.id])).code).toBe("P0001");
      // motivos
      await c.query("update modelos set origem = 'revenda' where id = $1", [mo.id]);
      expect((await um<{ r: any }>(c, "select public.direcionamento_plano_modelo($1) r", [mo.id])).r.motivo_sem_plano).toBe("comprado");
      await c.query("update modelos set origem = 'interno' where id = $1", [mo.id]);
      expect((await um<{ r: any }>(c, "select public.direcionamento_plano_modelo($1) r", [irmao.id])).r).toMatchObject({ plano: null, motivo_sem_plano: "sem_plano_tecido", direcionados: 1 });
      await c.query("update tenant_config set modules = modules || '{\"distribuicao\":false}'::jsonb where tenant_id = $1", [TENANT_TESTE]);
      expect((await um<{ r: any }>(c, "select public.direcionamento_plano_modelo($1) r", [mo.id])).r).toMatchObject({ plano: null, motivo_sem_plano: "modulo_desligado", direcionados: 1 });
    });
  });

  it("guarda 'outra frente': se uma redefinida já mudou (md5 fora de antes/depois), a migration RECUSA (P0001)", async () => {
    if (!MIG_TXN) return; // só no modo txn (a cópia sem a migration)
    await withTx(async (c) => {
      exigeBancoLocal();
      await c.query("SET LOCAL lock_timeout = '3s'");
      const t = (await def(c, "public._plan_tecido_snapshot(uuid)"))!;
      await c.query(t.replace("retenção: 20 últimos", "retenção: 21 últimos")); // outra frente mexeu
      await c.query("SAVEPOINT g");
      let erro = "";
      try { await aplica(c, MIG); } catch (e) { erro = String((e as Error).message); }
      await c.query("ROLLBACK TO SAVEPOINT g");
      expect(erro).toMatch(/_plan_tecido_snapshot mudou/);
    });
  });

  it("idempotência: aplicar 2× não falha; inverso (com confirmação) devolve as 5 ao texto de antes e tira colunas e RPCs; sem confirmação RECUSA", async () => {
    if (!MIG_TXN) return;
    await withTx(async (c) => {
      await prepara(c);
      await aplica(c, MIG); // 2ª vez
      const semConf = await (async () => { await c.query("SAVEPOINT s"); try { await aplica(c, INV); return ""; } catch (e) { await c.query("ROLLBACK TO SAVEPOINT s"); return String((e as Error).message); } })();
      expect(semConf).toMatch(/confirmo_apagar_distribuicao_por_produto/);
      await c.query("SET LOCAL app.confirmo_apagar_distribuicao_por_produto = 'sim'");
      await aplica(c, INV);
      const g = guardas(INV);
      for (const [i, f] of REDEF.entries()) expect(md5((await def(c, f.fn))!), f.arq).toBe(g[i].antes);
      expect((await um<{ n: number }>(c, "select count(*)::int n from information_schema.columns where table_name = 'plan_tecido_variantes' and column_name in ('distribuicao','atende')")).n).toBe(0);
      expect((await um<{ n: boolean }>(c, "select to_regprocedure('public.direcionamento_plano_modelo(uuid)') is null n")).n).toBe(true);
      await aplica(c, INV); // inverso 2× também não falha
    });
  });
});
```

- [ ] **Step 3: N3 + rodar e ver falhar**

O CONTROLADOR avisa o dono (texto do `n3.sh`) e, com o OK:

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/distribuicao-produto"
DIST_DONO_AVISADO=sim bash .superpowers/distribuicao/n3.sh antes t4s3
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres DIST_MIG_TXN=1 npx vitest run --no-file-parallelism tests/integration/distribuicao-produto.test.ts 2>&1 | tail -12
bash .superpowers/distribuicao/n3.sh depois t4s3
```

Expected: FAIL — `ENOENT … 20261006100000_distribuicao_por_produto.sql`.

- [ ] **Step 4: O gerador — `.superpowers/distribuicao/mig/gerar_sql.py`**

```python
#!/usr/bin/env python3
"""Distribuição por produto — GERA a migration ADITIVA 20261006100000 e o inverso (plano 2026-09-25, Task 4).
Entrada (dump SÓ LEITURA da cópia — dump_antes.sh): .superpowers/distribuicao/mig/antes/{salvar,gravar_bom,snapshot,modulo,arvore}.sql
e md5-redef-antes.txt. Saída: supabase/migrations/20261006100000_distribuicao_por_produto.sql,
supabase/rollback/20261006100000_distribuicao_por_produto_down.sql, md5-redef-depois.txt, md5-novas-depois.txt.
NUNCA editar os .sql à mão — mudar AQUI, regerar e rodar a suíte (Task 4)."""
import hashlib
import pathlib
import sys

RAIZ = pathlib.Path(__file__).resolve().parents[3]
M = RAIZ / ".superpowers" / "distribuicao" / "mig"
NOME = "20261006100000_distribuicao_por_produto"
MIG = RAIZ / "supabase" / "migrations" / f"{NOME}.sql"
INV = RAIZ / "supabase" / "rollback" / f"{NOME}_down.sql"

# (arquivo do dump, assinatura p/ to_regprocedure, assinatura do REVOKE — None = ACL INTOCADA). Ordem FIXA = md5-redef-*.txt.
REDEF = [
    ("salvar", "public._salvar_plan_tecido_core(uuid,jsonb,integer)", "public._salvar_plan_tecido_core(uuid, jsonb, integer)"),
    ("gravar_bom", "public._plan_tecido_gravar_bom_core(uuid,jsonb)", "public._plan_tecido_gravar_bom_core(uuid, jsonb)"),
    ("snapshot", "public._plan_tecido_snapshot(uuid)", "public._plan_tecido_snapshot(uuid)"),
    ("modulo", "public.tenant_module_enabled(text)", None),  # chamada pelas policies COMO o usuário: ACL fica como está (R5)
    ("arvore", "public._plan_tecido_arvore_core(uuid)", "public._plan_tecido_arvore_core(uuid)"),  # LANGUAGE sql: DEPOIS do ALTER
]
CAPTURA_COMP = (
    "  -- [Distribuição por produto, 20261006100000] \"atende a\" = casar variantes (R3): o casamento que o BOM já tinha\n"
    "  -- (complementa_variante_ids) é guardado ANTES do delete — payload SEM a chave o PRESERVA (antes ele sumia em\n"
    "  -- silêncio a cada aplicar). Com a chave, só entram ids de variante REAL do Tecido 1 deste mesmo payload.\n"
    "  select coalesce(jsonb_object_agg(mt.tipo || '|' || mt.numero || '|' || mtv.variante_tecido_id::text,\n"
    "                                   to_jsonb(mtv.complementa_variante_ids)), '{}'::jsonb)\n"
    "    into v_comp_antes\n"
    "  from modelo_tecido_variantes mtv\n"
    "  join modelo_tecidos mt on mt.id = mtv.modelo_tecido_id\n"
    "  where mt.modelo_id = _modelo and mt.tipo in ('tecido','forro')\n"
    "    and mtv.variante_tecido_id is not null and mtv.complementa_variante_ids is not null;\n"
    "  select coalesce(array_agg(distinct (v2->>'variante_tecido_id')::uuid), '{}'::uuid[])\n"
    "    into v_t1_ids\n"
    "  from jsonb_array_elements(coalesce(_materiais, '[]'::jsonb)) m2\n"
    "  cross join lateral jsonb_array_elements(coalesce(m2->'variantes', '[]'::jsonb)) v2\n"
    "  where coalesce(nullif(m2->>'tipo',''), 'tecido') = 'tecido' and coalesce((m2->>'numero')::int, 1) = 1\n"
    "    and nullif(m2->>'artigo_id','') is not null and nullif(v2->>'variante_tecido_id','') is not null;\n"
    "\n"
)
INSERT_VAR_ANTES = (
    "      insert into modelo_tecido_variantes (modelo_tecido_id, variante_tecido_id, ordem, multiplicador)\n"
    "      values (v_mt, (v->>'variante_tecido_id')::uuid, coalesce((v->>'ordem')::int, 1),\n"
    "              coalesce((v->>'multiplicador')::numeric, 1));\n"
)
INSERT_VAR_DEPOIS = (
    "      insert into modelo_tecido_variantes (modelo_tecido_id, variante_tecido_id, ordem, multiplicador, complementa_variante_ids)\n"
    "      values (v_mt, (v->>'variante_tecido_id')::uuid, coalesce((v->>'ordem')::int, 1),\n"
    "              coalesce((v->>'multiplicador')::numeric, 1),\n"
    "              case\n"
    "                when v_tipo = 'tecido' and v_num = 1 then null   -- o Tecido 1 é a âncora: nunca casa\n"
    "                when v ? 'complementa_variante_ids' then (\n"
    "                  select nullif(array_agg(distinct x.id), '{}'::uuid[])\n"
    "                  from (select (e.val)::uuid as id\n"
    "                          from jsonb_array_elements_text(\n"
    "                                 case when jsonb_typeof(v->'complementa_variante_ids') = 'array'\n"
    "                                      then v->'complementa_variante_ids' else '[]'::jsonb end) as e(val)\n"
    "                         where e.val ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') x\n"
    "                  where x.id = any(v_t1_ids))\n"
    "                else (\n"
    "                  select array_agg((e.val)::uuid)\n"
    "                  from jsonb_array_elements_text(v_comp_antes -> (v_tipo || '|' || v_num || '|' || (v->>'variante_tecido_id'))) as e(val))\n"
    "              end);\n"
)
T1_SQL = "coalesce(v_mat->>'tipo','tecido') = 'tecido' and coalesce((v_mat->>'numero')::int,1) = 1"
TROCAS = {
    "salvar": [
        ("          insert into plan_tecido_variantes (material_id, variante_tecido_id, cor_id, cor_apelido_id, ordem, multiplicador, grades, grade_total)\n",
         "          insert into plan_tecido_variantes (material_id, variante_tecido_id, cor_id, cor_apelido_id, ordem, multiplicador, grades, grade_total, distribuicao, atende)\n"),
        ("                 w.multiplicador, w.grades, w.grade_total\n",
         "                 w.multiplicador, w.grades, w.grade_total, w.distribuicao, w.atende\n"),
        ("                coalesce((e->>'grade_total')::int,0)       as grade_total,\n",
         "                coalesce((e->>'grade_total')::int,0)       as grade_total,\n"
         "                -- Distribuição por produto (20261006100000): `distribuicao` SÓ no Tecido 1 e só objeto; `atende` SÓ fora\n"
         "                -- do Tecido 1 e só array (o DEDUP leva as da linha vencedora).\n"
         f"                case when {T1_SQL} and jsonb_typeof(e->'distribuicao') = 'object'\n"
         "                     then e->'distribuicao' else '{}'::jsonb end as distribuicao,\n"
         f"                case when not ({T1_SQL}) and jsonb_typeof(e->'atende') = 'array'\n"
         "                     then e->'atende' else null end as atende,\n"),
    ],
    "gravar_bom": [
        ("declare m jsonb; v jsonb; v_mt uuid; v_num int; v_tipo text;\n",
         "declare m jsonb; v jsonb; v_mt uuid; v_num int; v_tipo text;\n  v_comp_antes jsonb; v_t1_ids uuid[];\n"),
        ("  -- limpa só tecido/forro (entretela e demais tipos ficam intactos) + a grade planejada\n",
         CAPTURA_COMP + "  -- limpa só tecido/forro (entretela e demais tipos ficam intactos) + a grade planejada\n"),
        (INSERT_VAR_ANTES, INSERT_VAR_DEPOIS),
    ],
    "snapshot": [
        ("                      'grade_total', pv.grade_total\n",
         "                      'grade_total', pv.grade_total,\n                      'distribuicao', pv.distribuicao, 'atende', pv.atende\n"),
    ],
    "modulo": [
        ("    _module NOT IN ('otb', 'produto_acabado', 'produto_importado')\n",
         "    _module NOT IN ('otb', 'produto_acabado', 'produto_importado', 'distribuicao')\n"),
        ("  -- ATENÇÃO: toda chave opt-in-default-OFF NOVA precisa entrar nesta lista — espelha\n",
         "  -- 'distribuicao' entrou em 20261006100000 (Distribuição por produto): servidor = front (chave ausente = desligado).\n"
         "  -- ATENÇÃO: toda chave opt-in-default-OFF NOVA precisa entrar nesta lista — espelha\n"),
    ],
    "arvore": [
        ("                        'grades', vv.grades, 'grade_total', vv.grade_total) order by vv.ordem)\n",
         "                        'grades', vv.grades, 'grade_total', vv.grade_total,\n"
         "                        'distribuicao', vv.distribuicao, 'atende', vv.atende) order by vv.ordem)\n"),
    ],
}

CORE = "".join([
    "CREATE OR REPLACE FUNCTION public._direcionamento_plano_modelo_core(_modelo_id uuid, _tenant uuid)\n",
    " RETURNS jsonb\n",
    " LANGUAGE plpgsql\n",
    " STABLE SECURITY DEFINER\n",
    " SET search_path TO 'public'\n",
    "AS $function$\n",
    "DECLARE\n",
    "  v_colecao text;\n",
    "  v_colecao_id uuid;\n",
    "  v_subcolecao text;\n",
    "  v_origem text;\n",
    "  v_tipo text;\n",
    "  v_direcionados bigint := 0;\n",
    "  v_base jsonb;\n",
    "  v_slot uuid;\n",
    "  v_tamanhos jsonb;\n",
    "  v_plano jsonb;\n",
    "BEGIN\n",
    "  -- Distribuição por produto (20261006100000, spec R21/R38): o PLANO SALVO do Plan. Tecido para o Direcionamento, por\n",
    "  -- modelo, só leitura. NÃO é gate de nada (invariante #10 — o Confirmar segue comparando com a Grade Real).\n",
    "  SELECT NULLIF(btrim(m.colecao), ''), m.colecao_id, NULLIF(btrim(m.subcolecao), ''),\n",
    "         COALESCE(NULLIF(m.origem, ''), 'interno'), CASE WHEN m.tamanho_tipo = 'numero' THEN 'numero' ELSE 'letra' END\n",
    "    INTO v_colecao, v_colecao_id, v_subcolecao, v_origem, v_tipo\n",
    "  FROM modelos m\n",
    "  WHERE m.id = _modelo_id AND m.tenant_id = _tenant;\n",
    "  IF NOT FOUND THEN\n",
    "    RAISE EXCEPTION 'Modelo não encontrado' USING ERRCODE = 'P0001';\n",
    "  END IF;\n",
    "\n",
    "  -- \"X modelos direcionados\" (P-16 = C): a mesma conta da RPC antiga direcionamento_resumo_subcolecao.\n",
    "  IF v_subcolecao IS NOT NULL THEN\n",
    "    SELECT count(DISTINCT m2.id) INTO v_direcionados\n",
    "    FROM modelos m2\n",
    "    JOIN cad c ON c.modelo_id = m2.id\n",
    "    WHERE m2.tenant_id = _tenant\n",
    "      AND NULLIF(btrim(m2.colecao), '') IS NOT DISTINCT FROM v_colecao\n",
    "      AND NULLIF(btrim(m2.subcolecao), '') IS NOT DISTINCT FROM v_subcolecao\n",
    "      AND c.direcionamento_status = 'separado';\n",
    "  END IF;\n",
    "  v_base := jsonb_build_object('subcolecao', v_subcolecao, 'direcionados', v_direcionados);\n",
    "\n",
    "  IF NOT public.tenant_module_enabled('distribuicao') THEN\n",
    "    RETURN v_base || jsonb_build_object('plano', NULL, 'motivo_sem_plano', 'modulo_desligado');\n",
    "  END IF;\n",
    "  IF v_origem IN ('revenda', 'importado') THEN\n",
    "    RETURN v_base || jsonb_build_object('plano', NULL, 'motivo_sem_plano', 'comprado');\n",
    "  END IF;\n",
    "\n",
    "  -- Slot do plano da COLEÇÃO ATUAL do modelo (prefere o que tem distribuição).\n",
    "  SELECT sl.id INTO v_slot\n",
    "  FROM plan_tecido_slots sl\n",
    "  JOIN plan_tecido_linhas l ON l.id = sl.linha_ref_id\n",
    "  JOIN plan_tecido_subcolecoes s ON s.id = l.sub_id\n",
    "  JOIN plan_tecido p ON p.id = s.plan_id\n",
    "  WHERE sl.modelo_id = _modelo_id AND sl.tenant_id = _tenant AND p.colecao_id = v_colecao_id\n",
    "  ORDER BY EXISTS (SELECT 1 FROM plan_tecido_materiais pm\n",
    "                     JOIN plan_tecido_variantes pv ON pv.material_id = pm.id\n",
    "                    WHERE pm.slot_id = sl.id AND pm.tipo = 'tecido' AND pm.numero = 1\n",
    "                      AND pv.distribuicao <> '{}'::jsonb) DESC,\n",
    "           sl.slot_index, sl.id\n",
    "  LIMIT 1;\n",
    "  IF v_slot IS NULL THEN\n",
    "    RETURN v_base || jsonb_build_object('plano', NULL, 'motivo_sem_plano', 'sem_plano_tecido');\n",
    "  END IF;\n",
    "\n",
    "  SELECT tc.tamanhos_grade INTO v_tamanhos FROM tenant_config tc WHERE tc.tenant_id = _tenant;\n",
    "  v_tamanhos := COALESCE(v_tamanhos, '[\"34|PPP\",\"36|PP\",\"38|P\",\"40|M\",\"42|G\",\"44|GG\"]'::jsonb);\n",
    "\n",
    "  WITH t1 AS (   -- cores do Tecido 1 do plano COM distribuição; variante_numero = ordem da variante no Tecido 1 do BOM\n",
    "    SELECT pv.variante_tecido_id, pv.ordem, pv.distribuicao,\n",
    "           COALESCE(c1.nome, c2.nome)::text AS cor_nome, COALESCE(a1.nome, a2.nome)::text AS apelido_nome,\n",
    "           (SELECT min(mv.ordem) FROM modelo_tecido_variantes mv\n",
    "              JOIN modelo_tecidos mt ON mt.id = mv.modelo_tecido_id\n",
    "             WHERE mt.modelo_id = _modelo_id AND mt.tipo = 'tecido' AND mt.numero = 1\n",
    "               AND mv.variante_tecido_id = pv.variante_tecido_id) AS variante_numero\n",
    "    FROM plan_tecido_materiais pm\n",
    "    JOIN plan_tecido_variantes pv ON pv.material_id = pm.id\n",
    "    LEFT JOIN variantes_tecido vt ON vt.id = pv.variante_tecido_id\n",
    "    LEFT JOIN cores c1 ON c1.id = vt.cor_id\n",
    "    LEFT JOIN cores_apelido a1 ON a1.id = vt.cor_apelido_id\n",
    "    LEFT JOIN cores c2 ON c2.id = pv.cor_id\n",
    "    LEFT JOIN cores_apelido a2 ON a2.id = pv.cor_apelido_id\n",
    "    WHERE pm.slot_id = v_slot AND pm.tipo = 'tecido' AND pm.numero = 1\n",
    "      AND jsonb_typeof(pv.distribuicao) = 'object' AND pv.distribuicao <> '{}'::jsonb\n",
    "  ), cel AS (   -- 1 linha por (cor × loja), grade saneada (inteiro >= 0)\n",
    "    SELECT t1.variante_numero, t1.ordem, t1.cor_nome, t1.apelido_nome, (d.key)::uuid AS loja_id,\n",
    "           COALESCE((SELECT jsonb_object_agg(g.key, round((g.value)::numeric)::int)\n",
    "                       FROM jsonb_each_text(CASE WHEN jsonb_typeof(d.value -> 'grades') = 'object'\n",
    "                                                 THEN d.value -> 'grades' ELSE '{}'::jsonb END) g\n",
    "                      WHERE g.value ~ '^[0-9]+([.][0-9]+)?$'), '{}'::jsonb) AS grades\n",
    "    FROM t1\n",
    "    CROSS JOIN LATERAL jsonb_each(t1.distribuicao) d\n",
    "    WHERE d.key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'\n",
    "  ), cel_ok AS (   -- só lojas desta loja (tenant) que ainda existem no cadastro\n",
    "    SELECT cel.*, ld.nome AS loja_nome, ld.ativo, ld.is_default, ld.ordem AS loja_ordem,\n",
    "           (SELECT COALESCE(sum((g.value)::int), 0) FROM jsonb_each_text(cel.grades) g) AS total\n",
    "    FROM cel\n",
    "    JOIN lojas_direcionamento ld ON ld.id = cel.loja_id AND ld.tenant_id = _tenant\n",
    "  )\n",
    "  SELECT jsonb_build_object(\n",
    "    'tamanho_tipo', v_tipo,\n",
    "    'tamanhos', v_tamanhos,\n",
    "    'lojas', COALESCE((SELECT jsonb_agg(jsonb_build_object('loja_id', x.loja_id, 'nome', x.loja_nome, 'ativo', x.ativo,\n",
    "                                                          'is_default', x.is_default, 'ordem', x.loja_ordem)\n",
    "                                        ORDER BY x.is_default DESC, x.loja_ordem NULLS LAST, x.loja_nome)\n",
    "                       FROM (SELECT DISTINCT loja_id, loja_nome, ativo, is_default, loja_ordem FROM cel_ok) x), '[]'::jsonb),\n",
    "    'variantes', COALESCE((SELECT jsonb_agg(jsonb_build_object('variante_numero', t.variante_numero,\n",
    "                                                              'variante_tecido_id', t.variante_tecido_id,\n",
    "                                                              'cor_nome', t.cor_nome, 'apelido_nome', t.apelido_nome)\n",
    "                                            ORDER BY t.variante_numero NULLS LAST, t.ordem)\n",
    "                           FROM t1 t), '[]'::jsonb),\n",
    "    'celulas', COALESCE((SELECT jsonb_agg(jsonb_build_object('loja_id', c.loja_id, 'variante_numero', c.variante_numero,\n",
    "                                                            'grades', c.grades)\n",
    "                                          ORDER BY c.variante_numero, c.is_default DESC, c.loja_ordem NULLS LAST)\n",
    "                         FROM cel_ok c WHERE c.variante_numero IS NOT NULL), '[]'::jsonb),\n",
    "    'sem_correspondencia', COALESCE((SELECT jsonb_agg(jsonb_build_object('cor_nome', s.cor_nome, 'apelido_nome', s.apelido_nome,\n",
    "                                                                        'total', s.total) ORDER BY s.ordem)\n",
    "                                     FROM (SELECT c.ordem, c.cor_nome, c.apelido_nome, sum(c.total) AS total\n",
    "                                             FROM cel_ok c WHERE c.variante_numero IS NULL\n",
    "                                            GROUP BY c.ordem, c.cor_nome, c.apelido_nome) s), '[]'::jsonb)\n",
    "  ) INTO v_plano;\n",
    "\n",
    "  IF jsonb_array_length(v_plano -> 'variantes') = 0 THEN\n",
    "    RETURN v_base || jsonb_build_object('plano', NULL, 'motivo_sem_plano', 'sem_distribuicao');\n",
    "  END IF;\n",
    "  RETURN v_base || jsonb_build_object('plano', v_plano, 'motivo_sem_plano', NULL);\n",
    "END $function$\n",
])
WRAPPER = "".join([
    "CREATE OR REPLACE FUNCTION public.direcionamento_plano_modelo(_modelo_id uuid)\n",
    " RETURNS jsonb\n",
    " LANGUAGE plpgsql\n",
    " STABLE SECURITY DEFINER\n",
    " SET search_path TO 'public'\n",
    "AS $function$\n",
    "DECLARE\n",
    "  v_tenant uuid;\n",
    "BEGIN\n",
    "  -- Distribuição por produto (20261006100000): wrapper — auth + loja ativa + módulo PCP; o _core faz o IDOR do modelo\n",
    "  -- pelo tenant do CHAMADOR (nunca por parâmetro vindo do cliente) — invariante #9.\n",
    "  IF auth.uid() IS NULL THEN\n",
    "    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501';\n",
    "  END IF;\n",
    "  v_tenant := public.get_user_tenant_id();\n",
    "  IF v_tenant = '00000000-0000-0000-0000-000000000000'::uuid THEN\n",
    "    RAISE EXCEPTION 'Loja inativa ou sem tenant' USING ERRCODE = '42501';\n",
    "  END IF;\n",
    "  IF NOT public.tenant_module_enabled('producao') THEN\n",
    "    RAISE EXCEPTION 'Módulo producao não habilitado para esta loja' USING ERRCODE = '42501';\n",
    "  END IF;\n",
    "  RETURN public._direcionamento_plano_modelo_core(_modelo_id, v_tenant);\n",
    "END $function$\n",
])
NOVAS = [("public._direcionamento_plano_modelo_core(uuid,uuid)", CORE), ("public.direcionamento_plano_modelo(uuid)", WRAPPER)]


def md5(s: str) -> str:
    return hashlib.md5(s.encode("utf-8")).hexdigest()


def pare(msg: str) -> None:
    sys.exit(f"PARE: {msg}")


def le_dump(arq: str) -> str:
    raw = (M / "antes" / f"{arq}.sql").read_text(encoding="utf-8")
    return raw[:-1] if raw.endswith("$function$\n\n") else raw  # o psql -A -t põe 1 "\n" depois do valor


md5_vivo = (M / "md5-redef-antes.txt").read_text(encoding="utf-8").strip().split("|")
if len(md5_vivo) != len(REDEF):
    pare("md5-redef-antes.txt tem de ter 5 md5 (salvar|gravar_bom|snapshot|modulo|arvore) — refazer o dump_antes.sh")
antes, depois = {}, {}
for (arq, _fn, _acl), mv in zip(REDEF, md5_vivo):
    a = le_dump(arq)
    if md5(a) != mv:
        pare(f"{arq}: o dump não reproduz o md5 VIVO ({md5(a)} ≠ {mv}) — refazer o dump_antes.sh")
    if not a.endswith("$function$\n"):
        pare(f"{arq}: o texto vivo não termina em $function$ + quebra de linha")
    d = a
    for velho, novo in TROCAS[arq]:
        if d.count(velho) != 1:
            pare(f"{arq}: âncora achada {d.count(velho)}× (esperado 1): {velho.strip()[:80]}")
        d = d.replace(velho, novo)
    antes[arq], depois[arq] = a, d
for fn, txt in NOVAS:
    if not txt.endswith("END $function$\n"):
        pare(f"{fn}: texto novo sem 'END $function$'")
md5_antes = [md5(antes[a]) for a, _, _ in REDEF]
md5_depois = [md5(depois[a]) for a, _, _ in REDEF]
md5_novas = [md5(t) for _, t in NOVAS]

TRAVAS = "BEGIN;\nSET LOCAL lock_timeout = '500ms';\nSET LOCAL transaction_timeout = '3s';\n"


def sem_nl(t: str) -> str:
    return t[:-1] if t.endswith("\n") else t


def guarda_redef(sentido: str) -> str:
    out = []
    for (arq, fn, _acl), ma, md in zip(REDEF, md5_antes, md5_depois):
        nome = fn.split("(")[0].replace("public.", "")
        out += [
            f"  IF to_regprocedure('{fn}') IS NULL THEN\n",
            f"    RAISE EXCEPTION 'distribuicao_produto{sentido}: {nome} não existe neste banco' USING ERRCODE = 'P0001';\n",
            "  END IF;\n",
            f"  v_md5 := md5(pg_get_functiondef('{fn}'::regprocedure));\n",
            f"  IF v_md5 NOT IN ('{ma}', '{md}') THEN\n",
            f"    RAISE EXCEPTION 'distribuicao_produto{sentido}: {nome} mudou desde o planejamento (md5 %) — outra frente mexeu; refazer dump + gerar', v_md5 USING ERRCODE = 'P0001';\n",
            "  END IF;\n",
        ]
    return "".join(out)


def guarda_novas() -> str:
    out = []
    for (fn, _t), mn in zip(NOVAS, md5_novas):
        nome = fn.split("(")[0].replace("public.", "")
        out += [
            f"  IF to_regprocedure('{fn}') IS NOT NULL\n",
            f"     AND md5(pg_get_functiondef('{fn}'::regprocedure)) <> '{mn}' THEN -- nova\n",
            f"    RAISE EXCEPTION 'distribuicao_produto: {nome} já existe com OUTRO texto — PARE' USING ERRCODE = 'P0001';\n",
            "  END IF;\n",
        ]
    return "".join(out)


def revoke(sig: str) -> str:
    return f"REVOKE EXECUTE ON FUNCTION {sig} FROM PUBLIC, anon, authenticated;\n"


CABEC = (
    "-- Distribuição por produto — ADITIVA (spec docs/superpowers/specs/2026-09-25-distribuicao-por-produto-design.md §5.1;\n"
    "-- plano docs/superpowers/plans/2026-09-25-distribuicao-por-produto.md, Task 4). GERADA por\n"
    "-- .superpowers/distribuicao/mig/gerar_sql.py a partir do texto VIVO — NÃO editar à mão.\n"
    "-- • plan_tecido_variantes: distribuicao (Tecido 1: {loja_id: {base, grades, manuais}}) e atende (demais blocos: chaves\n"
    "--   de cor do Tecido 1; NULL = automático pela cor base) + 2 CHECKs de forma.\n"
    "-- • 5 funções redefinidas por âncoras exatas (guarda md5 EXATA): salvar/árvore/blindagem do Plan. Tecido levam as 2\n"
    "--   colunas; o gravar do BOM grava o casamento (complementa_variante_ids) e PRESERVA o que já havia quando o payload\n"
    "--   não traz a chave; tenant_module_enabled passa a tratar 'distribuicao' como opt-in (ACL da função intocada).\n"
    "-- • RPC nova direcionamento_plano_modelo (+ _core revogado dos 3): o plano SALVO por modelo p/ o Direcionamento.\n"
    "-- • Contagem: +2 funções, +0 gatilhos. Nenhuma DDL de policy; nada em tenant_config. A árvore (LANGUAGE sql, valida\n"
    "--   as colunas no CREATE) vem DEPOIS da coluna nova, no fim — a trava em plan_tecido_variantes dura ms.\n"
    "-- Aplicar SÓ pelo aplica_v2 dos scripts (pré-voo + backup). Inverso: supabase/rollback/" + NOME + "_down.sql.\n\n"
)
mig = [CABEC, TRAVAS, "\n",
       "DO $guarda$\nDECLARE\n  v_md5 text;\nBEGIN\n", guarda_redef(""), guarda_novas(), "END $guarda$;\n\n"]
for arq, _fn, _acl in REDEF[:4]:
    mig.append(sem_nl(depois[arq]) + ";\n\n")
for _fn, txt in NOVAS:
    mig.append(sem_nl(txt) + ";\n\n")
mig += [
    "-- ACL (invariante #9): internas fechadas p/ PUBLIC/anon/authenticated; o wrapper só p/ authenticated.\n",
    revoke("public._salvar_plan_tecido_core(uuid, jsonb, integer)"),
    revoke("public._plan_tecido_gravar_bom_core(uuid, jsonb)"),
    revoke("public._plan_tecido_snapshot(uuid)"),
    revoke("public._direcionamento_plano_modelo_core(uuid, uuid)"),
    "REVOKE ALL ON FUNCTION public.direcionamento_plano_modelo(uuid) FROM PUBLIC, anon;\n",
    "GRANT EXECUTE ON FUNCTION public.direcionamento_plano_modelo(uuid) TO authenticated;\n",
    "COMMENT ON FUNCTION public.direcionamento_plano_modelo(uuid) IS 'Distribuição por produto: plano SALVO do Plan. Tecido (loja × variante_numero × tamanho) + nº de modelos direcionados da subcoleção, p/ o Direcionamento. Só leitura; não é gate (invariante #10).';\n\n",
    "ALTER TABLE public.plan_tecido_variantes\n",
    "  ADD COLUMN IF NOT EXISTS distribuicao jsonb NOT NULL DEFAULT '{}'::jsonb,\n",
    "  ADD COLUMN IF NOT EXISTS atende jsonb;\n",
    "DO $ck$\nBEGIN\n",
    "  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.plan_tecido_variantes'::regclass\n",
    "                   AND conname = 'plan_tecido_variantes_distribuicao_objeto') THEN\n",
    "    ALTER TABLE public.plan_tecido_variantes ADD CONSTRAINT plan_tecido_variantes_distribuicao_objeto\n",
    "      CHECK (jsonb_typeof(distribuicao) = 'object');\n",
    "  END IF;\n",
    "  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.plan_tecido_variantes'::regclass\n",
    "                   AND conname = 'plan_tecido_variantes_atende_array') THEN\n",
    "    ALTER TABLE public.plan_tecido_variantes ADD CONSTRAINT plan_tecido_variantes_atende_array\n",
    "      CHECK (atende IS NULL OR jsonb_typeof(atende) = 'array');\n",
    "  END IF;\n",
    "END $ck$;\n",
    "COMMENT ON COLUMN public.plan_tecido_variantes.distribuicao IS 'Distribuição por produto (SÓ Tecido 1): {loja_id: {base, grades {tamanho: q}, manuais [tamanho]}}. grades = células resolvidas (a Σ vira o pç).';\n",
    "COMMENT ON COLUMN public.plan_tecido_variantes.atende IS '\"Atende a\" (fora do Tecido 1): NULL = automático pela cor base; array de chaves de cor do Tecido 1 (variante_tecido_id ou plan:cor|apelido) = escolhido à mão. Vira complementa_variante_ids no BOM.';\n\n",
    "-- A árvore é LANGUAGE sql (valida as colunas no CREATE) — por isso só agora.\n",
    sem_nl(depois["arvore"]) + ";\n",
    revoke("public._plan_tecido_arvore_core(uuid)"),
    "\nCOMMIT;\n",
]
inv = [
    "-- INVERSO da Distribuição por produto (aditiva 20261006100000) — GERADO por gerar_sql.py (NÃO editar à mão).\n"
    "-- DESTRUTIVO: o DROP COLUMN apaga a distribuição e o \"atende a\" digitados (o script da volta EXPORTA antes).\n"
    "-- LIFO (R37): a remoção da Distribuição antiga (20261006110000) precisa ter voltado ANTES (o front revertido usa a\n"
    "-- tabela e as RPCs antigas). Exige SET LOCAL app.confirmo_apagar_distribuicao_por_produto = 'sim'.\n\n",
    TRAVAS, "\n",
    "DO $guarda$\nDECLARE\n  v_md5 text;\nBEGIN\n",
    "  IF coalesce(current_setting('app.confirmo_apagar_distribuicao_por_produto', true), '') <> 'sim' THEN\n",
    "    RAISE EXCEPTION 'distribuicao_produto (volta): o DROP COLUMN apaga a distribuição e o atende a digitados — rode com SET LOCAL app.confirmo_apagar_distribuicao_por_produto = ''sim'' (o script da volta exporta antes)' USING ERRCODE = 'P0001';\n",
    "  END IF;\n",
    "  IF to_regclass('public.distribuicao_tabelas') IS NULL THEN\n",
    "    RAISE EXCEPTION 'distribuicao_produto (volta): a Distribuição antiga foi removida — volte PRIMEIRO a remoção (20261006110000) — LIFO' USING ERRCODE = 'P0001';\n",
    "  END IF;\n",
    guarda_redef(" (volta)"),
    "END $guarda$;\n\n",
    "-- a árvore volta PRIMEIRO (deixa de ler as colunas que vão sair)\n",
    sem_nl(antes["arvore"]) + ";\n\n",
]
for arq, _fn, _acl in REDEF[:4]:
    inv.append(sem_nl(antes[arq]) + ";\n\n")
inv += [
    "DROP FUNCTION IF EXISTS public.direcionamento_plano_modelo(uuid);\n",
    "DROP FUNCTION IF EXISTS public._direcionamento_plano_modelo_core(uuid, uuid);\n",
    revoke("public._salvar_plan_tecido_core(uuid, jsonb, integer)"),
    revoke("public._plan_tecido_gravar_bom_core(uuid, jsonb)"),
    revoke("public._plan_tecido_snapshot(uuid)"),
    revoke("public._plan_tecido_arvore_core(uuid)"),
    "\n",
    "ALTER TABLE public.plan_tecido_variantes\n",
    "  DROP CONSTRAINT IF EXISTS plan_tecido_variantes_atende_array,\n",
    "  DROP CONSTRAINT IF EXISTS plan_tecido_variantes_distribuicao_objeto,\n",
    "  DROP COLUMN IF EXISTS atende,\n",
    "  DROP COLUMN IF EXISTS distribuicao;\n",
    "\nCOMMIT;\n",
]
MIG.write_text("".join(mig), encoding="utf-8")
INV.write_text("".join(inv), encoding="utf-8")
(M / "md5-redef-depois.txt").write_text("|".join(md5_depois) + "\n", encoding="utf-8")
(M / "md5-novas-depois.txt").write_text("|".join(md5_novas) + "\n", encoding="utf-8")
print(f"OK: {MIG.name} + {INV.name} gerados · redef {'|'.join(m[:8] for m in md5_antes)} → {'|'.join(m[:8] for m in md5_depois)} · novas {'|'.join(m[:8] for m in md5_novas)}")
```

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/distribuicao-produto"
python3 .superpowers/distribuicao/mig/gerar_sql.py
grep -c 'ALTER TABLE public.plan_tecido_variantes' supabase/migrations/20261006100000_distribuicao_por_produto.sql supabase/rollback/20261006100000_distribuicao_por_produto_down.sql
```

Expected: `OK: … gerados · redef ddadff5e|3cc5d45c|c9492de3|0b87d95b|d8685568 → <5 novos> · novas <2>`; `ALTER TABLE public.plan_tecido_variantes` 3× na migration (o ALTER das colunas + 2 dentro do `DO $ck$`) e 1× no inverso.

- [ ] **Step 5: N3 + rodar a suíte nos 2 modos**

Com o OK do dono (o controlador avisa):

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/distribuicao-produto"
DIST_DONO_AVISADO=sim bash .superpowers/distribuicao/n3.sh antes t4s5
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres DIST_MIG_TXN=1 npx vitest run --no-file-parallelism tests/integration/distribuicao-produto.test.ts 2>&1 | tail -20
bash .superpowers/distribuicao/n3.sh depois t4s5
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres npx vitest run --no-file-parallelism tests/integration/distribuicao-produto.test.ts 2>&1 | tail -8
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres npx vitest run --no-file-parallelism tests/integration/plan-tecido.test.ts tests/integration/plan-tecido-aplicar.test.ts tests/integration/casar-variantes-reserva.test.ts tests/integration/direcionamento-multilojas.test.ts 2>&1 | tail -8
```

Expected: modo `DIST_MIG_TXN=1` → **14 passed** (5 estáticos + 9 de banco). `n3.sh depois` mostra `…|A=f|antiga=t` (nada vazou). Modo sem a variável (cópia SEM a migration) → 5 passed, 9 skipped. (Com a migration JÁ aplicada — ensaio/cópia — também 14 passed: os 2 testes só-txn saem cedo.) Vizinhas: as mesmas falhas herdadas da linha de base (nenhuma nova). Falhas previsíveis e o que fazer:
- "texto canônico do PG" ≠ `corpo(MIG,…)+"\n"` numa das 2 novas ⇒ o template `CORE`/`WRAPPER` do gerador não bate com o formato do `pg_get_functiondef`: copiar a forma impressa na mensagem do vitest para o template, regerar (Step 4) e repetir — registrar em `desvios.md`. Nunca "consertar" o teste.
- Erro de sintaxe/nome no SQL novo ⇒ corrigir o MÍNIMO no gerador, regerar, registrar em `desvios.md`. Diferença de REGRA (números do teste) ⇒ PARE.
- Qualquer resíduo (`n3.sh depois` com `A=t`) ⇒ PARE e avise o controlador (algo vazou da txn).

- [ ] **Step 6: Gates e commit**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/distribuicao-produto"
bash .superpowers/distribuicao/gates.sh
git add -- supabase/migrations/20261006100000_distribuicao_por_produto.sql supabase/rollback/20261006100000_distribuicao_por_produto_down.sql tests/integration/distribuicao-produto.test.ts
git commit --only -m "feat(distribuicao): migration 20261006100000 — distribuição e 'atende a' no plano, casamento no BOM, RPC do plano p/ o Direcionamento (T4)" \
  -m "GERADA do texto vivo (gerar_sql.py) com guarda md5 exata das 5 redefinidas + 2 novas; travas 500ms/3s; +2 funções/+0 gatilhos; tenant_module_enabled com 'distribuicao' opt-in (ACL intocada); inverso com confirmação e LIFO. Suíte só na cópia. Plano 2026-09-25, Task 4." \
  -m "Co-Authored-By: Claude <seu modelo real> <noreply@anthropic.com>" \
  -- supabase/migrations/20261006100000_distribuicao_por_produto.sql supabase/rollback/20261006100000_distribuicao_por_produto_down.sql tests/integration/distribuicao-produto.test.ts
git show --stat HEAD
```

- [ ] **Step 7: G-migration A — 2 revisões Opus INDEPENDENTES + guardião**

O controlador despacha 2 revisores Opus em paralelo, cada um SEM ver o parecer do outro, com: o plano, a spec, os 2 SQL, o `gerar_sql.py`, o `dump_antes.sh`, a suíte e os logs do Step 5. **Checklist:** (1) cada redefinida = texto vivo com SÓ as trocas (âncoras 1×) e o inverso = o vivo; (2) guarda md5 exata nos 2 arquivos (antes/depois) + novas (ausente ou = texto novo) e a recusa provada ("outra frente"); (3) travas no arquivo; zero DDL de policy; nada em `tenant_config`; nada de `_replicar_cards_plan_tecido_core`; (4) `ALTER` no fim e a árvore (`sql`) depois dele; `ADD COLUMN IF NOT EXISTS` + CHECKs idempotentes; (5) ACL #9: 5 internas fechadas (`has_function_privilege`), wrapper só `authenticated`, `tenant_module_enabled` INTOCADA (policies); (6) regra do salvar (T1/fora do T1/forma/DEDUP) e do gravar do BOM (filtro às ids reais do T1 do payload; T1 NULL; chave ausente preserva; `[]` limpa) — e a reserva (#4) só muda de quem preenche; (7) RPC: IDOR pelo tenant do chamador, módulo `producao` no wrapper e `distribuicao` no plano, tradução pelo T1 do BOM, cor sem correspondência, lojas só do tenant, grade saneada, "direcionados" = conta antiga; STABLE e sem escrita; (8) inverso: confirmação, LIFO (exige a tabela antiga), árvore antes, DROP COLUMN por último, idempotência; (9) +2|+0. Depois, o guardião `guardiao-unificacao` (G-migration A) com os 2 pareceres. BLOQUEIA ⇒ corrigir no GERADOR, regerar, repetir Steps 5–6 e as revisões.

---
## Task 5: Card do Plan. Tecido — pç só leitura, "atende a", normalização no funil, casamento no aplicar, presença  *(individual Opus)*

**Files:**
- Modify: `src/lib/colab/colab-field-path.ts` (`pathDoElemento`)
- Create: `src/components/plan-tecido/AtendeAPopover.tsx`
- Modify: `src/components/plan-tecido/MaterialBlock.tsx`
- Modify: `src/components/plan-tecido/ModelCard.tsx`
- Modify: `src/components/plan-tecido/PlanTecidoSheet.tsx`
- Test: `tests/unit/colab-field-path-explicito.test.ts`, `tests/unit/plan-tecido-distribuicao-fonte.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3 (`temDistribuicao`, `atendimentoDoBloco`, `alternarAtende`, `normalizarArvoreDistribuicao`, `materiaisParaAplicar`, `ehTecido1`, `OpcoesDist`); `PresencaColab` (`@/hooks/useColabRegistro`); `useTenantModules().isModuleEnabled/isLoading`.
- Produces (Task 6): `MaterialBlock` props `dist?: { ligado: boolean; t1?: PtVariante[] }` e `acaoExtra?: ReactNode`; `ModelCard` props `distribuicaoLigada?: boolean`, `presentesColab?: PresencaColab[]`, `onFocoDistribuicao?: (path: string | null) => void`; `AtendeAPopover` + `pathAtende(materialKey, corKey)`; no `PlanTecidoSheet`, `campoFocado = campoFocadoColab ?? focoDistribuicao`.

- [ ] **Step 1: Testes (falham)**

`tests/unit/colab-field-path-explicito.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { pathDoElemento } from "@/lib/colab/colab-field-path";

// Vitest roda sem DOM: elemento-stub só com o que pathDoElemento lê.
const stub = (attrs: Record<string, string>, ehCampo: boolean) =>
  ({ getAttribute: (k: string) => attrs[k] ?? null, matches: () => ehCampo, parentElement: null, ownerDocument: null }) as unknown as HTMLElement;
const scope = { querySelectorAll: () => [] } as unknown as HTMLElement;

describe("colab-field-path — data-colab-path explícito vale em QUALQUER elemento (Distribuição R20)", () => {
  it("botão/checkbox com data-colab-path participa (ex.: 'atende a')", () => {
    expect(pathDoElemento(stub({ "data-colab-path": "pt-atende:m1:v1" }, false), scope)).toBe("pt-atende:m1:v1");
  });
  it("botão SEM data-colab-path continua fora", () => {
    expect(pathDoElemento(stub({}, false), scope)).toBeNull();
  });
  it("campo de texto segue a regra de sempre (data-colab-path > name > id)", () => {
    expect(pathDoElemento(stub({ "data-colab-path": "x", name: "n" }, true), scope)).toBe("x");
    expect(pathDoElemento(stub({ name: "n" }, true), scope)).toBe("name:n");
  });
});
```

`tests/unit/plan-tecido-distribuicao-fonte.test.ts` (testes de FONTE — Vitest sem DOM; a Task 6 acrescenta o 2º `describe`):

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const ler = (r: string) => readFileSync(ROOT + r, "utf8");
const conta = (t: string, s: string) => t.split(s).length - 1;

describe("Plan. Tecido — card com a Distribuição por produto (Task 5)", () => {
  const sheet = ler("src/components/plan-tecido/PlanTecidoSheet.tsx");
  const bloco = ler("src/components/plan-tecido/MaterialBlock.tsx");
  const card = ler("src/components/plan-tecido/ModelCard.tsx");
  const pop = ler("src/components/plan-tecido/AtendeAPopover.tsx");
  it("gate do módulo e normalização no carregamento E no funil `patch` (R4/R6)", () => {
    expect(sheet).toContain('isModuleEnabled("distribuicao")');
    expect(sheet).toMatch(/return normalizarArvoreDistribuicao\(limparSlotsOrfaos\(/);
    expect(sheet).toMatch(/const patch = \(next0: PtArvore\) => \{\n\s+const next = normalizarArvoreDistribuicao\(next0, distOpts\);/);
    expect(sheet).toContain("if (!tamanhosProntos || modulosCarregando) return;");
  });
  it("payload do aplicar/criar card com casamento só com o módulo (R3/R4); nada de buildMateriaisAplicar cru", () => {
    expect(conta(sheet, "materiaisParaAplicar(slot, distribOn)")).toBe(2);
    expect(sheet).not.toMatch(/buildMateriaisAplicar\(slot\)/);
    expect(card).toContain("materiaisParaAplicar(slot, !!distribuicaoLigada)");
  });
  it("a query dos modelos traz cor, casamento e 'Tamanho em' (R17)", () => {
    expect(sheet).toContain("modelo_tecido_variantes(variante_tecido_id, ordem, multiplicador, complementa_variante_ids, variante:variante_tecido_id(artigo_id, cor_id, ");
    expect(sheet).toContain("proporcoes, tamanho_tipo, lancado");
  });
  it("presença: o marcador do dialog entra no campoFocado do canal do Plan. Tecido (R19)", () => {
    expect(sheet).toContain("campoFocado: campoFocadoColab ?? focoDistribuicao,");
    expect(sheet).toContain("presentesColab={presentes}");
    expect(sheet).toContain("onFocoDistribuicao={setFocoDistribuicao}");
  });
  it("pç só leitura + selo 'distribuído' (T1) e 'atende a' (demais blocos) com textos do mockup", () => {
    expect(bloco).toContain("Só leitura — muda pelo Distribuir por loja");
    expect(bloco).toContain("Soma das cores do Tecido 1 que ele atende");
    expect(bloco).toContain(">distribuído</StatusBadge>");
    expect(bloco).toContain("Não atende nenhuma cor do Tecido 1");
    expect(bloco).toContain("Sem cor deste {rotulo}:");
    expect(bloco).toContain("{acaoExtra}");
  });
  it("'atende a' tem data-colab-path no gatilho E nas opções (R20)", () => {
    expect(conta(pop, "data-colab-path={path}")).toBe(2);
    expect(pop).toContain("Atende a · cores do Tecido 1");
    expect(pop).toContain("já atendida por: ");
    expect(pop).toContain("mesma cor base (automático)");
    expect(pop).toContain("escolhida à mão");
    expect(pop).toContain("padrão (mesma cor base)");
  });
});
```

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/distribuicao-produto"
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres npx vitest run tests/unit/colab-field-path-explicito.test.ts tests/unit/plan-tecido-distribuicao-fonte.test.ts 2>&1 | tail -8
```

Expected: FAIL (o botão com `data-colab-path` dá `null`; `AtendeAPopover.tsx` não existe).

- [ ] **Step 2: `src/lib/colab/colab-field-path.ts` — `pathDoElemento`**

Trocar o início do corpo

```ts
export function pathDoElemento(el: HTMLElement, scope: HTMLElement): string | null {
  if (!ehCampoColab(el)) return null;

  const explicit = el.getAttribute("data-colab-path");
  if (explicit) return explicit;
```

por

```ts
export function pathDoElemento(el: HTMLElement, scope: HTMLElement): string | null {
  // Marcação EXPLÍCITA vale para QUALQUER elemento — inclusive botão/checkbox (ex.: o "atende a" do Plan. Tecido,
  // Distribuição por produto R20). Sem marcação, só campo de texto participa (regra de sempre).
  const explicit = el?.getAttribute?.("data-colab-path");
  if (explicit) return explicit;
  if (!ehCampoColab(el)) return null;
```

- [ ] **Step 3: `src/components/plan-tecido/AtendeAPopover.tsx` (novo)**

```tsx
// "Atende a" (Distribuição por produto, spec R14–R16/R20): cada cor de forro/Tecido 2… diz a quais cores do Tecido 1 ela
// serve. Padrão = a mesma cor base (automático); marcar/desmarcar vira lista à mão; "↺ padrão" volta ao automático. O pç
// da cor é a soma das cores atendidas — quem deriva é a normalização do slot (PlanTecidoSheet); aqui só muda a amarração.
import { ChevronDown, RotateCcw } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { VarianteSwatch } from "@/components/shared/VarianteSwatch";
import { fmtMetros, varKey } from "@/lib/plan-tecido/calc";
import { alternarAtende, type Atendimento } from "@/lib/plan-tecido/atendimento";
import type { PtVariante } from "@/lib/plan-tecido/types";

/** Path de presença do "atende a" (gatilho e opções — o anel dos outros cai no gatilho; as opções são portal). */
export const pathAtende = (materialKey: string, corKey: string): string => `pt-atende:${materialKey}:${corKey}`;

export function AtendeAPopover({ materialKey, cor, bloco, t1, at, consumo, rotulo, nomeCor, readOnly, onChange }: {
  materialKey: string;
  cor: PtVariante;
  bloco: PtVariante[];
  t1: PtVariante[];
  at: Atendimento;
  consumo: number;
  rotulo: "forro" | "tecido";
  nomeCor: (v: PtVariante) => string;
  readOnly: boolean;
  onChange: (atende: string[] | null) => void;
}) {
  const kb = varKey(cor);
  const servidas = at.porCor.get(kb) ?? [];
  const path = pathAtende(materialKey, kb);
  const t1Por = new Map(t1.map((v) => [varKey(v), v] as const));
  const parcelas = servidas.map((k) => Number(t1Por.get(k)?.grade_total) || 0);
  const total = parcelas.reduce((s, n) => s + n, 0);
  const nomeDono = (kt: string) => {
    const d = bloco.find((b) => varKey(b) === at.servidaPor.get(kt));
    return d ? nomeCor(d) : "—";
  };
  const resumo = servidas.map((k) => (t1Por.get(k) ? nomeCor(t1Por.get(k)!) : "")).filter(Boolean).join(", ");
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-colab-path={path}
          aria-label={`Atende a: ${resumo || "nenhuma cor do Tecido 1"}`}
          className="flex h-6 shrink-0 items-center gap-0.5 rounded border bg-background px-1 text-[10px] text-muted-foreground hover:bg-muted"
        >
          atende a
          {servidas.slice(0, 3).map((k) => {
            const v = t1Por.get(k);
            return <VarianteSwatch key={k} nome={v?.cor_nome ?? v?.label ?? undefined} />;
          })}
          {servidas.length > 3 && <span>+{servidas.length - 3}</span>}
          <ChevronDown className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-2 text-xs">
        <p className="mb-1 font-semibold">Atende a · cores do Tecido 1</p>
        <div className="space-y-0.5">
          {t1.map((v) => {
            const kt = varKey(v);
            const dono = at.servidaPor.get(kt);
            const minha = dono === kb;
            const deOutra = !!dono && !minha;
            const padrao = !!v.cor_id && v.cor_id === cor.cor_id;
            return (
              <label key={kt} className={`flex items-center gap-2 rounded px-1 py-1 ${deOutra ? "opacity-55" : "hover:bg-muted"}`}>
                <Checkbox
                  checked={minha}
                  disabled={readOnly || deOutra}
                  data-colab-path={path}
                  aria-label={nomeCor(v)}
                  onCheckedChange={() => onChange(alternarAtende(at, kb, kt))}
                />
                <VarianteSwatch nome={v.cor_nome ?? v.label ?? undefined} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1 truncate">
                    {nomeCor(v)}
                    {padrao && <StatusBadge tone="neutral" className="px-1 py-0 normal-case tracking-normal">padrão</StatusBadge>}
                  </span>
                  <span className="block text-[10px] text-muted-foreground">
                    {deOutra ? `já atendida por: ${nomeDono(kt)}` : padrao ? "mesma cor base (automático)" : minha ? "escolhida à mão" : ""}
                  </span>
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{Number(v.grade_total) || 0} pç</span>
              </label>
            );
          })}
        </div>
        <div className="mt-1 flex justify-between border-t pt-1 font-medium">
          <span>pç deste {rotulo}</span>
          <span className="tabular-nums">{parcelas.length > 1 ? `${parcelas.join(" + ")} = ${total}` : total}</span>
        </div>
        <p className="mt-1 text-[10px] text-muted-foreground">
          Padrão: a mesma cor base. Mudar aqui só troca a amarração — a metragem segue o consumo do {rotulo} ({fmtMetros(consumo)} m/pç).
        </p>
        {at.manual.has(kb) && !readOnly && (
          <Button variant="ghost" size="sm" className="mt-1 h-7 gap-1 text-[11px]" onClick={() => onChange(null)}>
            <RotateCcw className="h-3 w-3" />padrão (mesma cor base)
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 4: `src/components/plan-tecido/MaterialBlock.tsx` (trocas pontuais)**

(a) Imports — trocar `import { useEffect, useMemo, useState } from "react";` por `import { useEffect, useMemo, useState, type ReactNode } from "react";`; trocar `import { X, Plus, AlertTriangle } from "lucide-react";` por `import { X, Plus, AlertTriangle, Lock } from "lucide-react";`; acrescentar depois do import de `VarianteSwatch`:

```ts
import { StatusBadge } from "@/components/shared/StatusBadge";
import { AtendeAPopover } from "./AtendeAPopover";
import { atendimentoDoBloco } from "@/lib/plan-tecido/atendimento";
import { temDistribuicao } from "@/lib/distribuicao-produto";
```

(b) Assinatura — trocar

```ts
export function MaterialBlock({ material, onChange, onRemove, laneCategoriaId, readOnly = false, variantesGrupo }: { material: PtMaterial; onChange: (m: PtMaterial) => void; onRemove: () => void; laneCategoriaId?: string | null; paleta?: { artigo_id: string; papel: string }[]; readOnly?: boolean; variantesGrupo?: PtVariante[] }) {
```

por

```ts
export function MaterialBlock({ material, onChange, onRemove, laneCategoriaId, readOnly = false, variantesGrupo, dist, acaoExtra }: { material: PtMaterial; onChange: (m: PtMaterial) => void; onRemove: () => void; laneCategoriaId?: string | null; paleta?: { artigo_id: string; papel: string }[]; readOnly?: boolean; variantesGrupo?: PtVariante[];
  /** Distribuição por produto (só com o módulo): `t1` = cores do Tecido 1 do card (p/ o "atende a" dos demais blocos). */
  dist?: { ligado: boolean; t1?: PtVariante[] };
  /** Ação extra na linha de ações (o "Distribuir por loja" do Tecido 1) — aparece também com o bloco travado. */
  acaoExtra?: ReactNode }) {
```

(c) Logo depois de `const rotulo = material.tipo === "forro" ? "forro" : "tecido";`, acrescentar:

```ts
  // Distribuição por produto (spec R4/R14): só com o módulo. Tecido 1 = pç só leitura quando distribuído; demais blocos
  // (forro/Tecido 2…) = "atende a", com o pç = soma das cores atendidas (derivado pela normalização do PlanTecidoSheet).
  const ehT1 = material.tipo === "tecido" && Number(material.numero) === 1;
  const distLigado = !!dist?.ligado;
  const atendimento = useMemo(
    () => (distLigado && !ehT1 && dist?.t1 ? atendimentoDoBloco(dist.t1, material.variantes) : null),
    [distLigado, ehT1, dist?.t1, material.variantes],
  );
  const materialKey = material.id ?? `${material.tipo}#${material.numero}`;
  const setAtende = (v: PtVariante, atende: string[] | null) =>
    onChange({ ...material, variantes: material.variantes.map((x) => (varKey(x) === varKey(v) ? { ...x, atende } : x)) });
  // "Marrom · Canela" (cor planejada guarda "Cor - Apelido" no label) — p/ o "atende a" e os avisos.
  const nomeCorCurto = (v: PtVariante): string => {
    const cor = v.cor_nome || v.label || "—";
    const ap = v.label && v.cor_nome && v.label.startsWith(`${v.cor_nome} - `) ? v.label.slice(v.cor_nome.length + 3) : null;
    return ap ? `${cor} · ${ap}` : cor;
  };
```

(d) Na linha da variante, trocar o `NumberInput` do pç

```tsx
                <NumberInput disabled={readOnly} integer blankZero placeholder="0" className="h-7 w-12 shrink-0 text-right" value={fantasma ? 0 : (v.grade_total ?? 0)} data-colab-path={fantasma ? undefined : `pt-grade:${material.id ?? `${material.tipo}#${material.numero}`}:${varKey(v)}`} onChange={(e) => fantasma ? promoverFantasma(v, Number(e.target.value) || 0) : setGrade(v, Number(e.target.value) || 0)} />
```

por

```tsx
                {(() => {
                  // Distribuição por produto: cor do T1 distribuída OU cor de bloco amarrada = pç SÓ LEITURA (derivado).
                  // Tudo na MESMA linha e sem aumentar a altura (Modo Plano alinha pela altura da linha — estudo R9).
                  const distribuida = !fantasma && distLigado && ehT1 && temDistribuicao(v.distribuicao);
                  const servidas = !fantasma && atendimento ? (atendimento.porCor.get(varKey(v)) ?? []) : [];
                  return (
                    <>
                      {distribuida && (
                        <StatusBadge tone="info" className="shrink-0 px-1 py-0 normal-case tracking-normal" title="Quantidade vinda do Distribuir por loja">distribuído</StatusBadge>
                      )}
                      {!fantasma && atendimento && dist?.t1 && (
                        <AtendeAPopover materialKey={materialKey} cor={v} bloco={material.variantes} t1={dist.t1} at={atendimento}
                          consumo={material.consumo} rotulo={rotulo} nomeCor={nomeCorCurto} readOnly={readOnly}
                          onChange={(a) => setAtende(v, a)} />
                      )}
                      {!fantasma && atendimento && servidas.length === 0 && (
                        <span className="shrink-0 text-amber-600" title="Não atende nenhuma cor do Tecido 1" aria-label="Não atende nenhuma cor do Tecido 1">
                          <AlertTriangle className="h-3 w-3" />
                        </span>
                      )}
                      {distribuida || servidas.length > 0 ? (
                        <span className="flex h-7 w-12 shrink-0 items-center justify-end gap-0.5 tabular-nums"
                          title={distribuida ? "Só leitura — muda pelo Distribuir por loja" : "Soma das cores do Tecido 1 que ele atende"}>
                          <Lock className="h-3 w-3 text-muted-foreground" />{v.grade_total ?? 0}
                        </span>
                      ) : (
                        <NumberInput disabled={readOnly} integer blankZero placeholder="0" className="h-7 w-12 shrink-0 text-right" value={fantasma ? 0 : (v.grade_total ?? 0)} data-colab-path={fantasma ? undefined : `pt-grade:${material.id ?? `${material.tipo}#${material.numero}`}:${varKey(v)}`} onChange={(e) => fantasma ? promoverFantasma(v, Number(e.target.value) || 0) : setGrade(v, Number(e.target.value) || 0)} />
                      )}
                    </>
                  );
                })()}
```

(e) Logo ANTES do comentário `{/* ações — escondidas quando travado (enviado à Explosão) */}`, acrescentar:

```tsx
        {/* Distribuição por produto (R14): cor do Tecido 1 sem nenhuma cor deste bloco → aviso âmbar (fica fora do "a comprar"). */}
        {atendimento && dist?.t1 && material.variantes.length > 0 && (() => {
          const livres = dist.t1.filter((t) => !atendimento.servidaPor.has(varKey(t)));
          return livres.length > 0 ? (
            <p className="mt-1 text-[10px] font-medium text-amber-700">Sem cor deste {rotulo}: {livres.map(nomeCorCurto).join(", ")}</p>
          ) : null;
        })()}
```

(f) Trocar o bloco de ações

```tsx
        {!readOnly && (
          <div className="mt-1.5 flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-7 gap-1 text-[11px]" onClick={() => setMenuOpen((o) => !o)}><Plus className="h-3 w-3" />adicionar cor</Button>
            {temDivergentes && (
              <Button variant="ghost" size="sm" className="h-7 gap-1 text-[11px] text-red-600 hover:text-red-700" onClick={removerDivergentes}><AlertTriangle className="h-3 w-3" />remover divergentes</Button>
            )}
          </div>
        )}
```

por

```tsx
        {(!readOnly || acaoExtra) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {!readOnly && (
              <Button variant="outline" size="sm" className="h-7 gap-1 text-[11px]" onClick={() => setMenuOpen((o) => !o)}><Plus className="h-3 w-3" />adicionar cor</Button>
            )}
            {/* Distribuição por produto: "Distribuir por loja" (só Tecido 1) — também travado (abre só leitura, P-22). */}
            {acaoExtra}
            {!readOnly && temDivergentes && (
              <Button variant="ghost" size="sm" className="h-7 gap-1 text-[11px] text-red-600 hover:text-red-700" onClick={removerDivergentes}><AlertTriangle className="h-3 w-3" />remover divergentes</Button>
            )}
          </div>
        )}
```

- [ ] **Step 5: `src/components/plan-tecido/ModelCard.tsx` (trocas pontuais)**

(a) Imports: trocar `import { necessidadePorTecido, buildMateriaisAplicar, fmtMetros } from "@/lib/plan-tecido/calc";` por `import { necessidadePorTecido, fmtMetros } from "@/lib/plan-tecido/calc";` e acrescentar:

```ts
import { ehTecido1, materiaisParaAplicar } from "@/lib/plan-tecido/atendimento";
import type { PresencaColab } from "@/hooks/useColabRegistro";
```

(b) Props: na desestruturação, depois de `onAbrirOcDialog,` acrescentar `distribuicaoLigada, presentesColab, onFocoDistribuicao,`; no tipo, depois de `onAbrirOcDialog?: (ocId: string) => void;` acrescentar:

```ts
  /** Distribuição por produto (módulo `distribuicao`): pç derivado, "atende a" e o botão "Distribuir por loja". */
  distribuicaoLigada?: boolean;
  /** Presença do canal do Plan. Tecido — o dialog mostra quem está neste produto (R19). */
  presentesColab?: PresencaColab[];
  /** Marcador de presença de página do dialog aberto (`dist:{slot}:aberto`) — o PlanTecidoSheet o usa como campoFocado. */
  onFocoDistribuicao?: (path: string | null) => void;
```

(c) Trocar `const buildMateriais = () => buildMateriaisAplicar(slot);` por:

```ts
  const buildMateriais = () => materiaisParaAplicar(slot, !!distribuicaoLigada);
```

(d) Logo depois da linha `const pieces = …` acrescentar:

```ts
  // Cores do Tecido 1 (base do "atende a" dos demais blocos — Distribuição por produto).
  const t1Variantes = slot.materiais.find(ehTecido1)?.variantes;
```

(e) No `<MaterialBlock …>` dentro de "1. Tecidos & Forros", acrescentar a prop (a Task 6 acrescenta o `acaoExtra`):

```tsx
                        dist={distribuicaoLigada ? { ligado: true, t1: t1Variantes ?? [] } : undefined}
```

- [ ] **Step 6: `src/components/plan-tecido/PlanTecidoSheet.tsx` (trocas pontuais)**

(a) Imports: trocar `import { tecidosDaArvore, slotMetros, fmtMetros, buildMateriaisAplicar } from "@/lib/plan-tecido/calc";` por `import { tecidosDaArvore, slotMetros, fmtMetros } from "@/lib/plan-tecido/calc";` e acrescentar:

```ts
import { useTenantModules } from "@/hooks/useTenantModules";
import { materiaisParaAplicar, normalizarArvoreDistribuicao, type OpcoesDist } from "@/lib/plan-tecido/atendimento";
```

(b) `computeFreshArvore` — trocar

```ts
function computeFreshArvore(seed: SeedInput, modelos: ModeloReal[], salvo: PtArvore | null, modelosDb: any[]): PtArvore {
  const validIds = new Set(modelosDb.map((m) => m.id as string));
  return limparSlotsOrfaos(mergeArvore(semearComModelos({ ...seed, modelos }), salvo), validIds);
}
```

por

```ts
function computeFreshArvore(seed: SeedInput, modelos: ModeloReal[], salvo: PtArvore | null, modelosDb: any[], dist: OpcoesDist): PtArvore {
  const validIds = new Set(modelosDb.map((m) => m.id as string));
  // Distribuição por produto (R6): o pç derivado (distribuição do T1 e forro/T2 amarrado) já nasce normalizado — a base do
  // merge colab e a árvore exibida são a MESMA coisa, então abrir não "suja" o plano.
  return normalizarArvoreDistribuicao(limparSlotsOrfaos(mergeArvore(semearComModelos({ ...seed, modelos }), salvo), validIds), dist);
}
```

e acrescentar `, distOpts` como 5º argumento nas 3 chamadas `computeFreshArvore(seed, modelosReais, …, modelosDb as any[])` (merge colab do `useEffect`, carga normal do `useEffect` e o `retry` do P0409 — conferir com `grep -n "computeFreshArvore(" src/components/plan-tecido/PlanTecidoSheet.tsx`: 4 linhas = a definição + 3 chamadas).

(c) Query dos modelos: trocar `proporcoes, lancado,` por `proporcoes, tamanho_tipo, lancado,` e `modelo_tecido_variantes(variante_tecido_id, ordem, multiplicador, variante:variante_tecido_id(artigo_id, ` por `modelo_tecido_variantes(variante_tecido_id, ordem, multiplicador, complementa_variante_ids, variante:variante_tecido_id(artigo_id, cor_id, `.

(d) `modelosReais` — no `materialFor(…).variantes.push({ … })`, depois de `label: corApelidoLabel(v.variante?.cor?.nome ?? null, v.variante?.apelido?.nome ?? null),` acrescentar:

```ts
            cor_id: (v.variante?.cor_id ?? null) as string | null,
            complementa_variante_ids: Array.isArray(v.complementa_variante_ids) ? (v.complementa_variante_ids as string[]) : null,
```

e, no objeto `ModeloReal` retornado, depois de `proporcoes: (m.proporcoes ?? null) as Record<string, number> | null,` acrescentar `tamanho_tipo: (m.tamanho_tipo ?? null) as "letra" | "numero" | null,`.

(e) Tamanhos + gate: trocar `const { data: tamanhos = [] } = useQuery({` por `const { data: tamanhos = [], isFetched: tamanhosProntos } = useQuery({` e, logo depois do fim desse `useQuery`, acrescentar:

```ts
  // Distribuição por produto (spec R4/R6): gate do módulo + opções da normalização (a grade da loja).
  const { isModuleEnabled, isLoading: modulosCarregando } = useTenantModules();
  const distribOn = isModuleEnabled("distribuicao");
  const distOpts = useMemo<OpcoesDist>(() => ({ ligado: distribOn, tamanhos }), [distribOn, tamanhos]);
```

(f) No `useEffect` da semeadura (o que começa com `if (!seed || salvo === undefined || modelosDb === undefined) return;`), acrescentar logo depois dessa linha:

```ts
    if (!tamanhosProntos || modulosCarregando) return; // PR3: normalizar sem a grade/sem o gate daria outro pç
```

e acrescentar `tamanhosProntos, modulosCarregando, distOpts` ao array de dependências do efeito.

(g) Funil `patch` — trocar

```ts
  const patch = (next: PtArvore) => {
```

por

```ts
  const patch = (next0: PtArvore) => {
    const next = normalizarArvoreDistribuicao(next0, distOpts); // R6: toda edição re-deriva o pç (idempotente)
```

(h) Payloads — nas 2 linhas `materiais: buildMateriaisAplicar(slot)` (auto-aplicar do Salvar e criar cards), trocar por `materiais: materiaisParaAplicar(slot, distribOn)`.

(i) Presença — logo ANTES de `const { presentes } = useColabRegistro({`, acrescentar:

```ts
  // Distribuição por produto (R19): marcador "dialog aberto" (`dist:{slot}:aberto`) quando nenhum campo está focado.
  const [focoDistribuicao, setFocoDistribuicao] = useState<string | null>(null);
```

e, dentro do `useColabRegistro({…})`, trocar `campoFocado: campoFocadoColab,` por `campoFocado: campoFocadoColab ?? focoDistribuicao,`.

(j) `cardOf` — no `<ModelCard …>`, depois de `onAbrirOcDialog={onAbrirOcDialog}` acrescentar:

```tsx
              distribuicaoLigada={distribOn}
              presentesColab={presentes}
              onFocoDistribuicao={setFocoDistribuicao}
```

- [ ] **Step 7: Rodar e ver passar**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/distribuicao-produto"
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres npx vitest run tests/unit/colab-field-path-explicito.test.ts tests/unit/plan-tecido-distribuicao-fonte.test.ts tests/unit/plan-tecido-engine.test.ts tests/unit/plan-tecido-atendimento.test.ts 2>&1 | tail -8
npx tsc --noEmit 2>&1 | tail -5
```

Expected: PASS; `tsc` sem erro.

- [ ] **Step 8: Gates e commit**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/distribuicao-produto"
bash .superpowers/distribuicao/gates.sh
git add -- src/lib/colab/colab-field-path.ts src/components/plan-tecido/AtendeAPopover.tsx src/components/plan-tecido/MaterialBlock.tsx src/components/plan-tecido/ModelCard.tsx src/components/plan-tecido/PlanTecidoSheet.tsx tests/unit/colab-field-path-explicito.test.ts tests/unit/plan-tecido-distribuicao-fonte.test.ts
git commit --only -m "feat(plan-tecido): pç distribuído só leitura, 'atende a' do forro/Tecido 2, normalização no funil e casamento no aplicar (T5)" \
  -m "Gate = módulo distribuicao; data-colab-path explícito vale em botão (R20); presença do dialog pelo campoFocado. Plano 2026-09-25, Task 5." \
  -m "Co-Authored-By: Claude <seu modelo real> <noreply@anthropic.com>" \
  -- src/lib/colab/colab-field-path.ts src/components/plan-tecido/AtendeAPopover.tsx src/components/plan-tecido/MaterialBlock.tsx src/components/plan-tecido/ModelCard.tsx src/components/plan-tecido/PlanTecidoSheet.tsx tests/unit/colab-field-path-explicito.test.ts tests/unit/plan-tecido-distribuicao-fonte.test.ts
git show --stat HEAD
```

- [ ] **Step 9: Revisão individual Opus** — colab (presença pelo `campoFocado`; nada de mecanismo novo de merge; `data-colab-path` sem efeito em telas que não marcam botão), gate do módulo (card idêntico com ele desligado — conferir o `normalizarSlotDistribuicao` com `ligado:false` devolvendo o mesmo objeto), payload (sem a chave sem o módulo), Modo Plano (a linha não cresce: selo/gatilho em `h-6`/`text-[10px]`), `patch` não marca `touched` à toa (normalização idempotente), a query com as 3 colunas novas.

---
## Task 6: Dialog "Distribuir por loja" (desktop, celular, impressão, presença)  *(individual Opus)*

**Files:**
- Create: `src/components/plan-tecido/DistribuicaoTabelas.tsx`
- Create: `src/components/plan-tecido/DistribuirPorLojaDialog.tsx`
- Modify: `src/components/plan-tecido/ModelCard.tsx` (botão + montagem do dialog)
- Test: `tests/unit/plan-tecido-distribuicao-fonte.test.ts` (2º `describe`)

**Interfaces:**
- Consumes: Task 1 (toda a lib), Task 2 (`ehTecido1`), Task 5 (props do `ModelCard`/`MaterialBlock`), `ColabPresenceOverlay`, `ColabBanner`, `PrintArea`, `printWithImages`, `InfoHover`, `ModeloThumb`, `NumberInput`.
- Produces: `DistribuirPorLojaDialog({ slot, tamanhosGrade, readOnly, motivoSoLeitura, presentes, onFoco, onSalvar, onClose })`; `DistribuicaoTabelas({ modo, slotKey, tamanhos, tipo, prop, cores, dists, lojas, readOnly, onProp, onBase, onCel, onVoltar })`; `partesCor(v)`.

- [ ] **Step 1: Teste de FONTE (falha)** — acrescentar ao FIM de `tests/unit/plan-tecido-distribuicao-fonte.test.ts`:

```ts
describe("Plan. Tecido — dialog Distribuir por loja (Task 6)", () => {
  const dlg = ler("src/components/plan-tecido/DistribuirPorLojaDialog.tsx");
  const tab = ler("src/components/plan-tecido/DistribuicaoTabelas.tsx");
  const card = ler("src/components/plan-tecido/ModelCard.tsx");
  it("presença (R19): overlay PRÓPRIO com scope no corpo rolável; marcador de página ao abrir; banner de quem está no produto", () => {
    expect(dlg).toContain("<ColabPresenceOverlay presentes={presentes} scopeRef={corpoRef} />");
    expect(dlg).toContain('ref={corpoRef} className="min-h-0 space-y-3 overflow-y-auto py-2"');
    expect(dlg).toContain("onFoco?.(pathDistAberto(slotKey));");
    expect(dlg).toContain("pathEhDoProduto(p.campoFocado, slotKey)");
  });
  it("todo campo do dialog tem data-colab-path próprio: proporção, Base e cada quadradinho", () => {
    expect(tab).toContain("pathDistProp(p.slotKey, t)");
    expect(tab).toContain("pathDistBase(p.slotKey, l.id, c.key)");
    expect(tab).toContain("pathDistCel(p.slotKey, l.id, c.key, t)");
    expect(tab).toContain("data-colab-path={path}");
  });
  it("textos do mockup", () => {
    for (const s of ["Loja / Cor", "você digita", "Tamanhos: proporção × Base · dá para corrigir à mão", "da cor na loja",
      "Proporção por tamanho", "do card", "Total por cor × tamanho", "Soma das lojas. É o que preenche o pç de cada cor do Tecido 1 no card.",
      "soma das lojas", "= pç no card", "sem distribuição · pç do card", "Editado à mão · calculado seria"]) expect(tab, s).toContain(s);
    for (const s of ["Distribuir por loja", "Salvar preenche o pç das", "Grava de vez no Salvar do plano.", "Por loja · deslize para o lado",
      "Descartar alterações?", "TEXTO_AJUDA_DIST"]) expect(dlg, s).toContain(s);
  });
  it("impressão = o que o dialog mostra, sem botões; salvar/zerar/descartar", () => {
    expect(dlg).toContain("<PrintArea>");
    expect(dlg).toContain('tabelas("impressao")');
    expect(dlg).toContain("printWithImages()");
    expect(dlg).toContain("setZeradas(nomes)");
  });
  it("o card monta o botão (Tecido 1, com o módulo) e o dialog só quando aberto", () => {
    expect(card).toContain("Distribuir por loja");
    expect(card).toMatch(/acaoExtra=\{distribuicaoLigada && ehTecido1\(m\) \?/);
    expect(card).toContain("{distOpen && (");
    expect(card).toContain("<DistribuirPorLojaDialog");
  });
});
```

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/distribuicao-produto"
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres npx vitest run tests/unit/plan-tecido-distribuicao-fonte.test.ts 2>&1 | tail -6
```

Expected: FAIL — `ENOENT … DistribuirPorLojaDialog.tsx`.

- [ ] **Step 2: `src/components/plan-tecido/DistribuicaoTabelas.tsx` (novo)**

```tsx
// Distribuição por produto — as 2 tabelas do dialog "Distribuir por loja" (spec §5.3): (1) Loja / Cor × Base × tamanhos ×
// Total, com a linha "Proporção por tamanho" do card e o subtotal por loja; (2) "Total por cor × tamanho" (= pç no card).
// UM componente para a TELA (inputs, `data-colab-path` por campo — R19) e a IMPRESSÃO (texto, sem botões). Celular:
// rolagem horizontal só dentro da tabela, 1ª coluna fixa com nome ABREVIADO (toque abre o nome completo).
import { Fragment } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { NumberInput } from "@/components/shared/NumberInput";
import { VarianteSwatch } from "@/components/shared/VarianteSwatch";
import type { TamanhoTipo } from "@/lib/tamanho";
import {
  abreviarNome, linhaVista, pathDistBase, pathDistCel, pathDistProp, rotuloTamanho, somaVistas, temDistribuicao,
  type Distribuicao,
} from "@/lib/distribuicao-produto";

export type LojaDist = { id: string; nome: string; inativa: boolean };
export type CorDist = { key: string; cor: string; apelido: string | null; swatch: string | null; pcCard: number };

const TH = "border px-2 py-1 text-center text-xs font-medium";
const TD = "border px-1 py-0.5 text-center tabular-nums";
const COL1 = "sticky left-0 z-10 border bg-background px-2 py-1 text-left";

function NomeCor({ c, impressao }: { c: CorDist; impressao: boolean }) {
  const completo = c.apelido ? `${c.cor} · ${c.apelido}` : c.cor;
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <VarianteSwatch nome={c.swatch ?? c.cor} />
      <span className={impressao ? "" : "max-md:hidden"}>
        <span className="block font-medium">{c.cor}</span>
        {c.apelido && <span className="block text-[10px] text-muted-foreground">{c.apelido}</span>}
      </span>
      {!impressao && (
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" className="truncate text-left font-medium md:hidden" title={completo}>
              {abreviarNome(`${c.cor}${c.apelido ? ` ${c.apelido}` : ""}`)}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-2 text-xs">{completo}</PopoverContent>
        </Popover>
      )}
    </div>
  );
}

export function DistribuicaoTabelas(p: {
  modo: "edicao" | "impressao";
  slotKey: string;
  tamanhos: string[];
  tipo: TamanhoTipo;
  prop: Record<string, number>;
  cores: CorDist[];
  dists: Record<string, Distribuicao>;
  lojas: LojaDist[];
  readOnly?: boolean;
  onProp?: (t: string, v: number) => void;
  onBase?: (corKey: string, loja: string, v: number) => void;
  onCel?: (corKey: string, loja: string, t: string, v: number) => void;
  onVoltar?: (corKey: string, loja: string, t: string) => void;
}) {
  const imp = p.modo === "impressao";
  const bloqueado = imp || !!p.readOnly;
  const esmaecido = (t: string) => ((p.prop[t] ?? 0) > 0 ? "" : "opacity-50");
  const somaProp = p.tamanhos.reduce((s, t) => s + (p.prop[t] ?? 0), 0);
  const vista = (corKey: string, loja: string) => linhaVista(p.dists[corKey]?.[loja], p.prop, p.tamanhos);
  const campo = (valor: number, onChange: (v: number) => void, path: string, aria: string, extra = "") =>
    imp ? (
      <span className={extra}>{valor || 0}</span>
    ) : (
      <NumberInput integer blankZero placeholder="0" value={valor} aria-label={aria} data-colab-path={path} disabled={bloqueado}
        className={`h-8 w-14 border-0 bg-transparent px-1 text-center shadow-none max-md:h-10 ${extra}`}
        onChange={(e) => onChange(Number(e.target.value) || 0)} />
    );
  const comDist = p.cores.filter((c) => temDistribuicao(p.dists[c.key]));
  const totalGeral = somaVistas(comDist.flatMap((c) => p.lojas.map((l) => vista(c.key, l.id))), p.tamanhos);

  return (
    <div className="space-y-5">
      <div className="overflow-x-auto rounded border">
        <table className="w-full min-w-[640px] border-collapse text-sm" aria-label="Distribuição por loja e cor">
          <thead className="bg-muted/50">
            <tr>
              <th rowSpan={2} className={`${COL1} bg-muted/50 text-xs font-medium`}>Loja / Cor</th>
              <th rowSpan={2} className={TH}>Base<span className="block text-[10px] font-normal text-muted-foreground">você digita</span></th>
              <th colSpan={p.tamanhos.length} className={TH}>Tamanhos: proporção × Base · dá para corrigir à mão</th>
              <th rowSpan={2} className={TH}>Total<span className="block text-[10px] font-normal text-muted-foreground">da cor na loja</span></th>
            </tr>
            <tr>{p.tamanhos.map((t) => <th key={t} className={`${TH} ${esmaecido(t)}`}>{rotuloTamanho(t, p.tipo)}</th>)}</tr>
          </thead>
          <tbody>
            <tr className="bg-muted/30">
              <td className={`${COL1} bg-muted/30`}>Proporção por tamanho<span className="block text-[10px] text-muted-foreground">do card</span></td>
              <td className={`${TD} text-muted-foreground`}>—</td>
              {p.tamanhos.map((t) => (
                <td key={t} className={`${TD} ${esmaecido(t)}`}>
                  {campo(p.prop[t] ?? 0, (v) => p.onProp?.(t, v), pathDistProp(p.slotKey, t), `Proporção ${rotuloTamanho(t, p.tipo)}`)}
                </td>
              ))}
              <td className={`${TD} font-semibold`}>{somaProp}</td>
            </tr>
            {p.lojas.map((l) => {
              const vistas = p.cores.map((c) => vista(c.key, l.id));
              const sub = somaVistas(vistas, p.tamanhos);
              return (
                <Fragment key={l.id}>
                  <tr className={l.inativa ? "opacity-60" : ""}>
                    <td colSpan={p.tamanhos.length + 3} className="border bg-muted/60 px-2 py-1 text-xs font-semibold uppercase tracking-wide">{l.nome}</td>
                  </tr>
                  {p.cores.map((c, i) => {
                    const v = vistas[i];
                    return (
                      <tr key={c.key} className={l.inativa ? "opacity-60" : ""}>
                        <td className={COL1}><NomeCor c={c} impressao={imp} /></td>
                        <td className={TD}>{campo(v.base, (x) => p.onBase?.(c.key, l.id, x), pathDistBase(p.slotKey, l.id, c.key), `Base ${l.nome} ${c.cor}`, "font-semibold")}</td>
                        {p.tamanhos.map((t) => {
                          const cel = v.celulas[t];
                          return (
                            <td key={t} className={`${TD} relative ${esmaecido(t)}`}>
                              {campo(cel.valor, (x) => p.onCel?.(c.key, l.id, t, x), pathDistCel(p.slotKey, l.id, c.key, t), `${l.nome} ${c.cor} ${rotuloTamanho(t, p.tipo)}`)}
                              {cel.manual && (imp ? (
                                <span aria-hidden> •</span>
                              ) : (
                                <button type="button" disabled={bloqueado} onClick={() => p.onVoltar?.(c.key, l.id, t)}
                                  title={`Editado à mão · calculado seria ${cel.calculado} · clique para voltar ao calculado`}
                                  aria-label={`Voltar ao calculado (${cel.calculado})`}
                                  className="absolute right-0.5 top-0.5 h-3 w-3 rounded-full bg-primary max-md:h-4 max-md:w-4" />
                              ))}
                            </td>
                          );
                        })}
                        <td className={`${TD} font-semibold`}>{v.total}</td>
                      </tr>
                    );
                  })}
                  <tr className="bg-muted/40 font-semibold">
                    <td className={`${COL1} bg-muted/40`}>Total {l.nome}</td>
                    <td className={TD}>{sub.base}</td>
                    {p.tamanhos.map((t) => <td key={t} className={`${TD} ${esmaecido(t)}`}>{sub.grades[t]}</td>)}
                    <td className={TD}>{sub.total}</td>
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        <span className="mr-1 inline-block h-2 w-2 rounded-full bg-primary align-middle" />editado à mão — passe o mouse para ver o calculado e voltar a ele (↺). Os totais já contam o valor editado.
      </p>

      <div className="space-y-1">
        <h3 className="text-sm font-semibold">Total por cor × tamanho</h3>
        <p className="text-xs text-muted-foreground">Soma das lojas. É o que preenche o pç de cada cor do Tecido 1 no card.</p>
        <div className="overflow-x-auto rounded border">
          <table className="w-full min-w-[560px] border-collapse text-sm" aria-label="Total por cor e tamanho">
            <thead className="bg-muted/50">
              <tr>
                <th className={`${COL1} bg-muted/50 text-xs font-medium`}>Cor</th>
                <th className={TH}>Base<span className="block text-[10px] font-normal text-muted-foreground">soma das lojas</span></th>
                {p.tamanhos.map((t) => <th key={t} className={`${TH} ${esmaecido(t)}`}>{rotuloTamanho(t, p.tipo)}</th>)}
                <th className={TH}>Total<span className="block text-[10px] font-normal text-muted-foreground">= pç no card</span></th>
              </tr>
            </thead>
            <tbody>
              {p.cores.map((c) => {
                const tem = temDistribuicao(p.dists[c.key]);
                const tot = somaVistas(p.lojas.map((l) => vista(c.key, l.id)), p.tamanhos);
                return (
                  <tr key={c.key}>
                    <td className={COL1}><NomeCor c={c} impressao={imp} /></td>
                    {tem ? (
                      <>
                        <td className={TD}>{tot.base}</td>
                        {p.tamanhos.map((t) => <td key={t} className={`${TD} ${esmaecido(t)}`}>{tot.grades[t]}</td>)}
                        <td className={`${TD} font-semibold`}>{tot.total}</td>
                      </>
                    ) : (
                      <td colSpan={p.tamanhos.length + 2} className={`${TD} text-left text-xs text-muted-foreground`}>sem distribuição · pç do card {c.pcCard}</td>
                    )}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-muted/40 font-semibold">
                <td className={`${COL1} bg-muted/40`}>Total</td>
                <td className={TD}>{totalGeral.base}</td>
                {p.tamanhos.map((t) => <td key={t} className={`${TD} ${esmaecido(t)}`}>{totalGeral.grades[t]}</td>)}
                <td className={TD}>{totalGeral.total}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: `src/components/plan-tecido/DistribuirPorLojaDialog.tsx` (novo)**

```tsx
// Distribuição por produto — dialog "Distribuir por loja" (spec §5.3, R8–R13, R18–R19, R32–R33). Rascunho LOCAL: o
// "Salvar" daqui aplica no card (onSalvar → funil `patch` do PlanTecidoSheet: normalização, dirty, touched, colab) e grava
// de vez no Salvar do plano. Presença: o Dialog é portal — o ColabPresenceOverlay do <main> não alcança o conteúdo, então
// este monta o SEU (scope = corpo rolável); o foco chega ao canal pelo onFocusCapture do <main> (evento React atravessa portal).
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Printer, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import type { PresencaColab } from "@/hooks/useColabRegistro";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { InfoHover } from "@/components/shared/InfoHover";
import { PrintArea } from "@/components/shared/PrintArea";
import { ColabBanner } from "@/components/shared/ColabBanner";
import { ColabPresenceOverlay } from "@/components/shared/ColabPresenceOverlay";
import { printWithImages } from "@/lib/print";
import { varKey } from "@/lib/plan-tecido/calc";
import { ehTecido1 } from "@/lib/plan-tecido/atendimento";
import type { PtSlot, PtVariante } from "@/lib/plan-tecido/types";
import {
  TEXTO_AJUDA_DIST, chaveSlot, definirBase, definirCelula, definirProporcao, normalizarDistribuicao, pathDistAberto,
  pathEhDoProduto, proporcaoDoTamanho, tamanhosDoTipo, temDistribuicao, tipoDoProduto, totaisDaDistribuicao,
  voltarAoCalculado, type Distribuicao,
} from "@/lib/distribuicao-produto";
import { ModeloThumb } from "./ModeloThumb";
import { DistribuicaoTabelas, type CorDist, type LojaDist } from "./DistribuicaoTabelas";

type LojaDb = { id: string; nome: string; ativo: boolean; is_default: boolean; ordem: number | null };

/** "Marrom" + "Canela" a partir da variante (a cor planejada guarda "Cor - Apelido" no label). */
export function partesCor(v: PtVariante): { cor: string; apelido: string | null } {
  const cor = v.cor_nome || v.label || "—";
  const apelido = v.label && v.cor_nome && v.label.startsWith(`${v.cor_nome} - `) ? v.label.slice(v.cor_nome.length + 3) : null;
  return { cor, apelido: apelido || null };
}

export function DistribuirPorLojaDialog({ slot, tamanhosGrade, readOnly, motivoSoLeitura, presentes, onFoco, onSalvar, onClose }: {
  slot: PtSlot;
  tamanhosGrade: string[];
  readOnly: boolean;
  motivoSoLeitura: string;
  presentes: PresencaColab[];
  onFoco?: (path: string | null) => void;
  onSalvar: (novo: PtSlot) => void;
  onClose: () => void;
}) {
  const tenantId = useActiveTenantId();
  const slotKey = chaveSlot(slot);
  const tipo = tipoDoProduto(slot.tamanho_tipo);
  const tamanhos = useMemo(() => tamanhosDoTipo(tamanhosGrade, tipo), [tamanhosGrade, tipo]);
  const t1 = slot.materiais.find(ehTecido1);
  // Snapshot na ABERTURA (o card monta o dialog só aberto — {distOpen && …}): é o rascunho local.
  const [inicial] = useState(() => ({
    prop: Object.fromEntries(tamanhos.map((t) => [t, proporcaoDoTamanho(slot.proporcoes, t)])) as Record<string, number>,
    dists: Object.fromEntries(
      (t1?.variantes ?? []).map((v) => [varKey(v), normalizarDistribuicao(v.distribuicao, slot.proporcoes, tamanhos)]),
    ) as Record<string, Distribuicao>,
  }));
  const [prop, setProp] = useState(inicial.prop);
  const [dists, setDists] = useState(inicial.dists);
  const dirty = JSON.stringify({ prop, dists }) !== JSON.stringify(inicial);
  const [confirmarDescarte, setConfirmarDescarte] = useState(false);
  const [zeradas, setZeradas] = useState<string[] | null>(null);
  const corpoRef = useRef<HTMLDivElement>(null);

  const { data: lojasDb, isFetched: lojasProntas } = useQuery({
    queryKey: ["dist-produto-lojas", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("lojas_direcionamento" as any) as any)
        .select("id, nome, ativo, is_default, ordem")
        .order("is_default", { ascending: false })
        .order("ordem", { ascending: true, nullsFirst: false })
        .order("nome");
      if (error) throw error;
      return ((data ?? []) as unknown) as LojaDb[];
    },
  });
  // R13: ativas + qualquer loja com dado (inativa/excluída, esmaecida e editável — dá para zerar).
  const lojas = useMemo<LojaDist[]>(() => {
    const comDado = new Set(Object.values(dists).flatMap((d) => Object.keys(d)));
    const out: LojaDist[] = (lojasDb ?? [])
      .filter((l) => l.ativo || comDado.has(l.id))
      .map((l) => ({ id: l.id, nome: l.ativo ? l.nome : `${l.nome} (inativa)`, inativa: !l.ativo }));
    const conhecidas = new Set((lojasDb ?? []).map((l) => l.id));
    for (const id of comDado) if (!conhecidas.has(id)) out.push({ id, nome: "Loja excluída", inativa: true });
    return out;
  }, [lojasDb, dists]);
  const cores = useMemo<CorDist[]>(
    () => (t1?.variantes ?? []).map((v) => {
      const { cor, apelido } = partesCor(v);
      return { key: varKey(v), cor, apelido, swatch: v.cor_nome ?? v.label ?? null, pcCard: Number(v.grade_total) || 0 };
    }),
    [t1],
  );

  // Presença de página (R19): com o dialog aberto e nenhum campo focado, os outros veem "neste produto".
  useEffect(() => {
    onFoco?.(pathDistAberto(slotKey));
    return () => onFoco?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotKey]);
  const presentesAqui = presentes.filter((p) => pathEhDoProduto(p.campoFocado, slotKey));

  const setBase = (k: string, loja: string, v: number) => setDists((d) => ({ ...d, [k]: definirBase(d[k] ?? {}, loja, v, prop, tamanhos) }));
  const setCel = (k: string, loja: string, t: string, v: number) => setDists((d) => ({ ...d, [k]: definirCelula(d[k] ?? {}, loja, t, v, prop, tamanhos) }));
  const voltar = (k: string, loja: string, t: string) => setDists((d) => ({ ...d, [k]: voltarAoCalculado(d[k] ?? {}, loja, t, prop, tamanhos) }));
  const setPropT = (t: string, v: number) => {
    const np = definirProporcao(prop, tamanhos, t, v);
    setProp(np);
    setDists((d) => Object.fromEntries(Object.entries(d).map(([k, x]) => [k, normalizarDistribuicao(x, np, tamanhos)])));
  };
  const pedirFechar = () => (dirty && !readOnly ? setConfirmarDescarte(true) : onClose());

  // PR5/R10: aplica sobre o slot ATUAL (prop viva) — só as cores do T1 do rascunho e a proporção (se mudou).
  const montar = () => {
    const nomes: string[] = [];
    const materiais = slot.materiais.map((m) => {
      if (!ehTecido1(m)) return m;
      return {
        ...m,
        variantes: m.variantes.map((v) => {
          const k = varKey(v);
          if (!(k in dists)) return v;
          const d = dists[k];
          const antes = Number(v.grade_total) || 0;
          if (temDistribuicao(d)) {
            const tot = totaisDaDistribuicao(d);
            if (antes > 0 && tot.total === 0) nomes.push(partesCor(v).cor);
            return { ...v, distribuicao: d, grades: tot.grades, grade_total: tot.total };
          }
          if (temDistribuicao(v.distribuicao)) { // tinha e perdeu todas as linhas → 0 (R10)
            if (antes > 0) nomes.push(partesCor(v).cor);
            return { ...v, distribuicao: {}, grades: {}, grade_total: 0 };
          }
          return v;
        }),
      };
    });
    const propMudou = JSON.stringify(prop) !== JSON.stringify(inicial.prop);
    const novo: PtSlot = { ...slot, ...(propMudou ? { proporcoes: { ...(slot.proporcoes ?? {}), ...prop } } : {}), materiais };
    return { novo, nomes };
  };
  const salvar = (forcar = false) => {
    if (!dirty) return onClose();
    const { novo, nomes } = montar();
    if (nomes.length > 0 && !forcar) return setZeradas(nomes);
    onSalvar(novo);
  };

  const n = cores.length;
  const cabecalho = (
    <div className="flex items-start gap-3">
      <ModeloThumb path={slot.thumb_path ?? slot.referencia_paths?.[0] ?? null} className="h-16 w-12 shrink-0" zoom alt={slot.nome ?? "Produto"} />
      <div className="min-w-0 space-y-0.5">
        <p className="truncate font-semibold">{slot.nome ?? "Produto sem nome"}{slot.ref ? ` · ${slot.ref}` : ""}</p>
        <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          Tecido 1: {t1?.artigo_nome ?? "—"} · {n} {n === 1 ? "cor" : "cores"} · tamanhos em {tipo === "numero" ? "Número" : "Letra"}
          <InfoHover ariaLabel="De onde vêm as lojas e os tamanhos">
            O “Tamanho em” vem do Planejamento de Produto (seção Códigos). Lojas ativas de Cadastro › Lojas; todos os tamanhos da grade da loja.
          </InfoHover>
        </p>
      </div>
    </div>
  );
  const tabelas = (modo: "edicao" | "impressao") => (
    <DistribuicaoTabelas modo={modo} slotKey={slotKey} tamanhos={tamanhos} tipo={tipo} prop={prop} cores={cores} dists={dists}
      lojas={lojas} readOnly={readOnly} onProp={setPropT} onBase={setBase} onCel={setCel} onVoltar={voltar} />
  );

  return (
    <>
      <Dialog open onOpenChange={(o) => { if (!o) pedirFechar(); }}>
        <DialogContent fixedFooter mobileFull className="md:max-w-5xl">
          <DialogHeader className="space-y-2 text-left">
            <div className="flex items-center gap-2 pr-8">
              <DialogTitle className="flex-1">Distribuir por loja</DialogTitle>
              <Button variant="outline" size="sm" onClick={() => void printWithImages()} aria-label="Imprimir" disabled={!lojasProntas}>
                <Printer className="h-4 w-4 md:mr-1" /><span className="max-md:sr-only">Imprimir</span>
              </Button>
            </div>
            <DialogDescription className="sr-only">Distribuição do produto por loja, cor e tamanho</DialogDescription>
            {cabecalho}
            <ColabBanner presentes={presentesAqui} ultimoMerge={null} />
          </DialogHeader>
          {/* Corpo rolável = scope do overlay de presença (DialogBody não repassa ref; mesmas classes). */}
          <div ref={corpoRef} className="min-h-0 space-y-3 overflow-y-auto py-2">
            <p className="text-xs text-muted-foreground">{TEXTO_AJUDA_DIST}</p>
            <p className="text-xs text-muted-foreground md:hidden">Por loja · deslize para o lado</p>
            <fieldset disabled={readOnly} className="contents">
              {lojasProntas ? tabelas("edicao") : <p className="py-6 text-center text-sm text-muted-foreground">Carregando lojas…</p>}
            </fieldset>
          </div>
          <DialogFooter className="-mx-4 -mb-4 border-t bg-background px-4 py-3 sm:-mx-6 sm:-mb-6 sm:px-6">
            <Button variant="outline" onClick={pedirFechar} aria-label="Voltar">
              <ArrowLeft className="h-4 w-4 sm:mr-1" /><span className="max-sm:sr-only">Voltar</span>
            </Button>
            {readOnly ? (
              <span className="ml-auto text-xs text-muted-foreground">{motivoSoLeitura}</span>
            ) : (
              <>
                <span className="hidden flex-1 text-xs text-muted-foreground sm:block">
                  Salvar preenche o pç das {n} cores no card. Grava de vez no Salvar do plano.
                </span>
                <Button className="ml-auto max-sm:aspect-square max-sm:px-0" onClick={() => salvar()} aria-label="Salvar">
                  <Save className="h-4 w-4 sm:mr-1" /><span className="max-sm:sr-only">Salvar</span>
                </Button>
              </>
            )}
          </DialogFooter>
          <ColabPresenceOverlay presentes={presentes} scopeRef={corpoRef} />
          {confirmarDescarte && (
            <AlertDialog open onOpenChange={(o) => !o && setConfirmarDescarte(false)}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Descartar alterações?</AlertDialogTitle>
                  <AlertDialogDescription>O que você mudou na distribuição deste produto se perde.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Continuar editando</AlertDialogCancel>
                  <AlertDialogAction onClick={onClose}>Descartar</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          {zeradas && (
            <AlertDialog open onOpenChange={(o) => !o && setZeradas(null)}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Zerar o pç destas cores?</AlertDialogTitle>
                  <AlertDialogDescription>
                    {zeradas.join(", ")} {zeradas.length === 1 ? "tinha peças no card e vai ficar" : "tinham peças no card e vão ficar"} com 0. Salvar mesmo assim?
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Voltar</AlertDialogCancel>
                  <AlertDialogAction onClick={() => { setZeradas(null); salvar(true); }}>Salvar</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </DialogContent>
      </Dialog>
      {lojasProntas && (
        <PrintArea>
          <div className="space-y-4 p-6">
            <h1 className="text-lg font-semibold">Distribuir por loja</h1>
            {cabecalho}
            {tabelas("impressao")}
          </div>
        </PrintArea>
      )}
    </>
  );
}
```

- [ ] **Step 4: `src/components/plan-tecido/ModelCard.tsx` — botão e dialog**

(a) Imports: acrescentar `Store` ao import do `lucide-react` (`import { ChevronRight, Lock, ShoppingCart, MoreHorizontal, Eraser, Store } from "lucide-react";`) e:

```ts
import { useReadOnly } from "@/components/RequirePermission";
import { DistribuirPorLojaDialog } from "./DistribuirPorLojaDialog";
```

(b) Logo depois de `const t1Variantes = …` (Task 5), acrescentar:

```ts
  // Dialog "Distribuir por loja" (montado só aberto — nasce limpo). Só leitura: enviado à Explosão (P-22) ou sem permissão.
  const [distOpen, setDistOpen] = useState(false);
  const paginaSoLeitura = useReadOnly();
  const distSoLeitura = !!travado || paginaSoLeitura;
```

(c) No `<MaterialBlock …>` de "1. Tecidos & Forros", depois da prop `dist={…}` (Task 5), acrescentar:

```tsx
                        acaoExtra={distribuicaoLigada && ehTecido1(m) ? (
                          <Button variant="outline" size="sm" className="h-7 gap-1 text-[11px]" onClick={() => setDistOpen(true)}
                            disabled={m.variantes.length === 0}
                            title={m.variantes.length === 0 ? "Adicione as cores do Tecido 1 antes de distribuir" : undefined}>
                            <Store className="h-3 w-3" />Distribuir por loja
                          </Button>
                        ) : undefined}
```

(d) Logo antes do `</>` que fecha o `return` do componente (depois do último bloco/Dialog já existente do card), acrescentar:

```tsx
      {distOpen && (
        <DistribuirPorLojaDialog
          slot={slot}
          tamanhosGrade={tamanhos ?? []}
          readOnly={distSoLeitura}
          motivoSoLeitura={travado ? "Enviado à Explosão — só leitura (ver e imprimir)." : "Só leitura (ver e imprimir)."}
          presentes={presentesColab ?? []}
          onFoco={onFocoDistribuicao}
          onSalvar={(novo) => { onChange(novo); setDistOpen(false); }}
          onClose={() => setDistOpen(false)}
        />
      )}
```

(`useState` e `Button` já são importados no `ModelCard`; conferir e, se faltar, acrescentar ao import existente.)

- [ ] **Step 5: Rodar e ver passar**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/distribuicao-produto"
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres npx vitest run tests/unit/plan-tecido-distribuicao-fonte.test.ts tests/unit/ui-padroes-antidrift.test.ts 2>&1 | tail -8
npx tsc --noEmit 2>&1 | tail -5
```

Expected: PASS (o anti-drift não acusa nada nos 3 arquivos novos); `tsc` limpo.

- [ ] **Step 6: Gates e commit**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/distribuicao-produto"
bash .superpowers/distribuicao/gates.sh
git add -- src/components/plan-tecido/DistribuicaoTabelas.tsx src/components/plan-tecido/DistribuirPorLojaDialog.tsx src/components/plan-tecido/ModelCard.tsx tests/unit/plan-tecido-distribuicao-fonte.test.ts
git commit --only -m "feat(plan-tecido): dialog 'Distribuir por loja' — Base × proporção, correção à mão, total por cor, impressão e presença (T6)" \
  -m "Rascunho local aplicado no card; zerar pede confirmação; só leitura depois da Explosão; overlay de presença próprio (portal). Plano 2026-09-25, Task 6." \
  -m "Co-Authored-By: Claude <seu modelo real> <noreply@anthropic.com>" \
  -- src/components/plan-tecido/DistribuicaoTabelas.tsx src/components/plan-tecido/DistribuirPorLojaDialog.tsx src/components/plan-tecido/ModelCard.tsx tests/unit/plan-tecido-distribuicao-fonte.test.ts
git show --stat HEAD
```

- [ ] **Step 7: Revisão individual Opus** — as regras do dialog batem com a lib (Base/manual/↺/proporção); Salvar aplica sobre o slot vivo e só mexe no Tecido 1 + proporção (se mudou); zerar pede confirmação; Voltar com rascunho pergunta; só leitura travado/sem permissão; presença: overlay próprio com scope no corpo rolável, marcador `aberto` limpo ao fechar, banner filtrado pelo produto; mobile (390: rolagem só na tabela, coluna fixa abreviada, rodapé fixo só-ícone); impressão (só com o dialog aberto; sem botões); nenhuma cor/px solta.

---
## Task 7: Direcionamento — plano do modelo, "X modelos direcionados" e semi-preenchimento  *(individual Opus)*

**Files:**
- Create: `src/lib/direcionamento-plano.ts`
- Create: `src/components/direcionamento/PlanoDoModeloCard.tsx`
- Modify: `src/routes/_authenticated/expedicao.direcionamento.$modeloId.tsx`
- Test: `tests/unit/direcionamento-plano.test.ts`, `tests/unit/direcionamento-plano-fonte.test.ts`

**Interfaces:**
- Consumes: RPC `direcionamento_plano_modelo(_modelo_id)` (Task 4 — contrato spec §5.1); `pathDirCel` (`@/lib/colab/merge-grade-dir`); `ladoTamanho` (`@/lib/tamanho`); `tipoDoProduto` (Task 1); `diffPorTamanho`/`motivoNaoConfere` (inalterados).
- Produces: tipos `PlanoModelo`, `PlanoModeloResp`, `MotivoSemPlano`, `Pendente`; `celulaPlano`, `totalPlanoVariante`, `tamanhosDoPlano`, `preencherComPlano`, `textoPendencia`, `TEXTO_MOTIVO_SEM_PLANO`; `PlanoDoModeloCard`; queryKey `["dir-plano-modelo", modeloId]` (a antiga `["dir-resumo-subcol", …]` some).

- [ ] **Step 1: Teste da regra (falha)** — `tests/unit/direcionamento-plano.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { celulaPlano, preencherComPlano, tamanhosDoPlano, textoPendencia, totalPlanoVariante, type PlanoModelo } from "@/lib/direcionamento-plano";

const EC = "loja-ec", LF = "loja-lf", AT = "loja-at";
const T = ["38|P", "40|M", "42|G", "44|GG"];
const g = (p: number, m: number, gg: number, xg: number) => ({ "38|P": p, "40|M": m, "42|G": gg, "44|GG": xg });
// Plano do mockup (VESTIDO LONGO POEMA): 1 Marrom, 2 Preto, 3 Vinho (Atacado sem Vinho).
const PLANO: PlanoModelo = {
  tamanho_tipo: "letra", tamanhos: ["34|PPP", "36|PP", ...T],
  lojas: [EC, LF, AT].map((id, i) => ({ loja_id: id, nome: id, ativo: true, is_default: i === 0, ordem: i + 1 })),
  variantes: [1, 2, 3].map((n) => ({ variante_numero: n, variante_tecido_id: `vt${n}`, cor_nome: `cor${n}`, apelido_nome: null })),
  celulas: [
    { loja_id: EC, variante_numero: 1, grades: g(4, 10, 10, 5) }, { loja_id: LF, variante_numero: 1, grades: g(3, 6, 6, 3) }, { loja_id: AT, variante_numero: 1, grades: g(4, 8, 8, 4) },
    { loja_id: EC, variante_numero: 2, grades: g(6, 12, 12, 6) }, { loja_id: LF, variante_numero: 2, grades: g(4, 8, 8, 4) }, { loja_id: AT, variante_numero: 2, grades: g(5, 10, 10, 5) },
    { loja_id: EC, variante_numero: 3, grades: g(3, 6, 6, 3) }, { loja_id: LF, variante_numero: 3, grades: g(2, 4, 4, 2) },
  ],
  sem_correspondencia: [],
};
const REAL = [
  { variante_numero: 1, real: g(11, 23, 24, 12) },
  { variante_numero: 2, real: g(15, 30, 28, 15) },
  { variante_numero: 3, real: g(5, 10, 10, 5) },
];
const lojas = [{ id: EC }, { id: LF }, { id: AT }];
const soma = (linhas: Record<string, Record<string, number>>, t: string) => Object.values(linhas).reduce((s, x) => s + (x[t] ?? 0), 0);

describe("direcionamento-plano — regra do semi-preenchimento (R22, mockup)", () => {
  const r = preencherComPlano({ variantes: REAL, tamanhos: T, lojas, podeEditar: () => true, plano: PLANO });
  it("onde bate, cada loja recebe o plano; onde não bate, a coluna fica VAZIA em todas as lojas", () => {
    expect(r.linhas[1][EC]).toEqual({ "38|P": 4, "42|G": 10, "44|GG": 5 });   // M (real 23 × plano 24) vazio
    expect(r.linhas[2][LF]).toEqual({ "38|P": 4, "40|M": 8, "44|GG": 4 });    // G (real 28 × plano 30) vazio
    expect(r.linhas[3][AT]).toEqual(g(0, 0, 0, 0));                            // Atacado sem Vinho no plano → 0 (bateu)
  });
  it("pendências = Marrom M (23 × 24) e Preto G (28 × 30); Σ Direcionado 47/70 e 60/88", () => {
    expect(r.pendentes).toEqual([
      { variante_numero: 1, tamanho: "40|M", real: 23, plano: 24 },
      { variante_numero: 2, tamanho: "42|G", real: 28, plano: 30 },
    ]);
    expect(T.reduce((s, t) => s + soma(r.linhas[1], t), 0)).toBe(47);
    expect(T.reduce((s, t) => s + soma(r.linhas[2], t), 0)).toBe(60);
    expect(T.reduce((s, t) => s + soma(r.linhas[3], t), 0)).toBe(30);
  });
  it("doPlano = células escritas pelo plano; escritas = TODAS as tocadas (inclusive as que ficaram vazias)", () => {
    expect(r.doPlano).toHaveLength(9 + 9 + 12);
    expect(r.doPlano).toContain("dir:1:loja-ec:38|P");
    expect(r.doPlano).not.toContain("dir:1:loja-ec:40|M");
    expect(r.escritas).toHaveLength(36);
  });
  it("loja NÃO editável (inativa sem par histórico) fica fora da conta e não recebe nada", () => {
    const x = preencherComPlano({ variantes: REAL, tamanhos: T, lojas, podeEditar: (id) => id !== AT, plano: PLANO });
    expect(x.linhas[3][AT]).toBeUndefined();
    expect(x.linhas[3][EC]).toEqual(g(3, 6, 6, 3));                           // Vinho: EC+LF = real → bate
    expect(x.pendentes.filter((p) => p.variante_numero === 1).map((p) => p.tamanho)).toEqual(T); // Marrom: sem o Atacado nada bate
  });
  it("sem plano não inventa nada", () => {
    const x = preencherComPlano({ variantes: [{ variante_numero: 1, real: g(1, 0, 0, 0) }], tamanhos: T, lojas, podeEditar: () => true, plano: null });
    expect(x.pendentes.map((p) => p.tamanho)).toEqual(["38|P"]);
    expect(x.linhas[1][EC]).toEqual({ "40|M": 0, "42|G": 0, "44|GG": 0 });
  });
});

describe("direcionamento-plano — leitura do plano", () => {
  it("celulaPlano: null = a loja não tem essa cor ('—')", () => {
    expect(celulaPlano(PLANO, AT, 3, "38|P")).toBeNull();
    expect(celulaPlano(PLANO, EC, 1, "40|M")).toBe(10);
  });
  it("totalPlanoVariante: Marrom 71 (P 11 · M 24 · G 24 · GG 12)", () => {
    expect(totalPlanoVariante(PLANO, 1)).toEqual({ porTamanho: g(11, 24, 24, 12), total: 71 });
  });
  it("tamanhosDoPlano: Grade Real ∪ tamanhos com plano > 0, na ordem da grade (R34)", () => {
    const p2: PlanoModelo = { ...PLANO, celulas: [...PLANO.celulas, { loja_id: EC, variante_numero: 1, grades: { "36|PP": 2 } }] };
    expect(tamanhosDoPlano(PLANO.tamanhos, T, p2)).toEqual(["36|PP", ...T]);
    expect(tamanhosDoPlano(PLANO.tamanhos, T, PLANO)).toEqual(T);
  });
  it("textoPendencia (mockup)", () => {
    expect(textoPendencia("M", { variante_numero: 1, tamanho: "40|M", real: 23, plano: 24 })).toBe(
      "M: plano 24 · real 23 → distribua à mão as 23 peças entre as lojas. Nenhuma loja veio preenchida porque não dá para saber de qual tirar.");
  });
});
```

(Obs. do caso "sem plano": o Σ do plano é 0 em todo tamanho; os tamanhos com real 0 "batem" e recebem 0 — é o mesmo "0" que a pessoa digitaria; a tela só chama a regra COM plano.)

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/distribuicao-produto"
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres npx vitest run tests/unit/direcionamento-plano.test.ts 2>&1 | tail -5
```

Expected: FAIL — import não resolvido.

- [ ] **Step 2: `src/lib/direcionamento-plano.ts` (novo)**

```ts
// Distribuição por produto → Direcionamento (spec R21–R24, R34, R38): tipos da RPC `direcionamento_plano_modelo`, leitura do
// plano por variante e a REGRA do semi-preenchimento (P-12 revista). PURO. O servidor do Direcionamento NÃO muda
// (invariante #10): isto só monta o RASCUNHO; o Confirmar segue exigindo Σ = Grade Real (RAISE P0001 no servidor).
import { pathDirCel } from "@/lib/colab/merge-grade-dir";

export type PlanoLoja = { loja_id: string; nome: string; ativo: boolean; is_default: boolean; ordem: number | null };
export type PlanoVariante = { variante_numero: number | null; variante_tecido_id: string | null; cor_nome: string | null; apelido_nome: string | null };
export type PlanoCelula = { loja_id: string; variante_numero: number; grades: Record<string, number> };
export type PlanoModelo = {
  tamanho_tipo: "letra" | "numero";
  tamanhos: string[];
  lojas: PlanoLoja[];
  variantes: PlanoVariante[];
  celulas: PlanoCelula[];
  sem_correspondencia: { cor_nome: string | null; apelido_nome: string | null; total: number }[];
};
export type MotivoSemPlano = "modulo_desligado" | "comprado" | "sem_plano_tecido" | "sem_distribuicao";
export type PlanoModeloResp = { subcolecao: string | null; direcionados: number; plano: PlanoModelo | null; motivo_sem_plano: MotivoSemPlano | null };

export const TEXTO_MOTIVO_SEM_PLANO: Record<MotivoSemPlano, string> = {
  modulo_desligado: "o módulo Distribuição está desligado",
  comprado: "produto comprado (revenda/importado) fica fora desta entrega",
  sem_plano_tecido: "o modelo não está no Plan. Tecido desta coleção",
  sem_distribuicao: "o modelo não foi distribuído no Plan. Tecido",
};

/** Quantidade do plano numa célula; null = a loja não tem essa cor no plano ("—"). */
export function celulaPlano(plano: PlanoModelo | null, lojaId: string, vnum: number, t: string): number | null {
  const c = plano?.celulas.find((x) => x.loja_id === lojaId && x.variante_numero === vnum);
  if (!c) return null;
  return Number(c.grades?.[t] ?? 0) || 0;
}

/** Σ do plano de UMA variante por tamanho (opcionalmente só nas lojas dadas). */
export function totalPlanoVariante(plano: PlanoModelo | null, vnum: number, lojaIds?: string[]): { porTamanho: Record<string, number>; total: number } {
  const porTamanho: Record<string, number> = {};
  let total = 0;
  for (const c of plano?.celulas ?? []) {
    if (c.variante_numero !== vnum || (lojaIds && !lojaIds.includes(c.loja_id))) continue;
    for (const [t, q] of Object.entries(c.grades ?? {})) {
      const n = Number(q) || 0;
      porTamanho[t] = (porTamanho[t] ?? 0) + n;
      total += n;
    }
  }
  return { porTamanho, total };
}

/** Colunas da tabela do plano (R34): tamanhos da Grade Real ∪ tamanhos com plano > 0, na ordem da grade da loja. */
export function tamanhosDoPlano(ordem: string[], tamanhosReal: string[], plano: PlanoModelo | null): string[] {
  const set = new Set(tamanhosReal);
  for (const c of plano?.celulas ?? []) for (const [t, q] of Object.entries(c.grades ?? {})) if ((Number(q) || 0) > 0) set.add(t);
  const ordenados = ordem.filter((t) => set.has(t));
  const extras = [...set].filter((t) => !ordem.includes(t)).sort();
  return [...ordenados, ...extras];
}

export type Pendente = { variante_numero: number; tamanho: string; real: number; plano: number };
export type Preenchimento = {
  linhas: Record<number, Record<string, Record<string, number>>>;
  pendentes: Pendente[];
  doPlano: string[];
  escritas: string[];
};

/** Regra do semi-preenchimento (R22), por variante × tamanho da Grade Real, só nas lojas EDITÁVEIS daquela variante:
 *  Σ plano = real ⇒ cada loja recebe o plano (0 onde a loja não tem a cor); ≠ ⇒ a célula fica VAZIA em todas as lojas
 *  (pendente — "distribua à mão"). Nunca inventa rateio. `escritas` = todas as células tocadas (o merge 3-vias as trata
 *  como minhas); `doPlano` = as que o plano preencheu (azul-claro até editar). */
export function preencherComPlano(a: {
  variantes: { variante_numero: number; real: Record<string, number> }[];
  tamanhos: string[];
  lojas: { id: string }[];
  podeEditar: (lojaId: string, vnum: number) => boolean;
  plano: PlanoModelo | null;
}): Preenchimento {
  const linhas: Preenchimento["linhas"] = {};
  const pendentes: Pendente[] = [];
  const doPlano: string[] = [];
  const escritas: string[] = [];
  for (const v of a.variantes) {
    const vn = v.variante_numero;
    const editaveis = a.lojas.map((l) => l.id).filter((id) => a.podeEditar(id, vn));
    linhas[vn] = {};
    for (const t of a.tamanhos) {
      const real = Number(v.real?.[t] ?? 0) || 0;
      const plano = editaveis.reduce((s, id) => s + (celulaPlano(a.plano, id, vn, t) ?? 0), 0);
      if (real === plano) {
        for (const id of editaveis) {
          (linhas[vn][id] ??= {})[t] = celulaPlano(a.plano, id, vn, t) ?? 0;
          doPlano.push(pathDirCel(vn, id, t));
          escritas.push(pathDirCel(vn, id, t));
        }
      } else {
        pendentes.push({ variante_numero: vn, tamanho: t, real, plano });
        for (const id of editaveis) escritas.push(pathDirCel(vn, id, t));
      }
    }
  }
  return { linhas, pendentes, doPlano, escritas };
}

/** Nota por pendência (mockup). */
export const textoPendencia = (rotulo: string, p: Pendente): string =>
  `${rotulo}: plano ${p.plano} · real ${p.real} → distribua à mão as ${p.real} peças entre as lojas. Nenhuma loja veio preenchida porque não dá para saber de qual tirar.`;
```

- [ ] **Step 3: `src/components/direcionamento/PlanoDoModeloCard.tsx` (novo)**

```tsx
// Distribuição por produto → Direcionamento: card "Plano de distribuição do modelo" (spec §5.3, R34). Só leitura — o plano
// SALVO do Plan. Tecido (loja × variante × tamanho). "Preencher com o plano" só mexe no RASCUNHO da tela (R22).
import { Fragment } from "react";
import { Wand2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { TEXTO_MOTIVO_SEM_PLANO, celulaPlano, totalPlanoVariante, type MotivoSemPlano, type PlanoModelo } from "@/lib/direcionamento-plano";

const CEL = "border px-2 py-1 text-center";
const COL1 = "sticky left-0 z-10 border px-2 py-1 text-left";

export function PlanoDoModeloCard({ plano, motivo, tamanhos, rotuloTam, rotuloVariante, podePreencher, onPreencher }: {
  plano: PlanoModelo | null;
  motivo: MotivoSemPlano | null;
  tamanhos: string[];
  rotuloTam: (t: string) => string;
  rotuloVariante: (vnum: number) => string;
  podePreencher: boolean;
  onPreencher: () => void;
}) {
  const vnums = (plano?.variantes ?? []).filter((v) => v.variante_numero != null).map((v) => v.variante_numero as number);
  const totalTam = (t: string) => vnums.reduce((s, vn) => s + (totalPlanoVariante(plano, vn).porTamanho[t] ?? 0), 0);
  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-display text-base font-semibold">Plano de distribuição do modelo</h2>
        <StatusBadge tone="neutral">só leitura</StatusBadge>
        <span className="text-xs text-muted-foreground">do Plan. Tecido › Distribuir por loja</span>
        {plano && (
          <Button variant="outline" size="sm" className="ml-auto max-sm:h-11" onClick={onPreencher} disabled={!podePreencher}
            title="Reaplica a regra: preenche onde bate com a Grade Real">
            <Wand2 className="mr-1 h-4 w-4" />Preencher com o plano
          </Button>
        )}
      </div>
      {!plano ? (
        <p className="text-sm text-muted-foreground">Sem plano — {TEXTO_MOTIVO_SEM_PLANO[motivo ?? "sem_distribuicao"]}.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] border-collapse text-sm tabular-nums" aria-label="Plano de distribuição do modelo">
              <thead className="bg-muted/50">
                <tr>
                  <th className={`${COL1} bg-muted/50`}>Loja / Variante</th>
                  {tamanhos.map((t) => <th key={t} className={CEL}>{rotuloTam(t)}</th>)}
                  <th className={CEL}>Total</th>
                </tr>
              </thead>
              <tbody>
                {plano.lojas.map((l) => {
                  const sub = tamanhos.map((t) => vnums.reduce((s, vn) => s + (celulaPlano(plano, l.loja_id, vn, t) ?? 0), 0));
                  return (
                    <Fragment key={l.loja_id}>
                      <tr className={`bg-muted/30 font-semibold ${l.ativo ? "" : "opacity-60"}`}>
                        <td className={`${COL1} bg-muted/30`}>{l.nome}{l.ativo ? "" : " (inativa)"}</td>
                        {sub.map((q, i) => <td key={tamanhos[i]} className={CEL}>{q}</td>)}
                        <td className={CEL}>{sub.reduce((s, q) => s + q, 0)}</td>
                      </tr>
                      {vnums.map((vn) => {
                        const tem = plano.celulas.some((c) => c.loja_id === l.loja_id && c.variante_numero === vn);
                        const qs = tamanhos.map((t) => celulaPlano(plano, l.loja_id, vn, t) ?? 0);
                        return (
                          <tr key={vn}>
                            <td className={`${COL1} bg-background pl-4`}>{rotuloVariante(vn)}</td>
                            {qs.map((q, i) => <td key={tamanhos[i]} className={`${CEL} text-muted-foreground`}>{tem ? q : "—"}</td>)}
                            <td className={CEL}>{tem ? qs.reduce((s, q) => s + q, 0) : "—"}</td>
                          </tr>
                        );
                      })}
                    </Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="font-semibold">
                  <td className={`${COL1} bg-background`}>Total do plano</td>
                  {tamanhos.map((t) => <td key={t} className={CEL}>{totalTam(t)}</td>)}
                  <td className={CEL}>{tamanhos.reduce((s, t) => s + totalTam(t), 0)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          {plano.sem_correspondencia.length > 0 && (
            <p className="text-xs text-amber-700">
              Cor do plano sem variante neste modelo (ex.: cor planejada) — fica fora do preenchimento:{" "}
              {plano.sem_correspondencia.map((s) => `${[s.cor_nome, s.apelido_nome].filter(Boolean).join(" · ") || "—"} (${s.total})`).join(", ")}.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            O plano é o que foi distribuído no Plan. Tecido (com as correções feitas à mão). “Preencher com o plano” reaplica a regra abaixo, para recomeçar.
          </p>
        </>
      )}
    </Card>
  );
}
```

- [ ] **Step 4: Teste de FONTE da tela (falha)** — `tests/unit/direcionamento-plano-fonte.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const tela = readFileSync(ROOT + "src/routes/_authenticated/expedicao.direcionamento.$modeloId.tsx", "utf8");
const conta = (s: string) => tela.split(s).length - 1;

describe("Direcionamento — plano do modelo (Task 7)", () => {
  it("lê a RPC nova e não a antiga (P-14/P-16)", () => {
    expect(tela).toContain('"direcionamento_plano_modelo"');
    expect(tela).toContain('["dir-plano-modelo", modeloId]');
    expect(tela).not.toContain("direcionamento_resumo_subcolecao");
    expect(tela).not.toContain("dir-resumo-subcol");
    expect(tela).not.toContain("OrcamentoTag");
  });
  it("servidor intocado (#10): mesmo payload de estado completo no Salvar e no Confirmar", () => {
    expect(conta("_rows: buildRows(), _rev_base: { dir: revRef.current }")).toBe(2);
  });
  it("presença: TODA célula digitável (pré-preenchida ou vazia) mantém data-colab-path dir:… (desktop e mobile)", () => {
    expect(conta("<NumberInput")).toBe(2);
    expect(conta("data-colab-path={`dir:${v.variante_numero}:${l.id}:${t}`}")).toBe(2);
    expect(tela).toContain("placeholder={est.placeholder}");
  });
  it("rascunho do plano conta como MINHA edição (merge 3-vias) e como alteração não salva (mockup)", () => {
    expect(tela).toContain("touchedRef.current = new Set(p?.escritas ?? []);");
    expect(tela).toContain("resetBaseline(obj);");
    expect(tela).toContain("setState(p ? p.obj : obj);");
  });
  it("textos: Grade Real com InfoHover, 'faltam N', callout e 'Preencher com o plano?'", () => {
    expect(tela).toContain("Grade Real = o que voltou da recepção dos serviços, já sem os defeitos do CQ.");
    expect(tela).toContain("`faltam ${-d.delta}`");
    expect(tela).toContain("Preenchido pelo plano onde bateu com a Grade Real");
    expect(tela).toContain("Preencher com o plano?");
    expect(tela).toContain("modelos direcionados");
  });
});
```

- [ ] **Step 5: `src/routes/_authenticated/expedicao.direcionamento.$modeloId.tsx` (trocas pontuais)**

(a) Imports: trocar `import { ArrowLeft, Compass, Save, CheckCircle2, RotateCcw, Pencil, Printer } from "lucide-react";` por `import { ArrowLeft, Compass, Save, CheckCircle2, RotateCcw, Pencil, Printer, AlertTriangle } from "lucide-react";`; APAGAR as linhas `import { useTenantModules } from "@/hooks/useTenantModules";` e `import { OrcamentoTag } from "@/components/otb/orcamento";`; acrescentar:

```ts
import { InfoHover } from "@/components/shared/InfoHover";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ladoTamanho } from "@/lib/tamanho";
import { tipoDoProduto } from "@/lib/distribuicao-produto";
import { preencherComPlano, tamanhosDoPlano, textoPendencia, totalPlanoVariante, type Pendente, type PlanoModeloResp } from "@/lib/direcionamento-plano";
import { PlanoDoModeloCard } from "@/components/direcionamento/PlanoDoModeloCard";

const TEXTO_GRADE_REAL = "Grade Real = o que voltou da recepção dos serviços, já sem os defeitos do CQ.";
```

(b) Query do modelo: trocar `select("id, ref, nome, colecao, subcolecao, semana, origem, fotos_modelo,` por `select("id, ref, nome, colecao, subcolecao, semana, origem, tamanho_tipo, fotos_modelo,`.

(c) Trocar o bloco da tira antiga (do comentário `// Resumo "direcionados / planejado" da subcoleção (tira no topo).` até `const mostrarTotal = distribOn && (resumoSub?.planejado ?? 0) > 0;`, inclusive) por:

```ts
  // Distribuição por produto (spec R21/R38): plano SALVO do Plan. Tecido para ESTE modelo + "X modelos direcionados" da
  // subcoleção. Substitui a tira global antiga (RPC direcionamento_resumo_subcolecao, apagada na remoção). O plano é
  // REFERÊNCIA — nenhum gate lê isto (invariante #10).
  const { data: planoResp, isFetched: planoFetched } = useQuery({
    queryKey: ["dir-plano-modelo", modeloId],
    enabled: !!modelo,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("direcionamento_plano_modelo", { _modelo_id: modeloId });
      if (error) throw error;
      return data as PlanoModeloResp;
    },
  });
  const plano = planoResp?.plano ?? null;
  const tipoTam = tipoDoProduto(plano?.tamanho_tipo ?? (modelo as any)?.tamanho_tipo);
  const rotuloTam = (t: string) => ladoTamanho(t, tipoTam) ?? t;
  // Semi-preenchimento (R22): pendências (cor × tamanho que não bateu) e células vindas do plano (azul-claro até editar).
  const [preench, setPreench] = useState<{ aplicado: boolean; pendentes: Pendente[]; doPlano: Set<string> }>({ aplicado: false, pendentes: [], doPlano: new Set() });
  const [confirmarPreencher, setConfirmarPreencher] = useState(false);
```

(d) Lojas: trocar `const { data: lojas = [] } = useQuery({` (o da query `["dir-lojas", tenantId]`) por `const { data: lojas = [], isFetched: lojasFetched } = useQuery({`.

(e) Trocar `const dataSettled = gradesFetched && !gradesFetching && existingFetched && !existingFetching;` por:

```ts
  const dataSettled = gradesFetched && !gradesFetching && existingFetched && !existingFetching && planoFetched && lojasFetched;
```

(f) Logo ANTES do `useEffect` de hidratação (o que começa com `if (hydrated || !cad?.id) return;`), acrescentar:

```ts
  // Regra do preenchimento sobre um estado (R22): só lojas EDITÁVEIS da variante (ativa, ou inativa com par histórico).
  const aplicarPlano = (base: Record<number, VarState>) => {
    const r = preencherComPlano({
      variantes: Object.values(base).map((v) => ({ variante_numero: v.variante_numero, real: v.real })),
      tamanhos,
      lojas: lojasVisiveis.map((l) => ({ id: l.id })),
      podeEditar: (lojaId, vnum) => {
        const l = lojasVisiveis.find((x) => x.id === lojaId);
        return !!l && (l.ativo || paresHistoricos.has(`${lojaId}:${vnum}`));
      },
      plano,
    });
    const obj: Record<number, VarState> = {};
    for (const v of Object.values(base)) obj[v.variante_numero] = { ...v, linhas: r.linhas[v.variante_numero] ?? {} };
    return { obj, pendentes: r.pendentes, doPlano: r.doPlano, escritas: r.escritas };
  };
```

(g) No fim do `useEffect` de hidratação, trocar

```ts
    setState(obj);
    // Re-baseline o guarda de alterações a partir do estado semeado (passa o valor
    // explícito — o estado recém-setado ainda está stale neste tick).
    resetBaseline(obj);
    // Baseline do MERGE: o que acabou de vir do servidor é a base 3-vias + zera o "tocado".
    baseGradeRef.current = stateToGradeDir(obj);
    touchedRef.current = new Set();
    setHydrated(true);
  }, [cadGrades, existing, cad?.id, hydrated, dataSettled]);
```

por

```ts
    // Distribuição por produto (R22/P-12): sem direcionamento salvo, ainda pendente e editável ⇒ abre SEMI-PREENCHIDO pelo
    // plano. É RASCUNHO: a base (guarda de "não salvo" e merge 3-vias) continua sendo o estado do SERVIDOR — o
    // preenchimento conta como alteração minha (mockup: "alterações não salvas"; P-32).
    const preencher = !!plano && (existing as any[]).length === 0 && (cad as any)?.direcionamento_status !== "separado" && !readOnly;
    const p = preencher ? aplicarPlano(obj) : null;
    setState(p ? p.obj : obj);
    // Re-baseline o guarda de alterações a partir do estado semeado (passa o valor
    // explícito — o estado recém-setado ainda está stale neste tick).
    resetBaseline(obj);
    // Baseline do MERGE: o que veio do servidor é a base 3-vias; o "tocado" = as células que o preenchimento escreveu.
    baseGradeRef.current = stateToGradeDir(obj);
    touchedRef.current = new Set(p?.escritas ?? []);
    setPreench(p ? { aplicado: true, pendentes: p.pendentes, doPlano: new Set(p.doPlano) } : { aplicado: false, pendentes: [], doPlano: new Set() });
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cadGrades, existing, cad?.id, hydrated, dataSettled, plano, readOnly]);
```

(h) `setQtd` — trocar a linha `touchedRef.current.add(pathDirCel(num, lojaId, tam)); // p/ o merge saber o que EU editei` por:

```ts
    const path = pathDirCel(num, lojaId, tam);
    touchedRef.current.add(path); // p/ o merge saber o que EU editei
    setPreench((p) => (p.doPlano.has(path) ? { ...p, doPlano: new Set([...p.doPlano].filter((x) => x !== path)) } : p));
```

e, logo DEPOIS da função `setQtd`, acrescentar:

```ts
  // "Preencher com o plano" (R22): reaplica a regra sobre o rascunho (AlertDialog se já há número digitado).
  const temNumero = Object.values(state).some((v) => Object.values(v.linhas).some((g) => Object.values(g ?? {}).some((q) => Number(q) > 0)));
  const preencherAgora = () => {
    const r = aplicarPlano(state);
    setState(r.obj);
    for (const p of r.escritas) touchedRef.current.add(p);
    setPreench({ aplicado: true, pendentes: r.pendentes, doPlano: new Set(r.doPlano) });
  };
  // Estado visual da célula (R22): pendente = cor × tamanho que não bateu e ainda vazia; doPlano = veio do plano sem edição.
  const estadoCel = (vn: number, lojaId: string, t: string, valor: number | undefined) => {
    const pendente = valor === undefined && preench.pendentes.some((p) => p.variante_numero === vn && p.tamanho === t);
    const doPlano = preench.doPlano.has(pathDirCel(vn, lojaId, t));
    return {
      classe: pendente ? "bg-amber-50 placeholder:text-amber-700" : doPlano ? "bg-sky-50" : "",
      placeholder: pendente ? "–" : "0",
      title: pendente ? "Distribua à mão" : undefined,
    };
  };
  const nomeCorVariante = (vn: number) => plano?.variantes.find((x) => x.variante_numero === vn)?.cor_nome ?? `Variante ${vn}`;
```

(i) Invalidações: nas 2 ocorrências de `await qc.invalidateQueries({ queryKey: ["dir-resumo-subcol", modeloId] });` (confirmar e desmarcar), trocar por `await qc.invalidateQueries({ queryKey: ["dir-plano-modelo", modeloId] });`.

(j) Motivo do rodapé — trocar

```ts
      const m = motivoNaoConfere(diffPorTamanho(v.real, Object.values(v.linhas), tamanhos));
```

por

```ts
      const m = motivoNaoConfere(diffPorTamanho(v.real, Object.values(v.linhas), tamanhos).map((d) => ({ ...d, tamanho: rotuloTam(d.tamanho) })));
```

e o array de dependências desse `useMemo` `[variantes, tamanhos, labelByNumero]` por `[variantes, tamanhos, labelByNumero, tipoTam]` (com `// eslint-disable-next-line react-hooks/exhaustive-deps` na linha de cima).

(k) Render — trocar o bloco inteiro `{resumoSub && subcolecao?.trim() && ( <Card className="p-4 space-y-3"> … </Card> )}` (com o comentário de cima, `{/* Resumo da subcoleção: …`) por:

```tsx
      {/* Distribuição por produto (P-16 = C): só "X modelos direcionados" da subcoleção (sai o /Y e a tira global). */}
      {planoResp?.subcolecao && (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
          <div><span className="text-muted-foreground">Subcoleção </span><span className="font-medium">{planoResp.subcolecao}</span></div>
          <div>
            <span className="font-semibold tabular-nums">{planoResp.direcionados}</span>
            <span className="text-muted-foreground"> {planoResp.direcionados === 1 ? "modelo direcionado" : "modelos direcionados"}</span>
          </div>
        </Card>
      )}
      {planoResp && (
        <PlanoDoModeloCard
          plano={plano}
          motivo={planoResp.motivo_sem_plano}
          tamanhos={tamanhosDoPlano(plano?.tamanhos ?? tamanhos, tamanhos, plano)}
          rotuloTam={rotuloTam}
          rotuloVariante={(vn) => labelByNumero[vn] ?? `Variante ${vn}`}
          podePreencher={editavel && variantes.length > 0}
          onPreencher={() => (temNumero ? setConfirmarPreencher(true) : preencherAgora())}
        />
      )}
      {preench.aplicado && plano && (() => {
        const realTotal = variantes.reduce((s, v) => s + tamanhos.reduce((a, t) => a + (Number(v.real?.[t]) || 0), 0), 0);
        const planoTotal = variantes.reduce((s, v) => s + totalPlanoVariante(plano, v.variante_numero).total, 0);
        const lista = preench.pendentes.map((p) => `${nomeCorVariante(p.variante_numero)} ${rotuloTam(p.tamanho)} (${p.real} peças)`).join(" e ");
        return (
          <Card className="flex gap-2 border-amber-500/50 bg-amber-500/10 p-4 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <p>
              <b>Preenchido pelo plano onde bateu com a Grade Real</b> (rascunho — nada foi salvo; células em azul-claro vieram do plano).
              {" "}A <b>Grade Real</b> é o que voltou da <b>recepção dos serviços</b>, já sem os defeitos do CQ: <b>{realTotal}</b> peças, contra <b>{planoTotal}</b> do plano.
              {preench.pendentes.length > 0 ? (
                <>{" "}Onde cor × tamanho não bateu, a coluna ficou vazia (–) em todas as lojas, porque não dá para saber de qual loja tirar. É aqui que a diferença entre plano e realidade se acerta: <b>distribua à mão as colunas vazias</b> — <b>{lista}</b>.</>
              ) : (
                <>{" "}Tudo bateu com a Grade Real.</>
              )}
              {" "}O Confirmar continua exigindo Σ Direcionado = Grade Real em cada tamanho.
            </p>
          </Card>
        );
      })()}
```

(l) Cabeçalho do card da variante — trocar `<div className="text-xs text-muted-foreground">Grade Real Total: <strong>{realTotal}</strong></div>` por:

```tsx
              <div className="text-xs text-muted-foreground">
                Grade Real Total: <strong>{realTotal}</strong>
                {plano && <span> · plano {totalPlanoVariante(plano, v.variante_numero).total}</span>}
              </div>
```

(m) Tabela desktop — cabeçalho: trocar `{tamanhos.map((t) => <th key={t} className="border px-2 py-1 text-center w-20">{t}</th>)}` por `{tamanhos.map((t) => <th key={t} className="border px-2 py-1 text-center w-20">{rotuloTam(t)}</th>)}`. Linha "Grade Real": trocar

```tsx
                    <td className="border px-2 py-1 font-medium">Grade Real</td>
                    {tamanhos.map((t) => (
                      <td key={t} className="border px-2 py-1 text-center bg-muted/30">{Number(v.real?.[t] ?? 0)}</td>
                    ))}
```

por

```tsx
                    <td className="border px-2 py-1 font-medium">
                      <span className="inline-flex items-center gap-1">Grade Real<InfoHover ariaLabel="O que é a Grade Real">{TEXTO_GRADE_REAL}</InfoHover></span>
                    </td>
                    {tamanhos.map((t) => {
                      const real = Number(v.real?.[t] ?? 0);
                      const pt = plano ? (totalPlanoVariante(plano, v.variante_numero).porTamanho[t] ?? 0) : null;
                      return (
                        <td key={t} className="border px-2 py-1 text-center bg-muted/30">
                          {real}
                          {pt !== null && pt !== real && <small className="block text-[10px] text-amber-700">plano {pt}</small>}
                        </td>
                      );
                    })}
```

Célula da loja (desktop): trocar

```tsx
                        {tamanhos.map((t) => (
                          <td key={t} className="border p-0">
                            <NumberInput
                              integer blankZero placeholder="0" min={0}
                              className="h-8 max-md:h-11 border-0 bg-transparent text-center"
                              value={grades[t] ?? ""}
                              disabled={!editavelLinha}
                              data-colab-path={`dir:${v.variante_numero}:${l.id}:${t}`}
                              title={editavelLinha ? undefined : "Loja desativada — reative no Cadastro de Lojas para direcionar aqui."}
                              onChange={(e) => setQtd(v.variante_numero, l.id, t, Math.max(0, Number(e.target.value) || 0))}
                            />
                          </td>
                        ))}
```

por

```tsx
                        {tamanhos.map((t) => {
                          const est = estadoCel(v.variante_numero, l.id, t, grades[t]);
                          return (
                            <td key={t} className="border p-0">
                              <NumberInput
                                integer blankZero placeholder={est.placeholder} min={0}
                                className={`h-8 max-md:h-11 border-0 bg-transparent text-center ${est.classe}`}
                                value={grades[t] ?? ""}
                                disabled={!editavelLinha}
                                data-colab-path={`dir:${v.variante_numero}:${l.id}:${t}`}
                                title={editavelLinha ? est.title : "Loja desativada — reative no Cadastro de Lojas para direcionar aqui."}
                                onChange={(e) => setQtd(v.variante_numero, l.id, t, Math.max(0, Number(e.target.value) || 0))}
                              />
                            </td>
                          );
                        })}
```

Σ Direcionado (desktop): trocar `<span className="block text-[10px] font-normal">({d.delta > 0 ? `+${d.delta}` : d.delta})</span>` por `<span className="block text-[10px] font-normal">{d.delta < 0 ? `faltam ${-d.delta}` : `${d.delta} a mais`}</span>`.

(n) Mobile — trocar `<div className="mb-1 border-b pb-1 text-center text-xs font-semibold">{t}</div>` por `<div className="mb-1 border-b pb-1 text-center text-xs font-semibold">{rotuloTam(t)}</div>`; trocar `<span className="text-muted-foreground">Grade Real</span>` por `<span className="inline-flex items-center gap-1 text-muted-foreground">Grade Real<InfoHover ariaLabel="O que é a Grade Real">{TEXTO_GRADE_REAL}</InfoHover></span>`; no `NumberInput` do mobile, trocar

```tsx
                          <NumberInput
                            integer blankZero placeholder="0" min={0}
                            className="h-9 max-md:h-11 text-center"
                            value={v.linhas[l.id]?.[t] ?? ""}
                            disabled={!editavelLinha}
                            data-colab-path={`dir:${v.variante_numero}:${l.id}:${t}`}
                            title={editavelLinha ? undefined : "Loja desativada — reative no Cadastro de Lojas para direcionar aqui."}
```

por

```tsx
                          <NumberInput
                            integer blankZero placeholder={estadoCel(v.variante_numero, l.id, t, v.linhas[l.id]?.[t]).placeholder} min={0}
                            className={`h-9 max-md:h-11 text-center ${estadoCel(v.variante_numero, l.id, t, v.linhas[l.id]?.[t]).classe}`}
                            value={v.linhas[l.id]?.[t] ?? ""}
                            disabled={!editavelLinha}
                            data-colab-path={`dir:${v.variante_numero}:${l.id}:${t}`}
                            title={editavelLinha ? estadoCel(v.variante_numero, l.id, t, v.linhas[l.id]?.[t]).title : "Loja desativada — reative no Cadastro de Lojas para direcionar aqui."}
```

e trocar `{d.direcionado}{d.delta !== 0 ? ` (${d.delta > 0 ? "+" : ""}${d.delta})` : ""}` por `{d.direcionado}{d.delta < 0 ? ` · faltam ${-d.delta}` : d.delta > 0 ? ` · ${d.delta} a mais` : ""}`. (Obs.: o teste de fonte procura `placeholder={est.placeholder}` — ele está no desktop; no mobile o `estadoCel(…)` é chamado inline.)

(o) Nota por pendência — logo DEPOIS da `<div className="md:hidden flex justify-between border-t pt-2 text-xs text-muted-foreground">…</div>` do card da variante, acrescentar:

```tsx
            {preench.pendentes
              .filter((p) => p.variante_numero === v.variante_numero && Object.values(v.linhas).every((g) => g?.[p.tamanho] === undefined))
              .map((p) => (
                <p key={p.tamanho} className="flex gap-1 text-xs text-amber-700">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /><span>{textoPendencia(rotuloTam(p.tamanho), p)}</span>
                </p>
              ))}
```

(p) Confirmação do "Preencher com o plano" — logo ANTES de `<RomaneioDirecionamento`, acrescentar:

```tsx
      {confirmarPreencher && (
        <AlertDialog open onOpenChange={(o) => !o && setConfirmarPreencher(false)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Preencher com o plano?</AlertDialogTitle>
              <AlertDialogDescription>
                Isso troca os números digitados pelo plano onde ele bate com a Grade Real e deixa vazias as colunas que não batem. Nada é salvo até você clicar em Salvar.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={() => { setConfirmarPreencher(false); preencherAgora(); }}>Preencher</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
```

- [ ] **Step 6: Rodar e ver passar**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/distribuicao-produto"
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres npx vitest run tests/unit/direcionamento-plano.test.ts tests/unit/direcionamento-plano-fonte.test.ts tests/unit/direcionamento-diff.test.ts tests/unit/colab-merge-grade-dir.test.ts 2>&1 | tail -8
npx tsc --noEmit 2>&1 | tail -5
```

Expected: PASS; `tsc` limpo (conferir que `subcolecao`/`resumoSub`/`mostrarTotal`/`distribOn` não sobraram — o `tsc` acusa).

- [ ] **Step 7: Gates e commit**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/distribuicao-produto"
bash .superpowers/distribuicao/gates.sh
git add -- src/lib/direcionamento-plano.ts src/components/direcionamento/PlanoDoModeloCard.tsx 'src/routes/_authenticated/expedicao.direcionamento.$modeloId.tsx' tests/unit/direcionamento-plano.test.ts tests/unit/direcionamento-plano-fonte.test.ts
git commit --only -m "feat(direcionamento): plano do modelo (Plan. Tecido), 'X modelos direcionados' e semi-preenchimento do rascunho (T7)" \
  -m "RPC direcionamento_plano_modelo; regra: bate ⇒ plano, não bate ⇒ vazio em todas as lojas; servidor intocado (#10); rótulos de tamanho pelo 'Tamanho em'. Plano 2026-09-25, Task 7." \
  -m "Co-Authored-By: Claude <seu modelo real> <noreply@anthropic.com>" \
  -- src/lib/direcionamento-plano.ts src/components/direcionamento/PlanoDoModeloCard.tsx 'src/routes/_authenticated/expedicao.direcionamento.$modeloId.tsx' tests/unit/direcionamento-plano.test.ts tests/unit/direcionamento-plano-fonte.test.ts
git show --stat HEAD
```

- [ ] **Step 8: Revisão individual Opus** — invariante #10 (payload/estado completo, loja ativa/par histórico, Confirmar exige Σ = real, `buildRows` intocado), merge 3-vias (base = servidor; `touched` = escritas; `existing` refetch não apaga o rascunho), a regra × lib × mockup, prefill só sem linha salva e não 'separado' e editável, `["dir-plano-modelo"]` único, mobile (tabela do plano com rolagem própria), nada de `components/producao/**` tocado.

---
## Task 8: Tirar a página antiga "Distribuição" (front) — o módulo fica como gate  *(individual Opus, curta)*

**Files:**
- Delete: `src/routes/_authenticated/distribuicao.index.tsx`, `src/components/distribuicao/DistribuicaoTabela.tsx`, `src/components/distribuicao/ResumoColecao.tsx`, `src/lib/distribuicao.ts`, `tests/unit/distribuicao.test.ts`
- Modify: `src/lib/nav.ts`, `src/lib/permissions-catalog.ts`, `src/components/app-sidebar.tsx`, `src/hooks/useTenantModules.ts`, `src/routes/_authenticated/admin/lojas.tsx`, `src/routeTree.gen.ts` (regerado pelo build)
- Test: `tests/unit/distribuicao-remocao.test.ts`

**Interfaces:** nenhuma nova. O `ModuleKey` `"distribuicao"` continua (gate das Tasks 5–7).

- [ ] **Step 1: Teste de FONTE (falha)** — `tests/unit/distribuicao-remocao.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const ler = (r: string) => readFileSync(ROOT + r, "utf8");
function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? arquivos(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}

describe("Distribuição antiga — página removida, módulo continua (P-14 / R28)", () => {
  it("os arquivos da página antiga não existem", () => {
    for (const f of ["src/routes/_authenticated/distribuicao.index.tsx", "src/components/distribuicao/DistribuicaoTabela.tsx",
      "src/components/distribuicao/ResumoColecao.tsx", "src/lib/distribuicao.ts"]) expect(existsSync(ROOT + f), f).toBe(false);
  });
  it("nav, catálogo, sidebar e routeTree não citam a página", () => {
    expect(ler("src/lib/nav.ts")).not.toMatch(/distribuicao/);
    expect(ler("src/lib/permissions-catalog.ts")).not.toMatch(/module: "distribuicao"|basePath: "\/distribuicao"/);
    expect(ler("src/components/app-sidebar.tsx")).not.toContain('"/distribuicao"');
    expect(ler("src/routeTree.gen.ts")).not.toMatch(/distribuicao/i);
  });
  it("ninguém importa a lib/os componentes antigos", () => {
    const sujos = arquivos(ROOT + "src").filter((f) => /from "@\/lib\/distribuicao"|components\/distribuicao\//.test(readFileSync(f, "utf8")));
    expect(sujos).toEqual([]);
  });
  it("o módulo 'distribuicao' continua: opt-in no front e ligável em Gerenciar Lojas", () => {
    const tm = ler("src/hooks/useTenantModules.ts");
    expect(tm).toMatch(/\| "distribuicao"/);
    expect(tm).toMatch(/distribuicao: false/);
    expect(tm).toContain('distribuicao: "/criacao/plan-tecido"');
    const lj = ler("src/routes/_authenticated/admin/lojas.tsx");
    expect(lj).toContain('out.push({ key: "distribuicao", label: "Distribuição por produto" });');
    expect(lj).toMatch(/distribuicao: false/);
  });
});
```

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/distribuicao-produto"
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres npx vitest run tests/unit/distribuicao-remocao.test.ts 2>&1 | tail -5
```

Expected: FAIL (os arquivos existem).

- [ ] **Step 2: Apagar os 5 arquivos**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/distribuicao-produto"
git rm -q -- src/routes/_authenticated/distribuicao.index.tsx src/components/distribuicao/DistribuicaoTabela.tsx src/components/distribuicao/ResumoColecao.tsx src/lib/distribuicao.ts tests/unit/distribuicao.test.ts
git status --short
```

- [ ] **Step 3: Trocas pontuais**

- `src/lib/nav.ts`: apagar a linha `  distribuicao: { title: "Distribuição", icon: BarChart3 },` (o `BarChart3` continua usado pelo Dashboard).
- `src/lib/permissions-catalog.ts`: apagar o `ModuleDef` inteiro de `distribuicao` (do comentário `// Módulo de página única (padrão OTB), opt-in. Fica no sidebar entre Estilo & Engenharia e` até o `},` que fecha o objeto com `module: "distribuicao"`).
- `src/components/app-sidebar.tsx`: apagar as 3 linhas

```ts
  // Distribuição fica logo ABAIXO de Estilo & Engenharia (entre criacao e entrada_saida): sobe
  // ANTES de criacao, depois criacao/otb sobem por cima → ordem final [otb, criacao, distribuicao, …].
  moveTop("/distribuicao");
```

- `src/hooks/useTenantModules.ts`: trocar `  distribuicao: "/distribuicao",` (em `MODULE_BASE_PATH`) por

```ts
  // Distribuição por produto (set/2026): sem tela própria — é gate do "Distribuir por loja" (Plan. Tecido) e do plano no
  // Direcionamento; a entrada existe só p/ o Record ficar exaustivo (fora do LANDING_ORDER).
  distribuicao: "/criacao/plan-tecido",
```

- `src/routes/_authenticated/admin/lojas.tsx`: depois de `  out.push({ key: "etapas_pl", label: "Etapas PL (kanban)" });` acrescentar

```ts
  // Distribuição por produto (set/2026): o ModuleDef/página saiu do catálogo — o toggle continua à mão (gate do dialog).
  out.push({ key: "distribuicao", label: "Distribuição por produto" });
```

e trocar `  distribuicao: "Distribuição por loja e poder de venda (resumo da coleção + tabelas).",` (em `MODULE_DESC`) por `  distribuicao: "Distribuir por loja (por produto) no Plan. Tecido + plano do modelo no Direcionamento.",`.

- [ ] **Step 4: Regerar o `routeTree` e pôr no índice ANTES dos gates**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/distribuicao-produto"
npm run build > .superpowers/distribuicao/logs/build-t8.log 2>&1; tail -3 .superpowers/distribuicao/logs/build-t8.log
grep -c distribuicao src/routeTree.gen.ts
git add -- src/routeTree.gen.ts
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres npx vitest run tests/unit/distribuicao-remocao.test.ts 2>&1 | tail -5
```

Expected: build ok; `0`; teste PASS.

- [ ] **Step 5: Gates e commit**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/distribuicao-produto"
bash .superpowers/distribuicao/gates.sh
git add -- src/lib/nav.ts src/lib/permissions-catalog.ts src/components/app-sidebar.tsx src/hooks/useTenantModules.ts src/routes/_authenticated/admin/lojas.tsx tests/unit/distribuicao-remocao.test.ts
git commit --only -m "refactor(distribuicao): sai a página antiga (rota, sidebar, nav, catálogo, routeTree); o módulo fica como gate (T8)" \
  -m "Toggle 'Distribuição por produto' à mão em Gerenciar Lojas; base path → Plan. Tecido. Tabelas/RPCs antigas saem na migration 20261006110000 (depois do deploy). Plano 2026-09-25, Task 8." \
  -m "Co-Authored-By: Claude <seu modelo real> <noreply@anthropic.com>" \
  -- src/routes/_authenticated/distribuicao.index.tsx src/components/distribuicao/DistribuicaoTabela.tsx src/components/distribuicao/ResumoColecao.tsx src/lib/distribuicao.ts tests/unit/distribuicao.test.ts src/lib/nav.ts src/lib/permissions-catalog.ts src/components/app-sidebar.tsx src/hooks/useTenantModules.ts src/routes/_authenticated/admin/lojas.tsx src/routeTree.gen.ts tests/unit/distribuicao-remocao.test.ts
git show --stat HEAD
```

Obs.: a linha de base de falhas unit (`unit-fail-base.txt`) pode conter `tests/unit/distribuicao.test.ts` se ele falhava; se o `gates.sh` acusar "falhas ≠ linha de base" SÓ por esse arquivo apagado, regravar a linha de base sem ele (`grep -v distribuicao.test.ts`) e registrar em `desvios.md`.

- [ ] **Step 6: Revisão individual Opus (curta)** — nada órfão (imports, `MODULE_META`, `PAGE_URLS`), o módulo continua ligável/desligável pelo super_admin, `MODULE_DEFAULTS.distribuicao=false`, `routeTree` sem a rota, Config da Loja não tocada.

---
## Task 9: Migration de REMOÇÃO `20261006110000` (Distribuição antiga) + inverso + medição de travas + suíte  *(G-migration B: 2 Opus independentes + guardião)*

**Files:**
- Create (não versionado): `.superpowers/distribuicao/mig/dump_remocao.sh`, `.superpowers/distribuicao/mig/gerar_remocao.py`, `.superpowers/distribuicao/travas-drop.txt`
- Create (gerados): `supabase/migrations/20261006110000_distribuicao_antiga_remover.sql`, `supabase/rollback/20261006110000_distribuicao_antiga_remover_down.sql`
- Test: `tests/integration/distribuicao-antiga-remover.test.ts`

**Interfaces:**
- Consumes: a aditiva (Task 4 — a remoção EXIGE `direcionamento_plano_modelo` no banco); a migration ORIGINAL `supabase/migrations/20260922120000_distribuicao.sql` (DDL da tabela, por âncoras — 1× cada, conferidas no planejamento).
- Produces (Tasks 10, 11): `md5-antigas-antes.txt` (4 md5, ordem `resumo_subcol|resumo|salvar_tab|excluir_tab`); contagem −4 funções/−1 gatilho; confirmação `app.confirmo_apagar_distribuicao_antiga`.

- [ ] **Step 1: MEDIR as travas do `DROP TABLE` na cópia (txn REVERTIDA; N3 — PR8)**

O controlador avisa o dono (texto do `n3.sh`, passo `t9s1`) e, com o OK:

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/distribuicao-produto"
DIST_DONO_AVISADO=sim bash .superpowers/distribuicao/n3.sh antes t9s1
psql "postgresql://postgres:postgres@127.0.0.1:54422/postgres" -X -v ON_ERROR_STOP=1 <<'SQL' | tee .superpowers/distribuicao/travas-drop.txt
BEGIN;
SET LOCAL lock_timeout = '2s';
DROP FUNCTION IF EXISTS public.direcionamento_resumo_subcolecao(uuid);
DROP FUNCTION IF EXISTS public.distribuicao_resumo(uuid, text);
DROP FUNCTION IF EXISTS public.salvar_distribuicao_tabela(jsonb);
DROP FUNCTION IF EXISTS public.excluir_distribuicao_tabela(uuid);
DROP TABLE IF EXISTS public.distribuicao_tabelas;
SELECT n.nspname || '.' || c.relname AS rel, l.mode
  FROM pg_locks l JOIN pg_class c ON c.oid = l.relation JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE l.pid = pg_backend_pid() AND l.locktype = 'relation' AND n.nspname IN ('public', 'auth', 'storage', 'realtime')
 ORDER BY 1, 2;
ROLLBACK;
SQL
bash .superpowers/distribuicao/n3.sh depois t9s1
```

Expected: `ROLLBACK` no fim; a lista mostra `AccessExclusiveLock` em `public.distribuicao_tabelas` (+ índices) e, pelos gatilhos de FK, em `public.tenants` e `public.colecoes` (anotar o modo exato). `n3.sh depois` = `…|antiga=t` (nada vazou). **Se aparecer QUALQUER `auth.*`/`storage.*`/`realtime.*`** (o hook `supautils.policy_grants` pegando o `DROP TABLE` com policy): PARE — o controlador leva ao dono (PR8) antes de seguir; a remoção passa a exigir janela de manutenção avisada. O resultado vai para o diário do guardião e para o G-migration B.

- [ ] **Step 2: Dump SÓ LEITURA — `.superpowers/distribuicao/mig/dump_remocao.sh`**

```bash
#!/usr/bin/env bash
# Task 9 Step 2 — lê (SÓ LEITURA) na CÓPIA o texto VIVO das 4 RPCs antigas e os md5. O gerador monta a remoção e o
# inverso A PARTIR DESTES TEXTOS (o plano não crava md5).
set -euo pipefail
TOP="$(git rev-parse --show-toplevel)"
case "$TOP" in */.claude/worktrees/distribuicao-produto) ;; *) echo "PARE: rode de dentro da worktree distribuicao-produto"; exit 1;; esac
cd "$TOP"
LOCAL="postgresql://postgres:postgres@127.0.0.1:54422/postgres"
M=.superpowers/distribuicao/mig
mkdir -p "$M/antes"
q() { PGOPTIONS='-c default_transaction_read_only=on' psql "$LOCAL" -X -A -t -v ON_ERROR_STOP=1 -c "$1"; }
[ "$(q "select to_regclass('public.distribuicao_tabelas') is not null")" = t ] || { echo "PARE: a tabela antiga já não existe na cópia"; exit 1; }
[ "$(q "select count(*) from information_schema.columns where table_schema='public' and table_name='distribuicao_tabelas'")" = 12 ] \
  || { echo "PARE: distribuicao_tabelas não tem as 12 colunas do planejamento"; exit 1; }
MS=""
for par in resumo_subcol:'public.direcionamento_resumo_subcolecao(uuid)' resumo:'public.distribuicao_resumo(uuid,text)' \
           salvar_tab:'public.salvar_distribuicao_tabela(jsonb)' excluir_tab:'public.excluir_distribuicao_tabela(uuid)'; do
  a="${par%%:*}"; f="${par#*:}"
  PGOPTIONS='-c default_transaction_read_only=on' psql "$LOCAL" -X -A -t -v ON_ERROR_STOP=1 \
    -c "select pg_get_functiondef('$f'::regprocedure)" -o "$M/antes/$a.sql"
  MS="${MS:+$MS|}$(q "select md5(pg_get_functiondef('$f'::regprocedure))")"
done
echo "$MS" > "$M/md5-antigas-antes.txt"
echo "md5 VIVOS das 4 antigas (resumo_subcol|resumo|salvar_tab|excluir_tab): $MS"
```

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/distribuicao-produto"
chmod +x .superpowers/distribuicao/mig/dump_remocao.sh && bash .superpowers/distribuicao/mig/dump_remocao.sh
```

Expected: `d431e4ed…|dc8b90c4…|0227b0fa…|ee38685a…` (= o retrato de produção; outro valor ⇒ PARE).

- [ ] **Step 3: Suíte (falha)** — `tests/integration/distribuicao-antiga-remover.test.ts`:

```ts
/**
 * Distribuição por produto — migration de REMOÇÃO 20261006110000 (Distribuição antiga: tabela distribuicao_tabelas + 4 RPCs;
 * spec R29, plano Task 9). GERADA por .superpowers/distribuicao/mig/gerar_remocao.py (não editar à mão).
 * ⚠️ SÓ NA CÓPIA LOCAL. DIST_MIG_TXN=1 = a cópia SEM as duas migrations: cada teste aplica a ADITIVA e depois a remoção
 * DENTRO da txn revertida (N3 — dono avisado ANTES). Sem a variável e com a remoção JÁ aplicada na cópia, só o "depois".
 */
import { describe, it, expect } from "vitest";
import { Client } from "pg";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { hasDb, dbUrl, withTx, um, ehBancoLocal } from "./db";
import { aplicarSql, exigeBancoLocal } from "./mig-txn";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MIG_A = "supabase/migrations/20261006100000_distribuicao_por_produto.sql";
const MIG = "supabase/migrations/20261006110000_distribuicao_antiga_remover.sql";
const INV = "supabase/rollback/20261006110000_distribuicao_antiga_remover_down.sql";
const ORIG = "supabase/migrations/20260922120000_distribuicao.sql";
const ANTIGAS = [
  { fn: "public.direcionamento_resumo_subcolecao(uuid)", cria: "CREATE OR REPLACE FUNCTION public.direcionamento_resumo_subcolecao(" },
  { fn: "public.distribuicao_resumo(uuid,text)", cria: "CREATE OR REPLACE FUNCTION public.distribuicao_resumo(" },
  { fn: "public.salvar_distribuicao_tabela(jsonb)", cria: "CREATE OR REPLACE FUNCTION public.salvar_distribuicao_tabela(" },
  { fn: "public.excluir_distribuicao_tabela(uuid)", cria: "CREATE OR REPLACE FUNCTION public.excluir_distribuicao_tabela(" },
] as const;
const LOCAL = ehBancoLocal();
const MIG_TXN = process.env.DIST_MIG_TXN === "1";
if (MIG_TXN && hasDb) exigeBancoLocal();

const ler = (rel: string) => readFileSync(ROOT + rel, "utf8");
const md5 = (s: string) => createHash("md5").update(s, "utf8").digest("hex");
const RE_TRAVAS = /^SET LOCAL (lock_timeout|transaction_timeout) = '[^']*';$/gm;
const aplica = (c: Client, rel: string) => aplicarSql(c, ler(rel).replace(RE_TRAVAS, "-- [teste] trava removida"), rel);
function corpo(rel: string, inicio: string): string {
  const t = ler(rel);
  const i = t.indexOf(inicio);
  const a = i < 0 ? -1 : t.indexOf("$function$", i);
  const f = a < 0 ? -1 : t.indexOf("$function$", a + 10);
  if (i < 0 || f < 0) throw new Error(`${rel}: corpo não achado (${inicio.slice(0, 60)}…)`);
  return t.slice(i, f + 10);
}
const guardas = (rel: string) => [...ler(rel).matchAll(/v_md5 <> '([0-9a-f]{32})' THEN -- antiga/g)].map((r) => r[1]);
const semComent = (s: string) => s.replace(/--[^\n]*/g, "");

describe("Remoção B — arquivos (estático)", () => {
  it("travas; 1 BEGIN/1 COMMIT; nada em tenant_config; a remoção SEM DDL de policy explícita", () => {
    for (const f of [MIG, INV]) {
      const l = ler(f).split("\n");
      const i = l.findIndex((x) => x === "BEGIN;");
      expect(l.slice(i + 1, i + 3), f).toEqual(["SET LOCAL lock_timeout = '500ms';", "SET LOCAL transaction_timeout = '3s';"]);
      expect(l.filter((x) => x === "BEGIN;"), f).toHaveLength(1);
      expect(l.filter((x) => x === "COMMIT;"), f).toHaveLength(1);
      expect(ler(f), f).not.toMatch(/(UPDATE|INSERT INTO|DELETE FROM|ALTER TABLE|COMMENT ON COLUMN) public\.tenant_config/);
    }
    expect(ler(MIG)).not.toMatch(/^[ \t]*(CREATE|DROP|ALTER)[ \t]+POLICY\b/im);
  });
  it("remoção: guarda (confirmação, aditiva aplicada, md5 das 4 = o texto do inverso, 12 colunas) → 4 DROP FUNCTION → DROP TABLE POR ÚLTIMO", () => {
    const m = ler(MIG);
    expect(m).toContain("app.confirmo_apagar_distribuicao_antiga");
    expect(m).toContain("to_regprocedure('public.direcionamento_plano_modelo(uuid)') IS NULL");
    expect(guardas(MIG)).toEqual(ANTIGAS.map((a) => md5(corpo(INV, a.cria) + "\n")));
    const iDrop = m.indexOf("DROP TABLE IF EXISTS public.distribuicao_tabelas;");
    for (const s of ["DROP FUNCTION IF EXISTS public.direcionamento_resumo_subcolecao(uuid);", "DROP FUNCTION IF EXISTS public.distribuicao_resumo(uuid, text);",
      "DROP FUNCTION IF EXISTS public.salvar_distribuicao_tabela(jsonb);", "DROP FUNCTION IF EXISTS public.excluir_distribuicao_tabela(uuid);"])
      expect(m.indexOf(s), s).toBeGreaterThan(m.indexOf("END $guarda$;"));
    expect(semComent(m.slice(iDrop)).trim()).toBe("DROP TABLE IF EXISTS public.distribuicao_tabelas;\n\nCOMMIT;");
  });
  it("inverso: DDL da tabela = o da migration original; 4 funções; ACL; policy POR ÚLTIMO", () => {
    const v = ler(INV), o = ler(ORIG);
    const ddl = o.slice(o.indexOf("CREATE TABLE IF NOT EXISTS public.distribuicao_tabelas ("),
      o.indexOf("ALTER TABLE public.distribuicao_tabelas ENABLE ROW LEVEL SECURITY;\n") + "ALTER TABLE public.distribuicao_tabelas ENABLE ROW LEVEL SECURITY;\n".length);
    expect(v).toContain(ddl);
    for (const a of ANTIGAS) expect(v.indexOf(a.cria), a.fn).toBeGreaterThan(v.indexOf(ddl));
    const iPol = v.indexOf("DROP POLICY IF EXISTS distribuicao_tabelas_tenant ON public.distribuicao_tabelas;");
    expect(iPol).toBeGreaterThan(v.lastIndexOf("GRANT EXECUTE ON FUNCTION"));
    expect(semComent(v.slice(v.indexOf("CREATE POLICY distribuicao_tabelas_tenant"))).trim().endsWith("COMMIT;")).toBe(true);
  });
});

async function removida(): Promise<boolean> {
  if (!hasDb || !LOCAL || MIG_TXN) return false;
  const c = new Client({ connectionString: dbUrl()!, ssl: false });
  await c.connect();
  try {
    return (await c.query("select to_regclass('public.distribuicao_tabelas') is null and to_regprocedure('public.direcionamento_plano_modelo(uuid)') is not null ok")).rows[0]?.ok === true;
  } finally {
    await c.end();
  }
}
const JA_REMOVIDA = await removida();
const contagens = async (c: Client) => (await um<{ v: string }>(c,
  `select (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public') || '|' ||
          (select count(*) from pg_trigger t join pg_class k on k.oid = t.tgrelid join pg_namespace n on n.oid = k.relnamespace
            where n.nspname = 'public' and not t.tgisinternal) v`)).v;
const estrutura = async (c: Client) => (await um<{ v: string | null }>(c, `
  select string_agg(k || '=' || v, E'\n' order by k) v from (
    select 'col:' || a.attname k, concat_ws('|', format_type(a.atttypid, a.atttypmod), a.attnotnull, coalesce(pg_get_expr(d.adbin, d.adrelid), '-')) v
      from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
     where a.attrelid = 'public.distribuicao_tabelas'::regclass and a.attnum > 0 and not a.attisdropped
    union all select 'idx:' || i.indexrelid::regclass::text, pg_get_indexdef(i.indexrelid) from pg_index i where i.indrelid = 'public.distribuicao_tabelas'::regclass
    union all select 'tg:' || t.tgname, pg_get_triggerdef(t.oid) from pg_trigger t where t.tgrelid = 'public.distribuicao_tabelas'::regclass and not t.tgisinternal
    union all select 'pol:' || p.polname, concat_ws('|', p.polpermissive, p.polcmd, pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid)) from pg_policy p where p.polrelid = 'public.distribuicao_tabelas'::regclass
    union all select 'rls', relrowsecurity::text from pg_class where oid = 'public.distribuicao_tabelas'::regclass
    union all select 'con:' || conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.distribuicao_tabelas'::regclass
  ) x`)).v;
async function tenta(c: Client, fn: () => Promise<void>): Promise<string> {
  await c.query("SAVEPOINT r");
  try { await fn(); await c.query("RELEASE SAVEPOINT r"); return ""; } catch (e) { await c.query("ROLLBACK TO SAVEPOINT r"); return String((e as Error).message); }
}

describe.skipIf(!(hasDb && LOCAL && MIG_TXN))("Remoção B — banco (cópia, txn revertida, DIST_MIG_TXN=1)", () => {
  it("sem a aditiva RECUSA; sem confirmação RECUSA", async () => {
    await withTx(async (c) => {
      exigeBancoLocal();
      await c.query("SET LOCAL lock_timeout = '3s'");
      await c.query("SET LOCAL app.confirmo_apagar_distribuicao_antiga = 'sim'");
      expect(await tenta(c, () => aplica(c, MIG))).toMatch(/aditiva/);
      await c.query("SET LOCAL app.confirmo_apagar_distribuicao_antiga = ''");
      await aplica(c, MIG_A);
      expect(await tenta(c, () => aplica(c, MIG))).toMatch(/confirmo_apagar_distribuicao_antiga/);
    });
  });
  it("com confirmação: somem a tabela e as 4 RPCs; −4 funções/−1 gatilho; nada mais muda; 2× não falha", async () => {
    await withTx(async (c) => {
      exigeBancoLocal();
      await c.query("SET LOCAL lock_timeout = '3s'");
      await aplica(c, MIG_A);
      const antes = (await contagens(c)).split("|").map(Number);
      const outras = async () => (await um<{ v: string }>(c,
        `select md5(string_agg(p.oid::regprocedure::text || '=' || md5(pg_get_functiondef(p.oid)), E'\n' order by p.oid::regprocedure::text collate "C")) v
           from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f','p')
            and p.proname not in ('direcionamento_resumo_subcolecao','distribuicao_resumo','salvar_distribuicao_tabela','excluir_distribuicao_tabela')`)).v;
      const o0 = await outras();
      await c.query("SET LOCAL app.confirmo_apagar_distribuicao_antiga = 'sim'");
      await aplica(c, MIG);
      expect((await um<{ ok: boolean }>(c, "select to_regclass('public.distribuicao_tabelas') is null ok")).ok).toBe(true);
      for (const a of ANTIGAS) expect((await um<{ ok: boolean }>(c, "select to_regprocedure($1) is null ok", [a.fn])).ok, a.fn).toBe(true);
      expect((await contagens(c)).split("|").map(Number)).toEqual([antes[0] - 4, antes[1] - 1]);
      expect(await outras()).toBe(o0);
      await aplica(c, MIG); // idempotente
    });
  });
  it("inverso: recria a tabela IDÊNTICA (colunas, índices, gatilho, policy, RLS, FKs) e as 4 RPCs (md5 de antes; ACL só authenticated)", async () => {
    await withTx(async (c) => {
      exigeBancoLocal();
      await c.query("SET LOCAL lock_timeout = '3s'");
      await aplica(c, MIG_A);
      const e0 = await estrutura(c);
      await c.query("SET LOCAL app.confirmo_apagar_distribuicao_antiga = 'sim'");
      await aplica(c, MIG);
      await aplica(c, INV);
      expect(await estrutura(c)).toBe(e0);
      const g = guardas(MIG);
      for (const [i, a] of ANTIGAS.entries()) {
        expect(md5((await um<{ d: string }>(c, "select pg_get_functiondef(to_regprocedure($1)) d", [a.fn])).d), a.fn).toBe(g[i]);
        expect(await um(c, `select has_function_privilege('anon', $1, 'EXECUTE') anon, has_function_privilege('authenticated', $1, 'EXECUTE') auth`, [a.fn]), a.fn)
          .toEqual({ anon: false, auth: true });
      }
      await aplica(c, INV); // idempotente
    });
  });
});

describe.skipIf(!JA_REMOVIDA)("Remoção B — cópia com a remoção JÁ aplicada", () => {
  it("tabela e RPCs antigas ausentes; RPC nova presente", async () => {
    await withTx(async (c) => {
      expect((await um<{ ok: boolean }>(c, "select to_regclass('public.distribuicao_tabelas') is null and to_regprocedure('public.direcionamento_resumo_subcolecao(uuid)') is null ok")).ok).toBe(true);
    });
  });
});
```

- [ ] **Step 4: O gerador — `.superpowers/distribuicao/mig/gerar_remocao.py`**

```python
#!/usr/bin/env python3
"""Distribuição por produto — GERA a migration de REMOÇÃO 20261006110000 (Distribuição antiga) e o inverso (plano Task 9).
Entrada: dump SÓ LEITURA (dump_remocao.sh) .superpowers/distribuicao/mig/antes/{resumo_subcol,resumo,salvar_tab,excluir_tab}.sql +
md5-antigas-antes.txt; o DDL da tabela sai da migration ORIGINAL 20260922120000_distribuicao.sql (âncoras 1×).
Saída: supabase/migrations/20261006110000_distribuicao_antiga_remover.sql + supabase/rollback/…_down.sql. NUNCA editar à mão."""
import hashlib
import pathlib
import sys

RAIZ = pathlib.Path(__file__).resolve().parents[3]
M = RAIZ / ".superpowers" / "distribuicao" / "mig"
NOME = "20261006110000_distribuicao_antiga_remover"
MIG = RAIZ / "supabase" / "migrations" / f"{NOME}.sql"
INV = RAIZ / "supabase" / "rollback" / f"{NOME}_down.sql"
ORIG = RAIZ / "supabase" / "migrations" / "20260922120000_distribuicao.sql"
ANTIGAS = [  # (dump, to_regprocedure, assinatura do DROP/REVOKE/GRANT) — ordem FIXA = md5-antigas-antes.txt
    ("resumo_subcol", "public.direcionamento_resumo_subcolecao(uuid)", "public.direcionamento_resumo_subcolecao(uuid)"),
    ("resumo", "public.distribuicao_resumo(uuid,text)", "public.distribuicao_resumo(uuid, text)"),
    ("salvar_tab", "public.salvar_distribuicao_tabela(jsonb)", "public.salvar_distribuicao_tabela(jsonb)"),
    ("excluir_tab", "public.excluir_distribuicao_tabela(uuid)", "public.excluir_distribuicao_tabela(uuid)"),
]
TAB_INI = "CREATE TABLE IF NOT EXISTS public.distribuicao_tabelas ("
TAB_FIM = "ALTER TABLE public.distribuicao_tabelas ENABLE ROW LEVEL SECURITY;\n"
POL_INI = "DROP POLICY IF EXISTS distribuicao_tabelas_tenant ON public.distribuicao_tabelas;\n"
POL_FIM = "  WITH CHECK (tenant_id = public.get_user_tenant_id());\n"


def md5(s: str) -> str:
    return hashlib.md5(s.encode("utf-8")).hexdigest()


def pare(msg: str) -> None:
    sys.exit(f"PARE: {msg}")


def le_dump(arq: str) -> str:
    raw = (M / "antes" / f"{arq}.sql").read_text(encoding="utf-8")
    return raw[:-1] if raw.endswith("$function$\n\n") else raw


orig = ORIG.read_text(encoding="utf-8")
for a in (TAB_INI, TAB_FIM, POL_INI, POL_FIM):
    if orig.count(a) != 1:
        pare(f"âncora da migration original achada {orig.count(a)}× (esperado 1): {a.strip()[:70]}")
DDL_TAB = orig[orig.index(TAB_INI): orig.index(TAB_FIM) + len(TAB_FIM)]
DDL_POL = orig[orig.index(POL_INI): orig.index(POL_FIM) + len(POL_FIM)]
md5_vivo = (M / "md5-antigas-antes.txt").read_text(encoding="utf-8").strip().split("|")
if len(md5_vivo) != len(ANTIGAS):
    pare("md5-antigas-antes.txt tem de ter 4 md5 — refazer o dump_remocao.sh")
textos = {}
for (arq, _fn, _sig), mv in zip(ANTIGAS, md5_vivo):
    t = le_dump(arq)
    if md5(t) != mv:
        pare(f"{arq}: o dump não reproduz o md5 VIVO ({md5(t)} ≠ {mv})")
    textos[arq] = t

TRAVAS = "BEGIN;\nSET LOCAL lock_timeout = '500ms';\nSET LOCAL transaction_timeout = '3s';\n"


def sem_nl(t: str) -> str:
    return t[:-1] if t.endswith("\n") else t


def guarda(sentido: str) -> str:
    out = []
    for (arq, fn, _sig), mv in zip(ANTIGAS, md5_vivo):
        nome = fn.split("(")[0].replace("public.", "")
        out += [
            f"  IF to_regprocedure('{fn}') IS NOT NULL THEN\n",
            f"    v_md5 := md5(pg_get_functiondef('{fn}'::regprocedure));\n",
            f"    IF v_md5 <> '{mv}' THEN -- antiga\n",
            f"      RAISE EXCEPTION 'distribuicao_antiga{sentido}: {nome} mudou desde o planejamento (md5 %) — PARE', v_md5 USING ERRCODE = 'P0001';\n",
            "    END IF;\n",
            "  END IF;\n",
        ]
    return "".join(out)


mig = [
    "-- Distribuição por produto — REMOÇÃO da Distribuição antiga (P-14 = B; spec R29; plano Task 9). GERADA por\n"
    "-- .superpowers/distribuicao/mig/gerar_remocao.py — NÃO editar à mão. Roda pelo remover-producao.sh DEPOIS do deploy\n"
    "-- no ar (o front publicado antes dele usa a tabela e a RPC do resumo), com export CSV + backup antes e frase digitada.\n"
    "-- Some: distribuicao_tabelas (+ índices, gatilho set_tenant_id_distribuicao, policy) e 4 RPCs. Contagem: −4|−1.\n"
    "-- O DROP da tabela vem POR ÚLTIMO: ele tira os gatilhos de FK em tenants/colecoes (trava até o COMMIT — ms).\n"
    "-- Inverso (estrutura; os dados voltam do CSV pelo script): supabase/rollback/" + NOME + "_down.sql.\n\n",
    TRAVAS, "\n",
    "DO $guarda$\nDECLARE\n  v_md5 text;\n  v_n int;\nBEGIN\n",
    "  IF coalesce(current_setting('app.confirmo_apagar_distribuicao_antiga', true), '') <> 'sim' THEN\n",
    "    RAISE EXCEPTION 'distribuicao_antiga: isto APAGA a Distribuição antiga — rode com SET LOCAL app.confirmo_apagar_distribuicao_antiga = ''sim'' (o script exporta e faz backup antes)' USING ERRCODE = 'P0001';\n",
    "  END IF;\n",
    "  IF to_regprocedure('public.direcionamento_plano_modelo(uuid)') IS NULL THEN\n",
    "    RAISE EXCEPTION 'distribuicao_antiga: aplique antes a aditiva 20261006100000 (o Direcionamento novo lê a RPC dela)' USING ERRCODE = 'P0001';\n",
    "  END IF;\n",
    guarda(""),
    "  IF to_regclass('public.distribuicao_tabelas') IS NOT NULL THEN\n",
    "    SELECT count(*) INTO v_n FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'distribuicao_tabelas';\n",
    "    IF v_n <> 12 THEN\n",
    "      RAISE EXCEPTION 'distribuicao_antiga: distribuicao_tabelas mudou (% colunas) — PARE', v_n USING ERRCODE = 'P0001';\n",
    "    END IF;\n",
    "  END IF;\n",
    "END $guarda$;\n\n",
]
mig += [f"DROP FUNCTION IF EXISTS {sig};\n" for _a, _f, sig in ANTIGAS]
mig += [
    "-- POR ÚLTIMO (R29): leva índices, gatilho e policy da tabela e os gatilhos de FK em tenants/colecoes.\n",
    "DROP TABLE IF EXISTS public.distribuicao_tabelas;\n",
    "\nCOMMIT;\n",
]
inv = [
    "-- INVERSO da remoção da Distribuição antiga (20261006110000) — GERADO por gerar_remocao.py (NÃO editar à mão).\n"
    "-- Recria a ESTRUTURA (DDL da migration original 20260922120000 + as 4 RPCs no texto vivo + ACL); os DADOS voltam do CSV\n"
    "-- exportado antes da remoção (volta-remocao-producao.sh). A policy vem POR ÚLTIMO (hook supautils.policy_grants trava\n"
    "-- auth/storage até o COMMIT). LIFO: esta volta vem ANTES da volta da aditiva.\n\n",
    TRAVAS, "\n",
    "DO $guarda$\nDECLARE\n  v_md5 text;\nBEGIN\n", guarda(" (volta)"), "END $guarda$;\n\n",
    DDL_TAB, "\n",
]
for arq, _fn, _sig in ANTIGAS:
    inv.append(sem_nl(textos[arq]) + ";\n\n")
for _a, _f, sig in ANTIGAS:
    inv.append(f"REVOKE EXECUTE ON FUNCTION {sig} FROM PUBLIC, anon, authenticated;\n")
    inv.append(f"GRANT EXECUTE ON FUNCTION {sig} TO authenticated;\n")
inv += ["\n", DDL_POL, "\nCOMMIT;\n"]
MIG.write_text("".join(mig), encoding="utf-8")
INV.write_text("".join(inv), encoding="utf-8")
print(f"OK: {MIG.name} + {INV.name} gerados · antigas {'|'.join(m[:8] for m in md5_vivo)}")
```

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/distribuicao-produto"
python3 .superpowers/distribuicao/mig/gerar_remocao.py
```

Expected: `OK: … gerados · antigas d431e4ed|dc8b90c4|0227b0fa|ee38685a`.

- [ ] **Step 5: N3 + rodar as suítes (A e B) no modo txn**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/distribuicao-produto"
DIST_DONO_AVISADO=sim bash .superpowers/distribuicao/n3.sh antes t9s5
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres DIST_MIG_TXN=1 npx vitest run --no-file-parallelism tests/integration/distribuicao-antiga-remover.test.ts tests/integration/distribuicao-produto.test.ts 2>&1 | tail -12
bash .superpowers/distribuicao/n3.sh depois t9s5
```

Expected: remoção → 6 passed | 1 skipped (3 estáticos + 3 de banco; o do "já aplicada" pula); aditiva → 14 passed. `n3.sh depois` = `…|A=f|antiga=t`. Diferença de `estrutura` no inverso ⇒ o DDL/ACL do inverso não reproduz o vivo: PARE e chame o controlador (não "consertar" o teste).

- [ ] **Step 6: Gates e commit**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/distribuicao-produto"
bash .superpowers/distribuicao/gates.sh
git add -- supabase/migrations/20261006110000_distribuicao_antiga_remover.sql supabase/rollback/20261006110000_distribuicao_antiga_remover_down.sql tests/integration/distribuicao-antiga-remover.test.ts
git commit --only -m "feat(distribuicao): migration 20261006110000 — remoção da Distribuição antiga (tabela + 4 RPCs) com confirmação; inverso fiel (T9)" \
  -m "GERADA (gerar_remocao.py) com guarda md5 das 4 RPCs; exige a aditiva; DROP TABLE por último; −4|−1; roda DEPOIS do deploy. Travas medidas na cópia (travas-drop.txt). Plano 2026-09-25, Task 9." \
  -m "Co-Authored-By: Claude <seu modelo real> <noreply@anthropic.com>" \
  -- supabase/migrations/20261006110000_distribuicao_antiga_remover.sql supabase/rollback/20261006110000_distribuicao_antiga_remover_down.sql tests/integration/distribuicao-antiga-remover.test.ts
git show --stat HEAD
```

- [ ] **Step 7: G-migration B — 2 revisões Opus INDEPENDENTES + guardião** — mesmo formato da Task 4 Step 7, com: o plano, a spec, os 2 SQL, o `gerar_remocao.py`, o `dump_remocao.sh`, a suíte, o `travas-drop.txt` e os logs. **Checklist:** guarda (confirmação, aditiva aplicada, md5 das 4 = vivo, 12 colunas); nada além das 4 RPCs e da tabela; `DROP TABLE` último; nenhuma DDL de policy explícita; travas medidas e aceitáveis (sem `auth/storage/realtime` — senão, decisão do dono); inverso = DDL original + texto vivo + ACL (`authenticated` sim, anon não) + policy por último, idempotente, estrutura idêntica provada; −4|−1; LIFO com a aditiva (o inverso da aditiva EXIGE a tabela antiga).

---
## Task 10: Ensaio na cópia + scripts de PRODUÇÃO (molde Nota/SKU/Sheet) + provas com `psql`/`docker` falsos  *(Opus + guardião — G-scripts)*

> Nenhum arquivo versionado. Tudo em `.superpowers/distribuicao/` e na pasta 700 `/Users/sunglee/PLM + Criação/savepoints/pre-apply-distribuicao/`. O agente NUNCA roda nada contra a produção: os scripts de produção são PROVADOS só com `psql`/`docker` falsos e URL sintética (Step 9); quem roda de verdade é o DONO (Task 11).

**Files (não versionados):** `.superpowers/distribuicao/mig/{extra.sh,monta-aplica.sh,aplica.sh(gerado),ensaio-local.sh,ida-producao.sh,ref-volta-f1.sh,remover-producao.sh,volta-producao.sh,volta-remocao-producao.sh,prova-scripts.sh}`, `.superpowers/distribuicao/copia.sh`, `/Users/sunglee/PLM + Criação/savepoints/pre-apply-distribuicao/RODAR-distribuicao.md`.

**Interfaces:**
- Consumes: bloco LITERAL da F1 (`espera`, `ativ_vazio`, `com_travas`, `aplica_v2`, `ATIV` — runbook `…/.superpowers/sdd/2026-09-22-kanban-automatico-f1-banco/task-18-runbook-v2.md`, hash `c045cc571caf5d95`); `bloco_apoio_v2.sh` da F1 (`FIDEL_DET`, só em subshell); `md5-redef-{antes,depois}.txt`, `md5-novas-depois.txt`, `md5-antigas-antes.txt` (Tasks 4 e 9).
- Produces: `aplica.sh` (source) com `CONT`, `OBJ_A` (`0|0|0` ↔ `2|2|2`), `OBJ_B` (`1|4` ↔ `0|0`), `MD5_REDEF`, `MD5_NOVAS`, `MD5_ANTIGAS`, `FN_PRE`, `ACL_A` (esperado `0|1|0|1`), `DADOS_A`, `DADOS_B`, `INFO_A`, `F1_OK`, `REORG_OK`, `PAT_A`, `PAT_B`, `prevoo_a`, `confere_ida_a`, `confere_volta_a`, `prevoo_b`, `confere_remocao_b`, `confere_volta_b`, `backup_banco`, `backup_copia`, `ref_mais_nova`, `chaves_f1`, `confere_cadeia_ref`, `retrato_producao`; `md5-{A-mig,A-inv,B-mig,B-inv}.txt` (md5 dos 4 SQL ENSAIADOS).

- [ ] **Step 1: `.superpowers/distribuicao/mig/extra.sh`**

```bash
# ── Distribuição por produto (20261006100000 ADITIVA + 20261006110000 REMOÇÃO). Anexado ao bloco LITERAL da F1 por
# monta-aplica.sh. Só DEFINE variáveis e funções (nada roda sozinho). Uso: num BASH, de dentro da worktree:
#   source .superpowers/distribuicao/mig/aplica.sh
M=.superpowers/distribuicao/mig
DS="${DIST_DS:-/Users/sunglee/PLM + Criação/savepoints/pre-apply-distribuicao}"
BF1="${DIST_BF1:-/Users/sunglee/PLM + Criação/savepoints/pre-apply-f1-kanban-auto}"
BK="/Users/sunglee/PLM + Criação/banco-local/backups"
CONTAINER=supabase_db_banco-local
# Arquivo da URL de produção. DIST_DBURL_FILE existe SÓ p/ as provas (URL sintética); o dono nunca o define.
DBURL_FILE="${DIST_DBURL_FILE:-/tmp/dburl.txt}"
REGEX_URL_PROD='^postgres(ql)?://([^:@/]+(:[^@/]*)?@db\.ruinwcuabilumcspeyjk\.supabase\.co(:[0-9]+)?/|postgres\.ruinwcuabilumcspeyjk(:[^@/]*)?@[a-z0-9.-]+\.pooler\.supabase\.com(:[0-9]+)?/)'
confere_url_producao() {
  [ -s "$DBURL_FILE" ] || { echo "PARE: $DBURL_FILE ausente"; return 1; }
  grep -Eq "$REGEX_URL_PROD" "$DBURL_FILE" || { echo "PARE: $DBURL_FILE não aponta p/ o banco sisTrama (ref ruinwcuabilumcspeyjk, host direto ou pooler)"; return 1; }
}
FN_REDEF="'public._salvar_plan_tecido_core(uuid,jsonb,integer)','public._plan_tecido_gravar_bom_core(uuid,jsonb)','public._plan_tecido_snapshot(uuid)','public.tenant_module_enabled(text)','public._plan_tecido_arvore_core(uuid)'"
FN_NOVAS="'public._direcionamento_plano_modelo_core(uuid,uuid)','public.direcionamento_plano_modelo(uuid)'"
FN_ANTIGAS="'public.direcionamento_resumo_subcolecao(uuid)','public.distribuicao_resumo(uuid,text)','public.salvar_distribuicao_tabela(jsonb)','public.excluir_distribuicao_tabela(uuid)'"
CONT="select (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public') || '|' || (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal)"
md5_lista() { printf '%s' "select string_agg(coalesce(md5(pg_get_functiondef(to_regprocedure(u.f))), '-'), '|' order by u.n) from unnest(array[$1]) with ordinality u(f, n)"; }
MD5_REDEF="$(md5_lista "$FN_REDEF")"
MD5_NOVAS="$(md5_lista "$FN_NOVAS")"
MD5_ANTIGAS="$(md5_lista "$FN_ANTIGAS")"
# Aditiva — RPCs novas | colunas | CHECKs: 0|0|0 sem ela; 2|2|2 com ela.
OBJ_A="select (select count(*) from unnest(array[$FN_NOVAS]) f where to_regprocedure(f) is not null) || '|' || (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'plan_tecido_variantes' and column_name in ('distribuicao','atende')) || '|' || (select count(*) from pg_constraint where conrelid = 'public.plan_tecido_variantes'::regclass and conname in ('plan_tecido_variantes_distribuicao_objeto','plan_tecido_variantes_atende_array'))"
# Distribuição antiga — tabela | RPCs antigas: 1|4 com ela; 0|0 depois da remoção.
OBJ_B="select (to_regclass('public.distribuicao_tabelas') is not null)::int || '|' || (select count(*) from unnest(array[$FN_ANTIGAS]) f where to_regprocedure(f) is not null)"
# Todas as OUTRAS funções de public (fora as 11 desta frente): md5 de assinatura+definição | quantidade.
FN_PRE="select md5(string_agg(p.oid::regprocedure::text || '=' || md5(pg_get_functiondef(p.oid)), E'\n' order by p.oid::regprocedure::text collate \"C\")) || '|' || count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f','p') and p.oid not in (select coalesce(to_regprocedure(x), 0::oid) from unnest(array[$FN_REDEF, $FN_NOVAS, $FN_ANTIGAS]) x)"
# ACL (#9): pares (4 internas redefinidas + _core × PUBLIC/anon/authenticated) com EXECUTE | wrapper p/ authenticated |
# wrapper p/ anon | tenant_module_enabled segue aberta (authenticated E anon — as policies a chamam). Esperado 0|1|0|1.
ACL_A="select (select count(*) from unnest(array['public._salvar_plan_tecido_core(uuid,jsonb,integer)','public._plan_tecido_gravar_bom_core(uuid,jsonb)','public._plan_tecido_snapshot(uuid)','public._plan_tecido_arvore_core(uuid)','public._direcionamento_plano_modelo_core(uuid,uuid)']) f(x) cross join (values ('public'), ('anon'), ('authenticated')) r(y) where has_function_privilege(r.y, f.x, 'EXECUTE')) || '|' || (case when has_function_privilege('authenticated', 'public.direcionamento_plano_modelo(uuid)', 'EXECUTE') then 1 else 0 end) || '|' || (case when has_function_privilege('anon', 'public.direcionamento_plano_modelo(uuid)', 'EXECUTE') then 1 else 0 end) || '|' || (case when has_function_privilege('authenticated', 'public.tenant_module_enabled(text)', 'EXECUTE') and has_function_privilege('anon', 'public.tenant_module_enabled(text)', 'EXECUTE') then 1 else 0 end)"
# O que cada volta APAGA: variantes com distribuição | com "atende a" (aditiva); linhas da tabela antiga (remoção).
DADOS_A="select (select count(*) from public.plan_tecido_variantes where distribuicao <> '{}'::jsonb) || '|' || (select count(*) from public.plan_tecido_variantes where atende is not null)"
DADOS_B="select count(*) from public.distribuicao_tabelas"
# INFORMATIVO (não bloqueia): lojas com o módulo ligado | casamentos já no BOM | linhas de permissão 'distribuicao' órfãs (R30).
INFO_A="select (select count(*) from public.tenant_config where (modules ->> 'distribuicao') = 'true') || '|' || (select count(*) from public.modelo_tecido_variantes where complementa_variante_ids is not null) || '|' || ((select count(*) from public.user_permissions where pagina = 'distribuicao') + (select count(*) from public.papel_permissoes where pagina = 'distribuicao'))"
F1_OK="select to_regprocedure('public.kanban_mover(uuid,text)') is not null"
# Reorganização do Sheet (20261005100000) — ordem do dono: ela ANTES desta (P-26). Detecção por OBJETO.
REORG_OK="select to_regprocedure('public._titulo_pagina_calculado(text,text)') is not null and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tenant_config' and column_name = 'keywords')"

md5_arquivo() { md5 -q "$1" 2>/dev/null || md5sum "$1" | cut -d' ' -f1; }
md5_de() { tr -d '[:space:]' < "$1"; }
confere_md5_sql() {  # uso: confere_md5_sql A|B — os 2 SQL da etapa no disco = os ENSAIADOS
  local e="$1" mig inv
  if [ "$e" = A ]; then mig="$MIG_A"; inv="$INV_A"; else mig="$MIG_B"; inv="$INV_B"; fi
  [ -s "$M/md5-$e-mig.txt" ] && [ -s "$M/md5-$e-inv.txt" ] || { echo "FALHOU (pré-voo): faltam $M/md5-$e-{mig,inv}.txt (ensaio da Task 10)"; return 1; }
  [ "$(md5_arquivo "$mig")" = "$(md5_de "$M/md5-$e-mig.txt")" ] || { echo "FALHOU (pré-voo): $mig ≠ o ensaiado"; return 1; }
  [ "$(md5_arquivo "$inv")" = "$(md5_de "$M/md5-$e-inv.txt")" ] || { echo "FALHOU (pré-voo): $inv ≠ o ensaiado"; return 1; }
  echo "OK (pré-voo): SQL da etapa $e = md5 do ensaio"
}
confere_arquivos() {  # travas nos 4 arquivos; DDL de policy SÓ no inverso da remoção
  local f tt
  for f in "$MIG_A" "$INV_A" "$MIG_B" "$INV_B"; do
    tt="$(sed -n "s/^SET LOCAL transaction_timeout = '\([0-9][0-9]*\)s';\$/\1/p" "$f" | head -1)"
    [ "$tt" = 3 ] || { echo "FALHOU (pré-voo): $f — transaction_timeout tem de ser 3s (achei '${tt}s')"; return 1; }
    [ "$(grep -A2 -x 'BEGIN;' "$f")" = "$(printf '%s\n' 'BEGIN;' "SET LOCAL lock_timeout = '500ms';" "SET LOCAL transaction_timeout = '3s';")" ] \
      || { echo "FALHOU (pré-voo): $f sem as 2 travas logo depois do BEGIN;"; return 1; }
  done
  for f in "$MIG_A" "$INV_A" "$MIG_B"; do
    if grep -Eiq '^[[:space:]]*(create|drop|alter)[[:space:]]+policy' "$f"; then echo "FALHOU (pré-voo): $f tem DDL de policy"; return 1; fi
  done
  echo "OK (pré-voo): travas 500ms/3s nos 4 arquivos; DDL de policy só no inverso da remoção"
}
# Backup = receita PROVADA (Nota/SKU/Sheet): 2 dumps POR SCHEMA (public + auth) com o pg_dump 17.6 do CONTAINER da cópia.
# URL pela ENTRADA PADRÃO; umask 077 + chmod 600; exige TABLE DATA > 0 e que o dump abra. PARA em qualquer falha.
backup_banco() {  # uso: backup_banco URL pasta rótulo
  local url="$1" dir="$2" rot="$3" schema f n_td
  mkdir -p "$dir" && chmod 700 "$dir" 2>/dev/null || return 1
  docker ps --filter "name=^${CONTAINER}$" --format '{{.Names}}' | grep -qx "$CONTAINER" \
    || { echo "FALHOU (backup): o container $CONTAINER não está no ar (o pg_dump 17.6 mora nele)"; return 1; }
  for schema in public auth; do
    f="$dir/${rot}-${schema}-$(date +%F-%H%M%S).dump"
    echo "== backup ($rot, schema $schema) → $f"
    ( umask 077; printf '%s\n' "$url" | docker exec -i "$CONTAINER" sh -c "IFS= read -r U; exec pg_dump -d \"\$U\" -Fc -n $schema" > "$f" 2> "$f.log" ) && [ -s "$f" ] \
      || { chmod 600 "$f" "$f.log" 2>/dev/null; echo "FALHOU (backup): pg_dump do schema $schema — veja $f.log (nada foi aplicado)"; tail -5 "$f.log"; return 1; }
    chmod 600 "$f" "$f.log" 2>/dev/null
    ( umask 077; docker exec -i "$CONTAINER" pg_restore -l < "$f" > "$f.toc" 2>> "$f.log" ) \
      || { chmod 600 "$f.toc" 2>/dev/null; echo "FALHOU (backup): o dump de $schema não abre (pg_restore -l)"; return 1; }
    chmod 600 "$f.toc" 2>/dev/null
    n_td=$(grep -c "TABLE DATA $schema " "$f.toc")
    [ "$n_td" -gt 0 ] || { echo "FALHOU (backup): $schema com 0 TABLE DATA no dump"; return 1; }
    echo "OK (backup $schema): $f ($(du -h "$f" | cut -f1); $n_td tabelas com dados)"
  done
}
backup_copia() {  # uso: backup_copia rótulo — pg_dump -Fc da CÓPIA inteira
  local f; mkdir -p "$BK" || return 1
  f="$BK/pre-dist-$1-$(date +%F-%H%M%S).dump"
  docker exec -e PGPASSWORD=postgres "$CONTAINER" pg_dump -h 127.0.0.1 -U supabase_admin -d postgres -Fc > "$f" && [ -s "$f" ] \
    || { echo "PARE: backup da cópia falhou"; rm -f "$f"; return 1; }
  echo "backup da cópia: $f ($(du -h "$f" | cut -f1))"
}
# ── Cadeia da referência da VOLTA DE EMERGÊNCIA da F1 (descobrir a MAIS NOVA, sem cravar nome; PARAR se não bater). Chaves
# pelas categorias REAIS do retrato (colunas/funcoes/gatilhos/indices/policies — NÃO existe "tabelas").
PAT_A='^colunas:public[.]plan_tecido_variantes[.](distribuicao|atende)$|^funcoes:public[.](_salvar_plan_tecido_core|_plan_tecido_gravar_bom_core|_plan_tecido_snapshot|tenant_module_enabled|_plan_tecido_arvore_core|_direcionamento_plano_modelo_core|direcionamento_plano_modelo)[(]'
PAT_B='^colunas:public[.]distribuicao_tabelas[.]|^gatilhos:public[.]distribuicao_tabelas[.]|^policies:public[.]distribuicao_tabelas[.]|^indices:public[.](distribuicao_tabelas_pkey|idx_distribuicao_tabelas_tenant_colecao)$|^funcoes:public[.](direcionamento_resumo_subcolecao|distribuicao_resumo|salvar_distribuicao_tabela|excluir_distribuicao_tabela)[(]'
ref_mais_nova() {  # uso: ref_mais_nova <regex de nome a EXCLUIR> — a referência MAIS NOVA por mtime (nunca a da própria etapa)
  local r; r=$(ls -t "$BF1"/fidelidade_ref_volta_f1_*_detalhe.txt 2>/dev/null | grep -Ev "$1" | head -1)
  [ -n "$r" ] && [ -s "$r" ] || { echo "PARE: nenhuma fidelidade_ref_volta_f1_*_detalhe.txt em $BF1" >&2; return 1; }
  printf '%s\n' "$r"
}
chaves_f1() {  # $1 = saída: chaves que a F1 mudou (retrato pré-F1 × pós-F1 de PRODUÇÃO, 24/set)
  local pre="$BF1/fidelidade_prod_pre_detalhe.txt" pos="$BF1/fidelidade_prod_pos_detalhe.txt"
  [ -s "$pre" ] && [ -s "$pos" ] || { echo "PARE: faltam $pre e/ou $pos (retratos da F1)"; return 1; }
  comm -3 <(LC_ALL=C sort "$pre") <(LC_ALL=C sort "$pos") | awk -F'=' '{ k = $1; sub(/^\t/, "", k); print k }' | LC_ALL=C sort -u > "$1"
  [ -s "$1" ] || { echo "PARE: nenhuma chave da F1 (retratos iguais?)"; return 1; }
}
fora_f1_e() {  # $1 = chaves da F1, $2 = retrato, $3 = PAT da etapa → linhas FORA da F1 e da etapa, ordenadas
  awk -F'=' -v pat="$3" 'NR == FNR { k[$1] = 1; next } !($1 in k) && !($1 ~ pat)' "$1" "$2" | LC_ALL=C sort
}
retrato_producao() {  # $1 = URL, $2 = saída — FIDEL_DET do bloco da F1 (SÓ LEITURA; o bloco dá cd — por isso a subshell)
  ( source "$BF1/bloco_apoio_v2.sh" > /dev/null || exit 1
    psql "$1" -X -q -A -t -v ON_ERROR_STOP=1 -c "$FIDEL_DET" ) > "$2" || { echo "FALHOU: não li o retrato de fidelidade"; return 1; }
  [ -s "$2" ] || { echo "FALHOU: retrato de fidelidade vazio"; return 1; }
}
confere_cadeia_ref() {  # uso: confere_cadeia_ref RETRATO PAT EXCLUIR — a referência mais nova bate com a produção FORA da F1 e da etapa
  local r kf1 dif
  r=$(ref_mais_nova "$3") || return 1
  kf1="$(mktemp -t dist-kf1.XXXXXX)"
  chaves_f1 "$kf1" || { rm -f "$kf1"; return 1; }
  dif=$(diff <(fora_f1_e "$kf1" "$r" "$2") <(fora_f1_e "$kf1" "$1" "$2") | grep -E '^[<>]' || true)
  rm -f "$kf1"
  if [ -n "$dif" ]; then
    printf '%s\n' "$dif" | cut -c1-160 | head -20
    echo "PARE: a referência mais nova ($(basename "$r")) NÃO bate com a produção fora da F1 e desta etapa — outra frente mudou o banco sem gravar a referência dela (ex.: a reorganização do Sheet sem o ref-volta-f1 dela). Avisar o controlador."
    return 1
  fi
  echo "OK (cadeia da volta da F1): a referência mais nova ($(basename "$r")) bate com a produção fora da F1 e desta etapa"
}
EXCL_A='_pos_distribuicao(_remocao)?_detalhe[.]txt$'
EXCL_B='_pos_distribuicao_remocao_detalhe[.]txt$'
prevoo_a() {  # uso: prevoo_a URL RETRATO — SÓ LEITURA
  echo "== pré-voo da ADITIVA — só leitura $(date '+%F %T')"
  git ls-files --error-unmatch "$MIG_A" "$INV_A" > /dev/null 2>&1 || { echo "FALHOU (arquivos): SQL não commitado"; return 1; }
  git diff --quiet HEAD -- "$MIG_A" "$INV_A" || { echo "FALHOU (arquivos): alteração não commitada no SQL"; return 1; }
  confere_md5_sql A || return 1
  confere_arquivos || return 1
  espera "$1" "select current_setting('server_version_num')::int >= 170000 and exists (select 1 from pg_settings where name = 'transaction_timeout')" "t" "PG >= 17 com transaction_timeout" &&
  espera "$1" "$F1_OK" "t" "F1 (kanban automático) no banco" &&
  espera "$1" "$REORG_OK" "t" "Reorganização do Sheet (20261005100000) no banco — ordem do dono: ela ANTES desta" &&
  espera "$1" "$OBJ_A" "0|0|0" "aditiva ainda NÃO aplicada (RPCs novas | colunas | CHECKs)" &&
  espera "$1" "$OBJ_B" "1|4" "Distribuição antiga inteira (a remoção é DEPOIS do deploy)" &&
  espera "$1" "$MD5_REDEF" "$(md5_de "$M/md5-redef-antes.txt")" "as 5 funções no texto que a guarda espera" &&
  echo "INFO (pré-voo, não bloqueia): lojas com o módulo | casamentos no BOM | permissões 'distribuicao' órfãs = $(psql "$1" -X -q -A -t -c "$INFO_A")" &&
  confere_cadeia_ref "$2" "$PAT_A" "$EXCL_A" &&
  ativ_vazio "$1" &&
  echo "== PRÉ-VOO A OK $(date '+%T')"
}
confere_ida_a() {  # uso: confere_ida_a URL CONT_ANTES FN_PRE_ANTES
  local f="${2%|*}" g="${2#*|}"
  espera "$1" "$OBJ_A" "2|2|2" "IDA: RPCs novas | colunas | CHECKs" &&
  espera "$1" "$MD5_REDEF" "$(md5_de "$M/md5-redef-depois.txt")" "IDA: as 5 no texto desta migration" &&
  espera "$1" "$MD5_NOVAS" "$(md5_de "$M/md5-novas-depois.txt")" "IDA: as 2 novas no texto desta migration" &&
  espera "$1" "$ACL_A" "0|1|0|1" "IDA: ACL (#9) — internas fechadas; wrapper só authenticated; tenant_module_enabled aberta" &&
  espera "$1" "$OBJ_B" "1|4" "IDA: a Distribuição antiga segue inteira" &&
  espera "$1" "$FN_PRE" "$3" "IDA: nenhuma outra função mudou" &&
  espera "$1" "$CONT" "$((f + 2))|$g" "IDA: contagens = antes + 2 funções, + 0 gatilhos"
}
confere_volta_a() {  # uso: confere_volta_a URL CONT_ANTES_DA_VOLTA FN_PRE_ANTES_DA_VOLTA — por DIFERENÇA, lidos NA HORA
  local f="${2%|*}" g="${2#*|}"
  espera "$1" "$OBJ_A" "0|0|0" "VOLTA A: a aditiva saiu" &&
  espera "$1" "$MD5_REDEF" "$(md5_de "$M/md5-redef-antes.txt")" "VOLTA A: as 5 de volta ao texto de antes" &&
  espera "$1" "$FN_PRE" "$3" "VOLTA A: outras funções = antes da volta" &&
  espera "$1" "$CONT" "$((f - 2))|$g" "VOLTA A: contagens = antes da volta − 2 funções"
}
prevoo_b() {  # uso: prevoo_b URL RETRATO — SÓ LEITURA (a remoção vem DEPOIS do deploy no ar)
  echo "== pré-voo da REMOÇÃO — só leitura $(date '+%F %T')"
  git ls-files --error-unmatch "$MIG_B" "$INV_B" > /dev/null 2>&1 || { echo "FALHOU (arquivos): SQL não commitado"; return 1; }
  git diff --quiet HEAD -- "$MIG_B" "$INV_B" || { echo "FALHOU (arquivos): alteração não commitada no SQL"; return 1; }
  confere_md5_sql B || return 1
  confere_arquivos || return 1
  espera "$1" "$OBJ_A" "2|2|2" "a aditiva está no banco (a remoção exige)" &&
  espera "$1" "$OBJ_B" "1|4" "Distribuição antiga ainda inteira" &&
  espera "$1" "$MD5_ANTIGAS" "$(md5_de "$M/md5-antigas-antes.txt")" "as 4 RPCs antigas no texto que a guarda espera" &&
  confere_cadeia_ref "$2" "$PAT_B" "$EXCL_B" &&
  ativ_vazio "$1" &&
  echo "== PRÉ-VOO B OK $(date '+%T')"
}
confere_remocao_b() {  # uso: confere_remocao_b URL CONT_ANTES FN_PRE_ANTES
  local f="${2%|*}" g="${2#*|}"
  espera "$1" "$OBJ_B" "0|0" "REMOÇÃO: tabela e RPCs antigas saíram" &&
  espera "$1" "$OBJ_A" "2|2|2" "REMOÇÃO: a aditiva segue inteira" &&
  espera "$1" "$FN_PRE" "$3" "REMOÇÃO: nenhuma outra função mudou" &&
  espera "$1" "$CONT" "$((f - 4))|$((g - 1))" "REMOÇÃO: contagens = antes − 4 funções, − 1 gatilho"
}
confere_volta_b() {  # uso: confere_volta_b URL CONT_ANTES_DA_VOLTA FN_PRE_ANTES_DA_VOLTA
  local f="${2%|*}" g="${2#*|}"
  espera "$1" "$OBJ_B" "1|4" "VOLTA B: tabela e RPCs antigas de volta" &&
  espera "$1" "$MD5_ANTIGAS" "$(md5_de "$M/md5-antigas-antes.txt")" "VOLTA B: as 4 no texto de antes" &&
  espera "$1" "$FN_PRE" "$3" "VOLTA B: outras funções = antes da volta" &&
  espera "$1" "$CONT" "$((f + 4))|$((g + 1))" "VOLTA B: contagens = antes da volta + 4 funções, + 1 gatilho"
}
```

- [ ] **Step 2: `.superpowers/distribuicao/mig/monta-aplica.sh` e o `aplica.sh` gerado**

```bash
#!/usr/bin/env bash
# Gera .superpowers/distribuicao/mig/aplica.sh = ATIV + espera/ativ_vazio/com_travas/aplica_v2 LITERAIS do bloco de apoio v2
# da F1 (runbook task-18-runbook-v2.md §3, extraídos por awk, hash c045cc571caf5d95 — o mesmo de Nota/SKU/Sheet) + extra.sh.
set -euo pipefail
TOP="$(git rev-parse --show-toplevel)"
case "$TOP" in */.claude/worktrees/distribuicao-produto) ;; *) echo "PARE: rode de dentro da worktree distribuicao-produto"; exit 1;; esac
cd "$TOP"
RB="/Users/sunglee/PLM + Criação/plm-pcp/.superpowers/sdd/2026-09-22-kanban-automatico-f1-banco/task-18-runbook-v2.md"
FUN="$(awk '/^# === BLOCO DE APOIO v2 ===/{p=1} p{print} /^# === FIM DO BLOCO DE APOIO v2 ===/{p=0}' "$RB" \
  | awk '/^ATIV="/{print; next} /^(espera|ativ_vazio|com_travas|aplica_v2)\(\) *\{/{f=1} f{print} f&&/^\}$/{f=0}')"
[ "$(printf '%s\n' "$FUN" | shasum -a 256 | cut -c1-16)" = "c045cc571caf5d95" ] || { echo "PARE: o bloco de apoio v2 da F1 mudou (hash) — reler antes de usar"; exit 1; }
{
  echo '#!/usr/bin/env bash'
  echo '# GERADO por monta-aplica.sh (bloco literal da F1 + extra.sh). Não editar — editar extra.sh e regerar.'
  echo '[ -n "${BASH_VERSION:-}" ] || { echo "ERRO: use bash"; return 1 2>/dev/null || exit 1; }'
  echo 'LOCAL="postgresql://postgres:postgres@127.0.0.1:54422/postgres"'
  echo 'MIG_A=supabase/migrations/20261006100000_distribuicao_por_produto.sql'
  echo 'INV_A=supabase/rollback/20261006100000_distribuicao_por_produto_down.sql'
  echo 'MIG_B=supabase/migrations/20261006110000_distribuicao_antiga_remover.sql'
  echo 'INV_B=supabase/rollback/20261006110000_distribuicao_antiga_remover_down.sql'
  printf '%s\n' "$FUN"
  cat .superpowers/distribuicao/mig/extra.sh
} > .superpowers/distribuicao/mig/aplica.sh
bash -n .superpowers/distribuicao/mig/aplica.sh && echo "aplica.sh gerado (bloco F1 c045cc571caf5d95 + extra.sh)"
```

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/distribuicao-produto"
chmod +x .superpowers/distribuicao/mig/monta-aplica.sh && bash .superpowers/distribuicao/mig/monta-aplica.sh
bash -c 'source .superpowers/distribuicao/mig/aplica.sh && type espera ativ_vazio com_travas aplica_v2 prevoo_a confere_ida_a confere_volta_a prevoo_b confere_remocao_b confere_volta_b confere_cadeia_ref > /dev/null && echo definidas'
```

Expected: `aplica.sh gerado …` e `definidas`.

- [ ] **Step 3: `.superpowers/distribuicao/copia.sh` (ida/volta/remover/volta-remover na CÓPIA)**

```bash
#!/usr/bin/env bash
# Distribuição por produto na CÓPIA LOCAL (127.0.0.1:54422). NUNCA produção. Uso (de dentro da worktree):
#   DIST_DONO_AVISADO=sim bash .superpowers/distribuicao/copia.sh ida|volta|remover|volta-remover
set -uo pipefail
TOP="$(git rev-parse --show-toplevel)" || exit 1
case "$TOP" in */.claude/worktrees/distribuicao-produto) ;; *) echo "PARE: rode de dentro da worktree distribuicao-produto"; exit 1;; esac
cd "$TOP"
source .superpowers/distribuicao/mig/aplica.sh || exit 1
S=.superpowers/distribuicao
case "${1:-}" in ida|volta|remover|volta-remover) ;; *) echo "uso: copia.sh ida|volta|remover|volta-remover"; exit 2;; esac
echo "== CÓPIA · alvo: 127.0.0.1:54422 · HEAD $(git rev-parse --short HEAD) · $1"
bash "$S/n3.sh" antes "copia-$1" || exit 1
q() { psql "$LOCAL" -X -q -A -t -v ON_ERROR_STOP=1 -c "$1"; }
EA=$(q "$OBJ_A") && EB=$(q "$OBJ_B") && ANTES=$(q "$CONT") && FN0=$(q "$FN_PRE") || exit 1
echo "antes: funções|gatilhos = $ANTES · aditiva $EA · antiga $EB"
case "$1" in
  ida)
    [ "$EA" = "0|0|0" ] || { echo "a cópia JÁ tem a aditiva ($EA) — nada a fazer"; bash "$S/n3.sh" depois "copia-$1"; exit 0; }
    espera "$LOCAL" "$MD5_REDEF" "$(md5_de "$M/md5-redef-antes.txt")" "as 5 no texto que a guarda espera" || exit 1
    backup_copia ida || exit 1
    ativ_vazio "$LOCAL" && aplica_v2 "$LOCAL" "$MIG_A" && confere_ida_a "$LOCAL" "$ANTES" "$FN0" || exit 1 ;;
  volta)
    [ "$EA" = "2|2|2" ] && [ "$EB" = "1|4" ] || { echo "PARE: volta da aditiva exige a aditiva inteira E a antiga de volta (LIFO) — $EA / $EB"; exit 1; }
    backup_copia volta || exit 1
    ativ_vazio "$LOCAL" && EXTRA_SQL="SET LOCAL app.confirmo_apagar_distribuicao_por_produto = 'sim';" aplica_v2 "$LOCAL" "$INV_A" \
      && confere_volta_a "$LOCAL" "$ANTES" "$FN0" || exit 1 ;;
  remover)
    [ "$EA" = "2|2|2" ] && [ "$EB" = "1|4" ] || { echo "PARE: remover exige a aditiva E a antiga inteira — $EA / $EB"; exit 1; }
    mkdir -p "$S/logs" && psql "$LOCAL" -X -q -v ON_ERROR_STOP=1 -c "\copy (select * from public.distribuicao_tabelas order by tenant_id, colecao_id, ordem, id) to '$TOP/$S/logs/copia-distribuicao_tabelas.csv' csv header" || exit 1
    backup_copia remover || exit 1
    ativ_vazio "$LOCAL" && EXTRA_SQL="SET LOCAL app.confirmo_apagar_distribuicao_antiga = 'sim';" aplica_v2 "$LOCAL" "$MIG_B" \
      && confere_remocao_b "$LOCAL" "$ANTES" "$FN0" || exit 1 ;;
  volta-remover)
    [ "$EB" = "0|0" ] || { echo "PARE: a antiga não foi removida na cópia ($EB)"; exit 1; }
    backup_copia volta-remover || exit 1
    ativ_vazio "$LOCAL" && aplica_v2 "$LOCAL" "$INV_B" && confere_volta_b "$LOCAL" "$ANTES" "$FN0" || exit 1
    [ -s "$S/logs/copia-distribuicao_tabelas.csv" ] && psql "$LOCAL" -X -q -v ON_ERROR_STOP=1 \
      -c "\copy public.distribuicao_tabelas (id, tenant_id, colecao_id, subcolecao, nome, ordem, grade_base, cores, pecas_mes, lojas, created_at, updated_at) from '$TOP/$S/logs/copia-distribuicao_tabelas.csv' csv header" \
      && echo "dados da tabela antiga restaurados do CSV" ;;
esac
psql "$LOCAL" -X -q -c "NOTIFY pgrst, 'reload schema'"
DEPOIS=$(q "$CONT")
printf -- '- %s  %s  %s → %s\n' "$(date '+%F %T')" "$1" "$ANTES" "$DEPOIS" >> "$S/copia-estado.md"
bash "$S/n3.sh" depois "copia-$1"
echo "== CÓPIA: $1 OK ($ANTES → $DEPOIS)"
```

- [ ] **Step 4: `.superpowers/distribuicao/mig/ensaio-local.sh` (ENSAIO GERAL — termina com a cópia LIMPA e os dados antigos de volta)**

```bash
#!/usr/bin/env bash
# ENSAIO GERAL na CÓPIA (Task 10): N3 → backup → vizinhas antes → A (ida real) → conferências → suíte A aplicada → vizinhas
# depois → B (remoção real, com o CSV da tabela antiga exportado) → suíte B aplicada → volta B (+ dados) → re-remove →
# volta B (+ dados) → volta A → reida A → volta A. Termina com a cópia IGUAL a antes (contagens, outras funções, linhas
# da tabela antiga) e grava o md5 dos 4 SQL ENSAIADOS. Uso (de dentro da worktree, SÓ depois do OK do dono no chat):
#   DIST_DONO_AVISADO=sim /bin/bash .superpowers/distribuicao/mig/ensaio-local.sh 2>&1 | tee .superpowers/distribuicao/logs/ensaio.log
set -uo pipefail
TOP="$(git rev-parse --show-toplevel)" || exit 1
case "$TOP" in */.claude/worktrees/distribuicao-produto) ;; *) echo "PARE: rode de dentro da worktree distribuicao-produto"; exit 1;; esac
cd "$TOP"
source .superpowers/distribuicao/mig/aplica.sh || exit 1
S=.superpowers/distribuicao
q() { psql "$LOCAL" -X -q -A -t -v ON_ERROR_STOP=1 -c "$1"; }
echo "== ENSAIO · alvo: 127.0.0.1:54422 (cópia) · HEAD $(git rev-parse --short HEAD)"
bash "$S/n3.sh" antes t10 || exit 1
git diff --quiet HEAD -- "$MIG_A" "$INV_A" "$MIG_B" "$INV_B" || { echo "PARE: SQL com alteração não commitada"; exit 1; }
espera "$LOCAL" "$OBJ_A" "0|0|0" "cópia SEM a aditiva" && espera "$LOCAL" "$OBJ_B" "1|4" "cópia COM a antiga" || exit 1
espera "$LOCAL" "$MD5_REDEF" "$(md5_de "$M/md5-redef-antes.txt")" "as 5 no texto da guarda" || exit 1
espera "$LOCAL" "$MD5_ANTIGAS" "$(md5_de "$M/md5-antigas-antes.txt")" "as 4 antigas no texto da guarda" || exit 1
confere_arquivos || exit 1
ativ_vazio "$LOCAL" || exit 1
CONT0="$(q "$CONT")"; FN0="$(q "$FN_PRE")"; N0="$(q "$DADOS_B")"
echo "antes: contagens $CONT0 · outras funções $FN0 · linhas da tabela antiga $N0" | tee "$S/logs/ensaio-antes.txt"
backup_copia ensaio || exit 1
CSV="$TOP/$S/logs/ensaio-distribuicao_tabelas.csv"
q "\copy (select * from public.distribuicao_tabelas order by tenant_id, colecao_id, ordem, id) to '$CSV' csv header" > /dev/null || exit 1
VIZ="tests/integration/plan-tecido.test.ts tests/integration/plan-tecido-aplicar.test.ts tests/integration/casar-variantes-reserva.test.ts tests/integration/blindagem-snapshots.test.ts tests/integration/direcionamento-multilojas.test.ts tests/integration/colab-rev.test.ts tests/integration/colab-trava.test.ts tests/integration/kanban-condicoes.test.ts tests/integration/seguranca.test.ts"
falhas() { grep -E "^ FAIL " "$1" | sed -E 's/ +[0-9]+ms$//' | sort -u; }
total() { grep -E "^ +Tests +" "$1" | tail -1 | sed -E 's/.*\(([0-9]+)\).*/\1/'; }
viz() {
  # shellcheck disable=SC2086 — lista LITERAL, separada por espaço de propósito; SEMPRE com o DATABASE_URL da CÓPIA
  DATABASE_URL="$LOCAL" npx vitest run --no-file-parallelism $VIZ > "$S/logs/viz-$1.log" 2>&1
  falhas "$S/logs/viz-$1.log" > "$S/logs/viz-falhas-$1.txt"
  echo "VIZINHAS $1: $(grep -E '^ +Tests +' "$S/logs/viz-$1.log" | tail -1 | sed 's/^ *//') · $(wc -l < "$S/logs/viz-falhas-$1.txt" | tr -d ' ') falha(s)"
}
volta_b() {
  local cv fv; cv="$(q "$CONT")"; fv="$(q "$FN_PRE")"
  ativ_vazio "$LOCAL" && aplica_v2 "$LOCAL" "$INV_B" && confere_volta_b "$LOCAL" "$cv" "$fv" \
    && q "\copy public.distribuicao_tabelas (id, tenant_id, colecao_id, subcolecao, nome, ordem, grade_base, cores, pecas_mes, lojas, created_at, updated_at) from '$CSV' csv header" > /dev/null \
    && espera "$LOCAL" "$DADOS_B" "$N0" "VOLTA B: linhas da tabela antiga restauradas do CSV"
}
remove_b() {
  local cv fv; cv="$(q "$CONT")"; fv="$(q "$FN_PRE")"
  ativ_vazio "$LOCAL" && EXTRA_SQL="SET LOCAL app.confirmo_apagar_distribuicao_antiga = 'sim';" aplica_v2 "$LOCAL" "$MIG_B" \
    && confere_remocao_b "$LOCAL" "$cv" "$fv"
}
volta_a() {
  local cv fv; cv="$(q "$CONT")"; fv="$(q "$FN_PRE")"
  ativ_vazio "$LOCAL" && EXTRA_SQL="SET LOCAL app.confirmo_apagar_distribuicao_por_produto = 'sim';" aplica_v2 "$LOCAL" "$INV_A" \
    && confere_volta_a "$LOCAL" "$cv" "$fv"
}
viz antes
aplica_v2 "$LOCAL" "$MIG_A" || exit 1
confere_ida_a "$LOCAL" "$CONT0" "$FN0" || { volta_a; exit 1; }
DATABASE_URL="$LOCAL" npx vitest run --no-file-parallelism tests/integration/distribuicao-produto.test.ts > "$S/logs/ensaio-suite-a.log" 2>&1
grep -qE "Tests +14 passed" "$S/logs/ensaio-suite-a.log" && ! grep -qE "[0-9]+ failed" "$S/logs/ensaio-suite-a.log" \
  || { tail -8 "$S/logs/ensaio-suite-a.log"; echo "FALHOU: com a aditiva aplicada a suíte A tem de dar 14 passed"; volta_a; exit 1; }
viz depois
NOVAS="$(comm -13 "$S/logs/viz-falhas-antes.txt" "$S/logs/viz-falhas-depois.txt")"
TA="$(total "$S/logs/viz-antes.log")"; TD="$(total "$S/logs/viz-depois.log")"
if [ -z "$NOVAS" ] && [ -n "$TA" ] && [ "$TA" = "$TD" ]; then
  echo "OK (vizinhas): nenhuma falha nova ($(wc -l < "$S/logs/viz-falhas-antes.txt" | tr -d ' ') herdada(s)); $TA testes antes e depois"
else
  [ -n "$NOVAS" ] && echo "$NOVAS" | sed 's/^/FALHA NOVA: /'
  echo "FALHOU (vizinhas): falha nova ou total diferente (antes $TA, depois $TD)"; volta_a; exit 1
fi
remove_b || { volta_a; exit 1; }
DATABASE_URL="$LOCAL" npx vitest run --no-file-parallelism tests/integration/distribuicao-antiga-remover.test.ts > "$S/logs/ensaio-suite-b.log" 2>&1
grep -qE "Tests +3 passed \| 3 skipped|Tests +4 passed \| 3 skipped" "$S/logs/ensaio-suite-b.log" && ! grep -qE "[0-9]+ failed" "$S/logs/ensaio-suite-b.log" \
  || { tail -8 "$S/logs/ensaio-suite-b.log"; echo "FALHOU: suíte B com a remoção aplicada (esperado 3 estáticos + 1 'já aplicada' passed; 3 só-txn skipped)"; volta_b; volta_a; exit 1; }
volta_b || exit 1
remove_b || { volta_b; volta_a; exit 1; }
volta_b || exit 1
volta_a || exit 1
aplica_v2 "$LOCAL" "$MIG_A" && confere_ida_a "$LOCAL" "$CONT0" "$FN0" || { volta_a; exit 1; }
volta_a || exit 1
espera "$LOCAL" "$OBJ_A" "0|0|0" "FIM: sem a aditiva" && espera "$LOCAL" "$OBJ_B" "1|4" "FIM: antiga inteira" \
  && espera "$LOCAL" "$CONT" "$CONT0" "FIM: contagens" && espera "$LOCAL" "$FN_PRE" "$FN0" "FIM: outras funções" \
  && espera "$LOCAL" "$DADOS_B" "$N0" "FIM: linhas da tabela antiga" || exit 1
for e in A B; do
  if [ "$e" = A ]; then md5_arquivo "$MIG_A" > "$M/md5-A-mig.txt"; md5_arquivo "$INV_A" > "$M/md5-A-inv.txt"
  else md5_arquivo "$MIG_B" > "$M/md5-B-mig.txt"; md5_arquivo "$INV_B" > "$M/md5-B-inv.txt"; fi
done
bash "$S/n3.sh" depois t10
echo "== ENSAIO OK — cópia limpa ($CONT0; antiga com $N0 linha(s)); md5 A $(cat "$M/md5-A-mig.txt")/$(cat "$M/md5-A-inv.txt") · B $(cat "$M/md5-B-mig.txt")/$(cat "$M/md5-B-inv.txt")"
```

(A linha de conferência da suíte B aceita as 2 formas porque o `withTx` do bloco "já aplicada" roda com a cópia REMOVIDA: 3 estáticos + 1 = 4 passed e os 3 só-txn skipped. Se o formato do vitest for outro, conferir à mão e ajustar SÓ o `grep` — registrar em `desvios.md`.)

- [ ] **Step 5: `.superpowers/distribuicao/mig/ida-producao.sh` (ADITIVA — roda o DONO)**

```bash
#!/usr/bin/env bash
# IDA da ADITIVA (20261006100000) em PRODUÇÃO. Quem roda é o DONO, num Terminal NOVO:
#   cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/distribuicao-produto"
#   bash .superpowers/distribuicao/mig/ida-producao.sh 2>&1 | tee -a .superpowers/distribuicao/logs/prod-ida.log
# Ordem: guarda de URL → pasta 700 → estado/contagens/outras funções/retrato NA HORA → pré-voo SÓ LEITURA (F1 e reorganização
# no banco; aditiva ausente; antiga inteira; as 5 no texto da guarda; md5 dos SQL = o ensaiado; travas; cadeia da volta da
# F1; sem transação longa) → BACKUP public + auth → aplica_v2 → pós-condições → contagens → reload → "IDA OK".
set -uo pipefail
umask 077
unset EXTRA_SQL
TOP="$(git rev-parse --show-toplevel)" || exit 1
case "$TOP" in */.claude/worktrees/distribuicao-produto) ;; *) echo "PARE: rode de dentro da worktree distribuicao-produto (achei $TOP)"; exit 1;; esac
cd "$TOP"
source .superpowers/distribuicao/mig/aplica.sh || exit 1
confere_url_producao || exit 1
mkdir -p .superpowers/distribuicao/logs "$DS" && chmod 700 "$DS" || { echo "PARE: não criei $DS (700)"; exit 1; }
PROD="$(cat "$DBURL_FILE")"
echo "== IDA da Distribuição por produto (ADITIVA) em PRODUÇÃO $(date '+%F %T') · HEAD $(git rev-parse --short HEAD)"
EST=$(psql "$PROD" -X -q -A -t -v ON_ERROR_STOP=1 -c "$OBJ_A") || { echo "FALHOU: não conectou em produção"; exit 1; }
[ "$EST" = "0|0|0" ] || { echo "PARE: objetos da aditiva JÁ no banco ($EST) — ida anterior? avisar o controlador (nada foi feito)"; exit 1; }
CONT_ANTES=$(psql "$PROD" -X -q -A -t -v ON_ERROR_STOP=1 -c "$CONT") || exit 1
FN_ANTES=$(psql "$PROD" -X -q -A -t -v ON_ERROR_STOP=1 -c "$FN_PRE") || exit 1
echo "$CONT_ANTES" > "$DS/cont-antes-A.txt"; echo "$FN_ANTES" > "$DS/fn-pre-antes-A.txt"
echo "contagens antes (funções|gatilhos): $CONT_ANTES"
retrato_producao "$PROD" "$DS/fidelidade_prod_pre_A_detalhe.txt" || exit 1
prevoo_a "$PROD" "$DS/fidelidade_prod_pre_A_detalhe.txt" || { echo "== PAROU no pré-voo — nada foi aplicado"; exit 1; }
backup_banco "$PROD" "$DS" producao-pre-A || { echo "== PAROU no backup — nada foi aplicado"; exit 1; }
ativ_vazio "$PROD" && espera "$PROD" "$OBJ_A" "0|0|0" "ainda ausente logo antes do apply" && aplica_v2 "$PROD" "$MIG_A" \
  || { echo "== IDA NÃO CONCLUÍDA (erro no apply = nada do arquivo ficou) — avisar o controlador"; exit 1; }
confere_ida_a "$PROD" "$CONT_ANTES" "$FN_ANTES" \
  || { echo "== CONFERÊNCIA FALHOU — avisar o controlador (NÃO rodar o inverso sem OK do dono)"; exit 1; }
psql "$PROD" -X -q -A -t -v ON_ERROR_STOP=1 -c "$CONT" > "$DS/cont-depois-A.txt" || exit 1
psql "$PROD" -X -q -v ON_ERROR_STOP=1 -c "NOTIFY pgrst, 'reload schema'" \
  || { echo "== APLICADA, mas o reload do PostgREST falhou — rodar NOTIFY pgrst, 'reload schema' e avisar o controlador"; exit 1; }
echo "== IDA OK $(date '+%T') — contagens $CONT_ANTES → $(cat "$DS/cont-depois-A.txt"). Agora o passo 2 do RODAR (ref-volta-f1.sh aditiva)."
```

- [ ] **Step 6: `.superpowers/distribuicao/mig/remover-producao.sh` (REMOÇÃO — roda o DONO, DEPOIS do deploy no ar)**

```bash
#!/usr/bin/env bash
# REMOÇÃO da Distribuição antiga (20261006110000) em PRODUÇÃO — P-14 = B. SÓ DEPOIS do deploy do front novo NO AR e das
# abas recarregadas (inclusive o :5173). Exporta a tabela (CSV) e faz backup ANTES; pede a frase. O DONO roda:
#   cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/distribuicao-produto"
#   bash .superpowers/distribuicao/mig/remover-producao.sh 2>&1 | tee -a .superpowers/distribuicao/logs/prod-remocao.log
set -uo pipefail
umask 077
unset EXTRA_SQL
TOP="$(git rev-parse --show-toplevel)" || exit 1
case "$TOP" in */.claude/worktrees/distribuicao-produto) ;; *) echo "PARE: rode de dentro da worktree distribuicao-produto (achei $TOP)"; exit 1;; esac
cd "$TOP"
source .superpowers/distribuicao/mig/aplica.sh || exit 1
confere_url_producao || exit 1
mkdir -p .superpowers/distribuicao/logs "$DS" && chmod 700 "$DS" || exit 1
PROD="$(cat "$DBURL_FILE")"
echo "== REMOÇÃO da Distribuição antiga em PRODUÇÃO $(date '+%F %T') · HEAD $(git rev-parse --short HEAD)"
EA=$(psql "$PROD" -X -q -A -t -v ON_ERROR_STOP=1 -c "$OBJ_A") || { echo "FALHOU: não conectou em produção"; exit 1; }
EB=$(psql "$PROD" -X -q -A -t -v ON_ERROR_STOP=1 -c "$OBJ_B") || exit 1
[ "$EA" = "2|2|2" ] || { echo "PARE: a aditiva não está (inteira) em produção ($EA) — a remoção vem DEPOIS dela"; exit 1; }
[ "$EB" = "1|4" ] || { echo "PARE: a Distribuição antiga não está inteira ($EB) — já removida? avisar o controlador"; exit 1; }
N=$(psql "$PROD" -X -q -A -t -v ON_ERROR_STOP=1 -c "$DADOS_B") || exit 1
printf 'Isto APAGA a Distribuição antiga: a tabela distribuicao_tabelas (%s linha(s), exportadas antes) e 4 RPCs.\nO front NOVO já está no ar e as abas foram recarregadas (inclusive o :5173)? Digite APAGAR A DISTRIBUIÇÃO ANTIGA para seguir: ' "$N"
IFS= read -r RESP < /dev/tty || RESP=""
[ "$RESP" = "APAGAR A DISTRIBUIÇÃO ANTIGA" ] || { echo "cancelado — nada foi feito"; exit 1; }
CONT_ANTES=$(psql "$PROD" -X -q -A -t -v ON_ERROR_STOP=1 -c "$CONT") || exit 1
FN_ANTES=$(psql "$PROD" -X -q -A -t -v ON_ERROR_STOP=1 -c "$FN_PRE") || exit 1
echo "$CONT_ANTES" > "$DS/cont-antes-B.txt"; echo "$FN_ANTES" > "$DS/fn-pre-antes-B.txt"
retrato_producao "$PROD" "$DS/fidelidade_prod_pre_B_detalhe.txt" || exit 1
prevoo_b "$PROD" "$DS/fidelidade_prod_pre_B_detalhe.txt" || { echo "== PAROU no pré-voo — nada foi apagado"; exit 1; }
V="$DS/remocao-$(date +%F-%H%M%S)"; mkdir -p "$V" && chmod 700 "$V" || exit 1
psql "$PROD" -X -q -v ON_ERROR_STOP=1 -c "\copy (select * from public.distribuicao_tabelas order by tenant_id, colecao_id, ordem, id) to '$V/distribuicao_tabelas.csv' csv header" \
  || { echo "FALHOU o export — PARE (nada foi apagado)"; exit 1; }
chmod 600 "$V"/*.csv 2>/dev/null
[ -e "$V/distribuicao_tabelas.csv" ] || { echo "FALHOU: export sem arquivo — PARE"; exit 1; }
echo "export: $V/distribuicao_tabelas.csv"
backup_banco "$PROD" "$DS" producao-pre-B || { echo "== PAROU no backup — nada foi apagado"; exit 1; }
ativ_vazio "$PROD" && EXTRA_SQL="SET LOCAL app.confirmo_apagar_distribuicao_antiga = 'sim';" aplica_v2 "$PROD" "$MIG_B" \
  || { echo "== REMOÇÃO NÃO CONCLUÍDA (erro no apply = nada do arquivo ficou) — avisar o controlador"; exit 1; }
confere_remocao_b "$PROD" "$CONT_ANTES" "$FN_ANTES" || { echo "== CONFERÊNCIA FALHOU — avisar o controlador"; exit 1; }
psql "$PROD" -X -q -A -t -v ON_ERROR_STOP=1 -c "$CONT" > "$DS/cont-depois-B.txt" || exit 1
psql "$PROD" -X -q -v ON_ERROR_STOP=1 -c "NOTIFY pgrst, 'reload schema'" || { echo "== REMOVIDA, mas o reload falhou — rodar NOTIFY e avisar"; exit 1; }
echo "== REMOÇÃO OK $(date '+%T') — contagens $CONT_ANTES → $(cat "$DS/cont-depois-B.txt"). Agora o passo 5 do RODAR (ref-volta-f1.sh remocao)."
```

- [ ] **Step 7: `.superpowers/distribuicao/mig/ref-volta-f1.sh aditiva|remocao` (referência nova da volta da F1 — DONO, SÓ LEITURA)**

```bash
#!/usr/bin/env bash
# Distribuição por produto — REGRAVA a referência de fidelidade da VOLTA DE EMERGÊNCIA da F1 logo DEPOIS do "== IDA OK"
# (aditiva) e do "== REMOÇÃO OK" (remoção). NÃO crava o nome da anterior: usa a MAIS NOVA por mtime em $BF1 e, ANTES de
# gravar, prova que (1) desde o pré-voo SÓ esta etapa mudou o schema, (2) a mais nova bate com a produção FORA da F1 e da
# etapa, (3) a F1 não mexe nas chaves da etapa. Referência nova = a mais nova SEM as chaves da etapa + as linhas ATUAIS
# delas; CONT = linhas funcoes:|gatilhos: da nova, conferido com base + delta medido. SÓ LEITURA no banco. Roda o DONO:
#   /bin/bash --noprofile --norc .superpowers/distribuicao/mig/ref-volta-f1.sh aditiva|remocao
set -uo pipefail
umask 077
TOP="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)" || exit 1
case "$TOP" in */.claude/worktrees/distribuicao-produto) ;; *) echo "PARE: script fora da worktree distribuicao-produto"; exit 1;; esac
cd "$TOP"
source .superpowers/distribuicao/mig/aplica.sh || exit 1
confere_url_producao || exit 1
RB="${DIST_RB:-/Users/sunglee/PLM + Criação/plm-pcp/.superpowers/sdd/2026-09-22-kanban-automatico-f1-banco}"
PROD="$(cat "$DBURL_FILE")"
case "${1:-}" in
  aditiva) ETAPA=A; PAT="$PAT_A"; EXCL="$EXCL_A"; SUF=pos_distribuicao; OBJ="$OBJ_A"; OBJ_OK="2|2|2"; N_ESP=9 ;;
  remocao) ETAPA=B; PAT="$PAT_B"; EXCL="$EXCL_B"; SUF=pos_distribuicao_remocao; OBJ="$OBJ_B"; OBJ_OK="0|0"; N_ESP=0 ;;
  *) echo "uso: ref-volta-f1.sh aditiva|remocao"; exit 2 ;;
esac
REF_NOVA="$BF1/fidelidade_ref_volta_f1_${SUF}_detalhe.txt"
echo "== referência da volta da F1 ($1) $(date '+%F %T') · HEAD $(git rev-parse --short HEAD)"
[ ! -e "$REF_NOVA" ] || { echo "PARE: $REF_NOVA já existe — rodou 2×? avisar o controlador"; exit 1; }
q() { PGOPTIONS='-c default_transaction_read_only=on' psql "$PROD" -X -q -A -t -v ON_ERROR_STOP=1 -c "$1"; }
[ "$(q "$F1_OK")" = t ] || { echo "PARE: a F1 não está em produção"; exit 1; }
[ "$(q "$OBJ")" = "$OBJ_OK" ] || { echo "PARE: a etapa $ETAPA não está (inteira) em produção — rode DEPOIS do OK do script"; exit 1; }
for f in "cont-antes-$ETAPA.txt" "cont-depois-$ETAPA.txt" "fidelidade_prod_pre_${ETAPA}_detalhe.txt"; do
  [ -s "$DS/$f" ] || { echo "PARE: falta $DS/$f (gravado pelo script da etapa)"; exit 1; }
done
R=$(ref_mais_nova "$EXCL") || exit 1
echo "base = referência mais nova: $(basename "$R")"
NB=$(awk -F'=' -v pat="$PAT" '$1 ~ pat' "$R" | grep -c . || true)
if [ "$ETAPA" = A ]; then
  awk -F'=' -v pat="$PAT" '$1 ~ pat { print $1 }' "$R" | grep -qE '_direcionamento_plano_modelo|plan_tecido_variantes[.](distribuicao|atende)$' \
    && { echo "PARE: a base já tem objetos da aditiva — ordem trocada ou rodou 2×"; exit 1; }
else
  [ "$NB" = 21 ] || { echo "PARE: a base devia ter as 21 linhas da Distribuição antiga (achei $NB) — ordem trocada?"; exit 1; }
fi
POS="$DS/fidelidade_prod_${SUF}_detalhe.txt"
retrato_producao "$PROD" "$POS" || exit 1
OUTRAS=$(diff <(awk -F'=' -v pat="$PAT" '!($1 ~ pat)' "$DS/fidelidade_prod_pre_${ETAPA}_detalhe.txt" | LC_ALL=C sort) \
              <(awk -F'=' -v pat="$PAT" '!($1 ~ pat)' "$POS" | LC_ALL=C sort) | grep -E '^[<>]' || true)
[ -z "$OUTRAS" ] || { printf '%s\n' "$OUTRAS" | cut -c1-160 | head -20; echo "PARE: desde o pré-voo o schema mudou FORA desta etapa — avisar o controlador"; exit 1; }
confere_cadeia_ref "$POS" "$PAT" "$EXCL" || exit 1
KF1="$(mktemp -t dist-kf1.XXXXXX)"; chaves_f1 "$KF1" || { rm -f "$KF1"; exit 1; }
CRUZ=$(grep -E "$PAT" "$KF1" || true); rm -f "$KF1"
[ -z "$CRUZ" ] || { echo "$CRUZ"; echo "PARE: chaves desta etapa também mudadas pela F1 — avisar o controlador"; exit 1; }
N=$(awk -F'=' -v pat="$PAT" '$1 ~ pat' "$POS" | grep -c . || true)
[ "$N" = "$N_ESP" ] || { echo "PARE: esperava $N_ESP linhas desta etapa no retrato, achei $N"; exit 1; }
{ awk -F'=' -v pat="$PAT" '!($1 ~ pat)' "$R"; awk -F'=' -v pat="$PAT" '$1 ~ pat' "$POS"; } | LC_ALL=C sort > "$REF_NOVA"
CR="$(grep -c '^funcoes:' "$R")|$(grep -c '^gatilhos:' "$R")"
SB=$(basename "$R" _detalhe.txt); SB=${SB#fidelidade_ref_volta_f1_}
if [ -s "$BF1/cont_volta_f1_${SB}.txt" ] && [ "$(tr -d '[:space:]' < "$BF1/cont_volta_f1_${SB}.txt")" != "$CR" ]; then
  rm -f "$REF_NOVA"; echo "PARE: cont_volta_f1_${SB}.txt ≠ contagem da própria referência ($CR) — avisar o controlador"; exit 1
fi
A=$(tr -d '[:space:]' < "$DS/cont-antes-$ETAPA.txt"); P=$(tr -d '[:space:]' < "$DS/cont-depois-$ETAPA.txt")
ESP="$(( ${CR%|*} + ${P%|*} - ${A%|*} ))|$(( ${CR#*|} + ${P#*|} - ${A#*|} ))"
CV="$(grep -c '^funcoes:' "$REF_NOVA")|$(grep -c '^gatilhos:' "$REF_NOVA")"
[ "$CV" = "$ESP" ] || { rm -f "$REF_NOVA"; echo "PARE: CONT da referência nova ($CV) ≠ base ($CR) + delta medido ($A → $P) = $ESP"; exit 1; }
echo "$CV" > "$BF1/cont_volta_f1_${SUF}.txt"
MAIUS=$(printf '%s' "$SUF" | tr '[:lower:]_' '[:upper:]-')
{
  echo "# Volta de emergência da F1 DEPOIS da Distribuição por produto ($1) — $(date '+%F %T')"
  echo "# Base: $(basename "$R") (a mais nova quando esta rodou). No runbook v2 §9.2 trocar as 2 conferências finais por:"
  echo "espera \"\$PROD\" \"\$CONT\" \"$CV\" \"contagens pós-volta (com a Distribuição $1)\" &&"
  echo "fidelidade \"\$PROD\" \"\$D/fidelidade_prod_pos_volta.txt\" \"\$D/fidelidade_prod_pos_volta_detalhe.txt\" > /dev/null &&"
  echo "diff \"\$D/fidelidade_ref_volta_f1_${SUF}_detalhe.txt\" <(LC_ALL=C sort \"\$D/fidelidade_prod_pos_volta_detalhe.txt\") && echo \"== VOLTA OK (Distribuição $1)\""
  echo "# Encadeamento: a PRÓXIMA frente usa ESTA referência como base (é a mais nova por mtime)."
  echo "# Se esta etapa for DESFEITA, renomear fidelidade_ref_volta_f1_${SUF}_detalhe.txt e cont_volta_f1_${SUF}.txt para *.desfeita."
} | tee "$DS/LEIA-volta-f1-${SUF}.txt" > "$RB/VOLTA-F1-${MAIUS}.md"
echo "OK (referência nova p/ a volta da F1): $REF_NOVA — base $(basename "$R"); CONT esperado da volta: $CV"
```

- [ ] **Step 8: Voltas de emergência (DONO, com OK explícito)** — `.superpowers/distribuicao/mig/volta-producao.sh` (aditiva) e `volta-remocao-producao.sh` (remoção):

```bash
#!/usr/bin/env bash
# volta-producao.sh — VOLTA da ADITIVA em PRODUÇÃO. SÓ em emergência, com OK explícito do dono, DEPOIS do revert do front NO
# AR e das abas recarregadas. LIFO (R37): exige a Distribuição antiga DE VOLTA (rode antes volta-remocao-producao.sh se a
# remoção já foi feita). APAGA a distribuição e o "atende a" digitados (EXPORTA antes).
set -uo pipefail
umask 077
unset EXTRA_SQL
TOP="$(git rev-parse --show-toplevel)" || exit 1
case "$TOP" in */.claude/worktrees/distribuicao-produto) ;; *) echo "PARE: rode de dentro da worktree distribuicao-produto (achei $TOP)"; exit 1;; esac
cd "$TOP"
source .superpowers/distribuicao/mig/aplica.sh || exit 1
confere_url_producao || exit 1
PROD="$(cat "$DBURL_FILE")"
echo "== VOLTA da ADITIVA em PRODUÇÃO $(date '+%F %T') · HEAD $(git rev-parse --short HEAD)"
EA=$(psql "$PROD" -X -q -A -t -v ON_ERROR_STOP=1 -c "$OBJ_A") || { echo "FALHOU: não conectou"; exit 1; }
EB=$(psql "$PROD" -X -q -A -t -v ON_ERROR_STOP=1 -c "$OBJ_B") || exit 1
[ "$EA" = "2|2|2" ] || { echo "PARE: a aditiva não está inteira ($EA)"; exit 1; }
[ "$EB" = "1|4" ] || { echo "PARE: a Distribuição antiga não está de volta ($EB) — rode ANTES volta-remocao-producao.sh (LIFO)"; exit 1; }
N=$(psql "$PROD" -X -q -A -t -v ON_ERROR_STOP=1 -c "$DADOS_A") || exit 1
printf 'Isto APAGA a distribuição de %s cor(es) e o "atende a" de %s cor(es) (o export vem antes). Digite APAGAR A DISTRIBUIÇÃO POR PRODUTO para seguir: ' "${N%|*}" "${N#*|}"
IFS= read -r RESP < /dev/tty || RESP=""
[ "$RESP" = "APAGAR A DISTRIBUIÇÃO POR PRODUTO" ] || { echo "cancelado — nada foi feito"; exit 1; }
V="$DS/volta-A-$(date +%F-%H%M%S)"; mkdir -p "$V" && chmod 700 "$V" || exit 1
psql "$PROD" -X -q -v ON_ERROR_STOP=1 -c "\copy (select v.id, v.tenant_id, v.material_id, v.variante_tecido_id, v.cor_id, v.cor_apelido_id, v.distribuicao, v.atende from public.plan_tecido_variantes v where v.distribuicao <> '{}'::jsonb or v.atende is not null order by v.tenant_id, v.material_id, v.ordem) to '$V/plan_tecido_variantes_distribuicao.csv' csv header" \
  || { echo "FALHOU o export — PARE (nada foi desfeito)"; exit 1; }
chmod 600 "$V"/*.csv 2>/dev/null
backup_banco "$PROD" "$DS" producao-pre-volta-A || { echo "== PAROU no backup — nada foi desfeito"; exit 1; }
CV=$(psql "$PROD" -X -q -A -t -v ON_ERROR_STOP=1 -c "$CONT") || exit 1
FV=$(psql "$PROD" -X -q -A -t -v ON_ERROR_STOP=1 -c "$FN_PRE") || exit 1
ativ_vazio "$PROD" && EXTRA_SQL="SET LOCAL app.confirmo_apagar_distribuicao_por_produto = 'sim';" aplica_v2 "$PROD" "$INV_A" \
  && confere_volta_a "$PROD" "$CV" "$FV" && psql "$PROD" -X -q -c "NOTIFY pgrst, 'reload schema'" \
  && echo "== VOLTA A OK $(date '+%T') — a referência 'pos_distribuicao' da volta da F1 deixou de valer: ver $DS/LEIA-volta-f1-pos_distribuicao.txt" \
  || { echo "== VOLTA A NÃO CONCLUÍDA — avisar o controlador/dono"; exit 1; }
```

```bash
#!/usr/bin/env bash
# volta-remocao-producao.sh — VOLTA da REMOÇÃO em PRODUÇÃO (recria a tabela antiga + 4 RPCs e devolve os DADOS do CSV
# exportado pelo remover-producao.sh). SÓ com OK explícito do dono. Vem ANTES da volta da aditiva (LIFO).
set -uo pipefail
umask 077
unset EXTRA_SQL
TOP="$(git rev-parse --show-toplevel)" || exit 1
case "$TOP" in */.claude/worktrees/distribuicao-produto) ;; *) echo "PARE: rode de dentro da worktree distribuicao-produto (achei $TOP)"; exit 1;; esac
cd "$TOP"
source .superpowers/distribuicao/mig/aplica.sh || exit 1
confere_url_producao || exit 1
PROD="$(cat "$DBURL_FILE")"
echo "== VOLTA da REMOÇÃO em PRODUÇÃO $(date '+%F %T') · HEAD $(git rev-parse --short HEAD)"
EB=$(psql "$PROD" -X -q -A -t -v ON_ERROR_STOP=1 -c "$OBJ_B") || { echo "FALHOU: não conectou"; exit 1; }
[ "$EB" = "0|0" ] || { echo "PARE: a Distribuição antiga não foi removida ($EB) — nada a voltar"; exit 1; }
CSV=$(ls -t "$DS"/remocao-*/distribuicao_tabelas.csv 2>/dev/null | head -1)
[ -n "$CSV" ] || { echo "PARE: não achei o CSV exportado pela remoção em $DS/remocao-*/"; exit 1; }
echo "dados a restaurar: $CSV"
backup_banco "$PROD" "$DS" producao-pre-volta-B || { echo "== PAROU no backup — nada foi feito"; exit 1; }
CV=$(psql "$PROD" -X -q -A -t -v ON_ERROR_STOP=1 -c "$CONT") || exit 1
FV=$(psql "$PROD" -X -q -A -t -v ON_ERROR_STOP=1 -c "$FN_PRE") || exit 1
ativ_vazio "$PROD" && aplica_v2 "$PROD" "$INV_B" && confere_volta_b "$PROD" "$CV" "$FV" \
  || { echo "== VOLTA B NÃO CONCLUÍDA — avisar o controlador/dono"; exit 1; }
psql "$PROD" -X -q -v ON_ERROR_STOP=1 -c "\copy public.distribuicao_tabelas (id, tenant_id, colecao_id, subcolecao, nome, ordem, grade_base, cores, pecas_mes, lojas, created_at, updated_at) from '$CSV' csv header" \
  || { echo "== ESTRUTURA DE VOLTA, mas os DADOS não voltaram — avisar o controlador (o backup e o CSV estão em $DS)"; exit 1; }
psql "$PROD" -X -q -c "NOTIFY pgrst, 'reload schema'"
echo "== VOLTA B OK $(date '+%T') — linhas: $(psql "$PROD" -X -q -A -t -c "$DADOS_B"); a referência 'pos_distribuicao_remocao' deixou de valer (LEIA-volta-f1-pos_distribuicao_remocao.txt)"
```

- [ ] **Step 9: `.superpowers/distribuicao/mig/prova-scripts.sh` — provas SEM banco nenhum**

```bash
#!/usr/bin/env bash
# Provas dos scripts de PRODUÇÃO desta frente SEM tocar em banco: `psql` e `docker` FALSOS no PATH, URL sintética num arquivo
# do scratch, DS/BF1/RB no scratch. NUNCA o /tmp/dburl.txt real, NUNCA host real. Uso: bash .superpowers/distribuicao/mig/prova-scripts.sh
set -uo pipefail
TOP="$(git rev-parse --show-toplevel)" || exit 1
case "$TOP" in */.claude/worktrees/distribuicao-produto) ;; *) echo "PARE: rode de dentro da worktree distribuicao-produto"; exit 1;; esac
cd "$TOP"
M=.superpowers/distribuicao/mig
BF1_REAL="/Users/sunglee/PLM + Criação/savepoints/pre-apply-f1-kanban-auto"
SC="$(mktemp -d -t dist-prova.XXXXXX)"; export DIST_PROVA_SC="$SC"
trap 'rm -rf "$SC"' EXIT      # apaga SÓ o scratch que ela mesma criou
FB="$SC/bin"; mkdir -p "$FB" "$SC/ds" "$SC/bf1" "$SC/rb"
ls -l "$BF1_REAL" > "$SC/bf1-real-antes.txt"
FALHAS=0; ok() { echo "OK (prova): $1"; }; ruim() { echo "FALHOU (prova): $1"; FALHAS=$((FALHAS + 1)); }

# 1) guarda de URL (regex ANCORADA)
source "$M/aplica.sh"
while IFS='|' read -r esperado url; do
  if printf '%s\n' "$url" | grep -Eq "$REGEX_URL_PROD"; then got=aceita; else got=recusa; fi
  [ "$got" = "$esperado" ] && ok "regex $esperado ${url%%@*}@…" || ruim "regex: $url → $got (esperado $esperado)"
done <<'URLS'
aceita|postgresql://postgres:x@db.ruinwcuabilumcspeyjk.supabase.co:5432/postgres
aceita|postgresql://postgres.ruinwcuabilumcspeyjk@prova.invalid.pooler.supabase.com:6543/postgres
recusa|postgresql://postgres:postgres@127.0.0.1:54422/postgres
recusa|postgresql://postgres:x@127.0.0.1:54422/postgres?application_name=ruinwcuabilumcspeyjk
recusa|postgresql://postgres:x@evil.invalid/db.ruinwcuabilumcspeyjk.supabase.co
URLS

# 2) fakes — o psql responde pelo TEXTO da consulta; estado ∈ antes | a | b (aditiva aplicada | + remoção)
cat > "$FB/psql" <<'FAKE'
#!/usr/bin/env bash
SC="${DIST_PROVA_SC:?}"; sql=""; saida=""
while [ $# -gt 0 ]; do case "$1" in -c) sql="$2"; shift 2;; -o) saida="$2"; shift 2;; *) shift;; esac; done
printf '%s\n' "$(printf '%s' "$sql" | tr '\n' ' ' | cut -c1-140)" >> "$SC/psql.log"
est="$(cat "$SC/estado")"
r() { if [ -n "$saida" ]; then printf '%s\n' "$1" > "$saida"; else printf '%s\n' "$1"; fi; }
case "$sql" in
  *"DROP COLUMN IF EXISTS distribuicao"*) echo "APPLY INV_A" >> "$SC/psql.log"; echo antes > "$SC/estado"; exit 0;;
  *"DROP TABLE IF EXISTS public.distribuicao_tabelas"*) echo "APPLY MIG_B" >> "$SC/psql.log"; echo b > "$SC/estado"; exit 0;;
  *"CREATE TABLE IF NOT EXISTS public.distribuicao_tabelas"*) echo "APPLY INV_B" >> "$SC/psql.log"; echo a > "$SC/estado"; exit 0;;
  *"ADD COLUMN IF NOT EXISTS distribuicao jsonb"*) echo "APPLY MIG_A" >> "$SC/psql.log"; echo a > "$SC/estado"; exit 0;;
  *"\\copy ("*) p=$(printf '%s' "$sql" | sed -n "s/.* to '\([^']*\)'.*/\1/p"); [ -n "$p" ] && printf 'id\n' > "$p"; exit 0;;
  *"\\copy public."*) exit 0;;
  *"NOTIFY pgrst"*) exit 0;;
  *"SELECT cat || ':' || k || '=' || v"*) cat "$SC/retrato-$est.txt"; exit 0;;
  *"pg_stat_activity"*) r 0;;
  *"server_version_num"*) r t;;
  *"kanban_mover"*) r t;;
  *"_titulo_pagina_calculado"*) r "${FAKE_REORG:-t}";;
  *"plan_tecido_variantes_distribuicao_objeto"*) case "$est" in antes) r "${FAKE_OBJ_A:-0|0|0}";; *) r "2|2|2";; esac;;
  *"to_regclass('public.distribuicao_tabelas') is not null)::int"*) case "$est" in b) r "0|0";; *) r "1|4";; esac;;
  *"select string_agg(coalesce(md5"*"_salvar_plan_tecido_core"*) if [ "$est" = antes ]; then r "$(cat "$SC/md5-redef-antes")"; else r "$(cat "$SC/md5-redef-depois")"; fi;;
  *"select string_agg(coalesce(md5"*"_direcionamento_plano_modelo_core"*) if [ "$est" = antes ]; then r "-|-"; else r "$(cat "$SC/md5-novas")"; fi;;
  *"select string_agg(coalesce(md5"*"direcionamento_resumo_subcolecao"*) if [ "$est" = b ]; then r "-|-|-|-"; else r "$(cat "$SC/md5-antigas")"; fi;;
  *"has_function_privilege"*) r "0|1|0|1";;
  *"string_agg(p.oid::regprocedure::text"*) r "fnpre-prova|471";;
  *"distribuicao <> '{}'::jsonb"*) r "3|1";;
  *"modules ->> 'distribuicao'"*) r "2|4|0";;
  *"select count(*) from public.distribuicao_tabelas"*) r 4;;
  *"from pg_trigger t join pg_class c"*) case "$est" in antes) r "484|277";; a) r "486|277";; b) r "482|276";; esac;;
  *) echo "psql falso: consulta não prevista: $(printf '%s' "$sql" | cut -c1-100)" >&2; exit 3;;
esac
FAKE
cat > "$FB/docker" <<'FAKE'
#!/usr/bin/env bash
SC="${DIST_PROVA_SC:?}"; echo "docker $*" | cut -c1-140 >> "$SC/docker.log"
case "$1" in
  ps) echo supabase_db_banco-local;;
  exec) if printf '%s ' "$@" | grep -q 'pg_restore -l'; then cat > /dev/null
          printf '1; 0 0 TABLE DATA public modelos postgres\n2; 0 0 TABLE DATA auth users postgres\n'
        else cat > /dev/null; echo FAKEDUMP; fi;;
  *) echo "docker falso: não previsto: $*" >&2; exit 3;;
esac
FAKE
chmod +x "$FB/psql" "$FB/docker"
export PATH="$FB:$PATH"
[ "$(command -v psql)" = "$FB/psql" ] && [ "$(command -v docker)" = "$FB/docker" ] || { echo "PARE: os fakes não estão na frente do PATH"; exit 1; }
export DIST_DBURL_FILE="$SC/url.txt" DIST_DS="$SC/ds" DIST_BF1="$SC/bf1" DIST_RB="$SC/rb"
printf '%s\n' "postgresql://postgres.ruinwcuabilumcspeyjk@prova.invalid.pooler.supabase.com:6543/postgres" > "$SC/url.txt"
tr -d '[:space:]' < "$M/md5-redef-antes.txt" > "$SC/md5-redef-antes"; tr -d '[:space:]' < "$M/md5-redef-depois.txt" > "$SC/md5-redef-depois"
tr -d '[:space:]' < "$M/md5-novas-depois.txt" > "$SC/md5-novas"; tr -d '[:space:]' < "$M/md5-antigas-antes.txt" > "$SC/md5-antigas"
# retratos: F1 (pré/pós) e a cadeia REAL pós-sem-trava (cópias, só leitura) como base; "a" = base com as 5 redefinidas
# trocadas + 2 funções + 2 colunas; "b" = "a" sem as 21 linhas da Distribuição antiga.
cp "$BF1_REAL/fidelidade_prod_pre_detalhe.txt" "$BF1_REAL/fidelidade_prod_pos_detalhe.txt" "$BF1_REAL/bloco_apoio_v2.sh" "$SC/bf1/"
cp "$BF1_REAL/fidelidade_ref_volta_f1_pos_sem_trava_detalhe.txt" "$BF1_REAL/cont_volta_f1_pos_sem_trava.txt" "$SC/bf1/"
cp "$BF1_REAL/fidelidade_prod_pos_sem_trava_detalhe.txt" "$SC/retrato-antes.txt"
{ awk -F'=' '$1 !~ /^funcoes:public[.](_salvar_plan_tecido_core|_plan_tecido_gravar_bom_core|_plan_tecido_snapshot|tenant_module_enabled|_plan_tecido_arvore_core)[(]/' "$SC/retrato-antes.txt"
  cat <<'L'
funcoes:public._salvar_plan_tecido_core(uuid,jsonb,integer)=prova-1|t|search_path=public|f|f|t|f
funcoes:public._plan_tecido_gravar_bom_core(uuid,jsonb)=prova-2|t|search_path=public|f|f|t|f
funcoes:public._plan_tecido_snapshot(uuid)=prova-3|t|search_path=public|f|f|t|f
funcoes:public.tenant_module_enabled(text)=prova-4|t|search_path=public|t|t|t|t
funcoes:public._plan_tecido_arvore_core(uuid)=prova-5|t|search_path=public|f|f|t|f
funcoes:public._direcionamento_plano_modelo_core(uuid,uuid)=prova-6|t|search_path=public|f|f|t|f
funcoes:public.direcionamento_plano_modelo(uuid)=prova-7|t|search_path=public|f|t|t|f
colunas:public.plan_tecido_variantes.atende=r|jsonb|f|-||
colunas:public.plan_tecido_variantes.distribuicao=r|jsonb|t|'{}'::jsonb||
L
} > "$SC/retrato-a.txt"
awk -F'=' -v pat="$PAT_B" '!($1 ~ pat)' "$SC/retrato-a.txt" > "$SC/retrato-b.txt"
[ "$(( $(wc -l < "$SC/retrato-a.txt") - $(wc -l < "$SC/retrato-b.txt") ))" = 21 ] && ok "retrato 'b' = 'a' − 21 linhas da antiga (PAT_B casa as categorias reais)" || ruim "PAT_B não casou 21 linhas"
roda() { : > "$SC/psql.log"; : > "$SC/docker.log"; bash "$@" > "$SC/out.txt" 2>&1; echo $? > "$SC/rc"; }

# 3) caminho feliz: aditiva → ref aditiva (+2|0, base + 4 linhas) → remoção (com a frase) → ref remoção (−4|−1, − 21 linhas)
echo antes > "$SC/estado"; roda "$M/ida-producao.sh"
grep -q "== IDA OK" "$SC/out.txt" && ok "ida A: IDA OK" || { tail -15 "$SC/out.txt"; ruim "ida A sem IDA OK"; }
grep -q "pg_dump" "$SC/docker.log" && ok "ida A: backup (public+auth) rodou" || ruim "ida A sem backup"
grep -q "APPLY MIG_A" "$SC/psql.log" && ok "ida A: apply rodou" || ruim "ida A sem apply"
roda "$M/ref-volta-f1.sh" aditiva
grep -q "CONT esperado da volta: 454|233" "$SC/out.txt" && ok "ref aditiva: 452|233 + 2|0 = 454|233" || { tail -15 "$SC/out.txt"; ruim "ref aditiva"; }
[ "$(wc -l < "$SC/bf1/fidelidade_ref_volta_f1_pos_distribuicao_detalhe.txt")" = "$(( $(wc -l < "$SC/bf1/fidelidade_ref_volta_f1_pos_sem_trava_detalhe.txt") + 4 ))" ] \
  && ok "referência aditiva = base + 4 linhas (2 colunas + 2 funções novas; 5 trocadas)" || ruim "linhas da referência aditiva"
roda "$M/ref-volta-f1.sh" aditiva
grep -q "já existe — rodou 2×" "$SC/out.txt" && ok "ref aditiva 2× ⇒ PARE" || ruim "ref aditiva 2× não parou"
# a frase vem de /dev/tty no script real; na prova, cópias do script trocam SÓ essa leitura por uma resposta fixa
# (nunca fica esperando teclado, com ou sem terminal)
sed 's#< /dev/tty#<<< "APAGAR A DISTRIBUIÇÃO ANTIGA"#' "$M/remover-producao.sh" > "$SC/remover-prova.sh"
sed 's#< /dev/tty#<<< "apagar"#' "$M/remover-producao.sh" > "$SC/remover-errado.sh"
sed 's#< /dev/tty#<<< "apagar"#' "$M/volta-producao.sh" > "$SC/volta-errado.sh"
for f in remover-prova remover-errado volta-errado; do grep -q '/dev/tty' "$SC/$f.sh" && ruim "$f ainda lê /dev/tty"; done
roda "$SC/remover-errado.sh"
grep -q "cancelado — nada foi feito" "$SC/out.txt" && ! grep -q "APPLY MIG_B" "$SC/psql.log" && [ ! -s "$SC/docker.log" ] && ok "remoção com a frase errada ⇒ cancelada antes do export/backup" || ruim "remoção com frase errada"
touch -t 203001010000 "$SC/bf1/fidelidade_ref_volta_f1_pos_distribuicao_detalhe.txt"   # garante que é a mais nova por mtime
roda "$SC/remover-prova.sh"
grep -q "== REMOÇÃO OK" "$SC/out.txt" && grep -q "APPLY MIG_B" "$SC/psql.log" && ok "remoção: OK com export + backup + apply" || { tail -15 "$SC/out.txt"; ruim "remoção"; }
roda "$M/ref-volta-f1.sh" remocao
grep -q "CONT esperado da volta: 450|232" "$SC/out.txt" && ok "ref remoção: 454|233 − 4|1 = 450|232" || { tail -15 "$SC/out.txt"; ruim "ref remoção"; }
[ "$(wc -l < "$SC/bf1/fidelidade_ref_volta_f1_pos_distribuicao_remocao_detalhe.txt")" = "$(( $(wc -l < "$SC/bf1/fidelidade_ref_volta_f1_pos_distribuicao_detalhe.txt") - 21 ))" ] \
  && ok "referência da remoção = anterior − 21 linhas" || ruim "linhas da referência da remoção"

# 4) negativos
rm -f "$SC/ds/"*.txt
echo antes > "$SC/estado"; FAKE_REORG=f roda "$M/ida-producao.sh"
grep -q "PAROU no pré-voo" "$SC/out.txt" && ! grep -q "APPLY" "$SC/psql.log" && [ ! -s "$SC/docker.log" ] \
  && ok "reorganização ausente ⇒ PARE antes do backup/apply" || ruim "ordem da reorganização não barrou"
echo antes > "$SC/estado"; FAKE_OBJ_A="2|2|2" roda "$M/ida-producao.sh"
grep -q "JÁ no banco" "$SC/out.txt" && ! grep -q "APPLY" "$SC/psql.log" && ok "aditiva já aplicada ⇒ PARE" || ruim "reaplicação não barrou"
echo antes > "$SC/estado"
mv "$SC/bf1/fidelidade_ref_volta_f1_pos_distribuicao_detalhe.txt" "$SC/pd.bak"; mv "$SC/bf1/fidelidade_ref_volta_f1_pos_distribuicao_remocao_detalhe.txt" "$SC/pdr.bak"
cp "$SC/retrato-antes.txt" "$SC/retrato-antes.bak"
sed 's/^\(funcoes:public[.]fn_oc_nota_entrada_valida()=\)[0-9a-f]*/\1md5deoutrafrente/' "$SC/retrato-antes.bak" > "$SC/retrato-antes.txt"
! diff -q "$SC/retrato-antes.bak" "$SC/retrato-antes.txt" > /dev/null || ruim "a linha de outra frente não mudou (fn_oc_nota_entrada_valida sumiu do retrato?)"
roda "$M/ida-producao.sh"
grep -q "NÃO bate com a produção" "$SC/out.txt" && ! grep -q "APPLY" "$SC/psql.log" && [ ! -s "$SC/docker.log" ] \
  && ok "cadeia da volta da F1 quebrada ⇒ PARE antes do backup/apply" || ruim "cadeia quebrada não barrou"
mv "$SC/retrato-antes.bak" "$SC/retrato-antes.txt"
printf '%s\n' "postgresql://postgres:postgres@127.0.0.1:54422/postgres" > "$SC/url.txt"
roda "$M/ida-producao.sh"
grep -q "não aponta p/ o banco sisTrama" "$SC/out.txt" && [ ! -s "$SC/psql.log" ] && ok "URL fora do padrão ⇒ PARE antes de qualquer psql" || ruim "guarda de URL"
printf '%s\n' "postgresql://postgres.ruinwcuabilumcspeyjk@prova.invalid.pooler.supabase.com:6543/postgres" > "$SC/url.txt"
echo b > "$SC/estado"; roda "$SC/volta-errado.sh"
grep -q "rode ANTES volta-remocao-producao.sh" "$SC/out.txt" && ! grep -q "APPLY" "$SC/psql.log" && ok "volta da aditiva com a antiga removida ⇒ PARE (LIFO)" || ruim "LIFO da volta"
echo a > "$SC/estado"; roda "$SC/volta-errado.sh"
grep -q "cancelado — nada foi feito" "$SC/out.txt" && ! grep -q "APPLY" "$SC/psql.log" && [ ! -s "$SC/docker.log" ] && ok "volta A com a frase errada ⇒ cancelada antes do export/backup" || ruim "volta A com frase errada"
echo antes > "$SC/estado"; roda "$SC/remover-prova.sh"
grep -q "a aditiva não está" "$SC/out.txt" && ! grep -q "APPLY" "$SC/psql.log" && ok "remoção sem a aditiva ⇒ PARE" || ruim "remoção sem aditiva"

# 5) nada real foi tocado
ls -l "$BF1_REAL" > "$SC/bf1-real-depois.txt"
diff -q "$SC/bf1-real-antes.txt" "$SC/bf1-real-depois.txt" > /dev/null && ok "pasta REAL da F1 intocada" || ruim "a pasta real da F1 mudou!"
[ "$FALHAS" = 0 ] && echo "== PROVAS OK" || { echo "== PROVAS FALHARAM ($FALHAS)"; exit 1; }
```

(A prova usa a cadeia REAL pós-sem-trava como base — a referência da reorganização (`…_pos_sheet_…`) ainda não existe no planejamento; no dia, a mais nova será a da reorganização e o script a usa sem mudar nada. Se algum `grep` de prova divergir por formato, ajustar SÓ a prova e registrar em `desvios.md`; mudar lógica de script ⇒ G-scripts de novo.)

- [ ] **Step 10: `RODAR-distribuicao.md` — em `/Users/sunglee/PLM + Criação/savepoints/pre-apply-distribuicao/` (pasta 700)**

```bash
D="/Users/sunglee/PLM + Criação/savepoints/pre-apply-distribuicao"; mkdir -p "$D" && chmod 700 "$D"
```

Conteúdo (o controlador preenche as `sha256` no Step 12):

```markdown
# RODAR — Distribuição por produto em PRODUÇÃO (2 momentos: ADITIVA antes do merge; REMOÇÃO depois do deploy)
Quem roda: o DONO, num Terminal NOVO (nada de variável DIST_* exportada). Pasta: /Users/sunglee/PLM + Criação/savepoints/pre-apply-distribuicao/

## Antes
1. A Reorganização do Sheet (20261005100000) JÁ está em produção COM a referência dela da volta da F1 (ref-volta-f1 da
   reorganização). O pré-voo confere a reorganização por objeto e a cadeia — divergência = PARA, de propósito.
2. O controlador avisou no chat "pode rodar a Distribuição" (G-migration A/B + G-scripts aprovados; seu OK registrado).
3. Horário calmo.
4. Conferir os scripts: `cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/distribuicao-produto" && shasum -a 256 .superpowers/distribuicao/mig/{aplica,ida-producao,ref-volta-f1,remover-producao,volta-producao,volta-remocao-producao}.sh | cut -c1-16`
   Tem de dar: aplica `<sha>` · ida-producao `<sha>` · ref-volta-f1 `<sha>` · remover-producao `<sha>` · volta-producao `<sha>` · volta-remocao-producao `<sha>`.

## MOMENTO 1 — ADITIVA (antes do merge do front)
### Passo 1 — ida (o backup completo public + auth é feito DENTRO do script, antes de aplicar)
    cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/distribuicao-produto"
    bash .superpowers/distribuicao/mig/ida-producao.sh 2>&1 | tee -a .superpowers/distribuicao/logs/prod-ida.log
Esperado no fim: `== IDA OK … contagens N|M → N+2|M`. No pré-voo aparece `INFO (pré-voo, não bloqueia): lojas com o módulo |
casamentos no BOM | permissões 'distribuicao' órfãs = a|b|c` — mandar no chat. Qualquer PARE/FALHOU: parar e mandar o log.
### Passo 2 — referência nova da volta de emergência da F1 (SÓ LEITURA)
    /bin/bash --noprofile --norc .superpowers/distribuicao/mig/ref-volta-f1.sh aditiva 2>&1 | tee -a .superpowers/distribuicao/logs/prod-ref-volta-f1.log
Esperado: `OK (referência nova p/ a volta da F1): … CONT esperado da volta: <N|M>`.
### Passo 3 — avisar no chat: "Distribuição: IDA OK e referência OK"
(o controlador faz o merge + a cópia na mesma hora, a QA e só então pede o deploy)

## MOMENTO 2 — REMOÇÃO da Distribuição antiga (SÓ depois do deploy NO AR e das abas recarregadas, inclusive o :5173)
### Passo 4 — remover (exporta a tabela em CSV e faz o backup ANTES; pede a frase APAGAR A DISTRIBUIÇÃO ANTIGA)
    bash .superpowers/distribuicao/mig/remover-producao.sh 2>&1 | tee -a .superpowers/distribuicao/logs/prod-remocao.log
Esperado: `== REMOÇÃO OK … contagens N|M → N−4|M−1`.
### Passo 5 — referência nova da volta da F1 (SÓ LEITURA)
    /bin/bash --noprofile --norc .superpowers/distribuicao/mig/ref-volta-f1.sh remocao 2>&1 | tee -a .superpowers/distribuicao/logs/prod-ref-volta-f1.log
### Passo 6 — avisar no chat: "Distribuição: REMOÇÃO OK e referência OK"

## Voltas de emergência (SÓ com o seu OK explícito) — ordem LIFO
1. Primeiro o FRONT: revert na branch principal + deploy do revert NO AR + abas recarregadas.
2. Se a remoção já foi feita: `bash .superpowers/distribuicao/mig/volta-remocao-producao.sh` (recria a tabela e as 4 RPCs e devolve os dados do CSV).
3. Depois: `bash .superpowers/distribuicao/mig/volta-producao.sh` (pede APAGAR A DISTRIBUIÇÃO POR PRODUTO; exporta antes).
4. Renomear as referências `…_pos_distribuicao_remocao_…`/`…_pos_distribuicao_…` (e os `cont_volta_f1_…`) para `*.desfeita` (LEIA-volta-f1-*.txt).
5. Se a reorganização do Sheet também tiver de voltar: ESTA volta PRIMEIRO.
```

- [ ] **Step 11: N3 + ENSAIO na cópia**

Pré-condição: G-migration A e B APROVADOS. Com o OK do dono:

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/distribuicao-produto"
chmod +x .superpowers/distribuicao/copia.sh .superpowers/distribuicao/mig/*.sh
DIST_DONO_AVISADO=sim /bin/bash .superpowers/distribuicao/mig/ensaio-local.sh 2>&1 | tee .superpowers/distribuicao/logs/ensaio.log | tail -40
```

Expected: `OK (IDA: …)` ×7, `14 passed`, `OK (vizinhas): nenhuma falha nova …`, `OK (REMOÇÃO: …)` ×4, as voltas `OK (VOLTA …)` e `== ENSAIO OK — cópia limpa (<CONT0>; antiga com 4 linha(s))`. Qualquer FALHOU ⇒ o script já devolveu a cópia — PARE e reporte.

- [ ] **Step 12: Provas dos scripts + sha256 no RODAR**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/distribuicao-produto"
bash .superpowers/distribuicao/mig/prova-scripts.sh 2>&1 | tee .superpowers/distribuicao/logs/provas.log | tail -30
shasum -a 256 .superpowers/distribuicao/mig/{aplica,ida-producao,ref-volta-f1,remover-producao,volta-producao,volta-remocao-producao}.sh | cut -c1-16
```

Expected: `== PROVAS OK` (≈ 25 `OK (prova)`); o controlador copia as 6 sha256 para o `RODAR-distribuicao.md`.

- [ ] **Step 13: G-scripts — revisão Opus + guardião** — com o plano, os scripts, o `aplica.sh`, os logs do ensaio e das provas. Checklist: guarda de URL ancorada antes de qualquer `psql`; `umask 077`; `unset EXTRA_SQL`; backup public+auth (TABLE DATA > 0, `pg_restore -l`) ANTES de cada apply em produção; export CSV antes de cada coisa que apaga dado; md5 dos SQL = ensaiados; pré-voo SÓ LEITURA completo (F1, reorganização, objetos, md5 das redefinidas/antigas, travas, cadeia da F1 com PAT pelas categorias reais, `ativ_vazio`); pós-condições antes do "OK"; contagens por diferença (+2|0, −4|−1); frase digitada na remoção e nas voltas; LIFO nas voltas; referências da F1 encadeadas (a mais nova por mtime, nunca cravada); provas só com fakes.

---
## Task 11: Portões finais, PRODUÇÃO A (dono) → merge + cópia → QA → deploy → REMOÇÃO (dono) → docs  *(controlador + guardião + dono — não é código)*

> ⛔ Ordem (R36): Steps 1–3 registrados ⇒ a REORGANIZAÇÃO do Sheet em produção com a referência dela ⇒ ADITIVA (dono, Step 4) ⇒ referência da F1 (dono) ⇒ merge + cópia NUM comando (Step 6) ⇒ QA (Step 7) ⇒ deploy pelo portão (Step 8) ⇒ abas recarregadas ⇒ REMOÇÃO (dono, Step 9) ⇒ referência da F1 (dono) ⇒ remoção na cópia (Step 10). O merge NUNCA antes da aditiva em produção (o `:5173` do dono lê produção e o front novo lê `distribuicao`/`atende` e chama `direcionamento_plano_modelo`); a remoção NUNCA antes do deploy no ar (o front publicado ainda chama `direcionamento_resumo_subcolecao` e abre a página antiga).

**Files:** nenhum novo no repo até o merge (Step 6); o QA spec `tests/e2e/distribuicao-qa.spec.ts` NÃO é versionado. Evidências em `/Users/sunglee/PLM + Criação/savepoints/pre-apply-distribuicao/`, `.superpowers/distribuicao/logs/` e no diário do guardião.

- [ ] **Step 1: Branch em dia + gates + suítes (controlador)**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/distribuicao-produto"
git status --porcelain -- src supabase tests | grep . && { echo "WORKTREE SUJA — PARE"; exit 1; }
git rebase feature/plan-tecido-a1 && git log --oneline -16
bash .superpowers/distribuicao/gates.sh
source .superpowers/distribuicao/mig/aplica.sh
for e in A B; do confere_md5_sql "$e" || exit 1; done          # o rebase não pode ter mudado o SQL ensaiado
PGOPTIONS='-c default_transaction_read_only=on' espera "$LOCAL" "$MD5_REDEF" "$(md5_de "$M/md5-redef-antes.txt")" "cópia: as 5 no texto da guarda" \
  || PGOPTIONS='-c default_transaction_read_only=on' espera "$LOCAL" "$MD5_REDEF" "$(md5_de "$M/md5-redef-depois.txt")" "cópia: as 5 já no texto desta frente"
```

Repetir o Task 0 Step 8 (sobreposição com a reorganização e com outras frentes que entraram na `feature/plan-tecido-a1`) — `SOBREPOE-BANCO` ou md5 da cópia fora dos 2 esperados (outra frente redefiniu uma das 5 funções) ⇒ PARE (a Task 4 é refeita: novo dump, novo gerador, nova G-migration A, novo ensaio). Se o rebase trouxe algo, com o OK do dono (N3): `DIST_DONO_AVISADO=sim bash .superpowers/distribuicao/n3.sh antes t11s1` e as suítes `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres DIST_MIG_TXN=1 npx vitest run --no-file-parallelism tests/integration/distribuicao-produto.test.ts` → `14 passed` e `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres DIST_MIG_TXN=1 npx vitest run --no-file-parallelism tests/integration/distribuicao-antiga-remover.test.ts` → `6 passed | 1 skipped`; `bash .superpowers/distribuicao/n3.sh depois t11s1`.

- [ ] **Step 2: G-commit (guardião)**

Entregar ao `guardiao-unificacao`: `git log --oneline "$(cat .superpowers/distribuicao/BASE)"..HEAD`, `git diff --stat` do mesmo intervalo, `gates.sh` verde, os pareceres (Lote A, T5, T6, T7, T8, G-migration A, G-migration B com a medição de travas, G-scripts), o gate "Dev intocado" (vazio), o gate "arquivos da reorg intocados" (vazio) e este plano. Checklist: decisões travadas do dono (spec §2); rulings R1–R39; nenhum arquivo fora do `permitidos.txt`; Dev intocado; save point `savepoint-pre-unificacao-2026-09-22` preservado; ordem de produção R36 e voltas LIFO R37. BLOQUEIA ⇒ parar.

- [ ] **Step 3: OK EXPLÍCITO do dono (chat, sem popup)**

Apresentar em PT-BR simples: (a) o que muda na tela — botão "Distribuir por loja" no Tecido 1 do card do Plan. Tecido (só nas lojas com o módulo "Distribuição por produto" ligado), pç da cor distribuída só leitura, "atende a" no forro/Tecido 2 com pç = soma, o dialog (desktop, celular, imprimir), o Direcionamento com o plano do modelo, "X modelos direcionados" e o semi-preenchimento, e a página antiga "Distribuição" SUMINDO do menu; (b) o que muda no banco — 2 colunas vazias em `plan_tecido_variantes`, 5 funções redefinidas (entre elas: o "aplicar" do plano deixa de APAGAR o casamento de variantes feito no BOM — conserto de um bug de hoje, R3), 2 funções novas, e a remoção (tabela `distribuicao_tabelas` + 4 RPCs antigas) num 2º momento, com CSV + backup antes; (c) o efeito P-31 nos cards que já existem (forro/T2 passa a somar o Tecido 1 de mesma cor base — o "a comprar" do forro muda; o kanban automático, onde estiver ligado, pode mover card quando a grade aplicada muda); (d) a ordem (reorganização ANTES; aditiva; merge; QA; deploy; remoção DEPOIS do deploy no ar); (e) o aviso para salvar e fechar o Plan. Tecido/Direcionamento abertos antes de cada passo; (f) o plano de volta (Step 13, LIFO); (g) as respostas de P-31…P-36 (§6) — se o dono ainda não respondeu, a recomendação implementada; (h) os ids para a QA (P-35) e os RESÍDUOS da QA na cópia (Step 7). Registrar a resposta literal + data no diário. Sem "sim" ⇒ parar.

- [ ] **Step 4: PRODUÇÃO A — o DONO, no Terminal, pelo `RODAR-distribuicao.md` (Momento 1)**

Pré-condição: a reorganização do Sheet (`20261005100000`) está em produção COM a referência dela da volta da F1 (a mais nova por mtime em `pre-apply-f1-kanban-auto/`). O dono confere as sha256 e roda o `ida-producao.sh` (Passo 1) e o `ref-volta-f1.sh aditiva` (Passo 2). O controlador NÃO roda nada disso. Qualquer PARE do pré-voo (inclusive "reorganização … no banco" ou "cadeia da volta da F1 … NÃO bate") ⇒ o controlador leva ao dono com o log; NUNCA contornar a checagem. A linha `INFO (pré-voo …)` (lojas com o módulo | casamentos no BOM | permissões órfãs) vai ao dono no chat e ao diário (R30/P-31).

- [ ] **Step 5: G-produção A (guardião) — logs do dono**

O guardião lê `.superpowers/distribuicao/logs/prod-ida.log` e `prod-ref-volta-f1.log`: backup public+auth com TABLE DATA>0; pré-voo OK (F1, reorganização, `0|0|0`, `1|4`, md5 das 5, md5 dos SQL = ensaiados, travas, cadeia); `aplica_v2` sem nova tentativa ou com nova tentativa só em 55P03/40P01/25P04; `== IDA OK` com `N|M → N+2|M`; ACL `0|1|0|1`; `FN_PRE` igual; referência nova `…_pos_distribuicao_detalhe.txt` = base + 4 linhas, com o CONT = CONT da base + `2|0`. Registrar no diário. Falhou a conferência ⇒ PARE (volta só com OK do dono — Step 13).

- [ ] **Step 6: Merge do front + ida na CÓPIA na mesma hora (controlador)**

Avisar o dono por chat: salvar e fechar o Plan. Tecido e o Direcionamento abertos no `:5173` E no `:5188` (o código novo vale no reload; a cópia congela alguns segundos na ida). Com o OK — um comando só:

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/distribuicao-produto"
MAIN="/Users/sunglee/PLM + Criação/plm-pcp"
git -C "$MAIN" diff --cached --quiet || { echo "índice do checkout principal com coisa staged (outra sessão) — PARE"; exit 1; }
git log --format=%H feature/plan-tecido-a1..distribuicao/por-produto > .superpowers/distribuicao/commits-da-frente.txt   # ANTES do ff (Step 8 usa)
[ "$(git -C "$MAIN" branch --show-current)" = feature/plan-tecido-a1 ] || { echo "checkout principal fora da feature/plan-tecido-a1 — PARE"; exit 1; }
DIST_DONO_AVISADO=sim bash .superpowers/distribuicao/copia.sh ida \
  && git -C "$MAIN" merge --ff-only distribuicao/por-produto && git -C "$MAIN" log --oneline -14
```

Expected: `== CÓPIA: ida OK (N|M → N+2|M)` (ou `a cópia JÁ tem a aditiva`) e o ff com os commits desta frente no topo. A ida falhou ⇒ o merge NÃO roda. O ff falhou (a principal andou) ⇒ `git rebase feature/plan-tecido-a1` na worktree, `gates.sh`, repetir SÓ o `merge --ff-only`. Avisar as outras frentes: "a cópia local passa a ter a Distribuição por produto (aditiva): funções +2; classificadores que esperam a contagem anterior passam a dizer INESPERADO".

- [ ] **Step 7: QA Playwright — `:5188` (cópia, com gravação) e `:5173` (produção, SÓ leitura)**

Pré-condições: `:5173` e `:5188` do dono no ar e RECARREGADOS (NÃO subir/matar nada; fora do ar ⇒ PEDIR ao dono); ids combinados com o dono por chat (P-35): na CÓPIA, `DIST_QA_COLECAO` (id da URL `?colecao=`), `DIST_QA_SUB` (opcional, `&sub=`), `DIST_QA_CARD` (nome do card da Loja Teste com Tecido 1 de 2+ cores e forro, **sem distribuição**) e `DIST_QA_MODELO_DIR` (modelo com Grade Real e CQ liberado, **sem direcionamento salvo**); em PRODUÇÃO, ids equivalentes de um card/modelo que o dono indicar (a QA só abre e fecha). Módulo `distribuicao` ligado na Loja Teste da cópia (se não estiver, o dono liga em Gerenciar Lojas — ação dele, não da QA). **Resíduos na CÓPIA** (avisar o dono ANTES): o card da QA passa por distribuir → salvar → desfazer; ficam `plan_rev` +2, 2 blindagens em `plan_tecido_snapshots`, linhas no `audit_log` e — se o card tiver modelo real — 2 auto-aplicações em `modelo_grades` (a 2ª devolve o pç de antes). No Direcionamento NADA é salvo.

Criar `tests/e2e/distribuicao-qa.spec.ts` (NÃO versionar):

```ts
import { test, expect, type Page, type Locator } from "@playwright/test";
import { doLogin } from "./_helpers";

// QA da Distribuição por produto (plano 2026-09-25, Task 11 Step 7). NÃO VERSIONAR (apagado na limpeza).
// :5188 = app de teste do dono sobre a CÓPIA — o ÚNICO alvo onde a QA grava (DIST_QA_ESCRITA=1 — R35/P-35).
// :5173 = PRODUÇÃO — SÓ leitura: abre, confere, mede e fecha SEM salvar. Nunca troca a loja do usuário de teste
// (nada de selectStore) e nunca clica Salvar/Confirmar no Direcionamento.
const BASE = process.env.E2E_BASE_URL ?? "";
const EH_COPIA = /^http:\/\/(localhost|127\.0\.0\.1):5188\/?$/.test(BASE);
const EH_PROD = /^http:\/\/(localhost|127\.0\.0\.1):5173\/?$/.test(BASE);
const ESCRITA = process.env.DIST_QA_ESCRITA === "1";
const COLECAO = process.env.DIST_QA_COLECAO ?? "";
const SUB = process.env.DIST_QA_SUB ?? "";
const CARD = process.env.DIST_QA_CARD ?? "";
const MODELO_DIR = process.env.DIST_QA_MODELO_DIR ?? "";
if (ESCRITA && !EH_COPIA) throw new Error("DIST_QA_ESCRITA=1 só com E2E_BASE_URL=http://localhost:5188 (cópia) — PRODUÇÃO é só leitura (R35).");
test.skip(!EH_COPIA && !EH_PROD, "E2E_BASE_URL = http://localhost:5188 (cópia) ou http://localhost:5173 (produção, só leitura)");

const RE_BASE = /^dist:[^:]+:[^:]+:.+:base$/;
const RE_CEL = /^dist:[^:]+:[^:]+:.+:[^:]+$/;
const RE_PROP = /^dist:[^:]+:prop:[^:]+$/;

async function exigirLojaTeste(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  const sw = page.locator('div:has(> div:has-text("Loja em visualização"))').getByRole("combobox").first();
  await sw.waitFor({ state: "attached", timeout: 8_000 }).catch(() => {});
  const rotulo = (await sw.count()) ? ((await sw.textContent()) ?? "").trim() : null;
  if (rotulo !== null && !rotulo.includes("Loja Teste")) {
    throw new Error(`O usuário de teste NÃO está na Loja Teste ("${rotulo}") — a QA não troca de loja; pedir ao dono.`);
  }
}
async function entrar(page: Page) {
  page.on("dialog", (d) => void d.accept());
  await doLogin(page);
  await exigirLojaTeste(page);
}
async function abrirColecao(page: Page) {
  test.skip(!COLECAO || !CARD, "Defina DIST_QA_COLECAO (id da URL ?colecao=) e DIST_QA_CARD (nome do card combinado — P-35)");
  await page.goto(`/criacao/plan-tecido?colecao=${COLECAO}${SUB ? `&sub=${SUB}` : ""}`, { waitUntil: "networkidle" });
}
const cardDe = (page: Page): Locator =>
  page.locator("div").filter({ hasText: CARD }).filter({ has: page.getByRole("button", { name: "Distribuir por loja" }) }).last();
async function abrirDialog(page: Page) {
  const card = cardDe(page);
  test.skip((await card.count()) === 0, "Sem 'Distribuir por loja' neste card: módulo 'distribuicao' desligado na loja deste ambiente, ou card sem Tecido 1");
  await card.getByRole("button", { name: "Distribuir por loja" }).click();
  const dlg = page.getByRole("dialog", { name: "Distribuir por loja" });
  await expect(dlg).toBeVisible();
  return { card, dlg };
}
async function fecharSemSalvar(page: Page, dlg: Locator) {
  await dlg.getByRole("button", { name: "Voltar" }).click();
  const d = page.getByRole("button", { name: "Descartar" });
  if (await d.isVisible().catch(() => false)) await d.click();
  await expect(dlg).toBeHidden();
}
async function salvarPlano(page: Page) {
  // O Salvar do Plan. Tecido (rótulo "Salvar" quando sujo). Conferir no 1º run que é o botão da barra do Sheet.
  await page.getByRole("button", { name: "Salvar", exact: true }).last().click();
  await expect(page.getByText("Planejamento de tecido salvo.").first()).toBeVisible({ timeout: 20_000 });
}

test.describe("Distribuição por produto — QA", () => {
  test.beforeEach(async ({ page }) => { await entrar(page); });

  test("a página antiga saiu do menu", async ({ page }) => {
    await page.goto("/home", { waitUntil: "networkidle" });
    await expect(page.locator('a[href="/distribuicao"]')).toHaveCount(0);
  });

  test("dialog: as 2 tabelas e os data-colab-path de presença (fecha sem salvar)", async ({ page }) => {
    await abrirColecao(page);
    const { dlg } = await abrirDialog(page);
    for (const t of ["Loja / Cor", "Proporção por tamanho", "Total por cor × tamanho"]) await expect(dlg.getByText(t).first()).toBeVisible();
    const paths = await dlg.locator('[data-colab-path^="dist:"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-colab-path") ?? ""));
    expect(paths.some((p) => RE_PROP.test(p)), "proporção").toBe(true);
    expect(paths.some((p) => RE_BASE.test(p)), "Base loja × cor").toBe(true);
    for (const p of paths) expect(RE_BASE.test(p) || RE_CEL.test(p) || RE_PROP.test(p), p).toBe(true);
    await fecharSemSalvar(page, dlg);
  });

  test("'atende a' do forro/T2: gatilho com path e popover", async ({ page }) => {
    await abrirColecao(page);
    const card = cardDe(page);
    test.skip((await card.count()) === 0, "módulo desligado / card sem Tecido 1");
    const gat = card.getByRole("button", { name: /^Atende a:/ }).first();
    test.skip((await gat.count()) === 0, "card sem forro/Tecido 2 — escolher outro (P-35)");
    expect(await gat.getAttribute("data-colab-path")).toMatch(/^pt-atende:/);
    await gat.click();
    await expect(page.getByText("Atende a · cores do Tecido 1")).toBeVisible();
    await page.keyboard.press("Escape");
  });

  for (const largura of [360, 390]) {
    test(`celular ${largura}: dialog sem estouro horizontal`, async ({ page }) => {
      await page.setViewportSize({ width: largura, height: 800 });
      await abrirColecao(page);
      const { dlg } = await abrirDialog(page);
      await expect(dlg.getByText("Por loja · deslize para o lado")).toBeVisible();
      const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      expect(m.sw, `documento ${m.sw}px > ${m.cw}px`).toBeLessThanOrEqual(m.cw);
      const caixa = await dlg.boundingBox();
      expect(!!caixa && caixa.x >= 0 && caixa.x + caixa.width <= largura + 1, "o dialog cabe na largura").toBe(true);
      await fecharSemSalvar(page, dlg);
    });
  }

  test("ESCRITA (só cópia): Base → pç só leitura + selo → Salvar do plano → recarrega → desfaz", async ({ page }) => {
    test.skip(!ESCRITA, "Só com DIST_QA_ESCRITA=1 no :5188 (cópia) — P-35");
    await abrirColecao(page);
    const card = cardDe(page);
    test.skip((await card.count()) === 0, "módulo desligado / card sem Tecido 1");
    const pc = card.locator('[data-colab-path^="pt-grade:"]').first();
    test.skip((await pc.count()) === 0, "a 1ª cor do Tecido 1 já está distribuída — escolher um card sem distribuição (P-35)");
    const pathPc = (await pc.getAttribute("data-colab-path")) ?? "";
    const varKey = pathPc.split(":").slice(2).join(":");
    const original = await pc.inputValue();
    let { dlg } = await abrirDialog(page);
    await dlg.locator(`[data-colab-path$=":${varKey}:base"]`).first().fill("7");
    await dlg.getByRole("button", { name: "Salvar" }).click();
    await expect(dlg).toBeHidden();
    await expect(cardDe(page).getByText("distribuído").first()).toBeVisible();
    await expect(cardDe(page).locator('[title="Só leitura — muda pelo Distribuir por loja"]').first()).toBeVisible();
    await salvarPlano(page);
    await page.reload({ waitUntil: "networkidle" });
    await expect(cardDe(page).getByText("distribuído").first()).toBeVisible();
    // desfaz: Base 0 (a linha sai — R8), confirma "Zerar o pç" (R10) e devolve o pç digitado de antes
    ({ dlg } = await abrirDialog(page));
    await dlg.locator(`[data-colab-path$=":${varKey}:base"]`).first().fill("0");
    await dlg.getByRole("button", { name: "Salvar" }).click();
    const zerar = page.getByRole("alertdialog").filter({ hasText: "Zerar o pç destas cores?" });
    if (await zerar.isVisible().catch(() => false)) await zerar.getByRole("button", { name: "Salvar" }).click();
    await expect(dlg).toBeHidden();
    await cardDe(page).locator(`[data-colab-path="${pathPc}"]`).fill(original);
    await salvarPlano(page);
    await page.reload({ waitUntil: "networkidle" });
    await expect(cardDe(page).locator(`[data-colab-path="${pathPc}"]`)).toHaveValue(original);
  });

  test("Direcionamento: plano do modelo, contador e células com path (sai sem salvar)", async ({ page }) => {
    test.skip(!MODELO_DIR, "Defina DIST_QA_MODELO_DIR (Grade Real + CQ liberado, sem direcionamento salvo — P-35)");
    await page.goto(`/expedicao/direcionamento/${MODELO_DIR}`, { waitUntil: "networkidle" });
    const comPlano = page.getByText("Plano de distribuição do modelo");
    await expect(comPlano.or(page.getByText(/^Sem plano — /)).first()).toBeVisible({ timeout: 15_000 });
    const paths = await page.locator('[data-colab-path^="dir:"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-colab-path") ?? ""));
    expect(paths.length, "células do Direcionamento com data-colab-path (preenchidas E vazias)").toBeGreaterThan(0);
    for (const p of paths) expect(p).toMatch(/^dir:[^:]+:[^:]+:.+$/);
    test.info().annotations.push({ type: "pendentes (–)", description: String(await page.locator('[title="Distribua à mão"]').count()) });
    if (await comPlano.isVisible()) await expect(page.getByRole("button", { name: /Preencher com o plano/ })).toBeVisible();
    await page.getByRole("button", { name: "Voltar" }).first().click();
    const d = page.getByRole("button", { name: "Descartar" });
    if (await d.isVisible().catch(() => false)) await d.click();
  });
});
```

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/distribuicao-produto"
ps -Ao pid,command | grep -E "[v]itest|[p]laywright" && { echo "PARE: outro teste rodando"; exit 1; }
E2E_BASE_URL=http://localhost:5188 DIST_QA_ESCRITA=1 DIST_QA_COLECAO="<id>" DIST_QA_SUB="<id ou vazio>" DIST_QA_CARD="<nome>" DIST_QA_MODELO_DIR="<id>" \
  npx playwright test tests/e2e/distribuicao-qa.spec.ts --reporter=list 2>&1 | tee .superpowers/distribuicao/logs/qa-copia.log | tail -30
E2E_BASE_URL=http://localhost:5173 DIST_QA_COLECAO="<id prod>" DIST_QA_CARD="<nome prod>" DIST_QA_MODELO_DIR="<id prod>" \
  npx playwright test tests/e2e/distribuicao-qa.spec.ts --reporter=list 2>&1 | tee .superpowers/distribuicao/logs/qa-producao.log | tail -30
```

Expected: cópia — todos PASS (ou `skipped` com o motivo registrado); produção — PASS/`skipped` e o teste de ESCRITA `skipped`. Seletores que não baterem (o card, o Salvar do plano) ⇒ ajustar SÓ o seletor, registrar em `desvios.md` e repetir; regra diferente ⇒ achado. Presença a 2 (estilo Google Sheets): o controlador pede ao dono para abrir o MESMO card no `:5188` em 2 abas/usuários e conferir o anel com o nome no campo focado do dialog e no "atende a" (evidência: print no diário). Achado ⇒ correção na branch (task nova, revisão), `gates.sh`, novo `merge --ff-only`, repetir a QA — o deploy espera. Opcional: `mobile-ui-auditor` (report-only) no mesmo card a 360/390/768 e no Direcionamento.

- [ ] **Step 8: Deploy — SÓ o dono, pelo portão (G-deploy: guardião antes)**

O controlador grava `.superpowers/distribuicao/deploy-base.txt` (sha do ÚLTIMO deploy, do diário) e `.superpowers/distribuicao/deploy-lista.txt` (SHAs de front aprovados pelo dono para este deploy — os de outras frentes já juntadas e ainda não publicadas, se o dono aprovar — + `commits-da-frente.txt` do Step 6). O dono roda num `/bin/bash --noprofile --norc`:

```bash
MAIN="/Users/sunglee/PLM + Criação/plm-pcp"; WT="$MAIN/.claude/worktrees/distribuicao-produto"
cd "$MAIN" && git branch --show-current
prereq_banco_dist() {  # SÓ LEITURA — o que a branch exige TEM de existir em produção
  local P; P="$(cat /tmp/dburl.txt)"
  chk() { local v; v=$(PGOPTIONS='-c default_transaction_read_only=on' psql "$P" -X -q -A -t -c "$2") || return 1
          [ "$v" = t ] || { echo "PARE (deploy): $1 está na branch mas o banco de produção ainda não tem"; return 1; }; }
  chk "Distribuição por produto — aditiva (2 colunas + RPC do Direcionamento)" "select to_regprocedure('public.direcionamento_plano_modelo(uuid)') is not null and (select count(*) = 2 from information_schema.columns where table_schema = 'public' and table_name = 'plan_tecido_variantes' and column_name in ('distribuicao','atende'))" &&
  chk "Distribuição por produto — 'distribuicao' default-OFF no servidor (R5)" "select position('''distribuicao''' in pg_get_functiondef('public.tenant_module_enabled(text)'::regprocedure)) > 0" &&
  chk "Reorganização do Sheet (_titulo_pagina_calculado + tenant_config.keywords)" "select to_regprocedure('public._titulo_pagina_calculado(text,text)') is not null and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tenant_config' and column_name = 'keywords')" &&
  chk "SKU F3.5a (modelo_skus + tamanho_tipo)" "select to_regclass('public.modelo_skus') is not null and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'modelos' and column_name = 'tamanho_tipo')" &&
  chk "F1/F2 (kanban_automatico)" "select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tenant_config' and column_name = 'kanban_automatico')" &&
  echo "OK (deploy): pré-requisitos de banco existem em produção"
}
portao_deploy_dist() {
  local sujo fora base lista="$WT/.superpowers/distribuicao/deploy-lista.txt"
  sujo=$(git status --porcelain --untracked-files=all -- src)
  [ -z "$sujo" ] || { echo "$sujo"; echo "PARE (deploy): mudança em src/ fora de commit — nada é publicado"; return 1; }
  base=$(cat "$WT/.superpowers/distribuicao/deploy-base.txt" 2>/dev/null) || { echo "PARE: sem deploy-base.txt"; return 1; }
  [ -s "$lista" ] || { echo "PARE: $lista vazio"; return 1; }
  fora=$(git log --format='%H %s' "$base"..HEAD -- src | grep -v -F -f "$lista")
  [ -z "$fora" ] || { echo "$fora"; echo "PARE (deploy): commit de front FORA da lista aprovada — falar com o dono (nada é publicado)"; return 1; }
  prereq_banco_dist || return 1
  echo "OK (deploy): src limpo e só a lista aprovada vai para o ar"
}
portao_deploy_dist && npm run deploy
```

Expected: `feature/plan-tecido-a1`, `OK (deploy): pré-requisitos…`, `OK (deploy): src limpo…` e o wrangler sem erro. `PARE` ⇒ nada foi publicado. Depois do deploy: o dono recarrega as abas (inclusive o `:5173`) e confere que "Distribuição" sumiu do menu.

- [ ] **Step 9: PRODUÇÃO B — REMOÇÃO — o DONO, pelo `RODAR-distribuicao.md` (Momento 2)**

Pré-condições: deploy do Step 8 NO AR; abas recarregadas; G-deploy registrado; horário calmo (o `DROP TABLE` trava `tenants`/`colecoes` por milissegundos — R29, medição da Task 9). O dono roda o `remover-producao.sh` (Passo 4 — exporta a tabela em CSV, faz o backup e pede "APAGAR A DISTRIBUIÇÃO ANTIGA") e o `ref-volta-f1.sh remocao` (Passo 5). O controlador NÃO roda nada disso; qualquer PARE ⇒ leva ao dono com o log.

- [ ] **Step 10: G-produção B (guardião) + remoção na CÓPIA (controlador)**

O guardião lê `prod-remocao.log` e `prod-ref-volta-f1.log`: frase digitada; CSV exportado (caminho no log) ANTES do backup; backup public+auth com TABLE DATA>0; pré-voo B OK (aditiva `2|2|2`, antiga `1|4`, md5 das 4 = `md5-antigas-antes.txt`, cadeia); `== REMOÇÃO OK` com `N|M → N−4|M−1`; `FN_PRE` igual; referência nova `…_pos_distribuicao_remocao_detalhe.txt` = anterior − 21 linhas, CONT = anterior − `4|1`. Registrar no diário. Depois, com o OK do dono (N3 — a cópia congela alguns ms no `DROP TABLE`):

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/distribuicao-produto"
DIST_DONO_AVISADO=sim bash .superpowers/distribuicao/copia.sh remover
```

Expected: `== CÓPIA: remover OK (N|M → N−4|M−1)` (o CSV da cópia fica em `.superpowers/distribuicao/logs/copia-distribuicao_tabelas.csv`). Avisar as outras frentes (Step 12).

- [ ] **Step 11: Docs e memória (docs-keeper; o controlador aplica com o OK do dono)**

`CLAUDE.md` (novo bloco "Distribuição por produto (set/2026)" + ajuste na "Modularização"): módulo `distribuicao` opt-in (default OFF no front E, agora, na lista default-OFF de `tenant_module_enabled`); toggle só em Gerenciar Lojas ("Distribuição por produto"); dados `plan_tecido_variantes.distribuicao` (só Tecido 1; `{loja: {base, grades, manuais}}`) e `.atende` (fora do T1; NULL = mesma cor base); pç da cor distribuída = Σ da distribuição (só leitura no card); "atende a" = casar variantes (`complementa_variante_ids`), gravado pelo `_plan_tecido_gravar_bom_core`, que **preserva** o casamento quando o payload não traz a chave (fim do apagamento silencioso); Direcionamento lê o plano por `direcionamento_plano_modelo` (wrapper + `_core` revogado dos 3) e o semi-preenchimento é SÓ rascunho — invariante #10 intocada; página antiga, `distribuicao_tabelas` e as 4 RPCs antigas APAGADAS (P-14 = B). **O CONTROLADOR edita e commita o `CLAUDE.md` NA PRINCIPAL** (`feature/plan-tecido-a1`, depois do Step 10; fora da worktree e do `permitidos.txt` — R39): `git -C "/Users/sunglee/PLM + Criação/plm-pcp" commit --only -m "docs(claude-md): Distribuição por produto" -m "Co-Authored-By: Claude <seu modelo real> <noreply@anthropic.com>" -- CLAUDE.md`. Docs locais (gitignored): `docs/mapeamento-campos-calculos.md` (pç = Σ distribuição; forro/T2 = Σ das cores do T1 atendidas; metragem = pç × consumo próprio), `docs/api-integracao-erp.md` (a distribuição é PLANO, não dado final — o final é `direcionamento_lojas`), `docs/plano-de-ataque.md`. Memória: `project_distribuicao.md` vira "SUPERADA — ver `project_distribuicao_por_produto.md`" + memória nova + linha no `MEMORY.md`; painel AO VIVO da campanha (ArtifactData) — frente "Distribuição por produto" concluída.

- [ ] **Step 12: Avisar as outras frentes**

"Produção e cópia com a Distribuição por produto: aditiva (+2 funções) e remoção (−4 funções, −1 gatilho; `distribuicao_tabelas` não existe mais). A volta de emergência da F1 usa agora `VOLTA-F1-POS-DISTRIBUICAO-REMOCAO.md` (referência `…_pos_distribuicao_remocao_detalhe.txt`) — a próxima frente encadeia nela (é a mais nova por mtime). `_plan_tecido_gravar_bom_core`, `_salvar_plan_tecido_core`, `_plan_tecido_arvore_core`, `_plan_tecido_snapshot` e `tenant_module_enabled` têm texto novo: quem for redefini-las gera do texto VIVO."

- [ ] **Step 13: Como voltar (SÓ com OK do dono) — LIFO (R37)**

0. Se a reorganização do Sheet também tiver de voltar, ESTA frente volta PRIMEIRO.
1. FRONT primeiro: `git revert` dos commits desta frente na `feature/plan-tecido-a1` (um commit de revert, `--only`), `gates.sh`, deploy do revert pelo portão; esperar NO AR e as abas recarregadas (inclusive o `:5173`). O front revertido volta a usar a página e a RPC antigas ⇒ a tabela antiga TEM de voltar antes de alguém abrir a página.
2. Banco, remoção primeiro: se o Step 9 rodou, o dono roda `volta-remocao-producao.sh` (recria a tabela + 4 RPCs + ACL + policy por último e devolve os DADOS do CSV); renomear `fidelidade_ref_volta_f1_pos_distribuicao_remocao_detalhe.txt`/`cont_volta_f1_pos_distribuicao_remocao.txt` para `*.desfeita`.
3. Banco, aditiva depois: o dono roda `volta-producao.sh` (exporta distribuição/"atende a", frase "APAGAR A DISTRIBUIÇÃO POR PRODUTO", backup, inverso com confirmação, conferência por diferença); renomear `…_pos_distribuicao_detalhe.txt`/`cont_volta_f1_pos_distribuicao.txt` para `*.desfeita`.
4. Cópia: `DIST_DONO_AVISADO=sim bash .superpowers/distribuicao/copia.sh volta-remover` e depois `… copia.sh volta`.

- [ ] **Step 14: Limpeza (com OK do dono)**

Copiar `.superpowers/distribuicao/{copia.sh,n3.sh,mig/,logs/}` para `/Users/sunglee/PLM + Criação/savepoints/pre-apply-distribuicao/scripts/` (as voltas de emergência precisam deles); `rm -f tests/e2e/distribuicao-qa.spec.ts` (só o próprio arquivo); `git worktree remove .claude/worktrees/distribuicao-produto`; `git branch -d distribuicao/por-produto`.

---
## 5. Riscos (e o que o plano faz)

| Risco | Evidência | Onde o plano trata |
|---|---|---|
| Front antes do banco | O front novo lê `distribuicao`/`atende` da árvore e chama `direcionamento_plano_modelo`; o `:5173` lê produção | Merge só no Task 11 Step 6, depois da aditiva (Step 4) e JUNTO com a cópia; portão do deploy confere colunas + RPC + lista default-OFF |
| Remoção antes do front novo no ar | O front publicado chama `direcionamento_resumo_subcolecao` e abre a página antiga | Migration SEPARADA (PR1/R29), Momento 2 do RODAR, pergunta + frase no script, G-deploy antes (Step 8 → 9) |
| Trava em `tenants`/`colecoes` no `DROP TABLE` (as policies de todas as lojas leem `tenants` via `get_user_tenant_id()`) | FKs de `distribuicao_tabelas` | `DROP TABLE` por ÚLTIMO, `lock_timeout` 500 ms + nova tentativa do `aplica_v2`, medida na cópia (Task 9 Step 1 → `travas-drop.txt`; auth/storage/realtime ⇒ PARE), horário calmo |
| Trava em `plan_tecido_variantes` no `ALTER` | ADD COLUMN + CHECK | Penúltimo bloco (antes da `_plan_tecido_arvore_core`, que precisa das colunas), ms; mesmas travas |
| As 5 funções redefinidas divergirem (outra frente mexe numa delas) | Corpo inteiro repetido | Geradas do texto VIVO com trocas exatas 1× cada; guarda md5 exata (antes/depois) nos 2 arquivos; teste "outra frente"; Task 11 Step 1 relê o md5 na cópia; pré-voo relê em produção |
| Cadeia da volta de emergência da F1 | Cada frente grava a sua referência; a da reorganização vem antes | `ref_mais_nova` + `confere_cadeia_ref` (antes de aplicar e depois), chaves pelas categorias REAIS do retrato; PARA e o dono decide |
| Dados apagados sem volta | Remoção apaga `distribuicao_tabelas`; volta aditiva apaga distribuição/"atende a" | CSV exportado ANTES + backup public+auth + frase digitada; os scripts de volta devolvem os dados (remoção) ou exportam (aditiva) |
| Forro/T2 dos cards existentes muda (P-31) e a reserva do forro passa a ser pela soma do par | "casar variantes" (`_grade_soma_pares`, #4) | R14 (sem amarração ⇒ pç digitado + aviso âmbar), só com o módulo ligado (R4), INFO no pré-voo, citado no OK do dono (Step 3) |
| Casamento do BOM apagado a cada "aplicar" (bug de HOJE) | `_plan_tecido_gravar_bom_core` vivo | R3: grava do payload e PRESERVA quando a chave falta (front antigo ou módulo desligado) |
| Distribuição perdida no merge "Dev vence" | `slotDeModeloReal` refaz as variantes do BOM | R7 (`comDistribuicaoDoPlano`/`comAtendeDoPlano`) + testes do engine (Task 3) |
| Normalização sem grade/sem gate na 1ª carga | Merge inicial antes de `tamanhos`/módulos | PR3 (espera `tamanhosProntos` e `!modulosCarregando`) |
| Presença não alcança o dialog (portal) nem o botão do "atende a" | `scopeRef` no `<main>`; `pathDoElemento` só campos | R19 (overlay próprio) + R20 (path explícito em qualquer elemento) + testes de fonte/unit + conferência a 2 na QA |
| Direcionamento: prefill conta como "não salvo" | Mockup com o selo | P-32 (A implementado; B = 1 linha) |
| Payload maior (Ave Rara) | ~406 variantes T1 × lojas × tamanhos | Aceito (estudo R10); medido na QA da cópia (PR4) |
| Janela aditiva → deploy com o front antigo | O front antigo repassa as chaves da árvore (spread) e não manda `complementa_variante_ids` (⇒ preserva) | R35: não distribuir antes do deploy; nenhum dado some |
| QA grava em produção | Salvar do Plan. Tecido grava a coleção inteira + auto-aplica | R35/PR9: gravação SÓ no `:5188`; o spec lança erro se `DIST_QA_ESCRITA=1` fora do `:5188`; produção só abre/fecha |
| Conflito com a reorganização do Sheet | Frente paralela em arquivos vizinhos | Arquivos proibidos no `gates.sh`, sobreposição (Task 0 Step 8 e Task 11 Step 1), ordem R36, voltas LIFO R37 |
| Discrepância `etapas_pl` (servidor ON × front OFF) | Mesma classe do R5 | Fora de escopo (spec §8) — anotado |

## 6. Decisões do dono (25/set) e o que ainda só ele responde

| # | Decisão do dono (TRAVADA) | Onde no plano |
|---|---|---|
| P-09 = D, P-23 = A | Base por loja × cor; tamanhos = `round(prop × base)`; correção à mão por quadradinho (ponto + ↺); mudar a Base não mexe no que foi corrigido | Task 1 (`celulaCalculada`, `definirBase/Celula`, `voltarAoCalculado`), Task 6 |
| P-24 = B / P-25 | Todos os tamanhos da grade da loja, só Letra ou só Número pelo `tamanho_tipo` (nasce Letra); proporção 0 esmaecida mas digitável | Task 1 (`tamanhosDoTipo`, R11), Task 5 (query `tamanho_tipo`), Task 6 |
| P-10 (revista) | Distribuído ⇒ pç só leitura; sem aviso de divergência | Tasks 2, 5 (R7, R10) |
| P-11 = A | Só Tecido 1 | Tasks 2, 4 (gate T1 no servidor) |
| P-17 = B, P-18 = A, P-20 = A | "Atende a" no card; padrão = mesma cor base; pç = soma; metragem = pç × consumo; 1 cor por cor do T1; = "casar variantes" do BOM | Tasks 2, 4 (R3), 5 |
| P-21 = B | Sem "Limpar distribuição" | Task 6 (sem o botão; teste de fonte) |
| P-22 = A | Depois do Envio à Explosão o dialog abre só leitura (ver e imprimir) | Tasks 5, 6 |
| Dialog | Imprimir; foto; badges com ícone + hover; "Total por cor × tamanho" | Task 6 |
| P-12 (revista) | Direcionamento com o plano + semi-preenchimento; Σ vazio = 0 ("faltam N"); Confirmar intocado; "Preencher com o plano"; "Grade Real" com "i" | Task 4 (RPC), Task 7 |
| P-15 = C | Comprados fora ("sem plano") | Task 4 (`comprado`), Task 7 |
| P-16 = C | Só "X modelos direcionados" | Tasks 4, 7 (R38) |
| P-14 = B | Distribuição antiga APAGADA no mesmo roteiro, com backup | Tasks 8, 9, 10, 11 (R28, R29) |
| Mobile | Rolagem só na tabela; 1ª coluna fixa com nomes abreviados | Tasks 1 (`abreviarNome`), 6, 11 (QA 360/390) |
| P-26 = A | Em paralelo à reorganização; migration > `20261005100000`, aplicada DEPOIS | Global Constraints, `REORG_OK` no pré-voo, R36 |

Perguntas ainda abertas (levar por chat antes da Task 11 Step 3; o plano segue a recomendação):

| # | Pergunta | Recomendação implementada | Se o dono disser outra coisa |
|---|---|---|---|
| P-31 | Forro/Tecido 2 dos cards que JÁ existem: aplicar o "atende a" automático a todos? | A — todos, mas cor SEM amarração mantém o pç digitado (+ aviso âmbar) | B (só cards com T1 distribuído) = 1 condição em `normalizarSlotDistribuicao` + testes (Task 2); C (sem amarração = 0) = trocar o ramo "sem amarração" (Task 2) |
| P-32 | Direcionamento pré-preenchido conta como "alteração não salva"? | A — conta (fiel ao mockup) | B = trocar `resetBaseline(obj)` por `resetBaseline(p ? p.obj : obj)` (1 linha na Task 7 Step (g)) + ajustar o teste de fonte |
| P-33 | "Replicar card(s)" leva distribuição e "atende a"? | A — não leva | B = frente seguinte, depois da reorg em produção (`_replicar_cards_plan_tecido_core` é dela) |
| P-34 | Permissão própria para distribuir? | A — herda a edição do Plan. Tecido | B = seção `criacao_plan_tecido:distribuicao` no `permissions-catalog` + `readOnly` do dialog/"atende a" (task nova; sem servidor) |
| P-35 | Card/modelo da QA (cópia) e de produção (só leitura) | O dono indica os ids | O controlador propõe e o dono confirma |
| P-36 | Imprimir no celular? | A — mostrar (mockup) | B = `max-sm:hidden` no botão (1 classe, Task 6) |

## 7. Autorrevisão (cobertura da spec e do brief)

| Requisito | Onde |
|---|---|
| Spec §2 — todas as decisões travadas | §6 acima (tabela decisão → task) |
| R1/R2 dados (`distribuicao` só T1, formato `{base, grades, manuais}`; `atende` fora do T1) + CHECKs | Tasks 3, 4 (gerador, testes de gate T1/fora, DEDUP) |
| R3 casamento no BOM (grava do payload, filtra ids reais do T1, PRESERVA sem a chave) | Task 4 (`TROCAS` do `_plan_tecido_gravar_bom_core` + testes), Task 5 (`materiaisParaAplicar` só com o módulo) |
| R4/R5 gate do módulo + `'distribuicao'` default-OFF no servidor (ACL intocada) | Task 4 (redefinição + teste ACL), Task 5 (card igual a hoje sem o módulo), Task 8 (`DEFAULTS=false`, toggle) |
| R6/PR3/PR4 normalização idempotente no carregamento e no `patch` | Task 2 (`normalizarSlotDistribuicao`/`Arvore`), Task 5 (`computeFreshArvore`, `patch`, espera) |
| R7 merge "Dev vence" sem perder distribuição/"atende a" | Task 3 |
| R8–R13 regras do dialog (cor distribuída, célula à mão, Salvar/zerar, tamanhos, proporção, lojas) | Tasks 1, 6 |
| R14–R17 "atende a" (regra, blocos, re-casamento, query) | Tasks 2, 5 |
| R18 Dialog por cima do Sheet, rascunho local, descarte | Task 6 (PR5) |
| R19/R20 + addendum do coordenador — presença estilo Google Sheets: `data-colab-path` por campo (proporção, cada Base, cada célula `dist:{slot}:{loja}:{variante}:{tamanho}`, "atende a"), overlay próprio no dialog (portal), marcador de página, ColabBanner; Direcionamento com path nas células pré-preenchidas E vazias; critério de aceite + testes | Tasks 1 (paths), 5 (`colab-field-path` + teste unit com stub; `focoDistribuicao`), 6 (overlay com `scopeRef`, testes de fonte), 7 (teste de fonte `dir:`), 11 Step 7 (QA dos paths + conferência a 2) |
| R21 RPC nova (DEFINER, tenant + módulo, tradução `variante_tecido_id → variante_numero`, motivos, `direcionados`) | Task 4 (CORE/WRAPPER + testes IDOR/ACL/motivos/tradução) |
| R22/R23/R34/R38 Direcionamento (semi-preenchimento, rótulos, tabela do plano, contador) | Task 7 |
| R24/P-15 comprados fora | Tasks 4, 7 |
| R25/P-33 Replicar não toca (função da reorg) | Global Constraints (proibido), `gates.sh` |
| R26 blindagem guarda `distribuicao`/`atende` | Task 4 |
| R27/P-34 permissão herdada | Tasks 5, 6 |
| R28 página antiga sai, módulo fica como gate (Gerenciar Lojas) | Task 8 |
| R29/PR1/PR8 remoção separada, depois do deploy, CSV + backup + frase, `DROP TABLE` por último, travas medidas | Tasks 9, 10 (`remover-producao.sh`), 11 Steps 9–10 |
| R30 permissões órfãs só informadas | Task 10 (`INFO_A`) |
| R31 migration gerada do texto vivo, md5 lido na cópia (não cravado), `LANGUAGE sql` depois do `ALTER`, travas, sem policy, sem DML/COMMENT em `tenant_config` | Task 4 (`dump_antes.sh`, `gerar_sql.py`, testes estáticos) |
| R32/P-36 imprimir no celular | Task 6 |
| R35/PR9 QA com gravação só na cópia | Task 11 Step 7 |
| R36/R37 ordem de produção e voltas LIFO | Global Constraints, RODAR, Task 11 Steps 4–10 e 13, `volta-producao.sh` exige a antiga de volta |
| R39 `CLAUDE.md` na principal pelo controlador | Task 11 Step 11 |
| Brief: paralelo à reorg sem tocar `planejamento-detail/**`, `FormatoSkuCard`, `sku-montar`, `configuracoes.tsx`, `20261005100000` | Global Constraints, `gates.sh`, Task 0 Step 8, Task 11 Step 1 |
| Brief: migrations `20261006100000`+, aplicadas DEPOIS da reorg | Global Constraints, `REORG_OK` no pré-voo |
| Brief: script descobre a referência MAIS NOVA da volta da F1 ao vivo, sem cravar nome; sem categoria "tabelas" | Task 10 (`ref_mais_nova`, `PAT_A`/`PAT_B` pelas categorias reais — 21 linhas conferidas no retrato real) |
| Brief: `SET LOCAL lock_timeout 500ms`/`transaction_timeout`, guarda md5 de cada função redefinida (lido na cópia), inverso, ACL REVOKE PUBLIC/anon/authenticated (#9), sem DML/COMMENT em `tenant_config` | Tasks 4, 9, 10 (`confere_arquivos`, `ACL_A`) |
| Brief: P-14 DROP no mesmo roteiro, backup antes, confirmação digitada; página removida (rota, sidebar, `nav.ts`, `permissions-catalog`, `routeTree`); módulo fica como gate; discrepância `tenant_module_enabled` | Tasks 4 (R5), 8, 9, 10, 11 |
| Brief: Direcionamento servidor (#10) intocado; semi-preenchimento no front; RPC DEFINER nova | Tasks 4, 7 |
| Brief: forro/T2 "atende a" reusa complementas (`_grade_soma_pares`) | Tasks 2, 4, 5 |
| Brief: tamanhos da grade no formato do `tamanho_tipo`; card sem modelo = Letra | Task 1 (R11), Task 5 |
| Brief: colab plan_rev/P0409 + merge por slot, sem mecanismo novo | Task 5, spec §5.4 |
| Brief: integração SÓ na cópia com `DATABASE_URL` literal; nunca `\i` em txn; provas de produção só com `psql`/`docker` falsos | Global Constraints, Tasks 4, 9, 10 (`prova-scripts.sh`) |
| Brief: SDD (Sonnet implementa, Opus revisa), G-migration (2 Opus + guardião) nas tasks de banco, Task 0 com gates próprios em `.superpowers/distribuicao/` | §4, Task 0 |
| Brief: proibidos (`git stash`, `git add .`, `pkill`, push, `types.ts`, Dev/Produção fora do permitido — gate "Dev intocado") | Global Constraints, `gates.sh`, `regras.md` |
| Addendum do coordenador: perguntas ao dono numeradas a partir de P-31 | Spec §10 e §6 acima (P-31…P-36) |
