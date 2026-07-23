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
import {
  Dialog, DialogContent, DialogHeader, DialogFooter,
  DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { DateField } from "@/components/shared/DateField";
import { VarianteSwatch } from "@/components/shared/VarianteSwatch";
import { MobileActionBar } from "@/components/shared/MobileActionBar";
import { Breadcrumb } from "@/components/shared/Breadcrumb";
import { UnsavedIndicator } from "@/components/shared/UnsavedIndicator";
import { ChevronRight, ArrowLeft, ShoppingCart, Undo2 } from "lucide-react";
import {
  semearComModelos, mergeArvore, type SeedInput, type ModeloReal, type ModeloRealMaterial,
} from "@/lib/plan-tecido/engine";
import type { PtArvore, PtMaterial, PtVariante } from "@/lib/plan-tecido/types";
import { ModelCard } from "@/components/plan-tecido/ModelCard";
import { ResumoPanel } from "@/components/plan-tecido/ResumoPanel";
import { PaletaColecao } from "@/components/plan-tecido/PaletaColecao";
import { VisaoPorTecido } from "@/components/plan-tecido/VisaoPorTecido";

type Nome = { id: string; nome: string };

// ---------- Prévia do pedido ----------
type PreviaItemRpc = {
  artigo_id: string;
  artigo_nome: string;
  unidade_medida: string;
  rendimento: number | null;
  variante_tecido_id: string;
  label: string;
  necessidade_m: number;
  estoque_m: number;
  deficit_m: number;
  qtd: number;
  unidade: string;
  preco: number;
};

type PreviaFornecedorRpc = {
  empresa_id: string;
  representante_id: string | null;
  empresa_nome: string;
  representante_nome: string | null;
  itens: PreviaItemRpc[];
};

type PreviaRpc = {
  fornecedores: PreviaFornecedorRpc[];
  sem_fornecedor: { artigo_id: string; artigo_nome: string }[];
  bloqueios: { artigo_nome: string; motivo: string }[];
};

// Estado editável por fornecedor (qtd editável por item; data/prazo por fornecedor)
type ItemEditado = PreviaItemRpc & { qtd_editada: number };

type FornecedorEditado = {
  empresa_id: string;
  representante_id: string | null;
  empresa_nome: string;
  representante_nome: string | null;
  data_prevista_entrega: string; // ISO yyyy-MM-dd ou ""
  prazo_pagamento: string;       // texto, ex.: "30/60/90"
  itens: ItemEditado[];
};

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
                blankZero
                placeholder="0"
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
  const [previaOpen, setPreviaOpen] = useState(false);
  const [previaData, setPreviaData] = useState<PreviaRpc | null>(null);
  const [previaEditada, setPreviaEditada] = useState<FornecedorEditado[]>([]);
  const [previaLoading, setPreviaLoading] = useState(false);
  const [desfazerOpen, setDesfazerOpen] = useState(false);

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
          "id, ref, nome, subcolecao, linha_id, categoria_principal_id, proporcoes, fotos_modelo, croqui_url, desenho_tecnico_url, fotos_referencia, modelo_tecidos(id, tipo, numero, artigo_id, consumo, loss_percent, artigo:artigo_id(nome, unidade_medida, rendimento, preco_por_metro), modelo_tecido_variantes(variante_tecido_id, ordem, multiplicador, variante:variante_tecido_id(cor:cor_id(nome)))), modelo_aviamentos(custo_previsto), modelo_grades(variante_numero, grades, grade_total)",
        )
        .eq("colecao_id", colecaoId)).data ?? []) as any[],
  });

  // tamanhos da grade cadastrados na loja (tenant_config.tamanhos_grade, formato "34|PPP")
  const { data: tamanhos = [] } = useQuery({
    queryKey: ["plan-tecido-tamanhos"],
    queryFn: async () => {
      const raw = ((await supabase.from("tenant_config").select("tamanhos_grade").maybeSingle()).data as any)?.tamanhos_grade;
      const arr = Array.isArray(raw) && raw.length > 0
        ? raw.map((x: any) => (typeof x === "string" ? x : (x?.nome ?? x?.label ?? String(x))))
        : ["34|PPP", "36|PP", "38|P", "40|M", "42|G", "44|GG"];
      return arr as string[];
    },
  });

  // paleta de insumos da coleção → escopa (soft) os dropdowns de artigo dos cards
  const { data: paletaIds = [] } = useQuery({
    queryKey: ["plan-tecido-paleta-ids", colecaoId],
    queryFn: async () =>
      [...new Set((((await supabase.from("plan_tecido_paleta" as any).select("artigo_id").eq("colecao_id", colecaoId)).data ?? []) as unknown as { artigo_id: string }[]).map((r) => r.artigo_id))],
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
        // custo de materiais = Σ aviamentos/insumos do desenvolvimento (custo_previsto)
        materiais_custo: (m.modelo_aviamentos ?? []).reduce((s: number, a: any) => s + (Number(a.custo_previsto) || 0), 0),
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

  const fazerPedidoMut = useMutation({
    mutationFn: async (pedidos: FornecedorEditado[]) => {
      const payload = pedidos
        .map((f) => {
          const itens = f.itens.filter((it) => it.qtd_editada > 0); // omite qtd 0
          return {
            empresa_id: f.empresa_id,
            representante_id: f.representante_id,
            data_prevista_entrega: f.data_prevista_entrega || null,
            prazo_pagamento: f.prazo_pagamento || null,
            quantidade_prazos: f.prazo_pagamento
              ? f.prazo_pagamento.split(/[/\s]+/).filter(Boolean).length
              : 1,
            itens: itens.map((it) => ({
              artigo_id: it.artigo_id,
              variante_tecido_id: it.variante_tecido_id,
              quantidade_pedida: it.qtd_editada,
              preco: it.preco,
              rendimento: it.rendimento,
            })),
          };
        })
        .filter((f) => f.itens.length > 0); // fornecedor sem item não gera OC
      const { data, error } = await supabase.rpc("plan_tecido_fazer_pedido" as any, {
        _colecao_id: colecaoId,
        _pedidos: payload,
      });
      if (error) throw error;
      return data as { criadas: number; ocs: string[] };
    },
    onSuccess: (result) => {
      toast.success(`${result.criadas} OC(s) criada(s).`);
      setPreviaOpen(false);
      qc.invalidateQueries({ queryKey: ["ocs_tecido"] });
      qc.invalidateQueries({ queryKey: ["plan-tecido-status-pedidos"] });
      qc.invalidateQueries({ queryKey: ["estoque-tecidos"] });
      qc.invalidateQueries({ queryKey: ["dash-estoque"] });
    },
    onError: (e) => toast.error(mensagemErro(e, "Não foi possível gerar os pedidos.")),
  });

  const desfazerPedidoMut = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("plan_tecido_desfazer_pedido" as any, {
        _colecao_id: colecaoId,
      });
      if (error) throw error;
      return data as number;
    },
    onSuccess: (removidas) => {
      toast.success(`Pedido desfeito (${removidas} OC(s) removida(s)).`);
      setDesfazerOpen(false);
      qc.invalidateQueries({ queryKey: ["ocs_tecido"] });
      qc.invalidateQueries({ queryKey: ["plan-tecido-status-pedidos"] });
      qc.invalidateQueries({ queryKey: ["estoque-tecidos"] });
      qc.invalidateQueries({ queryKey: ["dash-estoque"] });
    },
    onError: (e) => toast.error(mensagemErro(e, "Não foi possível desfazer o pedido.")),
  });

  // nº de OCs que serão criadas = por fornecedor, ceil(nº de artigos com qtd>0 / 2)
  // (o backend divide cada fornecedor em OCs de até 2 tecidos)
  const nOcs = useMemo(() => {
    let n = 0;
    for (const f of previaEditada) {
      const arts = new Set(f.itens.filter((it) => it.qtd_editada > 0).map((it) => it.artigo_id));
      n += Math.ceil(arts.size / 2);
    }
    return n;
  }, [previaEditada]);

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

  async function handleAbrirPrevia() {
    setPreviaLoading(true);
    try {
      const { data, error } = await supabase.rpc("plan_tecido_previa_pedido" as any, {
        _colecao_id: colecaoId,
      });
      if (error) throw error;
      const rpc = data as PreviaRpc;
      setPreviaData(rpc);
      // Inicializa o estado editável: data e prazo em branco, qtd_editada = qtd da RPC
      setPreviaEditada(
        rpc.fornecedores.map((f) => ({
          empresa_id: f.empresa_id,
          representante_id: f.representante_id,
          empresa_nome: f.empresa_nome,
          representante_nome: f.representante_nome,
          data_prevista_entrega: "",
          prazo_pagamento: "",
          itens: f.itens.map((it) => ({ ...it, qtd_editada: it.qtd })),
        })),
      );
      setPreviaOpen(true);
    } catch (e) {
      toast.error(mensagemErro(e, "Não foi possível carregar a prévia do pedido."));
    } finally {
      setPreviaLoading(false);
    }
  }

  return (
    <Sheet open onOpenChange={(o) => { if (!o) fechar(); }}>
      <SheetContent side="right" className="w-full sm:max-w-[70vw] flex flex-col p-0 max-sm:[&>button]:hidden">
        <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background p-3">
          <Breadcrumb items={[{ label: "Estilo & Engenharia" }, { label: "Plan. Tecido" }, { label: colecao?.nome ?? "…" }]} />
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
          <Button
            variant="outline"
            size="sm"
            className="max-sm:hidden"
            disabled={desfazerPedidoMut.isPending}
            onClick={() => setDesfazerOpen(true)}
          >
            <Undo2 className="mr-1 h-4 w-4" />
            Desfazer pedido
          </Button>
          <Button
            variant="default"
            size="sm"
            className="max-sm:hidden"
            disabled={dirty || previaLoading}
            title={dirty ? "Salve o plano antes de pedir" : undefined}
            onClick={handleAbrirPrevia}
          >
            <ShoppingCart className="mr-1 h-4 w-4" />
            {previaLoading ? "Carregando…" : "Fazer pedido"}
          </Button>
          <Button className="max-sm:hidden" disabled={!dirty || salvarMut.isPending} onClick={() => salvarMut.mutate()}>
            {dirty ? "Salvar" : "Salvo"}
          </Button>
        </div>

        {/* indicador "alterações não salvas" flutuante (canto inferior direito, desktop) */}
        {dirty && (
          <div className="pointer-events-none fixed bottom-4 right-4 z-20 hidden md:block">
            <UnsavedIndicator show={dirty} />
          </div>
        )}

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
                {/* mobile: Insumos aqui (no desktop vai no Resumo) */}
                <div className="md:hidden"><PaletaColecao colecaoId={colecaoId} /></div>
                {viewMode === "linha" ? (
                  arvore.subcolecoes.map((sub, si) => (
                    <Collapsible key={sub.id ?? si} defaultOpen>
                      <CollapsibleTrigger className="flex min-h-[44px] w-full items-center gap-2 rounded-md border px-3 text-sm font-medium [&[data-state=open]>svg]:rotate-90">
                        <ChevronRight className="h-4 w-4 transition-transform" />
                        {nameOf(subNomes, sub.subcolecao_id) ?? "Sem subcoleção"}
                      </CollapsibleTrigger>
                      <CollapsibleContent className="pt-2">
                        {sub.linhas.map((ln, li) => (
                          <Collapsible key={ln.id ?? li} defaultOpen className="mb-2">
                            <CollapsibleTrigger className="flex min-h-[36px] w-full items-center gap-2 rounded-md bg-muted/40 px-2 text-xs font-medium text-muted-foreground [&[data-state=open]>svg]:rotate-90">
                              <ChevronRight className="h-3.5 w-3.5 transition-transform" />
                              <span className="flex-1 text-left">
                                {ln.linha_id
                                  ? (nameOf(linhaNomes, ln.linha_id) ?? "Linha")
                                  : ln.categoria_id
                                    ? (nameOf(catNomes, ln.categoria_id) ?? "Categoria")
                                    : "Sem classificação"}
                              </span>
                              <span className="text-[10px]">{ln.slots.length} modelo(s)</span>
                            </CollapsibleTrigger>
                            <CollapsibleContent className="pt-2">
                            <div className="grid grid-cols-1 items-start gap-2 md:grid-cols-2">
                              {ln.slots.map((slot, sli) => {
                                const chave = chaveSlot(slot.id, si, li, sli);
                                return (
                                  <ModelCard
                                    key={slot.id ?? sli}
                                    slot={slot}
                                    colecaoId={colecaoId}
                                    subcolecaoId={sub.subcolecao_id}
                                    paletaIds={paletaIds}
                                    tamanhos={tamanhos}
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
                            </CollapsibleContent>
                          </Collapsible>
                        ))}
                      </CollapsibleContent>
                    </Collapsible>
                  ))
                ) : (
                  <VisaoPorTecido arvore={arvore} />
                )}
              </div>
              <div className="hidden w-72 shrink-0 md:block md:sticky md:top-3 md:self-start md:max-h-[calc(100dvh-1.5rem)] md:overflow-y-auto">
                <ResumoPanel arvore={arvore} />
              </div>
            </div>

            <MobileActionBar>
              <Button variant="ghost" size="sm" onClick={fechar}>
                <ArrowLeft className="mr-1 h-4 w-4" />
                Voltar
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={desfazerPedidoMut.isPending}
                onClick={() => setDesfazerOpen(true)}
              >
                <Undo2 className="h-4 w-4" />
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={dirty || previaLoading}
                title={dirty ? "Salve antes de pedir" : undefined}
                onClick={handleAbrirPrevia}
              >
                <ShoppingCart className="h-4 w-4" />
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

        {/* AlertDialog: Desfazer pedido */}
        <AlertDialog open={desfazerOpen} onOpenChange={setDesfazerOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Desfazer pedido?</AlertDialogTitle>
              <AlertDialogDescription>
                As OCs de tecido desta coleção serão removidas (apenas as não recebidas).
                Essa ação não pode ser desfeita.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                disabled={desfazerPedidoMut.isPending}
                onClick={() => desfazerPedidoMut.mutate()}
              >
                {desfazerPedidoMut.isPending ? "Desfazendo…" : "Desfazer"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* ===== Dialog: Prévia do pedido ===== */}
        <Dialog open={previaOpen} onOpenChange={(o) => { if (!fazerPedidoMut.isPending) setPreviaOpen(o); }}>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>Prévia do pedido</DialogTitle>
              <DialogDescription>
                Revise os pedidos por fornecedor. Ajuste as quantidades antes de gerar as OCs.
              </DialogDescription>
            </DialogHeader>

            <div className="max-h-[60vh] overflow-y-auto space-y-6 py-2">
              {/* Bloco por fornecedor */}
              {previaEditada.map((f, fi) => (
                <div key={f.empresa_id} className="rounded-lg border">
                  <div className="border-b bg-muted/40 px-4 py-2">
                    <p className="font-semibold text-sm">{f.empresa_nome}</p>
                    {f.representante_nome && (
                      <p className="text-xs text-muted-foreground">{f.representante_nome}</p>
                    )}
                  </div>
                  <div className="p-3 space-y-3">
                    <div className="flex flex-wrap gap-3">
                      <div className="flex flex-col gap-1 flex-1 min-w-[160px]">
                        <label className="text-xs font-medium">Data prevista de entrega</label>
                        <DateField
                          value={f.data_prevista_entrega}
                          onChange={(e) => {
                            setPreviaEditada((prev) =>
                              prev.map((x, i) =>
                                i === fi ? { ...x, data_prevista_entrega: e.target.value } : x,
                              ),
                            );
                          }}
                        />
                      </div>
                      <div className="flex flex-col gap-1 flex-1 min-w-[120px]">
                        <label className="text-xs font-medium">Prazo de pagamento</label>
                        <input
                          className="rounded border bg-background px-2 py-1.5 text-sm h-9"
                          placeholder="ex: 30/60/90"
                          value={f.prazo_pagamento}
                          onChange={(e) =>
                            setPreviaEditada((prev) =>
                              prev.map((x, i) =>
                                i === fi ? { ...x, prazo_pagamento: e.target.value } : x,
                              ),
                            )
                          }
                        />
                      </div>
                    </div>
                    {/* Tabela de itens */}
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b text-muted-foreground">
                            <th className="py-1 text-left font-medium">Artigo</th>
                            <th className="py-1 text-left font-medium">Variante</th>
                            <th className="py-1 text-right font-medium">Necessidade</th>
                            <th className="py-1 text-right font-medium">Estoque</th>
                            <th className="py-1 text-right font-medium">Déficit</th>
                            <th className="py-1 text-right font-medium">Qtd a pedir</th>
                            <th className="py-1 text-left font-medium">Unid.</th>
                            <th className="py-1 text-right font-medium">Preço</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {f.itens.map((it, ii) => (
                            <tr key={`${it.artigo_id}-${it.variante_tecido_id}`}>
                              <td className="py-1.5 pr-2">{it.artigo_nome}</td>
                              <td className="py-1.5 pr-2">
                                <VarianteSwatch nome={it.label} label={it.label} />
                              </td>
                              <td className="py-1.5 pr-2 text-right">{it.necessidade_m.toFixed(1)}</td>
                              <td className="py-1.5 pr-2 text-right">{it.estoque_m.toFixed(1)}</td>
                              <td className={`py-1.5 pr-2 text-right ${it.deficit_m > 0 ? "text-red-600 font-medium" : "text-muted-foreground"}`}>
                                {it.deficit_m.toFixed(1)}
                              </td>
                              <td className="py-1.5 pr-2">
                                <NumberInput
                                  blankZero
                                  placeholder="0"
                                  className="h-7 w-20 text-right"
                                  value={it.qtd_editada}
                                  onChange={(e) => {
                                    const val = Number(e.target.value) || 0;
                                    setPreviaEditada((prev) =>
                                      prev.map((x, xi) =>
                                        xi === fi
                                          ? {
                                              ...x,
                                              itens: x.itens.map((item, iii) =>
                                                iii === ii ? { ...item, qtd_editada: val } : item,
                                              ),
                                            }
                                          : x,
                                      ),
                                    );
                                  }}
                                />
                              </td>
                              <td className="py-1.5 text-muted-foreground">{it.unidade}</td>
                              <td className="py-1.5 text-right">
                                {it.preco.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              ))}

              {/* Sem fornecedor */}
              {previaData && previaData.sem_fornecedor.length > 0 && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                  <p className="text-sm font-medium text-red-700">Sem fornecedor cadastrado</p>
                  <p className="mt-1 text-xs text-red-600">
                    Cadastre o fornecedor para:{" "}
                    {previaData.sem_fornecedor.map((s) => s.artigo_nome).join(", ")}.
                    Esses tecidos não gerarão OC.
                  </p>
                </div>
              )}

              {/* Bloqueios */}
              {previaData && previaData.bloqueios.length > 0 && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                  <p className="text-sm font-medium text-red-700">Bloqueios</p>
                  <ul className="mt-1 space-y-0.5 text-xs text-red-600">
                    {previaData.bloqueios.map((b) => (
                      <li key={`${b.artigo_nome}:${b.motivo}`}>{b.artigo_nome}: {b.motivo}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" disabled={fazerPedidoMut.isPending} onClick={() => setPreviaOpen(false)}>
                Cancelar
              </Button>
              <Button
                disabled={nOcs === 0 || fazerPedidoMut.isPending}
                onClick={() => fazerPedidoMut.mutate(previaEditada)}
              >
                {fazerPedidoMut.isPending
                  ? "Gerando…"
                  : `Gerar ${nOcs} OC(s)`}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </SheetContent>
    </Sheet>
  );
}
