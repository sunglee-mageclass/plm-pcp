import { describe, it, expect } from "vitest";
import { agregar } from "@/lib/import/aggregate";
import { contarPendencias } from "@/components/importar/AbaAnalise";
import { insumoDescriptor } from "@/lib/import/entities/insumo.descriptor";
import { tecidoDescriptor } from "@/lib/import/entities/tecido.descriptor";
import type { LookupMaps, RawRow } from "@/lib/import/types";

// grade tolerante p/ o insumo: "34" e "PPP" → chave "34|PPP"
const gradeMap = new Map<string, string>();
for (const k of ["34|PPP", "36|PP", "38|P", "40|M"]) {
  const [n, s] = k.split("|");
  gradeMap.set(k.toLowerCase(), k);
  gradeMap.set(n.toLowerCase(), k);
  gradeMap.set(s.toLowerCase(), k);
}

const maps: LookupMaps = {
  cores: new Map([["branco", "cor-branco"], ["azul", "cor-azul"]]),
  apelidos: new Map(),
  tipos: new Map([["etiqueta", "tipo-etq"]]),
  categorias: new Map(),
  materiais: new Map(),
  tamanhos: gradeMap,
  fornecedores: new Map([["silva", ["emp-silva"]]]),
  representantes: new Map(),
};

function row(n: number, over: Partial<Record<string, string>> = {}): RawRow {
  return { __linha: n, nome: "", ...over } as RawRow;
}

const SEM_IGNORADAS = new Set<string>();

// Regressão da revisão (refactor multi-tipo): o gate de pendência é ATÔMICO entre tipos —
// uma pendência falsa numa aba trava o Confirmar de TODAS. Insumo sem cor (só tamanho) tem
// `cor_id: null` LEGÍTIMO e NÃO pode contar como pendência (bug: `!v.cor_id` marcava).
describe("contarPendencias — cor null legítima vs cor não resolvida", () => {
  it("insumo SÓ com tamanho (sem cor) → 0 pendências (cor null é legítima)", () => {
    const ag = agregar(insumoDescriptor, [row(2, { nome: "Etiqueta A", tamanhos: "34,36" })], maps);
    // variante existe, com cor_id null — não é pendência
    expect(ag.entidades[0].variantes.every((v) => v.cor_id === null)).toBe(true);
    expect(contarPendencias(ag.entidades, SEM_IGNORADAS)).toBe(0);
  });

  it("insumo com cor VÁLIDA + tamanho → 0 pendências", () => {
    const ag = agregar(insumoDescriptor, [row(2, { nome: "Etiqueta B", cor_base: "Branco", tamanhos: "34" })], maps);
    expect(contarPendencias(ag.entidades, SEM_IGNORADAS)).toBe(0);
  });

  it("insumo com cor DIGITADA que não casou → 1 pendência (erro cor_base)", () => {
    const ag = agregar(insumoDescriptor, [row(2, { nome: "Etiqueta C", cor_base: "Roxo", tamanhos: "34" })], maps);
    expect(ag.entidades[0].problemas.some((p) => p.nivel === "erro" && p.campo === "cor_base")).toBe(true);
    expect(contarPendencias(ag.entidades, SEM_IGNORADAS)).toBe(1);
  });

  it("tecido com cor VÁLIDA → 0 pendências", () => {
    const ag = agregar(tecidoDescriptor, [row(2, { nome: "Malha", cor_base: "Azul" })], maps);
    expect(contarPendencias(ag.entidades, SEM_IGNORADAS)).toBe(0);
  });

  it("tecido com cor NÃO resolvida (obrigatória) → 1 pendência", () => {
    const ag = agregar(tecidoDescriptor, [row(2, { nome: "Malha", cor_base: "Verde" })], maps);
    expect(ag.entidades[0].problemas.some((p) => p.nivel === "erro" && p.campo === "cor_base")).toBe(true);
    expect(contarPendencias(ag.entidades, SEM_IGNORADAS)).toBe(1);
  });

  it("entidade IGNORADA não conta como pendência", () => {
    const ag = agregar(tecidoDescriptor, [row(2, { nome: "Malha", cor_base: "Verde" })], maps);
    const ignoradas = new Set(ag.entidades.map((e) => e.chave));
    expect(contarPendencias(ag.entidades, ignoradas)).toBe(0);
  });
});
