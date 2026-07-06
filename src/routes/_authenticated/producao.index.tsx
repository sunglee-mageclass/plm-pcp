import { createFileRoute, Link } from "@tanstack/react-router";
import { Factory, Scissors, Users, ClipboardCheck, Compass, Rocket } from "lucide-react";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/producao/")({
  component: ProducaoIndex,
});

// Acabamento foi aposentado (virou serviço "pós-costura", aba Pós dentro de Serviços) e a
// Oficina é acessada dentro de Serviços — nenhum dos dois é card próprio neste hub.
const SECTIONS = {
  cad: { to: "/producao/cad", title: "CAD", desc: "Modelos enviados ao CAD.", icon: Scissors },
  terceirizados: { to: "/producao/terceirizados", title: "Serviços", desc: "Serviços por REF.", icon: Users },
  cq: { to: "/producao/cq", title: "Controle de Qualidade", desc: "Recebimento, conserto, lavagem, defeito.", icon: ClipboardCheck },
  direcionamento: { to: "/producao/direcionamento", title: "Direcionamento", desc: "E-commerce vs Loja Física.", icon: Compass },
  lancamentos: { to: "/producao/lancamentos", title: "Lançamentos", desc: "Produtos finalizados.", icon: Rocket },
} as const;

function ProducaoIndex() {
  const ordered: (keyof typeof SECTIONS)[] = ["cad", "terceirizados", "cq", "direcionamento", "lancamentos"];

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
