# Reorganização do Sheet do Planejamento (F3.6 — Partes A, B e C) — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganizar o Sheet do Planejamento de Produto conforme o mockup aprovado pelo dono (25/set): seção 1 ganha NCM, Título para a página (automático/editável/↺) e Peso/medidas; a REF sai da seção 3 ("Desenvolvimento") para a seção nova "4. Códigos" (REF + "Tamanho em" + SKUs por variante × tamanho — a F3.5b do SKU); a Mão de obra deixa de ser seção e entra na tabela de "Preço e Custos", que ganha a linha "Preço anterior" — com a migration das 7 colunas novas testada só na cópia e aplicada em produção pelo dono, com backup, ANTES do merge do front.

**Architecture:** Parte A+C (sem banco novo — usa o F3.5a já em produção): regras puras da seção Códigos em `planejamento-detail/codigos/sku-card.ts`, hook `useSkusModelo` sobre as RPCs `skus_modelo`/`gerar_skus_modelo`/`salvar_sku_manual`, componente `CodigosSecao`, e a MO passada por *slot* (`ReactNode`) para dentro de `PrecoTabela`/`PrecoRevendaBloco`; a ordem/numeração/selos continuam derivadas de `selos-secoes.ts`. Parte B: UMA migration aditiva `20261005100000` (7 colunas em `modelos`, 4 CHECKs nomeados, função pura `_titulo_pagina_calculado` espelhada byte a byte por `src/lib/titulo-pagina.ts`, e `_replicar_cards_plan_tecido_core` redefinida com as mesmas 2 linhas do INSERT da F3.1) GERADA a partir do texto VIVO da cópia com guarda de md5 exata; no front, `Draft`/payload/Duplicar/rótulos de conflito + telas.

**Tech Stack:** PostgreSQL 17.6 (Supabase próprio; cópia local Docker `supabase_db_banco-local` em `127.0.0.1:54422`), plpgsql/sql, Vite + React 19 + TypeScript + TanStack Query v5 + supabase-js, Tailwind v4, Vitest 4 (unit `node` + integração `BEGIN…ROLLBACK` SÓ na cópia), Playwright (QA no `:5173`), Python 3 (gerador da migration), bash (scripts de produção no molde Nota/SKU).

**Spec:** `docs/superpowers/specs/2026-09-25-sheet-planejamento-reorganizacao-design.md` (727 linhas — decisões do dono §2 e rulings §3 TRAVADOS; mockup aprovado `https://claude.ai/artifact/9DaBF3wXk9bbtUgojZ3rHP`). Spec do SKU (F3.5b = seção Códigos): `docs/superpowers/specs/2026-09-24-sku-automatico-design.md` §4.2–§4.4. Moldes: `docs/superpowers/plans/2026-09-24-data-nota-entrada.md` e `docs/superpowers/plans/2026-09-24-sku-automatico-f35a.md` (+ scripts reais em `.claude/worktrees/{nota-entrada/.superpowers/nota, sku-f35a/.superpowers/f35a}/`).

## Global Constraints

**Repositório e worktree**
- Worktree: `/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/sheet-reorg`, branch `sheet/reorganizacao` (base `625b9aee` = ponta da `feature/plan-tecido-a1` com F1–F4, Data da Nota e SKU F3.5a). Caminhos relativos = raiz da worktree. TODO comando de git/gate/script roda DE DENTRO da worktree e imprime o alvo + `HEAD` (os scripts desta frente conferem o caminho e param fora dela). `.superpowers/` é gitignored: regras, gates, scripts, logs e evidências ficam em `.superpowers/sheet/` (não versionados).
- Commits: `git add -- <paths exatos>` + `git commit --only -m "<msg>" -- <paths>` + `git show --stat HEAD`. Mensagem termina com a linha `Co-Authored-By:` do SEU modelo real (ex.: `Co-Authored-By: Claude Sonnet … <noreply@anthropic.com>`).
- ⛔ PROIBIDO: `git stash` (pilha compartilhada entre worktrees), `git add .`/`-A`/`commit -a`, `pkill`/`killall`, `push`, editar `src/integrations/supabase/types.ts` (colunas novas via `as any`/tipo próprio do `Draft`, como o resto do repo), commitar `src/routeTree.gen.ts` (o build o regera: `git checkout -- src/routeTree.gen.ts`), imprimir senha/URL com senha/`.env`.
- Só os arquivos de `.superpowers/sheet/permitidos.txt` (Task 0) mudam — o `gates.sh` confere.
- **Dev intocado (decisão travada 8 da campanha):** `git diff --name-only savepoint-pre-unificacao-2026-09-22 -- src/components/desenvolvimento/ src/components/producao/ src/components/producao/cad/CadTecidosSection.tsx` tem de dar VAZIO (o `gates.sh` confere). `MaoObraEditor.tsx` mora em `src/components/planejamento/` e NÃO muda (é reusado como está).

**Banco**
- ⛔ PRODUÇÃO: o agente NÃO toca — nem `SELECT`, nem `psql "$(cat /tmp/dburl.txt)"`. Produção só na Task 10, PELO DONO, no Terminal dele, pelos scripts da Task 7 (`ida-producao.sh`, `ref-volta-f1.sh`, `volta-producao.sh`) e pelo portão do deploy.
- Cópia local = `postgresql://postgres:postgres@127.0.0.1:54422/postgres` (também é o app de teste `:5188` do dono). DDL/migration na cópia SÓ (a) dentro da txn revertida do harness (`SHEET_MIG_TXN=1` em `tests/integration/sheet-reorg-campos.test.ts`) ou (b) pelos scripts `.superpowers/sheet/{copia.sh,mig/ensaio-local.sh}`. Antes de cada uma: o CONTROLADOR avisa o dono no chat (texto do `n3.sh`) e, com o OK, `SHEET_DONO_AVISADO=sim bash .superpowers/sheet/n3.sh antes <passo>`. PROIBIDO probe exploratório fora disso. Leitura: `PGOPTIONS='-c default_transaction_read_only=on' psql …`.
- ⛔ NUNCA `\i` de migration dentro de transação de teste (o `COMMIT;` do arquivo fecha o `BEGIN` do teste e VAZA — incidente 15/set). ⛔ NUNCA DDL em transação de teste contra produção (incidente 23/set).
- Todo vitest de integração com `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres` EXPLÍCITO (sem ele o fallback `/tmp/dburl.txt` é PRODUÇÃO — incidente 24/set) e com caminhos de arquivo LITERAIS (no zsh, uma lista vazia roda a suíte inteira).
- Migration: `supabase/migrations/20261005100000_modelo_titulo_peso_ncm_preco_anterior.sql`; inverso `supabase/rollback/20261005100000_modelo_titulo_peso_ncm_preco_anterior_down.sql`. `20261004100000` é da frente "Nota sem a trava do pedido" (em curso). Os dois arquivos são GERADOS por `.superpowers/sheet/mig/gerar_sql.py` a partir do texto VIVO (dump só-leitura da cópia) — nunca editados à mão. Cada um: 1 `BEGIN;` e 1 `COMMIT;` em linha própria, com `SET LOCAL lock_timeout = '500ms';` e `SET LOCAL transaction_timeout = '3s';` logo depois do `BEGIN;` (o `psql -f` é o caminho padrão do CLAUDE.md; o `aplica_v2` reinjeta as mesmas, inofensivo); guarda de md5 EXATA de `_replicar_cards_plan_tecido_core` (o md5 VIVO da cópia, lido na Task 6 — o plano NÃO crava valor — ou o md5 deste texto novo); `ADD COLUMN IF NOT EXISTS`; o `ALTER TABLE public.modelos` POR ÚLTIMO (ACCESS EXCLUSIVE só no fim); NENHUMA DDL de policy (o hook `supautils.policy_grants` trava ~24 tabelas de auth/storage até o COMMIT); ACL das 2 funções internas conferida com `has_function_privilege` (invariante #9: `REVOKE … FROM PUBLIC, anon, authenticated`). Inverso destrutivo com confirmação (`SET LOCAL app.confirmo_apagar_campos_sheet = 'sim'`) avisando que o `DROP COLUMN` apaga o que foi digitado.
- Contagem (funções|gatilhos) hoje em produção e na cópia: **483|277** (a Nota sem trava não muda). Esta frente: **+1 função (`_titulo_pagina_calculado`), +0 gatilhos → 484|277**; 7 colunas; 4 CHECKs.
- ORDEM OBRIGATÓRIA: (1) Nota sem a trava do pedido em produção; (2) esta migration em produção (dono); (3) referência nova da volta de emergência da F1 (dono, só leitura); (4) merge do front na `feature/plan-tecido-a1` JUNTO com a ida na cópia; (5) QA no `:5173`; (6) deploy pelo portão. As colunas vão para a produção ANTES de juntar qualquer tela que as grave: o vite local do dono (`:5173`) aponta para a PRODUÇÃO (todo Salvar do Planejamento manda os 7 campos — sem as colunas cairia com PGRST204).

**Front**
- Gates de todo commit: `bash .superpowers/sheet/gates.sh` → `GATES SHEET: ok` (`npx tsc --noEmit` — o build NÃO checa tipos —, `npm run build`, unit sem falha nova vs. linha de base — inclui o anti-drift `tests/unit/ui-padroes-antidrift.test.ts` —, lista permitida, Dev intocado, sem `type="date"`, sem toast cru, `mig-txn.ts` intocado).
- Data = `<DateField>`; dinheiro/decimal = `<MoneyInput>` com `placeholder`; erro = `toast.error(mensagemErro(e, "…"))`; cor SÓ por token/primitivo (`StatusBadge`, `text-muted-foreground`, `text-destructive`) — nada de hex/`hsl()`/`oklch()`; ícone lucide por `className="h-4 w-4"`; ação em linha `size="iconSm"`.
- Editar = Sheet (este card); nada vira Dialog novo (o AlertDialog do "Regerar SKUs" é confirmação).
- Colaboração: todo campo novo do `Draft` ganha `data-colab-path="<chave>"` e entrada em `ROTULO_CONFLITO_PLAN`; o merge 3-vias (`mergeDraft`), `rev`/`_rev_base`/P0409 do Sheet continuam os de hoje (sem código novo de merge). SKU à mão = RPC imediata com `_rev_base` (fora do Salvar), `data-colab-path={`sku:${variante}:${tamanho}`}`.
- Mobile 360/390 sem estouro horizontal (medido na QA).
- Textos EXATOS (mockup/spec): seção "Desenvolvimento" (sem "— equipe e cronograma"); seção "Códigos"; "SKUs por variante e tamanho"; "Regerar SKUs"; "SKUs editados à mão não mudam"; hint da seção Códigos "As variantes vêm do Tecido 1 (seção Tecidos) e os tamanhos, da Grade. Formato: REF - cor base + apelido + tamanho (Config da Loja › Formato do SKU). 'Regerar SKUs' pede confirmação e nunca muda os editados à mão."; "NCM do Produto" (placeholder "0000.00.00"); "Título para a página" + hint "Acompanha o Nome do Modelo + o nome da loja enquanto ninguém editar. Editado à mão, fica fixo até clicar em ↺."; "Peso (kg)", "Comprimento (cm)", "Largura (cm)", "Altura (cm)"; "Preço anterior" + obs "acompanha o preço de venda até ser editado · ↺ volta ao automático".

**QA**
- Playwright SÓ com `E2E_BASE_URL=http://localhost:5173` (o default do Playwright é PRODUÇÃO na nuvem), DEPOIS do merge e ANTES do deploy. Sem semear dado; grava só no card combinado com o dono e RESTAURA. NUNCA troca a loja ativa do usuário compartilhado `teste@teste.com` (nada de `selectStore`); se algo trocar, restaurar e avisar. NUNCA matar/subir no lugar do `:5173` nem do `:5188`.

**Processo**
- SDD: implementador Sonnet por tarefa (não despacha subagente); revisor Opus por tarefa/lote (§4); o `code-reviewer` roda sem pedir. Task 6 (banco): 2 revisões Opus INDEPENDENTES (G-migration A e B, uma sem ver a outra) + guardião `guardiao-unificacao`. O guardião acompanha TODOS os portões (§4) e registra no diário `.superpowers/sdd/2026-09-22-unificacao-kanban-auto/guardiao.md` (checkout principal). Avisos e OKs do dono SÓ por chat (nunca `ExitPlanMode`).
- SQL/TS do plano não foi EXECUTADO pelo planejador: erro de sintaxe ⇒ corrigir o MÍNIMO e registrar em `.superpowers/sheet/desvios.md` (erro literal, causa, correção). Diferença de VALOR entre TS e SQL = drift de regra: PARE e chame o controlador.

---

## 1. Fatos que o código abaixo assume (levantados em 25/set, na worktree e na cópia — só leitura)

- `ORDEM_SECOES_SHEET`/`SecaoSheetKey`/`CONDICOES_SECAO_SHEET`/`selosSecoesSheet` em `src/components/planejamento/planejamento-detail/ficha/selos-secoes.ts:10-156`; numeração dinâmica `numerarSecoes` (`:28-40`); Dialog "Novo Modelo" numera só `info`/`colecao` (`:24`). `seloDeSecao`/`seloPorChaves`/`SeloSecao` em `ficha/selos-bom.ts`.
- `PlanejamentoDetail.tsx` (2000 linhas): `vis` em `:1133-1157` (`mao_obra` em `:1148`), selos em `:1165-1200`, seção 3 em `:1419-1437` (título `"Desenvolvimento — equipe e cronograma"`, `DevEquipeSection` com `refVisivel={kanbanCard.refVisivel}`), Preço em `:1483-1538`, seção Mão de obra em `:1540-1583`, `aoSalvar` em `:824`, `onMudancaServidor` do colab em `:897-900`, `refEditavel = isEdit && !devBloqueado && kanbanCard.refVisivel` em `:717`, `lancarBloqueios` em `:1078-1081`.
- **Motivo do Cancelamento** mora HOJE no cabeçalho do Sheet (`PlanejamentoDetail.tsx:1318-1327`), não no fim da seção 3 como a spec §3 ruling 6 descreve — a spec manda não mexer ("posição inalterada"); fica onde está (Ruling R3).
- A REF hoje: `DevEquipeSection.tsx:108-115` (`{refVisivel && …}`, `Input className="font-mono"`, `data-colab-path="ref"`), travada pelo `<fieldset disabled={devBloqueado}>` do orquestrador. O link "Para enviar, falta: REF" aponta `secao: "desenvolvimento"` (`ficha/envio-explosao.ts:70`).
- `PrecoTabela.tsx`: linha "Preço de venda" `:170-188` (MoneyInput `fixedDecimals`, `data-colab-path="preco_venda"`, gate `podeEditarPreco`), linha "Mão de obra" só leitura `:367-377` (obs "na seção Mão de obra abaixo"), "Custo total" `:378-385`; coluna Valores sticky no mobile (`max-md:[&_tr>*:nth-child(3)]:sticky`). O importado usa `PrecoTabela` (ramo `!isRevenda`); só a revenda usa `PrecoRevendaBloco` (`RevendaSetores.tsx:22-123`).
- `MaoObraEditor` (`src/components/planejamento/MaoObraEditor.tsx`) renderiza uma lista `div` (não linhas de tabela) — cabe inteiro numa célula `colSpan`.
- `NumberInput` transforma campo vazio em `"0"` (`NumberInput.tsx:69`) e não limita casas; `MoneyInput` emite `""` quando vazio e limita casas com `decimals` (+ `fixedDecimals`) — por isso Peso/medidas usam `MoneyInput` (Ruling R4).
- `Draft`/`emptyDraft`/`draftFromModeloRow` em `src/components/planejamento/modelo-shared.ts:76-202`; `ROTULO_CONFLITO_PLAN`, `textoOuNull`, `aplicarRegrasCamposDev`, `camposParaDuplicar`, `normalizarDraftSalvo` em `planejamento-detail/helpers.ts`; o payload do Salvar nasce de `aplicarRegrasCamposDev({...d, …})` em `usePlanejamentoSave.ts:219-228` e o preço em `:282-303` (`podeEditarPreco`). Só `PlanejamentoDetail.tsx` e `usePlanejamentoSave.ts` consomem esse `Draft`.
- F3.5a (em produção): RPCs `skus_modelo(_modelo_id)`, `gerar_skus_modelo(_modelo_id, _regerar)` e `salvar_sku_manual(_id, _sku, _rev_base, _modelo_id, _variante_key, _tamanho_key)` (`supabase/migrations/20261003100000_sku_automatico.sql:891-935`) — guarda `_sku_guarda`: módulo `criacao`, loja, `user_can_view('criacao_planejamento')` p/ ler e `user_can_edit(...)` p/ gerar/editar. `skus_modelo` devolve `{status: ok|sem_formato|aguardando_ref, tamanho_tipo, tamanho_tipo_card, linhas[], faltas[], avisos[]}`; cada linha `{variante_key, variante_ordem, cor_nome, apelido_nome, tamanho_key, tamanho_ordem, id, sku, manual, rev, sku_previsto, faltas, avisos, conflito_com, estado}` com `estado ∈ ok|manual|falta|pendente|divergente|conflito|vazio|orfa` (e `salvo` quando `status ≠ ok`, com só id/chaves/sku/manual/rev/estado). `gerar_skus_modelo` devolve a matriz + `{criados, atualizados, removidos, conflitos[{…, mensagem}]}`. **Não devolve as siglas** das cores (Ruling R11). Coluna `modelos.tamanho_tipo` (`letra|numero|NULL`=padrão da loja) já existe (cópia confirmada). Helpers TS: `src/lib/sku-montar.ts` (`normalizarSkuManual`, `textoFalta`, `textoAviso`, `SkuFalta`) e `src/lib/tamanho.ts` (`ladoTamanho`, `TamanhoTipo`). Link de cadastro de sigla usado pela F3.5a: `<Link to="/cadastro/atributos">`.
- `_replicar_cards_plan_tecido_core(uuid,uuid,uuid,uuid[],integer)`: última definição em `20260930180000_modelo_descricao_produto.sql:27-206` (a F3.5a e a Nota não a redefinem); âncoras no texto vivo da cópia (conferidas 1× cada): `      versao, modelo_base_id, mix_id, ref, ref_auto, descricao_produto\n` e `      v_versao, v_root, o.mix_id, o.ref, o.ref_auto, o.descricao_produto\n`; `proacl` vivo `{postgres=X/postgres,service_role=X/postgres}`.
- Cópia: `en_US.UTF-8` (produção pode diferir — por isso o título usa lista FIXA de letras via `translate`, Ruling R7); `modelos` com 272 linhas; `_titulo_pagina_calculado` ausente; Nota sem trava JÁ aplicada na cópia (o marcador `NEW.data_nota_entrada < NEW.data_pedido` sumiu de `fn_oc_nota_entrada_valida`).
- Cadeia da referência da volta de emergência da F1 em `/Users/sunglee/PLM + Criação/savepoints/pre-apply-f1-kanban-auto/`: `fidelidade_ref_volta_f1_<sufixo>_detalhe.txt` + `cont_volta_f1_<sufixo>.txt` (hoje: `com_f31` → `pos_nota` → `pos_f35a` → [pós-sem-trava, em curso]); formato de linha `categoria:objeto=valor` do `FIDEL_DET` de `bloco_apoio_v2.sh`; o `cont_volta_f1_<x>.txt` = nº de linhas `funcoes:`|`gatilhos:` da própria referência (conferido: `pos_nota` 429|227, `pos_f35a` 452|233). As chaves que a F1 mudou = diferença entre `fidelidade_prod_pre_detalhe.txt` e `fidelidade_prod_pos_detalhe.txt` (107 chaves); fora delas, a referência mais nova bate linha a linha com o retrato de produção (provado com `pos_nota`×`prod_pos_f35a` e `pos_f35a`×`prod_pos_f35a`: 0 diferenças).
- Deep-link do card: `/criacao/planejamento?modelo=<id>` (`criacao.planejamento.tsx:74`). Diálogo de descarte: botão "Descartar"; rodapé: botões `aria-label` "Voltar"/"Salvar"; toast do Salvar "Modelo salvo".
- Tamanho da grade: `modelo_grades.grades` chaveado pela string inteira ("34|PPP"); `ladoTamanho("34|PPP","numero")="34"`.

## 2. Rulings (lacunas/contradições do desenho — decididas pela leitura mais fiel; custo se errado)

| # | Ruling | Por quê | Custo se errado |
|---|---|---|---|
| R1 | No **Dialog "Novo Modelo"** a Mão de obra continua como seção SEM número (chave nova `mao_obra_novo`, como `tecidos_novo`). | A seção "Preço e Custos" não existe no Dialog (`vis.preco = isEdit`); sem isto a MO sumiria da criação, e o mockup do Dialog (`gen_novo.py`) mostra a MO. A spec só fala do Sheet. | Uma seção a mais no Dialog — remover = trocar 1 linha do `vis`. |
| R2 | "Para enviar, falta: REF" passa a abrir **"codigos"**. | A REF saiu da seção 3; o link abriria uma seção sem o campo. | Nenhum. |
| R3 | **Motivo do Cancelamento** fica onde está hoje (cabeçalho do Sheet). | A spec descreve outra posição mas manda "posição inalterada". | Nenhum. |
| R4 | Peso/medidas com **`MoneyInput`** (`decimals` 3/2 + `fixedDecimals`, placeholder "0,000"/"0,00"), não `NumberInput`. | `NumberInput` vira "0" quando vazio (0 é peso válido — mataria NULL=vazio) e não limita casas; o `MoneyInput` é "o mecanismo de casas fixas" que a própria spec cita. | Milhar "1.234,567" num campo físico (cosmético). |
| R5 | Preço anterior: **qualquer valor digitado vira manual** (mesmo igual ao preço de venda); Título: digitado **igual** ao calculado segue automático. | Preço anterior serve p/ "congelar o preço atual antes de mudar o de venda"; p/ o Título a spec diz "diferente do calculado". | Mínimo. |
| R6 | Título esvaziado à mão volta a automático **no blur** (não a cada tecla); o Salvar grava NULL de qualquer jeito. | Evita o campo "pular" p/ o calculado no meio da digitação. | Mínimo. |
| R7 | `_titulo_pagina_calculado`: nome vazio ⇒ `''`; loja vazia/NULL ⇒ só o nome (sem " \| " solto); loja só com as pontas aparadas; maiúscula/minúscula por **lista FIXA** (`translate` — A–Z + 25 acentos PT) nos dois lados; EXECUTE revogado de PUBLIC/anon/authenticated (service_role/postgres mantêm — ERP). | Independe do locale do banco (cópia en_US.UTF-8; produção pode ser C); padrão `_norm3`/`_sku_sem_acento`. | Letra fora da lista (ex. Ø) fica como está — igual nos dois lados. |
| R8 | Sem CHECK em `preco_anterior`; CHECKs nomeados `modelos_<col>_nao_negativo` nos 4 de peso/medidas. | A lista SQL da spec §5.2 não tem CHECK em preço (sem precedente); nomes explícitos facilitam conferir. | Nenhum. |
| R9 | Permissão do Preço anterior (`criacao_planejamento:preco_venda`) SÓ no cliente (payload só com a permissão, como o preço de venda); `fn_modelo_preco_venda_gate` NÃO é estendida. | A spec não pede trava no servidor; redefinir outro gatilho de `modelos` amplia o risco da migration. | Quem não tem a permissão poderia gravar via API crua → Dúvida D1. |
| R10 | "Tamanho em" entra no `Draft` (`modelos.tamanho_tipo`, já em produção) e grava no Salvar; "Padrão da loja" = NULL. Os outros itens da F3.5b ("Tamanho em" nos cards do Plan. Tecido/Produto Acabado/Importado e a grade exibida seguindo a escolha) ficam FORA. | A spec desta frente só cita a seção do Planejamento. | Frente separada → Dúvida D2. |
| R11 | Rótulo da variante na tabela SEM as "(SIGLA)" do mockup. | `skus_modelo` não devolve siglas; mostrar exigiria RPC nova (fora de escopo). O "Falta sigla" com link cobre o caso acionável. | Cosmético. |
| R12 | 1ª geração automática: depois de TODO Salvar bem-sucedido de card existente, lê a matriz fresca e gera (`_regerar=false`) SÓ se `status=ok`, NENHUM SKU gravado e há linha `pendente`. | Spec SKU §4.2 ("depois do Salvar que deixa o card com REF e sem SKUs"; SKU gravado nunca muda). | Nenhum. |
| R13 | QA em produção (Loja Teste via `:5173`): SKU à mão, "Regerar" CONFIRMADO e serviço de MO (adicionar/aprovar/remover) SÓ com OK explícito do dono — por padrão a QA abre e cancela. | Gravam em produção sem desfazer limpo (SKU manual não volta a automático; aprovar MO mexe no kanban). | QA menos profunda nesses 3 pontos (cobertos por unit/integração da F3.5a e desta frente) → Dúvida D3. |
| R14 | `_replicar` recebe só os 7 campos (não `tamanho_tipo`). | A spec fixa o diff em "exatamente essas 2 linhas" com os 7. | Réplica nasce com o padrão da loja em "Tamanho em" → Dúvida D4. |
| R15 | Selo de "Preço e Custos": o REQUISITO das 3 chaves de MO entra (âmbar); o texto informativo segue só preço/markup; `EntradaSelosSheet.maoObra` sai (sem consumidor). | Mínimo viável da spec §5.3. | Sem requisito configurado, "MO pendente" não aparece fechado (risco aceito na spec §6). |
| R16 | A MO entra na tabela por **slot** (`blocoMaoObra`/`obsMaoObra: ReactNode`) montado no orquestrador (o MESMO `MaoObraEditor`, sem mudança), numa linha `colSpan`; no mobile o conteúdo fica `sticky left-0` com a largura visível. Obs da linha "Mão de obra" vira "serviços logo abaixo". | A spec aceita "ou renderizá-lo por dentro"; evita repassar 9 props e não duplica estado/mutations. | Nenhum. |
| R17 | Revenda: Preço anterior em linha própria ANTES do par "Preço atacado/Preço varejo"; MO no fim do bloco de preço. Importado ganha tudo pela `PrecoTabela`. | O bloco da revenda não tem parte "Custos" depois dos preços. | Layout. |
| R18 | `mao_obra_novo` entra no `ORDEM_SECOES_SHEET` entre `tecidos_novo` e `preco`. | Só aparece com `!isEdit` (que numera só 1 e 2) — não mexe na numeração do Sheet. | Nenhum. |
| R19 | "Códigos" visível p/ todo card existente (`isEdit && modeloId`); a tabela de SKU só com `canView("criacao_planejamento")`; a REF dentro dela segue `refVisivel` + `refEditavel` de hoje. | SKU: "ver = quem vê o Planejamento" (spec SKU §4.4); a REF já é pública no cabeçalho. | Nenhum. |
| R20 | Migration GERADA do texto vivo com guarda de md5 exata; md5 NÃO cravado no plano (lido da cópia na Task 6). | Instrução do controlador + padrão da Nota. | Nenhum. |
| R21 | QA roda DEPOIS do merge (o `:5173` serve o checkout principal) e ANTES do deploy; toda edição da QA é restaurada. | Instrução do controlador (`E2E_BASE_URL=http://localhost:5173`). | Achado de QA vira correção na branch + novo ff antes do deploy. |
| R22 | Referência da volta da F1: o script descobre a MAIS NOVA (`ls -t fidelidade_ref_volta_f1_*_detalhe.txt`), confere que ela bate com produção FORA das chaves da F1 e desta frente (o que prova que nenhuma frente ficou sem referência) e PARA se não bater — no pré-voo da ida (antes de aplicar) e de novo depois. | Instrução do controlador ("descobrir a mais nova e PARAR se houver diferença inesperada, sem cravar nome"). | Se a Nota sem trava não gravar referência própria, a ida PARA antes de aplicar — o controlador decide com o dono. |

## 3. Mapa de arquivos

| Arquivo | Responsabilidade | Task |
|---|---|---|
| `src/components/planejamento/planejamento-detail/codigos/sku-card.ts` (novo) | Regras puras da seção Códigos: `lerMatriz`, `agruparPorVariante`, rótulos, `situacaoSku`, `avisoSku`, `deveGerarPrimeiraVez`, `skuDigitadoParaSalvar`, `resumoGeracao`, `seloCodigos` | 1 |
| `src/components/planejamento/planejamento-detail/codigos/useSkusModelo.ts` (novo) | Query `["plan-skus", id]` + Regerar + SKU à mão + `gerarSeFaltar` | 2 |
| `src/components/planejamento/planejamento-detail/codigos/CodigosSecao.tsx` (novo) | Seção 4: REF + "Tamanho em" + Regerar (AlertDialog) + tabela de SKU | 2 |
| `src/components/planejamento/planejamento-detail/ficha/selos-secoes.ts` | Chaves/ordem (`codigos`, `mao_obra_novo`, sem `mao_obra`), condições de Preço ∪ MO | 2, 3 |
| `src/components/planejamento/planejamento-detail/ficha/envio-explosao.ts` | Pendência REF → `codigos` | 2 |
| `src/components/planejamento/planejamento-detail/ficha/secoes/DevEquipeSection.tsx` | Sem REF | 2 |
| `src/components/planejamento/planejamento-detail/PrecoTabela.tsx` | Slots da MO; linha "Preço anterior" | 3, 9 |
| `src/components/planejamento/planejamento-detail/RevendaSetores.tsx` | MO e Preço anterior no bloco da revenda | 3, 9 |
| `src/components/planejamento/PlanejamentoDetail.tsx` | Fiação das seções | 2, 3, 8, 9 |
| `src/lib/titulo-pagina.ts` (novo) | Espelho TS de `_titulo_pagina_calculado` + apoio à tela | 4 |
| `tests/fixtures/titulo-pagina-casos.ts` (novo) | Casos do título (anti-drift nos 2 lados) | 4 |
| `src/components/planejamento/modelo-shared.ts` | `Draft` + `tamanho_tipo` + 7 campos | 2, 5 |
| `src/components/planejamento/planejamento-detail/helpers.ts` | Rótulos; `filtrarNcm`, `numeroOuNull`, `numeroDoInput`, `precoAnteriorOuNull`, `precoAnteriorExibido`, `camposNovosParaPayload`; Duplicar; normalização do eco | 2, 5 |
| `src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts` | Payload dos campos novos + Preço anterior com permissão | 5 |
| `supabase/migrations/20261005100000_…sql` + `supabase/rollback/20261005100000_…_down.sql` (gerados) | 7 colunas + 4 CHECKs + função do título + `_replicar` | 6 |
| `tests/integration/sheet-reorg-campos.test.ts` (novo) | Estático + banco (SÓ cópia) | 6 |
| `src/components/planejamento/planejamento-detail/InfoGeraisSecao.tsx` | L1–L6 da seção 1 | 8 |
| `tests/unit/planejamento-codigos.test.ts` (novo), `planejamento-mo-na-tabela.test.ts` (novo), `planejamento-info-gerais.test.ts` (novo), `planejamento-preco-anterior.test.ts` (novo), `titulo-pagina.test.ts` (novo); `planejamento-selos-secoes.test.ts`, `planejamento-envio-explosao.test.ts`, `planejamento-draft.test.ts`, `planejamento-detail-helpers.test.ts` (alterados) | Testes | 1–9 |
| `tests/e2e/sheet-reorg-qa.spec.ts` (NÃO versionar) | QA no `:5173` | 10 |
| `.superpowers/sheet/**` (não versionado) | regras, gates, `n3.sh`, `copia.sh`, `mig/{dump_antes.sh,gerar_sql.py,extra.sh,monta-aplica.sh,aplica.sh,ensaio-local.sh,ida-producao.sh,volta-producao.sh,ref-volta-f1.sh,prova-scripts.sh}`, md5, logs | 0, 6, 7 |
| `/Users/sunglee/PLM + Criação/savepoints/pre-apply-sheet-reorg/` (pasta 700, fora do repo) | `RODAR-sheet-reorg.md`, backups, contagens, retratos, export da volta | 7, 10 |

## 4. Revisão e portões

| Task | Revisão (implementador Sonnet em todas) |
|---|---|
| 1 + 2 | **Lote C** — 1 revisão Opus depois da Task 2 (regras puras × RPC da F3.5a; REF com a MESMA trava; SKU à mão com `_rev_base`; 1ª geração só sem SKU gravado; nenhum arquivo do Dev) |
| 3 | **Individual Opus** (dinheiro exibido + permissões #8/#12: `veCustos`, `podeAprovar`, bloco só com `moBlocoVisivel`; Dialog novo; mobile) |
| 4 + 5 | **Lote B1** — 1 revisão Opus (espelho TS; payload/eco do merge; Duplicar; Preço anterior só com permissão) |
| 6 | **G-migration**: 2 revisões Opus INDEPENDENTES (A e B — cada uma recebe só o plano, a spec, os 2 SQL, o gerador e a suíte; não vê o parecer da outra) + guardião `guardiao-unificacao`. Checklist: texto vivo × gerado (2 linhas), guarda md5, travas no arquivo, zero DDL de policy, ALTER por último, `ADD COLUMN IF NOT EXISTS`, CHECKs, ACL #9, inverso com confirmação e ordem, +1\|+0, suíte nos 2 modos |
| 7 | **Opus + guardião (G-scripts)**: ensaio real na cópia; scripts no molde Nota/SKU (guarda de URL ancorada, `umask 077`, `unset EXTRA_SQL`, backup public+auth com TABLE DATA>0 e `pg_restore -l`, md5 revisado, pós-condições antes de "IDA OK", volta por diferença, cadeia da referência da F1); provas só com `psql`/`docker` falsos |
| 8 | **Individual Opus** (layout 50/25/25, título automático/editado/↺, NCM, medidas NULL=vazio, Dialog) |
| 9 | **Individual Opus** (dinheiro: Preço anterior automático = efetivo, ↺, permissão, revenda = varejo) |
| 10 | controlador + guardião + dono |

**Portões do guardião (report-only, diário):** G-plano (este plano, antes da Task 0) · G-migration (fim da Task 6) · G-scripts (fim da Task 7) · G-commit (Task 10 Step 2, antes da produção/merge) · G-produção (Task 10 Step 5, logs do dono) · G-deploy (Task 10 Step 8). BLOQUEIA ⇒ parar; APROVA COM RESSALVAS ⇒ resolver/registrar antes do passo seguinte.

---
## Task 0: Pré-voo (sem commit)

**Files:** nenhum no git. Cria `.superpowers/sheet/` (não versionado).

- [ ] **Step 1: Conferir a worktree (já existe — NÃO criar outra) e a base**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/sheet-reorg"
echo "alvo: $(git rev-parse --show-toplevel) · branch $(git branch --show-current) · HEAD $(git rev-parse --short HEAD)"
[ "$(git branch --show-current)" = sheet/reorganizacao ] || { echo "PARE: branch errada"; exit 1; }
git status --porcelain | grep . && { echo "WORKTREE SUJA — PARE e avise o controlador"; exit 1; }
git log --oneline -3
git merge-base --is-ancestor feature/plan-tecido-a1 HEAD && echo "base em dia" || echo "a principal andou — Step 1b"
```

Expected: branch `sheet/reorganizacao`, worktree limpa, o commit deste plano no topo e `base em dia`.

- [ ] **Step 1b (só se a principal andou): rebase**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/sheet-reorg"
git rebase feature/plan-tecido-a1 && git log --oneline -3
```

Conflito ⇒ PARE e avise o controlador (nada de `stash`).

- [ ] **Step 2: Pastas, BASE, `.env`, dependências**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/sheet-reorg"
mkdir -p .superpowers/sheet/mig/antes .superpowers/sheet/logs .superpowers/sheet/qa
git rev-parse HEAD > .superpowers/sheet/BASE
[ -f .env ] || cp "/Users/sunglee/PLM + Criação/plm-pcp/.env" .env   # nunca imprimir o conteúdo
[ -x node_modules/.bin/vite ] || npm ci --silent
echo "BASE $(cut -c1-8 .superpowers/sheet/BASE)"
```

- [ ] **Step 3: Regras da frente — `.superpowers/sheet/regras.md`**

```markdown
# Regras da reorganização do Sheet (F3.6) — TODO executor lê antes de CADA task

1. Só na worktree `.claude/worktrees/sheet-reorg` (branch `sheet/reorganizacao`); todo comando DE DENTRO dela. Gates e
   scripts imprimem o alvo + HEAD e param fora dela.
2. Commit: `git add -- <arquivos exatos da task>` + `git commit --only -m "…" -- <arquivos>` + `git show --stat HEAD`.
   PROIBIDO `git add .`/`-A`/`commit -a`, `git stash`, push, `pkill`/`killall`. Mensagem termina com
   `Co-Authored-By: Claude <seu modelo real> <noreply@anthropic.com>`.
3. Antes de TODO commit: `bash .superpowers/sheet/gates.sh` → `GATES SHEET: ok`. Falhou = PARE.
4. PRODUÇÃO: nada (nem SELECT, nem `/tmp/dburl.txt`, nem `*.supabase.co`). Só o DONO, na Task 10, pelos scripts.
5. Cópia (127.0.0.1:54422): DDL SÓ por `SHEET_MIG_TXN=1` na suíte (txn revertida) ou pelos scripts `.superpowers/sheet/`.
   Antes, o CONTROLADOR avisa o dono (texto do `n3.sh`) e, com o OK, `SHEET_DONO_AVISADO=sim bash .superpowers/sheet/n3.sh
   antes <passo>`; depois `bash .superpowers/sheet/n3.sh depois <passo>`. NUNCA `\i` de migration; nada de probe.
6. Integração: SEMPRE `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres` explícito + caminho LITERAL do
   arquivo; antes, `ps -Ao pid,command | grep -E "[v]itest|[p]laywright"` vazio (a cópia é compartilhada: um por vez).
7. Leitura na cópia: `PGOPTIONS='-c default_transaction_read_only=on' psql …`.
8. Migration e inverso são GERADOS por `.superpowers/sheet/mig/gerar_sql.py` — nunca editar os .sql à mão.
9. Dev intocado (`src/components/desenvolvimento/**`, `src/components/producao/**`, `CadTecidosSection.tsx`).
10. Tela: `<DateField>`, `<MoneyInput>` com placeholder, `mensagemErro`, cor só por token, textos do plano verbatim.
11. Não subir/derrubar servidor; nunca `:5173`/`:5188`. Não despachar subagentes. Nunca imprimir senha/.env.
12. Erro de sintaxe do código do plano: corrigir o mínimo e registrar em `.superpowers/sheet/desvios.md`. Diferença de
    VALOR TS × SQL ou dúvida de regra de negócio: PARE e chame o controlador (ele leva ao dono por chat).
```

- [ ] **Step 4: Lista permitida — `.superpowers/sheet/permitidos.txt`**

```text
docs/superpowers/plans/2026-09-25-sheet-planejamento-reorganizacao.md
supabase/migrations/20261005100000_modelo_titulo_peso_ncm_preco_anterior.sql
supabase/rollback/20261005100000_modelo_titulo_peso_ncm_preco_anterior_down.sql
src/lib/titulo-pagina.ts
src/components/planejamento/PlanejamentoDetail.tsx
src/components/planejamento/modelo-shared.ts
src/components/planejamento/planejamento-detail/helpers.ts
src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts
src/components/planejamento/planejamento-detail/InfoGeraisSecao.tsx
src/components/planejamento/planejamento-detail/PrecoTabela.tsx
src/components/planejamento/planejamento-detail/RevendaSetores.tsx
src/components/planejamento/planejamento-detail/ficha/selos-secoes.ts
src/components/planejamento/planejamento-detail/ficha/envio-explosao.ts
src/components/planejamento/planejamento-detail/ficha/secoes/DevEquipeSection.tsx
src/components/planejamento/planejamento-detail/codigos/sku-card.ts
src/components/planejamento/planejamento-detail/codigos/useSkusModelo.ts
src/components/planejamento/planejamento-detail/codigos/CodigosSecao.tsx
tests/fixtures/titulo-pagina-casos.ts
tests/unit/titulo-pagina.test.ts
tests/unit/planejamento-codigos.test.ts
tests/unit/planejamento-mo-na-tabela.test.ts
tests/unit/planejamento-info-gerais.test.ts
tests/unit/planejamento-preco-anterior.test.ts
tests/unit/planejamento-selos-secoes.test.ts
tests/unit/planejamento-envio-explosao.test.ts
tests/unit/planejamento-draft.test.ts
tests/unit/planejamento-detail-helpers.test.ts
tests/integration/sheet-reorg-campos.test.ts
tests/e2e/sheet-reorg-qa.spec.ts
```

- [ ] **Step 5: `.superpowers/sheet/gates.sh`**

```bash
#!/usr/bin/env bash
# Gates de TODO commit da reorganização do Sheet (F3.6). Uso (DE DENTRO da worktree): bash .superpowers/sheet/gates.sh
# → "GATES SHEET: ok" (código 0). NÃO roda tests/integration (cada task de banco roda a sua suíte com DATABASE_URL local).
set -uo pipefail
TOP="$(git rev-parse --show-toplevel)" || exit 1
case "$TOP" in */.claude/worktrees/sheet-reorg) ;; *) echo "GATE FALHOU: rode de dentro da worktree sheet-reorg (achei $TOP)"; exit 1;; esac
cd "$TOP"
S=.superpowers/sheet
echo "== gates sheet-reorg · alvo: $TOP · HEAD $(git rev-parse --short HEAD) ($(git branch --show-current))"
falha() { echo "GATE FALHOU: $1"; exit 1; }
# merge-base (não o BASE da Task 0): depois de um rebase, os commits das outras frentes não contam como "desta frente".
BASE="$(git merge-base feature/plan-tecido-a1 HEAD)"
mkdir -p "$S/logs"
npx tsc --noEmit > "$S/logs/tsc.log" 2>&1 || { tail -20 "$S/logs/tsc.log"; falha "tsc (o build NÃO faz type-check)"; }
npm run build > "$S/logs/build.log" 2>&1 || { tail -20 "$S/logs/build.log"; falha "build"; }
git checkout -- src/routeTree.gen.ts 2>/dev/null || true
env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit > "$S/logs/unit.log" 2>&1
grep -qE "Test Files .*passed" "$S/logs/unit.log" || { tail -20 "$S/logs/unit.log"; falha "unit (sem resumo)"; }
grep -E "^ FAIL " "$S/logs/unit.log" | sed -E 's/ +[0-9]+ms$//' | sort -u > "$S/logs/unit-fail-agora.txt"
diff -q "$S/unit-fail-base.txt" "$S/logs/unit-fail-agora.txt" > /dev/null \
  || { diff "$S/unit-fail-base.txt" "$S/logs/unit-fail-agora.txt"; falha "unit (falhas ≠ linha de base — inclui o anti-drift de UI)"; }
FORA="$( { git diff --name-only "$BASE" HEAD; git diff --name-only; git diff --name-only --cached; \
           git ls-files --others --exclude-standard; } | sort -u | grep -vxF -f "$S/permitidos.txt" || true)"
[ -z "$FORA" ] || { echo "$FORA"; falha "arquivo fora da lista permitida ($S/permitidos.txt)"; }
[ -z "$(git diff --name-only savepoint-pre-unificacao-2026-09-22 -- src/components/desenvolvimento/ src/components/producao/ src/components/producao/cad/CadTecidosSection.tsx)" ] \
  || falha "Dev/Produção mudou desde o save point (decisão travada 8)"
for f in $(grep '^src/' "$S/permitidos.txt"); do
  [ -f "$f" ] || continue
  if grep -n 'type="date"' "$f"; then falha "<input type=\"date\"> em $f — use <DateField>"; fi
  if grep -nE 'toast\.error\((e|err|error)\.message' "$f"; then falha "toast de erro sem mensagemErro em $f"; fi
done
[ "$(git show feature/plan-tecido-a1:tests/integration/mig-txn.ts)" = "$(cat tests/integration/mig-txn.ts)" ] \
  || falha "tests/integration/mig-txn.ts mudou (é compartilhado — não editar)"
echo "GATES SHEET: ok"
```

- [ ] **Step 6: `.superpowers/sheet/n3.sh` (aviso ao dono antes de DDL na cópia)**

```bash
#!/usr/bin/env bash
# N3 — a cópia local (:54422) é também o APP DE TESTE do dono (:5188). Toda rodada com DDL na cópia (suíte com
# SHEET_MIG_TXN=1, ensaio, copia.sh ida|volta) segura ACCESS EXCLUSIVE em `modelos` dentro de transação: o :5188 CONGELA no
# Planejamento/Plan. Tecido enquanto roda. SÓ LEITURA. Uso (de dentro da worktree):
#   SHEET_DONO_AVISADO=sim bash .superpowers/sheet/n3.sh antes <passo>     ex.: t6s4, t7, t10-copia
#   bash .superpowers/sheet/n3.sh depois <passo>
set -uo pipefail
TOP="$(git rev-parse --show-toplevel)" || exit 1
case "$TOP" in */.claude/worktrees/sheet-reorg) ;; *) echo "PARE: rode de dentro da worktree sheet-reorg"; exit 1;; esac
cd "$TOP"
LOCAL="postgresql://postgres:postgres@127.0.0.1:54422/postgres"
QUANDO="${1:-}"; PASSO="${2:-}"
case "$QUANDO" in antes|depois) ;; *) echo "uso: n3.sh antes|depois <passo>"; exit 2 ;; esac
[ -n "$PASSO" ] || { echo "uso: n3.sh antes|depois <passo>"; exit 2; }
mkdir -p .superpowers/sheet/logs
docker ps --filter name=supabase_db_banco-local --format '{{.Status}}' | grep -q '^Up' \
  || { echo "PARE: cópia fora do ar (não subir/recriar por conta própria)"; exit 1; }
if [ "$QUANDO" = antes ]; then
  if ps -Ao command | grep -E "[v]itest|[p]laywright" > /dev/null; then
    ps -Ao pid,command | grep -E "[v]itest|[p]laywright"; echo "PARE: vitest/playwright rodando (um por vez na cópia)"; exit 1
  fi
  N=$(PGCONNECT_TIMEOUT=5 psql "$LOCAL" -X -A -t -v ON_ERROR_STOP=1 -c "select count(*) from pg_stat_activity where datname = current_database() and backend_type = 'client backend' and pid <> pg_backend_pid() and state <> 'idle'") \
    || { echo "PARE: não conectei na cópia"; exit 1; }
  [ "$N" = 0 ] || { echo "PARE: $N sessão(ões) ativa(s) na cópia — outra frente usando; esperar"; exit 1; }
  if [ "${SHEET_DONO_AVISADO:-}" != sim ]; then
    cat <<'MSG'
PARE: avise o dono no chat ANTES e espere o OK (depois rode de novo com SHEET_DONO_AVISADO=sim):
  "Vou rodar <passo> da reorganização do Sheet na cópia local agora (~<N> min). Enquanto roda, o app de teste :5188
   congela no Planejamento e no Plan. Tecido — a migration faz ALTER em `modelos` dentro de transação. Se estiver usando o
   :5188, salve e me avise quando posso começar."
MSG
    exit 1
  fi
fi
E=$(PGOPTIONS='-c default_transaction_read_only=on' psql "$LOCAL" -X -A -t -c "select (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public') || '|' || (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and not t.tgisinternal) || '|' || (to_regprocedure('public._titulo_pagina_calculado(text,text)') is not null)") \
  || { echo "PARE: não li o estado da cópia"; exit 1; }
P=$(lsof -nP -iTCP:5188 -sTCP:LISTEN -t 2>/dev/null | head -1)
AV=""; [ "$QUANDO" = antes ] && AV=" · dono avisado"
echo "$(date '+%F %T') $QUANDO $PASSO: funções|gatilhos|título = $E · :5188 $([ -n "$P" ] && echo "no ar (PID $P)" || echo "fora do ar")$AV" \
  | tee -a .superpowers/sheet/logs/n3.log
[ "$QUANDO" = antes ] && echo "OK (N3): pode rodar $PASSO"
exit 0
```

- [ ] **Step 7: Linha de base e gates**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/sheet-reorg"
chmod +x .superpowers/sheet/gates.sh .superpowers/sheet/n3.sh
bash .superpowers/sheet/n3.sh antes t0; echo "sem-aviso=$?"     # sem SHEET_DONO_AVISADO: mostra o texto e sai 1
env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit > .superpowers/sheet/logs/unit-base.log 2>&1; tail -6 .superpowers/sheet/logs/unit-base.log
grep -E "^ FAIL " .superpowers/sheet/logs/unit-base.log | sed -E 's/ +[0-9]+ms$//' | sort -u > .superpowers/sheet/unit-fail-base.txt; cat .superpowers/sheet/unit-fail-base.txt
bash .superpowers/sheet/gates.sh; echo "código=$?"
```

Expected: `sem-aviso=1` (a trava funciona); `unit-fail-base.txt` com as falhas HERDADAS (anotar — hoje as 2 do anti-drift de impressão, se ainda existirem); `GATES SHEET: ok` e `código=0`. Código 1 aqui = base quebrada: PARE e reporte.

- [ ] **Step 8: Sobreposição com as frentes abertas (regra de rebase)**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/sheet-reorg"
B=feature/plan-tecido-a1; P=.superpowers/sheet/permitidos.txt
for br in $(git branch --format='%(refname:short)' | grep -vE '^(feature/plan-tecido-a1|sheet/reorganizacao|main|bkp/|backup-)'); do
  git diff --name-only "$B...$br" 2>/dev/null | grep -xF -f "$P" | sed "s|^|SOBREPOE $br: |"
  git diff --name-only "$B...$br" -- supabase/migrations 2>/dev/null | while read -r f; do
    git show "$br:$f" | grep -qE "_replicar_cards_plan_tecido_core|ALTER TABLE (public\.)?modelos" && echo "SOBREPOE-BANCO $br: $f"
  done
done
echo "sobreposicao-checada"
```

Expected (25/set): só `sobreposicao-checada` (conferido no planejamento: `nota-entrada/data-nota` toca `src/lib/nota-entrada.ts` e a migration `20261004100000`; `aviso-global` toca sidebar/rotas; `ajustes/sheet-planejamento` já está na base). **Regra de rebase** (até o merge): `SOBREPOE <branch>: <arquivo>` ⇒ quem entra primeiro na principal ganha; esta frente faz `git rebase feature/plan-tecido-a1` (worktree limpa, sem stash), resolve PRESERVANDO o texto da outra frente e reaplicando a intenção da task daqui, roda `gates.sh`, e a task que edita o arquivo é re-revisada (Opus) com o diff. `SOBREPOE-BANCO` ⇒ PARE: a guarda de md5 vai recusar — refazer a Task 6 (dump + gerar) contra o texto novo DEPOIS que a outra migration estiver na cópia, e re-rodar as Tasks 6–7. Repetir este Step na Task 10.

- [ ] **Step 9: Estado da cópia (SÓ LEITURA)**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/sheet-reorg"
LOCAL="postgresql://postgres:postgres@127.0.0.1:54422/postgres"
docker ps --filter name=supabase_db_banco-local --format '{{.Status}}'
PGOPTIONS='-c default_transaction_read_only=on' psql "$LOCAL" -X -A -t -F' ' -c "
  select (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'),
         (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal),
         (select count(*) from information_schema.columns where table_schema='public' and table_name='modelos' and column_name in ('titulo_pagina','peso_kg','comprimento_cm','largura_cm','altura_cm','ncm','preco_anterior')),
         to_regprocedure('public._titulo_pagina_calculado(text,text)') is null,
         to_regprocedure('public.salvar_sku_manual(uuid,text,integer,uuid,uuid,text)') is not null,
         exists (select 1 from information_schema.columns where table_schema='public' and table_name='modelos' and column_name='tamanho_tipo')" \
  | tee .superpowers/sheet/copia-estado-t0.txt
PGOPTIONS='-c default_transaction_read_only=on' psql "$LOCAL" -X -A -t -c \
  "select pg_get_functiondef('public._replicar_cards_plan_tecido_core(uuid,uuid,uuid,uuid[],integer)'::regprocedure)" \
  | grep -cE '^      (versao, modelo_base_id, mix_id, ref, ref_auto, descricao_produto|v_versao, v_root, o\.mix_id, o\.ref, o\.ref_auto, o\.descricao_produto)$'
```

Expected: `Up … (healthy)`; `483 277 0 t t t` (outra frente pode ter mudado as 2 primeiras — anotar; a 3ª TEM de ser `0`, as 3 últimas `t`); a contagem de âncoras = `2`. Coluna já presente / função do título existente = alguém aplicou esta migration: PARE. Âncoras ≠ 2 = `_replicar` mudou: PARE e avise o controlador.

---
## Task 1: `codigos/sku-card.ts` — regras puras da seção "4. Códigos"  *(Lote C — revisão junto com a Task 2)*

**Files:**
- Create: `src/components/planejamento/planejamento-detail/codigos/sku-card.ts`
- Test: `tests/unit/planejamento-codigos.test.ts`

**Interfaces:**
- Consumes: `normalizarSkuManual`, `textoFalta`, `textoAviso`, `type SkuFalta` (`@/lib/sku-montar`); `ladoTamanho`, `type TamanhoTipo` (`@/lib/tamanho`); `seloDeSecao`, `type SeloSecao` (`ficha/selos-bom`).
- Produces (Tasks 2 e 10 usam estes nomes): `type EstadoSku`, `type LinhaSku`, `type MatrizSkus`, `type GrupoSku`, `type SituacaoSku`, `type AcaoSkuDigitado`; `lerMatriz(raw: unknown): MatrizSkus`; `agruparPorVariante(linhas: readonly LinhaSku[]): GrupoSku[]`; `rotuloVariante(g: GrupoSku): string`; `rotuloTamanho(tamanhoKey: string, tipo: TamanhoTipo): string`; `situacaoSku(l: LinhaSku): SituacaoSku`; `avisoSku(l: LinhaSku): string | null`; `deveGerarPrimeiraVez(m: MatrizSkus): boolean`; `skuDigitadoParaSalvar(l: LinhaSku, texto: string): AcaoSkuDigitado`; `resumoGeracao(raw: unknown): { erro: boolean; texto: string }`; `seloCodigos(m: MatrizSkus | null | undefined): SeloSecao | undefined`.

- [ ] **Step 1: Escrever o teste (falha)** — `tests/unit/planejamento-codigos.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  agruparPorVariante, avisoSku, deveGerarPrimeiraVez, lerMatriz, resumoGeracao, rotuloTamanho, rotuloVariante,
  seloCodigos, situacaoSku, skuDigitadoParaSalvar, type LinhaSku, type MatrizSkus,
} from "@/components/planejamento/planejamento-detail/codigos/sku-card";

// F3.6 — seção "4. Códigos" (F3.5b do SKU, spec 2026-09-24 §4.3): regras PURAS sobre a matriz que as RPCs da F3.5a
// (`skus_modelo`/`gerar_skus_modelo`, migration 20261003100000) devolvem. O SKU é gerado e gravado SÓ no servidor.
const linha = (p: Partial<LinhaSku> = {}): LinhaSku => ({
  variante_key: "k1", variante_ordem: 1, cor_nome: "Amarelo", apelido_nome: null, tamanho_key: "34|PPP", tamanho_ordem: 1,
  id: null, sku: null, manual: false, rev: null, sku_previsto: "REF1-AM34", faltas: [], avisos: [], conflito_com: null,
  estado: "pendente", ...p,
});
const matriz = (p: Partial<MatrizSkus> = {}): MatrizSkus => ({
  status: "ok", tamanho_tipo: "numero", tamanho_tipo_card: null, linhas: [], faltas: [], avisos: [], ...p,
});

describe("lerMatriz — jsonb das RPCs da F3.5a", () => {
  it("status ok: lê a linha inteira", () => {
    const m = lerMatriz({
      status: "ok", tamanho_tipo: "numero", tamanho_tipo_card: "letra", faltas: [], avisos: [],
      linhas: [{
        variante_key: "k1", variante_ordem: 2, cor_nome: "Verde", apelido_nome: "Musgo", tamanho_key: "36|PP", tamanho_ordem: 2,
        id: "s1", sku: "REF1VD36", manual: true, rev: 3, sku_previsto: "REF1VD36",
        faltas: [{ atributo: "tamanho", id: null, nome: "36" }], avisos: [{ atributo: "cor_apelido", id: "a1", nome: "Musgo" }],
        conflito_com: { modelo_id: "m9", nome: "Blusa", ref: "REF9" }, estado: "manual",
      }],
    });
    expect(m.status).toBe("ok");
    expect(m.tamanho_tipo).toBe("numero");
    expect(m.tamanho_tipo_card).toBe("letra");
    expect(m.linhas[0]).toEqual({
      variante_key: "k1", variante_ordem: 2, cor_nome: "Verde", apelido_nome: "Musgo", tamanho_key: "36|PP", tamanho_ordem: 2,
      id: "s1", sku: "REF1VD36", manual: true, rev: 3, sku_previsto: "REF1VD36",
      faltas: [{ atributo: "tamanho", id: null, nome: "36" }], avisos: [{ atributo: "cor_apelido", id: "a1", nome: "Musgo" }],
      conflito_com: { modelo_id: "m9", nome: "Blusa", ref: "REF9" }, estado: "manual",
    });
  });
  it("status ≠ ok: linha só com id/chaves/sku/manual/rev/estado — o resto vira null/[]", () => {
    const m = lerMatriz({
      status: "aguardando_ref", tamanho_tipo: "letra", tamanho_tipo_card: null, faltas: [], avisos: [],
      linhas: [{ id: "s1", variante_key: "k1", tamanho_key: "P", sku: "X", manual: false, rev: 1, estado: "salvo" }],
    });
    expect(m.status).toBe("aguardando_ref");
    expect(m.linhas[0]).toMatchObject({
      id: "s1", sku: "X", estado: "salvo", variante_ordem: null, cor_nome: null, faltas: [], avisos: [], conflito_com: null, sku_previsto: null,
    });
  });
  it("lixo não quebra: null, estado desconhecido, tamanho_tipo inválido", () => {
    expect(lerMatriz(null)).toEqual({ status: "ok", tamanho_tipo: "letra", tamanho_tipo_card: null, linhas: [], faltas: [], avisos: [] });
    expect(lerMatriz({ linhas: [{ estado: "xyz" }] }).linhas[0].estado).toBe("vazio");
    expect(lerMatriz({ tamanho_tipo: "cm" }).tamanho_tipo).toBe("letra");
  });
});

describe("agruparPorVariante / rótulos", () => {
  it("uma linha de grupo por variante, na ordem da RPC; órfãs num grupo próprio no fim", () => {
    const g = agruparPorVariante([
      linha({ tamanho_key: "34|PPP" }), linha({ tamanho_key: "36|PP" }),
      linha({ variante_key: "k2", variante_ordem: 2, cor_nome: "Verde", apelido_nome: "Musgo", tamanho_key: "34|PPP" }),
      linha({ variante_key: "k9", variante_ordem: null, cor_nome: null, estado: "orfa", id: "s9", sku: "OLD" }),
    ]);
    expect(g.map((x) => x.linhas.length)).toEqual([2, 1, 1]);
    expect(rotuloVariante(g[0])).toBe("Variante 1 · Amarelo · sem apelido");
    expect(rotuloVariante(g[1])).toBe("Variante 2 · Verde · apelido Musgo");
    expect(rotuloVariante(g[2])).toBe("Fora da grade atual");
  });
  it("tamanho pelo lado do 'Tamanho em' (par 34|PPP); tamanho solto fica como está", () => {
    expect(rotuloTamanho("34|PPP", "numero")).toBe("34");
    expect(rotuloTamanho("34|PPP", "letra")).toBe("PPP");
    expect(rotuloTamanho("UN", "numero")).toBe("UN");
  });
});

describe("situacaoSku / avisoSku", () => {
  it("cada estado da RPC vira um texto/tom", () => {
    expect(situacaoSku(linha({ estado: "ok" }))).toEqual({ tom: "neutral", texto: "automático", cadastrar: false });
    expect(situacaoSku(linha({ estado: "manual" })).texto).toBe("editado à mão");
    expect(situacaoSku(linha({ estado: "salvo" })).texto).toBe("gravado");
    expect(situacaoSku(linha({ estado: "pendente" })).texto).toBe("a gerar");
    expect(situacaoSku(linha({ estado: "divergente", sku_previsto: "REF1AM34" })).texto).toBe("Regerar muda para REF1AM34");
    expect(situacaoSku(linha({ estado: "falta", faltas: [{ atributo: "cor_base", id: "c1", nome: "Amarelo" }] })))
      .toEqual({ tom: "warning", texto: "Falta sigla: Cor base Amarelo", cadastrar: true });
    expect(situacaoSku(linha({ estado: "conflito", conflito_com: { modelo_id: "m2", nome: "Saia", ref: " " } })))
      .toEqual({ tom: "danger", texto: "já existe em Saia (REF —)", cadastrar: false });
    expect(situacaoSku(linha({ estado: "orfa", manual: false })).texto).toBe("fora da grade — sai no Regerar");
    expect(situacaoSku(linha({ estado: "orfa", manual: true })).texto).toBe("fora da grade — editado à mão, fica");
    expect(situacaoSku(linha({ estado: "vazio" })).texto).toBe("—");
  });
  it("aviso D4 (apelido sem sigla) não bloqueia — só texto", () => {
    expect(avisoSku(linha({ avisos: [{ atributo: "cor_apelido", id: "a1", nome: "Musgo" }] }))).toBe("Falta sigla na cor apelido: Musgo");
    expect(avisoSku(linha())).toBeNull();
  });
});

describe("deveGerarPrimeiraVez (1ª geração pós-Salvar — spec SKU §4.2, Ruling R12)", () => {
  it("só com REF (status ok), linhas a gerar e NENHUM SKU gravado", () => {
    expect(deveGerarPrimeiraVez(matriz({ linhas: [linha(), linha({ tamanho_key: "36|PP" })] }))).toBe(true);
    expect(deveGerarPrimeiraVez(matriz({ linhas: [linha(), linha({ id: "s1", sku: "X", estado: "ok" })] }))).toBe(false);
    expect(deveGerarPrimeiraVez(matriz({ status: "aguardando_ref" }))).toBe(false);
    expect(deveGerarPrimeiraVez(matriz({ linhas: [linha({ estado: "falta", sku_previsto: null })] }))).toBe(false);
    expect(deveGerarPrimeiraVez(matriz())).toBe(false);
  });
});

describe("skuDigitadoParaSalvar (RPC salvar_sku_manual — normalização espelhada do SQL)", () => {
  it("vazio numa linha sem SKU = nada; igual ao gravado (depois de normalizar) = nada", () => {
    expect(skuDigitadoParaSalvar(linha(), "  ")).toEqual({ acao: "nada" });
    expect(skuDigitadoParaSalvar(linha({ sku: "REF1AM34" }), "ref1am34")).toEqual({ acao: "nada" });
  });
  it("normaliza (sem espaço/acento, MAIÚSCULAS) e salva", () => {
    expect(skuDigitadoParaSalvar(linha(), "ref 1-ãm34")).toEqual({ acao: "salvar", sku: "REF1-AM34" });
  });
  it("caractere inválido, ou apagar um SKU gravado, é erro em PT (o servidor não apaga SKU)", () => {
    expect(skuDigitadoParaSalvar(linha(), "REF#1")).toEqual({ acao: "erro", erro: "SKU inválido: use só letras, números e - . _ /." });
    expect(skuDigitadoParaSalvar(linha({ sku: "X1" }), "")).toEqual({ acao: "erro", erro: "Informe o SKU." });
  });
});

describe("resumoGeracao", () => {
  it("sem conflito: contagens; com conflito: a 1ª mensagem do servidor", () => {
    expect(resumoGeracao({ criados: 2, atualizados: 1, removidos: 0, conflitos: [] }))
      .toEqual({ erro: false, texto: "SKUs gerados: 2 novo(s), 1 atualizado(s), 0 removido(s)." });
    expect(resumoGeracao({ conflitos: [{ mensagem: "SKU X já existe em Saia (REF R1). Edite este SKU à mão ou mude a sigla." }] }))
      .toEqual({ erro: true, texto: "1 SKU não gravado: SKU X já existe em Saia (REF R1). Edite este SKU à mão ou mude a sigla." });
  });
});

describe("seloCodigos (selo da seção — spec §5.3)", () => {
  it("vazia (nenhuma linha) ⇒ sem selo, nem 'aguardando REF' (regra de seção vazia do dono, 25/set)", () => {
    expect(seloCodigos(matriz({ status: "aguardando_ref" }))).toBeUndefined();
    expect(seloCodigos(undefined)).toBeUndefined();
  });
  it("falta sigla ⇒ âmbar 'N SKU(s) sem sigla' (vence o resto)", () => {
    const m = matriz({
      linhas: [linha({ estado: "falta" }), linha({ estado: "falta", tamanho_key: "36|PP" }), linha({ estado: "conflito" })],
      faltas: [{ atributo: "tamanho", id: null, nome: "36" }],
    });
    expect(seloCodigos(m)).toEqual({ tone: "warn", texto: "2 SKUs sem sigla", title: "Falta sigla: Tamanho 36" });
  });
  it("conflito ⇒ âmbar; aguardando REF / sem formato / a gerar ⇒ cinza; só aviso ⇒ info; tudo gravado ⇒ ok", () => {
    expect(seloCodigos(matriz({ linhas: [linha({ estado: "conflito" })] }))).toEqual({ tone: "warn", texto: "1 em conflito" });
    expect(seloCodigos(matriz({ status: "aguardando_ref", linhas: [linha({ estado: "salvo", id: "s", sku: "X" })] })))
      .toEqual({ tone: "muted", texto: "aguardando REF" });
    expect(seloCodigos(matriz({ status: "sem_formato", linhas: [linha({ estado: "salvo", id: "s", sku: "X" })] })))
      .toEqual({ tone: "muted", texto: "sem formato de SKU" });
    expect(seloCodigos(matriz({ linhas: [linha()] }))).toEqual({ tone: "muted", texto: "1 a gerar" });
    expect(seloCodigos(matriz({
      linhas: [linha({ estado: "ok", id: "s", sku: "X" })], avisos: [{ atributo: "cor_apelido", id: "a", nome: "Musgo" }],
    }))).toEqual({ tone: "info", texto: "aviso: apelido sem sigla", title: "Falta sigla na cor apelido: Musgo" });
    expect(seloCodigos(matriz({
      linhas: [linha({ estado: "ok", id: "s", sku: "X" }), linha({ estado: "manual", id: "t", sku: "Y", tamanho_key: "36|PP" })],
    }))).toEqual({ tone: "ok", texto: "2 SKUs" });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit/planejamento-codigos.test.ts`
Expected: FAIL — `Failed to resolve import "@/components/planejamento/planejamento-detail/codigos/sku-card"`.

- [ ] **Step 3: Implementar** — `src/components/planejamento/planejamento-detail/codigos/sku-card.ts`:

```ts
// Seção "4. Códigos" do Sheet do Planejamento (F3.6 — spec 2026-09-25-sheet-planejamento-reorganizacao §5.1/§5.3; é a
// F3.5b da spec do SKU §4.3). Regras PURAS de exibição da matriz de SKUs que as RPCs `skus_modelo`/`gerar_skus_modelo`
// (F3.5a, migration 20261003100000) devolvem — sem I/O. O SKU é gerado e gravado SÓ no servidor (fonte única); aqui só se
// lê, agrupa, rotula, decide o selo, a 1ª geração automática pós-Salvar e o que fazer com um SKU digitado à mão.
import { ladoTamanho, type TamanhoTipo } from "@/lib/tamanho";
import { normalizarSkuManual, textoAviso, textoFalta, type SkuFalta } from "@/lib/sku-montar";
import { seloDeSecao, type SeloSecao } from "@/components/planejamento/planejamento-detail/ficha/selos-bom";

export type EstadoSku = "ok" | "manual" | "falta" | "pendente" | "divergente" | "conflito" | "vazio" | "orfa" | "salvo";
export type StatusMatriz = "ok" | "sem_formato" | "aguardando_ref";
export type ConflitoSku = { modelo_id: string; nome: string | null; ref: string | null };
export type LinhaSku = {
  variante_key: string; variante_ordem: number | null; cor_nome: string | null; apelido_nome: string | null;
  tamanho_key: string; tamanho_ordem: number | null;
  id: string | null; sku: string | null; manual: boolean; rev: number | null;
  sku_previsto: string | null; faltas: SkuFalta[]; avisos: SkuFalta[]; conflito_com: ConflitoSku | null; estado: EstadoSku;
};
export type MatrizSkus = {
  status: StatusMatriz; tamanho_tipo: TamanhoTipo; tamanho_tipo_card: TamanhoTipo | null;
  linhas: LinhaSku[]; faltas: SkuFalta[]; avisos: SkuFalta[];
};

const ESTADOS: readonly string[] = ["ok", "manual", "falta", "pendente", "divergente", "conflito", "vazio", "orfa", "salvo"];
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const txt = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const tipo = (v: unknown): TamanhoTipo | null => (v === "letra" || v === "numero" ? v : null);
function faltasDe(v: unknown): SkuFalta[] {
  if (!Array.isArray(v)) return [];
  return v.map(obj).map((f): SkuFalta => ({
    atributo: f.atributo === "cor_apelido" ? "cor_apelido" : f.atributo === "tamanho" ? "tamanho" : "cor_base",
    id: txt(f.id),
    nome: txt(f.nome),
  }));
}
function conflitoDe(v: unknown): ConflitoSku | null {
  const o = obj(v);
  return typeof o.modelo_id === "string" ? { modelo_id: o.modelo_id, nome: txt(o.nome), ref: txt(o.ref) } : null;
}

/** Lê o jsonb de `skus_modelo`/`gerar_skus_modelo`. Tolerante: com `status ≠ ok` a RPC só manda id/chaves/sku/manual/rev/
 *  estado por linha — o resto vira null/[]. */
export function lerMatriz(raw: unknown): MatrizSkus {
  const o = obj(raw);
  const status: StatusMatriz = o.status === "sem_formato" || o.status === "aguardando_ref" ? o.status : "ok";
  const linhas = (Array.isArray(o.linhas) ? o.linhas : []).map(obj).map((l): LinhaSku => ({
    variante_key: txt(l.variante_key) ?? "",
    variante_ordem: num(l.variante_ordem),
    cor_nome: txt(l.cor_nome),
    apelido_nome: txt(l.apelido_nome),
    tamanho_key: txt(l.tamanho_key) ?? "",
    tamanho_ordem: num(l.tamanho_ordem),
    id: txt(l.id),
    sku: txt(l.sku),
    manual: l.manual === true,
    rev: num(l.rev),
    sku_previsto: txt(l.sku_previsto),
    faltas: faltasDe(l.faltas),
    avisos: faltasDe(l.avisos),
    conflito_com: conflitoDe(l.conflito_com),
    estado: ESTADOS.includes(String(l.estado)) ? (l.estado as EstadoSku) : "vazio",
  }));
  return {
    status,
    tamanho_tipo: tipo(o.tamanho_tipo) ?? "letra",
    tamanho_tipo_card: tipo(o.tamanho_tipo_card),
    linhas,
    faltas: faltasDe(o.faltas),
    avisos: faltasDe(o.avisos),
  };
}

export type GrupoSku = { chave: string; ordem: number | null; cor: string | null; apelido: string | null; orfa: boolean; linhas: LinhaSku[] };

/** Uma linha de grupo por variante (a COR — R1 do SKU), na ordem que a RPC devolve (variante → tamanho; órfãs no fim). */
export function agruparPorVariante(linhas: readonly LinhaSku[]): GrupoSku[] {
  const out: GrupoSku[] = [];
  const porChave = new Map<string, GrupoSku>();
  for (const l of linhas) {
    const orfa = l.estado === "orfa";
    const chave = orfa ? "__orfa__" : l.variante_key;
    let g = porChave.get(chave);
    if (!g) {
      g = { chave, ordem: orfa ? null : l.variante_ordem, cor: orfa ? null : l.cor_nome, apelido: orfa ? null : l.apelido_nome, orfa, linhas: [] };
      porChave.set(chave, g);
      out.push(g);
    }
    g.linhas.push(l);
  }
  return out;
}

/** "Variante 1 · Amarelo · apelido Canário" / "… · sem apelido" (sem as siglas do mockup — a RPC não as devolve, R11). */
export function rotuloVariante(g: GrupoSku): string {
  if (g.orfa) return "Fora da grade atual";
  return `Variante ${g.ordem ?? "—"} · ${g.cor ?? "sem cor base"} · ${g.apelido ? `apelido ${g.apelido}` : "sem apelido"}`;
}

/** O lado do tamanho que vale pelo "Tamanho em" do card (a chave interna segue "34|PPP"). */
export function rotuloTamanho(tamanhoKey: string, tipo: TamanhoTipo): string {
  return ladoTamanho(tamanhoKey, tipo) ?? tamanhoKey;
}

export type SituacaoSku = { tom: "neutral" | "info" | "warning" | "danger"; texto: string; cadastrar: boolean };

export function situacaoSku(l: LinhaSku): SituacaoSku {
  switch (l.estado) {
    case "manual": return { tom: "info", texto: "editado à mão", cadastrar: false };
    case "ok": return { tom: "neutral", texto: "automático", cadastrar: false };
    case "salvo": return { tom: "neutral", texto: "gravado", cadastrar: false };
    case "pendente": return { tom: "neutral", texto: "a gerar", cadastrar: false };
    case "divergente": return { tom: "info", texto: `Regerar muda para ${l.sku_previsto ?? "—"}`, cadastrar: false };
    case "falta": return { tom: "warning", texto: l.faltas.map(textoFalta).join(" · ") || "Falta sigla", cadastrar: true };
    case "conflito":
      return {
        tom: "danger",
        texto: l.conflito_com
          ? `já existe em ${l.conflito_com.nome ?? "outro produto"} (REF ${l.conflito_com.ref?.trim() || "—"})`
          : "SKU repetido",
        cadastrar: false,
      };
    case "orfa":
      return { tom: "neutral", texto: l.manual ? "fora da grade — editado à mão, fica" : "fora da grade — sai no Regerar", cadastrar: false };
    default: return { tom: "neutral", texto: "—", cadastrar: false };
  }
}

/** D4 do SKU: apelido sem sigla NÃO bloqueia (o SKU sai com a cor base) — só avisa. */
export function avisoSku(l: LinhaSku): string | null {
  return l.avisos.length > 0 ? l.avisos.map(textoAviso).join(" · ") : null;
}

/** 1ª geração automática (spec SKU §4.2; R12): card com REF (`status ok`), NENHUM SKU gravado e há linha a gerar. */
export function deveGerarPrimeiraVez(m: MatrizSkus): boolean {
  return m.status === "ok" && m.linhas.length > 0 && m.linhas.every((l) => !l.id) && m.linhas.some((l) => l.estado === "pendente");
}

export type AcaoSkuDigitado = { acao: "nada" } | { acao: "erro"; erro: string } | { acao: "salvar"; sku: string };

/** SKU digitado à mão → o que fazer no blur/Enter (mesma normalização/mensagens do `_sku_norm_manual` do SQL). */
export function skuDigitadoParaSalvar(l: LinhaSku, texto: string): AcaoSkuDigitado {
  const atual = l.sku ?? "";
  if (texto.trim() === "" && atual === "") return { acao: "nada" };
  const n = normalizarSkuManual(texto);
  if (!n.ok) return { acao: "erro", erro: n.erro };
  return n.valor === atual ? { acao: "nada" } : { acao: "salvar", sku: n.valor };
}

/** Texto do toast depois de `gerar_skus_modelo` (conflito = o servidor não gravou aquela linha — mensagem PT dele). */
export function resumoGeracao(raw: unknown): { erro: boolean; texto: string } {
  const o = obj(raw);
  const n = (k: string) => Number(o[k] ?? 0) || 0;
  const conflitos = Array.isArray(o.conflitos) ? o.conflitos.map(obj) : [];
  if (conflitos.length > 0) {
    const s = conflitos.length > 1 ? "s" : "";
    return { erro: true, texto: `${conflitos.length} SKU${s} não gravado${s}: ${txt(conflitos[0].mensagem) ?? "conflito"}` };
  }
  return { erro: false, texto: `SKUs gerados: ${n("criados")} novo(s), ${n("atualizados")} atualizado(s), ${n("removidos")} removido(s).` };
}

/** Selo da seção Códigos (spec §5.3): "N SKU(s) sem sigla" âmbar vence; seção sem linha nenhuma = sem selo (`seloDeSecao` —
 *  a seção não tem requisito de kanban). */
export function seloCodigos(m: MatrizSkus | null | undefined): SeloSecao | undefined {
  if (!m) return undefined;
  const conta = (e: EstadoSku) => m.linhas.filter((l) => l.estado === e).length;
  const nFalta = conta("falta");
  const nConflito = conta("conflito");
  const nPendente = conta("pendente");
  const informativo = ((): SeloSecao => {
    if (nFalta > 0) {
      return {
        tone: "warn", texto: `${nFalta} SKU${nFalta > 1 ? "s" : ""} sem sigla`,
        title: m.faltas.length > 0 ? m.faltas.map(textoFalta).join(" · ") : undefined,
      };
    }
    if (nConflito > 0) return { tone: "warn", texto: `${nConflito} em conflito` };
    if (m.status === "aguardando_ref") return { tone: "muted", texto: "aguardando REF" };
    if (m.status === "sem_formato") return { tone: "muted", texto: "sem formato de SKU" };
    if (nPendente > 0) return { tone: "muted", texto: `${nPendente} a gerar` };
    if (m.avisos.length > 0) return { tone: "info", texto: "aviso: apelido sem sigla", title: m.avisos.map(textoAviso).join(" · ") };
    const n = m.linhas.filter((l) => l.estado !== "orfa" && !!l.sku).length;
    return { tone: "ok", texto: `${n} SKU${n > 1 ? "s" : ""}` };
  })();
  return seloDeSecao(m.linhas.length === 0, null, informativo);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit/planejamento-codigos.test.ts`
Expected: PASS (todos os `it`). Um `expect` de TEXTO divergir de `textoFalta`/`textoAviso`/`normalizarSkuManual` da F3.5a = o helper deles mudou: conferir `src/lib/sku-montar.ts` e ajustar o TESTE ao texto real (não o helper), registrando em `desvios.md`.

- [ ] **Step 5: Gates e commit**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/sheet-reorg"
bash .superpowers/sheet/gates.sh
git add -- src/components/planejamento/planejamento-detail/codigos/sku-card.ts tests/unit/planejamento-codigos.test.ts
git commit --only -m "feat(sheet-reorg): seção Códigos — regras puras da matriz de SKUs (F3.5b, T1)" \
  -m "lerMatriz/agrupar/rótulos/situação/selo/1ª geração/SKU digitado sobre as RPCs da F3.5a. Plano 2026-09-25, Task 1." \
  -m "Co-Authored-By: Claude <seu modelo real> <noreply@anthropic.com>" \
  -- src/components/planejamento/planejamento-detail/codigos/sku-card.ts tests/unit/planejamento-codigos.test.ts
git show --stat HEAD
```

---
## Task 2: Seção "4. Códigos" no Sheet — a REF sai da seção 3, "Tamanho em" e SKUs  *(Lote C)*

**Files:**
- Modify: `src/components/planejamento/planejamento-detail/ficha/selos-secoes.ts` (chave `codigos`)
- Modify: `src/components/planejamento/planejamento-detail/ficha/envio-explosao.ts:70`
- Modify: `src/components/planejamento/planejamento-detail/ficha/secoes/DevEquipeSection.tsx:64-127`
- Modify: `src/components/planejamento/modelo-shared.ts` (`Draft.tamanho_tipo`)
- Modify: `src/components/planejamento/planejamento-detail/helpers.ts` (rótulo "Tamanho em")
- Create: `src/components/planejamento/planejamento-detail/codigos/useSkusModelo.ts`
- Create: `src/components/planejamento/planejamento-detail/codigos/CodigosSecao.tsx`
- Modify: `src/components/planejamento/PlanejamentoDetail.tsx`
- Test: `tests/unit/planejamento-codigos.test.ts`, `tests/unit/planejamento-selos-secoes.test.ts`, `tests/unit/planejamento-envio-explosao.test.ts`, `tests/unit/planejamento-draft.test.ts`, `tests/unit/planejamento-detail-helpers.test.ts`

**Interfaces:**
- Consumes (Task 1): `lerMatriz`, `deveGerarPrimeiraVez`, `resumoGeracao`, `agruparPorVariante`, `rotuloVariante`, `rotuloTamanho`, `situacaoSku`, `avisoSku`, `skuDigitadoParaSalvar`, `seloCodigos`, `type LinhaSku`, `type MatrizSkus`.
- Produces: `SecaoSheetKey` com `"codigos"`; `Draft.tamanho_tipo: "letra" | "numero" | null`; `chaveSkus(modeloId)` = `["plan-skus", modeloId]`; `useSkusModelo(modeloId: string | null, ativo: boolean, podeEditar: boolean)` → `{ matriz: MatrizSkus | undefined; carregando: boolean; erro: boolean; regerar: () => void; regerando: boolean; salvarManual: (v: SalvarSkuVars) => void; salvandoChave: string | null; gerarSeFaltar: () => Promise<void> }`; `type SkusModelo`; `<CodigosSecao draft setDraftTracked rotuloRef refVisivel refEditavel motivoTravaRef skus podeVerSkus podeEditarSkus />`.

- [ ] **Step 1: Testes (falham)**

(a) `tests/unit/planejamento-codigos.test.ts` — ACRESCENTAR no fim (imports no topo do arquivo: `import { readFileSync } from "node:fs";` e `import { fileURLToPath } from "node:url";`):

```ts
const fonte = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8");

describe("Códigos no Sheet (fonte) — a REF saiu da seção 3 e mora na 4", () => {
  it("DevEquipeSection não tem mais a REF", () => {
    const s = fonte("src/components/planejamento/planejamento-detail/ficha/secoes/DevEquipeSection.tsx");
    expect(s).not.toContain('data-colab-path="ref"');
    expect(s).not.toMatch(/refVisivel/);
  });
  it("CodigosSecao: REF, 'Tamanho em', SKU com data-colab-path próprio, Regerar com AlertDialog e o texto do mockup", () => {
    const s = fonte("src/components/planejamento/planejamento-detail/codigos/CodigosSecao.tsx");
    expect(s).toContain('data-colab-path="ref"');
    expect(s).toContain('data-colab-path="tamanho_tipo"');
    expect(s).toContain("data-colab-path={`sku:${linha.variante_key}:${linha.tamanho_key}`}");
    expect(s).toContain("Regerar SKUs");
    expect(s).toMatch(/<AlertDialog\b/);
    expect(s).toContain("SKUs editados à mão não mudam");
    expect(s).toContain("SKUs por variante e tamanho");
    expect(s).toContain(
      "As variantes vêm do Tecido 1 (seção Tecidos) e os tamanhos, da Grade. Formato: REF - cor base + apelido + tamanho (Config da Loja › Formato do SKU). 'Regerar SKUs' pede confirmação e nunca muda os editados à mão.",
    );
  });
  it("PlanejamentoDetail: seção 3 = 'Desenvolvimento'; 'Códigos' logo depois; 1ª geração no pós-Salvar; SKUs relidos pelo colab", () => {
    const s = fonte("src/components/planejamento/PlanejamentoDetail.tsx");
    const iDev = s.indexOf('<Secao id="desenvolvimento" titulo="Desenvolvimento"');
    const iCod = s.indexOf('<Secao id="codigos" titulo="Códigos"');
    const iProva = s.indexOf('<Secao id="prova"');
    expect(iDev).toBeGreaterThan(0);
    expect(iCod).toBeGreaterThan(iDev);
    expect(iProva).toBeGreaterThan(iCod);
    expect(s).not.toContain("Desenvolvimento — equipe e cronograma");
    expect(s).toMatch(/const aoSalvar = \(\) => \{[^}]*skus\.gerarSeFaltar\(\)/);
    expect(s).toContain('qc.invalidateQueries({ queryKey: ["plan-skus", modeloId] });');
    expect(/<DevEquipeSection[^>]*refVisivel=/.test(s)).toBe(false); // [^>]: não atravessa o `/>` até a CodigosSecao
  });
});
```

(b) `tests/unit/planejamento-selos-secoes.test.ts` — dentro de `describe("numerarSecoes", …)` ACRESCENTAR:

```ts
  it("F3.6 — '4. Códigos' logo depois de '3. Desenvolvimento' (a Mão de obra ainda é seção até a Task 3)", () => {
    const v = new Set<SecaoSheetKey>([
      "info", "colecao", "desenvolvimento", "codigos", "prova", "tecidos", "aviamentos", "insumos", "grade", "cad",
      "preco", "mao_obra", "anexos", "observacoes", "lancamento", "relacionado",
    ]);
    expect(numerarSecoes(v)).toMatchObject({ desenvolvimento: 3, codigos: 4, prova: 5, preco: 11, mao_obra: 12, relacionado: 16 });
  });
```

(c) `tests/unit/planejamento-envio-explosao.test.ts` — nas DUAS ocorrências de `{ label: "REF", secao: "desenvolvimento" }` (hoje `:62` e `:95`) trocar por `{ label: "REF", secao: "codigos" }` (Ruling R2 — a REF saiu da seção 3).

(d) `tests/unit/planejamento-draft.test.ts` — ACRESCENTAR:

```ts
describe("Draft F3.6 — 'Tamanho em' (modelos.tamanho_tipo, coluna da F3.5a)", () => {
  it("emptyDraft null (= padrão da loja); draftFromModeloRow só aceita letra|numero", () => {
    expect(emptyDraft().tamanho_tipo).toBeNull();
    expect(draftFromModeloRow({ tamanho_tipo: "numero" }).tamanho_tipo).toBe("numero");
    expect(draftFromModeloRow({ tamanho_tipo: "letra" }).tamanho_tipo).toBe("letra");
    expect(draftFromModeloRow({ tamanho_tipo: "cm" }).tamanho_tipo).toBeNull();
    expect(draftFromModeloRow({}).tamanho_tipo).toBeNull();
  });
});
```

(e) `tests/unit/planejamento-detail-helpers.test.ts` — ACRESCENTAR:

```ts
describe("rotuloConflitoPlan — F3.6 (seção Códigos)", () => {
  it("'Tamanho em'", () => {
    expect(rotuloConflitoPlan("tamanho_tipo")).toBe("Tamanho em");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit/planejamento-codigos.test.ts tests/unit/planejamento-selos-secoes.test.ts tests/unit/planejamento-envio-explosao.test.ts tests/unit/planejamento-draft.test.ts tests/unit/planejamento-detail-helpers.test.ts`
Expected: FAIL — `ENOENT …CodigosSecao.tsx`, `codigos: undefined`, `secao: "desenvolvimento"`, `tamanho_tipo` undefined, rótulo `"tamanho_tipo"`.

- [ ] **Step 3: `selos-secoes.ts` — chave `codigos` na ordem (a `mao_obra` sai só na Task 3)**

Em `SecaoSheetKey`, trocar a 1ª linha `| "info" | "colecao" | "desenvolvimento" | "prova"` por `| "info" | "colecao" | "desenvolvimento" | "codigos" | "prova"`. Em `ORDEM_SECOES_SHEET`, trocar `"info", "colecao", "desenvolvimento", "prova",` por `"info", "colecao", "desenvolvimento", "codigos", "prova",` e o comentário acima por:

```ts
/** Ordem do mockup aprovado (gen_main.py:106) + F3.6 (spec 2026-09-25 §5.1): "Códigos" logo depois de "Desenvolvimento"
 *  + "Tecidos" do Dialog e as 2 seções da revenda onde o JSX as põe. */
```

- [ ] **Step 4: `envio-explosao.ts:70`**

```ts
  // F3.6 (Ruling R2) — a REF mora na seção "4. Códigos" (saiu de "Desenvolvimento").
  if (vazio(d.ref)) out.push({ label: i.rotuloRef, secao: "codigos" });
```

- [ ] **Step 5: `DevEquipeSection.tsx` sem a REF**

(1) Tirar `import { Input } from "@/components/ui/input";`. (2) Assinatura: tirar `refVisivel` do destructuring e do tipo (o JSDoc `/** Campo REF … */` + `refVisivel: boolean;` saem). (3) Trocar o bloco `{(refVisivel || verModelista) && ( … )}` (hoje `:108-127`) por:

```tsx
      {/* F3.6 (spec 2026-09-25 §5.1) — a REF saiu desta seção: mora na "4. Códigos" (CodigosSecao), com a mesma regra
          de exibição (refVisivel) e a mesma trava (refEditavel). */}
      {verModelista && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FieldSelect
            label={fl("modelista")}
            value={draft.modelista_id}
            onChange={(v) => set({ modelista_id: v })}
            onLimpar={() => set({ modelista_id: null })}
            options={modelistas}
            disabled={bloqueado}
          />
        </div>
      )}
```

(4) No comentário de topo do arquivo, trocar `Seção "Desenvolvimento — equipe e cronograma"` por `Seção "Desenvolvimento"` e acrescentar a linha `// F3.6 — a REF saiu daqui (vai para a seção "4. Códigos").`

- [ ] **Step 6: `modelo-shared.ts` — `tamanho_tipo` no Draft**

No tipo `Draft`, depois de `custos_adicionais: …;`:

```ts
  // F3.6 (seção "4. Códigos", F3.5b do SKU): "Tamanho em" do card — coluna `modelos.tamanho_tipo` da F3.5a
  // (`letra`|`numero`; NULL = padrão da loja em `sku_config.tamanho_padrao`). Grava no Salvar (campo do Planejamento).
  tamanho_tipo: "letra" | "numero" | null;
```

Em `emptyDraft()`, depois de `custos_adicionais: [],`: `tamanho_tipo: null,`. Em `draftFromModeloRow`, depois de `custos_adicionais: …,`:

```ts
    tamanho_tipo: data.tamanho_tipo === "letra" || data.tamanho_tipo === "numero" ? data.tamanho_tipo : null,
```

- [ ] **Step 7: `helpers.ts` — rótulo**

Em `ROTULO_CONFLITO_PLAN`, depois de `proporcoes: "Proporções da grade", custos_adicionais: "Custos adicionais",`:

```ts
  // F3.6 — seção "4. Códigos".
  tamanho_tipo: "Tamanho em",
```

- [ ] **Step 8: `codigos/useSkusModelo.ts`**

```ts
// Leitura e ações dos SKUs do card (F3.6 — seção "4. Códigos", F3.5b do SKU). Tudo pelas RPCs da F3.5a (o wrapper confere
// módulo `criacao`, loja e `criacao_planejamento` ver/editar — `_sku_guarda`). SKU à mão e Regerar são RPC IMEDIATA (fora do
// Salvar da página, como aprovar MO); a 1ª geração roda depois do Salvar (spec SKU §4.2; Ruling R12).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { mensagemErro } from "@/lib/erro-mensagem";
import { deveGerarPrimeiraVez, lerMatriz, resumoGeracao, type MatrizSkus } from "./sku-card";

export const chaveSkus = (modeloId: string | null) => ["plan-skus", modeloId] as const;

async function lerSkus(modeloId: string): Promise<MatrizSkus> {
  const { data, error } = await supabase.rpc("skus_modelo" as any, { _modelo_id: modeloId });
  if (error) throw error;
  return lerMatriz(data);
}

export type SalvarSkuVars = { id: string | null; sku: string; rev: number | null; varianteKey: string; tamanhoKey: string };

/** `ativo` = card existente e o usuário vê o Planejamento; `podeEditar` = edita o Planejamento (Regerar/SKU à mão/1ª geração). */
export function useSkusModelo(modeloId: string | null, ativo: boolean, podeEditar: boolean) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: chaveSkus(modeloId),
    enabled: ativo && !!modeloId,
    queryFn: () => lerSkus(modeloId as string),
  });
  const invalidar = () => qc.invalidateQueries({ queryKey: chaveSkus(modeloId) });
  const regerar = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("gerar_skus_modelo" as any, { _modelo_id: modeloId, _regerar: true });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      const r = resumoGeracao(data);
      if (r.erro) toast.error(r.texto);
      else toast.success(r.texto);
      invalidar();
    },
    onError: (e) => { toast.error(mensagemErro(e, "Não foi possível regerar os SKUs.")); invalidar(); },
  });
  const salvar = useMutation({
    mutationFn: async (v: SalvarSkuVars) => {
      const { error } = await supabase.rpc("salvar_sku_manual" as any, {
        _id: v.id, _sku: v.sku, _rev_base: v.rev, _modelo_id: modeloId, _variante_key: v.varianteKey, _tamanho_key: v.tamanhoKey,
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("SKU salvo — marcado como editado à mão."); invalidar(); },
    onError: (e) => { toast.error(mensagemErro(e, "Não foi possível salvar o SKU.")); invalidar(); },
  });
  /** Depois do Salvar: matriz FRESCA; card com REF e SEM SKU gravado ⇒ gera (`_regerar=false` só cria o que falta). */
  const gerarSeFaltar = async () => {
    if (!ativo || !modeloId || !podeEditar) return;
    try {
      if (!deveGerarPrimeiraVez(await lerSkus(modeloId))) return;
      const { data, error } = await supabase.rpc("gerar_skus_modelo" as any, { _modelo_id: modeloId, _regerar: false });
      if (error) throw error;
      const r = resumoGeracao(data);
      if (r.erro) toast.error(r.texto);
    } catch (e) {
      toast.error(mensagemErro(e, "O card foi salvo, mas os SKUs não foram gerados — abra a seção Códigos e use “Regerar SKUs”."));
    } finally {
      invalidar();
    }
  };
  return {
    matriz: q.data,
    carregando: q.isLoading,
    erro: q.isError,
    regerar: () => regerar.mutate(),
    regerando: regerar.isPending,
    salvarManual: (v: SalvarSkuVars) => salvar.mutate(v),
    salvandoChave: salvar.isPending && salvar.variables ? `${salvar.variables.varianteKey}|${salvar.variables.tamanhoKey}` : null,
    gerarSeFaltar,
  };
}
export type SkusModelo = ReturnType<typeof useSkusModelo>;
```

- [ ] **Step 9: `codigos/CodigosSecao.tsx`**

```tsx
// Seção "4. Códigos" do Sheet do Planejamento (F3.6 — spec 2026-09-25 §5.1; F3.5b da spec do SKU §4.3).
// L1: REF (o MESMO campo que saiu da seção 3 — aparece a partir da etapa configurada, `refVisivel`, e edita com a trava de
// hoje, `refEditavel`) · "Tamanho em" (Draft → `modelos.tamanho_tipo`; grava no Salvar; NULL = padrão da loja) ·
// "Regerar SKUs" (AlertDialog; nunca muda os editados à mão). Tabela "SKUs por variante e tamanho": o SKU GRAVADO (editável
// à mão — RPC imediata `salvar_sku_manual` com `_rev_base`, fora do Salvar da página) e a situação de cada linha. Geração e
// leitura 100% no servidor (F3.5a); regras de exibição puras em ./sku-card.ts. Sem as "(SIGLA)" do mockup (R11).
import { Fragment, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { Link } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { StatusBadge } from "@/components/shared/StatusBadge";
import type { Draft } from "@/components/planejamento/modelo-shared";
import { AvisoCamposDev, type MotivoTravaDev } from "@/components/planejamento/planejamento-detail/ficha/secoes/AvisoCamposDev";
import {
  agruparPorVariante, avisoSku, rotuloTamanho, rotuloVariante, situacaoSku, skuDigitadoParaSalvar, type LinhaSku,
} from "./sku-card";
import type { SkusModelo } from "./useSkusModelo";

const TAMANHO_PADRAO = "padrao";

// Nível de MÓDULO (não dentro do render): declarado dentro, remontaria a cada render e o input perderia o foco.
function SkuCampo({ linha, editavel, salvando, onSalvar }: {
  linha: LinhaSku; editavel: boolean; salvando: boolean; onSalvar: (sku: string) => void;
}) {
  const [texto, setTexto] = useState(linha.sku ?? "");
  // Recarregou do servidor (salvou / regerou / outra pessoa): o campo acompanha.
  useEffect(() => { setTexto(linha.sku ?? ""); }, [linha.sku, linha.rev]);
  const confirmar = () => {
    const r = skuDigitadoParaSalvar(linha, texto);
    if (r.acao === "salvar") { onSalvar(r.sku); return; }
    if (r.acao === "erro") toast.error(r.erro);
    setTexto(linha.sku ?? "");
  };
  return (
    <Input
      className="h-8 w-full min-w-0 font-mono text-xs"
      value={texto}
      placeholder={linha.sku_previsto ?? ""}
      disabled={!editavel || salvando}
      aria-label={`SKU do tamanho ${linha.tamanho_key}`}
      onChange={(e) => setTexto(e.target.value)}
      onBlur={confirmar}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
      data-colab-path={`sku:${linha.variante_key}:${linha.tamanho_key}`}
    />
  );
}

export function CodigosSecao({
  draft, setDraftTracked, rotuloRef, refVisivel, refEditavel, motivoTravaRef, skus, podeVerSkus, podeEditarSkus,
}: {
  draft: Draft;
  setDraftTracked: Dispatch<SetStateAction<Draft>>;
  rotuloRef: string;
  /** A REF aparece a partir da etapa configurada (`refCampoVisivel`; posição DERIVADA com a chave ligada — inv. #11). */
  refVisivel: boolean;
  /** = `refEditavel` do orquestrador (isEdit && !devBloqueado && refVisivel) — o MESMO que põe a REF no payload. */
  refEditavel: boolean;
  /** Por que a REF está só-leitura (enviado à Explosão / sem permissão do Dev). Só aparece com `refVisivel`. */
  motivoTravaRef: MotivoTravaDev;
  skus: SkusModelo;
  /** Ver SKUs = ver o Planejamento; editar/Regerar = editar o Planejamento (spec SKU §4.4 — o servidor confere). */
  podeVerSkus: boolean;
  podeEditarSkus: boolean;
}) {
  const [confirmarRegerar, setConfirmarRegerar] = useState(false);
  const m = skus.matriz;
  const grupos = m ? agruparPorVariante(m.linhas) : [];
  const editavel = !!m && m.status === "ok" && podeEditarSkus;
  return (
    <div className="space-y-3">
      {refVisivel && <AvisoCamposDev motivo={motivoTravaRef} />}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        {refVisivel ? (
          <div className="grid gap-1">
            <Label htmlFor="codigos-ref">{rotuloRef}</Label>
            <Input
              id="codigos-ref"
              className="font-mono"
              value={draft.ref}
              disabled={!refEditavel}
              onChange={(e) => setDraftTracked((d) => ({ ...d, ref: e.target.value }))}
              data-colab-path="ref"
            />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">A {rotuloRef} aparece a partir da etapa configurada na Config da Loja.</p>
        )}
        <div className="grid gap-1">
          <Label>Tamanho em</Label>
          <Select
            value={draft.tamanho_tipo ?? TAMANHO_PADRAO}
            onValueChange={(v) => setDraftTracked((d) => ({ ...d, tamanho_tipo: v === "letra" || v === "numero" ? v : null }))}
          >
            <SelectTrigger className="h-9 sm:w-44" aria-label="Tamanho em" data-colab-path="tamanho_tipo"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={TAMANHO_PADRAO}>Padrão da loja</SelectItem>
              <SelectItem value="letra">Letra</SelectItem>
              <SelectItem value="numero">Número</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {podeVerSkus && (
          <Button type="button" variant="outline" size="sm" className="max-sm:min-h-11"
            disabled={!editavel || skus.regerando} onClick={() => setConfirmarRegerar(true)}>
            <RefreshCw className="mr-1 h-4 w-4" /> Regerar SKUs
          </Button>
        )}
      </div>

      {podeVerSkus && (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">SKUs por variante e tamanho</p>
          {skus.carregando ? (
            <p className="text-sm text-muted-foreground">Carregando os SKUs…</p>
          ) : skus.erro ? (
            <p className="text-sm text-destructive">Não foi possível carregar os SKUs — recarregue a página.</p>
          ) : !m ? null : m.linhas.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {m.status === "sem_formato" ? (
                <>A loja ainda não tem o Formato do SKU — <Link to="/admin/configuracoes" className="underline">configurar na Config da Loja</Link>.</>
              ) : m.status === "aguardando_ref" ? (
                `Os SKUs são gerados quando o card tiver ${rotuloRef} (salve o card depois que ela aparecer).`
              ) : (
                "Sem linhas: preencha a Grade (variantes do Tecido 1 × tamanhos com quantidade)."
              )}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="py-1.5 pr-3 font-semibold">Variante / Tamanho</th>
                    <th className="py-1.5 px-2 font-semibold">SKU</th>
                    <th className="py-1.5 pl-2 font-semibold">Situação</th>
                  </tr>
                </thead>
                <tbody className="align-middle">
                  {grupos.map((g) => (
                    <Fragment key={g.chave}>
                      <tr className="bg-muted/40">
                        <td colSpan={3} className="py-1.5 px-2 text-xs font-semibold text-muted-foreground">{rotuloVariante(g)}</td>
                      </tr>
                      {g.linhas.map((l) => {
                        const sit = situacaoSku(l);
                        const aviso = avisoSku(l);
                        const chave = `${l.variante_key}|${l.tamanho_key}`;
                        return (
                          <tr key={chave} className="border-t">
                            <td className="py-2 pr-3 pl-4 whitespace-nowrap">{rotuloTamanho(l.tamanho_key, m.tamanho_tipo)}</td>
                            <td className="py-2 px-2 min-w-40">
                              <SkuCampo
                                linha={l}
                                editavel={editavel && l.estado !== "orfa"}
                                salvando={skus.salvandoChave === chave}
                                onSalvar={(sku) => skus.salvarManual({ id: l.id, sku, rev: l.rev, varianteKey: l.variante_key, tamanhoKey: l.tamanho_key })}
                              />
                            </td>
                            <td className="py-2 pl-2 text-xs">
                              <span className="inline-flex flex-wrap items-center gap-1">
                                {sit.tom === "neutral" ? (
                                  <span className="text-muted-foreground">{sit.texto}</span>
                                ) : (
                                  <StatusBadge tone={sit.tom} className="normal-case tracking-normal">{sit.texto}</StatusBadge>
                                )}
                                {sit.cadastrar && <Link to="/cadastro/atributos" className="underline">cadastrar</Link>}
                              </span>
                              {aviso && (
                                <span className="mt-1 block text-muted-foreground">
                                  {aviso} — <Link to="/cadastro/atributos" className="underline">cadastrar</Link>
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-muted-foreground">As variantes vêm do Tecido 1 (seção Tecidos) e os tamanhos, da Grade. Formato: REF - cor base + apelido + tamanho (Config da Loja › Formato do SKU). 'Regerar SKUs' pede confirmação e nunca muda os editados à mão.</p>
        </div>
      )}

      <AlertDialog open={confirmarRegerar} onOpenChange={setConfirmarRegerar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Regerar os SKUs?</AlertDialogTitle>
            <AlertDialogDescription>
              Os SKUs automáticos são recalculados pelo Formato do SKU, pelas siglas e pelo “Tamanho em” SALVOS agora. SKUs editados à mão não mudam.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirmarRegerar(false); skus.regerar(); }}>Regerar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
```

- [ ] **Step 10: `PlanejamentoDetail.tsx` — fiação (trocas exatas)**

(1) Imports, depois de `import { DevEquipeSection } …`:

```ts
import { CodigosSecao } from "@/components/planejamento/planejamento-detail/codigos/CodigosSecao";
import { useSkusModelo } from "@/components/planejamento/planejamento-detail/codigos/useSkusModelo";
import { seloCodigos } from "@/components/planejamento/planejamento-detail/codigos/sku-card";
```

(2) Depois de `const podeVerDev = canView("criacao_desenvolvimento");`:

```ts
  // F3.6 (seção "4. Códigos" — F3.5b do SKU): SKUs = ver/editar o Planejamento (spec SKU §4.4; o servidor confere no wrapper).
  const podeVerPlanejamento = canView("criacao_planejamento");
  const podeEditarPlanejamento = canEdit("criacao_planejamento");
```

(3) O comentário `// REF editável = a seção "Desenvolvimento" mostra o campo (etapa configurada) e os campos do Dev estão livres.` vira `// REF editável = a seção "Códigos" (F3.6) mostra o campo (etapa configurada) e os campos do Dev estão livres.`

(4) Depois de `const moverEtapa = useMoverEtapa(modeloId, tenantIdAtivo);`:

```ts
  // F3.6 — matriz de SKUs do card (RPC `skus_modelo`, F3.5a) + Regerar / SKU à mão + 1ª geração pós-Salvar (R12).
  const skus = useSkusModelo(modeloId, isEdit && !!modeloId && podeVerPlanejamento, podeEditarPlanejamento);
```

(5) Trocar `  const aoSalvar = () => { setEditandoDev(false); onSaved(); };` por:

```ts
  // F3.6 — 1ª geração automática dos SKUs depois do Salvar que deixa o card com REF e sem SKU (spec SKU §4.2; só cria o que
  // falta — `_regerar=false`; SKU já gravado nunca muda aqui). Sem await: o card já foi salvo; erro vira toast próprio.
  const aoSalvar = () => { setEditandoDev(false); onSaved(); if (isEdit) void skus.gerarSeFaltar(); };
```

(6) No `useColabRegistro`, depois de `qc.invalidateQueries({ queryKey: ["plan-kanban-cond", modeloId] });`:

```ts
      // F3.6 — REF/grade/variantes mudaram no servidor ⇒ a matriz de SKUs relê.
      qc.invalidateQueries({ queryKey: ["plan-skus", modeloId] });
```

(7) No `vis`, depois da linha `desenvolvimento: isEdit && podeVerDev && secFicha.equipe,`: `    codigos: isEdit && !!modeloId,`

(8) Depois de `selos.grade_revenda = seloGradeComprado({ … });`: `  selos.codigos = seloCodigos(skus.matriz);`

(9) Seção 3 + seção 4 — trocar o bloco que começa em `{/* Desenvolvimento — equipe e cronograma (veio do Dev, F3.1).` e termina no `)}` que fecha `{vis.desenvolvimento && (` por:

```tsx
          {/* Desenvolvimento (veio do Dev, F3.1; F3.6: título sem "— equipe e cronograma" e SEM a REF, que foi para "Códigos").
              Sempre visível — independe da etapa — p/ quem vê o Desenvolvimento (decisão F3 #8); recolhida (decisão 6); só no
              card existente. O <fieldset> fica DENTRO da seção (o cabeçalho continua abrindo/fechando com o card travado). */}
          {vis.desenvolvimento && (
            <Secao id="desenvolvimento" titulo="Desenvolvimento" numero={numeros.desenvolvimento} selo={seloDe("desenvolvimento")} defaultOpen={false}>
              <AvisoCamposDev motivo={motivoTravaDev} />
              <fieldset disabled={devBloqueado} className="contents">
                <DevEquipeSection
                  draft={draft}
                  setDraftTracked={setDraftTracked}
                  campoVisivel={campoVisivelDev}
                  bloqueado={devBloqueado}
                  camposCopiados={ficha.camposCopiados}
                  onCampoEditado={ficha.onCampoEditado}
                />
              </fieldset>
            </Secao>
          )}

          {/* F3.6 — "4. Códigos" (spec 2026-09-25 §5.1; F3.5b do SKU): a REF que saiu da seção 3 (mesma exibição/trava) +
              "Tamanho em" + SKUs por variante × tamanho. Só no card existente. */}
          {vis.codigos && modeloId && (
            <Secao id="codigos" titulo="Códigos" numero={numeros.codigos} selo={seloDe("codigos")} defaultOpen={false}>
              <CodigosSecao
                draft={draft}
                setDraftTracked={setDraftTracked}
                rotuloRef={fl("ref")}
                refVisivel={kanbanCard.refVisivel}
                refEditavel={refEditavel}
                motivoTravaRef={motivoTravaDev}
                skus={skus}
                podeVerSkus={podeVerPlanejamento}
                podeEditarSkus={podeEditarPlanejamento}
              />
            </Secao>
          )}
```

- [ ] **Step 11: Rodar e ver passar**

Run: `env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit/planejamento-codigos.test.ts tests/unit/planejamento-selos-secoes.test.ts tests/unit/planejamento-envio-explosao.test.ts tests/unit/planejamento-draft.test.ts tests/unit/planejamento-detail-helpers.test.ts tests/unit/planejamento-dev-equipe-disabled.test.ts`
Expected: PASS (o `planejamento-dev-equipe-disabled.test.ts` segue verde: os 4 `FieldSelect` com `disabled={bloqueado}` e `bloqueado={devBloqueado}` no orquestrador).

- [ ] **Step 12: Gates, conferência manual e commit**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/sheet-reorg"
bash .superpowers/sheet/gates.sh
grep -n 'refVisivel' src/components/planejamento/PlanejamentoDetail.tsx   # só: CodigosSecao refVisivel=, refEditavel, useFichaKanban
git add -- src/components/planejamento/planejamento-detail/ficha/selos-secoes.ts src/components/planejamento/planejamento-detail/ficha/envio-explosao.ts src/components/planejamento/planejamento-detail/ficha/secoes/DevEquipeSection.tsx src/components/planejamento/modelo-shared.ts src/components/planejamento/planejamento-detail/helpers.ts src/components/planejamento/planejamento-detail/codigos/useSkusModelo.ts src/components/planejamento/planejamento-detail/codigos/CodigosSecao.tsx src/components/planejamento/PlanejamentoDetail.tsx tests/unit/planejamento-codigos.test.ts tests/unit/planejamento-selos-secoes.test.ts tests/unit/planejamento-envio-explosao.test.ts tests/unit/planejamento-draft.test.ts tests/unit/planejamento-detail-helpers.test.ts
git commit --only -m "feat(sheet-reorg): seção 4. Códigos — REF sai da seção 3, 'Tamanho em' e SKUs (F3.5b, T2)" \
  -m "CodigosSecao + useSkusModelo sobre skus_modelo/gerar_skus_modelo/salvar_sku_manual; 1ª geração pós-Salvar; pendência REF abre Códigos. Plano 2026-09-25, Task 2." \
  -m "Co-Authored-By: Claude <seu modelo real> <noreply@anthropic.com>" \
  -- src/components/planejamento/planejamento-detail/ficha/selos-secoes.ts src/components/planejamento/planejamento-detail/ficha/envio-explosao.ts src/components/planejamento/planejamento-detail/ficha/secoes/DevEquipeSection.tsx src/components/planejamento/modelo-shared.ts src/components/planejamento/planejamento-detail/helpers.ts src/components/planejamento/planejamento-detail/codigos/useSkusModelo.ts src/components/planejamento/planejamento-detail/codigos/CodigosSecao.tsx src/components/planejamento/PlanejamentoDetail.tsx tests/unit/planejamento-codigos.test.ts tests/unit/planejamento-selos-secoes.test.ts tests/unit/planejamento-envio-explosao.test.ts tests/unit/planejamento-draft.test.ts tests/unit/planejamento-detail-helpers.test.ts
git show --stat HEAD
```

**Revisão do Lote C (Opus, depois deste commit):** Tasks 1+2 contra a spec §5.1/§5.3/§5.4 e a spec do SKU §4.2–§4.4; REF com a MESMA regra (`refVisivel`) e trava (`refEditavel`, que também decide o payload); nenhuma escrita de SKU fora das RPCs; `_rev_base` no SKU à mão; 1ª geração só sem SKU gravado; `tamanho_tipo` no payload (`...d`); selo; mobile (`sm:grid-cols-[1fr_auto_auto]`, tabela em `overflow-x-auto`).

---
## Task 3: Mão de obra DENTRO de "Preço e Custos" (a seção própria some)  *(individual Opus)*

**Files:**
- Modify: `src/components/planejamento/planejamento-detail/ficha/selos-secoes.ts` (sem `mao_obra`; `mao_obra_novo`; condições de Preço ∪ MO; `EntradaSelosSheet` sem `maoObra`)
- Modify: `src/components/planejamento/planejamento-detail/PrecoTabela.tsx` (slots `blocoMaoObra`/`obsMaoObra`)
- Modify: `src/components/planejamento/planejamento-detail/RevendaSetores.tsx` (`PrecoRevendaBloco` com os slots)
- Modify: `src/components/planejamento/PlanejamentoDetail.tsx`
- Create: `tests/unit/planejamento-mo-na-tabela.test.ts`
- Modify: `tests/unit/planejamento-selos-secoes.test.ts`

**Interfaces:**
- Consumes: `MaoObraEditor` e `ObsMaoObraField` como estão (sem mudança); estado/mutations de MO do orquestrador (`moLinhas`, `setMoLinhas`, `catsServico`, `aprovarServicoMO`, `moLinhasPersistidas`).
- Produces: `SecaoSheetKey` sem `"mao_obra"` e com `"mao_obra_novo"`; `CONDICOES_SECAO_SHEET.preco = ["preco_venda_preenchido","servico_aprovado","servico_mo_decidido","servico_mo_preenchido"]`; `EntradaSelosSheet` sem `maoObra`; `PrecoTabela` props novas `blocoMaoObra?: ReactNode; obsMaoObra?: ReactNode`; `PrecoRevendaBloco` props novas `blocoMaoObra?: ReactNode; obsMaoObra?: ReactNode` (a Task 9 acrescenta outras).

- [ ] **Step 1: Testes (falham)**

(a) Criar `tests/unit/planejamento-mo-na-tabela.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// F3.6 (Parte A — spec 2026-09-25 §5.1/§5.3): a seção "Mão de obra" deixa de existir no Sheet; o MaoObraEditor (SEM mudança)
// entra na tabela de "Preço e Custos", logo abaixo da linha "Mão de obra", e a Obs. logo abaixo do "Custo total". Sem
// @testing-library no repo: gates de FONTE (mesmo padrão de planejamento-dev-equipe-disabled.test.ts).
const fonte = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8");
const PD = "src/components/planejamento/PlanejamentoDetail.tsx";
const PT = "src/components/planejamento/planejamento-detail/PrecoTabela.tsx";
const RS = "src/components/planejamento/planejamento-detail/RevendaSetores.tsx";

describe("Mão de obra DENTRO de Preço e Custos (fonte)", () => {
  it("o Sheet não tem mais a seção própria; o Dialog 'Novo Modelo' mantém a MO sem número (mao_obra_novo — Ruling R1)", () => {
    const s = fonte(PD);
    expect(s).not.toContain('<Secao id="mao_obra"');
    expect(s).toContain('<Secao id="mao_obra_novo" titulo="Mão de obra"');
    expect(s).toContain("const moBlocoVisivel = (!isComprado ? true : isEdit) && (veCustos || (isEdit && podeAprovarMaoObra));");
    expect(s).toContain("mao_obra_novo: !isEdit && moBlocoVisivel,");
    expect(s.split("blocoMaoObra={moBlocoVisivel ? editorMaoObra : null}").length - 1).toBe(2); // PrecoTabela + PrecoRevendaBloco
    expect(s).toContain("(na seção Preço e Custos)");
    expect(s).not.toMatch(/maoObra: \{ estado: moEstadoLocal/);
  });
  it("PrecoTabela: bloco logo abaixo da linha 'Mão de obra', Obs. logo abaixo do 'Custo total'; frase velha saiu", () => {
    const s = fonte(PT);
    const iMo = s.indexOf(">Mão de obra</td>");
    const iBloco = s.indexOf("{blocoMaoObra && (");
    const iTotal = s.indexOf(">Custo total</td>");
    const iObs = s.indexOf("{obsMaoObra && (");
    expect(iMo).toBeGreaterThan(0);
    expect(iBloco).toBeGreaterThan(iMo);
    expect(iTotal).toBeGreaterThan(iBloco);
    expect(iObs).toBeGreaterThan(iTotal);
    expect(s).not.toContain("na seção Mão de obra abaixo");
    expect(s).toContain("max-md:sticky max-md:left-0 max-md:w-[calc(100vw-3rem)]");
  });
  it("Revenda: o bloco de preço recebe a MO (opção A do dono)", () => {
    expect(fonte(RS)).toMatch(/export function PrecoRevendaBloco\(\{[^}]*blocoMaoObra[^}]*obsMaoObra/);
  });
});
```

(b) `tests/unit/planejamento-selos-secoes.test.ts` — trocas:

1. No 1º `import`, acrescentar `CONDICOES_SECAO_SHEET` à lista de `…/ficha/selos-secoes`.
2. No `it("Dialog 'Novo Modelo' …")`, trocar `"mao_obra"` por `"mao_obra_novo"` no `Set` (o esperado `{ info: 1, colecao: 2 }` fica).
3. Trocar o `it` da Task 2 ("F3.6 — '4. Códigos' logo depois … até a Task 3") por:

```ts
  it("F3.6 — numeração final da spec §5.1 (1–15): Códigos = 4, Preço e Custos = 11, sem Mão de obra", () => {
    const v = new Set<SecaoSheetKey>([
      "info", "colecao", "desenvolvimento", "codigos", "prova", "tecidos", "aviamentos", "insumos", "grade", "cad",
      "preco", "anexos", "observacoes", "lancamento", "relacionado",
    ]);
    expect(numerarSecoes(v)).toEqual({
      info: 1, colecao: 2, desenvolvimento: 3, codigos: 4, prova: 5, tecidos: 6, aviamentos: 7, insumos: 8, grade: 9, cad: 10,
      preco: 11, anexos: 12, observacoes: 13, lancamento: 14, relacionado: 15,
    });
  });
  it("sem 'codigos' visível, tudo depois do 3 recua 1 (a numeração segue o que está na tela)", () => {
    const v = new Set<SecaoSheetKey>(["info", "colecao", "desenvolvimento", "prova", "preco", "relacionado"]);
    expect(numerarSecoes(v)).toEqual({ info: 1, colecao: 2, desenvolvimento: 3, prova: 4, preco: 5, relacionado: 6 });
  });
```

4. No `describe("selosSecoesSheet", …)`: no objeto `base`, APAGAR `maoObra: { estado: "aprovada", total: 35 },`; no `it("informativos …")` APAGAR a linha `expect(s.mao_obra?.texto.startsWith("aprovada · ")).toBe(true);`; trocar o `it("invariante #12: … Preço e Mão de obra", …)` por:

```ts
  it("invariante #12: sem ver custos, nada em R$ no selo de Preço", () => {
    expect(selosSecoesSheet({ ...base, podeVerCustos: false }).preco).toBeUndefined();
  });
```

trocar o `it("estados da mão de obra e do lançamento", …)` por:

```ts
  it("estado do lançamento", () => {
    expect(selosSecoesSheet({ ...base, lancamento: { lancado: true, data: "2027-03-15" } }).lancamento).toEqual({ tone: "ok", texto: "lançado" });
  });
```

e APAGAR os 3 `it` de mão de obra ("mão de obra vazia (sem_servico) com requisito do kanban satisfeito…", "…NÃO satisfeito → mantém o aviso âmbar", "mão de obra com 1 linha (não vazia)…"). No fim do arquivo, ACRESCENTAR:

```ts
describe("selosSecoesSheet — F3.6: requisitos de Mão de obra no selo de Preço e Custos (Ruling R15)", () => {
  const base: EntradaSelosSheet = {
    requeridas: new Set(), satisfeitas: null, podeVerCustos: true,
    infoCompleta: true, infoVazia: false, colecaoResumo: "",
    desenvolvimentoCompleto: false, desenvolvimentoVazia: true,
    preco: { efetivo: 289.9, markup: 2.91 },
    anexos: { fotoModelo: false, fotoReferencia: false, desenho: false, croqui: false }, lancamento: { lancado: false, data: null },
  };
  it("CONDICOES_SECAO_SHEET.preco = preço + as 3 chaves de MO; a chave mao_obra não existe mais", () => {
    expect(CONDICOES_SECAO_SHEET.preco).toEqual(["preco_venda_preenchido", "servico_aprovado", "servico_mo_decidido", "servico_mo_preenchido"]);
    expect(Object.keys(CONDICOES_SECAO_SHEET)).not.toContain("mao_obra");
  });
  it("preço preenchido + UMA condição de MO pendente ⇒ selo de Preço âmbar com a condição", () => {
    const s = selosSecoesSheet({
      ...base, requeridas: new Set(["preco_venda_preenchido", "servico_mo_decidido"]),
      satisfeitas: { preco_venda_preenchido: true, servico_mo_decidido: false },
    });
    expect(s.preco?.tone).toBe("warn");
    expect(s.preco?.condicaoUnica?.key).toBe("servico_mo_decidido");
  });
  it("preço vazio + requisito de MO NÃO satisfeito ⇒ mantém o âmbar; satisfeito ⇒ sem selo", () => {
    const vazio = { ...base, preco: { efetivo: 0, markup: 0 } };
    expect(selosSecoesSheet({ ...vazio, requeridas: new Set(["servico_aprovado"]), satisfeitas: { servico_aprovado: false } }).preco?.tone).toBe("warn");
    expect(selosSecoesSheet({ ...vazio, requeridas: new Set(["servico_aprovado"]), satisfeitas: { servico_aprovado: true } }).preco).toBeUndefined();
  });
  it("não existe mais selo 'mao_obra'", () => {
    expect(Object.keys(selosSecoesSheet(base))).not.toContain("mao_obra");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit/planejamento-mo-na-tabela.test.ts tests/unit/planejamento-selos-secoes.test.ts`
Expected: FAIL (fonte ainda com `<Secao id="mao_obra"`; `CONDICOES_SECAO_SHEET.preco` só com o preço; `mao_obra_novo` desconhecida).

- [ ] **Step 3: `selos-secoes.ts`**

1. `SecaoSheetKey`: trocar `| "tecidos_novo" | "preco" | "mao_obra" | "produto_acabado" | "grade_revenda"` por `| "tecidos_novo" | "mao_obra_novo" | "preco" | "produto_acabado" | "grade_revenda"`.
2. `ORDEM_SECOES_SHEET`: trocar `"tecidos_novo", "preco", "mao_obra", "produto_acabado",` por `"tecidos_novo", "mao_obra_novo", "preco", "produto_acabado",`; no comentário acima acrescentar: `F3.6: a "Mão de obra" saiu da ordem (entrou na tabela de "Preço e Custos"); "mao_obra_novo" = a MO do Dialog "Novo Modelo" (sem número — R1/R18).`
3. `CONDICOES_SECAO_SHEET`: trocar `preco: ["preco_venda_preenchido"],` + `mao_obra: ["servico_aprovado", "servico_mo_decidido", "servico_mo_preenchido"],` por:

```ts
  // F3.6 (spec 2026-09-25 §5.3) — a MO mora dentro de "Preço e Custos": as condições dela viram requisito DESTA seção.
  preco: ["preco_venda_preenchido", "servico_aprovado", "servico_mo_decidido", "servico_mo_preenchido"],
```

4. Tirar `import type { EstadoMO } from "@/lib/mao-obra";` e, de `EntradaSelosSheet`, a linha `maoObra: { estado: EstadoMO; total: number };`.
5. Em `selosSecoesSheet`, APAGAR o bloco `const mo = e.maoObra; … out.mao_obra = seloDeSecao(…);` e deixar, logo depois de `out.preco = seloDeSecao(…);`, o comentário: `// F3.6 (R15) — o selo de Preço cobre também o REQUISITO das 3 chaves de MO (r("preco")); o texto informativo segue só preço/markup.`

- [ ] **Step 4: `PrecoTabela.tsx` — slots da MO**

1. `import { useEffect, useRef, useState } from "react";` vira `import { useEffect, useRef, useState, type ReactNode } from "react";`.
2. No tipo das props, depois de `podeVerCustos: boolean; podeEditarCustos: boolean; podeEditarPreco: boolean; markupFaixaOn: boolean;`:

```ts
  // F3.6 (Parte A — spec 2026-09-25 §5.1; R16): a Mão de obra deixa de ser seção — o MESMO MaoObraEditor (montado no
  // orquestrador, com o estado/aprovações de sempre) entra aqui por slot, logo abaixo da linha "Mão de obra"; a Obs. de MO
  // logo abaixo do "Custo total". null/ausente = sem permissão (`moBlocoVisivel`): a linha mostra só o total, como antes.
  blocoMaoObra?: ReactNode; obsMaoObra?: ReactNode;
```

3. No destructuring, acrescentar `blocoMaoObra, obsMaoObra` (ao lado de `markupFaixaOn`).
4. Linha "Mão de obra": trocar `<td className="py-2 pl-2 text-xs text-muted-foreground">{moBadge ?? <span>na seção Mão de obra abaixo</span>}</td>` por `<td className="py-2 pl-2 text-xs text-muted-foreground">{moBadge ?? <span>{blocoMaoObra ? "serviços logo abaixo" : "—"}</span>}</td>`, e logo DEPOIS do `</tr>` dessa linha:

```tsx
          {/* F3.6 — serviços de M.O. (valor, aprovar/reprovar p/ quem tem permissão, remover, "+ adicionar") DENTRO da tabela.
              Célula única (colSpan): um <fieldset>/lista não cabe em <tbody>; a trava é por `disabled` em cada controle, como
              nas linhas do BOM. No mobile a tabela rola na horizontal — o bloco fica PRESO à esquerda com a largura visível
              (Sheet em tela cheia, `px-6` = 3rem), senão os botões de aprovar ficariam fora da tela. */}
          {blocoMaoObra && (
            <tr className="border-t">
              <td colSpan={4} className="py-2 px-2">
                <div className="max-md:sticky max-md:left-0 max-md:w-[calc(100vw-3rem)]">{blocoMaoObra}</div>
              </td>
            </tr>
          )}
```

5. Logo DEPOIS do `</tr>` da linha "Custo total":

```tsx
          {obsMaoObra && (
            <tr className="border-t">
              <td colSpan={4} className="py-2 px-2">
                <div className="max-md:sticky max-md:left-0 max-md:w-[calc(100vw-3rem)]">{obsMaoObra}</div>
              </td>
            </tr>
          )}
```

- [ ] **Step 5: `RevendaSetores.tsx` — slots no `PrecoRevendaBloco`**

1. Assinatura:

```tsx
export function PrecoRevendaBloco({ rv, custoReal, piRevenda, draft, blocoMaoObra, obsMaoObra }: {
  rv: RevendaPlanejamento; custoReal: boolean; piRevenda: PrecoInfo; draft: Draft;
  /** F3.6 (Parte A, opção A do dono) — a MO do comprado entra NO bloco de preço (não é mais seção própria). */
  blocoMaoObra?: ReactNode; obsMaoObra?: ReactNode;
}) {
```

2. No fim do grid (depois do `)}` que fecha o ternário `produtoRevenda ? (…) : (…)` e ANTES do `</div>` que fecha `<div className="grid sm:grid-cols-2 gap-3">`):

```tsx
                {/* F3.6 (R17) — M.O. no fim do bloco de preço da revenda (a revenda não tem parte "Custos" depois dos preços). */}
                {blocoMaoObra && (
                  <div className="space-y-2 border-t pt-3 sm:col-span-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Mão de obra</p>
                    {blocoMaoObra}
                    {obsMaoObra}
                  </div>
                )}
```

- [ ] **Step 6: `PlanejamentoDetail.tsx` (trocas exatas)**

1. Logo ANTES de `const vis: Record<SecaoSheetKey, boolean> = {`:

```ts
  // F3.6 (Parte A — spec §5.1): a Mão de obra deixa de ser seção no Sheet e vira o bloco da linha "Mão de obra" DENTRO de
  // "Preço e Custos"; a condição de exibir é a MESMA de antes (ver custos OU aprovar; comprado só com o card salvo).
  const moBlocoVisivel = (!isComprado ? true : isEdit) && (veCustos || (isEdit && podeAprovarMaoObra));
```

2. No `vis`, trocar o comentário `// Lote B (revisão do commit 6fac668, I2) — …` (4 linhas) + `mao_obra: (!isComprado ? true : isEdit) && (veCustos || (isEdit && podeAprovarMaoObra)),` por:

```ts
    // F3.6 (R1) — Dialog "Novo Modelo" (sem a seção Preço): a MO segue como seção SEM número (mockup gen_novo.py), chave
    // própria como `tecidos_novo`. No Sheet ela mora dentro de "Preço e Custos" (`moBlocoVisivel`).
    mao_obra_novo: !isEdit && moBlocoVisivel,
```

3. Na chamada `selosSecoesSheet({ … })`, APAGAR a linha `maoObra: { estado: moEstadoLocal, total: maoObraDevLive },`.
4. Em `lancarBloqueios`: `"Aprove a mão de obra de todos os serviços (na seção Mão de obra)."` vira `"Aprove a mão de obra de todos os serviços (na seção Preço e Custos)."`.
5. Logo ANTES de `const conteudo = (`:

```tsx
  // F3.6 (R16) — o editor de M.O. POR SERVIÇO (spec 2026-08-06) e a Obs. de M.O., montados UMA vez e encaixados: na tabela
  // de "Preço e Custos" (manufaturado e importado), no bloco de preço da revenda, ou na seção sem número do Dialog "Novo
  // Modelo". VALOR = rascunho `moLinhas` (grava no Salvar); aprovar/reprovar = RPC imediata gated por
  // `producao_servico_aprovacao` (invariante #12); ver/digitar valor = `veCustos` (união das 2 permissões, decisão F3 #2).
  const editorMaoObra = (
    <MaoObraEditor
      linhas={moLinhas}
      categorias={catsServico}
      podeVerCustos={veCustos}
      podeAprovar={isEdit && podeAprovarMaoObra}
      onChangeLinhas={(ls) => setMoLinhas(ls)}
      onAprovar={(linhaId) => aprovarServicoMO.mutate({ linhaId, aprovado: true })}
      onReprovar={(linhaId, motivo) => aprovarServicoMO.mutate({ linhaId, aprovado: false, motivo })}
      pendingLinhaId={aprovarServicoMO.isPending ? aprovarServicoMO.variables?.linhaId : undefined}
      linhasPersistidas={moLinhasPersistidas}
    />
  );
  // F3.1 (mockup aprovado): rótulo "Obs. Mão de Obra", igual ao do Dev (ModeloDetailPanel.tsx:3051-3055).
  const obsMaoObra = veCustos ? (
    <ObsMaoObraField
      label="Obs. Mão de Obra"
      value={draft.observacoes_mao_obra}
      onChange={(v) => setDraftTracked((d) => ({ ...d, observacoes_mao_obra: v }))}
    />
  ) : null;
```

6. JSX — logo DEPOIS do `)}` que fecha `{vis.tecidos_novo && (…)}`:

```tsx
          {/* F3.6 (R1) — só no Dialog "Novo Modelo" (a seção Preço não existe nele): a MESMA M.O. da tabela do Sheet. */}
          {vis.mao_obra_novo && (
            <Secao id="mao_obra_novo" titulo="Mão de obra" numero={numeros.mao_obra_novo} defaultOpen={false}>
              {editorMaoObra}
              {obsMaoObra && <div className="mt-3">{obsMaoObra}</div>}
            </Secao>
          )}
```

7. `<PrecoTabela …>`: acrescentar, depois de `custosBom={…}` (antes do `/>`):

```tsx
                // F3.6 (R16) — a M.O. entra na tabela (linha "Mão de obra" + Obs. abaixo do "Custo total").
                blocoMaoObra={moBlocoVisivel ? editorMaoObra : null}
                obsMaoObra={moBlocoVisivel ? obsMaoObra : null}
```

8. `<PrecoRevendaBloco rv={revenda} custoReal={custoReal} piRevenda={piRevenda} draft={draft} />` vira:

```tsx
              <PrecoRevendaBloco rv={revenda} custoReal={custoReal} piRevenda={piRevenda} draft={draft}
                blocoMaoObra={moBlocoVisivel ? editorMaoObra : null} obsMaoObra={moBlocoVisivel ? obsMaoObra : null} />
```

9. APAGAR a seção antiga inteira: do comentário `{/* Mão de obra POR SERVIÇO (spec 2026-08-06) — LOGO ABAIXO da seção Preço …` até o `)}` que fecha `{vis.mao_obra && (…)}` (hoje `:1540-1583`, 2 comentários + a `Secao`). Conferir: `grep -n 'vis.mao_obra\b\|numeros.mao_obra\b\|seloDe("mao_obra")' src/components/planejamento/PlanejamentoDetail.tsx` → vazio.

- [ ] **Step 7: Rodar e ver passar**

Run: `env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit/planejamento-mo-na-tabela.test.ts tests/unit/planejamento-selos-secoes.test.ts tests/unit/planejamento-codigos.test.ts tests/unit/mao-obra.test.ts`
Expected: PASS.

- [ ] **Step 8: Gates e commit**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/sheet-reorg"
bash .superpowers/sheet/gates.sh
git add -- src/components/planejamento/planejamento-detail/ficha/selos-secoes.ts src/components/planejamento/planejamento-detail/PrecoTabela.tsx src/components/planejamento/planejamento-detail/RevendaSetores.tsx src/components/planejamento/PlanejamentoDetail.tsx tests/unit/planejamento-mo-na-tabela.test.ts tests/unit/planejamento-selos-secoes.test.ts
git commit --only -m "feat(sheet-reorg): Mão de obra dentro de Preço e Custos; a seção própria sai (T3)" \
  -m "MaoObraEditor sem mudança, por slot na tabela (manufaturado/importado) e no bloco da revenda; Dialog Novo mantém a MO sem número; selo de Preço com os requisitos de MO. Plano 2026-09-25, Task 3." \
  -m "Co-Authored-By: Claude <seu modelo real> <noreply@anthropic.com>" \
  -- src/components/planejamento/planejamento-detail/ficha/selos-secoes.ts src/components/planejamento/planejamento-detail/PrecoTabela.tsx src/components/planejamento/planejamento-detail/RevendaSetores.tsx src/components/planejamento/PlanejamentoDetail.tsx tests/unit/planejamento-mo-na-tabela.test.ts tests/unit/planejamento-selos-secoes.test.ts
git show --stat HEAD
```

**Revisão individual Opus:** invariantes #8/#12 (valor só com `veCustos`; aprovar só com `producao_servico_aprovacao`; remover como antes — o `MaoObraEditor` não muda); o bloco nunca aparece sem `moBlocoVisivel`; Dialog novo igual a antes (MO sem número); `maoObraPendente`/`lancar` intactos; numeração 1–15 da spec; mobile (bloco `sticky` com a largura visível).

---

## Task 4: `src/lib/titulo-pagina.ts` — espelho TS do título automático  *(Lote B1 — revisão junto com a Task 5)*

**Files:**
- Create: `src/lib/titulo-pagina.ts`
- Create: `tests/fixtures/titulo-pagina-casos.ts`
- Test: `tests/unit/titulo-pagina.test.ts`

**Interfaces:**
- Produces (Tasks 6 e 8): `TITULO_MAIUSC`, `TITULO_MINUSC` (51 caracteres cada), `TITULO_CONECTIVOS: readonly string[]`, `TITULO_SEPARADOR = " | "`; `nomeEmTitulo(nome: string | null | undefined): string`; `tituloPaginaCalculado(nome: string | null | undefined, loja: string | null | undefined): string` (espelho de `public._titulo_pagina_calculado(text,text)`); `tituloExibido(fixado: string | null | undefined, calculado: string): string`; `tituloAoDigitar(digitado: string, calculado: string): string | null`; fixtures `CASOS_TITULO: readonly { nome: string | null; loja: string | null; esperado: string }[]`.

- [ ] **Step 1: Fixtures** — `tests/fixtures/titulo-pagina-casos.ts`:

```ts
// Casos do "Título para a página" automático (F3.6 — spec 2026-09-25, ruling 1). Rodam nos DOIS lados (anti-drift):
// tests/unit/titulo-pagina.test.ts (TS — src/lib/titulo-pagina.ts) e tests/integration/sheet-reorg-campos.test.ts (SQL —
// public._titulo_pagina_calculado). Mudou a regra? Mude os dois lados e estes casos.
export type CasoTitulo = { nome: string | null; loja: string | null; esperado: string };
export const CASOS_TITULO: readonly CasoTitulo[] = [
  { nome: "VESTIDO LONGO POEMA", loja: "Ave Rara", esperado: "Vestido Longo Poema | Ave Rara" }, // exemplo do mockup
  { nome: "vestido de festa", loja: "Ave Rara", esperado: "Vestido de Festa | Ave Rara" },
  { nome: "DA VINCI", loja: "Ave Rara", esperado: "Da Vinci | Ave Rara" }, // conectivo NO INÍCIO capitaliza
  { nome: "blusa DO DIA DAS MÃES", loja: "Ave Rara", esperado: "Blusa do Dia das Mães | Ave Rara" },
  { nome: "MACACÃO EM LINHO COM BOTÕES PARA O VERÃO", loja: "Ave Rara", esperado: "Macacão em Linho com Botões para O Verão | Ave Rara" },
  { nome: "CORAÇÃO E ALMA", loja: "X", esperado: "Coração e Alma | X" },
  { nome: "e", loja: "Loja", esperado: "E | Loja" },
  { nome: "", loja: "Ave Rara", esperado: "" }, // nome vazio ⇒ vazio (NUNCA " | Loja" solto — dono 25/set)
  { nome: null, loja: "Ave Rara", esperado: "" },
  { nome: "   \t ", loja: "Ave Rara", esperado: "" },
  { nome: "  CALÇA   JEANS  ", loja: "Loja Teste", esperado: "Calça Jeans | Loja Teste" },
  { nome: "VESTIDO\tLONGO\nPOEMA", loja: "L", esperado: "Vestido Longo Poema | L" },
  { nome: "SAIA MIDI", loja: "", esperado: "Saia Midi" }, // loja vazia ⇒ só o nome
  { nome: "SAIA MIDI", loja: null, esperado: "Saia Midi" },
  { nome: "SAIA", loja: " \t ", esperado: "Saia" },
  { nome: "SAIA MIDI", loja: "  Ave  Rara  ", esperado: "Saia Midi | Ave  Rara" }, // loja: só as pontas
  { nome: "ÁGUA-MARINHA", loja: "L", esperado: "Água-marinha | L" },
  { nome: "ÉPICA ÑANDU ÄRGER", loja: "L", esperado: "Épica Ñandu Ärger | L" },
  { nome: "ØRSTED blusa", loja: "L", esperado: "Ørsted Blusa | L" }, // letra fora da lista fica como está (nos 2 lados)
  { nome: "123 ANOS", loja: "L", esperado: "123 Anos | L" },
  { nome: "mod. 2027 (verão)", loja: "L", esperado: "Mod. 2027 (verão) | L" },
];
```

- [ ] **Step 2: Teste (falha)** — `tests/unit/titulo-pagina.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { CASOS_TITULO } from "../fixtures/titulo-pagina-casos";
import {
  TITULO_CONECTIVOS, TITULO_MAIUSC, TITULO_MINUSC, nomeEmTitulo, tituloAoDigitar, tituloExibido, tituloPaginaCalculado,
} from "@/lib/titulo-pagina";

describe("tituloPaginaCalculado — espelho de _titulo_pagina_calculado (as MESMAS fixtures rodam no SQL)", () => {
  it.each(CASOS_TITULO.map((c) => [JSON.stringify([c.nome, c.loja]), c] as const))("%s", (_rotulo, c) => {
    expect(tituloPaginaCalculado(c.nome, c.loja)).toBe(c.esperado);
  });
  it("nome vazio NUNCA vira ' | Loja' solto", () => {
    for (const nome of ["", " ", null, undefined]) expect(tituloPaginaCalculado(nome, "Ave Rara")).toBe("");
  });
  it("nomeEmTitulo sozinho", () => {
    expect(nomeEmTitulo("VESTIDO LONGO POEMA")).toBe("Vestido Longo Poema");
  });
});

describe("listas fixas (iguais às do translate() do SQL — independe do locale)", () => {
  it("51 maiúsculas pareadas com 51 minúsculas (A–Z + 25 acentos PT)", () => {
    const mai = [...TITULO_MAIUSC];
    const min = [...TITULO_MINUSC];
    expect(mai).toHaveLength(51);
    expect(min).toHaveLength(51);
    mai.forEach((c, i) => expect(c.toLowerCase()).toBe(min[i]));
  });
  it("conectivos da spec (ruling 1)", () => {
    expect(TITULO_CONECTIVOS).toEqual(["de", "da", "do", "das", "dos", "e", "com", "em", "para"]);
  });
});

describe("apoio à tela (sem espelho SQL)", () => {
  it("tituloExibido: o fixado à mão; NULL = o calculado ao vivo", () => {
    expect(tituloExibido(null, "Saia | L")).toBe("Saia | L");
    expect(tituloExibido("Meu título", "Saia | L")).toBe("Meu título");
  });
  it("tituloAoDigitar: igual ao calculado segue AUTOMÁTICO (NULL); diferente vira manual (Ruling R5)", () => {
    expect(tituloAoDigitar("Saia | L", "Saia | L")).toBeNull();
    expect(tituloAoDigitar("Saia | L!", "Saia | L")).toBe("Saia | L!");
    expect(tituloAoDigitar("", "Saia | L")).toBe(""); // vazio vira NULL no blur/Salvar (R6)
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit/titulo-pagina.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/titulo-pagina"`.

- [ ] **Step 4: Implementar** — `src/lib/titulo-pagina.ts`:

```ts
// Título para a página (F3.6 — spec 2026-09-25, ruling 1): AUTOMÁTICO = Nome do Modelo em "iniciais maiúsculas" + " | " +
// o nome da loja (`tenants.nome`, a MARCA — não o WISH360). ESPELHO byte a byte de public._titulo_pagina_calculado (migration
// 20261005100000) — anti-drift: tests/fixtures/titulo-pagina-casos.ts roda nos DOIS lados (tests/unit/titulo-pagina.test.ts e
// tests/integration/sheet-reorg-campos.test.ts). Mudou a regra aqui? Mude o SQL (migration nova) e as fixtures.
// Regras: nome com espaço/tab/CR/LF das pontas tirados e o miolo em 1 espaço; cada palavra com a 1ª letra maiúscula e o
// resto minúsculo por lista FIXA de letras (A–Z + acentos PT — igual ao translate() do SQL, independe do locale do banco;
// letra fora da lista fica como está nos dois lados); conectivos em minúsculo, salvo a 1ª palavra; a loja entra como está
// (só as pontas aparadas). Nome vazio ⇒ "" (NUNCA " | Loja" solto — dono 25/set); loja vazia ⇒ só o nome (R7). PURO.

export const TITULO_MAIUSC = "ABCDEFGHIJKLMNOPQRSTUVWXYZÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑÝ";
export const TITULO_MINUSC = "abcdefghijklmnopqrstuvwxyzáàâãäéèêëíìîïóòôõöúùûüçñý";
export const TITULO_CONECTIVOS: readonly string[] = ["de", "da", "do", "das", "dos", "e", "com", "em", "para"];
export const TITULO_SEPARADOR = " | ";

const MAI = [...TITULO_MAIUSC];
const MIN = [...TITULO_MINUSC];
const PARA_MIN = new Map(MAI.map((c, i) => [c, MIN[i]] as const));
const PARA_MAI = new Map(MIN.map((c, i) => [c, MAI[i]] as const));
function trocar(s: string, mapa: Map<string, string>): string {
  let out = "";
  for (const ch of s) out += mapa.get(ch) ?? ch;
  return out;
}
const PONTAS = /^[ \t\r\n]+|[ \t\r\n]+$/g; // = btrim(x, E' \t\r\n')
const MIOLO = /[ \t\r\n]+/g; // = regexp_replace(x, E'[ \t\r\n]+', ' ', 'g')

/** "VESTIDO LONGO POEMA" → "Vestido Longo Poema"; "vestido de festa" → "Vestido de Festa"; "  " → "". */
export function nomeEmTitulo(nome: string | null | undefined): string {
  const s = (nome ?? "").replace(PONTAS, "").replace(MIOLO, " ");
  if (s === "") return "";
  return s
    .split(" ")
    .map((w, i) => {
      const baixa = trocar(w, PARA_MIN);
      if (i > 0 && TITULO_CONECTIVOS.includes(baixa)) return baixa;
      const [primeira = "", ...resto] = [...w];
      return trocar(primeira, PARA_MAI) + trocar(resto.join(""), PARA_MIN);
    })
    .join(" ");
}

/** Espelho de public._titulo_pagina_calculado(_nome, _loja). */
export function tituloPaginaCalculado(nome: string | null | undefined, loja: string | null | undefined): string {
  const n = nomeEmTitulo(nome);
  if (n === "") return "";
  const l = (loja ?? "").replace(PONTAS, "");
  return l === "" ? n : `${n}${TITULO_SEPARADOR}${l}`;
}

// ── apoio à tela (sem espelho SQL) ──
/** O que o campo mostra: o fixado à mão; NULL = o automático (calculado ao vivo, a cada tecla no Nome). */
export function tituloExibido(fixado: string | null | undefined, calculado: string): string {
  return fixado ?? calculado;
}
/** Digitar no Título: igual ao calculado continua AUTOMÁTICO (NULL — spec: "digitou algo diferente → vira manual"). */
export function tituloAoDigitar(digitado: string, calculado: string): string | null {
  return digitado === calculado ? null : digitado;
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit/titulo-pagina.test.ts`
Expected: PASS (21 casos + 6 `it`).

- [ ] **Step 6: Gates e commit**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/sheet-reorg"
bash .superpowers/sheet/gates.sh
git add -- src/lib/titulo-pagina.ts tests/fixtures/titulo-pagina-casos.ts tests/unit/titulo-pagina.test.ts
git commit --only -m "feat(sheet-reorg): título automático da página — espelho TS + fixtures anti-drift (T4)" \
  -m "tituloPaginaCalculado (nome em iniciais maiúsculas + ' | ' + loja; nome vazio = vazio; lista fixa de letras). Plano 2026-09-25, Task 4." \
  -m "Co-Authored-By: Claude <seu modelo real> <noreply@anthropic.com>" \
  -- src/lib/titulo-pagina.ts tests/fixtures/titulo-pagina-casos.ts tests/unit/titulo-pagina.test.ts
git show --stat HEAD
```

---
## Task 5: `Draft`, payload do Salvar, Duplicar e rótulos dos 7 campos novos  *(Lote B1)*

> Só TS (sem banco). Os campos entram no `...d` de TODO Salvar: por isso o merge desta branch só acontece DEPOIS da migration em produção (Global Constraints — ordem obrigatória).

**Files:**
- Modify: `src/components/planejamento/modelo-shared.ts`
- Modify: `src/components/planejamento/planejamento-detail/helpers.ts`
- Modify: `src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts:18, :219-228, :282-303`
- Test: `tests/unit/planejamento-draft.test.ts`, `tests/unit/planejamento-detail-helpers.test.ts`

**Interfaces:**
- Produces (Tasks 6, 8, 9): `Draft.titulo_pagina: string | null`, `peso_kg | comprimento_cm | largura_cm | altura_cm: number | null`, `ncm: string | null`, `preco_anterior: number | null` (nascem `null`); em `helpers.ts`: `filtrarNcm(s: string | null | undefined): string`, `numeroOuNull(v: unknown, casas: number): number | null`, `numeroDoInput(v: string): number | null`, `precoAnteriorOuNull(v: unknown): number | null`, `precoAnteriorExibido(fixado: number | null | undefined, efetivo: number): number | null`, `camposNovosParaPayload(d): { titulo_pagina; ncm; peso_kg; comprimento_cm; largura_cm; altura_cm }`; `camposParaDuplicar` SEM `titulo_pagina`/`preco_anterior` e com ncm/peso/medidas normalizados; `normalizarDraftSalvo` normalizando os 7.

- [ ] **Step 1: Testes (falham)**

(a) `tests/unit/planejamento-draft.test.ts` — ACRESCENTAR:

```ts
describe("Draft F3.6 (Parte B) — Título, Peso/medidas, NCM e Preço anterior", () => {
  const NOVOS = ["titulo_pagina", "peso_kg", "comprimento_cm", "largura_cm", "altura_cm", "ncm", "preco_anterior"] as const;
  it("emptyDraft: os 7 nascem null (NULL = automático / vazio)", () => {
    const d = emptyDraft();
    for (const k of NOVOS) expect(d[k]).toBeNull();
  });
  it("draftFromModeloRow lê as colunas (?? null)", () => {
    const d = draftFromModeloRow({
      titulo_pagina: "Título à mão", peso_kg: 0.35, comprimento_cm: 60, largura_cm: 40, altura_cm: 2.5, ncm: "6204.43.00", preco_anterior: 199.9,
    });
    expect(d).toMatchObject({
      titulo_pagina: "Título à mão", peso_kg: 0.35, comprimento_cm: 60, largura_cm: 40, altura_cm: 2.5, ncm: "6204.43.00", preco_anterior: 199.9,
    });
  });
  it("linha vazia ≡ emptyDraft nos 7 (senão o card abriria 'não salvo' à toa)", () => {
    const a = draftFromModeloRow({});
    const b = emptyDraft();
    for (const k of NOVOS) expect(a[k]).toEqual(b[k]);
  });
});
```

(b) `tests/unit/planejamento-detail-helpers.test.ts` — acrescentar ao `import` de `…/planejamento-detail/helpers`: `filtrarNcm, numeroOuNull, numeroDoInput, precoAnteriorOuNull, precoAnteriorExibido, camposNovosParaPayload` (e `camposParaDuplicar`, `normalizarDraftSalvo`, `rotuloConflitoPlan` se ainda não estiverem) e `emptyDraft` de `@/components/planejamento/modelo-shared`; ACRESCENTAR:

```ts
describe("F3.6 (Parte B) — campos novos: rótulos, NCM, números e Preço anterior", () => {
  it("rótulos PT do banner de conflito", () => {
    expect(rotuloConflitoPlan("titulo_pagina")).toBe("Título para a página");
    expect(rotuloConflitoPlan("peso_kg")).toBe("Peso (kg)");
    expect(rotuloConflitoPlan("comprimento_cm")).toBe("Comprimento (cm)");
    expect(rotuloConflitoPlan("largura_cm")).toBe("Largura (cm)");
    expect(rotuloConflitoPlan("altura_cm")).toBe("Altura (cm)");
    expect(rotuloConflitoPlan("ncm")).toBe("NCM do Produto");
    expect(rotuloConflitoPlan("preco_anterior")).toBe("Preço anterior");
  });
  it("filtrarNcm: só dígitos e pontos, até 10 caracteres (ruling 3 — sem tabela oficial)", () => {
    expect(filtrarNcm("6204.43.00")).toBe("6204.43.00");
    expect(filtrarNcm("62ab04.43,00x")).toBe("6204.4300");
    expect(filtrarNcm("62044300999")).toBe("6204430099");
    expect(filtrarNcm(null)).toBe("");
  });
  it("numeroOuNull: vazio/null/inválido = NULL; 0 VALE (CHECK >= 0); arredonda às casas da coluna", () => {
    expect(numeroOuNull("", 3)).toBeNull();
    expect(numeroOuNull(null, 2)).toBeNull();
    expect(numeroOuNull("abc", 2)).toBeNull();
    expect(numeroOuNull(0, 3)).toBe(0);
    expect(numeroOuNull("0.3456", 3)).toBe(0.346);
    expect(numeroOuNull(12.346, 2)).toBe(12.35);
  });
  it("numeroDoInput: o '' do MoneyInput = NULL (vazio), o resto vira número", () => {
    expect(numeroDoInput("")).toBeNull();
    expect(numeroDoInput("0")).toBe(0);
    expect(numeroDoInput("1.5")).toBe(1.5);
  });
  it("precoAnteriorOuNull: vazio/0 = NULL = automático (não 'preço zero' — ruling 11)", () => {
    expect(precoAnteriorOuNull(null)).toBeNull();
    expect(precoAnteriorOuNull("")).toBeNull();
    expect(precoAnteriorOuNull(0)).toBeNull();
    expect(precoAnteriorOuNull("199.9")).toBe(199.9);
    expect(precoAnteriorOuNull(199.999)).toBe(200);
  });
  it("precoAnteriorExibido: o fixado; senão o preço EFETIVO; efetivo 0 = vazio", () => {
    expect(precoAnteriorExibido(150, 199.9)).toBe(150);
    expect(precoAnteriorExibido(null, 199.9)).toBe(199.9);
    expect(precoAnteriorExibido(undefined, 0)).toBeNull();
  });
  it("camposNovosParaPayload: título aparado (vazio = NULL = automático), NCM filtrado, números normalizados", () => {
    expect(camposNovosParaPayload({
      titulo_pagina: "  Meu título  ", ncm: "6204.43.00x", peso_kg: 0.3456, comprimento_cm: 60, largura_cm: null, altura_cm: 0,
    })).toEqual({ titulo_pagina: "Meu título", ncm: "6204.43.00", peso_kg: 0.346, comprimento_cm: 60, largura_cm: null, altura_cm: 0 });
    expect(camposNovosParaPayload({
      titulo_pagina: "   ", ncm: "", peso_kg: null, comprimento_cm: null, largura_cm: null, altura_cm: null,
    })).toEqual({ titulo_pagina: null, ncm: null, peso_kg: null, comprimento_cm: null, largura_cm: null, altura_cm: null });
  });
  it("camposParaDuplicar: Título e Preço anterior voltam ao AUTOMÁTICO (fora do objeto); NCM/peso/medidas/descrição/'Tamanho em' vão", () => {
    const d = {
      ...emptyDraft(), nome: "Vestido", titulo_pagina: "Título à mão", preco_anterior: 199.9, ncm: "6204.43.00",
      peso_kg: 0.35, comprimento_cm: 60, largura_cm: 40, altura_cm: 2.5, descricao_produto: "Desc", tamanho_tipo: "numero" as const,
    };
    const out = camposParaDuplicar(d);
    expect(out).not.toHaveProperty("titulo_pagina");
    expect(out).not.toHaveProperty("preco_anterior");
    expect(out).toMatchObject({ ncm: "6204.43.00", peso_kg: 0.35, comprimento_cm: 60, largura_cm: 40, altura_cm: 2.5, descricao_produto: "Desc", tamanho_tipo: "numero" });
  });
  it("normalizarDraftSalvo: os 7 com as MESMAS regras do payload (base do merge sem eco do próprio Salvar)", () => {
    const n = normalizarDraftSalvo({
      ...emptyDraft(), titulo_pagina: "  ", ncm: "62.04x", peso_kg: 0.3456, preco_anterior: 0,
    });
    expect(n).toMatchObject({ titulo_pagina: null, ncm: "62.04", peso_kg: 0.346, preco_anterior: null });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit/planejamento-draft.test.ts tests/unit/planejamento-detail-helpers.test.ts`
Expected: FAIL (`titulo_pagina` undefined; `filtrarNcm is not a function`; rótulos caem no próprio path).

- [ ] **Step 3: `modelo-shared.ts`**

No tipo `Draft`, depois de `tamanho_tipo: …;` (Task 2):

```ts
  // F3.6 (Parte B — spec 2026-09-25 §5.2; migration 20261005100000): campos NOVOS do Planejamento (seção 1 e Preço e Custos).
  // NULL = automático (Título: nome em título + " | " + loja; Preço anterior: acompanha o preço de venda EFETIVO) ou vazio
  // (Peso/medidas/NCM). Não são do Dev (fora de CAMPOS_DEV_DRAFT). Fora do types.ts até regenerar — o Draft é tipo próprio.
  titulo_pagina: string | null;
  peso_kg: number | null;
  comprimento_cm: number | null;
  largura_cm: number | null;
  altura_cm: number | null;
  ncm: string | null;
  preco_anterior: number | null;
```

`emptyDraft()`, depois de `tamanho_tipo: null,`:

```ts
  titulo_pagina: null, peso_kg: null, comprimento_cm: null, largura_cm: null, altura_cm: null, ncm: null, preco_anterior: null,
```

`draftFromModeloRow`, depois da linha do `tamanho_tipo`:

```ts
    titulo_pagina: data.titulo_pagina ?? null,
    peso_kg: data.peso_kg ?? null,
    comprimento_cm: data.comprimento_cm ?? null,
    largura_cm: data.largura_cm ?? null,
    altura_cm: data.altura_cm ?? null,
    ncm: data.ncm ?? null,
    preco_anterior: data.preco_anterior ?? null,
```

- [ ] **Step 4: `helpers.ts`**

1. `ROTULO_CONFLITO_PLAN`, depois de `tamanho_tipo: "Tamanho em",`:

```ts
  // F3.6 (Parte B) — seção 1 e Preço e Custos.
  titulo_pagina: "Título para a página", peso_kg: "Peso (kg)", comprimento_cm: "Comprimento (cm)", largura_cm: "Largura (cm)",
  altura_cm: "Altura (cm)", ncm: "NCM do Produto", preco_anterior: "Preço anterior",
```

2. Depois de `textoOuNull`:

```ts
// ── F3.6 (Parte B — spec 2026-09-25 §5.2) — campos novos do Planejamento no payload / Duplicar / eco do Salvar ─────────
/** NCM do Produto (ruling 3): só dígitos e pontos, até 10 caracteres — sem tabela oficial nem sugestão (validação no cliente). */
export function filtrarNcm(s: string | null | undefined): string {
  return (s ?? "").replace(/[^0-9.]/g, "").slice(0, 10);
}
/** Número do Draft → coluna: vazio/null/inválido ⇒ NULL; senão arredondado às `casas` da coluna. 0 VALE (CHECK >= 0). */
export function numeroOuNull(v: unknown, casas: number): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const f = 10 ** casas;
  return Math.round(n * f) / f;
}
/** O valor canônico que o MoneyInput emite ("" = vazio) → Draft. */
export function numeroDoInput(v: string): number | null {
  const n = Number(v);
  return v === "" || !Number.isFinite(n) ? null : n;
}
/** Preço anterior (ruling 11): mesmo padrão do preço de venda — vazio/0 = NULL = automático (não "preço zero"). */
export function precoAnteriorOuNull(v: unknown): number | null {
  const n = numeroOuNull(v, 2);
  return n !== null && n > 0 ? n : null;
}
/** O que a linha "Preço anterior" mostra: o fixado à mão; senão o preço EFETIVO (o digitado ou o sugerido); 0 ⇒ vazio. */
export function precoAnteriorExibido(fixado: number | null | undefined, efetivo: number): number | null {
  if (fixado !== null && fixado !== undefined) return fixado;
  return efetivo > 0 ? efetivo : null;
}
/** Os 6 campos novos que vão em TODO payload (o Preço anterior tem regra de permissão própria — no save). Título aparado. */
export function camposNovosParaPayload(
  d: Pick<Draft, "titulo_pagina" | "ncm" | "peso_kg" | "comprimento_cm" | "largura_cm" | "altura_cm">,
) {
  return {
    titulo_pagina: textoOuNull((d.titulo_pagina ?? "").trim()),
    ncm: textoOuNull(filtrarNcm(d.ncm)),
    peso_kg: numeroOuNull(d.peso_kg, 3),
    comprimento_cm: numeroOuNull(d.comprimento_cm, 2),
    largura_cm: numeroOuNull(d.largura_cm, 2),
    altura_cm: numeroOuNull(d.altura_cm, 2),
  };
}
```

3. `camposParaDuplicar` inteira passa a ser:

```ts
/**
 * Duplicar (decisão F3 #9): a nova versão herda o de HOJE — Planejamento + tecidos (só o artigo) + Obs. Gerais —
 * e o resto do Desenvolvimento nasce vazio. Tira REF (a nova versão gera a própria), versão e base (o chamador
 * recalcula) e os campos do Dev. A Descrição do produto VAI (é do Planejamento).
 * F3.6 (ruling 5, decisão do dono 25/set): Título e Preço anterior voltam ao AUTOMÁTICO (ficam FORA, como ref/versão/base);
 * NCM e Peso/medidas VÃO (mesmo tipo de produto), já normalizados como no Salvar.
 */
export function camposParaDuplicar(draft: Draft): Record<string, unknown> {
  const { versao: _v, modelo_base_id: _b, ref: _r, titulo_pagina: _t, preco_anterior: _pa, ...rest } = draft;
  const out: Record<string, unknown> = { ...rest };
  for (const k of CAMPOS_DEV_DRAFT) if (k !== "observacoes_gerais") delete out[k];
  out.descricao_produto = textoOuNull(draft.descricao_produto);
  const { titulo_pagina: _tn, ...novos } = camposNovosParaPayload(draft);
  Object.assign(out, novos);
  return out;
}
```

4. `normalizarDraftSalvo` passa a ser:

```ts
export function normalizarDraftSalvo(d: Draft): Draft {
  return {
    ...d,
    ref: (d.ref ?? "").trim(),
    descricao_produto: textoOuNull(d.descricao_produto) ?? "",
    // F3.6 — os 7 campos novos com as MESMAS regras do payload (senão o eco do próprio Salvar vira "alguém salvou agora").
    ...camposNovosParaPayload(d),
    preco_anterior: precoAnteriorOuNull(d.preco_anterior),
  };
}
```

(e no JSDoc dela, acrescentar: `F3.6: + Título/NCM/Peso/medidas/Preço anterior (camposNovosParaPayload/precoAnteriorOuNull).`)

- [ ] **Step 5: `usePlanejamentoSave.ts`**

1. Import (`:18`): acrescentar `camposNovosParaPayload, precoAnteriorOuNull` à lista de `…/planejamento-detail/helpers`.
2. Logo DEPOIS de `}, d, { podeEditarDev, refEditavel });` (fim do `aplicarRegrasCamposDev`, `:228`):

```ts
      // F3.6 (Parte B) — Título/NCM/Peso/medidas: campos do Planejamento (fora de CAMPOS_DEV_DRAFT), com as MESMAS regras do
      // `normalizarDraftSalvo` (base do merge). O Preço anterior tem regra de permissão própria, junto do preço (abaixo).
      Object.assign(payload, camposNovosParaPayload(d));
```

3. Logo DEPOIS do `}` que fecha o `if (isRevenda) { … } else { … }` do preço (`:303`):

```ts
      // F3.6 (Parte B, ruling 11 / R9) — Preço anterior: a MESMA permissão do preço de venda
      // (`criacao_planejamento:preco_venda`), nos DOIS ramos (manufaturado/importado E revenda — na revenda ele acompanha o
      // VAREJO); sem ela, não reenvia o valor herdado do `...d`. Trava só no cliente (Dúvida D1).
      if (podeEditarPreco) payload.preco_anterior = precoAnteriorOuNull(d.preco_anterior);
      else delete payload.preco_anterior;
```

- [ ] **Step 6: Rodar e ver passar**

Run: `env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit/planejamento-draft.test.ts tests/unit/planejamento-detail-helpers.test.ts tests/unit/planejamento-save-ficha.test.ts`
Expected: PASS (o `planejamento-save-ficha.test.ts` segue verde — nada mudou nas colunas do Dev).

- [ ] **Step 7: Gates e commit**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/sheet-reorg"
bash .superpowers/sheet/gates.sh
grep -n "camposNovosParaPayload(d)\|payload.preco_anterior" src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts
git add -- src/components/planejamento/modelo-shared.ts src/components/planejamento/planejamento-detail/helpers.ts src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts tests/unit/planejamento-draft.test.ts tests/unit/planejamento-detail-helpers.test.ts
git commit --only -m "feat(sheet-reorg): Draft/payload/Duplicar dos 7 campos novos (Título, Peso/medidas, NCM, Preço anterior) (T5)" \
  -m "Salvar normaliza como o eco do merge; Preço anterior só com criacao_planejamento:preco_venda; Duplicar leva NCM/medidas e volta Título/Preço anterior ao automático. SÓ juntar depois da migration 20261005100000 em produção. Plano 2026-09-25, Task 5." \
  -m "Co-Authored-By: Claude <seu modelo real> <noreply@anthropic.com>" \
  -- src/components/planejamento/modelo-shared.ts src/components/planejamento/planejamento-detail/helpers.ts src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts tests/unit/planejamento-draft.test.ts tests/unit/planejamento-detail-helpers.test.ts
git show --stat HEAD
```

**Revisão do Lote B1 (Opus, depois deste commit):** Tasks 4+5 — espelho TS × regra da spec (ruling 1, nome vazio); payload = eco (`normalizarDraftSalvo` ≡ regras do payload, senão conflito falso); Duplicar sem Título/Preço anterior; Preço anterior só com a permissão nos 2 ramos; nenhuma chave nova em `CAMPOS_DEV_DRAFT`; os 7 campos vão em TODO payload (ordem de produção).

---
## Task 6: Migration + inverso GERADOS do texto vivo + suíte de integração  *(G-migration: 2 Opus independentes + guardião)*

**Files:**
- Create (não versionado): `.superpowers/sheet/mig/dump_antes.sh`, `.superpowers/sheet/mig/gerar_sql.py`
- Create (gerados): `supabase/migrations/20261005100000_modelo_titulo_peso_ncm_preco_anterior.sql`, `supabase/rollback/20261005100000_modelo_titulo_peso_ncm_preco_anterior_down.sql`
- Test: `tests/integration/sheet-reorg-campos.test.ts`

**Interfaces:**
- Consumes: `tests/integration/db.ts` (`hasDb`, `dbUrl`, `withTx`, `comoUsuario`, `um`, `TENANT_TESTE`, `ehBancoLocal`) e `tests/integration/mig-txn.ts` (`aplicarSql`, `exigeBancoLocal`) — NÃO modificar; `CASOS_TITULO` + `TITULO_*`/`tituloPaginaCalculado` (Task 4); `draftFromModeloRow` + `camposParaDuplicar` (Task 5).
- Produces (Task 7 e 10): as 2 funções (`public._titulo_pagina_calculado(text,text)` nova; `public._replicar_cards_plan_tecido_core(uuid,uuid,uuid,uuid[],integer)` redefinida), 7 colunas, 4 CHECKs `modelos_{peso_kg,comprimento_cm,largura_cm,altura_cm}_nao_negativo`; `.superpowers/sheet/mig/md5-replicar-antes.txt`, `md5-replicar-depois.txt`, `md5-titulo-depois.txt`; variáveis da suíte `SHEET_MIG_TXN=1`.

- [ ] **Step 1: Dump SÓ LEITURA do texto vivo — `.superpowers/sheet/mig/dump_antes.sh`**

```bash
#!/usr/bin/env bash
# Task 6 Step 1 — lê (SÓ LEITURA) o texto VIVO de _replicar_cards_plan_tecido_core na CÓPIA LOCAL (nunca produção) e o md5
# dele. O gerador (gerar_sql.py) monta a migration e o inverso A PARTIR DESTE TEXTO (o plano não crava md5 — R20).
set -euo pipefail
TOP="$(git rev-parse --show-toplevel)"
case "$TOP" in */.claude/worktrees/sheet-reorg) ;; *) echo "PARE: rode de dentro da worktree sheet-reorg"; exit 1;; esac
cd "$TOP"
LOCAL="postgresql://postgres:postgres@127.0.0.1:54422/postgres"
M=.superpowers/sheet/mig
FN='public._replicar_cards_plan_tecido_core(uuid,uuid,uuid,uuid[],integer)'
mkdir -p "$M/antes"
echo "== dump SÓ LEITURA · alvo: 127.0.0.1:54422 (cópia local) · HEAD $(git rev-parse --short HEAD)"
q() { PGOPTIONS='-c default_transaction_read_only=on' psql "$LOCAL" -X -A -t -v ON_ERROR_STOP=1 -c "$1"; }
[ "$(q "select to_regprocedure('public._titulo_pagina_calculado(text,text)') is null")" = t ] \
  || { echo "PARE: _titulo_pagina_calculado JÁ existe na cópia — alguém aplicou esta migration?"; exit 1; }
[ "$(q "select count(*) from information_schema.columns where table_schema='public' and table_name='modelos' and column_name in ('titulo_pagina','peso_kg','comprimento_cm','largura_cm','altura_cm','ncm','preco_anterior')")" = 0 ] \
  || { echo "PARE: colunas desta frente JÁ existem na cópia"; exit 1; }
PGOPTIONS='-c default_transaction_read_only=on' psql "$LOCAL" -X -A -t -v ON_ERROR_STOP=1 \
  -c "select pg_get_functiondef('$FN'::regprocedure)" -o "$M/antes/replicar.sql"
q "select md5(pg_get_functiondef('$FN'::regprocedure))" > "$M/md5-replicar-antes.txt"
echo "md5 VIVO de _replicar (cópia): $(cat "$M/md5-replicar-antes.txt") · $(wc -l < "$M/antes/replicar.sql" | tr -d ' ') linhas"
```

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/sheet-reorg"
chmod +x .superpowers/sheet/mig/dump_antes.sh && bash .superpowers/sheet/mig/dump_antes.sh
```

Expected: `md5 VIVO de _replicar (cópia): <32 hex> · ~180 linhas`. Esse md5 TEM de ser o de produção (a cópia = produção nesta função; nenhuma frente a redefiniu depois da F3.1) — o pré-voo de produção (Task 7) confere de novo contra o banco real, no dia.

- [ ] **Step 2: Escrever a suíte (falha — os arquivos ainda não existem)** — `tests/integration/sheet-reorg-campos.test.ts`:

```ts
/**
 * F3.6 (Parte B) — reorganização do Sheet: 7 colunas novas em `modelos`, `_titulo_pagina_calculado` e o "Replicar card(s)"
 * levando os 7 campos. Migration supabase/migrations/20261005100000_modelo_titulo_peso_ncm_preco_anterior.sql e inverso em
 * supabase/rollback/ — GERADOS por .superpowers/sheet/mig/gerar_sql.py a partir do texto VIVO (não editar à mão).
 * Plano: docs/superpowers/plans/2026-09-25-sheet-planejamento-reorganizacao.md (Task 6).
 *
 * ⚠️ SÓ NA CÓPIA LOCAL (DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres). Fora dela os blocos de banco
 * PULAM; com SHEET_MIG_TXN=1 fora da cópia a suíte RECUSA já na coleta. NUNCA `\i` (o COMMIT do arquivo vazaria — 15/set).
 * Dois modos:
 *  • SHEET_MIG_TXN=1 — a cópia SEM a migration; cada teste aplica o arquivo DENTRO da txn (mig-txn.ts: tira BEGIN/COMMIT;
 *    as 2 travas SET LOCAL do arquivo saem antes — o transaction_timeout de 3 s derrubaria a txn do teste). Segura ACCESS
 *    EXCLUSIVE em `modelos` durante o teste: o app de teste :5188 congela (N3 — dono avisado ANTES).
 *  • sem a variável — a migration JÁ aplicada na cópia (ensaio da Task 7 / Task 10); os testes do "antes" pulam.
 * O bloco "estático" (só os arquivos) roda sempre.
 */
import { describe, it, expect } from "vitest";
import { Client } from "pg";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { hasDb, dbUrl, withTx, comoUsuario, um, TENANT_TESTE, ehBancoLocal } from "./db";
import { aplicarSql, exigeBancoLocal } from "./mig-txn";
import { CASOS_TITULO } from "../fixtures/titulo-pagina-casos";
import { TITULO_CONECTIVOS, TITULO_MAIUSC, TITULO_MINUSC, tituloPaginaCalculado } from "../../src/lib/titulo-pagina";
import { draftFromModeloRow } from "../../src/components/planejamento/modelo-shared";
import { camposParaDuplicar } from "../../src/components/planejamento/planejamento-detail/helpers";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MIG = "supabase/migrations/20261005100000_modelo_titulo_peso_ncm_preco_anterior.sql";
const INV = "supabase/rollback/20261005100000_modelo_titulo_peso_ncm_preco_anterior_down.sql";
const FN = "public._replicar_cards_plan_tecido_core(uuid,uuid,uuid,uuid[],integer)";
const FN_TITULO = "public._titulo_pagina_calculado(text,text)";
const COL_ANTES = "      versao, modelo_base_id, mix_id, ref, ref_auto, descricao_produto\n";
const COL_DEPOIS =
  "      versao, modelo_base_id, mix_id, ref, ref_auto, descricao_produto, peso_kg, comprimento_cm, largura_cm, altura_cm, titulo_pagina, ncm, preco_anterior\n";
const VAL_ANTES = "      v_versao, v_root, o.mix_id, o.ref, o.ref_auto, o.descricao_produto\n";
const VAL_DEPOIS =
  "      v_versao, v_root, o.mix_id, o.ref, o.ref_auto, o.descricao_produto, o.peso_kg, o.comprimento_cm, o.largura_cm, o.altura_cm, o.titulo_pagina, o.ncm, o.preco_anterior\n";
const COLUNAS = ["titulo_pagina", "peso_kg", "comprimento_cm", "largura_cm", "altura_cm", "ncm", "preco_anterior"];
const CHECKS = ["modelos_altura_cm_nao_negativo", "modelos_comprimento_cm_nao_negativo", "modelos_largura_cm_nao_negativo", "modelos_peso_kg_nao_negativo"];
const LOCAL = ehBancoLocal();
const MIG_TXN = process.env.SHEET_MIG_TXN === "1";
if (MIG_TXN && hasDb) exigeBancoLocal(); // recusa na COLETA, antes de qualquer conexão

const ler = (rel: string) => readFileSync(ROOT + rel, "utf8");
const md5 = (s: string) => createHash("md5").update(s, "utf8").digest("hex");
/** As 2 travas do arquivo (logo depois do BEGIN) saem da txn do teste — ver o cabeçalho. */
const RE_TRAVAS = /^SET LOCAL (lock_timeout|transaction_timeout) = '[^']*';$/gm;
function semTravas(sql: string, nome: string): string {
  const n = (sql.match(RE_TRAVAS) ?? []).length;
  if (n !== 2) throw new Error(`${nome}: esperado as 2 travas SET LOCAL (lock_timeout + transaction_timeout); achei ${n}`);
  return sql.replace(RE_TRAVAS, "-- [teste] trava do arquivo removida (a txn do teste tem as suas)");
}
const aplica = (c: Client, rel: string) => aplicarSql(c, semTravas(ler(rel), rel), rel);

function corpo(rel: string, inicio: string, fim: string): string {
  const t = ler(rel);
  const i = t.indexOf(inicio);
  const f = t.indexOf(fim, i);
  if (i < 0 || f < 0) throw new Error(`${rel}: corpo não achado (${inicio.slice(0, 50)}…)`);
  return t.slice(i, f + fim.length);
}
/** O texto de pg_get_functiondef = o corpo do arquivo + "\n" (o arquivo é GERADO no formato canônico). */
const corpoReplicar = (rel: string) => corpo(rel, "CREATE OR REPLACE FUNCTION public._replicar_cards_plan_tecido_core(", "end $function$");
const corpoTitulo = (rel: string) => corpo(rel, "CREATE OR REPLACE FUNCTION public._titulo_pagina_calculado(", "\n$function$");
function guarda(rel: string): { antes: string; depois: string; titulo: string | null } {
  const t = ler(rel);
  const r = /v_md5 NOT IN \('([0-9a-f]{32})', '([0-9a-f]{32})'\)/.exec(t);
  if (!r) throw new Error(`${rel}: guarda de md5 de _replicar não achada`);
  const ti = /v_md5 <> '([0-9a-f]{32})'/.exec(t);
  return { antes: r[1], depois: r[2], titulo: ti ? ti[1] : null };
}

describe("F3.6 — arquivos da migration (estático, sem banco)", () => {
  it("_replicar: migration = inverso (texto vivo) com SÓ as 2 linhas do INSERT trocadas; âncoras 1× cada", () => {
    const antes = corpoReplicar(INV);
    expect(antes.split(COL_ANTES).length - 1).toBe(1);
    expect(antes.split(VAL_ANTES).length - 1).toBe(1);
    expect(corpoReplicar(MIG)).toBe(antes.replace(COL_ANTES, COL_DEPOIS).replace(VAL_ANTES, VAL_DEPOIS));
  });
  it("guarda de md5 EXATA nos 2 arquivos = md5 dos textos (antes = inverso, depois = migration); título = o da migration", () => {
    for (const f of [MIG, INV]) {
      const g = guarda(f);
      expect(g.antes, f).toBe(md5(corpoReplicar(INV) + "\n"));
      expect(g.depois, f).toBe(md5(corpoReplicar(MIG) + "\n"));
    }
    expect(guarda(MIG).titulo).toBe(md5(corpoTitulo(MIG) + "\n"));
  });
  it("travas: 1 BEGIN/1 COMMIT e as 2 linhas SET LOCAL logo depois do BEGIN nos 2; NENHUMA DDL de policy", () => {
    for (const f of [MIG, INV]) {
      const t = ler(f);
      const linhas = t.split("\n");
      const i = linhas.findIndex((l) => l === "BEGIN;");
      expect(i, f).toBeGreaterThanOrEqual(0);
      expect(linhas.slice(i + 1, i + 3), f).toEqual(["SET LOCAL lock_timeout = '500ms';", "SET LOCAL transaction_timeout = '3s';"]);
      expect(linhas.filter((l) => l === "BEGIN;"), f).toHaveLength(1);
      expect(linhas.filter((l) => l === "COMMIT;"), f).toHaveLength(1);
      expect(t, f).not.toMatch(/^[ \t]*(CREATE|DROP|ALTER)[ \t]+POLICY\b/im);
    }
  });
  it("ordem da migration: guarda → título → _replicar → ACL → ALTER POR ÚLTIMO (depois só os 7 COMMENT e o COMMIT)", () => {
    const m = ler(MIG);
    const iGuarda = m.indexOf("DO $guarda$");
    const iTit = m.indexOf("CREATE OR REPLACE FUNCTION public._titulo_pagina_calculado(");
    const iRep = m.indexOf("CREATE OR REPLACE FUNCTION public._replicar_cards_plan_tecido_core(");
    const iAcl = m.indexOf("DO $acl$");
    const iAlter = m.indexOf("ALTER TABLE public.modelos");
    expect(iGuarda).toBeGreaterThan(m.indexOf("SET LOCAL transaction_timeout"));
    expect(iTit).toBeGreaterThan(iGuarda);
    expect(iRep).toBeGreaterThan(iTit);
    expect(iAcl).toBeGreaterThan(iRep);
    expect(iAlter).toBeGreaterThan(iAcl);
    const depois = m.slice(iAlter).replace(/--[^\n]*/g, "");
    expect(depois.match(/;/g)).toHaveLength(9); // ALTER; 7× COMMENT; COMMIT; — nada mais segura a trava de `modelos`
    expect(depois.trim().endsWith("COMMIT;")).toBe(true);
    for (const col of COLUNAS) expect(m).toContain(`ADD COLUMN IF NOT EXISTS ${col} `);
    for (const ck of CHECKS) expect(m).toContain(`CONSTRAINT ${ck} CHECK`);
    expect(m).not.toMatch(/DROP\s+COLUMN/i);
    expect(m).toContain("REVOKE EXECUTE ON FUNCTION public._titulo_pagina_calculado(text, text) FROM PUBLIC, anon, authenticated;");
    expect(m).toContain("REVOKE EXECUTE ON FUNCTION public._replicar_cards_plan_tecido_core(uuid, uuid, uuid, uuid[], integer) FROM PUBLIC, anon, authenticated;");
  });
  it("ordem do inverso: guarda (md5 + confirmação) → _replicar de antes → ACL → DROP da função → DROP COLUMN POR ÚLTIMO", () => {
    const v = ler(INV);
    const iGuarda = v.indexOf("DO $guarda$");
    const iRep = v.indexOf("CREATE OR REPLACE FUNCTION public._replicar_cards_plan_tecido_core(");
    const iAcl = v.indexOf("DO $acl$");
    const iDropFn = v.indexOf("DROP FUNCTION IF EXISTS public._titulo_pagina_calculado(text, text);");
    const iDropCol = v.indexOf("ALTER TABLE public.modelos");
    expect(iRep).toBeGreaterThan(iGuarda);
    expect(iAcl).toBeGreaterThan(iRep);
    expect(iDropFn).toBeGreaterThan(iAcl);
    expect(iDropCol).toBeGreaterThan(iDropFn);
    expect(v.slice(iDropCol).replace(/--[^\n]*/g, "").match(/;/g)).toHaveLength(2); // ALTER … DROP COLUMN ×7; COMMIT;
    for (const col of COLUNAS) expect(v).toContain(`DROP COLUMN IF EXISTS ${col}`);
    expect(v).toContain("app.confirmo_apagar_campos_sheet");
    expect(v).toContain("DROP COLUMN apaga");
  });
  it("espelho TS × SQL: as listas fixas e os conectivos do TS estão literalmente no SQL do título", () => {
    const t = corpoTitulo(MIG);
    expect(t).toContain(`'${TITULO_MAIUSC}'`);
    expect(t).toContain(`'${TITULO_MINUSC}'`);
    expect(t).toContain(`IN (${TITULO_CONECTIVOS.map((c) => `'${c}'`).join(", ")})`);
  });
});

async function jaAplicada(): Promise<boolean> {
  if (!hasDb || !LOCAL || MIG_TXN) return false; // fora da cópia: nem conecta
  const c = new Client({ connectionString: dbUrl()!, ssl: false });
  await c.connect();
  try {
    return (await c.query(`select to_regprocedure('${FN_TITULO}') is not null as ok`)).rows[0]?.ok === true;
  } finally {
    await c.end();
  }
}
const PRONTO = hasDb && LOCAL && (MIG_TXN || (await jaAplicada()));

async function timeouts(c: Client, lock = "3s"): Promise<void> {
  exigeBancoLocal();
  await c.query(`SET LOCAL lock_timeout = '${lock}'`);
  await c.query("SET LOCAL statement_timeout = '60s'");
}
async function prepara(c: Client): Promise<void> {
  await timeouts(c);
  if (MIG_TXN) await aplica(c, MIG);
}
const def = async (c: Client, fn = FN) =>
  (await um<{ d: string | null }>(c, "select pg_get_functiondef(to_regprocedure($1)) d", [fn])).d;
const acl = async (c: Client) =>
  (await um<{ a: string | null }>(c, "select proacl::text a from pg_proc where oid = to_regprocedure($1)", [FN])).a;
const privs = (c: Client, fn: string) =>
  um<{ anon: boolean; auth: boolean; srv: boolean }>(c,
    `select has_function_privilege('anon', $1, 'EXECUTE') anon, has_function_privilege('authenticated', $1, 'EXECUTE') auth,
            has_function_privilege('service_role', $1, 'EXECUTE') srv`, [fn]);
async function colunas(c: Client) {
  const { rows } = await c.query(
    `select a.attname nome, format_type(a.atttypid, a.atttypmod) tipo, a.attnotnull nn, pg_get_expr(d.adbin, d.adrelid) def
       from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
      where a.attrelid = 'public.modelos'::regclass and a.attname = any($1) and not a.attisdropped
      order by a.attname`, [COLUNAS]);
  return rows as { nome: string; tipo: string; nn: boolean; def: string | null }[];
}
const contagens = async (c: Client) => (await um<{ v: string }>(c,
  `select (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public') || '|' ||
          (select count(*) from pg_trigger t join pg_class k on k.oid = t.tgrelid join pg_namespace n on n.oid = k.relnamespace
            where n.nspname = 'public' and not t.tgisinternal) v`)).v;
/** Roda e ESPERA erro; volta ao savepoint (a txn segue usável). */
async function falha(c: Client, sql: string): Promise<{ code: string; message: string }> {
  await c.query("SAVEPOINT sheet_falha");
  try {
    await c.query(sql);
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT sheet_falha");
    const err = e as { code?: string; message?: string };
    return { code: String(err.code ?? ""), message: String(err.message ?? "") };
  }
  await c.query("RELEASE SAVEPOINT sheet_falha");
  throw new Error(`esperava erro e passou: ${sql}`);
}

describe.skipIf(!PRONTO)("F3.6 — banco (cópia local, txn revertida)", () => {
  it("anti-drift do título: SQL ≡ TS em TODAS as fixtures", async () => {
    await withTx(async (c) => {
      await prepara(c);
      for (const k of CASOS_TITULO) {
        const r = await um<{ t: string }>(c, "select public._titulo_pagina_calculado($1, $2) t", [k.nome, k.loja]);
        expect(r.t, JSON.stringify(k)).toBe(k.esperado);
        expect(tituloPaginaCalculado(k.nome, k.loja)).toBe(r.t);
      }
    });
  });

  it("colunas: tipos da spec, nullable, sem default; os 4 CHECKs nomeados (>= 0)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      expect(await colunas(c)).toEqual([
        { nome: "altura_cm", tipo: "numeric(10,2)", nn: false, def: null },
        { nome: "comprimento_cm", tipo: "numeric(10,2)", nn: false, def: null },
        { nome: "largura_cm", tipo: "numeric(10,2)", nn: false, def: null },
        { nome: "ncm", tipo: "text", nn: false, def: null },
        { nome: "peso_kg", tipo: "numeric(10,3)", nn: false, def: null },
        { nome: "preco_anterior", tipo: "numeric(12,2)", nn: false, def: null },
        { nome: "titulo_pagina", tipo: "text", nn: false, def: null },
      ]);
      const { rows } = await c.query(
        `select conname, pg_get_constraintdef(oid) d from pg_constraint
          where conrelid = 'public.modelos'::regclass and conname = any($1) order by conname`, [CHECKS]);
      expect(rows.map((r) => r.conname)).toEqual(CHECKS);
      for (const r of rows) expect(r.d, r.conname).toMatch(/^CHECK \(.*>= .*0.*\)$/);
    });
  });

  it("CHECK: negativo recusado (23514) nos 4 de peso/medidas; zero aceito; ncm e preco_anterior SEM CHECK (R8)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await comoUsuario(c);
      for (const col of ["peso_kg", "comprimento_cm", "largura_cm", "altura_cm"]) {
        const e = await falha(c, `insert into modelos (nome, ${col}) values ('ITEST-SHEET-NEG', -1)`);
        expect(e.code, col).toBe("23514");
      }
      await c.query(`insert into modelos (nome, peso_kg, comprimento_cm, largura_cm, altura_cm, ncm, preco_anterior)
                     values ('ITEST-SHEET-ZERO', 0, 0, 0, 0, 'abc', -5)`);
    });
  });

  it("_titulo_pagina_calculado: texto = o do arquivo (md5 da guarda); IMMUTABLE; EXECUTE fechado p/ anon/authenticated, aberto p/ service_role", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const d = (await def(c, FN_TITULO))!;
      expect(d, `texto canônico do PG (o gerador tem de emitir IGUAL):\n${d}`).toBe(corpoTitulo(MIG) + "\n");
      expect(md5(d)).toBe(guarda(MIG).titulo);
      expect((await um<{ v: string }>(c, "select provolatile v from pg_proc where oid = to_regprocedure($1)", [FN_TITULO])).v).toBe("i");
      expect(await privs(c, FN_TITULO)).toEqual({ anon: false, auth: false, srv: true });
    });
  });

  it("_replicar: texto = o do arquivo (md5 'depois' da guarda); EXECUTE fechado p/ anon/authenticated (#9)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const d = (await def(c))!;
      expect(d).toBe(corpoReplicar(MIG) + "\n");
      expect(md5(d)).toBe(guarda(MIG).depois);
      const p = await privs(c, FN);
      expect(p.anon).toBe(false);
      expect(p.auth).toBe(false);
    });
  });

  it("Replicar card(s) leva os 7 campos como estão (manual E automático/NULL — ruling 5)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await comoUsuario(c);
      await c.query(
        `insert into tenant_config (tenant_id, modules) values ($1, '{"criacao":true,"otb":true}'::jsonb)
         on conflict (tenant_id) do update set modules = tenant_config.modules || '{"criacao":true,"otb":true}'::jsonb`,
        [TENANT_TESTE],
      );
      const col = await um<{ id: string }>(c, `insert into colecoes (nome, status) values ('ITEST-SHEET-REP','rascunho') returning id`);
      const com = await um<{ id: string }>(c,
        `insert into modelos (nome, titulo_pagina, peso_kg, comprimento_cm, largura_cm, altura_cm, ncm, preco_anterior)
         values ('ITEST-SHEET-COM', 'Título à mão (ITEST)', 0.35, 60, 40, 2.5, '6204.43.00', 199.9) returning id`);
      const sem = await um<{ id: string }>(c, `insert into modelos (nome) values ('ITEST-SHEET-SEM') returning id`);
      const r = await um<{ out: { origem_modelo_id: string; novo_modelo_id: string }[] }>(c,
        `select public.replicar_cards_plan_tecido($1::uuid, null::uuid, array[$2::uuid, $3::uuid], null::integer) out`,
        [col.id, com.id, sem.id]);
      const novo = (orig: string) => r.out.find((x) => x.origem_modelo_id === orig)!.novo_modelo_id;
      const q = `select titulo_pagina, peso_kg::text peso, comprimento_cm::text comp, largura_cm::text larg, altura_cm::text alt,
                        ncm, preco_anterior::text pa from modelos where id = $1`;
      expect(await um(c, q, [novo(com.id)])).toEqual({
        titulo_pagina: "Título à mão (ITEST)", peso: "0.350", comp: "60.00", larg: "40.00", alt: "2.50", ncm: "6204.43.00", pa: "199.90",
      });
      expect(await um(c, q, [novo(sem.id)])).toEqual({ titulo_pagina: null, peso: null, comp: null, larg: null, alt: null, ncm: null, pa: null });
    });
  });

  it("Duplicar (payload de camposParaDuplicar, como o app): toda chave é coluna; Título e Preço anterior voltam a NULL; NCM/peso/medidas/descrição vão", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await comoUsuario(c);
      const orig = await um<{ id: string }>(c,
        `insert into modelos (nome, titulo_pagina, peso_kg, comprimento_cm, largura_cm, altura_cm, ncm, preco_anterior, descricao_produto)
         values ('ITEST-SHEET-DUP', 'Título à mão', 0.35, 60, 40, 2.5, '6204.43.00', 199.9, 'Descrição ITEST') returning id`);
      const row = await um<Record<string, unknown>>(c, "select * from modelos where id = $1", [orig.id]);
      // O MESMO objeto que o Duplicar do Sheet manda no INSERT (PlanejamentoDetail.tsx, mutation `duplicate`).
      const payload: Record<string, unknown> = {
        ...camposParaDuplicar(draftFromModeloRow(row)),
        status_planejamento: "em_planejamento", data_lancamento: null, versao: 2, modelo_base_id: orig.id,
      };
      const cols = (await c.query(
        "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'modelos'",
      )).rows.map((r) => r.column_name as string);
      expect(Object.keys(payload).filter((k) => !cols.includes(k))).toEqual([]); // senão PGRST204 no app
      expect(payload).not.toHaveProperty("titulo_pagina");
      expect(payload).not.toHaveProperty("preco_anterior");
      const lista = Object.keys(payload).map((k) => `"${k}"`).join(", ");
      const novo = await um<{ id: string }>(c,
        `insert into public.modelos (${lista}) select ${lista} from jsonb_populate_record(null::public.modelos, $1::jsonb) returning id`,
        [JSON.stringify(payload)]);
      expect(await um(c,
        `select titulo_pagina, preco_anterior, ncm, peso_kg::text peso, comprimento_cm::text comp, largura_cm::text larg,
                altura_cm::text alt, descricao_produto from modelos where id = $1`, [novo.id],
      )).toEqual({
        titulo_pagina: null, preco_anterior: null, ncm: "6204.43.00", peso: "0.350", comp: "60.00", larg: "40.00", alt: "2.50",
        descricao_produto: "Descrição ITEST",
      });
    });
  });

  it.skipIf(!MIG_TXN)("antes/depois: inverso = texto VIVO; +1 função, +0 gatilhos; _replicar = antes com SÓ as 2 linhas; ACL igual", async () => {
    await withTx(async (c) => {
      await timeouts(c);
      const antes = (await def(c))!;
      const aclAntes = await acl(c);
      const [f, g] = (await contagens(c)).split("|").map(Number);
      expect(antes).toBe(corpoReplicar(INV) + "\n"); // o inverso restaura o texto VIVO da cópia, byte a byte
      expect(md5(antes)).toBe(guarda(MIG).antes);
      expect(await colunas(c)).toEqual([]);
      await aplica(c, MIG);
      expect(await contagens(c)).toBe(`${f + 1}|${g}`);
      expect(await def(c)).toBe(antes.replace(COL_ANTES, COL_DEPOIS).replace(VAL_ANTES, VAL_DEPOIS));
      expect(await acl(c)).toBe(aclAntes);
    });
  });

  it.skipIf(!MIG_TXN)("idempotente: 2× na mesma txn dá o mesmo estado (a guarda aceita o texto desta migration)", async () => {
    await withTx(async (c) => {
      await timeouts(c);
      await aplica(c, MIG);
      const d1 = await def(c);
      const t1 = await def(c, FN_TITULO);
      const c1 = await colunas(c);
      const n1 = await contagens(c);
      await aplica(c, MIG);
      expect(await def(c)).toBe(d1);
      expect(await def(c, FN_TITULO)).toBe(t1);
      expect(await colunas(c)).toEqual(c1);
      expect(await contagens(c)).toBe(n1);
    });
  });

  it.skipIf(!MIG_TXN)("guarda: _replicar com OUTRO texto (outra frente) ⇒ a migration RECUSA e nada fica", async () => {
    await withTx(async (c) => {
      await timeouts(c);
      const antes = (await def(c))!;
      const mexida = antes.replace("-- (0) Guardas de tenant/destino.", "-- (0) Guardas de tenant/destino (outra frente).");
      expect(mexida).not.toBe(antes);
      await c.query(mexida); // DDL na txn do TESTE, só na cópia (timeouts → exigeBancoLocal)
      await expect(aplica(c, MIG)).rejects.toThrow(/outra frente mudou/);
      expect(await colunas(c)).toEqual([]);
      expect(await def(c, FN_TITULO)).toBeNull();
    });
  });

  it.skipIf(!MIG_TXN)("trava: com `modelos` ocupada por outra conexão, desiste em 55P03 (lock_timeout 500ms) e NADA fica", async () => {
    exigeBancoLocal();
    const outra = new Client({ connectionString: dbUrl()!, ssl: false });
    await outra.connect();
    try {
      await outra.query("BEGIN");
      await outra.query("SELECT 1 FROM public.modelos LIMIT 1");
      await withTx(async (c) => {
        await timeouts(c, "500ms");
        const antes = await def(c);
        const t0 = Date.now();
        let codigo: string | undefined;
        try {
          await aplica(c, MIG);
        } catch (e) {
          codigo = (e as { code?: string }).code;
        }
        expect(codigo).toBe("55P03");
        expect(Date.now() - t0).toBeLessThan(3000);
        expect(await colunas(c)).toEqual([]);
        expect(await def(c)).toBe(antes);
        expect(await def(c, FN_TITULO)).toBeNull();
      });
    } finally {
      await outra.query("ROLLBACK").catch(() => undefined);
      await outra.end();
    }
  });

  it.skipIf(!MIG_TXN)("inverso: com dado e SEM confirmação ⇒ recusa (nada muda); com 'sim' ⇒ _replicar byte a byte, sem a função e sem as colunas", async () => {
    await withTx(async (c) => {
      await timeouts(c);
      const antes = await def(c);
      const aclAntes = await acl(c);
      const contAntes = await contagens(c);
      await aplica(c, MIG);
      await comoUsuario(c);
      await c.query(`insert into modelos (nome, ncm) values ('ITEST-SHEET-INV', '6204')`);
      await expect(aplica(c, INV)).rejects.toThrow(/DROP COLUMN apaga/);
      expect(await colunas(c)).toHaveLength(7); // o SAVEPOINT desfez só o inverso
      await c.query("SET LOCAL app.confirmo_apagar_campos_sheet = 'sim'");
      await aplica(c, INV);
      expect(await colunas(c)).toEqual([]);
      expect(await def(c)).toBe(antes);
      expect(await def(c, FN_TITULO)).toBeNull();
      expect(await acl(c)).toBe(aclAntes);
      expect(await contagens(c)).toBe(contAntes);
    });
  });

  it.skipIf(!MIG_TXN)("inverso sem dado (só espaços) passa SEM confirmação; sem as colunas é idempotente", async () => {
    await withTx(async (c) => {
      await timeouts(c);
      const antes = await def(c);
      await aplica(c, MIG);
      await comoUsuario(c);
      await c.query(`insert into modelos (nome, titulo_pagina, ncm) values ('ITEST-SHEET-ESP', '   ', '  ')`);
      await aplica(c, INV);
      expect(await colunas(c)).toEqual([]);
      expect(await def(c)).toBe(antes);
      await aplica(c, INV);
      expect(await def(c)).toBe(antes);
    });
  });
});
```

- [ ] **Step 3: N3 + rodar e ver falhar**

O CONTROLADOR avisa o dono (texto do `n3.sh`) e, com o OK:

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/sheet-reorg"
SHEET_DONO_AVISADO=sim bash .superpowers/sheet/n3.sh antes t6s3
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres SHEET_MIG_TXN=1 npx vitest run --no-file-parallelism tests/integration/sheet-reorg-campos.test.ts 2>&1 | tail -15
bash .superpowers/sheet/n3.sh depois t6s3
```

Expected: FAIL — `ENOENT … 20261005100000_modelo_titulo_peso_ncm_preco_anterior.sql` (bloco estático e de banco).

- [ ] **Step 4: O gerador — `.superpowers/sheet/mig/gerar_sql.py`**

```python
#!/usr/bin/env python3
"""F3.6 Parte B — GERA a migration e o inverso (plano 2026-09-25-sheet-planejamento-reorganizacao, Task 6).
Entrada: .superpowers/sheet/mig/antes/replicar.sql + md5-replicar-antes.txt (dump SÓ LEITURA da cópia — dump_antes.sh).
Saída: supabase/migrations/20261005100000_…sql, supabase/rollback/20261005100000_…_down.sql, md5-replicar-depois.txt,
md5-titulo-depois.txt. NUNCA editar os .sql à mão — mudar AQUI, regerar e rodar a suíte (Task 6)."""
import hashlib
import pathlib
import sys

RAIZ = pathlib.Path(__file__).resolve().parents[3]
M = RAIZ / ".superpowers" / "sheet" / "mig"
NOME = "20261005100000_modelo_titulo_peso_ncm_preco_anterior"
MIG = RAIZ / "supabase" / "migrations" / f"{NOME}.sql"
INV = RAIZ / "supabase" / "rollback" / f"{NOME}_down.sql"
FN = "public._replicar_cards_plan_tecido_core(uuid,uuid,uuid,uuid[],integer)"
FN_ACL = "public._replicar_cards_plan_tecido_core(uuid, uuid, uuid, uuid[], integer)"
TIT = "public._titulo_pagina_calculado(text,text)"
COL_ANTES = "      versao, modelo_base_id, mix_id, ref, ref_auto, descricao_produto\n"
COL_DEPOIS = ("      versao, modelo_base_id, mix_id, ref, ref_auto, descricao_produto, peso_kg, comprimento_cm, largura_cm, "
              "altura_cm, titulo_pagina, ncm, preco_anterior\n")
VAL_ANTES = "      v_versao, v_root, o.mix_id, o.ref, o.ref_auto, o.descricao_produto\n"
VAL_DEPOIS = ("      v_versao, v_root, o.mix_id, o.ref, o.ref_auto, o.descricao_produto, o.peso_kg, o.comprimento_cm, "
              "o.largura_cm, o.altura_cm, o.titulo_pagina, o.ncm, o.preco_anterior\n")
MAIUSC = "ABCDEFGHIJKLMNOPQRSTUVWXYZÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑÝ"  # = TITULO_MAIUSC (src/lib/titulo-pagina.ts)
MINUSC = "abcdefghijklmnopqrstuvwxyzáàâãäéèêëíìîïóòôõöúùûüçñý"  # = TITULO_MINUSC
CONECTIVOS = ["de", "da", "do", "das", "dos", "e", "com", "em", "para"]  # = TITULO_CONECTIVOS
COLUNAS = ["titulo_pagina", "peso_kg", "comprimento_cm", "largura_cm", "altura_cm", "ncm", "preco_anterior"]
TEM_DADO = ("length(btrim(coalesce(titulo_pagina, ''))) > 0 OR peso_kg IS NOT NULL OR comprimento_cm IS NOT NULL "
            "OR largura_cm IS NOT NULL OR altura_cm IS NOT NULL OR length(btrim(coalesce(ncm, ''))) > 0 "
            "OR preco_anterior IS NOT NULL")


def md5(s: str) -> str:
    return hashlib.md5(s.encode("utf-8")).hexdigest()


def pare(msg: str) -> None:
    sys.exit(f"PARE: {msg}")


raw = (M / "antes" / "replicar.sql").read_text(encoding="utf-8")
antes = raw[:-1] if raw.endswith("$function$\n\n") else raw  # o psql -A -t põe 1 "\n" depois do valor
md5_antes = (M / "md5-replicar-antes.txt").read_text(encoding="utf-8").strip()
if md5(antes) != md5_antes:
    pare(f"o dump não reproduz o md5 VIVO ({md5(antes)} ≠ {md5_antes}) — refazer o dump_antes.sh")
if not antes.endswith("end $function$\n"):
    pare("o texto vivo de _replicar não termina em 'end $function$' + quebra de linha")
for a in (COL_ANTES, VAL_ANTES):
    if antes.count(a) != 1:
        pare(f"âncora achada {antes.count(a)}× (esperado 1): {a.strip()}")
depois = antes.replace(COL_ANTES, COL_DEPOIS).replace(VAL_ANTES, VAL_DEPOIS)
md5_depois = md5(depois)
if len(MAIUSC) != 51 or len(MINUSC) != 51:
    pare("listas de letras com tamanho errado")
lista_con = ", ".join(f"'{c}'" for c in CONECTIVOS)

# Formato CANÔNICO do pg_get_functiondef (atributos com 1 espaço na frente; corpo verbatim; termina em "$function$\n") —
# o md5 da guarda é o deste texto; a suíte confere que o PG devolve EXATAMENTE isto depois de aplicar.
TITULO = "".join([
    "CREATE OR REPLACE FUNCTION public._titulo_pagina_calculado(_nome text, _loja text)\n",
    " RETURNS text\n",
    " LANGUAGE sql\n",
    " IMMUTABLE\n",
    " SET search_path TO 'public'\n",
    "AS $function$\n",
    "  -- Título para a página AUTOMÁTICO (F3.6 — spec 2026-09-25, ruling 1). Espelho byte a byte de tituloPaginaCalculado\n",
    "  -- (src/lib/titulo-pagina.ts; anti-drift tests/fixtures/titulo-pagina-casos.ts). Nome: pontas (espaço/tab/CR/LF)\n",
    "  -- aparadas e o miolo em 1 espaço; cada palavra com a 1ª letra maiúscula e o resto minúsculo por lista FIXA de\n",
    "  -- letras (independe do locale do banco); conectivos em minúsculo, salvo a 1ª palavra; + ' | ' + a loja como está\n",
    "  -- (só as pontas aparadas). Nome vazio => '' (nunca ' | Loja' solto); loja vazia => só o nome.\n",
    "  WITH n AS (\n",
    "    SELECT regexp_replace(btrim(coalesce(_nome, ''), E' \\t\\r\\n'), E'[ \\t\\r\\n]+', ' ', 'g') AS s,\n",
    "           btrim(coalesce(_loja, ''), E' \\t\\r\\n') AS l\n",
    "  ), p AS (\n",
    "    SELECT t.i,\n",
    "           CASE\n",
    f"             WHEN t.i > 1 AND translate(t.w, '{MAIUSC}', '{MINUSC}') IN ({lista_con})\n",
    f"               THEN translate(t.w, '{MAIUSC}', '{MINUSC}')\n",
    f"             ELSE translate(left(t.w, 1), '{MINUSC}', '{MAIUSC}') || translate(substr(t.w, 2), '{MAIUSC}', '{MINUSC}')\n",
    "           END AS x\n",
    "      FROM n, regexp_split_to_table(n.s, ' ') WITH ORDINALITY AS t(w, i)\n",
    "     WHERE n.s <> ''\n",
    "  )\n",
    "  SELECT CASE\n",
    "           WHEN (SELECT n.s FROM n) = '' THEN ''\n",
    "           WHEN (SELECT n.l FROM n) = '' THEN (SELECT string_agg(p.x, ' ' ORDER BY p.i) FROM p)\n",
    "           ELSE (SELECT string_agg(p.x, ' ' ORDER BY p.i) FROM p) || ' | ' || (SELECT n.l FROM n)\n",
    "         END\n",
    "$function$\n",
])
md5_titulo = md5(TITULO)

TRAVAS = "BEGIN;\nSET LOCAL lock_timeout = '500ms';\nSET LOCAL transaction_timeout = '3s';\n"


def guarda_replicar(extra: str = "") -> str:
    return "".join([
        "DO $guarda$\nDECLARE\n  v_md5 text;\n  v_n bigint;\nBEGIN\n",
        f"  IF to_regprocedure('{FN}') IS NULL THEN\n",
        "    RAISE EXCEPTION 'sheet_reorg: _replicar_cards_plan_tecido_core não existe neste banco' USING ERRCODE = 'P0001';\n",
        "  END IF;\n",
        f"  v_md5 := md5(pg_get_functiondef(to_regprocedure('{FN}')));\n",
        f"  IF v_md5 NOT IN ('{md5_antes}', '{md5_depois}') THEN\n",
        "    RAISE EXCEPTION 'sheet_reorg: _replicar_cards_plan_tecido_core não está nem no texto vivo de 25/set nem no desta "
        "migration (md5 %) — outra frente mudou; regenerar a migration (plano, Task 6) antes de aplicar', v_md5 "
        "USING ERRCODE = 'P0001';\n",
        "  END IF;\n",
        extra,
        "END\n$guarda$;\n",
    ])


GUARDA_TITULO = "".join([
    f"  IF to_regprocedure('{TIT}') IS NOT NULL THEN\n",
    f"    v_md5 := md5(pg_get_functiondef(to_regprocedure('{TIT}')));\n",
    f"    IF v_md5 <> '{md5_titulo}' THEN\n",
    "      RAISE EXCEPTION 'sheet_reorg: _titulo_pagina_calculado já existe com outro texto (md5 %) — PARE e avise o "
    "controlador', v_md5 USING ERRCODE = 'P0001';\n",
    "    END IF;\n",
    "  END IF;\n",
])

GUARDA_DADOS = "".join([
    "  IF EXISTS (SELECT 1 FROM information_schema.columns\n",
    "              WHERE table_schema = 'public' AND table_name = 'modelos' AND column_name = 'titulo_pagina') THEN\n",
    f"    EXECUTE $q$SELECT count(*) FROM public.modelos WHERE {TEM_DADO}$q$ INTO v_n;\n",
    "    IF v_n > 0 AND coalesce(current_setting('app.confirmo_apagar_campos_sheet', true), '') <> 'sim' THEN\n",
    "      RAISE EXCEPTION 'Há % modelo(s) com Título para a página, Peso/medidas, NCM ou Preço anterior preenchidos — o "
    "DROP COLUMN apaga esses dados. Exporte antes (volta-producao.sh) e rode de novo com SET LOCAL "
    "app.confirmo_apagar_campos_sheet = ''sim'' na MESMA transação (EXTRA_SQL do aplica_v2).', v_n USING ERRCODE = 'P0001';\n",
    "    END IF;\n",
    "  END IF;\n",
])


def acl(com_titulo: bool) -> str:
    cond = [f"has_function_privilege('anon', '{FN}', 'EXECUTE')",
            f"has_function_privilege('authenticated', '{FN}', 'EXECUTE')"]
    if com_titulo:
        cond += [f"has_function_privilege('anon', '{TIT}', 'EXECUTE')",
                 f"has_function_privilege('authenticated', '{TIT}', 'EXECUTE')"]
    return ("DO $acl$\nBEGIN\n  IF " + "\n     OR ".join(cond) + " THEN\n"
            "    RAISE EXCEPTION 'sheet_reorg: função interna ficou executável por anon/authenticated (invariante #9)' "
            "USING ERRCODE = 'P0001';\n  END IF;\nEND\n$acl$;\n")


COMENTARIOS = {
    "titulo_pagina": "Título para a página (F3.6). NULL = automático: _titulo_pagina_calculado(nome, tenants.nome). "
                     "Consumidor/ERP: coalesce(titulo_pagina, _titulo_pagina_calculado(nome, loja)) — nunca ler cru.",
    "peso_kg": "Peso do produto em kg (3 casas). NULL = vazio. F3.6.",
    "comprimento_cm": "Comprimento do produto em cm (2 casas). NULL = vazio. F3.6.",
    "largura_cm": "Largura do produto em cm (2 casas). NULL = vazio. F3.6.",
    "altura_cm": "Altura do produto em cm (2 casas). NULL = vazio. F3.6.",
    "ncm": "NCM do Produto — texto livre (dígitos e pontos, validado no cliente, sem tabela oficial nem sugestão). "
           "NULL = vazio. F3.6.",
    "preco_anterior": "Preço anterior (F3.6). NULL = automático: acompanha o preço de venda EFETIVO (o digitado ou o "
                      "sugerido). Não-NULL = fixado à mão.",
}

cabecalho_mig = """-- F3.6 (Parte B) — reorganização do Sheet do Planejamento: campos NOVOS em `modelos` (Título para a página, Peso/
-- medidas, NCM do Produto, Preço anterior) + helper do título automático + "Replicar card(s)" leva os 7 campos.
-- Spec: docs/superpowers/specs/2026-09-25-sheet-planejamento-reorganizacao-design.md (§3 rulings 1–5 e 11, §5.2).
-- Plano: docs/superpowers/plans/2026-09-25-sheet-planejamento-reorganizacao.md (Task 6).
-- ARQUIVO GERADO por .superpowers/sheet/mig/gerar_sql.py a partir do texto VIVO de _replicar_cards_plan_tecido_core (cópia
-- local = produção em 25/set) + o diff mínimo (as 2 linhas do INSERT). NÃO editar à mão — regenerar.
--  0. guarda de md5 EXATA: _replicar no texto vivo de 25/set OU no desta migration (reaplicação); _titulo_pagina_calculado
--     ausente OU no texto desta migration. Qualquer outro texto = outra frente mudou ⇒ recusa (nada fica);
--  1. _titulo_pagina_calculado(nome, loja) — IMMUTABLE, espelho byte a byte de src/lib/titulo-pagina.ts. Consumidor/ERP:
--     título = coalesce(modelos.titulo_pagina, _titulo_pagina_calculado(modelos.nome, tenants.nome)) — NUNCA a coluna crua
--     (NULL = automático). EXECUTE revogado de PUBLIC/anon/authenticated (invariante #9; service_role/postgres mantêm);
--  2. _replicar_cards_plan_tecido_core — texto vivo + os 7 campos no INSERT. ANTES do ALTER: o plpgsql só resolve a coluna
--     ao EXECUTAR; a função nova só roda depois do COMMIT, com as colunas já criadas. CREATE OR REPLACE preserva o proacl;
--     o REVOKE só reafirma e o bloco $acl$ prova com has_function_privilege;
--  3. POR ÚLTIMO (ACCESS EXCLUSIVE em `modelos` só no fim): 7 colunas ADITIVAS (nullable, sem default, sem backfill) e os
--     4 CHECK (>= 0) nomeados de peso/medidas (varrem a tabela uma vez — tudo NULL). Sem CHECK em ncm (validação no
--     cliente — ruling 3) nem em preco_anterior (sem precedente em preço — R8).
-- TRAVAS NO ARQUIVO (psql -f é o caminho padrão do CLAUDE.md; o aplica_v2 reinjeta as mesmas — inofensivo). NENHUMA DDL de
-- policy: o hook supautils.policy_grants NÃO dispara. Contagens (funções|gatilhos): +1 | +0.
-- ORDEM: aplicar em PRODUÇÃO DEPOIS da 20261004100000 (Nota sem a trava do pedido) e ANTES de juntar o front que grava as
-- colunas (o vite local do dono grava em produção — sem elas, todo Salvar do Planejamento cairia com PGRST204).
-- Inverso: supabase/rollback/20261005100000_modelo_titulo_peso_ncm_preco_anterior_down.sql (APAGA o que foi digitado).
"""

cabecalho_inv = """-- INVERSO da 20261005100000_modelo_titulo_peso_ncm_preco_anterior.sql (F3.6 Parte B). ARQUIVO GERADO (gerar_sql.py).
-- ⚠️ APAGA o que foi digitado em Título para a página, Peso/medidas, NCM e Preço anterior (DROP COLUMN ×7). Só com OK do
-- dono e DEPOIS de tirar do ar o front que grava as colunas (senão todo Salvar do Planejamento cai com PGRST204).
-- GUARDA: com QUALQUER um dos 7 campos preenchido o script ABORTA, a menos que a MESMA transação tenha
--   SET LOCAL app.confirmo_apagar_campos_sheet = 'sim'
-- (o volta-producao.sh exporta antes e injeta a linha pelo EXTRA_SQL do aplica_v2).
-- Ordem: guarda (md5 + confirmação) → _replicar volta ao texto vivo de 25/set byte a byte → REVOKE/ACL → DROP da função do
-- título → DROP das colunas POR ÚLTIMO. Idempotente: sem as colunas, só recria a função. Travas no arquivo (500 ms / 3 s).
"""

colunas_sql = ",\n".join([
    "  ADD COLUMN IF NOT EXISTS titulo_pagina text",
    "  ADD COLUMN IF NOT EXISTS peso_kg numeric(10,3) CONSTRAINT modelos_peso_kg_nao_negativo CHECK (peso_kg >= 0)",
    "  ADD COLUMN IF NOT EXISTS comprimento_cm numeric(10,2) CONSTRAINT modelos_comprimento_cm_nao_negativo CHECK (comprimento_cm >= 0)",
    "  ADD COLUMN IF NOT EXISTS largura_cm numeric(10,2) CONSTRAINT modelos_largura_cm_nao_negativo CHECK (largura_cm >= 0)",
    "  ADD COLUMN IF NOT EXISTS altura_cm numeric(10,2) CONSTRAINT modelos_altura_cm_nao_negativo CHECK (altura_cm >= 0)",
    "  ADD COLUMN IF NOT EXISTS ncm text",
    "  ADD COLUMN IF NOT EXISTS preco_anterior numeric(12,2)",
])
comentarios_sql = "".join(
    f"COMMENT ON COLUMN public.modelos.{c} IS '{COMENTARIOS[c]}';\n" for c in COLUNAS)
for c in COLUNAS:
    if ";" in COMENTARIOS[c] or "'" in COMENTARIOS[c]:
        pare(f"comentário de {c} com ';' ou aspas")

mig = "".join([
    cabecalho_mig, TRAVAS, "\n",
    guarda_replicar(GUARDA_TITULO), "\n",
    TITULO[:-1], ";\n\n",
    "REVOKE EXECUTE ON FUNCTION public._titulo_pagina_calculado(text, text) FROM PUBLIC, anon, authenticated;\n\n",
    depois[:-1], ";\n\n",
    f"REVOKE EXECUTE ON FUNCTION {FN_ACL} FROM PUBLIC, anon, authenticated;\n\n",
    acl(True), "\n",
    "-- POR ÚLTIMO: ACCESS EXCLUSIVE em `modelos` só daqui até o COMMIT.\n",
    "ALTER TABLE public.modelos\n", colunas_sql, ";\n",
    comentarios_sql, "\n",
    "COMMIT;\n",
])
inv = "".join([
    cabecalho_inv, TRAVAS, "\n",
    guarda_replicar(GUARDA_DADOS), "\n",
    antes[:-1], ";\n\n",
    f"REVOKE EXECUTE ON FUNCTION {FN_ACL} FROM PUBLIC, anon, authenticated;\n\n",
    acl(False), "\n",
    "DROP FUNCTION IF EXISTS public._titulo_pagina_calculado(text, text);\n\n",
    "-- POR ÚLTIMO: ACCESS EXCLUSIVE em `modelos` só daqui até o COMMIT.\n",
    "ALTER TABLE public.modelos\n",
    ",\n".join(f"  DROP COLUMN IF EXISTS {c}" for c in COLUNAS), ";\n\n",
    "COMMIT;\n",
])
for nome, txt in (("migration", mig), ("inverso", inv)):
    linhas = txt.split("\n")
    if linhas.count("BEGIN;") != 1 or linhas.count("COMMIT;") != 1:
        pare(f"{nome}: esperado 1 BEGIN; e 1 COMMIT; em linha própria")
MIG.write_text(mig, encoding="utf-8")
INV.write_text(inv, encoding="utf-8")
(M / "md5-replicar-depois.txt").write_text(md5_depois + "\n", encoding="utf-8")
(M / "md5-titulo-depois.txt").write_text(md5_titulo + "\n", encoding="utf-8")
print(f"OK: {MIG.relative_to(RAIZ)} e {INV.relative_to(RAIZ)} gerados · _replicar {md5_antes} → {md5_depois} · título {md5_titulo}")
```

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/sheet-reorg"
python3 .superpowers/sheet/mig/gerar_sql.py
git diff --no-index --stat /dev/null supabase/migrations/20261005100000_modelo_titulo_peso_ncm_preco_anterior.sql | tail -1
grep -c 'ALTER TABLE public.modelos' supabase/migrations/20261005100000_modelo_titulo_peso_ncm_preco_anterior.sql supabase/rollback/20261005100000_modelo_titulo_peso_ncm_preco_anterior_down.sql
```

Expected: `OK: … gerados · _replicar <md5 vivo> → <md5 novo> · título <md5>`; `ALTER TABLE public.modelos` 1× em cada arquivo (só o comando — o cabeçalho não pode repetir a frase, o teste estático usa a 1ª ocorrência).

- [ ] **Step 5: N3 + rodar a suíte nos 2 modos**

Com o OK do dono (o controlador avisa):

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/sheet-reorg"
SHEET_DONO_AVISADO=sim bash .superpowers/sheet/n3.sh antes t6s5
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres SHEET_MIG_TXN=1 npx vitest run --no-file-parallelism tests/integration/sheet-reorg-campos.test.ts 2>&1 | tail -20
bash .superpowers/sheet/n3.sh depois t6s5
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres npx vitest run --no-file-parallelism tests/integration/sheet-reorg-campos.test.ts 2>&1 | tail -8
```

Expected: modo `SHEET_MIG_TXN=1` → **19 passed** (6 estáticos + 13 de banco). Modo sem a variável (cópia SEM a migration) → 6 passed, 13 skipped. `n3.sh depois` mostra `483|277|f` (nada vazou: a cópia continua sem a função). Falhas previsíveis e o que fazer:
- "texto canônico do PG" ≠ `corpoTitulo(MIG)+"\n"` ⇒ o template `TITULO` do gerador não bate com o formato do `pg_get_functiondef`: copiar a forma do texto impresso na mensagem para o template, regerar (Step 4) e repetir — registrar em `desvios.md`. Nunca "consertar" o teste.
- `Replicar` falhando por módulo/assinatura ⇒ conferir `replicar_cards_plan_tecido` na cópia (mesma chamada do `modelo-descricao-produto.test.ts`) e registrar.
- Qualquer resíduo (`n3.sh depois` ≠ `483|277|f`) ⇒ PARE e avise o controlador (algo vazou da txn).

- [ ] **Step 6: Gates e commit**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/sheet-reorg"
bash .superpowers/sheet/gates.sh
git add -- supabase/migrations/20261005100000_modelo_titulo_peso_ncm_preco_anterior.sql supabase/rollback/20261005100000_modelo_titulo_peso_ncm_preco_anterior_down.sql tests/integration/sheet-reorg-campos.test.ts
git commit --only -m "feat(sheet-reorg): migration 20261005100000 — 7 colunas em modelos, título automático e Replicar leva os campos (T6)" \
  -m "GERADA do texto vivo (gerar_sql.py) com guarda de md5 exata; travas 500ms/3s no arquivo; ALTER por último; +1 função/+0 gatilhos; inverso destrutivo com confirmação. Suíte só na cópia (SHEET_MIG_TXN=1). Plano 2026-09-25, Task 6." \
  -m "Co-Authored-By: Claude <seu modelo real> <noreply@anthropic.com>" \
  -- supabase/migrations/20261005100000_modelo_titulo_peso_ncm_preco_anterior.sql supabase/rollback/20261005100000_modelo_titulo_peso_ncm_preco_anterior_down.sql tests/integration/sheet-reorg-campos.test.ts
git show --stat HEAD
```

- [ ] **Step 7: G-migration — 2 revisões Opus INDEPENDENTES + guardião**

O controlador despacha 2 revisores Opus em paralelo, cada um SEM ver o parecer do outro, com: o plano, a spec, os 2 SQL gerados, o `gerar_sql.py`, o `dump_antes.sh`, a suíte e os logs do Step 5. Checklist: (1) o texto de `_replicar` na migration = o vivo com SÓ as 2 linhas (e o inverso = o vivo); (2) guarda de md5 exata nos 2 arquivos e recusa provada (teste "outra frente"); (3) travas no arquivo; zero DDL de policy; `ALTER` por último e só COMMENT/COMMIT depois; (4) `ADD COLUMN IF NOT EXISTS` + CHECKs nomeados; idempotência provada; (5) ACL #9 das 2 internas (`has_function_privilege`), service_role no título; (6) inverso: guarda de dado + confirmação, ordem, idempotência, byte a byte; (7) +1|+0; (8) SQL do título ≡ TS nas 21 fixtures; (9) nenhuma mudança de comportamento em quem não usa as colunas. Depois, o guardião `guardiao-unificacao` (G-migration) com os 2 pareceres. BLOQUEIA ⇒ corrigir no GERADOR, regerar, repetir Steps 5–6 e as revisões.

---
## Task 7: Ensaio na cópia + scripts de PRODUÇÃO (molde Nota/SKU) + provas com `psql`/`docker` falsos  *(Opus + guardião — G-scripts)*

> Nenhum arquivo versionado. Tudo em `.superpowers/sheet/` e na pasta 700 `/Users/sunglee/PLM + Criação/savepoints/pre-apply-sheet-reorg/`. O agente NUNCA roda nada contra a produção: os scripts de produção são PROVADOS só com `psql`/`docker` falsos no PATH e URL sintética (Step 7); quem roda de verdade é o DONO (Task 10).

**Files (não versionados):** `.superpowers/sheet/mig/{extra.sh,monta-aplica.sh,aplica.sh(gerado),ensaio-local.sh,ida-producao.sh,volta-producao.sh,ref-volta-f1.sh,prova-scripts.sh}`, `.superpowers/sheet/copia.sh`, `/Users/sunglee/PLM + Criação/savepoints/pre-apply-sheet-reorg/RODAR-sheet-reorg.md`.

**Interfaces:**
- Consumes: bloco LITERAL da F1 (`espera`, `ativ_vazio`, `com_travas`, `aplica_v2`, `ATIV` — runbook `…/.superpowers/sdd/2026-09-22-kanban-automatico-f1-banco/task-18-runbook-v2.md`, hash `c045cc571caf5d95`, o mesmo de Nota/SKU); `bloco_apoio_v2.sh` da F1 (`FIDEL_DET`) só dentro de subshell; `md5-replicar-{antes,depois}.txt` (Task 6).
- Produces: `aplica.sh` (source) com `CONT`, `OBJ_SHEET` (0\|0\|0 ↔ 1\|7\|4), `MD5_REPLICAR`, `FN_PRE`, `ACL_SHEET` (esperado 0\|0\|1), `DADOS_SHEET`, `prevoo_sheet`, `confere_ida_sheet`, `confere_volta_sheet`, `backup_banco`, `backup_copia`, `ref_mais_nova`, `chaves_f1`, `confere_cadeia_ref`, `retrato_producao`; `md5-mig.txt`/`md5-inv.txt` (md5 dos 2 SQL ENSAIADOS — o pré-voo de produção exige iguais).

- [ ] **Step 1: `.superpowers/sheet/mig/extra.sh` (consultas e funções desta frente)**

```bash
# ── Reorganização do Sheet (F3.6 Parte B — migration 20261005100000). Anexado ao bloco LITERAL da F1 por monta-aplica.sh.
# Só DEFINE variáveis e funções (nada roda sozinho). Uso: num BASH, de dentro da worktree: source .superpowers/sheet/mig/aplica.sh
M=.superpowers/sheet/mig
DS="${SHEET_DS:-/Users/sunglee/PLM + Criação/savepoints/pre-apply-sheet-reorg}"
BF1="${SHEET_BF1:-/Users/sunglee/PLM + Criação/savepoints/pre-apply-f1-kanban-auto}"
BK="/Users/sunglee/PLM + Criação/banco-local/backups"
CONTAINER=supabase_db_banco-local
# Arquivo da URL de produção. SHEET_DBURL_FILE existe SÓ p/ as provas (URL sintética); o dono nunca o define.
DBURL_FILE="${SHEET_DBURL_FILE:-/tmp/dburl.txt}"
# Guarda ANCORADA (a mesma de Nota/SKU — substring casaria URL forjada com o ref no path/query). Host direto
# (db.<ref>.supabase.co) ou pooler (postgres.<ref>@…pooler.supabase.com). Roda ANTES de qualquer psql; nunca imprime a URL.
REGEX_URL_PROD='^postgres(ql)?://([^:@/]+(:[^@/]*)?@db\.ruinwcuabilumcspeyjk\.supabase\.co(:[0-9]+)?/|postgres\.ruinwcuabilumcspeyjk(:[^@/]*)?@[a-z0-9.-]+\.pooler\.supabase\.com(:[0-9]+)?/)'
confere_url_producao() {
  [ -s "$DBURL_FILE" ] || { echo "PARE: $DBURL_FILE ausente"; return 1; }
  grep -Eq "$REGEX_URL_PROD" "$DBURL_FILE" || { echo "PARE: $DBURL_FILE não aponta p/ o banco sisTrama (ref ruinwcuabilumcspeyjk, host direto ou pooler)"; return 1; }
}
FN_REPLICAR='public._replicar_cards_plan_tecido_core(uuid,uuid,uuid,uuid[],integer)'
FN_TITULO='public._titulo_pagina_calculado(text,text)'
CONT="select (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public') || '|' || (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal)"
# Objetos desta frente — função do título | 7 colunas | 4 CHECKs: 0|0|0 sem a frente; 1|7|4 com ela.
OBJ_SHEET="select (select count(*) from pg_proc where oid = to_regprocedure('$FN_TITULO')) || '|' || (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'modelos' and column_name in ('titulo_pagina','peso_kg','comprimento_cm','largura_cm','altura_cm','ncm','preco_anterior')) || '|' || (select count(*) from pg_constraint where conrelid = 'public.modelos'::regclass and conname in ('modelos_peso_kg_nao_negativo','modelos_comprimento_cm_nao_negativo','modelos_largura_cm_nao_negativo','modelos_altura_cm_nao_negativo'))"
MD5_REPLICAR="select md5(pg_get_functiondef('$FN_REPLICAR'::regprocedure))"
# Fidelidade de TODAS as outras funções de public (exceto as 2 desta frente): md5 de assinatura+definição | quantidade.
FN_PRE="select md5(string_agg(p.oid::regprocedure::text || '=' || md5(pg_get_functiondef(p.oid)), E'\n' order by p.oid::regprocedure::text collate \"C\")) || '|' || count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f','p') and p.oid not in (coalesce(to_regprocedure('$FN_TITULO'), 0::oid), coalesce(to_regprocedure('$FN_REPLICAR'), 0::oid))"
# ACL (#9): roles com EXECUTE em _replicar (public/anon/authenticated) | idem no título | service_role no título (1 = sim).
ACL_SHEET="select (select count(*) from (values ('public'), ('anon'), ('authenticated')) r(x) where has_function_privilege(r.x, '$FN_REPLICAR', 'EXECUTE')) || '|' || (select count(*) from (values ('public'), ('anon'), ('authenticated')) r(x) where has_function_privilege(r.x, '$FN_TITULO', 'EXECUTE')) || '|' || (case when has_function_privilege('service_role', '$FN_TITULO', 'EXECUTE') then 1 else 0 end)"
TEM_DADO_SHEET="length(btrim(coalesce(titulo_pagina, ''))) > 0 OR peso_kg IS NOT NULL OR comprimento_cm IS NOT NULL OR largura_cm IS NOT NULL OR altura_cm IS NOT NULL OR length(btrim(coalesce(ncm, ''))) > 0 OR preco_anterior IS NOT NULL"
DADOS_SHEET="select count(*) from public.modelos where $TEM_DADO_SHEET"
# Pré-requisitos por OBJETO (nunca schema_migrations — ruling da F1). Ordem do dono: F1 → Nota → SKU → Nota sem trava → esta.
F1_OK="select to_regprocedure('public.kanban_mover(uuid,text)') is not null"
NOTA_OK="select to_regprocedure('public.fn_oc_nota_entrada_recalc()') is not null and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ocs_tecido' and column_name = 'data_nota_entrada')"
F35A_OK="select to_regclass('public.modelo_skus') is not null"
# 20261004100000 (Nota sem a trava do pedido): o código da trava sumiu de fn_oc_nota_entrada_valida (marcador de CÓDIGO,
# não de comentário — conferido na cópia, que já tem a frente).
SEM_TRAVA_OK="select to_regprocedure('public.fn_oc_nota_entrada_valida()') is not null and position('NEW.data_nota_entrada < NEW.data_pedido' in pg_get_functiondef('public.fn_oc_nota_entrada_valida()'::regprocedure)) = 0"

md5_arquivo() { md5 -q "$1" 2>/dev/null || md5sum "$1" | cut -d' ' -f1; }
md5_de() { tr -d '[:space:]' < "$1"; }
# md5 dos 2 SQL NO DISCO = os ENSAIADOS (gravados no fim do ensaio-local.sh, depois do G-migration).
confere_md5_sql_revisado() {
  [ -s "$M/md5-mig.txt" ] && [ -s "$M/md5-inv.txt" ] || { echo "FALHOU (pré-voo): faltam $M/md5-mig.txt e/ou md5-inv.txt (ensaio da Task 7)"; return 1; }
  [ "$(md5_arquivo "$MIG")" = "$(md5_de "$M/md5-mig.txt")" ] || { echo "FALHOU (pré-voo): $MIG ≠ o ensaiado"; return 1; }
  [ "$(md5_arquivo "$INV")" = "$(md5_de "$M/md5-inv.txt")" ] || { echo "FALHOU (pré-voo): $INV ≠ o ensaiado"; return 1; }
  echo "OK (pré-voo): os 2 SQL = md5 do ensaio"
}
tt_do_arquivo() { sed -n "s/^SET LOCAL transaction_timeout = '\([0-9][0-9]*\)s';\$/\1/p" "$1" | head -1; }
confere_arquivos_sheet() {
  local f tt
  for f in "$MIG" "$INV"; do
    tt="$(tt_do_arquivo "$f")"
    [ "$tt" = 3 ] || { echo "FALHOU (pré-voo): $f — transaction_timeout tem de ser 3s (achei '${tt}s')"; return 1; }
    [ "$(grep -A2 -x 'BEGIN;' "$f")" = "$(printf '%s\n' 'BEGIN;' "SET LOCAL lock_timeout = '500ms';" "SET LOCAL transaction_timeout = '3s';")" ] \
      || { echo "FALHOU (pré-voo): $f sem as 2 travas logo depois do BEGIN;"; return 1; }
    if grep -Eiq '^[[:space:]]*(create|drop|alter)[[:space:]]+policy' "$f"; then
      echo "FALHOU (pré-voo): $f tem DDL de policy (hook supautils.policy_grants) — esta frente não pode ter"; return 1
    fi
  done
  echo "OK (pré-voo): travas 500ms/3s nos 2 arquivos e nenhuma DDL de policy"
}
# Backup = receita PROVADA (Nota/SKU): 2 dumps POR SCHEMA (public + auth) com o pg_dump 17.6 do CONTAINER da cópia (o do
# Mac é 15). URL pela ENTRADA PADRÃO (nunca em argumento de processo). umask 077 + chmod 600; exige TABLE DATA > 0 e que o
# dump abra (pg_restore -l). PARA em qualquer falha (nada é aplicado).
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
backup_copia() {  # uso: backup_copia rótulo — pg_dump -Fc da CÓPIA inteira (supabase_admin, dentro do container)
  local f; mkdir -p "$BK" || return 1
  f="$BK/pre-sheet-$1-$(date +%F-%H%M%S).dump"
  docker exec -e PGPASSWORD=postgres "$CONTAINER" pg_dump -h 127.0.0.1 -U supabase_admin -d postgres -Fc > "$f" && [ -s "$f" ] \
    || { echo "PARE: backup da cópia falhou"; rm -f "$f"; return 1; }
  echo "backup da cópia: $f ($(du -h "$f" | cut -f1))"
}
# ── Cadeia da referência da VOLTA DE EMERGÊNCIA da F1 (R22: descobrir a MAIS NOVA, sem cravar nome; PARAR se não bater) ──
# Chaves (categoria:objeto) que ESTA frente cria/muda no retrato de fidelidade (FIDEL_DET do bloco de apoio v2 da F1).
PAT_SHEET='^colunas:public[.]modelos[.](titulo_pagina|peso_kg|comprimento_cm|largura_cm|altura_cm|ncm|preco_anterior)$|^funcoes:public[.](_replicar_cards_plan_tecido_core|_titulo_pagina_calculado)[(]'
ref_mais_nova() {  # imprime a referência MAIS NOVA (mtime) — nunca a desta frente
  local r; r=$(ls -t "$BF1"/fidelidade_ref_volta_f1_*_detalhe.txt 2>/dev/null | grep -v '_pos_sheet_detalhe[.]txt$' | head -1)
  [ -n "$r" ] && [ -s "$r" ] || { echo "PARE: nenhuma fidelidade_ref_volta_f1_*_detalhe.txt em $BF1" >&2; return 1; }
  printf '%s\n' "$r"
}
chaves_f1() {  # $1 = saída: chaves que a F1 mudou (retrato pré-F1 × pós-F1 de PRODUÇÃO, 24/set)
  local pre="$BF1/fidelidade_prod_pre_detalhe.txt" pos="$BF1/fidelidade_prod_pos_detalhe.txt"
  [ -s "$pre" ] && [ -s "$pos" ] || { echo "PARE: faltam $pre e/ou $pos (retratos da F1)"; return 1; }
  comm -3 <(LC_ALL=C sort "$pre") <(LC_ALL=C sort "$pos") | awk -F'=' '{ k = $1; sub(/^\t/, "", k); print k }' | LC_ALL=C sort -u > "$1"
  [ -s "$1" ] || { echo "PARE: nenhuma chave da F1 (retratos iguais?)"; return 1; }
}
fora_f1_e_sheet() {  # $1 = chaves da F1, $2 = retrato → linhas FORA da F1 e desta frente, ordenadas
  awk -F'=' -v pat="$PAT_SHEET" 'NR == FNR { k[$1] = 1; next } !($1 in k) && !($1 ~ pat)' "$1" "$2" | LC_ALL=C sort
}
retrato_producao() {  # $1 = URL, $2 = saída — FIDEL_DET do bloco da F1 (SÓ LEITURA; o bloco dá cd — por isso a subshell)
  ( source "$BF1/bloco_apoio_v2.sh" > /dev/null || exit 1
    psql "$1" -X -q -A -t -v ON_ERROR_STOP=1 -c "$FIDEL_DET" ) > "$2" || { echo "FALHOU: não li o retrato de fidelidade"; return 1; }
  [ -s "$2" ] || { echo "FALHOU: retrato de fidelidade vazio"; return 1; }
}
confere_cadeia_ref() {  # $1 = retrato de produção AGORA → a referência mais nova bate com ele FORA da F1 e desta frente
  local r kf1 dif
  r=$(ref_mais_nova) || return 1
  kf1="$(mktemp -t sheet-kf1.XXXXXX)"
  chaves_f1 "$kf1" || { rm -f "$kf1"; return 1; }
  dif=$(diff <(fora_f1_e_sheet "$kf1" "$r") <(fora_f1_e_sheet "$kf1" "$1") | grep -E '^[<>]' || true)
  rm -f "$kf1"
  if [ -n "$dif" ]; then
    printf '%s\n' "$dif" | cut -c1-160 | head -20
    echo "PARE: a referência mais nova ($(basename "$r")) NÃO bate com a produção fora da F1 e desta frente — outra frente mudou o banco sem gravar a referência dela (ex.: Nota sem trava ⇒ só fn_oc_nota_entrada_valida) ou houve mudança fora do fluxo. Avisar o controlador."
    return 1
  fi
  echo "OK (cadeia da volta da F1): a referência mais nova ($(basename "$r")) bate com a produção fora da F1 e desta frente"
}
prevoo_sheet() {  # uso: prevoo_sheet URL RETRATO_ATUAL — SÓ LEITURA
  echo "== pré-voo da reorganização do Sheet — só leitura $(date '+%F %T')"
  git ls-files --error-unmatch "$MIG" "$INV" > /dev/null 2>&1 || { echo "FALHOU (arquivos): SQL não commitado"; return 1; }
  git diff --quiet HEAD -- "$MIG" "$INV" || { echo "FALHOU (arquivos): alteração não commitada no SQL"; return 1; }
  confere_md5_sql_revisado || return 1
  confere_arquivos_sheet || return 1
  espera "$1" "select current_setting('server_version_num')::int >= 170000 and exists (select 1 from pg_settings where name = 'transaction_timeout')" "t" "PG >= 17 com transaction_timeout" &&
  espera "$1" "$F1_OK" "t" "F1 (kanban automático) no banco" &&
  espera "$1" "$NOTA_OK" "t" "Data da Nota de Entrada no banco" &&
  espera "$1" "$F35A_OK" "t" "SKU (F3.5a) no banco" &&
  espera "$1" "$SEM_TRAVA_OK" "t" "Nota SEM a trava do pedido (20261004100000) no banco — ordem do dono: ela ANTES desta" &&
  espera "$1" "$OBJ_SHEET" "0|0|0" "objetos desta frente ainda NÃO existem" &&
  espera "$1" "$MD5_REPLICAR" "$(md5_de "$M/md5-replicar-antes.txt")" "_replicar no texto que a guarda espera" &&
  confere_cadeia_ref "$2" &&
  ativ_vazio "$1" &&
  echo "== PRÉ-VOO OK $(date '+%T')"
}
confere_ida_sheet() {  # uso: confere_ida_sheet URL CONT_ANTES FN_PRE_ANTES
  local f="${2%|*}" g="${2#*|}"
  espera "$1" "$OBJ_SHEET" "1|7|4" "IDA: função do título | 7 colunas | 4 CHECKs" &&
  espera "$1" "$MD5_REPLICAR" "$(md5_de "$M/md5-replicar-depois.txt")" "IDA: _replicar no texto desta migration" &&
  espera "$1" "$ACL_SHEET" "0|0|1" "IDA: ACL (#9) — internas fechadas p/ PUBLIC/anon/authenticated; service_role no título" &&
  espera "$1" "$FN_PRE" "$3" "IDA: nenhuma outra função mudou" &&
  espera "$1" "$CONT" "$((f + 1))|$g" "IDA: contagens = antes + 1 função, + 0 gatilhos"
}
# Volta por DIFERENÇA: CONT/FN_PRE lidos NA HORA, imediatamente antes do inverso (nunca os da ida).
confere_volta_sheet() {  # uso: confere_volta_sheet URL CONT_ANTES_DA_VOLTA FN_PRE_ANTES_DA_VOLTA
  local f="${2%|*}" g="${2#*|}"
  espera "$1" "$OBJ_SHEET" "0|0|0" "VOLTA: a frente saiu" &&
  espera "$1" "$MD5_REPLICAR" "$(md5_de "$M/md5-replicar-antes.txt")" "VOLTA: _replicar de volta ao texto de antes" &&
  espera "$1" "$FN_PRE" "$3" "VOLTA: outras funções = antes da volta" &&
  espera "$1" "$CONT" "$((f - 1))|$g" "VOLTA: contagens = antes da volta − 1 função"
}
```

- [ ] **Step 2: `.superpowers/sheet/mig/monta-aplica.sh` e o `aplica.sh` gerado**

```bash
#!/usr/bin/env bash
# Gera .superpowers/sheet/mig/aplica.sh = ATIV + espera/ativ_vazio/com_travas/aplica_v2 LITERAIS do bloco de apoio v2 da F1
# (runbook task-18-runbook-v2.md §3, extraídos por awk, hash c045cc571caf5d95 — o mesmo de Nota/SKU) + extra.sh desta frente.
set -euo pipefail
TOP="$(git rev-parse --show-toplevel)"
case "$TOP" in */.claude/worktrees/sheet-reorg) ;; *) echo "PARE: rode de dentro da worktree sheet-reorg"; exit 1;; esac
cd "$TOP"
RB="/Users/sunglee/PLM + Criação/plm-pcp/.superpowers/sdd/2026-09-22-kanban-automatico-f1-banco/task-18-runbook-v2.md"
FUN="$(awk '/^# === BLOCO DE APOIO v2 ===/{p=1} p{print} /^# === FIM DO BLOCO DE APOIO v2 ===/{p=0}' "$RB" \
  | awk '/^ATIV="/{print; next} /^(espera|ativ_vazio|com_travas|aplica_v2)\(\) *\{/{f=1} f{print} f&&/^\}$/{f=0}')"
[ "$(printf '%s\n' "$FUN" | shasum -a 256 | cut -c1-16)" = "c045cc571caf5d95" ] || { echo "PARE: o bloco de apoio v2 da F1 mudou (hash) — reler antes de usar"; exit 1; }
{
  echo '#!/usr/bin/env bash'
  echo '# GERADO por monta-aplica.sh (bloco literal da F1 + extra.sh). Não editar — editar extra.sh e regerar.'
  echo '# Uso: num BASH, de dentro da worktree: source .superpowers/sheet/mig/aplica.sh (só define coisas).'
  echo '[ -n "${BASH_VERSION:-}" ] || { echo "ERRO: use bash"; return 1 2>/dev/null || exit 1; }'
  echo 'LOCAL="postgresql://postgres:postgres@127.0.0.1:54422/postgres"'
  echo 'MIG=supabase/migrations/20261005100000_modelo_titulo_peso_ncm_preco_anterior.sql'
  echo 'INV=supabase/rollback/20261005100000_modelo_titulo_peso_ncm_preco_anterior_down.sql'
  printf '%s\n' "$FUN"
  cat .superpowers/sheet/mig/extra.sh
} > .superpowers/sheet/mig/aplica.sh
bash -n .superpowers/sheet/mig/aplica.sh && echo "aplica.sh gerado (bloco F1 c045cc571caf5d95 + extra.sh)"
```

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/sheet-reorg"
chmod +x .superpowers/sheet/mig/monta-aplica.sh && bash .superpowers/sheet/mig/monta-aplica.sh
bash -c 'source .superpowers/sheet/mig/aplica.sh && type espera ativ_vazio com_travas aplica_v2 prevoo_sheet confere_ida_sheet confere_volta_sheet confere_cadeia_ref > /dev/null && echo definidas'
```

Expected: `aplica.sh gerado …` e `definidas`.

- [ ] **Step 3: `.superpowers/sheet/copia.sh` (ida/volta na CÓPIA — usada na Task 10 junto com o merge)**

```bash
#!/usr/bin/env bash
# Reorganização do Sheet na CÓPIA LOCAL (127.0.0.1:54422). NUNCA produção. Uso (de dentro da worktree):
#   SHEET_DONO_AVISADO=sim bash .superpowers/sheet/copia.sh ida|volta
# ida: backup pg_dump -Fc da cópia → aplica_v2 → conferência por objetos. volta: backup → inverso (confirmação) → conferência
# por DIFERENÇA (CONT/FN_PRE lidos NA HORA — a cópia é compartilhada com outras frentes).
set -uo pipefail
TOP="$(git rev-parse --show-toplevel)" || exit 1
case "$TOP" in */.claude/worktrees/sheet-reorg) ;; *) echo "PARE: rode de dentro da worktree sheet-reorg"; exit 1;; esac
cd "$TOP"
source .superpowers/sheet/mig/aplica.sh || exit 1
REG=.superpowers/sheet/copia-estado.md
case "${1:-}" in ida|volta) ;; *) echo "uso: copia.sh ida|volta"; exit 2;; esac
echo "== CÓPIA · alvo: 127.0.0.1:54422 · HEAD $(git rev-parse --short HEAD) · $1"
bash .superpowers/sheet/n3.sh antes "copia-$1" || exit 1
EST=$(psql "$LOCAL" -X -q -A -t -v ON_ERROR_STOP=1 -c "$OBJ_SHEET") || exit 1
ANTES=$(psql "$LOCAL" -X -q -A -t -v ON_ERROR_STOP=1 -c "$CONT") || exit 1
FN0=$(psql "$LOCAL" -X -q -A -t -v ON_ERROR_STOP=1 -c "$FN_PRE") || exit 1
echo "antes: funções|gatilhos = $ANTES · objetos desta frente = $EST"
if [ "$1" = ida ]; then
  [ "$EST" = "0|0|0" ] || { echo "a cópia JÁ tem a frente ($EST) — nada a fazer"; bash .superpowers/sheet/n3.sh depois "copia-$1"; exit 0; }
  espera "$LOCAL" "$MD5_REPLICAR" "$(md5_de "$M/md5-replicar-antes.txt")" "_replicar no texto que a guarda espera" || exit 1
  confere_arquivos_sheet || exit 1
  backup_copia ida || exit 1
  ativ_vazio "$LOCAL" && aplica_v2 "$LOCAL" "$MIG" && confere_ida_sheet "$LOCAL" "$ANTES" "$FN0" || exit 1
else
  [ "$EST" = "1|7|4" ] || { echo "a cópia NÃO tem a frente inteira ($EST) — PARE e avise o controlador"; exit 1; }
  backup_copia volta || exit 1
  ativ_vazio "$LOCAL" && EXTRA_SQL="SET LOCAL app.confirmo_apagar_campos_sheet = 'sim';" aplica_v2 "$LOCAL" "$INV" \
    && confere_volta_sheet "$LOCAL" "$ANTES" "$FN0" || exit 1
fi
psql "$LOCAL" -X -q -c "NOTIFY pgrst, 'reload schema'"
DEPOIS=$(psql "$LOCAL" -X -q -A -t -c "$CONT")
printf -- '- %s  %s  %s → %s\n' "$(date '+%F %T')" "$1" "$ANTES" "$DEPOIS" >> "$REG"
bash .superpowers/sheet/n3.sh depois "copia-$1"
echo "== CÓPIA: $1 OK ($ANTES → $DEPOIS)"
```

- [ ] **Step 4: `.superpowers/sheet/mig/ensaio-local.sh` (ENSAIO GERAL — termina com a cópia LIMPA)**

```bash
#!/usr/bin/env bash
# ENSAIO GERAL da reorganização do Sheet na CÓPIA LOCAL (Task 7): N3 → backup → suítes VIZINHAS antes → IDA real (aplica_v2)
# → objetos/md5/ACL/outras funções/contagens → suíte desta frente com a migration APLICADA → vizinhas depois (nenhuma falha
# nova, mesmo total) → VOLTA → REIDA → VOLTA. Termina com a cópia SEM a frente, igual a antes, e grava o md5 dos 2 SQL
# ENSAIADOS (o pré-voo de produção exige esses md5). Uso (de dentro da worktree, SÓ depois do OK do dono no chat):
#   SHEET_DONO_AVISADO=sim /bin/bash .superpowers/sheet/mig/ensaio-local.sh 2>&1 | tee .superpowers/sheet/logs/ensaio.log
set -uo pipefail
TOP="$(git rev-parse --show-toplevel)" || exit 1
case "$TOP" in */.claude/worktrees/sheet-reorg) ;; *) echo "PARE: rode de dentro da worktree sheet-reorg"; exit 1;; esac
cd "$TOP"
source .superpowers/sheet/mig/aplica.sh || exit 1
S=.superpowers/sheet
echo "== ENSAIO · alvo: 127.0.0.1:54422 (cópia) · HEAD $(git rev-parse --short HEAD)"
bash "$S/n3.sh" antes t7 || exit 1
git diff --quiet HEAD -- "$MIG" "$INV" || { echo "PARE: SQL com alteração não commitada"; exit 1; }
espera "$LOCAL" "$OBJ_SHEET" "0|0|0" "cópia SEM a frente" || exit 1
espera "$LOCAL" "$MD5_REPLICAR" "$(md5_de "$M/md5-replicar-antes.txt")" "_replicar no texto que a guarda espera" || exit 1
confere_arquivos_sheet || exit 1
ativ_vazio "$LOCAL" || exit 1
CONT0="$(psql "$LOCAL" -X -A -t -c "$CONT")"; FN0="$(psql "$LOCAL" -X -A -t -c "$FN_PRE")"
echo "antes: contagens $CONT0 · outras funções $FN0" | tee "$S/logs/ensaio-antes.txt"
backup_copia ensaio || exit 1
# Suítes VIZINHAS (tocam `modelos`, o Replicar e as seções do Sheet) ANTES e DEPOIS da ida REAL: as falhas depois ⊆ as de
# antes (débito herdado) e o mesmo total. SEMPRE com o DATABASE_URL da CÓPIA (sem ele o fallback é PRODUÇÃO).
VIZ="tests/integration/modelo-descricao-produto.test.ts tests/integration/plan-tecido.test.ts tests/integration/plan-tecido-aplicar.test.ts tests/integration/sku-automatico.test.ts tests/integration/colab-trava.test.ts tests/integration/kanban-condicoes.test.ts tests/integration/mo-por-servico.test.ts tests/integration/ref-exibir.test.ts"
falhas() { grep -E "^ FAIL " "$1" | sed -E 's/ +[0-9]+ms$//' | sort -u; }
total() { grep -E "^ +Tests +" "$1" | tail -1 | sed -E 's/.*\(([0-9]+)\).*/\1/'; }
viz() {
  # shellcheck disable=SC2086 — a lista é LITERAL (sem glob), separada por espaço de propósito
  DATABASE_URL="$LOCAL" npx vitest run --no-file-parallelism $VIZ > "$S/logs/viz-$1.log" 2>&1
  falhas "$S/logs/viz-$1.log" > "$S/logs/viz-falhas-$1.txt"
  echo "VIZINHAS $1: $(grep -E '^ +Tests +' "$S/logs/viz-$1.log" | tail -1 | sed 's/^ *//') · $(wc -l < "$S/logs/viz-falhas-$1.txt" | tr -d ' ') falha(s)"
}
volta() {
  local cv fv
  cv="$(psql "$LOCAL" -X -A -t -c "$CONT")"; fv="$(psql "$LOCAL" -X -A -t -c "$FN_PRE")"
  ativ_vazio "$LOCAL" && EXTRA_SQL="SET LOCAL app.confirmo_apagar_campos_sheet = 'sim';" aplica_v2 "$LOCAL" "$INV" \
    && confere_volta_sheet "$LOCAL" "$cv" "$fv"
}
viz antes
aplica_v2 "$LOCAL" "$MIG" || exit 1
confere_ida_sheet "$LOCAL" "$CONT0" "$FN0" || { volta; exit 1; }
DATABASE_URL="$LOCAL" npx vitest run --no-file-parallelism tests/integration/sheet-reorg-campos.test.ts > "$S/logs/ensaio-suite.log" 2>&1
tail -6 "$S/logs/ensaio-suite.log"
grep -qE "Tests +13 passed \(19\)|Tests +13 passed \| 6 skipped" "$S/logs/ensaio-suite.log" && ! grep -qE "[0-9]+ failed" "$S/logs/ensaio-suite.log" \
  || { echo "FALHOU: com a migration aplicada a suíte tem de dar 13 passed (6 estáticos + 7 de banco) | 6 skipped (os do 'antes', só em SHEET_MIG_TXN=1)"; volta; exit 1; }
viz depois
NOVAS="$(comm -13 "$S/logs/viz-falhas-antes.txt" "$S/logs/viz-falhas-depois.txt")"
TA="$(total "$S/logs/viz-antes.log")"; TD="$(total "$S/logs/viz-depois.log")"
if [ -z "$NOVAS" ] && [ -n "$TA" ] && [ "$TA" = "$TD" ]; then
  echo "OK (vizinhas): nenhuma falha nova ($(wc -l < "$S/logs/viz-falhas-antes.txt" | tr -d ' ') herdada(s)); $TA testes antes e depois"
else
  [ -n "$NOVAS" ] && echo "$NOVAS" | sed 's/^/FALHA NOVA: /'
  echo "FALHOU (vizinhas): falha nova ou total diferente (antes $TA, depois $TD)"; volta; exit 1
fi
volta || exit 1
espera "$LOCAL" "$CONT" "$CONT0" "VOLTA: contagens = antes do ensaio" && espera "$LOCAL" "$FN_PRE" "$FN0" "VOLTA: outras funções = antes do ensaio" || exit 1
aplica_v2 "$LOCAL" "$MIG" && confere_ida_sheet "$LOCAL" "$CONT0" "$FN0" || { volta; exit 1; }
volta || exit 1
espera "$LOCAL" "$OBJ_SHEET" "0|0|0" "VOLTA 2: cópia limpa" && espera "$LOCAL" "$CONT" "$CONT0" "VOLTA 2: contagens" \
  && espera "$LOCAL" "$FN_PRE" "$FN0" "VOLTA 2: outras funções" || exit 1
md5_arquivo "$MIG" > "$M/md5-mig.txt"; md5_arquivo "$INV" > "$M/md5-inv.txt"
bash "$S/n3.sh" depois t7
echo "== ENSAIO OK — cópia limpa ($CONT0); md5 migration $(cat "$M/md5-mig.txt") · inverso $(cat "$M/md5-inv.txt")"
```

> Nota sobre a contagem da suíte no modo "aplicada": 6 estáticos + 7 de banco que não dependem do "antes" = **13 passed** e os 6 `it.skipIf(!MIG_TXN)` = **6 skipped** (total 19). O vitest imprime `Tests  13 passed | 6 skipped (19)` — o `grep` aceita as duas formas; se o formato da linha for outro, conferir à mão e ajustar SÓ o `grep` (registrar em `desvios.md`).

- [ ] **Step 5: `.superpowers/sheet/mig/ida-producao.sh` (roda o DONO)**

```bash
#!/usr/bin/env bash
# IDA em PRODUÇÃO da reorganização do Sheet (Parte B — migration 20261005100000). Quem roda é o DONO, num Terminal NOVO:
#   cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/sheet-reorg"
#   bash .superpowers/sheet/mig/ida-producao.sh 2>&1 | tee -a .superpowers/sheet/logs/prod-ida.log
# Ordem: guarda de URL (antes de qualquer psql) → pasta 700 → estado/contagens/outras funções/retrato lidos NA HORA → pré-voo
# SÓ LEITURA (F1, Nota, SKU e Nota SEM trava no banco; esta frente ausente; _replicar no texto que a guarda espera; md5 dos
# SQL = o ensaiado; travas no arquivo; cadeia da volta da F1 íntegra; sem transação longa) → BACKUP public + auth → apply pelo
# aplica_v2 → pós-condições → contagens depois → reload do PostgREST → "IDA OK". Nunca registra em schema_migrations.
set -uo pipefail
umask 077
unset EXTRA_SQL   # o aplica_v2 injeta "${EXTRA_SQL:-}" na transação: nada de sobra de outro runbook na IDA
TOP="$(git rev-parse --show-toplevel)" || exit 1
case "$TOP" in */.claude/worktrees/sheet-reorg) ;; *) echo "PARE: rode de dentro da worktree sheet-reorg (achei $TOP)"; exit 1;; esac
cd "$TOP"
source .superpowers/sheet/mig/aplica.sh || exit 1
confere_url_producao || exit 1
mkdir -p .superpowers/sheet/logs "$DS" && chmod 700 "$DS" || { echo "PARE: não criei $DS (700)"; exit 1; }
PROD="$(cat "$DBURL_FILE")"
echo "== IDA da reorganização do Sheet em PRODUÇÃO $(date '+%F %T') · HEAD $(git rev-parse --short HEAD) · alvo: produção (URL de $DBURL_FILE)"
EST=$(psql "$PROD" -X -q -A -t -v ON_ERROR_STOP=1 -c "$OBJ_SHEET") || { echo "FALHOU: não conectou em produção"; exit 1; }
[ "$EST" = "0|0|0" ] || { echo "PARE: objetos desta frente JÁ no banco ($EST) — ida anterior? avisar o controlador (nada foi feito)"; exit 1; }
CONT_ANTES=$(psql "$PROD" -X -q -A -t -v ON_ERROR_STOP=1 -c "$CONT") || exit 1
FN_ANTES=$(psql "$PROD" -X -q -A -t -v ON_ERROR_STOP=1 -c "$FN_PRE") || exit 1
echo "$CONT_ANTES" > "$DS/cont-antes-sheet.txt"; echo "$FN_ANTES" > "$DS/fn-pre-antes-sheet.txt"
echo "contagens antes (funções|gatilhos): $CONT_ANTES"
retrato_producao "$PROD" "$DS/fidelidade_prod_pre_sheet_detalhe.txt" || exit 1
prevoo_sheet "$PROD" "$DS/fidelidade_prod_pre_sheet_detalhe.txt" || { echo "== PAROU no pré-voo — nada foi aplicado"; exit 1; }
backup_banco "$PROD" "$DS" producao-pre-sheet || { echo "== PAROU no backup — nada foi aplicado"; exit 1; }
ativ_vazio "$PROD" && espera "$PROD" "$OBJ_SHEET" "0|0|0" "ainda ausente logo antes do apply" && aplica_v2 "$PROD" "$MIG" \
  || { echo "== IDA NÃO CONCLUÍDA (erro no apply = nada do arquivo ficou) — avisar o controlador"; exit 1; }
confere_ida_sheet "$PROD" "$CONT_ANTES" "$FN_ANTES" \
  || { echo "== CONFERÊNCIA FALHOU — avisar o controlador (NÃO rodar o inverso sem OK do dono)"; exit 1; }
psql "$PROD" -X -q -A -t -v ON_ERROR_STOP=1 -c "$CONT" > "$DS/cont-depois-sheet.txt" || exit 1
psql "$PROD" -X -q -v ON_ERROR_STOP=1 -c "NOTIFY pgrst, 'reload schema'" \
  || { echo "== APLICADA, mas o reload do PostgREST falhou — rodar NOTIFY pgrst, 'reload schema' e avisar o controlador"; exit 1; }
echo "== IDA OK $(date '+%T') — contagens $CONT_ANTES → $(cat "$DS/cont-depois-sheet.txt"). Agora o passo 3 do RODAR (ref-volta-f1.sh)."
```

- [ ] **Step 6: `.superpowers/sheet/mig/volta-producao.sh` (emergência — roda o DONO, com OK explícito)**

```bash
#!/usr/bin/env bash
# VOLTA em PRODUÇÃO — SÓ em emergência, com OK explícito do dono, DEPOIS do revert do front NO AR e das abas recarregadas
# (inclusive o :5173). APAGA Título/Peso/medidas/NCM/Preço anterior digitados (EXPORTA antes). O DONO roda:
#   cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/sheet-reorg"
#   bash .superpowers/sheet/mig/volta-producao.sh 2>&1 | tee -a .superpowers/sheet/logs/prod-volta.log
set -uo pipefail
umask 077
unset EXTRA_SQL   # a confirmação é passada INLINE só no apply do inverso
TOP="$(git rev-parse --show-toplevel)" || exit 1
case "$TOP" in */.claude/worktrees/sheet-reorg) ;; *) echo "PARE: rode de dentro da worktree sheet-reorg (achei $TOP)"; exit 1;; esac
cd "$TOP"
source .superpowers/sheet/mig/aplica.sh || exit 1
confere_url_producao || exit 1
PROD="$(cat "$DBURL_FILE")"
echo "== VOLTA da reorganização do Sheet em PRODUÇÃO $(date '+%F %T') · HEAD $(git rev-parse --short HEAD)"
EST=$(psql "$PROD" -X -q -A -t -v ON_ERROR_STOP=1 -c "$OBJ_SHEET") || { echo "FALHOU: não conectou em produção"; exit 1; }
[ "$EST" = "1|7|4" ] || { echo "PARE: a frente não está inteira em produção ($EST) — avisar o controlador"; exit 1; }
N=$(psql "$PROD" -X -q -A -t -v ON_ERROR_STOP=1 -c "$DADOS_SHEET") || exit 1
printf 'Isto APAGA Título para a página, Peso/medidas, NCM e Preço anterior de %s modelo(s) (o export vem antes). Digite APAGAR OS CAMPOS NOVOS para seguir: ' "$N"
IFS= read -r RESP < /dev/tty || RESP=""
[ "$RESP" = "APAGAR OS CAMPOS NOVOS" ] || { echo "cancelado — nada foi feito"; exit 1; }
V="$DS/volta-$(date +%F-%H%M%S)"; mkdir -p "$V" && chmod 700 "$V" || exit 1
psql "$PROD" -X -q -v ON_ERROR_STOP=1 -c "\copy (SELECT id, tenant_id, nome, ref, titulo_pagina, peso_kg, comprimento_cm, largura_cm, altura_cm, ncm, preco_anterior FROM public.modelos WHERE $TEM_DADO_SHEET ORDER BY tenant_id, nome) TO '$V/modelos_campos_novos.csv' CSV HEADER" \
  || { echo "FALHOU o export — PARE (nada foi desfeito)"; exit 1; }
chmod 600 "$V"/*.csv 2>/dev/null
echo "export: $V"
backup_banco "$PROD" "$DS" producao-pre-volta-sheet || { echo "== PAROU no backup — nada foi desfeito"; exit 1; }
CONT_ANTES_VOLTA=$(psql "$PROD" -X -q -A -t -v ON_ERROR_STOP=1 -c "$CONT") || exit 1
FN_ANTES_VOLTA=$(psql "$PROD" -X -q -A -t -v ON_ERROR_STOP=1 -c "$FN_PRE") || exit 1
echo "contagens imediatamente antes da volta: $CONT_ANTES_VOLTA"
ativ_vazio "$PROD" && EXTRA_SQL="SET LOCAL app.confirmo_apagar_campos_sheet = 'sim';" aplica_v2 "$PROD" "$INV" \
  && confere_volta_sheet "$PROD" "$CONT_ANTES_VOLTA" "$FN_ANTES_VOLTA" \
  && psql "$PROD" -X -q -c "NOTIFY pgrst, 'reload schema'" \
  && echo "== VOLTA OK $(date '+%T') — a referência 'pos_sheet' da volta da F1 deixou de valer: ver $DS/LEIA-volta-f1-pos-sheet.txt" \
  || { echo "== VOLTA NÃO CONCLUÍDA — avisar o controlador/dono (conferir até onde chegou: ATIV, inverso, conferência, NOTIFY)"; exit 1; }
```

- [ ] **Step 7: `.superpowers/sheet/mig/ref-volta-f1.sh` (referência nova da volta de emergência da F1 — roda o DONO, SÓ LEITURA)**

```bash
#!/usr/bin/env bash
# F3.6 (Parte B) — REGRAVA a referência de fidelidade da VOLTA DE EMERGÊNCIA da F1 logo DEPOIS do "== IDA OK" desta frente.
# A volta da F1 (runbook v2 §9.2) compara TODO o public com uma referência + um CONT; cada frente posterior à F1 grava a
# sua (com_f31 → pos_nota → pos_f35a → …). Esta NÃO crava o nome da anterior (R22): usa a MAIS NOVA por mtime em $BF1 e,
# ANTES de gravar, prova que (1) desde o pré-voo SÓ esta frente mudou o schema, (2) a referência mais nova bate com a
# produção FORA das chaves da F1 e desta frente (senão alguma frente ficou sem referência ⇒ PARE), (3) a F1 e esta frente
# não mexem nas mesmas chaves. Referência nova = a mais nova SEM as 9 chaves desta frente + as linhas ATUAIS delas; CONT
# da volta = nº de linhas funcoes:|gatilhos: da nova, conferido com base + delta medido pelo ida-producao.sh.
# SÓ LEITURA no banco. Roda o DONO:  /bin/bash --noprofile --norc .superpowers/sheet/mig/ref-volta-f1.sh
set -uo pipefail
umask 077
TOP="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)" || exit 1
case "$TOP" in */.claude/worktrees/sheet-reorg) ;; *) echo "PARE: script fora da worktree sheet-reorg"; exit 1;; esac
cd "$TOP"
source .superpowers/sheet/mig/aplica.sh || exit 1
confere_url_producao || exit 1
RB="${SHEET_RB:-/Users/sunglee/PLM + Criação/plm-pcp/.superpowers/sdd/2026-09-22-kanban-automatico-f1-banco}"
PROD="$(cat "$DBURL_FILE")"
REF_NOVA="$BF1/fidelidade_ref_volta_f1_pos_sheet_detalhe.txt"
echo "== referência da volta da F1 (pós-Sheet) $(date '+%F %T') · HEAD $(git rev-parse --short HEAD)"
[ ! -e "$REF_NOVA" ] || { echo "PARE: $REF_NOVA já existe — rodou 2×? avisar o controlador"; exit 1; }
q() { PGOPTIONS='-c default_transaction_read_only=on' psql "$PROD" -X -q -A -t -v ON_ERROR_STOP=1 -c "$1"; }
[ "$(q "$F1_OK")" = t ] || { echo "PARE: a F1 não está em produção — não há volta da F1 a referenciar"; exit 1; }
[ "$(q "$OBJ_SHEET")" = "1|7|4" ] || { echo "PARE: esta frente não está (inteira) em produção — rode DEPOIS do '== IDA OK'"; exit 1; }
for f in cont-antes-sheet.txt cont-depois-sheet.txt fidelidade_prod_pre_sheet_detalhe.txt; do
  [ -s "$DS/$f" ] || { echo "PARE: falta $DS/$f (gravado pelo ida-producao.sh)"; exit 1; }
done
R=$(ref_mais_nova) || exit 1
echo "base = referência mais nova: $(basename "$R")"
if awk -F'=' -v pat="$PAT_SHEET" '$1 ~ pat { print $1 }' "$R" | grep -qE '_titulo_pagina_calculado|[.](titulo_pagina|peso_kg|comprimento_cm|largura_cm|altura_cm|ncm|preco_anterior)$'; then
  echo "PARE: a base já tem objetos desta frente — ordem trocada ou rodou 2×"; exit 1
fi
POS="$DS/fidelidade_prod_pos_sheet_detalhe.txt"
retrato_producao "$PROD" "$POS" || exit 1
# (1) desde o retrato do pré-voo, SÓ esta frente mudou o schema
OUTRAS=$(diff <(awk -F'=' -v pat="$PAT_SHEET" '!($1 ~ pat)' "$DS/fidelidade_prod_pre_sheet_detalhe.txt" | LC_ALL=C sort) \
              <(awk -F'=' -v pat="$PAT_SHEET" '!($1 ~ pat)' "$POS" | LC_ALL=C sort) | grep -E '^[<>]' || true)
[ -z "$OUTRAS" ] || { printf '%s\n' "$OUTRAS" | cut -c1-160 | head -20; echo "PARE: desde o pré-voo o schema mudou FORA desta frente — avisar o controlador"; exit 1; }
# (2) a referência mais nova bate com a produção fora da F1 e desta frente
confere_cadeia_ref "$POS" || exit 1
# (3) a F1 não mexe nas chaves desta frente (a volta da F1 as reverteria)
KF1="$(mktemp -t sheet-kf1.XXXXXX)"; chaves_f1 "$KF1" || { rm -f "$KF1"; exit 1; }
CRUZ=$(grep -E "$PAT_SHEET" "$KF1" || true); rm -f "$KF1"
[ -z "$CRUZ" ] || { echo "$CRUZ"; echo "PARE: chaves desta frente também mudadas pela F1 — avisar o controlador"; exit 1; }
# (4) referência nova
N=$(awk -F'=' -v pat="$PAT_SHEET" '$1 ~ pat' "$POS" | grep -c .)
[ "$N" = 9 ] || { echo "PARE: esperava 9 linhas desta frente no retrato (7 colunas + 2 funções), achei $N"; exit 1; }
{ awk -F'=' -v pat="$PAT_SHEET" '!($1 ~ pat)' "$R"; awk -F'=' -v pat="$PAT_SHEET" '$1 ~ pat' "$POS"; } | LC_ALL=C sort > "$REF_NOVA"
# (5) CONT da volta = funções|gatilhos da referência nova = base + delta MEDIDO desta frente
CR="$(grep -c '^funcoes:' "$R")|$(grep -c '^gatilhos:' "$R")"
SUF=$(basename "$R" _detalhe.txt); SUF=${SUF#fidelidade_ref_volta_f1_}
if [ -s "$BF1/cont_volta_f1_${SUF}.txt" ] && [ "$(tr -d '[:space:]' < "$BF1/cont_volta_f1_${SUF}.txt")" != "$CR" ]; then
  rm -f "$REF_NOVA"; echo "PARE: cont_volta_f1_${SUF}.txt ≠ contagem da própria referência ($CR) — avisar o controlador"; exit 1
fi
A=$(tr -d '[:space:]' < "$DS/cont-antes-sheet.txt"); P=$(tr -d '[:space:]' < "$DS/cont-depois-sheet.txt")
ESP="$(( ${CR%|*} + ${P%|*} - ${A%|*} ))|$(( ${CR#*|} + ${P#*|} - ${A#*|} ))"
CV="$(grep -c '^funcoes:' "$REF_NOVA")|$(grep -c '^gatilhos:' "$REF_NOVA")"
[ "$CV" = "$ESP" ] || { rm -f "$REF_NOVA"; echo "PARE: CONT da referência nova ($CV) ≠ base ($CR) + delta medido ($A → $P) = $ESP"; exit 1; }
echo "$CV" > "$BF1/cont_volta_f1_pos_sheet.txt"
{
  echo "# Volta de emergência da F1 DEPOIS da reorganização do Sheet (20261005100000) — $(date '+%F %T')"
  echo "# Base: $(basename "$R") (a mais nova quando esta rodou). No runbook v2 §9.2 trocar as 2 conferências finais por:"
  echo "espera \"\$PROD\" \"\$CONT\" \"$CV\" \"contagens pós-volta (com as frentes até o Sheet)\" &&"
  echo "fidelidade \"\$PROD\" \"\$D/fidelidade_prod_pos_volta.txt\" \"\$D/fidelidade_prod_pos_volta_detalhe.txt\" > /dev/null &&"
  echo "diff \"\$D/fidelidade_ref_volta_f1_pos_sheet_detalhe.txt\" <(LC_ALL=C sort \"\$D/fidelidade_prod_pos_volta_detalhe.txt\") && echo \"== VOLTA OK (com o Sheet)\""
  echo "# Encadeamento: a PRÓXIMA frente usa ESTA referência como base (é a mais nova por mtime)."
  echo "# Se esta frente for DESFEITA (volta-producao.sh), apagar/renomear fidelidade_ref_volta_f1_pos_sheet_detalhe.txt e"
  echo "# cont_volta_f1_pos_sheet.txt: a referência volta a ser $(basename "$R")."
} | tee "$DS/LEIA-volta-f1-pos-sheet.txt" > "$RB/VOLTA-F1-POS-SHEET.md"
echo "OK (referência nova p/ a volta da F1): $REF_NOVA — base $(basename "$R") sem as 9 chaves desta frente + as atuais; CONT esperado da volta: $CV"
```

- [ ] **Step 8: `.superpowers/sheet/mig/prova-scripts.sh` — provas SEM banco nenhum**

```bash
#!/usr/bin/env bash
# Provas dos scripts de PRODUÇÃO desta frente SEM tocar em banco: `psql` e `docker` FALSOS no PATH (nunca conectam), URL
# sintética (host prova.invalid…) num arquivo do scratch, DS/BF1/RB no scratch. NUNCA o /tmp/dburl.txt real, NUNCA host real
# (nem com senha falsa). Uso (de dentro da worktree): bash .superpowers/sheet/mig/prova-scripts.sh
set -uo pipefail
TOP="$(git rev-parse --show-toplevel)" || exit 1
case "$TOP" in */.claude/worktrees/sheet-reorg) ;; *) echo "PARE: rode de dentro da worktree sheet-reorg"; exit 1;; esac
cd "$TOP"
M=.superpowers/sheet/mig
BF1_REAL="/Users/sunglee/PLM + Criação/savepoints/pre-apply-f1-kanban-auto"
SKU_REAL="/Users/sunglee/PLM + Criação/savepoints/pre-apply-f35a-sku"
SC="$(mktemp -d -t sheet-prova.XXXXXX)"; export SHEET_PROVA_SC="$SC"
trap 'rm -rf "$SC"' EXIT      # apaga SÓ o scratch que ela mesma criou
FB="$SC/bin"; mkdir -p "$FB" "$SC/ds" "$SC/bf1" "$SC/rb"
ls -l "$BF1_REAL" > "$SC/bf1-real-antes.txt"
FALHAS=0; ok() { echo "OK (prova): $1"; }; ruim() { echo "FALHOU (prova): $1"; FALHAS=$((FALHAS + 1)); }

# 1) a guarda de URL (regex ANCORADA) com URLs sintéticas
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
recusa|postgresql://postgres:x@db.outroref.supabase.co:5432/postgres
URLS

# 2) fakes
cat > "$FB/psql" <<'FAKE'
#!/usr/bin/env bash
# psql FALSO: nunca conecta; responde pelo TEXTO da consulta; registra cada chamada.
SC="${SHEET_PROVA_SC:?}"; sql=""; saida=""
while [ $# -gt 0 ]; do case "$1" in -c) sql="$2"; shift 2;; -o) saida="$2"; shift 2;; *) shift;; esac; done
printf '%s\n' "$(printf '%s' "$sql" | tr '\n' ' ' | cut -c1-140)" >> "$SC/psql.log"
est="$(cat "$SC/estado")"
r() { if [ -n "$saida" ]; then printf '%s\n' "$1" > "$saida"; else printf '%s\n' "$1"; fi; }
case "$sql" in
  *"ALTER TABLE public.modelos"*) echo depois > "$SC/estado"; exit 0;;
  *"NOTIFY pgrst"*) exit 0;;
  *"SELECT cat || ':' || k || '=' || v"*) cat "$SC/retrato-$est.txt"; exit 0;;
  *"pg_stat_activity"*) r 0;;
  *"server_version_num"*) r t;;
  *"kanban_mover"*) r t;;
  *"fn_oc_nota_entrada_recalc"*) r t;;
  *"to_regclass('public.modelo_skus')"*) r t;;
  *"NEW.data_nota_entrada < NEW.data_pedido"*) r "${FAKE_SEM_TRAVA:-t}";;
  *"modelos_peso_kg_nao_negativo"*) if [ "$est" = antes ]; then r "${FAKE_OBJ_ANTES:-0|0|0}"; else r "1|7|4"; fi;;
  *"md5(pg_get_functiondef('public._replicar"*) if [ "$est" = antes ]; then r "$(cat "$SC/md5-antes")"; else r "$(cat "$SC/md5-depois")"; fi;;
  *"has_function_privilege"*) r "0|0|1";;
  *"string_agg(p.oid::regprocedure::text"*) r "fnpre-prova|480";;
  *"length(btrim(coalesce(titulo_pagina"*) r 3;;
  *"from pg_trigger t join pg_class c"*) if [ "$est" = antes ]; then r "483|277"; else r "484|277"; fi;;
  *) echo "psql falso: consulta não prevista: $(printf '%s' "$sql" | cut -c1-100)" >&2; exit 3;;
esac
FAKE
cat > "$FB/docker" <<'FAKE'
#!/usr/bin/env bash
# docker FALSO: ps devolve o container; exec pg_dump "escreve" um dump; exec pg_restore -l lista TABLE DATA de public e auth.
SC="${SHEET_PROVA_SC:?}"; echo "docker $*" | cut -c1-140 >> "$SC/docker.log"
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
export SHEET_DBURL_FILE="$SC/url.txt" SHEET_DS="$SC/ds" SHEET_BF1="$SC/bf1" SHEET_RB="$SC/rb"
printf '%s\n' "postgresql://postgres.ruinwcuabilumcspeyjk@prova.invalid.pooler.supabase.com:6543/postgres" > "$SC/url.txt"
tr -d '[:space:]' < "$M/md5-replicar-antes.txt" > "$SC/md5-antes"; tr -d '[:space:]' < "$M/md5-replicar-depois.txt" > "$SC/md5-depois"
# retratos: F1 (pré/pós) e a referência pos_f35a REAIS (cópias, só leitura); produção "antes" = o retrato real pós-SKU;
# "depois" = o mesmo com _replicar trocada + a função do título + as 7 colunas.
cp "$BF1_REAL/fidelidade_prod_pre_detalhe.txt" "$BF1_REAL/fidelidade_prod_pos_detalhe.txt" "$BF1_REAL/bloco_apoio_v2.sh" "$SC/bf1/"
cp "$BF1_REAL/fidelidade_ref_volta_f1_pos_f35a_detalhe.txt" "$BF1_REAL/cont_volta_f1_pos_f35a.txt" "$SC/bf1/"
cp "$SKU_REAL/fidelidade_prod_pos_f35a_detalhe.txt" "$SC/retrato-antes.txt"
{ awk -F'=' '$1 != "funcoes:public._replicar_cards_plan_tecido_core(uuid,uuid,uuid,uuid[],integer)"' "$SC/retrato-antes.txt"
  cat <<'L'
funcoes:public._replicar_cards_plan_tecido_core(uuid,uuid,uuid,uuid[],integer)=prova-md5-novo|t|search_path=public|f|f|t|f
funcoes:public._titulo_pagina_calculado(text,text)=prova-md5-titulo|f|search_path=public|f|f|t|f
colunas:public.modelos.titulo_pagina=r|text|f|-||
colunas:public.modelos.peso_kg=r|numeric(10,3)|f|-||
colunas:public.modelos.comprimento_cm=r|numeric(10,2)|f|-||
colunas:public.modelos.largura_cm=r|numeric(10,2)|f|-||
colunas:public.modelos.altura_cm=r|numeric(10,2)|f|-||
colunas:public.modelos.ncm=r|text|f|-||
colunas:public.modelos.preco_anterior=r|numeric(12,2)|f|-||
L
} > "$SC/retrato-depois.txt"
roda() { : > "$SC/psql.log"; : > "$SC/docker.log"; bash "$@" > "$SC/out.txt" 2>&1; echo $? > "$SC/rc"; }

# 3) caminho feliz: ida → "IDA OK" (backup antes do apply) → ref-volta-f1 → CONT 453|233
echo antes > "$SC/estado"; roda "$M/ida-producao.sh"
grep -q "== IDA OK" "$SC/out.txt" && ok "ida: IDA OK" || { tail -15 "$SC/out.txt"; ruim "ida sem IDA OK"; }
[ "$(grep -n 'pg_dump' "$SC/docker.log" | head -1 | cut -d: -f1)" != "" ] && ok "ida: backup (public+auth) rodou" || ruim "ida sem backup"
grep -q "ALTER TABLE public.modelos" "$SC/psql.log" && ok "ida: apply rodou" || ruim "ida sem apply"
roda "$M/ref-volta-f1.sh"
grep -q "CONT esperado da volta: 453|233" "$SC/out.txt" && ok "ref-volta-f1: 452|233 + 1|0 = 453|233" || { tail -15 "$SC/out.txt"; ruim "ref-volta-f1"; }
[ "$(wc -l < "$SC/bf1/fidelidade_ref_volta_f1_pos_sheet_detalhe.txt")" = "$(( $(wc -l < "$SC/bf1/fidelidade_ref_volta_f1_pos_f35a_detalhe.txt") + 8 ))" ] \
  && ok "referência nova = base + 8 linhas (7 colunas + título; _replicar trocada)" || ruim "linhas da referência nova"
roda "$M/ref-volta-f1.sh"
grep -q "já existe — rodou 2×" "$SC/out.txt" && ok "ref-volta-f1 2× ⇒ PARE" || ruim "ref-volta-f1 2× não parou"

# 4) negativos da ida — NADA aplicado (sem ALTER no psql.log) e, antes do pré-voo, sem backup
rm -f "$SC/ds/"*.txt "$SC/bf1/fidelidade_ref_volta_f1_pos_sheet_detalhe.txt" "$SC/bf1/cont_volta_f1_pos_sheet.txt"
echo antes > "$SC/estado"; FAKE_SEM_TRAVA=f roda "$M/ida-producao.sh"
grep -q "PAROU no pré-voo" "$SC/out.txt" && ! grep -q "ALTER TABLE" "$SC/psql.log" && [ ! -s "$SC/docker.log" ] \
  && ok "Nota sem trava ausente ⇒ PARE antes do backup/apply" || ruim "ordem da Nota sem trava não barrou"
echo antes > "$SC/estado"; FAKE_OBJ_ANTES="1|7|4" roda "$M/ida-producao.sh"
grep -q "JÁ no banco" "$SC/out.txt" && ! grep -q "ALTER TABLE" "$SC/psql.log" && ok "frente já aplicada ⇒ PARE" || ruim "reaplicação não barrou"
cp "$SC/retrato-antes.txt" "$SC/retrato-antes.bak"
awk -F'=' 'BEGIN{OFS="="} $1 == "funcoes:public.fn_oc_nota_entrada_valida()" { $2 = "md5-de-outra-frente|t|search_path=public|f|f|t|f" } { print }' "$SC/retrato-antes.bak" > "$SC/retrato-antes.txt"
echo antes > "$SC/estado"; roda "$M/ida-producao.sh"
grep -q "NÃO bate com a produção" "$SC/out.txt" && ! grep -q "ALTER TABLE" "$SC/psql.log" && [ ! -s "$SC/docker.log" ] \
  && ok "cadeia da volta da F1 quebrada ⇒ PARE antes do backup/apply" || ruim "cadeia quebrada não barrou"
mv "$SC/retrato-antes.bak" "$SC/retrato-antes.txt"
printf '%s\n' "postgresql://postgres:postgres@127.0.0.1:54422/postgres" > "$SC/url.txt"
echo antes > "$SC/estado"; roda "$M/ida-producao.sh"
grep -q "não aponta p/ o banco sisTrama" "$SC/out.txt" && [ ! -s "$SC/psql.log" ] && ok "URL fora do padrão ⇒ PARE antes de qualquer psql" || ruim "guarda de URL"
printf '%s\n' "postgresql://postgres.ruinwcuabilumcspeyjk@prova.invalid.pooler.supabase.com:6543/postgres" > "$SC/url.txt"

# 5) volta sem a frase (sem tty) ⇒ cancelado, nada aplicado
echo depois > "$SC/estado"; roda "$M/volta-producao.sh" < /dev/null
grep -q "cancelado — nada foi feito" "$SC/out.txt" && ! grep -q "DROP COLUMN" "$SC/psql.log" && ok "volta sem confirmação ⇒ cancelada" || ruim "volta sem confirmação"

# 6) nada real foi tocado
ls -l "$BF1_REAL" > "$SC/bf1-real-depois.txt"
diff -q "$SC/bf1-real-antes.txt" "$SC/bf1-real-depois.txt" > /dev/null && ok "pasta REAL da F1 intocada" || ruim "a pasta real da F1 mudou!"
[ "$FALHAS" = 0 ] && echo "== PROVAS OK" || { echo "== PROVAS FALHARAM ($FALHAS)"; exit 1; }
```

- [ ] **Step 9: `RODAR-sheet-reorg.md` (roteiro do dono) — em `/Users/sunglee/PLM + Criação/savepoints/pre-apply-sheet-reorg/` (pasta 700)**

```bash
D="/Users/sunglee/PLM + Criação/savepoints/pre-apply-sheet-reorg"; mkdir -p "$D" && chmod 700 "$D"
```

Conteúdo (o controlador preenche as `sha256` no Step 11):

```markdown
# RODAR — Reorganização do Sheet (Parte B: migration 20261005100000) em PRODUÇÃO
Quem roda: o DONO, num Terminal NOVO (nada de variável SHEET_* exportada). Pasta: /Users/sunglee/PLM + Criação/savepoints/pre-apply-sheet-reorg/

## Antes
1. A Nota SEM a trava do pedido (20261004100000) JÁ foi aplicada em produção pelo roteiro dela — e, se ela grava uma
   referência nova da volta da F1, esse passo dela também já rodou (senão o pré-voo daqui PARA, de propósito).
2. O controlador avisou no chat "pode rodar o Sheet" (G-migration + G-scripts aprovados; seu OK registrado).
3. Horário calmo (a trava em `modelos` dura < 1 s, no fim).
4. Conferir os scripts: `cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/sheet-reorg" && shasum -a 256 .superpowers/sheet/mig/{aplica,ida-producao,volta-producao,ref-volta-f1}.sh | cut -c1-16`
   Tem de dar: aplica `<sha>` · ida-producao `<sha>` · volta-producao `<sha>` · ref-volta-f1 `<sha>`.

## Passo 1 — ida (o backup completo public + auth é feito DENTRO do script, antes de aplicar)
    cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/sheet-reorg"
    bash .superpowers/sheet/mig/ida-producao.sh 2>&1 | tee -a .superpowers/sheet/logs/prod-ida.log
Esperado no fim: `== IDA OK … contagens 483|277 → 484|277` (ou o antes do dia + 1 função). Qualquer PARE/FALHOU/NÃO CONCLUÍDA:
parar e mandar o log no chat. NÃO rodar a volta sem o controlador.

## Passo 2 — referência nova da volta de emergência da F1 (SÓ LEITURA)
    /bin/bash --noprofile --norc .superpowers/sheet/mig/ref-volta-f1.sh 2>&1 | tee -a .superpowers/sheet/logs/prod-ref-volta-f1.log
Esperado: `OK (referência nova p/ a volta da F1): … CONT esperado da volta: <N|M>`.

## Passo 3 — avisar no chat: "Sheet: IDA OK e referência OK"
(o controlador faz o merge + a cópia na mesma hora, a QA no :5173 e só então pede o deploy)

## Volta de emergência (SÓ com o seu OK explícito)
1. Primeiro o FRONT: revert na branch principal + deploy do revert NO AR + recarregar as abas (inclusive o :5173).
2. Depois: `bash .superpowers/sheet/mig/volta-producao.sh 2>&1 | tee -a .superpowers/sheet/logs/prod-volta.log`
   (pede para digitar APAGAR OS CAMPOS NOVOS; exporta os 7 campos antes; ao fim a referência da volta da F1 volta a ser a
   anterior — ver LEIA-volta-f1-pos-sheet.txt).
```

- [ ] **Step 10: N3 + ENSAIO na cópia**

Pré-condição: G-migration (Task 6 Step 7) APROVADO (o md5 gravado no fim do ensaio é o do SQL revisado). Com o OK do dono:

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/sheet-reorg"
chmod +x .superpowers/sheet/copia.sh .superpowers/sheet/mig/*.sh
SHEET_DONO_AVISADO=sim /bin/bash .superpowers/sheet/mig/ensaio-local.sh 2>&1 | tee .superpowers/sheet/logs/ensaio.log | tail -40
```

Expected: `OK (IDA: …)` ×5, `13 passed | 6 skipped`, `OK (vizinhas): nenhuma falha nova …`, as voltas `OK (VOLTA: …)` e `== ENSAIO OK — cópia limpa (483|277)`. Qualquer FALHOU ⇒ o script já devolveu a cópia (volta) — PARE e reporte.

- [ ] **Step 11: Provas dos scripts de produção + sha256 no RODAR**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/sheet-reorg"
bash -n .superpowers/sheet/mig/ida-producao.sh && bash -n .superpowers/sheet/mig/volta-producao.sh && bash -n .superpowers/sheet/mig/ref-volta-f1.sh && echo "sintaxe ok"
bash .superpowers/sheet/mig/prova-scripts.sh 2>&1 | tee .superpowers/sheet/logs/prova-scripts.log | tail -25
shasum -a 256 .superpowers/sheet/mig/{aplica,ida-producao,volta-producao,ref-volta-f1}.sh | cut -c1-16
```

Expected: `sintaxe ok`; `== PROVAS OK` (≈ 16 `OK (prova)`; rodar SEM terminal interativo — o teste da volta lê `/dev/tty` e, sem ele, cancela; num Terminal de verdade, responder só Enter); as 4 sha256 → copiar para o item 4 do `RODAR-sheet-reorg.md`. `FALHOU (prova)` ⇒ corrigir o SCRIPT (nunca a prova), regerar o `aplica.sh` se foi o `extra.sh`, repetir.

- [ ] **Step 12: G-scripts — revisão Opus + guardião**

Entregar ao revisor Opus e ao guardião: os 9 scripts, `ensaio.log`, `prova-scripts.log`, o `RODAR-sheet-reorg.md`. Checklist: guarda de URL ancorada ANTES de qualquer psql; `umask 077` + `unset EXTRA_SQL` na ida e na volta; pasta 700; backup public+auth com TABLE DATA>0 e `pg_restore -l`; md5 dos SQL = ensaiado; travas no arquivo; zero DDL de policy; ordem (Nota sem trava ANTES); pós-condições ANTES de "IDA OK"; volta por DIFERENÇA com export + frase; cadeia da referência da F1 descoberta (sem nome cravado) e conferida no pré-voo E depois; nenhuma prova tocou produção/pasta real. BLOQUEIA ⇒ corrigir e repetir Steps 10–11.

---
## Task 8: Seção 1 — NCM (L2 50/25/25), Título para a página (L4) e Peso/medidas (L6)  *(individual Opus)*

**Files:**
- Modify: `src/components/planejamento/planejamento-detail/InfoGeraisSecao.tsx` (arquivo inteiro abaixo)
- Modify: `src/components/planejamento/PlanejamentoDetail.tsx` (passa `nomeLoja`)
- Create: `tests/unit/planejamento-info-gerais.test.ts`

**Interfaces:**
- Consumes: `tituloPaginaCalculado`, `tituloExibido`, `tituloAoDigitar` (Task 4); `filtrarNcm`, `numeroDoInput` (Task 5); `Draft` com os 7 campos (Task 5); `useTenantBranding().nome` (`src/hooks/useTenantBranding.ts:20` — `tenants.nome`, a MARCA).
- Produces: `InfoGeraisSecao` com a prop nova `nomeLoja: string | null`.

- [ ] **Step 1: Teste de fonte (falha)** — `tests/unit/planejamento-info-gerais.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// F3.6 (Parte B — spec 2026-09-25 §5.1): seção 1 = L1 Status|Estilista|Origem · L2 Nome 50%|Versão 25%|NCM 25% · L3 Grupo…
// Sub2 · L4 Título para a página · L5 Descrição · L6 Peso|Comprimento|Largura|Altura. Gate de FONTE (sem testing-library).
const fonte = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8");
const IG = "src/components/planejamento/planejamento-detail/InfoGeraisSecao.tsx";

describe("InfoGeraisSecao (fonte)", () => {
  const s = fonte(IG);
  it("L1 sem o Nome; L2 = Nome | Versão | NCM em 2fr/1fr/1fr", () => {
    const iL2 = s.indexOf("sm:grid-cols-[2fr_1fr_1fr]");
    expect(iL2).toBeGreaterThan(s.indexOf("<Label>Origem</Label>"));
    const l2 = s.slice(iL2, s.indexOf('label="Grupo"'));
    expect(l2.indexOf('label="Nome do Modelo"')).toBeGreaterThan(0);
    expect(l2.indexOf("<Label>Versão</Label>")).toBeGreaterThan(l2.indexOf('label="Nome do Modelo"'));
    expect(l2.indexOf("NCM do Produto")).toBeGreaterThan(l2.indexOf("<Label>Versão</Label>"));
    expect(s.slice(0, iL2)).not.toContain('label="Nome do Modelo"');
  });
  it("NCM: texto simples, placeholder do formato, filtro dígitos/pontos, data-colab-path", () => {
    expect(s).toContain('placeholder="0000.00.00"');
    expect(s).toContain("filtrarNcm(e.target.value)");
    expect(s).toContain('data-colab-path="ncm"');
  });
  it("L4 Título entre as subcategorias e a Descrição, com badge automático, ↺ e o hint do mockup", () => {
    const iSub2 = s.indexOf('label="Subcategoria 2"');
    const iTit = s.indexOf('<Label htmlFor="titulo-pagina">Título para a página</Label>');
    const iDesc = s.indexOf("<Label>Descrição do produto</Label>");
    expect(iTit).toBeGreaterThan(iSub2);
    expect(iDesc).toBeGreaterThan(iTit);
    expect(s).toContain('data-colab-path="titulo_pagina"');
    expect(s).toContain("tituloPaginaCalculado(draft.nome, nomeLoja)");
    expect(s).toContain("Acompanha o Nome do Modelo + o nome da loja enquanto ninguém editar. Editado à mão, fica fixo até clicar em ↺.");
    expect(s).toContain('aria-label="Título: voltar ao automático"');
  });
  it("L6 Peso/medidas DEPOIS da Descrição: MoneyInput com casas 3/2, placeholder e data-colab-path por campo (NULL = vazio)", () => {
    const iDesc = s.indexOf("<Label>Descrição do produto</Label>");
    expect(s.indexOf("MEDIDAS.map(")).toBeGreaterThan(iDesc);
    for (const t of ['"Peso (kg)"', '"Comprimento (cm)"', '"Largura (cm)"', '"Altura (cm)"']) expect(s).toContain(t);
    expect(s).toContain("decimals={m.casas}");
    expect(s).toContain("placeholder={m.placeholder}");
    expect(s).toContain("data-colab-path={m.key}");
    expect(s).toContain("numeroDoInput(e.target.value)");
  });
  it("o orquestrador passa o nome da loja (tenants.nome)", () => {
    expect(fonte("src/components/planejamento/PlanejamentoDetail.tsx")).toMatch(/<InfoGeraisSecao[\s\S]*?nomeLoja=\{nomeLoja\}/);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit/planejamento-info-gerais.test.ts`
Expected: FAIL (sem `sm:grid-cols-[2fr_1fr_1fr]`, sem Título/NCM/medidas).

- [ ] **Step 3: `InfoGeraisSecao.tsx` — arquivo inteiro**

```tsx
// Seção 1 "Informações Gerais do Produto" do detalhe do Planejamento. Extraída na F3.0 (set/2026) de
// `PlanejamentoDetail.tsx`; o estado continua no orquestrador. F3.1: "Descrição do produto" e "— Nenhum —" no Estilista.
// F3.6 (Parte B — spec 2026-09-25 §5.1): L1 Status | Estilista | Origem · L2 Nome do Modelo (50%) | Versão (25%) | NCM do
// Produto (25%) · L3 Grupo · Categoria · Sub 1 · Sub 2 · L4 Título para a página (automático / editado / ↺) · L5 Descrição ·
// L6 Peso (kg) | Comprimento | Largura | Altura (cm). Os mesmos campos no Dialog "Novo Modelo" (ruling 8).
import type { Dispatch, SetStateAction } from "react";
import { RotateCcw } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { NumberInput } from "@/components/shared/NumberInput";
import { MoneyInput } from "@/components/shared/MoneyInput";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useFieldLabels } from "@/hooks/useFieldLabels";
import { STATUS_OPTS, type Opt, type CatOpt, type SubOpt, type Draft } from "@/components/planejamento/modelo-shared";
import { Secao, FieldText, FieldSelect } from "@/components/planejamento/planejamento-detail/campos";
import type { OpcaoOrigem } from "@/components/planejamento/planejamento-detail/comprado";
import { filtrarNcm, numeroDoInput } from "@/components/planejamento/planejamento-detail/helpers";
import { tituloAoDigitar, tituloExibido, tituloPaginaCalculado } from "@/lib/titulo-pagina";

// L6 (ruling 2 + R4): MoneyInput limita as casas NA DIGITAÇÃO (3 no peso, 2 nas medidas) e emite "" quando vazio (NULL = vazio
// com placeholder — ui-padroes §D); o NumberInput viraria "0" (0 é medida válida) e não limita casas.
const MEDIDAS = [
  { key: "peso_kg", label: "Peso (kg)", casas: 3, placeholder: "0,000" },
  { key: "comprimento_cm", label: "Comprimento (cm)", casas: 2, placeholder: "0,00" },
  { key: "largura_cm", label: "Largura (cm)", casas: 2, placeholder: "0,00" },
  { key: "altura_cm", label: "Altura (cm)", casas: 2, placeholder: "0,00" },
] as const;
type ChaveMedida = (typeof MEDIDAS)[number]["key"];
const comMedida = (d: Draft, k: ChaveMedida, v: number | null): Draft => {
  const out = { ...d };
  out[k] = v;
  return out;
};

export function InfoGeraisSecao({
  draft, setDraftTracked, grupoSel, setGrupoSel, grupos, categorias, estilistas, sub1Opts, sub2Opts, fl, numero, selo, origemOpcoes,
  nomeLoja,
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
  /** F3.3 — numeração e selo da seção (orquestrador). */
  numero?: number;
  selo?: React.ReactNode;
  /** F3.4 — opções do Select "Origem" (com "Importado" pelo módulo; troca travada pelas regras da D1 — `opcoesOrigem`). */
  origemOpcoes: OpcaoOrigem[];
  /** F3.6 — `tenants.nome` (a MARCA da loja — ruling 1) p/ o Título automático; null enquanto carrega (título sem " | "). */
  nomeLoja: string | null;
}) {
  const tituloCalculado = tituloPaginaCalculado(draft.nome, nomeLoja);
  const tituloAutomatico = draft.titulo_pagina === null;
  return (
          <Secao id="info" titulo="Informações Gerais do Produto" numero={numero} selo={selo}>
            {/* L1: Status · Estilista · Origem (F3.6: o Nome foi para a L2) */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="grid gap-1">
                <Label>Status</Label>
                <Select value={draft.status_planejamento} onValueChange={(v) => setDraftTracked((d) => ({ ...d, status_planejamento: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <FieldSelect
                label={fl("estilista")}
                value={draft.estilista_id}
                onChange={(v) => setDraftTracked((d) => ({ ...d, estilista_id: v }))}
                onLimpar={() => setDraftTracked((d) => ({ ...d, estilista_id: null }))}
                options={estilistas}
              />
              <div className="grid gap-1">
                <Label>Origem</Label>
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
              </div>
            </div>

            {/* L2 (decisão do dono 25/set): Nome do Modelo 50% · Versão 25% · NCM do Produto 25%. Versão editável (versão≥2 =
                repetição — badge ↻ vN; clamp mínimo 1, coluna NOT NULL). NCM = texto simples, sem tabela oficial nem sugestão
                (ruling 3): só dígitos e pontos, até 10; vazio grava NULL. */}
            <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr_1fr] gap-3">
              <FieldText
                label="Nome do Modelo"
                value={draft.nome}
                onChange={(v) => setDraftTracked((d) => ({ ...d, nome: v }))}
                colabPath="nome"
              />
              <div className="grid gap-1">
                <Label>Versão</Label>
                <NumberInput
                  integer
                  value={draft.versao}
                  onChange={(e) => {
                    const n = Math.max(1, Math.trunc(Number(e.target.value) || 1));
                    setDraftTracked((d) => ({ ...d, versao: n }));
                  }}
                  data-colab-path="versao"
                />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="ncm-produto">NCM do Produto</Label>
                <Input
                  id="ncm-produto"
                  inputMode="decimal"
                  maxLength={10}
                  placeholder="0000.00.00"
                  value={draft.ncm ?? ""}
                  onChange={(e) => { const v = filtrarNcm(e.target.value); setDraftTracked((d) => ({ ...d, ncm: v === "" ? null : v })); }}
                  data-colab-path="ncm"
                />
              </div>
            </div>

            {/* L3: Grupo · Categoria · Subcategoria 1 · Subcategoria 2 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <FieldSelect
                label="Grupo"
                value={grupoSel}
                onChange={(v) => {
                  setGrupoSel(v);
                  // Se a categoria atual não pertence ao novo grupo, limpa categoria + subs.
                  const cat = categorias.find((c) => c.id === draft.categoria_principal_id);
                  if (cat && cat.grupo_id !== v) setDraftTracked((d) => ({ ...d, categoria_principal_id: null, subcategoria1_id: null, subcategoria2_id: null }));
                }}
                options={grupos}
              />
              <FieldSelect
                label="Categoria"
                value={draft.categoria_principal_id}
                onChange={(v) => {
                  // Mantém o Grupo coerente e reseta as subcategorias (pertencem à categoria).
                  const cat = categorias.find((c) => c.id === v);
                  if (cat?.grupo_id) setGrupoSel(cat.grupo_id);
                  setDraftTracked((d) => ({ ...d, categoria_principal_id: v, subcategoria1_id: null, subcategoria2_id: null }));
                }}
                options={grupoSel ? categorias.filter((c) => c.grupo_id === grupoSel) : categorias}
              />
              <FieldSelect
                label="Subcategoria 1"
                value={draft.subcategoria1_id}
                onChange={(v) => setDraftTracked((d) => ({ ...d, subcategoria1_id: v }))}
                options={sub1Opts.filter((s) => s.categoria_id === draft.categoria_principal_id)}
              />
              <FieldSelect
                label="Subcategoria 2"
                value={draft.subcategoria2_id}
                onChange={(v) => setDraftTracked((d) => ({ ...d, subcategoria2_id: v }))}
                options={sub2Opts.filter((s) => s.categoria_id === draft.categoria_principal_id)}
              />
            </div>

            {/* L4 (ruling 1): Título para a página. NULL = AUTOMÁTICO (Nome em iniciais maiúsculas + " | " + loja, ao vivo a
                cada tecla no Nome; Nome vazio ⇒ vazio, nunca " | Loja" solto). Digitar algo DIFERENTE vira manual (R5); esvaziar
                volta ao automático no blur (R6); ↺ grava NULL. O merge compara o campo como qualquer outro (ruling 9). */}
            <div className="grid gap-1">
              <div className="flex items-center gap-2">
                <Label htmlFor="titulo-pagina">Título para a página</Label>
                {tituloAutomatico && tituloCalculado !== "" && (
                  <StatusBadge tone="neutral" className="rounded-full px-2 py-0.5 normal-case tracking-normal">automático</StatusBadge>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Input
                  id="titulo-pagina"
                  className="min-w-0 flex-1"
                  placeholder="Nome do Modelo | Nome da loja"
                  value={tituloExibido(draft.titulo_pagina, tituloCalculado)}
                  onChange={(e) => { const v = e.target.value; setDraftTracked((d) => ({ ...d, titulo_pagina: tituloAoDigitar(v, tituloCalculado) })); }}
                  onBlur={() => { if (draft.titulo_pagina !== null && draft.titulo_pagina.trim() === "") setDraftTracked((d) => ({ ...d, titulo_pagina: null })); }}
                  data-colab-path="titulo_pagina"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0 max-sm:min-h-11"
                  disabled={tituloAutomatico}
                  onClick={() => setDraftTracked((d) => ({ ...d, titulo_pagina: null }))}
                  aria-label="Título: voltar ao automático"
                  title="Voltar ao automático"
                >
                  <RotateCcw className="h-4 w-4 sm:mr-1" />
                  <span className="max-sm:sr-only">automático</span>
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Acompanha o Nome do Modelo + o nome da loja enquanto ninguém editar. Editado à mão, fica fixo até clicar em ↺.</p>
            </div>

            {/* L5 — "Descrição do produto" (dono, 22/set): texto longo, largura total. Coluna `modelos.descricao_produto`
                (migration 20260930180000); o Salvar manda NULL quando vazio. Não vai para a Ficha Técnica (não pedido). */}
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

            {/* L6 (ruling 2): Peso (kg, 3 casas) · Comprimento · Largura · Altura (cm, 2 casas). NULL = vazio; 0 vale. */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {MEDIDAS.map((m) => (
                <div key={m.key} className="grid gap-1">
                  <Label htmlFor={`medida-${m.key}`}>{m.label}</Label>
                  <MoneyInput
                    id={`medida-${m.key}`}
                    decimals={m.casas}
                    fixedDecimals
                    placeholder={m.placeholder}
                    value={draft[m.key] ?? ""}
                    onChange={(e) => { const v = numeroDoInput(e.target.value); setDraftTracked((d) => comMedida(d, m.key, v)); }}
                    data-colab-path={m.key}
                  />
                </div>
              ))}
            </div>
          </Secao>
  );
}
```

- [ ] **Step 4: `PlanejamentoDetail.tsx` — nome da loja**

(1) `import { useTenantBranding } from "@/hooks/useTenantBranding";` junto dos hooks. (2) Logo depois de `const tenantIdAtivo = useActiveTenantId();`:

```ts
  // F3.6 (ruling 1) — a MARCA da loja (`tenants.nome`, não o WISH360) p/ o Título automático da seção 1; mesma query cacheada
  // dos relatórios (useTenantBranding).
  const { nome: nomeLoja } = useTenantBranding();
```

(3) Em `<InfoGeraisSecao … origemOpcoes={origemOpcoesLista}` acrescentar `nomeLoja={nomeLoja}` antes do `/>`.

- [ ] **Step 5: Rodar, gates e commit**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/sheet-reorg"
env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit/planejamento-info-gerais.test.ts tests/unit/titulo-pagina.test.ts tests/unit/planejamento-detail-helpers.test.ts
bash .superpowers/sheet/gates.sh
git add -- src/components/planejamento/planejamento-detail/InfoGeraisSecao.tsx src/components/planejamento/PlanejamentoDetail.tsx tests/unit/planejamento-info-gerais.test.ts
git commit --only -m "feat(sheet-reorg): seção 1 — NCM (L2 50/25/25), Título para a página e Peso/medidas (T8)" \
  -m "Título automático = nome em título + ' | ' + tenants.nome (↺); NCM texto com filtro; medidas MoneyInput 3/2 casas (NULL = vazio). Também no Dialog Novo Modelo. Plano 2026-09-25, Task 8." \
  -m "Co-Authored-By: Claude <seu modelo real> <noreply@anthropic.com>" \
  -- src/components/planejamento/planejamento-detail/InfoGeraisSecao.tsx src/components/planejamento/PlanejamentoDetail.tsx tests/unit/planejamento-info-gerais.test.ts
git show --stat HEAD
```

Expected: PASS e `GATES SHEET: ok` (o anti-drift não acusa: sem hex/`hsl`/`toFixed`/`type="date"`; `MoneyInput` com placeholder).

**Revisão individual Opus:** layout (L1 3 colunas; L2 `2fr 1fr 1fr` no ≥640px e 1 coluna no mobile), Título (automático ao vivo, manual só se diferente, blur esvaziado ⇒ automático, ↺ desabilitado no automático, sem " | " solto), NCM (filtro, NULL vazio), medidas (casas, NULL/0), `data-colab-path` nos 6 campos, Dialog "Novo Modelo" com os mesmos campos (numera só 1 e 2 — R8 da spec).

---
## Task 9: "Preço anterior" em Preço e Custos (manufaturado/importado) e no bloco da revenda  *(individual Opus — dinheiro)*

**Files:**
- Modify: `src/components/planejamento/planejamento-detail/PrecoTabela.tsx`
- Modify: `src/components/planejamento/planejamento-detail/RevendaSetores.tsx`
- Modify: `src/components/planejamento/PlanejamentoDetail.tsx`
- Create: `tests/unit/planejamento-preco-anterior.test.ts`

**Interfaces:**
- Consumes: `precoAnteriorExibido` (Task 5); `Draft.preco_anterior` (Task 5); `precoBase` da `PrecoTabela` (= `precoEfetivo` do orquestrador — o digitado ou o sugerido); `piRevenda.efetivo` (varejo efetivo da revenda); `podeEditarPreco` (`criacao_planejamento:preco_venda`).
- Produces: `PrecoTabela` props `precoAnterior: number | null; onPrecoAnterior: (v: number | null) => void`; `PrecoRevendaBloco` props `podeEditarPreco: boolean; precoAnterior: number | null; onPrecoAnterior: (v: number | null) => void`.

- [ ] **Step 1: Teste (falha)** — `tests/unit/planejamento-preco-anterior.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { precoAnteriorExibido } from "@/components/planejamento/planejamento-detail/helpers";

// F3.6 (Parte B — ruling 11): "Preço anterior" ANTES do "Preço de venda"; NULL = acompanha o preço EFETIVO; editado = fixo até
// o ↺; editar = a permissão do preço de venda. Revenda: acompanha o VAREJO. Gates de FONTE + a regra pura.
const fonte = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8");
const PT = "src/components/planejamento/planejamento-detail/PrecoTabela.tsx";
const RS = "src/components/planejamento/planejamento-detail/RevendaSetores.tsx";
const PD = "src/components/planejamento/PlanejamentoDetail.tsx";

describe("Preço anterior (regra)", () => {
  it("automático = o preço efetivo, ao vivo; editado = fixo; efetivo 0 = vazio", () => {
    expect(precoAnteriorExibido(null, 289.9)).toBe(289.9);
    expect(precoAnteriorExibido(null, 310)).toBe(310); // o preço de venda mudou ⇒ o automático acompanha
    expect(precoAnteriorExibido(250, 310)).toBe(250);
    expect(precoAnteriorExibido(null, 0)).toBeNull();
  });
});

describe("Preço anterior (fonte)", () => {
  it("PrecoTabela: linha ANTES de 'Preço de venda', MoneyInput com data-colab-path, ↺, permissão e o obs do mockup", () => {
    const s = fonte(PT);
    const iAnt = s.indexOf(">Preço anterior</td>");
    const iVenda = s.indexOf("<b>Preço de venda</b>");
    expect(iAnt).toBeGreaterThan(s.indexOf(">Preços</td>"));
    expect(iVenda).toBeGreaterThan(iAnt);
    const linha = s.slice(iAnt, iVenda);
    expect(linha).toContain('data-colab-path="preco_anterior"');
    expect(linha).toContain("precoAnteriorExibido(precoAnterior, precoBase)");
    expect(linha).toContain("podeEditarPreco ?");
    expect(linha).toContain('aria-label="Preço anterior: voltar ao automático"');
    expect(linha).toContain("acompanha o preço de venda até ser editado · ↺ volta ao automático");
  });
  it("Revenda: o campo vem ANTES do par atacado/varejo e acompanha o VAREJO efetivo", () => {
    const s = fonte(RS);
    const iAnt = s.indexOf('data-colab-path="preco_anterior"');
    expect(iAnt).toBeGreaterThan(0);
    expect(s.indexOf("<Label>Preço atacado</Label>")).toBeGreaterThan(iAnt);
    expect(s).toContain("precoAnteriorExibido(precoAnterior, piRevenda.efetivo)");
  });
  it("o orquestrador liga o Draft nos DOIS blocos", () => {
    const s = fonte(PD);
    expect(s.split("precoAnterior={draft.preco_anterior}").length - 1).toBe(2);
    expect(s.split("onPrecoAnterior={(v) => setDraftTracked((d) => ({ ...d, preco_anterior: v }))}").length - 1).toBe(2);
    expect(s).toMatch(/<PrecoRevendaBloco[\s\S]*?podeEditarPreco=\{podeEditarPreco\}/);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit/planejamento-preco-anterior.test.ts`
Expected: FAIL (a regra passa; os 3 de fonte falham — sem a linha/prop).

- [ ] **Step 3: `PrecoTabela.tsx`**

1. Imports: `import { Plus, Trash2 } from "lucide-react";` vira `import { Plus, RotateCcw, Trash2 } from "lucide-react";` e acrescentar `import { precoAnteriorExibido } from "@/components/planejamento/planejamento-detail/helpers";`.
2. No tipo das props, logo depois de `draftPrecoVenda: number | null | undefined; onPrecoVenda: (v: string) => void;`:

```ts
  // F3.6 (Parte B, ruling 11) — Preço anterior: NULL = acompanha o preço EFETIVO (`precoBase` — o digitado ou o sugerido, o
  // mesmo da linha "Preço de venda"); não-NULL = fixado à mão até o ↺. Editar = `podeEditarPreco` (mesma permissão).
  precoAnterior: number | null; onPrecoAnterior: (v: number | null) => void;
```

3. No destructuring, acrescentar `precoAnterior, onPrecoAnterior` (ao lado de `draftPrecoVenda, onPrecoVenda`).
4. Logo DEPOIS da linha de cabeçalho `<tr className="bg-muted/40"><td colSpan={4} …>Preços</td></tr>` e ANTES do `<tr className="border-t">` do "Preço de venda":

```tsx
          {/* F3.6 (ruling 11) — Preço anterior ANTES do Preço de venda. Automático (NULL): mostra o EFETIVO e acompanha ao vivo
              qualquer mudança do preço de venda; qualquer valor digitado FIXA (R5 — é o "congelar o preço atual"); ↺ volta ao
              automático. Sem a permissão: só leitura. */}
          <tr className="border-t">
            <td className="py-2 pr-3">Preço anterior</td>
            <td className="py-2 px-2 text-right text-muted-foreground">—</td>
            <td className="py-2 px-2 text-right">
              {podeEditarPreco ? (
                <span className="ml-auto inline-flex items-center justify-end gap-1">
                  <MoneyInput
                    fixedDecimals
                    className="h-8 w-32 text-right tabular-nums"
                    value={precoAnteriorExibido(precoAnterior, precoBase) ?? ""}
                    placeholder="0,00"
                    data-colab-path="preco_anterior"
                    onChange={(e) => onPrecoAnterior(e.target.value === "" ? null : Number(e.target.value))}
                  />
                  <Button type="button" variant="ghost" size="iconSm" className="text-muted-foreground" disabled={precoAnterior === null}
                    aria-label="Preço anterior: voltar ao automático" title="Voltar ao automático" onClick={() => onPrecoAnterior(null)}>
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                </span>
              ) : (
                <span className="tabular-nums">{(() => { const v = precoAnteriorExibido(precoAnterior, precoBase); return v != null ? brl(v) : "—"; })()}</span>
              )}
            </td>
            <td className="py-2 pl-2 text-xs text-muted-foreground">{precoAnterior === null ? "automático · " : "editado · "}acompanha o preço de venda até ser editado · ↺ volta ao automático</td>
          </tr>
```

- [ ] **Step 4: `RevendaSetores.tsx` (`PrecoRevendaBloco`)**

1. Imports: `import { ExternalLink, PackagePlus } from "lucide-react";` vira `import { ExternalLink, PackagePlus, RotateCcw } from "lucide-react";` e acrescentar `import { precoAnteriorExibido } from "@/components/planejamento/planejamento-detail/helpers";`.
2. Assinatura (a da Task 3 + 3 props):

```tsx
export function PrecoRevendaBloco({ rv, custoReal, piRevenda, draft, blocoMaoObra, obsMaoObra, podeEditarPreco, precoAnterior, onPrecoAnterior }: {
  rv: RevendaPlanejamento; custoReal: boolean; piRevenda: PrecoInfo; draft: Draft;
  /** F3.6 (Parte A, opção A do dono) — a MO do comprado entra NO bloco de preço (não é mais seção própria). */
  blocoMaoObra?: ReactNode; obsMaoObra?: ReactNode;
  /** F3.6 (Parte B, ruling 11) — Preço anterior: NULL = acompanha o VAREJO efetivo (`piRevenda.efetivo`); editar =
   *  `criacao_planejamento:preco_venda`; grava no Salvar da página (não pela RPC de preço fixo). */
  podeEditarPreco: boolean; precoAnterior: number | null; onPrecoAnterior: (v: number | null) => void;
}) {
```

3. Dentro do ramo `produtoRevenda ? (<> … </>)`, logo ANTES do `<div className="grid gap-1">` que contém `<Label>Preço atacado</Label>` (R17 — linha própria antes do par atacado/varejo):

```tsx
                    {/* F3.6 (ruling 11, R17) — Preço anterior em linha própria, ANTES do par atacado/varejo; acompanha o VAREJO. */}
                    {podeEditarPreco ? (
                      <div className="grid gap-1 sm:col-span-2">
                        <Label htmlFor="preco-anterior-revenda">Preço anterior</Label>
                        <div className="flex items-center gap-1 sm:max-w-xs">
                          <MoneyInput
                            id="preco-anterior-revenda"
                            fixedDecimals
                            className="min-w-0 flex-1"
                            value={precoAnteriorExibido(precoAnterior, piRevenda.efetivo) ?? ""}
                            placeholder="0,00"
                            data-colab-path="preco_anterior"
                            onChange={(e) => onPrecoAnterior(e.target.value === "" ? null : Number(e.target.value))}
                          />
                          <Button type="button" variant="ghost" size="iconSm" className="text-muted-foreground" disabled={precoAnterior === null}
                            aria-label="Preço anterior: voltar ao automático" title="Voltar ao automático" onClick={() => onPrecoAnterior(null)}>
                            <RotateCcw className="h-4 w-4" />
                          </Button>
                        </div>
                        <p className="text-xs text-muted-foreground">{precoAnterior === null ? "automático · " : "editado · "}acompanha o preço de venda até ser editado · ↺ volta ao automático</p>
                      </div>
                    ) : (
                      <div className="sm:col-span-2 sm:max-w-xs">
                        <CampoRO label="Preço anterior" value={(() => { const v = precoAnteriorExibido(precoAnterior, piRevenda.efetivo); return v != null ? brl(v) : "—"; })()} />
                      </div>
                    )}
```

- [ ] **Step 5: `PlanejamentoDetail.tsx`**

Em `<PrecoTabela …>`, depois de `onPrecoVenda={…}`:

```tsx
                // F3.6 (ruling 11) — Preço anterior (grava no Salvar; payload só com podeEditarPreco — usePlanejamentoSave).
                precoAnterior={draft.preco_anterior}
                onPrecoAnterior={(v) => setDraftTracked((d) => ({ ...d, preco_anterior: v }))}
```

E o `<PrecoRevendaBloco …/>` (Task 3) passa a ser:

```tsx
              <PrecoRevendaBloco rv={revenda} custoReal={custoReal} piRevenda={piRevenda} draft={draft}
                blocoMaoObra={moBlocoVisivel ? editorMaoObra : null} obsMaoObra={moBlocoVisivel ? obsMaoObra : null}
                podeEditarPreco={podeEditarPreco}
                precoAnterior={draft.preco_anterior}
                onPrecoAnterior={(v) => setDraftTracked((d) => ({ ...d, preco_anterior: v }))} />
```

- [ ] **Step 6: Rodar, gates e commit**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/sheet-reorg"
env -u DATABASE_URL npx vitest run --no-file-parallelism tests/unit/planejamento-preco-anterior.test.ts tests/unit/planejamento-mo-na-tabela.test.ts tests/unit/preco.test.ts tests/unit/preco-revenda.test.ts
bash .superpowers/sheet/gates.sh
git add -- src/components/planejamento/planejamento-detail/PrecoTabela.tsx src/components/planejamento/planejamento-detail/RevendaSetores.tsx src/components/planejamento/PlanejamentoDetail.tsx tests/unit/planejamento-preco-anterior.test.ts
git commit --only -m "feat(sheet-reorg): Preço anterior antes do Preço de venda (manufaturado/importado e revenda) (T9)" \
  -m "NULL acompanha o preço efetivo (revenda: varejo); digitado fixa até o ↺; editar = criacao_planejamento:preco_venda. Plano 2026-09-25, Task 9." \
  -m "Co-Authored-By: Claude <seu modelo real> <noreply@anthropic.com>" \
  -- src/components/planejamento/planejamento-detail/PrecoTabela.tsx src/components/planejamento/planejamento-detail/RevendaSetores.tsx src/components/planejamento/PlanejamentoDetail.tsx tests/unit/planejamento-preco-anterior.test.ts
git show --stat HEAD
```

**Revisão individual Opus (dinheiro):** automático = o MESMO efetivo da linha de baixo (não um número à parte); `preco.ts` intocado (invariante #8); sem permissão = só leitura e o payload não reenvia (Task 5); revenda = varejo (`piRevenda.efetivo`), não atacado; mobile (a coluna Valores sticky com input + ↺ cabe a 360px); nenhum `toFixed`/moeda à mão (usa `brl`).

---
## Task 10: Portões finais, PRODUÇÃO (pelo dono), merge + cópia, QA no `:5173`, deploy e docs  *(controlador + guardião + dono — não é código)*

> ⛔ Ordem: Steps 1–3 registrados ⇒ Nota sem trava em produção ⇒ esta ida (dono) ⇒ referência da F1 (dono) ⇒ merge + cópia NUM comando ⇒ QA ⇒ deploy pelo portão. O merge NUNCA antes da migration em produção (o `:5173` do dono lê produção e todo Salvar manda os 7 campos).

**Files:** nenhum novo no repo até o merge (Step 6); o QA spec `tests/e2e/sheet-reorg-qa.spec.ts` NÃO é versionado. Evidências em `/Users/sunglee/PLM + Criação/savepoints/pre-apply-sheet-reorg/`, `.superpowers/sheet/logs/` e no diário do guardião.

- [ ] **Step 1: Branch em dia + gates + suíte (controlador)**

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/sheet-reorg"
git status --porcelain -- src supabase tests | grep . && { echo "WORKTREE SUJA — PARE"; exit 1; }
git rebase feature/plan-tecido-a1 && git log --oneline -14
bash .superpowers/sheet/gates.sh
```

Repetir o Task 0 Step 8 (sobreposição) — `SOBREPOE-BANCO` ⇒ PARE (Task 6 de novo). Se o rebase trouxe algo, com o OK do dono (N3): `SHEET_DONO_AVISADO=sim bash .superpowers/sheet/n3.sh antes t10s1` e a suíte `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres SHEET_MIG_TXN=1 npx vitest run --no-file-parallelism tests/integration/sheet-reorg-campos.test.ts` → 19 passed; `bash .superpowers/sheet/n3.sh depois t10s1`. Conferir `md5 -q` dos 2 SQL = `.superpowers/sheet/mig/md5-{mig,inv}.txt` (o rebase não pode ter mudado o SQL ensaiado).

- [ ] **Step 2: G-commit (guardião)**

Entregar ao `guardiao-unificacao`: `git log --oneline "$(cat .superpowers/sheet/BASE)"..HEAD`, `git diff --stat` do mesmo intervalo, `gates.sh` verde, os pareceres das revisões (Lotes C/B1, T3, T8, T9, G-migration A/B, G-scripts), o gate "Dev intocado" (vazio) e este plano. Checklist do guardião: decisões travadas do dono (spec §2/§3); nenhum arquivo fora da lista; Dev intocado; save point `savepoint-pre-unificacao-2026-09-22` preservado; ordem de produção. BLOQUEIA ⇒ parar.

- [ ] **Step 3: OK EXPLÍCITO do dono (chat, sem popup)**

Apresentar em PT-BR simples: o que muda na tela (seção 1 com NCM/Título/Peso-medidas; seção 3 "Desenvolvimento" sem a REF; seção 4 "Códigos" com REF, "Tamanho em" e SKUs; Mão de obra dentro de "Preço e Custos"; "Preço anterior"; numeração 1–15); o que muda no banco (7 colunas vazias, 1 função, "Replicar" leva os campos; nada existente muda de valor); a ordem (Nota sem trava ANTES); o plano de volta (Step 11); as dúvidas D1–D4 (§6) com as recomendações. Registrar a resposta literal + data no diário. Sem "sim" ⇒ parar.

- [ ] **Step 4: PRODUÇÃO — o DONO, no Terminal, pelo `RODAR-sheet-reorg.md`**

Pré-condição: o dono já rodou a Nota sem trava (roteiro dela) e avisou. Ele segue o `RODAR-sheet-reorg.md` (Task 7 Step 9): confere as sha256, roda o `ida-producao.sh` (Passo 1) e o `ref-volta-f1.sh` (Passo 2). O controlador NÃO roda nada disso. Se o pré-voo parar em "cadeia da volta da F1 … NÃO bate" com diferença SÓ em `fn_oc_nota_entrada_valida`: a Nota sem trava não gravou referência própria — o controlador leva ao dono (opções: a frente da Nota grava a referência dela e o dono repete; ou o dono autoriza EXPLICITAMENTE seguir e a referência desta frente passa a incluir essa linha — registrar no diário). NUNCA contornar a checagem por conta própria.

- [ ] **Step 5: G-produção (guardião) — logs do dono**

O guardião lê `.superpowers/sheet/logs/prod-ida.log` e `prod-ref-volta-f1.log`: backup public+auth com TABLE DATA>0; pré-voo OK (ordem, md5, cadeia); `aplica_v2` sem nova tentativa ou com nova tentativa só em 55P03/40P01/25P04; `== IDA OK` com `483|277 → 484|277` (ou antes+1|+0); referência nova com o CONT esperado. Registrar no diário. Falhou a conferência ⇒ PARE (volta só com OK do dono — Step 11).

- [ ] **Step 6: Merge do front + ida na CÓPIA na mesma hora (controlador)**

Avisar o dono por chat: salvar e fechar cards abertos no `:5173` E no `:5188` (o código novo vale no reload; a cópia congela alguns segundos na ida). Com o OK — um comando só, ida na cópia e fast-forward em sequência (sem janela em que o `:5188` peça coluna a uma cópia sem ela):

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/sheet-reorg"
MAIN="/Users/sunglee/PLM + Criação/plm-pcp"
git -C "$MAIN" diff --cached --quiet || { echo "índice do checkout principal com coisa staged (outra sessão) — PARE"; exit 1; }
git log --format=%H feature/plan-tecido-a1..sheet/reorganizacao > .superpowers/sheet/commits-da-frente.txt   # ANTES do ff (Step 8 usa)
[ "$(git -C "$MAIN" branch --show-current)" = feature/plan-tecido-a1 ] || { echo "checkout principal fora da feature/plan-tecido-a1 — PARE"; exit 1; }
SHEET_DONO_AVISADO=sim bash .superpowers/sheet/copia.sh ida \
  && git -C "$MAIN" merge --ff-only sheet/reorganizacao && git -C "$MAIN" log --oneline -12
```

Expected: `== CÓPIA: ida OK (483|277 → 484|277)` (ou `a cópia JÁ tem a frente`) e o ff com os commits desta frente no topo. A ida falhou ⇒ o merge NÃO roda. O ff falhou (a principal andou) ⇒ `git rebase feature/plan-tecido-a1` na worktree, `gates.sh`, repetir SÓ o `merge --ff-only`. Avisar as outras frentes: "a cópia local passa a ter a reorganização do Sheet: funções|gatilhos = 484|277; classificadores que esperam 483|277 passam a dizer INESPERADO".

- [ ] **Step 7: QA Playwright no `:5173` (depois do merge, antes do deploy)**

Pré-condições: o `:5173` do dono no ar e recarregado (NÃO subir/matar nada; se estiver fora do ar, PEDIR ao dono); `E2E_SHEET_MODELO_ID` = id de UM card INTERNO da Loja Teste, com REF e grade, combinado com o dono por chat (o dono copia da URL `?modelo=`); `E2E_SHEET_ESCREVE_SKU=1` / `E2E_SHEET_ESCREVE_MO=1` SÓ com OK explícito do dono (R13 — por padrão ficam desligados). Criar `tests/e2e/sheet-reorg-qa.spec.ts` (NÃO versionar):

```ts
import { test, expect, type Page } from "@playwright/test";
import { doLogin } from "./_helpers";

// QA da reorganização do Sheet do Planejamento (plano 2026-09-25, Task 10 Step 7). NÃO VERSIONAR.
// Alvo: o :5173 do dono (checkout principal JÁ com o merge) = PRODUÇÃO. Travada na Loja Teste (NUNCA troca de loja — nada de
// selectStore). Grava SÓ no card E2E_SHEET_MODELO_ID e RESTAURA cada campo dentro do próprio teste. SKU à mão / Regerar
// confirmado / serviço de MO só com E2E_SHEET_ESCREVE_SKU=1 / E2E_SHEET_ESCREVE_MO=1 (OK do dono — R13).
const BASE_OK = /^http:\/\/(localhost|127\.0\.0\.1):5173\/?$/.test(process.env.E2E_BASE_URL ?? "");
const MODELO = process.env.E2E_SHEET_MODELO_ID ?? "";
test.skip(!BASE_OK || !MODELO, "Rode com E2E_BASE_URL=http://localhost:5173 e E2E_SHEET_MODELO_ID=<card da Loja Teste combinado com o dono>");

async function exigirLojaTeste(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  const sw = page.locator('div:has(> div:has-text("Loja em visualização"))').getByRole("combobox").first();
  await sw.waitFor({ state: "attached", timeout: 8_000 }).catch(() => {});
  const rotulo = (await sw.count()) ? ((await sw.textContent()) ?? "").trim() : null;
  if (rotulo !== null && !rotulo.includes("Loja Teste")) {
    throw new Error(`O usuário de teste NÃO está na Loja Teste ("${rotulo}") — a QA não troca de loja; pedir ao dono.`);
  }
}
async function abrirCard(page: Page) {
  await page.goto(`/criacao/planejamento?modelo=${MODELO}`, { waitUntil: "networkidle" });
  await expect(page.locator('[data-secao="info"]')).toBeVisible();
}
const secao = (page: Page, id: string) => page.locator(`[data-secao="${id}"]`);
async function abrir(page: Page, id: string) {
  const b = secao(page, id).locator("button[aria-expanded]").first();
  if ((await b.getAttribute("aria-expanded")) === "false") await b.click();
}
async function salvar(page: Page) {
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText("Modelo salvo").first()).toBeVisible({ timeout: 15_000 });
}
async function voltarDescartando(page: Page) {
  await page.getByRole("button", { name: "Voltar" }).click();
  const d = page.getByRole("button", { name: "Descartar" });
  if (await d.isVisible().catch(() => false)) await d.click();
}
async function entrar(page: Page) { await doLogin(page); await exigirLojaTeste(page); await abrirCard(page); }

test.describe("Sheet reorganizado — desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("numeração 1–15, seção 3 sem REF, 4. Códigos, Preço e Custos com MO e Preço anterior", async ({ page }) => {
    await entrar(page);
    const titulos = (await page.locator("section[data-secao] > div > button[aria-expanded] span.truncate").allTextContents()).map((t) => t.trim());
    expect(titulos).toContain("3. Desenvolvimento");
    expect(titulos).toContain("4. Códigos");
    expect(titulos.some((t) => /^\d+\. Preço e Custos$/.test(t))).toBe(true);
    expect(titulos.some((t) => /Mão de obra$/.test(t))).toBe(false);
    await abrir(page, "desenvolvimento");
    await expect(secao(page, "desenvolvimento").locator('[data-colab-path="ref"]')).toHaveCount(0);
    await abrir(page, "codigos");
    await expect(secao(page, "codigos").getByText("SKUs por variante e tamanho")).toBeVisible();
    await abrir(page, "preco");
    const rotulos = (await secao(page, "preco").locator("tbody tr > td:first-child").allTextContents()).map((t) => t.trim());
    expect(rotulos.indexOf("Preço anterior")).toBeGreaterThanOrEqual(0);
    expect(rotulos.indexOf("Preço anterior")).toBeLessThan(rotulos.indexOf("Preço de venda"));
    expect(rotulos.indexOf("Mão de obra")).toBeLessThan(rotulos.indexOf("Custo total"));
  });

  test("seção 1: L2 Nome 50% | Versão 25% | NCM 25%; NCM filtra; Título acompanha o Nome (sem salvar)", async ({ page }) => {
    await entrar(page);
    const nome = secao(page, "info").locator('[data-colab-path="nome"]');
    const versao = secao(page, "info").locator('[data-colab-path="versao"]');
    const ncm = secao(page, "info").locator('[data-colab-path="ncm"]');
    const [bn, bv, bc] = await Promise.all([nome.boundingBox(), versao.boundingBox(), ncm.boundingBox()]);
    expect(Math.abs(bn!.y - bc!.y)).toBeLessThan(4);
    expect(bn!.width / bv!.width).toBeGreaterThan(1.7);
    expect(Math.abs(bv!.width - bc!.width)).toBeLessThan(8);
    await ncm.fill("62ab04.43,00");
    await expect(ncm).toHaveValue("6204.4300");
    const titulo = secao(page, "info").locator('[data-colab-path="titulo_pagina"]');
    const auto = (await secao(page, "info").getByText("automático", { exact: true }).count()) > 0;
    if (auto) {
      await nome.fill("VESTIDO QA TESTE");
      await expect(titulo).toHaveValue(/^Vestido Qa Teste( \| .+)?$/);
    }
    await voltarDescartando(page);
  });

  test("Título, NCM e Peso persistem e são RESTAURADOS", async ({ page }) => {
    await entrar(page);
    const info = secao(page, "info");
    const titulo = info.locator('[data-colab-path="titulo_pagina"]');
    const ncm = info.locator('[data-colab-path="ncm"]');
    const peso = info.locator('[data-colab-path="peso_kg"]');
    const orig = { titulo: await titulo.inputValue(), auto: (await info.getByText("automático", { exact: true }).count()) > 0, ncm: await ncm.inputValue(), peso: await peso.inputValue() };
    await titulo.fill("Título QA (restaurar)"); await ncm.fill("6204.43.00"); await peso.fill("0,350");
    await salvar(page); await page.reload({ waitUntil: "networkidle" });
    await expect(titulo).toHaveValue("Título QA (restaurar)"); await expect(ncm).toHaveValue("6204.43.00"); await expect(peso).toHaveValue("0,350");
    // restaura
    if (orig.auto) await info.getByRole("button", { name: "Título: voltar ao automático" }).click(); else await titulo.fill(orig.titulo);
    await ncm.fill(orig.ncm); await peso.fill(orig.peso);
    await salvar(page); await page.reload({ waitUntil: "networkidle" });
    await expect(ncm).toHaveValue(orig.ncm); await expect(peso).toHaveValue(orig.peso);
    if (orig.auto) await expect(info.getByText("automático", { exact: true })).toBeVisible(); else await expect(titulo).toHaveValue(orig.titulo);
  });

  test("Preço anterior: automático acompanha o Preço de venda (sem salvar); editado persiste; ↺ restaura", async ({ page }) => {
    await entrar(page);
    await abrir(page, "preco");
    const pa = secao(page, "preco").locator('[data-colab-path="preco_anterior"]');
    const pv = secao(page, "preco").locator('[data-colab-path="preco_venda"]');
    test.skip((await pa.count()) === 0 || (await pv.count()) === 0, "usuário sem a permissão de editar o preço de venda");
    const reverter = secao(page, "preco").getByRole("button", { name: "Preço anterior: voltar ao automático" });
    const origAuto = await reverter.isDisabled();
    const origPa = await pa.inputValue();
    if (origAuto) {
      await pv.fill("321,00"); await pv.blur();
      await expect(pa).toHaveValue("321,00");
      await voltarDescartando(page); await abrirCard(page); await abrir(page, "preco");
    }
    await pa.fill("123,45"); await salvar(page); await page.reload({ waitUntil: "networkidle" }); await abrir(page, "preco");
    await expect(pa).toHaveValue("123,45");
    if (origAuto) await reverter.click(); else await pa.fill(origPa);
    await salvar(page); await page.reload({ waitUntil: "networkidle" }); await abrir(page, "preco");
    if (origAuto) await expect(reverter).toBeDisabled(); else await expect(pa).toHaveValue(origPa);
  });

  test("Códigos: Regerar abre o AlertDialog e Cancelar não muda nada (R13)", async ({ page }) => {
    await entrar(page);
    await abrir(page, "codigos");
    const regerar = secao(page, "codigos").getByRole("button", { name: /Regerar SKUs/ });
    test.skip(await regerar.isDisabled(), "Regerar desabilitado (sem REF/formato ou sem permissão) — conferir o motivo na tela e registrar");
    await regerar.click();
    await expect(page.getByText("SKUs editados à mão não mudam.", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Cancelar" }).click();
  });
});

test.describe("mobile — sem estouro horizontal", () => {
  for (const largura of [360, 390]) {
    test(`${largura}px: seções 1, 4 e 11 abertas cabem na tela`, async ({ page }) => {
      await page.setViewportSize({ width: largura, height: 800 });
      await entrar(page);
      for (const id of ["codigos", "preco"]) await abrir(page, id);
      const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
      expect(sw).toBeLessThanOrEqual(cw);
      const add = secao(page, "preco").getByText("Adicionar serviço").first();
      if (await add.count()) {
        const b = (await add.boundingBox())!;
        expect(b.x + b.width).toBeLessThanOrEqual(largura);
      }
      await page.screenshot({ path: `.superpowers/sheet/qa/mobile-${largura}.png`, fullPage: true });
    });
  }
});
```

```bash
cd "/Users/sunglee/PLM + Criação/plm-pcp/.claude/worktrees/sheet-reorg"
ps -Ao pid,command | grep -E "[v]itest|[p]laywright" && { echo "PARE: outro teste rodando"; exit 1; }
E2E_BASE_URL=http://localhost:5173 E2E_SHEET_MODELO_ID="<id combinado>" npx playwright test tests/e2e/sheet-reorg-qa.spec.ts --reporter=list 2>&1 | tee .superpowers/sheet/logs/qa.log | tail -30
```

Expected: todos PASS (ou `skipped` com o motivo registrado). Depois: conferir por chat com o dono que o card voltou ao original; se a loja ativa do `teste@teste.com` mudou por qualquer motivo, restaurar e avisar. Achado ⇒ correção na branch (task nova, revisão), `gates.sh`, novo `merge --ff-only`, repetir a QA — o deploy espera. Opcional: `mobile-ui-auditor` (report-only) no mesmo card a 360/390/768.

- [ ] **Step 8: Deploy — SÓ o dono, pelo portão (G-deploy: guardião antes)**

O controlador grava `.superpowers/sheet/deploy-base.txt` (sha do ÚLTIMO deploy, do diário) e `.superpowers/sheet/deploy-lista.txt` (SHAs de front aprovados pelo dono para este deploy — os de outras frentes já juntadas e ainda não publicadas, se o dono aprovar — + os desta frente: `.superpowers/sheet/commits-da-frente.txt`, gravado no Step 6 antes do ff). O dono roda num `/bin/bash --noprofile --norc`:

```bash
MAIN="/Users/sunglee/PLM + Criação/plm-pcp"; WT="$MAIN/.claude/worktrees/sheet-reorg"
cd "$MAIN" && git branch --show-current
prereq_banco_sheet() {  # SÓ LEITURA — o que a branch exige TEM de existir em produção
  local P; P="$(cat /tmp/dburl.txt)"
  chk() { local v; v=$(PGOPTIONS='-c default_transaction_read_only=on' psql "$P" -X -q -A -t -c "$2") || return 1
          [ "$v" = t ] || { echo "PARE (deploy): $1 está na branch mas o banco de produção ainda não tem"; return 1; }; }
  chk "Reorganização do Sheet (7 colunas em modelos)" "select count(*) = 7 from information_schema.columns where table_schema = 'public' and table_name = 'modelos' and column_name in ('titulo_pagina','peso_kg','comprimento_cm','largura_cm','altura_cm','ncm','preco_anterior')" &&
  chk "SKU F3.5a (modelo_skus + tamanho_tipo)" "select to_regclass('public.modelo_skus') is not null and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'modelos' and column_name = 'tamanho_tipo')" &&
  chk "Data da Nota (5 colunas)" "select count(*) = 5 from information_schema.columns where table_schema = 'public' and column_name = 'data_nota_entrada'" &&
  chk "F1/F2 (kanban_automatico)" "select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tenant_config' and column_name = 'kanban_automatico')" &&
  echo "OK (deploy): pré-requisitos de banco existem em produção"
}
portao_deploy_sheet() {
  local sujo fora base lista="$WT/.superpowers/sheet/deploy-lista.txt"
  sujo=$(git status --porcelain --untracked-files=all -- src)
  [ -z "$sujo" ] || { echo "$sujo"; echo "PARE (deploy): mudança em src/ fora de commit — nada é publicado"; return 1; }
  base=$(cat "$WT/.superpowers/sheet/deploy-base.txt" 2>/dev/null) || { echo "PARE: sem deploy-base.txt"; return 1; }
  [ -s "$lista" ] || { echo "PARE: $lista vazio"; return 1; }
  fora=$(git log --format='%H %s' "$base"..HEAD -- src | grep -v -F -f "$lista")
  [ -z "$fora" ] || { echo "$fora"; echo "PARE (deploy): commit de front FORA da lista aprovada — falar com o dono (nada é publicado)"; return 1; }
  prereq_banco_sheet || return 1
  echo "OK (deploy): src limpo e só a lista aprovada vai para o ar"
}
portao_deploy_sheet && npm run deploy
```

Expected: `feature/plan-tecido-a1`, `OK (deploy): pré-requisitos…`, `OK (deploy): src limpo…` e o wrangler sem erro. `PARE` ⇒ nada foi publicado.

- [ ] **Step 9: Docs e memória (docs-keeper; o controlador aplica com o OK do dono)**

`CLAUDE.md` (bloco "Sheet unificado do Planejamento (F3)"): seções 1–15, a REF em "4. Códigos" (com o SKU), a MO dentro de "Preço e Custos", os 7 campos novos (`modelos.titulo_pagina` NULL = automático via `_titulo_pagina_calculado`; peso/medidas/NCM; `preco_anterior` NULL = acompanha o efetivo) — commit `docs(claude-md): …` com `--only`. Docs locais (gitignored): `docs/api-integracao-erp.md` — "título da página = `coalesce(modelos.titulo_pagina, public._titulo_pagina_calculado(modelos.nome, tenants.nome))`; nunca a coluna crua"; `docs/mapeamento-campos-calculos.md` (7 campos + regra do Preço anterior). Memória: `project_sheet_planejamento_reorganizacao.md` + linha no `MEMORY.md`; painel AO VIVO da campanha (ArtifactData) — frente "Sheet reorg" concluída.

- [ ] **Step 10: Avisar as outras frentes**

"Produção e cópia com a reorganização do Sheet: funções|gatilhos 484|277; a volta de emergência da F1 usa agora `VOLTA-F1-POS-SHEET.md` (referência `…_pos_sheet_detalhe.txt`) — a próxima frente encadeia nela (é a mais nova por mtime)."

- [ ] **Step 11: Como voltar (SÓ com OK do dono)**

1. FRONT primeiro: `git revert` dos commits desta frente na `feature/plan-tecido-a1` (um commit de revert, `--only`), `gates.sh`, deploy do revert pelo portão; esperar NO AR e as abas recarregadas (inclusive o `:5173`).
2. Banco: o dono roda `volta-producao.sh` (exporta, frase "APAGAR OS CAMPOS NOVOS", backup, inverso com confirmação, conferência por diferença). Depois, renomear `fidelidade_ref_volta_f1_pos_sheet_detalhe.txt`/`cont_volta_f1_pos_sheet.txt` para `*.desfeita` (a referência volta a ser a anterior — `LEIA-volta-f1-pos-sheet.txt`).
3. Cópia: `SHEET_DONO_AVISADO=sim bash .superpowers/sheet/copia.sh volta`.

- [ ] **Step 12: Limpeza (com OK do dono)**

Copiar `.superpowers/sheet/{copia.sh,n3.sh,mig/,logs/}` para `…/savepoints/pre-apply-sheet-reorg/scripts/` (a volta de emergência precisa deles); `rm -f tests/e2e/sheet-reorg-qa.spec.ts` (só o próprio arquivo); `git worktree remove .claude/worktrees/sheet-reorg`; `git branch -d sheet/reorganizacao`.

---
## 5. Riscos (e o que o plano faz)

| Risco | Evidência | Onde o plano trata |
|---|---|---|
| Front antes do banco | Todo Salvar manda os 7 campos (`...d` + `camposNovosParaPayload`); o `:5173` lê produção | Merge só no Task 10 Step 6, depois da ida (Step 4) e JUNTO com a cópia; portão do deploy confere as 7 colunas |
| `_replicar` reescrita de novo (spec §6) | Corpo inteiro repetido a cada redefinição | Gerada do texto VIVO (dump) + 2 linhas; guarda md5 exata nos 2 arquivos; teste "outra frente" |
| Trava em `modelos` (tabela mais usada) | ADD COLUMN + CHECK = ACCESS EXCLUSIVE + 1 varredura | `ALTER` por último; `lock_timeout` 500 ms / `transaction_timeout` 3 s no arquivo; teste 55P03; horário calmo |
| Título diverge TS × SQL | Locale do banco (cópia en_US.UTF-8; produção pode ser C) | Lista FIXA via `translate` nos 2 lados; 21 fixtures nos 2 lados (conferidas no planejamento: 21/21 TS e 21/21 SQL só-leitura) |
| Cadeia da volta de emergência da F1 | Cada frente precisa gravar a sua referência; a da Nota sem trava pode não existir | `ref_mais_nova` + `confere_cadeia_ref` no pré-voo (antes de aplicar) e depois; PARA e o dono decide (Task 10 Step 4) |
| Selo de MO some ao fechar a seção (spec §6) | A seção própria deixa de existir | Requisitos de MO no selo de Preço (R15); o texto fica no bloco; comunicar ao dono |
| Numeração muda (spec §6) | Tudo depois da 3 muda de número | Comunicar no Step 3 (sem mitigação técnica — é dinâmica por design) |
| ERP lendo `titulo_pagina` cru (spec §6) | NULL = automático | Comentário na coluna + nota no `api-integracao-erp.md` (Step 9) + função com EXECUTE p/ service_role |
| Preço anterior confundido com histórico (spec §6) | Automático acompanha o atual | Texto da obs verbatim + "automático ·/editado ·" na linha |
| MO na tabela estoura no mobile | A tabela rola na horizontal | Bloco `sticky left-0` com a largura visível; QA mede 360/390 |
| QA grava em produção | O `:5173` é produção | Card combinado com o dono, restauração dentro de cada teste, SKU/MO só com OK (R13), nunca troca de loja |
| Conflito com outra frente no mesmo arquivo | Várias frentes no Sheet | Lista permitida + sobreposição (Task 0 Step 8 e Task 10 Step 1) + regra de rebase |

## 6. Dúvidas que só o dono pode responder (levar por chat antes da Task 10 Step 3; o plano segue a recomendação)

| # | Pergunta | Recomendação implementada | Se o dono disser outra coisa |
|---|---|---|---|
| D1 | O "Preço anterior" deve ser travado TAMBÉM no servidor (como o preço de venda — `fn_modelo_preco_venda_gate`)? Hoje só a tela respeita a permissão. | Não nesta frente (R9) — é campo de referência, sem cálculo derivado; entra na frente "Reforço de segurança no banco". | Migration própria que redefine `fn_modelo_preco_venda_gate` (+ testes), depois desta. |
| D2 | O resto da F3.5b — "Tamanho em" nos cards do Plan. Tecido / Produto Acabado / Importado e a grade exibida seguindo a escolha — fica para uma frente separada? | Sim (R10): esta frente faz só a seção "4. Códigos" do Planejamento (inclui o "Tamanho em" do card). | Nova frente (plano próprio). |
| D3 | QA em produção: qual card da Loja Teste usar? E pode gravar SKU à mão / "Regerar" confirmado / adicionar-aprovar-remover serviço de MO nele? | QA abre e cancela esses 3 (R13); edições de Título/NCM/Peso/Preço anterior são feitas e restauradas. | `E2E_SHEET_ESCREVE_SKU=1` / `E2E_SHEET_ESCREVE_MO=1` + passos a acrescentar no spec. |
| D4 | O "Replicar card(s)" deve levar também o "Tamanho em" (`tamanho_tipo`)? Hoje a réplica nasce com o padrão da loja e o SKU dela pode divergir do original. | Não (R14 — a spec fixa os 7 campos). | Uma coluna a mais nas mesmas 2 linhas do gerador (`COL_DEPOIS`/`VAL_DEPOIS`) antes da Task 6. |

## 7. Autorrevisão (cobertura da spec e do brief)

| Requisito | Onde |
|---|---|
| §2/§5.1 Seção 1: L1 Status\|Estilista\|Origem · L2 Nome 50\|Versão 25\|NCM 25 · L3 · L4 Título (auto/editado/↺, nome vazio ⇒ vazio, hint) · L5 · L6 Peso/medidas (casas no cliente, NULL = vazio) | Tasks 4, 5, 8 |
| §2 Seção 2 sem mudança | (nada a fazer; numeração dinâmica) |
| §2/§5.1 Seção 3 "Desenvolvimento" sem REF (Motivo do Cancelamento onde está — R3) | Task 2 |
| §2/§5.1 Seção 4 "Códigos": REF (mesma trava) + "Tamanho em" + tabela SKU (manual, "Falta sigla" + cadastrar, Regerar com AlertDialog, hint, comprado pelo espelho — server-side) | Tasks 1, 2 |
| §2/§5.1 MO dentro de "Preço e Custos" (serviços, aprovar/reprovar, remover, + adicionar, Obs. abaixo do Custo total; revenda = opção A; gate `vis.mao_obra`) | Task 3 |
| §2/ruling 11 Preço anterior (antes do Preço de venda; auto = efetivo; ↺; permissão; revenda = varejo) | Tasks 5, 9 |
| §5.1 renumeração (`ORDEM_SECOES_SHEET` sem `mao_obra`, com `codigos`) | Tasks 2, 3 (teste 1–15) |
| Ruling 1/§5.2 helper SQL + TS espelhados com anti-drift | Tasks 4, 6 |
| Ruling 2/3/4/§5.2 migration aditiva (7 colunas, CHECK ≥ 0, sem CHECK em ncm/preço), inverso que avisa | Task 6 |
| Ruling 5 Duplicar (leva peso/medidas/NCM/descrição; Título e Preço anterior ⇒ NULL) e Replicar (leva os 7 como estão) | Tasks 5, 6 |
| Ruling 7/§5.3 selos (MO no requisito de Preço; selo de Códigos "N SKU(s) sem sigla") | Tasks 1, 3 |
| Ruling 8 Dialog "Novo Modelo" com os campos novos, numerando 1 e 2 | Task 8 (+ R1 p/ a MO) |
| Ruling 9/§5.4 colaboração (Draft, payload direto, `ROTULO_CONFLITO_PLAN`, `data-colab-path`, sem exceção no merge; SKU por RPC com `_rev_base`) | Tasks 2, 5, 8, 9 |
| Ruling 10/§9 sequência A/B/C e ordem de produção | Global Constraints, Task 10 |
| Ruling 12/§8 fora de escopo (sugestão de NCM, Dev, Ficha Técnica, exportação ERP) | Não implementados; Dev intocado no `gates.sh` |
| §7 testes unit / integração (só cópia) / QA | Tasks 1–9 (unit), 6 (integração), 10 (QA) |
| Brief: migration `20261005100000` (20261004100000 reservado), ordem Nota sem trava → esta | Global Constraints, `prevoo_sheet` (`SEM_TRAVA_OK`) |
| Brief: referência da volta da F1 a partir da MAIS NOVA, sem cravar nome, PARA se não bater | Task 7 (`ref_mais_nova`/`confere_cadeia_ref`, `ref-volta-f1.sh`) |
| Brief: 483\|277 → 484\|277 | Global Constraints, `confere_ida_sheet`, testes |
| Brief: md5 de `_replicar` lido NA CÓPIA (não cravado); `BEGIN` + 2 `SET LOCAL`; guarda exata; `IF NOT EXISTS`; inverso avisando; ACL `has_function_privilege` | Task 6 |
| Brief: scripts no molde (regex ancorada, `umask 077`, `unset EXTRA_SQL`, backup public+auth com TABLE DATA>0 e `pg_restore -l`, md5 revisado + `aplica_v2`, pós-condições antes de "IDA OK", volta por diferença, RODAR em pasta 700; dono aplica) | Task 7 |
| Brief: integração só com `DATABASE_URL` local + caminhos literais; nunca `\i`; provas só com fakes | Global Constraints, Tasks 6, 7 |
| Brief: tela (build + tsc, anti-drift, DateField/MoneyInput/token, Sheet, colab, mobile, QA :5173 sem semear e sem trocar loja; não matar :5173/:5188) | Global Constraints, `gates.sh`, Task 10 |
| Brief: git `--only`, sem stash/add ./pkill/push | Global Constraints, `regras.md` |
| Brief: SDD Sonnet + Opus; banco com 2 Opus independentes + guardião | §4, Tasks 6–7, 10 |
