import { describe, it, expect } from "vitest";
import { makeEmptyBlocks } from "@/components/desenvolvimento/modelo-detail/types";
import { emptyDraft, type Draft } from "@/components/planejamento/modelo-shared";
import type { Derivacao, KanbanAutoConfig } from "@/lib/kanban-auto";
import { gateEnvioExplosao, pendenciasEnvioExplosao } from "@/components/planejamento/planejamento-detail/ficha/envio-explosao";

// F3.3 — "Enviar à Explosão" no Sheet unificado: gate por etapa com a posição DERIVADA quando a chave está ligada
// (decisão travada 10; SQL `_explosao_envio_gate(_kanban_status_gate(...))`, F1 20260930140000:842) e a lista
// "Para enviar, falta" (Dev ModeloDetailPanel.tsx:1576-1595) com as seções do Sheet do Planejamento.
const board = [
  { key: "desenho_tecnico", label: "Desenho Técnico" }, { key: "em_modelagem", label: "Em Modelagem" },
  { key: "em_ajuste", label: "Em Ajuste" }, { key: "aprovado", label: "Aprovado" },
];
const cfg = (ligado: boolean): KanbanAutoConfig => ({
  kanban_automatico: ligado, status_kanban: board, kanban_requisitos: {}, kanban_requisitos_excecoes: {},
  revenda_kanban_colunas: [], revenda_kanban_requisitos: {},
});
const deriv = (alvo: string | null, derivavel = true): Derivacao => ({
  derivavel, entrada: "desenho_tecnico", alvo, resultado: "em_ajuste", fixado: true, primeiraFalha: null, faltando: [],
});

describe("gateEnvioExplosao", () => {
  it("chave desligada: status gravado antes da etapa exigida (padrão Aprovado) ⇒ bloqueia e diz a etapa", () => {
    expect(gateEnvioExplosao({ cfg: cfg(false), explosaoEnvioStatus: null, statusCru: "em_ajuste", derivacao: null, condProntas: true }))
      .toEqual({ ok: false, carregando: false, reqLabel: "Aprovado" });
  });
  it("chave desligada: na etapa ⇒ libera", () => {
    expect(gateEnvioExplosao({ cfg: cfg(false), explosaoEnvioStatus: null, statusCru: "aprovado", derivacao: null, condProntas: true }).ok).toBe(true);
  });
  it("chave LIGADA: card fixado em coluna manual antes da etapa, mas DERIVADO em Aprovado ⇒ libera (decisão 10)", () => {
    expect(gateEnvioExplosao({ cfg: cfg(true), explosaoEnvioStatus: null, statusCru: "em_ajuste", derivacao: deriv("aprovado"), condProntas: true }).ok).toBe(true);
  });
  it("chave LIGADA: gravado em Aprovado mas DERIVADO antes ⇒ bloqueia", () => {
    expect(gateEnvioExplosao({ cfg: cfg(true), explosaoEnvioStatus: null, statusCru: "aprovado", derivacao: deriv("em_modelagem"), condProntas: true }).ok).toBe(false);
  });
  it("chave LIGADA e condições ainda não carregadas ⇒ 'carregando' (não libera no escuro)", () => {
    expect(gateEnvioExplosao({ cfg: cfg(true), explosaoEnvioStatus: null, statusCru: "aprovado", derivacao: null, condProntas: false }))
      .toEqual({ ok: false, carregando: true, reqLabel: "" });
  });
  it("antes da Ordem de Criação (sem status) ⇒ bloqueia", () => {
    expect(gateEnvioExplosao({ cfg: cfg(false), explosaoEnvioStatus: null, statusCru: null, derivacao: null, condProntas: true }).ok).toBe(false);
  });
  it("etapa configurada pela loja (explosao_envio_status) vale", () => {
    expect(gateEnvioExplosao({ cfg: cfg(false), explosaoEnvioStatus: "em_modelagem", statusCru: "em_ajuste", derivacao: null, condProntas: true }).ok).toBe(true);
  });
});

describe("pendenciasEnvioExplosao", () => {
  const completo = (): Draft => ({
    ...emptyDraft(), ref: "VEMD0142", nome: "Vestido", estilista_id: "e", categoria_principal_id: "c",
    data_desenho_tecnico: "2026-09-01", data_piloto1: "2026-09-02",
  });
  const blocosOk = () => makeEmptyBlocks().map((b) => (b.tipo === "tecido" && b.numero === 1 ? { ...b, artigo_id: "a", variantes: ["v1", ...Array(9).fill(null)] } : b));
  const gradesOk = [{ variante_numero: 1, grades: { P: 1 }, grade_total: 1 }];
  it("tudo preenchido ⇒ nada falta", () => {
    expect(pendenciasEnvioExplosao({ draft: completo(), blocks: blocosOk(), grades: gradesOk, rotuloRef: "REF" })).toEqual([]);
  });
  it("cada pendência aponta a seção onde se resolve", () => {
    const d = { ...completo(), ref: "", nome: "", data_piloto1: "", piloteiro2_id: "p2" };
    const out = pendenciasEnvioExplosao({ draft: d, blocks: makeEmptyBlocks(), grades: [], rotuloRef: "REF" });
    expect(out).toEqual([
      { label: "REF", secao: "desenvolvimento" },
      { label: "Nome", secao: "info" },
      { label: "ao menos 1 tecido com variante", secao: "tecidos" },
      { label: "grade preenchida", secao: "grade" },
      { label: "Data Piloto 1", secao: "desenvolvimento" },
      { label: "Data Piloto 2", secao: "desenvolvimento" },
    ]);
  });
  it("tecido selecionado sem variante ⇒ '1 variante em cada tecido/forro/entretela selecionado'", () => {
    const b = blocosOk().map((x) => (x.tipo === "forro" && x.numero === 1 ? { ...x, artigo_id: "f" } : x));
    expect(pendenciasEnvioExplosao({ draft: completo(), blocks: b, grades: gradesOk, rotuloRef: "REF" }))
      .toEqual([{ label: "1 variante em cada tecido/forro/entretela selecionado", secao: "tecidos" }]);
  });
});

describe("pendenciasEnvioExplosao — F3.4 comprado (Dev ModeloDetailPanel.tsx:1577-1595, `campoVisivel`)", () => {
  const minimos = (): Draft => ({ ...emptyDraft(), ref: "ONV0000001", nome: "Vestido", estilista_id: "e", categoria_principal_id: "c" });
  const soVisivel = (vis: string[]) => (k: string) => vis.includes(k);
  it("default do comprado (Tecidos e datas ocultos, Grade visível): só a grade cor × tamanho", () => {
    expect(pendenciasEnvioExplosao({
      draft: minimos(), blocks: makeEmptyBlocks(), grades: [], rotuloRef: "REF",
      campoVisivel: soVisivel(["s3", "s3e", "s4", "s5", "s6"]), secaoGrade: "grade_revenda",
    })).toEqual([{ label: "grade preenchida", secao: "grade_revenda" }]);
  });
  it("com a grade preenchida: nada falta", () => {
    expect(pendenciasEnvioExplosao({
      draft: minimos(), blocks: makeEmptyBlocks(), grades: [{ variante_numero: 1, grades: { "38|P": 1 }, grade_total: 1 }],
      rotuloRef: "REF", campoVisivel: soVisivel(["s4"]), secaoGrade: "grade_revenda",
    })).toEqual([]);
  });
  it("os mínimos (REF, Nome, Estilista, Categoria) valem sempre, mesmo com tudo oculto", () => {
    expect(pendenciasEnvioExplosao({
      draft: { ...minimos(), ref: "", estilista_id: null }, blocks: makeEmptyBlocks(), grades: [], rotuloRef: "REF", campoVisivel: () => false,
    })).toEqual([{ label: "REF", secao: "desenvolvimento" }, { label: "Estilista", secao: "info" }]);
  });
  it("sem `campoVisivel`: o fluxo interno de sempre (F3.3)", () => {
    expect(pendenciasEnvioExplosao({ draft: minimos(), blocks: makeEmptyBlocks(), grades: [], rotuloRef: "REF" }).map((p) => p.label))
      .toEqual(["ao menos 1 tecido com variante", "grade preenchida", "Data Desenho Técnico", "Data Piloto 1"]);
  });

  // Fix round T7 (Important, RULING) — módulo da família (Produto Acabado/Produto Importado) desligado: a grade nunca
  // carrega, "grade preenchida" ficaria permanente e o link apontaria pra uma seção que não existe no Sheet.
  describe("gradeIndisponivel — módulo da origem desligado", () => {
    it("troca o texto da pendência de grade e OMITE `secao` (sem link)", () => {
      const out = pendenciasEnvioExplosao({
        draft: minimos(), blocks: makeEmptyBlocks(), grades: [], rotuloRef: "REF",
        campoVisivel: soVisivel(["s4"]), secaoGrade: "grade_revenda",
        gradeIndisponivel: "Grade cor × tamanho indisponível — o módulo Produto Acabado está desligado nesta loja; peça ao administrador.",
      });
      expect(out).toEqual([{ label: "Grade cor × tamanho indisponível — o módulo Produto Acabado está desligado nesta loja; peça ao administrador." }]);
      expect(out[0].secao).toBeUndefined();
    });
    it("tem PRECEDÊNCIA sobre a checagem normal de Σgrade_total, mesmo com grade preenchida (o módulo nunca deixaria isso acontecer, mas a regra é: se veio, prevalece)", () => {
      const out = pendenciasEnvioExplosao({
        draft: minimos(), blocks: makeEmptyBlocks(), grades: [{ variante_numero: 1, grades: { "38|P": 1 }, grade_total: 1 }],
        rotuloRef: "REF", campoVisivel: soVisivel(["s4"]), secaoGrade: "grade_revenda", gradeIndisponivel: "Indisponível.",
      });
      expect(out).toEqual([{ label: "Indisponível." }]);
    });
    it("sem 's4' visível: a pendência nem aparece (a seção da grade está fora do Fluxo de Revenda desta loja)", () => {
      const out = pendenciasEnvioExplosao({
        draft: minimos(), blocks: makeEmptyBlocks(), grades: [], rotuloRef: "REF",
        campoVisivel: soVisivel([]), secaoGrade: "grade_revenda", gradeIndisponivel: "Indisponível.",
      });
      expect(out).toEqual([]);
    });
    it("`gradeIndisponivel` ausente: comportamento de antes (checagem normal com link)", () => {
      const out = pendenciasEnvioExplosao({
        draft: minimos(), blocks: makeEmptyBlocks(), grades: [], rotuloRef: "REF",
        campoVisivel: soVisivel(["s4"]), secaoGrade: "grade_revenda",
      });
      expect(out).toEqual([{ label: "grade preenchida", secao: "grade_revenda" }]);
    });
  });
});
