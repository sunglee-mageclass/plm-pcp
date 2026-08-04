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
import { AlertTriangle, ArrowLeft, ImageIcon, Pencil, Printer, RotateCcw, Save, Send } from "lucide-react";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { varianteLabel } from "@/lib/variante";
import { fmtNum } from "@/lib/format";
import { situacaoExplosao } from "@/lib/explosao";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ModeloPhoto } from "@/components/producao/cad/shared";
import { ExplosaoMetragemSection } from "@/components/producao/explosao/ExplosaoMetragemSection";
import { SituacaoChip } from "@/components/producao/explosao/SituacaoChip";
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
  // Confirmação ANTES da baixa — mostrada em TODO envio/reenvio (não só quando há zeradas):
  // resumo do que vai baixar, com "zerado" marcado por tecido; total zero BLOQUEIA o envio.
  const [confirmEnviarOpen, setConfirmEnviarOpen] = useState(false);
  const [voltarOpen, setVoltarOpen] = useState(false);
  // Disclosure da identidade comprimida: "Coleção · Categoria · Linha · Estilista — mais detalhes".
  const [maisDetalhes, setMaisDetalhes] = useState(false);
  // Edição da metragem travada por padrão quando já enviado ao PCP; o lápis destrava,
  // e Salvar re-trava. Definido no seed a partir de `enviado_corte`.
  const [editing, setEditing] = useState(false);

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
    // Abre EDITÁVEL se ainda não enviado (preparando); TRAVADO se já enviado (edita pelo lápis).
    setEditing(!(cadRow as any)?.enviado_corte);
    setSeeded(true);
  }, [cadRow, cadTecidos, cadGrades, cadTecidosFetched, cadGradesFetched, seeded]);

  // Só metragem_enviada é editável — a ÚNICA função de update que o hero (ExplosaoMetragemSection) usa.
  const updateVar = (i: number, j: number, patch: Partial<VarianteRow>) => {
    setTecidos((prev) => {
      const next = [...prev];
      const variantes = [...next[i].variantes];
      variantes[j] = { ...variantes[j], ...patch };
      next[i] = { ...next[i], variantes };
      return next;
    });
  };

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

  // Total "a baixar" por tecido — alimenta o resumo pré-envio, a confirmação (com "zerado"
  // por tecido) e o rótulo "Enviar para PCP · X m" do botão primário. NÃO é o que vai no
  // payload (isso é buildVariantesPayload, por variante) — é só a soma p/ exibição.
  const porTecido = useMemo(
    () =>
      tecidos.map((t, i) => ({
        key: `${t.tipo}-${t.numero}-${i}`,
        label: t.artigo_nome ?? `${t.tipo} ${t.numero}`,
        total: t.variantes.reduce((a, v) => a + Number(v.metragem_enviada || 0), 0),
      })),
    [tecidos],
  );
  const totalGeral = useMemo(() => porTecido.reduce((a, t) => a + t.total, 0), [porTecido]);

  const situacao = situacaoExplosao((cadRow as any)?.enviado_corte === true, (cadRow as any)?.deficit_corte);

  // "Usar planejada" — copia metragem_planejada → metragem_enviada. Por tecido (botão da
  // linha) ou em tudo (botão do header do hero); só chamável em modo de edição.
  const usarPlanejadaTecido = (i: number) => {
    setTecidos((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], variantes: next[i].variantes.map((v) => ({ ...v, metragem_enviada: v.metragem_planejada })) };
      return next;
    });
  };
  const usarPlanejadaTudo = () => {
    setTecidos((prev) => prev.map((t) => ({ ...t, variantes: t.variantes.map((v) => ({ ...v, metragem_enviada: v.metragem_planejada })) })));
  };

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
      setEditing(false); // trava a edição após salvar (o lápis reabre)
      qc.invalidateQueries({ queryKey: ["explosao-cad-row", modeloId] });
      qc.invalidateQueries({ queryKey: ["explosao-cad-tecidos", cadRow?.id] });
      qc.invalidateQueries({ queryKey: ["cad-row", modeloId] });
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao salvar")),
  });

  // --- enviar para PCP (corte) ---
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

      // Depois executa a baixa de estoque (o corte que envia para PCP).
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
        toast.warning(`Enviado para PCP, mas faltou estoque — ${linhas}`, { duration: 12000 });
      } else {
        toast.success("Enviado para PCP");
      }
      qc.invalidateQueries({ queryKey: ["producao-explosao-list"] });
      qc.invalidateQueries({ queryKey: ["producao-cad-list"] });
      qc.invalidateQueries({ queryKey: ["explosao-cad-row", modeloId] });
      // Faltava invalidar a metragem em si — reabrir o MESMO Sheet (sem reload de página)
      // mostrava a metragem/resumo/rótulo do botão DEFASADOS (0 m, pré-envio) mesmo após
      // um envio bem-sucedido com metragem real. Antes disso passava despercebido (a UI
      // antiga não exibia total nenhum); a nova ("Enviar para PCP · X m" + resumo pré-envio)
      // torna o dado velho visível — achado ao vivo na QA desta tela.
      qc.invalidateQueries({ queryKey: ["explosao-cad-tecidos", cadRow?.id] });
      qc.invalidateQueries({ queryKey: ["explosao-cad-grades", cadRow?.id] });
      qc.invalidateQueries({ queryKey: ["cad-row", modeloId] });
      qc.invalidateQueries({ queryKey: ["estoque-tecidos"] });
      qc.invalidateQueries({ queryKey: ["dash-estoque"] });
      qc.invalidateQueries({ queryKey: ["consumo-por-oc"] });
      onEnviado();
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao enviar para PCP")),
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

  // Confirmação ANTES da baixa — sempre (Enviar E Reenviar), com o resumo do que vai baixar.
  // Total zero é bloqueado no próprio dialog (sem botão de confirmar).
  const handleEnviar = () => setConfirmEnviarOpen(true);

  const firstPhoto = (modelo?.fotos_modelo as string[] | null)?.[0] ?? null;
  const jaEnviado = (cadRow as any)?.enviado_corte === true;

  return (
    <div className="flex h-full flex-col min-h-0">
      <div className="flex-1 overflow-y-auto w-full p-3 sm:p-6 space-y-5 no-print">
        {/* Cabeçalho (breadcrumb + título/status). Imprimir "Ficha de Corte" fica no
            topo-direita p/ o indicador global de "não salvo" cair logo abaixo dele. */}
        <div className="border-b pb-4">
          <div className="flex items-start gap-3">
            <Breadcrumb
              items={[
                { label: "Entrada e Saída" },
                { label: "Explosão" },
                { label: modelo?.ref ?? "…" },
              ]}
            />
            {/* ml-auto no WRAPPER (não no indicador, que some quando não há edição) —
                garante a Ficha de Corte sempre na direita. */}
            <div className="ml-auto flex items-center gap-3 shrink-0">
              <UnsavedIndicator show={seeded && dirty} className="shrink-0" />
              <Button variant="outline" size="sm" className="shrink-0" onClick={() => printWithImages()}>
                <Printer className="h-4 w-4 mr-1.5" />
                Ficha de Corte
              </Button>
            </div>
          </div>

          {/* Identidade COMPRIMIDA: linha densa (thumb + nome + chips) + 1 linha muted com
              disclosure — substitui o card alto de foto 128px + 11 metadados (empurrava o
              hero de metragem, o trabalho de verdade da tela, pra baixo). */}
          <div className="flex items-center gap-3 flex-wrap mt-3">
            <div className="h-14 w-11 rounded-md bg-muted border overflow-hidden flex items-center justify-center shrink-0">
              {firstPhoto ? (
                <ModeloPhoto path={firstPhoto} expandable />
              ) : (
                <ImageIcon className="h-5 w-5 text-muted-foreground" />
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <b className="font-display text-[17px]">{modelo?.nome ?? "—"}</b>
                <Badge variant="outline" className="font-mono">{modelo?.ref ?? "sem REF"}</Badge>
                <VersaoBadge versao={modelo?.versao} />
                <SituacaoChip situacao={situacao} />
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {[modelo?.colecao, modelo?.cat_p?.nome, modelo?.linha?.nome, modelo?.estilista?.nome].filter(Boolean).join(" · ")}
                {" — "}
                <button type="button" className="text-primary hover:underline" onClick={() => setMaisDetalhes((v) => !v)}>
                  {maisDetalhes ? "menos detalhes" : "mais detalhes"}
                </button>
              </div>
            </div>
          </div>

          {maisDetalhes && (
            <div className="text-sm text-muted-foreground space-y-1 mt-3 pt-3 border-t">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-1 [&>span]:truncate">
                <span>{modelo?.subcolecao ? `Subcoleção: ${modelo.subcolecao}` : ""}</span>
                <span>{modelo?.semana ? `Lançamento: ${modelo.semana}` : ""}</span>
                <span>{modelo?.mes?.mes ? `Mês: ${modelo.mes.mes}` : ""}</span>
                <span>{modelo?.ano?.ano ? `Ano: ${modelo.ano.ano}` : ""}</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-1 [&>span]:truncate">
                <span>{modelo?.cat_p?.grupo?.nome ? `Grupo: ${modelo.cat_p.grupo.nome}` : ""}</span>
                <span>{modelo?.sub1?.nome ? `Subcategoria 1: ${modelo.sub1.nome}` : ""}</span>
                <span>{modelo?.sub2?.nome ? `Subcategoria 2: ${modelo.sub2.nome}` : ""}</span>
              </div>
            </div>
          )}
        </div>

        {/* Hero — "Quanto separar / enviar" (componente próprio da Explosão). */}
        <ExplosaoMetragemSection
          tecidos={tecidos}
          updateVar={updateVar}
          editing={editing}
          onUsarPlanejadaTecido={usarPlanejadaTecido}
          onUsarPlanejadaTudo={usarPlanejadaTudo}
        />

        {/* Resumo pré-envio — a consequência da baixa, à vista, antes de clicar Enviar. */}
        <div className="flex items-center gap-3.5 flex-wrap border rounded-md px-3.5 py-2.5 bg-muted/25 text-sm">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">A baixar do estoque</span>
          <span>
            <b className="text-[15px] tabular-nums">{fmtNum(totalGeral)} m</b> em{" "}
            <b>{tecidos.length} tecido{tecidos.length === 1 ? "" : "s"}</b>
          </span>
          {variantesZeradas > 0 && (
            <span className="text-xs text-warning inline-flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5" /> {variantesZeradas} variante{variantesZeradas > 1 ? "s" : ""} zerada{variantesZeradas > 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>

      {/* Rodapé sticky de ações — colado embaixo enquanto o corpo rola.
          Desktop: Voltar + Devolver (âmbar) à esquerda, LONGE do primário · Salvar
          rascunho/Editar + Enviar (com metragem) à direita.
          Mobile (<sm): barra única icon-only (pedido do dono) — mesma ordem/ações. */}
      <div className="shrink-0 border-t bg-background p-3 no-print">
        {/* Desktop */}
        <div className="hidden sm:flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={onClose ?? onEnviado}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            Voltar
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-warning border-warning/40 hover:bg-warning/10 hover:text-warning"
            onClick={() => setVoltarOpen(true)}
            disabled={voltarMut.isPending}
          >
            <RotateCcw className="h-4 w-4 mr-1.5" />
            Devolver ao Desenvolvimento
          </Button>
          <div className="ml-auto flex items-center gap-2">
            {editing ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => salvarMut.mutate()}
                disabled={salvarMut.isPending || enviarCorte.isPending || !cadRow?.id}
              >
                <Save className="h-4 w-4 mr-1.5" />
                {salvarMut.isPending ? "Salvando…" : "Salvar rascunho"}
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditing(true)}
                disabled={enviarCorte.isPending || !cadRow?.id}
              >
                <Pencil className="h-4 w-4 mr-1.5" />
                Editar
              </Button>
            )}
            <Button
              onClick={handleEnviar}
              disabled={enviarCorte.isPending || salvarMut.isPending || !cadRow?.id}
            >
              <Send className="h-4 w-4 mr-1.5" />
              {enviarCorte.isPending ? "Enviando…" : `${jaEnviado ? "Reenviar" : "Enviar"} para PCP · ${fmtNum(totalGeral)} m`}
            </Button>
          </div>
        </div>

        {/* Mobile — barra única, icon-only (aria-label + title). */}
        <div className="flex sm:hidden items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            className="h-11 w-11 shrink-0"
            title="Voltar"
            aria-label="Voltar"
            onClick={onClose ?? onEnviado}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-11 w-11 shrink-0 text-warning border-warning/40"
            title="Devolver ao Desenvolvimento"
            aria-label="Devolver ao Desenvolvimento"
            onClick={() => setVoltarOpen(true)}
            disabled={voltarMut.isPending}
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
          {editing ? (
            <Button
              variant="outline"
              size="icon"
              className="h-11 w-11 shrink-0 ml-auto"
              title="Salvar rascunho"
              aria-label="Salvar rascunho"
              onClick={() => salvarMut.mutate()}
              disabled={salvarMut.isPending || enviarCorte.isPending || !cadRow?.id}
            >
              <Save className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              variant="outline"
              size="icon"
              className="h-11 w-11 shrink-0 ml-auto"
              title="Editar"
              aria-label="Editar"
              onClick={() => setEditing(true)}
              disabled={enviarCorte.isPending || !cadRow?.id}
            >
              <Pencil className="h-4 w-4" />
            </Button>
          )}
          <Button
            size="icon"
            className="h-11 w-14 shrink-0"
            title={jaEnviado ? "Reenviar para PCP" : "Enviar para PCP"}
            aria-label={jaEnviado ? "Reenviar para PCP" : "Enviar para PCP"}
            onClick={handleEnviar}
            disabled={enviarCorte.isPending || salvarMut.isPending || !cadRow?.id}
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
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

      {/* Confirmação ANTES da baixa (Enviar E Reenviar) — resumo do que vai baixar, com
          "zerado" marcado por tecido; reenviar REFAZ a baixa (não soma). Total zero
          BLOQUEIA o envio: sem botão de confirmar, só Cancelar + aviso. */}
      <AlertDialog open={confirmEnviarOpen} onOpenChange={setConfirmEnviarOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{jaEnviado ? "Reenviar" : "Enviar"} para PCP — dar baixa de estoque?</AlertDialogTitle>
            <AlertDialogDescription>
              Vai baixar do estoque a metragem abaixo. A baixa é registrada no PCP; você pode reenviar
              depois (refaz a baixa, não soma).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground text-xs">
                  <th className="py-1 font-normal">Tecido</th>
                  <th className="py-1 font-normal text-right">m a baixar</th>
                </tr>
              </thead>
              <tbody>
                {porTecido.map((t) => (
                  <tr key={t.key} className="border-t">
                    <td className="py-1.5">
                      {t.label}
                      {t.total === 0 && (
                        <Badge variant="outline" className="ml-2 text-[10px] text-warning border-warning/40 py-0">zerado</Badge>
                      )}
                    </td>
                    <td className={cn("py-1.5 text-right tabular-nums", t.total === 0 && "text-muted-foreground")}>
                      {fmtNum(t.total)}
                    </td>
                  </tr>
                ))}
                <tr className="border-t font-semibold">
                  <td className="py-1.5">Total</td>
                  <td className="py-1.5 text-right tabular-nums">{fmtNum(totalGeral)} m</td>
                </tr>
              </tbody>
            </table>
          </div>
          {totalGeral === 0 ? (
            <p className="text-xs text-warning flex items-start gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              Metragem total <b>zero</b> — não há o que separar. Preencha "Metr. a Separar/Enviar" (ou use
              "Usar planejada") antes de enviar.
            </p>
          ) : variantesZeradas > 0 ? (
            <p className="text-xs text-muted-foreground flex items-start gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-warning" />
              {variantesZeradas} variante(s) zerada(s) não serão separadas. O restante segue normalmente.
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            {totalGeral > 0 && (
              <AlertDialogAction
                onClick={() => {
                  setConfirmEnviarOpen(false);
                  enviarCorte.mutate();
                }}
              >
                <Send className="h-4 w-4 mr-1.5" />
                {jaEnviado ? "Reenviar" : "Enviar"} para PCP
              </AlertDialogAction>
            )}
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
