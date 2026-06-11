import { createFileRoute, Link } from "@tanstack/react-router";
import { Factory, Scissors, Users } from "lucide-react";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/producao/")({
  component: ProducaoIndex,
});

const sections = [
  { to: "/producao/cad", title: "CAD", desc: "Modelos enviados ao CAD.", icon: Scissors },
  { to: "/producao/terceirizados", title: "Terceirizados", desc: "Serviços terceirizados por REF.", icon: Users },
];

function ProducaoIndex() {
  return (
    <div className="container mx-auto p-6 space-y-6">
      <header className="flex items-center gap-3">
        <Factory className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Produção</h1>
          <p className="text-sm text-muted-foreground">CAD, terceirizados, CQ, acabamento e lançamentos.</p>
        </div>
      </header>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sections.map((s) => (
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
        ))}
      </div>
    </div>
  );
}
