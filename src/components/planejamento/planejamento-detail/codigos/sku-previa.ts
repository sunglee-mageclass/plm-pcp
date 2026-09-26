// SKU em PRÉVIA (spec docs/superpowers/specs/2026-09-25-sku-previa-regerar-design.md §4.2 — P-46 do dono): regras PURAS do
// "a gravar" da seção "4. Códigos". O Regerar e o SKU digitado à mão NÃO gravam na hora: ficam aqui (rascunho FORA do
// Draft — R5), a prévia vem do SERVIDOR (RPC skus_previa — o MESMO plano da gravação, só leitura) e só o Salvar do card
// grava (RPC aplicar_skus_modelo, com a assinatura da prévia vista). Voltar/Descartar = o rascunho some e os SKUs gravados
// ficam. Nada de espelho TS da geração: aqui só a entrada, a leitura tolerante da prévia e os textos. Sem I/O.
import { normalizarSkuManual } from "@/lib/sku-montar";
import { mensagemErro } from "@/lib/erro-mensagem";
import { lerMatriz, situacaoSku, type LinhaSku, type MatrizSkus, type SituacaoSku } from "./sku-card";

export type ManualAGravar = { varianteKey: string; tamanhoKey: string; sku: string; id: string | null; rev: number | null };
export type SkusAGravar = { regerar: boolean; manuais: Record<string, ManualAGravar> };
export const SKUS_A_GRAVAR_VAZIO: SkusAGravar = { regerar: false, manuais: {} };
// Fix 1 (T5, revisão Opus C1) — 'criar' entra ao lado de 'manuais'/'regerar': card VIRGEM (nenhum SKU gravado) com algo
// "a gravar" usa 'criar' — automáticas + digitados NUM PLANO SÓ, UMA assinatura só (o banco já aceita, migration :379).
// Sem isto, `gerarSeFaltar` (que cria as automáticas OUTRAS que o digitado) e `aplicarAGravar` (modo 'manuais', que só
// grava a linha digitada) brigavam pela mesma linha em duas chamadas — a 2ª sempre via P0409 (B1: rev null numa chave
// que a 1ª chamada acabou de criar), e o SKU digitado nunca gravava no 1º Salvar de um card virgem.
export type ModoPrevia = "manuais" | "regerar" | "criar";

export const TEXTO_PREVIA =
  "Prévia — nada foi gravado ainda. Os SKUs só mudam quando você clicar em Salvar; Voltar ou Descartar mantém os atuais.";
export const TEXTO_BOM_SUJO =
  "A grade ou os tecidos têm alterações não salvas: a prévia usa a grade salva e é conferida de novo no Salvar.";
export const MSG_PREVIA_CALCULANDO =
  "A prévia dos SKUs ainda estava sendo calculada — o card foi salvo, os SKUs não. Confira a prévia e clique em Salvar de novo.";
// M3 (T5, revisão Opus) — texto PRÓPRIO para a prévia `desconhecida` (fail-closed: status/ação/assinatura que o front não
// reconhece): o motivo real não é "ainda calculando", é "não deu pra ler" — recarregar resolve; esperar não.
export const MSG_PREVIA_DESCONHECIDA =
  "Não foi possível ler a prévia dos SKUs — o card foi salvo, os SKUs não. Recarregue a página e tente de novo.";
export const MSG_PREVIA_DESATUALIZADA =
  "Os SKUs mudaram desde a prévia (outra pessoa gerou ou editou, ou mudou sigla, Formato ou grade). A prévia foi atualizada — confira e clique em Salvar de novo. O card já foi salvo.";
export const PREFIXO_SKUS_NAO_GRAVADOS = "O card foi salvo, mas os SKUs não foram gravados: ";
export const TITULO_REGERAR = "Mostra como ficam os SKUs — só o Salvar grava.";

export const chaveLinhaSku = (varianteKey: string, tamanhoKey: string): string => `${varianteKey}|${tamanhoKey}`;
export const nadaAGravar = (s: SkusAGravar): boolean => !s.regerar && Object.keys(s.manuais).length === 0;
/** Fix 1 (C1) — `virgem` é OBRIGATÓRIO (vem da matriz GRAVADA: nenhuma linha tem `id`). Regerar pedido vence sempre
 *  ('regerar' também gera tudo, mas REMOVE órfãs — passo 2 do plano — o que 'criar' nunca faz); senão, card virgem com
 *  algo "a gravar" usa 'criar' (gera as automáticas que faltam JUNTO do digitado); senão, 'manuais' (card já tem SKU:
 *  só grava o que foi digitado, nunca gera sozinho aqui — a 1ª geração de resto é sempre via `gerarSeFaltar`). */
export const modoPrevia = (s: SkusAGravar, virgem: boolean): ModoPrevia => (s.regerar ? "regerar" : virgem ? "criar" : "manuais");

export function comRegerar(s: SkusAGravar): SkusAGravar {
  return s.regerar ? s : { ...s, regerar: true };
}
export function semManual(s: SkusAGravar, chave: string): SkusAGravar {
  if (!(chave in s.manuais)) return s;
  const manuais = { ...s.manuais };
  delete manuais[chave];
  return { ...s, manuais };
}
/** "manter o meu": o SKU digitado passa a valer contra a versão NOVA da linha (id/rev de agora — outra pessoa mudou). */
export function manterMeu(s: SkusAGravar, l: Pick<LinhaSku, "variante_key" | "tamanho_key" | "id" | "rev">): SkusAGravar {
  const chave = chaveLinhaSku(l.variante_key, l.tamanho_key);
  const m = s.manuais[chave];
  if (!m) return s;
  return { ...s, manuais: { ...s.manuais, [chave]: { ...m, id: l.id, rev: l.rev } } };
}

export type AcaoPrevia = "novo" | "muda" | "sai" | "manual_novo" | "conflito" | "erro";
export type PreviaLinha = { acao: AcaoPrevia; sku_de: string | null; sku_para: string | null; mensagem: string | null; code: string | null };
export type LinhaPrevia = LinhaSku & { previa: PreviaLinha | null };

/** O SKU que a linha MOSTRA agora: o digitado ("a gravar") > o que o Salvar grava (novo/muda) > o gravado. */
export function skuExibido(l: LinhaSku | LinhaPrevia, s: SkusAGravar): string {
  const m = s.manuais[chaveLinhaSku(l.variante_key, l.tamanho_key)];
  if (m) return m.sku;
  const p = "previa" in l ? l.previa : null;
  if (p && (p.acao === "novo" || p.acao === "muda")) return p.sku_para ?? "";
  return l.sku ?? "";
}

export type Digitado = { aGravar: SkusAGravar; erro: string | null; valor: string };
/** SKU digitado (blur/Enter). Inválido ⇒ erro PT (as MESMAS regras/mensagens de _sku_norm_manual — espelho da F3.5a) e nada
 *  muda; igual ao que a linha MOSTRA ⇒ nada; senão entra "a gravar" (editado à mão no Salvar) com o id/rev da linha. */
export function digitarSku(s: SkusAGravar, l: LinhaSku | LinhaPrevia, texto: string): Digitado {
  const exibido = skuExibido(l, s);
  if (texto.trim() === "" && exibido === "") return { aGravar: s, erro: null, valor: "" };
  const n = normalizarSkuManual(texto);
  if (!n.ok) return { aGravar: s, erro: n.erro, valor: exibido };
  if (n.valor === exibido) return { aGravar: s, erro: null, valor: exibido };
  const chave = chaveLinhaSku(l.variante_key, l.tamanho_key);
  const novo: ManualAGravar = { varianteKey: l.variante_key, tamanhoKey: l.tamanho_key, sku: n.valor, id: l.id, rev: l.rev };
  return { aGravar: { ...s, manuais: { ...s.manuais, [chave]: novo } }, erro: null, valor: n.valor };
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
export type ManualRpc = { variante_key: string; tamanho_key: string; sku: string; rev: number | null };
/** `_manuais` das RPCs, ordenado pela chave: a entrada da prévia e a da gravação são a MESMA. */
export function manuaisParaRpc(s: SkusAGravar): ManualRpc[] {
  return Object.values(s.manuais)
    .map((m) => ({ variante_key: m.varianteKey, tamanho_key: m.tamanhoKey, sku: m.sku, rev: m.rev }))
    .sort((a, b) => cmp(chaveLinhaSku(a.variante_key, a.tamanho_key), chaveLinhaSku(b.variante_key, b.tamanho_key)));
}

// Fix 1 (C1) — `virgem` entra na ENTRADA da prévia: a matriz gravada decide 'criar' vs 'manuais' (modoPrevia), e o
// aplicar tem que mandar o MESMO modo que a prévia vista usou (nunca recalcular `virgem` de novo no momento do Salvar
// — a matriz pode ter mudado; o modo vem de `entradaDaChave(d.entrada).modo`, não de uma nova leitura).
export type EntradaPrevia = { ref: string; tamanhoTipo: "letra" | "numero"; aGravar: SkusAGravar; virgem: boolean };
/** Chave estável da entrada da prévia: é a queryKey e responde "a prévia na tela é a da entrada de agora?". */
export function chaveEntradaPrevia(e: EntradaPrevia): string {
  return JSON.stringify([e.ref.trim(), e.tamanhoTipo, modoPrevia(e.aGravar, e.virgem), manuaisParaRpc(e.aGravar)]);
}
export function entradaDaChave(chave: string): { ref: string; tamanhoTipo: "letra" | "numero"; modo: ModoPrevia; manuais: ManualRpc[] } {
  const [ref, tamanhoTipo, modo, manuais] = JSON.parse(chave) as [string, "letra" | "numero", ModoPrevia, ManualRpc[]];
  return { ref, tamanhoTipo, modo, manuais };
}
/** A REF da prévia = a que o Salvar vai gravar: a do rascunho quando ela entra no payload (refEditavel —
 *  aplicarRegrasCamposDev), senão a salva. Aparada (o payload apara). */
export function refParaPrevia(o: { refVaiNoSalvar: boolean; refRascunho: string; refSalva: string }): string {
  return ((o.refVaiNoSalvar ? o.refRascunho : o.refSalva) ?? "").trim();
}

export type ErroPrevia = { variante_key: string; tamanho_key: string; code: string; mensagem: string };
export type PreviaSkus = {
  matriz: MatrizSkus & { linhas: LinhaPrevia[] };
  assinatura: string | null;
  erros: ErroPrevia[];
  nConflitos: number;
  entrada: string;
  desconhecida: boolean;
};
const ACOES: readonly string[] = ["novo", "muda", "sai", "manual_novo", "conflito", "erro"];
const objeto = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const texto = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** Lê o jsonb de skus_previa. FAIL-CLOSED: status desconhecido, ação desconhecida ou assinatura que não é md5 ⇒
 *  `desconhecida` e `assinatura` null (o Salvar NÃO grava os SKUs). */
export function lerPrevia(raw: unknown, entrada: string): PreviaSkus {
  const o = objeto(raw);
  const base = lerMatriz(raw);
  const cruas = Array.isArray(o.linhas) ? o.linhas.map(objeto) : [];
  let desconhecida = base.status === "desconhecido";
  const linhas: LinhaPrevia[] = base.linhas.map((l, i) => {
    const p = cruas[i]?.previa;
    if (p === null || p === undefined) return { ...l, previa: null };
    const po = objeto(p);
    if (!ACOES.includes(String(po.acao))) {
      desconhecida = true;
      return { ...l, previa: { acao: "erro", sku_de: null, sku_para: null, mensagem: "Situação desconhecida — recarregue a página.", code: null } };
    }
    return { ...l, previa: { acao: po.acao as AcaoPrevia, sku_de: texto(po.sku_de), sku_para: texto(po.sku_para), mensagem: texto(po.mensagem), code: texto(po.code) } };
  });
  const ass = texto(o.assinatura);
  if (!ass || !/^[0-9a-f]{32}$/.test(ass)) desconhecida = true;
  const erros = (Array.isArray(o.erros) ? o.erros : []).map(objeto).map((e): ErroPrevia => ({
    variante_key: texto(e.variante_key) ?? "", tamanho_key: texto(e.tamanho_key) ?? "",
    code: texto(e.code) ?? "P0001", mensagem: texto(e.mensagem) ?? "SKU inválido.",
  }));
  return {
    matriz: { ...base, linhas },
    assinatura: desconhecida ? null : ass,
    erros,
    nConflitos: Array.isArray(o.conflitos) ? o.conflitos.length : 0,
    entrada,
    desconhecida,
  };
}

export type SituacaoPrevia = SituacaoSku & { aGravar: boolean; conflitoVersao: boolean };
/** O que a linha diz com a prévia na tela: a ação do plano (vai mudar/não vai) ou, sem ação, o estado de hoje.
 *  Fix 1 (T5, revisão Opus C2) — `erros` é OBRIGATÓRIO (produção sempre tem `previa.erros` à mão) e o erro da MESMA
 *  chave (variante_key+tamanho_key) vira a `previa` da linha (com a MESMA forma de `PreviaLinha`, `acao:"erro"`),
 *  caindo no MESMO `case "erro"` de sempre — o `switch` deixa de ter dois caminhos p/ erro (um morto, outro vivo):
 *  P0409 continua marcando `conflitoVersao:true` (o botão "manter o meu · usar o novo" some SE a precedência
 *  esconder isso) e o texto do P0001 é a mensagem PURA do servidor (nunca o prefixo do toast "O card foi salvo…" —
 *  isso é só para o TOAST de depois do Salvar, não para o rótulo da linha ENQUANTO o usuário ainda está digitando). */
export function situacaoPrevia(l: LinhaPrevia, erros: readonly ErroPrevia[]): SituacaoPrevia {
  const x = (s: SituacaoSku, aGravar = false, conflitoVersao = false): SituacaoPrevia => ({ ...s, aGravar, conflitoVersao });
  const erroDaLinha = erros.find((e) => e.variante_key === l.variante_key && e.tamanho_key === l.tamanho_key);
  const p: PreviaLinha | null = erroDaLinha
    ? { acao: "erro", code: erroDaLinha.code, mensagem: erroDaLinha.mensagem, sku_de: l.previa?.sku_de ?? l.sku, sku_para: l.previa?.sku_para ?? null }
    : l.previa;
  if (p) {
    switch (p.acao) {
      case "novo": return x({ tom: "warning", texto: "novo · a gravar", cadastrar: false }, true);
      case "muda": return x({ tom: "warning", texto: `muda de ${p.sku_de ?? "—"} · a gravar`, cadastrar: false }, true);
      case "sai": return x({ tom: "warning", texto: "sai no Salvar", cadastrar: false }, true);
      case "manual_novo": return x({ tom: "warning", texto: "editado à mão · a gravar", cadastrar: false }, true);
      case "conflito": return x({ tom: "danger", texto: `não será gravado — ${p.mensagem ?? "conflito"}`, cadastrar: false });
      case "erro":
        return p.code === "P0409"
          ? x({ tom: "danger", texto: `Outra pessoa mudou este SKU para ${p.sku_de ?? l.sku ?? "—"} — o seu (${p.sku_para ?? "—"}) ainda não foi gravado.`, cadastrar: false }, false, true)
          : x({ tom: "danger", texto: p.mensagem ?? "SKU inválido.", cadastrar: false });
    }
  }
  const s = situacaoSku(l);
  if (l.estado === "ok") return x({ ...s, texto: "igual" });
  if (l.estado === "manual") return x({ ...s, texto: "editado à mão — mantido" });
  if (l.estado === "falta" && l.sku) return x({ ...s, texto: `${s.texto} (mantém ${l.sku})` });
  return x(s);
}

export function resumoAplicacao(raw: unknown): { erro: boolean; texto: string } {
  const o = objeto(raw);
  const n = (k: string) => Number(o[k] ?? 0) || 0;
  const base = `SKUs gravados: ${n("criados")} novo(s), ${n("atualizados")} atualizado(s), ${n("removidos")} removido(s), ${n("manuais")} à mão.`;
  const conflitos = Array.isArray(o.conflitos) ? o.conflitos.map(objeto) : [];
  if (conflitos.length === 0) return { erro: false, texto: base };
  const s = conflitos.length > 1 ? "s" : "";
  return { erro: true, texto: `${base} ${conflitos.length} SKU${s} não gravado${s}: ${texto(conflitos[0].mensagem) ?? "conflito"}` };
}
/** Erro de aplicar_skus_modelo. P0409 (prévia velha/rev velho) = texto do SKU, não o genérico de "registro". */
export function mensagemAplicarSkus(e: unknown): string {
  if (objeto(e).code === "P0409") return MSG_PREVIA_DESATUALIZADA;
  return PREFIXO_SKUS_NAO_GRAVADOS + mensagemErro(e, "erro desconhecido");
}
export function mensagemErroPrevia(e: ErroPrevia): string {
  return e.code === "P0409"
    ? `${PREFIXO_SKUS_NAO_GRAVADOS}outra pessoa mudou um SKU que você digitou — escolha “manter o meu” ou “usar o novo” na linha.`
    : PREFIXO_SKUS_NAO_GRAVADOS + e.mensagem;
}
/** Regerar em prévia: liberado com REF/"Tamanho em" digitados e não salvos (P-46); só a REF da prévia vazia trava. */
export function podeRegerar(o: { podeEditar: boolean; matriz: MatrizSkus | undefined; refPrevia: string; jaPedido: boolean }): { pode: boolean; motivo: string } {
  if (!o.podeEditar) return { pode: false, motivo: "Sem permissão para editar os SKUs." };
  if (!o.matriz) return { pode: false, motivo: "Carregando os SKUs…" };
  if (o.matriz.status === "desconhecido") return { pode: false, motivo: "Não foi possível ler a situação dos SKUs — recarregue a página." };
  if (o.matriz.status === "sem_formato") return { pode: false, motivo: "A loja ainda não tem o Formato do SKU." };
  if (o.refPrevia.trim() === "") return { pode: false, motivo: "Preencha a REF para regerar." };
  if (o.jaPedido) return { pode: false, motivo: "A prévia do Regerar já está na tela — Salvar grava; Desfazer prévia volta." };
  return { pode: true, motivo: TITULO_REGERAR };
}
