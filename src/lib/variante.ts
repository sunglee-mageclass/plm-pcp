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
