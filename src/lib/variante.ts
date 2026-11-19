// Fonte ÚNICA de formatação do rótulo de variante de tecido (cor base + cor apelido).
// A variante guarda cor base (cor_id) e, desde jul/2026, a cor apelido (cor_apelido_id).
// Todas as telas que exibem variante devem usar estas funções — não montar o texto à mão.

const junta = (...partes: (string | null | undefined)[]) =>
  partes.map((x) => (x ?? "").trim()).filter(Boolean).join(" - ") || "—";

/** Rótulo completo: "nome - cor - cor apelido" (partes vazias são omitidas).
 *  `nome` = identificação da variante no contexto (artigo/tecido, código…). */
export function varianteLabel(p: {
  nome?: string | null;
  cor?: string | null;
  apelido?: string | null;
}): string {
  return junta(p.nome, p.cor, p.apelido);
}

/** Só a parte de cor: "cor - cor apelido" (omite apelido se vazio). */
export function corApelidoLabel(cor?: string | null, apelido?: string | null): string {
  return junta(cor, apelido);
}

/** Em Serviços o apelido vem NA FRENTE: "cor apelido - cor". */
export function corApelidoLabelServico(cor?: string | null, apelido?: string | null): string {
  return junta(apelido, cor);
}

/** Rótulo a partir de uma linha embedada de `variantes_tecido`. Aceita a cor base tanto
 *  pelo alias `cor` (embed `cor:cor_id(nome)`) quanto por `cores` (embed implícito
 *  `cores(nome)`), e o apelido por `apelido:cor_apelido_id(nome)`. Cai p/ código da
 *  variante e, por fim, "—" quando não há cor/nome. */
export function labelVarianteRow(
  v?: {
    nome_variante?: string | null;
    codigo_variante?: string | null;
    cor?: { nome: string | null } | null;
    cores?: { nome: string | null } | null;
    apelido?: { nome: string | null } | null;
  } | null,
): string {
  if (!v) return "—";
  const cor = v.cor?.nome ?? v.cores?.nome ?? null;
  const base = varianteLabel({ nome: v.nome_variante, cor, apelido: v.apelido?.nome });
  return base !== "—" ? base : v.codigo_variante || "—";
}

/** Demanda 4 (19/nov): rótulo de variante com a SIGLA de cada cor entre parênteses, para a seção
 *  Grade do Sheet. "NOME - COR (SIGLA) - APELIDO (SIGLA)". Sigla ausente/vazia → "()". Helper
 *  SEPARADO — NÃO substitui varianteLabel/labelVarianteRow (fonte única de outras telas). */
export function labelVarianteComSigla(p: {
  nome?: string | null; cor?: string | null; corSigla?: string | null;
  apelido?: string | null; apelidoSigla?: string | null;
}): string {
  const comSigla = (texto?: string | null, sigla?: string | null) => {
    const t = (texto ?? "").trim();
    if (!t) return "";
    return `${t} (${(sigla ?? "").trim()})`;
  };
  const partes = [(p.nome ?? "").trim(), comSigla(p.cor, p.corSigla), comSigla(p.apelido, p.apelidoSigla)]
    .filter(Boolean);
  return partes.length ? partes.join(" - ") : "—";
}

/** Versão de `labelVarianteRow` com sigla, p/ linha embedada de `variantes_tecido` que traz
 *  `cor:cor_id(nome, sigla_sku)` e `apelido:cor_apelido_id(nome, sigla_sku)`. Mesmo fallback
 *  (código da variante, depois "—"). Só a Grade usa; `labelVarianteRow` segue como está. */
export function labelVarianteRowComSigla(
  v?: {
    nome_variante?: string | null;
    codigo_variante?: string | null;
    cor?: { nome: string | null; sigla_sku?: string | null } | null;
    cores?: { nome: string | null; sigla_sku?: string | null } | null;
    apelido?: { nome: string | null; sigla_sku?: string | null } | null;
  } | null,
): string {
  if (!v) return "—";
  const cor = v.cor ?? v.cores ?? null;
  const base = labelVarianteComSigla({
    nome: v.nome_variante,
    cor: cor?.nome,
    corSigla: cor?.sigla_sku,
    apelido: v.apelido?.nome,
    apelidoSigla: v.apelido?.sigla_sku,
  });
  return base !== "—" ? base : v.codigo_variante || "—";
}
