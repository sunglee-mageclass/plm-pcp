// Espelho TS do montador de REF do banco (migrações 20260916190000/210000). Fonte da verdade do
// PREVIEW no front (Config da Loja + dialogs de criação). Precisa casar byte-a-byte com o SQL:
//   _ref_montar_sigla + _ref_juntar + _ref_num_fmt + _ref_sigla_derivada + _norm3.
// PURO (sem I/O) — recebe os nomes da taxonomia já resolvidos.
//
// ⚠️ Regras espelhadas do SQL:
//  - sigla de item: config (por id) SENÃO derivada do nome. Derivada = _norm3 (2 grupo + 1 cat + 2
//    sub1; Acessórios = 2 grupo + 3 cat). _norm3 = normaliza PT-BR (lista fixa) + só letras + upper,
//    corta em 3.
//  - família: config->sigla_familia[familia] SENÃO default (interno=I, acabado=A, importado=M).
//  - sigla configurada (item OU família): normaliza livre (tira acento/espaço/símbolo, mantém
//    letra+número, upper, corta em 6).
//  - número: largura MÍNIMA = num_digitos (lpad NUNCA trunca — número maior passa inteiro).
//  - separador: só entre partes quando HÁ config de montagem (`partes`); no fallback, tudo colado.
//  - `partes` ausente ⇒ fallback histórico (sigla derivada da família + número colado, 8 díg).

export type RefFamilia = "interno" | "acabado" | "importado";
export type RefParte = "familia" | "grupo" | "categoria" | "sub1" | "sub2" | "numero";

export type RefConfig = {
  partes?: RefParte[];
  separador?: string;
  num_digitos?: number;
  num_inicio?: number;
  sigla_familia?: Partial<Record<RefFamilia, string>>;
  sigla_taxonomia?: Record<string, string>; // id → sigla
};

// Nomes da taxonomia do produto (já resolvidos por id → nome + os ids p/ olhar a config).
export type RefTaxonomia = {
  grupoId: string | null;
  grupoNome: string | null;
  categoriaId: string | null;
  categoriaNome: string | null;
  sub1Id: string | null;
  sub1Nome: string | null;
  sub2Id: string | null;
  sub2Nome: string | null;
};

const FAMILIA_DEFAULT: Record<RefFamilia, string> = { interno: "I", acabado: "A", importado: "M" };

// Espelho de _norm3 (SQL): translate PT-BR (lista FIXA, não NFD genérico) + só [A-Za-z] + upper,
// depois substr(1,3). Acento fora da lista é DESCARTADO (igual ao banco).
const ACENTOS = "ÁÀÂÃÉÊÍÓÔÕÚÇáàâãéêíóôõúç";
const SEM_ACENTO = "AAAAEEIOOOUCaaaaeeiooouc";
function translatePt(s: string): string {
  let out = "";
  for (const ch of s) {
    const i = ACENTOS.indexOf(ch);
    out += i >= 0 ? SEM_ACENTO[i] : ch;
  }
  return out;
}
export function norm3(s: string | null | undefined): string {
  return translatePt(s ?? "").replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 3);
}

// Normaliza uma sigla CONFIGURADA (livre): tira acento/espaço/símbolo, mantém letra+número, upper,
// corta em 6. Espelha _ref_sigla_cfg_item / _ref_sigla_familia (regex [^A-Za-z0-9]).
function normSiglaLivre(s: string | null | undefined): string {
  // a lista de acentos do banco nesses helpers é a completa (á..ñ) — replicamos removendo acentos
  // via translate PT-BR estendido; para os fins de sigla, basta tirar diacríticos comuns.
  const semAcento = (s ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, ""); // remove diacríticos
  return semAcento.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 6);
}

// Sigla derivada de um item no MODO CONFIGURADO (quando a sigla do item não está definida). Regra
// padrão POR PARTE: grupo 2 letras, categoria 1, sub 2 — SEM a exceção de Acessórios (essa é do
// formato FIXO histórico e vale só no fallback, espelhando o SQL _ref_montar_sigla, que também não
// trata acessório no ramo derivado das partes).
function derivada(tipo: RefParte, tax: RefTaxonomia): string {
  if (tipo === "grupo") return norm3(tax.grupoNome).slice(0, 2);
  if (tipo === "categoria") return norm3(tax.categoriaNome).slice(0, 1);
  if (tipo === "sub1") return norm3(tax.sub1Nome).slice(0, 2);
  if (tipo === "sub2") return norm3(tax.sub2Nome).slice(0, 2);
  return "";
}

function idDaParte(parte: RefParte, tax: RefTaxonomia): string | null {
  switch (parte) {
    case "grupo": return tax.grupoId;
    case "categoria": return tax.categoriaId;
    case "sub1": return tax.sub1Id;
    case "sub2": return tax.sub2Id;
    default: return null;
  }
}

export function siglaFamilia(cfg: RefConfig | null | undefined, familia: RefFamilia): string {
  const conf = cfg?.sigla_familia?.[familia];
  const bruta = conf && conf.trim() !== "" ? conf : FAMILIA_DEFAULT[familia];
  return normSiglaLivre(bruta);
}

export function numDigitos(cfg: RefConfig | null | undefined): number {
  const n = cfg?.num_digitos;
  return Math.max(1, Number.isFinite(n as number) && (n as number) > 0 ? (n as number) : 8);
}

// Formata o número: largura MÍNIMA num_digitos, NUNCA trunca (espelha _ref_num_fmt).
export function fmtNumero(cfg: RefConfig | null | undefined, num: number): string {
  const s = String(Math.trunc(num));
  return s.padStart(Math.max(numDigitos(cfg), s.length), "0");
}

// A montagem tem "numero"? (sem config = sempre true — espelha _ref_usa_numero)
function usaNumero(cfg: RefConfig | null | undefined): boolean {
  if (!cfg?.partes) return true;
  return cfg.partes.includes("numero");
}

/**
 * Monta a REF completa (preview). `numero` é o próximo número que o banco emitiria (ou um exemplo).
 * Espelha _ref_montar_sigla + _ref_juntar do SQL.
 */
export function montarRef(o: {
  cfg: RefConfig | null | undefined;
  familia: RefFamilia;
  tax: RefTaxonomia;
  numero: number;
  acessorio: boolean;
}): string {
  const { cfg, familia, tax, numero, acessorio } = o;
  const numFmt = fmtNumero(cfg, numero);

  // Sem config de montagem: fallback histórico — sigla derivada da família + número colado.
  if (!cfg?.partes || !Array.isArray(cfg.partes)) {
    const sig = acessorio
      ? norm3(tax.grupoNome).slice(0, 2) + norm3(tax.categoriaNome)
      : norm3(tax.grupoNome).slice(0, 2) + norm3(tax.categoriaNome).slice(0, 1) + norm3(tax.sub1Nome).slice(0, 2);
    return (sig ?? "") + numFmt;
  }

  const sep = cfg.separador ?? "";
  const partesSigla: string[] = [];
  for (const parte of cfg.partes) {
    if (parte === "numero") continue; // anexado depois
    let val: string;
    if (parte === "familia") {
      val = siglaFamilia(cfg, familia);
    } else {
      const id = idDaParte(parte, tax);
      const conf = id ? cfg.sigla_taxonomia?.[id] : undefined;
      val = conf && conf.trim() !== "" ? normSiglaLivre(conf) : derivada(parte, tax);
    }
    if (val && val !== "") partesSigla.push(val);
  }

  const sig = partesSigla.join(sep);
  if (!usaNumero(cfg)) return sig;
  if (sig === "") return numFmt;
  return sig + sep + numFmt;
}

// Sigla configurada de um item (helper p/ a UI mostrar "sua" vs "auto").
export function siglaConfiguradaItem(cfg: RefConfig | null | undefined, id: string | null): string {
  if (!id) return "";
  const v = cfg?.sigla_taxonomia?.[id];
  return v && v.trim() !== "" ? normSiglaLivre(v) : "";
}

// Sigla AUTOMÁTICA (derivada) de um item p/ o placeholder da UI — a MESMA regra do modo configurado
// (grupo 2 / categoria 1 / sub 2, SEM exceção de Acessórios, que é só do fallback histórico). Fonte
// ÚNICA: a UI não reimplementa a derivação, chama este helper (evita divergir do banco).
export function siglaAutoParte(parte: RefParte, nome: string | null | undefined): string {
  if (parte === "grupo") return norm3(nome).slice(0, 2);
  if (parte === "categoria") return norm3(nome).slice(0, 1);
  if (parte === "sub1" || parte === "sub2") return norm3(nome).slice(0, 2);
  return "";
}
