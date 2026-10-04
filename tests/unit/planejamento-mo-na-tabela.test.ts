import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// F3.6 (Parte A — spec 2026-09-25 §5.1/§5.3): a seção "Mão de obra" deixa de existir no Sheet; o MaoObraEditor (SEM mudança)
// entra na tabela de "Preço e Custos", logo abaixo da linha "Mão de obra", e a Obs. logo abaixo do "Custo total". Sem
// @testing-library no repo: gates de FONTE (mesmo padrão de planejamento-dev-equipe-disabled.test.ts).
const fonte = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8");
const PD = "src/components/planejamento/PlanejamentoDetail.tsx";
const PT = "src/components/planejamento/planejamento-detail/PrecoTabela.tsx";
const RS = "src/components/planejamento/planejamento-detail/RevendaSetores.tsx";

describe("Mão de obra DENTRO de Preço e Custos (fonte)", () => {
  it("o Sheet não tem mais a seção própria; o Dialog 'Novo Modelo' mantém a MO sem número (mao_obra_novo — Ruling R1)", () => {
    const s = fonte(PD);
    expect(s).not.toContain('<Secao id="mao_obra"');
    expect(s).toContain('<Secao id="mao_obra_novo" titulo="Mão de obra"');
    expect(s).toContain("const moBlocoVisivel = (!isComprado ? true : isEdit) && (veCustos || (isEdit && podeAprovarMaoObra));");
    expect(s).toContain("mao_obra_novo: !isEdit && moBlocoVisivel,");
    expect(s.split("blocoMaoObra={moBlocoVisivel ? editorMaoObra : null}").length - 1).toBe(2); // PrecoTabela + PrecoRevendaBloco
    // [modularidade F3] o texto do bloqueio do Lançar saiu para `bloqueiosLancar` (src/lib/lancar.ts)
    expect(fonte("src/lib/lancar.ts")).toContain("(na seção Preço e Custos)");
    expect(s).not.toMatch(/maoObra: \{ estado: moEstadoLocal/);
    // R15 (item 13 do G-plano): o aviso de MO pendente/reprovada vai p/ o selo de Preço — interno E comprado.
    expect(s).toContain('maoObraAviso: moBlocoVisivel && (moEstadoLocal === "pendente" || moEstadoLocal === "reprovada") ? moEstadoLocal : null,');
    expect(s).toContain('label="Observação de mão de obra"'); // R34 — prop que o ObsMaoObraField JÁ tem
  });
  it("PrecoTabela: bloco logo abaixo da linha 'Mão de obra', Obs. logo abaixo do 'Custo total'; frase velha saiu", () => {
    const s = fonte(PT);
    const iMo = s.indexOf(">Mão de obra</td>");
    const iBloco = s.indexOf("{blocoMaoObra && (");
    const iTotal = s.indexOf(">Custo total</td>");
    const iObs = s.indexOf("{obsMaoObra && (");
    expect(iMo).toBeGreaterThan(0);
    expect(iBloco).toBeGreaterThan(iMo);
    expect(iTotal).toBeGreaterThan(iBloco);
    expect(iObs).toBeGreaterThan(iTotal);
    expect(s).not.toContain("na seção Mão de obra abaixo");
    // RODADA DE CORREÇÃO 1 (I2/M1): o Sheet só é tela cheia abaixo de 640px (max-sm); de 640-767px ele é 70vw
    // (size="editor" do SheetContent) — a largura do bloco sticky precisa refletir os DOIS breakpoints, com
    // -4rem (Sheet px-6 = 3rem + célula px-2 = 1rem) em vez do -3rem antigo (que só contava o px-6 do Sheet).
    expect(s).toContain("max-md:sticky max-md:left-0 max-sm:w-[calc(100vw-4rem)] sm:max-md:w-[calc(70vw-4rem)]");
  });
  it("Revenda: o bloco de preço recebe a MO (opção A do dono)", () => {
    expect(fonte(RS)).toMatch(/export function PrecoRevendaBloco\(\{[^}]*blocoMaoObra[^}]*obsMaoObra/);
  });
});
