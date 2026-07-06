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
