// Integração › Produtos › "Gerar JSON" — funções PURAS da tela (pré-classificação local, motivo do botão, nome do arquivo
// e textos). O BANCO decide quem entra (`integracao_gerar_json_ler`, com autoridade); isto só espelha a MESMA ordem de
// prioridade para o alerta de confirmação e para o botão (plano 2026-10-04-gerar-json, D1/D2/D3/D6).
import { MAX_GERAR_JSON } from "./api/gerar-json";
import type { ForaGerarJson } from "./api/resposta";
import type { ProdutoLista } from "./produtos";

export type ClasseGerarJson = {
  /** Integrável (e não reprovado) → passa a Integrado. */
  novos: ProdutoLista[];
  /** Já Integrado → reexportação (sem mudar estado). */
  reexportar: ProdutoLista[];
  fora: { p: ProdutoLista; motivo: ForaGerarJson["motivo"] }[];
};

/** MESMA ordem de prioridade do banco: nao_integravel > reprovado (só integrável; integrado reprovado entra) > sem_custo. */
export function classificarGerarJson(sel: ProdutoLista[], ctx: { podeVerCustos: boolean }): ClasseGerarJson {
  const c: ClasseGerarJson = { novos: [], reexportar: [], fora: [] };
  for (const p of sel) {
    if (p.estado === "nao_integravel") { c.fora.push({ p, motivo: "nao_integravel" }); continue; }
    if (p.estado === "integravel" && p.reprovado) { c.fora.push({ p, motivo: "reprovado" }); continue; }
    if ((p.retrato?.campos ?? []).includes("preco_custo") && !ctx.podeVerCustos) { c.fora.push({ p, motivo: "sem_custo" }); continue; }
    (p.estado === "integrado" ? c.reexportar : c.novos).push(p);
  }
  return c;
}

/** Teto por arquivo = o do banco: MENOR entre o teto absoluto e o "máximo por página" da loja (só o super admin lê a config
 *  da API; sem ela, vale o absoluto e o banco recusa com o número certo se a loja tiver menos). */
export function tetoGerarJson(maxPorPagina: number | null | undefined): number {
  const m = typeof maxPorPagina === "number" && Number.isFinite(maxPorPagina) && maxPorPagina >= 1 ? Math.floor(maxPorPagina) : MAX_GERAR_JSON;
  return Math.min(MAX_GERAR_JSON, m);
}

/** Por que o botão está desabilitado (null = habilitado). */
export function motivoGerarJson(sel: ProdutoLista[], c: ClasseGerarJson, podeEditar: boolean, teto: number = MAX_GERAR_JSON): string | null {
  if (sel.length === 0) return "Selecione produtos.";
  if (!podeEditar) return "Precisa da permissão de editar a Integração.";
  if (sel.length > teto) return `Máximo de ${teto} produtos por arquivo.`;
  if (c.novos.length + c.reexportar.length === 0) return "Nenhum selecionado está Integrável ou Integrado.";
  return null;
}

export const MOTIVO_FORA_GERAR_JSON: Record<ForaGerarJson["motivo"], string> = {
  nao_integravel: "ainda não está Integrável (marque Integrável antes)",
  reprovado: "está reprovado",
  sem_custo: "tem Preço de custo — só quem vê custos pode gerar",
  mudou: "mudou durante a geração (voltou ou foi desfeito) — não entrou no arquivo",
};

const slug = (s: string): string =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** `integracao-<loja>-aaaa-mm-dd-hhmm.json`, data/hora no FUSO DA LOJA; slug da loja = sem acento, [a-z0-9-]; sem nome → "loja". */
export function nomeArquivoJson(lojaNome: string | null, quando: Date, tz: string): string {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(quando);
  const v = (t: Intl.DateTimeFormatPartTypes) => p.find((x) => x.type === t)?.value ?? "00";
  return `integracao-${slug(lojaNome ?? "") || "loja"}-${v("year")}-${v("month")}-${v("day")}-${v("hour")}${v("minute")}.json`;
}

export const TEXTO_GERAR_JSON_EXPLICA =
  "Gerar o arquivo É uma entrega: os produtos Integráveis passam a Integrado agora, como se a API os tivesse levado — a API não os entrega de novo como novos (só com incluir_integrados). Os já Integrados saem de novo no arquivo, sem mudar nada. Fica registrado no Log com o seu nome.";
/** Ruling Q2 (controlador): aviso da reexportação no alerta. */
export const TEXTO_GERAR_JSON_REEXPORTA = "Já Integrados saem como reexportação; o ERP deve usar integrado_em para não duplicar.";
export const TEXTO_GERAR_JSON_FOTOS = (dias: number): string =>
  `Os links das fotos valem por ${dias} dia(s). Depois disso, gere de novo (os Integrados saem como reexportação).`;
export const TEXTO_GERAR_JSON_FECHAR_SEM_SALVAR =
  "Você baixou ou copiou o arquivo? Os produtos já constam como Integrado. Se fechar agora, dá para gerar de novo selecionando-os em Situação “Integrados”.";
