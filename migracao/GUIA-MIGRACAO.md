# Guia de Migração — Lovable Cloud → Supabase próprio

Runbook para mover o **sisTrama** do banco do Lovable Cloud para um projeto
**Supabase próprio**. Específico deste app.

> **Boa notícia:** o cliente de dados já é Supabase padrão
> ([`src/integrations/supabase/client.ts`](../src/integrations/supabase/client.ts)),
> dirigido por variáveis de ambiente. Trocar o banco é, na prática, **trocar as
> env vars** + migrar dados/arquivos/usuários. O único acoplamento ao Lovable é
> o **login Google** (`@lovable.dev/cloud-auth-js`, usado só em
> [`src/routes/auth.tsx`](../src/routes/auth.tsx)).

## Convenções (preencha)

| Item | Valor |
|------|-------|
| Projeto ANTIGO (Lovable) — ref | `wccapbvbbejjzpvlvyuf` |
| Projeto NOVO — ref | `<NEW_REF>` |
| URL nova | `https://<NEW_REF>.supabase.co` |
| Anon/publishable key nova | `<NEW_ANON_KEY>` |
| Connection string ANTIGO (direta, :5432) | `<OLD_DB_URL>` |
| Connection string NOVO (direta, :5432) | `<NEW_DB_URL>` |

> Use sempre a conexão **direta** (porta 5432), não o pooler (6543), para
> dump/restore. Pegue as strings em **Project Settings → Database** de cada projeto.
> No Lovable Cloud, a connection string fica no painel do Supabase vinculado.

## Pré-requisitos

- [x] Projeto Supabase novo criado.
- [ ] Supabase CLI: `brew install supabase/tap/supabase` (ou `npx supabase`).
- [ ] `psql` e `pg_dump`/`pg_restore` (vêm com `postgresql`: `brew install libpq` e adicione ao PATH).
- [ ] Connection string do banco **antigo** (Lovable) e do **novo**.
- [ ] **Janela de manutenção**: peça para ninguém editar (Lovable ou app) durante a virada — evita dado novo no antigo após o dump.

---

## Fase 1 — Schema no projeto novo

As 54 migrations em `supabase/migrations/` contêm tabelas, RLS, triggers
(`handle_new_user`, `set_tenant_id`, geração de parcelas…) e funções
SECURITY DEFINER (`recalcular_parcelas`, `salvar_modelo_bom`,
`estoque_tecido_por_artigo`, `detalhe_estoque_variante`…).

```bash
# na raiz do repo
supabase login
supabase link --project-ref <NEW_REF>      # vai pedir a senha do banco novo
supabase db push                           # aplica TODAS as migrations no banco novo
```

Validação:
```bash
psql "<NEW_DB_URL>" -c "select count(*) from public.modelos;"          # deve existir (0 linhas)
psql "<NEW_DB_URL>" -c "select proname from pg_proc where proname in
  ('recalcular_parcelas','salvar_modelo_bom','get_user_tenant_id','handle_new_user');"
```

> Se `db push` reclamar de migration já aplicada, o projeto não estava limpo —
> use um projeto realmente novo, ou `supabase migration repair` conforme indicado.

---

## Fase 2 — Storage: buckets + políticas

As **políticas** de storage vêm nas migrations (RLS em `storage.objects`,
path por tenant: `(storage.foldername(name))[1] = get_user_tenant_id()`), mas os
**buckets em si** podem precisar ser criados. Crie os buckets (todos **privados**)
com EXATAMENTE estes nomes:

```
tenant-logos · tecido-variantes · artigos · aviamentos · modelos
oc-tecido · oc-aviamento · comprovantes · lancamentos
```

Via SQL (idempotente):
```sql
insert into storage.buckets (id, name, public)
values
 ('tenant-logos','tenant-logos',false),
 ('tecido-variantes','tecido-variantes',false),
 ('artigos','artigos',false),
 ('aviamentos','aviamentos',false),
 ('modelos','modelos',false),
 ('oc-tecido','oc-tecido',false),
 ('oc-aviamento','oc-aviamento',false),
 ('comprovantes','comprovantes',false),
 ('lancamentos','lancamentos',false)
on conflict (id) do nothing;
```
Rode no **SQL Editor** do projeto novo. As policies de `storage.objects` já vieram
no `db push`; confira em Storage → Policies.

---

## Fase 3 — Dados (data-only)

> Faça **depois** da Fase 1 (schema já existe no novo). Triggers devem ficar
> **desligados** no restore para não duplicar/alterar dados.

```bash
# Dump SÓ dos dados do schema public, formato custom
pg_dump "<OLD_DB_URL>" \
  --data-only --schema=public \
  --no-owner --no-privileges \
  -Fc -f dados_public.dump

# Restore desligando triggers (precisa da conexão direta como usuário postgres)
pg_restore "<NEW_DB_URL>" \
  --data-only --disable-triggers \
  --no-owner --no-privileges \
  dados_public.dump
```

Se aparecer violação de FK mesmo com `--disable-triggers`, rode o restore dentro de
uma transação com replicação desligada:
```bash
psql "<NEW_DB_URL>" -c "set session_replication_role = replica;" \
  -c "\\i dados_public.dump"   # use a versão .sql se preferir; ou pg_restore como acima
```

Validação (compare contagens com o antigo):
```bash
for t in modelos artigos ocs_tecido ocs_aviamento parcelas cad producao_terceirizados; do
  echo -n "$t: "; psql "<NEW_DB_URL>" -tAc "select count(*) from public.$t;"
done
```

---

## Fase 4 — Usuários (auth)

Preserve os **mesmos UUIDs** dos usuários (o `public.users`/`profiles`/`user_roles`
já restaurados na Fase 3 referenciam esses ids).

```bash
# Dump das tabelas de auth essenciais (usuários + identidades OAuth)
pg_dump "<OLD_DB_URL>" \
  --data-only --no-owner --no-privileges \
  -t auth.users -t auth.identities \
  -Fc -f auth_users.dump

# Restore (idealmente ANTES da Fase 3; se já fez a 3, tudo bem, os ids batem)
pg_restore "<NEW_DB_URL>" \
  --data-only --disable-triggers --no-owner --no-privileges \
  auth_users.dump
```

Notas:
- `encrypted_password` é copiado → senhas continuam funcionando.
- Usuários de **Google OAuth** vêm em `auth.identities`; após configurar o Google
  no projeto novo (Fase 6), o login casa pelo e-mail/sub.
- Confira: `select count(*) from auth.users;` no novo = antigo.

---

## Fase 5 — Arquivos do Storage

Não há comando nativo de cópia entre projetos. Use um script (Node) que baixa do
antigo e sobe no novo, por bucket. Esqueleto em
[`migracao/copiar-storage.mjs`](./copiar-storage.mjs) *(criar quando for executar)*:

```js
// node copiar-storage.mjs   (precisa do SERVICE ROLE key dos dois projetos)
import { createClient } from "@supabase/supabase-js";
const OLD = createClient(process.env.OLD_URL, process.env.OLD_SERVICE_KEY);
const NEW = createClient(process.env.NEW_URL, process.env.NEW_SERVICE_KEY);
const BUCKETS = ["tenant-logos","tecido-variantes","artigos","aviamentos","modelos","oc-tecido","oc-aviamento","comprovantes","lancamentos"];
async function listAll(c, b, prefix = "") {
  const out = []; const { data } = await c.storage.from(b).list(prefix, { limit: 1000 });
  for (const it of data ?? []) {
    const path = prefix ? `${prefix}/${it.name}` : it.name;
    if (it.id === null) out.push(...await listAll(c, b, path)); // pasta
    else out.push(path);
  }
  return out;
}
for (const b of BUCKETS) {
  for (const path of await listAll(OLD, b)) {
    const { data: blob } = await OLD.storage.from(b).download(path);
    await NEW.storage.from(b).upload(path, blob, { upsert: true });
    console.log(b, path);
  }
}
```
> Use as **service role keys** (Project Settings → API). Nunca commite essas chaves.

---

## Fase 6 — Desacoplar o Auth (código) + configurar Google

No painel do Supabase **novo**: Authentication → Providers → **Google** →
preencher Client ID/Secret (do Google Cloud) e copiar a **Redirect URL**
`https://<NEW_REF>.supabase.co/auth/v1/callback` para o console do Google.
Em Authentication → URL Configuration, definir **Site URL** e **Redirect URLs**
(inclua a URL de produção e `http://localhost:3000`).

No código (posso fazer numa branch quando você pedir):
1. Em [`src/routes/auth.tsx`](../src/routes/auth.tsx) (~L83), trocar
   ```ts
   const result = await lovable.auth.signInWithOAuth("google", { redirect_uri, extraParams });
   ```
   por
   ```ts
   const { error } = await supabase.auth.signInWithOAuth({
     provider: "google",
     options: { redirectTo: `${window.location.origin}/` },
   });
   ```
2. Remover o import `@/integrations/lovable` e apagar
   [`src/integrations/lovable/index.ts`](../src/integrations/lovable/index.ts).
3. Remover a dependência `@lovable.dev/cloud-auth-js` do `package.json`.
4. (Opcional) trocar as URLs `sistrama.lovable.app` em `auth.tsx` pela URL nova.

> E-mail/senha já usa `supabase.auth` puro — nada a mudar.
> Bônus: o OAuth passa a funcionar em `localhost` (some a limitação da regra 2 do CLAUDE.md).

---

## Fase 7 — Virar a chave (env)

Atualize as variáveis no `.env` (e no painel do host de produção):
```
VITE_SUPABASE_URL=https://<NEW_REF>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<NEW_ANON_KEY>
VITE_SUPABASE_PROJECT_ID=<NEW_REF>
SUPABASE_URL=https://<NEW_REF>.supabase.co
SUPABASE_PUBLISHABLE_KEY=<NEW_ANON_KEY>
SUPABASE_PROJECT_ID=<NEW_REF>
```
E `supabase/config.toml` → `project_id = "<NEW_REF>"`.

Build local de fumaça:
```bash
npm run build
npm run dev   # login por e-mail/senha deve apontar para o banco novo
```

> **Hospedagem**: o app é TanStack Start (SSR). Migrar o *banco* não exige sair do
> Lovable — você pode continuar publicando pelo Lovable apontando para o Supabase
> novo, ou mover o deploy (Vercel/Netlify/servidor Node) depois. Decisão separada.

---

## Fase 8 — Verificação (checklist pós-virada)

- [ ] Login por e-mail/senha.
- [ ] Login Google (produção e localhost).
- [ ] Isolamento por tenant (usuário só vê a própria loja).
- [ ] Cadastro: tecidos/aviamentos/atributos/serviço listam e salvam.
- [ ] Imagens (variantes, modelos, aviamentos) carregam (storage + signed URLs).
- [ ] Entrada/Saída: criar OC, marcar recebido, parcelas geradas (RPC), estoque atualiza.
- [ ] Criação: planejamento (estoque do tecido), desenvolvimento (salvar BOM, enviar ao CAD).
- [ ] Produção: CAD → confirmar → terceirizados → CQ; calendário do dashboard.
- [ ] Admin: lojas/usuários; criação de novo usuário dispara `handle_new_user`.

---

## Rollback

Enquanto não trocar as env vars de produção, o app continua no Lovable Cloud
(nada muda para o usuário). O ensaio de migração é feito no projeto novo em
paralelo. Para reverter: apontar as env vars de volta para o projeto antigo.
Mantenha o projeto antigo intacto por algumas semanas após a virada.

## Ordem recomendada

1. Fase 1 (schema) → 2 (buckets) — pode fazer a qualquer momento (não afeta produção).
2. **Janela de manutenção**: Fase 4 (auth) → 3 (dados) → 5 (arquivos).
3. Fase 6 (código auth + Google) na branch, testar contra o projeto novo.
4. Fase 7 (env) → 8 (verificação). Comunicar usuários.
