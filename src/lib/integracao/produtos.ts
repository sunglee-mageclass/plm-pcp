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
//
// Fix round 2 (task-10-review.md, "Re-review round 1"):
// - Minor R1-4: `acoesEmMassa` — quando NENHUM selecionado pode integrar por módulo bloqueado, a mensagem
//   genérica agora cita o motivo real (com 1 selecionado, usa o motivo dele; com vários, some "módulo desligado"
//   na lista de causas) — antes dizia só "(incompleto, já integrável ou integrado)", escondendo a causa real.
import { brl } from "@/lib/format";
import { corApelidoLabel } from "@/lib/variante";
import { CAMPO_BY_KEY, ordenarCampos, type CampoKey, type GateKey } from "@/lib/integracao/campos";

export type Situacao = "nao_integrados" | "integrados" | "todos";
export type EstadoIntegracao = "nao_integravel" | "integravel" | "integrado";
// Owner (set/2026): "os que não faltam itens, o badge não integrável deve ficar amarelo" — o Estado do SERVIDOR
// continua com só 3 valores (`EstadoIntegracao`, o que a RPC `integracao_listar`/`_estado` entende); o nível VISUAL
// (badge + filtro + ordenação) racha "não integrável" em DOIS, pelo `p.completo` já existente (mesma fonte que
// `motivoIntegrar` usa pra travar o botão Integrar — ver `acessorEstado`/`FiltroSelect` de Estado abaixo):
// - "nao_integravel_faltam" (VERMELHO): faltam dados — não daria pra marcar Integrável agora.
// - "nao_integravel_completo" (ÂMBAR): completo, só falta acionar o toggle Integrável.
// `EstadoNivel` é o tipo do FILTRO na tela (4 opções); `estadoNivelDe`/`nivelParaRpc` fazem a ponte com o `EstadoIntegracao`
// de 3 valores que o servidor entende — nenhuma mudança de RPC: os 2 níveis novos mandam `estado=nao_integravel`
// pro servidor (mesma contagem/paginação de hoje) e a tela filtra a PÁGINA já recebida pelo `completo` (client-side).
export type EstadoNivel = EstadoIntegracao | "nao_integravel_faltam" | "nao_integravel_completo";
export type Filtros = {
  colecao: string | null;
  etapa: string | null;
  origem: string | null;
  estado: EstadoNivel | null;
  busca: string;
  /** P-156 C (R7c) — "Versão de produto já integrado": filtro LOCAL (sobre a lista carregada, até 500) somado ao
   *  Estado. NUNCA vai para a RPC da lista (`filtrosParaRpc` o ignora de propósito). */
  versaoIntegrada: boolean;
};
export const FILTROS_VAZIOS: Filtros = {
  colecao: null,
  etapa: null,
  origem: null,
  estado: null,
  busca: "",
  versaoIntegrada: false,
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
  /** medios R14 sku #10: as SUBLINHAS (variante × tamanho — conjunto, SKU, cor, tamanho, nome) mudaram depois do retrato
   *  (chave `sublinhas` em `retrato_difere`; não é um CampoKey, por isso fica à parte). Ver `avisoSublinhas`. */
  retratoDifereSublinhas: boolean;
  gates: Gates;
  moduloBloqueado: boolean;
  reprovado: boolean;
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
// Owner (set/2026): rótulos do FILTRO "Estado" — os 2 novos níveis substituem a opção única "Não integrável".
// Labels escolhidos pra bater com a leitura do dono ("os vermelhos que faltam dados e os amarelos que estão
// completos mas falta acionar o toggle") — curtos, sem repetir "não integrável" 2x na mesma frase.
// P-133 A (dono 29/set): renomeados de novo — "Não integrável — faltam dados" → "Faltam dados" e
// "Não integrável — completo" → "Pronto para integrar" (cor/lógica de cada nível NÃO mudam).
export const ROTULO_ESTADO_NIVEL: Record<EstadoNivel, string> = {
  nao_integravel: ROTULO_ESTADO.nao_integravel, // legado — mantido só p/ compat de valor salvo/serializado antigo
  nao_integravel_faltam: "Faltam dados",
  nao_integravel_completo: "Pronto para integrar",
  integravel: ROTULO_ESTADO.integravel,
  integrado: ROTULO_ESTADO.integrado,
};
/** Opções do filtro "Estado" na ORDEM do funil (faltam dados < completo < integrável < integrado) — a opção
 *  legada `"nao_integravel"` NÃO aparece na lista (só existe pra um valor salvo antigo continuar funcionando via
 *  `filtrosParaRpc`/`produtoPassaFiltroEstado`; ninguém escolhe ela de novo no dropdown). */
export const OPCOES_ESTADO_NIVEL: readonly EstadoNivel[] = [
  "nao_integravel_faltam", "nao_integravel_completo", "integravel", "integrado",
];
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
    retratoDifereSublinhas: strs(o.retrato_difere).includes("sublinhas"),
    gates: Object.fromEntries(GATE_KEYS.map((k) => [k, gateDe(g[k])])) as Gates,
    // d2-M3: chave BOOLEANA à parte de `gates` (não é um GateKey) — true SÓ quando === true (fail-closed nos dois
    // sentidos: ausente/string/number nunca vira bloqueio nem destrava por engano).
    moduloBloqueado: g.modulo_bloqueado === true,
    // P-99 A (controlador, Task 12a): `integracao_listar` manda `reprovado` (boolean) por produto — lido TOLERANTE,
    // igual ao resto do arquivo: true SÓ quando === true (ausente/string/number nunca acende o badge por engano).
    reprovado: o.reprovado === true,
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
/** Ponte `EstadoNivel` (filtro da tela, 4 opções) → `EstadoIntegracao` (o que a RPC entende, 3 opções) — os 2
 *  níveis novos ("faltam"/"completo") mandam `nao_integravel` pro servidor (compatibilidade: um valor salvo/antigo
 *  `"nao_integravel"` já cai direto aqui, sem tradução, mostrando OS DOIS níveis — o comportamento de hoje). */
const nivelParaEstadoServidor = (v: EstadoNivel): EstadoIntegracao =>
  v === "nao_integravel_faltam" || v === "nao_integravel_completo" ? "nao_integravel" : v;
/** Filtro CLIENT-SIDE por completude, aplicado à página já recebida do servidor — só os 2 níveis novos restringem,
 *  e SÓ dentro de `estado==='nao_integravel'` (um produto integrável/integrado também pode ter `completo=true`,
 *  mas isso não o torna "nao_integravel_completo" — precisa das DUAS condições, não só `completo`). Os demais
 *  valores (incluindo o `"nao_integravel"` legado/salvo) não filtram nada aqui (mostram os dois níveis, mesma
 *  lista de hoje). MEDIUM-1 (review 685544fa): "completo" aqui usa `podeIntegrarAgora` (não só `p.completo`) —
 *  um produto com módulo desligado ou reprovado NÃO é "pronto pra integrar" mesmo completo, então cai no nível
 *  vermelho/"faltam dados" (o motivo aparece no InfoHover, nunca some). Amarelo aqui SEMPRE corresponde a "dá
 *  pra integrar agora, só falta acionar o toggle" — nunca um falso "quase lá" que o servidor recusaria. */
export function produtoPassaFiltroEstado(p: PodeIntegrarAgoraInput, v: EstadoNivel | null): boolean {
  if (v === "nao_integravel_faltam") return p.estado === "nao_integravel" && !podeIntegrarAgora(p);
  if (v === "nao_integravel_completo") return p.estado === "nao_integravel" && podeIntegrarAgora(p);
  return true;
}
export function filtrosParaRpc(f: Filtros): Record<string, string> {
  const r: Record<string, string> = {};
  if (f.colecao) r.colecao = f.colecao;
  if (f.etapa) r.etapa = f.etapa;
  if (f.origem) r.origem = f.origem;
  if (f.estado) r.estado = nivelParaEstadoServidor(f.estado);
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

/** medios R14 sku #10: rótulo do "i" quando as SUBLINHAS mudaram depois do retrato (a API recebe as do retrato). */
export const AVISO_SUBLINHAS =
  "As sublinhas (cor × tamanho: SKU, cor, tamanho, nome ou título) mudaram depois do retrato — a API recebe as sublinhas do retrato.";
/** R8 (B3): REF/SKU e Título da sublinha acendem o MESMO aviso — com as duas colunas na tabela, o "i" aparece uma vez por
 *  linha, na 1ª delas (ordem das colunas exibidas). Nenhuma das duas exibida ⇒ null. */
export function colunaAvisoSublinhas(chavesExibidas: readonly string[]): "ref_sku" | "titulo" | null {
  for (const k of chavesExibidas) if (k === "ref_sku" || k === "titulo") return k;
  return null;
}
export function avisoSublinhas(p: ProdutoLista): string | null {
  return usaRetrato(p) && p.retratoDifereSublinhas ? AVISO_SUBLINHAS : null;
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
const TEXTO_MODULO_BLOQUEADO = "O módulo desta origem está desligado na loja.";
export const TEXTO_REPROVADO = "O produto está reprovado e não pode ser integrado.";
export type PodeIntegrarAgoraInput = Pick<ProdutoLista, "estado" | "completo" | "moduloBloqueado" | "reprovado">;
// Owner (set/2026): "os que não faltam itens, o badge não integrável deve ficar amarelo" + fix round de review
// (MEDIUM-1, 685544fa): amarelo TEM que significar "o servidor aceitaria integrar isto agora", não só "completo".
// `podeIntegrarAgora` espelha a MESMA ordem de gates do servidor (`integracao_marcar`, migration
// `20261007120000_integracao_3_estados.sql`): estado≠nao_integravel primeiro (P0409, fora do escopo desta função
// — quem chama já sabe que é nao_integravel), módulo bloqueado (42501), reprovado (P0001), assinatura (P0409 —
// N/A aqui, a lista não tem assinatura de retrato pra comparar) e só por ÚLTIMO completo (P0001). NÃO inclui o
// gate de permissão de custo (`precisaVerCustos && !podeVerCustos`, em `motivoIntegrar`) de propósito — aquele é
// VIEWER-dependente (o mesmo produto completo/sem módulo/sem reprovação already é "pronto" objetivamente; só um
// usuário SEM a permissão de ver custos é que não pode ACIONAR o toggle agora — o produto continua amarelo, só o
// toggle trava com um motivo próprio, igual ao módulo/reprovado NÃO travam o badge por serem parte do produto,
// não de quem olha).
export function podeIntegrarAgora(p: PodeIntegrarAgoraInput): boolean {
  return p.completo && !p.moduloBloqueado && !p.reprovado;
}
/** Motivo do nível VERMELHO (faltam dados) quando não é por falta de campo — módulo desligado ou reprovado,
 *  na MESMA ordem de `podeIntegrarAgora`/servidor. `null` quando o vermelho É por falta de campo mesmo (o
 *  chamador usa `textoFaltas(p.faltas)` nesse caso — texto mais específico, com a lista). Reusa o texto do
 *  PRÓPRIO gate do servidor quando disponível (`gates.compartilhado.motivo`), igual `motivoIntegrar`. */
export function motivoNivelVermelho(p: Pick<ProdutoLista, "moduloBloqueado" | "reprovado" | "gates">): string | null {
  if (p.moduloBloqueado) return p.gates.compartilhado.motivo ?? TEXTO_MODULO_BLOQUEADO;
  if (p.reprovado) return TEXTO_REPROVADO;
  return null;
}
/** Ruling (estado manda, nunca marcado_em/marcado_por): `integradoEm` só vira texto quando `estado==='integrado'` —
 *  os outros dois estados nunca mostram data (mesmo que `marcadoEm`/`integradoEm` tenham um rastro velho de um
 *  voltar/desfazer anterior; esses campos continuam presentes no tipo, só não alimentam a exibição aqui).
 *  "Não integrável" agora tem 2 textos (faltam dados vs completo) — ver `nivelDoProduto`. */
export function rotuloEstado(p: Pick<ProdutoLista, "estado" | "integradoEm"> & PodeIntegrarAgoraInput, tz: string): string {
  if (p.estado === "integrado") return `Integrado em ${fmtDataHora(p.integradoEm, tz)}`;
  if (p.estado === "nao_integravel")
    return podeIntegrarAgora(p) ? "Pronto para integrar" : "Faltam dados";
  return ROTULO_ESTADO[p.estado];
}
/** Nível efetivo de um produto (o mesmo split do filtro/ordenação, aplicado ao PRÓPRIO produto) — usado pelo
 *  badge (`tomEstado`) e por qualquer outro consumidor que precise saber em qual dos 4 "baldes" ele cai. */
export function nivelDoProduto(p: PodeIntegrarAgoraInput): EstadoNivel {
  if (p.estado !== "nao_integravel") return p.estado;
  return podeIntegrarAgora(p) ? "nao_integravel_completo" : "nao_integravel_faltam";
}
export const tomEstado = (p: PodeIntegrarAgoraInput): "danger" | "warning" | "success" => {
  const n = nivelDoProduto(p);
  return n === "integrado" ? "success" : n === "integravel" || n === "nao_integravel_completo" ? "warning" : "danger";
};
/** Ruling: `tamanho_tipo`/`variantes` (chaves sem CampoDef/coluna) entram aqui igual a qualquer outra falta — não
 *  há cela pra destacar, e essa função só monta o TEXTO agregado (a tela decide separadamente onde mostrar). */
export const textoFaltas = (faltas: Falta[]): string =>
  faltas.length ? `Faltam: ${faltas.map((f) => f.texto).join(" · ")}` : "";

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
 *  o gate não trouxe motivo (gate ilegível, por exemplo).
 *  MEDIUM-1 (review 685544fa): `reprovado` entra logo depois de `moduloBloqueado`, MESMA posição do servidor
 *  (`integracao_marcar` checa módulo bloqueado, depois reprovado, antes de completo) — reusa `motivoNivelVermelho`
 *  pra não duplicar a checagem/ordem em 2 lugares. `precisaVerCustos`/`temRascunho` são checks SÓ do cliente (não
 *  existem gate equivalente no servidor pra esses 2 — a RPC nem recebe esse contexto), então ficam DEPOIS, como
 *  já estavam; a ordem exata entre eles não importa pro servidor, só precisam vir depois de módulo/reprovado e
 *  antes de completo (senão o botão liberaria achando "completo" um produto que na visão de QUEM CLICA ainda
 *  tem pendência de permissão/rascunho). */
export function motivoIntegrar(p: ProdutoLista, c: CtxIntegrar): string | null {
  if (!c.podeEditar) return "Precisa da permissão de editar a Integração.";
  if (p.estado !== "nao_integravel")
    return p.estado === "integrado" ? "Já integrado." : "Já está integrável.";
  const motivoVermelho = motivoNivelVermelho(p);
  if (motivoVermelho) return motivoVermelho;
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
  else if (integrar.length === 0) {
    // Minor R1-4 (fix round 2): quando TODOS os selecionados estão bloqueados por módulo, a mensagem genérica
    // omitia o motivo real. Se houver exatamente 1 selecionado, usa o motivo dele (o mesmo texto do servidor,
    // via motivoIntegrar/moduloBloqueado); com 2+ selecionados e módulo sendo a única razão em todos, entra no
    // texto genérico com "módulo desligado" na lista de causas.
    if (sel.length === 1) mi = motivoIntegrar(sel[0], { ...c, temRascunho: false });
    else if (sel.every((p) => p.moduloBloqueado))
      mi = "Nenhum selecionado pode ser integrado (módulo desligado na loja).";
    else
      mi =
        "Nenhum selecionado pode ser integrado (incompleto, já integrável, integrado ou módulo desligado).";
  }
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
// ── Ordenação da tabela (Task "ordenar por título") ─────────────────────────────────────────────────────────────────────
// Ordena pelo valor SALVO/servidor (nunca o rascunho ainda não gravado) — a mesma fonte que `valorCelula` já lê
// (retrato quando integrável/integrado, vivo senão; nunca `r.valores.*`), então a linha não "pula" enquanto a
// pessoa digita. Ruling do brief: sortar por esse valor, não pelo texto formatado em tela.
// Campo que só existe na sublinha (cor_base/cor_apelido/tamanho): ordena os PRODUTOS pelo valor da PRIMEIRA
// variante (`linhasVariante(p)[0]`) — documentado aqui e no comentário de `acessorOrdenacao`.
const MOEDA_OU_MEDIDA: ReadonlySet<CampoKey> = new Set([
  "preco_anterior", "preco_venda", "preco_custo", "peso", "comprimento", "largura", "altura",
]);
/** Valor CRU (não formatado) da linha do produto para um campo — número quando dá pra ordenar numericamente
 *  (dinheiro/peso/medida), texto senão. `null`/ausente vira `null` (o `useSort` já joga nulos pro fim). */
function valorOrdenavelDaLinha(l: LinhaRetrato | undefined, campo: CampoKey): string | number | null {
  if (!l) return null;
  if (campo === "foto") return l.fotos.length > 0 ? l.fotos.length : null;
  const v = l.valores[campo] ?? null;
  if (v === null || v.trim() === "") return null;
  if (MOEDA_OU_MEDIDA.has(campo)) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return v;
}
/** Valor ordenável de um campo, na linha do PRODUTO (fonte exibida = salva/servidor, igual `valorCelula`). Campos
 *  "somente na sublinha" (cor_base/cor_apelido/tamanho) não têm linha de produto no retrato/vivo — caem no `null`
 *  aqui; `acessorOrdenacao` os resolve pela PRIMEIRA variante em vez desta função. */
function valorOrdenavelDoProduto(p: ProdutoLista, campo: CampoKey): string | number | null {
  const f = fonteExibida(p);
  const l = f?.linhas.find((x) => x.tipo === "produto");
  return valorOrdenavelDaLinha(l, campo);
}
// Owner (set/2026): com o Estado agora em 4 níveis (faltam dados/completo/integrável/integrado), a ordem do funil
// segue a MESMA leitura do dono: faltam dados < completo < integrável < integrado (cada nível mais perto de
// integrado vem DEPOIS — asc mostra primeiro quem precisa de mais atenção).
const ORDEM_NIVEL_ESTADO: Record<EstadoNivel, number> = {
  nao_integravel: 0, // legado — nunca aparece de verdade (nivelDoProduto/acessorEstado sempre resolvem o real)
  nao_integravel_faltam: 0,
  nao_integravel_completo: 1,
  integravel: 2,
  integrado: 3,
};
/** Mapa `sortKey → accessor` para `useSort<ProdutoLista>` (`ProdutosTabela.tsx`). Uma entrada por `CampoKey` da
 *  tabela + `"estado"` (ordena pela ordem do funil de 4 níveis — `nivelDoProduto`/`ORDEM_NIVEL_ESTADO`). Campos
 *  soVariante (cor_base/cor_apelido/tamanho) leem a PRIMEIRA sublinha (`linhasVariante(p)[0]`) — documentado no
 *  requisito ("campo que só existe na variante ordena o produto pelo valor da 1ª variante"). Todos os outros leem
 *  a linha do PRODUTO da fonte exibida (retrato/vivo = valor SALVO, nunca o rascunho — ver comentário acima).
 *  `useSort` decide número-vs-texto sozinho a partir do valor devolvido (nunca confiar em texto formatado aqui). */
export function acessorOrdenacao(campo: CampoDefLike): (p: ProdutoLista) => string | number | null {
  if (campo.soVariante) {
    return (p: ProdutoLista) => valorOrdenavelDaLinha(linhasVariante(p)[0], campo.key);
  }
  return (p: ProdutoLista) => valorOrdenavelDoProduto(p, campo.key);
}
type CampoDefLike = { key: CampoKey; soVariante: boolean };
export const SORT_KEY_ESTADO = "estado" as const;
export const acessorEstado = (p: PodeIntegrarAgoraInput): number => ORDEM_NIVEL_ESTADO[nivelDoProduto(p)];

export const totalPaginas = (l: Pick<ListaIntegracao, "total" | "porPagina">): number =>
  Math.max(1, Math.ceil(l.total / l.porPagina));
export function faixaPagina(
  l: Pick<ListaIntegracao, "pagina" | "porPagina" | "total" | "produtos">,
): string {
  if (l.total === 0) return "Nenhum produto";
  const ini = (l.pagina - 1) * l.porPagina + 1;
  return `Mostrando ${ini}–${ini + l.produtos.length - 1} de ${l.total} produtos`;
}

// ─────────────────────────── P-156 C + R7 — "Versão de produto já integrado" (T5, só leitura) ───────────────────────────
// Dados da RPC `integracao_versoes_integradas(ids)` (DEFINER, `_integracao_exige(false)`): para cada card da lista, a
// versão MENOR mais alta da família que já está Integrável/Integrada e a comparação de variantes com o RETRATO que ela
// enviou (iguais / novas / saíram, pela variante_key = cor base + apelido). Só AVISO: não bloqueia marcar nem editar.
export type VarianteComparada = { varianteKey: string; corNome: string | null; apelidoNome: string | null };
export type VersaoIntegradaInfo = {
  modeloId: string;
  anteriorId: string;
  anteriorVersao: number;
  anteriorEstado: "integravel" | "integrado";
  anteriorMarcadoEm: string | null;
  anteriorIntegradoEm: string | null;
  iguais: VarianteComparada[];
  novas: VarianteComparada[];
  sairam: VarianteComparada[];
};
const lerVariantes = (v: unknown): VarianteComparada[] =>
  (Array.isArray(v) ? v : [])
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    .map((x) => ({
      varianteKey: String(x.variante_key ?? ""),
      corNome: typeof x.cor_nome === "string" ? x.cor_nome : null,
      apelidoNome: typeof x.apelido_nome === "string" ? x.apelido_nome : null,
    }))
    .filter((x) => x.varianteKey !== "");
/** Leitura TOLERANTE do jsonb da RPC → mapa modeloId → info (linha ilegível fica de fora — nunca inventa um aviso). */
export function lerVersoesIntegradas(raw: unknown): Map<string, VersaoIntegradaInfo> {
  const m = new Map<string, VersaoIntegradaInfo>();
  for (const x of Array.isArray(raw) ? raw : []) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    const estado = o.anterior_estado === "integrado" ? "integrado" : o.anterior_estado === "integravel" ? "integravel" : null;
    const versao = Number(o.anterior_versao);
    if (typeof o.modelo_id !== "string" || typeof o.anterior_id !== "string" || !estado || !Number.isFinite(versao)) continue;
    m.set(o.modelo_id, {
      modeloId: o.modelo_id,
      anteriorId: o.anterior_id,
      anteriorVersao: versao,
      anteriorEstado: estado,
      anteriorMarcadoEm: typeof o.anterior_marcado_em === "string" ? o.anterior_marcado_em : null,
      anteriorIntegradoEm: typeof o.anterior_integrado_em === "string" ? o.anterior_integrado_em : null,
      iguais: lerVariantes(o.iguais),
      novas: lerVariantes(o.novas),
      sairam: lerVariantes(o.sairam),
    });
  }
  return m;
}
/** Filtro LOCAL "Versão de produto já integrado" (R7c): com `on`, passa só o produto da lista CARREGADA que tem uma versão
 *  menor já Integrável/Integrada; desligado, passa tudo. Soma com o Estado (`produtoPassaFiltroEstado` — quem chama
 *  aplica os dois; é o predicado que a aba Produtos usa de fato). */
export function produtoPassaFiltroVersao(
  p: { modeloId: string }, mapa: ReadonlyMap<string, VersaoIntegradaInfo>, on: boolean,
): boolean {
  return !on || mapa.has(p.modeloId);
}
/** Selo da linha: "vN já integrada" (Integrado) ou "vN já integrável" (Integrável). */
export const seloVersaoIntegrada = (i: Pick<VersaoIntegradaInfo, "anteriorVersao" | "anteriorEstado">): string =>
  `v${i.anteriorVersao} já ${i.anteriorEstado === "integrado" ? "integrada" : "integrável"}`;
/** Rótulo de uma variante comparada — o MESMO rótulo de variante do sistema (`corApelidoLabel`); sem nome = "cor sem nome". */
export function rotuloVarianteComparada(v: VarianteComparada): string {
  const t = corApelidoLabel(v.corNome, v.apelidoNome);
  return t && t !== "—" ? t : "cor sem nome";
}
export type ResumoVariantes = { titulo: string; grupos: { rotulo: string; itens: string[] }[] };
/** Texto do hover: "Comparado com o que a vN enviou à loja virtual:" + Iguais (n) · Novas nesta versão (n) · Saíram (n). */
export function resumoVariantes(i: VersaoIntegradaInfo): ResumoVariantes {
  const lista = (vs: VarianteComparada[]) => vs.map(rotuloVarianteComparada);
  return {
    titulo: `Comparado com o que a v${i.anteriorVersao} enviou à loja virtual:`,
    grupos: [
      { rotulo: `Iguais (${i.iguais.length})`, itens: lista(i.iguais) },
      { rotulo: `Novas nesta versão (${i.novas.length})`, itens: lista(i.novas) },
      { rotulo: `Saíram (${i.sairam.length})`, itens: lista(i.sairam) },
    ],
  };
}
/** InfoHover do filtro "Versão" (R7c): deixa claro que é LOCAL e soma com o Estado. */
export const textoFiltroVersao = (mostraPaginacao: boolean): string =>
  mostraPaginacao
    ? "Vale só para os produtos desta página (até 500); soma com o filtro de Estado."
    : "Vale para os produtos carregados nesta lista (até 500); soma com o filtro de Estado.";
