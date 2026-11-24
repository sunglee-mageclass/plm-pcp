// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/no-explicit-any -- mocks */
// `useIntegracaoEstadosCarregados`: a MESMA consulta de `useIntegracaoEstados`, mas com o sinal "chegou" que a grade precisa
// (concern #1 da PR-1: `{}` enquanto carrega NÃO pode parecer "nenhum produto travado").
import { describe, it, expect, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

async function montarHook(rpc: () => Promise<any>) {
  vi.resetModules();
  vi.doMock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
  vi.doMock("@/hooks/useActiveTenantId", () => ({ useActiveTenantId: () => "tenant1" }));
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
  const { useIntegracaoEstadosCarregados, useIntegracaoEstados } =
    await import("@/hooks/useIntegracaoEstado");
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const visto: {
    c: ReturnType<typeof useIntegracaoEstadosCarregados> | null;
    s: ReturnType<typeof useIntegracaoEstados> | null;
  } = { c: null, s: null };
  function Sonda() {
    visto.c = useIntegracaoEstadosCarregados();
    visto.s = useIntegracaoEstados();
    return null;
  }
  const root = createRoot(document.createElement("div"));
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: qc }, createElement(Sonda)));
  });
  return { visto, qc, desmontar: () => act(async () => root.unmount()) };
}
const flush = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });

describe("useIntegracaoEstadosCarregados", () => {
  it("carregando: pronto=false (e o hook antigo segue devolvendo {} — comportamento intocado)", async () => {
    let liberar!: (v: any) => void;
    const t = await montarHook(() => new Promise((r) => (liberar = r)));
    expect(t.visto.c!.pronto).toBe(false);
    expect(t.visto.c!.erro).toBe(false);
    expect(t.visto.s).toEqual({});
    await act(async () =>
      liberar({ data: { M1: { estado: "integravel", campos: ["nome"] } }, error: null }),
    );
    await flush();
    expect(t.visto.c!.pronto).toBe(true);
    expect(t.visto.c!.estados.M1.estado).toBe("integravel");
    expect(t.visto.s!.M1.estado).toBe("integravel"); // mesma consulta/cache
    await t.desmontar();
  });

  it("1ª carga com ERRO: pronto=false e erro=true (as travas seguem bloqueadas); 'recarregar' recupera", async () => {
    let falha = true;
    const t = await montarHook(async () =>
      falha ? { data: null, error: { message: "x" } } : { data: {}, error: null },
    );
    await flush();
    expect(t.visto.c!.pronto).toBe(false);
    expect(t.visto.c!.erro).toBe(true);
    falha = false;
    await act(async () => {
      await t.visto.c!.recarregar();
    });
    await flush();
    expect(t.visto.c!.pronto).toBe(true);
    expect(t.visto.c!.erro).toBe(false);
    await t.desmontar();
  });

  it("refetch com erro DEPOIS de ter dado: continua pronto (mantém o último estado bom, nunca volta a 'carregando')", async () => {
    let falha = false;
    const t = await montarHook(async () =>
      falha
        ? { data: null, error: { message: "x" } }
        : { data: { M1: { estado: "integrado", campos: [] } }, error: null },
    );
    await flush();
    expect(t.visto.c!.pronto).toBe(true);
    falha = true;
    await act(async () => {
      await t.qc.refetchQueries({ queryKey: ["integracao-estado"] });
    });
    await flush();
    expect(t.visto.c!.pronto).toBe(true);
    expect(t.visto.c!.erro).toBe(false);
    expect(t.visto.c!.estados.M1.estado).toBe("integrado");
    await t.desmontar();
  });
});
