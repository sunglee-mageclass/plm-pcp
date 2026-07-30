import { createFileRoute } from "@tanstack/react-router";
import { SectionHub } from "@/components/SectionHub";

export const Route = createFileRoute("/_authenticated/cadastro/")({
  component: CadastroIndex,
});

const DESCS: Record<string, string> = {
  cadastro_atributos: "Cores, anos, meses, categorias e demais listas.",
  cadastro_colaboradores: "Pessoas envolvidas no processo.",
  cadastro_servico: "Empresas fornecedoras e representantes.",
  cadastro_tecidos: "Catálogo de tecidos e variantes.",
  cadastro_aviamentos: "Catálogo de aviamentos.",
  cadastro_etiquetas: "Insumos (etiquetas, embalagens, etc.).",
  cadastro_destinos: "Destinos de saída (modo só-estoque).",
};

function CadastroIndex() {
  return <SectionHub module="cadastro" subtitle="Cadastros base do sistema." descriptions={DESCS} />;
}
