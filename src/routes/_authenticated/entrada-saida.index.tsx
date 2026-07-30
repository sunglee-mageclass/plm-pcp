import { createFileRoute } from "@tanstack/react-router";
import { SectionHub } from "@/components/SectionHub";

export const Route = createFileRoute("/_authenticated/entrada-saida/")({
  component: EntradaSaidaIndex,
});

// Blocos DERIVADOS do catálogo (respeita perfil full/estoque e permissão). Antes o hub esquecia
// Explosão, Alertas de Tecido e OC Insumo (lista hardcoded). OS de Tecido/Aviamento só no modo
// só-estoque — o próprio catálogo (modes) filtra.
const DESCS: Record<string, string> = {
  producao_explosao: "Baixa de estoque / envio ao corte.",
  entrada_oc_tecido: "Ordens de compra de tecidos.",
  entrada_alertas_tecido: "Alertas de CQ de tecido (troca/cancelamento).",
  entrada_oc_aviamento: "Ordens de compra de aviamentos.",
  entrada_oc_insumo: "Ordens de compra de insumos.",
  entrada_os_tecido: "Ordens de saída / baixa de tecidos.",
  entrada_os_aviamento: "Ordens de saída / baixa de aviamentos.",
};

function EntradaSaidaIndex() {
  return <SectionHub module="entrada_saida" subtitle="Movimentação de tecidos, aviamentos e estoque." descriptions={DESCS} />;
}
