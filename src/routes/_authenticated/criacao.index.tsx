import { createFileRoute, Link } from "@tanstack/react-router";
import { Palette, ClipboardList, Hammer } from "lucide-react";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/criacao/")({
  component: CriacaoIndex,
});

const sections = [
  { to: "/criacao/planejamento", title: "Planejamento", desc: "Cards de modelos em planejamento.", icon: ClipboardList },
  { to: "/criacao/desenvolvimento", title: "Desenvolvimento", desc: "Modelos aprovados em desenvolvimento.", icon: Hammer },
];

function CriacaoIndex() {
  return (
    <div className="container mx-auto p-6 space-y-6">
      <header className="flex items-center gap-3">
        <Palette className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Criação</h1>
          <p className="text-sm text-muted-foreground">Planejamento e desenvolvimento de modelos.</p>
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
