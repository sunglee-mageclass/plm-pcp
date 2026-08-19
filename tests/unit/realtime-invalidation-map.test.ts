import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  REALTIME_INVALIDATION_TABLES,
  TAXONOMY_KEY_TOKENS,
  TENANT_CONFIG_EXTRA_KEYS,
  matchesTable,
  type RealtimeTable,
} from "@/lib/realtime-invalidation-map";

// ANTI-DRIFT do mapa de invalidação Realtime (useRealtimeInvalidation). Duas garantias:
// 1) COMPORTAMENTO — cada tabela casa as queryKeys reais que a leem e NÃO casa as de outras.
// 2) KEY VIVA — todo token bespoke do mapa (e as EXTRA keys de tenant_config) ainda existe
//    literalmente em src/. Se alguém renomear/remover uma queryKey sem atualizar o mapa, o
//    teste quebra (senão o mapa apontaria pra key morta e a tela pararia de atualizar ao vivo).

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SRC = path.join(ROOT, "src");

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name) && !/\.test\.[tj]sx?$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}
// Concatena todo o código-fonte (menos testes) num blob p/ o grep de "key viva".
const SRC_BLOB = walk(SRC)
  .filter((f) => !f.endsWith(path.join("lib", "realtime-invalidation-map.ts")))
  .map((f) => fs.readFileSync(f, "utf8"))
  .join("\n");

describe("realtime-invalidation-map: tabelas", () => {
  it("cobre exatamente as tabelas de config/cadastro esperadas", () => {
    expect([...REALTIME_INVALIDATION_TABLES].sort()).toEqual(
      [
        "categorias_produto",
        "categorias_terceirizado",
        "cores",
        "cores_apelido",
        "grupos_produto",
        "linhas",
        "lojas_direcionamento",
        "meses",
        "subcategorias1_produto",
        "subcategorias2_produto",
        "tenant_config",
      ].sort(),
    );
  });

  it("toda tabela do mapa tem entrada de tokens (menos tenant_config, que é predicate próprio)", () => {
    for (const t of REALTIME_INVALIDATION_TABLES) {
      if (t === "tenant_config") continue;
      expect(TAXONOMY_KEY_TOKENS[t as Exclude<RealtimeTable, "tenant_config">]).toBeDefined();
    }
  });
});

describe("realtime-invalidation-map: nenhuma key morta", () => {
  it("cada token bespoke de taxonomia existe literalmente em src/", () => {
    for (const [table, tokens] of Object.entries(TAXONOMY_KEY_TOKENS)) {
      for (const tok of tokens) {
        expect(SRC_BLOB.includes(`"${tok}"`), `token "${tok}" (${table}) sumiu de src/`).toBe(true);
      }
    }
  });

  it("cada EXTRA key de tenant_config existe literalmente em src/", () => {
    for (const tok of TENANT_CONFIG_EXTRA_KEYS) {
      expect(SRC_BLOB.includes(`"${tok}"`), `EXTRA key "${tok}" sumiu de src/`).toBe(true);
    }
  });

  it("cada nome de tabela aparece como .from(\"<tabela>\") em src/ (leitura viva)", () => {
    for (const t of REALTIME_INVALIDATION_TABLES) {
      // lojas_direcionamento é lida via `.from("lojas_direcionamento" as any)`.
      expect(SRC_BLOB.includes(`.from("${t}"`), `tabela ${t} sem .from() em src/`).toBe(true);
    }
  });
});

describe("realtime-invalidation-map: comportamento do predicate", () => {
  it("tenant_config casa as queryKeys reais de config", () => {
    const casa = [
      ["tenant_config", "modules", "t1"],
      ["tenant_config", "timezone", "t1"],
      ["tenant-status-kanban", "t1"],
      ["tenant-kanban-requisitos", "t1"],
      ["tenant-config-grade", "t1"],
      ["tenant-config-tamanhos-planejamento", "t1"],
      ["cad-tenant-config-grade", "t1"],
      ["ft-tamanhos", "t1"],
      ["plan-tecido-tamanhos"],
      ["confeccao-prioridade", "t1"], // buraco fechado
      ["cq-confeccao-prioridade", "t1"], // buraco fechado
      ["plan-tecido-kanban-cols"], // buraco fechado
    ];
    for (const k of casa) expect(matchesTable("tenant_config", k), JSON.stringify(k)).toBe(true);
  });

  it("tenant_config NÃO casa keys de taxonomia/dados", () => {
    for (const k of [["cores-list"], ["linhas-markup"], ["modelos-desenvolvimento"], ["opt", "meses"]]) {
      expect(matchesTable("tenant_config", k), JSON.stringify(k)).toBe(false);
    }
  });

  it("taxonomias casam loaders genéricos (k[1]===tabela) e keys bespoke", () => {
    expect(matchesTable("linhas", ["opt", "linhas"])).toBe(true);
    expect(matchesTable("linhas", ["opt", "linhas", "com-markup"])).toBe(true);
    expect(matchesTable("linhas", ["linhas-markup"])).toBe(true);
    expect(matchesTable("linhas", ["plan-tecido-linhas-markup"])).toBe(true);
    expect(matchesTable("meses", ["opt-panel", "meses"])).toBe(true);
    expect(matchesTable("meses", ["opt-pv", "meses"])).toBe(true);
    expect(matchesTable("cores", ["opt-ocpa", "cores"])).toBe(true);
    expect(matchesTable("grupos_produto", ["opt-produto-acabado", "grupos_produto"])).toBe(true);
    expect(matchesTable("categorias_terceirizado", ["categorias_terceirizado", "colab"])).toBe(true);
    expect(matchesTable("categorias_terceirizado", ["cats-servico-ativas"])).toBe(true);
    expect(matchesTable("lojas_direcionamento", ["dir-lojas", "t1"])).toBe(true);
    expect(matchesTable("lojas_direcionamento", ["lojas-direcionamento"])).toBe(true);
  });

  it("taxonomia NÃO casa key de outra tabela", () => {
    expect(matchesTable("linhas", ["cores-list"])).toBe(false);
    expect(matchesTable("cores", ["opt", "linhas"])).toBe(false);
    expect(matchesTable("meses", ["tenant-status-kanban", "t1"])).toBe(false);
  });
});
