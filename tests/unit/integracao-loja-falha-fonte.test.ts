// [backend F1, review m3] Integração suja + troca de loja cuja releitura FALHOU: a página desmonta (RequirePermission mostra o
// aviso) e o rascunho some — no desmonte, com a loja zerada no cache e o rascunho sujo, sai o MESMO toast de descarte.
// (Asserção de texto: a página inteira é pesada demais para montar aqui; o comportamento por trás — query zerada — está em
// `use-active-tenant-erro.test.ts`.)
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync("src/components/integracao/IntegracaoPage.tsx", "utf8");

describe("IntegracaoPage — troca de loja que falhou", () => {
  it("o desmonte avisa o descarte quando sujo e a loja ativa sumiu do cache (nunca em navegação normal)", () => {
    expect(src).toContain("if (!u.dirty || !u.lojaEstavel || !u.userId) return;");
    expect(src).toContain('if (qc.getQueryData(["active-tenant-id", u.userId]) !== undefined) return;');
    expect(src).toContain('avisarTrocaDeLoja("loja_indisponivel"');
    // cleanup de efeito (retorno de função), não render
    expect(src).toMatch(/useEffect\(\s*\(\) => \(\) => \{\s*const u = ultimoRef\.current;/);
  });
});
