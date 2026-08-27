import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { fmtNum } from "@/lib/format";

type Etapas = {
  cad?: boolean;
  corte?: boolean;
  baixa_total?: number;
  terceirizados?: boolean;
  oficina?: boolean;
  cq?: boolean;
  direcionamento?: boolean;
  lancamentos?: boolean;
};

type StageDef = {
  key: keyof Etapas;
  label: string;
  desc: string | ((e: Etapas) => string);
  href?: (id: string) => string;
};

const STAGES: StageDef[] = [
  { key: "cad", label: "Explosão", desc: "Metragem planejada, consumos e custo previsto.", href: () => "/entrada-saida/explosao" },
  { key: "corte", label: "Corte", desc: (e) => `Já enviado ao corte — ${fmtNum(Number(e.baixa_total ?? 0))}m baixados; a baixa não se desfaz sozinha.` },
  { key: "terceirizados", label: "Serviços", desc: "Quantidades e custos dos serviços.", href: (id) => `/pcp/servicos/${id}` },
  { key: "oficina", label: "Oficina", desc: "Quantidades e custos da oficina.", href: (id) => `/pcp/oficina/${id}` },
  { key: "cq", label: "CQ", desc: "Grade e peças conferidas.", href: (id) => `/expedicao/cq/${id}` },
  { key: "direcionamento", label: "Direcionamento", desc: "Direcionamento das peças.", href: (id) => `/expedicao/direcionamento/${id}` },
  { key: "lancamentos", label: "Lançamentos", desc: "Lançamentos de produção.", href: () => `/expedicao/lancamentos` },
];

export const STAGE_LABEL: Record<string, string> = Object.fromEntries(STAGES.map((s) => [s.key, s.label]));

/** Quais etapas seguintes o modelo já atingiu (a partir do ponto de edição). */
export function useEtapasAfetadas(modeloId: string, from: "desenvolvimento" | "cad" = "desenvolvimento") {
  const { data } = useQuery({
    queryKey: ["etapas-afetadas", modeloId],
    enabled: !!modeloId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("modelo_etapas_afetadas" as any, { _modelo_id: modeloId });
      if (error) throw error;
      return (data ?? {}) as Etapas;
    },
  });
  const etapas = (data ?? {}) as Etapas;
  const startIdx = from === "cad" ? 1 : 0;
  const reached = etapas.cad ? STAGES.slice(startIdx).filter((s) => etapas[s.key]) : [];
  return { etapas, reached, hasDownstream: reached.length > 0 };
}

