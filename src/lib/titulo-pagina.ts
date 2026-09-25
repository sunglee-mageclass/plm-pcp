// Título para a página (F3.6 — spec 2026-09-25, ruling 1): AUTOMÁTICO = Nome do Modelo em "iniciais maiúsculas" + " | " +
// o nome da loja (`tenants.nome`, a MARCA — não o WISH360). ESPELHO byte a byte de public._titulo_pagina_calculado (migration
// 20261005100000) — anti-drift: tests/fixtures/titulo-pagina-casos.ts roda nos DOIS lados (tests/unit/titulo-pagina.test.ts e
// tests/integration/sheet-reorg-campos.test.ts). Mudou a regra aqui? Mude o SQL (migration nova) e as fixtures.
// Regras: nome com espaço/tab/CR/LF das pontas tirados e o miolo em 1 espaço; cada palavra com a 1ª letra maiúscula e o
// resto minúsculo por lista FIXA de letras (A–Z + acentos PT — igual ao translate() do SQL, independe do locale do banco;
// letra fora da lista fica como está nos dois lados); conectivos em minúsculo, salvo a 1ª palavra; a loja entra como está
// (só as pontas aparadas). Nome vazio ⇒ "" (NUNCA " | Loja" solto — dono 25/set); loja vazia ⇒ só o nome (R7). PURO.

export const TITULO_MAIUSC = "ABCDEFGHIJKLMNOPQRSTUVWXYZÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑÝ";
export const TITULO_MINUSC = "abcdefghijklmnopqrstuvwxyzáàâãäéèêëíìîïóòôõöúùûüçñý";
export const TITULO_CONECTIVOS: readonly string[] = ["de", "da", "do", "das", "dos", "e", "com", "em", "para"];
export const TITULO_SEPARADOR = " | ";

const MAI = [...TITULO_MAIUSC];
const MIN = [...TITULO_MINUSC];
const PARA_MIN = new Map(MAI.map((c, i) => [c, MIN[i]] as const));
const PARA_MAI = new Map(MIN.map((c, i) => [c, MAI[i]] as const));
function trocar(s: string, mapa: Map<string, string>): string {
  let out = "";
  for (const ch of s) out += mapa.get(ch) ?? ch;
  return out;
}
const PONTAS = /^[ \t\r\n]+|[ \t\r\n]+$/g; // = btrim(x, E' \t\r\n')
const MIOLO = /[ \t\r\n]+/g; // = regexp_replace(x, E'[ \t\r\n]+', ' ', 'g')

/** "VESTIDO LONGO POEMA" → "Vestido Longo Poema"; "vestido de festa" → "Vestido de Festa"; "  " → "". */
export function nomeEmTitulo(nome: string | null | undefined): string {
  const s = (nome ?? "").replace(PONTAS, "").replace(MIOLO, " ");
  if (s === "") return "";
  return s
    .split(" ")
    .map((w, i) => {
      const baixa = trocar(w, PARA_MIN);
      if (i > 0 && TITULO_CONECTIVOS.includes(baixa)) return baixa;
      const [primeira = "", ...resto] = [...w];
      return trocar(primeira, PARA_MAI) + trocar(resto.join(""), PARA_MIN);
    })
    .join(" ");
}

/** Espelho de public._titulo_pagina_calculado(_nome, _loja). */
export function tituloPaginaCalculado(nome: string | null | undefined, loja: string | null | undefined): string {
  const n = nomeEmTitulo(nome);
  if (n === "") return "";
  const l = (loja ?? "").replace(PONTAS, "");
  return l === "" ? n : `${n}${TITULO_SEPARADOR}${l}`;
}

// ── apoio à tela (sem espelho SQL) ──
/** O que o campo mostra: o fixado à mão; NULL = o automático (calculado ao vivo, a cada tecla no Nome). */
export function tituloExibido(fixado: string | null | undefined, calculado: string): string {
  return fixado ?? calculado;
}
/** Digitar no Título: igual ao calculado continua AUTOMÁTICO (NULL — spec: "digitou algo diferente → vira manual"). */
export function tituloAoDigitar(digitado: string, calculado: string): string | null {
  return digitado === calculado ? null : digitado;
}
/** Ruling do controlador (achado do Lote B1, parte da Task 8): sair do campo (onBlur) com um título manual que só tem
 *  espaço nas pontas, ou que — aparado — bate com o calculado, volta a ser AUTOMÁTICO (NULL); senão mantém o digitado
 *  (`v` já cru, sem aparar — R5: um manual "diferente de verdade" fica exatamente como a pessoa digitou). Sem isso, quem
 *  digita o calculado + um espaço no fim gravava um manual indistinguível do automático que já não acompanha o Nome (R5). */
export function tituloAoSair(v: string | null, calculado: string): string | null {
  if (v === null) return null;
  return v.trim() === "" || v.trim() === calculado ? null : v;
}
