// SKU automático (spec 2026-09-24-sku-automatico-design.md, F3.5a) — espelho TS PURO da montagem do servidor.
// O SKU é GERADO e GRAVADO no servidor (RPC gerar_skus_modelo — fonte única); este arquivo só serve à
// PRÉ-VISUALIZAÇÃO (Config da Loja) e à validação dos formulários ANTES de gravar. Casa byte a byte com:
//   normalizarSigla       ⇄ public._sku_norm_sigla(text)
//   normalizarRefSku      ⇄ public._sku_norm_ref(text)
//   normalizarSkuManual   ⇄ public._sku_norm_manual(text)              (mesmas mensagens de erro, em PT)
//   normalizarSkuConfig   ⇄ public._sku_config_normaliza(jsonb)      (mesmas mensagens de erro, em PT)
//   normalizarTamanhosSku ⇄ public._sku_tamanhos_normaliza(jsonb)    (mesmas mensagens de erro, em PT)
//   montarSku             ⇄ public._sku_montar(jsonb,jsonb)
//   resolverSku           ⇄ public._sku_resolver(jsonb,text,jsonb,jsonb,text,text,jsonb)
// Anti-drift: tests/fixtures/sku-casos.ts roda nos DOIS lados (tests/unit/sku-montar.test.ts e
// tests/integration/sku-automatico.test.ts). Mudou a regra aqui? Mude o SQL (nova migration) e as fixtures.
//
// Regras (decisões do dono Q1–Q4, D1–D7 e plano F3.5a §3):
//  - Caracteres do SKU (D6/R4 — pendente do dono): tudo MAIÚSCULO, sem acento (lista FIXA abaixo, igual ao
//    `translate()` do SQL — independe do locale do banco), sem espaço. Sigla: só A–Z e 0–9 (o resto sai). REF no
//    SKU: A–Z, 0–9 e - . _ / (o resto sai). SKU manual: A–Z, 0–9 e - . _ / (outro caractere = erro). Separador:
//    só - . _ / (até 3; vazio = colado). Ordem sempre: tira acento → filtra → MAIÚSCULAS (só ASCII chega ao upper).
//  - Formato: `partes` ⊆ {ref, cor_base, cor_apelido, tamanho}, sem repetir, na ordem do SKU; lista vazia ⇒ sem
//    formato (null = a loja não gera SKU). `separadores` só entre partes VIZINHAS ("a|b"). `tamanho_padrao` =
//    "letra" (padrão) | "numero".
//  - Montagem: o separador ANDA COM A PARTE QUE VEM DEPOIS dele. Parte ausente na linha (apelido que não entra — D4;
//    tamanho "UN" sem sigla — D1) some JUNTO com o separador que a antecede.
//  - Cor apelido (D4 — decidido pelo dono 24/set): apelido COM sigla entra. Variante SEM apelido, ou apelido SEM
//    sigla, usa a COR BASE: com a parte `cor_base` no Formato, a parte `cor_apelido` some (não repete a cor); com SÓ
//    `cor_apelido` (sem `cor_base`), a sigla da cor base vai nessa posição. Apelido que EXISTE sem sigla (e o Formato
//    usa `cor_apelido`) ⇒ `avisos` (NÃO bloqueia: o SKU sai com a cor base; cadastrada a sigla, o Regerar atualiza).
//  - Falta sigla (Q4) de cor base (quando o SKU precisa dela) ou de tamanho ⇒ a linha NÃO gera SKU e devolve `faltas`
//    (bloqueiam) na ordem cor_base → tamanho. Variante sem cor base ⇒ falta { atributo: "cor_base", id: null, nome: null }.
import { aparar, ladoTamanho, parseTamanho, type TamanhoTipo } from "@/lib/tamanho";

export type SkuParte = "ref" | "cor_base" | "cor_apelido" | "tamanho";
export const SKU_PARTES: readonly SkuParte[] = ["ref", "cor_base", "cor_apelido", "tamanho"];
export const SKU_PARTE_LABEL: Record<SkuParte, string> = {
  ref: "REF",
  cor_base: "Cor base",
  cor_apelido: "Cor apelido",
  tamanho: "Tamanho",
};
export type SkuConfig = { partes: SkuParte[]; separadores: Record<string, string>; tamanho_padrao: TamanhoTipo };
export type SkuFalta = { atributo: "cor_base" | "cor_apelido" | "tamanho"; id: string | null; nome: string | null };
export type SkuCor = { id: string; nome: string; sigla: string | null };
export type Normalizado<T> = { ok: true; valor: T } | { ok: false; erro: string };

/** Grade única dos Acessórios (revenda/importado) — `_pa_grade_variante` grava `{"UN": qtd}`. */
export const TAMANHO_UNICO = "UN";
export const SKU_SEP_MAX = 3;
/** Caracteres permitidos no separador (e, junto com A–Z/0–9, no SKU manual e na REF dentro do SKU). */
export const SKU_SEP_CHARS = "- . _ /";

// Lista FIXA de acentos (maiúsculas e minúsculas) — IDÊNTICA ao translate() de _sku_sem_acento no SQL.
export const ACENTOS_DE = "ÁÀÂÃÄÅáàâãäåÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñÝýÿ";
export const ACENTOS_PARA = "AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNnYyy";
const PARA = [...ACENTOS_PARA];
const MAPA_ACENTOS = new Map([...ACENTOS_DE].map((c, i) => [c, PARA[i]]));
function semAcento(s: string): string {
  let out = "";
  for (const ch of s) out += MAPA_ACENTOS.get(ch) ?? ch;
  return out;
}

export function chaveSeparador(a: SkuParte, b: SkuParte): string {
  return `${a}|${b}`;
}

const ehObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const nChars = (s: string) => [...s].length; // = char_length do SQL (conta pontos de código, não UTF-16)
const porCodigo = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0); // = ORDER BY … COLLATE "C"

/** Sigla (cor base, cor apelido, lado do tamanho): sem acento, só A–Z/0–9, MAIÚSCULAS; vazia ⇒ null. */
export function normalizarSigla(s: string | null | undefined): string | null {
  const v = semAcento(s ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return v === "" ? null : v;
}

/** A REF dentro do SKU: sem acento, só A–Z/0–9 e - . _ /, MAIÚSCULAS (o resto sai; vazia = ""). */
export function normalizarRefSku(s: string | null | undefined): string {
  return semAcento(s ?? "").replace(/[^A-Za-z0-9._/-]/g, "").toUpperCase();
}

/** SKU digitado à mão: sem espaço, sem acento, MAIÚSCULAS; só A–Z, 0–9 e - . _ / (outro caractere = erro). */
export function normalizarSkuManual(s: string | null | undefined): Normalizado<string> {
  const semEspaco = (s ?? "").replace(/[ \t\r\n]/g, "");
  if (semEspaco === "") return { ok: false, erro: "Informe o SKU." };
  const v = semAcento(semEspaco);
  if (/[^A-Za-z0-9._/-]/.test(v)) return { ok: false, erro: "SKU inválido: use só letras, números e - . _ /." };
  return { ok: true, valor: v.toUpperCase() };
}

/** Valida e canoniza o Formato do SKU (o mesmo que o gatilho de tenant_config faz no servidor). */
export function normalizarSkuConfig(raw: unknown): Normalizado<SkuConfig | null> {
  if (raw === null || raw === undefined) return { ok: true, valor: null };
  if (!ehObjeto(raw)) return { ok: false, erro: "Formato do SKU inválido." };
  let brutas: unknown = raw.partes;
  if (brutas === null || brutas === undefined) brutas = [];
  if (!Array.isArray(brutas)) return { ok: false, erro: "Formato do SKU inválido: partes." };
  const partes: SkuParte[] = [];
  for (const p of brutas) {
    if (typeof p !== "string" || !(SKU_PARTES as readonly string[]).includes(p)) {
      return { ok: false, erro: `Parte do SKU desconhecida: ${JSON.stringify(p)}.` };
    }
    if (partes.includes(p as SkuParte)) return { ok: false, erro: `Parte do SKU repetida: ${p}.` };
    partes.push(p as SkuParte);
  }
  if (partes.length === 0) return { ok: true, valor: null };
  let seps: unknown = raw.separadores;
  if (seps === null || seps === undefined) seps = {};
  if (!ehObjeto(seps)) return { ok: false, erro: "Formato do SKU inválido: separadores." };
  const separadores: Record<string, string> = {};
  for (let i = 1; i < partes.length; i++) {
    const k = chaveSeparador(partes[i - 1], partes[i]);
    const v = seps[k];
    if (v === null || v === undefined) continue;
    if (typeof v !== "string") return { ok: false, erro: "Separador do SKU inválido." };
    if (!/^[-._/]*$/.test(v)) return { ok: false, erro: `Separador do SKU: use só ${SKU_SEP_CHARS}.` };
    if (nChars(v) > SKU_SEP_MAX) return { ok: false, erro: `Separador do SKU: no máximo ${SKU_SEP_MAX} caracteres.` };
    if (v !== "") separadores[k] = v;
  }
  const tp = raw.tamanho_padrao;
  const tipo = tp === null || tp === undefined || tp === "" ? "letra" : tp;
  if (tipo !== "letra" && tipo !== "numero") {
    return { ok: false, erro: "Tamanho padrão do SKU inválido (use letra ou número)." };
  }
  return { ok: true, valor: { partes, separadores, tamanho_padrao: tipo } };
}

/**
 * Valida e canoniza o mapa lado-do-tamanho → sigla (tenant_config.tamanhos_sku). Vazio ⇒ null. As checagens NÃO
 * dependem da ordem das chaves (o jsonb reordena): 1º tipo inválido (chaves em ordem de código), 2º chave repetida
 * depois de aparar (idem), 3º o mapa das siglas não vazias.
 */
export function normalizarTamanhosSku(raw: unknown): Normalizado<Record<string, string> | null> {
  if (raw === null || raw === undefined) return { ok: true, valor: null };
  if (!ehObjeto(raw)) return { ok: false, erro: "Siglas de tamanho inválidas." };
  const entradas = Object.entries(raw)
    .map(([k, v]) => [aparar(k), v] as const)
    .filter(([k, v]) => k !== "" && v !== null && v !== undefined)
    .sort((a, b) => porCodigo(a[0], b[0]));
  for (const [k, v] of entradas) {
    if (typeof v !== "string") return { ok: false, erro: `Sigla de tamanho inválida: ${k}.` };
  }
  for (let i = 1; i < entradas.length; i++) {
    if (entradas[i][0] === entradas[i - 1][0]) return { ok: false, erro: `Sigla de tamanho repetida: ${entradas[i][0]}.` };
  }
  const out: Record<string, string> = {};
  for (const [k, v] of entradas) {
    const sig = normalizarSigla(v as string);
    if (sig) out[k] = sig;
  }
  return { ok: true, valor: Object.keys(out).length === 0 ? null : out };
}

/** Junta as partes na ordem do formato. O separador anda com a parte que vem DEPOIS; parte vazia some com ele. */
export function montarSku(cfg: SkuConfig, valores: Partial<Record<SkuParte, string | null | undefined>>): string {
  let out = "";
  let anterior: SkuParte | null = null; // parte CONFIGURADA anterior (mesmo que tenha ficado vazia)
  let emitiu = false;
  for (const p of cfg.partes) {
    const v = valores[p] ?? "";
    if (v !== "") {
      if (emitiu && anterior) out += cfg.separadores[chaveSeparador(anterior, p)] ?? "";
      out += v;
      emitiu = true;
    }
    anterior = p;
  }
  return out;
}

/** O SKU de UMA linha (variante × tamanho) — ou as `faltas` de sigla que impedem gerá-lo (Q4) — e os `avisos` (D4:
 *  apelido sem sigla — o SKU sai com a cor base). */
export function resolverSku(o: {
  cfg: SkuConfig;
  ref: string | null;
  cor: SkuCor | null;
  apelido: SkuCor | null;
  tamanhoKey: string;
  tipo: TamanhoTipo;
  tamanhosSku: Record<string, string> | null;
}): { sku: string | null; faltas: SkuFalta[]; avisos: SkuFalta[] } {
  const faltas: SkuFalta[] = [];
  const avisos: SkuFalta[] = [];
  const usa = (p: SkuParte) => o.cfg.partes.includes(p);
  const valores: Partial<Record<SkuParte, string>> = {};
  if (usa("ref")) valores.ref = normalizarRefSku(o.ref);
  const siglaApelido = o.apelido?.sigla || null;
  if (usa("cor_apelido") && o.apelido && !siglaApelido) {
    avisos.push({ atributo: "cor_apelido", id: o.apelido.id, nome: o.apelido.nome });
  }
  // A cor base é exigida se o Formato tem `cor_base` — ou se tem `cor_apelido` e o apelido não entra (D4).
  let siglaBase: string | null = null;
  if (usa("cor_base") || (usa("cor_apelido") && !siglaApelido)) {
    if (!o.cor) faltas.push({ atributo: "cor_base", id: null, nome: null });
    else if (!o.cor.sigla) faltas.push({ atributo: "cor_base", id: o.cor.id, nome: o.cor.nome });
    else siglaBase = o.cor.sigla;
  }
  if (usa("cor_base") && siglaBase) valores.cor_base = siglaBase;
  if (usa("cor_apelido")) {
    if (siglaApelido) valores.cor_apelido = siglaApelido;
    else if (!usa("cor_base") && siglaBase) valores.cor_apelido = siglaBase; // só cor_apelido no Formato: a cor base no lugar
  }
  if (usa("tamanho")) {
    const lado = ladoTamanho(o.tamanhoKey, o.tipo);
    const sig = lado && o.tamanhosSku ? o.tamanhosSku[lado] || null : null;
    if (sig) valores.tamanho = sig;
    else if (lado && lado !== TAMANHO_UNICO) faltas.push({ atributo: "tamanho", id: null, nome: lado });
  }
  if (faltas.length > 0) return { sku: null, faltas, avisos };
  const sku = montarSku(o.cfg, valores);
  return { sku: sku === "" ? null : sku, faltas, avisos };
}

// ─────────────────────────── apoio às telas (não têm espelho SQL) ───────────────────────────

/** "Falta sigla: Cor base Amarelo" — o texto das linhas de falta (Config e, na F3.5b, o card). */
export function textoFalta(f: SkuFalta): string {
  if (f.atributo === "cor_base" && f.nome === null) return "Falta a cor base na variante";
  const rotulo = f.atributo === "cor_base" ? "Cor base" : f.atributo === "cor_apelido" ? "Cor apelido" : "Tamanho";
  return `Falta sigla: ${rotulo} ${f.nome ?? ""}`.trimEnd();
}

/** "Falta sigla na cor apelido: Musgo" — o texto dos AVISOS (D4: não bloqueiam; o SKU sai com a cor base). */
export function textoAviso(a: SkuFalta): string {
  return `Falta sigla na cor apelido: ${a.nome ?? ""}`.trimEnd();
}

/** JSON com chaves ordenadas — compara o Formato/as siglas lidos do banco (jsonb reordena chaves). */
export function canonico(v: unknown): string {
  const ordena = (x: unknown): unknown =>
    Array.isArray(x)
      ? x.map(ordena)
      : ehObjeto(x)
        ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, ordena(x[k])]))
        : x;
  return JSON.stringify(ordena(v ?? null));
}

/** Cada item da grade com os seus lados (para o editor de siglas da Grade de Tamanhos). */
export function ladosDaGrade(grade: readonly string[]): { item: string; numero: string | null; letra: string | null }[] {
  return grade.map((item) => ({ item, ...parseTamanho(item) }));
}

/**
 * Siglas de tamanho a GRAVAR: aplica sobre o mapa ATUAL do banco (`fresco`) só as chaves que o usuário mudou
 * (rascunho × base carregada) — duas pessoas editando lados diferentes não se apagam (lição RP3 da F2).
 */
export function mesclarSiglasTamanho(
  fresco: Record<string, string> | null,
  base: Record<string, string> | null,
  rascunho: Record<string, string>,
): Record<string, string> | null {
  const out: Record<string, string> = { ...(fresco ?? {}) };
  const chaves = new Set([...Object.keys(base ?? {}), ...Object.keys(rascunho)]);
  for (const k of chaves) {
    const antes = normalizarSigla((base ?? {})[k]);
    const agora = normalizarSigla(rascunho[k]);
    if (antes === agora) continue;
    if (agora) out[k] = agora;
    else delete out[k];
  }
  return Object.keys(out).length === 0 ? null : out;
}
