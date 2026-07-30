import { createFileRoute } from "@tanstack/react-router";
import { SectionHub } from "@/components/SectionHub";

export const Route = createFileRoute("/_authenticated/producao/")({
  component: ProducaoIndex,
});

// Blocos DERIVADOS do catálogo. CAD (integrado à Explosão) e Oficina (acessada dentro de Serviços)
// não têm URL própria no nav → não viram bloco. Acabamento foi aposentado (serviço pós-costura).
const DESCS: Record<string, string> = {
  producao_terceirizados: "Serviços por REF (pré/pós-costura).",
  producao_cq: "Recebimento, conserto, lavagem, defeito.",
  producao_direcionamento: "E-commerce vs Loja Física.",
  producao_lancamentos: "Produtos finalizados.",
};

function ProducaoIndex() {
  return <SectionHub module="producao" subtitle="Serviços (pré/pós), Controle de Qualidade, direcionamento e lançamentos." descriptions={DESCS} />;
}
