import { createFileRoute } from "@tanstack/react-router";
import { SectionHub } from "@/components/SectionHub";

export const Route = createFileRoute("/_authenticated/pcp/")({
  component: PcpIndex,
});


function PcpIndex() {
  return <SectionHub module="pcp" subtitle="Explosão, serviços terceirizados e etapas da produção." />;
}
