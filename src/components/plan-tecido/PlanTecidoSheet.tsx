import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { supabase } from "@/integrations/supabase/client";
import { labelVarianteRow } from "@/lib/variante";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { NumberInput } from "@/components/shared/NumberInput";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { MobileActionBar } from "@/components/shared/MobileActionBar";
import { Breadcrumb } from "@/components/shared/Breadcrumb";
import { UnsavedIndicator } from "@/components/shared/UnsavedIndicator";
import { ChevronRight, ArrowLeft } from "lucide-react";
import {
  semearComModelos, mergeArvore, type SeedInput, type ModeloReal, type ModeloRealMaterial,
} from "@/lib/plan-tecido/engine";
import type { PtArvore, PtMaterial, PtVariante } from "@/lib/plan-tecido/types";
import { necessidadePorTecido } from "@/lib/plan-tecido/calc";
import { ModelCard } from "@/components/plan-tecido/ModelCard";
import { ResumoPanel } from "@/components/plan-tecido/ResumoPanel";

type Nome = { id: string; nome: string };

// Chave estável por slot (prefere o id do banco, senão usa índices)
function chaveSlot(slotId: string | undefined, si: number, li: number, sli: number): string {
  return slotId ?? `${si}-${li}-${sli}`;
}

type ArtigoSimples = {
  id: string;
  nome: string;
  unidade_medida: string | null;
  rendimento: number | null;
  preco_por_metro: number | null;
};
type VarSimples = { id: string; nome_variante: string | null; cor: { nome: string | null } | null; apelido: { nome: string | null } | null };

function FormAplicarTecido({
  nSelecionados,
  onConfirmar,
  onCancelar,
}: {
  nSelecionados: number;
  onConfirmar: (material: PtMaterial) => void;
  onCancelar: () => void;
}) {
  const [artigoId, setArtigoId] = useState<string>("");
  const [consumo, setConsumo] = useState<number>(0);
  const [varianteIds, setVarianteIds] = useState<string[]>([]);

  const { data: artigos = [] } = useQuery({
    queryKey: ["form-tecido-artigos"],
    queryFn: async () =>
      ((await supabase.from("artigos").select("id, nome, unidade_medida, rendimento, preco_por_metro").order("nome")).data ?? []) as ArtigoSimples[],
  });

  const { data: variantes = [] } = useQuery({
    queryKey: ["form-tecido-variantes", artigoId],
    enabled: !!artigoId,
    queryFn: async () =>
      ((await supabase
        .from("variantes_tecido")
        .select("id, nome_variante, cor:cor_id(nome), apelido:cor_apelido_id(nome)")
        .eq("artigo_id", artigoId)
        .order("id")).data ?? []) as unknown as VarSimples[],
  });

  const artigo = artigos.find((a) => a.id === artigoId) ?? null;

  const toggle = (vid: string) =>
    setVarianteIds((prev) =>
      prev.includes(vid) ? prev.filter((x) => x !== vid) : [...prev, vid],
    );

  const confirmar = () => {
    if (!artigoId) return;
    const variatesPt: PtVariante[] = varianteIds.map((vid, i) => ({
      variante_tecido_id: vid,
      ordem: i + 1,
      multiplicador: 1,
      grades: {},
      grade_total: 0,
    }));
    const material: PtMaterial = {
      artigo_id: artigoId,
      artigo_nome: artigo?.nome ?? null,
      unidade_medida: artigo?.unidade_medida ?? null,
      rendimento: artigo?.rendimento ?? null,
      preco_por_metro: artigo?.preco_por_metro ?? null,
      tipo: "tecido",
      numero: 1,
      consumo,
      loss_percent: 0,
      ordem: 0,
      variantes: variatesPt,
    };
    onConfirmar(material);
  };

  return (
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Aplicar tecido a {nSelecionados} selecionado(s)</AlertDialogTitle>
        <AlertDialogDescription>
          Define o Tecido 1 nos slots selecionados (estado local — salve depois para gravar).
        </AlertDialogDescription>
      </AlertDialogHeader>
      <div className="space-y-3 py-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium">Artigo</label>
          <select
            className="rounded border bg-background px-2 py-1.5 text-sm"
            value={artigoId}
            onChange={(e) => { setArtigoId(e.target.value); setVarianteIds([]); }}
          >
            <option value="">Escolher artigo…</option>
            {artigos.map((a) => (
              <option key={a.id} value={a.id}>
                {a.nome}{a.unidade_medida === "kg" ? " [kg]" : ""}
              </option>
            ))}
          </select>
        </div>
        {artigoId && (
          <>
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium">Consumo</label>
              <NumberInput
                className="h-8 w-20 text-right"
                value={consumo}
                onChange={(e) => setConsumo(Number(e.target.value) || 0)}
              />
              <span className="text-xs text-muted-foreground">m</span>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium">Variantes</label>
              <div className="max-h-40 overflow-y-auto rounded border p-1 space-y-1">
                {variantes.length === 0 && (
                  <div className="text-xs text-muted-foreground p-1">Nenhuma variante cadastrada.</div>
                )}
                {variantes.map((v) => (
                  <label key={v.id} className="flex cursor-pointer items-center gap-2 py-0.5 text-xs">
                    <Checkbox
                      checked={varianteIds.includes(v.id)}
                      onCheckedChange={() => toggle(v.id)}
                      className="h-4 w-4"
                    />
                    <span>{labelVarianteRow(v as any)}</span>
                  </label>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
      <AlertDialogFooter>
        <AlertDialogCancel onClick={onCancelar}>Cancelar</AlertDialogCancel>
        <AlertDialogAction disabled={!artigoId} onClick={confirmar}>
          Aplicar a {nSelecionados}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  );
}

export function PlanTecidoSheet({ colecaoId, onClose }: { colecaoId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [arvore, setArvore] = useState<PtArvore | null>(null);
  const [dirty, setDirty] = useState(false);
  const [confirmSair, setConfirmSair] = useState(false);
  const [viewMode, setViewMode] = useState<"linha" | "tecido">("linha");
  const [selecao, setSelecao] = useState<Set<string>>(new Set());
  const [mostrarFormTecido, setMostrarFormTecido] = useState(false);

  const { data: colecao } = useQuery({
    queryKey: ["plan-tecido-colecao", colecaoId],
    queryFn: async () =>
      (await supabase.from("colecoes").select("id, nome, tipo").eq("id", colecaoId).maybeSingle()).data as any,
  });

  const { data: seed } = useQuery({
    queryKey: ["plan-tecido-seed", colecaoId],
    enabled: !!colecao,
    queryFn: async (): Promise<SeedInput> => {
      const tipo = (colecao.tipo === "poder_venda" ? "poder_venda" : "orcamento") as SeedInput["tipo"];
      if (tipo === "poder_venda") {
        const rows = ((await supabase.from("colecao_pv_itens" as any).select("subcolecao_id, linha_id, qtd_semanas").eq("colecao_id", colecaoId)).data ?? []) as any[];
        const buckets = rows.map((r) => ({
          subcolecao_id: r.subcolecao_id,
          linha_id: r.linha_id,
          categoria_id: null,
          qtd: Object.values((r.qtd_semanas ?? {}) as Record<string, number>).reduce((s, n) => s + (Number(n) || 0), 0),
        }));
        return { colecao_id: colecaoId, tipo, buckets };
      }
      const rows = ((await supabase.from("colecao_semana_categorias" as any).select("subcolecao_id, categoria_id, qtd").eq("colecao_id", colecaoId)).data ?? []) as any[];
      const buckets = rows.map((r) => ({ subcolecao_id: r.subcolecao_id, linha_id: null, categoria_id: r.categoria_id, qtd: Number(r.qtd) || 0 }));
      return { colecao_id: colecaoId, tipo, buckets };
    },
  });

  const { data: salvo } = useQuery({
    queryKey: ["plan-tecido-arvore", colecaoId],
    queryFn: async () =>
      ((await supabase.rpc("plan_tecido_arvore" as any, { _colecao_id: colecaoId })).data ?? null) as PtArvore | null,
  });

  const { data: subNomes = [] } = useQuery({
    queryKey: ["plan-tecido-subnomes", colecaoId],
    queryFn: async () =>
      ((await supabase.from("colecao_subcolecoes" as any).select("id, nome").eq("colecao_id", colecaoId)).data ?? []) as unknown as Nome[],
  });
  const { data: linhaNomes = [] } = useQuery({
    queryKey: ["plan-tecido-linha-nomes"],
    queryFn: async () => ((await supabase.from("linhas").select("id, nome")).data ?? []) as Nome[],
  });
  const { data: catNomes = [] } = useQuery({
    queryKey: ["plan-tecido-cat-nomes"],
    queryFn: async () =>
      ((await supabase.from("categorias_produto").select("id, nome")).data ?? []) as Nome[],
  });
  const nameOf = (arr: Nome[], id: string | null | undefined) =>
    id ? arr.find((x) => x.id === id)?.nome ?? null : null;

  const { data: modelosDb } = useQuery({
    queryKey: ["plan-tecido-modelos", colecaoId],
    queryFn: async () =>
      ((await supabase
        .from("modelos")
        .select(
          "id, ref, nome, subcolecao, linha_id, categoria_principal_id, proporcoes, fotos_modelo, croqui_url, desenho_tecnico_url, fotos_referencia, modelo_tecidos(id, tipo, numero, artigo_id, consumo, loss_percent, artigo:artigo_id(nome, unidade_medida, rendimento, preco_por_metro), modelo_tecido_variantes(variante_tecido_id, ordem, multiplicador, variante:variante_tecido_id(cor:cor_id(nome)))), modelo_grades(variante_numero, grades, grade_total)",
        )
        .eq("colecao_id", colecaoId)).data ?? []) as any[],
  });

  const modelosReais = useMemo<ModeloReal[]>(() => {
    if (!modelosDb) return [];
    const subIdPorNome = new Map<string, string>((subNomes as Nome[]).map((s) => [s.nome, s.id]));
    return modelosDb.map((m: any): ModeloReal => {
      const grade: ModeloReal["grade"] = {};
      for (const g of m.modelo_grades ?? []) {
        grade[Number(g.variante_numero)] = { grades: (g.grades ?? {}) as Record<string, number>, grade_total: Number(g.grade_total) || 0 };
      }
      const materiais: ModeloRealMaterial[] = (m.modelo_tecidos ?? [])
        .filter((t: any) => t.tipo === "tecido" || t.tipo === "forro")
        .map((t: any): ModeloRealMaterial => ({
          tipo: t.tipo as "tecido" | "forro",
          numero: Number(t.numero) || 1,
          artigo_id: t.artigo_id ?? null,
          artigo_nome: (t.artigo?.nome ?? null) as string | null,
          artigo_unidade_medida: (t.artigo?.unidade_medida ?? null) as string | null,
          artigo_rendimento: t.artigo?.rendimento != null ? Number(t.artigo.rendimento) : null,
          preco_por_metro: t.artigo?.preco_por_metro != null ? Number(t.artigo.preco_por_metro) : null,
          consumo: Number(t.consumo) || 0,
          loss_percent: Number(t.loss_percent) || 0,
          variantes: (t.modelo_tecido_variantes ?? []).map((v: any) => ({
            variante_tecido_id: v.variante_tecido_id,
            ordem: Number(v.ordem) || 0,
            multiplicador: Number(v.multiplicador) || 1,
            cor_nome: (v.variante?.cor?.nome ?? null) as string | null,
          })),
        }));
      return {
        id: m.id,
        ref: m.ref ?? null,
        nome: m.nome ?? null,
        // hierarquia de imagem: foto de modelo → desenho técnico → croqui → vazio
        thumb_path:
          (Array.isArray(m.fotos_modelo) ? m.fotos_modelo[0] : null) ||
          m.desenho_tecnico_url ||
          m.croqui_url ||
          null,
        subcolecao: m.subcolecao ?? null,
        subcolecao_id: m.subcolecao ? (subIdPorNome.get(m.subcolecao) ?? null) : null,
        linha_id: m.linha_id ?? null,
        categoria_id: m.categoria_principal_id ?? null,
        proporcoes: (m.proporcoes ?? null) as Record<string, number> | null,
        materiais,
        grade,
      };
    });
  }, [modelosDb, subNomes]);

  useEffect(() => {
    if (seed && salvo !== undefined && modelosDb !== undefined && arvore === null) {
      setArvore(mergeArvore(semearComModelos({ ...seed, modelos: modelosReais }), salvo));
    }
  }, [seed, salvo, modelosDb, modelosReais, arvore]);

  const salvarMut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("salvar_plan_tecido" as any, { _colecao_id: colecaoId, _arvore: arvore });
      if (error) throw error;
    },
    onSuccess: () => {
      setDirty(false);
      toast.success("Planejamento de tecido salvo.");
      qc.invalidateQueries({ queryKey: ["plan-tecido-arvore", colecaoId] });
    },
    onError: (e) => toast.error(mensagemErro(e, "Não foi possível salvar.")),
  });

  const patch = (next: PtArvore) => { setArvore(next); setDirty(true); };
  const fechar = () => { if (dirty) setConfirmSair(true); else onClose(); };

  // Aplica um material (Tecido 1) em todos os slots selecionados (estado local)
  function aplicarTecidoEmMassa(material: PtMaterial) {
    if (!arvore) return;
    const n = selecao.size;
    const next = structuredClone(arvore) as PtArvore;
    for (let si = 0; si < next.subcolecoes.length; si++) {
      for (let li = 0; li < next.subcolecoes[si].linhas.length; li++) {
        for (let sli = 0; sli < next.subcolecoes[si].linhas[li].slots.length; sli++) {
          const slot = next.subcolecoes[si].linhas[li].slots[sli];
          const chave = chaveSlot(slot.id, si, li, sli);
          if (!selecao.has(chave)) continue;
          // Remove Tecido 1 existente e prepend o novo
          const semTec1 = slot.materiais.filter((m) => !(m.tipo === "tecido" && m.numero === 1));
          next.subcolecoes[si].linhas[li].slots[sli] = {
            ...slot,
            materiais: [material, ...semTec1],
          };
        }
      }
    }
    patch(next);
    setSelecao(new Set());
    setMostrarFormTecido(false);
    toast.success(`Tecido aplicado a ${n} slot(s).`);
  }

  return (
    <Sheet open onOpenChange={(o) => { if (!o) fechar(); }}>
      <SheetContent side="right" className="w-full sm:max-w-[70vw] flex flex-col p-0 max-sm:[&>button]:hidden">
        <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background p-3">
          <Breadcrumb items={[{ label: "Estilo & Engenharia" }, { label: "Plan. Tecido" }, { label: colecao?.nome ?? "…" }]} />
          <UnsavedIndicator show={dirty} />
          <div className="ml-auto hidden items-center rounded-md border p-0.5 md:flex">
            <button
              className={`rounded px-2 py-1 text-xs font-medium transition-colors ${viewMode === "linha" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              onClick={() => setViewMode("linha")}
            >
              Por linha
            </button>
            <button
              className={`rounded px-2 py-1 text-xs font-medium transition-colors ${viewMode === "tecido" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              onClick={() => setViewMode("tecido")}
            >
              Por tecido
            </button>
          </div>
          <Button className="max-sm:hidden" disabled={!dirty || salvarMut.isPending} onClick={() => salvarMut.mutate()}>
            {dirty ? "Salvar" : "Salvo"}
          </Button>
        </div>

        {/* Barra de seleção múltipla */}
        {selecao.size > 0 && (
          <div className="flex items-center gap-2 border-b bg-amber-50 px-3 py-2 text-sm">
            <span className="font-medium">{selecao.size} selecionado(s)</span>
            <Button size="sm" variant="outline" className="ml-auto text-xs" onClick={() => setMostrarFormTecido(true)}>
              Aplicar tecido a {selecao.size} selecionado(s)
            </Button>
            <Button size="sm" variant="ghost" className="text-xs text-muted-foreground" onClick={() => setSelecao(new Set())}>
              Limpar
            </Button>
          </div>
        )}

        {!arvore ? (
          <div className="p-6 text-sm text-muted-foreground">Carregando…</div>
        ) : (
          <div className="flex flex-1 flex-col overflow-y-auto max-sm:pb-24">
            <div className="flex flex-1 gap-3 p-3">
              <div className="min-w-0 flex-1 space-y-2">
                {viewMode === "linha" ? (
                  arvore.subcolecoes.map((sub, si) => (
                    <Collapsible key={sub.id ?? si} defaultOpen>
                      <CollapsibleTrigger className="flex min-h-[44px] w-full items-center gap-2 rounded-md border px-3 text-sm font-medium [&[data-state=open]>svg]:rotate-90">
                        <ChevronRight className="h-4 w-4 transition-transform" />
                        {nameOf(subNomes, sub.subcolecao_id) ?? "Sem subcoleção"}
                      </CollapsibleTrigger>
                      <CollapsibleContent className="pt-2">
                        {sub.linhas.map((ln, li) => (
                          <div key={ln.id ?? li} className="mb-2">
                            <div className="mb-1 px-1 text-xs text-muted-foreground">
                              {ln.linha_id
                                ? (nameOf(linhaNomes, ln.linha_id) ?? "Linha")
                                : ln.categoria_id
                                  ? (nameOf(catNomes, ln.categoria_id) ?? "Categoria")
                                  : "Sem classificação"}
                            </div>
                            <div className="grid grid-cols-1 items-start gap-2 md:grid-cols-2">
                              {ln.slots.map((slot, sli) => {
                                const chave = chaveSlot(slot.id, si, li, sli);
                                return (
                                  <ModelCard
                                    key={slot.id ?? sli}
                                    slot={slot}
                                    onChange={(ns) => {
                                      const next = structuredClone(arvore) as PtArvore;
                                      next.subcolecoes[si].linhas[li].slots[sli] = ns;
                                      patch(next);
                                    }}
                                    selected={selecao.has(chave)}
                                    onToggleSelect={() => {
                                      setSelecao((prev) => {
                                        const next = new Set(prev);
                                        if (next.has(chave)) next.delete(chave);
                                        else next.add(chave);
                                        return next;
                                      });
                                    }}
                                  />
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </CollapsibleContent>
                    </Collapsible>
                  ))
                ) : (
                  (() => {
                    const nec = necessidadePorTecido(arvore);
                    if (nec.length === 0)
                      return (
                        <div className="rounded-lg border p-4 text-sm text-muted-foreground">
                          Nenhum tecido configurado.
                        </div>
                      );
                    const modelosPorArtigo = new Map<string, Set<string>>();
                    for (const sub of arvore.subcolecoes)
                      for (const ln of sub.linhas)
                        for (const slot of ln.slots) {
                          for (const mat of slot.materiais) {
                            if (!mat.artigo_id) continue;
                            if (!modelosPorArtigo.has(mat.artigo_id))
                              modelosPorArtigo.set(mat.artigo_id, new Set());
                            modelosPorArtigo
                              .get(mat.artigo_id)!
                              .add(slot.modelo_id ?? `${sub.subcolecao_id}-${ln.linha_id}-${ln.slots.indexOf(slot)}`);
                          }
                        }
                    return nec.map((t) => (
                      <div key={t.artigo_id} className="rounded-lg border">
                        <div className="flex items-center justify-between border-b px-3 py-2">
                          <span className="text-sm font-medium">
                            {t.artigo_nome}
                            {t.unidade_medida === "kg" ? (
                              <span className="ml-1 text-[10px] text-muted-foreground">kg</span>
                            ) : null}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {modelosPorArtigo.get(t.artigo_id)?.size ?? 0} modelo(s)
                          </span>
                        </div>
                        <div className="divide-y">
                          {t.variantes.map((v) => (
                            <div key={v.variante_tecido_id} className="flex items-center justify-between px-3 py-1.5 text-xs">
                              <span className="text-muted-foreground">{v.label || "—"}</span>
                              <b>{v.metros.toFixed(0)} m</b>
                            </div>
                          ))}
                        </div>
                        <div className="flex justify-between border-t px-3 py-1.5 text-xs font-semibold">
                          <span>Total</span>
                          <span>{t.totalMetros.toFixed(0)} m</span>
                        </div>
                      </div>
                    ));
                  })()
                )}
              </div>
              <div className="hidden w-56 shrink-0 md:block">
                <ResumoPanel arvore={arvore} />
              </div>
            </div>

            <MobileActionBar>
              <Button variant="ghost" size="sm" onClick={fechar}>
                <ArrowLeft className="mr-1 h-4 w-4" />
                Voltar
              </Button>
              <Button
                className="ml-auto"
                disabled={!dirty || salvarMut.isPending}
                onClick={() => salvarMut.mutate()}
              >
                {dirty ? "Salvar" : "Salvo"}
              </Button>
            </MobileActionBar>
          </div>
        )}

        <AlertDialog open={confirmSair} onOpenChange={setConfirmSair}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Descartar alterações?</AlertDialogTitle>
              <AlertDialogDescription>
                Há alterações não salvas no planejamento de tecido.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Continuar editando</AlertDialogCancel>
              <AlertDialogAction onClick={() => { setConfirmSair(false); onClose(); }}>
                Descartar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Mini-form: aplicar tecido em massa */}
        <AlertDialog open={mostrarFormTecido} onOpenChange={setMostrarFormTecido}>
          <FormAplicarTecido
            nSelecionados={selecao.size}
            onConfirmar={aplicarTecidoEmMassa}
            onCancelar={() => setMostrarFormTecido(false)}
          />
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
}
