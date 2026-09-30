// Contas certas — bloco A, parte FRONT: o detalhe da parcela avisa "ajustado à mão" (A1, P-165 A).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const ler = (rel: string) => readFileSync(ROOT + rel, "utf8");

// ─────────────────────────────── A1 ───────────────────────────────
describe("A1 — detalhe da parcela avisa 'ajustado à mão'", () => {
  it("fonte: ícone só com vencimento_manual e parcela não paga, com InfoHover explicando", () => {
    const fin = ler("src/routes/_authenticated/financeiro.tsx");
    expect(fin).toMatch(/vencimento_manual\?: boolean;/);
    expect(fin).toMatch(/\{parcela\.vencimento_manual && st !== "pago" && \(/);
    expect(fin).toMatch(/data-testid="venc-ajustado-mao"/);
    expect(fin).toMatch(
      /<InfoHover ariaLabel="Por que esta data não acompanha a Nota">\{TEXTO_VENCIMENTO_MANUAL\}<\/InfoHover>/,
    );
  });
});
