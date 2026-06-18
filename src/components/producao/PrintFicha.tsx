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
    let fallback: ReturnType<typeof setTimeout> | undefined;

    // Desmonta SÓ quando o diálogo fecha (evento afterprint) — não por timer.
    // Isso elimina a corrida em que um setTimeout escondia a .print-area antes
    // de o navegador capturar o layout, e permite reimprimir limpando o estado.
    const done = () => {
      if (cancelled) return;
      cancelled = true;
      window.removeEventListener("afterprint", done);
      if (fallback) clearTimeout(fallback);
      onDoneRef.current();
    };

    const imgsReady = () => {
      const imgs = Array.from(wrapRef.current?.querySelectorAll("img") ?? []);
      return imgs.length === 0 || imgs.every((img) => img.complete && img.naturalWidth > 0);
    };

    const doPrint = () => {
      if (cancelled) return;
      window.addEventListener("afterprint", done);
      // Rede de segurança caso afterprint não dispare (raro em alguns navegadores).
      fallback = setTimeout(done, 60000);
      window.print();
    };

    if (imgsReady()) {
      // Caso comum (reimpressão / imagens em cache): imprime IMEDIATAMENTE, o
      // mais perto possível do clique. Antes, um piso de 250ms forçava o print()
      // a sair de um setTimeout (fora do gesto), e o Chrome SUPRIMIA a 2ª
      // impressão silenciosamente. Síncrono aqui resolve o "não reabre".
      doPrint();
    } else {
      // Só espera (máx ~4s) quando a foto ainda não carregou, p/ não sair branca.
      const start = Date.now();
      const poll = async () => {
        while (!cancelled && Date.now() - start < 4000) {
          if (imgsReady()) break;
          await new Promise((r) => setTimeout(r, 100));
        }
        doPrint();
      };
      poll();
    }

    return () => {
      cancelled = true;
      window.removeEventListener("afterprint", done);
      if (fallback) clearTimeout(fallback);
    };
  }, [ready]);

  return (
    <div ref={wrapRef}>
      {kind === "corte" ? <FichaCorteDoc modeloId={modeloId} /> : <FichaTecnica modeloId={modeloId} />}
    </div>
  );
}
