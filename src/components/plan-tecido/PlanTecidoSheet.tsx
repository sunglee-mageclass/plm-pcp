import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { supabase } from "@/integrations/supabase/client";
import { labelVarianteRow } from "@/lib/variante";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { NumberInput } from "@/components/shared/NumberInput";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { VarianteSwatch } from "@/components/shared/VarianteSwatch";
import { Breadcrumb } from "@/components/shared/Breadcrumb";
import { UnsavedChangesGuard, useUnsavedGuard } from "@/components/shared/UnsavedChangesGuard";
import { UnsavedIndicator } from "@/components/shared/UnsavedIndicator";
import { useAuth } from "@/hooks/useAuth";
import { ArrowLeft, ShoppingCart, Undo2, Plus, X, Tag } from "lucide-react";
import {
  semearComModelos, mergeArvore, type SeedInput, type ModeloReal, type ModeloRealMaterial,
} from "@/lib/plan-tecido/engine";
import type { PtArvore, PtMaterial, PtVariante, PtSlot } from "@/lib/plan-tecido/types";
import { ModelCard } from "@/components/plan-tecido/ModelCard";
import { ResumoPanel } from "@/components/plan-tecido/ResumoPanel";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useArtigosTecido } from "@/lib/plan-tecido/useArtigosTecido";
import { tecidosDaArvore } from "@/lib/plan-tecido/calc";
import { FazerPedidoWizard, type PreviaRpc } from "@/components/plan-tecido/FazerPedidoWizard";

type Nome = { id: string; nome: string };

// Chave estável por slot (prefere o id do banco, senão usa índices)
function chaveSlot(slotId: string | undefined, si: number, li: number, sli: number): string {
  return slotId ?? `${si}-${li}-${sli}`;
}

type VarSimples = { id: string; nome_variante: string | null; cor: { nome: string | null } | null; apelido: { nome: string | null } | null };

function FormAplicarTecido({
  nSelecionados,
  tipo,
  paleta,
  onConfirmar,
  onCancelar,
}: {
  nSelecionados: number;
  tipo: "tecido" | "forro";
  paleta: { artigo_id: string; papel: string }[];
  onConfirmar: (material: PtMaterial) => void;
  onCancelar: () => void;
}) {
  const [artigoId, setArtigoId] = useState<string>("");
  const [consumo, setConsumo] = useState<number>(0);
  const [varianteIds, setVarianteIds] = useState<string[]>([]);
  const { tecidoArtigos, forroArtigos } = useArtigosTecido();
  const rotulo = tipo === "forro" ? "forro" : "tecido";

  // filtro DURO: só os artigos do papel adicionados em "Insumos da coleção"
  const paletaIds = paleta.filter((p) => p.papel === tipo).map((p) => p.artigo_id);
  const base = tipo === "forro" ? forroArtigos : tecidoArtigos;
  const opcoes = base.filter((a) => paletaIds.includes(a.id));

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

  const artigo = opcoes.find((a) => a.id === artigoId) ?? null;

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
      tipo,
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
        <AlertDialogTitle>Aplicar {rotulo} a {nSelecionados} selecionado(s)</AlertDialogTitle>
        <AlertDialogDescription>
          Define o {tipo === "forro" ? "Forro 1" : "Tecido 1"} nos slots selecionados (estado local — salve depois para gravar).
        </AlertDialogDescription>
      </AlertDialogHeader>
      <div className="space-y-3 py-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium">{tipo === "forro" ? "Forro" : "Tecido"}</label>
          {opcoes.length === 0 ? (
            <div className="rounded border border-dashed p-2 text-xs text-muted-foreground">
              Nenhum {rotulo} em "Insumos da coleção". Adicione primeiro.
            </div>
          ) : (
          <select
            className="rounded border bg-background px-2 py-1.5 text-sm"
            value={artigoId}
            onChange={(e) => { setArtigoId(e.target.value); setVarianteIds([]); }}
          >
            <option value="">Escolher {rotulo}…</option>
            {opcoes.map((a) => (
              <option key={a.id} value={a.id}>
                {a.nome}{a.unidade_medida === "kg" ? " [kg]" : ""}
              </option>
            ))}
          </select>
          )}
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
  const { requestClose, confirm } = useUnsavedGuard({ dirty, onClose });
  const [view, setView] = useState<"subcolecoes" | "canvas">("subcolecoes");
  const [subAtiva, setSubAtiva] = useState(0);
  const [catFilter, setCatFilter] = useState<string | null>(null); // null=todos · id de categoria · "__sem__"
  const [addCatOpen, setAddCatOpen] = useState(false);
  const [aplicarCatOpen, setAplicarCatOpen] = useState(false);
  const [selecao, setSelecao] = useState<Set<string>>(new Set());
  const [formTipo, setFormTipo] = useState<"tecido" | "forro" | null>(null);
  const [previaOpen, setPreviaOpen] = useState(false);
  const [previaData, setPreviaData] = useState<PreviaRpc | null>(null);
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
      ((await supabase.from("colecao_subcolecoes" as any).select("id, nome, ordem").eq("colecao_id", colecaoId).order("ordem")).data ?? []) as unknown as (Nome & { ordem: number })[],
  });
  const subOrdem = (id: string | null | undefined) => subNomes.find((s) => s.id === id)?.ordem ?? 999;
  // categorias de TECIDO (rótulos das lanes do canvas)
  const { data: catTecidoNomes = [] } = useQuery({
    queryKey: ["plan-tecido-cat-tecido-nomes"],
    queryFn: async () =>
      ((await supabase.from("categorias_tecido").select("id, nome").order("nome")).data ?? []) as Nome[],
  });
  const nameOf = (arr: Nome[], id: string | null | undefined) =>
    id ? arr.find((x) => x.id === id)?.nome ?? null : null;

  const { data: modelosDb } = useQuery({
    queryKey: ["plan-tecido-modelos", colecaoId],
    queryFn: async () =>
      ((await supabase
        .from("modelos")
        .select(
          "id, ref, nome, subcolecao, linha_id, categoria_principal_id, proporcoes, lancado, custo_terceirizados_aprovado, fotos_modelo, croqui_url, desenho_tecnico_url, fotos_referencia, modelo_tecidos(id, tipo, numero, artigo_id, consumo, loss_percent, artigo:artigo_id(nome, unidade_medida, rendimento, preco_por_metro), modelo_tecido_variantes(variante_tecido_id, ordem, multiplicador, variante:variante_tecido_id(cor:cor_id(nome)))), modelo_aviamentos(custo_previsto), modelo_grades(variante_numero, grades, grade_total)",
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

  // OCs aplicadas (nº + tecidos que contém) — oferecidas como hint de OC por card (#5)
  const { data: ocsAplicadas = [] } = useQuery({
    queryKey: ["plan-tecido-oc-aplicada-lista", colecaoId],
    queryFn: async () =>
      (((await supabase.from("plan_tecido_oc_aplicada" as any)
        .select("oc_tecido_id, oc:oc_tecido_id(numero_pedido, itens:ocs_tecido_itens(cancelado, artigo:artigo_id(nome)))")
        .eq("colecao_id", colecaoId)).data ?? []) as unknown as { oc_tecido_id: string; oc: { numero_pedido: string | null; itens: { cancelado: boolean | null; artigo: { nome: string | null } | null }[] | null } | null }[])
        .map((r) => ({
          id: r.oc_tecido_id,
          numero_pedido: r.oc?.numero_pedido ?? null,
          tecidos: [...new Set((r.oc?.itens ?? []).filter((i) => !i.cancelado && i.artigo?.nome).map((i) => i.artigo!.nome as string))],
        })),
  });

  // OCs VINCULADAS no Desenvolvimento (read-only) → Map<modelo_id, [{oc_id, numero, tecidos}]>
  const { data: vinculosMap = {} } = useQuery({
    queryKey: ["plan-tecido-vinculos", colecaoId],
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const rows = ((await supabase.rpc("plan_tecido_vinculos_modelo" as any, { _colecao_id: colecaoId })).data ?? []) as { modelo_id: string; oc_tecido_id: string; numero_pedido: string | null; tecidos: string | null }[];
      const map: Record<string, { oc_id: string; numero_pedido: string | null; tecidos: string | null }[]> = {};
      for (const r of rows) (map[r.modelo_id] ??= []).push({ oc_id: r.oc_tecido_id, numero_pedido: r.numero_pedido, tecidos: r.tecidos });
      return map;
    },
  });

  // hint OC por SLOT → Map<slot_id, oc_ids[]>
  const { data: slotOcMap = {} } = useQuery({
    queryKey: ["plan-tecido-slot-oc", colecaoId],
    queryFn: async () => {
      const rows = ((await supabase.from("plan_tecido_slot_oc" as any).select("slot_id, oc_tecido_id").eq("colecao_id", colecaoId)).data ?? []) as unknown as { slot_id: string; oc_tecido_id: string }[];
      const map: Record<string, string[]> = {};
      for (const r of rows) (map[r.slot_id] ??= []).push(r.oc_tecido_id);
      return map;
    },
  });

  // paleta de insumos da coleção (com PAPEL) → escopa os dropdowns por tecido/forro
  const { data: paletaManual = [] } = useQuery({
    queryKey: ["plan-tecido-paleta-papel", colecaoId],
    queryFn: async () =>
      (((await supabase.from("plan_tecido_paleta" as any).select("artigo_id, papel").eq("colecao_id", colecaoId)).data ?? []) as unknown as { artigo_id: string; papel: string }[]),
  });
  // tecidos/forros JÁ usados pelos cards da coleção (aparecem na paleta automaticamente)
  const paletaEmUso = useMemo(() => (arvore ? tecidosDaArvore(arvore) : []), [arvore]);
  // paleta efetiva = manual (Insumos) ∪ em uso pelos cards → alimenta os dropdowns dos cards
  const paleta = useMemo(() => {
    const seen = new Set<string>(); const out: { artigo_id: string; papel: string }[] = [];
    for (const p of [...paletaManual, ...paletaEmUso]) {
      const k = `${p.artigo_id}|${p.papel}`;
      if (seen.has(k)) continue; seen.add(k); out.push(p);
    }
    return out;
  }, [paletaManual, paletaEmUso]);

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

  // modelos lançados (não podem receber "Aplicar ao modelo")
  const lancadoSet = useMemo(() => new Set(((modelosDb ?? []) as any[]).filter((m) => m.lancado).map((m) => m.id as string)), [modelosDb]);
  // Aprovação de custo de mão de obra por modelo (mesmo flag do Planejamento).
  const maoObraAprovadoMap = useMemo(
    () => new Map(((modelosDb ?? []) as any[]).map((m) => [m.id as string, (m.custo_terceirizados_aprovado ?? null) as boolean | null])),
    [modelosDb],
  );
  // Só quem tem a permissão dedicada pode aprovar (o banco também bloqueia via trigger).
  const { canEdit } = useAuth();
  const podeAprovarMaoObra = canEdit("producao_servico_aprovacao");
  const aprovarMaoObraMut = useMutation({
    mutationFn: async ({ id, aprovado }: { id: string; aprovado: boolean }) => {
      const { error } = await supabase.from("modelos").update({ custo_terceirizados_aprovado: aprovado } as any).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["plan-tecido-modelos", colecaoId] });
      // Reflete no Planejamento e na lista do Desenvolvimento (badge "Custo aprovado").
      qc.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey?.[0];
          return typeof k === "string" && (k.includes("modelos") || k.includes("desenvolvimento") || k.includes("planejamento"));
        },
      });
    },
    onError: (e) => toast.error(mensagemErro(e, "Não foi possível aprovar o custo de mão de obra.")),
  });

  useEffect(() => {
    if (seed && salvo !== undefined && modelosDb !== undefined && arvore === null) {
      const validIds = new Set(((modelosDb ?? []) as any[]).map((m) => m.id as string));
      const merged = mergeArvore(semearComModelos({ ...seed, modelos: modelosReais }), salvo);
      // limpa modelo_id ÓRFÃO (modelo excluído no Plan. Produto) → volta a permitir "Criar card"
      merged.subcolecoes = merged.subcolecoes.map((s) => ({ ...s, linhas: s.linhas.map((l) => ({ ...l,
        slots: l.slots.map((sl) => (sl.modelo_id && !validIds.has(sl.modelo_id) ? { ...sl, modelo_id: null, ref: null, nome: null, thumb_path: null } : sl)),
      })) }));
      setArvore(merged);
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

  // garante o plano salvo antes de uma ação de servidor (auto-salva se houver mudança pendente)
  const ensureSaved = async (): Promise<boolean> => {
    if (!dirty) return true;
    try { await salvarMut.mutateAsync(); return true; }
    catch { return false; }
  };

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

  const patch = (next: PtArvore) => { setArvore(next); setDirty(true); };

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
          // Remove o material do MESMO papel (Tecido 1 / Forro 1) e insere o novo
          const resto = slot.materiais.filter((m) => !(m.tipo === material.tipo && m.numero === 1));
          next.subcolecoes[si].linhas[li].slots[sli] = {
            ...slot,
            materiais: material.tipo === "tecido" ? [material, ...resto] : [...resto, material],
          };
        }
      }
    }
    patch(next);
    setSelecao(new Set());
    setFormTipo(null);
    toast.success(`${material.tipo === "forro" ? "Forro" : "Tecido"} aplicado a ${n} slot(s).`);
  }

  const catTecidoNome = (id: string | null | undefined) => nameOf(catTecidoNomes, id);
  const toggleSel = (chave: string) =>
    setSelecao((prev) => { const n = new Set(prev); if (n.has(chave)) n.delete(chave); else n.add(chave); return n; });

  // Aplica a categoria de tecido (lane) nos slots selecionados; garante a lane na subcoleção ativa.
  function aplicarCategoriaEmMassa(catId: string | null) {
    if (!arvore) return;
    const next = structuredClone(arvore) as PtArvore;
    for (let si = 0; si < next.subcolecoes.length; si++)
      for (let li = 0; li < next.subcolecoes[si].linhas.length; li++)
        for (let sli = 0; sli < next.subcolecoes[si].linhas[li].slots.length; sli++) {
          const slot = next.subcolecoes[si].linhas[li].slots[sli];
          if (!selecao.has(chaveSlot(slot.id, si, li, sli))) continue;
          slot.categoria_tecido_id = catId;
        }
    if (catId) {
      const sub = next.subcolecoes[subAtiva];
      sub.categorias_tecido = [...new Set([...(sub.categorias_tecido ?? []), catId])];
    }
    patch(next);
    setSelecao(new Set());
    setAplicarCatOpen(false);
    toast.success(catId ? "Categoria aplicada." : "Modelos sem categoria.");
  }

  // Adiciona uma categoria (lane, mesmo vazia) à subcoleção ativa.
  function addCategoria(catId: string) {
    if (!arvore) return;
    const next = structuredClone(arvore) as PtArvore;
    const sub = next.subcolecoes[subAtiva];
    sub.categorias_tecido = [...new Set([...(sub.categorias_tecido ?? []), catId])];
    patch(next);
    setAddCatOpen(false);
  }

  // Remove a categoria (lane) da subcoleção ativa; os slots dela voltam a "Sem categoria".
  function removeCategoria(catId: string) {
    if (!arvore) return;
    const next = structuredClone(arvore) as PtArvore;
    const sub = next.subcolecoes[subAtiva];
    sub.categorias_tecido = (sub.categorias_tecido ?? []).filter((c) => c !== catId);
    for (const ln of sub.linhas) for (const sl of ln.slots) if (sl.categoria_tecido_id === catId) sl.categoria_tecido_id = null;
    if (catFilter === catId) setCatFilter(null);
    patch(next);
  }

  async function handleAbrirPrevia() {
    setPreviaLoading(true);
    try {
      if (!(await ensureSaved())) return; // auto-salva; a prévia lê o plano do servidor
      const { data, error } = await supabase.rpc("plan_tecido_previa_pedido" as any, {
        _colecao_id: colecaoId,
      });
      if (error) throw error;
      setPreviaData(data as PreviaRpc);
      setPreviaOpen(true);
    } catch (e) {
      toast.error(mensagemErro(e, "Não foi possível carregar a prévia do pedido."));
    } finally {
      setPreviaLoading(false);
    }
  }

  const subAtual = arvore ? (arvore.subcolecoes[subAtiva] ?? null) : null;
  const chipCls = (active: boolean) =>
    `rounded-full border px-3 py-1 text-xs font-medium transition-colors ${active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:border-primary"}`;

  return (
    <Sheet open onOpenChange={(o) => { if (!o) requestClose(); }}>
      <SheetContent side="right" className="w-screen max-w-none sm:max-w-none flex flex-col p-0 max-sm:[&>button]:hidden">
        <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background p-3">
          <Breadcrumb items={[
            { label: "Estilo & Engenharia" },
            { label: "Plan. Tecido", onClick: requestClose },
            { label: colecao?.nome ?? "…", onClick: view === "canvas" ? () => setView("subcolecoes") : undefined },
            ...(view === "canvas" && subAtual ? [{ label: nameOf(subNomes, subAtual.subcolecao_id) ?? "Sem subcoleção" }] : []),
          ]} />
          <UnsavedIndicator show={dirty} className="ml-auto shrink-0" />
        </div>


        {/* Barra de seleção múltipla (só no canvas) */}
        {view === "canvas" && selecao.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b bg-amber-50 px-3 py-2 text-sm">
            <span className="font-medium">{selecao.size} selecionado(s)</span>
            <Button size="sm" variant="default" className="ml-auto text-xs" onClick={() => setAplicarCatOpen(true)}>Aplicar categoria</Button>
            <Button size="sm" variant="outline" className="text-xs" onClick={() => setFormTipo("tecido")}>Aplicar tecido</Button>
            <Button size="sm" variant="outline" className="text-xs" onClick={() => setFormTipo("forro")}>Aplicar forro</Button>
            <Button size="sm" variant="ghost" className="text-xs text-muted-foreground" onClick={() => setSelecao(new Set())}>Limpar</Button>
          </div>
        )}

        {!arvore ? (
          <div className="p-6 text-sm text-muted-foreground">Carregando…</div>
        ) : view === "subcolecoes" ? (
          <div className="flex-1 overflow-y-auto p-4">
            <div className="mb-3 text-sm text-muted-foreground">Escolha uma subcoleção para planejar os tecidos por categoria.</div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {arvore.subcolecoes
                .map((sub, si) => ({ sub, si }))
                .sort((a, b) => subOrdem(a.sub.subcolecao_id) - subOrdem(b.sub.subcolecao_id) || a.si - b.si)
                .map(({ sub, si }) => {
                const nSlots = sub.linhas.reduce((a, l) => a + l.slots.length, 0);
                const cats = sub.categorias_tecido ?? [];
                const semCat = sub.linhas.reduce((a, l) => a + l.slots.filter((s) => !s.categoria_tecido_id).length, 0);
                return (
                  <button key={sub.id ?? si} type="button"
                    className="flex flex-col gap-2 rounded-lg border bg-background p-4 text-left shadow-sm transition-shadow hover:border-primary hover:shadow-md"
                    onClick={() => { setSubAtiva(si); setCatFilter(null); setSelecao(new Set()); setView("canvas"); }}>
                    <div className="font-medium">{nameOf(subNomes, sub.subcolecao_id) ?? "Sem subcoleção"}</div>
                    <div className="flex flex-wrap gap-1">
                      {cats.length ? cats.map((cid) => (
                        <span key={cid} className="rounded bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">{catTecidoNome(cid) ?? "?"}</span>
                      )) : <span className="text-[11px] text-muted-foreground">sem categorias</span>}
                      {semCat > 0 && <span className="rounded bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{semCat} sem categoria</span>}
                    </div>
                    <div className="mt-auto text-xs text-muted-foreground"><b className="text-foreground">{nSlots}</b> modelo(s)</div>
                  </button>
                );
              })}
              {arvore.subcolecoes.length === 0 && <div className="text-sm text-muted-foreground">Nenhuma subcoleção nesta coleção.</div>}
            </div>
          </div>
        ) : subAtual ? (() => {
          const sub = subAtual;
          const subArvore: PtArvore = { ...arvore, subcolecoes: [sub] };
          const flat = sub.linhas.flatMap((ln, li) => ln.slots.map((slot, sli) => ({ slot, li, sli, chave: chaveSlot(slot.id, subAtiva, li, sli) })));
          const cats = sub.categorias_tecido ?? [];
          const slotsOf = (cid: string | null) => flat.filter((f) => (f.slot.categoria_tecido_id ?? null) === cid);
          const laneCats: (string | null)[] = catFilter === "__sem__" ? [null] : catFilter ? [catFilter] : [...cats, null];
          const cardOf = (slot: PtSlot, li: number, sli: number, chave: string) => (
            <ModelCard key={slot.id ?? `${li}-${sli}`} slot={slot} colecaoId={colecaoId} subcolecaoId={sub.subcolecao_id}
              paleta={paleta} tamanhos={tamanhos} ocsAplicadas={ocsAplicadas}
              slotOcIds={slot.id ? (slotOcMap[slot.id] ?? []) : []}
              vinculos={slot.modelo_id ? (vinculosMap[slot.modelo_id] ?? []) : []}
              lancado={slot.modelo_id ? lancadoSet.has(slot.modelo_id) : false}
              maoObraAprovado={slot.modelo_id ? (maoObraAprovadoMap.get(slot.modelo_id) ?? null) : null}
              onSetMaoObra={slot.modelo_id && podeAprovarMaoObra ? (aprovado) => aprovarMaoObraMut.mutate({ id: slot.modelo_id!, aprovado }) : undefined}
              onEnsureSaved={ensureSaved}
              onChange={(ns) => { const next = structuredClone(arvore) as PtArvore; next.subcolecoes[subAtiva].linhas[li].slots[sli] = ns; patch(next); }}
              selected={selecao.has(chave)} onToggleSelect={() => toggleSel(chave)} />
          );
          return (
            <div className="flex flex-1 overflow-hidden">
              <aside className="hidden w-80 shrink-0 overflow-y-auto border-r p-3 md:block lg:w-96">
                <ResumoPanel arvore={subArvore} />
              </aside>
              <main className="flex-1 overflow-y-auto p-3">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <button type="button" className={chipCls(!catFilter)} onClick={() => setCatFilter(null)}>Todos ({flat.length})</button>
                  {cats.map((cid) => (
                    <button key={cid} type="button" className={chipCls(catFilter === cid)} onClick={() => setCatFilter(cid)}>{catTecidoNome(cid) ?? "?"} ({slotsOf(cid).length})</button>
                  ))}
                  {flat.some((f) => !f.slot.categoria_tecido_id) && (
                    <button type="button" className={chipCls(catFilter === "__sem__")} onClick={() => setCatFilter("__sem__")}>Sem categoria ({slotsOf(null).length})</button>
                  )}
                  <Button size="sm" variant="outline" className="ml-auto gap-1" onClick={() => setAddCatOpen(true)}><Plus className="h-3.5 w-3.5" /> categoria</Button>
                </div>
                <div className="space-y-4">
                  {laneCats.map((cid) => {
                    const slots = slotsOf(cid);
                    return (
                      <section key={cid ?? "__sem__"}>
                        <div className="mb-1 flex items-center gap-2">
                          <span className={`text-sm font-semibold ${cid ? "" : "text-muted-foreground"}`}>{cid ? (catTecidoNome(cid) ?? "?") : "Sem categoria"}</span>
                          <span className="rounded-full border px-2 text-[11px] text-muted-foreground">{slots.length} modelo(s)</span>
                          {cid && <button type="button" className="ml-1 rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" title="Remover categoria" onClick={() => removeCategoria(cid)}><X className="h-3.5 w-3.5" /></button>}
                        </div>
                        <div className="flex items-start gap-3 overflow-x-auto pb-2">
                          {slots.length ? slots.map(({ slot, li, sli, chave }) => (
                            <div key={slot.id ?? `${li}-${sli}`} className="w-[360px] shrink-0">{cardOf(slot, li, sli, chave)}</div>
                          )) : (
                            <div className="min-w-[280px] rounded-lg border border-dashed p-4 text-center text-xs italic text-muted-foreground">
                              Selecione modelos e clique “Aplicar categoria”, ou defina a categoria de tecido dentro do card.
                            </div>
                          )}
                        </div>
                      </section>
                    );
                  })}
                </div>
              </main>
            </div>
          );
        })() : null}

        <div className="shrink-0 border-t bg-background p-3 flex items-center gap-2">
          <Button variant="outline" size="sm" className="max-sm:h-11" onClick={() => (view === "canvas" ? setView("subcolecoes") : requestClose())}>
            <ArrowLeft className="mr-1 h-4 w-4" />
            {view === "canvas" ? "Subcoleções" : "Voltar"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={desfazerPedidoMut.isPending}
            onClick={() => setDesfazerOpen(true)}
            className="ml-auto max-sm:h-11"
          >
            <Undo2 className="mr-1 h-4 w-4" />
            <span className="hidden sm:inline">Desfazer pedido</span>
          </Button>
          <Button
            variant="default"
            size="sm"
            className="max-sm:h-11"
            disabled={previaLoading}
            onClick={handleAbrirPrevia}
          >
            <ShoppingCart className="mr-1 h-4 w-4" />
            <span className="hidden sm:inline">{previaLoading ? "Carregando…" : "Fazer pedido"}</span>
            <span className="sm:hidden">{previaLoading ? "…" : "Pedido"}</span>
          </Button>
          <Button disabled={!dirty || salvarMut.isPending} onClick={() => salvarMut.mutate()}>
            {dirty ? "Salvar" : "Salvo"}
          </Button>
        </div>

        <UnsavedChangesGuard
          confirm={confirm}
          message="Há alterações não salvas no planejamento de tecido."
        />

        {/* Dialog: adicionar categoria (lane) à subcoleção ativa */}
        <Dialog open={addCatOpen} onOpenChange={setAddCatOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>Adicionar categoria de tecido</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-2">
              {catTecidoNomes.filter((c) => !(subAtual?.categorias_tecido ?? []).includes(c.id)).map((c) => (
                <Button key={c.id} variant="outline" size="sm" className="justify-start" onClick={() => addCategoria(c.id)}>{c.nome}</Button>
              ))}
              {catTecidoNomes.filter((c) => !(subAtual?.categorias_tecido ?? []).includes(c.id)).length === 0 && (
                <div className="col-span-2 text-xs text-muted-foreground">Todas as categorias já foram adicionadas.</div>
              )}
            </div>
          </DialogContent>
        </Dialog>

        {/* Dialog: aplicar categoria aos selecionados */}
        <Dialog open={aplicarCatOpen} onOpenChange={setAplicarCatOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>Aplicar categoria a {selecao.size} modelo(s)</DialogTitle></DialogHeader>
            <div className="flex flex-col gap-1.5">
              {(subAtual?.categorias_tecido ?? []).map((cid) => (
                <Button key={cid} variant="outline" size="sm" className="justify-start gap-2" onClick={() => aplicarCategoriaEmMassa(cid)}><Tag className="h-3.5 w-3.5" /> {catTecidoNome(cid) ?? "?"}</Button>
              ))}
              <Button variant="ghost" size="sm" className="justify-start text-muted-foreground" onClick={() => aplicarCategoriaEmMassa(null)}>Sem categoria</Button>
              {catTecidoNomes.filter((c) => !(subAtual?.categorias_tecido ?? []).includes(c.id)).length > 0 && (
                <div className="mt-1 border-t pt-2">
                  <div className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">Nova categoria</div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {catTecidoNomes.filter((c) => !(subAtual?.categorias_tecido ?? []).includes(c.id)).map((c) => (
                      <Button key={c.id} variant="ghost" size="sm" className="justify-start text-primary" onClick={() => aplicarCategoriaEmMassa(c.id)}><Plus className="mr-1 h-3 w-3" />{c.nome}</Button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>

        {/* Mini-form: aplicar tecido/forro em massa (respeita a paleta) */}
        <AlertDialog open={!!formTipo} onOpenChange={(o) => { if (!o) setFormTipo(null); }}>
          {formTipo && (
            <FormAplicarTecido
              nSelecionados={selecao.size}
              tipo={formTipo}
              paleta={paleta}
              onConfirmar={aplicarTecidoEmMassa}
              onCancelar={() => setFormTipo(null)}
            />
          )}
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

        {/* Fazer pedido — wizard paginado (1 página por OC, respeita fornecedores) */}
        {previaOpen && previaData && (
          <FazerPedidoWizard previa={previaData} colecaoId={colecaoId} onClose={() => setPreviaOpen(false)} />
        )}
      </SheetContent>
    </Sheet>
  );
}
