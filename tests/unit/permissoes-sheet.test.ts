import { describe, it, expect } from "vitest";
import { resolverPermissoesSheet } from "@/components/planejamento/planejamento-detail/permissoes-sheet";

describe("resolverPermissoesSheet — P-53 A, princípio 'nem ganha, nem perde'", () => {
  it("edita plan + edita dev → tudo editável", () => {
    const p = resolverPermissoesSheet({ podeEditarPlanejamento: true, podeEditarDev: true, devBloqueado: false });
    expect(p).toEqual({
      sheetSomenteLeitura: false,
      planBloqueado: false,
      compartilhadoBloqueado: false,
      podeAcoesPlanejamento: true,
    });
  });

  it("edita plan, não dev (devBloqueado=true) → sheet editável, plan livre, compartilhado LIVRE, ações ok", () => {
    const p = resolverPermissoesSheet({ podeEditarPlanejamento: true, podeEditarDev: false, devBloqueado: true });
    expect(p.sheetSomenteLeitura).toBe(false);
    expect(p.planBloqueado).toBe(false);
    expect(p.compartilhadoBloqueado).toBe(false);
    expect(p.podeAcoesPlanejamento).toBe(true);
  });

  it("edita dev, não plan, devBloqueado=false → sheet editável, plan TRAVADO, compartilhado livre, ações NÃO", () => {
    const p = resolverPermissoesSheet({ podeEditarPlanejamento: false, podeEditarDev: true, devBloqueado: false });
    expect(p.sheetSomenteLeitura).toBe(false);
    expect(p.planBloqueado).toBe(true);
    expect(p.compartilhadoBloqueado).toBe(false);
    expect(p.podeAcoesPlanejamento).toBe(false);
  });

  it("edita dev, não plan, devBloqueado=true (pós-Explosão sem 'Editar') → sheet editável, plan travado, compartilhado TRAVADO, ações não", () => {
    const p = resolverPermissoesSheet({ podeEditarPlanejamento: false, podeEditarDev: true, devBloqueado: true });
    expect(p.sheetSomenteLeitura).toBe(false);
    expect(p.planBloqueado).toBe(true);
    expect(p.compartilhadoBloqueado).toBe(true);
    expect(p.podeAcoesPlanejamento).toBe(false);
  });

  it("nenhum (só vê os dois; devBloqueado=true por falta de permissão) → sheet só-leitura, tudo travado", () => {
    const p = resolverPermissoesSheet({ podeEditarPlanejamento: false, podeEditarDev: false, devBloqueado: true });
    expect(p).toEqual({
      sheetSomenteLeitura: true,
      planBloqueado: true,
      compartilhadoBloqueado: true,
      podeAcoesPlanejamento: false,
    });
  });
});
