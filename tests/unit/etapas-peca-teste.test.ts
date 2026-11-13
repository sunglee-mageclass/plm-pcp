// R9 (Peça Teste, T7) — as colunas `pt_*` de `producao_terceirizados` viram só pass-through (ninguém as lê nem as edita) e o painel
// "Etapas PL" saiu do PCP › Serviços. (Onda 4: os testes do board ANTIGO — montarCards/etapaDoBloco/useEtapasCards — saíram com ele.)
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { blocoDeLinha, blocoParaPayload, montarPayloadEdicaoRapida, type CampoRapido } from "@/lib/servicos-payload";
import { abertoPorCima, rotuloTelaBreadcrumb } from "@/components/planejamento/planejamento-detail/contexto";

const ler = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8");

describe("edição rápida — nunca grava pt_*; o servidor fica intocado (pass-through)", () => {
  it("CampoRapido = só data_enviado (fonte + tipo)", () => {
    const src = ler("src/lib/servicos-payload.ts");
    expect(src).toMatch(/export type CampoRapido = "data_enviado";/);
    const c: CampoRapido = "data_enviado";
    expect(c).toBe("data_enviado");
    expect(src).not.toMatch(/CampoRapido =[^;]*pt_/);
  });
  it("blocoParaPayload(blocoDeLinha(linha)) preserva os pt_* LIDOS da linha (interno limpa, como sempre)", () => {
    const linha = {
      id: "b1", categoria_terceirizado_id: "c", interno: false, empresa_id: "e",
      pt_data_saida: "2026-09-25", pt_data_entrada: "2026-09-30", pt_aprovacao: "reprovado",
    };
    const p = blocoParaPayload(blocoDeLinha(linha));
    expect([p.pt_data_saida, p.pt_data_entrada, p.pt_aprovacao]).toEqual(["2026-09-25", "2026-09-30", "reprovado"]);
    const interno = blocoParaPayload(blocoDeLinha({ ...linha, interno: true }));
    expect([interno.pt_data_saida, interno.pt_data_entrada, interno.pt_aprovacao]).toEqual([null, null, null]);
  });
  it("a edição rápida de data_enviado manda os pt_* lidos de TODOS os blocos sem mexer neles", () => {
    const linhas = [
      { id: "a", rev: 1, ativo: true, interno: false, categoria_terceirizado_id: "c", pt_data_saida: "2026-09-25", pt_data_entrada: null, pt_aprovacao: null },
      { id: "b", rev: 2, ativo: true, interno: false, categoria_terceirizado_id: "c", pt_data_saida: "2026-09-20", pt_data_entrada: "2026-09-22", pt_aprovacao: "aprovado" },
    ];
    const { _blocos } = montarPayloadEdicaoRapida({ linhas, blocoId: "a", campo: "data_enviado", valor: "2026-10-07" });
    expect(_blocos[0]).toMatchObject({ data_enviado: "2026-10-07", pt_data_saida: "2026-09-25", pt_data_entrada: null, pt_aprovacao: null });
    expect(_blocos[1]).toMatchObject({ pt_data_saida: "2026-09-20", pt_data_entrada: "2026-09-22", pt_aprovacao: "aprovado" });
  });
});

describe("telas — fonte", () => {
  it("PCP › Serviços NÃO importa nem renderiza EtapasPlPanel/ReprovadasPl; o filtro de reprovados saiu", () => {
    const src = ler("src/routes/_authenticated/pcp.servicos.$modeloId.tsx");
    expect(src).not.toMatch(/EtapasPlPanel|ReprovadasPl|reprovadosPl/);
    // Notas Fiscais e Peça de foto FICAM
    expect(src).toContain("Notas Fiscais");
    expect(src).toContain("Peça de foto");
    // o bloco legado reprovado volta à lista principal: nenhum filtro por pt_aprovacao
    expect(src).not.toMatch(/pt_aprovacao\s*===/);
  });
  it("pcp.etapas (board PL, Onda 3 Task 9): o card abre o Sheet de Serviços; fechar/salvar/mover relê cards E condições", () => {
    const src = ler("src/routes/_authenticated/pcp.etapas.tsx");
    expect(src).toContain("<EtapasPlKanban");
    expect(src).toContain("<TerceirizadosDetail");
    expect(src).toContain('queryKey: ["etapas-pl-cards"]');
    expect(src).toContain('queryKey: ["etapas-pl-cond"]');
    expect(src).not.toContain("<PlanejamentoDetail");
  });
  it("contexto pcp-etapas: aberto por cima; o breadcrumb segue \"Planejamento de Produto\"", () => {
    expect(abertoPorCima("pcp-etapas")).toBe(true);
    expect(rotuloTelaBreadcrumb("pcp-etapas")).toBe("Planejamento de Produto");
    expect(abertoPorCima("planejamento")).toBe(false);
  });
  it("Config da Loja › Etapas PL: o card novo (colunas + requisitos + chave) substituiu o das 5 etapas fixas (Onda 3, Task 7)", () => {
    const src = ler("src/routes/_authenticated/admin/configuracoes.tsx");
    expect(src).toContain("<EtapasPlConfigCard");
    expect(src).not.toContain("vem do card do produto (seção Peça Teste)"); // nota do EtapasPLCard antigo (5 etapas fixas)
    expect(ler("src/components/admin/EtapasPlConfigCard.tsx")).toContain("porta de entrada");
  });
});
