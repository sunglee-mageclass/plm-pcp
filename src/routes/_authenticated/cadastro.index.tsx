import { createFileRoute } from "@tanstack/react-router";
import { SectionHub } from "@/components/SectionHub";

export const Route = createFileRoute("/_authenticated/cadastro/")({
  component: CadastroIndex,
});


function CadastroIndex() {
  return <SectionHub module="cadastro" subtitle="Cadastros base do sistema." />;
}
