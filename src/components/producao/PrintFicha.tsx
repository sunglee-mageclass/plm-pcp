import { useEffect, useRef } from "react";
import { FichaTecnica } from "@/components/producao/FichaTecnica";
import { FichaCorteDoc } from "@/components/producao/cad/CadFichaCorte";
import { useFichaData } from "@/components/producao/cad/useFichaData";

/**
 * Monta a ficha (Técnica ou de Corte) de um modelo de forma oculta, espera as
 * imagens (signed URLs) carregarem e dispara window.print(). Como print() é
 * bloqueante, chamamos onDone() logo depois (já com o diálogo fechado) — o que
 * SEMPRE reseta o estado, liberando uma nova impressão. Use uma `key` única por
 * clique para forçar a remontagem mesmo no mesmo modelo.
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

    const run = async () => {
      // Espera as imagens carregarem (no máx. ~4s), p/ a foto não sair em branco.
      const start = Date.now();
      while (!cancelled && Date.now() - start < 4000) {
        const imgs = Array.from(wrapRef.current?.querySelectorAll("img") ?? []);
        const allLoaded = imgs.length === 0 || imgs.every((img) => img.complete && img.naturalWidth > 0);
        if (allLoaded && Date.now() - start > 250) break;
        await new Promise((r) => setTimeout(r, 120));
      }
      if (cancelled) return;
      window.print();         // bloqueante: retorna após fechar/cancelar o diálogo
      if (!cancelled) onDone();
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
