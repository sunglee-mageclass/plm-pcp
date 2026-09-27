// @vitest-environment happy-dom
// T12b (carry.md): o arquivo passou de "node" para "happy-dom" para caber os testes de RENDER de `ProdutosAba`
// no fim do arquivo (checklist não-negociável: Save flip, merge, mapeamento de erro — "regex-on-source test does
// NOT count", mesma régua da T12a/integracao-celula.test.ts). happy-dom é um SUPERSET do node para os testes de
// fonte já existentes acima (leem arquivo via node:fs, sem tocar DOM) — nenhum deles muda de comportamento aqui.
import { describe, it, expect, vi, type Mock } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { createElement as h } from "react";
import { PAGES_CATALOG } from "@/lib/permissions-catalog";
import { abasVisiveis } from "@/lib/integracao/abas";

// n6 (mesma razão de integracao-celula.test.ts): silencia o aviso de act() do React 19 dev.
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const ler = (p: string) => readFileSync(p, "utf8");

describe("Integração — permissão, menu e abas por papel (P-65 A, P-74 A, P-81 A, v4)", () => {
  it("ModuleDef próprio 'integracao' no FIM do catálogo, página única (link direto)", () => {
    const ult = PAGES_CATALOG[PAGES_CATALOG.length - 1];
    expect(ult).toMatchObject({ module: "integracao", label: "Integração", basePath: "/integracao" });
    expect(ult.pages.map((p) => p.key)).toEqual(["integracao"]);
  });
  it("fora dos interruptores de contratação (como o importar — nota 12)", () => {
    expect(ler("src/routes/_authenticated/admin/lojas.tsx")).toMatch(/key === "importar" \|\| key === "integracao"/);
  });
  it("D26 (opção A): o diálogo de Reset avisa que apaga a Integração da loja", () => {
    expect(ler("src/routes/_authenticated/admin/lojas.tsx")).toMatch(/Apaga também a Integração da loja/);
  });
  it("super admin tem o item também no Admin Mestre", () => {
    const s = ler("src/components/app-sidebar.tsx");
    const i = s.indexOf("Admin Mestre");
    expect(s.indexOf('to="/integracao"', i)).toBeGreaterThan(i);
  });
  it("abas: super admin vê as 5; admin/permissão só Produtos e Log", () => {
    expect(abasVisiveis(true)).toEqual(["produtos", "campos", "api", "manual", "log"]);
    expect(abasVisiveis(false)).toEqual(["produtos", "log"]);
  });
  it("rota protegida pela permissão 'integracao'", () => {
    expect(ler("src/routes/_authenticated/integracao.tsx")).toMatch(/<RequirePermission page="integracao">/);
  });
});

describe("Integração — guarda única de alterações não salvas", () => {
  it("1 useUnsavedGuard na página (blockNav) e trocar de aba passa pela confirmação", () => {
    const s = ler("src/components/integracao/IntegracaoPage.tsx");
    expect(s.match(/useUnsavedGuard\(/g)?.length).toBe(1);
    expect(s).toMatch(/blockNav: true/);
    expect(s).toMatch(/requestAction\(\(\) => setAba\(/);
    expect(s).toMatch(/<UnsavedChangesGuard confirm=\{confirm\} \/>/);
  });
  it("nenhuma aba cria a própria guarda (2 useBlocker brigariam)", () => {
    for (const f of ["ProdutosAba", "CamposAba", "ApiAba", "ManualAba", "LogAba"]) {
      const p = `src/components/integracao/${f}.tsx`;
      if (!existsSync(p)) continue;
      expect(ler(p), f).not.toMatch(/useUnsavedGuard\(/);
    }
  });
});

// Fix round 1 — I2 (task-11-review.md + task-11-code-review.md): checagem de fonte (em vez de renderHook, sem
// precedente na suíte unit deste repo) para a mutationKey do Salvar e o gate do Realtime contra ela; e M5 para o
// sufixo único do canal.
describe("useIntegracao — Salvar tem mutationKey e o Realtime não relista no meio dele (I2); canal com sufixo único (M5)", () => {
  const s = ler("src/components/integracao/useIntegracao.ts");
  it("useSalvarIntegracao declara mutationKey própria (chaveMutationSalvar)", () => {
    expect(s).toMatch(/mutationKey:\s*chaveMutationSalvar\(tenantId\)/);
  });
  it("useIntegracaoAoVivo consulta qc.isMutating com a MESMA mutationKey antes de invalidar", () => {
    const i = s.indexOf("function useIntegracaoAoVivo");
    expect(i).toBeGreaterThan(-1);
    const trecho = s.slice(i, s.indexOf("\n}", s.indexOf("ch.subscribe()", i)));
    expect(trecho).toMatch(/qc\.isMutating\(\{\s*mutationKey:\s*chaveMutationSalvar\(tenantId\)\s*\}\)/);
    // a invalidação só roda quando isMutating NÃO achou nada (o "> 0" seguido de um return/guarda antes do invalidate)
    expect(trecho.indexOf("isMutating")).toBeLessThan(trecho.indexOf("invalidateQueries"));
  });
  it("o canal Realtime usa um sufixo por montagem (nunca reaproveita um tópico 'velho')", () => {
    const i = s.indexOf("function useIntegracaoAoVivo");
    const trecho = s.slice(i, s.indexOf("ch.subscribe()", i));
    expect(trecho).toMatch(/Math\.random\(\)/);
    expect(trecho).not.toMatch(/getChannels\(\)\.find/);
  });
});

// Fix round 2 — Important R1 (task-11-review.md "Re-review round 1") / I3 (task-11-code-review.md "Re-check round
// 1"): o debounce da rodada 1 comparava um OBJETO recriado a cada render por `===`, o que nunca vale e gera um
// re-render a cada 300ms para sempre. Checagem de fonte (mesma justificativa da I2/M5 acima — sem precedente de
// `renderHook` na suíte unit deste repo para testar esse loop com fake timers de verdade): `useValorAtrasado` só
// aceita `string`, e `usePreviasSkus` atrasa um `JSON.stringify` (nunca o objeto `entradas` cru).
describe("useIntegracao — useValorAtrasado só aceita string (I3); queryFn deriva da chave, não do 'e' do render (N1); previaDeErro usa a chave (N2)", () => {
  const s = ler("src/components/integracao/useIntegracao.ts");
  it("useValorAtrasado(valor: string, ...) — nunca um objeto/array/generic", () => {
    const i = s.indexOf("function useValorAtrasado");
    expect(i).toBeGreaterThan(-1);
    const assinatura = s.slice(i, s.indexOf(")", i) + 1);
    expect(assinatura).toMatch(/function useValorAtrasado\(valor: string, ms: number\)/);
    expect(assinatura).not.toMatch(/<T>/);
  });
  it("usePreviasSkus atrasa JSON.stringify(entradas), nunca o objeto cru", () => {
    const i = s.indexOf("function usePreviasSkus");
    const trecho = s.slice(i, s.indexOf("useQueries(", i));
    expect(trecho).toMatch(/useValorAtrasado\(entradasStr,\s*300\)/);
    expect(trecho).toMatch(/JSON\.stringify\(entradas\)/);
    expect(trecho).toMatch(/JSON\.parse\(entradasStrAtrasada\)/);
    expect(trecho).toMatch(/useMemo\(/);
    // nunca a chamada antiga (regressão da rodada 1): useValorAtrasado direto no objeto `entradas`.
    expect(trecho).not.toMatch(/useValorAtrasado\(entradas,/);
  });
  it("o queryFn deriva ref/tamanhoTipo/manuais/modo de entradaDaChave(chave), não do 'e' do render (N1)", () => {
    const i = s.indexOf("function usePreviasSkus");
    const trecho = s.slice(i, s.indexOf("function previaDeErro", i));
    expect(trecho).toMatch(/const ed = entradaDaChave\(chave\)/);
    expect(trecho).toMatch(/_ref:\s*ed\.ref/);
    expect(trecho).toMatch(/_tamanho_tipo:\s*ed\.tamanhoTipo/);
    expect(trecho).toMatch(/_manuais:\s*ed\.manuais/);
    expect(trecho).toMatch(/_modo:\s*ed\.modo/);
  });
  it("previaDeErro usa a chave da query como 'entrada' (N2), nunca o literal 'erro'", () => {
    const i = s.indexOf("function previaDeErro");
    expect(i).toBeGreaterThan(-1);
    const trecho = s.slice(i, s.indexOf("\n}", i));
    expect(trecho).toMatch(/entrada:\s*chave,/);
    expect(trecho).not.toMatch(/entrada:\s*"erro"/);
  });
});

// Fix round 2 — Minor R2/R3 (task-11-review.md) / N3 (task-11-code-review.md): sem cópias locais de textos já
// exportados, e o erro de resultado desconhecido preserva a causa original.
describe("salvar-integracao — sem textos duplicados (N3); cause preservada (R3)", () => {
  const s = ler("src/components/integracao/salvar-integracao.ts");
  it("importa TEXTO_FOTOS_SEM_UPLOAD e PREFIXO_SKUS_NAO_GRAVADOS, sem cópias locais", () => {
    expect(s).toMatch(/TEXTO_FOTOS_SEM_UPLOAD/);
    expect(s).toMatch(/PREFIXO_SKUS_NAO_GRAVADOS/);
    expect(s).not.toMatch(/TEXTO_FOTOS_NOVAS_PERDIDAS/);
    expect(s).not.toMatch(/PREFIXO_SKUS_NAO_GRAVADOS_LOCAL/);
  });
  it("o erro de resultado desconhecido leva { cause: e }", () => {
    expect(s).toMatch(/new Error\(TEXTO_RESULTADO_DESCONHECIDO,\s*\{\s*cause:\s*e\s*\}\)/);
  });
});

describe("Integração — aba Produtos", () => {
  it("é a aba ligada no mapa da página e abre em 'Não integrados'", () => {
    expect(ler("src/components/integracao/IntegracaoPage.tsx")).toMatch(/produtos: ProdutosAba/);
    const s = ler("src/components/integracao/ProdutosAba.tsx");
    expect(s).toMatch(/useState<Situacao>\("nao_integrados"\)/);
    expect(s).toMatch(/useAbaSuja\("produtos", sujo\)/);
    expect(s).toMatch(/50 por página/);
  });
  it("upload de foto só no Salvar (o diálogo de fotos não sobe arquivo)", () => {
    const f = ler("src/components/integracao/FotosDialog.tsx");
    expect(f).not.toMatch(/uploadFile|storage\.from/);
  });
  it("Keywords grava SÓ a coluna da loja, com o valor carregado (R5)", () => {
    const k = ler("src/components/integracao/KeywordsDialog.tsx");
    expect(k).toMatch(/_keywords: \{ valor: texto, esperado: base \}/);
    expect(k).not.toMatch(/from\("tenant_config"\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Render de verdade (checklist não-negociável da T12b: "regex-on-source test does NOT count" para componente com
// hooks/estado) — react-dom/client + happy-dom, mesmo padrão de integracao-celula.test.ts. `useIntegracao.ts` é
// mockado (RPC de verdade fica para tests/integration/); `ProdutosTabela`/`CelulaCampo`/`FotosDialog`/
// `KeywordsDialog`/`guard.ts`/`rascunho.ts`/`produtos.ts` são os módulos REAIS — o que está sob teste é o
// comportamento do PRÓPRIO `ProdutosAba` (merge 3-vias, sobra do rascunho pós-Salvar, mapeamento de erro).
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("ProdutosAba — render (Save flip, merge 3-vias, mapeamento de erro)", () => {
  // Tipa o toast mockado (`vi.doMock("sonner", ...)`, dentro de `montarComMocks`) sem `as any` solto nos testes.
  const toastMock = async (): Promise<{ success: Mock; error: Mock; warning: Mock; info: Mock }> => {
    const { toast } = await import("sonner");
    return toast as unknown as { success: Mock; error: Mock; warning: Mock; info: Mock };
  };
  const g = (ok: boolean, motivo: string | null = null) => ({ ok, motivo });
  const produtoRaw = (o: Record<string, unknown> = {}) => ({
    modelo_id: "m1", origem: "interno", estado: "nao_integravel", rev: 1,
    raw: { nome: "Produto Teste", ref: "REF0001", tamanho_tipo: "letra" },
    gates: {
      compartilhado: g(true), planejamento: g(true), preco: g(true), ref: g(true), sku: g(true), keywords: g(true),
    },
    faltas: [], completo: true, sublinhas: [], vivo: null, retrato: null, retrato_difere: [],
    ...o,
  });
  const listaRaw = (produtos: Record<string, unknown>[], o: Record<string, unknown> = {}) => ({
    pagina: 1, por_pagina: 50, total: produtos.length,
    contagens: { nao_integrados: produtos.length, integrados: 0, todos: produtos.length },
    campos: ["nome", "preco_venda"],
    opcoes: { colecoes: [], etapas: [] },
    pode: { editar: true, ver_custos: true, super: false, keywords: true },
    keywords: null,
    produtos,
    ...o,
  });

  async function montarComMocks(opts: {
    lista: { produtos: Record<string, unknown>[] } & Record<string, unknown>;
    salvarImpl?: (rascunhos: unknown[]) => Promise<unknown>;
  }) {
    vi.resetModules();
    const { lerLista } = await import("@/lib/integracao/produtos");
    const salvarSpy = vi.fn(opts.salvarImpl ?? (async () => ({ salvos: 1, revs: {}, fotos: {}, skusOk: [], skusFalhas: [] })));
    let pendingResolvers: Array<() => Promise<void>> = [];
    const mutationState = { isPending: false };
    vi.doMock("@tanstack/react-router", () => ({
      useRouter: () => ({ history: { back: () => {} } }),
      Link: ({ children, className }: { children: unknown; className?: string }) => h("a", { className }, children),
    }));
    vi.doMock("@/hooks/useActiveTenantId", () => ({ useActiveTenantId: () => "t1" }));
    vi.doMock("@/hooks/useStoreTimezone", () => ({ useStoreTimezone: () => "America/Sao_Paulo" }));
    vi.doMock("@/hooks/useAuth", () => ({ useAuth: () => ({ canView: () => true }) }));
    vi.doMock("@/hooks/useTenantBranding", () => ({ useTenantBranding: () => ({ nome: "Loja Teste" }) }));
    vi.doMock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
    // `listaRef.current` guarda a lista JÁ LIDA por `lerLista` (o mesmo shape que `useIntegracaoLista` devolve de
    // verdade) — os testes constroem a entrada como o JSONB CRU (`listaRaw`/`produtoRaw`), igual à fixture `p()` de
    // integracao-celula.test.ts, e este helper faz a conversão uma vez só, aqui.
    const listaRef = { current: lerLista(opts.lista) };
    let rerenderTrigger = () => {};
    vi.doMock("@/components/integracao/useIntegracao", () => ({
      chaveLista: (tenantId: string) => ["integracao-lista", tenantId],
      useIntegracaoLista: () => ({ data: listaRef.current, isError: false, error: null, refetch: () => {} }),
      useIntegracaoAoVivo: () => {},
      usePreviasSkus: () => ({}),
      useSalvarIntegracao: () => ({
        isPending: mutationState.isPending,
        mutate: (rascunhos: unknown[], handlers: { onSuccess?: (r: unknown) => void; onError?: (e: unknown) => void }) => {
          mutationState.isPending = true;
          rerenderTrigger();
          const run = async () => {
            try {
              const res = await salvarSpy(rascunhos);
              mutationState.isPending = false;
              handlers.onSuccess?.(res);
            } catch (e) {
              mutationState.isPending = false;
              handlers.onError?.(e);
            }
            rerenderTrigger();
          };
          pendingResolvers.push(run);
        },
      }),
    }));
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    const { createElement } = await import("react");
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { ProdutosAba } = await import("@/components/integracao/ProdutosAba");
    // `PageActionBar` (dentro de `ProdutosAba`) chama `useSidebar()` — precisa do `SidebarProvider` real por perto,
    // mesmo padrão de `config-keywords-hidratacao.test.ts` (`PaginaComRealtime` envolve a página real no mesmo provider).
    const { SidebarProvider } = await import("@/components/ui/sidebar");
    const qc = new QueryClient();
    qc.setQueryData(["integracao-lista", "t1"], listaRef.current);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const arvore = () => createElement(QueryClientProvider, { client: qc }, createElement(SidebarProvider, null, createElement(ProdutosAba)));
    await act(async () => { root.render(arvore()); });
    // Um re-render força o componente a ler o `mutationState`/`listaRef` atualizados (o mock não é reativo por si
    // só — o teste dispara o re-render manualmente após mudar o estado simulado, como um "setState de fora").
    rerenderTrigger = () => { act(() => { root.render(arvore()); }); };
    return {
      container, qc, listaRef,
      atualizarLista: (novaRaw: { produtos: Record<string, unknown>[] } & Record<string, unknown>) => {
        const nova = lerLista(novaRaw);
        listaRef.current = nova;
        qc.setQueryData(["integracao-lista", "t1"], nova);
        rerenderTrigger();
      },
      salvarSpy,
      rodarSalvar: async () => {
        const fs = pendingResolvers;
        pendingResolvers = [];
        await act(async () => { for (const f of fs) await f(); });
      },
      desmontar: async () => { await act(async () => root.unmount()); container.remove(); },
    };
  }

  it("flip de Salvar: clicar em Salvar habilita/desabilita o botão e mostra 'Salvando…' até a mutation resolver", async () => {
    const lista = listaRaw([produtoRaw()]);
    const view = await montarComMocks({ lista });
    const input = view.container.querySelector<HTMLInputElement>('input[aria-label="Nome — Produto Teste"]');
    expect(input).not.toBeNull();
    const { act } = await import("react");
    // Digita algo para sujar o rascunho e habilitar o botão Salvar.
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input!, "Produto Editado");
      input!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const botaoSalvar = [...document.body.querySelectorAll("button")].find((b) => b.textContent?.includes("Salvar") && !b.textContent?.includes("Descartar"));
    expect(botaoSalvar?.disabled).toBe(false);
    await act(async () => { botaoSalvar!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    // Enquanto a mutation está "em voo" (mockState.isPending true), o botão mostra "Salvando…" e o input trava.
    // `PageActionBar` (onde vive o botão Salvar) é um PORTAL para `document.body` — não aparece em `view.container`.
    expect(document.body.textContent).toContain("Salvando…");
    await view.rodarSalvar();
    expect(view.salvarSpy).toHaveBeenCalledTimes(1);
    await view.desmontar();
  });

  it("merge 3-vias: chegou versão nova do servidor com um campo NÃO tocado mudado — adota; campo TOCADO em conflito exibe 'usar o novo/manter o meu'", async () => {
    const lista = listaRaw([produtoRaw()]);
    const view = await montarComMocks({ lista });
    const { act } = await import("react");
    // Seletor por PREFIXO (não o nome exato): a linha do produto usa `p.raw.nome` (o nome ATUAL do servidor) no
    // aria-label — o próprio cenário deste teste muda esse nome no servidor no meio do teste.
    const input = () => view.container.querySelector<HTMLInputElement>('input[aria-label^="Nome —"]');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input()!, "Meu Nome Editado");
      input()!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(input()!.value).toBe("Meu Nome Editado");
    // Outra pessoa salvou o MESMO campo (nome) com outro valor — rev muda, servidor tem outro nome: conflito.
    const listaNova = listaRaw([produtoRaw({ rev: 2, raw: { nome: "Nome Do Servidor", ref: "REF0001", tamanho_tipo: "letra" } })]);
    await act(async () => { view.atualizarLista(listaNova); });
    expect(input()!.value).toBe("Meu Nome Editado"); // o meu não some
    expect(view.container.textContent).toContain("Outra pessoa mudou este campo.");
    await view.desmontar();
  });

  it("merge 3-vias: produto vira integrável por outra pessoa — descarta o rascunho pendente e avisa (toast.warning)", async () => {
    const lista = listaRaw([produtoRaw()]);
    const view = await montarComMocks({ lista });
    const { act } = await import("react");
    const input = () => view.container.querySelector<HTMLInputElement>('input[aria-label="Nome — Produto Teste"]');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input()!, "Editando quando virou integrável");
      input()!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const listaNova = listaRaw([produtoRaw({ rev: 2, estado: "integravel" })]);
    await act(async () => { view.atualizarLista(listaNova); });
    expect((await toastMock()).warning).toHaveBeenCalled();
    await view.desmontar();
  });

  it("mapeamento de erro: onError do Salvar mostra o toast traduzido por mensagemErro e NÃO perde os rascunhos", async () => {
    const lista = listaRaw([produtoRaw()]);
    const erro42501 = Object.assign(new Error("integracao_sem_permissao:preco_venda"), { code: "42501" });
    const view = await montarComMocks({ lista, salvarImpl: async () => { throw erro42501; } });
    const { act } = await import("react");
    const input = () => view.container.querySelector<HTMLInputElement>('input[aria-label="Nome — Produto Teste"]');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input()!, "Nome Pendente");
      input()!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const botaoSalvar = [...document.body.querySelectorAll("button")].find((b) => b.textContent?.includes("Salvar") && !b.textContent?.includes("Descartar"));
    await act(async () => { botaoSalvar!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await view.rodarSalvar();
    expect((await toastMock()).error).toHaveBeenCalledWith("Você não tem permissão para editar este campo (mesma regra do card do produto).");
    // A recusa é do LOTE inteiro (integracao_salvar atômico) — o rascunho continua no input, nada foi perdido.
    expect(input()!.value).toBe("Nome Pendente");
    await view.desmontar();
  });
});
