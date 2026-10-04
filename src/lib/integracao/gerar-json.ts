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

/** Teto por arquivo = o do banco (RPC `integracao_gerar_json_teto`, para TODOS que veem a Integração): MENOR entre o teto
 *  absoluto e o "máximo por página" da loja. Valor inválido cai no absoluto (o banco recusa com o número certo). */
export function tetoGerarJson(valor: number | null | undefined): number {
  const m = typeof valor === "number" && Number.isFinite(valor) && valor >= 1 ? Math.floor(valor) : MAX_GERAR_JSON;
  return Math.min(MAX_GERAR_JSON, m);
}
/** O teto que a TELA usa: `null` enquanto carrega (botão desabilitado — nunca deixa passar pela confirmação séria um lote que o
 *  banco vai recusar); erro na consulta cai no absoluto (a recusa do servidor, traduzida, é a rede de segurança). */
export function tetoDaTela(valor: number | null | undefined, erro: boolean): number | null {
  if (valor !== null && valor !== undefined) return tetoGerarJson(valor);
  return erro ? MAX_GERAR_JSON : null;
}
/** `fora` do servidor sem nome/REF (layout da loja sem esses campos) → completa pelos produtos carregados na tela (por modelo_id). */
export function completarFora(fora: ForaGerarJson[], produtos: ProdutoLista[]): ForaGerarJson[] {
  const porId = new Map(produtos.map((p) => [p.modeloId, p]));
  return fora.map((f) => {
    const p = porId.get(f.modelo_id);
    return p ? { ...f, nome: f.nome ?? p.raw.nome, ref: f.ref ?? p.raw.ref } : f;
  });
}

/** Por que o botão está desabilitado (null = habilitado). */
export function motivoGerarJson(sel: ProdutoLista[], c: ClasseGerarJson, podeEditar: boolean, teto: number | null = MAX_GERAR_JSON): string | null {
  if (sel.length === 0) return "Selecione produtos.";
  if (!podeEditar) return "Precisa da permissão de editar a Integração.";
  if (teto === null) return "Carregando o limite por arquivo…";
  if (sel.length > teto) return `Máximo de ${teto} produtos por arquivo.`;
  if (c.novos.length + c.reexportar.length === 0) return "Nenhum selecionado está Integrável ou Integrado.";
  return null;
}

/** Key do teto por arquivo (com a loja) — aqui (e não em `useIntegracao`) para as abas Campos/API invalidarem sem depender do hook. */
export const chaveTetoGerarJson = (tenantId: string) => ["integracao-gerar-json-teto", tenantId] as const;

/** Concordância de número (1 / N) dos textos do diálogo. */
export function resumoResultadoGerarJson(novos: number, relidos: number, fora: number): string {
  const a = novos === 1 ? "1 passou a Integrado" : `${novos} passaram a Integrado`;
  const b = relidos === 1 ? "1 reexportado" : `${relidos} reexportados`;
  return `${a} · ${b} · ${fora} fora`;
}
export const entramGerarJson = (n: number): string => (n === 1 ? "Entra" : "Entram");
export const passamAIntegrado = (n: number): string => (n === 1 ? "passa a Integrado" : "passam a Integrado");
export const reexportacaoGerarJson = (n: number): string => (n === 1 ? "reexportação (já integrado)" : "reexportações (já integrados)");

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
