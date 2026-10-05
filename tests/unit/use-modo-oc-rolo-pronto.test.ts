// @vitest-environment happy-dom
// [backend F2.2 / R7] `useModoOcRoloEstado`: `pronto` só é true com a leitura bem-sucedida. 1ª carga com erro = pronto false + erro true
// (o modo exibido continua 'ambos', mas quem GRAVA não pode decidir com ele); a próxima leitura boa libera.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({ resp: { data: null as any, error: null as any } }));
vi.mock("@/hooks/useActiveTenantId", () => ({ useActiveTenantId: () => "T1" }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => {
      const q: any = { select: () => q, eq: () => q, maybeSingle: () => Promise.resolve(h.resp) };
      return q;
    },
  },
}));

import { useModoOcRoloEstado, type ModoOcRoloEstado } from "@/hooks/useModoOcRolo";

let visto: ModoOcRoloEstado | null = null;
function Sonda() {
  visto = useModoOcRoloEstado();
  return null;
}
let qc: QueryClient;
async function montar() {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRoot(document.createElement("div"));
  await act(async () => { root.render(createElement(QueryClientProvider, { client: qc }, createElement(Sonda))); });
}
const assentar = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

beforeEach(() => { visto = null; h.resp = { data: null, error: null }; });

describe("useModoOcRoloEstado", () => {
  it("antes da resposta: pronto false (modo 'ambos' só para exibir)", async () => {
    h.resp = { data: { modo_oc_rolo: "rolo" }, error: null };
    await montar();
    expect(visto?.pronto).toBe(false);
    expect(visto?.modo).toBe("ambos");
    await assentar();
    expect(visto).toMatchObject({ pronto: true, modo: "rolo", erro: false });
  });

  it("sucesso sem linha de config: pronto true com 'ambos' (padrão legítimo, conhecido)", async () => {
    await montar();
    await assentar();
    expect(visto).toMatchObject({ pronto: true, modo: "ambos", erro: false });
  });

  it("1ª carga com erro: pronto false + erro true (Salvar continua bloqueado); a leitura boa seguinte libera", async () => {
    h.resp = { data: null, error: { message: "rede" } };
    await montar();
    await assentar();
    expect(visto).toMatchObject({ pronto: false, modo: "ambos", erro: true });
    h.resp = { data: { modo_oc_rolo: "oc" }, error: null };
    await act(async () => { visto!.recarregar(); });
    await assentar();
    expect(visto).toMatchObject({ pronto: true, modo: "oc", erro: false });
  });

  it("refetch com erro depois de um sucesso mantém pronto true e o modo de antes", async () => {
    h.resp = { data: { modo_oc_rolo: "rolo" }, error: null };
    await montar();
    await assentar();
    h.resp = { data: null, error: { message: "rede" } };
    await act(async () => { await qc.refetchQueries({ queryKey: ["tenant_config", "modo_oc_rolo"] }); });
    await assentar();
    expect(visto).toMatchObject({ pronto: true, modo: "rolo", erro: false });
  });
});
