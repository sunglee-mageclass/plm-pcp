import { createFileRoute } from "@tanstack/react-router";
import { ClipboardList } from "lucide-react";
import { ModulePage } from "@/components/module-page";

export const Route = createFileRoute("/_authenticated/cadastro")({
  component: () => (
    <ModulePage
      icon={ClipboardList}
      title="Cadastro"
      description="Cadastros base do sistema: clientes, fornecedores, materiais e produtos."
      subPages={["Clientes", "Fornecedores", "Materiais", "Produtos", "Cores", "Tamanhos"]}
    />
  ),
});
