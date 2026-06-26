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
- **react-hook-form** + **zod** · **date-fns** · **recharts** · **lucide-react**

Fontes: **Outfit** (display) e **Figtree** (corpo). Paleta oklch no `styles.css`
(navy/azul-aço; vermelho = destructive).

Scripts: `npm run dev` · `npm run build` · `npm run lint` · `npm test` (Vitest:
unit + integração transacional de RPC — ver `tests/README.md`)

## ⚠️ Regras críticas de ambiente

1. **O banco é um Supabase próprio** (ref `ruinwcuabilumcspeyjk`), não mais o
   Lovable Cloud (migração feita em 06/2026). Mudança de schema/RPC/policy:
   **eu escrevo a migration em `supabase/migrations/` e aplico DIRETO** com
   `supabase db push --db-url "..."` ou, mais simples, `psql "$(cat /tmp/dburl.txt)" -f <migration>`.
   ⚠️ `supabase/config.toml` aponta pro ref **ANTIGO** (`wccapbvbbejjzpvlvyuf`),
   então **sempre** passar `--db-url` pro banco novo (Session pooler/IPv4; senha
   dentro da URL — `/tmp/dburl.txt`, senha em `/tmp/dbpass.txt`).
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
   Resíduos do Lovable são só cosméticos: hosting/SEO em `sistrama.lovable.app`,
   telemetria opcional no-op (`lovable-error-reporting.ts`), strings de erro herdadas
   e `config.toml` com ref antigo (usado só pela CLI; regra 1).

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
- **Modularização**: 6 módulos liga/desliga por loja em `tenant_config.modules` (jsonb):
  `cadastro, entrada_saida, criacao, producao, financeiro, dashboard` (hook
  `useTenantModules`). **Modos da loja** em `tenant_config`: `modo_oc_rolo ∈ {oc,rolo,ambos}`,
  `modo_baixa_estoque ∈ {por_oc,automatico}`, `timezone` (`useStoreTimezone`).

## Mapa de rotas (`src/routes/_authenticated/`)

- **cadastro**: atributos (categorias tecido/aviamento/material/subcategoria, linhas,
  categorias de serviço fixas Corte/Oficina), colaboradores, servicos, tecidos
  (+variantes), aviamentos
- **criacao**: planejamento, desenvolvimento (kanban dinâmico, ficha técnica, observações)
- **entrada-saida**: oc-tecido, oc-aviamento, rolos, estoque
- **producao**: cad, terceirizados, oficina, cq (+ alertas de CQ de tecido), acabamento,
  direcionamento, lancamentos, consumo por OC
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
5. **Rolos** — `ocs_tecido.is_rolo` (estoque físico por rolo); RPC `criar_rolo`; separar =
   baixa `separacao_rolo` (reversível); `modo_oc_rolo` filtra o que aparece no Desenvolvimento.
6. **CQ** — `salvar_cq`/`desmarcar_cq` fazem status + `cq_variantes` + grade real numa txn.
   `salvar_cad_completo` PRESERVA a grade real quando o CQ do CAD está confirmado. CQ de
   tecido em `ocs_tecido_itens.cq_*` + página Alertas (`cq_alerta_status`: troca/cancelar).
7. **1 CAD por modelo** — garantido por TRIGGER `enforce_unique_fk` (NÃO por UNIQUE, ver
   "O que NÃO fazer"). Enviar ao corte (`baixar_estoque_tecido_corte`) é atômico e retorna
   `deficit[]` por variante.
8. **Serviços no financeiro** — serviços terceirizados externos viram contas a pagar
   (`parcelas_servico` + RPC `servicos_financeiro`); oficina entra após CQ confirmado.
9. **Segurança / RPC** — padrão **wrapper + `_core`**: o wrapper checa
   `user_can_view(_pagina)` (dashboards) ou `tenant_module_enabled(_module)` (módulos
   desligáveis) e o `_core` tem EXECUTE revogado de anon. Loja inativa = suspensão real
   (sentinela nil → RLS bloqueia + RPCs dão RAISE). `reset_loja`/`excluir_loja` são
   super_admin-only; `_wipe_tenant_core` usa `session_replication_role=replica` (FKs p/
   `tenants` são NO ACTION); super_admins nunca são apagados.

**Docs de referência LOCAIS (gitignored, manter atualizados — papel do agente `docs-keeper`):**
`docs/mapeamento-campos-calculos.md` (campos×campos, fórmulas, etapas),
`docs/plano-de-ataque.md` (auditoria das 7 frentes + Fases; rastreia o feito) e
`docs/api-integracao-erp.md` (leitura p/ ERP: o quê + quando o dado é final). Ler/atualizar
ao mexer em consumo/grade/estoque/custo/financeiro/CQ.

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
