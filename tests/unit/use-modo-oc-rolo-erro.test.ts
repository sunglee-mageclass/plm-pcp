// @vitest-environment happy-dom
// [backend F1, review m2] `useModoOcRolo`: o erro da leitura SOBE. Refetch com erro mantém o modo de antes (antes virava "ambos"
// como sucesso e valia 5 min); 1ª carga com erro cai em "ambos" (padrão de sempre, o mais permissivo).
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

import { useModoOcRolo } from "@/hooks/useModoOcRolo";

let visto = "";
function Sonda() {
  visto = useModoOcRolo();
  return null;
}
let qc: QueryClient;
async function montar() {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRoot(document.createElement("div"));
  await act(async () => { root.render(createElement(QueryClientProvider, { client: qc }, createElement(Sonda))); });
}
const assentar = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

beforeEach(() => { visto = ""; h.resp = { data: null, error: null }; });

describe("useModoOcRolo", () => {
  it("sucesso: devolve o modo gravado; sem linha = 'ambos'", async () => {
    h.resp = { data: { modo_oc_rolo: "rolo" }, error: null };
    await montar();
    await assentar();
    expect(visto).toBe("rolo");
  });

  it("REFETCH com erro mantém o modo de antes (não vira 'ambos')", async () => {
    h.resp = { data: { modo_oc_rolo: "rolo" }, error: null };
    await montar();
    await assentar();
    h.resp = { data: null, error: { message: "rede" } };
    await act(async () => { await qc.refetchQueries({ queryKey: ["tenant_config", "modo_oc_rolo"] }); });
    await assentar();
    expect(visto).toBe("rolo");
  });

  it("1ª carga com erro → 'ambos' (padrão) sem gravar como sucesso: a próxima leitura boa vale", async () => {
    h.resp = { data: null, error: { message: "rede" } };
    await montar();
    await assentar();
    expect(visto).toBe("ambos");
    expect(qc.getQueryData(["tenant_config", "modo_oc_rolo", "T1"])).toBeUndefined();
    h.resp = { data: { modo_oc_rolo: "oc" }, error: null };
    await act(async () => { await qc.refetchQueries({ queryKey: ["tenant_config", "modo_oc_rolo"] }); });
    await assentar();
    expect(visto).toBe("oc");
  });
});
