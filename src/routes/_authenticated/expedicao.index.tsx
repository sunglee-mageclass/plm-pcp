import { createFileRoute } from "@tanstack/react-router";
import { SectionHub } from "@/components/SectionHub";

export const Route = createFileRoute("/_authenticated/expedicao/")({
  component: ExpedicaoIndex,
});

const DESCS: Record<string, string> = {
  producao_cq: "Recebimento, conserto, lavagem, defeito.",
  producao_direcionamento: "E-commerce vs Loja Física.",
  producao_lancamentos: "Produtos finalizados.",
};

function ExpedicaoIndex() {
  return <SectionHub module="expedicao" subtitle="Controle de Qualidade, direcionamento e lançamentos." descriptions={DESCS} />;
}
