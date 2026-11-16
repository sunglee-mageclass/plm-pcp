/**
 * "Regerar REF" por card (Sheet do Planejamento, secao "4. Codigos") - regras PURAS + leitura tolerante do jsonb das RPCs
 * `ref_regerar_previa` / `regerar_ref_card` (migration 20261201110000). O calculo da REF nova e do BANCO (fonte unica; espelha o
 * fn_modelo_ref_auto reaproveitando o numero) - aqui so se le, se decide se o botao habilita e se escrevem os textos. Sem I/O.
 * A tela mostra a REF nova como PREVIA no rascunho e so o Salvar grava (regra "nada grava antes do Salvar").
 */
import { lerMatriz, type MatrizSkus } from "@/components/planejamento/planejamento-detail/codigos/sku-card";
import { MENSAGENS_REGERAR, mensagemErro } from "@/lib/erro-mensagem";

export const RPC_REF_REGERAR_PREVIA = "ref_regerar_previa" as const;
export const RPC_REGERAR_REF_CARD = "regerar_ref_card" as const;

export type MotivoRefRegerar = "nao_interno" | "pulado_integracao" | "pulado_exportado" | "nao_revelada" | "sem_sigla" | "sem_numero";
const MOTIVOS: readonly string[] = ["nao_interno", "pulado_integracao", "pulado_exportado", "nao_revelada", "sem_sigla", "sem_numero"];
export type TipoRef = "automatica" | "manual";

export type PreviaRefRegerar = {
  pode: boolean;
  /** motivo da recusa (pode=false); `desconhecido` = o jsonb veio num formato que a tela nao reconhece (fail-closed) */
  motivo: MotivoRefRegerar | "desconhecido" | null;
  refAtual: string;
  refAutoAtual: string;
  refNova: string | null;
  tipoRef: TipoRef;
  /** a REF nova e diferente da atual (false = "ja esta no Formato atual") */
  muda: boolean;
  /** outros cards da mesma familia (replicas/versoes): NAO sao tocados - so o aviso */
  irmaos: number;
};

/** Os textos das recusas moram em `erro-mensagem.ts` (MENSAGENS_REGERAR — fonte única, o servidor devolve o mesmo motivo no prefixo `ref_<motivo>:`). */
export const TEXTO_MOTIVO_REF: Record<MotivoRefRegerar | "desconhecido", string> = {
  nao_interno: MENSAGENS_REGERAR.ref_nao_interno,
  pulado_integracao: MENSAGENS_REGERAR.ref_pulado_integracao,
  pulado_exportado: MENSAGENS_REGERAR.ref_pulado_exportado,
  nao_revelada: MENSAGENS_REGERAR.ref_nao_revelada,
  sem_sigla: MENSAGENS_REGERAR.ref_sem_sigla,
  sem_numero: MENSAGENS_REGERAR.ref_sem_numero,
  desconhecido: "Não foi possível ler a prévia da REF — recarregue a página.",
};
export const TEXTO_REF_JA_NO_FORMATO = "A REF já está no Formato atual — não há nada a regerar.";
export const TEXTO_REF_PREVIA_CANCELADA = "A prévia da REF foi desfeita porque a REF, a categoria ou a subcategoria do card mudou.";
export const TITULO_REGERAR_REF = "Recalcula a REF pelo Formato atual (reaproveita o número) e mostra a prévia — só o Salvar grava.";
export const MSG_REF_PREVIA_CALCULANDO =
  "A prévia dos SKUs ainda estava sendo calculada — o card foi salvo, a REF e os SKUs não. Confira a prévia e clique em Salvar de novo.";
export const MSG_REF_PREVIA_DESCONHECIDA =
  "Não foi possível ler a prévia dos SKUs — o card foi salvo, a REF e os SKUs não. Recarregue a página e tente de novo.";
export const MSG_REF_DESATUALIZADA = `${MENSAGENS_REGERAR.previa_desatualizada_ref} O card já foi salvo; a REF e os SKUs não.`;
export const PREFIXO_REF_NAO_GRAVADA = "O card foi salvo, mas a REF e os SKUs não foram gravados: ";

const objeto = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const texto = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** Lê o jsonb de `ref_regerar_previa`. FAIL-CLOSED: forma desconhecida => `pode:false`, motivo `desconhecido` (o botao nao inicia nada). */
export function lerPreviaRefRegerar(raw: unknown): PreviaRefRegerar {
  const o = objeto(raw);
  const motivo = texto(o.motivo);
  const forma = typeof o.pode === "boolean" && typeof o.muda === "boolean" && (o.tipo_ref === "automatica" || o.tipo_ref === "manual");
  const motivoOk = motivo === null || MOTIVOS.includes(motivo);
  if (!forma || !motivoOk || (o.pode === true && !texto(o.ref_nova))) {
    return { pode: false, motivo: "desconhecido", refAtual: "", refAutoAtual: "", refNova: null, tipoRef: "automatica", muda: false, irmaos: 0 };
  }
  return {
    pode: o.pode as boolean,
    motivo: motivo as MotivoRefRegerar | null,
    refAtual: texto(o.ref_atual) ?? "",
    refAutoAtual: texto(o.ref_auto_atual) ?? "",
    refNova: texto(o.ref_nova),
    tipoRef: o.tipo_ref as TipoRef,
    muda: o.muda as boolean,
    irmaos: Number.isFinite(Number(o.irmaos)) ? Math.max(0, Number(o.irmaos)) : 0,
  };
}

/** Aviso da prévia quando o card tem irmãos (réplicas/versões): nenhum irmão é tocado. `irmaos` = OUTROS cards (a família tem irmaos + 1). */
export function textoAvisoIrmaos(irmaos: number): string | null {
  if (!(irmaos > 0)) return null;
  return `Este card faz parte de uma família de ${irmaos + 1} cards; os irmãos mantêm a REF atual.`;
}

/** O que o botão "Regerar REF" decide (tela). O servidor confere tudo de novo — isto só evita o clique inútil. */
export function podeRegerarRef(o: {
  /** o MESMO `refEditavel` do campo REF (isEdit, fora da trava do Dev/Explosão, etapa da REF, sem trava da Integração) */
  refEditavel: boolean;
  /** a prévia dos SKUs viaja pela permissão de editar o Planejamento (`skus_previa`) e pela trava de SKU da Integração */
  podeEditarSkus: boolean;
  /** origem GRAVADA do card = interno */
  origemInterno: boolean;
  /** REF, categoria e subcategoria 1 do rascunho = as salvas (a prévia é calculada sobre o estado SALVO) */
  rascunhoLimpo: boolean;
  /** nenhum SKU "a gravar" (Regerar SKUs / digitados) — o Regerar REF já faz o plano `regerar` completo */
  skusAGravarVazio: boolean;
  jaPendente: boolean;
  consultando: boolean;
}): { pode: boolean; motivo: string } {
  if (!o.origemInterno) return { pode: false, motivo: TEXTO_MOTIVO_REF.nao_interno };
  if (!o.refEditavel) return { pode: false, motivo: "A REF só pode ser regerada com o card editável (etapa da REF, fora da Explosão e sem trava da Integração)." };
  if (!o.podeEditarSkus) return { pode: false, motivo: "Sem permissão para regerar os SKUs (Planejamento) ou SKUs travados pela Integração." };
  if (o.jaPendente) return { pode: false, motivo: "A prévia da REF já está na tela — Salvar grava; Desfazer prévia volta." };
  if (!o.skusAGravarVazio) return { pode: false, motivo: "Há SKUs a gravar — salve o card ou desfaça a prévia dos SKUs antes de regerar a REF." };
  if (!o.rascunhoLimpo) return { pode: false, motivo: "Salve a categoria, a subcategoria ou a REF antes de regerar a REF." };
  if (o.consultando) return { pode: false, motivo: "Calculando a REF…" };
  return { pode: true, motivo: TITULO_REGERAR_REF };
}

export type EntradaRef = { ref: string; categoria: string | null; sub1: string | null };
export const mesmaEntradaRef = (a: EntradaRef, b: EntradaRef): boolean =>
  a.ref.trim() === b.ref.trim() && (a.categoria ?? null) === (b.categoria ?? null) && (a.sub1 ?? null) === (b.sub1 ?? null);

export type ResultadoRegerarRef = { ref: string; rev: number | null; matriz: MatrizSkus; resumo: Record<string, unknown> };
/** Lê o retorno de `regerar_ref_card`: `{ref, ref_auto, rev, skus: <matriz>, criados, atualizados, removidos, manuais, conflitos}`. */
export function lerResultadoRegerarRef(raw: unknown): ResultadoRegerarRef {
  const o = objeto(raw);
  const { skus: _skus, ...resumo } = o;
  return { ref: texto(o.ref) ?? "", rev: typeof o.rev === "number" ? o.rev : null, matriz: lerMatriz(o.skus), resumo };
}

/** Erro de `regerar_ref_card` no Salvar: P0409 (REF/Formato OU a assinatura dos SKUs mudou desde a prévia) tem texto próprio; o resto = o card salvou, a REF/SKUs não. */
export function mensagemRegerarRef(e: unknown): string {
  if (String(objeto(e).code ?? "") === "P0409") return MSG_REF_DESATUALIZADA;
  return PREFIXO_REF_NAO_GRAVADA + mensagemErro(e, "erro desconhecido");
}
