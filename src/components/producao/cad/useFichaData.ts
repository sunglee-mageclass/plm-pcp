import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { varianteLabel } from "@/lib/variante";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
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
  ocLinksByKey: Record<string, string[]>;
  /** true quando os dados essenciais da ficha já carregaram (p/ imprimir só depois). */
  isReady: boolean;
};

/** Carrega os dados SALVOS do CAD de um modelo nos formatos da ficha (read-only). */
export function useFichaData(modeloId: string): FichaData {
  const tenantId = useActiveTenantId();
  const { data: modelo, isFetched: modeloFetched } = useQuery({
    queryKey: ["ft-modelo", modeloId],
    queryFn: async () => {
      const { data } = await supabase
        .from("modelos")
        .select("id, ref, nome, colecao, versao, fotos_modelo, linha:linha_id(nome), cat_p:categoria_principal_id(nome, grupo:grupo_id(nome)), sub1:subcategoria1_id(nome), sub2:subcategoria2_id(nome), estilista:estilista_id(nome), modelista:modelista_id(nome), piloteiro:piloteiro1_id(nome)")
        .eq("id", modeloId)
        .maybeSingle();
      return data;
    },
  });

  const { data: cadRow, isFetched: cadFetched } = useQuery({
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

  const { data: cadTecidos = [], isFetched: tecidosFetched } = useQuery({
    queryKey: ["ft-tecidos", cadId],
    enabled: !!cadId,
    queryFn: async () => {
      const { data } = await supabase
        .from("cad_tecidos")
        .select("*, artigos:artigo_id(nome, composicao, etiqueta_lavagem_urls, largura_estimada), cad_tecido_variantes(*, variantes_tecido:variante_tecido_id(nome_variante, codigo_variante, cor:cor_id(nome), apelido:cor_apelido_id(nome)))")
        .eq("cad_id", cadId);
      return data ?? [];
    },
  });

  const { data: modeloGrades = [], isFetched: gradesFetched } = useQuery({
    queryKey: ["ft-grades", modeloId],
    queryFn: async () => (await supabase.from("modelo_grades").select("*").eq("modelo_id", modeloId)).data ?? [],
  });

  // OCs vinculadas (Desenvolvimento) p/ a coluna OC(s) da Ficha de Corte — mesma
  // fonte/chave usada na tela de detalhe do CAD, para a impressão pela LISTA
  // também mostrar as OCs (antes saíam como "—").
  const { data: ocLinks = [] } = useQuery({
    queryKey: ["ft-oc-links", modeloId],
    queryFn: async () => {
      const { data } = await supabase
        .from("modelo_tecido_oc_links" as any)
        .select("tipo, numero, ordem, variante_tecido_id, prioridade, oc_item:oc_tecido_item_id(ocs_tecido:oc_tecido_id(numero_pedido))")
        .eq("modelo_id", modeloId);
      return (data ?? []) as any[];
    },
  });

  const { data: cadAviamentos = [] } = useQuery({
    queryKey: ["ft-aviamentos", cadId],
    enabled: !!cadId,
    queryFn: async () => (await supabase.from("cad_aviamentos").select("*, aviamentos:aviamento_id(codigo_nome, preco)").eq("cad_id", cadId).order("numero")).data ?? [],
  });

  const { data: cadEtiquetas = [] } = useQuery({
    queryKey: ["ft-etiquetas", cadId],
    enabled: !!cadId,
    queryFn: async () => ((await supabase.from("cad_etiquetas" as any).select("*, etiquetas:etiqueta_id(nome, tamanho), cor:cor_id(nome)").eq("cad_id", cadId)).data ?? []) as any[],
  });

  const { data: tamanhosConfig = [] } = useQuery({
    queryKey: ["ft-tamanhos", tenantId],
    enabled: !!tenantId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase.from("tenant_config").select("tamanhos_grade").eq("tenant_id", tenantId).maybeSingle();
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
          variante_apelido: v.variantes_tecido?.apelido?.nome,
        })),
      }))
      .sort((a, b) => {
        const ord: Record<string, number> = { tecido: 0, forro: 1, entretela: 2 };
        return (ord[a.tipo] ?? 9) - (ord[b.tipo] ?? 9) || ((a.numero ?? 0) - (b.numero ?? 0));
      }),
    [cadTecidos],
  );

  const grades: GradeRow[] = useMemo(
    () => (modeloGrades as any[]).map((g) => ({ variante_numero: g.variante_numero, grades: (g.grades ?? {}) as Record<string, number>, grade_total: num(g.grade_total) })),
    [modeloGrades],
  );

  const aviamentos: AviamentoRow[] = useMemo(
    () => (cadAviamentos as any[]).map((a) => { const consumo = num(a.consumo); const preco = num(a.aviamentos?.preco); return ({ id: a.id, numero: a.numero, aviamento_id: a.aviamento_id, aviamento_nome: a.aviamentos?.codigo_nome, consumo, grade_total: 0, quantidade_enviar: num(a.quantidade_enviar), quantidade_separar: num(a.quantidade_separar), preco, custo_cad: Number((consumo * preco).toFixed(2)) }); }),
    [cadAviamentos],
  );

  const etiquetas: EtiquetaRow[] = useMemo(
    () => (cadEtiquetas as any[]).map((e) => ({ id: e.id, etiqueta_id: e.etiqueta_id, etiqueta_nome: e.etiquetas?.nome ?? "—", cor_id: e.cor_id ?? null, cor_nome: e.cor?.nome ?? null, tamanho: e.etiquetas?.tamanho ?? null, consumo: num(e.consumo), quantidade_planejada: num(e.quantidade_planejada), quantidade_enviar: num(e.quantidade_enviar), enviarPorTamanho: (e.enviar_por_tamanho ?? {}) as Record<string, number> })),
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
      const lbl = varianteLabel({ nome: v.variante_nome, cor: v.variante_cor, apelido: v.variante_apelido });
      if (v.ordem) m[v.ordem] = lbl !== "—" ? `${v.ordem} - ${lbl}` : `${v.ordem}`;
    });
    return m;
  }, [tecidos]);

  const gradeTotalGeral = useMemo(() => grades.reduce((a, g) => a + (g.grade_total || 0), 0), [grades]);

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

  const composicao = useMemo(() => {
    // Hierarquia fixa: tecido > forro > entretela (e por número dentro do tipo).
    const tipoOrder: Record<string, number> = { tecido: 0, forro: 1, entretela: 2 };
    const lines = (cadTecidos as any[])
      .slice()
      .sort((a, b) => ((tipoOrder[a.tipo] ?? 9) - (tipoOrder[b.tipo] ?? 9)) || a.numero - b.numero)
      .map((t) => {
        const c = (t.artigos?.composicao ?? "").trim();
        // Junta tudo numa linha só (quebras → espaço); cada linha = um tecido.
        return c ? `${tecLabel(t.tipo, t.numero)}: ${c.replace(/\s+/g, " ").trim()}` : null;
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
    ocLinksByKey,
    // Só está "pronto" quando o modelo, o CAD e a grade carregaram (e, havendo
    // CAD, os tecidos). Evita imprimir a ficha em branco no 1º clique (cache frio).
    isReady: modeloFetched && cadFetched && gradesFetched && (!cadId || tecidosFetched),
  };
}
