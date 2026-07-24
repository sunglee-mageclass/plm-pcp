# CLAUDE.md — sisTrama

Contexto do projeto para sessões do Claude Code. Leia antes de qualquer tarefa.

## O que é

**sisTrama** (de *sistema* + *trama*) — um PLM + PCP para confecção de moda.
Gerencia o fluxo inteiro: cadastro de materiais → criação/desenvolvimento →
produção → financeiro. Sistema **multi-tenant** (várias lojas isoladas), modelo
**SaaS por loja** (cada loja liga só os módulos que usa).

Nome de exibição: **sisTrama** ("sis" leve, "Trama" em destaque). A renomeação do
antigo "PLM+PCP" já foi feita (0 ocorrências em `src/`).

## Stack

- **Vite** + **React** + **TypeScript**
- **TanStack Router** (file-based em `src/routes/`) + **TanStack Query**
- **Supabase próprio** (Postgres + RLS + Storage + Auth) — ref `ruinwcuabilumcspeyjk`
  (o app NÃO usa mais nem o banco nem a auth do Lovable; login Google via OAuth do
  próprio Supabase — ver regra 2)
- **Tailwind** + **Radix UI** (componentes shadcn em `src/components/ui/`)
- **zod** · **date-fns** · **recharts** · **lucide-react**

Fontes: **Outfit** (display) e **Figtree** (corpo). Paleta oklch no `styles.css`
(navy/azul-aço; vermelho = destructive).

Scripts: `npm run dev` · `npm run build` · `npm run lint` · `npm test` (Vitest:
unit + integração transacional de RPC — ver `tests/README.md`)

## ⚠️ Regras críticas de ambiente

1. **O banco é um Supabase próprio** (ref `ruinwcuabilumcspeyjk`), não mais o
   Lovable Cloud (migração feita em 06/2026). Mudança de schema/RPC/policy:
   **eu escrevo a migration em `supabase/migrations/` e aplico DIRETO** com
   `supabase db push --db-url "..."` ou, mais simples, `psql "$(cat /tmp/dburl.txt)" -f <migration>`.
   `supabase/config.toml` já aponta pro ref **CORRETO** (`ruinwcuabilumcspeyjk`,
   corrigido em 26/06/2026 — antes apontava pro antigo `wccapbvbbejjzpvlvyuf`).
   Mesmo assim, aplique migration por `psql "$(cat /tmp/dburl.txt)" -f <arq>` (Session
   pooler/IPv4; senha dentro da URL — `/tmp/dburl.txt`, senha em `/tmp/dbpass.txt`):
   é o caminho usado/testado aqui. Não há projeto `supabase link`ado nem CLI em CI.
   `psql "$(cat /tmp/dburl.txt)"` serve p/ inspeção e p/ **teste transacional revertido**
   de RPC (`BEGIN; SELECT set_config('request.jwt.claims', json_build_object('sub','…')::text, true); …; ROLLBACK;`).
   Ao alterar função existente, **diff-validar**: `pg_get_functiondef` antes/depois.
   Não é mais necessário entregar SQL pro Lovable. Frontend flui via `git push`.
   ⚠️ **Migration DESTRUTIVA** (`DROP COLUMN`/`DELETE`/`DROP TABLE`/consolidação de dados):
   envolva o arquivo em `BEGIN; … COMMIT;` — `psql -f` roda em autocommit por statement, então
   uma falha no meio (ex.: trigger citando a coluna dropada) deixa o schema pela metade e comita a
   perda. Escreva também idempotente (guards `IF EXISTS`/`IF NOT EXISTS`) pra poder reaplicar.

2. **Auth é do próprio Supabase (NÃO mais do Lovable).** Verificado 25/06/2026:
   NÃO existe `src/integrations/lovable/` nem referência a `/~oauth/initiate` no
   código (grep = 0). **Login é SÓ e-mail/senha** (`signInWithPassword`) em
   `src/routes/auth.tsx` — **o acesso é por convite** (super_admin cria os usuários
   em `/admin/usuarios`). Removido em 26/06/2026: o tab "Criar conta" (`signUp`) e o
   **login via Google** (`signInWithOAuth`) — não há mais auto-criação de conta.
   Resíduos do Lovable são só cosméticos: hosting/SEO em `sistrama.lovable.app` e
   telemetria opcional no-op (`lovable-error-reporting.ts`). (Strings/banners herdados
   "Connect Supabase in Lovable Cloud"/"automatically generated" foram limpos em 29/06/2026.)

3. **Um piloto por vez.** Não editar no Lovable e no VS Code ao mesmo tempo.
   Sempre `git pull` antes; `git push origin main` ao terminar.

4. **Antes de cada commit, rode `npm run build`.** ⚠️ `vite build` **não roda tsc** —
   depois de mexer em imports/identificadores, `npx tsc --noEmit 2>&1 | grep TS2304`
   para pegar identificador indefinido (vira ReferenceError em runtime).

## Arquitetura multi-tenant

- Cada usuário pertence a um tenant via `public.users.tenant_id`.
- RLS via helpers SQL: `get_user_tenant_id()` (retorna **UUID sentinela nil** p/ loja
  inativa, NUNCA NULL), `is_super_admin()`, `is_tenant_admin()`, `meu_tenant_ativo()`,
  `has_role()`. Toda tabela de negócio filtra por `tenant_id`.
- Roles: `super_admin` (gestão global de lojas/usuários — quem cria, ativa/inativa,
  **reseta** e **exclui** loja; atribui o admin da loja), `tenant_admin` (admin da loja)
  e permissões por-página em `user_permissions` (canView/canEdit, respeitado na sidebar).
- **Modularização**: 7 módulos liga/desliga por loja em `tenant_config.modules` (jsonb):
  `cadastro, entrada_saida, criacao, producao, financeiro, dashboard` + **`otb`** (hook
  `useTenantModules`). ⚠️ **`otb` é OPT-IN (default OFF)** — sobrescrito p/ `false` em
  `useTenantModules.DEFAULTS` E `admin/lojas.tsx MODULE_DEFAULTS` (o fallback genérico é
  `?? true`; sem isso, chave ausente ligaria por engano). Loja sem `otb` = Coleção é texto
  livre (como antes); com `otb` = Coleção vira dropdown das `colecoes`. **Modos da loja** em `tenant_config`: `modo_oc_rolo ∈ {oc,rolo,ambos}`,
  `modo_baixa_estoque ∈ {por_oc,automatico}`, `timezone` (`useStoreTimezone`).

## Mapa de rotas (`src/routes/_authenticated/`)

- **otb** (opt-in): orçamento de coleção antes do Planejamento (`otb.index.tsx`). Coleção é
  entidade dona (`colecoes`/`colecao_semanas`/`modelos.colecao_id`). Hierarquia **coleção → subcoleções
  (`colecao_subcolecoes`) → semanas×qtd** (`colecao_semanas.subcolecao_id`, NULL = modo simples sem
  subcoleção). O card (`ColecaoSheet`) tem Nome de Coleção + blocos de subcoleção (nome + Semanas 1–5 c/ qtd).
  Cada semana pode ter **distribuição por categoria** (`colecao_semana_categorias`, chave por coleção/subcoleção/
  semana/categoria; soma fecha com a qtd da semana — validado na UI e no diálogo "Categorias da semana", botão ao
  lado da qtd). **Confirmar (`otb_confirmar`) só marca `colecoes.status='confirmada'` — NÃO cria nem apaga cards.**
  O plano (qtds nas semanas/categorias) é um **alvo fixo**: após confirmado, o usuário cria/edita/exclui cards
  livremente no Planejamento sem que o OTB se ajuste automaticamente. **O sync bidirecional
  (`fn_otb_sync_semana`/`trg_otb_sync_semana`) e a trava GUC `app.otb_reconciling` foram REMOVIDOS** — o trigger
  não existe mais no banco. RPC `otb_importar_colecoes`. Distribuição por categoria pode ser **parcial**
  (Σcat ≤ total; o **resto** vira cards sem categoria); o `ColecaoSheet` tem um bloco **"Não classificados"**
  (cards sem semana/subcoleção) com **Atribuir** direto → RPC `otb_atribuir_card`.
  **Realizado = contagem viva de cards** via RPC `otb_orcamento` (queryKey `["otb-orcamento"]`): retorna shape
  `{colecoes, subcolecoes, niveis3}` com `{total, realizado, over}` por bucket (coleção/subcoleção/linha-ou-categoria).
  **Divergência**: `realizado > total` no nível da **coleção** → linha vermelha na lista + `sidebar_badges.otb_divergencia`
  (bolinha vermelha no ícone OTB na sidebar); sub-níveis estourados aparecem em âmbar. O hook `useOrcamento()` e o
  componente `OrcamentoTag` (em `src/components/otb/orcamento.tsx`) consomem essa RPC. Para que os contadores se
  mantenham em dia, as mutations de criar/editar/excluir `modelos` no Planejamento invalidam `["otb-orcamento"]`
  em seu `onSuccess`. `modelos.subcolecao` (texto): no Planejamento/
  Desenvolvimento vira **dropdown das subcoleções da coleção** quando OTB ligado (senão texto livre). Preenchimento
  em massa no Planejamento (`BulkEditDialog`). O Planejamento abre **sempre com 5 colunas** (`useGridCols(...,5,true)`
  — não persiste); card mostra coleção→subcoleção→semana→mês/ano.
  **2º fluxo — Por Poder de Venda** (top-down, jul/2026; escolhido num seletor de TIPO no "+ Nova Coleção"):
  `colecoes.tipo ∈ {orcamento,poder_venda}`. **É POR LINHA — SEM categoria/subcategoria** (reestruturado jul/2026,
  `2f25249`). Herda um **"Padrão do mix"** (`mix_padroes`/`mix_padrao_linhas`, VÁRIOS por loja; markup lido do cadastro
  `linhas`, nunca copiado) via `salvar_mix_padrao`. Por linha no padrão: **`num_modelos`** (a **% é DERIVADA** = nº÷Σ das
  normais; NÃO existe mais coluna `pct`), **`a_parte`** (linha "à parte" = 100% sozinha, ex.: Acessórios; as demais somam
  100%), `prof_cor`, `cores`, faixa `preco_min`/`preco_max`. (`mix_padrao_categorias` foi DROPADA.) **Cada linha só 1×
  no padrão** (dropdown esconde as usadas + `salvar_mix_padrao` barra duplicata). Itens em `colecao_pv_itens` (1 por
  **subcoleção×linha**, com prof/cor+cores+preço+**`a_parte`**+`qtd_semanas` jsonb; SEM `categoria_id`/`subcategoria1_id`);
  RPC `salvar_colecao_pv`. Árvore **Subcoleção ▸ Linha × Semana 1–5** (1 mês dos atributos + semanas), tudo EDITÁVEL em
  cima do padrão; **o `num_modelos` do padrão é DISTRIBUÍDO** ÷ nº de subcoleções e repartido nas semanas de cada uma
  (`splitEven`; recalcula ao add/remover subcoleção e trocar semanas); **"à parte" é editável POR LINHA na coleção**
  (`colecao_pv_itens.a_parte`); poder de venda = Σ(preço médio × prof×cor × qtd) POR LINHA; "mix % real vs meta" respeita
  o à-parte. **Data de lançamento é POR SEMANA** (`colecao_subcolecoes.datas_semanas` jsonb {semana:data}; semanas do
  CALENDÁRIO seg–dom derivadas do mês/ano via `date-fns`, editáveis; **bidirecional**: dá pra definir a DATA e o sistema
  retorna a semana (`semanaDaData`); **subcoleção nova nasce SEM semanas** selecionadas; `data_lancamento` single vira fallback). **Confirmar
  = `otb_confirmar_pv`**: bucket=(**subcoleção×linha×semana**), target=SOMA das qtd/semana, mesma reconciliação de cards
  em branco/órfãos (sem trava GUC — removida); cada card nasce com linha/subcoleção/semana + **a data da SUA semana**
  (datas_semanas->>semana), **preço E categoria em branco** (categoria vira decisão do Planejamento).
  Trigger `enforce_pv_itens_tenant` NÃO referencia mais cat/sub. Telas em `/otb-beta` (Padrão do mix) e
  `/otb-beta-colecao` (editor PV) — ainda rotuladas "beta".
  **Simulador de Uso de OC (`SimulacaoSheet`) — REMOVIDO da UI (jul/2026, Fase C do Plan. Tecido).**
  A capacidade migrou p/ **Plan. Tecido** (`/criacao/plan-tecido`, ver [[project_plan_tecido]] na memória): o Resumo
  já mostra necessidade × estoque × a receber × **coberto por OC** × falta. Removidos: `SimulacaoSheet.tsx`,
  `src/lib/simulacao.ts` (+teste), botão Simular no `otb.index`. **DEFERIDO — rodada 2 destrutiva** (ainda no banco):
  DROP das tabelas `otb_simulacoes/_unidades/_variantes/_linhas/_modelos` e RPCs `salvar/excluir/aplicar_simulacao`.
  ⚠️ `cores` do PV continua editável DIRETO no editor PV (`ColecaoPVSheet`) — a remoção do simulador não quebra isso.
  Front acessa tabelas/RPCs novas com `as any` (types.ts pendente de regen — precisa `supabase login`).
- **cadastro**: atributos (categorias tecido/aviamento/material/subcategoria, linhas,
  categorias de serviço fixas Corte/Oficina), colaboradores, servicos, tecidos
  (+variantes), aviamentos. **Fornecedor** (cadastro Tecido/Aviamento + OC Tecido/Aviamento):
  dropdown ÚNICO `FornecedorSelect` (`src/components/shared`) lista **empresa (direto)** E cada
  **representante** dela — grava `(empresa_id, representante_id)`. Filtra empresas por `tipo='material'`
  + categoria de fornecedor casada por **TOKEN flexível** (`src/lib/fornecedor-categoria.ts`:
  normaliza sem acento/minúsculo + substring; `FABRIC_TOKENS` inclui `artigo`) — NÃO casar o nome
  exato da categoria (é texto livre por loja; hard-coded `["Tecido"...]` sumia quando a loja renomeava).
  `artigos`/`aviamentos` têm `representante_id` (FK `representantes`)
- **criacao**: **plan-tecido** (Plan. Tecido — planejamento de TECIDO por coleção, acima de Plan. Produto;
  ver [[project_plan_tecido]] e docs/mapeamento §2C. NÃO mesclado — branch `feature/plan-tecido-a1`),
  planejamento, desenvolvimento (kanban dinâmico, ficha técnica, observações).
  No card (`ModeloDetailPanel`), a seção **"2. Ajustes na Prova"** é um FIO DE COMENTÁRIOS
  (tabela `modelo_prova_comentarios`, RPCs `prova_comentar`/`prova_resolver`/`prova_excluir`;
  fio de 2 níveis via `parent_id`, abas Abertos/Resolvidos, excluir só-autor, badge nº abertos).
  A coluna `modelos.ajustes_prova` virou LEGADA (dropar depois). Ver [[project_ajustes_prova_comentarios]].
  O card tem **"Importar dados"** (cabeçalho, só com card editável): copia de outro modelo por áreas/itens
  (obs técnicas manual, obs bloco, tecidos/forros/entretelas granular, aviamentos, insumos, grade, custos
  adicionais). É **staging** — preenche o rascunho (realce amarelo que some ao editar; só o Salvar grava via
  `salvar_modelo_bom`), com AlertDialog de sobrescrita. Regras: **sem OC-links**, **Grade só com Variantes do
  Tecido**, anexos/identidade/Ajustes fora. Exceção: **obs bloco grava na hora** (substitui, idempotente) por o
  `ModeloObservacoes` ser auto-save. `src/components/desenvolvimento/importar/` (`construirCopia` pura + testes).
- **entrada-saida**: oc-tecido, oc-aviamento, rolos, estoque
- **producao**: cad, terceirizados=**Serviços** (abas pré/pós-costura por `categorias_terceirizado.etapa`),
  oficina, cq (abas **Pré/Pós** dentro do item — ver invariante 6), direcionamento, lancamentos.
  (A tela **"Consumo por OC" foi REMOVIDA** jul/2026 na Fase C do Plan. Tecido — ver [[project_plan_tecido]];
  os **alertas de CQ de tecido** seguem vivos em `entrada-saida.alertas-tecido`, não eram parte dessa tela.
  RPC `consumo_por_oc` ainda no banco até a rodada 2 destrutiva.) **Acabamento aposentado** (virou serviço pós-costura) — o
  código morto foi REMOVIDO (jul/2026, commits `2bdfcf2` front + `600cf54` banco): rotas
  `producao.acabamento.*`, permissão `producao_acabamento`, ramo `oficina_posicao`, tabela
  `producao_acabamento` (0 linhas), RPC `salvar_acabamento` e coluna `tenant_config.oficina_posicao`.
  **Mantidos de propósito** (não são resíduo): o literal `WHEN 'producao_acabamento'` em `fn_audit` (rótulo
  de linhas históricas do audit_log) e as colunas `modelos.categoria_secundaria_id` / `categorias_produto.sla_oficina`
  / `tenant_config.etapas_acabamento` (têm dado ou leitor vivo). Se um laudo/doc antigo cita "Acabamento", é
  histórico. Editor de Impressão REMOVIDO (Ficha de Corte usa sempre o cabeçalho padrão `FichaHeader`)
- **financeiro**: calendário + lista + parcelas (a pagar) + serviços terceirizados
- **dashboard**: 7 abas (coleção, estoque, produção, financeiro, custos, **comercial**,
  **leadtime**). *Comercial* = poder de venda/margem (Planejado vs Realizado, colunas
  agrupadas). *Leadtime* = tempo por etapa vs ideal, em ordem de FLUXO **Planejamento →
  Desenvolvimento (por coluna do kanban, via `modelo_kanban_historico`) → Produção** (marcos +
  Serviços macro OU micro por categoria). Config `tenant_config.leadtime` (`{etapas:[{key,tipo,
  idealDias}], slaServico}`) em `/admin/configuracoes` escolhe quais etapas + ideal (sem config =
  todas default 7d/5d). Cards (médias, RPC `dashboard_leadtime`) + **matriz item × etapas** (RPC
  `dashboard_leadtime_itens`, tracking individual) sob **um filtro global** (coleção/subcol/semana).
  **SLA de Serviços por item**: `subcategorias1_produto.sla_oficina` (rótulo "SLA de Serviços") vira
  o prazo da etapa apontada por `slaServico`; opções = serviços de confecção (`src/lib/servico-
  confeccao.ts`). Cada aba é permissão própria (`dashboard_comercial`/`_leadtime`)
- **admin**: lojas (criar/editar/reset/excluir), usuarios, usuarios-loja, configuracoes
  (módulos, modos, fuso, card de Integração ERP)

## Convenções de código

- Telas grandes quebram em `src/components/<modulo>/<modulo>-detail/`.
- Helper `artigoLabel()` formata nome de artigo com unidade `[metro]/[kg]`.
- Queries via TanStack Query; **queryKey única por tela** (key compartilhada já causou bug
  no financeiro). Ao ler artigo/variante, **prefira embed do Supabase** a cruzar 2 queries.
- Upload sempre por `tenantPrefix()` (`@/lib/storage-tenant`); leitura por `useSignedUrl`.
  ⚠️ Na **key** do Storage, o nome do arquivo tem que passar por `sanitizeStorageName()`
  (`@/lib/storage-tenant`) — acento/espaço/símbolo dão `Invalid key` (ex.: `Véu - 2060.jpeg`).
- Não usar `localStorage` em lógica de auth/tenant — vem do contexto/Supabase.
- **UI de edição — PADRÃO DO SISTEMA** (docs/design/ui-padroes.md §A/§G; NÃO reinventar):
  - **Guarda de "alterações não salvas"**: todo form com Salvar usa `useUnsavedGuard({dirty,
    onClose?, blockNav?})` + `<UnsavedChangesGuard confirm message>` (só o AlertDialog "Descartar
    alterações?") de `@/components/shared/UnsavedChangesGuard`, e `useDirtySnapshot` (`@/hooks`) p/
    detectar `dirty`. O SELO âmbar é INLINE no header via `<UnsavedIndicator show={dirty}>` (topo-dir).
    ⚠️ `useUnsavedGuard` já faz `enableBeforeUnload` gated (o default do `useBlocker` é `true` e ignora
    o shouldBlockFn — sem gate, o prompt nativo dispara em toda tela).
  - **Container**: editar registro existente = **Sheet** (`side=right` ~70vw); criar/novo/config =
    **Dialog**. **Ações** numa barra STICKY no rodapé, TODOS os tamanhos, ordem **Voltar (esq, ArrowLeft)
    · Excluir (destructive) · Salvar (ml-auto)** — nunca no header; página inteira usa
    `<PageActionBar>` (portal, `pb-24` no container). **Header** com `<Breadcrumb>` "Módulo › Tela ›
    Entidade". Modais persistentes que só existem quando abertos: montar `{open && <Modal/>}` p/ nascer limpo.

## Invariantes a preservar (não regredir)

Padrões já corrigidos/estabelecidos. **Antes de afirmar que algo está quebrado, `git pull`
e verifique** — o repo muda rápido.

1. **Parcelas (OC)** — salvar itens ANTES de `status='recebido'` (comentário "CRITICAL"
   em `oc-aviamento.tsx`). `recalcular_parcelas` distribui `total − Σ(pagas)`; é automática
   via trigger p/ **tecido** (`recalc_parcelas_on_valor` em `ocs_tecido` ao mudar
   `valor_real_total`) E **aviamento** (`trg_recalc_parcelas_aviamento` em
   `ocs_aviamento_itens`, só quando a OC já está 'recebido'). **Parcela a pagar (prazo
   30/60/90) ≠ `parcelas_recebimento` (entrega).** ⚠️ O cliente (`authenticated`) só tem
   UPDATE em `parcelas(data_vencimento,status,data_pagamento,comprovante_url)` — `valor`/
   `numero_parcela` são só-derivados das geradoras (DEFINER, owner=postgres). Vencimento de
   parcela PAGA é bloqueado no front (não muta conta quitada). `servicos_financeiro` (DEFINER
   que sincroniza `parcelas_servico` na leitura) tem EXECUTE revogado de PUBLIC/anon; e
   `parcelas_servico` tem o modgate RESTRICTIVE do módulo `financeiro` (igual `parcelas`).
2. **Storage por tenant** — todos os buckets via `(storage.foldername(name))[1] =
   get_user_tenant_id()`; uploads via `tenantPrefix()`.
3. **Itens de OC** — diff incremental por id (update/insert/delete seletivo); IDs preservados.
4. **Estoque** — físico = recebido − baixa POR ITEM; baixa **sempre** no ledger
   `estoque_tecido_baixas` (nunca subtrair de coluna agregada). Reserva por `grade_total`/
   `variante_numero`. "- Metragem" = baixa de ajuste. **Fonte única = `_estoque_tecido_core`**:
   a tela (`estoque_tecido`), `estoque_tecido_por_artigo`, o dashboard (`dashboard_estoque`,
   `_dashboard_estoque_parado_core`) e `detalhe_estoque_variante` TODOS rolam esse core — nenhum
   re-implementa a conta (senão dá drift, ex.: ignorar `estoque_zerado` → +147 m fantasma).
   **Zerar um lote (`estoque_zerado`) libera só o FÍSICO daquele lote (receb/baixa por item),
   NÃO a reserva** (reserva = demanda de modelo/OS, não pertence a lote) — antes colapsava a
   reserva da variante inteira. `previsto` NÃO é clampado (pode ficar negativo: reserva > físico
   é sinal legítimo, ex.: cortou mais que comprou / lote zerado); só `fisico` clampa em ≥0.
   ⚠️ Excluir tecido/cor (Cadastro > Tecidos) é **só via RPC com guarda** `excluir_tecido`/
   `excluir_variante_tecido` (contam uso em OC/estoque/modelo/CAD/ordem e bloqueiam; senão
   apagam e devolvem as fotos p/ limpar storage DEPOIS). `estoque_tecido_baixas.variante_tecido_id`
   é **NO ACTION** de propósito (era CASCADE — apagava o ledger em silêncio); NÃO voltar p/ CASCADE.
   Índice único parcial `(artigo,cor,apelido)` barra variante duplicada; categorias via
   `set_artigo_categorias` (atômico).
5. **Rolos** — `ocs_tecido.is_rolo` (estoque físico por rolo); RPC `criar_rolo`; separar =
   baixa `separacao_rolo` (reversível); `modo_oc_rolo` filtra o que aparece no Desenvolvimento.
   ⚠️ **Excluir rolo é SÓ via RPC com guarda** `excluir_rolo` (`_rolo_em_uso` = EXISTS baixa no
   item do rolo OU vínculo de Dev → RAISE). O `.delete()` cru em `ocs_tecido` cascateava
   `ocs_tecido_itens → estoque_tecido_baixas` (ON DELETE CASCADE) e apagava o LEDGER em silêncio
   p/ rolo consumido/vinculado (mesma classe do #4). Rolo livre exclui ok (a baixa `separacao_rolo`
   fica no item de ORIGEM e volta pra OC via cascade do `rolo_id`).
6. **CQ** — `salvar_cq`/`desmarcar_cq` fazem status + `cq_variantes` + grade real numa txn.
   `salvar_cad_completo` PRESERVA a grade real quando o CQ do CAD está confirmado. CQ de
   tecido em `ocs_tecido_itens.cq_*` + página Alertas (`cq_alerta_status`: troca/cancelar).
   **Regras do `_salvar_cq_core`/`_desmarcar_cq_core` (jul/2026, `7ab1b1c`):** [C1] NÃO confirma
   com Σ da grade real = 0 (não dá pra "confirmar" sem contar peça); [Σ] `grade_total`
   (`cq_variantes` + `cad_grades` planejada/real) é DERIVADO no servidor da soma do mapa de
   grades — nunca confia no escalar do cliente (alimenta custo real e dashboards); [M2] desmarcar
   o Pré REBAIXA o Pós (`status_pos` confirmado→pendente), que se apoiava naquela grade real.
   **CQ Pré/Pós (Fase 3):** 2 visões DENTRO do item. **Pré** = o de sempre (status, `cq_variantes`,
   grade real → `cad_grades`). **Pós** (acabamento) = `controle_qualidade.status_pos` + tabela
   `cq_pos_variantes` (serviço pós-costura × variante × etapa), RPCs `salvar_cq_pos`/`desmarcar_cq_pos`
   que **NÃO** tocam `cad_grades` (só exibem a grade real do Pré) — wrappers com EXECUTE revogado de
   PUBLIC/anon (só authenticated), igual ao Pré. O Pós **espelha as guardas do Pré** (jul/2026):
   `grade_total` DERIVADO no servidor da soma do mapa `grades` (não confia no escalar do cliente) e
   **não confirma com Σ=0** ([C1]/[Σ]). Gates: Pré abre com pré finalizado; Pós com pós
   finalizado. **Gate downstream ÚNICO `cqLiberado()` (`@/lib/cq-status`)** = Pré confirmado E (se há
   serviço pós-costura ativo) Pós confirmado; consumido por **Direcionamento, "Lançar" (Planejamento) e
   Lançamentos** — não duplicar o predicado. "Sem acabamento" = `cad.sem_acabamento` (Pré finalizado
   vira Finalizado sem pós). **"Lançado" tem fonte ÚNICA = `modelos.lancado`** (setado por "Lançar" no
   Planejamento, gated por `cqLiberado`). A tabela `lancamentos` está APOSENTADA (o botão de foto-amostra
   saiu em 18/jun; nada mais a popula) — não reintroduzir dependência dela. Os dashboards derivam "Lançado"
   de `m.lancado`: `_dashboard_producao_core` (etapa da timeline, era `EXISTS(lancamentos)`) E
   `_dashboard_colecao_core` (KPI "Lançados"/"Em Produção", era "CQ Pré confirmado" — unificado jul/2026). Trigger `trg_rebaixa_lancado_cq` em `controle_qualidade`: desmarcar o CQ
   (Pré ou Pós → deixa de estar liberado) rebaixa `modelos.lancado=false` + acende `#Erro` na etapa
   'lancamentos' (espelha o #10 do Direcionamento).
7. **1 CAD por modelo** — garantido por TRIGGER `enforce_unique_fk` (NÃO por UNIQUE, ver
   "O que NÃO fazer"). Enviar ao corte (`baixar_estoque_tecido_corte`) é atômico e retorna
   `deficit[]` por variante.
8. **Serviços no financeiro** — serviços terceirizados externos viram contas a pagar
   (`parcelas_servico` + RPC `servicos_financeiro`); oficina entra após CQ confirmado.
   **Aprovação de mão de obra (jul/2026):** consolidada num flag POR MODELO
   `modelos.custo_terceirizados_aprovado` (`true`/`false`/**`null`=pendente**, 3 estados),
   aprovado/reprovado nos ícones do **card do Planejamento E do Plan. Tecido** (mesmo flag; jul/2026)
   — a **lista do Desenvolvimento** mostra badge "Custo aprovado" (verde) / "Custo reprovado" (vermelho).
   O checkbox por-bloco `producao_terceirizados.aprovado` foi APOSENTADO — coluna órfã. **Lançar (`lancar_modelo`)
   exige CQ liberado E mão de obra aprovada** (gate no servidor + pré-check no detalhe); o
   botão-foguete do card lança/cancela com data. `custo_unitario_modelos` devolve
   `mao_obra_previsto`/`mao_obra_real` → o card separa **materiais (= total − mão de obra)** da
   mão de obra, trocando previsto→real quando pronto/lançado. **Markup/Preço seguem no custo
   TOTAL** (materiais + mão de obra) — não mexer em `preco.ts`.
9. **Segurança / RPC** — padrão **wrapper + `_core`**: o wrapper checa
   `user_can_view(_pagina)` (dashboards) ou `tenant_module_enabled(_module)` (módulos
   desligáveis) e o `_core` tem EXECUTE revogado. ⚠️ **Revogue dos TRÊS: `REVOKE EXECUTE ON FUNCTION
   public._xxx_core(...) FROM PUBLIC, anon, authenticated;`**. O default ACL do Postgres concede EXECUTE a
   **PUBLIC** (`proacl = {=X/…}`), e `anon`/`authenticated` **HERDAM de PUBLIC** — revogar só de
   anon/authenticated é INÓCUO (o PUBLIC continua). Confira sempre com
   `has_function_privilege('anon'|'authenticated','_xxx_core(args)','EXECUTE') = false`. Pior quando o `_core`
   recebe o tenant/id por **parâmetro** e não valida o chamador (fura módulo E multi-tenant). Regressão real:
   `_estoque_aviamento_core` do M2 revogou só anon/authenticated, PUBLIC ficou → IDOR de leitura cross-tenant
   por anon (corrigido em `20260708170000`; era o CQ Pós de novo, agora documentado certo). Loja inativa = suspensão real
   (sentinela nil → RLS bloqueia + RPCs dão RAISE). `reset_loja`/`excluir_loja` são
   super_admin-only; `_wipe_tenant_core` usa `session_replication_role=replica` (FKs p/
   `tenants` são NO ACTION); super_admins nunca são apagados.
10. **Direcionamento** — split da Grade Real em E-commerce (digitado) + Loja Física.
    O split é **derivado e travado no SERVIDOR** (`_salvar_direcionamento_core`): lê a
    grade real autoritativa de `cad_grades.grades_reais` (ignora real/loja_fisica/totais
    do cliente), garante `ecommerce ≤ real` por tamanho (`salvar_direcionamento`=rascunho
    clampa; `confirmar_direcionamento`=RAISE) e recomputa `loja_fisica`+totais por soma —
    invariante `Σec + Σloja = Σreal`. **Confirmar é atômico** (`confirmar_direcionamento`
    = save strict + `cad.direcionamento_status='separado'` numa txn; NÃO fazer save+update
    separados no front) e **exige CQ liberado no SERVIDOR** (`_cq_liberado(_cad_id)`, espelho de
    `@/lib/cq-status` — Pré confirmado E, se há serviço pós-costura ativo, Pós confirmado; jul/2026:
    fecha o bypass de confirmar via URL direta sem passar pelo filtro da lista). **Grade real defasada rebaixa**: trigger `trg_rebaixa_direcionamento_grade`
    em `cad_grades` — se a grade real muda (CQ confirmar/desmarcar/reconfirmar) e o
    Direcionamento estava 'separado', volta a 'pendente' + acende `#Erro` na etapa
    `direcionamento` (espelha o M2 do CQ). 2º lote NÃO entra no split (a grade real já o
    desconta). ⚠️ A queryKey `["cad-grades", cad?.id]` é **compartilhada** por Direcionamento
    (sufixo `"reais"`) e Oficina (`"full"`) com `select` de colunas diferentes — sufixo por
    consumidor evita shape errado; o CQ invalida por prefixo (casa ambos).
11. **REF automática do modelo** — ao CHEGAR em Desenvolvimento (`ordem_criacao_enviada=true`) a REF
    é gerada por trigger `fn_modelo_ref_auto` (`BEFORE INSERT/UPDATE`, DEFINER): sigla = Grupo (2
    iniciais; multi-palavra = inicial de cada, "One Piece"→OP) + Categoria (1ª letra) + Subcategoria1
    (2 letras se 1 palavra; inicial de cada palavra se 2+, "Manga Curta"→MC) + nº de 8 dígitos (contador
    ÚNICO por loja de 10000000, `pg_advisory_xact_lock` por tenant). Guardada na **coluna sombra
    `modelos.ref_auto`** enquanto NÃO 'aprovado' (nº fixo na chegada; sigla RE-SINCRONIZA com grupo/cat/
    subcat — a subcategoria só é definida durante o Dev); ao **aprovar** copia `ref_auto → ref` (só se
    `ref` vazio). Assim toda exibição lê `modelos.ref` (vazio até aprovar = "só exibida quando aprovado")
    e o campo segue editável (REF manual, fora do padrão `[A-Za-z]+[0-9]{8}`, nunca é re-sincronizada nem
    sobrescrita). Helpers `_ref_norm`/`_modelo_ref_sigla`/`_modelo_ref_next_num` com EXECUTE revogado (#9).
    Ver memória `project_modelo_ref_auto`.

**Docs de referência LOCAIS (gitignored, manter atualizados — papel do agente `docs-keeper`):**
`docs/mapeamento-campos-calculos.md` (campos×campos, fórmulas, etapas),
`docs/plano-de-ataque.md` (auditoria das 7 frentes + Fases; rastreia o feito) e
`docs/api-integracao-erp.md` (leitura p/ ERP: o quê + quando o dado é final). Ler/atualizar
ao mexer em consumo/grade/estoque/custo/financeiro/CQ.

**Motor de regras do kanban (transição de status no Desenvolvimento):** requisitos de ENTRADA
por status (todos em E). SSOT do catálogo de condições = `src/lib/kanban-condicoes.ts` (config
e enforcement leem daí; NÃO duplicar em doc). Avaliação por modelo na RPC `avaliar_condicoes_kanban`;
config guarda `tenant_config.status_kanban[i].requisitos`. **Ao adicionar condição/módulo:**
catálogo TS + branch na RPC — o **teste anti-drift** (Vitest) falha se as chaves não casarem.
Enforcement no Select de status E no arraste (colunas inválidas esmaecidas). Atualizar este bloco +
a memória a cada mudança (papel do `docs-keeper`). ⚠️ A condição `servico_aprovado` (key histórica,
label **"Aprovação de custo"**, módulo **Planejamento**) foi REPONTADA (jul/2026) p/
`coalesce(modelos.custo_terceirizados_aprovado,false)` — null/false não liberam; key MANTIDA
(requisitos já configurados + anti-drift seguem). Condição `grade_todas_variantes` (Desenvolvimento):
toda variante do Tecido 1 tem `modelo_grades.grade_total > 0` (mais estrita que `grade_preenchida`).

## O que NÃO fazer

- Não esquecer de aplicar a migration com `psql -f`/`db push --db-url` no banco novo (regra 1).
- Login é só e-mail/senha por convite (sem Google, sem "Criar conta" — regra 2). Não
  reintroduzir `signInWithOAuth`/`signUp` no `auth.tsx` sem o dono pedir.
- Não atualizar recharts para v3 agora (breaking changes).
- Não editar `src/components/ui/` (shadcn gerado) sem necessidade.
- Não commitar `.env` (já no `.gitignore`); os 3 docs em `docs/` são gitignored (locais).
- **Não criar `UNIQUE`/FK em coluna ÚNICA que é embedada** (ex.: `cad.modelo_id`,
  `controle_qualidade.cad_id`): o PostgREST passa a tratar o embed como **objeto** (to-one)
  e quebra todo código que usa `x?.[0]`/`(x ?? []).some(...)`. Para "1:1" use **TRIGGER**
  (`enforce_unique_fk`), não constraint. UNIQUE **composta** é segura. (Regressão real.)
  ⚠️ Ao trocar UNIQUE→TRIGGER numa coluna FK, **recrie um índice plano** nela (`CREATE INDEX`):
  o UNIQUE removido leva o índice implícito junto, e `enforce_unique_fk`/embeds passam a fazer
  seq scan. (Faltava em `controle_qualidade`/`producao_oficina`.cad_id — corrigido em 29/06/2026.)

## Agentes — times por especialidade (`.claude/agents/`)

Times pequenos. Em auditoria/varredura, os agentes de auditoria são **read-only**
(encontram e sugerem; não executam nem inventam). Rodar em **paralelo** por módulo; cada um
devolve achados com `arquivo:linha` + severidade. Módulo bom = "sem achados" — nunca inventar.

- **Produto & Domínio**: `product-lead` (estratégia/backlog), `domain-plm-pcp` (domínio
  PLM+PCP de moda: BOM, grade, OC, rolo, CQ, terceirizados)
- **Arquitetura & Dados**: `architect-system` (Vite+React+TanStack+Supabase multi-tenant,
  modularização, modos), `data-engineer` (schema, integridade, índices, RPCs/triggers, perf)
- **Qualidade & Código**: `code-reviewer` (React+TanStack+Supabase+RLS), `qa-engineer`
  (suíte Vitest unit + integração transacional + build/tsc/lint), `debug-expert` (causa raiz)
- **UX**: `ux-tester` (usabilidade dos fluxos), `ui-ux-mobile` (mobile-first)
- **Segurança & Infra**: `security-auditor` (RLS, RPCs DEFINER, storage, escalonamento,
  RPCs destrutivas), `devops-specialist` (db push --db-url, git, build, migrations)
- **Processos** (conduzem o ciclo de trabalho, não auditam): `release-shipper` (leva UMA
  mudança de ponta a ponta: classifica → build/tsc → migration+teste txn+diff → push),
  `docs-keeper` (mantém os 3 docs locais + memória em dia após mudança de regra de negócio)
