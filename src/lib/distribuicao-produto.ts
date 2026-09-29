// Distribuição por produto — regras PURAS do dialog "Distribuir por loja" (Plan. Tecido) e da derivação do pç.
// Spec: docs/superpowers/specs/2026-09-25-distribuicao-por-produto-design.md (R1, R8–R12, R19, §5.2). Sem I/O.
//
// Formato gravado em plan_tecido_variantes.distribuicao (SÓ Tecido 1):
//   { "<loja_id>": { base: n, grades: { "<tamanho>": q }, manuais: ["<tamanho>", …] } }
// `grades` guarda as células RESOLVIDAS: a calculada (round(proporção × Base)) quando > 0 e a corrigida à mão SEMPRE
// (até 0). `manuais` = tamanhos corrigidos à mão (P-09 = D) — mudar a Base/proporção não os toca (P-23 = A).
// Linha de loja com Base 0 e sem célula à mão NÃO existe (R8: o NumberInput não distingue vazio de 0).
import { ladoTamanho, parseTamanho, type TamanhoTipo } from "@/lib/tamanho";

// `ocultas` ("Tamanho em", fix M-2 da revisão T4): células corrigidas À MÃO de tamanhos que o "Tamanho em" atual
// ESCONDE (loja com tamanhos soltos: trocar Letra→Número tira PP…GG da lista). Guardadas à parte — NÃO entram em
// `grades` (logo não contam no pç/totais nem no Direcionamento, que só lê `grades`) — e voltam como manuais quando o
// lado volta. Ausente quando vazia (a linha fica byte a byte igual à de antes para quem não troca de lado).
export type DistLoja = { base: number; grades: Record<string, number>; manuais: string[]; ocultas?: Record<string, number> };
export type Distribuicao = Record<string, DistLoja>;
export type Proporcoes = Record<string, number> | null | undefined;
export type CelulaVista = { valor: number; calculado: number; manual: boolean };

/** Texto de ajuda do dialog (mockup, sem o "Exemplo — …" ilustrativo — R33). */
export const TEXTO_AJUDA_DIST =
  "Digite a Base de cada loja × cor: os tamanhos saem sozinhos, proporção × Base. Qualquer quadradinho pode ser " +
  "corrigido à mão: ele ganha um ponto, e o ↺ volta ao calculado. Mudar a Base não mexe no que foi corrigido à mão. " +
  "Tamanho com proporção 0 fica esmaecido, mas dá para digitar.";

const tem = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** Inteiro ≥ 0 (arredonda; lixo/negativo = 0). */
function inteiro(v: unknown): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Proporção de UM tamanho pela chave cheia ("34|PPP"); aceita a chave legada SÓ-LETRA ("PPP"). Lote A fix1 · M4:
 *  alinhado ao `GradeSection.valorDe` (fonte única do que o card mostra) — o card só cai pro lado LETRA do par
 *  ("34|PPP".split("|")[1]), nunca pro lado número; sem esta regra, o dialog (que tentava também a chave legada
 *  só-número) e o card divergiam pra grade com legado só-número. */
export function proporcaoDoTamanho(prop: Proporcoes, t: string): number {
  if (!prop) return 0;
  if (tem(prop, t)) return Math.max(0, Number(prop[t]) || 0);
  const l = parseTamanho(t);
  if (l.letra && tem(prop, l.letra)) return Math.max(0, Number(prop[l.letra]) || 0);
  return 0;
}

/** Célula calculada = round(proporção × Base) (P-09 = D). */
export function celulaCalculada(prop: Proporcoes, t: string, base: number): number {
  return Math.max(0, Math.round(proporcaoDoTamanho(prop, t) * (Number(base) || 0)));
}

/** Tamanhos do dialog: a grade da loja no lado do "Tamanho em" (R11). Par sempre entra; item solto só com o lado do
 *  tipo; se nenhum item tiver o lado, mostra todos (nunca esconde a grade inteira). */
export function tamanhosDoTipo(grade: string[], tipo: TamanhoTipo): string[] {
  const com = grade.filter((t) => {
    const l = parseTamanho(t);
    return tipo === "numero" ? !!l.numero : !!l.letra;
  });
  return com.length > 0 ? com : grade.slice();
}

export const rotuloTamanho = (t: string, tipo: TamanhoTipo): string => ladoTamanho(t, tipo) ?? t;

/** Tipo efetivo do produto: `modelos.tamanho_tipo`; card sem modelo ou NULL legado ⇒ Letra (P-25). */
export const tipoDoProduto = (t: string | null | undefined): TamanhoTipo => (t === "numero" ? "numero" : "letra");

function linhaLimpa(l: Partial<DistLoja> | null | undefined): DistLoja {
  const grades: Record<string, number> = {};
  for (const [k, v] of Object.entries(l?.grades ?? {})) grades[k] = inteiro(v);
  const manuais = Array.from(new Set((Array.isArray(l?.manuais) ? l!.manuais : []).filter((k): k is string => typeof k === "string")));
  const ocultasRaw = l?.ocultas && typeof l.ocultas === "object" && !Array.isArray(l.ocultas) ? l.ocultas : {};
  const ocultas: Record<string, number> = {};
  for (const [k, v] of Object.entries(ocultasRaw)) if (!manuais.includes(k)) ocultas[k] = inteiro(v);
  return Object.keys(ocultas).length ? { base: inteiro(l?.base), grades, manuais, ocultas } : { base: inteiro(l?.base), grades, manuais };
}

/** Recalcula UMA linha: não-manuais = calculado (> 0 guardado); manuais ficam. Só os tamanhos da lista (R11).
 *  Fix M-2 (revisão T4): com `grade` (a grade INTEIRA da loja), a manual de um tamanho que está na grade mas FORA da
 *  lista (o "Tamanho em" o escondeu) não é descartada — vai para `ocultas` (fora de `grades`/totais) e volta como
 *  manual quando o tamanho reaparece. Tamanho fora da grade inteira segue descartado (saiu do cadastro). Sem `grade`:
 *  EXATAMENTE o comportamento de antes (as `ocultas` recebidas só passam adiante, intocadas). Para os tamanhos da
 *  lista o resultado é sempre o mesmo de antes. */
export function recalcularLinha(l: Partial<DistLoja> | null | undefined, prop: Proporcoes, tamanhos: string[], grade?: string[]): DistLoja {
  const x = linhaLimpa(l);
  const valorManual = new Map<string, number>();
  for (const t of x.manuais) valorManual.set(t, x.grades[t] ?? 0);
  // com a grade inteira, a oculta que voltou para a lista vira manual de novo (depois das manuais já visíveis)
  if (grade) for (const [t, q] of Object.entries(x.ocultas ?? {})) if (!valorManual.has(t)) valorManual.set(t, q);
  const manuais = [...valorManual.keys()].filter((t) => tamanhos.includes(t));
  const grades: Record<string, number> = {};
  for (const t of tamanhos) {
    if (manuais.includes(t)) grades[t] = valorManual.get(t) ?? 0;
    else {
      const c = celulaCalculada(prop, t, x.base);
      if (c > 0) grades[t] = c;
    }
  }
  let ocultas: Record<string, number> = {};
  if (grade) {
    for (const [t, q] of valorManual) if (!tamanhos.includes(t) && grade.includes(t)) ocultas[t] = q;
  } else ocultas = { ...(x.ocultas ?? {}) };
  return Object.keys(ocultas).length ? { base: x.base, grades, manuais, ocultas } : { base: x.base, grades, manuais };
}

const existe = (l: DistLoja) => l.base > 0 || l.manuais.length > 0 || Object.keys(l.ocultas ?? {}).length > 0;

/** Normaliza a distribuição de UMA cor (R6/R8): recalcula as não-manuais e tira a linha vazia. Sem `tamanhos` (grade
 *  ainda não carregou) só limpa os tipos — mantém as células gravadas. Idempotente. */
export function normalizarDistribuicao(d: Distribuicao | null | undefined, prop: Proporcoes, tamanhos: string[], grade?: string[]): Distribuicao {
  const out: Distribuicao = {};
  for (const [loja, l] of Object.entries(d ?? {})) {
    const x = tamanhos.length ? recalcularLinha(l, prop, tamanhos, grade) : linhaLimpa(l);
    if (existe(x)) out[loja] = x;
  }
  return out;
}

export const temDistribuicao = (d: Distribuicao | null | undefined): boolean => Object.keys(d ?? {}).length > 0;

/** Totais de UMA cor (o que vai para o card): Σ das lojas por tamanho (só > 0), total (= pç) e Σ das Bases. */
export function totaisDaDistribuicao(d: Distribuicao | null | undefined): { grades: Record<string, number>; total: number; base: number } {
  const grades: Record<string, number> = {};
  let total = 0;
  let base = 0;
  for (const l of Object.values(d ?? {})) {
    base += inteiro(l?.base);
    for (const [t, q] of Object.entries(l?.grades ?? {})) {
      const n = inteiro(q);
      if (n <= 0) continue;
      grades[t] = (grades[t] ?? 0) + n;
      total += n;
    }
  }
  return { grades, total, base };
}

/** Vista de UMA linha (loja × cor) p/ a tabela: valor (manual ou calculado), calculado e se é manual, por tamanho. */
export function linhaVista(l: DistLoja | null | undefined, prop: Proporcoes, tamanhos: string[]): { base: number; celulas: Record<string, CelulaVista>; total: number } {
  const base = inteiro(l?.base);
  const manuais = new Set(l?.manuais ?? []);
  const celulas: Record<string, CelulaVista> = {};
  let total = 0;
  for (const t of tamanhos) {
    const calculado = celulaCalculada(prop, t, base);
    const manual = manuais.has(t);
    const valor = manual ? inteiro(l?.grades?.[t]) : calculado;
    celulas[t] = { valor, calculado, manual };
    total += valor;
  }
  return { base, celulas, total };
}

/** Soma de várias vistas (subtotal da loja; total por cor): Σ Bases, Σ por tamanho (todos os tamanhos da lista) e total. */
export function somaVistas(vistas: { base: number; celulas: Record<string, CelulaVista>; total: number }[], tamanhos: string[]): { base: number; grades: Record<string, number>; total: number } {
  const grades: Record<string, number> = Object.fromEntries(tamanhos.map((t) => [t, 0]));
  let base = 0;
  let total = 0;
  for (const v of vistas) {
    base += v.base;
    total += v.total;
    for (const t of tamanhos) grades[t] += v.celulas[t]?.valor ?? 0;
  }
  return { base, grades, total };
}

function comLinha(d: Distribuicao, loja: string, l: DistLoja): Distribuicao {
  const out = { ...d };
  if (existe(l)) out[loja] = l;
  else delete out[loja];
  return out;
}

/** Base da loja × cor: recalcula as não-manuais dessa linha (P-23). */
export function definirBase(d: Distribuicao, loja: string, base: number, prop: Proporcoes, tamanhos: string[], grade?: string[]): Distribuicao {
  const a = linhaLimpa(d[loja]);
  return comLinha(d, loja, recalcularLinha({ ...a, base: inteiro(base) }, prop, tamanhos, grade));
}

/** Quadradinho digitado: vira "à mão" se ≠ calculado; igual ao calculado = volta a calculado (R9). */
export function definirCelula(d: Distribuicao, loja: string, t: string, valor: number, prop: Proporcoes, tamanhos: string[], grade?: string[]): Distribuicao {
  const a = linhaLimpa(d[loja]);
  const v = inteiro(valor);
  const manuais = a.manuais.filter((x) => x !== t);
  const grades = { ...a.grades };
  if (v !== celulaCalculada(prop, t, a.base)) {
    manuais.push(t);
    grades[t] = v;
  }
  return comLinha(d, loja, recalcularLinha({ base: a.base, grades, manuais, ...(a.ocultas ? { ocultas: a.ocultas } : {}) }, prop, tamanhos, grade));
}

/** "↺ voltar ao calculado". */
export function voltarAoCalculado(d: Distribuicao, loja: string, t: string, prop: Proporcoes, tamanhos: string[], grade?: string[]): Distribuicao {
  const a = linhaLimpa(d[loja]);
  return comLinha(d, loja, recalcularLinha({ ...a, manuais: a.manuais.filter((x) => x !== t) }, prop, tamanhos, grade));
}

/** Proporção digitada na linha "Proporção por tamanho" do dialog: congela os tamanhos exibidos nas chaves cheias
 *  (igual ao `GradeSection.setProp`) e troca só o tamanho digitado. Lote A fix1 · M3: NÃO descarta as chaves do
 *  OUTRO lado da grade — só sobrescreve as chaves consumidas para resolver `tamanhos` (a canônica substitui a
 *  legada que a alimentou); qualquer OUTRA chave de `prop` (ex.: legado do lado oposto — número junto de letra —
 *  que `tamanhos` não cobre) é mantida como está, igual ao `GradeSection.setProp` preservar o objeto. */
export function definirProporcao(prop: Proporcoes, tamanhos: string[], t: string, valor: number): Record<string, number> {
  const consumidas = new Set<string>();
  const out: Record<string, number> = {};
  for (const k of tamanhos) {
    out[k] = proporcaoDoTamanho(prop, k);
    if (prop && tem(prop, k)) consumidas.add(k);
    else {
      const l = parseTamanho(k);
      for (const alias of [l.letra, l.numero]) if (alias && prop && tem(prop, alias)) consumidas.add(alias);
    }
  }
  for (const [k, v] of Object.entries(prop ?? {})) if (!consumidas.has(k) && !(k in out)) out[k] = Number(v) || 0;
  out[t] = inteiro(valor);
  return out;
}

const VOGAIS = "aeiouáàâãäéèêëíìîïóòôõöúùûü";
/** Abrevia uma palavra até ANTES da 2ª vogal ("Marrom" → "Marr.", "Canela" → "Can."); ≤ 4 letras fica inteira. */
function abreviarPalavra(w: string): string {
  if (w.length <= 4) return w;
  const low = w.toLowerCase();
  let vistas = 0;
  for (let i = 0; i < low.length; i++) {
    if (!VOGAIS.includes(low[i])) continue;
    vistas++;
    if (vistas === 2) return i >= 2 ? `${w.slice(0, i)}.` : w;
  }
  return w;
}
/** Nome ABREVIADO da coluna fixa no celular (mockup: "Marr. Can."). */
export const abreviarNome = (s: string): string => s.split(/\s+/).filter(Boolean).map(abreviarPalavra).join(" ");

/** Chave do slot nos paths de presença (mesma regra do `pt-prop` do GradeSection). */
export const chaveSlot = (s: { id?: string | null; modelo_id?: string | null }): string => s.id ?? s.modelo_id ?? "x";
export const pathDistProp = (slot: string, t: string): string => `dist:${slot}:prop:${t}`;
export const pathDistBase = (slot: string, loja: string, varKey: string): string => `dist:${slot}:${loja}:${varKey}:base`;
export const pathDistCel = (slot: string, loja: string, varKey: string, t: string): string => `dist:${slot}:${loja}:${varKey}:${t}`;
/** Marcador de presença de página: o dialog está aberto e nenhum campo dele está focado (R19). Sem elemento no DOM. */
export const pathDistAberto = (slot: string): string => `dist:${slot}:aberto`;
export const pathEhDoProduto = (path: string | null | undefined, slot: string): boolean => !!path && path.startsWith(`dist:${slot}:`);
