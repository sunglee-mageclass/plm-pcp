// Integração — P-87 (dono 27/set: "celular não vai ter essa tela"): em tela estreita a rota mostra SÓ este aviso (sem
// dados, sem ações). Os selos/travas das OUTRAS telas (Sheet do Planejamento, PA/PI, Plan. Tecido) continuam no celular.
import { Monitor } from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";

export const TEXTO_SO_COMPUTADOR = "A Integração é usada no computador";

export function AvisoComputador() {
  return (
    <div className="p-4">
      <EmptyState
        icon={Monitor}
        title={TEXTO_SO_COMPUTADOR}
        description="Abra esta tela num computador (tela larga). Os selos de integração continuam aparecendo nas telas do produto."
      />
    </div>
  );
}
