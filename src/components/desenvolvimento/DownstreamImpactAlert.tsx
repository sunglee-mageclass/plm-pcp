import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ExternalLink } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { fmtNum } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type Etapas = {
  cad?: boolean;
  corte?: boolean;
  baixa_total?: number;
  terceirizados?: boolean;
  oficina?: boolean;
  cq?: boolean;
  acabamento?: boolean;
  direcionamento?: boolean;
  lancamentos?: boolean;
};

type StageDef = {
  key: keyof Etapas;
  label: string;
  desc: string | ((e: Etapas) => string);
  // sem href = etapa sem página própria (ex.: corte fica dentro do CAD).
  href?: (id: string) => string;
};

// Etapas na ordem do fluxo, com o que cada uma usa do upstream (pode ficar
// desatualizado) e a rota pra abrir.
const STAGES: StageDef[] = [
  { key: "cad", label: "CAD", desc: "Metragem planejada, consumos e custo previsto.", href: (id) => `/producao/cad/${id}` },
  { key: "corte", label: "Corte", desc: (e) => `Já enviado ao corte — ${fmtNum(Number(e.baixa_total ?? 0))}m baixados; a baixa não se desfaz sozinha.` },
  { key: "terceirizados", label: "Serviços", desc: "Quantidades e custos dos serviços.", href: (id) => `/producao/terceirizados/${id}` },
  { key: "oficina", label: "Oficina", desc: "Quantidades e custos da oficina.", href: (id) => `/producao/oficina/${id}` },
  { key: "cq", label: "CQ", desc: "Grade e peças conferidas.", href: (id) => `/producao/cq/${id}` },
  { key: "acabamento", label: "Acabamento", desc: "Quantidades no acabamento.", href: (id) => `/producao/acabamento/${id}` },
  { key: "direcionamento", label: "Direcionamento", desc: "Direcionamento das peças.", href: (id) => `/producao/direcionamento/${id}` },
  { key: "lancamentos", label: "Lançamentos", desc: "Lançamentos de produção.", href: () => `/producao/lancamentos` },
];

/**
 * Avisa que o modelo já avançou e detalha CADA etapa seguinte afetada (o que ela
 * usa do upstream + botão para abrir em nova aba). `from`:
 *  - "desenvolvimento": lista a partir do CAD (edição no Desenvolvimento).
 *  - "cad": lista a partir do Corte (edição no próprio CAD; não mostra o CAD).
 * Não renderiza nada se não houver etapa seguinte atingida.
 */
export function DownstreamImpactAlert({
  modeloId,
  from = "desenvolvimento",
}: {
  modeloId: string;
  from?: "desenvolvimento" | "cad";
}) {
  const { data } = useQuery({
    queryKey: ["etapas-afetadas", modeloId],
    enabled: !!modeloId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("modelo_etapas_afetadas" as any, { _modelo_id: modeloId });
      if (error) throw error;
      return (data ?? {}) as Etapas;
    },
  });

  if (!data?.cad) return null;

  // No CAD, pula o próprio CAD (começa no Corte).
  const startIdx = from === "cad" ? 1 : 0;
  const reached = STAGES.slice(startIdx).filter((s) => data[s.key]);
  if (reached.length === 0) return null;

  const intro =
    from === "cad"
      ? "Este modelo já foi enviado ao corte ou tem produção. Alterar grade, consumos ou aviamentos no CAD pode afetar:"
      : "Este modelo já avançou. Alterar consumo, grade ou tecidos aqui pode afetar as etapas seguintes (a metragem planejada do CAD não muda sozinha):";

  return (
    <Card className="border-amber-500/60 bg-amber-500/10 p-3 text-sm space-y-2">
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
        <div><b>Atenção.</b> {intro}</div>
      </div>
      <ul className="space-y-1.5 pl-6">
        {reached.map((s) => (
          <li key={s.key} className="flex items-start justify-between gap-3">
            <span>
              <b>{s.label}</b> — <span className="text-muted-foreground">{typeof s.desc === "function" ? s.desc(data) : s.desc}</span>
            </span>
            {s.href && (
              <Button asChild size="sm" variant="outline" className="h-7 shrink-0">
                <a href={s.href(modeloId)} target="_blank" rel="noreferrer">
                  Abrir <ExternalLink className="h-3 w-3 ml-1" />
                </a>
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
