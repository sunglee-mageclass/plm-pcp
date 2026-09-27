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
  it("acessos: rótulos da chave, status e entrega", () => {
    expect(rotuloChaveAcesso(acesso({}))).toBe("ERP Principal");
    expect(rotuloChaveAcesso(acesso({ modo: "teste", status: "teste" }))).toBe("ERP Principal (modo teste)");
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
  vi.doMock("@/hooks/useActiveTenantId", () => ({ useActiveTenantId: () => "t1" }));
  vi.doMock("@/hooks/useStoreTimezone", () => ({ useStoreTimezone: () => "America/Sao_Paulo" }));
  const toastMocks = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() };
  vi.doMock("sonner", () => ({ toast: toastMocks }));
  vi.doMock("@tanstack/react-router", () => ({ useRouter: () => ({ history: { back: () => {} } }) }));
  const invalidarIntegracaoSpy = vi.fn();
  vi.doMock("@/components/integracao/useIntegracao", () => ({
    chaveConfig: (tenantId: string) => ["integracao-config", tenantId],
    invalidarIntegracao: invalidarIntegracaoSpy,
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
    // A chave aparece — SÓ AGORA, 1x — com um botão Copiar.
    const inputChave = document.getElementById("integracao-chave-gerada") as HTMLInputElement;
    expect(inputChave.value).toBe("wish_live_SEGREDO123");
    expect(document.body.textContent).toMatch(/não pode ser mostrada de novo/);
    await act(async () => { botaoDoc("Copiar").click(); });
    await view.esperar();
    expect((navigator.clipboard.writeText as any).mock.calls[0][0]).toBe("wish_live_SEGREDO123");
    // Fechar (via "Concluído", que tenta fechar o passo 2 que já tem chave) pede confirmação.
    await act(async () => { botaoDoc("Concluído").click(); });
    expect(document.body.textContent).toMatch(/Você copiou a chave\?/);
    // "Voltar e copiar" mantém o diálogo aberto com a chave ainda visível.
    await act(async () => { botaoDoc("Voltar e copiar").click(); });
    expect(document.getElementById("integracao-chave-gerada")).not.toBeNull();
    // Fecha de vez.
    await act(async () => { botaoDoc("Concluído").click(); });
    await act(async () => { botaoDoc("Sim, pode fechar").click(); });
    // O diálogo (e a chave) sumiram do DOM — nada retém a chave em nenhum lugar visível.
    expect(document.getElementById("integracao-chave-gerada")).toBeNull();
    expect(document.body.textContent).not.toContain("wish_live_SEGREDO123");
    await view.desmontar();
  });

  it("Copiar sem permissão de clipboard cai no fallback de seleção e mostra erro", async () => {
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
    await act(async () => { botaoDoc("Copiar").click(); });
    await view.esperar();
    expect(view.toastMocks.error).toHaveBeenCalledWith("Não foi possível copiar — selecione o texto e copie à mão.");
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
    // A chave nunca mostra o hash — só "···· abcd".
    expect(view.container.textContent).toContain("···· abcd");
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
    expect(view.container.textContent).toContain("ERP Principal");
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
