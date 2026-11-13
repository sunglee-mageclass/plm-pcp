// @vitest-environment happy-dom
// Empty-state da seção "Peça Teste": produto SEM nenhum serviço de M.O. que exija peça teste não mostra a seção vazia —
// explica por quê e (onde há modeloId) dá o atalho ao Planejamento. O caso normal (com trilhas) não muda.
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Sem RouterProvider no render estático: o Link vira um <a> simples (to + search).
vi.mock("@tanstack/react-router", async (orig) => ({
  ...(await orig<typeof import("@tanstack/react-router")>()),
  Link: ({ to, search, children, ...rest }: any) =>
    createElement("a", { href: `${to}?${new URLSearchParams(search).toString()}`, ...rest }, children),
}));

import { PecaTesteSecao } from "../../src/components/planejamento/planejamento-detail/PecaTesteSecao";
import { tentativaVirtual, type EstadoPT, type TrilhaPT } from "../../src/lib/peca-teste";

const L1 = "00000000-0000-4000-8000-0000000000a1";
const noop = () => {};
type Props = Parameters<typeof PecaTesteSecao>[0];
function render(over: Partial<Props> & { estado: EstadoPT | null }): string {
  const props: Props = {
    numero: 12, base: over.estado, fornecedores: [], defaultAberta: true,
    onEditarAtual: noop, onAprovar: noop, onDesfazer: noop, onReprovar: noop, onTrocarFornecedor: noop,
    ...over,
  };
  return renderToStaticMarkup(createElement(PecaTesteSecao, props));
}
const vazio: EstadoPT = { trilhas: [], outros: [] };
const comTrilha: EstadoPT = {
  trilhas: [{ mo_linha_id: L1, categoria_id: "c", categoria_nome: "PL", empresa_id: null, empresa_nome: null, mo_aprovado: true, tentativas: [{ ...tentativaVirtual(1) }] } as TrilhaPT],
  outros: [],
};

describe("PecaTesteSecao — empty-state (produto sem serviço que exige peça teste)", () => {
  it("sem trilhas/linhasNovas/outros: mostra a mensagem explicativa", () => {
    const html = render({ estado: vazio });
    expect(html).toContain('data-testid="peca-teste-vazia"');
    expect(html).toContain("não tem nenhum serviço que exija peça teste");
    expect(html).toContain("Exige peça teste");
  });

  it("sem linkPlanejamento: só a mensagem, sem link", () => {
    const html = render({ estado: vazio });
    expect(html).not.toContain("Abrir no Planejamento");
    expect(html).not.toContain("peca-teste-vazia-link");
  });

  it("com linkPlanejamento: mostra o link para o Planejamento do produto", () => {
    const html = render({ estado: vazio, linkPlanejamento: "/criacao/planejamento?modelo=abc" });
    expect(html).toContain("Abrir no Planejamento");
    expect(html).toContain('href="/criacao/planejamento?modelo=abc"');
  });

  it("carregando/erro sem estado: NÃO mostra o empty-state", () => {
    expect(render({ estado: null, carregando: true })).not.toContain("peca-teste-vazia");
    expect(render({ estado: null, erro: true })).not.toContain("peca-teste-vazia");
  });

  it("com trilhas (caso normal): NÃO mostra o empty-state", () => {
    const html = render({ estado: comTrilha, linkPlanejamento: "/criacao/planejamento?modelo=abc" });
    expect(html).not.toContain("peca-teste-vazia");
    expect(html).toContain("serviços com peça teste aprovada");
  });

  it("só linhasNovas ou só outros: NÃO mostra o empty-state (já há o que explicar)", () => {
    expect(render({ estado: vazio, linhasNovas: ["PL"] })).not.toContain("peca-teste-vazia");
    const html = render({ estado: { trilhas: [], outros: [{ categoria_nome: "Bordado", empresa_nome: null } as any] } });
    expect(html).not.toContain("peca-teste-vazia");
    expect(html).toContain("peca-teste-fora");
  });
});
