import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ExternalLink } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type Etapas = {
  cad?: boolean;
  corte?: boolean;
  terceirizados?: boolean;
  oficina?: boolean;
  cq?: boolean;
  acabamento?: boolean;
  direcionamento?: boolean;
  lancamentos?: boolean;
};

// Etapas seguintes ao Desenvolvimento, na ordem do fluxo. `flat` = rota sem modeloId.
const STAGES: { key: keyof Etapas; label: string; href: (id: string) => string }[] = [
  { key: "terceirizados", label: "Serviços", href: (id) => `/producao/terceirizados/${id}` },
  { key: "oficina", label: "Oficina", href: (id) => `/producao/oficina/${id}` },
  { key: "cq", label: "CQ", href: (id) => `/producao/cq/${id}` },
  { key: "acabamento", label: "Acabamento", href: (id) => `/producao/acabamento/${id}` },
  { key: "direcionamento", label: "Direcionamento", href: (id) => `/producao/direcionamento/${id}` },
  { key: "lancamentos", label: "Lançamentos", href: () => `/producao/lancamentos` },
];

/**
 * Avisa que o modelo já avançou para etapas seguintes — alterar consumo/grade/
 * tecidos aqui pode deixá-las desatualizadas. Mostra um botão por etapa atingida
 * (abre em nova aba). Não renderiza nada se o modelo ainda não tem CAD.
 */
export function DownstreamImpactAlert({ modeloId }: { modeloId: string }) {
  const { data } = useQuery({
    queryKey: ["etapas-afetadas", modeloId],
    enabled: !!modeloId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("modelo_etapas_afetadas" as any, { _modelo_id: modeloId });
      if (error) throw error;
      return (data ?? {}) as Etapas;
    },
  });

  if (!data?.cad) return null; // só no Desenvolvimento → nada a alertar

  const reached = STAGES.filter((s) => data[s.key]);
  const cut = !!data.corte;

  return (
    <Card className="border-amber-500/60 bg-amber-500/10 p-3 text-sm space-y-2">
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
        <div>
          <b>Este modelo já avançou{cut ? " e foi enviado ao corte" : " para o CAD"}.</b>{" "}
          Alterar consumo, grade ou tecidos aqui pode afetar as etapas seguintes (ex.: a metragem
          planejada do CAD não muda sozinha). Revise cada uma:
        </div>
      </div>
      <div className="flex flex-wrap gap-2 pl-6">
        <Button asChild size="sm" variant="outline" className="h-7">
          <a href={`/producao/cad/${modeloId}`} target="_blank" rel="noreferrer">
            CAD{cut ? " (cortado)" : ""} <ExternalLink className="h-3 w-3 ml-1" />
          </a>
        </Button>
        {reached.map((s) => (
          <Button key={s.key} asChild size="sm" variant="outline" className="h-7">
            <a href={s.href(modeloId)} target="_blank" rel="noreferrer">
              {s.label} <ExternalLink className="h-3 w-3 ml-1" />
            </a>
          </Button>
        ))}
      </div>
    </Card>
  );
}
