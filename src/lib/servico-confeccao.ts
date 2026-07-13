// Serviços de CONFECÇÃO (onde a peça é efetivamente feita): Oficina/CMT, Costura,
// PL/Private Label. O "SLA de Serviços" da Subcategoria 1 mede o prazo DESSE passo —
// então a seleção de "a que serviço o SLA se aplica" (Config da Loja) é filtrada a estes.
// Casa por TOKEN flexível (sem acento, minúsculo, plural por substring) — a categoria é
// texto livre por loja. Segue o padrão de src/lib/fornecedor-categoria.ts.
const norm = (s: string) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** A categoria de serviço é de confecção (oficina/costura/PL/private label)? */
export function isServicoConfeccao(nome: string): boolean {
  const n = norm(nome);
  if (!n) return false;
  if (n.includes("private label")) return true;
  const toks = n.split(/[^a-z0-9]+/).filter(Boolean);
  return toks.some(
    (t) => t === "oficina" || t === "oficinas" || t === "costura" || t === "costuras" || t === "pl" || t === "pls",
  );
}
