/**
 * Data da Nota de Entrada nas OCs — regras de TELA (fonte única). Desenho aprovado pelo dono em 24/set/2026.
 * Spec: docs/superpowers/specs/2026-09-24-data-nota-entrada-design.md · Plano: docs/superpowers/plans/2026-09-24-data-nota-entrada.md
 *
 * O VENCIMENTO é decidido no banco (migration 20261002100000: base = COALESCE(data_nota_entrada, base de hoje) em Tecido,
 * Aviamento, Insumo e P. Acabado; o Importado só registra). Aqui ficam só: quando ALERTAR (OC recebida sem a data), a
 * parcela "provisória" do Financeiro, a validação da data (espelho do gatilho do banco), os textos aprovados e o espelho
 * da base para a prévia do "Marcar recebido".
 */

/** Família de OC = valor de `parcelas.tipo_oc`. */
export type FamiliaOc = "tecido" | "aviamento" | "etiqueta" | "p_acabado" | "p_importado";

/** Famílias que ALERTAM (bolinha, aviso na OC, amarelo no Financeiro). Importado fora: "só registra" (spec §10 D2). */
export const FAMILIAS_COM_ALERTA: readonly FamiliaOc[] = ["tecido", "aviamento", "etiqueta", "p_acabado"];

/** Coluna de `parcelas` que aponta para a OC de cada família (as que alertam). */
export const COLUNA_PARCELA_POR_FAMILIA: Readonly<Record<string, string>> = {
  tecido: "oc_tecido_id", aviamento: "oc_aviamento_id", etiqueta: "oc_etiqueta_id", p_acabado: "oc_p_acabado_id",
};

export const ROTULO_DATA_NOTA = "Data da Nota de Entrada";
export const AVISO_FALTA_NOTA = "Falta a Data da Nota de Entrada — os vencimentos estão provisórios";
/** D6 (pendente do dono — recomendação): OC recebida SEM parcela a pagar (toda paga ou valor 0) avisa sem "provisórios". */
export const AVISO_FALTA_NOTA_CURTO = "Falta a Data da Nota de Entrada";
export const TEXTO_PARCELA_PROVISORIA = "vencimento provisório — falta a data da nota";
export const TITULO_BOLINHA = "Falta a Data da Nota de Entrada";
export const DICA_CAMPO_NOTA = "O prazo de pagamento conta a partir desta data.";
export const DICA_CAMPO_NOTA_IMPORTADO = "Só registro — os vencimentos seguem as etapas de câmbio.";

export type OcNotaInfo = { status?: string | null; data_nota_entrada?: string | null };
export type ParcelaNotaInfo = { tipo_oc?: string | null; status?: string | null; data_pagamento?: string | null };

export function temDataNota(v: string | null | undefined): boolean {
  return typeof v === "string" && v.trim() !== "";
}

/** OC RECEBIDA sem a data, numa família que alerta (spec §4.5). */
export function faltaNotaEntrada(familia: string | null | undefined, oc: OcNotaInfo | null | undefined): boolean {
  if (!oc || !familia || !(FAMILIAS_COM_ALERTA as readonly string[]).includes(familia)) return false;
  return oc.status === "recebido" && !temDataNota(oc.data_nota_entrada);
}

/** Texto do aviso na OC: com parcela a pagar confirmada, o texto aprovado; senão (toda paga, valor 0 ou ainda
 *  carregando) o curto, que nunca afirma algo falso (D6). */
export function textoAvisoFaltaNota(temParcelaAPagar: boolean | null | undefined): string {
  return temParcelaAPagar === true ? AVISO_FALTA_NOTA : AVISO_FALTA_NOTA_CURTO;
}

/** Parcela paga = a MESMA régua do banco (`status = 'pago' OR data_pagamento IS NOT NULL`). */
export function parcelaPaga(p: ParcelaNotaInfo): boolean {
  return p.status === "pago" || temDataNota(p.data_pagamento);
}

/** Destaque amarelo do Financeiro: parcela NÃO paga de OC em falta. A paga nunca (o vencimento dela não muda mais). */
export function parcelaProvisoria(p: ParcelaNotaInfo, oc: OcNotaInfo | null | undefined): boolean {
  return !parcelaPaga(p) && faltaNotaEntrada(p.tipo_oc, oc);
}

/** Espelho do COALESCE do banco — base do vencimento na prévia do "Marcar recebido" (ISO yyyy-MM-dd, ou ""). */
export function baseVencimento(dataNota: string | null | undefined, baseDeHoje: string | null | undefined): string {
  return temDataNota(dataNota) ? (dataNota as string).trim() : (baseDeHoje ?? "");
}

/** Campo → payload da RPC. A chave vai SEMPRE (ausente = o banco mantém); vazio LIMPA (null). */
export function payloadDataNota(v: string | null | undefined): string | null {
  return temDataNota(v) ? (v as string).trim() : null;
}

const br = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

/** D7 (pendente do dono — recomendação): a data não pode ser FUTURA (> hoje no fuso da loja) nem ANTERIOR à data do
 *  pedido. Espelho EXATO das mensagens do gatilho `fn_oc_nota_entrada_valida` do banco (que é quem garante). */
export function validarDataNota(
  dataNota: string | null | undefined, dataPedido: string | null | undefined, hojeISO: string,
): string | null {
  if (!temDataNota(dataNota)) return null;
  const n = (dataNota as string).trim();
  if (hojeISO && n > hojeISO) return `A Data da Nota de Entrada (${br(n)}) não pode ser no futuro.`;
  if (temDataNota(dataPedido) && n < (dataPedido as string).trim()) {
    return `A Data da Nota de Entrada (${br(n)}) não pode ser anterior à data do pedido (${br((dataPedido as string).trim())}).`;
  }
  return null;
}

/** queryKeys que exibem vencimento de parcela — invalidar ao salvar/receber qualquer OC (a data pode ter mudado). */
export const QUERY_KEYS_VENCIMENTO: readonly (readonly string[])[] = [
  ["parcelas"], ["dash-financeiro"], ["oc-view"], ["nota-parcelas-a-pagar"],
];

export function invalidarVencimentos(qc: { invalidateQueries(f: { queryKey: readonly unknown[] }): unknown }): void {
  for (const k of QUERY_KEYS_VENCIMENTO) void qc.invalidateQueries({ queryKey: [...k] });
}
