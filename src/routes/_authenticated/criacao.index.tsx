import { createFileRoute } from "@tanstack/react-router";
import { SectionHub } from "@/components/SectionHub";

export const Route = createFileRoute("/_authenticated/criacao/")({
  component: CriacaoIndex,
});


function CriacaoIndex() {
  return <SectionHub module="criacao" subtitle="Planejamento e desenvolvimento de modelos." />;
}
