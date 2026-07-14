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

type ResolverMut = {
  isPending: boolean;
  variables?: { id: string; r: boolean };
  mutate: (vars: { id: string; r: boolean }) => void;
};

type ComentProps = {
  c: Comentario;
  isReply?: boolean;
  resolved?: boolean;
  user: { id: string } | null;
  fmt: (iso: string) => string;
  replyTo: string | null;
  setReplyTo: (id: string | null) => void;
  replyTexto: string;
  setReplyTexto: (t: string) => void;
  comentarMut: { isPending: boolean; mutate: (vars: { t: string; parent: string | null }) => void };
  resolverMut: ResolverMut;
  excluirMut: { isPending: boolean; mutate: (id: string) => void };
};

function Coment({ c, isReply, resolved, user, fmt, replyTo, setReplyTo, replyTexto, setReplyTexto, comentarMut, resolverMut, excluirMut }: ComentProps) {
  return (
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
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => resolverMut.mutate({ id: c.id, r: !c.resolvido })}
            disabled={resolverMut.isPending && resolverMut.variables?.id === c.id}
          >
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
}

type FioProps = {
  f: { top: Comentario; replies: Comentario[] };
  resolved?: boolean;
  user: { id: string } | null;
  fmt: (iso: string) => string;
  replyTo: string | null;
  setReplyTo: (id: string | null) => void;
  replyTexto: string;
  setReplyTexto: (t: string) => void;
  comentarMut: { isPending: boolean; mutate: (vars: { t: string; parent: string | null }) => void };
  resolverMut: ResolverMut;
  excluirMut: { isPending: boolean; mutate: (id: string) => void };
};

function Fio({ f, resolved, user, fmt, replyTo, setReplyTo, replyTexto, setReplyTexto, comentarMut, resolverMut, excluirMut }: FioProps) {
  return (
    <div className="rounded-md border p-2">
      <Coment c={f.top} resolved={resolved} user={user} fmt={fmt} replyTo={replyTo} setReplyTo={setReplyTo} replyTexto={replyTexto} setReplyTexto={setReplyTexto} comentarMut={comentarMut} resolverMut={resolverMut} excluirMut={excluirMut} />
      {f.replies.map((r) => <Coment key={r.id} c={r} isReply resolved={resolved} user={user} fmt={fmt} replyTo={replyTo} setReplyTo={setReplyTo} replyTexto={replyTexto} setReplyTexto={setReplyTexto} comentarMut={comentarMut} resolverMut={resolverMut} excluirMut={excluirMut} />)}
    </div>
  );
}

async function fetchProvaComentarios(modeloId: string): Promise<Comentario[]> {
  const { data, error } = await supabase
    .from("modelo_prova_comentarios" as never)
    .select("id,parent_id,user_id,texto,resolvido,resolvido_at,created_at,autor:users!user_id(nome)")
    .eq("modelo_id", modeloId);
  if (error) throw error;
  return (data ?? []) as unknown as Comentario[];
}

/** Nº de fios ABERTOS (topo não resolvido) — p/ o badge no accordion. Compartilha a
 *  MESMA queryKey da seção, então atualiza junto com enviar/resolver/excluir. */
export function useProvaAbertosCount(modeloId: string): number {
  const { data = [] } = useQuery({
    queryKey: ["prova-comentarios", modeloId],
    queryFn: () => fetchProvaComentarios(modeloId),
  });
  return data.filter((c) => c.parent_id === null && !c.resolvido).length;
}

export function ModeloAjustesProvaSection({ modeloId }: { modeloId: string }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const tz = useStoreTimezone();
  const [texto, setTexto] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyTexto, setReplyTexto] = useState("");

  const { data: comentarios = [], isLoading } = useQuery({
    queryKey: ["prova-comentarios", modeloId],
    queryFn: () => fetchProvaComentarios(modeloId),
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
    onError: (e: unknown) => toast.error(mensagemErro(e, "Erro ao comentar.")),
  });
  const resolverMut = useMutation({
    mutationFn: async ({ id, r }: { id: string; r: boolean }) => {
      const { error } = await supabase.rpc("prova_resolver" as never, { _id: id, _resolvido: r } as never);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e: unknown) => toast.error(mensagemErro(e, "Erro ao resolver.")),
  });
  const excluirMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("prova_excluir" as never, { _id: id } as never);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e: unknown) => toast.error(mensagemErro(e, "Erro ao excluir.")),
  });

  const sharedProps = { user, fmt, replyTo, setReplyTo, replyTexto, setReplyTexto, comentarMut, resolverMut, excluirMut };

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
          {abertos.map((f) => <Fio key={f.top.id} f={f} {...sharedProps} />)}
          {!isLoading && abertos.length === 0 && (
            <p className="rounded-md border p-4 text-center text-sm text-muted-foreground">Nenhum ajuste ainda. Envie o primeiro comentário.</p>
          )}
        </TabsContent>
        <TabsContent value="resolvidos" className="space-y-2 pt-2">
          {resolvidos.map((f) => <Fio key={f.top.id} f={f} resolved {...sharedProps} />)}
          {!isLoading && resolvidos.length === 0 && (
            <p className="rounded-md border p-4 text-center text-sm text-muted-foreground">Nenhum ajuste resolvido.</p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
