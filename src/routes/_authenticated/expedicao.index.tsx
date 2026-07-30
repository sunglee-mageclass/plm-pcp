import { createFileRoute } from "@tanstack/react-router";
import { SectionHub } from "@/components/SectionHub";

export const Route = createFileRoute("/_authenticated/expedicao/")({
  component: ExpedicaoIndex,
});


function ExpedicaoIndex() {
  return <SectionHub module="expedicao" subtitle="Controle de Qualidade, direcionamento e lançamentos." />;
}
