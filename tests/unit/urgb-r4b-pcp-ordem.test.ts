import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const PCP = readFileSync(ROOT + "src/routes/_authenticated/pcp.servicos.$modeloId.tsx", "utf8");

// R4b fix round 1: os blocos que nascem da M.O. no Enviar à Explosão têm created_at crescente na ordem da M.O.
// (_servicos_da_mo_criar, migration 20261103181000). A tela do PCP tem de listar por created_at, id — senão a ordem fica a do heap.
describe("R4b — PCP › Serviços lista os blocos por created_at, id", () => {
  it("a leitura dos blocos ativos do CAD ordena por created_at e desempata por id", () => {
    const i = PCP.indexOf('.from("producao_terceirizados")');
    expect(i).toBeGreaterThan(-1);
    const trecho = PCP.slice(i, PCP.indexOf("if (error) throw error;", i));
    expect(trecho).toContain('.eq("ativo", true)');
    expect(trecho).toMatch(/\.order\("created_at", \{ ascending: true \}\)\s*\n\s*\.order\("id", \{ ascending: true \}\)/);
  });
});
