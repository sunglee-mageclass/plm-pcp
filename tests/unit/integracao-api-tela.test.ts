// @vitest-environment happy-dom
// Integração — aba "API" (Task 15, super admin). O topo cobre `api-tela.ts` (leitura/textos, PUROS — o
// `@vitest-environment happy-dom` é um SUPERSET de "node" para eles, nenhum toca DOM). Do meio pra baixo: render de
// verdade de `ApiAba`/`NovaChaveDialog` (checklist não-negociável: "regex-on-source test does NOT count" para
// componente com hooks/estado — mesmo padrão de integracao-campos-config.test.ts, que é o MODELO para o padrão de
// concorrência do rev compartilhado).
//
// Cobre:
// - Chaves: criar (a chave aparece 1x, Copiar via navigator.clipboard, fechar pede confirmação "você copiou?", a
//   chave nunca fica em cache/query/log depois de fechado) e revogar (AlertDialog).
// - Acessos: só os últimos dígitos da chave, nunca o hash; rótulo/tom de status.
// - Configurações da API: rev CONGELADO no 1º toggle (compartilhado com Campos), P0409 rebaseia sem loop, alerta
//   fora do recomendado (incluindo P-89 A acima de 100), bloqueio de valor fora da faixa.
// - Guarda de "aba suja" (useAbaSuja) exercitada de verdade.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { act } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  TEXTO_REVOGAR, entregaAcesso, fmtData, lerAcessos, lerChaves, rotuloChaveAcesso, statusAcesso, textoForaRecomendado,
} from "@/lib/integracao/api-tela";

// n6 (mesma razão de integracao-celula.test.ts / integracao-campos-config.test.ts): silencia o aviso de act() do
// React 19 dev.
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const acesso = (o: Record<string, unknown>) => lerAcessos([{ id: "a1", chave: "ERP Principal", final: "a1b2", ip: null, modo: "normal",
  status: "ok", tentativas: 1, produtos: 42, exemplos: null, linhas: 118, quando: "2026-09-26T12:14:00Z", ...o }])[0];

describe("aba API — leitura e textos (mockup 7)", () => {
  it("chaves: nunca há hash; revogada e 'Nunca usada'", () => {
    const [k] = lerChaves([{ id: "k1", nome: "Loja Virtual (teste)", final: "7f3d", criada_por: "Ana Torres", criada_em: "2026-08-02T12:00:00Z",
      revogada_em: null, ultimo_uso_em: null, hash: "NAO-PODE" }]);
    expect(k).toEqual({ id: "k1", nome: "Loja Virtual (teste)", final: "7f3d", criadaPor: "Ana Torres", criadaEm: "2026-08-02T12:00:00Z",
      revogadaEm: null, ultimoUsoEm: null });
    expect(fmtData("2026-08-02T12:00:00Z", "America/Sao_Paulo")).toBe("02/08/2026");
  });
  // revisão T15 #4/m5+m9 (task review + code review): duas chaves podem ter o MESMO nome (ex.: rotação) — o
  // rótulo agora inclui os últimos dígitos (`final`) pra distinguir, mesmo padrão "nome + final" do Log/D32.
  it("acessos: rótulos da chave, status e entrega", () => {
    expect(rotuloChaveAcesso(acesso({}))).toBe("ERP Principal ····a1b2");
    expect(rotuloChaveAcesso(acesso({ modo: "teste", status: "teste" }))).toBe("ERP Principal ····a1b2 (modo teste)");
    expect(rotuloChaveAcesso(acesso({ chave: null, final: null, status: "chave_invalida", ip: "203.0.113.9" }))).toBe("Chave inválida (IP 203.0.113.9)");
    expect(statusAcesso(acesso({}))).toEqual({ texto: "OK", tom: "success" });
    expect(statusAcesso(acesso({ status: "chave_invalida", tentativas: 4 }))).toEqual({ texto: "Rejeitada ×4", tom: "danger" });
    expect(statusAcesso(acesso({ status: "limite_excedido", tentativas: 2 }))).toEqual({ texto: "Limite excedido ×2", tom: "warning" });
    expect(statusAcesso(acesso({ status: "teste" }))).toEqual({ texto: "Teste", tom: "info" });
    expect(entregaAcesso(acesso({}))).toEqual({ produtos: "42", linhas: "118" });
    expect(entregaAcesso(acesso({ status: "teste", modo: "teste", produtos: 0, exemplos: 2, linhas: 6 }))).toEqual({ produtos: "2 exemplos", linhas: "6" });
    expect(entregaAcesso(acesso({ status: "chave_invalida", produtos: 0, linhas: null }))).toEqual({ produtos: "—", linhas: "—" });
  });
  // D32/carried: os status "não OK" adicionais precisam de rótulo e tom próprios — cobre bloqueado/loja
  // inativa/reservado (os 3 que a lista do brief não exercitava, além dos já cobertos acima).
  it("status/entrega dos demais estados (bloqueado, loja inativa, reservado/'em andamento')", () => {
    expect(statusAcesso(acesso({ status: "ip_bloqueado", tentativas: 7 }))).toEqual({ texto: "IP bloqueado ×7", tom: "danger" });
    expect(statusAcesso(acesso({ status: "loja_inativa" }))).toEqual({ texto: "Loja inativa", tom: "danger" });
    expect(statusAcesso(acesso({ status: "reservado" }))).toEqual({ texto: "Em andamento", tom: "neutral" });
    expect(entregaAcesso(acesso({ status: "loja_inativa", produtos: 0, linhas: null }))).toEqual({ produtos: "—", linhas: "—" });
    expect(rotuloChaveAcesso(acesso({ chave: null, final: null, status: "ip_bloqueado", ip: "203.0.113.9" }))).toBe("IP bloqueado (203.0.113.9)");
  });
  it("fora do recomendado e revogar (textos do mockup)", () => {
    expect(textoForaRecomendado("limite_por_minuto"))
      .toBe("Recomendado: 60. Acima disso o ERP pode sobrecarregar o site / abaixo, o programa do dev pode ficar lento.");
    expect(TEXTO_REVOGAR).toBe("O ERP perde o acesso na hora. Esta ação não pode ser desfeita — para usar de novo, é preciso criar outra chave.");
  });
  it("P-89 A: 'Máximo por página' recomendado 50 e, acima de 100, o alerta do plano gratuito no campo E no diálogo", () => {
    expect(textoForaRecomendado("max_por_pagina")).toMatch(/^Recomendado: 50\. /);
    const s = readFileSync("src/components/integracao/ApiAba.tsx", "utf8");
    expect(s.match(/alertaPaginaPlanoGratuito\(vals\.max_por_pagina\)/g)?.length).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Render de verdade — react-dom/client + happy-dom (mesmo padrão de integracao-campos-config.test.ts).
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
async function montar(opts: {
  api?: { limite_por_minuto: number; max_por_pagina: number; validade_foto_dias: number; bloqueio_tentativas: number } | null;
  rev?: number;
  rpcImpl?: (nome: string, args: unknown) => Promise<{ data: unknown; error: unknown }>;
  comGuarda?: boolean;
  comClipboard?: boolean;
  // revisão T15 #1 (code-review I1): permite mudar o tenant ATIVO no meio do teste, sem desmontar — mesma razão
  // de `integracao-campos-config.test.ts`.
  tenantIdRef?: { current: string };
  // revisão T15 #I1-R (code-review "Re-check round 1"): mocka o comportamento de `confirmarLojaAtiva`/
  // `nomeLojaAtivaFresco` — por padrão resolvem como se a loja NÃO tivesse mudado (não afeta nenhum teste antigo).
  confirmarLojaAtivaImpl?: () => Promise<void>;
  nomeLojaAtivaFrescoImpl?: () => Promise<string | null>;
} = {}) {
  vi.resetModules();
  const api = opts.api === undefined
    ? { limite_por_minuto: 60, max_por_pagina: 50, validade_foto_dias: 7, bloqueio_tentativas: 10 }
    : opts.api;
  const rev = opts.rev ?? 3;
  const rpcSpy = vi.fn(
    opts.rpcImpl ?? (async (nome: string) => {
      if (nome === "integracao_config_ler") return { data: { campos: [], layout: [], rev, api }, error: null };
      if (nome === "integracao_chaves_listar") return { data: [], error: null };
      if (nome === "integracao_acessos_listar") return { data: [], error: null };
      if (nome === "integracao_salvar_config_api") return { data: { campos: [], layout: [], rev: rev + 1, api }, error: null };
      return { data: null, error: new Error(`RPC não mockada: ${nome}`) };
    }),
  );
  vi.doMock("@/integrations/supabase/client", () => ({ supabase: { rpc: rpcSpy } }));
  const tRef = opts.tenantIdRef ?? { current: "t1" };
  vi.doMock("@/hooks/useActiveTenantId", () => ({ useActiveTenantId: () => tRef.current }));
  vi.doMock("@/hooks/useStoreTimezone", () => ({ useStoreTimezone: () => "America/Sao_Paulo" }));
  // m11 (code review): NovaChaveDialog usa useTenantBranding() (via useAuth) pra mostrar o nome da loja no título.
  vi.doMock("@/hooks/useTenantBranding", () => ({ useTenantBranding: () => ({ nome: "Loja Teste", cnpj: null, contato: null, logoUrl: null }) }));
  const toastMocks = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() };
  vi.doMock("sonner", () => ({ toast: toastMocks }));
  vi.doMock("@tanstack/react-router", () => ({ useRouter: () => ({ history: { back: () => {} } }) }));
  const invalidarIntegracaoSpy = vi.fn();
  // revisão T15 #I1-R (code-review "Re-check round 1"): `confirmarLojaAtiva` mockável por teste — por padrão
  // (`opts.confirmarLojaAtivaImpl` ausente) resolve sem lançar (mesmo comportamento de "loja não mudou"), pra não
  // quebrar NENHUM teste pré-existente deste arquivo que não se importa com o caso `LOJA_MUDOU`.
  const confirmarLojaAtivaSpy = vi.fn(opts.confirmarLojaAtivaImpl ?? (async () => {}));
  const nomeLojaAtivaFrescoSpy = vi.fn(opts.nomeLojaAtivaFrescoImpl ?? (async () => "Loja Teste"));
  vi.doMock("@/components/integracao/useIntegracao", () => ({
    chaveConfig: (tenantId: string) => ["integracao-config", tenantId],
    invalidarIntegracao: invalidarIntegracaoSpy,
    TEXTO_LOJA_MUDOU: "A loja ativa mudou (em outra aba ou janela). Recarregue a página antes de salvar.",
    confirmarLojaAtiva: confirmarLojaAtivaSpy,
    nomeLojaAtivaFresco: nomeLojaAtivaFrescoSpy,
    useIntegracaoConfig: () => {
      return useQuery({
        queryKey: ["integracao-config", "t1"],
        queryFn: async () => {
          const { data, error } = await rpcSpy("integracao_config_ler", {});
          if (error) throw error;
          return data;
        },
      });
    },
  }));
  const clipboardMock = opts.comClipboard !== false
    ? { writeText: vi.fn(async () => {}) }
    : { writeText: vi.fn(async () => { throw new Error("sem permissão"); }) };
  Object.defineProperty(navigator, "clipboard", { value: clipboardMock, configurable: true });
  const { createElement } = await import("react");
  const { act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
  const { SidebarProvider } = await import("@/components/ui/sidebar");
  const { ApiAba } = await import("@/components/integracao/ApiAba");
  const { GuardaIntegracaoContext } = await import("@/components/integracao/guard");
  const informarSujoSpy = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const conteudo = createElement(SidebarProvider, null, createElement(ApiAba));
  const arvore = () =>
    createElement(
      QueryClientProvider,
      { client: qc },
      opts.comGuarda
        ? createElement(GuardaIntegracaoContext.Provider, { value: { informarSujo: informarSujoSpy } }, conteudo)
        : conteudo,
    );
  await act(async () => { root.render(arvore()); });
  for (let i = 0; i < 20 && rpcSpy.mock.calls.length === 0; i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  }
  await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  return {
    container, rpcSpy, toastMocks, invalidarIntegracaoSpy, informarSujoSpy, qc,
    confirmarLojaAtivaSpy, nomeLojaAtivaFrescoSpy,
    rerender: () => act(async () => { root.render(arvore()); }),
    esperar: () => act(async () => { await new Promise((r) => setTimeout(r, 10)); }),
    desmontar: () => act(async () => { root.unmount(); container.remove(); }),
  };
}

const botaoDoc = (texto: string) =>
  Array.from(document.querySelectorAll("button")).find((b) => b.textContent === texto) as HTMLButtonElement;
// Radix TabsTrigger ativa no `onMouseDown` (não no `onClick`) — ver @radix-ui/react-tabs/dist/index.mjs.
const clicarAba = (container: HTMLElement, texto: string) => {
  const btn = Array.from(container.querySelectorAll('button[role="tab"]')).find((b) => b.textContent === texto) as HTMLButtonElement;
  btn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
};

describe("ApiAba — Chaves (criar 1x, revogar)", () => {
  it("Nova chave: a chave aparece 1x com Copiar; fechar sem confirmar pede 'você copiou?'; a chave nunca fica na query nem em log depois", async () => {
    let chamadasCriar = 0;
    const view = await montar({
      rpcImpl: async (nome, args) => {
        if (nome === "integracao_config_ler") return { data: { campos: [], layout: [], rev: 1, api: null }, error: null };
        if (nome === "integracao_chaves_listar") return { data: [], error: null };
        if (nome === "integracao_chave_criar") {
          chamadasCriar++;
          expect((args as { _nome: string })._nome).toBe("ERP Principal");
          return { data: { id: "k1", nome: "ERP Principal", chave: "wish_live_SEGREDO123", final: "3123" }, error: null };
        }
        return { data: null, error: new Error(`RPC não mockada: ${nome}`) };
      },
    });
    await act(async () => { botaoDoc("Nova chave").click(); });
    const inputNome = document.getElementById("integracao-nome-chave") as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(inputNome, "ERP Principal");
      inputNome.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { botaoDoc("Criar").click(); });
    await view.esperar();
    expect(chamadasCriar).toBe(1);
    // A chave aparece — SÓ AGORA, 1x — com um botão Copiar. O título/descrição mostram a loja (m11).
    const inputChave = document.getElementById("integracao-chave-gerada") as HTMLInputElement;
    expect(inputChave.value).toBe("wish_live_SEGREDO123");
    expect(document.body.textContent).toMatch(/não pode ser mostrada de novo/);
    expect(document.body.textContent).toMatch(/loja Loja Teste/);
    // revisão T15 #4/m3 (code review): fechar SEM copiar pede confirmação.
    await act(async () => { botaoDoc("Concluído").click(); });
    expect(document.body.textContent).toMatch(/Você copiou a chave\?/);
    // "Voltar e copiar" mantém o diálogo aberto com a chave ainda visível.
    await act(async () => { botaoDoc("Voltar e copiar").click(); });
    expect(document.getElementById("integracao-chave-gerada")).not.toBeNull();
    // Copia com sucesso.
    await act(async () => { botaoDoc("Copiar").click(); });
    await view.esperar();
    expect((navigator.clipboard.writeText as any).mock.calls[0][0]).toBe("wish_live_SEGREDO123");
    // revisão T15 #4/m3 (code review): depois de copiar com SUCESSO, "Concluído" fecha DIRETO — sem perguntar de
    // novo (o aviso de "não pode ser mostrada de novo" já apareceu 1x, na caixa âmbar).
    await act(async () => { botaoDoc("Concluído").click(); });
    expect(document.body.textContent).not.toMatch(/Você copiou a chave\?/);
    // O diálogo (e a chave) sumiram do DOM — nada retém a chave em nenhum lugar visível.
    expect(document.getElementById("integracao-chave-gerada")).toBeNull();
    expect(document.body.textContent).not.toContain("wish_live_SEGREDO123");
    await view.desmontar();
  });

  it("fechar sem copiar e confirmar 'Sim, pode fechar' fecha de vez — a chave nunca fica em nenhum cache/query depois", async () => {
    const view = await montar({
      rpcImpl: async (nome) => {
        if (nome === "integracao_config_ler") return { data: { campos: [], layout: [], rev: 1, api: null }, error: null };
        if (nome === "integracao_chaves_listar") return { data: [], error: null };
        if (nome === "integracao_chave_criar") return { data: { id: "k1", nome: "ERP", chave: "wish_live_NUNCACOPIADA", final: "9999" }, error: null };
        return { data: null, error: new Error(`RPC não mockada: ${nome}`) };
      },
    });
    await act(async () => { botaoDoc("Nova chave").click(); });
    const inputNome = document.getElementById("integracao-nome-chave") as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(inputNome, "ERP");
      inputNome.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { botaoDoc("Criar").click(); });
    await view.esperar();
    await act(async () => { botaoDoc("Concluído").click(); });
    expect(document.body.textContent).toMatch(/Você copiou a chave\?/);
    await act(async () => { botaoDoc("Sim, pode fechar").click(); });
    // m10 (code review): a chave nunca aparece no cache de queries nem de mutations, em NENHUM lugar do JSON.
    const emQueries = JSON.stringify(view.qc.getQueryCache().getAll().map((q) => q.state.data));
    const emMutations = JSON.stringify(view.qc.getMutationCache().getAll().map((m) => m.state.data));
    expect(emQueries).not.toContain("wish_live_NUNCACOPIADA");
    expect(emMutations).not.toContain("wish_live_NUNCACOPIADA");
    expect(document.body.textContent).not.toContain("wish_live_NUNCACOPIADA");
    await view.desmontar();
  });

  it("Copiar sem permissão de clipboard cai no fallback de seleção (execCommand) e mostra erro só se o fallback também falhar", async () => {
    const view = await montar({
      comClipboard: false,
      rpcImpl: async (nome) => {
        if (nome === "integracao_config_ler") return { data: { campos: [], layout: [], rev: 1, api: null }, error: null };
        if (nome === "integracao_chaves_listar") return { data: [], error: null };
        if (nome === "integracao_chave_criar") return { data: { id: "k1", nome: "X", chave: "wish_live_ABC", final: "ABC1" }, error: null };
        return { data: null, error: new Error(`RPC não mockada: ${nome}`) };
      },
    });
    await act(async () => { botaoDoc("Nova chave").click(); });
    const inputNome = document.getElementById("integracao-nome-chave") as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(inputNome, "X");
      inputNome.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { botaoDoc("Criar").click(); });
    await view.esperar();
    // happy-dom não implementa `document.execCommand` — o fallback (m4) tenta chamar mesmo assim e cai no catch,
    // igual a um navegador real que recusa a cópia (ex.: sem gesto do usuário) — o toast de erro final é o mesmo.
    await act(async () => { botaoDoc("Copiar").click(); });
    await view.esperar();
    expect(view.toastMocks.error).toHaveBeenCalledWith("Não foi possível copiar — selecione o texto e copie à mão.");
    await view.desmontar();
  });

  // revisão T15 (Minor, code-review "Re-check round 1" — stub de sucesso do execCommand): o teste acima só cobre
  // o CAMINHO DE FALHA do fallback (happy-dom não implementa `execCommand` de verdade). Este stuba
  // `document.execCommand` pra devolver `true` — prova o CAMINHO DE SUCESSO do fallback (m4): toast de sucesso, a
  // chave marcada como copiada (fecha sem perguntar "você copiou?" de novo).
  it("Copiar sem permissão de clipboard, com execCommand stubado com sucesso: toast de sucesso e fecha sem reperguntar", async () => {
    const execCommandOriginal = document.execCommand;
    document.execCommand = vi.fn(() => true) as unknown as typeof document.execCommand;
    try {
      const view = await montar({
        comClipboard: false,
        rpcImpl: async (nome) => {
          if (nome === "integracao_config_ler") return { data: { campos: [], layout: [], rev: 1, api: null }, error: null };
          if (nome === "integracao_chaves_listar") return { data: [], error: null };
          if (nome === "integracao_chave_criar") return { data: { id: "k1", nome: "Y", chave: "wish_live_XYZ", final: "XYZ1" }, error: null };
          return { data: null, error: new Error(`RPC não mockada: ${nome}`) };
        },
      });
      await act(async () => { botaoDoc("Nova chave").click(); });
      const inputNome = document.getElementById("integracao-nome-chave") as HTMLInputElement;
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
        setter.call(inputNome, "Y");
        inputNome.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => { botaoDoc("Criar").click(); });
      await view.esperar();
      await act(async () => { botaoDoc("Copiar").click(); });
      await view.esperar();
      expect(document.execCommand).toHaveBeenCalledWith("copy");
      expect(view.toastMocks.success).toHaveBeenCalledWith("Chave copiada.");
      expect(view.toastMocks.error).not.toHaveBeenCalled();
      // Copiada com sucesso — "Concluído" fecha DIRETO, sem reperguntar "você copiou?" (m3).
      await act(async () => { botaoDoc("Concluído").click(); });
      expect(document.body.textContent).not.toMatch(/Você copiou a chave\?/);
      await view.desmontar();
    } finally {
      document.execCommand = execCommandOriginal;
    }
  });

  // revisão T15 #I1-R (code-review "Re-check round 1"): confirma que a criação de chave também passa por
  // `confirmarLojaAtiva` — a RPC de criação NUNCA é chamada se o servidor já está noutra loja.
  it("I1-R: confirmarLojaAtiva recusa criar chave quando o servidor já está noutra loja (RPC nunca chamada)", async () => {
    const view = await montar({
      confirmarLojaAtivaImpl: async () => {
        throw Object.assign(new Error("A loja ativa mudou (em outra aba ou janela). Recarregue a página antes de salvar."), { code: "LOJA_MUDOU" });
      },
      rpcImpl: async (nome) => {
        if (nome === "integracao_config_ler") return { data: { campos: [], layout: [], rev: 1, api: null }, error: null };
        if (nome === "integracao_chaves_listar") return { data: [], error: null };
        if (nome === "integracao_chave_criar") return { data: { id: "k1", nome: "Z", chave: "wish_live_NAO_DEVE_CRIAR", final: "0000" }, error: null };
        return { data: null, error: new Error(`RPC não mockada: ${nome}`) };
      },
    });
    await act(async () => { botaoDoc("Nova chave").click(); });
    const inputNome = document.getElementById("integracao-nome-chave") as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(inputNome, "Z");
      inputNome.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { botaoDoc("Criar").click(); });
    await view.esperar();
    expect(view.confirmarLojaAtivaSpy).toHaveBeenCalled();
    expect(view.rpcSpy.mock.calls.some((c) => c[0] === "integracao_chave_criar")).toBe(false);
    expect(view.toastMocks.error).toHaveBeenCalledWith("A loja ativa mudou (em outra aba ou janela). Recarregue a página antes de salvar.");
    // A chave nunca chegou a aparecer na tela.
    expect(document.getElementById("integracao-chave-gerada")).toBeNull();
    await view.desmontar();
  });

  // revisão T15 #2 (task review + code review I2): enquanto a chave criada está VISÍVEL na tela, a ABA conta
  // como suja — a guarda de navegação (Voltar/F5/troca de rota) tem que bloquear do MESMO jeito que bloqueia um
  // rascunho comum, porque fechar sem copiar perde o segredo pra sempre. Isso é agregado num ÚNICO
  // `useAbaSuja("api", sujoConfig || chaveVisivel)` em `ApiAba` (duas chamadas concorrentes se sobrescreveriam).
  it("revisão T15 #2: a chave visível marca a aba como suja (agregado numa ÚNICA useAbaSuja); some ao fechar", async () => {
    const view = await montar({
      comGuarda: true,
      rpcImpl: async (nome) => {
        if (nome === "integracao_config_ler") return { data: { campos: [], layout: [], rev: 1, api: null }, error: null };
        if (nome === "integracao_chaves_listar") return { data: [], error: null };
        if (nome === "integracao_chave_criar") return { data: { id: "k1", nome: "ERP", chave: "wish_live_VISIVEL", final: "1234" }, error: null };
        return { data: null, error: new Error(`RPC não mockada: ${nome}`) };
      },
    });
    expect(view.informarSujoSpy).not.toHaveBeenCalledWith("api", true);
    await act(async () => { botaoDoc("Nova chave").click(); });
    const inputNome = document.getElementById("integracao-nome-chave") as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(inputNome, "ERP");
      inputNome.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { botaoDoc("Criar").click(); });
    await view.esperar();
    // A chave apareceu — a aba fica suja mesmo sem nenhum campo de Configurações tocado.
    expect(view.informarSujoSpy).toHaveBeenCalledWith("api", true);
    await act(async () => { botaoDoc("Concluído").click(); });
    await act(async () => { botaoDoc("Sim, pode fechar").click(); });
    // Fechado (mesmo sem copiar) — a aba volta a "não suja".
    expect(view.informarSujoSpy).toHaveBeenLastCalledWith("api", false);
    await view.desmontar();
  });

  it("revogar chave: AlertDialog de confirmação, RPC com o id certo, invalida a lista", async () => {
    let chamadasRevogar = 0;
    const view = await montar({
      rpcImpl: async (nome, args) => {
        if (nome === "integracao_config_ler") return { data: { campos: [], layout: [], rev: 1, api: null }, error: null };
        if (nome === "integracao_chaves_listar") {
          return {
            data: [{ id: "k1", nome: "ERP Principal", final: "abcd", criada_por: "Ana", criada_em: "2026-08-02T12:00:00Z",
              revogada_em: null, ultimo_uso_em: null, hash: "NAO-PODE" }],
            error: null,
          };
        }
        if (nome === "integracao_chave_revogar") {
          chamadasRevogar++;
          expect((args as { _id: string })._id).toBe("k1");
          return { data: { ok: true }, error: null };
        }
        return { data: null, error: new Error(`RPC não mockada: ${nome}`) };
      },
    });
    // A chave nunca mostra o hash — só "····abcd" (nit de consistência: SEM espaço, mesmo formato do
    // Acessos/Log — `rotuloChaveAcesso`).
    expect(view.container.textContent).toContain("····abcd");
    expect(view.container.textContent).not.toContain("NAO-PODE");
    await act(async () => { botaoDoc("Revogar").click(); });
    expect(document.body.textContent).toMatch(/Revogar chave "ERP Principal"\?/);
    expect(document.body.textContent).toMatch(/O ERP perde o acesso na hora/);
    await act(async () => { botaoDoc("Revogar chave").click(); });
    await view.esperar();
    expect(chamadasRevogar).toBe(1);
    expect(view.toastMocks.success).toHaveBeenCalledWith("Chave revogada.");
    expect(view.invalidarIntegracaoSpy).toHaveBeenCalledWith(view.qc, "t1");
    await view.desmontar();
  });

  // revisão T15 #4/m8 (code review): revogar uma chave já revogada por outra pessoa dá erro — a lista tinha que
  // reler pra mostrar o estado real (senão a linha ficava mostrando "Revogar" pra sempre).
  it("m8: revogar com erro (já revogada por outra pessoa) invalida a lista mesmo assim", async () => {
    let leituras = 0;
    const view = await montar({
      rpcImpl: async (nome) => {
        if (nome === "integracao_config_ler") return { data: { campos: [], layout: [], rev: 1, api: null }, error: null };
        if (nome === "integracao_chaves_listar") {
          leituras++;
          const revogadaEm = leituras === 1 ? null : "2026-09-27T10:00:00Z";
          return {
            data: [{ id: "k1", nome: "ERP Principal", final: "abcd", criada_por: "Ana", criada_em: "2026-08-02T12:00:00Z",
              revogada_em: revogadaEm, ultimo_uso_em: null, hash: "NAO-PODE" }],
            error: null,
          };
        }
        if (nome === "integracao_chave_revogar") return { data: null, error: Object.assign(new Error("Chave não encontrada ou já revogada."), { code: "P0001" }) };
        return { data: null, error: new Error(`RPC não mockada: ${nome}`) };
      },
    });
    await act(async () => { botaoDoc("Revogar").click(); });
    await act(async () => { botaoDoc("Revogar chave").click(); });
    await view.esperar();
    expect(view.toastMocks.error).toHaveBeenCalledWith("Chave não encontrada ou já revogada.");
    expect(leituras).toBeGreaterThan(1); // a lista foi relida — o cache velho não fica pra sempre
    await view.esperar();
    // a próxima leitura já mostra "Revogada" (não mais o botão "Revogar").
    expect(view.container.textContent).toContain("Revogada");
    await view.desmontar();
  });
});

describe("ApiAba — Acessos recentes", () => {
  it("mostra só os últimos dígitos da chave (nunca o hash) e o status com rótulo/tom certos", async () => {
    const view = await montar({
      rpcImpl: async (nome) => {
        if (nome === "integracao_config_ler") return { data: { campos: [], layout: [], rev: 1, api: null }, error: null };
        if (nome === "integracao_chaves_listar") return { data: [], error: null };
        if (nome === "integracao_acessos_listar") {
          return {
            data: [
              { id: "a1", chave: "ERP Principal", final: "9f01", ip: null, modo: "normal", status: "ok", tentativas: 1,
                produtos: 12, exemplos: null, linhas: 40, quando: "2026-09-26T12:14:00Z" },
              { id: "a2", chave: null, final: null, ip: "203.0.113.9", modo: "normal", status: "chave_invalida", tentativas: 3,
                produtos: 0, exemplos: null, linhas: null, quando: "2026-09-26T12:15:00Z" },
            ],
            error: null,
          };
        }
        return { data: null, error: new Error(`RPC não mockada: ${nome}`) };
      },
    });
    await act(async () => { clicarAba(view.container, "Acessos recentes"); });
    await view.esperar();
    // revisão T15 #4/m9 (code review): o rótulo mostra nome + últimos dígitos — distingue chaves com o MESMO nome.
    expect(view.container.textContent).toContain("ERP Principal ····9f01");
    expect(view.container.textContent).toContain("Chave inválida (IP 203.0.113.9)");
    expect(view.container.textContent).toContain("OK");
    expect(view.container.textContent).toMatch(/Rejeitada ×3/);
    await view.desmontar();
  });
});

describe("ApiAba — Configurações da API (rev compartilhado com Campos)", () => {
  it("I2: rev CONGELADO no 1º toggle — um refetch em foco depois não muda o rev que o Salvar manda", async () => {
    let revAoVivo = 3;
    const view = await montar({
      rpcImpl: async (nome) => {
        if (nome === "integracao_config_ler") {
          return { data: { campos: [], layout: [], rev: revAoVivo, api: { limite_por_minuto: 60, max_por_pagina: 50, validade_foto_dias: 7, bloqueio_tentativas: 10 } }, error: null };
        }
        if (nome === "integracao_chaves_listar") return { data: [], error: null };
        if (nome === "integracao_salvar_config_api") return { data: { campos: [], layout: [], rev: revAoVivo + 1, api: null }, error: null };
        return { data: null, error: new Error(`RPC não mockada: ${nome}`) };
      },
    });
    await act(async () => { clicarAba(view.container, "Configurações da API"); });
    await view.esperar();
    const inputLimite = document.getElementById("cfg-limite_por_minuto") as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(inputLimite, "80");
      inputLimite.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // Um refetch em background (outra pessoa salvou a config — compartilha rev com Campos) chega DEPOIS do 1º toggle.
    revAoVivo = 4;
    await act(async () => { await view.qc.refetchQueries({ queryKey: ["integracao-config", "t1"] }); });
    const botaoSalvar = () => Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent?.trim().startsWith("Salvar")) as HTMLButtonElement;
    await act(async () => { botaoSalvar().click(); });
    // 80 está fora do recomendado (60) — abre o AlertDialog "Fora do recomendado" antes de salvar de verdade.
    await act(async () => { botaoDoc("Salvar mesmo assim").click(); });
    await view.esperar();
    const chamada = view.rpcSpy.mock.calls.find((c) => c[0] === "integracao_salvar_config_api");
    expect(chamada).toBeDefined();
    expect((chamada![1] as { _rev: number })._rev).toBe(3); // o rev CONGELADO no 1º toggle, não o 4 do refetch.
    await view.desmontar();
  });

  it("P0409: rebaseia os valores do usuário em cima dos frescos, mostra banner, e o PRÓXIMO save usa o rev fresco (sem loop)", async () => {
    let leituras = 0;
    let chamadasSalvar = 0;
    const view = await montar({
      rpcImpl: async (nome) => {
        if (nome === "integracao_config_ler") {
          leituras++;
          if (leituras === 1) return { data: { campos: [], layout: [], rev: 1, api: { limite_por_minuto: 60, max_por_pagina: 50, validade_foto_dias: 7, bloqueio_tentativas: 10 } }, error: null };
          // Outra pessoa mudou "validade_foto_dias" (de 7 pra 14) e o rev foi pra 2.
          return { data: { campos: [], layout: [], rev: 2, api: { limite_por_minuto: 60, max_por_pagina: 50, validade_foto_dias: 14, bloqueio_tentativas: 10 } }, error: null };
        }
        if (nome === "integracao_chaves_listar") return { data: [], error: null };
        if (nome === "integracao_salvar_config_api") {
          chamadasSalvar++;
          if (chamadasSalvar === 1) return { data: null, error: Object.assign(new Error("conflito_versao: x"), { code: "P0409" }) };
          return { data: null, error: null };
        }
        return { data: null, error: new Error(`RPC não mockada: ${nome}`) };
      },
    });
    await act(async () => { clicarAba(view.container, "Configurações da API"); });
    await view.esperar();
    // Usuário muda "limite_por_minuto" de 60 pra 80 — campo DIFERENTE do que a outra pessoa mudou (validade_foto_dias).
    const inputLimite = document.getElementById("cfg-limite_por_minuto") as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(inputLimite, "80");
      inputLimite.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const botaoSalvar = () => Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent?.trim().startsWith("Salvar")) as HTMLButtonElement;
    await act(async () => { botaoSalvar().click(); });
    // 80 está fora do recomendado (60) — abre o AlertDialog "Fora do recomendado" antes de salvar de verdade.
    await act(async () => { botaoDoc("Salvar mesmo assim").click(); });
    await view.esperar();
    await view.esperar();
    expect(chamadasSalvar).toBe(1); // nenhum retry automático em loop
    expect(view.container.textContent).toMatch(/as suas mudanças foram mantidas por cima da versão nova/);
    // revisão T15 #3/m1 (task review I1 + code review m5): o banner mostra o DIFF do que a outra pessoa mudou.
    expect(view.container.textContent).toMatch(/Mudou na loja:/);
    expect(view.container.textContent).toMatch(/Validade das fotos: 7 → 14/);
    // revisão T15 #3 (task review I1): com rascunho vivo (o usuário ainda tem 80 rebaseado), o banner oferece
    // "usar a da loja"/"manter a minha" — MESMO padrão de CamposAba.
    expect(botaoDoc("usar a da loja")).toBeDefined();
    expect(botaoDoc("manter a minha")).toBeDefined();
    // O valor do usuário (80) sobrevive; o campo que a OUTRA pessoa mudou (validade) reflete o valor fresco (14).
    expect((document.getElementById("cfg-limite_por_minuto") as HTMLInputElement).value).toContain("80");
    expect((document.getElementById("cfg-validade_foto_dias") as HTMLInputElement).value).toContain("14");
    // 2º Salvar: usa o REV FRESCO (2), não o velho (1). Ainda fora do recomendado — passa pelo mesmo AlertDialog.
    await act(async () => { botaoSalvar().click(); });
    await act(async () => { botaoDoc("Salvar mesmo assim").click(); });
    await view.esperar();
    expect(chamadasSalvar).toBe(2);
    const chamadas = view.rpcSpy.mock.calls.filter((c) => c[0] === "integracao_salvar_config_api");
    expect((chamadas[0][1] as { _rev: number })._rev).toBe(1);
    expect((chamadas[1][1] as { _rev: number })._rev).toBe(2);
    // task review m4 (gap de teste): o PAYLOAD do 2º save também é conferido, não só o _rev — carrega o valor do
    // usuário (limite 80) rebaseado sobre o valor fresco de tudo o mais (incluindo a validade que a outra pessoa mudou).
    expect((chamadas[1][1] as { _valores: unknown })._valores).toEqual({
      limite_por_minuto: 80, max_por_pagina: 50, validade_foto_dias: 14, bloqueio_tentativas: 10,
    });
    await view.desmontar();
  });

  // revisão T15 #3 (task review I1): "usar a da loja" descarta o rascunho rebaseado e adota os valores frescos.
  it("P0409: 'usar a da loja' descarta o rascunho — os campos mostram os valores frescos e a aba deixa de estar suja", async () => {
    let leituras = 0;
    const view = await montar({
      comGuarda: true,
      rpcImpl: async (nome) => {
        if (nome === "integracao_config_ler") {
          leituras++;
          if (leituras === 1) return { data: { campos: [], layout: [], rev: 1, api: { limite_por_minuto: 60, max_por_pagina: 50, validade_foto_dias: 7, bloqueio_tentativas: 10 } }, error: null };
          return { data: { campos: [], layout: [], rev: 2, api: { limite_por_minuto: 60, max_por_pagina: 50, validade_foto_dias: 14, bloqueio_tentativas: 10 } }, error: null };
        }
        if (nome === "integracao_chaves_listar") return { data: [], error: null };
        if (nome === "integracao_salvar_config_api") return { data: null, error: Object.assign(new Error("conflito_versao: x"), { code: "P0409" }) };
        return { data: null, error: new Error(`RPC não mockada: ${nome}`) };
      },
    });
    await act(async () => { clicarAba(view.container, "Configurações da API"); });
    await view.esperar();
    const inputLimite = document.getElementById("cfg-limite_por_minuto") as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(inputLimite, "80");
      inputLimite.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const botaoSalvar = () => Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent?.trim().startsWith("Salvar")) as HTMLButtonElement;
    await act(async () => { botaoSalvar().click(); });
    await act(async () => { botaoDoc("Salvar mesmo assim").click(); });
    await view.esperar();
    await view.esperar();
    expect(botaoDoc("usar a da loja")).toBeDefined();
    await act(async () => { botaoDoc("usar a da loja").click(); });
    // O campo volta a mostrar o valor FRESCO do servidor (60, não mais 80).
    expect((document.getElementById("cfg-limite_por_minuto") as HTMLInputElement).value).toContain("60");
    expect((document.getElementById("cfg-validade_foto_dias") as HTMLInputElement).value).toContain("14");
    expect(botaoSalvar().disabled).toBe(true);
    expect(view.informarSujoSpy).toHaveBeenLastCalledWith("api", false);
    await view.desmontar();
  });

  // task review m4 (gap de teste, plan-mandated): as 3 variantes do banner do P0409 precisam de teste, não só a
  // do "caso geral" (já coberta acima). "Só o rev mudou" — outra pessoa salvou a config da API (mesmo rev
  // compartilhado com Campos) com os MESMOS valores; nada de real mudou.
  it("P0409: 'só o rev mudou' (falso conflito) — os valores não mudaram de verdade, texto específico", async () => {
    let leituras = 0;
    const view = await montar({
      rpcImpl: async (nome) => {
        if (nome === "integracao_config_ler") {
          leituras++;
          // MESMOS valores nas duas leituras — só o rev muda (Campos salvou algo, compartilha o rev).
          return { data: { campos: [], layout: [], rev: leituras === 1 ? 1 : 2, api: { limite_por_minuto: 60, max_por_pagina: 50, validade_foto_dias: 7, bloqueio_tentativas: 10 } }, error: null };
        }
        if (nome === "integracao_chaves_listar") return { data: [], error: null };
        if (nome === "integracao_salvar_config_api") return { data: null, error: Object.assign(new Error("conflito_versao: x"), { code: "P0409" }) };
        return { data: null, error: new Error(`RPC não mockada: ${nome}`) };
      },
    });
    await act(async () => { clicarAba(view.container, "Configurações da API"); });
    await view.esperar();
    const inputLimite = document.getElementById("cfg-limite_por_minuto") as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(inputLimite, "80");
      inputLimite.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const botaoSalvar = () => Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent?.trim().startsWith("Salvar")) as HTMLButtonElement;
    await act(async () => { botaoSalvar().click(); });
    await act(async () => { botaoDoc("Salvar mesmo assim").click(); });
    await view.esperar();
    await view.esperar();
    expect(document.body.textContent).toMatch(/A configuração foi salva por outra pessoa enquanto você editava; as suas mudanças continuam aqui\./);
    // O valor do usuário sobrevive — a mudança dele não foi tocada pelo falso conflito.
    expect((document.getElementById("cfg-limite_por_minuto") as HTMLInputElement).value).toContain("80");
    await view.desmontar();
  });

  // task review m4 (gap de teste): "nada a salvar" — o rebase deixou a seleção do usuário IDÊNTICA à fresca
  // (outra pessoa já fez exatamente a mesma mudança).
  it("P0409: 'nada a salvar' — outra pessoa já fez a MESMA mudança; rascunho fecha, sem afirmar 'mudanças mantidas'", async () => {
    let leituras = 0;
    const view = await montar({
      rpcImpl: async (nome) => {
        if (nome === "integracao_config_ler") {
          leituras++;
          if (leituras === 1) return { data: { campos: [], layout: [], rev: 1, api: { limite_por_minuto: 60, max_por_pagina: 50, validade_foto_dias: 7, bloqueio_tentativas: 10 } }, error: null };
          // A outra pessoa JÁ mudou limite pra 80 — a MESMA mudança que o usuário local fez.
          return { data: { campos: [], layout: [], rev: 2, api: { limite_por_minuto: 80, max_por_pagina: 50, validade_foto_dias: 7, bloqueio_tentativas: 10 } }, error: null };
        }
        if (nome === "integracao_chaves_listar") return { data: [], error: null };
        if (nome === "integracao_salvar_config_api") return { data: null, error: Object.assign(new Error("conflito_versao: x"), { code: "P0409" }) };
        return { data: null, error: new Error(`RPC não mockada: ${nome}`) };
      },
    });
    await act(async () => { clicarAba(view.container, "Configurações da API"); });
    await view.esperar();
    const inputLimite = document.getElementById("cfg-limite_por_minuto") as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(inputLimite, "80"); // mesma mudança que a loja já tem
      inputLimite.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const botaoSalvar = () => Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent?.trim().startsWith("Salvar")) as HTMLButtonElement;
    await act(async () => { botaoSalvar().click(); });
    await act(async () => { botaoDoc("Salvar mesmo assim").click(); });
    await view.esperar();
    await view.esperar();
    expect(document.body.textContent).toMatch(/não sobrou nada para salvar/);
    expect(document.body.textContent).not.toMatch(/exatamente/);
    // n2: o rascunho fechou — Salvar volta a ficar desabilitado.
    expect(botaoSalvar().disabled).toBe(true);
    expect((document.getElementById("cfg-limite_por_minuto") as HTMLInputElement).value).toContain("80");
    // 1 botão só ("Entendi") — não há mais rascunho pra escolher entre "minha"/"da loja".
    expect(botaoDoc("usar a da loja")).toBeUndefined();
    expect(botaoDoc("Entendi")).toBeDefined();
    await view.desmontar();
  });

  // revisão T15 (nit residual das revisões anteriores — "refetch falha depois de um P0409" nunca tinha teste):
  // o P0409 fecha a confirmação e tenta um `q.refetch()` pra confirmar o valor mais recente; se ESSE refetch
  // falhar (rede), a seleção do usuário fica INTOCADA e um toast específico orienta a tentar salvar de novo — sem
  // rebasear nada (não há valor fresco pra rebasear contra).
  it("P0409 seguido de falha no refetch de confirmação: seleção do usuário intocada, toast de 'não foi possível confirmar'", async () => {
    let leituras = 0;
    const view = await montar({
      rpcImpl: async (nome) => {
        if (nome === "integracao_config_ler") {
          leituras++;
          if (leituras === 1) return { data: { campos: [], layout: [], rev: 1, api: { limite_por_minuto: 60, max_por_pagina: 50, validade_foto_dias: 7, bloqueio_tentativas: 10 } }, error: null };
          // O refetch de confirmação (pós-P0409) falha (rede).
          return { data: null, error: new Error("Falha de conexão") };
        }
        if (nome === "integracao_chaves_listar") return { data: [], error: null };
        if (nome === "integracao_salvar_config_api") return { data: null, error: Object.assign(new Error("conflito_versao: x"), { code: "P0409" }) };
        return { data: null, error: new Error(`RPC não mockada: ${nome}`) };
      },
    });
    await act(async () => { clicarAba(view.container, "Configurações da API"); });
    await view.esperar();
    const inputLimite = document.getElementById("cfg-limite_por_minuto") as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(inputLimite, "80");
      inputLimite.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const botaoSalvar = () => Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent?.trim().startsWith("Salvar")) as HTMLButtonElement;
    await act(async () => { botaoSalvar().click(); });
    await act(async () => { botaoDoc("Salvar mesmo assim").click(); });
    await view.esperar();
    await view.esperar();
    expect(view.toastMocks.error).toHaveBeenCalledWith("Não foi possível confirmar o valor mais recente (falha de conexão). Tente salvar de novo.");
    // A seleção do usuário fica intocada — nenhum rebase, nenhum reset (nada fresco pra confiar).
    expect((document.getElementById("cfg-limite_por_minuto") as HTMLInputElement).value).toContain("80");
    // Sem banner de conflito (o refetch falhou antes de chegar lá) — Salvar segue habilitado pra tentar de novo.
    expect(document.body.textContent).not.toMatch(/mantidas por cima da versão nova/);
    expect(botaoSalvar().disabled).toBe(false);
    await view.desmontar();
  });

  // task review m4 (gap de teste, plan-mandated): "outros erros mantêm o formulário" — 42501/rede/P0001 NÃO
  // rebaseiam nem resetam o rascunho, ao contrário do P0409.
  it("outros erros (42501) mantêm o formulário intocado — sem rebase, sem reset, seleção do usuário fica", async () => {
    const view = await montar({
      rpcImpl: async (nome) => {
        if (nome === "integracao_config_ler") return { data: { campos: [], layout: [], rev: 1, api: { limite_por_minuto: 60, max_por_pagina: 50, validade_foto_dias: 7, bloqueio_tentativas: 10 } }, error: null };
        if (nome === "integracao_chaves_listar") return { data: [], error: null };
        if (nome === "integracao_salvar_config_api") return { data: null, error: Object.assign(new Error("Só o super admin pode fazer isto."), { code: "42501" }) };
        return { data: null, error: new Error(`RPC não mockada: ${nome}`) };
      },
    });
    await act(async () => { clicarAba(view.container, "Configurações da API"); });
    await view.esperar();
    const inputLimite = document.getElementById("cfg-limite_por_minuto") as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(inputLimite, "80");
      inputLimite.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const botaoSalvar = () => Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent?.trim().startsWith("Salvar")) as HTMLButtonElement;
    await act(async () => { botaoSalvar().click(); });
    await act(async () => { botaoDoc("Salvar mesmo assim").click(); });
    await view.esperar();
    // A seleção do usuário fica EXATAMENTE como estava — nunca reseta, nunca rebaseia.
    expect((document.getElementById("cfg-limite_por_minuto") as HTMLInputElement).value).toContain("80");
    expect(view.toastMocks.error).toHaveBeenCalledWith("Só o super admin pode fazer isto.");
    // Nenhum banner de conflito (não é P0409) — Salvar continua habilitado pra tentar de novo.
    expect(document.body.textContent).not.toMatch(/mantidas por cima da versão nova/);
    expect(botaoSalvar().disabled).toBe(false);
    await view.desmontar();
  });

  // revisão T15 #1 (code-review I1, "wrong-store save" — defesa em profundidade): mesma prova de `CamposAba`, mas
  // para a config da API. O `Edicao` da Configuracoes também carrega o `tenantId` em que nasceu.
  it("revisão T15 #1: rascunho de Configurações nascido na loja A não é salvo depois de o tenant ativo virar B (RPC nunca chamada)", async () => {
    const tenantIdRef = { current: "lojaA" };
    const view = await montar({ tenantIdRef });
    await act(async () => { clicarAba(view.container, "Configurações da API"); });
    await view.esperar();
    const inputLimite = document.getElementById("cfg-limite_por_minuto") as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(inputLimite, "70"); // fora do recomendado (60) — abre o AlertDialog antes de salvar de verdade
      inputLimite.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // O super admin troca de loja (o componente NÃO desmonta — simula a ausência do key={tenantId}).
    tenantIdRef.current = "lojaB";
    await view.rerender();
    const botaoSalvar = () => Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent?.trim().startsWith("Salvar")) as HTMLButtonElement;
    await act(async () => { botaoSalvar().click(); });
    await act(async () => { botaoDoc("Salvar mesmo assim").click(); });
    await view.esperar();
    expect(view.rpcSpy.mock.calls.some((c) => c[0] === "integracao_salvar_config_api")).toBe(false);
    expect(view.toastMocks.error).toHaveBeenCalledWith("A loja ativa mudou (em outra aba ou janela). Recarregue a página antes de salvar.");
    await view.desmontar();
  });

  // revisão T15 #I1-R (code-review "Re-check round 1"): a defesa acima (`Edicao.tenantId` vs `tenantId` cacheado)
  // só pega uma troca que ESTA aba já viu no cache. Uma 2ª aba/janela que trocou a loja no SERVIDOR sem que esta
  // aba reobservasse a query (`tenantId` continua "t1" nos dois lados) precisa de `confirmarLojaAtiva` — a
  // ÚLTIMA linha de defesa, que relê DIRETO do servidor imediatamente antes do `rpc`.
  it("I1-R: confirmarLojaAtiva recusa salvar Configurações da API quando o servidor já está noutra loja (RPC nunca chamada)", async () => {
    const view = await montar({
      confirmarLojaAtivaImpl: async () => {
        throw Object.assign(new Error("A loja ativa mudou (em outra aba ou janela). Recarregue a página antes de salvar."), { code: "LOJA_MUDOU" });
      },
    });
    await act(async () => { clicarAba(view.container, "Configurações da API"); });
    await view.esperar();
    const inputLimite = document.getElementById("cfg-limite_por_minuto") as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(inputLimite, "60"); // dentro do recomendado — Salvar direto, sem o AlertDialog "Fora do recomendado"
      inputLimite.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(inputLimite, "70");
      inputLimite.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const botaoSalvar = () => Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent?.trim().startsWith("Salvar")) as HTMLButtonElement;
    await act(async () => { botaoSalvar().click(); });
    await act(async () => { botaoDoc("Salvar mesmo assim").click(); });
    await view.esperar();
    expect(view.confirmarLojaAtivaSpy).toHaveBeenCalled();
    expect(view.rpcSpy.mock.calls.some((c) => c[0] === "integracao_salvar_config_api")).toBe(false);
    expect(view.toastMocks.error).toHaveBeenCalledWith("A loja ativa mudou (em outra aba ou janela). Recarregue a página antes de salvar.");
    await view.desmontar();
  });

  it("valor fora da faixa permitida bloqueia o Salvar com erro em PT (não chama a RPC)", async () => {
    const view = await montar();
    await act(async () => { clicarAba(view.container, "Configurações da API"); });
    await view.esperar();
    const inputLimite = document.getElementById("cfg-limite_por_minuto") as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(inputLimite, "9999");
      inputLimite.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(view.container.textContent).toMatch(/fora da faixa permitida/);
    const botaoSalvar = () => Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent?.trim().startsWith("Salvar")) as HTMLButtonElement;
    expect(botaoSalvar().disabled).toBe(true);
    await view.desmontar();
  });

  it("valor dentro da faixa mas fora do recomendado alerta antes de salvar, com opção de voltar ao recomendado", async () => {
    const view = await montar();
    await act(async () => { clicarAba(view.container, "Configurações da API"); });
    await view.esperar();
    const inputLimite = document.getElementById("cfg-limite_por_minuto") as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(inputLimite, "120"); // dentro da faixa (1-600), fora do recomendado (60)
      inputLimite.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const botaoSalvar = () => Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent?.trim().startsWith("Salvar")) as HTMLButtonElement;
    expect(botaoSalvar().disabled).toBe(false);
    await act(async () => { botaoSalvar().click(); });
    expect(document.body.textContent).toMatch(/Fora do recomendado/);
    expect(document.body.textContent).toMatch(/Recomendado: 60\./);
    await act(async () => { botaoDoc("Voltar ao recomendado").click(); });
    expect((document.getElementById("cfg-limite_por_minuto") as HTMLInputElement).value).toContain("60");
    // task review m4 (gap de teste): "Voltar ao recomendado" também precisa FECHAR o rascunho (o valor voltou a
    // bater com o servidor) — Salvar desabilita, sem precisar de outro clique/estado intermediário.
    expect(botaoSalvar().disabled).toBe(true);
    await view.desmontar();
  });

  // revisão T15 #4/m7 (code review): "Fora do recomendado" e "Voltar ao recomendado" só consideram as chaves que
  // o USUÁRIO tocou — um campo que a loja já tinha de propósito fora do recomendado (ex.: `max_por_pagina=200`
  // num plano pago) não entra no alerta nem é revertido, mesmo estando tecnicamente "fora do recomendado".
  it("m7: 'Fora do recomendado'/'Voltar ao recomendado' ignoram um campo que a loja já tinha fora do recomendado e o usuário NÃO tocou", async () => {
    const view = await montar({ api: { limite_por_minuto: 60, max_por_pagina: 200, validade_foto_dias: 7, bloqueio_tentativas: 10 } });
    await act(async () => { clicarAba(view.container, "Configurações da API"); });
    await view.esperar();
    // O usuário só toca "bloqueio_tentativas" — nunca mexe em "max_por_pagina" (200, já fora do recomendado 50).
    const inputBloqueio = document.getElementById("cfg-bloqueio_tentativas") as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(inputBloqueio, "20"); // também fora do recomendado (10) — É a chave tocada
      inputBloqueio.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const botaoSalvar = () => Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent?.trim().startsWith("Salvar")) as HTMLButtonElement;
    await act(async () => { botaoSalvar().click(); });
    // O alerta cita SÓ "Bloqueio de IP" (a chave tocada) — nunca "Máximo por página" (200, intocado).
    expect(document.body.textContent).toMatch(/Fora do recomendado/);
    expect(document.body.textContent).toMatch(/Bloqueio de IP/);
    expect(document.body.textContent).not.toMatch(/Máximo por página/);
    await act(async () => { botaoDoc("Voltar ao recomendado").click(); });
    // "Voltar ao recomendado" reverteu SÓ a chave tocada (bloqueio volta a 10) — max_por_pagina CONTINUA 200
    // (o valor que a loja já tinha de propósito), nunca revertido pra 50 em silêncio.
    expect((document.getElementById("cfg-bloqueio_tentativas") as HTMLInputElement).value).toContain("10");
    expect((document.getElementById("cfg-max_por_pagina") as HTMLInputElement).value).toContain("200");
    await view.desmontar();
  });

  it("P-89 A: 'Máximo por página' acima de 100 mostra o alerta do plano gratuito no campo E no diálogo de confirmação", async () => {
    const view = await montar();
    await act(async () => { clicarAba(view.container, "Configurações da API"); });
    await view.esperar();
    const inputPagina = document.getElementById("cfg-max_por_pagina") as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(inputPagina, "150"); // dentro da faixa (1-500), acima de 100 (P-89 A)
      inputPagina.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(view.container.textContent).toMatch(/plano gratuito do Cloudflare/);
    const botaoSalvar = () => Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent?.trim().startsWith("Salvar")) as HTMLButtonElement;
    await act(async () => { botaoSalvar().click(); });
    expect(document.body.textContent).toMatch(/Plano gratuito:/);
    await view.desmontar();
  });

  // revisão T15 (nit "Plano gratuito só se tocado", code-review "Re-check round 1"): a loja já tinha
  // `max_por_pagina=150` (>100) de PROPÓSITO (plano pago) — o usuário toca só "bloqueio_tentativas" (também fora
  // do recomendado). O diálogo "Fora do recomendado" tem que citar SÓ o campo tocado, e a linha extra "Plano
  // gratuito:" (que fala especificamente de `max_por_pagina`) não deve aparecer — sem isso, ela aparecia sempre
  // que QUALQUER campo estivesse fora do recomendado E `max_por_pagina` já estivesse >100, mesmo intocado.
  it("nit: 'Plano gratuito:' no diálogo só aparece se 'Máximo por página' foi TOCADO nesta edição", async () => {
    const view = await montar({ api: { limite_por_minuto: 60, max_por_pagina: 150, validade_foto_dias: 7, bloqueio_tentativas: 10 } });
    await act(async () => { clicarAba(view.container, "Configurações da API"); });
    await view.esperar();
    const inputBloqueio = document.getElementById("cfg-bloqueio_tentativas") as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(inputBloqueio, "20"); // fora do recomendado (10) — É a chave TOCADA; max_por_pagina (150) fica intocado
      inputBloqueio.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const botaoSalvar = () => Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent?.trim().startsWith("Salvar")) as HTMLButtonElement;
    await act(async () => { botaoSalvar().click(); });
    expect(document.body.textContent).toMatch(/Fora do recomendado/);
    expect(document.body.textContent).toMatch(/Bloqueio de IP/);
    expect(document.body.textContent).not.toMatch(/Plano gratuito:/);
    await view.desmontar();
  });

  it("dirty guard: useAbaSuja é chamado com true ao editar e false depois de salvar com sucesso", async () => {
    const view = await montar({ comGuarda: true });
    await act(async () => { clicarAba(view.container, "Configurações da API"); });
    await view.esperar();
    const inputLimite = document.getElementById("cfg-limite_por_minuto") as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(inputLimite, "60"); // MESMO valor do servidor — não deve sujar nada
      inputLimite.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(view.informarSujoSpy).not.toHaveBeenCalledWith("api", true);
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(inputLimite, "80");
      inputLimite.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(view.informarSujoSpy).toHaveBeenCalledWith("api", true);
    const botaoSalvar = () => Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent?.trim().startsWith("Salvar")) as HTMLButtonElement;
    await act(async () => { botaoSalvar().click(); });
    // 80 está fora do recomendado (60) — abre o AlertDialog "Fora do recomendado" antes de salvar de verdade.
    await act(async () => { botaoDoc("Salvar mesmo assim").click(); });
    await view.esperar();
    await view.esperar();
    expect(view.informarSujoSpy).toHaveBeenLastCalledWith("api", false);
    await view.desmontar();
  });

  it("os inputs travam (disabled) enquanto o Salvar está em voo", async () => {
    let liberar: (() => void) | null = null;
    const trava = new Promise<void>((resolve) => { liberar = resolve; });
    const view = await montar({
      rpcImpl: async (nome) => {
        if (nome === "integracao_config_ler") return { data: { campos: [], layout: [], rev: 1, api: { limite_por_minuto: 60, max_por_pagina: 50, validade_foto_dias: 7, bloqueio_tentativas: 10 } }, error: null };
        if (nome === "integracao_chaves_listar") return { data: [], error: null };
        if (nome === "integracao_salvar_config_api") { await trava; return { data: null, error: null }; }
        return { data: null, error: new Error(`RPC não mockada: ${nome}`) };
      },
    });
    await act(async () => { clicarAba(view.container, "Configurações da API"); });
    await view.esperar();
    const inputLimite = document.getElementById("cfg-limite_por_minuto") as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(inputLimite, "80");
      inputLimite.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const botaoSalvar = () => Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent?.trim().startsWith("Salvar")) as HTMLButtonElement;
    await act(async () => { botaoSalvar().click(); });
    // 80 está fora do recomendado (60) — abre o AlertDialog "Fora do recomendado" antes de salvar de verdade.
    await act(async () => { botaoDoc("Salvar mesmo assim").click(); });
    await view.esperar();
    expect((document.getElementById("cfg-limite_por_minuto") as HTMLInputElement).disabled).toBe(true);
    liberar!();
    await view.esperar();
    await view.esperar();
    await view.desmontar();
  });
});
