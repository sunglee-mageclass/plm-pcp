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
  ⚠️ **`produto_acabado` (ago/2026, feature Revenda) também é OPT-IN (default OFF)** — mesmo
  padrão do `otb`: sobrescrito p/ `false` em `useTenantModules.DEFAULTS` E `admin/lojas.tsx
  MODULE_DEFAULTS`. Diferente dos 7 módulos de contratação, **NÃO tem `ModuleDef` de topo** em
  `PAGES_CATALOG` (é `PageDef.gate` dentro de `criacao`/`entrada_saida`, não um módulo próprio),
  mas **o toggle mora em Gerenciar Lojas junto dos outros 7** (decisão do dono, ago/2026 — reverte
  uma escolha anterior de deixá-lo em Config da Loja): `admin/lojas.tsx` inclui `produto_acabado`
  à mão em `MODULE_TOGGLES` (rótulo "Produto Acabado (Revenda)"), editável só por `super_admin`,
  igual aos demais. Em **Config da Loja** (`admin/configuracoes.tsx`) ele é só **badge
  read-only** (`MODULE_LABELS`), igual aos outros 7 — o `tenant_admin` NÃO liga/desliga mais por
  lá (o card próprio antigo, `ProdutoAcabadoToggleCard`, foi removido). Novo `PageDef.gate?:
  string` em `permissions-catalog.ts` (mesmo conceito do `ModuleDef.gate`, mas por PÁGINA dentro
  de um módulo já ligado) — consumido por `app-sidebar.tsx`/`SectionHub.tsx` além do gate de
  módulo (`!p.gate || isModuleEnabled(p.gate)`).
  As 2 rotas novas **não usam `ModuleGuard`** (mesmo precedente do `otb`: o hook
  `useTenantModules().isLoading` tem uma corrida de render antes do `tenantId` resolver — cai
  nos `DEFAULTS`=off e redireciona por engano numa navegação DIRETA por URL; bug pré-existente,
  fora de escopo consertar aqui) — em vez disso renderizam um empty-state próprio quando o
  módulo está OFF (mitigação de UI; ver invariante 13).

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
  **produto-acabado** (Produto Acabado/Revenda — planejador por coleção→subcoleção, canvas de
  cards com espelho `modelos.origem='revenda'`; página `criacao_produto_acabado`, exige
  módulos `produto_acabado` E `otb`; ver docs/mapeamento §2D e invariante 13. NÃO mesclado —
  branch `feature/plan-tecido-a1`),
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
- **entrada-saida**: oc-tecido, oc-aviamento, rolos, estoque, **oc-p-acabado** (OC Produto
  Acabado/Revenda — abas Encomendadas · Recebidas · Estoque; página `entrada_oc_p_acabado`,
  gate `produto_acabado`; ver docs/mapeamento §2D e invariante 13. NÃO mesclado — branch
  `feature/plan-tecido-a1`)
- ⚠️ **O nível `producao` (PCP) foi DIVIDIDO em 2 níveis (jul/2026, ver [[project_pcp_expedicao]]):**
  **PCP** (`/pcp` = o próprio **Serviços**, nível de página única como o OTB; rotas `pcp.servicos.*`,
  `pcp.cad.*`, `pcp.oficina.*`) + **Expedição & Logística** (`/expedicao`, hub com **CQ + Direcionamento
  + Lançamentos**; rotas `expedicao.cq.*`, `expedicao.direcionamento.*`, `expedicao.lancamentos.tsx`).
  Os DOIS níveis compartilham a MESMA flag de contratação `producao` (novo campo `ModuleDef.gate` em
  `permissions-catalog`; keys de PÁGINA seguem `producao_*`; RPCs seguem gate `tenant_module_enabled('producao')`
  — zero mudança no banco). As URLs `/producao/*` NÃO existem mais. `MODULE_META`/`PAGE_URLS`/ícones em
  `src/lib/nav.ts` (SSOT). Serviços (`producao_terceirizados`) NÃO entra em `PAGE_URLS` (nível = página única).
  ⚠️ `admin/lojas.tsx MODULE_TOGGLES` (Switches de contratação, super_admin) precisa DEDUPLICAR por
  `m.gate ?? m.module` — sem isso, os 2 `ModuleDef` (pcp/expedicao) viravam 2 switches soltos
  (`modules.pcp`/`modules.expedicao`, chaves que nada lê) e a flag real `modules.producao` nunca
  aparecia pra ligar/desligar (bug latente entre o split de jul/2026 e o fix de ago/2026 — corrigido
  junto com o item do toggle `produto_acabado`).
- **pcp / expedicao** (ex-`producao`): cad, terceirizados=**Serviços** (abas pré/pós-costura por `categorias_terceirizado.etapa`;
  **quantidade por tamanho×variante** opt-in — flag `producao_terceirizados.detalhado` + `grade_detalhe` jsonb,
  ver [[project_terceirizados_grade_detalhe]]),
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
- **UI de edição — PADRÃO DO SISTEMA** (docs/design/ui-padroes.md §A/§G; NÃO reinventar; §K–§P =
  padrões do redesign ago/2026 — divisão por função/InfoStrip, ações de ciclo na tela + ⋯ no card,
  canvas colapsável, grade/peso/variante·apelido, form padrão OC, rollout tela a tela):
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
- **Colaboração em tempo real (rev otimista)** — telas com risco de edição simultânea (2+ pessoas
  no mesmo registro) usam o padrão: coluna `rev` na tabela-raiz (bump a cada UPDATE) + save manda
  `_rev_base`; a RPC compara e dá `P0409` se alguém salvou no meio (mensagem PT em `erro-mensagem.ts`).
  `useColabRegistro` (`@/hooks`) abre o canal Realtime (`colab:<tela>:<id>`) p/ presença (quem está
  na tela/campo) + reagir a UPDATE alheio; `mergeDraft`/`mergeLinhas` (`@/lib/colab/merge`, puros)
  fazem merge 3-vias (base/draft/fresh) por campo tocado (`touched`), sinalizando conflito só onde
  EU editei e o servidor também mudou (`<ColabBanner>` + destaque âmbar + "manter meu · usar o novo").
  **Adotado em 6 telas**: OC Tecido (piloto, `entrada-saida.oc-tecido.tsx`) · Desenvolvimento ·
  Plan. Produto · Plan. Tecido (merge POR SLOT, `colab-merge-arvore.ts`) · **PCP Serviços + CQ**
  (ago/2026, spec `.superpowers/sdd/2026-08-07-colab-pcp-cq/`). PCP+CQ têm um grão mais fino porque
  as 2 telas editam o MESMO dado — o `grade_detalhe` destrinchado do bloco-fonte (Grade Cortada):
  `rev` é POR BLOCO em `producao_terceirizados` (cobre o PCP e o grade_detalhe que o CQ também
  escreve) e por cad em `controle_qualidade`; `salvar_terceirizados` checa `_rev_base` `{bloco_id:
  rev}` bloco a bloco (sem `_core` — gate+trava dentro do mesmo `SECURITY DEFINER`);
  `salvar_cq` checa OS DOIS LADOS via `_rev_base {cq, fonte}` (`cq` sempre presente — omitir pula o
  check e abre janela de lost-update; `fonte` null se o modelo não tem bloco-fonte). O merge da
  grade compartilhada é POR CÉLULA (`mergeGrade`, `@/lib/colab/merge-grade`, mesmo padrão 3-vias
  base/draft/fresh/touched do `mergeDraft` — mas com campos em PT, `{base,meu,fresh,tocadas}`, NÃO a
  mesma assinatura literal —, path `grade:{vid}:{tam}:{campo}`). `useColabRegistro`
  ganhou `filtroColuna` (default `"id"`; PCP/CQ usam `"cad_id"` — N linhas por cad, sem raiz única)
  e `tabelasExtra` (listeners extra no mesmo canal — o CQ também escuta o bloco-fonte, então um save
  do PCP na grade compartilhada dispara re-merge no CQ aberto, cross-tela). Spec/plano original em
  `.superpowers/sdd/2026-08-03-concorrencia-multiusuario/`; não reinventar o merge ao levar novas
  telas.

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
   re-implementa a conta (senão dá drift). `previsto` NÃO é clampado (pode ficar negativo: reserva
   > físico é sinal legítimo, ex.: cortou mais que comprou); só `fisico` clampa em ≥0.
   ⚠️ **`estoque_zerado` foi APOSENTADO** (jul/2026, migração `20260727000000`): a ação de "zerar
   lote" já não existia; o conceito foi removido do banco (4 funções: `_estoque_tecido_core`,
   `detalhe_estoque_variante`, `ocs_disponiveis_variante`, `ocs_para_rolo`) e do front (badge
   "Zerado"). Os lotes que estavam zerados viraram **write-off explícito no ledger** (baixa de
   ajuste = recebido → físico 0), preservando físico/previsto (verificado byte-a-byte). Para
   "encerrar" um lote hoje, dê uma baixa de ajuste (não há mais flag). A coluna
   `ocs_tecido_itens.estoque_zerado` fica como vestígio inerte (sempre false, sem leitor).
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
   **Grade Cortada (ago/2026, fonte única):** quando o modelo tem um **bloco-fonte de confecção
   destrinchado** (PL ou Oficina, `detalhado`+`ativo`, resolvido por `_resolver_fonte_confeccao`/
   `tenant_config.confeccao_prioridade` — paridade com `resolverFonteConfeccao` TS), o
   `_salvar_cq_core` grava Recebido/Defeito do CQ no `producao_terceirizados.grade_detalhe` desse
   bloco (chave `variante_tecido_id`, traduzida de/para `variante_numero` via
   `cad_tecido_variantes.ordem`) e DERIVA `cad_grades.grades_reais` = `max(0,recebida−defeito)`
   DELE, na MESMA txn (`_aplicar_reais_do_grade_detalhe`, também chamado por `salvar_terceirizados`
   quando o CQ já está confirmado — editar recebida/defeito no PCP move a Grade Real). **[C1] passa
   a computar dessa fonte (não do `_reais`/escalar do cliente); [Σ] de `cad_grades` idem.
   `cq_variantes.grade_total` CONTINUA vindo do payload do formulário de CQ** (não lê
   `grade_detalhe`) — pode DIVERGIR do `grade_detalhe`/`cad_grades` depois de uma edição feita só
   no PCP (CQ já confirmado). A "Grade (CAD)" no CQ vira **"Grade Cortada"** (lida da CORTADA do
   bloco-fonte, read-only — só editável no PCP/Serviços). Modelo SEM bloco-fonte destrinchado =
   comportamento de hoje (`cq_variantes`/`_reais` intocados). Ver memória
   `project_terceirizados_grade_detalhe`.
7. **1 CAD por modelo** — garantido por TRIGGER `enforce_unique_fk` (NÃO por UNIQUE, ver
   "O que NÃO fazer"). Enviar ao corte (`baixar_estoque_tecido_corte`) é atômico e retorna
   `deficit[]` por variante; o déficit roda por `cad_tecido_variantes.metragem_enviada` (metros de
   tecido), NÃO por `cad_grades`/`grades_planejadas`. `cad_grades.grades_planejadas` segue
   INTOCADA pela Grade Cortada (ago/2026, invariante #6) — a feature só troca a REFERÊNCIA exibida
   no CQ (Grade CAD → Grade Cortada), sem relação com o corte de tecido.
8. **Serviços no financeiro** — serviços terceirizados externos viram contas a pagar
   (`parcelas_servico` + RPC `servicos_financeiro`); oficina entra após CQ confirmado.
   **MO por serviço (ago/2026):** o antigo flag único virou **agregado DERIVADO**.
   `modelo_servico_mo` guarda 1 linha por **modelo×serviço** (`categoria_terceirizado_id`;
   `NULL` = "Geral (legado)", do backfill) com `valor` + `aprovado` (`null`=pendente/true/false)
   + `motivo_reprovacao`; editor por-serviço no **card do Planejamento** (`MaoObraEditor`;
   dropdown de adicionar só lista serviços `categorias_terceirizado.ativo=true` — toggle
   soft-hide, Cadastro > Serviços; usados somem do dropdown mas linhas históricas em categoria
   desativada persistem). `modelos.custo_terceirizados_aprovado` **não é mais escrito pela UI**:
   trigger `fn_modelo_mo_flag_derivada` (BEFORE INSERT/UPDATE em `modelos`) re-deriva em TODA
   escrita via `_mo_liberada(modelo_id)` = `NOT EXISTS(linha com aprovado IS DISTINCT FROM true)`
   — **sem linha nenhuma = liberada**; trigger `fn_modelo_servico_mo_rollup` (AFTER em
   `modelo_servico_mo`, guard `IS DISTINCT FROM` p/ não bumpar `modelos.rev` à toa) repinta o
   modelo a cada mudança de linha. A coluna virou **boolean efetivo** (a pendência mora nas
   linhas, não mais nela). `lancar_modelo`/kanban seguem lendo o flag
   `COALESCE(custo_terceirizados_aprovado,false)` — nenhum consumidor downstream mudou.
   **Lançar exige CQ liberado E mão de obra aprovada**; botão-foguete do card lança/cancela
   com data. `custo_unitario_modelos.mao_obra_previsto` = **Σ `modelo_servico_mo.valor`** (era
   `custo_terceirizados_previsto`, agora INERTE). O card separa **materiais (= total − mão de
   obra)** da mão de obra, trocando previsto→real quando pronto/lançado; PCP mostra card
   "MO Aprovada (planejada)" = `modelo_mo_resumo().total_aprovado` (Σ só linhas `aprovado=true`).
   **Markup/Preço seguem no custo TOTAL** — não mexer em `preco.ts`. Ver invariante #12
   (permissão por linha) e memória `project_mo_por_servico`.
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
10. **Direcionamento MULTI-LOJAS (ago/2026)** — a Grade Real é distribuída em **N linhas
    digitáveis, uma por loja** do cadastro `lojas_direcionamento` (Cadastro > Lojas;
    seed "E-commerce" default + "Loja Física"; default não-excluível; RLS de escrita e
    `excluir_loja_direcionamento` exigem tenant_admin). Linhas em `direcionamento_lojas`
    (cad × loja × variante, UNIQUE triplo); a tabela legada `direcionamento` está
    **INERTE** (backfill feito; nenhum save NOVO cria linha nela — rebaixe/limpezas
    legítimas seguem tocando o legado, não remover esses blocos; não reintroduzir leitor/writer NOVO).
    Validação **no SERVIDOR** (`_salvar_direcionamento_core` v2, payload
    `[{loja_id, variante_numero, grades}]` = **estado COMPLETO** — linha ausente é
    APAGADA; front monta sempre o estado inteiro): grade real autoritativa de
    `cad_grades.grades_reais`; rascunho livre; **Confirmar = RAISE P0001 em PT se
    Σ por tamanho ≠ real** (mensagem com tamanho+diferença — não trocar o ERRCODE:
    23514 seria engolido pelo erro-mensagem.ts), atômico com `direcionamento_status=
    'separado'` e **exige CQ liberado** (`_cq_liberado`). Linha nova só em loja ATIVA do
    tenant (front espelha: célula de loja inativa sem par histórico fica disabled —
    `paresHistoricos`). Rodapé vivo usa `@/lib/direcionamento-diff` (não reimplementar a
    conta). **Gates downstream olham as DUAS tabelas** (`fn_rebaixa_direcionamento_grade`,
    `modelo_etapas_afetadas`, `marcar_revisao_por_mudanca` — `EXISTS legado OR EXISTS
    novo`; qualquer gate novo por direcionamento deve fazer igual). Trigger de rebaixa:
    grade real mudou + estava 'separado' → 'pendente' + `#Erro` (espelha o M2 do CQ).
    2º lote NÃO entra (a grade real já o desconta). ⚠️ A queryKey `["cad-grades", cad?.id]`
    é **compartilhada** por Direcionamento (sufixo `"reais"`) e Oficina (`"full"`) —
    sufixo por consumidor; o CQ invalida por prefixo E `["direcionamento-lojas", id]`.
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
12. **Permissão por SEÇÃO** (camada abaixo de "página"; jul/2026) — `PageDef.sections[]` no
    `permissions-catalog.ts` (as keys entram em `ALL_PAGE_KEYS`; o `PermissoesModal` renderiza
    aninhado sob a página). **Custo/preço**: `custo_unitario_modelos` virou WRAPPER que retorna
    `'{}'::jsonb` (custos → "—" em TODOS os 6 consumidores) quando `NOT _pode_ver_custos()`
    (= `user_can_view` de `criacao_planejamento:custos`/`criacao_desenvolvimento:custos`/
    `producao_terceirizados:precos`/`dashboard_custos`/`dashboard_comercial`; admins furam);
    `_custo_unitario_modelos_core` com EXECUTE revogado. **Aprovar mão de obra (ago/2026, POR
    LINHA):** `trg_enforce_maodeobra_aprovacao`/`enforce_maodeobra_aprovacao` (o guard antigo em
    `modelos`) foram **APOSENTADOS** (dropados na mesma migração que instalou o rollup — senão
    bloqueariam o próprio recompute do flag). A permissão `producao_servico_aprovacao` agora é
    enforçada **por linha** em `modelo_servico_mo`: `trg_enforce_servico_mo_aprovacao`/
    `enforce_servico_mo_aprovacao` (BEFORE INSERT/UPDATE) RAISE 42501 se `aprovado` for
    definido/mudar sem `user_can_edit(...)`; `trg_enforce_servico_mo_del_aprovacao`/
    `enforce_servico_mo_del_aprovacao` (BEFORE DELETE) RAISE 42501 ao apagar linha
    **não-aprovada** sem a permissão (apagar libera o modelo tanto quanto aprovar — mesmo
    furo, mesmo gate; guarda de cascade: não bloqueia se o `modelos` pai já sumiu, ex. exclusão
    do modelo). `salvar_modelo_servico_mo` NUNCA toca `aprovado` (só `valor`/`observacoes`) —
    aprovar/reprovar é sempre via `aprovar_servico_mo`. O flag do modelo é à prova de
    adulteração por construção: `fn_modelo_mo_flag_derivada` **re-deriva em toda escrita** de
    `modelos`, ignorando qualquer `custo_terceirizados_aprovado` vindo do cliente (substitui a
    garantia do enforce dropado). `modelo_mo_resumo` é gated por `_pode_ver_custos() OR
    user_can_edit('producao_servico_aprovacao')` (espelha a superfície do editor/badge — um
    aprovador sem visão de custo não perde a tela) e **mascara `valor`/`total`/`total_aprovado`**
    (`NULL`) quando não pode ver custos. O front só ESCONDE (`canView`/`canEdit`); o banco
    garante. Rollout com backfill não-quebra (concede aos que já viam/aprovavam). Ver
    memória `project_permissao_secoes` e `project_mo_por_servico`.
13. **Produto Acabado / Revenda (ago/2026)** — segunda "família" de aquisição além de tecido/
    aviamento: compra peça PRONTA de terceiro pra revender (não fabrica). Entidade
    **`produtos_acabados`** (+`produto_acabado_variantes`, por cor) é **espelho 1:1 com
    `modelos`** via trigger `enforce_unique_fk('modelo_id')` (NUNCA `UNIQUE` — regra "O que NÃO
    fazer"); `modelos.origem='revenda'` (coluna pré-existente) marca o card espelho. **REF**:
    gerada na CRIAÇÃO do produto (7 dígitos sequenciais + sigla — trigger `fn_produto_acabado_ref`)
    e **copiada DIRETO pra `modelos.ref`** quando o card é criado (`criar_card_produto_acabado`)
    — passa por FORA do fluxo `ref_auto`→aprovar da invariante 11 (o card nasce com
    `ordem_criacao_enviada=false`, então `fn_modelo_ref_auto` nunca mexe nele). **Grupo
    Acessórios** (nome normalizado contém `'acessor'`, `_grupo_eh_acessorio`/`ehGrupoAcessorio`
    espelhados banco↔TS) tem regra própria: grade única `"UN"` (sem tamanho), REF no formato
    2G+3CAT (em vez de 2G+1C+2S) e nº de OC terminando em `ACE`. **OC** (`ocs_p_acabado`):
    **1 OC ativa por produto** (trigger `enforce_oc_pa_vinculo_unico`); grade em
    **`grade_detalhe` jsonb** `{"<ordem_variante>":{"<tamanho>":{pedida,recebida,defeito}}}` —
    **estado COMPLETO por save** (o cliente manda o objeto inteiro, sem merge no servidor,
    mesmo padrão de `producao_terceirizados.grade_detalhe`); derivados
    (`valor_bruto`/`valor_total_desconto`/`valor_unitario_real`) **re-derivados no servidor**
    a cada save, nunca confiados do cliente; parcelas com `tipo_oc='p_acabado'`
    (trigger `gerar_parcelas_oc_p_acabado`) **netam contra as já pagas** — espelha
    `_recalcular_parcelas_core` (não o `recalcular_parcelas` mais antigo, que divide o total
    cheio; usar o `_core` como referência ao tocar essa família). **Excluir só via RPC com
    guarda** (`excluir_oc_p_acabado` bloqueia OC `recebido`/parcela paga;
    `excluir_produto_acabado` bloqueia produto com OC vinculada — nenhum `.delete()` cru).
    **Receber** (`receber_oc_p_acabado`, atômico): materializa `cad` **BARE** (sem
    `cad_tecidos` — não é fluxo de tecido) + `cad_grades` (`grades_planejadas`=pedida,
    `grades_reais`=`max(0,recebida−defeito)`) + `controle_qualidade` **pendente** (só cria se
    não existir — nunca sobrescreve CQ já confirmado; reedições posteriores no PCP só
    regravam `grades_reais`, a trigger de rebaixa do Direcionamento age normalmente sobre
    isso). **CQ/Direcionamento**: as duas listas ampliaram o filtro de entrada pra
    `.or("enviado_cad.eq.true,origem.eq.revenda")` (revenda nunca seta `enviado_cad`, senão
    ficaria inalcançável mesmo com OC recebida); rótulo de variante nas duas telas usa
    `produto_acabado_variantes` como fonte (fallback por `origem==='revenda'`, antes do
    fallback genérico "Variante N"). **Insumos**: consumo revenda entra na aba Estoque do OC
    Insumo por **peças recebidas** (`baixa_revenda` nova CTE em `_estoque_etiqueta_core`,
    casada por etiqueta+cor sem tamanho — BOM de revenda não distingue tamanho), já que
    revenda nunca passa por `enviado_corte`/`cad_etiquetas` (caminho manufaturado intocado).
    **Preço/custo**: `modelos.preco_atacado` (novo, ao lado do varejo `preco_venda`);
    `_custo_unitario_modelos_core` ganhou ramo revenda (ativo só quando
    `produtos_acabados.modelo_id` existe) — `previsto` = valor unitário real (bruto − desconto)
    + insumos, sempre disponível; `real` fica `NULL` até a OC vinculada ficar `recebido`
    (aí `previsto===real`); caminho não-revenda intacto byte-a-byte (diff-validado). Helper
    **`_split_maior_resto`** (método do maior resto/Hamilton: Σ resultado sempre ≡ total pedido;
    Σpesos≤0 → split IGUALITÁRIO, não zera) tem espelho TS puro `splitMaiorResto`
    (`src/lib/produto-acabado.ts`, junto de `ehGrupoAcessorio`/`cadeiaValores`/
    `previewRefProduto`/`previewNumeroOc` — os `preview*` só a SIGLA, número sequencial sempre
    vem do banco; `norm3` TS espelha `_norm3` SQL byte-a-byte, só a lista fixa de acentos PT-BR
    do `translate()`, não um NFD genérico — acento fora da lista, ex. ä/ö/ü/ñ, é DESCARTADO
    nos dois lados). ⚠️ **Gap conhecido/aceito**: nenhuma das 3 tabelas novas tem policy
    `modgate_*` RESTRICTIVE de `tenant_module_enabled('produto_acabado')` (RLS é só
    tenant-scoped, igual `otb`) — módulo OFF é enforçado nos WRAPPERS de escrita (invariante 9)
    e por empty-state na UI (leitura direta via REST/embed não é bloqueada no banco se alguém
    montar a query à mão); decisão registrada 3× (Tasks 1/5/8), mesmo padrão do `otb`, não é
    regressão desta feature.

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
(requisitos já configurados + anti-drift seguem). **Sem mudança de chave em ago/2026**: o flag
virou boolean DERIVADO de `modelo_servico_mo` por trigger (invariantes #8/#12), mas a condição
continua lendo a MESMA coluna/key — catálogo, RPC e anti-drift inalterados. Condição `grade_todas_variantes` (Desenvolvimento):
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
