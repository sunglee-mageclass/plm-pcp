import { useEffect, useRef } from "react";
import { FichaTecnica } from "@/components/producao/FichaTecnica";
import { FichaCorteDoc } from "@/components/producao/cad/CadFichaCorte";
import { useFichaData } from "@/components/producao/cad/useFichaData";

/**
 * Imprime um elemento .print-area de forma confiável e REPETÍVEL: copia o HTML
 * + as folhas de estilo da página para um iframe oculto novo a cada impressão,
 * espera as imagens carregarem e chama print() do iframe. Cada chamada é isolada
 * (iframe próprio), então imprimir de novo sempre funciona.
 */
async function printAreaViaIframe(area: HTMLElement) {
  const iframe = document.createElement("iframe");
  Object.assign(iframe.style, {
    position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0", visibility: "hidden",
  } as CSSStyleDeclaration);
  document.body.appendChild(iframe);
  const win = iframe.contentWindow;
  const doc = win?.document;
  if (!win || !doc) { iframe.remove(); return; }

  const heads = Array.from(document.head.querySelectorAll('style, link[rel="stylesheet"]'))
    .map((n) => n.outerHTML)
    .join("");

  doc.open();
  doc.write(
    `<!doctype html><html><head><base href="${location.origin}">${heads}` +
    `<style>@page{size:A4;margin:12mm}html,body{margin:0;padding:0;background:#fff}` +
    `.print-area{display:block!important;position:static!important;padding:0!important}` +
    `.no-print{display:none!important}</style></head><body>${area.outerHTML}</body></html>`,
  );
  doc.close();

  // Espera as imagens do iframe (signed URLs vêm do cache da página), no máx. ~3s.
  await new Promise<void>((resolve) => {
    const imgs = Array.from(doc.images);
    if (imgs.length === 0) return resolve();
    let pending = imgs.length;
    let settled = false;
    const done = () => { if (!settled && --pending <= 0) { settled = true; resolve(); } };
    imgs.forEach((img) => { if (img.complete) done(); else { img.onload = done; img.onerror = done; } });
    setTimeout(() => { if (!settled) { settled = true; resolve(); } }, 3000);
  });

  win.focus();
  win.print();
  setTimeout(() => iframe.remove(), 1000);
}

/**
 * Monta a ficha (Técnica ou de Corte) oculta, e quando os dados resolvem dispara
 * a impressão via iframe. `key` única por clique força remontagem.
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
  // onDone via ref para NÃO entrar nas deps do efeito — senão, qualquer re-render
  // do pai recriava onDone, disparava o cleanup e CANCELAVA a impressão pendente
  // (era o motivo de "não poder imprimir de novo").
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const ready = !!d.modelo && d.cadRow !== undefined;

  useEffect(() => {
    if (!ready || startedRef.current) return;
    startedRef.current = true;
    let cancelled = false;
    // Pequeno atraso p/ o doc React pintar antes de copiar o HTML.
    const t = setTimeout(async () => {
      const area = wrapRef.current?.querySelector(".print-area") as HTMLElement | null;
      if (area && !cancelled) await printAreaViaIframe(area);
      if (!cancelled) onDoneRef.current();
    }, 150);
    return () => { cancelled = true; clearTimeout(t); };
  }, [ready]);

  return (
    <div ref={wrapRef}>
      {kind === "corte" ? <FichaCorteDoc modeloId={modeloId} /> : <FichaTecnica modeloId={modeloId} />}
    </div>
  );
}
