/**
 * ExplosaoDetail — painel enxuto para a tela de Explosão.
 *
 * Carrega os dados do CAD do modelo e apresenta:
 *   - Informações do modelo (somente leitura)
 *   - Tecidos/Variantes com APENAS "Metr. a Separar/Enviar" editável (readOnly=true)
 *   - Botão "Ficha de Corte" (imprime via printWithImages)
 *   - Botão "Enviar ao Corte" (salva metragem_enviada → baixar_estoque_tecido_corte)
 *
 * NÃO mostra grade, aviamentos, etiquetas, nem permite editar CAD completo.
 * Usa CadEditor apenas para impressão e leitura de dados.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDirtySnapshot } from "@/hooks/useDirtySnapshot";
import { ArrowLeft, ImageIcon, Printer, RotateCcw, Save, Send } from "lucide-react";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { varianteLabel } from "@/lib/variante";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ModeloPhoto } from "@/components/producao/cad/shared";
import { CadTecidosSection } from "@/components/producao/cad/CadTecidosSection";
import { CadFichaCorte } from "@/components/producao/cad/CadFichaCorte";
import { VersaoBadge } from "@/components/shared/VersaoBadge";
import { Breadcrumb } from "@/components/shared/Breadcrumb";
import { UnsavedIndicator } from "@/components/shared/UnsavedIndicator";
import { printWithImages } from "@/lib/print";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
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
import type { TecidoRow, GradeRow, VarianteRow } from "@/components/producao/cad/types";
import { calcCusto } from "@/components/producao/cad/types";

type Props = {
  modeloId: string;
  onEnviado: () => void;
  /** Fechar guardado (Voltar): passa pelo requestClose do pai (confirma se houver edição). */
  onClose?: () => void;
  /** Reporta ao pai (que dona o Sheet) se há edições de metragem pendentes. */
  onDirtyChange?: (dirty: boolean) => void;
};

export function ExplosaoDetail({ modeloId, onEnviado, onClose, onDirtyChange }: Props) {
  const qc = useQueryClient();
  const tenantId = useActiveTenantId();
  const [confirmZeroOpen, setConfirmZeroOpen] = useState(false);
  const [voltarOpen, setVoltarOpen] = useState(false);

  // --- queries (mesmo padrão do CadEditor, mas apenas o necessário) ---
  const { data: modelo } = useQuery({
    queryKey: ["explosao-modelo", modeloId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modelos")
        .select(
          "*, estilista:estilista_id(nome), linha:linha_id(nome), cat_p:categoria_principal_id(nome, grupo:grupo_id(nome)), sub1:subcategoria1_id(nome), sub2:subcategoria2_id(nome), mes:mes_id(mes), ano:ano_id(ano)",
        )
        .eq("id", modeloId)
        .single();
      if (error) throw error;
      return data as any;
    },
  });

  const { data: cadRow } = useQuery({
    queryKey: ["explosao-cad-row", modeloId],
    queryFn: async () => {
      const { data } = await supabase.from("cad").select("*").eq("modelo_id", modeloId).maybeSingle();
      return data;
    },
  });

  const { data: cadTecidos = [], isFetched: cadTecidosFetched } = useQuery({
    queryKey: ["explosao-cad-tecidos", cadRow?.id],
    enabled: !!cadRow?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cad_tecidos")
        .select(
          "*, artigos:artigo_id(nome, preco_por_metro, unidade_medida, etiqueta_lavagem_urls, largura_estimada), cad_tecido_variantes(*, variantes_tecido:variante_tecido_id(nome_variante, codigo_variante, cor:cor_id(nome), apelido:cor_apelido_id(nome)))",
        )
        .eq("cad_id", cadRow!.id);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: cadGrades = [], isFetched: cadGradesFetched } = useQuery({
    queryKey: ["explosao-cad-grades", cadRow?.id],
    enabled: !!cadRow?.id,
    queryFn: async () => {
      const { data } = await supabase.from("cad_grades").select("*").eq("cad_id", cadRow!.id);
      return data ?? [];
    },
  });

  const { data: tenantCfg } = useQuery({
    queryKey: ["explosao-tenant-config-grade", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data } = await supabase.from("tenant_config").select("tamanhos_grade").eq("tenant_id", tenantId).maybeSingle();
      return data;
    },
  });

  // OCs vinculadas no Desenvolvimento, p/ exibir na ficha de corte.
  const { data: ocLinks = [] } = useQuery({
    queryKey: ["explosao-oc-links", modeloId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modelo_tecido_oc_links" as any)
        .select("tipo, numero, ordem, variante_tecido_id, prioridade, oc_item:oc_tecido_item_id(ocs_tecido:oc_tecido_id(numero_pedido))")
        .eq("modelo_id", modeloId);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
  const ocLinksByKey = useMemo(() => {
    const tmp: Record<string, { prioridade: number; num: string }[]> = {};
    for (const l of ocLinks as any[]) {
      const num = l.oc_item?.ocs_tecido?.numero_pedido;
      if (!num) continue;
      const key = `${l.tipo}-${l.numero}-${l.ordem}-${l.variante_tecido_id}`;
      (tmp[key] ??= []).push({ prioridade: Number(l.prioridade ?? 1), num });
    }
    const out: Record<string, string[]> = {};
    Object.entries(tmp).forEach(([k, arr]) => {
      out[k] = arr.sort((a, b) => a.prioridade - b.prioridade).map((x) => x.num);
    });
    return out;
  }, [ocLinks]);

  // --- local editable state (só metragem_enviada é editável) ---
  const [tecidos, setTecidos] = useState<TecidoRow[]>([]);
  const [grades, setGrades] = useState<GradeRow[]>([]);
  const [seeded, setSeeded] = useState(false);

  // Guarda de "alterações não salvas": só metragem_enviada/quantidade_folhas por variante
  // são editáveis; o resto é read-only. Snapshot enxuto dessas duas colunas.
  const metragemSnapshot = useMemo(
    () => tecidos.map((t) => t.variantes.map((v) => `${v.id ?? ""}:${v.metragem_enviada}:${v.quantidade_folhas}`)),
    [tecidos],
  );
  const { dirty, markClean, reset: resetBaseline } = useDirtySnapshot(metragemSnapshot);
  useEffect(() => { onDirtyChange?.(seeded && dirty); }, [seeded, dirty, onDirtyChange]);

  useEffect(() => {
    if (seeded) return;
    if (!cadRow?.id) return;
    if (!cadTecidosFetched || !cadGradesFetched) return;

    const initialTec: TecidoRow[] = (cadTecidos as any[]).map((t) => ({
      id: t.id,
      numero: t.numero,
      tipo: t.tipo,
      artigo_id: t.artigo_id,
      consumo_cad: Number(t.consumo_cad ?? 0),
      loss_percent_cad: Number(t.loss_percent_cad ?? 0),
      custo_cad: calcCusto(
        Number(t.consumo_cad ?? 0),
        Number(t.loss_percent_cad ?? 0),
        Number(t.artigos?.preco_por_metro ?? 0),
      ),
      tamanho_folha: Number(t.tamanho_folha ?? 0),
      preco: Number(t.artigos?.preco_por_metro ?? 0),
      largura: Number(t.artigos?.largura_estimada ?? 0),
      artigo_nome: t.artigos?.nome
        ? t.artigos?.unidade_medida
          ? `${t.artigos.nome} [${t.artigos.unidade_medida}]`
          : t.artigos.nome
        : null,
      etiqueta_lavagem_urls: (t.artigos?.etiqueta_lavagem_urls ?? []) as string[],
      variantes: (t.cad_tecido_variantes ?? []).map((v: any) => ({
        id: v.id,
        variante_tecido_id: v.variante_tecido_id,
        variante_nome: v.variantes_tecido?.nome_variante ?? v.variantes_tecido?.codigo_variante,
        variante_cor: v.variantes_tecido?.cor?.nome ?? null,
        variante_apelido: v.variantes_tecido?.apelido?.nome ?? null,
        multiplicador: Number(v.multiplicador ?? 1) || 1,
        ordem: v.ordem,
        quantidade_folhas: Number(v.quantidade_folhas ?? 0),
        metragem_planejada: Number(v.metragem_planejada ?? 0),
        metragem_enviada: Number(v.metragem_enviada ?? 0),
      })),
    }));
    // Ordena os blocos: Tecido → Forro → Entretela (e por número dentro do tipo).
    const TIPO_ORDER: Record<string, number> = { tecido: 0, forro: 1, entretela: 2 };
    initialTec.sort(
      (a, b) => (TIPO_ORDER[a.tipo] ?? 9) - (TIPO_ORDER[b.tipo] ?? 9) || (a.numero ?? 0) - (b.numero ?? 0),
    );
    setTecidos(initialTec);

    // cad_grades tem grades_planejadas/grade_total_planejada (não "grades"/"grade_total").
    // Ler as colunas certas — o valor alimenta a Ficha de Corte (gradeTotalGeral) e é READ-ONLY.
    const initialGrades: GradeRow[] = (cadGrades as any[]).map((g) => ({
      variante_numero: g.variante_numero,
      grades: g.grades_planejadas ?? {},
      grade_total: g.grade_total_planejada ?? 0,
    }));
    setGrades(initialGrades);

    // Re-baseline o guarda a partir do estado semeado (valor explícito — o setState
    // acima ainda está stale neste tick).
    resetBaseline(initialTec.map((t) => t.variantes.map((v) => `${v.id ?? ""}:${v.metragem_enviada}:${v.quantidade_folhas}`)));
    setSeeded(true);
  }, [cadRow, cadTecidos, cadGrades, cadTecidosFetched, cadGradesFetched, seeded]);

  // Só metragem_enviada é editável. As demais funções são noop (readOnly=true oculta inputs).
  const updateVar = (i: number, j: number, patch: Partial<VarianteRow>) => {
    setTecidos((prev) => {
      const next = [...prev];
      const variantes = [...next[i].variantes];
      variantes[j] = { ...variantes[j], ...patch };
      next[i] = { ...next[i], variantes };
      return next;
    });
  };
  // updateTec não é chamado em readOnly, mas é necessário na assinatura do componente
  const updateTec = (_i: number, _patch: Partial<TecidoRow>) => { /* readOnly — nunca chamado */ };

  const tamanhosConfig = useMemo<string[]>(() => {
    const raw = (tenantCfg as any)?.tamanhos_grade;
    if (Array.isArray(raw) && raw.length > 0) {
      return raw.map((x: any) => (typeof x === "string" ? x : (x?.nome ?? x?.label ?? String(x))));
    }
    return ["34|PPP", "36|PP", "38|P", "40|M", "42|G", "44|GG"];
  }, [tenantCfg]);

  const tamanhosAll = useMemo(() => {
    const present = new Set<string>();
    grades.forEach((g) => Object.keys(g.grades).forEach((k) => present.add(k)));
    const result = [...tamanhosConfig];
    present.forEach((t) => { if (!result.includes(t)) result.push(t); });
    return result;
  }, [grades, tamanhosConfig]);

  const gradeLabelByNumero = useMemo(() => {
    const t1 = tecidos.find((t) => t.tipo === "tecido" && t.numero === 1);
    const m: Record<number, string> = {};
    (t1?.variantes ?? []).forEach((v) => {
      const lbl = varianteLabel({ nome: v.variante_nome, cor: v.variante_cor, apelido: v.variante_apelido });
      if (v.ordem) m[v.ordem] = lbl !== "—" ? `${v.ordem} - ${lbl}` : `${v.ordem}`;
    });
    return m;
  }, [tecidos]);

  const gradeTotalGeral = useMemo(
    () => grades.reduce((a, g) => a + (g.grade_total || 0), 0),
    [grades],
  );

  // Variantes com metragem_planejada > 0 mas metragem_enviada = 0
  const variantesZeradas = useMemo(() => {
    let n = 0;
    for (const t of tecidos) {
      for (const v of t.variantes) {
        if (Number(v.metragem_planejada ?? 0) > 0 && Number(v.metragem_enviada ?? 0) === 0) n += 1;
      }
    }
    return n;
  }, [tecidos]);

  // A Explosão só edita metragem por variante — usa a RPC ESTREITA salvar_explosao_metragem,
  // que atualiza APENAS cad_tecido_variantes.metragem_enviada/quantidade_folhas. NÃO chamar
  // salvar_cad_completo daqui: aquela RPC substitui TUDO e, com grade/aviamento/etiqueta vazios,
  // os APAGAVA (bug 1+4). A grade continua read-only na tela, sem ir no payload.
  const buildVariantesPayload = () =>
    tecidos.flatMap((t) =>
      t.variantes.map((v) => ({
        id: v.id,
        metragem_enviada: v.metragem_enviada,
        quantidade_folhas: v.quantidade_folhas,
      })),
    );

  // --- salvar sem baixa ---
  const salvarMut = useMutation({
    mutationFn: async () => {
      if (!cadRow?.id) throw new Error("CAD não carregado");
      const { error } = await supabase.rpc("salvar_explosao_metragem" as any, {
        _cad_id: cadRow.id,
        _variantes: buildVariantesPayload(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Salvo");
      markClean(); // limpa o indicador de "alterações não salvas"
      qc.invalidateQueries({ queryKey: ["explosao-cad-row", modeloId] });
      qc.invalidateQueries({ queryKey: ["explosao-cad-tecidos", cadRow?.id] });
      qc.invalidateQueries({ queryKey: ["cad-row", modeloId] });
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao salvar")),
  });

  // --- enviar para Serviços (corte) ---
  // Salva a metragem (RPC estreita) e depois baixa o estoque.
  const enviarCorte = useMutation({
    mutationFn: async () => {
      if (!cadRow?.id) throw new Error("CAD não carregado");
      // Primeiro persiste a metragem_enviada atual (RPC estreita — não toca grade/aviamento).
      const { error: errSave } = await supabase.rpc("salvar_explosao_metragem" as any, {
        _cad_id: cadRow.id,
        _variantes: buildVariantesPayload(),
      });
      if (errSave) throw errSave;

      // Depois executa a baixa de estoque (o corte que envia para Serviços).
      const { data, error } = await supabase.rpc("baixar_estoque_tecido_corte" as any, {
        _cad_id: cadRow.id,
      });
      if (error) throw error;
      return data as any;
    },
    onSuccess: (res: any) => {
      const def: any[] = Array.isArray(res?.deficit) ? res.deficit : [];
      if (def.length > 0) {
        const linhas = def
          .map((d) => `${d.variante}: faltaram ${Number(d.deficit).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} m`)
          .join("; ");
        toast.warning(`Enviado para Serviços, mas faltou estoque — ${linhas}`, { duration: 12000 });
      } else {
        toast.success("Enviado para Serviços");
      }
      qc.invalidateQueries({ queryKey: ["producao-explosao-list"] });
      qc.invalidateQueries({ queryKey: ["producao-cad-list"] });
      qc.invalidateQueries({ queryKey: ["explosao-cad-row", modeloId] });
      qc.invalidateQueries({ queryKey: ["cad-row", modeloId] });
      qc.invalidateQueries({ queryKey: ["estoque-tecidos"] });
      qc.invalidateQueries({ queryKey: ["dash-estoque"] });
      qc.invalidateQueries({ queryKey: ["consumo-por-oc"] });
      onEnviado();
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao enviar para Serviços")),
  });

  // --- voltar ao desenvolvimento ---
  const voltarMut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("voltar_modelo_desenvolvimento" as any, {
        _modelo_id: modeloId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Voltou ao Desenvolvimento");
      qc.invalidateQueries({ queryKey: ["producao-explosao-list"] });
      qc.invalidateQueries({ queryKey: ["modelos-desenvolvimento"] });
      qc.invalidateQueries({ queryKey: ["explosao-modelo", modeloId] });
      qc.invalidateQueries({ queryKey: ["explosao-cad-row", modeloId] });
      qc.invalidateQueries({ queryKey: ["modelo-detail", modeloId] });
      qc.invalidateQueries({ queryKey: ["etapas-afetadas", modeloId] });
      qc.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && (q.queryKey[0] as string).startsWith("ft-") });
      onEnviado(); // fecha o painel (mesma callback que enviarCorte usa)
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao voltar ao Desenvolvimento")),
  });

  const handleEnviar = () => {
    if (variantesZeradas > 0) {
      setConfirmZeroOpen(true);
      return;
    }
    enviarCorte.mutate();
  };

  const firstPhoto = (modelo?.fotos_modelo as string[] | null)?.[0] ?? null;

  return (
    <div className="flex h-full flex-col min-h-0">
      <div className="flex-1 overflow-y-auto w-full p-3 sm:p-6 space-y-6 no-print">
        {/* Cabeçalho (breadcrumb + título/status). Imprimir "Ficha de Corte" fica no
            topo-direita p/ o indicador global de "não salvo" cair logo abaixo dele. */}
        <div className="border-b pb-4">
          <div className="flex items-start gap-3">
            <Breadcrumb
              items={[
                { label: "Estilo & Engenharia" },
                { label: "Explosão" },
                { label: modelo?.ref ?? "…" },
              ]}
            />
            <UnsavedIndicator show={seeded && dirty} className="ml-auto shrink-0" />
            <Button variant="outline" size="sm" className="shrink-0" onClick={() => printWithImages()}>
              <Printer className="h-4 w-4 mr-1.5" />
              Ficha de Corte
            </Button>
          </div>
          <h2 className="text-lg font-semibold flex items-center gap-2 mt-2">
            Explosão — Envio para Serviços
            {(cadRow as any)?.enviado_corte && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600 border border-green-600/40 rounded-full px-2 py-0.5">
                <span className="h-2 w-2 rounded-full bg-green-500" /> Enviado para Serviços
              </span>
            )}
          </h2>
          <p className="text-xs text-muted-foreground">
            {(cadRow as any)?.enviado_corte
              ? 'Já enviado. Edite a metragem se precisar e clique em "Reenviar para Serviços" (refaz a baixa com a metragem atual).'
              : 'Preencha "Metr. a Separar/Enviar" e clique em Enviar para Serviços.'}
          </p>
        </div>

        {/* Info do modelo */}
        <Card className="p-5 max-md:p-3 flex gap-5 max-md:flex-col max-md:gap-3">
          <div className="h-32 w-32 max-md:h-28 max-md:w-28 rounded-md bg-muted overflow-hidden flex items-center justify-center shrink-0">
            {firstPhoto ? (
              <ModeloPhoto path={firstPhoto} expandable />
            ) : (
              <ImageIcon className="h-8 w-8 text-muted-foreground" />
            )}
          </div>
          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h1 className="text-xl max-md:text-lg font-bold">{modelo?.nome ?? "—"}</h1>
              <Badge variant="outline" className="font-mono">{modelo?.ref ?? "sem REF"}</Badge>
              <VersaoBadge versao={modelo?.versao} />
            </div>
            <div className="text-sm text-muted-foreground space-y-1 mt-2">
              <div>Estilista: {modelo?.estilista?.nome ?? "—"}</div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-1 [&>span]:truncate">
                <span>Coleção: {modelo?.colecao ?? "—"}</span>
                <span>{modelo?.subcolecao ? `Subcoleção: ${modelo.subcolecao}` : ""}</span>
                <span>Linha: {modelo?.linha?.nome ?? "—"}</span>
              </div>
              {(modelo?.semana || modelo?.mes?.mes || modelo?.ano?.ano) && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-1 [&>span]:truncate">
                  <span>{modelo?.semana ? `Lançamento: ${modelo.semana}` : ""}</span>
                  <span>{modelo?.mes?.mes ? `Mês: ${modelo.mes.mes}` : ""}</span>
                  <span>{modelo?.ano?.ano ? `Ano: ${modelo.ano.ano}` : ""}</span>
                </div>
              )}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-1 [&>span]:truncate">
                <span>{modelo?.cat_p?.grupo?.nome ? `Grupo: ${modelo.cat_p.grupo.nome}` : ""}</span>
                <span>Categoria: {modelo?.cat_p?.nome ?? "—"}</span>
                <span>{modelo?.sub1?.nome ? `Subcategoria 1: ${modelo.sub1.nome}` : ""}</span>
                <span>{modelo?.sub2?.nome ? `Subcategoria 2: ${modelo.sub2.nome}` : ""}</span>
              </div>
            </div>
          </div>
        </Card>

        {/* Tecidos (readOnly — só metragem_enviada editável) */}
        <CadTecidosSection
          tecidos={tecidos}
          updateTec={updateTec}
          updateVar={updateVar}
          readOnly={true}
        />
      </div>

      {/* Rodapé sticky de ações — colado embaixo enquanto o corpo rola (desktop e mobile). */}
      <div className="shrink-0 border-t bg-background p-3 flex flex-wrap items-center gap-2 no-print">
        <Button
          variant="outline"
          size="sm"
          onClick={onClose ?? onEnviado}
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Voltar
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setVoltarOpen(true)}
          disabled={voltarMut.isPending}
        >
          <RotateCcw className="h-4 w-4 mr-1.5" />
          Voltar ao Desenvolvimento
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => salvarMut.mutate()}
          disabled={salvarMut.isPending || enviarCorte.isPending || !cadRow?.id}
        >
          <Save className="h-4 w-4 mr-1.5" />
          {salvarMut.isPending ? "Salvando…" : "Salvar"}
        </Button>
        <Button
          size="sm"
          className="ml-auto"
          onClick={handleEnviar}
          disabled={enviarCorte.isPending || salvarMut.isPending || !cadRow?.id}
        >
          <Send className="h-4 w-4 mr-1.5" />
          {enviarCorte.isPending ? "Enviando…" : (cadRow as any)?.enviado_corte ? "Reenviar para Serviços" : "Enviar para Serviços"}
        </Button>
      </div>

      {/* Ficha de Corte — sempre montada (oculta fora da impressão) */}
      <CadFichaCorte
        modelo={modelo}
        cadRow={cadRow}
        previsaoEntrega={(cadRow as any)?.data_previsao_corte ?? ""}
        observacoesMolde={(cadRow as any)?.observacoes_molde ?? ""}
        tecidos={tecidos}
        grades={grades}
        tamanhosAll={tamanhosAll}
        aviamentos={[]}
        gradeTotalGeral={gradeTotalGeral}
        labelByNumero={gradeLabelByNumero}
        ocLinksByKey={ocLinksByKey}
      />

      <AlertDialog open={confirmZeroOpen} onOpenChange={setConfirmZeroOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Variantes sem metragem enviada</AlertDialogTitle>
            <AlertDialogDescription>
              {variantesZeradas} variante(s) com metragem planejada estão com metragem enviada = 0.
              A baixa de estoque ficará zerada para elas. Enviar mesmo assim?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmZeroOpen(false);
                enviarCorte.mutate();
              }}
            >
              Enviar mesmo assim
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={voltarOpen} onOpenChange={setVoltarOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Voltar ao Desenvolvimento?</AlertDialogTitle>
            <AlertDialogDescription>
              Voltar este modelo ao Desenvolvimento? Ele sai da Explosão e volta a ser editável.
              O CAD existente é mantido.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setVoltarOpen(false);
                voltarMut.mutate();
              }}
            >
              Voltar ao Desenvolvimento
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
