import { createFileRoute } from "@tanstack/react-router";
import { SectionHub } from "@/components/SectionHub";

export const Route = createFileRoute("/_authenticated/entrada-saida/")({
  component: EntradaSaidaIndex,
});


function EntradaSaidaIndex() {
  return <SectionHub module="entrada_saida" subtitle="Movimentação de tecidos, aviamentos e estoque." />;
}
