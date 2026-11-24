/* eslint-disable @typescript-eslint/no-explicit-any -- colunas novas de `modelos` (descricao_produto, ncm, titulo_pagina, peso/medidas, preco_anterior, tamanho_tipo) e `colecao_subcolecoes` fora do types.ts (regen pendente): `as any` no builder, como a query da tela de hoje */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useIntegracaoEstados } from "@/hooks/useIntegracaoEstado";
import { usePlanejamentoOpts } from "@/hooks/usePlanejamentoOpts";
import { useTenantModules } from "@/hooks/useTenantModules";
import { buscarTodas } from "@/lib/buscar-todas";
import { rotuloColecaoDoModelo } from "@/lib/colecao-rotulo";
import type { Opt, SubOpt } from "@/components/planejamento/modelo-shared";
import type { ModeloGradeEntrada } from "@/lib/produto-grade/linhas";

/**
 * Hook de DADOS da grade "Lista tipo Excel" de Estilo & Engenharia > Planejamento de Produto. SÓ LEITURA (a edição vem na PR-2).
 *
 * ⚠️ `modelos` é a tabela central (Realtime, `rev`, permissões, trava da Integração). Por isso:
 *  - o SELECT traz TUDO o que o catálogo de colunas lê, incluindo `rev` (a PR-2 grava com CAS `.eq("rev")` + P0409) e o que o card não
 *    traz (subcategoria2_id, ncm, titulo_pagina, peso/medidas, preco_anterior, preco_atacado, tamanho_tipo, descricao_produto);
 *  - NUNCA traz `ref_auto` (a sigla pré-revelação não aparece — invariante 11) nem coluna de custo (custo é escondido por permissão,
 *    não trancado no banco — P-230; a grade v1 não tem coluna de custo, então nem o dado desce);
 *  - a loja vem da RLS (sem filtro de tenant no cliente).
 *
 * queryKey = ["modelos-planejamento", "grade"]: ÚNICA (o card usa a chave curta ["modelos-planejamento"], sem colidir no cache), mas com
 * o MESMO prefixo — de propósito: toda invalidação existente de `["modelos-planejamento"]` (salvar no Sheet, Realtime de `modelos`,
 * mover etapa, aprovar M.O.…) e o `BUSINESS_KEY_TOKENS` do Realtime (casa por `k[0]`) refrescam a grade SEM fiação nova. A grade só
 * consulta enquanto a visão Lista está montada (query inativa não refaz sozinha).
 *
 * Regra C3 (erro honesto): todo `queryFn` próprio faz `if (error) throw error` — nunca `data ?? []` de consulta que falhou; `buscarTodas`
 * pagina (PostgREST corta em 1.000) e também lança. As OPÇÕES de `usePlanejamentoOpts` (estilistas/linhas/meses/anos/grupos/categorias)
 * são as MESMAS queries do card e do Sheet (cache compartilhado, sem refetch duplo; lançam, mas o hook delas devolve só `data`).
 */

const SELECT_MODELOS =
  "id, rev, nome, ref, estilista_id, linha_id, colecao, colecao_id, colecoes(nome), subcolecao, semana, mes_id, ano_id, " +
  "categoria_principal_id, subcategoria1_id, subcategoria2_id, status_planejamento, status_desenvolvimento, ordem_criacao_enviada, " +
  "enviado_cad, versao, origem, descricao_produto, ncm, titulo_pagina, peso_kg, comprimento_cm, largura_cm, altura_cm, " +
  "preco_venda, preco_anterior, preco_atacado, tamanho_tipo, observacoes_gerais, observacoes_mao_obra, data_lancamento, lancado";

/** Opções fixas: o select de "Lançamento" do Sheet (semanas 1–5) e o "Tamanho em" (Letra/Número). */
export const OPCOES_SEMANA: Opt[] = ["1", "2", "3", "4", "5"].map((s) => ({ id: s, nome: s }));
export const OPCOES_TAMANHO_TIPO: Opt[] = [
  { id: "letra", nome: "Letra" },
  { id: "numero", nome: "Número" },
];

export type OpcaoColecao = { id: string; nome: string };
/** Subcoleções por coleção (id da coleção do OTB → nomes, na ordem do OTB). Só com o módulo OTB ligado. */
export type SubcolecoesPorColecao = Map<string, string[]>;

export type GradeOpcoesProduto = {
  estilistas: Opt[];
  linhas: Opt[];
  meses: Opt[];
  anos: Opt[];
  grupos: Opt[];
  /** Categoria com o grupo (a coluna "Grupo" é derivada dela). */
  categorias: { id: string; nome: string; grupo_id: string | null }[];
  /** Subcategorias 1/2 cascateiam pela categoria (`categoria_id`). */
  subcategorias1: SubOpt[];
  subcategorias2: SubOpt[];
  /** Coleções do OTB (vazio sem o módulo). */
  colecoes: OpcaoColecao[];
  subcolecoesPorColecao: SubcolecoesPorColecao;
  semanas: Opt[];
  tamanhoTipos: Opt[];
};

const VAZIO_MODELOS: ModeloGradeEntrada[] = [];
const VAZIO_SUBS: SubOpt[] = [];
const VAZIO_COLECOES: OpcaoColecao[] = [];
const VAZIO_SUBCOLECOES: { colecao_id: string; nome: string }[] = [];

export function useProdutosGrade() {
  const { canView, canEdit } = useAuth();
  const modulos = useTenantModules();
  const otbOn = modulos.isModuleEnabled("otb");
  const estadosIntegracao = useIntegracaoEstados();
  const { estilistas, linhas, meses, anos, grupos, categorias } = usePlanejamentoOpts();

  const modelosQ = useQuery({
    queryKey: ["modelos-planejamento", "grade"],
    queryFn: async () => {
      const rows = await buscarTodas<any>((de, ate) =>
        (supabase.from("modelos") as any)
          .select(SELECT_MODELOS)
          .order("created_at", { ascending: false })
          .order("id")
          .range(de, ate),
      );
      // `colecao_rotulo` = nome da coleção do OTB, senão o texto livre (regra única, `colecao-rotulo.ts`); `colecao` fica CRU p/ gravar.
      return rows.map(({ colecoes, ...m }: any) => ({
        ...m,
        colecao_rotulo: rotuloColecaoDoModelo({ colecao: m.colecao, colecoes }),
      })) as ModeloGradeEntrada[];
    },
  });

  // Mesmas queryKeys/queryFns da tela e do Sheet (cache compartilhado).
  const sub1Q = useQuery({
    queryKey: ["opt", "subcategorias1_produto"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subcategorias1_produto")
        .select("id, nome, categoria_id")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as SubOpt[];
    },
  });
  const sub2Q = useQuery({
    queryKey: ["opt", "subcategorias2_produto"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subcategorias2_produto")
        .select("id, nome, categoria_id")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as SubOpt[];
    },
  });

  // OTB: própria queryKey e erro HONESTO (a da tela engole o erro: `const { data } = …`).
  const colecoesQ = useQuery({
    queryKey: ["produtos-grade", "opcoes", "colecoes"],
    enabled: otbOn,
    queryFn: async () => {
      const { data, error } = await supabase.from("colecoes").select("id, nome").order("nome");
      if (error) throw error;
      return (data ?? []) as OpcaoColecao[];
    },
  });
  const subcolecoesQ = useQuery({
    queryKey: ["produtos-grade", "opcoes", "subcolecoes"],
    enabled: otbOn,
    queryFn: () =>
      buscarTodas<{ id: string; colecao_id: string; nome: string }>((de, ate) =>
        (supabase.from("colecao_subcolecoes" as any) as any)
          .select("id, colecao_id, nome")
          .order("ordem")
          .order("id")
          .range(de, ate),
      ),
  });

  const modelos = modelosQ.data ?? VAZIO_MODELOS;

  const subcolecoesPorColecao = useMemo<SubcolecoesPorColecao>(() => {
    const m: SubcolecoesPorColecao = new Map();
    for (const s of subcolecoesQ.data ?? VAZIO_SUBCOLECOES) {
      const lista = m.get(s.colecao_id);
      if (lista) lista.push(s.nome);
      else m.set(s.colecao_id, [s.nome]);
    }
    return m;
  }, [subcolecoesQ.data]);

  const opcoes = useMemo<GradeOpcoesProduto>(
    () => ({
      estilistas,
      linhas,
      meses,
      anos,
      grupos,
      categorias,
      subcategorias1: sub1Q.data ?? VAZIO_SUBS,
      subcategorias2: sub2Q.data ?? VAZIO_SUBS,
      colecoes: colecoesQ.data ?? VAZIO_COLECOES,
      subcolecoesPorColecao,
      semanas: OPCOES_SEMANA,
      tamanhoTipos: OPCOES_TAMANHO_TIPO,
    }),
    [
      estilistas,
      linhas,
      meses,
      anos,
      grupos,
      categorias,
      sub1Q.data,
      sub2Q.data,
      colecoesQ.data,
      subcolecoesPorColecao,
    ],
  );

  // Consultas PRÓPRIAS (as que o hook controla). `enabled: false` (OTB desligado) não conta como carregando.
  const queries = [modelosQ, sub1Q, sub2Q, colecoesQ, subcolecoesQ];
  // `!pronto && !erro`: sem os módulos resolvidos não se sabe se o OTB está ligado (cairia nos DEFAULTS = desligado).
  const isLoading = queries.some((q) => q.isLoading) || (!modulos.pronto && !modulos.erro);
  const isError = queries.some((q) => q.isError) || modulos.erro;
  const erro = (queries.find((q) => q.isError)?.error ?? null) as Error | null;

  // "Tentar de novo" do aviso de erro: refaz SÓ as que falharam. `recarregando` liga o "Tentando…" do botão.
  const recarregar = () => {
    if (modulos.erro) modulos.tentarDeNovo();
    return Promise.all(queries.filter((q) => q.isError).map((q) => q.refetch()));
  };
  const recarregando =
    queries.some((q) => q.isError && q.isFetching) || (modulos.erro && modulos.tentando);

  return {
    modelos,
    opcoes,
    otbOn,
    /** Estado da Integração por produto (id → integrável/integrado + campos marcados). {} = nenhum produto travado (ou ainda não chegou). */
    estadosIntegracao,
    /** Permissões cruas: `colunasVisiveis(canView, canEdit)` e `colunaEditavelNoProduto(…, canEdit, estado)` decidem o resto. */
    canView,
    canEdit,
    isLoading,
    isError,
    erro,
    recarregar,
    recarregando,
  };
}

export type ProdutosGradeDados = ReturnType<typeof useProdutosGrade>;
