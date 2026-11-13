// Peça Teste — a SEÇÃO do Sheet / aba do PCP (reforma por TIPO, nov/2026). A trilha é (card, TIPO de serviço); o fornecedor é da TENTATIVA.
// Lib PURA. O requisito "peça teste aprovada" (espelho da SQL) mora em `peca-teste-requisito.ts` e é re-exportado daqui.

import type { Conflito } from "@/lib/colab/merge";
import {
  acaoNoSalvar, herdarMini, miniDoServidor, miniIgual, miniParaPayload, miniVazia, resumoMini,
  type MiniPayload, type MiniPT,
} from "@/lib/peca-teste-mini";
import {
  pecaTesteAprovadaModelo, pecaTesteAprovadaTipo, type AprovacaoPecaTeste, type LinhaRequisito, type TentativaRequisito,
} from "@/lib/peca-teste-requisito";

export * from "@/lib/peca-teste-requisito";


// ════════════════════════════════ seção do Sheet / aba do PCP ════════════════════════════════
// Estado, status, requisito local, payload do Salvar e merge 3 vias. Tudo PURO (sem React/Supabase). O servidor (`peca_teste_modelo` /
// `salvar_peca_teste`) é a fonte da verdade; aqui só espelhamos o que a tela precisa PREVER antes do Salvar. Regras do servidor que a
// tela respeita (para não virar erro surpresa):
//   • decisão (Aprovado/Reprovado) exige as 2 datas e o FORNECEDOR da tentativa; tentativa nova (sem id) não nasce decidida;
//   • aprovada trava datas e fornecedor (reabrir = mudar a decisão); reprovada é corrigível (datas, fornecedor, mini);
//   • aprovar ou reabrir uma tentativa que NÃO é a última da trilha BLOQUEIA (exclua as seguintes antes);
//   • excluir renumera as seguintes e estorna a baixa da mini (confirmação no Salvar).
export type FornecedorOpcaoPT = { id: string; nome_fantasia: string };

/** Tentativa como a seção a vê. `id: null` = virtual ou ainda não salva; `empresa_id` = fornecedor DESTA tentativa (null até escolher). */
export type TentativaPT = {
  id: string | null;
  numero: number;
  empresa_id: string | null;
  empresa_nome: string | null;
  data_saida: string | null;
  data_entrada: string | null;
  aprovacao: AprovacaoPecaTeste;
  decidido_em: string | null;
  rev: number;
  /** Mini explosão (1 peça) da tentativa (R11); `null` = sem cabeçalho (nada escolhido). */
  mini: MiniPT | null;
};
/** Trilha = um TIPO de serviço que exige peça teste neste card. `tem_mo` = há linha de M.O. do tipo (só ela entra no requisito do kanban);
 *  `mo_aprovado` = agregado das linhas do tipo (true só se TODAS aprovadas; false se alguma reprovada; null = pendente/sem linha);
 *  `fornecedores` = os de SERVIÇO vinculados ao tipo (o Select; vazio = aviso "vincule em Cadastro"); `excluidas` = tentativas GRAVADAS que
 *  o rascunho marcou para excluir (vão em `excluir` no Salvar; nunca vem do servidor). */
export type TrilhaPT = {
  categoria_id: string;
  categoria_nome: string;
  tem_mo: boolean;
  mo_aprovado: boolean | null;
  fornecedores: FornecedorOpcaoPT[];
  tentativas: TentativaPT[];
  excluidas: TentativaPT[];
};
/** Serviço da M.O. cujo tipo NÃO exige peça teste (rodapé "não aparece aqui"). Nunca traz valor. */
export type OutroPT = { categoria_nome: string; empresa_nome: string | null };
/** Tipo que exige peça teste e ainda não está na seção: opção do "Adicionar peça teste". */
export type TipoAdicionarPT = { categoria_id: string; categoria_nome: string; fornecedores: FornecedorOpcaoPT[] };
export type EstadoPT = { trilhas: TrilhaPT[]; outros: OutroPT[]; tipos_adicionar: TipoAdicionarPT[] };

export type StatusTrilhaPT = "aguardando_saida" | "em_teste" | "aprovada" | "reprovada_nova";
export const ROTULO_STATUS_TRILHA: Record<StatusTrilhaPT, string> = {
  aguardando_saida: "Aguardando saída",
  em_teste: "Em teste",
  aprovada: "Aprovada",
  reprovada_nova: "Reprovada — nova tentativa",
};

const vazio = (v: string | null | undefined): string | null => (v ? v : null);
const fornecedoresDoServidor = (raw: unknown): FornecedorOpcaoPT[] =>
  (Array.isArray(raw) ? raw : []).map((f: any) => ({ id: String(f.id), nome_fantasia: String(f.nome_fantasia ?? "Fornecedor") }));

/** Lê o jsonb de `peca_teste_modelo` (tolerante: null/forma estranha = null). */
export function estadoPTDoServidor(raw: unknown): EstadoPT | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { trilhas?: unknown; outros?: unknown; tipos_adicionar?: unknown };
  const trilhas = (Array.isArray(r.trilhas) ? r.trilhas : []).map((x: any): TrilhaPT => ({
    categoria_id: String(x.categoria_id),
    categoria_nome: String(x.categoria_nome ?? "Serviço"),
    tem_mo: x.tem_mo !== false,
    mo_aprovado: x.mo_aprovado === true ? true : x.mo_aprovado === false ? false : null,
    fornecedores: fornecedoresDoServidor(x.fornecedores),
    excluidas: [],
    tentativas: (Array.isArray(x.tentativas) ? x.tentativas : [])
      .map((t: any): TentativaPT => ({
        id: t.id ?? null,
        numero: Number(t.numero),
        empresa_id: t.empresa_id ?? null,
        empresa_nome: t.empresa_nome ?? null,
        data_saida: vazio(t.data_saida),
        data_entrada: vazio(t.data_entrada),
        aprovacao: t.aprovacao === "aprovado" ? "aprovado" : t.aprovacao === "reprovado" ? "reprovado" : null,
        decidido_em: t.decidido_em ?? null,
        rev: Number(t.rev ?? 0),
        mini: miniDoServidor(t.mini),
      }))
      .sort((a: TentativaPT, b: TentativaPT) => a.numero - b.numero),
  }));
  const outros = (Array.isArray(r.outros) ? r.outros : []).map((o: any): OutroPT => ({
    categoria_nome: String(o.categoria_nome ?? "Serviço"),
    empresa_nome: o.empresa_nome ?? null,
  }));
  const tipos_adicionar = (Array.isArray(r.tipos_adicionar) ? r.tipos_adicionar : []).map((x: any): TipoAdicionarPT => ({
    categoria_id: String(x.categoria_id),
    categoria_nome: String(x.categoria_nome ?? "Serviço"),
    fornecedores: fornecedoresDoServidor(x.fornecedores),
  }));
  return { trilhas, outros, tipos_adicionar };
}

function ordenadas(t: Pick<TrilhaPT, "tentativas">): TentativaPT[] {
  return [...t.tentativas].sort((a, b) => a.numero - b.numero);
}

/** Tentativa virtual: ainda não existe no banco (a 1ª nasce sem fornecedor nem datas; a seguinte a uma reprovada idem). */
export function tentativaVirtual(numero: number, mini: MiniPT | null = null): TentativaPT {
  return { id: null, numero, empresa_id: null, empresa_nome: null, data_saida: null, data_entrada: null, aprovacao: null, decidido_em: null, rev: 0, mini };
}

/** A tentativa ATUAL da trilha COM virtual: a última, se não está reprovada; senão a virtual de número max+1 (1 sem nenhuma). */
export function tentativaAtualPT(t: Pick<TrilhaPT, "tentativas">): TentativaPT {
  const ord = ordenadas(t);
  const ult = ord[ord.length - 1];
  if (!ult) return tentativaVirtual(1);
  return ult.aprovacao === "reprovado" ? tentativaVirtual(ult.numero + 1, herdarMini(ult.mini)) : ult;
}

/** Tentativas anteriores (reprovadas), da mais antiga para a mais nova. */
export function historico(t: Pick<TrilhaPT, "tentativas">): TentativaPT[] {
  return ordenadas(t).filter((x) => x.aprovacao === "reprovado");
}

/** Status da trilha (rótulos do mockup). Reprovada com a próxima ainda sem Data de saída = "Reprovada — nova tentativa". */
export function statusTrilha(t: Pick<TrilhaPT, "tentativas">): StatusTrilhaPT {
  const at = tentativaAtualPT(t);
  if (at.aprovacao === "aprovado") return "aprovada";
  if (!at.data_saida) {
    const anterior = ordenadas(t).filter((x) => x.numero < at.numero).pop();
    return anterior?.aprovacao === "reprovado" ? "reprovada_nova" : "aguardando_saida";
  }
  return "em_teste";
}

// ───────────── os 2 contadores e o rótulo ─────────────
/** 2º contador (DERIVADO, sem coluna): "N-ésima vez com ESTE fornecedor" = quantas tentativas ANTERIORES (número menor) do mesmo tipo usaram o
 *  mesmo fornecedor + 1. null = a tentativa não tem fornecedor (ou não existe). */
export function vezComFornecedor(tentativas: readonly Pick<TentativaPT, "numero" | "empresa_id">[], numero: number): number | null {
  const atual = tentativas.find((t) => t.numero === numero);
  if (!atual || !atual.empresa_id) return null;
  return tentativas.filter((t) => t.numero < numero && t.empresa_id === atual.empresa_id).length + 1;
}
/** "Tentativa 3 (2ª com Oficina X)". Sem fornecedor: só "Tentativa 3". */
export function rotuloNumeroTentativa(a: { numero: number; fornecedor_nome: string | null; vez: number | null }): string {
  const base = `Tentativa ${a.numero}`;
  return a.vez !== null && a.fornecedor_nome ? `${base} (${a.vez}ª com ${a.fornecedor_nome})` : base;
}
/** "PL — Tentativa 3 (2ª com Oficina X)" (o título da trilha). */
export function rotuloTentativa(a: { categoria_nome: string; numero: number; fornecedor_nome: string | null; vez: number | null }): string {
  return `${a.categoria_nome} — ${rotuloNumeroTentativa(a)}`;
}

// ───────────── decisão ─────────────
/** Só decide (Aprovado/Reprovado) com Data de saída E Data de entrada. */
export function podeDecidir(at: Pick<TentativaPT, "data_saida" | "data_entrada">): boolean {
  return !!at.data_saida && !!at.data_entrada;
}

export type MotivoSemDecisao = "sem_datas" | "nao_salva" | "sem_fornecedor";
/** Por que a Aprovação está desabilitada (null = pode decidir): sem as 2 datas; tentativa ainda não salva (id nulo: o servidor recusa decisão
 *  de tentativa nova); sem fornecedor escolhido. */
export function motivoSemDecisao(at: Pick<TentativaPT, "data_saida" | "data_entrada" | "empresa_id"> & { id?: string | null }): MotivoSemDecisao | null {
  if (!podeDecidir(at)) return "sem_datas";
  if (at.id === null) return "nao_salva";
  if (!at.empresa_id) return "sem_fornecedor";
  return null;
}
export const TEXTO_SEM_DATAS = "Preencha a Data de saída e a Data de entrada para decidir.";
export const TEXTO_NAO_SALVA = "Salve as datas antes de decidir.";
export const TEXTO_SEM_FORNECEDOR = "Escolha o fornecedor desta tentativa antes de decidir.";
export const TEXTO_SEM_FORNECEDOR_NO_TIPO = "Nenhum fornecedor está vinculado a este tipo de serviço. Vincule em Cadastro › Serviço.";
export const TEXTO_APROVAR_MEIO = "Há tentativas seguintes: exclua-as antes de aprovar esta.";
export const TEXTO_REABRIR_MEIO = "Há tentativas seguintes: exclua-as antes de reabrir esta.";
export function textoMotivoSemDecisao(m: MotivoSemDecisao): string {
  return m === "sem_datas" ? TEXTO_SEM_DATAS : m === "nao_salva" ? TEXTO_NAO_SALVA : TEXTO_SEM_FORNECEDOR;
}

/** Dica âmbar NÃO bloqueante: Data de entrada anterior à Data de saída (ISO compara como texto). */
export function entradaAntesDaSaida(at: Pick<TentativaPT, "data_saida" | "data_entrada">): boolean {
  return !!at.data_saida && !!at.data_entrada && at.data_entrada < at.data_saida;
}

/** Tentativa "sem nada": sem datas, sem decisão, sem fornecedor e sem mini com dado (a mini com tamanho/cor/ajuste/baixa conta como dado). */
const SEM_CAMPOS = (a: Pick<TentativaPT, "data_saida" | "data_entrada" | "aprovacao" | "empresa_id" | "mini">) =>
  !a.data_saida && !a.data_entrada && !a.aprovacao && !a.empresa_id && miniVazia(a.mini);

// ───────────── operações do rascunho (cada uma devolve uma CÓPIA da trilha) ─────────────
/** Troca SÓ a `mini` de UMA tentativa por número (a reprovada do histórico, botão "Editar": o Salvar estorna a baixa e refaz). A aprovada
 *  nunca muda (o servidor também recusa). Número que não existe = nada. */
export function editarMiniDaTentativa(t: TrilhaPT, numero: number, mini: MiniPT | null): TrilhaPT {
  return {
    ...t,
    tentativas: t.tentativas.map((x) => (x.numero === numero && x.aprovacao !== "aprovado" ? { ...x, mini: mini === null || miniVazia(mini) ? null : mini } : x)),
  };
}

/** Troca a trilha por uma cópia com a tentativa ATUAL editada. Virtual que ganha dado entra na lista; local nova (sem id) que volta a ficar
 *  vazia sai; a GRAVADA que fica vazia continua (o Salvar a apaga — volta a virtual). Reprovada nunca é editada por aqui. */
export function editarAtual(
  t: TrilhaPT,
  patch: Partial<Pick<TentativaPT, "data_saida" | "data_entrada" | "aprovacao" | "empresa_id" | "empresa_nome" | "mini">>,
): TrilhaPT {
  const at = tentativaAtualPT(t);
  if (at.aprovacao === "reprovado") return t;
  const novo: TentativaPT = { ...at, ...patch };
  novo.data_saida = vazio(novo.data_saida);
  novo.data_entrada = vazio(novo.data_entrada);
  const naLista = t.tentativas.some((x) => x.numero === at.numero);
  if (!naLista) return SEM_CAMPOS(novo) ? t : { ...t, tentativas: [...t.tentativas, novo] };
  if (at.id === null && SEM_CAMPOS(novo)) return { ...t, tentativas: t.tentativas.filter((x) => x.numero !== at.numero) };
  return { ...t, tentativas: t.tentativas.map((x) => (x.numero === at.numero ? novo : x)) };
}

/** Aprovado (o fornecedor é o da própria tentativa, já escolhido). */
export function aprovar(t: TrilhaPT): TrilhaPT {
  return editarAtual(t, { aprovacao: "aprovado" });
}
/** Desfaz a aprovação (volta a "Selecione…"): o fornecedor da tentativa FICA. */
export function desfazerDecisao(t: TrilhaPT): TrilhaPT {
  return editarAtual(t, { aprovacao: null });
}
/** Reprovado: a atual vai para o histórico (com o fornecedor dela) e nasce a seguinte — SEM fornecedor, datas vazias (`tentativaAtualPT` a
 *  devolve). A seguinte herda tamanho, cor, "mesma OC" e o item de OC/rolo da mini (P-347): com o que herdar ela já entra na lista. */
export function reprovar(t: TrilhaPT): TrilhaPT {
  const at = tentativaAtualPT(t);
  if (at.aprovacao === "reprovado") return t;
  const novo: TentativaPT = { ...at, aprovacao: "reprovado" };
  const naLista = t.tentativas.some((x) => x.numero === at.numero);
  const lista = naLista ? t.tentativas.map((x) => (x.numero === at.numero ? novo : x)) : [...t.tentativas, novo];
  const herdada = herdarMini(at.mini);
  const proxima = lista.some((x) => x.numero === at.numero + 1) || !herdada ? null : { ...tentativaVirtual(at.numero + 1, herdada) };
  return { ...t, tentativas: proxima ? [...lista, proxima] : lista };
}

export type MotivoBloqueioDecisao = "aprovar_meio" | "reabrir_meio";
/** Espelho das recusas `peca_teste_aprovar_meio` / `peca_teste_reabrir_meio`: mudar a decisão de uma tentativa que tem tentativas SEGUINTES
 *  para "aprovado" ou para "pendente" (null) bloqueia. Para "reprovado" nunca bloqueia. null = pode. */
export function motivoBloqueioMudarDecisao(t: Pick<TrilhaPT, "tentativas">, numero: number, para: AprovacaoPecaTeste): MotivoBloqueioDecisao | null {
  const x = t.tentativas.find((a) => a.numero === numero);
  if (!x || (x.aprovacao ?? null) === para) return null;
  if (!t.tentativas.some((a) => a.numero > numero)) return null;
  if (para === "aprovado") return "aprovar_meio";
  if (para === null) return "reabrir_meio";
  return null;
}
/** Muda a decisão de UMA tentativa por número (histórico: reprovada -> aprovada/pendente). Bloqueada pelas regras acima = nada. */
export function mudarDecisaoTentativa(t: TrilhaPT, numero: number, para: AprovacaoPecaTeste): TrilhaPT {
  if (motivoBloqueioMudarDecisao(t, numero, para) !== null) return t;
  return { ...t, tentativas: t.tentativas.map((x) => (x.numero === numero ? { ...x, aprovacao: para } : x)) };
}
/** Corrige datas/fornecedor de UMA tentativa REPROVADA do histórico (a decisão não muda). Outra decisão = nada. */
export function corrigirTentativa(
  t: TrilhaPT,
  numero: number,
  patch: Partial<Pick<TentativaPT, "data_saida" | "data_entrada" | "empresa_id" | "empresa_nome">>,
): TrilhaPT {
  return {
    ...t,
    tentativas: t.tentativas.map((x) => {
      if (x.numero !== numero || x.aprovacao !== "reprovado") return x;
      const novo = { ...x, ...patch };
      return { ...novo, data_saida: vazio(novo.data_saida), data_entrada: vazio(novo.data_entrada) };
    }),
  };
}
/** Exclui UMA tentativa por número: sai da lista, as seguintes são RENUMERADAS (1..n) e, se já estava gravada, vai para `excluidas` (o Salvar
 *  manda `excluir`; o servidor estorna a baixa e renumera igual). */
export function excluirTentativa(t: TrilhaPT, numero: number): TrilhaPT {
  const alvo = t.tentativas.find((x) => x.numero === numero);
  if (!alvo) return t;
  const restantes = ordenadas(t).filter((x) => x.numero !== numero).map((x, i) => ({ ...x, numero: i + 1 }));
  return { ...t, tentativas: restantes, excluidas: alvo.id ? [...t.excluidas, alvo] : t.excluidas };
}
/** "Adicionar peça teste": acrescenta ao rascunho a trilha (vazia, virtual) de um tipo de `tipos_adicionar`. Tipo já presente = nada. */
export function adicionarTrilha(e: EstadoPT, categoriaId: string): EstadoPT {
  const tipo = e.tipos_adicionar.find((x) => x.categoria_id === categoriaId);
  if (!tipo || e.trilhas.some((x) => x.categoria_id === categoriaId)) return e;
  const nova: TrilhaPT = {
    categoria_id: tipo.categoria_id, categoria_nome: tipo.categoria_nome, tem_mo: false, mo_aprovado: null,
    fornecedores: tipo.fornecedores, tentativas: [], excluidas: [],
  };
  return { ...e, trilhas: [...e.trilhas, nova], tipos_adicionar: e.tipos_adicionar.filter((x) => x.categoria_id !== categoriaId) };
}

// ───────────── requisito local (resumo da seção, antes de salvar) ─────────────
export type FaltaPT = { categoria_id: string; servico: string; motivo: "peça teste" | "M.O. pendente" | "peça teste e M.O." };
export type RequisitoPT = { exigem: number; aprovadas: number; ok: boolean; faltas: FaltaPT[] };
/** O requisito do kanban para o estado EFETIVO da tela (rascunho): conta só as trilhas com linha de M.O. (`tem_mo`). */
export function requisitoDoEstado(estado: Pick<EstadoPT, "trilhas">): RequisitoPT {
  const ativas = estado.trilhas.filter((t) => t.tem_mo);
  const tentativas: TentativaRequisito[] = estado.trilhas.flatMap((t) =>
    t.tentativas.map((x) => ({ categoria_id: t.categoria_id, numero: x.numero, aprovacao: x.aprovacao })));
  const faltas: FaltaPT[] = [];
  let aprovadas = 0;
  for (const t of ativas) {
    const peca = pecaTesteAprovadaTipo(tentativas, t.categoria_id);
    const mo = t.mo_aprovado === true;
    if (peca) aprovadas++;
    if (!(peca && mo)) faltas.push({ categoria_id: t.categoria_id, servico: t.categoria_nome, motivo: !peca && !mo ? "peça teste e M.O." : !peca ? "peça teste" : "M.O. pendente" });
  }
  const ok = pecaTesteAprovadaModelo({
    linhas: ativas.map((t): LinhaRequisito => ({ categoria_id: t.categoria_id, exige: true, mo_aprovado: t.mo_aprovado })),
    tentativas,
  });
  return { exigem: ativas.length, aprovadas, ok, faltas };
}

// ───────────── payload do Salvar (delta) ─────────────
/** `{ _trilhas, _rev_base }` de `salvar_peca_teste` SÓ com o que mudou. Trilha = `categoria_id`. Toda tentativa existente que muda (ou é
 *  excluída) leva o `rev` da base em `_rev_base.tentativas[id]`; `empresa_id` vai em TODA tentativa enviada (o fornecedor dela). */
export type PayloadPT = {
  _trilhas: {
    categoria_id: string;
    excluir?: string[];
    tentativas: {
      id: string | null; numero: number; empresa_id: string | null; data_saida: string | null; data_entrada: string | null;
      aprovacao: AprovacaoPecaTeste; mini?: MiniPayload;
    }[];
  }[];
  _rev_base: { tentativas: Record<string, number> };
};
/** Opções do payload sobre a mini (R11). `confere[chaveConfere(categoria, nº)]` = o "a enviar" EFETIVO que a pessoa VIU, por chave (4 casas):
 *  vai junto da mini quando o Salvar fará a baixa. `semTecido1` = o card não tem Tecido 1 (a cor não é exigida para a baixa). */
export type OpcoesPayloadPT = { confere?: Readonly<Record<string, Record<string, number>>>; semTecido1?: boolean };
/** Chave do mapa `confere`: "<categoria_id>:<nº da tentativa no rascunho>". */
export const chaveConfere = (categoriaId: string, numero: number): string => `${categoriaId}:${numero}`;

const baseDaTrilha = (base: EstadoPT, dt: TrilhaPT): TrilhaPT =>
  base.trilhas.find((x) => x.categoria_id === dt.categoria_id) ?? { ...dt, tentativas: [], excluidas: [] };

export function payloadPecaTeste(draft: EstadoPT, base: EstadoPT, opcoes: OpcoesPayloadPT = {}): PayloadPT {
  const out: PayloadPT = { _trilhas: [], _rev_base: { tentativas: {} } };
  for (const dt of draft.trilhas) {
    const bt = baseDaTrilha(base, dt);
    const tentativas: PayloadPT["_trilhas"][number]["tentativas"] = [];
    const revs: Record<string, number> = {};
    const excluir: string[] = [];
    for (const e of dt.excluidas) {
      const b = e.id ? bt.tentativas.find((x) => x.id === e.id) : undefined;
      if (!e.id || !b) continue;
      excluir.push(e.id);
      revs[e.id] = b.rev;
    }
    for (const a of ordenadas(dt)) {
      const b = a.id ? bt.tentativas.find((x) => x.id === a.id) : undefined;
      if (a.id && !b) continue;
      // A mini vai quando MUDOU vs a base OU quando o Salvar mexe no estoque (baixa/estorno; só se algo da tentativa mudou — abrir o card não
      // dispara baixa). Mudar SÓ a data com a baixa ativa mantém a baixa: nada da mini vai.
      let mini: MiniPayload | undefined;
      if (b) {
        const miniMudou = !miniIgual(a.mini, b.mini);
        const mudou = vazio(a.data_saida) !== vazio(b.data_saida) || vazio(a.data_entrada) !== vazio(b.data_entrada)
          || (a.aprovacao ?? null) !== (b.aprovacao ?? null) || (a.empresa_id ?? null) !== (b.empresa_id ?? null) || miniMudou;
        if (!mudou) continue;
        revs[a.id as string] = b.rev;
        const acao = acaoNoSalvar(a, b, opcoes);
        if (miniMudou || acao === "baixa" || acao === "estorno" || acao === "estorno_e_baixa") {
          mini = miniParaPayload(a.mini, acao === "baixa" || acao === "estorno_e_baixa" ? opcoes.confere?.[chaveConfere(dt.categoria_id, a.numero)] : undefined);
        }
      } else {
        if (SEM_CAMPOS(a)) continue;
        const acao = acaoNoSalvar(a, undefined, opcoes);
        if (!miniVazia(a.mini) || acao === "baixa") {
          mini = miniParaPayload(a.mini, acao === "baixa" ? opcoes.confere?.[chaveConfere(dt.categoria_id, a.numero)] : undefined);
        }
      }
      tentativas.push({
        id: a.id, numero: a.numero, empresa_id: a.empresa_id ?? null, data_saida: vazio(a.data_saida), data_entrada: vazio(a.data_entrada),
        aprovacao: a.aprovacao ?? null, ...(mini ? { mini } : {}),
      });
    }
    if (tentativas.length === 0 && excluir.length === 0) continue;
    out._trilhas.push({ categoria_id: dt.categoria_id, ...(excluir.length > 0 ? { excluir } : {}), tentativas });
    Object.assign(out._rev_base.tentativas, revs);
  }
  return out;
}

/** Tentativas cujo Salvar vai ESTORNAR a baixa da mini: data de saída apagada, mini mudada com a data preenchida (estorna e refaz) OU tentativa
 *  EXCLUÍDA com baixa ativa. `numero` = o da BASE (o que a pessoa viu antes de editar). `refaz` = estorno + nova baixa (P-365 A). */
export function estornosPendentes(
  draft: EstadoPT,
  base: EstadoPT,
  opcoes: OpcoesPayloadPT = {},
): { categoria_id: string; servico: string; numero: number; refaz: boolean }[] {
  const out: { categoria_id: string; servico: string; numero: number; refaz: boolean }[] = [];
  for (const dt of draft.trilhas) {
    const bt = base.trilhas.find((x) => x.categoria_id === dt.categoria_id);
    if (!bt) continue;
    for (const e of dt.excluidas) {
      const b = e.id ? bt.tentativas.find((x) => x.id === e.id) : undefined;
      if (b?.mini?.baixa_em) out.push({ categoria_id: dt.categoria_id, servico: dt.categoria_nome, numero: b.numero, refaz: false });
    }
    for (const a of ordenadas(dt)) {
      const b = a.id ? bt.tentativas.find((x) => x.id === a.id) : undefined;
      if (!b) continue;
      const mudou = vazio(a.data_saida) !== vazio(b.data_saida) || vazio(a.data_entrada) !== vazio(b.data_entrada)
        || (a.aprovacao ?? null) !== (b.aprovacao ?? null) || (a.empresa_id ?? null) !== (b.empresa_id ?? null) || !miniIgual(a.mini, b.mini);
      if (!mudou) continue;
      const acao = acaoNoSalvar(a, b, opcoes);
      if (acao === "estorno" || acao === "estorno_e_baixa") out.push({ categoria_id: dt.categoria_id, servico: dt.categoria_nome, numero: b.numero, refaz: acao === "estorno_e_baixa" });
    }
  }
  return out;
}

/** "Não salvo" da seção: o delta contra a base não é vazio. */
export function ptDirty(draft: EstadoPT, base: EstadoPT, opcoes?: OpcoesPayloadPT): boolean {
  return payloadPecaTeste(draft, base, opcoes)._trilhas.length > 0;
}

// ───────────── merge 3 vias (base / meu / dele) ─────────────
/** `avisos`: mudanças alheias adotadas SEM escolha (baixa/estorno feitos por outra pessoa, tentativa excluída por outra pessoa). */
export type ResultadoMergePT = { valor: EstadoPT; conflitos: Conflito[]; atualizados: number; avisos: string[] };
export const CAMPOS_TENTATIVA_PT = ["empresa_id", "data_saida", "data_entrada", "aprovacao"] as const;
type CampoTentativaPT = (typeof CAMPOS_TENTATIVA_PT)[number];

/** `pt:<tipo>:<campo>` (tentativa ATUAL; `mini` = a mini explosão, UMA unidade de merge); campo de outra tentativa = `pt:<tipo>:t<n>:<campo>`
 *  (ex.: `pt:<tipo>:t2:mini`; `excluir` = conflito de exclusão). */
export function pathPT(categoriaId: string, campo: string, numero?: number | null): string {
  return numero == null ? `pt:${categoriaId}:${campo}` : `pt:${categoriaId}:t${numero}:${campo}`;
}
export function lerPathPT(path: string): { categoria: string; campo: string; numero: number | null } | null {
  const m = /^pt:([^:]+):(?:t(\d+):)?([a-z_]+)$/.exec(path);
  return m ? { categoria: m[1], campo: m[3], numero: m[2] ? Number(m[2]) : null } : null;
}

function dataBR(iso: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
}
function rotuloCampo(campo: CampoTentativaPT, t: TentativaPT): string {
  if (campo === "aprovacao") return t.aprovacao === "aprovado" ? "Aprovado" : t.aprovacao === "reprovado" ? "Reprovado" : "—";
  if (campo === "empresa_id") return t.empresa_nome ?? "—";
  return dataBR(t[campo]);
}

/** Minha mini com os campos que SÓ o servidor decide (baixa, quem baixou, histórico) vindos da dele. */
function miniMinhaComMetaDele(minha: MiniPT | null, dele: MiniPT | null): MiniPT | null {
  if (!minha) return minha;
  return { ...minha, baixa_em: dele?.baixa_em ?? null, baixa_por_nome: dele?.baixa_por_nome ?? null, tem_historico: dele?.tem_historico ?? minha.tem_historico };
}

const igualCampos = (a: TentativaPT, b: TentativaPT) =>
  CAMPOS_TENTATIVA_PT.every((c) => (a[c] ?? null) === (b[c] ?? null)) && miniIgual(a.mini, b.mini);

export function mergePecaTeste(base: EstadoPT, meu: EstadoPT, dele: EstadoPT): ResultadoMergePT {
  const conflitos: Conflito[] = [];
  const avisos: string[] = [];
  let atualizados = 0;
  const trilhas: TrilhaPT[] = [];
  for (const d of dele.trilhas) {
    const m = meu.trilhas.find((x) => x.categoria_id === d.categoria_id);
    if (!m) { trilhas.push(d); continue; } // trilha que só existe do lado dele entra
    const b = base.trilhas.find((x) => x.categoria_id === d.categoria_id);
    // as tentativas são casadas por ID (a numeração do meu rascunho pode ter deslocado por uma exclusão minha); a minha NOVA (sem id) casa
    // com a nova DELE do mesmo número (alguém lançou a mesma tentativa) — a base dela é "virtual"
    const idsMeus = new Set(m.tentativas.filter((x) => x.id).map((x) => x.id));
    const idsBase = new Set((b?.tentativas ?? []).filter((x) => x.id).map((x) => x.id));
    const resultado: { chave: number; t: TentativaPT }[] = [];
    const usadasDele = new Set<string>();
    const aviso = (n: number, quem: string) => `A tentativa ${n} de ${d.categoria_nome} foi ${quem} por outra pessoa.`;

    // — minhas tentativas (com id e novas)
    for (const mt of m.tentativas) {
      const dt = mt.id
        ? d.tentativas.find((x) => x.id === mt.id)
        : d.tentativas.find((x) => x.numero === mt.numero && x.id && !idsMeus.has(x.id) && !idsBase.has(x.id));
      const bt = mt.id ? b?.tentativas.find((x) => x.id === mt.id) : undefined;
      if (!dt) {
        if (bt) { // ele a apagou: sem edição minha some; com edição minha sobrevive como NOVA
          if (igualCampos(mt, bt)) { atualizados++; avisos.push(aviso(bt.numero, "excluída")); continue; }
          resultado.push({ chave: 1000 + mt.numero, t: { ...mt, id: null, rev: 0 } });
        } else resultado.push({ chave: 1000 + mt.numero, t: mt });
        continue;
      }
      usadasDele.add(dt.id as string);
      const bb: TentativaPT = bt ?? { ...tentativaVirtual(mt.numero), rev: 0 };
      const merged: TentativaPT = { ...dt };
      let conflitoAprovacao = false;
      const atual = tentativaAtualPT(m).numero === mt.numero;
      const numPath = atual ? null : mt.numero;
      for (const campo of CAMPOS_TENTATIVA_PT) {
        const mv = mt[campo] ?? null, bv = bb[campo] ?? null, dv = dt[campo] ?? null;
        let val: string | null;
        if (mv === bv) { val = dv; if (dv !== mv) atualizados++; }
        else if (dv === bv || mv === dv) val = mv;
        else {
          val = mv;
          conflitos.push({ path: pathPT(d.categoria_id, campo, numPath), meu: rotuloCampo(campo, mt), dele: rotuloCampo(campo, dt) });
          if (campo === "aprovacao") conflitoAprovacao = true;
        }
        (merged as Record<string, unknown>)[campo] = val;
        if (campo === "empresa_id") merged.empresa_nome = val === mt.empresa_id ? mt.empresa_nome : dt.empresa_nome;
      }
      // minha DECISÃO (Aprovado/Reprovado) vale e foi tomada vendo o fornecedor da BASE: se ele o trocou no meio, quem decidiu confirma
      // (manter o meu = decidir para o fornecedor novo, sabendo; usar o novo = descartar a decisão)
      const minhaDecisaoVale = merged.aprovacao !== null && merged.aprovacao === (mt.aprovacao ?? null)
        && merged.aprovacao !== (bb.aprovacao ?? null) && merged.aprovacao !== (dt.aprovacao ?? null);
      const eleTrocouFornecedor = (dt.empresa_id ?? null) !== (bb.empresa_id ?? null) && (dt.empresa_id ?? null) !== (mt.empresa_id ?? null);
      if (minhaDecisaoVale && eleTrocouFornecedor && !conflitoAprovacao) {
        conflitos.push({ path: pathPT(d.categoria_id, "aprovacao", numPath), meu: rotuloCampo("aprovacao", mt), dele: `fornecedor passou a ser ${dt.empresa_nome ?? "nenhum"}` });
      }
      // — a mini explosão é UMA unidade (`pt:<tipo>[:t<n>]:mini`). Só eu mudei → a minha; só ele → a dele; os dois diferentes → conflito.
      // Baixa/estorno de estoque feitos por OUTRA pessoa (baixa_em dele ≠ a da base) → a dele, sem escolha, + aviso.
      {
        const mm = mt.mini, bm = bb.mini, dm = dt.mini;
        const baixaDele = (dm?.baixa_em ?? null) !== (bm?.baixa_em ?? null);
        if (baixaDele) {
          merged.mini = dm;
          atualizados++;
          avisos.push(`A baixa de estoque da peça teste (tentativa ${dt.numero}) foi ${dm?.baixa_em ? "feita" : "estornada"} por outra pessoa — a mini explosão foi atualizada.`);
        } else if (miniIgual(mm, bm)) {
          merged.mini = dm;
          if (!miniIgual(dm, mm)) atualizados++;
        } else if (miniIgual(dm, bm) || miniIgual(mm, dm)) {
          merged.mini = miniMinhaComMetaDele(mm, dm);
        } else {
          merged.mini = miniMinhaComMetaDele(mm, dm);
          conflitos.push({ path: pathPT(d.categoria_id, "mini", numPath), meu: `Mini explosão: ${resumoMini(mm)}`, dele: `Mini explosão: ${resumoMini(dm)}` });
        }
      }
      resultado.push({ chave: dt.numero, t: merged });
    }

    // — tentativas SÓ dele: novas dele entram; as que eu exclui seguem excluídas (a menos que ele as tenha mudado = conflito)
    const excluidasMinhas = new Map(m.excluidas.filter((x) => x.id).map((x) => [x.id as string, x]));
    const excluidas: TentativaPT[] = [];
    for (const dt of d.tentativas) {
      if (usadasDele.has(dt.id as string)) continue;
      const minhaExcl = excluidasMinhas.get(dt.id as string);
      if (!minhaExcl) { resultado.push({ chave: dt.numero, t: dt }); atualizados++; continue; }
      const bt = b?.tentativas.find((x) => x.id === dt.id);
      if (bt && dt.rev !== bt.rev) {
        conflitos.push({ path: pathPT(d.categoria_id, "excluir", minhaExcl.numero), meu: "Excluir a tentativa", dele: "A tentativa foi alterada por outra pessoa" });
      }
      excluidas.push(dt);
    }
    for (const [id, e] of excluidasMinhas) {
      if (!d.tentativas.some((x) => x.id === id)) avisos.push(aviso(e.numero, "excluída")); // ele também a excluiu: some das duas listas
    }
    const tentativas = resultado.sort((x, y) => x.chave - y.chave).map((x, i) => ({ ...x.t, numero: i + 1 }));
    trilhas.push({ ...d, tentativas, excluidas });
  }
  return { valor: { trilhas, outros: dele.outros, tipos_adicionar: dele.tipos_adicionar }, conflitos, atualizados, avisos };
}

/** "Usar o novo" de um conflito: o campo do rascunho passa a valer o do servidor (`fresh`). */
export function aplicarCampoDele(draft: EstadoPT, fresh: EstadoPT, path: string): EstadoPT {
  const p = lerPathPT(path);
  if (!p) return draft;
  const f = fresh.trilhas.find((x) => x.categoria_id === p.categoria);
  const trilhas = draft.trilhas.map((t) => {
    if (t.categoria_id !== p.categoria || !f) return t;
    if (p.campo === "excluir") {
      // restaura a tentativa excluída (a versão do servidor) e a recoloca na ordem
      const e = t.excluidas.find((x) => x.numero === p.numero);
      const fe = e?.id ? f.tentativas.find((x) => x.id === e.id) : undefined;
      if (!e || !fe) return { ...t, excluidas: t.excluidas.filter((x) => x.numero !== p.numero) };
      const lista = [...t.tentativas, fe].sort((a, b) => a.numero - b.numero).map((x, i) => ({ ...x, numero: i + 1 }));
      return { ...t, tentativas: lista, excluidas: t.excluidas.filter((x) => x !== e) };
    }
    const n = p.numero ?? tentativaAtualPT(t).numero;
    const idAlvo = t.tentativas.find((x) => x.numero === n)?.id ?? null;
    const ft = idAlvo ? f.tentativas.find((x) => x.id === idAlvo) : f.tentativas.find((x) => x.numero === n);
    if (p.campo === "mini") return { ...t, tentativas: t.tentativas.map((x) => (x.numero === n ? { ...x, mini: ft ? ft.mini : null } : x)) };
    const campo = p.campo as CampoTentativaPT;
    if (!CAMPOS_TENTATIVA_PT.includes(campo)) return t;
    return {
      ...t,
      tentativas: t.tentativas.map((x) => {
        if (x.numero !== n) return x;
        const novo: TentativaPT = { ...x, [campo]: ft ? ft[campo] : null };
        if (campo === "empresa_id") novo.empresa_nome = ft?.empresa_nome ?? null;
        if (campo === "aprovacao") novo.decidido_em = ft?.decidido_em ?? null;
        return novo;
      }),
    };
  });
  return { ...draft, trilhas };
}
