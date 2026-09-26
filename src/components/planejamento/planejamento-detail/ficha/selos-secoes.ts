// F3.3 — numeração "N." e selos de completude de TODAS as seções do Sheet unificado (mockup gen_main.py:31-106 e
// gen_rest.py:9-26; adiados da F3.1 — plano F3.1 §7 T2). MAPA PRÓPRIO seção→condições (decisão travada 8: o catálogo
// `kanban-condicoes.ts` e o `CondicaoSecao` seguem as chaves do acordeão do Dev e NÃO mudam). As 4 seções do BOM seguem
// com `selos-bom.ts` (F3.2). Regras do Dev: `reqBadge` (ModeloDetailPanel.tsx:1644-1677) e os selos informativos
// (:2793-2795 Informações, :2837-2838 Prova, :2886-2890 CAD, :3068-3072 Anexos). Puro — planejamento-selos-secoes.test.ts.
import { brl, fmtNum, mesLimpo } from "@/lib/format";
import { seloDeSecao, seloPorChaves, type SeloSecao } from "./selos-bom";

export type SecaoSheetKey =
  | "info" | "colecao" | "desenvolvimento" | "codigos" | "prova"
  | "tecidos" | "aviamentos" | "insumos" | "grade" | "cad"
  | "tecidos_novo" | "mao_obra_novo" | "preco" | "produto_acabado" | "grade_revenda"
  | "anexos" | "observacoes" | "lancamento" | "relacionado";

/** Ordem do mockup aprovado (gen_main.py:106) + F3.6 (spec 2026-09-25 §5.1): "Códigos" logo depois de "Desenvolvimento"
 *  + "Tecidos" do Dialog e as 2 seções da revenda onde o JSX as põe.
 *  F3.6: a "Mão de obra" saiu da ordem (entrou na tabela de "Preço e Custos"); "mao_obra_novo" = a MO do Dialog
 *  "Novo Modelo" (sem número — R1/R18). */
export const ORDEM_SECOES_SHEET: readonly SecaoSheetKey[] = [
  "info", "colecao", "desenvolvimento", "codigos", "prova", "tecidos", "aviamentos", "insumos", "grade", "cad",
  "tecidos_novo", "mao_obra_novo", "preco", "produto_acabado", "grade_revenda", "anexos", "observacoes", "lancamento", "relacionado",
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
  // F3.6 (spec 2026-09-25 §5.3) — a MO mora dentro de "Preço e Custos": as condições dela viram requisito DESTA seção.
  preco: ["preco_venda_preenchido", "servico_aprovado", "servico_mo_decidido", "servico_mo_preenchido"],
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
  /** Nome, estilista E categoria vazios (brief 25/set — "vazia" ≠ "incompleta"; praticamente nunca ocorre). */
  infoVazia: boolean;
  colecaoResumo: string;
  desenvolvimentoCompleto: boolean;
  /** Nenhum de modelista, piloteiros 1–3, datas de piloto 1–3, desenho técnico, aprovação, obs. técnicas
   *  preenchido (brief 25/set). */
  desenvolvimentoVazia: boolean;
  /** null = revenda (a tabela de preço é outra) → sem selo. */
  preco: { efetivo: number; markup: number } | null;
  /** F3.6 (R15) — MO pendente/reprovada p/ o selo de "Preço e Custos" (a MO mora na tabela); null = nada a avisar ou o
   *  bloco de MO não é visível p/ este usuário. Vale p/ interno E comprado (independe das condições da ficha). */
  maoObraAviso: "pendente" | "reprovada" | null;
  /** 4 anexos totais (decisão do dono 25/set — a Ficha de Medida NÃO conta): foto do modelo, foto de
   *  referência, desenho técnico, croqui. */
  anexos: { fotoModelo: boolean; fotoReferencia: boolean; desenho: boolean; croqui: boolean };
  lancamento: { lancado: boolean; data: string | null };
};

/** Ordem/rótulos dos 4 anexos (decisão do dono 25/set: são 4 totais — Ficha de Medida NÃO conta). */
const ANEXOS_ROTULOS: readonly { key: keyof EntradaSelosSheet["anexos"]; label: string }[] = [
  { key: "fotoModelo", label: "foto do modelo" },
  { key: "fotoReferencia", label: "foto de referência" },
  { key: "desenho", label: "desenho técnico" },
  { key: "croqui", label: "croqui" },
];

/** Selo informativo da seção Anexos: 4 presentes ⇒ "anexos ok"; 0 ⇒ "vazio"; senão "N de 4 anexos" com
 *  tooltip "Tem: … · Faltam: …" (decisão do dono 25/set — substitui o texto do PRIMEIRO anexo presente). */
function seloAnexos(a: EntradaSelosSheet["anexos"]): SeloSecao {
  const tem = ANEXOS_ROTULOS.filter((r) => a[r.key]);
  const faltam = ANEXOS_ROTULOS.filter((r) => !a[r.key]);
  if (tem.length === ANEXOS_ROTULOS.length) return { tone: "ok", texto: "anexos ok" };
  if (tem.length === 0) return { tone: "muted", texto: "vazio" };
  return {
    tone: "muted",
    texto: `${tem.length} de ${ANEXOS_ROTULOS.length} anexos`,
    title: `Tem: ${tem.map((r) => r.label).join(", ")} · Faltam: ${faltam.map((r) => r.label).join(", ")}`,
  };
}

/** Selos das seções do Planejamento + as simples do Dev. BOM/CAD/Prova/Observações/Relacionado: funções próprias.
 *  Decisão do dono (25/set): seção sem NADA preenchido não mostra selo — exceto o aviso âmbar "falta …" de um
 *  requisito do kanban daquela seção (`seloDeSecao`, único lugar que decide isso). */
export function selosSecoesSheet(e: EntradaSelosSheet): Partial<Record<SecaoSheetKey, SeloSecao>> {
  const r = (k: SecaoSheetKey) => seloRequisito(k, e.requeridas, e.satisfeitas);
  const out: Partial<Record<SecaoSheetKey, SeloSecao>> = {};
  out.info = seloDeSecao(e.infoVazia, r("info"), e.infoCompleta ? { tone: "ok", texto: "completa" } : { tone: "muted", texto: "faltam dados" });
  out.colecao = seloDeSecao(!e.colecaoResumo, r("colecao"), { tone: "muted", texto: e.colecaoResumo });
  out.desenvolvimento = seloDeSecao(
    e.desenvolvimentoVazia, r("desenvolvimento"),
    e.desenvolvimentoCompleto ? { tone: "ok", texto: "completa" } : { tone: "muted", texto: "faltam dados" },
  );
  // Invariante #12: valor em R$ só p/ quem vê custos (o selo aparece com a seção FECHADA). Vazia = sem preço de
  // venda digitado E sem custo (o `efetivo` já cai pro sugerido — custo×markup — quando não há preço digitado;
  // `efetivo<=0` só acontece quando NENHUM dos dois existe). O informativo hoje só aparece com `efetivo>0` —
  // mantido (brief).
  const precoInformativo = e.podeVerCustos && e.preco && e.preco.efetivo > 0
    ? { tone: "muted" as const, texto: `Preço de venda ${brl(e.preco.efetivo)}${e.preco.markup > 0 ? ` · markup ${fmtNum(e.preco.markup)}×` : ""}` }
    : undefined;
  // F3.6 (R15, revisto no G-plano — item 13; RODADA DE CORREÇÃO 1, I1): a MO mora na tabela de Preço; com a seção
  // FECHADA o cabeçalho ainda avisa MO pendente/reprovada p/ TODO card (interno e comprado). Ordem CORRIGIDA: o
  // requisito do kanban NÃO cumprido (tone "warn") sempre vence; só quando ele NÃO está em "warn" (ok/vazio/sem
  // requisito) é que o aviso de MO pode aparecer — um requisito CUMPRIDO não pode mais esconder o aviso de MO.
  const moAviso: SeloSecao | undefined = e.maoObraAviso
    ? { tone: "warn", texto: e.maoObraAviso === "reprovada" ? "MO reprovada" : "MO pendente" }
    : undefined;
  out.preco = moAviso && r("preco")?.tone !== "warn" ? moAviso : seloDeSecao(!e.preco || e.preco.efetivo <= 0, r("preco"), precoInformativo);
  out.anexos = seloDeSecao(
    e.anexos.fotoModelo === false && e.anexos.fotoReferencia === false && e.anexos.desenho === false && e.anexos.croqui === false,
    r("anexos"), seloAnexos(e.anexos),
  );
  const lancamentoInformativo: SeloSecao = e.lancamento.lancado ? { tone: "ok", texto: "lançado" }
    : e.lancamento.data ? { tone: "muted", texto: dataBR(e.lancamento.data) }
      : { tone: "muted", texto: "sem data" };
  out.lancamento = seloDeSecao(!e.lancamento.lancado && !e.lancamento.data, r("lancamento"), lancamentoInformativo);
  return out;
}

/** Selo da seção CAD (Dev :2886-2890 + requisito `cad_preenchido`). Vazia = sem linha (`linhas===0`) — decisão do
 *  dono 25/set: sem selo, exceto o aviso âmbar do requisito do kanban (`seloDeSecao`). */
export function seloCadSecao(i: {
  requeridas: ReadonlySet<string>; satisfeitas: Record<string, boolean> | null;
  linhas: number; faltas: string[]; antesDaOrdem: boolean;
}): SeloSecao | undefined {
  const req = seloRequisito("cad", i.requeridas, i.satisfeitas);
  const informativo = (): SeloSecao => {
    if (i.antesDaOrdem) return { tone: "muted", texto: "após a Ordem de Criação" };
    if (i.faltas.length > 0) return { tone: "warn", texto: `falta ${i.faltas.join(", ")}`, title: `Falta: ${i.faltas.join(", ")}` };
    return { tone: "ok", texto: "ok" };
  };
  return seloDeSecao(i.linhas === 0, req, i.linhas === 0 ? undefined : informativo());
}

/** Prova (Dev :2836-2838). Vazia = 0 comentários abertos — decisão do dono 25/set: sem selo (sem requisito de
 *  kanban nesta seção, então nunca há âmbar a preservar). */
export function seloProva(abertos: number): SeloSecao | undefined {
  return abertos > 0 ? { tone: "info", texto: `${abertos} aberto${abertos > 1 ? "s" : ""}` } : undefined;
}
/** Observações (mockup: "1 observação"). A Composição automática não é linha da tabela. Vazia = 0 observações —
 *  decisão do dono 25/set: sem selo. */
export function seloObservacoes(n: number): SeloSecao | undefined {
  return n > 0 ? { tone: "muted", texto: `${n} ${n > 1 ? "observações" : "observação"}` } : undefined;
}
/** Produto Relacionado (mockup: "nenhum"). Vazia = sem conjunto — decisão do dono 25/set: sem selo. */
export function seloRelacionado(emConjunto: boolean): SeloSecao | undefined {
  return emConjunto ? { tone: "info", texto: "em conjunto" } : undefined;
}
