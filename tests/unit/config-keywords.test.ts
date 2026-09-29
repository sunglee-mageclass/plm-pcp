import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { keywordsDoServidor, keywordsParaPayload } from "@/lib/config-keywords";

// F3.6 (dono 25/set — R38/R39): Keywords da loja na Config. Regra pura + gate de FONTE da tela (sem testing-library).
describe("config-keywords", () => {
  it("keywordsDoServidor: texto ou vazio (NULL/ausente = vazio)", () => {
    expect(keywordsDoServidor("moda, linho")).toBe("moda, linho");
    expect(keywordsDoServidor(null)).toBe("");
    expect(keywordsDoServidor(undefined)).toBe("");
    expect(keywordsDoServidor(5)).toBe("");
  });
  it("keywordsParaPayload: não mudou ⇒ a chave NÃO vai (aba velha não regrava); mudou ⇒ vai; só espaços ⇒ NULL", () => {
    expect(keywordsParaPayload("moda", "moda")).toEqual({});
    expect(keywordsParaPayload("", null)).toEqual({});
    expect(keywordsParaPayload("moda, linho", "moda")).toEqual({ keywords: "moda, linho" });
    expect(keywordsParaPayload("  ", "moda")).toEqual({ keywords: null });
    expect(keywordsParaPayload("linha 1\nlinha 2", null)).toEqual({ keywords: "linha 1\nlinha 2" });
  });
});

describe("Config da Loja — card Keywords (fonte)", () => {
  const s = readFileSync(fileURLToPath(new URL("../../src/routes/_authenticated/admin/configuracoes.tsx", import.meta.url)), "utf8");
  it("Textarea no cfg geral (mesmo Salvar/guarda), lida do servidor e no save SÓ se mudou", () => {
    expect(s).toContain("<CardTitle>Keywords</CardTitle>");
    expect(s).toContain('id="cfg-keywords"');
    expect(s).toContain("onChange={(e) => setCfg((c) => ({ ...c, keywords: e.target.value }))}");
    expect(s).toContain("keywords: keywordsDoServidor((r as any).keywords),");
    // T3 da Config colaborativa: "só se mudou" agora vale para TODAS as colunas — `montarMudancas`
    // (config-loja-colab.ts, com a mesma regra "só espaços ⇒ NULL" em `serializarColuna`) monta o
    // payload da RPC `salvar_config_loja`; o antigo `keywordsParaPayload` no upsert saiu da tela.
    expect(s).toContain("montarMudancas({");
    expect(s).toContain('supabase.rpc("salvar_config_loja"');
    expect(s).not.toContain("keywordsParaPayload(");
  });
});
