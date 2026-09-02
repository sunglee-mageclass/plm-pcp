import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, X, ArrowLeft } from "lucide-react";
import { mensagemErro } from "@/lib/erro-mensagem";
import { supabase } from "@/integrations/supabase/client";
import { semAcento } from "@/lib/busca";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Breadcrumb } from "@/components/shared/Breadcrumb";
import { ModeloThumb } from "@/components/plan-tecido/ModeloThumb";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/** Vaga vazia da árvore do Plan. Tecido (slot sem modelo). Só existe no Plan. Tecido, então
 *  entra por props: a lista + o callback que grava mix_id no slot (o dialog não muta a árvore). */
export type VagaMix = { slotId: string; ref?: string | null; nome?: string | null; mixId: string | null; catTecidoNome?: string | null; tecidoNome?: string | null };

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
type ModeloLite = {
  id: string; nome: string | null; ref: string | null; ref_auto: string | null; mix_id: string | null;
  categoria_principal_id: string | null; tecidos_planejados: string[] | null;
  fotos_modelo: string[] | null; fotos_referencia: string[] | null;
};

export function EditarMixDialog({
  colecaoId, colecaoNome, subcolecao, breadcrumbBase, onClose, vagas, onMoverVagas,
}: {
  colecaoId: string;
  colecaoNome: string;
  subcolecao: string;
  breadcrumbBase: string[];      // ex.: ["Criação", "Plan. Tecido"]
  onClose: () => void;
  vagas?: VagaMix[];             // vagas vazias da subcoleção (só Plan. Tecido)
  onMoverVagas?: (slotIds: string[], mixId: string | null) => void;  // grava slot.mix_id na árvore
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
        .select("id, nome, ref, ref_auto, mix_id, categoria_principal_id, tecidos_planejados, fotos_modelo, fotos_referencia")
        .eq("colecao_id", colecaoId)
        .eq("subcolecao", subcolecao)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as ModeloLite[];
    },
  });

  // Nomes de categoria de produto e de artigo (tecido) — p/ identificar o modelo no picker.
  const { data: catMap = {} } = useQuery({
    queryKey: ["mix-categorias-produto"],
    queryFn: async () => {
      const { data } = await supabase.from("categorias_produto").select("id, nome");
      return Object.fromEntries(((data ?? []) as any[]).map((c) => [c.id, c.nome])) as Record<string, string>;
    },
  });
  const { data: artigoMap = {} } = useQuery({
    queryKey: ["mix-artigos-nome"],
    queryFn: async () => {
      const { data } = await supabase.from("artigos").select("id, nome");
      return Object.fromEntries(((data ?? []) as any[]).map((a) => [a.id, a.nome])) as Record<string, string>;
    },
  });
  const catNome = (m: ModeloLite) => (m.categoria_principal_id ? catMap[m.categoria_principal_id] : null) ?? null;
  const tecido1Nome = (m: ModeloLite) => {
    const a = (m.tecidos_planejados ?? []).find(Boolean);
    return a ? (artigoMap[a] ?? null) : null;
  };
  const fotoDe = (m: ModeloLite) => m.fotos_modelo?.[0] ?? m.fotos_referencia?.[0] ?? null;
  const refDe = (m: ModeloLite) => m.ref ?? m.ref_auto ?? null;

  // Nomes já usados no tenant (autocomplete).
  const { data: nomesUsados = [] } = useQuery({
    queryKey: ["colecao-mix-nomes-usados"],
    queryFn: async () => {
      const { data, error } = await supabase.from("colecao_mixes" as any).select("nome");
      if (error) throw error;
      return [...new Set(((data ?? []) as any[]).map((r) => r.nome as string))];
    },
  });

  // Contador do mix = modelos + vagas reservadas.
  const countByMix = useMemo(() => {
    const m: Record<string, number> = {};
    for (const md of modelos) if (md.mix_id) m[md.mix_id] = (m[md.mix_id] ?? 0) + 1;
    for (const v of vagas ?? []) if (v.mixId) m[v.mixId] = (m[v.mixId] ?? 0) + 1;
    return m;
  }, [modelos, vagas]);

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
    onSuccess: (id) => { toast.success("Família criada."); setNovoNome(""); setSelMix(id); invalidateTudo(); },
    onError: (e) => toast.error(mensagemErro(e, "Erro ao criar família.")),
  });

  const renomear = useMutation({
    mutationFn: async ({ id, nome }: { id: string; nome: string }) => {
      const { error } = await supabase.rpc("salvar_colecao_mix" as any, {
        _id: id, _colecao_id: colecaoId, _subcolecao: subcolecao, _nome: nome.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Família renomeada."); setEditId(null); invalidateTudo(); },
    onError: (e) => toast.error(mensagemErro(e, "Erro ao renomear.")),
  });

  const excluir = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("excluir_colecao_mix" as any, { _id: id });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Família excluída."); setDelMix(null); invalidateTudo(); },
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
  const vagasDoMix = (mixId: string) => (vagas ?? []).filter((v) => v.mixId === mixId);
  const vagasSemMix = (vagas ?? []).filter((v) => !v.mixId);
  // seleção do picker: modelos (id) e vagas (slotId). Set separado p/ vagas.
  const [pickVagas, setPickVagas] = useState<Set<string>>(new Set());
  const [pickBusca, setPickBusca] = useState("");
  const totalPick = pickSel.size + pickVagas.size;

  // Filtro do picker: casa nome, REF, tecido 1 e categoria (sem acento).
  const q = semAcento(pickBusca.trim());
  const modeloMatch = (m: ModeloLite) =>
    !q || semAcento([m.nome, refDe(m), catNome(m), tecido1Nome(m)].filter(Boolean).join(" ")).includes(q);
  const vagaMatch = (v: VagaMix) =>
    !q || semAcento([v.nome, v.ref, v.catTecidoNome, v.tecidoNome, "vaga card vago"].filter(Boolean).join(" ")).includes(q);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent fixedFooter mobileFull className="max-w-2xl">
        <DialogHeader>
          <div className="space-y-1">
            <Breadcrumb items={[...breadcrumbBase.map((label) => ({ label })), { label: `${colecaoNome} › ${subcolecao}` }]} />
            <DialogTitle>Editar Família de Produtos</DialogTitle>
          </div>
        </DialogHeader>

        <div className="min-h-0 space-y-3 overflow-y-auto py-3">
          {mixList.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              Nenhuma família de produtos nesta subcoleção. Digite um nome abaixo e clique <strong>Criar</strong>.
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
                          <div className="relative">
                            <ModeloThumb path={fotoDe(m)} className="aspect-[3/4] w-16" alt={m.nome ?? ""} />
                            <button
                              className="absolute -right-1.5 -top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm"
                              aria-label="Tirar da família"
                              onClick={() => mover.mutate({ ids: [m.id], mixId: null })}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                          <div className="mt-0.5 truncate text-center text-[10px] font-medium leading-tight">{m.nome ?? "Sem nome"}</div>
                          <div className="truncate text-center text-[9px] text-muted-foreground tabular-nums">{refDe(m) ?? "s/ ref"}</div>
                        </div>
                      ))}
                      {vagasDoMix(mx.id).map((v) => (
                        <div key={v.slotId} className="w-16">
                          <div className="relative flex aspect-[3/4] w-16 items-center justify-center rounded-md border border-dashed bg-muted text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                            vaga
                            <button
                              className="absolute -right-1.5 -top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm"
                              aria-label="Tirar da família"
                              onClick={() => onMoverVagas?.([v.slotId], null)}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                          <div className="mt-0.5 truncate text-center text-[9px] text-muted-foreground">Card vago</div>
                        </div>
                      ))}
                      <button
                        className="flex h-[88px] w-16 flex-col items-center justify-center gap-1 rounded-md border border-dashed text-[10px] font-semibold text-muted-foreground hover:bg-muted"
                        onClick={() => { setPickFor(mx.id); setPickSel(new Set()); setPickVagas(new Set()); }}
                      >
                        <Plus className="h-4 w-4" />Adicionar
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
            {/* Voltar (só-ícone) no rodapé — padrão do sistema; garante saída no mobile (mobileFull esconde o X). */}
            <Button variant="outline" size="icon" aria-label="Voltar" className="shrink-0" onClick={onClose}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <Input
              value={novoNome}
              onChange={(e) => setNovoNome(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && podeCriar) { e.preventDefault(); criar.mutate(novoNome); } }}
              placeholder="Como deseja chamar essa família?"
              className={dup ? "border-destructive" : ""}
            />
            <Button onClick={() => criar.mutate(novoNome)} disabled={!podeCriar}>
              {criar.isPending ? "Criando…" : "Criar"}
            </Button>
          </div>
          {dup && <p className="mt-1.5 text-xs text-destructive">Esta família já existe nesta subcoleção.</p>}
        </div>
      </DialogContent>

      {/* Excluir família de produtos */}
      <AlertDialog open={!!delMix} onOpenChange={(o) => !o && setDelMix(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir família de produtos?</AlertDialogTitle>
            <AlertDialogDescription>
              Excluir <strong>{delMix?.nome}</strong>? Os {delMix ? (countByMix[delMix.id] ?? 0) : 0} modelo(s) voltam a ficar <strong>sem família</strong> (não são apagados).
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

      {/* Picker de modelos (e vagas) p/ adicionar à família */}
      <Dialog open={!!pickFor} onOpenChange={(o) => { if (!o) { setPickFor(null); setPickSel(new Set()); setPickVagas(new Set()); setPickBusca(""); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Adicionar à família</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={pickBusca}
            onChange={(e) => setPickBusca(e.target.value)}
            placeholder="Buscar por nome, REF, tecido ou categoria…"
          />
          {(() => {
            const modelosFiltrados = modelosSemMix.filter(modeloMatch);
            const vagasFiltradas = vagasSemMix.filter(vagaMatch);
            return (
          <div className="max-h-[55vh] space-y-1.5 overflow-auto py-2">
            {modelosSemMix.length === 0 && vagasSemMix.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Todos os cards desta subcoleção já estão em alguma família.</p>
            ) : modelosFiltrados.length === 0 && vagasFiltradas.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Nenhum card encontrado para “{pickBusca}”.</p>
            ) : (
              <>
                {modelosFiltrados.map((m) => {
                  const sel = pickSel.has(m.id);
                  const cat = catNome(m), tec = tecido1Nome(m);
                  const sub = [cat, tec].filter(Boolean).join(" · ");
                  return (
                    <button
                      key={m.id}
                      onClick={() => setPickSel((prev) => { const n = new Set(prev); n.has(m.id) ? n.delete(m.id) : n.add(m.id); return n; })}
                      className={`flex w-full items-center gap-2.5 rounded-md border px-2 py-1.5 text-left ${sel ? "border-primary bg-primary/5" : "hover:bg-muted"}`}
                    >
                      <ModeloThumb path={fotoDe(m)} className="h-12 w-9" alt={m.nome ?? ""} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{m.nome ?? "Sem nome"}</span>
                        <span className="block truncate text-[11px] text-muted-foreground tabular-nums">{refDe(m) ?? "s/ ref"}</span>
                        {sub && <span className="block truncate text-[11px] text-muted-foreground">{sub}</span>}
                      </span>
                      {sel && <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] text-primary-foreground">✓</span>}
                    </button>
                  );
                })}
                {vagasFiltradas.map((v) => {
                  const sel = pickVagas.has(v.slotId);
                  const sub = [v.catTecidoNome, v.tecidoNome].filter(Boolean).join(" · ");
                  return (
                    <button
                      key={v.slotId}
                      onClick={() => setPickVagas((prev) => { const n = new Set(prev); n.has(v.slotId) ? n.delete(v.slotId) : n.add(v.slotId); return n; })}
                      className={`flex w-full items-center gap-2.5 rounded-md border border-dashed px-2 py-1.5 text-left ${sel ? "border-primary bg-primary/5" : "hover:bg-muted"}`}
                    >
                      <span className="flex h-12 w-9 shrink-0 items-center justify-center rounded bg-muted text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">vaga</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-muted-foreground">{v.nome || "Card vago"}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">— não planejado —</span>
                        {sub && <span className="block truncate text-[11px] text-muted-foreground">{sub}</span>}
                      </span>
                      {sel && <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] text-primary-foreground">✓</span>}
                    </button>
                  );
                })}
              </>
            )}
          </div>
            );
          })()}
          <div className="flex items-center gap-2 border-t pt-3">
            <Button variant="outline" className="ml-auto" onClick={() => { setPickFor(null); setPickSel(new Set()); setPickVagas(new Set()); setPickBusca(""); }}>Cancelar</Button>
            <Button
              disabled={totalPick === 0 || mover.isPending}
              onClick={() => {
                if (!pickFor) return;
                if (pickVagas.size > 0) onMoverVagas?.([...pickVagas], pickFor);
                if (pickSel.size > 0) mover.mutate({ ids: [...pickSel], mixId: pickFor });
                setPickFor(null); setPickSel(new Set()); setPickVagas(new Set()); setPickBusca("");
              }}
            >
              Adicionar {totalPick > 0 ? `(${totalPick})` : ""}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
