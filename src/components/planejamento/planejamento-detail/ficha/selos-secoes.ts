// F3.3 — numeração "N." e selos de completude de TODAS as seções do Sheet unificado (mockup gen_main.py:31-106 e
// gen_rest.py:9-26; adiados da F3.1 — plano F3.1 §7 T2). MAPA PRÓPRIO seção→condições (decisão travada 8: o catálogo
// `kanban-condicoes.ts` e o `CondicaoSecao` seguem as chaves do acordeão do Dev e NÃO mudam). As 4 seções do BOM seguem
// com `selos-bom.ts` (F3.2). Regras do Dev: `reqBadge` (ModeloDetailPanel.tsx:1644-1677) e os selos informativos
// (:2793-2795 Informações, :2837-2838 Prova, :2886-2890 CAD, :3068-3072 Anexos). Puro — planejamento-selos-secoes.test.ts.
import { brl, fmtNum, mesLimpo } from "@/lib/format";
import type { EstadoMO } from "@/lib/mao-obra";
import { seloPorChaves, type SeloSecao } from "./selos-bom";

export type SecaoSheetKey =
  | "info" | "colecao" | "desenvolvimento" | "prova"
  | "tecidos" | "aviamentos" | "insumos" | "grade" | "cad"
  | "tecidos_novo" | "preco" | "mao_obra" | "produto_acabado" | "grade_revenda"
  | "anexos" | "observacoes" | "lancamento" | "relacionado";

/** Ordem do mockup aprovado (gen_main.py:106) + "Tecidos" do Dialog e as 2 seções da revenda onde o JSX as põe. */
export const ORDEM_SECOES_SHEET: readonly SecaoSheetKey[] = [
  "info", "colecao", "desenvolvimento", "prova", "tecidos", "aviamentos", "insumos", "grade", "cad",
  "tecidos_novo", "preco", "mao_obra", "produto_acabado", "grade_revenda", "anexos", "observacoes", "lancamento", "relacionado",
];

/** Dialog "Novo Modelo": o mockup aprovado numera SÓ "1. Informações Gerais do Produto" e "2. Coleção"; Tecidos, Mão de
 *  obra e Anexos aparecem SEM número (gen_novo.py:13-20 — ruling R7 do G-plano F3.3: seguir o mockup). */
const SECOES_NUMERADAS_DIALOG_NOVO: ReadonlySet<SecaoSheetKey> = new Set<SecaoSheetKey>(["info", "colecao"]);

/** Numeração DINÂMICA: 1..N só nas seções visíveis (mesma regra do `secNum` do Dev, :1620-1629). No Dialog "Novo Modelo"
 *  (`dialogNovo`), só as do mockup (acima) — as demais ficam sem número (`undefined` ⇒ a `Secao` não mostra "N."). */
export function numerarSecoes(
  visiveis: ReadonlySet<SecaoSheetKey>,
  opts?: { dialogNovo?: boolean },
): Partial<Record<SecaoSheetKey, number>> {
  const out: Partial<Record<SecaoSheetKey, number>> = {};
  let n = 0;
  for (const k of ORDEM_SECOES_SHEET) {
    if (!visiveis.has(k)) continue;
    if (opts?.dialogNovo && !SECOES_NUMERADAS_DIALOG_NOVO.has(k)) continue;
    out[k] = ++n;
  }
  return out;
}

/** Seção do Sheet → condições do catálogo cujo requisito vira o selo (as do Dev "s1" se dividem em Informações/Coleção/
 *  Desenvolvimento; as do BOM ficam em `CONDICOES_SECAO_BOM`). `lancado` fica fora (o próprio catálogo desaconselha). */
export const CONDICOES_SECAO_SHEET: Partial<Record<SecaoSheetKey, readonly string[]>> = {
  info: ["categoria_definida", "subcategoria1_definida", "subcategoria2_definida", "estilista_definido"],
  colecao: ["linha_definida", "colecao_preenchida"],
  desenvolvimento: ["modelista_definido", "piloteiro_definido", "data_desenho_tecnico", "data_piloto1", "data_piloto2", "data_piloto3", "data_aprovacao"],
  cad: ["cad_preenchido"],
  preco: ["preco_venda_preenchido"],
  mao_obra: ["servico_aprovado", "servico_mo_decidido", "servico_mo_preenchido"],
  anexos: ["anexo_croqui", "desenho_tecnico_anexado", "anexo_modelo", "ficha_medida_anexada"],
  lancamento: ["data_lancamento_preenchida"],
};

function seloRequisito(secao: SecaoSheetKey, requeridas: ReadonlySet<string>, satisfeitas: Record<string, boolean> | null): SeloSecao | null {
  const chaves = CONDICOES_SECAO_SHEET[secao];
  if (!chaves || !satisfeitas) return null;
  return seloPorChaves(chaves, requeridas, satisfeitas);
}

/** "2027-03-15" → "15/03/2027" (vazio se não é data ISO). */
export function dataBR(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

/** Resumo da seção Coleção no cabeçalho (mockup: "Verão 2027 · Casual · lanç. 2 · mar/2027"). */
export function resumoColecao(i: { colecao: string | null; subcolecao: string | null; linha: string | null; semana: string | null; mes: string | null; ano: string | null }): string {
  const mes = i.mes ? mesLimpo(i.mes).slice(0, 3).toLowerCase() : "";
  const mesAno = mes && i.ano ? `${mes}/${i.ano}` : mes || i.ano || "";
  return [i.colecao, i.subcolecao, i.linha, i.semana ? `lanç. ${i.semana}` : null, mesAno || null]
    .filter((x): x is string => !!x && x.trim() !== "")
    .join(" · ");
}

export type EntradaSelosSheet = {
  /** União dos requisitos configurados (por origem — `requisitosUniao`). */
  requeridas: ReadonlySet<string>;
  /** Condições do card no estado SALVO; null = ainda não carregadas (só o informativo). */
  satisfeitas: Record<string, boolean> | null;
  podeVerCustos: boolean;
  infoCompleta: boolean;
  colecaoResumo: string;
  desenvolvimentoCompleto: boolean;
  /** null = revenda (a tabela de preço é outra) → sem selo. */
  preco: { efetivo: number; markup: number } | null;
  maoObra: { estado: EstadoMO; total: number };
  anexos: { fotoModelo: boolean; desenho: boolean; croqui: boolean };
  lancamento: { lancado: boolean; data: string | null };
};

/** Selos das seções do Planejamento + as simples do Dev. BOM/CAD/Prova/Observações/Relacionado: funções próprias. */
export function selosSecoesSheet(e: EntradaSelosSheet): Partial<Record<SecaoSheetKey, SeloSecao>> {
  const r = (k: SecaoSheetKey) => seloRequisito(k, e.requeridas, e.satisfeitas);
  const out: Partial<Record<SecaoSheetKey, SeloSecao>> = {};
  out.info = r("info") ?? (e.infoCompleta ? { tone: "ok", texto: "completa" } : { tone: "muted", texto: "faltam dados" });
  out.colecao = r("colecao") ?? { tone: "muted", texto: e.colecaoResumo || "vazio" };
  out.desenvolvimento = r("desenvolvimento") ?? (e.desenvolvimentoCompleto ? { tone: "ok", texto: "completa" } : { tone: "muted", texto: "faltam dados" });
  // Invariante #12: valor em R$ só p/ quem vê custos (o selo aparece com a seção FECHADA).
  const precoReq = r("preco");
  if (precoReq) out.preco = precoReq;
  else if (e.podeVerCustos && e.preco && e.preco.efetivo > 0) {
    out.preco = { tone: "muted", texto: `Preço de venda ${brl(e.preco.efetivo)}${e.preco.markup > 0 ? ` · markup ${fmtNum(e.preco.markup)}×` : ""}` };
  }
  const mo = e.maoObra;
  out.mao_obra = r("mao_obra") ?? (
    mo.estado === "sem_servico" ? { tone: "muted", texto: "sem serviço" }
      : mo.estado === "aprovada" ? { tone: "ok", texto: e.podeVerCustos ? `aprovada · ${brl(mo.total)}` : "aprovada" }
        : mo.estado === "reprovada" ? { tone: "warn", texto: "reprovada" }
          : { tone: "warn", texto: "pendente" });
  const a = e.anexos;
  out.anexos = r("anexos") ?? (
    a.fotoModelo && a.desenho && a.croqui ? { tone: "ok", texto: "anexos ok" }
      : a.fotoModelo ? { tone: "info", texto: "foto do modelo" }
        : a.desenho ? { tone: "info", texto: "desenho técnico" }
          : a.croqui ? { tone: "info", texto: "croqui" }
            : { tone: "muted", texto: "vazio" });
  out.lancamento = r("lancamento") ?? (
    e.lancamento.lancado ? { tone: "ok", texto: "lançado" }
      : e.lancamento.data ? { tone: "muted", texto: dataBR(e.lancamento.data) }
        : { tone: "muted", texto: "sem data" });
  return out;
}

/** Selo da seção CAD (Dev :2886-2890 + requisito `cad_preenchido`). */
export function seloCadSecao(i: {
  requeridas: ReadonlySet<string>; satisfeitas: Record<string, boolean> | null;
  linhas: number; faltas: string[]; antesDaOrdem: boolean;
}): SeloSecao {
  const req = seloRequisito("cad", i.requeridas, i.satisfeitas);
  if (req) return req;
  if (i.linhas === 0) return { tone: "muted", texto: "vazio" };
  if (i.antesDaOrdem) return { tone: "muted", texto: "após a Ordem de Criação" };
  if (i.faltas.length > 0) return { tone: "warn", texto: `falta ${i.faltas.join(", ")}`, title: `Falta: ${i.faltas.join(", ")}` };
  return { tone: "ok", texto: "ok" };
}

/** Prova (Dev :2836-2838). */
export function seloProva(abertos: number): SeloSecao {
  return abertos > 0 ? { tone: "info", texto: `${abertos} aberto${abertos > 1 ? "s" : ""}` } : { tone: "muted", texto: "sem ajustes" };
}
/** Observações (mockup: "1 observação"). A Composição automática não é linha da tabela. */
export function seloObservacoes(n: number): SeloSecao {
  return n > 0 ? { tone: "muted", texto: `${n} ${n > 1 ? "observações" : "observação"}` } : { tone: "muted", texto: "nenhuma" };
}
/** Produto Relacionado (mockup: "nenhum"). */
export function seloRelacionado(emConjunto: boolean): SeloSecao {
  return emConjunto ? { tone: "info", texto: "em conjunto" } : { tone: "muted", texto: "nenhum" };
}
