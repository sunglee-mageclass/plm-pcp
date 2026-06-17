import { createFileRoute } from "@tanstack/react-router";
import { Tag } from "lucide-react";
import { AttributeTab } from "@/components/attribute-tab";
import { RequirePermission } from "@/components/RequirePermission";

export const Route = createFileRoute("/_authenticated/cadastro/etiquetas")({
  component: () => (
    <RequirePermission page="cadastro_etiquetas">
      <EtiquetasPage />
    </RequirePermission>
  ),
});

function EtiquetasPage() {
  return (
    <div className="container mx-auto p-6 space-y-6">
      <header className="flex items-center gap-3">
        <Tag className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">TAG/Etiquetas</h1>
          <p className="text-sm text-muted-foreground">Cadastro de tags / etiquetas.</p>
        </div>
      </header>

      <div className="rounded-lg border bg-card p-4">
        <AttributeTab
          config={{
            table: "etiquetas",
            nameField: "nome",
            singular: "Etiqueta",
            plural: "Etiquetas",
            usage: [],
          }}
        />
      </div>
    </div>
  );
}
