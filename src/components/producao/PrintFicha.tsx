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
  // Só imprime quando os dados ESSENCIAIS da ficha já carregaram (isReady),
  // senão o 1º clique (cache frio) saía em branco e era preciso clicar de novo.
  const ready = d.isReady;

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

    // Todas as <img> PRESENTES estão carregadas (true também quando ainda não há
    // nenhuma — daí o piso de settle abaixo dar tempo de a foto assíncrona montar).
    const imgsLoaded = () => {
      const imgs = Array.from(wrapRef.current?.querySelectorAll("img") ?? []);
      return imgs.every((img) => img.complete && img.naturalWidth > 0);
    };

    const doPrint = () => {
      if (cancelled) return;
      window.addEventListener("afterprint", done);
      // Rede de segurança caso afterprint não dispare (raro em alguns navegadores).
      fallback = setTimeout(done, 60000);
      window.print();
    };

    // Espera um piso (p/ a foto do modelo — signed URL assíncrona — montar e
    // carregar) e todas as imagens completarem; teto de 4s (dentro da janela de
    // "transient activation" do navegador, p/ o print() não ser suprimido).
    const MIN_SETTLE = 400;
    const MAX_WAIT = 4000;
    const start = Date.now();
    const poll = async () => {
      while (!cancelled) {
        const elapsed = Date.now() - start;
        if (elapsed >= MAX_WAIT) break;
        if (elapsed >= MIN_SETTLE && imgsLoaded()) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      doPrint();
    };
    poll();

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
