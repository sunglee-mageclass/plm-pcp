import { useEffect, useMemo, useState } from "react";
import { brl, fmtNum } from "@/lib/format";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Users, Save, Plus, Trash2, FileText, Pencil, Printer, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { corApelidoLabelServico } from "@/lib/variante";
import { somaCustosAdicionais } from "@/lib/custo";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/shared/DateField";
import { NumberInput } from "@/components/shared/NumberInput";
import { MobileActionBar } from "@/components/shared/MobileActionBar";
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

export const Route = createFileRoute("/_authenticated/producao/terceirizados/$modeloId")({
  component: TercDetailPage,
});

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

export function TerceirizadosDetail({ modeloId, onClose }: { modeloId: string; onClose?: () => void }) {
  const qc = useQueryClient();
  const readOnly = useReadOnly();
  // Permissão dedicada da "Aprovação" (independe do editar de Serviços): leitor vê, editor marca.

  const { data: modelo } = useQuery({
    queryKey: ["terc-modelo", modeloId],
    queryFn: async () => {
      const { data, error } = await (supabase.from("modelos") as any)
        .select("id, ref, nome, colecao, subcolecao, semana, categoria_principal_id, custos_adicionais, fotos_modelo, desenho_tecnico_url, croqui_url, mes:mes_id(mes), ano:ano_id(ano)")
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
      const { data, error } = await supabase
        .from("categorias_terceirizado")
        .select("id, nome, etapa")
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
        quantidade: Number(b.quantidade_enviada ?? 0),
        dataEnviado: b.data_enviado,
        dataPrevista: b.data_prevista,
        observacao: b.observacao ?? "",
        aviamentos: (b.aviamentos_enviados ?? []).map(aviLabel).filter(Boolean) as string[],
        tecidos: (b.tecidos_enviados ?? []).map(tecLabel).filter(Boolean) as string[],
      }));
  }, [blocos, categorias, colaboradores, empresasServico, aviamentosModelo, tecidosModelo]);
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

  // Hidrata os blocos a partir do servidor uma única vez (e de novo após salvar,
  // quando liberamos o guard). Espera a query ASSENTAR (isFetched && !isFetching):
  // hidratar do cache vazio enquanto o refetch ainda corria era o que zerava o
  // formulário ao salvar.
  useEffect(() => {
    if (hydrated) return;
    if (!cad?.id) return;
    if (!existingFetched || existingFetching) return;
    setBlocos(
      (existing as any[]).map((r) => ({
        _key: r.id ?? crypto.randomUUID(),
        id: r.id,
        categoria_terceirizado_id: r.categoria_terceirizado_id,
        interno: Boolean((r as any).interno),
        empresa_id: (r as any).empresa_id ?? null,
        representante_id: (r as any).representante_id ?? null,
        colaborador_id: (r as any).colaborador_id ?? null,
        preco_metro_unidade: Number(r.preco_metro_unidade ?? 0),
        aprovado: Boolean((r as any).aprovado),
        quantidade_enviada: Number(r.quantidade_enviada ?? 0),
        quantidade_recebida: Number(r.quantidade_recebida ?? 0),
        quantidade_defeito: Number(r.quantidade_defeito ?? 0),
        desconto_total: Number((r as any).desconto_total ?? 0),
        multa_total: Number((r as any).multa_total ?? 0),
        numero_parcelas: Number((r as any).numero_parcelas ?? 1),
        data_enviado: r.data_enviado,
        data_prevista: r.data_prevista,
        data_entregue: r.data_entregue,
        status: r.status,
        observacao: r.observacao ?? "",
        aviamentos_enviados: Array.isArray(r.aviamentos_enviados) ? r.aviamentos_enviados : [],
        tecidos_enviados: Array.isArray((r as any).tecidos_enviados) ? (r as any).tecidos_enviados : [],
      })),
    );
    setHydrated(true);
  }, [existing, cad?.id, hydrated, existingFetched, existingFetching]);

  // Quantos blocos existem por categoria (a mesma categoria pode repetir).
  const countByCat = blocos.reduce<Record<string, number>>((m, b) => {
    m[b.categoria_terceirizado_id] = (m[b.categoria_terceirizado_id] ?? 0) + 1;
    return m;
  }, {});

  // Cada clique ACRESCENTA um novo bloco da categoria (pode mandar pra dois lugares).
  const addCategoria = (catId: string, catNome: string) => {
    setBlocos((bs) => [
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
      },
    ]);
  };
  const removeBloco = (idx: number) => setBlocos((bs) => bs.filter((_, i) => i !== idx));

  const updateBloco = (idx: number, patch: Partial<Bloco>) => {
    setBlocos((bs) => bs.map((b, i) => (i === idx ? { ...b, ...patch } : b)));
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
        quantidade_enviada: b.quantidade_enviada,
        quantidade_recebida: b.quantidade_recebida,
        quantidade_defeito: b.quantidade_defeito,
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
      const { error } = await supabase.rpc("salvar_terceirizados" as any, {
        _cad_id: cad.id,
        _blocos,
        _observacoes_molde: observacoesMolde || null,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Salvo com sucesso");
      setEditing(false); // salvar re-trava ambas as abas que já estão finalizadas
      // Busca os dados frescos ANTES de liberar o guard de hidratação, senão a
      // re-hidratação rodava com o cache antigo (vazio) e o formulário "sumia".
      await qc.invalidateQueries({ queryKey: ["producao-terc", cad?.id] });
      await qc.invalidateQueries({ queryKey: ["terc-cad", modeloId] });
      await qc.invalidateQueries({ queryKey: ["producao-terc-list"] });
      // salvar mexe em preço/desconto/multa/datas/parcelas → o Financeiro (Serviços/
      // calendário) e a Home consomem servicos_financeiro; mantê-los em sincronia.
      qc.invalidateQueries({ queryKey: ["servicos-financeiro"] });
      await refetch();
      setHydrated(false);
      setMoldeHydrated(false);
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao salvar")),
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
      onClose?.();
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao voltar etapa")),
  });


  // Trava POR ABA: cada etapa (pré/pós) tem seu "finalizado" + lápis. Finalizar o pré
  // não trava o pós (que ainda nem aconteceu), e vice-versa.
  const blocosDaAba = blocos.filter((b) => catEtapa(b.categoria_terceirizado_id) === tabEtapa);
  // A trava reflete o estado SALVO (existing), NÃO o que está sendo digitado — senão travava no
  // meio da digitação (ex.: ao começar a digitar a qtd recebida). Só trava após Salvar. Marcar
  // "não há pós" também trava (o checkbox auto-salva).
  const salvosDaAba = ((existing as any[]) ?? []).filter((r) => catEtapa(r.categoria_terceirizado_id) === tabEtapa);
  const abaFinalizada =
    (tabEtapa === "pos_costura" && semAcabamento && salvosDaAba.length === 0) ||
    (salvosDaAba.length > 0 && salvosDaAba.every(blocoFinalizado));
  const locked = abaFinalizada && !editing;

  return (
    <div className="container mx-auto p-3 sm:p-6 space-y-6 max-sm:pb-24">
      <VerificarRevisao modeloId={modeloId} etapa="terceirizados" />
      <div className="flex items-center justify-between">
        {onClose ? (
          <button onClick={onClose} className="max-sm:hidden text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            <ArrowLeft className="h-4 w-4" /> Voltar
          </button>
        ) : (
          <Link to="/producao/terceirizados" className="max-sm:hidden text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            <ArrowLeft className="h-4 w-4" /> Voltar
          </Link>
        )}
        <div className="flex items-center gap-2 max-sm:hidden">
          <Button variant="outline" className="hidden md:inline-flex" onClick={() => { setPrintTarget("ficha"); printWithImages(); }} disabled={!cad?.id}>
            <FileText className="h-4 w-4 mr-2" /> Ficha Técnica
          </Button>
          <Button variant="outline" className="hidden md:inline-flex" onClick={() => { setPrintTarget("os"); printWithImages(); }} disabled={osItens.length === 0}>
            <Printer className="h-4 w-4 mr-2" /> Imprimir OS
          </Button>
          {cad?.id && (
            <Button variant="outline" size="icon" onClick={() => setVoltarOpen(true)} disabled={voltarMut.isPending || readOnly} title="Voltar uma etapa (volta pra Explosão)" aria-label="Voltar uma etapa">
              <Undo2 className="h-4 w-4" />
            </Button>
          )}
          {locked ? (
            <Button variant="outline" size="icon" onClick={() => setEditing(true)} disabled={readOnly} aria-label="Editar">
              <Pencil className="h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending || readOnly}>
              <Save className="h-4 w-4 mr-2" /> Salvar
            </Button>
          )}
        </div>
      </div>

      {/* Mobile: barra fixa via portal (não o max-sm:fixed inline, que descola dentro do Sheet). */}
      <MobileActionBar>
        {onClose ? (
          <Button type="button" variant="outline" size="icon" className="mr-auto" onClick={onClose} aria-label="Voltar"><ArrowLeft className="h-4 w-4" /></Button>
        ) : (
          <Button asChild variant="outline" size="icon" className="mr-auto" aria-label="Voltar"><Link to="/producao/terceirizados"><ArrowLeft className="h-4 w-4" /></Link></Button>
        )}
        {locked ? (
          <Button variant="outline" size="icon" onClick={() => setEditing(true)} disabled={readOnly} aria-label="Editar"><Pencil className="h-4 w-4" /></Button>
        ) : (
          <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending || readOnly}><Save className="h-4 w-4 mr-2" /> Salvar</Button>
        )}
      </MobileActionBar>

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
      </Card>

      {/* Categoria buttons (só as da etapa da aba) */}
      <Card className="p-4">
        <Label className="text-sm font-semibold mb-3 block">Categorias do Serviço (clique para adicionar um bloco)</Label>
        <div className="flex flex-wrap gap-2">
          {(categorias as any[]).filter((c) => (c.etapa ?? "ate_costura") === tabEtapa).map((c) => {
            const count = countByCat[c.id] ?? 0;
            return (
              <Button
                key={c.id}
                type="button"
                variant={count > 0 ? "default" : "outline"}
                size="sm"
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
              {!b.interno && (
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
                <Label className="text-xs">Qtd Enviada</Label>
                <NumberInput
                  type="number"
                  placeholder="0,00"
                  value={b.quantidade_enviada || ""}
                  onChange={(e) => updateBloco(idx, { quantidade_enviada: Number(e.target.value) })}
                />
              </div>

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
                <Label className="text-xs">Qtd Recebida</Label>
                <NumberInput
                  type="number"
                  placeholder="0,00"
                  value={b.quantidade_recebida || ""}
                  onChange={(e) => updateBloco(idx, { quantidade_recebida: Number(e.target.value) })}
                />
              </div>
              <div>
                <Label className="text-xs">Qtd Defeito</Label>
                <NumberInput
                  type="number"
                  placeholder="0,00"
                  value={b.quantidade_defeito || ""}
                  onChange={(e) => updateBloco(idx, { quantidade_defeito: Number(e.target.value) })}
                />
              </div>
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
              {!b.interno && (
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
    </div>
  );
}
