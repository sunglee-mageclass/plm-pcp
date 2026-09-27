# CLAUDE.md — sisTrama (exibido como WISH360)

Contexto do projeto para sessões do Claude Code. Leia antes de qualquer tarefa.

## O que é

**sisTrama** (de *sistema* + *trama*) — um PLM + PCP para confecção de moda.
Gerencia o fluxo inteiro: cadastro de materiais → criação/desenvolvimento →
produção → financeiro. Sistema **multi-tenant** (várias lojas isoladas), modelo
**SaaS por loja** (cada loja liga só os módulos que usa).

**Nome técnico interno** = **sisTrama** (o codebase, o domínio
`sistrama.sung-lee.workers.dev`, o prefixo legado de storage). **Nome de EXIBIÇÃO
nas telas** = **WISH360** (rebrand ago/2026): `useSystemIdentity.ts`
`nome_sistema:"WISH360"` (default; cada loja pode sobrescrever a própria
identidade), título do `__root.tsx`, `RelatorioPrint`, `TecelagemAnimacao` — 7
arquivos em `src/`. A identidade por loja mora em `system_settings`
(nome_sistema/subtitulo/logo/favicon). Não trocar "sisTrama" no corpo técnico
deste doc (é o nome do sistema por baixo); só a marca vista pelo usuário é WISH360.

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
- **Papéis/roles customizados (set/2026, ver [[project_papeis_customizados]]):** presets de
  permissão reutilizáveis POR LOJA. `papeis`+`papel_permissoes` (tenant-scoped) + `users.papel_id`
  (vínculo). **Permissão efetiva = exceção do usuário (`user_permissions`) SENÃO papel SENÃO negado**,
  resolvida AO VIVO por `_perm_efetiva(uuid)` (EXECUTE revogado dos 3, inv. #9). `user_can_view`/
  `user_can_edit` leem dele; o front lê via RPC `minhas_permissoes_efetivas()` (o `useAuth` NÃO faz
  mais `select user_permissions` direto). `set_user_permissions` grava só o DELTA vs o papel (exceção
  negativa = linha `ver=false` explícita; sem papel = grava tudo, retrocompat). RPCs `salvar_papel`/
  `excluir_papel` (guarda: bloqueia papel em uso)/`definir_papel_usuario`, authz via
  `_papel_tenant_autorizado`. Gestão em Gerenciar Usuários (`GerenciarPapeisDialog`+`PapelSelect`);
  editor de papel reusa a grade do `PermissoesModal` (`PapelEditor`). Só role `user` usa papel
  (admins furam). Papéis GLOBAIS ficaram fora de escopo (são por-loja).
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
  ver [[project_plan_tecido]] e docs/mapeamento §2C. NÃO mesclado — branch `feature/plan-tecido-a1`;
  ganhou o dialog **"Distribuir por loja"** por produto, set/2026 — ver seção "Sheet unificado do
  Planejamento" abaixo e docs/mapeamento §17.5),
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
  **PCP** (`/pcp`, hub com **Serviços + Etapas** [Etapas PL, ago/2026, gate opt-in `etapas_pl` —
  ver invariante de módulos]; rotas `pcp.servicos.*`, `pcp.etapas.tsx`, `pcp.cad.*`, `pcp.oficina.*`)
  + **Expedição & Logística** (`/expedicao`, hub com **CQ + Direcionamento
  + Lançamentos**; rotas `expedicao.cq.*`, `expedicao.direcionamento.*`, `expedicao.lancamentos.tsx`).
  `/pcp` renderiza `<SectionHub module="pcp" />` (mesmo padrão dos demais hubs de setor — o antigo
  "PCP é o próprio Serviços, nível de página única" ficou obsoleto quando Etapas entrou como 2º card).
  Os DOIS níveis (PCP e Expedição) compartilham a MESMA flag de contratação `producao` (campo
  `ModuleDef.gate` em `permissions-catalog`; keys de PÁGINA seguem `producao_*`; RPCs seguem gate
  `tenant_module_enabled('producao')` — zero mudança no banco); Etapas soma um 2º gate por-página
  (`PageDef.gate: "etapas_pl"`, mesmo mecanismo do `produto_acabado`). As URLs `/producao/*` NÃO
  existem mais. `MODULE_META`/`PAGE_URLS`/ícones em `src/lib/nav.ts` (SSOT) — Serviços e Etapas
  ambos entram em `PAGE_URLS`/`PAGE_ICONS` como cards do hub / sub-itens da sidebar.
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
  canvas colapsável, grade/peso/variante·apelido, form padrão OC, rollout tela a tela; **§Q =
  padrões v3 + §R = Gráficos & Dataviz (cartilhas ago/2026)** — toda tela/componente NOVO segue
  §Q/§R via primitivos compartilhados (Button/PageActionBar/DateField/MoneyInput/StatusBadge…; cor
  de gráfico SÓ via `src/lib/chart-colors.ts` → tokens `--chart-*`), nunca valor solto (hex, `hsl()`
  de gráfico, px fora da escala, toFixed manual); teste anti-drift em
  `tests/unit/ui-padroes-antidrift.test.ts` **ATIVO** (ago/2026, onda 3 + Dashboard v2 —
  `ANTIDRIFT_LIGADO=true`; regras a–f, `f` = `hsl()` cru de gráfico; regra de cor respeita a exceção
  de impressão/dado real documentada em §Q3/§R12)):
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
  - **Informação complementar de campo = `InfoHover`** (`src/components/shared/InfoHover.tsx`,
    set/2026): "i" ao lado do rótulo, mostra no hover (mesmo visual do `CondicaoInfo`) e TAMBÉM abre
    com toque/teclado (`open` controlado; é o único lugar da informação) — nunca texto fixo embaixo do campo. Em uso: motivo da Origem travada e preço/estoque do Tecido
    1..3 no Sheet do Planejamento.
- **Colaboração em tempo real (rev otimista)** — telas com risco de edição simultânea (2+ pessoas
  no mesmo registro) usam o padrão: coluna `rev` na tabela-raiz (bump a cada UPDATE) + save manda
  `_rev_base`; a RPC compara e dá `P0409` se alguém salvou no meio (mensagem PT em `erro-mensagem.ts`).
  ⚠️ **A MENSAGEM de todo `RAISE … USING ERRCODE` que o PostgREST devolve como 5xx (`P0409`, `P0002`…)
  tem de ser SÓ ASCII** (sem acento, "—" ou "…", padrão `conflito_versao: …`/`previa_desatualizada: …`):
  com não-ASCII o PostgREST responde `500 text/plain "Something went wrong"`, o `code` some e o merge
  colaborativo/prévia do SKU não rodam (P-58/P-59, `20261006120000`, produção 26/set). A tela traduz
  pelo `code`. `P0001` (400) e `42501` (403) não são afetados. Ao testar regex no Postgres, fronteira
  de palavra é `\y` (`\b` = backspace).
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
- **Fix "salvar rápido" / hidratação (P-57, set/2026, deploy 26/set)** — investigação de 26/set achou
  que 6 telas (Planejamento, CQ Pré/Pós, Direcionamento, PCP Oficina, PCP Serviços, Config da Loja)
  deixavam o Salvar/Confirmar habilitado ANTES da 1ª carga de dados terminar (várias queries em
  paralelo); salvar nesse instante grava um estado incompleto por cima do que já existia no
  servidor (regressão de dado, pior que um erro visível). Fix: cada tela ganhou um estado
  `hydrated` (true só depois que TODAS as queries relevantes semearam o rascunho local) e os
  botões de Salvar/Confirmar/Desmarcar levaram `|| !hydrated || !tenantId` no `disabled` (o
  `tenantId` cobre a corrida de render do `useActiveTenantId` antes do tenant resolver). Erro de
  carga (`isError`) mostra um **banner "Tentar de novo"** no lugar do formulário em vez de deixar
  a tela parecendo carregada com dado pela metade. Não remover essas travas achando-as
  redundantes — cada uma tem um caso GRAVE documentado no comentário `P-57 A` do arquivo.

## Invariantes a preservar (não regredir)

Padrões já corrigidos/estabelecidos. **Antes de afirmar que algo está quebrado, `git pull`
e verifique** — o repo muda rápido.

1. **Parcelas (OC)** — salvar itens ANTES de `status='recebido'` (comentário "CRITICAL"
   em `oc-aviamento.tsx`). `recalcular_parcelas` distribui `total − Σ(pagas)`; é automática
   via trigger p/ **tecido** (`recalc_parcelas_on_valor` em `ocs_tecido` ao mudar
   `valor_real_total`) E **aviamento** (`trg_recalc_parcelas_aviamento` em
   `ocs_aviamento_itens`, só quando a OC já está 'recebido'). **Parcela a pagar (prazo
   30/60/90) ≠ `parcelas_recebimento` (entrega).** Vencimento = `data_nota_entrada` (Data da
   Nota de Entrada, campo NF do fornecedor nas 5 OCs; `src/lib/nota-entrada.ts`) **+ N dias
   CORRIDOS** de cada prazo (`date + integer`, nunca meses); sem a Nota, cai em
   `COALESCE(data_entrega|data_pedido, hoje)` (provisório). `fn_oc_nota_entrada_valida` só
   bloqueia data **FUTURA** — a trava "anterior à data do pedido" foi **revogada pelo dono em
   25/set** (`20261004100000_nota_entrada_sem_trava_pedido.sql`, produção 25/set 13h08).
   ⚠️ O cliente (`authenticated`) só tem
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
   ⚠️ **Estoque de AVIAMENTO é POR VARIANTE (cor base + apelido)** (ago/2026, `20260820140000`),
   espelhando o tecido: **fonte única `_estoque_aviamento_core`** reagrupa por
   `aviamento_id × variante_aviamento_id` (recebido/prev ← `ocs_aviamento_itens.variante_aviamento_id`;
   baixa ← `cad_aviamentos`/`ordens_saida_aviamento_itens`; reserva ← `modelo_aviamentos.variante_aviamento_id`
   + OS). A tela (`estoque_aviamento`, agora 1 linha por aviamento×variante), o dashboard
   (`_dashboard_estoque_core`) e a trava de saldo da OS (`baixar_os`) TODOS rolam esse core — os dois
   últimos **SOMAM as variantes por aviamento** (mantêm a granularidade por-aviamento sem re-implementar
   a conta; número idêntico ao anterior, diff-validado). Clamp de `fisico` passou de por-aviamento p/
   **por-variante** (idêntico ao tecido). **Regra de atribuição do LEGADO** (decisão do dono): linha com
   `variante_aviamento_id` NULL é atribuída à ÚNICA variante do aviamento quando ele tem exatamente 1
   (cobre TODO o backfill — cada aviamento com cor virou 1 variante); 0 ou 2+ variantes → bucket
   **"Sem variante"** (variante_id NULL, NÃO some). Σ por aviamento ≡ Σ das variantes (provado
   byte-a-byte, ZERO perda). `_estoque_aviamento_core` segue com EXECUTE revogado dos TRÊS (invariante #9;
   já teve IDOR aqui). ⚠️ **A OS de aviamento é POR VARIANTE** (FF#3 ago/2026, `20260820180000`):
   `salvar_os` grava `ordens_saida_aviamento_itens.variante_aviamento_id`; a trava de saldo do
   `baixar_os` deixou de SOMAR por aviamento e passou a valer POR (aviamento × variante), espelhando
   o bucketing do `_estoque_aviamento_core` (COALESCE variante→variante única do legado; join
   `IS NOT DISTINCT FROM`) — item sem variante recai na variante única (ou bucket "Sem variante" NULL,
   fisico ~0, que barra). `_estoque_aviamento_core` NÃO mudou (já era por variante). Idem **PCP
   "aviamentos enviados" é POR VARIANTE** (FF#2, `20260820170000`):
   `producao_terceirizados.aviamentos_enviados` guarda `{aviamento_id, variante_aviamento_id}` (era
   array de `aviamento_id`); `salvar_terceirizados` grava o jsonb OPACO (sem mudança de RPC — era o
   único leitor). Ver memória `project_variantes_aviamento`.
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
    **Etapa de revelação CONFIGURÁVEL (ago/2026, `20260817180000`):** a cópia `ref_auto → ref`
    (e a exibição do campo no card) já não é fixa em 'aprovado' — acontece quando o modelo ATINGE a
    etapa `tenant_config.ref_exibir_status` (ou posterior na ordem do board; ausente/órfã ⇒ 'aprovado').
    Mesma régua "a partir da etapa" do Envio à Explosão: SQL `_ref_exibir_gate` (usado pelo trigger) +
    front `refCampoVisivel` (`src/lib/kanban-status.ts`, delega a `podeEnviarExplosao`) que gate a
    exibição; Config da Loja tem o 2º marcador (ícone Tag) por linha no bloco "Status do Kanban".
    TODO o resto da invariante segue: nº fixo, sigla re-sincroniza, REF manual nunca sobrescrita.
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
    nos dois lados). **Gap FECHADO (`20260811110000_modgate_produto_acabado.sql`, FF2):** as
    TRÊS tabelas (`produtos_acabados`, `produto_acabado_variantes`, `ocs_p_acabado`) TÊM policy
    `modgate_*` **RESTRICTIVE** de `tenant_module_enabled('produto_acabado')` (confirmado na
    cópia local, `pg_policies`) — módulo OFF bloqueia leitura direta via REST/embed, não só a
    escrita dos WRAPPERS (invariante 9). ⚠️ **Assimetria entre as 3**: `produtos_acabados` e
    `produto_acabado_variantes` têm as 4 (`modgate_sel/ins/upd/del`); **`ocs_p_acabado` só tem 3**
    (`modgate_ins/upd/del` — **SEM** `modgate_sel`). O `modgate_sel` de `ocs_p_acabado` (e de
    `ocs_importado`) foi **DROPADO** depois (`20260916140000_fix_rls_ocs_pacabado_importado.sql`,
    lição do merge colaborativo): o Realtime lê como `authenticated` **sem** contexto de tenant,
    então um RESTRICTIVE de SELECT fazia o canal `postgres_changes` nunca ficar SUBSCRIBED
    (mesmo padrão de `controle_qualidade`/`ocs_tecido`/`ocs_aviamento`/`ocs_etiqueta`/
    `direcionamento_controle`, que também só têm `tenant_select` PERMISSIVE, nunca modgate no
    SELECT). Ou seja: escrita das 3 tabelas SEMPRE gated por módulo; leitura direta gated nas
    2 primeiras, mas NÃO em `ocs_p_acabado` (decisão registrada, não é regressão — uniformiza
    com o resto do sistema).
    ⚠️ **Fluxo de Revenda CONFIGURÁVEL por loja (ago/2026, `a342618..efdeea0`, review opus SHIP):**
    3 colunas jsonb novas em `tenant_config` (migração `20260826130000`): `revenda_kanban_colunas`
    (keys de colunas por onde a revenda passa; `[]`=todas), `revenda_kanban_requisitos` (mapa
    coluna→condições, próprio da revenda), `revenda_campos` (visibilidade por seção `s1..s6/prova/
    s-cad/s3e` E campo de Info Básicas `modelista_id/piloteiro1-3_id/data_piloto1-3/data_desenho_
    tecnico/data_aprovacao`). **SSOT = `src/lib/revenda-config.ts`** (`revendaCampoVisivel`/
    `revendaColunaPermitida`/`revendaRequisitos`/`lerRevendaConfig`, puro+testado); os 4 pontos de
    leitura (secOrdem+render das seções, campos do `ModeloInfoSection`, gate `cadMissing`, kanban
    `podeEntrar`/`podeEntrarStatus`) consultam ESSE helper, SÓ quando `origem==='revenda'` —
    fluxo interno byte-a-byte intocado (`isRevenda ? novo : <literal de hoje>`). **Default de
    fábrica esconde os 9 campos + `prova/s2/s-cad`** (`REVENDA_CAMPOS_DEFAULT_OFF`), destravando os
    produtos de revenda que antes travavam no gate de Tecido/CAD/Data. UI = card "Fluxo de Revenda"
    em Config da Loja (gated `modules.produto_acabado`), reusa `RequisitosStatusDialog` com prop
    opt-in `condsIndisponiveis=REVENDA_COND_NA` (7 condições impossíveis p/ revenda esmaecidas).
    ⚠️ Coluna fora de `revenda_kanban_colunas` = BLOQUEADA p/ revenda. Fast-follows: cluster
    "Cronograma & Pilotos" vira caixa vazia qd os campos escondidos; `reqBadge` de completude de
    seção ainda usa requisitos INTERNOS (mostra "falta X" cosmético num card de revenda — só
    display, NÃO trava). ⚠️ O `ModeloDetailPanel` lê tenant_config sob key PRÓPRIA
    `["modelo-tenant-config-grade"]` (NÃO a `tenant-config-grade` do `GradeTamanhosCard`, que
    retorna `string[]` — colisão de shape corrigida em `efdeea0`). Ver memória `project_fluxo_revenda_config`.
    **Comprado no Sheet do Planejamento (F3.4, set/2026):** grade cor×tamanho do comprado (revenda
    E importado) tem **fonte ÚNICA** = `useGradeComprado` (`planejamento-detail/useGradeComprado.ts`)
    — mora em `modelo_grades` com `variante_numero` = `ordem` da variante do produto espelho
    (`produtos_acabados` na revenda, `produtos_importados` no importado); lê a origem **SALVA**
    (servidor), não o `draft.origem` ainda não gravado. Grava por `salvar_grade_revenda`
    (revenda) ou pelo `salvar_modelo_bom` (importado — a grade dele grava JUNTO com o BOM, não
    por RPC própria); `salvar_produto_importado` cria/atualiza o produto importado a partir do
    Planejamento (auto-criação). **Enviar à Explosão do comprado (D2 = A)** usa a **MESMA** RPC do
    interno, `enviar_modelo_para_cad` — `_enviar_modelo_para_cad_core` não olha `origem`,
    gate de etapa por `_kanban_status_gate` igual. **`_receber_oc_p_acabado_core` REUSA o `cad`
    já existente** (upsert) em vez de criar um novo — se o comprado já foi enviado à Explosão
    antes de a OC ser recebida, o recebimento não duplica `cad`/`cad_grades`. **`origemComprado`
    × `origemSalva`**: são o MESMO conceito (a origem gravada no servidor, `modeloData?.origem`/
    `kanbanCard.modeloKanban.origem` — nunca o `draft.origem` tocado e ainda não salvo) com
    **nomes DIFERENTES em dois blocos do mesmo componente** (`PlanejamentoDetail.tsx`) só para
    não colidir: `origemComprado` no bloco da grade/BOM do comprado, `origemSalva` no bloco
    "Mover para…" do kanban — não são dois conceitos opostos, é o mesmo valor lido 2×.

**Docs de referência LOCAIS (gitignored, manter atualizados — papel do agente `docs-keeper`):**
`docs/mapeamento-campos-calculos.md` (campos×campos, fórmulas, etapas),
`docs/plano-de-ataque.md` (auditoria das 7 frentes + Fases; rastreia o feito) e
`docs/api-integracao-erp.md` (leitura p/ ERP: o quê + quando o dado é final). Ler/atualizar
ao mexer em consumo/grade/estoque/custo/financeiro/CQ.

**Motor de regras do kanban (transição de status no Desenvolvimento):** requisitos de ENTRADA
por status (todos em E). SSOT do catálogo de condições = `src/lib/kanban-condicoes.ts` (config
e enforcement leem daí; NÃO duplicar em doc). Avaliação por modelo na RPC `avaliar_condicoes_kanban`;
config guarda `tenant_config.kanban_requisitos[status_key]` (coluna PRÓPRIA — `status_kanban` só
guarda as colunas do board, `requisitos` NÃO é campo aninhado nele, apesar do nome sugerir).
**Ao adicionar condição/módulo:** catálogo TS + branch na RPC — o **teste anti-drift** (Vitest,
`tests/integration/kanban-condicoes.test.ts`) falha se as chaves não casarem. Enforcement no
Select de status E no arraste (colunas inválidas esmaecidas). Atualizar este bloco + a memória a
cada mudança (papel do `docs-keeper`). ⚠️ A condição `servico_aprovado` (key histórica,
label **"Aprovação de custo"**, módulo **Planejamento**) foi REPONTADA (jul/2026) p/
`coalesce(modelos.custo_terceirizados_aprovado,false)` — null/false não liberam; key MANTIDA
(requisitos já configurados + anti-drift seguem). **Sem mudança de chave em ago/2026**: o flag
virou boolean DERIVADO de `modelo_servico_mo` por trigger (invariantes #8/#12), mas a condição
continua lendo a MESMA coluna/key — catálogo, RPC e anti-drift inalterados. Condição `grade_todas_variantes` (Desenvolvimento):
toda variante do Tecido 1 tem `modelo_grades.grade_total > 0` (mais estrita que `grade_preenchida`).
**Auditoria + 2 condições novas (ago/2026, `20260812140000_kanban_cq_liberado_grade_cortada.sql`):**
revisadas TODAS as ~33 condições do catálogo contra o schema vivo — nenhuma lê coluna/tabela morta,
nenhuma remoção necessária (nenhum tenant tinha key obsoleta em `kanban_requisitos` de qualquer forma).
Adicionadas: **`cq_liberado`** (módulo CQ) — espelha o gate único `_cq_liberado`/`cqLiberado()`
(`src/lib/cq-status.ts`, já usado por Direcionamento/Lançar/Lançamentos): Pré confirmado E (só se
há serviço pós-costura ATIVO) Pós confirmado; reusa o helper SQL `_cq_liberado(uuid)` já existente
(20260718300000) — preferir esta a `cq_pos_confirmado` sozinha, que nunca libera modelo sem
pós-costura (`status_pos` fica 'pendente' pra sempre nesse caso, então bloquearia esses modelos
pra sempre se configurada como requisito isolado). **`grade_cortada_lancada`** (módulo Serviços) —
bloco-fonte de confecção (PL/Oficina, `detalhado`+`ativo`, resolvido por `_resolver_fonte_confeccao`,
feature Grade Cortada) tem `cortada > 0` em alguma célula do `grade_detalhe`; opt-in — só faz
sentido pra loja que usa a quantidade detalhada por tamanho×variante, modelo sem bloco-fonte nunca
satisfaz (mesma classe do `anexo_croqui`). **Variantes de gatilho de "Aprovação de custo" (Fase 3B,
set/2026, `20260906140000_kanban_mo_variantes_gatilho.sql`):** além de `servico_aprovado` (toda MO
aprovada; relabel "— aprovada"), 2 keys NOVAS lendo direto `modelo_servico_mo`: **`servico_mo_decidido`**
(nenhuma linha pendente — reprovada JÁ conta como decidida; vacuosamente true sem linha, paridade c/
`servico_aprovado`) e **`servico_mo_preenchido`** (≥1 linha com `valor>0`; false sem linha). Todas
módulo Planejamento/seção s5. Catálogo (37 chaves)+RPC+anti-drift atualizados. O tipo `Condicao`
ganhou campo `aviso?` (armadilha em âmbar no RequisitosStatusDialog) + descrições PT em todas.
**2 chaves novas (set/2026, `20260909120000`) — Catálogo agora 39:** **`enviado_para_pcp`**
(módulo `cad`, = `cad.enviado_corte`, "saiu da Explosão"; revenda satisfaz ao Enviar para PCP) e
**`separar_enviar_preenchido`** (módulo `cad`; metragem tecido OU qtd a separar aviamento OU qtd a
enviar etiqueta `cad_etiquetas.quantidade_enviar` > 0). Ver [[project_revenda_explosao_servicos]].
Candidatas descartadas: preço de venda já existe como
`preco_venda_preenchido`; "produto acabado vinculado" (revenda) não faz sentido — modelos
`origem='revenda'` nunca setam `ordem_criacao_enviada=true` (verificado no banco, 0 linhas), não
entram no kanban de Desenvolvimento. **`cad_confirmado` APOSENTADA → `cad_preenchido` (ago/2026,
`20260812150000_kanban_cad_preenchido.sql`):** 1ª rodada só trocou o LABEL de `cad_confirmado`
("CAD confirmado (enviado ao corte)" → "CAD — enviado ao corte"); o dono then decidiu que a
SEMÂNTICA em si estava errada — o marco correto não é "enviado ao corte" (isso é Serviços/CQ
downstream), é a **seção "4. CAD" do card de Desenvolvimento** (`ModeloDetailPanel`, accordion
`s-cad`, `CadTecidosSection.tsx`) estar PREENCHIDA. Semântica nova = **key nova**: `cad_confirmado`
removida do catálogo E da RPC (nenhum tenant tinha configurado — sem migração de config), key
**`cad_preenchido`** entra no lugar (label "CAD (Desenvolvimento) preenchido"). **Predicado
ajustado da proposta inicial após investigação** (autorizado explicitamente pelo dono): a proposta
era checar `cad_grades.grades_planejadas` não-vazia, mas `enviar_modelo_para_cad`
(`_enviar_modelo_para_cad_core`) copia a grade do BOM pra `cad_grades` NO MESMO INSTANTE que seta
`enviado_cad=true` — checar isso ficaria redundante com a condição `enviado_cad` já existente. Os
ÚNICOS campos que aquela RPC deixa ZERADOS até entrada manual (na tela PCP > CAD) são
`cad_tecidos.tamanho_folha` e `cad_tecido_variantes.quantidade_folhas`/`metragem_planejada` —
exatamente os 3 campos editáveis do `CadTecidosSection.tsx` ("Tamanho da folha", "Qtd Folhas",
"Metr. Planejada"). Predicado final: `EXISTS` variante do CAD do modelo com **tamanho_folha OU
quantidade_folhas OU metragem_planejada > 0**. Testado transacionalmente: CAD sem folhas → false;
CAD com ≥1 folha/metragem → true; sem CAD → false. **Rótulos revisados contra as telas atuais**
(ago/2026): `enviado_cad` → "Enviado à Explosão" (bate com filtro/tooltip do kanban),
`servico_finalizado` → "Serviços finalizados" (bate com o badge "Finalizado" de PCP > Serviços),
`cq_confirmado`/`cq_pos_confirmado` → batem com os botões "Confirmar Controle de Qualidade"/
"Confirmar CQ Pós" e as abas "Pré (costura)"/"Pós (acabamento)" — sem mudança. `direcionamento_feito`
(key mantida) teve o label trocado p/ **"Direcionamento — separado"**, alinhado ao badge "Separado"/
toast "Direcionamento confirmado — Separado" de `expedicao.direcionamento.$modeloId.tsx`.

**Kanban AUTOMÁTICO (F1/F2, set/2026, `supabase/migrations/2026093*_kanban_auto_*`):** chave
POR LOJA `tenant_config.kanban_automatico` (default `false`) — a **ÚNICA** porta de escrita é a
RPC `kanban_definir_automatico(_ligar)` (retorna `{ligado,mudou,lote_id,snapshot,cards_movidos}`);
qualquer outro UPDATE de `tenant_config` que tente mudar essa coluna é barrado pelo gatilho
**BEFORE INSERT/UPDATE `trg_kanban_chave_protegida`/`fn_kanban_chave_protegida`**, que só deixa
passar com a GUC de transação `app.kanban_chave='rpc'` (setada pela própria RPC). Com a chave
LIGADA, **coluna do board COM requisito configurado em `kanban_requisitos[status_key]` =
AUTOMÁTICA; SEM requisito (lista vazia) = MANUAL** — `Reprovado` é **SEMPRE manual**, mesmo com
requisito configurado nela (ignorado na cascata). **Derivação = caminha as colunas automáticas do
fluxo, na ordem, e PARA na 1ª que falha** (`_kanban_derivar_puro` no SQL, espelho puro
`statusDerivado` em `src/lib/kanban-auto.ts` — mesmas fixtures dos dois lados, anti-drift em
`tests/integration/kanban-auto.test.ts`); "fixado" = o card está numa coluna MANUAL diferente da
entrada do fluxo (parado de propósito numa etapa manual, não por falta de requisito). O recálculo
NÃO é síncrono: qualquer UPDATE nas ~26 colunas de `modelos` (ou tabelas-filhas do BOM/CAD que
alimentam condições) que possa mudar a derivação enfileira o modelo em
**`kanban_recalculo_fila`**, e um **CONSTRAINT TRIGGER `trg_kanban_processar_fila` `DEFERRABLE
INITIALLY DEFERRED`** processa a fila só no **COMMIT** da transação (`fn_kanban_processar_fila` →
`_kanban_aplicar(...,'auto',...)`; erro no recálculo vira só `WARNING`, nunca derruba o COMMIT que
o disparou). Movimentos manuais (arraste, "Mover para…") vão por `kanban_mover(_modelo_id,_para)`
(chave desligada → `P0001`); a prévia "N cards vão mudar" (+ REFs reveladas) é
`kanban_previa_recalculo(_cfg)`, sem gravar. **Histórico** (`modelo_kanban_historico`) ganhou
`origem` (`manual|auto|config|restauracao`) e `lote_id`; escritas `'auto'` dentro de **10 s** da
anterior (mesmo modelo) **colapsam** — um recuo/avanço transitório dentro da janela não deixa
rastro (D13/D14 do plano F1). **Com a chave ligada, o recuo automático NUNCA acende `#Erro`**
(decisão do dono, 23/set) — ele só devolve o card à coluna a que pertence; `#Erro` LEGADO
pré-existente não é apagado pelo motor (só por ação manual, como hoje). **Gates por POSIÇÃO** (REF
automática — invariante #11 — e Enviar à Explosão/`enviar_modelo_para_cad`) usam, com a chave
ligada, a posição **DERIVADA** (`alvo`), não o status gravado — `statusParaGate` em
`kanban-auto.ts` / `_kanban_status_gate` no SQL (G-inicial #6, decisão 10). Desligar restaura via
`kanban_previa_restauracao`/`kanban_restaurar` (lê `kanban_snapshot`, guardado ao ligar/mudar
config); ambas as tabelas novas (`kanban_snapshot`, `kanban_recalculo_fila`) são
RLS-ligada-sem-policy + `REVOKE ALL` de PUBLIC/anon/authenticated — só RPC `SECURITY DEFINER` lê.
Revenda/comprado usa fluxo e requisitos PRÓPRIOS (`revenda_kanban_colunas`/
`revenda_kanban_requisitos`, sem exceções). ⚠️ **ARMADILHA:** com a chave ligada e
`revenda_kanban_requisitos` **vazio**, TODA coluna do fluxo da revenda vira manual (sem requisito
configurado nela) — a derivação nunca avança além da entrada, então REF/Enviar à Explosão nunca
liberam por derivação, nem "Mover para…" ajuda (o motor ainda governa o gate por posição).
**Configurar os requisitos da revenda ANTES de ligar a chave numa loja que usa Produto
Acabado/Importado.**

## Sheet unificado do Planejamento (F3, set/2026)

O Sheet do Planejamento de Produto (`src/components/planejamento/PlanejamentoDetail.tsx`, seções
em `src/components/planejamento/planejamento-detail/` + `ficha/`) passou a editar TUDO do
Desenvolvimento: equipe/cronograma, Ajustes na Prova, BOM (tecidos/aviamentos/insumos/grade),
**CAD** (seção nova, reusa `CadTecidosSection` do Dev sem modificar), **Enviar à Explosão**
(`enviar_modelo_para_cad`), **Ficha Técnica** (imprime `PrintFicha` do Dev), **Importar dados**
(staging no rascunho/BOM/CAD — só o Salvar grava; Observações do bloco grava na hora), menu **⋯**
(Duplicar/Importar/Ficha Técnica/Cancelar Ordem) e as seções de revenda/importado. "Ver no
Desenvolvimento" **SAIU** (abria um 2º editor do mesmo BOM por cima do card — o Sheet já tem as
seções do Dev). **O Sheet do Dev (`src/components/desenvolvimento/`, `ModeloDetailPanel.tsx`) fica
INTACTO até a F5** (decisão 8 travada da campanha) — gate reproduzível: `git diff --name-only
savepoint-pre-unificacao-2026-09-22 -- src/components/desenvolvimento/
src/components/producao/cad/CadTecidosSection.tsx` dá vazio. Com **2 editores do mesmo BOM**
agora possíveis (Sheet do Planejamento e Sheet do Dev, cada um aberto por uma pessoa), a proteção
é a de sempre: `modelos.rev` otimista (P0409 se o outro salvou primeiro) + **conflito de SEÇÃO**
(ex.: `secao:bom` — "manter meu" fecha o aviso, "usar o novo" descarta e recarrega do servidor).
⚠️ **Regra operacional (não é travada pelo código): não editar o mesmo card nas duas telas ao
mesmo tempo** — o canal Realtime do Sheet do Planejamento escuta UPDATE em `modelos`, mas as
edições da Explosão/CAD feitas ali só bumpam o `rev` do `cad` (`trg_colab_rev_cad`), que o Sheet
do Dev aberto em paralelo não escuta; o Dev não recarrega o CAD sozinho. A etapa do kanban
("Mover para…") fica **FORA do Salvar** — muda na hora, direto pela RPC do kanban. Campo novo
`modelos.descricao_produto` (seção 1, migration `20260930180000`) editável nos dois Sheets.

**Sheet do Dev OCULTO + trava por seção (P-53, set/2026, deploy 26/set):**
`src/routes/_authenticated/criacao.desenvolvimento.tsx` tem `const SHEET_DEV_ATIVO = false` —
esconde o Sheet antigo do Dev (reativar = trocar para `true`); o Sheet do Planejamento passou a
ser o único editor de card em uso na prática. Com um só editor, `PlanejamentoDetail.tsx` decide
POR SEÇÃO, pelas DUAS permissões (`criacao_planejamento`/`criacao_desenvolvimento`), o que cada
usuário edita — não herda mais uma permissão só: preço de venda é seção à parte
(`criacao_planejamento:preco_venda`); campos compartilhados (coleção/subcoleção/linha/semana/mês/
ano, croqui/anexos, aviamentos/M.O., grade do comprado) seguem editáveis por QUALQUER um dos dois
papéis, espelhando o que o Dev antigo permitia; ações de ciclo (Lançar, Duplicar, Cancelar Ordem,
Enviar Ordem de Criação, Excluir) são só do Planejamento. `ReadOnlyScope` aplica o fieldset do
`SheetContent` pelas 2 permissões.

**Reorganização do Sheet F3.6 (set/2026, migration `20261005100000`, deploy 26/set):** a seção 1
"Informações Gerais do Produto" (`InfoGeraisSecao.tsx`) ganhou layout novo — L2 Nome do Modelo
(50%) | Versão (25%) | **NCM do Produto** (25%, `modelos.ncm` texto livre, sem tabela/sugestão) ·
L4 **Título para a página** (`modelos.titulo_pagina`; `NULL` = automático — Nome em "Iniciais
Maiúsculas" + `" | "` + `tenants.nome`, calculado por `_titulo_pagina_calculado`/
`src/lib/titulo-pagina.ts`; digitar igual ao automático mantém `NULL`) · L6 **Peso (kg)/
Comprimento/Largura/Altura (cm)** (`modelos.peso_kg`/`comprimento_cm`/`largura_cm`/`altura_cm`,
nullable, `MoneyInput` com casas fixas). **Preço anterior** (`modelos.preco_anterior`) entra na
seção Preço. **Keywords da loja** (`tenant_config.keywords` text) fica em Config da Loja (só
texto livre hoje, para uma tela FUTURA de super admin ler). Mesmos 6 campos + `tamanho_tipo`
replicados pelo "Replicar card(s)" do Plan. Tecido. Detalhe de fórmulas: `mapeamento-campos-
calculos.md` §17.3.

**SKU automático + SKU em prévia (F3.5a/F3.5b, set/2026, migrations `20261003100000`/
`20261005110000`/`20261006100000`/`20261006120000`, deploy 26/set):** nova seção "4. Códigos" no
Sheet do Planejamento (`CodigosSecao.tsx`) mostra REF + **"Tamanho em"** (Letra/Número —
`modelos.tamanho_tipo`, agora **obrigatório no produto**, DEFAULT `'letra'`; **sem padrão da
loja** — a chave legada `tenant_config.sku_config.tamanho_padrao` é ignorada) + a tabela de SKUs
por variante×tamanho (`modelo_skus`) + botão **Regerar**. **Formato do SKU** configurável em
Config da Loja (`FormatoSkuCard.tsx`): partes `ref`/`cor_base`/`cor_apelido`/`tamanho` na ordem
escolhida + separadores; siglas de cor em `cores`/`cores_apelido`, siglas de tamanho por LADO em
`tenant_config.tamanhos_sku`. Montagem espelhada byte a byte banco↔TS
(`src/lib/sku-montar.ts` ⇄ `public._sku_*`, anti-drift `tests/fixtures/sku-casos.ts`): sem
acento, MAIÚSCULO; falta de sigla (cor base ou tamanho) BLOQUEIA a linha (`faltas`); apelido sem
sigla cai para a cor base (`aviso`, não bloqueia). **SKU em prévia:** "Regerar" não grava direto —
devolve uma prévia só-leitura com assinatura; o Salvar do card manda essa assinatura para
`aplicar_skus_modelo`, que confere se nada mudou (REF/"Tamanho em"/grade/cores) e só então grava,
senão `RAISE P0409 previa_desatualizada` (mensagem ASCII — ver a regra de "RAISE 5xx só ASCII" na
seção de Colaboração). Detalhe: `mapeamento-campos-calculos.md` §17.1–§17.2.

**Distribuição por produto (set/2026, migration `20261006100000`, deploy 26/set):** dialog
**"Distribuir por loja"** no card do Plan. Tecido (`DistribuirPorLojaDialog.tsx`) substitui a
antiga tela `/distribuicao` — grava em `plan_tecido_variantes.distribuicao` (SÓ Tecido 1) por
cor×loja×tamanho; célula calculada = `round(proporção×Base)`, corrigível à mão (vira "manual" até
"↺ voltar ao calculado"); tamanhos mostrados = a grade filtrada pelo lado de `tamanho_tipo`. O
total por cor preenche a quantidade de peças do card; resumo por modelo também aparece no
Direcionamento. Card já **Enviado à Explosão** abre o dialog **SÓ LEITURA**. **A página antiga
`/distribuicao` está OCULTA** (`src/routes/_authenticated/distribuicao.index.tsx`, `const
PAGINA_ATIVA = false`, P-49 B) — fora do menu, mas as tabelas/RPCs antigas (`distribuicao_
tabelas` + 3 RPCs) NÃO foram dropadas (guardadas para aposentar depois, em partes — ver
`feedback_aposentar_ocultar_primeiro` na memória). Detalhe: `mapeamento-campos-calculos.md`
§17.5–§17.6.

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

**⚠️ COMPOSIÇÃO DE TIMES: ver `.claude/agents/EQUIPES.md` (playbook operacional).**
Define o time por TIPO de trabalho (correção ≠ feature ≠ modificação ≠ design ≠
banco/sensível), quais fichas cada papel carrega, o modelo por papel (planejar=Fable,
executar=Sonnet, revisar=Opus/Fable) e a regra de PRÉ-VOO (ficha defasada → atualizar
ANTES de despachar). As fichas não são invocáveis por nome no harness — o orquestrador
carrega o conteúdo delas no prompt do subagente.

Times pequenos. Em auditoria/varredura, os agentes de auditoria são **read-only**
(encontram e sugerem; não executam nem inventam). Rodar em **paralelo** por módulo; cada um
devolve achados com `arquivo:linha` + severidade. Módulo bom = "sem achados" — nunca inventar.

- **Produto & Domínio**: `product-lead` (estratégia/backlog), `domain-plm-pcp` (domínio
  PLM+PCP de moda: BOM, grade, OC, rolo, CQ, terceirizados)
- **Arquitetura & Dados**: `architect-system` (Vite+React+TanStack+Supabase multi-tenant,
  modularização, modos), `data-engineer` (schema, integridade, índices, RPCs/triggers, perf)
- **Qualidade & Código**: `code-reviewer` (React+TanStack+Supabase+RLS), `qa-engineer`
  (suíte Vitest unit + integração transacional + build/tsc/lint), `debug-expert` (causa raiz),
  `bug-hunter` (varredura proativa report-only — ficha no nível PAI do workspace,
  `PLM + Criação/.claude/agents/`, invocável por nome; ver time 🛰️ no EQUIPES.md)
- **UX**: `ux-tester` (usabilidade dos fluxos), `ui-ux-mobile` (mobile-first, lente de código),
  `mobile-ui-auditor` (varredura mobile MEDIDA no navegador — 360/390/768; prova overflow
  horizontal e drift de padrão com número + screenshot + `arquivo:linha`; ficha no nível PAI
  do workspace, `PLM + Criação/.claude/agents/`, invocável por nome; **report-only**)
- **Segurança & Infra**: `security-auditor` (RLS, RPCs DEFINER, storage, escalonamento,
  RPCs destrutivas), `devops-specialist` (db push --db-url, git, build, migrations)
- **Processos** (conduzem o ciclo de trabalho, não auditam): `release-shipper` (leva UMA
  mudança de ponta a ponta: classifica → build/tsc → migration+teste txn+diff → push),
  `docs-keeper` (mantém os 3 docs locais + memória em dia após mudança de regra de negócio)
