import { createFileRoute } from "@tanstack/react-router";
import { SectionHub } from "@/components/SectionHub";

export const Route = createFileRoute("/_authenticated/criacao/")({
  component: CriacaoIndex,
});

// Blocos DERIVADOS do catálogo (permissions-catalog + nav) — não desatualizam. Só as descrições
// ficam aqui (best-effort por key; página nova sem descrição ainda aparece, só sem o texto).
const DESCS: Record<string, string> = {
  criacao_plan_tecido: "Planejamento de tecido por coleção.",
  criacao_planejamento: "Cards de modelos em planejamento.",
  criacao_desenvolvimento: "Modelos aprovados em desenvolvimento.",
};

function CriacaoIndex() {
  return <SectionHub module="criacao" subtitle="Planejamento e desenvolvimento de modelos." descriptions={DESCS} />;
}
