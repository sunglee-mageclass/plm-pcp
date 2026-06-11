import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Factory, Scissors, Users, Wrench } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/producao/")({
  component: ProducaoIndex,
});

const SECTIONS = {
  cad: { to: "/producao/cad", title: "CAD", desc: "Modelos enviados ao CAD.", icon: Scissors },
  terceirizados: { to: "/producao/terceirizados", title: "Terceirizados", desc: "Serviços terceirizados por REF.", icon: Users },
  oficina: { to: "/producao/oficina", title: "Oficina", desc: "Costura e montagem por REF.", icon: Wrench },
} as const;

function ProducaoIndex() {
  const { data: cfg } = useQuery({
    queryKey: ["tenant_config", "oficina_posicao"],
    queryFn: async () => {
      const { data } = await supabase.from("tenant_config").select("oficina_posicao").maybeSingle();
      return data;
    },
  });

  // Default order: cad, terceirizados, oficina
  // oficina_posicao: 'antes_terceirizados' | 'depois_terceirizados' | 'paralelo' (default)
  const pos = (cfg as any)?.oficina_posicao ?? "depois_terceirizados";
  const ordered: (keyof typeof SECTIONS)[] =
    pos === "antes_terceirizados"
      ? ["cad", "oficina", "terceirizados"]
      : ["cad", "terceirizados", "oficina"];

  return (
    <div className="container mx-auto p-6 space-y-6">
      <header className="flex items-center gap-3">
        <Factory className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Produção</h1>
          <p className="text-sm text-muted-foreground">CAD, terceirizados, oficina, CQ, acabamento e lançamentos.</p>
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
