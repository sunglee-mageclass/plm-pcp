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

describe("P-171 A — 'Voltar ao cálculo automático' no detalhe da parcela", () => {
  it("fonte: botão só com a marca, parcela não paga e permissão de editar; AlertDialog; chama a RPC", () => {
    const fin = ler("src/routes/_authenticated/financeiro.tsx");
    expect(fin).toMatch(/\{parcela\.vencimento_manual && st !== "pago" && podeEditar && \(/);
    expect(fin).toMatch(/data-testid="venc-voltar-automatico"/);
    expect(fin).toMatch(/onClick=\{\(\) => setConfirmVoltarAuto\(true\)\}/);
    expect(fin).toMatch(
      /<AlertDialog open=\{confirmVoltarAuto\} onOpenChange=\{setConfirmVoltarAuto\}>/,
    );
    expect(fin).toMatch(/<AlertDialogTitle>Voltar ao cálculo automático\?<\/AlertDialogTitle>/);
    expect(fin).toMatch(
      /supabase\.rpc\("parcela_voltar_vencimento_automatico" as any, \{ _parcela_id: parcela\.id \}\)/,
    );
  });
  it("fonte: a linha do Vencimento quebra (flex-wrap) e o Salvar da data marca o selo na hora (otimista)", () => {
    const fin = ler("src/routes/_authenticated/financeiro.tsx");
    expect(fin).toMatch(
      /<div className="flex flex-wrap items-center gap-2">\s*<span className="text-muted-foreground">Vencimento:<\/span>/,
    );
    expect(fin).toMatch(/data_vencimento: vencimento, vencimento_manual: true/);
  });
});

describe("R1-L1 — depois de 'Voltar ao cálculo', o Salvar da data não reaparece", () => {
  it("fonte: o sucesso atualiza a parcela no cache (data + vencimento_manual false) e não usa setVencimento solto", () => {
    const fin = ler("src/routes/_authenticated/financeiro.tsx");
    const i = fin.indexOf("const voltarAutoMut = useMutation");
    const bloco = fin.slice(i, fin.indexOf("const recalcMut", i));
    expect(bloco).toMatch(/qc\.setQueryData<any\[\]>\(\["parcelas"\]/);
    expect(bloco).toMatch(/data_vencimento: data\.data_vencimento, vencimento_manual: false/);
    expect(bloco).not.toMatch(/setVencimento\(/);
  });
});
