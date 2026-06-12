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
- **Supabase** (Postgres + RLS + Storage + Auth) — atualmente via **Lovable Cloud**
- **Tailwind** + **Radix UI** (componentes shadcn em `src/components/ui/`)
- **react-hook-form** + **zod** · **date-fns** · **recharts** · **lucide-react**

Fontes: **Outfit** (display) e **Figtree** (corpo) — ver `src/styles.css`.
Paleta em oklch no `styles.css` (índigo + azul-aço; vermelho = destructive).

Scripts: `npm run dev` · `npm run build` · `npm run lint`

## ⚠️ Regras críticas de ambiente

1. **O banco é Lovable Cloud, não um Supabase próprio.** Migrations novas em
   `supabase/migrations/` que chegam por push **NÃO rodam sozinhas** no banco.
   Enquanto estiver no Cloud, mudança de schema/RPC/policy passa pelo chat do
   Lovable. Edição de **frontend** flui normal via `git push`. (Migração para
   Supabase próprio está planejada — ver `migracao/GUIA-MIGRACAO.md`.)

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

## ⚠️ Bugs conhecidos / backlog

Há um documento com 18 prompts de correção (`plm-pcp-status-e-prompts.md`).
Os críticos, em resumo:

1. **Parcelas (OC)**: o save atualiza a OC ANTES de salvar os itens, e o
   trigger de parcelas lê itens velhos. Correção: salvar itens primeiro,
   depois chamar RPC `recalcular_parcelas_oc` (já desenhada na migração).
2. **Storage sem isolamento por tenant**: policies dos 8 buckets não checam
   tenant. Path de upload deve ser `{tenant_id}/...`.
3. **Itens de OC delete+insert não-atômico**: IDs mudam a cada save.
   (Nuance: itens de tecido podem repetir variante — não usar UNIQUE ingênuo.)
4. **Estoque**: reserva dividida igual entre variantes (devia usar grade por
   variante); baixa de aviamento usa campo calculado em vez do real.

Ao tocar OC/estoque/parcelas, **não reintroduza** esses padrões.

## O que NÃO fazer

- Não criar migration esperando que rode sozinha (regra 1).
- Não mexer no fluxo de OAuth para "fazer funcionar local" (regra 2).
- Não atualizar recharts para v3 agora (tem breaking changes).
- Não editar arquivos em `src/components/ui/` (shadcn gerado) sem necessidade.
- Não commitar `.env` (já está no `.gitignore`).