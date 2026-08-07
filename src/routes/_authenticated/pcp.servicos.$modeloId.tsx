import { useEffect, useMemo, useRef, useState } from "react";
import { brl, fmtNum } from "@/lib/format";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Users, Save, Plus, Trash2, FileText, Pencil, Printer, Undo2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { corApelidoLabelServico } from "@/lib/variante";
import { somaCustosAdicionais } from "@/lib/custo";
import type { MoLinha, EstadoMO } from "@/lib/mao-obra";
import { type CelulaGrade, type GradeDetalhe, CELULA_ZERO, somaCampo as somaGrade, saldoCelula, recebidaExcedeCortada, celulasRecebidaAcimaCortada } from "@/lib/grade-cortada";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/shared/DateField";
import { NumberInput } from "@/components/shared/NumberInput";
import { PageActionBar } from "@/components/shared/PageActionBar";
import { Breadcrumb } from "@/components/shared/Breadcrumb";
import { UnsavedChangesGuard, useUnsavedGuard } from "@/components/shared/UnsavedChangesGuard";
import { UnsavedIndicator } from "@/components/shared/UnsavedIndicator";
import { useDirtySnapshot } from "@/hooks/useDirtySnapshot";
import { useAuth } from "@/hooks/useAuth";
import { ModeloResumoFoto } from "@/components/shared/ModeloResumoFoto";
import { ModeloResumoMeta } from "@/components/shared/ModeloResumoMeta";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { useReadOnly } from "@/components/RequirePermission";
import { ModeloObservacoes } from "@/components/shared/ModeloObservacoes";
import { VerificarRevisao } from "@/components/producao/RevisaoErro";
import { ReverterImpacto } from "@/components/producao/ReverterImpacto";
import { useReverterImpacto } from "@/hooks/useReverterImpacto";
import { printWithImages } from "@/lib/print";
import { FichaTecnica } from "@/components/producao/FichaTecnica";
import { OrdemServicoTerceirizados, type OSItem } from "@/components/producao/OrdemServicoTerceirizados";
import { ColabBanner } from "@/components/shared/ColabBanner";
import { useColabRegistro } from "@/hooks/useColabRegistro";
import { mergeLinhas, igual, type Conflito } from "@/lib/colab/merge";
import { mergeGrade } from "@/lib/colab/merge-grade";

export const Route = createFileRoute("/_authenticated/pcp/servicos/$modeloId")({
  component: TercDetailPage,
});

// Colab (spec 2026-08-07): rótulos PT dos paths do banner de resolução genérica.
const ROTULO_CONFLITO: Record<string, string> = {
  categoria_terceirizado_id: "Serviço",
  empresa_id: "Fornecedor",
  representante_id: "Representante",
  colaborador_id: "Colaborador",
  preco_metro_unidade: "Preço unit.",
  quantidade_enviada: "Qtd. enviada",
  quantidade_recebida: "Qtd. recebida",
  quantidade_defeito: "Qtd. defeito",
  desconto_total: "Desconto",
  multa_total: "Multa",
  numero_parcelas: "Nº de parcelas",
  data_enviado: "Data de envio",
  data_prevista: "Data prevista",
  data_entregue: "Data de entrega",
  observacao: "Observação",
};
const CAMPO_GRADE_PT: Record<string, string> = {
  enviada: "Enviada", cortada: "Cortada", recebida: "Recebida", defeito: "Defeito",
};
function rotuloConflito(path: string): string {
  if (path.startsWith("linha:")) return "Bloco de serviço";
  if (path.startsWith("grade:")) {
    const [, , tam, campo] = path.split(":");   // grade:{vid}:{tam}:{campo}
    return `${CAMPO_GRADE_PT[campo] ?? campo} · ${tam}`;
  }
  return ROTULO_CONFLITO[path] ?? path;
}

type Bloco = {
  _key: string; // chave estável de render (permite blocos repetidos da mesma categoria)
  id?: string;
  categoria_terceirizado_id: string;
  categoria_nome?: string;
  interno: boolean;
  // Seleção do responsável (ramo PL): empresa de serviço + representante opcional.
  empresa_id: string | null;
  representante_id: string | null;
  colaborador_id: string | null;
  preco_metro_unidade: number;
  aprovado: boolean;
  quantidade_enviada: number;
  quantidade_recebida: number;
  quantidade_defeito: number;
  desconto_total: number;
  multa_total: number;
  numero_parcelas: number;
  data_enviado: string | null;
  data_prevista: string | null;
  data_entregue: string | null;
  status: string | null;
  observacao: string;
  aviamentos_enviados: string[];
  tecidos_enviados: string[];
  // Quantidade por tamanho × variante (opt-in). Quando `detalhado`, os 3 totais viram Σ da grade.
  detalhado: boolean;
  grade_detalhe: GradeDetalhe;
};

const STATUS_COLORS: Record<string, string> = {
  pendente: "bg-amber-500",
  em_andamento: "bg-blue-500",
  finalizado: "bg-emerald-500",
  pre_finalizado: "bg-teal-500",
  sem_selecao: "bg-muted",
};
const STATUS_LABELS: Record<string, string> = {
  pendente: "Pendente",
  em_andamento: "Em andamento",
  finalizado: "Finalizado",
  pre_finalizado: "Pré finalizado",
  sem_selecao: "Sem seleção",
};

// Um bloco só conta como FINALIZADO (trava automática) quando tem data de entrega E foi
// de fato movimentado: qtd enviada > 0 e (qtd recebida > 0 OU qtd defeito > 0). Só a data
// não basta.
function blocoFinalizado(b: {
  data_entregue: string | null;
  quantidade_enviada: number;
  quantidade_recebida: number;
  quantidade_defeito: number;
}): boolean {
  return (
    !!b.data_entregue &&
    Number(b.quantidade_enviada) > 0 &&
    (Number(b.quantidade_recebida) > 0 || Number(b.quantidade_defeito) > 0)
  );
}

function TercDetailPage() {
  const { modeloId } = Route.useParams();
  return <TerceirizadosDetail modeloId={modeloId} />;
}

export function TerceirizadosDetail({
  modeloId,
  onClose,
  onForceClose,
  onDirtyChange,
}: {
  modeloId: string;
  onClose?: () => void;
  onForceClose?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const qc = useQueryClient();
  const readOnly = useReadOnly();
  const { canView } = useAuth();
  const podeVerPrecos = canView("producao_terceirizados:precos");

  const { data: modelo } = useQuery({
    queryKey: ["terc-modelo", modeloId],
    queryFn: async () => {
      const { data, error } = await (supabase.from("modelos") as any)
        .select("id, ref, nome, colecao, subcolecao, semana, categoria_principal_id, custos_adicionais, custo_terceirizados_aprovado, fotos_modelo, desenho_tecnico_url, croqui_url, mes:mes_id(mes), ano:ano_id(ano)")
        .eq("id", modeloId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      let categoria_nome: string | null = null;
      if (data.categoria_principal_id) {
        const { data: cat } = await supabase
          .from("categorias_produto")
          .select("nome")
          .eq("id", data.categoria_principal_id)
          .maybeSingle();
        categoria_nome = cat?.nome ?? null;
      }
      return { ...data, categoria_nome };
    },
  });

  const { data: cad } = useQuery({
    queryKey: ["terc-cad", modeloId],
    queryFn: async () => {
      const { data } = await supabase.from("cad").select("*").eq("modelo_id", modeloId).maybeSingle();
      return data;
    },
  });

  // Grade Total Geral (soma das grades do CAD) — exibida no cabeçalho.
  const { data: gradeTotalGeral = 0 } = useQuery({
    queryKey: ["terc-grade-total", cad?.id],
    enabled: !!cad?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("cad_grades")
        .select("grade_total_planejada, grade_total_real")
        .eq("cad_id", cad!.id);
      return (data ?? []).reduce(
        (a: number, g: any) => a + Number(g.grade_total_real ?? g.grade_total_planejada ?? 0),
        0,
      );
    },
  });

  // Custo de materiais do CAD por peça (tecidos + aviamentos) — base do custo real.
  const { data: materiaisPorPeca = 0 } = useQuery({
    queryKey: ["terc-cad-materiais", cad?.id],
    enabled: !!cad?.id,
    queryFn: async () => {
      const [tecRes, aviRes] = await Promise.all([
        supabase.from("cad_tecidos").select("custo_cad, consumo_cad, loss_percent_cad, artigos:artigo_id(preco_por_metro)").eq("cad_id", cad!.id),
        supabase.from("cad_aviamentos").select("consumo, aviamentos:aviamento_id(preco)").eq("cad_id", cad!.id),
      ]);
      const tec = (tecRes.data ?? []).reduce((s: number, t: any) =>
        s + (t.custo_cad != null
          ? Number(t.custo_cad)
          : (Number(t.consumo_cad) || 0) * (1 + (Number(t.loss_percent_cad) || 0) / 100) * (Number(t.artigos?.preco_por_metro) || 0)), 0);
      const avi = (aviRes.data ?? []).reduce((s: number, a: any) =>
        s + (Number(a.consumo) || 0) * (Number(a.aviamentos?.preco) || 0), 0);
      return tec + avi;
    },
  });

  // Colaboradores (Cadastro > Colaboradores) — responsáveis quando o serviço é Interno.
  const { data: colaboradores = [] } = useQuery({
    queryKey: ["colaboradores-all"],
    queryFn: async () => {
      const { data } = await supabase
        .from("colaboradores")
        .select("id, nome, tipo")
        .order("nome");
      return (data ?? []) as { id: string; nome: string; tipo: string }[];
    },
  });

  // Tipos de colaborador → categoria de terceirizado, para filtrar o responsável
  // interno pela categoria do serviço (ex.: Corte interno → só colaboradores de Corte).
  const { data: tiposColaborador = [] } = useQuery({
    // Chave distinta da página de Colaboradores (select diferente) — mas com o
    // mesmo prefixo, então a invalidação ["tipos-colaborador"] de lá também atinge esta.
    queryKey: ["tipos-colaborador", "categoria-map"],
    queryFn: async () => {
      const { data } = await supabase
        .from("tipos_colaborador" as any)
        .select("nome, categoria_terceirizado_id");
      return ((data ?? []) as unknown) as { nome: string; categoria_terceirizado_id: string | null }[];
    },
  });
  // categoria_terceirizado_id (string) → Set de nomes de tipo ligados a ela.
  const tiposPorCategoria = useMemo(() => {
    const m = new Map<string, Set<string>>();
    tiposColaborador.forEach((t) => {
      if (!t.categoria_terceirizado_id) return;
      const set = m.get(t.categoria_terceirizado_id) ?? new Set<string>();
      set.add(t.nome);
      m.set(t.categoria_terceirizado_id, set);
    });
    return m;
  }, [tiposColaborador]);
  const colaboradoresDaCategoria = (catId: string) => {
    const tipos = tiposPorCategoria.get(catId);
    if (!tipos) return [];
    return colaboradores.filter((c) => tipos.has(c.tipo));
  };

  const { data: categorias = [], error: categoriasError, isLoading: categoriasLoading } = useQuery({
    queryKey: ["categorias_terceirizado"],
    queryFn: async () => {
      const { data, error } = await (supabase.from("categorias_terceirizado") as any)
        .select("id, nome, etapa, ativo")
        .order("ordem")
        .order("nome");
      if (error) throw error;
      return data ?? [];
    },
  });

  // Empresas de serviço (tipo='servico') com suas categorias e representantes —
  // a fonte única do responsável (ramo PL). Grava empresa_id direto no bloco.
  const { data: empresasServico = [] } = useQuery({
    queryKey: ["empresas-servico-sel"],
    queryFn: async () => {
      const { data } = await supabase
        .from("empresas")
        .select(
          "id, nome_fantasia, empresa_categorias_servico!inner(categoria_terceirizado_id), representantes(id, nome)",
        )
        .eq("tipo", "servico");
      return (data ?? []) as any[];
    },
  });
  // Filtra empresas pela categoria do bloco (mesmo padrão do filtro por categoria de hoje).
  const empresasDaCategoria = (catId: string) =>
    (empresasServico as any[]).filter((e) =>
      (e.empresa_categorias_servico ?? []).some((c: any) => c.categoria_terceirizado_id === catId),
    );

  const { data: aviamentosModelo = [] } = useQuery({
    queryKey: ["modelo-aviamentos", modeloId],
    queryFn: async () => {
      const { data } = await supabase
        .from("modelo_aviamentos")
        .select("aviamento_id, aviamentos:aviamento_id(id, codigo_nome)")
        .eq("modelo_id", modeloId);
      return (data ?? []).map((r: any) => ({ id: r.aviamentos?.id, nome: r.aviamentos?.codigo_nome })).filter((x: any) => x.id);
    },
  });

  // Tecidos / forros / entretelas do modelo (com variantes), para marcar quais
  // variantes foram enviadas em cada bloco.
  const { data: tecidosModelo = [] } = useQuery({
    queryKey: ["modelo-tecidos-terc", modeloId],
    queryFn: async () => {
      const { data } = await supabase
        .from("modelo_tecidos")
        .select(
          "id, tipo, numero, artigos:artigo_id(nome), modelo_tecido_variantes(id, ordem, variantes_tecido:variante_tecido_id(nome_variante, codigo_variante, cor:cor_id(nome), apelido:cor_apelido_id(nome)))",
        )
        .eq("modelo_id", modeloId)
        .order("numero");
      return (data ?? []).map((r: any) => ({
        id: r.id as string,
        tipo: (r.tipo ?? "tecido") as string,
        nome: r.artigos?.nome ?? "—",
        variantes: (r.modelo_tecido_variantes ?? [])
          .map((v: any) => ({
            id: v.id as string,
            label:
              (v.variantes_tecido?.cor?.nome || v.variantes_tecido?.apelido?.nome)
                ? corApelidoLabelServico(v.variantes_tecido?.cor?.nome, v.variantes_tecido?.apelido?.nome)
                : v.variantes_tecido?.nome_variante ||
                  v.variantes_tecido?.codigo_variante ||
                  `Variante ${v.ordem ?? ""}`.trim(),
          }))
          .filter((v: any) => v.id),
      }));
    },
  });

  // Template da GRADE (p/ o modo "por tamanho/variante"): variantes do Tecido 1 × tamanhos da grade
  // PLANEJADA (modelo_grades). Chaveado por variante_tecido_id; `planejado` pré-preenche a Enviada.
  const { data: gradeTpl } = useQuery({
    queryKey: ["modelo-grade-tpl", modeloId],
    queryFn: async () => {
      const { data: mt } = await supabase
        .from("modelo_tecidos")
        .select("numero, modelo_tecido_variantes(ordem, variante_tecido_id, variantes_tecido:variante_tecido_id(nome_variante, codigo_variante, cor:cor_id(nome), apelido:cor_apelido_id(nome)))")
        .eq("modelo_id", modeloId).eq("numero", 1).limit(1);
      const rawVars = ((mt?.[0] as any)?.modelo_tecido_variantes ?? []) as any[];
      const variantes = rawVars
        .filter((v) => v.variante_tecido_id)
        .sort((a, b) => (Number(a.ordem) || 0) - (Number(b.ordem) || 0))
        .map((v, i) => ({
          id: v.variante_tecido_id as string,
          ordem: Number(v.ordem) || (i + 1),
          label: (v.variantes_tecido?.cor?.nome || v.variantes_tecido?.apelido?.nome)
            ? corApelidoLabelServico(v.variantes_tecido?.cor?.nome, v.variantes_tecido?.apelido?.nome)
            : v.variantes_tecido?.nome_variante || v.variantes_tecido?.codigo_variante || `Variante ${v.ordem ?? i + 1}`,
        }));
      const { data: mg } = await supabase.from("modelo_grades").select("variante_numero, grades").eq("modelo_id", modeloId);
      const byNum = new Map<number, Record<string, number>>();
      for (const g of (mg ?? []) as any[]) byNum.set(Number(g.variante_numero), (g.grades ?? {}) as Record<string, number>);
      // tamanhos = união das chaves de grade, ordenadas pelo prefixo numérico ("38|P")
      const tamSet = new Set<string>();
      for (const g of byNum.values()) for (const t in g) tamSet.add(t);
      const tamanhos = [...tamSet].sort((a, b) => (parseInt(a) || 0) - (parseInt(b) || 0));
      const planejado: Record<string, Record<string, number>> = {};
      for (const v of variantes) planejado[v.id] = byNum.get(v.ordem) ?? {};
      return { variantes: variantes.map((v) => ({ id: v.id, label: v.label })), tamanhos, planejado };
    },
  });
  const tamLabel = (t: string) => (t.includes("|") ? t.split("|")[1] || t : t);

  const { data: existing = [], refetch, isFetched: existingFetched, isFetching: existingFetching } = useQuery({
    queryKey: ["producao-terc", cad?.id],
    enabled: !!cad?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("producao_terceirizados")
        .select("*")
        .eq("cad_id", cad!.id)
        .eq("ativo", true);
      if (error) throw error;
      return data ?? [];
    },
  });

  const [blocos, setBlocos] = useState<Bloco[]>([]);

  // Colab (spec 2026-08-07): merge 3-vias no refetch/Realtime em vez de re-seed às cegas.
  const touchedBlocoIdsRef = useRef<Set<string>>(new Set());   // blocos com escalar editado
  const touchedGradeRef = useRef<Set<string>>(new Set());      // células "grade:{vid}:{tam}:{campo}"
  const baseBlocosRef = useRef<Bloco[] | null>(null);          // último "fresh" visto (por bloco)
  const revByBlocoRef = useRef<Record<string, number>>({});    // bloco.id → rev do servidor
  const retryRef = useRef(false);
  const savingRef = useRef(false);
  const blocosLiveRef = useRef(blocos);
  blocosLiveRef.current = blocos;
  const [ultimoMerge, setUltimoMerge] = useState<{ atualizados: number; conflitos: Conflito[] } | null>(null);
  const [conflitos, setConflitos] = useState<Conflito[]>([]);
  const conflitosRef = useRef<Conflito[]>([]);
  const [campoFocado, setCampoFocado] = useState<string | null>(null);

  // Setter rastreado: difere prev→next por bloco (id) e por célula da grade; marca o touched.
  // Mantém a assinatura de setBlocos (zero mudança nos filhos que já chamam setBlocos).
  const setBlocosTracked: typeof setBlocos = (upd) =>
    setBlocos((prev) => {
      const next = typeof upd === "function" ? (upd as (p: Bloco[]) => Bloco[])(prev) : upd;
      for (const b of next) {
        if (!b.id) continue;
        const p = prev.find((x) => x.id === b.id);
        if (!p) continue;
        // escalares do bloco (tudo menos grade_detalhe/_key)
        for (const k of Object.keys(b) as (keyof Bloco)[]) {
          if (k === "grade_detalhe" || k === "_key") continue;
          if (!igual(b[k], p[k])) touchedBlocoIdsRef.current.add(b.id);
        }
        // células da grade
        const vids = new Set([...Object.keys(b.grade_detalhe ?? {}), ...Object.keys(p.grade_detalhe ?? {})]);
        for (const vid of vids) {
          const tams = new Set([...Object.keys(b.grade_detalhe?.[vid] ?? {}), ...Object.keys(p.grade_detalhe?.[vid] ?? {})]);
          for (const tam of tams) for (const campo of ["enviada", "cortada", "recebida", "defeito"] as const) {
            const a = Number(b.grade_detalhe?.[vid]?.[tam]?.[campo]) || 0;
            const c = Number(p.grade_detalhe?.[vid]?.[tam]?.[campo]) || 0;
            if (a !== c) touchedGradeRef.current.add(`grade:${vid}:${tam}:${campo}`);
          }
        }
      }
      return next;
    });

  // Abas Pré (até costura) / Pós (pós costura = "acabamento") — filtram categorias e blocos.
  const [tabEtapa, setTabEtapa] = useState<"ate_costura" | "pos_costura">("ate_costura");
  const catEtapa = (id: string) => (categorias as any[]).find((c) => c.id === id)?.etapa ?? "ate_costura";
  const [printTarget, setPrintTarget] = useState<"ficha" | "os">("ficha");

  // Itens da Ordem de Serviço: um por bloco COM responsável (terceirizado ou colaborador interno).
  const osItens = useMemo<OSItem[]>(() => {
    const aviLabel = (id: string) => aviamentosModelo.find((a: any) => a.id === id)?.nome ?? null;
    const tecLabel = (id: string) => {
      for (const t of tecidosModelo as any[]) {
        const v = (t.variantes ?? []).find((vv: any) => vv.id === id);
        if (v) return `${t.nome} - ${v.label}`;
      }
      return null;
    };
    // Nome da empresa + " (via {rep})" quando há representante; "direto" quando não.
    const empresaLabel = (empresaId: string | null, repId: string | null) => {
      const emp = (empresasServico as any[]).find((e) => e.id === empresaId);
      if (!emp) return "—";
      const rep = repId ? (emp.representantes ?? []).find((r: any) => r.id === repId) : null;
      return rep ? `${emp.nome_fantasia} (via ${rep.nome})` : `${emp.nome_fantasia} (direto)`;
    };
    return blocos
      .filter((b) => (b.interno ? b.colaborador_id : b.empresa_id))
      .map((b) => ({
        servico: (categorias as any[]).find((c) => c.id === b.categoria_terceirizado_id)?.nome ?? "—",
        responsavel: b.interno
          ? (colaboradores.find((c) => c.id === b.colaborador_id)?.nome ?? "—")
          : empresaLabel(b.empresa_id, b.representante_id),
        interno: b.interno,
        quantidade: b.detalhado ? somaGrade(b.grade_detalhe, "enviada") : Number(b.quantidade_enviada ?? 0),
        detalhado: b.detalhado,
        // Grade ENVIADA p/ o print (a OS acompanha as peças ENVIADAS). Só variantes com envio > 0.
        grade: b.detalhado && gradeTpl
          ? {
              tamanhos: gradeTpl.tamanhos.map((t) => tamLabel(t)),
              linhas: gradeTpl.variantes
                .map((v) => {
                  const valores = gradeTpl.tamanhos.map((t) => Number(b.grade_detalhe[v.id]?.[t]?.enviada) || 0);
                  return { label: v.label, valores, total: valores.reduce((s, n) => s + n, 0) };
                })
                .filter((l) => l.total > 0),
            }
          : null,
        dataEnviado: b.data_enviado,
        dataPrevista: b.data_prevista,
        observacao: b.observacao ?? "",
        aviamentos: (b.aviamentos_enviados ?? []).map(aviLabel).filter(Boolean) as string[],
        tecidos: (b.tecidos_enviados ?? []).map(tecLabel).filter(Boolean) as string[],
      }));
  }, [blocos, categorias, colaboradores, empresasServico, aviamentosModelo, tecidosModelo, gradeTpl]);
  const [hydrated, setHydrated] = useState(false);
  // Trava por segurança quando o serviço está Finalizado: só edita ao clicar
  // "Editar", e o Salvar volta a travar. UM único modo de edição p/ AMBAS as abas
  // (Pré/Pós): clicar Editar em qualquer aba libera as duas, e Salvar (que já
  // persiste os dois lados) re-trava. Navegar entre abas não perde o rascunho
  // (os `blocos` são um só estado compartilhado).
  const [editing, setEditing] = useState(false);

  // "Observação de Partes do Molde": mesmo campo do CAD (cad.observacoes_molde).
  const [observacoesMolde, setObservacoesMolde] = useState("");
  // "Não há acabamento (pós)": peças sem serviço pós → Status Geral vira Finalizado.
  const [semAcabamento, setSemAcabamento] = useState(false);
  const [moldeHydrated, setMoldeHydrated] = useState(false);
  useEffect(() => {
    if (moldeHydrated) return;
    if (cad === undefined) return; // espera o cad carregar
    setObservacoesMolde((cad as any)?.observacoes_molde ?? "");
    setSemAcabamento(Boolean((cad as any)?.sem_acabamento));
    setMoldeHydrated(true);
  }, [cad, moldeHydrated]);

  // Guarda de "alterações não salvas": snapshot do estado editável (blocos das duas abas
  // Pré/Pós + observação de molde). `semAcabamento` fica FORA (auto-salva sozinho) e o
  // status/lock seguem o estado salvo (existing), não o snapshot.
  const { dirty: changed, markClean, reset: resetBaseline } = useDirtySnapshot({ blocos, observacoesMolde });
  // Só conta como sujo depois de hidratar as duas fontes e enquanto tem permissão de editar
  // (readOnly = permissão; inputs ficam disabled, então nada muda). O lock por-aba NÃO zera o
  // dirty — a outra aba pode estar editável e o Salvar persiste as duas.
  const dirty = hydrated && moldeHydrated && !readOnly && changed;
  // Full-page (rota /pcp/servicos/$modeloId): bloqueia navegação de rota. Modal
  // (Sheet no index): o guarda vive no pai, que recebe `dirty` via onDirtyChange — aqui inerte.
  const { confirm } = useUnsavedGuard({ dirty: onClose ? false : dirty, blockNav: !onClose });
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  // Re-baseliniza o guarda UMA vez por ciclo de hidratação (ao carregar e após salvar). Fica
  // fora do effect de dependências mutáveis: um ref garante que rode só na transição
  // "ainda não baselinizado → tudo hidratado", evitando loop (reset é idempotente de qualquer
  // forma, mas o ref torna o gatilho explícito).
  const baselinedRef = useRef(false);
  useEffect(() => {
    if (baselinedRef.current) return;
    if (!hydrated || !moldeHydrated) return;
    resetBaseline({ blocos, observacoesMolde });
    baselinedRef.current = true;
  }, [hydrated, moldeHydrated, blocos, observacoesMolde, resetBaseline]);

  // Salva a flag "não há pós" direto na cad (auto-save do toggle), otimista.
  const semAcabamentoMut = useMutation({
    mutationFn: async (v: boolean) => {
      if (!cad?.id) return;
      const { error } = await supabase.from("cad").update({ sem_acabamento: v }).eq("id", cad.id);
      if (error) throw error;
    },
    onMutate: (v: boolean) => {
      const prev = semAcabamento;
      setSemAcabamento(v);
      return { prev };
    },
    onError: (e: any, _v, ctx: any) => {
      if (ctx) setSemAcabamento(ctx.prev);
      toast.error(mensagemErro(e, "Erro ao salvar"));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["terc-cad", modeloId] });
      qc.invalidateQueries({ queryKey: ["producao-terc-list"] });
      // "Sem acabamento" muda o gate do Direcionamento e o Status Geral no CQ.
      qc.invalidateQueries({ queryKey: ["producao-cq-list"] });
      qc.invalidateQueries({ queryKey: ["dir-list"] });
    },
  });

  // Mapeamento server-row → Bloco (reusado pela hidratação/merge e pelo retry P0409).
  const blocosFromRows = (rows: any[]): Bloco[] =>
    rows.map((r) => ({
      _key: r.id ?? crypto.randomUUID(),
      id: r.id,
      categoria_terceirizado_id: r.categoria_terceirizado_id,
      interno: Boolean(r.interno),
      empresa_id: r.empresa_id ?? null,
      representante_id: r.representante_id ?? null,
      colaborador_id: r.colaborador_id ?? null,
      preco_metro_unidade: Number(r.preco_metro_unidade ?? 0),
      aprovado: Boolean(r.aprovado),
      quantidade_enviada: Number(r.quantidade_enviada ?? 0),
      quantidade_recebida: Number(r.quantidade_recebida ?? 0),
      quantidade_defeito: Number(r.quantidade_defeito ?? 0),
      desconto_total: Number(r.desconto_total ?? 0),
      multa_total: Number(r.multa_total ?? 0),
      numero_parcelas: Number(r.numero_parcelas ?? 1),
      data_enviado: r.data_enviado,
      data_prevista: r.data_prevista,
      data_entregue: r.data_entregue,
      status: r.status,
      observacao: r.observacao ?? "",
      aviamentos_enviados: Array.isArray(r.aviamentos_enviados) ? r.aviamentos_enviados : [],
      tecidos_enviados: Array.isArray(r.tecidos_enviados) ? r.tecidos_enviados : [],
      detalhado: Boolean(r.detalhado),
      grade_detalhe: (r.grade_detalhe && typeof r.grade_detalhe === "object" ? r.grade_detalhe : {}) as GradeDetalhe,
    }));

  // Colab: 1ª carga semeia + baseline; refetch/Realtime faz merge 3-vias (escalares por bloco
  // via mergeLinhas + células por bloco via mergeGrade) em vez de re-seed às cegas. Espera a
  // query ASSENTAR (isFetched && !isFetching): hidratar do cache vazio enquanto o refetch
  // ainda corria era o que zerava o formulário ao salvar.
  useEffect(() => {
    if (!cad?.id) return;
    if (!existingFetched || existingFetching) return;
    const fresh = blocosFromRows(existing as any[]);
    revByBlocoRef.current = Object.fromEntries((existing as any[]).filter((r) => r.id).map((r) => [r.id, Number(r.rev ?? 0)]));

    if (!baseBlocosRef.current) {
      // 1ª carga: seed normal.
      baseBlocosRef.current = fresh;
      setBlocos(fresh);
      setHydrated(true);
      touchedBlocoIdsRef.current = new Set();
      touchedGradeRef.current = new Set();
      conflitosRef.current = [];
      setConflitos([]);
      resetBaseline({ blocos: fresh, observacoesMolde });
      return;
    }
    // Refetch: MERGE. Escalares por bloco (mergeLinhas) + células (mergeGrade) por bloco.
    const ml = mergeLinhas({ base: baseBlocosRef.current, draft: blocos, fresh, touchedIds: touchedBlocoIdsRef.current });
    let out = ml.linhas;
    const gradeConf: Conflito[] = [];
    let gradeAtual = 0;
    out = out.map((b) => {
      if (!b.id) return b;
      const fb = fresh.find((x) => x.id === b.id);
      const bb = baseBlocosRef.current!.find((x) => x.id === b.id);
      if (!fb || !bb) return b;
      const mg = mergeGrade({ base: bb.grade_detalhe ?? {}, meu: b.grade_detalhe ?? {}, fresh: fb.grade_detalhe ?? {}, tocadas: touchedGradeRef.current });
      gradeConf.push(...mg.conflitos);
      gradeAtual += mg.atualizados.length;
      return mg.atualizados.length || mg.conflitos.length ? { ...b, grade_detalhe: mg.valor } : b;
    });
    const todos = [...ml.conflitos, ...gradeConf];
    const semResultado = ml.atualizadas.length === 0 && ml.conflitos.length === 0 && gradeConf.length === 0 && gradeAtual === 0;
    if (semResultado) { baseBlocosRef.current = fresh; return; }
    setBlocos(out);
    conflitosRef.current = todos;
    setConflitos(todos);
    setUltimoMerge({ atualizados: ml.atualizadas.length + gradeAtual, conflitos: todos });
    baseBlocosRef.current = fresh;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing, cad?.id, existingFetched, existingFetching]);

  // Colab: presença (quem está na tela) + reação a UPDATE/INSERT/DELETE de blocos alheios
  // (canal por cad; filtra por cad_id porque há N blocos por cad, sem id de raiz).
  const { presentes } = useColabRegistro({
    canal: cad?.id ? `colab:pcp-servico:${cad.id}` : null,
    tabela: "producao_terceirizados",
    filtroColuna: "cad_id",
    registroId: cad?.id ?? null,
    onMudancaServidor: () => qc.invalidateQueries({ queryKey: ["producao-terc", cad?.id] }),
    campoFocado,
  });

  // Resolução GENÉRICA de um conflito a partir do banner (round 4): "usar o novo" aplica o
  // valor do servidor no rascunho e tira o campo/célula/id do touched; "manter meu" só descarta
  // o aviso. Cobre TODO conflito (escalar de bloco, linha, célula da grade) — sem isso, um
  // conflito sem UI própria deixaria o Salvar travado (deadlock, lição do piloto).
  const resolverPorPath = (path: string, escolha: "meu" | "dele") => {
    const c = conflitos.find((x) => x.path === path);
    if (!c) return;
    if (escolha === "dele") {
      if (path.startsWith("grade:")) {
        const [, vid, tam, campo] = path.split(":");
        setBlocos((prev) => prev.map((b) => {
          const has = b.grade_detalhe?.[vid]?.[tam] !== undefined || b.grade_detalhe?.[vid] !== undefined;
          if (!b.id || !has) return b;
          const gd = { ...b.grade_detalhe, [vid]: { ...(b.grade_detalhe?.[vid] ?? {}) } };
          gd[vid][tam] = { ...(b.grade_detalhe?.[vid]?.[tam] ?? {} as any), [campo]: Number(c.dele) || 0 };
          return { ...b, grade_detalhe: gd };
        }));
        touchedGradeRef.current.delete(path);
      } else if (path.startsWith("linha:")) {
        const id = path.slice("linha:".length);
        setBlocos((prev) => c.dele ? prev.map((b) => (b.id === id ? (c.dele as Bloco) : b)) : prev.filter((b) => b.id !== id));
        touchedBlocoIdsRef.current.delete(id);
      } else {
        // conflito de escalar num bloco: aplica dele.[path] no bloco correspondente
        const id = (c.dele as any)?.id ?? (c.meu as any)?.id;
        if (id) { setBlocos((prev) => prev.map((b) => (b.id === id ? { ...b, ...(c.dele as any) } : b))); touchedBlocoIdsRef.current.delete(id); }
      }
    }
    setConflitos((prev) => { const nx = prev.filter((x) => x.path !== path); conflitosRef.current = nx; return nx; });
    setUltimoMerge((prev) => prev ? { ...prev, conflitos: prev.conflitos.filter((x) => x.path !== path) } : prev);
  };

  // Quantos blocos existem por categoria (a mesma categoria pode repetir).
  const countByCat = blocos.reduce<Record<string, number>>((m, b) => {
    m[b.categoria_terceirizado_id] = (m[b.categoria_terceirizado_id] ?? 0) + 1;
    return m;
  }, {});

  // Cada clique ACRESCENTA um novo bloco da categoria (pode mandar pra dois lugares).
  const addCategoria = (catId: string, catNome: string) => {
    setBlocosTracked((bs) => [
      ...bs,
      {
        _key: crypto.randomUUID(),
        categoria_terceirizado_id: catId,
        categoria_nome: catNome,
        interno: false,
        empresa_id: null,
        representante_id: null,
        colaborador_id: null,
        preco_metro_unidade: 0,
        aprovado: false,
        quantidade_enviada: 0,
        quantidade_recebida: 0,
        quantidade_defeito: 0,
        desconto_total: 0,
        multa_total: 0,
        numero_parcelas: 1,
        data_enviado: null,
        data_prevista: null,
        data_entregue: null,
        status: "pendente",
        observacao: "",
        aviamentos_enviados: [],
        tecidos_enviados: [],
        detalhado: false,
        grade_detalhe: {},
      },
    ]);
  };
  const removeBloco = (idx: number) => setBlocosTracked((bs) => bs.filter((_, i) => i !== idx));

  const updateBloco = (idx: number, patch: Partial<Bloco>) => {
    setBlocosTracked((bs) => bs.map((b, i) => (i === idx ? { ...b, ...patch } : b)));
  };

  // 3 status: PRÉ (até costura), PÓS (pós costura) e GERAL (derivado). Regras do dono:
  // pré fin + pós pendente → geral "pendente"; pré fin + pós fin → "finalizado";
  // pré fin + pós SEM seleção → "pré finalizado".
  const { statusPre, statusPos, statusGeral, dataInicial, dataFinal, slaDias } = useMemo(() => {
    const etapaDe = (id: string) => (categorias as any[]).find((c) => c.id === id)?.etapa ?? "ate_costura";
    const statusDe = (bs: typeof blocos) =>
      bs.length === 0 ? "sem_selecao" : bs.every(blocoFinalizado) ? "finalizado" : "em_andamento";
    const pre = blocos.filter((b) => etapaDe(b.categoria_terceirizado_id) === "ate_costura");
    const pos = blocos.filter((b) => etapaDe(b.categoria_terceirizado_id) === "pos_costura");
    const sPre = statusDe(pre);
    const sPos = statusDe(pos);
    let geral: string;
    if (blocos.length === 0) geral = "sem_selecao";
    else if (sPre !== "finalizado") geral = "em_andamento"; // pré ainda não fechou
    else if (sPos === "finalizado") geral = "finalizado"; // pré + pós fechados
    else if (sPos === "sem_selecao") geral = semAcabamento ? "finalizado" : "pre_finalizado"; // pré fechado, pós não selecionado (ou "não há pós")
    else geral = "pendente"; // pré fechado, pós em andamento
    const enviados = blocos.map((b) => b.data_enviado).filter(Boolean) as string[];
    const entregues = blocos.map((b) => b.data_entregue).filter(Boolean) as string[];
    const di = enviados.length ? enviados.slice().sort()[0] : null;
    const df = entregues.length ? entregues.slice().sort().slice(-1)[0] : null;
    let sla = null;
    if (di && df) sla = Math.round((new Date(df).getTime() - new Date(di).getTime()) / 86400000);
    return { statusPre: sPre, statusPos: sPos, statusGeral: geral, dataInicial: di, dataFinal: df, slaDias: sla };
  }, [blocos, categorias, semAcabamento]);

  // Custo de serviço por peça e custo real (= materiais do CAD + serviço).
  const servicoTotal = useMemo(
    () => blocos.reduce((s, b) => s + (b.interno ? 0 : (Number(b.preco_metro_unidade) || 0) * (Number(b.quantidade_enviada) || 0) - (Number(b.desconto_total) || 0) + (Number(b.multa_total) || 0)), 0),
    [blocos],
  );
  const servicoPorPeca = gradeTotalGeral > 0 ? servicoTotal / gradeTotalGeral : 0;
  // + custos adicionais do modelo (seguem para frente desde o Desenvolvimento — src/lib/custo.ts).
  const custosAdicionaisPeca = somaCustosAdicionais((modelo as any)?.custos_adicionais);
  const custoRealPeca = (Number(materiaisPorPeca) || 0) + servicoPorPeca + custosAdicionaisPeca;

  // Resumo da MO PLANEJADA aprovada por serviço (Task 6, RPC `modelo_mo_resumo` da Task 4).
  // Distinto do "Custo real (c/ serviço)/peça" acima (blocos EXECUTADOS na produção): este lê o
  // PLANEJADO/aprovado no Planejamento. Mascara total/total_aprovado p/ quem não vê custos — mas
  // o card já é gated por `podeVerPrecos` (∈ `_pode_ver_custos`), então na prática não chega mascarado.
  const { data: moResumo } = useQuery({
    queryKey: ["pcp-mo-resumo", modeloId],
    enabled: !!modeloId && podeVerPrecos,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("modelo_mo_resumo" as any, { _ids: [modeloId] });
      if (error) throw error;
      return ((data as any)?.[modeloId] ?? null) as
        { estado: EstadoMO; total: number | null; total_aprovado: number | null; linhas: (MoLinha & { valor: number | null })[] } | null;
    },
  });
  // `total_aprovado` null = mascarado (sem permissão de custo) — não vira "R$ 0,00" enganoso.
  const moTotalAprovado = moResumo?.total_aprovado != null ? Number(moResumo.total_aprovado) : null;
  const moEstado = moResumo?.estado ?? null;
  const moLinhas = moResumo?.linhas ?? [];

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!cad?.id) throw new Error("CAD não encontrado para este modelo. Abra o CAD primeiro.");
      // RPC transacional com diff-por-id: preserva ids, atualiza/insere/deleta numa
      // transação (a lógica de `interno` fica aqui; o resto é genérico no banco).
      const _blocos = blocos.map((b) => ({
        id: b.id ?? null,
        categoria_terceirizado_id: b.categoria_terceirizado_id,
        interno: b.interno,
        // Grava empresa + representante (empresa_id é a fonte única do responsável PL).
        empresa_id: b.interno ? null : b.empresa_id,
        representante_id: b.interno ? null : b.representante_id,
        colaborador_id: b.interno ? b.colaborador_id : null,
        ativo: true,
        preco_metro_unidade: b.interno ? 0 : b.preco_metro_unidade,
        // Detalhado por tamanho/variante → os totais são a SOMA da grade (fonte única p/ financeiro/CQ).
        quantidade_enviada: b.detalhado ? somaGrade(b.grade_detalhe, "enviada") : b.quantidade_enviada,
        quantidade_recebida: b.detalhado ? somaGrade(b.grade_detalhe, "recebida") : b.quantidade_recebida,
        quantidade_defeito: b.detalhado ? somaGrade(b.grade_detalhe, "defeito") : b.quantidade_defeito,
        detalhado: b.detalhado,
        grade_detalhe: b.detalhado ? b.grade_detalhe : {},
        desconto_total: b.interno ? 0 : (Number(b.desconto_total) || 0),
        multa_total: b.interno ? 0 : (Number(b.multa_total) || 0),
        numero_parcelas: Math.max(1, Number(b.numero_parcelas) || 1),
        data_enviado: b.data_enviado,
        data_prevista: b.data_prevista,
        data_entregue: b.data_entregue,
        observacao: b.observacao,
        aviamentos_enviados: b.aviamentos_enviados,
        tecidos_enviados: b.tecidos_enviados,
      }));
      // Colab: barra o save enquanto há conflito pendente (o banner no topo lista cada um).
      if (conflitosRef.current.length > 0)
        throw new Error("Resolva os conflitos listados no aviso no topo antes de salvar.");
      // _rev_base por bloco existente (id→rev semeado da query). null=bypass; a RPC dá P0409
      // se algum bloco avançou desde a última carga.
      const _rev_base = Object.fromEntries(
        blocos.filter((b) => b.id).map((b) => [b.id as string, revByBlocoRef.current[b.id as string] ?? 0]),
      );
      const { error } = await supabase.rpc("salvar_terceirizados" as any, {
        _cad_id: cad.id,
        _blocos,
        _observacoes_molde: observacoesMolde || null,
        _rev_base,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Salvo com sucesso");
      markClean(); // limpa o indicador de "alterações não salvas" já no sucesso
      setEditing(false); // salvar re-trava ambas as abas que já estão finalizadas
      // Colab: limpa o touched/conflitos. Diferente do piloto (OC Tecido FECHA no save), esta
      // tela FICA ABERTA e re-trava — então o pós-save NÃO pode ser um "merge": o rascunho
      // ainda tem o bloco novo SEM id enquanto o refetch traz o mesmo bloco COM id (duplicaria)
      // + acenderia "alguém salvou" pro meu próprio save. Zerar `baseBlocosRef` faz o refetch
      // abaixo cair no caminho de SEED (re-adota a verdade do servidor, como o PCP sempre fez),
      // sem tocar o merge da via realtime (UPDATE alheio enquanto edito segue com base != null).
      baseBlocosRef.current = null;
      touchedBlocoIdsRef.current = new Set();
      touchedGradeRef.current = new Set();
      conflitosRef.current = [];
      setConflitos([]);
      setUltimoMerge(null);
      // Busca os dados frescos ANTES de liberar o guard de hidratação, senão a
      // re-hidratação rodava com o cache antigo (vazio) e o formulário "sumia".
      await qc.invalidateQueries({ queryKey: ["producao-terc", cad?.id] });
      await qc.invalidateQueries({ queryKey: ["terc-cad", modeloId] });
      await qc.invalidateQueries({ queryKey: ["producao-terc-list"] });
      // salvar mexe em preço/desconto/multa/datas/parcelas → o Financeiro (Serviços/
      // calendário) e a Home consomem servicos_financeiro; mantê-los em sincronia.
      qc.invalidateQueries({ queryKey: ["servicos-financeiro"] });
      await refetch();
      setMoldeHydrated(false);
      baselinedRef.current = false; // re-baseliniza o guarda na próxima hidratação
    },
    onError: async (e: any) => {
      // Colab: conflito de versão (outra pessoa salvou entre a carga e agora). Busca o
      // estado novo e roda o merge AQUI MESMO (síncrono, lendo o cache direto + os refs-
      // espelho — NUNCA via useEffect, que rodaria com refs velhos e reenviaria o mesmo
      // _rev_base rejeitado). Sem conflito de verdade → tenta salvar de novo UMA vez.
      if (e?.code === "P0409" && !retryRef.current) {
        retryRef.current = true;
        savingRef.current = true;
        await qc.refetchQueries({ queryKey: ["producao-terc", cad?.id] });
        const rows = qc.getQueryData<any[]>(["producao-terc", cad?.id]) ?? [];
        const fresh = blocosFromRows(rows);
        revByBlocoRef.current = Object.fromEntries(rows.filter((r) => r.id).map((r) => [r.id, Number(r.rev ?? 0)]));
        const base = baseBlocosRef.current ?? fresh;
        const live = blocosLiveRef.current;
        const ml = mergeLinhas({ base, draft: live, fresh, touchedIds: touchedBlocoIdsRef.current });
        const gradeConf: Conflito[] = [];
        const out = ml.linhas.map((b) => {
          if (!b.id) return b;
          const fb = fresh.find((x) => x.id === b.id); const bb = base.find((x) => x.id === b.id);
          if (!fb || !bb) return b;
          const mg = mergeGrade({ base: bb.grade_detalhe ?? {}, meu: b.grade_detalhe ?? {}, fresh: fb.grade_detalhe ?? {}, tocadas: touchedGradeRef.current });
          gradeConf.push(...mg.conflitos);
          return mg.atualizados.length || mg.conflitos.length ? { ...b, grade_detalhe: mg.valor } : b;
        });
        setBlocos(out);
        const todos = [...ml.conflitos, ...gradeConf];
        conflitosRef.current = todos;
        setConflitos(todos);
        setUltimoMerge({ atualizados: ml.atualizadas.length, conflitos: todos });
        baseBlocosRef.current = fresh;
        if (todos.length === 0) {
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

  // "Voltar uma etapa" — reverte o corte/baixa e volta o modelo para a Explosão.
  const [voltarOpen, setVoltarOpen] = useState(false);
  const reverterImpacto = useReverterImpacto(cad?.id, voltarOpen);
  const voltarMut = useMutation({
    mutationFn: async () => {
      if (!cad?.id) throw new Error("CAD não encontrado");
      const { error } = await supabase.rpc("reverter_corte_tecido" as any, { _cad_id: cad.id });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Modelo voltou para a Explosão");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["producao-terc-list"] }),
        qc.invalidateQueries({ queryKey: ["producao-cq-list"] }),
        qc.invalidateQueries({ queryKey: ["producao-explosao-list"] }),
        qc.invalidateQueries({ queryKey: ["dir-list"] }),
        qc.invalidateQueries({ queryKey: ["estoque-tecidos"] }),
        qc.invalidateQueries({ queryKey: ["dev-cad-row"] }),
        qc.invalidateQueries({ queryKey: ["dashboard-estoque"] }),
        qc.invalidateQueries({ queryKey: ["sidebar-badges"] }),
        qc.invalidateQueries({ queryKey: ["etapas-afetadas", modeloId] }),
      ]);
      (onForceClose ?? onClose)?.();
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao voltar etapa")),
  });


  // Trava POR ABA: cada etapa (pré/pós) tem seu "finalizado" + lápis. Finalizar o pré
  // não trava o pós (que ainda nem aconteceu), e vice-versa.
  const blocosDaAba = blocos.filter((b) => catEtapa(b.categoria_terceirizado_id) === tabEtapa);
  // Botões "Categorias do Serviço" (só p/ ADICIONAR bloco novo): categoria inativa some,
  // exceto se já existir um bloco dela no modelo (aí some esmaecida — permite editar o
  // existente, mas não convida a criar outro).
  const catsDaAba = (categorias as any[]).filter(
    (cat) =>
      (cat.etapa ?? "ate_costura") === tabEtapa &&
      (cat.ativo !== false || blocos.some((b) => b.categoria_terceirizado_id === cat.id)),
  );
  // A trava reflete o estado SALVO (existing), NÃO o que está sendo digitado — senão travava no
  // meio da digitação (ex.: ao começar a digitar a qtd recebida). Só trava após Salvar. Marcar
  // "não há pós" também trava (o checkbox auto-salva).
  const salvosDaAba = ((existing as any[]) ?? []).filter((r) => catEtapa(r.categoria_terceirizado_id) === tabEtapa);
  const abaFinalizada =
    (tabEtapa === "pos_costura" && semAcabamento && salvosDaAba.length === 0) ||
    (salvosDaAba.length > 0 && salvosDaAba.every(blocoFinalizado));
  const locked = abaFinalizada && !editing;

  // Regra 2 — botões na barra STICKY do rodapé (todos os tamanhos): Voltar à ESQUERDA,
  // Salvar/Editar à DIREITA (ml-auto). No modo Sheet o Voltar dispara `onClose` (o pai
  // guarda o descarte); na página inteira navega pela rota.
  const backButton = onClose ? (
    <Button type="button" variant="outline" onClick={onClose} aria-label="Voltar">
      <ArrowLeft className="h-4 w-4 mr-1" />Voltar
    </Button>
  ) : (
    <Button asChild variant="outline" aria-label="Voltar">
      <Link to="/pcp/servicos"><ArrowLeft className="h-4 w-4 mr-1" />Voltar</Link>
    </Button>
  );
  // "Voltar uma etapa" (secundário) vive na barra de ações do rodapé, logo à ESQUERDA
  // do Salvar (que fica na extrema direita com ml-auto). Empurrado p/ a direita por ml-auto.
  const voltarEtapaButton = cad?.id ? (
    <Button className="ml-auto" variant="outline" size="icon" onClick={() => setVoltarOpen(true)} disabled={voltarMut.isPending || readOnly} title="Voltar uma etapa (volta pra Explosão)" aria-label="Voltar uma etapa">
      <Undo2 className="h-4 w-4" />
    </Button>
  ) : null;
  // Salvar/Editar na extrema direita. Se "voltar uma etapa" existe, ele já carrega o ml-auto
  // (empurra ambos p/ a direita); senão o próprio Salvar/Editar carrega o ml-auto.
  const actionButtons = locked ? (
    <Button className={voltarEtapaButton ? "" : "ml-auto"} variant="outline" size="icon" onClick={() => setEditing(true)} disabled={readOnly} aria-label="Editar">
      <Pencil className="h-4 w-4" />
    </Button>
  ) : (
    <Button className={voltarEtapaButton ? "" : "ml-auto"} onClick={() => saveMut.mutate()} disabled={saveMut.isPending || readOnly}>
      <Save className="h-4 w-4 mr-2" /> Salvar
    </Button>
  );

  // Modo Sheet (via terceirizados.index): flex column p/ o rodapé de ações grudar embaixo.
  // Modo página inteira: container com pb-24 (a barra de ações é o PageActionBar em portal).
  return (
    <div className={onClose ? "flex h-full flex-col min-h-0" : ""}>
      <div className={`${onClose ? "flex-1 overflow-y-auto w-full " : "container mx-auto "}p-3 sm:p-6 space-y-6 ${onClose ? "" : "pb-24"}`}>
      <VerificarRevisao modeloId={modeloId} etapa="terceirizados" />
      {/* Cabeçalho: breadcrumb + botões SECUNDÁRIOS de impressão. "Voltar uma etapa" e as
          ações primárias (Voltar / Salvar) ficam no rodapé sticky. */}
      <div className="flex items-center justify-between gap-2">
        <Breadcrumb items={[{ label: "PCP", to: "/pcp/servicos" }, { label: modelo?.ref ?? "…" }]} />
        <div className="flex items-center gap-2">
          <UnsavedIndicator show={dirty} className="shrink-0" />
          <Button variant="outline" className="hidden md:inline-flex" onClick={() => { setPrintTarget("ficha"); printWithImages(); }} disabled={!cad?.id}>
            <FileText className="h-4 w-4 mr-2" /> Ficha Técnica
          </Button>
          <Button variant="outline" className="hidden md:inline-flex" onClick={() => { setPrintTarget("os"); printWithImages(); }} disabled={osItens.length === 0}>
            <Printer className="h-4 w-4 mr-2" /> Imprimir OS
          </Button>
        </div>
      </div>

      {/* Colab: presença + resultado do merge + resolução genérica de conflitos. FORA do
          fieldset (resolver conflito precisa funcionar mesmo com a aba travada). */}
      <ColabBanner
        presentes={presentes}
        ultimoMerge={ultimoMerge}
        conflitos={conflitos}
        onResolver={resolverPorPath}
        rotulo={rotuloConflito}
      />

      {/* Abas Pré/Pós — FORA do fieldset: travar uma aba não pode impedir trocar de aba. */}
      <div className="flex rounded-md border p-0.5 w-fit">
        <Button size="sm" variant={tabEtapa === "ate_costura" ? "secondary" : "ghost"} onClick={() => setTabEtapa("ate_costura")}>
          Pré (até costura)
        </Button>
        <Button size="sm" variant={tabEtapa === "pos_costura" ? "secondary" : "ghost"} onClick={() => setTabEtapa("pos_costura")}>
          Pós (acabamento)
        </Button>
      </div>

      {/* "Não há acabamento": FORA do fieldset, pra continuar clicável mesmo com a aba
          travada (senão, pra desmarcar, precisaria clicar no lápis antes). */}
      {tabEtapa === "pos_costura" && (
        <label className="flex items-start gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm w-fit">
          <Checkbox
            className="mt-0.5"
            checked={semAcabamento}
            onCheckedChange={(v) => semAcabamentoMut.mutate(Boolean(v))}
            disabled={blocosDaAba.length > 0 || readOnly || !cad?.id}
          />
          <span>Este modelo <b>não tem acabamento</b> (pós).</span>
        </label>
      )}

      <fieldset disabled={readOnly || locked} className="contents">

      <header className="flex items-start gap-3">
        <Users className="h-7 w-7 text-primary mt-0.5 shrink-0" />
        <ModeloResumoFoto
          fontes={[(modelo as any)?.fotos_modelo?.[0], (modelo as any)?.desenho_tecnico_url, (modelo as any)?.croqui_url]}
          nome={modelo?.nome} className="h-14 w-14"
        />
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold">
            {modelo?.ref ?? "…"} — {modelo?.nome ?? ""}
          </h1>
          <p className="text-sm text-muted-foreground">
            {(modelo as any)?.categoria_nome ?? "—"} • {modelo?.colecao ?? "—"}
          </p>
          <ModeloResumoMeta
            subcolecao={(modelo as any)?.subcolecao} lancamento={(modelo as any)?.semana}
            mesNome={(modelo as any)?.mes?.mes} anoNome={(modelo as any)?.ano?.ano}
          />
        </div>
      </header>

      {/* Status geral */}
      <Card className="p-4 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        <div>
          <Label className="text-xs text-muted-foreground">Grade Total Geral</Label>
          <div className="mt-1 text-sm font-semibold">{fmtNum(gradeTotalGeral)}</div>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Status Pré</Label>
          <div className="mt-1">
            <Badge className={`${STATUS_COLORS[statusPre] ?? "bg-muted"} text-white`}>{STATUS_LABELS[statusPre] ?? statusPre}</Badge>
          </div>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Status Pós</Label>
          <div className="mt-1">
            <Badge className={`${STATUS_COLORS[statusPos] ?? "bg-muted"} text-white`}>{STATUS_LABELS[statusPos] ?? statusPos}</Badge>
          </div>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Status Geral</Label>
          <div className="mt-1">
            <Badge className={`${STATUS_COLORS[statusGeral] ?? "bg-muted"} text-white`}>{STATUS_LABELS[statusGeral] ?? statusGeral}</Badge>
          </div>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Data Inicial</Label>
          <div className="mt-1 text-sm">{dataInicial ? dataInicial.split("-").reverse().join("/") : "—"}</div>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Data Final</Label>
          <div className="mt-1 text-sm">{dataFinal ? dataFinal.split("-").reverse().join("/") : "—"}</div>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">SLA (dias)</Label>
          <div className="mt-1 text-sm">{slaDias ?? "—"}</div>
        </div>
        {podeVerPrecos && (
        <div>
          <Label className="text-xs text-muted-foreground">Custo real (c/ serviço) / peça</Label>
          <div
            className="mt-1 text-sm font-bold text-primary"
            title={`Materiais CAD ${brl(Number(materiaisPorPeca) || 0)} + serviço ${brl(servicoPorPeca)}${custosAdicionaisPeca > 0 ? ` + adicionais ${brl(custosAdicionaisPeca)}` : ""}`}
          >
            {brl(custoRealPeca)}
          </div>
          {custosAdicionaisPeca > 0 && (
            <div className="text-xs text-muted-foreground">inclui custos adicionais: {brl(custosAdicionaisPeca)}</div>
          )}
        </div>
        )}
        {podeVerPrecos && (
        <div>
          {/* MO Aprovada = MO PLANEJADA aprovada (Σ modelo_servico_mo.valor onde aprovado=true),
              com detalhe por serviço (Task 6). Distinto do "Custo real (c/ serviço)/peça" acima
              (blocos executados na produção). */}
          <Label className="text-xs text-muted-foreground">MO Aprovada (planejada)</Label>
          <div
            className={`mt-1 text-sm font-bold ${moEstado === "aprovada" ? "text-emerald-600" : moEstado === "reprovada" ? "text-destructive" : "text-foreground"}`}
            title={moLinhas.map((l) => `${l.nome}: ${l.valor != null ? brl(Number(l.valor)) : "—"} — ${l.aprovado === true ? "aprovada" : l.aprovado === false ? "reprovada" : "pendente"}`).join("\n") || "Sem serviços de mão de obra"}
          >
            {moTotalAprovado != null ? brl(moTotalAprovado) : "—"}
          </div>
          <div className={`text-xs ${moEstado === "aprovada" ? "text-emerald-600" : moEstado === "reprovada" ? "text-destructive" : moEstado === "sem_servico" ? "text-muted-foreground" : "text-amber-600"}`}>
            {moEstado === "aprovada" ? "✓ aprovada" : moEstado === "reprovada" ? "reprovada" : moEstado === "sem_servico" ? "sem serviços" : "aprovação pendente"}
          </div>
          {moLinhas.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
              {moLinhas.map((l) => (
                <li key={l.categoria_terceirizado_id ?? "legado"} className="flex justify-between gap-2">
                  <span className="truncate">{l.nome}</span>
                  <span className={`shrink-0 ${l.aprovado === true ? "text-emerald-600" : l.aprovado === false ? "text-destructive" : "text-amber-600"}`}>
                    {l.valor != null ? brl(Number(l.valor)) : "—"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        )}
      </Card>

      {/* Categoria buttons (só as da etapa da aba) */}
      <Card className="p-4">
        <Label className="text-sm font-semibold mb-3 block">Categorias do Serviço (clique para adicionar um bloco)</Label>
        <div className="flex flex-wrap gap-2">
          {catsDaAba.map((c) => {
            const count = countByCat[c.id] ?? 0;
            const inativa = c.ativo === false;
            return (
              <Button
                key={c.id}
                type="button"
                variant={count > 0 ? "default" : "outline"}
                size="sm"
                className={inativa ? "opacity-60" : undefined}
                title={inativa ? "Serviço desativado — some das novas seleções" : undefined}
                onClick={() => addCategoria(c.id, c.nome)}
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                {c.nome}
                {count > 0 && <span className="ml-1 opacity-80">({count})</span>}
              </Button>
            );
          })}
          {categoriasLoading && (
            <p className="text-sm text-muted-foreground">Carregando categorias…</p>
          )}
          {categoriasError && (
            <p className="text-sm text-destructive">
              Erro ao carregar categorias: {(categoriasError as any)?.message ?? "desconhecido"}
            </p>
          )}
          {!categoriasLoading && !categoriasError && (categorias as any[]).length === 0 && (
            <p className="text-sm text-muted-foreground">Cadastre categorias em Cadastro &gt; Atributos.</p>
          )}
        </div>
      </Card>

      {/* Blocos (só os da etapa da aba; idx preservado p/ updateBloco) */}
      {blocos.map((b, idx) => {
        if (catEtapa(b.categoria_terceirizado_id) !== tabEtapa) return null;
        const catNome = (categorias as any[]).find((c) => c.id === b.categoria_terceirizado_id)?.nome ?? "—";
        const empresasCat = empresasDaCategoria(b.categoria_terceirizado_id);
        const empresaSel = (empresasServico as any[]).find((e) => e.id === b.empresa_id);
        const repsDaEmpresa = (empresaSel?.representantes ?? []) as { id: string; nome: string | null }[];
        const colabsCat = colaboradoresDaCategoria(b.categoria_terceirizado_id);
        // SLA do serviço: dias entre enviado e entregue (calculado das datas).
        const slaBloco =
          b.data_enviado && b.data_entregue
            ? Math.round((new Date(b.data_entregue).getTime() - new Date(b.data_enviado).getTime()) / 86400000)
            : null;
        // Nº do bloco entre os da mesma categoria (ex.: "Estamparia 2"), só quando repete.
        const mesmaCatAteAqui = blocos.slice(0, idx + 1).filter((x) => x.categoria_terceirizado_id === b.categoria_terceirizado_id).length;
        const totalMesmaCat = countByCat[b.categoria_terceirizado_id] ?? 1;
        return (
          <Card key={b._key} className="p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold text-lg">
                {catNome}
                {totalMesmaCat > 1 && <span className="text-muted-foreground font-normal"> #{mesmaCatAteAqui}</span>}
              </h3>
              <div className="flex items-center gap-2">
                {/* Toggle Interno / PL (Interno esconde o responsável) */}
                <div className="flex rounded-md border overflow-hidden text-xs font-medium">
                  <button
                    type="button"
                    onClick={() => updateBloco(idx, { interno: true, empresa_id: null, representante_id: null })}
                    className={cn(
                      "px-2.5 py-1 max-sm:py-2 transition-colors",
                      b.interno ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted",
                    )}
                  >
                    Interno
                  </button>
                  <button
                    type="button"
                    onClick={() => updateBloco(idx, { interno: false })}
                    className={cn(
                      "px-2.5 py-1 max-sm:py-2 transition-colors border-l",
                      !b.interno ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted",
                    )}
                  >
                    PL
                  </button>
                </div>
                <Badge variant="outline" className="text-xs whitespace-nowrap">
                  SLA: {slaBloco != null ? `${slaBloco}d` : "—"}
                </Badge>
                {(() => {
                  // Badge do bloco pela MESMA regra do lock/status (blocoFinalizado), não pelo
                  // b.status cru do trigger (que vira 'finalizado' só com data_entregue).
                  const bSt = blocoFinalizado(b) ? "finalizado" : b.data_enviado ? "em_andamento" : "pendente";
                  return <Badge className={`${STATUS_COLORS[bSt] ?? "bg-muted"} text-white`}>{STATUS_LABELS[bSt] ?? bSt}</Badge>;
                })()}
                <Button type="button" size="icon" variant="ghost" onClick={() => removeBloco(idx)} aria-label="Remover bloco">
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              {/* Toggle: destrinchar as quantidades por tamanho × variante. Ligar pré-preenche a
                  Enviada com a grade PLANEJADA do modelo (uma vez). Ligado, os 3 totais viram Σ. */}
              <label className="col-span-full flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={b.detalhado}
                  onChange={(e) => {
                    const on = e.target.checked;
                    if (on && gradeTpl && somaGrade(b.grade_detalhe, "enviada") === 0 && Object.keys(b.grade_detalhe ?? {}).length === 0) {
                      const g: GradeDetalhe = {};
                      for (const v of gradeTpl.variantes) { g[v.id] = {}; for (const t of gradeTpl.tamanhos) g[v.id][t] = { enviada: Number(gradeTpl.planejado[v.id]?.[t]) || 0, cortada: 0, recebida: 0, defeito: 0 }; }
                      updateBloco(idx, { detalhado: true, grade_detalhe: g });
                    } else updateBloco(idx, { detalhado: on });
                  }}
                />
                <span>Quantidade por tamanho e variante (destrinchar a grade)</span>
              </label>
              {b.interno ? (
                <div>
                  <Label className="text-xs">Responsável</Label>
                  <Select
                    value={b.colaborador_id ?? ""}
                    onValueChange={(v) => updateBloco(idx, { colaborador_id: v || null })}
                  >
                    <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
                    <SelectContent>
                      {colabsCat.length === 0 && (
                        <div className="p-2 text-xs text-muted-foreground">
                          Nenhum colaborador desta categoria. Em Cadastro &gt; Colaboradores, crie um
                          tipo ligado a "{catNome}" e cadastre os nomes.
                        </div>
                      )}
                      {colabsCat.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <>
                  <div>
                    <Label className="text-xs">Empresa</Label>
                    <Select
                      value={b.empresa_id ?? ""}
                      onValueChange={(v) =>
                        // Trocar a empresa limpa o representante (reps são daquela empresa).
                        updateBloco(idx, { empresa_id: v || null, representante_id: null })
                      }
                    >
                      <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
                      <SelectContent>
                        {empresasCat.length === 0 && (
                          <div className="p-2 text-xs text-muted-foreground">Nenhuma empresa cadastrada nesta categoria.</div>
                        )}
                        {empresasCat.map((e: any) => (
                          <SelectItem key={e.id} value={e.id}>{e.nome_fantasia}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Representante (opcional)</Label>
                    <Select
                      value={b.representante_id ?? "__direto__"}
                      onValueChange={(v) =>
                        updateBloco(idx, { representante_id: v === "__direto__" ? null : v })
                      }
                      disabled={!b.empresa_id}
                    >
                      <SelectTrigger><SelectValue placeholder="Direto na empresa" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__direto__">Direto na empresa</SelectItem>
                        {repsDaEmpresa.map((r) => (
                          <SelectItem key={r.id} value={r.id}>{r.nome ?? "—"}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}
              {!b.interno && podeVerPrecos && (
                <div>
                  <Label className="text-xs">Preço por metro/unidade</Label>
                  <NumberInput
                    type="number"
                    step="0.01"
                    placeholder="0,00"
                    value={b.preco_metro_unidade || ""}
                    onChange={(e) => updateBloco(idx, { preco_metro_unidade: Number(e.target.value) })}
                  />
                </div>
              )}
              <div>
                <Label className="text-xs">Qtd Enviada{b.detalhado ? " (Σ grade)" : ""}</Label>
                <NumberInput
                  type="number"
                  placeholder="0,00"
                  disabled={b.detalhado}
                  value={b.detalhado ? somaGrade(b.grade_detalhe, "enviada") : (b.quantidade_enviada || "")}
                  onChange={(e) => updateBloco(idx, { quantidade_enviada: Number(e.target.value) })}
                />
              </div>
              {b.detalhado && (
                <div>
                  <Label className="text-xs">Qtd Cortada (Σ grade)</Label>
                  <Input readOnly value={somaGrade(b.grade_detalhe, "cortada")} className="bg-muted/40" />
                </div>
              )}
              {b.detalhado && (
                <div>
                  <Label className="text-xs">Saldo a receber (Σ)</Label>
                  <Input readOnly value={somaGrade(b.grade_detalhe, "cortada") - somaGrade(b.grade_detalhe, "recebida")} className="bg-muted/40" />
                </div>
              )}

              <div>
                <Label className="text-xs">Data Enviado</Label>
                <DateField
                  value={b.data_enviado ?? ""}
                  onChange={(e) => updateBloco(idx, { data_enviado: e.target.value || null })}
                />
              </div>
              <div>
                <Label className="text-xs">Data Prevista</Label>
                <DateField
                  value={b.data_prevista ?? ""}
                  onChange={(e) => updateBloco(idx, { data_prevista: e.target.value || null })}
                />
              </div>
              <div>
                <Label className="text-xs">Data Entregue</Label>
                <DateField
                  value={b.data_entregue ?? ""}
                  onChange={(e) => updateBloco(idx, { data_entregue: e.target.value || null })}
                />
              </div>

              <div>
                <Label className="text-xs">Qtd Recebida{b.detalhado ? " (Σ grade)" : ""}</Label>
                <NumberInput
                  type="number"
                  placeholder="0,00"
                  disabled={b.detalhado}
                  value={b.detalhado ? somaGrade(b.grade_detalhe, "recebida") : (b.quantidade_recebida || "")}
                  onChange={(e) => updateBloco(idx, { quantidade_recebida: Number(e.target.value) })}
                />
              </div>
              <div>
                <Label className="text-xs">Qtd Defeito{b.detalhado ? " (Σ grade)" : ""}</Label>
                <NumberInput
                  type="number"
                  placeholder="0,00"
                  disabled={b.detalhado}
                  value={b.detalhado ? somaGrade(b.grade_detalhe, "defeito") : (b.quantidade_defeito || "")}
                  onChange={(e) => updateBloco(idx, { quantidade_defeito: Number(e.target.value) })}
                />
              </div>
              {b.detalhado && (
                <div className="col-span-full rounded-md border bg-muted/20 p-3">
                  <div className="mb-2 text-xs text-muted-foreground">Grade por <b>tamanho × variante</b> — a <b>Enviada</b> vem pré-preenchida da grade planejada; ajuste conforme o envio/recebimento.</div>
                  {(() => {
                    const violacoes = celulasRecebidaAcimaCortada(b.grade_detalhe);
                    if (violacoes.length === 0) return null;
                    return (
                      <div className="mb-2 flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs font-medium text-destructive">
                        <AlertTriangle className="h-4 w-4 shrink-0" />
                        <span>
                          Recebida acima da Cortada em {violacoes.length} célula{violacoes.length > 1 ? "s" : ""} — confira.
                        </span>
                      </div>
                    );
                  })()}
                  <GradeEditor tpl={gradeTpl ?? { variantes: [], tamanhos: [] }} grade={b.grade_detalhe} onChange={(g) => updateBloco(idx, { grade_detalhe: g })} />
                </div>
              )}
              {!b.interno && (
                <div>
                  <Label className="text-xs">Desconto total</Label>
                  <NumberInput
                    type="number"
                    step="0.01"
                    placeholder="0,00"
                    value={b.desconto_total || ""}
                    onChange={(e) => updateBloco(idx, { desconto_total: Number(e.target.value) })}
                  />
                </div>
              )}
              {!b.interno && (
                <div>
                  <Label className="text-xs">Multa total</Label>
                  <NumberInput
                    type="number"
                    step="0.01"
                    placeholder="0,00"
                    value={b.multa_total || ""}
                    onChange={(e) => updateBloco(idx, { multa_total: Number(e.target.value) })}
                  />
                </div>
              )}
              {!b.interno && (
                <div>
                  <Label className="text-xs">Nº de parcelas</Label>
                  <NumberInput
                    type="number"
                    integer
                    min={1}
                    value={b.numero_parcelas}
                    onChange={(e) => updateBloco(idx, { numero_parcelas: Math.max(1, Math.trunc(Number(e.target.value)) || 1) })}
                  />
                </div>
              )}
              {!b.interno && podeVerPrecos && (
                <div>
                  <Label className="text-xs">Custo Total</Label>
                  <Input
                    readOnly
                    value={fmtNum((Number(b.preco_metro_unidade) || 0) * (Number(b.quantidade_enviada) || 0) - (Number(b.desconto_total) || 0) + (Number(b.multa_total) || 0))}
                    className="bg-muted"
                  />
                </div>
              )}
            </div>

            <div>
              <Label className="text-xs mb-2 block">Aviamentos Enviados</Label>
              <div className="flex flex-wrap gap-2">
                {(aviamentosModelo as any[]).length === 0 && (
                  <p className="text-xs text-muted-foreground">Nenhum aviamento vinculado ao modelo.</p>
                )}
                {(aviamentosModelo as any[]).map((a) => {
                  const checked = b.aviamentos_enviados.includes(a.id);
                  return (
                    <Button
                      key={a.id}
                      type="button"
                      size="sm"
                      variant={checked ? "default" : "outline"}
                      onClick={() =>
                        updateBloco(idx, {
                          aviamentos_enviados: checked
                            ? b.aviamentos_enviados.filter((x) => x !== a.id)
                            : [...b.aviamentos_enviados, a.id],
                        })
                      }
                    >
                      {a.nome}
                    </Button>
                  );
                })}
              </div>
            </div>

            <div>
              <Label className="text-xs mb-2 block">Tecidos, Forros e Entretelas Enviados (variantes)</Label>
              {(tecidosModelo as any[]).length === 0 && (
                <p className="text-xs text-muted-foreground">Nenhum tecido/forro/entretela vinculado ao modelo.</p>
              )}
              <div className="space-y-2">
                {(tecidosModelo as any[]).map((t) => {
                  const tipoLabel = t.tipo === "forro" ? " (Forro)" : t.tipo === "entretela" ? " (Entretela)" : "";
                  return (
                    <div key={t.id}>
                      <p className="text-xs font-medium">{t.nome}{tipoLabel}</p>
                      <div className="flex flex-wrap gap-2 mt-1">
                        {t.variantes.length === 0 && (
                          <span className="text-xs text-muted-foreground italic">Sem variantes cadastradas.</span>
                        )}
                        {t.variantes.map((v: any) => {
                          const checked = b.tecidos_enviados.includes(v.id);
                          return (
                            <Button
                              key={v.id}
                              type="button"
                              size="sm"
                              variant={checked ? "default" : "outline"}
                              onClick={() =>
                                updateBloco(idx, {
                                  tecidos_enviados: checked
                                    ? b.tecidos_enviados.filter((x) => x !== v.id)
                                    : [...b.tecidos_enviados, v.id],
                                })
                              }
                            >
                              {v.label}
                            </Button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <Label className="text-xs">Observação</Label>
              <Textarea
                value={b.observacao}
                onChange={(e) => updateBloco(idx, { observacao: e.target.value })}
                rows={2}
              />
            </div>
          </Card>
        );
      })}

      {blocos.length === 0 && (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          Adicione uma categoria acima para começar.
        </Card>
      )}

      <Card className="p-5 space-y-2">
        <Label className="text-sm font-semibold">Observação de Partes do Molde</Label>
        <Textarea
          rows={3}
          value={observacoesMolde}
          onChange={(e) => setObservacoesMolde(e.target.value)}
          placeholder="Instruções de corte / partes do molde…"
        />
        <p className="text-xs text-muted-foreground">Mesmo campo do CAD / Ficha de Corte.</p>
      </Card>

      <ModeloObservacoes modeloId={modeloId} readOnly={readOnly} />

      {!cad?.id && (
        <Card className="p-4 border-amber-500/50 bg-amber-500/10 text-sm">
          Atenção: este modelo ainda não possui um registro de CAD. Abra a página de CAD desse modelo antes de salvar.
        </Card>
      )}
      </fieldset>

      {/* Documento de impressão (oculto na tela; aparece só na impressão). Alterna
          entre Ficha Técnica e Ordem de Serviço conforme o botão — o CSS de print
          mostra TODAS as .print-area, então só uma pode estar montada por vez. */}
      {printTarget === "os" ? (
        <OrdemServicoTerceirizados modelo={modelo} itens={osItens} dataStr={new Date().toLocaleDateString("pt-BR")} />
      ) : (
        <FichaTecnica modeloId={modeloId} />
      )}

      <AlertDialog open={voltarOpen} onOpenChange={setVoltarOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Voltar este modelo para a Explosão?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div><ReverterImpacto cadId={cad?.id} open={voltarOpen} /></div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={voltarMut.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={voltarMut.isPending || reverterImpacto.data?.temPaga}
              onClick={() => voltarMut.mutate()}
            >
              Voltar uma etapa
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Full-page: guarda o "sair sem salvar" (bloqueia navegação de rota). No modal
          (Sheet no index) o guarda é renderizado pelo pai — aqui não duplica. */}
      {!onClose && (
        <UnsavedChangesGuard confirm={confirm} message="Há alterações não salvas nos Serviços." />
      )}
      </div>

      {/* Regra 2 — barra de ações sticky no rodapé (todos os tamanhos).
          Sheet: rodapé in-flow do próprio modal. Página inteira: PageActionBar (portal no body). */}
      {onClose ? (
        <div className="shrink-0 border-t bg-background p-3 flex items-center gap-2">
          {backButton}
          {voltarEtapaButton}
          {actionButtons}
        </div>
      ) : (
        <PageActionBar>
          {backButton}
          {voltarEtapaButton}
          {actionButtons}
        </PageActionBar>
      )}
    </div>
  );
}

// Editor da grade por tamanho × variante — 4 tabelas (Enviada / Cortada / Recebida / Defeito) +
// Saldo a receber (derivado, read-only). Chaveado por variante_tecido_id; tamanho no formato
// "38|P" (exibe o rótulo). Total por linha à direita.
const CAMPOS_GRADE: { k: keyof CelulaGrade; label: string }[] = [
  { k: "enviada", label: "Enviada" },
  { k: "cortada", label: "Cortada" },
  { k: "recebida", label: "Recebida" },
  { k: "defeito", label: "Defeito" },
];
function GradeEditor({
  tpl, grade, onChange, disabled,
}: {
  tpl: { variantes: { id: string; label: string }[]; tamanhos: string[] };
  grade: GradeDetalhe;
  onChange: (g: GradeDetalhe) => void;
  disabled?: boolean;
}) {
  const tamLabel = (t: string) => (t.includes("|") ? t.split("|")[1] || t : t);
  const cel = (vid: string, t: string): CelulaGrade => grade[vid]?.[t] ?? CELULA_ZERO;
  const set = (vid: string, t: string, campo: keyof CelulaGrade, val: number) => {
    const g: GradeDetalhe = { ...grade, [vid]: { ...(grade[vid] ?? {}) } };
    g[vid][t] = { ...CELULA_ZERO, ...(g[vid][t] ?? {}), [campo]: val };
    onChange(g);
  };
  if (!tpl.variantes.length || !tpl.tamanhos.length)
    return <p className="text-xs text-muted-foreground">Sem grade planejada para destrinchar — defina a grade (tamanhos/variantes) do modelo primeiro.</p>;
  // Colgroup COMPARTILHADO por TODAS as grades (Enviada/Cortada/Recebida/Defeito + Saldo) —
  // com table-fixed, garante que cada coluna tenha a MESMA largura em todas as tabelas, então
  // as colunas alinham verticalmente independente do conteúdo (input vs texto). (dono, ago/2026)
  const colGroup = (
    <colgroup>
      <col className="w-28" />
      {tpl.tamanhos.map((t) => <col key={t} className="w-14" />)}
      <col className="w-12" />
    </colgroup>
  );
  return (
    <div className="space-y-3">
      {CAMPOS_GRADE.map(({ k, label }) => (
        <div key={k}>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
          <div className="overflow-x-auto">
            <table className="table-fixed text-xs tabular-nums">
              {colGroup}
              <thead className="text-muted-foreground">
                <tr>
                  <th className="p-1 text-left font-medium">Variante</th>
                  {tpl.tamanhos.map((t) => <th key={t} className="p-1 text-center font-medium">{tamLabel(t)}</th>)}
                  <th className="p-1 text-center font-medium">Σ</th>
                </tr>
              </thead>
              <tbody>
                {tpl.variantes.map((v) => {
                  const total = tpl.tamanhos.reduce((s, t) => s + (Number(cel(v.id, t)[k]) || 0), 0);
                  return (
                    <tr key={v.id} className="border-t">
                      <td className="truncate p-1" title={v.label}>{v.label}</td>
                      {tpl.tamanhos.map((t) => {
                        // Recebida não deveria superar a Cortada — alerta visual (não bloqueia o save).
                        const alerta = k === "recebida" && recebidaExcedeCortada(cel(v.id, t));
                        return (
                          <td key={t} className="p-0.5">
                            <input
                              type="number" min={0} disabled={disabled}
                              title={alerta ? "Recebida maior que a Cortada — confira." : undefined}
                              className={`h-7 w-full rounded border bg-background px-1 text-center disabled:opacity-60 ${alerta ? "border-destructive text-destructive font-semibold" : ""}`}
                              value={cel(v.id, t)[k] || ""}
                              onChange={(e) => set(v.id, t, k, Number(e.target.value) || 0)}
                            />
                          </td>
                        );
                      })}
                      <td className="p-1 text-center font-medium">{total}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      {/* Saldo a receber = Cortada − Recebida (derivado; negativo = recebido a mais). */}
      <div>
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Saldo a receber (Cortada − Recebida)</div>
        <div className="overflow-x-auto">
          <table className="table-fixed text-xs tabular-nums">
            {colGroup}
            <thead className="text-muted-foreground">
              <tr>
                <th className="p-1 text-left font-medium">Variante</th>
                {tpl.tamanhos.map((t) => <th key={t} className="p-1 text-center font-medium">{tamLabel(t)}</th>)}
                <th className="p-1 text-center font-medium">Σ</th>
              </tr>
            </thead>
            <tbody>
              {tpl.variantes.map((v) => {
                let linhaTotal = 0;
                return (
                  <tr key={v.id} className="border-t">
                    <td className="truncate p-1" title={v.label}>{v.label}</td>
                    {tpl.tamanhos.map((t) => {
                      const s = saldoCelula(cel(v.id, t)); linhaTotal += s;
                      return <td key={t} className={`p-1 text-center ${s < 0 ? "text-destructive font-semibold" : ""}`}>{s}</td>;
                    })}
                    <td className={`p-1 text-center font-medium ${linhaTotal < 0 ? "text-destructive" : ""}`}>{linhaTotal}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
