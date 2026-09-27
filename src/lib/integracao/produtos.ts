// Integração — aba Produtos (spec §6): leitura TOLERANTE do jsonb de `integracao_listar`, formatação do texto canônico do
// retrato (D4) em BR, qual fonte a linha mostra (N10: integrável/integrado = RETRATO; não integrável = VIVO) e os motivos
// que travam integrar/voltar. PURO (sem I/O). Os gates por campo vêm PRONTOS do servidor (_integracao_gates — D24): aqui só
// se lê, e o que não se consegue ler fica FECHADO (nunca libera edição por engano).
//
// Rulings do controlador para esta Task (ver task-10-report.md):
// - G1: titulo_pagina/preco_anterior NULL no `raw` = AUTOMÁTICO (não é falta; o retrato/vivo já carregam o valor
//   calculado). `valorCelula` não trata esses 2 campos como um caso especial — o texto exibido já é o automático,
//   porque o SERVIDOR grava o automático em `vivo`/`retrato` quando o raw é NULL (ver _integracao_retrato_core).
// - d2-M3: `gates` do servidor ganhou a chave booleana `modulo_bloqueado` ao lado dos gates-objeto — lida à parte,
//   nunca tratada como GateKey (não entra no Record<GateKey,Gate> nem em qualquer loop sobre essas chaves).
// - Faltas em `tamanho_tipo`/`variantes` (chaves sem CampoDef/coluna): textoFaltas as trata igual a qualquer falta —
//   não há "cela" pra destacar, então não têm tratamento especial aqui (a tela decide onde mostrar).
// - Estado: `rotuloEstado`/os motivos só usam `marcadoEm`/`integradoEm` quando `estado` é integravel/integrado — o
//   dado cru continua sendo lido (não escondido do tipo), só não vira exibição fora desses estados.
// - P-99 (reprovado): `integracao_listar` não manda um campo `reprovado` (só `integracao_previa` manda, fora do
//   escopo desta Task) — um integrável reprovado chega como um `ProdutoLista` comum; `lerLista` não quebra.
//
// Fix round 1 (task-10-review.md):
// - Important #3: `motivoIntegrar`/`acoesEmMassa` agora consomem `moduloBloqueado` — `integracao_marcar` (m3)
//   recusa 42501 quando o gate de base é de módulo desligado; sem essa checagem aqui, um produto assim entrava
//   em "integrar" e o `integracao_marcar` em massa (atômico) abortava o lote inteiro por causa de 1 produto.
// - Minor #1: `raw.tamanho_tipo` agora é `"letra" | "numero" | null` — NULL nunca vira "letra" em silêncio
//   (contradiz o próprio ruling T2 do m2: "'Tamanho em' NULL nunca é assumido como letra em silêncio" — a falta
//   "tamanho_tipo" já cobre a UI). Ajuste vazou pro `RawProduto`/`rascunho.ts` (`Rascunho.tamanhoTipo`).
// - Minor #6: `formatarValor`/`textoDaLinha` nunca imprimem "R$ NaN" — texto não-numérico vira "—".
import { brl } from "@/lib/format";
import { CAMPO_BY_KEY, ordenarCampos, type CampoKey, type GateKey } from "@/lib/integracao/campos";

export type Situacao = "nao_integrados" | "integrados" | "todos";
export type EstadoIntegracao = "nao_integravel" | "integravel" | "integrado";
export type Filtros = {
  colecao: string | null;
  etapa: string | null;
  origem: string | null;
  estado: EstadoIntegracao | null;
  busca: string;
};
export const FILTROS_VAZIOS: Filtros = {
  colecao: null,
  etapa: null,
  origem: null,
  estado: null,
  busca: "",
};
export type Gate = { ok: boolean; motivo: string | null };
export type Gates = Record<GateKey, Gate>;
export type Falta = { campo: string; texto: string };
export type LinhaRetrato = {
  tipo: "produto" | "variante";
  ordem: number;
  varianteKey: string | null;
  tamanhoKey: string | null;
  valores: Partial<Record<string, string | null>>;
  fotos: string[];
};
export type Retrato = { campos: CampoKey[]; linhas: LinhaRetrato[] };
export type Sublinha = {
  varianteKey: string;
  tamanhoKey: string;
  varianteOrdem: number | null;
  tamanhoOrdem: number | null;
  corNome: string | null;
  apelidoNome: string | null;
  tamanho: string | null;
  skuId: string | null;
  sku: string | null;
  skuRev: number | null;
  manual: boolean;
};
export type RawProduto = {
  nome: string;
  ref: string | null;
  preco_anterior: number | null;
  preco_venda: number | null;
  peso_kg: number | null;
  ncm: string | null;
  titulo_pagina: string | null;
  descricao_produto: string | null;
  comprimento_cm: number | null;
  largura_cm: number | null;
  altura_cm: number | null;
  fotos_modelo: string[];
  // Minor #1: NULL é um estado de verdade (card legado sem "Tamanho em" escolhido) — nunca assumido como "letra"
  // em silêncio (a falta "tamanho_tipo" já avisa a UI). Ver kanban-condicoes/sku-card.ts R10, mesmo princípio.
  tamanho_tipo: "letra" | "numero" | null;
};
export type ProdutoLista = {
  modeloId: string;
  origem: "interno" | "revenda" | "importado";
  colecao: string | null;
  etapa: string | null;
  estado: EstadoIntegracao;
  marcadoEm: string | null;
  integradoEm: string | null;
  rev: number;
  raw: RawProduto;
  vivo: Retrato | null;
  faltas: Falta[];
  completo: boolean;
  sublinhas: Sublinha[];
  retrato: Retrato | null;
  retratoDifere: CampoKey[];
  gates: Gates;
  moduloBloqueado: boolean;
};
export type ListaIntegracao = {
  pagina: number;
  porPagina: number;
  total: number;
  contagens: Record<Situacao, number>;
  campos: CampoKey[];
  opcoes: { colecoes: string[]; etapas: { key: string; label: string }[] };
  pode: { editar: boolean; verCustos: boolean; super: boolean; keywords: boolean };
  keywords: string | null;
  produtos: ProdutoLista[];
};

export const ROTULO_ORIGEM: Record<ProdutoLista["origem"], string> = {
  interno: "Interno",
  revenda: "Revenda",
  importado: "Importado",
};
export const ROTULO_ESTADO: Record<EstadoIntegracao, string> = {
  nao_integravel: "Não integrável",
  integravel: "Integrável",
  integrado: "Integrado",
};
export const TEXTO_PRECISA_CUSTO = "Precisa poder ver custos (Preço de custo está marcado)";

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const txt = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
};
const strs = (v: unknown): string[] => arr(v).filter((x): x is string => typeof x === "string");
const ESTADOS: readonly EstadoIntegracao[] = ["nao_integravel", "integravel", "integrado"];
const estadoDe = (v: unknown): EstadoIntegracao =>
  ESTADOS.includes(v as EstadoIntegracao) ? (v as EstadoIntegracao) : "nao_integravel";
const GATE_KEYS: readonly GateKey[] = [
  "compartilhado",
  "planejamento",
  "preco",
  "ref",
  "sku",
  "keywords",
];
const GATE_ILEGIVEL: Gate = {
  ok: false,
  motivo: "Não foi possível ler a permissão deste campo — recarregue a página.",
};
function gateDe(v: unknown): Gate {
  const o = obj(v);
  return typeof o.ok === "boolean" ? { ok: o.ok, motivo: txt(o.motivo) } : GATE_ILEGIVEL;
}
function retratoDe(v: unknown): Retrato | null {
  if (v === null || v === undefined || typeof v !== "object") return null;
  const o = obj(v);
  return {
    campos: ordenarCampos(strs(o.campos)),
    linhas: arr(o.linhas)
      .map(obj)
      .map(
        (l): LinhaRetrato => ({
          tipo: l.tipo === "variante" ? "variante" : "produto",
          ordem: num(l.ordem) ?? 0,
          varianteKey: txt(l.variante_key),
          tamanhoKey: txt(l.tamanho_key),
          valores: Object.fromEntries(
            Object.entries(obj(l.valores)).map(([k, x]) => [
              k,
              x === null || x === undefined ? null : String(x),
            ]),
          ),
          fotos: strs(l.fotos),
        }),
      ),
  };
}
function rawDe(v: unknown): RawProduto {
  const o = obj(v);
  return {
    nome: txt(o.nome) ?? "",
    ref: txt(o.ref),
    preco_anterior: num(o.preco_anterior),
    preco_venda: num(o.preco_venda),
    peso_kg: num(o.peso_kg),
    ncm: txt(o.ncm),
    titulo_pagina: txt(o.titulo_pagina),
    descricao_produto: txt(o.descricao_produto),
    comprimento_cm: num(o.comprimento_cm),
    largura_cm: num(o.largura_cm),
    altura_cm: num(o.altura_cm),
    fotos_modelo: strs(o.fotos_modelo),
    tamanho_tipo:
      o.tamanho_tipo === "numero" ? "numero" : o.tamanho_tipo === "letra" ? "letra" : null,
  };
}
function produtoDe(v: unknown): ProdutoLista {
  const o = obj(v);
  const origem = o.origem === "revenda" || o.origem === "importado" ? o.origem : "interno";
  const g = obj(o.gates);
  return {
    modeloId: txt(o.modelo_id) ?? "",
    origem,
    colecao: txt(o.colecao),
    etapa: txt(o.etapa),
    estado: estadoDe(o.estado),
    marcadoEm: txt(o.marcado_em),
    integradoEm: txt(o.integrado_em),
    rev: num(o.rev) ?? 0,
    raw: rawDe(o.raw),
    vivo: retratoDe(o.vivo),
    faltas: arr(o.faltas)
      .map(obj)
      .map((f) => ({ campo: txt(f.campo) ?? "", texto: txt(f.texto) ?? "" })),
    completo: o.completo === true,
    sublinhas: arr(o.sublinhas)
      .map(obj)
      .map(
        (s): Sublinha => ({
          varianteKey: txt(s.variante_key) ?? "",
          tamanhoKey: txt(s.tamanho_key) ?? "",
          varianteOrdem: num(s.variante_ordem),
          tamanhoOrdem: num(s.tamanho_ordem),
          corNome: txt(s.cor_nome),
          apelidoNome: txt(s.apelido_nome),
          tamanho: txt(s.tamanho),
          skuId: txt(s.sku_id),
          sku: txt(s.sku),
          skuRev: num(s.sku_rev),
          manual: s.manual === true,
        }),
      ),
    retrato: retratoDe(o.retrato),
    retratoDifere: ordenarCampos(strs(o.retrato_difere)),
    gates: Object.fromEntries(GATE_KEYS.map((k) => [k, gateDe(g[k])])) as Gates,
    // d2-M3: chave BOOLEANA à parte de `gates` (não é um GateKey) — true SÓ quando === true (fail-closed nos dois
    // sentidos: ausente/string/number nunca vira bloqueio nem destrava por engano).
    moduloBloqueado: g.modulo_bloqueado === true,
  };
}
export function lerLista(raw: unknown): ListaIntegracao {
  const o = obj(raw);
  const c = obj(o.contagens);
  const op = obj(o.opcoes);
  const pd = obj(o.pode);
  return {
    pagina: num(o.pagina) ?? 1,
    porPagina: num(o.por_pagina) ?? 50,
    total: num(o.total) ?? 0,
    contagens: {
      nao_integrados: num(c.nao_integrados) ?? 0,
      integrados: num(c.integrados) ?? 0,
      todos: num(c.todos) ?? 0,
    },
    campos: ordenarCampos(strs(o.campos)),
    opcoes: {
      colecoes: strs(op.colecoes),
      etapas: arr(op.etapas)
        .map(obj)
        .map((e) => ({ key: txt(e.key) ?? "", label: txt(e.label) ?? "" }))
        .filter((e) => e.key !== ""),
    },
    pode: {
      editar: pd.editar === true,
      verCustos: pd.ver_custos === true,
      super: pd.super === true,
      keywords: pd.keywords === true,
    },
    keywords: txt(o.keywords),
    produtos: arr(o.produtos)
      .map(produtoDe)
      .filter((p) => p.modeloId !== ""),
  };
}
export function filtrosParaRpc(f: Filtros): Record<string, string> {
  const r: Record<string, string> = {};
  if (f.colecao) r.colecao = f.colecao;
  if (f.etapa) r.etapa = f.etapa;
  if (f.origem) r.origem = f.origem;
  if (f.estado) r.estado = f.estado;
  const b = f.busca.trim();
  if (b) r.busca = b;
  return r;
}

const MOEDA: ReadonlySet<string> = new Set(["preco_anterior", "preco_venda", "preco_custo"]);
const MEDIDA: ReadonlySet<string> = new Set(["comprimento", "largura", "altura"]);
/** Texto canônico do retrato (D4: "179.90", "0.310", "68") → exibição BR.
 *  Minor #6: leitura TOLERANTE — um texto não-numérico nunca vira "R$ NaN"/"NaN kg"/"NaN cm" (fica "—", o mesmo
 *  fallback do valor ausente); só ocorreria com um retrato corrompido, mas essa função lê jsonb de fora. */
export function formatarValor(campo: CampoKey, v: string | null | undefined): string {
  if (v === null || v === undefined || v.trim() === "") return "—";
  const n = Number(v);
  if ((MOEDA.has(campo) || campo === "peso" || MEDIDA.has(campo)) && !Number.isFinite(n))
    return "—";
  if (MOEDA.has(campo)) return brl(n);
  if (campo === "peso")
    return `${n.toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} kg`;
  if (MEDIDA.has(campo)) return `${n.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} cm`;
  return v;
}
export const textoFotos = (n: number): string => (n <= 0 ? "—" : n === 1 ? "1 foto" : `${n} fotos`);
export const usaRetrato = (p: ProdutoLista): boolean =>
  p.estado !== "nao_integravel" && p.retrato !== null;
export const fonteExibida = (p: ProdutoLista): Retrato | null =>
  usaRetrato(p) ? p.retrato : p.vivo;
export const linhasVariante = (p: ProdutoLista): LinhaRetrato[] =>
  (fonteExibida(p)?.linhas ?? []).filter((l) => l.tipo === "variante");
function textoDaLinha(l: LinhaRetrato | undefined, campo: CampoKey, produto: boolean): string {
  if (!l) return "—";
  if (campo === "foto") return produto ? textoFotos(l.fotos.length) : "—";
  return formatarValor(campo, l.valores[campo] ?? null);
}
/** Texto da célula. `indice` null = linha do produto; n = n-ésima sublinha (variante × tamanho) da fonte exibida.
 *  G1: para "titulo"/"preco_anterior", quando o `raw` é NULL o SERVIDOR já grava o valor AUTOMÁTICO na linha do
 *  produto (vivo/retrato) — não há tratamento especial aqui, `textoDaLinha` já lê o texto que veio pronto. */
export function valorCelula(p: ProdutoLista, campo: CampoKey, indice: number | null): string {
  const f = fonteExibida(p);
  return indice === null
    ? textoDaLinha(
        f?.linhas.find((l) => l.tipo === "produto"),
        campo,
        true,
      )
    : textoDaLinha(linhasVariante(p)[indice], campo, false);
}
/** N10: o "i" âmbar quando o valor VIVO difere do retrato gravado (a API recebe o retrato). */
export function avisoRetrato(p: ProdutoLista, campo: CampoKey): string | null {
  if (!usaRetrato(p) || !p.retratoDifere.includes(campo)) return null;
  const hoje = textoDaLinha(
    p.vivo?.linhas.find((l) => l.tipo === "produto"),
    campo,
    true,
  );
  const ret = valorCelula(p, campo, null);
  if (campo === "preco_custo")
    return `O custo mudou depois do retrato (hoje ${hoje}) — a API recebe o valor do retrato (${ret}).`;
  return `"${CAMPO_BY_KEY.get(campo)?.rotulo ?? campo}" mudou depois do retrato (hoje ${hoje}) — a API recebe o valor do retrato (${ret}).`;
}

export function fmtDataHora(iso: string | null, tz: string, comAno = false): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const partes = new Intl.DateTimeFormat("pt-BR", {
    timeZone: tz,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const v = (t: Intl.DateTimeFormatPartTypes) => partes.find((x) => x.type === t)?.value ?? "";
  return `${v("day")}/${v("month")}${comAno ? `/${v("year")}` : ""} ${v("hour")}:${v("minute")}`;
}
/** Ruling (estado manda, nunca marcado_em/marcado_por): `integradoEm` só vira texto quando `estado==='integrado'` —
 *  os outros dois estados nunca mostram data (mesmo que `marcadoEm`/`integradoEm` tenham um rastro velho de um
 *  voltar/desfazer anterior; esses campos continuam presentes no tipo, só não alimentam a exibição aqui). */
export function rotuloEstado(p: Pick<ProdutoLista, "estado" | "integradoEm">, tz: string): string {
  return p.estado === "integrado"
    ? `Integrado em ${fmtDataHora(p.integradoEm, tz)}`
    : ROTULO_ESTADO[p.estado];
}
export const tomEstado = (e: EstadoIntegracao): "danger" | "warning" | "success" =>
  e === "integrado" ? "success" : e === "integravel" ? "warning" : "danger";
/** Ruling: `tamanho_tipo`/`variantes` (chaves sem CampoDef/coluna) entram aqui igual a qualquer outra falta — não
 *  há cela pra destacar, e essa função só monta o TEXTO agregado (a tela decide separadamente onde mostrar). */
export const textoFaltas = (faltas: Falta[]): string =>
  faltas.length ? `Faltam: ${faltas.map((f) => f.texto).join(" · ")}` : "";

const TEXTO_MODULO_BLOQUEADO = "O módulo desta origem está desligado na loja.";
export type CtxIntegrar = {
  podeEditar: boolean;
  precisaVerCustos: boolean;
  podeVerCustos: boolean;
  temRascunho: boolean;
};
/** null = pode integrar. A ordem espelha a do servidor (integracao_marcar) — o servidor confere de novo.
 *  Important #3 (fix round 1): `moduloBloqueado` (gate finding d2-M3/H3) entra logo depois do estado — o mesmo
 *  ponto em que `integracao_marcar` (m3) recusa 42501 quando o gate de base é de módulo desligado. Reusa o texto
 *  do PRÓPRIO servidor quando disponível (`gates.compartilhado.motivo` — é o `_base_motivo` de `_integracao_gates`,
 *  o mesmo para todos os gates de um produto bloqueado por módulo); só cai no texto local se, por algum motivo,
 *  o gate não trouxe motivo (gate ilegível, por exemplo). */
export function motivoIntegrar(p: ProdutoLista, c: CtxIntegrar): string | null {
  if (!c.podeEditar) return "Precisa da permissão de editar a Integração.";
  if (p.estado !== "nao_integravel")
    return p.estado === "integrado" ? "Já integrado." : "Já está integrável.";
  if (p.moduloBloqueado) return p.gates.compartilhado.motivo ?? TEXTO_MODULO_BLOQUEADO;
  if (c.temRascunho) return "Salve as alterações antes de integrar.";
  if (c.precisaVerCustos && !c.podeVerCustos) return TEXTO_PRECISA_CUSTO;
  if (!p.completo) return textoFaltas(p.faltas) || "Produto incompleto.";
  return null;
}
export function motivoVoltar(p: ProdutoLista, podeEditar: boolean): string | null {
  if (!podeEditar) return "Precisa da permissão de editar a Integração.";
  if (p.estado !== "integravel") return "Voltar só se aplica a produtos integráveis.";
  return null;
}
export type CtxMassa = Omit<CtxIntegrar, "temRascunho"> & { rascunhos: ReadonlySet<string> };
export type AcoesMassa = {
  integrar: string[];
  voltar: string[];
  motivoIntegrar: string | null;
  motivoVoltar: string | null;
};
export function acoesEmMassa(sel: ProdutoLista[], c: CtxMassa): AcoesMassa {
  const pendentes = sel.filter((p) => c.rascunhos.has(p.modeloId));
  const integrar = sel
    .filter((p) => motivoIntegrar(p, { ...c, temRascunho: false }) === null)
    .map((p) => p.modeloId);
  const voltar = sel.filter((p) => motivoVoltar(p, c.podeEditar) === null).map((p) => p.modeloId);
  let mi: string | null = null;
  if (sel.length === 0) mi = "Selecione produtos.";
  else if (!c.podeEditar) mi = "Precisa da permissão de editar a Integração.";
  else if (pendentes.length === 1)
    mi = `Salve as alterações antes de integrar — ${pendentes[0].raw.nome} tem edição pendente.`;
  else if (pendentes.length > 1)
    mi = `Salve as alterações antes de integrar — ${pendentes.length} produtos têm edição pendente.`;
  else if (c.precisaVerCustos && !c.podeVerCustos) mi = TEXTO_PRECISA_CUSTO;
  else if (integrar.length === 0)
    mi = "Nenhum selecionado pode ser integrado (incompleto, já integrável ou integrado).";
  const mv =
    sel.length === 0
      ? "Selecione produtos."
      : voltar.length === 0
        ? 'Nenhum selecionado está "Integrável" — Voltar só se aplica a produtos integráveis.'
        : null;
  return {
    integrar: mi ? [] : integrar,
    voltar: mv ? [] : voltar,
    motivoIntegrar: mi,
    motivoVoltar: mv,
  };
}
export const totalPaginas = (l: Pick<ListaIntegracao, "total" | "porPagina">): number =>
  Math.max(1, Math.ceil(l.total / l.porPagina));
export function faixaPagina(
  l: Pick<ListaIntegracao, "pagina" | "porPagina" | "total" | "produtos">,
): string {
  if (l.total === 0) return "Nenhum produto";
  const ini = (l.pagina - 1) * l.porPagina + 1;
  return `Mostrando ${ini}–${ini + l.produtos.length - 1} de ${l.total} produtos`;
}
