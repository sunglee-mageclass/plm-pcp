import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { TecidoRow, GradeRow, AviamentoRow, EtiquetaRow } from "./types";

const num = (v: any) => Number(v ?? 0) || 0;
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const tecLabel = (tipo: string, numero: number) =>
  tipo === "tecido" ? `Tecido ${numero}` : numero > 1 ? `${cap(tipo)} ${numero}` : cap(tipo);

export type ObsRow = { id: string; descricao: string | null; observacao: string | null };

export type FichaData = {
  modelo: any;
  cadRow: any;
  previsaoEntrega?: string;
  observacoesMolde?: string;
  tecidos: TecidoRow[];
  grades: GradeRow[];
  tamanhosAll: string[];
  aviamentos: AviamentoRow[];
  etiquetas: EtiquetaRow[];
  gradeTotalGeral: number;
  labelByNumero: Record<number, string>;
  composicao: string;
  observacoes: ObsRow[];
};

/** Carrega os dados SALVOS do CAD de um modelo nos formatos da ficha (read-only). */
export function useFichaData(modeloId: string): FichaData {
  const { data: modelo } = useQuery({
    queryKey: ["ft-modelo", modeloId],
    queryFn: async () => {
      const { data } = await supabase
        .from("modelos")
        .select("id, ref, nome, colecao, versao, fotos_modelo, linha:linha_id(nome), cat_p:categoria_principal_id(nome), cat_s:categoria_secundaria_id(nome)")
        .eq("id", modeloId)
        .maybeSingle();
      return data;
    },
  });

  const { data: cadRow } = useQuery({
    queryKey: ["ft-cad", modeloId],
    queryFn: async () => {
      const { data } = await supabase
        .from("cad")
        .select("id, data_previsao_corte, observacoes_molde")
        .eq("modelo_id", modeloId)
        .maybeSingle();
      return data;
    },
  });
  const cadId = (cadRow as any)?.id;

  const { data: cadTecidos = [] } = useQuery({
    queryKey: ["ft-tecidos", cadId],
    enabled: !!cadId,
    queryFn: async () => {
      const { data } = await supabase
        .from("cad_tecidos")
        .select("*, artigos:artigo_id(nome, composicao, etiqueta_lavagem_urls, largura_estimada), cad_tecido_variantes(*, variantes_tecido:variante_tecido_id(nome_variante, codigo_variante, cor:cor_id(nome)))")
        .eq("cad_id", cadId);
      return data ?? [];
    },
  });

  const { data: modeloGrades = [] } = useQuery({
    queryKey: ["ft-grades", modeloId],
    queryFn: async () => (await supabase.from("modelo_grades").select("*").eq("modelo_id", modeloId)).data ?? [],
  });

  const { data: cadAviamentos = [] } = useQuery({
    queryKey: ["ft-aviamentos", cadId],
    enabled: !!cadId,
    queryFn: async () => (await supabase.from("cad_aviamentos").select("*, aviamentos:aviamento_id(codigo_nome)").eq("cad_id", cadId).order("numero")).data ?? [],
  });

  const { data: cadEtiquetas = [] } = useQuery({
    queryKey: ["ft-etiquetas", cadId],
    enabled: !!cadId,
    queryFn: async () => ((await supabase.from("cad_etiquetas" as any).select("*, etiquetas:etiqueta_id(nome, tamanho)").eq("cad_id", cadId)).data ?? []) as any[],
  });

  const { data: tamanhosConfig = [] } = useQuery({
    queryKey: ["ft-tamanhos"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase.from("tenant_config").select("tamanhos_grade").maybeSingle();
      const raw = (data as any)?.tamanhos_grade;
      return Array.isArray(raw) && raw.length
        ? raw.map((x: any) => (typeof x === "string" ? x : x?.nome ?? x?.label ?? String(x)))
        : ["34|PPP", "36|PP", "38|P", "40|M", "42|G", "44|GG"];
    },
  });

  const { data: observacoes = [] } = useQuery({
    queryKey: ["modelo-observacoes", modeloId],
    queryFn: async () =>
      ((await supabase.from("modelo_observacoes" as any).select("id, descricao, observacao, ordem").eq("modelo_id", modeloId).order("ordem").order("created_at")).data ?? []) as any[],
  });

  const tecidos: TecidoRow[] = useMemo(
    () =>
      (cadTecidos as any[]).map((t) => ({
        id: t.id,
        numero: t.numero,
        tipo: t.tipo,
        artigo_id: t.artigo_id,
        consumo_cad: num(t.consumo_cad),
        loss_percent_cad: num(t.loss_percent_cad),
        custo_cad: num(t.custo_cad),
        tamanho_folha: num(t.tamanho_folha),
        preco: 0,
        largura: t.artigos?.largura_estimada ?? null,
        artigo_nome: t.artigos?.nome ?? null,
        etiqueta_lavagem_urls: t.artigos?.etiqueta_lavagem_urls ?? [],
        variantes: (t.cad_tecido_variantes ?? []).map((v: any) => ({
          variante_tecido_id: v.variante_tecido_id,
          ordem: v.ordem,
          multiplicador: v.multiplicador,
          quantidade_folhas: num(v.quantidade_folhas),
          metragem_planejada: num(v.metragem_planejada),
          metragem_enviada: num(v.metragem_enviada),
          variante_nome: v.variantes_tecido?.nome_variante,
          variante_cor: v.variantes_tecido?.cor?.nome,
        })),
      })),
    [cadTecidos],
  );

  const grades: GradeRow[] = useMemo(
    () => (modeloGrades as any[]).map((g) => ({ variante_numero: g.variante_numero, grades: (g.grades ?? {}) as Record<string, number>, grade_total: num(g.grade_total) })),
    [modeloGrades],
  );

  const aviamentos: AviamentoRow[] = useMemo(
    () => (cadAviamentos as any[]).map((a) => ({ id: a.id, numero: a.numero, aviamento_id: a.aviamento_id, aviamento_nome: a.aviamentos?.codigo_nome, consumo: num(a.consumo), grade_total: 0, quantidade_enviar: num(a.quantidade_enviar), quantidade_separar: num(a.quantidade_separar) })),
    [cadAviamentos],
  );

  const etiquetas: EtiquetaRow[] = useMemo(
    () => (cadEtiquetas as any[]).map((e) => ({ id: e.id, etiqueta_id: e.etiqueta_id, etiqueta_nome: e.etiquetas?.nome ?? "—", tamanho: e.etiquetas?.tamanho ?? null, consumo: num(e.consumo), quantidade_planejada: num(e.quantidade_planejada), quantidade_enviar: num(e.quantidade_enviar) })),
    [cadEtiquetas],
  );

  const tamanhosAll = useMemo(() => {
    const present = new Set<string>();
    grades.forEach((g) => Object.keys(g.grades).forEach((k) => present.add(k)));
    const result = [...(tamanhosConfig as string[])];
    present.forEach((t) => { if (!result.includes(t)) result.push(t); });
    return result;
  }, [grades, tamanhosConfig]);

  const labelByNumero = useMemo(() => {
    const t1 = tecidos.find((t) => t.tipo === "tecido" && t.numero === 1);
    const m: Record<number, string> = {};
    (t1?.variantes ?? []).forEach((v) => {
      const cor = v.variante_cor || v.variante_nome || "—";
      if (v.ordem) m[v.ordem] = `Variante ${v.ordem} — ${cor}`;
    });
    return m;
  }, [tecidos]);

  const gradeTotalGeral = useMemo(() => grades.reduce((a, g) => a + (g.grade_total || 0), 0), [grades]);

  const composicao = useMemo(() => {
    const lines = (cadTecidos as any[])
      .slice()
      .sort((a, b) => (a.tipo > b.tipo ? 1 : a.tipo < b.tipo ? -1 : 0) || a.numero - b.numero)
      .map((t) => {
        const c = (t.artigos?.composicao ?? "").trim();
        // % na mesma linha separadas por " | "; cada linha = um tecido.
        return c ? `${tecLabel(t.tipo, t.numero)}: ${c.replace(/\s*[,;]\s*/g, " | ")}` : null;
      })
      .filter(Boolean);
    return lines.join("\n");
  }, [cadTecidos]);

  return {
    modelo,
    cadRow,
    previsaoEntrega: (cadRow as any)?.data_previsao_corte ?? undefined,
    observacoesMolde: (cadRow as any)?.observacoes_molde ?? undefined,
    tecidos,
    grades,
    tamanhosAll,
    aviamentos,
    etiquetas,
    gradeTotalGeral,
    labelByNumero,
    composicao,
    observacoes: observacoes as ObsRow[],
  };
}
