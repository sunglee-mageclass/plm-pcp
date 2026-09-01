import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, X } from "lucide-react";
import { mensagemErro } from "@/lib/erro-mensagem";
import { supabase } from "@/integrations/supabase/client";
import { semAcento } from "@/lib/busca";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Breadcrumb } from "@/components/shared/Breadcrumb";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * Editor de MIXES de uma (coleção, subcoleção). Compartilhado por Plan. Tecido e Plan.
 * Produto. Cada ação (criar/renomear/excluir/adicionar-modelos) persiste na hora — sem
 * rascunho acumulado, então sem guarda de "não salvo".
 *
 * - Mix = colecao_mixes; associação = modelos.mix_id (pertencimento único).
 * - Contador de modelos vem de query agregada em `modelos` (cobre modelo sem slot).
 * - Autocomplete de nomes já usados no tenant + validação de duplicado no escopo.
 * - Backend: RPC salvar_colecao_mix / excluir_colecao_mix; associação = .update() direto.
 */

type Mix = { id: string; nome: string; ordem: number };
type ModeloLite = { id: string; nome: string | null; ref: string | null; mix_id: string | null; fotos_referencia: string[] | null; fotos_modelo: string[] | null };

export function EditarMixDialog({
  colecaoId, colecaoNome, subcolecao, breadcrumbBase, onClose,
}: {
  colecaoId: string;
  colecaoNome: string;
  subcolecao: string;
  breadcrumbBase: string[];      // ex.: ["Criação", "Plan. Tecido"]
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [novoNome, setNovoNome] = useState("");
  const [selMix, setSelMix] = useState<string | null>(null);   // mix expandido (mostra modelos)
  const [editId, setEditId] = useState<string | null>(null);   // mix em renomeação inline
  const [editNome, setEditNome] = useState("");
  const [delMix, setDelMix] = useState<Mix | null>(null);
  const [pickFor, setPickFor] = useState<string | null>(null); // mix p/ o qual adicionar modelos
  const [pickSel, setPickSel] = useState<Set<string>>(new Set());

  const keyMixes = ["colecao-mixes", colecaoId, subcolecao] as const;

  const { data: mixList = [] } = useQuery({
    queryKey: keyMixes,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("colecao_mixes" as any)
        .select("id, nome, ordem")
        .eq("colecao_id", colecaoId)
        .eq("subcolecao", subcolecao)
        .order("ordem");
      if (error) throw error;
      return (data ?? []) as unknown as Mix[];
    },
  });

  // Modelos da subcoleção (p/ contador + picker). Query própria em `modelos` — cobre modelo sem slot.
  const { data: modelos = [] } = useQuery({
    queryKey: ["colecao-mix-modelos", colecaoId, subcolecao],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modelos")
        .select("id, nome, ref, mix_id, fotos_referencia, fotos_modelo")
        .eq("colecao_id", colecaoId)
        .eq("subcolecao", subcolecao)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as ModeloLite[];
    },
  });

  // Nomes já usados no tenant (autocomplete).
  const { data: nomesUsados = [] } = useQuery({
    queryKey: ["colecao-mix-nomes-usados"],
    queryFn: async () => {
      const { data, error } = await supabase.from("colecao_mixes" as any).select("nome");
      if (error) throw error;
      return [...new Set(((data ?? []) as any[]).map((r) => r.nome as string))];
    },
  });

  const countByMix = useMemo(() => {
    const m: Record<string, number> = {};
    for (const md of modelos) if (md.mix_id) m[md.mix_id] = (m[md.mix_id] ?? 0) + 1;
    return m;
  }, [modelos]);

  const nomeExiste = (nome: string, exceptId?: string) =>
    mixList.some((mx) => mx.id !== exceptId && mx.nome.trim().toLowerCase() === nome.trim().toLowerCase());

  const invalidateTudo = () => {
    qc.invalidateQueries({ queryKey: keyMixes });
    qc.invalidateQueries({ queryKey: ["colecao-mix-modelos", colecaoId, subcolecao] });
    qc.invalidateQueries({ queryKey: ["colecao-mix-nomes-usados"] });
    qc.invalidateQueries({ queryKey: ["colecao-mixes-nomes"] });     // Plan. Produto (mixNomeMap)
    qc.invalidateQueries({ queryKey: ["modelos-planejamento"] });    // Plan. Produto (agrupamento)
    qc.invalidateQueries({ queryKey: ["plan-tecido-modelos", colecaoId] }); // Plan. Tecido
  };

  const criar = useMutation({
    mutationFn: async (nome: string) => {
      const { data, error } = await supabase.rpc("salvar_colecao_mix" as any, {
        _id: null, _colecao_id: colecaoId, _subcolecao: subcolecao, _nome: nome.trim(),
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (id) => { toast.success("Mix criado."); setNovoNome(""); setSelMix(id); invalidateTudo(); },
    onError: (e) => toast.error(mensagemErro(e, "Erro ao criar mix.")),
  });

  const renomear = useMutation({
    mutationFn: async ({ id, nome }: { id: string; nome: string }) => {
      const { error } = await supabase.rpc("salvar_colecao_mix" as any, {
        _id: id, _colecao_id: colecaoId, _subcolecao: subcolecao, _nome: nome.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Mix renomeado."); setEditId(null); invalidateTudo(); },
    onError: (e) => toast.error(mensagemErro(e, "Erro ao renomear.")),
  });

  const excluir = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("excluir_colecao_mix" as any, { _id: id });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Mix excluído."); setDelMix(null); invalidateTudo(); },
    onError: (e) => toast.error(mensagemErro(e, "Erro ao excluir.")),
  });

  // Associar/desassociar modelo↔mix (update direto via RLS — precedente BulkEditDialog).
  const mover = useMutation({
    mutationFn: async ({ ids, mixId }: { ids: string[]; mixId: string | null }) => {
      const { error } = await supabase.from("modelos").update({ mix_id: mixId } as any).in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => { invalidateTudo(); },
    onError: (e) => toast.error(mensagemErro(e, "Erro ao mover modelo.")),
  });

  const podeCriar = novoNome.trim().length > 0 && !nomeExiste(novoNome) && !criar.isPending;
  const dup = novoNome.trim().length > 0 && nomeExiste(novoNome);

  const sugestoes = useMemo(() => {
    const q = semAcento(novoNome.trim());
    if (!q) return [];
    return nomesUsados.filter((n) => semAcento(n).includes(q)).slice(0, 6);
  }, [novoNome, nomesUsados]);

  const modelosDoMix = (mixId: string) => modelos.filter((m) => m.mix_id === mixId);
  const modelosSemMix = modelos.filter((m) => !m.mix_id);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent fixedFooter mobileFull className="max-w-2xl">
        <DialogHeader>
          <div className="space-y-1">
            <Breadcrumb items={[...breadcrumbBase.map((label) => ({ label })), { label: `${colecaoNome} › ${subcolecao}` }]} />
            <DialogTitle>Editar Mix</DialogTitle>
          </div>
        </DialogHeader>

        <div className="min-h-0 space-y-3 overflow-y-auto py-3">
          {mixList.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              Nenhum mix nesta subcoleção. Digite um nome abaixo e clique <strong>Criar</strong>.
            </div>
          ) : (
            mixList.map((mx) => {
              const aberto = selMix === mx.id;
              const mods = modelosDoMix(mx.id);
              return (
                <div key={mx.id} className={`overflow-hidden rounded-lg border ${aberto ? "border-primary" : ""}`}>
                  <div className="flex items-center gap-2 bg-muted/50 px-3 py-2">
                    {editId === mx.id ? (
                      <Input
                        autoFocus
                        value={editNome}
                        onChange={(e) => setEditNome(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && editNome.trim() && !nomeExiste(editNome, mx.id)) { e.preventDefault(); renomear.mutate({ id: mx.id, nome: editNome }); }
                          if (e.key === "Escape") setEditId(null);
                        }}
                        onBlur={() => setEditId(null)}
                        className="h-8 max-w-[16rem]"
                      />
                    ) : (
                      <button className="flex-1 text-left font-medium" onClick={() => setSelMix(aberto ? null : mx.id)}>
                        {mx.nome}
                      </button>
                    )}
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary tabular-nums">
                      {countByMix[mx.id] ?? 0}
                    </span>
                    <Button variant="ghost" size="iconSm" aria-label="Renomear" onClick={() => { setEditId(mx.id); setEditNome(mx.nome); }}>
                      <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                    <Button variant="ghost" size="iconSm" aria-label="Excluir" onClick={() => setDelMix(mx)}>
                      <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                  </div>
                  {aberto && (
                    <div className="flex flex-wrap items-start gap-2 p-3">
                      {mods.map((m) => (
                        <div key={m.id} className="w-16">
                          <div className="relative aspect-[3/4] overflow-hidden rounded-md bg-muted">
                            <button
                              className="absolute -right-1.5 -top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm"
                              aria-label="Tirar do mix"
                              onClick={() => mover.mutate({ ids: [m.id], mixId: null })}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                          <div className="mt-1 truncate text-center text-[10px] text-muted-foreground">{m.ref ?? "s/ ref"}</div>
                        </div>
                      ))}
                      <button
                        className="flex h-[88px] w-16 flex-col items-center justify-center gap-1 rounded-md border border-dashed text-[10px] font-semibold text-muted-foreground hover:bg-muted"
                        onClick={() => { setPickFor(mx.id); setPickSel(new Set()); }}
                      >
                        <Plus className="h-4 w-4" />Adicionar<br />modelos
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        <div className="relative border-t bg-background -mx-4 sm:-mx-6 -mb-4 sm:-mb-6 px-4 sm:px-6 py-3">
          {sugestoes.length > 0 && (
            <div className="absolute inset-x-4 bottom-[calc(100%-2px)] z-10 max-h-48 overflow-auto rounded-lg border bg-background p-1 shadow-lg sm:inset-x-6">
              {sugestoes.map((n) => (
                <button key={n} className="flex w-full items-center justify-between rounded px-2.5 py-2 text-left text-sm hover:bg-muted" onClick={() => setNovoNome(n)}>
                  <span>{n}</span><span className="text-[10px] text-muted-foreground">já usado</span>
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            <Input
              value={novoNome}
              onChange={(e) => setNovoNome(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && podeCriar) { e.preventDefault(); criar.mutate(novoNome); } }}
              placeholder="Como deseja chamar esse mix?"
              className={dup ? "border-destructive" : ""}
            />
            <Button onClick={() => criar.mutate(novoNome)} disabled={!podeCriar}>
              {criar.isPending ? "Criando…" : "Criar"}
            </Button>
          </div>
          {dup && <p className="mt-1.5 text-xs text-destructive">Este mix já existe nesta subcoleção.</p>}
        </div>
      </DialogContent>

      {/* Excluir mix */}
      <AlertDialog open={!!delMix} onOpenChange={(o) => !o && setDelMix(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir mix?</AlertDialogTitle>
            <AlertDialogDescription>
              Excluir <strong>{delMix?.nome}</strong>? Os {delMix ? (countByMix[delMix.id] ?? 0) : 0} modelo(s) voltam a ficar <strong>sem mix</strong> (não são apagados).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={(e) => { e.preventDefault(); if (delMix) excluir.mutate(delMix.id); }}>
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Picker de modelos p/ adicionar ao mix */}
      <Dialog open={!!pickFor} onOpenChange={(o) => !o && setPickFor(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Adicionar modelos ao mix</DialogTitle>
          </DialogHeader>
          <div className="grid max-h-[60vh] grid-cols-[repeat(auto-fill,minmax(84px,1fr))] gap-2 overflow-auto py-2">
            {modelosSemMix.length === 0 ? (
              <p className="col-span-full py-6 text-center text-sm text-muted-foreground">Todos os modelos desta subcoleção já estão em algum mix.</p>
            ) : (
              modelosSemMix.map((m) => {
                const sel = pickSel.has(m.id);
                return (
                  <button
                    key={m.id}
                    onClick={() => setPickSel((prev) => { const n = new Set(prev); n.has(m.id) ? n.delete(m.id) : n.add(m.id); return n; })}
                    className={`relative overflow-hidden rounded-md border text-left ${sel ? "outline outline-2 outline-primary" : ""}`}
                  >
                    {sel && <span className="absolute right-1 top-1 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground">✓</span>}
                    <div className="aspect-[3/4] bg-muted" />
                    <div className="truncate px-1.5 py-1 text-[10px] text-muted-foreground">{m.ref ?? m.nome ?? "modelo"}</div>
                  </button>
                );
              })
            )}
          </div>
          <div className="flex items-center gap-2 border-t pt-3">
            <Button variant="outline" className="ml-auto" onClick={() => setPickFor(null)}>Cancelar</Button>
            <Button
              disabled={pickSel.size === 0 || mover.isPending}
              onClick={() => { if (pickFor) mover.mutate({ ids: [...pickSel], mixId: pickFor }, { onSuccess: () => setPickFor(null) }); }}
            >
              Adicionar {pickSel.size > 0 ? `(${pickSel.size})` : ""}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
