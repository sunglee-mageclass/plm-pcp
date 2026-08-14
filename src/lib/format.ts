/**
 * Formatação numérica padrão pt-BR: decimais com vírgula, milhares com ponto,
 * SEMPRE 2 casas decimais (ex.: 3,80 — não 3,8; 1.234,50).
 */
export function fmtNum(n: number | string | null | undefined): string {
  const v = typeof n === "string" ? Number(n) : (n ?? 0);
  if (n === "" || v === null || v === undefined || Number.isNaN(v as number)) return "0,00";
  return (v as number).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Moeda pt-BR (R$ 1.234,50). Fonte única — não duplicar `const brl` por tela.
 */
export function brl(n: number | string | null | undefined): string {
  return Number(n ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * Percentual pt-BR com 1 casa decimal (ex.: 12,5%) — padrão §Q12 (adotado; ajustável).
 * Recebe o valor JÁ em pontos percentuais (50 → "50,0%"), não a fração (0,5).
 */
export function fmtPct(n: number | string | null | undefined): string {
  const v = typeof n === "string" ? Number(n) : (n ?? 0);
  if (n === "" || v === null || v === undefined || Number.isNaN(v as number)) return "0,0%";
  return `${(v as number).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

/**
 * Quantidade/peça: inteiro pt-BR, sem casas, com separador de milhar (ex.: 1.234).
 * Para EXIBIÇÃO (a entrada usa <NumberInput integer>).
 */
export function fmtInt(n: number | string | null | undefined): string {
  const v = typeof n === "string" ? Number(n) : (n ?? 0);
  if (n === "" || v === null || v === undefined || Number.isNaN(v as number)) return "0";
  return Math.round(v as number).toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

/**
 * Máscara de CNPJ — padroniza com pontos/barra/traço (00.000.000/0000-00),
 * independente de como o usuário digita (aceita só os dígitos e formata).
 * Formata parcial enquanto digita; ignora não-dígitos e limita a 14 dígitos.
 */
export function formatCNPJ(value: string | null | undefined): string {
  const d = (value ?? "").replace(/\D/g, "").slice(0, 14);
  if (d.length <= 2) return d;
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

/**
 * Para campos editáveis: pt-BR, mínimo 2 casas mas até 4 (não arredonda valores
 * de alta precisão como consumo de aviamento ao exibir).
 */
export function fmtNumEdit(n: number | string | null | undefined): string {
  if (n === "" || n === null || n === undefined) return "";
  const v = typeof n === "string" ? Number(n) : n;
  if (Number.isNaN(v)) return "";
  return v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

// Prefixo "NN|" de ordenação que vazava no NOME do mês (seed antigo; a migração
// 20260730120000 limpa o dado) — strip defensivo para loja que renomear com prefixo.
export const mesLimpo = (n?: string | null) => (n ?? "").replace(/^\d+\|\s*/, "");
