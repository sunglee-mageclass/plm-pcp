import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Factory, Scissors, Users, Wrench, ClipboardCheck, Sparkles, Compass, Rocket } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/producao/")({
  component: ProducaoIndex,
});

const SECTIONS = {
  cad: { to: "/producao/cad", title: "CAD", desc: "Modelos enviados ao CAD.", icon: Scissors },
  terceirizados: { to: "/producao/terceirizados", title: "Serviços", desc: "Serviços por REF.", icon: Users },
  oficina: { to: "/producao/oficina", title: "Oficina", desc: "Costura e montagem por REF.", icon: Wrench },
  cq: { to: "/producao/cq", title: "Controle de Qualidade", desc: "Recebimento, conserto, lavagem, defeito.", icon: ClipboardCheck },
  acabamento: { to: "/producao/acabamento", title: "Acabamento", desc: "Etapas de acabamento por REF.", icon: Sparkles },
  direcionamento: { to: "/producao/direcionamento", title: "Direcionamento", desc: "E-commerce vs Loja Física.", icon: Compass },
  lancamentos: { to: "/producao/lancamentos", title: "Lançamentos", desc: "Produtos finalizados.", icon: Rocket },
} as const;

function ProducaoIndex() {
  const tenantId = useActiveTenantId();
  const { data: cfg } = useQuery({
    queryKey: ["tenant_config", "oficina_posicao", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data } = await supabase.from("tenant_config").select("oficina_posicao").eq("tenant_id", tenantId).maybeSingle();
      return data;
    },
  });

  // oficina_posicao: 'terceirizados' (default) | 'acabamento' — oficina vira sub-item dessa etapa
  const pos = (cfg as any)?.oficina_posicao ?? "terceirizados";
  // Acabamento aposentado: virou serviço "pós-costura" (aba Pós dentro de Serviços).
  const ordered: (keyof typeof SECTIONS)[] =
    pos === "acabamento"
      ? ["cad", "terceirizados", "cq", "direcionamento", "lancamentos"]
      : ["cad", "terceirizados", "cq", "direcionamento", "lancamentos"];

  return (
    <div className="container mx-auto p-3 sm:p-6 space-y-6">
      <header className="flex items-start gap-3">
        <Factory className="h-7 w-7 text-primary mt-0.5 shrink-0" />
        <div>
          <h1 className="text-2xl font-bold">Produção</h1>
          <p className="text-sm text-muted-foreground">CAD, serviços (pré/pós), Controle de Qualidade, direcionamento e lançamentos.</p>
        </div>
      </header>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {ordered.map((k) => {
          const s = SECTIONS[k];
          return (
            <Link key={s.to} to={s.to}>
              <Card className="p-5 hover:shadow-md transition-shadow h-full">
                <div className="flex items-start gap-3">
                  <s.icon className="h-5 w-5 text-primary mt-0.5" />
                  <div>
                    <h3 className="font-semibold">{s.title}</h3>
                    <p className="text-sm text-muted-foreground">{s.desc}</p>
                  </div>
                </div>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
