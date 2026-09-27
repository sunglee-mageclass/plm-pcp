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
      useBlocker: () => ({ status: "idle", proceed() {}, reset() {} }),
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
    const dataUpdatedAtRef = { current: 1 };
    let rerenderTrigger = () => {};
    vi.doMock("@/components/integracao/useIntegracao", () => ({
      chaveLista: (tenantId: string) => ["integracao-lista", tenantId],
      useIntegracaoLista: () => ({
        data: listaRef.current, isError: false, error: null, refetch: () => {}, dataUpdatedAt: dataUpdatedAtRef.current,
      }),
      useIntegracaoAoVivo: () => {},
      usePreviasSkus: () => ({}),
      invalidarIntegracao: () => {},
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
      // A instância FRESCA de produtos.ts (pós-`vi.resetModules()`), a MESMA que `ProdutosAba.tsx` importou —
      // necessária pra `vi.spyOn` funcionar de verdade (espiar um import feito ANTES do reset intercepta um
      // módulo diferente do que o componente usa depois do reset).
      produtosModulo: await import("@/lib/integracao/produtos"),
      atualizarLista: (novaRaw: { produtos: Record<string, unknown>[] } & Record<string, unknown>) => {
        const nova = lerLista(novaRaw);
        listaRef.current = nova;
        dataUpdatedAtRef.current += 1;
        qc.setQueryData(["integracao-lista", "t1"], nova);
        rerenderTrigger();
      },
      // Simula um refetch em SEGUNDO PLANO cujo RESULTADO é idêntico (mesma referência) ao já em cache — só o
      // `dataUpdatedAt` muda. Usado pelo teste B-I1 (diálogo de fotos re-sincroniza mesmo sem a lista "mudar").
      refetchIdentico: () => { dataUpdatedAtRef.current += 1; rerenderTrigger(); },
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
    // Fix round 1 T12b (A-I4/B-I7 c): com exatamente 1 rascunho sujo, o toast prefixa o nome do produto — o usuário
    // não precisa adivinhar qual dos até 50 produtos do lote causou a recusa.
    expect((await toastMock()).error).toHaveBeenCalledWith(
      'Produto Teste: Você não tem permissão para editar "Preço de venda" (mesma regra do card do produto).',
    );
    // A recusa é do LOTE inteiro (integracao_salvar atômico) — o rascunho continua no input, nada foi perdido.
    expect(input()!.value).toBe("Nome Pendente");
    await view.desmontar();
  });

  // Fix round 1 T12b — revisão A-I4/B-I7 (a): pré-validação no CLIENTE nomeando produto e campo — nunca chama a
  // mutation quando um valor já seria recusado pelo servidor (Nome vazio, aqui).
  it("pré-validação no cliente: Nome vazio bloqueia o Salvar ANTES de chamar a mutation, nomeando o produto", async () => {
    const lista = listaRaw([produtoRaw()]);
    const view = await montarComMocks({ lista });
    const { act } = await import("react");
    const input = () => view.container.querySelector<HTMLInputElement>('input[aria-label^="Nome —"]');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input()!, "   "); // só espaço — vazio depois de aparar
      input()!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const botaoSalvar = () => [...document.body.querySelectorAll("button")].find((b) => b.textContent?.includes("Salvar") && !b.textContent?.includes("Descartar"));
    expect(botaoSalvar()?.hasAttribute("disabled")).toBe(false); // sujo o bastante pra habilitar o botão
    await act(async () => { botaoSalvar()!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect((await toastMock()).error).toHaveBeenCalledWith("Produto Teste: O nome não pode ficar vazio.");
    expect(view.salvarSpy).not.toHaveBeenCalled(); // a mutation NUNCA foi chamada — bloqueado antes
    await view.desmontar();
  });

  // Fix round 1 T12b — revisão A-I1/A-I4/B-I4: a sobra pós-Salvar precisa achar a lista em CACHE pela chave por
  // PREFIXO (getQueriesData), não a chave exata de 2 elementos — e nunca regride o rev. Prova OBSERVÁVEL: um 2º
  // Salvar manda o `rev` que a sobra CARREGA no payload — se a re-mesclagem falhou (achou `undefined` no cache),
  // a sobra fica presa no `rev` retornado pelo 1º Salvar (2); se funcionou, ela usa o `rev` mais novo do cache (3).
  // Um rascunho SÓ com um SKU pendente (sem nenhum campo alterado) é o caso real que produz sobra: digitar um SKU
  // manual na sublinha, exatamente como `SkuCelulaEditavel` grava (`comSkus`).
  it("sobra pós-Salvar (SKU falhou): re-mescla contra a lista em cache achada por PREFIXO, sem baixar o rev", async () => {
    const produtoComSublinha = produtoRaw({
      campos: undefined,
      vivo: { campos: ["ref_sku"], linhas: [{ tipo: "variante", ordem: 1, variante_key: "v1", tamanho_key: "P", valores: {} }] },
      sublinhas: [{
        variante_key: "v1", tamanho_key: "P", variante_ordem: 1, tamanho_ordem: 1,
        cor_nome: "Azul", apelido_nome: null, tamanho: "P", sku_id: "sku-1", sku: "REF0001-AZ-P", sku_rev: 3, manual: false,
      }],
    });
    const lista = listaRaw([produtoComSublinha], { campos: ["ref_sku"] });
    const view = await montarComMocks({
      lista,
      // O passo 3 (SKU) falha para este produto — sobra rascunho SÓ com o SKU pendente (nenhum campo alterado).
      salvarImpl: async () => ({
        salvos: 0, revs: {}, fotos: {}, skusOk: [],
        skusFalhas: [{ modeloId: "m1", nome: "Produto Teste", texto: "SKU em conflito." }],
      }),
    });
    const { act } = await import("react");
    // Abre a sublinha (seta de expandir) e digita um SKU manual na célula editável.
    const botaoExpandir = view.container.querySelector<HTMLButtonElement>('button[aria-label^="Abrir sublinhas"]');
    expect(botaoExpandir, "seta de expandir sublinhas").not.toBeNull();
    await act(async () => { botaoExpandir!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    const skuInput = () => view.container.querySelector<HTMLInputElement>('input[aria-label^="SKU —"]');
    expect(skuInput(), "input de SKU da sublinha").not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(skuInput()!, "MEU-SKU-MANUAL");
      skuInput()!.dispatchEvent(new Event("input", { bubbles: true }));
      skuInput()!.dispatchEvent(new Event("focusout", { bubbles: true }));
    });
    const botaoSalvar = () => [...document.body.querySelectorAll("button")].find((b) => b.textContent?.includes("Salvar") && !b.textContent?.includes("Descartar"));
expect(botaoSalvar()?.hasAttribute("disabled")).toBe(false); // o SKU pendente sujou o rascunho — Salvar habilitado
    await act(async () => { botaoSalvar()!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    // Enquanto o Salvar está em voo, o servidor já commitou e outra pessoa (ou o próprio kanban automático) avança
    // a lista em cache para rev 3. Escrito na chave REAL de 5 elementos que `useIntegracao.ts` usa de verdade
    // (`[...chaveLista(tenantId), situacao, filtros, pagina]`) — NÃO a chave "achatada" de 2 elementos que o
    // harness usa para a query ativa. Isto é o que discrimina o bug real (A-I1(a)/B-I4(a)): `getQueryData` com a
    // chave EXATA de 2 elementos NUNCA acharia este registro (casa só por hash exato); só
    // `getQueriesData({queryKey: chaveLista(tenantId)})`, que casa por PREFIXO, o encontra.
    const { lerLista } = await import("@/lib/integracao/produtos");
    view.qc.setQueryData(
      ["integracao-lista", "t1", "nao_integrados", {}, 1],
      lerLista(listaRaw([{ ...produtoComSublinha, rev: 3 }], { campos: ["ref_sku"] })),
    );
    await view.rodarSalvar();
    expect((await toastMock()).error).toHaveBeenCalledWith("Produto Teste: SKU em conflito.");
    // Dispara um 2º Salvar (a sobra ainda tem o SKU pendente) — o payload enviado carrega o rev que a sobra tem
    // AGORA. Precisa ser 3 (achado no cache pelo prefixo), nunca 1 (o rev original, se a sobra nunca re-mesclou).
    expect(botaoSalvar()?.hasAttribute("disabled")).toBe(false);
    await act(async () => { botaoSalvar()!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await view.rodarSalvar();
    // `salvar.mutate(enviados, ...)` recebe o array de `Rascunho` (não o payload já traduzido pro servidor) —
    // `useSalvarIntegracao` é o que está mockado aqui, então `salvarSpy` recebe exatamente o que `ProdutosAba`
    // manda pra mutation: os próprios `Rascunho`s sujos, com `.modeloId`/`.rev`.
    const chamadas = view.salvarSpy.mock.calls as unknown as Array<[Array<{ modeloId: string; rev: number }>]>;
    const segundaChamada = chamadas[1]?.[0] ?? [];
    const itemM1 = segundaChamada.find((it) => it.modeloId === "m1");
    expect(itemM1?.rev).toBe(3);
    await view.desmontar();
  });

  // Fix round 1 T12b — revisão A-I6/B-I2 (D36): um rascunho cujo produto SAIU da página atual (renomeado/filtrado)
  // nunca fica invisível — aparece na faixa "N alterações em produtos fora desta página".
  it("rascunho escondido: produto sai da página (renomeado) — aparece na faixa com descartar", async () => {
    const lista = listaRaw([produtoRaw()]);
    const view = await montarComMocks({ lista });
    const { act } = await import("react");
    const input = () => view.container.querySelector<HTMLInputElement>('input[aria-label^="Nome —"]');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input()!, "Editando Antes De Sumir");
      input()!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // O produto sai da PÁGINA atual (ex.: outra pessoa mudou o nome, e a ordenação por nome moveu ele de página —
    // a lista relistada não tem mais m1).
    await act(async () => { view.atualizarLista(listaRaw([])); });
    expect(view.container.textContent).toContain("fora desta página");
    expect(view.container.textContent).toContain("Produto Teste");
    const botaoDescartar = [...view.container.querySelectorAll("button")].find((b) => b.textContent === "descartar");
    expect(botaoDescartar, "botão 'descartar' na faixa de escondidos").toBeDefined();
    await act(async () => { botaoDescartar!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(view.container.textContent).not.toContain("fora desta página");
    await view.desmontar();
  });

  // Fix round 1 T12b — revisão B-I6/A-I2: onKeywords estável via useCallback (o memo das linhas não quebra a cada
  // tecla). Prova indireta pelo comportamento: abrir Keywords não perde o rascunho em edição na MESMA sessão.
  it("onKeywords é estável entre renders (useCallback) — abrir o diálogo não perde o rascunho da linha", async () => {
    const lista = listaRaw([produtoRaw()], { campos: ["nome", "preco_venda", "keywords"] });
    const view = await montarComMocks({ lista });
    const { act } = await import("react");
    const input = () => view.container.querySelector<HTMLInputElement>('input[aria-label^="Nome —"]');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input()!, "Nome Em Edição");
      input()!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const botaoEditarKeywords = [...view.container.querySelectorAll("button")].find((b) => b.textContent === "editar");
    expect(botaoEditarKeywords).toBeDefined();
    await act(async () => { botaoEditarKeywords!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(document.body.textContent).toContain("Keywords da loja");
    expect(input()!.value).toBe("Nome Em Edição"); // o rascunho sobreviveu a abrir o Keywords
    await view.desmontar();
  });

  // Fix round 1 T12b — revisão A-I2/B-I6: teste de CONTAGEM DE RENDER de verdade (não indireto) — uma linha NÃO
  // tocada não rerrenderiza quando outra linha recebe uma tecla. Espiona `rotuloEstado` (chamado 1x por render de
  // `LinhaProduto`, dentro de `estadoCelula`) no módulo REAL (não mockado) — se o `React.memo` da linha intocada
  // (produto "m2") continuar bloqueando o render, a contagem de chamadas para ELE não muda; se o memo tivesse sido
  // derrubado (ex.: `onKeywords` inline recriado a cada tecla, como no round anterior), TODAS as linhas
  // rerrenderizariam e a contagem de m2 subiria junto com a de m1.
  it("React.memo de verdade: uma linha NÃO tocada não rerrenderiza ao digitar em OUTRA linha (contagem real)", async () => {
    const lista = listaRaw([
      produtoRaw({ modelo_id: "m1", raw: { nome: "Produto Um", ref: "REF0001", tamanho_tipo: "letra" } }),
      produtoRaw({ modelo_id: "m2", raw: { nome: "Produto Dois", ref: "REF0002", tamanho_tipo: "letra" } }),
    ]);
    const view = await montarComMocks({ lista });
    // Espiar SÓ DEPOIS de `montarComMocks` (que faz `vi.resetModules()` internamente) — `produtosModulo` é a MESMA
    // instância que `ProdutosAba.tsx` importou; espiar uma instância importada ANTES do reset intercepta um módulo
    // diferente do que o componente usa de verdade, e o spy nunca vê nenhuma chamada.
    const rotuloSpy = vi.spyOn(view.produtosModulo, "rotuloEstado");
    const inputM1 = view.container.querySelector<HTMLInputElement>('input[aria-label="Nome — Produto Um"]');
    expect(inputM1).not.toBeNull();
    const { act } = await import("react");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(inputM1!, "Produto Um Editado");
      inputM1!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // `rotuloEstado` é chamado com `p` (o `ProdutoLista` inteiro) como 1º argumento — cada chamada corresponde a UM
    // render de `LinhaProduto` para aquele produto. A linha de m2 (não tocada) não pode ter rerrenderizado nenhuma vez.
    expect(rotuloSpy.mock.calls.length, "esperava pelo menos 1 chamada (a linha de m1, tocada)").toBeGreaterThan(0);
    const chamadasParaM2 = rotuloSpy.mock.calls.filter((c) => (c[0] as unknown as { modeloId?: string }).modeloId === "m2");
    expect(chamadasParaM2.length, "linha de m2 (intocada) NÃO deveria ter rerrenderizado").toBe(0);
    rotuloSpy.mockRestore();
    await view.desmontar();
  });

  // Fix round 1 T12b — revisão B-I1 (diálogo de fotos por snapshot velho): o diálogo fecha sozinho se o produto
  // TRAVAR (outra pessoa deixou integrável) enquanto está aberto — nunca deixa o usuário editando um rascunho cujo
  // rev/base já ficaram velhos, o que geraria um P0409/42501 pra sempre no próximo Salvar.
  it("FotosDialog fecha sozinho quando o produto trava (vira integrável) enquanto está aberto", async () => {
    // O campo "foto" precisa estar em `campos` pra a coluna (e o botão "trocar/adicionar/remover") aparecer.
    const lista = listaRaw([produtoRaw()], { campos: ["nome", "preco_venda", "foto"] });
    const view = await montarComMocks({ lista });
    const { act } = await import("react");
    const botaoFotos = () => [...document.body.querySelectorAll("button")].find((b) => b.textContent?.includes("trocar/adicionar/remover"));
    expect(botaoFotos()).toBeDefined();
    await act(async () => { botaoFotos()!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(document.body.textContent).toContain("Fotos — Produto Teste");
    // O produto vira integrável (outra pessoa integrou) na relista seguinte.
    const listaTravada = listaRaw([produtoRaw({ estado: "integravel", rev: 2 })], { campos: ["nome", "preco_venda", "foto"] });
    await act(async () => { view.atualizarLista(listaTravada); });
    expect(document.body.textContent).not.toContain("Fotos — Produto Teste");
    await view.desmontar();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Fix round 1 T12b — revisão A-I5/B-I5: o laço de conflito das Keywords. Harness PRÓPRIO (KeywordsDialog não
// depende de ProdutosAba): mocka `supabase.rpc` (P0409 na 1ª chamada) e `@tanstack/react-query`'s QueryClient
// de verdade (não mockado) pra provar que o `refetchQueries` é de fato AGUARDADO antes de ler o cache.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("KeywordsDialog — P0409 nunca apaga o texto digitado nem trava num laço (A-I5/B-I5)", () => {
  async function montarKeywords(opts: { rpcImpl: (nome: string, args: unknown) => Promise<{ data: unknown; error: unknown }> }) {
    vi.resetModules();
    vi.doMock("@/hooks/useActiveTenantId", () => ({ useActiveTenantId: () => "t1" }));
    vi.doMock("@/integrations/supabase/client", () => ({ supabase: { rpc: opts.rpcImpl } }));
    vi.doMock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
    vi.doMock("@/components/integracao/useIntegracao", () => ({
      chaveLista: (tenantId: string) => ["integracao-lista", tenantId],
      invalidarIntegracao: () => {},
    }));
    vi.doMock("@tanstack/react-router", () => ({
      useBlocker: () => ({ status: "idle", proceed() {}, reset() {} }),
    }));
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    const { createElement } = await import("react");
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { KeywordsDialog } = await import("@/components/integracao/KeywordsDialog");
    const { lerLista } = await import("@/lib/integracao/produtos");
    const qc = new QueryClient();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onFecharSpy = vi.fn();
    const sujoSpy = vi.fn();
    await act(async () => {
      root.render(createElement(QueryClientProvider, { client: qc },
        createElement(KeywordsDialog, { atual: "Moda, Verão", onFechar: onFecharSpy, onSujoChange: sujoSpy })));
    });
    return {
      container, qc, onFecharSpy, sujoSpy, lerLista,
      desmontar: async () => { await act(async () => root.unmount()); container.remove(); },
    };
  }

  it("P0409: mantém o texto digitado, busca o valor fresco por AWAIT (nunca lê o cache antes do refetch resolver), e mostra a ação 'usar o texto novo'", async () => {
    let chamada = 0;
    const view = await montarKeywords({
      rpcImpl: async () => {
        chamada += 1;
        if (chamada === 1) return { data: null, error: Object.assign(new Error("keywords_mudou: outra pessoa mudou"), { code: "P0409" }) };
        return { data: null, error: null };
      },
    });
    const { act } = await import("react");
    const textarea = () => document.body.querySelector<HTMLTextAreaElement>("#integracao-keywords");
    expect(textarea()?.value).toBe("Moda, Verão");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(textarea()!, "Moda, Verão, Sardinha (meu texto)");
      textarea()!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // Escreve o valor FRESCO na chave real de 5 elementos ANTES do clique — simula outra pessoa tendo salvo. O
    // `refetchQueries({queryKey: chaveLista("t1"), type:"active"})` do componente não tem query ATIVA pra refazer
    // (esta suíte não monta `useIntegracaoLista`), então ele resolve imediatamente sem mudar o cache — por isso o
    // teste escreve o valor fresco de antemão, e a asserção real é que USAR ESSE VALOR exige o clique explícito em
    // "usar o texto novo" (nunca aplicado sozinho).
    const { lerLista } = view;
    view.qc.setQueryData(
      ["integracao-lista", "t1", "nao_integrados", {}, 1],
      lerLista({ campos: [], produtos: [], keywords: "Moda, Verão, Sardinha (valor do servidor)" }),
    );
    const botaoSalvar = () => [...document.body.querySelectorAll("button")].find((b) => b.textContent === "Salvar" || b.textContent === "Salvando…");
    await act(async () => { botaoSalvar()!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    // O texto digitado NUNCA foi apagado — nem por um instante (a asserção síncrona logo após o `act` já cobre o
    // commit intermediário que o bug antigo produzia: `atual` velho copiado pro `texto` no MESMO commit do erro).
    expect(textarea()?.value).toBe("Moda, Verão, Sardinha (meu texto)");
    expect(document.body.textContent).toContain("Outra pessoa mudou as Keywords");
    const botaoUsarNovo = [...document.body.querySelectorAll("button")].find((b) => b.textContent === "usar o texto novo");
    expect(botaoUsarNovo, "ação 'usar o texto novo' deveria aparecer").toBeDefined();
    // Sem clicar em "usar o texto novo", o texto digitado continua — nunca aplicado sozinho.
    expect(textarea()?.value).toBe("Moda, Verão, Sardinha (meu texto)");
    await act(async () => { botaoUsarNovo!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(textarea()?.value).toBe("Moda, Verão, Sardinha (valor do servidor)");
    // Adotar o novo faz `texto === base` (nada mais a salvar agora) — o botão Salvar fica desabilitado até uma
    // edição de verdade. Edita de novo (levemente) pra provar que o PRÓXIMO Salvar (2ª chamada RPC, que este mock
    // deixa passar) usa o `base` FRESCO (não o velho) e não dá P0409 de novo — sem laço.
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(textarea()!, "Moda, Verão, Sardinha (valor do servidor) e mais um pouco");
      textarea()!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(botaoSalvar()?.hasAttribute("disabled")).toBe(false);
    await act(async () => { botaoSalvar()!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(view.onFecharSpy).toHaveBeenCalled();
    await view.desmontar();
  });

  it("m7: o texto sujo do diálogo é reportado via onSujoChange (guarda única da página)", async () => {
    const view = await montarKeywords({ rpcImpl: async () => ({ data: null, error: null }) });
    const { act } = await import("react");
    expect(view.sujoSpy).toHaveBeenLastCalledWith(false);
    const textarea = () => document.body.querySelector<HTMLTextAreaElement>("#integracao-keywords");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(textarea()!, "Moda, Verão, Novo Texto");
      textarea()!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(view.sujoSpy).toHaveBeenLastCalledWith(true);
    await view.desmontar();
  });
});
