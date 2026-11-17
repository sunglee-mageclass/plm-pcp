// Compressão/redimensionamento de imagem no NAVEGADOR, sem dependência nova (canvas nativo).
// Uso: foto por variante (cor) do Armário — qualidade BAIXA aceita (vitrine), então reduz o maior
// lado para `maxLado` px e recomprime em JPEG. TOLERANTE: qualquer falha (não é imagem, sem canvas,
// toBlob null, arquivo maior depois de comprimir) devolve o arquivo ORIGINAL — nunca lança.
//
// Puro o suficiente para teste: em ambiente sem `createImageBitmap`/`document.createElement('canvas')`
// (Node/Vitest) ou com File que não é imagem, retorna o próprio arquivo na hora.

export interface ComprimirOpcoes {
  /** Maior lado da imagem resultante, em px (default 800). */
  maxLado?: number;
  /** Qualidade JPEG 0..1 (default 0.7). */
  qualidade?: number;
  /** Tipo de saída (default "image/jpeg"). */
  tipo?: string;
}

const PADRAO: Required<ComprimirOpcoes> = { maxLado: 800, qualidade: 0.7, tipo: "image/jpeg" };

/** true se o File aparenta ser uma imagem rasterizável (exclui SVG/vazios). */
export function ehImagemComprimivel(file: File): boolean {
  return (
    !!file &&
    typeof file.type === "string" &&
    file.type.startsWith("image/") &&
    file.type !== "image/svg+xml" &&
    file.size > 0
  );
}

/** Troca a extensão do nome para .jpg quando a saída vira JPEG (mantém o resto do nome). */
function nomeJpeg(nome: string): string {
  const base = nome.replace(/\.[^./\\]+$/, "");
  return `${base || "foto"}.jpg`;
}

/**
 * Recebe um File de imagem e devolve uma versão redimensionada + recomprimida (ou o próprio
 * arquivo, se não der para comprimir). NUNCA rejeita — erros viram o original.
 */
export async function comprimirImagem(file: File, opcoes: ComprimirOpcoes = {}): Promise<File> {
  const { maxLado, qualidade, tipo } = { ...PADRAO, ...opcoes };

  // Guardas de ambiente/entrada: sem canvas nativo ou não é imagem → devolve o original.
  if (!ehImagemComprimivel(file)) return file;
  if (typeof document === "undefined" || typeof createImageBitmap !== "function") return file;

  try {
    const bitmap = await createImageBitmap(file);
    const { width: w0, height: h0 } = bitmap;
    if (!w0 || !h0) {
      bitmap.close?.();
      return file;
    }

    const escala = Math.min(1, maxLado / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * escala));
    const h = Math.max(1, Math.round(h0 * escala));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close?.();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();

    const blob: Blob | null = await new Promise((resolve) => {
      if (typeof canvas.toBlob !== "function") {
        resolve(null);
        return;
      }
      canvas.toBlob((b) => resolve(b), tipo, qualidade);
    });
    if (!blob || blob.size === 0) return file;

    // Se comprimir NÃO reduziu (ex.: imagem já menor que maxLado e muito otimizada), fica com o menor.
    if (blob.size >= file.size) return file;

    return new File([blob], nomeJpeg(file.name), { type: blob.type || tipo, lastModified: Date.now() });
  } catch {
    return file; // qualquer falha: usa o original
  }
}
