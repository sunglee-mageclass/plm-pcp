import { toast } from "sonner";
import { textoResumoResultado, type ResultadoLote } from "@/lib/pedido-em-lote";

/** Toast do fim do lote: "X pedidos criados · Y falharam" (verde se nada falhou; âmbar se algum falhou). O detalhe por produto fica no diálogo. */
export function toastResultadoLote(r: Pick<ResultadoLote, "criados" | "falhas">) {
  const texto = textoResumoResultado(r);
  if (r.falhas === 0) toast.success(texto);
  else if (r.criados === 0) toast.error(texto);
  else toast.warning(texto);
}
