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
  lado da qtd). RPC `otb_confirmar` reconcilia cards em branco por **bucket = (subcoleção × semana × categoria)** —
  cada modelo nasce c/ `colecao_id`+`subcolecao`+`semana`(+`categoria_principal_id` se distribuído). **Sincronização
  bidirecional**: (1) diminuir a qtd no OTB remove cards **"vazios"** (só os campos que o OTB preenche +
  status em_planejamento/reprovado — o predicado NÃO conta coleção/subcoleção/semana/categoria como "tocado";
  NUNCA apaga card que o usuário mexeu ou que avançou); (2) **apagar um card baixa a qtd** da sua semana/subcoleção/
  categoria — trigger `trg_otb_dec_semana` em `modelos` (só p/ `colecao_id` not null), com trava GUC
  `app.otb_reconciling` que `otb_confirmar`/`otb_excluir_colecao` setam p/ o encolher da RPC não decrementar 2×.
  RPC `otb_importar_colecoes`. **Integridade OTB↔Planejamento** (total tem que bater): `otb_confirmar` também
  **limpa órfãos** (remove cards vazios em Planejamento/Rejeitado fora de qualquer bucket — sobras do modelo
  antigo); a distribuição por categoria pode ser **parcial** (Σcat ≤ total; o **resto** vira cards sem categoria);
  e o `ColecaoSheet` tem um bloco **"Não classificados"** (cards sem semana/subcoleção) com **Atribuir** direto →
  RPC `otb_atribuir_card`. **Gatilho `fn_otb_sync_semana`** (`modelos` AFTER INSERT/UPDATE/DELETE) mantém as qtds
  do OTB em QUALQUER caminho (reclassificar semana/subcoleção/categoria direto no Planejamento, criar/apagar card,
  trocar de coleção); trava `app.otb_reconciling` desliga o gatilho em `otb_confirmar`/`otb_excluir_colecao`/
  `otb_importar_colecoes`. `modelos.subcolecao` (texto): no Planejamento/
  Desenvolvimento vira **dropdown das subcoleções da coleção** quando OTB ligado (senão texto livre). Preenchimento
  em massa no Planejamento (`BulkEditDialog`). O Planejamento abre **sempre com 5 colunas** (`useGridCols(...,5,true)`
  — não persiste); card mostra coleção→subcoleção→semana→mês/ano.
- **cadastro**: atributos (categorias tecido/aviamento/material/subcategoria, linhas,
  categorias de serviço fixas Corte/Oficina), colaboradores, servicos, tecidos
  (+variantes), aviamentos
- **criacao**: planejamento, desenvolvimento (kanban dinâmico, ficha técnica, observações)
- **entrada-saida**: oc-tecido, oc-aviamento, rolos, estoque
- **producao**: cad, terceirizados=**Serviços** (abas pré/pós-costura por `categorias_terceirizado.etapa`),
  oficina, cq (abas **Pré/Pós** dentro do item — ver invariante 6), direcionamento, lancamentos,
  consumo por OC (+ alertas de CQ de tecido). **Acabamento aposentado** (virou serviço pós-costura) — o
  código morto foi REMOVIDO (jul/2026, commits `2bdfcf2` front + `600cf54` banco): rotas
  `producao.acabamento.*`, permissão `producao_acabamento`, ramo `oficina_posicao`, tabela
  `producao_acabamento` (0 linhas), RPC `salvar_acabamento` e coluna `tenant_config.oficina_posicao`.
  **Mantidos de propósito** (não são resíduo): o literal `WHEN 'producao_acabamento'` em `fn_audit` (rótulo
  de linhas históricas do audit_log) e as colunas `modelos.categoria_secundaria_id` / `categorias_produto.sla_oficina`
  / `tenant_config.etapas_acabamento` (têm dado ou leitor vivo). Se um laudo/doc antigo cita "Acabamento", é
  histórico. Editor de Impressão REMOVIDO (Ficha de Corte usa sempre o cabeçalho padrão `FichaHeader`)
- **financeiro**: calendário + lista + parcelas (a pagar) + serviços terceirizados
- **dashboard**: 5 abas (coleção, estoque, produção, financeiro, custos)
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

## Invariantes a preservar (não regredir)

Padrões já corrigidos/estabelecidos. **Antes de afirmar que algo está quebrado, `git pull`
e verifique** — o repo muda rápido.

1. **Parcelas (OC)** — salvar itens ANTES de `status='recebido'` (comentário "CRITICAL"
   em `oc-aviamento.tsx`). `recalcular_parcelas` distribui `total − Σ(pagas)`; é automática
   via trigger. **Parcela a pagar (prazo 30/60/90) ≠ `parcelas_recebimento` (entrega).**
2. **Storage por tenant** — todos os buckets via `(storage.foldername(name))[1] =
   get_user_tenant_id()`; uploads via `tenantPrefix()`.
3. **Itens de OC** — diff incremental por id (update/insert/delete seletivo); IDs preservados.
4. **Estoque** — físico = recebido − baixa POR ITEM; baixa **sempre** no ledger
   `estoque_tecido_baixas` (nunca subtrair de coluna agregada). Reserva por `grade_total`/
   `variante_numero`. "- Metragem" = baixa de ajuste; zerar libera reserva.
   ⚠️ Excluir tecido/cor (Cadastro > Tecidos) é **só via RPC com guarda** `excluir_tecido`/
   `excluir_variante_tecido` (contam uso em OC/estoque/modelo/CAD/ordem e bloqueiam; senão
   apagam e devolvem as fotos p/ limpar storage DEPOIS). `estoque_tecido_baixas.variante_tecido_id`
   é **NO ACTION** de propósito (era CASCADE — apagava o ledger em silêncio); NÃO voltar p/ CASCADE.
   Índice único parcial `(artigo,cor,apelido)` barra variante duplicada; categorias via
   `set_artigo_categorias` (atômico).
5. **Rolos** — `ocs_tecido.is_rolo` (estoque físico por rolo); RPC `criar_rolo`; separar =
   baixa `separacao_rolo` (reversível); `modo_oc_rolo` filtra o que aparece no Desenvolvimento.
6. **CQ** — `salvar_cq`/`desmarcar_cq` fazem status + `cq_variantes` + grade real numa txn.
   `salvar_cad_completo` PRESERVA a grade real quando o CQ do CAD está confirmado. CQ de
   tecido em `ocs_tecido_itens.cq_*` + página Alertas (`cq_alerta_status`: troca/cancelar).
   **CQ Pré/Pós (Fase 3):** 2 visões DENTRO do item. **Pré** = o de sempre (status, `cq_variantes`,
   grade real → `cad_grades`). **Pós** (acabamento) = `controle_qualidade.status_pos` + tabela
   `cq_pos_variantes` (serviço pós-costura × variante × etapa), RPCs `salvar_cq_pos`/`desmarcar_cq_pos`
   que **NÃO** tocam `cad_grades` (só exibem a grade real do Pré). Gates: Pré abre com pré finalizado;
   Pós com pós finalizado; **Direcionamento exige Pré E (se há pós) Pós confirmados.** "Sem acabamento"
   = `cad.sem_acabamento` (Pré finalizado vira Finalizado sem pós).
7. **1 CAD por modelo** — garantido por TRIGGER `enforce_unique_fk` (NÃO por UNIQUE, ver
   "O que NÃO fazer"). Enviar ao corte (`baixar_estoque_tecido_corte`) é atômico e retorna
   `deficit[]` por variante.
8. **Serviços no financeiro** — serviços terceirizados externos viram contas a pagar
   (`parcelas_servico` + RPC `servicos_financeiro`); oficina entra após CQ confirmado.
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
a memória a cada mudança (papel do `docs-keeper`).

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
