import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { supabase } from "@/integrations/supabase/client";
import { corApelidoLabel } from "@/lib/variante";
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
import { AgrupamentoButton } from "@/components/shared/filters";
import { ColabBanner } from "@/components/shared/ColabBanner";
import { useColabRegistro } from "@/hooks/useColabRegistro";
import type { Conflito } from "@/lib/colab/merge";
import { mergeArvorePorSlot } from "@/lib/plan-tecido/colab-merge-arvore";
import { ArrowLeft, ShoppingCart, Plus, X, Tag, PanelLeft, Ruler, ChevronDown, ChevronRight, Boxes } from "lucide-react";
import { EditarMixDialog } from "@/components/plan-tecido/EditarMixDialog";
import { StatusBadge } from "@/components/shared/StatusBadge";
import {
  semearComModelos, mergeArvore, moverParaFamiliaDoTecido, normalizarCategoriasAuto, type SeedInput, type ModeloReal, type ModeloRealMaterial,
} from "@/lib/plan-tecido/engine";
import type { PtArvore, PtMaterial, PtVariante, PtSlot, PtSub } from "@/lib/plan-tecido/types";
import { ModelCard } from "@/components/plan-tecido/ModelCard";
import { RecolherMenu } from "@/components/plan-tecido/RecolherMenu";
import { CategoriaTecidoFilter } from "@/components/plan-tecido/CategoriaTecidoFilter";
import { ResumoPanel } from "@/components/plan-tecido/ResumoPanel";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useArtigosTecido } from "@/lib/plan-tecido/useArtigosTecido";
import { tecidosDaArvore, slotMetros, fmtMetros, buildMateriaisAplicar } from "@/lib/plan-tecido/calc";
import { normalizeKanbanStatuses, labelColunaKanban } from "@/lib/kanban-status";
import { FazerPedidoWizard, type PreviaRpc } from "@/components/plan-tecido/FazerPedidoWizard";
import { PlanTecidoDrawer, type DrawerState, type DrawerKind } from "@/components/plan-tecido/PlanTecidoDrawer";
import { useSituacaoOcs } from "@/lib/plan-tecido/useSituacaoOcs";
import { DndContext, DragOverlay, PointerSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { DroppableLane, DraggableCard, type DragHandle } from "@/components/plan-tecido/dnd";

type Nome = { id: string; nome: string };

// Chave estável por slot (prefere o id do banco, senão usa índices)
function chaveSlot(slotId: string | undefined, si: number, li: number, sli: number): string {
  return slotId ?? `${si}-${li}-${sli}`;
}

// limpa modelo_id ÓRFÃO (modelo excluído no Plan. Produto) — extraído do effect de seed p/
// ser reutilizável também pelo merge colab (mesma regra, 3 chamadores).
function limparSlotsOrfaos(arv: PtArvore, validIds: Set<string>): PtArvore {
  return {
    ...arv,
    subcolecoes: arv.subcolecoes.map((s) => ({
      ...s,
      linhas: s.linhas.map((l) => ({
        ...l,
        slots: l.slots.map((sl) => (sl.modelo_id && !validIds.has(sl.modelo_id) ? { ...sl, modelo_id: null, ref: null, nome: null, thumb_path: null } : sl)),
      })),
    })),
  };
}

// Árvore "fresca" = a semeadura (OTB/BOM vivos) mesclada com o que está salvo no servidor —
// MESMO pipeline usado pelo carregamento normal (engine intocado, só consumido).
function computeFreshArvore(seed: SeedInput, modelos: ModeloReal[], salvo: PtArvore | null, modelosDb: any[]): PtArvore {
  const validIds = new Set(modelosDb.map((m) => m.id as string));
  return limparSlotsOrfaos(mergeArvore(semearComModelos({ ...seed, modelos }), salvo), validIds);
}

function rotuloConflitoSlot(c: Conflito | undefined): string {
  const s = (c?.meu ?? c?.dele) as PtSlot | null | undefined;
  return s ? `Slot ${s.nome ?? s.ref ?? "sem modelo"}` : "Slot";
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
              {/* a "paleta" do aplicar em massa = tecidos já usados em algum card do plano
                  ("Insumos da coleção" não é mais uma tela — mensagem fantasma corrigida, laudo) */}
              Nenhum {rotulo} no plano ainda — escolha o {rotulo} em um card primeiro; ele passa a aparecer aqui.
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
                    <span>{corApelidoLabel(v.cor?.nome, v.apelido?.nome)}</span>
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

export function PlanTecidoSheet({ colecaoId, subInicial = null, onSubChange, onClose }: {
  colecaoId: string;
  /** subcolecao_id vindo da URL (?sub=; "none" = sub sem id) — deep-link direto no canvas. */
  subInicial?: string | null;
  /** Reflete a subcoleção aberta na URL (replace) — F5/Back seguros; null = voltou p/ etapa 2. */
  onSubChange?: (subId: string | null) => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [arvore, setArvore] = useState<PtArvore | null>(null);
  const [dirty, setDirty] = useState(false);
  // Colab (Task 3, spec 2026-08-04) — piloto: mesmo padrão do OC Tecido/Plan. Produto, adaptado
  // pra árvore aninhada (merge POR SLOT, ver @/lib/plan-tecido/colab-merge-arvore). `planBaseRef` = última
  // árvore fresca conhecida (base do 3-vias); `touchedSlotIdsRef` = ids de slot que EU editei
  // desde então; `salvoConsumidoRef` evita reprocessar o mesmo `salvo` 2x; `revRef` espelha
  // `colecoes.plan_rev` p/ o `_rev_base` do save; `arvoreLiveRef` é o espelho síncrono usado no
  // retry do onError (a janela do `await` pode ter mudanças que a closure do clique não vê).
  const planBaseRef = useRef<PtArvore | null>(null);
  const touchedSlotIdsRef = useRef<Set<string>>(new Set());
  const salvoConsumidoRef = useRef<PtArvore | null | undefined>(undefined);
  const revRef = useRef<number | null>(null);
  const retryRef = useRef(false);
  const arvoreLiveRef = useRef<PtArvore | null>(null);
  arvoreLiveRef.current = arvore;
  const [conflitosSlot, setConflitosSlot] = useState<Conflito[]>([]);
  const conflitosSlotRef = useRef<Conflito[]>([]);
  const [ultimoMergeSlot, setUltimoMergeSlot] = useState<{ atualizados: number; conflitos: Conflito[] } | null>(null);
  // Back/rota com plano sujo confirma ("Descartar?"); trocar ?sub= dentro da MESMA coleção
  // passa livre (o Sheet não desmonta — nada se perde). Laudo das 3 lentes, jul/2026.
  // Fix (dono, ago/2026 — "aviso de descarte 2x", espelhado do mesmo fix em ProdutoAcabadoSheet):
  // confirmar "Descartar" na saída REAL (fechar o Sheet/breadcrumb) passa pelo `open` LOCAL do
  // guarda e chama `onClose` → o pai navega. Nesse instante o Sheet ainda está montado (React só
  // desmonta depois do pai re-renderizar sem `colecao` na URL) — o MESMO `useBlocker` intercepta
  // essa navegação de novo (`dirty` ainda true) e mostra um 2º aviso logo após o 1º confirmado.
  // `justClosingRef` marca "essa navegação É a consequência da minha própria confirmação, deixa
  // passar" — via REF (não state) porque `navPermitida` roda SÍNCRONO dentro do mesmo clique que
  // dispara `navigate()`; consome-se sozinho (1 leitura) pra não virar bypass permanente.
  const justClosingRef = useRef(false);
  const navPermitida = useCallback(
    (next: { pathname?: string; search?: Record<string, unknown> }) => {
      if (justClosingRef.current) {
        justClosingRef.current = false;
        return true;
      }
      return String(next?.pathname ?? "").includes("/criacao/plan-tecido") && next?.search?.colecao === colecaoId;
    },
    [colecaoId],
  );
  // Saída real confirmada ("Descartar"): arma `justClosingRef` ANTES de navegar (comentário
  // acima) e zera o dirty de verdade — o Sheet está desmontando de qualquer forma, mas evita um
  // flash de "ainda sujo" se por algum motivo o pai não desmontar na hora.
  const fecharDeVez = useCallback(() => {
    justClosingRef.current = true;
    setDirty(false);
    onClose();
  }, [onClose]);
  const { requestClose, requestAction, confirm } = useUnsavedGuard({ dirty, onClose: fecharDeVez, blockNav: true, navPermitida });
  const [view, setView] = useState<"subcolecoes" | "canvas">("subcolecoes");
  const [subAtiva, setSubAtiva] = useState(0);
  // Set vazio = Todos; `null` no set = "Sem categoria"; ids = categorias. MULTI (dono, ago/2026) —
  // os chips antigos (single) misturavam categorias sem card nenhum e davam lista vazia.
  const [catFilters, setCatFilters] = useState<Set<string | null>>(new Set());
  const [addCatOpen, setAddCatOpen] = useState(false);
  const [aplicarCatOpen, setAplicarCatOpen] = useState(false);
  // G6 (criar em massa) / G5 (pedido por seleção) — confirmação e progresso das 2 ações novas
  // da barra de seleção.
  const [criarCardsConfirm, setCriarCardsConfirm] = useState<{ elegiveis: string[]; pulados: string[]; semDados: number } | null>(null);
  const [criandoCards, setCriandoCards] = useState(false);
  const [pedidoSelecaoConfirm, setPedidoSelecaoConfirm] = useState<{ compraveis: string[]; comprados: string[] } | null>(null);
  const [preparandoPedidoSelecao, setPreparandoPedidoSelecao] = useState(false);
  const [slotIdsPedido, setSlotIdsPedido] = useState<string[] | null>(null); // slots do pedido POR SELEÇÃO (null = coleção inteira)
  const [selecao, setSelecao] = useState<Set<string>>(new Set());
  const [recolhidos, setRecolhidos] = useState<Set<string>>(new Set()); // chaves de cards recolhidos
  const [resumoAberto, setResumoAberto] = useState(true); // resumo colapsável (trilho)
  // MOBILE (<md): Resumo/A comprar/OCs viram ABAS full-width — antes os asides eram
  // hidden md:/lg: e a camada analítica + vincular/desvincular OC não existiam no celular.
  const [mobileTab, setMobileTab] = useState<"canvas" | "resumo" | "comprar" | "oc">("canvas");
  const [drawer, setDrawer] = useState<DrawerState | null>(null); // subsheet "detalhar" (extensão)
  const [lanesRecolhidas, setLanesRecolhidas] = useState<Set<string>>(new Set()); // lanes (categorias) colapsáveis
  const toggleLane = (k: string) => setLanesRecolhidas((prev) => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });
  // Agrupamento combinável (popover "Agrupar", padrão das outras telas): macro = categoria de tecido
  // (lanes com drag), micro = nome do tecido (2º nível/blocos). DEFAULT = por NOME de tecido, recolhido
  // (pedido do dono, jul/2026): abre agrupado por nome com os grupos colapsados. Categoria (com drag)
  // fica a um clique no botão Agrupar.
  const [groupByCategoria, setGroupByCategoria] = useState(false);
  const [groupByNome, setGroupByNome] = useState(true);
  const [groupByMix, setGroupByMix] = useState(false);        // lanes por MIX (exclui Família)
  const [mixDialogOpen, setMixDialogOpen] = useState(false);  // Editar Mix (escopo = subcoleção ativa)
  const [mixMassaOpen, setMixMassaOpen] = useState(false);    // "Mover p/ mix" (barra de seleção)
  const openDrawer = (kind: DrawerKind, arg?: string) =>
    setDrawer((prev) => (prev && prev.kind === kind && (prev.arg ?? null) === (arg ?? null) ? null : { kind, arg: arg ?? null }));
  const detalharMobile = (kind: DrawerKind, arg?: string) => {
    setDrawer({ kind, arg: arg ?? null });
    setMobileTab(kind === "comprar" ? "comprar" : "oc");
  };
  const { data: situacaoRows = [] } = useSituacaoOcs(colecaoId);
  const ocNumeroDe = (id: string) => situacaoRows.find((r) => r.oc_tecido_id === id)?.numero ?? null;
  // arrastar card entre lanes (grip inicia; distância p/ não confundir com clique)
  const dndSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }));
  const [dragId, setDragId] = useState<string | null>(null);
  const nomeDoChave = (chave: string): string | null => {
    if (!arvore) return null;
    const sub = arvore.subcolecoes[subAtiva];
    for (let li = 0; li < (sub?.linhas.length ?? 0); li++)
      for (let sli = 0; sli < sub.linhas[li].slots.length; sli++) {
        const s = sub.linhas[li].slots[sli];
        if (chaveSlot(s.id, subAtiva, li, sli) === chave) return s.nome ?? s.ref ?? "Modelo";
      }
    return null;
  };

  const toggleRecolhido = (chave: string) =>
    setRecolhidos((prev) => { const n = new Set(prev); if (n.has(chave)) n.delete(chave); else n.add(chave); return n; });
  const [formTipo, setFormTipo] = useState<"tecido" | "forro" | null>(null);
  const [previaOpen, setPreviaOpen] = useState(false);
  const [previaData, setPreviaData] = useState<PreviaRpc | null>(null);
  // Auto-aplicar (bug #9): slots pré-explosão cujo "Aplicar ao modelo" bateu na guarda vazio-sobre-
  // preenchido (esvaziar cores/zerar grade) — o save já gravou o plano; aqui pedimos confirmação p/
  // espelhar no BOM. `null` = sem pendência; array = diálogo aberto listando os modelos.
  const [sobrescritaPendentes, setSobrescritaPendentes] = useState<{ slotId: string; nome: string; materiais: unknown }[] | null>(null);

  const { data: colecao } = useQuery({
    queryKey: ["plan-tecido-colecao", colecaoId],
    queryFn: async () =>
      // plan_rev (Colab Task 3): trava otimista do salvar_plan_tecido — ver useColabRegistro abaixo.
      (await supabase.from("colecoes").select("id, nome, tipo, plan_rev").eq("id", colecaoId).maybeSingle()).data as any,
  });

  const { data: seed } = useQuery({
    queryKey: ["plan-tecido-seed", colecaoId],
    enabled: !!colecao,
    queryFn: async (): Promise<SeedInput> => {
      const tipo = (colecao.tipo === "poder_venda" ? "poder_venda" : "orcamento") as SeedInput["tipo"];
      // TODAS as subcoleções (em ordem) — p/ a subcoleção sem modelo/bucket (R3) ainda aparecer.
      const subcolecoes = (((await supabase.from("colecao_subcolecoes" as any).select("id, ordem").eq("colecao_id", colecaoId).order("ordem")).data ?? []) as any[])
        .map((s) => ({ subcolecao_id: s.id as string, ordem: Number(s.ordem) || 0 }));
      if (tipo === "poder_venda") {
        const rows = ((await supabase.from("colecao_pv_itens" as any).select("subcolecao_id, linha_id, qtd_semanas").eq("colecao_id", colecaoId)).data ?? []) as any[];
        const buckets = rows.map((r) => ({
          subcolecao_id: r.subcolecao_id,
          linha_id: r.linha_id,
          categoria_id: null,
          qtd: Object.values((r.qtd_semanas ?? {}) as Record<string, number>).reduce((s, n) => s + (Number(n) || 0), 0),
        }));
        return { colecao_id: colecaoId, tipo, buckets, subcolecoes };
      }
      // Split de categoria (colecao_semana_categorias) é PARCIAL; o total planejado (OTB) vem das
      // SEMANAS (colecao_semanas.qtd_planejada). Buckets = split por categoria + RESTANTE "sem
      // categoria" por sub (total OTB − Σ split) — senão o planejado mostrava só o split (ex.: 19 em
      // vez de 43) e a subcoleção só-total (sem split) ficava sem slots.
      const catRows = ((await supabase.from("colecao_semana_categorias" as any).select("subcolecao_id, categoria_id, qtd").eq("colecao_id", colecaoId)).data ?? []) as any[];
      const semanaRows = ((await supabase.from("colecao_semanas" as any).select("subcolecao_id, qtd_planejada").eq("colecao_id", colecaoId)).data ?? []) as any[];
      const buckets = catRows.map((r) => ({ subcolecao_id: r.subcolecao_id, linha_id: null, categoria_id: r.categoria_id, qtd: Number(r.qtd) || 0 }));
      const totalPorSub = new Map<string | null, number>();
      for (const r of semanaRows) { const k = (r.subcolecao_id ?? null) as string | null; totalPorSub.set(k, (totalPorSub.get(k) ?? 0) + (Number(r.qtd_planejada) || 0)); }
      const splitPorSub = new Map<string | null, number>();
      for (const r of catRows) { const k = (r.subcolecao_id ?? null) as string | null; splitPorSub.set(k, (splitPorSub.get(k) ?? 0) + (Number(r.qtd) || 0)); }
      for (const [sub, total] of totalPorSub) {
        const rem = total - (splitPorSub.get(sub) ?? 0);
        if (rem > 0) buckets.push({ subcolecao_id: sub, linha_id: null, categoria_id: null, qtd: rem });
      }
      return { colecao_id: colecaoId, tipo, buckets, subcolecoes };
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
    // enviado_cad/lancado/BOM mudam FORA do plano (Dev/CAD/produção) → refetcha ao voltar o foco,
    // senão a "Usada" comprometida (laranja) e o BOM ficam defasados.
    refetchOnWindowFocus: true,
    queryFn: async () =>
      ((await supabase
        .from("modelos")
        .select(
          // cad(cad_tecidos(consumo_cad)) — consumo confirmado no CAD (item 3c): fonte MAIS adiantada
          // do consumo. `cad` é to-many (1:1 por trigger, sem UNIQUE — CLAUDE.md invariante #7), lido
          // como m.cad?.[0]. Casa com o material por (tipo, numero), o mesmo par do sync CAD→BOM.
          "id, ref, nome, versao, origem, subcolecao, linha_id, markup_editado, categoria_principal_id, proporcoes, lancado, enviado_cad, fotos_modelo, croqui_url, desenho_tecnico_url, fotos_referencia, modelo_tecidos(id, tipo, numero, artigo_id, consumo, loss_percent, artigo:artigo_id(nome, unidade_medida, rendimento, preco_por_metro, categoria_tecido_id), modelo_tecido_variantes(variante_tecido_id, ordem, multiplicador, variante:variante_tecido_id(artigo_id, artigo:artigo_id(nome, unidade_medida, rendimento, preco_por_metro), nome_variante, cor:cor_id(nome), apelido:cor_apelido_id(nome)))), modelo_aviamentos(custo_previsto), modelo_grades(variante_numero, grades, grade_total), cad(cad_tecidos(tipo, numero, consumo_cad))",
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
    queryFn: async () => {
      type Art = { id: string | null; nome: string | null; categoria_tecido_id: string | null; cats: { categoria_tecido_id: string }[] | null };
      type Item = { cancelado: boolean | null; artigo: Art | null; variante: { artigo: Art | null } | null };
      // Pool = TODAS as OCs vinculadas à coleção — invariante "união de fontes" (auditoria jul/2026,
      // espelha _plan_tecido_situacao_ocs_core): aplicadas manualmente (plan_tecido_oc_aplicada) +
      // GERADAS pelo Fazer pedido (plan_tecido_ocs) + VÍNCULOS do Desenvolvimento
      // (modelo_tecido_oc_links dos modelos desta coleção) + HINTS já escolhidos em algum card
      // (plan_tecido_slot_oc). Faltando a 3ª fonte, um card SEM vínculo próprio via SlotOcHint não
      // achava a OC do seu tecido quando ela só estava linkada a OUTRO modelo da mesma coleção —
      // "Nenhuma OC deste tecido" falso-negativo (bug ago/2026: Entretela Fina tinha 4 vínculos de
      // Dev e 0 no pool de 2 fontes). Antes desta rodada já cobria só aplicada+gerada (a gerada
      // sozinha foi o fix anterior — comentário histórico mantido pelo contexto).
      const [apl, ger, dev, hint] = await Promise.all([
        supabase.from("plan_tecido_oc_aplicada" as any).select("oc_tecido_id").eq("colecao_id", colecaoId),
        supabase.from("plan_tecido_ocs" as any).select("oc_tecido_id").eq("colecao_id", colecaoId),
        supabase.from("modelo_tecido_oc_links" as any)
          .select("item:oc_tecido_item_id(oc_tecido_id), modelos!inner(colecao_id)")
          .eq("modelos.colecao_id", colecaoId),
        supabase.from("plan_tecido_slot_oc" as any).select("oc_tecido_id").eq("colecao_id", colecaoId),
      ]);
      // COMPRADAS pelo Fazer pedido DESTA coleção (plan_tecido_ocs) → `owned` p/ o selo "comprado" dos
      // seletores (decisão do dono 17/ago/2026). Reusa `ger` (já buscado acima), sem query extra.
      const gerSet = new Set((ger.data ?? []).map((r: any) => r.oc_tecido_id as string));
      const ids = [...new Set([
        ...(apl.data ?? []).map((r: any) => r.oc_tecido_id as string),
        ...(ger.data ?? []).map((r: any) => r.oc_tecido_id as string),
        ...(dev.data ?? []).map((r: any) => r.item?.oc_tecido_id as string | undefined).filter((x): x is string => !!x),
        ...(hint.data ?? []).map((r: any) => r.oc_tecido_id as string),
      ])];
      if (!ids.length) return [] as { id: string; numero_pedido: string | null; is_rolo: boolean; tecidos: string[]; categorias: string[]; artigos: string[]; fornecedor: string | null; owned: boolean }[];
      const rows = (((await supabase.from("ocs_tecido" as any)
        .select("id, numero_pedido, is_rolo, empresa:empresa_id(nome_fantasia), itens:ocs_tecido_itens(cancelado, artigo:artigo_id(id, nome, categoria_tecido_id, cats:artigo_categorias_tecido(categoria_tecido_id)), variante:variante_tecido_id(artigo:artigo_id(id, nome, categoria_tecido_id, cats:artigo_categorias_tecido(categoria_tecido_id))))")
        .in("id", ids)).data ?? []) as unknown as { id: string; numero_pedido: string | null; is_rolo: boolean | null; empresa: { nome_fantasia: string | null } | null; itens: Item[] | null }[]);
      return rows.map((oc) => {
        // ARTIGO REAL da variante vence o artigo do ITEM (que pode estar mislabeled pelo cross-artigo
        // legado) — senão a OC de Malha Tessa era catalogada como Fiore e não casava o card certo.
        const itens = (oc.itens ?? []).filter((i) => !i.cancelado);
        const artigos = new Set<string>();
        const categorias = new Set<string>();
        const nomes = new Set<string>();
        for (const i of itens) {
          const a = i.variante?.artigo ?? i.artigo;
          if (!a?.nome) continue;
          nomes.add(a.nome);
          if (a.id) artigos.add(a.id);
          if (a.categoria_tecido_id) categorias.add(a.categoria_tecido_id);
          for (const c of a.cats ?? []) categorias.add(c.categoria_tecido_id);
        }
        return { id: oc.id, numero_pedido: oc.numero_pedido ?? null, is_rolo: oc.is_rolo ?? false, tecidos: [...nomes], categorias: [...categorias], artigos: [...artigos], fornecedor: oc.empresa?.nome_fantasia ?? null, owned: gerSet.has(oc.id) };
      });
    },
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
  // OC REAL vinculada no Dev por modelo_id (só os oc_ids) — fonte da verdade p/ a Reservada do Resumo.
  const vinculoOcMap = useMemo(
    () => Object.fromEntries(Object.entries(vinculosMap).map(([mid, arr]) => [mid, arr.map((v) => v.oc_id)])) as Record<string, string[]>,
    [vinculosMap],
  );

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
      // PARTICIONA por artigo REAL de cada variante: no BOM do Dev, variantes de OUTRO tecido podem
      // vir penduradas num bloco (mecanismo de "substitutos"). Aqui cada variante vai pro material do
      // SEU artigo (Malha Tessa com as dela, Fiore num material próprio) — sem lumpar/duplicar cor.
      const blocks = (m.modelo_tecidos ?? []).filter((t: any) => t.tipo === "tecido" || t.tipo === "forro");
      // Consumo confirmado no CAD por (tipo, numero) — fonte MAIS adiantada (item 3c). `cad` é to-many
      // (1:1 por trigger): pega o 1º. Só entra se > 0 ("vence se preenchido"), casado por tipo+numero.
      const cadConsumo = new Map<string, number>();
      for (const ct of (m.cad?.[0]?.cad_tecidos ?? []) as any[]) {
        const c = Number(ct?.consumo_cad) || 0;
        if (c > 0) cadConsumo.set(`${ct.tipo ?? "tecido"}|${Number(ct.numero) || 1}`, c);
      }
      const matByArtigo = new Map<string, ModeloRealMaterial>();
      const materialFor = (artigoId: string | null, artigoDet: any, refBlock: any): ModeloRealMaterial => {
        const key = artigoId ?? `__null_${refBlock?.numero ?? "x"}`;
        let mat = matByArtigo.get(key);
        if (!mat) {
          const ownBlock = blocks.find((b: any) => (b.artigo_id ?? null) === artigoId); // bloco do próprio artigo (consumo/tipo/numero)
          const block = ownBlock ?? refBlock;
          const det = ownBlock?.artigo ?? artigoDet ?? refBlock?.artigo ?? null;
          const tipo = (block?.tipo ?? "tecido") as "tecido" | "forro";
          const numero = Number(block?.numero) || 1;
          // Hierarquia do consumo (item 3c): CAD preenchido (>0) VENCE o BOM Dev; senão o BOM; o
          // fallback p/ o plano salvo (0 aqui) segue no merge (comConsumoDoPlano). `consumo_cad` é só
          // marcador de EXIBIÇÃO (tooltip "consumo do CAD") — não é gravado no plano.
          const consumoBom = Number(block?.consumo) || 0;
          const consumoCad = cadConsumo.get(`${tipo}|${numero}`) ?? 0;
          mat = {
            tipo,
            numero,
            artigo_id: artigoId,
            artigo_nome: (det?.nome ?? null) as string | null,
            artigo_unidade_medida: (det?.unidade_medida ?? null) as string | null,
            artigo_rendimento: det?.rendimento != null ? Number(det.rendimento) : null,
            preco_por_metro: det?.preco_por_metro != null ? Number(det.preco_por_metro) : null,
            consumo: consumoCad > 0 ? consumoCad : consumoBom,
            consumo_cad: consumoCad > 0 ? consumoCad : null,
            loss_percent: Number(block?.loss_percent) || 0,
            variantes: [],
          };
          matByArtigo.set(key, mat);
        }
        return mat;
      };
      for (const block of blocks) {
        const vs = (block.modelo_tecido_variantes ?? []) as any[];
        if (vs.length === 0) { materialFor(block.artigo_id ?? null, block.artigo, block); continue; }
        for (const v of vs) {
          const artigoReal = (v.variante?.artigo_id ?? block.artigo_id ?? null) as string | null;
          materialFor(artigoReal, v.variante?.artigo, block).variantes.push({
            variante_tecido_id: v.variante_tecido_id,
            ordem: Number(v.ordem) || 0,
            multiplicador: Number(v.multiplicador) || 1,
            cor_nome: (v.variante?.cor?.nome ?? null) as string | null,
            label: corApelidoLabel(v.variante?.cor?.nome ?? null, v.variante?.apelido?.nome ?? null),
          });
        }
      }
      const materiais: ModeloRealMaterial[] = [...matByArtigo.values()];
      // categoria de TECIDO do card = categoria do Tecido 1 (artigo.categoria_tecido_id) → categoriza
      // o card AUTOMATICAMENTE no canvas (mesma leitura que o botão "Agrupar por tecido" fazia manual).
      const tec1 = (blocks as any[]).find((b) => b.tipo === "tecido" && Number(b.numero) === 1) ?? (blocks as any[]).find((b) => b.tipo === "tecido");
      const categoria_tecido_id = (tec1?.artigo?.categoria_tecido_id ?? null) as string | null;
      return {
        id: m.id,
        ref: m.ref ?? null,
        nome: m.nome ?? null,
        categoria_tecido_id,
        // hierarquia de imagem (decisão do dono, G4): foto de modelo → desenho técnico →
        // croqui → foto de REFERÊNCIA → vazio. A referência só entra quando o modelo não tem
        // foto própria — a foto do modelo sempre vence.
        thumb_path:
          (Array.isArray(m.fotos_modelo) ? m.fotos_modelo[0] : null) ||
          m.desenho_tecnico_url ||
          m.croqui_url ||
          (Array.isArray(m.fotos_referencia) ? m.fotos_referencia[0] : null) ||
          null,
        subcolecao: m.subcolecao ?? null,
        subcolecao_id: m.subcolecao ? (subIdPorNome.get(m.subcolecao) ?? null) : null,
        linha_id: m.linha_id ?? null,
        markup_editado: m.markup_editado ?? null,
        categoria_id: m.categoria_principal_id ?? null,
        // fotos de referência do modelo (G4) — mesma coluna do Plan. Produto/Dev (interop)
        fotos_referencia: (m.fotos_referencia ?? []) as string[],
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
  // modelos já enviados ao CAD (Explosão) = TRAVADOS p/ edição no Dev → "Aplicar ao modelo" não deve
  // alterar o BOM (o CAD já explodiu o BOM antigo); o card avisa e desabilita (pedido do dono).
  const enviadoCadSet = useMemo(() => new Set(((modelosDb ?? []) as any[]).filter((m) => m.enviado_cad).map((m) => m.id as string)), [modelosDb]);

  // IDs dos modelos reais do plano → base das buscas por-modelo (MO por serviço etc.).
  const modeloIdsDb = useMemo(() => [...new Set(((modelosDb ?? []) as any[]).map((m) => m.id as string))].sort(), [modelosDb]);
  // versão do modelo (Planejamento de Produto) → badge no card p/ ver repetição (item 14)
  const versaoMap = useMemo(() => Object.fromEntries(((modelosDb ?? []) as any[]).map((m) => [m.id as string, Number(m.versao) || null])) as Record<string, number | null>, [modelosDb]);
  // origem do modelo (`interno`|`revenda`) → badge "Revenda" no card + esconde controles de
  // tecido (item do refino, ago/2026): espelho de revenda ocupa a vaga do bucket (correto, NÃO
  // filtrar), mas não há tecido a planejar nele. Mesmo padrão de `versaoMap` (map derivado à
  // parte, sem tocar o slot/engine/merge — só apresentação no ModelCard).
  const origemMap = useMemo(() => Object.fromEntries(((modelosDb ?? []) as any[]).map((m) => [m.id as string, (m.origem as string | null) ?? null])) as Record<string, string | null>, [modelosDb]);

  // FASE do modelo no fluxo (item 10) — 1 query BATCH por coleção (RPC plan_tecido_fases), NÃO N por
  // card. A RPC deriva a etapa MAIS avançada verdadeira (mesma ordem do _dashboard_producao_core, régua
  // do dono: CQ colapsa em PCP, direcionamento = 'separado'). enviado_cad/lancado/CQ/serviço/direc.
  // mudam FORA do plano → refetcha ao voltar o foco (como o modelos query).
  const { data: fasesMap = {} } = useQuery({
    queryKey: ["plan-tecido-fases", colecaoId],
    refetchOnWindowFocus: true,
    queryFn: async () =>
      (((await supabase.rpc("plan_tecido_fases" as any, { _colecao_id: colecaoId })).data ?? {}) as Record<string, { fase: string; detalhe: string | null }>),
  });
  // Colunas do kanban do tenant (ORDENADAS) → p/ resolver o `status_desenvolvimento` da fase 'dev' no
  // RÓTULO da coluna que a LOJA VÊ. Fonte única = normalizeKanbanStatuses (a MESMA do board). Guardamos
  // a lista ordenada (não só o mapa) porque `labelColunaKanban` precisa da 1ª coluna: NULL (recém-chegado)
  // e chave órfã (coluna removida) caem na 1ª coluna — exatamente como o board os exibe (senão o badge
  // dizia o genérico "Desenvolvimento" enquanto o card aparece em "Em Modelagem"/"Desenvolvimento de
  // Produto"; bug reportado pelo dono — o badge não descrevia QUAL kanban).
  const { data: kanbanCols = [] } = useQuery({
    queryKey: ["plan-tecido-kanban-cols"],
    queryFn: async () => {
      const raw = ((await supabase.from("tenant_config").select("status_kanban").maybeSingle()).data as any)?.status_kanban;
      return normalizeKanbanStatuses(raw);
    },
  });
  // {label, tone} do badge de fase por modelo — mostra a fase MAIS avançada verdadeira (a RPC já
  // escolhe). null = sem modelo / sem fase (não renderiza badge). Tons §Q (StatusBadge).
  const faseInfo = (modeloId: string): { label: string; tone: "success" | "warning" | "info" | "neutral" } | null => {
    const f = fasesMap[modeloId];
    if (!f) return null;
    switch (f.fase) {
      case "lancado":        return { label: "Lançado", tone: "success" };
      case "direcionamento": return { label: "Direcionamento", tone: "info" };
      case "pcp":            return { label: f.detalhe ? `PCP — ${f.detalhe}` : "PCP", tone: "warning" };
      case "explosao":       return { label: "Explosão", tone: "info" };
      case "dev":            return { label: labelColunaKanban(f.detalhe, kanbanCols), tone: "info" };
      case "planejamento":   return { label: "Em planejamento", tone: "neutral" };
      default:               return null;
    }
  };

  // MO por serviço por modelo — READ-ONLY, derivada de `modelo_mo_resumo` (fonte ÚNICA da MO, a
  // mesma do Desenvolvimento). `estado` (aprovada|pendente|reprovada|sem_servico) pinta o badge;
  // `total` (Σ modelo_servico_mo.valor) é a MO prevista que alimenta o custo do card. A aprovação
  // é POR SERVIÇO no Planejamento (MaoObraEditor); o Plan. Tecido NÃO aprova. A RPC mascara p/ quem
  // não vê custos ({} → estado undefined + total null → sem badge, MO 0 — não vaza valor).
  const { data: moResumoMap = {} } = useQuery({
    queryKey: ["plan-tecido-mo-resumo", modeloIdsDb],
    enabled: modeloIdsDb.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("modelo_mo_resumo" as any, { _ids: modeloIdsDb });
      if (error) throw error;
      return (data ?? {}) as Record<string, { estado: string; total: number | null; total_aprovado: number | null }>;
    },
  });
  const maoObraEstadoDe = (modeloId: string): string | undefined => moResumoMap[modeloId]?.estado;
  const maoObraPorServicoDe = (modeloId: string): number | null => {
    const t = moResumoMap[modeloId]?.total;
    return t == null ? null : Number(t);
  };

  // Fontes do merge: seed (OTB) e modelosReais (modelos+BOM+consumo+subcoleção). O react-query dá
  // referência ESTÁVEL quando o dado não muda, então comparar referência distingue "mudou de verdade"
  // (modelo/consumo/subcoleção/OTB novos → re-mergeia; itens 3/6/7/13) de "só salvei o plano" (só o
  // `salvo` refetcha, seed/modelosReais iguais → NÃO re-mergeia, senão reverteria p/ o seed e o
  // auto-upgrade de cor re-sujaria = loop de "alterações não salvas"; item 12).
  const srcRef = useRef<{ seed: unknown; models: unknown } | null>(null);

  // Colab: `colecoes.plan_rev` espelhado num ref (lido de forma síncrona no save/retry).
  useEffect(() => { if (colecao) revRef.current = (colecao as any).plan_rev ?? null; }, [colecao]);

  useEffect(() => {
    if (!seed || salvo === undefined || modelosDb === undefined) return;
    const fonteMudou = !srcRef.current || srcRef.current.seed !== seed || srcRef.current.models !== modelosReais;
    const salvoNovo = salvo !== salvoConsumidoRef.current;

    if (dirty) {
      // Não sobrescreve a edição em andamento. OTB/BOM mudando enquanto edito segue FORA do
      // escopo do colab (como antes — a reseed correspondente fica pausada até `dirty` cair).
      if (fonteMudou) return;
      if (!salvoNovo) return;
      salvoConsumidoRef.current = salvo;
      // `salvo` mudou por um SAVE ALHEIO (plan_rev bumpou) → merge 3-vias POR SLOT em vez de
      // simplesmente ignorar (era o comportamento pré-colab: qualquer refetch com dirty=true
      // era descartado em silêncio).
      if (!planBaseRef.current || !arvore) return; // segurança: não deveria ficar dirty sem base
      const fresh = computeFreshArvore(seed, modelosReais, salvo, modelosDb as any[]);
      const result = mergeArvorePorSlot({ base: planBaseRef.current, draft: arvore, fresh, touchedIds: touchedSlotIdsRef.current });
      planBaseRef.current = fresh;
      if (result.atualizados > 0 || result.conflitos.length > 0) setArvore(result.arvore);
      conflitosSlotRef.current = result.conflitos;
      setConflitosSlot(result.conflitos);
      setUltimoMergeSlot({ atualizados: result.atualizados, conflitos: result.conflitos });
      return;
    }

    // Não-dirty: recarrega sempre que a fonte (OTB/BOM) OU o `salvo` mudou — inclui agora o
    // salvo-só-mudou (alguém salvou enquanto eu olhava sem editar; antes do colab isso era
    // ignorado). Reprocessar o eco do MEU PRÓPRIO save aqui é seguro/idempotente (dirty já caiu
    // antes do refetch resolver) e mantém `planBaseRef`/conflitos em dia.
    if (arvore !== null && !fonteMudou && !salvoNovo) return;
    salvoConsumidoRef.current = salvo;
    srcRef.current = { seed, models: modelosReais };
    const merged = computeFreshArvore(seed, modelosReais, salvo, modelosDb as any[]);
    planBaseRef.current = merged;
    touchedSlotIdsRef.current = new Set();
    conflitosSlotRef.current = [];
    setConflitosSlot([]);
    setUltimoMergeSlot(null);
    setArvore(merged);
  }, [seed, salvo, modelosReais, modelosDb, dirty, arvore]);

  // Presença + reage ao UPDATE em `colecoes` (QUALQUER save da árvore bumpa plan_rev — Task 1).
  // campoFocado OMITIDO de propósito: a árvore é grande demais (subcoleção→linha→slot→material)
  // p/ presença por campo valer a pena nesta adoção; os chips do banner bastam ("Fulano está aqui").
  const { presentes } = useColabRegistro({
    canal: colecaoId ? `colab:plan:${colecaoId}` : null,
    tabela: "colecoes",
    registroId: colecaoId,
    onMudancaServidor: () => {
      qc.invalidateQueries({ queryKey: ["plan-tecido-arvore", colecaoId] });
      qc.invalidateQueries({ queryKey: ["plan-tecido-colecao", colecaoId] });
    },
  });

  // Resolve um conflito de SLOT: "usar o novo" aplica a versão do servidor (ou remove o slot, se
  // ele sumiu de lá) e tira o id do `touched` (senão o próximo merge o trataria como editado por
  // mim de novo); "manter meu" só descarta o aviso — o valor local prevalece e SEGUE touched.
  const resolverConflitoSlot = (c: Conflito, useDele: boolean) => {
    const id = c.path.slice("linha:".length);
    if (useDele) {
      setArvore((prev) => {
        if (!prev) return prev;
        const next = structuredClone(prev) as PtArvore;
        for (const sub of next.subcolecoes) for (const ln of sub.linhas) {
          const i = ln.slots.findIndex((s) => s.id === id);
          if (i < 0) continue;
          if (c.dele) ln.slots[i] = c.dele as PtSlot; else ln.slots.splice(i, 1);
        }
        return next;
      });
      touchedSlotIdsRef.current.delete(id);
    }
    setConflitosSlot((prev) => { const next = prev.filter((x) => x.path !== c.path); conflitosSlotRef.current = next; return next; });
    setUltimoMergeSlot((prev) => {
      if (!prev) return prev;
      const restantes = prev.conflitos.filter((x) => x.path !== c.path);
      if (restantes.length === 0 && prev.atualizados === 0) return null;
      return { ...prev, conflitos: restantes };
    });
  };
  const resolverSlotPorPath = (path: string, escolha: "meu" | "dele") => {
    const c = conflitosSlot.find((x) => x.path === path);
    if (c) resolverConflitoSlot(c, escolha === "dele");
  };
  const rotuloDoConflitoSlot = (path: string): string => rotuloConflitoSlot(conflitosSlot.find((x) => x.path === path));

  // Invalida o BOM VIVO da coleção (é a fonte da EXIBIÇÃO do card via merge) + caches do Dev, p/ o
  // resultado do auto-aplicar aparecer na hora (senão o card seguiria mostrando o BOM antigo).
  const invalidarBomVivo = (modeloIds: string[]) => {
    void qc.invalidateQueries({ queryKey: ["plan-tecido-modelos", colecaoId] });
    void qc.invalidateQueries({ queryKey: ["plan-tecido-vinculos", colecaoId] });
    // O auto-aplicar (aplicar_ao_modelo) SINCRONIZA os hints de slot em modelo_tecido_oc_links, que
    // É fonte de COBERTURA da prévia (has_card=true). Como esse write acontece DEPOIS da invalidação
    // da prévia no salvarMut.onSuccess (fire-and-forget), a prévia precisa ser re-invalidada AQUI —
    // ao fim dos applies — senão o "a comprar" fica defasado até o refoco da janela (suspeita "a" do
    // bug #2: a invalidação da prévia dispara ANTES dos aplicar_ao_modelo terminarem).
    void qc.invalidateQueries({ queryKey: ["plan-tecido-previa", colecaoId] });
    for (const mid of new Set(modeloIds)) {
      void qc.invalidateQueries({ queryKey: ["modelo-detail", mid] });
      void qc.invalidateQueries({ queryKey: ["modelo-tecidos", mid] });
      void qc.invalidateQueries({ queryKey: ["modelo-grades", mid] });
    }
  };

  // Espelha 1 slot pré-explosão no BOM do modelo — MESMA RPC do botão "Aplicar ao modelo".
  const aplicarSlotNoModelo = async (slotId: string, materiais: unknown, confirmar = false) => {
    const { error } = await supabase.rpc("plan_tecido_aplicar_ao_modelo" as any, {
      _slot_id: slotId, _materiais: materiais, ...(confirmar ? { _confirmar_sobrescrita: true } : {}),
    });
    return (error as any) ?? null;
  };

  // AUTO-APLICAR (regra do dono, bug #9): logo após um save bem-sucedido, espelha no BOM os slots que
  // EU editei nesta sessão (`touchedIds`) cujo modelo NÃO está enviado à Explosão (nem lançado/revenda).
  // Assim o BOM vivo — fonte da EXIBIÇÃO do card (mergeArvore) — passa a conter a cor/pç/consumo salvos
  // e o reload deixa de "reverter". Pós-explosão fica de fora (trava, item 2). Esvaziar cores/zerar grade
  // dispara a guarda vazio-sobre-preenchido (P0001) → junta em `pendentes` → diálogo de confirmação.
  // Fonte única preservada: o BOM do Dev continua sendo a fonte; o card só passa a ESCREVER nele.
  async function autoAplicarDirty(touchedIds: Set<string>) {
    const arv = arvoreLiveRef.current;
    if (!arv || touchedIds.size === 0) return;
    const alvos: { slotId: string; modeloId: string; nome: string; materiais: unknown }[] = [];
    for (const sub of arv.subcolecoes)
      for (const ln of sub.linhas)
        for (const slot of ln.slots) {
          if (!slot.id || !slot.modelo_id || !touchedIds.has(slot.id)) continue;
          if (lancadoSet.has(slot.modelo_id)) continue;                    // lançado: BOM imutável
          if (enviadoCadSet.has(slot.modelo_id)) continue;                 // pós-explosão: card NÃO toca o BOM
          if ((origemMap[slot.modelo_id] ?? null) === "revenda") continue; // revenda: sem BOM de tecido
          if (!slot.materiais.some((m) => m.artigo_id)) continue;          // sem tecido escolhido: nada a gravar
          alvos.push({ slotId: slot.id, modeloId: slot.modelo_id, nome: slot.nome ?? slot.ref ?? "Modelo", materiais: buildMateriaisAplicar(slot) });
        }
    if (alvos.length === 0) return;
    const pendentes: { slotId: string; nome: string; materiais: unknown }[] = [];
    for (const a of alvos) {
      const err = await aplicarSlotNoModelo(a.slotId, a.materiais);
      if (err) {
        if (err.hint === "plan_tecido_sobrescrita") pendentes.push({ slotId: a.slotId, nome: a.nome, materiais: a.materiais });
        else toast.error(mensagemErro(err, `Não foi possível espelhar "${a.nome}" no modelo.`));
      }
    }
    invalidarBomVivo(alvos.map((a) => a.modeloId));
    if (pendentes.length > 0) setSobrescritaPendentes(pendentes);
  }

  // Confirma a sobrescrita (esvaziar/zerar) dos slots pendentes → re-aplica com _confirmar_sobrescrita.
  const confirmarSobrescrita = async () => {
    const pend = sobrescritaPendentes ?? [];
    setSobrescritaPendentes(null);
    for (const p of pend) {
      const err = await aplicarSlotNoModelo(p.slotId, p.materiais, true);
      if (err) toast.error(mensagemErro(err, `Não foi possível aplicar "${p.nome}".`));
    }
    invalidarBomVivo([]);
  };

  const salvarMut = useMutation({
    mutationFn: async () => {
      // Colab: com conflitos de slot pendentes na tela, o save NÃO pode passar — mesmo que
      // `_rev_base` já bata (o retry do P0409, abaixo, avança `revRef` p/ QUALQUER resultado de
      // merge, inclusive quando sobra conflito). O usuário resolve ("manter meu"/"usar o novo")
      // em cada slot destacado no banner antes de salvar de novo (mesmo padrão do OC Tecido).
      if (conflitosSlotRef.current.length > 0)
        throw new Error("Resolva os conflitos de slot listados no aviso no topo antes de salvar.");
      // Fix "lane congelada" (ago/2026): normaliza categoria_tecido_id=NULL no PAYLOAD (nunca no
      // estado local — a tela não deve "piscar" a lane) quando ela bate com a auto do Tecido 1. Um
      // slot salvo com NULL auto-preenche do vivo no próximo merge (comportamento já existente) →
      // a lane passa a SEGUIR o cadastro; arraste manual pra lane DIFERENTE da auto persiste normal.
      const arvorePayload = normalizarCategoriasAuto(arvore!, (id) => artigoMap.get(id)?.categoria_tecido_id ?? null);
      const { error } = await supabase.rpc("salvar_plan_tecido" as any, {
        _colecao_id: colecaoId, _arvore: arvorePayload, _rev_base: revRef.current,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      // CAPTURA os slots que editei ANTES de zerar o touched — o auto-aplicar (regra do dono, bug #9)
      // usa exatamente esse conjunto (dirty por card; NUNCA a coleção inteira em massa).
      const touched = new Set(touchedSlotIdsRef.current);
      setDirty(false);
      // O que acabei de salvar já É a base "servidor" — evita que o eco do Realtime (meu próprio
      // UPDATE) apareça como conflito ou "alguém atualizou N slots" no banner.
      planBaseRef.current = arvore;
      touchedSlotIdsRef.current = new Set();
      conflitosSlotRef.current = [];
      setConflitosSlot([]);
      setUltimoMergeSlot(null);
      toast.success("Planejamento de tecido salvo.");
      qc.invalidateQueries({ queryKey: ["plan-tecido-arvore", colecaoId] });
      qc.invalidateQueries({ queryKey: ["plan-tecido-colecao", colecaoId] }); // plan_rev novo p/ o próximo save
      qc.invalidateQueries({ queryKey: ["plan-tecido-previa", colecaoId] }); // "a comprar" exato do Resumo
      // Espelha as edições pré-explosão no BOM vivo (fim do "reverteu"). Fire-and-forget: o save já
      // committou; o auto-aplicar refaz o BOM vivo e invalida a query que alimenta a exibição do card.
      void autoAplicarDirty(touched);
    },
    onError: async (e: any) => {
      // Colab: conflito de versão (P0409) — outra pessoa salvou entre a última carga e agora.
      // Busca o estado novo, faz o merge 3-vias por slot AQUI MESMO (síncrono, ver precedente do
      // piloto OC Tecido) e, se não sobrou conflito de verdade, retenta salvar 1 vez com o rev
      // atualizado. Se sobrou, para e deixa o usuário resolver no banner.
      if (e?.code === "P0409" && !retryRef.current && seed && modelosDb) {
        retryRef.current = true;
        await qc.refetchQueries({ queryKey: ["plan-tecido-arvore", colecaoId] });
        await qc.refetchQueries({ queryKey: ["plan-tecido-colecao", colecaoId] });
        const freshSalvo = qc.getQueryData<PtArvore | null>(["plan-tecido-arvore", colecaoId]);
        const freshColecao = qc.getQueryData<any>(["plan-tecido-colecao", colecaoId]);
        const draft = arvoreLiveRef.current; // espelho síncrono: nada editado durante o await se perde
        if (freshSalvo !== undefined && draft) {
          const fresh = computeFreshArvore(seed, modelosReais, freshSalvo ?? null, modelosDb as any[]);
          const base = planBaseRef.current ?? fresh;
          const result = mergeArvorePorSlot({ base, draft, fresh, touchedIds: touchedSlotIdsRef.current });
          planBaseRef.current = fresh;
          salvoConsumidoRef.current = freshSalvo; // o effect não reprocessa o mesmo salvo em dobro
          revRef.current = (freshColecao as any)?.plan_rev ?? revRef.current;
          if (result.atualizados > 0 || result.conflitos.length > 0) setArvore(result.arvore);
          conflitosSlotRef.current = result.conflitos;
          setConflitosSlot(result.conflitos);
          setUltimoMergeSlot({ atualizados: result.atualizados, conflitos: result.conflitos });
          if (result.conflitos.length === 0) {
            salvarMut.mutate(undefined, { onSettled: () => { retryRef.current = false; } });
            return;
          }
        }
        retryRef.current = false;
        toast.error(mensagemErro(e, "Não foi possível salvar."));
        return;
      }
      toast.error(mensagemErro(e, "Não foi possível salvar."));
    },
  });

  // garante o plano salvo antes de uma ação de servidor (auto-salva se houver mudança pendente)
  const ensureSaved = async (): Promise<boolean> => {
    if (!dirty) return true;
    try { await salvarMut.mutateAsync(); return true; }
    catch { return false; }
  };

  // Guarda por-subcoleção (ago/2026): "Descartar" ao trocar/sair de subcoleção precisa REVERTER
  // a árvore ao último SALVO antes de navegar. Diferente do Produto Acabado (sem colab), aqui NÃO
  // dá pra simplesmente refetchar `["plan-tecido-arvore", colecaoId]` — a `arvore` em tela não é
  // o dado cru do servidor, é `mergeArvore(semearComModelos(seed), salvo)` (ver `computeFreshArvore`
  // acima); refazer esse merge do zero recomputaria a MESMA coisa que já está em `planBaseRef.current`
  // (mantido em dia pelo effect de reconciliação — L718-757 — a cada `salvo`/seed novo enquanto
  // limpo, e no `onSuccess` do save). `planBaseRef.current` É o "último salvo" já resolvido: reusar
  // ele evita um refetch supérfluo e, mais importante, evita mexer em `revRef`/`plan_rev` (que só
  // deve avançar por um save de verdade ou pela reconciliação P0409 — reverter não é nenhum dos
  // dois). Limpa também `touchedSlotIdsRef`/conflitos de slot pendentes (eram do trecho descartado).
  // No-op quando limpo (`planBaseRef.current` já é igual à `arvore` atual nesse caso).
  const reverterArvore = useCallback(() => {
    if (!planBaseRef.current) return;
    setArvore(planBaseRef.current);
    setDirty(false);
    touchedSlotIdsRef.current = new Set();
    conflitosSlotRef.current = [];
    setConflitosSlot([]);
    setUltimoMergeSlot(null);
  }, []);

  // Colab: rastreia os slots que EU editei (diff por id, mesmo padrão do setItemsTracked do OC
  // Tecido) — `patch` é o ÚNICO funil de escrita local (drag, aplicar em massa, categoria,
  // onChange do card), então instrumentar aqui cobre toda edição sem mudar a assinatura recebida
  // pelos filhos.
  const patch = (next: PtArvore) => {
    if (arvore) {
      const prevById = new Map<string, PtSlot>();
      for (const sub of arvore.subcolecoes) for (const ln of sub.linhas) for (const s of ln.slots) if (s.id) prevById.set(s.id, s);
      for (const sub of next.subcolecoes) for (const ln of sub.linhas) for (const s of ln.slots) {
        if (!s.id) continue;
        const p = prevById.get(s.id);
        if (!p || JSON.stringify(p) !== JSON.stringify(s)) touchedSlotIdsRef.current.add(s.id);
      }
    }
    setArvore(next);
    setDirty(true);
  };

  // solta o card numa lane → muda a categoria de tecido (lane:) OU o mix (mixlane:) do slot.
  // id do drag = chave do slot. Mix: também grava modelos.mix_id p/ modelo real (decisão 9).
  const handleDragEnd = (e: DragEndEvent) => {
    setDragId(null);
    const { active, over } = e;
    if (!over || !arvore) return;
    const chave = String(active.id);
    const laneId = String(over.id);
    const ehMix = laneId.startsWith("mixlane:");
    const alvo = laneId === "lane:__sem__" || laneId === "mixlane:__sem__"
      ? null
      : ehMix ? laneId.slice(8) : laneId.startsWith("lane:") ? laneId.slice(5) : undefined;
    if (alvo === undefined) return;
    const sub = arvore.subcolecoes[subAtiva];
    for (let li = 0; li < sub.linhas.length; li++) {
      const slots = sub.linhas[li].slots;
      for (let sli = 0; sli < slots.length; sli++) {
        if (chaveSlot(slots[sli].id, subAtiva, li, sli) !== chave) continue;
        const slot = slots[sli];
        if (ehMix) {
          if ((slot.mix_id ?? null) === alvo) return;          // já está nesse mix
          const next = structuredClone(arvore) as PtArvore;
          next.subcolecoes[subAtiva].linhas[li].slots[sli].mix_id = alvo;
          patch(next);
          if (slot.modelo_id) {
            void supabase.from("modelos").update({ mix_id: alvo } as any).in("id", [slot.modelo_id]).then(({ error }) => {
              if (error) { toast.error(mensagemErro(error, "Erro ao mover.")); return; }
              qc.invalidateQueries({ queryKey: ["modelos-planejamento"] });
              qc.invalidateQueries({ queryKey: ["colecao-mixes-nomes"] });
            });
          }
          return;
        }
        if ((slot.categoria_tecido_id ?? null) === alvo) return; // já está nessa lane
        const next = structuredClone(arvore) as PtArvore;
        next.subcolecoes[subAtiva].linhas[li].slots[sli].categoria_tecido_id = alvo;
        patch(next);
        return;
      }
    }
  };

  // Aplica um material (Tecido 1) em todos os slots selecionados (estado local)
  function aplicarTecidoEmMassa(material: PtMaterial) {
    if (!arvore) return;
    const n = selecao.size;
    const next = structuredClone(arvore) as PtArvore;
    let movidos = 0;
    for (let si = 0; si < next.subcolecoes.length; si++) {
      for (let li = 0; li < next.subcolecoes[si].linhas.length; li++) {
        for (let sli = 0; sli < next.subcolecoes[si].linhas[li].slots.length; sli++) {
          const slot = next.subcolecoes[si].linhas[li].slots[sli];
          const chave = chaveSlot(slot.id, si, li, sli);
          if (!selecao.has(chave)) continue;
          // Remove o material do MESMO papel (Tecido 1 / Forro 1) e insere o novo
          const resto = slot.materiais.filter((m) => !(m.tipo === material.tipo && m.numero === 1));
          const editado: PtSlot = {
            ...slot,
            materiais: material.tipo === "tecido" ? [material, ...resto] : [...resto, material],
          };
          // G2: Tecido 1 (material.tipo==="tecido") pode mover o card de família — em massa, silencioso
          // (toast único ao fim); a lane fica garantida na sub do PRÓPRIO slot (nem sempre subAtiva).
          const finalSlot = material.tipo === "tecido"
            ? aplicarMoveFamilia(next.subcolecoes[si], editado, slot, true)
            : editado;
          if (finalSlot !== editado) movidos++;
          next.subcolecoes[si].linhas[li].slots[sli] = finalSlot;
        }
      }
    }
    patch(next);
    setSelecao(new Set());
    setFormTipo(null);
    toast.success(`${material.tipo === "forro" ? "Forro" : "Tecido"} aplicado a ${n} slot(s).${movidos > 0 ? ` ${movidos} card(s) movido(s) de família.` : ""}`);
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

  // Núcleo: grava mix_id nos slots que casam `matches` (por posição). O mix vive em DOIS lugares
  // (decisão 9): slot.mix_id na árvore (persiste no save) SEMPRE; p/ modelo REAL, também
  // modelos.mix_id na hora (update direto), pro Plan. Produto ver já. `toast` opcional (silencioso
  // quando chamado pelo picker de vagas do EditarMixDialog).
  async function aplicarMixCore(matches: (slot: PtSlot, si: number, li: number, sli: number) => boolean, mixId: string | null, comToast = true) {
    if (!arvore) return;
    const next = structuredClone(arvore) as PtArvore;
    const modeloIds: string[] = [];
    for (let si = 0; si < next.subcolecoes.length; si++)
      for (let li = 0; li < next.subcolecoes[si].linhas.length; li++)
        for (let sli = 0; sli < next.subcolecoes[si].linhas[li].slots.length; sli++) {
          const slot = next.subcolecoes[si].linhas[li].slots[sli];
          if (!matches(slot, si, li, sli)) continue;
          slot.mix_id = mixId;
          if (slot.modelo_id) modeloIds.push(slot.modelo_id);
        }
    patch(next);
    if (modeloIds.length > 0) {
      const { error } = await supabase.from("modelos").update({ mix_id: mixId } as any).in("id", modeloIds);
      if (error) { toast.error(mensagemErro(error, "Erro ao mover modelos.")); return; }
      qc.invalidateQueries({ queryKey: ["modelos-planejamento"] });
      qc.invalidateQueries({ queryKey: ["colecao-mixes-nomes"] });
    }
    if (comToast) toast.success(mixId ? "Movido para o mix." : "Removido do mix.");
  }
  // Barra de seleção → mover a seleção.
  async function aplicarMixEmMassa(mixId: string | null) {
    await aplicarMixCore((slot, si, li, sli) => selecao.has(chaveSlot(slot.id, si, li, sli)), mixId);
    setSelecao(new Set());
    setMixMassaOpen(false);
  }
  // Picker de VAGAS do EditarMixDialog → mover vagas por slot.id (sem tocar a seleção).
  async function aplicarMixEmSlots(slotIds: string[], mixId: string | null) {
    const set = new Set(slotIds);
    await aplicarMixCore((slot) => !!slot.id && set.has(slot.id), mixId, false);
  }

  // Predicado equivalente ao antigo `podeCriarCard` do ModelCard (removido de lá — G6, ação em
  // massa): slot ainda não ligado a um modelo, com nome, categoria (produto ou tecido) ou tecido
  // escolhido. Mesma guarda do "Criar card" individual (fallback de nome fica a cargo do servidor).
  const podeCriarCard = (slot: PtSlot): boolean =>
    !slot.modelo_id &&
    (!!slot.nome || !!slot.categoria_id || !!slot.categoria_tecido_id || slot.materiais.some((m) => m.artigo_id));

  // Traduz a seleção (chaves) → slots da árvore inteira (mesmo padrão de aplicarCategoriaEmMassa),
  // pareado com subcolecao_id de cada slot (necessário no payload de criação do card).
  const slotsDaSelecao = (): { slot: PtSlot; subcolecaoId: string | null }[] => {
    if (!arvore) return [];
    const out: { slot: PtSlot; subcolecaoId: string | null }[] = [];
    for (let si = 0; si < arvore.subcolecoes.length; si++) {
      const sub = arvore.subcolecoes[si];
      for (let li = 0; li < sub.linhas.length; li++)
        for (let sli = 0; sli < sub.linhas[li].slots.length; sli++) {
          const slot = sub.linhas[li].slots[sli];
          if (selecao.has(chaveSlot(slot.id, si, li, sli))) out.push({ slot, subcolecaoId: sub.subcolecao_id ?? null });
        }
    }
    return out;
  };

  // G6: "Criar cards" na barra de seleção — separa em 3 baldes: elegíveis (podeCriarCard,
  // !modelo_id), já materializados (modelo_id != null) e sem dados suficientes (!modelo_id mas
  // falha podeCriarCard — sem nome/categoria/tecido). Os 3 juntos cobrem a seleção inteira; o
  // 3º balde só entra na contagem do aviso (não bloqueia os elegíveis).
  function handleCriarCardsClick() {
    const itens = slotsDaSelecao();
    const elegiveis = itens.filter((it) => podeCriarCard(it.slot)).map((it) => it.slot.id!).filter(Boolean);
    const pulados = itens.filter((it) => !!it.slot.modelo_id).map((it) => it.slot.nome ?? it.slot.ref ?? "Modelo");
    const semDados = itens.filter((it) => !it.slot.modelo_id && !podeCriarCard(it.slot)).length;
    if (elegiveis.length === 0 && pulados.length === 0) {
      toast.error("Nenhum dos selecionados tem dados suficientes (nome, categoria ou tecido) para criar o card.");
      return;
    }
    setCriarCardsConfirm({ elegiveis, pulados, semDados });
  }

  // Confirmado: monta o payload em lote (mesmo shape que o antigo `criarCard` de 1 montava) →
  // ensureSaved() → RPC batch → ESPELHA os modelo_id retornados no draft via `patch` (senão o
  // próximo save manda modelo_id:null do draft velho e ZERA a materialização recém-criada).
  async function confirmarCriarCards() {
    const conf = criarCardsConfirm;
    setCriarCardsConfirm(null);
    if (!conf || conf.elegiveis.length === 0 || !arvore) { setSelecao(new Set()); return; }
    setCriandoCards(true);
    try {
      if (!(await ensureSaved())) return;
      const itens = slotsDaSelecao().filter((it) => it.slot.id && conf.elegiveis.includes(it.slot.id));
      const _slots = itens.map(({ slot, subcolecaoId }) => ({
        nome: slot.nome ?? null, ref: slot.ref ?? null, slot_id: slot.id ?? null,
        linha_id: slot.linha_id ?? null, categoria_id: slot.categoria_id ?? null,
        subcolecao_id: subcolecaoId,
        preco_venda: slot.preco_venda ?? null,
        custo_terceirizados_previsto: 0, // inerte: a MO nasce por-serviço no Planejamento (modelo_servico_mo)
        custo_simulado: slot.custo_simulado ?? {},
        referencia_paths: slot.referencia_paths ?? [],
        materiais: buildMateriaisAplicar(slot),
      }));
      const { data, error } = await supabase.rpc("plan_tecido_criar_cards" as any, { _colecao_id: colecaoId, _slots });
      if (error) throw error;
      const criados = (data ?? []) as { slot_id: string; modelo_id: string }[];
      if (criados.length > 0) {
        // Espelha os modelo_id no draft ATUAL (pode ter avançado durante o await) via `patch` — funil
        // único de escrita local (marca touched); sem isso o próximo save regrediria modelo_id p/ null.
        const arv = arvoreLiveRef.current;
        if (arv) {
          const next = structuredClone(arv) as PtArvore;
          const porSlot = new Map(criados.map((c) => [c.slot_id, c.modelo_id]));
          for (const sub of next.subcolecoes) for (const ln of sub.linhas) for (const s of ln.slots) {
            const mid = s.id ? porSlot.get(s.id) : undefined;
            if (mid) { s.modelo_id = mid; s.referencia_paths = []; } // migrou p/ modelos.fotos_referencia (RPC já migra no servidor)
          }
          patch(next);
        }
      }
      invalidarModeloLote(criados.map((c) => c.modelo_id));
      toast.success(`${criados.length} criado(s)${conf.pulados.length > 0 ? ` · ${conf.pulados.length} pulado(s) (já materializado)` : ""}${conf.semDados > 0 ? ` · ${conf.semDados} sem dados (fora)` : ""}.`);
    } catch (e) {
      toast.error(mensagemErro(e, "Não foi possível criar os cards."));
    } finally {
      setCriandoCards(false);
      setSelecao(new Set());
    }
  }

  // Mesmas invalidações do ModelCard.invalidarModelo, agora em lote (N modelo_ids).
  const invalidarModeloLote = (modeloIds: string[]) => {
    void qc.invalidateQueries({ queryKey: ["modelo"] });
    void qc.invalidateQueries({ queryKey: ["modelos-desenvolvimento"] });
    void qc.invalidateQueries({ queryKey: ["otb-orcamento"] });
    void qc.invalidateQueries({ queryKey: ["dash-estoque"] });
    for (const mid of new Set(modeloIds)) {
      void qc.invalidateQueries({ queryKey: ["modelo-detail", mid] });
      void qc.invalidateQueries({ queryKey: ["modelo-tecidos", mid] });
      void qc.invalidateQueries({ queryKey: ["modelo-grades", mid] });
      void qc.invalidateQueries({ queryKey: ["modelo-tecido-oc-links", mid] });
      void qc.invalidateQueries({ queryKey: ["modelo-precos-congelado", mid] });
      void qc.invalidateQueries({ queryKey: ["dev-cad-precos-congelado", mid] });
    }
    void qc.invalidateQueries({ queryKey: ["plan-tecido-vinculos", colecaoId] });
    void qc.invalidateQueries({ queryKey: ["plan-tecido-previa", colecaoId] });
  };

  // G5: "Fazer pedido" na barra de seleção — separa compráveis × já-comprados (mesma fonte do
  // carrinho: slotOcMap ∪ vinculosMap por slot/modelo). Comprados NÃO bloqueiam — ficam fora do
  // pedido, com aviso.
  function handleFazerPedidoSelecaoClick() {
    const itens = slotsDaSelecao();
    const comprado = (slot: PtSlot): boolean =>
      ((slot.id ? slotOcMap[slot.id] : undefined)?.length ?? 0) > 0 ||
      ((slot.modelo_id ? vinculosMap[slot.modelo_id] : undefined)?.length ?? 0) > 0;
    const compraveis = itens.filter((it) => !comprado(it.slot)).map((it) => it.slot.id!).filter(Boolean);
    const comprados = itens.filter((it) => comprado(it.slot)).map((it) => it.slot.nome ?? it.slot.ref ?? "Modelo");
    if (compraveis.length === 0) {
      toast.error("Todos os selecionados já foram comprados.");
      return;
    }
    if (comprados.length > 0) { setPedidoSelecaoConfirm({ compraveis, comprados }); return; }
    void prosseguirPedidoSelecao(compraveis);
  }

  // ensureSaved() → prévia filtrada pelos slots compráveis → abre o wizard com `_slot_ids`.
  async function prosseguirPedidoSelecao(slotIds: string[]) {
    setPedidoSelecaoConfirm(null);
    setPreparandoPedidoSelecao(true);
    try {
      if (!(await ensureSaved())) return;
      const { data, error } = await supabase.rpc("plan_tecido_previa_pedido" as any, {
        _colecao_id: colecaoId, _slot_ids: slotIds,
      });
      if (error) throw error;
      setSlotIdsPedido(slotIds);
      setPreviaData(data as PreviaRpc);
      setPreviaOpen(true);
    } catch (e) {
      toast.error(mensagemErro(e, "Não foi possível carregar a prévia do pedido."));
    } finally {
      setPreparandoPedidoSelecao(false);
      setSelecao(new Set());
    }
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
    if (catFilters.has(catId)) { const n = new Set(catFilters); n.delete(catId); setCatFilters(n); }
    patch(next);
  }

  // "Fazer pedido" da COLEÇÃO INTEIRA (que usava esta função a partir do rodapé) foi REMOVIDO —
  // pedido agora é SEMPRE por seleção (ver `handleFazerPedidoSelecaoClick`/`prosseguirPedidoSelecao`,
  // que populam os MESMOS `previaData`/`previaOpen` com `_slot_ids`).

  // status por fornecedor (empresa_id do artigo) → selos no card e na subcoleção
  const { fornecedorDe, artigoMap } = useArtigosTecido();
  // (A categorização por categoria de tecido agora é AUTOMÁTICA no seed — ver modelosReais/engine;
  // o antigo botão "Agrupar por tecido" saiu, substituído pelo popover AgrupamentoButton.)
  const matTemFornec = (m: PtMaterial) => !!m.artigo_id && !!fornecedorDe(m.artigo_id);
  const slotFornec = (slot: PtSlot) => ({ com: slot.materiais.filter(matTemFornec).length, total: slot.materiais.length });
  const slotReady = (slot: PtSlot) => { const f = slotFornec(slot); return f.total > 0 && f.com === f.total; };

  const subAtual = arvore ? (arvore.subcolecoes[subAtiva] ?? null) : null;
  // Nome-texto da subcoleção ativa (casa com modelos.subcolecao) + mixes dela (p/ "Mover p/ mix").
  const subNomeAtiva = subAtual?.subcolecao_id ? (nameOf(subNomes, subAtual.subcolecao_id) ?? "") : "";
  const { data: mixesSub = [] } = useQuery({
    queryKey: ["colecao-mixes", colecaoId, subNomeAtiva],
    enabled: !!subNomeAtiva,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("colecao_mixes" as any).select("id, nome, ordem")
        .eq("colecao_id", colecaoId).eq("subcolecao", subNomeAtiva).order("ordem");
      if (error) throw error;
      return (data ?? []) as unknown as { id: string; nome: string; ordem: number }[];
    },
  });
  const mixNomeDe = (id: string | null | undefined) => mixesSub.find((m) => m.id === id)?.nome ?? null;

  // FIX G3-A (família vazia invisível ao reabrir): as lanes de família (incl. vazias) só
  // renderizam com `groupByCategoria=true`, mas esse estado não é persistido — reabrir uma
  // subcoleção que JÁ TEM famílias declaradas (`categorias_tecido`) voltava sempre desligado,
  // escondendo lanes (inclusive vazias) que o usuário criou numa sessão anterior. Liga
  // automaticamente quando a subcoleção atual declara ≥1 família; NUNCA desliga sozinho — o
  // usuário segue livre para desligar manualmente depois (só liga, dep = id da sub atual p/
  // não reagir a cada edição de slot e não entrar em loop).
  useEffect(() => {
    if ((subAtual?.categorias_tecido?.length ?? 0) > 0) setGroupByCategoria(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subAtual?.subcolecao_id, subAtiva]);

  // Nome do tecido (Tecido 1) de um slot — SSOT usado no seed de recolhimento E no agrupamento por nome.
  const tecidoNomeDoSlot = (slot: PtSlot): string => {
    const t = slot.materiais.find((m) => m.tipo === "tecido" && m.artigo_id);
    return (t?.artigo_nome ?? (t?.artigo_id ? artigoMap.get(t.artigo_id)?.nome ?? null : null)) ?? "Sem tecido";
  };

  // G2: aplica o move de família (F1) num slot editado (prev→next) e, se moveu, garante a lane
  // em `categorias_tecido` da sub-árvore mutável passada (mesmo padrão de aplicarCategoriaEmMassa)
  // e destrava o subgrupo por nome (chave canônica, F3) pra nascer visível/agrupado — SEM depender
  // do `nomeSeedRef` (que já pode ter travado pra essa sub antes do card mudar de nome). Retorna o
  // slot final (movido ou o `next` original) — quem chama grava no `patch`.
  const aplicarMoveFamilia = (sub: PtSub, next: PtSlot, prev?: PtSlot, silent = false): PtSlot => {
    if (!prev) return next;
    const mov = moverParaFamiliaDoTecido(prev, next, (id) => artigoMap.get(id)?.categoria_tecido_id ?? null);
    if (!mov) return next;
    sub.categorias_tecido = [...new Set([...(sub.categorias_tecido ?? []), mov.lane])];
    const nomeNovo = tecidoNomeDoSlot(mov.slot);
    setLanesRecolhidas((prevSet) => { const n = new Set(prevSet); n.delete(`${subAtiva}:nome:${nomeNovo}`); return n; });
    if (!silent) toast.success(`Card movido para a família ${catTecidoNome(mov.lane) ?? "?"}.`);
    return mov.slot;
  };

  // Grupos por NOME nascem RECOLHIDOS (pedido do dono): ao entrar no canvas de uma subcoleção com
  // agrupamento por nome, semeia os nomeKeys em `lanesRecolhidas` UMA vez por sub (ref guarda as já
  // semeadas), respeitando expand/recolher manual depois. Chave CANÔNICA só por nome (G2/F3, SEM
  // laneId) — antes semeava só `${subAtiva}:__all__:nome:${nome}` (laneId "__all__"), mas o render
  // dentro de uma lane de família lê `${subAtiva}:${cid}:nome:${nome}` — descasamento que deixava o
  // subgrupo nascer expandido/inconsistente quando o MACRO (agrupar por família) estava ligado.
  // Unificando pra `${subAtiva}:nome:${nome}` em TODOS os pontos (seed + render), o mesmo tecido
  // recolhe/expande igual em qualquer lane em que aparecer.
  const nomeSeedRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    if (view !== "canvas" || !groupByNome || !subAtual) return;
    if (nomeSeedRef.current.has(subAtiva)) return;
    nomeSeedRef.current.add(subAtiva);
    const nomes = new Set<string>();
    for (const ln of subAtual.linhas) for (const s of ln.slots) nomes.add(tecidoNomeDoSlot(s));
    if (nomes.size === 0) return;
    setLanesRecolhidas((prev) => {
      const n = new Set(prev);
      for (const nome of nomes) n.add(`${subAtiva}:nome:${nome}`);
      return n;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, groupByNome, subAtiva, subAtual]);

  // Deep-link ?sub=: quando a árvore chega, abre direto o canvas da subcoleção da URL
  // (uma vez só — depois disso a navegação interna manda). "none" = sub sem subcolecao_id.
  const subInicialAplicada = useRef(false);
  useEffect(() => {
    if (subInicialAplicada.current || !arvore || !subInicial) return;
    subInicialAplicada.current = true;
    const si = arvore.subcolecoes.findIndex((s) => (s.subcolecao_id ?? "none") === subInicial);
    if (si >= 0) { setSubAtiva(si); setView("canvas"); }
    else onSubChange?.(null); // sub não existe (excluída?) → limpa a URL
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arvore, subInicial]);

  const irParaSubcolecoes = () => { setView("subcolecoes"); onSubChange?.(null); };
  // Guarda por-subcoleção (ago/2026): sujo → mesmo AlertDialog "Descartar alterações?" de sempre;
  // "Descartar" reverte a árvore ao último salvo (`reverterArvore`) e SÓ ENTÃO navega. Limpo →
  // `requestAction` chama a navegação direto (comportamento de sempre).
  const irParaSubcolecoesGuarded = () => requestAction(() => { reverterArvore(); irParaSubcolecoes(); });
  const abrirSubGuarded = (si: number, subcolecaoId: string | null) =>
    requestAction(() => {
      reverterArvore();
      setSubAtiva(si);
      setCatFilters(new Set());
      setSelecao(new Set());
      setRecolhidos(new Set());
      setView("canvas");
      onSubChange?.(subcolecaoId ?? "none");
    });

  return (
    <Sheet open onOpenChange={(o) => { if (!o) requestClose(); }}>
      <SheetContent side="right" size="full" className="flex flex-col p-0 gap-0 max-sm:[&>button]:hidden">
        <div className="sticky top-0 z-10 flex flex-col gap-1.5 border-b bg-background p-3">
          <div className="flex items-center gap-2">
            <Breadcrumb items={[
              { label: "Estilo & Engenharia" },
              { label: "Plan. Tecido", onClick: requestClose },
              { label: colecao?.nome ?? "…", onClick: view === "canvas" ? irParaSubcolecoesGuarded : undefined },
              ...(view === "canvas" && subAtual ? [{ label: nameOf(subNomes, subAtual.subcolecao_id) ?? "Sem subcoleção" }] : []),
            ]} />
            <UnsavedIndicator show={dirty} className="ml-auto shrink-0" />
          </div>
          <ColabBanner
            presentes={presentes}
            ultimoMerge={ultimoMergeSlot}
            conflitos={conflitosSlot}
            onResolver={resolverSlotPorPath}
            rotulo={rotuloDoConflitoSlot}
          />
        </div>


        {/* Barra de seleção múltipla (só no canvas) */}
        {view === "canvas" && selecao.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b bg-amber-50 px-3 py-2 text-sm">
            <span className="font-medium">{selecao.size} selecionado(s)</span>
            {/* Hierarquia visual (dono): "Aplicar…" são ações utilitárias/secundárias (outline,
                brancas); "Criar cards"/"Fazer pedido" são as ações PRINCIPAIS da seleção (default,
                azuis) — o destaque vai pra elas. */}
            <Button size="sm" variant="outline" className="ml-auto text-xs" onClick={() => setAplicarCatOpen(true)}>Aplicar categoria</Button>
            {subNomeAtiva && (
              <Button size="sm" variant="outline" className="gap-1 text-xs" onClick={() => setMixMassaOpen(true)}><Boxes className="h-3.5 w-3.5" /> Mover p/ mix</Button>
            )}
            <Button size="sm" variant="outline" className="text-xs" onClick={() => setFormTipo("tecido")}>Aplicar tecido</Button>
            <Button size="sm" variant="outline" className="text-xs" onClick={() => setFormTipo("forro")}>Aplicar forro</Button>
            {/* G6: cria os cards no Planejamento (pula os já materializados, com aviso). */}
            <Button size="sm" variant="default" className="text-xs" disabled={criandoCards} onClick={handleCriarCardsClick}>
              {criandoCards ? "Criando…" : "Criar cards"}
            </Button>
            {/* G5: pedido só dos selecionados (pula os já comprados, com aviso). */}
            <Button size="sm" variant="default" className="text-xs" disabled={preparandoPedidoSelecao} onClick={handleFazerPedidoSelecaoClick}>
              {preparandoPedidoSelecao ? "Carregando…" : "Fazer pedido"}
            </Button>
            <Button size="sm" variant="ghost" className="text-xs text-muted-foreground" onClick={() => setSelecao(new Set())}>Limpar</Button>
          </div>
        )}

        {!arvore ? (
          <div className="p-6 text-sm text-muted-foreground">Carregando…</div>
        ) : view === "subcolecoes" ? (
          <div className="flex-1 overflow-y-auto p-4">
            <div className="mb-3 flex items-end justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-semibold tracking-tight">Subcoleções</h2>
                <p className="text-sm text-muted-foreground">Escolha uma subcoleção para planejar os tecidos por categoria.</p>
              </div>
              {(() => {
                const totalReal = arvore.subcolecoes.reduce((a, s) => a + s.linhas.reduce((b, l) => b + l.slots.filter((x) => x.modelo_id).length, 0), 0);
                const totalPlan = (seed?.buckets ?? []).reduce((a, b) => a + (Number(b.qtd) || 0), 0);
                return (
                  <div className="shrink-0 rounded-lg border bg-muted/40 px-3 py-1.5 text-right text-xs">
                    <div className="font-display text-sm font-semibold"><span className="text-foreground">{totalReal}</span>{totalPlan > 0 ? <span className="text-muted-foreground"> / {totalPlan}</span> : null} modelos</div>
                    <div className="text-[10px] text-muted-foreground">realizado{totalPlan > 0 ? " / planejado (OTB)" : ""}{totalReal > totalPlan && totalPlan > 0 ? ` · +${totalReal - totalPlan} acima do plano` : ""}</div>
                  </div>
                );
              })()}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {arvore.subcolecoes
                .map((sub, si) => ({ sub, si }))
                .sort((a, b) => subOrdem(a.sub.subcolecao_id) - subOrdem(b.sub.subcolecao_id) || a.si - b.si)
                .map(({ sub, si }) => {
                const realizado = sub.linhas.reduce((a, l) => a + l.slots.filter((s) => s.modelo_id).length, 0);
                const planejado = (seed?.buckets ?? []).filter((b) => (b.subcolecao_id ?? null) === (sub.subcolecao_id ?? null)).reduce((a, b) => a + (Number(b.qtd) || 0), 0);
                const cats = sub.categorias_tecido ?? [];
                const semCat = sub.linhas.reduce((a, l) => a + l.slots.filter((s) => !s.categoria_tecido_id).length, 0);
                const allSubSlots = sub.linhas.flatMap((l) => l.slots);
                const readyCats = cats.filter((cid) => { const ms = allSubSlots.filter((s) => s.categoria_tecido_id === cid); return ms.length > 0 && ms.every(slotReady); }).length;
                const status = cats.length === 0 ? null
                  : readyCats === 0 ? { green: false, txt: "sem fornecedor" }
                  : readyCats < cats.length ? { green: false, txt: `${readyCats}/${cats.length} prontas` }
                  : { green: true, txt: "pronto p/ pedido" };
                return (
                  <button key={sub.id ?? si} type="button"
                    className="flex flex-col gap-2 rounded-lg border bg-background p-4 text-left shadow-sm transition-shadow hover:border-primary hover:shadow-md"
                    onClick={() => abrirSubGuarded(si, sub.subcolecao_id)}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-medium">{nameOf(subNomes, sub.subcolecao_id) ?? "Sem subcoleção"}</div>
                      {status && <StatusBadge tone={status.green ? "success" : "warning"} className="shrink-0 rounded-full px-2 py-0.5 text-[11px] normal-case tracking-normal">{status.txt}</StatusBadge>}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {/* "nenhuma categoria criada" (lanes da sub) ≠ "N modelos sem categoria" (cards) —
                          os dois rótulos quase iguais lado a lado confundiam (laudo Gestalt). */}
                      {cats.length ? cats.map((cid) => (
                        <span key={cid} className="rounded bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">{catTecidoNome(cid) ?? "?"}</span>
                      )) : <span className="text-[11px] text-muted-foreground">nenhuma categoria criada</span>}
                      {semCat > 0 && <StatusBadge tone="warning" className="px-2 py-0.5 text-[11px] normal-case tracking-normal">{semCat} modelos sem categoria</StatusBadge>}
                    </div>
                    <div className="mt-auto text-xs text-muted-foreground"><b className="text-foreground">{realizado}</b>{planejado > 0 ? <> / {planejado}</> : null} modelo(s){realizado > planejado && planejado > 0 ? <StatusBadge tone="warning" title={`${realizado - planejado} modelos acima do planejado no OTB`} className="ml-1 px-1.5 py-0.5 text-[10px] normal-case tracking-normal">+{realizado - planejado} acima do OTB</StatusBadge> : null}</div>
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
          // Lanes = UNIÃO das categorias declaradas (categorias_tecido, incl. lanes vazias criadas à
          // mão) + as categorias AUTO presentes nos slots (Tecido 1). Sem a união, um card
          // auto-categorizado numa categoria fora de categorias_tecido não renderia em lane nenhuma.
          // categorias em ordem ALFABÉTICA (dono, jul/2026); "Sem categoria" (null) sempre por último
          // via laneCats = [...cats, null].
          const cats = [...new Set<string>([
            ...(sub.categorias_tecido ?? []),
            ...flat.map((f) => f.slot.categoria_tecido_id).filter((c): c is string => !!c),
          ])].sort((a, b) => (catTecidoNome(a) ?? "").localeCompare(catTecidoNome(b) ?? "", "pt-BR", { sensitivity: "base" }));
          const slotsOf = (cid: string | null) => flat.filter((f) => (f.slot.categoria_tecido_id ?? null) === cid);
          const laneCats: (string | null)[] =
            catFilters.size === 0 ? [...cats, null] : [...cats, null].filter((c) => catFilters.has(c));
          // Lanes por MIX (eixo alternativo à Família): UNIÃO dos mixes cadastrados na subcoleção
          // (mixesSub) + os mix_id presentes nos slots; "Sem mix" (null) sempre por último.
          const slotsOfMix = (mid: string | null) => flat.filter((f) => (f.slot.mix_id ?? null) === mid);
          const mixIdsPresentes = new Set(flat.map((f) => f.slot.mix_id).filter((x): x is string => !!x));
          const laneMixIds = [...new Set<string>([...mixesSub.map((m) => m.id), ...mixIdsPresentes])]
            .sort((a, b) => (mixNomeDe(a) ?? "").localeCompare(mixNomeDe(b) ?? "", "pt-BR", { sensitivity: "base" }));
          const laneMixes: (string | null)[] = [...laneMixIds, null];
          // 2º nível de agrupamento: nome do tecido (Tecido 1). `porNome` ordena ALFABÉTICO (dono),
          // com "Sem tecido" sempre por último; usado no modo por nome e como sub-grupo nas lanes.
          const tecidoNomeDoSlot = (slot: PtSlot): string => {
            const t = slot.materiais.find((m) => m.tipo === "tecido" && m.artigo_id);
            return (t?.artigo_nome ?? (t?.artigo_id ? artigoMap.get(t.artigo_id)?.nome ?? null : null)) ?? "Sem tecido";
          };
          const porNome = (items: typeof flat): [string, typeof flat][] => {
            const m = new Map<string, typeof flat>();
            for (const f of items) { const n = tecidoNomeDoSlot(f.slot); const arr = m.get(n) ?? (m.set(n, []).get(n)!); arr.push(f); }
            return [...m.entries()].sort(([a], [b]) => {
              const sa = a === "Sem tecido", sb = b === "Sem tecido";
              if (sa !== sb) return sa ? 1 : -1;                 // "Sem tecido" por último
              return a.localeCompare(b, "pt-BR", { sensitivity: "base" });
            });
          };
          // Chaves de TODAS as seções visíveis (lanes de categoria + sub-grupos de nome), p/ o
          // "Recolher/Expandir seções" (2º nível, além do de cards). Formato casa o render.
          const allSectionKeys: string[] = groupByMix
            ? laneMixes.flatMap((mid) => {
                const laneKey = `${subAtiva}:mix:${mid ?? "__sem__"}`;
                const nomeKeys = groupByNome ? porNome(slotsOfMix(mid)).map(([nome]) => `${subAtiva}:nome:${nome}`) : [];
                return [laneKey, ...nomeKeys];
              })
            : groupByCategoria
            ? laneCats.flatMap((cid) => {
                const laneKey = `${subAtiva}:${cid ?? "__sem__"}`;
                // chave canônica só por nome (G2/F3, SEM laneId) — casa com o seed e o laneBody
                const nomeKeys = groupByNome ? porNome(slotsOf(cid)).map(([nome]) => `${subAtiva}:nome:${nome}`) : [];
                return [laneKey, ...nomeKeys];
              })
            : porNome(flat).map(([nome]) => `${subAtiva}:nome:${nome}`);
          const todasSecoesRecolhidas = allSectionKeys.length > 0 && allSectionKeys.every((k) => lanesRecolhidas.has(k));
          const toggleSecoes = () => setLanesRecolhidas((prev) => {
            if (todasSecoesRecolhidas) { const n = new Set(prev); allSectionKeys.forEach((k) => n.delete(k)); return n; }
            return new Set([...prev, ...allSectionKeys]);
          });
          const allChaves = flat.map((f) => f.chave);
          const todosRecolhidos = allChaves.length > 0 && allChaves.every((c) => recolhidos.has(c));
          const toggleTodos = () => setRecolhidos((prev) => {
            if (todosRecolhidos) { const n = new Set(prev); allChaves.forEach((c) => n.delete(c)); return n; }
            return new Set([...prev, ...allChaves]);
          });
          const cardOf = (slot: PtSlot, li: number, sli: number, chave: string, dragHandle?: DragHandle) => (
            <ModelCard key={slot.id ?? `${li}-${sli}`} slot={slot} colecaoId={colecaoId} subcolecaoId={sub.subcolecao_id}
              paleta={paleta} tamanhos={tamanhos} ocsAplicadas={ocsAplicadas}
              slotOcIds={slot.id ? (slotOcMap[slot.id] ?? []) : []}
              vinculos={slot.modelo_id ? (vinculosMap[slot.modelo_id] ?? []) : []}
              lancado={slot.modelo_id ? lancadoSet.has(slot.modelo_id) : false}
              travado={slot.modelo_id ? enviadoCadSet.has(slot.modelo_id) : false}
              maoObraEstado={slot.modelo_id ? maoObraEstadoDe(slot.modelo_id) : undefined}
              maoObraServico={slot.modelo_id ? maoObraPorServicoDe(slot.modelo_id) : null}
              versao={slot.modelo_id ? (versaoMap[slot.modelo_id] ?? null) : null}
              origem={slot.modelo_id ? (origemMap[slot.modelo_id] ?? null) : null}
              fase={slot.modelo_id ? faseInfo(slot.modelo_id) : null}
              onEnsureSaved={ensureSaved}
              onChange={(ns) => {
                const next = structuredClone(arvore) as PtArvore;
                const subNext = next.subcolecoes[subAtiva];
                subNext.linhas[li].slots[sli] = aplicarMoveFamilia(subNext, ns, slot);
                patch(next);
              }}
              open={!recolhidos.has(chave)} onToggleOpen={() => toggleRecolhido(chave)}
              fornecCom={slotFornec(slot).com} fornecTotal={slotFornec(slot).total}
              dragHandle={dragHandle}
              selected={selecao.has(chave)} onToggleSelect={() => toggleSel(chave)} />
          );
          // Cartões de uma lista (arrastáveis só no modo categoria, onde soltar reatribui a categoria).
          const renderCards = (items: typeof flat, draggable: boolean) =>
            items.map(({ slot, li, sli, chave }) => draggable
              ? <DraggableCard key={slot.id ?? `${li}-${sli}`} id={chave}>{(handle) => cardOf(slot, li, sli, chave, handle)}</DraggableCard>
              : <div key={slot.id ?? `${li}-${sli}`} className="w-[360px] max-md:w-[85vw] shrink-0 max-md:snap-start">{cardOf(slot, li, sli, chave)}</div>);
          // Corpo de uma lane: vazio → placeholder; 2º nível ligado → sub-grupos por nome do tecido
          // (cada um uma linha horizontal, COLAPSÁVEL como as lanes); senão → cartões direto.
          const laneBody = (slots: typeof flat, draggable: boolean, laneId: string) =>
            slots.length === 0
              ? <div className="min-w-[280px] rounded-lg border border-dashed p-4 text-center text-xs italic text-muted-foreground">Arraste um card aqui, ou defina a categoria de tecido dentro do card.</div>
              : groupByNome
                ? porNome(slots).map(([nome, items]) => {
                    // chave CANÔNICA só por nome (G2/F3, SEM laneId — antes `${subAtiva}:${laneId}:nome:${nome}`
                    // descasava do seed, que só semeava `__all__`). O mesmo tecido recolhe/expande igual em
                    // qualquer lane; aceito por design (é o mesmo nome de tecido — comportamento coerente).
                    const nomeKey = `${subAtiva}:nome:${nome}`;
                    const nomeRecolhido = lanesRecolhidas.has(nomeKey);
                    const nomeMetros = items.reduce((a, { slot }) => a + slotMetros(slot, "tecido"), 0);
                    return (
                      <div key={nome}>
                        <div className="mb-1 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                          {/* nome DENTRO do botão: expandir/recolher clicando no nome também (dono ago/2026) */}
                          <button type="button" onClick={() => toggleLane(nomeKey)} title={nomeRecolhido ? "Expandir" : "Recolher"} className="flex items-center gap-1 rounded p-0.5 text-left hover:bg-muted hover:text-foreground">
                            {nomeRecolhido ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                            <span>{nome}</span>
                          </button>
                          <span className="rounded-full border px-1.5 text-[10px]">{items.length}{nomeMetros > 0 ? ` · ${fmtMetros(nomeMetros)} m` : ""}</span>
                        </div>
                        {!nomeRecolhido && <div className="flex items-start gap-3 overflow-x-auto max-md:snap-x max-md:snap-mandatory">{renderCards(items, draggable)}</div>}
                      </div>
                    );
                  })
                : renderCards(slots, draggable);
          return (
            <div className="flex min-h-0 flex-1 flex-col">
              {/* mobile: abas Canvas · Resumo · A comprar · OCs (nada fica desktop-only) */}
              <div className="flex shrink-0 border-b md:hidden">
                {([["canvas", "Canvas"], ["resumo", "Resumo"], ["comprar", "A comprar"], ["oc", "OCs"]] as const).map(([k, lbl]) => (
                  <button key={k} type="button" onClick={() => setMobileTab(k)}
                    className={`h-11 flex-1 text-[13px] font-medium ${mobileTab === k ? "border-b-2 border-primary text-primary" : "text-muted-foreground"}`}>
                    {lbl}
                  </button>
                ))}
              </div>
            <div className="flex flex-1 overflow-hidden">
              {/* Trilho fixo — Resumo · A comprar · OC (abrem como extensão que empurra) */}
              <div className="hidden w-[46px] shrink-0 flex-col items-center gap-1.5 border-r pt-3 md:flex">
                {([
                  { k: "resumo", Icon: PanelLeft, label: "Resumo", on: resumoAberto, act: () => setResumoAberto((v) => !v) },
                  { k: "comprar", Icon: Ruler, label: "A comprar", on: drawer?.kind === "comprar", act: () => openDrawer("comprar") },
                  { k: "oc", Icon: ShoppingCart, label: "OC", on: drawer?.kind === "oc" || drawer?.kind === "ocnum", act: () => openDrawer("oc") },
                ] as const).map(({ k, Icon, label, on, act }) => (
                  <button key={k} type="button" onClick={act} title={label}
                    className={`flex flex-col items-center gap-1 rounded-md border px-1 py-2 text-[9px] font-semibold uppercase tracking-wide ${on ? "border-primary/40 bg-primary/10 text-primary" : "border-transparent text-muted-foreground hover:bg-muted"}`}>
                    <Icon className="h-4 w-4" />
                    <span className="[writing-mode:vertical-rl] rotate-180">{label}</span>
                  </button>
                ))}
              </div>
              {/* Painel Resumo (322px) */}
              {resumoAberto && (
                <aside className="hidden w-80 shrink-0 flex-col overflow-hidden border-r md:flex lg:w-96">
                  <div className="flex-1 overflow-y-auto p-3">
                    <ResumoPanel arvore={subArvore} colecaoArvore={arvore} colecaoId={colecaoId} slotOcMap={slotOcMap} vinculoOcMap={vinculoOcMap} enviadoCadSet={enviadoCadSet} catTecidoNome={catTecidoNome} onDetalhar={openDrawer} temRascunho={dirty} />
                  </div>
                </aside>
              )}
              {/* Drawer/subsheet (420px) — abre por "detalhar" / trilho. `md:flex` (era lg):
                  em tablet os botões do trilho acendiam e NADA abria — ação sem feedback (laudo). */}
              {drawer && (
                <aside className="hidden w-[420px] shrink-0 overflow-hidden border-r md:flex">
                  <PlanTecidoDrawer state={drawer} subArvore={subArvore} colecaoArvore={arvore} situacao={situacaoRows} slotOcMap={slotOcMap} vinculoOcMap={vinculoOcMap} enviadoCadSet={enviadoCadSet} ocNumeroDe={ocNumeroDe} onClose={() => setDrawer(null)} temRascunho={dirty} />
                </aside>
              )}
              {/* mobile: painéis full-width das abas (reusam os MESMOS componentes do desktop) */}
              <div className={`flex-1 overflow-y-auto p-3 md:hidden ${mobileTab === "resumo" ? "" : "hidden"}`}>
                <ResumoPanel arvore={subArvore} colecaoArvore={arvore} colecaoId={colecaoId} slotOcMap={slotOcMap} vinculoOcMap={vinculoOcMap} enviadoCadSet={enviadoCadSet} catTecidoNome={catTecidoNome} onDetalhar={detalharMobile} temRascunho={dirty} />
              </div>
              {(mobileTab === "comprar" || mobileTab === "oc") && (
                <div className="flex-1 overflow-hidden md:hidden">
                  <PlanTecidoDrawer
                    state={drawer && (mobileTab === "comprar" ? drawer.kind === "comprar" : drawer.kind !== "comprar") ? drawer : { kind: mobileTab === "comprar" ? "comprar" : "oc", arg: null }}
                    subArvore={subArvore} colecaoArvore={arvore} situacao={situacaoRows} slotOcMap={slotOcMap} vinculoOcMap={vinculoOcMap} enviadoCadSet={enviadoCadSet} ocNumeroDe={ocNumeroDe}
                    onClose={() => setMobileTab("canvas")} temRascunho={dirty} />
                </div>
              )}
              <main className={`flex-1 overflow-y-auto p-3 ${mobileTab !== "canvas" ? "max-md:hidden" : ""}`}>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <div className="ml-auto flex flex-wrap items-center gap-2">
                    {/* dupla régua explicada: a etapa 2 conta MODELOS reais; o canvas conta ITENS
                        (modelos + vagas do OTB) — sem o rótulo, "58" virava "93" sem explicação (laudo). */}
                    {(() => { const reais = flat.filter((f) => f.slot.modelo_id).length; const vagas = flat.length - reais;
                      return vagas > 0 ? <span className="hidden text-[11px] text-muted-foreground lg:inline">{flat.length} itens = {reais} modelos + {vagas} vagas</span> : null; })()}
                    {/* Dois níveis (dono): "Seções" = grupos de nome/categoria; "Cards" = corpos. Fundidos num menu só-ícone (mobile não estoura). */}
                    <RecolherMenu
                      todasSecoesRecolhidas={todasSecoesRecolhidas}
                      todosRecolhidos={todosRecolhidos}
                      onToggleSecoes={toggleSecoes}
                      onToggleCards={toggleTodos}
                    />
                    {/* Filtro por categoria de tecido — entre Recolher e Agrupar (dono). Só faz sentido
                        agrupado por Família (senão não há lanes de categoria pra filtrar). */}
                    {groupByCategoria && (
                      <CategoriaTecidoFilter
                        cats={cats}
                        catNome={(id) => catTecidoNome(id) ?? "?"}
                        contagem={(id) => slotsOf(id).length}
                        temSemCategoria={flat.some((f) => !f.slot.categoria_tecido_id)}
                        selecionadas={catFilters}
                        onToggle={(id) => { const n = new Set(catFilters); n.has(id) ? n.delete(id) : n.add(id); setCatFilters(n); }}
                        onLimpar={() => setCatFilters(new Set())}
                      />
                    )}
                    {/* "Família" = categoria de tecido (só rótulo de UI, dono ago/2026 — keys/colunas ficam).
                        Mix e Família são lanes EXCLUSIVAS (não faz sentido 2D): ligar uma desliga a outra. */}
                    <AgrupamentoButton groups={[
                      { label: "Mix", active: groupByMix, onToggle: () => { setGroupByMix((v) => !v); if (!groupByMix) setGroupByCategoria(false); } },
                      { label: "Família", active: groupByCategoria, onToggle: () => { setGroupByCategoria((v) => !v); if (!groupByCategoria) setGroupByMix(false); } },
                      { label: "Nome do tecido", active: groupByNome, onToggle: () => setGroupByNome((v) => !v) },
                    ]} />
                    {/* + Família também LIGA o agrupamento por família (a lane nova aparece na hora). */}
                    <Button size="sm" variant="outline" className="gap-1" onClick={() => { setGroupByCategoria(true); setAddCatOpen(true); }}><Plus className="h-3.5 w-3.5" /> Família</Button>
                    {/* Editar Mix — escopo = subcoleção ativa (nome-texto casa com modelos.subcolecao). */}
                    {subNomeAtiva && (
                      <Button size="sm" variant="outline" className="gap-1" onClick={() => setMixDialogOpen(true)}><Boxes className="h-3.5 w-3.5" /> Editar Mix</Button>
                    )}
                  </div>
                </div>
                <DndContext sensors={dndSensors} onDragStart={(e) => setDragId(String(e.active.id))} onDragCancel={() => setDragId(null)} onDragEnd={handleDragEnd}>
                  <div className="space-y-4">
                    {groupByMix ? laneMixes.map((mid) => {
                      const slots = slotsOfMix(mid);
                      const laneKey = `${subAtiva}:mix:${mid ?? "__sem__"}`;
                      const laneRecolhida = lanesRecolhidas.has(laneKey);
                      return (
                        <section key={mid ?? "__sem__"}>
                          <div className="mb-1 flex items-center gap-2">
                            <button type="button" onClick={() => toggleLane(laneKey)} title={laneRecolhida ? "Expandir" : "Recolher"} className="flex items-center gap-2 rounded p-0.5 text-left text-muted-foreground hover:bg-muted hover:text-foreground">
                              {laneRecolhida ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                              <span className={`text-sm font-semibold ${mid ? "text-foreground" : "text-muted-foreground"}`}>{mid ? (mixNomeDe(mid) ?? "Mix") : "Sem mix"}</span>
                            </button>
                            <span className="rounded-full border px-2 text-[11px] text-muted-foreground">{slots.length} card(s)</span>
                          </div>
                          {!laneRecolhida && (
                            <DroppableLane id={`mixlane:${mid ?? "__sem__"}`} vertical={groupByNome}>
                              {laneBody(slots, true, `mix:${mid ?? "__sem__"}`)}
                            </DroppableLane>
                          )}
                        </section>
                      );
                    }) : groupByCategoria ? laneCats.map((cid) => {
                      const slots = slotsOf(cid);
                      const laneKey = `${subAtiva}:${cid ?? "__sem__"}`;
                      const laneRecolhida = lanesRecolhidas.has(laneKey);
                      const laneMetros = slots.reduce((a, { slot }) => a + slotMetros(slot, "tecido"), 0);
                      return (
                        <section key={cid ?? "__sem__"}>
                          <div className="mb-1 flex items-center gap-2">
                            {/* nome DENTRO do botão: expandir/recolher clicando no nome também (dono ago/2026) */}
                            <button type="button" onClick={() => toggleLane(laneKey)} title={laneRecolhida ? "Expandir" : "Recolher"} className="flex items-center gap-2 rounded p-0.5 text-left text-muted-foreground hover:bg-muted hover:text-foreground">
                              {laneRecolhida ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                              <span className={`text-sm font-semibold ${cid ? "text-foreground" : "text-muted-foreground"}`}>{cid ? (catTecidoNome(cid) ?? "?") : "Sem categoria"}</span>
                            </button>
                            <span className="rounded-full border px-2 text-[11px] text-muted-foreground">{slots.length} modelo(s){laneMetros > 0 ? ` · ${fmtMetros(laneMetros)} m` : ""}</span>
                            {cid && <button type="button" className="ml-1 rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" title="Remover categoria" onClick={() => removeCategoria(cid)}><X className="h-3.5 w-3.5" /></button>}
                          </div>
                          {!laneRecolhida && (
                            <DroppableLane id={`lane:${cid ?? "__sem__"}`} vertical={groupByNome}>
                              {laneBody(slots, true, cid ?? "__sem__")}
                            </DroppableLane>
                          )}
                        </section>
                      );
                    }) : (
                      // "Categoria de tecido" desligado: bloco único (sem lane/drag); 2º nível por nome
                      // continua valendo se ligado.
                      <section>
                        <div className={groupByNome ? "flex flex-col gap-3" : "flex items-start gap-3 overflow-x-auto max-md:snap-x max-md:snap-mandatory"}>
                          {laneBody(flat, false, "__all__")}
                        </div>
                      </section>
                    )}
                  </div>
                  <DragOverlay dropAnimation={null}>
                    {dragId ? (
                      <div className="w-[300px] rounded-lg border-2 border-primary bg-card px-3 py-2 text-sm font-semibold shadow-lg">
                        {nomeDoChave(dragId) ?? "Modelo"}
                      </div>
                    ) : null}
                  </DragOverlay>
                </DndContext>
              </main>
            </div>
            </div>
          );
        })() : null}

        {/* "Fazer pedido" da COLEÇÃO INTEIRA saiu do rodapé (decisão do dono, G5): pedido passa a
            ser SEMPRE por seleção, via o botão na barra de seleção múltipla (selecionar cards →
            "Fazer pedido"). Único caminho agora; `handleAbrirPrevia`/`previaLoading` (que só esse
            botão usava) foram removidos junto. */}
        <div className="shrink-0 border-t bg-background p-3 flex items-center gap-2">
          <Button variant="outline" size="sm" className="max-sm:h-11" onClick={() => (view === "canvas" ? irParaSubcolecoesGuarded() : requestClose())}>
            <ArrowLeft className="mr-1 h-4 w-4" />
            {view === "canvas" ? "Subcoleções" : "Voltar"}
          </Button>
          <Button className="ml-auto" disabled={!dirty || salvarMut.isPending} onClick={() => salvarMut.mutate()}>
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
            <DialogHeader><DialogTitle>Adicionar família</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-2">
              {/* FIX G3-B (diálogo barra recriar): antes FILTRAVA fora as já-adicionadas — se a lane
                  ficasse escondida (groupByCategoria desligado ao reabrir), a família parecia não
                  existir e "não deixava criar". Agora MOSTRA todas, desabilitando as já-presentes
                  com indicação — o usuário entende que ela já existe (mesmo se a lane não estiver
                  visível) em vez de achar que pode recriá-la. */}
              {catTecidoNomes.map((c) => {
                const jaAdicionada = (subAtual?.categorias_tecido ?? []).includes(c.id);
                return (
                  <Button
                    key={c.id}
                    variant="outline"
                    size="sm"
                    className="justify-start"
                    disabled={jaAdicionada}
                    title={jaAdicionada ? "Já adicionada a esta subcoleção" : undefined}
                    onClick={() => addCategoria(c.id)}
                  >
                    {c.nome}{jaAdicionada ? " — já adicionada" : ""}
                  </Button>
                );
              })}
              {catTecidoNomes.length === 0 && (
                <div className="col-span-2 text-xs text-muted-foreground">Nenhuma categoria de tecido cadastrada.</div>
              )}
            </div>
          </DialogContent>
        </Dialog>

        {/* Editar Mix — escopo = subcoleção ativa (nome-texto casa com modelos.subcolecao). */}
        {mixDialogOpen && subNomeAtiva && (
          <EditarMixDialog
            colecaoId={colecaoId}
            colecaoNome={colecao?.nome ?? "Coleção"}
            subcolecao={subNomeAtiva}
            breadcrumbBase={["Criação", "Plan. Tecido"]}
            onClose={() => setMixDialogOpen(false)}
            vagas={(subAtual?.linhas ?? []).flatMap((l) =>
              l.slots.filter((sl) => !sl.modelo_id && sl.id).map((sl) => ({
                slotId: sl.id!,
                nome: sl.nome ?? null,
                ref: sl.ref ?? null,
                mixId: sl.mix_id ?? null,
                catTecidoNome: sl.categoria_tecido_id ? (catTecidoNome(sl.categoria_tecido_id) ?? null) : null,
                tecidoNome: (() => { const a = sl.materiais.find((m) => m.tipo === "tecido" && m.artigo_id)?.artigo_id; return a ? (artigoMap.get(a)?.nome ?? null) : null; })(),
              }))
            )}
            onMoverVagas={(slotIds, mixId) => { void aplicarMixEmSlots(slotIds, mixId); }}
          />
        )}

        {/* Dialog: mover a seleção para um mix (ou remover) */}
        <Dialog open={mixMassaOpen} onOpenChange={setMixMassaOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>Mover {selecao.size} card(s) para um mix</DialogTitle></DialogHeader>
            <div className="flex flex-col gap-1.5">
              {mixesSub.length === 0 ? (
                <div className="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                  Nenhum mix nesta subcoleção. Crie um em <strong>Editar Mix</strong>.
                </div>
              ) : (
                mixesSub.map((mx) => (
                  <Button key={mx.id} variant="outline" size="sm" className="justify-start gap-2" onClick={() => aplicarMixEmMassa(mx.id)}><Boxes className="h-3.5 w-3.5" /> {mx.nome}</Button>
                ))
              )}
              <Button variant="ghost" size="sm" className="justify-start text-muted-foreground" onClick={() => aplicarMixEmMassa(null)}>Remover do mix</Button>
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


        {/* G6: confirma "Criar cards" da seleção — avisa quantos serão pulados (já materializados)
            e quantos ficam de fora por falta de dados (nem entram nos elegíveis nem nos pulados). */}
        <AlertDialog open={!!criarCardsConfirm} onOpenChange={(o) => { if (!o) setCriarCardsConfirm(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Criar {criarCardsConfirm?.elegiveis.length ?? 0} card(s) no Planejamento?</AlertDialogTitle>
              <AlertDialogDescription>
                {(criarCardsConfirm?.pulados.length ?? 0) > 0 &&
                  <>{criarCardsConfirm?.pulados.length} já criado(s) serão pulados: {criarCardsConfirm?.pulados.join(", ")}. </>}
                {(criarCardsConfirm?.semDados ?? 0) > 0 &&
                  <>{criarCardsConfirm?.semDados} card{(criarCardsConfirm?.semDados ?? 0) > 1 ? "s" : ""} sem dados
                  {" "}(nome, categoria ou tecido) ficará{(criarCardsConfirm?.semDados ?? 0) > 1 ? "ão" : ""} de fora. </>}
                {(criarCardsConfirm?.pulados.length ?? 0) === 0 && (criarCardsConfirm?.semDados ?? 0) === 0 &&
                  "Todos os selecionados serão criados."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction disabled={(criarCardsConfirm?.elegiveis.length ?? 0) === 0} onClick={() => void confirmarCriarCards()}>
                Criar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* G5: confirma "Fazer pedido" da seleção quando há cards já comprados — NÃO bloqueia,
            só avisa que eles ficam fora deste pedido. */}
        <AlertDialog open={!!pedidoSelecaoConfirm} onOpenChange={(o) => { if (!o) setPedidoSelecaoConfirm(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Alguns já foram comprados</AlertDialogTitle>
              <AlertDialogDescription>
                {pedidoSelecaoConfirm?.comprados.length} já comprado(s) ficam FORA deste pedido: {pedidoSelecaoConfirm?.comprados.join(", ")}.
                O pedido sai só dos demais ({pedidoSelecaoConfirm?.compraveis.length}).
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={() => void prosseguirPedidoSelecao(pedidoSelecaoConfirm?.compraveis ?? [])}>
                Continuar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Fazer pedido — wizard paginado (1 página por OC, respeita fornecedores). `slotIdsPedido`
            != null = pedido POR SELEÇÃO (G5): o wizard grava o carrinho (plan_tecido_slot_oc) só
            desses slots; null = rodapé da coleção inteira (comportamento de sempre, sem vínculo). */}
        {previaOpen && previaData && (
          <FazerPedidoWizard
            previa={previaData}
            colecaoId={colecaoId}
            slotIds={slotIdsPedido ?? undefined}
            onClose={() => { setPreviaOpen(false); setSlotIdsPedido(null); }}
          />
        )}

        {/* Auto-aplicar (bug #9): o save já gravou o plano, mas espelhar no BOM ESVAZIARIA cores/grade
            já cadastradas (guarda vazio-sobre-preenchido). Confirma antes de sobrescrever o BOM. */}
        <AlertDialog open={!!sobrescritaPendentes} onOpenChange={(o) => { if (!o) setSobrescritaPendentes(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Sobrescrever o BOM do modelo?</AlertDialogTitle>
              <AlertDialogDescription>
                Aplicar as edições do card apagaria cores/grade já cadastradas em{" "}
                {(sobrescritaPendentes?.length ?? 0) === 1
                  ? <b>{sobrescritaPendentes?.[0]?.nome}</b>
                  : <><b>{sobrescritaPendentes?.length}</b> modelo(s) ({sobrescritaPendentes?.map((p) => p.nome).join(", ")})</>}.
                O plano já foi salvo. Cancelar mantém o BOM atual (o card volta a exibi-lo). Aplicar substitui o BOM de tecido pelo do card.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={() => { void confirmarSobrescrita(); }}>Aplicar mesmo assim</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
}
