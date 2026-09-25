// F3.2 — selos de completude das seções do BOM no Sheet do Planejamento. MAPA PRÓPRIO seção →
// condições (decisão travada 8: o catálogo `kanban-condicoes.ts` e o tipo `CondicaoSecao`, que
// seguem as chaves do accordion do Dev, NÃO mudam). Regra portada do `reqBadge` do Dev
// (ModeloDetailPanel.tsx:1644-1677) + os selos informativos das seções (:2854-2974).
import { CONDICAO_BY_KEY, type Condicao } from "@/lib/kanban-condicoes";
import type { ResumoBom } from "./ficha-calc";

export type SecaoBomKey = "tecidos" | "aviamentos" | "insumos" | "grade";

export const CONDICOES_SECAO_BOM: Record<SecaoBomKey, readonly string[]> = {
  // "Tecido planejado" não tem seção no catálogo (só kanban); no card unificado a lista é derivada
  // dos blocos desta seção — o selo passa a refletir isso.
  tecidos: ["tecido_com_variante", "tecido_planejado"],
  aviamentos: ["aviamento_definido"],
  insumos: [],
  grade: ["grade_preenchida", "grade_todas_variantes"],
};

export type SeloSecao = {
  tone: "ok" | "info" | "warn" | "muted";
  texto: string;
  title?: string;
  /** Quando falta UM requisito: a condição, p/ o "i" explicativo (CondicaoInfo). */
  condicaoUnica?: Condicao;
};

/** União das condições exigidas em QUALQUER coluna (o que a loja configurou). */
export function requisitosUniao(req: unknown): Set<string> {
  const s = new Set<string>();
  if (!req || typeof req !== "object") return s;
  for (const arr of Object.values(req as Record<string, unknown>)) {
    if (!Array.isArray(arr)) continue;
    for (const k of arr) if (typeof k === "string") s.add(k);
  }
  return s;
}

/** F3.3 — a regra do `reqBadge` do Dev (ModeloDetailPanel.tsx:1658-1677) para QUALQUER lista de chaves: sem requisito da
 *  loja nas chaves ⇒ null (cai no informativo); todos satisfeitos ⇒ "ok"; senão "falta x"/"faltam N" com a condição. */
export function seloPorChaves(chaves: readonly string[], requeridas: ReadonlySet<string>, satisfeitas: Record<string, boolean>): SeloSecao | null {
  const conds = chaves
    .map((k) => CONDICAO_BY_KEY.get(k))
    .filter((c): c is Condicao => !!c && requeridas.has(c.key));
  if (conds.length === 0) return null;
  const faltam = conds.filter((c) => !satisfeitas[c.key]);
  if (faltam.length === 0) return { tone: "ok", texto: "ok" };
  const labels = faltam.map((c) => c.label.replace(/^Anexo: /, ""));
  return {
    tone: "warn",
    texto: faltam.length === 1 ? `falta ${labels[0].toLowerCase()}` : `faltam ${faltam.length}`,
    title: `Falta: ${labels.join(", ")}`,
    condicaoUnica: faltam.length === 1 ? faltam[0] : undefined,
  };
}

function seloPorRequisito(secao: SecaoBomKey, requeridas: ReadonlySet<string>, satisfeitas: Record<string, boolean>): SeloSecao | null {
  return seloPorChaves(CONDICOES_SECAO_BOM[secao], requeridas, satisfeitas);
}

/** Decisão do dono (25/set) — seção sem NADA preenchido não mostra selo nenhum; EXCEÇÃO: se um requisito do
 *  kanban daquela seção não está cumprido, mantém o aviso âmbar "falta …". Seção com algo preenchido segue o
 *  comportamento de hoje (`req ?? informativo`). Único lugar que decide isso — todo selo de seção passa por aqui. */
export function seloDeSecao(vazia: boolean, req: SeloSecao | null, informativo: SeloSecao | undefined): SeloSecao | undefined {
  if (vazia) return req?.tone === "warn" ? req : undefined;
  return req ?? informativo;
}

function seloInformativo(secao: SecaoBomKey, r: ResumoBom): SeloSecao {
  switch (secao) {
    case "tecidos":
      if (r.nTecidos === 0) return { tone: "muted", texto: "vazio" };
      if (!r.todosBlocosComArtigoTemVariante) return { tone: "warn", texto: "falta variante" };
      return { tone: "ok", texto: `${r.nTecidos} tecido${r.nTecidos > 1 ? "s" : ""}` };
    case "aviamentos":
      return r.nAviamentos > 0 ? { tone: "ok", texto: String(r.nAviamentos) } : { tone: "muted", texto: "vazio" };
    case "insumos":
      return r.nInsumos > 0 ? { tone: "ok", texto: String(r.nInsumos) } : { tone: "muted", texto: "vazio" };
    case "grade":
      return r.gradeTotalGeral > 0 ? { tone: "ok", texto: "preenchida" } : { tone: "warn", texto: "falta preencher" };
  }
}

/** "Vazia" por seção do BOM (brief 25/set): Tecidos `nTecidos===0`; Aviamentos idem; Insumos idem; Grade sem
 *  nenhuma quantidade (`gradeTotalGeral===0`). */
function secaoBomVazia(secao: SecaoBomKey, r: ResumoBom): boolean {
  switch (secao) {
    case "tecidos": return r.nTecidos === 0;
    case "aviamentos": return r.nAviamentos === 0;
    case "insumos": return r.nInsumos === 0;
    case "grade": return r.gradeTotalGeral === 0;
  }
}

/** Selo da seção: pelos requisitos da loja (estado SALVO) quando há; senão o informativo — seção vazia não mostra
 *  selo nenhum, exceto o aviso âmbar "falta …" do requisito do kanban (decisão do dono 25/set, `seloDeSecao`). */
export function seloSecaoBom(secao: SecaoBomKey, requeridas: ReadonlySet<string>, satisfeitas: Record<string, boolean>, resumo: ResumoBom): SeloSecao | undefined {
  const req = seloPorRequisito(secao, requeridas, satisfeitas);
  return seloDeSecao(secaoBomVazia(secao, resumo), req, seloInformativo(secao, resumo));
}
