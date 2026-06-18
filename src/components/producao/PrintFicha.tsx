import { useEffect, useRef } from "react";
import { FichaTecnica } from "@/components/producao/FichaTecnica";
import { FichaCorteDoc } from "@/components/producao/cad/CadFichaCorte";
import { useFichaData } from "@/components/producao/cad/useFichaData";

/**
 * Monta a ficha (Técnica ou de Corte) OCULTA no documento (CSS: `.print-area`
 * fica `display:none` na tela e só aparece no @media print) e chama
 * window.print() quando os dados+imagens carregam.
 *
 * NÃO desmonta entre impressões: o disparo é por `token` (incrementa a cada
 * clique no ícone). Manter montado evita a corrida de remontagem que fazia a 2ª
 * impressão NÃO reabrir, e deixa as imagens já carregadas para a reimpressão.
 * Trocar o `modeloId` recarrega os dados da ficha do outro modelo.
 */
export function PrintFicha({
  modeloId,
  kind,
  token,
}: {
  modeloId: string;
  kind: "tecnica" | "corte";
  token: number;
}) {
  const d = useFichaData(modeloId);
  const wrapRef = useRef<HTMLDivElement>(null);
  const lastPrinted = useRef(0);
  const ready = d.isReady;

  useEffect(() => {
    if (!token || token === lastPrinted.current) return; // só em um novo pedido
    if (!ready) return; // espera os dados; quando `ready` virar true, o efeito re-roda
    lastPrinted.current = token;
    let cancelled = false;

    // Todas as <img> PRESENTES carregaram (true também quando ainda não há nenhuma
    // — daí o piso de settle abaixo dar tempo das fotos assíncronas montarem).
    const imgsLoaded = () => {
      const imgs = Array.from(wrapRef.current?.querySelectorAll("img") ?? []);
      return imgs.every((img) => img.complete && img.naturalWidth > 0);
    };

    // Piso (p/ as fotos — signed URLs assíncronas — montarem e carregarem) +
    // todas as imagens completas; teto de 4s (dentro da janela de ativação).
    const MIN_SETTLE = 400;
    const MAX_WAIT = 4000;
    const start = Date.now();
    const run = async () => {
      while (!cancelled) {
        const el = Date.now() - start;
        if (el >= MAX_WAIT) break;
        if (el >= MIN_SETTLE && imgsLoaded()) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      if (!cancelled) window.print();
    };
    run();

    return () => { cancelled = true; };
  }, [token, ready]);

  return (
    <div ref={wrapRef}>
      {kind === "corte" ? <FichaCorteDoc modeloId={modeloId} /> : <FichaTecnica modeloId={modeloId} />}
    </div>
  );
}
