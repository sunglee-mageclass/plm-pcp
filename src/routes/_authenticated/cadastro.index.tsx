import { createFileRoute, Link } from "@tanstack/react-router";
import { ClipboardList, Tags, Users, Wrench, Layers, Boxes } from "lucide-react";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/cadastro/")({
  component: CadastroIndex,
});

const sections = [
  { to: "/cadastro/atributos", title: "Atributos", desc: "Cores, anos, meses, categorias e demais listas.", icon: Tags },
  { to: "/cadastro/colaboradores", title: "Colaboradores", desc: "Pessoas envolvidas no processo.", icon: Users },
  { to: "/cadastro/servico", title: "Serviço", desc: "Tipos de serviço prestados.", icon: Wrench },
  { to: "/cadastro/tecidos", title: "Tecidos", desc: "Catálogo de tecidos e variantes.", icon: Layers },
  { to: "/cadastro/aviamentos", title: "Aviamentos", desc: "Catálogo de aviamentos.", icon: Boxes },
];

function CadastroIndex() {
  return (
    <div className="container mx-auto p-6 space-y-6">
      <header className="flex items-center gap-3">
        <ClipboardList className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Cadastro</h1>
          <p className="text-sm text-muted-foreground">
            Cadastros base do sistema.
          </p>
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
