import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const ler = (r: string) => readFileSync(ROOT + r, "utf8");
function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? arquivos(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}
const ROTA = "src/routes/_authenticated/distribuicao.index.tsx";

describe("Distribuição antiga — OCULTA e DESATIVADA, nada apagado (dono 26/set, P-49 B)", () => {
  it("os arquivos antigos continuam no repositório (aposentadoria é depois, em partes)", () => {
    for (const f of [ROTA, "src/components/distribuicao/DistribuicaoTabela.tsx", "src/components/distribuicao/ResumoColecao.tsx",
      "src/lib/distribuicao.ts", "tests/unit/distribuicao.test.ts"]) expect(existsSync(ROOT + f), f).toBe(true);
  });
  it("a rota mostra o aviso e não monta a página antiga", () => {
    const r = ler(ROTA);
    expect(r).toContain("const PAGINA_ATIVA = false;");
    expect(r).toContain("Tela desativada");
    expect(r).toContain("Distribuir por loja");
    expect(r).toContain('to="/criacao/plan-tecido"');
    expect(r).toMatch(/PAGINA_ATIVA\s*\?/);
  });
  it("sai do menu: nav, catálogo e sidebar não citam a página", () => {
    expect(ler("src/lib/nav.ts")).not.toMatch(/distribuicao/);
    expect(ler("src/lib/permissions-catalog.ts")).not.toMatch(/module: "distribuicao"|basePath: "\/distribuicao"/);
    expect(ler("src/components/app-sidebar.tsx")).not.toContain('"/distribuicao"');
  });
  it("só a própria página antiga usa a lib/os componentes antigos", () => {
    const quem = arquivos(ROOT + "src")
      .filter((f) => /from "@\/lib\/distribuicao"|components\/distribuicao\//.test(readFileSync(f, "utf8")))
      .map((f) => relative(ROOT, f).split("\\").join("/"))
      .sort();
    const permitidos = [ROTA, "src/components/distribuicao/DistribuicaoTabela.tsx", "src/components/distribuicao/ResumoColecao.tsx"];
    expect(quem).toContain(ROTA);
    for (const f of quem) expect(permitidos, f).toContain(f);
  });
  it("o módulo 'distribuicao' continua: opt-in no front e ligável em Gerenciar Lojas", () => {
    const tm = ler("src/hooks/useTenantModules.ts");
    expect(tm).toMatch(/\| "distribuicao"/);
    expect(tm).toMatch(/distribuicao: false/);
    expect(tm).toContain('distribuicao: "/criacao/plan-tecido"');
    const lj = ler("src/routes/_authenticated/admin/lojas.tsx");
    expect(lj).toContain('out.push({ key: "distribuicao", label: "Distribuição por produto" });');
    expect(lj).toMatch(/distribuicao: false/);
  });
});
