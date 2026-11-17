import { describe, it, expect } from "vitest";
import { comprimirImagem, ehImagemComprimivel } from "@/lib/comprimir-imagem";

// Ambiente Vitest = node, SEM createImageBitmap/canvas reais: validamos as BORDAS (tolerância a
// falha e não-imagem). O caminho feliz (canvas de verdade) roda no navegador do usuário.

const arquivo = (nome: string, tipo: string, bytes = 10): File =>
  new File([new Uint8Array(bytes)], nome, { type: tipo });

describe("ehImagemComprimivel", () => {
  it("aceita png/jpeg/webp com conteudo", () => {
    expect(ehImagemComprimivel(arquivo("a.png", "image/png"))).toBe(true);
    expect(ehImagemComprimivel(arquivo("a.jpg", "image/jpeg"))).toBe(true);
    expect(ehImagemComprimivel(arquivo("a.webp", "image/webp"))).toBe(true);
  });
  it("recusa svg, nao-imagem e vazio", () => {
    expect(ehImagemComprimivel(arquivo("a.svg", "image/svg+xml"))).toBe(false);
    expect(ehImagemComprimivel(arquivo("a.pdf", "application/pdf"))).toBe(false);
    expect(ehImagemComprimivel(arquivo("a.png", "image/png", 0))).toBe(false);
  });
});

describe("comprimirImagem (bordas)", () => {
  it("devolve o PROPRIO arquivo quando nao e imagem", async () => {
    const f = arquivo("doc.pdf", "application/pdf");
    expect(await comprimirImagem(f)).toBe(f);
  });

  it("devolve o PROPRIO arquivo para svg", async () => {
    const f = arquivo("logo.svg", "image/svg+xml");
    expect(await comprimirImagem(f)).toBe(f);
  });

  it("sem canvas/createImageBitmap no ambiente, devolve o original sem lancar", async () => {
    const f = arquivo("foto.png", "image/png");
    // Em node createImageBitmap nao existe -> caminho de guarda -> original.
    const out = await comprimirImagem(f);
    expect(out).toBe(f);
  });

  it("nunca rejeita", async () => {
    await expect(comprimirImagem(arquivo("x.jpg", "image/jpeg"))).resolves.toBeInstanceOf(File);
  });
});
