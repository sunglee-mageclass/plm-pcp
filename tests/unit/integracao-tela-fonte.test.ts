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

// revisão T15 #1 (code-review I1, "wrong-store save"): render de verdade de `IntegracaoPage` provando o remonte
// por `key={tenantId}` — trocar de loja com uma aba suja NUNCA deixa o rascunho vivo, mesmo que o super admin
// cancele o "Descartar alterações?" da guarda de navegação (aqui simulado deixando o `useBlocker` sempre "idle",
// ou seja, a troca de tenant NÃO passa pela navegação de rota — é só a mudança do `tenantId`, exatamente como o
// `TenantSwitcher` faz: server primeiro, e o React re-renderiza com o novo tenantId antes do `navigate`).
describe("IntegracaoPage — trocar de loja remonta a aba (key={tenantId}) e avisa se havia algo sujo", () => {
  async function montar(opts: { tenantIdRef: { current: string } }) {
    vi.resetModules();
    vi.doMock("@/hooks/useActiveTenantId", () => ({ useActiveTenantId: () => opts.tenantIdRef.current }));
    // revisão T15 (n2, code-review "Re-check round 1"): `navPermitida` de `IntegracaoPage` agora lê
    // `qc.getQueryData(["active-tenant-id", user.id])` diretamente — precisa de um `user.id` estável.
    vi.doMock("@/hooks/useAuth", () => ({ useAuth: () => ({ isSuperAdmin: true, user: { id: "u1" } }) }));
    const toastMocks = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() };
    vi.doMock("sonner", () => ({ toast: toastMocks }));
    const blockerProceedSpy = vi.fn();
    const blockerResetSpy = vi.fn();
    // Fake `useBlocker` fiel ao suficiente pro que `useUnsavedGuard` usa dele: nunca fica "blocked" sozinho (o
    // teste chama `shouldBlockFn` MANUALMENTE, ver abaixo) — só GUARDA a última função recebida, pra simular a
    // corrida real: o router chama `shouldBlockFn` no INSTANTE do `navigate()` do TenantSwitcher, ANTES do React
    // re-renderizar `IntegracaoPage` com o `tenantId` novo (o `refetchQueries` do TanStack Query só propaga pro
    // React num tick seguinte — `notifyManager` agenda via `setTimeout(0)`). Capturar a função e chamá-la
    // manualmente, ainda com o `tenantId`/`dirty` ANTIGOS na clausura, reproduz esse instante fielmente.
    let shouldBlockCapturado: ((a: { next: { pathname: string } }) => boolean) | null = null;
    const blockerImpl = (args: { shouldBlockFn?: (a: { next: { pathname: string } }) => boolean }) => {
      shouldBlockCapturado = args.shouldBlockFn ?? null;
      return { status: "idle" as const, proceed: blockerProceedSpy, reset: blockerResetSpy };
    };
    vi.doMock("@tanstack/react-router", () => ({
      useBlocker: blockerImpl,
    }));
    const { createElement, useState } = await import("react");
    const { act } = await import("react");
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    const { useAbaSuja } = await import("@/components/integracao/guard");
    const { useActiveTenantId } = await import("@/hooks/useActiveTenantId");
    // Stub das 3 abas reais: cada uma só expõe um botão "sujar"/"limpar" que chama `useAbaSuja`, e mostra o
    // tenantId ATUAL que recebeu — prova direta de que o remonte por `key` reinicia o estado local (o stub nunca
    // guardaria "sujo" de uma montagem pra outra sozinho; só reflete o que ESTA instância fez).
    function ProdutosAbaStub() {
      const [sujo, setSujo] = useState(false);
      useAbaSuja("produtos", sujo);
      return createElement(
        "div", null,
        `tenant:${useActiveTenantId()}`,
        // revisão T15 (n2, code-review "Re-check round 1" — "a prova não trava o `key`"): expõe o PRÓPRIO estado
        // `sujo` no texto — sem isto, o teste só provava que o toast disparou (que também dispararia se `sujas`
        // fosse zerado por FORA, sem nenhum remonte de verdade). Com `sujo:${sujo}` no DOM, sabotar o
        // `key={tenantId}` de `IntegracaoPage.tsx` (removê-lo) faz esta MESMA instância de `ProdutosAbaStub`
        // sobreviver à troca de tenant com seu PRÓPRIO estado local `sujo=true` intocado — o texto continuaria
        // "sujo:true" mesmo depois da troca, e o teste vira RED (ver a sabotagem verificada no report).
        `sujo:${sujo}`,
        createElement("button", { onClick: () => setSujo(true) }, "sujar-produtos"),
      );
    }
    // revisão T15 (n1, code-review "Re-check round 1"): stub de `ApiAba` que só expõe o botão pra reportar uma
    // chave VISÍVEL (via `informarChaveVisivel`, o canal PARALELO da guarda) — prova que `IntegracaoPage` escolhe
    // o toast ESPECÍFICO (chave não copiada) em vez do genérico quando esse sinal está `true` no momento da troca.
    const { useContext, useEffect } = await import("react");
    const { GuardaIntegracaoContext } = await import("@/components/integracao/guard");
    function ApiAbaStub() {
      const ctx = useContext(GuardaIntegracaoContext);
      const [chaveVisivel, setChaveVisivel] = useState(false);
      // Espelha o `ApiAba` real: `chaveVisivel` soma na guarda de "sujo" DA ABA (bloqueia navegação) e É reportado
      // no canal paralelo `informarChaveVisivel` (o sinal que `IntegracaoPage` usa pra escolher o toast certo).
      useAbaSuja("api", chaveVisivel);
      // revisão T15 (n1-R, code-review "Re-check round 2"): espelha a MESMA armadilha que a v1 real de `ApiAba.tsx`
      // tinha — um cleanup de DESMONTE que chama `informarChaveVisivel(false)`. No `key={tenantId}` remount, React
      // desmonta esta subárvore (cleanups incluídos) ANTES do efeito `[tenantId]` do PAI rodar — sem o fix, este
      // cleanup zera `chaveVisivelRef.current` um instante ANTES do pai ler "havia uma chave visível", e o toast
      // específico nunca dispara. Sem esta linha, o stub nunca reproduziria o bug (só o "informarChaveVisivel(true)"
      // no clique, nunca o "false" do desmonte) e o teste "n1" ficaria verde mesmo com a v1 real quebrada.
      useEffect(() => () => ctx?.informarChaveVisivel?.(false), [ctx]);
      return createElement(
        "button",
        {
          onClick: () => {
            setChaveVisivel(true);
            ctx?.informarChaveVisivel?.(true);
          },
        },
        "marcar-chave-visivel-api",
      );
    }
    vi.doMock("@/components/integracao/ProdutosAba", () => ({ ProdutosAba: ProdutosAbaStub }));
    vi.doMock("@/components/integracao/CamposAba", () => ({ CamposAba: () => null }));
    vi.doMock("@/components/integracao/ApiAba", () => ({ ApiAba: ApiAbaStub }));
    const { createRoot } = await import("react-dom/client");
    const { SidebarProvider } = await import("@/components/ui/sidebar");
    const { IntegracaoPage } = await import("@/components/integracao/IntegracaoPage");
    // `vi.doMock` registra o mock pro resto do ARQUIVO de teste, não só pro `vi.resetModules()` seguinte — sem
    // desfazer aqui, os stubs de ProdutosAba/CamposAba/ApiAba vazariam pros testes de `ProdutosAba` mais abaixo
    // no mesmo arquivo (que fazem seu PRÓPRIO `vi.resetModules()` + import dinâmico, mas herdariam este mock
    // registrado). `IntegracaoPage` já capturou a versão mockada no import acima; desmockar agora não afeta
    // MAIS nada desta montagem, só evita vazar pros testes seguintes.
    vi.doUnmock("@/components/integracao/ProdutosAba");
    vi.doUnmock("@/components/integracao/CamposAba");
    vi.doUnmock("@/components/integracao/ApiAba");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const arvore = () => createElement(QueryClientProvider, { client: qc }, createElement(SidebarProvider, null, createElement(IntegracaoPage)));
    await act(async () => { root.render(arvore()); });
    return {
      container, toastMocks, blockerProceedSpy, blockerResetSpy, qc,
      // Chama a função `shouldBlockFn` mais recente que o `useBlocker` recebeu (ver o comentário do `blockerImpl`
      // acima) — simula o router checando "posso navegar?" no instante exato do clique/promise-chain.
      shouldBlockAgora: (next: { pathname: string } = { pathname: "/home" }) => !!shouldBlockCapturado?.({ next }),
      rerender: () => act(async () => { root.render(arvore()); }),
      desmontar: () => act(async () => { root.unmount(); container.remove(); }),
    };
  }

  it("trocar de tenant com a aba suja remonta (some o 'sujo') e mostra o toast de aviso", async () => {
    const tenantIdRef = { current: "lojaA" };
    const view = await montar({ tenantIdRef });
    expect(view.container.textContent).toContain("tenant:lojaA");
    expect(view.container.textContent).toContain("sujo:false");
    const botaoSujar = () => Array.from(view.container.querySelectorAll("button")).find((b) => b.textContent === "sujar-produtos") as HTMLButtonElement;
    const { act } = await import("react");
    await act(async () => { botaoSujar().click(); });
    expect(view.container.textContent).toContain("sujo:true");
    // Troca de loja (o TenantSwitcher já mudou no servidor — aqui só o tenantId ativo muda).
    tenantIdRef.current = "lojaB";
    await view.rerender();
    expect(view.container.textContent).toContain("tenant:lojaB");
    // revisão T15 (n2, code-review "Re-check round 1"): a prova de que isto é um REMONTE de verdade (`key=
    // {tenantId}`), não só um `informarSujo(false)` disparado de fora — a MESMA instância de `ProdutosAbaStub`
    // teria mantido `sujo=true` no seu PRÓPRIO estado local se não tivesse sido desmontada/recriada. Sabotagem
    // verificada (remover `key={tenantId}` de `IntegracaoPage.tsx`): esta asserção vira RED (o texto continua
    // "sujo:true"), enquanto as duas de baixo (toast/tenant) continuavam GREEN sem o `key` — prova que elas
    // sozinhas não travavam a regressão.
    expect(view.container.textContent).toContain("sujo:false");
    // O toast de aviso apareceu — havia algo sujo no momento da troca.
    expect(view.toastMocks.warning).toHaveBeenCalledWith("A loja mudou — as alterações não salvas da loja anterior foram descartadas.");
    await view.desmontar();
  });

  it("trocar de tenant SEM nada sujo não mostra nenhum toast", async () => {
    const tenantIdRef = { current: "lojaA" };
    const view = await montar({ tenantIdRef });
    tenantIdRef.current = "lojaB";
    await view.rerender();
    expect(view.toastMocks.warning).not.toHaveBeenCalled();
    await view.desmontar();
  });

  // revisão T15 (n1, code-review "Re-check round 1"): quando o motivo do "sujo" era ESPECIFICAMENTE uma chave nova
  // ainda VISÍVEL (não copiada) na aba API, o toast tem que avisar que ela CONTINUA ATIVA (não foi perdida, só o
  // texto claro nunca mais aparece) — texto diferente do genérico "alterações descartadas".
  it("n1: chave nova visível (não copiada) na aba API — toast ESPECÍFICO ao trocar de loja (a chave continua ativa)", async () => {
    const tenantIdRef = { current: "lojaA" };
    const view = await montar({ tenantIdRef });
    const { act } = await import("react");
    // O `TabsContent` do Radix só MONTA o conteúdo da aba ATIVA (sem `forceMount`) — a aba "API" começa
    // desmontada (a página abre em "Produtos"). Clica na aba API primeiro pra montar o `ApiAbaStub`.
    const abaApi = Array.from(view.container.querySelectorAll('button[role="tab"]')).find((b) => b.textContent === "API") as HTMLButtonElement;
    await act(async () => {
      abaApi.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
      await new Promise((r) => setTimeout(r, 10));
    });
    const botaoMarcar = () => Array.from(view.container.querySelectorAll("button")).find((b) => b.textContent === "marcar-chave-visivel-api") as HTMLButtonElement | undefined;
    expect(botaoMarcar()).toBeDefined();
    await act(async () => { botaoMarcar()!.click(); });
    tenantIdRef.current = "lojaB";
    await view.rerender();
    expect(view.toastMocks.warning).toHaveBeenCalledWith(
      "A chave nova não foi copiada e a loja mudou — ela continua ATIVA; revogue-a na aba API da loja anterior se não for usá-la.",
    );
    // NUNCA o genérico junto (só UM toast — o específico).
    expect(view.toastMocks.warning).not.toHaveBeenCalledWith("A loja mudou — as alterações não salvas da loja anterior foram descartadas.");
    await view.desmontar();
  });

  // revisão T15 (n2, code-review "Re-check round 1"): antes, uma troca de loja com a aba suja podia mostrar OS
  // DOIS avisos — o "Descartar alterações?" (via useBlocker, se uma navegação de rota estivesse em voo) E o toast
  // do efeito de troca de tenant. Escolha do coordenador: UM caminho só — o remonte + toast já são a confirmação;
  // `navPermitida` lê `qc.getQueryData(["active-tenant-id", uid])` DIRETO do cache (não do hook `tenantId`, que só
  // se atualiza num tick seguinte) — se o cache já diverge do `tenantId` que esta render capturou, a troca já
  // aconteceu de verdade e a navegação passa sem o AlertDialog.
  it("n2: com o cache de active-tenant-id JÁ divergindo (simula o refetchQueries do TenantSwitcher, ANTES do tenant novo re-renderizar), o shouldBlockFn NÃO bloqueia", async () => {
    const tenantIdRef = { current: "lojaA" };
    const view = await montar({ tenantIdRef });
    const botaoSujar = () => Array.from(view.container.querySelectorAll("button")).find((b) => b.textContent === "sujar-produtos") as HTMLButtonElement;
    const { act } = await import("react");
    await act(async () => { botaoSujar().click(); });
    // Simula exatamente o instante em que o `TenantSwitcher` chama `navigate()`: o `await
    // qc.refetchQueries({queryKey:["active-tenant-id"]})` dele JÁ escreveu "lojaB" no cache — mas o `tenantId`
    // desta render de `IntegracaoPage` (via hook) ainda é "lojaA" (a notificação do TanStack Query aos observers
    // só chega num tick seguinte). `shouldBlockAgora()` chama a MESMA `shouldBlockFn` capturada na última render,
    // reproduzindo a corrida.
    view.qc.setQueryData(["active-tenant-id", "u1"], "lojaB");
    // Sem o fix, `navPermitida` sempre devolveria `false` aqui (nada divergia do que ele checava) e `shouldBlockFn`
    // bloquearia — o AlertDialog "Descartar alterações?" apareceria por cima do toast que o efeito de troca de
    // tenant mostra alguns instantes depois.
    expect(view.shouldBlockAgora()).toBe(false);
    await view.desmontar();
  });

  // Sabotagem-prova do n2: SEM o cache divergir (o comportamento de QUALQUER outra navegação — Voltar, trocar de
  // item de menu, nada que mude `active-tenant-id`), a MESMA checagem CONTINUA bloqueando — prova que o teste
  // acima de fato depende do fix (`navPermitida`), não é um falso-positivo que sempre passaria.
  it("n2 (sabotagem-prova): SEM o cache divergir, o MESMO shouldBlockFn bloqueia normalmente (dirty=true)", async () => {
    const tenantIdRef = { current: "lojaA" };
    const view = await montar({ tenantIdRef });
    const botaoSujar = () => Array.from(view.container.querySelectorAll("button")).find((b) => b.textContent === "sujar-produtos") as HTMLButtonElement;
    const { act } = await import("react");
    await act(async () => { botaoSujar().click(); });
    // Nenhuma mudança no cache — uma navegação comum (Voltar, menu) continua bloqueada normalmente.
    expect(view.shouldBlockAgora()).toBe(true);
    await view.desmontar();
  });

  // revisão T15 (n2-R, code-review "Re-check round 2"): numa troca de loja NA MESMA ABA, a navegação que segue
  // (`navigate({to:"/home"})` do TenantSwitcher) pode DESMONTAR `IntegracaoPage` antes que o efeito `[tenantId]`
  // rode (ex.: a rota de destino não é mais `/integracao`) — o toast de descarte, que antes só disparava DAQUELE
  // efeito, nunca aparecia nesse caso. Fix: `navPermitida` também dispara o aviso, no MESMO instante em que
  // detecta que a troca já aconteceu de verdade — ANTES de qualquer desmonte que a navegação possa causar.
  it("n2-R: o toast de descarte dispara a partir de navPermitida, mesmo se a página desmontar ANTES do efeito [tenantId] rodar", async () => {
    const tenantIdRef = { current: "lojaA" };
    const view = await montar({ tenantIdRef });
    const botaoSujar = () => Array.from(view.container.querySelectorAll("button")).find((b) => b.textContent === "sujar-produtos") as HTMLButtonElement;
    const { act } = await import("react");
    await act(async () => { botaoSujar().click(); });
    // Simula o cache já divergindo (o `refetchQueries` do TenantSwitcher já rodou) — `shouldBlockAgora()` chama
    // `navPermitida`, que detecta a troca e (com o fix) já dispara o toast aqui mesmo, síncrono, ANTES de
    // qualquer `rerender()`/efeito rodar.
    view.qc.setQueryData(["active-tenant-id", "u1"], "lojaB");
    expect(view.shouldBlockAgora()).toBe(false);
    // Desmonta DIRETO — nunca chama `view.rerender()` com o tenantId novo, simulando a navegação tirando
    // `IntegracaoPage` da árvore antes do efeito `[tenantId]` ter qualquer chance de rodar.
    expect(view.toastMocks.warning).toHaveBeenCalledWith("A loja mudou — as alterações não salvas da loja anterior foram descartadas.");
    expect(view.toastMocks.warning).toHaveBeenCalledTimes(1);
    await view.desmontar();
  });

  // revisão T15 (n2-R): garante EXATAMENTE UM toast quando a página NÃO desmonta (o caminho mais comum — só a
  // troca de tenant, sem navegação de rota bloqueada) — `navPermitida` nunca roda nesse cenário (não há
  // `shouldBlockFn` sendo chamado), então só o efeito `[tenantId]` dispara; o `avisadoRef` não deveria fazer
  // diferença aqui, mas prova que a mudança não introduziu um SEGUNDO toast por outro caminho.
  it("n2-R: continua exatamente UM toast quando a página NÃO desmonta (troca de tenant sem bloquear navegação)", async () => {
    const tenantIdRef = { current: "lojaA" };
    const view = await montar({ tenantIdRef });
    const botaoSujar = () => Array.from(view.container.querySelectorAll("button")).find((b) => b.textContent === "sujar-produtos") as HTMLButtonElement;
    const { act } = await import("react");
    await act(async () => { botaoSujar().click(); });
    tenantIdRef.current = "lojaB";
    await view.rerender();
    expect(view.toastMocks.warning).toHaveBeenCalledTimes(1);
    expect(view.toastMocks.warning).toHaveBeenCalledWith("A loja mudou — as alterações não salvas da loja anterior foram descartadas.");
    await view.desmontar();
  });

  // Fix round 4 T15 (N-1, code-review "Re-check round 3"): `useActiveTenantId` devolve "" quando a releitura de
  // `active-tenant-id` FALHA (ex.: refetch de `visibilitychange` com a rede ainda caída — o hook engole o erro e
  // assenta ""). Antes do fix, o `key={tenantId}` ia X → "" e remontava TODAS as abas (rascunhos perdidos) com um
  // toast FALSO de "a loja mudou". "" transitório não é troca de loja: nada remonta, nada avisa.
  it("N-1: loja '' transitória (releitura falhou) NÃO remonta nem avisa — o rascunho continua e segue intacto quando a MESMA loja volta", async () => {
    const tenantIdRef = { current: "lojaA" };
    const view = await montar({ tenantIdRef });
    const botaoSujar = () => Array.from(view.container.querySelectorAll("button")).find((b) => b.textContent === "sujar-produtos") as HTMLButtonElement;
    const { act } = await import("react");
    await act(async () => { botaoSujar().click(); });
    expect(view.container.textContent).toContain("sujo:true");
    tenantIdRef.current = "";
    await view.rerender();
    // Mesma instância da aba (o stub lê o tenant cru do hook — mostra "" —, mas o PRÓPRIO estado local sobreviveu).
    expect(view.container.textContent).toContain("tenant:sujo:true");
    expect(view.toastMocks.warning).not.toHaveBeenCalled();
    // A guarda de navegação continua valendo durante o "" (o rascunho existe).
    expect(view.shouldBlockAgora()).toBe(true);
    tenantIdRef.current = "lojaA";
    await view.rerender();
    expect(view.container.textContent).toContain("tenant:lojaAsujo:true");
    expect(view.toastMocks.warning).not.toHaveBeenCalled();
    await view.desmontar();
  });

  it("N-1: sujo → '' → OUTRA loja: descarta (remonta) e avisa UMA vez só", async () => {
    const tenantIdRef = { current: "lojaA" };
    const view = await montar({ tenantIdRef });
    const botaoSujar = () => Array.from(view.container.querySelectorAll("button")).find((b) => b.textContent === "sujar-produtos") as HTMLButtonElement;
    const { act } = await import("react");
    await act(async () => { botaoSujar().click(); });
    tenantIdRef.current = "";
    await view.rerender();
    expect(view.container.textContent).toContain("sujo:true");
    expect(view.toastMocks.warning).not.toHaveBeenCalled();
    tenantIdRef.current = "lojaB";
    await view.rerender();
    expect(view.container.textContent).toContain("tenant:lojaBsujo:false");
    expect(view.toastMocks.warning).toHaveBeenCalledTimes(1);
    expect(view.toastMocks.warning).toHaveBeenCalledWith("A loja mudou — as alterações não salvas da loja anterior foram descartadas.");
    await view.desmontar();
  });

  // N-1 (2º sintoma, no `navPermitida`): com a página ainda renderizada em "" e o cache JÁ de volta à MESMA loja
  // (a releitura seguinte deu certo, a notificação ao React ainda não chegou), uma navegação nesse instante não
  // pode ser tratada como "a loja mudou" — seria um toast falso E a navegação passaria sem o "Descartar
  // alterações?", perdendo o rascunho. A comparação é com a última loja NÃO vazia, não com o "" do render.
  it("N-1: com a página em '' e o cache de volta à MESMA loja, navPermitida não vê troca — sem toast e a navegação continua bloqueada", async () => {
    const tenantIdRef = { current: "lojaA" };
    const view = await montar({ tenantIdRef });
    const botaoSujar = () => Array.from(view.container.querySelectorAll("button")).find((b) => b.textContent === "sujar-produtos") as HTMLButtonElement;
    const { act } = await import("react");
    await act(async () => { botaoSujar().click(); });
    tenantIdRef.current = "";
    await view.rerender();
    view.qc.setQueryData(["active-tenant-id", "u1"], "lojaA");
    expect(view.shouldBlockAgora()).toBe(true);
    expect(view.toastMocks.warning).not.toHaveBeenCalled();
    expect(view.container.textContent).toContain("sujo:true");
    await view.desmontar();
  });

  // Lacuna 1 do "Re-check round 3" + N-1: o caminho COMBINADO — `navPermitida` avisa (cache já na loja nova) e
  // DEPOIS a página, ainda montada, re-renderiza com a loja nova. Tem que continuar 1 toast só (`avisadoRef`).
  // Passa por um "" transitório antes, que não pode contar como troca nem gastar o aviso.
  it("N-1 + caminho combinado: '' transitório, depois navPermitida avisa e a página re-renderiza com a loja nova — 1 toast só", async () => {
    const tenantIdRef = { current: "lojaA" };
    const view = await montar({ tenantIdRef });
    const botaoSujar = () => Array.from(view.container.querySelectorAll("button")).find((b) => b.textContent === "sujar-produtos") as HTMLButtonElement;
    const { act } = await import("react");
    await act(async () => { botaoSujar().click(); });
    tenantIdRef.current = "";
    await view.rerender();
    expect(view.toastMocks.warning).not.toHaveBeenCalled();
    expect(view.container.textContent).toContain("sujo:true");
    view.qc.setQueryData(["active-tenant-id", "u1"], "lojaB");
    expect(view.shouldBlockAgora()).toBe(false);
    expect(view.toastMocks.warning).toHaveBeenCalledTimes(1);
    tenantIdRef.current = "lojaB";
    await view.rerender();
    expect(view.container.textContent).toContain("tenant:lojaBsujo:false");
    expect(view.toastMocks.warning).toHaveBeenCalledTimes(1);
    expect(view.toastMocks.warning).toHaveBeenCalledWith("A loja mudou — as alterações não salvas da loja anterior foram descartadas.");
    await view.desmontar();
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

// revisão T15 #I1-R (code-review "Re-check round 1"): `useSalvarIntegracao` (o REAL, não mockado — mesmo padrão
// "Sonda" de `usePreviasSkus` acima) recusa o Salvar de Produtos quando `confirmarLojaAtiva` diz que a loja
// mudou — prova que a RPC `integracao_salvar` NUNCA é chamada nesse caso.
describe("useIntegracao — useSalvarIntegracao recusa quando confirmarLojaAtiva reprova (I1-R)", () => {
  // Fix round 3 T15 (m-R2, code-review "Re-check round 2"): `confirmarLojaAtiva` mudou de `getUser()` (chamada de
  // REDE pra revalidar o token) para `getSession()` (sem rede — lê o token já em memória/localStorage) + UMA
  // query só (`users.select("tenant_id, tenants(nome)")`, embed FK) — era `getUser()` + 1 query. `erroUsers`/
  // `erroSessao` permitem simular m-R1 (erro de rede/sessão RELANÇADO, nunca virando LOJA_MUDOU).
  async function montarSalvarSonda(opts: {
    confirmarLojaAtivaFalha?: boolean;
    erroSessao?: unknown;
    erroUsers?: unknown;
    semSessao?: boolean;
  }) {
    vi.resetModules();
    vi.doMock("@/hooks/useActiveTenantId", () => ({ useActiveTenantId: () => "t1" }));
    // `confirmarLojaAtiva` (a função REAL, não mockada) relê `supabase.auth.getSession()` + `users.tenant_id`
    // DIRETO — controla o resultado dela pelo MESMO client mockado que `useSalvarIntegracao` usa (não dá pra
    // espionar a função em si: o `mutationFn` chama o binding local do módulo, que o live-binding do ESM não
    // roteia através de `vi.spyOn(modulo, "confirmarLojaAtiva")` pra chamadas internas do MESMO módulo).
    const rpcSpy = vi.fn(async () => ({ data: { salvos: 0, revs: {} }, error: null }));
    const getSessionSpy = vi.fn(async () => {
      if (opts.erroSessao) return { data: { session: null }, error: opts.erroSessao };
      if (opts.semSessao) return { data: { session: null }, error: null };
      return { data: { session: { user: { id: "u1" } } }, error: null };
    });
    const fromSpy = vi.fn((tabela: string) => {
      if (tabela === "users") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => {
                if (opts.erroUsers) return { data: null, error: opts.erroUsers };
                return { data: { tenant_id: opts.confirmarLojaAtivaFalha ? "OUTRA_LOJA" : "t1", tenants: { nome: "Loja Teste" } }, error: null };
              },
            }),
          }),
        };
      }
      throw new Error(`tabela não mockada: ${tabela}`);
    });
    vi.doMock("@/integrations/supabase/client", () => ({
      supabase: {
        rpc: rpcSpy,
        auth: { getSession: getSessionSpy },
        from: fromSpy,
      },
    }));
    const { createElement, useState } = await import("react");
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    const { useSalvarIntegracao } = await import("@/components/integracao/useIntegracao");
    function Sonda() {
      const salvar = useSalvarIntegracao();
      const [resultado, setResultado] = useState<{ ok: boolean; erro?: string; code?: string } | null>(null);
      return createElement(
        "div", null,
        createElement("button", {
          onClick: () => {
            salvar.mutate([], {
              onSuccess: () => setResultado({ ok: true }),
              onError: (e: unknown) => setResultado({ ok: false, erro: (e as Error).message, code: (e as { code?: string })?.code }),
            });
          },
        }, "salvar-produtos"),
        resultado ? createElement("div", null, resultado.ok ? "sucesso" : `erro:${resultado.erro}|code:${resultado.code ?? ""}`) : null,
      );
    }
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => { root.render(createElement(QueryClientProvider, { client: qc }, createElement(Sonda))); });
    return {
      container, rpcSpy, fromSpy, getSessionSpy,
      clicarSalvar: () => act(async () => {
        const btn = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "salvar-produtos") as HTMLButtonElement;
        btn.click();
        await new Promise((r) => setTimeout(r, 10));
      }),
      desmontar: () => act(async () => { root.unmount(); container.remove(); }),
    };
  }

  it("I1-R: confirmarLojaAtiva reprovando (servidor já noutra loja) bloqueia o Salvar de Produtos — integracao_salvar NUNCA é chamada", async () => {
    const view = await montarSalvarSonda({ confirmarLojaAtivaFalha: true });
    await view.clicarSalvar();
    expect(view.fromSpy).toHaveBeenCalledWith("users"); // confirmarLojaAtiva de fato releu o servidor
    expect(view.rpcSpy.mock.calls.some((c) => c[0] === "integracao_salvar")).toBe(false);
    expect(view.container.textContent).toContain("erro:A loja ativa mudou (em outra aba ou janela). Recarregue a página antes de salvar.|code:LOJA_MUDOU");
    await view.desmontar();
  });

  // revisão T15 (m-R1, code-review "Re-check round 2"): um erro de REDE/sessão na query em si (não "sem sessão
  // nenhuma", mas uma falha ao TENTAR ler) tem que RELANÇAR verbatim — nunca virar LOJA_MUDOU, que esconderia a
  // causa real atrás de uma mensagem falsa ("a loja mudou" quando na verdade a rede caiu).
  it("m-R1: erro de rede/sessão na query users é RELANÇADO verbatim — nunca vira LOJA_MUDOU", async () => {
    const erroDeRede = Object.assign(new Error("Failed to fetch"), { code: "" });
    const view = await montarSalvarSonda({ erroUsers: erroDeRede });
    await view.clicarSalvar();
    expect(view.rpcSpy.mock.calls.some((c) => c[0] === "integracao_salvar")).toBe(false);
    // `mensagemErro` traduz "Failed to fetch" pra "Falha de conexão..." (traduzPadrao) — nunca a mensagem de
    // LOJA_MUDOU, e o `code` nunca é "LOJA_MUDOU".
    expect(view.container.textContent).not.toContain("A loja ativa mudou");
    expect(view.container.textContent).not.toContain("code:LOJA_MUDOU");
    await view.desmontar();
  });

  // revisão T15 (m-R1): idem para um erro na PRÓPRIA leitura de sessão (`getSession()` — não deveria fazer
  // chamada de rede de verdade, mas o client pode devolver um erro mesmo assim, ex.: storage corrompido).
  it("m-R1: erro em getSession() é RELANÇADO verbatim — nunca vira LOJA_MUDOU", async () => {
    const erroSessao = Object.assign(new Error("storage indisponível"), { code: "" });
    const view = await montarSalvarSonda({ erroSessao });
    await view.clicarSalvar();
    expect(view.rpcSpy.mock.calls.some((c) => c[0] === "integracao_salvar")).toBe(false);
    expect(view.container.textContent).not.toContain("A loja ativa mudou");
    expect(view.container.textContent).not.toContain("code:LOJA_MUDOU");
    await view.desmontar();
  });

  // Fix round 4 T15 (m-R3, code-review "Re-check round 3"): sessão AUSENTE (`getSession()` sem sessão e sem erro —
  // um refresh em segundo plano já falhou e o auth-js removeu a sessão, ou o usuário saiu noutra aba) é SESSÃO
  // EXPIRADA, não "a loja mudou": a v1 mandava recarregar a página por um motivo falso. Nada é gravado nos dois
  // casos; só a mensagem muda. A tela mostra o texto por `mensagemErro` (o mesmo caminho dos toasts reais).
  it("m-R3: sem sessão nenhuma (sem erro) vira SESSÃO EXPIRADA — nunca LOJA_MUDOU; nada é gravado", async () => {
    const view = await montarSalvarSonda({ semSessao: true });
    await view.clicarSalvar();
    expect(view.rpcSpy.mock.calls.some((c) => c[0] === "integracao_salvar")).toBe(false);
    expect(view.fromSpy).not.toHaveBeenCalled(); // sem sessão, nem chega a ler `users`
    expect(view.container.textContent).toContain("erro:Sua sessão expirou. Entre de novo.|code:SESSAO_EXPIRADA");
    expect(view.container.textContent).not.toContain("A loja ativa mudou");
    expect(view.container.textContent).not.toContain("code:LOJA_MUDOU");
    await view.desmontar();
  });

  it("m-R3: o erro de sessão ausente chega ao usuário, via mensagemErro, como o texto de sessão expirada", async () => {
    vi.resetModules();
    vi.doMock("@/integrations/supabase/client", () => ({
      supabase: { auth: { getSession: async () => ({ data: { session: null }, error: null }) }, from: vi.fn() },
    }));
    const { confirmarLojaAtiva, TEXTO_SESSAO_EXPIRADA } = await import("@/components/integracao/useIntegracao");
    const { mensagemErro } = await import("@/lib/erro-mensagem");
    const erro = await confirmarLojaAtiva("t1").then(() => null, (e: unknown) => e);
    expect(erro).toMatchObject({ code: "SESSAO_EXPIRADA", message: "Sua sessão expirou. Entre de novo." });
    expect(TEXTO_SESSAO_EXPIRADA).toBe("Sua sessão expirou. Entre de novo.");
    expect(mensagemErro(erro, "Não foi possível salvar.")).toBe("Sua sessão expirou. Entre de novo.");
    vi.doUnmock("@/integrations/supabase/client");
  });

  // revisão T15 (m-R2, code-review "Re-check round 2"): UMA ida ao servidor — `getSession()` NUNCA faz rede
  // (só lê o token local), e só HÁ UMA chamada de `from("users")` (nunca uma 2ª pra "tenants" — o nome vem por
  // EMBED na mesma query, não por uma leitura separada como a v1/fix round 2 fazia com `nomeLojaAtivaFresco`).
  it("m-R2: confirmarLojaAtiva faz UMA única ida ao servidor (1 chamada a from('users'), nenhuma a from('tenants'))", async () => {
    const view = await montarSalvarSonda({ confirmarLojaAtivaFalha: false });
    await view.clicarSalvar();
    expect(view.fromSpy).toHaveBeenCalledTimes(1);
    expect(view.fromSpy).toHaveBeenCalledWith("users");
    expect(view.fromSpy.mock.calls.some((c) => c[0] === "tenants")).toBe(false);
    await view.desmontar();
  });

  it("confirmarLojaAtiva aprovando (loja não mudou) deixa o Salvar seguir normalmente", async () => {
    const view = await montarSalvarSonda({ confirmarLojaAtivaFalha: false });
    await view.clicarSalvar();
    expect(view.fromSpy).toHaveBeenCalledWith("users");
    // Com 0 rascunhos, `salvarIntegracao` nunca chega a chamar `integracao_salvar` (nada a salvar) — a prova aqui
    // é que a mutation teve SUCESSO (não caiu no branch de erro do LOJA_MUDOU).
    expect(view.container.textContent).toContain("sucesso");
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
    // Task 13: `IntegrarDialog`/`VoltarDialog`/`DesfazerDialog` chamam `supabase.rpc` DIRETO (não passam por
    // `useIntegracao.ts`, que esta suíte já mocka por inteiro) — precisa de um mock PRÓPRIO do client. Default
    // recusa qualquer RPC não esperada (erro claro em vez de um `undefined.data` silencioso caso um teste esqueça
    // de passar `rpcImpl`).
    rpcImpl?: (nome: string, args: unknown) => Promise<{ data: unknown; error: unknown }>;
  }) {
    vi.resetModules();
    const { lerLista } = await import("@/lib/integracao/produtos");
    const salvarSpy = vi.fn(opts.salvarImpl ?? (async () => ({ salvos: 1, revs: {}, fotos: {}, skusOk: [], skusFalhas: [] })));
    const rpcSpy = vi.fn(
      opts.rpcImpl ?? (async (nome: string) => ({ data: null, error: new Error(`RPC não mockada no teste: ${nome}`) })),
    );
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
    vi.doMock("@/integrations/supabase/client", () => ({ supabase: { rpc: rpcSpy } }));
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
    // n3 (fix round 2 T13, revisão T13 #15, task-13-review.md "Re-review round 1"): virou `vi.fn()` (era
    // `() => {}`) — os diálogos (`VoltarDialog`/`DesfazerDialog`/`IntegrarDialog`) importam `invalidarIntegracao`
    // deste MESMO módulo mockado; sem o spy, nenhum teste consegue provar que a invalidação de fato aconteceu
    // (só o toast/a contagem de chamada de RPC), então o texto "e invalida a lista" no título de um teste não
    // tinha nenhuma asserção correspondente. Exposto no retorno como `invalidarIntegracaoSpy`.
    const invalidarIntegracaoSpy = vi.fn();
    // revisão T15 #I1-R (code-review "Re-check round 1"): `IntegrarDialog`/`VoltarDialog`/`DesfazerDialog`/
    // `KeywordsDialog` importam `confirmarLojaAtiva` DIRETO deste módulo (mockado por inteiro aqui) — sem o
    // export, a chamada real quebraria com "confirmarLojaAtiva is not a function". Resolve como se a loja NÃO
    // tivesse mudado (não é o alvo desta suíte; os testes de `confirmarLojaAtiva` propriamente moram nos arquivos
    // de cada aba, ver integracao-api-tela.test.ts/integracao-campos-config.test.ts).
    const confirmarLojaAtivaSpy = vi.fn(async () => {});
    vi.doMock("@/components/integracao/useIntegracao", () => ({
      chaveLista: (tenantId: string) => ["integracao-lista", tenantId],
      confirmarLojaAtiva: confirmarLojaAtivaSpy,
      useIntegracaoLista: (_situacao: unknown, _filtros: unknown, pagina: number) => {
        paginasChamadas.push(pagina);
        return { data: listaRef.current, isError: false, error: null, refetch: () => {}, dataUpdatedAt: dataUpdatedAtRef.current };
      },
      useIntegracaoAoVivo: () => {},
      usePreviasSkus: () => ({}),
      invalidarIntegracao: invalidarIntegracaoSpy,
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
      // Fix round 1 T13 (revisão T13 #13): variante de `atualizarLista` que recebe uma `ListaIntegracao` JÁ
      // PRONTA (não o jsonb cru) — usada quando o teste precisa controlar a IDENTIDADE de objeto de produtos
      // individuais dentro de `produtos` (simulando o `structuralSharing` real do TanStack, que este harness
      // mockado não reproduz sozinho porque não há fetch real por baixo).
      atualizarListaPronta: (nova: ReturnType<typeof lerLista>) => {
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
      // Fix round 4 T15 (N-1): a releitura de `active-tenant-id` FALHOU e o hook assentou "" — a query da lista fica
      // desabilitada (sem dado) até a próxima releitura dar certo. Não é troca de loja.
      tenantVazio: () => {
        tenantIdRef.current = "";
        listaRef.current = undefined;
        dataUpdatedAtRef.current += 1;
        rerenderTrigger();
      },
      salvarSpy,
      rpcSpy,
      invalidarIntegracaoSpy,
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

  // Fix round 4 T15 (N-1, code-review "Re-check round 3"): o remonte por loja da PÁGINA ignora o "" transitório,
  // mas `ProdutosAba` tem o PRÓPRIO reset por `tenantId` (m4, acima) — sem tratar o "" aqui também, uma releitura
  // de `active-tenant-id` que falha (o hook assenta "") zerava os rascunhos de Produtos do mesmo jeito. Prova com o
  // componente REAL: rascunho → loja "" → MESMA loja de volta → o rascunho continua lá e o Salvar segue habilitado.
  it("N-1: loja '' transitória NÃO zera o staging — a mesma loja volta e o rascunho continua (Salvar habilitado)", async () => {
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
    await act(async () => { view.tenantVazio(); });
    await act(async () => { view.trocarTenant("t1", listaLoja1); });
    expect(input()!.value).toBe("Editando Na Loja 1");
    const botaoSalvar = () => [...document.body.querySelectorAll("button")].find((b) => b.textContent?.includes("Salvar") && !b.textContent?.includes("Descartar"));
    expect(botaoSalvar()?.hasAttribute("disabled")).toBe(false);
    await view.desmontar();
  });

  // N-1, lado "troca de verdade": "" transitório no meio NÃO impede o reset quando a loja que volta é OUTRA.
  it("N-1: sujo → '' → OUTRA loja ainda ZERA o staging (o \"\" não esconde a troca)", async () => {
    const listaLoja1 = listaRaw([produtoRaw({ modelo_id: "m1", raw: { nome: "Produto Loja 1", ref: "REF0001", tamanho_tipo: "letra" } })]);
    const view = await montarComMocks({ lista: listaLoja1 });
    const { act } = await import("react");
    const input = () => view.container.querySelector<HTMLInputElement>('input[aria-label^="Nome —"]');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input()!, "Editando Na Loja 1");
      input()!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { view.tenantVazio(); });
    const listaLoja2 = listaRaw([produtoRaw({ modelo_id: "m9", raw: { nome: "Produto Loja 2", ref: "REF0009", tamanho_tipo: "letra" } })]);
    await act(async () => { view.trocarTenant("t2", listaLoja2); });
    expect(input()!.value).toBe("Produto Loja 2");
    expect(view.container.textContent).not.toContain("fora desta página");
    const botaoSalvar = () => [...document.body.querySelectorAll("button")].find((b) => b.textContent?.includes("Salvar") && !b.textContent?.includes("Descartar"));
    expect(botaoSalvar()?.hasAttribute("disabled")).toBe(true);
    await view.desmontar();
  });

  // revisão T15 #1 (code-review I1, "wrong-store save" — item 1 do pedido do controlador): `KeywordsDialog` só
  // existe montado como `{keywordsAberto && <KeywordsDialog/>}` dentro de `ProdutosAba` — o efeito de troca de
  // tenant (m4, acima) já faz `setKeywordsAberto(false)`, então o diálogo desmonta por inteiro na troca (nenhum
  // rascunho de Keywords sobrevive, porque não há ONDE ele sobreviver). Prova OBSERVÁVEL: abre o diálogo, troca de
  // loja, confirma que ele sumiu do DOM.
  it("revisão T15 #1: trocar de loja fecha o KeywordsDialog aberto (não deixa rascunho de Keywords vazar)", async () => {
    const listaLoja1 = listaRaw([produtoRaw({ modelo_id: "m1", raw: { nome: "Produto Loja 1", ref: "REF0001", tamanho_tipo: "letra" } })],
      { campos: ["nome", "preco_venda", "keywords"] });
    const view = await montarComMocks({ lista: listaLoja1 });
    const { act } = await import("react");
    const botaoEditarKeywords = () => [...view.container.querySelectorAll("button")].find((b) => b.textContent === "editar");
    await act(async () => { botaoEditarKeywords()!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(document.body.textContent).toContain("Keywords da loja");
    const listaLoja2 = listaRaw([produtoRaw({ modelo_id: "m9", raw: { nome: "Produto Loja 2", ref: "REF0009", tamanho_tipo: "letra" } })],
      { campos: ["nome", "preco_venda", "keywords"] });
    await act(async () => { view.trocarTenant("t2", listaLoja2); });
    expect(document.body.textContent).not.toContain("Keywords da loja");
    await view.desmontar();
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────────────────────
  // Task 13 — Integrar (com o resumo), Voltar, Desfazer (super admin) e ações em massa. Reusa `montarComMocks`
  // (agora com `rpcImpl`, já que `IntegrarDialog`/`VoltarDialog`/`DesfazerDialog` chamam `supabase.rpc` DIRETO).
  // Cada teste confirma ESTADO ou ARGUMENTOS da RPC, nunca só o toast (não-negociável do brief da Task 13).
  // ───────────────────────────────────────────────────────────────────────────────────────────────────────────
  describe("Task 13 — Integrar/Voltar/Desfazer/massa", () => {
    const previaRaw = (produtos: Record<string, unknown>[], o: Record<string, unknown> = {}) => ({
      campos: ["nome", "preco_venda"], precisa_ver_custos: false, pode_ver_custos: true, produtos, ...o,
    });
    const previaProduto = (o: Record<string, unknown> = {}) => ({
      modelo_id: "m1", nome: "Produto Teste", ref: "REF0001", origem: "interno", estado: "nao_integravel",
      reprovado: false, completo: true, faltas: [],
      assinatura: "a".repeat(64),
      retrato: { campos: ["nome", "preco_venda"], linhas: [
        { tipo: "produto", ordem: 0, valores: { nome: "Produto Teste", preco_venda: "159.90" }, fotos: [] },
      ] },
      ...o,
    });
    const botao = (texto: string) => [...document.body.querySelectorAll("button")].find((b) => b.textContent === texto);
    const botaoContendo = (texto: string) => [...document.body.querySelectorAll("button")].find((b) => b.textContent?.includes(texto));

    it("fluxo Integrar: liga o toggle Integrável → mostra o resumo do integracao_previa → 'Tenho certeza — integrar' chama integracao_marcar com {modelo_id, assinatura} do resumo", async () => {
      const lista = listaRaw([produtoRaw()]);
      let chamadaMarcar: unknown;
      const view = await montarComMocks({
        lista,
        rpcImpl: async (nome, args) => {
          if (nome === "integracao_previa") return { data: previaRaw([previaProduto()]), error: null };
          if (nome === "integracao_marcar") { chamadaMarcar = args; return { data: { marcados: 1 }, error: null }; }
          throw new Error(`RPC inesperada: ${nome}`);
        },
      });
      const { act } = await import("react");
      const toggle = view.container.querySelector<HTMLButtonElement>('button[role="switch"][aria-label^="Integrável"]');
      expect(toggle, "toggle Integrável deveria existir").not.toBeNull();
      await act(async () => { toggle!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      // O resumo mostra o texto do dono VERBATIM (TEXTO_ALERTA_INTEGRAR) e a tabela vinda de integracao_previa.
      expect(document.body.textContent).toContain("Você tem certeza? Se estiver errado, você poderá ser demitido");
      const botaoConfirmar = () => botao("Tenho certeza — integrar");
      // Some depois que a prévia carrega (query resolvida) — espera um microtask/ato.
      await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
      expect(botaoConfirmar(), "botão de confirmar deveria aparecer com a prévia carregada").toBeDefined();
      await act(async () => { botaoConfirmar()!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
      // A RPC real recebe EXATAMENTE {modelo_id, assinatura} do resumo — nunca um payload inventado pela tela.
      expect(chamadaMarcar).toEqual({ _itens: [{ modelo_id: "m1", assinatura: "a".repeat(64) }] });
      await view.desmontar();
    });

    // m8(c) (fix round 2 T13, revisão T13 #16, task-13-review.md "Re-review round 1"): fix round 1 (m1) já tinha
    // corrigido o `disabled` do "Tenho certeza — integrar" pra incluir `q.isError` e `r.bloqueio`
    // (`IntegrarDialog.tsx:124`), mas nenhum teste cobria essas 2 condições de fato — só o caminho feliz (prévia OK,
    // sem bloqueio). Sem essa cobertura, uma regressão futura no `disabled` (ex.: tirar `q.isError` ou `r.bloqueio`
    // por engano numa refatoração) passaria batido pela suíte.
    it("'Tenho certeza — integrar' fica DESABILITADO quando um REFETCH falha (q.isError) mesmo com um resumo ANTERIOR (r) ainda em cache — TanStack v5 preserva `data` em erro", async () => {
      // Cenário do comentário m1 (`IntegrarDialog.tsx:121-123`): a 1ª busca da prévia tem SUCESSO (`r` fica
      // populado, o botão habilita normalmente); um `refetch()` seguinte (ex.: o retry automático do `onError`
      // do `marcar`, m2) FALHA — TanStack v5 mantém o `r` velho em `q.data` mesmo com `q.isError=true`. Sem
      // `q.isError` no `disabled`, o botão continuaria clicável sobre um resumo que a tela nem mostra mais (a UI
      // troca a tabela pela mensagem de erro, mas o `onClick` ainda leria o `r` desatualizado).
      const lista = listaRaw([produtoRaw()]);
      let chamadasPrevia = 0;
      const view = await montarComMocks({
        lista,
        rpcImpl: async (nome) => {
          if (nome === "integracao_previa") {
            chamadasPrevia += 1;
            if (chamadasPrevia === 1) return { data: previaRaw([previaProduto()]), error: null }; // 1ª: sucesso
            return { data: null, error: Object.assign(new Error("boom"), { code: "XX000" }) }; // demais: falha
          }
          throw new Error(`RPC inesperada: ${nome}`);
        },
      });
      const { act } = await import("react");
      const toggle = view.container.querySelector<HTMLButtonElement>('button[role="switch"][aria-label^="Integrável"]');
      await act(async () => { toggle!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
      const botaoConfirmar = () => botao("Tenho certeza — integrar");
      // 1ª busca teve sucesso: o botão aparece HABILITADO (prova de que o cenário não é "sempre desabilitado").
      expect(botaoConfirmar(), "botão deveria existir com a 1ª prévia carregada").toBeDefined();
      expect(botaoConfirmar()?.hasAttribute("disabled")).toBe(false);
      // Dispara o refetch que vai falhar (o mesmo botão "Tentar de novo" não aparece com sucesso — usa o refetch
      // exposto pela própria query via um 2º evento de erro do `marcar`; mais simples e direto aqui: chama
      // `view.qc.refetchQueries` na MESMA key que `IntegrarDialog` usa, reproduzindo o "refetch em voo" do m2 sem
      // depender da mutação inteira).
      await act(async () => {
        await view.qc.refetchQueries({ queryKey: ["integracao-previa", "t1", ["m1"]] }).catch(() => {});
      });
      // Espera o retry padrão (default do TanStack) esgotar e `q.isError` assentar — este `qc` não desliga retry.
      for (let i = 0; i < 40 && !document.body.textContent?.includes("Não foi possível montar o resumo."); i++) {
        await act(async () => { await new Promise((r) => setTimeout(r, 250)); });
      }
      expect(chamadasPrevia).toBeGreaterThan(1);
      // Prova de ESTADO: a tela mostra a mensagem de erro (não a tabela do `r` velho).
      expect(document.body.textContent).toContain("Não foi possível montar o resumo.");
      // A prova real do m1: mesmo com `r` (o resumo ANTERIOR) ainda existindo em `q.data` (TanStack v5 preserva
      // `data` em erro — não veio de `undefined`), o botão fica desabilitado por causa de `q.isError`.
      expect(botaoConfirmar(), "botão continua no DOM (a v1 do fix o mostrava clicável aqui)").toBeDefined();
      expect(botaoConfirmar()?.hasAttribute("disabled")).toBe(true);
      await view.desmontar();
    }, 15000);

    it("'Tenho certeza — integrar' fica DESABILITADO quando o resumo vem com bloqueio (r.bloqueio), mesmo com a prévia carregada com sucesso", async () => {
      const lista = listaRaw([produtoRaw()]);
      const view = await montarComMocks({
        lista,
        rpcImpl: async (nome) => {
          // `bloqueio` é DERIVADO por `lerResumo` (nunca lido direto do payload) de `precisa_ver_custos && !
          // pode_ver_custos` — reproduz o cenário real ("Preço de custo" marcado em Campos da API sem permissão
          // de ver custos), não um campo `bloqueio` inventado no raw.
          if (nome === "integracao_previa") {
            return { data: previaRaw([previaProduto()], { precisa_ver_custos: true, pode_ver_custos: false }), error: null };
          }
          throw new Error(`RPC inesperada: ${nome}`);
        },
      });
      const { act } = await import("react");
      const toggle = view.container.querySelector<HTMLButtonElement>('button[role="switch"][aria-label^="Integrável"]');
      await act(async () => { toggle!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
      // Prova de ESTADO: a prévia carregou com SUCESSO (não é o ramo `q.isError` do teste anterior) — o texto do
      // bloqueio (derivado, TEXTO_PRECISA_CUSTO) aparece; o que desabilita aqui é SÓ `r.bloqueio`.
      expect(document.body.textContent).toContain("Precisa poder ver custos (Preço de custo está marcado)");
      const botaoConfirmar = () => botao("Tenho certeza — integrar");
      expect(botaoConfirmar(), "botão deveria existir (a prévia carregou) mas desabilitado").toBeDefined();
      expect(botaoConfirmar()?.hasAttribute("disabled")).toBe(true);
      await view.desmontar();
    });

    it("fluxo Voltar: desliga o toggle de um produto integrável → 'Voltar para não integrável' chama integracao_voltar com o id", async () => {
      const lista = listaRaw([produtoRaw({ estado: "integravel" })]);
      let chamadaVoltar: unknown;
      const view = await montarComMocks({
        lista,
        rpcImpl: async (nome, args) => {
          if (nome === "integracao_voltar") { chamadaVoltar = args; return { data: { voltaram: 1 }, error: null }; }
          throw new Error(`RPC inesperada: ${nome}`);
        },
      });
      const { act } = await import("react");
      const toggle = view.container.querySelector<HTMLButtonElement>('button[role="switch"][aria-label^="Integrável"]');
      expect(toggle?.getAttribute("aria-checked")).toBe("true"); // já integrável — toggle ligado
      await act(async () => { toggle!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      expect(document.body.textContent).toContain("Voltar para não integrável?");
      const botaoConfirmar = botao("Voltar para não integrável");
      expect(botaoConfirmar, "botão de confirmar Voltar deveria aparecer").toBeDefined();
      await act(async () => { botaoConfirmar!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
      expect(chamadaVoltar).toEqual({ _modelo_ids: ["m1"] });
      await view.desmontar();
    });

    it("Desfazer: o '⋯' só aparece para super admin num produto INTEGRADO; motivo < 3 caracteres mantém o botão desabilitado; ≥3 chama integracao_desfazer com {modelo_id, motivo}", async () => {
      const lista = listaRaw([produtoRaw({ estado: "integrado" })], { pode: { editar: true, ver_custos: true, super: true, keywords: true } });
      let chamadaDesfazer: unknown;
      const view = await montarComMocks({
        lista,
        rpcImpl: async (nome, args) => {
          if (nome === "integracao_desfazer") { chamadaDesfazer = args; return { data: { ok: true }, error: null }; }
          throw new Error(`RPC inesperada: ${nome}`);
        },
      });
      const { act } = await import("react");
      const botaoMais = view.container.querySelector<HTMLButtonElement>('button[aria-label^="Mais ações"]');
      expect(botaoMais, "'⋯' deveria aparecer (super admin + integrado)").not.toBeNull();
      await act(async () => { botaoMais!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      const botaoAbrirDesfazer = botaoContendo("Desfazer integração");
      expect(botaoAbrirDesfazer).toBeDefined();
      await act(async () => { botaoAbrirDesfazer!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      expect(document.body.textContent).toContain("volta para Não integrável");
      const textarea = () => document.body.querySelector<HTMLTextAreaElement>("#integracao-motivo");
      expect(textarea()).not.toBeNull();
      const botaoConfirmarDesfazer = () => [...document.body.querySelectorAll("button")].find((b) => b.textContent === "Desfazer integração" && b.closest('[role="alertdialog"]'));
      // Motivo vazio: desabilitado.
      expect(botaoConfirmarDesfazer()?.hasAttribute("disabled")).toBe(true);
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
        setter.call(textarea()!, "ok"); // 2 caracteres — abaixo do MOTIVO_MIN (3)
        textarea()!.dispatchEvent(new Event("input", { bubbles: true }));
      });
      expect(botaoConfirmarDesfazer()?.hasAttribute("disabled")).toBe(true); // continua desabilitado (< 3)
      expect(chamadaDesfazer).toBeUndefined(); // nunca chamou a RPC com motivo curto demais
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
        setter.call(textarea()!, "Motivo válido");
        textarea()!.dispatchEvent(new Event("input", { bubbles: true }));
      });
      expect(botaoConfirmarDesfazer()?.hasAttribute("disabled")).toBe(false); // ≥3 caracteres — habilitado
      await act(async () => { botaoConfirmarDesfazer()!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
      expect(chamadaDesfazer).toEqual({ _modelo_id: "m1", _motivo: "Motivo válido" });
      await view.desmontar();
    });

    it("Desfazer: SEM super admin, o '⋯' nunca aparece (só o toggle Integrável, sempre travado num produto integrado)", async () => {
      const lista = listaRaw([produtoRaw({ estado: "integrado" })], { pode: { editar: true, ver_custos: true, super: false, keywords: true } });
      const view = await montarComMocks({ lista });
      expect(view.container.querySelector('button[aria-label^="Mais ações"]')).toBeNull();
      const toggle = view.container.querySelector<HTMLButtonElement>('button[role="switch"][aria-label^="Integrável"]');
      expect(toggle?.disabled).toBe(true); // integrado — só super admin desfaz, ninguém mais destrava por aqui
      await view.desmontar();
    });

    it("seleção em massa: marcar 2 produtos integráveis e clicar 'Integrar selecionados' abre o resumo com os 2 ids; contador de selecionados reflete o Set", async () => {
      const lista = listaRaw([
        produtoRaw({ modelo_id: "m1", raw: { nome: "Produto Um", ref: "REF0001", tamanho_tipo: "letra" } }),
        produtoRaw({ modelo_id: "m2", raw: { nome: "Produto Dois", ref: "REF0002", tamanho_tipo: "letra" } }),
      ]);
      let idsPrevia: string[] | undefined;
      const view = await montarComMocks({
        lista,
        rpcImpl: async (nome, args) => {
          if (nome === "integracao_previa") {
            idsPrevia = (args as { _modelo_ids: string[] })._modelo_ids;
            return { data: previaRaw([previaProduto({ modelo_id: "m1" }), previaProduto({ modelo_id: "m2", nome: "Produto Dois" })]), error: null };
          }
          throw new Error(`RPC inesperada: ${nome}`);
        },
      });
      const { act } = await import("react");
      const checkboxM1 = view.container.querySelector<HTMLButtonElement>('button[role="checkbox"][aria-label="Selecionar Produto Um"]');
      const checkboxM2 = view.container.querySelector<HTMLButtonElement>('button[role="checkbox"][aria-label="Selecionar Produto Dois"]');
      expect(checkboxM1, "checkbox de seleção de m1").not.toBeNull();
      expect(checkboxM2, "checkbox de seleção de m2").not.toBeNull();
      await act(async () => { checkboxM1!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      expect(view.container.textContent).toContain("1 selecionado(s)");
      await act(async () => { checkboxM2!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      expect(view.container.textContent).toContain("2 selecionado(s)");
      const botaoIntegrarSelecionados = botao("Integrar selecionados");
      expect(botaoIntegrarSelecionados?.hasAttribute("disabled")).toBe(false);
      await act(async () => { botaoIntegrarSelecionados!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
      expect(idsPrevia).toEqual(["m1", "m2"]); // o resumo pediu EXATAMENTE os 2 ids marcados
      await view.desmontar();
    });

    // Achado carregado da revisão da Task 12b ("Selection and memo"): `ProdutosTabela`/`LinhaProduto` são
    // `React.memo`. Quando a seleção muda, o checkbox da linha TOCADA precisa refletir o novo estado (o `selecao`
    // muda de identidade a cada seleção — nenhum objeto literal seria estável — então TODA linha re-renderiza; o
    // que importa é que o CHECKBOX correto atualiza e que uma linha SEM seleção nenhuma tocada não perde nenhuma
    // OUTRA prop própria por causa disso). Prova de estado real: o `aria-checked` de m1 muda; o de m2 permanece
    // como estava; nenhuma célula própria de m2 (o nome do rascunho) é perdida/resetada pela mudança de seleção.
    it("seleção e memo: marcar m1 atualiza SÓ o checkbox de m1 (aria-checked) — m2 mantém seu próprio estado (rascunho) intacto", async () => {
      const lista = listaRaw([
        produtoRaw({ modelo_id: "m1", raw: { nome: "Produto Um", ref: "REF0001", tamanho_tipo: "letra" } }),
        produtoRaw({ modelo_id: "m2", raw: { nome: "Produto Dois", ref: "REF0002", tamanho_tipo: "letra" } }),
      ]);
      const view = await montarComMocks({ lista });
      const { act } = await import("react");
      const checkboxM1 = () => view.container.querySelector<HTMLButtonElement>('button[role="checkbox"][aria-label="Selecionar Produto Um"]');
      const checkboxM2 = () => view.container.querySelector<HTMLButtonElement>('button[role="checkbox"][aria-label="Selecionar Produto Dois"]');
      const inputM2 = () => view.container.querySelector<HTMLInputElement>('input[aria-label="Nome — Produto Dois"]');
      // Edita m2 ANTES de qualquer seleção — prova que a mudança de seleção que vem a seguir não reseta esse valor.
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
        setter.call(inputM2()!, "Dois Editado Antes Da Selecao");
        inputM2()!.dispatchEvent(new Event("input", { bubbles: true }));
      });
      expect(checkboxM1()?.getAttribute("aria-checked")).toBe("false");
      expect(checkboxM2()?.getAttribute("aria-checked")).toBe("false");
      await act(async () => { checkboxM1()!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      // O checkbox de m1 (TOCADO) reflete a seleção nova — prova de que `selecao.marcado`/a prop chegou atualizada.
      expect(checkboxM1()?.getAttribute("aria-checked")).toBe("true");
      // m2 (NÃO selecionado) continua desmarcado — a mudança de seleção de m1 não vazou pra m2.
      expect(checkboxM2()?.getAttribute("aria-checked")).toBe("false");
      // O rascunho de m2 (uma prop TOTALMENTE independente da seleção) sobrevive intacto — a linha de m2 pode ter
      // re-renderizado (identidade nova do objeto `selecao`), mas nenhum estado PRÓPRIO dela foi perdido no processo.
      expect(inputM2()?.value).toBe("Dois Editado Antes Da Selecao");
      await view.desmontar();
    });

    // Fix round 1 T13 (revisão T13 #12, code-review m9): a v1 só conferia o toast — nunca que `integracao_previa`
    // é chamado DE NOVO (m2) nem que a 2ª confirmação manda a assinatura NOVA (a propriedade central da task: nunca
    // integrar com assinatura velha). Conta as chamadas de `integracao_previa` e captura o payload de CADA
    // `integracao_marcar` — a 2ª precisa levar uma assinatura DIFERENTE da 1ª (a que o refetch pós-erro trouxe).
    it("mapeamento de erro — P0409 integracao_mudou no Integrar: RELÊ o resumo (2ª chamada de integracao_previa) e a 2ª confirmação manda a assinatura NOVA", async () => {
      const lista = listaRaw([produtoRaw()]);
      const erroMudou = Object.assign(new Error("integracao_mudou: produto m1 mudou desde o resumo"), { code: "P0409" });
      let chamadasPrevia = 0;
      const chamadasMarcar: unknown[] = [];
      let marcarFalhaUmaVez = true;
      const view = await montarComMocks({
        lista,
        rpcImpl: async (nome, args) => {
          if (nome === "integracao_previa") {
            chamadasPrevia += 1;
            // A 2ª prévia (pós-erro) traz uma assinatura NOVA — é o que o "confirme de novo" de fato confirma.
            const assinatura = chamadasPrevia === 1 ? "a".repeat(64) : "b".repeat(64);
            return { data: previaRaw([previaProduto({ assinatura })]), error: null };
          }
          if (nome === "integracao_marcar") {
            chamadasMarcar.push(args);
            if (marcarFalhaUmaVez) { marcarFalhaUmaVez = false; return { data: null, error: erroMudou }; }
            return { data: { marcados: 1 }, error: null };
          }
          throw new Error(`RPC inesperada: ${nome}`);
        },
      });
      const { act } = await import("react");
      const toggle = view.container.querySelector<HTMLButtonElement>('button[role="switch"][aria-label^="Integrável"]');
      await act(async () => { toggle!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
      expect(chamadasPrevia).toBe(1); // 1ª carga do resumo
      const botaoConfirmar = () => botao("Tenho certeza — integrar");
      await act(async () => { botaoConfirmar()!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
      expect((await toastMock()).error).toHaveBeenCalledWith(
        "O produto mudou desde o resumo (outra pessoa editou, integrou ou voltou). Confira o resumo novo e confirme de novo.",
      );
      expect(chamadasMarcar).toHaveLength(1);
      expect((chamadasMarcar[0] as { _itens: { assinatura: string }[] })._itens[0].assinatura).toBe("a".repeat(64));
      // m2: o `onError` relê o resumo SEMPRE (não só antes) — confirma que a 2ª chamada de `integracao_previa`
      // de fato aconteceu (o `q.refetch()` do `onError`).
      await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
      expect(chamadasPrevia).toBe(2);
      // 2º clique em "Tenho certeza — integrar": manda a assinatura NOVA (a que a 2ª prévia trouxe) — nunca a velha.
      await act(async () => { botaoConfirmar()!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
      expect(chamadasMarcar).toHaveLength(2);
      expect((chamadasMarcar[1] as { _itens: { assinatura: string }[] })._itens[0].assinatura).toBe("b".repeat(64));
      await view.desmontar();
    });

    // n3 (fix round 2 T13, revisão T13 #15, task-13-review.md "Re-review round 1"): o título dizia "e invalida a
    // lista" mas o teste só contava a chamada da RPC — nenhuma asserção provava a invalidação de verdade. Agora
    // `invalidarIntegracaoSpy` (exposto por `montarComMocks`) é checado com o tenant + o id do produto, igual ao
    // que `VoltarDialog.tsx` chama no `onError` (`invalidarIntegracao(qc, tenantId, ids)`).
    it("mapeamento de erro — 42501 (sem permissão) no Voltar mostra o toast traduzido pela mensagemErro e invalida a lista", async () => {
      const lista = listaRaw([produtoRaw({ estado: "integravel" })]);
      const erro42501 = Object.assign(new Error("Sem permissão para editar a Integração."), { code: "42501" });
      let chamadasVoltar = 0;
      const view = await montarComMocks({
        lista,
        rpcImpl: async (nome) => {
          if (nome === "integracao_voltar") { chamadasVoltar += 1; return { data: null, error: erro42501 }; }
          throw new Error(`RPC inesperada: ${nome}`);
        },
      });
      const { act } = await import("react");
      const toggle = view.container.querySelector<HTMLButtonElement>('button[role="switch"][aria-label^="Integrável"]');
      await act(async () => { toggle!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      const botaoConfirmar = botao("Voltar para não integrável");
      await act(async () => { botaoConfirmar!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
      expect((await toastMock()).error).toHaveBeenCalledWith("Sem permissão para editar a Integração.");
      expect(chamadasVoltar).toBe(1); // a RPC foi de fato chamada com o payload — prova de estado, não só o toast
      // A invalidação de verdade (não só o toast): `onError` do VoltarDialog chama `invalidarIntegracao(qc,
      // tenantId, [id do produto])` — mesmo em erro de PERMISSÃO (não só P0409), pra nunca deixar a linha presa
      // com um estado local que já não bate com o que o servidor confirmou.
      expect(view.invalidarIntegracaoSpy).toHaveBeenCalledWith(view.qc, "t1", ["m1"]);
      await view.desmontar();
    });

    it("mapeamento de erro — P0001 (produto reprovado) no Integrar mostra a mensagem do servidor (RAISE em PT, usada verbatim) e relê o resumo", async () => {
      const lista = listaRaw([produtoRaw()]);
      const erroReprovado = Object.assign(new Error('O produto "Produto Teste" está reprovado e não pode ser integrado.'), { code: "P0001" });
      let chamadasPrevia = 0;
      const view = await montarComMocks({
        lista,
        rpcImpl: async (nome) => {
          if (nome === "integracao_previa") { chamadasPrevia += 1; return { data: previaRaw([previaProduto()]), error: null }; }
          if (nome === "integracao_marcar") return { data: null, error: erroReprovado };
          throw new Error(`RPC inesperada: ${nome}`);
        },
      });
      const { act } = await import("react");
      const toggle = view.container.querySelector<HTMLButtonElement>('button[role="switch"][aria-label^="Integrável"]');
      await act(async () => { toggle!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
      const botaoConfirmar = botao("Tenho certeza — integrar");
      await act(async () => { botaoConfirmar!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
      expect((await toastMock()).error).toHaveBeenCalledWith('O produto "Produto Teste" está reprovado e não pode ser integrado.');
      // Fix round 1 T13 (m2): mesmo um erro que NÃO é P0409 relê o resumo (a assinatura antiga continua em
      // `entram` sem isso) — prova de ESTADO: 2ª chamada de `integracao_previa` aconteceu.
      expect(chamadasPrevia).toBe(2);
      await view.desmontar();
    });

    // Fix round 1 T13 (revisão T13 #13, task-13-review.md Important I1) — TÍTULO CORRIGIDO no fix round 2 (revisão
    // T13 #14, task-13-review.md "Re-review round 1" n1): o título original dizia "não rerrenderiza NENHUMA linha
    // (nem a própria)", o que é FALSO — a linha de m1 (a tocada) RE-RENDERIZA sim, porque o comparador do
    // `React.memo` é raso sobre TODAS as props: `marcado` mudou pra m1, então TODA a linha de m1 (inclusive
    // `estadoCelula`, que não depende de `marcado`) roda de novo. O que o teste de fato prova (e o único ponto que
    // importa pro memo) é que a linha de m2 (prop `marcado` continua `false`, identidade igual) NÃO re-renderiza. A
    // ausência de um controle positivo (m1 > 0) também tornava a suíte cega a uma sabotagem que quebrasse o spy em
    // si — corrigido abaixo, no mesmo padrão do 12b (linha ~934, `chamadasParaM1... toBeGreaterThan(0)`).
    it("React.memo de verdade (T13): marcar o checkbox de UMA linha rerrenderiza SÓ ela (m1 > 0, m2 = 0)", async () => {
      const lista = listaRaw([
        produtoRaw({ modelo_id: "m1", raw: { nome: "Produto Um", ref: "REF0001", tamanho_tipo: "letra" } }),
        produtoRaw({ modelo_id: "m2", raw: { nome: "Produto Dois", ref: "REF0002", tamanho_tipo: "letra" } }),
      ]);
      const view = await montarComMocks({ lista });
      const rotuloSpy = vi.spyOn(view.produtosModulo, "rotuloEstado");
      const { act } = await import("react");
      const checkboxM1 = view.container.querySelector<HTMLButtonElement>('button[role="checkbox"][aria-label="Selecionar Produto Um"]');
      expect(checkboxM1).not.toBeNull();
      rotuloSpy.mockClear(); // limpa as chamadas do MOUNT — só interessam as do clique
      await act(async () => { checkboxM1!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      // Controle POSITIVO (n1): a linha de m1 (a TOCADA) precisa ter rerrenderizado — se o spy não interceptasse de
      // verdade (ex.: sabotagem no import), este teste passaria "por acidente" mostrando 0 chamadas pras duas.
      const chamadasParaM1 = rotuloSpy.mock.calls.filter((c) => (c[0] as unknown as { modeloId?: string }).modeloId === "m1");
      expect(chamadasParaM1.length, "linha de m1 (tocada pela seleção) deveria ter rerrenderizado").toBeGreaterThan(0);
      // O que o memo de fato garante: m2 (prop `marcado` continua `false`, identidade igual) NÃO re-renderiza.
      const chamadasParaM2 = rotuloSpy.mock.calls.filter((c) => (c[0] as unknown as { modeloId?: string }).modeloId === "m2");
      expect(chamadasParaM2.length, "linha de m2 (não tocada pela seleção) NÃO deveria ter rerrenderizado").toBe(0);
      rotuloSpy.mockRestore();
      await view.desmontar();
    });

    it("React.memo de verdade (T13): um reload que muda só o REV de m1 (m2 com IDENTIDADE preservada, como o structural sharing real do TanStack faria) não rerrenderiza m2", async () => {
      const lista = listaRaw([
        produtoRaw({ modelo_id: "m1", raw: { nome: "Produto Um", ref: "REF0001", tamanho_tipo: "letra" } }),
        produtoRaw({ modelo_id: "m2", raw: { nome: "Produto Dois", ref: "REF0002", tamanho_tipo: "letra" } }),
      ]);
      const view = await montarComMocks({ lista });
      const rotuloSpy = vi.spyOn(view.produtosModulo, "rotuloEstado");
      const { act } = await import("react");
      rotuloSpy.mockClear();
      // Este harness mocka `useIntegracaoLista` direto (sem TanStack Query real por baixo) — `lerLista` sempre
      // desserializa um jsonb novo, então `atualizarLista` sozinho NUNCA preserva identidade de objeto, mesmo pra
      // produtos com conteúdo idêntico (o teste "React.memo de verdade" original, linha ~904, evita esse problema
      // editando só `rascunhos`, sem tocar `lista.produtos`). Pra isolar especificamente o que o fix da T13 (#2)
      // resolve — `ctxIntegrar` não deve invalidar por causa de OUTRO produto mudar — construo a lista nova e
      // DEVOLVO ao produto de m2 e a `campos` (achado FORA do escopo desta revisão — `ordenarCampos`/`lerLista`
      // sempre criam um array NOVO por chamada, então `ProdutosTabela`'s `useMemo(...,[lista.campos])` recalcula em
      // TODO reload, mesmo sem essa causa — ver task-13-report.md "Fix round 1", nota de limitação conhecida) a
      // MESMA referência que já tinham — é exatamente o que o `structuralSharing` de verdade do TanStack faria num
      // reload onde só m1 mudou no servidor (comparação estrutural recursiva preserva sub-árvores intactas).
      const { lerLista } = view.produtosModulo;
      const listaAntiga = view.listaRef.current!;
      const m2Antigo = listaAntiga.produtos.find((p) => p.modeloId === "m2")!;
      const listaNovaRaw = listaRaw([
        produtoRaw({ modelo_id: "m1", estado: "integravel", rev: 2, raw: { nome: "Produto Um", ref: "REF0001", tamanho_tipo: "letra" } }),
        produtoRaw({ modelo_id: "m2", raw: { nome: "Produto Dois", ref: "REF0002", tamanho_tipo: "letra" } }),
      ]);
      const listaNova = lerLista(listaNovaRaw);
      listaNova.produtos = listaNova.produtos.map((p) => (p.modeloId === "m2" ? m2Antigo : p));
      listaNova.campos = listaAntiga.campos; // isola o achado do `ctxIntegrar` — `campos` é uma questão à parte
      await act(async () => { view.atualizarListaPronta(listaNova); });
      // Controle POSITIVO (revisão T13 #14, n1): m1 (o produto que DE FATO mudou — novo rev/estado) precisa ter
      // rerrenderizado — sem isso, um spy quebrado (ou um mock que nunca chama `estadoCelula`) faria as duas
      // asserções de m2 abaixo passarem "por acidente" mostrando 0 chamadas pras duas linhas.
      const chamadasParaM1 = rotuloSpy.mock.calls.filter((c) => (c[0] as unknown as { modeloId?: string }).modeloId === "m1");
      expect(chamadasParaM1.length, "linha de m1 (rev mudou no reload) deveria ter rerrenderizado").toBeGreaterThan(0);
      const chamadasParaM2 = rotuloSpy.mock.calls.filter((c) => (c[0] as unknown as { modeloId?: string }).modeloId === "m2");
      expect(chamadasParaM2.length, "linha de m2 (identidade preservada, como um structural sharing real faria) NÃO deveria ter rerrenderizado num reload que só mudou m1").toBe(0);
      rotuloSpy.mockRestore();
      await view.desmontar();
    });

    // Fix round 1 T13 (revisão T13 #14, code-review Important I1 — "Voltar entra em laço no P0409"): P0409 fecha/
    // encolhe o diálogo (produtos derivados da lista fresca, nunca um snapshot fixo) — um 2º clique NUNCA reenvia o
    // MESMO lote que acabou de ser rejeitado.
    it("Voltar P0409: o diálogo FECHA sozinho (produto não é mais integravel na lista) — um 2º Voltar NÃO reenvia o mesmo id", async () => {
      const lista = listaRaw([produtoRaw({ estado: "integravel" })]);
      const chamadasVoltar: unknown[] = [];
      const view = await montarComMocks({
        lista,
        rpcImpl: async (nome, args) => {
          if (nome === "integracao_voltar") {
            chamadasVoltar.push(args);
            return { data: null, error: Object.assign(new Error("integracao_mudou: produto m1 esta integrado"), { code: "P0409" }) };
          }
          throw new Error(`RPC inesperada: ${nome}`);
        },
      });
      const { act } = await import("react");
      const toggle = view.container.querySelector<HTMLButtonElement>('button[role="switch"][aria-label^="Integrável"]');
      await act(async () => { toggle!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      expect(document.body.textContent).toContain("Voltar para não integrável?");
      const botaoConfirmar = () => botao("Voltar para não integrável");
      await act(async () => { botaoConfirmar()!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
      expect(chamadasVoltar).toHaveLength(1);
      // A mensagem NUNCA promete "confirme de novo" (essa é a do Integrar, que TEM resumo) — o Voltar tem a sua.
      // Fix round 3 T13 (revisão T13 #17, m-R2): texto trocado — diz que a LISTA foi atualizada (não "nada foi
      // alterado", que soava como se o erro não tivesse consequência nenhuma) e convida a tentar de novo A PARTIR
      // da lista (não do mesmo diálogo, que já fechou).
      expect((await toastMock()).error).toHaveBeenCalledWith(
        "A lista foi atualizada porque algum produto já não está integrável (a API levou ou alguém voltou). Veja a lista atualizada e tente de novo se for o caso.",
      );
      // A invalidação do `onError` relista o produto como `integrado` (a API "levou" — o cenário real do erro).
      const listaPosErro = listaRaw([produtoRaw({ estado: "integrado" })]);
      await act(async () => { view.atualizarLista(listaPosErro); });
      // O diálogo continua fechado depois da relista (já tinha fechado ANTES dela — ver o teste dedicado abaixo,
      // fix round 3) — o texto do diálogo (que só aparece com ele aberto) segue fora do documento.
      expect(document.body.textContent).not.toContain("Voltar para não integrável?");
      // Sem diálogo aberto, não há como reenviar o MESMO lote — a prova definitiva do "nunca laço": só 1 chamada
      // de `integracao_voltar` aconteceu no total, mesmo depois da relista.
      expect(chamadasVoltar).toHaveLength(1);
      await view.desmontar();
    });

    // Fix round 3 T13 (revisão T13 #17, task-13-code-review.md "Re-check round 2" m-R2): a ruling do controlador —
    // "invalidar e FECHAR o diálogo no P0409" — não estava implementada; o fechamento no teste ACIMA só acontecia
    // por causa da relista manual (`view.atualizarLista`) fazer `voltarProdutosAtuais` esvaziar, que é um efeito
    // INDIRETO em `ProdutosAba.tsx`, não uma ação do próprio `VoltarDialog`. Sem NENHUMA relista (o cenário real
    // entre o erro chegar e o próximo refetch/foco de janela), o diálogo antigo ficava aberto. Este teste isola
    // exatamente esse gap: SEM chamar `view.atualizarLista` em momento algum, o diálogo deve fechar sozinho logo
    // após o P0409, e um 2º clique (impossível, já que o botão nem existe mais) não pode reenviar o id.
    it("Voltar P0409: o diálogo FECHA IMEDIATAMENTE (onFechar chamado no onError), SEM depender de nenhuma relista", async () => {
      const lista = listaRaw([produtoRaw({ estado: "integravel" })]);
      const chamadasVoltar: unknown[] = [];
      const view = await montarComMocks({
        lista,
        rpcImpl: async (nome, args) => {
          if (nome === "integracao_voltar") {
            chamadasVoltar.push(args);
            return { data: null, error: Object.assign(new Error("integracao_mudou: produto m1 esta integrado"), { code: "P0409" }) };
          }
          throw new Error(`RPC inesperada: ${nome}`);
        },
      });
      const { act } = await import("react");
      const toggle = view.container.querySelector<HTMLButtonElement>('button[role="switch"][aria-label^="Integrável"]');
      await act(async () => { toggle!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      expect(document.body.textContent).toContain("Voltar para não integrável?");
      const botaoConfirmar = () => botao("Voltar para não integrável");
      await act(async () => { botaoConfirmar()!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
      expect(chamadasVoltar).toHaveLength(1);
      // NENHUMA relista chamada aqui (nem `view.atualizarLista`, nem `view.refetchIdentico`) — `lista.produtos`
      // continua exatamente como antes, o produto ainda `integravel`. Se o fechamento dependesse da relista
      // (a v1/round-1 do fix), o diálogo continuaria aberto neste ponto.
      expect(document.body.textContent, "o diálogo deveria ter fechado IMEDIATAMENTE, sem relista nenhuma")
        .not.toContain("Voltar para não integrável?");
      // Prova de ESTADO adicional: o botão de confirmar nem existe mais no DOM — um "2º clique" é estruturalmente
      // impossível, não apenas "não aconteceu por acaso".
      expect(botaoConfirmar()).toBeUndefined();
      expect(chamadasVoltar).toHaveLength(1);
      await view.desmontar();
    });
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
      // revisão T15 #I1-R (code-review "Re-check round 1"): `KeywordsDialog` importa `confirmarLojaAtiva` DIRETO
      // deste módulo — sem o export, a chamada real quebraria. Resolve como se a loja NÃO tivesse mudado (não é o
      // alvo desta suíte).
      confirmarLojaAtiva: async () => {},
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
  // conexão (nada de laço sem saída — cada tentativa relê de novo — mas confuso pro usuário). Prova: mantém um
  // `QueryObserver` de verdade inscrito na MESMA chave por prefixo (é isso que torna a query "ATIVA" pro
  // `refetchQueries({type:"active"})`/`getQueryCache().find({type:"active"})` — sem observer nenhum, a v1 deste
  // teste usava `qc.fetchQuery` solto, que NUNCA registra observer e portanto NUNCA conta como ativa; passava só
  // por acidente enquanto o m-T2 checava "qualquer query em cache", que é EXATAMENTE o bug que m-T2 corrigiu —
  // ver `KeywordsDialog.tsx`) com um `queryFn` que rejeita — o toast precisa nomear a falha de rede, nunca o texto
  // genérico de conflito.
  it("regressão m-S4: refetch que falha por rede mostra uma mensagem de FALHA DE CONEXÃO, nunca o texto genérico de 'outra pessoa mudou'", async () => {
    const view = await montarKeywords({
      rpcImpl: async () => ({ data: null, error: Object.assign(new Error("keywords_mudou: outra pessoa mudou"), { code: "P0409" }) }),
    });
    const { act } = await import("react");
    const { QueryObserver } = await import("@tanstack/react-query");
    const textarea = () => document.body.querySelector<HTMLTextAreaElement>("#integracao-keywords");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(textarea()!, "Moda, Verão, Meu Texto");
      textarea()!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // Mantém a query com um observer INSCRITO (o que a torna "ativa" de verdade) enquanto o próprio `queryFn`
    // rejeita — deixa `state.status === "error"` e `fetchStatus === "idle"` (terminou de tentar) depois que a
    // Promise resolve, exatamente como o `refetchQueries` real deixaria numa falha de rede genuína NUMA query com
    // um `useIntegracaoLista` de verdade montado (o caso real do `ProdutosAba`, fora do escopo deste harness).
    const observer = new QueryObserver(view.qc, {
      queryKey: ["integracao-lista", "t1", "nao_integrados", {}, 1],
      queryFn: () => Promise.reject(new Error("Failed to fetch")),
      retry: false,
    });
    const unsubscribe = observer.subscribe(() => {});
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
    unsubscribe();
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
