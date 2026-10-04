// [modularidade F1, parte 2, P-251 C] Mapa de dependências entre módulos: FONTE ÚNICA em código (sem tela no Gerenciar Lojas).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { MODULE_DEPS, MODULE_ROTULO, PAGES_CATALOG, faltasDeModulo } from "@/lib/permissions-catalog";
import type { ModuleKey } from "@/hooks/useTenantModules";
import { motivoModulos, textoAcaoPrecisaDeModulos, listaDeRotulos, modulosComArtigo } from "@/lib/modulos-texto";

// As 11 chaves de módulo = a união de `ModuleKey` (lida do texto do hook: não existe lista em runtime).
const HOOK = readFileSync("src/hooks/useTenantModules.ts", "utf8");
const CHAVES = [...HOOK.slice(HOOK.indexOf("export type ModuleKey"), HOOK.indexOf("const DEFAULTS")).matchAll(/\| "([a-z_]+)"/g)].map((m) => m[1] as ModuleKey);

describe("MODULE_ROTULO / MODULE_DEPS", () => {
  it("as 11 chaves de módulo têm rótulo (e só elas)", () => {
    expect(CHAVES).toHaveLength(11);
    expect(Object.keys(MODULE_ROTULO).sort()).toEqual([...CHAVES].sort());
    for (const k of CHAVES) expect(MODULE_ROTULO[k].length).toBeGreaterThan(0);
  });

  it("toda dependência declarada aponta para chave válida, sem repetir nem exigir a si mesma, com motivo em PT", () => {
    for (const [dono, dep] of Object.entries(MODULE_DEPS)) {
      expect(CHAVES).toContain(dono);
      expect(dep!.exige.length).toBeGreaterThan(0);
      expect(new Set(dep!.exige).size).toBe(dep!.exige.length);
      for (const e of dep!.exige) {
        expect(CHAVES).toContain(e);
        expect(e).not.toBe(dono);
      }
      expect(dep!.motivo.length).toBeGreaterThan(10);
    }
  });

  it("o grafo é acíclico", () => {
    const visitando = new Set<string>();
    const feito = new Set<string>();
    const visita = (k: ModuleKey) => {
      expect(visitando.has(k), `ciclo passando por ${k}`).toBe(false);
      if (feito.has(k)) return;
      visitando.add(k);
      for (const e of MODULE_DEPS[k]?.exige ?? []) visita(e);
      visitando.delete(k);
      feito.add(k);
    };
    for (const k of CHAVES) visita(k);
  });

  it("valores do desenho (P-251 C): Produção, Produto Acabado/Importado, OTB, Distribuição, Etapas PL", () => {
    expect(MODULE_DEPS.producao?.exige).toEqual(["criacao", "entrada_saida"]);
    expect(MODULE_DEPS.produto_acabado?.exige).toEqual(["criacao", "entrada_saida", "producao", "otb"]);
    expect(MODULE_DEPS.produto_importado?.exige).toEqual(["criacao", "entrada_saida", "producao", "otb"]);
    expect(MODULE_DEPS.otb?.exige).toEqual(["criacao"]);
    expect(MODULE_DEPS.distribuicao?.exige).toEqual(["otb", "criacao"]);
    expect(MODULE_DEPS.etapas_pl?.exige).toEqual(["producao"]);
    for (const livre of ["cadastro", "entrada_saida", "criacao", "financeiro", "dashboard"] as ModuleKey[]) {
      expect(MODULE_DEPS[livre]).toBeUndefined();
    }
  });

  it("faltasDeModulo nas 11 chaves: tudo ligado → nada falta; tudo desligado → as dependências na ordem do mapa", () => {
    const tudo = Object.fromEntries(CHAVES.map((k) => [k, true])) as Record<ModuleKey, boolean>;
    const nada = Object.fromEntries(CHAVES.map((k) => [k, false])) as Record<ModuleKey, boolean>;
    for (const k of CHAVES) {
      expect(faltasDeModulo(tudo, k)).toEqual([]);
      expect(faltasDeModulo(nada, k)).toEqual(MODULE_DEPS[k]?.exige ?? []);
    }
  });

  it("faltasDeModulo: só as que faltam; chave ausente conta como desligada", () => {
    expect(faltasDeModulo({ criacao: true, entrada_saida: true, producao: true }, "produto_acabado")).toEqual(["otb"]);
    expect(faltasDeModulo({ criacao: true }, "producao")).toEqual(["entrada_saida"]);
    expect(faltasDeModulo({}, "etapas_pl")).toEqual(["producao"]);
  });

  it("gates de PÁGINA da frente: Explosão → criacao, Plan. Tecido → otb; todo gate de página é chave de módulo", () => {
    const paginas = PAGES_CATALOG.flatMap((m) => m.pages);
    const gate = (k: string) => paginas.find((p) => p.key === k)?.gate;
    expect(gate("producao_explosao")).toBe("criacao");
    expect(gate("criacao_plan_tecido")).toBe("otb");
    expect(gate("criacao_produto_acabado")).toBe("produto_acabado");
    expect(gate("entrada_oc_p_importado")).toBe("produto_importado");
    expect(gate("producao_etapas")).toBe("etapas_pl");
    for (const p of paginas) if (p.gate) expect(CHAVES).toContain(p.gate);
  });

  it("não é usado no Gerenciar Lojas (P-251 C): nada de MODULE_DEPS/faltasDeModulo em admin/lojas.tsx", () => {
    const lojas = readFileSync("src/routes/_authenticated/admin/lojas.tsx", "utf8");
    expect(lojas).not.toMatch(/MODULE_DEPS|faltasDeModulo|useRequerModulo|ModuloDesligadoAviso/);
  });
});

describe("textos PT-BR de módulo", () => {
  it("listaDeRotulos / modulosComArtigo (singular, plural, 3)", () => {
    expect(listaDeRotulos(["criacao"])).toBe("Criação");
    expect(listaDeRotulos(["criacao", "producao"])).toBe("Criação e Produção");
    expect(listaDeRotulos(["criacao", "entrada_saida", "producao"])).toBe("Criação, Entrada e Saída e Produção");
    expect(modulosComArtigo(["otb"], "do")).toBe("do módulo OTB");
    expect(modulosComArtigo(["otb", "criacao"], "do")).toBe("dos módulos OTB e Criação");
    expect(modulosComArtigo(["otb"], "o")).toBe("o módulo OTB");
    expect(modulosComArtigo(["otb", "criacao"], "o")).toBe("os módulos OTB e Criação");
  });

  it("chave desconhecida = a própria chave (nunca texto vazio)", () => {
    expect(listaDeRotulos(["modulo_novo"])).toBe("modulo_novo");
  });

  it("motivoModulos / textoAcaoPrecisaDeModulos", () => {
    expect(motivoModulos(["entrada_saida"])).toBe("Precisa do módulo Entrada e Saída — fale com o administrador do sistema.");
    expect(motivoModulos(["criacao", "producao"])).toBe("Precisa dos módulos Criação e Produção — fale com o administrador do sistema.");
    expect(motivoModulos([])).toBe("");
    expect(textoAcaoPrecisaDeModulos(["otb"])).toBe("Esta ação precisa do módulo OTB — fale com o administrador do sistema.");
  });
});
