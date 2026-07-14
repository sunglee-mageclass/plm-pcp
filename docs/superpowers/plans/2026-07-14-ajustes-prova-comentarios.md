# Ajustes na Prova (comentários) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar "Ajustes na Prova" (hoje um textarea em `modelos.ajustes_prova`) num fio de comentários numa seção própria "2. Ajustes na Prova" do card de Desenvolvimento.

**Architecture:** Tabela dedicada `modelo_prova_comentarios` (fio de 2 níveis via `parent_id`, `resolvido`, autor/data) + RPCs DEFINER para comentar/resolver/excluir (excluir só pelo autor) + leitura via RLS por tenant. Front: componente novo `ModeloAjustesProvaSection` com abas Abertos/Resolvidos, plugado no accordion do `ModeloDetailPanel` (renumerando as seções 3–7). Migração dos 6 textos existentes como 1º comentário importado.

**Tech Stack:** Postgres (Supabase, RLS) · migration via `psql -f` · React + TanStack Query + shadcn (Tabs, Accordion, Textarea, AlertDialog) · Vitest (teste transacional de RPC, opcional).

## Global Constraints

- Banco = Supabase próprio (ref `ruinwcuabilumcspeyjk`). Aplicar migration com `psql "$(cat /tmp/dburl.txt)" -f <arq>`. Testar RPC em txn revertida: `BEGIN; SELECT set_config('request.jwt.claims', json_build_object('sub','<uid>')::text, true); …; ROLLBACK;`.
- Invariante #9: RPC DEFINER que age em nome do usuário → `REVOKE EXECUTE … FROM PUBLIC, anon;` e `GRANT … TO authenticated;`. (Aqui as RPCs fazem a própria checagem de tenant/autor; não precisam de `_core` porque não são gated por `user_can_view`/módulo.)
- `npm run build` NÃO roda tsc → sempre `npx tsc --noEmit 2>&1 | grep -cE "error TS"` (esperado 0) + `npm run build`.
- Erros em PT-BR via `mensagemErro(e, fallback)` (@/lib/erro-mensagem) em todo `toast.error`.
- queryKey única `["prova-comentarios", modeloId]` (não compartilhar).
- Data/hora exibida no **fuso da loja** via `useStoreTimezone` (não do device).
- `codigo`/colunas novas fora do `types.ts` gerado → castar `as unknown as <Tipo>` na query (backlog de regenerar types.ts).
- Reaproveitar o `npm run dev` que o dono já roda (detectar porta); NUNCA `pkill -f "vite"`.

---

### Task 1: Migration — tabela + RLS + RPCs + backfill

**Files:**
- Create: `supabase/migrations/20260718160000_prova_comentarios.sql`

**Interfaces:**
- Produces (consumidas pelo front na Task 2/3):
  - Tabela `public.modelo_prova_comentarios(id, tenant_id, modelo_id, parent_id, user_id, texto, resolvido, resolvido_at, resolvido_por, created_at)` com RLS SELECT por tenant.
  - `public.prova_comentar(_modelo_id uuid, _texto text, _parent_id uuid DEFAULT NULL) RETURNS uuid` — cria comentário/resposta (reancora resposta pro topo); grava tenant/user do contexto.
  - `public.prova_resolver(_id uuid, _resolvido boolean) RETURNS void` — resolve/reabre fio de topo.
  - `public.prova_excluir(_id uuid) RETURNS void` — exclui (só o autor); CASCADE apaga respostas.

- [ ] **Step 1: Escrever a migration**

Criar `supabase/migrations/20260718160000_prova_comentarios.sql` com:

```sql
-- Ajustes na Prova como comentários. Tabela dedicada (fio de 2 níveis via parent_id,
-- resolvido, autor/data). Leitura por RLS (tenant); escrita por RPCs DEFINER (comentar/
-- resolver/excluir). Backfill do texto legado (modelos.ajustes_prova) como 1º comentário.

BEGIN;

CREATE TABLE IF NOT EXISTS public.modelo_prova_comentarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  modelo_id uuid NOT NULL REFERENCES public.modelos(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES public.modelo_prova_comentarios(id) ON DELETE CASCADE,  -- null = fio de topo
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,                      -- null = importado
  texto text NOT NULL,
  resolvido boolean NOT NULL DEFAULT false,      -- só no fio de topo
  resolvido_at timestamptz,
  resolvido_por uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mpc_modelo ON public.modelo_prova_comentarios(modelo_id, parent_id, created_at);
CREATE INDEX IF NOT EXISTS idx_mpc_tenant ON public.modelo_prova_comentarios(tenant_id);

ALTER TABLE public.modelo_prova_comentarios ENABLE ROW LEVEL SECURITY;
-- Leitura por tenant. Escrita SÓ via RPC (DEFINER, owner postgres bypassa RLS) — sem policy
-- de INSERT/UPDATE/DELETE p/ cliente, então texto/autor ficam sob controle das RPCs.
DROP POLICY IF EXISTS mpc_tenant_select ON public.modelo_prova_comentarios;
CREATE POLICY mpc_tenant_select ON public.modelo_prova_comentarios FOR SELECT
  USING (tenant_id = public.get_user_tenant_id());

-- Comentar/responder. Reancora a resposta pro fio de TOPO (2 níveis). tenant/user do contexto.
CREATE OR REPLACE FUNCTION public.prova_comentar(_modelo_id uuid, _texto text, _parent_id uuid DEFAULT NULL)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_uid uuid := auth.uid();
  v_top uuid := NULL;
  v_new uuid;
BEGIN
  IF v_tenant IS NULL OR v_uid IS NULL THEN RAISE EXCEPTION 'Sem sessão' USING ERRCODE = '42501'; END IF;
  IF _texto IS NULL OR btrim(_texto) = '' THEN RAISE EXCEPTION 'Comentário vazio'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.modelos m WHERE m.id = _modelo_id AND m.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Modelo não encontrado' USING ERRCODE = '42501';
  END IF;
  IF _parent_id IS NOT NULL THEN
    SELECT COALESCE(c.parent_id, c.id) INTO v_top          -- resposta de resposta achata no topo
      FROM public.modelo_prova_comentarios c
      WHERE c.id = _parent_id AND c.tenant_id = v_tenant AND c.modelo_id = _modelo_id;
    IF v_top IS NULL THEN RAISE EXCEPTION 'Comentário pai inválido'; END IF;
  END IF;
  INSERT INTO public.modelo_prova_comentarios (tenant_id, modelo_id, parent_id, user_id, texto)
  VALUES (v_tenant, _modelo_id, v_top, v_uid, btrim(_texto))
  RETURNING id INTO v_new;
  RETURN v_new;
END;
$function$;

-- Resolver/reabrir (só fio de topo). Qualquer usuário do tenant.
CREATE OR REPLACE FUNCTION public.prova_resolver(_id uuid, _resolvido boolean)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid := public.get_user_tenant_id(); v_uid uuid := auth.uid();
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem tenant' USING ERRCODE = '42501'; END IF;
  UPDATE public.modelo_prova_comentarios
     SET resolvido = _resolvido,
         resolvido_at = CASE WHEN _resolvido THEN now() ELSE NULL END,
         resolvido_por = CASE WHEN _resolvido THEN v_uid ELSE NULL END
   WHERE id = _id AND tenant_id = v_tenant AND parent_id IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fio não encontrado'; END IF;
END;
$function$;

-- Excluir — SÓ o autor. CASCADE apaga as respostas do fio.
CREATE OR REPLACE FUNCTION public.prova_excluir(_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid := public.get_user_tenant_id(); v_uid uuid := auth.uid();
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.modelo_prova_comentarios
    WHERE id = _id AND tenant_id = v_tenant AND user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'Só o autor pode excluir' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.modelo_prova_comentarios WHERE id = _id AND tenant_id = v_tenant AND user_id = v_uid;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.prova_comentar(uuid, text, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.prova_resolver(uuid, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.prova_excluir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prova_comentar(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.prova_resolver(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.prova_excluir(uuid) TO authenticated;

-- Backfill: texto legado vira 1º comentário (importado, sem autor, data = criação do modelo).
-- Idempotente: pula se o modelo já tem comentário importado (user_id null).
INSERT INTO public.modelo_prova_comentarios (tenant_id, modelo_id, parent_id, user_id, texto, created_at)
SELECT m.tenant_id, m.id, NULL, NULL, btrim(m.ajustes_prova), m.created_at
FROM public.modelos m
WHERE m.ajustes_prova IS NOT NULL AND btrim(m.ajustes_prova) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM public.modelo_prova_comentarios c WHERE c.modelo_id = m.id AND c.user_id IS NULL
  );

COMMIT;
```

- [ ] **Step 2: Aplicar a migration**

Run: `psql "$(cat /tmp/dburl.txt)" -f supabase/migrations/20260718160000_prova_comentarios.sql`
Expected: `BEGIN … CREATE TABLE … CREATE FUNCTION (×3) … REVOKE … GRANT … INSERT 0 6 … COMMIT` (o `INSERT 0 6` = os 6 textos migrados).

- [ ] **Step 3: Testar comentar + responder (reancoragem 2 níveis) em txn**

```bash
psql "$(cat /tmp/dburl.txt)" <<'SQL'
SELECT u.id AS uid, u.tenant_id AS tid FROM users u JOIN tenants t ON t.id=u.tenant_id WHERE t.nome ILIKE '%Loja Teste%' LIMIT 1 \gset
SELECT id AS mid FROM modelos WHERE tenant_id=:'tid' LIMIT 1 \gset
BEGIN;
SELECT set_config('request.jwt.claims', json_build_object('sub', :'uid')::text, true);
SELECT prova_comentar(:'mid','Ajustar manga', NULL) AS topo \gset
SELECT prova_comentar(:'mid','Encurtei 2cm', :'topo') AS r1 \gset
SELECT prova_comentar(:'mid','resposta de resposta', :'r1') AS r2 \gset
-- r1 e r2 devem ter parent_id = topo (2 níveis)
SELECT id=:'topo' AS eh_topo, parent_id=:'topo' AS ancora_no_topo FROM modelo_prova_comentarios WHERE id IN (:'r1',:'r2');
ROLLBACK;
SQL
```
Expected: as duas linhas (r1, r2) com `ancora_no_topo = t` (a resposta de resposta reancorou pro fio de topo).

- [ ] **Step 4: Testar resolver/reabrir + excluir só-autor em txn**

```bash
psql "$(cat /tmp/dburl.txt)" <<'SQL'
SELECT u.id AS uid, u.tenant_id AS tid FROM users u JOIN tenants t ON t.id=u.tenant_id WHERE t.nome ILIKE '%Loja Teste%' LIMIT 1 \gset
SELECT id AS mid FROM modelos WHERE tenant_id=:'tid' LIMIT 1 \gset
SELECT id AS outro FROM users WHERE id <> :'uid' LIMIT 1 \gset
BEGIN;
SELECT set_config('request.jwt.claims', json_build_object('sub', :'uid')::text, true);
SELECT prova_comentar(:'mid','fio p/ resolver', NULL) AS t \gset
SELECT prova_resolver(:'t', true);
SELECT resolvido, resolvido_por=:'uid' AS por_mim FROM modelo_prova_comentarios WHERE id=:'t';
SELECT prova_resolver(:'t', false);
SELECT resolvido, resolvido_at IS NULL AS limpou FROM modelo_prova_comentarios WHERE id=:'t';
-- excluir por OUTRO usuário deve falhar
SELECT set_config('request.jwt.claims', json_build_object('sub', :'outro')::text, true);
DO $$ BEGIN PERFORM prova_excluir(current_setting('x.t')); EXCEPTION WHEN others THEN RAISE NOTICE 'bloqueou excluir de outro: OK'; END $$;
ROLLBACK;
SQL
```
Expected: resolver → `resolvido=t, por_mim=t`; reabrir → `resolvido=f, limpou=t`. (O teste do excluir-de-outro pode ser feito de forma simples: rodar `SELECT prova_excluir(:'t')` como o outro usuário e conferir o ERROR "Só o autor pode excluir".)

- [ ] **Step 5: Conferir REVOKE (#9)**

```bash
psql "$(cat /tmp/dburl.txt)" -c "SELECT has_function_privilege('anon','public.prova_comentar(uuid,text,uuid)','EXECUTE') AS anon, has_function_privilege('authenticated','public.prova_comentar(uuid,text,uuid)','EXECUTE') AS auth;"
```
Expected: `anon = f`, `auth = t`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260718160000_prova_comentarios.sql
git commit -m "feat(desenvolvimento): tabela modelo_prova_comentarios + RPCs (Ajustes na Prova como comentários)"
```

---

### Task 2: Componente `ModeloAjustesProvaSection`

**Files:**
- Create: `src/components/desenvolvimento/modelo-detail/ModeloAjustesProvaSection.tsx`

**Interfaces:**
- Consumes: RPCs `prova_comentar`/`prova_resolver`/`prova_excluir` (Task 1); tabela `modelo_prova_comentarios` (SELECT via RLS).
- Produces: `export function ModeloAjustesProvaSection({ modeloId }: { modeloId: string })` — usada pelo `ModeloDetailPanel` (Task 3).

- [ ] **Step 1: Criar o componente**

Criar `src/components/desenvolvimento/modelo-detail/ModeloAjustesProvaSection.tsx`:

```tsx
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useStoreTimezone } from "@/hooks/useStoreTimezone";
import { mensagemErro } from "@/lib/erro-mensagem";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { CornerDownRight, Check, RotateCcw, Trash2, Send } from "lucide-react";

type Comentario = {
  id: string;
  parent_id: string | null;
  user_id: string | null;
  texto: string;
  resolvido: boolean;
  resolvido_at: string | null;
  created_at: string;
  autor: { nome: string } | null;
};

export function ModeloAjustesProvaSection({ modeloId }: { modeloId: string }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const tz = useStoreTimezone();
  const [texto, setTexto] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyTexto, setReplyTexto] = useState("");

  const { data: comentarios = [], isLoading } = useQuery({
    queryKey: ["prova-comentarios", modeloId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modelo_prova_comentarios")
        .select("id,parent_id,user_id,texto,resolvido,resolvido_at,created_at,autor:users!user_id(nome)")
        .eq("modelo_id", modeloId);
      if (error) throw error;
      return (data ?? []) as unknown as Comentario[];
    },
  });

  const fmt = (iso: string) =>
    new Intl.DateTimeFormat("pt-BR", {
      timeZone: tz, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
    }).format(new Date(iso));

  // Fios (topo) + respostas por fio.
  const { abertos, resolvidos } = useMemo(() => {
    const tops = comentarios.filter((c) => c.parent_id === null);
    const byParent = new Map<string, Comentario[]>();
    for (const c of comentarios) {
      if (c.parent_id) (byParent.get(c.parent_id) ?? byParent.set(c.parent_id, []).get(c.parent_id)!).push(c);
    }
    const withReplies = (t: Comentario) => ({
      top: t,
      replies: (byParent.get(t.id) ?? []).sort((a, b) => a.created_at.localeCompare(b.created_at)),
    });
    return {
      abertos: tops.filter((t) => !t.resolvido).sort((a, b) => b.created_at.localeCompare(a.created_at)).map(withReplies),
      resolvidos: tops.filter((t) => t.resolvido).sort((a, b) => (b.resolvido_at ?? "").localeCompare(a.resolvido_at ?? "")).map(withReplies),
    };
  }, [comentarios]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["prova-comentarios", modeloId] });

  const comentarMut = useMutation({
    mutationFn: async ({ t, parent }: { t: string; parent: string | null }) => {
      const { error } = await supabase.rpc("prova_comentar" as never, { _modelo_id: modeloId, _texto: t, _parent_id: parent } as never);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); setTexto(""); setReplyTexto(""); setReplyTo(null); },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao comentar.")),
  });
  const resolverMut = useMutation({
    mutationFn: async ({ id, r }: { id: string; r: boolean }) => {
      const { error } = await supabase.rpc("prova_resolver" as never, { _id: id, _resolvido: r } as never);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao resolver.")),
  });
  const excluirMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("prova_excluir" as never, { _id: id } as never);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao excluir.")),
  });

  const Coment = ({ c, isReply, resolved }: { c: Comentario; isReply?: boolean; resolved?: boolean }) => (
    <div className={(isReply ? "ml-6 border-l pl-3 " : "") + (resolved ? "opacity-60 " : "") + "py-1.5"}>
      <div className="flex items-baseline gap-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{c.user_id ? c.autor?.nome ?? "—" : "Importado"}</span>
        <span>{fmt(c.created_at)}</span>
      </div>
      <p className="whitespace-pre-wrap text-sm">{c.texto}</p>
      <div className="mt-1 flex flex-wrap items-center gap-1">
        {!isReply && !resolved && (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => { setReplyTo(c.id); setReplyTexto(""); }}>
            <CornerDownRight className="mr-1 h-3.5 w-3.5" /> Responder
          </Button>
        )}
        {!isReply && (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => resolverMut.mutate({ id: c.id, r: !c.resolvido })} disabled={resolverMut.isPending}>
            {c.resolvido ? <><RotateCcw className="mr-1 h-3.5 w-3.5" /> Reabrir</> : <><Check className="mr-1 h-3.5 w-3.5" /> Resolver</>}
          </Button>
        )}
        {c.user_id && user?.id === c.user_id && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-destructive hover:text-destructive">
                <Trash2 className="mr-1 h-3.5 w-3.5" /> Excluir
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Excluir comentário?</AlertDialogTitle>
                <AlertDialogDescription>
                  {isReply ? "A resposta será removida." : "O fio e todas as respostas serão removidos."} Não pode ser desfeito.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => excluirMut.mutate(c.id)}>
                  Excluir
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
      {!isReply && replyTo === c.id && !resolved && (
        <div className="ml-6 mt-1.5 flex gap-2">
          <Textarea rows={2} value={replyTexto} onChange={(e) => setReplyTexto(e.target.value)} placeholder="Escreva a resposta…" className="text-sm" />
          <div className="flex flex-col gap-1">
            <Button size="sm" onClick={() => comentarMut.mutate({ t: replyTexto, parent: c.id })} disabled={!replyTexto.trim() || comentarMut.isPending}>Enviar</Button>
            <Button size="sm" variant="ghost" onClick={() => setReplyTo(null)}>Cancelar</Button>
          </div>
        </div>
      )}
    </div>
  );

  const Fio = ({ f, resolved }: { f: { top: Comentario; replies: Comentario[] }; resolved?: boolean }) => (
    <div className="rounded-md border p-2">
      <Coment c={f.top} resolved={resolved} />
      {f.replies.map((r) => <Coment key={r.id} c={r} isReply resolved={resolved} />)}
    </div>
  );

  return (
    <div className="space-y-3">
      {/* Caixa de envio */}
      <div className="flex gap-2">
        <Textarea rows={2} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Escreva um ajuste…" className="text-sm" />
        <Button onClick={() => comentarMut.mutate({ t: texto, parent: null })} disabled={!texto.trim() || comentarMut.isPending} className="self-start">
          <Send className="mr-1 h-4 w-4" /> Enviar
        </Button>
      </div>

      <Tabs defaultValue="abertos">
        <TabsList>
          <TabsTrigger value="abertos">Abertos ({abertos.length})</TabsTrigger>
          <TabsTrigger value="resolvidos">Resolvidos ({resolvidos.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="abertos" className="space-y-2 pt-2">
          {abertos.map((f) => <Fio key={f.top.id} f={f} />)}
          {!isLoading && abertos.length === 0 && (
            <p className="rounded-md border p-4 text-center text-sm text-muted-foreground">Nenhum ajuste ainda. Envie o primeiro comentário.</p>
          )}
        </TabsContent>
        <TabsContent value="resolvidos" className="space-y-2 pt-2">
          {resolvidos.map((f) => <Fio key={f.top.id} f={f} resolved />)}
          {!isLoading && resolvidos.length === 0 && (
            <p className="rounded-md border p-4 text-center text-sm text-muted-foreground">Nenhum ajuste resolvido.</p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

- [ ] **Step 2: tsc**

Run: `npx tsc --noEmit 2>&1 | grep -E "ModeloAjustesProvaSection" | head; npx tsc --noEmit 2>&1 | grep -cE "error TS"`
Expected: `0` erros. (Se `useStoreTimezone` tiver assinatura diferente — ex.: retorna objeto —, ajustar a chamada `tz` conforme o hook real; conferir `src/hooks/useStoreTimezone`.)

- [ ] **Step 3: build**

Run: `npm run build 2>&1 | tail -1`
Expected: `✓ built`.

- [ ] **Step 4: Commit**

```bash
git add src/components/desenvolvimento/modelo-detail/ModeloAjustesProvaSection.tsx
git commit -m "feat(desenvolvimento): seção Ajustes na Prova (comentários, abas Abertos/Resolvidos)"
```

---

### Task 3: Plugar no `ModeloDetailPanel` + remover o textarea antigo

**Files:**
- Modify: `src/components/desenvolvimento/modelo-detail/ModeloInfoSection.tsx:230-231` (remover o `<Field label="Ajustes na Prova">`)
- Modify: `src/components/desenvolvimento/ModeloDetailPanel.tsx` (novo AccordionItem, renumerar, parar de salvar `ajustes_prova`, importar a seção)

**Interfaces:**
- Consumes: `ModeloAjustesProvaSection({ modeloId })` (Task 2).

- [ ] **Step 1: Remover o campo antigo do ModeloInfoSection**

Em `src/components/desenvolvimento/modelo-detail/ModeloInfoSection.tsx`, apagar o bloco:

```tsx
      <Field label="Ajustes na Prova" full>
        <Textarea rows={3} value={draft.ajustes_prova} onChange={(e) => setDraft({ ...draft, ajustes_prova: e.target.value })} />
      </Field>
```
(Se `Textarea` ficar sem uso no arquivo, remover o import; conferir com `grep -n Textarea src/components/desenvolvimento/modelo-detail/ModeloInfoSection.tsx`.)

- [ ] **Step 2: Parar de salvar `ajustes_prova` no painel**

Em `src/components/desenvolvimento/ModeloDetailPanel.tsx`, remover a linha do payload de save (linha ~544):

```tsx
        ajustes_prova: draft.ajustes_prova || null,
```
Manter a linha ~334 (`ajustes_prova: modelo.ajustes_prova ?? ""`) é inócuo, mas pode remover também se o tipo `draft` permitir. (A coluna `modelos.ajustes_prova` fica como legado — não dropar aqui.)

- [ ] **Step 3: Importar a seção nova**

Em `src/components/desenvolvimento/ModeloDetailPanel.tsx`, junto aos outros imports de seção (após a linha `import { ModeloInfoSection } …`):

```tsx
import { ModeloAjustesProvaSection } from "./modelo-detail/ModeloAjustesProvaSection";
```

- [ ] **Step 4: Inserir o AccordionItem "2. Ajustes na Prova" e renumerar**

Em `src/components/desenvolvimento/ModeloDetailPanel.tsx`, logo APÓS o fechamento do `AccordionItem value="s1"` (Informações Básicas) e ANTES do `AccordionItem value="s2"`, inserir:

```tsx
          <AccordionItem value="prova">
            <AccordionTrigger>2. Ajustes na Prova</AccordionTrigger>
            <AccordionContent>
              <ModeloAjustesProvaSection modeloId={modeloId} />
            </AccordionContent>
          </AccordionItem>
```
Depois, renumerar os triggers seguintes (só o texto do `<AccordionTrigger>`):
- `2. Tecidos / Forros / Entretelas` → `3. Tecidos / Forros / Entretelas`
- `3. Aviamentos` → `4. Aviamentos`
- `4. Grade` → `5. Grade`
- `5. Custos` → `6. Custos`
- `6. Anexos` → `7. Anexos`

- [ ] **Step 5: tsc + build**

Run: `npx tsc --noEmit 2>&1 | grep -cE "error TS"; npm run build 2>&1 | tail -1`
Expected: `0` + `✓ built`.

- [ ] **Step 6: Screenshot de verificação (reaproveitando o dev do dono)**

Detectar a porta do `npm run dev` já rodando (`lsof -iTCP -sTCP:LISTEN -n -P | grep -oE "517[0-9]"`), logar (teste@teste.com / teste2), abrir `/criacao/desenvolvimento`, clicar num card, abrir a seção "2. Ajustes na Prova", enviar um comentário, responder, resolver → conferir que foi pra aba Resolvidos. NÃO rodar `pkill -f "vite"`.
Expected: seção renderiza com as abas; enviar/responder/resolver funcionam; o textarea antigo sumiu de "1. Informações Básicas".

- [ ] **Step 7: Commit + push**

```bash
git add src/components/desenvolvimento/ModeloDetailPanel.tsx src/components/desenvolvimento/modelo-detail/ModeloInfoSection.tsx
git commit -m "feat(desenvolvimento): seção 2. Ajustes na Prova no accordion (renumera 3-7; remove textarea antigo)"
git push origin main
```

---

## Notas de execução

- **`useStoreTimezone`**: conferir a assinatura real (retorna string do tz? objeto?). O componente assume `const tz = useStoreTimezone()` = string p/ `Intl.DateTimeFormat({ timeZone: tz })`. Ajustar se o hook devolver outra forma.
- **`useAuth().user.id`**: usado p/ mostrar "Excluir" só ao autor. Conferir que `user.id` = o `auth.uid()` (sub do JWT). Se o id do `users` for diferente do auth uid, usar o campo certo (no projeto, `users.id = auth.users.id`, então bate).
- **Embed `autor:users!user_id(nome)`**: há DOIS FKs p/ `users` (user_id, resolvido_por) — o hint `!user_id` desambigua. Se o PostgREST reclamar, usar o nome do constraint (`users!modelo_prova_comentarios_user_id_fkey`).
- **types.ts**: `modelo_prova_comentarios` e as RPCs não estão no `types.ts` gerado → os `as never`/`as unknown as` na query/RPCs contornam (backlog de regenerar).
- Depois de mergear, atualizar CLAUDE.md (invariante do fio de prova) + memória (docs-keeper).
