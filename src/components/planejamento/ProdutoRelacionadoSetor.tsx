import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSignedUrl } from "@/hooks/useSignedUrl";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Trash2, ImageOff } from "lucide-react";

type Membro = { id: string; ref: string | null; nome: string; fotos_modelo: string[] | null };
type Resultado = Membro & { conjunto_id: string | null };

function Thumb({ path, alt }: { path: string | null; alt: string }) {
  const url = useSignedUrl(path, "modelos");
  return (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded border bg-muted/40">
      {url ? <img src={url} alt={alt} className="h-full w-full object-cover" /> : <ImageOff className="h-4 w-4 text-muted-foreground" />}
    </div>
  );
}

export function ProdutoRelacionadoSetor({ modeloId }: { modeloId: string }) {
  const qc = useQueryClient();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busca, setBusca] = useState("");
  const [mover, setMover] = useState<Resultado | null>(null);

  const { data: conjuntoId = null } = useQuery({
    queryKey: ["modelo-conjunto", modeloId],
    queryFn: async () => {
      const { data, error } = await (supabase.from("modelos") as any).select("conjunto_id").eq("id", modeloId).maybeSingle();
      if (error) throw error;
      return ((data as { conjunto_id?: string | null } | null)?.conjunto_id) ?? null;
    },
  });

  const { data: membros = [] } = useQuery({
    queryKey: ["conjunto-membros", conjuntoId, modeloId],
    enabled: !!conjuntoId,
    queryFn: async () => {
      const { data, error } = await (supabase
        .from("modelos").select("id, ref, nome, fotos_modelo") as any)
        .eq("conjunto_id", conjuntoId as string).neq("id", modeloId);
      if (error) throw error;
      return (data ?? []) as unknown as Membro[];
    },
  });

  const memberIds = new Set([modeloId, ...membros.map((m) => m.id)]);
  const { data: resultados = [] } = useQuery({
    queryKey: ["conjunto-busca", busca, modeloId],
    enabled: pickerOpen && busca.trim().length >= 1,
    queryFn: async () => {
      const q = busca.trim().replace(/[%,]/g, "");
      const { data, error } = await supabase
        .from("modelos").select("id, ref, nome, fotos_modelo, conjunto_id")
        .or(`ref.ilike.%${q}%,nome.ilike.%${q}%`).limit(20);
      if (error) throw error;
      return (data ?? []) as unknown as Resultado[];
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["modelo-conjunto", modeloId] });
    qc.invalidateQueries({ queryKey: ["conjunto-membros"] });
    qc.invalidateQueries({ queryKey: ["modelos-planejamento"] });
  };

  const adicionar = useMutation({
    mutationFn: async (addId: string) => {
      const { error } = await supabase.rpc("conjunto_adicionar" as never, { _modelo_id: modeloId, _add_id: addId } as never);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); setPickerOpen(false); setBusca(""); setMover(null); toast.success("Produto relacionado adicionado."); },
    onError: (e: unknown) => toast.error(mensagemErro(e, "Erro ao relacionar.")),
  });

  const remover = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("conjunto_remover" as never, { _modelo_id: id } as never);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast.success("Produto removido do conjunto."); },
    onError: (e: unknown) => toast.error(mensagemErro(e, "Erro ao remover.")),
  });

  const escolher = (r: Resultado) => (r.conjunto_id ? setMover(r) : adicionar.mutate(r.id));
  const visiveis = resultados.filter((r) => !memberIds.has(r.id));

  return (
    <div className="space-y-3">
      {membros.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum produto relacionado.</p>
      ) : (
        <ul className="space-y-2">
          {membros.map((m) => (
            <li key={m.id} className="flex items-center gap-3 rounded-md border p-2">
              <Thumb path={m.fotos_modelo?.[0] ?? null} alt={m.ref ?? m.nome} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-xs text-primary">{m.ref ?? "—"}</p>
                <p className="truncate text-sm">{m.nome}</p>
              </div>
              <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" aria-label="Remover" onClick={() => remover.mutate(m.id)} disabled={remover.isPending}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Button variant="outline" onClick={() => setPickerOpen(true)}>
        <Plus className="mr-1 h-4 w-4" /> Adicionar produto
      </Button>

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Relacionar produto</DialogTitle></DialogHeader>
          <Input autoFocus placeholder="Buscar por referência ou nome…" value={busca} onChange={(e) => setBusca(e.target.value)} />
          <ul className="max-h-72 space-y-1 overflow-y-auto">
            {visiveis.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => escolher(r)} className="flex w-full items-center gap-3 rounded-md p-2 text-left hover:bg-muted">
                  <Thumb path={r.fotos_modelo?.[0] ?? null} alt={r.ref ?? r.nome} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-xs text-primary">{r.ref ?? "—"}</p>
                    <p className="truncate text-sm">{r.nome}</p>
                  </div>
                  {r.conjunto_id && <span className="shrink-0 text-[10px] text-amber-600">em outro conjunto</span>}
                </button>
              </li>
            ))}
            {busca.trim().length >= 1 && visiveis.length === 0 && (
              <li className="p-2 text-sm text-muted-foreground">Nenhum produto encontrado.</li>
            )}
          </ul>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!mover} onOpenChange={(o) => !o && setMover(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mover produto?</AlertDialogTitle>
            <AlertDialogDescription>
              "{mover?.nome}" já está em outro conjunto e será movido para este. Continuar?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => mover && adicionar.mutate(mover.id)} disabled={adicionar.isPending}>Mover</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
