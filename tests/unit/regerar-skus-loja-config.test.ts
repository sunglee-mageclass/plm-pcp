// "Regerar todos os SKUs da loja" - fiacao na Config da Loja (asserções de FONTE): o card novo logo ABAIXO do Formato do SKU, o `onDirtyChange` do Formato,
// os textos que citavam o "Regerar SKUs" do card como caminho unico e a acao nova na Auditoria. O comportamento esta em regerar-skus-loja-card.test.ts.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { ACAO_META } from "@/lib/audit-legivel";

const ler = (p: string) => readFileSync(p, "utf8");
const CFG = ler("src/routes/_authenticated/admin/configuracoes.tsx");
const FMT = ler("src/components/configuracoes/FormatoSkuCard.tsx");

describe("Config da Loja - card 'Regerar todos os SKUs da loja'", () => {
  it("montado DENTRO de data-colab-path='cfg:regerar_skus', logo depois do bloco do Formato do SKU, com paginaSuja e o rascunho do Formato", () => {
    const iFmt = CFG.indexOf('<div data-colab-path="cfg:sku_config">');
    const iReg = CFG.indexOf('<div data-colab-path="cfg:regerar_skus">');
    expect(iFmt).toBeGreaterThan(0);
    expect(iReg).toBeGreaterThan(iFmt);
    expect(CFG.slice(iFmt, iReg)).toContain("<FormatoSkuCard paginaSuja={dirty} onDirtyChange={setFormatoSujo} />");
    expect(CFG).toContain("<RegerarSkusLojaCard paginaSuja={dirty} formatoSujo={formatoSujo} />");
    expect(CFG).toContain("const [formatoSujo, setFormatoSujo] = useState(false);");
  });
  it("FormatoSkuCard avisa o rascunho sujo (onDirtyChange) e zera ao sair", () => {
    expect(FMT).toContain("onDirtyChange?: (sujo: boolean) => void");
    expect(FMT).toMatch(/onDirtyChange\?\.\(dirty\);\s+return \(\) => \{ onDirtyChange\?\.\(false\); \};/);
  });
  it("os 2 textos do Formato citam o 'Regerar todos os SKUs da loja' logo abaixo (o 'Regerar SKUs' do card deixou de ser o unico caminho)", () => {
    expect(FMT).toContain('Os SKUs já gerados não mudam sozinhos: só pelo "Regerar SKUs" do card ou pelo "Regerar todos os SKUs da loja" logo abaixo (os editados à mão nunca mudam).');
    expect(FMT).toContain('só pelo botão "Regerar SKUs" no card ou pelo "Regerar todos os SKUs da loja" logo abaixo (e os editados à mão nunca mudam).');
    expect(FMT).not.toContain('só pelo "Regerar SKUs" do card (os editados');
  });
  it("Auditoria: a acao regerar_skus_loja tem rotulo PT e a entidade 'SKU' esta no filtro", () => {
    expect(ACAO_META.regerar_skus_loja).toEqual({ label: "Regerou SKUs", tone: "warning" });
    expect(ler("src/routes/_authenticated/admin/auditoria.tsx")).toMatch(/"Produto Acabado", "Produto Importado",[\s\S]*?"SKU",\n\];/);
  });
  it("o laco so chama as 2 RPCs da Parte A (nenhuma conta de SKU no TS) e nunca ultrapassa o teto de 50", () => {
    const card = ler("src/components/configuracoes/RegerarSkusLojaCard.tsx");
    expect(card).toContain('supabase.rpc("regerar_skus_loja_previa" as any');
    expect(card).toContain('supabase.rpc("regerar_skus_loja_aplicar" as any');
    expect(card).not.toMatch(/skus_previa|aplicar_skus_modelo|_sku_|montarSku/);
    expect(ler("src/lib/regerar-skus-loja.ts")).toContain("export const TAMANHO_PAGINA_MAXIMO = 50;");
  });
});
