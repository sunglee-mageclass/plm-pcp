import { useEffect, useRef } from "react";
import { FichaTecnica } from "@/components/producao/FichaTecnica";
import { FichaCorteDoc } from "@/components/producao/cad/CadFichaCorte";
import { useFichaData } from "@/components/producao/cad/useFichaData";

/**
 * Monta a ficha (Técnica ou de Corte) oculta no DOCUMENTO PRINCIPAL (o CSS
 * @media print mostra só `.print-area` e esconde o resto), espera as imagens e
 * chama window.print() — mesma abordagem das telas de detalhe (CAD/Serviços),
 * que funciona no preview do Lovable. Use uma `key` única por clique p/ remontar
 * e poder imprimir o mesmo item de novo.
 *
 * `onDone` vai por ref para NÃO entrar nas deps do efeito (senão um re-render do
 * pai recriava onDone, disparava o cleanup e cancelava a impressão pendente).
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
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const ready = !!d.modelo && d.cadRow !== undefined;

  useEffect(() => {
    if (!ready || startedRef.current) return;
    startedRef.current = true;
    let cancelled = false;
    let doneTimer: ReturnType<typeof setTimeout> | undefined;

    const run = async () => {
      // Espera as imagens (signed URLs) carregarem, no máx. ~4s, p/ a foto não
      // sair em branco.
      const start = Date.now();
      while (!cancelled && Date.now() - start < 4000) {
        const imgs = Array.from(wrapRef.current?.querySelectorAll("img") ?? []);
        const allLoaded = imgs.length === 0 || imgs.every((img) => img.complete && img.naturalWidth > 0);
        if (allLoaded && Date.now() - start > 250) break;
        await new Promise((r) => setTimeout(r, 120));
      }
      if (cancelled) return;
      window.print();
      // Desmonta SÓ depois de um tempo: em navegadores onde print() é bloqueante
      // já voltou; nos não-bloqueantes (o conteúdo é capturado na chamada) damos
      // folga p/ não sumir antes. O clearTimeout no cleanup evita corrida quando
      // o usuário reimprime (nova key) antes desse tempo.
      doneTimer = setTimeout(() => { if (!cancelled) onDoneRef.current(); }, 1500);
    };
    run();
    return () => { cancelled = true; if (doneTimer) clearTimeout(doneTimer); };
  }, [ready]);

  return (
    <div ref={wrapRef}>
      {kind === "corte" ? <FichaCorteDoc modeloId={modeloId} /> : <FichaTecnica modeloId={modeloId} />}
    </div>
  );
}
