// Mini explosão (1 peça) da Peça Teste (R11, T6) — dados e cálculo ao vivo que o bloco "Mini explosão" e o Salvar usam.
//
// O BOM de 1 peça sai da FICHA do Sheet (`bomUmaPecaDaFicha`, o mesmo estado que o Salvar grava ANTES da Peça Teste), as linhas por
// `linhasUmaPeca` (espelho da SQL) e o estoque (saldo por OC/rolo, físico de aviamento/insumo) vem de `peca_teste_mini_estoque`. Nada grava
// aqui. Sem a ficha hidratada (P-57) o cálculo devolve `null`: o bloco mostra "Carregando…" e o Salvar NÃO captura a mini.
import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantModules } from "@/hooks/useTenantModules";
import { labelVarianteRow } from "@/lib/variante";
import { tipoDoProduto, tamanhosDoTipo, rotuloTamanho as rotuloTamanhoLado } from "@/lib/distribuicao-produto";
import {
  ajustesParaMapa, bomUmaPecaDaFicha, estoqueMiniDoServidor, faltasPreview, insumosForaDoTamanho, linhasUmaPeca, ordemDaVariante,
  tamanhoVinculadoPorChave, variantesDoTecido1,
  type EstoqueMini, type FaltaPreview, type FichaParaMini, type MiniLinha, type MiniPT,
} from "@/lib/peca-teste-mini";
import type { FichaTecnica } from "@/components/planejamento/planejamento-detail/ficha/useFichaTecnica";

export type OpcaoSelect = { value: string; label: string };
/** Uma OC/rolo de onde o tecido pode sair (item de OC), com o saldo. */
export type FonteOc = { id: string; rotulo: string; saldo: number; is_rolo: boolean };
export type CalculoMini = {
  linhas: MiniLinha[];
  /** As mesmas linhas SEM nenhum ajuste (o calculado do BOM): serve para saber se o digitado difere. */
  padrao: Record<string, MiniLinha>;
  /** Insumos do card vinculados a OUTRO tamanho (não entram nesta peça). */
  fora: number;
  /** chave do insumo -> tamanho a que está vinculado (chip "Só tam. M"). */
  vinculados?: Record<string, string>;
  faltas: FaltaPreview[];
};

/** O que o bloco e o Salvar precisam da mini explosão. `ativo = false` esconde o bloco (loja sem Entrada e Saída / sem ver a seção). */
export type MiniApi = {
  ativo: boolean;
  carregando: boolean;
  /** A 1ª carga do estoque OU das variantes do Tecido 1 falhou (sem dado nenhum): "Não foi possível carregar os dados." + "Tentar de novo". */
  erro: boolean;
  /** Releitura em curso depois de um "Tentar de novo" (o botão vira "Tentando…"). */
  tentando?: boolean;
  tentarDeNovo: () => void;
  /** Sem permissão de ver a ficha do card: o BOM não está disponível (só a foto da baixa aparece). */
  fichaIndisponivel: boolean;
  /** A ficha está hidratada e o cálculo pode rodar (P-57). */
  pronta: boolean;
  semTecido1: boolean;
  tamanhos: OpcaoSelect[];
  cores: OpcaoSelect[];
  /** null = sem tamanho/cor escolhidos OU ficha/estoque ainda não prontos. */
  calcular: (mini: MiniPT | null) => CalculoMini | null;
  fontesTecido: (l: MiniLinha) => { vinculadas: FonteOc[]; todas: FonteOc[] };
  variantesAviamento: (aviamentoId: string | null) => OpcaoSelect[];
  /** Estoque físico da linha (aviamento/insumo); null = não se aplica / não sei. */
  emEstoque: (l: MiniLinha) => number | null;
};

const SEM_IDS: string[] = [];
/** O estoque da mini varre os saldos da loja por linha do BOM (RPC pesada): não refaz a cada foco da janela; o Salvar invalida a chave. */
const STALE_MINI_MS = 30_000;

export function useMiniExplosao({ modeloId, habilitado, ficha, tamanhoTipo }: {
  modeloId: string | null;
  /** Card salvo, permissão de VER a seção E pelo menos um serviço que exige Peça Teste (trilha existente ou por nascer) — sem isso nada é carregado. */
  habilitado: boolean;
  ficha: Pick<FichaTecnica, "habilitada" | "carregado" | "estado" | "dados">;
  tamanhoTipo: string | null | undefined;
}): MiniApi {
  const { isModuleEnabled } = useTenantModules();
  const esLigada = isModuleEnabled("entrada_saida");
  const on = habilitado && !!modeloId && esLigada;

  const qEstoque = useQuery({
    queryKey: ["peca-teste-mini-estoque", modeloId],
    enabled: on,
    retry: 1,
    staleTime: STALE_MINI_MS,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<EstoqueMini | null> => {
      const { data, error } = await supabase.rpc("peca_teste_mini_estoque" as any, { _modelo_id: modeloId as string });
      if (error) throw error;
      return estoqueMiniDoServidor(data);
    },
  });
  const estoque = qEstoque.data ?? null;

  const idsVariantes = useMemo(() => {
    if (!ficha.habilitada) return SEM_IDS;
    const s = new Set<string>();
    for (const b of ficha.estado.blocks) for (const v of b.variantes) if (v) s.add(v);
    return Array.from(s).sort();
  }, [ficha.habilitada, ficha.estado.blocks]);
  const qVariantes = useQuery({
    queryKey: ["peca-teste-mini-variantes", idsVariantes.join(",")],
    enabled: on && ficha.habilitada && idsVariantes.length > 0,
    retry: 1,
    staleTime: STALE_MINI_MS,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("variantes_tecido")
        .select("id, cor_id, nome_variante, codigo_variante, cor:cor_id(nome), apelido:cor_apelido_id(nome)")
        .in("id", idsVariantes);
      if (error) throw error;
      return ((data ?? []) as any[]).map((v) => {
        const l = labelVarianteRow(v);
        return { id: String(v.id), cor_id: (v.cor_id ?? null) as string | null, label: l !== "—" ? l : "" };
      });
    },
  });
  const variantes = useMemo(() => new Map((qVariantes.data ?? []).map((v) => [v.id, v])), [qVariantes.data]);

  // `data !== undefined` (não `isSuccess`): um refetch que falha depois de uma carga boa mantém o último dado e a ficha segue pronta
  const fichaPronta = ficha.habilitada && ficha.carregado && (idsVariantes.length === 0 || qVariantes.data !== undefined);

  const fm: FichaParaMini = useMemo(() => ({
    blocks: ficha.estado.blocks,
    aviamentos: ficha.estado.aviamentos,
    etiquetas: ficha.estado.etiquetas,
    nomeVarianteTecido: (id) => variantes.get(id)?.label || null,
    nomeAviamento: (id) => ficha.dados.aviamentoMap[id]?.codigo_nome ?? null,
    variantesAviamento: (id) => (estoque?.aviamentos.find((a) => a.aviamento_id === id)?.variantes ?? [])
      .flatMap((v) => (v.variante_aviamento_id ? [{ variante_aviamento_id: v.variante_aviamento_id, cor_id: v.cor_id, rotulo: v.rotulo }] : [])),
    etiqueta: (id) => {
      const e = ficha.dados.etiquetaMap[id];
      return e ? { nome: e.nome, formato_tamanho: e.formato_tamanho, tamanho_vinculado: e.tamanho_vinculado ?? null, variantes: (e.variantes ?? []).map((v) => ({ tamanho: v.tamanho ?? null })) } : undefined;
    },
  }), [ficha.estado.blocks, ficha.estado.aviamentos, ficha.estado.etiquetas, ficha.dados.aviamentoMap, ficha.dados.etiquetaMap, variantes, estoque]);

  const cores = useMemo<OpcaoSelect[]>(
    () => variantesDoTecido1(fm).map((v) => ({ value: v.id, label: variantes.get(v.id)?.label || `Cor ${v.ordem}` })),
    [fm, variantes],
  );
  const semTecido1 = fichaPronta && cores.length === 0;

  const tamanhos = useMemo<OpcaoSelect[]>(() => {
    const tipo = tipoDoProduto(tamanhoTipo);
    const lado = tamanhosDoTipo(ficha.dados.tamanhos, tipo);
    const comPecas = lado.filter((t) => ficha.estado.grades.some((g) => Number(g.grades?.[t] ?? 0) > 0));
    return (comPecas.length > 0 ? comPecas : lado).map((t) => ({ value: t, label: rotuloTamanhoLado(t, tipo) }));
  }, [tamanhoTipo, ficha.dados.tamanhos, ficha.estado.grades]);

  const calcular = useCallback((mini: MiniPT | null): CalculoMini | null => {
    if (!fichaPronta || !estoque || !mini || !mini.tamanho) return null;
    if (!semTecido1 && !mini.variante_tecido_id) return null;
    const v = mini.variante_tecido_id;
    const bom = bomUmaPecaDaFicha(fm, v ? variantes.get(v)?.cor_id ?? null : null);
    const ordemN = ordemDaVariante(fm, v);
    const linhas = linhasUmaPeca(bom, mini.tamanho, ordemN, v, ajustesParaMapa(mini));
    const padrao: Record<string, MiniLinha> = {};
    for (const l of linhasUmaPeca(bom, mini.tamanho, ordemN, v, {})) padrao[l.chave] = l;
    return { linhas, padrao, fora: insumosForaDoTamanho(bom, mini.tamanho), vinculados: tamanhoVinculadoPorChave(bom, linhas), faltas: faltasPreview(linhas, estoque, estoque.modo, mini.mesma_oc) };
  }, [fichaPronta, estoque, semTecido1, fm, variantes]);

  const fontesTecido = useCallback((l: MiniLinha) => {
    const t = estoque?.tecidos.find((x) => x.tipo === l.tipo && x.numero === l.numero && x.ordem === l.ordem && x.variante_tecido_id === l.variante_tecido_id);
    const rotulo = (r: string | null, id: string) => r ?? `Item ${id.slice(0, 8)}`;
    const vinculadas: FonteOc[] = [...(t?.vinculos ?? [])]
      .sort((a, b) => a.prioridade - b.prioridade)
      .map((x) => ({ id: x.oc_tecido_item_id, rotulo: rotulo(x.rotulo, x.oc_tecido_item_id), saldo: x.saldo, is_rolo: x.is_rolo }));
    const todas: FonteOc[] = [...vinculadas];
    for (const f of t?.fifo ?? []) {
      if (!todas.some((x) => x.id === f.oc_tecido_item_id)) todas.push({ id: f.oc_tecido_item_id, rotulo: rotulo(f.rotulo, f.oc_tecido_item_id), saldo: f.saldo, is_rolo: f.is_rolo });
    }
    return { vinculadas, todas };
  }, [estoque]);

  const variantesAviamento = useCallback((aviamentoId: string | null): OpcaoSelect[] => {
    if (!aviamentoId) return [];
    return (estoque?.aviamentos.find((a) => a.aviamento_id === aviamentoId)?.variantes ?? [])
      .flatMap((v) => (v.variante_aviamento_id ? [{ value: v.variante_aviamento_id, label: v.rotulo ?? "Variante" }] : []));
  }, [estoque]);

  const emEstoque = useCallback((l: MiniLinha): number | null => {
    if (!estoque) return null;
    if (l.familia === "aviamento") {
      return estoque.aviamentos.find((a) => a.aviamento_id === l.aviamento_id)?.variantes.find((v) => v.variante_aviamento_id === l.variante_aviamento_id)?.fisico ?? null;
    }
    if (l.familia === "insumo") {
      return estoque.insumos.find((i) => i.etiqueta_id === l.etiqueta_id && i.cor_id === l.cor_id && i.tamanho === l.tamanho_bucket)?.fisico ?? null;
    }
    return null;
  }, [estoque]);

  const erro = on && ((qEstoque.isError && qEstoque.data === undefined) || (qVariantes.isError && qVariantes.data === undefined));
  return {
    // sem Entrada e Saída, ou o servidor devolveu NULL (sem permissão de ver / outra loja): o bloco some
    ativo: on && !(qEstoque.isSuccess && estoque === null),
    carregando: on && !erro && (qEstoque.isLoading || (ficha.habilitada && !fichaPronta)),
    // erro = a 1ª carga de QUALQUER das duas leituras falhou (sem dado): nunca "Carregando…" para sempre. Falha de refetch com dado mantém o dado.
    erro,
    tentando: on && (qEstoque.isFetching || qVariantes.isFetching),
    tentarDeNovo: () => {
      if (qEstoque.isError) void qEstoque.refetch();
      if (qVariantes.isError) void qVariantes.refetch();
    },
    fichaIndisponivel: !ficha.habilitada,
    pronta: fichaPronta && !!estoque,
    semTecido1,
    tamanhos, cores, calcular, fontesTecido, variantesAviamento, emEstoque,
  };
}
