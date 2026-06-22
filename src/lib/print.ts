// Imprime esperando as imagens carregarem (fotos/etiquetas usam signed URLs
// assíncronas — sem o "settle" a 1ª impressão sai sem elas). Mesma lógica do
// PrintFicha, extraída para as telas de detalhe (Oficina/CAD/Terceirizados) que
// chamavam window.print() direto.
export async function printWithImages(minSettle = 400, maxWait = 4000): Promise<void> {
  const start = Date.now();
  const imgsLoaded = () => {
    const area = document.querySelector(".print-area") ?? document;
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
  window.print();
}
