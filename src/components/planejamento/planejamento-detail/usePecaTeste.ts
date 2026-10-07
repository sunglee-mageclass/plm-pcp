// Peça Teste (R9, T6) — estado da seção "Peça Teste" do Sheet do Planejamento e a API que o Salvar do card chama.
//
// Fonte da verdade = RPC `peca_teste_modelo` (193000). Nada grava antes do Salvar (regra "nada grava antes do Salvar"): a seção edita um
// RASCUNHO (`draft`) contra uma BASE (`base` = o que o servidor tinha na última leitura); o `usePlanejamentoSave` chama
// `pecaTesteSave.capturar()` (síncrono, junto da captura da M.O.) e, DEPOIS da M.O., `salvar(captura)` -> `salvar_peca_teste` com
// `_rev_base`. Colaboração: rev por tentativa + P0409 -> relê, `mergePecaTeste` 3 vias; sem conflito re-tenta 1x sozinho; com conflito
// devolve `{ conflito }` (NUNCA lança P0409: o resto do card já gravou).
//
// Fornecedor ÚNICO (Ruling 9): quem trocou o fornecedor na M.O. (linha editável e visível) vale como o efetivo da trilha — `fornecedorMo`
// traz SÓ as linhas cujo fornecedor o usuário mudou no editor da M.O. (≠ da base dela); as demais usam o do rascunho da seção.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import type { Conflito } from "@/lib/colab/merge";
import {
  aplicarCampoDele, aprovar as aprovarTrilha, chaveConfere, desfazerDecisao, editarAtual as editarAtualTrilha, estadoPTDoServidor,
  estornosPendentes as estornosDoEstado, mergePecaTeste, payloadPecaTeste, ptDirty, reprovar as reprovarTrilha, tentativaAtualPT,
  type EstadoPT, type OpcoesPayloadPT, type PayloadPT, type TentativaPT, type TrilhaPT,
} from "@/lib/peca-teste";
import { acaoNoSalvar, confereDasLinhas, miniVazia, resumoPosSalvar, type MiniPT } from "@/lib/peca-teste-mini";
import type { MiniApi } from "@/components/planejamento/planejamento-detail/useMiniExplosao";
import type { PedidoConfirmacao } from "@/components/shared/ConfirmarAcaoDialog";
import { textoEstornarERefazerPecaTeste, textoEstornarPecaTeste } from "@/lib/confirmacoes-textos";

export const PERM_PECA_TESTE = "criacao_planejamento:peca_teste";

/** O que o Salvar do card guarda entre a captura e a gravação. `enviado` = o estado EFETIVO que foi para o servidor; `antes` = a base (o que o
 *  servidor tinha) na hora da captura — o resumo pós-Salvar (toasts de baixa/estorno/falta) compara com a releitura. */
export type CapturaPT = { payload: PayloadPT; enviado: EstadoPT; antes?: EstadoPT };
export type ResultadoSalvarPT = { ok: true } | { conflito: Conflito[] } | { erro: unknown };

/** Contrato com o `usePlanejamentoSave`. Inerte (`PECA_TESTE_INERTE`) quando a seção não existe: o Salvar fica idêntico ao de antes. */
export type PecaTesteSave = {
  /** Há algo da Peça Teste a gravar? */
  dirty(): boolean;
  /** Quantos conflitos de seção pendentes (o Salvar do card recusa enquanto houver, como nos outros conflitos). */
  conflitos(): number;
  /** R11 — "<serviço> · tentativa N" das tentativas cujo Salvar vai ESTORNAR a baixa da mini (o clique do Salvar pede confirmação). */
  estornosPendentes(): string[];
  /** R11 — algum desses estornos REFAZ a baixa no mesmo Salvar (P-365 A): o diálogo usa o texto "estornar e fazer de novo". */
  estornoRefazBaixa(): boolean;
  /** SÍNCRONO. null = nada a gravar (ou sem permissão de editar). */
  capturar(): CapturaPT | null;
  /** Grava (RPC). Nunca lança. */
  salvar(c: CapturaPT): Promise<ResultadoSalvarPT>;
  /** Re-baseia a seção no que foi gravado (SÓ chamar quando `salvar` devolveu `{ ok: true }`). */
  aposSalvar(c: CapturaPT): void;
};
export const PECA_TESTE_INERTE: PecaTesteSave = {
  dirty: () => false,
  conflitos: () => 0,
  estornosPendentes: () => [],
  estornoRefazBaixa: () => false,
  capturar: () => null,
  salvar: async () => ({ ok: true }),
  aposSalvar: () => {},
};

export type FornecedorMo = { id: string | null; nome: string | null };

/**
 * Clique do Salvar do card (R11, P-365 A): se o Salvar vai ESTORNAR a baixa de estoque de alguma mini (Data de saída apagada, ou mini mudada com a
 * data = estorna e refaz), pergunta ANTES de enviar qualquer coisa — Cancelar = nada é enviado; Confirmar = o Salvar normal, 1×. Sem estorno,
 * salva direto.
 */
export function salvarComConfirmacaoEstorno(
  pt: Pick<PecaTesteSave, "estornosPendentes" | "estornoRefazBaixa">,
  pedir: (p: PedidoConfirmacao) => void,
  salvar: () => void,
): void {
  const itens = pt.estornosPendentes();
  if (itens.length === 0) { salvar(); return; }
  pedir({ ...(pt.estornoRefazBaixa() ? textoEstornarERefazerPecaTeste(itens) : textoEstornarPecaTeste(itens)), onConfirmar: () => salvar() });
}

function codigoDoErro(e: unknown): string | null {
  return e && typeof e === "object" && "code" in e ? String((e as { code?: unknown }).code ?? "") : null;
}

/** Aplica o fornecedor que a pessoa mudou no editor da M.O. por cima do rascunho da seção (só nas linhas informadas). */
export function comFornecedoresDaMo(e: EstadoPT, mo: Readonly<Record<string, FornecedorMo>> | null | undefined): EstadoPT {
  if (!mo) return e;
  let mudou = false;
  const trilhas = e.trilhas.map((t) => {
    const f = mo[t.mo_linha_id];
    if (!f || ((f.id ?? null) === (t.empresa_id ?? null))) return t;
    mudou = true;
    return { ...t, empresa_id: f.id, empresa_nome: f.nome ?? t.empresa_nome };
  });
  return mudou ? { ...e, trilhas } : e;
}

export function usePecaTeste({ modeloId, habilitado, podeEditar, fornecedorMo, linhasIgnoradas, mini }: {
  modeloId: string | null;
  /** Card salvo e seção aplicável (o Sheet de card novo não tem a seção). */
  habilitado: boolean;
  /** `canEdit("criacao_planejamento:peca_teste")`. */
  podeEditar: boolean;
  /** Linhas cujo fornecedor foi trocado NO EDITOR DA M.O. (linha -> novo fornecedor). null = o editor da M.O. não está visível/editável. */
  fornecedorMo?: Readonly<Record<string, FornecedorMo>> | null;
  /** Linhas cujo TIPO mudou no rascunho da M.O.: a trilha da tela é do tipo antigo — nada dela é capturado/gravado (nem conta como "não salvo"). */
  linhasIgnoradas?: ReadonlySet<string> | null;
  /** R11 — a mini explosão (cálculo ao vivo): dá o `confere` e o `semTecido1` do payload. Ausente = a seção como na R9. */
  mini?: MiniApi | null;
}) {
  const { canView } = useAuth();
  const qc = useQueryClient();
  const podeVer = canView(PERM_PECA_TESTE);
  const ativo = !!modeloId && habilitado && podeVer;

  const lerServidor = useCallback(async (): Promise<EstadoPT | null> => {
    const { data, error } = await supabase.rpc("peca_teste_modelo", { _modelo_id: modeloId as string });
    if (error) throw error;
    return estadoPTDoServidor(data);
  }, [modeloId]);

  const query = useQuery({
    queryKey: ["peca-teste", modeloId],
    enabled: ativo,
    queryFn: lerServidor,
  });

  const [draft, setDraftState] = useState<EstadoPT | null>(null);
  const [base, setBaseState] = useState<EstadoPT | null>(null);
  const [conflitos, setConflitos] = useState<Conflito[]>([]);
  const draftRef = useRef<EstadoPT | null>(null);
  const baseRef = useRef<EstadoPT | null>(null);
  const conflitosRef = useRef<Conflito[]>([]);
  const freshRef = useRef<EstadoPT | null>(null);
  const salvandoRef = useRef(false);
  const enviadoOkRef = useRef<EstadoPT | null>(null);
  const fornecedorMoRef = useRef(fornecedorMo ?? null);
  fornecedorMoRef.current = fornecedorMo ?? null;
  const ignoradasRef = useRef<ReadonlySet<string> | undefined>(linhasIgnoradas ?? undefined);
  ignoradasRef.current = linhasIgnoradas ?? undefined;
  const podeEditarRef = useRef(podeEditar);
  podeEditarRef.current = podeEditar;
  const miniRef = useRef<MiniApi | null>(mini ?? null);
  miniRef.current = mini ?? null;
  const [avisos, setAvisos] = useState<string[]>([]);
  const juntarAvisos = useCallback((novos: string[]) => {
    if (novos.length > 0) setAvisos((prev) => [...prev, ...novos.filter((a) => !prev.includes(a))]);
  }, []);
  /** `semTecido1` (cor só é exigida com Tecido 1) e `confere` = o "a enviar" que a pessoa VIU, por tentativa (o servidor recusa com P0409 se
   *  divergir do dele). Sem a ficha pronta não há `confere` (o servidor usa o próprio cálculo). */
  const opcoesPT = useCallback((ef: EstadoPT): OpcoesPayloadPT => {
    const api = miniRef.current;
    if (!api) return {};
    if (!api.pronta) return { semTecido1: api.semTecido1 };
    const confere: Record<string, Record<string, number>> = {};
    for (const t of ef.trilhas) {
      for (const a of t.tentativas) {
        if (!a.data_saida || !a.mini) continue;
        const calc = api.calcular(a.mini);
        if (calc) confere[chaveConfere(t.mo_linha_id, a.numero)] = confereDasLinhas(calc.linhas);
      }
    }
    return { confere, semTecido1: api.semTecido1 };
  }, []);

  const aplicar = useCallback((d: EstadoPT | null, b: EstadoPT | null) => {
    draftRef.current = d; baseRef.current = b;
    setDraftState(d); setBaseState(b);
  }, []);
  const guardarConflitos = useCallback((fn: (prev: Conflito[]) => Conflito[]) => {
    const next = fn(conflitosRef.current);
    conflitosRef.current = next;
    setConflitos(next);
  }, []);
  const juntar = (prev: Conflito[], novos: Conflito[]) => [...prev, ...novos.filter((c) => !prev.some((p) => p.path === c.path))];

  // Semeia/atualiza com o que chega do servidor: limpo = adota; sujo = merge quieto (o meu fica, o dele entra, conflito vira aviso inline).
  useEffect(() => {
    const data = query.data;
    if (!data) return;
    freshRef.current = data;
    if (salvandoRef.current) return;
    const b = baseRef.current, d = draftRef.current;
    if (!b || !d) { aplicar(data, data); return; }
    if (!ptDirty(d, b, undefined, ignoradasRef.current, opcoesPT(d))) { aplicar(data, data); guardarConflitos(() => []); setAvisos([]); return; }
    const r = mergePecaTeste(b, d, data);
    aplicar(r.valor, data);
    juntarAvisos(r.avisos);
    if (r.conflitos.length > 0) guardarConflitos((prev) => juntar(prev, r.conflitos));
  }, [query.data, aplicar, guardarConflitos, opcoesPT, juntarAvisos]);

  const estado = useMemo(() => (draft ? comFornecedoresDaMo(draft, fornecedorMo) : null), [draft, fornecedorMo]);
  const dirty = !!podeEditar && !!estado && !!base && ptDirty(estado, base, undefined, linhasIgnoradas ?? undefined, { semTecido1: mini?.semTecido1 ?? false });

  // ───────── edição do rascunho ─────────
  const mutar = useCallback((linhaId: string, fn: (t: TrilhaPT) => TrilhaPT) => {
    const d = draftRef.current;
    if (!d) return;
    const novo: EstadoPT = { ...d, trilhas: d.trilhas.map((t) => (t.mo_linha_id === linhaId ? fn(t) : t)) };
    draftRef.current = novo;
    setDraftState(novo);
  }, []);
  const fornecedorBaseDa = (linhaId: string): FornecedorMo => {
    const b = baseRef.current?.trilhas.find((t) => t.mo_linha_id === linhaId);
    return { id: b?.empresa_id ?? null, nome: b?.empresa_nome ?? null };
  };

  const editarAtual = useCallback((linhaId: string, patch: Partial<Pick<TentativaPT, "data_saida" | "data_entrada">>) => {
    mutar(linhaId, (t) => editarAtualTrilha(t, patch));
  }, [mutar]);
  /** "Aprovado" (avançar não pede confirmação). Congela o fornecedor da linha SALVA, como o servidor. */
  const aprovarAtual = useCallback((linhaId: string) => {
    mutar(linhaId, (t) => aprovarTrilha(t, fornecedorBaseDa(linhaId)));
  }, [mutar]);
  /** Volta a Aprovação para "Selecione…" (desfaz a decisão ainda não reprovada). */
  const desfazerAtual = useCallback((linhaId: string) => {
    mutar(linhaId, (t) => desfazerDecisao(t));
  }, [mutar]);
  /** "Reprovado" (já confirmado no diálogo): a atual vai para o histórico e nasce a seguinte. */
  const reprovarAtual = useCallback((linhaId: string) => {
    // R11 — a baixa da tentativa reprovada é MANTIDA (peça gasta): avisa quando há baixa feita ou que o Salvar vai fazer
    const t = draftRef.current?.trilhas.find((x) => x.mo_linha_id === linhaId);
    if (t) {
      const at = tentativaAtualPT(t);
      const b = baseRef.current?.trilhas.find((x) => x.mo_linha_id === linhaId)?.tentativas.find((x) => x.numero === at.numero) ?? null;
      const baixa = !!b?.mini?.baixa_em || acaoNoSalvar(at, b, { semTecido1: miniRef.current?.semTecido1 ?? false }) === "baixa";
      if (baixa) toast.warning(`Tentativa ${at.numero} reprovada. Nasceu a tentativa ${at.numero + 1}. A baixa da tentativa ${at.numero} é mantida (peça gasta). Salve o card para gravar.`);
    }
    mutar(linhaId, (x) => reprovarTrilha(x, fornecedorBaseDa(linhaId)));
  }, [mutar]);
  /** Edita a mini explosão da tentativa ATUAL (trocar tamanho/cor, ajustes, "mesma OC"). `miniVazia` volta a ser "sem mini". */
  const editarMini = useCallback((linhaId: string, novaMini: MiniPT) => {
    mutar(linhaId, (t) => editarAtualTrilha(t, { mini: miniVazia(novaMini) ? null : novaMini }));
  }, [mutar]);
  const trocarFornecedor = useCallback((linhaId: string, empresaId: string | null, empresaNome: string | null) => {
    mutar(linhaId, (t) => ({ ...t, empresa_id: empresaId, empresa_nome: empresaNome }));
  }, [mutar]);

  /** "Manter o meu" fecha o aviso; "Usar o novo" aplica o valor do servidor no campo. Devolve o fornecedor quando o campo era ele. */
  const resolverConflito = useCallback((path: string, escolha: "meu" | "dele") => {
    let fornecedor: { linhaId: string; empresaId: string | null; empresaNome: string | null } | null = null;
    if (escolha === "dele" && draftRef.current && freshRef.current) {
      const r = aplicarCampoDele(draftRef.current, freshRef.current, path);
      draftRef.current = r.valor;
      setDraftState(r.valor);
      fornecedor = r.fornecedor;
    }
    guardarConflitos((prev) => prev.filter((c) => c.path !== path));
    return fornecedor;
  }, [guardarConflitos]);

  // ───────── Salvar do card ─────────
  const capturar = useCallback((): CapturaPT | null => {
    if (!podeEditarRef.current) return null;
    const d = draftRef.current, b = baseRef.current;
    if (!d || !b) return null;
    const ef = comFornecedoresDaMo(d, fornecedorMoRef.current);
    const payload = payloadPecaTeste(ef, b, undefined, ignoradasRef.current, opcoesPT(ef));
    if (payload._trilhas.length === 0) return null;
    // P-57: sem a ficha hidratada a mini NÃO é capturada (o "a enviar" que a pessoa viu não existe) — recusa em vez de gravar às cegas.
    const api = miniRef.current;
    if (api?.ativo && !api.fichaIndisponivel && !api.pronta && payload._trilhas.some((t) => t.tentativas.some((x) => x.mini))) {
      throw new Error("A ficha do card ainda está carregando — aguarde um instante e salve de novo.");
    }
    return { payload, enviado: ef, antes: b };
  }, [opcoesPT]);

  const chamar = async (p: PayloadPT): Promise<unknown | null> => {
    const { error } = await supabase.rpc("salvar_peca_teste", {
      _modelo_id: modeloId as string,
      _trilhas: p._trilhas as never,
      _rev_base: p._rev_base as never,
    });
    return error ?? null;
  };

  const salvar = useCallback(async (c: CapturaPT): Promise<ResultadoSalvarPT> => {
    salvandoRef.current = true;
    try {
      let cap: CapturaPT = c;
      for (let tentativa = 0; tentativa < 2; tentativa++) {
        const erro = await chamar(cap.payload);
        if (!erro) { enviadoOkRef.current = cap.enviado; return { ok: true }; }
        if (codigoDoErro(erro) !== "P0409") return { erro };
        // P0409 (alguém salvou no meio, ou a M.O. mudou de tipo): relê e mescla 3 vias
        const fresh = await qc.fetchQuery({ queryKey: ["peca-teste", modeloId], queryFn: lerServidor, staleTime: 0 });
        if (!fresh || !baseRef.current || !draftRef.current) return { erro };
        freshRef.current = fresh;
        const meu = comFornecedoresDaMo(draftRef.current, fornecedorMoRef.current);
        const m = mergePecaTeste(baseRef.current, meu, fresh);
        aplicar(m.valor, fresh);
        juntarAvisos(m.avisos);
        if (m.conflitos.length > 0) {
          guardarConflitos((prev) => juntar(prev, m.conflitos));
          return { conflito: m.conflitos };
        }
        if (tentativa === 1) return { conflito: [] };
        const nova = capturar();
        if (!nova) { enviadoOkRef.current = fresh; return { ok: true }; } // o servidor já tem tudo o que eu ia mandar
        cap = nova;
      }
      return { conflito: [] };
    } catch (e) {
      return { erro: e };
    } finally {
      salvandoRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modeloId, qc, lerServidor, aplicar, guardarConflitos, capturar, juntarAvisos]);

  const aposSalvar = useCallback((c: CapturaPT) => {
    // a base passa a ser o que FOI enviado (edição feita durante o voo segue "não salva"); a releitura (invalidação do Salvar) traz ids e revs novos
    const enviado = enviadoOkRef.current ?? c.enviado;
    baseRef.current = enviado;
    setBaseState(enviado);
    // o fornecedor trocado no editor da M.O. passa a ser o do rascunho (o Salvar do card re-baseia a M.O. no mesmo tick e o mapa some)
    if (draftRef.current && fornecedorMoRef.current) {
      const d = comFornecedoresDaMo(draftRef.current, fornecedorMoRef.current);
      draftRef.current = d;
      setDraftState(d);
    }
    guardarConflitos(() => []);
    setAvisos([]);
    // R11 — relê e compara com o ANTES: toasts do que o Salvar fez no estoque (baixa, estorno, falta registrada, falta tamanho/cor)
    if (c.antes && miniRef.current?.ativo) {
      const antes = c.antes;
      void (async () => {
        try {
          const depois = await qc.fetchQuery({ queryKey: ["peca-teste", modeloId], queryFn: lerServidor, staleTime: 0 });
          if (!depois) return;
          const r = resumoPosSalvar(antes.trilhas, depois.trilhas, { semTecido1: miniRef.current?.semTecido1 ?? false });
          if (r.baixas.length) toast.success(`Baixa de estoque feita pelo “a enviar”: ${r.baixas.join("; ")}.`);
          if (r.estornos.length) toast.warning(`Baixa estornada (o “a enviar” voltou ao estoque): ${r.estornos.join("; ")}.`);
          if (r.faltas.length) toast.warning(`Salvo mesmo faltando estoque — falta registrada: ${r.faltas.join("; ")}.`);
          if (r.semTamanhoCor.length) toast.warning(`Sem tamanho e cor da peça não há baixa: ${r.semTamanhoCor.join("; ")}.`);
        } catch { /* só aviso: a seção já foi re-baseada */ }
      })();
    }
  }, [guardarConflitos, qc, modeloId, lerServidor]);

  const pecaTesteSave: PecaTesteSave = useMemo(() => ({
    dirty: () => {
      if (!podeEditarRef.current) return false;
      const d = draftRef.current, b = baseRef.current;
      return !!d && !!b && ptDirty(comFornecedoresDaMo(d, fornecedorMoRef.current), b, undefined, ignoradasRef.current, { semTecido1: miniRef.current?.semTecido1 ?? false });
    },
    conflitos: () => conflitosRef.current.length,
    estornosPendentes: () => {
      const d = draftRef.current, b = baseRef.current;
      if (!podeEditarRef.current || !d || !b) return [];
      return estornosDoEstado(comFornecedoresDaMo(d, fornecedorMoRef.current), b, ignoradasRef.current, { semTecido1: miniRef.current?.semTecido1 ?? false })
        .map((e) => `${e.servico} · tentativa ${e.numero}`);
    },
    estornoRefazBaixa: () => {
      const d = draftRef.current, b = baseRef.current;
      if (!podeEditarRef.current || !d || !b) return false;
      return estornosDoEstado(comFornecedoresDaMo(d, fornecedorMoRef.current), b, ignoradasRef.current, { semTecido1: miniRef.current?.semTecido1 ?? false }).some((e) => e.refaz);
    },
    capturar, salvar, aposSalvar,
  }), [capturar, salvar, aposSalvar]);

  return {
    /** A seção se aplica a este usuário/card (permissão + card salvo)? */
    ativo,
    carregando: ativo && query.isLoading,
    erro: ativo && query.isError,
    tentarDeNovo: () => { void query.refetch(); },
    /** Estado EFETIVO (rascunho + fornecedor trocado na M.O.). null enquanto não carregou ou sem permissão. */
    estado,
    base,
    dirty,
    conflitos,
    resolverConflito,
    /** R11 — avisos do merge (baixa/estorno feitos por outra pessoa). */
    avisos,
    editarAtual, aprovarAtual, desfazerAtual, reprovarAtual, trocarFornecedor, editarMini,
    pecaTesteSave,
  };
}
