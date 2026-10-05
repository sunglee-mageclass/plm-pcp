import { StatusBadge } from "@/components/shared/StatusBadge";
import { textoAtraso, type Atraso } from "@/lib/servico-atraso";

/** [urg R5] Selo de atraso de serviço / peça de foto (mesmo estilo do OcPrazoBadge; sem "Faltam N dias"). Null sem atraso. */
export function ServicoAtrasoBadge({
  atraso,
  tipo,
}: {
  atraso: Atraso;
  tipo: "servico" | "peca_foto";
}) {
  if (!atraso) return null;
  return (
    <StatusBadge tone={atraso.estado === "vence_hoje" ? "warning" : "danger"}>
      {textoAtraso(atraso, tipo)}
    </StatusBadge>
  );
}
