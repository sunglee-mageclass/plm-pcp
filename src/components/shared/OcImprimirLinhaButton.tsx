import { useState } from "react";
import { Printer, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { mensagemErro } from "@/lib/erro-mensagem";
import { printWithImages } from "@/lib/print";
import { OcDocumentoPrint, type OcDocModelo } from "@/components/shared/OcDocumentoPrint";

/**
 * Ícone de imprimir na LINHA da lista de OC. A lista só tem o cabeçalho — este botão busca
 * os itens da OC (lazy, ao clicar) via `montarModelo(ocId)`, renderiza o documento invisível
 * e dispara a impressão. `montarModelo` é fornecido por cada tela (conhece seu shape).
 *
 * Uso: <OcImprimirLinhaButton ocId={o.id} montarModelo={montarDocModelo} />
 */
export function OcImprimirLinhaButton({
  ocId,
  montarModelo,
  size = "iconSm",
}: {
  ocId: string;
  montarModelo: (ocId: string) => Promise<OcDocModelo>;
  size?: "iconSm" | "icon";
}) {
  const [modelo, setModelo] = useState<OcDocModelo | null>(null);
  const [carregando, setCarregando] = useState(false);

  const imprimir = async (e: React.MouseEvent) => {
    e.stopPropagation();          // não abrir a OC ao clicar no ícone
    if (carregando) return;
    setCarregando(true);
    try {
      const m = await montarModelo(ocId);
      setModelo(m);
      // espera o React montar o <OcDocumentoPrint> antes de chamar window.print()
      await new Promise((r) => setTimeout(r, 60));
      await printWithImages();
    } catch (err) {
      toast.error(mensagemErro(err, "Erro ao preparar a impressão."));
    } finally {
      setCarregando(false);
      // CRÍTICO: desmonta o documento após imprimir. Senão a .print-area deste botão fica no
      // DOM e o próximo window.print() (de outra linha ou do sheet) imprimiria TODAS juntas.
      setModelo(null);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size={size}
        aria-label="Imprimir pedido"
        title="Imprimir pedido"
        disabled={carregando}
        onClick={imprimir}
      >
        {carregando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
      </Button>
      {modelo && <OcDocumentoPrint modelo={modelo} />}
    </>
  );
}
