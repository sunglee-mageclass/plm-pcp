/* eslint-disable @typescript-eslint/no-explicit-any -- `etiquetas`/`variantes_etiqueta`/`tipos_insumo` fora do types.ts (regen pendente): `as any` no builder, como a tela de Insumos de hoje */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useActiveTenant } from "@/hooks/useActiveTenantId";
import { buscarTodas } from "@/lib/buscar-todas";
import { empresaTemCategoria, ETIQUETA_TOKENS } from "@/lib/fornecedor-categoria";
import {
  agruparInsumoGrade,
  normalizarEtiquetaGrade,
  normalizarTamanhosGrade,
  TAMANHOS_GRADE_PADRAO,
  type BlocoCorInsumo,
  type GradeInsumoCompleto,
  type GradeVarianteInsumo,
} from "./agruparInsumoGrade";

export type { BlocoCorInsumo, GradeInsumoCompleto, GradeVarianteInsumo };

/**
 * Hook de DADOS da grade editável (visão "Lista" de Cadastro > Insumos). SÓ LEITURA.
 * Espelha `useAviamentosGrade`, adaptado ao insumo (tabela `etiquetas`).
 *
 * Diferente da query de card da tela (`["etiquetas-cadastro"]`, enxuta, com `variantes_etiqueta(id, tamanho)` embutido), a grade
 * edita e cria — então precisa dos campos de cabeçalho editáveis, das variantes COMPLETAS (cor, tamanho, preço) e das opções dos
 * selects. DIFERENÇA CENTRAL: a variante do banco é (cor, tamanho), mas a grade tem 1 LINHA POR COR; por isso `blocosPorEtiqueta`
 * já entrega as variantes agrupadas por etiqueta→cor em `{cor_id, preco, tamanhos}` (ver `agruparInsumoGrade`).
 * Insumo NÃO tem `rev`, apelido, foto nem categoria (só `tipo_insumo_id`). SELECT direto; a loja vem da RLS.
 *
 * Regra C3 (erro honesto): todo `queryFn` faz `if (error) throw error` — nunca `data ?? []` de uma consulta que falhou (a tela de hoje
 * engole o erro da config de tamanhos; aqui não). `isError` reflete falha real; quem renderiza decide o aviso ("Tentar de novo").
 * `buscarTodas` pagina (PostgREST corta em 1.000 linhas) e também lança o erro. queryKeys únicas com prefixo "insumos-grade"
 * (não colidem com as da tela: `etiquetas-cadastro`, `empresas-options`, `tipos-insumo-opts`, `cores-opts`, `tenant-tamanhos-grade`).
 */

export type GradeOpcaoNome = { id: string; nome: string };
/**
 * Fornecedor de material com seus representantes (o `FornecedorSelect` grava `(empresa_id, representante_id)`).
 * `ehInsumo` = a empresa tem categoria de fornecedor de insumo/etiqueta/tag (TOKEN flexível, `ETIQUETA_TOKENS`, como o card da tela):
 * a célula oferece só essas, mais o fornecedor já salvo no insumo (mesmo que a categoria dele tenha mudado depois).
 */
export type GradeOpcaoEmpresa = {
  id: string;
  nome_fantasia: string;
  representantes: { id: string; nome: string | null }[];
  ehInsumo: boolean;
};
/** Representante achatado (todas as empresas), p/ rotular o `representante_id` salvo sem varrer as empresas. */
export type GradeOpcaoRepresentante = { id: string; nome: string | null; empresa_id: string };

export type GradeOpcoes = {
  /** `tipos_insumo` (FK do insumo). */
  tipos: GradeOpcaoNome[];
  cores: GradeOpcaoNome[];
  empresas: GradeOpcaoEmpresa[];
  /** `tenant_config.tamanhos_grade` da loja (chaves "num|sigla"); sem config = o padrão ["34|PPP" … "44|GG"]. */
  tamanhosGrade: string[];
  representantes: GradeOpcaoRepresentante[];
};

const VAZIO_INSUMOS: GradeInsumoCompleto[] = [];
const VAZIO_VARIANTES: GradeVarianteInsumo[] = [];
const VAZIO_NOMES: GradeOpcaoNome[] = [];
const VAZIO_EMPRESAS: GradeOpcaoEmpresa[] = [];
const PADRAO_TAMANHOS: string[] = [...TAMANHOS_GRADE_PADRAO];

export function useInsumosGrade() {
  // A loja entra na key da config de tamanhos (query por tenant). Enquanto a loja não resolveu, a query fica desligada — e a grade
  // NÃO pode se dar por carregada com o padrão (ver `isLoading` abaixo).
  const {
    tenantId,
    erro: erroLoja,
    tentarDeNovo: tentarLojaDeNovo,
    tentando: tentandoLoja,
  } = useActiveTenant();

  const etiquetasQ = useQuery({
    queryKey: ["insumos-grade", "etiquetas"],
    queryFn: async () => {
      const linhas = await buscarTodas<Record<string, unknown>>((de, ate) =>
        (supabase.from("etiquetas" as any) as any)
          .select(
            "id,nome,unidade,preco,empresa_id,representante_id,observacoes,formato_tamanho,tipo_insumo_id,tamanho_vinculado,created_at",
          )
          .order("nome")
          .order("id")
          .range(de, ate),
      );
      return linhas.map(normalizarEtiquetaGrade);
    },
  });

  const variantesQ = useQuery({
    queryKey: ["insumos-grade", "variantes"],
    queryFn: () =>
      buscarTodas<GradeVarianteInsumo>((de, ate) =>
        (supabase.from("variantes_etiqueta" as any) as any)
          .select("id,etiqueta_id,cor_id,tamanho,preco,created_at")
          .order("created_at")
          .order("id")
          .range(de, ate),
      ),
  });

  const tiposQ = useQuery({
    queryKey: ["insumos-grade", "opcoes", "tipos"],
    queryFn: async () => {
      const { data, error } = await (supabase.from("tipos_insumo" as any) as any)
        .select("id,nome")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as GradeOpcaoNome[];
    },
  });

  const coresQ = useQuery({
    queryKey: ["insumos-grade", "opcoes", "cores"],
    queryFn: async () => {
      const { data, error } = await supabase.from("cores").select("id,nome").order("nome");
      if (error) throw error;
      return (data ?? []) as GradeOpcaoNome[];
    },
  });

  const empresasQ = useQuery({
    // Fornecedores de material + representantes + categorias (a categoria casa por TOKEN no cliente: o nome varia por loja —
    // ver `@/lib/fornecedor-categoria`). A célula de fornecedor filtra por `ehInsumo`, como o card da tela de Insumos.
    queryKey: ["insumos-grade", "opcoes", "empresas-material"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("empresas")
        .select(
          "id,nome_fantasia,representantes(id, nome),empresa_categorias_fornecedor(categorias_fornecedor(nome))",
        )
        .eq("tipo", "material")
        .order("nome_fantasia");
      if (error) throw error;
      return ((data ?? []) as any[]).map((e) => ({
        id: e.id as string,
        nome_fantasia: e.nome_fantasia as string,
        representantes: (e.representantes ?? []) as { id: string; nome: string | null }[],
        ehInsumo: empresaTemCategoria(e, ETIQUETA_TOKENS),
      })) as GradeOpcaoEmpresa[];
    },
  });

  const tamanhosQ = useQuery({
    queryKey: ["insumos-grade", "opcoes", "tamanhos-grade", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenant_config")
        .select("tamanhos_grade")
        .eq("tenant_id", tenantId)
        .limit(1);
      if (error) throw error;
      // Loja sem linha de config / sem lista = padrão (sucesso de verdade); falha de leitura NUNCA cai aqui.
      return normalizarTamanhosGrade((data ?? [])[0]?.tamanhos_grade);
    },
  });

  const queries = [etiquetasQ, variantesQ, tiposQ, coresQ, empresasQ, tamanhosQ];

  // Referências estáveis enquanto `data` não muda (o Map só se refaz quando a query muda).
  const etiquetas = etiquetasQ.data ?? VAZIO_INSUMOS;
  const blocosPorEtiqueta = useMemo(
    () => agruparInsumoGrade(variantesQ.data ?? VAZIO_VARIANTES),
    [variantesQ.data],
  );

  const opcoes = useMemo<GradeOpcoes>(() => {
    const empresas = empresasQ.data ?? VAZIO_EMPRESAS;
    return {
      tipos: tiposQ.data ?? VAZIO_NOMES,
      cores: coresQ.data ?? VAZIO_NOMES,
      empresas,
      tamanhosGrade: tamanhosQ.data ?? PADRAO_TAMANHOS,
      representantes: empresas.flatMap((e) =>
        e.representantes.map((r) => ({ id: r.id, nome: r.nome, empresa_id: e.id })),
      ),
    };
  }, [tiposQ.data, coresQ.data, empresasQ.data, tamanhosQ.data]);

  // Loja ainda sem resolver = a config de tamanhos nem começou (query desligada, `isLoading` false): conta como carregando.
  const isLoading = queries.some((q) => q.isLoading) || (!tenantId && !erroLoja);
  const isError = queries.some((q) => q.isError) || erroLoja;
  const erro = (queries.find((q) => q.isError)?.error ?? null) as Error | null;

  // "Tentar de novo" do aviso de erro: refaz SÓ as que falharam (e a loja, se foi ela). `recarregando` liga o "Tentando…" do botão.
  const recarregar = async () => {
    if (erroLoja) tentarLojaDeNovo();
    await Promise.all(queries.filter((q) => q.isError).map((q) => q.refetch()));
  };
  const recarregando = tentandoLoja || queries.some((q) => q.isError && q.isFetching);

  return {
    etiquetas,
    blocosPorEtiqueta,
    opcoes,
    isLoading,
    isError,
    erro,
    recarregar,
    recarregando,
  };
}

export type InsumosGradeDados = ReturnType<typeof useInsumosGrade>;
