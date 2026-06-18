import { useEffect, useRef } from "react";
import { FichaTecnica } from "@/components/producao/FichaTecnica";
import { FichaCorteDoc } from "@/components/producao/cad/CadFichaCorte";
import { useFichaData } from "@/components/producao/cad/useFichaData";

/**
 * Monta a ficha (Técnica ou de Corte) de um modelo de forma oculta e dispara
 * window.print() assim que os dados E as imagens (fotos/etiquetas via signed URL)
 * carregam — permite imprimir direto da lista, sem abrir o item. Desmonta no
 * evento afterprint (com fallback), para não cortar a impressão nem travar o
 * segundo clique.
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
  const wrapRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);
  // Pronto quando o modelo e o registro de CAD resolveram (cadRow !== undefined).
  const ready = !!d.modelo && d.cadRow !== undefined;

  useEffect(() => {
    if (!ready || startedRef.current) return;
    startedRef.current = true;
    let cancelled = false;
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      window.removeEventListener("afterprint", finish);
      onDone();
    };

    const imagesReady = () => {
      const imgs = Array.from(wrapRef.current?.querySelectorAll("img") ?? []);
      if (imgs.length === 0) return true;
      return imgs.every((img) => img.complete && img.naturalWidth > 0);
    };

    const run = async () => {
      // Espera as imagens carregarem (signed URLs são assíncronas), no máx. ~4s.
      const start = Date.now();
      while (!cancelled && Date.now() - start < 4000) {
        if (imagesReady() && Date.now() - start > 250) break;
        await new Promise((r) => setTimeout(r, 120));
      }
      if (cancelled) return;
      window.addEventListener("afterprint", finish);
      // Fallback: alguns navegadores não disparam afterprint de forma confiável.
      setTimeout(finish, 2000);
      window.print();
    };
    run();
    return () => { cancelled = true; };
  }, [ready, onDone]);

  return (
    <div ref={wrapRef}>
      {kind === "corte" ? <FichaCorteDoc modeloId={modeloId} /> : <FichaTecnica modeloId={modeloId} />}
    </div>
  );
}
