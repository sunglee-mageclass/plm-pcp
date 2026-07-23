import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { brl } from "@/lib/format";
import { Plus, Trash2, Pencil, Save, ArrowLeft } from "lucide-react";
import { useUnsavedGuard, UnsavedChangesGuard } from "@/components/shared/UnsavedChangesGuard";

/**
 * "Padrão do mix" em MODAL (Sheet lateral). Template de defaults que a coleção por Poder
 * de Venda herda. Vários por loja. Por LINHA (dropdown do cadastro → markup automático):
 * nº de modelos (→ % derivada), toggle "à parte" (Acessórios = 100% sozinha, as demais
 * somam 100%), prof/cor, cores, faixa de preço mín/máx. SEM categoria/subcategoria.
 * Persiste em mix_padroes/mix_padrao_linhas via salvar_mix_padrao.
 */

type LinhaMix = { id: string; linhaId: string; numModelos: number; aParte: boolean; profCor: number; cores: number; min: number; max: number };
type Draft = { nome: string; linhas: LinhaMix[] };

let _seq = 0;
const nid = (p: string) => `${p}-${++_seq}`;
const num = (v: string) => (v === "" ? 0 : Number(v.replace(",", ".")) || 0);
const pct1 = (n: number) => `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
const novaLinha = (): LinhaMix => ({ id: nid("l"), linhaId: "", numModelos: 0, aParte: false, profCor: 64, cores: 3, min: 0, max: 0 });

function mapFromDb(p: any): Draft {
  const linhas = [...(p.linhas ?? [])].sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0)).map((l: any) => ({
    id: l.id, linhaId: l.linha_id ?? "", numModelos: Number(l.num_modelos) || 0, aParte: !!l.a_parte,
    profCor: Number(l.prof_cor) || 0, cores: Number(l.cores) || 0, min: Number(l.preco_min) || 0, max: Number(l.preco_max) || 0,
  }));
  return { nome: p.nome, linhas };
}

export function PadraoMixSheet({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { data: linhaOpts = [] } = useQuery({ queryKey: ["padrao-linhas"], queryFn: async () => (await supabase.from("linhas").select("id, nome, markup").order("nome")).data ?? [] });
  const { data: padroes = [] } = useQuery({
    queryKey: ["mix-padroes", "full"],
    queryFn: async () => {
      const { data, error } = await supabase.from("mix_padroes" as any)
        .select("id, nome, linhas:mix_padrao_linhas(id, linha_id, num_modelos, a_parte, prof_cor, cores, preco_min, preco_max, ordem)").order("nome");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const markupDe = (linhaId: string) => Number((linhaOpts as any[]).find((l) => l.id === linhaId)?.markup) || 0;

  const [selId, setSelId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({ nome: "", linhas: [] });
  const [draftFor, setDraftFor] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [editNome, setEditNome] = useState(false);

  const { requestClose, confirm } = useUnsavedGuard({ dirty, onClose });

  useEffect(() => { if (!selId && padroes.length) setSelId(padroes[0].id); }, [padroes, selId]);
  useEffect(() => {
    if (selId && selId !== draftFor) {
      const p = padroes.find((x) => x.id === selId);
      if (p) { setDraft(mapFromDb(p)); setDraftFor(selId); setDirty(false); }
    }
  }, [selId, padroes, draftFor]);

  const upd = (fn: (d: Draft) => Draft) => { setDraft(fn); setDirty(true); };
  const setLinhas = (fn: (ls: LinhaMix[]) => LinhaMix[]) => upd((d) => ({ ...d, linhas: fn(d.linhas) }));
  const patchLinha = (lid: string, p: Partial<LinhaMix>) => setLinhas((ls) => ls.map((l) => (l.id === lid ? { ...l, ...p } : l)));
  const addLinha = () => setLinhas((ls) => [...ls, novaLinha()]);
  const delLinha = (lid: string) => setLinhas((ls) => ls.filter((l) => l.id !== lid));

  const salvar = useMutation({
    mutationFn: async () => {
      const payload = draft.linhas.map((l) => ({
        linha_id: l.linhaId || null, num_modelos: l.numModelos, a_parte: l.aParte,
        prof_cor: l.profCor, cores: l.cores, preco_min: l.min, preco_max: l.max,
      }));
      const { data, error } = await supabase.rpc("salvar_mix_padrao" as any, { _id: selId, _nome: draft.nome.trim(), _linhas: payload });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => { toast.success("Padrão salvo."); setDirty(false); qc.invalidateQueries({ queryKey: ["mix-padroes"] }); },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao salvar o padrão.")),
  });
  const criar = useMutation({
    mutationFn: async () => { const { data, error } = await supabase.rpc("salvar_mix_padrao" as any, { _id: null, _nome: `Padrão ${padroes.length + 1}`, _linhas: [] }); if (error) throw error; return data as string; },
    onSuccess: (id) => { qc.invalidateQueries({ queryKey: ["mix-padroes"] }); setSelId(id); setDraftFor(null); },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao criar o padrão.")),
  });
  const excluir = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.rpc("excluir_mix_padrao" as any, { _id: id }); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["mix-padroes"] }); setSelId(null); setDraftFor(null); },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao excluir o padrão.")),
  });

  // % derivada do nº de modelos: linhas normais dividem 100% pelo total delas; linha
  // "à parte" (ex.: Acessórios) fica 100% sozinha (não entra no total das demais).
  const totalMix = useMemo(() => draft.linhas.filter((l) => !l.aParte).reduce((s, l) => s + (Number(l.numModelos) || 0), 0), [draft.linhas]);
  const totalApart = useMemo(() => draft.linhas.filter((l) => l.aParte).reduce((s, l) => s + (Number(l.numModelos) || 0), 0), [draft.linhas]);
  const pctDe = (l: LinhaMix) => (l.aParte ? 100 : totalMix > 0 ? ((Number(l.numModelos) || 0) / totalMix) * 100 : 0);
  const temSel = !!selId && !!padroes.find((p) => p.id === selId);

  return (
    <Sheet open onOpenChange={(o) => { if (!o) requestClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-[70vw] flex flex-col p-0 max-sm:[&>button]:hidden">
        <SheetHeader className="p-4 border-b shrink-0">
          <SheetTitle className="text-base sm:text-lg">Padrão do mix</SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <p className="text-sm text-muted-foreground">
            Defaults que uma coleção por <strong>Poder de Venda</strong> herda. Por linha: o <strong>nº de modelos</strong>
            {" "}(a <strong>%</strong> é calculada), profundidade/cor, cores e a faixa de preço mín–máx (markup vem do cadastro).
            Marque <strong>"à parte"</strong> a linha que soma 100% sozinha (ex.: Acessórios).
          </p>

          <div className="flex flex-wrap items-center gap-2">
            {padroes.map((p) => {
              const isSel = p.id === selId;
              return (
                <div key={p.id} className={`flex items-center gap-1 rounded-full border px-1 ${isSel ? "border-primary bg-primary/5" : ""}`}>
                  {isSel && editNome ? (
                    <Input autoFocus value={draft.nome} onChange={(e) => upd((d) => ({ ...d, nome: e.target.value }))}
                      onBlur={() => setEditNome(false)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") setEditNome(false); }} className="h-7 w-36" />
                  ) : (
                    <button className="px-2 py-1 text-sm font-medium" onClick={() => setSelId(p.id)}>
                      {isSel ? draft.nome : p.nome}{isSel && dirty && <span className="ml-1 text-amber-600" title="não salvo">•</span>}
                    </button>
                  )}
                  {isSel && (
                    <>
                      <Button variant="ghost" size="iconSm" className="h-8 w-8" onClick={() => setEditNome(true)}><Pencil className="h-3.5 w-3.5 text-muted-foreground" /></Button>
                      <Button variant="ghost" size="iconSm" className="h-8 w-8" onClick={() => excluir.mutate(p.id)}><Trash2 className="h-3.5 w-3.5 text-muted-foreground" /></Button>
                    </>
                  )}
                </div>
              );
            })}
            <Button variant="outline" size="sm" onClick={() => criar.mutate()} disabled={criar.isPending}><Plus className="h-4 w-4 mr-1" /> Padrão</Button>
          </div>

          {linhaOpts.length === 0 && (
            <div className="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              Nenhuma linha cadastrada — cadastre em <strong>Cadastro › Atributos › Linha</strong> pra escolher aqui.
            </div>
          )}

          {!temSel ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              Nenhum padrão ainda. Clique em <strong>+ Padrão</strong> pra criar o primeiro.
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Mix de modelos por linha</span>
                <span className="tabular-nums text-muted-foreground">
                  {totalMix} modelo{totalMix === 1 ? "" : "s"} no mix (100%){totalApart > 0 ? ` · +${totalApart} à parte` : ""}
                </span>
              </div>

              {draft.linhas.map((l) => {
                const mk = markupDe(l.linhaId);
                return (
                  <Card key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
                    <Sel value={l.linhaId} onChange={(v) => patchLinha(l.id, { linhaId: v })} placeholder="— linha —" className="min-w-[9rem]">
                      {/* Cada linha só pode aparecer 1× no padrão: esconde as já usadas por outras linhas. */}
                      {(linhaOpts as any[]).filter((o) => o.id === l.linhaId || !draft.linhas.some((x) => x.id !== l.id && x.linhaId === o.id))
                        .map((o) => <SelectItem key={o.id} value={o.id}>{o.nome}</SelectItem>)}
                    </Sel>
                    <Lbl t="nº modelos">
                      <Input className="h-8 w-16 max-sm:h-9 px-1 text-left tabular-nums" inputMode="numeric" value={l.numModelos}
                        onChange={(e) => patchLinha(l.id, { numModelos: Math.max(0, Math.round(num(e.target.value))) })} />
                    </Lbl>
                    <span className="text-sm">= <b className="tabular-nums">{pct1(pctDe(l))}</b></span>
                    <Button variant={l.aParte ? "default" : "outline"} size="sm" className="max-sm:h-9"
                      onClick={() => patchLinha(l.id, { aParte: !l.aParte })} title="Linha à parte: soma 100% sozinha (ex.: Acessórios)">
                      à parte
                    </Button>
                    <Lbl t="prof/cor"><Input className="h-8 w-14 max-sm:h-9 px-1 text-left tabular-nums" inputMode="numeric" value={l.profCor} onChange={(e) => patchLinha(l.id, { profCor: Math.max(0, Math.round(num(e.target.value))) })} /></Lbl>
                    <Lbl t="cores"><Input className="h-8 w-12 max-sm:h-9 px-1 text-left tabular-nums" inputMode="numeric" value={l.cores} onChange={(e) => patchLinha(l.id, { cores: Math.max(0, Math.round(num(e.target.value))) })} /></Lbl>
                    <Lbl t="preço mín"><Input className="h-8 w-20 max-sm:h-9 px-1 text-left tabular-nums" inputMode="decimal" value={l.min} onChange={(e) => patchLinha(l.id, { min: num(e.target.value) })} /></Lbl>
                    <Lbl t="preço máx"><Input className="h-8 w-20 max-sm:h-9 px-1 text-left tabular-nums" inputMode="decimal" value={l.max} onChange={(e) => patchLinha(l.id, { max: num(e.target.value) })} /></Lbl>
                    <span className="text-xs text-muted-foreground/70">
                      markup {mk ? `${mk.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}×` : "—"}
                      {mk ? ` · custo ${brl(l.min / mk)}–${brl(l.max / mk)}` : ""}
                    </span>
                    <Button variant="ghost" size="iconSm" className="ml-auto max-sm:h-11 max-sm:w-11" onClick={() => delLinha(l.id)}><Trash2 className="h-4 w-4 text-muted-foreground" /></Button>
                  </Card>
                );
              })}
              <Button variant="outline" onClick={addLinha}><Plus className="h-4 w-4 mr-1" /> Linha</Button>
            </div>
          )}
        </div>

        <div className="p-4 border-t shrink-0 flex justify-end gap-2">
          <Button variant="outline" onClick={requestClose} className="mr-auto shrink-0 max-sm:aspect-square max-sm:px-0" aria-label="Voltar">
            <ArrowLeft className="h-4 w-4 sm:mr-1" /><span className="max-sm:sr-only">Voltar</span>
          </Button>
          <Button onClick={() => salvar.mutate()} disabled={!temSel || !dirty || salvar.isPending} className="shrink-0 max-sm:aspect-square max-sm:px-0" aria-label="Salvar">
            <Save className="h-4 w-4 sm:mr-1" /><span className="max-sm:sr-only">{dirty ? (salvar.isPending ? "Salvando…" : "Salvar") : "Salvo"}</span>
          </Button>
        </div>
        <UnsavedChangesGuard dirty={dirty} confirm={confirm} message="Há alterações não salvas no padrão do mix." />
      </SheetContent>
    </Sheet>
  );
}

function Lbl({ t, children }: { t: string; children: React.ReactNode }) {
  return <span className="flex items-center gap-1 text-xs text-muted-foreground">{t} {children}</span>;
}

function Sel({ value, onChange, placeholder, disabled, className, children }: {
  value: string; onChange: (v: string) => void; placeholder?: string; disabled?: boolean; className?: string; children: React.ReactNode;
}) {
  return (
    <Select value={value || undefined} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className={className}><SelectValue placeholder={placeholder ?? "—"} /></SelectTrigger>
      <SelectContent>{children}</SelectContent>
    </Select>
  );
}
