// @vitest-environment happy-dom
// A parte de cima (montarResposta/montarManual/respostaExemplo, PUROS) roda sob "node" hoje; happy-dom é um
// SUPERSET dela — nenhum desses testes toca DOM, então nada muda de comportamento. A parte de baixo (render de
// verdade de ManualAba/ExemploDialog) é a única que PRECISA de happy-dom — mesmo padrão de
// integracao-api-tela.test.ts/integracao-celula.test.ts (checklist não-negociável: "regex-on-source test does
// NOT count" para componente com hooks/estado).
import { describe, it, expect, vi } from "vitest";
import { CAMINHO_FOTO_EXEMPLO, montarResposta, type RespostaLer } from "@/lib/integracao/api/resposta";
import {
  CHAVE_FICTICIA, TEXTO_PAGINA_PODE_MUDAR, montarManual, respostaExemplo,
  TEXTO_IDENTIFICACAO, TEXTO_UNIAO_COLUNAS, TEXTO_ENTREGUE_UMA_VEZ, TEXTO_SEM_WEBHOOK, TEXTO_UMA_LOJA_POR_CHAVE,
  TEXTO_REPROVADO_NAO_ENTREGA, TEXTO_PRECO_DIGITADO, TEXTO_LIMITE_POR_CHAVE, TEXTO_NOME_SUBLINHA, TEXTO_LOJA_OBRIGATORIA,
  TEXTO_FORMATO_OBJETOS,
} from "@/components/integracao/manual-conteudo";

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

describe("montarResposta — formato público em OBJETOS chave-valor + variantes aninhadas (Release A2, P-222 B/P-223 A)", () => {
  it("só os confirmados; produto = objeto com as chaves; variantes dentro; Foto = lista de links SÓ no produto ([] na variante)", () => {
    const out = montarResposta(R, {
      geradoEm: "2026-09-26T20:48:00.000Z",
      foto: (c) => c.map((p) => `https://x/${p}`),
      incluir: (id) => id === "m1",
      integradoEm: () => "2026-09-26T17:35:00.000Z",
    });
    expect(out).toEqual({
      versao: 1, modo: "normal", loja: { id: "t1", nome: "Loja X" }, gerado_em: "2026-09-26T20:48:00.000Z",
      pagina: { limite: 2, maximo: 50 }, // D39 (P-89 A)
      produtos: [{
        produto_id: "m1", loja_id: "t1", loja_nome: "Loja X", integrado_em: "2026-09-26T17:35:00.000Z",
        nome: "Saia", foto: ["https://x/t1/fotos_modelo/a.jpg", "https://x/t1/fotos_modelo/b.jpg"],
        variantes: [{ produto_id: "m1", loja_id: "t1", loja_nome: "Loja X", integrado_em: "2026-09-26T17:35:00.000Z", nome: "Saia P", foto: [] }],
      }],
      proximo_cursor: null,
    });
    // sem `colunas`/`linhas`; ordem das chaves: identificação → campos (ordem do layout) → variantes
    expect(Object.keys(out)).toEqual(["versao", "modo", "loja", "gerado_em", "pagina", "produtos", "proximo_cursor"]);
    expect(Object.keys(out.produtos[0])).toEqual(["produto_id", "loja_id", "loja_nome", "integrado_em", "nome", "foto", "variantes"]);
    expect(Object.keys(out.produtos[0].variantes[0])).toEqual(["produto_id", "loja_id", "loja_nome", "integrado_em", "nome", "foto"]);
  });
  it("sem incluir = todos; loja_nome cai no nome da loja; produto sem variantes => variantes: []; pagina ausente => null", () => {
    const out = montarResposta(R, { geradoEm: "g", foto: () => null });
    expect(out.produtos.map((p) => p.produto_id)).toEqual(["m1", "m2"]);
    expect(montarResposta({ ...R, pagina: undefined }, { geradoEm: "g", foto: () => null }).pagina).toBeNull();
    expect(out.produtos[1]).toEqual({ produto_id: "m2", loja_id: "t1", loja_nome: "Loja X", integrado_em: null, nome: "Blusa", foto: null,
      variantes: [] });
  });
  // m2/m2-R (mantido no formato novo): retrato do produto SEM a coluna Foto (P-93 A, fora da união) => o valor cru já chega
  // `null` em TODAS as linhas do produto — `montarResposta` preserva `null` no produto E na variante (nunca finge "lista vazia").
  it("Foto null no retrato do produto (P-93 A, campo fora da união) fica null no produto E na variante", () => {
    const semFoto: RespostaLer = {
      ...R,
      produtos: [
        { modelo_id: "m3", estado: "integravel", assinatura: "c", integrado_em: null, linhas: [
          { tipo: "produto", loja_nome: "Loja X", valores: ["Calça", null] },
          { tipo: "variante", loja_nome: "Loja X", valores: ["Calça P", null] },
        ] },
      ],
    };
    let chamouFoto = false;
    const out = montarResposta(semFoto, { geradoEm: "g", foto: () => { chamouFoto = true; return ["nunca"]; } });
    expect(out.produtos[0].foto).toBeNull(); // produto: null preservado
    expect(out.produtos[0].variantes[0].foto).toBeNull(); // variante: null TAMBÉM preservado (m2-R)
    expect(chamouFoto).toBe(false); // `foto()` nem é chamada quando o valor cru já é null
  });
  it("união de chaves da página: campo fora do retrato de UM produto vem null nele (e nas variantes dele), presente nos outros", () => {
    const uniao: RespostaLer = {
      ...R, chaves_colunas: ["nome", "ncm", "colecao"], colunas: ["Nome", "NCM", "Coleção"],
      produtos: [
        { modelo_id: "novo", estado: "integravel", assinatura: "a", integrado_em: null, linhas: [
          { tipo: "produto", valores: ["Saia", "6204.52.00", "Verão"] }, { tipo: "variante", valores: ["Saia P", "6204.52.00", "Verão"] }] },
        { modelo_id: "antigo", estado: "integrado", assinatura: "b", integrado_em: "2026-09-01T00:00:00.000Z", linhas: [
          { tipo: "produto", valores: ["Blusa", "6106.10.00", null] }, { tipo: "variante", valores: ["Blusa M", "6106.10.00", null] }] },
      ],
    };
    const out = montarResposta(uniao, { geradoEm: "g", foto: () => null });
    for (const p of out.produtos) {
      expect(Object.keys(p)).toEqual(["produto_id", "loja_id", "loja_nome", "integrado_em", "nome", "ncm", "colecao", "variantes"]);
      for (const v of p.variantes) expect(Object.keys(v)).toEqual(["produto_id", "loja_id", "loja_nome", "integrado_em", "nome", "ncm", "colecao"]);
    }
    expect(out.produtos[1]).toMatchObject({ produto_id: "antigo", integrado_em: "2026-09-01T00:00:00.000Z", colecao: null });
    expect(out.produtos[1].variantes[0]).toMatchObject({ nome: "Blusa M", colecao: null, integrado_em: "2026-09-01T00:00:00.000Z" });
    expect(out.produtos[0].variantes[0]).toMatchObject({ colecao: "Verão" });
  });
  it("as 21 chaves fixas do sistema (P-223 A) viram as chaves do objeto, na ordem do layout", () => {
    const chaves = ["nome", "ref_sku", "preco_anterior", "preco_venda", "peso", "ncm", "preco_custo", "cor_base", "cor_apelido", "tamanho",
      "titulo", "descricao", "keywords", "metatag", "comprimento", "largura", "altura", "foto", "colecao", "categoria_tecido", "linha"];
    const r21: RespostaLer = { ...R, chaves_colunas: chaves, colunas: chaves, produtos: [
      { modelo_id: "m1", estado: "integravel", assinatura: "a", integrado_em: null, linhas: [
        { tipo: "produto", valores: chaves.map((k) => (k === "foto" ? ["t1/x.jpg"] : `${k}-v`)) }] }] };
    const p = montarResposta(r21, { geradoEm: "g", foto: (c) => c }).produtos[0];
    expect(Object.keys(p)).toEqual(["produto_id", "loja_id", "loja_nome", "integrado_em", ...chaves, "variantes"]);
    expect(p.ref_sku).toBe("ref_sku-v");
    expect(p.foto).toEqual(["t1/x.jpg"]);
  });
  it("chave reservada no chaves_colunas nunca sobrescreve a identificação (a rota já recusa com 500)", () => {
    const mal: RespostaLer = { ...R, chaves_colunas: ["produto_id", "nome"], colunas: ["X", "Nome"], produtos: [
      { modelo_id: "m1", estado: "integravel", assinatura: "a", integrado_em: null, linhas: [{ tipo: "produto", valores: ["HACK", "Saia"] }] }] };
    const p = montarResposta(mal, { geradoEm: "g", foto: () => null }).produtos[0];
    expect(p.produto_id).toBe("m1");
    expect(p.nome).toBe("Saia");
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
    // Release A2 (P-224 B+): todo comando leva loja= (sem loja ativa: o marcador)
    expect(cmds).toContain("https://sistrama.sung-lee.workers.dev/api/integracao/v1/produtos?loja=<codigo-da-loja>&limite=50");
    // P-89 A: o tamanho da página pode mudar — o texto aparece em Parâmetros, Boas práticas e FAQ
    for (const i of [3, 6, 7]) expect(JSON.stringify(m[i]), m[i].titulo).toContain(TEXTO_PAGINA_PODE_MUDAR);
    expect(JSON.stringify(m[4])).toContain("pagina.maximo");
    expect(cmds).toContain(`Bearer ${CHAVE_FICTICIA}`);
    expect(cmds).toContain("modo=teste");
  });
  // Fix round 1 T16 (revisão I1–I8, code review "task-16-review.md"): as decisões do dono que o dispatch exige
  // (carry.md:42-45 "T16 (Manual)" + progress.md:171) precisam estar no texto de VERDADE que a tela mostra — um
  // teste por item, cada um checando a frase-chave da constante exportada dentro do JSON do manual inteiro. Sem
  // isso, uma edição futura pode apagar a frase em silêncio e nenhum teste percebe.
  it("I1–I9: cada decisão do dono aparece no texto do Manual (uma vez sumida, o teste falha)", () => {
    const m = montarManual("https://site");
    const tudo = JSON.stringify(m);
    expect(tudo, "I1 produto_id/SKU/nunca por nome/réplicas").toContain(TEXTO_IDENTIFICACAO);
    expect(tudo, "I2 P-93 A: união de colunas, campo fora do retrato = null").toContain(TEXTO_UNIAO_COLUNAS);
    expect(tudo, "I3 produto é entregue uma vez").toContain(TEXTO_ENTREGUE_UMA_VEZ);
    expect(tudo, "I4 pull-only, sem webhook").toContain(TEXTO_SEM_WEBHOOK);
    expect(tudo, "I5 loja_id/loja_nome em toda linha, uma chave = uma loja").toContain(TEXTO_UMA_LOJA_POR_CHAVE);
    expect(tudo, "I6 P-99 A: reprovado não entrega enquanto reprovado").toContain(TEXTO_REPROVADO_NAO_ENTREGA);
    expect(tudo, "I7 P-100 A: só o preço digitado conta").toContain(TEXTO_PRECO_DIGITADO);
    expect(tudo, "I8 limite por chave por minuto, teste conta").toContain(TEXTO_LIMITE_POR_CHAVE);
    expect(tudo, "I9 P-126: nome da sublinha leva a cor").toContain(TEXTO_NOME_SUBLINHA);
  });
  it("exemplo NORMAL: o nome da variante leva Nome do produto + cor + tamanho (P-126); variante DENTRO do produto", () => {
    const n = respostaExemplo("normal", "https://site");
    expect(n.produtos).toHaveLength(1);
    expect(n.produtos[0].nome).toBe("Saia Marola");
    expect(n.produtos[0].variantes[0].nome).toBe("Saia Marola Preto P");
    expect(n.produtos[0].variantes[0].ref_sku).toBe("SAMA0019-PRT-P");
  });
  it("exemplo TESTE: produtos fictícios, 21 chaves, foto pública de exemplo, cursor da 2ª página, nome com a cor (P-126)", () => {
    const t = respostaExemplo("teste", "https://site");
    expect(t.modo).toBe("teste");
    const p = t.produtos[0];
    expect(Object.keys(p)).toHaveLength(4 + 21 + 1); // identificação + 21 chaves + variantes
    expect([p.colecao, p.categoria_tecido, p.linha]).toEqual(["Coleção Exemplo", "Malha", "Casual"]);
    expect(p.produto_id).toBe("exemplo-0001");
    expect(p.foto).toEqual([`https://site${CAMINHO_FOTO_EXEMPLO}`]);
    expect(p.variantes[0].foto).toEqual([]);
    expect([p.integrado_em, ...p.variantes.map((v) => v.integrado_em)].every((x) => x === null)).toBe(true);
    expect(t.proximo_cursor).toBe("eyJleGVtcGxvIjogMn0=");
    expect(t.pagina).toEqual({ limite: 2, maximo: 50 });
    expect(p.variantes[0].nome).toBe("Produto Exemplo 1 Cor Exemplo P");
  });
  it("Release A2: comandos com o código da loja ativa; loja obrigatória e formato em objetos no texto do Manual", () => {
    const m = montarManual("https://site", "37889b78-fffb-404b-8c75-18b7e50a1d9b");
    const cmds = JSON.stringify(m[2]);
    expect(cmds).toContain("https://site/api/integracao/v1/produtos?loja=37889b78-fffb-404b-8c75-18b7e50a1d9b&limite=50");
    expect(cmds).toContain("loja=37889b78-fffb-404b-8c75-18b7e50a1d9b&modo=teste");
    expect(cmds).toContain('\\"loja\\": \\"37889b78-fffb-404b-8c75-18b7e50a1d9b\\"'); // Python params
    const tudo = JSON.stringify(m);
    expect(tudo).toContain(TEXTO_LOJA_OBRIGATORIA);
    expect(tudo).toContain(TEXTO_FORMATO_OBJETOS);
    expect(JSON.stringify(m[3])).toContain('"loja"'); // linha da tabela de parâmetros
    expect(JSON.stringify(m[5])).toContain("loja_nao_autorizada"); // códigos de resposta
    expect(JSON.stringify(m[4])).toContain('["categoria_tecido","Categoria do Tecido Principal"]'); // tabela de chaves
    expect(JSON.stringify(m[4])).not.toContain('"colunas"');
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
    expect(json.produtos[0].foto).toBeNull(); // foto = null (sem link) de propósito
    expect(json.produtos[0].variantes).toEqual([]);
    expect(json.linhas).toBeUndefined(); // Release A2: formato em objetos
    expect(json.colunas).toBeUndefined();
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
    // m3 (revisão code review "fix round 1"): a mensagem de erro TEM que aparecer na tela — não basta ausência de
    // "Montando…"/`pre`; sem isso o teste passaria mesmo com a tela em branco (nem erro, nem dado, nem loading).
    expect(document.body.textContent).toContain("Você não tem permissão para esta ação.");
    expect(document.body.querySelector(".text-destructive")).not.toBeNull();
    await act(async () => { root.unmount(); container.remove(); });
  });
});

describe("Manual — endereço (dono 28/set: nunca localhost; domínio novo acompanha sozinho)", () => {
  it("localhost/127.0.0.1 → endereço público; site publicado → o próprio endereço; inválido → público", async () => {
    const { enderecoDoManual, ENDERECO_PUBLICO_API } = await import("@/components/integracao/ManualAba");
    expect(enderecoDoManual("http://localhost:5173")).toBe(ENDERECO_PUBLICO_API);
    expect(enderecoDoManual("http://127.0.0.1:5188")).toBe(ENDERECO_PUBLICO_API);
    expect(enderecoDoManual("https://sistrama.sung-lee.workers.dev")).toBe("https://sistrama.sung-lee.workers.dev");
    expect(enderecoDoManual("https://app.wish360.com.br")).toBe("https://app.wish360.com.br");
    expect(enderecoDoManual("")).toBe(ENDERECO_PUBLICO_API);
  });
});
