import { Breadcrumb } from "@/components/shared/Breadcrumb";
import { ExportarDados } from "./ExportarDados";

export function ExportarDadosPage() {
  return (
    <div className="space-y-4 p-4 pb-24 md:p-6">
      <Breadcrumb items={[{ label: "Sistema" }, { label: "Exportar dados" }]} />
      <h1 className="font-display text-2xl font-semibold">Exportar dados</h1>
      <ExportarDados />
    </div>
  );
}
