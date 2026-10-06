// Peça Teste (R9, plan-c) — lib PURA. Núcleo do requisito do kanban "Peça teste aprovada" (T3); a T6 estende com o estado da seção,
// status, payload e merge.
//
// ESPELHO EXATO da SQL (não reimplementar em outro lugar):
//   - `pecaTesteAprovadaTrilha` ≡ `public._peca_teste_aprovada(linha, tipo, fornecedor da linha)` (193000): considera SÓ as
//     tentativas do TIPO ATUAL da linha (`categoria_id`; o SQL filtra por `mo_linha_id` E `categoria_terceirizado_id`, então trocar
//     o tipo da linha deixa as tentativas do tipo antigo escondidas — Ruling 4); entre elas, a ATUAL (maior número) está 'aprovado'
//     E o fornecedor CONGELADO na decisão é o fornecedor ATUAL da linha (null × null conta, como o `IS NOT DISTINCT FROM` do SQL).
//     Sem tentativa = false. Linha sem tipo (`categoria_id` null) nunca casa (a coluna da tabela é NOT NULL; `= NULL` do SQL não
//     devolve linha). O chamador NÃO filtra: passa as tentativas da linha como vieram. Não olha o switch nem a M.O.
//   - `pecaTesteAprovadaModelo` ≡ a chave `peca_teste_aprovada` de `_avaliar_condicoes_kanban_core` (194000): TODA linha de M.O. cujo
//     tipo exige peça teste tem a M.O. APROVADA (`aprovado === true`) E a trilha aprovada. Sem linha exigindo = cumprido (vácuo).
// Anti-drift SQL × TS: `tests/fixtures/peca-teste-casos.ts` (unit + `tests/integration/urgc-r9-kanban.test.ts`).

import type { Conflito } from "@/lib/colab/merge";

export type AprovacaoPecaTeste = "aprovado" | "reprovado" | null;

/** Tentativa da trilha como o requisito a vê: tipo de serviço sob o qual foi lançada (`categoria_id`), número, decisão e o
 *  fornecedor CONGELADO na decisão (`empresa_id` da tentativa). */
export type TentativaRequisito = {
  categoria_id: string | null;
  numero: number;
  aprovacao: AprovacaoPecaTeste;
  empresa_id: string | null;
};

/** Linha de M.O. do card como o requisito a vê. `categoria_id` = o tipo de serviço ATUAL da linha (null = "Geral (legado)").
 *  `exige` = esse tipo (da loja) tem "Exige peça teste" ligado (linha sem tipo = false). `empresa_id` = o fornecedor ATUAL da
 *  linha. `tentativas` = as tentativas da linha (de QUALQUER tipo que ela já teve; a função filtra pelo tipo atual). */
export type LinhaRequisito = {
  categoria_id: string | null;
  exige: boolean;
  mo_aprovado: boolean | null;
  empresa_id: string | null;
  tentativas: TentativaRequisito[];
};

/** A tentativa ATUAL da trilha = a de maior número (null sem tentativa). */
export function tentativaAtual<T extends { numero: number }>(tentativas: readonly T[]): T | null {
  let atual: T | null = null;
  for (const t of tentativas) if (atual === null || t.numero > atual.numero) atual = t;
  return atual;
}

/** Espelho de `_peca_teste_aprovada`: entre as tentativas do TIPO ATUAL da linha, a atual está 'aprovado' E o fornecedor
 *  congelado = o fornecedor atual da linha. */
export function pecaTesteAprovadaTrilha(linha: Pick<LinhaRequisito, "categoria_id" | "empresa_id" | "tentativas">): boolean {
  const doTipo = linha.categoria_id === null ? [] : linha.tentativas.filter((t) => t.categoria_id === linha.categoria_id);
  const atual = tentativaAtual(doTipo);
  return atual !== null && atual.aprovacao === "aprovado" && (atual.empresa_id ?? null) === (linha.empresa_id ?? null);
}

/** Espelho da condição `peca_teste_aprovada`: toda linha que exige tem M.O. aprovada E peça teste aprovada. Vazio = true. */
export function pecaTesteAprovadaModelo(linhas: readonly LinhaRequisito[]): boolean {
  return linhas.every((l) => !l.exige || (l.mo_aprovado === true && pecaTesteAprovadaTrilha(l)));
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// T6 — seção "Peça Teste" do Sheet do Planejamento: estado, status, requisito local, payload do Salvar e merge 3 vias.
// Tudo PURO (sem React/Supabase). O servidor (`peca_teste_modelo`/`salvar_peca_teste`, 193000) é a fonte da verdade; aqui só
// espelhamos o que a tela precisa PREVER antes do Salvar. Regras do servidor que a tela respeita (para não virar erro surpresa):
//   • decisão (Aprovado/Reprovado) exige as 2 datas, o fornecedor da linha SALVO e `_rev_base.fornecedor[linha]`;
//   • aprovar + trocar o fornecedor no mesmo Salvar = P0001 `peca_teste_fornecedor_travado` (a tela desabilita "Aprovado");
//   • reprovada é só leitura; aprovada trava datas e fornecedor; tudo vazio numa tentativa gravada = DELETE (volta a virtual).
// ════════════════════════════════════════════════════════════════════════════════════════════════
/** Tentativa como a seção a vê. `id: null` = virtual ou ainda não salva; `empresa_id` = fornecedor CONGELADO na decisão (null até decidir). */
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
};
/** Trilha = linha de M.O. cujo tipo exige peça teste. `empresa_id`/`empresa_nome` = fornecedor da LINHA (o que a tela mostra). */
export type TrilhaPT = {
  mo_linha_id: string;
  categoria_id: string;
  categoria_nome: string;
  empresa_id: string | null;
  empresa_nome: string | null;
  mo_aprovado: boolean | null;
  tentativas: TentativaPT[];
};
/** Serviço da M.O. cujo tipo NÃO exige peça teste (rodapé "não aparece aqui"). Nunca traz valor. */
export type OutroPT = { categoria_nome: string; empresa_nome: string | null };
export type EstadoPT = { trilhas: TrilhaPT[]; outros: OutroPT[] };

export type StatusTrilhaPT = "aguardando_saida" | "em_teste" | "aprovada" | "reprovada_nova";
export const ROTULO_STATUS_TRILHA: Record<StatusTrilhaPT, string> = {
  aguardando_saida: "Aguardando saída",
  em_teste: "Em teste",
  aprovada: "Aprovada",
  reprovada_nova: "Reprovada — nova tentativa",
};

const vazio = (v: string | null | undefined): string | null => (v ? v : null);

/** Lê o jsonb de `peca_teste_modelo` (tolerante: null/forma estranha = null). */
export function estadoPTDoServidor(raw: unknown): EstadoPT | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { trilhas?: unknown; outros?: unknown };
  const trilhas = (Array.isArray(r.trilhas) ? r.trilhas : []).map((x: any): TrilhaPT => ({
    mo_linha_id: String(x.mo_linha_id),
    categoria_id: String(x.categoria_id),
    categoria_nome: String(x.categoria_nome ?? "Serviço"),
    empresa_id: x.empresa_id ?? null,
    empresa_nome: x.empresa_nome ?? null,
    mo_aprovado: x.mo_aprovado === true ? true : x.mo_aprovado === false ? false : null,
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
      }))
      .sort((a: TentativaPT, b: TentativaPT) => a.numero - b.numero),
  }));
  const outros = (Array.isArray(r.outros) ? r.outros : []).map((o: any): OutroPT => ({
    categoria_nome: String(o.categoria_nome ?? "Serviço"),
    empresa_nome: o.empresa_nome ?? null,
  }));
  return { trilhas, outros };
}

function ordenadas(t: Pick<TrilhaPT, "tentativas">): TentativaPT[] {
  return [...t.tentativas].sort((a, b) => a.numero - b.numero);
}

/** Tentativa virtual: ainda não existe no banco (a 1ª nasce com o serviço e o fornecedor da linha; a seguinte a uma reprovada idem). */
export function tentativaVirtual(numero: number): TentativaPT {
  return { id: null, numero, empresa_id: null, empresa_nome: null, data_saida: null, data_entrada: null, aprovacao: null, decidido_em: null, rev: 0 };
}

/** A tentativa ATUAL da trilha COM virtual: a última, se não está reprovada; senão a virtual de número max+1 (1 sem nenhuma).
 *  (`tentativaAtual`, acima, é a do REQUISITO — só a de maior número, sem virtual; os nomes ficam separados de propósito.) */
export function tentativaAtualPT(t: Pick<TrilhaPT, "tentativas">): TentativaPT {
  const ord = ordenadas(t);
  const ult = ord[ord.length - 1];
  if (!ult) return tentativaVirtual(1);
  return ult.aprovacao === "reprovado" ? tentativaVirtual(ult.numero + 1) : ult;
}

/** Tentativas anteriores (reprovadas), da mais antiga para a mais nova. Só leitura. */
export function historico(t: Pick<TrilhaPT, "tentativas">): TentativaPT[] {
  return ordenadas(t).filter((x) => x.aprovacao === "reprovado");
}

/** Status da trilha (rótulos do mockup). Reprovada com a próxima ainda sem Data de saída = "Reprovada — nova tentativa". */
export function statusTrilha(t: Pick<TrilhaPT, "tentativas">): StatusTrilhaPT {
  const at = tentativaAtualPT(t);
  if (at.aprovacao === "aprovado") return "aprovada";
  if (!at.data_saida) {
    const ord = ordenadas(t);
    return ord.length > 0 && ord[ord.length - 1].aprovacao === "reprovado" ? "reprovada_nova" : "aguardando_saida";
  }
  return "em_teste";
}

/** Só decide (Aprovado/Reprovado) com Data de saída E Data de entrada. */
export function podeDecidir(at: Pick<TentativaPT, "data_saida" | "data_entrada">): boolean {
  return !!at.data_saida && !!at.data_entrada;
}

export type MotivoSemDecisao = "sem_datas" | "sem_fornecedor" | "fornecedor_nao_salvo";
/** Por que a Aprovação está desabilitada (null = pode decidir). O servidor recusa decisão sem as 2 datas e com a linha SEM fornecedor
 *  gravado (`peca_teste_sem_fornecedor`): `fornecedorBase` = o da linha como está no SERVIDOR; `fornecedorEfetivo` = o do rascunho. */
export function motivoSemDecisao(
  at: Pick<TentativaPT, "data_saida" | "data_entrada">,
  fornecedorBase: string | null,
  fornecedorEfetivo: string | null,
): MotivoSemDecisao | null {
  if (!podeDecidir(at)) return "sem_datas";
  if (!fornecedorBase) return fornecedorEfetivo ? "fornecedor_nao_salvo" : "sem_fornecedor";
  return null;
}
export const TEXTO_SEM_DATAS = "Preencha a Data de saída e a Data de entrada para decidir.";
export const TEXTO_SEM_FORNECEDOR = "Defina o fornecedor da M.O. antes.";
export const TEXTO_FORNECEDOR_NAO_SALVO = "Salve o card com o fornecedor antes de decidir.";
export const TEXTO_APROVAR_COM_TROCA = "Salve a troca de fornecedor antes de aprovar.";
export function textoMotivoSemDecisao(m: MotivoSemDecisao): string {
  return m === "sem_datas" ? TEXTO_SEM_DATAS : m === "sem_fornecedor" ? TEXTO_SEM_FORNECEDOR : TEXTO_FORNECEDOR_NAO_SALVO;
}

/** O fornecedor do rascunho difere do SALVO (a troca grava na MESMA linha da M.O., que volta a pendente). */
export function fornecedorMudou(t: Pick<TrilhaPT, "empresa_id">, base: Pick<TrilhaPT, "empresa_id"> | undefined): boolean {
  return !!base && (t.empresa_id ?? null) !== (base.empresa_id ?? null);
}

/** Dica âmbar NÃO bloqueante (Ruling 24): Data de entrada anterior à Data de saída (ISO compara como texto). */
export function entradaAntesDaSaida(at: Pick<TentativaPT, "data_saida" | "data_entrada">): boolean {
  return !!at.data_saida && !!at.data_entrada && at.data_entrada < at.data_saida;
}

const SEM_CAMPOS = (a: Pick<TentativaPT, "data_saida" | "data_entrada" | "aprovacao">) => !a.data_saida && !a.data_entrada && !a.aprovacao;

/** Troca a trilha por uma cópia com a tentativa ATUAL editada. Virtual que ganha dado entra na lista; local nova (sem id) que volta a ficar
 *  vazia sai; a GRAVADA que fica vazia continua (o Salvar a apaga — volta a virtual). Reprovada nunca é editada. */
export function editarAtual(
  t: TrilhaPT,
  patch: Partial<Pick<TentativaPT, "data_saida" | "data_entrada" | "aprovacao" | "empresa_id" | "empresa_nome">>,
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

/** Aprovado: congela o fornecedor da linha SALVA (o servidor faz o mesmo). */
export function aprovar(t: TrilhaPT, fornecedorBase: { id: string | null; nome: string | null }): TrilhaPT {
  return editarAtual(t, { aprovacao: "aprovado", empresa_id: fornecedorBase.id, empresa_nome: fornecedorBase.nome });
}
/** Desfaz a aprovação (volta a "Selecione…"): a tentativa deixa de ter fornecedor congelado. */
export function desfazerDecisao(t: TrilhaPT): TrilhaPT {
  return editarAtual(t, { aprovacao: null, empresa_id: null, empresa_nome: null });
}
/** Reprovado: a atual vai para o histórico com o fornecedor CONGELADO (o da linha salva) e nasce a virtual seguinte
 *  (mesmo serviço e fornecedor da linha, datas vazias — `tentativaAtualPT` a devolve). */
export function reprovar(t: TrilhaPT, fornecedorCongelado: { id: string | null; nome: string | null }): TrilhaPT {
  const at = tentativaAtualPT(t);
  if (at.aprovacao === "reprovado") return t;
  const novo: TentativaPT = { ...at, aprovacao: "reprovado", empresa_id: fornecedorCongelado.id, empresa_nome: fornecedorCongelado.nome };
  const naLista = t.tentativas.some((x) => x.numero === at.numero);
  return { ...t, tentativas: naLista ? t.tentativas.map((x) => (x.numero === at.numero ? novo : x)) : [...t.tentativas, novo] };
}

/** Resumo do requisito do kanban para a tela, antes de salvar. `fornecedores` = fornecedor EFETIVO por linha (rascunho);
 *  `moAprovado` = estado da M.O. por linha quando difere do da trilha (linha decidida cujo fornecedor mudou volta a pendente). */
export type FaltaPT = { mo_linha_id: string; servico: string; motivo: "peça teste" | "M.O. pendente" | "peça teste e M.O." };
export type RequisitoPT = { exigem: number; aprovadas: number; ok: boolean; faltas: FaltaPT[] };
export function requisitoLocal(
  trilhas: readonly TrilhaPT[],
  fornecedores: Readonly<Record<string, string | null>>,
  moAprovado: Readonly<Record<string, boolean | null>> = {},
): RequisitoPT {
  const linhaDe = (t: TrilhaPT): LinhaRequisito => ({
    categoria_id: t.categoria_id,
    exige: true,
    mo_aprovado: t.mo_linha_id in moAprovado ? moAprovado[t.mo_linha_id] : t.mo_aprovado,
    empresa_id: t.mo_linha_id in fornecedores ? fornecedores[t.mo_linha_id] : t.empresa_id,
    tentativas: t.tentativas.map((x) => ({ categoria_id: t.categoria_id, numero: x.numero, aprovacao: x.aprovacao, empresa_id: x.empresa_id })),
  });
  const faltas: FaltaPT[] = [];
  let aprovadas = 0;
  for (const t of trilhas) {
    const l = linhaDe(t);
    const peca = pecaTesteAprovadaTrilha(l);
    const mo = l.mo_aprovado === true;
    if (peca) aprovadas++;
    if (!(peca && mo)) faltas.push({ mo_linha_id: t.mo_linha_id, servico: t.categoria_nome, motivo: !peca && !mo ? "peça teste e M.O." : !peca ? "peça teste" : "M.O. pendente" });
  }
  return { exigem: trilhas.length, aprovadas, ok: pecaTesteAprovadaModelo(trilhas.map(linhaDe)), faltas };
}

/** O requisito do estado EFETIVO da tela (rascunho): fornecedor efetivo por linha; M.O. decidida cujo fornecedor mudou volta a pendente. */
export function requisitoDoEstado(estado: EstadoPT, base: EstadoPT | null | undefined): RequisitoPT {
  const baseDe = (linha: string) => base?.trilhas.find((t) => t.mo_linha_id === linha);
  return requisitoLocal(
    estado.trilhas,
    Object.fromEntries(estado.trilhas.map((t) => [t.mo_linha_id, t.empresa_id])),
    Object.fromEntries(estado.trilhas.map((t) => [t.mo_linha_id, fornecedorMudou(t, baseDe(t.mo_linha_id)) && t.mo_aprovado !== null ? null : t.mo_aprovado])),
  );
}

/** `{ _trilhas, _rev_base }` de `salvar_peca_teste` SÓ com o que mudou (delta). `draft` já traz o fornecedor EFETIVO (ou passe
 *  `fornecedorEfetivo` por linha). Fornecedor só vai se ≠ da base; toda tentativa existente que muda leva o `rev` da base; toda
 *  decisão e toda troca de fornecedor levam `_rev_base.fornecedor[linha]` (o fornecedor que a pessoa VIU). */
export type PayloadPT = {
  _trilhas: {
    mo_linha_id: string;
    categoria_id: string;
    empresa_id?: string | null;
    tentativas: { id: string | null; numero: number; data_saida: string | null; data_entrada: string | null; aprovacao: AprovacaoPecaTeste }[];
  }[];
  _rev_base: { tentativas: Record<string, number>; fornecedor: Record<string, string | null> };
};
export function payloadPecaTeste(
  draft: EstadoPT,
  base: EstadoPT,
  fornecedorEfetivo?: Readonly<Record<string, string | null>>,
  /** Linhas cujo TIPO mudou no rascunho da M.O. (a trilha atual é do tipo antigo): NADA delas vai (nem datas, nem decisão, nem fornecedor). */
  ignorar?: ReadonlySet<string>,
): PayloadPT {
  const out: PayloadPT = { _trilhas: [], _rev_base: { tentativas: {}, fornecedor: {} } };
  for (const dt of draft.trilhas) {
    if (ignorar?.has(dt.mo_linha_id)) continue;
    const bt = base.trilhas.find((x) => x.mo_linha_id === dt.mo_linha_id && x.categoria_id === dt.categoria_id);
    if (!bt) continue; // trilha que o servidor ainda não tem (ou de outro tipo): nada a gravar
    const forn = fornecedorEfetivo && dt.mo_linha_id in fornecedorEfetivo ? fornecedorEfetivo[dt.mo_linha_id] : dt.empresa_id;
    const trocou = (forn ?? null) !== (bt.empresa_id ?? null);
    const tentativas: PayloadPT["_trilhas"][number]["tentativas"] = [];
    const revs: Record<string, number> = {};
    let decisao = false;
    for (const a of ordenadas(dt)) {
      const b = a.id ? bt.tentativas.find((x) => x.id === a.id) : undefined;
      if (a.id && !b) continue;
      if (b) {
        const mudou = vazio(a.data_saida) !== vazio(b.data_saida) || vazio(a.data_entrada) !== vazio(b.data_entrada) || (a.aprovacao ?? null) !== (b.aprovacao ?? null);
        if (!mudou) continue;
        revs[a.id as string] = b.rev;
        if (a.aprovacao && a.aprovacao !== b.aprovacao) decisao = true;
      } else {
        if (SEM_CAMPOS(a)) continue;
        if (a.aprovacao) decisao = true;
      }
      tentativas.push({ id: a.id, numero: a.numero, data_saida: vazio(a.data_saida), data_entrada: vazio(a.data_entrada), aprovacao: a.aprovacao ?? null });
    }
    if (tentativas.length === 0 && !trocou) continue;
    out._trilhas.push({ mo_linha_id: dt.mo_linha_id, categoria_id: dt.categoria_id, ...(trocou ? { empresa_id: forn ?? null } : {}), tentativas });
    Object.assign(out._rev_base.tentativas, revs);
    if (decisao || trocou) out._rev_base.fornecedor[dt.mo_linha_id] = bt.empresa_id ?? null;
  }
  return out;
}

/** "Não salvo" da seção: o delta contra a base não é vazio. */
export function ptDirty(draft: EstadoPT, base: EstadoPT, fornecedorEfetivo?: Readonly<Record<string, string | null>>, ignorar?: ReadonlySet<string>): boolean {
  return payloadPecaTeste(draft, base, fornecedorEfetivo, ignorar)._trilhas.length > 0;
}

// ───────────────────────── merge 3 vias (base / meu / dele) ─────────────────────────
export type ResultadoMergePT = { valor: EstadoPT; conflitos: Conflito[]; atualizados: number };
export const CAMPOS_TENTATIVA_PT = ["data_saida", "data_entrada", "aprovacao"] as const;
type CampoTentativaPT = (typeof CAMPOS_TENTATIVA_PT)[number];

/** `pt:<linha>:<campo>` (tentativa ATUAL e `fornecedor`); campo de outra tentativa = `pt:<linha>:t<n>:<campo>`. */
export function pathPT(linha: string, campo: string, numero?: number | null): string {
  return numero == null ? `pt:${linha}:${campo}` : `pt:${linha}:t${numero}:${campo}`;
}
export function lerPathPT(path: string): { linha: string; campo: string; numero: number | null } | null {
  const m = /^pt:([^:]+):(?:t(\d+):)?([a-z_]+)$/.exec(path);
  return m ? { linha: m[1], campo: m[3], numero: m[2] ? Number(m[2]) : null } : null;
}

function dataBR(iso: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
}
function rotuloCampo(campo: CampoTentativaPT, v: string | null): string {
  if (campo === "aprovacao") return v === "aprovado" ? "Aprovado" : v === "reprovado" ? "Reprovado" : "—";
  return dataBR(v);
}

export function mergePecaTeste(base: EstadoPT, meu: EstadoPT, dele: EstadoPT): ResultadoMergePT {
  const conflitos: Conflito[] = [];
  let atualizados = 0;
  const trilhas: TrilhaPT[] = [];
  for (const d of dele.trilhas) {
    const m = meu.trilhas.find((x) => x.mo_linha_id === d.mo_linha_id);
    // a trilha é (linha, TIPO): se o tipo da linha mudou (por mim ou por outra pessoa) a do servidor é uma trilha NOVA — nada do tipo antigo
    // (datas, decisão) migra para o tipo novo (Ruling 4: as tentativas do tipo antigo ficam escondidas)
    if (!m || m.categoria_id !== d.categoria_id) { trilhas.push(d); continue; }
    const b = base.trilhas.find((x) => x.mo_linha_id === d.mo_linha_id && x.categoria_id === d.categoria_id);
    // — fornecedor da linha
    const bf = b?.empresa_id ?? null, mf = m.empresa_id ?? null, df = d.empresa_id ?? null;
    let emp = { id: d.empresa_id, nome: d.empresa_nome };
    if (mf === bf) { if (df !== mf) atualizados++; }
    else if (df === bf || mf === df) emp = { id: m.empresa_id, nome: m.empresa_nome ?? d.empresa_nome };
    else { conflitos.push({ path: pathPT(d.mo_linha_id, "fornecedor"), meu: m.empresa_nome ?? "—", dele: d.empresa_nome ?? "—" }); emp = { id: m.empresa_id, nome: m.empresa_nome }; }
    // só conta como troca DELE se não foi a minha (df === mf: a troca veio do meu editor da M.O. — o conflito seria falso)
    const dele_trocou_fornecedor = df !== bf && df !== mf;
    // — tentativas, por número
    const atualM = tentativaAtualPT(m).numero;
    const nums = [...new Set([...(b?.tentativas ?? []), ...m.tentativas, ...d.tentativas].map((x) => x.numero))].sort((x, y) => x - y);
    const tentativas: TentativaPT[] = [];
    for (const n of nums) {
      const bt = b?.tentativas.find((x) => x.numero === n);
      const mt = m.tentativas.find((x) => x.numero === n);
      const dt = d.tentativas.find((x) => x.numero === n);
      if (!mt) { if (dt) { tentativas.push(dt); atualizados++; } continue; }
      if (!dt) {
        if (bt) { // ele a apagou (voltou a virtual): sem edição minha ela some; com edição minha sobrevive como NOVA
          if (CAMPOS_TENTATIVA_PT.every((c) => vazio(mt[c] as string | null) === vazio(bt[c] as string | null))) { atualizados++; continue; }
          tentativas.push({ ...mt, id: null, rev: 0 });
        } else tentativas.push(mt);
        continue;
      }
      const bb: TentativaPT = bt ?? tentativaVirtual(n);
      const merged: TentativaPT = { ...dt };
      let conflitoAprovacao = false;
      const numPath = n === atualM ? null : n;
      for (const campo of CAMPOS_TENTATIVA_PT) {
        const mv = vazio(mt[campo] as string | null), bv = vazio(bb[campo] as string | null), dv = vazio(dt[campo] as string | null);
        let val: string | null;
        if (mv === bv) { val = dv; if (dv !== mv) atualizados++; }
        else if (dv === bv || mv === dv) val = mv;
        else {
          val = mv;
          conflitos.push({ path: pathPT(d.mo_linha_id, campo, numPath), meu: rotuloCampo(campo, mv), dele: rotuloCampo(campo, dv) });
          if (campo === "aprovacao") conflitoAprovacao = true;
        }
        (merged as Record<string, unknown>)[campo] = val;
      }
      // minha DECISÃO (Aprovado/Reprovado) vale (não é a mesma dele) e foi tomada vendo o fornecedor da BASE: se ele o trocou no meio,
      // quem decidiu confirma (manter o meu = decidir para o fornecedor novo, sabendo; usar o novo = descartar a decisão)
      const minhaDecisaoVale = merged.aprovacao !== null && merged.aprovacao === vazio(mt.aprovacao) && merged.aprovacao !== vazio(bb.aprovacao) && merged.aprovacao !== dt.aprovacao;
      if (minhaDecisaoVale) {
        if (dele_trocou_fornecedor && !conflitoAprovacao) {
          conflitos.push({ path: pathPT(d.mo_linha_id, "aprovacao", numPath), meu: rotuloCampo("aprovacao", mt.aprovacao), dele: `fornecedor passou a ser ${d.empresa_nome ?? "nenhum"}` });
        }
        // o servidor vai congelar o fornecedor da linha de AGORA (a base nova)
        merged.empresa_id = d.empresa_id; merged.empresa_nome = d.empresa_nome; merged.decidido_em = null;
      }
      tentativas.push(merged);
    }
    trilhas.push({ ...d, empresa_id: emp.id, empresa_nome: emp.nome, tentativas });
  }
  return { valor: { trilhas, outros: dele.outros }, conflitos, atualizados };
}

/** "Usar o novo" de um conflito: o campo do rascunho passa a valer o do servidor (`fresh`). Devolve também o fornecedor, para a tela
 *  espelhar na linha da M.O. quando o campo é o `fornecedor`. */
export function aplicarCampoDele(draft: EstadoPT, fresh: EstadoPT, path: string): { valor: EstadoPT; fornecedor: { linhaId: string; empresaId: string | null; empresaNome: string | null } | null } {
  const p = lerPathPT(path);
  if (!p) return { valor: draft, fornecedor: null };
  const f = fresh.trilhas.find((x) => x.mo_linha_id === p.linha);
  const trilhas = draft.trilhas.map((t) => {
    if (t.mo_linha_id !== p.linha || !f) return t;
    if (p.campo === "fornecedor") return { ...t, empresa_id: f.empresa_id, empresa_nome: f.empresa_nome };
    const n = p.numero ?? tentativaAtualPT(t).numero;
    const ft = f.tentativas.find((x) => x.numero === n);
    const campo = p.campo as CampoTentativaPT;
    if (!CAMPOS_TENTATIVA_PT.includes(campo)) return t;
    const lista = t.tentativas.map((x) => {
      if (x.numero !== n) return x;
      const novo: TentativaPT = { ...x, [campo]: ft ? ft[campo] : null };
      if (campo === "aprovacao") { novo.empresa_id = ft?.empresa_id ?? null; novo.empresa_nome = ft?.empresa_nome ?? null; novo.decidido_em = ft?.decidido_em ?? null; }
      return novo;
    });
    return { ...t, tentativas: lista };
  });
  const fornecedor = p.campo === "fornecedor" && f ? { linhaId: p.linha, empresaId: f.empresa_id, empresaNome: f.empresa_nome } : null;
  return { valor: { ...draft, trilhas }, fornecedor };
}
