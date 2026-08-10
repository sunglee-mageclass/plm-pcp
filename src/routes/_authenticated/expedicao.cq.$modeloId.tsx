import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ClipboardCheck, Save, CheckCircle2, RotateCcw, Camera, Pencil, Wrench, Undo2 } from "lucide-react";
import { Breadcrumb } from "@/components/shared/Breadcrumb";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { varianteLabel } from "@/lib/variante";
import { resolverFonteConfeccao } from "@/lib/confeccao-fonte";
import { celulasRecebidaAcimaCortada, completarGradeFonte, type GradeDetalhe } from "@/lib/grade-cortada";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/shared/DateField";
import { NumberInput } from "@/components/shared/NumberInput";
import { MatrizGradeResponsiva } from "@/components/shared/MatrizGradeResponsiva";
import { PageActionBar } from "@/components/shared/PageActionBar";
import { ModeloResumoFoto } from "@/components/shared/ModeloResumoFoto";
import { ModeloResumoMeta } from "@/components/shared/ModeloResumoMeta";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useReadOnly } from "@/components/RequirePermission";
import { VerificarRevisao } from "@/components/producao/RevisaoErro";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { CqPosView, type CqPosHandle, type CqPosStatus } from "@/components/producao/CqPosView";
import { UnsavedChangesGuard, useUnsavedGuard } from "@/components/shared/UnsavedChangesGuard";
import { UnsavedIndicator } from "@/components/shared/UnsavedIndicator";
import { useDirtySnapshot } from "@/hooks/useDirtySnapshot";
import { ColabBanner } from "@/components/shared/ColabBanner";
import { useColabRegistro } from "@/hooks/useColabRegistro";
import { mergeDraft, igual, type Conflito } from "@/lib/colab/merge";
import { mergeGrade } from "@/lib/colab/merge-grade";

export const Route = createFileRoute("/_authenticated/expedicao/cq/$modeloId")({
  component: CqDetailPage,
});

type Etapa = "recebimento" | "conserto" | "lavagem" | "defeito";
const ETAPAS: Etapa[] = ["recebimento", "conserto", "lavagem", "defeito"];

// Colab (spec 2026-08-07): rótulos PT dos paths do banner de resolução genérica.
const ROTULO_CONFLITO: Record<string, string> = {
  observacoes_cq: "Observações do CQ",
  pecas_incompletas: "Peças incompletas",
  pecas_faltantes: "Peças faltantes",
  pecas_sem_etiqueta: "Peças sem etiqueta",
  data_conserto_enviado: "Conserto — envio",
  data_conserto_prevista: "Conserto — previsão",
  data_conserto_entregue: "Conserto — entrega",
  data_lavagem_enviado: "Lavagem — envio",
  data_lavagem_entregue: "Lavagem — entrega",
};
const CAMPO_GRADE_PT: Record<string, string> = { recebida: "Recebida", defeito: "Defeito", enviada: "Enviada", cortada: "Cortada" };
// Colab (item 3, fast-follow): rótulo curto PT por etapa, p/ o campoFocado da grade
// destrinchada (célula = etapa + tamanho — sem depender de vid, que só recebimento/defeito têm).
const ETAPA_FOCO_PT: Record<Etapa, string> = { recebimento: "Recebida", conserto: "Conserto", lavagem: "Lavagem", defeito: "Defeito" };
function rotuloConflito(path: string): string {
  if (path.startsWith("grade:")) { const [, , tam, campo] = path.split(":"); return `${CAMPO_GRADE_PT[campo] ?? campo} · ${tam}`; }
  return ROTULO_CONFLITO[path] ?? path;
}

type VarInfo = { num: number; label: string };

type VarRow = {
  id?: string;
  variante_numero: number;
  grades: Record<string, number>;
  grade_total: number;
  destino_defeito?: string | null;
};

// Map of etapa -> map of variante_numero -> VarRow
type GradesByEtapa = Record<Etapa, Record<number, VarRow>>;

function emptyGrades(): GradesByEtapa {
  return { recebimento: {}, conserto: {}, lavagem: {}, defeito: {} };
}

// Ordem canônica padrão (mesma do CAD) usada quando o tenant_config não carrega.
const DEFAULT_TAMANHOS = ["34|PPP", "36|PP", "38|P", "40|M", "42|G", "44|GG"];
// Ordena tokens pelo prefixo numérico ("34|PPP" antes de "36|PP"); fallback alfabético.
const byNumPrefix = (a: string, b: string) => {
  const na = Number(a.split("|")[0]);
  const nb = Number(b.split("|")[0]);
  return Number.isNaN(na) || Number.isNaN(nb) ? a.localeCompare(b) : na - nb;
};

function CqDetailPage() {
  const { modeloId } = Route.useParams();
  return <CqDetail modeloId={modeloId} />;
}

export function CqDetail({ modeloId, onClose, onForceClose, onDirtyChange }: { modeloId: string; onClose?: () => void; onForceClose?: () => void; onDirtyChange?: (dirty: boolean) => void }) {
  const qc = useQueryClient();
  const permReadOnly = useReadOnly();
  const tenantId = useActiveTenantId();

  const { data: modelo } = useQuery({
    queryKey: ["cq-modelo", modeloId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modelos")
        .select("id, ref, nome, colecao, subcolecao, semana, origem, categorias_produto:categoria_principal_id(nome), fotos_modelo, desenho_tecnico_url, croqui_url, mes:mes_id(mes), ano:ano_id(ano)")
        .eq("id", modeloId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data: cad } = useQuery({
    queryKey: ["cq-cad", modeloId],
    queryFn: async () => {
      const { data } = await supabase.from("cad").select("id").eq("modelo_id", modeloId).maybeSingle();
      return data;
    },
  });

  // Variantes do Tecido Principal (tipo=tecido, numero=1), rotuladas por cor.
  const { data: mainFabric, isFetched: mainFabricFetched, isFetching: mainFabricFetching } = useQuery({
    queryKey: ["cq-main-fabric", cad?.id],
    enabled: !!cad?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("cad_tecidos")
        .select("tipo, numero, cad_tecido_variantes(ordem, variante_tecido_id, variantes_tecido:variante_tecido_id(nome_variante, cor:cor_id(nome), apelido:cor_apelido_id(nome)))")
        .eq("cad_id", cad!.id)
        .eq("tipo", "tecido")
        .eq("numero", 1)
        .maybeSingle();
      return data;
    },
  });

  // Grade cadastrada do modelo (define os Tamanhos exibidos no CQ).
  const { data: modeloGrades = [] } = useQuery({
    queryKey: ["cq-modelo-grades", modeloId],
    queryFn: async () => (await supabase.from("modelo_grades").select("variante_numero, grades, grade_total").eq("modelo_id", modeloId)).data ?? [],
  });

  // Revenda (Produto Acabado, Task 7): modelo `origem='revenda'` não tem Tecido Principal
  // (nunca passa por CAD/cad_tecidos — ver receber_oc_p_acabado, Task 3) — rótulo de
  // variante vem do produto vinculado (cor base · apelido), ordem = mesma chave usada em
  // `modelo_grades`/`cad_grades` (`variante_numero`). 1 query, só quando origem=revenda.
  const { data: paVariantes } = useQuery({
    queryKey: ["pa-variantes", modeloId],
    enabled: (modelo as any)?.origem === "revenda",
    queryFn: async () => {
      const { data, error } = await (supabase.from("produtos_acabados" as any) as any)
        .select("id, produto_acabado_variantes(ordem, cor:cor_id(nome), apelido:cor_apelido_id(nome))")
        .eq("modelo_id", modeloId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: tenantCfg } = useQuery({
    queryKey: ["tenant_config", "tamanhos", tenantId],
    enabled: !!tenantId,
    queryFn: async () => (await supabase.from("tenant_config").select("tamanhos_grade").eq("tenant_id", tenantId).maybeSingle()).data,
  });

  // Datas de oficina: vêm de Serviços (producao_terceirizados).
  const { data: tercs = [] } = useQuery({
    queryKey: ["cq-tercs", cad?.id],
    enabled: !!cad?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("producao_terceirizados")
        .select("data_enviado, data_prevista, data_entregue, ativo")
        .eq("cad_id", cad!.id);
      return (data ?? []).filter((t: any) => t.ativo !== false);
    },
  });

  // Blocos de Serviços + categorias + prioridade — p/ resolver o BLOCO-FONTE da grade cortada.
  // (types.ts ainda sem detalhado/grade_detalhe em producao_terceirizados → from cast p/ any.)
  const { data: blocosFonte = [], isFetched: blocosFetched, isFetching: blocosFetching } = useQuery({
    queryKey: ["cq-blocos-fonte", cad?.id],
    enabled: !!cad?.id,
    queryFn: async () => (await (supabase.from("producao_terceirizados") as any)
      .select("id, categoria_terceirizado_id, detalhado, ativo, created_at, grade_detalhe, rev").eq("cad_id", cad!.id)).data ?? [],
  });
  const { data: catsServico = [], isFetched: catsFetched, isFetching: catsFetching } = useQuery({
    queryKey: ["cq-cats-servico", tenantId],
    enabled: !!tenantId,
    queryFn: async () => (await supabase.from("categorias_terceirizado").select("id, nome").eq("tenant_id", tenantId)).data ?? [],
  });
  const { data: prioridade = [], isFetched: prioFetched, isFetching: prioFetching } = useQuery({
    queryKey: ["cq-confeccao-prioridade", tenantId],
    enabled: !!tenantId,
    queryFn: async () => ((await supabase.from("tenant_config").select("confeccao_prioridade").eq("tenant_id", tenantId).maybeSingle()).data as any)?.confeccao_prioridade ?? [],
  });

  // Enviado Oficina = data mais antiga; Prevista = mais recente; Entregue = mais recente.
  const oficina = useMemo(() => {
    const enviados = (tercs as any[]).map((t) => t.data_enviado).filter(Boolean).sort();
    const previstas = (tercs as any[]).map((t) => t.data_prevista).filter(Boolean).sort();
    const entregues = (tercs as any[]).map((t) => t.data_entregue).filter(Boolean).sort();
    return {
      enviado: enviados[0] ?? "",
      prevista: previstas[previstas.length - 1] ?? "",
      entregue: entregues[entregues.length - 1] ?? "",
    };
  }, [tercs]);

  // Tamanhos = os cadastrados na grade do modelo, exibidos EXATAMENTE como
  // cadastrados ("34|PPP") e na ordem do tenant_config (default canônico se a
  // config não carregar). Tamanhos fora da config vão ao fim, ordenados pelo nº.
  const tamanhos = useMemo<string[]>(() => {
    const cfg = (tenantCfg as any)?.tamanhos_grade;
    const order: string[] = Array.isArray(cfg) && cfg.length ? cfg.map(String) : DEFAULT_TAMANHOS;
    const present = new Set<string>();
    (modeloGrades as any[]).forEach((g) => Object.keys(g.grades ?? {}).forEach((k) => present.add(k)));
    if (present.size === 0) return order; // ainda sem grade → mostra a config
    const ordered = order.filter((t) => present.has(t));
    const extras = [...present].filter((t) => !ordered.includes(t)).sort(byNumPrefix);
    return [...ordered, ...extras];
  }, [modeloGrades, tenantCfg]);

  // Lista de variantes a exibir (do Tecido Principal; revenda: do produto vinculado;
  // fallback final p/ grade do modelo).
  const variantList = useMemo<VarInfo[]>(() => {
    const vs = (((mainFabric as any)?.cad_tecido_variantes ?? []) as any[])
      .filter((v) => v.ordem != null)
      .map((v) => {
        const vt = v.variantes_tecido;
        const lbl = varianteLabel({ nome: vt?.nome_variante, cor: vt?.cor?.nome, apelido: vt?.apelido?.nome });
        return { num: Number(v.ordem), label: lbl !== "—" ? `${v.ordem} - ${lbl}` : `${v.ordem}` };
      })
      .sort((a, b) => a.num - b.num);
    if (vs.length) return vs;
    // Revenda (Task 7): sem Tecido Principal — rótulo vem das variantes do produto
    // acabado vinculado (cor base · apelido, na mesma ordem/chave de modelo_grades).
    if ((modelo as any)?.origem === "revenda") {
      const pv = (((paVariantes as any)?.produto_acabado_variantes ?? []) as any[])
        .filter((v) => v.ordem != null)
        .map((v) => {
          const lbl = varianteLabel({ cor: v.cor?.nome, apelido: v.apelido?.nome });
          return { num: Number(v.ordem), label: lbl !== "—" ? `${v.ordem} - ${lbl}` : `${v.ordem}` };
        })
        .sort((a, b) => a.num - b.num);
      if (pv.length) return pv;
    }
    return (modeloGrades as any[])
      .map((g) => ({ num: Number(g.variante_numero), label: `Variante ${g.variante_numero}` }))
      .sort((a, b) => a.num - b.num);
  }, [mainFabric, modeloGrades, modelo, paVariantes]);

  const labelByNumero = useMemo(() => {
    const m: Record<number, string> = {};
    variantList.forEach((v) => { m[v.num] = v.label; });
    return m;
  }, [variantList]);

  // ordem (variante_numero) → variante_tecido_id, do Tecido Principal do CAD (chave da grade_detalhe).
  const vidByNum = useMemo(() => {
    const m: Record<number, string> = {};
    (((mainFabric as any)?.cad_tecido_variantes ?? []) as any[]).forEach((v) => {
      if (v.ordem != null && v.variante_tecido_id) m[Number(v.ordem)] = v.variante_tecido_id as string;
    });
    return m;
  }, [mainFabric]);
  // Bloco-fonte de confecção (destrinchado, ATIVO). PRÉ-FILTRA por ativo p/ casar com o servidor
  // (o resolver TS filtra só por detalhado; a SQL exige ativo — ver task-2 review).
  const fonte = useMemo(
    () => resolverFonteConfeccao(
      // created_at no desempate p/ casar com o ORDER BY created_at da SQL (_resolver_fonte_confeccao)
      // quando há 2+ blocos de confecção destrinchados do MESMO rank — senão a Cortada exibida podia
      // ser de bloco diferente de onde a recebida é gravada no servidor.
      (blocosFonte as any[]).filter((b) => b.ativo !== false).map((b) => ({ id: b.id, categoria_terceirizado_id: b.categoria_terceirizado_id, detalhado: !!b.detalhado, created_at: b.created_at })),
      catsServico as any[], prioridade as string[]),
    [blocosFonte, catsServico, prioridade]);
  const fonteGrade = useMemo(() => {
    const b = (blocosFonte as any[]).find((x) => x.id === fonte.fonteId);
    return (b?.grade_detalhe ?? {}) as Record<string, Record<string, { cortada?: number; recebida?: number; defeito?: number }>>;
  }, [blocosFonte, fonte.fonteId]);
  const temFonte = !!fonte.fonteId;

  const { data: cqRow, refetch: refetchCq, isFetched: cqFetched, isFetching: cqFetching } = useQuery({
    queryKey: ["cq", cad?.id],
    enabled: !!cad?.id,
    queryFn: async () => {
      const { data } = await supabase.from("controle_qualidade").select("*").eq("cad_id", cad!.id).maybeSingle();
      return data;
    },
  });

  const { data: varRows = [], refetch: refetchVars, isFetched: varsFetched, isFetching: varsFetching } = useQuery({
    queryKey: ["cq_variantes", cqRow?.id],
    enabled: !!cqRow?.id,
    queryFn: async () => {
      const { data } = await supabase.from("cq_variantes").select("*").eq("controle_qualidade_id", cqRow!.id);
      return data ?? [];
    },
  });

  const [form, setForm] = useState({
    data_conserto_enviado: "",
    data_conserto_prevista: "",
    data_conserto_entregue: "",
    data_lavagem_enviado: "",
    data_lavagem_entregue: "",
    observacoes_cq: "",
    pecas_incompletas: 0,
    pecas_faltantes: 0,
    pecas_sem_etiqueta: 0,
  });
  const [grades, setGrades] = useState<GradesByEtapa>(emptyGrades());
  const [fotografado, setFotografado] = useState<Record<number, boolean>>({});
  const [status, setStatus] = useState<string>("pendente");
  const [editing, setEditing] = useState(false);
  const [oficinaOpen, setOficinaOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // Colab (spec 2026-08-07): merge no refetch em vez de re-seed one-shot.
  const touchedFormRef = useRef<Set<string>>(new Set());   // campos escalares do form
  const touchedGradeRef = useRef<Set<string>>(new Set());  // células "grade:{vid}:{tam}:{campo}" (recebida/defeito)
  const baseFormRef = useRef<typeof form | null>(null);
  const baseGradeRef = useRef<GradeDetalhe>({});           // recebida/defeito do fonteGrade da última carga
  const cqRevRef = useRef<number | null>(null);
  const fonteRevRef = useRef<number | null>(null);
  const retryRef = useRef(false);
  const savingRef = useRef(false);
  // Colab (fix round 1): enquanto verdadeiro, o merge effect fica de fora — uma re-baseline
  // MANUAL (pós-save / reconcile P0409) está lendo um snapshot consistente das DUAS queries do
  // merge (["cq"] + ["cq-blocos-fonte"]). Sem isso, o effect rodava no meio com uma fresca e a
  // outra STALE → flicker da célula (5→0→5) + banner falso "alguém salvou" do próprio save.
  const reseedingRef = useRef(false);
  const formLiveRef = useRef(form); formLiveRef.current = form;
  const gradesLiveRef = useRef(grades); gradesLiveRef.current = grades;
  const [ultimoMerge, setUltimoMerge] = useState<{ atualizados: number; conflitos: Conflito[] } | null>(null);
  const [conflitos, setConflitos] = useState<Conflito[]>([]);
  const conflitosRef = useRef<Conflito[]>([]);
  const [campoFocado, setCampoFocado] = useState<string | null>(null);
  // Abas Pré/Pós DENTRO do item (como em Serviços). Pré = CQ da costura (atual); Pós = acabamento.
  const [view, setView] = useState<"pre" | "pos">("pre");
  // As ações do Pós vivem no CqPosView; espelhamos o estado + ref p/ renderizar os
  // botões do Pós na MESMA barra do topo que os do Pré.
  const cqPosRef = useRef<CqPosHandle>(null);
  const [posBtn, setPosBtn] = useState<CqPosStatus>({ confirmado: false, editing: false, pending: false, hasServicos: false });
  const onPosStatus = useCallback((s: CqPosStatus) => setPosBtn(s), []);
  // Monta o Pós sob demanda e MANTÉM montado (escondido com CSS) — preserva o rascunho
  // não-salvo ao trocar de aba (senão o CqPosView desmontava e recarregava do banco).
  const [posMounted, setPosMounted] = useState(false);
  useEffect(() => { if (view === "pos") setPosMounted(true); }, [view]);

  const confirmado = status === "confirmado";
  // Confirmado trava a edição; "Editar" reabre sem desmarcar a confirmação.
  const readOnly = permReadOnly || (confirmado && !editing);

  // Guarda de "alterações não salvas": snapshot do estado editável (form + grades +
  // fotografado). status/confirmação seguem por mutations próprias, fora do snapshot.
  const { dirty: changed, markClean, reset: resetBaseline } = useDirtySnapshot({ form, grades, fotografado });
  // Só marca sujo depois de hidratar e enquanto editável (readOnly não altera nada).
  const dirty = hydrated && !readOnly && changed;
  // Full-page (rota /expedicao/cq/$modeloId): bloqueia navegação. Modal (Sheet no index):
  // o guarda vive no pai, que recebe `dirty` via onDirtyChange — aqui fica inerte.
  const { confirm } = useUnsavedGuard({ dirty: onClose ? false : dirty, blockNav: !onClose });
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  // Só hidrata quando as queries ASSENTARAM (fetched && !fetching) — senão, ao
  // salvar, rehidratava do cache vazio/antigo e os números digitados sumiam.
  const cqSettled = cqFetched && !cqFetching;
  const varsSettled = !cqRow?.id || (varsFetched && !varsFetching);
  // Só semeia recebimento/defeito quando as fontes que decidem `temFonte` já assentaram —
  // senão hidrataria como "sem fonte" (de cq_variantes) e não re-semearia (hydrated trava).
  // tenantId vazio (degenerado) = escape p/ não pendurar (aí temFonte=false, retrocompat).
  const fonteSettled =
    mainFabricFetched && !mainFabricFetching &&
    blocosFetched && !blocosFetching &&
    (!tenantId || (catsFetched && !catsFetching && prioFetched && !prioFetching));

  // ===== Colab helpers (spec 2026-08-07) — puros sobre o closure atual =====
  // Escalares do CQ a partir de uma linha de controle_qualidade (mesmo shape do `form`).
  const freshFormDe = (row: any): typeof form => ({
    data_conserto_enviado: row?.data_conserto_enviado ?? "",
    data_conserto_prevista: row?.data_conserto_prevista ?? "",
    data_conserto_entregue: row?.data_conserto_entregue ?? "",
    data_lavagem_enviado: row?.data_lavagem_enviado ?? "",
    data_lavagem_entregue: row?.data_lavagem_entregue ?? "",
    observacoes_cq: row?.observacoes_cq ?? "",
    pecas_incompletas: Number(row?.pecas_incompletas ?? 0),
    pecas_faltantes: Number(row?.pecas_faltantes ?? 0),
    pecas_sem_etiqueta: Number(row?.pecas_sem_etiqueta ?? 0),
  });
  // GradeDetalhe (recebida/defeito) derivado do grade_detalhe da fonte (chave vid).
  const gradeDetalheDeFonte = (fg: Record<string, Record<string, { recebida?: number; defeito?: number }>>): GradeDetalhe => {
    const out: GradeDetalhe = {};
    if (!temFonte) return out;
    variantList.forEach(({ num }) => {
      const vid = vidByNum[num]; if (!vid) return; const cel = fg[vid] ?? {};
      out[vid] = {}; tamanhos.forEach((t) => { out[vid][t] = { enviada: 0, cortada: 0, recebida: Number(cel[t]?.recebida) || 0, defeito: Number(cel[t]?.defeito) || 0 }; });
    });
    return out;
  };
  // GradeDetalhe (recebida/defeito) do que estou vendo AGORA (via ref-espelho — não perde tecla no voo do save).
  const meuGradeAtual = (): GradeDetalhe => {
    const out: GradeDetalhe = {};
    if (!temFonte) return out;
    variantList.forEach(({ num }) => {
      const vid = vidByNum[num]; if (!vid) return; out[vid] = {};
      tamanhos.forEach((t) => {
        out[vid][t] = { enviada: 0, cortada: 0,
          recebida: Number(gradesLiveRef.current.recebimento[num]?.grades?.[t]) || 0,
          defeito: Number(gradesLiveRef.current.defeito[num]?.grades?.[t]) || 0 };
      });
    });
    return out;
  };
  // Aplica um GradeDetalhe (recebida/defeito resolvido) de volta no estado `grades` (traduz vid→num).
  const aplicarGradeNoState = (prev: GradesByEtapa, gd: GradeDetalhe): GradesByEtapa => {
    const g = { ...prev, recebimento: { ...prev.recebimento }, defeito: { ...prev.defeito } };
    variantList.forEach(({ num }) => {
      const vid = vidByNum[num]; if (!vid) return;
      const rec: Record<string, number> = {}; const def: Record<string, number> = {}; let rT = 0, dT = 0;
      tamanhos.forEach((t) => {
        const rc = Number(gd[vid]?.[t]?.recebida) || 0; const dc = Number(gd[vid]?.[t]?.defeito) || 0;
        if (rc) { rec[t] = rc; rT += rc; } if (dc) { def[t] = dc; dT += dc; }
      });
      g.recebimento[num] = { variante_numero: num, grades: rec, grade_total: rT };
      g.defeito[num] = { ...(g.defeito[num] ?? { variante_numero: num }), grades: def, grade_total: dT } as VarRow;
    });
    return g;
  };
  // rev da fonte a partir de uma lista de blocos (state ou cache). Sempre número quando temFonte
  // (T1 garante a coluna) — NUNCA NaN, senão o _rev_base.fonte viraria null e o rev-check seria pulado.
  const fonteRevDe = (blocos: any[]): number | null => {
    if (!temFonte) return null;
    const ft = (blocos ?? []).find((x) => x.id === fonte.fonteId);
    return ft?.rev != null ? Number(ft.rev) : null;
  };
  // Setter rastreado do form: marca no touched os campos escalares que EU mudei.
  const setFormTracked: typeof setForm = (upd) =>
    setForm((prev) => {
      const next = typeof upd === "function" ? (upd as (p: typeof prev) => typeof prev)(prev) : upd;
      for (const k of Object.keys(next) as (keyof typeof next)[]) {
        if (!igual(next[k], prev[k])) touchedFormRef.current.add(k as string);
      }
      return next;
    });

  useEffect(() => {
    if (hydrated || !cad?.id) return;
    if (!cqSettled || !varsSettled || !fonteSettled) return;
    // Colab: 1ª carga (ou re-seed via cancel-edit) = base/touched limpos.
    touchedFormRef.current = new Set();
    touchedGradeRef.current = new Set();
    // Estado semeado (usado também p/ re-baselinar o guarda de alterações).
    let nextForm = {
      data_conserto_enviado: "",
      data_conserto_prevista: "",
      data_conserto_entregue: "",
      data_lavagem_enviado: "",
      data_lavagem_entregue: "",
      observacoes_cq: "",
      pecas_incompletas: 0,
      pecas_faltantes: 0,
      pecas_sem_etiqueta: 0,
    };
    let nextFoto: Record<number, boolean> = {};
    if (cqRow !== undefined) {
      if (cqRow) {
        nextForm = {
          data_conserto_enviado: cqRow.data_conserto_enviado ?? "",
          data_conserto_prevista: cqRow.data_conserto_prevista ?? "",
          data_conserto_entregue: cqRow.data_conserto_entregue ?? "",
          data_lavagem_enviado: cqRow.data_lavagem_enviado ?? "",
          data_lavagem_entregue: cqRow.data_lavagem_entregue ?? "",
          observacoes_cq: cqRow.observacoes_cq ?? "",
          pecas_incompletas: Number(cqRow.pecas_incompletas ?? 0),
          pecas_faltantes: Number(cqRow.pecas_faltantes ?? 0),
          pecas_sem_etiqueta: Number(cqRow.pecas_sem_etiqueta ?? 0),
        };
        setForm(nextForm);
        setStatus((cqRow as any).status ?? "pendente");
        const fv = (cqRow as any).fotografado_variantes ?? {};
        const fmap: Record<number, boolean> = {};
        Object.entries(fv).forEach(([k, v]) => { fmap[Number(k)] = Boolean(v); });
        nextFoto = fmap;
        setFotografado(fmap);
      }
      const g = emptyGrades();
      // conserto/lavagem (+ destino_defeito) sempre vêm de cq_variantes.
      (varRows as any[]).forEach((v) => {
        const et = v.etapa as Etapa;
        if (!ETAPAS.includes(et)) return;
        if (temFonte && (et === "recebimento" || et === "defeito")) {
          // recebimento/defeito virão do grade_detalhe (fonte única) — só preserva destino_defeito.
          if (et === "defeito") g.defeito[v.variante_numero] = { id: v.id, variante_numero: v.variante_numero, grades: {}, grade_total: 0, destino_defeito: v.destino_defeito };
          return;
        }
        g[et][v.variante_numero] = { id: v.id, variante_numero: v.variante_numero, grades: v.grades ?? {}, grade_total: Number(v.grade_total ?? 0), destino_defeito: v.destino_defeito };
      });
      if (temFonte) {
        // Fonte única: recebido/defeito vêm do grade_detalhe do bloco-fonte (traduz vid→num).
        variantList.forEach(({ num }) => {
          const vid = vidByNum[num]; if (!vid) return;
          const cel = fonteGrade[vid] ?? {};
          const rec: Record<string, number> = {}; const def: Record<string, number> = {};
          let rT = 0; let dT = 0;
          tamanhos.forEach((t) => { const rc = Number(cel[t]?.recebida) || 0; const dc = Number(cel[t]?.defeito) || 0; if (rc) { rec[t] = rc; rT += rc; } if (dc) { def[t] = dc; dT += dc; } });
          g.recebimento[num] = { variante_numero: num, grades: rec, grade_total: rT };
          g.defeito[num] = { ...(g.defeito[num] ?? { variante_numero: num }), grades: def, grade_total: dT } as VarRow;
        });
      }
      setGrades(g);
      // Re-baseline o guarda de alterações a partir do estado semeado (passa o valor
      // explícito — o estado recém-setado ainda está stale neste tick).
      resetBaseline({ form: nextForm, grades: g, fotografado: nextFoto });
      setHydrated(true);
      // Colab: captura base/rev p/ o merge do próximo refetch (base != null → merge, não seed).
      baseFormRef.current = nextForm;
      cqRevRef.current = (cqRow as any)?.rev ?? null;
      fonteRevRef.current = fonteRevDe(blocosFonte as any[]);
      // base da grade = recebida/defeito derivados do fonteGrade nesta carga (por vid/tam).
      baseGradeRef.current = gradeDetalheDeFonte(fonteGrade);
    }
  }, [cqRow, varRows, cad?.id, hydrated, cqSettled, varsSettled, fonteSettled, temFonte, fonteGrade, vidByNum, tamanhos, variantList]);

  // Colab: MERGE-no-refetch, SÓ para UPDATE alheio (realtime cross-tela/aba). O pós-save e o
  // reconcile P0409 re-baselinam MANUALMENTE (reseedingRef true) a partir de um snapshot
  // consistente das duas queries — o effect fica de fora nesse meio-tempo (senão rodava com
  // ["cq"] fresca + ["cq-blocos-fonte"] STALE → flicker 5→0→5 + banner falso do próprio save).
  useEffect(() => {
    if (!hydrated || !cad?.id) return;
    if (reseedingRef.current) return;                 // re-baseline manual em curso — não interferir
    if (!(cqFetched && !cqFetching && blocosFetched && !blocosFetching)) return;
    if (!baseFormRef.current) return;                 // antes da 1ª captura de base (o seed effect cuida)
    const freshForm = freshFormDe(cqRow);
    const freshGrade = gradeDetalheDeFonte(fonteGrade);
    const meuGrade = meuGradeAtual();
    const md = mergeDraft({ base: baseFormRef.current, draft: formLiveRef.current, fresh: freshForm, touched: touchedFormRef.current });
    const mg = mergeGrade({ base: baseGradeRef.current, meu: meuGrade, fresh: freshGrade, tocadas: touchedGradeRef.current });
    const todos = [...md.conflitos, ...mg.conflitos];
    if (md.atualizados.length === 0 && md.conflitos.length === 0 && mg.atualizados.length === 0 && mg.conflitos.length === 0) {
      // No-op: só reajusta as bases/revs (igual ao guard `semResultado` do piloto).
      baseFormRef.current = freshForm; baseGradeRef.current = freshGrade;
      cqRevRef.current = (cqRow as any)?.rev ?? null;
      fonteRevRef.current = fonteRevDe(blocosFonte as any[]);
      return;
    }
    if (md.atualizados.length || md.conflitos.length) setForm(md.valor);
    if (mg.atualizados.length || mg.conflitos.length) setGrades((prev) => aplicarGradeNoState(prev, mg.valor));
    conflitosRef.current = todos; setConflitos(todos);
    setUltimoMerge({ atualizados: md.atualizados.length + mg.atualizados.length, conflitos: todos });
    baseFormRef.current = freshForm; baseGradeRef.current = freshGrade;
    cqRevRef.current = (cqRow as any)?.rev ?? null;
    fonteRevRef.current = fonteRevDe(blocosFonte as any[]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cqRow, varRows, blocosFonte, fonteGrade, hydrated, temFonte, cqFetched, cqFetching, blocosFetched, blocosFetching]);

  // Colab: presença (quem está na tela) + reação a UPDATE alheio de controle_qualidade E do
  // bloco-fonte (producao_terceirizados por cad) — quando o PCP grava recebido/defeito, o fonte
  // bumpa e o CQ aberto refaz o merge. Canal por cad (há N linhas por cad, sem id de raiz única).
  const { presentes } = useColabRegistro({
    canal: cad?.id ? `colab:cq:${cad.id}` : null,
    tabela: "controle_qualidade",
    filtroColuna: "cad_id",
    registroId: cad?.id ?? null,
    tabelasExtra: cad?.id ? [{ tabela: "producao_terceirizados", filtroColuna: "cad_id", valor: cad.id }] : [],
    onMudancaServidor: () => {
      qc.invalidateQueries({ queryKey: ["cq", cad?.id] });
      qc.invalidateQueries({ queryKey: ["cq_variantes", cqRow?.id] });
      qc.invalidateQueries({ queryKey: ["cq-blocos-fonte", cad?.id] });
    },
    campoFocado,
  });

  // Resolução GENÉRICA de um conflito a partir do banner: "usar o novo" aplica o valor do
  // servidor no rascunho e tira o campo/célula do touched; "manter meu" só descarta o aviso.
  // Cobre TODO conflito (escalar do form + grade recebida/defeito) — senão o Salvar trava (deadlock).
  const resolverPorPath = (path: string, escolha: "meu" | "dele") => {
    const c = conflitos.find((x) => x.path === path);
    if (!c) return;
    if (escolha === "dele") {
      if (path.startsWith("grade:")) {
        const [, vid, tam, campo] = path.split(":");
        const num = Number(Object.keys(vidByNum).find((k) => vidByNum[Number(k)] === vid));
        const et = campo === "recebida" ? "recebimento" : "defeito";
        setGrades((prev) => {
          const row = prev[et as "recebimento" | "defeito"][num] ?? { variante_numero: num, grades: {}, grade_total: 0 };
          const grades = { ...row.grades, [tam]: Number(c.dele) || 0 };
          const grade_total = Object.values(grades).reduce((s, v) => s + (Number(v) || 0), 0);
          return { ...prev, [et]: { ...prev[et as "recebimento" | "defeito"], [num]: { ...row, grades, grade_total } } };
        });
        touchedGradeRef.current.delete(path);
      } else {
        setForm((f) => ({ ...f, [path]: c.dele as any }));
        touchedFormRef.current.delete(path);
      }
    }
    setConflitos((prev) => { const nx = prev.filter((x) => x.path !== path); conflitosRef.current = nx; return nx; });
    setUltimoMerge((prev) => prev ? { ...prev, conflitos: prev.conflitos.filter((x) => x.path !== path) } : prev);
  };

  const ensureRow = (etapa: Etapa, num: number): VarRow => {
    return grades[etapa][num] ?? { variante_numero: num, grades: {}, grade_total: 0 };
  };

  const setQtd = (etapa: Etapa, num: number, tam: string, qtd: number) => {
    // Colab: recebimento/defeito são o OVERLAP com a fonte (grade_detalhe) — marca a célula
    // tocada p/ o merge preservar minha edição. conserto/lavagem não entram no merge.
    if ((etapa === "recebimento" || etapa === "defeito") && temFonte) {
      const vid = vidByNum[num];
      if (vid) touchedGradeRef.current.add(`grade:${vid}:${tam}:${etapa === "recebimento" ? "recebida" : "defeito"}`);
    }
    setGrades((g) => {
      const row = { ...ensureRow(etapa, num) };
      row.grades = { ...row.grades, [tam]: qtd };
      row.grade_total = Object.values(row.grades).reduce((s, v) => s + (Number(v) || 0), 0);
      return { ...g, [etapa]: { ...g[etapa], [num]: row } };
    });
  };

  const setDestinoDefeito = (num: number, destino: "2_lote" | "cancelado") => {
    setGrades((g) => {
      const row = { ...ensureRow("defeito", num) };
      row.destino_defeito = row.destino_defeito === destino ? null : destino;
      return { ...g, defeito: { ...g.defeito, [num]: row } };
    });
  };

  // Referência read-only do CQ: COM bloco-fonte = CORTADA do grade_detalhe (afetada só pelo PCP);
  // SEM fonte = grade planejada do CAD (modelo_grades), retrocompatível.
  const refByNum = useMemo(() => {
    const m: Record<number, { grades: Record<string, number>; total: number }> = {};
    if (temFonte) {
      variantList.forEach(({ num }) => {
        const vid = vidByNum[num]; const cel = (vid && fonteGrade[vid]) || {};
        const grades: Record<string, number> = {}; let total = 0;
        tamanhos.forEach((t) => { const c = Number((cel as any)[t]?.cortada) || 0; grades[t] = c; total += c; });
        m[num] = { grades, total };
      });
    } else {
      (modeloGrades as any[]).forEach((g) => { m[Number(g.variante_numero)] = { grades: g.grades ?? {}, total: Number(g.grade_total ?? 0) }; });
    }
    return m;
  }, [temFonte, fonteGrade, vidByNum, tamanhos, variantList, modeloGrades]);

  // Alerta "Recebida > Cortada" (anomalia: recebeu mais do que foi cortado). Reusa o helper puro
  // (celulasRecebidaAcimaCortada) sobre uma grade sintética ao vivo = cortada da fonte × recebimento
  // editado no CQ. Só quando há bloco-fonte (a cortada só existe com fonte).
  const recebAcimaCortada = useMemo(() => {
    if (!temFonte) return [] as { variante_tecido_id: string; tamanho: string }[];
    const gd: GradeDetalhe = {};
    variantList.forEach(({ num }) => {
      const vid = vidByNum[num]; if (!vid) return;
      const cortadaCel = (fonteGrade[vid] ?? {}) as Record<string, { cortada?: number }>;
      const rec = grades.recebimento[num]?.grades ?? {};
      const cell: Record<string, { enviada: number; cortada: number; recebida: number; defeito: number }> = {};
      tamanhos.forEach((t) => {
        cell[t] = { enviada: 0, cortada: Number(cortadaCel[t]?.cortada) || 0, recebida: Number(rec[t]) || 0, defeito: 0 };
      });
      gd[vid] = cell;
    });
    return celulasRecebidaAcimaCortada(gd);
  }, [temFonte, fonteGrade, vidByNum, tamanhos, variantList, grades]);

  // Divergência do Recebimento × referência (grade cortada com fonte, senão grade do CAD) —
  // p/ banner de alerta. Considera só variantes que já têm algum recebimento lançado.
  const recebDivergente = useMemo(() => {
    return variantList.some(({ num }) => {
      const receb = grades.recebimento[num]?.grades ?? {};
      const rowTotal = Object.values(receb).reduce((s: number, x: any) => s + Number(x || 0), 0);
      if (rowTotal === 0) return false;
      return tamanhos.some((t) => Number(receb[t] ?? 0) !== Number(refByNum[num]?.grades?.[t] ?? 0));
    });
  }, [grades, variantList, tamanhos, refByNum]);

  // Grade Real = Recebimento − Defeito (por variante, por tamanho; mínimo 0).
  const realByNum = useMemo(() => {
    const out: Record<number, { grades: Record<string, number>; total: number }> = {};
    variantList.forEach(({ num }) => {
      const receb = grades.recebimento[num]?.grades ?? {};
      const def = grades.defeito[num]?.grades ?? {};
      const g: Record<string, number> = {};
      let total = 0;
      tamanhos.forEach((t) => {
        const v = Math.max(0, (Number(receb[t]) || 0) - (Number(def[t]) || 0));
        g[t] = v;
        total += v;
      });
      out[num] = { grades: g, total };
    });
    return out;
  }, [grades, variantList, tamanhos]);

  // A Grade Real (Recebimento − Defeito) é o que segue p/ o Direcionamento. Alerta
  // quando ela diverge da grade planejada no CAD — pega inclusive o caso em que o
  // recebimento bateu mas os defeitos deixaram a grade curta (o recebDivergente não vê).
  const realDivergente = useMemo(() => {
    return variantList.some(({ num }) => {
      const recebTotal = Object.values(grades.recebimento[num]?.grades ?? {}).reduce((s: number, x: any) => s + Number(x || 0), 0);
      if (recebTotal === 0) return false; // ainda sem contagem → não sinaliza
      const real = realByNum[num]?.grades ?? {};
      return tamanhos.some((t) => Number(real[t] ?? 0) !== Number(refByNum[num]?.grades?.[t] ?? 0));
    });
  }, [realByNum, grades, variantList, tamanhos, refByNum]);

  // Monta os dados do CQ (controle_qualidade + cq_variantes + grade real) para o RPC.
  const buildCqData = () => {
    const cq = {
      // Datas de oficina vêm de Serviços (read-only no CQ) — gravadas como snapshot.
      data_recebimento_enviado_oficina: oficina.enviado || null,
      data_recebimento_prevista: oficina.prevista || null,
      data_recebimento_entregue: oficina.entregue || null,
      data_conserto_enviado: form.data_conserto_enviado || null,
      data_conserto_prevista: form.data_conserto_prevista || null,
      data_conserto_entregue: form.data_conserto_entregue || null,
      data_lavagem_enviado: form.data_lavagem_enviado || null,
      data_lavagem_entregue: form.data_lavagem_entregue || null,
      observacoes_cq: form.observacoes_cq,
      pecas_incompletas: form.pecas_incompletas,
      pecas_faltantes: form.pecas_faltantes,
      pecas_sem_etiqueta: form.pecas_sem_etiqueta,
      fotografado_variantes: Object.fromEntries(
        variantList.filter((v) => fotografado[v.num]).map((v) => [String(v.num), true]),
      ),
    };
    const variantes: any[] = [];
    ETAPAS.forEach((et) => {
      Object.values(grades[et]).forEach((r) => {
        // Caminho fonte-única: Recebimento/Defeito vão com a grade COMPLETA (zeros explícitos) e a
        // linha NÃO é descartada mesmo com total 0 — senão a zeragem líquida não persiste no
        // grade_detalhe da fonte (o jsonb_set do backend só toca size-keys presentes) e o refetch
        // reverteria pros números velhos. Redução parcial já round-trippa; só o "líquido zero" falhava.
        const fonteFullGrid = temFonte && (et === "recebimento" || et === "defeito");
        const hasAny = r.grade_total > 0 || (et === "defeito" && r.destino_defeito);
        if (!hasAny && !fonteFullGrid) return;
        const g = fonteFullGrid
          ? completarGradeFonte(r.grades, tamanhos)
          : { grades: r.grades, grade_total: r.grade_total };
        variantes.push({
          variante_numero: r.variante_numero,
          etapa: et,
          grades: g.grades,
          grade_total: g.grade_total,
          destino_defeito: et === "defeito" ? r.destino_defeito ?? null : null,
        });
      });
    });
    const reais = variantList.map((v) => ({
      variante_numero: v.num,
      grades: realByNum[v.num]?.grades ?? {},
      grade_total: realByNum[v.num]?.total ?? 0,
    }));
    return { cq, variantes, reais };
  };

  // RPC transacional: salva (e opcionalmente confirma) o CQ. cq_variantes e a
  // Grade Real (cad_grades) na MESMA transação — tudo ou nada.
  const saveCq = async (confirmar: boolean) => {
    if (!cad?.id) throw new Error("CAD não encontrado. Abra o CAD desse modelo primeiro.");
    // Colab: barra o save enquanto há conflito pendente (o banner no topo lista cada um).
    if (conflitosRef.current.length > 0) throw new Error("Resolva os conflitos listados no aviso no topo antes de salvar.");
    const { cq, variantes, reais } = buildCqData();
    // _rev_base = { cq, fonte }. SEMPRE inclui a chave `cq` (omiti-la pularia o rev-check do CQ
    // no servidor = janela de lost-update). `fonte` só quando há bloco-fonte destrinchado.
    const _rev_base = { cq: cqRevRef.current, fonte: temFonte ? fonteRevRef.current : null };
    const { error } = await supabase.rpc("salvar_cq" as any, {
      _cad_id: cad.id,
      _cq: cq,
      _variantes: variantes,
      _reais: reais,
      _confirmar: confirmar,
      _rev_base,
    });
    if (error) throw error;
  };

  // Reconcilia o estado a partir do servidor fresco (chamado no onError P0409). Retorna os
  // conflitos que sobraram; [] = pode re-salvar. Lê os refs-espelho (formLive/gradesLive) p/ não
  // perder tecla digitada durante o voo do save (janela do await) — igual ao piloto.
  const reconciliarCq = async (): Promise<Conflito[]> => {
    // Suprime o merge effect durante o voo: refetcho as DUAS queries JUNTAS e só releio DEPOIS
    // (snapshot consistente) — senão o effect rodaria no meio com uma fresca + outra STALE.
    reseedingRef.current = true;
    try {
      await Promise.all([
        qc.refetchQueries({ queryKey: ["cq", cad?.id] }),
        qc.refetchQueries({ queryKey: ["cq-blocos-fonte", cad?.id] }),
      ]);
      const freshCq = qc.getQueryData<any>(["cq", cad?.id]) ?? null;
      const freshBlocos = qc.getQueryData<any[]>(["cq-blocos-fonte", cad?.id]) ?? [];
      const freshFonte = freshBlocos.find((x) => x.id === fonte.fonteId);
      const freshFonteGrade = (freshFonte?.grade_detalhe ?? {}) as Record<string, Record<string, { recebida?: number; defeito?: number }>>;
      const freshForm = freshFormDe(freshCq);
      const freshGrade = gradeDetalheDeFonte(freshFonteGrade);
      const meuGrade = meuGradeAtual();
      const md = mergeDraft({ base: baseFormRef.current ?? freshForm, draft: formLiveRef.current, fresh: freshForm, touched: touchedFormRef.current });
      const mg = mergeGrade({ base: baseGradeRef.current, meu: meuGrade, fresh: freshGrade, tocadas: touchedGradeRef.current });
      if (md.atualizados.length || md.conflitos.length) setForm(md.valor);
      if (mg.atualizados.length || mg.conflitos.length) setGrades((prev) => aplicarGradeNoState(prev, mg.valor));
      const todos = [...md.conflitos, ...mg.conflitos];
      conflitosRef.current = todos; setConflitos(todos);
      setUltimoMerge({ atualizados: md.atualizados.length + mg.atualizados.length, conflitos: todos });
      baseFormRef.current = freshForm; baseGradeRef.current = freshGrade;
      cqRevRef.current = (freshCq as any)?.rev ?? null;
      fonteRevRef.current = temFonte && freshFonte?.rev != null ? Number(freshFonte.rev) : null;
      return todos;
    } finally {
      reseedingRef.current = false;
    }
  };

  // Confirmar/desmarcar/editar o CQ mexe na Grade Real (cad_grades.grade_total_real) e no
  // gate de Lançar/Direcionar — invalida todos os consumidores downstream.
  const invalidateDownstream = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["producao-cq-list"] }),
      qc.invalidateQueries({ queryKey: ["dir-list"] }),
      qc.invalidateQueries({ queryKey: ["lancamentos-cards"] }),
      qc.invalidateQueries({ queryKey: ["cad-grades", cad?.id] }),
      // O trigger de rebaixa re-deriva o snapshot do Direcionamento quando a grade real muda;
      // invalida a query do detalhe p/ refletir os números novos na hora.
      qc.invalidateQueries({ queryKey: ["direcionamento-lojas", cad?.id] }),
      qc.invalidateQueries({ queryKey: ["plan-cq"] }),
      // A visão CQ Pós usa key própria (cqpos-*) — desmarcar o Pré rebaixa o Pós; refresca.
      qc.invalidateQueries({ queryKey: ["cqpos-cadgrades", cad?.id] }),
      qc.invalidateQueries({ queryKey: ["cqpos-cq", cad?.id] }),
      // Gate "Lançar" no Planejamento (prontidão) + badge da sidebar.
      qc.invalidateQueries({ queryKey: ["plan-cq-pronto"] }),
      qc.invalidateQueries({ queryKey: ["sidebar-badges"] }),
    ]);
  };

  // Colab: início do pós-save. SUPRIME o merge effect (reseedingRef) enquanto refetcho as duas
  // queries do merge, e limpa touched/conflitos. A re-baseline em si é MANUAL (reseedPosSaveDoCache)
  // de um snapshot consistente — NÃO delego ao effect (que rodaria com uma query fresca + outra
  // stale → flicker + banner falso do próprio save).
  const posSaveReset = () => {
    reseedingRef.current = true;
    touchedFormRef.current = new Set();
    touchedGradeRef.current = new Set();
    conflitosRef.current = []; setConflitos([]); setUltimoMerge(null);
  };

  // Colab: re-baselina o CQ a partir de um snapshot CONSISTENTE (as DUAS queries do merge já
  // frescas, lidas do cache DEPOIS de ambos os refetches). Re-adota a verdade do servidor SEM
  // banner e zera o merge effect a seguir. Chamado no fim do onSuccess (dentro do reseedingRef).
  const reseedPosSaveDoCache = () => {
    const freshCq = qc.getQueryData<any>(["cq", cad?.id]) ?? null;
    const freshBlocos = qc.getQueryData<any[]>(["cq-blocos-fonte", cad?.id]) ?? [];
    const freshFonte = freshBlocos.find((x) => x.id === fonte.fonteId);
    const freshFonteGrade = (freshFonte?.grade_detalhe ?? {}) as Record<string, Record<string, { recebida?: number; defeito?: number }>>;
    const freshForm = freshFormDe(freshCq);
    const freshGrade = gradeDetalheDeFonte(freshFonteGrade);
    setForm(freshForm);
    if (temFonte) setGrades((prev) => aplicarGradeNoState(prev, freshGrade));
    baseFormRef.current = freshForm;
    baseGradeRef.current = freshGrade;
    cqRevRef.current = (freshCq as any)?.rev ?? null;
    fonteRevRef.current = temFonte && freshFonte?.rev != null ? Number(freshFonte.rev) : null;
    setUltimoMerge(null);
  };

  const saveMut = useMutation({
    mutationFn: () => saveCq(false),
    onSuccess: async () => {
      toast.success("Salvo");
      setEditing(false);
      markClean(); // limpa o indicador de "alterações não salvas" já no sucesso
      posSaveReset(); // reseedingRef=true (merge effect fora até a re-baseline manual)
      // Colab (fix round 2): try/finally — se algum refetch/invalidate abaixo rejeitar, o
      // finally ainda zera reseedingRef (senão o merge effect ficava PERMANENTEMENTE
      // desligado, igual ao reconciliarCq). Ordem síncrona preservada: o reseed lê o
      // snapshot consistente das 2 queries ANTES do finally.
      try {
        // Editar um CQ já confirmado regrava a Grade Real (o _core reescreve cad_grades
        // enquanto o status segue 'confirmado') — propaga p/ downstream.
        if (confirmado) await invalidateDownstream();
        // Fonte única: o save reescreve recebido/defeito no grade_detalhe do bloco-fonte. Refetcho as
        // DUAS queries do merge JUNTAS (snapshot consistente) ANTES de re-baselinar — senão a
        // re-seed pegaria ["cq"] fresca + ["cq-blocos-fonte"] stale (flicker 5→0→5 + banner falso).
        await Promise.all([
          qc.refetchQueries({ queryKey: ["cq", cad?.id] }),
          qc.refetchQueries({ queryKey: ["cq-blocos-fonte", cad?.id] }),
        ]);
        await refetchVars();
        reseedPosSaveDoCache(); // re-adota a verdade do servidor do snapshot consistente, sem banner
      } finally {
        reseedingRef.current = false;
      }
      // Marca o cache do PCP (Serviços) como stale (mesmo dado).
      qc.invalidateQueries({ queryKey: ["producao-terc", cad?.id] });
      qc.invalidateQueries({ queryKey: ["producao-terc-list"] });
    },
    onError: async (e: any) => {
      // Colab: conflito de versão (outra pessoa/tela salvou entre a carga e agora). Reconcilia
      // AQUI MESMO (síncrono, lendo cache + refs-espelho — NUNCA via useEffect, que rodaria com
      // refs velhos e reenviaria o mesmo _rev_base rejeitado). Sem conflito real → re-salva 1×.
      if (e?.code === "P0409" && !retryRef.current) {
        retryRef.current = true; savingRef.current = true;
        const restantes = await reconciliarCq();
        if (restantes.length === 0) {
          saveMut.mutate(undefined, { onSettled: () => { savingRef.current = false; retryRef.current = false; } });
          return;
        }
        savingRef.current = false; retryRef.current = false;
        toast.error(mensagemErro(e, "Erro ao salvar"));
        return;
      }
      toast.error(mensagemErro(e, "Erro ao salvar"));
    },
  });

  const confirmMut = useMutation({
    mutationFn: () => saveCq(true),
    onSuccess: async () => {
      toast.success("Controle de Qualidade confirmado — enviado ao Direcionamento");
      setStatus("confirmado");
      posSaveReset(); // reseedingRef=true (merge effect fora até a re-baseline manual)
      // Colab (fix round 2): try/finally — espelha o saveMut acima (mesmo risco de flag presa).
      try {
        await invalidateDownstream();
        // Fonte única: confirmar reescreveu recebido/defeito no grade_detalhe do bloco-fonte. Refetcho
        // as DUAS queries do merge JUNTAS (snapshot consistente) ANTES de re-baselinar (sem flicker/banner falso).
        await Promise.all([
          qc.refetchQueries({ queryKey: ["cq", cad?.id] }),
          qc.refetchQueries({ queryKey: ["cq-blocos-fonte", cad?.id] }),
        ]);
        await refetchVars();
        reseedPosSaveDoCache();
      } finally {
        reseedingRef.current = false;
      }
      qc.invalidateQueries({ queryKey: ["producao-terc", cad?.id] });
      qc.invalidateQueries({ queryKey: ["producao-terc-list"] });
    },
    onError: async (e: any) => {
      // Idêntico ao saveMut, re-chamando confirmMut no retry.
      if (e?.code === "P0409" && !retryRef.current) {
        retryRef.current = true; savingRef.current = true;
        const restantes = await reconciliarCq();
        if (restantes.length === 0) {
          confirmMut.mutate(undefined, { onSettled: () => { savingRef.current = false; retryRef.current = false; } });
          return;
        }
        savingRef.current = false; retryRef.current = false;
        toast.error(mensagemErro(e, "Erro ao confirmar"));
        return;
      }
      toast.error(mensagemErro(e, "Erro ao confirmar"));
    },
  });

  const desmarcarMut = useMutation({
    mutationFn: async () => {
      if (!cad?.id) return;
      const { error } = await supabase.rpc("desmarcar_cq" as any, { _cad_id: cad.id });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Confirmação desmarcada — CQ voltou a editável");
      setStatus("pendente");
      await qc.invalidateQueries({ queryKey: ["cq", cad?.id] });
      await invalidateDownstream();
      await refetchCq();
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao desmarcar")),
  });

  // "Voltar uma etapa" — do CQ volta UMA etapa (para Serviços): reabre os serviços pré e
  // desfaz o CQ; o corte é mantido (NÃO volta até a Explosão — isso é o botão do Serviços).
  const [voltarOpen, setVoltarOpen] = useState(false);
  const voltarMut = useMutation({
    mutationFn: async () => {
      if (!cad?.id) throw new Error("CAD não encontrado");
      const { error } = await supabase.rpc("voltar_cq_para_servico" as any, { _cad_id: cad.id });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Modelo voltou para Serviços");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["producao-cq-list"] }),
        qc.invalidateQueries({ queryKey: ["producao-terc-list"] }),
        qc.invalidateQueries({ queryKey: ["dir-list"] }),
        qc.invalidateQueries({ queryKey: ["sidebar-badges"] }),
        qc.invalidateQueries({ queryKey: ["etapas-afetadas", modeloId] }),
      ]);
      // A RPC já desfez o CQ no servidor — fecha SEM pedir confirmação de descarte.
      (onForceClose ?? onClose)?.();
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao voltar para Serviços")),
  });

  // Botões de ação (Pré/Pós) — renderizados na barra STICKY do rodapé (todos os tamanhos):
  // rodapé do Sheet no modo modal, PageActionBar (portal no body) no modo página inteira.
  const backButton = onClose ? (
    <Button type="button" variant="outline" onClick={onClose} aria-label="Voltar">
      <ArrowLeft className="h-4 w-4 mr-1" />Voltar
    </Button>
  ) : (
    <Button asChild variant="outline" aria-label="Voltar">
      <Link to="/expedicao/cq"><ArrowLeft className="h-4 w-4 mr-1" />Voltar</Link>
    </Button>
  );
  const actionButtons = (
    <div className="ml-auto flex items-center gap-2">
      {view === "pre" && cad?.id && (
        <Button variant="outline" onClick={() => setOficinaOpen(true)}>
          <Wrench className="h-4 w-4 md:mr-2" /> <span className="max-md:sr-only">Oficina</span>
        </Button>
      )}
      {view === "pre" && (!confirmado ? (
        <>
          {cad?.id && (
            <Button variant="outline" size="icon" onClick={() => setVoltarOpen(true)} disabled={voltarMut.isPending || permReadOnly} title="Voltar uma etapa (volta pra Serviços)" aria-label="Voltar uma etapa">
              <Undo2 className="h-4 w-4" />
            </Button>
          )}
          <Button variant="outline" onClick={() => saveMut.mutate()} disabled={saveMut.isPending || permReadOnly}>
            <Save className="h-4 w-4 mr-2" /> Salvar
          </Button>
          <Button onClick={() => confirmMut.mutate()} disabled={confirmMut.isPending || saveMut.isPending || permReadOnly || !cad?.id}>
            <CheckCircle2 className="h-4 w-4 mr-2" /> Confirmar Controle de Qualidade
          </Button>
        </>
      ) : editing ? (
        <>
          <Button variant="ghost" onClick={() => { setEditing(false); setHydrated(false); conflitosRef.current = []; setConflitos([]); setUltimoMerge(null); }} disabled={saveMut.isPending}>
            Voltar
          </Button>
          <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending || permReadOnly}>
            <Save className="h-4 w-4 mr-2" /> Salvar
          </Button>
        </>
      ) : (
        <>
          {cad?.id && (
            <Button variant="outline" size="icon" onClick={() => setVoltarOpen(true)} disabled={voltarMut.isPending || permReadOnly} title="Voltar uma etapa (volta pra Serviços)" aria-label="Voltar uma etapa">
              <Undo2 className="h-4 w-4" />
            </Button>
          )}
          <Button variant="outline" size="icon" onClick={() => setEditing(true)} disabled={permReadOnly} aria-label="Editar">
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="outline" onClick={() => desmarcarMut.mutate()} disabled={desmarcarMut.isPending || permReadOnly}>
            <RotateCcw className="h-4 w-4 mr-2" /> Desmarcar confirmação
          </Button>
        </>
      ))}
      {view === "pos" && (posBtn.confirmado && !posBtn.editing ? (
        <>
          <Button variant="outline" size="icon" onClick={() => cqPosRef.current?.edit()} disabled={permReadOnly} aria-label="Editar">
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="outline" onClick={() => cqPosRef.current?.desmarcar()} disabled={permReadOnly || posBtn.pending}>
            <RotateCcw className="h-4 w-4 mr-2" /> Desmarcar confirmação
          </Button>
        </>
      ) : (
        <>
          {posBtn.editing && (
            <Button variant="ghost" onClick={() => cqPosRef.current?.cancel()} disabled={posBtn.pending}>Voltar</Button>
          )}
          <Button variant="outline" onClick={() => cqPosRef.current?.save(false)} disabled={permReadOnly || posBtn.pending}>
            <Save className="h-4 w-4 mr-2" /> Salvar
          </Button>
          <Button onClick={() => cqPosRef.current?.save(true)} disabled={permReadOnly || posBtn.pending || !posBtn.hasServicos}>
            <CheckCircle2 className="h-4 w-4 mr-2" /> Confirmar CQ Pós
          </Button>
        </>
      ))}
    </div>
  );

  // Modo Sheet (via cq.index): flex column p/ o rodapé de ações grudar embaixo.
  // Modo página inteira: container com pb-24 (a barra de ações é o PageActionBar em portal).
  return (
    <div className={onClose ? "flex h-full flex-col min-h-0" : ""}>
      <div className={`${onClose ? "flex-1 overflow-y-auto w-full " : "container mx-auto "}p-3 sm:p-6 space-y-6 ${onClose ? "" : "pb-24"}`}>
      <VerificarRevisao modeloId={modeloId} etapa="cq" />
      {view === "pre" && cad?.id && <OficinaServicoDialog cadId={cad.id} open={oficinaOpen} onClose={() => setOficinaOpen(false)} />}
      {/* Cabeçalho: só breadcrumb/título. Voltar e Oficina foram p/ a barra de ações do rodapé. */}
      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <Breadcrumb items={[{ label: "Expedição & Logística" }, { label: "Controle de Qualidade", to: "/expedicao/cq" }, { label: modelo?.ref ?? "…" }]} />
          <UnsavedIndicator show={dirty} className="ml-auto shrink-0" />
        </div>
        <div className="flex items-start gap-3">
        <ClipboardCheck className="h-7 w-7 text-primary mt-0.5 shrink-0" />
        <ModeloResumoFoto
          fontes={[(modelo as any)?.fotos_modelo?.[0], (modelo as any)?.desenho_tecnico_url, (modelo as any)?.croqui_url]}
          nome={modelo?.nome} className="h-14 w-14"
        />
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold">{modelo?.ref ?? "…"} — {modelo?.nome ?? ""}</h1>
          <p className="text-sm text-muted-foreground">
            {(modelo as any)?.categorias_produto?.nome ?? "—"} • {modelo?.colecao ?? "—"}
          </p>
          <ModeloResumoMeta
            subcolecao={(modelo as any)?.subcolecao} lancamento={(modelo as any)?.semana}
            mesNome={(modelo as any)?.mes?.mes} anoNome={(modelo as any)?.ano?.ano}
          />
        </div>
        <Badge className={(view === "pos" ? posBtn.confirmado : confirmado) ? "bg-emerald-500 hover:bg-emerald-500 text-white" : "bg-amber-500 hover:bg-amber-500 text-white"}>
          {(view === "pos" ? posBtn.confirmado : confirmado) ? "Confirmado" : "Pendente"}
        </Badge>
        </div>
      </header>

      {/* Colab: presença + resultado do merge + resolução genérica de conflitos. FORA do
          fieldset (resolver conflito precisa funcionar mesmo com o CQ confirmado/travado). */}
      <ColabBanner
        presentes={presentes}
        ultimoMerge={ultimoMerge}
        conflitos={conflitos}
        onResolver={resolverPorPath}
        rotulo={rotuloConflito}
      />

      {/* Abas Pré/Pós — dentro do item, como em Serviços. */}
      <div className="flex rounded-md border p-0.5 w-fit">
        <Button size="sm" variant={view === "pre" ? "secondary" : "ghost"} onClick={() => setView("pre")}>Pré (costura)</Button>
        <Button size="sm" variant={view === "pos" ? "secondary" : "ghost"} onClick={() => setView("pos")}>Pós (acabamento)</Button>
      </div>

      {/* Pós montado sob demanda + mantido montado (escondido com CSS): preserva rascunho. */}
      {cad?.id && posMounted && (
        <div className={view === "pos" ? "" : "hidden"}>
          <CqPosView ref={cqPosRef} onStatus={onPosStatus} cadId={cad.id} tamanhos={tamanhos} variantList={variantList} labelByNumero={labelByNumero} readOnly={permReadOnly} />
        </div>
      )}
      {view === "pos" && !cad?.id && (
        <Card className="p-4 border-amber-500/50 bg-amber-500/10 text-sm">
          Este modelo ainda não tem registro de CAD.
        </Card>
      )}

      {view === "pre" && (
      <fieldset disabled={readOnly} className="contents">

      {!cad?.id && (
        <Card className="p-4 border-amber-500/50 bg-amber-500/10 text-sm">
          Este modelo ainda não tem registro de CAD. Abra a página de CAD desse modelo antes de salvar.
        </Card>
      )}

      {/* Referência read-only: Grade Cortada (do bloco-fonte) OU grade do CAD (retrocompat) */}
      <Card className="p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-lg">{temFonte ? "Grade Cortada" : "Grade (CAD)"}</h3>
          <span className="text-xs text-muted-foreground">{temFonte ? "Cortada reportada no PCP (Serviços) · referência" : "Grade planejada no CAD · referência"}</span>
        </div>
        <MatrizGradeResponsiva
          tamanhos={tamanhos}
          variantes={variantList.map((v) => ({ num: v.num, label: v.label }))}
          emptyLabel="Sem variantes no Tecido Principal."
          total={(num) => refByNum[num]?.total ?? 0}
          renderCell={(num, t) => (
            <div className="px-2 py-1 text-center bg-muted/20">{refByNum[num]?.grades?.[t] ?? 0}</div>
          )}
        />
      </Card>
      {temFonte && fonte.ambiguo && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          ⚠ Há mais de um serviço de confecção destrinchado neste modelo. A grade cortada usa o de maior prioridade (ajuste em Cadastro › Serviços).
        </div>
      )}

      {recebDivergente && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          ⚠ O recebimento diverge {temFonte ? "da grade cortada" : "da grade do CAD"} em alguns tamanhos (células em vermelho abaixo).
        </div>
      )}

      {temFonte && recebAcimaCortada.length > 0 && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          ⚠ Em {recebAcimaCortada.length} {recebAcimaCortada.length === 1 ? "tamanho" : "tamanhos"} o Recebido é MAIOR que a Grade Cortada (recebeu mais do que foi cortado) — verifique com a confecção.
        </div>
      )}

      {/* Seção 1 - Recebimento (datas vêm de Serviços, read-only) */}
      <EtapaSection
        title="1. Recebimento"
        hint="Tudo que voltou da produção — inclusive as peças com defeito. A Grade Real (abaixo) desconta os defeitos."
        etapa="recebimento"
        datas={[
          { label: "Data Enviado Oficina", value: oficina.enviado },
          { label: "Data Prevista", value: oficina.prevista },
          { label: "Data Entregue", value: oficina.entregue },
        ]}
        readOnlyDatas
        tamanhos={tamanhos}
        variantList={variantList}
        labelByNumero={labelByNumero}
        grades={grades}
        setQtd={setQtd}
        overFn={(num, t, val) => {
          // Alerta de divergência: recebido ≠ referência (grade cortada com fonte, senão CAD).
          // Só sinaliza depois que a variante já tem algum recebimento lançado,
          // p/ a matriz não ficar toda vermelha antes de digitar.
          const g = Number(refByNum[num]?.grades?.[t] ?? 0);
          const recebido = grades.recebimento[num]?.grades ?? {};
          const rowTotal = Object.values(recebido).reduce((s: number, x: any) => s + Number(x || 0), 0);
          return rowTotal > 0 && Number(val) !== g;
        }}
        onCampoFoco={setCampoFocado}
      />

      {/* Seção 2 - Conserto */}
      <EtapaSection
        title="2. Conserto"
        etapa="conserto"
        datas={[
          { key: "data_conserto_enviado", label: "Data Enviado" },
          { key: "data_conserto_prevista", label: "Data Prevista" },
          { key: "data_conserto_entregue", label: "Data Entregue" },
        ]}
        form={form}
        setForm={setFormTracked}
        tamanhos={tamanhos}
        variantList={variantList}
        labelByNumero={labelByNumero}
        grades={grades}
        setQtd={setQtd}
        onCampoFoco={setCampoFocado}
      />

      {/* Seção 3 - Lavagem */}
      <EtapaSection
        title="3. Lavagem"
        etapa="lavagem"
        datas={[
          { key: "data_lavagem_enviado", label: "Data Enviado" },
          { key: "data_lavagem_entregue", label: "Data Entregue" },
        ]}
        form={form}
        setForm={setFormTracked}
        tamanhos={tamanhos}
        variantList={variantList}
        labelByNumero={labelByNumero}
        grades={grades}
        setQtd={setQtd}
        onCampoFoco={setCampoFocado}
      />

      {/* Seção 4 - Defeito */}
      <Card className="p-5 space-y-3">
        <h3 className="font-semibold text-lg">4. Defeito</h3>
        <GradeMatrix
          etapa="defeito"
          tamanhos={tamanhos}
          variantList={variantList}
          labelByNumero={labelByNumero}
          grades={grades}
          setQtd={setQtd}
          onCampoFoco={setCampoFocado}
          extraCols={["destino"]}
          renderExtra={(num) => {
            const row = grades.defeito[num];
            return (
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant={row?.destino_defeito === "2_lote" ? "default" : "outline"}
                  onClick={() => setDestinoDefeito(num, "2_lote")}
                >2º Lote</Button>
                <Button
                  size="sm"
                  variant={row?.destino_defeito === "cancelado" ? "destructive" : "outline"}
                  onClick={() => setDestinoDefeito(num, "cancelado")}
                >Cancelado</Button>
              </div>
            );
          }}
        />
      </Card>

      {/* Grade Real = Recebimento − Defeito (read-only). É a grade usada no Direcionamento. */}
      <Card className="p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-lg">Grade Real</h3>
          <span className="text-xs text-muted-foreground">Recebimento − Defeito · usada no Direcionamento</span>
        </div>
        {realDivergente && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
            ⚠ A Grade Real está diferente {temFonte ? "da grade cortada" : "da grade planejada no CAD"} — é ela (com os defeitos descontados) que seguirá para o Direcionamento.
          </div>
        )}
        <MatrizGradeResponsiva
          tamanhos={tamanhos}
          variantes={variantList.map((v) => ({ num: v.num, label: v.label }))}
          emptyLabel="Sem variantes no Tecido Principal."
          total={(num) => realByNum[num]?.total ?? 0}
          renderCell={(num, t) => (
            <div className="px-2 py-1 text-center bg-muted/20">{realByNum[num]?.grades?.[t] ?? 0}</div>
          )}
          extraHeader="Foto"
          renderExtra={(num) => {
            const foto = !!fotografado[num];
            return (
              <Button
                type="button"
                size="sm"
                variant={foto ? "default" : "outline"}
                className={foto ? "h-7 gap-1 bg-emerald-500 hover:bg-emerald-600" : "h-7 gap-1"}
                onClick={() => setFotografado((f) => ({ ...f, [num]: !f[num] }))}
              >
                <Camera className="h-3.5 w-3.5" /> {foto ? "Sim" : "Não"}
              </Button>
            );
          }}
        />
      </Card>

      {/* Gerais */}
      <Card className="p-5 space-y-4">
        <h3 className="font-semibold text-lg">Campos Gerais</h3>
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <Label className="text-xs">Peças Incompletas</Label>
            <NumberInput integer value={form.pecas_incompletas}
              onChange={(e) => setFormTracked((f) => ({ ...f, pecas_incompletas: Number(e.target.value) }))}
              onFocus={() => setCampoFocado(rotuloConflito("pecas_incompletas"))}
              onBlur={() => setCampoFocado(null)} />
          </div>
          <div>
            <Label className="text-xs">Peças Faltantes</Label>
            <NumberInput integer value={form.pecas_faltantes}
              onChange={(e) => setFormTracked((f) => ({ ...f, pecas_faltantes: Number(e.target.value) }))}
              onFocus={() => setCampoFocado(rotuloConflito("pecas_faltantes"))}
              onBlur={() => setCampoFocado(null)} />
          </div>
          <div>
            <Label className="text-xs">Peças sem Etiqueta</Label>
            <NumberInput integer value={form.pecas_sem_etiqueta}
              onChange={(e) => setFormTracked((f) => ({ ...f, pecas_sem_etiqueta: Number(e.target.value) }))}
              onFocus={() => setCampoFocado(rotuloConflito("pecas_sem_etiqueta"))}
              onBlur={() => setCampoFocado(null)} />
          </div>
        </div>
        <div>
          <Label className="text-xs">Observações do Controle de Qualidade</Label>
          <Textarea rows={3} value={form.observacoes_cq}
            onChange={(e) => setFormTracked((f) => ({ ...f, observacoes_cq: e.target.value }))}
            onFocus={() => setCampoFocado(rotuloConflito("observacoes_cq"))}
            onBlur={() => setCampoFocado(null)} />
        </div>
      </Card>
      </fieldset>
      )}

      <AlertDialog open={voltarOpen} onOpenChange={setVoltarOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Voltar este modelo para Serviços?</AlertDialogTitle>
            <AlertDialogDescription>
              Isso desfaz o CQ e reabre os serviços (você reinformará o recebimento). O corte é
              mantido — o modelo volta uma etapa, para Serviços. Serviços e contas a pagar não são apagados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={voltarMut.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={voltarMut.isPending}
              onClick={() => voltarMut.mutate()}
            >
              Voltar para Serviços
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Full-page: guarda o "sair sem salvar" (bloqueia navegação de rota). No modal
          (Sheet no index) o guarda é renderizado pelo pai — aqui não duplica. */}
      {!onClose && (
        <UnsavedChangesGuard confirm={confirm} message="Há alterações não salvas no Controle de Qualidade." />
      )}
      </div>

      {/* Regra 2 — barra de ações sticky no rodapé (todos os tamanhos).
          Sheet: rodapé in-flow do próprio modal. Página inteira: PageActionBar (portal no body). */}
      {onClose ? (
        <div className="shrink-0 border-t bg-background p-3 flex flex-wrap items-center gap-2">
          {backButton}
          {actionButtons}
        </div>
      ) : (
        <PageActionBar>
          {backButton}
          {actionButtons}
        </PageActionBar>
      )}
    </div>
  );
}

// ===== sub-components =====

type DataEditavel = { key: string; label: string; value?: undefined };
type DataReadOnly = { key?: undefined; label: string; value: string };

function EtapaSection(props: {
  title: string;
  hint?: string;
  etapa: Etapa;
  datas: (DataEditavel | DataReadOnly)[];
  readOnlyDatas?: boolean;
  form?: any;
  setForm?: (fn: (f: any) => any) => void;
  tamanhos: string[];
  variantList: VarInfo[];
  labelByNumero: Record<number, string>;
  grades: GradesByEtapa;
  setQtd: (etapa: Etapa, num: number, tam: string, qtd: number) => void;
  overFn?: (num: number, tam: string, val: number) => boolean;
  // Colab (item 3, fast-follow): presença por campo — repassa p/ a GradeMatrix.
  onCampoFoco?: (label: string | null) => void;
}) {
  const { title, hint, etapa, datas, readOnlyDatas, form, setForm, tamanhos, variantList, labelByNumero, grades, setQtd, overFn, onCampoFoco } = props;
  return (
    <Card className="p-5 space-y-4">
      <div>
        <h3 className="font-semibold text-lg">{title}</h3>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {readOnlyDatas ? (
        // Reflexo das datas de Serviços — mesmo padrão do CQ Pós (inline "label: valor",
        // text-xs, label muted + valor foreground). Não é editável aqui.
        <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
          {datas.map((d) => (
            <div key={d.label}>
              {d.label}: <span className="text-foreground">{d.value ? String(d.value).split("-").reverse().join("/") : "—"}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {datas.map((d) => (
            <div key={d.label}>
              <Label className="text-xs">{d.label}</Label>
              <DateField
                value={form?.[d.key as string] ?? ""}
                onChange={(e) => setForm?.((f: any) => ({ ...f, [d.key as string]: e.target.value }))}
              />
            </div>
          ))}
        </div>
      )}
      <GradeMatrix
        etapa={etapa}
        tamanhos={tamanhos}
        variantList={variantList}
        labelByNumero={labelByNumero}
        grades={grades}
        setQtd={setQtd}
        overFn={overFn}
        onCampoFoco={onCampoFoco}
      />
    </Card>
  );
}

function GradeMatrix(props: {
  etapa: Etapa;
  tamanhos: string[];
  variantList: VarInfo[];
  labelByNumero: Record<number, string>;
  grades: GradesByEtapa;
  setQtd: (etapa: Etapa, num: number, tam: string, qtd: number) => void;
  extraCols?: string[];
  renderExtra?: (variante_numero: number) => React.ReactNode;
  /** Marca a célula em vermelho quando o valor for "demais" (ex.: recebimento > grade do CAD). */
  overFn?: (num: number, tam: string, val: number) => boolean;
  // Colab (item 3, fast-follow): presença por campo — célula = etapa + tamanho.
  onCampoFoco?: (label: string | null) => void;
}) {
  const { etapa, tamanhos, variantList, labelByNumero, grades, setQtd, extraCols = [], renderExtra, overFn, onCampoFoco } = props;

  return (
    <MatrizGradeResponsiva
      tamanhos={tamanhos}
      variantes={variantList.map((v) => ({ num: v.num, label: labelByNumero[v.num] ?? `Variante ${v.num}` }))}
      emptyLabel="Sem variantes no Tecido Principal."
      total={(num) => grades[etapa][num]?.grade_total ?? 0}
      cellClass={(num, t) => (overFn?.(num, t, Number(grades[etapa][num]?.grades?.[t] ?? 0)) ? "bg-destructive/15" : "")}
      renderCell={(num, t) => {
        const row = grades[etapa][num];
        const over = overFn?.(num, t, Number(row?.grades?.[t] ?? 0)) ?? false;
        return (
          <NumberInput
            integer
            className={`h-8 max-md:h-11 w-full border-0 text-center ${over ? "text-destructive font-semibold" : ""}`}
            value={row?.grades?.[t] ?? ""}
            onChange={(e) => setQtd(etapa, num, t, Number(e.target.value) || 0)}
            onFocus={() => onCampoFoco?.(`${ETAPA_FOCO_PT[etapa]} · ${t}`)}
            onBlur={() => onCampoFoco?.(null)}
          />
        );
      }}
      extraHeader={extraCols.length > 0 ? "Ação" : undefined}
      renderExtra={renderExtra}
    />
  );
}

// Janela rápida (pequena) p/ lançar desconto/multa do serviço de OFICINA — a oficina
// só entra no Financeiro após o CQ confirmado, então o ajuste é feito aqui.
function OficinaServicoDialog({ cadId, open, onClose }: { cadId: string; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: serv } = useQuery({
    queryKey: ["cq-oficina-servico", cadId],
    enabled: open && !!cadId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("cq_oficina_servico" as any, { _cad_id: cadId });
      if (error) throw error;
      return data as any;
    },
  });
  const [desc, setDesc] = useState(0);
  const [multa, setMulta] = useState(0);
  const { dirty: changed, markClean, reset: resetBaseline } = useDirtySnapshot({ desc, multa });
  useEffect(() => {
    if (serv) {
      const nd = Number(serv.desconto ?? 0);
      const nm = Number(serv.multa ?? 0);
      setDesc(nd); setMulta(nm);
      resetBaseline({ desc: nd, multa: nm });
    }
  }, [serv]); // eslint-disable-line react-hooks/exhaustive-deps
  // Guarda: só há edição quando aberto e há serviço (campos aparecem). Fechar com
  // pendências pede confirmação de descarte.
  const dirty = open && !!serv && changed;
  const { requestClose, confirm } = useUnsavedGuard({ dirty, onClose });
  const brl = (v: number) => Number(v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const bruto = Number(serv?.custo_bruto ?? 0);
  const liquido = bruto - (Number(desc) || 0) + (Number(multa) || 0);
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("cq_set_oficina_desconto_multa" as any, { _cad_id: cadId, _desconto: Number(desc) || 0, _multa: Number(multa) || 0 });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cq-oficina-servico", cadId] });
      qc.invalidateQueries({ queryKey: ["servicos-financeiro"] });
      // O desconto/multa grava em producao_terceirizados: invalida os caches de
      // terceirizados p/ a tela de Serviços não reescrever por cima com valor antigo
      // (last-write-wins). Over-invalidar aqui só dispara refetch, sem efeito colateral.
      ["producao-terc", "producao-terc-list", "terceirizados-multi", "terceirizados-all"]
        .forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      toast.success("Oficina atualizada");
      markClean();
      onClose();
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao salvar")),
  });
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) requestClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Oficina — desconto / multa</DialogTitle></DialogHeader>
        {!serv ? (
          <p className="text-sm text-muted-foreground">Nenhum serviço de Oficina (externo) neste modelo.</p>
        ) : (
          <div className="space-y-3 text-sm">
            <div><span className="text-muted-foreground">Responsável:</span> <b>{serv.responsavel}</b></div>
            <div><span className="text-muted-foreground">Custo bruto:</span> {brl(bruto)}</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Desconto total</Label>
                <NumberInput type="number" step="0.01" value={desc} onChange={(e) => setDesc(Number(e.target.value))} />
              </div>
              <div>
                <Label className="text-xs">Multa total</Label>
                <NumberInput type="number" step="0.01" value={multa} onChange={(e) => setMulta(Number(e.target.value))} />
              </div>
            </div>
            <div className="rounded-md bg-muted/40 px-3 py-2"><span className="text-muted-foreground">Custo líquido:</span> <b>{brl(liquido)}</b></div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={requestClose} aria-label="Voltar" className="max-sm:aspect-square max-sm:px-0">
            <ArrowLeft className="h-4 w-4 sm:hidden" />
            <span className="max-sm:sr-only">Voltar</span>
          </Button>
          {serv && <Button onClick={() => save.mutate()} disabled={save.isPending}>Salvar</Button>}
        </DialogFooter>
        <UnsavedChangesGuard confirm={confirm} message="Há alterações de desconto/multa não salvas nesta oficina." />
      </DialogContent>
    </Dialog>
  );
}
