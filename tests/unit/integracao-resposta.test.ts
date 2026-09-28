// @vitest-environment happy-dom
// A parte de cima (montarResposta/montarManual/respostaExemplo, PUROS) roda sob "node" hoje; happy-dom é um
// SUPERSET dela — nenhum desses testes toca DOM, então nada muda de comportamento. A parte de baixo (render de
// verdade de ManualAba/ExemploDialog) é a única que PRECISA de happy-dom — mesmo padrão de
// integracao-api-tela.test.ts/integracao-celula.test.ts (checklist não-negociável: "regex-on-source test does
// NOT count" para componente com hooks/estado).
import { describe, it, expect, vi } from "vitest";
import { CAMINHO_FOTO_EXEMPLO, montarResposta, type RespostaLer } from "@/lib/integracao/api/resposta";
import { CHAVE_FICTICIA, TEXTO_PAGINA_PODE_MUDAR, montarManual, respostaExemplo } from "@/components/integracao/manual-conteudo";

// n6 (mesma razão de integracao-celula.test.ts/integracao-api-tela.test.ts): silencia o aviso de act() do React
// 19 dev.
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const R: RespostaLer = {
  status: "ok", modo: "normal", tenant_id: "t1", loja: { id: "t1", nome: "Loja X" }, colunas: ["Nome", "Foto"],
  chaves_colunas: ["nome", "foto"], proximo_cursor: null, validade_foto_dias: 7, pagina: { limite: 2, maximo: 50 },
  produtos: [
    { modelo_id: "m1", estado: "integravel", assinatura: "a", integrado_em: null, linhas: [
      { tipo: "produto", loja_nome: "Loja X", valores: ["Saia", ["t1/fotos_modelo/a.jpg", "t1/fotos_modelo/b.jpg"]] },
      { tipo: "variante", loja_nome: "Loja X", valores: ["Saia P", []] }] },
    { modelo_id: "m2", estado: "integravel", assinatura: "b", integrado_em: null, linhas: [
      { tipo: "produto", valores: ["Blusa", []] }] },
  ],
};

describe("montarResposta — formato público (spec §7, D5)", () => {
  it("só os confirmados; Foto = lista de links SÓ na linha do produto; integrado_em do confirmar", () => {
    const out = montarResposta(R, {
      geradoEm: "2026-09-26T20:48:00.000Z",
      foto: (c) => c.map((p) => `https://x/${p}`),
      incluir: (id) => id === "m1",
      integradoEm: () => "2026-09-26T17:35:00.000Z",
    });
    expect(out).toEqual({
      versao: 1, modo: "normal", loja: { id: "t1", nome: "Loja X" }, colunas: ["Nome", "Foto"], gerado_em: "2026-09-26T20:48:00.000Z",
      pagina: { limite: 2, maximo: 50 }, // D39 (P-89 A)
      proximo_cursor: null,
      linhas: [
        { tipo: "produto", produto_id: "m1", loja_id: "t1", loja_nome: "Loja X", integrado_em: "2026-09-26T17:35:00.000Z",
          valores: ["Saia", ["https://x/t1/fotos_modelo/a.jpg", "https://x/t1/fotos_modelo/b.jpg"]] },
        { tipo: "variante", produto_id: "m1", loja_id: "t1", loja_nome: "Loja X", integrado_em: "2026-09-26T17:35:00.000Z", valores: ["Saia P", []] },
      ],
    });
  });
  it("sem incluir = todos; loja_nome cai no nome da loja", () => {
    const out = montarResposta(R, { geradoEm: "g", foto: () => null });
    expect(out.linhas.map((l) => l.produto_id)).toEqual(["m1", "m1", "m2"]);
    expect(montarResposta({ ...R, pagina: undefined }, { geradoEm: "g", foto: () => null }).pagina).toBeNull();
    expect(out.linhas[2]).toMatchObject({ loja_nome: "Loja X", valores: ["Blusa", null] });
  });
});

describe("Manual da API (P-81 A) — 9 tópicos e exemplos no formato real", () => {
  it("9 tópicos na ordem do mockup; comandos com o endereço do site e a chave fictícia", () => {
    const m = montarManual("https://sistrama.sung-lee.workers.dev");
    expect(m.map((s) => s.titulo)).toEqual([
      "O que é e como funciona", "Passo a passo para integrar", "Endereço e comandos", "Parâmetros", "A resposta explicada",
      "Códigos de resposta", "Boas práticas", "Perguntas frequentes", "Checklist antes de ligar de verdade",
    ]);
    const cmds = JSON.stringify(m[2]);
    expect(cmds).toContain("https://sistrama.sung-lee.workers.dev/api/integracao/v1/produtos?limite=50");
    // P-89 A: o tamanho da página pode mudar — o texto aparece em Parâmetros, Boas práticas e FAQ
    for (const i of [3, 6, 7]) expect(JSON.stringify(m[i]), m[i].titulo).toContain(TEXTO_PAGINA_PODE_MUDAR);
    expect(JSON.stringify(m[4])).toContain("pagina.maximo");
    expect(cmds).toContain(`Bearer ${CHAVE_FICTICIA}`);
    expect(cmds).toContain("modo=teste");
  });
  it("exemplo TESTE: produtos fictícios, 18 colunas, foto pública de exemplo, cursor da 2ª página", () => {
    const t = respostaExemplo("teste", "https://site");
    expect(t.modo).toBe("teste");
    expect(t.colunas).toHaveLength(18);
    expect(t.linhas[0].produto_id).toBe("exemplo-0001");
    expect(t.linhas[0].valores[17]).toEqual([`https://site${CAMINHO_FOTO_EXEMPLO}`]);
    expect(t.linhas[1].valores[17]).toEqual([]);
    expect(t.linhas.every((l) => l.integrado_em === null)).toBe(true);
    expect(t.proximo_cursor).toBe("eyJleGVtcGxvIjogMn0=");
    expect(t.pagina).toEqual({ limite: 2, maximo: 50 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Render de verdade — react-dom/client + happy-dom (mesmo padrão de integracao-api-tela.test.ts/
// integracao-celula.test.ts). ManualAba e ExemploDialog não têm arquivo de teste próprio em permitidos.txt —
// entram aqui, no único arquivo de teste desta task.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
async function montarManualAba() {
  vi.resetModules();
  const rpcSpy = vi.fn(async (nome: string) => {
    if (nome === "integracao_exemplo") {
      return {
        data: {
          status: "ok", modo: "teste", tenant_id: "t1", loja: { id: "t1", nome: "Loja Teste" },
          colunas: ["Nome", "Foto"], chaves_colunas: ["nome", "foto"], validade_foto_dias: 7,
          pagina: { limite: 2, maximo: 50 }, proximo_cursor: null,
          produtos: [{ modelo_id: "exemplo-0001", estado: "teste", assinatura: null, integrado_em: null,
            linhas: [{ tipo: "produto", valores: ["Produto Exemplo 1", ["exemplo"]] }] }],
        },
        error: null,
      };
    }
    return { data: null, error: new Error(`RPC não mockada: ${nome}`) };
  });
  vi.doMock("@/integrations/supabase/client", () => ({ supabase: { rpc: rpcSpy } }));
  vi.doMock("@/hooks/useActiveTenantId", () => ({ useActiveTenantId: () => "t1" }));
  const toastMocks = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() };
  vi.doMock("sonner", () => ({ toast: toastMocks }));
  const clipboardMock = { writeText: vi.fn(async () => {}) };
  Object.defineProperty(navigator, "clipboard", { value: clipboardMock, configurable: true });
  const { createElement } = await import("react");
  const { act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
  const { ManualAba } = await import("@/components/integracao/ManualAba");
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: qc }, createElement(ManualAba)));
  });
  return {
    container, rpcSpy, toastMocks, clipboardMock,
    esperar: () => act(async () => { await new Promise((r) => setTimeout(r, 10)); }),
    desmontar: () => act(async () => { root.unmount(); container.remove(); }),
  };
}

describe("ManualAba — os 9 tópicos, índice e 'Ver resposta de exemplo' (render de verdade)", () => {
  it("desenha as 9 seções (índice + títulos) e o texto 'só super admin'", async () => {
    const view = await montarManualAba();
    const titulos = Array.from(view.container.querySelectorAll("h3")).map((h) => h.textContent);
    expect(titulos).toEqual([
      "1. O que é e como funciona", "2. Passo a passo para integrar", "3. Endereço e comandos", "4. Parâmetros",
      "5. A resposta explicada", "6. Códigos de resposta", "7. Boas práticas", "8. Perguntas frequentes",
      "9. Checklist antes de ligar de verdade",
    ]);
    const linksIndice = Array.from(view.container.querySelectorAll('nav[aria-label="Índice do manual"] a'));
    expect(linksIndice).toHaveLength(9);
    expect(view.container.textContent).toContain("Esta aba é só do super admin.");
    await view.desmontar();
  });
  it("botão 'Ver resposta de exemplo' abre o dialog e chama a RPC integracao_exemplo (N12)", async () => {
    const view = await montarManualAba();
    const botao = Array.from(view.container.querySelectorAll("button"))
      .find((b) => b.textContent === "Ver resposta de exemplo (modo teste)") as HTMLButtonElement;
    expect(botao).toBeTruthy();
    const { act } = await import("react");
    await act(async () => { botao.click(); });
    await view.esperar();
    expect(view.rpcSpy).toHaveBeenCalledWith("integracao_exemplo");
    // O Dialog do Radix renderiza em portal, no <body> — não dentro de `container`.
    expect(document.body.textContent).toContain("Resposta de exemplo (modo teste)");
    expect(document.body.textContent).toContain("Produto Exemplo 1");
    await view.desmontar();
  });
  it("Copiar num bloco de código chama o clipboard com o código exato", async () => {
    const view = await montarManualAba();
    const botoesCopiar = Array.from(view.container.querySelectorAll("button")).filter((b) => b.textContent === "Copiar");
    expect(botoesCopiar.length).toBeGreaterThan(0);
    const { act } = await import("react");
    await act(async () => { botoesCopiar[0].click(); });
    await view.esperar();
    expect(view.clipboardMock.writeText).toHaveBeenCalledTimes(1);
    expect(view.clipboardMock.writeText.mock.calls[0][0]).toContain(`Bearer ${CHAVE_FICTICIA}`);
    expect(view.toastMocks.success).toHaveBeenCalledWith("Copiado.");
    await view.desmontar();
  });
});

describe("ExemploDialog — isolado (foto=null de propósito, N12)", () => {
  it("monta a resposta com montarResposta e mostra a foto como null (sem link)", async () => {
    vi.resetModules();
    const rpcSpy = vi.fn(async (nome: string) => {
      if (nome === "integracao_exemplo") {
        return {
          data: {
            status: "ok", modo: "teste", tenant_id: "t1", loja: { id: "t1", nome: "Loja Teste" },
            colunas: ["Nome", "Foto"], chaves_colunas: ["nome", "foto"], validade_foto_dias: 7,
            pagina: { limite: 2, maximo: 50 }, proximo_cursor: null,
            produtos: [{ modelo_id: "exemplo-0001", estado: "teste", assinatura: null, integrado_em: null,
              linhas: [{ tipo: "produto", valores: ["Produto Exemplo 1", ["exemplo"]] }] }],
          },
          error: null,
        };
      }
      return { data: null, error: new Error(`RPC não mockada: ${nome}`) };
    });
    vi.doMock("@/integrations/supabase/client", () => ({ supabase: { rpc: rpcSpy } }));
    vi.doMock("@/hooks/useActiveTenantId", () => ({ useActiveTenantId: () => "t1" }));
    const { createElement } = await import("react");
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    const { ExemploDialog } = await import("@/components/integracao/ExemploDialog");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onFechar = vi.fn();
    await act(async () => {
      root.render(createElement(QueryClientProvider, { client: qc }, createElement(ExemploDialog, { onFechar })));
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(rpcSpy).toHaveBeenCalledWith("integracao_exemplo");
    const pre = document.body.querySelector("pre");
    expect(pre).toBeTruthy();
    const json = JSON.parse(pre!.textContent ?? "{}");
    expect(json.linhas[0].valores[1]).toBeNull(); // foto = null (sem link) de propósito
    // Fechar chama o callback do chamador.
    const fechar = Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent === "Fechar") as HTMLButtonElement;
    await act(async () => { fechar.click(); });
    expect(onFechar).toHaveBeenCalledTimes(1);
    await act(async () => { root.unmount(); container.remove(); });
  });
  it("erro da RPC mostra mensagemErro (nunca o dialog fica em 'Montando…' para sempre)", async () => {
    vi.resetModules();
    const rpcSpy = vi.fn(async () => ({ data: null, error: { message: "boom", code: "42501" } }));
    vi.doMock("@/integrations/supabase/client", () => ({ supabase: { rpc: rpcSpy } }));
    vi.doMock("@/hooks/useActiveTenantId", () => ({ useActiveTenantId: () => "t1" }));
    const { createElement } = await import("react");
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    const { ExemploDialog } = await import("@/components/integracao/ExemploDialog");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(QueryClientProvider, { client: qc }, createElement(ExemploDialog, { onFechar: () => {} })));
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(document.body.textContent).not.toContain("Montando…");
    expect(document.body.querySelector("pre")).toBeNull();
    await act(async () => { root.unmount(); container.remove(); });
  });
});
