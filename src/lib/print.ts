// Imprime esperando as imagens carregarem (fotos/etiquetas usam signed URLs
// assíncronas — sem o "settle" a 1ª impressão sai sem elas). Mesma lógica do
// PrintFicha, extraída para as telas de detalhe (Oficina/CAD/Terceirizados) que
// chamavam window.print() direto.
//
// ⚠️ Se houver MAIS DE UMA `.print-area` no DOM (ex.: lista com N botões de imprimir,
// ou o documento do sheet coexistindo com o da linha), o `@media print` mostraria TODAS
// e o papel sairia com vários documentos juntos. Para blindar: antes de imprimir, esconde
// todas as `.print-area` MENOS a última montada (a do clique atual é sempre a mais recente),
// e restaura depois. Chamadas antigas (uma só print-area) seguem inalteradas.
export async function printWithImages(minSettle = 400, maxWait = 4000): Promise<void> {
  const areas = Array.from(document.querySelectorAll<HTMLElement>(".print-area"));
  const alvo = areas[areas.length - 1] ?? null;   // a mais recente = a do print atual
  const escondidas: HTMLElement[] = [];
  for (const a of areas) {
    if (a !== alvo) { a.setAttribute("data-print-skip", "true"); escondidas.push(a); }
  }

  const start = Date.now();
  const imgsLoaded = () => {
    const area = alvo ?? document.querySelector(".print-area") ?? document;
    const imgs = Array.from(area.querySelectorAll("img")) as HTMLImageElement[];
    return imgs.every((img) => img.complete && img.naturalWidth > 0);
  };
  // Piso (p/ as fotos assíncronas montarem) + todas as imagens completas; teto.
  while (true) {
    const el = Date.now() - start;
    if (el >= maxWait) break;
    if (el >= minSettle && imgsLoaded()) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  try {
    window.print();
  } finally {
    for (const a of escondidas) a.removeAttribute("data-print-skip");
  }
}
