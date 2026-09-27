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

// Fix round 2 T12b (minor, ambas as revisões — "memoize previaDeErro"): render de VERDADE (não regex-on-source) —
// `usePreviasSkus` precisa devolver a MESMA referência de `PreviaSkus` de erro entre 2 renders quando nada mudou
// (mesmo rascunho, mesma entrada, RPC continua falhando do mesmo jeito). Harness próprio: monta um componente que
// chama o hook de verdade e expõe o resultado via ref; mocka só `supabase.rpc` (falha sempre) e `useActiveTenantId`.
describe("useIntegracao — usePreviasSkus memoiza previaDeErro (identidade estável entre renders sem mudança real)", () => {
  async function montarPreviasSkus(rascunhoInicial: unknown) {
    vi.resetModules();
    vi.doMock("@/hooks/useActiveTenantId", () => ({ useActiveTenantId: () => "t1" }));
    vi.doMock("@/integrations/supabase/client", () => ({
      supabase: { rpc: async () => ({ data: null, error: Object.assign(new Error("falhou"), { code: "" }) }) },
    }));
    const { createElement } = await import("react");
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    const { usePreviasSkus } = await import("@/components/integracao/useIntegracao");
    const resultadoRef: { current: Record<string, unknown> } = { current: {} };
    let rascunhoAtual = rascunhoInicial;
    function Sonda() {
      resultadoRef.current = usePreviasSkus([rascunhoAtual as any], true);
      return null;
    }
    // `retry: false` — sem isso, o QueryClient tenta de novo (com backoff) antes de marcar `isError`, e o polling
    // do teste levaria segundos reais pra ver o erro de verdade.
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const arvore = () => createElement(QueryClientProvider, { client: qc }, createElement(Sonda));
    await act(async () => { root.render(arvore()); });
    return {
      resultadoRef,
      // Rerender com um rascunho DIFERENTE (novo objeto, mas mesma entrada relevante) — simula o que acontece na
      // tela real (o objeto `Rascunho` muda de referência a cada `setRascunhos`, mesmo sem edição de verdade).
      rerenderComNovoObjetoEquivalente: (novo: unknown) => {
        rascunhoAtual = novo;
        return act(async () => { root.render(arvore()); });
      },
      aguardarErro: async () => {
        // A query precisa resolver (falhar) e re-renderizar antes do resultado ter `previaDeErro` no lugar de `undefined`.
        for (let i = 0; i < 20 && !(resultadoRef.current as any).m1; i++) {
          await act(async () => { await new Promise((r) => setTimeout(r, 20)); root.render(arvore()); });
        }
      },
      desmontar: async () => { await act(async () => root.unmount()); container.remove(); },
    };
  }

  it("2 renders com o MESMO erro e a MESMA entrada devolvem a MESMA referência de PreviaSkus (não recria à toa)", async () => {
    const { novoRascunho, comSkus } = await import("@/lib/integracao/rascunho");
    const { lerLista } = await import("@/lib/integracao/produtos");
    const construirRascunho = () => {
      const lista = lerLista({
        campos: [], produtos: [{
          modelo_id: "m1", origem: "interno", estado: "nao_integravel", rev: 1,
          raw: { nome: "Produto Teste", ref: "REF0001", tamanho_tipo: "letra" },
          faltas: [], completo: true, sublinhas: [],
        }],
      });
      const p = lista.produtos[0];
      return comSkus(novoRascunho(p), {
        regerar: false,
        manuais: { "v1|P": { varianteKey: "v1", tamanhoKey: "P", sku: "MEU-SKU", id: "s1", rev: 1 } },
      });
    };
    const view = await montarPreviasSkus(construirRascunho());
    await view.aguardarErro();
    const primeiraReferencia = (view.resultadoRef.current as any).m1;
    expect(primeiraReferencia, "esperava uma PreviaSkus de erro pra m1").toBeDefined();
    // Rerender com um NOVO objeto Rascunho (referência diferente, mas MESMA entrada: mesmo modeloId/ref/skus) —
    // exatamente o que acontece na tela real a cada `setRascunhos`. A entrada (chave) não mudou, e o erro é o
    // mesmo — a `PreviaSkus` devolvida precisa ser a MESMA referência (memoizada), não uma recriada à toa.
    await view.rerenderComNovoObjetoEquivalente(construirRascunho());
    await view.aguardarErro();
    const segundaReferencia = (view.resultadoRef.current as any).m1;
    expect(segundaReferencia).toBe(primeiraReferencia); // MESMA referência — prova a memoização
    await view.desmontar();
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
    // m4 (revisão): `tenantIdRef` é MUTÁVEL — o teste de troca de loja (`trocarTenant`) muda o valor e dispara um
    // re-render, sem precisar reconstruir o mock inteiro.
    const tenantIdRef = { current: "t1" };
    vi.doMock("@/hooks/useActiveTenantId", () => ({ useActiveTenantId: () => tenantIdRef.current }));
    vi.doMock("@/hooks/useStoreTimezone", () => ({ useStoreTimezone: () => "America/Sao_Paulo" }));
    vi.doMock("@/hooks/useAuth", () => ({ useAuth: () => ({ canView: () => true }) }));
    vi.doMock("@/hooks/useTenantBranding", () => ({ useTenantBranding: () => ({ nome: "Loja Teste" }) }));
    vi.doMock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
    // `listaRef.current` guarda a lista JÁ LIDA por `lerLista` (o mesmo shape que `useIntegracaoLista` devolve de
    // verdade) — os testes constroem a entrada como o JSONB CRU (`listaRaw`/`produtoRaw`), igual à fixture `p()` de
    // integracao-celula.test.ts, e este helper faz a conversão uma vez só, aqui. Tipo aceita `undefined` (m-R7):
    // simula `q.data` ainda não chegado (1º carregamento, ou troca de loja/filtro em voo).
    const listaRef: { current: ReturnType<typeof lerLista> | undefined } = { current: lerLista(opts.lista) };
    const dataUpdatedAtRef = { current: 1 };
    let rerenderTrigger = () => {};
    // Fix round 2 T12b (R2/R-I2): registra CADA `pagina` que `ProdutosAba` pede ao hook — a lista mockada é estática
    // (não reage ao argumento), então a única forma de observar um `setPagina(1)` indevido é espiar o PRÓPRIO
        // argumento recebido aqui, não o texto renderizado (que só reflete a lista, nunca o estado interno da página).
    const paginasChamadas: number[] = [];
    vi.doMock("@/components/integracao/useIntegracao", () => ({
      chaveLista: (tenantId: string) => ["integracao-lista", tenantId],
      useIntegracaoLista: (_situacao: unknown, _filtros: unknown, pagina: number) => {
        paginasChamadas.push(pagina);
        return { data: listaRef.current, isError: false, error: null, refetch: () => {}, dataUpdatedAt: dataUpdatedAtRef.current };
      },
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
      // m-R7: simula `q.data` voltando a `undefined` (troca de loja/filtro em voo, ou o 1º carregamento) sem
      // desmontar o componente — o `rascunhos` (staging) sobrevive a essa transição.
      zerarLista: () => { listaRef.current = undefined; rerenderTrigger(); },
      // m4: troca de loja SEM desmontar o componente (o super admin muda de loja no mesmo painel) — muda
      // `tenantId` e a lista mockada (nova loja, produto diferente) na mesma leva, como aconteceria de verdade
      // (a query muda de key e o TanStack busca a lista nova).
      trocarTenant: (novoTenantId: string, novaListaRaw: { produtos: Record<string, unknown>[] } & Record<string, unknown>) => {
        tenantIdRef.current = novoTenantId;
        listaRef.current = lerLista(novaListaRaw);
        dataUpdatedAtRef.current += 1;
        rerenderTrigger();
      },
      salvarSpy,
      // R2/R-I2: última `pagina` que `ProdutosAba` pediu ao hook (o estado interno, não o que a lista mockada
      // devolve — ela é estática).
      paginaAtual: () => paginasChamadas[paginasChamadas.length - 1],
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

  // Fix round 2 T12b — revisão R1 (task-12b-review.md "Re-review round 1") / R-I1 (task-12b-code-review.md
  // "Re-check round 1"): regressão do fix round 1 (m8) — o updater `{...rs, ...prox}` NUNCA remove uma chave que
  // `prox` não tem, então um produto que virou integrável ficava PRESO em `rascunhos` pra sempre. Prova OBSERVÁVEL
  // (estado real, não só o toast): com 2 produtos sujos, um vira integrável; um Salvar seguinte das linhas
  // restantes precisa mandar SÓ o produto que continua editável — se o descartado ainda estivesse em `rascunhos`,
  // ele reapareceria no payload do 2º Salvar mesmo sem estar mais na tela. Também prova que o toast "descartadas"
  // dispara UMA vez só por produto, mesmo que o efeito rode de novo numa relista idêntica (`q.dataUpdatedAt`).
  it("regressão R1/R-I1: produto vira integrável — o rascunho é REMOVIDO de vez (não sobrevive pra um Salvar seguinte); toast 1x só", async () => {
    const lista = listaRaw([
      produtoRaw({ modelo_id: "m1", raw: { nome: "Produto Um", ref: "REF0001", tamanho_tipo: "letra" } }),
      produtoRaw({ modelo_id: "m2", raw: { nome: "Produto Dois", ref: "REF0002", tamanho_tipo: "letra" } }),
    ]);
    const view = await montarComMocks({ lista });
    const { act } = await import("react");
    const inputM1 = () => view.container.querySelector<HTMLInputElement>('input[aria-label="Nome — Produto Um"]');
    const inputM2 = () => view.container.querySelector<HTMLInputElement>('input[aria-label="Nome — Produto Dois"]');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(inputM1()!, "Um Editado");
      inputM1()!.dispatchEvent(new Event("input", { bubbles: true }));
      setter.call(inputM2()!, "Dois Editado");
      inputM2()!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // m1 vira integrável (outra pessoa integrou) — m2 continua editável e sujo.
    const listaNova = listaRaw([
      produtoRaw({ modelo_id: "m1", estado: "integravel", rev: 2, raw: { nome: "Produto Um", ref: "REF0001", tamanho_tipo: "letra" } }),
      produtoRaw({ modelo_id: "m2", raw: { nome: "Produto Dois", ref: "REF0002", tamanho_tipo: "letra" } }),
    ]);
    await act(async () => { view.atualizarLista(listaNova); });
    const toasts = await toastMock();
    expect(toasts.warning).toHaveBeenCalledTimes(1);
    // Uma relista IDÊNTICA (mesmo dado, só `dataUpdatedAt` muda — B-I1) não deve repetir o toast pro mesmo produto.
    await act(async () => { view.refetchIdentico(); });
    expect(toasts.warning).toHaveBeenCalledTimes(1);
    const botaoSalvar = () => [...document.body.querySelectorAll("button")].find((b) => b.textContent?.includes("Salvar") && !b.textContent?.includes("Descartar"));
    await act(async () => { botaoSalvar()!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await view.rodarSalvar();
    const chamadas = view.salvarSpy.mock.calls as unknown as Array<[Array<{ modeloId: string }>]>;
    const enviados = chamadas[0]?.[0] ?? [];
    // SÓ m2 (o que ainda é editável) pode ter sido enviado — m1 (integrável) nunca deveria reaparecer num payload.
    expect(enviados.map((r) => r.modeloId)).toEqual(["m2"]);
    await view.desmontar();
  });

  // Fix round 2 T12b — revisão R2 (task-12b-review.md) / R-I2 (task-12b-code-review.md): o debounce da busca
  // reaplicava `setPagina(1)` toda vez que `travaFiltro` soltava (Salvar terminou), mesmo sem a busca ter mudado —
  // um Salvar na página 3 jogava o usuário de volta pra página 1 assim que o botão destravava. Prova OBSERVÁVEL (o
  // ESTADO interno `pagina` do componente, via `paginaAtual()` — espiona o argumento que `ProdutosAba` passa pro
  // hook a cada render; a lista mockada é estática e não reage a esse argumento, então o texto "Página X de" NUNCA
  // mudaria mesmo com o bug presente): navega pra página 3, edita e Salva — `pagina` precisa continuar 3 depois
  // que `travaFiltro` solta e o debounce roda de novo (janela real de 400ms — a suíte não usa fake timers).
  it("regressão R2/R-I2: Salvar na página 3 não volta pra página 1 (busca não mudou)", async () => {
    const pagina1 = listaRaw([produtoRaw({ modelo_id: "m1", raw: { nome: "Produto P1", ref: "REF0001", tamanho_tipo: "letra" } })],
      { pagina: 1, total: 150 });
    const view = await montarComMocks({ lista: pagina1 });
    const { act } = await import("react");
    expect(view.paginaAtual()).toBe(1);
    const botaoProxima = () => [...view.container.querySelectorAll("button")].find((b) => b.textContent === "Próxima");
    // Página 1 → 2 → 3 (o componente decide sozinho via `setPagina((n) => n + 1)`; a lista mockada nem precisa
    // saber — só serve pra manter `lista.produtos` não-vazio e o botão "Próxima" habilitado via `totalPaginas`).
    await act(async () => { botaoProxima()!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(view.paginaAtual()).toBe(2);
    await act(async () => { botaoProxima()!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(view.paginaAtual()).toBe(3);
    // Edita o produto (a lista mockada continua com m1, mesmo "na página 3" pro estado do componente — só o rótulo
    // de página muda de fato no servidor de verdade; aqui o que importa é o ESTADO `pagina`, não o texto) e Salva.
    const input = () => view.container.querySelector<HTMLInputElement>('input[aria-label="Nome — Produto P1"]');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input()!, "Produto P1 Editado");
      input()!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const botaoSalvar = () => [...document.body.querySelectorAll("button")].find((b) => b.textContent?.includes("Salvar") && !b.textContent?.includes("Descartar"));
    await act(async () => { botaoSalvar()!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await view.rodarSalvar();
    // `travaFiltro` solta (Salvar concluído, `sujos` esvaziou) — o debounce da busca roda de novo (deps mudaram),
    // mas a busca continua "" (nunca digitada): a página não pode ter sido resetada pra 1. Espera passar da janela
    // real de 400ms do debounce (a suíte não usa fake timers) pra dar tempo do efeito (com ou sem o bug) disparar.
    await act(async () => { await new Promise((r) => setTimeout(r, 450)); });
    expect(view.paginaAtual()).toBe(3);
    await view.desmontar();
  });

  // Fix round 2 T12b — ruling B-I3 (nunca implementado nas rodadas anteriores): depois de um Salvar SEM sobra
  // (tudo gravou), a lista em cache SÓ reflete o valor novo depois do refetch de `onSettled` — uma janela real em
  // que a lista mockada aqui continua parada no valor VELHO (o harness nunca chama `atualizarLista` sozinho; só o
  // teste decide quando "o servidor relistou"). 2 provas OBSERVÁVEIS: (1) a célula mostra o valor SALVO mesmo
  // com a lista ainda velha (não pisca de volta); (2) editar de novo NESSA janela e salvar de novo manda o REV
  // SALVO (não o rev antigo da lista) — sem isso, o 2º Salvar levaria um rev atrasado e um P0409 contra o próprio
  // Salvar que acabou de terminar.
  it("ruling B-I3: sobra em espera até a lista confirmar — célula mostra o valor salvo, e um novo Salvar usa o rev salvo", async () => {
    const lista = listaRaw([produtoRaw({ rev: 1 })]);
    const view = await montarComMocks({
      lista,
      salvarImpl: async () => ({ salvos: 1, revs: { m1: 2 }, fotos: {}, skusOk: [], skusFalhas: [] }),
    });
    const { act } = await import("react");
    const input = () => view.container.querySelector<HTMLInputElement>('input[aria-label^="Nome —"]');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input()!, "Nome Salvo");
      input()!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const botaoSalvar = () => [...document.body.querySelectorAll("button")].find((b) => b.textContent?.includes("Salvar") && !b.textContent?.includes("Descartar"));
    await act(async () => { botaoSalvar()!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await view.rodarSalvar();
    // A lista mockada CONTINUA em rev 1/"Produto Teste" (o `onSettled` real chamaria `atualizarLista`, mas o teste
    // não simula isso ainda de propósito — é exatamente a janela que o ruling B-I3 cobre). Mesmo assim, a célula
    // não pode voltar a mostrar o nome antigo.
    expect(input()!.value).toBe("Nome Salvo");
    // Edita de novo NESSA janela (a lista ainda não confirmou) e salva de novo — o item enviado precisa levar o
    // rev SALVO (2), nunca o rev 1 da lista, que ainda está velha.
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input()!, "Nome Salvo De Novo");
      input()!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { botaoSalvar()!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await view.rodarSalvar();
    const chamadas = view.salvarSpy.mock.calls as unknown as Array<[Array<{ modeloId: string; rev: number }>]>;
    const segundaChamada = chamadas[1]?.[0] ?? [];
    const itemM1 = segundaChamada.find((it) => it.modeloId === "m1");
    expect(itemM1?.rev).toBe(2);
    await view.desmontar();
  });

  // Fix round 3 T12b — code-review "Re-check round 2" (m-S5, gap de teste): faltava prova executável de que a
  // espera "salvo, aguardando lista" (ruling B-I3) CEDE de verdade quando a relista chega com um rev MAIOR que o
  // salvo (outra pessoa editou o MESMO produto no meio) — a leitura do código já dizia que sim
  // (`produtoComHold` só substitui quando `aguardando.rev >= p.rev`; um rev da lista MAIOR sempre vence), mas
  // nunca havia um teste conferindo o valor do SERVIDOR aparecendo na célula.
  it("regressão m-S5 (a): a espera CEDE quando a relista chega com rev MAIOR e o valor de outra pessoa (mostra o valor do servidor, não o salvo)", async () => {
    const lista = listaRaw([produtoRaw({ rev: 1 })]);
    const view = await montarComMocks({
      lista,
      salvarImpl: async () => ({ salvos: 1, revs: { m1: 2 }, fotos: {}, skusOk: [], skusFalhas: [] }),
    });
    const { act } = await import("react");
    const input = () => view.container.querySelector<HTMLInputElement>('input[aria-label^="Nome —"]');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input()!, "Nome Salvo");
      input()!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const botaoSalvar = () => [...document.body.querySelectorAll("button")].find((b) => b.textContent?.includes("Salvar") && !b.textContent?.includes("Descartar"));
    await act(async () => { botaoSalvar()!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await view.rodarSalvar();
    expect(input()!.value).toBe("Nome Salvo"); // a espera está segurando o valor salvo (rev 2)
    // A relista chega com rev 3 (MAIOR que o salvo, rev 2) e um valor de OUTRA PESSOA — a espera precisa CEDER na
    // hora: a lista É a fonte mais atual agora, não a espera.
    await act(async () => {
      view.atualizarLista(listaRaw([produtoRaw({ rev: 3, raw: { nome: "Nome De Outra Pessoa", ref: "REF0001", tamanho_tipo: "letra" } })]));
    });
    expect(input()!.value).toBe("Nome De Outra Pessoa");
    expect(input()!.value).not.toBe("Nome Salvo");
    await view.desmontar();
  });

  // Fix round 3 T12b (m-S5, gap de teste): um rascunho NASCIDO durante a janela da espera (o usuário digita de
  // novo antes da lista confirmar) precisa virar CONFLITO de verdade se a relista, quando finalmente chega, traz
  // um valor DIFERENTE do que o rascunho tinha tocado — a espera não pode mascarar uma edição alheia real.
  it("regressão m-S5 (b): um rascunho nascido durante a espera vira CONFLITO quando a relista chega com outro valor no MESMO campo tocado", async () => {
    const lista = listaRaw([produtoRaw({ rev: 1 })]);
    const view = await montarComMocks({
      lista,
      salvarImpl: async () => ({ salvos: 1, revs: { m1: 2 }, fotos: {}, skusOk: [], skusFalhas: [] }),
    });
    const { act } = await import("react");
    const input = () => view.container.querySelector<HTMLInputElement>('input[aria-label^="Nome —"]');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input()!, "Nome Salvo");
      input()!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const botaoSalvar = () => [...document.body.querySelectorAll("button")].find((b) => b.textContent?.includes("Salvar") && !b.textContent?.includes("Descartar"));
    await act(async () => { botaoSalvar()!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await view.rodarSalvar();
    // Edita de novo DURANTE a espera (a lista ainda não confirmou) — este rascunho nasce com base/rev = os
    // valores SALVOS (rev 2), não os da lista (ainda rev 1).
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input()!, "Nome Editado Na Janela");
      input()!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(input()!.value).toBe("Nome Editado Na Janela");
    // A relista finalmente chega com rev 3 (MAIOR que o rascunho, que está em rev 2) e um valor DIFERENTE no MESMO
    // campo (nome) que o rascunho tocou — conflito de verdade, nunca uma adoção silenciosa do valor alheio.
    await act(async () => {
      view.atualizarLista(listaRaw([produtoRaw({ rev: 3, raw: { nome: "Nome De Outra Pessoa", ref: "REF0001", tamanho_tipo: "letra" } })]));
    });
    expect(input()!.value).toBe("Nome Editado Na Janela"); // o meu não some
    expect(view.container.textContent).toContain("Outra pessoa mudou este campo.");
    await view.desmontar();
  });

  // Fix round 3 T12b — code-review "Re-check round 2" (m-S1): a v1 preenchia `novosAguardando` DENTRO do updater
  // de `setRascunhos` e lia a variável logo DEPOIS, fora dele — funcionava só porque o React roda o updater de
  // forma "eager" quando a fibra NÃO tem nenhuma atualização pendente no instante da chamada; com uma atualização
  // JÁ enfileirada na mesma fibra (outro `setState` do MESMO componente, cenário real de produção — o `onSuccess`
  // do TanStack Query roda fora do sistema de eventos sintéticos do React), o React NÃO calcula mais eager, e a
  // variável lida logo depois (fora do updater) chegaria vazia — um flash transitório provado empiricamente
  // (confirmado isolando `novosAguardando`/o handler `onChange` chamado direto via a prop interna
  // `__reactProps$...`, contornando a trava `disabled` real do campo de busca durante o Salvar — nenhum jeito de
  // reproduzir isso com uma interação de usuário real e um `act()` completo depois, já que o flash se "cura"
  // sozinho no próximo commit). Correção: o cálculo INTEIRO virou a função PURA `resultadoPosSalvar`
  // (`rascunho.ts`) — chamada aqui ANTES de qualquer `setState`, nunca dentro de um updater, então o resultado
  // nunca depende de QUANDO o React decide rodar um updater. A prova de regressão de verdade (que não depende de
  // nenhuma race interna do React pra ser determinística) mora em `integracao-rascunho.test.ts`, testando
  // `resultadoPosSalvar` diretamente. Este teste aqui é só o "fio wiring": confirma que `ProdutosAba` de fato
  // aplica o resultado dessa função nos dois `set` esperados, num Salvar normal.
  it("onSuccess aplica o resultado de resultadoPosSalvar (sobra + espera) nos dois setState esperados", async () => {
    const lista = listaRaw([produtoRaw({ modelo_id: "m1", rev: 1, raw: { nome: "Produto Um", ref: "REF0001", tamanho_tipo: "letra" } })]);
    const view = await montarComMocks({
      lista,
      salvarImpl: async () => ({ salvos: 1, revs: { m1: 2 }, fotos: {}, skusOk: [], skusFalhas: [] }),
    });
    const { act } = await import("react");
    const inputM1 = () => view.container.querySelector<HTMLInputElement>('input[aria-label^="Nome —"]');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(inputM1()!, "Um Editado");
      inputM1()!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const botaoSalvar = () => [...document.body.querySelectorAll("button")].find((b) => b.textContent?.includes("Salvar") && !b.textContent?.includes("Descartar"));
    await act(async () => { botaoSalvar()!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await view.rodarSalvar();
    // A célula continua mostrando o valor SALVO (a espera B-I3 está ativa) mesmo com a lista mockada ainda no rev
    // velho — prova que `setSalvosAguardando` recebeu o resultado de `resultadoPosSalvar`.
    expect(inputM1()!.value).toBe("Um Editado");
    // Edita de novo e salva de novo: o item enviado precisa levar o REV SALVO (2, da espera), nunca o rev 1 da
    // lista mockada (que nunca avançou) — prova indireta de que a espera tem o rev certo.
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(inputM1()!, "Um Editado De Novo");
      inputM1()!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { botaoSalvar()!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await view.rodarSalvar();
    const chamadas = view.salvarSpy.mock.calls as unknown as Array<[Array<{ modeloId: string; rev: number }>]>;
    const segundaChamada = chamadas[1]?.[0] ?? [];
    const itemM1 = segundaChamada.find((it) => it.modeloId === "m1");
    expect(itemM1?.rev).toBe(2);
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

  // Fix round 2 T12b — revisão R4 (task-12b-review.md) / m-R1 (task-12b-code-review.md): "mostrar" buscava por
  // `r.valores.ref` (o REF DIGITADO, ainda não salvo) em vez de `r.base.ref`/`r.base.nome` (o valor CONFIRMADO
  // pelo servidor — o único que `integracao_listar` de fato indexa). Se o usuário tivesse editado a REF antes do
  // produto sumir de página, "mostrar" buscava por um REF que a lista nunca teria, e parecia simplesmente não
  // fazer nada. Prova OBSERVÁVEL: o campo de busca (`#f-busca`, reflete o estado `busca`) precisa ficar com o REF
  // BASE (confirmado), nunca o REF editado no rascunho.
  it("regressão R4/m-R1: 'mostrar' busca pelo REF BASE (confirmado), nunca o REF editado no rascunho", async () => {
    const lista = listaRaw([produtoRaw()], { campos: ["ref_sku"] });
    const view = await montarComMocks({ lista });
    const { act } = await import("react");
    const inputRef = () => view.container.querySelector<HTMLInputElement>('input[aria-label^="REF / SKU —"]');
    expect(inputRef(), "input de REF").not.toBeNull();
    // Edita a REF (o rascunho passa a ter um REF DIFERENTE do base "REF0001").
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(inputRef()!, "REF-EDITADA-AINDA-NAO-SALVA");
      inputRef()!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(inputRef()!.value).toBe("REF-EDITADA-AINDA-NAO-SALVA");
    // O produto sai da página atual (renomeado/filtrado por outra razão qualquer).
    await act(async () => { view.atualizarLista(listaRaw([])); });
    expect(view.container.textContent).toContain("fora desta página");
    const botaoMostrar = [...view.container.querySelectorAll("button")].find((b) => b.textContent === "mostrar");
    expect(botaoMostrar, "botão 'mostrar' na faixa de escondidos").toBeDefined();
    await act(async () => { botaoMostrar!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    const buscaInput = () => view.container.querySelector<HTMLInputElement>("#f-busca");
    // O campo de busca precisa ficar com o REF BASE ("REF0001"), NUNCA o REF editado no rascunho.
    expect(buscaInput()?.value).toBe("REF0001");
    expect(buscaInput()?.value).not.toBe("REF-EDITADA-AINDA-NAO-SALVA");
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

  // Fix round 2 T12b (minor m-R7): com `lista` (q.data) ainda `undefined` — 1º carregamento, ou uma troca de
  // loja/filtro em voo — `idsPaginaAtual` é um Set VAZIO, e SEM a guarda TODO rascunho sujo passava a aparecer
  // (por um instante) na faixa "fora desta página", mesmo continuando exatamente onde estava. Prova OBSERVÁVEL:
  // suja um rascunho, zera a lista (`q.data` volta a `undefined`, sem desmontar o componente) e confirma que a
  // faixa NÃO aparece nesse instante.
  it("regressão m-R7: lista undefined (1º carregamento/troca em voo) não faz o rascunho aparecer como 'fora desta página'", async () => {
    const lista = listaRaw([produtoRaw()]);
    const view = await montarComMocks({ lista });
    const { act } = await import("react");
    const input = () => view.container.querySelector<HTMLInputElement>('input[aria-label^="Nome —"]');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input()!, "Editando Durante Troca De Loja");
      input()!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(view.container.textContent).not.toContain("fora desta página");
    // `q.data` volta a `undefined` (ex.: `useActiveTenantId()` mudou e a query ainda não resolveu de novo) — o
    // componente continua montado, o rascunho continua em `rascunhos` (staging sobrevive).
    await act(async () => { view.zerarLista(); });
    expect(view.container.textContent).not.toContain("fora desta página");
    await view.desmontar();
  });

  // Fix round 2 T12b (minor m3): "mostrar"/"descartar" da faixa de escondidos precisam ficar DESABILITADOS
  // enquanto o Salvar está em voo — evita correr com o `setRascunhos` do `onSuccess`/`onError` (ex.: "descartar"
  // clicado bem no instante em que o Salvar decide se aquele rascunho sobra ou não).
  it("regressão m3: 'mostrar'/'descartar' da faixa de escondidos ficam desabilitados durante o Salvar", async () => {
    const lista = listaRaw([
      produtoRaw({ modelo_id: "m1", raw: { nome: "Produto Visível", ref: "REF0001", tamanho_tipo: "letra" } }),
      produtoRaw({ modelo_id: "m2", raw: { nome: "Produto Escondido", ref: "REF0002", tamanho_tipo: "letra" } }),
    ]);
    const view = await montarComMocks({ lista });
    const { act } = await import("react");
    const inputM1 = () => view.container.querySelector<HTMLInputElement>('input[aria-label="Nome — Produto Visível"]');
    const inputM2 = () => view.container.querySelector<HTMLInputElement>('input[aria-label="Nome — Produto Escondido"]');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(inputM1()!, "Visível Editado");
      inputM1()!.dispatchEvent(new Event("input", { bubbles: true }));
      setter.call(inputM2()!, "Escondido Editado");
      inputM2()!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // m2 sai da página (só m1 continua na lista) — vira "escondido".
    await act(async () => {
      view.atualizarLista(listaRaw([produtoRaw({ modelo_id: "m1", raw: { nome: "Produto Visível", ref: "REF0001", tamanho_tipo: "letra" } })]));
    });
    expect(view.container.textContent).toContain("fora desta página");
    const botaoMostrar = () => [...view.container.querySelectorAll("button")].find((b) => b.textContent === "mostrar");
    const botaoDescartar = () => [...view.container.querySelectorAll("button")].find((b) => b.textContent === "descartar");
    expect(botaoMostrar()?.hasAttribute("disabled")).toBe(false);
    expect(botaoDescartar()?.hasAttribute("disabled")).toBe(false);
    // Dispara o Salvar (m1, o único visível/sujo na página) — SEM esperar `rodarSalvar()` (a mutation fica "em voo").
    const botaoSalvar = () => [...document.body.querySelectorAll("button")].find((b) => b.textContent?.includes("Salvar") && !b.textContent?.includes("Descartar"));
    await act(async () => { botaoSalvar()!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(document.body.textContent).toContain("Salvando…"); // confirma que a mutation está em voo
    expect(botaoMostrar()?.hasAttribute("disabled")).toBe(true);
    expect(botaoDescartar()?.hasAttribute("disabled")).toBe(true);
    await view.rodarSalvar();
    await view.desmontar();
  });

  // Fix round 2 T12b (minor m4): super admin troca de loja com um rascunho sujo pendente — sem zerar `rascunhos`
  // por `tenantId`, a edição da loja ANTERIOR continuava presente e ia num Salvar seguinte contra a loja NOVA.
  // Prova OBSERVÁVEL: a edição feita na loja 1 desaparece (nem no input, nem na faixa de escondidos) assim que a
  // loja troca — mesmo sem o usuário ter salvo ou descartado explicitamente.
  it("regressão m4: trocar de loja com rascunho sujo pendente ZERA o staging (nunca vaza pra loja nova)", async () => {
    const listaLoja1 = listaRaw([produtoRaw({ modelo_id: "m1", raw: { nome: "Produto Loja 1", ref: "REF0001", tamanho_tipo: "letra" } })]);
    const view = await montarComMocks({ lista: listaLoja1 });
    const { act } = await import("react");
    const input = () => view.container.querySelector<HTMLInputElement>('input[aria-label^="Nome —"]');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input()!, "Editando Na Loja 1");
      input()!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(input()!.value).toBe("Editando Na Loja 1");
    const botaoSalvarAntes = () => [...document.body.querySelectorAll("button")].find((b) => b.textContent?.includes("Salvar") && !b.textContent?.includes("Descartar"));
    expect(botaoSalvarAntes()?.hasAttribute("disabled")).toBe(false); // sujo — confirma que o rascunho existe
    // Super admin troca pra loja 2 (SEM salvar nem descartar explicitamente) — outro produto, outro tenantId.
    const listaLoja2 = listaRaw([produtoRaw({ modelo_id: "m9", raw: { nome: "Produto Loja 2", ref: "REF0009", tamanho_tipo: "letra" } })]);
    await act(async () => { view.trocarTenant("t2", listaLoja2); });
    // `textContent` NUNCA inclui o `value` de um <input> (a célula de Nome é editável) — confere pelo próprio input.
    expect(input()!.value).toBe("Produto Loja 2"); // o rascunho da loja 1 sumiu; mostra o produto NOVO sem edição
    expect(view.container.textContent).not.toContain("fora desta página"); // não sobrou como "escondido"
    // O Salvar da loja NOVA precisa estar DESABILITADO (nada sujo) — se o rascunho da loja 1 tivesse vazado, o
    // botão continuaria habilitado e um Salvar mandaria `modelo_id: "m1"` (da loja 1) contra a loja 2.
    const botaoSalvarDepois = () => [...document.body.querySelectorAll("button")].find((b) => b.textContent?.includes("Salvar") && !b.textContent?.includes("Descartar"));
    expect(botaoSalvarDepois()?.hasAttribute("disabled")).toBe(true);
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

  // Fix round 2 T12b — revisão R1 (task-12b-review.md) / R-I3 (task-12b-code-review.md): o fix round 1 deixava o
  // laço P0409 aberto por 2 caminhos. Prova OBSERVÁVEL dos DOIS ao mesmo tempo (nunca só o toast):
  // (a) "manter o meu" — depois de escolher essa ação, um Salvar seguinte precisa mandar `esperado` = o valor
  //     FRESCO (não o `atual` original que o diálogo carregou) — só assim o servidor aceita em vez de dar P0409 de
  //     novo. Espiona os ARGUMENTOS da 2ª chamada RPC.
  // (b) leitura por PREFIXO precisa pegar a query com maior `dataUpdatedAt`, nunca a primeira em ordem de inserção
  //     — o cache é semeado com 2 entradas: uma "antiga" (inserida ANTES do refetch, com keywords desatualizado) e
  //     a que o `refetchQueries({type:"active"})` de fato escreve por cima (mais recente). Sem essa fix, o
  //     `.find(d => !!d)` original pegaria a antiga (inserida primeiro) e o "usar o texto novo"/`base` carregariam
  //     o valor ERRADO.
  it("regressão R1/R-I3: 'manter o meu' manda esperado=fresco no Salvar seguinte (sem laço); lê a query de MAIOR dataUpdatedAt, nunca a 1ª em cache", async () => {
    const chamadasRpc: unknown[] = [];
    let chamada = 0;
    const view = await montarKeywords({
      rpcImpl: async (_nome, args) => {
        chamada += 1;
        chamadasRpc.push(args);
        if (chamada === 1) return { data: null, error: Object.assign(new Error("keywords_mudou: outra pessoa mudou"), { code: "P0409" }) };
        return { data: null, error: null };
      },
    });
    const { act } = await import("react");
    const textarea = () => document.body.querySelector<HTMLTextAreaElement>("#integracao-keywords");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(textarea()!, "Moda, Verão, Meu Texto");
      textarea()!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const { lerLista } = view;
    // Semeia a entrada ANTIGA primeiro (ordem de inserção) — nunca deveria ser a escolhida.
    view.qc.setQueryData(
      ["integracao-lista", "t1", "nao_integrados", {}, 1],
      lerLista({ campos: [], produtos: [], keywords: "Moda, Verão, VALOR ERRADO (entrada antiga)" }),
    );
    // Um pequeno atraso real garante `dataUpdatedAt` estritamente maior na 2ª escrita (Date.now() em ms).
    await new Promise((r) => setTimeout(r, 5));
    // A entrada MAIS RECENTE (o que o refetchQueries de verdade escreveria por cima) — é essa que deve vencer.
    view.qc.setQueryData(
      ["integracao-lista", "t1", "integrados", {}, 1],
      lerLista({ campos: [], produtos: [], keywords: "Moda, Verão, valor correto do servidor" }),
    );
    const botaoSalvar = () => [...document.body.querySelectorAll("button")].find((b) => b.textContent === "Salvar" || b.textContent === "Salvando…");
    await act(async () => { botaoSalvar()!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    // O texto digitado nunca muda sozinho.
    expect(textarea()?.value).toBe("Moda, Verão, Meu Texto");
    // A faixa de conflito mostra o valor CORRETO (o de maior dataUpdatedAt) — nunca o "errado" da entrada antiga.
    expect(document.body.textContent).toContain("Moda, Verão, valor correto do servidor");
    expect(document.body.textContent).not.toContain("VALOR ERRADO");
    const botaoManterOMeu = [...document.body.querySelectorAll("button")].find((b) => b.textContent === "manter o meu");
    expect(botaoManterOMeu, "ação 'manter o meu' deveria aparecer").toBeDefined();
    await act(async () => { botaoManterOMeu!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    // O texto continua o mesmo (nunca mudou) — "manter o meu" só fecha a faixa.
    expect(textarea()?.value).toBe("Moda, Verão, Meu Texto");
    // Salva de novo (2ª chamada RPC) — precisa passar (o mock deixa) E o argumento `esperado` precisa ser o valor
    // FRESCO (não o `atual` original "Moda, Verão" que o diálogo carregou ao montar).
    expect(botaoSalvar()?.hasAttribute("disabled")).toBe(false);
    await act(async () => { botaoSalvar()!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(chamadasRpc.length).toBe(2);
    const argsSegundaChamada = chamadasRpc[1] as { _keywords: { valor: string; esperado: string } };
    expect(argsSegundaChamada._keywords.esperado).toBe("Moda, Verão, valor correto do servidor");
    expect(argsSegundaChamada._keywords.valor).toBe("Moda, Verão, Meu Texto");
    expect(view.onFecharSpy).toHaveBeenCalled(); // 2º Salvar teve sucesso — sem laço
    await view.desmontar();
  });

  // Fix round 3 T12b (m-S4, code-review "Re-check round 2"): se o PRÓPRIO `refetchQueries` falhar por rede, o
  // `dataUpdatedAt` da query ativa não avança — o "fresco" encontrado podia ser exatamente o dado VELHO que já
  // causou o P0409, e o toast dizia "Outra pessoa mudou as Keywords" sem avisar que a causa real foi uma falha de
  // conexão (nada de laço sem saída — cada tentativa relê de novo — mas confuso pro usuário). Prova: semeia uma
  // query com `status: "error"` (via `qc.fetchQuery` com um `queryFn` que rejeita) na MESMA chave por prefixo —
  // o toast precisa nomear a falha de rede, nunca o texto genérico de conflito.
  it("regressão m-S4: refetch que falha por rede mostra uma mensagem de FALHA DE CONEXÃO, nunca o texto genérico de 'outra pessoa mudou'", async () => {
    const view = await montarKeywords({
      rpcImpl: async () => ({ data: null, error: Object.assign(new Error("keywords_mudou: outra pessoa mudou"), { code: "P0409" }) }),
    });
    const { act } = await import("react");
    const textarea = () => document.body.querySelector<HTMLTextAreaElement>("#integracao-keywords");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(textarea()!, "Moda, Verão, Meu Texto");
      textarea()!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // Semeia a query (mesma chave por prefixo) com um `queryFn` que REJEITA — deixa `state.status === "error"` e
    // `fetchStatus === "idle"` (terminou de tentar) depois que a Promise resolve, exatamente como o
    // `refetchQueries` real deixaria numa falha de rede genuína.
    await view.qc.fetchQuery({
      queryKey: ["integracao-lista", "t1", "nao_integrados", {}, 1],
      queryFn: () => Promise.reject(new Error("Failed to fetch")),
      retry: false,
    }).catch(() => {});
    const { toast } = await import("sonner");
    const toastMock = toast as unknown as { error: ReturnType<typeof vi.fn> };
    const botaoSalvar = () => [...document.body.querySelectorAll("button")].find((b) => b.textContent === "Salvar" || b.textContent === "Salvando…");
    await act(async () => { botaoSalvar()!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(textarea()?.value).toBe("Moda, Verão, Meu Texto"); // o texto digitado nunca muda
    expect(toastMock.error).toHaveBeenCalledWith(
      "Não foi possível confirmar o valor mais recente (falha de conexão). Tente salvar de novo.",
    );
    expect(toastMock.error).not.toHaveBeenCalledWith(expect.stringContaining("Outra pessoa mudou"));
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
