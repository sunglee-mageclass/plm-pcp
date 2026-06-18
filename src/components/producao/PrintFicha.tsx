import { useEffect, useRef } from "react";
import { FichaTecnica } from "@/components/producao/FichaTecnica";
import { FichaCorteDoc } from "@/components/producao/cad/CadFichaCorte";
import { useFichaData } from "@/components/producao/cad/useFichaData";

/**
 * Monta a ficha (Técnica ou de Corte) de um modelo de forma oculta e dispara
 * window.print() assim que os dados carregam — permite imprimir direto da lista,
 * sem abrir o item. Ao terminar chama onDone() para desmontar.
 *
 * O CSS de impressão (.print-area) esconde o resto da tela; a ficha montada aqui
 * é o único bloco visível na impressão.
 */
export function PrintFicha({
  modeloId,
  kind,
  onDone,
}: {
  modeloId: string;
  kind: "tecnica" | "corte";
  onDone: () => void;
}) {
  const d = useFichaData(modeloId);
  const printedRef = useRef(false);
  // Pronto quando o modelo e o registro de CAD resolveram (cadRow !== undefined).
  const ready = !!d.modelo && d.cadRow !== undefined;

  useEffect(() => {
    if (!ready || printedRef.current) return;
    printedRef.current = true;
    // Pequeno atraso p/ tabelas/grades e imagens (fotos/etiquetas) assentarem.
    const t = setTimeout(() => {
      window.print();
      onDone();
    }, 600);
    return () => clearTimeout(t);
  }, [ready, onDone]);

  return kind === "corte" ? (
    <FichaCorteDoc modeloId={modeloId} />
  ) : (
    <FichaTecnica modeloId={modeloId} />
  );
}
