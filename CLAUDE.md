# CLAUDE.md — sisTrama

Contexto do projeto para sessões do Claude Code. Leia antes de qualquer tarefa.

## O que é

**sisTrama** (de *sistema* + *trama*) — um PLM + PCP para confecção de moda.
Gerencia o fluxo inteiro: cadastro de materiais → criação/desenvolvimento →
produção → financeiro. Sistema **multi-tenant** (várias lojas isoladas).

Nome de exibição: **sisTrama** ("sis" em peso leve/apagado, "Trama" em
destaque). O título antigo "PLM+PCP" ainda aparece em 4 lugares e deve ser
trocado: `app-sidebar.tsx` (~L144), `__root.tsx` (~L83), `auth.tsx` (~L83),
`_authenticated.tsx` (~L34).

## Stack

- **Vite** + **React** + **TypeScript**
- **TanStack Router** (file-based em `src/routes/`) + **TanStack Query**
- **Supabase próprio** (Postgres + RLS + Storage + Auth) — ref `ruinwcuabilumcspeyjk` (o app NÃO usa mais o banco do Lovable Cloud; só o login Google ainda passa pelo Lovable)
- **Tailwind** + **Radix UI** (componentes shadcn em `src/components/ui/`)
- **react-hook-form** + **zod** · **date-fns** · **recharts** · **lucide-react**

Fontes: **Outfit** (display) e **Figtree** (corpo) — ver `src/styles.css`.
Paleta em oklch no `styles.css` (índigo + azul-aço; vermelho = destructive).

Scripts: `npm run dev` · `npm run build` · `npm run lint`

## ⚠️ Regras críticas de ambiente

1. **O banco é um Supabase próprio** (ref `ruinwcuabilumcspeyjk`), não mais o
   Lovable Cloud (migração feita em 06/2026). Mudança de schema/RPC/policy:
   **eu escrevo a migration em `supabase/migrations/` e aplico DIRETO** com
   `supabase db push --db-url "postgresql://postgres.ruinwcuabilumcspeyjk:<SENHA>@aws-1-sa-east-1.pooler.supabase.com:5432/postgres"`.
   ⚠️ A `supabase/config.toml` ainda aponta pro ref **ANTIGO** (`wccapbvbbejjzpvlvyuf`),
   então **sempre** passar `--db-url` pro banco novo (senha em `/tmp/dbpass.txt`,
   **Session pooler**/IPv4; senha vai dentro da URL). Atalho: `psql "$(cat /tmp/dburl.txt)" -f <migration>`.
   `psql "$(cat /tmp/dburl.txt)"` serve pra inspeção e para **testar RPCs com
   teste transacional revertido** (`BEGIN; set_config('request.jwt.claims', ...); ...; ROLLBACK;`).
   **Não é mais necessário entregar SQL pro Lovable** (decisão do dono, jun/2026):
   aplicar a migration no banco próprio basta. Edição de **frontend** flui via `git push`.

2. **Auth acoplado ao Lovable.** O login usa `src/integrations/lovable/` e o
   endpoint `/~oauth/initiate`, que só existe no ambiente do Lovable. **OAuth
   Google NÃO funciona em `localhost`.** Para validar mudanças, usar o preview
   do Lovable (após push) ou login por e-mail/senha local. Não tente
   "consertar" o OAuth local — é arquitetural, some na migração.

3. **Um piloto por vez.** Não editar no Lovable e no VS Code simultaneamente.
   Sempre `git pull` antes de começar a trabalhar; `git push` ao terminar.

4. **Antes de cada commit, rode `npm run build`** (ou ao menos `tsc`). Empurrar
   código que não compila quebra o preview do Lovable.

## Arquitetura multi-tenant

- Cada usuário pertence a um tenant via `public.users.tenant_id`.
- RLS usa helpers SQL: `get_user_tenant_id()`, `is_super_admin()`,
  `has_role()`. Toda tabela de negócio filtra por `tenant_id`.
- Trigger `handle_new_user()` cria `profiles` + `user_roles` ('user') no signup.
- Roles: `super_admin` (gestão global de lojas/usuários) e por-loja via
  `user_permissions` (canView/canEdit por página, respeitado na sidebar).

## Mapa de rotas (`src/routes/_authenticated/`)

- **cadastro**: atributos, colaboradores, servico, tecidos (+variantes), aviamentos
- **criacao**: planejamento, desenvolvimento (kanban dinâmico)
- **entrada-saida**: oc-tecido, oc-aviamento, estoque
- **producao**: cad, terceirizados, oficina, cq, acabamento, direcionamento, lancamentos
- **financeiro**: calendário + lista + resumo de parcelas
- **dashboard**: 5 abas (coleção, estoque, produção, financeiro, custos)
- **admin**: lojas, usuarios, usuarios-loja, configuracoes

## Convenções de código

- Componentes de tela grandes quebram em `src/components/<modulo>/<modulo>-detail/`.
- Helper `artigoLabel()` formata nome de artigo com unidade `[metro]/[kg]`.
- Queries via TanStack Query; cuidado com **queryKeys compartilhadas** entre
  telas diferentes (já causou bug: ver Prompt 11).
- Ao ler artigo/variante, **prefira embed do Supabase** a cruzar duas queries
  manualmente (ver Prompt 12).
- Não usar `localStorage` em lógica de auth/tenant — vem do contexto/Supabase.

## Estado dos bugs (verificado em 12/06/2026, commit f736b85)

A maioria do backlog já foi corrigido. Padrões a **preservar** (não regredir):

1. **Parcelas (OC)** — ✅ corrigido. O save salva os itens ANTES de marcar
   status='recebido' (ver comentário "CRITICAL" em `oc-aviamento.tsx`). RPC
   `recalcular_parcelas` no banco. Não volte a atualizar status antes dos itens.
2. **Storage por tenant** — ✅ corrigido. Todos os buckets (tecido-variantes,
   aviamentos, artigos, modelos, oc-tecido, oc-aviamento, comprovantes,
   lancamentos) usam `(storage.foldername(name))[1] = get_user_tenant_id()`.
   Uploads usam o helper `@/lib/storage-tenant` (`tenantPrefix()`) para montar
   o path `{tenant}/...`. Todo upload novo DEVE usar esse helper.
3. **Itens de OC** — ✅ agora é diff incremental por id (update/insert/delete
   seletivo), não delete-tudo. IDs preservados.
4. **Estoque** — ✅ reserva usa `grade_total` por `variante_numero` (não mais
   divisão igual); baixa de aviamento lê `quantidade_separar`. Estoque usa
   embed de `artigos(...)` na query de variantes (resolve o título "—").
5. **Segurança** — trigger `prevent_users_self_role_change` impede auto-escalar
   role; EXECUTE revogado de `anon` nas funções SECURITY DEFINER.

**Antes de afirmar que algo está quebrado, faça `git pull` e verifique** — o
repo muda rápido (Lovable + VS Code). Backlog histórico em
`plm-pcp-status-e-prompts.md`, mas confira contra o código atual antes de usar.

## Fase 0 — integridade (jun/2026, padrões a preservar)

Auditoria por times + correção dos P0 de integridade. Não regredir:

6. **Grade Real do CQ** — `salvar_cad_completo` PRESERVA `grades_reais`/
   `grade_total_real` quando o CQ daquele CAD está `confirmado` (snapshot antes do
   DELETE). Salvar o CAD não pode zerar a grade real produzida.
7. **1 CAD por modelo (e 1 por cad_id)** — garantido por TRIGGER `enforce_unique_fk`
   (não por UNIQUE — ver "O que NÃO fazer"). `cad_grades(cad_id,variante_numero)` é
   UNIQUE composta (ok p/ `ON CONFLICT`).
8. **Enviar ao corte** — RPC `baixar_estoque_tecido_corte` é ATÔMICA: marca
   `enviado_corte` na mesma transação da baixa e retorna `deficit[]` por variante;
   o front mostra `toast.warning` com o déficit. Não voltar a fazer `update` + RPC
   separados no front.
9. **Parcelas a pagar** — `recalcular_parcelas` distribui `valor_total − Σ(pagas)`
   sobre as não-pagas (Σ == `valor_real_total`); núcleo em `_recalcular_parcelas_core`
   (sem auth) + wrapper com auth. É **automática**: trigger `trg_recalc_parcelas_valor`
   em `ocs_tecido` recalcula quando o valor muda numa OC já recebida. Guard
   `valor_total<=0` nos triggers de geração. Parcela (a pagar) ≠ `parcelas_recebimento`
   (entrega) — nunca confundir.
10. **CQ transacional** — `salvar_cq`/`desmarcar_cq` fazem status + `cq_variantes` +
    Grade Real (`cad_grades`) numa transação. O front (`producao.cq.$modeloId.tsx`)
    só chama os RPCs (sem `writeGradeReal` em loop).

**Docs de referência LOCAIS (gitignored, manter atualizados):**
`docs/mapeamento-campos-calculos.md` (campos×campos, fórmulas, etapas) e
`docs/plano-de-ataque.md` (auditoria das 7 frentes + plano de Fases; rastreia o que
já foi feito) e `docs/api-integracao-erp.md` (leitura p/ ERP: o quê + quando o dado
é final). Ler/atualizar ao mexer em consumo/grade/estoque/custo/financeiro/CQ.

## Fase 1 — segurança (jun/2026, padrões a preservar)

11. **Dashboard por permissão** — front filtra abas por `canView`; cada RPC
    `dashboard_*` é wrapper que checa **`user_can_view(_pagina)`** antes do `_core`
    (helper reutilizável; admin/tenant_admin/super_admin bypassam).
12. **`tenant_config` sempre por `tenant_id`** — toda leitura usa
    `.eq("tenant_id", useActiveTenantId())` + `enabled: !!tenantId`. NÃO depender da
    RLS (super_admin vê N linhas → quebra). Toda loja tem 1 `tenant_config` (trigger
    `trg_criar_tenant_config` na criação + backfill).
13. **Loja inativa = suspensão real** — `get_user_tenant_id()` retorna **UUID
    sentinela** (nil) p/ loja inativa (super_admin isento) → RLS bloqueia tudo e as
    RPCs dão RAISE. `meu_tenant_ativo()` + guard "Loja inativa" no layout. **Não
    retornar NULL** (vira UNKNOWN nas RPCs `<>` e fura).
14. **Enforce de módulo** — `tenant_module_enabled(_module)` (super_admin/ausência →
    true). Tabelas dos módulos desligáveis têm policies RESTRICTIVE de write; RPCs de
    escrita são wrappers que checam o módulo antes do `_core`. `recalcular_parcelas`
    fica fora (integridade). Padrão p/ guardar RPC sem reescrever o corpo: `ALTER
    FUNCTION x RENAME TO _x_core` + wrapper + `REVOKE` do core.

## O que NÃO fazer

- Não esquecer de aplicar a migration com `psql -f`/`db push --db-url` no banco novo (regra 1).
- Não mexer no fluxo de OAuth para "fazer funcionar local" (regra 2).
- Não atualizar recharts para v3 agora (tem breaking changes).
- Não editar arquivos em `src/components/ui/` (shadcn gerado) sem necessidade.
- Não commitar `.env` (já está no `.gitignore`).
- **Não criar `UNIQUE`/FK em coluna ÚNICA que é embedada** (ex.: `cad.modelo_id`,
  `controle_qualidade.cad_id`): o PostgREST passa a tratar o embed como **objeto**
  (to-one) e quebra todo código que usa `x?.[0]`/`(x ?? []).some(...)`. Para garantir
  "1:1" use **TRIGGER** (`enforce_unique_fk`), não constraint. UNIQUE **composta**
  (ex.: `cad_grades(cad_id,variante_numero)`) é segura. (Regressão real em jun/2026.)

## Agentes — organizados em times (`.claude/agents/`)

Times pequenos por especialidade. Em auditoria/varredura, agentes são **read-only**
(encontram e sugerem; não executam nem inventam).

- **Produto & Domínio**
  - `product-lead`: estratégia + backlog **para sisTrama**
  - `domain-plm-pcp`: domínio PLM+PCP **para confecção de moda** (BOM, OC, PCP, grade)
- **Arquitetura & Dados**
  - `architect-system`: arquitetura **Vite+React+TanStack+Supabase multi-tenant**
  - `data-engineer`: schema Postgres, integridade, índices, RPCs/triggers, perf de query, consistência front↔banco
- **Qualidade & Código**
  - `code-reviewer`: revisão React + TanStack Router + Supabase + RLS
  - `qa-engineer`: verificação via build/tsc/lint + teste manual de RPC por SQL
  - `debug-expert`: debug de bugs (OC, estoque, storage tenant, RPCs)
- **UX**
  - `ux-tester`: usabilidade das telas cadastro/criação/produção/financeiro/dashboard
  - `ui-ux-mobile`: UI/UX **mobile-first** (responsividade, toque, galerias/tabelas no celular)
- **Segurança & Infra**
  - `security-auditor`: RLS multi-tenant, RPCs SECURITY DEFINER, storage por tenant, escalonamento de role
  - `devops-specialist`: infra + deploy (Supabase próprio `db push --db-url`, git push/pull, build, migrations)

Para varredura de auditoria: rode os agentes em **paralelo** por módulo/setor; cada
um devolve achados com `arquivo:linha` e severidade. Se um módulo está bom, o agente
deve dizer "sem achados" — **nunca inventar** melhoria.
