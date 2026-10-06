// [urg R9, T8] A Explosão vira a 1a página do PCP: URL /pcp/explosao, mesma permissão (`producao_explosao`), grupo PCP no
// editor de permissões; a URL antiga (/entrada-saida/explosao) e a legada (/criacao/explosao) só redirecionam.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { PAGES_CATALOG, modulosExigidosDaPagina } from "@/lib/permissions-catalog";
import { PAGE_URLS } from "@/lib/nav";

const ler = (p: string) => readFileSync(p, "utf8");
const ROTAS = "src/routes/_authenticated";

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? arquivos(p) : [p];
  });
}

describe("Explosão no PCP — catálogo e URL", () => {
  it("PAGE_URLS.producao_explosao = /pcp/explosao", () => {
    expect(PAGE_URLS.producao_explosao).toBe("/pcp/explosao");
  });

  it("a página está no módulo pcp e é a 1a (Explosão → Serviços → Etapas); Entrada e Saída não a lista mais", () => {
    const pcp = PAGES_CATALOG.find((m) => m.module === "pcp")!;
    expect(pcp.pages[0].key).toBe("producao_explosao");
    const chaves = pcp.pages.map((p) => p.key);
    expect(chaves.indexOf("producao_explosao")).toBeLessThan(chaves.indexOf("producao_terceirizados"));
    expect(chaves.indexOf("producao_terceirizados")).toBeLessThan(chaves.indexOf("producao_etapas"));
    const es = PAGES_CATALOG.find((m) => m.module === "entrada_saida")!;
    expect(es.pages.map((p) => p.key)).not.toContain("producao_explosao");
    // só em UM grupo
    expect(PAGES_CATALOG.filter((m) => m.pages.some((p) => p.key === "producao_explosao")).map((m) => m.module)).toEqual(["pcp"]);
  });

  it("mesma permissão/gate/modo de antes, com a nota 'veio de Entrada e Saída' para o editor", () => {
    const p = PAGES_CATALOG.find((m) => m.module === "pcp")!.pages[0];
    expect(p.gate).toBe("criacao");
    expect(p.modes).toEqual(["full"]);
    expect(p.notaEditor).toBe("veio de Entrada e Saída");
    expect(p.label).toBe("Explosão");
  });

  it("a descrição de Etapas diz que a Peça Teste vem do card do produto", () => {
    const e = PAGES_CATALOG.find((m) => m.module === "pcp")!.pages.find((x) => x.key === "producao_etapas")!;
    expect(e.description).toBe("Quadro de Etapas PL — Peça Teste vem do card do produto.");
  });

  it("módulos exigidos pela tela = Criação + Produção (o portão do banco segue em entrada_saida)", () => {
    expect(modulosExigidosDaPagina("producao_explosao")).toEqual(["criacao", "producao"]);
  });

  it("o editor de permissões renderiza a notaEditor nas duas grades (usuário e papel)", () => {
    const src = ler("src/components/admin/PermissoesModal.tsx");
    expect(src.match(/p\.notaEditor/g)?.length).toBeGreaterThanOrEqual(2);
  });
});

describe("Explosão no PCP — rotas", () => {
  it("as 2 rotas antigas só redirecionam para /pcp/explosao", () => {
    for (const f of ["entrada-saida.explosao.tsx", "criacao.explosao.tsx"]) {
      const s = ler(`${ROTAS}/${f}`);
      expect(s, f).toMatch(/throw redirect\(\{ to: "\/pcp\/explosao" \}\)/);
      expect(s, f).not.toContain("RequirePermission");
    }
  });

  it("o layout /pcp/explosao guarda pela mesma permissão", () => {
    const s = ler(`${ROTAS}/pcp.explosao.tsx`);
    expect(s).toContain('createFileRoute("/_authenticated/pcp/explosao")');
    expect(s).toContain('<RequirePermission page="producao_explosao">');
    expect(s).toContain("<Outlet />");
  });

  it("a lista mora em pcp.explosao.index.tsx e a rota antiga da lista não existe mais", () => {
    expect(ler(`${ROTAS}/pcp.explosao.index.tsx`)).toContain('createFileRoute("/_authenticated/pcp/explosao/")');
    expect(() => statSync(`${ROTAS}/entrada-saida.explosao.index.tsx`)).toThrow();
  });

  it('nenhum "/entrada-saida/explosao" sobra em src/ fora do redirect e do routeTree.gen.ts', () => {
    const sobra = arquivos("src")
      .filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith("routeTree.gen.ts"))
      .filter((f) => ler(f).includes("/entrada-saida/explosao"))
      .map((f) => f.replace(/\\/g, "/"));
    // o próprio redirect (arquivo de rota antigo) cita a URL antiga em createFileRoute; o resto não pode citar
    expect(sobra.filter((f) => f !== `${ROTAS}/entrada-saida.explosao.tsx`)).toEqual([]);
  });
});
