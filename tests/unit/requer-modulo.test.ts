// [modularidade F1, parte 3] useRequerModulo: `ok`/`faltam`/`motivo` prontos para o botão que atravessa módulo.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ ret: { modules: {} as Record<string, boolean>, pronto: true } }));
vi.mock("@/hooks/useTenantModules", () => ({
  useTenantModules: () => ({
    isModuleEnabled: (k: string) => !!h.ret.modules[k],
    pronto: h.ret.pronto,
  }),
}));

import { useRequerModulo, motivoModulos } from "@/hooks/useRequerModulo";

beforeEach(() => {
  h.ret = { modules: { criacao: true, entrada_saida: true, producao: false, otb: false }, pronto: true };
});

describe("useRequerModulo", () => {
  it("todos ligados → ok, sem faltas, sem motivo", () => {
    expect(useRequerModulo("criacao", "entrada_saida")).toEqual({ ok: true, faltam: [], motivo: "" });
  });

  it("um desligado → ok false e o motivo em PT", () => {
    expect(useRequerModulo("entrada_saida", "producao")).toEqual({
      ok: false,
      faltam: ["producao"],
      motivo: "Precisa do módulo Produção — fale com o administrador do sistema.",
    });
  });

  it("vários desligados → plural, na ordem pedida", () => {
    const r = useRequerModulo("producao", "criacao", "otb");
    expect(r.ok).toBe(false);
    expect(r.faltam).toEqual(["producao", "otb"]);
    expect(r.motivo).toBe("Precisa dos módulos Produção e OTB — fale com o administrador do sistema.");
  });

  it("config da loja ainda não chegou → ok false e 'Carregando…' (nunca libera nem acusa módulo por engano)", () => {
    h.ret = { modules: { criacao: true, entrada_saida: true }, pronto: false };
    expect(useRequerModulo("criacao")).toEqual({ ok: false, faltam: [], motivo: "Carregando…" });
  });

  it("motivoModulos (puro) exportado para teste", () => {
    expect(motivoModulos(["entrada_saida"])).toBe("Precisa do módulo Entrada e Saída — fale com o administrador do sistema.");
    expect(motivoModulos(["criacao", "producao"])).toBe("Precisa dos módulos Criação e Produção — fale com o administrador do sistema.");
  });
});
