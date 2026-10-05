import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { blocoDeLinha, blocoParaPayload } from "@/lib/servicos-payload";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const PCP = readFileSync(ROOT + "src/routes/_authenticated/pcp.servicos.$modeloId.tsx", "utf8");

// R6 (dono 05/out): PCP › Serviços deixa de MOSTRAR "Aviamentos Enviados", "Tecidos, Forros e Entretelas Enviados" e as
// Observações do produto. O DADO fica: o Salvar devolve o valor lido e a OS impressa continua listando aviamentos/tecidos.
describe("R6 — PCP › Serviços sem aviamentos/tecidos enviados e sem Observações do produto", () => {
  it("a tela não tem mais os 2 grupos nem as Observações do produto", () => {
    expect(PCP).not.toContain("Aviamentos Enviados");
    expect(PCP).not.toContain("Tecidos, Forros e Entretelas Enviados");
    expect(PCP).not.toContain("<ModeloObservacoes");
    expect(PCP).not.toMatch(/import \{ ModeloObservacoes \}/);
  });

  it("a Observação de Partes do Molde (e o Label Observação do bloco) continuam", () => {
    expect(PCP).toContain("Observação de Partes do Molde");
    expect(PCP).toMatch(/<Label className="text-xs">Observação<\/Label>/);
  });

  it("a OS impressa segue montando aviamentos e tecidos a partir dos enviados do bloco", () => {
    expect(PCP).toMatch(/aviamentos: \(b\.aviamentos_enviados \?\? \[\]\)\.map\(aviLabel\)/);
    expect(PCP).toMatch(/tecidos: \(b\.tecidos_enviados \?\? \[\]\)\.map\(tecLabel\)/);
    const OS = readFileSync(ROOT + "src/components/producao/OrdemServicoTerceirizados.tsx", "utf8");
    expect(OS).toContain("Aviamentos enviados:");
    expect(OS).toContain("Tecidos enviados:");
  });

  it("o Salvar devolve os enviados IGUAIS aos da linha (o dado só sai da tela)", () => {
    const linha = {
      id: "b1",
      categoria_terceirizado_id: "c1",
      interno: false,
      aviamentos_enviados: [
        { aviamento_id: "av1", variante_aviamento_id: "va1" },
        { aviamento_id: "av2", variante_aviamento_id: null },
      ],
      tecidos_enviados: ["v1", "v2"],
    };
    const bloco = blocoDeLinha(linha);
    const payload = blocoParaPayload(bloco);
    expect(payload.aviamentos_enviados).toEqual(bloco.aviamentos_enviados);
    expect(payload.aviamentos_enviados).toEqual(linha.aviamentos_enviados);
    expect(payload.tecidos_enviados).toEqual(linha.tecidos_enviados);
  });
});
