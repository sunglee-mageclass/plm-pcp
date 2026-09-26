/**
 * KANBAN AUTOMÁTICO — F2, Config da Loja. PURO (zero React/Supabase).
 *
 * RP3 (guardião, G-plano F1): a Config fazia `upsert` da linha INTEIRA de `tenant_config`. Com a chave
 * ligada, uma aba aberta antes de outro admin mudar requisitos/ordem regravaria os valores velhos e o
 * gatilho da F1 recalcularia a loja SEM prévia. Por isso as 5 colunas de kanban saem do upsert genérico
 * e vão SÓ as que o usuário mudou (diff canônico), depois de conferir que o banco ainda tem o que a tela
 * carregou (`conflitoKanban`). Aqui também o agrupamento das prévias (ligar / salvar / restaurar).
 */
import type { PreviaCard, PreviaFixado } from "./kanban-auto-ui";

export const KANBAN_COLS = [
  "status_kanban",
  "kanban_requisitos",
  "kanban_requisitos_excecoes",
  "revenda_kanban_colunas",
  "revenda_kanban_requisitos",
] as const;
export type KanbanCol = (typeof KANBAN_COLS)[number];
export type KanbanColsValor = Partial<Record<KanbanCol, unknown>>;

export function pickKanban(src: unknown): Record<KanbanCol, unknown> {
  const o = (src && typeof src === "object" && !Array.isArray(src) ? src : {}) as Record<string, unknown>;
  const out = {} as Record<KanbanCol, unknown>;
  for (const c of KANBAN_COLS) out[c] = o[c] ?? null;
  return out;
}

/** JSON com chaves de objeto ordenadas (o jsonb do Postgres reordena as chaves); arrays mantêm a ordem. */
export function jsonCanonico(v: unknown): string {
  if (v === undefined || v === null) return "null";
  if (typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(jsonCanonico).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${jsonCanonico(o[k])}`)
    .join(",")}}`;
}

export function diffKanban(base: KanbanColsValor, atual: KanbanColsValor): KanbanColsValor {
  const out: KanbanColsValor = {};
  for (const c of KANBAN_COLS) {
    if (jsonCanonico(base[c]) !== jsonCanonico(atual[c])) out[c] = atual[c] ?? null;
  }
  return out;
}

export function conflitoKanban(baseServidor: KanbanColsValor, servidorAgora: unknown): KanbanCol[] {
  const agora = pickKanban(servidorAgora);
  return KANBAN_COLS.filter((c) => jsonCanonico(baseServidor[c]) !== jsonCanonico(agora[c]));
}

/**
 * Baixo 4 (revisão final Opus): `pickKanban` devolve o valor CRU (NULL vira `null`) — correto para
 * comparar duas leituras cruas entre si, mas a tela normaliza `null` com `DEFAULTS` antes de mostrar
 * a config (`status_kanban` NULL vira as colunas-padrão, `kanban_requisitos` NULL vira `{}`, etc.).
 * Guardar `kanbanBase.servidor` já NORMALIZADO e comparar contra uma releitura CRUA (`conflitoKanban`)
 * faz uma loja com `status_kanban` NULL nunca bater (`DEFAULTS.status_kanban !== null` para sempre) —
 * falso conflito eterno. Os dois lados da comparação têm que estar no MESMO espaço: esta função aplica
 * o mesmo fallback por coluna que a tela já usa ao construir `next` a partir da leitura crua.
 */
export function normalizarKanbanDefaults(valor: KanbanColsValor, defaults: Record<KanbanCol, unknown>): KanbanColsValor {
  const out: KanbanColsValor = {};
  for (const c of KANBAN_COLS) {
    const v = valor[c];
    if (c === "status_kanban" || c === "revenda_kanban_colunas") {
      out[c] = Array.isArray(v) ? v : defaults[c];
    } else {
      out[c] = v && typeof v === "object" && !Array.isArray(v) ? v : defaults[c];
    }
  }
  return out;
}

export function separarPayloadKanban(payload: Record<string, unknown>): { geral: Record<string, unknown>; kanban: KanbanColsValor } {
  const geral: Record<string, unknown> = {};
  const kanban: KanbanColsValor = {};
  for (const [k, v] of Object.entries(payload)) {
    if ((KANBAN_COLS as readonly string[]).includes(k)) (kanban as Record<string, unknown>)[k] = v;
    else geral[k] = v;
  }
  return { geral, kanban };
}

/**
 * Fix round 1 (revisão Opus): o `upsert(geral)` do RP3 pode ter sucesso e o `update(diff)` do
 * kanban falhar LOGO DEPOIS (rede caiu no meio, RLS, etc.) — falha PARCIAL. O `upsert` sozinho já
 * dispara o eco do Realtime global (`useRealtimeInvalidation`) e refaz a leitura de
 * `tenant_config`, que normalmente sobrescreveria as 5 colunas de kanban na tela com o valor do
 * SERVIDOR (sem o diff que falhou) — apagando em silêncio a edição do usuário que ele ainda não
 * conseguiu salvar.
 *
 * Fix round 2 (revisão Opus): a flag do round 1 só ligava no `onError` — mas o eco do PRÓPRIO
 * `upsert(geral)` chega antes (WAL + debounce 250ms + 2 SELECTs, ~0,4-0,8s) do `update(diff)`
 * FALHAR (mais lento ainda com a chave ligada: `trg_kanban_config` recalcula a loja inteira na
 * mesma txn). Corrida real: o eco vencia e apagava a edição ANTES da flag ligar. Por isso
 * `protegido` cobre a janela INTEIRA (liga no INÍCIO do `mutationFn`, não só no erro) — ver
 * `kanbanProtegidoRef` no componente.
 *
 * Esta função decide, nesse eco, DUAS coisas:
 * 1) o que a tela deve mostrar (`cfgKanban`) — protegido: mantém o LOCAL (o que já estava na
 *    tela); não-protegido: adota o do SERVIDOR (comportamento de sempre).
 * 2) o que `kanbanBase` deve virar — protegido: **intocado** (fica exatamente como estava).
 *    Round 1 tinha uma REGRESSÃO aqui: sempre fazia `kanbanBase = {cfg: servidor, servidor:
 *    servidor}`, mesmo protegido. Se OUTRA aba mudou o kanban nesse meio-tempo, isso adotava o
 *    valor da outra aba como se fosse a base "confere-se antes de salvar" — um retry então
 *    comparava `kanbanBase.servidor` (já igual ao valor da outra aba) contra o banco (a mesma
 *    coisa) e não achava conflito, regravando por cima da mudança alheia (lost update). Mantendo
 *    `kanbanBase` intocado enquanto protegido: (a) se foi o PRÓPRIO upsert que ecoou, o servidor
 *    nunca mudou o kanban (só o `update(diff)` falhou) — `kanbanBase.servidor` já bate com o
 *    banco, retry sem conflito falso; (b) se foi OUTRA aba, `kanbanBase.servidor` continua
 *    apontando pro valor de ANTES dela mudar — retry compara contra o banco AGORA e acusa o
 *    conflito real. Sem `protegido`: comportamento de sempre, `kanbanBase` também adota o
 *    servidor (novo baseline após o save/refetch).
 */
export function resolverEcoKanban(
  protegido: boolean,
  local: KanbanColsValor,
  servidorNovo: KanbanColsValor,
  baseAtual: { cfg: KanbanColsValor; servidor: KanbanColsValor },
): { cfgKanban: KanbanColsValor; kanbanBase: { cfg: KanbanColsValor; servidor: KanbanColsValor } } {
  if (protegido) {
    return { cfgKanban: local, kanbanBase: baseAtual };
  }
  return { cfgKanban: mesclarKanbanPorColuna(local, servidorNovo, baseAtual.cfg), kanbanBase: rebasearKanban(local, servidorNovo, baseAtual.cfg) };
}

/**
 * Fix hidratação rodada 1 (achado I2 da revisão): fora da janela protegida, `resolverEcoKanban`
 * devolvia o servidor por INTEIRO (as 5 colunas), mesmo quando o usuário tinha uma edição LOCAL
 * ainda não salva numa delas — ex.: editar "Status do Kanban" e depois salvar o diálogo
 * "Editar nomenclaturas por módulo" (que também re-hidrata `data.cfg`) apagava a edição do
 * kanban em silêncio. Mesmo princípio do `mergeDraft`: uma coluna onde `local` diverge da BASE
 * (`kanbanBase.cfg`, o último servidor aplicado) está "tocada" e sobrevive; uma coluna igual à
 * base adota o servidor novo (não é edição minha, é uma mudança alheia/legítima chegando).
 */
/**
 * Fix hidratação rodada 2 (achado N3 da re-revisão): uma coluna onde `local` diverge da base MAS
 * CONVERGIU para o mesmo valor que o servidor (`local ≡ servidorNovo`) não é mais tratada como
 * "tocada" — mesmo princípio do `mergeDraft` quando `draft ≡ fresh`. Casos reais: o `update(diff)`
 * gravou no servidor mas a resposta se perdeu (falha parcial, ver `resolverEcoKanban`) e um retry
 * comparava contra a base ANTIGA achando conflito falso; ou outro admin fez a MESMA edição. Sem
 * isso, `conflitoKanban` acusava a coluna em TODO save seguinte até a página recarregar.
 */
function colunaTocada(local: KanbanColsValor, servidorNovo: KanbanColsValor, base: KanbanColsValor, c: KanbanCol): boolean {
  if (jsonCanonico(local[c] ?? null) === jsonCanonico(servidorNovo[c] ?? null)) return false;
  return jsonCanonico(local[c] ?? null) !== jsonCanonico(base[c] ?? null);
}

export function mesclarKanbanPorColuna(local: KanbanColsValor, servidorNovo: KanbanColsValor, base: KanbanColsValor): KanbanColsValor {
  const out: KanbanColsValor = {};
  for (const c of KANBAN_COLS) {
    out[c] = colunaTocada(local, servidorNovo, base, c) ? local[c] : servidorNovo[c];
  }
  return out;
}

/**
 * `kanbanBase` acompanha o merge por coluna: uma coluna tocada mantém a base ANTIGA (o
 * `conflitoKanban` do save precisa continuar comparando contra o valor de antes, para acusar se
 * outro admin mudou justamente essa coluna nesse meio-tempo); uma coluna não tocada re-baseia no
 * servidor novo (senão um diff futuro compararia contra um valor desatualizado).
 */
export function rebasearKanban(local: KanbanColsValor, servidorNovo: KanbanColsValor, base: KanbanColsValor): { cfg: KanbanColsValor; servidor: KanbanColsValor } {
  const cfg: KanbanColsValor = {};
  const servidor: KanbanColsValor = {};
  for (const c of KANBAN_COLS) {
    // N3: convergida (local ≡ servidorNovo) não conta como tocada — re-baseia normalmente,
    // mesmo quando isso difere de `base` (ver `colunaTocada`).
    const tocada = colunaTocada(local, servidorNovo, base, c);
    // Tocada: NÃO re-baseia (fica com o valor de ANTES da minha edição) — o próximo
    // `diffKanban(kanbanBase.cfg, cfg)` precisa continuar vendo `base[c] !== local[c]` para
    // gravar a mudança; se `cfg[c]` virasse `local[c]` aqui, o diff daria vazio e o Salvar
    // achando que essa coluna não mudou.
    cfg[c] = tocada ? base[c] : servidorNovo[c];
    servidor[c] = tocada ? base[c] : servidorNovo[c];
  }
  return { cfg, servidor };
}

const DESCRICAO_COL: Record<KanbanCol, string> = {
  status_kanban: "as colunas do kanban (nomes ou ordem)",
  kanban_requisitos: "os requisitos",
  kanban_requisitos_excecoes: "as exceções da cascata",
  revenda_kanban_colunas: "as colunas da revenda",
  revenda_kanban_requisitos: "os requisitos da revenda",
};

export function juntarLista(itens: string[]): string {
  if (itens.length <= 1) return itens[0] ?? "";
  return `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;
}

export function descreverMudancasKanban(cols: readonly KanbanCol[]): string {
  return juntarLista(cols.map((c) => DESCRICAO_COL[c]));
}

export function mensagemConflitoKanban(cols: readonly KanbanCol[]): string {
  return `Outra pessoa mudou ${descreverMudancasKanban(cols)} depois que você abriu esta tela. Recarregue a página e refaça a sua alteração antes de salvar.`;
}

/**
 * Minor 1 (fix round 1, revisão Opus — garantia D19): `prepararSalvar` lê `kanban_automatico` do
 * servidor pra decidir se mostra a prévia "Salvar e mover N cards". O `mutationFn` só confere as 5
 * colunas de kanban (`conflitoKanban`) — NÃO a chave. Se outra aba ligar a chave enquanto o
 * AlertDialog de confirmação está aberto (prévia deu 0 mudanças com a chave desligada), o Salvar
 * gravaria o diff sem prévia, e a F1 recalcularia a loja escondida do usuário. Comparação PURA:
 * `esperada` = o que `prepararSalvar` leu antes de decidir qual caminho seguir; `atual` = o que o
 * `mutationFn` relê no mesmo `lerConfigServidor` que já faz para o conflito das 5 colunas.
 */
export function chaveKanbanMudou(esperada: boolean, atual: unknown): boolean {
  return esperada !== (atual === true);
}

export const MENSAGEM_CHAVE_KANBAN_MUDOU = "A chave Kanban automático mudou em outra aba; recarregue antes de salvar.";

/**
 * Médio 1 (revisão final Opus — garantia D19): `prepararSalvar` calcula o diff e pede a prévia
 * (`kanban_previa_recalculo`) ANTES de mostrar o `KanbanSalvarDialog`/AlertDialog — mas a tela segue
 * EDITÁVEL enquanto o `await` da prévia está em voo, e o `mutationFn` recalcula o diff de NOVO na
 * hora de salvar (contra o `kanbanBase.cfg`/`cfg` JÁ NA TELA nesse instante). Se o usuário mexeu em
 * qualquer uma das 5 colunas nessa janela, o diff que a prévia descreveu (nº de cards, "de → para")
 * já não é o que vai ser gravado — a prévia mostrada mentiria. Comparação PURA por JSON canônico
 * (mesma base de `diffKanban`/`conflitoKanban`): `esperado` = o diff que `prepararSalvar` guardou ao
 * pedir a prévia; `atual` = o diff recalculado no `mutationFn` no momento do Salvar.
 */
export function diffMudouDesdeAPrevia(esperado: KanbanColsValor, atual: KanbanColsValor): boolean {
  return KANBAN_COLS.some((c) => jsonCanonico(esperado[c] ?? null) !== jsonCanonico(atual[c] ?? null));
}

export const MENSAGEM_PREVIA_KANBAN_MUDOU = "A configuração mudou depois da prévia; clique em Salvar de novo.";

export function nCards(n: number): string {
  return n === 1 ? "1 card" : `${n} cards`;
}

export type GrupoMovimento = { de: string | null; para: string | null; recua: boolean; cards: PreviaCard[] };

const posicao = (ordem: string[], k: string | null) => {
  const i = k ? ordem.indexOf(k) : -1;
  return i < 0 ? Number.MAX_SAFE_INTEGER : i;
};

/** Agrupa a prévia por (de → para), na ordem do board (coluna fora do board vai para o fim). */
export function agruparMovimentos(cards: PreviaCard[], ordem: string[]): GrupoMovimento[] {
  const mapa = new Map<string, GrupoMovimento>();
  for (const c of cards) {
    const k = `${c.de ?? ""}→${c.para ?? ""}`;
    const g = mapa.get(k);
    if (g) g.cards.push(c);
    else mapa.set(k, { de: c.de, para: c.para, recua: c.recua, cards: [c] });
  }
  return [...mapa.values()].sort(
    (a, b) => posicao(ordem, a.de) - posicao(ordem, b.de) || posicao(ordem, a.para) - posicao(ordem, b.para),
  );
}

/** "N cards ficam onde estão, em colunas manuais (Em Ajuste 2 · Stand By 2 · …)". */
export function resumirFixados(fixados: PreviaFixado[], ordem: string[]): { coluna: string | null; n: number }[] {
  const mapa = new Map<string | null, number>();
  for (const f of fixados) mapa.set(f.coluna, (mapa.get(f.coluna) ?? 0) + 1);
  return [...mapa.entries()]
    .map(([coluna, n]) => ({ coluna, n }))
    .sort((a, b) => posicao(ordem, a.coluna) - posicao(ordem, b.coluna));
}

/** O diálogo de desligar DESLIGA antes de restaurar — o aviso "Desligue…" da prévia não se aplica. */
export function avisosRestauracaoVisiveis(avisos: string[]): string[] {
  return avisos.filter((a) => !a.startsWith("Desligue o Kanban automático antes de restaurar"));
}

/** "dd/mm/aaaa hh:mm" no fuso da loja (tenant_config.timezone). */
export function formatarDataHora(iso: string | null | undefined, tz: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const partes = new Intl.DateTimeFormat("pt-BR", {
    timeZone: tz, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(d);
  const v = (t: string) => partes.find((p) => p.type === t)?.value ?? "";
  return `${v("day")}/${v("month")}/${v("year")} ${v("hour")}:${v("minute")}`;
}
